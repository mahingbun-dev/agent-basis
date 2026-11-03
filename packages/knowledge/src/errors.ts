/** 共享错误类型与守卫。 */

/** 知识插件错误基类(only-throw-error:src 只抛 Error 子类)。 */
export class KnowledgeError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'KnowledgeError'
  }
}

/** 页面/frontmatter 格式错误。 */
export class KnowledgeFormatError extends KnowledgeError {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message)
    this.name = 'KnowledgeFormatError'
    if (options !== undefined && options.cause !== undefined) this.cause = options.cause
  }
}

/** 文档未找到(read/deprecate 的 ref 不存在)。 */
export class KnowledgeNotFoundError extends KnowledgeError {
  constructor(message: string) {
    super(message)
    this.name = 'KnowledgeNotFoundError'
  }
}

/** 状态流转非法(如对已决提案重复评审)。 */
export class KnowledgeStateError extends KnowledgeError {
  constructor(message: string) {
    super(message)
    this.name = 'KnowledgeStateError'
  }
}

/** unknown → record 守卫(替代 any 的窄化入口)。 */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
