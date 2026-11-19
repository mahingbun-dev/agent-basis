/**
 * MasterAssessor——主会话的主动候选评估:候选卡投递、有界上下文读取与裁决转译
 * (35 号 A19;34 号 §2.5 assessor 行「MasterAssessor per-eval 状态与候选卡投递保留;
 * 28 号 §1.1 决策局部化不变」)。
 *
 * 设计依据:34 号 §2.5 assessor/candidate 两行;28 号 §1.1 表(决策局部化四行);
 * 27 号 §3.3-B(候选含已结束工单——Engine 已在 Candidate.tickets 计算,本类只投影);
 * 24 号 §5.3(横切断点:评估者不拥有领域状态,per-eval 状态随 release 释放)。
 * 语义自 SA src/app/assessment.ts 与 app/links.ts candidateCard 重写级校对移植,不变量原样:
 * - per-eval 状态隔离:每个 Eval 的读取缓存与线程上下文按 `evalId` 独立存放,
 *   `release(evalId)` 即弃(eval 结束/已决/超时后不留任何缓存;迟到的加载丢弃结果);
 * - 候选卡投递:'assessment' 持久 effect 送达主会话**一次**(幂等 requestId),
 *   `Engine.candidateDelivered` 自**被回合收走**起计时(仅入 inbox 排队不算送达;
 *   忙碌主会话的排队时间不消耗评估超时)——送达前 Eval 永不过期;送达的卡片是紧凑
 *   候选卡(related_tickets ≤8 open 优先 + tickets_total + next_action 指引),完整窗口
 *   由 orchestrator_eval 按需读取(决策局部化:卡片自包含裁决所需的有界事实);
 * - TextCache 机制:已读页按 UTF-16 码元总量有界的 LRU(SA cache.ts 移植),
 *   分页续读(offset > 0)只认缓存里 offset 0 的快照。
 *
 * ★本仓改造(依据见各端口注):
 * - 线程上下文经 `TriggerContext` 端口注入(A21 channels/Source 适配器接线;24 号 §8.2
 *   不采纳具体 Source 实现),未注入时该 Source「无线程上下文」——评估只用触发文本与批次;
 * - 候选卡投递经 `deliver` 端口(A22 Sessions 接线:promptHeld 到主会话,resolve = 已进入
 *   回合),未注入时不投递、不启动 deadline(「未送达的 Eval 永不过期」,engine.evaluateDue
 *   语义),候选仍可经 orchestrator_eval 读取、由调用方显式 decide;
 * - 仓库读取经 `readPath` 端口(A21 接线;SA readRepositoryPath 的 GitHub 实现不移植),
 *   未注入时 file/directory 读取显式报不可用。
 * 评估指令在主会话 prompt(prompts/admission.md,35 号 A23)——本载荷不带指令。
 */
import { z } from 'zod'
import { reasonText, threadKey, type AssessmentOutcome, type Candidate, type EngineForMainSession, type Trigger, type TriggerDisposition } from '../core/index.ts'
import type { Effects } from '../effects/effects.ts'
import { assessmentOutcome } from '../policy/assessment.ts'
import type { Settings } from '../policy/settings.ts'
import type { Store } from '../store/store.ts'
import { admissionContext, cut, preview, relatedTickets, textPage, TRIGGER_CHARS, WINDOW_CHARS, windowProjection } from './candidate.ts'

/** 线程上下文里的一条消息(SA kind.ts ContextMessage 面的端口化重写;`bot` 标注非人发送者)。 */
export interface ContextMessage { id: string; from: string; at: string; text: string; bot?: true; deleted?: true; reply_to?: string }
/** 线程上下文的一页:消息、续读游标、Source 自有的正文投影与可选回退模式说明。 */
export interface ThreadPage { messages: ContextMessage[]; next?: string | undefined; body?: Record<string, unknown>; status?: string }
/**
 * 某 Trigger 的有界线程上下文读取端口(assessor 的 Source 依赖;A21 接线位):
 * SA kind.ts TriggerContext 面去 Commands 化的重写——`read` 直接接 AbortSignal;
 * 图片读取的返回值交回宿主(附到主会话),缺省实现即「该 Source 无图片面」。
 */
