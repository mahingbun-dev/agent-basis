/**
 * 评测服务编排(56 号 §5.4/§5.6):会话事件快照 → 轨迹投影 → 规则评分 → 快照。
 *
 * 分层口径:
 * - **规则层**(本文件上半,P0):同步纯投影,零模型成本,同一事件数组的重复读取
 *   结果完全相同;
 * - **裁判层**(P1,`engine.ts`):异步队列 + 评分库,快照里以 `judge` 区块并入
 *   (服务面缺席裁判引擎时退化为 P0 只读语义,`judge` 字段省略)。
 *
 * 会话从哪来:面板永远对着**当前打开的会话**,它必然在宿主内存里(agents 或
 * sessions 注册表)。两处都读不到 = 会话未加载:如实回 `not_loaded`,由面板
 * 显示「打开会话后可评」,不伪造空分数。
 */
import { aggregateSessionMetrics } from '@eterna/observe'
import { evaluateRules, type RuleEvaluation } from './metrics.ts'
import { projectTrajectory } from './trajectory.ts'
import type { EvalSnapshot, EvalVerdict, SessionEventLike } from './types.ts'
import type {
  BusinessParseReply, BusinessSaveReply, JudgeEvaluateReply, JudgeLabelReply,
  JudgeSaveConfigReply, JudgeSettingsView, JudgeSnapshot,
} from './judge-types.ts'
import type { JudgeEvaluateOptions } from './engine.ts'

/** 裁判引擎的结构面(host 传 JudgeEngine;测试注入假件)。 */
export interface JudgeEngineFace {
  snapshot(sessionId: string, now?: number): Promise<JudgeSnapshot>
  evaluate(sessionId: string, options?: JudgeEvaluateOptions): Promise<JudgeEvaluateReply>
  settings(account?: string): Promise<JudgeSettingsView>
  saveConfig(input: unknown): Promise<JudgeSaveConfigReply>
  saveBusinessMetric(account: string, input: unknown, baseVersion: number): Promise<BusinessSaveReply>
  parseBusinessMetrics(text: string): Promise<BusinessParseReply>
  label(sessionId: string, input: unknown, account: string): Promise<JudgeLabelReply>
}

/** 服务端口:只读事件面(host.ts 接宿主 agents/sessions;测试注入固定数组). */
export interface SessionEvalPorts {
  /**
   * 读某会话的完整事件快照(数组序 = 时间序)。
   * @param sessionId - 会话 id。
   * @returns 事件数组;会话不在内存时为 undefined(不是空数组)。
   */
  readEvents(sessionId: string): readonly SessionEventLike[] | undefined
  /** 裁判引擎(P1);缺席 = 只提供确定性规则(P0 语义). */
  readonly judge?: JudgeEngineFace
}

/** 服务面暴露给 access 的结构子集(access 侧有同名结构声明,two-side 不 import). */
export interface SessionEvalFace {
  snapshot(sessionId: string, now?: number): Promise<EvalSnapshot>
  evaluate(sessionId: string, options?: JudgeEvaluateOptions): Promise<JudgeEvaluateReply>
  settings(account?: string): Promise<JudgeSettingsView>
  saveConfig(input: unknown): Promise<JudgeSaveConfigReply>
  saveBusinessMetric(account: string, input: unknown, baseVersion: number): Promise<BusinessSaveReply>
  parseBusinessMetrics(text: string): Promise<BusinessParseReply>
  label(sessionId: string, input: unknown, account: string): Promise<JudgeLabelReply>
}

/** 会话 id 的合法形状(只做防呆:非空、长度上限,不做前缀白名单). */
const SESSION_ID_MAX = 200

/**
 * 评测服务:规则快照 + 裁判区(裁判引擎在场时)。
 */
export class SessionEvalService implements SessionEvalFace {
  private readonly ports: SessionEvalPorts

  constructor(ports: SessionEvalPorts) {
    this.ports = ports
  }

  /**
   * 生成一个会话的评测快照。
   * @param sessionId - 会话 id(调用方已完成归属校验)。
   * @param now - 生成时刻(测试注入;缺省 Date.now())。
   * @returns 快照;会话未加载/无事件也返回**结构完整**的快照(状态区分,不抛)。
   */
  async snapshot(sessionId: string, now?: number): Promise<EvalSnapshot> {
    const generatedAt = now ?? Date.now()
    const id = typeof sessionId === 'string' ? sessionId.trim() : ''
    const judge = await this.judgeSnapshot(id, generatedAt)
    const events = id === '' || id.length > SESSION_ID_MAX ? undefined : this.ports.readEvents(id)
    if (events === undefined) {
      return emptySnapshot(id, 'not_loaded', generatedAt, judge)
    }
    if (events.length === 0) {
      return emptySnapshot(id, 'empty', generatedAt, judge)
    }
    const aggregate = aggregateSessionMetrics(events)
    const trajectory = projectTrajectory(id, events)
    const evaluation: RuleEvaluation = evaluateRules({ aggregate, trajectory })
    const duration = trajectory.window.firstTime !== undefined && trajectory.window.lastTime !== undefined
      ? Math.max(0, trajectory.window.lastTime - trajectory.window.firstTime)
      : null
    return {
      sessionId: id,
      state: 'ok',
      generatedAt,
      turns: aggregate.turns,
      steps: aggregate.steps,
      lastTurn: trajectory.turns.length === 0 ? 0 : trajectory.turns[trajectory.turns.length - 1]?.turn ?? 0,
      durationMs: duration,
      usage: {
        input: aggregate.tokens.input,
        output: aggregate.tokens.output,
        cacheRead: aggregate.tokens.cacheRead,
        cacheWrite: aggregate.tokens.cacheWrite,
        reasoning: aggregate.tokens.reasoning,
        billed: aggregate.tokens.billed,
      },
      cacheHitRate: aggregate.cacheHitRate,
      costUsd: evaluation.costUsd,
      route: trajectory.route,
      verdict: judge === undefined ? evaluation.verdict : composeVerdict(evaluation.verdict, judge.overall),
      metrics: evaluation.metrics,
      issues: evaluation.issues,
      pending: evaluation.pending,
      ...judge === undefined ? {} : { judge },
    }
  }

