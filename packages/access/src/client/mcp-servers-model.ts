/**
 * B14 个人层 MCP 的客户端纯逻辑面(T28,零 React / 零 DOM):
 * - 角色 → 分区页签(admin: 全局/管理员目录;普通用户: 我的服务器);
 * - 条目视图 → 表单草稿;草稿校验与 upsert 请求构造;
 * - 密钥 write-only 语义(50 §3.4.2):视图只有 hasSecret,表单里留空的密钥字段
 *   不发送,由服务端保留旧密文;HTTP headers 值一律 `${secret:REF}` 占位,
 *   REF 由 header 名确定性生成(编辑时无需回读明文也能复用已存密钥)。
 *
 * 这里只做客户端预校验;URL/目录/限额/元数据地址的最终裁决仍在服务端。
 */
import type { McpCatalogEntry, McpPersonalItem, McpTransportValue, McpUpsertRequest } from './mcp-personal-api.ts'
import type { Translate } from './i18n.ts'

/** 服务端限额同源(展示用;实际以 list 返回的 limit 为准)。 */
export const MCP_MAX_SERVERS = 8
export const MCP_NAME_MAX = 64
export const MCP_SECRET_MAX = 8192

export type McpSectionRole = 'admin' | 'user'
export type McpTabId = 'global' | 'catalog' | 'mine'

export interface McpTab {
  readonly id: McpTabId
  readonly labelKey: string
}

const ADMIN_TABS: readonly McpTab[] = [
  { id: 'global', labelKey: 'mcp.tab.global' },
  { id: 'catalog', labelKey: 'mcp.tab.catalog' },
  { id: 'mine', labelKey: 'mcp.tab.mine' },
]
const USER_TABS: readonly McpTab[] = [
  { id: 'mine', labelKey: 'mcp.tab.mine' },
]

/** admin 与普通用户看不同页签(50 §3.4.4)。 */
export function tabsForRole(role: McpSectionRole): readonly McpTab[] {
  return role === 'admin' ? ADMIN_TABS : USER_TABS
}

export interface McpHeaderDraft {
  readonly name: string
  readonly value: string
}

export interface McpEnvDraft {
  readonly name: string
  readonly value: string
}

/** 新增/编辑表单草稿。密钥字段的 value 只存在于本地草稿与提交参数中。 */
export interface McpDraft {
  readonly id: string | null
  readonly name: string
  readonly transport: McpTransportValue
  readonly catalogId: string
  readonly url: string
  readonly headers: readonly McpHeaderDraft[]
  readonly env: readonly McpEnvDraft[]
  readonly enabled: boolean
  /** 已有存量密钥(编辑时);值为 true 时密钥字段留空 = 保持不变。 */
  readonly hasSecret: boolean
  /** 编辑前的 header 名(小写折叠);只有这些名字留空才可复用旧密文。 */
  readonly knownHeaders: readonly string[]
}

export function draftOfNew(catalog: readonly McpCatalogEntry[]): McpDraft {
  const first = catalog[0]
  return {
    id: null,
    name: '',
    transport: first === undefined ? 'streamable-http' : 'stdio',
    catalogId: first?.name ?? '',
    url: '',
    headers: [],
    env: first === undefined ? [] : first.envNames.map(name => ({ name, value: '' })),
    enabled: true,
    hasSecret: false,
    knownHeaders: [],
  }
}

export function draftOfItem(item: McpPersonalItem, catalog: readonly McpCatalogEntry[]): McpDraft {
  const entry = item.catalogId === null ? undefined : catalog.find(row => row.name === item.catalogId)
  return {
    id: item.id,
    name: item.name,
    transport: item.transport,
    catalogId: item.catalogId ?? '',
    url: item.url ?? '',
    // 密钥值不回显:编辑态只保留 header 名,值留空(占位文案见组件)。
    headers: item.headerNames.map(name => ({ name, value: '' })),
    env: entry === undefined ? [] : entry.envNames.map(name => ({ name, value: '' })),
    enabled: item.enabled,
    hasSecret: item.hasSecret,
    knownHeaders: item.headerNames.map(name => name.toLowerCase()),
  }
}

