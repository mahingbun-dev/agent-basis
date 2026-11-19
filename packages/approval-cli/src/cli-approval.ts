/**
 * CLI 审批面:请求 → approval/asked(留痕信号)→ 逐行 y/n(可附理由)→ approval/decided。
 * 结论映射:y/yes = allowed-once;n/no = rejected;EOF/中断 = cancelled。
 */
import type { ApprovalOutcome, ApprovalRequest, ApprovalService, RiskTier } from '@core/contracts'

/** 交互面(io 注入,可测)。 */
export interface ApprovalIo {
  writeLine(line: string): void
  readLine(prompt: string): Promise<string | null>
}

export interface ApprovalCliOptions {
  readonly io: ApprovalIo
  /** asked/decided 留痕信号(插件装配层接 ctx.events.emit + session 落盘)。 */
  readonly onAsked?: (request: ApprovalRequest) => void
  readonly onDecided?: (request: ApprovalRequest, outcome: ApprovalOutcome) => void
}

function formatRequest(request: ApprovalRequest): string {
  const tier: RiskTier = request.riskTier
  const lines = [
    `⚠ 审批请求 [${tier}] ${request.tool}(${request.id.slice(0, 8)})`,
    ...request.reasons.map(reason => `  - ${reason}`),
  ]
  if (request.args !== undefined) {
    const preview = JSON.stringify(request.args)
    lines.push(`  args: ${preview.length > 300 ? `${preview.slice(0, 300)}…` : preview}`)
  }
  return lines.join('\n')
}

export class ApprovalCli implements ApprovalService {
  private readonly io: ApprovalIo
  private readonly onAsked: ((request: ApprovalRequest) => void) | undefined
  private readonly onDecided: ((request: ApprovalRequest, outcome: ApprovalOutcome) => void) | undefined

  constructor(options: ApprovalCliOptions) {
    this.io = options.io
    this.onAsked = options.onAsked
    this.onDecided = options.onDecided
  }

  /** 发起审批并等待结论;asked 必然先于 decided(留痕配对,session 侧按 id 关联)。 */
  async request(request: ApprovalRequest): Promise<ApprovalOutcome> {
    this.io.writeLine(formatRequest(request))
    this.onAsked?.(request)
    const answer = await this.io.readLine('批准? [y/n]:')
    let outcome: ApprovalOutcome
    if (answer === null) {
      outcome = 'cancelled'
    } else {
      const normalized = answer.trim().toLowerCase()
      if (normalized === 'y' || normalized === 'yes') outcome = 'allowed-once'
      else if (normalized.length === 0) outcome = 'cancelled'
      else outcome = 'rejected'
    }
    this.onDecided?.(request, outcome)
    return outcome
  }
}