export interface TriggerContext {
  /** 触发消息自身在其线程消息里的 id(threadWindow 的定位点)。 */
  readonly messageId: string
  /** 读一页线程消息(`thread`,首页省略 `cursor`)、话题根(`root`)或被回复消息(`parent`)。 */
  read(part: 'thread' | 'root' | 'parent', cursor: string | undefined, signal?: AbortSignal): Promise<ThreadPage>
  /** 从消息文本提取可读的图片 key;缺省(不支持图片的 Source)为 undefined。 */
  images?(text: string): string[]
  /** 读消息里的一张图片,返回值交宿主附到主会话;缺省实现不可用。 */
  image?(message: { id: string; text: string }, imageKey: string, signal?: AbortSignal): Promise<unknown>
}

/** 有界上下文/仓库读取的分页文本上限(SA assessment.ts read 的 4000 原值)。 */
const READ_PAGE_CHARS = 4000

/** 按 UTF-16 码元总量有界的 LRU 文本缓存,恒保留最近插入项(SA src/app/cache.ts TextCache 原样移植)。 */
export class TextCache {
  private readonly texts = new Map<string, string>()
  private size = 0
  constructor(limit: number) { this.limit = limit }
  /** 缓存总量上限(码元;构造注入)。 */
  private readonly limit: number
  /** 命中并触碰为最近使用。 */
  get(key: string): string | undefined {
    const text = this.texts.get(key)
    if (text !== undefined) { this.texts.delete(key); this.texts.set(key, text) }
    return text
  }
  /** 插入并按总量上限逐出最旧项(最近插入的恒保留)。 */
  set(key: string, text: string): void {
    this.size -= this.texts.get(key)?.length ?? 0
    this.texts.delete(key)
    this.texts.set(key, text)
    this.size += text.length
    for (const [oldest, value] of this.texts) {
      if (this.size <= this.limit || oldest === key) break
      this.texts.delete(oldest)
      this.size -= value.length
    }
  }
  /** 从最旧到最近使用的条目(SA 同名面;测试与探针用)。 */
  entries(): IterableIterator<[string, string]> { return this.texts.entries() }
}

/** MasterAssessor 的宿主依赖(全部端口注入,不 import 服务实例——24 号 §5.3 横切断点)。 */
export interface AssessorHost {
  /** 评估者读取与裁决的活动 Eval(EngineForMainSession 的候选半边)。 */
  readonly engine: Pick<EngineForMainSession, 'candidate' | 'candidateDelivered' | 'decide'>
  /** 持久 effect 队列:候选卡经 'assessment' effect 送达(崩溃可恢复,24 号 §5.3-4)。 */
  readonly effects: Pick<Effects, 'enqueue' | 'handle'>
  /** 当前设置(候选卡带 eval 受理档位;裁决按其转译)。 */
  settings(): Settings
  /** 处理是否暂停:暂停扣住候选卡投递('assessment' 并发限 0)。 */
  paused(): boolean
  /** 触发消息的线程上下文读取端口;undefined = 该 Source 不提供线程上下文(A21 接线位)。 */
  threadContext?(trigger: Trigger): TriggerContext | undefined
  /**
   * 候选卡到主会话的一次投递(A22 Sessions 接线位;按 `requestId` 幂等,resolve 即**已进入
   * 主会话回合**——仅入 inbox 的排队不算送达)。未注入:不投递、不启动 deadline(未送达的
   * Eval 永不过期),候选由调用方显式 decide。
   */
  deliver?(requestId: string, text: string): Promise<void>
  /** 有界仓库读取端口(A21 接线位;SA readRepositoryPath 的实现面),未注入时报不可用。 */
  readPath?(path: string, kind: 'file' | 'directory', signal?: AbortSignal): Promise<string>
  /** 一条 Trigger 的来源消息链接(A21 sources 接线;未注入时卡片不带链接)。 */
  sourceLink?(trigger: Trigger, signal?: AbortSignal): Promise<{ source_url?: string; source_url_read?: string }>
  /** `trigger` 在回复某条已存 Trigger 时,那条被回复的 Trigger;未知返回 undefined。 */
  repliedTo?(trigger: Trigger): Trigger | undefined
  /** 处置事实的只读面(候选卡的 delivered_to/handed_back;缺席则卡片不带这两个字段)。 */
  readonly store?: Pick<Store, 'triggers'>
}

