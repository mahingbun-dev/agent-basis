/**
 * P4-T6/T7(2026-11-11):双层插件空间——个人层记账端点+审批流+转内置。
 *
 * 架构(隔离计划 §6.4-6.5,落地形态):
 * - 公共层=现有 bundle/profile patch/TOGGLEABLE(现状不动);
 * - 个人层=$DSH_HOME/workspaces/<账号>/plugins/<plugin-dir>(DSH_HOME 语义 T1 铁律),
 *   记账=user_plugins 表(激活清单,运行时合并不复制);
 * - 命名强制 user:<account>:<name>(禁 shadow 公共 id,MCP 整体替换陷阱);
 * - 堵洞(T6.1):plugin-manager/plugin-market RPC 与 detail-file 路由 admin-only
 *   (2026-11-19 落地于 mux.ts 的 MARKET_ADMIN_PREFIXES admit 门,本文件仅留史注);
 * - 转内置(T7B)=个人发起→admin 审批(可缺席降级)/admin 直转即时;拷贝制,
 *   通过后个人原件停用标记「已转内置」(避免同码双装载);
 * - 消息提醒(T7A)=站内 notifications(不出内网);审批模型 type+payload 泛化。
 *
 * T6 装载器接入(2026-11-18,闭合原一期边界「mount 面留后续任务」):
 * - 装载面=tenant-plugins.ts(进程内 tools.register 打 scope,免重启);
 *   loader 可缺席(降级为纯记账,启停只改行——测试/降级部署同构);
 * - install/enable/disable/remove 即刻 mount/unmount;list 下发 mounted/tools/error;
 * - scan=扫描 plugins 根下未登记目录(创造模式产物发现性:一键导入替代手填表单);
 * - 转内置补完=审批通过/直转后共享行记账+全局 mount(即刻全员可用,零重启)。
 */
import { cpSync, existsSync, readdirSync } from 'node:fs'
import { basename, join, resolve, sep } from 'node:path'
import type { TenantDeps } from './tenant.ts'
import { userRootFor } from './tenant.ts'
import type { ApprovalFlow } from './approvals.ts'

/** 个人插件登记端点前缀(access 守卫路由,cookie 判归属)。 */
export const USER_PLUGINS_PREFIX = '/api/my-plugins'

interface GuardContextLike {
  readonly deps: TenantDeps
  readonly userId: number
  readonly account: string
}

type SyncGuardHandler = (
  rpcId: string, args: Record<string, unknown>, ctx: GuardContextLike, signal: AbortSignal,
) => Response | Promise<Response>

interface RegisterFn {
  (path: string, handler: SyncGuardHandler): void
}

/** T6 装载器结构面(tenant-plugins.ts 返回值的窄子集;可缺席=纯记账降级)。
 *  层:个人副本与共享副本按层独立挂载(unmount 不传=个人层)。 */
export interface UserPluginLoader {
  mount(pluginId: string, opts: { readonly dir: string; readonly ownerUserId?: number }): Promise<{
    readonly ok: boolean
    readonly tools?: readonly string[]
    readonly error?: string
  }>
  unmount(pluginId: string, layer?: 'personal' | 'shared'): void
  stateOf(pluginId: string, layer?: 'personal' | 'shared'): { readonly mounted: boolean; readonly tools: readonly string[]; readonly error?: string }
}

function frame(rpcId: string, result: unknown): Response {
  return new Response(JSON.stringify({ type: 'server-response', rpcId, result }), {
    status: 200, headers: { 'content-type': 'application/json' },
  })
}

function deniedFrame(rpcId: string, message: string): Response {
  return frame(rpcId, { ok: false, error: { code: 'tenant/denied', message, details: {} } })
}

function okFrame(rpcId: string, value: unknown): Response {
  return frame(rpcId, { ok: true, value })
}

/** 个人插件 id 强制:user:<account>:<name>(禁 shadow 公共 id)。 */
export function personalPluginId(account: string, name: string): string | undefined {
  if (!/^[\w][\w.-]{0,63}$/u.test(name)) return undefined
  return `user:${account}:${name}`
}

