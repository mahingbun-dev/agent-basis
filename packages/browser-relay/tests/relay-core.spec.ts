import { describe, expect, it } from 'vitest'
import type { RelayToExt } from '../src/protocol.ts'
import { RelayCore, type ExtLink } from '../src/relay-core'

/** 测试桩：模拟扩展腿（响应可编程），捕获全部下行帧 */
function makeMockExt(opts?: { chromeVersion?: string }) {
  const sent: RelayToExt[] = []
  let responder: (frame: RelayToExt) => { ok: true; result: unknown } | { ok: false; error: { code: string; message: string } } | null =
    (frame) => {
      // 默认响应：attach/cmd 全部成功；tabs.list 返回两个 tab（一可操作一不可操作）
      if (frame.t === 'tabs.list') {
        return {
          ok: true,
          result: [
            { tabId: 11, title: 'Fixture', url: 'http://127.0.0.1:9319/fixture', active: true, eligible: true },
            { tabId: 12, title: '设置', url: 'chrome://settings/', active: false, eligible: false },
          ],
        }
      }
      return { ok: true, result: {} }
    }
  const link: ExtLink = {
    send(frame: RelayToExt) {
      sent.push(frame)
      const reply = responder(frame)
      if (reply !== null) {
        const id = (frame as { id: number }).id
        const result = reply.ok ? core.onExtFrame({ t: 'result', id, ok: true, result: reply.result }) : core.onExtFrame({ t: 'result', id, ok: false, error: reply.error })
        void result
      }
    },
    extVersion: '0.1.0',
    chromeVersion: opts?.chromeVersion ?? '157.0.0.0',
  }
  const core = new RelayCore()
  return { core, link, sent, setResponder: (r: typeof responder) => (responder = r) }
}

/** 测试桩：模拟 playwright CDP 客户端，捕获下行消息并提供 request 助手 */
function makeMockCdp(core: RelayCore) {
  const messages: Array<Record<string, unknown>> = []
  core.setCdp({
    send(msg: unknown) {
      messages.push(msg as Record<string, unknown>)
    },
  })
  let seq = 1
  return {
    messages,
    async request(method: string, params: Record<string, unknown> = {}, sessionId?: string): Promise<Record<string, unknown>> {
      const id = seq++
      const p = core.handleClientMessage({ id, method, params, sessionId })
      void p
      // dispatch 是异步的：等待本轮微任务清空
      for (let i = 0; i < 20; i++) {
        await new Promise(r => setTimeout(r, 1))
        const reply = messages.find(m => m['id'] === id)
        if (reply !== undefined) return reply
      }
      throw new Error('客户端请求无响应：' + method)
    },
    async untilEvent(method: string, timeoutMs = 500): Promise<Record<string, unknown>> {
      const start = Date.now()
      for (;;) {
        const found = messages.find(m => m['method'] === method)
        if (found !== undefined) return found
        if (Date.now() - start > timeoutMs) throw new Error('等待事件超时：' + method)
        await new Promise(r => setTimeout(r, 1))
      }
    },
  }
}