/** 切换目录项:保留同名环境变量已输入的值,丢弃不属于新目录的字段。 */
export function withCatalog(draft: McpDraft, entry: McpCatalogEntry | undefined): McpDraft {
  if (entry === undefined) return { ...draft, catalogId: '', env: [] }
  const previous = new Map(draft.env.map(row => [row.name, row.value]))
  return {
    ...draft,
    catalogId: entry.name,
    env: entry.envNames.map(name => ({ name, value: previous.get(name) ?? '' })),
  }
}

export type McpDraftIssue = 'name' | 'catalog' | 'url' | 'headerName' | 'headerSecret' | 'secretLength'

const HEADER_NAME_PATTERN = /^[A-Za-z0-9!#$%&'*+.^_`|~-]+$/u
const METADATA_HOSTS = new Set(['169.254.169.254', 'fd00:ec2::254'])

/** 与服务端 validateHttpUrl 对齐的前置检查(协议/云元数据地址)。 */
export function isAcceptableHttpUrl(raw: string): boolean {
  let url: URL
  try {
    url = new URL(raw.trim())
  } catch {
    return false
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return false
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/gu, '')
  return !METADATA_HOSTS.has(host)
}

/**
 * 非法请求头的判定:名称合法且不重复;密钥留空只在「编辑前已存在同名 header
 * 且条目有存量密钥」时允许(复用旧密文),新增/改名的 header 必须重填。
 */
function headerIssue(draft: McpDraft): McpDraftIssue | undefined {
  const seen = new Set<string>()
  for (const row of draft.headers) {
    const name = row.name.trim()
    if (!HEADER_NAME_PATTERN.test(name)) return 'headerName'
    const folded = name.toLowerCase()
    if (seen.has(folded)) return 'headerName'
    seen.add(folded)
    if (row.value.length > MCP_SECRET_MAX) return 'secretLength'
    const reusable = draft.hasSecret && draft.knownHeaders.includes(folded)
    if (row.value === '' && !reusable) return 'headerSecret'
  }
  return undefined
}

export function draftIssue(draft: McpDraft, catalog: readonly McpCatalogEntry[]): McpDraftIssue | undefined {
  const name = draft.name.trim()
  if (name === '' || name.length > MCP_NAME_MAX) return 'name'
  if (draft.transport === 'stdio') {
    if (!catalog.some(entry => entry.name === draft.catalogId)) return 'catalog'
    if (draft.env.some(row => row.value.length > MCP_SECRET_MAX)) return 'secretLength'
    return undefined
  }
  if (!isAcceptableHttpUrl(draft.url)) return 'url'
  return headerIssue(draft)
}

/** 校验失败 → 文案键(组件直接 t(key))。 */
export function draftIssueMessageKey(issue: McpDraftIssue): string {
  switch (issue) {
    case 'name': return 'mcp.nameInvalid'
    case 'catalog': return 'mcp.catalogRequired'
    case 'url': return 'mcp.urlInvalid'
    case 'headerName': return 'mcp.headerNameInvalid'
    case 'headerSecret': return 'mcp.headerSecretRequired'
    case 'secretLength': return 'mcp.secretTooLong'
  }
}

/**
 * header 名 → 密钥 ref(确定性:`header:<slug>-<hash36>`,总长 ≤64)。
 * 编辑时不回读密文,靠同一名字得到同一 ref,服务端 hasMcpSecret 命中即复用旧密文。
 * 名字大小写/非法字符先折叠成 slug,fvn-1a 后缀保证不同名字不撞 ref。
 */
export function secretRefForHeader(name: string): string {
  const folded = name.trim().toLowerCase()
  let slug = ''
  for (const ch of folded) {
    if (/[a-z0-9_.-]/u.test(ch)) slug += ch
    else slug += `-${(ch.codePointAt(0) ?? 0).toString(16)}-`
  }
  if (slug === '') slug = 'secret'
  let hash = 0x811c9dc5
  for (let index = 0; index < folded.length; index += 1) {
    hash ^= folded.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193) >>> 0
  }
  const suffix = `-${hash.toString(36)}`
  const head = `header:${slug}`
  return head.length + suffix.length <= 64 ? `${head}${suffix}` : `${head.slice(0, 64 - suffix.length)}${suffix}`
}

function secretPlaceholder(ref: string): string {
  // 服务端 SECRET_PLACEHOLDER = ^\$\{secret:([A-Za-z0-9_.:-]{1,64})\}$
  return `\${secret:${ref}}`
}

