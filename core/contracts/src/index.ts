/** @core/contracts —— 全仓库唯一 seam 契约点。 */
export * from './content.ts'
export * from './json-schema.ts'
export * from './tools.ts'
export * from './llm.ts'
export * from './agents.ts'
export * from './session.ts'
export * from './prompts.ts'
export * from './approval.ts'
export * from './questions.ts'
export * from './presets.ts'
export * from './kv.ts'
// Context/Events 增强:import 本包即生效(模块副作用仅为类型面)。
import './augment.ts'
