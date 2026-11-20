/**
 * 路由核心(纯函数):计划书 §4.0 端点表全量实现。
 * 门禁顺序:变更类请求先过同源闸(CSRF)与全局限速;登录额外过 ip+账号 窗;
 * 会话校验含 pwv 比对(改密即全端下线);敏感操作全部出审计事件(含失败登录)。
 */
import { join } from 'node:path'
import type { AccessAuditEvent } from './audit.ts'
import {
  clientIp, errorReply, htmlResponse, isSameOrigin, jsonResponse, parseAvatarDataUrl, parseJsonBody,
  redirectReply, requestOrigin, type AccessReply, type AccessRequest,
} from './http.ts'
import { companionGuideUrl, companionTokenOf, resetCompanionToken } from './companion.ts'
import type { ToolApprovalView } from './approval-bridge.ts'
import type { UserQuestionView } from './question-bridge.ts'
import { PasswordPolicyError } from './password.ts'
import { renderLoginPage } from './pages.ts'
import { SlidingWindow } from './ratelimit.ts'
import { SessionService } from './session.ts'
import {
  LastAdminError, NicknamePolicyError, OldPasswordMismatchError, SelfDeleteError, SuffixExhaustedError,
  UserNotFoundError, UserStore, type UserRow, type UserRole,
} from './store.ts'

export interface AccessDeps {
  readonly store: UserStore
  readonly session: SessionService
  /** 登录窗:每 ip+账号 5/min。 */
  readonly loginWindow: SlidingWindow
  /** 全局窗:每 ip 变更类请求 30/min。 */
  readonly globalWindow: SlidingWindow
  audit(event: AccessAuditEvent): void
  /** 登录成功桥接目标(请求侧 origin 经 dsh authenticatedUrl 附 launch token)。 */
  bridgeHome(origin: string): string
  /** 声明的公网根(ETERNA_PUBLIC_URL)——反代形态的同源信任候选;空=仅 Host 形态。 */
  readonly publicOrigin?: string | undefined
  /** 数据目录(users.db/secret.key/disabled-plugins.json 所在;T2.3 启停清单落此)。 */
  readonly dataDir: string
  /**
   * 登录成功后的租户开通(问题4:新用户自动在 workspaces/<account> 建根工作区)。
   * 实现方自吞异常(开通失败不阻断登录;客户端引导还有 session/create 改判兜底)。
   */
  readonly provisionWorkspace: (user: { readonly id: number; readonly account: string }) => Promise<void>
  /** companion 中继公网 ws 地址(ETERNA_RELAY_PUBLIC_URL;缺省=指引页按本机端口展示)。 */
  readonly relayPublicWsUrl?: string | undefined
  /** 工具审批桥(2026-11-13):治理 ask 的 web 可见面;未装配=端点返回空表。 */
  readonly approvalBridge?: {
    listFor(ownerId: number): ToolApprovalView[]
    decide(id: string, userId: number, allow: boolean): boolean
  } | undefined
  /** 提问桥(2026-11-17):ask_user_question 在多租户下不可达的 web 可见面;
   *  未装配=端点返回空表。 */
  readonly questionBridge?: {
    listFor(ownerId: number): UserQuestionView[]
    answer(id: string, userId: number, body: { readonly answers?: unknown; readonly skip?: boolean }):
      | { readonly ok: true }
      | { readonly ok: false; readonly reason: string; readonly status: 404 | 400 }
  } | undefined
  /**
   * tasks 设置面(2026-11-19 任务设置分区;反射键 'tasks' 的 settingsFace 结构面):
   * 每次请求现读,任务插件未装载/未就绪返回 undefined → 端点 503(fail-closed)。
   * access 为 Tier1,不 import @eterna/tasks——结构面声明在本文件(panel/stream 同纪律)。
   */
  readonly tasksSettings?: (() => TasksSettingsFace | undefined) | undefined
  /**
   * 登出回调(2026-11-20 B14 个人 MCP):会话 cookie 清除前摘除该用户 live scope。
   * 同步签名,实现方自吞异常(登出不能被资源回收失败阻断)。
   */
  readonly onLogout?: ((user: { readonly id: number; readonly account: string }) => void) | undefined
}

