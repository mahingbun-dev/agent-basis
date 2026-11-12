/**
 * 红线规则集本体(纯模块:零 node 依赖,Host/Client 单一事实源)。
 *
 * 2026-11-12 从 validator.ts 拆出:客户端编辑器要按条目规则集对草稿做「缺失红线
 * 预检查 + 一键插入缺失红线段」(修复「persona 编辑保存必被拒且无预提示」),而
 * validator.ts 传递依赖 checksum(node:crypto/Buffer)不能进客户端 bundle
 * (tests/client-bundle.test.ts 钉住零运行时依赖)。服务端校验函数仍在 validator.ts
 * (从这里 import 规则本体并 re-export,既有 import 面零改动)。
 */

/** 红线锚点规则(对齐 packs 领域 persona 的「全局硬约束」)。 */
export interface RedLineRule {
  /** 稳定 id(审计/测试/插入文案映射引用)。 */
  readonly id: string
  /** 人话名(issues 与 UI 提示用)。 */
  readonly label: string
  /** 锚点正则(宽容匹配:措辞可改,语义锚点必须在;双语条目中英锚点任一命中即可)。 */
  readonly pattern: RegExp
  /** 人话修复提示(issues 明细)。 */
  readonly hint: string
}

/**
 * 标准三条红线(顺序即 issues 顺序;锚点实例:
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

/**
 * 缺失红线段的插入文案(逐规则 id → 一整行;「插入缺失红线段」按钮用)。
 * 措辞与 2026-11-12 补进两预设 persona 基线的红线段逐字一致(基线即示范),
 * 双语锚点中文侧全部命中对应 pattern。
 */
export const RED_LINE_INSERT_LINES: Readonly<Record<string, string>> = {
  'budget-overrun': '- 预算红线:凡预算超支超过 5% 的变更必须先触发审批,未获批不得执行。',
  'no-payment': '- 资金红线:对外付款、合同签署与供应商定标一律升级给人确认,agent 不得代付、代签、代定标。',
  'neutral-comparison': '- 比选红线:供应商比选必须中立,候选全列、口径统一、引用报价来源,不偏向任何指定供应商。',
  'dm-readonly': '- 达梦业务库只读:写权限仅限预警记录表。',
  'mcp-only': '- 数据与知识层只经 MCP 访问,不直连库。',
  'external-send-r2': '- 对外发送(通报/报告/短信/邮件)必须先经确认(R2)。',
  'deny-first': '- deny 优先、fail-closed:规则未显式允许一律拒绝。',
}

/** 指定规则集下,文本缺失的红线规则(编辑器预检查;未知规则集 → 空数组不动预检查)。 */
export function missingRedLineRules(ruleSetId: string | undefined, text: string): readonly RedLineRule[] {
  if (ruleSetId === undefined) return []
  const rules = RED_LINE_RULE_SETS[ruleSetId]
  if (rules === undefined) return []
  return rules.filter(rule => !rule.pattern.test(text))
}

/** 缺失规则的插入文案(按钮一次性追加用;保持规则集顺序)。 */
export function redLineInsertLinesOf(missing: readonly RedLineRule[]): readonly string[] {
  return missing
    .map(rule => RED_LINE_INSERT_LINES[rule.id])
    .filter((line): line is string => line !== undefined)
}
