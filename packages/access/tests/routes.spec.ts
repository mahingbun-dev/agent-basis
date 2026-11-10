/**
 * 路由核心门禁:计划书 §4.0 端点表全量——鉴权/角色/同源/限速/pwv 吊销/头像白名单/
 * D11 后缀/删除护栏/审计事件。真实 store+session+可注入时钟,无网络无内核依赖。
 */
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { AccessAuditEvent } from '../src/audit.ts'
import { clientIp, parseAvatarDataUrl, type AccessReply, type AccessRequest } from '../src/http.ts'
import { handleAccessRequest, type AccessDeps } from '../src/routes.ts'
import { SessionService } from '../src/session.ts'
import { SlidingWindow } from '../src/ratelimit.ts'
import { UserStore } from '../src/store.ts'

const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]

function pngDataUrl(bytes = 16): string {
  const data = Buffer.concat([Buffer.from(PNG_MAGIC), Buffer.alloc(bytes)])
  return `data:image/png;base64,${data.toString('base64')}`
}

describe('access 路由核心', () => {
  let dir: string
  let store: UserStore
  let deps: AccessDeps
  let auditEvents: AccessAuditEvent[]
  let now: number
  let adminCookie: string
  let adminId: number

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'eterna-access-routes-'))
    store = new UserStore(join(dir, 'users.db'))
    auditEvents = []
    now = 1_000_000
    const session = new SessionService(Buffer.from('test-secret-test-secret-test-s'))
    deps = {
      store,
      session,
      loginWindow: new SlidingWindow(5, 60_000, () => now),
      globalWindow: new SlidingWindow(30, 60_000, () => now),
      audit: event => auditEvents.push(event),
      bridgeHome: () => 'http://app.local/?token=bridge-token',
      dataDir: dir,
    }
    const admin = store.createUserWithSuffix({ account: 'Mr.Ma', password: 'MqbSunny0702', role: 'admin' })
    adminId = admin.user.id
    adminCookie = login('Mr.Ma', 'MqbSunny0702')
  })
  afterEach(() => {
    store.close()
    rmSync(dir, { recursive: true, force: true })
  })

  function login(account: string, password: string): string {
    const reply = handleAccessRequest(deps, req({
      method: 'POST',
      pathname: '/login',
      body: Buffer.from(JSON.stringify({ account, password })),
    }))
    expect(reply.status).toBe(302)
    return cookieOf(reply) ?? ''
  }

  function req(overrides: Partial<AccessRequest>): AccessRequest {
    return {
      method: 'GET', pathname: '/', cookie: undefined, origin: undefined,
      host: 'localhost:3210', xff: undefined, body: undefined, ...overrides,
    }
  }

  function cookieOf(reply: AccessReply): string | undefined {
    return reply.headers.find(([name]) => name === 'set-cookie')?.[1]
  }

  function bodyOf(reply: AccessReply): Record<string, unknown> {
    expect(typeof reply.body).toBe('string')
    return JSON.parse(reply.body as string) as Record<string, unknown>
  }

  it('GET /login:匿名渲染登录页;已登录跳桥接', () => {
    const anonymous = handleAccessRequest(deps, req({ pathname: '/login' }))
    expect(anonymous.status).toBe(200)
    expect(anonymous.body).toContain('登录')
    const authed = handleAccessRequest(deps, req({ pathname: '/login', cookie: adminCookie }))
    expect(authed.status).toBe(302)
    expect(authed.headers.find(([n]) => n === 'location')?.[1]).toBe('http://app.local/?token=bridge-token')
  })

  it('登录成功:302 桥接+set-cookie+审计 ok;密码错:401 统一话术+审计 fail(不泄漏存在性)', () => {
    auditEvents.length = 0
    const bad = handleAccessRequest(deps, req({
      method: 'POST', pathname: '/login', body: Buffer.from(JSON.stringify({ account: 'ghost', password: 'whatever1' })),
    }))
    expect(bad.status).toBe(401)
    expect(bodyOf(bad).error).toBe('账号或密码不正确')
    const failEvent = auditEvents.find(e => e.kind === 'access.login' && e.ok === false)
    expect(failEvent?.account).toBe('ghost')
    const good = handleAccessRequest(deps, req({
      method: 'POST', pathname: '/login', body: Buffer.from(JSON.stringify({ account: 'Mr.Ma', password: 'MqbSunny0702' })),
    }))
    expect(good.status).toBe(302)
    expect(cookieOf(good)).toContain('HttpOnly')
    expect(auditEvents.some(e => e.kind === 'access.login' && e.ok === true && e.account === 'Mr.Ma')).toBe(true)
  })

  it('登录限速:同 ip+账号第 6 次 429;时钟滑动后恢复;换账号不受影响', () => {
    const attempt = (): AccessReply => handleAccessRequest(deps, req({
      method: 'POST', pathname: '/login', body: Buffer.from(JSON.stringify({ account: 'bruteforce', password: 'wrong-pass' })),
    }))
    for (let i = 0; i < 5; i++) expect(attempt().status).toBe(401)
    expect(attempt().status).toBe(429)
    expect(handleAccessRequest(deps, req({
      method: 'POST', pathname: '/login', body: Buffer.from(JSON.stringify({ account: 'other', password: 'wrong-pass' })),
    })).status).toBe(401)
    now += 60_001
    expect(attempt().status).toBe(401)
  })

  it('变更类同源闸:外来 Origin 与 Origin: null 一律 403;缺省放行', () => {
    const base = { method: 'POST', pathname: '/login', body: Buffer.from('{"account":"Mr.Ma","password":"MqbSunny0702"}') }
    expect(handleAccessRequest(deps, req({ ...base, origin: 'http://evil.example' })).status).toBe(403)
    expect(handleAccessRequest(deps, req({ ...base, origin: 'null' })).status).toBe(403)
    expect(handleAccessRequest(deps, req({ ...base, origin: 'http://localhost:3210' })).status).toBe(302)
    expect(handleAccessRequest(deps, req({ ...base, origin: 'https://localhost:3210' })).status).toBe(403)
  })

  it('同源闸反代形态:PUBLIC_URL 声明的 https 公网根放行(声明域+默认端口);http 交叉拒', () => {
    deps = {
      ...deps,
      session: new SessionService(Buffer.from('test-secret-test-secret-test-s'), { secure: true }),
      publicOrigin: 'https://eternity-electricity.cn',
    }
    const base = { method: 'POST', pathname: '/login', body: Buffer.from(JSON.stringify({ account: 'Mr.Ma', password: 'MqbSunny0702' })), host: 'eternity-electricity.cn' }
    const attempt = (origin: string): AccessReply => handleAccessRequest(deps, req({ ...base, origin }))
    expect(attempt('https://eternity-electricity.cn').status).toBe(302)
    expect(attempt('http://eternity-electricity.cn').status).toBe(403)
    expect(attempt('https://other.example').status).toBe(403)
    expect(attempt('https://eternity-electricity.cn:8443').status).toBe(403)
  })

  it('全局变更限速:第 31 次变更类请求 429(GET 不计)', () => {
    for (let i = 0; i < 30; i++) {
      handleAccessRequest(deps, req({ method: 'POST', pathname: '/access/api/nickname', cookie: adminCookie, body: Buffer.from('{"nickname":"x"}') }))
    }
    expect(handleAccessRequest(deps, req({ method: 'GET', pathname: '/access/api/me', cookie: adminCookie })).status).toBe(200)
    expect(handleAccessRequest(deps, req({ method: 'POST', pathname: '/access/api/nickname', cookie: adminCookie, body: Buffer.from('{"nickname":"x"}') })).status).toBe(429)
  })

  it('me:未登录 401;登录返回账号/昵称/角色/头像位', () => {
    expect(handleAccessRequest(deps, req({ pathname: '/access/api/me' })).status).toBe(401)
    const me = bodyOf(handleAccessRequest(deps, req({ pathname: '/access/api/me', cookie: adminCookie })))
    expect(me.account).toBe('Mr.Ma')
    expect(me.nickname).toBe('Mr.Ma')
    expect(me.role).toBe('admin')
    expect(me.avatarUrl).toBeNull()
  })

  it('改昵称:成功+审计;空值 400;超长 400', () => {
    const ok = handleAccessRequest(deps, req({
      method: 'POST', pathname: '/access/api/nickname', cookie: adminCookie, body: Buffer.from(JSON.stringify({ nickname: '马先生' })),
    }))
    expect(ok.status).toBe(200)
    expect(bodyOf(ok).nickname).toBe('马先生')
    expect(store.getUserById(adminId)?.nickname).toBe('马先生')
    expect(auditEvents.some(e => e.kind === 'access.profile.change')).toBe(true)
    expect(handleAccessRequest(deps, req({ method: 'POST', pathname: '/access/api/nickname', cookie: adminCookie, body: Buffer.from('{"nickname":"  "}') })).status).toBe(400)
    expect(handleAccessRequest(deps, req({ method: 'POST', pathname: '/access/api/nickname', cookie: adminCookie, body: Buffer.from(JSON.stringify({ nickname: 'x'.repeat(33) })) })).status).toBe(400)
  })

  it('改密:错旧密 400;成功后旧会话 cookie 失效(pwv 吊销)、新 cookie 可用', () => {
    const oldCookie = adminCookie
    const bad = handleAccessRequest(deps, req({
      method: 'POST', pathname: '/access/api/password', cookie: adminCookie,
      body: Buffer.from(JSON.stringify({ oldPassword: 'wrong-old1', newPassword: 'NewPassword9' })),
    }))
    expect(bad.status).toBe(400)
    const ok = handleAccessRequest(deps, req({
      method: 'POST', pathname: '/access/api/password', cookie: adminCookie,
      body: Buffer.from(JSON.stringify({ oldPassword: 'MqbSunny0702', newPassword: 'NewPassword9' })),
    }))
    expect(ok.status).toBe(200)
    const newCookie = cookieOf(ok)
    expect(newCookie).toBeDefined()
    expect(handleAccessRequest(deps, req({ pathname: '/access/api/me', cookie: oldCookie })).status).toBe(401)
    expect(handleAccessRequest(deps, req({ pathname: '/access/api/me', cookie: newCookie })).status).toBe(200)
    expect(store.verifyLogin('Mr.Ma', 'NewPassword9')).not.toBeNull()
    expect(auditEvents.some(e => e.kind === 'access.password.change')).toBe(true)
  })

  it('头像:SVG 与魔数不符 400;PNG 合法入库可取回;超 256KB 400;DELETE 重置后 404', () => {
    const svg = handleAccessRequest(deps, req({
      method: 'POST', pathname: '/access/api/avatar', cookie: adminCookie,
      body: Buffer.from(JSON.stringify({ dataUrl: 'data:image/svg+xml;base64,PHN2Zy8+' })),
    }))
    expect(svg.status).toBe(400)
    const fakePng = handleAccessRequest(deps, req({
      method: 'POST', pathname: '/access/api/avatar', cookie: adminCookie,
      body: Buffer.from(JSON.stringify({ dataUrl: `data:image/png;base64,${Buffer.from('<svg/>').toString('base64')}` })),
    }))
    expect(fakePng.status).toBe(400)
    const oversize = Buffer.concat([Buffer.from(PNG_MAGIC), Buffer.alloc(256 * 1024)]).toString('base64')
    expect(handleAccessRequest(deps, req({
      method: 'POST', pathname: '/access/api/avatar', cookie: adminCookie,
      body: Buffer.from(JSON.stringify({ dataUrl: `data:image/png;base64,${oversize}` })),
    })).status).toBe(400)
    const ok = handleAccessRequest(deps, req({
      method: 'POST', pathname: '/access/api/avatar', cookie: adminCookie,
      body: Buffer.from(JSON.stringify({ dataUrl: pngDataUrl() })),
    }))
    expect(ok.status).toBe(200)
    const get = handleAccessRequest(deps, req({ pathname: `/access/api/avatar/${adminId}`, cookie: adminCookie }))
    expect(get.status).toBe(200)
    expect(get.headers.find(([n]) => n === 'content-type')?.[1]).toBe('image/png')
    expect(get.headers.find(([n]) => n === 'cache-control')?.[1]).toContain('private')
    expect(new Uint8Array(get.body as Uint8Array)[0]).toBe(0x89)
    expect(auditEvents.some(e => e.kind === 'access.avatar.change')).toBe(true)
    expect(handleAccessRequest(deps, req({ method: 'DELETE', pathname: '/access/api/avatar', cookie: adminCookie })).status).toBe(200)
    expect(handleAccessRequest(deps, req({ pathname: `/access/api/avatar/${adminId}`, cookie: adminCookie })).status).toBe(404)
  })

  it('parseAvatarDataUrl 直测:白名单 mime+魔数;非法输入 undefined', () => {
    expect(parseAvatarDataUrl(pngDataUrl())?.mime).toBe('image/png')
    expect(parseAvatarDataUrl('data:image/jpeg;base64,AAAA')).toBeUndefined()
    expect(parseAvatarDataUrl('not-a-data-url')).toBeUndefined()
  })

  it('用户列表与创建:非 admin 403;admin 建号默认昵称=账号;重名自动后缀;非法角色/弱密码 400', () => {
    store.createUserWithSuffix({ account: 'alice', password: 'password8' })
    const userCookie = login('alice', 'password8')
    expect(handleAccessRequest(deps, req({ pathname: '/access/api/users', cookie: userCookie })).status).toBe(403)
    const create = (account: string): AccessReply => handleAccessRequest(deps, req({
      method: 'POST', pathname: '/access/api/users', cookie: adminCookie,
      body: Buffer.from(JSON.stringify({ account, password: 'password8' })),
    }))
    expect(create('zhangsan').status).toBe(201)
    const second = create('zhangsan')
    expect(second.status).toBe(201)
    expect(bodyOf(second).finalAccount).toBe('zhangsan01')
    const listed = bodyOf(handleAccessRequest(deps, req({ pathname: '/access/api/users', cookie: adminCookie }))) as { users: Array<{ account: string; nickname: string }> }
    expect(listed.users.find(u => u.account === 'zhangsan01')?.nickname).toBe('zhangsan01')
    expect(handleAccessRequest(deps, req({
      method: 'POST', pathname: '/access/api/users', cookie: adminCookie,
      body: Buffer.from(JSON.stringify({ account: 'badrole', password: 'password8', role: 'root' })),
    })).status).toBe(400)
    expect(handleAccessRequest(deps, req({
      method: 'POST', pathname: '/access/api/users', cookie: adminCookie,
      body: Buffer.from(JSON.stringify({ account: 'weakpw', password: 'short' })),
    })).status).toBe(400)
    expect(JSON.stringify(listed)).not.toContain('password_hash')
  })

  it('删除用户护栏:删自己 400、末位 admin 400、普通用户可删、未知 404+审计', () => {
    const carol = store.createUserWithSuffix({ account: 'carol', password: 'password8' }).user
    expect(handleAccessRequest(deps, req({ method: 'DELETE', pathname: `/access/api/users/${adminId}`, cookie: adminCookie })).status).toBe(400)
    expect(handleAccessRequest(deps, req({ method: 'DELETE', pathname: '/access/api/users/99999', cookie: adminCookie })).status).toBe(404)
    const del = handleAccessRequest(deps, req({ method: 'DELETE', pathname: `/access/api/users/${carol.id}`, cookie: adminCookie }))
    expect(del.status).toBe(200)
    expect(auditEvents.some(e => e.kind === 'access.user.delete' && e.account === 'carol')).toBe(true)
    expect(handleAccessRequest(deps, req({ method: 'DELETE', pathname: `/access/api/users/${carol.id}`, cookie: adminCookie })).status).toBe(404)
  })

  it('删除用户后其会话即刻失效(uid 消失)', () => {
    const carol = store.createUserWithSuffix({ account: 'carol', password: 'password8' }).user
    const carolCookie = login('carol', 'password8')
    expect(handleAccessRequest(deps, req({ pathname: '/access/api/me', cookie: carolCookie })).status).toBe(200)
    handleAccessRequest(deps, req({ method: 'DELETE', pathname: `/access/api/users/${carol.id}`, cookie: adminCookie }))
    expect(handleAccessRequest(deps, req({ pathname: '/access/api/me', cookie: carolCookie })).status).toBe(401)
  })

  it('登出:清 cookie 跳 /login+审计', () => {
    const out = handleAccessRequest(deps, req({ method: 'POST', pathname: '/logout', cookie: adminCookie }))
    expect(out.status).toBe(302)
    expect(out.headers.find(([n]) => n === 'location')?.[1]).toBe('/login')
    expect(cookieOf(out)).toContain('Max-Age=0')
    expect(auditEvents.some(e => e.kind === 'access.logout')).toBe(true)
  })

  it('页面门禁:匿名 /login 出登录页(no-store 响应头);独立页路由已移除(404)', () => {
    const login = handleAccessRequest(deps, req({ pathname: '/login' }))
    expect(login.status).toBe(200)
    expect(login.headers.find(([n]) => n === 'cache-control')?.[1]).toBe('no-store')
    expect(handleAccessRequest(deps, req({ pathname: '/account' })).status).toBe(404)
    expect(handleAccessRequest(deps, req({ pathname: '/admin/users' })).status).toBe(404)
    expect(handleAccessRequest(deps, req({ pathname: '/manage' })).status).toBe(404)
  })

  it('未知路径 405/404', () => {
    expect(handleAccessRequest(deps, req({ method: 'PUT', pathname: '/login' })).status).toBe(405)
    expect(handleAccessRequest(deps, req({ pathname: '/nope' })).status).toBe(404)
    expect(handleAccessRequest(deps, req({ pathname: '/access/api/unknown' })).status).toBe(404)
  })

  it('T2.3 删除:红线拒删;删除=移除标记+停用;enable 撤销删除恢复挂载', () => {
    const remove = (id: string): AccessReply => handleAccessRequest(deps, req({
      method: 'POST', pathname: `/access/api/plugins/${id}/remove`, cookie: adminCookie,
    }))
    expect(remove('eterna-governance').status).toBe(400)
    expect(remove('eterna-memory').status).toBe(200)
    expect(store.isPluginRemoved('eterna-memory')).toBe(true)
    expect(store.isPluginDisabled('eterna-memory')).toBe(true)
    const list = bodyOf(handleAccessRequest(deps, req({ pathname: '/access/api/plugins', cookie: adminCookie }))) as { plugins: Array<{ id: string; removed: boolean; disabled: boolean }> }
    expect(list.plugins.find(p => p.id === 'eterna-memory')).toMatchObject({ removed: true, disabled: true })
    // enable 撤销删除
    expect(handleAccessRequest(deps, req({ method: 'POST', pathname: '/access/api/plugins/eterna-memory/enable', cookie: adminCookie })).status).toBe(200)
    expect(store.isPluginRemoved('eterna-memory')).toBe(false)
    expect(store.isPluginDisabled('eterna-memory')).toBe(false)
  })

  it('T2.3 插件启停:非 admin 403;红线拒停;停用持久化到 disabled-plugins.json', () => {
    const toggle = (id: string, action: string): AccessReply => handleAccessRequest(deps, req({
      method: 'POST', pathname: `/access/api/plugins/${id}/${action}`, cookie: adminCookie,
    }))
    store.createUserWithSuffix({ account: 'frank', password: 'password8' })
    const frankCookie = login('frank', 'password8')
    expect(handleAccessRequest(deps, req({ method: 'POST', pathname: '/access/api/plugins/eterna-memory/disable', cookie: frankCookie })).status).toBe(403)
    expect(toggle('eterna-governance', 'disable').status).toBe(400)
    expect(toggle('eterna-memory', 'disable').status).toBe(200)
    expect(store.isPluginDisabled('eterna-memory')).toBe(true)
    expect(toggle('eterna-memory', 'enable').status).toBe(200)
    expect(store.isPluginDisabled('eterna-memory')).toBe(false)
    const list = bodyOf(handleAccessRequest(deps, req({ pathname: '/access/api/plugins', cookie: adminCookie }))) as { plugins: Array<{ id: string; redLine: boolean }> }
    expect(list.plugins.find(p => p.id === 'eterna-audit')?.redLine).toBe(true)
    expect(list.plugins.find(p => p.id === 'eterna-memory')?.redLine).toBe(false)
  })

  it('clientIp:XFF 首值优先;数组形态;缺省 local', () => {
    expect(clientIp('203.0.113.9, 10.0.0.1')).toBe('203.0.113.9')
    expect(clientIp(['198.51.100.7'])).toBe('198.51.100.7')
    expect(clientIp(undefined)).toBe('local')
  })
})
