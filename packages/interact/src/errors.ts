/**
 * 交互配置错误:hitl.yaml 结构非法、字段类型不符、含 fail-closed 不允许的取值,
 * 或审批卡片/提问草稿载荷不满足结构约束时抛出。
 * fail-closed 语义与 @basis/governance 的 GovernanceConfigError 一致:
 * 配置加载失败即抛错,宿主不得以降级配置继续放行。
 */
export class InteractConfigError extends Error {
  /** 逐条列出的问题描述(供日志/审批卡片展示)。 */
  readonly issues: readonly string[]

  constructor(message: string, issues: readonly string[] = []) {
    super(issues.length > 0 ? `${message}(${issues.length} 处问题:${issues.join('; ')})` : message)
    this.name = 'InteractConfigError'
    this.issues = issues
  }
}

/** 判定 unknown 是否为普通对象(校验/窄化共用助手)。 */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
