/**
 * persona 文本校验器(T7.3 规则全集,逐条有 vitest 钉住;T1.6 起另含按条目校验器):
 *
 * 1. 必须是字符串;
 * 2. 非空(去首尾空白后非空);
 * 3. UTF-8 合法:不含孤立代理项( lone surrogate )——JS 字符串是 UTF-16,孤立代理项
 *    编码到 UTF-8 时会被 Buffer/TextEncoder 静默替换成 U+FFFD,导致「存进去的
 *    checksum/字节」与「写盘落点」口径漂移,fail-closed 拒收;
 * 4. ≤65536 UTF-8 字节(对齐 dsh agent-instructions maxBytes 口径,计划书 §6 T7.3;
 *    T1.6 起按条目 maxBytes 逐条目生效——validateEntryText);
 * 5. 红线段必须存在:三条红线锚点对齐 packs/event-planning/persona.md 的「全局硬约束」
 *    段(预算不超支/不代付/比选中立)。红线是部署级安全不变量——不许经工坊编辑把
 *    safety rails 从 system prompt 里删掉(锚点为宽容正则,改写措辞不改语义即可通过;
 *    T1.6 起锚点双语化——同一规则集绑定的条目既有中文全文(persona.md)也有英文
 *    转述(personaPrefix),锚点须两者都认);
 * 6. diff 非空才可保存:不在本模块(diffLines.isEmpty,写链路 handleWrite 把守),
 *    与「导出包 schemaVersion+checksum 拒收」(export-pack.ts)并列 T7.3 校验全集。
 *
 * T1.6 按条目红线(T1.3 注册表 redLine/redLineRuleSet 标记的落地):
 * - validateEntryText(entry, text):骨架规则(非空/UTF-8/条目 maxBytes)+ 按条目红线
 *   策略——redLine='required' 按条目绑定的规则集逐条检锚点,缺哪条 issues 指明;
 *   redLine='exempt' 不做红线检查(防错配);
 * - 规则集本体:'eterna.red-lines.standard'(RED_LINE_RULES,双语)与
 *   'eterna.red-lines.industrial-analysis'(INDUSTRIAL_RED_LINE_RULES,四条,
 *   对齐 packs/industrial-analysis/persona.md 全局硬约束与其 personaPrefix 英文句)。
 *   2026-11-12 起规则本体拆到 red-lines.ts(纯模块零 node 依赖,客户端编辑器
 *   预检查共用单一事实源);本模块从那里 import 并 re-export,既有 import 面零改动。
 */
import { byteLength } from './checksum.ts'
import {
  INDUSTRIAL_RED_LINE_RULES, RED_LINE_RULES, RED_LINE_RULE_SETS, type RedLineRule,
} from './red-lines.ts'

export { INDUSTRIAL_RED_LINE_RULES, RED_LINE_RULES, RED_LINE_RULE_SETS }
export type { RedLineRule }

/** persona 字节上限(65536,对齐 agent-instructions maxBytes 口径)。 */
export const MAX_PERSONA_BYTES = 65536

/**
 * 孤立代理项(未成对的 UTF-16 代理码元):高位代理后不跟低位代理,或低位代理
 * 前面不是高位代理。含孤立代理项的字符串无法无损编码为 UTF-8。
 */
const UNPAIRED_SURROGATE_RE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/

/** 校验结果:ok=false 时 issues 为人话明细(直接进 PromptSaveResult.issues)。 */
export interface PersonaValidation {
  readonly ok: boolean
  readonly issues: readonly string[]
}

/** 红线段检查(独立导出:测试与导入链路的分步断言用)。 */
export function checkRedLines(text: string): readonly string[] {
  const issues: string[] = []
  for (const rule of RED_LINE_RULES) {
    if (!rule.pattern.test(text)) {
      issues.push(`缺少红线段「${rule.label}」:${rule.hint}`)
    }
  }
  return issues
}

