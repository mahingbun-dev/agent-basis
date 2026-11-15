/**
 * Pressure-gated stale tool-result clearing (L2): deterministic, model-free
 * whole-node replacement of older turn-groups' successful text tool results
 * with a short placeholder. Sits between the character-budget head/tail pruner
 * (`@eterna/compaction/pruner-plugin`, L1 单条大小) and full summarization
 * (L3) on the layered compaction ladder（20 号 §6 P1-1）.
 *
 * 事件读法（2026-11-15 决策修订，原 S'-1 保守方案见 git 历史）：上游
 * `eventAt`/`snapshotEvents`/`ownEvents` 已 @deprecated（dsh-session 0.2.2-alpha.2
 * lib/types/index.d.ts:212-235），本模块主读法仍是构造器 `session/event` 订阅
 * 自建 tracker（post-commit append feed，dsh-session index.d.ts:63）。已知限制
 * 的解除（评审 P1-6，2026-11-15）：seed 事件不经 `session/event` 发布
 * （resume/fork 历史不可见，dsh-session index.d.ts:163-165）曾使恢复会话的
 * 历史 tool/result 永不进 L2——对长生命周期 agent 实效收窄过大，经决策改为
 * `rescanSurface()` 在 pre-step 压力评估时补扫一次（`eventAt` 存量豁免照
 * pruner/index.ts:137-143 先例；无 deprecated-free 替代读法：surface 只给
 * seq，`deriveEventMessage` 需要事件对象）。豁免逻辑不变：失败证据、富块、
 * 最近 keepGroups 组一律不动——保守少剪的方向保持。
 *
 * 协议与 pruner 完全一致（pruner/index.ts:147-180）：per 候选先 append
 * `compaction/prune` shadow-price 事件（shadowedTokenCount=原文价），再 append
 * `tool/result` 同 data 换占位 content + `surfaceOp:{op:'replace',startSeq,endSeq}`
 * + `sourceEventSeqs:[seq]`。单节点原子替换：无需 compaction/start|end 锁、无
 * LLM；append 串行天然互斥（若实测与并发压缩冲突，退路＝挂进 basic 的
 * compactPressure 头部调用，见 22 号 §4-C6 触发节）。
 *
 * @module @eterna/compaction/stale
 */

import { Context, Service } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { freezeMessage } from '@deepseek-ai/dsh-llm'
import type { ContentBlock, ToolResultMessage } from '@deepseek-ai/dsh-llm'
import type { Session, SessionEvent, SessionSeq } from '@deepseek-ai/dsh-session'
import type { Agent } from '@deepseek-ai/dsh-agent'
// Type-only: the `compaction/*` SessionEventMap merges (the shadow-price event).
import type {} from '@deepseek-ai/dsh-compaction'
// Type-only: the `ctx.tokenMeter` Context merge for the declared injection.
import type {} from '@deepseek-ai/dsh-token-meter'
import { DEFAULTS, resolveStaleConfig, STALE_PRUNE_MARKER } from './config.ts'
import type {
  ResolvedStaleConfig,
  StalePruneConfig,
  StalePrunedEntry,
  StalePruneResult,
} from './types.ts'

export { DEFAULTS, resolveStaleConfig, STALE_PRUNE_MARKER } from './config.ts'
export type {
  ResolvedStaleConfig,
  StalePruneConfig,
  StalePrunedEntry,
  StalePruneResult,
} from './types.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    staleToolResultPruner?: StaleToolResultPruner
  }
}

/** One tracked surface-live tool result pending the turn-group exemptions. */
interface StaleCandidate {
  readonly seq: SessionSeq
  readonly turn: number
  readonly event: SessionEvent<'tool/result'>
}

/** One priced replacement: everything the landing loop needs, decided upfront. */
interface PricedTarget {
  readonly seq: SessionSeq
  readonly turn: number
  readonly event: SessionEvent<'tool/result'>
  readonly placeholder: ToolResultMessage
  readonly shadowedTokenCount: number
  readonly savings: number
}

/**
 * Deterministic stale tool-result clearing over one pressure-gated pass.
 *
 * The pass prices every candidate before landing anything: a below-floor pass
 * never appends, so the KV-cache prefix mutates once per clearing instead of
 * fragmenting（一次清够，22 号 §4-C6 minSavingsTokens 语义）.
 */
export class StaleToolResultPruner extends Service {
  // The meter gates the pass and prices each shadowed node for its logged
  // shadow-price event, so clearing genuinely requires the pricing capability.
  static inject = ['tokenMeter']

