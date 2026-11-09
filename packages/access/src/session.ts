/**
 * 会话服务:HMAC-SHA256 签名 cookie(uid.pwv.exp.nonce),HttpOnly+SameSite=Lax。
 * 载荷含密码版本号 pwv——改密/重置后 password_version 递增,旧会话即刻失效
 * (无状态 HMAC 的吊销原语,计划书审核轮 4 补漏)。密钥来源 env
 * ETERNA_ACCESS_SECRET 优先,否则持久化文件 secret.key(0600)。服务端可读请求头
 * Cookie → 每请求归属用户(Phase 2 端点守卫的归属原语)。
 */
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'

const DAY_MS = 86_400_000

export interface SessionServiceOptions {
  readonly secret?: string
  readonly ttlDays?: number
  /** 反代终结 TLS 时显式声明(Secure cookie;不信 X-Forwarded-*,对齐 dsh BrowserAuth 立场)。 */
  readonly secure?: boolean
}

export interface SessionClaims {
  readonly userId: number
  readonly passwordVersion: number
}

export function loadOrCreateSecret(envSecret: string | undefined, dir: string): Uint8Array {
  if (envSecret !== undefined && envSecret !== '') return Buffer.from(envSecret, 'utf8')
  mkdirSync(dir, { recursive: true })
  const file = `${dir}/secret.key`
  if (existsSync(file)) return readFileSync(file)
  const secret = randomBytes(32)
  writeFileSync(file, secret, { mode: 0o600 })
  return secret
}

export class SessionService {
  private readonly secret: Uint8Array
  private readonly ttlMs: number
  /** 反代 TLS 下显式声明(同源校验按此选期望 scheme)。 */
  readonly secure: boolean
  static readonly COOKIE_NAME = 'eterna_session'

  constructor(secret: Uint8Array, options: SessionServiceOptions = {}) {
    this.secret = secret
    this.ttlMs = (options.ttlDays ?? 7) * DAY_MS
    this.secure = options.secure ?? false
  }

  private sign(payload: string): string {
    return createHmac('sha256', this.secret).update(payload).digest('base64url')
  }

  /** 签发新 cookie 值;exp 绝对过期,pwv 随载荷固化。时钟可注入(测试)。 */
  issue(claims: SessionClaims, now: () => number = Date.now): string {
    const exp = now() + this.ttlMs
    const payload = `${claims.userId}.${claims.passwordVersion}.${exp}.${randomBytes(8).toString('base64url')}`
    return `v1.${Buffer.from(payload).toString('base64url')}.${this.sign(payload)}`
  }

  /** 校验并返回声明;无效/过期/签名不符一律 undefined(不区分,防枚举)。 */
  verify(token: string | undefined, now: () => number = Date.now): SessionClaims | undefined {
    if (token === undefined || !token.startsWith('v1.')) return undefined
    const rest = token.slice(3)
    const sep = rest.lastIndexOf('.')
    if (sep <= 0) return undefined
    const payloadB64 = rest.slice(0, sep)
    const sig = rest.slice(sep + 1)
    const payload = Buffer.from(payloadB64, 'base64url').toString('utf8')
    const expected = Buffer.from(this.sign(payload), 'base64url')
    const actual = Buffer.from(sig, 'base64url')
    if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return undefined
    const parts = payload.split('.')
    if (parts.length !== 4) return undefined
    const userId = Number(parts[0])
    const passwordVersion = Number(parts[1])
    const exp = Number(parts[2])
    if (!Number.isInteger(userId) || userId <= 0) return undefined
    if (!Number.isInteger(passwordVersion) || passwordVersion <= 0) return undefined
    if (!Number.isFinite(exp) || exp < now()) return undefined
    return { userId, passwordVersion }
  }

  setCookieHeader(token: string): string {
    const maxAge = Math.floor(this.ttlMs / 1000)
    const secure = this.secure ? '; Secure' : ''
    return `${SessionService.COOKIE_NAME}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure}`
  }

  clearCookieHeader(): string {
    const secure = this.secure ? '; Secure' : ''
    return `${SessionService.COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure}`
  }

  /** 从 Cookie 请求头解析本插件会话;无/无效返回 undefined。 */
  resolveUser(cookieHeader: string | undefined): SessionClaims | undefined {
    if (cookieHeader === undefined) return undefined
    for (const part of cookieHeader.split(';')) {
      const pair = part.trim()
      const eq = pair.indexOf('=')
      if (eq <= 0) continue
      if (pair.slice(0, eq) === SessionService.COOKIE_NAME) return this.verify(pair.slice(eq + 1))
    }
    return undefined
  }
}
