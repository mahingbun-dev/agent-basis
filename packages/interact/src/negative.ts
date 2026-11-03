/**
 * 审批负信号事件发布接口(设计文档 09 号 §「信号采集」:
 * 「dsh-interact 的审批被拒/被修改是**最高质量的负信号**(人已经告诉你哪里错了)」,
 * 经 observe(T9)的 evolve_signal 队列进自进化闭环)。
 *
 * 两类负信号:
 * - rejected 审批被拒:DSH approval waterfall 的 'rejected' 结局翻译而来
 *   (approval/decided 为 log-only 不进模型上下文,故由组合层在 waterfall 应答处调 recordOutcome);
 * - modified 被修改:R2 动作产出随后被用户改写=隐含差评(对照 deliverables 逐 turn diff),
 *   由组合层检测到 diff 时调 recordModification。
 *
 * 非负信号(诚实边界,不发布):'allowed-once' 放行、'cancelled' 主动撤回、
 * 'unavailable' 无应答者 fail-closed——都不是用户对动作本身的否定。
 *
 * 形态:进程内发布/订阅 + 环形缓冲快照(recent),供 observe 拉取或订阅;
 * 监听器抛错被隔离(一个坏消费者不拖垮发布方)。Cordis 纪律:纯运行时对象,
 * 组合层随 ctx.interact 服务(INTERACT_SERVICE_ID)一起 provide,销毁即随服务回收。
 */
import type { ApprovalOutcome } from '@deepseek-ai/dsh-user-approval'
import type { RiskGrade } from './types.ts'

/** 负信号类别:审批被拒 / 产出被用户修改。 */
export type ApprovalNegativeKind = 'rejected' | 'modified'

/** 审批负信号事件(observe 的 evolve_signal 输入)。 */
export interface ApprovalNegativeSignal {
  readonly kind: ApprovalNegativeKind
  /** 被拒/被改动作的工具名。 */
  readonly toolName: string
  /** 命中的 hitl.yaml 规则 id(有则带)。 */
  readonly ruleId?: string
  /** 该动作的风险档。 */
  readonly grade: RiskGrade
  readonly turnId?: number
  readonly agentId?: string
  /** 用户给出的理由或 diff 摘要(有则带)。 */
  readonly reason?: string
  /** 事件时间(epoch ms)。 */
  readonly time: number
}

/** 发布负信号所需的元信息。 */
export interface ApprovalSignalMeta {
  readonly toolName: string
  readonly grade: RiskGrade
  readonly ruleId?: string
  readonly turnId?: number
  readonly agentId?: string
  readonly reason?: string
  /** 缺省取 now()。 */
  readonly time?: number
}

export type ApprovalNegativeListener = (signal: ApprovalNegativeSignal) => void

export interface ApprovalSignalBusOptions {
  /** 时钟注入(测试确定性);缺省 Date.now。 */
  readonly now?: () => number
  /** 环形缓冲上限;缺省 1000。 */
  readonly bufferLimit?: number
}

const DEFAULT_BUFFER_LIMIT = 1000

/** 审批负信号总线:publish 订阅扇出 + recent 快照 + DSH 结局翻译。 */
export class ApprovalSignalBus {
  private readonly now: () => number
  private readonly bufferLimit: number
  private readonly listeners = new Set<ApprovalNegativeListener>()
  private buffer: ApprovalNegativeSignal[] = []

  constructor(options: ApprovalSignalBusOptions = {}) {
    this.now = options.now ?? Date.now
    this.bufferLimit = options.bufferLimit ?? DEFAULT_BUFFER_LIMIT
  }

  /** 发布一条负信号:写环形缓冲并同步扇出给全部监听器(监听器抛错被隔离)。 */
  publish(kind: ApprovalNegativeKind, meta: ApprovalSignalMeta): ApprovalNegativeSignal {
    const signal: ApprovalNegativeSignal = {
      kind,
      toolName: meta.toolName,
      grade: meta.grade,
      ...(meta.ruleId !== undefined && { ruleId: meta.ruleId }),
      ...(meta.turnId !== undefined && { turnId: meta.turnId }),
      ...(meta.agentId !== undefined && { agentId: meta.agentId }),
      ...(meta.reason !== undefined && { reason: meta.reason }),
      time: meta.time ?? this.now(),
    }
    this.buffer.push(signal)
    if (this.buffer.length > this.bufferLimit) {
      this.buffer = this.buffer.slice(this.buffer.length - this.bufferLimit)
    }
    for (const listener of this.listeners) {
      try {
        listener(signal)
      } catch {
        // 监听器故障不拖垮发布方,也不中断其余监听器(信号已在缓冲,可回放)。
      }
    }
    return signal
  }

  /**
   * 把 DSH approval 结局翻译为负信号:仅 'rejected' 发布;
   * 'allowed-once'/'cancelled'/'unavailable' 不是用户否定,返回 undefined 不发布。
   */
  recordOutcome(outcome: ApprovalOutcome, meta: ApprovalSignalMeta): ApprovalNegativeSignal | undefined {
    if (outcome !== 'rejected') return undefined
    return this.publish('rejected', meta)
  }

  /** R2 动作产出被用户改写(隐含差评):发布 'modified'。 */
  recordModification(meta: ApprovalSignalMeta): ApprovalNegativeSignal {
    return this.publish('modified', meta)
  }

  /** 订阅;返回退订函数。 */
  subscribe(listener: ApprovalNegativeListener): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  /** 最近信号快照(新的在后;limit 截尾)。 */
  recent(limit?: number): readonly ApprovalNegativeSignal[] {
    return limit === undefined ? [...this.buffer] : this.buffer.slice(Math.max(0, this.buffer.length - limit))
  }

  /** 已缓冲信号数。 */
  get count(): number {
    return this.buffer.length
  }

  /** 清空缓冲快照(已发布的信号对各订阅者的即时投递不回收);dispose 时释放实例态。 */
  clear(): void {
    this.buffer = []
  }
}
