/**
 * 内存仓储——Repositories 端口的内存实现,测试与临时 Engine 实例用(35 号 A3)。
 *
 * 设计依据:34 号 §2.1 memory 行;语义自 SA/src/core/memory.ts 重写级校对移植:
 * - 存取两侧都走克隆快照,调用方拿到或交出的对象其后的改动都不影响库内状态;
 * - `atomic` 以五张表的整表快照实现回滚——内层事务失败只回滚自己那一层;
 * - `tickets.list` 最新在前、`decisions.byThread` 按保存序,与 SQLite Store 的排序语义对齐
 *   (Engine 测试因此可在两种实现间互换,对照用例见 tests/memory.spec.ts,承 SA tests/store.spec.ts 内存半边)。
 * realm 说明:按 realm 路由到存储实例(TasksRealmRouter)属 34 §2.3/A11 的 store 层;
 * 内存实例按单 realm 使用,不承担路由。
 */
import { latestAssignment, type Decision, type Thread, type Ticket, type Trigger, type TriggerDisposition } from './model.ts'
import type { Repositories } from './ports.ts'

const clone = <T>(value: T): T => structuredClone(value)
/** Repositories 的内存实现:Map 条目存取两侧均克隆,调用方的改动不影响库内状态;快照式 atomic 回滚,排序语义对齐 SQLite Store。 */
export class MemoryRepositories implements Repositories {
  private readonly triggerRows = new Map<string, Trigger>()
  private readonly dispositions = new Map<string, TriggerDisposition>()
  private readonly threadRows = new Map<string, Thread>()
  private readonly ticketRows = new Map<string, Ticket>()
  private readonly decisionRows = new Map<string, Decision>()
  atomic<T>(work: () => T): T {
    const maps: Map<string, unknown>[] = [this.triggerRows, this.dispositions, this.threadRows, this.ticketRows, this.decisionRows]
    const snapshot = maps.map(map => new Map(map))
    try { return work() }
    catch (error) {
      maps.forEach((map, index) => {
        map.clear()
        // snapshot 与 maps 同长,恒有对应快照;非空断言与 SA 原样
        // oxlint-disable-next-line typescript/no-non-null-assertion
        for (const [id, value] of snapshot[index]!) map.set(id, value)
      })
      throw error
    }
  }
  readonly triggers = {
    get: (id: string) => clone(this.triggerRows.get(id)),
    save: (trigger: Trigger) => { this.triggerRows.set(trigger.id, clone(trigger)) },
    disposition: (id: string) => clone(this.dispositions.get(id)),
    saveDisposition: (id: string, value: TriggerDisposition) => { this.dispositions.set(id, clone(value)) },
  }
  readonly threads = {
    get: (key: string) => clone(this.threadRows.get(key)),
    save: (thread: Thread) => { this.threadRows.set(thread.key, clone(thread)) },
    list: () => [...this.threadRows.values()].map(clone),
    active: () => this.threads.list().filter(thread => thread.pending.length > 0 || thread.evaluating !== undefined),
  }
  readonly tickets = {
    get: (id: string) => clone(this.ticketRows.get(id)),
    save: (ticket: Ticket) => { this.ticketRows.set(ticket.id, clone(ticket)) },
    /** 最新在前,与 SQLite Store 的顺序一致。 */
    list: () => [...this.ticketRows.values()].reverse().map(clone),
    open: () => this.tickets.list().filter(ticket => !ticket.ended),
    active: () => this.tickets.list().filter(ticket => ticket.undelivered.length > 0 || ['pending', 'running'].includes(latestAssignment(ticket)?.state ?? '')),
  }
  readonly decisions = {
    get: (id: string) => clone(this.decisionRows.get(id)),
    save: (decision: Decision) => { this.decisionRows.set(decision.id, clone(decision)) },
    byThread: (key: string) => [...this.decisionRows.values()].filter(decision => decision.threadKey === key).map(clone),
  }
}
