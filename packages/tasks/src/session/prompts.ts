/**
 * Prompts——orchestrator/worker 双角色的版本化 prompt 资产与装配面
 * (35 号 A23;34 号 §1 prompts/ 行、§2.5 prompts 行、§4-D)。
 *
 * 设计依据:34 号 §2.5「SA src/app/prompts.ts + prompts/*.md → src/session/(装配)+
 * prompts/(资产);prompt 版本绑定每次请求保留(24 号 §8.1-4);prompt 文本本地化为
 * 中文为主(§6-9)」。语义自 SA src/app/prompts.ts 重写级校对移植:
 * - 装配分段:固定段(内置件)→ 团队段(communication/scope/delivery)→ guides 段
 *   (subscriptions/replies + dispatch|work)→(orchestrator 专属)admission →
 *   handoff(按角色)→ 生成的执行环境段 →(orchestrator 专属)Policy 段——Policy 段
 *   之后无内容,其变化不扰动 prompt 其余部分(SA prompts.ts:99-116 装配顺序原样);
 * - 版本绑定每次请求(24 §8.1-4):PromptConfig 以编号快照存租户库 KV
 *   (版本史 = store.ts 内部 Versions 类,34 §2.3「保留在 store 内部」);每次组合时
 *   Policy 段按当前 settings 现算;`bind` 在每次模型请求时记录 session 所依据的修订,
 *   session 可读其活动修订与曾运行过的修订(SA Sessions 的 KV.sessions.prompts 机制的
 *   prompts 半边;Sessions 装配接线归 35 号 A16);
 * - 团队覆盖不漂移(34 §4-D):overrides 以 `{text, base}` 记录编辑自哪份内置文本;
 *   升级永不改写团队文本——内置文本变化只经 `defaultChanged` 列出,由团队显式取舍;
 *   等于内置文本的覆盖自动脱落,后续升级随内置文本走。
 *
 * ★本仓中文化改造(34 §6-9;35 号 A23):prompt 文本中文为主、术语保留英文
 * (orchestrator/worker/ticket/trigger/Eval/Mandate/attention 与 orchestrator_* 工具名、
 * 字段名均为模型面契约,不改写);体积预算按字符重标定(tests/model-surface.spec.ts,
 * 禁止沿用 SA 英文预算——35 号 §12-9 开放问题:预算数字按重写后实测回填)。
 *
 * 范围裁剪(不自行裁定,35 号 §12-18):SA prompts/ 的 cli.md 与 team/ 子目录不在
 * 34 §1 清单内,本包不搬运——团队段默认空文本(空段不进 prompt),Source skill
 * (skill/feishu、skill/github)属 35 号 A21 sources 面,其 part 随 A21 落地再入表。
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { z } from 'zod'
import { UserError } from '../core/errors.ts'
import { key } from '../core/ids.ts'
import type { Settings } from '../policy/settings.ts'
import { LIMITS } from '../policy/settings.ts'
import { policyVersion } from '../policy/version.ts'
import { KV } from '../store/kv.ts'
import { Versions, type Store } from '../store/store.ts'
import type { SessionRole } from './sessions.ts'

/**
 * 读取打包内置的 prompt 资产(`prompts/<name>.md`)。源 .md 文件一行一句以便 diff
 * 阅读(SA 约定);本函数把段内各行以空格连接、保留空行分段(SA promptFile 语义)。
 * @throws 按路径点名缺失或空白-only 的资产——缺了它本包无法装配。
 */
export function promptFile(name: string): string {
  const path = fileURLToPath(new URL(`../../prompts/${name}.md`, import.meta.url))
  let text: string
  try { text = readFileSync(path, 'utf8').replaceAll('\r\n', '\n') }
  catch (error) {
    throw (error as NodeJS.ErrnoException).code === 'ENOENT' ? new Error(`Missing packaged file: ${path}`, { cause: error }) : error
  }
  if (!text.trim()) throw new Error(`Empty packaged file: ${path}`)
  const paragraphs = text.trim().split(/\n(?:[ \t]*\n)+/)
  return paragraphs.map(paragraph => paragraph.split('\n').map(line => line.trim()).join(' ')).join('\n')
}

