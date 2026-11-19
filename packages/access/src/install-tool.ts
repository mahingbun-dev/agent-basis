/**
 * T6 自研安装工具(2026-11-18):install_personal_plugin——创造模式(cordis 预设)
 * 开发的个人工具型插件「写完即装、装完即用」的 P0 面。
 *
 * 背景:tool-plugin-manager/tool-plugin-market 维持裁切(2026-11-09 三方准入红线,
 * 2026-11-18 用户裁定不回加、自研);本工具是 Eterna 自己的安装面,底层=
 * installPersonalPlugin 助手(路径钳制/归属判定/upsert,与设置弹窗路由同一份逻辑)
 * + tenant-plugins.ts 装载器(进程内 mount,免重启,仅本人会话可见)。
 *
 * 权限语义:个人安装/启停免审批(2026-11-10 隔离计划裁定);无主会话(系统任务)
 * 明确拒绝;目录钳制在本人 plugins 根内(与 fs 工具钳制同口径)。UI/bundle 型
 * manifest 一律拒载(诚实边界,指引管理员 bundle 安装路径)。
 */
import { basename, resolve, sep } from 'node:path'
import { userRootFor } from './tenant.ts'
import type { TenantDeps } from './tenant.ts'
import { installPersonalPlugin, type UserPluginLoader } from './user-plugins.ts'
import type { ToolDefinition } from '@deepseek-ai/dsh-tools'

export const INSTALL_PERSONAL_PLUGIN_TOOL_NAME = 'install_personal_plugin'

/** 自研安装工具(def 形状对齐 knowledge 包 toDshToolDefinition 适配先例)。 */
export function defineInstallPersonalPluginTool(deps: {
  readonly tenantDeps: TenantDeps
  readonly loader: UserPluginLoader | undefined
}): ToolDefinition {
  return {
    name: INSTALL_PERSONAL_PLUGIN_TOOL_NAME,
    description:
      '安装当前用户开发在个人 plugins 目录下的工具型插件,进程内即时装载(免重启,仅本人会话可见,免审批)。' +
      'dir 是你的 plugins 目录下的子目录名(或该目录的绝对路径,必须在你的 plugins 目录之内);name 缺省取目录名。' +
      '插件契约:目录含 package.json,main 指向纯 JS 入口,入口导出 apply(ctx) 且在 ctx.tools.register 上注册工具;' +
      'UI 型(dsh.client)与 bundle 型(dsh.bundle.patch)不支持,需管理员走 bundle 安装。' +
      '装载成功返回注册的工具名(自动加 user_<账号>_ 前缀);如需全员可用,引导用户在设置弹窗「我的插件」发起转内置(管理员审批)。',
    parameters: {
      type: 'object',
      properties: {
        dir: { type: 'string', description: '插件目录名(相对当前用户 plugins 目录)或该目录绝对路径' },
        name: { type: 'string', description: '登记名(缺省取目录名);与既有个人插件同名将更新到新目录' },
      },
      required: ['dir'],
    },
    output: {
      schema: { type: 'string' },
      render: (_args, value) => [{ type: 'text', text: typeof value === 'string' ? value : JSON.stringify(value) }],
    },
    async execute(args, exec) {
      const request = args as { dir?: unknown; name?: unknown }
      // 身份面:会话归属 → 账号(与守卫 currentUser 同源;无主会话拒绝)
      const session = exec.agent?.session as { readonly id?: string } | undefined
      const sessionId = session?.id
      if (typeof sessionId !== 'string' || sessionId === '') {
        return '拒绝:未能定位当前会话(个人插件安装仅对登录用户的会话开放)'
      }
      const userId = deps.tenantDeps.store.sessionOwner(sessionId)
      const user = userId !== undefined ? deps.tenantDeps.store.getUserById(userId) : undefined
      if (user === undefined) {
        return '拒绝:未能定位当前会话的登录账号(个人插件安装仅对登录用户开放)'
      }
      const rawDir = typeof request.dir === 'string' ? request.dir.trim() : ''
      if (rawDir === '') return '拒绝:dir 必填(你的 plugins 目录下的插件目录名)'
      const userRoot = userRootFor(deps.tenantDeps.tenantRoot, user.account)
      const pluginsRoot = resolve(userRoot, 'plugins')
      // 目录参数:绝对路径必须钳在本人 plugins 根内(与 fs 工具钳制同口径);否则按目录名
      let dirName: string
      if (rawDir.includes('/') || rawDir.includes('\\')) {
        const resolved = resolve(rawDir)
        if (!resolved.startsWith(pluginsRoot + sep)) {
          return `拒绝:目录必须在你的 plugins 目录(${pluginsRoot})之内`
        }
        dirName = basename(resolved)
      } else {
        dirName = rawDir
      }
      const name = typeof request.name === 'string' && request.name !== '' ? request.name : dirName
      const outcome = await installPersonalPlugin(
        deps.tenantDeps, deps.loader, { userId: user.id, account: user.account }, name, dirName,
      )
      if (!outcome.ok) return `安装失败:${outcome.error ?? '未知原因'}`
      const mount = outcome.mount
      if (mount === undefined) {
        return `已登记 ${outcome.pluginId}(装载器未接入的降级形态:已保存激活清单,重启后由 bootScan 装载)`
      }
      if (!mount.ok) {
        return `已登记 ${outcome.pluginId},但装载失败:${mount.error ?? '未知原因'}(修复插件文件后可重新安装,或在「我的插件」停用)`
      }
      const tools = mount.tools ?? []
      return tools.length === 0
        ? `已安装并装载 ${outcome.pluginId},但插件未注册任何工具(检查 apply 内 ctx.tools.register 调用)`
        : `已安装并装载 ${outcome.pluginId},工具即刻可用(仅本人会话可见):${tools.join(', ')}。如需全员使用,请在设置弹窗「我的插件」对该插件发起转内置(管理员审批)。`
    },
  }
}
