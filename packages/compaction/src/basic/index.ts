/**
 * Basic replay-aware compaction backend.
 *
 * @module @eterna/compaction/basic
 */

import { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { CompactionEngine, ManualCompactionError } from '@deepseek-ai/dsh-compaction'
import type { CompactionResult, CompactionTrigger } from '@deepseek-ai/dsh-compaction'
import type { EpochHeader, Session, SessionSeq } from '@deepseek-ai/dsh-session'
import { CONTEXT_WINDOW_EXCEEDED_CODE, LlmError } from '@deepseek-ai/dsh-llm'
import type { LlmCallConfig } from '@deepseek-ai/dsh-llm'
import { assertNever } from '@deepseek-ai/dsh-util-values'
import type { Agent, PreStepDecision } from '@deepseek-ai/dsh-agent'
import type { CommandId } from '@deepseek-ai/dsh-commands/brand'
// Type-only: makes the optional sibling service available to `ctx.get()`.
// 2026-11-12 fork: 指向本包内的精简后端(它携带 `ctx.toolResultPruner` 的 cordis 声明合并),
// 不再依赖已被本 fork 取代的上游 @deepseek-ai/dsh-compaction-tool-result-pruner。
import type {} from '../pruner/index.ts'
import { DEFAULT_ATTACHMENT_BUDGET } from './attachments.ts'
import {
  resolveCompactSpec,
  resolveConfig,
  resolveTargetPolicy,
  TargetPressureConfigError,
} from './config.ts'
import {
  assertNoActiveCompaction,
  compactSurfaceRegion,
  selectCompactableRange,
} from './region.ts'
import { summarizeWithLlm } from './summarizer.ts'
import type { SummarizationInput, SummaryResult } from './summarizer.ts'
import type {
  BasicCompactionConfig,
  ModelCompactPolicyConfig,
  ResolvedConfig,
} from './types.ts'

export type {
  BasicCompactionConfig,
  CompactionPolicyConfig,
  ModelCompactPolicyConfig,
  ResolvedCompactSpec,
  ResolvedConfig,
  ResolvedRetention,
  ResolvedTargetPolicy,
} from './types.ts'

/** Resolve the exact provider/model durably routed for the latest request. */
function routedTarget(
  session: Session,
): Pick<LlmCallConfig, 'provider' | 'model'> | undefined {
  const config = session.requestHeader()?.config
  if (config === undefined || config.provider.length === 0 || config.model.length === 0) {
    return undefined
  }
  return { provider: config.provider, model: config.model }
}

/**
 * Output tokens the routed request reserves, which the provider charges to the
 * same window as the prompt. The effective envelope's own cap wins; otherwise
 * the adapter's per-request default, which the adapter materializes when that
 * envelope omits one. No declared cap means no reservation.
 */
function reservedCompletionTokens(header: EpochHeader, defaultMaxTokens: number | undefined): number {
  return header.config.maxTokens ?? defaultMaxTokens ?? 0
}

/** Resolve the conversation target used to select an optional policy override. */
function conversationTarget(
  agent: Agent,
): Pick<LlmCallConfig, 'provider' | 'model'> | undefined {
  const routed = routedTarget(agent.session)
  if (routed !== undefined) return routed
  if (agent.options.provider === undefined || agent.options.provider.length === 0
    || agent.options.model === undefined || agent.options.model.length === 0) return undefined
  return { provider: agent.options.provider, model: agent.options.model }
}

const thresholdRatioSchema = z.number()
const headroomTokensSchema = z.number().step(1).min(0)
const retainRatioSchema = z.number()
const retainTokensSchema = z.number().step(1).min(0)
const summarizationProviderSchema = z.string()
const summarizationModelSchema = z.string()
const maxTokensSchema = z.number().step(1).min(1)
const compactionRetriesSchema = z.number().step(1).min(0)
const maxOverflowRetriesSchema = z.number().step(1).min(0)
// 2026-11-14 C11(22 号 §5-C11):checkpoint 附件开关(默认 false)。
const attachmentsSchema = z.boolean()

const modelPolicy: z<ModelCompactPolicyConfig> = z.object({
  provider: z.string().required(),
  model: z.string().required(),
  thresholdRatio: thresholdRatioSchema,
  headroomTokens: headroomTokensSchema,
  retainRatio: retainRatioSchema,
  retainTokens: retainTokensSchema,
  summarizationProvider: summarizationProviderSchema,
  summarizationModel: summarizationModelSchema,
  maxTokens: maxTokensSchema,
  compactionRetries: compactionRetriesSchema,
  maxOverflowRetries: maxOverflowRetriesSchema,
  attachments: attachmentsSchema,
})

/**
 * 2026-11-13 C7(22 号 §4):rapid-refill 熔断的 per-agent 状态,循
 * `overflowRetries` 的 WeakMap<Agent> 先例。
 */
interface RefillState {
  /** 上次压缩成功以来经过的 pre-step 数(每个 auto pre-step 递增,压缩成功归零)。 */
  stepsSinceCompaction: number
  /** 步距窗口内的连续压力触发次数(步距 ≥ REFILL_STEP_WINDOW 时衰减归零)。 */
  rapidStreak: number
}

/**
 * Dependency-light compaction backend using `ctx.tokenMeter` for pressure,
 * retention, cited source events, and summary-convergence pricing.
 *
 * `summarize()` is the sole subclass customization hook; the replay and durable
 * mutation strategy stays fixed so every pricing decision uses the singleton
 * token meter.
 */
export class BasicCompactionEngine extends CompactionEngine {
  static inject = ['llm', 'tokenMeter', 'sessions']

  static Config: z<BasicCompactionConfig> = z.object({
    thresholdRatio: thresholdRatioSchema,
    headroomTokens: headroomTokensSchema,
    retainRatio: retainRatioSchema,
    retainTokens: retainTokensSchema,
    summarizationProvider: summarizationProviderSchema,
    summarizationModel: summarizationModelSchema,
    maxTokens: maxTokensSchema,
    compactionRetries: compactionRetriesSchema,
    maxOverflowRetries: maxOverflowRetriesSchema,
    attachments: attachmentsSchema,
    modelPolicies: z.array(modelPolicy),
    auto: z.boolean(),
  })

  /** Resolved and validated compaction configuration. */
  config: ResolvedConfig

  /**
   * 2026-11-12 fork: patch 层原始配置(不可变基线)。运行时覆盖键(settings 分区
   * 写 $DSH_HOME/.eterna/compaction.config.json)在其上合并重解析。
   */
  private readonly baselineConfig: BasicCompactionConfig

  /** 已套用过的覆盖文件 mtime;变化才重读解析(每次压力评估一次 stat,代价可忽略)。 */
  private appliedOverridesMtimeMs = -1

  private readonly warnedPressureConfigTargets = new Set<string>()
  private readonly overflowRetries = new WeakMap<Agent, number>()
  private readonly overflowAgents = new WeakMap<Session, Agent>()

  // 2026-11-13 C7(22 号 §4):rapid-refill 熔断——压缩后 REFILL_STEP_WINDOW 步内
  // 连续 REFILL_STREAK_LIMIT 次压力触发即跳过本次自动压缩(放行请求),打破
  // "压缩-填满-压缩"烧钱循环。参数为类常量不暴露配置;计数累计进状态文件
  // (rapidRefillCount/lastRapidRefillAt,宿主 admin 端点经 _persistStateFile 读)。
  private static readonly REFILL_STEP_WINDOW = 3
  private static readonly REFILL_STREAK_LIMIT = 3
  private readonly refillStates = new WeakMap<Agent, RefillState>()
  /** 熔断触发累计次数(进程内累计,随 _persistStateFile 快照落盘)。 */
  private rapidRefillCount = 0
  /** 最近一次熔断的 ISO 时间戳(从未触发为 null)。 */
  private lastRapidRefillAt: string | null = null

  constructor(ctx: Context, config: BasicCompactionConfig = {}) {
    super(ctx)
    this.baselineConfig = config
    this.config = resolveConfig(config)
    // 2026-11-12 fork: 覆盖键文件桥——宿主层 admin 端点写 overrides 文件,引擎在
    // 压力评估前按 mtime 热应用(SRC 端点只能宿主层发布,而预设服务不达宿主树,
    // 引擎实例跨不过 realm;详见 admin-plugin.ts 头注)。
    this._applyOverridesFromFile(true)
    // 监听器常驻:调度点内按 this.config.auto 判旗,auto 双向热切换不再依赖
    // 监听器重建(旧实现的成组释放/重建随之废弃)。
    this._registerAutomaticCompaction()
    this._persistStateFile()
  }

  /** 覆盖键文件路径(与宿主 admin 端点共享,DSH_HOME 语义)。 */
  private static overridesPath(): string {
    return join(process.env.DSH_HOME ?? process.cwd(), '.eterna', 'compaction.config.json')
  }

  private static statePath(): string {
    return join(process.env.DSH_HOME ?? process.cwd(), '.eterna', 'compaction.state.json')
  }

  /**
   * 读取并热应用覆盖键文件。mtime 未变直接返回;变化则合并基线重解析,
   * 非法组合回退基线并告警(绝不落半生效状态),并刷新状态文件。
   * @param force - true 时忽略 mtime 缓存(构造期)。
   */
  private _applyOverridesFromFile(force = false): void {
    const path = BasicCompactionEngine.overridesPath()
    let mtimeMs = -1
    try {
      mtimeMs = statSync(path).mtimeMs
    } catch {
      if (!force) return
    }
    if (!force && mtimeMs === this.appliedOverridesMtimeMs) return
    this.appliedOverridesMtimeMs = mtimeMs
    let overrides: Partial<BasicCompactionConfig> = {}
    if (existsSync(path)) {
      try {
        const parsed = JSON.parse(readFileSync(path, 'utf8')) as Partial<BasicCompactionConfig>
        if (typeof parsed.auto === 'boolean') overrides.auto = parsed.auto
        if (typeof parsed.thresholdRatio === 'number' && Number.isFinite(parsed.thresholdRatio)) overrides.thresholdRatio = parsed.thresholdRatio
        if (typeof parsed.retainRatio === 'number' && Number.isFinite(parsed.retainRatio)) overrides.retainRatio = parsed.retainRatio
      } catch {
        overrides = {}
      }
    }
    if (Object.keys(overrides).length === 0 && !force) return
    try {
      this.config = resolveConfig({ ...this.baselineConfig, ...overrides })
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error)
      this.ctx.logger.warn(`compaction overrides invalid, keeping baseline config: ${message}`)
      this.config = resolveConfig(this.baselineConfig)
    }
    this._persistStateFile()
  }

  /** 把当前生效配置写状态文件(宿主 admin 端点的 state() 读这里)。 */
  private _persistStateFile(): void {
    try {
      const dir = join(process.env.DSH_HOME ?? process.cwd(), '.eterna')
      mkdirSync(dir, { recursive: true })
      const {
        thresholdRatio, retainRatio, headroomTokens, maxTokens,
        compactionRetries, maxOverflowRetries, auto, summarizationProvider, summarizationModel,
      } = this.config
      writeFileSync(
        BasicCompactionEngine.statePath(),
        JSON.stringify({
          thresholdRatio,
          retainRatio,
          headroomTokens,
          maxTokens,
          compactionRetries,
          maxOverflowRetries,
          auto,
          // 2026-11-13 C7: rapid-refill 熔断累计观测(写时快照,进程重启从 0 起算——
          // 状态文件沿既有"只写快照"先例,无读回装载)。
          rapidRefillCount: this.rapidRefillCount,
          lastRapidRefillAt: this.lastRapidRefillAt,
          // 2026-11-15 C9 死读修复:admin readSummarizationTarget 从本文件读这两键,
          // 引擎此前不写导致客户端「摘要模型」行永远回落"跟随会话模型"。空串=
          // 未落值(跟随会话模型),admin 侧 pick() 把空串归一为 null。
          summarizationProvider,
          summarizationModel,
        }),
      )
    } catch { /* 状态文件失败不影响压缩本身 */ }
  }

  /**
   * 2026-11-13 C7: 每个 auto pre-step 递增步距计数(熔断窗口的时间轴);压缩成功时
   * 由 compactPressure 归零。auto 关闭/abort 的步不计数——熔断只约束自动压缩。
   */
  private _advanceRefillStep(agent: Agent): void {
    const state = this.refillStates.get(agent)
    if (state === undefined) {
      this.refillStates.set(agent, { stepsSinceCompaction: 1, rapidStreak: 0 })
      return
    }
    state.stepsSinceCompaction += 1
  }

  /**
   * 2026-11-13 C7: pre-step 压力真实触发点(过阈值处)的熔断判定。步距
   * ≥ REFILL_STEP_WINDOW(上次压缩已过去 ≥3 步)连击衰减归零,否则连击 +1;
   * 连击达 REFILL_STREAK_LIMIT 即熔断——记 warn、累计 rapidRefillCount/
   * lastRapidRefillAt 并落状态文件,返回 true 让调用方跳过本次自动压缩
   * (返回 null = 无压缩发生,请求放行,绝不阻断步进)。
   */
  private _enforceRapidRefillBreaker(agent: Agent): boolean {
    const state = this.refillStates.get(agent) ?? { stepsSinceCompaction: 0, rapidStreak: 0 }
    state.rapidStreak = state.stepsSinceCompaction >= BasicCompactionEngine.REFILL_STEP_WINDOW
      ? 0
      : state.rapidStreak + 1
    this.refillStates.set(agent, state)
    if (state.rapidStreak < BasicCompactionEngine.REFILL_STREAK_LIMIT) return false
    this.rapidRefillCount += 1
    this.lastRapidRefillAt = new Date().toISOString()
    this.ctx.logger.warn(
      'rapid-refill breaker: skipping automatic pressure compaction after '
      + `${BasicCompactionEngine.REFILL_STREAK_LIMIT} consecutive pressure triggers within `
      + `${BasicCompactionEngine.REFILL_STEP_WINDOW} step(s) of the last compaction `
      + `(trip #${this.rapidRefillCount}); the request proceeds and manual compaction `
      + 'stays available',
    )
    this._persistStateFile()
    return true
  }

  /** C7: 压缩成功即重置步距(仅步距;连击保留——连续快速回满要跨压缩累计)。 */
  private _resetRefillSteps(agent: Agent): void {
    const state = this.refillStates.get(agent)
    if (state !== undefined) state.stepsSinceCompaction = 0
  }

  /**
   * 2026-11-12 fork: 进程内热更新(保留给同 realm 消费方;设置分区的跨 realm
   * 写面走 overrides 文件 + _applyOverridesFromFile,见构造器注)。
   * @param partial - 覆盖键。
   * @returns 重解析后的完整生效配置。
   */
  updateConfig(partial: Partial<BasicCompactionConfig>): ResolvedConfig {
    const merged: BasicCompactionConfig = { ...this.baselineConfig, ...partial }
    const next = resolveConfig(merged)
    this.config = next
    this._persistStateFile()
    return next
  }

  /**
   * Register between-step pressure, model-switch pressure, and request-overflow
   * recovery. Pre-step and overflow listeners dispatch through `compactIfNeeded`;
   * model switches price the proposed header directly. All summaries use `summarize`.
   */
  private _registerAutomaticCompaction(): void {
    const { ctx } = this
    const logResult = (result: CompactionResult, trigger: string): void => {
      ctx.logger.info(
        `compaction (${trigger}): shadowed ${result.shadowedSeqs.length} surface nodes `
        + `(seqs ${result.shadowedRange.start}-${result.shadowedRange.end}, `
        + `~${result.shadowedTokenCount} tokens)`,
      )
    }

    ctx.on('agent/pre-step', async (
      { agent, signal },
      next,
    ): Promise<PreStepDecision> => {
      this._applyOverridesFromFile()
      if (!signal.aborted && this.config.auto) {
        // 2026-11-13 C7: 步距时间轴先行递增(每个 auto pre-step 一次);触发判定与
        // 跳过在 compactPressure 的压力过阈值点执行(见其 refillBreaker 参数)。
        this._advanceRefillStep(agent)
        try {
          const result = await this.compactIfNeeded(agent, 'pressure', signal)
          if (result !== null) logResult(result, 'step pressure')
        } catch (error: unknown) {
          if (error instanceof TargetPressureConfigError) {
            if (this.warnedPressureConfigTargets.has(error.targetKey)) return next()
            this.warnedPressureConfigTargets.add(error.targetKey)
          }
          const message = error instanceof Error ? error.message : String(error)
          ctx.logger.warn(`step compaction failed: ${message}; continuing the turn`)
        }
      }
      return next()
    })

    ctx.on('agent/status', ({ agent, status }) => {
      if (status === 'idle') this.overflowRetries.delete(agent)
    })

    // Prepend wraps routing listeners: await their final selection while the
    // committed header still identifies the model that can summarize the history.
    ctx.on('agent/request', async ({ agent, signal }, next) => {
      const config = await next()
      const previous = agent.session.requestHeader()
      if (signal.aborted || previous === undefined || config.provider === '' || config.model === ''
        || (previous.config.provider === config.provider && previous.config.model === config.model)) return config
      if (!this.config.auto) return config
      try {
        const header = { ...previous, config }
        const result = await this.compactPressure(agent, header, signal, true)
        if (result !== null) logResult(result, 'model switch')
      } catch (error: unknown) {
        signal.throwIfAborted()
        const message = error instanceof Error ? error.message : String(error)
        throw new LlmError(
          `Cannot switch to ${config.provider}/${config.model}: context compaction failed: ${message}. `
          + 'The previous request model is preserved; retry or select a model with a larger context window.',
          'MODEL_SWITCH_COMPACTION_FAILED',
          { cause: error },
        )
      }
      return config
    }, { prepend: true })

    // A successful response starts a fresh overflow-recovery sequence even
    // when tool calls continue the same turn into another request.
    ctx.on('session/event', (session, event) => {
      if (event.type !== 'assistant/message') return
      const agent = this.overflowAgents.get(session)
      if (agent !== undefined) this.overflowRetries.delete(agent)
    })

    ctx.on('agent/request-error', async (
      { agent, failure, signal },
      next,
    ) => {
      if (failure.code !== CONTEXT_WINDOW_EXCEEDED_CODE || signal.aborted || !this.config.auto) return next()
      this.overflowAgents.set(agent.session, agent)
      const target = routedTarget(agent.session)
      if (target === undefined) return next()
      const policy = resolveTargetPolicy(this.config, target)
      const retries = this.overflowRetries.get(agent) ?? 0
      if (retries >= policy.maxOverflowRetries) return next()

      const generation = agent.session.surface.replaceGeneration
      let result: CompactionResult | null
      try {
        result = await this.compactIfNeeded(agent, 'context-overflow', signal)
      } catch (recoveryError: unknown) {
        const message = recoveryError instanceof Error ? recoveryError.message : String(recoveryError)
        // A model-free prune can land before later summary work fails. That
        // durable reduction is sufficient retry proof; do not discard it just
        // because the optional second phase threw. Cancellation still wins.
        // oxlint-disable-next-line typescript/no-unnecessary-condition -- the signal can abort while recovery is awaited.
        if (!signal.aborted && agent.session.surface.replaceGeneration > generation) {
          ctx.logger.warn(
            `context-overflow compaction failed after durable surface progress: ${message}; `
            + 'retrying from the replacement surface',
          )
          this.overflowRetries.set(agent, retries + 1)
          return { kind: 'retry' }
        }
        ctx.logger.warn(
          // oxlint-disable-next-line typescript/no-unnecessary-condition -- the signal can abort while recovery is awaited.
          `context-overflow compaction failed: ${message}; ${signal.aborted
            ? 'cancellation prevents retry'
            : 'preserving the original request error'}`,
        )
        return next()
      }
      // oxlint-disable-next-line typescript/no-unnecessary-condition -- the signal can abort while compaction is awaited.
      if (signal.aborted
        || agent.session.surface.replaceGeneration <= generation) return next()
      if (result !== null) logResult(result, 'context overflow recovery')
      this.overflowRetries.set(agent, retries + 1)
      return { kind: 'retry' }
    })
  }

  /**
   * Summarize the replayed conversation region through a direct one-shot
   * `ctx.llm.stream()` call whose prefix reuses the conversation's own system
   * prompt, tools, and messages so the provider's KV cache is not invalidated.
   * Override this sole hook for a template or remote summarizer.
   * @param input - replayed conversation prefix (system, tools, and leading messages) to condense.
   * @param agent - supplies routed-model history, fallback model, and session id.
   * @param signal - optional cancellation forwarded to the adapter.
   * @returns safe text summary blocks and the exact auxiliary call envelope and output.
   */
  protected async summarize(
    input: SummarizationInput,
    agent: Agent,
    signal?: AbortSignal,
  ): Promise<SummaryResult> {
    const target = conversationTarget(agent)
    const config = target === undefined
      ? this.config
      : resolveTargetPolicy(this.config, target)
    return summarizeWithLlm(this.ctx, config, input, agent, signal)
  }

  /**
   * Compact for replayed step-boundary pressure or one provider-confirmed context
   * overflow. Both triggers price the latest durable routed request envelope;
   * overflow bypasses the normal threshold and retained-tail policy so it can
   * force one useful balanced reduction.
   * @param agent - agent whose latest durable routed request is measured.
   * @param trigger - normal step-boundary pressure or context-overflow recovery.
   * @param signal - live turn cancellation signal forwarded to summarization.
   * @returns the latest summary compaction result, or `null` when no summary ran.
   */
  override async compactIfNeeded(
    agent: Agent,
    trigger: CompactionTrigger,
    signal: AbortSignal,
  ): Promise<CompactionResult | null> {
    const header = agent.session.requestHeader()
    if (header === undefined || routedTarget(agent.session) === undefined) return null
    switch (trigger) {
      case 'pressure':
        // 2026-11-13 C7: 'pressure' 触发仅来自 pre-step 监听器——rapid-refill
        // 熔断沿此路径生效;模型切换(compactPressure 直调)与溢出恢复
        // (context-overflow)不受限。
        return this.compactPressure(agent, header, signal, false, true)
      case 'context-overflow': {
        this.ctx.get('toolResultPruner')?.pruneSession(agent.session)
        const measurement = this.ctx.tokenMeter.measure(agent.session)
        const range = selectCompactableRange(agent.session, measurement, 0)
        if (range === null) return null
        return this.compactRegion(range.start, range.end, agent, signal)
      }
      /* v8 ignore next -- closed-union exhaustiveness guard */
      default:
        assertNever(trigger, 'compaction trigger')
    }
  }

  /**
   * Price the proposed header; switch checks require history below its threshold.
   * With `refillBreaker` (pre-step pressure only), the rapid-refill breaker may
   * skip the pass once REFILL_STREAK_LIMIT consecutive triggers land within
   * REFILL_STEP_WINDOW steps of the last compaction (2026-11-13 C7).
   */
  private async compactPressure(
    agent: Agent,
    header: EpochHeader,
    signal: AbortSignal,
    requireBelowThreshold: boolean,
    refillBreaker = false,
  ): Promise<CompactionResult | null> {
    const target = header.config
    const policy = resolveTargetPolicy(this.config, target)
    const meter = this.ctx.tokenMeter
    let measurement = meter.measure(agent.session, header)
    const prune = this.ctx.get('toolResultPruner')
    const info = await this.ctx.llm.resolveModelInfo(target.provider, target.model, signal)
    assertNoActiveCompaction(agent.session, 'automatic pressure compaction')
    const targetKey = `${target.provider}/${target.model}`
    if (info.context === undefined) {
      throw new TargetPressureConfigError(
        targetKey,
        `compaction-basic: no context capacity for ${targetKey}; `
        + 'configure contextWindow on that adapter model',
      )
    }
    const spec = resolveCompactSpec(
      policy,
      info.context.contextWindow,
      reservedCompletionTokens(header, info.defaultMaxTokens),
    )
    if (measurement.totalTokens < spec.thresholdTokens) return null

    // 2026-11-13 C7: pre-step 压力真实触发点(此处已知压力过阈值;静默步不进连击)。
    // 熔断即跳过本次自动压缩——pruner/选区/摘要全不执行,返回 null 放行请求;
    // 模型切换路径(refillBreaker=false)与手动 compactNow(不经本方法)不受限。
    if (refillBreaker && this._enforceRapidRefillBreaker(agent)) return null

    // Once pressure qualifies, land the model-free pass before choosing a
    // summary range, then remeasure through the singleton replay fold.
    if (prune !== undefined) {
      prune.pruneSession(agent.session)
      measurement = meter.measure(agent.session, header)
    }
    if (measurement.totalTokens < spec.thresholdTokens) return null

    let result: CompactionResult | null = null
    for (let attempt = 0; attempt <= spec.compactionRetries; attempt += 1) {
      const range = selectCompactableRange(agent.session, measurement, spec.retainTokens)
      if (range === null) {
        if (result === null && !requireBelowThreshold) return null
        throw new Error(
          'no safe compaction range can reduce context below threshold '
          + `(${measurement.totalTokens} estimated tokens >= threshold ${spec.thresholdTokens})`,
        )
      }
      result = await this.compactRegion(range.start, range.end, agent, signal)
      measurement = meter.measure(agent.session, header)
      if (measurement.totalTokens < spec.thresholdTokens) {
        // 2026-11-13 C7: 压缩成功即重置步距(连击保留,见 _enforceRapidRefillBreaker)。
        if (refillBreaker) this._resetRefillSteps(agent)
        return result
      }
    }

    throw new Error(
      `compaction still above threshold after ${spec.compactionRetries + 1} compaction attempts `
      + `(${measurement.totalTokens} estimated tokens >= threshold ${spec.thresholdTokens})`,
    )
  }

  /**
   * Compact one inclusive positional range from the agent-owned surface using
   * the effective token meter for all retention and shrink pricing.
   * @param start - inclusive first surface-node seq.
   * @param end - inclusive last surface-node seq.
   * @param agent - owner of the target session, used by the summarizer.
   * @param signal - optional summarization cancellation signal.
   * @returns the successful durable compaction result.
   */
  override async compactRegion(
    start: SessionSeq,
    end: SessionSeq,
    agent: Agent,
    signal?: AbortSignal,
  ): Promise<CompactionResult> {
    return compactSurfaceRegion(
      this.regionDependencies(agent),
      agent.session,
      start,
      end,
      agent,
      { owner: 'current-turn', stability: 'whole-surface' },
      signal,
    )
  }

  /**
   * Force one useful idle-session compaction below the pressure threshold, and
   * resolve only after its standalone marker pair is durably checkpointed.
   * @param agent - idle agent whose next-turn admission this call reserves.
   * @param signal - cancellation scoped to this compaction request.
   * @param sourceCommandId - initiating command identity for presentation correlation.
   * @returns the committed result, or `null` when no safe useful range exists.
   */
  override compactNow(
    agent: Agent,
    signal: AbortSignal,
    sourceCommandId?: CommandId,
  ): Promise<CompactionResult | null> {
    signal.throwIfAborted()
    try {
      return agent.runMaintenance(async (agentSignal) => {
        const operationSignal = AbortSignal.any([agentSignal, signal])
        try {
          operationSignal.throwIfAborted()
          const range = selectCompactableRange(
            agent.session,
            this.ctx.tokenMeter.measure(agent.session),
            0,
          )
          if (range === null) return null
          return await compactSurfaceRegion(
            this.regionDependencies(agent),
            agent.session,
            range.start,
            range.end,
            agent,
            {
              owner: null,
              stability: 'selected-span',
              ...sourceCommandId === undefined ? {} : { sourceCommandId },
              flush: async () => {
                await this.ctx.sessions.flush(agent.session)
              },
            },
            operationSignal,
          )
        } catch (error: unknown) {
          if (agentSignal.aborted && operationSignal.reason === agentSignal.reason) {
            throw new ManualCompactionError(
              'cancelled',
              'manual compaction was cancelled',
              { cause: error },
            )
          }
          operationSignal.throwIfAborted()
          throw error
        }
      })
    } catch (error: unknown) {
      throw new ManualCompactionError(
        'busy',
        'manual compaction requires an idle agent with no waking queued work',
        { cause: error },
      )
    }
  }

  /**
   * Bind the effective token meter, dynamically dispatched summarizer hook, and
   * the C11 checkpoint-attachment slot: enabled when the effective policy (with
   * exact-target override) turns `attachments` on AND the session carries a
   * creation `cwd` — without a workspace root the attachment boundary cannot be
   * judged, so the whole face silently stays off (fail-conservative).
   */
  private regionDependencies(agent: Agent): Parameters<typeof compactSurfaceRegion>[0] {
    const target = conversationTarget(agent)
    const policy = target === undefined ? this.config : resolveTargetPolicy(this.config, target)
    const workspaceRoot = agent.session.header.cwd
    return {
      meter: this.ctx.tokenMeter,
      summarize: (input, owner, abort) => this.summarize(input, owner, abort),
      recover: (error, agent, sourceEventSeqs, signal) => this.ctx.waterfall('compaction/summary-error', {
        session: agent.session,
        sourceEventSeqs,
        error,
        ...signal === undefined ? {} : { signal },
      }, () => false),
      // 2026-11-14 C11(22 号 §5-C11):附件预算用 22 号默认 5/5000/50000,不另开配置键。
      ...(policy.attachments && workspaceRoot !== undefined
        ? { attachments: { workspaceRoot, budget: DEFAULT_ATTACHMENT_BUDGET } }
        : {}),
    }
  }
}

export default BasicCompactionEngine
