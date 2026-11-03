/**
 * @basis/extra 共享错误类型。
 *
 * 与 @basis/governance GovernanceConfigError 同构思路:配置错误在构造期
 * fail-closed 抛出(绝不静默降级);运行期判定结果用结构化 decision 返回。
 */

/** 配置/语法错误(白名单规则、preset 产物、tenant realm 配置的构造期校验)。 */
export class ExtraConfigError extends Error {
  constructor(message: string) {
    super(`[extra] ${message}`)
    this.name = 'ExtraConfigError'
  }
}