/** 内置共享段(host 投递与工具使用纪律,双角色;团队可覆盖)。 */
export const sharedPrompt = promptFile('shared')
/** 内置 orchestrator 角色段。 */
export const orchestratorPrompt = promptFile('orchestrator')
/** 内置 worker 角色段。 */
export const workerPrompt = promptFile('worker')
/** 内置 guide 段(subscriptions/replies 双角色;dispatch 属 orchestrator、work 属 worker)。 */
export const guides: Readonly<Record<'subscriptions' | 'replies' | 'dispatch' | 'work', string>> = {
  subscriptions: promptFile('subscriptions'), replies: promptFile('replies'),
  dispatch: promptFile('dispatch'), work: promptFile('work'),
}
/** 内置主动候选评估纪律段(orchestrator 专属;SA mainAdmissionPolicy)。 */
export const admissionPolicy = promptFile('admission')
/** 内置交接契约段:shared 通用 + 按角色一份(SA handoffPolicy 同构)。 */
const handoff = { shared: promptFile('handoff'), orchestrator: promptFile('handoff-orchestrator'), worker: promptFile('handoff-worker') }
export const handoffPolicy = (role: SessionRole): string => `${handoff.shared}\n${handoff[role]}`

/** 团队可写的 prompt 段(SA TEAM_SECTIONS 原样);空文本的段不进 prompt。 */
export const TEAM_SECTIONS = ['communication', 'scope', 'delivery'] as const
export type TeamSection = typeof TEAM_SECTIONS[number]
/** 各团队段的 Markdown 标题;固定段按这些确切名字引用它们。 */
const TEAM_HEADINGS: Record<TeamSection, string> = { communication: '沟通约定', scope: '工单范围', delivery: '交付要求' }
/** 团队 skill 名:小写字母开头的小写字母/数字/连字符。 */
export const SKILL_NAME = /^[a-z][a-z0-9-]*$/

/** 内置件键(SA PART_KEYS 裁剪:skill/feishu、skill/github 属 A21,随 sources 落地再入)。 */
export const PART_KEYS = ['runtime/shared', 'runtime/orchestrator', 'runtime/worker', 'runtime/subscriptions', 'runtime/replies',
  'runtime/dispatch', 'runtime/work', 'runtime/admission', 'runtime/handoff/orchestrator', 'runtime/handoff/worker', 'runtime/environment',
  'runtime/policy', 'runtime/policy/none'] as const
export type PartKey = typeof PART_KEYS[number]
/** 一件内置件:读它的角色、其文本,及模板件覆盖后必须保留的占位符。 */
export interface BuiltInPart { roles: readonly SessionRole[]; text: string; placeholders?: readonly string[] }
const BOTH: readonly SessionRole[] = ['orchestrator', 'worker'], MAIN: readonly SessionRole[] = ['orchestrator'], WORKER: readonly SessionRole[] = ['worker']

/** 执行环境段的标题(中文重标定,34 §6-9;占位符 {variables} 由装配填充)。 */
const ENVIRONMENT_HEADING = '执行环境(来自本安装的设置;它优先于本文其他地方提到的任何仓库或账号;空值表示该处未配置)。工单目录的 prepare 命令读取同一组变量:'
/** 主会话 Policy 段的段头(占位符 {version}/{mode}/{rules} 由装配按当前 settings 填充)。 */
const POLICY_HEAD = '## Policy\nPolicy 版本 {version};受理档位 {mode}。受理档位与规则只决定主动候选:明确请求在任何档位、无论规则如何,都按 dispatch 的路由处理。'

