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
  /** 稳定 id(审计/测试引用;T1.6 起为开放串——各规则集自有 id 面)。 */
  readonly id: string
  /** 人话名(issues 与 UI 提示用)。 */
  readonly label: string
  /** 锚点正则(宽容匹配:措辞可改,语义锚点必须在;双语条目中英锚点任一命中即可)。 */
  readonly pattern: RegExp
  /** 人话修复提示(issues 明细)。 */
  readonly hint: string
}

/**
 * 三条红线(顺序即 issues 顺序;锚点实例:
 * 「预算超支 >5% 的任何变更必须触发 R3 审批」「agent 不得代付、代签、代定标」
 * 「比选必须中立:三家全列、统一口径、引用报价来源」)。
 * T1.6 双语锚点:英文转述对齐 packs/event-planning/cordis.patch.yml personaPrefix
 * 的既有句("Never silently exceed budgets / never make or promise external payments /
 * stay neutral in vendor selection")——该条目绑标准规则集,锚点须认得它的真实文本。
 */
export const RED_LINE_RULES: readonly RedLineRule[] = [
  {
    id: 'budget-overrun',
    label: '预算不超支',
    pattern: /预算.{0,6}超支|exceed budgets/u,
    hint: 'persona 须声明预算红线(锚点示例:「预算超支 >5% 必须触发审批」/「预算不得超支」/「Never silently exceed budgets」)',
  },
  {
    id: 'no-payment',
    label: '不代付',
    pattern: /不.{0,2}代付|external payments/u,
    hint: 'persona 须声明付款红线(锚点示例:「对外付款/合同签署/定标一律升级给人,agent 不得代付」/「never make or promise external payments」)',
  },
  {
    id: 'neutral-comparison',
    label: '比选中立',
    pattern: /比选.{0,6}中立|neutral in vendor selection/u,
    hint: 'persona 须声明比选中立红线(锚点示例:「供应商比选必须中立,不偏向任何指定供应商」/「stay neutral in vendor selection」)',
  },
]

/**
 * 工业数智分析四条红线(T1.6 落地;注册表 redLineRuleSet=
 * 'eterna.red-lines.industrial-analysis' 的条目专用):对齐
 * packs/industrial-analysis/persona.md「全局硬约束」与同包 personaPrefix 英文句
 * (达梦只读/只经 MCP/对外发送 R2 确认/deny 优先 fail-closed)。
 */
export const INDUSTRIAL_RED_LINE_RULES: readonly RedLineRule[] = [
  {
    id: 'dm-readonly',
    label: '达梦业务库只读',
    pattern: /达梦业务库只读|DM business database is read-only/u,
    hint: 'persona 须声明达梦只读红线(锚点示例:「达梦业务库只读,写权限仅限预警记录表」/「The DM business database is read-only」)',
  },
  {
    id: 'mcp-only',
    label: '数据知识层只经 MCP',
    pattern: /只经\s*MCP|only\s+via\s+MCP/u,
    hint: 'persona 须声明 MCP-only 红线(锚点示例:「数据与知识层只经 MCP 访问,不直连库」/「accessed only via MCP」)',
  },
  {
    id: 'external-send-r2',
    label: '对外发送须 R2 确认',
    pattern: /对外发送.{0,24}确认|external send requires confirmation/u,
    hint: 'persona 须声明对外发送红线(锚点示例:「对外发送(通报/报告/短信/邮件)必须确认(R2)」/「every external send requires confirmation (R2)」)',
  },
  {
    id: 'deny-first',
    label: 'deny 优先 fail-closed',
    pattern: /deny\s*优先|[Dd]eny-first/u,
    hint: 'persona 须声明 deny-first 红线(锚点示例:「deny 优先、fail-closed」/「Deny-first, fail-closed」)',
  },
]

/** 红线规则集登记面(注册表 redLineRuleSet id → 规则本体;未知 id fail-closed)。 */
export const RED_LINE_RULE_SETS: Readonly<Record<string, readonly RedLineRule[]>> = {
  'eterna.red-lines.standard': RED_LINE_RULES,
  'eterna.red-lines.industrial-analysis': INDUSTRIAL_RED_LINE_RULES,
}

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
