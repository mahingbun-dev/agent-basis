/**
 * 思考强度自动模式:宿主路由器(双信号面:session/event 主路径 + inbox/inserted
 * rc.1 兼容;选档落盘在微任务)与 store 开关/迁移。
 * 结构替身(零 cordis 依赖):关键断言=落盘调用与否与实参、去重、微任务时序。
 */
import { DatabaseSync } from 'node:sqlite'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { installThinkingAuto, type ThinkingAutoOn } from '../src/thinking-auto.ts'
import { UserStore } from '../src/store.ts'
import type { AccessAuditEvent } from '../src/audit.ts'

/** 微任务排空:选档落盘在 queueMicrotask,断言前先让一轮微任务跑完。 */
const micro = async (): Promise<void> => {
  await Promise.resolve()
  await new Promise<void>((resolve) => {
    queueMicrotask(() => { resolve() })
  })
}
const flush = async (): Promise<void> => {
  await new Promise(resolve => setTimeout(resolve, 0))
  await new Promise(resolve => setTimeout(resolve, 0))
  await micro()
}

interface HarnessOptions {
  readonly effortIds?: readonly string[]
  readonly resolveHang?: boolean
}

/** 结构替身:可编程 llm 面 + 多事件注册器 + 落盘记录面。 */
function makeHarness(options: HarnessOptions = {}) {
  const selectCalls: Array<{ provider: string; model: string; reasoningEffort?: string }> = []
  const appends: Array<{ type: string; data: unknown }> = []
  const audits: AccessAuditEvent[] = []
  const resolveCalls: Array<{ provider: string; model: string }> = []
  const listeners = new Map<string, Array<(...args: unknown[]) => void>>()
  let messageSeq = 0

  const session = {
    id: 's-on',
    requestHeader: () => ({ config: { provider: 'prov', model: 'model-a' } }),
    append: (type: string, data: unknown) => { appends.push({ type, data }) },
  }
  // 形态对齐宿主 AgentModel:select/current 是**依赖 this 的方法**——
  // 0.1.18 生产事故回归锚:路由器抽出方法裸调会 here 炸(this undefined)。
  const makeAgentModel = () => {
    let pending: unknown = null
    return {
      recordedSelection(): unknown { return pending },
      current(): unknown { return this.recordedSelection() ?? { provider: 'prov', model: 'model-a' } },
      select(selection: { provider: string; model: string; reasoningEffort?: string }): void {
        const recorded = this.recordedSelection()
        if (JSON.stringify(recorded) === JSON.stringify(selection)) return
        pending = selection
        selectCalls.push(selection)
      },
    }
  }
  const agent = { session, model: makeAgentModel() }

  const on: ThinkingAutoOn = (event, listener) => {
    const list = listeners.get(event) ?? []
    list.push(listener)
    listeners.set(event, list)
    return () => {
      listeners.set(event, (listeners.get(event) ?? []).filter(l => l !== listener))
    }
  }
  const fire = (event: string, ...args: unknown[]): void => {
    for (const listener of listeners.get(event) ?? []) listener(...args)
  }

  const dispose = installThinkingAuto(
    {
      store: { thinkingAutoOf: (id: string) => id === 's-on' },
      llm: {
        listProviders: () => (options.effortIds === undefined ? [] : [{ id: 'prov' }]),
        listModels: (_provider: string) => Promise.resolve(options.effortIds === undefined ? [] : [{ id: 'model-a' }]),
        resolveModelInfo: (provider: string, model: string, signal?: AbortSignal) => {
          resolveCalls.push({ provider, model })
          if (signal?.aborted) return Promise.reject(new Error('aborted'))
          if (options.resolveHang === true) return new Promise(() => { /* 悬挂=缓存永不热 */ })
          return Promise.resolve({ reasoning: { efforts: (options.effortIds ?? ['low', 'medium', 'high']).map(id => ({ id, name: id })) } })
        },
      },
      audit: (event: AccessAuditEvent) => { audits.push(event) },
    },
    on,
  )

  const userMessage = (text: string, kind: unknown = 'user') =>
    ({ id: `m-${++messageSeq}`, content: [{ type: 'text', text }], source: { kind } })
  /** 模拟一次入箱:session/event 主路径(alpha.3 形态)。 */
  const spliceIn = (message: unknown, targetSession: unknown = session): void => {
    fire('session/event', targetSession, { type: 'agent/inbox/spliced', data: { inserted: [message] } })
  }

  return {
    selectCalls, appends, audits, resolveCalls, listeners, session, agent,
    fire, spliceIn, userMessage, dispose,
  }
}