describe('RelayCore（E1-T2 中继核心）', () => {
  it('握手拒绝协议不匹配', async () => {
    const { core, link } = makeMockExt()
    await expect(core.onExtHello(link, { t: 'hello', proto: 99, ext: 'x', extVersion: '1' })).rejects.toThrow(/PROTO_MISMATCH/)
  })

  it('setAutoAttach 只自动挂载可操作目标并发出 attachedToTarget', async () => {
    const mock = makeMockExt()
    await mock.core.onExtHello(mock.link, { t: 'hello', proto: 1, ext: 'eterna-companion', extVersion: '0.1.0' })
    const cdp = makeMockCdp(mock.core)
    const r = await cdp.request('Target.setAutoAttach', { autoAttach: true, flatten: true })
    expect(r['result']).toEqual({})
    const evt = await cdp.untilEvent('Target.attachedToTarget')
    expect(evt['params']).toMatchObject({ targetInfo: { targetId: '11', type: 'page', attached: true } })
    // chrome:// 的 tab(12) 不被挂载：发过的 attach 帧只针对 tab 11
    const attachFrames = mock.sent.filter(f => f.t === 'attach')
    expect(attachFrames).toHaveLength(1)
    expect((attachFrames[0] as { tabId: number }).tabId).toBe(11)
  })

  it('session 命令转发到对应 tab，结果带回原 id', async () => {
    const mock = makeMockExt()
    await mock.core.onExtHello(mock.link, { t: 'hello', proto: 1, ext: 'eterna-companion', extVersion: '0.1.0' })
    const cdp = makeMockCdp(mock.core)
    const att = await cdp.request('Target.attachToTarget', { targetId: '11', flatten: true })
    const sessionId = (att['result'] as { sessionId: string }).sessionId
    mock.setResponder((frame) => {
      if (frame.t === 'cmd' && frame.method === 'Page.navigate') {
        return { ok: true, result: { frameId: 'F', loaderId: 'L' } }
      }
      return { ok: true, result: {} }
    })
    const r = await cdp.request('Page.navigate', { url: 'https://example.com/' }, sessionId)
    const cmdFrames = mock.sent.filter(f => f.t === 'cmd' && f.method === 'Page.navigate')
    expect(cmdFrames).toHaveLength(1)
    expect((cmdFrames[0] as { tabId: number }).tabId).toBe(11)
    expect(r['result']).toEqual({ frameId: 'F', loaderId: 'L' })
    expect(r['sessionId']).toBe(sessionId)
  })

  it('debugger 事件按 session 回传给 CDP 客户端', async () => {
    const mock = makeMockExt()
    await mock.core.onExtHello(mock.link, { t: 'hello', proto: 1, ext: 'eterna-companion', extVersion: '0.1.0' })
    const cdp = makeMockCdp(mock.core)
    await cdp.request('Target.attachToTarget', { targetId: '11', flatten: true })
    await mock.core.onExtFrame({ t: 'event', tabId: 11, method: 'Page.loadEventFired', params: {} })
    const evt = await cdp.untilEvent('Page.loadEventFired')
    expect(evt['sessionId']).toBeTypeOf('string')
  })

  it('扩展端 detached → Inspector.detached 且会话清理', async () => {
    const mock = makeMockExt()
    await mock.core.onExtHello(mock.link, { t: 'hello', proto: 1, ext: 'eterna-companion', extVersion: '0.1.0' })
    const cdp = makeMockCdp(mock.core)
    await cdp.request('Target.attachToTarget', { targetId: '11', flatten: true })
    await mock.core.onExtFrame({ t: 'detached', tabId: 11, reason: '用户点黄条 Cancel' })
    const evt = await cdp.untilEvent('Inspector.detached')
    expect((evt['params'] as { reason: string }).reason).toBe('canceled_by_user')
    // 之后该 session 命令应报未知 session
    const r = await cdp.request('Runtime.enable', {}, '100')
    expect(r['error']).toBeDefined()
  })

  it('tab.removed → Target.targetDestroyed', async () => {
    const mock = makeMockExt()
    await mock.core.onExtHello(mock.link, { t: 'hello', proto: 1, ext: 'eterna-companion', extVersion: '0.1.0' })
    const cdp = makeMockCdp(mock.core)
    await mock.core.onExtFrame({ t: 'tab.removed', tabId: 11 })
    const evt = await cdp.untilEvent('Target.targetDestroyed')
    expect((evt['params'] as { targetId: string }).targetId).toBe('11')
  })

  it('不可操作目标 attach 被拒（INELIGIBLE_TARGET）', async () => {
    const mock = makeMockExt()
    await mock.core.onExtHello(mock.link, { t: 'hello', proto: 1, ext: 'eterna-companion', extVersion: '0.1.0' })
    const cdp = makeMockCdp(mock.core)
    mock.setResponder((frame) => {
      if (frame.t === 'attach') return { ok: false, error: { code: 'INELIGIBLE_TARGET', message: 'chrome:// 属不可操作目标' } }
      return { ok: true, result: {} }
    })
    const r = await cdp.request('Target.attachToTarget', { targetId: '12', flatten: true })
    expect(r['error']).toBeDefined()
    expect((r['error'] as { message: string }).message).toContain('INELIGIBLE_TARGET')
  })

  it('未知浏览器级方法返回 -32601', async () => {
    const mock = makeMockExt()
    await mock.core.onExtHello(mock.link, { t: 'hello', proto: 1, ext: 'eterna-companion', extVersion: '0.1.0' })
    const cdp = makeMockCdp(mock.core)
    const r = await cdp.request('Browser.someUnknownMethod', {})
    expect((r['error'] as { code: number }).code).toBe(-32601)
  })

  it('扩展断开 → 会话全部 Inspector.detached', async () => {
    const mock = makeMockExt()
    await mock.core.onExtHello(mock.link, { t: 'hello', proto: 1, ext: 'eterna-companion', extVersion: '0.1.0' })
    const cdp = makeMockCdp(mock.core)
    await cdp.request('Target.attachToTarget', { targetId: '11', flatten: true })
    mock.core.setExt(null)
    const evt = await cdp.untilEvent('Inspector.detached')
    expect((evt['params'] as { reason: string }).reason).toBe('target_closed')
    expect(mock.core.extensionConnected).toBe(false)
  })

  it('Target.createTarget 建新 tab 并返回 targetId', async () => {
    const mock = makeMockExt()
    await mock.core.onExtHello(mock.link, { t: 'hello', proto: 1, ext: 'eterna-companion', extVersion: '0.1.0' })
    const cdp = makeMockCdp(mock.core)
    mock.setResponder((frame) => {
      if (frame.t === 'tab.new') {
        void mock.core.onExtFrame({ t: 'tab.created', tab: { tabId: 21, title: '', url: 'http://127.0.0.1:9319/fixture', active: true, eligible: true } })
        return { ok: true, result: { tabId: 21 } }
      }
      return { ok: true, result: {} }
    })
    const r = await cdp.request('Target.createTarget', { url: 'http://127.0.0.1:9319/fixture' })
    expect((r['result'] as { targetId: string }).targetId).toBe('21')
  })
})
