/**
 * Agent 工具面的会话 → 调用者路由(多租户分库身份解析)。
 *
 * 与 glue knowledge-plugin 的 routing 口径逐条对齐(本模块即其迁入件):
 * - `mode='auto'`(缺省):access 库缺席(本地 TUI)或会话上下文缺席 → 全局库身份;
 *   身份源在场则按会话解析,解析失败 fail-closed(绝不退回全局库);
 * - `mode='per-account'`:显式多租户——身份源缺席/会话不可归属一律 `undefined`;
 * - `mode='global'`:关闭路由,恒全局库身份。
 *
 * 身份投影(`human:false` = Agent 通道;审批/直接发布只认 access 守卫铸出的 `human:true`)。
 */
import { existsSync } from 'node:fs'
import type { ToolRunContext } from '@deepseek-ai/dsh-tools'
import type { AccessDirectory } from './access-db.ts'
import type { KnowledgeAdminCaller } from './types.ts'

/** 路由模式(与 glue KnowledgeRoutingConfig.mode 同值域)。 */
export type KnowledgeRoutingMode = 'auto' | 'per-account' | 'global'

/** 无身份源/本地单用户形态的调用者投影:全局库视角、Agent 通道。 */
export const GLOBAL_TOOL_CALLER: KnowledgeAdminCaller = { account: '*', admin: true, human: false, userId: 0 }

/** 工具运行上下文里的会话身份(memory stampProvenance 同口径:session.id → agent.id)。 */
export function sessionIdOf(exec: ToolRunContext | undefined): string | undefined {
  const agent = exec?.agent as { readonly id?: unknown; readonly session?: { readonly id?: unknown } } | undefined
  const id = agent?.session?.id ?? agent?.id
  return typeof id === 'string' && id !== '' ? id : undefined
}

/** 会话 → 调用者解析面(工具执行器每次调用取一次;无状态)。 */
export interface KnowledgeCallerRouter {
  readonly mode: KnowledgeRoutingMode
  readonly accessDbPath: string
  /** 解析失败 → undefined(调用方 fail-closed)。 */
  resolveSession(sessionId: string | undefined): KnowledgeAdminCaller | undefined
  /** 工具执行器便利入口(从 exec 取 session id)。 */
  resolveExec(exec: ToolRunContext | undefined): KnowledgeAdminCaller | undefined
  accountOfUser(userId: number): string | undefined
}

export function createKnowledgeCallerRouter(options: {
  readonly mode?: KnowledgeRoutingMode | undefined
  readonly access: AccessDirectory
}): KnowledgeCallerRouter {
  const mode = options.mode ?? 'auto'
  const { access } = options
  const globalCaller = (): KnowledgeAdminCaller => ({ ...GLOBAL_TOOL_CALLER })
  const resolveSession = (sessionId: string | undefined): KnowledgeAdminCaller | undefined => {
    if (mode === 'global') return globalCaller()
    if (mode === 'auto' && (sessionId === undefined || !access.available)) return globalCaller()
    if (sessionId === undefined) return undefined
    const userId = access.sessionOwner(sessionId)
    if (userId === undefined) return undefined
    const user = access.userById(userId)
    if (user === undefined) return undefined
    return { account: user.account, admin: user.role === 'admin', human: false, userId }
  }
  return {
    mode,
    accessDbPath: access.dbPath,
    resolveSession,
    resolveExec: exec => resolveSession(sessionIdOf(exec)),
    accountOfUser: userId => access.accountOfUser(userId),
  }
}

/** 路径判据(仅测试/诊断面;运行期路由不走它,避免与 AccessDirectory.available 漂移)。 */
export function accessDbExists(path: string): boolean {
  return existsSync(path)
}
