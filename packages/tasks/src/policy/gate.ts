/**
 * 策略门——由设置构建可用的 `Policy`(gate / revalidate / admitsInferred),并计算规则变更
 * 对每张在跑工单的影响(policyEffects)。
 *
 * 设计依据:34 号 §2.2 gate 两行(SA policy.ts:143-165 policyEffects、167-242 settingsPolicy)、
 * §1 目录树 policy/gate 行;35 号 A4;27 号 §3.2-④(权力层级:策略变更只通知不撤销)。
 * 语义自 SA 重写级校对移植,不变量原样;★本仓改造(34 §2.2 gate 行、§5-access;24 §5.2):
 * - `allowed` 名单查询支持经端口注入(`AllowedRoster`)——生产接线为 access 用户表 + realm 准入表
 *   联合判定(A10),注入、不 import 服务实例;未注入时回退 settings 自带名单(SA 原语义,纯函数面)。
 * - 版本可由 glue 层注入(`PolicyWiring.version`)——C3 联合 hash(governance+hitl+tasks)经
 *   `jointPolicyVersion` 算得后传入;未注入时用 `policyVersion(settings)`(settings 内容 hash)。
 * 谁可在何处发起工作由各 Source 自己的身份配置决定;Policy 从不把一个人跨 Source 映射(SA 原则)。
 * sameName 自 SA src/infra/text.ts 并入本文件(34 §2.2:infra 除 sameName 外不移植)。
 */
import { z } from 'zod'
import type { ActorRef, Mandate, PolicyEffect, Thread, Ticket, Trigger } from '../core/model.ts'
import type { GateResult, Policy, SourceScope } from '../core/ports.ts'
import { ADMISSION_DEFAULTS, type Admission, type AdmissionCell } from './admission.ts'
import { AllowedSchema, type Allowed, type Settings } from './settings.ts'
import { policyVersion } from './version.ts'

/** 身份比较大小写不敏感(GitHub 登录名与仓库名如此;SA src/infra/text.ts sameName 原样并入)。 */
export const sameName = (a: string, b: string): boolean => a.toLowerCase() === b.toLowerCase()

/** 名单查询端口(A10 接线面):某行动者是否在该 realm 的 allowed 名单上——生产侧接 access 用户表。 */
export type AllowedRoster = (actor: ActorRef) => Allowed | undefined
/**
 * 策略装配的接线项(均为可选,默认回到纯设置面):
 * - `allowed`:名单查询端口(上);未注入用 settings 的 realm 内名单。
 * - `version`:glue 层算得的 C3 联合 hash;未注入用 settings 内容 hash。
 */
export interface PolicyWiring {
  allowed?: AllowedRoster
  version?: string
}

/** 在 settings 的某 Source 分部名单里查行动者(SA allowedSender 原语义)。 */
export function allowedSender(settings: Settings, actor: ActorRef): Allowed | undefined {
  return settings.policy.sources[actor.source]?.allowed.find(entry => sameName(entry.id, actor.id))
}
/** 查 `actor` 在其 Source `bots` 名单(catchall 透传,防御式解析)——bot 消息至多作推断候选。 */
export function listedBot(settings: Settings, actor: ActorRef): Allowed | undefined {
  const bots = z.array(AllowedSchema).catch([]).parse(settings.policy.sources[actor.source]?.bots ?? [])
  return bots.find(entry => sameName(entry.id, actor.id))
}
/** 是否有任何 Source 配了名单(管理面板提示用)。 */
export const anyoneAllowed = (settings: Settings): boolean => Object.values(settings.policy.sources).some(part => part.allowed.length > 0)
const senderName = (entry: Allowed): string => entry.name || entry.id

/** 线程是否有自己的工单(不算仅上下文跟随的订阅)。 */
const participating = (thread: Thread, tickets: Ticket[]): boolean =>
  [...thread.subscriptions, ...tickets.map(ticket => ticket.id)].some(id => !thread.context?.includes(id))
const listened = (sources: SourceScope, source: string, meta: Record<string, unknown>) => sources.scope({ source, meta })

/** 名单内×是否对 agent 说话 → 三格之一;名单内且对准 agent 不查格子(恒显式)。 */
function admissionCell(allowed: boolean, addressed: boolean): AdmissionCell | undefined {
  return allowed ? addressed ? undefined : 'listedUnaddressed' : addressed ? 'unlistedAddressed' : 'unlistedUnaddressed'
}
function admissionOf(settings: Settings, source: string, row: string | undefined, cell: AdmissionCell): Admission {
  return (row === undefined ? undefined : settings.policy.sources[source]?.admission[row]?.[cell]) ?? ADMISSION_DEFAULTS[cell]
}
const STRENGTH: Readonly<Record<Admission, number>> = { ignore: 0, inferred: 1, explicit: 2 }