/** 一次评估期间按 evalId 留存的状态:已服务读取的缓存、线程上下文(或其错误)与在跑的初载。 */
interface EvalReads { cache: ReadCache; context?: Awaited<ReturnType<typeof admissionContext>>; error?: string; loading?: Promise<void> }
/** 已服务读取的缓存:分页快照、消息全文与已认游标(SA ReadCache 同构;图片引用随消息缓存)。 */
interface ReadCache { snapshots: Map<string, string>; messages: Map<string, string>; cursors: Set<string> }

/** 某 Eval 已结束(已决、超时或重启)后仍来的读取所抛的错误文案(SA FINISHED 原文案)。 */
const FINISHED = 'This assessment has finished: it was decided, timed out or restarted'
/** 显式请求走路由不走评估的文案(SA EXPLICIT 原文案;orchestrator_route 的四动作)。 */
const EXPLICIT = 'This is an explicit request, which is routed instead of assessed: use orchestrator_route with its trigger_id and kind accept, attach, stop or ignore'
/** Source 不提供线程上下文时的文案(SA NO_CONTEXT 原文案)。 */
const NO_CONTEXT = 'This Source gives no Thread context; assess the Trigger\'s own text and the batch.'
/** 一次评估至多读取的线程页数(settings admissionContextMaxPages 的实现上限;SA 同名)。 */
const ADMISSION_MAX_PAGES = 100

/** 主会话候选评估的裁决 schema(`orchestrator_eval_decide`;SA AssessmentSchema 形态 + 本仓 R3/交接面):
 * direction、逐启用规则的 rule_assessments、intent_evidence、acknowledgement,与
 * ★R3 委派四要素(delegation,24 §5.5-R3)——校验在 `assessmentOutcome`(34 §2.2 assessment
 * 行),accept 缺任一要素 `UserError('delegationIncomplete')`(结构校验,不靠 prompt)。 */
export const AssessmentSchema = z.object({
  decision: z.enum(['accept', 'ignore', 'unavailable']).describe('裁决:accept 受理 / ignore 忽略 / unavailable 上下文不可得'),
  rule_assessments: z.array(z.object({ rule_id: z.string(), matched: z.boolean(), reason: z.string() }).strict())
    .describe('每一条启用规则恰一条'),
  direction: z.object({
    implementation_requested: z.boolean().describe('发送者是否请求了实现(而非只报告/讨论)'),
    target_basis: z.enum(['specified', 'existing-standard', 'undetermined']).describe('改动目标的依据:明示/既有客观标准/未定'),
    requires_design_decision: z.boolean().describe('是否仍需一个产品或设计决策'),
    evidence: z.string().max(700).describe('支撑判断的原话或事实'),
  }).strict().describe('每个裁决都必填'),
  title: z.string().min(1).max(160).describe('工单标题:简短描述原始请求(≤160 字符);不加要求或实现建议'),
  scope: z.string().max(1500).describe('工单范围:这件工作做到哪里为止(≤1500 字符)'),
  intent_evidence: z.string().trim().min(1).max(700).nullish().describe('accept 必填:确立三个事实的引文'),
  acknowledgement: z.string().nullish().describe('accept:以源语言写的一句话确认,由宿主作为对触发消息的回复发出'),
  worktree_name: z.string().nullish().describe('accept:工单请求的短名(1–4 个小写英文词,kebab-case,≤32 字符)'),
  /** ★R3(24 §5.5-R3;34 §2.1 evals 行):accept 必须携带的委派四要素,缺一即拒。 */
  delegation: z.object({
    objective: z.string().describe('目标:这件工作要达成什么'),
    outputFormat: z.string().describe('产出形态:结果以什么格式交付(文件/报告/补丁等)'),
    toolGuidance: z.string().describe('工具指引:允许与期望使用的工具、路径与做法'),
    taskBoundaries: z.string().describe('任务边界:做到哪里为止、不做什么'),
  }).strict().nullish().describe('accept 必填(仅 accept 读取);缺任一要素裁决被拒'),
  /** ★交接(35 号 A8;26 §6.2):本 accept 接手自哪张原工单(可选,仅 accept 读取)。 */
  handoff_of: z.string().nullish().describe('accept 可选:接手自的原工单 id(跨工单协调走交接)'),
  reason: z.string().min(1).max(500).describe('裁决理由(≤500 字符)'),
}).strict()
/** `AssessmentSchema` 的推断形态(MasterAssessor.decide 的入参)。 */
export type Assessment = z.infer<typeof AssessmentSchema>