/** tasks 设置视图(结构面;载荷整体 JSON 序列化,access 不解释领域字段)。 */
export interface TasksSettingsView {
  readonly realm: string
  readonly masterId: string | undefined
  readonly masterTitle: string
  readonly paused: boolean
  readonly policyVersion: string
  readonly settings: unknown
  readonly revisions: Readonly<Record<string, number>>
  readonly workerSessionIds: readonly string[]
  readonly health: unknown
  readonly stats: unknown
}

/** 会话角色面(徽标数据源;登录用户可见,只暴露角色判定所需 id)。 */
export interface TasksSessionRolesView {
  readonly masterId: string | undefined
  readonly masterTitle: string
  readonly workerSessionIds: readonly string[]
}

/** 分块保存结果(tasks 侧 union 原样;conflict/invalid 为预期业务失败)。 */
export type TasksSettingsSaveResult =
  | {
    readonly ok: true
    readonly saved: boolean
    readonly changed: boolean
    readonly revision: number
    readonly policyVersion: string
    readonly settings: unknown
  }
  | { readonly ok: false; readonly code: 'conflict' | 'invalid'; readonly message: string }

/** tasks 设置面(tasks World.settingsFace 的结构子集;三键齐备才算就绪)。 */
export interface TasksSettingsFace {
  read(): TasksSettingsView
  roles(): TasksSessionRolesView
  save(block: string, value: unknown, revision: number): TasksSettingsSaveResult
}

/** T2.3 插件启停清单:红线(治理/审计/出网/门禁本体)不可停,其余 L1 可由 admin 停用。 */
export const RED_LINE_PLUGINS: ReadonlySet<string> = new Set([
  'eterna-governance', 'eterna-audit', 'eterna-egress', 'eterna-access',
])

export const TOGGLEABLE_PLUGINS: ReadonlyArray<{ id: string; label: string }> = [
  { id: 'eterna-memory', label: '记忆' },
  { id: 'eterna-knowledge', label: '知识底座' },
  { id: 'eterna-llm-doctor', label: '模型诊断' },
  { id: 'eterna-brand', label: '品牌层' },
  { id: 'eterna-panel', label: '基座面板' },
  { id: 'eterna-attachments', label: '附件入口' },
  { id: 'eterna-prompt-studio', label: '提示词工作室' },
  { id: 'eterna-usage-stats', label: '用量统计' },
]

export function handleAccessRequest(deps: AccessDeps, req: AccessRequest): AccessReply {
  const method = req.method.toUpperCase()
  const ip = clientIp(req.xff)
  const mutating = method === 'POST' || method === 'DELETE'
  if (mutating && !isSameOrigin(req.origin, req.host, deps.session.secure, deps.publicOrigin)) return errorReply(403, '跨源请求被拒绝')
  if (mutating && !deps.globalWindow.hit(ip)) return errorReply(429, '请求过于频繁，请稍后再试')

  switch (req.pathname) {
    case '/login':
      return handleLogin(deps, req, method, ip)
    case '/logout':
      return handleLogout(deps, req, method, ip)
    case '/account':
      // 账号自助=应用内设置弹窗账号分区(铁律:不建独立页面;/account 曾是 404 白屏)。
      return redirectReply('/')
    default:
      break
  }
  if (req.pathname === '/access/api/me' && method === 'GET') {
    const user = currentUser(deps, req)
    return user === undefined ? errorReply(401, '未登录') : jsonResponse(200, meView(deps, user))
  }
  if (req.pathname === '/access/api/nickname' && method === 'POST') return handleNickname(deps, req, ip)
  if (req.pathname === '/access/api/password' && method === 'POST') return handlePassword(deps, req, ip)
  if (req.pathname === '/access/api/avatar' && method === 'POST') return handleAvatarSet(deps, req, ip)
  if (req.pathname === '/access/api/avatar' && method === 'DELETE') return handleAvatarReset(deps, req, ip)
  if (req.pathname.startsWith('/access/api/avatar/') && method === 'GET') return handleAvatarGet(deps, req)
  if (req.pathname === '/access/api/users' && method === 'GET') return handleUserList(deps, req)
  if (req.pathname === '/access/api/users' && method === 'POST') return handleUserCreate(deps, req, ip)
  if (req.pathname.startsWith('/access/api/users/') && req.pathname.endsWith('/role') && method === 'POST') {
    return handleUserRoleSet(deps, req, ip)
  }
  if (req.pathname.startsWith('/access/api/users/') && method === 'DELETE') return handleUserDelete(deps, req, ip)
  if (req.pathname === '/access/api/companion' && method === 'GET') return handleCompanionView(deps, req)
  if (req.pathname === '/access/api/companion/reset' && method === 'POST') return handleCompanionReset(deps, req, ip)
  if (req.pathname === '/access/api/approvals/tool-pending' && method === 'GET') return handleToolApprovalsPending(deps, req)
  if (req.pathname === '/access/api/approvals/tool-decide' && method === 'POST') return handleToolApprovalDecide(deps, req)
  if (req.pathname === '/access/api/questions/pending' && method === 'GET') return handleQuestionsPending(deps, req)
  if (req.pathname === '/access/api/questions/answer' && method === 'POST') return handleQuestionAnswer(deps, req)
  if (req.pathname === '/access/api/plugins' && method === 'GET') return handlePluginList(deps, req)
  if (req.pathname.startsWith('/access/api/plugins/') && req.pathname.endsWith('/remove') && method === 'POST') {
    return handlePluginRemove(deps, req, ip)
  }
  if (req.pathname.startsWith('/access/api/plugins/') && method === 'POST') return handlePluginToggle(deps, req, ip)
  // 任务设置分区(2026-11-19):角色面登录可见(会话头徽标);设置读写仅 admin。
  if (req.pathname === '/access/api/tasks/session-roles' && method === 'GET') return handleTasksSessionRoles(deps, req)
  if (req.pathname === '/access/api/tasks/settings' && method === 'GET') return handleTasksSettingsView(deps, req)
  if (req.pathname === '/access/api/tasks/settings' && method === 'POST') return handleTasksSettingsSave(deps, req, ip)
  return errorReply(404, 'not found')
}

