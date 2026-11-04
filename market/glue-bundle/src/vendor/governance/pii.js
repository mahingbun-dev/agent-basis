class PiiBlockedError extends Error {
  findings;
  constructor(findings, label = "value") {
    super(`[governance] PII \u62E6\u622A:${label} \u547D\u4E2D ${findings.length} \u5904\u654F\u611F\u4FE1\u606F(${summarize(findings)}),\u5199\u5165\u88AB\u62D2\u7EDD`);
    this.name = "PiiBlockedError";
    this.findings = findings;
  }
}
function defaultPiiPatterns() {
  return [
    { id: "cn-mobile", label: "\u624B\u673A\u53F7", pattern: /(?<!\d)1[3-9]\d{9}(?!\d)/u },
    { id: "cn-id-card", label: "\u8EAB\u4EFD\u8BC1\u53F7", pattern: /(?<!\d)\d{17}[\dXx](?!\d)/u },
    { id: "email", label: "\u90AE\u7BB1", pattern: /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/u },
    { id: "ipv4", label: "IPv4 \u5730\u5740", pattern: /(?<!\d)(?:\d{1,3}\.){3}\d{1,3}(?!\d)/u }
  ];
}
class PiiFilter {
  #patterns;
  constructor(patterns = defaultPiiPatterns()) {
    this.#patterns = [...patterns];
  }
  get patterns() {
    return this.#patterns;
  }
  /** 扫描一段文本,返回全部命中(不修改原文)。 */
  scan(text) {
    const findings = [];
    for (const pattern of this.#patterns) {
      const re = withGlobal(pattern.pattern);
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
  /** 脱敏:命中片段替换为 `[PII:<patternId>]`;返回替换后文本与命中清单。 */
  redact(text) {
    const findings = this.scan(text);
    if (findings.length === 0) return { text, findings };
    let out = "";
    let cursor = 0;
    for (const finding of findings) {
      if (finding.start < cursor) continue;
      out += text.slice(cursor, finding.start) + `[PII:${finding.patternId}]`;
      cursor = finding.end;
    }
    return { text: out + text.slice(cursor), findings };
  }
  /** 扫描任意嵌套值中的全部字符串键与值。 */
  scanValue(value) {
    const findings = [];
    walkStrings(value, (text) => {
      findings.push(...this.scan(text));
    });
    return findings;
  }
  /** 脱敏任意嵌套值(仅字符串被替换,结构原样深拷贝)。 */
  redactValue(value) {
    const findings = [];
    const next = rewriteStrings(value, (text) => {
      const result = this.redact(text);
      findings.push(...result.findings);
      return result.text;
    });
    return { value: next, findings };
  }
  /**
   * 写入前守卫:命中即抛 PiiBlockedError(memory_write / knowledge 写路径调用)。
   * label 用于错误信息定位(如 memory key)。
   */
  assertClean(value, label) {
    const findings = this.scanValue(value);
    if (findings.length > 0) throw new PiiBlockedError(findings, label);
  }
}
function withGlobal(pattern) {
  return new RegExp(pattern.source, pattern.flags.includes("g") ? pattern.flags : `${pattern.flags}g`);
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
function rewriteStrings(value, rewrite) {
  if (typeof value === "string") return rewrite(value);
  if (Array.isArray(value)) return value.map((item) => rewriteStrings(item, rewrite));
  if (typeof value === "object" && value !== null) {
    const out = {};
    for (const key of Object.keys(value)) {
      out[rewrite(key)] = rewriteStrings(value[key], rewrite);
    }
    return out;
  }
  return value;
}
function summarize(findings) {
  const counts = /* @__PURE__ */ new Map();
  for (const finding of findings) {
    counts.set(finding.patternId, (counts.get(finding.patternId) ?? 0) + 1);
  }
  return [...counts.entries()].map(([id, count]) => `${id}\xD7${count}`).join(",");
}
export {
  PiiBlockedError,
  PiiFilter,
  defaultPiiPatterns
};
