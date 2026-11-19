/**
 * 权限 preset 契约(interact 消费的结构镜像,原 dsh-permission-presets/sandbox/user-approval 形态)。
 */

/** sandbox 模式词汇。 */
export type SandboxMode = 'read-only' | 'workspace-write' | 'danger-full-access'

/** 审批策略词汇(可无须询问即知结论的策略)。 */
export type ApprovalPolicy = 'ask' | 'never'

/** 一个 preset 的 sandbox/approval 捆绑与可选展示文案。 */
export interface PresetSpec {
  sandbox: SandboxMode
  approval: ApprovalPolicy
  /** 展示标签;缺省用表键。 */
  name?: string
  /** 一句话人话说明;未配置缺省。 */
  description?: string
}
