/**
 * Token 估算(注入预算的度量衡)。
 *
 * 设计依据(设计文档 08 §5.3):system-prompt section 只注入记忆索引,
 * 预算 ≤500 token;正文按需 memory_read(渐进披露)。
 *
 * DSH 未提供同步 token 计数(真实 tokenizer 在模型侧),此处用保守启发式:
 * - CJK 字符(含全角/注音/谚文区间)≈ 1 token/字 —— DeepSeek tokenizer 中文
 *   约 0.6~1.1 字/token,取 1 是高估侧;
 * - 其余可见字符 ≈ 1 token/4 字符 —— 业界通用近似(与 Manus/Anthropic 的
 *   注入预算策略同源);
 * - 空白不计。
 * 高估 = 宁可少注入不超预算(fail-closed);测试以本函数为唯一口径断言预算。
 */

/** CJK 及全角字符区间(一个字符按 1 token 计)。 */
const CJK_PATTERN = /[\u1100-\u11FF\u2E80-\u9FFF\uAC00-\uD7AF\uF900-\uFAFF\uFE30-\uFE4F\uFF00-\uFF60\uFFE0-\uFFE6]/g

/** CJK 之外的可见字符(按 4 字符 = 1 token 折算)。 */
const NON_CJK_PATTERN = /[\p{L}\p{N}\p{P}\p{S}]/gu

/** 估算一段文本的 token 数(向上取整,空白不计)。 */
export function estimateTokens(text: string): number {
  // 先剔除 CJK 字符再计其余:CJK 表意文字同时满足 \p{L},不剔除会双计
  const cjk = countMatches(text, CJK_PATTERN)
  const others = countMatches(text.replace(CJK_PATTERN, ''), NON_CJK_PATTERN)
  return cjk + Math.ceil(others / 4)
}

/** 索引注入的默认预算(设计文档 08 §5.3:≤500 token)。 */
export const MEMORY_INDEX_BUDGET_TOKENS = 500

function countMatches(text: string, pattern: RegExp): number {
  // String.match 携带 g 标志时从 lastIndex=0 全量收集,不污染模块级正则状态
  const global = pattern.flags.includes('g') ? pattern : new RegExp(pattern.source, `${pattern.flags}g`)
  return text.match(global)?.length ?? 0
}
