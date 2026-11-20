/**
 * worker 后台工作面:untilQuiet / stopBackground / stopSubagents 与 job 的收集与唤醒
 * (35 号 A14 验收门禁;34 号 §4-E background 行「untilQuiet/stopBackground/jobs 收集,
 * 27 号 §2.2 点名参考」)。语义自 SA tests/background.spec.ts 同构移植,跑在模拟
 * DSH 宿主件(jobRegistry/subagentRuntime)上。
 */
import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { expect, it, vi } from 'vitest'
import { SessionId } from '@deepseek-ai/dsh-session'
import { collectJob, killJobs, runningJobs, stopBackground, stopSubagents, untilQuiet } from '../src/executor/background.ts'
import { jobRegistry } from './fixtures/host.ts'

/** 一个带 DSH job 注册表与 subagent 面的 context,和一个 idle 的 worker agent(带一个活 subagent `child-1`)。 */
function setup(waitForTreeWork: (agent: Agent) => Promise<boolean>, drainDescendants: () => Promise<void> = async () => {}) {
  const jobs = jobRegistry()
  const agent = {
    id: 'worker-t1', status: 'idle', whenIdle: async () => {}, inbox: { nextTurn: [], nextStep: [] }, cancel: vi.fn(),
  } as unknown as Agent & { status: string; cancel: ReturnType<typeof vi.fn> }
  const subagents = { waitForTreeWork: vi.fn(waitForTreeWork), listDescendants: async () => [{ id: 'child-1' }], drainDescendants: vi.fn(drainDescendants) }
  const services: Record<string, unknown> = { jobs: jobs.service, subagents }
  const ctx = { get: (name: string) => services[name], agents: { get: (id: string) => (id === 'child-1' ? { id } : agent) } } as unknown as Context
  return { ctx, agent, jobs, subagents }
}

it('subagent 检查期间被结束唤醒的 worker 不算安静:它自己的 idle 再看新一轮', async () => {
  const { ctx, agent, jobs } = setup(async () => {
    // job 在此期间结束,其结束唤醒 worker。
    jobs.end(id)
    ;(agent as { status: string }).status = 'running'
    return false
  })
  const id = jobs.run('worker-t1')
  expect(await untilQuiet(ctx, agent, new AbortController().signal)).toBe(false)
})

it('宿主停止后不再等待永不结束的 subagent', async () => {
  let joining!: () => void
  const joined = new Promise<void>((resolve) => { joining = resolve })
  const { ctx, agent } = setup(() => { joining(); return new Promise(() => {}) })
  const stop = new AbortController()
  const quiet = untilQuiet(ctx, agent, stop.signal)
  // 等其 subagent 的 join 在跑时宿主停止。
  await joined
  stop.abort()
  expect(await quiet).toBe(false)
})

it('只有 job 结束才再看一眼:吵闹 job 的每次输出不看', async () => {
  const { ctx, agent, jobs } = setup(async () => false)
  const id = jobs.run('worker-t1')
  const stop = new AbortController()
  const quiet = untilQuiet(ctx, agent, stop.signal)
  await new Promise(resolve => setTimeout(resolve, 0))
  const looked = jobs.service.list.mock.calls.length
  for (let line = 0; line < 100; line++) jobs.output(id)
  expect(jobs.service.list.mock.calls.length).toBe(looked)
  jobs.end(id)
  expect(await quiet).toBe(true)
})

it('释放 subagent 的 teardown 失败照样取消 worker 回合,并把失败抛给调用方', async () => {
  // rc.5 drainDescendants 以树根数组为参;teardown 失败在全部落定后抛 SubagentError,
  // stopSubagents 的 finally 仍须取消 worker(其回合被 release 期间的回执唤醒)。
  const { ctx, agent, subagents } = setup(async () => false, async () => { throw new Error('teardown failed') })
  await expect(stopSubagents(ctx, agent)).rejects.toThrow('teardown failed')
  expect(subagents.drainDescendants).toHaveBeenCalledWith([agent])
  expect(agent.cancel).toHaveBeenCalledWith({ kind: 'user' }, { keepInbox: false })
})

