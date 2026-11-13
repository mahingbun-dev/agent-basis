// companion 令牌簿（E4 多用户浏览器执行面，2026-11-11）：按用户生成/存储
// Eterna Companion 扩展的接入令牌。存储形如 { "<userId>": { token, createdAt } }
// 的 JSON（0600，临时文件+rename 原子写）——browser-relay 以 --tokens-file 直读
// 同一文件做 ws/HTTP 凭据校验（relay 对 dsh 零依赖，同卷共享即可）。
// 令牌语义：token=浏览器实例身份（一个用户令牌一台浏览器；同令牌二接入被 relay 拒）。
import { randomBytes } from 'node:crypto'
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

export interface CompanionTokenEntry {
  readonly token: string
  readonly createdAt: string
}

/** 已知归属但未生成令牌时的 fail-closed 拒绝理由（pre-execute deny 与 dispatch wrap throw 共用，文案一致）。 */
export const COMPANION_TOKEN_MISSING_REASON =
  '[companion] 浏览器执行面令牌未生成：请在 设置 → 账号 → 浏览器执行面 生成令牌并安装扩展（安装指引见令牌卡片链接）'

type TokenBook = Record<string, CompanionTokenEntry>

export function companionTokenPath(dataDir: string): string {
  return join(dataDir, 'companion-tokens.json')
}

function readBook(path: string): TokenBook {
  try {
    const raw = JSON.parse(readFileSync(path, 'utf8')) as unknown
    if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return {}
    const out: TokenBook = {}
    for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
      if (value !== null && typeof value === 'object' && typeof (value as { token?: unknown }).token === 'string') {
        const token = (value as { token: string }).token
        const createdAt = typeof (value as { createdAt?: unknown }).createdAt === 'string' ? (value as { createdAt: string }).createdAt : ''
        out[key] = { token, createdAt }
      }
    }
    return out
  } catch {
    return {}
  }
}

function writeBook(path: string, book: TokenBook): void {
  mkdirSync(dirname(path), { recursive: true })
  const tmp = `${path}.tmp`
  writeFileSync(tmp, `${JSON.stringify(book, null, 2)}\n`, { mode: 0o600 })
  renameSync(tmp, path)
}

export function companionTokenOf(dataDir: string, userId: number): CompanionTokenEntry | undefined {
  return readBook(companionTokenPath(dataDir))[String(userId)]
}

/** 生成/重置（覆盖旧值——重置后旧令牌即刻失效，relay 每次校验重读清单）。 */
export function resetCompanionToken(dataDir: string, userId: number): CompanionTokenEntry {
  const path = companionTokenPath(dataDir)
  const book = readBook(path)
  const entry: CompanionTokenEntry = { token: `ec-${randomBytes(24).toString('hex')}`, createdAt: new Date().toISOString() }
  book[String(userId)] = entry
  writeBook(path, book)
  return entry
}

/** 指引页地址：公网 ws 地址（ETERNA_RELAY_PUBLIC_URL）→ https 指引页；缺省本机端口。 */
export function companionGuideUrl(relayPublicWsUrl?: string, relayPort = 9310): string {
  const fallback = `http://127.0.0.1:${String(relayPort)}/companion/guide`
  if (relayPublicWsUrl === undefined || relayPublicWsUrl === '') return fallback
  const m = /^(wss|ws):\/\/([^/?#]+)(\/.*)?$/.exec(relayPublicWsUrl)
  if (m === null) return fallback
  const scheme = m[1] === 'wss' ? 'https' : 'http'
  const prefix = (m[3] ?? '').replace(/\/extension\/?$/, '')
  return `${scheme}://${m[2]}${prefix}/companion/guide`
}