/** dir 必须在 <userRoot>/plugins/ 之下。 */
function personalPluginDir(userRoot: string, dirName: string): string | undefined {
  if (!/^[\w][\w.-]{0,63}$/u.test(dirName)) return undefined
  const dir = resolve(userRoot, 'plugins', dirName)
  const pluginsRoot = resolve(userRoot, 'plugins')
  if (!dir.startsWith(pluginsRoot + sep)) return undefined
  return dir
}

/** 审批流依赖(T7;可选——缺席降级:转内置申请不可用,个人插件不受影响)。 */
export interface ApprovalDeps {
  readonly flow: ApprovalFlow
  readonly isAdmin: (userId: number) => boolean
}

/** 安装结果(路由与 install_personal_plugin 工具共用;mount 段=装载器缺席时 undefined)。 */
export interface InstallOutcome {
  readonly ok: boolean
  readonly pluginId?: string
  readonly dir?: string
  readonly error?: string
  readonly mount?: { readonly ok: boolean; readonly tools?: readonly string[]; readonly error?: string }
}

/**
 * 安装助手:校验→记账→装载(路径钳制/归属判定/upsert 与工具、路由共用同一份逻辑)。
 */
export async function installPersonalPlugin(
  deps: TenantDeps,
  loader: UserPluginLoader | undefined,
  session: { readonly userId: number; readonly account: string },
  name: string,
  dirName: string,
): Promise<InstallOutcome> {
  const pluginId = personalPluginId(session.account, name)
  const userRoot = userRootFor(deps.tenantRoot, session.account)
  const dir = dirName === '' ? undefined : personalPluginDir(userRoot, dirName)
  if (pluginId === undefined || dir === undefined) {
    return { ok: false, error: '插件名或目录名非法(仅限字母数字.-_,不含 /)' }
  }
  if (!existsSync(dir)) {
    return { ok: false, error: `插件目录不存在:${dir}(先把插件放入你的 plugins 目录)` }
  }
  const existingOwner = deps.store.userPluginOwner(pluginId)
  if (existingOwner !== undefined && existingOwner !== session.userId) {
    return { ok: false, error: '插件 id 已被其他用户占用' }
  }
  deps.store.recordUserPlugin(session.userId, pluginId, dir, true)
  deps.audit({ kind: 'access.tenant', account: session.account, detail: { action: 'plugin.install', pluginId, dir } })
  const mount = loader === undefined ? undefined : await loader.mount(pluginId, { dir, ownerUserId: session.userId })
  return { ok: true, pluginId, dir, ...(mount !== undefined ? { mount } : {}) }
}

/**
 * 注册个人插件端点(list/install/enable/disable/remove/scan/promote*+shared/审批/通知;
 * 仅本人;shared 段 admin)。loader 可缺席=纯记账降级(装配见 plugin.ts)。
 */
