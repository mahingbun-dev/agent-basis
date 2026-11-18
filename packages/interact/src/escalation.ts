/**
 * escalate / cooling_period / double_confirm / on_no_answer 运行时接线
 * (39 号 §3-E4/E5/E6,缝合 G2 半接线:hitl.ts 四个声明字段此前零运行时消费者)。
 *
 * E4 escalate:escalateTo / on_no_answer='escalate' 的出站消费者——出站形态=channels
 * 审批卡(ApprovalActionPayload:approve/reject 各一枚一次性令牌,channels buildApprovalCard
 * 强制装配 + validateOutboundCard 强校验);Attention 场景取严单问(24 §2.1 行为律 3,
 * 39 §5-3:出站卡只带 cardToQuestionItems 主问);升级不并发(24 §8.1-3:同一
 * approvalRequestId 至多一条在途出站问询,进程内 Set + 显式清理,不落业务台账)。
 * E5 冷静期+双确认:doubleConfirm=同卡第二问(card.ts:220-227 渲染既有),运行时判定=
 * confirmGate 纯函数——两问(approve:<ruleId> 与 approve:<ruleId>:confirm)均须 approve
 * 才放行 allowed-once,任一 reject 即 rejected;冷静期=approve 生效时刻不早于签发时刻
 * + coolingPeriodSec(第二问即「冷静期后的复核确认」,与冷静期天然同卡)。冷静期窗口
 * 冻结超时计时为实现裁量(39 §3-E5,开放问题 §9-5:否则 300s 桥超时先于较长冷静期触发
 * unavailable,配置形同虚设)——体现为本函数对 await-cooling 不判定终局。
 * E6 on_no_answer:ask 不可达/无人应答终局(approval-bridge 超时→'unavailable')按三策略
 * 分派——suspend(任务暂停非失败,replay 可恢复:只发 onSuspended 事件,无 denied/无负信号,
 * 不建临时台账)/ escalate(转 E4 出站,去重纪律继承)/ fail(denied 收场,reasons 引用
 * 规则 id;不发布负信号——unavailable 不是用户否定,negative.ts:12-13)。词表沿用
 * approval-bridge:'unavailable'=无可用审批渠道,不冒充用户拒绝(access/approval-bridge.ts:14-15)。
 *
 * Cordis 纪律:纯运行时对象 + 显式配逆(dispose 清在途登记);传输/令牌/寻址全部注入
 * (channels CardTransport「不真连」先例,channels/src/cards.ts:10-11),组合层(E8 glue)
 * 把 channels ApprovalTokenService 与适配器接进来。审批协议不改:应答仍走内核 approval
 * waterfall / webhook /approval/:token,本模块只做接线判定。
 */
import { buildApprovalCard as buildOutboundApprovalCard, validateOutboundCard } from '@eterna/channels'
import type {
  ApprovalTokenRedemption, ApprovalTokenService, DeliveryReceipt, OutboundCard,
} from '@eterna/channels'
import { cardToQuestionItems } from './card.ts'
import type { ApprovalCard } from './card.ts'
import { InteractConfigError } from './errors.ts'
import type { HitlRule } from './hitl.ts'
import type { NoAnswerStrategy, RiskGrade } from './types.ts'

/** 出站令牌服务端口:channels ApprovalTokenService 的调用面子集(组合层注入真实实例)。 */
export type EscalationTokenService = Pick<ApprovalTokenService, 'issuePair' | 'redeem' | 'revokeAll' | 'pendingCount'>

/** 出站发送面:ChannelAdapter.sendCard 形态(channels types.ts:88-93;不真连,传输注入)。 */
export type EscalationSendCard = (card: OutboundCard, recipient: string) => Promise<DeliveryReceipt>

/** escalate / dispatchNoAnswer 共用的审批请求定位(令牌绑定 token.ts issuePair 入参)。 */
export interface EscalationContext {
  readonly approvalRequestId: string
  readonly sessionId: string
}

