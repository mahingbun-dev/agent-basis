/**
 * 分块设置保存与策略同步——A10 接线的组合面(35 号 A10「由 glue 层在热改时重算并调
 * `Engine.policyChanged`」;34 号 §2.2 version 行、§4-G settings 行)。
 *
 * 机制出处:SA src/app/settings.ts `Settings.save`(34 §2.6「runtime 胶水不整体移植、机制按需
 * 重写」)——分块乐观并发(保存前查块修订、原子内再查=CAS 点)、无变化不记修订、版本变才算
 * effects 并通知,全部原样;★本仓改造(C3 拍板,34 §2.2):
 * - 版本面从 SA `policyVersion(settings)` 扩为 **jointPolicyVersion(governance + hitl + tasks)**
 *   联合 hash——`governance`/`hitl` 两侧内容由 glue 层注入(34 §5-governance;计算归属未决前按
 *   glue 层方案实现,35 号 §12-3 开放问题 3:fs watch vs 保存时的触发时机由 glue 装配决定,
 *   本模块承接「保存时」触发路径的两条入口);
 * - 暂停(paused)不进 hash(version.ts 头注:版本只随影响工作授权的内容变化)——pause 块
 *   保存走同一函数,版本不变、不通知(SA pause() 语义:「records nothing for a pause that
 *   changes nothing」)。
 * 两条入口(glue 侧只组参不重造,version.ts:11):
 * - `saveSettingsBlock`:settings 保存路径(面板/工具改动任何块)——版本史落库 + 版本变时通知;
 * - `syncPolicyVersion`:governance rules.yaml / hitl.yaml 热改路径(settings 未变、另两侧内容
 *   变)——只重算联合版本并通知,不产生版本史修订。
 * 保存/同步成功后 glue 须以返回的 `to` 更新其注入的版本(`setVersion` 端口,即
 * `TasksOptions.policyVersion` 的持有方),此后 `settingsPolicy` 的版本面即新联合 hash。
 */
import type { PolicyEffect, Repositories } from '../core/index.ts'
import type { EngineForSettings } from '../core/engine.ts'
import type { SourceScope } from '../core/ports.ts'
import type { SettingsVersion } from '../store/store.ts'
import type { SettingsOrigin, SettingsSave, Settings } from './settings.ts'
import { SettingsSchema } from './settings.ts'
import { policyEffects, type PolicyWiring } from './gate.ts'
import { jointPolicyVersion, policyContent, policyVersion, type JointPolicyParts } from './version.ts'

/**
 * 乐观并发冲突:保存的 `revision` 与存储当前块修订不一致(另一保存先到)——由本模块抛出,
 * 调用方(面板/工具/glue)转译为各自的 409/重读语义(SA SettingsConflict 原样移植)。
 */
export class SettingsConflict extends Error {}

/** 设置存取面(Store 的版本化 settings 子集;结构化端口,不 import store 实例——34 §1 依赖方向行)。 */
export interface PolicySettingsStore {
  /** 当前已校验 settings(=当前修订快照)。 */
  settings(): Settings
  /** 存为下一修订并递增块修订计数(载荷校验属 store 面,SettingsSchema.parse)。 */
  saveSettings(value: unknown, record: Omit<SettingsVersion, 'revision' | 'savedAt' | 'settings'>): Settings
  /** 某配置块的修订号(分块乐观并发的比较对象)。 */
  blockRevision(block: SettingsSave): number
  /** 同步事务(嵌套调用=savepoint,store.ts 语义)。 */
  atomic<T>(work: () => T): T
  /** 开放工单(policyEffects 的计算对象面)。 */
  tickets: Pick<Repositories['tickets'], 'open'>
}

/** 分块保存与策略同步的宿主面(全部经端口注入;glue 只组参,34 §1 依赖方向行、§5-access)。 */
export interface PolicySaveHost {
  /** 设置存取面(上)。 */
  readonly store: PolicySettingsStore
  /** Engine 的 Settings 告知面(EngineForSettings = policyChanged,engine.ts 角色裁剪面)。 */
  readonly engine: EngineForSettings
  /** 各时刻的 SourceScope(随设置给出;与 settingsPolicy/policyEffects 同参)。 */
  readonly scope: (settings: Settings) => SourceScope
  /** 当前 PolicyWiring(名单端口与版本注入面;`version` 即联合 hash 的现值)。 */
  readonly wiring: () => PolicyWiring
  /** 联合版本更新面:保存/同步成功后以新版本更新 glue 持有的注入值(与落库同原子)。 */
  readonly setVersion: (version: string) => void
}

/** 联合 hash 的另两侧内容(glue 注入;tasks 侧由 settings 自算——policyContent)。 */
export type JointSides = Pick<JointPolicyParts, 'governance' | 'hitl'>

/** 联合版本重算的结果(两条入口共用的版本面)。 */
export interface PolicySyncOutcome {
  /** 联合版本 before/after(from = Engine 现用的版本;to = 重算后的联合 hash)。 */
  readonly from: string
  readonly to: string
  /** 版本是否变化(=是否发了 policyChanged)。 */
  readonly changed: boolean
  /** 版本变化时的工单影响面(键 = 受影响工单 id;只通知不撤销;文件热改路径恒为空)。 */
  readonly effects: ReadonlyMap<string, PolicyEffect>
  /** 受影响工单 id(=effects 的键序,版本史 notified 字段的原样载荷)。 */
  readonly notified: readonly string[]
}

