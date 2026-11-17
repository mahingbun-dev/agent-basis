/**
 * 提问桥单测(2026-11-17):ask_user_question 在多租户 web 前端结构性不可达
 * (网关只把 waterfall 投给 owner peer,session-c9a74388 42 分钟假死)——本桥在宿主
 * 接 user-questions/request,按会话归属暴露给本人浏览器作答。
 * 钉死:归属路由(未知会话透传)、答案批校验(未答全/未知 id/选项不存在/单选多选)、
 * 整卡跳过语义(selected 全空)、超时 ASK_TIMED_OUT、abort ASK_ABORTED、
 * 跨用户拒绝、问题载荷清洗、审计四事件。
 */
import { describe, expect, it } from 'vitest'
import {
  QuestionAbortedError, QuestionBridge, QuestionTimedOutError, userQuestionTimeoutMs,
  sanitizeQuestions, validateAnswers, type UserQuestionView,
} from '../src/question-bridge.ts'
import type { AccessAuditEvent } from '../src/audit.ts'

interface FakeCtx {
  readonly handlers: Map<string, Array<(request: unknown, next: () => unknown) => unknown>>
  on(event: string, listener: (request: unknown, next: () => unknown) => unknown): () => void
}

function fakeCtx(): FakeCtx {
  const handlers = new Map<string, Array<(request: unknown, next: () => unknown) => unknown>>()
  return {
    handlers,
    on(event, listener) {
      const list = handlers.get(event) ?? []
      list.push(listener)
      handlers.set(event, list)
      return () => { handlers.set(event, list.filter(l => l !== listener)) }
    },
  }
}

function questions(): unknown[] {
  return [
    {
      id: 'topic',
      header: '检索主题',
      question: '这次要检索的主题是什么?',
      options: [{ label: 'A' }, { label: 'B', description: '备选' }],
    },
    { id: 'keywords', question: '关键词怎么定?', multiSelect: true, options: [{ label: 'x' }, { label: 'y' }] },
    { id: 'free', question: '还有什么补充?' },
  ]
}

function requestOf(sessionId: string | undefined, extra: { signal?: AbortSignal; callId?: string } = {}): unknown {
  return {
    questions: questions(),
    ...(extra.callId === undefined ? {} : { wait: { callId: extra.callId, timed: false } }),
    agent: { session: { id: sessionId } },
    ...(extra.signal !== undefined ? { signal: extra.signal } : {}),
  }
}

function makeBridge(overrides: Partial<{ sessionOwner: (id: string) => number | undefined; timeoutMs: number }> = {}): {
  bridge: QuestionBridge
  audits: AccessAuditEvent[]
} {
  const audits: AccessAuditEvent[] = []
  const bridge = new QuestionBridge({
    sessionOwner: overrides.sessionOwner ?? (id => (id === 's-7' ? 7 : undefined)),
    audit: (event) => { audits.push(event) },
    timeoutMs: overrides.timeoutMs ?? 60_000,
  })
  return { bridge, audits }
}

function listenerOf(ctx: FakeCtx): (request: unknown, next: () => unknown) => unknown {
  return ctx.handlers.get('user-questions/request')?.[0] as (request: unknown, next: () => unknown) => unknown
}

const fullAnswers = [
  { id: 'topic', selected: ['A'] },
  { id: 'keywords', selected: ['x', 'y'] },
  { id: 'free', selected: [], custom: '补充说明' },
]

describe('question-bridge:installAnswerer', () => {
  it('未知会话 next() 透传;已知归属登记并等待作答', async () => {
    const { bridge } = makeBridge()
    const ctx = fakeCtx()
    bridge.installAnswerer(listener => ctx.on('user-questions/request', listener))
    const listener = listenerOf(ctx)

    const sentinel = { skipped: true }
    expect(listener(requestOf(undefined), () => sentinel)).toBe(sentinel)

    const pending = listener(requestOf('s-7', { callId: 'call_1' }), () => 'unavailable') as Promise<unknown>
    expect(bridge.listFor(7)).toHaveLength(1)
    expect(bridge.listFor(8)).toHaveLength(0)
    const view = bridge.listFor(7)[0] as UserQuestionView
    expect(view.callId).toBe('call_1')
    expect(view.questions).toHaveLength(3)
    bridge.answer(view.id, 7, { answers: fullAnswers })
    await expect(pending).resolves.toEqual({ answers: fullAnswers })
    expect(bridge.listFor(7)).toHaveLength(0) // 作答后条目消失
  })

  it('非对象请求与空问题列表透传', () => {
    const { bridge } = makeBridge()
    const ctx = fakeCtx()
    bridge.installAnswerer(listener => ctx.on('user-questions/request', listener))
    const listener = listenerOf(ctx)
    const sentinel = { skipped: true }
    expect(listener(null, () => sentinel)).toBe(sentinel)
    expect(listener({ questions: [], agent: { session: { id: 's-7' } } }, () => sentinel)).toBe(sentinel)
  })
})

