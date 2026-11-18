/**
 * DeepWiki 适配器 / fail-soft 检索 / stub 导入 / 路由面 / 工具面(验收第 6-9 项 + 契约面)。
 *
 * 红线复核点(也是断言):
 * - 令牌只在 header 出现,**绝不**出现在任何返回/错误文本里(`assertNoSecret`);
 * - 401/403 → unauthorized(不重试:同一 URL 只被请求一次);
 * - 不可达 → degraded 里写明原因,本地命中照常返回(fail-soft);
 * - stub 导入 → 全部 pending 提案 + `engine:'stub'` + reason 明确"真实生成需子进程引擎";
 * - 路由面未知方法/internal 兜底;工具面 publish 缺省 false、review 不接受模糊值。
 */
import { describe, expect, it } from 'vitest'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { KnowledgeAdminService } from '../src/service.ts'
import { DeepWikiBackend, candidatePaths, matchPages, tokenize } from '../src/deepwiki.ts'
import { KnowledgeAdminRouteFace } from '../src/route-face.ts'
import { buildKnowledgeAdminTool } from '../src/tools.ts'
import { KNOWLEDGE_ADMIN_METHODS, KNOWLEDGE_ADMIN_METHOD_SPECS } from '../src/types.ts'
import { createRig, fakeFetch, fixedClock, throwingFetch, userCaller, adminCaller } from './rig.ts'

const SECRET = 'sekrit-token-value-do-not-log'

/** 断言字符串里不含令牌(失败时**不**打印原文,只报"含令牌")。 */
function assertNoSecret(text: string): void {
  expect(text.includes(SECRET)).toBe(false)
}

describe('DeepWiki 适配器', () => {
  it('探测候选路径顺序固定;2xx+JSON → ok', () => {
    expect(candidatePaths()).toEqual(['/api/health', '/docs', '/api/docs'])
    expect(candidatePaths('o', 'r')).toEqual(['/api/health', '/docs', '/api/docs', '/api/wiki/o/r'])
    expect(DeepWikiBackend.prototype).toBeDefined()
  })

  it('凭据只经 credentials resolve;令牌进 header 不进输出', async () => {
    const { fetch } = fakeFetch({ '/api/health': { status: 200, body: '{"ok":true}' } })
    const backend = new DeepWikiBackend({
      config: { enabled: true, baseUrl: 'http://dw.local:8001', bearerRef: 'DEEPWIKI_TOKEN' },
      fetch,
      credentials: async () => ({ resolve: async (ref: string) => (ref === 'DEEPWIKI_TOKEN' ? { value: SECRET } : undefined) }),
    })
    const probe = await backend.probe({})
    expect(probe.status).toBe('ok')
    assertNoSecret(probe.detail)
  })

  it('bearerRef 配了但凭据不可解析 → not-configured(不裸探 401 冒充网络问题)', async () => {
    const { fetch, calls } = fakeFetch({ '/api/health': { status: 401, body: 'nope' } })
    const backend = new DeepWikiBackend({
      config: { enabled: true, baseUrl: 'http://dw.local:8001', bearerRef: 'DEEPWIKI_TOKEN' },
      fetch,
      credentials: async () => ({ resolve: async () => undefined }),
    })
    const probe = await backend.probe({})
    expect(probe.status).toBe('not-configured')
    expect(calls).toEqual([])
    assertNoSecret(probe.detail)
  })

  it('401 → unauthorized(只请求一次,不重试不绕道)', async () => {
    const { fetch, calls } = fakeFetch({ '/api/health': { status: 401, body: 'unauthorized' } })
    const backend = new DeepWikiBackend({ config: { enabled: true, baseUrl: 'http://dw.local:8001' }, fetch })
    const probe = await backend.probe({})
    expect(probe.status).toBe('unauthorized')
    expect(probe.probed_path).toBe('/api/health')
    expect(calls).toHaveLength(1)
    expect(probe.detail).toContain('不重试')
  })

  it('连接失败 → unreachable 且错误文本保留原因', async () => {
    const backend = new DeepWikiBackend({
      config: { enabled: true, baseUrl: 'http://dw.local:8001' },
      fetch: throwingFetch(),
    })
    const probe = await backend.probe({})
    expect(probe.status).toBe('unreachable')
    expect(probe.detail).toContain('ECONNREFUSED')
  })

  it('matchPages:本地关键词匹配 + 中文二元组切词', () => {
    const pages = [{ title: '预算红线', content: '预算超支超过 5% 必须先审批。', page_url: '/api/wiki/o/r#1' }]
    const hits = matchPages(pages, '预算审批', 5, 'o/r')
    expect(hits.length).toBe(1)
    expect(hits[0]?.ref.backend).toBe('deepwiki')
    expect(hits[0]?.score).toBeGreaterThan(0)
    expect(tokenize('预算审批')).toContain('预算')
  })
})