/**
 * 草稿 → upsert 请求。密钥语义:
 * - HTTP:每个 header 都发占位;值非空才进 secrets(留空 = 复用已存密文);
 * - stdio:只发非空 env(留空 = 服务端保留 env:<NAME> 旧密文)。
 * 非法草稿返回 undefined(调用方先跑 draftIssue 给出具体提示)。
 */
export function buildUpsertRequest(draft: McpDraft, catalog: readonly McpCatalogEntry[]): McpUpsertRequest | undefined {
  if (draftIssue(draft, catalog) !== undefined) return undefined
  const base = {
    name: draft.name.trim(),
    transport: draft.transport,
    enabled: draft.enabled,
    ...(draft.id === null ? {} : { id: draft.id }),
  }
  if (draft.transport === 'stdio') {
    const env: Record<string, string> = {}
    for (const row of draft.env) {
      if (row.value !== '') env[row.name] = row.value
    }
    return {
      ...base,
      catalogId: draft.catalogId,
      ...(Object.keys(env).length === 0 ? {} : { env }),
    }
  }
  const headers: Record<string, string> = {}
  const secrets: Record<string, string> = {}
  for (const row of draft.headers) {
    const name = row.name.trim()
    const ref = secretRefForHeader(name)
    headers[name] = secretPlaceholder(ref)
    if (row.value !== '') secrets[ref] = row.value
  }
  return {
    ...base,
    url: draft.url.trim(),
    ...(Object.keys(headers).length === 0 ? {} : { headers }),
    ...(Object.keys(secrets).length === 0 ? {} : { secrets }),
  }
}

export type McpToggleIssue = 'catalog' | 'url' | 'secretMissing'

export type McpToggleBuild =
  | { readonly ok: true; readonly request: McpUpsertRequest }
  | { readonly ok: false; readonly issue: McpToggleIssue }

/**
 * 行内启停:只翻转 enabled,不重发明文。stdio 省略 env、HTTP 重发占位(复用密文);
 * 没有存量密钥但配了 header 的行拒绝翻转(服务端也会拒,先在客户端说明原因)。
 */
export function buildToggleRequest(item: McpPersonalItem): McpToggleBuild {
  const enabled = !item.enabled
  if (item.transport === 'stdio') {
    if (item.catalogId === null || item.catalogId === '') return { ok: false, issue: 'catalog' }
    return { ok: true, request: { id: item.id, name: item.name, transport: 'stdio', catalogId: item.catalogId, enabled } }
  }
  if (item.url === null || item.url === '') return { ok: false, issue: 'url' }
  if (item.headerNames.length > 0 && !item.hasSecret) return { ok: false, issue: 'secretMissing' }
  const headers: Record<string, string> = {}
  for (const name of item.headerNames) headers[name] = secretPlaceholder(secretRefForHeader(name))
  return {
    ok: true,
    request: {
      id: item.id, name: item.name, transport: 'streamable-http', url: item.url, enabled,
      ...(item.headerNames.length === 0 ? {} : { headers }),
    },
  }
}

export function toggleIssueMessageKey(issue: McpToggleIssue): string {
  switch (issue) {
    case 'catalog': return 'mcp.toggleCatalogMissing'
    case 'url': return 'mcp.toggleUrlMissing'
    case 'secretMissing': return 'mcp.secretMissing'
  }
}

/** 传输方式的展示键。 */
export function transportLabelKey(transport: McpTransportValue): string {
  return transport === 'stdio' ? 'mcp.transportStdio' : 'mcp.transportHttp'
}

/** 「已用 n/limit」模板替换(与项目内 replace('{x}') 口径一致)。 */
export function quotaLabel(template: string, used: number, limit: number): string {
  return template.replace('{used}', String(used)).replace('{limit}', String(limit))
}

export interface McpProbeSummary {
  readonly ok: boolean
  readonly text: string
}

/** probe 结果 → 行内文案(成功带工具数;失败带服务端已脱敏的 reason)。 */
export function probeSummary(
  result: { readonly ok: boolean; readonly toolCount: number; readonly error?: string },
  t: Translate,
): McpProbeSummary {
  if (result.ok) return { ok: true, text: t('mcp.testOk').replace('{count}', String(result.toolCount)) }
  const reason = result.error === undefined || result.error === '' ? t('mcp.unknownError') : result.error
  return { ok: false, text: t('mcp.testFail').replace('{reason}', reason) }
}