/** 有界上下文读取请求 schema(`orchestrator_eval_read`;SA EvalReadSchema 形态,仓库读取经端口):
 * 每个引用都以其候选的 `trigger_id` 限定;image/file/directory 依赖注入的端口,未接线即显式报不可用。 */
export const EvalReadSchema = z.object({
  trigger_id: z.string().min(1).describe('候选卡给出的候选 ID;每个引用都限定在该候选上。'),
  resource: z.enum(['message', 'root', 'parent', 'thread', 'file', 'directory', 'image']).describe('读取的资源种类'),
  path: z.string().optional().describe('仅 file/directory:仓库相对路径。'),
  message_id: z.string().optional().describe('仅 message:省略即触发消息自身,或窗口/存根里一条消息的 id。'),
  cursor: z.string().optional().describe('仅 thread:首页省略,其后取窗口或 next_read 的 cursor;绝不是线程或消息 ID。'),
  image_id: z.string().optional().describe('仅 image:窗口或一次读取列出的 image id。'),
  offset: z.number().int().min(0).default(0).describe('文本分页:照抄 next_offset;其余参数保持不变。图片用 0。'),
}).strict().superRefine((read, ctx) => {
  if ((read.resource === 'file' || read.resource === 'directory') !== (read.path !== undefined)) ctx.addIssue({ code: 'custom', message: 'path is required only for file/directory. To read the source/root/parent, use resource=message/root/parent without a path.' })
  if (read.message_id !== undefined && read.resource !== 'message') ctx.addIssue({ code: 'custom', message: 'message_id is only for message; use returned image_id for images.' })
  if (read.cursor !== undefined && read.resource !== 'thread') ctx.addIssue({ code: 'custom', message: 'cursor is only for thread. First page: {resource:"thread"}.' })
  if ((read.resource === 'image') !== (read.image_id !== undefined)) ctx.addIssue({ code: 'custom', message: 'Images require image_id from a returned read reference. Read the thread or root first to discover their images.' })
})
/** `EvalReadSchema` 的推断形态(MasterAssessor.read 的入参)。 */
export type EvalRead = z.infer<typeof EvalReadSchema>

/**
 * 实现 Engine `Assessor` 端口的主会话评估者:每个 Eval 的候选卡经持久 'assessment' effect
 * 投递到主会话(送达才开始计时),评估期间按 `evalId` 隔离地服务有界上下文读取,并把主会话
 * 的评估转译成 `AssessmentOutcome` 交 `Engine.decide` 做策略校验。主会话的 orchestrator_eval*
 * 工具(A20)调用 `context`/`read`/`decide`。
 */
