/**
 * WorkerSlots——worker 并发槽位(35 号 A14;34 号 §2.4 slots 行)。
 *
 * 设计依据:24 号 §2.3-4(Assignment+WorkerSlots 机制)、§5.2 表 Executor 行;27 号 §3.1-4
 * (资源冲突→槽位制)、§3.2-④(人可插队 +1 槽、唤醒优先于新 launch)、§5-2(插队计数)。
 * 语义自 SA src/executor/dsh.ts 的 WorkerSlots(SA dsh.ts:171-199)重写级校对移植,
 * 不变量原样:一张工单在其 worker 回合运行期间、其回合结束后仍跑的 shell job 与
 * subagent 期间、以及一次 launch 或唤醒正在启动它期间,各占一个槽;DshExecutor 在
 * await 启动工作之前同步占槽,两次启动不会同时抢到最后一个槽;人的后续消息
 * (`by === 'person'`)可用 `max()` 之外的一个额外槽,永不排在新 launch 之后。
 * ★本仓改造(35 号 A14 交付原文「插队次数计数暴露给 observe——D2 指标之一」;
 * 35 号表②-3):人插队(`reserve(..., 'person')`)计数经 `personBarges()` 暴露,
 * 消费面归 packages/observe(G2-A10),本包只计数不告警(24a 拍板记录·D2「先记录不告警」)。
 */
import { Later } from '../effects/effects.ts'

/**
 * 跟踪活跃与启动中的 worker session 对并发上限的占用:工单在其 worker 的回合跑着时、
 * 其回合结束后其 shell job 或 subagent 仍跑着时、以及一次 launch 或唤醒正启动该 worker 时,
 * 各占一个槽。DshExecutor 在 await launch 或唤醒工作之前同步经 `reserve` 占槽,使两次
 * 启动无法同时取走最后一个槽;人的后续消息(`by === 'person'`)可越 `max()` 一个槽,
 * 因此永不排在新 launch 之后。
 */
export class WorkerSlots {
  /** 当前持有启动槽的工单,映射其启动是 launch、唤醒、还是给人的消息的唤醒。 */
  private readonly starting = new Map<string, 'launch' | 'wake' | 'person'>()
  /** 人插队次数(D2 冲突指标之一,27 号 §5-2;observe 消费面见文件头)。 */
  private barges = 0
  /**
   * @param running - 返回其 worker 正占着槽的工单 id(见 `DshExecutor.running`)。
   * @param max - 返回配置的 worker 并发槽上限(`settings.executor.maxWorkers`)。
   */
  private readonly running: () => string[]
  private readonly max: () => number
  constructor(running: () => string[], max: () => number) { this.running = running; this.max = max }
  /** 当前占用的槽数:运行中的 worker 与启动预留的并集。 */
  used(): number { return new Set([...this.running(), ...this.starting.keys()]).size }
  /** 还可同时跑多少个 launch:未被运行中 worker 或唤醒预留占用的槽。 */
  launches(): number {
    const wakes = [...this.starting].flatMap(([ticketId, by]) => (by !== 'launch' ? [ticketId] : []))
    return this.max() - new Set([...this.running(), ...wakes]).size
  }
  /**
   * 为 `ticketId` 预留一个启动槽;`ticketId` 已持有启动槽时幂等。
   * 给人消息的唤醒(`by === 'person'`)可用 `max()` 之外的一个额外槽(插队 +1)。
   * worker 回合跑起来或 launch/唤醒尝试结束后调用 `free(ticketId)`。
   * @throws Later 当没有空槽。
   */
  reserve(ticketId: string, by: 'launch' | 'wake' | 'person'): void {
    if (this.starting.has(ticketId)) return
    if (this.used() >= this.max() + (by === 'person' ? 1 : 0)) throw new Later('No worker slot is free')
    // 插队计数只记真正用到额外槽的那次:普通槽位已满(used() 达 max())时,人的消息
    // 仍经 +1 槽先行——这一次才是越过上限的插队(27 号 §5-2 口径)。
    if (by === 'person' && this.used() >= this.max()) this.barges += 1
    this.starting.set(ticketId, by)
  }
  /** 释放 `ticketId` 的启动槽:其 worker session 已跑起来,或 launch/唤醒尝试已结束。 */
  free(ticketId: string): void { this.starting.delete(ticketId) }
  /** 人插队累计次数(D2 指标:槽位插队次数,27 号 §5-2;先记录不告警,24a·D2)。 */
  personBarges(): number { return this.barges }
}
