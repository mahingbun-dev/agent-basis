import { MEMORY_INDEX_BUDGET_TOKENS, estimateTokens } from "./tokens.ts";
const MAX_LINES = 64;
const DEFAULT_MAX_SUMMARY_CHARS = 40;
function buildEntityIndex(records, options = {}) {
  const budget = options.budgetTokens ?? MEMORY_INDEX_BUDGET_TOKENS;
  const maxSummaryChars = options.maxSummaryChars ?? DEFAULT_MAX_SUMMARY_CHARS;
  const total = records.length;
  if (total === 0) {
    const emptyText = "## \u8BB0\u5FC6\u7D22\u5F15\n(\u6682\u65E0\u957F\u671F\u8BB0\u5FC6)";
    return { text: emptyText, total: 0, included: 0, omitted: 0, estimatedTokens: estimateTokens(emptyText) };
  }
  const ranked = [...records].sort(compareForIndex);
  const capped = ranked.slice(0, MAX_LINES);
  const lines = capped.map((record) => indexLine(record, maxSummaryChars));
  const omittedBeyondCap = total - capped.length;
  let included = lines.length;
  let omitted = omittedBeyondCap;
  let text = renderIndex(lines, omitted);
  while (estimateTokens(text) > budget && included > 0) {
    included -= 1;
    omitted = total - included;
    text = renderIndex(lines.slice(0, included), omitted);
  }
  return { text, total, included, omitted, estimatedTokens: estimateTokens(text) };
}
function renderIndex(lines, omitted) {
  const header = "## \u8BB0\u5FC6\u7D22\u5F15(key + \u4E00\u53E5\u8BDD\u6458\u8981;\u6B63\u6587\u7528 memory_read \u6309\u9700\u8BFB\u53D6)";
  const body = lines.length > 0 ? lines.join("\n") : "(\u9884\u7B97\u5185\u65E0\u53EF\u5C55\u793A\u6761\u76EE,\u7528 memory_search \u68C0\u7D22)";
  const footer = omitted > 0 ? `(+${omitted} \u6761\u672A\u5217\u51FA:\u7528 memory_search \u68C0\u7D22\u3001memory_read \u8BFB\u6B63\u6587)` : "\u68C0\u7D22\u7528 memory_search;\u64A4\u9500\u8BB0\u5FC6\u7528 memory_forget(\u771F\u5220)";
  return `${header}
${body}
${footer}`;
}
function indexLine(record, maxSummaryChars) {
  const summary = summarize(record, maxSummaryChars);
  const confidence = record.confidence.toFixed(2);
  return `- [${record.subject}] ${record.key} \u2014 ${summary} (conf ${confidence})`;
}
function summarize(record, maxSummaryChars) {
  const source = record.summary ?? record.content;
  const firstClause = source.split(/[。!?\uFF1B;\n]/u)[0]?.trim() ?? "";
  const chars = Array.from(firstClause);
  return chars.length <= maxSummaryChars ? firstClause : `${chars.slice(0, maxSummaryChars).join("")}\u2026`;
}
function compareForIndex(a, b) {
  if (a.confidence !== b.confidence) return b.confidence - a.confidence;
  if (a.updatedAt !== b.updatedAt) return b.updatedAt - a.updatedAt;
  return b.id - a.id;
}
export {
  buildEntityIndex
};
