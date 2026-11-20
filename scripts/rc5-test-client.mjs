/**
 * rc.5 测试基座共用客户端（T47；51 §0.4/§4）。
 *
 * 只做四件事：
 *   1. 从 0600 测试账号文件读账号（绝不打印密码/令牌）；
 *   2. 登录拿 eterna_session cookie；
 *   3. 走与浏览器同构的 HTTP RPC 面 `POST /api/<method>`（client-request 信封）；
 *   4. 结果记账 + 脱敏 + 可选 JSON 落盘。
 *
 * 写操作只发生在测试环境（E1/E3 容器与 test-rc5 数据根）；脚本不读生产 .env、
 * 不碰生产容器，凭据只从 0600 文件读入内存。
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { homedir } from 'node:os'
import { resolve } from 'node:path'

/* ------------------------------------------------------------------ 参数 */

export function parseArgs(argv = process.argv.slice(2), defaults = {}) {
  const args = { ...defaults, _: [] }
  for (let index = 0; index < argv.length; index++) {
    const token = argv[index]
    if (!token.startsWith('--')) {
      args._.push(token)
      continue
    }
    const eq = token.indexOf('=')
    if (eq !== -1) {
      args[token.slice(2, eq)] = token.slice(eq + 1)
      continue
    }
    const name = token.slice(2)
    const next = argv[index + 1]
    if (next !== undefined && !next.startsWith('--')) {
      args[name] = next
      index += 1
    } else {
      args[name] = true
    }
  }
  return args
}


/**
 * 建立上游 dsh 浏览器会话（/api/* 面除 eterna_session 外还要求 dsh-auth cookie）。
 *
 * 流程与 verify-eterna-web.mjs 的三步换票同构：
 *   boot token（容器日志 `?token=`，绝不打印/落盘）
 *   → GET /connect?token=…&interactions=answer（set-cookie dsh-auth）
 *   → GET /?token=…（升级）
 * 返回 dsh-auth cookie 串；失败抛错（不泄露 token）。
 */
export async function bootstrapDshSession(base, bootToken) {
  if (typeof bootToken !== 'string' || bootToken === '') throw new Error('缺少 boot token（--boot-token 或容器日志）')
  const connect = await request(new URL(`/connect?token=${encodeURIComponent(bootToken)}&interactions=answer`, base), {
    redirect: 'manual',
    timeoutMs: 20_000,
  })
  const cookies = connect.setCookies.map(item => item.split(';')[0]).filter(item => item !== '')
  if (cookies.length === 0) throw new Error(`/connect 未下发 dsh-auth cookie（status=${connect.status}）`)
  const upgrade = await request(new URL(`/?token=${encodeURIComponent(bootToken)}`, base), {
    redirect: 'manual',
    cookie: cookies.join('; '),
    timeoutMs: 20_000,
  })
  for (const item of upgrade.setCookies) {
    const pair = item.split(';')[0]
    if (pair === '') continue
    const name = pair.split('=')[0]
    const existing = cookies.findIndex(cookie => cookie.split('=')[0] === name)
    if (existing === -1) cookies.push(pair)
    else cookies[existing] = pair
  }
  return cookies.join('; ')
}

/** 从容器日志取最后一个 boot token（只进内存；调用方不得打印）。 */
export function bootTokenFromContainer(container) {
  const result = spawnSync('docker', ['logs', container], { encoding: 'utf8', timeout: 60_000, maxBuffer: 32 * 1024 * 1024 })
  if (result.status !== 0) throw new Error(`docker logs ${container} 失败: ${(result.stderr ?? '').slice(0, 160)}`)
  const text = `${result.stdout ?? ''}\n${result.stderr ?? ''}`
  const matches = [...text.matchAll(/[?&]token=([A-Za-z0-9_-]+)/g)]
  if (matches.length === 0) throw new Error('容器日志没有 boot token（是否已启动 dsh？）')
  return matches[matches.length - 1][1]
}

export const DEFAULT_TEST_ROOT = resolve(homedir(), 'eterna-data', 'test-rc5')

export function defaultPaths() {
  return {
    base: 'http://127.0.0.1:3108',
    accountsFile: resolve(DEFAULT_TEST_ROOT, '.test-accounts.json'),
    dataRoot: resolve(DEFAULT_TEST_ROOT, 'e1'),
    container: 'eterna-rc5-e1',
  }
}

/* ---------------------------------------------------------------- 账号面 */

/** 读 0600 测试账号文件；只返回结构，不打印内容。 */
export function loadAccounts(path) {
  if (!existsSync(path)) {
    throw new Error(`测试账号文件不存在: ${path}（由 scripts/prepare-rc5-envs.sh e1 生成，0600）`)
  }
  const parsed = JSON.parse(readFileSync(path, 'utf8'))
  for (const key of ['admin', 'user_b']) {
    if (typeof parsed?.[key]?.account !== 'string' || typeof parsed?.[key]?.password !== 'string') {
      throw new Error(`测试账号文件缺少 ${key}.account/password`)
    }
  }
  return parsed
}

/* ------------------------------------------------------------------ HTTP */

export function redact(text) {
  if (typeof text !== 'string') return text
  return text
    .replace(/token=[A-Za-z0-9_-]+/g, 'token=<redacted>')
    .replace(/(eterna_session=)[^;,\s]+/g, '$1<redacted>')
    .replace(/("?(?:password|secret|token|authorization)"?\s*[:=]\s*)"[^"]*"/gi, '$1"<redacted>"')
    .replace(/(mcp-session-id:\s*)[^\s]+/gi, '$1<redacted>')
}

