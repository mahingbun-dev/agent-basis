/**
 * worker 工具面——worker(Executor)Session 的 6 个工具:读其工单、确认、线程管理与汇报
 * (35 号 A20;34 号 §2.5 tools 行「worker 6 工具面(report/handback/mark_unrelated…)」、
 * §1 tools 两行)。
 *
 * 设计依据:24 号 §2.4(worker 6 工具,拥有实现——实现本身经 worker session 的宿主工具
 * (bash/edit 等)发生,本面只管汇报与协作面)、§5.1(worker 只报六态、不直接与人对话,
 * 问题只走 Attention)、§5.5-R5(Attention 显式化);28 号 §1.1(报告摘要 ≤600 字符)。
 * 工具清单与 SA executorTools 一一对应(6 个):orchestrator_read / ack / thread_unrelated /
 * thread_follow / trigger_handback / report。角色分面:worker 只拿到本数组,断言在
 * tests/tools.spec.ts(34 号 §4-D tools 行「角色分面」)。
 *
 * ★本仓改造:
 * - report 的 `pr_number` 字段不搬:认领 Source PR 的 claimPull/readPull 属 SA GitHub Source
 *   实现(24 号 §8.2 不采纳;PR 生命周期绑定走 A21 Source 扩展钩子 threadClosed,34 号
 *   §2.5 channel-adapter 行);R2 的 ready 门禁挂 executor/gates.ts(35 号 A15,已另行落地),
 *   不在工具面;
 * - thread_follow 的主会话告知(SA sessions.notify threadFollowedNotice)不移植(通知机制
 *   并入装配,A24 承接);relay 汇报经 host.relay(resultRelay 幂等 id,35 号 A14 同源)。
 */
import { z } from 'zod'
import { liveTicket, type EngineForExecutor, type Ticket } from '../core/index.ts'
import type { Outbox } from '../effects/outbox.ts'
import type { Store } from '../store/store.ts'
import { resultRelay } from '../executor/dsh.ts'
import { readResource, type ResourceHost } from './resources.ts'
import { IM_WORDS, readTool, tool, wordCount, type Tool } from './tool.ts'

/** worker 工具面的宿主依赖(EngineForExecutor 的 worker 半边,34 号 §3)。 */
export interface WorkerToolsHost {
  /** worker 请求 Engine 的面:report/reply/markUnrelated/handback/followForContext。 */
  readonly engine: Pick<EngineForExecutor, 'report' | 'reply' | 'markUnrelated' | 'handback' | 'followForContext'>
  /** 租户库面:工单状态复查与回执状态读。 */
  readonly store: Pick<Store, 'tickets' | 'replyStatus'>
  /** 回执出站面(ack 排队后 flush 至静止)。 */
  readonly outbox: Pick<Outbox, 'status' | 'sent'>
  /** 读取面资源宿主(resources.ts;worker 只可读其自己工单的子树)。 */
  readonly resources: ResourceHost
  /** 汇报到主会话的 relay(幂等 id 由 resultRelay 派生;经装配面的 relay 队列投递)。 */
  relay(requestId: string, text: string): void
}

/**
 * worker 的 6 个工具,绑定其工单(SA executorTools(host, ticket) 同构——工具面随 worker
 * session 建立时装入,装配点在 executor(★A22 接线);分面纪律:这些工具不出现在主会话面)。
 */
