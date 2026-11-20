/**
 * systemPrompt 插件:provide ctx.systemPrompt(default export 实例,装载纪律 1)。
 */
import type { Context } from '@core/cordis'
import { PromptRegistryImpl } from './registry.ts'

export const SYSTEM_PROMPT_PLUGIN_NAME = 'basis-system-prompt'

export function defineSystemPromptPlugin() {
  return {
    name: SYSTEM_PROMPT_PLUGIN_NAME,
    apply(ctx: Context): () => void {
      const registry = new PromptRegistryImpl()
      return ctx.provide('systemPrompt', registry)
    },
  }
}

export default defineSystemPromptPlugin()
