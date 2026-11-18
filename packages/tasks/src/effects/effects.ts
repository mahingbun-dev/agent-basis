/**
 * Effects——SQLite 持久副作用队列:命令事务内排队、提交后派发、失败指数退避、
 * 按 kind 并发限、`Later` 不计失败、健康上报(35 号 A12;34 号 §2.3 effects 行)。
 *
 * 设计依据:24 号 §5.5-R6(副作用只经 Effects/Outbox、崩溃可恢复)、§5.3-4;
 * 34 号 §2.3 effects 行「Effects 设计照搬」——语义自 SA src/app/effects.ts 重写级校对
 * 移植,不变量原样:enqueue 事务内 UPSERT 合并(同 kind+key 保队列位、载荷换新、
 * generation 递增使在跑尝试不误删新载荷)、按 kind 并发限、指数退避(初值×2^attempts
 * 封顶最大值)、`Later` 只顺延不计失败、drain 留行等下次 start、健康上报(连续
 * FAILURES_BEFORE_ERROR 次失败置 error,quiet kind 不置)。
 *
 * 本仓改造(34 号 §2.3):
 * - `reply` 投递器换 channels(outbox.ts,A13)、`launch`/`delivery` handler 接 executor
 *   (A14)——都经 `handle()` 注册,由 A16 装配接线;Effects 本体与具体 handler 无耦合;
 * - R6 宿主能力评估(A0)结论未出前按「Effects 全量照搬」保守设计(35 号 §12 开放
 *   问题 1):六种 effect kind 全保留,能由 DSH 宿主 tool-jobs/schedule 承接的 kind
 *   待评估结论后裁剪;
 * - 健康面机制并入本文件(34 号 §2.6:SA src/infra/health.ts 不整体移植,「健康面
 *   并入装配与 effects」):Health/HealthEntry/HealthBoard 为单写者认领制组件健康
 *   注册表(SA infra/health.ts 机制面的最小移植,A16 装配与 pass/health 测试消费)。
 */
import type { Store } from '../store/store.ts'

/** 某个 effect 当前无法运行的信号,如处理暂停中或 worker 槽位已满:Effects 在初始重试延迟后重排该行,不计其失败。 */
export class Later extends Error {}

/** 一个 effect kind 连续失败多少次后上报 error(与 Sources 轮询失败阈值一致,SA 原值)。 */
export const FAILURES_BEFORE_ERROR = 3

/** 组件健康项:状态、一句话详情与时刻(机制面最小形态;code/values 属 Source 宿主 i18n,不随本层移植)。 */
export interface Health { state: 'starting' | 'ready' | 'paused' | 'error'; detail: string; at?: string }
/** 被认领的健康项:可读取、可覆写;release 后从看板注销,之后的 set 为 no-op。 */
export interface HealthEntry {
  get(): Health | undefined
  set(health: Health): void
  release(): void
}
/**
 * 组件健康注册表:按条目名单写者认领(同名二次认领抛错,单写者纪律)。
 * Effects、装配面(A16)与未来各部件 claim;管理/监控面读 `all`。
 */
export class HealthBoard {
  private readonly entries = new Map<string, Health>()
  /** 稳定引用的视图:消费方捕获一次 `all` 即见后续变更(SA 以可变 Record 达成的同款语义)。 */
  private readonly view: Record<string, Health | undefined> = {}
  private readonly claimed = new Set<string>()
  claim(name: string, initial?: Health): HealthEntry {
    if (this.claimed.has(name)) throw new Error(`健康条目 ${name} 已由其他部件上报`)
    this.claimed.add(name)
    if (initial) { this.entries.set(name, initial); this.view[name] = initial }
    let held = true
    return {
      get: () => this.entries.get(name),
      set: (health: Health) => { if (held) { this.entries.set(name, health); this.view[name] = health } },
      release: () => {
        if (!held) return
        held = false
        this.claimed.delete(name)
        this.entries.delete(name)
        this.view[name] = undefined
      },
    }
  }
  /** 已释放条目读作 undefined(同 SA delete 后缺席语义;键不再枚举值)。 */
  get all(): Readonly<Record<string, Health | undefined>> { return this.view }
}

