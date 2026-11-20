/**
 * B14/T26(2026-11-20):个人 MCP 存储与路由——AES-256-GCM、五端点、限额、
 * 跨租户 403 语义、probe 10s 不回显 secrets、kill switch、登出钩子。
 *
 * 契约来源:50 §3.4.2(端点表/校验顺序)、47 §7(限额与密钥)、54 §13.4 第 4 条
 * (bootstrap 接线:registerMcpPersonalRoutes + store user_version 0→1)。
 * 数据面真件(users.db 临时目录);probe 用假件(不拉起上游 MCP 运行时)。
 */
import { DatabaseSync } from 'node:sqlite'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AccessAuditEvent } from '../src/audit.ts'
import type { AccessRequest } from '../src/http.ts'
import {
  MCP_PERSONAL_MAX_CONFIG_BYTES, MCP_PERSONAL_MAX_SERVERS, MCP_PERSONAL_PROBE_TIMEOUT_MS,
  decryptMcpSecret, encryptMcpSecret, envSecretRef, installMcpPersonalFetchRoutes,
  loadMcpMasterKey, parseMcpMasterKey, resolveMcpPersonalConfig,
  type McpPersonalConfig, type McpPersonalDeps, type McpResolvedTransport,
} from '../src/mcp-personal.ts'
import { SlidingWindow } from '../src/ratelimit.ts'
import { handleAccessRequest, type AccessDeps } from '../src/routes.ts'
import { SessionService } from '../src/session.ts'
import { UserStore } from '../src/store.ts'

const MASTER_KEY = Buffer.alloc(32, 7)
const CATALOG: McpPersonalConfig['catalog'] = [{
  name: 'fs',
  label: '文件系统',
  transport: 'stdio',
  command: 'mcp-fs',
  args: ['--root', '/srv'],
  envSchema: ['FS_TOKEN'],
}]
const CONFIG: McpPersonalConfig = { enabled: true, catalog: CATALOG, httpHosts: [] }

interface RpcFrame {
  readonly ok: boolean
  readonly value?: Record<string, unknown>
  readonly error?: { readonly code?: string; readonly message?: string }
}
type ProbeFn = NonNullable<McpPersonalDeps['probe']>

