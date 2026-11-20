/** @basis/llm —— LLM provider 路由(openai-completions 语义)。 */
export { LlmRegistryImpl } from './registry.ts'
export { createOpenAiCompatProvider, assembleStream } from './openai.ts'
export type { ProviderOptions } from './openai.ts'
export { LLM_PLUGIN_NAME, defineLlmPlugin } from './plugin.ts'
export type { LlmPluginConfig } from './plugin.ts'
export { default } from './plugin.ts'
