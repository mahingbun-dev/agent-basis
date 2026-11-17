/**
 * 账号分库路由测试(2026-11-17,对齐 memory account-router 口径):
 * - createDeniedService fail-closed 语义(检索空 + degraded 原因 / 读与写抛
 *   KnowledgeAccountDeniedError / 状态如实报不可用 / registerBackend 不生效);
 * - KnowledgeAccountRouter LRU 池(目录缺席不建 / 池满逐出最久未用 / 闲置回收 /
 *   dispose 全关);
 * - 工具逐会话解析(buildKnowledgeTools/toDshTools 的 resolver 形态):解析命中 →
 *   命中服务的检索结果;解析失败/会话缺席 → Denied;resolver 缺席 → 单库零破坏。
 */
import { describe, expect, it } from 'vitest'
import type { ToolRunContext } from '@deepseek-ai/dsh-tools'
import {
  KnowledgeAccountDeniedError, KnowledgeAccountRouter, KNOWLEDGE_SERVICE_ID,
  buildKnowledgeTools, createDeniedService, createKnowledgeService, isKnowledgeAccountDeniedError, toDshTools,
} from '../src/index.ts'
import type { KnowledgeBackend, KnowledgeService } from '../src/index.ts'

/** 可辨识的假后端(tag 进 title;用于断言工具解析到了哪个服务)。 */
function taggedBackend(tag: string): KnowledgeBackend {
  return {
    id: 'wiki-local',
    capabilities: { write: false, deprecate: false, graph: false },
    search: async () => ([{
      ref: { doc_id: `doc-${tag}`, source_uri: '', backend: 'wiki-local' },
      title: tag,
      snippet: `snippet-${tag}`,
      score: 0.9,
      provenance: {
        origin: 'test', status: 'active', trust: 'verified', review: 'reviewed',
        created: '2026-11-17', updated: '2026-11-17',
      },
    }]),
    read: async () => { throw new Error('未实现') },
    health: async () => ({ ok: true, doc_count: 1 }),
  }
}

function taggedService(tag: string): KnowledgeService {
  return createKnowledgeService({ backends: [taggedBackend(tag)] })
}

/** 工具运行上下文假体(memory-routing 先例:agent.session.id 即会话身份)。 */
function execOf(sessionId: string | undefined): ToolRunContext {
  return {
    name: 'knowledge_search',
    callId: 'call-routing',
    signal: new AbortController().signal,
    ...(sessionId !== undefined && { agent: { session: { id: sessionId } } }),
  } as unknown as ToolRunContext
}

describe('createDeniedService(fail-closed)', () => {
  it('检索一律空 + degraded 明示原因;读/写抛 KnowledgeAccountDeniedError', async () => {
    const denied = createDeniedService()
    expect(denied.id).toBe(KNOWLEDGE_SERVICE_ID)
    const search = await denied.search({ query: 'x' })
    expect(search.hits).toHaveLength(0)
    expect(search.degraded).toHaveLength(1)
    expect(search.degraded[0]?.reason).toContain('fail-closed')
    await expect(denied.read({ doc_id: 'd', source_uri: '', backend: 'wiki-local' }))
      .rejects.toBeInstanceOf(KnowledgeAccountDeniedError)
    await expect(denied.propose({ title: 't', body: 'b' })).rejects.toBeInstanceOf(KnowledgeAccountDeniedError)
    try {
      await denied.propose({ title: 't', body: 'b' })
    } catch (error) {
      expect(isKnowledgeAccountDeniedError(error)).toBe(true)
    }
  })

  it('状态单条不可用报告;registerBackend 不生效;dispose no-op', async () => {
    const denied = createDeniedService()
    const reports = await denied.status()
    expect(reports).toHaveLength(1)
    expect(reports[0]).toMatchObject({ ok: false, configured: false, doc_count: 0 })
    expect(reports[0]?.reason).toContain('fail-closed')
    const dispose = denied.registerBackend(taggedBackend('backend'))
    expect(denied.listBackends()).toHaveLength(0)
    dispose()
    denied.dispose()
    expect(createDeniedService()).toBe(denied) // 单例池化
  })
})