/** companion 浏览器执行面:当前用户的令牌视图(未生成=null;不含他人令牌)。 */
function handleCompanionView(deps: AccessDeps, req: AccessRequest): AccessReply {
  const user = requireUser(deps, req)
  if (user === undefined) return errorReply(401, '未登录')
  const entry = companionTokenOf(deps.dataDir, user.id)
  return jsonResponse(200, {
    token: entry?.token ?? null,
    createdAt: entry?.createdAt ?? null,
    guideUrl: companionGuideUrl(deps.relayPublicWsUrl),
  })
}

// ── 工具审批桥(web 可见面,2026-11-13)────────────────────────────────
// GET tool-pending:本人待决审批(web 前端轮询);POST tool-decide:本人裁决。
// 归属校验在 bridge.decide/listFor 内(跨用户不可见不可决);审计在桥内出。

function handleToolApprovalsPending(deps: AccessDeps, req: AccessRequest): AccessReply {
  const user = requireUser(deps, req)
  if (user === undefined) return errorReply(401, '未登录')
  return jsonResponse(200, { items: deps.approvalBridge?.listFor(user.id) ?? [] })
}

function handleToolApprovalDecide(deps: AccessDeps, req: AccessRequest): AccessReply {
  const user = requireUser(deps, req)
  if (user === undefined) return errorReply(401, '未登录')
  const body = parseJsonBody(req.body) as { id?: unknown; allow?: unknown } | undefined
  const id = typeof body?.id === 'string' ? body.id : ''
  if (id === '' || typeof body?.allow !== 'boolean') return errorReply(400, '参数不合法')
  const decided = deps.approvalBridge?.decide(id, user.id, body.allow) ?? false
  if (!decided) return errorReply(404, '审批不存在、已收场或不属于你')
  return jsonResponse(200, { ok: true })
}

// ── 提问桥(web 可见面,2026-11-17)────────────────────────────────────
// GET questions/pending:本人待答提问(web 前端轮询);POST questions/answer:
// 本人提交答案批或整卡跳过。归属校验在桥内(跨用户不可见不可答);审计在桥内出。

function handleQuestionsPending(deps: AccessDeps, req: AccessRequest): AccessReply {
  const user = requireUser(deps, req)
  if (user === undefined) return errorReply(401, '未登录')
  return jsonResponse(200, { items: deps.questionBridge?.listFor(user.id) ?? [] })
}