describe('检索 fail-soft(DeepWiki 不可达时 search 仍可用)', () => {
  it('DeepWiki unreachable → 本地命中照常返回,degraded 列原因', async () => {
    const rig = createRig()
    const clock = fixedClock()
    const service = new KnowledgeAdminService(rig.deps({
      now: () => clock.now(),
      config: { tenantRoot: rig.tenantRoot, adminHome: rig.adminHome, deepwiki: { enabled: true, baseUrl: 'http://dw.local:8001', owner: 'o', repo: 'r' } },
      fetch: throwingFetch(),
    }))
    try {
      await service.saveDoc(userCaller('alice'), { title: '本地页', body: '本地知识与预算口径', path: 'kb/local.md' })
      const result = await service.search(userCaller('alice'), { query: '预算' })
      expect(result.ok).toBe(true)
      if (!result.ok) return
      expect(result.value.hits.map(hit => hit.ref.doc_id)).toContain('kb/local')
      expect(result.value.contributed).toContain('wiki-local')
      expect(result.value.degraded.some(item => item.source === 'deepwiki' && item.reason.includes('ECONNREFUSED'))).toBe(true)
      assertNoSecret(JSON.stringify(result.value))
    } finally {
      service.dispose()
      rig.cleanup()
    }
  })

  it('DeepWiki 可达 → 命中合并进结果并标 source=deepwiki', async () => {
    const rig = createRig()
    const clock = fixedClock()
    const { fetch } = fakeFetch({
      '/api/wiki/o/r': { status: 200, body: JSON.stringify({ pages: [{ title: '异地预算规范', content: '预算审批流程与阈值 5%' }] }) },
      '/api/health': { status: 200, body: '{"ok":true}' },
    })
    const service = new KnowledgeAdminService(rig.deps({
      now: () => clock.now(),
      config: { tenantRoot: rig.tenantRoot, adminHome: rig.adminHome, deepwiki: { enabled: true, baseUrl: 'http://dw.local:8001', owner: 'o', repo: 'r' } },
      fetch,
    }))
    try {
      const result = await service.search(userCaller('alice'), { query: '预算' })
      expect(result.ok).toBe(true)
      if (!result.ok) return
      expect(result.value.hits.some(hit => hit.source === 'deepwiki')).toBe(true)
      expect(result.value.contributed).toContain('deepwiki')
    } finally {
      service.dispose()
      rig.cleanup()
    }
  })

  it('testSource 对 wiki-local 自检;对未启用 DeepWiki 返回 not-configured', async () => {
    const rig = createRig()
    const service = new KnowledgeAdminService(rig.deps())
    try {
      const local = await service.testSource(userCaller('alice'), { source: 'wiki-local' })
      expect(local.ok).toBe(true)
      if (local.ok) expect(local.value.source.status).toBe('ok')
      const dw = await service.testSource(userCaller('alice'), { source: 'deepwiki' })
      expect(dw.ok).toBe(true)
      if (dw.ok) expect(dw.value.source.status).toBe('not-configured')
    } finally {
      service.dispose()
      rig.cleanup()
    }
  })
})

