/**
 * 审计留痕(T7.1;G5:审计事件含操作者/时间/版本号)。
 *
 * 落点优先级:
 * 1. `ctx.governance` 服务(glue governance-plugin)挂了 AuditProjector 时,
 *    经其 reportGovernance 走既有 sink 链(含 FileAuditSink 的 .basis/audit.jsonl);
 * 2. 缺席时(如 t7 冒烟 profile 未装 glue)退回本包自有 AuditProjector +
 *    FileAuditSink,写 `<DSH_HOME>/basis-prompt-studio/audit.jsonl`(NDJSON,
 *    记录形态与 governance sink 契约一致:kind='governance' + detail)。
 *
 * 记录形:{ kind:'governance', at, detail:{ system, action, operator, versionId, ... } }。
 */
import { join } from 'node:path'
import { AuditProjector, FileAuditSink, MemoryAuditSink } from '@basis/governance'
import type { AuditRecord } from '@basis/governance'

/** governance 服务的最小结构面( glue GovernanceWorld.audit 可缺席)。 */
export interface GovernanceAuditLike {
  readonly audit?: { readonly reportGovernance: (detail: Readonly<Record<string, unknown>>) => readonly AuditRecord[] }
}

export interface StudioAuditOptions {
  /** 惰性解析 governance 服务(每次写时解析,容忍 glue 后挂载)。 */
  readonly resolveGovernance?: () => GovernanceAuditLike | undefined
  /** 兜底 NDJSON 文件路径(<DSH_HOME>/basis-prompt-studio/audit.jsonl)。 */
  readonly fallbackFilePath: string
  /** 记录里的 system 常量。 */
  readonly system?: string
  /** 测试注入内存 sink(与文件 sink 并存,便于断言)。 */
  readonly memorySink?: MemoryAuditSink
}

/** 审计面:一条写操作一条记录;写失败不吞(flush 上抛)。 */
export class StudioAudit {
  readonly #fallback: AuditProjector
  readonly #memory: MemoryAuditSink | undefined
  readonly #resolveGovernance: () => GovernanceAuditLike | undefined
  readonly #system: string

  constructor(options: StudioAuditOptions) {
    this.#memory = options.memorySink
    this.#fallback = new AuditProjector({
      sinks: [
        ...(options.memorySink !== undefined ? [options.memorySink] : []),
        new FileAuditSink(options.fallbackFilePath, 'prompt-studio-file'),
      ],
    })
    this.#resolveGovernance = options.resolveGovernance ?? (() => undefined)
    this.#system = options.system ?? 'basis-prompt-studio'
  }

  /**
   * 记一条治理事件。governance 服务在场走它;否则走兜底 FileAuditSink。
   * detail 至少含 action/operator(操作者)/versionId(版本号)/at(时间)——G5 口径。
   */
  write(action: string, detail: Readonly<Record<string, unknown>> = {}): void {
    const payload: Record<string, unknown> = {
      system: this.#system,
      action,
      at: new Date().toISOString(),
      ...detail,
    }
    const governance = this.#resolveGovernance()
    const projector = governance?.audit
    if (projector !== undefined) {
      projector.reportGovernance(payload)
      return
    }
    this.#fallback.reportGovernance(payload)
  }

  /** 兜底 sink 落账屏障(测试断言前 await)。 */
  async flush(): Promise<void> {
    await this.#fallback.flush()
  }

  /** 测试/诊断:内存镜像记录(注入 memorySink 时)。 */
  memoryRecords(): readonly AuditRecord[] {
    return this.#memory?.records ?? []
  }
}

/** 兜底审计文件默认路径:<home>/basis-prompt-studio/audit.jsonl。 */
export function defaultAuditFilePath(home: string): string {
  return join(home, 'basis-prompt-studio', 'audit.jsonl')
}
