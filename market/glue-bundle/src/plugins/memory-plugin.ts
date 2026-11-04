/**
 * memory 插件:createMemory + attachMemory(四工具 + ≤500 token 索引 section)。
 * PII 首选取 ctx.governance.pii(未挂 governance 插件则库内降级,降级事实由 memory 包声明)。
 */
import { join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import { attachMemory, createMemory, dshHost } from '../vendor/memory/index.ts'
import type { MemoryPluginConfig } from '../types.ts'

export const BASIS_MEMORY_PLUGIN_NAME = 'basis-memory'

export function defineMemoryPlugin(config: MemoryPluginConfig = {}) {
  return {
    name: BASIS_MEMORY_PLUGIN_NAME,
    inject: { tools: true, systemPrompt: true, governance: false } as never,
    apply(ctx: Context): () => void {
      const cwd = process.cwd()
      const gov = (ctx as unknown as { governance?: { pii?: import('../vendor/governance/index.ts').PiiFilter } }).governance
      const memory = createMemory({
        workspaceDir: config.notesDir ?? join(cwd, 'NOTES'),
        dbPath: config.dbPath ?? join(cwd, '.basis/memory.sqlite3'),
        ...(gov?.pii !== undefined ? { pii: gov.pii } : {}),
      })
      const indexOptions: Parameters<typeof attachMemory>[2] = {
        ...(config.indexBudgetTokens !== undefined ? { index: { budgetTokens: config.indexBudgetTokens } } : {}),
      }
      return attachMemory(dshHost(ctx), memory, indexOptions)
    },
  }
}

// DSH bundle loader 取 default export 插件实例(对齐 @event/pack plugin.ts 形态)
export default defineMemoryPlugin()
