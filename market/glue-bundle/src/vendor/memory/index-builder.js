import { MEMORY_INDEX_BUDGET_TOKENS, estimateTokens } from "./tokens.js";
const MAX_LINES = 64;
const MEMORY_BEHAVIOR_HEADER = [
  "## \u957F\u671F\u8BB0\u5FC6(\u540E\u53F0\u673A\u5236\u2014\u2014\u7531\u4F60\u81EA\u4E3B\u7BA1\u7406,\u65E0\u9700\u7528\u6237\u6307\u793A)",
  "- **\u68C0\u7D22\u65F6\u673A**:\u4F1A\u8BDD\u5F00\u59CB\u5904\u7406\u4EFB\u52A1\u524D\u3001\u6216\u9047\u5230\u53EF\u80FD\u4E0E\u6B64\u76F8\u5173\u7684\u5386\u53F2\u4E0A\u4E0B\u6587\u65F6,\u5148\u7528 memory_search \u68C0\u7D22;\u68C0\u7D22\u662F\u9759\u9ED8\u7684\u540E\u53F0\u52A8\u4F5C,\u65E0\u9700\u544A\u77E5\u7528\u6237\u3002",
  "- **\u5199\u5165\u65F6\u673A**:\u51FA\u73B0\u7A33\u5B9A\u7684\u7528\u6237\u504F\u597D\u3001\u9879\u76EE\u4E8B\u5B9E\u3001\u7EC4\u7EC7\u7EA6\u5B9A\u6216\u53EF\u590D\u7528\u7ED3\u8BBA\u65F6,\u81EA\u4E3B\u7528 memory_write \u4FDD\u5B58(\u5199\u5165\u524D\u7167\u5E38\u8FC7 PII \u8FC7\u6EE4)\u3002",
  "- **\u663E\u5F0F\u5173\u952E\u8BCD**:\u7528\u6237\u660E\u786E\u8BF4\u300C\u8BB0\u4F4F\u2026\u300D\u300C\u8BB0\u4E00\u4E0B\u2026\u300D\u65F6,\u7ACB\u5373 memory_write\u3002",
  "- **\u9057\u5FD8**:\u4EC5\u5728\u7528\u6237\u660E\u786E\u8981\u6C42\u5220\u9664\u67D0\u6761\u8BB0\u5FC6\u65F6\u7528 memory_forget;\u7981\u6B62\u81EA\u4E3B\u9057\u5FD8\u3002",
  "- **\u9759\u9ED8\u7EAA\u5F8B**:\u8BB0\u5FC6\u8BFB\u5199\u4E0D\u5411\u7528\u6237\u64AD\u62A5\u8FC7\u7A0B;\u9664\u975E\u7528\u6237\u95EE\u8D77\u6216\u5199\u5165\u9700\u8981\u786E\u8BA4,\u5426\u5219\u4E0D\u6253\u65AD\u5BF9\u8BDD\u3002"
].join("\n");
const DEFAULT_MAX_SUMMARY_CHARS = 40;
function buildEntityIndex(records, options = {}) {
  const budget = options.budgetTokens ?? MEMORY_INDEX_BUDGET_TOKENS;
  const maxSummaryChars = options.maxSummaryChars ?? DEFAULT_MAX_SUMMARY_CHARS;
  const total = records.length;
  if (total === 0) {
    const emptyText = MEMORY_BEHAVIOR_HEADER + "\n## \u8BB0\u5FC6\u7D22\u5F15\n(\u6682\u65E0\u957F\u671F\u8BB0\u5FC6)";
    return { text: emptyText, total: 0, included: 0, omitted: 0, estimatedTokens: estimateTokens(emptyText) };
  }
  const ranked = [...records].sort(compareForIndex);
  const capped = ranked.slice(0, MAX_LINES);
  const lines = capped.map((record) => indexLine(record, maxSummaryChars));
  const omittedBeyondCap = total - capped.length;
  let included = lines.length;
  let omitted = omittedBeyondCap;
  let text = MEMORY_BEHAVIOR_HEADER + "\n" + renderIndex(lines, omitted);
  while (estimateTokens(text) > budget && included > 0) {
    included -= 1;
    omitted = total - included;
    text = MEMORY_BEHAVIOR_HEADER + "\n" + renderIndex(lines.slice(0, included), omitted);
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