/** 一次分块保存的结果(SA Settings.save 返回形的机制子集:无 Source/Setup/会话通知面)。 */
export interface PolicySaveOutcome extends PolicySyncOutcome {
  /** 是否构成一次保存(无变化的重复保存不记新修订,SA 原语义;true 表示请求合法被接受)。 */
  readonly saved: boolean
  /** 保存后的块修订号(冲突抛错时不返回)。 */
  readonly revision: number
  /** 保存后的当前 settings(即本次写入的快照)。 */
  readonly settings: Settings
}

/**
 * 分块保存一份 settings 并同步策略版本(A10 接线;34 §4-G settings 行三判据的机制面):
 * ① **分块乐观并发**——`revision` ≠ 当前块修订即抛 `SettingsConflict`,什么也不存;
 *    原子内再查一次(CAS 点:检查与落库之间的并发保存在此拒绝,SA settings.ts:151/168 两查
 *    的后者);各块修订独立计数(blockRevision),互不使对方失效(SA settings.spec 用例 ①)。
 * ② **版本史落库**——record(source/block/policyVersion/policyChanged/notified)进 settings
 *    版本史(store.ts saveSettings);无变化不记修订(SA「a no-op save records no new revision」)。
 * ③ ★**策略同步触发联合 hash 重算**(C3)——`to` = jointPolicyVersion({governance, hitl,
 *    tasks: policyContent(新设置)});与现版本不同时:policyEffects(开放工单,旧,新) →
 *    `Engine.policyChanged(from, to, effects)`——在跑工单钉旧版、只收 policy-changed 通知,
 *    新规则只影响新工单(27 号 §3.2-④);`setVersion(to)` 与落库同原子。
 * ★联合 sides 可选(2026-11-19 任务设置分区):glue 层尚未注入 governance/hitl 内容时
 * 省略 `sides`,版本面退回 tasks 内容 hash(`policyVersion`,与运行时
 * `wiring.version ?? policyVersion(settings)` 同口径)——否则首次面板保存会把
 * 「内容 hash → 联合 hash」误判成版本变化,给在跑工单发无谓的 policy-changed。
 * sides 在场时保留 A10 原语义:未注入联合版本的装配由本次保存切换到联合版本
 * (settings.spec.ts「未注入联合版本时回落 settings 内容 hash 口径」用例钉住)。
 * @throws SettingsConflict 当 `revision` 已过期(保存前或原子内检出)。
 */
export function saveSettingsBlock(host: PolicySaveHost, block: SettingsSave, value: unknown, revision: number,
  origin: SettingsOrigin, sides?: JointSides): PolicySaveOutcome {
  const stale = (): boolean => revision !== host.store.blockRevision(block)
  if (stale()) throw new SettingsConflict('Settings changed. Reload before saving.')
  const candidate = SettingsSchema.parse(value)
  const old = host.store.settings()
  const current = host.wiring().version ?? policyVersion(old)
  // 无变化不记修订、不算版本(SA settings.ts:172-175;不进 hash 的字段以 JSON 全量比较兜住)。
  if (JSON.stringify(candidate) === JSON.stringify(old)) {
    return { saved: true, revision: host.store.blockRevision(block), settings: old,
      from: current, to: current, changed: false, effects: new Map(), notified: [] }
  }
  const to = sides === undefined
    ? policyVersion(candidate)
    : jointPolicyVersion({ ...sides, tasks: policyContent(candidate) })
  const effects = to === current ? new Map<string, PolicyEffect>()
    : policyEffects(host.store.tickets.open(), old, candidate, host.scope, host.wiring())
  const notified = [...effects.keys()]
  const changed = to !== current
  host.store.atomic(() => {
    if (stale()) throw new SettingsConflict('Settings changed during the checks. Reload before saving.')
    host.store.saveSettings(candidate, { source: origin, block, policyVersion: to, policyChanged: changed, notified })
    if (changed) {
      host.setVersion(to)
      host.engine.policyChanged(current, to, effects)
    }
  })
  return { saved: true, revision: host.store.blockRevision(block), settings: host.store.settings(),
    from: current, to, changed, effects, notified }
}

/**
 * 联合版本重算(governance rules.yaml / hitl.yaml 热改路径;settings 未变):按当前 settings
 * 与注入的另两侧内容重算联合 hash,版本变即 `Engine.policyChanged(from, to, 空 effects)`——
 * 工单不产生 policy-changed Input(tasks 侧规则未变,无 per-工单影响面),但在跑 Eval 在新版本
 * 下重新开始(evals.policyChanged;engine.ts policyChanged 头注语义)。不记版本史修订(设置
 * 未变,SA「no-op records no new revision」);`setVersion(to)` 由调用方在确认后执行。
 */
export function syncPolicyVersion(host: PolicySaveHost, sides: JointSides): PolicySyncOutcome {
  const settings = host.store.settings()
  const from = host.wiring().version ?? policyVersion(settings)
  const to = jointPolicyVersion({ ...sides, tasks: policyContent(settings) })
  if (to === from) return { from, to, changed: false, effects: new Map(), notified: [] }
  host.setVersion(to)
  host.engine.policyChanged(from, to, new Map())
  return { from, to, changed: true, effects: new Map(), notified: [] }
}