export function workerTools(host: WorkerToolsHost, ticket: Ticket): Tool[] {
  const ticketId = ticket.id
  return [
    readTool('读 resource 参数列出的本工单的一页资源;跟随 next_offset,页面点名 next_resource 时读它。R4 产物经 ticket/<id>/files 列出、ticket/<id>/file/<path> 读全文——读文件,不要凭记忆汇报。',
      true, (resource, offset, limit, signal) => readResource(host.resources, resource, offset, limit, ticketId, signal)),
    tool({
      name: 'orchestrator_ack',
      description: '在实质开工前确认一条原始的人的请求,如 replies 段所说;它作为对那条消息的回复发出。',
      schema: z.object({
        trigger_id: z.string().describe('要确认的原始人消息的 trigger id'),
        text: z.string().trim().min(1).refine(text => wordCount(text) <= IM_WORDS, `至多 ${IM_WORDS} 词(中文按词);写一句短话。`).describe(`至多 ${IM_WORDS} 词;支持 Markdown。`),
      }).strict(),
      execute: async (args) => {
        const reply = host.engine.reply({ purpose: 'acknowledgement', ticketId, triggerId: args.trigger_id, text: args.text })
        if (reply.status !== 'sent') await host.outbox.sent()
        return { trigger_id: args.trigger_id, acknowledgement: host.store.replyStatus(reply.id) ?? reply.status, reused: reply.reused }
      },
    }),
    tool({
      name: 'orchestrator_thread_unrelated',
      description: '停止跟随一条与本工单无关的已 attach 线程,如 work 段所说;工单自己的线程不能由它丢弃。',
      schema: z.object({
        thread: z.string().min(1).describe('线程键;trigger/<id> 的 thread 字段显示它,如 feishu:<chat>:<root> 或 github:<number>。'),
        reason: z.string().trim().min(1).max(300).describe('一句话说明该线程为何与本工单无关。'),
      }).strict(),
      execute: (args) => {
        host.engine.markUnrelated(ticketId, args.thread, args.reason)
        return Promise.resolve({ removed: true, thread: args.thread })
      },
    }),
    tool({
      name: 'orchestrator_thread_follow',
      description: '为仅读上下文跟随一条相关线程,如一个 Issue 或另一条 PR;它不授予任何权力。',
      schema: z.object({
        thread: z.string().describe('线程键,如 github:<number>。'),
        reason: z.string().trim().min(1).max(300).describe('一句话说明它与本工单的关系。'),
      }).strict(),
      execute: (args) => {
        // 线程键必须形如 <source>:<id>(SA 同构校验)。
        const at = args.thread.indexOf(':')
        if (at < 1 || at === args.thread.length - 1) return Promise.reject(new Error('线程键形如 <source>:<id>,如 github:<number>'))
        const followed = host.engine.followForContext(ticketId, { source: args.thread.slice(0, at), id: args.thread.slice(at + 1) })
        return Promise.resolve({ followed, thread: args.thread })
      },
    }),
    tool({
      name: 'orchestrator_trigger_handback',
      description: '把一条请求超出本工单(或属于别的工单)的消息交回,做一次全新评估;每条消息至多交回一次。另一张工单仍在裁决它时 queued 为 false;从未属于本工单的消息(如 bot 的)也返回 false,它不经本工单即被评估。',
      schema: z.object({
        trigger_id: z.string().min(1).describe('要交回的消息 id'),
        reason: z.string().trim().min(1).max(300).describe('一句话说明它请求了本工单之外的什么。'),
      }).strict(),
      execute: args => Promise.resolve({ trigger_id: args.trigger_id,
        queued: host.engine.handback(ticketId, args.trigger_id, args.reason) }),
    }),
    tool({
      name: 'orchestrator_report',
      description: '汇报六态之一(progress/waiting/ready/blocked/failed/dropped),如 work 与 handoff 段所说。给人的问题只走 human_action(Attention);ready 只在 R2 门禁通过后报(结构产物在 .ticket/<id>/ 下,worker 自述不构成 ready)。绝不直接与人对话。',
      schema: z.object({
        state: z.enum(['progress', 'waiting', 'ready', 'blocked', 'failed', 'dropped']).describe('六态汇报'),
        summary: z.string().min(1).describe('一段汇报摘要;relay 中截断为 600 字符(28 号 §1.1)。'),
        human_action: z.string().trim().min(1).max(1000).nullish().describe('给人的一个具体问题(progress 亦可带);省略即保留现行问题,null 清除它。'),
        question_for_trigger_id: z.string().optional().describe('带 human_action 时:提出该问题的人的消息;问题回到那个人写下之处。'),
        reply_to_trigger_id: z.string().optional().describe('本报告所答复的那条人的显式提问;普通进度不用。'),
      }).strict(),
      execute: (args, signal) => {
        signal.throwIfAborted()
        const current = host.store.tickets.get(ticketId)
        if (!current || !liveTicket(current)) return Promise.reject(new Error('工单已结束(PR 已关闭或工作已完成);不要恢复它'))
        const report = { state: args.state, summary: args.summary,
          ...(args.human_action !== undefined && args.human_action !== null ? { question: args.human_action } : {}),
          ...(args.question_for_trigger_id ? { askedBy: args.question_for_trigger_id } : {}),
          ...(args.reply_to_trigger_id ? { answers: args.reply_to_trigger_id } : {}) }
        const updated = host.engine.report(ticketId, report)
        // 汇报 relay 给主会话(幂等 id 由工单与报告内容派生;同一结论不重发——35 号 A14 resultRelay)。
        const relay = resultRelay(updated, args.state, args.summary)
        host.relay(relay.id, relay.text)
        return Promise.resolve({ reported: true, read: `ticket/${ticketId}/result`,
          ...(updated.attention ? { attention: updated.attention } : {}) })
      },
    }),
  ]
}
