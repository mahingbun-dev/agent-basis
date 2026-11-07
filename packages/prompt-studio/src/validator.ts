/**
 * persona 文本校验器(T7.3 规则全集,逐条有 vitest 钉住):
 *
 * 1. 必须是字符串;
 * 2. 非空(去首尾空白后非空);
 * 3. UTF-8 合法:不含孤立代理项( lone surrogate )——JS 字符串是 UTF-16,孤立代理项
 *    编码到 UTF-8 时会被 Buffer/TextEncoder 静默替换成 U+FFFD,导致「存进去的
 *    checksum/字节」与「写盘落点」口径漂移,fail-closed 拒收;
 * 4. ≤65536 UTF-8 字节(对齐 dsh agent-instructions maxBytes 口径,计划书 §6 T7.3);
 * 5. 红线段必须存在:三条红线锚点对齐 packs/event-planning/persona.md 的「全局硬约束」
 *    段(预算不超支/不代付/比选中立)。红线是部署级安全不变量——不许经工坊编辑把
 *    safety rails 从 system prompt 里删掉(锚点为宽容正则,改写措辞不改语义即可通过);
 * 6. diff 非空才可保存:不在本模块(diffLines.isEmpty,写链路 handleWrite 把守),
 *    与「导出包 schemaVersion+checksum 拒收」(export-pack.ts)并列 T7.3 校验全集。
 */
import { byteLength } from './checksum.ts'

/** persona 字节上限(65536,对齐 agent-instructions maxBytes 口径)。 */
export const MAX_PERSONA_BYTES = 65536

/**
 * 孤立代理项(未成对的 UTF-16 代理码元):高位代理后不跟低位代理,或低位代理
 * 前面不是高位代理。含孤立代理项的字符串无法无损编码为 UTF-8。
 */
const UNPAIRED_SURROGATE_RE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/

/** 红线锚点(对齐 packs/event-planning/persona.md「全局硬约束」三条)。 */
export interface RedLineRule {
  /** 稳定 id(审计/测试引用)。 */
  readonly id: 'budget-overrun' | 'no-payment' | 'neutral-comparison'
  /** 人话名(issues 与 UI 提示用)。 */
  readonly label: '预算不超支' | '不代付' | '比选中立'
  /** 锚点正则(宽容匹配:措辞可改,语义锚点必须在)。 */
  readonly pattern: RegExp
  /** 人话修复提示(issues 明细)。 */
  readonly hint: string
}

/**
 * 三条红线(顺序即 issues 顺序;锚点实例:
 * 「预算超支 >5% 的任何变更必须触发 R3 审批」「agent 不得代付、代签、代定标」
 * 「比选必须中立:三家全列、统一口径、引用报价来源」)。
 */
export const RED_LINE_RULES: readonly RedLineRule[] = [
  {
    id: 'budget-overrun',
    label: '预算不超支',
    pattern: /预算.{0,6}超支/u,
    hint: 'persona 须声明预算红线(锚点示例:「预算超支 >5% 必须触发审批」或「预算不得超支」)',
  },
  {
    id: 'no-payment',
    label: '不代付',
    pattern: /不.{0,2}代付/u,
    hint: 'persona 须声明付款红线(锚点示例:「对外付款/合同签署/定标一律升级给人,agent 不得代付」)',
  },
  {
    id: 'neutral-comparison',
    label: '比选中立',
    pattern: /比选.{0,6}中立/u,
    hint: 'persona 须声明比选中立红线(锚点示例:「供应商比选必须中立,不偏向任何指定供应商」)',
  },
]

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
