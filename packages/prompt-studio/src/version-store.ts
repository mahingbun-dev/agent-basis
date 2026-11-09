/**
 * 版本库(T7.1):落 DSH storage 栈——storage hub 的 json backend kv 单元
 * (dsh-base 行 storage + storage-json(root=dshHomePath('storages'))挂载)。
 *
 * 单元形态:per-record 布局(每个版本一份独立文档 <root>/eterna_prompt_studio/
 * versions/<id>.json,写一版只动一份文档;backend 侧 writeAtomic = 同目录临时文件
 * + fsync + rename 原子替换,见 dsh-storage-json lib/types/atomic.js)。
 *
 * 只增不删:本类不暴露任何删除原语;版本记录一经写入不可变。
 * 单写者串行:json backend 契约明确「write ordering belongs to the caller」
 * (KvUnit 注释),本类把全部读写(含 loadAll 读)串上同一条 Promise 链,
 * 并发 append 不会交错/丢写(单测钉住)。
 */
import { randomUUID } from 'node:crypto'
import type { KvUnit } from '@deepseek-ai/dsh-storage'
import { byteLength, sha256Hex } from './checksum.ts'
import type { PromptVersionRecord, VersionSource } from './types.ts'

/** 版本库单元名(UNIT_NAME_RE 口径:小写+下划线;也是 storages/ 下的目录名)。 */
export const VERSION_UNIT_NAME = 'eterna_prompt_studio'
/** 版本表名。 */
export const VERSIONS_TABLE = 'versions'

/** 打开版本库单元的描述符(dsh-storage KvUnitDescriptor)。 */
export const VERSION_UNIT_DESCRIPTOR = {
  name: VERSION_UNIT_NAME,
  version: 1,
  tables: [VERSIONS_TABLE],
  hasGlobal: false,
  layout: 'per-record',
} as const

/** 记录键必须是 path-safe(per-record 布局:键即文件名段)。 */
const SAFE_ID_RE = /^[A-Za-z0-9_-]+$/

/** append 输入(content 之外的字段由调用方给齐)。 */
export interface AppendVersionInput {
  readonly content: string
  readonly author: string
  readonly source: VersionSource
  readonly parentId: string | null
  readonly summary: string
}

/** 可注入时钟/ID 工厂(测试确定性)。 */
export interface VersionStoreOptions {
  readonly now?: () => Date
  readonly idFactory?: () => string
}

/** 默认 id:v-<6位seq>-<8位随机>;path-safe。 */
function defaultIdFactory(seq: number): string {
  return `v-${String(seq).padStart(6, '0')}-${randomUUID().slice(0, 8)}`
}

/** 从存储原始值恢复记录;形状不符(外来/损坏文档)返回 undefined(容错读)。 */
function recordOf(raw: unknown): PromptVersionRecord | undefined {
  if (typeof raw !== 'object' || raw === null) return undefined
  const value = raw as Record<string, unknown>
  if (typeof value['id'] !== 'string' || typeof value['seq'] !== 'number') return undefined
  if (typeof value['content'] !== 'string' || typeof value['checksum'] !== 'string') return undefined
  return {
    id: value['id'],
    seq: value['seq'],
    createdAt: typeof value['createdAt'] === 'string' ? value['createdAt'] : '',
    author: typeof value['author'] === 'string' ? value['author'] : '',
    source: (value['source'] === 'initial' || value['source'] === 'save'
      || value['source'] === 'rollback' || value['source'] === 'import')
      ? value['source']
      : 'save',
    parentId: value['parentId'] === null || typeof value['parentId'] === 'string' ? value['parentId'] : null,
    bytes: typeof value['bytes'] === 'number' ? value['bytes'] : byteLength(value['content']),
    checksum: value['checksum'],
    summary: typeof value['summary'] === 'string' ? value['summary'] : '',
    content: value['content'],
  }
}

