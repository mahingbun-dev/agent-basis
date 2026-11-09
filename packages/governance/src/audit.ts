/**
 * 审计投影:session 事件流 → 审计记录 + 内存/文件双 sink。
 *
 * 设计依据(设计文档 08 §2 会话事件主数据流、12 §4.2):
 * 一切可观测/审计的源头都是 DSH session 事件流;本投影把审计相关的事件
 * (turn/end、tool/call+tool/result 配对、assistant/message 的 usage)折叠为
 * 审计记录,推入全部 sink。工具参数预览强制过 PII 脱敏,超长截断。
 *
 * 事件 data 形态依据(deepseek-harness packages/core/session/src/types.ts:287-436 SessionEventMap):
 * - 'turn/end'         → { turn, reason: { kind, ... } }
 * - 'tool/call'        → { turn, step, callId, name, arguments(模型原始 JSON 字符串) }
 * - 'tool/result'      → { turn, step, message: { toolCallId, isError? }, error?: { name, code } }
 * - 'assistant/message'→ { turn, step, usage?: TokenUsage }
 */
import { isRecord } from './errors.ts'
import type { PiiFilter } from './pii.ts'
import { serializeArgs } from './rules.ts'
import type { AuditActor, AuditRecord, AuditSink } from './sink.ts'

export type { AuditRecord, AuditSink } from './sink.ts'
export { FileAuditSink, MemoryAuditSink } from './sink.ts'

export interface AuditProjectorOptions {
  readonly sinks: readonly AuditSink[]
  /** 可选 PII 过滤器:提供则对 argsPreview 脱敏。 */
  readonly pii?: PiiFilter
  /** 参数预览截断长度(默认 200)。 */
  readonly argsPreviewLimit?: number
}

/**
 * 审计投影器:projectEvent 为纯折叠(内部 pending 配对状态),并把产物推入全部 sink。
 * sink 写入异步执行,经内部链串行;失败不静默——flush() 处上抛首个写错误。
 */
export class AuditProjector {
  readonly #sinks: readonly AuditSink[]
  readonly #pii: PiiFilter | undefined
  readonly #argsPreviewLimit: number
  readonly #pending = new Map<string, PendingToolCall>()
  #writes: Promise<void> = Promise.resolve()
  #writeError: unknown

  constructor(options: AuditProjectorOptions) {
    if (options.sinks.length === 0) throw new RangeError('[governance] AuditProjector 至少需要一个 sink')
    this.#sinks = [...options.sinks]
    this.#pii = options.pii
    this.#argsPreviewLimit = options.argsPreviewLimit ?? 200
  }

