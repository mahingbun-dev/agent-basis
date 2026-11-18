/**
 * schema 版本与迁移机制(35 号 A11;34 号 §2.3 schema 行)。
 *
 * 设计依据:SA src/app/migration.ts 的版本守卫面(store.ts:66-67 的拒开判定)原样;
 * 本仓首版直接建 v1,不搬 SA 的 schema 10→11 迁移史(34 号 §2.3 明确)。迁移机制保留:
 * - 前向守卫:库版本号高于 SCHEMA_VERSION 拒开(未来版本写的库,本版本不误读);
 * - tooOld 拒开:低于 OLDEST_SCHEMA 的库请求换新状态目录;
 * - 未来升版:在 store.ts 构造器的事务内按 version 逐级迁移并回写本常量,
 *   SCHEMA_VERSION 提升纳入双 tag 发布检查(31 号拍板,34 号 §2.3 schema 行)。
 */
export const SCHEMA_VERSION = 1
/** 本版本能直接打开并迁移的最老库 schema 版本。 */
export const OLDEST_SCHEMA = 1
/** 解释 `version` 为何拒开:过老的库请换新状态目录。 */
export const tooOld = (version: number): string =>
  `tasks 数据库 schema ${version} 早于本版本可迁移的 schema ${OLDEST_SCHEMA};请换用新的状态目录`
