/**
 * P4-T6(2026-11-11):双层插件空间——个人层记账端点 + 三面过滤的装载面。
 *
 * 架构(隔离计划 §6.4-6.5,2026-11-11 落地形态):
 * - 公共层=现有 bundle/profile patch/TOGGLEABLE(现状不动);
 * - 个人层=$DSH_HOME/workspaces/<账号>/plugins/<plugin-dir>(DSH_HOME 语义 T1 铁律),
 *   记账=user_plugins 表(激活清单,运行时合并不复制);
 * - 命名强制 user:<account>:<name>(禁 shadow 公共 id,MCP 整体替换陷阱);
 * - 堵洞(T6.1):plugin-manager/plugin-market RPC 与 detail-file 路由 admin-only
 *   (双层后共享 profile 装包=影响全体,普通用户装包走个人层端点);
 * - 三面过滤:工具面=个人插件 register 时打 agent scope(仅本人 session 可见——
 *   经 sessionOwner 归属判定);服务面=isolate realm label 强制;UI 面=设置分区按 me 渲染。
 * - 转内置(T7)=admin 拷贝到公共区+登记;级联销毁(T8)=删用户清登记行。
 *
 * 一期边界(诚实声明):个人插件 Host 侧装载=记账+目录校验+清单下发;进程内
 * tools.register 打 scope 的 mount 面在 P4 后续任务接入(三面过滤的服务面/工具面
 * 挂点已留,注册器注入点=tenant-plugins 装载器)。
 */
import { existsSync } from 'node:fs'
import { resolve, sep } from 'node:path'
import type { TenantDeps } from './tenant.ts'
import { userRootFor } from './tenant.ts'

/** 个人插件登记端点前缀(access 守卫路由,cookie 判归属)。 */
export const USER_PLUGINS_PREFIX = '/access/api/my-plugins'

interface GuardContextLike {
  readonly deps: TenantDeps
  readonly userId: number
  readonly account: string
}

type GuardHandler = (
  rpcId: string, args: Record<string, unknown>, ctx: GuardContextLike, signal: AbortSignal,
) => Promise<Response>

interface RegisterFn {
  (path: string, handler: GuardHandler): void
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

/** dir 必须在 <userRoot>/plugins/ 之下且实存(realpath 由守卫层 T1 withinRoot 保证)。 */
function personalPluginDir(userRoot: string, dirName: string): string | undefined {
  if (!/^[\w][\w.-]{0,63}$/u.test(dirName)) return undefined
  const dir = resolve(userRoot, 'plugins', dirName)
  const pluginsRoot = resolve(userRoot, 'plugins')
  if (!dir.startsWith(pluginsRoot + sep)) return undefined
  return dir
}

/**
 * 注册个人插件端点(list/install/enable/disable/remove;仅本人)。
 * deps.ensureMux 由 tenant.ts 的惰性链传入(装 sessionOwner 闭包所需——实际读 store)。
 */
export function registerUserPluginRoutes(
  deps: TenantDeps,
  register: RegisterFn,
): void {
  const store = deps.store

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
    if (store.userPluginOwner(pluginId) !== undefined && store.userPluginOwner(pluginId) !== ctx.userId) {
      return deniedFrame(rpcId, '插件 id 已被其他用户占用')
    }
    store.recordUserPlugin(ctx.userId, pluginId, dir, true)
    deps.audit({ kind: 'access.tenant', account: ctx.account, detail: { action: 'plugin.install', pluginId, dir } })
    return okFrame(rpcId, { pluginId, dir, enabled: true })
  }

  const setEnabled = (rpcId: string, ctx: GuardContextLike, args: Record<string, unknown>, enabled: boolean): Response => {
    const request = args.request as { pluginId?: string } | undefined
    const pluginId = typeof request?.pluginId === 'string' ? request.pluginId : ''
    const owner = store.userPluginOwner(pluginId)
    if (owner !== ctx.userId) {
      return deniedFrame(rpcId, '插件不存在或不属于你')
    }
    store.setUserPluginEnabled(ctx.userId, pluginId, enabled)
    deps.audit({ kind: 'access.tenant', account: ctx.account, detail: { action: enabled ? 'plugin.enable' : 'plugin.disable', pluginId } })
    return okFrame(rpcId, { pluginId, enabled })
  }

  const remove = (rpcId: string, ctx: GuardContextLike, args: Record<string, unknown>): Response => {
    const request = args.request as { pluginId?: string } | undefined
    const pluginId = typeof request?.pluginId === 'string' ? request.pluginId : ''
    const owner = store.userPluginOwner(pluginId)
    if (owner !== ctx.userId) {
      return deniedFrame(rpcId, '插件不存在或不属于你')
    }
    store.forgetUserPlugin(pluginId)
    deps.audit({ kind: 'access.tenant', account: ctx.account, detail: { action: 'plugin.remove', pluginId } })
    return okFrame(rpcId, { pluginId })
  }

  register(`${USER_PLUGINS_PREFIX}/list`, (rpcId, _args, ctx) => Promise.resolve(list(rpcId, ctx)))
  register(`${USER_PLUGINS_PREFIX}/install`, (rpcId, args, ctx) => Promise.resolve(install(rpcId, ctx, args)))
  register(`${USER_PLUGINS_PREFIX}/enable`, (rpcId, args, ctx) => Promise.resolve(setEnabled(rpcId, ctx, args, true)))
  register(`${USER_PLUGINS_PREFIX}/disable`, (rpcId, args, ctx) => Promise.resolve(setEnabled(rpcId, ctx, args, false)))
  register(`${USER_PLUGINS_PREFIX}/remove`, (rpcId, args, ctx) => Promise.resolve(remove(rpcId, ctx, args)))
}