/** 各 effect kind 的载荷。 */
export interface EffectPayloads {
  /** 组装某 Eval 的候选卡并转交主会话;key 为 Eval ID。 */
  assessment: { triggerId: string }
  /** 启动一个 pending Assignment;key 为 Assignment ID。 */
  launch: { ticketId: string; assignmentId: string }
  /** 把工单等待中的 Inputs 交给其运行中 Assignment;key 为工单 ID。 */
  delivery: { ticketId: string }
  /** 把一份报告或候选卡引入主会话;key 为请求 ID。 */
  relay: { text: string }
  /** 不唤醒主会话地注入一条通知;key 点名所报之物(如 `prompts`)。 */
  notice: { value: Record<string, unknown>; summary: string }
  /** 经 channels 适配器为某渠道发出一条消息;key 为消息 ID,其回执由 Outbox 保管(A13)。 */
  reply: Record<string, never>
}
export type EffectKind = keyof EffectPayloads
interface Handler<K extends EffectKind> {
  run: (payload: EffectPayloads[K], key: string) => Promise<void>
  /** 此刻可同时跑多少个;0 表示扣住该 kind(如处理暂停中)。 */
  limit: () => number
  /** 初始与最大重试退避延迟(毫秒)。 */
  retry: readonly [number, number]
  /** true 时同类按队列序一次一个,失败的行压住后续行。 */
  ordered: boolean
  /** true 时反复失败不把该 kind 的健康置 error(失败已上到工单面的场景)。 */
  quiet: boolean
}
type Options<K extends EffectKind> = Partial<Pick<Handler<K>, 'limit' | 'retry' | 'ordered' | 'quiet'>>
/** `seq` 保队列位;`generation` 在载荷更新时递增,使在跑尝试不删新载荷。 */
interface Row { key: string; value: string; seq: number; generation: number; attempts: number; due: number }
type Task = { kind: EffectKind; key: string; done: Promise<void> }

/**
 * 持久 SQLite 队列:命令事务内持久化副作用、提交后派发。
 * 为 MasterAssessor、executor、会话与 Outbox 协调 per-kind handler、并发限、
 * 指数退避与健康上报(34 号 §2.3 effects 行;24 号 §5.5-R6)。
 */
