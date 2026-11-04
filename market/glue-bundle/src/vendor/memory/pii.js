class PiiBlockedError extends Error {
  findings;
  constructor(findings, label = "value") {
    const counts = /* @__PURE__ */ new Map();
    for (const finding of findings) counts.set(finding.patternId, (counts.get(finding.patternId) ?? 0) + 1);
    const summary = [...counts.entries()].map(([id, count]) => `${id}\xD7${count}`).join(",");
    super(`[memory] PII \u62E6\u622A:${label} \u547D\u4E2D ${findings.length} \u5904\u654F\u611F\u4FE1\u606F(${summary}),\u5199\u5165\u88AB\u62D2\u7EDD`);
    this.name = "PiiBlockedError";
    this.findings = findings;
  }
}
const BUILTIN_PII_PATTERNS = [
  { id: "cn-mobile", pattern: /(?<!\d)1[3-9]\d{9}(?!\d)/u },
  { id: "cn-id-card", pattern: /(?<!\d)\d{17}[\dXx](?!\d)/u },
  { id: "email", pattern: /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/u },
  { id: "ipv4", pattern: /(?<!\d)(?:\d{1,3}\.){3}\d{1,3}(?!\d)/u }
];
function isPiiBlockedError(error) {
  return error instanceof Error && error.name === "PiiBlockedError";
}
class BuiltinPiiGuard {
  #patterns;
  constructor(patterns = BUILTIN_PII_PATTERNS) {
    this.#patterns = [...patterns];
  }
  /** 扫描一段文本,返回全部命中(位置升序;不修改原文)。 */
  scan(text) {
    const findings = [];
    for (const pattern of this.#patterns) {
      const re = new RegExp(pattern.pattern.source, pattern.pattern.flags.includes("g") ? pattern.pattern.flags : `${pattern.pattern.flags}g`);
      re.lastIndex = 0;
      let hit = re.exec(text);
      while (hit !== null) {
        if (hit[0].length > 0) {
          findings.push({ patternId: pattern.id, start: hit.index, end: hit.index + hit[0].length });
        }
        if (re.lastIndex === hit.index) re.lastIndex += 1;
        hit = re.exec(text);
      }
    }
    return findings.sort((a, b) => a.start - b.start);
  }
  assertClean(value, label) {
    const findings = [];
    walkStrings(value, (text) => {
      findings.push(...this.scan(text));
    });
    if (findings.length > 0) throw new PiiBlockedError(findings, label);
  }
}
function walkStrings(value, visit) {
  if (typeof value === "string") {
    visit(value);
  } else if (Array.isArray(value)) {
    for (const item of value) walkStrings(item, visit);
  } else if (typeof value === "object" && value !== null) {
    for (const key of Object.keys(value)) {
      visit(key);
      walkStrings(value[key], visit);
    }
  }
}
export {
  BUILTIN_PII_PATTERNS,
  BuiltinPiiGuard,
  PiiBlockedError,
  isPiiBlockedError
};