function handleQuestionAnswer(deps: AccessDeps, req: AccessRequest): AccessReply {
  const user = requireUser(deps, req)
  if (user === undefined) return errorReply(401, '未登录')
  const body = parseJsonBody(req.body) as { id?: unknown; answers?: unknown; skip?: unknown } | undefined
  const id = typeof body?.id === 'string' ? body.id : ''
  if (id === '') return errorReply(400, '参数不合法')
  const bridge = deps.questionBridge
  if (bridge === undefined) return errorReply(404, '提问不存在、已结束或不属于你')
  const result = bridge.answer(id, user.id, {
    answers: body?.answers,
    ...(body?.skip === true ? { skip: true } : {}),
  })
  if (!result.ok) return errorReply(result.status, result.reason)
  return jsonResponse(200, { ok: true })
}

// ── 任务设置分区(2026-11-19 会话级 super 标记 + 任务设置分区)──────────────
// 数据面归 tasks(ctx.tasks.settingsFace,经 deps 注入的反射解析器现读);路由面独占
// 归 access(铁律 T2)。save 的 CAS/版本/policyChanged 语义全在 tasks saveSettingsBlock,
// 本层只做身份、参数与 HTTP 映射(conflict→409、invalid→400、内核缺席→503)。
// no-store:设置视图含实时修订与计数,缓存即误判 CAS 基准(AGENTS 交互纪律)。

/** tasks 设置块白名单(pause + 固定六块 + 来源实例块;与 tasks SettingsSave 同域)。 */
const TASKS_SETTINGS_BLOCK = /^(?:pause|policy|eval|executor|budget|gates|source:[a-z][a-z0-9-]*)$/u

/** 角色面(登录即可):会话头徽标判定主控/执行;只回 id 与标题,不含设置内容。 */
function handleTasksSessionRoles(deps: AccessDeps, req: AccessRequest): AccessReply {
  const user = requireUser(deps, req)
  if (user === undefined) return errorReply(401, '未登录')
  const face = deps.tasksSettings?.()
  if (face === undefined) return errorReply(503, '任务内核未就绪')
  return jsonResponse(200, { ok: true, ...face.roles() }, [['cache-control', 'no-store']])
}

/** 设置视图(admin;设置分区「任务与超级智能体」读面)。 */
function handleTasksSettingsView(deps: AccessDeps, req: AccessRequest): AccessReply {
  const user = requireUser(deps, req)
  if (user === undefined) return errorReply(401, '未登录')
  if (user.role !== 'admin') return errorReply(403, '需要管理员权限')
  const face = deps.tasksSettings?.()
  if (face === undefined) return errorReply(503, '任务内核未就绪')
  return jsonResponse(200, { ok: true, ...face.read() }, [['cache-control', 'no-store']])
}

/** 分块保存(admin):参数 → face.save → 409/400 映射;审计只记块与结果(不记设置值)。 */
function handleTasksSettingsSave(deps: AccessDeps, req: AccessRequest, ip: string): AccessReply {
  const user = requireUser(deps, req)
  if (user === undefined) return errorReply(401, '未登录')
  if (user.role !== 'admin') return errorReply(403, '需要管理员权限')
  const body = parseJsonBody(req.body)
  if (body === undefined) return errorReply(400, '参数不合法：block/revision/value 缺一不可')
  const block = typeof body.block === 'string' ? body.block : ''
  const revisionValue = body.revision
  const revision = typeof revisionValue === 'number' && Number.isInteger(revisionValue) ? revisionValue : -1
  if (block === '' || !TASKS_SETTINGS_BLOCK.test(block) || revision < 0 || !('value' in body)) {
    return errorReply(400, '参数不合法：block/revision/value 缺一不可')
  }
  const face = deps.tasksSettings?.()
  if (face === undefined) return errorReply(503, '任务内核未就绪')
  const result = face.save(block, body.value, revision)
  if (!result.ok) {
    deps.audit({ kind: 'access.tasks.settings', account: user.account, ip, ok: false, detail: { block, code: result.code } })
    return errorReply(result.code === 'conflict' ? 409 : 400, result.message)
  }
  deps.audit({ kind: 'access.tasks.settings', account: user.account, ip, ok: true,
    detail: { block, saved: result.saved, changed: result.changed } })
  return jsonResponse(200, {
    ok: true,
    saved: result.saved,
    changed: result.changed,
    revision: result.revision,
    policyVersion: result.policyVersion,
    settings: result.settings,
  }, [['cache-control', 'no-store']])
}

