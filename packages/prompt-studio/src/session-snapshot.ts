/**
 * 会话快照(T2.3,计划书 §6「会话开启事件→快照 effective prompt 入 DSH_HOME
 * 语义存储(含条目版本指针)」;测试计划 §4 T2.3 + §6.7 快照不可变性):
 *
 * 存储:沿用版本库 json backend 单元先例(version-store.ts)——storage hub 的
 * json backend kv 独立单元(storages/eterna_prompt_snapshots/snapshots/,
 * per-record 一文档一记录,backend writeAtomic 原子替换)。只增不改:本类不暴露
 * 任何删除/改写原语;快照一经写入不可变(单测钉死方法面);同 sessionId 二次
 * append fail-closed 抛错(per-record 键=id,静默覆盖即丢快照)。
 *
 * 捕获:纯函数 captureSessionSnapshotEntries——注册表全部条目按型别分语义快照
 * (patch 值型=开启时生效文本+内容一致版本指针;运行时注入型=开启时可解析的
 * section 文本或在场标记。2026-11-11 用户裁定后注册表不含行锚点只读型条目)。
 * 指针按 checksum 对链内版本逐条匹配(新→旧取首个一致者):text 与 versionId
 * 由同一 checksum 约束绑定,写入并发下不出现「指针指向 v1、文本是 v2」的混合
 * 版本(原子性,§6.7④;无一致版本 → versionId=null+annotation 明示,不伪造)。
 */
import { randomUUID } from 'node:crypto'
import type { KvUnit } from '@deepseek-ai/dsh-storage'
import { byteLength, sha256Hex } from './checksum.ts'
import type { PromptRegistryEntry, RegistryFileReader } from './registry.ts'
import { readEntryText } from './registry.ts'
import type { PromptVersionRecord, SessionSnapshotEntry, SessionSnapshotRecord } from './types.ts'

/** 快照库单元名(UNIT_NAME_RE 口径:小写+下划线;storages/ 下的目录名)。 */
export const SNAPSHOT_UNIT_NAME = 'eterna_prompt_snapshots'
/** 快照表名。 */
export const SNAPSHOTS_TABLE = 'snapshots'

/** 打开快照库单元的描述符(同 version-store 先例:per-record、无 global)。 */
export const SNAPSHOT_UNIT_DESCRIPTOR = {
  name: SNAPSHOT_UNIT_NAME,
  version: 1,
  tables: [SNAPSHOTS_TABLE],
  hasGlobal: false,
  layout: 'per-record',
} as const

/** 记录键 path-safe 守卫复用口径(per-record 布局:键即文件名段)。 */
const SAFE_ID_RE = /^[A-Za-z0-9_-]+$/

/** 捕获触发事件(当前唯一来源:dsh-session 的 session/created 全局监听)。 */
export const SESSION_CREATED_TRIGGER = 'session/created'

/** 运行时注入型条目无文本可解析时的在场标记标注。 */
export const RUNTIME_NO_TEXT_ANNOTATION = '运行时注入:文本由代码在装配时构建,快照仅记在场标记(无注册表自管文本)。'

/** 运行时注入型条目有可解析文本时的标注。 */
export const RUNTIME_TEXT_ANNOTATION = '运行时注入:开启时从注册表自管文本解析(随版本链变化)。'

/** patch 值型现值与版本链无一致版本时的指针明示(不伪造)。 */
export const NO_MATCHING_VERSION_ANNOTATION = '现值与版本链无内容一致版本(外部改写或写入在途),不伪造版本指针。'

/** patch 值型读值失败时的标注(problems 记明细,不冒充空内容)。 */
export const UNREADABLE_ANNOTATION = '开启时读值失败(结构定位/反引失败),快照无该条目文本。'

/** append 输入(sessionId/trigger 之外的内容面)。 */
export interface AppendSnapshotInput {
  readonly sessionId: string
  readonly trigger: string
  readonly entries: readonly SessionSnapshotEntry[]
}

/** 可注入时钟/ID 工厂(测试确定性)。 */
export interface SnapshotStoreOptions {
  readonly now?: () => Date
  readonly idFactory?: (sessionId: string) => string
}