let parts: Readonly<Record<PartKey, BuiltInPart>> | undefined
/** 双角色的内置件、按覆盖键索引;首次使用时构建(读入的文本存在导入环,故惰性)。 */
export const builtInParts = (): Readonly<Record<PartKey, BuiltInPart>> => parts ??= {
  'runtime/shared': { roles: BOTH, text: sharedPrompt }, 'runtime/orchestrator': { roles: MAIN, text: orchestratorPrompt },
  'runtime/worker': { roles: WORKER, text: workerPrompt },
  'runtime/subscriptions': { roles: BOTH, text: `## subscriptions\n${guides.subscriptions}` },
  'runtime/replies': { roles: BOTH, text: `## replies\n${guides.replies}` },
  'runtime/dispatch': { roles: MAIN, text: `## dispatch\n${guides.dispatch}` }, 'runtime/work': { roles: WORKER, text: `## work\n${guides.work}` },
  'runtime/admission': { roles: MAIN, text: admissionPolicy },
  'runtime/handoff/orchestrator': { roles: MAIN, text: handoffPolicy('orchestrator') },
  'runtime/handoff/worker': { roles: WORKER, text: handoffPolicy('worker') },
  'runtime/environment': { roles: BOTH, text: `${ENVIRONMENT_HEADING}\n{variables}`, placeholders: ['{variables}'] },
  'runtime/policy': { roles: MAIN, text: `${POLICY_HEAD} 已启用的规则,按名称与 id:\n{rules}`, placeholders: ['{version}', '{mode}', '{rules}'] },
  'runtime/policy/none': { roles: MAIN, text: `${POLICY_HEAD} 没有启用任何规则:主动候选只能 ignore。`,
    placeholders: ['{version}', '{mode}'] },
}

/** 一份内置文本的键——覆盖件的 `base` 记录它(内容派生,同文本同键)。 */
export const builtInBase = (text: string): string => key('prompt-built-in', text)
/** 键名所指的内置件;对象原型上的名字不指任何件。 */
export const builtInPart = (part: string): BuiltInPart | undefined =>
  Object.hasOwn(builtInParts(), part) ? builtInParts()[part as PartKey] : undefined
/** 一件内置件的文本:团队的覆盖件,否则内置文本。 */
const builtIn = (config: PromptConfig, part: PartKey): string => {
  const override = config.overrides?.[part]
  return (override !== undefined && Object.hasOwn(config.overrides ?? {}, part) ? override.text : undefined)
    ?? builtInParts()[part].text
}
/** 一趟填完模板的全部占位符;填入的文本不再被读作占位符。 */
const fill = (template: string, values: Record<string, string>): string =>
  template.replace(/\{(\w+)\}/g, (match, name: string) => {
    const value = Object.hasOwn(values, name) ? values[name] : undefined
    return value === undefined ? match : value
  })

/** 执行环境段:模板填入变量行;setup 未完成时说明在等待(装配环境变量面归 A16,此处收渲染好的行)。 */
export function environmentSection(config: PromptConfig, variables: string | undefined): string {
  return variables ? fill(builtIn(config, 'runtime/environment'), { variables })
    : '执行环境:@eterna/tasks 正在等待 setup;管理面板会说明缺什么。'
}

/**
 * 主会话的 Policy 段:按 settings 现状给出其裁决主动候选所依据的 Policy 版本、受理档位
 * 与每条启用的规则(一行一条,使指示文本读不出自己的规则或标题;settings 以
 * `LIMITS.ruleInstruction` 约束指示长度)。`key` 名出填充它的模板件。
 */
export function policySection(settings: Settings, config: PromptConfig = defaultPrompts()): { key: string; text: string } {
  const line = (text: string) => text.replace(/\s*\n\s*/g, ' ')
  const rules = settings.policy.rules.filter(rule => rule.enabled).map(({ id, name, instruction }) => `- ${line(name)} (${id}): ${line(instruction)}`)
  const part = rules.length ? 'runtime/policy' : 'runtime/policy/none'
  return { key: part, text: fill(builtIn(config, part), { version: policyVersion(settings), mode: settings.eval.mode, rules: rules.join('\n') }) }
}

/** 装配出的一段 prompt:固定段/团队段/生成段三态(团队空段不出现)。 */
export type PromptPart =
  | { name: string; kind: 'fixed'; key: string; text: string }
  | { name: string; kind: 'team'; heading: string; text: string }
  | { name: string; kind: 'generated'; key: string; text: string }

/**
 * 按序装配一个角色的 system prompt 分段:固定模板段、团队段、生成的执行环境段,最后是
 * 主会话生成的 Policy 段(其后无内容,其变化不扰动其余段)。
 */
