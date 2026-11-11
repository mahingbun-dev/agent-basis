/**
 * P4-T6/T7(2026-11-11):双层插件空间——个人层记账端点+审批流+转内置。
 *
 * 架构(隔离计划 §6.4-6.5,落地形态):
 * - 公共层=现有 bundle/profile patch/TOGGLEABLE(现状不动);
 * - 个人层=$DSH_HOME/workspaces/<账号>/plugins/<plugin-dir>(DSH_HOME 语义 T1 铁律),
 *   记账=user_plugins 表(激活清单,运行时合并不复制);
 * - 命名强制 user:<account>:<name>(禁 shadow 公共 id,MCP 整体替换陷阱);
 * - 堵洞(T6.1):plugin-manager/plugin-market RPC 与 detail-file 路由 admin-only;
 * - 转内置(T7B)=个人发起→admin 审批(可缺席降级)/admin 直转即时;拷贝制,
 *   通过后个人原件停用标记「已转内置」(避免同码双装载);
 * - 消息提醒(T7A)=站内 notifications(不出内网);审批模型 type+payload 泛化。
 *
 * 一期边界(诚实声明):个人插件 Host 侧装载=记账+目录校验+清单下发;进程内
 * tools.register 打 scope 的 mount 面留后续任务(挂点=tenant-plugins 装载器)。
 */
import { cpSync, existsSync } from 'node:fs'
import { join, resolve, sep } from 'node:path'
import type { TenantDeps } from './tenant.ts'
import { userRootFor } from './tenant.ts'
import type { ApprovalFlow } from './approvals.ts'

/** 个人插件登记端点前缀(access 守卫路由,cookie 判归属)。 */
export const USER_PLUGINS_PREFIX = '/access/api/my-plugins'

interface GuardContextLike {
  readonly deps: TenantDeps
  readonly userId: number
  readonly account: string
}

type SyncGuardHandler = (
  rpcId: string, args: Record<string, unknown>, ctx: GuardContextLike, signal: AbortSignal,
) => Response

