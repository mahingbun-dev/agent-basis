/**
 * PII 过滤服务(可插拔正则列表)。
 *
 * 设计依据(设计文档 08 §5.2、12 §4.3):
 * - dsh-memory 的 memory_write 与 dsh-knowledge 的写路径在**写入前**强制调用本服务;
 * - 模式可插拔:领域包可注入行业模式(如合同号、患者号),缺省提供通用四类;
 * - 两种用法:redact(脱敏后仍可写)与 assertClean(命中即抛 PiiBlockedError,写入被拦截)。
 */

/** 一个可插拔 PII 模式。pattern 只读取 source,扫描时以 g 标志克隆执行。 */
export interface PiiPattern {
  readonly id: string
  readonly pattern: RegExp
  /** 人读标签(审批卡片展示)。 */
  readonly label?: string
}

/** 一次命中。位置区间 [start, end) 相对被扫描文本。 */
export interface PiiFinding {
  readonly patternId: string
  readonly start: number
  readonly end: number
}

/** 脱敏结果。 */
export interface PiiRedaction {
  readonly text: string
  readonly findings: readonly PiiFinding[]
}

/** PII 拦截异常:assertClean 命中时抛出,memory/knowledge 的写入路径必须将其视为写入失败。 */
export class PiiBlockedError extends Error {
  readonly findings: readonly PiiFinding[]

  constructor(findings: readonly PiiFinding[], label = 'value') {
    super(`[governance] PII 拦截:${label} 命中 ${findings.length} 处敏感信息(${summarize(findings)}),写入被拒绝`)
    this.name = 'PiiBlockedError'
    this.findings = findings
  }
}

/** 缺省通用模式集(中国大陆场景)。 */
export function defaultPiiPatterns(): PiiPattern[] {
  return [
    { id: 'cn-mobile', label: '手机号', pattern: /(?<!\d)1[3-9]\d{9}(?!\d)/u },
    { id: 'cn-id-card', label: '身份证号', pattern: /(?<!\d)\d{17}[\dXx](?!\d)/u },
    { id: 'email', label: '邮箱', pattern: /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/u },
    { id: 'ipv4', label: 'IPv4 地址', pattern: /(?<!\d)(?:\d{1,3}\.){3}\d{1,3}(?!\d)/u },
  ]
}

/** PII 过滤器:模式列表只读,实例可共享。 */
export class PiiFilter {
  readonly #patterns: readonly PiiPattern[]

  constructor(patterns: readonly PiiPattern[] = defaultPiiPatterns()) {
    this.#patterns = [...patterns]
  }

  get patterns(): readonly PiiPattern[] {
    return this.#patterns
  }

  /** 扫描一段文本,返回全部命中(不修改原文)。 */
  scan(text: string): readonly PiiFinding[] {
    const findings: PiiFinding[] = []
    for (const pattern of this.#patterns) {
      const re = withGlobal(pattern.pattern)
      re.lastIndex = 0
      let hit = re.exec(text)
      while (hit !== null) {
        if (hit[0].length > 0) {
          findings.push({ patternId: pattern.id, start: hit.index, end: hit.index + hit[0].length })
        }
        if (re.lastIndex === hit.index) re.lastIndex += 1
        hit = re.exec(text)
      }
    }
    return findings.sort((a, b) => a.start - b.start)
  }

  /** 脱敏:命中片段替换为 `[PII:<patternId>]`;返回替换后文本与命中清单。 */
  redact(text: string): PiiRedaction {
    const findings = this.scan(text)
    if (findings.length === 0) return { text, findings }
    let out = ''
    let cursor = 0
    for (const finding of findings) {
      if (finding.start < cursor) continue // 重叠命中取先到者
      out += text.slice(cursor, finding.start) + `[PII:${finding.patternId}]`
      cursor = finding.end
    }
    return { text: out + text.slice(cursor), findings }
  }

  /** 扫描任意嵌套值中的全部字符串键与值。 */
  scanValue(value: unknown): readonly PiiFinding[] {
    const findings: PiiFinding[] = []
    walkStrings(value, (text) => {
      findings.push(...this.scan(text))
    })
    return findings
  }

  /** 脱敏任意嵌套值(仅字符串被替换,结构原样深拷贝)。 */
  redactValue(value: unknown): { value: unknown; findings: readonly PiiFinding[] } {
    const findings: PiiFinding[] = []
    const next = rewriteStrings(value, (text) => {
      const result = this.redact(text)
      findings.push(...result.findings)
      return result.text
    })
    return { value: next, findings }
  }

  /**
   * 写入前守卫:命中即抛 PiiBlockedError(memory_write / knowledge 写路径调用)。
   * label 用于错误信息定位(如 memory key)。
   */
  assertClean(value: unknown, label?: string): void {
    const findings = this.scanValue(value)
    if (findings.length > 0) throw new PiiBlockedError(findings, label)
  }
}

function withGlobal(pattern: RegExp): RegExp {
  // 始终克隆:避免共享 lastIndex 污染调用者传入的原正则状态
  return new RegExp(pattern.source, pattern.flags.includes('g') ? pattern.flags : `${pattern.flags}g`)
}

function walkStrings(value: unknown, visit: (text: string) => void): void {
  if (typeof value === 'string') {
    visit(value)
  } else if (Array.isArray(value)) {
    for (const item of value) walkStrings(item, visit)
  } else if (typeof value === 'object' && value !== null) {
    for (const key of Object.keys(value)) {
      visit(key)
      walkStrings((value as Record<string, unknown>)[key], visit)
    }
  }
}

function rewriteStrings(value: unknown, rewrite: (text: string) => string): unknown {
  if (typeof value === 'string') return rewrite(value)
  if (Array.isArray(value)) return value.map(item => rewriteStrings(item, rewrite))
  if (typeof value === 'object' && value !== null) {
    const out: Record<string, unknown> = {}
    for (const key of Object.keys(value)) {
      out[rewrite(key)] = rewriteStrings((value as Record<string, unknown>)[key], rewrite)
    }
    return out
  }
  return value
}

function summarize(findings: readonly PiiFinding[]): string {
  const counts = new Map<string, number>()
  for (const finding of findings) {
    counts.set(finding.patternId, (counts.get(finding.patternId) ?? 0) + 1)
  }
  return [...counts.entries()].map(([id, count]) => `${id}×${count}`).join(',')
}