describe('question-bridge:答案校验', () => {
  it('未答全/未知 id/重复作答/未选未填 一律 400 且不收场', () => {
    const { bridge } = makeBridge()
    const ctx = fakeCtx()
    bridge.installAnswerer(listener => ctx.on('user-questions/request', listener))
    void listenerOf(ctx)(requestOf('s-7'), () => 'unavailable')
    const id = bridge.listFor(7)[0]?.id ?? ''

    const missing = bridge.answer(id, 7, { answers: [{ id: 'topic', selected: ['A'] }] })
    expect(missing).toMatchObject({ ok: false, status: 400 })

    const unknown = bridge.answer(id, 7, { answers: [...fullAnswers, { id: 'nope', selected: ['A'] }] })
    expect(unknown).toMatchObject({ ok: false, status: 400 })

    const dup = bridge.answer(id, 7, { answers: [fullAnswers[0], fullAnswers[0], fullAnswers[1], fullAnswers[2]] })
    expect(dup).toMatchObject({ ok: false, status: 400 })

    const badOption = bridge.answer(id, 7, {
      answers: [{ id: 'topic', selected: ['Z'] }, fullAnswers[1], fullAnswers[2]],
    })
    expect(badOption).toMatchObject({ ok: false, status: 400 })

    const singleMulti = bridge.answer(id, 7, {
      answers: [{ id: 'topic', selected: ['A', 'B'] }, fullAnswers[1], fullAnswers[2]],
    })
    expect(singleMulti).toMatchObject({ ok: false, status: 400 })

    expect(bridge.listFor(7)).toHaveLength(1) // 全部拒绝后条目仍在
  })

  it('整卡跳过 → 每题 selected 全空且无 custom(上游 skip 语义)', async () => {
    const { bridge } = makeBridge()
    const ctx = fakeCtx()
    bridge.installAnswerer(listener => ctx.on('user-questions/request', listener))
    const pending = listenerOf(ctx)(requestOf('s-7'), () => 'unavailable') as Promise<{ answers: { id: string; selected: string[]; custom?: string }[] }>
    const id = bridge.listFor(7)[0]?.id ?? ''
    expect(bridge.answer(id, 7, { skip: true })).toEqual({ ok: true })
    const result = await pending
    expect(result.answers.map(item => item.id)).toEqual(['topic', 'keywords', 'free'])
    expect(result.answers.every(item => item.selected.length === 0 && item.custom === undefined)).toBe(true)
  })

  it('跨用户作答一律 404 且条目保留', () => {
    const { bridge } = makeBridge()
    const ctx = fakeCtx()
    bridge.installAnswerer(listener => ctx.on('user-questions/request', listener))
    void listenerOf(ctx)(requestOf('s-7'), () => 'unavailable')
    const id = bridge.listFor(7)[0]?.id ?? ''
    expect(bridge.answer(id, 8, { answers: fullAnswers })).toMatchObject({ ok: false, status: 404 })
    expect(bridge.answer('nope', 7, { answers: fullAnswers })).toMatchObject({ ok: false, status: 404 })
    expect(bridge.listFor(7)).toHaveLength(1)
  })
})

describe('question-bridge:超时与中止', () => {
  it('超时 → ASK_TIMED_OUT(上游 code,tool 层映射 pending)', async () => {
    const { bridge, audits } = makeBridge({ timeoutMs: 25 })
    const ctx = fakeCtx()
    bridge.installAnswerer(listener => ctx.on('user-questions/request', listener))
    const pending = listenerOf(ctx)(requestOf('s-7'), () => 'unavailable') as Promise<unknown>
    await expect(pending).rejects.toBeInstanceOf(QuestionTimedOutError)
    await expect(pending.catch((error: unknown) => (error as { code?: string }).code)).resolves.toBe('ASK_TIMED_OUT')
    expect(bridge.listFor(7)).toHaveLength(0)
    expect(audits.map(e => e.kind)).toContain('access.question.timed-out')
  }, 5_000)

  it('signal abort → ASK_ABORTED 且条目清理', async () => {
    const { bridge, audits } = makeBridge()
    const ctx = fakeCtx()
    bridge.installAnswerer(listener => ctx.on('user-questions/request', listener))
    const controller = new AbortController()
    const pending = listenerOf(ctx)(requestOf('s-7', { signal: controller.signal }), () => 'unavailable') as Promise<unknown>
    controller.abort()
    await expect(pending).rejects.toBeInstanceOf(QuestionAbortedError)
    expect(bridge.listFor(7)).toHaveLength(0)
    expect(audits.map(e => e.kind)).toContain('access.question.aborted')
  })

  it('已中止的 signal 立即收场(不登记)', async () => {
    const { bridge } = makeBridge()
    const ctx = fakeCtx()
    bridge.installAnswerer(listener => ctx.on('user-questions/request', listener))
    const controller = new AbortController()
    controller.abort()
    const pending = listenerOf(ctx)(requestOf('s-7', { signal: controller.signal }), () => 'unavailable') as Promise<unknown>
    await expect(pending).rejects.toBeInstanceOf(QuestionAbortedError)
    expect(bridge.listFor(7)).toHaveLength(0)
  })

  it('abort reason=ASK_TIMED_OUT(上游 timed 定时器)→ 还原 ASK_TIMED_OUT 且审计 timed-out', async () => {
    const { bridge, audits } = makeBridge()
    const ctx = fakeCtx()
    bridge.installAnswerer(listener => ctx.on('user-questions/request', listener))
    const controller = new AbortController()
    const pending = listenerOf(ctx)(requestOf('s-7', { signal: controller.signal }), () => 'unavailable') as Promise<unknown>
    const timedOut = Object.assign(new Error('ask_user_question timed out before the user answered'), { code: 'ASK_TIMED_OUT' })
    controller.abort(timedOut)
    await expect(pending).rejects.toBeInstanceOf(QuestionTimedOutError)
    expect(bridge.listFor(7)).toHaveLength(0)
    const kinds = audits.map(e => e.kind)
    expect(kinds).toContain('access.question.timed-out')
    expect(kinds).not.toContain('access.question.aborted')
  })
})