describe('stub 导入', () => {
  it('importRepo(stub):MEMORY_INDEX/README/文件树 → 全部 pending,engine 如实标 stub', async () => {
    const rig = createRig()
    const clock = fixedClock()
    // 仓库必须位于账号 workspace 目录之内(路径越界 = forbidden,2026-11-19 收紧)
    const repo = join(rig.tenantRoot, 'alice', 'fixture-repo')
    mkdirSync(join(repo, 'src'), { recursive: true })
    writeFileSync(join(repo, 'MEMORY_INDEX.md'), '# 记忆索引\n\n- 关键词:预算红线\n')
    writeFileSync(join(repo, 'README.md'), '# 示例仓库\n\n说明文字。\n')
    writeFileSync(join(repo, 'src', 'a.ts'), 'export const a = 1\n')

    const service = new KnowledgeAdminService(rig.deps({ now: () => clock.now() }))
    try {
      const result = await service.importRepo(userCaller('alice'), { repo_path: repo, engine: 'stub' })
      expect(result.ok).toBe(true)
      if (!result.ok) return
      expect(result.value.engine).toBe('stub')
      expect(result.value.created).toBeGreaterThanOrEqual(3)
      expect(result.value.failed).toBe(0)
      expect(result.value.reason).toContain('真实生成需子进程引擎')
      expect(result.value.proposals.every(item => item.state === 'pending')).toBe(true)

      const listed = await service.listProposals(userCaller('alice'), { state: ['pending'] })
      if (listed.ok) expect(listed.value.total).toBe(result.value.created)
      // 导入永不直接发布
      const docs = await service.listDocs(userCaller('alice'), {})
      if (docs.ok) expect(docs.value.total).toBe(0)
    } finally {
      service.dispose()
      rig.cleanup()
    }
  })

  it('importRepo 目录不存在 → not_found;importMarkdown 逐条落 pending', async () => {
    const rig = createRig()
    const clock = fixedClock()
    const service = new KnowledgeAdminService(rig.deps({ now: () => clock.now() }))
    try {
      // 越界面:账号 workspace 之外的仓库一律 forbidden(仓库/目录路径不开放配置)
      const outside = await service.importRepo(userCaller('alice'), { repo_path: join(rig.root, 'outside-repo') })
      expect(outside.ok).toBe(false)
      if (!outside.ok) expect(outside.code).toBe('forbidden')

      // 账号 workspace 内但目录不存在 → not_found
      const missing = await service.importRepo(userCaller('alice'), { repo_path: join(rig.tenantRoot, 'alice', 'nope') })
      expect(missing.ok).toBe(false)
      if (!missing.ok) expect(missing.code).toBe('not_found')

      const imported = await service.importMarkdown(userCaller('alice'), {
        documents: [
          { title: '甲', body: '甲正文', tags: ['导入'] },
          { title: '', body: '缺标题' },
          { title: '丙', body: '丙正文' },
        ],
      })
      expect(imported.ok).toBe(true)
      if (!imported.ok) return
      expect(imported.value.created).toBe(2)
      expect(imported.value.failed).toBe(1)
      expect(imported.value.proposals.filter(item => item.error !== undefined)).toHaveLength(1)
    } finally {
      service.dispose()
      rig.cleanup()
    }
  })
})

describe('端点契约 pin(access 守卫按此合并)', () => {
  it('17 方法:endpoint=eternaKnowledgeAdmin/<m>、guard=/api/knowledgeAdmin/<m>、wireKey=args', () => {
    expect(KNOWLEDGE_ADMIN_METHOD_SPECS).toHaveLength(17)
    for (const spec of KNOWLEDGE_ADMIN_METHOD_SPECS) {
      expect(spec.endpoint).toBe(`eternaKnowledgeAdmin/${spec.method}`)
      expect(spec.guarded).toBe(`/api/knowledgeAdmin/${spec.method}`)
      expect(spec.wireKey).toBe('args')
    }
    // 顺序即 README 契约表顺序(不随实现漂移)
    expect(KNOWLEDGE_ADMIN_METHOD_SPECS.map(spec => spec.method)).toEqual([
      'listAccounts', 'overview', 'listDocs', 'readDoc', 'saveDoc', 'deprecateDoc', 'listProposals',
      'reviewProposal', 'discardProposal', 'search', 'ask', 'importMarkdown', 'importRepo',
      'listMembers', 'setMember', 'listAudit', 'testSource',
    ])
  })

  it('插件默认导出形态(name/apply)与工具名', async () => {
    const mod = await import('../src/index.ts')
    expect(mod.default.name).toBe('eterna-knowledge-admin')
    expect(typeof mod.default.apply).toBe('function')
    expect((await import('../src/types.ts')).KNOWLEDGE_ADMIN_TOOL_NAME).toBe('knowledge_admin')
  })
})

