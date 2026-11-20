/**
 * T28 B14 个人层 MCP UI 的客户端契约测试(纯逻辑面 + 信封)。
 *
 * 钉住四件事:
 * 1. 五端点全部走 RPC 信封(裸 body 会 400),upsert 的明文只在 args.request.secrets/env;
 * 2. 角色 → 页签(admin: 全局/管理员目录;普通用户: 我的服务器);
 * 3. 密钥 write-only:视图只有 hasSecret,编辑草稿不回填值,留空 = 复用旧密文;
 * 4. 删除走两击组件、无原生 confirm()/alert(),新增客户端源码 0 字面色值。
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  mcpPersonalApi, type McpCatalogEntry, type McpPersonalItem,
} from '../src/client/mcp-personal-api.ts'
import {
  MCP_LOCALES,
} from '../src/client/mcp-servers-locales.ts'
import {
  buildToggleRequest, buildUpsertRequest, draftIssue, draftIssueMessageKey, draftOfItem, draftOfNew,
  isAcceptableHttpUrl, probeSummary, quotaLabel, secretRefForHeader, tabsForRole, transportLabelKey, withCatalog,
  type McpDraft,
} from '../src/client/mcp-servers-model.ts'
import { openSettingsSection } from '../src/client/settings-nav.ts'

const CLIENT_DIR = join(import.meta.dirname, '..', 'src', 'client')
const readClient = (name: string): string => readFileSync(join(CLIENT_DIR, name), 'utf8')

interface Captured {
  readonly url: string
  readonly body: { type?: unknown; rpcId?: unknown; method?: unknown; payload?: { args?: unknown } }
}

function stubFetch(payload: unknown, status = 200): Captured[] {
  const captured: Captured[] = []
  vi.stubGlobal('fetch', (url: string, init: RequestInit) => {
    const text: string = typeof init.body === 'string' ? init.body : '{}'
    captured.push({ url, body: JSON.parse(text) as Captured['body'] })
    return Promise.resolve(new Response(JSON.stringify(payload), { status, headers: { 'content-type': 'application/json' } }))
  })
  return captured
}

afterEach(() => { vi.unstubAllGlobals() })

const CATALOG: readonly McpCatalogEntry[] = [
  { name: 'docs', label: '文档服务', transport: 'stdio', envNames: ['DOCS_TOKEN', 'DOCS_ROOT'] },
  { name: 'search', label: '检索服务', transport: 'stdio', envNames: [] },
]

function item(overrides: Partial<McpPersonalItem> = {}): McpPersonalItem {
  return {
    id: 'srv-1', name: 'docs', serverName: 'p7_docs', transport: 'streamable-http',
    catalogId: null, url: 'https://example.com/mcp', headerNames: ['Authorization', 'X-Trace'],
    hasSecret: true, enabled: true, createdAt: '2026-11-20T00:00:00Z', updatedAt: '2026-11-20T00:00:00Z',
    ...overrides,
  }
}

function draft(overrides: Partial<McpDraft> = {}): McpDraft {
  return { ...draftOfNew([]), ...overrides }
}

describe('MCP 个人层 API 信封', () => {
  it('catalog/list:POST 到正确路径,method 去掉 /api/ 前缀,args 为空对象', async () => {
    const captured = stubFetch({ result: { ok: true, value: { items: [], limit: 8 } } })
    await mcpPersonalApi.catalog()
    await mcpPersonalApi.list()
    expect(captured.map(row => row.url)).toStrictEqual(['/api/mcp-personal/catalog', '/api/mcp-personal/list'])
    expect(captured[0]?.body.type).toBe('client-request')
    expect(captured[0]?.body.method).toBe('mcp-personal/catalog')
    expect(captured[1]?.body.method).toBe('mcp-personal/list')
    expect(captured[0]?.body.payload?.args).toStrictEqual({})
  })

  it('upsert/delete/probe:参数包在 {request} 里(服务端读 args.request.*)', async () => {
    const captured = stubFetch({ result: { ok: true, value: { item: item(), ok: true } } })
    await mcpPersonalApi.upsert({ name: 'docs', transport: 'streamable-http', url: 'https://example.com/mcp' })
    await mcpPersonalApi.remove('srv-1')
    await mcpPersonalApi.probe('srv-1')
    expect(captured[0]?.body.method).toBe('mcp-personal/upsert')
    expect(captured[1]?.body.payload?.args).toStrictEqual({ request: { id: 'srv-1' } })
    expect(captured[2]?.body.payload?.args).toStrictEqual({ request: { id: 'srv-1' } })
    expect((captured[0]?.body.payload?.args as { request: { name: string } }).request.name).toBe('docs')
  })

  it('失败帧原样带出服务端 message(含未登录/条目不存在)', async () => {
    stubFetch({ result: { ok: false, error: { code: 'tenant/denied', message: 'MCP 条目不存在或不属于你', details: {} } } })
    const result = await mcpPersonalApi.remove('other-id')
    expect(result.ok).toBe(false)
    expect(result.error?.message).toBe('MCP 条目不存在或不属于你')
  })
})

describe('角色 → 页签', () => {
  it('admin:全局/管理员目录;普通用户:仅我的服务器', () => {
    expect(tabsForRole('admin').map(tab => tab.id)).toStrictEqual(['global', 'catalog'])
    expect(tabsForRole('user').map(tab => tab.id)).toStrictEqual(['mine'])
    expect(tabsForRole('user')[0]?.labelKey).toBe('mcp.tab.mine')
  })

  it('分区注册进入 settings.section,标签用「MCP 服务器」', () => {
    const source = readClient('index.tsx')
    expect(source).toContain('${NS}.mcp-servers')
    expect(source).toContain("label: () => t('section.mcpServers')")
    expect(MCP_LOCALES.zh['section.mcpServers']).toBe('MCP 服务器')
  })
})

describe('表单草稿与 write-only 密钥', () => {
  it('编辑草稿不为任何密钥字段回填值,只保留 hasSecret 与 header 名', () => {
    const form = draftOfItem(item(), CATALOG)
    expect(form.hasSecret).toBe(true)
    expect(form.headers.map(row => [row.name, row.value])).toStrictEqual([['Authorization', ''], ['X-Trace', '']])
    expect(Object.values(form.headers).some(row => row.value !== '')).toBe(false)
    expect(form.knownHeaders).toStrictEqual(['authorization', 'x-trace'])
  })

  it('切换目录项保留同名环境变量输入,丢弃其余', () => {
    const form = withCatalog(draft({ transport: 'stdio' }), CATALOG[0])
    const edited = { ...form, env: form.env.map(row => row.name === 'DOCS_TOKEN' ? { ...row, value: 'typed' } : row) }
    const switched = withCatalog(edited, CATALOG[1])
    expect(switched.catalogId).toBe('search')
    expect(switched.env).toStrictEqual([])
    const back = withCatalog({ ...switched, env: [{ name: 'DOCS_TOKEN', value: 'kept' }] }, CATALOG[0])
    expect(back.env).toStrictEqual([{ name: 'DOCS_TOKEN', value: 'kept' }, { name: 'DOCS_ROOT', value: '' }])
  })

  it('校验:名称/目录/URL/元数据/重复 header/缺密钥', () => {
    expect(draftIssue(draft({ name: '  ' }), CATALOG)).toBe('name')
    expect(draftIssue(draft({ name: 'x', transport: 'stdio', catalogId: '' }), CATALOG)).toBe('catalog')
    expect(draftIssue(draft({ name: 'x', transport: 'streamable-http', url: 'ftp://a' }), CATALOG)).toBe('url')
    expect(isAcceptableHttpUrl('http://169.254.169.254/latest')).toBe(false)
    expect(isAcceptableHttpUrl('http://[fd00:ec2::254]/')).toBe(false)
    expect(isAcceptableHttpUrl('http://localhost:3333/mcp')).toBe(true)
    expect(draftIssue(draft({
      name: 'x', url: 'https://a.example/mcp',
      headers: [{ name: 'Authorization', value: '' }],
    }), CATALOG)).toBe('headerSecret')
    expect(draftIssue(draft({
      name: 'x', url: 'https://a.example/mcp', hasSecret: true, knownHeaders: ['authorization'],
      headers: [{ name: 'Authorization', value: '' }],
    }), CATALOG)).toBeUndefined()
    expect(draftIssue(draft({
      name: 'x', url: 'https://a.example/mcp', hasSecret: true, knownHeaders: ['authorization'],
      headers: [{ name: 'X-Renamed', value: '' }],
    }), CATALOG)).toBe('headerSecret')
    expect(draftIssue(draft({
      name: 'x', url: 'https://a.example/mcp',
      headers: [{ name: 'A', value: '1' }, { name: 'a', value: '2' }],
    }), CATALOG)).toBe('headerName')
  })

  it('upsert 请求:HTTP header 只发 ${secret:REF} 占位,明文只进 secrets(留空=复用)', () => {
    const form = draft({
      id: 'srv-1', name: 'docs', transport: 'streamable-http', url: 'https://example.com/mcp',
      hasSecret: true, knownHeaders: ['authorization', 'x-trace'],
      headers: [{ name: 'Authorization', value: 'Bearer secret' }, { name: 'X-Trace', value: '' }],
    })
    const request = buildUpsertRequest(form, CATALOG)
    expect(request).toBeDefined()
    expect(request?.id).toBe('srv-1')
    expect(request?.headers?.Authorization).toMatch(/^\$\{secret:header:[A-Za-z0-9_.:-]{1,64}\}$/u)
    expect(request?.headers?.['X-Trace']).toMatch(/^\$\{secret:/u)
    expect(Object.values(request?.headers ?? {})).not.toContain('Bearer secret')
    expect(Object.values(request?.secrets ?? {})).toStrictEqual(['Bearer secret'])
    expect(request?.secrets?.[secretRefForHeader('Authorization')]).toBe('Bearer secret')
  })

  it('stdio 请求不带 command/args,env 只发非空值(留空=保留旧密文)', () => {
    const form = draft({
      name: 'docs', transport: 'stdio', catalogId: 'docs', hasSecret: true,
      env: [{ name: 'DOCS_TOKEN', value: '' }, { name: 'DOCS_ROOT', value: '/data' }],
    })
    const request = buildUpsertRequest(form, CATALOG)
    expect(request?.transport).toBe('stdio')
    expect(request?.catalogId).toBe('docs')
    expect(request?.env).toStrictEqual({ DOCS_ROOT: '/data' })
    expect(Object.prototype.hasOwnProperty.call(request, 'command')).toBe(false)
    expect(Object.prototype.hasOwnProperty.call(request, 'args')).toBe(false)
    expect(Object.prototype.hasOwnProperty.call(request, 'secrets')).toBe(false)
  })

  it('secretRef 确定性、同长度 ≤64 且符合服务端 ref 字面表', () => {
    const a = secretRefForHeader('Authorization')
    const b = secretRefForHeader('authorization')
    expect(a).toBe(b)
    expect(a).toMatch(/^[A-Za-z0-9_.:-]{1,64}$/u)
    expect(secretRefForHeader('X-'+'A'.repeat(200)).length).toBeLessThanOrEqual(64)
    expect(secretRefForHeader('X-'+'A'.repeat(200))).not.toBe(secretRefForHeader('X-'+'A'.repeat(199)))
  })
})

describe('行内启停 / 测试 / 配额', () => {
  it('stdio 启停只翻转 enabled,不重发 env', () => {
    const built = buildToggleRequest(item({ transport: 'stdio', catalogId: 'docs', url: null, headerNames: [], hasSecret: false }))
    expect(built.ok).toBe(true)
    if (!built.ok) return
    expect(built.request.enabled).toBe(false)
    expect(built.request.catalogId).toBe('docs')
    expect(Object.prototype.hasOwnProperty.call(built.request, 'env')).toBe(false)
  })

  it('HTTP 启停重发占位复用密文;无存量密钥 + 有 header → 拒绝并给原因', () => {
    const ok = buildToggleRequest(item())
    expect(ok.ok).toBe(true)
    if (ok.ok) {
      expect(ok.request.headers?.Authorization).toMatch(/^\$\{secret:/u)
      expect(Object.prototype.hasOwnProperty.call(ok.request, 'secrets')).toBe(false)
    }
    const blocked = buildToggleRequest(item({ hasSecret: false }))
    expect(blocked).toStrictEqual({ ok: false, issue: 'secretMissing' })
    const missingCatalog = buildToggleRequest(item({ transport: 'stdio', catalogId: null, headerNames: [] }))
    expect(missingCatalog).toStrictEqual({ ok: false, issue: 'catalog' })
  })

  it('probe 文案/配额模板替换', () => {
    const t = (key: string): string => ({ 'mcp.testOk': '成功 {count}', 'mcp.testFail': '失败 {reason}', 'mcp.unknownError': '未知' })[key] ?? key
    expect(probeSummary({ ok: true, toolCount: 3 }, t)).toStrictEqual({ ok: true, text: '成功 3' })
    expect(probeSummary({ ok: false, toolCount: 0, error: 'timeout' }, t)).toStrictEqual({ ok: false, text: '失败 timeout' })
    expect(probeSummary({ ok: false, toolCount: 0 }, t)).toStrictEqual({ ok: false, text: '失败 未知' })
    expect(quotaLabel('已用 {used}/{limit}', 2, 8)).toBe('已用 2/8')
    expect(transportLabelKey('stdio')).toBe('mcp.transportStdio')
    expect(transportLabelKey('streamable-http')).toBe('mcp.transportHttp')
  })
})

describe('设置壳跳转(原生扩展点)', () => {
  it('座位 store 暴露 openSection → 跳转并返回 true;缺席/异常 → false', () => {
    const opened: string[] = []
    const seats = { entries: () => [{ store: { create: () => ({ actions: { openSection: (id: string) => { opened.push(id) } } }) } }] }
    expect(openSettingsSection(seats, 'plugins')).toBe(true)
    expect(opened).toStrictEqual(['plugins'])
    expect(openSettingsSection({ entries: () => [] }, 'plugins')).toBe(false)
    expect(openSettingsSection({ entries: () => { throw new Error('boom') } }, 'plugins')).toBe(false)
  })
})

describe('文案与 UI 纪律', () => {
  const sourceKeys = new Set<string>()
  for (const file of ['mcp-servers-section.tsx', 'mcp-servers-model.ts']) {
    for (const match of readClient(file).matchAll(/\bmcp\.[a-z][a-zA-Z0-9.]*/gu)) sourceKeys.add(match[0])
  }

  it('源码引用的 mcp.* 键 zh/en 全部存在且非空', () => {
    expect(sourceKeys.size).toBeGreaterThan(40)
    for (const key of sourceKeys) {
      expect(MCP_LOCALES.zh[key], `zh:${key}`).toBeTruthy()
      expect(MCP_LOCALES.en[key], `en:${key}`).toBeTruthy()
    }
  })

  it('zh/en 键集合一致', () => {
    expect(Object.keys(MCP_LOCALES.en).sort()).toStrictEqual(Object.keys(MCP_LOCALES.zh).sort())
  })

  it('说明类文案 ≤40 字(42 号 §3 段落预算)', () => {
    for (const key of ['mcp.adminHint', 'mcp.userHint', 'mcp.globalDesc', 'mcp.catalogDesc', 'mcp.catalogReadonly', 'mcp.headersHint', 'mcp.envHint', 'mcp.limitHint', 'mcp.catalogPickEmpty']) {
      const value = MCP_LOCALES.zh[key] ?? ''
      expect(value.length, key).toBeLessThanOrEqual(40)
    }
  })

  it('新增客户端源码:无原生 confirm()/alert(),无字面色值,删除走两击组件', () => {
    for (const file of ['mcp-servers-section.tsx', 'mcp-servers-model.ts', 'mcp-personal-api.ts', 'settings-nav.ts', 'mcp-servers-locales.ts']) {
      const source = readClient(file)
      expect(source, file).not.toMatch(/\bwindow\.confirm\s*\(|\bwindow\.alert\s*\(/u)
      expect(source, file).not.toMatch(/\balert\(/u)
      expect(source, file).not.toMatch(/#[0-9a-fA-F]{3,8}\b/u)
    }
    const section = readClient('mcp-servers-section.tsx')
    expect(section).toContain('ArmedDelete')
    expect(section).toContain('t(\'mcp.deleteConfirm\')')
    for (const issue of ['name', 'catalog', 'url', 'headerName', 'headerSecret', 'secretLength'] as const) {
      expect(draftIssueMessageKey(issue)).toMatch(/^mcp\./u)
    }
  })
})
