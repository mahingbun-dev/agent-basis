/**
 * 思考强度自动模式:宿主路由器(agent/inbox/inserted 监听)与 store 开关/迁移。
 * 路由器用结构替身(零 cordis 依赖):关键断言=同步语义下 select 的调用与否与实参。
 */
import { DatabaseSync } from 'node:sqlite'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { installThinkingAuto, type InboxInsertedPayload } from '../src/thinking-auto.ts'
import { UserStore } from '../src/store.ts'
import type { AccessAuditEvent } from '../src/audit.ts'

const flush = async (): Promise<void> => {
  await new Promise(resolve => setTimeout(resolve, 0))
  await new Promise(resolve => setTimeout(resolve, 0))
}

/** 结构替身:可编程 llm 面 + 归属 store 面 + 会话窗口面。 */
function makeHarness(options: {
  readonly effortIds?: readonly string[]
  readonly resolveHang?: boolean
  readonly bias?: { readonly bias: number; readonly updatedAt: number }
  readonly events?: readonly unknown[]
  readonly seq?: number
  readonly snapshotThrows?: boolean
} = {}) {
  const selectCalls: Array<{ provider: string; model: string; reasoningEffort?: string }> = []
  const audits: AccessAuditEvent[] = []
  const resolveCalls: Array<{ provider: string; model: string }> = []
  const snapshotCalls: number[] = []
  let registered: ((payload: InboxInsertedPayload) => void) | undefined
  let offCount = 0
  const llm = {
    listProviders: () => [{ id: 'prov' }],
    listModels: (_provider: string) => Promise.resolve(options.effortIds === undefined ? [] : [{ id: 'model-a' }]),
    resolveModelInfo: (_provider: string, model: string, signal?: AbortSignal) => {
      resolveCalls.push({ provider: _provider, model })
      if (signal?.aborted) return Promise.reject(new Error('aborted'))
      if (options.resolveHang === true) return new Promise(() => { /* 悬挂=缓存永不热 */ })
      return Promise.resolve({ reasoning: { efforts: (options.effortIds ?? ['low', 'medium', 'high']).map(id => ({ id, name: id })) } })
    },
  }
  const agentFor = (sessionId: string, selection: unknown) => ({
    session: {
      id: sessionId,
      ...(options.seq === undefined ? {} : { seq: options.seq }),
      ...(options.events === undefined ? {} : {
        snapshotEvents: (fromSeq: number): readonly unknown[] => {
          snapshotCalls.push(fromSeq)
          if (options.snapshotThrows === true) throw new Error('log unavailable')
          return options.events as readonly unknown[]
        },
      }),
    },
    model: {
      current: () => selection,
      select: (s: { provider: string; model: string; reasoningEffort?: string }) => { selectCalls.push(s) },
    },
  })
  const dispose = installThinkingAuto(
    {
      store: {
        thinkingAutoOf: (id: string) => id === 's-on',
        ...(options.bias === undefined ? {} : { thinkingBiasOf: () => options.bias }),
      },
      llm,
      audit: (event: AccessAuditEvent) => { audits.push(event) },
    },
    (_event, listener) => {
      registered = listener
      return () => { offCount += 1 }
    },
  )
  const fire = (payload: InboxInsertedPayload): void => { registered?.(payload) }
  return { selectCalls, audits, resolveCalls, snapshotCalls, agentFor, fire, dispose, get offCount(): number { return offCount } }
}

function userMessage(text: string, kind: unknown = 'user', extra: Record<string, unknown> = {}): NonNullable<InboxInsertedPayload['message']> {
  return { content: [{ type: 'text', text }], source: { kind }, ...extra }
}