/** 默认 id:ss-<8位随机>(path-safe;与 sessionId 解耦,键唯一性由库侧守卫)。 */
function defaultIdFactory(): string {
  return `ss-${randomUUID().slice(0, 8)}`
}

/**
 * 从存储原始值恢复记录;形状不符(外来/损坏文档)返回 undefined(容错读,
 * 同 version-store recordOf 口径)。
 */
function recordOf(raw: unknown): SessionSnapshotRecord | undefined {
  if (typeof raw !== 'object' || raw === null) return undefined
  const value = raw as Record<string, unknown>
  if (typeof value['id'] !== 'string' || typeof value['sessionId'] !== 'string') return undefined
  if (typeof value['createdAt'] !== 'string' || typeof value['trigger'] !== 'string') return undefined
  if (typeof value['checksum'] !== 'string' || !Array.isArray(value['entries'])) return undefined
  return {
    id: value['id'],
    sessionId: value['sessionId'],
    createdAt: value['createdAt'],
    trigger: value['trigger'],
    entries: value['entries'] as readonly SessionSnapshotEntry[],
    checksum: value['checksum'],
  }
}

/**
 * 快照内容整体 checksum(sha256 of 规范化载荷):字段序由本函数唯一确定
 * (JSON.stringify 按对象字面量插入序),读回复核用同一函数——快照不可变的
 * 逐字节复核口径(§6.7①③)。
 */
export function sessionSnapshotChecksum(sessionId: string, trigger: string, entries: readonly SessionSnapshotEntry[]): string {
  return sha256Hex(JSON.stringify({ entries, sessionId, trigger }))
}

/**
 * 会话快照库:append-only + 单写者串行(全部操作上同一条链,同 version-store)。
 * 方法面 = append/list/get/getBySessionId/close,无任何删除/改写原语(测试钉死)。
 */
export class SessionSnapshotStore {
  readonly #unit: KvUnit
  readonly #now: () => Date
  readonly #idFactory: (sessionId: string) => string
  #chain: Promise<unknown> = Promise.resolve()
  #closed = false

  constructor(unit: KvUnit, options: SnapshotStoreOptions = {}) {
    this.#unit = unit
    this.#now = options.now ?? (() => new Date())
    this.#idFactory = options.idFactory ?? defaultIdFactory
  }

  /** 追加一份会话快照(串行链内执行;同 sessionId 已有快照 → fail-closed 抛错)。 */
  append(input: AppendSnapshotInput): Promise<SessionSnapshotRecord> {
    return this.#enqueue(async () => {
      this.#assertOpen()
      if (input.sessionId.trim() === '') throw new Error('sessionId 不能为空')
      const records = await this.#loadRecords()
      if (records.some(record => record.sessionId === input.sessionId)) {
        throw new Error(`会话 ${input.sessionId} 已有快照(只增不改;重复捕获由调用方幂等守卫拦在上游)`)
      }
      const record: SessionSnapshotRecord = {
        id: this.#idFactory(input.sessionId),
        sessionId: input.sessionId,
        createdAt: this.#now().toISOString(),
        trigger: input.trigger,
        entries: input.entries,
        checksum: sessionSnapshotChecksum(input.sessionId, input.trigger, input.entries),
      }
      if (!SAFE_ID_RE.test(record.id)) throw new Error(`快照 id 不是 path-safe:${record.id}`)
      await this.#unit.putRecord(SNAPSHOTS_TABLE, record.id, record)
      return record
    })
  }

  /**
   * 快照列表(只读;新→旧:createdAt 降序,同刻按 id 降序——时钟可注入同刻,
   * 稳定序保证列表确定性);limit 缺省全部。
   */
  list(limit = Number.POSITIVE_INFINITY): Promise<readonly SessionSnapshotRecord[]> {
    return this.#enqueue(async () => {
      this.#assertOpen()
      const records = await this.#loadRecords()
      return [...records]
        .sort((a, b) => (a.createdAt === b.createdAt ? (a.id < b.id ? 1 : -1) : (a.createdAt < b.createdAt ? 1 : -1)))
        .slice(0, limit)
    })
  }

  /** 按快照记录 id 取。 */
  get(id: string): Promise<SessionSnapshotRecord | undefined> {
    return this.#enqueue(async () => {
      this.#assertOpen()
      return (await this.#loadRecords()).find(record => record.id === id)
    })
  }

  /** 按会话 id 取(幂等守卫与查询共用)。 */
  getBySessionId(sessionId: string): Promise<SessionSnapshotRecord | undefined> {
    return this.#enqueue(async () => {
      this.#assertOpen()
      return (await this.#loadRecords()).find(record => record.sessionId === sessionId)
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
    if (this.#closed) throw new Error('快照库已关闭')
  }

  /** 上链执行(读也串行,保证 list/get 与并发 append 的一致视图)。 */
  #enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const run = this.#chain.then(operation, operation)
    this.#chain = run.catch(() => undefined)
    return run
  }

  /** 全量读 → createdAt 升序快照;坏形状文档跳过(容错)。 */
  async #loadRecords(): Promise<readonly SessionSnapshotRecord[]> {
    const snapshot = await this.#unit.loadAll()
    const table = snapshot.tables[SNAPSHOTS_TABLE] ?? {}
    const records: SessionSnapshotRecord[] = []
    for (const raw of Object.values(table)) {
      const record = recordOf(raw)
      if (record !== undefined) records.push(record)
    }
    return records
  }
}

