/**
 * 参谋会话资源提供者单测(P5)。
 *
 * 这个提供者是「刷新后 tab 还能恢复成真实对话」的**唯一**保证:布局持久化只存
 * contentId,地址→引用这一步必须成立。因此逐条钉住:
 *
 * 1. 合法地址 → 一帧 ok,值里带 primaryParent/child 与已持有的引用;
 * 2. **引用只在 abort 时释放**(提前释放会让会话作用域在下一帧被拆,面板空白);
 * 3. 未识别地址 / retain 抛错 → 失败帧(**不是 throw**;流内 throw 按上游契约
 *    属于编程错误,资源会永远停在 loading);
 * 4. 打开前先刷父会话投影(subagent 子会话的可解析性来自父 catalog);
 * 5. abort 先于打开 → 不 retain、不产出帧。
 */
import { describe, expect, it } from 'vitest'
import { adviserChatAddress } from '../src/client/address.ts'
import { ADVISER_REFERENCE_SOURCE, createAdviserChatProvider } from '../src/client/resource.ts'
import type { SessionsFace } from '../src/client/client-types.ts'

interface RetainCall {
  readonly target: string
  readonly source: string
  readonly signal: AbortSignal | undefined
}

/** 造一个可控的会话服务假件。 */
function fakeSessions(options?: {
  retainError?: Error
  refreshError?: Error
}): { sessions: SessionsFace; retainCalls: RetainCall[]; released: string[]; refreshed: string[] } {
  const retainCalls: RetainCall[] = []
  const released: string[] = []
  const refreshed: string[] = []
  const sessions: SessionsFace = {
    retain(target, opts) {
      retainCalls.push({ target, source: opts.source, signal: opts.signal })
      if (options?.retainError !== undefined) throw options.retainError
      return {
        sessionId: target,
        release: () => { released.push(target) },
      }
    },
    refreshProjections: async (sessionId) => {
      refreshed.push(sessionId)
      if (options?.refreshError !== undefined) throw options.refreshError
    },
  }
  return { sessions, retainCalls, released, refreshed }
}

describe('createAdviserChatProvider', () => {
  it('协议名 = adviserchat(与地址协议一致)', () => {
    const { sessions } = fakeSessions()
    expect(createAdviserChatProvider(sessions).protocol).toBe('adviserchat')
  })

  it('合法地址:先刷父投影,再 retain 子会话,产出一帧 ok', async () => {
    const { sessions, retainCalls, refreshed } = fakeSessions()
    const provider = createAdviserChatProvider(sessions)
    const controller = new AbortController()
    const stream = provider.open(adviserChatAddress('main', 'main--adviser-1'), { signal: controller.signal })
    const iterator = stream[Symbol.asyncIterator]()
    const first = await iterator.next()
    expect(first.done).toBe(false)
    const frame = first.value as {
      ok: boolean
      value?: { childSessionId: string; parentSessionId: string; reference: { sessionId: string } }
    }
    expect(frame.ok).toBe(true)
    expect(frame.value?.childSessionId).toBe('main--adviser-1')
    expect(frame.value?.parentSessionId).toBe('main')
    expect(frame.value?.reference.sessionId).toBe('main--adviser-1')
    // 父投影先刷(subagent 子会话的可解析性来源),再 retain。
    expect(refreshed).toEqual(['main'])
    expect(retainCalls).toEqual([{ target: 'main--adviser-1', source: ADVISER_REFERENCE_SOURCE, signal: controller.signal }])
  })

  it('引用只在 abort 后释放(提前释放 = 会话作用域被拆 = 面板空白)', async () => {
    const { sessions, released } = fakeSessions()
    const provider = createAdviserChatProvider(sessions)
    const controller = new AbortController()
    const iterator = provider.open(adviserChatAddress('main', 'child'), { signal: controller.signal })[Symbol.asyncIterator]()
    await iterator.next()
    // 产出第一帧之后、abort 之前:一个引用都不能释放。
    expect(released).toEqual([])
    controller.abort()
    const second = await iterator.next()
    expect(second.done).toBe(true)
    expect(released).toEqual(['child'])
  })

  it('abort 后重复 next 不会二次释放(release 幂等由引用自身保证,这里断言只调一次)', async () => {
    const { sessions, released } = fakeSessions()
    const provider = createAdviserChatProvider(sessions)
    const controller = new AbortController()
    const iterator = provider.open(adviserChatAddress('main', 'child'), { signal: controller.signal })[Symbol.asyncIterator]()
    await iterator.next()
    controller.abort()
    await iterator.next()
    await iterator.return?.()
    expect(released).toEqual(['child'])
  })

  it('未识别地址 → 失败帧,不 retain', async () => {
    const { sessions, retainCalls } = fakeSessions()
    const provider = createAdviserChatProvider(sessions)
    const controller = new AbortController()
    const frames: { ok: boolean }[] = []
    for await (const frame of provider.open('dsh-resource://subagentchat/session/c?parent=m&mode=continuable', { signal: controller.signal })) {
      frames.push(frame)
    }
    expect(frames).toHaveLength(1)
    expect(frames[0]?.ok).toBe(false)
    expect(retainCalls).toEqual([])
  })

  it('retain 抛错 → 失败帧(不 throw,资源不能永远 loading)', async () => {
    const { sessions } = fakeSessions({ retainError: new Error('sessions.retain: unknown session child') })
    const provider = createAdviserChatProvider(sessions)
    const controller = new AbortController()
    const frames: { ok: boolean }[] = []
    for await (const frame of provider.open(adviserChatAddress('main', 'child'), { signal: controller.signal })) {
      frames.push(frame)
    }
    expect(frames).toHaveLength(1)
    expect(frames[0]?.ok).toBe(false)
  })

  it('父投影刷新失败不致命(会话可能已在列表里),仍产出 ok 帧', async () => {
    const { sessions, retainCalls } = fakeSessions({ refreshError: new Error('projection unavailable') })
    const provider = createAdviserChatProvider(sessions)
    const controller = new AbortController()
    const stream = provider.open(adviserChatAddress('main', 'child'), { signal: controller.signal })
    const iterator = stream[Symbol.asyncIterator]()
    const first = await iterator.next()
    expect((first.value as { ok: boolean }).ok).toBe(true)
    expect(retainCalls).toHaveLength(1)
    controller.abort()
    await iterator.next()
  })

  it('abort 先于打开 → 不 retain、不产出帧', async () => {
    const { sessions, retainCalls } = fakeSessions()
    const provider = createAdviserChatProvider(sessions)
    const controller = new AbortController()
    controller.abort()
    const frames: unknown[] = []
    for await (const frame of provider.open(adviserChatAddress('main', 'child'), { signal: controller.signal })) {
      frames.push(frame)
    }
    expect(frames).toEqual([])
    expect(retainCalls).toEqual([])
  })

  it('引用来源标签进 retainedBy 观测(排障时可区分参谋面板与主视图)', () => {
    expect(ADVISER_REFERENCE_SOURCE).toBe('adviserPanel')
  })
})
