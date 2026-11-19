/**
 * 工作台「会话」区行投影(2026-11-19 会话级 super 标记):
 * live hub 的快照 `sessions` 恒为空占位(live-hub.ts projectFull,宿主 session 面
 * 未接线);本投影在**客户端**由 `masterSessionId + tickets` 派生主控/执行行,
 * 让工作台会话区可见、可点、可分辨角色,不新增 SSE 词汇、不改内核。
 *
 * 口径:
 * - mock fixture `sessions` 非空时原样返回(渲染测试与 mock 流保留既有会话列表);
 * - 主控行:masterSessionId 在场即一行(id = orchestrator-<realm>,标题固定词汇);
 * - 执行行:非 queued 列(排队工单尚无 worker 会话)一律 `worker-<ticketId>`,
 *   id 约定真值源 = packages/tasks/src/executor/dsh.ts:42 workerSessionId;
 * - 已结束工单不进快照看板(engine-view stageColumn 注释),故执行行天然只覆盖开放工单。
 */
import type { SidebarSession, WorkbenchTicket } from '../types.ts'

export interface WorkbenchSessionsInput {
  /** live 快照会话行(mock fixture 非空;live 恒空)。 */
  readonly sessions: readonly SidebarSession[]
  /** 快照工单(开放工单;ended 不进看板)。 */
  readonly tickets: readonly WorkbenchTicket[]
  /** orchestrator 主会话 id(tasks stats().masterId;未引导 undefined)。 */
  readonly masterSessionId?: string
}

/** 主控行固定标题/渠道词汇(会话区单行文案;角色 chip 再标「主控」)。 */
export const MASTER_SESSION_ROW = { title: '超级智能体主控', channel: '委派入口' } as const

/**
 * 会话区行(纯投影;mock 非空优先回退)。
 * @param input - 快照会话行 + 工单 + 主会话 id。
 * @returns 会话行(主控置首,执行行按工单快照序)。
 */
export function workbenchSessions(input: WorkbenchSessionsInput): readonly SidebarSession[] {
  if (input.sessions.length > 0) return input.sessions
  const rows: SidebarSession[] = []
  if (input.masterSessionId !== undefined) {
    rows.push({ id: input.masterSessionId, ...MASTER_SESSION_ROW, role: 'orchestrator' })
  }
  for (const ticket of input.tickets) {
    if (ticket.column === 'queued') continue
    rows.push({ id: `worker-${ticket.id}`, title: ticket.title, channel: ticket.id, role: 'worker' })
  }
  return rows
}