export function promptParts(config: PromptConfig, role: SessionRole, environment?: string,
  policy?: { key: string; text: string }): PromptPart[] {
  // 内置段的 key 即其覆盖键;handoff 的键按角色。
  const fixed = (name: string, part = name): PromptPart =>
    ({ name, kind: 'fixed', key: part, text: builtIn(config, part as PartKey) })
  const team = (name: TeamSection): PromptPart => ({ name, kind: 'team', heading: `## ${TEAM_HEADINGS[name]}`,
    text: config[name] ? `## ${TEAM_HEADINGS[name]}\n${config[name]}` : '' })
  return [
    fixed('runtime/shared'), fixed(`runtime/${role}`),
    ...TEAM_SECTIONS.map(team),
    ...['subscriptions', 'replies', role === 'orchestrator' ? 'dispatch' : 'work'].map(name => fixed(`runtime/${name}`)),
    ...role === 'orchestrator' ? [fixed('runtime/admission')] : [],
    fixed('runtime/handoff', `runtime/handoff/${role}`),
    ...environment ? [{ name: 'runtime/environment', kind: 'generated' as const, key: 'runtime/environment', text: environment }] : [],
    ...role === 'orchestrator' && policy ? [{ name: 'runtime/policy', kind: 'generated' as const, ...policy }] : [],
  ].filter(part => part.text)
}

/** 全文组合一个角色的 system prompt(段间以空行连接)。 */
export function composePrompt(config: PromptConfig, role: SessionRole, environment?: string,
  policy?: { key: string; text: string }): string {
  return promptParts(config, role, environment, policy).map(part => part.text).join('\n\n')
}

/** 团队对一件内置件的覆盖:文本,及 `base`——它编辑自的那份内置文本的键(照读到的复制,或省略)。 */
const OverrideSchema = z.object({ text: z.string(),
  base: z.string().optional().describe('编辑自的内置文本键;照读到的复制,或省略。') }).strict()
/**
 * 一份 prompt 配置:团队段、团队 skill 与对内置件的 overrides;其 overrides 可能点名一个
 * 后续版本不再有的件——`Prompts.validate` 在保存版持有它时静默脱落,否则拒收。
 */
export const PromptConfigSchema = z.object({ communication: z.string(), scope: z.string(), delivery: z.string(),
  skills: z.record(z.string().regex(SKILL_NAME), z.string()),
  overrides: z.record(z.string(), OverrideSchema).optional()
    .describe('按覆盖键替换一件内置件的文本;未点名的件随其内置文本。') }).strict()
export type PromptConfig = z.infer<typeof PromptConfigSchema>
/** 一份 prompt 配置的编号快照(存租户库;revision 0 为首次保存前的内置默认)。 */
export interface PromptVersion { revision: number; previousRevision: number | null; savedAt: string; source: string; config: PromptConfig }
/** 默认配置:团队段空文本(SA prompts/team/*.md 不搬运,35 号 §12-18)、无 skill、无覆盖。 */
export const defaultPrompts = (): PromptConfig => ({ communication: '', scope: '', delivery: '', skills: {} })

/** 一份覆盖件:其内置文本自编辑以来变了(变前文本留存时附上),或其所指件本版本已不存在。 */
export interface DefaultChange { part: string; base?: string; previous?: string; removed?: true }
/** 对着过期的基准修订保存 prompt 配置时的乐观并发冲突(Prompts.save 抛出)。 */
export class PromptConflict extends Error {}

/**
 * 以租户 Store 的编号版本史存储 prompt 配置,并组合双角色的 system prompt 与 skill。
 * 每次模型请求:组合按当前 settings 现算 Policy 段(版本绑定每次请求),`bind` 把该次
 * 请求依据的修订记入该 session 的绑定史;session 可读其活动修订与曾运行过的修订。
 */