describe('thinking-auto 路由器', () => {
  it('自动开启+档位表已热:寒暄落最低档,显式深入落最高档;审计带 score/effort', async () => {
    const h = makeHarness({ effortIds: ['low', 'medium', 'high'] })
    await flush() // warmCatalog 预热 prov/model-a
    expect(h.resolveCalls).toEqual([{ provider: 'prov', model: 'model-a' }])
    h.fire({ agent: h.agentFor('s-on', { provider: 'prov', model: 'model-a' }), message: userMessage('你好') })
    expect(h.selectCalls).toEqual([{ provider: 'prov', model: 'model-a', reasoningEffort: 'low' }])
    expect(h.audits).toHaveLength(1)
    expect(h.audits[0]).toMatchObject({ kind: 'access.thinking.auto', detail: { sessionId: 's-on', effort: 'low' } })
    h.fire({ agent: h.agentFor('s-on', { provider: 'prov', model: 'model-a', reasoningEffort: 'low' }), message: userMessage('请深入思考这个架构的根因') })
    expect(h.selectCalls[1]).toMatchObject({ reasoningEffort: 'high' })
    h.dispose()
  })

  it('同档 no-op:已选档=应选档时不调 select、不审计', async () => {
    const h = makeHarness({ effortIds: ['low', 'medium', 'high'] })
    await flush()
    h.fire({ agent: h.agentFor('s-on', { provider: 'prov', model: 'model-a', reasoningEffort: 'low' }), message: userMessage('你好') })
    expect(h.selectCalls).toHaveLength(0)
    expect(h.audits).toHaveLength(0)
    h.dispose()
  })

  it('自动关闭/未知会话:完全不介入', async () => {
    const h = makeHarness({ effortIds: ['low', 'medium', 'high'] })
    await flush()
    h.fire({ agent: h.agentFor('s-off', { provider: 'prov', model: 'model-a' }), message: userMessage('你好') })
    expect(h.selectCalls).toHaveLength(0)
    expect(h.audits).toHaveLength(0)
    h.dispose()
  })

  it('缓存未命中=fail-neutral:本轮不改选,后台预热被触发', async () => {
    const h = makeHarness({ resolveHang: true })
    await flush() // listModels 空 ⇒ 目录预热不覆盖;留悬挂 resolve 供本轮未命中路径
    h.fire({ agent: h.agentFor('s-on', { provider: 'prov', model: 'model-a' }), message: userMessage('分析一下') })
    expect(h.selectCalls).toHaveLength(0)
    expect(h.resolveCalls.some(c => c.model === 'model-a')).toBe(true)
    h.dispose()
  })

  it('无档位声明模型:不选档(预热后到也不回补本轮——同步窗口已过)', async () => {
    const h = makeHarness()
    await flush()
    h.fire({ agent: h.agentFor('s-on', { provider: 'prov', model: 'no-reasoning' }), message: userMessage('分析一下') })
    expect(h.selectCalls).toHaveLength(0)
    h.dispose()
  })

  it('非真人源(model-selection notice/提问桥)与缺 agent 载荷:跳过', async () => {
    const h = makeHarness({ effortIds: ['low', 'medium', 'high'] })
    await flush()
    h.fire({ agent: h.agentFor('s-on', { provider: 'prov', model: 'model-a' }), message: userMessage('请深入思考', 'model-selection') })
    h.fire({ agent: h.agentFor('s-on', { provider: 'prov', model: 'model-a' }), message: userMessage('请深入思考', 'user-question-answer') })
    h.fire({ message: userMessage('请深入思考') })
    expect(h.selectCalls).toHaveLength(0)
    expect(h.audits).toHaveLength(0)
    h.dispose()
  })

  it('store/select 抛错不外溢:吞掉并审计 ok:false,不向 emit 分发外溢', async () => {
    // 前置关(store.thinkingAutoOf 抛错)——监听体必须吞掉
    const storeAudits: AccessAuditEvent[] = []
    let storeListener: ((payload: InboxInsertedPayload) => void) | undefined
    const disposeStore = installThinkingAuto(
      {
        store: { thinkingAutoOf: () => { throw new Error('db locked') } },
        llm: { listProviders: () => [], listModels: () => Promise.resolve([]), resolveModelInfo: () => Promise.resolve({}) },
        audit: (event: AccessAuditEvent) => { storeAudits.push(event) },
      },
      (_event, listener) => { storeListener = listener; return () => {} },
    )
    expect(() => { storeListener?.({ agent: { session: { id: 'x' } }, message: userMessage('你好') }) }).not.toThrow()
    expect(storeAudits).toMatchObject([{ kind: 'access.thinking.auto', ok: false }])
    disposeStore()

    // 后置关(模型 select 抛错)——缓存已热,评分选档后 select 炸,同样吞掉
    const h = makeHarness({ effortIds: ['low', 'medium', 'high'] })
    await flush()
    const throwingAgent = {
      session: { id: 's-on' },
      model: {
        current: () => ({ provider: 'prov', model: 'model-a' }),
        select: () => { throw new Error('projection write failed') },
      },
    }
    expect(() => { h.fire({ agent: throwingAgent, message: userMessage('你好') }) }).not.toThrow()
    expect(h.audits).toMatchObject([{ kind: 'access.thinking.auto', ok: false }])
    h.dispose()
  })

  it('会话窗口:本轮工具连续失败 ⇒ 升档(0.1→0.4 ⇒ medium),审计带信号明细', async () => {
    const at = '2026-11-18T10:00:00.000Z'
    const events = [
      { type: 'user/message', at, data: { role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text: '跑一下测试' }] } },
      { type: 'tool/call', at, data: { callId: 'c1', name: 'bash' } },
      { type: 'tool/result', at, data: { message: { role: 'tool', isError: true, toolCallId: 'c1', content: [] } } },
      { type: 'tool/call', at, data: { callId: 'c2', name: 'bash' } },
      { type: 'tool/result', at, data: { message: { role: 'tool', isError: true, toolCallId: 'c2', content: [] } } },
    ]
    const h = makeHarness({ effortIds: ['low', 'medium', 'high'], events })
    await flush()
    h.fire({ agent: h.agentFor('s-on', { provider: 'prov', model: 'model-a' }), message: userMessage('帮我看看这段逻辑怎么改') })
    expect(h.selectCalls).toEqual([{ provider: 'prov', model: 'model-a', reasoningEffort: 'medium' }])
    expect(h.audits[0]).toMatchObject({
      kind: 'access.thinking.auto',
      detail: { signals: { toolFailures: 2, sameToolFailures: 2 } },
    })
    h.dispose()
  })

  it('反馈偏置生效并按 24h 半衰:新鲜 +0.4 升档,48h 前同值退回最低档', async () => {
    const five = ['minimal', 'low', 'medium', 'high', 'xhigh']
    const fresh = makeHarness({ effortIds: five, bias: { bias: 0.4, updatedAt: Date.now() } })
    await flush()
    fresh.fire({ agent: fresh.agentFor('s-on', { provider: 'prov', model: 'model-a' }), message: userMessage('帮我看看这段逻辑怎么改') })
    expect(fresh.selectCalls[0]).toMatchObject({ reasoningEffort: 'medium' })
    fresh.dispose()

    const stale = makeHarness({ effortIds: five, bias: { bias: 0.4, updatedAt: Date.now() - 2 * 24 * 60 * 60_000 } })
    await flush()
    stale.fire({ agent: stale.agentFor('s-on', { provider: 'prov', model: 'model-a' }), message: userMessage('帮我看看这段逻辑怎么改') })
    expect(stale.selectCalls[0]).toMatchObject({ reasoningEffort: 'low' })
    stale.dispose()
  })

  it('窗口按 seq 裁剪:只读最近 200 事件;快照抛错=空窗口仍按 V1 判档', async () => {
    const sliced = makeHarness({ effortIds: ['low', 'medium', 'high'], events: [], seq: 1000 })
    await flush()
    sliced.fire({ agent: sliced.agentFor('s-on', { provider: 'prov', model: 'model-a' }), message: userMessage('帮我看看这段逻辑怎么改') })
    expect(sliced.snapshotCalls).toEqual([800])
    sliced.dispose()

    const broken = makeHarness({ effortIds: ['low', 'medium', 'high'], events: [], seq: 5, snapshotThrows: true })
    await flush()
    broken.fire({ agent: broken.agentFor('s-on', { provider: 'prov', model: 'model-a' }), message: userMessage('帮我看看这段逻辑怎么改') })
    expect(broken.selectCalls).toHaveLength(1)
    expect(broken.audits.every(event => event.ok !== false)).toBe(true)
    broken.dispose()
  })

  it('disposer:解除监听并中止预热', async () => {
    const h = makeHarness({ effortIds: ['low', 'medium', 'high'] })
    await flush()
    h.dispose()
    expect(h.offCount).toBe(1)
  })
})