/** companion 令牌生成/重置(覆盖旧值即刻失效);审计只记动作不记令牌值。 */
function handleCompanionReset(deps: AccessDeps, req: AccessRequest, ip: string): AccessReply {
  const user = requireUser(deps, req)
  if (user === undefined) return errorReply(401, '未登录')
  const entry = resetCompanionToken(deps.dataDir, user.id)
  deps.audit({ kind: 'access.companion.token', account: user.account, ip, detail: { action: 'reset' } })
  return jsonResponse(200, { ok: true, token: entry.token, createdAt: entry.createdAt, guideUrl: companionGuideUrl(deps.relayPublicWsUrl) })
}

/** 插件启停清单(admin):含红线标记;停用重启后生效(entrypoint 渲染管线裁剪 patch 行)。 */
function handlePluginList(deps: AccessDeps, req: AccessRequest): AccessReply {
  const admin = requireUser(deps, req)
  if (admin === undefined) return errorReply(401, '未登录')
  if (admin.role !== 'admin') return errorReply(403, '需要管理员权限')
  const plugins = [
    ...[...RED_LINE_PLUGINS].map(id => ({ id, label: id, redLine: true, disabled: false, removed: false })),
    ...TOGGLEABLE_PLUGINS.map((p) => {
      const removed = deps.store.isPluginRemoved(p.id)
      return { ...p, redLine: false, disabled: deps.store.isPluginDisabled(p.id) || removed, removed }
    }),
  ]
  return jsonResponse(200, { plugins })
}

function handlePluginToggle(deps: AccessDeps, req: AccessRequest, ip: string): AccessReply {
  const admin = requireUser(deps, req)
  if (admin === undefined) return errorReply(401, '未登录')
  if (admin.role !== 'admin') return errorReply(403, '需要管理员权限')
  const path = req.pathname.slice('/access/api/plugins/'.length)
  const slash = path.lastIndexOf('/')
  if (slash <= 0) return errorReply(404, 'not found')
  const id = path.slice(0, slash)
  const action = path.slice(slash + 1)
  if (action !== 'disable' && action !== 'enable') return errorReply(404, 'not found')
  if (!TOGGLEABLE_PLUGINS.some(p => p.id === id) || RED_LINE_PLUGINS.has(id)) {
    return errorReply(400, '该插件不可停用(红线或未收录)')
  }
  if (action === 'disable') deps.store.disablePlugin(id)
  else {
    if (deps.store.isPluginRemoved(id)) {
      deps.store.enablePlugin(id)
      deps.store.saveRemovedPlugins(join(deps.dataDir, 'removed-plugins.json'))
    }
    deps.store.enablePlugin(id)
  }
  deps.store.saveDisabledPlugins(join(deps.dataDir, 'disabled-plugins.json'))
  deps.audit({ kind: 'access.plugin.toggle', account: admin.account, ip, detail: { plugin: id, action } })
  return jsonResponse(200, { ok: true, plugin: id, disabled: action === 'disable', effectiveAfterRestart: true })
}

/** 删除(admin,永久卸载语义):写 removed 清单;重启后 entrypoint 裁剪 patch 行。 */
function handlePluginRemove(deps: AccessDeps, req: AccessRequest, ip: string): AccessReply {
  const admin = requireUser(deps, req)
  if (admin === undefined) return errorReply(401, '未登录')
  if (admin.role !== 'admin') return errorReply(403, '需要管理员权限')
  const id = req.pathname.slice('/access/api/plugins/'.length).replace(/\/remove$/, '')
  if (!TOGGLEABLE_PLUGINS.some(p => p.id === id) || RED_LINE_PLUGINS.has(id)) {
    return errorReply(400, '该插件不可删除(红线或未收录)')
  }
  const removed = deps.store.removePlugin(id)
  deps.store.saveDisabledPlugins(join(deps.dataDir, 'disabled-plugins.json'))
  deps.store.saveRemovedPlugins(join(deps.dataDir, 'removed-plugins.json'))
  deps.audit({ kind: 'access.plugin.remove', account: admin.account, ip, detail: { plugin: id, removed } })
  return jsonResponse(200, { ok: true, plugin: id, removed: true, effectiveAfterRestart: true })
}

function currentUser(deps: AccessDeps, req: AccessRequest): UserRow | undefined {
  const claims = deps.session.resolveUser(req.cookie)
  if (claims === undefined) return undefined
  const pwv = deps.store.getPasswordVersion(claims.userId)
  if (pwv === undefined || pwv !== claims.passwordVersion) return undefined
  return deps.store.getUserById(claims.userId)
}