/** 版本库:append-only + 单写者串行(全部操作上同一条链)。 */
export class PromptVersionStore {
  readonly #unit: KvUnit
  readonly #now: () => Date
  readonly #idFactory: (seq: number) => string
  /** 单写者链尾;每个操作排队执行,失败不吞(由调用方 await 观察)。 */
  #chain: Promise<unknown> = Promise.resolve()
  #closed = false

  constructor(unit: KvUnit, options: VersionStoreOptions = {}) {
    this.#unit = unit
    this.#now = options.now ?? (() => new Date())
    this.#idFactory = options.idFactory ?? defaultIdFactory
  }

  /** 追加一个版本(串行链内执行;返回的记录即持久化事实)。 */
  append(input: AppendVersionInput): Promise<PromptVersionRecord> {
    return this.#enqueue(async () => {
      this.#assertOpen()
      const total = await this.#loadRecords()
      const seq = total.reduce((max, record) => Math.max(max, record.seq), 0) + 1
      const record: PromptVersionRecord = {
        id: this.#idFactory(seq),
        seq,
        createdAt: this.#now().toISOString(),
        author: input.author,
        source: input.source,
        parentId: input.parentId,
        bytes: byteLength(input.content),
        checksum: sha256Hex(input.content),
        summary: input.summary,
        content: input.content,
      }
      if (!SAFE_ID_RE.test(record.id)) throw new Error(`版本 id 不是 path-safe:${record.id}`)
      await this.#unit.putRecord(VERSIONS_TABLE, record.id, record)
      return record
    })
  }

  /** 版本列表(新→旧;limit 缺省全部)。 */
  list(limit = Number.POSITIVE_INFINITY): Promise<readonly PromptVersionRecord[]> {
    return this.#enqueue(async () => {
      this.#assertOpen()
      const records = await this.#loadRecords()
      return [...records].reverse().slice(0, limit)
    })
  }

  /** 按 id 取版本。 */
  get(id: string): Promise<PromptVersionRecord | undefined> {
    return this.#enqueue(async () => {
      this.#assertOpen()
      const records = await this.#loadRecords()
      return records.find(record => record.id === id)
    })
  }

  /**
   * 种子初始版本:版本库为空且 persona 当前文本非空时,把当前 persona 记为
   * source='initial' 的 v1(「至少保留初始版本」基线;并发双叫只种一次)。
   */
  ensureInitial(content: string, author = 'system'): Promise<PromptVersionRecord | null> {
    return this.#enqueue(async () => {
      this.#assertOpen()
      const records = await this.#loadRecords()
      if (records.length > 0) return null
      if (content.trim().length === 0) return null
      const record: PromptVersionRecord = {
        id: this.#idFactory(1),
        seq: 1,
        createdAt: this.#now().toISOString(),
        author,
        source: 'initial',
        parentId: null,
        bytes: byteLength(content),
        checksum: sha256Hex(content),
        summary: '装载时种子的 persona 基线(profile patch 层现值)',
        content,
      }
      await this.#unit.putRecord(VERSIONS_TABLE, record.id, record)
      return record
    })
  }

  /** 释放底层单元(幂等;在途写全部排空后才关)。 */
  close(): Promise<void> {
    return this.#enqueue(async () => {
      this.#closed = true
      await this.#unit.close()
    })
  }

  #assertOpen(): void {
    if (this.#closed) throw new Error('版本库已关闭')
  }

  /** 上链执行(读也串行,保证 list/get 与并发 append 的一致视图)。 */
  #enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const run = this.#chain.then(operation, operation)
    this.#chain = run.catch(() => undefined)
    return run
  }

  /** 全量读(per-record loadAll)→ 按seq 升序;坏形状文档跳过(容错)。 */
  async #loadRecords(): Promise<readonly PromptVersionRecord[]> {
    const snapshot = await this.#unit.loadAll()
    const table = snapshot.tables[VERSIONS_TABLE] ?? {}
    const records: PromptVersionRecord[] = []
    for (const raw of Object.values(table)) {
      const record = recordOf(raw)
      if (record !== undefined) records.push(record)
    }
    return records.sort((a, b) => a.seq - b.seq)
  }
}
