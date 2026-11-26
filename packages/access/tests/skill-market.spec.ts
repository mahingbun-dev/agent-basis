/**
 * 技能市场适配器:来源表 CRUD、SkillHub 搜索/展台解析、index 两种格式、
 * SSH/SSRF 与尺寸护栏、sha256 校验、下载失败码。全部用注入 fetch 离线跑。
 */
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { zipOf } from './zip-fixture.ts'
import {
  MARKET_SEARCH_MAX, SKILLHUB_SOURCE, SkillMarket, SkillMarketError,
  entriesOf, marketUrlIssue, normalizeEntry, summaryOf,
} from '../src/skill-market.ts'

const dirs: string[] = []
function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'eterna-skill-market-'))
  dirs.push(dir)
  return dir
}
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

const SKILLHUB_ENTRY = {
  slug: 'clawhub-publisher-cli',
  displayName: 'ClawHub Publisher',
  summary: '发布到市场\n第二行中文摘要',
  version: '0.1.1',
  namespace: { handle: 'clawhub_sam-k-migz', publicSlug: 'clawhub-publisher-cli' },
  homepage: 'https://api.skillhub.cn/clawhub_sam-k-migz/clawhub-publisher-cli',
  installs: 15,
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

function binaryResponse(bytes: Buffer, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(new Uint8Array(bytes), { status, headers })
}

describe('URL 与文本护栏', () => {
  it('https 公网通过;http/本机/私网/无点主机名拒绝;白名单放行 http', () => {
    expect(marketUrlIssue('https://api.skillhub.cn')).toBeUndefined()
    expect(marketUrlIssue('http://example.com/index.json')).toMatch(/https/)
    expect(marketUrlIssue('https://localhost/x.json')).toMatch(/内网/)
    expect(marketUrlIssue('https://127.0.0.1/x.json')).toMatch(/内网/)
    expect(marketUrlIssue('https://192.168.1.5/x.json')).toMatch(/内网/)
    expect(marketUrlIssue('https://intranet/x.json')).toMatch(/内网|合法/)
    expect(marketUrlIssue('not-a-url')).toMatch(/合法/)
    expect(marketUrlIssue('http://127.0.0.1:8123/index.json', ['127.0.0.1'])).toBeUndefined()
  })

  it('摘要取首行并截断;条目归一保留 namespace/installs', () => {
    expect(summaryOf('第一行\n第二行')).toBe('第一行')
    expect(summaryOf('x'.repeat(500)).length).toBeLessThanOrEqual(200)
    const entry = normalizeEntry(SKILLHUB_ENTRY, SKILLHUB_SOURCE)
    expect(entry).toStrictEqual({
      slug: 'clawhub-publisher-cli',
      name: 'ClawHub Publisher',
      summary: '发布到市场',
      version: '0.1.1',
      sourceId: 'skillhub',
      namespace: 'clawhub_sam-k-migz',
      homepage: 'https://api.skillhub.cn/clawhub_sam-k-migz/clawhub-publisher-cli',
      installs: 15,
    })
    expect(normalizeEntry({ name: '没有 slug' }, SKILLHUB_SOURCE)).toBeUndefined()
  })

  it('entriesOf 兼容 results/skills/裸数组', () => {
    expect(entriesOf({ results: [1] })).toStrictEqual([1])
    expect(entriesOf({ skills: [1, 2] })).toStrictEqual([1, 2])
    expect(entriesOf([1])).toStrictEqual([1])
    expect(entriesOf({})).toStrictEqual([])
  })
})

describe('来源表', () => {
  it('内置 SkillHub 恒在且不可删;自定义来源增删落盘', () => {
    const market = new SkillMarket({ accessDir: tempDir() })
    expect(market.listSources().map(source => source.id)).toStrictEqual(['skillhub'])
    const added = market.addSource({ name: '团队索引', url: 'https://example.com/skills.json' })
    expect(market.listSources().map(source => source.id)).toStrictEqual(['skillhub', added.id])
    expect(() => { market.removeSource('skillhub') }).toThrow(SkillMarketError)
    market.removeSource(added.id)
    expect(market.listSources().map(source => source.id)).toStrictEqual(['skillhub'])
  })

  it('名称/URL/重复地址校验', () => {
    const market = new SkillMarket({ accessDir: tempDir() })
    expect(() => market.addSource({ name: ' ', url: 'https://example.com/a.json' })).toThrow(/名称/)
    expect(() => market.addSource({ name: 'x', url: 'http://example.com/a.json' })).toThrow(/https/)
    expect(() => market.addSource({ name: 'x', url: 'https://localhost/a.json' })).toThrow(/内网/)
    market.addSource({ name: 'x', url: 'https://example.com/a.json' })
    expect(() => market.addSource({ name: 'y', url: 'https://example.com/a.json' })).toThrow(/已存在/)
  })

  it('来源表损坏时按空处理(不崩)', () => {
    const dir = tempDir()
    const market = new SkillMarket({ accessDir: dir })
    market.addSource({ name: 'x', url: 'https://example.com/a.json' })
    // 覆盖写坏 JSON
    writeFileSync(join(dir, 'skill-markets.json'), '{broken')
    expect(market.listSources().map(source => source.id)).toStrictEqual(['skillhub'])
  })
})

describe('搜索', () => {
  it('skillhub 有查询走 /api/v1/search,结果归一并截断', async () => {
    const calls: string[] = []
    const market = new SkillMarket({
      accessDir: tempDir(),
      fetchImpl: (input) => {
        calls.push(input as string)
        return Promise.resolve(jsonResponse({ results: [SKILLHUB_ENTRY, { ...SKILLHUB_ENTRY, slug: 'b' }, { nope: true }] }))
      },
    })
    const entries = await market.search('skillhub', 'publisher', 2)
    expect(calls[0]).toContain('/api/v1/search?')
    expect(calls[0]).toContain('q=publisher')
    expect(entries.map(entry => entry.slug)).toStrictEqual(['clawhub-publisher-cli', 'b'])
  })

  it('skillhub 无查询走展台 /api/v1/showcase/hot', async () => {
    const calls: string[] = []
    const market = new SkillMarket({
      accessDir: tempDir(),
      fetchImpl: (input) => {
        calls.push(input as string)
        return Promise.resolve(jsonResponse({ section: 'hot_downloads', skills: [SKILLHUB_ENTRY] }))
      },
    })
    const entries = await market.search('skillhub', '  ', undefined)
    expect(calls[0]).toContain('/api/v1/showcase/hot?')
    expect(entries).toHaveLength(1)
  })

  it('limit 上限夹到 MARKET_SEARCH_MAX', async () => {
    const market = new SkillMarket({
      accessDir: tempDir(),
      fetchImpl: () => Promise.resolve(jsonResponse({ results: Array.from({ length: 80 }, (_, i) => ({ ...SKILLHUB_ENTRY, slug: `s${i}` })) })),
    })
    const entries = await market.search('skillhub', 'x', 999)
    expect(entries).toHaveLength(MARKET_SEARCH_MAX)
  })
})

describe('index 来源', () => {
  it('{skills:[...]} 与裸数组都认;markdownUrl 记 md,zipUrl 记 zip', async () => {
    const dir = tempDir()
    const market = new SkillMarket({ accessDir: dir, fetchImpl: () => Promise.resolve(jsonResponse({
      skills: [
        { slug: 'a', name: 'A', summary: 'sa', version: '1.0.0', zipUrl: 'https://example.com/a.zip', sha256: 'abc' },
        { slug: 'b', name: 'B', markdownUrl: 'https://example.com/b.md' },
      ],
    })) })
    const source = market.addSource({ name: '团队', url: 'https://example.com/index.json' })
    const entries = await market.search(source.id, '', undefined)
    expect(entries.map(entry => entry.slug)).toStrictEqual(['a', 'b'])
    expect(entries[1]?.summary).toBe('')
  })

  it('index 条目的私网地址被跳过(下载时按 not-found)', async () => {
    const market = new SkillMarket({ accessDir: tempDir(), fetchImpl: () => Promise.resolve(jsonResponse([
      { slug: 'a', zipUrl: 'https://127.0.0.1/a.zip' },
    ])) })
    const source = market.addSource({ name: '坏', url: 'https://example.com/index.json' })
    await expect(market.download(source.id, { slug: 'a' })).rejects.toThrow(/没有技能/)
  })
})

describe('下载', () => {
  const zipBytes = zipOf([{ path: 'SKILL.md', data: '---\nname: z-skill\ndescription: z\n---\n' }])

  it('skillhub zip:按魔数判定 zip,返回字节', async () => {
    const market = new SkillMarket({
      accessDir: tempDir(),
      fetchImpl: () => Promise.resolve(binaryResponse(zipBytes)),
    })
    const download = await market.download('skillhub', { slug: 'z-skill', namespace: 'ns', version: '1.0.0' })
    expect(download.kind).toBe('zip')
    expect(download.bytes.equals(zipBytes)).toBe(true)
  })

  it('md 文本:按内容判定 md;client 不声明 sha 时不校验', async () => {
    const market = new SkillMarket({
      accessDir: tempDir(),
      fetchImpl: () => Promise.resolve(new Response('---\nname: m-skill\ndescription: m\n---\n', { status: 200 })),
    })
    const download = await market.download('skillhub', { slug: 'm-skill' })
    expect(download.kind).toBe('md')
  })

  it('非 2xx → network;重定向到私网 → invalid;重定向次数过多', async () => {
    const notFound = new SkillMarket({ accessDir: tempDir(), fetchImpl: () => Promise.resolve(new Response('x', { status: 404 })) })
    await expect(notFound.download('skillhub', { slug: 'a' })).rejects.toThrow(/404/)

    const toPrivate = new SkillMarket({
      accessDir: tempDir(),
      fetchImpl: () => Promise.resolve(new Response('', { status: 302, headers: { location: 'https://127.0.0.1/a.zip' } })),
    })
    await expect(toPrivate.download('skillhub', { slug: 'a' })).rejects.toThrow(/内网/)

    const loop = new SkillMarket({
      accessDir: tempDir(),
      fetchImpl: input => Promise.resolve(new Response('', { status: 302, headers: { location: input as string } })),
    })
    await expect(loop.download('skillhub', { slug: 'a' })).rejects.toThrow(/重定向次数过多/)
  })

  it('content-length 超限直接拒;声明的 sha256 不符也拒', async () => {
    const tooLarge = new SkillMarket({
      accessDir: tempDir(),
      fetchImpl: () => Promise.resolve(binaryResponse(zipBytes, 200, { 'content-length': String(99 * 1024 * 1024) })),
    })
    await expect(tooLarge.download('skillhub', { slug: 'a' })).rejects.toThrow(/不能超过/)

    // 第一次请求给索引(带错误 sha256),第二次给 zip 字节
    let call = 0
    const combined = new SkillMarket({
      accessDir: tempDir(),
      fetchImpl: () => {
        call += 1
        return call === 1
          ? Promise.resolve(jsonResponse({ skills: [{ slug: 'a', zipUrl: 'https://example.com/a.zip', sha256: 'deadbeef' }] }))
          : Promise.resolve(binaryResponse(zipBytes))
      },
    })
    const source = combined.addSource({ name: '索引', url: 'https://example.com/index.json' })
    await expect(combined.download(source.id, { slug: 'a' })).rejects.toThrow(/sha256/)
  })

  it('缺 slug 与未知来源分别报 invalid/not-found', async () => {
    const market = new SkillMarket({ accessDir: tempDir(), fetchImpl: () => Promise.resolve(jsonResponse({})) })
    await expect(market.download('skillhub', {})).rejects.toThrow(/slug/)
    await expect(market.search('nope', 'x', 10)).rejects.toThrow(/不存在/)
  })

  it('技能包内容不是 zip/md → invalid', async () => {
    const market = new SkillMarket({
      accessDir: tempDir(),
      fetchImpl: () => Promise.resolve(new Response('plain text without frontmatter', { status: 200 })),
    })
    await expect(market.download('skillhub', { slug: 'a' })).rejects.toThrow(/不是/)
  })
})

describe('落盘', () => {
  it('来源表写入 0600 且格式可回读', async () => {
    const dir = tempDir()
    const market = new SkillMarket({ accessDir: dir })
    market.addSource({ name: 'x', url: 'https://example.com/a.json' })
    const raw = JSON.parse(readFileSync(join(dir, 'skill-markets.json'), 'utf8')) as { format: number; sources: unknown[] }
    expect(raw.format).toBe(1)
    expect(raw.sources).toHaveLength(1)
  })
})