// ── 全局服务器编辑器(上游 mcp-manager 命名空间)─────────────────────────

/** 上游 mcp-client 的 serverName 口径(管理器写入门同源)。 */
export const MCP_GLOBAL_NAME_PATTERN = /^[A-Za-z0-9_-]{1,32}$/u
export const MCP_GLOBAL_VALUE_MAX = 8192

/** mcp-manager 的 entries 结构子集(只声明本编辑器读写的字段)。 */
export interface McpGlobalEntry {
  readonly transport: McpTransportValue
  readonly command: string
  readonly args: readonly string[]
  readonly env: Readonly<Record<string, string>>
  readonly cwd: string
  readonly url: string
  readonly headers: Readonly<Record<string, string>>
  readonly enabled: boolean
  readonly toolCallTimeoutMs?: number | undefined
  readonly startupTimeoutMs?: number | undefined
  readonly closeTimeoutMs?: number | undefined
  readonly reconnect?: Readonly<Record<string, unknown>> | undefined
}

export interface McpGlobalConfig {
  readonly servers?: Readonly<Record<string, McpGlobalEntry>> | undefined
}

/** configForms 快照子集(settings 域公开契约)。 */
export interface McpGlobalSnapshot {
  readonly status: 'loading' | 'ready' | 'unavailable'
  readonly value?: McpGlobalConfig | undefined
  readonly base?: unknown
  readonly user?: unknown
  readonly revision?: number | undefined
  readonly writable: boolean
}

/** configForms.mutate 的路径操作子集(`@deepseek-ai/dsh-settings` 结构同形)。 */
export type McpGlobalOp =
  | { readonly op: 'set'; readonly path: readonly string[]; readonly value: unknown }
  | { readonly op: 'unset'; readonly path: readonly string[] }

export interface McpGlobalForm {
  getSnapshot(): McpGlobalSnapshot
  subscribe(listener: () => void): () => void
  mutate(ops: readonly McpGlobalOp[], expectedRevision?: number): Promise<boolean>
}

/** configForms 服务结构子集(access client 只声明 mcp-manager 的 get)。 */
export interface McpConfigForms {
  get(entryId: string): McpGlobalForm
}

/** 表单里的键值行(env / headers 共用)。 */
export interface McpKeyValueDraft {
  readonly name: string
  readonly value: string
}

/** 全局条目表单草稿;name 在编辑态不可改(键即 serverName)。 */
export interface McpGlobalDraft {
  readonly existing: string | null
  readonly name: string
  readonly transport: McpTransportValue
  readonly command: string
  readonly args: string
  readonly cwd: string
  readonly env: readonly McpKeyValueDraft[]
  readonly url: string
  readonly headers: readonly McpKeyValueDraft[]
}

export function draftOfGlobalNew(): McpGlobalDraft {
  return {
    existing: null,
    name: '',
    transport: 'stdio',
    command: '',
    args: '',
    cwd: '',
    env: [],
    url: '',
    headers: [],
  }
}

export function draftOfGlobal(name: string, entry: McpGlobalEntry): McpGlobalDraft {
  return {
    existing: name,
    name,
    transport: entry.transport,
    command: entry.command,
    args: entry.args.join('\n'),
    cwd: entry.cwd,
    env: Object.entries(entry.env).map(([key, value]) => ({ name: key, value })),
    url: entry.url,
    headers: Object.entries(entry.headers).map(([key, value]) => ({ name: key, value })),
  }
}

/** 参数输入:每行一个参数(不经 shell,空格不拆)。 */
export function splitGlobalArgs(text: string): string[] {
  return text.split('\n').map(line => line.trim()).filter(line => line !== '')
}

function keyValueObject(rows: readonly McpKeyValueDraft[]): Record<string, string> {
  const result: Record<string, string> = {}
  for (const row of rows) {
    const name = row.name.trim()
    if (name !== '') result[name] = row.value
  }
  return result
}

export type McpGlobalIssue = 'name' | 'command' | 'url' | 'envName' | 'headerName' | 'valueLength'

