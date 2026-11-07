/**
 * 审计记录与 sink 契约(独立于投影器,便于外部实现自定义 sink)。
 */
import { appendFile, mkdir } from 'node:fs/promises'
import { dirname } from 'node:path'

/**
 * 审计记录 actor 归属(企业插件设计 docs/design/enterprise-plugins.md §3.1:⑧要到插件
 * 粒度必须有归属字段;向后兼容的纯新增可选字段)。
 * - config:保护表声明的工具归属(@basis/audit A 面回填);
 * - decision:决策侧直投(令牌拒绝等经 report());
 * - install:三方准入流程事件(P2 准入流水线)。
 */
export interface AuditActor {
  readonly pluginId: string
  readonly source: 'config' | 'decision' | 'install'
}

/**
 * 审计记录(kind 判别的扁平形态,便于 NDJSON 落盘与外部消费)。
 * - turn-end:一轮结束(带结束原因)
 * - tool-call:一次工具调用(tool/call 与 tool/result 折叠配对)
 * - usage:一次模型调用的 token 计量(assistant/message.usage)
 * - governance:治理侧事件(预算违规、PII 拦截、egress 拒绝等)
 */
export interface AuditRecord {
  readonly kind: 'turn-end' | 'tool-call' | 'usage' | 'governance'
  /** 来源事件 seq(tool/call 记录用其 tool/call 的 seq)。 */
  readonly seq?: number
  /** ISO 时间(来自事件 time;governance 记录取投影时刻)。 */
  readonly at?: string
  readonly turn?: number
  readonly step?: number
  readonly tool?: string
  readonly callId?: string
  /** 工具参数预览(PII 脱敏 + 截断)。 */
  readonly argsPreview?: string
  /** 工具调用是否失败(tool/result.message.isError)。 */
  readonly isError?: boolean
  /** 失败名(tool/result.error.name)。 */
  readonly errorName?: string
  /** turn-end 的结束原因 kind(completed/aborted/blocked/error/max-tokens/...)。 */
  readonly reason?: string
  readonly usage?: { readonly inputTokens: number; readonly outputTokens: number; readonly totalTokens: number }
  /** governance 记录的自由明细。 */
  readonly detail?: Readonly<Record<string, unknown>>
  /** actor 归属(可选;governance 侧直投时从 detail.actor 提升,A 面从保护表回填)。 */
  readonly actor?: AuditActor
}

/** 审计 sink:记录落点。write 抛错不静默——由 AuditProjector.flush() 上抛。 */
export interface AuditSink {
  readonly label: string
  write(record: AuditRecord): Promise<void> | void
  flush?(): Promise<void> | void
}

/** 内存 sink(测试与进程内查询)。 */
export class MemoryAuditSink implements AuditSink {
  readonly label = 'memory'
  readonly records: AuditRecord[] = []

  write(record: AuditRecord): void {
    this.records.push(record)
  }
}

/** 文件 sink:NDJSON 追加写(每记录一行 JSON)。父目录按需创建。 */
export class FileAuditSink implements AuditSink {
  readonly label: string
  readonly filePath: string
  #dirReady: Promise<void> | undefined

  constructor(filePath: string, label = 'file') {
    this.filePath = filePath
    this.label = label
  }

  async write(record: AuditRecord): Promise<void> {
    await this.#ensureDir()
    await appendFile(this.filePath, `${JSON.stringify(record)}\n`, 'utf8')
  }

  async flush(): Promise<void> {
    await this.#ensureDir()
  }

  async #ensureDir(): Promise<void> {
    this.#dirReady ??= mkdir(dirname(this.filePath), { recursive: true }).then(() => undefined)
    await this.#dirReady
  }
}
