/**
 * 事件 → 快照的纯函数投影(38 号 G-11:事件归并为不可变消息、纯函数投影、
 * 引用不变则跳过重绘)。Host 半边(dev mock 服务)与浏览器半边(面板页)
 * 共用同一 reducer,保证服务端续推的快照与客户端渐进应用的快照逐字段一致
 * (F-14:图状态不因重连错乱;重放幂等由调用侧按 seq 去重,本层只做应用)。
 */
import type { WorkbenchSnapshot, WorkbenchStreamEvent } from '../types.ts'

/**
 * 应用一个流事件,返回新快照(不可变;未命中任何工单/未知 kind 原样返回,
 * 引用不变调用方可跳过重绘)。
 */
export function applyWorkbenchEvent(snapshot: WorkbenchSnapshot, event: WorkbenchStreamEvent): WorkbenchSnapshot {
  switch (event.kind) {
    case 'snapshot':
      return event.snapshot
    case 'ticket-moved': {
      const hit = snapshot.tickets.some(ticket => ticket.id === event.ticketId)
      if (!hit) return snapshot
      const tickets = snapshot.tickets.map((ticket) => {
        if (ticket.id !== event.ticketId) return ticket
        return { ...ticket, column: event.column, metaLine: event.metaLine }
      })
      return { ...snapshot, tickets }
    }
    case 'log-appended':
      return { ...snapshot, logs: [...snapshot.logs, event.entry] }
    case 'eval-run': {
      const trend = [...snapshot.eval.trend, event.passRate]
      const previous = snapshot.eval.trend[snapshot.eval.trend.length - 1]
      const delta = previous === undefined ? 0 : event.passRate - previous
      return {
        ...snapshot,
        eval: {
          ...snapshot.eval,
          trend,
          weeklyRuns: snapshot.eval.weeklyRuns + 1,
          passDelta: Math.round(delta * 10) / 10,
        },
      }
    }
    case 'worker-updated':
      // 检查器活况整节替换(W-4 上游 session/jobs 事件面;幂等)
      return { ...snapshot, worker: event.worker }
    // ── M4 实接增量(38 号 T15;整节替换,幂等)──────────────────────────
    case 'tickets-updated':
      // 看板工单全集替换:引擎为唯一真值源,ticket.ended 等增减也经此面到达
      return { ...snapshot, tickets: event.tickets }
    case 'flow-updated':
      return { ...snapshot, flow: event.flow }
    case 'conflict-updated':
      return { ...snapshot, conflict: event.conflict }
    case 'eval-updated':
      // 评测监控整节替换(dsh-evals 结果/observe 漂移文件刷新;不经 eval-run 追点语义)
      return { ...snapshot, eval: event.eval }
  }
}