/**
 * 计算设置从 `old` 变到 `now` 对每张开放工单授权/命中规则的影响(★只通知不撤销,27 号 §3.2-④:
 * effects 经 `Engine.policyChanged` 注入 `policy-changed` Input,在跑工单钉旧版,永不撤其 Mandate)。
 * `scope` 随设置给出各时刻的 SourceScope(监听范围随 Source 配置变);`wiring` 与构建 Policy 时同参。
 */
export function policyEffects(tickets: readonly Ticket[], old: Settings, now: Settings, scope: (settings: Settings) => SourceScope,
  wiring: PolicyWiring = {}): Map<string, PolicyEffect> {
  const before = settingsPolicy(old, scope(old), wiring), after = settingsPolicy(now, scope(now), wiring)
  const effects = new Map<string, PolicyEffect>()
  for (const ticket of tickets) {
    // 其 Mandate 命中过的每条规则:被禁 → disabled;指示变 → changed;未变 → 不记。
    const rules = (ticket.mandate.basis.rules ?? []).flatMap((id): NonNullable<PolicyEffect['rules']> => {
      const was = old.policy.rules.find(rule => rule.id === id), is = now.policy.rules.find(rule => rule.id === id)
      if (!is?.enabled) return was?.enabled ? [{ id, name: was.name, change: 'disabled' }] : []
      return JSON.stringify(was) === JSON.stringify(is) ? [] : [{ id, name: is.name, change: 'changed', instruction: is.instruction }]
    })
    const effect: PolicyEffect = rules.length ? { rules } : {}
    if (before.revalidate(ticket.mandate) && !after.revalidate(ticket.mandate)) {
      // 按旧 accept 档与规则,Mandate 本应继续成立——除非发送者或接收 scope 失去了授权。
      const asBefore = { ...now, eval: old.eval, policy: { ...now.policy, rules: old.policy.rules } }
      if (!settingsPolicy(asBefore, scope(now), wiring).revalidate(ticket.mandate)) {
        Object.assign(effect, { requesterAllowed: false, requester: ticket.mandate.actor })
      } else if (ticket.mandate.strength === 'inferred' && old.eval.mode === 'auto' && now.eval.mode !== 'auto') effect.proactive = false
    }
    if (Object.keys(effect).length) effects.set(ticket.id, effect)
  }
  return effects
}

/**
 * 由设置构建生效的 `Policy`:门住进入的 Trigger(gate)、复核既有 Mandate(revalidate)、
 * 判推断候选可否按命中规则被接受(admitsInferred)。
 */
