// companion 令牌簿与端点测试（E4）：生成/查看/重置语义、文件落盘（0600+原子结构）、
// guideUrl 推导（公网 ws → https 指引页；缺省本机）、未登录拒绝、审计不落令牌值。
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { AccessAuditEvent } from '../src/audit.ts'
import { companionGuideUrl, companionTokenOf, companionTokenPath, resetCompanionToken } from '../src/companion.ts'
import type { AccessReply, AccessRequest } from '../src/http.ts'
import { SessionService } from '../src/session.ts'
import { SlidingWindow } from '../src/ratelimit.ts'
import { handleAccessRequest, type AccessDeps } from '../src/routes.ts'
import { UserStore } from '../src/store.ts'

describe('companion 令牌簿', () => {
  let dir: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'eterna-access-companion-'))
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('guideUrl 推导：wss 公网 → https 指引页；ws 前缀保留；缺省本机', () => {
    expect(companionGuideUrl('wss://eternity-electricity.cn:9310/extension')).toBe('https://eternity-electricity.cn:9310/companion/guide')
    expect(companionGuideUrl('wss://host/team/relay/extension')).toBe('https://host/team/relay/companion/guide')
    expect(companionGuideUrl('ws://127.0.0.1:9310/extension')).toBe('http://127.0.0.1:9310/companion/guide')
    expect(companionGuideUrl(undefined)).toBe('http://127.0.0.1:9310/companion/guide')
    expect(companionGuideUrl('not-a-url')).toBe('http://127.0.0.1:9310/companion/guide')
  })

  it('重置覆盖旧令牌；文件 0600 落盘且结构可被 relay 直读', () => {
    const first = resetCompanionToken(dir, 7)
    const second = resetCompanionToken(dir, 7)
    expect(second.token).not.toBe(first.token)
    expect(companionTokenOf(dir, 7)?.token).toBe(second.token)
    expect(companionTokenOf(dir, 8)).toBeUndefined()
    const path = companionTokenPath(dir)
    expect(existsSync(path)).toBe(true)
    expect((statSync(path).mode & 0o777).toString(8)).toBe('600')
    // relay 的 readUserTokens 同款解析：JSON 对象 + token 字符串
    const raw = JSON.parse(readFileSync(path, 'utf8')) as Record<string, { token: string }>
    expect(raw['7']?.token).toBe(second.token)
  })
})

describe('companion 端点', () => {
  let dir: string
  let store: UserStore
  let deps: AccessDeps
  let auditEvents: AccessAuditEvent[]
  let adminCookie: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'eterna-access-companion-routes-'))
    store = new UserStore(join(dir, 'users.db'))
    auditEvents = []
    deps = {
      store,
      session: new SessionService(Buffer.from('test-secret-test-secret-test-s')),
      loginWindow: new SlidingWindow(5, 60_000),
      globalWindow: new SlidingWindow(30, 60_000),
      audit: event => auditEvents.push(event),
      bridgeHome: () => 'http://app.local/?token=bridge-token',
      dataDir: dir,
      provisionWorkspace: async () => {},
      relayPublicWsUrl: 'wss://eternity-electricity.cn:9310/extension',
    }
    store.createUserWithSuffix({ account: 'Mr.Ma', password: 'MqbSunny0702', role: 'admin' })
    const loginReply = handleAccessRequest(deps, req({
      pathname: '/login', method: 'POST', contentType: 'application/json',
      body: Buffer.from(JSON.stringify({ account: 'Mr.Ma', password: 'MqbSunny0702' })),
    }))
    adminCookie = cookieOf(loginReply)!
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

  function cookieOf(reply: AccessReply): string | undefined {
    const found = reply.headers.find(([name]) => name === 'set-cookie')
    return found === undefined ? undefined : found[1]
  }

  function bodyOf(reply: AccessReply): Record<string, unknown> {
    expect(typeof reply.body).toBe('string')
    return JSON.parse(reply.body as string) as Record<string, unknown>
  }

  it('未登录 GET/reset → 401（requireUser 门禁）', () => {
    expect(handleAccessRequest(deps, req({ pathname: '/access/api/companion' })).status).toBe(401)
    expect(handleAccessRequest(deps, req({ pathname: '/access/api/companion/reset', method: 'POST' })).status).toBe(401)
  })

  it('登录后：初始 null → reset 生成 → view 命中；guideUrl 按公网推导', () => {
    const before = bodyOf(handleAccessRequest(deps, req({ pathname: '/access/api/companion', cookie: adminCookie })))
    expect(before.token).toBeNull()
    expect(before.guideUrl).toBe('https://eternity-electricity.cn:9310/companion/guide')

    const resetReply = handleAccessRequest(deps, req({
      pathname: '/access/api/companion/reset', method: 'POST', cookie: adminCookie,
      origin: 'http://localhost:3210',
    }))
    expect(resetReply.status).toBe(200)
    const reset = bodyOf(resetReply)
    expect(typeof reset.token).toBe('string')
    expect((reset.token as string).startsWith('ec-')).toBe(true)

    const after = bodyOf(handleAccessRequest(deps, req({ pathname: '/access/api/companion', cookie: adminCookie })))
    expect(after.token).toBe(reset.token)
    // 审计记录动作但不落令牌值
    const tokenAudit = auditEvents.find(e => e.kind === 'access.companion.token')
    expect(tokenAudit).toBeDefined()
    expect(JSON.stringify(tokenAudit)).not.toContain(reset.token as string)
  })
})
