/**
 * worker 在 DSH 宿主里的后台工作:其 Session 拥有的 shell job(`ctx.get('jobs')`)与
 * subagent(`ctx.get('subagents')`)。它们在 worker 回合结束后仍使其忙碌,并随其
 * Assignment 一起停止。没有其中任一服务的形态(profile)一个也没有。
 *
 * 设计依据:34 号 §2.4 background 行(`untilQuiet`/`stopBackground`/`stopSubagents`/
 * jobs 收集原样,27 号 §2.2 点名参考);35 号 A14。语义自 SA src/executor/background.ts
 * 重写级校对移植,不变量原样。subagent 权限遵循 D1(35 号 A18:worker 声明段
 * `subagent_policies`,本文件只做停止与收集,不改内核)。
 */
import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { SessionId } from '@deepseek-ai/dsh-session'

/** Executor 用到的 DSH job 注册表面:某 Session 能看到的 job、其事件、对某个的等待与 kill。 */
interface Jobs {
  list(caller: string): readonly { id: string; owner?: string; status: string; label?: string }[]
  wait(id: string, timeoutMs: number, caller: string, signal?: AbortSignal): Promise<{ status: string }>
  kill(id: string, caller: string, reason?: string): unknown
  readonly events: { subscribe(filter: { owner: string }, listener: (event: { type: string }) => void): () => void }
}
/** Executor 用到的 DSH subagent 面:join 某 worker 的整棵 subagent 树、列出其后代、释放其树。 */
interface Subagents {
  waitForTreeWork(root: Agent): Promise<boolean>
  listDescendants(rootSessionId: SessionId, signal?: AbortSignal): Promise<readonly { id: string }[]>
  drainDescendants(parents: readonly Agent[]): Promise<void>
}
/** 一次 stop 等被 kill 的 job 结束的时长;其结束被收集,使 worker 不被叫醒来听它。 */
const KILL_WAIT_MS = 10_000
/** 释放 subagent 可能花的时间;它会拖住一次关停,DSH 自己的调用方同样给它设限。 */
const DRAIN_LIMIT_MS = 10_000
/** 收集一个 job 结束的单次等待时长;以 job 仍在运行结束的等待,由下一次接着。 */
const COLLECT_WAIT_MS = 10 * 60_000

const registry = (ctx: Context): Jobs | undefined => ctx.get('jobs') as Jobs | undefined
const subagentsOf = (ctx: Context): Subagents | undefined => ctx.get('subagents') as Subagents | undefined
const running = (status: string): boolean => status === 'running' || status === 'stopping'
/** 某 Session 拥有且仍在跑的 job,但 `except` 中的除外(如留给人的那些)。 */
const owned = (jobs: Jobs, sessionId: string, except?: ReadonlySet<string>) =>
  jobs.list(sessionId).filter(job => job.owner === sessionId && running(job.status) && !except?.has(job.id))
/** `work`,或 `signal` 中止/`ms` 毫秒先行时返回 false。 */
export function until<T>(work: Promise<T>, signal?: AbortSignal, ms?: number): Promise<T | false> {
  if (signal?.aborted) return Promise.resolve(false)
  let stop!: () => void
  const stopped = new Promise<false>((resolve) => { stop = () => { resolve(false) } })
  signal?.addEventListener('abort', stop, { once: true })
  const timer = ms === undefined ? undefined : setTimeout(stop, ms)
  timer?.unref()
  return Promise.race([work, stopped]).finally(() => { signal?.removeEventListener('abort', stop); clearTimeout(timer) })
}
/** 其 subagent 被 stop 取消了当前回合的 worker:其下一次 idle 结束的是那个回合,不是自己的。 */
export const cancelled = new WeakSet<Agent>()
/** 每个 worker 的 subagent 的 pending join,DSH 无法取消它,后来的查看 join 同一个。 */
const joins = new WeakMap<Agent, Promise<boolean>>()
function childrenEnd(subagents: Subagents, agent: Agent): Promise<boolean> {
  let join = joins.get(agent)
  if (!join) {
    join = subagents.waitForTreeWork(agent).finally(() => { joins.delete(agent) })
    joins.set(agent, join)
  }
  return join
}

/** 一个 job:其 id 与 label 的第一行。 */
const named = (job: { id: string; label?: string }): string => {
  const line = job.label?.split('\n')[0]?.trim()
  return line ? `${job.id} (${line})` : job.id
}
/** 某 Session 拥有、仍在跑的 shell job(但 `except` 中的除外),带名字。 */
export const runningJobs = (ctx: Context, sessionId: string, except?: ReadonlySet<string>): { id: string; name: string }[] => {
  const jobs = registry(ctx)
  return jobs ? owned(jobs, sessionId, except).map(job => ({ id: job.id, name: named(job) })) : []
}

/**
 * 等到该 Session 拥有的 shell job 一个都不跑;一个都没跑过时立即 false,或 `signal`
 * 先行中止时 false。该等待不在任何 job 上挂号,因此每个 job 的结束仍能到达 worker。
 */