describe('thinking-auto 路由器', () => {
  it('自动开启+agent 已登记+缓存已热:session/event 路径微任务落盘 select,审计带 score/effort', async () => {
    const h = makeHarness({ effortIds: ['low', 'medium', 'high'] })
    h.fire('agent/created', { agent: h.agent })
    await flush() // warmCatalog 预热 prov/model-a
    expect(h.resolveCalls).toEqual([{ provider: 'prov', model: 'model-a' }])
    h.spliceIn(h.userMessage('你好'))
    await micro()
    expect(h.selectCalls).toEqual([{ provider: 'prov', model: 'model-a', reasoningEffort: 'low' }])
    expect(h.audits).toHaveLength(1)
    expect(h.audits[0]).toMatchObject({ kind: 'access.thinking.auto', detail: { sessionId: 's-on', effort: 'low' } })
    // 第二轮:显式深入 → 最高档
    h.spliceIn(h.userMessage('请深入思考这个架构的根因'))
    await micro()
    expect(h.selectCalls[1]).toMatchObject({ reasoningEffort: 'high' })
    h.dispose()
  })

  it('双信号面去重:同一消息 session/event 与 inbox/inserted 同 tick 到达只落盘一次', async () => {
    const h = makeHarness({ effortIds: ['low', 'medium', 'high'] })
    h.fire('agent/created', { agent: h.agent })
    await flush()
    const message = h.userMessage('你好')
    h.spliceIn(message)
    h.fire('agent/inbox/inserted', { agent: h.agent, message })
    await micro()
    expect(h.selectCalls).toHaveLength(1)
    expect(h.audits).toHaveLength(1)
    h.dispose()
  })

  it('rc.1 路径:inbox/inserted 载荷带 agent 时独立可用', async () => {
    const h = makeHarness({ effortIds: ['low', 'medium', 'high'] })
    await flush()
    h.fire('agent/inbox/inserted', { agent: h.agent, message: h.userMessage('你好') })
    await micro()
    expect(h.selectCalls).toEqual([{ provider: 'prov', model: 'model-a', reasoningEffort: 'low' }])
    h.dispose()
  })

  it('无 agent 登记:回退 requestHeader 路由,session.append 落盘 model/selection', async () => {
    const h = makeHarness({ effortIds: ['low', 'medium', 'high'] })
    await flush()
    h.spliceIn(h.userMessage('你好')) // 未 fire agent/created
    await micro()
    expect(h.selectCalls).toHaveLength(0)
    expect(h.appends).toEqual([{ type: 'model/selection', data: { provider: 'prov', model: 'model-a', reasoningEffort: 'low' } }])
    h.dispose()
  })

  it('agent 与请求头都无路由:静默跳过(不落盘不审计)', async () => {
    const h = makeHarness({ effortIds: ['low', 'medium', 'high'] })
    await flush()
    h.spliceIn(h.userMessage('你好'), { id: 's-on' })
    await micro()
    expect(h.selectCalls).toHaveLength(0)
    expect(h.appends).toHaveLength(0)
    expect(h.audits).toHaveLength(0)
    h.dispose()
  })

  it('缓存未命中=fail-neutral:不改选、触发预热、审计记 cold-skip', async () => {
    const h = makeHarness({ resolveHang: true })
    h.fire('agent/created', { agent: h.agent })
    await flush() // 目录预热不覆盖(effortIds 未给 ⇒ listModels 空);留悬挂 resolve
    h.spliceIn(h.userMessage('分析一下'))
    await micro()
    expect(h.selectCalls).toHaveLength(0)
    expect(h.appends).toHaveLength(0)
    expect(h.audits).toMatchObject([{ kind: 'access.thinking.auto', detail: { stage: 'cold-skip' } }])
    expect(h.resolveCalls.some(c => c.model === 'model-a')).toBe(true)
    h.dispose()
  })

  it('自动关闭/未知会话/非真人源/缺载荷:完全不介入', async () => {
    const h = makeHarness({ effortIds: ['low', 'medium', 'high'] })
    h.fire('agent/created', { agent: h.agent })
    await flush()
    h.spliceIn(h.userMessage('你好'), { ...h.session, id: 's-off' }) // store=false
    h.spliceIn(h.userMessage('请深入思考', 'model-selection')) // 系统源
    h.fire('session/event', { type: 'agent/inbox/spliced', data: {} }) // 无 inserted
    h.fire('agent/inbox/inserted', { message: h.userMessage('你好') }) // alpha.3 载荷无 agent
    await micro()
    expect(h.selectCalls).toHaveLength(0)
    expect(h.appends).toHaveLength(0)
    expect(h.audits).toHaveLength(0)
    h.dispose()
  })

  it('同档 no-op:已选档=应选档时不落盘不审计', async () => {
    const h = makeHarness({ effortIds: ['low', 'medium', 'high'] })
    h.fire('agent/created', { agent: h.agent })
    await flush()
    // 预置已选档:改 current 的返回(代理层置换,select 仍在 h.selectCalls 记录)
    ;(h.agent.model as { current: () => unknown }).current = () => ({ provider: 'prov', model: 'model-a', reasoningEffort: 'low' })
    h.spliceIn(h.userMessage('你好')) // 寒暄应选 low = 已选档
    await micro()
    expect(h.selectCalls).toHaveLength(0)
    expect(h.audits).toHaveLength(0)
    expect(h.appends).toHaveLength(0)
    h.dispose()
  })

  it('store 抛错/select 抛错:吞掉并审计 ok:false,不外溢', async () => {
    // 前置关(store.thinkingAutoOf 抛错)——监听体必须吞掉
    const storeAudits: AccessAuditEvent[] = []
    const listeners = new Map<string, Array<(...args: unknown[]) => void>>()
    const disposeStore = installThinkingAuto(
      {
        store: { thinkingAutoOf: () => { throw new Error('db locked') } },
        llm: { listProviders: () => [], listModels: () => Promise.resolve([]), resolveModelInfo: () => Promise.resolve({}) },
        audit: (event: AccessAuditEvent) => { storeAudits.push(event) },
      },
      (event, listener) => {
        const list = listeners.get(event) ?? []
        list.push(listener)
        listeners.set(event, list)
        return () => {}
      },
    )
    listeners.get('session/event')?.[0]?.(
      { id: 'x' },
      { type: 'agent/inbox/spliced', data: { inserted: [{ id: 'm1', content: [{ type: 'text', text: '你好' }], source: { kind: 'user' } }] } },
    )
    await micro()
    expect(storeAudits).toMatchObject([{ kind: 'access.thinking.auto', ok: false, detail: { error: 'db locked' } }])
    disposeStore()

    // 后置关(落盘 select 抛错)——缓存已热,微任务里 select 炸,同样吞掉
    const boomAudits: AccessAuditEvent[] = []
    const listeners2 = new Map<string, Array<(...args: unknown[]) => void>>()
    const session2 = { id: 's-on', requestHeader: () => ({ config: { provider: 'prov', model: 'model-a' } }), append: () => {} }
    const agent2 = { session: session2, model: { current: () => ({ provider: 'prov', model: 'model-a' }), select: () => { throw new Error('projection write failed') } } }
    const disposeBoom = installThinkingAuto(
      {
        store: { thinkingAutoOf: () => true },
        llm: {
          listProviders: () => [{ id: 'prov' }],
          listModels: () => Promise.resolve([{ id: 'model-a' }]),
          resolveModelInfo: () => Promise.resolve({ reasoning: { efforts: [{ id: 'low' }] } }),
        },
        audit: (event: AccessAuditEvent) => { boomAudits.push(event) },
      },
      (event, listener) => {
        const list = listeners2.get(event) ?? []
        list.push(listener)
        listeners2.set(event, list)
        return () => {}
      },
    )
    await flush()
    listeners2.get('agent/created')?.[0]?.({ agent: agent2 })
    listeners2.get('session/event')?.[0]?.(
      session2,
      { type: 'agent/inbox/spliced', data: { inserted: [{ id: 'm2', content: [{ type: 'text', text: '你好' }], source: { kind: 'user' } }] } },
    )
    await micro()
    expect(boomAudits).toMatchObject([{ kind: 'access.thinking.auto', ok: false, detail: { error: 'projection write failed' } }])
    disposeBoom()
  })

  it('disposer:解除全部三个监听并中止预热', async () => {
    const h = makeHarness({ effortIds: ['low', 'medium', 'high'] })
    h.dispose()
    // 解绑后三个事件面都不再触发
    h.fire('agent/created', { agent: h.agent })
    h.fire('session/event', h.session, { type: 'agent/inbox/spliced', data: { inserted: [] } })
    h.fire('agent/inbox/inserted', {})
    expect(h.selectCalls).toHaveLength(0)
    expect(h.appends).toHaveLength(0)
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
    // 旧形态:users 带全量角色 CHECK,sessions 无 thinking_auto
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
})
