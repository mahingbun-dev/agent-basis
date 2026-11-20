/**
 * B14(2026-11-20,WP4-2):MCP 个人层 Host 半边——存储访问收口、AES-256-GCM 密钥、
 * 管理员 stdio 目录、五个 RPC 端点(catalog/list/upsert/delete/probe)。
 *
 * 安全边界(47 §7 / 50 §3.4.2):
 * - 所有查询/写入带 user_id;他人 id 与不存在同响应(403 语义,防枚举);
 * - stdio 只认管理员目录 catalog_id,客户端自填 command/args 一律拒绝
 *   (共享容器里用户自填命令=RCE);
 * - http 只接受 http:/https:,拒云元数据地址(169.254.169.254 / fd00:ec2::254),
 *   personalHttpHosts 空数组=全放行、非空=白名单(未来收紧开关);
 * - 每用户 ≤8 条、配置 ≤256KB;probe 10s 超时且只回 {ok,toolCount,error?};
 * - 密钥只存 AES-GCM 密文 BLOB;主密钥只从 ETERNA_MCP_MASTER_KEY 或
 *   ETERNA_MCP_MASTER_KEY_FILE 读,缺主密钥整面 fail-closed(不降级明文);
 * - 审计只记账号/条目名/transport/host,绝不记 headers/env/args 原值。
 *
 * 本文件不 import @deepseek-ai/dsh-mcp-client(probe 由 bootstrap 注入),因此路由
 * 测试与 tenant 守卫测试无需拉起上游 MCP 运行时。
 */
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'
import { readFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'
import type { AccessAuditEvent } from './audit.ts'
import type { SessionService } from './session.ts'
import {
  McpServerNameConflictError, McpServerNotFoundError,
  type McpServerInput, type McpServerRow, type McpTransport, type UserStore,
} from './store.ts'

/** 个人层端点前缀(全部 POST + RPC 信封,登录门在 tenant 守卫)。 */
export const MCP_PERSONAL_PREFIX = '/api/mcp-personal'

/** 每用户条目上限(47 §7)。 */
export const MCP_PERSONAL_MAX_SERVERS = 8
/** 单用户配置总字节上限(47 §7)。 */
export const MCP_PERSONAL_MAX_CONFIG_BYTES = 256 * 1024
/** probe 超时(50 §3.4.2)。 */
export const MCP_PERSONAL_PROBE_TIMEOUT_MS = 10_000
/** agent/created 的逐条连接预算(50 §3.4.3)。 */
export const MCP_PERSONAL_STARTUP_TIMEOUT_MS = 8000
/** 单用户同时挂载连接上限(47 §7)。 */
export const MCP_PERSONAL_MAX_CONNECTIONS = 4
/** serverName 总长上限(上游 SERVER_NAME_PATTERN)。 */
export const MCP_SERVER_NAME_MAX = 32

/** 管理员 stdio 目录项(仅管理员配置可提供 command/args)。 */
export interface McpCatalogEntry {
  readonly name: string
  readonly label: string
  readonly transport: 'stdio'
  readonly command: string
  readonly args: readonly string[]
  /** 允许用户填写的环境变量名(只下发名字,不下发值)。 */
  readonly envSchema: readonly string[]
}

/** 个人层配置(kill switch + 管理员目录 + HTTP host 白名单)。 */
export interface McpPersonalConfig {
  readonly enabled: boolean
  readonly catalog: readonly McpCatalogEntry[]
  readonly httpHosts: readonly string[]
  /** 配置解析失败原因(存在时整面 fail-closed)。 */
  readonly error?: string
}

/** 个人层传输解析结果(runtime/probe 共用;headers 值已解密为明文,绝不落库/日志)。 */
export type McpResolvedTransport =
  | {
    readonly transport: 'stdio'
    readonly serverName: string
    readonly command: string
    readonly args: readonly string[]
    readonly env: Readonly<Record<string, string>>
    /** 子进程工作目录(用户根;probe 与 runtime 同口径,缺省 process.cwd())。 */
    readonly cwd?: string
  }
  | {
    readonly transport: 'streamable-http'
    readonly serverName: string
    readonly url: string
    readonly headers: Readonly<Record<string, string>>
  }

/** probe 结果(路由只回这三个字段,不回显 headers/env)。 */
export interface McpProbeOutcome {
  readonly ok: boolean
  readonly toolCount: number
  readonly error?: string
}

/** probe 注入面(生产=bootstrap 用 dsh-mcp-client 实现;测试=假件)。 */
export type McpProbeFn = (config: McpResolvedTransport, signal: AbortSignal) => Promise<McpProbeOutcome>

/** 路由处理器消费的登录上下文(tenant 守卫的 GuardContext 结构子集)。 */
export interface McpPersonalCaller {
  readonly userId: number
  readonly account: string
}

type McpPersonalHandler = (
  rpcId: string,
  args: Record<string, unknown>,
  caller: McpPersonalCaller,
  signal: AbortSignal,
) => Response | Promise<Response>

/** 与 tenant 守卫 register 同形(登录门/信封/审计由守卫统一提供)。 */
export interface McpPersonalRegister {
  (path: string, handler: McpPersonalHandler): void
}

export interface McpPersonalDeps {
  readonly store: UserStore
  readonly session: SessionService
  audit(event: AccessAuditEvent): void
  readonly config: McpPersonalConfig
  /** 主密钥;缺席=整面 503(RPC 错误帧),绝不降级明文。 */
  readonly masterKey?: Buffer | undefined
  /** 删除/禁用/登出后的 live scope 摘除(可缺席=只做持久化)。 */
  readonly runtime?: { disposeUser(userId: number): Promise<void> } | undefined
  /** 全局/插件已占用的 serverName(防个人层命名撞车;可缺席=仅库内唯一约束)。 */
  readonly reservedServerNames?: (() => readonly string[]) | undefined
  /** 连接测试(生产由 bootstrap 注入 dsh-mcp-client probeServer)。 */
  readonly probe?: McpProbeFn | undefined
  /** stdio 工作目录(用户根;可缺席=process.cwd())。 */
  readonly cwdOf?: ((userId: number) => string | undefined) | undefined
}

/**
 * connection.fetch 注册面(结构子集;与 tenant.ts TenantFetchRegistry 同形,
 * 不 import tenant.ts——tenant 属 T25 车道,本文件独立成环)。
 */
export interface McpPersonalFetchRegistry {
  register(route: {
    readonly path: string
    readonly methods: readonly ('GET' | 'HEAD' | 'POST')[]
    readonly requestBody: 'buffered' | 'streaming'
    readonly fetch: (request: Request) => Promise<Response>
  }): () => Promise<void> | void
}

/** 插件侧已装好的守卫钩子(mux/沙箱/终端惰性安装,时序与 tenant 守卫一致)。 */
export interface McpPersonalFetchHost {
  readonly fetch: McpPersonalFetchRegistry
  readonly onRequest?: (() => void) | undefined
}

// ── 配置与环境变量解析 ─────────────────────────────────────────────────────

const TRUE_VALUES = new Set(['1', 'true', 'yes', 'on'])
const FALSE_VALUES = new Set(['0', 'false', 'no', 'off'])

function parseEnabled(raw: unknown): boolean | undefined {
  if (typeof raw === 'boolean') return raw
  if (typeof raw !== 'string') return undefined
  const value = raw.trim().toLowerCase()
  if (TRUE_VALUES.has(value)) return true
  if (FALSE_VALUES.has(value)) return false
  return undefined
}

function envValue(env: NodeJS.ProcessEnv, ...names: readonly string[]): string | undefined {
  for (const name of names) {
    const value = env[name]
    if (typeof value === 'string' && value !== '') return value
  }
  return undefined
}

function parseCatalog(raw: unknown): { entries?: McpCatalogEntry[]; error?: string } {
  if (raw === undefined || raw === null) return { entries: [] }
  const parsed: unknown = typeof raw === 'string' ? JSON.parse(raw) : raw
  if (!Array.isArray(parsed)) return { error: '管理员目录必须是数组' }
  const entries: McpCatalogEntry[] = []
  for (const item of parsed) {
    if (typeof item !== 'object' || item === null) return { error: '管理员目录项必须是对象' }
    const row = item as Record<string, unknown>
    const name = typeof row.name === 'string' ? row.name.trim() : ''
    const command = typeof row.command === 'string' ? row.command.trim() : ''
    const argsRaw = row.args ?? []
    const args = Array.isArray(argsRaw) && argsRaw.every(arg => typeof arg === 'string') ? argsRaw : undefined
    const envRaw = row.envSchema ?? []
    const envSchema = Array.isArray(envRaw)
      ? envRaw.map((entry) => {
        if (typeof entry === 'string') return entry
        if (typeof entry === 'object' && entry !== null && typeof (entry as { name?: unknown }).name === 'string') {
          return (entry as { name: string }).name
        }
        return ''
      }).filter(name => /^[A-Za-z_][A-Za-z0-9_]{0,63}$/.test(name))
      : []
    if (name === '' || command === '' || args === undefined) {
      const rawName = typeof row.name === 'string' ? row.name : ''
      return { error: `管理员目录项非法:${rawName}` }
    }
    if (row.transport !== undefined && row.transport !== 'stdio') return { error: `管理员目录只支持 stdio:${name}` }
    entries.push({
      name,
      label: typeof row.label === 'string' && row.label !== '' ? row.label : name,
      transport: 'stdio',
      command,
      args: [...args],
      envSchema,
    })
  }
  return { entries }
}

function parseHosts(raw: unknown): { hosts?: string[]; error?: string } {
  if (raw === undefined || raw === null || raw === '') return { hosts: [] }
  let parsed: unknown = raw
  if (typeof raw === 'string') {
    const text = raw.trim()
    if (text.startsWith('[')) parsed = JSON.parse(text)
    else parsed = text.split(',').map(item => item.trim()).filter(item => item !== '')
  }
  if (!Array.isArray(parsed) || !parsed.every(item => typeof item === 'string')) {
    return { error: 'personalHttpHosts 必须是字符串数组' }
  }
  return { hosts: parsed.map(item => item.trim().toLowerCase()).filter(item => item !== '') }
}

/**
 * 解析个人层配置:插件 config.personal(未来 profile 落点)优先,其次环境变量
 * (`mcp.personal.*` / `ETERNA_MCP_PERSONAL_*`)。解析失败 → enabled=false + error,
 * 由路由统一回不可用(不静默放行)。
 */
export function resolveMcpPersonalConfig(
  input?: {
    readonly enabled?: unknown
    readonly catalog?: unknown
    readonly personalHttpHosts?: unknown
    readonly httpHosts?: unknown
  },
  env: NodeJS.ProcessEnv = process.env,
): McpPersonalConfig {
  const enabledFromEnv = parseEnabled(envValue(env, 'mcp.personal.enabled', 'ETERNA_MCP_PERSONAL_ENABLED'))
  const enabledFromInput = parseEnabled(input?.enabled)
  const enabled = enabledFromInput ?? enabledFromEnv ?? true
  const catalogRaw = input?.catalog ?? envValue(env, 'mcp.personal.catalog', 'ETERNA_MCP_PERSONAL_CATALOG')
  const hostsRaw = input?.personalHttpHosts ?? input?.httpHosts ?? envValue(env, 'mcp.personal.personalHttpHosts', 'ETERNA_MCP_PERSONAL_HTTP_HOSTS')
  try {
    const catalog = parseCatalog(catalogRaw)
    if (catalog.error !== undefined) return { enabled: false, catalog: [], httpHosts: [], error: catalog.error }
    const hosts = parseHosts(hostsRaw)
    if (hosts.error !== undefined) return { enabled: false, catalog: [], httpHosts: [], error: hosts.error }
    return { enabled, catalog: catalog.entries ?? [], httpHosts: hosts.hosts ?? [] }
  } catch (error) {
    return {
      enabled: false,
      catalog: [],
      httpHosts: [],
      error: `个人 MCP 配置解析失败:${error instanceof Error ? error.message : String(error)}`,
    }
  }
}

// ── 主密钥与 AES-256-GCM ───────────────────────────────────────────────────

const MASTER_KEY_BYTES = 32
const GCM_IV_BYTES = 12
const GCM_TAG_BYTES = 16
const SECRET_ENVELOPE_VERSION = 1

/** 32 字节主密钥解析:64 位十六进制 / base64(解码后 32B) / 32 字符原文。 */
export function parseMcpMasterKey(raw: string | undefined): Buffer | undefined {
  if (raw === undefined) return undefined
  const value = raw.trim()
  if (value === '') return undefined
  if (/^[0-9a-fA-F]{64}$/.test(value)) return Buffer.from(value, 'hex')
  if (value.length === MASTER_KEY_BYTES) return Buffer.from(value, 'utf8')
  try {
    const decoded = Buffer.from(value, 'base64')
    if (decoded.length === MASTER_KEY_BYTES) return decoded
  } catch {
    // 非 base64 = 非法主密钥
  }
  return undefined
}

/**
 * 主密钥装载(只允许两个来源,47 §7):ETERNA_MCP_MASTER_KEY(首选,部署从
 * `.secrets/` 注入)或 **`.secrets/` 目录内的文件**——ETERNA_MCP_MASTER_KEY_FILE
 * 显式指名必须位于 .secrets/ 下;未指名时依次找 `<cwd>/.secrets/mcp-master-key`、
 * `$DSH_HOME/.secrets/mcp-master-key`。其他路径一律拒绝(不落库/日志/argv);
 * 失败返回 error 由调用方 fail-closed(个人层 503),绝不生成临时密钥。
 */
/** 路径是否位于 `.secrets/` 目录链内(主密钥文件唯一允许的落点)。 */
function isInsideSecrets(path: string): boolean {
  return resolve(path).split(/[\\/]+/).includes('.secrets')
}

/** 读一个 .secrets/ 主密钥文件;内容非法/不可读只返回 error(不抛、不回显内容)。 */
function readMasterKeyFile(path: string): { key?: Buffer; error?: string } {
  try {
    const key = parseMcpMasterKey(readFileSync(path, 'utf8'))
    return key === undefined ? { error: 'MCP 主密钥文件内容不是 32 字节密钥' } : { key }
  } catch {
    return { error: 'MCP 主密钥文件不可读' }
  }
}

export function loadMcpMasterKey(
  env: NodeJS.ProcessEnv = process.env,
): { key?: Buffer; error?: string } {
  const direct = parseMcpMasterKey(envValue(env, 'ETERNA_MCP_MASTER_KEY'))
  if (direct !== undefined) return { key: direct }
  const file = envValue(env, 'ETERNA_MCP_MASTER_KEY_FILE')
  if (file !== undefined) {
    if (!isInsideSecrets(file)) return { error: 'MCP 主密钥文件必须位于 .secrets/ 目录内' }
    return readMasterKeyFile(resolve(file))
  }
  // 未显式指名:只查两个约定落点(cwd / DSH_HOME 下的 .secrets/),不扫其它路径。
  const candidates = [
    resolve(process.cwd(), '.secrets', 'mcp-master-key'),
    resolve(env.DSH_HOME ?? process.cwd(), '.secrets', 'mcp-master-key'),
  ]
  for (const candidate of candidates) {
    if (existsSync(candidate)) return readMasterKeyFile(candidate)
  }
  return { error: '未配置 MCP 主密钥(ETERNA_MCP_MASTER_KEY / .secrets/mcp-master-key)' }
}

/** AES-256-GCM 加密:信封 = [version(1) | iv(12) | tag(16) | ciphertext];AAD 绑版本。 */
export function encryptMcpSecret(key: Buffer, plaintext: string): Uint8Array {
  const iv = randomBytes(GCM_IV_BYTES)
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  cipher.setAAD(Buffer.from([SECRET_ENVELOPE_VERSION]))
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return Buffer.concat([Buffer.from([SECRET_ENVELOPE_VERSION]), iv, tag, ciphertext])
}

/** 解密;信封非法/密钥不匹配返回 undefined(调用方按「密钥不可用」处理)。 */
export function decryptMcpSecret(key: Buffer, envelope: Uint8Array): string | undefined {
  const buffer = Buffer.from(envelope)
  if (buffer.length < 1 + GCM_IV_BYTES + GCM_TAG_BYTES) return undefined
  if (buffer[0] !== SECRET_ENVELOPE_VERSION) return undefined
  const iv = buffer.subarray(1, 1 + GCM_IV_BYTES)
  const tag = buffer.subarray(1 + GCM_IV_BYTES, 1 + GCM_IV_BYTES + GCM_TAG_BYTES)
  const ciphertext = buffer.subarray(1 + GCM_IV_BYTES + GCM_TAG_BYTES)
  try {
    const decipher = createDecipheriv('aes-256-gcm', key, iv)
    decipher.setAAD(Buffer.from([SECRET_ENVELOPE_VERSION]))
    decipher.setAuthTag(tag)
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8')
  } catch {
    return undefined
  }
}

// ── 密钥引用占位与传输解析 ─────────────────────────────────────────────────

const SECRET_REF_PATTERN = /^[A-Za-z0-9_.:-]{1,64}$/
const SECRET_PLACEHOLDER = /^\$\{secret:([A-Za-z0-9_.:-]{1,64})\}$/
const ENV_REF_PREFIX = 'env:'

/** 用户可见 ref → 环境变量 ref(避免与 http header 自定义 ref 撞名)。 */
export function envSecretRef(name: string): string {
  return `${ENV_REF_PREFIX}${name}`
}

function placeholdersOf(headers: Readonly<Record<string, string>> | undefined): string[] {
  if (headers === undefined) return []
  const refs: string[] = []
  for (const value of Object.values(headers)) {
    const match = SECRET_PLACEHOLDER.exec(value)
    if (match?.[1] !== undefined) refs.push(match[1])
  }
  return refs
}

function catalogEntryOf(config: McpPersonalConfig, catalogId: string | undefined): McpCatalogEntry | undefined {
  if (catalogId === undefined) return undefined
  return config.catalog.find(entry => entry.name === catalogId)
}

/** 行关联的 secret refs(http headers 占位 + stdio 目录 envSchema)。 */
export function secretRefsOf(row: McpServerRow, config: McpPersonalConfig): string[] {
  if (row.transport === 'streamable-http') return [...new Set(placeholdersOf(row.headers))]
  const catalog = catalogEntryOf(config, row.catalogId)
  return catalog === undefined ? [] : catalog.envSchema.map(name => envSecretRef(name))
}

/**
 * 解析可连接传输(密钥在此解密,返回值只活在调用栈/子进程 env/HTTP headers 里)。
 * stdio 缺目录/缺 command → undefined(挂载层 warn 跳过,不抛)。
 */
export function resolveMcpTransport(
  row: McpServerRow,
  config: McpPersonalConfig,
  secretOf: (ref: string) => string | undefined,
  options: { readonly cwd?: string | undefined } = {},
): McpResolvedTransport | undefined {
  if (row.transport === 'stdio') {
    const catalog = catalogEntryOf(config, row.catalogId)
    if (catalog === undefined || row.command === undefined || catalog.command !== row.command) return undefined
    const env: Record<string, string> = {}
    for (const name of catalog.envSchema) {
      const value = secretOf(envSecretRef(name))
      if (value !== undefined) env[name] = value
    }
    return {
      transport: 'stdio',
      serverName: row.serverName,
      command: catalog.command,
      args: [...(row.args ?? catalog.args)],
      env,
      ...(options.cwd === undefined || options.cwd === '' ? {} : { cwd: options.cwd }),
    }
  }
  if (row.url === undefined) return undefined
  const headers: Record<string, string> = {}
  for (const [name, value] of Object.entries(row.headers ?? {})) {
    const match = SECRET_PLACEHOLDER.exec(value)
    if (match?.[1] === undefined) return undefined
    const secret = secretOf(match[1])
    if (secret === undefined) return undefined
    headers[name] = secret
  }
  return { transport: 'streamable-http', serverName: row.serverName, url: row.url, headers }
}

// ── 校验辅助 ──────────────────────────────────────────────────────────────

const METADATA_HOSTS = new Set(['169.254.169.254', 'fd00:ec2::254'])

/** URL 主机规范化(IPv6 去方括号、小写)。 */
function hostnameOf(url: URL): string {
  return url.hostname.toLowerCase().replace(/^\[|\]$/g, '')
}

function isMetadataHost(host: string): boolean {
  if (METADATA_HOSTS.has(host)) return true
  return host === '::ffff:169.254.169.254' || host.endsWith('.169.254.169.254')
}

/** personalHttpHosts 白名单匹配(精确 host / host:port / `*.suffix`)。 */
function hostAllowed(hosts: readonly string[], url: URL): boolean {
  if (hosts.length === 0) return true
  const host = hostnameOf(url)
  const hostPort = `${host}:${url.port === '' ? (url.protocol === 'https:' ? '443' : '80') : url.port}`
  return hosts.some((entry) => {
    const pattern = entry.toLowerCase()
    if (pattern === host || pattern === hostPort) return true
    if (pattern.startsWith('*.')) {
      const suffix = pattern.slice(1)
      return host.endsWith(suffix) && host.length > suffix.length
    }
    return false
  })
}

/**
 * http URL 校验:仅 http:/https:;拒云元数据地址;白名单非空必须命中。
 * 返回错误文案(undefined=通过)。
 */
export function validateHttpUrl(raw: string, hosts: readonly string[]): string | undefined {
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    return 'URL 非法'
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return '仅支持 http/https'
  if (isMetadataHost(hostnameOf(url))) return '拒绝访问云元数据地址'
  if (!hostAllowed(hosts, url)) return '该 host 不在管理员允许列表'
  return undefined
}

/** serverName slug:只留 [A-Za-z0-9_-];空则 srv;总长 ≤32。 */
export function slugOf(name: string): string {
  const slug = name.replace(/[^A-Za-z0-9_-]/g, '').replace(/^[-_]+/, '')
  return slug === '' ? 'srv' : slug
}

/** 服务端生成 `p<uid>_<slug>`(总长 ≤32;不信任客户端)。 */
export function mcpServerNameFor(userId: number, name: string): string {
  const prefix = `p${userId}_`
  const budget = MCP_SERVER_NAME_MAX - prefix.length
  return `${prefix}${slugOf(name).slice(0, Math.max(1, budget))}`
}

function firstString(source: Record<string, unknown> | undefined, key: string): string | undefined {
  const value = source?.[key]
  return typeof value === 'string' && value !== '' ? value : undefined
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function stringRecord(value: unknown): Record<string, string> | undefined {
  if (!isRecord(value)) return undefined
  const record: Record<string, string> = {}
  for (const [key, raw] of Object.entries(value)) {
    if (typeof raw !== 'string') return undefined
    record[key] = raw
  }
  return record
}

// ── RPC 信封 ──────────────────────────────────────────────────────────────

function frame(rpcId: string, result: unknown): Response {
  return new Response(JSON.stringify({ type: 'server-response', rpcId, result }), {
    status: 200,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  })
}

function okFrame(rpcId: string, value: unknown): Response {
  return frame(rpcId, { ok: true, value })
}

function deniedFrame(rpcId: string, message: string): Response {
  return frame(rpcId, { ok: false, error: { code: 'tenant/denied', message, details: {} } })
}

/** 401 语义:与 tenant 守卫同帧码,客户端连接层按未登录处理。 */
function unauthenticatedFrame(rpcId: string): Response {
  return frame(rpcId, { ok: false, error: { code: 'tenant/unauthenticated', message: '未登录', details: {} } })
}

function unavailableFrame(rpcId: string, message: string): Response {
  return frame(rpcId, { ok: false, error: { code: 'mcp-personal/unavailable', message, details: {} } })
}

function failureFrame(rpcId: string, error: unknown): Response {
  return frame(rpcId, {
    ok: false,
    error: { code: 'gateway/internal', message: error instanceof Error ? error.message : String(error), details: {} },
  })
}

// ── 视图 ──────────────────────────────────────────────────────────────────

function viewOf(row: McpServerRow, config: McpPersonalConfig, store: Pick<UserStore, 'hasMcpSecret'>): Record<string, unknown> {
  const refs = secretRefsOf(row, config)
  return {
    id: row.id,
    name: row.name,
    serverName: row.serverName,
    transport: row.transport,
    catalogId: row.catalogId ?? null,
    url: row.url ?? null,
    headerNames: Object.keys(row.headers ?? {}),
    // 只回「已设置」,值/占位永不回传(50 §3.4.2;MCPP-013)
    hasSecret: refs.some(ref => store.hasMcpSecret(row.userId, ref)),
    enabled: row.enabled,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }
}

/**
 * 注册五个个人层端点(全部 POST;调用方=tenant 守卫的 register,已含登录门/信封/
 * cookie 认证)。本函数不自行判登录——caller 由守卫给出,未登录请求根本到不了这里。
 */
export function registerMcpPersonalRoutes(deps: McpPersonalDeps, register: McpPersonalRegister): void {
  const store = deps.store
  const config = deps.config
  const unavailableReason = config.error !== undefined
    ? config.error
    : !config.enabled
      ? 'MCP 个人层已被管理员关闭(mcp.personal.enabled=false)'
      : deps.masterKey === undefined
        ? 'MCP 个人层未配置主密钥,已 fail-closed'
        : undefined

  const auditDeny = (caller: McpPersonalCaller, action: string, reason: string, detail: Record<string, unknown> = {}): void => {
    deps.audit({
      kind: 'access.tenant',
      account: caller.account,
      ok: false,
      detail: { action: `mcp.personal.${action}.denied`, reason, ...detail },
    })
  }

  const auditOk = (
    kind: string,
    caller: McpPersonalCaller,
    row: McpServerRow | { name?: string; serverName?: string; transport?: McpTransport; url?: string },
  ): void => {
    let host: string | undefined
    if ('url' in row && typeof row.url === 'string') {
      try { host = new URL(row.url).host } catch { host = undefined }
    }
    deps.audit({
      kind,
      account: caller.account,
      ok: true,
      detail: {
        name: row.name ?? '',
        serverName: row.serverName ?? '',
        transport: row.transport ?? '',
        host: host ?? '',
      },
    })
  }

  const disposeAfterWrite = async (caller: McpPersonalCaller, action: string): Promise<void> => {
    if (deps.runtime === undefined) return
    try {
      await deps.runtime.disposeUser(caller.userId)
    } catch (error) {
      deps.audit({
        kind: 'access.tenant',
        account: caller.account,
        ok: false,
        detail: { action: `mcp.personal.${action}.dispose-failed`, error: error instanceof Error ? error.message : String(error) },
      })
    }
  }

  register(`${MCP_PERSONAL_PREFIX}/catalog`, (rpcId, _args, _caller) => {
    if (unavailableReason !== undefined) return unavailableFrame(rpcId, unavailableReason)
    const items = config.catalog.map(entry => ({
      name: entry.name,
      label: entry.label,
      transport: entry.transport,
      envNames: [...entry.envSchema],
    }))
    return okFrame(rpcId, { items, hostWhitelist: [...config.httpHosts] })
  })

  register(`${MCP_PERSONAL_PREFIX}/list`, (rpcId, _args, caller) => {
    if (unavailableReason !== undefined) return unavailableFrame(rpcId, unavailableReason)
    const items = store.listMcpServers(caller.userId).map(row => viewOf(row, config, store))
    return okFrame(rpcId, { items, limit: MCP_PERSONAL_MAX_SERVERS })
  })

  register(`${MCP_PERSONAL_PREFIX}/upsert`, async (rpcId, args, caller) => {
    if (unavailableReason !== undefined) return unavailableFrame(rpcId, unavailableReason)
    const request = isRecord(args.request) ? args.request : args
    const id = firstString(request, 'id')
    const name = (firstString(request, 'name') ?? '').trim()
    const transportRaw = firstString(request, 'transport')
    const transport: McpTransport | undefined = transportRaw === 'stdio'
      ? 'stdio'
      : transportRaw === 'streamable-http' || transportRaw === 'http' ? 'streamable-http' : undefined

    // ② 归属前置:带 id 的更新/禁用只认本人行;他人 id 与不存在同响应。
    const existing = id === undefined ? undefined : store.getMcpServer(caller.userId, id)
    if (id !== undefined && existing === undefined) {
      auditDeny(caller, 'upsert', 'owner', { id })
      return deniedFrame(rpcId, 'MCP 条目不存在或不属于你')
    }
    // ③ 传输校验
    if (name === '' || name.length > 64) {
      auditDeny(caller, 'upsert', 'name')
      return deniedFrame(rpcId, '名称长度须在 1-64 字符之间')
    }
    if (transport === undefined) {
      auditDeny(caller, 'upsert', 'transport', { name })
      return deniedFrame(rpcId, 'transport 只允许 stdio 或 streamable-http')
    }
    // stdio 的 command/args 只许来自管理员目录:任何直填键一律拒绝(含空值)。
    for (const forbidden of ['command', 'args', 'argsJson', 'argv', 'commandLine']) {
      if (Object.prototype.hasOwnProperty.call(request, forbidden)) {
        auditDeny(caller, 'upsert', 'stdio-command', { name, field: forbidden })
        return deniedFrame(rpcId, 'stdio 的 command/args 只能来自管理员目录,禁止自填')
      }
    }

    let catalogId: string | undefined
    let command: string | undefined
    let resolvedArgs: readonly string[] | undefined
    let url: string | undefined
    if (transport === 'stdio') {
      catalogId = firstString(request, 'catalogId')
      const catalog = catalogEntryOf(config, catalogId)
      if (catalog === undefined) {
        auditDeny(caller, 'upsert', 'catalog', { name })
        return deniedFrame(rpcId, 'stdio 条目必须选择管理员目录中的服务器')
      }
      command = catalog.command
      resolvedArgs = [...catalog.args]
    } else {
      url = firstString(request, 'url')
      if (url === undefined) {
        auditDeny(caller, 'upsert', 'url', { name })
        return deniedFrame(rpcId, 'HTTP 条目必须提供 URL')
      }
      const urlError = validateHttpUrl(url, config.httpHosts)
      if (urlError !== undefined) {
        auditDeny(caller, 'upsert', 'url', { name, host: safeHost(url) })
        return deniedFrame(rpcId, urlError)
      }
    }

    // headers:值只允许 ${secret:REF} 占位;secrets:本次要写入的明文(加密后落库)。
    let headers: Record<string, string> | undefined
    const secretsRaw = request.secrets === undefined ? {} : stringRecord(request.secrets)
    if (request.secrets !== undefined && secretsRaw === undefined) {
      auditDeny(caller, 'upsert', 'secrets', { name })
      return deniedFrame(rpcId, 'secrets 必须是字符串映射')
    }
    const secrets = secretsRaw ?? {}
    for (const [ref, plaintext] of Object.entries(secrets)) {
      if (!SECRET_REF_PATTERN.test(ref) || plaintext === '' || plaintext.length > 8192) {
        auditDeny(caller, 'upsert', 'secret-ref', { name })
        return deniedFrame(rpcId, '密钥名或值非法(值≤8192 字符)')
      }
    }
    if (transport === 'streamable-http' && request.headers !== undefined) {
      const rawHeaders = stringRecord(request.headers)
      if (rawHeaders === undefined) {
        auditDeny(caller, 'upsert', 'headers', { name })
        return deniedFrame(rpcId, 'headers 必须是字符串映射')
      }
      for (const [header, value] of Object.entries(rawHeaders)) {
        const match = SECRET_PLACEHOLDER.exec(value)
        if (match?.[1] === undefined) {
          auditDeny(caller, 'upsert', 'headers', { name, field: header })
          return deniedFrame(rpcId, 'headers 值只允许 ${secret:REF} 占位(不存明文)')
        }
        if (secrets[match[1]] === undefined && !store.hasMcpSecret(caller.userId, match[1])) {
          auditDeny(caller, 'upsert', 'headers', { name, field: header })
          return deniedFrame(rpcId, `引用的密钥 ${match[1]} 未提供`)
        }
      }
      headers = rawHeaders
    }
    // stdio env:值即明文,按管理员目录 envSchema 收口后加密为 env:<NAME> ref。
    const envRaw = request.env === undefined ? undefined : stringRecord(request.env)
    if (request.env !== undefined && envRaw === undefined) {
      auditDeny(caller, 'upsert', 'env', { name })
      return deniedFrame(rpcId, 'env 必须是字符串映射')
    }
    const catalogEnv = transport === 'stdio' ? (catalogEntryOf(config, catalogId)?.envSchema ?? []) : []
    if (envRaw !== undefined) {
      for (const [envName, value] of Object.entries(envRaw)) {
        if (catalogEnv.length > 0 && !catalogEnv.includes(envName)) {
          auditDeny(caller, 'upsert', 'env', { name, field: envName })
          return deniedFrame(rpcId, `环境变量 ${envName} 不在管理员目录声明的范围内`)
        }
        if (!/^[A-Za-z_][A-Za-z0-9_]{0,63}$/.test(envName) || value === '' || value.length > 8192) {
          auditDeny(caller, 'upsert', 'env', { name, field: envName })
          return deniedFrame(rpcId, '环境变量名或值非法')
        }
      }
    }

    // ④ 限额:新建 ≤8;配置总字节 ≤256KB(先在明文面估算,失败不落库)
    if (existing === undefined && store.countMcpServers(caller.userId) >= MCP_PERSONAL_MAX_SERVERS) {
      auditDeny(caller, 'upsert', 'limit', { name })
      return deniedFrame(rpcId, `每人最多 ${MCP_PERSONAL_MAX_SERVERS} 个 MCP 服务器`)
    }
    const estimated = JSON.stringify({
      name, transport, catalogId: catalogId ?? null, url: url ?? null, command: command ?? null,
      args: resolvedArgs ?? [], headers: headers ?? {}, env: envRaw ?? {}, secrets,
    })
    if (Buffer.byteLength(estimated, 'utf8') > MCP_PERSONAL_MAX_CONFIG_BYTES) {
      auditDeny(caller, 'upsert', 'size', { name })
      return deniedFrame(rpcId, `配置超过 ${MCP_PERSONAL_MAX_CONFIG_BYTES / 1024}KB 上限`)
    }

    // serverName 服务端生成;与全局/插件命名空间冲突直接拒绝(不静默改名)
    const reserved = new Set((deps.reservedServerNames?.() ?? []).map(item => item.toLowerCase()))
    const serverName = mcpServerNameFor(caller.userId, name)
    if (reserved.has(serverName.toLowerCase())) {
      auditDeny(caller, 'upsert', 'server-name', { name, serverName })
      return deniedFrame(rpcId, `服务器命名冲突:${serverName}`)
    }
    // 同一用户内不同条目撞 serverName(库内 UNIQUE 是最终仲裁)
    const sameName = store.listMcpServers(caller.userId).find(row => row.serverName === serverName && row.id !== existing?.id)
    if (sameName !== undefined) {
      auditDeny(caller, 'upsert', 'server-name', { name, serverName })
      return deniedFrame(rpcId, `服务器命名冲突:${serverName}`)
    }

    const enabled = request.enabled === undefined ? true : request.enabled
    if (typeof enabled !== 'boolean') {
      auditDeny(caller, 'upsert', 'enabled', { name })
      return deniedFrame(rpcId, 'enabled 必须是布尔值')
    }

    const input: McpServerInput = {
      ...(existing !== undefined ? { id: existing.id } : {}),
      name,
      serverName,
      transport,
      catalogId: catalogId ?? null,
      command: command ?? null,
      args: resolvedArgs ?? null,
      url: url ?? null,
      headers: headers ?? null,
      enabled,
    }
    let row: McpServerRow
    try {
      row = store.upsertMcpServer(caller.userId, input)
    } catch (error) {
      if (error instanceof McpServerNotFoundError) {
        auditDeny(caller, 'upsert', 'owner', { id })
        return deniedFrame(rpcId, 'MCP 条目不存在或不属于你')
      }
      if (error instanceof McpServerNameConflictError) {
        auditDeny(caller, 'upsert', 'server-name', { name, serverName })
        return deniedFrame(rpcId, `服务器命名冲突:${serverName}`)
      }
      return failureFrame(rpcId, error)
    }
    // ⑤ 写库后:密钥加密入库(明文只在本次调用栈);审计不含原值。
    for (const [ref, plaintext] of Object.entries(secrets)) {
      store.putMcpSecret(caller.userId, ref, encryptMcpSecret(deps.masterKey as Buffer, plaintext))
    }
    if (envRaw !== undefined) {
      for (const [envName, value] of Object.entries(envRaw)) {
        store.putMcpSecret(caller.userId, envSecretRef(envName), encryptMcpSecret(deps.masterKey as Buffer, value))
      }
    }
    auditOk('mcp.personal.upsert', caller, row)
    if (!row.enabled) await disposeAfterWrite(caller, 'upsert')
    return okFrame(rpcId, { item: viewOf(row, config, store) })
  })

  register(`${MCP_PERSONAL_PREFIX}/delete`, async (rpcId, args, caller) => {
    if (unavailableReason !== undefined) return unavailableFrame(rpcId, unavailableReason)
    const request = isRecord(args.request) ? args.request : args
    const id = firstString(request, 'id')
    if (id === undefined) {
      auditDeny(caller, 'delete', 'id')
      return deniedFrame(rpcId, 'MCP 条目不存在或不属于你')
    }
    const row = store.getMcpServer(caller.userId, id)
    if (row === undefined) {
      auditDeny(caller, 'delete', 'owner', { id })
      return deniedFrame(rpcId, 'MCP 条目不存在或不属于你')
    }
    if (!store.deleteMcpServer(caller.userId, id)) return deniedFrame(rpcId, 'MCP 条目不存在或不属于你')
    auditOk('mcp.personal.delete', caller, row)
    await disposeAfterWrite(caller, 'delete')
    return okFrame(rpcId, { ok: true })
  })

  register(`${MCP_PERSONAL_PREFIX}/probe`, async (rpcId, args, caller, signal) => {
    if (unavailableReason !== undefined) return unavailableFrame(rpcId, unavailableReason)
    const request = isRecord(args.request) ? args.request : args
    const id = firstString(request, 'id')
    if (id === undefined) {
      auditDeny(caller, 'probe', 'id')
      return deniedFrame(rpcId, 'MCP 条目不存在或不属于你')
    }
    const row = store.getMcpServer(caller.userId, id)
    if (row === undefined) {
      auditDeny(caller, 'probe', 'owner', { id })
      return deniedFrame(rpcId, 'MCP 条目不存在或不属于你')
    }
    if (deps.probe === undefined) return failureFrame(rpcId, new Error('MCP probe 未装配'))
    const secretOf = (ref: string): string | undefined => {
      const blob = store.getMcpSecret(caller.userId, ref)
      return blob === undefined ? undefined : decryptMcpSecret(deps.masterKey as Buffer, blob)
    }
    const resolved = resolveMcpTransport(row, config, secretOf, { cwd: deps.cwdOf?.(caller.userId) })
    if (resolved === undefined) {
      auditDeny(caller, 'probe', 'transport', { name: row.name, transport: row.transport })
      return deniedFrame(rpcId, '条目配置不完整(目录/密钥缺失)')
    }
    const controller = new AbortController()
    const timeout = setTimeout(() => { controller.abort() }, MCP_PERSONAL_PROBE_TIMEOUT_MS)
    const onAbort = (): void => { controller.abort() }
    signal.addEventListener('abort', onAbort, { once: true })
    try {
      const result = await deps.probe(resolved, controller.signal)
      // 单事件审计:错误文本先脱敏(可能含用户密钥/headers 回显),响应同源。
      const redactedError = result.error === undefined
        ? undefined
        : redactSecrets(result.error, store, caller.userId, deps.masterKey)
      deps.audit({
        kind: 'mcp.personal.probe',
        account: caller.account,
        ok: result.ok,
        detail: {
          name: row.name,
          serverName: row.serverName,
          transport: row.transport,
          host: safeHost(row.url),
          toolCount: result.toolCount,
          ...(redactedError !== undefined ? { error: redactedError.slice(0, 256) } : {}),
        },
      })
      return okFrame(rpcId, {
        ok: result.ok,
        toolCount: result.toolCount,
        ...(redactedError !== undefined ? { error: redactedError } : {}),
      })
    } catch (error) {
      const message = redactSecrets(error instanceof Error ? error.message : String(error), store, caller.userId, deps.masterKey)
      deps.audit({
        kind: 'mcp.personal.probe',
        account: caller.account,
        ok: false,
        detail: { name: row.name, serverName: row.serverName, transport: row.transport, error: message.slice(0, 256) },
      })
      return okFrame(rpcId, { ok: false, toolCount: 0, error: message })
    } finally {
      clearTimeout(timeout)
      signal.removeEventListener('abort', onAbort)
    }
  })
}

/** host 审计字段(只到 host:port;解析失败回空串)。 */
function safeHost(raw: string | undefined): string {
  if (raw === undefined || raw === '') return ''
  try { return new URL(raw).host } catch { return '' }
}

/** 错误文本脱敏:把该用户已存的明文密钥值替换为 [redacted](日志/审计/响应共用)。 */
function redactSecrets(
  message: string,
  store: Pick<UserStore, 'mcpSecretRefs' | 'getMcpSecret'>,
  userId: number,
  key: Buffer | undefined,
): string {
  if (key === undefined) return message
  let redacted = message
  for (const ref of store.mcpSecretRefs(userId)) {
    const blob = store.getMcpSecret(userId, ref)
    if (blob === undefined) continue
    const plaintext = decryptMcpSecret(key, blob)
    if (plaintext !== undefined && plaintext !== '') redacted = redacted.split(plaintext).join('[redacted]')
  }
  return redacted
}

// ── bootstrap 接线:登录门 + RPC 信封 + fetch 路由注册 ──────────────────────

/** 解包客户端信封:{type:'client-request', rpcId, payload:{args}} → {rpcId, args}。 */
function unpackEnvelope(body: unknown): { rpcId: string; args: Record<string, unknown> } | undefined {
  if (typeof body !== 'object' || body === null) return undefined
  const envelope = body as Record<string, unknown>
  if (envelope.type !== 'client-request' || typeof envelope.rpcId !== 'string') return undefined
  const payload = envelope.payload as Record<string, unknown> | undefined
  const args = payload?.args
  if (typeof args !== 'object' || args === null || Array.isArray(args)) return undefined
  return { rpcId: envelope.rpcId, args: args as Record<string, unknown> }
}

/** cookie → 会话(pwv 比对)→ 用户;与 tenant 守卫同一身份面,失败返回 undefined(401)。 */
function callerOf(deps: McpPersonalDeps, request: Request): McpPersonalCaller | undefined {
  const claims = deps.session.resolveUser(request.headers.get('cookie') ?? undefined)
  if (claims === undefined) return undefined
  const pwv = deps.store.getPasswordVersion(claims.userId)
  if (pwv === undefined || pwv !== claims.passwordVersion) return undefined
  const user = deps.store.getUserById(claims.userId)
  if (user === undefined) return undefined
  return { userId: user.id, account: user.account }
}

/**
 * B14 接线入口:把五条个人层端点挂到 connection.fetch(与 tenant 守卫同一
 * 登录门/信封/401 帧),内部仍由 {@link registerMcpPersonalRoutes} 实现路由语义。
 * tenant.ts 属 T25 车道,本文件不 import 它;守卫钩子(onRequest)由 bootstrap 传
 * 入,时序与 registerTenantGuards 的 ensureMux 一致。返回组合 disposer(幂等)。
 */
export function installMcpPersonalFetchRoutes(deps: McpPersonalDeps, host: McpPersonalFetchHost): () => void {
  const disposers: Array<() => void> = []
  let disposed = false
  const register: McpPersonalRegister = (path, handler) => {
    if (disposed) return
    const dispose = host.fetch.register({
      path,
      methods: ['POST'],
      requestBody: 'buffered',
      fetch: async (request) => {
        host.onRequest?.()
        const raw = await request.text()
        let body: unknown
        try {
          body = raw === '' ? undefined : JSON.parse(raw)
        } catch {
          body = undefined
        }
        const unpacked = unpackEnvelope(body)
        if (unpacked === undefined) return new Response('invalid client-request message', { status: 400 })
        const caller = callerOf(deps, request)
        if (caller === undefined) return unauthenticatedFrame(unpacked.rpcId)
        try {
          return await handler(unpacked.rpcId, unpacked.args, caller, request.signal)
        } catch (error) {
          return failureFrame(unpacked.rpcId, error)
        }
      },
    })
    disposers.push(() => { void dispose() })
  }
  registerMcpPersonalRoutes(deps, register)
  return () => {
    disposed = true
    for (const dispose of disposers.splice(0).reverse()) dispose()
  }
}
