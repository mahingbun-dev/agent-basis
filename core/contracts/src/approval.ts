/**
 * approval seam 契约:R0-R3 风险分档的人工审批面(v1 CLI 实现;后续 Web/通道复用同一契约)。
 * 发出 approval/asked + approval/decided 会话事件(留痕),由 session 插件落盘。
 */
import type { ContentBlock } from './content.ts'

/** HITL 风险档(对齐 interact 的 hitl.yaml 分档)。 */
export type RiskTier = 'R0' | 'R1' | 'R2' | 'R3'

/** 审批结论(对齐 dsh-user-approval 的 v1 子集)。 */
export type ApprovalOutcome = 'allowed-once' | 'rejected' | 'cancelled' | 'unavailable'

/** 一次审批请求。 */
export interface ApprovalRequest {
  readonly id: string
  /** 工具名(或任意动作名)。 */
  readonly tool: string
  /** 关联的工具调用 id(无工具场景缺省)。 */
  readonly callId?: string
  /** 请求参数(展示给审批人)。 */
  readonly args?: unknown
  /** 升级理由(每条一行展示)。 */
  readonly reasons: readonly string[]
  readonly riskTier: RiskTier
}

/** 审批服务面(ctx.approval 服务面)。 */
export interface ApprovalService {
  /** 发起审批并等待结论;实现方负责 approval/asked + approval/decided 留痕。 */
  request(request: ApprovalRequest): Promise<ApprovalOutcome>
}

/** 审批卡片的富展示载荷(interact card 包的模型面)。 */
export interface ApprovalCardPayload {
  readonly title: string
  readonly riskTier: RiskTier
  readonly tool: string
  readonly reasons: readonly string[]
  readonly argsPreview?: readonly ContentBlock[]
}
