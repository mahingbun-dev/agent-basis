/**
 * HTTP 原语:请求上下文/应答形态、同源校验(变更类端点 CSRF 闸)、XFF 取 ip、
 * dataURL 头像解析(白名单 png/jpeg/webp/gif+魔数嗅探,SVG 一律拒——存储型 XSS)。
 * 全部纯函数,供 routes 核心与测试复用。
 */

export interface AccessRequest {
  readonly method: string
  readonly pathname: string
  readonly cookie: string | undefined
  readonly origin: string | undefined
  readonly host: string | undefined
  readonly xff: string | string[] | undefined
  readonly body: Uint8Array | undefined
}

export interface AccessReply {
  readonly status: number
  readonly headers: ReadonlyArray<readonly [string, string]>
  readonly body: Uint8Array | string | undefined
}

export function jsonResponse(status: number, value: unknown, extraHeaders: ReadonlyArray<readonly [string, string]> = []): AccessReply {
  return { status, headers: [['content-type', 'application/json; charset=utf-8'], ...extraHeaders], body: JSON.stringify(value) }
}

export function htmlResponse(status: number, html: string, extraHeaders: ReadonlyArray<readonly [string, string]> = []): AccessReply {
  // 页面禁缓存:发版后浏览器不得滞留旧壳(2026-11-10 走查实测:启发式缓存致新交互缺失)
  return { status, headers: [['content-type', 'text/html; charset=utf-8'], ['cache-control', 'no-store'], ...extraHeaders], body: html }
}

export function redirectReply(location: string, extraHeaders: ReadonlyArray<readonly [string, string]> = []): AccessReply {
  return { status: 302, headers: [['location', location], ...extraHeaders], body: undefined }
}

export function errorReply(status: number, message: string, extraHeaders: ReadonlyArray<readonly [string, string]> = []): AccessReply {
  return jsonResponse(status, { error: message }, extraHeaders)
}

/**
 * 同源校验:Origin 缺省放行(非浏览器客户端,鉴权仍在);`null`(内嵌 webview)一律拒;
 * 其余与 Host authority 规范化比对——scheme 按部署声明(secure=https);端口仅当双方
 * 显式时强制,Host 隐式端口视同 scheme 默认(反代 443 场景 Host 常不带端口)。
 */
export function isSameOrigin(origin: string | undefined, host: string | undefined, secure = false): boolean {
  if (origin === undefined) return true
  if (origin === 'null') return false
  if (host === undefined) return false
  let originUrl: URL
  try {
    originUrl = new URL(origin)
  } catch {
    return false
  }
  const expectedScheme = secure ? 'https:' : 'http:'
  if (originUrl.protocol !== expectedScheme) return false
  const authority = splitAuthority(host)
  if (authority === undefined) return false
  if (authority.name !== originUrl.hostname) return false
  if (authority.port !== '') return originUrl.port === authority.port
  // Host 隐式端口:接受 origin 缺省端口或 scheme 默认端口
  return originUrl.port === '' || originUrl.port === (originUrl.protocol === 'https:' ? '443' : '80')
}

function splitAuthority(host: string): { name: string; port: string } | undefined {
  const colon = host.lastIndexOf(':')
  const bracket = host.lastIndexOf(']')
  if (colon > bracket) return { name: host.slice(0, colon), port: host.slice(colon + 1) }
  return { name: host, port: '' }
}

/** 反代场景取 XFF 首值(可信假设=仅来自内网/自有反代,docs 明示);无则 local。 */
export function clientIp(xff: string | string[] | undefined): string {
  const first = Array.isArray(xff) ? xff[0] : xff
  if (first === undefined || first === '') return 'local'
  return first.split(',')[0]?.trim() || 'local'
}

/** 请求侧浏览器面向 origin(Host 头+部署 scheme)——authenticatedUrl 需要绝对 URL。 */
export function requestOrigin(host: string | undefined, secure: boolean): string {
  const scheme = secure ? 'https' : 'http'
  if (host === undefined || host === '') return `${scheme}://localhost`
  return `${scheme}://${host}`
}

const AVATAR_MAX_BYTES = 256 * 1024
const AVATAR_MIME_PATTERN = /^data:(image\/(png|jpeg|webp|gif));base64,([A-Za-z0-9+/=]+)$/

export interface ParsedAvatar {
  readonly data: Uint8Array
  readonly mime: string
}

/** 解析并校验头像 dataURL:白名单 mime+魔数嗅探(禁 SVG)+解码后 ≤256KB。 */
export function parseAvatarDataUrl(dataUrl: string): ParsedAvatar | undefined {
  const match = AVATAR_MIME_PATTERN.exec(dataUrl)
  if (match === null) return undefined
  const mime = match[1]
  if (mime === undefined) return undefined
  const data = Buffer.from(match[3] ?? '', 'base64')
  if (data.length === 0 || data.length > AVATAR_MAX_BYTES) return undefined
  if (!magicMatches(mime, data)) return undefined
  return { data, mime }
}

function magicMatches(mime: string, data: Uint8Array): boolean {
  const head = Array.from(data.slice(0, 12), b => b)
  switch (mime) {
    case 'image/png':
      return head[0] === 0x89 && head[1] === 0x50 && head[2] === 0x4e && head[3] === 0x47
    case 'image/jpeg':
      return head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff
    case 'image/gif':
      return head[0] === 0x47 && head[1] === 0x49 && head[2] === 0x46 && head[3] === 0x38
    case 'image/webp':
      return head[0] === 0x52 && head[1] === 0x49 && head[2] === 0x46 && head[3] === 0x46
        && head[8] === 0x57 && head[9] === 0x45 && head[10] === 0x42 && head[11] === 0x50
    default:
      return false
  }
}

/** 解析 JSON 请求体;非 JSON/超限由适配层先拦,这里只管形态。 */
export function parseJsonBody(body: Uint8Array | undefined): Record<string, unknown> | undefined {
  if (body === undefined || body.length === 0) return undefined
  try {
    const value: unknown = JSON.parse(new TextDecoder().decode(body))
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined
    return value as Record<string, unknown>
  } catch {
    return undefined
  }
}

export function escapeHtml(text: string): string {
  return text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}

/** 内嵌 <script> 的 JSON 防逃逸(</script 与 <!-- 均不可出现)。 */
export function jsonForScript(value: unknown): string {
  return JSON.stringify(value).replaceAll('<', '\\u003c').replaceAll('>', '\\u003e')
}
