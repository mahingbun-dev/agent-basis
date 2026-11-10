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
import { DEFAULT_ENTRY_ID } from './registry.ts'
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

/** append 输入(content 之外的字段由调用方给齐;entryId 缺省=默认条目 persona)。 */
export interface AppendVersionInput {
  readonly content: string
  readonly author: string
  readonly source: VersionSource
  readonly parentId: string | null
  readonly summary: string
  /** 归属注册表条目 id(T1.4 起按条目分链;缺省=DEFAULT_ENTRY_ID,与 T7 单链时代等价)。 */
  readonly entryId?: string
}

/**
 * 可注入时钟/ID 工厂(测试确定性)。idFactory 收 (seq, entryId):
 * T1.4 起 seq 是链内编号(各链各自 1..N),仅凭 seq 的确定性工厂会跨链产出同 id
 * —— per-record 布局键=id,同 id 落盘即静默覆盖他链记录(丢版本),append 对
 * id 冲突 fail-closed 抛错。工厂必须保证 id 全局唯一(默认工厂带随机后缀)。
 */
export interface VersionStoreOptions {
  readonly now?: () => Date
  readonly idFactory?: (seq: number, entryId: string) => string
}

/** 默认 id:v-<6位链内seq>-<8位随机>;path-safe,随机后缀保证全局唯一。 */
function defaultIdFactory(seq: number): string {
  return `v-${String(seq).padStart(6, '0')}-${randomUUID().slice(0, 8)}`
}

/**
 * 从存储原始值恢复记录;形状不符(外来/损坏文档)返回 undefined(容错读)。
 * v1 存量记录(persona 单条时代,无 entryId 字段——形状即 t7-smoke 每轮在
 * storages/eterna_prompt_studio/versions/ 产生的 JSON 文档)默认归 persona 条目:
 * 仍可读、不丢(测试计划 §3 T1.4 ⑤ 存量数据兼容;fixture 钉住)。
 */
function recordOf(raw: unknown): PromptVersionRecord | undefined {
  if (typeof raw !== 'object' || raw === null) return undefined
  const value = raw as Record<string, unknown>
  if (typeof value['id'] !== 'string' || typeof value['seq'] !== 'number') return undefined
  if (typeof value['content'] !== 'string' || typeof value['checksum'] !== 'string') return undefined
  return {
    id: value['id'],
    seq: value['seq'],
    entryId: typeof value['entryId'] === 'string' && value['entryId'] !== '' ? value['entryId'] : DEFAULT_ENTRY_ID,
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
  readonly #idFactory: (seq: number, entryId: string) => string
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
      const entryId = input.entryId ?? DEFAULT_ENTRY_ID
      const total = await this.#loadRecords()
      // T1.4 起 seq 按条目分链编号(每链内 1..N 单调;记录 id 仍全局唯一)。
      const seq = total.reduce((max, record) => (record.entryId === entryId ? Math.max(max, record.seq) : max), 0) + 1
      const record: PromptVersionRecord = {
        id: this.#idFactory(seq, entryId),
        seq,
        entryId,
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
      // id 全局唯一守卫(fail-closed):per-record 布局键=id,同 id putRecord 会静默
      // 覆盖既有记录(丢版本)——注入的确定性 idFactory 跨链撞 id 时在此显式抛错。
      if (total.some(existing => existing.id === record.id)) {
        throw new Error(`版本 id 冲突:${record.id} 已存在(id 工厂须保证全局唯一;seq 是链内编号,仅凭 seq 生成 id 会跨链相撞)`)
      }
      await this.#unit.putRecord(VERSIONS_TABLE, record.id, record)
      return record
    })
  }

  /**
   * 版本列表(只读;limit 缺省全部):
   * - 指定 entryId → 该条目链,链内新→旧(seq 降序);
   * - 不指定 entryId → 全部条目,契约:按 entryId 字典序**降序**分组(底层
   *   (entryId,seq) 升序快照整体反转),组内同样新→旧——T1.6+ 写链路泛化复用
   *   本 API 时依赖此确定性顺序(无参形态仅内部/诊断使用,网关端点一律显式传条目)。
   */
  list(limit = Number.POSITIVE_INFINITY, entryId?: string): Promise<readonly PromptVersionRecord[]> {
    return this.#enqueue(async () => {
      this.#assertOpen()
      const records = await this.#loadRecords()
      const chain = entryId === undefined ? records : records.filter(record => record.entryId === entryId)
      return [...chain].reverse().slice(0, limit)
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
   * 种子初始版本(T1.4 起按条目):该条目链为空且当前文本非空时,把当前值记为
   * source='initial' 的链首 v1(「至少保留初始版本」基线;并发双叫只种一次)。
   * entryId 缺省=persona(T7 既有语义,旧调用零改动)。
   */
  ensureInitial(content: string, author = 'system', entryId = DEFAULT_ENTRY_ID): Promise<PromptVersionRecord | null> {
    return this.#enqueue(async () => {
      this.#assertOpen()
      const records = await this.#loadRecords()
      if (records.some(record => record.entryId === entryId)) return null
      if (content.trim().length === 0) return null
      const record: PromptVersionRecord = {
        id: this.#idFactory(1, entryId),
        seq: 1,
        entryId,
        createdAt: this.#now().toISOString(),
        author,
        source: 'initial',
        parentId: null,
        bytes: byteLength(content),
        checksum: sha256Hex(content),
        summary: `装载时种子的条目基线(${entryId} 现值)`,
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

  /** 全量读(per-record loadAll)→ 按 (entryId,seq) 升序;坏形状文档跳过(容错)。 */
  async #loadRecords(): Promise<readonly PromptVersionRecord[]> {
    const snapshot = await this.#unit.loadAll()
    const table = snapshot.tables[VERSIONS_TABLE] ?? {}
    const records: PromptVersionRecord[] = []
    for (const raw of Object.values(table)) {
      const record = recordOf(raw)
      if (record !== undefined) records.push(record)
    }
    return records.sort((a, b) => (a.entryId === b.entryId ? a.seq - b.seq : a.entryId < b.entryId ? -1 : 1))
  }
}