export interface EscalationRuntimeOptions {
  /** 一次性审批令牌服务(签发/回收;真实实现=channels ApprovalTokenService)。 */
  readonly tokens: EscalationTokenService
  /** 出站发送面(适配器 sendCard;测试注入桩,不真连)。 */
  readonly sendCard: EscalationSendCard
  /** 出站渠道适配器 ID(ApprovalActionPayload.channel 归因,如 'feishu/card')。 */
  readonly channel: string
  /** URL 型渠道(钉钉/邮件/微信)审批链接前缀;拼 /approval/:token。 */
  readonly approvalBaseUrl?: string
  /**
   * escalate_to 字符串 → 渠道 recipient 的解析端口(寻址格式设计未定,39 §9-2 悬置);
   * 缺省=原样透传。
   */
  readonly resolveRecipient?: (target: string) => string | undefined
  /** 出站动作文案;缺省同源 card.ts:199-205(「允许执行一次」/「拒绝」,39 §5-6)。 */
  readonly approveLabel?: string
  readonly rejectLabel?: string
  /** 时钟注入(测试确定性);缺省 Date.now。 */
  readonly now?: () => number
}

export type EscalationStatus = 'escalated' | 'duplicate' | 'no-recipients'

/** escalate 出站结果(39 §3-E4)。 */
export interface EscalationOutcome {
  readonly status: EscalationStatus
  readonly approvalRequestId: string
  /** 实际送达的 recipient 列表(status='escalated' 时非空)。 */
  readonly recipients: readonly string[]
  /** 出站卡(status='escalated' 时在场;approval 载荷含 approve/reject 双令牌)。 */
  readonly card?: OutboundCard
}

/* ------------------------- E5:冷静期 + 双确认运行时判定(纯函数) ------------------------- */

/** 逐问应答表:questionId(approve:<ruleId> / approve:<ruleId>:confirm)→ 决定。 */
export type ConfirmAnswerMap = Readonly<Record<string, 'approve' | 'reject'>>

/**
 * 复核门三态:
 * - 'allow-once':必答问均已 approve 且已过冷静期——放行为一次性授权(card.ts:203
 *   「本次允许,不产生持久授权」);
 * - 'reject':任一必答问被拒——rejected;
 * - 'await-cooling':未生效仍在等待窗口(必答问未答全,或两问虽 approve 但仍处冷静期)
 *   ——第二问即「冷静期后的复核确认」(card.ts:195),未答与未到点同属该窗口;
 *   非终局,不计入 unavailable 判定(冷静期冻结超时计时,§3-E5 实现裁量)。
 */
export type ConfirmGateResult = 'allow-once' | 'reject' | 'await-cooling'

/** 主问 id(与 cardToQuestionItems 缺省 id 同式,card.ts:201)。 */
function approvalQuestionId(card: ApprovalCard): string {
  return `approve:${card.matchedRule.ruleId}`
}

/**
 * doubleConfirm / coolingPeriodSec 的运行时判定(39 §3-E5 落点;假时钟经 now 注入):
 * - doubleConfirm=true:两问均须 approve 才 'allow-once',任一 reject 即 'reject';
 * - doubleConfirm=false:单问即决(现行行为);
 * - coolingPeriodSec>0:approve 生效时刻不早于 issuedAt + coolingPeriodSec;
 *   issuedAt 缺省=now(未提供签发时刻则不计已流逝的冷静期,fail-closed 方向)。
 */
export function confirmGate(
  card: ApprovalCard,
  answers: ConfirmAnswerMap,
  now: number,
  issuedAt: number = now,
): ConfirmGateResult {
  const mainId = approvalQuestionId(card)
  const mainAnswer = answers[mainId]
  const confirmAnswer = card.r3?.doubleConfirm === true ? answers[`${mainId}:confirm`] : undefined
  if (mainAnswer === 'reject' || confirmAnswer === 'reject') return 'reject'
  if (mainAnswer !== 'approve') return 'await-cooling'
  if (card.r3?.doubleConfirm === true && confirmAnswer !== 'approve') return 'await-cooling'
  const coolingMs = (card.r3?.coolingPeriodSec ?? 0) * 1000
  if (now - issuedAt < coolingMs) return 'await-cooling'
  return 'allow-once'
}

