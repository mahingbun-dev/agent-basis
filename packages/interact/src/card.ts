/**
 * 富上下文审批卡片 payload 构造器(设计文档 08 §6.2「富上下文审批卡片(质量核心)」)。
 *
 * 把裸的「是否允许执行 X?」升级为结构化卡片,五个必备字段:
 * 1. whatWillHappen 将发生什么:具体命令/行业 API 与参数(超长折叠=截断预览);
 * 2. why 为什么:触发的 SOP 条目/skill 名、关联 golden case;
 * 3. impact 影响面:涉及文件(diff 摘要)+ 外部系统对象;
 * 4. rollback 回滚性:effect 逆闭包存在则明示逆操作,不可逆则明示「不可逆」;
 * 5. matchedRule 命中规则:hitl.yaml 条目 id + 风险档 + 依据。
 * R3 附加:升级指定人 / 冷静期 / 二次确认。
 *
 * DSH 呈现形态:`cardToQuestionItems()` 把卡片渲染为官方 user-questions 载荷
 * (AskUserQuestionItem + intent 'approval' 分支:固定 reject/approve 动作、无自由文本、
 * 单选;见 dsh-repo docs/subsystems/user-questions.md:25-64)。二次确认作为同卡第二问,
 * 与 ask.ts 的 ≤3 问上限天然组合。审批应答仍走内核 approval waterfall,本包不改协议。
 */
import { InteractConfigError } from './errors.ts'
import { stableStringify } from './types.ts'
import type { AskUserQuestionItem, AskUserQuestionOption } from '@deepseek-ai/dsh-user-questions'
import type { RiskGrade } from './types.ts'

/** 参数预览截断上限(「超长折叠」:卡片不整段塞入超长参数,截断后加标记)。 */
export const PARAMS_PREVIEW_LIMIT = 2000

/** 将发生什么:命令或行业 API 调用与其参数。 */
export interface CardAction {
  /** 'command' 命令行 | 'api' 行业 API 调用。 */
  readonly kind: 'command' | 'api'
  /** 命令名或 API 名(如 bash / vendor.pay_order)。 */
  readonly name: string
  /** 命令串或 API 参数(unknown,稳定串化后进预览)。 */
  readonly params?: unknown
}

/** 为什么:触发来源(SOP 条目 / skill / golden case / 用户指令)。 */
export interface CardWhy {
  readonly source: 'sop' | 'skill' | 'golden' | 'user'
  /** SOP 条目名 / skill 名 / golden 用例名 / 用户原话摘要。 */
  readonly name: string
  /** 可选细目(如 SOP 章节)。 */
  readonly entry?: string
  /** 可选关联 golden case id。 */
  readonly goldenCase?: string
}

/** 影响面:文件(带 diff 摘要)与外部系统对象。 */
export interface CardImpact {
  readonly files?: readonly CardFileImpact[]
  readonly externalSystems?: readonly CardExternalImpact[]
}

export interface CardFileImpact {
  readonly path: string
  /** diff 摘要(如 "+3/-12 重建预算表")。 */
  readonly diffSummary?: string
}

export interface CardExternalImpact {
  /** 外部系统名(如 飞书 / 支付网关)。 */
  readonly system: string
  /** 受影响对象(如 群消息 / 订单 #123)。 */
  readonly object: string
}

/** 回滚性:逆闭包是否存在。 */
export interface CardRollback {
  /** effect 是否注册了逆闭包。 */
  readonly reversible: boolean
  /** 逆操作名(reversible 时建议提供,如 git checkout)。 */
  readonly inverseOf?: string
  /** 补充说明(如 逆操作的数据窗口)。 */
  readonly note?: string
}

/** 命中规则:hitl.yaml 条目。 */
export interface CardMatchedRule {
  readonly ruleId: string
  /** 只允许 R2|R3——R0/R1 不产生审批卡片(fail-closed 校验)。 */
  readonly grade: RiskGrade
  readonly reason: string
}

/** R3 附加控制(仅 R3 卡片允许携带)。 */
export interface CardR3Controls {
  /** 升级给指定人(hitl escalate_to)。 */
  readonly escalateTo: readonly string[]
  /** 冷静期秒数(0 = 无)。 */
  readonly coolingPeriodSec: number
  /** 是否强制二次确认(产生同卡第二问)。 */
  readonly doubleConfirm: boolean
}

