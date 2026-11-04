import { parse as parseYaml } from "yaml";
import { GovernanceConfigError, isRecord } from "./errors.js";
import { matchAnyGlob } from "./glob.js";
import { stableStringify } from "./types.js";
const EFFECTS = ["allow", "ask", "deny"];
const RULE_KEYS = /* @__PURE__ */ new Set(["id", "effect", "tools", "argsContains", "reason"]);
class RuleEngine {
  /** 解析并严格校验 YAML 策略文本;任何结构问题抛 GovernanceConfigError(fail-closed)。 */
  static parse(yamlText, sourceLabel = "policy.yaml") {
    let raw;
    try {
      raw = parseYaml(yamlText);
    } catch (error) {
      throw new GovernanceConfigError(`${sourceLabel}: YAML \u8BED\u6CD5\u9519\u8BEF:${errorText(error)}`);
    }
    return new RuleEngine(validateDocument(raw, sourceLabel));
  }
  #policy;
  constructor(policy) {
    this.#policy = policy;
  }
  /** 只读策略视图。 */
  get policy() {
    return this.#policy;
  }
  /** 求值入口:tool 名 + 参数(任意 JSON 值;字符串直接匹配,其余稳定串化后子串匹配)。 */
  evaluate(tool, args) {
    return this.evaluateCall({ name: tool, ...args !== void 0 && { arguments: args } });
  }
  /** tools/pre-execute 调用形态的求值入口(结构兼容 dsh ToolExecution)。 */
  evaluateCall(call) {
    const serialized = call.arguments === void 0 ? "" : serializeArgs(call.arguments);
    const matched = this.#policy.rules.filter((rule) => this.#matches(rule, call.name, serialized));
    const firstDeny = matched.find((rule) => rule.effect === "deny");
    const firstAsk = matched.find((rule) => rule.effect === "ask");
    const firstAllow = matched.find((rule) => rule.effect === "allow");
    const decidedRule = firstDeny ?? firstAsk ?? firstAllow;
    if (decidedRule === void 0) {
      return {
        decision: this.#policy.default,
        matched,
        isDefault: true,
        reason: `\u672A\u547D\u4E2D\u4EFB\u4F55\u89C4\u5219,\u6309 fail-closed \u9ED8\u8BA4\u88C1\u51B3:${this.#policy.default}`
      };
    }
    return {
      decision: decidedRule.effect,
      matched,
      decidedRule,
      isDefault: false,
      reason: decidedRule.reason === void 0 ? `\u547D\u4E2D\u89C4\u5219 ${decidedRule.id}(${decidedRule.effect})` : `\u547D\u4E2D\u89C4\u5219 ${decidedRule.id}(${decidedRule.effect}):${decidedRule.reason}`
    };
  }
  /** 求值并映射为 dsh tools/pre-execute 决策形态(exactOptionalPropertyTypes 安全构造)。 */
  preExecuteDecision(call) {
    const evaluation = this.evaluateCall(call);
    if (evaluation.decision === "deny") {
      return { kind: "deny", reason: `[governance] ${evaluation.reason}` };
    }
    if (evaluation.decision === "ask") {
      const reason = `[governance] ${evaluation.reason}`;
      return evaluation.decidedRule === void 0 ? { kind: "ask" } : { kind: "ask", reason };
    }
    return { kind: "allow" };
  }
  #matches(rule, tool, serializedArgs) {
    if (!matchAnyGlob(tool, rule.tools)) return false;
    if (rule.argsContains === void 0 || rule.argsContains.length === 0) return true;
    return rule.argsContains.some((needle) => serializedArgs.includes(needle));
  }
}
function serializeArgs(args) {
  return typeof args === "string" ? args : stableStringify(args);
}
function validateDocument(raw, sourceLabel) {
  if (!isRecord(raw)) {
    throw new GovernanceConfigError(`${sourceLabel}: \u9876\u5C42\u5FC5\u987B\u662F\u6620\u5C04(key: rules/default)`);
  }
  const issues = [];
  const unknownTop = Object.keys(raw).filter((key) => key !== "rules" && key !== "default");
  if (unknownTop.length > 0) issues.push(`\u672A\u77E5\u9876\u5C42\u5B57\u6BB5:${unknownTop.join(",")}`);
  let def = "ask";
  if (raw["default"] !== void 0) {
    const value = raw["default"];
    if (value === "ask" || value === "deny") {
      def = value;
    } else {
      issues.push(`default \u53EA\u5141\u8BB8 'ask' | 'deny'(fail-closed),\u5F97\u5230:${JSON.stringify(value)}`);
    }
  }
  if (raw["rules"] === void 0) {
    issues.push("\u7F3A\u5C11\u5FC5\u586B\u5B57\u6BB5 rules(\u53EF\u4E3A\u7A7A\u6570\u7EC4,\u7A7A\u7B56\u7565 = \u4E00\u5207\u8D70 default)");
  } else if (!Array.isArray(raw["rules"])) {
    issues.push("rules \u5FC5\u987B\u662F\u6570\u7EC4");
  } else {
    const seen = /* @__PURE__ */ new Set();
    for (const [index, entry] of raw["rules"].entries()) {
      issues.push(...validateRule(entry, index, seen));
    }
  }
  if (issues.length > 0) throw new GovernanceConfigError(`${sourceLabel}: \u7B56\u7565\u6821\u9A8C\u5931\u8D25`, issues);
  const rules = raw["rules"].map((entry) => toRule(entry));
  return { rules, default: def };
}
function validateRule(entry, index, seen) {
  if (!isRecord(entry)) return [`rules[${index}] \u5FC5\u987B\u662F\u6620\u5C04`];
  const at = `rules[${index}]`;
  const issues = [];
  const unknownKeys = Object.keys(entry).filter((key) => !RULE_KEYS.has(key));
  if (unknownKeys.length > 0) issues.push(`${at}: \u672A\u77E5\u5B57\u6BB5 ${unknownKeys.join(",")}`);
  const id = entry["id"];
  if (typeof id !== "string" || id.length === 0) {
    issues.push(`${at}: id \u5FC5\u987B\u662F\u975E\u7A7A\u5B57\u7B26\u4E32`);
  } else if (seen.has(id)) {
    issues.push(`${at}: \u89C4\u5219 id \u91CD\u590D:${id}`);
  } else {
    seen.add(id);
  }
  const effect = entry["effect"];
  if (typeof effect !== "string" || !EFFECTS.includes(effect)) {
    issues.push(`${at}: effect \u5FC5\u987B\u662F allow|ask|deny,\u5F97\u5230:${JSON.stringify(effect)}`);
  }
  const tools = entry["tools"];
  if (!Array.isArray(tools) || tools.length === 0 || !tools.every((t) => typeof t === "string" && t.length > 0)) {
    issues.push(`${at}: tools \u5FC5\u987B\u662F\u975E\u7A7A glob \u5B57\u7B26\u4E32\u6570\u7EC4`);
  }
  const argsContains = entry["argsContains"];
  if (argsContains !== void 0 && (!Array.isArray(argsContains) || !argsContains.every((t) => typeof t === "string"))) {
    issues.push(`${at}: argsContains \u5FC5\u987B\u662F\u5B57\u7B26\u4E32\u6570\u7EC4`);
  }
  const reason = entry["reason"];
  if (reason !== void 0 && typeof reason !== "string") {
    issues.push(`${at}: reason \u5FC5\u987B\u662F\u5B57\u7B26\u4E32`);
  }
  return issues;
}
function toRule(entry) {
  const argsContains = entry["argsContains"];
  const reason = entry["reason"];
  return {
    id: entry["id"],
    effect: entry["effect"],
    tools: entry["tools"],
    ...argsContains !== void 0 && { argsContains },
    ...reason !== void 0 && { reason }
  };
}
function errorText(error) {
  return error instanceof Error ? error.message : String(error);
}
export {
  RuleEngine,
  serializeArgs
};