export function settingsPolicy(settings: Settings, sources: SourceScope, wiring: PolicyWiring = {}): Policy {
  const version = wiring.version ?? policyVersion(settings)
  const mode = settings.eval.mode
  // 名单判定:注入的 access 名单桩(A10)优先,否则 settings 的 realm 内名单。
  const roster = (actor: ActorRef): Allowed | undefined => wiring.allowed?.(actor) ?? allowedSender(settings, actor)
  /** 门住非人 trigger:只有名单上的 bot(至多推断候选)与无发送者的系统/CI 事件可过,其余 bot 拒之。 */
  const machineGate = (trigger: Trigger): GateResult => {
    const bot = trigger.actor.id ? listedBot(settings, trigger.actor) : undefined
    if (trigger.actor.id && !bot) return { admissible: false, reason: 'not_human' }
    const scope = listened(sources, trigger.source, trigger.meta)
    if (!scope.listened || !(trigger.addressed || scope.observed)) return { admissible: false, reason: 'not_human' }
    const recorded = { source: trigger.source, scope: trigger.meta, ...scope.row === undefined ? {} : { row: scope.row } }
    const addressed = trigger.addressed ? { addressed: trigger.addressed } : {}
    if (bot) {
      if (mode === 'off') return { admissible: false, reason: 'admission_ignored' }
      const basis = { ...recorded, via: 'bot' as const, sender: senderName(bot), ...addressed, observation: { mode } }
      return { admissible: true, strength: 'inferred', basis }
    }
    const cell = 'unlistedUnaddressed' as const
    if (admissionOf(settings, trigger.source, scope.row, cell) !== 'inferred' || mode === 'off') {
      return { admissible: false, reason: 'admission_ignored' }
    }
    return { admissible: true, strength: 'inferred', basis: { ...recorded, via: 'admission', cell, observation: { mode } } }
  }
  return {
    version, paused: settings.paused, evalTimeoutMs: settings.eval.timeoutSeconds * 1000,
    gate(trigger: Trigger, thread, tickets) {
      if (!trigger.human) return machineGate(trigger)
      const allowed = roster(trigger.actor)
      const scope = listened(sources, trigger.source, trigger.meta)
      const row = scope.listened ? scope.row : undefined
      const recorded = { source: trigger.source, scope: trigger.meta,
        ...row === undefined ? {} : { row }, ...allowed ? { sender: senderName(allowed) } : {} }
      if (allowed && trigger.addressed) return { admissible: true, strength: 'explicit', basis: { ...recorded, via: 'addressed', addressed: trigger.addressed } }
      // SA 不变量:allowed 且 addressed 已在上一行 early return,此处 admissionCell 必有值;非空断言与 SA 原样
      // oxlint-disable-next-line typescript/no-non-null-assertion
      const cell = admissionCell(!!allowed, !!trigger.addressed)!
      // 未对准的消息只有当 Source 在该 scope 连非对准消息也收时,才用得上准入表。
      const receivable = !!trigger.addressed || (scope.listened && scope.observed)
      const admission = receivable ? admissionOf(settings, trigger.source, row, cell) : 'ignore'
      const basis = { ...recorded, via: 'admission' as const, cell, ...trigger.addressed ? { addressed: trigger.addressed } : {} }
      // 先查准入表的 explicit 格、再看线程后续——线程上的工单绝不把一条显式请求弱化为后续。
      if (admission === 'explicit') return { admissible: true, strength: 'explicit', basis }
      // 私聊线程只属一个发送者(别人无后续),且推断后续需要非 off 的受理档(off 时由表定)。
      if (!(trigger.addressed === 'direct' && !allowed) && (allowed || mode !== 'off') && participating(thread, tickets)) {
        return { admissible: true, strength: allowed ? 'explicit' : 'inferred', basis: { ...recorded, via: 'followup' } }
      }
      if (admission === 'inferred' && mode !== 'off') return { admissible: true, strength: 'inferred', basis: { ...basis, observation: { mode } } }
      return { admissible: false, reason: !allowed ? 'not_a_member' : receivable && admission === 'ignore' ? 'admission_ignored' : 'no_mention' }
    },
    admitsInferred: rules => mode === 'auto' && rules.length > 0 && rules.every(id => settings.policy.rules.some(rule => rule.enabled && rule.id === id)),
    revalidate(mandate: Mandate) {
      // 复核规则循 SA docs/002(Eval 路径;恢复前 revalidate)——五分支:
      const { basis } = mandate
      const { source } = basis
      const current = source && basis.scope ? listened(sources, source, basis.scope) : undefined
      // ①接收 scope 已不在监听 → 不成立。
      if (current && !current.listened) return false
      const rulesOn = (rules: string[] | undefined) =>
        (rules ?? []).every(id => settings.policy.rules.some(rule => rule.enabled && rule.id === id))
      // ②后续(followup):显式后续恒成立;推断后续需 auto 档且命中规则全启用。
      if (basis.via === 'followup') return mandate.strength === 'explicit' || (mode === 'auto' && rulesOn(basis.rules))
      // ③bot:bot 仍在其 Source 的 bots 名单上才成立,并经受下方观察检查。
      if (basis.via === 'bot' && !listedBot(settings, mandate.actor)) return false
      // ④准入表(admission):发送者的当前格子至少仍给到原强度,才成立。
      if (basis.via === 'admission') {
        const { cell } = basis
        const listed = !!roster(mandate.actor)
        // 名单上的发送者对 agent 说话恒为显式、不查格子。
        if (cell === 'unlistedAddressed' && listed) return true
        // 接受后新入名单的发送者移入名单格,并仍经受下方观察检查。
        const now = cell === 'unlistedUnaddressed' && listed ? 'listedUnaddressed' : cell
        if (now === 'listedUnaddressed' && !listed) return false
        const admission = admissionOf(settings, source ?? '', current?.listened ? current.row : undefined, now)
        if (STRENGTH[admission] < STRENGTH[mandate.strength]) return false
        if (mandate.strength === 'explicit') return true
      } else if (basis.via !== 'bot' && !roster(mandate.actor)) return false
      // ⑤观察/推断 Mandate:仅当 auto 档仍开且全部命中规则仍启用时成立。
      if ((basis.via === 'admission' || basis.via === 'listed' || basis.via === 'bot') && basis.observation) return mode === 'auto' && rulesOn(basis.rules)
      return true
    },
  }
}
