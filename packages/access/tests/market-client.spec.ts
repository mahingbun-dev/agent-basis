/**
 * 技能市场客户端契约:RPC 信封与端点、来源/搜索/安装参数、纯逻辑(查询/摘要/来源标签)、
 * 市场页签注册与文案键完整性、无字面色值/原生 confirm。
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { marketApi, type MarketSourceView } from '../src/client/market-api.ts'
import { SKILL_LOCALES } from '../src/client/skills-locales.ts'
import {
  MARKET_QUERY_MAX, installLabelKey, installedMessage, installsLabel, marketFailureMessage,
  marketQueryIssue, marketSummary, sourceOptionLabel, versionLabel,
} from '../src/client/market-model.ts'
import { SKILL_TABS, installTargetsFor, isScopeTab, originLabelKey } from '../src/client/skills-model.ts'

const CLIENT_DIR = join(import.meta.dirname, '..', 'src', 'client')
const readClient = (name: string): string => readFileSync(join(CLIENT_DIR, name), 'utf8')

interface Captured {
  readonly url: string
  readonly body: { type?: unknown; rpcId?: unknown; method?: unknown; payload?: { args?: unknown } }
}

function stubFetch(value: unknown): Captured[] {
  const captured: Captured[] = []
  vi.stubGlobal('fetch', (url: string, init: RequestInit) => {
    const text: string = typeof init.body === 'string' ? init.body : '{}'
    captured.push({ url, body: JSON.parse(text) as Captured['body'] })
    return Promise.resolve(new Response(JSON.stringify({ result: { ok: true, value } }), {
      status: 200, headers: { 'content-type': 'application/json' },
    }))
  })
  return captured
}

afterEach(() => { vi.unstubAllGlobals() })

const SOURCE: MarketSourceView = { id: 'skillhub', name: 'SkillHub', kind: 'skillhub', url: 'https://api.skillhub.cn', builtin: true }

describe('市场 API 信封与参数', () => {
  it('五个端点都走 client-request 信封,方法名去掉 /api 前缀', async () => {
    const captured = stubFetch({ sources: [SOURCE], entries: [], limit: 50, item: { name: 'a' }, source: SOURCE, removed: true })
    await marketApi.sources()
    await marketApi.search('skillhub', '  publisher  ', 10)
    await marketApi.install({ scope: 'personal', sourceId: 'skillhub', slug: 'a', namespace: 'ns', version: '1.0.0' })
    await marketApi.addSource('团队', 'https://example.com/index.json')
    await marketApi.removeSource('src-1')
    expect(captured.map(item => item.url)).toStrictEqual([
      '/api/skills-manage/market/list',
      '/api/skills-manage/market/search',
      '/api/skills-manage/market/install',
      '/api/skills-manage/market/source-add',
      '/api/skills-manage/market/source-remove',
    ])
    for (const item of captured) {
      expect(item.body.type).toBe('client-request')
      expect(typeof item.body.rpcId).toBe('string')
      expect(item.body.method).toBe(item.url.replace(/^\/api\//u, ''))
    }
    expect(captured[1]?.body.payload?.args).toStrictEqual({ sourceId: 'skillhub', query: 'publisher', limit: 10 })
    expect(captured[2]?.body.payload?.args).toStrictEqual({
      scope: 'personal', sourceId: 'skillhub', slug: 'a', namespace: 'ns', version: '1.0.0',
    })
  })

  it('空搜索词不发 query 字段;缺省 limit 不发', async () => {
    const captured = stubFetch({ entries: [], limit: 50 })
    await marketApi.search('skillhub', '   ')
    expect(captured[0]?.body.payload?.args).toStrictEqual({ sourceId: 'skillhub' })
  })
})

describe('市场纯逻辑', () => {
  it('页签:market 非作用域;安装目标按角色', () => {
    expect(SKILL_TABS.map(tab => tab.id)).toStrictEqual(['mine', 'shared', 'market'])
    expect(isScopeTab('market')).toBe(false)
    expect(isScopeTab('mine')).toBe(true)
    expect(installTargetsFor('user')).toStrictEqual(['personal'])
    expect(installTargetsFor('admin')).toStrictEqual(['personal', 'shared'])
    expect(installLabelKey('personal')).toBe('skills.market.installMine')
    expect(installLabelKey('shared')).toBe('skills.market.installShared')
  })

  it('来源标签/安装量/版本/摘要/错误文案', () => {
    expect(sourceOptionLabel(SOURCE, '（内置）')).toBe('SkillHub（内置）')
    expect(sourceOptionLabel({ ...SOURCE, builtin: false }, '（内置）')).toBe('SkillHub')
    expect(installsLabel(undefined, '{count} 次安装')).toBe('')
    expect(installsLabel(0, '{count} 次安装')).toBe('')
    expect(installsLabel(15, '{count} 次安装')).toBe('15 次安装')
    expect(installsLabel(23_000, '{count} 次安装')).toBe('2.3 万 次安装')
    expect(versionLabel('')).toBe('—')
    expect(versionLabel('1.2.3')).toBe('1.2.3')
    expect(marketSummary('  多行\n内容  ', 10)).toBe('多行 内容')
    expect(marketSummary('x'.repeat(20), 10)).toHaveLength(10)
    expect(marketFailureMessage({ ok: false, error: { message: '来源返回 403' } }, 'fallback')).toBe('来源返回 403')
    expect(marketFailureMessage({ ok: false }, 'fallback')).toBe('fallback')
    expect(installedMessage('已安装「{name}」', 'demo')).toBe('已安装「demo」')
    expect(originLabelKey('market')).toBe('skills.originMarket')
  })

  it('查询超长返回文案键,空串合法', () => {
    expect(marketQueryIssue('x'.repeat(MARKET_QUERY_MAX))).toBeUndefined()
    expect(marketQueryIssue('x'.repeat(MARKET_QUERY_MAX + 1))).toBe('skills.market.queryTooLong')
    expect(marketQueryIssue('')).toBeUndefined()
  })
})

describe('市场 UI 源码纪律', () => {
  const files = ['skills-section.tsx', 'market-api.ts', 'market-model.ts', 'skills-locales.ts']

  it('市场页签接入页面:三页签 + MarketPanel + 卡片/工具栏锚点', () => {
    const page = readClient('skills-section.tsx')
    expect(page).toContain('MarketPanel')
    expect(page).toContain('isScopeTab(active)')
    for (const token of ['data-eterna-market', 'data-eterna-market-source', 'data-eterna-market-query',
      'data-eterna-market-entry', 'data-eterna-market-install']) {
      expect(page, token).toContain(token)
    }
    // 卡片动作 ≤2:普通用户单按钮,管理员两按钮(getter 按 installTargetsFor 展开)
    expect(page).toContain('installTargetsFor(role)')
    expect(page).toContain('ea-cards')
    expect(page).toContain('ea-pcard')
    expect(page).toContain('ArmedDelete')
  })

  it('市场文案 zh/en 全部存在且非空', () => {
    const sourceKeys = new Set<string>()
    for (const file of files) {
      for (const match of readClient(file).matchAll(/\bskills\.(?:market\.[a-zA-Z0-9.]+|tab\.market|originMarket)/gu)) sourceKeys.add(match[0])
    }
    expect(sourceKeys.size).toBeGreaterThan(20)
    for (const key of sourceKeys) {
      expect((SKILL_LOCALES.zh as Record<string, string>)[key], `zh:${key}`).toBeTruthy()
      expect((SKILL_LOCALES.en as Record<string, string>)[key], `en:${key}`).toBeTruthy()
    }
  })

  it('无原生 confirm()/alert()、无字面色值、无上游不存在令牌', () => {
    for (const file of files) {
      const source = readClient(file)
      expect(source, file).not.toMatch(/\bwindow\.confirm\s*\(|\bwindow\.alert\s*\(/u)
      expect(source, file).not.toMatch(/\balert\(/u)
      expect(source, file).not.toMatch(/#[0-9a-fA-F]{3,8}\b/u)
      expect(source, file).not.toMatch(/--dsw-alias-[a-z-]+/u)
    }
  })
})
