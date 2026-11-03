/**
 * 治理配置错误:策略文件(YAML)结构非法、字段类型不符、含 fail-closed 不允许的取值时抛出。
 * fail-closed 语义:配置加载失败即抛错,宿主不得以降级配置继续放行。
 */
export class GovernanceConfigError extends Error {
  /** 逐条列出的问题描述(供审批卡片/日志展示)。 */
  readonly issues: readonly string[]

  constructor(message: string, issues: readonly string[] = []) {
    super(issues.length > 0 ? `${message}(${issues.length} 处问题:${issues.join('; ')})` : message)
    this.name = 'GovernanceConfigError'
    this.issues = issues
  }
}

/** 判定 unknown 是否为普通对象(投影/校验共用的窄化助手)。 */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