describe('KnowledgeAccountRouter(LRU 池)', () => {
  it('目录缺席返回 undefined(不隐式建实例);命中缓存同实例', () => {
    const created: string[] = []
    const router = new KnowledgeAccountRouter({
      dirOf: (account: string) => (account === 'ghost' ? undefined : `/tenants/${account}`),
      create: (dir: string) => { created.push(dir); return taggedService(dir) },
    })
    expect(router.forAccount('ghost')).toBeUndefined()
    expect(created).toHaveLength(0)
    const first = router.forAccount('alice')
    const again = router.forAccount('alice')
    expect(first).toBe(again)
    expect(created).toEqual(['/tenants/alice'])
    router.dispose()
  })

  it('池满逐出最久未用(逐出即 dispose);闲置超时惰性回收;dispose 全关', () => {
    let now = 0
    const disposed: string[] = []
    const services = new Map<string, KnowledgeService>()
    const router = new KnowledgeAccountRouter({
      dirOf: (account: string) => `/tenants/${account}`,
      create: (dir: string) => {
        const service = taggedService(dir)
        const originalDispose = service.dispose.bind(service)
        services.set(dir, {
          ...service,
          dispose: () => { disposed.push(dir); originalDispose() },
        })
        return services.get(dir) as KnowledgeService
      },
      maxInstances: 1,
      idleMs: 100,
      now: () => now,
    })
    router.forAccount('alice')
    router.forAccount('bob') // 池满 1 → 逐出 alice
    expect(disposed).toEqual(['/tenants/alice'])
    expect(router.size).toBe(1)
    now = 1_000 // bob 闲置超时 → 下一次调用回收
    router.forAccount('carol')
    expect(disposed).toContain('/tenants/bob')
    router.dispose()
    expect(disposed).toContain('/tenants/carol')
    expect(router.forAccount('dave')).toBeUndefined() // disposed 后拒绝
  })
})

describe('工具逐会话解析(resolver 形态)', () => {
  it('解析命中 → 用该会话的账号服务;解析失败/会话缺席 → Denied(resolver 场)', async () => {
    const alice = taggedService('alice-wiki')
    const bob = taggedService('bob-wiki')
    const tools = buildKnowledgeTools(alice, {
      forSession: (sessionId: string | undefined) => {
        if (sessionId === 'session-alice') return alice
        if (sessionId === 'session-bob') return bob
        return undefined
      },
    })
    const aliceHits = await tools.search.execute({ query: 'x' }, execOf('session-alice')) as { hits: Array<{ title: string }> }
    expect(aliceHits.hits.map(hit => hit.title)).toEqual(['alice-wiki'])
    const bobHits = await tools.search.execute({ query: 'x' }, execOf('session-bob')) as { hits: Array<{ title: string }> }
    expect(bobHits.hits.map(hit => hit.title)).toEqual(['bob-wiki'])
    const denied = await tools.search.execute({ query: 'x' }, execOf('session-unknown')) as { hits: unknown[]; degraded: unknown[] }
    expect(denied.hits).toHaveLength(0)
    expect(denied.degraded).toHaveLength(1)
    const noSession = await tools.search.execute({ query: 'x' }, execOf(undefined)) as { hits: unknown[] }
    expect(noSession.hits).toHaveLength(0)
    // 写入在解析失败时 fail-closed(结构化失败,不静默丢写)
    await expect(tools.propose.execute({ title: 't', body: 'b' }, execOf('session-unknown')))
      .rejects.toBeInstanceOf(KnowledgeAccountDeniedError)
  })

  it('resolver 缺席 → 单库直通(既有形态零破坏);toDshTools 透传 resolver', async () => {
    const base = taggedService('base-wiki')
    const tools = buildKnowledgeTools(base)
    const hits = await tools.search.execute({ query: 'x' }, execOf('any-session')) as { hits: Array<{ title: string }> }
    expect(hits.hits.map(hit => hit.title)).toEqual(['base-wiki'])
    const dshTools = toDshTools(base, { forSession: (sessionId: string | undefined) => (sessionId === 'session-alice' ? base : undefined) })
    expect(dshTools).toHaveLength(4)
    const search = dshTools.find(definition => definition.name === 'knowledge_search')
    const result = await search?.execute({ query: 'x' }, execOf('session-alice')) as { hits: Array<{ title: string }> }
    expect(result.hits.map(hit => hit.title)).toEqual(['base-wiki'])
  })
})