function meView(deps: AccessDeps, user: UserRow): Record<string, unknown> {
  const hasAvatar = deps.store.getAvatar(user.id) !== undefined
  return {
    id: user.id,
    account: user.account,
    nickname: user.nickname,
    role: user.role,
    avatarUrl: hasAvatar ? `/access/api/avatar/${user.id}` : null,
  }
}

function publicView(user: UserRow): Record<string, unknown> {
  return { id: user.id, account: user.account, nickname: user.nickname, role: user.role }
}

function methodNotAllowed(): AccessReply {
  return errorReply(405, 'method not allowed')
}

function requireUser(deps: AccessDeps, req: AccessRequest): UserRow | undefined {
  return currentUser(deps, req)
}

function handleLogin(deps: AccessDeps, req: AccessRequest, method: string, ip: string): AccessReply {
  if (method === 'GET') {
    const user = requireUser(deps, req)
    if (user === undefined) return htmlResponse(200, renderLoginPage())
    return redirectReply(deps.bridgeHome(deps.publicOrigin ?? requestOrigin(req.host, deps.session.secure)))
  }
  if (method !== 'POST') return methodNotAllowed()
  const parsed = parseLoginBody(req.body)
  const account = typeof parsed.account === 'string' ? parsed.account : ''
  const password = typeof parsed.password === 'string' ? parsed.password : ''
  if (!deps.loginWindow.hit(`${ip}:${account}`)) return errorReply(429, '登录尝试过于频繁，请稍后再试')
  if (account === '' || password === '') return errorReply(400, '请输入账号与密码')
  const user = deps.store.verifyLogin(account, password)
  if (user === null) {
    deps.audit({ kind: 'access.login', account, ip, ok: false })
    return errorReply(401, '账号或密码不正确')
  }
  const token = deps.session.issue({ userId: user.id, passwordVersion: user.passwordVersion })
  deps.audit({ kind: 'access.login', account: user.account, ip, ok: true })
  // 登录即开通(问题4):零工作区用户自动建根工作区;异步不阻断登录应答
  // (契约:实现方自吞异常;此处再兜一层防 unhandled rejection)
  deps.provisionWorkspace(user).catch(() => {})
  // 桥接目标规范根:PUBLIC_URL 声明优先(浏览器入口唯一权威),无声明回退请求侧 origin
  const origin = deps.publicOrigin ?? requestOrigin(req.host, deps.session.secure)
  const redirect = deps.bridgeHome(origin)
  const cookie = deps.session.setCookieHeader(token)
  // JSON 提交(页面 fetch)→200+redirect,由页面做顶层导航:不让 fetch 追 302 重定向链
  // (反代/h2 环境下重定向链是「网络错误」的高发面);表单提交保持传统 302。
  if (req.contentType?.includes('application/json') === true) {
    return jsonResponse(200, { ok: true, redirect }, [['set-cookie', cookie]])
  }
  return redirectReply(redirect, [['set-cookie', cookie]])
}

/** 兼容 JSON 与表单两种登录编码(页面走 JSON,脚本/表单客户端两者皆可)。 */
function parseLoginBody(body: Uint8Array | undefined): Record<string, unknown> {
  const json = parseJsonBody(body)
  if (json !== undefined) return json
  if (body === undefined || body.length === 0) return {}
  try {
    const params = new URLSearchParams(new TextDecoder().decode(body))
    return { account: params.get('account'), password: params.get('password') }
  } catch {
    return {}
  }
}

function handleLogout(deps: AccessDeps, req: AccessRequest, method: string, ip: string): AccessReply {
  if (method !== 'POST') return methodNotAllowed()
  const user = requireUser(deps, req)
  if (user !== undefined) {
    deps.audit({ kind: 'access.logout', account: user.account, ip })
    // B14:登出即摘该用户个人 MCP live scope(失败不影响登出;回调实现方自吞)。
    try {
      deps.onLogout?.({ id: user.id, account: user.account })
    } catch {
      // 登出语义优先:资源回收失败留给 disposer/agent-disposed 兜底。
    }
  }
  return redirectReply('/login', [['set-cookie', deps.session.clearCookieHeader()]])
}