/** buildApprovalCard 的完整输入。 */
export interface ApprovalCardInput {
  readonly action: CardAction
  readonly why: CardWhy
  readonly impact: CardImpact
  readonly rollback: CardRollback
  readonly matchedRule: CardMatchedRule
  /** 卡片主体名(呈现给用户的对象名;缺省用 action.name)。 */
  readonly subjectName?: string
  /** R3 附加控制;仅当 matchedRule.grade === 'R3' 时允许出现。 */
  readonly r3?: CardR3Controls
}

/** 富审批卡片 payload(结构化字段 + 渲染好的 detail markdown)。 */
export interface ApprovalCard {
  readonly whatWillHappen: {
    readonly kind: 'command' | 'api'
    readonly name: string
    /** 参数预览(稳定串化;超 PARAMS_PREVIEW_LIMIT 截断并标记)。 */
    readonly paramsPreview: string
    /** 一句话摘要(命令/API + 参数)。 */
    readonly summary: string
  }
  readonly why: CardWhy & { readonly summary: string }
  readonly impact: CardImpact & {
    readonly files: readonly CardFileImpact[]
    readonly externalSystems: readonly CardExternalImpact[]
    readonly summary: string
  }
  readonly rollback: CardRollback & {
    /** 明示语句:可逆则点名逆操作,不可逆则明示不可逆。 */
    readonly statement: string
  }
  readonly matchedRule: CardMatchedRule
  readonly r3?: CardR3Controls
  /** 渲染为 markdown 的卡片正文(卡片 detail 字段;分段标题供 UI 折叠)。 */
  readonly renderedDetail: string
}

/** 构造富审批卡片 payload;结构不合法即抛 InteractConfigError(fail-closed)。 */
export function buildApprovalCard(input: ApprovalCardInput): ApprovalCard {
  const issues: string[] = []
  if (input.action.name === '') issues.push('action.name 不能为空')
  if (input.why.name === '') issues.push('why.name 不能为空')
  const files = input.impact.files ?? []
  const externalSystems = input.impact.externalSystems ?? []
  if (files.length === 0 && externalSystems.length === 0) {
    issues.push('impact 至少要有一条影响面(文件或外部系统对象)')
  }
  if (input.matchedRule.grade !== 'R2' && input.matchedRule.grade !== 'R3') {
    issues.push('matchedRule.grade 只允许 R2|R3(R0/R1 不出审批卡片)')
  }
  if (input.matchedRule.ruleId === '') issues.push('matchedRule.ruleId 不能为空')
  if (input.matchedRule.grade !== 'R3' && input.r3 !== undefined) {
    issues.push('r3 附加控制只允许出现在 R3 卡片')
  }
  if (issues.length > 0) throw new InteractConfigError('审批卡片载荷校验失败', issues)

  const paramsPreview = previewParams(input.action.params)
  const whatSummary = `${input.action.kind === 'command' ? '命令' : 'API'} ${input.action.name}${paramsPreview === '' ? '' : ` ${paramsPreview}`}`
  const whySummary = `${sourceLabel(input.why.source)}:${input.why.name}${input.why.entry === undefined ? '' : `(${input.why.entry})`}`
  const rollbackStatement = input.rollback.reversible
    ? `可回滚:已注册逆闭包${input.rollback.inverseOf === undefined ? '' : `(${input.rollback.inverseOf})`}`
    : '不可逆:该动作未注册逆闭包,执行后无法自动撤销'

  const card: ApprovalCard = {
    whatWillHappen: {
      kind: input.action.kind,
      name: input.action.name,
      paramsPreview,
      summary: whatSummary,
    },
    why: { ...input.why, summary: whySummary },
    impact: {
      ...input.impact,
      files: [...files],
      externalSystems: [...externalSystems],
      summary: [
        ...files.map(file => `文件 ${file.path}${file.diffSummary === undefined ? '' : `(${file.diffSummary})`}`),
        ...externalSystems.map(ext => `外部系统 ${ext.system}:${ext.object}`),
      ].join(' / '),
    },
    rollback: { ...input.rollback, statement: rollbackStatement },
    matchedRule: { ...input.matchedRule },
    ...(input.r3 !== undefined && { r3: { ...input.r3, escalateTo: [...input.r3.escalateTo] } }),
    renderedDetail: '',
  }
  return { ...card, renderedDetail: renderDetail(card) }
}

