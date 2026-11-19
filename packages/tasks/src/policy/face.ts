/**
 * 任务设置面(TasksWorld.settingsFace;2026-11-19 会话级 super 标记 + 任务设置分区):
 * 管理面板(access 路由面,`/access/api/tasks/*`)与未来其它宿主面消费的**唯一设置读写缝**。
 *
 * 设计纪律:
 * - 写路径只经 `saveSettingsBlock`(分块 CAS + 版本史 + policyChanged 原子面,见 save.ts),
 *   本文件不重造保存语义——面板/工具/glue 三条入口共用同一原语(34 号 §4-G settings 行);
 * - 跨层不抛异常类:conflict/invalid 以结果 union 返回(access 为 Tier1 不 import 本包,
 *   结构化面见 access/routes.ts TasksSettingsFace),调用方只做 HTTP 映射;
 * - read/roles 是纯读投影(`store.settings()` + `blockRevision` + health/stats),不写库;
 * - roles 只暴露会话角色判定所需的 id 集(登录用户可见;设置视图另走 admin 路由)。
 */
import { ZodError } from 'zod'
import type { TasksHealth, TasksStats } from '../plugin.ts'
import type { Settings, SettingsSave } from './settings.ts'
import { SettingsConflict, saveSettingsBlock, type JointSides, type PolicySaveHost } from './save.ts'
import { policyVersion } from './version.ts'

/** 设置视图(管理面板读面;settings 为当前快照,revisions 为各块 CAS 基准)。 */
export interface TasksSettingsSnapshot {
  readonly realm: string
  /** orchestrator 主会话 id(未引导 undefined)。 */
  readonly masterId: string | undefined
  /** 主会话标题(部署决策归 glue;约定派生路径的固定标题)。 */
  readonly masterTitle: string
  readonly paused: boolean
  /** 当前策略版本(`wiring.version` 优先,缺省内容 hash)。 */
  readonly policyVersion: string
  readonly settings: Settings
  /** 各可保存块的当前修订(键 = `pause|policy|eval|executor|budget|gates|source:<name>`)。 */
  readonly revisions: Readonly<Record<string, number>>
  /** 开放工单的 worker session id(`worker-<ticketId>`;徽标角色判定用)。 */
  readonly workerSessionIds: readonly string[]
  readonly health: TasksHealth
  readonly stats: TasksStats
}

/** 会话角色读面(登录用户可见;徽标 fail-closed 数据源)。 */
export interface TasksSessionRoles {
  readonly masterId: string | undefined
  readonly masterTitle: string
  readonly workerSessionIds: readonly string[]
}

/** 保存结果:conflict/invalid 为预期业务失败(access 映射 409/400),其余异常仍抛出(500 可观测)。 */
export type TasksSettingsSaveResult =
  | {
    readonly ok: true
    readonly saved: boolean
    /** 本次保存是否改变了策略版本(=是否发了 policyChanged;审计只记布尔)。 */
    readonly changed: boolean
    /** 保存后的块修订(无变化保存返回当前修订)。 */
    readonly revision: number
    readonly settings: Settings
    readonly policyVersion: string
  }
  | { readonly ok: false; readonly code: 'conflict' | 'invalid'; readonly message: string }

/** 设置面(挂在 ctx.tasks 服务上;access 经反射键 'tasks' 结构解析)。 */
export interface TasksSettingsFace {
  /** 当前设置视图 + 修订 + 健康/统计(内核关停后抛出)。 */
  read(): TasksSettingsSnapshot
  /** 会话角色判定面(主会话 id + 开放工单的 worker session id)。 */
  roles(): TasksSessionRoles
  /**
   * 分块保存一份完整 settings。
   * @param block - 保存目标块(分块 CAS 的修订域;`source:<name>` 为来源实例块)。
   * @param value - 完整 Settings(结构校验在 saveSettingsBlock 内统一做)。
   * @param revision - 调用方读到的块修订(过期即 conflict,什么也不存)。
   */
  save(block: SettingsSave, value: unknown, revision: number): TasksSettingsSaveResult
}

/** 设置面装配依赖(createTasks 组参;全部端口注入,便于单测用假件直测)。 */
export interface TasksSettingsFaceDeps {
  /** 分块保存宿主面(save.ts;store/engine/scope/wiring/setVersion)。 */
  readonly host: PolicySaveHost
  readonly realm: string
  /** 主会话 id 现读(引导解析结果;未引导 undefined)。 */
  readonly masterId: () => string | undefined
  readonly masterTitle: string
  readonly health: () => TasksHealth
  readonly stats: () => TasksStats
  /** 开放工单的 worker session id 集(现读;徽标 roles() 与 read() 共用)。 */
  readonly workerSessionIds: () => readonly string[]
  /** 联合 hash 的另两侧内容(glue 注入面;缺省 = tasks 内容 hash,save.ts 可选 sides 口径)。 */
  readonly jointSides?: () => JointSides
}

/** zod 错误 → 中文摘要(路径 + 首条说明;面板只展示一句,避免长表)。 */
function invalidMessage(error: ZodError): string {
  const issue = error.issues[0]
  if (issue === undefined) return '设置不合法：校验失败'
  const path = issue.path.map(String).join('.')
  return path === '' ? `设置不合法：${issue.message}` : `设置不合法（${path}）：${issue.message}`
}

/** 可保存块清单(pause + 六个固定块 + 每个来源实例块;revisions 的投影对象)。 */
export function settingsBlockList(settings: Settings): readonly SettingsSave[] {
  return ['pause', 'policy', 'eval', 'executor', 'budget', 'gates',
    ...Object.keys(settings.sources).map((name): SettingsSave => `source:${name}`)]
}

/**
 * 设置面工厂(纯组参;createTasks 装配与单测共用)。
 * @param deps - 装配依赖(上)。
 * @returns 设置面(read/roles/save)。
 */
export function createTasksSettingsFace(deps: TasksSettingsFaceDeps): TasksSettingsFace {
  const workerSessionIds = (): readonly string[] => [...deps.workerSessionIds()]
  const roles = (): TasksSessionRoles => ({
    masterId: deps.masterId(),
    masterTitle: deps.masterTitle,
    workerSessionIds: workerSessionIds(),
  })
  return {
    read: (): TasksSettingsSnapshot => {
      const settings = deps.host.store.settings()
      const revisions: Record<string, number> = {}
      for (const block of settingsBlockList(settings)) revisions[block] = deps.host.store.blockRevision(block)
      return {
        realm: deps.realm,
        masterId: deps.masterId(),
        masterTitle: deps.masterTitle,
        paused: settings.paused,
        policyVersion: deps.host.wiring().version ?? policyVersion(settings),
        settings,
        revisions,
        workerSessionIds: workerSessionIds(),
        health: deps.health(),
        stats: deps.stats(),
      }
    },
    roles,
    save: (block, value, revision): TasksSettingsSaveResult => {
      try {
        const sides = deps.jointSides?.()
        const outcome = saveSettingsBlock(deps.host, block, value, revision, 'panel', sides)
        return {
          ok: true, saved: outcome.saved, changed: outcome.changed, revision: outcome.revision,
          settings: outcome.settings, policyVersion: outcome.to,
        }
      } catch (error) {
        if (error instanceof SettingsConflict) return { ok: false, code: 'conflict', message: '设置已被其他保存更新，请重新加载' }
        if (error instanceof ZodError) return { ok: false, code: 'invalid', message: invalidMessage(error) }
        throw error instanceof Error ? error : new Error(String(error))
      }
    },
  }
}
