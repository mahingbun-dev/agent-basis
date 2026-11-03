/**
 * DSH seam 的本地最小形态 + interact 包内共用助手。
 *
 * 风险档词汇(设计文档 08 §6.1,由领域包 hitl.yaml 声明、governance/interact 执行):
 * - R0 只读 / R1 可逆写 / R2 需确认 / R3 高危。
 *
 * 官方类型(user-questions / user-approval / permission-presets / sandbox)直接以
 * `import type` 从已发布 0.2.2-alpha.2 依赖引入(与 ../dsh-repo 同版),不在本文件重复;
 * 本文件只放官方包没有、而本包需要的最小结构(ToolCallLike)与纯助手。
 * 编译期钉住见 tests/types.seam-pin.ts。
 */

/** 风险分档:R0 只读 / R1 可逆写 / R2 需确认 / R3 高危。 */
export type RiskGrade = 'R0' | 'R1' | 'R2' | 'R3'

/** 全部风险档,按严重度升序(分档裁决取命中规则的最高档)。 */
export const RISK_GRADES: readonly RiskGrade[] = ['R0', 'R1', 'R2', 'R3']

/** 无人值守(ask 不可达)时的挂起策略(设计文档 08 §6.3):挂起(任务暂停非失败)/ 升级 channels / 失败。 */
export type NoAnswerStrategy = 'suspend' | 'escalate' | 'fail'

/**
 * 工具调用最小形态(结构兼容 dsh `ToolExecution` 的 name/arguments 面;
 * 参照 ../dsh-repo packages/core/tools/src/contracts.ts:180-219,与 @basis/governance 的
 * ToolCallLike 同构——hitl 分档只消费这两个字段,官方类型其余字段对本包透明)。
 */
export interface ToolCallLike {
  readonly name: string
  readonly arguments?: unknown
}

/**
 * 最小 glob 匹配:hitl 规则的 tool 名匹配用。
 * 语义与 @basis/governance src/glob.ts 一致:`*` 任意长度、`?` 单字符、其余字面量、整串锚定;
 * DSH 工具名(mcp__server__tool、web_fetch 等)不含需要 `**` 跨段的场景。
 */
export function globToRegExp(glob: string): RegExp {
  let source = ''
  for (const ch of glob) {
    if (ch === '*') {
      source += '.*'
    } else if (ch === '?') {
      source += '.'
    } else {
      source += escapeRegExpChar(ch)
    }
  }
  return new RegExp(`^${source}$`, 'u')
}

function escapeRegExpChar(ch: string): string {
  return /[.*+?^${}()|[\]\\]/u.test(ch) ? `\\${ch}` : ch
}

const globCache = new Map<string, RegExp>()

/** name 是否命中单个 glob(按 glob 串缓存,hitl 分档在热路径上反复求值)。 */
export function matchGlob(name: string, glob: string): boolean {
  let re = globCache.get(glob)
  if (re === undefined) {
    re = globToRegExp(glob)
    globCache.set(glob, re)
  }
  return re.test(name)
}

/** name 是否命中 glob 列表任意一项(空列表 = 不命中)。 */
export function matchAnyGlob(name: string, globs: readonly string[]): boolean {
  return globs.some(glob => matchGlob(name, glob))
}

/** 任意嵌套 JSON 值的稳定串化(键排序),供 args_contains 子串匹配与卡片参数预览。 */
export function stableStringify(value: unknown): string {
  return JSON.stringify(sortValue(value))
}

function sortValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortValue)
  if (typeof value === 'object' && value !== null) {
    const record: Record<string, unknown> = {}
    for (const key of Object.keys(value).sort()) {
      record[key] = sortValue((value as Record<string, unknown>)[key])
    }
    return record
  }
  return value
}