describe('thinking-auto store 开关与迁移', () => {
  let dir: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'eterna-thinking-auto-'))
  })
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('存量库(无 thinking_auto 列)迁移补列,旧行默认开启;新行同默认', () => {
    const dbPath = join(dir, 'legacy.db')
    const raw = new DatabaseSync(dbPath)
    // 旧形态:users 带全量角色 CHECK(migrateRoleConstraint 跳过),sessions 无 thinking_auto
    raw.exec(`CREATE TABLE users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      account TEXT NOT NULL UNIQUE,
      nickname TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      password_version INTEGER NOT NULL DEFAULT 1,
      role TEXT NOT NULL CHECK(role IN ('admin','approver','user')),
      avatar BLOB,
      avatar_mime TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`)
    raw.exec(`CREATE TABLE sessions (
      session_id TEXT PRIMARY KEY,
      owner_id INTEGER NOT NULL REFERENCES users(id),
      workspace_id TEXT
    )`)
    raw.prepare("INSERT INTO users (account, nickname, password_hash, role) VALUES ('alice', 'Alice', 'x', 'user')").run()
    raw.prepare('INSERT INTO sessions (session_id, owner_id) VALUES (?, 1)').run('s-legacy')
    raw.close()

    const store = new UserStore(dbPath)
    try {
      const columns = (store as unknown as { db: DatabaseSync }).db.prepare('PRAGMA table_info(sessions)').all() as Array<{ name: string }>
      expect(columns.some(column => column.name === 'thinking_auto')).toBe(true)
      // V2 两列同迁移到存量库
      expect(columns.some(column => column.name === 'thinking_bias')).toBe(true)
      expect(columns.some(column => column.name === 'thinking_bias_at')).toBe(true)
      // 旧行吃列默认 1 ⇒ 默认开启(用户拍板)
      expect(store.thinkingAutoOf('s-legacy')).toBe(true)
      // 关闭可写回;未知会话 false 兜底(系统/subagent 不启用)
      store.setThinkingAuto('s-legacy', false)
      expect(store.thinkingAutoOf('s-legacy')).toBe(false)
      expect(store.thinkingAutoOf('s-unknown')).toBe(false)
      expect(store.setThinkingAuto('s-unknown', true)).toBe(false)
      // recordSession 不列该列 ⇒ 新行走列默认 1
      store.recordSession('s-new', 1, null)
      expect(store.thinkingAutoOf('s-new')).toBe(true)
    } finally {
      store.close()
    }
  })

  it('反馈偏置:叠加前先衰减、反向抵消、钳位 ±0.5;未知会话不建行', () => {
    const dbPath = join(dir, 'bias.db')
    const store = new UserStore(dbPath)
    try {
      const seeded = store.seedAdmin('admin', 'admin-pass-123')
      expect(seeded).toBe(true)
      store.recordSession('s-bias', 1, null)
      const now = Date.parse('2026-11-18T12:00:00.000Z')
      const day = 24 * 60 * 60 * 1000

      expect(store.thinkingBiasOf('s-bias')).toBeUndefined() // 从未反馈
      expect(store.addThinkingBias('s-bias', 0.2, now)).toEqual({ bias: 0.2 })
      expect(store.thinkingBiasOf('s-bias')).toEqual({ bias: 0.2, updatedAt: now })
      // 同向累计、反向抵消
      store.addThinkingBias('s-bias', 0.2, now)
      expect(store.thinkingBiasOf('s-bias')?.bias).toBeCloseTo(0.4)
      store.addThinkingBias('s-bias', -0.2, now)
      expect(store.thinkingBiasOf('s-bias')?.bias).toBeCloseTo(0.2)
      // 钳位上限
      store.addThinkingBias('s-bias', 0.5, now)
      expect(store.thinkingBiasOf('s-bias')?.bias).toBeCloseTo(0.5)
      // 隔 24h 再加:先把存量 0.5 衰减到 0.25 再叠加
      store.addThinkingBias('s-bias', 0.1, now + day)
      expect(store.thinkingBiasOf('s-bias')?.bias).toBeCloseTo(0.35)
      // 未知会话不隐式建行
      expect(store.addThinkingBias('s-ghost', 0.2, now)).toBeUndefined()
      expect(store.thinkingBiasOf('s-ghost')).toBeUndefined()
    } finally {
      store.close()
    }
  })
})