describe('question-bridge:视图与审计', () => {
  it('审计出 surfaced → answered;视图按时间排序', async () => {
    const { bridge, audits } = makeBridge()
    const ctx = fakeCtx()
    bridge.installAnswerer(listener => ctx.on('user-questions/request', listener))
    void listenerOf(ctx)(requestOf('s-7'), () => 'unavailable')
    void listenerOf(ctx)(requestOf('s-7'), () => 'unavailable')
    const list = bridge.listFor(7)
    expect(list).toHaveLength(2)
    expect(list[0]?.expiresAt).toBeGreaterThan(list[0]?.requestedAt ?? 0)
    expect(list[0]?.questions[0]?.header).toBe('检索主题')
    bridge.answer(list[0]?.id ?? '', 7, { answers: fullAnswers })
    expect(audits.map(e => e.kind)).toEqual([
      'access.question.surfaced', 'access.question.surfaced', 'access.question.answered',
    ])
  })
})

describe('sanitizeQuestions', () => {
  it('坏条目丢弃;合法字段保留;multiSelect 只认真 true', () => {
    const out = sanitizeQuestions([
      null,
      { id: '', question: 'x' },
      { id: 'a', question: 'ok', options: [{ label: 'L1', description: 'D' }, { label: '' }, null] },
      { id: 'b', question: 'm', multiSelect: 'yes' },
      { id: 'c', question: 'm2', multiSelect: true },
    ])
    expect(out.map(item => item.id)).toEqual(['a', 'b', 'c'])
    expect(out[0]?.options).toEqual([{ label: 'L1', description: 'D' }])
    expect(out[1]?.multiSelect).toBeUndefined()
    expect(out[2]?.multiSelect).toBe(true)
  })

  it('非数组输入回空表', () => {
    expect(sanitizeQuestions(undefined)).toEqual([])
    expect(sanitizeQuestions('nope')).toEqual([])
  })
})

describe('validateAnswers', () => {
  const qs = sanitizeQuestions(questions())

  it('合法批通过;纯自定义文本也算作答', () => {
    expect(validateAnswers(qs, fullAnswers)).toMatchObject({ ok: true })
    const custom = validateAnswers(qs, [
      { id: 'topic', selected: [], custom: '自定义主题' },
      { id: 'keywords', selected: ['x'] },
      { id: 'free', selected: [], custom: 'y' },
    ])
    expect(custom).toMatchObject({ ok: true })
  })

  it('空自定义串等于未填(不能靠空白蒙混)', () => {
    expect(validateAnswers(qs, [
      { id: 'topic', selected: [], custom: '   ' },
      { id: 'keywords', selected: ['x'] },
      { id: 'free', selected: [], custom: 'y' },
    ])).toMatchObject({ ok: false })
  })

  it('非数组回错', () => {
    expect(validateAnswers(qs, undefined)).toMatchObject({ ok: false })
  })
})

describe('userQuestionTimeoutMs', () => {
  it('合法 env 生效;非法/缺省回 300s', () => {
    expect(userQuestionTimeoutMs({ ETERNA_USER_QUESTION_TIMEOUT_MS: '9000' })).toBe(9000)
    expect(userQuestionTimeoutMs({})).toBe(300_000)
    expect(userQuestionTimeoutMs({ ETERNA_USER_QUESTION_TIMEOUT_MS: 'nope' })).toBe(300_000)
    expect(userQuestionTimeoutMs({ ETERNA_USER_QUESTION_TIMEOUT_MS: '0' })).toBe(300_000)
  })
})