  /** 投影一条事件:返回产生的审计记录(同时已入队写全部 sink)。未识别的事件类型返回空数组(前向兼容 66+ 事件类型)。 */
  projectEvent(event: AuditEventInput): readonly AuditRecord[] {
    const records: AuditRecord[] = []
    if (!isRecord(event.data)) return records
    switch (event.type) {
      case 'tool/call': {
        const key = asString(event.data['callId'])
        if (key !== '') {
          this.#pending.set(key, {
            seq: event.seq,
            turn: readNumber(event.data['turn']) ?? 0,
            step: readNumber(event.data['step']) ?? 0,
            tool: asString(event.data['name']),
            argsPreview: this.#preview(event.data['arguments']),
          })
        }
        break
      }
      case 'tool/result': {
        const message = event.data['message']
        if (!isRecord(message)) break
        const key = asString(message['toolCallId'])
        const pending = this.#pending.get(key)
        this.#pending.delete(key)
        const error = isRecord(event.data['error']) ? event.data['error'] : undefined
        const turn = pending?.turn ?? readNumber(event.data['turn'])
        const step = pending?.step ?? readNumber(event.data['step'])
        const tool = pending?.tool ?? ''
        const argsPreview = pending?.argsPreview ?? ''
        const errorName = error !== undefined && typeof error['name'] === 'string' ? error['name'] : undefined
        records.push({
          kind: 'tool-call',
          ...(pending?.seq !== undefined && { seq: pending.seq }),
          ...atOf(event),
          ...(turn !== undefined && { turn }),
          ...(step !== undefined && { step }),
          ...(tool !== '' && { tool }),
          ...(key !== '' && { callId: key }),
          ...(argsPreview !== '' && { argsPreview }),
          isError: message['isError'] === true,
          ...(errorName !== undefined && { errorName }),
        })
        break
      }
      case 'turn/end': {
        const turn = readNumber(event.data['turn'])
        const reason = isRecord(event.data['reason']) ? asString(event.data['reason']['kind']) : ''
        records.push({
          kind: 'turn-end',
          ...atOf(event),
          ...(event.seq !== undefined && { seq: event.seq }),
          ...(turn !== undefined && { turn }),
          ...(reason !== '' && { reason }),
        })
        break
      }
      case 'assistant/message': {
        const usage = event.data['usage']
        if (!isRecord(usage)) break
        const turn = readNumber(event.data['turn'])
        const step = readNumber(event.data['step'])
        records.push({
          kind: 'usage',
          ...atOf(event),
          ...(event.seq !== undefined && { seq: event.seq }),
          ...(turn !== undefined && { turn }),
          ...(step !== undefined && { step }),
          usage: {
            inputTokens: readNumber(usage['inputTokens']) ?? 0,
            outputTokens: readNumber(usage['outputTokens']) ?? 0,
            totalTokens: readNumber(usage['totalTokens']) ?? 0,
          },
        })
        break
      }
      default:
        break
    }
    for (const record of records) this.#enqueue(record)
    return records
  }

  /** 投影一段事件流(逐步调用 projectEvent)。 */
  project(events: Iterable<AuditEventInput>): readonly AuditRecord[] {
    const all: AuditRecord[] = []
    for (const event of events) {
      all.push(...this.projectEvent(event))
    }
    return all
  }

  /** 等待全部 sink 落账并上抛首个写错误(文件 sink 的显式屏障)。 */
  async flush(): Promise<void> {
    await this.#writes
    for (const sink of this.#sinks) {
      await sink.flush?.()
    }
    if (this.#writeError !== undefined) {
      throw this.#writeError instanceof Error ? this.#writeError : new Error(JSON.stringify(this.#writeError))
    }
  }

  /**
   * 直接投递一条治理侧记录(预算违规/令牌拒绝等)。detail.actor(如有)被提升为记录级
   * actor 字段(企业插件设计 §3.1:⑧插件粒度归属),不再重复出现在 detail 里。
   */
  reportGovernance(detail: Readonly<Record<string, unknown>> & { readonly actor?: AuditActor }): readonly AuditRecord[] {
    const { actor, ...rest } = detail
    const record: AuditRecord = {
      kind: 'governance',
      at: new Date().toISOString(),
      detail: rest,
      ...(actor !== undefined && { actor }),
    }
    this.#enqueue(record)
    return [record]
  }

  #enqueue(record: AuditRecord): void {
    this.#writes = this.#writes.then(async () => {
      for (const sink of this.#sinks) {
        await sink.write(record)
      }
    }).catch((error: unknown) => {
      this.#writeError ??= error
    })
  }

  #preview(rawArgs: unknown): string {
    if (rawArgs === undefined) return ''
    let text = typeof rawArgs === 'string' ? rawArgs : serializeArgs(rawArgs)
    if (this.#pii !== undefined) text = this.#pii.redact(text).text
    return text.length > this.#argsPreviewLimit ? `${text.slice(0, this.#argsPreviewLimit)}…` : text
  }
}

/** 投影入口接受的事件形态(结构兼容 dsh SessionEvent)。 */
export interface AuditEventInput {
  readonly type: string
  readonly data: unknown
  readonly seq?: number | undefined
  readonly time?: number | undefined
}

/** 已见 tool/call、待 tool/result 配对的中间态。 */
interface PendingToolCall {
  seq: number | undefined
  turn: number
  step: number
  tool: string
  argsPreview: string
}

function atOf(event: AuditEventInput): { at?: string } {
  const time = event.time
  return time !== undefined ? { at: new Date(time).toISOString() } : {}
}

function readNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value : ''
}
