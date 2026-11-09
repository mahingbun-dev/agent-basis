/**
 * Memory 服务组合层(M1 + M2 + PII 门 + 联合检索)。
 *
 * Cordis 纪律落实:
 * - **effect 配逆闭包**:writeEntity/writeNote 返回 undo(精确恢复写入前状态);
 *   forget = 应用逆**真删**(物理 DELETE,非打标);
 * - **coeffect 全声明**:不碰旁路全局——workspace 目录、sqlite 路径、PII 守卫、
 *   时钟全部构造注入;
 * - **provide 可交换**:以注册表 + 唯一 ID(MEMORY_SERVICE_ID = '@eterna/memory')
 *   形态对外;同 ID 重复注册先配逆旧的(由宿主的 effect 树负责,本层提供 dispose)。
 *
 * PII 纪律(设计文档 08 §5.2):一切写入先过 PII——writeEntity/writeNote/
 * appendNote 内部强制 assertClean(fail-closed:命中抛 PiiBlockedError,不落盘)。
 * 守卫首选注入 @eterna/governance 的 PiiFilter(结构满足 PiiGuard);未注入时
 * 降级 BuiltinPiiGuard(降级事实记入 blockers,见 README)。
 */
import { EntityMemoryStore } from './entity-store.ts'
import { buildEntityIndex } from './index-builder.ts'
import { NotesStore } from './notes.ts'
import { BuiltinPiiGuard } from './pii.ts'
import type { EntityRecord, EntitySearchOptions, EntityWriteInput, EntityWriteResult } from './entity-store.ts'
import type { MemoryIndexOptions, MemoryIndexResult } from './index-builder.ts'
import type { NoteWriteResult } from './notes.ts'
import type { PiiGuard } from './pii.ts'

/** 注册 ctx.memory 服务时的唯一 ID(注册表 + 唯一 ID 形态,provide 可交换)。 */
export const MEMORY_SERVICE_ID = '@eterna/memory'

/** M1+M2 联合检索命中(带出处)。 */
export interface MemorySearchHit {
  /** 出处锚点:entity → `entity:user:alice/preference#3`;note → `notes/venue.md#L4`。 */
  readonly source: string
  readonly kind: 'entity' | 'note'
  /** entity → `subject/key`;note → `file#Lline`。 */
  readonly title: string
  /** 一句话摘要(entity 摘要字段 / note 命中行摘录)。 */
  readonly summary: string
}

/** 联合检索选项(subject 限定 M2;limit 作用于合并结果)。 */
export interface MemorySearchOptions extends EntitySearchOptions {
  /** 是否同时检索 M1 notes 文件(默认 true)。 */
  readonly includeNotes?: boolean
}

/** Memory 服务接口(M1 NotesStore + M2 EntityMemoryStore 的门面)。 */
export interface Memory {
  readonly id: typeof MEMORY_SERVICE_ID
  /** M1 项目记忆存储(workspace NOTES 文件读写+检索)。 */
  readonly notes: NotesStore
  /** M2 实体记忆存储(sqlite 六列表)。 */
  readonly entities: EntityMemoryStore
  /** 实际生效的 PII 守卫(注入的 governance 实例或降级内置实现)。 */
  readonly piiGuard: PiiGuard
  /** M2 写入(PII 先行;返回携带应用逆闭包的结果)。 */
  writeEntity(input: EntityWriteInput): EntityWriteResult
  /** M1 覆盖写(PII 先行;undo 恢复原内容/删除新建文件)。 */
  writeNote(file: string, content: string): Promise<NoteWriteResult>
  /** M1 追加写(PII 先行;undo 恢复写入前全文/删除新建文件)。 */
  appendNote(file: string, content: string): Promise<NoteWriteResult>
  /** 读 M2 当前 live 行;不存在返回 null。 */
  readEntity(subject: string, key: string): EntityRecord | null
  /** M1+M2 联合检索(M2 排序在前,notes 随后;带出处)。 */
  search(query: string, options?: MemorySearchOptions): Promise<readonly MemorySearchHit[]>
  /** 遗忘 = 应用逆闭包真删:物理 DELETE 该 (subject, key) 全部行(live+历史)。 */
  forget(subject: string, key: string): { forgotten: number; records: readonly EntityRecord[] }
  /** 构建记忆索引(≤500 token;只含 M2 live 行,同步取数)。 */
  buildIndex(options?: MemoryIndexOptions): MemoryIndexResult
  /** 释放资源(关 sqlite;插件配逆时调用;幂等)。 */
  dispose(): void
}