it('等待 subagent 的多次查看只 join 一次(DSH 无法取消该 join)', async () => {
  const { ctx, agent, subagents } = setup(() => new Promise(() => {}))
  for (let look = 0; look < 3; look++) {
    const stop = new AbortController()
    const quiet = untilQuiet(ctx, agent, stop.signal)
    stop.abort()
    expect(await quiet).toBe(false)
  }
  expect(subagents.waitForTreeWork).toHaveBeenCalledTimes(1)
})

it('10 秒内不结束的 subagent 释放被放弃,且其结束唤醒的回合被取消', async () => {
  const { ctx, agent } = setup(async () => false, () => new Promise(() => {}))
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
  try {
    let stopped = false
    const stopping = stopSubagents(ctx, agent).then(() => { stopped = true })
    await vi.advanceTimersByTimeAsync(9_999)
    expect(stopped).toBe(false)
    await vi.advanceTimersByTimeAsync(1)
    await stopping
  }
  finally { vi.useRealTimers() }
  expect(agent.cancel).toHaveBeenCalledWith({ kind: 'user' }, { keepInbox: false })
})

it('killJobs 只杀该 session 拥有的在跑 job,收集其结束(不再唤醒 owner)', async () => {
  const { ctx, agent, jobs } = setup(async () => false)
  const own = jobs.run('worker-t1', 'serve\n--port 3000'), other = jobs.run('someone-else')
  expect(runningJobs(ctx, 'worker-t1')).toEqual([{ id: own, name: `${own} (serve)` }])
  await killJobs(ctx, 'worker-t1', 'The job ran past its limit')
  expect(jobs.service.list('worker-t1').find(job => job.id === own)?.status).toBe('killed')
  expect(jobs.service.list('worker-t1').find(job => job.id === other)?.status).toBeUndefined()
  // kill 前先挂的等待收集到了结束(released 计数),没有未收集的结束去唤醒 owner
  expect(jobs.released).toBe(1)
  expect((agent as unknown as { cancel: ReturnType<typeof vi.fn> }).cancel).not.toHaveBeenCalled()
})

it('collectJob 收集一个 job 的结束并汇报其状态;未被收集的结束唤醒闲着的 owner', async () => {
  const followup = vi.fn()
  const jobs = jobRegistry(() => ({ id: 'worker-t1', status: 'idle', followup, whenIdle: async () => {}, inbox: { nextTurn: [], nextStep: [] } }) as never)
  const services: Record<string, unknown> = { jobs: jobs.service }
  const ctx = { get: (name: string) => services[name], agents: { get: () => undefined } } as unknown as Context
  const id = jobs.run('worker-t1', 'build')
  const collecting = collectJob(ctx, 'worker-t1', { id, name: `${id} (build)` }, new AbortController().signal)
  jobs.end(id, 'failed')
  expect(await collecting).toEqual({ name: `${id} (build)`, status: 'failed' })
  // 被收集的结束不唤醒 owner;下一个没有被收集的结束才唤醒(followup)
  const uncollected = jobs.run('worker-t1', 'watch')
  jobs.end(uncollected)
  expect(followup).toHaveBeenCalledOnce()
})

it('stopBackground 停掉 job 与 subagent,job 的 kill 失败也照样释放 subagent', async () => {
  const { ctx, agent, jobs, subagents } = setup(async () => false, async () => {})
  const id = jobs.run('worker-t1')
  jobs.service.kill.mockImplementationOnce(() => { throw new Error('kill refused') })
  const stopping = stopBackground(ctx, SessionId('worker-t1'), 'assignment ended')
  jobs.end(id) // kill 被拒后 job 由别处结束;killJobs 的等待收集到它后放弃
  // kill 失败被聚合抛出——但 subagent 的释放照跑、agent 的回合被取消
  await expect(stopping).rejects.toThrow('Stopping the background work of worker-t1 failed')
  expect(jobs.service.list('worker-t1').find(job => job.id === id)?.status).toBe('completed')
  expect(subagents.drainDescendants).toHaveBeenCalled()
  expect(agent.cancel).toHaveBeenCalledWith({ kind: 'user' }, { keepInbox: false })
})