const ENV_NAME_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/u
const GLOBAL_HEADER_NAME_PATTERN = /^[A-Za-z0-9!#$%&'*+.^_`|~-]+$/u

function rowIssue(rows: readonly McpKeyValueDraft[], pattern: RegExp): 'envName' | 'headerName' | 'valueLength' | undefined {
  const seen = new Set<string>()
  for (const row of rows) {
    const name = row.name.trim()
    if (!pattern.test(name)) return pattern === ENV_NAME_PATTERN ? 'envName' : 'headerName'
    const folded = name.toLowerCase()
    if (seen.has(folded)) return pattern === ENV_NAME_PATTERN ? 'envName' : 'headerName'
    seen.add(folded)
    if (row.value.length > MCP_GLOBAL_VALUE_MAX) return 'valueLength'
  }
  return undefined
}

export function globalDraftIssue(draft: McpGlobalDraft): McpGlobalIssue | undefined {
  if (draft.existing === null && !MCP_GLOBAL_NAME_PATTERN.test(draft.name.trim())) return 'name'
  if (draft.transport === 'stdio') {
    if (draft.command.trim() === '') return 'command'
    return rowIssue(draft.env, ENV_NAME_PATTERN)
  }
  if (!isAcceptableHttpUrl(draft.url)) return 'url'
  return rowIssue(draft.headers, GLOBAL_HEADER_NAME_PATTERN)
}

export function globalIssueMessageKey(issue: McpGlobalIssue): string {
  switch (issue) {
    case 'name': return 'mcp.globalNameInvalid'
    case 'command': return 'mcp.globalCommandRequired'
    case 'url': return 'mcp.globalUrlInvalid'
    case 'envName': return 'mcp.globalEnvInvalid'
    case 'headerName': return 'mcp.globalHeaderInvalid'
    case 'valueLength': return 'mcp.globalValueTooLong'
  }
}

/**
 * 草稿 → 完整 entry。保留原条目的高级字段(timeout/reconnect);
 * 互斥字段按 transport 清空——上游 validateEntries 对跨传输残留是硬拒。
 */
export function buildGlobalEntry(draft: McpGlobalDraft, original: McpGlobalEntry | undefined): McpGlobalEntry {
  const stdio = draft.transport === 'stdio'
  const base: McpGlobalEntry = original ?? {
    transport: 'stdio',
    command: '',
    args: [],
    env: {},
    cwd: '',
    url: '',
    headers: {},
    enabled: true,
    startupTimeoutMs: 30_000,
    reconnect: { enabled: true, initialDelayMs: 500, maxDelayMs: 30_000, maxAttempts: 10 },
  }
  return {
    ...base,
    transport: draft.transport,
    enabled: original?.enabled ?? true,
    command: stdio ? draft.command.trim() : '',
    args: stdio ? splitGlobalArgs(draft.args) : [],
    env: stdio ? keyValueObject(draft.env) : {},
    cwd: stdio ? draft.cwd.trim() : '',
    url: stdio ? '' : draft.url.trim(),
    headers: stdio ? {} : keyValueObject(draft.headers),
  }
}

/** 保存操作:新增/编辑都整条 set(编辑保留高级字段)。 */
export function globalSaveOps(draft: McpGlobalDraft, original: McpGlobalEntry | undefined): readonly McpGlobalOp[] {
  return [{ op: 'set', path: ['servers', draft.name.trim()], value: buildGlobalEntry(draft, original) }]
}

/** 启停只写 enabled 子路径:不把继承项整条复制进用户层。 */
export function globalToggleOps(name: string, enabled: boolean): readonly McpGlobalOp[] {
  return [{ op: 'set', path: ['servers', name, 'enabled'], value: enabled }]
}

/** 删除/恢复统一走 unset;部署层条目 unset 后回落到基座。 */
export function globalUnsetOps(name: string): readonly McpGlobalOp[] {
  return [{ op: 'unset', path: ['servers', name] }]
}

/** 读 raw 层里某 server 的覆盖标记(user 层出现即覆盖,不论值是否等于基线)。 */
export function hasUserServer(user: unknown, name: string): boolean {
  if (typeof user !== 'object' || user === null) return false
  const servers = (user as { servers?: unknown }).servers
  if (typeof servers !== 'object' || servers === null) return false
  return Object.prototype.hasOwnProperty.call(servers, name)
}

/** base 层是否提供同名条目(部署配置=不可删除,只能停用)。 */
export function hasBaseServer(base: unknown, name: string): boolean {
  if (typeof base !== 'object' || base === null) return false
  const servers = (base as { servers?: unknown }).servers
  if (typeof servers !== 'object' || servers === null) return false
  return Object.prototype.hasOwnProperty.call(servers, name)
}
