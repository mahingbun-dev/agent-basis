/** 规范化块子路径门面(36 号 §2.2 exports "./blocks")。 */
export { BLOCK_PROTOCOL_STATUS, normalizePublishTime } from './types.ts'
export type {
  SourceBlock,
  CitationBlock,
  SearchStepBlock,
  AttachmentRefBlock,
  NormalizedBlock,
  BlockType,
  SearchStepAction,
} from './types.ts'
export {
  BLOCK_KEY_WHITELIST,
  BlockLeakError,
  findBlockLeaks,
  assertBlocksSerializable,
  serializeBlocks,
} from './guards.ts'
export type { BlockLeak } from './guards.ts'