function jobsEnd(ctx: Context, sessionId: string, signal: AbortSignal, except?: ReadonlySet<string>): Promise<boolean> {
  const jobs = registry(ctx)
  if (!jobs || !owned(jobs, sessionId, except).length) return Promise.resolve(false)
  return new Promise((resolve) => {
    let settled = false
    const done = (value: boolean): void => {
      if (settled) return
      settled = true; unsubscribe(); signal.removeEventListener('abort', aborted); resolve(value)
    }
    const aborted = (): void => { done(false) }
    // 只有结束能让「无 job 在跑」成立;某个 job 的输出不能。
    const unsubscribe = jobs.events.subscribe({ owner: sessionId }, (event) => {
      if ((event.type === 'settled' || event.type === 'removed') && !owned(jobs, sessionId, except).length) done(true)
    })
    signal.addEventListener('abort', aborted, { once: true })
    if (signal.aborted) aborted()
  })
}

/**
 * 等到闲下来的 worker 身后什么都不再跑:其 shell job(`except` 中的除外)与其 subagent。
 * 一个 job 或 subagent 的结束会带着其结果唤醒 worker,这结束本次查看;它开的回合以它
 * 自己的一次 idle 结束,那再查看新一轮。
 * @returns 其全部结束且 worker 仍 idle 时 true;worker 又跑起来、或 `signal` 先行中止时
 *   false(如宿主停止、或查看时限已到)。
 */
export async function untilQuiet(ctx: Context, agent: Agent, signal: AbortSignal, except?: ReadonlySet<string>): Promise<boolean> {
  for (;;) {
    const subagents = subagentsOf(ctx)
    const children = subagents ? await until(childrenEnd(subagents, agent), signal) : false
    const jobs = await jobsEnd(ctx, agent.id, signal, except)
    if (signal.aborted || agent.status !== 'idle') return false
    if (!children && !jobs) return true
  }
}

/**
 * kill 该 Session 拥有的 shell job(`except` 中的除外),收集每个结束,使 worker 不会
 * 被叫醒来听它。一个失败不阻止其他。
 */
export async function killJobs(ctx: Context, sessionId: string, reason: string, except?: ReadonlySet<string>): Promise<void> {
  const jobs = registry(ctx)
  if (!jobs) return
  const live = owned(jobs, sessionId, except)
  const failures: unknown[] = []
  // 等待先于 kill 开始,使每个结束都算作已收集。
  const collected = live.map(job => jobs.wait(job.id, KILL_WAIT_MS, sessionId).catch(() => undefined))
  for (const job of live) {
    try { jobs.kill(job.id, sessionId, reason) } catch (error) { failures.push(error) }
  }
  await Promise.all(collected)
  if (failures.length) throw new AggregateError(failures, `Killing the shell jobs of ${sessionId} failed`)
}

/**
 * 收集该 Session 拥有的一个 shell job 的结束,使它不唤醒任何人,直到 `signal` 中止。
 * @returns job 结束后的名字与状态;`signal` 先行中止时 undefined。
 */
/** 某个 shell job 的结束汇报:名字与最终状态。 */
interface JobEnd { name: string; status: string }
export async function collectJob(ctx: Context, sessionId: string, job: { id: string; name: string }, signal: AbortSignal):
Promise<JobEnd | undefined> {
  const jobs = registry(ctx)
  while (jobs && !signal.aborted) {
    const view = await jobs.wait(job.id, COLLECT_WAIT_MS, sessionId, signal).catch(() => undefined)
    if (!view) return undefined
    if (!running(view.status)) return { name: job.name, status: view.status }
  }
  return undefined
}

/**
 * 释放 worker 的活跃 subagent,限时。rc.5 的 drain 在 teardown 期间把每个后代的结束
 * 回执注入 worker(不唤醒,故不再开新回合);worker 若仍在跑(自身回合尚未结束、或
 * drain 超时),其回合被取消(keepInbox 时保留其 inbox),该 stop 以那个回合结束。
 * rc.5 的 drain 同时关闭这棵树的派生准入(直到根 agent 被处置):同一根 session 之后
 * 的再派生会被 DRAINING 拒绝;本函数只在 worker 停止/交接路径调用,故不额外绕行。
 */
export async function stopSubagents(ctx: Context, agent: Agent, keepInbox = false): Promise<void> {
  const subagents = subagentsOf(ctx)
  if (!subagents) return
  // rc.5:目录列出整棵树的每个后代(含已结束的持久行);只有驻留的后代仍有 agent。
  // 只释放其自身为根的树——worker 是 assignment 的树根,普通成员不关闭他人树。
  const live = (await subagents.listDescendants(agent.id)).map(child => child.id).filter(id => ctx.agents.get(id as SessionId))
  if (!live.length) return
  try { await until(subagents.drainDescendants([agent]), undefined, DRAIN_LIMIT_MS) }
  finally {
    if (agent.status !== 'idle') cancelled.add(agent)
    agent.cancel({ kind: 'user' }, { keepInbox })
    await until(agent.whenIdle(), undefined, DRAIN_LIMIT_MS)
  }
}

/**
 * worker 的 Assignment 结束后停掉它在后台跑的:kill 其 shell job、释放其 subagent
 * (见 `stopSubagents`)。未加载的 Session 没有在干活的 subagent。一个失败不阻止其他。
 */
export async function stopBackground(ctx: Context, sessionId: string, reason: string, keepInbox = false): Promise<void> {
  const failures: unknown[] = []
  await killJobs(ctx, sessionId, reason).catch((error: unknown) => { failures.push(error) })
  const agent = ctx.agents.get(sessionId as SessionId)
  if (agent) await stopSubagents(ctx, agent, keepInbox).catch((error: unknown) => { failures.push(error) })
  if (failures.length) throw new AggregateError(failures, `Stopping the background work of ${sessionId} failed`)
}