/** 指定规则集的红线检查(未知规则集 id → 明示 issue,fail-closed 不静默跳过)。 */
export function checkRedLinesOfRuleSet(ruleSetId: string, text: string): readonly string[] {
  const rules = RED_LINE_RULE_SETS[ruleSetId]
  if (rules === undefined) {
    return [`未知红线规则集 ${ruleSetId}(注册表绑定与规则集本体不一致,fail-closed 拒收)`]
  }
  const issues: string[] = []
  for (const rule of rules) {
    if (!rule.pattern.test(text)) {
      issues.push(`缺少红线段「${rule.label}」:${rule.hint}`)
    }
  }
  return issues
}

/** UTF-8 合法性检查(孤立代理项拒收;独立导出便于逐条钉住)。 */
export function checkUtf8WellFormed(text: string): string | undefined {
  const match = UNPAIRED_SURROGATE_RE.exec(text)
  if (match === null) return undefined
  const at = match.index
  return `persona 含无法无损编码为 UTF-8 的孤立代理项(位置 ${at},U+${text.codePointAt(at)?.toString(16).toUpperCase().padStart(4, '0')}),编码后会被替换成 U+FFFD 而损坏内容,拒收`
}

/** 校验 persona 新文本(T7.3 规则全集;fail-closed,任何不满足即拒绝)。 */
export function validatePersonaText(text: unknown): PersonaValidation {
  if (typeof text !== 'string') {
    return { ok: false, issues: ['persona 内容必须是字符串'] }
  }
  const issues: string[] = []
  if (text.trim().length === 0) {
    issues.push('persona 内容不能为空(全空白亦视为空)')
  }
  const utf8Issue = checkUtf8WellFormed(text)
  if (utf8Issue !== undefined) issues.push(utf8Issue)
  const bytes = byteLength(text)
  if (bytes > MAX_PERSONA_BYTES) {
    issues.push(`persona 内容超出上限:${bytes} 字节 > ${MAX_PERSONA_BYTES} 字节(UTF-8 口径)`)
  }
  issues.push(...checkRedLines(text))
  return { ok: issues.length === 0, issues }
}

/**
 * 按条目校验面(T1.6 写链路逐条目生效):结构参数对齐注册表条目字段
 * (redLine/redLineRuleSet/maxBytes),不 import registry(避免环:registry 取
 * MAX_PERSONA_BYTES 于本模块)。
 *
 * 与 validatePersonaText 的关系:对默认 persona 条目
 * (redLine='required' + 'eterna.red-lines.standard' + MAX_PERSONA_BYTES)两者判定
 * 完全一致;差异面 = 字节上限按条目参数化、红线按条目规则集/豁免标记。
 */
export interface EntryValidationSpec {
  /** 红线策略:'required'=按规则集必检;'exempt'=豁免(T1.3 标记)。 */
  readonly redLine: 'required' | 'exempt'
  /** redLine='required' 时的规则集 id(RED_LINE_RULE_SETS 键)。 */
  readonly redLineRuleSet?: string
  /** 写链路字节上限(逐条目;默认 MAX_PERSONA_BYTES)。 */
  readonly maxBytes?: number
}

/** 校验条目新文本(T1.6:非空/UTF-8/条目字节上限/条目红线,fail-closed)。 */
export function validateEntryText(entry: EntryValidationSpec, text: unknown): PersonaValidation {
  if (typeof text !== 'string') {
    return { ok: false, issues: ['内容必须是字符串'] }
  }
  const maxBytes = entry.maxBytes ?? MAX_PERSONA_BYTES
  const issues: string[] = []
  if (text.trim().length === 0) {
    issues.push('内容不能为空(全空白亦视为空)')
  }
  const utf8Issue = checkUtf8WellFormed(text)
  if (utf8Issue !== undefined) issues.push(utf8Issue)
  const bytes = byteLength(text)
  if (bytes > maxBytes) {
    issues.push(`内容超出上限:${bytes} 字节 > ${maxBytes} 字节(UTF-8 口径,本条目上限)`)
  }
  if (entry.redLine === 'required') {
    const ruleSetId = entry.redLineRuleSet ?? ''
    issues.push(...checkRedLinesOfRuleSet(ruleSetId, text))
  }
  return { ok: issues.length === 0, issues }
}