function handleNickname(deps: AccessDeps, req: AccessRequest, ip: string): AccessReply {
  const user = requireUser(deps, req)
  if (user === undefined) return errorReply(401, '未登录')
  const nickname = parseJsonBody(req.body)?.nickname
  if (typeof nickname !== 'string' || nickname.trim() === '') return errorReply(400, '昵称不能为空')
  try {
    deps.store.setNickname(user.id, nickname)
  } catch (error) {
    return storeErrorToReply(error)
  }
  deps.audit({ kind: 'access.profile.change', account: user.account, ip, detail: { field: 'nickname' } })
  return jsonResponse(200, { ok: true, nickname })
}

function handlePassword(deps: AccessDeps, req: AccessRequest, ip: string): AccessReply {
  const user = requireUser(deps, req)
  if (user === undefined) return errorReply(401, '未登录')
  const body = parseJsonBody(req.body)
  const oldPassword = body?.oldPassword
  const newPassword = body?.newPassword
  if (typeof oldPassword !== 'string' || typeof newPassword !== 'string') {
    return errorReply(400, '请输入旧密码与新密码')
  }
  try {
    deps.store.setPassword(user.id, oldPassword, newPassword)
  } catch (error) {
    return storeErrorToReply(error)
  }
  const pwv = deps.store.getPasswordVersion(user.id) ?? 1
  const token = deps.session.issue({ userId: user.id, passwordVersion: pwv })
  deps.audit({ kind: 'access.password.change', account: user.account, ip })
  return jsonResponse(200, { ok: true }, [['set-cookie', deps.session.setCookieHeader(token)]])
}

function handleAvatarSet(deps: AccessDeps, req: AccessRequest, ip: string): AccessReply {
  const user = requireUser(deps, req)
  if (user === undefined) return errorReply(401, '未登录')
  const dataUrl = parseJsonBody(req.body)?.dataUrl
  if (typeof dataUrl !== 'string') return errorReply(400, '缺少头像数据')
  const avatar = parseAvatarDataUrl(dataUrl)
  if (avatar === undefined) return errorReply(400, '头像仅支持 png/jpeg/webp/gif，且不超过 256KB')
  deps.store.setAvatar(user.id, avatar.data, avatar.mime)
  deps.audit({ kind: 'access.avatar.change', account: user.account, ip })
  return jsonResponse(200, { ok: true, avatarUrl: `/access/api/avatar/${user.id}` })
}

function handleAvatarReset(deps: AccessDeps, req: AccessRequest, ip: string): AccessReply {
  const user = requireUser(deps, req)
  if (user === undefined) return errorReply(401, '未登录')
  deps.store.setAvatar(user.id, null, null)
  deps.audit({ kind: 'access.avatar.reset', account: user.account, ip })
  return jsonResponse(200, { ok: true })
}

function handleAvatarGet(deps: AccessDeps, req: AccessRequest): AccessReply {
  const user = requireUser(deps, req)
  if (user === undefined) return errorReply(401, '未登录')
  const id = Number(req.pathname.slice('/access/api/avatar/'.length))
  if (!Number.isInteger(id) || id <= 0) return errorReply(404, 'not found')
  const avatar = deps.store.getAvatar(id)
  if (avatar === undefined) return errorReply(404, 'not found')
  return {
    status: 200,
    headers: [
      ['content-type', avatar.mime],
      ['cache-control', 'private, max-age=300'],
      ['x-content-type-options', 'nosniff'],
    ],
    body: avatar.data,
  }
}

function handleUserList(deps: AccessDeps, req: AccessRequest): AccessReply {
  const admin = requireUser(deps, req)
  if (admin === undefined) return errorReply(401, '未登录')
  if (admin.role !== 'admin') return errorReply(403, '需要管理员权限')
  return jsonResponse(200, { users: deps.store.listUsers() })
}

function handleUserCreate(deps: AccessDeps, req: AccessRequest, ip: string): AccessReply {
  const admin = requireUser(deps, req)
  if (admin === undefined) return errorReply(401, '未登录')
  if (admin.role !== 'admin') return errorReply(403, '需要管理员权限')
  const body = parseJsonBody(req.body)
  const account = typeof body?.account === 'string' ? body.account : ''
  const password = typeof body?.password === 'string' ? body.password : ''
  const roleRaw = body?.role
  if (account === '' || password === '') return errorReply(400, '请输入账号与密码')
  let role: UserRole = 'user'
  if (roleRaw !== undefined && roleRaw !== null) {
    if (roleRaw !== 'admin' && roleRaw !== 'approver' && roleRaw !== 'user') return errorReply(400, '角色仅支持 admin/approver/user')
    role = roleRaw
  }
  let created: UserRow
  let finalAccount: string
  try {
    const result = deps.store.createUserWithSuffix({ account, password, role })
    created = result.user
    finalAccount = result.finalAccount
  } catch (error) {
    return storeErrorToReply(error)
  }
  deps.audit({
    kind: 'access.user.add',
    account: finalAccount,
    ip,
    detail: role === 'admin' ? { role: 'admin', requested: account } : { requested: account },
  })
  return jsonResponse(201, { user: publicView(created), finalAccount })
}