  static Config: z<StalePruneConfig> = z.object({
    keepGroups: z.number().step(1).min(1).default(DEFAULTS.keepGroups),
    minSavingsTokens: z.number().step(1).min(1).default(DEFAULTS.minSavingsTokens),
    thresholdRatio: z.number().min(0).max(1).default(DEFAULTS.thresholdRatio),
  })

  /** Resolved and immutable clearing policy. */
  readonly config: ResolvedStaleConfig

  /**
   * Live tool-result events per session keyed by seq. Fed by the constructor's
   * `session/event` subscription; seed events never publish there, so
   * resumed/forked history is deliberately invisible (module docblock).
   */
  private readonly trackedToolResults = new WeakMap<Session, Map<SessionSeq, SessionEvent<'tool/result'>>>()

  constructor(ctx: Context, config: StalePruneConfig = {}) {
    super(ctx, 'staleToolResultPruner')
    this.config = resolveStaleConfig(config)
    // Constructor-resident listeners: same precedent as the basic engine's
    // five resident listeners (basic/index.ts:149-161).
    ctx.on('session/event', (session, event) => {
      this.trackToolResult(session, event)
    })
    // Trigger ordering vs compaction-basic is a mount concern: the profile
    // line must precede the compaction group so the L2 pass runs before the
    // L3 summarizer prices the same pressure (22 号 §4-C6 触发节；挂载行 Phase 7 落).
    ctx.on('agent/pre-step', async ({ agent, signal }, next) => {
      try {
        if (!signal.aborted) await this.pruneForStep(agent, signal)
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error)
        ctx.logger.warn(`stale tool-result prune failed: ${message}; continuing the turn`)
      }
      return next()
    })
  }

  /** Record one delivered event into the tracker (live appends only). */
  private trackToolResult(session: Session, event: SessionEvent): void {
    if (event.type !== 'tool/result') return
    const tracked = this.trackedToolResults.get(session)
    if (tracked === undefined) {
      this.trackedToolResults.set(session, new Map([[event.seq, event]]))
      return
    }
    tracked.set(event.seq, event)
  }

  /**
   * Resolve the routed model's context window and run one gated pass.
   *
   * contextWindow comes from `ctx.llm.resolveModelInfo`（basic/index.ts:423
   * 先例）: the logged request header carries no context capacity
   * (`LlmCallConfig` lacks the field, dsh-llm call-config.d.ts:23-26), so the
   * spec's synchronous `requestHeader` alternative cannot supply it. No
   * capacity metadata → skip silently（stale 是尽力而为的第一刀，不阻断步进）.
   */
  private async pruneForStep(agent: Agent, signal: AbortSignal): Promise<void> {
    const session = agent.session
    const header = session.requestHeader()
    if (header === undefined) return
    const routed = header.config
    if (routed.provider.length === 0 || routed.model.length === 0) return
    const info = await this.ctx.llm.resolveModelInfo(routed.provider, routed.model, signal)
    if (info.context === undefined) return
    this.rescanSurface(session)
    this.pruneStale(session, info.context.contextWindow)
  }

  /**
   * 补扫当前 surface,把 tracker 缺的历史 tool/result 事件收进候选池(每会话
   * 一次;WeakSet 记账,后续增量仍由 `session/event` 喂入)。resume/fork 的
   * seed 事件不经 `session/event` 发布(dsh-session index.d.ts:163-165),不补扫
   * 则恢复会话的历史 tool/result 永不进 L2(评审 P1-6:对长生命周期 agent
   * 实效收窄过大,2026-11-15 决策解除)。读法循 pruner/index.ts:137-143 的
   * 存量豁免(surface 只给 seq,`deriveEventMessage` 需要事件对象,无
   * deprecated-free 替代);幂等——tracker 是 keyed Map,重 set 无害。
   */
  private rescanSurface(session: Session): void {
    if (this.rescannedSessions.has(session)) return
    this.rescannedSessions.add(session)
    let tracked = this.trackedToolResults.get(session)
    if (tracked === undefined) {
      tracked = new Map()
      this.trackedToolResults.set(session, tracked)
    }
    for (const seq of [...session.surface.nodes]) {
      if (tracked.has(seq)) continue
      // oxlint-disable-next-line typescript/no-deprecated -- 2026-11-15 P1-6 决策:历史失明解除,存量豁免照 pruner/index.ts:137-143 先例(无替代读法)。
      const event = session.eventAt(seq)
      if (event?.type === 'tool/result') tracked.set(seq, event)
    }
  }

  /** 已做过 surface 补扫的会话(每会话一次;增量靠 session/event)。 */
  private readonly rescannedSessions = new WeakSet<Session>()

  /**
   * Clear stale tool results from one stable current-surface snapshot.
   * Each replacement preserves the complete event data except `content` —
   * which becomes the single stale placeholder text block — cites the shadowed
   * node so replay can recover the replacement input, and is immediately
   * preceded by a `compaction/prune` shadow-price event pricing the shadowed
   * node through the injected token meter.
   * @param session - session whose current surface is rewritten.
   * @param contextWindow - the routed model's total context capacity in tokens.
   * @returns landed replacements and projected savings, or `null` when the
   *   pass was gated out（压力未达 / 无候选 / 回收低于下限——都不 append）.
   */
  pruneStale(session: Session, contextWindow: number): StalePruneResult | null {
    const thresholdTokens = Math.floor(contextWindow * this.config.thresholdRatio)
    const measurement = this.ctx.tokenMeter.measure(session)
    if (measurement.totalTokens < thresholdTokens) return null

    const targets = this.priceCandidates(session)
    const savedTokens = targets.reduce((sum, target) => sum + target.savings, 0)
    if (targets.length === 0 || savedTokens < this.config.minSavingsTokens) return null

    const pruned: StalePrunedEntry[] = []
    for (const target of targets) {
      // Shadow-price protocol (pruner/index.ts:157-171): the metering event
      // and its replacement land synchronously adjacent, so pure consumers
      // subtract the shadowed node's price without per-node state.
      session.append('compaction/prune', {
        shadowedRange: { start: target.seq, end: target.seq },
        shadowedSeqs: [target.seq],
        shadowedTokenCount: target.shadowedTokenCount,
      })
      session.append('tool/result', {
        ...target.event.data,
        message: target.placeholder,
      }, {
        surfaceOp: { op: 'replace', startSeq: target.seq, endSeq: target.seq },
        sourceEventSeqs: [target.seq],
      })
      // The shadowed seq left the surface; drop its tracker entry so the map
      // stays aligned with the live surface (harmless either way — candidates
      // re-check surface membership).
      this.trackedToolResults.get(session)?.delete(target.seq)
      pruned.push({
        seq: target.seq,
        turn: target.turn,
        shadowedTokenCount: target.shadowedTokenCount,
      })
    }
    this.ctx.logger.info(
      `stale tool-result prune: cleared ${pruned.length} tool result(s) `
      + `from older turns (~${savedTokens} tokens)`,
    )
    return { pruned, savedTokens }
  }

  /**
   * Snapshot candidates from the tracker, keep surface-live ones, apply the
   * exemptions (failure evidence, rich blocks, newest `keepGroups` turn-groups,
   * zero-yield placeholders), and price each projected replacement.
   * Enumeration order: turn-groups descending, seq ascending within a group.
   */
  private priceCandidates(session: Session): PricedTarget[] {
    const tracked = this.trackedToolResults.get(session)
    if (tracked === undefined) return []
    const surfaceSeqs = new Set(session.surface.nodes)

    const byTurn = new Map<number, StaleCandidate[]>()
    for (const [seq, event] of tracked) {
      // Surface membership first: a seq shadowed by any other writer (L3
      // compaction, the L1 pruner) is gone from the model-visible surface.
      if (!surfaceSeqs.has(seq)) continue
      // Failure evidence is preserved（失败证据保留）: the durable error
      // identity, a flagged failure, and rich-block results all stay verbatim.
      if (event.data.error !== undefined) continue
      const candidate: StaleCandidate = { seq, turn: event.data.turn, event }
      const group = byTurn.get(event.data.turn)
      if (group === undefined) byTurn.set(event.data.turn, [candidate])
      else group.push(candidate)
    }

    const targets: PricedTarget[] = []
    const turns = [...byTurn.keys()].sort((a, b) => b - a)
    for (const [index, turn] of turns.entries()) {
      if (index < this.config.keepGroups) continue
      const group = byTurn.get(turn)
      if (group === undefined) continue
      for (const { seq, event } of group) {
        const original = session.deriveEventMessage(event)
        if (original === null || original.role !== 'tool') continue
        if (original.isError === true) continue
        // Rich-block exemption: only text-only results are cleared（非文本
        // 主导块豁免——含 image 等富块的结果一律不动）.
        if (!original.content.every(block => block.type === 'text')) continue
        const content: ContentBlock[] = [{ type: 'text', text: STALE_PRUNE_MARKER }]
        const placeholder = freezeMessage<ToolResultMessage>({ ...original, content })
        const shadowedTokenCount = this.ctx.tokenMeter.estimateMessage(original)
        const savings = shadowedTokenCount - this.ctx.tokenMeter.estimateMessage(placeholder)
        // A zero-yield candidate (already a placeholder) never re-lands.
        if (savings <= 0) continue
        targets.push({ seq, turn, event, placeholder, shadowedTokenCount, savings })
      }
    }
    return targets
  }
}

export default StaleToolResultPruner
