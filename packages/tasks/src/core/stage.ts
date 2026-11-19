/**
 * 工单阶段分类与重试资格。
 *
 * 设计依据:34 号 §2.1 stage 行;阶段表逐行对齐 SA docs/003-execution.md「Ticket stages」
 * (自上而下读,第一匹配行胜出);逐行断言在 tests/stage.spec.ts(35 号 A3 验收门禁)。
 * 消费方:30 号 §2 工作监控看板按 person(各 action)、working、idle、ended 分组(数据面;渲染归 WS-D)。
 */
import { latestAssignment, waitsForPerson, type Ticket } from './model.ts'

/** 工单的高层执行阶段:等人(person,附具体动作)、工作中(或排队)、轮间空闲(idle)、或已结束。 */
export type TicketStage = { stage: 'person'; action: 'delivery' | 'answer' | 'review' | 'blocked' | 'failed' }
  | { stage: 'working'; action?: 'queued' } | { stage: 'idle' } | { stage: 'ended' }

/** 分类工单阶段;规则按 docs/003 表的行序,第一匹配行胜出。 */
export function ticketStage(ticket: Ticket): TicketStage {
  if (ticket.ended) return { stage: 'ended' }
  if (ticket.delivery) return { stage: 'person', action: 'delivery' }
  if (ticket.attention) return { stage: 'person', action: 'answer' }
  const assignment = latestAssignment(ticket)
  const report = assignment?.report?.state
  if (report === 'ready') return { stage: 'person', action: 'review' }
  // blocked/failed 报告之后的人消息把工单交还 executor(见 waitsForPerson),落到下一匹配行。
  if ((report === 'blocked' || report === 'failed') && waitsForPerson(ticket)) return { stage: 'person', action: report }
  if (!assignment || assignment.state === 'pending') return { stage: 'working', action: 'queued' }
  if (report === 'waiting' || assignment.state === 'ended') return { stage: 'idle' }
  return { stage: 'working' }
}

/** 开放工单是否卡在 blocked/failed 报告且其后无人消息,或 Input 投递失败——两种情况一次重试可解。 */
export function canRetry(ticket: Ticket): boolean {
  return !ticket.ended && (waitsForPerson(ticket) || !!ticket.delivery)
}
