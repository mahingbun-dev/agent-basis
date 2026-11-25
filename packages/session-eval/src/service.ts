/**
 * 评测服务编排(56 号 §5.4/§5.6):会话事件快照 → 轨迹投影 → 规则评分 → 快照。
 *
 * P0 刻意**无状态、无存储、无队列**:
 * - 不订阅 `session/event`(不占回合、不怕装载顺序)——读的是宿主内存里的既有事件;
 * - 不落库(评分库是 P1);同一事件数组的重复读取结果完全相同(纯投影);
 * - 不调模型(规则层零成本)。
 *
 * 会话从哪来:面板永远对着**当前打开的会话**,它必然在宿主内存里(agents 或
 * sessions 注册表)。两处都读不到 = 会话未加载:如实回 `not_loaded`,由面板
 * 显示「打开会话后可评」,不伪造空分数。
 */
import { aggregateSessionMetrics } from '@eterna/observe'
import { evaluateRules, type RuleEvaluation } from './metrics.ts'
import { projectTrajectory } from './trajectory.ts'
import type { EvalSnapshot, SessionEventLike } from './types.ts'

/** 服务端口:只读事件面(host.ts 接宿主 agents/sessions;测试注入固定数组). */
export interface SessionEvalPorts {
  /**
   * 读某会话的完整事件快照(数组序 = 时间序)。
   * @param sessionId - 会话 id。
   * @returns 事件数组;会话不在内存时为 undefined(不是空数组)。
   */
  readEvents(sessionId: string): readonly SessionEventLike[] | undefined
}

/** 服务面暴露给 access 的结构子集(access 侧有同名结构声明,two-side 不 import). */
export interface SessionEvalFace {
  snapshot(sessionId: string, now?: number): Promise<EvalSnapshot>
}

/** 会话 id 的合法形状(只做防呆:非空、长度上限,不做前缀白名单). */
const SESSION_ID_MAX = 200

/**
 * 评测服务:P0 只提供 snapshot(生成一份只读快照)。
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
  snapshot(sessionId: string, now?: number): Promise<EvalSnapshot> {
    const generatedAt = now ?? Date.now()
    const id = typeof sessionId === 'string' ? sessionId.trim() : ''
    const events = id === '' || id.length > SESSION_ID_MAX ? undefined : this.ports.readEvents(id)
    if (events === undefined) {
      return Promise.resolve(emptySnapshot(id, 'not_loaded', generatedAt))
    }
    if (events.length === 0) {
      return Promise.resolve(emptySnapshot(id, 'empty', generatedAt))
    }
    const aggregate = aggregateSessionMetrics(events)
    const trajectory = projectTrajectory(id, events)
    const evaluation: RuleEvaluation = evaluateRules({ aggregate, trajectory })
    const duration = trajectory.window.firstTime !== undefined && trajectory.window.lastTime !== undefined
      ? Math.max(0, trajectory.window.lastTime - trajectory.window.firstTime)
      : null
    return Promise.resolve({
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
      verdict: evaluation.verdict,
      metrics: evaluation.metrics,
      issues: evaluation.issues,
      pending: evaluation.pending,
    })
  }
}

/** 空态快照(结构完整:客户端只按 state 选文案,其余字段保持形状). */
function emptySnapshot(sessionId: string, state: 'empty' | 'not_loaded', generatedAt: number): EvalSnapshot {
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
  }
}