function handleUserDelete(deps: AccessDeps, req: AccessRequest, ip: string): AccessReply {
  const admin = requireUser(deps, req)
  if (admin === undefined) return errorReply(401, '未登录')
  if (admin.role !== 'admin') return errorReply(403, '需要管理员权限')
  const id = Number(req.pathname.slice('/access/api/users/'.length))
  if (!Number.isInteger(id) || id <= 0) return errorReply(404, 'not found')
  const target = deps.store.getUserById(id)
  if (target === undefined) return errorReply(404, '用户不存在')
  try {
    deps.store.deleteUser(id, admin.id)
  } catch (error) {
    return storeErrorToReply(error)
  }
  deps.audit({ kind: 'access.user.delete', account: target.account, ip })
  return jsonResponse(200, { ok: true })
}

/**
 * M-3(37 号 §3)角色变更端点(G2-C5:分配/收回审批人角色)。
 * - admin-only(沿 handleUserCreate 判定);
 * - body 值域仅 {'approver','user'}——G2-C5 只拍板「分配/收回审批人」;admin 角色在线
 *   变更无拍板依据不扩(§7 缺口 7),目标现为 admin 的一并拒(变更仍走建号/删号);
 * - actor==target 返 400:§7 缺口 10 自设护栏(沿 SelfDeleteError 自操作护栏精神的
 *   类推,设计文档之外新增的限制性行为,方向 fail-closed,去留待评审——放开则删此判);
 * - 审计 kind 'access.user.role':account=操作者,detail={target,from,to}——
 *   actor=account 字段、时间=audit 侧时间戳、对象=detail.target(沿 access.user.add 先例);
 * - mux 即时生效由 bindings 回调动态读角色承担(37 号 M-2;TS-37-1 已核实上游无缓存)。
 */
function handleUserRoleSet(deps: AccessDeps, req: AccessRequest, ip: string): AccessReply {
  const admin = requireUser(deps, req)
  if (admin === undefined) return errorReply(401, '未登录')
  if (admin.role !== 'admin') return errorReply(403, '需要管理员权限')
  const id = Number(req.pathname.slice('/access/api/users/'.length, req.pathname.length - '/role'.length))
  if (!Number.isInteger(id) || id <= 0) return errorReply(404, 'not found')
  const body = parseJsonBody(req.body)
  const roleRaw = body?.role
  if (roleRaw !== 'approver' && roleRaw !== 'user') return errorReply(400, '角色仅支持 approver/user')
  const target = deps.store.getUserById(id)
  if (target === undefined) return errorReply(404, '用户不存在')
  if (target.id === admin.id) return errorReply(400, '不能修改自己的角色')
  if (target.role === 'admin') return errorReply(400, '管理员角色不可在线变更')
  deps.store.setUserRole(id, roleRaw)
  deps.audit({
    kind: 'access.user.role',
    account: admin.account,
    ip,
    detail: { target: target.account, from: target.role, to: roleRaw },
  })
  const updated = deps.store.getUserById(id) ?? target
  return jsonResponse(200, { ok: true, user: publicView(updated) })
}

function storeErrorToReply(error: unknown): AccessReply {
  if (error instanceof PasswordPolicyError) return errorReply(400, error.message)
  if (error instanceof NicknamePolicyError) return errorReply(400, error.message)
  if (error instanceof OldPasswordMismatchError) return errorReply(400, error.message)
  if (error instanceof SelfDeleteError) return errorReply(400, error.message)
  if (error instanceof LastAdminError) return errorReply(400, error.message)
  if (error instanceof SuffixExhaustedError) return errorReply(400, error.message)
  if (error instanceof UserNotFoundError) return errorReply(404, error.message)
  throw error
}