interface RegisterFn {
  (path: string, handler: SyncGuardHandler): void
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

/**
 * 注册个人插件端点(list/install/enable/disable/remove/promote*+审批/通知;仅本人)。
 */
export function registerUserPluginRoutes(
  deps: TenantDeps,
  register: RegisterFn,
  approvalDeps?: ApprovalDeps,
): void {
  const store = deps.store
  const sharedPluginsRoot = resolve(deps.tenantRoot, '..', 'plugins-promoted')

  const list = (rpcId: string, ctx: GuardContextLike): Response => {
    const rows = store.userPluginsOfOwner(ctx.userId)
    const userRoot = userRootFor(deps.tenantRoot, ctx.account)
    const items = rows.map(row => ({
      pluginId: row.pluginId,
      dir: row.dir,
      dirExists: existsSync(row.dir),
      enabled: row.enabled,
      promoted: row.promoted,
      withinRoot: row.dir.startsWith(resolve(userRoot, 'plugins') + sep),
    }))
    return okFrame(rpcId, { items })
  }

  const install = (rpcId: string, ctx: GuardContextLike, args: Record<string, unknown>): Response => {
    const request = args.request as { name?: string; dir?: string } | undefined
    const name = typeof request?.name === 'string' ? request.name : ''
    const dirName = typeof request?.dir === 'string' ? request.dir : ''
    const pluginId = personalPluginId(ctx.account, name)
    const userRoot = userRootFor(deps.tenantRoot, ctx.account)
    const dir = dirName === '' ? undefined : personalPluginDir(userRoot, dirName)
    if (pluginId === undefined || dir === undefined) {
      return deniedFrame(rpcId, '插件名或目录名非法(仅限字母数字.-_,不含 /)')
    }
    if (!existsSync(dir)) {
      return deniedFrame(rpcId, `插件目录不存在:${dir}(先把插件放入你的 plugins 目录)`)
    }
    const existingOwner = store.userPluginOwner(pluginId)
    if (existingOwner !== undefined && existingOwner !== ctx.userId) {
      return deniedFrame(rpcId, '插件 id 已被其他用户占用')
    }
    store.recordUserPlugin(ctx.userId, pluginId, dir, true)
    deps.audit({ kind: 'access.tenant', account: ctx.account, detail: { action: 'plugin.install', pluginId, dir } })
    return okFrame(rpcId, { pluginId, dir, enabled: true })
  }

  const setEnabled = (rpcId: string, ctx: GuardContextLike, args: Record<string, unknown>, enabled: boolean): Response => {
    const request = args.request as { pluginId?: string } | undefined
    const pluginId = typeof request?.pluginId === 'string' ? request.pluginId : ''
    if (store.userPluginOwner(pluginId) !== ctx.userId) {
      return deniedFrame(rpcId, '插件不存在或不属于你')
    }
    store.setUserPluginEnabled(ctx.userId, pluginId, enabled)
    deps.audit({ kind: 'access.tenant', account: ctx.account, detail: { action: enabled ? 'plugin.enable' : 'plugin.disable', pluginId } })
    return okFrame(rpcId, { pluginId, enabled })
  }

  const remove = (rpcId: string, ctx: GuardContextLike, args: Record<string, unknown>): Response => {
    const request = args.request as { pluginId?: string } | undefined
    const pluginId = typeof request?.pluginId === 'string' ? request.pluginId : ''
    if (store.userPluginOwner(pluginId) !== ctx.userId) {
      return deniedFrame(rpcId, '插件不存在或不属于你')
    }
    store.forgetUserPlugin(pluginId)
    deps.audit({ kind: 'access.tenant', account: ctx.account, detail: { action: 'plugin.remove', pluginId } })
    return okFrame(rpcId, { pluginId })
  }

  const promoteExecute = (rpcId: string, pluginId: string, dir: string): Response => {
    const owner = store.userPluginOwner(pluginId)
    if (owner === undefined) return deniedFrame(rpcId, '插件不存在')
    const dest = join(sharedPluginsRoot, pluginId.replaceAll(':', '_'))
    try {
      cpSync(dir, dest, { recursive: true })
    } catch (error) {
      return deniedFrame(rpcId, `转内置拷贝失败:${error instanceof Error ? error.message : String(error)}`)
    }
    store.markUserPluginPromoted(owner, pluginId)
    deps.audit({ kind: 'access.tenant', account: 'system', detail: { action: 'plugin.promoted', pluginId, dest } })
    return okFrame(rpcId, { pluginId, promoted: true, sharedDir: dest })
  }

  register(`${USER_PLUGINS_PREFIX}/list`, (rpcId, _args, ctx) => list(rpcId, ctx))
  register(`${USER_PLUGINS_PREFIX}/install`, (rpcId, args, ctx) => install(rpcId, ctx, args))
  register(`${USER_PLUGINS_PREFIX}/enable`, (rpcId, args, ctx) => setEnabled(rpcId, ctx, args, true))
  register(`${USER_PLUGINS_PREFIX}/disable`, (rpcId, args, ctx) => setEnabled(rpcId, ctx, args, false))
  register(`${USER_PLUGINS_PREFIX}/remove`, (rpcId, args, ctx) => remove(rpcId, ctx, args))

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

  register(`${USER_PLUGINS_PREFIX}/promote-decide`, (rpcId, args, ctx) => {
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
    const exec = promoteExecute(rpcId, pluginId, dir)
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
  register('/access/api/approvals/pending', (rpcId, _args, ctx) => {
    if (approvalDeps === undefined || !approvalDeps.isAdmin(ctx.userId)) return okFrame(rpcId, { items: [] })
    return okFrame(rpcId, { items: approvalDeps.flow.listPending() })
  })
  register('/access/api/approvals/mine', (rpcId, _args, ctx) => {
    if (approvalDeps === undefined) return okFrame(rpcId, { items: [] })
    return okFrame(rpcId, { items: approvalDeps.flow.listMine(ctx.userId) })
  })
  register('/access/api/notifications', (rpcId, _args, ctx) => {
    if (approvalDeps === undefined) return okFrame(rpcId, { items: [], unread: 0 })
    return okFrame(rpcId, { items: approvalDeps.flow.notifications(ctx.userId), unread: approvalDeps.flow.unreadCount(ctx.userId) })
  })
  register('/access/api/notifications/read-all', (rpcId, _args, ctx) => {
    if (approvalDeps !== undefined) approvalDeps.flow.markAllRead(ctx.userId)
    return okFrame(rpcId, { ok: true })
  })
}