/* ------------------------- E6:on_no_answer 三策略分派 ------------------------- */

/** 分派动作词表(39 §3-E6;'suspended'=暂停非失败,不与桥词表的拒绝表述混用)。 */
export type NoAnswerAction = 'suspended' | 'escalated' | 'failed'

/** 分派所需的规则引用面(HitlRule 满足之;onNoAnswer 已含全局缺省两级归一,hitl.ts:120/:234)。 */
export type NoAnswerRuleRef = Pick<HitlRule, 'id' | 'grade' | 'onNoAnswer'>

/** dispatchNoAnswer 入参。 */
export interface NoAnswerDispatchInput {
  readonly rule: NoAnswerRuleRef
  /** 触发面=ask 不可达/无人应答的终局(现行宿主事实:approval-bridge 超时→unavailable)。 */
  readonly outcome: 'unavailable'
  readonly approvalRequestId: string
  /** escalate 策略必填(出站卡);suspend/fail 可选。 */
  readonly card?: ApprovalCard
  /** escalate 策略必填(令牌绑定 sessionId)。 */
  readonly sessionId?: string
  /** 调用方注入的升级目标(缺省取 card.r3.escalateTo)。 */
  readonly targets?: readonly string[]
}

/** 分派结果:fail 带 denied(reasons 引用规则 id);escalate 带 E4 出站结果。 */
export interface NoAnswerDispatch {
  readonly action: NoAnswerAction
  readonly ruleId: string
  /** action='escalated' 时在场(E4 断言复用)。 */
  readonly escalation?: EscalationOutcome
  /** action='failed' 时在场:以 denied 收场;不发布负信号(unavailable 非用户否定)。 */
  readonly denied?: { readonly reasons: readonly string[] }
}

/** onSuspended 事件(39 §3-E6:挂起登记的归口是 tasks/组合层,本包只发事件;§9-4)。 */
export interface OnSuspendedEvent {
  readonly kind: 'on-suspended'
  readonly approvalRequestId: string
  readonly ruleId: string
  readonly grade: RiskGrade
  /** 语义=任务暂停非失败、replay 可恢复(不产出 denied/rejected)。 */
  readonly time: number
}

export type OnSuspendedListener = (event: OnSuspendedEvent) => void

/** 应答回收结果:令牌兑付 + 在场卡的复核门判定(E5 在应答回收处校验)。 */
export interface EscalationSettlement {
  readonly redemption: ApprovalTokenRedemption
  /** 有在途卡登记时求值(渠道点击=主问应答);doubleConfirm 卡仍待第二问时为 'await-cooling'。 */
  readonly gate?: ConfirmGateResult
}

/** 在途升级登记(升级不并发去重键 + 应答/冷静期锚点;进程内,不落业务台账)。 */
interface EscalationRecord {
  readonly card: ApprovalCard
  readonly issuedAt: number
  readonly answers: Map<string, 'approve' | 'reject'>
}

/**
 * 升级运行时(E4/E5/E6 接线本体;独立工厂形态,组合层随 ctx.interact 一起 provide)。
 * 出站不真连:sendCard / tokens / resolveRecipient 全部注入,本类只做接线判定与在途去重。
 */
export class EscalationRuntime {
  private readonly tokens: EscalationTokenService
  private readonly sendCard: EscalationSendCard
  private readonly channel: string
  private readonly approvalBaseUrl: string | undefined
  private readonly resolveRecipient: (target: string) => string | undefined
  private readonly approveLabel: string
  private readonly rejectLabel: string
  private readonly now: () => number
  private readonly inFlight = new Set<string>()
  private readonly records = new Map<string, EscalationRecord>()
  private readonly suspendedListeners = new Set<OnSuspendedListener>()