export class MasterAssessor {
  /** 各 Eval 的读取状态,按 `evalId` 隔离;`release` 即弃(24 号 §5.3:评估者不拥有领域状态)。 */
  private readonly evals = new Map<string, EvalReads>()
  /** 本评估者的生命周期信号:关停时中断在跑的线程上下文/仓库读取。 */
  private readonly controller = new AbortController()
  private readonly host: AssessorHost
  constructor(host: AssessorHost) {
    this.host = host
    // 候选卡被回合收走才开始该 Eval 的 deadline(SA:busy 的主会话不消耗评估时间);
    // 处理暂停期间扣住投递(并发限 0)。投递按 `candidate:<evalId>` 幂等(送达一次)。
    host.effects.handle('assessment', async ({ triggerId }, evalId) => {
      const candidate = this.host.engine.candidate(triggerId)
      if (candidate?.evalId !== evalId) return
      if (!this.host.deliver) return // A22 接线位:未注入投递面时不投递、不启动 deadline(未送达永不过期)
      await this.host.deliver(`candidate:${evalId}`, JSON.stringify({ kind: 'candidate', ...await this.candidateCard(candidate) }))
      this.host.engine.candidateDelivered(evalId)
    }, { limit: () => this.host.paused() ? 0 : 4 })
  }
  /** 把 `candidate` 的候选卡投递排队('assessment' effect;按 evalId 幂等,UPSERT 合并)。 */
  request(candidate: Candidate): void {
    // SA 不变量:候选至少持有其主触发;非空断言与 SA 原样
    // oxlint-disable-next-line typescript/no-non-null-assertion
    this.host.effects.enqueue('assessment', candidate.evalId, { triggerId: candidate.triggers[0]!.id })
  }
  /** `evalId` 是否仍是 `trigger` 的活动评估。 */
  private live(evalId: string, trigger: Trigger): boolean { return this.host.engine.candidate(trigger.id)?.evalId === evalId }
  /** 某 Eval 结束(已决/超时/重启)即弃其全部状态;在跑的加载以其自校验丢弃结果。 */
  release(evalId: string): void { this.evals.delete(evalId) }
  /** 仍留存的 Eval 读取状态数(探针面:per-eval 隔离与 release 清理的断言面)。 */
  keptEvals(): number { return this.evals.size }
  /** 解析某触发当前的活动评估;历史触发没有,显式请求走路由不走评估。 */
  private evalFor(triggerId: string): { candidate: Candidate; trigger: Trigger } {
    const candidate = this.host.engine.candidate(triggerId)
    if (!candidate) throw new Error('No assessment is in progress for this trigger; it was already decided, timed out, or never reached assessment')
    if (candidate.strength === 'explicit') throw new Error(EXPLICIT)
    const trigger = candidate.triggers.find(item => item.id === triggerId)
    if (!trigger) throw new Error('No assessment is in progress for this trigger; it was already decided, timed out, or never reached assessment')
    return { candidate, trigger }
  }
  /** 取或初始化 `evalId` 的读取状态(以触发消息自身播种);该 Eval 已结束即抛 FINISHED。 */
  private reads(evalId: string, trigger: Trigger): EvalReads {
    let reads = this.evals.get(evalId)
    if (!reads) {
      // 评估结束后拒绝读取:已完成的评估不留缓存状态(SA reads 原语义)。
      if (!this.live(evalId, trigger)) throw new Error(FINISHED)
      const context = this.host.threadContext?.(trigger)
      const messages = new Map([[context?.messageId ?? '', trigger.text]])
      reads = { cache: { snapshots: new Map(), messages, cursors: new Set() } }
      this.evals.set(evalId, reads)
    }
    return reads
  }
  /** 每个 Eval 至多一次的初载:读线程窗口并缓存(SA seed 语义;并发完成或替换以 loading 自校验丢弃)。 */
  private async seed(evalId: string, trigger: Trigger, caller?: AbortSignal): Promise<void> {
    caller?.throwIfAborted()
    const reads = this.reads(evalId, trigger)
    if (reads.context || reads.error !== undefined) return
    const thread = this.host.threadContext?.(trigger)
    if (!thread) { reads.error = NO_CONTEXT; return }
    let loading = reads.loading
    if (!loading) {
      // 在跑的初载完成后,若该 Eval 的状态已被替换/释放则丢弃结果(SA current 守卫同构)。
      const current = (): boolean => this.evals.get(evalId)?.loading === loading
      loading = Promise.resolve().then(async () => {
        try {
          const signal = AbortSignal.any([this.controller.signal, ...(caller ? [caller] : [])])
          const loaded = await admissionContext(thread, ADMISSION_MAX_PAGES, signal)
          if (!current()) return
          reads.context = loaded
          // 分页可从初载窗口末尾继续。
          if (loaded.next) reads.cache.cursors.add(loaded.next)
          for (const message of loaded.messages) if (!message.deleted) reads.cache.messages.set(message.id, message.text)
        } catch (error) {
          caller?.throwIfAborted()
          if (current()) reads.error = `Thread context unavailable: ${String(error).slice(0, 300)}. Use orchestrator_eval_read before deciding based on missing context.`
        }
      }).finally(() => { if (current()) delete reads.loading })
      reads.loading = loading
    }
    await loading
    caller?.throwIfAborted()
    if (!this.live(evalId, trigger)) throw new Error(FINISHED)
  }
  /** 触发点的线程投影(窗口在初载完成后就绪;未就绪时给显式指引,不静默空窗)。 */
  private threadSection(trigger: Trigger, source: TriggerContext | undefined) {
    const reads = this.evals.get(this.evalIdOf(trigger))
    return reads?.context ? windowProjection(reads.context, source?.messageId ?? trigger.id)
      : { error: reads?.error ?? 'Call orchestrator_eval to load initial context', complete: false }
  }
  private evalIdOf(trigger: Trigger): string {
    return this.host.engine.candidate(trigger.id)?.evalId ?? ''
  }
  /**
   * 送达主会话的紧凑候选卡(SA links.ts candidateCard 重写级移植):主触发按 worker 输入的
   * 形态(含其被回复消息的预览)、强度与受理档位、批次同伴、被交回记录、**相关工单
   * (≤8 open 优先 + tickets_total,Engine 计算)**、到达面,与下一步指引。
   */
  private async candidateCard(candidate: Candidate) {
    // SA 不变量:candidateCard 只对在跑 Eval 的候选调用,主触发恒在;非空断言与 SA 原样
    // oxlint-disable-next-line typescript/no-non-null-assertion
    const primary = candidate.triggers.at(-1)!
    const settings = this.host.settings()
    const disposition = this.hostDispositions(candidate)
    const others = candidate.triggers.filter(trigger => trigger.id !== primary.id)
    const link = await (this.host.sourceLink?.(primary) ?? {})
    const parent = this.host.repliedTo?.(primary)
    return {
      trigger_id: primary.id, from: primary.actor.id, at: primary.at,
      thread: threadKey(primary.threads[0] ?? { source: primary.source, id: '' }), ...link,
      ...cut(primary.text, TRIGGER_CHARS), strength: candidate.strength, mode: settings.eval.mode,
      ...others.length ? { batch: others.map(item => ({ trigger_id: item.id, from: item.actor.id, at: item.at,
        preview: preview(item.text), chars: item.text.length, read: `trigger/${item.id}` })) } : {},
      ...disposition.handedBack.length ? { handed_back: disposition.handedBack } : {},
      // 线程上的全部工单(含已结束,open 优先 ≤8)+ 全数——Engine 计算,不靠模型记忆(27 号 §3.3-B)。
      ...relatedTickets(candidate.tickets),
      ...(disposition.delivered.length ? { delivered_to: disposition.delivered } : {}),
      ...(parent && !candidate.triggers.some(item => item.id === parent.id)
        ? { replies_to: { trigger_id: parent.id, preview: preview(parent.text) } } : {}),
      next_action: candidate.strength === 'explicit'
        ? 'Route it with orchestrator_route as dispatch says: accept, attach, stop or ignore.'
        : 'Ignore it with orchestrator_route if the card shows it touches no enabled rule; else assess it with orchestrator_eval, orchestrator_eval_read, then orchestrator_eval_decide.',
    }
  }
  /** 各批内 Trigger 的处置事实:到达面(fanout)与被 worker 交回的记录。 */
  private hostDispositions(candidate: Candidate): {
    delivered: string[]
    handedBack: { trigger_id: string; ticket_id: string; reason: string }[]
  } {
    const store = this.host.store
    if (!store) return { delivered: [], handedBack: [] }
    const delivered: string[] = []
    const handedBack: { trigger_id: string; ticket_id: string; reason: string }[] = []
    for (const trigger of candidate.triggers) {
      const record: TriggerDisposition | undefined = store.triggers.disposition(trigger.id)
      if (record?.fanout.length && !delivered.length) delivered.push(...record.fanout)
      for (const item of record?.handbacks ?? []) handedBack.push({ trigger_id: trigger.id, ticket_id: item.ticketId, reason: item.reason })
    }
    return { delivered, handedBack }
  }
  /**
   * `orchestrator_eval` 的载荷:触发文本一次(≤4000 字符)、批次同伴、线程上的相关工单
   * (≤8 open 优先 + tickets_total)、其 Eval 构建时的规则版本(policy_version),与初载线程
   * 窗口(前 5 条 + 前后各 5 条;近邻 1200、窗口 400、其余 50 字符存根,总长与截断计数随行;
   * orchestrator_eval_read 按 id 读任一条全文)。评估指令在主会话 prompt(admission.md),不在本载荷。
   */
  async context(triggerId: string, signal?: AbortSignal) {
    const { candidate, trigger } = this.evalFor(triggerId)
    await this.seed(candidate.evalId, trigger, signal)
    const source = this.host.threadContext?.(trigger)
    const settings = this.host.settings()
    const others = candidate.triggers.filter(item => item.id !== trigger.id)
    return {
      trigger_id: trigger.id, strength: candidate.strength, mode: settings.eval.mode,
      source: { kind: trigger.source, actor: trigger.actor.id, thread: threadKey(trigger.threads[0] ?? { source: trigger.source, id: '' }),
        ...(trigger.url ? { url: trigger.url } : {}) },
      ...cut(trigger.text, TRIGGER_CHARS),
      ...(source?.images !== undefined && source.images(trigger.text).length > 0
        ? { images: source.images(trigger.text).map(key => `${source.messageId}/${key}`) } : {}),
      ...others.length ? { batch: others.map((item) => {
        const text = cut(item.text, WINDOW_CHARS)
        return { trigger_id: item.id, actor: item.actor.id, at: item.at, ...text, ...'chars' in text ? { read: `trigger/${item.id}` } : {} }
      }) } : {},
      // 线程上全部工单(含已结束;open 优先 ≤8 + tickets_total)与其 Eval 的规则版本——Engine 计算。
      ...relatedTickets(candidate.tickets), policy_version: candidate.policyVersion,
      thread: this.threadSection(trigger, source),
    }
  }
  /**
   * 服务评估期间的有界分页读取(`orchestrator_eval_read`):缓存里的一条消息全文、线程续页
   * (root/parent/thread 经 TriggerContext 端口)、仓库路径(file/directory 经 readPath 端口)
   * 或一张图片(image 经端口,返回值交宿主附到主会话)。
   */
  async read(read: EvalRead, signal?: AbortSignal): Promise<unknown> {
    const { candidate, trigger } = this.evalFor(read.trigger_id)
    await this.seed(candidate.evalId, trigger, signal)
    const { cache } = this.reads(candidate.evalId, trigger)
    const { snapshots, messages, cursors } = cache
    const source = this.host.threadContext?.(trigger)
    if (read.resource === 'image') {
      if (read.offset !== 0) throw new Error('Images are not paginated; use offset 0')
      const reference = read.image_id ?? ''
      const at = reference.indexOf('/')
      const messageId = reference.slice(0, at)
      const messageText = messageId === '' ? undefined : messages.get(messageId)
      const key = reference.slice(at + 1)
      if (!source?.image || messageText === undefined || !key) throw new Error('Unknown image reference. Read the source/root/thread for this trigger first and copy its image read arguments.')
      return source.image({ id: messageId, text: messageText }, key, signal)
    }
    const cacheKey = JSON.stringify([read.resource, read.path, read.cursor, read.message_id])
    if (read.offset > 0) {
      const cached = snapshots.get(cacheKey)
      if (cached === undefined) throw new Error('Read this resource at offset 0 first')
      return textPage(read.resource, cached, read.offset, READ_PAGE_CHARS)
    }
    let body: string
    if (read.resource === 'message') {
      const message = messages.get(read.message_id ?? source?.messageId ?? '')
      if (message === undefined) throw new Error('Unknown message reference. Use resource=root/parent or read the thread first; copy a returned message read call.')
      body = message
    } else if (read.resource === 'thread' || read.resource === 'root' || read.resource === 'parent') {
      if (!source) throw new Error(NO_CONTEXT)
      if (read.cursor !== undefined && !cursors.has(read.cursor)) throw new Error('Unknown thread cursor. First call {resource:"thread"}; then copy the returned next_read exactly.')
      const result = await source.read(read.resource, read.cursor, signal)
      for (const message of result.messages) if (!message.deleted) messages.set(message.id, message.text)
      if (result.next) cursors.add(result.next)
      const next = result.next ? { trigger_id: trigger.id, resource: 'thread', cursor: result.next } : null
      body = JSON.stringify({ next_read: next, ...result.body, messages: result.messages })
    } else {
      if (!this.host.readPath) throw new Error('Repository reads are not wired in this deployment; assess the thread context and the trigger text')
      body = await this.host.readPath(read.path ?? '', read.resource === 'directory' ? 'directory' : 'file', signal)
    }
    snapshots.set(cacheKey, body)
    return textPage(read.resource, body, read.offset, READ_PAGE_CHARS)
  }
  /**
   * 把主会话的评估按当前设置转译为 `AssessmentOutcome` 交 `Engine.decide` 做策略校验
   * (R3 四要素经 assessmentOutcome 校验,34 §2.2 assessment 行;Engine 侧另有同码兜底)。
   * 返回裁决形态与理由文本,供工具面回包。
   */
  decide(triggerId: string, result: Assessment, signal?: AbortSignal): Promise<{ state: string; ticket_id?: string; reason: string }> {
    // 同步实现的抛错(UserError 等)也落为 rejected promise(SA async 接缝:工具面恒以 Promise 应答)。
    try {
      return Promise.resolve(this.decideSync(triggerId, result, signal))
    } catch (error) { return Promise.reject(error instanceof Error ? error : new Error(String(error))) }
  }
  /** decide 的同步体(见上;evalFor 的抛错在 decide 接缝处转为 rejected promise)。 */
  private decideSync(triggerId: string, result: Assessment, signal?: AbortSignal): { state: string; ticket_id?: string; reason: string } {
    const { candidate } = this.evalFor(triggerId)
    signal?.throwIfAborted()
    const outcome: AssessmentOutcome = assessmentOutcome({
      decision: result.decision,
      rule_assessments: result.rule_assessments.map(item => ({ ...item })),
      direction: result.direction,
      title: result.title,
      scope: result.scope,
      reason: result.reason,
      ...(result.intent_evidence != null ? { intent_evidence: result.intent_evidence } : {}),
      ...(result.acknowledgement != null ? { acknowledgement: result.acknowledgement } : {}),
      ...(result.worktree_name != null ? { worktree_name: result.worktree_name } : {}),
      ...(result.delegation != null ? { delegation: result.delegation } : {}),
      ...(result.handoff_of != null ? { handoffOf: result.handoff_of } : {}),
    }, this.host.settings(), candidate.strength)
    const decision = this.host.engine.decide(triggerId, { ...outcome, evalId: candidate.evalId })
    return { state: decision.kind, ...(decision.ticketId ? { ticket_id: decision.ticketId } : {}), reason: reasonText(decision.reason) }
  }
  /** 关停:中断在跑的线程上下文/仓库读取(SA stop 原语义)。 */
  stop(): void { this.controller.abort() }
}