describe('B14 个人 MCP:存储/路由', () => {
  let dir: string
  let store: UserStore
  let session: SessionService
  let aliceId: number
  let bobId: number
  let aliceCookie: string
  let bobCookie: string
  let auditEvents: AccessAuditEvent[]
  let routes: Map<string, (request: Request) => Promise<Response>>
  let disposeRoutes: () => void
  let probe: ProbeFn
  let config: McpPersonalConfig
  let masterKey: Buffer | undefined
  let runtimeDisposed: number[]

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'eterna-mcp-personal-'))
    store = new UserStore(join(dir, 'users.db'))
    session = new SessionService(Buffer.from('mcp-personal-test-secret-000000'))
    const alice = store.createUserWithSuffix({ account: 'alice', password: 'password8' })
    const bob = store.createUserWithSuffix({ account: 'bob', password: 'password8' })
    aliceId = alice.user.id
    bobId = bob.user.id
    store.recordSession('s-alice', aliceId, null)
    store.recordSession('s-bob', bobId, null)
    const cookieFor = (userId: number): string => `eterna_session=${session.issue({
      userId, passwordVersion: store.getUserById(userId)?.passwordVersion ?? 1,
    })}`
    aliceCookie = cookieFor(aliceId)
    bobCookie = cookieFor(bobId)
    auditEvents = []
    runtimeDisposed = []
    probe = async () => ({ ok: true, toolCount: 2 })
    config = CONFIG
    masterKey = MASTER_KEY
    disposeRoutes = mount()
  })

  afterEach(() => {
    disposeRoutes()
    store.close()
    rmSync(dir, { recursive: true, force: true })
    vi.useRealTimers()
  })

  function mount(): () => void {
    routes = new Map()
    const deps: McpPersonalDeps = {
      store,
      session,
      audit: event => auditEvents.push(event),
      config,
      masterKey,
      runtime: { disposeUser: async (userId) => { runtimeDisposed.push(userId) } },
      probe: (...args) => probe(...args),
      cwdOf: userId => join(dir, 'workspaces', String(userId)),
    }
    return installMcpPersonalFetchRoutes(deps, {
      fetch: {
        register: (route) => {
          routes.set(route.path, route.fetch)
          return () => { routes.delete(route.path); return Promise.resolve() }
        },
      },
    })
  }

  async function call(path: string, cookie: string | undefined, args: Record<string, unknown> = {}): Promise<RpcFrame> {
    const fetchRoute = routes.get(path)
    expect(fetchRoute, `route missing: ${path}`).toBeDefined()
    const response = await fetchRoute?.(new Request(`http://local${path}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(cookie === undefined ? {} : { cookie }),
      },
      body: JSON.stringify({ type: 'client-request', rpcId: `r-${Math.random().toString(36).slice(2)}`, payload: { args } }),
    }))
    expect(response?.status).toBe(200)
    return (await response?.json() as { result: RpcFrame }).result
  }

  function upsertHttp(name: string, extra: Record<string, unknown> = {}): Promise<RpcFrame> {
    return call('/api/mcp-personal/upsert', aliceCookie, {
      request: { name, transport: 'http', url: `https://example.com/${name}/mcp`, ...extra },
    })
  }

  // ── 401 / 403(与不存在同响应) ───────────────────────────────────────────

  it('未登录:list 返回 tenant/unauthenticated(401 语义)', async () => {
    const result = await call('/api/mcp-personal/list', undefined)
    expect(result.ok).toBe(false)
    expect(result.error?.code).toBe('tenant/unauthenticated')
  })

  it('他人行与不存在同响应:bob 对 alice 的 id 做 delete/probe/upsert 全部同一文案', async () => {
    const created = await call('/api/mcp-personal/upsert', aliceCookie, {
      request: { name: 'alice-only', transport: 'stdio', catalogId: 'fs' },
    })
    const id = String((created.value?.item as { id?: string } | undefined)?.id)
    expect(id).not.toBe('')

    const notFound = 'MCP 条目不存在或不属于你'
    const deleteOwn = await call('/api/mcp-personal/delete', bobCookie, { request: { id } })
    const deleteMissing = await call('/api/mcp-personal/delete', bobCookie, { request: { id: 'no-such-id' } })
    expect(deleteOwn).toEqual(deleteMissing)
    expect(deleteOwn.error?.message).toBe(notFound)

    const probeOwn = await call('/api/mcp-personal/probe', bobCookie, { request: { id } })
    expect(probeOwn.error?.message).toBe(notFound)

    const upsertOther = await call('/api/mcp-personal/upsert', bobCookie, {
      request: { id, name: 'hijack', transport: 'http', url: 'https://example.com/mcp' },
    })
    expect(upsertOther.error?.message).toBe(notFound)

    // alice 的行未被动过
    const list = await call('/api/mcp-personal/list', aliceCookie)
    const items = list.value?.items as Array<{ id: string }>
    expect(items.map(item => item.id)).toEqual([id])
  })

  // ── catalog ───────────────────────────────────────────────────────────────

  it('catalog 只回 name/label/transport/envNames(无 command/args/secrets)', async () => {
    const result = await call('/api/mcp-personal/catalog', aliceCookie)
    expect(result.ok).toBe(true)
    const items = result.value?.items as Array<Record<string, unknown>>
    expect(items).toEqual([{ name: 'fs', label: '文件系统', transport: 'stdio', envNames: ['FS_TOKEN'] }])
    expect(JSON.stringify(result)).not.toContain('mcp-fs')
    expect(JSON.stringify(result)).not.toContain('/srv')
  })

  // ── stdio:只认 catalog_id ─────────────────────────────────────────────────

  it('stdio:合法 catalogId 由服务端解析 command/args,serverName 服务端生成', async () => {
    const result = await call('/api/mcp-personal/upsert', aliceCookie, {
      request: { name: 'My FS Server', transport: 'stdio', catalogId: 'fs' },
    })
    expect(result.ok).toBe(true)
    const item = result.value?.item as Record<string, unknown>
    expect(item.serverName).toBe(`p${aliceId}_MyFSServer`)
    expect(item.catalogId).toBe('fs')
    expect(item.transport).toBe('stdio')
    const row = store.getMcpServer(aliceId, String(item.id))
    expect(row?.command).toBe('mcp-fs')
    expect(row?.args).toEqual(['--root', '/srv'])
  })

  it('stdio:自填 command/args 一律拒绝(含空值)', async () => {
    for (const field of ['command', 'args', 'argv', 'commandLine']) {
      const result = await call('/api/mcp-personal/upsert', aliceCookie, {
        request: { name: 'evil', transport: 'stdio', catalogId: 'fs', [field]: field === 'args' ? [] : 'rm -rf /' },
      })
      expect(result.ok).toBe(false)
      expect(result.error?.message).toContain('只能来自管理员目录')
    }
  })

  it('stdio:目录外 catalogId 拒绝', async () => {
    const result = await call('/api/mcp-personal/upsert', aliceCookie, {
      request: { name: 'nope', transport: 'stdio', catalogId: 'not-in-catalog' },
    })
    expect(result.ok).toBe(false)
    expect(result.error?.message).toContain('管理员目录')
  })

  // ── http:协议/元数据/白名单 ───────────────────────────────────────────────

  it('http:拒绝云元数据地址与非法协议', async () => {
    for (const url of [
      'http://169.254.169.254/latest/meta-data',
      'http://[fd00:ec2::254]/latest/meta-data',
      'file:///etc/passwd',
      'ftp://example.com/x',
      'not-a-url',
    ]) {
      const result = await call('/api/mcp-personal/upsert', aliceCookie, {
        request: { name: `bad-${Math.random().toString(36).slice(2, 6)}`, transport: 'http', url },
      })
      expect(result.ok, url).toBe(false)
    }
  })

  it('personalHttpHosts 空=放行;非空=白名单且支持 *.suffix', async () => {
    const open = await upsertHttp('open')
    expect(open.ok).toBe(true)

    config = { enabled: true, catalog: CATALOG, httpHosts: ['api.example.com', '*.corp.example.com'] }
    disposeRoutes()
    disposeRoutes = mount()
    const allowed = await call('/api/mcp-personal/upsert', aliceCookie, {
      request: { name: 'allowed', transport: 'http', url: 'https://api.example.com/mcp' },
    })
    expect(allowed.ok).toBe(true)
    const wildcard = await call('/api/mcp-personal/upsert', aliceCookie, {
      request: { name: 'wildcard', transport: 'http', url: 'https://mcp.corp.example.com/mcp' },
    })
    expect(wildcard.ok).toBe(true)
    const blocked = await call('/api/mcp-personal/upsert', aliceCookie, {
      request: { name: 'blocked', transport: 'http', url: 'https://evil.test/mcp' },
    })
    expect(blocked.ok).toBe(false)
    expect(blocked.error?.message).toContain('不在管理员允许列表')
  })

  it('http:headers 只允许 ${secret:REF} 占位,未提供的 ref 拒绝', async () => {
    const missing = await upsertHttp('h1', { headers: { Authorization: '${secret:none}' } })
    expect(missing.ok).toBe(false)
    const plaintext = await upsertHttp('h2', { headers: { Authorization: 'Bearer plaintext' } })
    expect(plaintext.ok).toBe(false)
    expect(plaintext.error?.message).toContain('占位')
  })

  // ── AES-256-GCM 与密钥不回显 ──────────────────────────────────────────────

  it('AES-256-GCM:密文落库、可解密、列表只回 hasSecret/headerNames', async () => {
    const secretValue = 'super-secret-token-value'
    const result = await upsertHttp('secure', {
      headers: { Authorization: '${secret:token}' },
      secrets: { token: secretValue },
    })
    expect(result.ok).toBe(true)
    const item = result.value?.item as Record<string, unknown>
    expect(item.hasSecret).toBe(true)
    expect(item.headerNames).toEqual(['Authorization'])
    expect(JSON.stringify(result)).not.toContain(secretValue)

    const blob = store.getMcpSecret(aliceId, 'token')
    expect(blob).toBeInstanceOf(Uint8Array)
    expect(Buffer.from(blob as Uint8Array).includes(Buffer.from(secretValue))).toBe(false)
    expect(decryptMcpSecret(MASTER_KEY, blob as Uint8Array)).toBe(secretValue)

    const list = await call('/api/mcp-personal/list', aliceCookie)
    expect(JSON.stringify(list)).not.toContain(secretValue)
    const listed = (list.value?.items as Array<Record<string, unknown>>)[0]
    expect(listed?.hasSecret).toBe(true)
    expect(listed?.headerNames).toEqual(['Authorization'])
  })

  it('AES-GCM:错密钥/篡改信封返回 undefined;IV 每次不同', () => {
    const envelope = encryptMcpSecret(MASTER_KEY, 'value')
    expect(decryptMcpSecret(Buffer.alloc(32, 9), envelope)).toBeUndefined()
    const tampered = Uint8Array.from(envelope)
    tampered[tampered.length - 1] = (tampered[tampered.length - 1] ?? 0) ^ 0xff
    expect(decryptMcpSecret(MASTER_KEY, tampered)).toBeUndefined()
    expect(Buffer.from(encryptMcpSecret(MASTER_KEY, 'same')).equals(Buffer.from(envelope))).toBe(false)
    expect(decryptMcpSecret(MASTER_KEY, new Uint8Array([1, 2, 3]))).toBeUndefined()
  })

  it('主密钥解析:hex/base64/32 字符;loadMcpMasterKey 支持 env 与文件,缺席 fail-closed', () => {
    const hex = '11'.repeat(32)
    expect(parseMcpMasterKey(hex)?.length).toBe(32)
    expect(parseMcpMasterKey(Buffer.from('a'.repeat(32)).toString('base64'))?.length).toBe(32)
    expect(parseMcpMasterKey('k'.repeat(32))?.length).toBe(32)
    expect(parseMcpMasterKey('short')).toBeUndefined()
    expect(loadMcpMasterKey({ ETERNA_MCP_MASTER_KEY: hex }).key?.length).toBe(32)
    expect(loadMcpMasterKey({}).error).toContain('未配置')
    const secretsDir = join(dir, '.secrets')
    mkdirSync(secretsDir, { recursive: true })
    const keyFile = join(secretsDir, 'mcp-master-key')
    writeFileSync(keyFile, `${hex}\n`)
    const fromFile = loadMcpMasterKey({ ETERNA_MCP_MASTER_KEY_FILE: keyFile })
    expect(fromFile.key?.length).toBe(32)
    expect(loadMcpMasterKey({ ETERNA_MCP_MASTER_KEY_FILE: join(secretsDir, 'missing') }).error).toContain('不可读')
    // 只允许 .secrets/ 内文件:其它路径一律拒绝(不落盘到任意路径)。
    expect(loadMcpMasterKey({ ETERNA_MCP_MASTER_KEY_FILE: join(dir, 'master-key.txt') }).error).toContain('.secrets')
  })

  it('stdio env 按目录 envSchema 加密为 env:<NAME> ref', async () => {
    const result = await call('/api/mcp-personal/upsert', aliceCookie, {
      request: { name: 'fs-env', transport: 'stdio', catalogId: 'fs', env: { FS_TOKEN: 'env-secret' } },
    })
    expect(result.ok).toBe(true)
    const blob = store.getMcpSecret(aliceId, envSecretRef('FS_TOKEN'))
    expect(decryptMcpSecret(MASTER_KEY, blob as Uint8Array)).toBe('env-secret')
    const outOfSchema = await call('/api/mcp-personal/upsert', aliceCookie, {
      request: { name: 'fs-env-2', transport: 'stdio', catalogId: 'fs', env: { OTHER: 'x' } },
    })
    expect(outOfSchema.ok).toBe(false)
  })

  // ── 限额 ──────────────────────────────────────────────────────────────────

  it(`条目上限 ${MCP_PERSONAL_MAX_SERVERS}:第 ${MCP_PERSONAL_MAX_SERVERS + 1} 条拒绝`, async () => {
    for (let i = 0; i < MCP_PERSONAL_MAX_SERVERS; i++) {
      const result = await upsertHttp(`srv-${i}`)
      expect(result.ok, `#${i}`).toBe(true)
    }
    expect(store.countMcpServers(aliceId)).toBe(MCP_PERSONAL_MAX_SERVERS)
    const ninth = await upsertHttp('srv-9')
    expect(ninth.ok).toBe(false)
    expect(ninth.error?.message).toContain(`最多 ${MCP_PERSONAL_MAX_SERVERS} 个`)
  })

  it(`配置上限 ${MCP_PERSONAL_MAX_CONFIG_BYTES / 1024}KB:超限拒绝且不落库`, async () => {
    const secrets: Record<string, string> = {}
    for (let i = 0; i < 40; i++) secrets[`ref${i}`] = 'x'.repeat(8192)
    const result = await call('/api/mcp-personal/upsert', aliceCookie, {
      request: { name: 'huge', transport: 'http', url: 'https://example.com/mcp', secrets },
    })
    expect(result.ok).toBe(false)
    expect(result.error?.message).toContain('256KB')
    expect(store.countMcpServers(aliceId)).toBe(0)
  })

  // ── probe ─────────────────────────────────────────────────────────────────

  it('probe 成功只回 {ok,toolCount},不回显 headers/env/secrets', async () => {
    await upsertHttp('probe-me', { headers: { Authorization: '${secret:token}' }, secrets: { token: 'probe-secret' } })
    const id = store.listMcpServers(aliceId)[0]?.id ?? ''
    let resolved: McpResolvedTransport | undefined
    probe = async (transport) => { resolved = transport; return { ok: true, toolCount: 3 } }
    disposeRoutes()
    disposeRoutes = mount()
    const result = await call('/api/mcp-personal/probe', aliceCookie, { request: { id } })
    expect(result.ok).toBe(true)
    expect(result.value).toEqual({ ok: true, toolCount: 3 })
    // 传输解析面拿到明文(运行时需要),但响应/审计不含值。
    expect((resolved as McpResolvedTransport & { headers: Record<string, string> }).headers.Authorization).toBe('probe-secret')
    expect(resolved?.transport).toBe('streamable-http')
    expect(JSON.stringify(result)).not.toContain('probe-secret')
    expect(JSON.stringify(auditEvents)).not.toContain('probe-secret')
  })

  it('probe 失败错误文本脱敏(密钥值 → [redacted])', async () => {
    await upsertHttp('probe-fail', { headers: { Authorization: '${secret:token}' }, secrets: { token: 'leaky-secret' } })
    const id = store.listMcpServers(aliceId)[0]?.id ?? ''
    probe = async () => { throw new Error('connect failed Authorization=leaky-secret') }
    disposeRoutes()
    disposeRoutes = mount()
    const result = await call('/api/mcp-personal/probe', aliceCookie, { request: { id } })
    const error = String(result.value?.error)
    expect(error).toContain('[redacted]')
    expect(error).not.toContain('leaky-secret')
  })

  it(`probe ${MCP_PERSONAL_PROBE_TIMEOUT_MS / 1000}s 超时:signal 被 abort,返回 ok=false`, async () => {
    await upsertHttp('probe-slow')
    const id = store.listMcpServers(aliceId)[0]?.id ?? ''
    let aborted = false
    probe = (_transport, signal) => new Promise((resolve) => {
      signal.addEventListener('abort', () => { aborted = true; resolve({ ok: false, toolCount: 0, error: 'timeout' }) }, { once: true })
    })
    disposeRoutes()
    disposeRoutes = mount()
    vi.useFakeTimers()
    const pending = call('/api/mcp-personal/probe', aliceCookie, { request: { id } })
    await vi.advanceTimersByTimeAsync(MCP_PERSONAL_PROBE_TIMEOUT_MS)
    const result = await pending
    expect(aborted).toBe(true)
    expect(result.value?.ok).toBe(false)
  })

  // ── kill switch ───────────────────────────────────────────────────────────

  it('kill switch:enabled=false → 五端点全部 unavailable', async () => {
    config = { enabled: false, catalog: CATALOG, httpHosts: [] }
    disposeRoutes()
    disposeRoutes = mount()
    for (const path of ['catalog', 'list', 'upsert', 'delete', 'probe']) {
      const result = await call(`/api/mcp-personal/${path}`, aliceCookie, { request: { id: 'x' } })
      expect(result.ok, path).toBe(false)
      expect(result.error?.code, path).toBe('mcp-personal/unavailable')
    }
  })

  it('缺主密钥:整面 unavailable(不降级明文)', async () => {
    masterKey = undefined
    disposeRoutes()
    disposeRoutes = mount()
    const result = await upsertHttp('no-key')
    expect(result.ok).toBe(false)
    expect(result.error?.code).toBe('mcp-personal/unavailable')
    expect(result.error?.message).toContain('主密钥')
  })

  it('配置解析失败:enabled=false + error(fail-closed)', () => {
    const parsed = resolveMcpPersonalConfig({ catalog: '{"bad":' }, {})
    expect(parsed.enabled).toBe(false)
    expect(parsed.error).toContain('解析失败')
  })

  // ── 生命周期:delete/disable 调 disposeUser ──────────────────────────────

  it('delete 与 enabled=false 写入后调用 runtime.disposeUser(登出钩子另测)', async () => {
    const created = await upsertHttp('life', { enabled: false })
    expect(runtimeDisposed).toEqual([aliceId])
    const id = String((created.value?.item as { id?: string }).id)
    const deleted = await call('/api/mcp-personal/delete', aliceCookie, { request: { id } })
    expect(deleted.ok).toBe(true)
    expect(runtimeDisposed).toEqual([aliceId, aliceId])
  })

  // ── store 迁移 user_version 0→1 ──────────────────────────────────────────

  it('store 迁移:user_version 0→1、两表存在、重开幂等', () => {
    const dbPath = join(dir, 'users.db')
    const db = new DatabaseSync(dbPath)
    const version = (db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version
    expect(version).toBe(1)
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as Array<{ name: string }>
    expect(tables.map(row => row.name)).toEqual(expect.arrayContaining(['mcp_personal_server', 'mcp_personal_secret']))
    db.close()
    const reopened = new UserStore(dbPath)
    reopened.close()
    const db2 = new DatabaseSync(dbPath)
    expect((db2.prepare('PRAGMA user_version').get() as { user_version: number }).user_version).toBe(1)
    db2.close()
  })

  // ── 登出钩子 ─────────────────────────────────────────────────────────────

  it('登出 POST /logout 调用 onLogout(该用户 id/account)', () => {
    const logoutCalls: Array<{ id: number; account: string }> = []
    const deps: AccessDeps = {
      store,
      session,
      loginWindow: new SlidingWindow(5, 60_000),
      globalWindow: new SlidingWindow(30, 60_000),
      audit: event => auditEvents.push(event),
      bridgeHome: () => 'http://app.local/',
      dataDir: dir,
      provisionWorkspace: async () => {},
      onLogout: (user) => { logoutCalls.push(user) },
    }
    const request: AccessRequest = {
      method: 'POST', pathname: '/logout', cookie: aliceCookie,
      origin: undefined, host: 'app.local', xff: undefined, contentType: undefined, body: new Uint8Array(),
    }
    const reply = handleAccessRequest(deps, request)
    expect(reply.status).toBe(302)
    expect(logoutCalls).toEqual([{ id: aliceId, account: 'alice' }])
  })
})