export function registerUserPluginRoutes(
  deps: TenantDeps,
  register: RegisterFn,
  approvalDeps?: ApprovalDeps,
  loader?: UserPluginLoader,
): void {
  const store = deps.store
  const sharedPluginsRoot = resolve(deps.tenantRoot, '..', 'plugins-promoted')

  const list = (rpcId: string, ctx: GuardContextLike): Response => {
    const rows = store.userPluginsOfOwner(ctx.userId)
    const userRoot = userRootFor(deps.tenantRoot, ctx.account)
    const items = rows.map((row) => {
      const state = loader?.stateOf(row.pluginId)
      return {
        pluginId: row.pluginId,
        dir: row.dir,
        dirExists: existsSync(row.dir),
        enabled: row.enabled,
        promoted: row.promoted,
        withinRoot: row.dir.startsWith(resolve(userRoot, 'plugins') + sep),
        mounted: state?.mounted ?? false,
        tools: state?.tools ?? [],
        mountError: state?.error,
      }
    })
    return okFrame(rpcId, { items })
  }

  const install = async (rpcId: string, ctx: GuardContextLike, args: Record<string, unknown>): Promise<Response> => {
    const request = args.request as { name?: string; dir?: string } | undefined
    const outcome = await installPersonalPlugin(
      deps, loader, { userId: ctx.userId, account: ctx.account },
      typeof request?.name === 'string' ? request.name : '',
      typeof request?.dir === 'string' ? request.dir : '',
    )
    if (!outcome.ok) return deniedFrame(rpcId, outcome.error ?? '安装失败')
    return okFrame(rpcId, {
      pluginId: outcome.pluginId, dir: outcome.dir, enabled: true,
      ...(outcome.mount !== undefined ? { mount: outcome.mount } : {}),
    })
  }

  const setEnabled = async (rpcId: string, ctx: GuardContextLike, args: Record<string, unknown>, enabled: boolean): Promise<Response> => {
    const request = args.request as { pluginId?: string } | undefined
    const pluginId = typeof request?.pluginId === 'string' ? request.pluginId : ''
    if (store.userPluginOwner(pluginId) !== ctx.userId) {
      return deniedFrame(rpcId, '插件不存在或不属于你')
    }
    store.setUserPluginEnabled(ctx.userId, pluginId, enabled)
    // T6:启停即时生效(mount/unmount;装载器缺席=纯记账降级)
    let mount: InstallOutcome['mount']
    if (loader !== undefined) {
      if (enabled) {
        const row = store.userPluginsOfOwner(ctx.userId).find(r => r.pluginId === pluginId)
        mount = row === undefined ? undefined : await loader.mount(pluginId, { dir: row.dir, ownerUserId: ctx.userId })
      } else {
        loader.unmount(pluginId)
      }
    }
    deps.audit({ kind: 'access.tenant', account: ctx.account, detail: { action: enabled ? 'plugin.enable' : 'plugin.disable', pluginId } })
    return okFrame(rpcId, { pluginId, enabled, ...(mount !== undefined ? { mount } : {}) })
  }

  const remove = (rpcId: string, ctx: GuardContextLike, args: Record<string, unknown>): Response => {
    const request = args.request as { pluginId?: string } | undefined
    const pluginId = typeof request?.pluginId === 'string' ? request.pluginId : ''
    if (store.userPluginOwner(pluginId) !== ctx.userId) {
      return deniedFrame(rpcId, '插件不存在或不属于你')
    }
    loader?.unmount(pluginId)
    store.forgetUserPlugin(pluginId)
    deps.audit({ kind: 'access.tenant', account: ctx.account, detail: { action: 'plugin.remove', pluginId } })
    return okFrame(rpcId, { pluginId })
  }

  // T6 发现性:扫描 plugins 根下未登记目录(创造模式产物一键导入,替代手填表单)。
  const scan = (rpcId: string, ctx: GuardContextLike): Response => {
    const userRoot = userRootFor(deps.tenantRoot, ctx.account)
    const pluginsRoot = join(userRoot, 'plugins')
    if (!existsSync(pluginsRoot)) return okFrame(rpcId, { items: [] })
    const known = new Set(store.userPluginsOfOwner(ctx.userId).map(row => row.dir))
    try {
      const dirents = readdirSync(pluginsRoot, { withFileTypes: true })
      const items = dirents
        .filter(dirent => dirent.isDirectory())
        .map(dirent => join(pluginsRoot, dirent.name))
        .filter(dir => !known.has(dir))
        .map(dir => ({ dirName: basename(dir), dir }))
      return okFrame(rpcId, { items })
    } catch {
      return okFrame(rpcId, { items: [] })
    }
  }

  /** 转内置执行:拷贝→标记→共享行记账→全局 mount(即刻全员可用,零重启)。 */
  const promoteExecute = async (rpcId: string, pluginId: string, dir: string): Promise<Response> => {
    const owner = store.userPluginOwner(pluginId)
    if (owner === undefined) return deniedFrame(rpcId, '插件不存在')
    const dest = join(sharedPluginsRoot, pluginId.replaceAll(':', '_'))
    try {
      cpSync(dir, dest, { recursive: true })
    } catch (error) {
      return deniedFrame(rpcId, `转内置拷贝失败:${error instanceof Error ? error.message : String(error)}`)
    }
    store.markUserPluginPromoted(owner, pluginId)
    // T6 补完:共享行记账 + 全局 mount(原实现止步于拷贝,共享区无装载器读取)
    store.recordSharedPlugin(pluginId, dest, true)
    const mount = loader === undefined ? undefined : await loader.mount(pluginId, { dir: dest })
    // 共享装载成功后个人副本退场(转内置语义 = 全员版接管):否则个人行+共享行
    // 同时挂载、同一插件贡献两套工具。共享装载失败则保留个人副本可用。
    if (mount?.ok === true) {
      loader?.unmount(pluginId, 'personal')
      store.setUserPluginEnabled(owner, pluginId, false)
    }
    deps.audit({ kind: 'access.tenant', account: 'system', detail: { action: 'plugin.promoted', pluginId, dest, mounted: mount?.ok === true } })
    return okFrame(rpcId, { pluginId, promoted: true, sharedDir: dest, ...(mount !== undefined ? { mount } : {}) })
  }

  register(`${USER_PLUGINS_PREFIX}/list`, (rpcId, _args, ctx) => list(rpcId, ctx))
  register(`${USER_PLUGINS_PREFIX}/install`, (rpcId, args, ctx) => install(rpcId, ctx, args))
  register(`${USER_PLUGINS_PREFIX}/enable`, (rpcId, args, ctx) => setEnabled(rpcId, ctx, args, true))
  register(`${USER_PLUGINS_PREFIX}/disable`, (rpcId, args, ctx) => setEnabled(rpcId, ctx, args, false))
  register(`${USER_PLUGINS_PREFIX}/remove`, (rpcId, args, ctx) => remove(rpcId, ctx, args))
  register(`${USER_PLUGINS_PREFIX}/scan`, (rpcId, _args, ctx) => scan(rpcId, ctx))

  // ── T6 共享层(转内置产物;admin 启停,热生效)──
  register(`${USER_PLUGINS_PREFIX}/shared/list`, (rpcId, _args, ctx) => {
    if (approvalDeps === undefined || !approvalDeps.isAdmin(ctx.userId)) return deniedFrame(rpcId, '仅管理员可查看共享插件')
    const items = store.sharedPlugins().map((row) => {
      const state = loader?.stateOf(row.pluginId, 'shared')
      return { ...row, mounted: state?.mounted ?? false, tools: state?.tools ?? [], mountError: state?.error }
    })
    return okFrame(rpcId, { items })
  })

  const setSharedEnabled = async (
    rpcId: string, ctx: GuardContextLike, args: Record<string, unknown>, enabled: boolean,
  ): Promise<Response> => {
    if (approvalDeps === undefined || !approvalDeps.isAdmin(ctx.userId)) return deniedFrame(rpcId, '仅管理员可启停共享插件')
    const request = args.request as { pluginId?: string } | undefined
    const pluginId = typeof request?.pluginId === 'string' ? request.pluginId : ''
    const row = store.sharedPlugins().find(r => r.pluginId === pluginId)
    if (row === undefined) return deniedFrame(rpcId, '共享插件不存在')
    store.setSharedPluginEnabled(pluginId, enabled)
    let mount: InstallOutcome['mount']
    if (loader !== undefined) {
      if (enabled) mount = await loader.mount(pluginId, { dir: row.dir })
      else loader.unmount(pluginId, 'shared')
    }
    deps.audit({ kind: 'access.tenant', account: ctx.account, detail: { action: enabled ? 'shared.enable' : 'shared.disable', pluginId } })
    return okFrame(rpcId, { pluginId, enabled, ...(mount !== undefined ? { mount } : {}) })
  }
  register(`${USER_PLUGINS_PREFIX}/shared/enable`, (rpcId, args, ctx) => setSharedEnabled(rpcId, ctx, args, true))
  register(`${USER_PLUGINS_PREFIX}/shared/disable`, (rpcId, args, ctx) => setSharedEnabled(rpcId, ctx, args, false))

  // ── T7B:转内置(个人发起→审批;admin 直转即时)──
  register(`${USER_PLUGINS_PREFIX}/promote-request`, (rpcId, args, ctx) => {
    if (approvalDeps === undefined) {
      return deniedFrame(rpcId, '审批流未启用,转内置暂不可用(个人插件不受影响)')
    }
    const request = args.request as { pluginId?: string } | undefined
    const pluginId = typeof request?.pluginId === 'string' ? request.pluginId : ''
    if (store.userPluginOwner(pluginId) !== ctx.userId) return deniedFrame(rpcId, '插件不存在或不属于你')
    const row = store.userPluginsOfOwner(ctx.userId).find(r => r.pluginId === pluginId)
    if (row === undefined || !existsSync(row.dir)) return deniedFrame(rpcId, '插件目录不存在')
    const id = approvalDeps.flow.register('plugin-promote', { pluginId, dir: row.dir, requesterAccount: ctx.account }, ctx.userId)
    if (id === undefined) return deniedFrame(rpcId, '已有同插件待审请求,请等待处理')
    return okFrame(rpcId, { requestId: id, pluginId })
  })

  register(`${USER_PLUGINS_PREFIX}/promote-decide`, async (rpcId, args, ctx) => {
    if (approvalDeps === undefined) return deniedFrame(rpcId, '审批流未启用')
    if (!approvalDeps.isAdmin(ctx.userId)) return deniedFrame(rpcId, '仅管理员可审批')
    const request = args.request as { requestId?: number; approve?: boolean; note?: string } | undefined
    const requestId = typeof request?.requestId === 'number' ? request.requestId : 0
    const approve = request?.approve === true
    const note = typeof request?.note === 'string' ? request.note : ''
    const pending = approvalDeps.flow.listPending().find(a => a.id === requestId)
    if (pending === undefined) return deniedFrame(rpcId, '审批请求不存在或已处理')
    if (!approve) {
      approvalDeps.flow.decide(requestId, ctx.userId, false, note)
      return okFrame(rpcId, { requestId, approved: false })
    }
    const payload = pending.payload as { pluginId?: string; dir?: string }
    const pluginId = typeof payload.pluginId === 'string' ? payload.pluginId : ''
    const dir = typeof payload.dir === 'string' ? payload.dir : ''
    if (pluginId === '' || dir === '' || !existsSync(dir)) return deniedFrame(rpcId, '待审插件目录不存在')
    const exec = await promoteExecute(rpcId, pluginId, dir)
    if (exec.status === 200) approvalDeps.flow.decide(requestId, ctx.userId, true, note)
    return exec
  })

  register(`${USER_PLUGINS_PREFIX}/promote-direct`, (rpcId, args, ctx) => {
    if (approvalDeps === undefined) return deniedFrame(rpcId, '审批流未启用')
    if (!approvalDeps.isAdmin(ctx.userId)) return deniedFrame(rpcId, '仅管理员可直转')
    const request = args.request as { pluginId?: string } | undefined
    const pluginId = typeof request?.pluginId === 'string' ? request.pluginId : ''
    const owner = store.userPluginOwner(pluginId)
    if (owner === undefined) return deniedFrame(rpcId, '插件不存在')
    const row = store.userPluginsOfOwner(owner).find(r => r.pluginId === pluginId)
    if (row === undefined || !existsSync(row.dir)) return deniedFrame(rpcId, '插件目录不存在')
    return promoteExecute(rpcId, pluginId, row.dir)
  })

  // ── T7A:审批队列(admin)/我的请求/站内通知(全员)──
  register('/api/approvals/pending', (rpcId, _args, ctx) => {
    if (approvalDeps === undefined || !approvalDeps.isAdmin(ctx.userId)) return okFrame(rpcId, { items: [] })
    return okFrame(rpcId, { items: approvalDeps.flow.listPending() })
  })
  register('/api/approvals/mine', (rpcId, _args, ctx) => {
    if (approvalDeps === undefined) return okFrame(rpcId, { items: [] })
    return okFrame(rpcId, { items: approvalDeps.flow.listMine(ctx.userId) })
  })
  register('/api/notifications', (rpcId, _args, ctx) => {
    if (approvalDeps === undefined) return okFrame(rpcId, { items: [], unread: 0 })
    return okFrame(rpcId, { items: approvalDeps.flow.notifications(ctx.userId), unread: approvalDeps.flow.unreadCount(ctx.userId) })
  })
  register('/api/notifications/read-all', (rpcId, _args, ctx) => {
    if (approvalDeps !== undefined) approvalDeps.flow.markAllRead(ctx.userId)
    return okFrame(rpcId, { ok: true })
  })
}
