import { describe, expect, it } from 'vitest'
import { SessionService } from '../src/session.ts'

const SECRET = Buffer.from('0123456789abcdef0123456789abcdef')

describe('SessionService 会话', () => {
  it('签发→解析往返,claims 含 uid 与 pwv', () => {
    const session = new SessionService(SECRET)
    const token = session.issue({ userId: 7, passwordVersion: 3 })
    const claims = session.resolveUser(`${SessionService.COOKIE_NAME}=${token}; other=x`)
    expect(claims).toEqual({ userId: 7, passwordVersion: 3 })
  })

  it('签名防伪:篡改任意段一律拒绝', () => {
    const session = new SessionService(SECRET)
    const token = session.issue({ userId: 1, passwordVersion: 1 })
    expect(session.verify(token + 'x')).toBeUndefined()
    expect(session.verify(token.replace('v1.', 'v2.'))).toBeUndefined()
    const tampered = token.slice(0, -2) + (token.endsWith('AA') ? 'BB' : 'AA')
    expect(session.verify(tampered)).toBeUndefined()
    expect(session.verify(undefined)).toBeUndefined()
    expect(session.verify('garbage')).toBeUndefined()
  })

  it('跨密钥不可解(轮换即全体下线)', () => {
    const token = new SessionService(SECRET).issue({ userId: 1, passwordVersion: 1 })
    expect(new SessionService(Buffer.from('another-secret-another-secret')).verify(token)).toBeUndefined()
  })

  it('过期拒绝(可注入时钟)', () => {
    const session = new SessionService(SECRET, { ttlDays: 1 })
    let now = 1_000_000
    const clock = (): number => now
    const token = session.issue({ userId: 1, passwordVersion: 1 }, clock)
    now += 86_400_000 - 1
    expect(session.verify(token, clock)).toBeDefined()
    now += 2
    expect(session.verify(token, clock)).toBeUndefined()
  })

  it('cookie 头形态:HttpOnly/SameSite/Max-Age;clear 为 Max-Age=0;Secure 可选', () => {
    const plain = new SessionService(SECRET)
    const set = plain.setCookieHeader(plain.issue({ userId: 1, passwordVersion: 1 }))
    expect(set).toContain('HttpOnly')
    expect(set).toContain('SameSite=Lax')
    expect(set).toContain('Max-Age=')
    expect(set).not.toContain('Secure')
    expect(plain.clearCookieHeader()).toContain('Max-Age=0')
    const secure = new SessionService(SECRET, { secure: true })
    expect(secure.setCookieHeader(secure.issue({ userId: 1, passwordVersion: 1 }))).toContain('; Secure')
  })

  it('resolveUser:无 cookie/异名 cookie → undefined', () => {
    const session = new SessionService(SECRET)
    expect(session.resolveUser(undefined)).toBeUndefined()
    expect(session.resolveUser('other=1')).toBeUndefined()
  })
})