// ---------- 捕获(纯函数;网关收集输入后调用) ----------

/** 捕获输入(全部由网关在同一次捕获里备齐;versionRecords=单次一致的链快照)。 */
export interface CaptureSnapshotInputs {
  /** 注册表全部条目(全景,含三型)。 */
  readonly entries: readonly PromptRegistryEntry[]
  /** 注册表运行时文件读取面(preset 层映射 live patch)。 */
  readonly readFile: RegistryFileReader
  /** 版本库单次一致读出的全部记录(store.list(),原子性输入面)。 */
  readonly versionRecords: readonly PromptVersionRecord[]
  /** 运行时注入条目的开启时可解析文本(T2.6 注册表自管缓存快照)。 */
  readonly runtimeTexts: ReadonlyMap<string, string>
}

/**
 * 捕获一次会话开启时刻的 effective prompt(纯函数,不落盘):
 * 逐条目按型别分语义产出快照条目;patch 值型的 versionId 与 text 由同一
 * checksum 绑定(见文件头「原子性」注)。
 */
export function captureSessionSnapshotEntries(input: CaptureSnapshotInputs): readonly SessionSnapshotEntry[] {
  const captured: SessionSnapshotEntry[] = []
  for (const entry of input.entries) {
    const base = { entryId: entry.id, layer: entry.layer, kind: entry.kind }
    if (entry.kind === 'runtime-injection') {
      const text = input.runtimeTexts.get(entry.id)
      captured.push(text === undefined
        ? {
          ...base,
          text: null, bytes: null, checksum: null, versionId: null,
          annotation: RUNTIME_NO_TEXT_ANNOTATION, problems: [],
        }
        : {
          ...base,
          text, bytes: byteLength(text), checksum: sha256Hex(text), versionId: null,
          annotation: RUNTIME_TEXT_ANNOTATION, problems: [],
        })
      continue
    }
    // patch 值型:live 文本 + checksum 一致版本指针(新→旧取首个一致者)。
    const read = readEntryText(entry, input.readFile)
    if (read.text === undefined || read.text === '') {
      captured.push({
        ...base,
        text: null,
        bytes: null,
        checksum: null,
        versionId: null,
        annotation: UNREADABLE_ANNOTATION,
        problems: read.problems.length > 0 ? read.problems : [`${entry.id}:反引值为空`],
      })
      continue
    }
    const text = read.text
    const checksum = sha256Hex(text)
    const matched = input.versionRecords.find(record => record.entryId === entry.id && record.checksum === checksum)
    captured.push({
      ...base,
      text,
      bytes: byteLength(text),
      checksum,
      versionId: matched?.id ?? null,
      annotation: matched === undefined ? NO_MATCHING_VERSION_ANNOTATION : null,
      problems: read.problems,
    })
  }
  return captured
}
