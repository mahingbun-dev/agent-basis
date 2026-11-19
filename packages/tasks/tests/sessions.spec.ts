/**
 * Sessions.ensure 的 workspace 登记面用例(41 号 A4;上游 0.2.2-rc.1 workspaceRegistry
 * 的幂等复用语义:「Repeated calls for the same canonical path return the existing
 * entity without changing its title」,createCanonical 按 canonical path 扫描复用):
 * - 同 cwd 二次 ensure(session 已在):不走新建路径,workspaceRegistry.create 只发生一次;
 * - 删会话后同 cwd 重 ensure:create 再次被调但复用同一 workspace id(不新建、不改其标题);
 * - 标题解耦:workspace 标题回落宿主缺省(目录末段),会话标题照旧经 rename 写入——
 *   workspace 组与会话不再同名(41-M4 §四『workspace 组名重名』的根因在 ensure 解耦)。
 *
 * 2026-11-19 补 promptHeld(候选卡「被回合收走才起 deadline」的投递语义):
 * 忙碌主会话排队期间不 resolve、claim 后才 resolve;同 requestId 不重发;已入史不重发;
 * 关停中止等待(Effects.drain 不被永不 claim 的消息拖住)。
 */
import { basename } from 'node:path'
import { afterEach, beforeEach, expect, it } from 'vitest'
import { startHost, type Host } from './fixtures/host.ts'

let h: Host
beforeEach(async () => { h = await startHost() })
afterEach(async () => { await h.stop() })

it('同 cwd 两次 ensure:session 已在即复用,workspaceRegistry.create 只发生一次', async () => {
  const cwd = h.store.workspaceDir
  await h.sessions.ensure('orchestrator-dup', cwd, 'eterna-tasks orchestrator', 'orchestrator')
  expect(h.workspaceRegistry.create).toHaveBeenCalledTimes(1)
  expect(h.sessionController.create).toHaveBeenCalledTimes(1)
  expect(h.workspaces.size).toBe(1)
  // 二次 ensure:resolveAgent 已有即取,不再走新建路径——同 cwd 二次 ensure 不新建 workspace。
  await h.sessions.ensure('orchestrator-dup', cwd, 'eterna-tasks orchestrator', 'orchestrator')
  expect(h.workspaceRegistry.create).toHaveBeenCalledTimes(1)
  expect(h.sessionController.create).toHaveBeenCalledTimes(1)
  expect(h.workspaces.size).toBe(1)
})

it('删会话后同 cwd 重 ensure:create 再被调但复用同一 workspace id,不新建、不改其标题', async () => {
  const cwd = h.store.workspaceDir
  await h.sessions.ensure('worker-dup', cwd, '首个会话标题', 'worker')
  expect(h.workspaces.size).toBe(1)
  // 模拟宿主侧删除会话(经 Web UI 删除):resolveAgent 落回 not-found,ensure 走新建路径。
  h.agents.delete('worker-dup')
  await h.sessions.ensure('worker-dup', cwd, '另一个会话标题', 'worker')
  // create 再次被调,但同 path 幂等复用既有登记:仍只有一份 workspace,标题不被新标题覆写。
  expect(h.workspaceRegistry.create).toHaveBeenCalledTimes(2)
  expect(h.workspaces.size).toBe(1)
  const workspace = h.workspaces.get('ws-1')!
  expect(workspace.path).toBe(cwd)
  expect(workspace.title).toBe(basename(cwd))
  // 第二次 ensure 的 session.create 拿到的仍是复用的同一 workspace id(不新建)。
  expect(h.sessionController.create.mock.calls.at(-1)?.[0]).toMatchObject({ workspaceId: 'ws-1' })
})

it('ensure 后标题解耦:workspace 标题=目录末段,会话标题照旧经 rename 写入', async () => {
  const cwd = h.store.workspaceDir
  const title = 'eterna-tasks orchestrator'
  await h.sessions.ensure('orchestrator-title', cwd, title, 'orchestrator')
  // 会话本体标题照旧(ensure 的 rename 半边)。
  expect(h.renamed.get('orchestrator-title')).toBe(title)
  // workspace 标题回落宿主缺省=目录末段,不再取会话标题(侧栏 workspace 组与会话不同名)。
  const workspace = [...h.workspaces.values()].at(-1)!
  expect(workspace.title).toBe(basename(cwd))
  expect(workspace.title).not.toBe(title)
})

it('promptHeld:忙碌主会话排队期间不 resolve,被下一回合 claim 才 resolve(候选卡 deadline 接缝)', async () => {
  const agent = h.agents.get(h.MAIN)!
  // 模拟主会话正在跑长回合:followup 只入 next-turn,inbox 不 claim。
  agent.status = 'running'
  let settled = false
  const pending = h.sessions.promptHeld(h.MAIN, 'candidate:e1', '{"kind":"candidate"}', 'queue')
    .then(() => { settled = true })
  await new Promise(resolve => setTimeout(resolve, 0))
  // 只入 inbox:等待仍在(不把排队时间算作送达)。
  expect(settled).toBe(false)
  expect(agent.inbox.nextTurn).toHaveLength(1)
  expect(h.deliveries.mock.calls.filter(([call]) => call.sessionId === h.MAIN && call.mode === 'queue')).toHaveLength(1)
  // 回合结束、下一回合领取排队消息(agent/inbox/claimed)→ resolve 并纳入持久史。
  h.nextTurn(h.MAIN)
  await pending
  expect(settled).toBe(true)
  expect(h.persisted.get(h.MAIN)).toHaveLength(1)
})

it('promptHeld 按 requestId 幂等:同一 requestId 排队中不重发,全部等待被同一次 claim 唤醒', async () => {
  const agent = h.agents.get(h.MAIN)!
  agent.status = 'running'
  const first = h.sessions.promptHeld(h.MAIN, 'candidate:e2', 'card', 'queue')
  const second = h.sessions.promptHeld(h.MAIN, 'candidate:e2', 'card', 'queue')
  await new Promise(resolve => setTimeout(resolve, 0))
  expect(h.deliveries.mock.calls.filter(([call]) => call.sessionId === h.MAIN)).toHaveLength(1)
  h.nextTurn(h.MAIN)
  await Promise.all([first, second])
  expect(h.deliveries.mock.calls.filter(([call]) => call.sessionId === h.MAIN)).toHaveLength(1)
})

it('promptHeld:已入史即视为已送达,不重发', async () => {
  // 闲置 agent:followup 立即开回合并 claim,首次调用即 resolve。
  await h.sessions.promptHeld(h.MAIN, 'candidate:e3', 'card', 'queue')
  const before = h.deliveries.mock.calls.length
  await h.sessions.promptHeld(h.MAIN, 'candidate:e3', 'card', 'queue')
  expect(h.deliveries.mock.calls.length).toBe(before)
})

it('promptHeld:关停中止等待(Effects.drain 不被永不 claim 的消息拖住)', async () => {
  const agent = h.agents.get(h.MAIN)!
  agent.status = 'running'
  const pending = h.sessions.promptHeld(h.MAIN, 'candidate:e4', 'card', 'queue')
  await new Promise(resolve => setTimeout(resolve, 0))
  h.lifetime.abort()
  await expect(pending).rejects.toThrow()
})