/** createMemory 选项(coeffect 全声明:目录/库路径/PII 守卫/时钟全部注入)。 */
export interface MemoryOptions {
  /** M1 工作区根目录(NOTES 文件树的根)。 */
  readonly workspaceDir: string
  /** M2 sqlite 库文件路径(跨会话持久;':memory:' 仅单进程)。 */
  readonly dbPath: string
  /**
   * PII 守卫:首选注入 @eterna/governance 的 PiiFilter(组合层取 ctx.governance?.pii);
   * 缺省降级 BuiltinPiiGuard(四类通用模式镜像,降级事实须记 blockers)。
   */
  readonly pii?: PiiGuard
  /** 时钟注入(测试用;默认 Date.now)。 */
  readonly now?: () => number
}

/** 组装 Memory 服务实例(纯对象门面,无隐藏全局)。 */
export function createMemory(options: MemoryOptions): Memory {
  const piiGuard = options.pii ?? new BuiltinPiiGuard()
  const entities = new EntityMemoryStore(options.dbPath, ...(options.now !== undefined ? [{ now: options.now }] : []))
  const notes = new NotesStore(options.workspaceDir, piiGuard)
  let disposed = false
  return {
    id: MEMORY_SERVICE_ID,
    notes,
    entities,
    piiGuard,
    writeEntity(input: EntityWriteInput): EntityWriteResult {
      piiGuard.assertClean(
        { subject: input.subject, key: input.key, content: input.content, ...(input.summary !== undefined && { summary: input.summary }) },
        `entity:${input.subject}/${input.key}`,
      )
      return entities.write(input)
    },
    async writeNote(file: string, content: string): Promise<NoteWriteResult> {
      return notes.write(file, content)
    },
    async appendNote(file: string, content: string): Promise<NoteWriteResult> {
      return notes.append(file, content)
    },
    readEntity(subject: string, key: string): EntityRecord | null {
      return entities.read(subject, key)
    },
    async search(query: string, searchOptions: MemorySearchOptions = {}): Promise<readonly MemorySearchHit[]> {
      const limit = searchOptions.limit ?? 20
      const entityHits = entities.search(query, {
        ...(searchOptions.subject !== undefined && { subject: searchOptions.subject }),
        limit,
      }).map(hit => ({
        source: `entity:${hit.record.subject}/${hit.record.key}#${hit.record.id}`,
        kind: 'entity' as const,
        title: `${hit.record.subject}/${hit.record.key}`,
        summary: hit.record.summary ?? excerpt(hit.record.content),
      }))
      if (entityHits.length >= limit) return entityHits.slice(0, limit)
      if (searchOptions.includeNotes === false) return entityHits
      const noteHits = (await notes.search(query, { limit: limit - entityHits.length })).map(hit => ({
        source: `notes:${hit.source}`,
        kind: 'note' as const,
        title: hit.source,
        summary: hit.excerpt,
      }))
      return [...entityHits, ...noteHits]
    },
    forget(subject: string, key: string): { forgotten: number; records: readonly EntityRecord[] } {
      return entities.forget(subject, key)
    },
    buildIndex(indexOptions: MemoryIndexOptions = {}): MemoryIndexResult {
      return buildEntityIndex(entities.listLive(), indexOptions)
    },
    dispose(): void {
      if (disposed) return
      disposed = true
      entities.close()
    },
  }
}

function excerpt(content: string): string {
  const chars = Array.from(content.trim())
  return chars.length <= 60 ? chars.join('') : `${chars.slice(0, 60).join('')}…`
}
