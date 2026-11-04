const CJK_PATTERN = /[\u1100-\u11FF\u2E80-\u9FFF\uAC00-\uD7AF\uF900-\uFAFF\uFE30-\uFE4F\uFF00-\uFF60\uFFE0-\uFFE6]/g;
const NON_CJK_PATTERN = /[\p{L}\p{N}\p{P}\p{S}]/gu;
function estimateTokens(text) {
  const cjk = countMatches(text, CJK_PATTERN);
  const others = countMatches(text.replace(CJK_PATTERN, ""), NON_CJK_PATTERN);
  return cjk + Math.ceil(others / 4);
}
const MEMORY_INDEX_BUDGET_TOKENS = 500;
function countMatches(text, pattern) {
  const global = pattern.flags.includes("g") ? pattern : new RegExp(pattern.source, `${pattern.flags}g`);
  return text.match(global)?.length ?? 0;
}
export {
  MEMORY_INDEX_BUDGET_TOKENS,
  estimateTokens
};
