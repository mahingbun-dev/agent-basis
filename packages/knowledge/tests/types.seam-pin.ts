/**
 * DSH seam 编译期钉住(只被 tsc --noEmit 消费;vitest include 只收 *.spec.ts,不运行本文件)。
 *
 * 目的(设计文档 08 §8 风险 1,与 governance 同款做法):DSH pre-stable,适配面用已发布类型钉住。
 * 依据(deepseek-harness,只读):
 * - packages/tools(发布名 @deepseek-ai/dsh-tools)lib/types/contracts.ts:ToolDefinition(name/description/
 *   parameters/output{schema,render}/execute(args, exec))、ToolRunContext(signal 取消);
 * - packages/tools lib/types/json-schema.ts:JsonSchemaNode(强制 JSON Schema 子集);
 * - packages/tools lib/types/index.ts:ToolsService.register(definition, options?) => () => void(Cordis
 *   disposer 形态——本包知识工具的注册即拿即配逆)。
 *
 * 若 DSH 升级破坏这些形态,`pnpm --filter @eterna/knowledge run verify` 的 tsc 阶段即失败。
 */
import type { Context } from '@deepseek-ai/cordis'
import type { ToolDefinition } from '@deepseek-ai/dsh-tools'
import { createKnowledgeService, toDshToolDefinition, toDshTools } from '../src/index.ts'
import { buildKnowledgeTools } from '../src/tools.ts'

const service = createKnowledgeService()
const tools = buildKnowledgeTools(service)

/** 钉住 ①:四工具适配产物可直接赋给官方 ToolDefinition(output.schema/render/execute 形态一致)。 */
export const pinnedToolDefinitions: readonly ToolDefinition[] = toDshTools(service)

/** 钉住 ②:单个 spec 适配同样成立。 */
export const pinnedSingle: ToolDefinition = toDshToolDefinition(tools.search)

/** 钉住 ③:官方 ToolsService.register 接受适配产物,返回的 disposer 即配逆闭包(Cordis effect 纪律)。 */
declare const ctx: Context
export const registerKnowledgeTools: () => void = () => {
  const disposers = toDshTools(service).map(definition => ctx.tools.register(definition))
  for (const dispose of disposers) dispose()
}

/** 钉住 ④:render 把规范值投影为模型内容块(text 块形态对齐 dsh-llm ContentBlock)。 */
export const renderedBlocks = pinnedSingle.output.render({ query: 'x' }, { ok: true })
if (renderedBlocks[0]?.type !== 'text') throw new Error('render 应产出 text 内容块')

service.dispose()