export class Effects {
  private readonly handlers = new Map<EffectKind, Handler<never>>()
  private readonly health = new Map<EffectKind, HealthEntry>()
  private readonly tasks = new Set<Task>()
  /** 上次派发失败的 kind;下次成功派发时刷新其健康。 */
  private readonly broken = new Set<EffectKind>()
  private seq: number
  private scheduled = false
  /** Effects 只在 `start` 与 `drain` 之间运行;start 前排入的行等待(如装配未完)。 */
  private started = false
  private stopped = false
  private readonly store: Store
  private readonly board: Pick<HealthBoard, 'claim'>
  private readonly now: () => number
  constructor(
    store: Store,
    board: Pick<HealthBoard, 'claim'>,
    now: () => number = () => Date.now(),
  ) {
    this.store = store
    this.board = board
    this.now = now
    this.seq = (store.db.prepare('SELECT IFNULL(MAX(seq), 0) AS seq FROM effect').get() as { seq: number } | undefined)?.seq ?? 0
  }
  /** 在调用方事务内 UPSERT 一条 effect:与同 kind 同 key 的等待行合并、保其队列位。 */
  enqueue<K extends EffectKind>(kind: K, key: string, payload: EffectPayloads[K]): void {
    this.store.db.prepare(`INSERT INTO effect (kind, key, value, seq, due, since) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(kind, key) DO UPDATE
      SET value = excluded.value, generation = generation + 1, attempts = 0, error = '', due = excluded.due`)
      .run(kind, key, JSON.stringify(payload), ++this.seq, this.now(), new Date(this.now()).toISOString())
    this.kick()
  }
  handle<K extends EffectKind>(kind: K, run: Handler<K>['run'], options: Options<K> = {}): void {
    if (this.handlers.has(kind)) throw new Error(`${kind} effects 已有 handler`)
    this.health.set(kind, this.board.claim(kind))
    const { limit = () => 1, retry = [2000, 60_000], ordered = false, quiet = false } = options
    const handler = { run, limit: ordered ? () => Math.min(1, limit()) : limit, retry, ordered, quiet }
    this.handlers.set(kind, handler)
    this.report(kind)
    this.kick()
  }
  pending(kind: EffectKind, key?: string): boolean {
    return key === undefined
      ? !!this.store.db.prepare('SELECT 1 FROM effect WHERE kind = ? LIMIT 1').get(kind)
      : !!this.store.db.prepare('SELECT 1 FROM effect WHERE kind = ? AND key = ?').get(kind, key)
  }
  /** 按 kind 与 key 丢弃一条排队行;若它已在跑,那次尝试照常结束。 */
  cancel(kind: EffectKind, key: string): void {
    this.store.db.prepare('DELETE FROM effect WHERE kind = ? AND key = ?').run(kind, key)
    this.store.afterCommit(() => { this.report(kind) })
  }
  start(): void { this.started = true; this.kick() }
  kick(): void {
    if (this.scheduled) return
    this.scheduled = true
    queueMicrotask(() => { this.scheduled = false; this.dispatch() })
  }
  /** 等到 `kind`(缺省全部)没有在跑的 effect、且没有能开始的(无到期行或 limit() 无空位)。 */
  async idle(kind?: EffectKind): Promise<void> {
    for (;;) {
      this.dispatch()
      const running = [...this.tasks].filter(task => kind === undefined || task.kind === kind).map(task => task.done)
      if (!running.length) return
      await Promise.allSettled(running)
    }
  }
  /** 停止启动新 effect 并等待在跑的;等待行留在 SQLite 给下次 start。 */
  async drain(): Promise<void> {
    this.stopped = true
    await Promise.allSettled([...this.tasks].map(task => task.done))
  }
  private dispatch(): void {
    if (!this.started || this.stopped) return
    for (const [kind, handler] of this.handlers) {
      try {
        const running = new Set([...this.tasks].filter(task => task.kind === kind).map(task => task.key))
        // ordered kind 压在其最老行之后,即使该行未到期;limit() 只在有就绪行后才询问。
        const rows = (handler.ordered
          ? this.store.db.prepare('SELECT key, value, seq, generation, attempts, due FROM effect WHERE kind = ? ORDER BY seq LIMIT 1').all(kind)
          : this.store.db.prepare('SELECT key, value, seq, generation, attempts, due FROM effect WHERE kind = ? AND due <= ? ORDER BY seq LIMIT ?')
            .all(kind, this.now(), 16 + running.size)) as unknown as Row[]
        const ready = handler.ordered && running.size ? [] : rows.filter(row => row.due <= this.now() && !running.has(row.key))
        let room = ready.length ? handler.limit() - running.size : 0
        for (const row of ready) {
          if (room-- <= 0) break
          this.run(kind, handler, row)
        }
        if (this.broken.delete(kind)) this.report(kind)
      } catch (error) { this.failed(kind, error) }
    }
  }
  private run(kind: EffectKind, handler: Handler<never>, row: Row): void {
    const task: Task = { kind, key: row.key, done: Promise.resolve() }
    task.done = this.attempt(kind, handler, row)
      .catch((error: unknown) => { this.failed(kind, error) })
      .finally(() => { this.tasks.delete(task); this.kick() })
    this.tasks.add(task)
  }
  private async attempt(kind: EffectKind, handler: Handler<never>, row: Row): Promise<void> {
    let failure: { error: unknown } | undefined
    try { await handler.run(JSON.parse(row.value) as never, row.key) } catch (error) { failure = { error } }
    // 匹配 seq 与 generation:运行中被替换或重排的行不被误写。
    const own = 'kind = ? AND key = ? AND seq = ? AND generation = ?', ownRow = [kind, row.key, row.seq, row.generation] as const
    if (!failure) this.store.db.prepare(`DELETE FROM effect WHERE ${own}`).run(...ownRow)
    // 关停时不动在跑行:留给下次 start 重试。
    else if (this.stopped) return
    else if (failure.error instanceof Later) {
      this.store.db.prepare(`UPDATE effect SET due = ? WHERE ${own}`).run(this.now() + handler.retry[0], ...ownRow)
    } else {
      const delay = Math.min(handler.retry[1], handler.retry[0] * 2 ** Math.min(row.attempts, 16))
      this.store.db.prepare(`UPDATE effect SET attempts = attempts + 1, error = ?, due = ? WHERE ${own}`)
        .run(String(failure.error).slice(0, 1000), this.now() + delay, ...ownRow)
    }
    if (!this.stopped) this.report(kind)
  }
  private failed(kind: EffectKind, error: unknown): void {
    this.broken.add(kind)
    this.health.get(kind)?.set({ state: 'error', detail: `effect 队列失败:${String(error)}`, at: new Date(this.now()).toISOString() })
  }
  private report(kind: EffectKind): void {
    const row = this.store.db.prepare(`SELECT COUNT(*) AS waiting, MIN(since) AS since, MAX(attempts) AS attempts,
      (SELECT error FROM effect WHERE kind = ? AND attempts > 0 ORDER BY seq DESC LIMIT 1) AS error FROM effect WHERE kind = ?`).get(kind, kind) as
      { waiting: number; since: string | null; attempts: number | null; error: string | null } | undefined
    const waiting = row?.waiting ?? 0
    const failing = (row?.attempts ?? 0) >= FAILURES_BEFORE_ERROR && !this.handlers.get(kind)?.quiet
    const detail = waiting ? `${waiting} waiting since ${String(row?.since)}` : 'Nothing waiting'
    this.health.get(kind)?.set(failing
      ? { state: 'error', detail: `${detail}; the last failure: ${String(row?.error)}`, at: new Date(this.now()).toISOString() }
      : { state: 'ready', detail, at: new Date(this.now()).toISOString() })
  }
}
