/**
 * worker 真回执集成(54 号 T06 / 51 号 RC5-API-005..007):rc.5 subagent 面的
 * `waitForTreeWork` / `listDescendants` / `drainDescendants` 在模拟 DSH 宿主上驱动
 * background.ts 的等待、停止与回执路径,断言子代理 **完成 / 失败 / 取消** 三条路径
 * 的回执都到达 worker(session 历史或被注入),且 drain 后无残留 running。
 *
 * manager 为 rc.5 契约形状的 fixture(本包既有「模拟宿主」口径,api 名与终态
 * `stopReason` 对齐 `dsh-subagent@0.2.2-rc.5` 的 `createSettlementMessage`)。
 */
import type { Agent } from '@deepseek-ai/dsh-agent'
import { afterEach, beforeEach, expect, it } from 'vitest'
import { stopSubagents, untilQuiet } from '../src/executor/background.ts'
import { startHost, type Host } from './fixtures/host.ts'

let h: Host
beforeEach(async () => { h = await startHost() })
afterEach(async () => { await h.stop() })

/** fixture 注册的 agent 形状(主模拟宿主的 RegisteredAgent;类型不经导出,按返回值取)。 */
type HostAgent = NonNullable<ReturnType<Host['agents']['get']>>
/** background.ts 只消费 Agent 面;fixture 的 RegisteredAgent 结构兼容。 */
const asAgent = (agent: HostAgent): Agent => agent as unknown as Agent
/** 主会话 agent;缺席即 fixture 装配坏了。 */
const worker = (): HostAgent => {
  const agent = h.agents.get(h.MAIN)
  if (!agent) throw new Error('主会话 agent 缺席')
  return agent
}
/** 一条持久 user 消息的 rc.5 subagent 回执来源(消息 source 的合并扩展面)。 */
interface SettledSource { kind: string; stopReason?: string; senderSessionId?: string; summary?: string }
const sourceOf = (message: { source: unknown }): SettledSource => message.source as SettledSource
/** 某 session 的持久史里的 subagent 回执。 */
const settlementReceipts = (sessionId: string): { stopReason: string | undefined; sender: string | undefined; text: string }[] =>
  (h.persisted.get(sessionId) ?? []).flatMap((entry) => {
    const event = entry as { type?: unknown; data?: { source?: unknown; content?: { type: string; text?: string }[] } }
    if (event.type !== 'user/message' || !event.data?.source) return []
    const source = sourceOf(event.data as { source: unknown })
    if (source.kind !== 'subagent-settled') return []
    const text = (event.data.content ?? []).map(block => block.type === 'text' ? block.text ?? '' : '').join('\n')
    return [{ stopReason: source.stopReason, sender: source.senderSessionId, text }]
  })
/** 某 agent 经 inject 收到的 subagent 回执(rc.5 teardown 路径:递送但不唤醒)。 */
const injectedReceipts = (agent: HostAgent): SettledSource[] =>
  agent.inject.mock.calls.flatMap(([message]) => {
    const source = sourceOf(message)
    return source.kind === 'subagent-settled' ? [source] : []
  })

it('完成路径:waitForTreeWork 等到整棵树结束,completed 回执都到 worker(不丢)', async () => {
  const first = h.subagents.spawn(h.MAIN)
  const second = h.subagents.spawn(h.MAIN)
  const nested = h.subagents.spawn(first)
  expect([h.subagents.live(first), h.subagents.live(second), h.subagents.live(nested)]).toEqual([true, true, true])
  const stop = new AbortController()
  let quieted = false
  const quiet = untilQuiet(h.ctx, asAgent(worker()), stop.signal).then((value) => { quieted = true; return value })

  // 直接子结束:其回执叫醒 worker,但树里还有别的后代——本次查看不结束。
  h.subagents.settle(first)
  await Promise.resolve()
  expect(quieted).toBe(false)
  expect(settlementReceipts(h.MAIN)).toHaveLength(1)
  // 另一个直接子也结束,孙代仍在跑:整棵树的 join 仍未完成。
  h.subagents.settle(second)
  await Promise.resolve()
  expect(quieted).toBe(false)
  // 最后一个后代结束:join 完成,但回执唤醒的回合让 worker 不再 idle → false。
  h.subagents.settle(nested)
  expect(await quiet).toBe(false)
  // 回合起领取了第一条;steer 进来的第二条在下一步被领取——两条回执都在历史里。
  h.step(h.MAIN)
  const receipts = settlementReceipts(h.MAIN)
  expect(receipts).toHaveLength(2)
  expect(receipts.map(receipt => receipt.stopReason)).toEqual(['completed', 'completed'])
  expect(new Set(receipts.map(receipt => receipt.sender))).toEqual(new Set([first, second]))
  expect(receipts.every(receipt => receipt.text.includes('finished and will do no further work'))).toBe(true)
  // 回执的回合结束后重新查看:没有活后代、没有 job → 安静。
  h.idle(h.MAIN)
  expect(await untilQuiet(h.ctx, asAgent(worker()), new AbortController().signal)).toBe(true)
})

it('失败路径:error 终态回执到达 worker,并当面报告失败', async () => {
  const child = h.subagents.spawn(h.MAIN)
  const quiet = untilQuiet(h.ctx, asAgent(worker()), new AbortController().signal)
  h.subagents.settle(child, 'error')
  expect(await quiet).toBe(false)
  const [receipt] = settlementReceipts(h.MAIN)
  expect(receipt).toMatchObject({ stopReason: 'error', sender: child })
  expect(receipt?.text).toContain('failed before it finished')
  // 结算结束的后代不再占着 worker 槽的查看。
  expect(h.subagents.live(child)).toBe(false)
})

it('取消路径:drainDescendants 停掉整棵树,aborted 回执注入,worker 回合被取消', async () => {
  const child = h.subagents.spawn(h.MAIN)
  const nested = h.subagents.spawn(child)
  h.nextTurn(h.MAIN) // worker 在跑(占着 worker 槽)
  expect(worker().status).toBe('running')
  // 目录列出整棵树(直接子在前、深度优先),与 spawn 的树一致(RC5-API-006)。
  expect((await h.subagents.service.listDescendants(h.MAIN)).map(entry => entry.id)).toEqual([child, nested])

  const agent = worker()
  await stopSubagents(h.ctx, asAgent(agent), false)

  // 释放后目录仍在(持久),但树里没有活着的 agent:无残留 running(RC5-API-007)。
  expect(h.subagents.live(child)).toBe(false)
  expect(h.subagents.live(nested)).toBe(false)
  for (const entry of await h.subagents.service.listDescendants(h.MAIN)) {
    expect(h.agents.get(entry.id)).toBeUndefined()
  }
  expect(await h.subagents.service.waitForTreeWork(asAgent(agent))).toBe(false)
  // teardown 的回执按 rc.5 注入(不唤醒 worker);在跑的直接子终态是 aborted。
  const injected = injectedReceipts(agent)
  expect(injected).toHaveLength(1)
  expect(injected[0]).toMatchObject({ stopReason: 'aborted', senderSessionId: child })
  // 在跑的那个回合不是 worker 自己的:取消(不保留 inbox)并等到 idle。
  // `cancelled` 标记由 executor 的 agent/status idle 处理器当场消费(dsh.ts:535),
  // 故此处只断言可观察面:取消调用与回合结束。
  expect(agent.cancel).toHaveBeenCalledWith({ kind: 'user' }, { keepInbox: false })
  expect(worker().status).toBe('idle')
})