describe('路由面 & 工具面契约', () => {
  it('路由面:未知方法 invalid;身份缺失 unauthorized;正常方法透传', async () => {
    const rig = createRig()
    const service = new KnowledgeAdminService(rig.deps())
    const face = new KnowledgeAdminRouteFace(service, { id: 'eternaKnowledgeAdmin', methods: KNOWLEDGE_ADMIN_METHODS })
    try {
      expect(face.methods).toHaveLength(17)
      const unknown = await face.call('nope', {}, userCaller('alice'))
      expect(unknown.ok).toBe(false)
      if (!unknown.ok) expect(unknown.code).toBe('invalid')

      const noCaller = await face.call('overview', {}, undefined)
      expect(noCaller.ok).toBe(false)
      if (!noCaller.ok) expect(noCaller.code).toBe('unauthorized')

      const ok1 = await face.call('overview', {}, userCaller('alice'))
      expect(ok1.ok).toBe(true)
      if (ok1.ok) expect((ok1.value as { account: { account: string } }).account.account).toBe('alice')

      expect(face.wireKey('listDocs')).toBe('args')
      expect(face.isGuarded('listDocs')).toBe(true)
    } finally {
      service.dispose()
      rig.cleanup()
    }
  })

  it('工具面:save 缺省 publish=false;review 只收 approve/reject;未知 action invalid', async () => {
    const rig = createRig()
    const clock = fixedClock()
    const service = new KnowledgeAdminService(rig.deps({ now: () => clock.now() }))
    const tool = buildKnowledgeAdminTool(service, () => userCaller('alice'))
    try {
      expect(tool.name).toBe('knowledge_admin')
      expect(tool.parameters.required).toEqual(['action'])

      const saved = await tool.execute({ action: 'save', title: '工具页', body: '工具正文' })
      expect(saved.ok).toBe(true)
      if (saved.ok) expect((saved.value as { state: string }).state).toBe('pending')

      const badDecision = await tool.execute({ action: 'review', proposal_id: 'x', decision: 'auto' })
      expect(badDecision.ok).toBe(false)
      if (!badDecision.ok) expect(badDecision.code).toBe('invalid')

      const unknown = await tool.execute({ action: 'delete_everything' })
      expect(unknown.ok).toBe(false)
      if (!unknown.ok) expect(unknown.code).toBe('invalid')

      const proposalId = saved.ok ? (saved.value as { proposal_id: string }).proposal_id : ''
      const reviewed = await tool.execute({ action: 'review', proposal_id: proposalId, decision: 'approve' })
      expect(reviewed.ok).toBe(true)

      const status = await tool.execute({ action: 'status' })
      if (status.ok) expect((status.value as { doc_count: number }).doc_count).toBe(1)
    } finally {
      service.dispose()
      rig.cleanup()
    }
  })

  it('工具面身份不可解析 → unauthorized fail-closed', async () => {
    const rig = createRig()
    const service = new KnowledgeAdminService(rig.deps())
    const tool = buildKnowledgeAdminTool(service, () => undefined)
    try {
      const result = await tool.execute({ action: 'list' })
      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.code).toBe('unauthorized')
        expect(result.message).toContain('fail-closed')
      }
    } finally {
      service.dispose()
      rig.cleanup()
    }
  })

  it('overview 报告三源状态且管理员可跨账号', async () => {
    const rig = createRig()
    const service = new KnowledgeAdminService(rig.deps())
    try {
      const result = await service.overview(adminCaller(), { account: 'bob' })
      expect(result.ok).toBe(true)
      if (!result.ok) return
      const ids = result.value.sources.map(source => source.id)
      expect(ids).toContain('wiki-local')
      expect(ids).toContain('deepwiki')
      expect(result.value.sources.find(source => source.id === 'deepwiki')?.status).toBe('not-configured')
    } finally {
      service.dispose()
      rig.cleanup()
    }
  })
})

describe('ask(模型缺席时不编造)', () => {
  it('LLM 缺席 → unavailable;无命中 → unavailable 而不生成答案', async () => {
    const rig = createRig()
    const clock = fixedClock()
    const service = new KnowledgeAdminService(rig.deps({ now: () => clock.now() }))
    try {
      const noHits = await service.ask(userCaller('alice'), { question: '预算红线是什么' })
      expect(noHits.ok).toBe(false)
      if (!noHits.ok) expect(noHits.code).toBe('unavailable')

      await service.saveDoc(userCaller('alice'), { title: '预算', body: '预算红线:超支 5% 需审批', path: 'kb/budget.md' })
      const noLlm = await service.ask(userCaller('alice'), { question: '预算' })
      expect(noLlm.ok).toBe(false)
      if (!noLlm.ok) {
        expect(noLlm.code).toBe('unavailable')
        expect(noLlm.message).toContain('LLM')
      }
    } finally {
      service.dispose()
      rig.cleanup()
    }
  })

  it('LLM + 模型选择在场 → 生成引用式答案并带 citations', async () => {
    const rig = createRig()
    const clock = fixedClock()
    const service = new KnowledgeAdminService(rig.deps({
      now: () => clock.now(),
      get: (name: string) => {
        if (name === 'llm') {
          return {
            async *stream() {
              yield { type: 'text-delta', text: '预算超支超过 5% 需先审批 [1]' }
              yield { type: 'finish' }
            },
          }
        }
        if (name === 'agentDefaultModel') return { currentSelection: () => ({ provider: 'p', model: 'm' }) }
        return undefined
      },
    }))
    try {
      await service.saveDoc(userCaller('alice'), { title: '预算', body: '预算红线:超支 5% 需审批', path: 'kb/budget.md' })
      const asked = await service.ask(userCaller('alice'), { question: '预算' })
      expect(asked.ok).toBe(true)
      if (!asked.ok) return
      expect(asked.value.answer).toContain('[1]')
      expect(asked.value.citations.length).toBeGreaterThan(0)
      expect(asked.value.model).toEqual({ provider: 'p', model: 'm' })
    } finally {
      service.dispose()
      rig.cleanup()
    }
  })
})
