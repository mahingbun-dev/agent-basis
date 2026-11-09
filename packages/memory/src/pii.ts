/**
 * PII 过滤注入接口 + 内置降级实现。
 *
 * 设计依据(设计文档 08 §5.2 / 12 §4.3):memory 一切写入路径在**写入前**强制
 * 过 PII 过滤。首选注入 @eterna/governance 的 PiiFilter(组合层从 ctx.governance
 * 服务取 `pii` 字段);governance 服务未就绪(未 provide)时,降级到本文件的
 * BuiltinPiiGuard——四类通用模式的同源镜像(行为等价,但不支持领域包插拔
 * 行业模式)。降级这一事实必须记入 blockers/审计,不得静默。
 *
 * 注入形态(provide 可交换):PiiGuard 是 @eterna/governance PiiFilter 的结构子集
 * (`assertClean(value, label?)`),governance 实例可直接注入,无需适配层;
 * 编译期钉住见 tests/types.seam-pin.ts。
 */

/** PII 写入守卫(结构子集;governance PiiFilter 天然满足)。 */
export interface PiiGuard {
  /**
   * 写入前守卫:扫描任意嵌套值(字符串键与值),命中敏感信息即抛
   * PiiBlockedError(fail-closed,写入被拒绝)。
   * label 用于错误信息定位(如 memory key、文件名)。
   */
  assertClean(value: unknown, label?: string): void
}

/** 一次 PII 命中。位置区间 [start, end) 相对被扫描文本。 */
export interface PiiFinding {
  readonly patternId: string
  readonly start: number
  readonly end: number
}

/** PII 拦截异常:与 @eterna/governance 的同名异常同 name(『PiiBlockedError』),消费方按 name 判别。 */
export class PiiBlockedError extends Error {
  readonly findings: readonly PiiFinding[]

  constructor(findings: readonly PiiFinding[], label = 'value') {
    const counts = new Map<string, number>()
    for (const finding of findings) counts.set(finding.patternId, (counts.get(finding.patternId) ?? 0) + 1)
    const summary = [...counts.entries()].map(([id, count]) => `${id}×${count}`).join(',')
    super(`[memory] PII 拦截:${label} 命中 ${findings.length} 处敏感信息(${summary}),写入被拒绝`)
    this.name = 'PiiBlockedError'
    this.findings = findings
  }
}

/** 内置降级模式集:与 @eterna/governance defaultPiiPatterns 同源的四类通用模式(中国大陆场景)。 */
export const BUILTIN_PII_PATTERNS: readonly { readonly id: string; readonly pattern: RegExp }[] = [
  { id: 'cn-mobile', pattern: /(?<!\d)1[3-9]\d{9}(?!\d)/u },
  { id: 'cn-id-card', pattern: /(?<!\d)\d{17}[\dXx](?!\d)/u },
  { id: 'email', pattern: /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/u },
  { id: 'ipv4', pattern: /(?<!\d)(?:\d{1,3}\.){3}\d{1,3}(?!\d)/u },
]

/** 是否为 PII 拦截异常(governance 版与内置版同 name,统一判别)。 */
export function isPiiBlockedError(error: unknown): boolean {
  return error instanceof Error && error.name === 'PiiBlockedError'
}

/**
 * 内置降级 PII 守卫:governance 服务未就绪时的兜底。
 * 扫描任意嵌套值的字符串键与值(与 governance PiiFilter.scanValue 同语义)。
 */
export class BuiltinPiiGuard implements PiiGuard {
  readonly #patterns: readonly { readonly id: string; readonly pattern: RegExp }[]

  constructor(patterns: readonly { readonly id: string; readonly pattern: RegExp }[] = BUILTIN_PII_PATTERNS) {
    this.#patterns = [...patterns]
  }

  /** 扫描一段文本,返回全部命中(位置升序;不修改原文)。 */
  scan(text: string): readonly PiiFinding[] {
    const findings: PiiFinding[] = []
    for (const pattern of this.#patterns) {
      const re = new RegExp(pattern.pattern.source, pattern.pattern.flags.includes('g') ? pattern.pattern.flags : `${pattern.pattern.flags}g`)
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

  assertClean(value: unknown, label?: string): void {
    const findings: PiiFinding[] = []
    walkStrings(value, (text) => {
      findings.push(...this.scan(text))
    })
    if (findings.length > 0) throw new PiiBlockedError(findings, label)
  }
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