  constructor(options: EscalationRuntimeOptions) {
    if (options.channel === '') throw new InteractConfigError('escalation channel(适配器 ID)不能为空')
    this.tokens = options.tokens
    this.sendCard = options.sendCard
    this.channel = options.channel
    this.approvalBaseUrl = options.approvalBaseUrl
    this.resolveRecipient = options.resolveRecipient ?? ((target: string): string => target)
    this.approveLabel = options.approveLabel ?? '允许执行一次'
    this.rejectLabel = options.rejectLabel ?? '拒绝'
    this.now = options.now ?? Date.now
  }

  /** 在途升级的 approvalRequestId 快照(升级不并发纪律的观测面)。 */
  get pendingEscalations(): readonly string[] {
    return [...this.inFlight]
  }

  /**
   * E4 出站升级:按 card.r3.escalateTo(hitl 解析产物经 card.ts:177 透传)或调用方注入的
   * targets 出站;同一 approvalRequestId 二次调用被去重(升级不并发,恰一条在途出站问询)。
   * 出站卡=channels 审批卡:双令牌载荷强制装配,Attention 单问(只带主问)。
   */
  async escalate(
    card: ApprovalCard,
    targets: readonly string[],
    context: EscalationContext,
  ): Promise<EscalationOutcome> {
    const { approvalRequestId, sessionId } = context
    if (approvalRequestId === '' || sessionId === '') {
      throw new InteractConfigError('escalate 需要 approvalRequestId 与 sessionId(令牌绑定)')
    }
    if (this.inFlight.has(approvalRequestId)) {
      return { status: 'duplicate', approvalRequestId, recipients: [] }
    }
    const effectiveTargets = targets.length > 0 ? targets : (card.r3?.escalateTo ?? [])
    const recipients: string[] = []
    for (const target of effectiveTargets) {
      const recipient = this.resolveRecipient(target)
      if (recipient !== undefined && recipient !== '' && !recipients.includes(recipient)) {
        recipients.push(recipient)
      }
    }
    if (recipients.length === 0) {
      return { status: 'no-recipients', approvalRequestId, recipients: [] }
    }
    const pair = this.tokens.issuePair({ approvalRequestId, sessionId })
    const mainQuestion = cardToQuestionItems(card)[0]
    if (mainQuestion === undefined) {
      throw new InteractConfigError('审批卡片渲染不出主问(cardToQuestionItems 返回空)')
    }
    const outbound = buildOutboundApprovalCard({
      approvalRequestId,
      channel: this.channel,
      title: mainQuestion.question,
      body: card.renderedDetail,
      actions: [
        { label: this.approveLabel, decision: 'approve', token: pair.approve.token },
        { label: this.rejectLabel, decision: 'reject', token: pair.reject.token },
      ],
      ...(this.approvalBaseUrl !== undefined && { approvalBaseUrl: this.approvalBaseUrl }),
      metadata: { ruleId: card.matchedRule.ruleId, grade: card.matchedRule.grade },
    })
    validateOutboundCard(outbound)
    for (const recipient of recipients) {
      await this.sendCard(outbound, recipient)
    }
    this.inFlight.add(approvalRequestId)
    this.records.set(approvalRequestId, { card, issuedAt: pair.approve.issuedAt, answers: new Map() })
    return { status: 'escalated', approvalRequestId, recipients, card: outbound }
  }