/**
 * 连接级瞬时错误重试：容器 restart / keep-alive 空闲关闭会偶发
 * `TypeError: fetch failed`（cause.code=UND_ERR_SOCKET / ECONNRESET / EPIPE）。
 * 只对这些错误重试（最多 3 次、250ms 递增），HTTP 业务错误一概不重试。
 */
const TRANSIENT_NET_CODES = new Set(['UND_ERR_SOCKET', 'UND_ERR_CLOSED', 'ECONNRESET', 'EPIPE', 'ECONNREFUSED'])

function transientNetCode(error) {
  return error?.cause?.code ?? error?.code
}

export async function request(url, { method = 'GET', cookie, body, headers = {}, timeoutMs = 30_000 } = {}) {
  const init = {
    method,
    redirect: 'manual',
    signal: AbortSignal.timeout(timeoutMs),
    headers: { ...headers },
  }
  if (cookie !== undefined && cookie !== '') init.headers.cookie = cookie
  if (body !== undefined) {
    init.headers['content-type'] = 'application/json'
    init.body = typeof body === 'string' ? body : JSON.stringify(body)
  }
  let lastError
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const response = await fetch(url, init)
      const text = await response.text()
      return {
        status: response.status,
        headers: response.headers,
        setCookies: typeof response.headers.getSetCookie === 'function' ? response.headers.getSetCookie() : [],
        text,
      }
    } catch (error) {
      lastError = error
      if (!TRANSIENT_NET_CODES.has(transientNetCode(error))) throw error
      await new Promise(resolve => setTimeout(resolve, 250 * (attempt + 1)))
    }
  }
  throw lastError
}

/** 登录；返回 cookie 串（eterna_session=…）。 */
export async function login(base, account, password) {
  const response = await request(new URL('/login', base), {
    method: 'POST',
    body: { account, password },
  })
  const cookie = response.setCookies
    .map(item => item.split(';')[0])
    .filter(item => item.startsWith('eterna_session='))
    .join('; ')
  return { status: response.status, cookie, text: response.text }
}

export async function getJson(base, path, options = {}) {
  const response = await request(new URL(path, base), options)
  let json
  try {
    json = JSON.parse(response.text)
  } catch {
    json = undefined
  }
  return { ...response, json }
}

/**
 * 与浏览器同构的 RPC：POST /api/<method>，信封
 * {type:'client-request', rpcId, method, payload:{args}}。
 * 返回 {status, ok, value, error, text}。
 */
export async function rpc(base, cookie, method, args = {}, options = {}) {
  const rpcId = `verify-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
  const response = await request(new URL(`/api/${method}`, base), {
    method: 'POST',
    cookie,
    body: { type: 'client-request', rpcId, method, payload: { args } },
    timeoutMs: options.timeoutMs ?? 60_000,
  })
  let parsed
  try {
    parsed = JSON.parse(response.text)
  } catch {
    parsed = undefined
  }
  const result = parsed?.result
  return {
    status: response.status,
    ok: result?.ok === true,
    value: result?.value,
    error: result?.error,
    result,
    text: response.text,
  }
}

/* --------------------------------------------------------------- 记账面 */

export const STATUS = {
  PASS: 'PASS',
  FAIL: 'FAIL',
  SKIP: 'SKIP',
  NOTRUN: 'NOTRUN',
}

export class Report {
  constructor({ suite, env = {}, out }) {
    this.suite = suite
    this.env = env
    this.out = out
    this.cases = []
    this.startedAt = new Date().toISOString()
  }

  /** 记录一条用例。detail 只放已脱敏文本。 */
  add(id, priority, status, title, detail = '') {
    const row = { id, priority, status, title, detail: redact(String(detail)) }
    this.cases.push(row)
    const line = `[${status}] ${id} (${priority}) ${title}${detail === '' ? '' : ` :: ${row.detail}`}`
    console.log(line)
    return row
  }

  async run(id, priority, title, fn) {
    try {
      const result = await fn()
      if (result === undefined) return this.add(id, priority, STATUS.PASS, title)
      if (typeof result === 'string') return this.add(id, priority, STATUS.PASS, title, result)
      return this.add(id, priority, result.status ?? STATUS.PASS, title, result.detail ?? '')
    } catch (error) {
      return this.add(id, priority, STATUS.FAIL, title, `异常: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  summary() {
    const counts = { PASS: 0, FAIL: 0, SKIP: 0, NOTRUN: 0 }
    for (const row of this.cases) counts[row.status] = (counts[row.status] ?? 0) + 1
    return {
      suite: this.suite,
      startedAt: this.startedAt,
      finishedAt: new Date().toISOString(),
      env: this.env,
      counts,
      cases: this.cases,
    }
  }

  finish() {
    const summary = this.summary()
    console.log(
      `\n[${this.suite}] PASS=${summary.counts.PASS} FAIL=${summary.counts.FAIL} SKIP=${summary.counts.SKIP} NOTRUN=${summary.counts.NOTRUN}`,
    )
    if (this.out !== undefined && this.out !== true) {
      writeFileSync(this.out, JSON.stringify(summary, null, 2))
      console.log(`[${this.suite}] report → ${this.out}`)
    }
    return summary.counts.FAIL === 0 ? 0 : 1
  }
}

/** 断言小工具：返回 {status, detail}。 */
export function verdict(condition, passDetail, failDetail) {
  return condition ? { status: STATUS.PASS, detail: passDetail } : { status: STATUS.FAIL, detail: failDetail }
}

/** 找到错误码（tenant/denied / tenant/unauthenticated / …）。 */
export function errorCode(rpcResult) {
  const code = rpcResult?.error?.code
  return typeof code === 'string' ? code : undefined
}

export function shape(value, depth = 2) {
  try {
    const text = JSON.stringify(value, null, depth)
    return redact(typeof text === 'string' ? text : String(value))
  } catch {
    return String(value)
  }
}