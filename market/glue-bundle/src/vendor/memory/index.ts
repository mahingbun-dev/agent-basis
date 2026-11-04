/**
 * @basis/memory —— L1 记忆插件(M1 项目记忆 + M2 实体记忆)。
 *
 * 模块地图:
 * 1. tokens.ts:token 保守估算(注入预算度量衡,CJK 1/字 + 其他 4 字符/token);
 * 2. pii.ts:PII 写入守卫注入接口(PiiGuard)+ 内置降级实现(BuiltinPiiGuard,
 *    governance 未就绪时兜底;governance PiiFilter 结构满足 PiiGuard 可直接注入);
 * 3. notes.ts:M1 项目记忆——workspace NOTES 文件读写+检索,路径安全,写入过 PII,
 *    write/append 返回 undo(effect 配逆);
 * 4. entity-store.ts:M2 实体记忆——node:sqlite 六列表(subject/key/content/
 *    valid_at/invalid_at/confidence),同键顶替+全历史,write 返回 undo,
 *    forget 物理真删;
 * 5. index-builder.ts:记忆索引(≤500 token,key+一句话摘要,装不下低优先截断);
 * 6. memory.ts:Memory 服务组合层(注册表+唯一 ID 形态,coeffect 全声明);
 * 7. tools.ts:四个模型面工具(defineTool)+ systemPrompt 索引 section +
 *    MemoryHost seam(dshHost 适配真实 ctx.tools/ctx.systemPrompt)。
 *
 * Cordis 纪律:effect 配逆(write.undo / forget 真删 / attachMemory 总 disposer);
 * coeffect 全声明(workspaceDir/dbPath/pii/now 构造注入,不碰全局);provide 可交换
 * (MEMORY_SERVICE_ID 唯一 ID;同 ID 重复注册先配逆旧的由宿主 effect 树负责)。
 *
 * seam 编译期钉住(防 DSH pre-stable 漂移)见 tests/types.seam-pin.ts。
 */
export { BuiltinPiiGuard, BUILTIN_PII_PATTERNS, isPiiBlockedError, PiiBlockedError } from './pii.ts'
export type { PiiFinding, PiiGuard } from './pii.ts'
export { NotesStore, tokenize } from './notes.ts'
export type { NoteHit, NoteSearchOptions, NoteWriteResult } from './notes.ts'
export { EntityMemoryStore } from './entity-store.ts'
export type {
  EntityRecord, EntitySearchHit, EntitySearchOptions, EntityWriteInput, EntityWriteResult,
} from './entity-store.ts'
export { buildEntityIndex } from './index-builder.ts'
export type { MemoryIndexOptions, MemoryIndexResult } from './index-builder.ts'
export { MEMORY_INDEX_BUDGET_TOKENS, estimateTokens } from './tokens.ts'
export { createMemory, MEMORY_SERVICE_ID } from './memory.ts'
export type { Memory, MemoryOptions, MemorySearchHit, MemorySearchOptions } from './memory.ts'
export {
  attachMemory, createMemoryIndexSection, defineMemoryTools, dshHost,
  MEMORY_INDEX_SECTION_NAME, MEMORY_INDEX_SECTION_ORDER, MEMORY_TOOL_NAMES,
} from './tools.ts'
export type { AttachMemoryOptions, MemoryHost } from './tools.ts'