export class Prompts {
  private readonly versions: Versions<PromptVersion>
  /** @param maxChars 整份配置(含 overrides)的字符上限(面板可配,SA 同构);默认取 schema 上限。 */
  private readonly store: Store
  private readonly maxChars: () => number
  constructor(store: Store, maxChars: () => number = () => LIMITS.promptMaxChars.max) {
    this.store = store
    this.maxChars = maxChars
    this.versions = new Versions(store, KV.prompts.revision, KV.prompts.version)
  }
  /** 一个角色的 prompt;执行环境段按变量行填充,主会话的 Policy 段按当前 settings 现算——每次模型请求各自组合。 */
  compose(config: PromptConfig, role: SessionRole, variables?: string): string {
    const environment = environmentSection(config, variables)
    return composePrompt(config, role, environment, role === 'orchestrator' ? policySection(this.store.settings(), config) : undefined)
  }
  /** 团队 skill 清单(内置 Source skill 属 A21,随 sources 落地后在此前置)。 */
  skills(config: PromptConfig): [string, string][] {
    return Object.entries(config.skills)
  }
  current(): PromptVersion {
    const revision = this.versions.revision()
    return revision ? this.version(revision) : { revision: 0, previousRevision: null, savedAt: '', source: 'defaults', config: defaultPrompts() }
  }
  /** 按号读一份修订;修订 0 在首次保存落库前解析为内置默认。 */
  version(revision: number): PromptVersion {
    const version = this.versions.get(revision) ?? (revision === 0 && this.versions.revision() === 0 ? this.current() : undefined)
    if (!version) throw new UserError('unknownPromptRevision', { revision: String(revision) })
    return version
  }
  /**
   * 解析一份配置:覆盖件点名一件内置件、持有文本并保留其模板的占位符,且记录它编辑自的
   * 内置文本(保存版覆盖件除非自带,否则沿用其 base;再否则取当前内置文本的键)。文本回到
   * 与内置文本相等时该覆盖件脱落,本版本不再有的件——保存版持有的——也脱落。
   */
  validate(value: unknown): PromptConfig {
    const { overrides, ...config } = PromptConfigSchema.parse(value)
    const saved = this.current().config.overrides ?? {}
    const kept = Object.entries(overrides ?? {}).flatMap(([name, override]) => {
      const part = builtInPart(name)
      if (!part && Object.hasOwn(saved, name)) return []
      if (!part) throw new UserError('unknownPromptPart', { part: name })
      if (!override.text.trim()) throw new UserError('promptPartEmpty', { part: name })
      const missing = (part.placeholders ?? []).filter(placeholder => !override.text.includes(placeholder))
      if (missing.length) throw new UserError('promptPlaceholders', { part: name, placeholders: missing.join(', ') })
      const savedBase = Object.hasOwn(saved, name) ? saved[name]?.base : undefined
      const base = override.base ?? savedBase ?? builtInBase(part.text)
      return override.text === part.text ? [] : [[name, { text: override.text, base }] as const]
    })
    const result: PromptConfig = { ...config, ...kept.length ? { overrides: Object.fromEntries(kept) } : {} }
    const limit = this.maxChars()
    if (JSON.stringify(result).length > limit) throw new UserError('promptTooLong', { limit: String(limit) })
    return result
  }
  /**
   * 其内置件自团队编辑以来变了的覆盖件(按其 base 判定),各附该 base 的内置文本(本安装
   * 留存过时),及所指件本版本已不存在的覆盖件——升级永不改写团队文本,变更只在此列出。
   */
  defaultChanged(config: PromptConfig): DefaultChange[] {
    return Object.entries(config.overrides ?? {}).flatMap(([part, { base }]): DefaultChange[] => {
      const now = builtInPart(part)
      if (!now) return [{ part, ...base === undefined ? {} : { base }, removed: true as const }]
      if (base === undefined || base === builtInBase(now.text)) return []
      const previous = this.store.get(KV.prompts.builtIn(base))
      return [{ part, base, ...previous === undefined ? {} : { previous } }]
    })
  }
  /** 校验并预览一份配置:双角色的全文与分段、skill 清单,及配置的作用域说明。 */
  preview(value: unknown) {
    const config = this.validate(value)
    const policy = policySection(this.store.settings(), config)
    const environment = environmentSection(config, undefined)
    return { orchestrator: composePrompt(config, 'orchestrator', environment, policy), worker: composePrompt(config, 'worker', environment),
      parts: { orchestrator: promptParts(config, 'orchestrator', environment, policy), worker: promptParts(config, 'worker', environment) },
      skills: Object.fromEntries(this.skills(config)),
      scope: '团队段、团队 skill 与对内置件的覆盖;未覆盖的件随其内置文本。worker 另继承宿主 prompt 与仓库 AGENTS.md。改 prompt 文本只改变对 agent 的告知,不改变 @eterna/tasks 的允许面:工具权限、门禁与账号包装不变。' }
  }
  /** 校验并保存为新修订;对着过期的 baseRevision 抛 PromptConflict(乐观并发)。 */
  save(value: unknown, baseRevision: number, source: string): PromptVersion {
    const config = this.validate(value)
    return this.store.atomic(() => {
      const previous = this.current()
      if (previous.revision !== baseRevision) throw new PromptConflict(`Prompt 版本已变更为 ${previous.revision};保存前先比对最新版本`)
      // 首次自定义修订落库前,先把内置默认存为修订 0。
      if (previous.revision === 0 && !this.versions.get(0)) this.versions.keep(previous)
      // 各覆盖件编辑自的内置文本留档,升级时展示它变了什么。
      for (const [part, { base }] of Object.entries(config.overrides ?? {})) {
        const text = builtInParts()[part as PartKey].text
        if (base === builtInBase(text) && this.store.get(KV.prompts.builtIn(base)) === undefined)
          this.store.set(KV.prompts.builtIn(base), text)
      }
      return this.versions.save(revision => ({ revision, previousRevision: previous.revision,
        savedAt: new Date().toISOString(), source, config }))
    })
  }
  /** 修订史(倒序),各份与其前一份逐键对比出变更面;分页以 next_offset 收尾。 */
  history(offset = 0, limit = 20) {
    const current = this.current()
    const revisions = Array.from({ length: Math.min(limit, Math.max(0, current.revision + 1 - offset)) }, (_, i) => {
      const version = current.revision - offset - i === 0 && current.revision === 0 ? current : this.version(current.revision - offset - i)
      const { config, ...summary } = version
      const previous = version.previousRevision === null ? undefined : this.versions.get(version.previousRevision)?.config
      const entries = (value: PromptConfig) => ({ communication: value.communication, scope: value.scope, delivery: value.delivery,
        ...Object.fromEntries(Object.entries(value.skills).map(([name, text]) => ['skill/' + name, text])),
        // 覆盖件随其文本或其编辑自的内置文本变化而变化。
        ...Object.fromEntries(Object.entries(value.overrides ?? {}).map(([part, override]) => [part, JSON.stringify(override)])) })
      const before = previous ? entries(previous) : {}
      const after = entries(config)
      const compare = before as Record<string, string>, filled = after as Record<string, string>
      const changed = previous
        ? [...new Set([...Object.keys(before), ...Object.keys(after)])].filter(name => compare[name] !== filled[name]) : []
      return { ...summary, changed }
    })
    return { revisions, next_offset: offset + revisions.length <= current.revision ? offset + revisions.length : null }
  }
  /**
   * 版本绑定每次模型请求(24 §8.1-4):把该次请求依据的当前修订记入 session 的绑定史
   * (与上次相同则不重复记);返回本次绑定的修订号。装配层(A16)在每次模型请求前调用。
   */
  bind(sessionId: string): number {
    const revision = this.current().revision
    const bound = this.store.get(KV.prompts.binding(sessionId)) ?? []
    if (bound.at(-1) === revision) return revision
    this.store.set(KV.prompts.binding(sessionId), [...bound, revision])
    return revision
  }
  /** 某 session 最近一次绑定的修订号;尚未绑定时 undefined。 */
  boundRevision(sessionId: string): number | undefined {
    return this.store.get(KV.prompts.binding(sessionId))?.at(-1)
  }
  /** 某 session 运行所依据的 prompt 版本:其最近绑定的修订,否则当前版本。 */
  boundVersion(sessionId: string): PromptVersion {
    const revision = this.boundRevision(sessionId)
    return revision === undefined ? this.current() : this.version(revision)
  }
  /** 某 session 是否被授权读取该修订:其活动修订,或它曾运行过的任一修订。 */
  ranUnder(sessionId: string, revision: number): boolean {
    const bound = this.store.get(KV.prompts.binding(sessionId)) ?? []
    return revision === this.current().revision || bound.includes(revision)
  }
}
