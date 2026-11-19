/**
 * tools 插件:provide ctx.tools(注册表 + 执行器;执行器为运行时附加面,
 * loop 经 @basis/tools 的 createToolExecutor 显式获取)。
 */
import type { Context } from '@core/cordis'
import type { ToolRegistry } from '@core/contracts'
import { ToolRegistryImpl } from './registry.ts'
import { createToolExecutor } from './executor.ts'

export const TOOLS_PLUGIN_NAME = 'basis-tools'

export function defineToolsPlugin() {
  return {
    name: TOOLS_PLUGIN_NAME,
    apply(ctx: Context): () => void {
      const registry = new ToolRegistryImpl()
      const executor = createToolExecutor(ctx, registry)
      const expose = Object.assign(registry, { exec: (...args: Parameters<typeof executor.exec>) => executor.exec(...args) }) as ToolRegistry & { exec: (input: Parameters<typeof executor.exec>[0]) => Promise<import('@core/contracts').ToolResult> }
      return ctx.provide('tools', expose)
    },
  }
}

export default defineToolsPlugin()