export interface CardQuestionOptions {
  /** 问题 id;缺省 `approve:${ruleId}`。 */
  readonly id?: string
  /** 允许按钮文案;缺省「允许执行一次」。 */
  readonly approveLabel?: string
  /** 拒绝按钮文案;缺省「拒绝」。 */
  readonly rejectLabel?: string
}

/**
 * 把卡片渲染为官方 user-questions 载荷:
 * 1 问(intent approval:固定 approve/reject 动作、单选、无自由文本);
 * R3 doubleConfirm 时追加第二问(冷静期后的复核确认),同卡 ≤3 问上限由 ask.ts 兜底。
 * 选项恰好覆盖 approve/reject(DSH 要求 action labels 必须恰覆盖 offered options)。
 */
export function cardToQuestionItems(card: ApprovalCard, options: CardQuestionOptions = {}): AskUserQuestionItem[] {
  const approve = options.approveLabel ?? '允许执行一次'
  const reject = options.rejectLabel ?? '拒绝'
  const id = options.id ?? `approve:${card.matchedRule.ruleId}`
  const optionsList: AskUserQuestionOption[] = [
    { label: approve, description: '本次允许,不产生持久授权(DSH 仅一次性授权)' },
    { label: reject, description: '拒绝该动作并停止执行' },
  ]
  const mainQuestion: AskUserQuestionItem = {
    id,
    question: `是否允许执行 ${card.whatWillHappen.name}?(${card.matchedRule.grade} · ${card.matchedRule.ruleId})`,
    ...(card.renderedDetail !== '' && { detail: card.renderedDetail }),
    header: card.matchedRule.grade === 'R3' ? 'R3 高危审批' : 'R2 确认',
    options: optionsList,
    intent: {
      kind: 'approval',
      approve,
      reject,
      subject: { name: card.why.name },
    },
  }
  const items: AskUserQuestionItem[] = [mainQuestion]
  if (card.r3?.doubleConfirm === true) {
    items.push({
      id: `${id}:confirm`,
      question: '二次确认:已知悉影响面与回滚性,仍要执行该高危动作?',
      header: 'R3 二次确认',
      options: [...optionsList],
    })
  }
  return items
}

function previewParams(params: unknown): string {
  if (params === undefined) return ''
  const serialized = stableStringify(params)
  return serialized.length > PARAMS_PREVIEW_LIMIT
    ? `${serialized.slice(0, PARAMS_PREVIEW_LIMIT)}…(超长已折叠,共 ${serialized.length} 字符)`
    : serialized
}

function sourceLabel(source: CardWhy['source']): string {
  switch (source) {
    case 'sop': return 'SOP 条目'
    case 'skill': return 'skill'
    case 'golden': return 'golden case'
    case 'user': return '用户指令'
  }
}

function renderDetail(card: ApprovalCard): string {
  const lines: string[] = []
  lines.push('## 将发生什么')
  lines.push(`- ${card.whatWillHappen.summary}`)
  if (card.whatWillHappen.paramsPreview !== '') lines.push(`- 参数:${card.whatWillHappen.paramsPreview}`)
  lines.push('## 为什么')
  lines.push(`- ${card.why.summary}${card.why.goldenCase === undefined ? '' : `(关联 golden:${card.why.goldenCase})`}`)
  lines.push('## 影响面')
  for (const file of card.impact.files) {
    lines.push(`- 文件 ${file.path}${file.diffSummary === undefined ? '' : `:${file.diffSummary}`}`)
  }
  for (const ext of card.impact.externalSystems) {
    lines.push(`- 外部系统 ${ext.system}:${ext.object}`)
  }
  lines.push('## 回滚性')
  lines.push(`- ${card.rollback.statement}${card.rollback.note === undefined ? '' : `(${card.rollback.note})`}`)
  lines.push('## 命中规则')
  lines.push(`- ${card.matchedRule.grade} · ${card.matchedRule.ruleId}:${card.matchedRule.reason}`)
  if (card.r3 !== undefined) {
    lines.push('## R3 附加控制')
    lines.push(`- 升级给:${card.r3.escalateTo.length > 0 ? card.r3.escalateTo.join('、') : '(未配置)'}`)
    lines.push(`- 冷静期:${card.r3.coolingPeriodSec > 0 ? `${card.r3.coolingPeriodSec} 秒` : '未配置'}`)
    lines.push(`- 二次确认:${card.r3.doubleConfirm ? '需要' : '不需要'}`)
  }
  return lines.join('\n')
}
