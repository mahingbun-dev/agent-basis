/**
 * 工具命名规范(29a R3 裁剪:工具名保守约束 `^[a-zA-Z0-9_-]+$` 且 ≤64)。
 *
 * 依据 36 号 §2.3 禁入清单 ③:「工具命名必须 ^[a-zA-Z0-9_-]+$ 且 ≤64(29a R3,
 * 写进契约命名规范)」。供契约层与 generic 适配器(K2.3 function 定义四件套)复用;
 * 路径与长度取 Chat 轨道 ≤64 与 Responses 轨道 ≤128 的交集(29a R3 工具定义行)。
 */

/** 工具名字符集(保守约束:字母/数字/下划线/连字符)。 */
export const TOOL_NAME_PATTERN = /^[a-zA-Z0-9_-]+$/

/** 工具名长度上限(Chat 轨道规格 ≤64 与 Responses 轨道 ≤128 的交集)。 */
export const TOOL_NAME_MAX_LENGTH = 64

/** 命名规范校验(正例:true;空名/超长/含点/含空格/含非 ASCII 一律 false)。 */
export function isValidToolName(name: string): boolean {
  return name.length > 0
    && name.length <= TOOL_NAME_MAX_LENGTH
    && TOOL_NAME_PATTERN.test(name)
}

/** 工具名违例错误。 */
export class ToolNameError extends Error {
  constructor(name: string) {
    super(
      `工具名 "${name}" 不符契约命名规范:须匹配 ^[a-zA-Z0-9_-]+$ 且长度 1–${TOOL_NAME_MAX_LENGTH}(29a R3)`,
    )
    this.name = 'ToolNameError'
  }
}

/** 断言工具名合规;违例即抛 ToolNameError。 */
export function assertValidToolName(name: string): void {
  if (!isValidToolName(name)) throw new ToolNameError(name)
}
