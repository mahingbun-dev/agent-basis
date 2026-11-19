/**
 * 一键发布工具(2026-11-19):submit_plugin_to_market——把本人 plugins 根下的
 * 工具型插件发布到官方插件仓库 eterna-plugins(分支 commit → push → 开 PR,
 * main 设分支保护永不直推)。核心逻辑在 market-publish.ts,本文件只是工具壳:
 * 身份解析沿 install-tool.ts 同源(sessionId→sessionOwner),env 从进程环境读。
 *
 * 权限语义(用户 2026-11-19 拍板):push 所有人可用;合并由 main 分支保护强制
 * 走 PR + CI(validate),PR 合并是人工动作。
 */
import { userRootFor } from './tenant.ts'
import type { TenantDeps } from './tenant.ts'
import type { ToolDefinition } from '@deepseek-ai/dsh-tools'
import { defaultMarketPublishDeps, marketPublishEnvFromProcess, publishPersonalPlugin } from './market-publish.ts'

export const SUBMIT_PLUGIN_TO_MARKET_TOOL_NAME = 'submit_plugin_to_market'

export function defineSubmitPluginToMarketTool(deps: { readonly tenantDeps: TenantDeps }): ToolDefinition {
  return {
    name: SUBMIT_PLUGIN_TO_MARKET_TOOL_NAME,
    description:
      '把你开发在个人 plugins 目录下的工具型插件一键发布到 EternaAgent 官方插件仓库(自动完成:bundle 化改写 → 仓库分支 commit → 零漂移校验 → push → 开 PR)。' +
      'plugin 是你的 plugins 目录下的子目录名。发布要求:纯 JS 入口(export function apply 或 default 导出实例,且用 ctx.tools.register 注册工具);' +
      'UI 型插件不支持。PR 合并后,管理员在「插件 → 发现」刷新索引即可安装给全员。' +
      '版本缺省自动递增;首次发布 0.1.0。',
    parameters: {
      type: 'object',
      properties: {
        plugin: { type: 'string', description: '插件目录名(你 plugins 目录下的子目录名)' },
        version: { type: 'string', description: '发布版本(x.y.z;缺省自动递增,首发 0.1.0)' },
        title: { type: 'string', description: '市场卡片标题(缺省取插件 package.json 的 description 或目录名)' },
        description: { type: 'string', description: '市场卡片描述(缺省同上)' },
        push: { type: 'boolean', description: '是否推送并开 PR(缺省 true;false = 只在本地仓库做分支提交,便于先自查)' },
      },
      required: ['plugin'],
    },
    output: {
      schema: { type: 'string' },
      render: (_args, value) => [{ type: 'text', text: typeof value === 'string' ? value : JSON.stringify(value) }],
    },
    async execute(args, exec) {
      const request = args as { plugin?: unknown; version?: unknown; title?: unknown; description?: unknown; push?: unknown }
      // 身份面:与 install_personal_plugin 同源(会话归属 → 登录账号;无主会话拒绝)。
      const session = exec.agent?.session as { readonly id?: string } | undefined
      const sessionId = session?.id
      if (typeof sessionId !== 'string' || sessionId === '') {
        return '拒绝:未能定位当前会话(插件发布仅对登录用户的会话开放)'
      }
      const userId = deps.tenantDeps.store.sessionOwner(sessionId)
      const user = userId !== undefined ? deps.tenantDeps.store.getUserById(userId) : undefined
      if (user === undefined) {
        return '拒绝:未能定位当前会话的登录账号(插件发布仅对登录用户开放)'
      }
      const plugin = typeof request.plugin === 'string' ? request.plugin.trim() : ''
      if (plugin === '') return '拒绝:plugin 必填(你的 plugins 目录下的插件目录名)'
      if (request.version !== undefined && typeof request.version !== 'string') return '拒绝:version 必须是字符串(x.y.z)'
      // exactOptionalPropertyTypes:可选键只在有值时进对象(条件展开)。
      const outcome = await publishPersonalPlugin(defaultMarketPublishDeps(), marketPublishEnvFromProcess(), {
        userRoot: userRootFor(deps.tenantDeps.tenantRoot, user.account),
        pluginDirName: plugin,
        author: user.account,
        push: request.push === undefined ? true : request.push === true,
        ...(typeof request.version === 'string' ? { version: request.version } : {}),
        ...(typeof request.title === 'string' ? { title: request.title } : {}),
        ...(typeof request.description === 'string' ? { description: request.description } : {}),
      })
      return outcome.message
    },
  }
}
