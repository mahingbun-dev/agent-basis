/**
 * memory 插件:createMemory + attachMemory(四工具 + ≤500 token 索引 section)。
 * PII 首选取 ctx.governance.pii(未挂则库内降级);索引头经 promptRegistry 服务读提示词注册表(T2.6,缺席回落内置)。
 */
import { join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import { attachMemory, createMemory, dshHost, resolvePromptRegistry } from '@eterna/memory'
import type { MemoryPluginConfig } from '../types.ts'

export const ETERNA_MEMORY_PLUGIN_NAME = 'eterna-memory'

export function defineMemoryPlugin(config: MemoryPluginConfig = {}) {
  return {
    name: ETERNA_MEMORY_PLUGIN_NAME,
    inject: { tools: true, systemPrompt: true, governance: false } as never,
    apply(ctx: Context): () => void {
      const cwd = process.cwd()
      const gov = (ctx as unknown as { governance?: { pii?: import('@eterna/governance').PiiFilter } }).governance
      const memory = createMemory({
        workspaceDir: config.notesDir ?? join(cwd, 'NOTES'),
        dbPath: config.dbPath ?? join(cwd, '.eterna/memory.sqlite3'),
        ...(gov?.pii !== undefined ? { pii: gov.pii } : {}),
      })
      const indexOptions: Parameters<typeof attachMemory>[2] = {
        ...(config.indexBudgetTokens !== undefined ? { index: { budgetTokens: config.indexBudgetTokens } } : {}),
      }
      return attachMemory(dshHost(ctx), memory, { ...indexOptions, promptSource: livePromptSource(ctx) })
    },
  }
}

// DSH bundle loader 取 default export 插件实例(对齐 @event/pack plugin.ts 形态)
export default defineMemoryPlugin()

/**
 * 活绑定的注册表读取面(T2.6 登记制):每次装配现取 promptRegistry 服务
 * (提示词工作室插件提供),插件装载顺序无关——工作室晚装载也不影响后续装配轮次;
 * 服务缺席/形状不符/读取异常由 resolvePromptRegistry 与 memory 兜底语义兜住
 * (回落内置行为指令头),宿主照常起。
 */
function livePromptSource(ctx: Context) {
  return {
    resolveRuntimePromptText: (entryId: string): string | undefined =>
      resolvePromptRegistry(ctx)?.resolveRuntimePromptText(entryId),
  }
}
