/**
 * 版本更新介绍(55 号)门禁:清单解析 / 已读账本 / 资产白名单 / 路由矩阵。
 * 真实 UserStore + SessionService + 临时 releases 目录,无网络无内核。
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { AccessAuditEvent } from '../src/audit.ts'
import { handleAccessRequest, type AccessDeps } from '../src/routes.ts'
import { ReleaseCatalog } from '../src/release-notes.ts'
import { SessionService } from '../src/session.ts'
import { SlidingWindow } from '../src/ratelimit.ts'
import { UserStore } from '../src/store.ts'
import type { AccessRequest } from '../src/http.ts'

const VERSION = '0.2.1'

function slide(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'clear',
    kind: 'feature',
    kicker: '会话',
    title: '一个命令，重开会话',
    body: '输入 /clear 清空当前会话的全部上下文。',
    facts: ['要点一'],
    media: { src: '01-clear.webp', alt: '命令面板截图', caption: '输入 /clear' },
    ...overrides,
  }
}

function manifest(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    version: VERSION,
    releasedAt: '2026-11-24',
    announce: true,
    theme: '更清楚，也更可控',
    summary: '一句话总结。',
    highlights: [{ n: '01', text: '一键清空上下文' }],
    slides: [
      { id: 'cover', kind: 'cover', title: '更清楚，也更可控' },
      slide(),
      { id: 'end', kind: 'end', title: '现在就能用' },
    ],
    ...overrides,
  }
}

describe('ReleaseCatalog', () => {
  let root: string
  let releasesDir: string
  let versionFile: string

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'eterna-release-notes-'))
    releasesDir = join(root, 'releases')
    versionFile = join(root, 'VERSION')
    writeFileSync(versionFile, `${VERSION}\n`)
  })
  afterEach(() => { rmSync(root, { recursive: true, force: true }) })

  function writeRelease(version: string, data: unknown): void {
    const dir = join(releasesDir, version)
    mkdirSync(join(dir, 'assets'), { recursive: true })
    writeFileSync(join(dir, 'release.json'), JSON.stringify(data, null, 2))
  }

  function catalog(): ReleaseCatalog {
    return new ReleaseCatalog({ releasesDir, versionFile })
  }

  it('读到当前版清单:current/summaries/version 三面一致', () => {
    writeRelease(VERSION, manifest())
    const cat = catalog()
    expect(cat.issues).toEqual([])
    expect(cat.currentVersion).toBe(VERSION)
    expect(cat.current()?.version).toBe(VERSION)
    expect(cat.summaries().map(item => item.version)).toEqual([VERSION])
    expect(cat.latestVersion).toBe(VERSION)
  })

  it('announce:false(rc/热修)不弹但仍可读:current()=undefined,manifestOf 有值', () => {
    writeRelease(VERSION, manifest({ announce: false }))
    const cat = catalog()
    expect(cat.current()).toBeUndefined()
    expect(cat.manifestOf(VERSION)?.announce).toBe(false)
    expect(cat.summaries()[0]?.version).toBe(VERSION)
  })

  it('目录名与 manifest.version 不一致 = 拒载该版(并在 issues 说明)', () => {
    writeRelease(VERSION, manifest({ version: '0.2.0' }))
    const cat = catalog()
    expect(cat.manifestOf(VERSION)).toBeUndefined()
    expect(cat.issues.join('\n')).toContain('与目录名不一致')
  })

  it('media.src 带路径 = 拒载该页(不做路径拼接)', () => {
    writeRelease(VERSION, manifest({ slides: [slide({ media: { src: '../secret.png', alt: 'x' } })] }))
    const cat = catalog()
    expect(cat.manifestOf(VERSION)).toBeUndefined()
    expect(cat.issues.join('\n')).toContain('media.src 只允许文件名')
  })

  it('slide.id 重复 = 拒载(React key 与回看定位都靠它)', () => {
    writeRelease(VERSION, manifest({ slides: [slide(), slide()] }))
    const cat = catalog()
    expect(cat.manifestOf(VERSION)).toBeUndefined()
    expect(cat.issues.join('\n')).toContain('id 缺失或重复')
  })

  it('版本按 releasedAt 倒序;同日按语义版本比较', () => {
    writeRelease('0.2.1', manifest())
    writeRelease('0.2.0', manifest({ version: '0.2.0', releasedAt: '2026-11-01' }))
    writeRelease('0.3.0', manifest({ version: '0.3.0', releasedAt: '2026-11-24' }))
    const cat = catalog()
    expect(cat.summaries().map(item => item.version)).toEqual(['0.3.0', VERSION, '0.2.0'])
  })

  it('资产只放行该版 assets/ 内、扩展名白名单内的文件', () => {
    writeRelease(VERSION, manifest())
    writeFileSync(join(releasesDir, VERSION, 'assets', '01-clear.webp'), Buffer.from('webp-bytes'))
    writeFileSync(join(releasesDir, VERSION, 'assets', 'notes.txt'), 'x')
    writeFileSync(join(root, 'secret.webp'), 'outside')
    const cat = catalog()
    expect(cat.asset(VERSION, '01-clear.webp')).toEqual({ bytes: Buffer.from('webp-bytes'), contentType: 'image/webp' })
    expect(cat.asset(VERSION, 'notes.txt')).toBeUndefined()
    expect(cat.asset(VERSION, '../secret.webp')).toBeUndefined()
    expect(cat.asset('9.9.9', '01-clear.webp')).toBeUndefined()
  })

  it('VERSION 缺失 / releases 缺失 = 功能关闭但不抛', () => {
    const cat = new ReleaseCatalog({ releasesDir, versionFile: join(root, 'nope') })
    expect(cat.currentVersion).toBeUndefined()
    expect(cat.current()).toBeUndefined()
    expect(cat.issues.length).toBeGreaterThan(0)
  })
})

describe('release-notes 路由', () => {
  let dir: string
  let releasesDir: string
  let store: UserStore
  let deps: AccessDeps
  let auditEvents: AccessAuditEvent[]
  let cookie: string
  let userId: number
  let now: number

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'eterna-release-routes-'))
    releasesDir = join(dir, 'releases')
    const versionFile = join(dir, 'VERSION')
    writeFileSync(versionFile, `${VERSION}\n`)
    const versionDir = join(releasesDir, VERSION)
    mkdirSync(join(versionDir, 'assets'), { recursive: true })
    writeFileSync(join(versionDir, 'release.json'), JSON.stringify(manifest()))
    writeFileSync(join(versionDir, 'assets', '01-clear.webp'), Buffer.from('webp-bytes'))

    store = new UserStore(join(dir, 'users.db'))
    auditEvents = []
    now = 1_000_000
    deps = {
      store,
      session: new SessionService(Buffer.from('test-secret-test-secret-test-s')),
      loginWindow: new SlidingWindow(5, 60_000, () => now),
      globalWindow: new SlidingWindow(30, 60_000, () => now),
      audit: event => auditEvents.push(event),
      bridgeHome: () => 'http://app.local/',
      dataDir: dir,
      provisionWorkspace: async () => {},
      releaseNotes: new ReleaseCatalog({ releasesDir, versionFile }),
    }
    const admin = store.createUserWithSuffix({ account: 'Mr.Ma', password: 'MqbSunny0702', role: 'admin' })
    userId = admin.user.id
    cookie = login('Mr.Ma', 'MqbSunny0702')
  })
  afterEach(() => {
    store.close()
    rmSync(dir, { recursive: true, force: true })
  })

  function req(overrides: Partial<AccessRequest>): AccessRequest {
    return {
      method: 'GET', pathname: '/', cookie: undefined, origin: undefined,
      host: 'localhost:3210', xff: undefined, contentType: undefined, body: undefined, ...overrides,
    }
  }

  function login(account: string, password: string): string {
    const reply = handleAccessRequest(deps, req({
      method: 'POST',
      pathname: '/login',
      contentType: 'application/json',
      body: Buffer.from(JSON.stringify({ account, password })),
    }))
    expect(reply.status).toBe(200)
    return reply.headers.find(([name]) => name === 'set-cookie')?.[1] ?? ''
  }

  it('匿名 GET = 401(与其它 /access/api 同门)', () => {
    expect(handleAccessRequest(deps, req({ pathname: '/access/api/release-notes' })).status).toBe(401)
  })

  it('登录后 GET 返回 current/history/seen,并带 no-store', () => {
    const reply = handleAccessRequest(deps, req({ pathname: '/access/api/release-notes', cookie }))
    expect(reply.status).toBe(200)
    expect(reply.headers).toContainEqual(['cache-control', 'no-store'])
    const body = JSON.parse(String(reply.body)) as {
      version: string
      current: { version: string }
      seen: boolean
      history: Array<{ version: string; seen: boolean }>
    }
    expect(body.version).toBe(VERSION)
    expect(body.current.version).toBe(VERSION)
    expect(body.seen).toBe(false)
    expect(body.history).toEqual([
      { version: VERSION, releasedAt: '2026-11-24', theme: '更清楚，也更可控', announce: true, seen: false },
    ])
  })

  it('POST seen:204 落库,幂等且保留首次 via;非法 via=400', () => {
    const first = handleAccessRequest(deps, req({
      method: 'POST', pathname: '/access/api/release-notes/seen', cookie,
      contentType: 'application/json',
      body: Buffer.from(JSON.stringify({ version: VERSION, via: 'skip' })),
    }))
    expect(first.status).toBe(204)
    const second = handleAccessRequest(deps, req({
      method: 'POST', pathname: '/access/api/release-notes/seen', cookie,
      contentType: 'application/json',
      body: Buffer.from(JSON.stringify({ version: VERSION, via: 'done' })),
    }))
    expect(second.status).toBe(204)
    expect(store.releaseNotesSeen(userId).has(VERSION)).toBe(true)
    expect(auditEvents.filter(event => event.kind === 'access.release-notes.seen')).toHaveLength(2)
    // 回看不改已读时间/原因:表里只有一行,via 仍是首次的 skip
    expect(store.releaseNotesSeenRow(userId, VERSION)?.via).toBe('skip')

    const bad = handleAccessRequest(deps, req({
      method: 'POST', pathname: '/access/api/release-notes/seen', cookie,
      contentType: 'application/json',
      body: Buffer.from(JSON.stringify({ version: VERSION, via: 'whatever' })),
    }))
    expect(bad.status).toBe(400)
  })

  it('?version= 指定历史版;未知版本 404', () => {
    const unknown = handleAccessRequest(deps, req({ pathname: '/access/api/release-notes', cookie, query: 'version=9.9.9' }))
    expect(unknown.status).toBe(404)
    const current = handleAccessRequest(deps, req({ pathname: '/access/api/release-notes', cookie, query: `version=${VERSION}` }))
    expect(current.status).toBe(200)
  })

  it('资产:登录 200 + 长缓存 + nosniff;未登录 401;穿越/非白名单 400/404', () => {
    const ok = handleAccessRequest(deps, req({
      pathname: `/access/api/release-notes/asset/${VERSION}/01-clear.webp`, cookie,
    }))
    expect(ok.status).toBe(200)
    expect(ok.headers).toContainEqual(['content-type', 'image/webp'])
    expect(ok.headers).toContainEqual(['cache-control', 'public, max-age=31536000, immutable'])
    expect(ok.headers).toContainEqual(['x-content-type-options', 'nosniff'])
    expect(Buffer.from(ok.body as Uint8Array).toString()).toBe('webp-bytes')

    expect(handleAccessRequest(deps, req({ pathname: `/access/api/release-notes/asset/${VERSION}/01-clear.webp` })).status).toBe(401)
    expect(handleAccessRequest(deps, req({ pathname: `/access/api/release-notes/asset/${VERSION}/notes.txt`, cookie })).status).toBe(404)
    expect(handleAccessRequest(deps, req({ pathname: `/access/api/release-notes/asset/${VERSION}/..%2Fsecret.webp`, cookie })).status).toBe(400)
  })

  it('删用户级联清 release_notes_seen(否则外键撞车 → 500)', () => {
    const user = store.createUserWithSuffix({ account: 'worker', password: 'MqbSunny0702', role: 'user' })
    store.markReleaseNotesSeen(user.user.id, VERSION, 'done')
    expect(() => { store.deleteUser(user.user.id, userId) }).not.toThrow()
  })

  it('未装配 catalog = 404(功能整体缺席,而非静默 200 空壳)', () => {
    const bare: AccessDeps = { ...deps, releaseNotes: undefined }
    expect(handleAccessRequest(bare, req({ pathname: '/access/api/release-notes', cookie })).status).toBe(404)
  })
})