  /**
   * 应答回收(webhook /approval/:token 令牌点击路径的接线半边):兑付令牌→一渠道应答即
   * revokeAll 作废余票(防迟点再点复活已结束的审批,token.ts:169-173)→清理在途登记;
   * 有在途卡时渠道点击记为主问应答并过 E5 复核门(doubleConfirm 卡仍待第二问则 await-cooling)。
   */
  settleWithToken(token: string): EscalationSettlement {
    const redemption = this.tokens.redeem(token)
    if (!redemption.ok) return { redemption }
    this.tokens.revokeAll(redemption.approvalRequestId)
    this.inFlight.delete(redemption.approvalRequestId)
    const record = this.records.get(redemption.approvalRequestId)
    if (record === undefined) return { redemption }
    record.answers.set(approvalQuestionId(record.card), redemption.decision)
    return {
      redemption,
      gate: confirmGate(record.card, Object.fromEntries(record.answers), this.now(), record.issuedAt),
    }
  }

  /**
   * E6 on_no_answer 分派:按规则策略(全局缺省两级归一已在 hitl.ts 解析期完成)分派
   * unavailable 终局——suspend 只发 onSuspended 事件(恰一次,无 denied/无负信号);
   * escalate 转 E4 出站(升级行为与去重纪律继承);fail 以 denied 收场(reasons 引用
   * 规则 id,对齐内核 fail-closed 方向;不发布负信号)。
   */
  async dispatchNoAnswer(input: NoAnswerDispatchInput): Promise<NoAnswerDispatch> {
    const { rule, approvalRequestId } = input
    const action = resolveNoAnswerAction(rule, input.outcome)
    if (action === 'suspended') {
      this.emitSuspended({
        kind: 'on-suspended',
        approvalRequestId,
        ruleId: rule.id,
        grade: rule.grade,
        time: this.now(),
      })
      return { action, ruleId: rule.id }
    }
    if (action === 'escalated') {
      if (input.card === undefined || input.sessionId === undefined) {
        throw new InteractConfigError(`规则 ${rule.id} on_no_answer=escalate 分派需要 card 与 sessionId`)
      }
      const escalation = await this.escalate(input.card, input.targets ?? [], {
        approvalRequestId,
        sessionId: input.sessionId,
      })
      return { action, ruleId: rule.id, escalation }
    }
    return {
      action,
      ruleId: rule.id,
      denied: { reasons: [`on_no_answer=fail(hitl 规则 ${rule.id}):无人应答,以 denied 收场`] },
    }
  }

  /** 订阅 onSuspended 事件(挂起登记归口=tasks/组合层,39 §9-4);返回退订函数。 */
  onSuspended(listener: OnSuspendedListener): () => void {
    this.suspendedListeners.add(listener)
    return () => {
      this.suspendedListeners.delete(listener)
    }
  }

  /** 配逆:清在途登记与应答记录(显式清理;不触碰注入的令牌服务,其生命周期归提供方)。 */
  dispose(): void {
    this.inFlight.clear()
    this.records.clear()
    this.suspendedListeners.clear()
  }

  /** 发布 onSuspended 事件(监听器抛错被隔离,负信号总线同构 negative.ts:96-99)。 */
  private emitSuspended(event: OnSuspendedEvent): void {
    for (const listener of this.suspendedListeners) {
      try {
        listener(event)
      } catch {
        // 监听器故障不拖垮分派方,也不中断其余监听器。
      }
    }
  }
}

/** 独立工厂(39 §3-E4「实例态挂 createInteract 产物或独立工厂」的后一形态)。 */
export function createEscalationRuntime(options: EscalationRuntimeOptions): EscalationRuntime {
  return new EscalationRuntime(options)
}

/** on_no_answer 三策略 → 分派动作的纯映射(词表沿用桥词表,不冒充用户拒绝)。 */
export function resolveNoAnswerAction(
  rule: Pick<HitlRule, 'onNoAnswer'>,
  _outcome: 'unavailable',
): NoAnswerAction {
  return NO_ANSWER_ACTIONS[rule.onNoAnswer]
}

/** 策略→动作全集(类型钉住:NoAnswerStrategy 三值与 NoAnswerAction 一一对应)。 */
export const NO_ANSWER_ACTIONS: Readonly<Record<NoAnswerStrategy, NoAnswerAction>> = {
  suspend: 'suspended',
  escalate: 'escalated',
  fail: 'failed',
}