  /**
   * 手动评测(「立即评测」按钮)。
   * @param sessionId - 会话 id.
   * @param options - 范围与目标轮.
   * @returns 受理结果;裁判层未装载时如实拒绝。
   */
  evaluate(sessionId: string, options?: JudgeEvaluateOptions): Promise<JudgeEvaluateReply> {
    const judge = this.ports.judge
    if (judge === undefined) {
      return Promise.resolve({ ok: false, code: 'invalid', message: '裁判层未装载（插件仍在启动）。' })
    }
    return judge.evaluate(sessionId, options)
  }

  /** 设置分区读面(配置 + 指标目录 + 模型目录 + 账号业务指标覆盖层). */
  settings(account?: string): Promise<JudgeSettingsView> {
    const judge = this.ports.judge
    if (judge === undefined) {
      return Promise.reject(new Error('judge layer not mounted'))
    }
    return judge.settings(account)
  }

  /** 保存当前账号的业务指标(乐观锁;账号由 access 身份解析传入). */
  saveBusinessMetric(account: string, input: unknown, baseVersion: number): Promise<BusinessSaveReply> {
    const judge = this.ports.judge
    if (judge === undefined) {
      return Promise.resolve({ ok: false, code: 'io', error: '裁判层未装载（插件仍在启动）。' })
    }
    return judge.saveBusinessMetric(account, input, baseVersion)
  }

  /** 解析导入的 metrics.yaml(纯解析,不落盘;裁判层缺席时不可用). */
  parseBusinessMetrics(text: string): Promise<BusinessParseReply> {
    const judge = this.ports.judge
    if (judge === undefined) {
      return Promise.resolve({ ok: false, error: '裁判层未装载（插件仍在启动）。' })
    }
    return judge.parseBusinessMetrics(text)
  }

  /** 人工复核一条模型评分(标注人 = 当前登录账号). */
  label(sessionId: string, input: unknown, account: string): Promise<JudgeLabelReply> {
    const judge = this.ports.judge
    if (judge === undefined) {
      return Promise.resolve({ ok: false, code: 'io', error: '裁判层未装载（插件仍在启动）。' })
    }
    return judge.label(sessionId, input, account)
  }

  /** 保存裁判配置(严格校验 + 目录自检)。 */
  saveConfig(input: unknown): Promise<JudgeSaveConfigReply> {
    const judge = this.ports.judge
    if (judge === undefined) {
      return Promise.resolve({ ok: false, error: '裁判层未装载（插件仍在启动）。' })
    }
    return judge.saveConfig(input)
  }

  /** 裁判区快照;引擎缺席或异常都退化为 undefined(规则层仍可用). */
  private async judgeSnapshot(sessionId: string, now: number): Promise<JudgeSnapshot | undefined> {
    const judge = this.ports.judge
    if (judge === undefined) return undefined
    try {
      return await judge.snapshot(sessionId, now)
    } catch {
      return undefined
    }
  }
}

/**
 * 组合规则结论与裁判结论(面板顶部结论卡):
 * 任一方 warn → warn;双方都有结论且无 warn → pass;任一方无结论 → 如实标 unrated
 * (规则 pass + 裁判未评时保留规则文案,其中已明写「结果类未评」)。
 * @param rule - 规则层结论.
 * @param overall - 结果类裁判综合结论.
 */
export function composeVerdict(rule: EvalVerdict, overall: JudgeSnapshot['overall']): EvalVerdict {
  const reasons = [...rule.reasons, ...overall.reasons]
  if (rule.level === 'warn' || overall.level === 'warn') {
    const label = rule.level === 'warn' && overall.level === 'warn'
      ? '规则与裁判均发现问题'
      : rule.level === 'warn'
        ? rule.label
        : `规则通过 · ${overall.label}`
    return { level: 'warn', label, reasons }
  }
  if (rule.level === 'pass' && overall.level === 'pass') {
    return { level: 'pass', label: '规则与裁判均通过', reasons }
  }
  if (rule.level === 'pass') {
    // 裁判未评(未配置/未产生结果类评分):规则文案本身已标「结果类未评」。
    return { level: 'pass', label: rule.label, reasons }
  }
  if (overall.level === 'pass') {
    return { level: 'pass', label: '结果类裁判通过（规则未评）', reasons }
  }
  return { level: 'unrated', label: rule.label, reasons }
}

/** 空态快照(结构完整:客户端只按 state 选文案,其余字段保持形状). */
function emptySnapshot(
  sessionId: string,
  state: 'empty' | 'not_loaded',
  generatedAt: number,
  judge: JudgeSnapshot | undefined,
): EvalSnapshot {
  return {
    sessionId,
    state,
    generatedAt,
    turns: 0,
    steps: 0,
    lastTurn: 0,
    durationMs: null,
    usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, reasoning: 0, billed: 0 },
    cacheHitRate: null,
    costUsd: null,
    route: null,
    verdict: state === 'empty'
      ? { level: 'unrated', label: '未评：会话尚无内容', reasons: ['当前会话还没有可投影的事件。'] }
      : { level: 'unrated', label: '未加载：请先打开该会话', reasons: ['会话不在宿主内存(未打开),无法读取事件快照。'] },
    metrics: [],
    issues: [],
    pending: [],
    ...judge === undefined ? {} : { judge },
  }
}
