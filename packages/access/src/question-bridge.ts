/**
 * 提问桥(2026-11-17):`ask_user_question` 在 web 前端结构性不可达——
 * session-c9a74388 实测:模型提问后 42 分钟零产物,前端全程无卡片,手动停止才解
 * (tool/result = ASK_ABORTED)。
 *
 * 根因链(全部 file:line 实核,dsh 0.2.2-rc.1):
 * 1. 内核 `userQuestions.ask()` 走 `ctx.waterfall(scopeTarget(agent), 'user-questions/request')`
 *    (dsh-user-questions lib/index.js:709-714),由前端答者接住;
 * 2. 网关 forward 只投递 `answers===true` 的 peer,`answers = principal.kind === 'owner'`
 *    (dsh-api-gateway lib/index.js:1042/1136);eterna mux 租户隔离把浏览器 peer 换血
 *    成 `{kind:'eterna-user'}`(mux.ts:303)→ 转发事件永不到浏览器;
 * 3. 应答回路同样锁 owner 面:`$events/result` 拒非 owner(:995)、`userQuestions/answer`
 *    的 unary decide 亦无 eterna 策略授权(mux.ts 五张清单无 userQuestions/*)→ 就算
 *    收到也答不了;
 * 4. 客户端投影兜底(`publishContinuedQuestions`)只对 `continued` 态建卡,全新 open
 *    问题唯一建卡入口是第 2 条死路。
 *
 * 本模块在宿主侧接住 `user-questions/request` waterfall(与 approval-bridge 同款
 * 答者 seam),把待答问题按会话归属暴露给本人浏览器(轮询 + 提交答案),答案批形状
 * 对齐 api-remotes schema:`{ answers: [{ id, selected: string[], custom?: string }] }`
 * (dsh-api-remotes client.js:962-966 实证)。
 *
 * 语义:
 * - 本人提交答案 → resolve 答案批,内核 tool-ask-user 收到后照常喂回 agent loop;
 * - 超时未答(ETERNA_USER_QUESTION_TIMEOUT_MS,缺省 300s)→ 以 'timed-out' 收场:
 *   抛 ASK_TIMED_OUT 语义错误;timed 部署下上游 TimedQuestionWait 先到点(本桥
 *   定时器加 10s 宽限只做泄漏兜底),其 reason 即 ASK_TIMED_OUT,本桥按 reason
 *   还原同类错误 → askTimed 命中 pending 分支(模型可继续独立工作),不冒充
 *   「用户跳过」;legacy 部署下本桥定时器是唯一上限,工具层报错但不挂死;
 * - turn 中止(signal abort,reason 非 ASK_TIMED_OUT)→ 抛 ASK_ABORTED 语义错误,
 *   与内核 decide 的 abort 竞速语义一致;
 * - 未知会话(系统任务等)next() 透传,维持上游行为。
 *
 * 多租户:登记按 sessionOwner 归账,列表/裁决都校验归属人,跨用户不可见不可答。
 */
import { randomUUID } from 'node:crypto'
import type { AccessAuditEvent } from './audit.ts'

/** 答案项(api-remotes schema 同构:selected 必填数组,custom 可选)。 */
export interface QuestionAnswerItem {
  readonly id: string
  readonly selected: readonly string[]
  readonly custom?: string
}

/** 待答问题里对浏览器可见的单个问题(上游 AskUserQuestionItem 子集)。 */
export interface PendingQuestionItem {
  readonly id: string
  readonly question: string
  readonly header?: string
  readonly options?: readonly { readonly label: string; readonly description?: string }[]
  readonly multiSelect?: boolean
}

/** 待答提问的浏览器视图(轮询端点返回体条目)。 */
export interface UserQuestionView {
  readonly id: string
  readonly sessionId: string
  readonly callId: string | null
  readonly questions: readonly PendingQuestionItem[]
  readonly requestedAt: number
  readonly expiresAt: number
}

export interface QuestionBridgeDeps {
  /** dsh 会话 id → 归属用户 id;未知会话返回 undefined。 */
  readonly sessionOwner: (sessionId: string) => number | undefined
  audit(event: AccessAuditEvent): void
  /** 超时未答毫秒数;到点以 pending 语义收场(见头注)。 */
  readonly timeoutMs: number
}

/** 超时/中止的收场原因(桥内部;对外表现为抛错,tool 层映射 pending/aborted)。 */
export type QuestionSettleReason = 'timed-out' | 'aborted'

/**
 * 超时收场错误:刻意模仿上游 ASK_TIMED_OUT 的 code,使 tool-ask-user 的
 * `error.code === 'ASK_TIMED_OUT'` 分支在 legacy 模式也能命中(它有专门的
 * `pending: true` 返回分支,见 dsh-tool-ask-user lib:669-674 附近)。
 */
export class QuestionTimedOutError extends Error {
  readonly code = 'ASK_TIMED_OUT'
  constructor() {
    super('ask_user_question timed out before the user answered')
    this.name = 'UserQuestionError'
  }
}

/** 中止收场错误(对齐上游 ASK_ABORTED 形态)。 */
export class QuestionAbortedError extends Error {
  readonly code = 'ASK_ABORTED'
  constructor() {
    super('ask_user_question was aborted before the user answered')
    this.name = 'UserQuestionError'
  }
}

/** 内核 request 的字段子集(结构面:只读需要的那几个)。 */
interface QuestionRequestLike {
  readonly questions?: unknown
  readonly wait?: { readonly callId?: unknown; readonly timed?: unknown }
  readonly signal?: {
    readonly aborted?: boolean
    readonly reason?: unknown
    addEventListener?: (type: string, listener: () => void, opts?: { once?: boolean }) => void
    removeEventListener?: (type: string, listener: () => void) => void
  }
  readonly agent?: { readonly session?: { readonly id?: unknown } }
}

interface PendingEntry {
  readonly id: string
  readonly ownerId: number
  readonly view: UserQuestionView
  settle(answers: readonly QuestionAnswerItem[]): void
  fail(reason: QuestionSettleReason): void
}

const optString = (value: unknown): string | null => (typeof value === 'string' && value !== '' ? value : null)

/** abort reason 的 code(结构化读;非对象/无 code 回 null)。 */
function codeOf(reason: unknown): string | null {
  if (reason === null || typeof reason !== 'object') return null
  const code = (reason as { code?: unknown }).code
  return typeof code === 'string' ? code : null
}

function sessionOf(request: QuestionRequestLike): string | null {
  const id = request.agent?.session?.id
  return typeof id === 'string' && id !== '' ? id : null
}

/** 逐项清洗问题载荷(不可信输入;坏条目丢弃而非整卡失败——丢一个问题比整轮假死好)。 */
export function sanitizeQuestions(raw: unknown): PendingQuestionItem[] {
  if (!Array.isArray(raw)) return []
  const out: PendingQuestionItem[] = []
  for (const item of raw) {
    if (item === null || typeof item !== 'object') continue
    const record = item as Record<string, unknown>
    const id = optString(record.id)
    const question = optString(record.question)
    if (id === null || question === null) continue
    const header = optString(record.header)
    const options: { label: string; description?: string }[] = []
    if (Array.isArray(record.options)) {
      for (const option of record.options) {
        if (option === null || typeof option !== 'object') continue
        const opt = option as Record<string, unknown>
        const label = optString(opt.label)
        if (label === null) continue
        const description = optString(opt.description)
        options.push(description === null ? { label } : { label, description })
      }
    }
    out.push({
      id,
      question,
      ...(header === null ? {} : { header }),
      ...(options.length === 0 ? {} : { options }),
      ...(record.multiSelect === true ? { multiSelect: true } : {}),
    })
  }
  return out
}

/** 校验提交的答案批:每题恰好一次、选项在列(或自定义文本非空)。返回错误文案或 undefined。 */
export function validateAnswers(
  questions: readonly PendingQuestionItem[],
  answers: unknown,
): { readonly ok: true; readonly answers: QuestionAnswerItem[] } | { readonly ok: false; readonly reason: string } {
  if (!Array.isArray(answers)) return { ok: false, reason: '答案必须是数组' }
  const byId = new Map<string, QuestionAnswerItem>()
  for (const item of answers) {
    if (item === null || typeof item !== 'object') return { ok: false, reason: '答案项必须是对象' }
    const record = item as Record<string, unknown>
    const id = optString(record.id)
    if (id === null) return { ok: false, reason: '答案项缺少 id' }
    const selectedRaw = record.selected
    const selected = Array.isArray(selectedRaw) ? selectedRaw.filter((v): v is string => typeof v === 'string') : []
    // 空白自定义串按未填处理(前端已 trim,此处防旁路客户端靠空白蒙混上「已作答」)
    const customRaw = typeof record.custom === 'string' ? record.custom.trim() : ''
    const custom = customRaw === '' ? undefined : customRaw
    const question = questions.find(q => q.id === id)
    if (question === undefined) return { ok: false, reason: `未知问题 id:${id}` }
    if (byId.has(id)) return { ok: false, reason: `问题 ${id} 重复作答` }
    if (selected.length === 0 && custom === undefined) {
      return { ok: false, reason: `问题 ${id} 未选择也未填写(整卡跳过请用「跳过本轮」)` }
    }
    if (question.options !== undefined && question.options.length > 0) {
      const allowed = new Set(question.options.map(option => option.label))
      const bad = selected.find(label => !allowed.has(label))
      if (bad !== undefined) return { ok: false, reason: `问题 ${id} 的选项不存在:${bad}` }
      if (question.multiSelect !== true && selected.length > 1) {
        return { ok: false, reason: `问题 ${id} 是单选` }
      }
    }
    byId.set(id, { id, selected, ...(custom === undefined ? {} : { custom }) })
  }
  const missing = questions.filter(q => !byId.has(q.id)).map(q => q.id)
  if (missing.length > 0) return { ok: false, reason: `还有问题未作答:${missing.join('、')}` }
  return { ok: true, answers: [...byId.values()] }
}

/** 提问桥:登记 + 答者 + 裁决面(routes.ts 薄包装消费)。 */
export class QuestionBridge {
  readonly #pending = new Map<string, PendingEntry>()
  readonly #deps: QuestionBridgeDeps

  constructor(deps: QuestionBridgeDeps) {
    this.#deps = deps
  }

  /**
   * 注册 `user-questions/request` 答者(与 approval-bridge 同款 waterfall seam:
   * cordis `ctx.on(事件, (request, next) => …)`)。已知归属才接手;其余 next() 透传
   * (无人应答时内核以 NO_PROVIDER 兜底)。返回 disposer。
   */
  installAnswerer(register: (listener: (request: unknown, next: () => unknown) => unknown) => () => void): () => void {
    return register((request, next) => {
      if (request === null || typeof request !== 'object') return next()
      const req = request as QuestionRequestLike
      const sessionId = sessionOf(req)
      if (sessionId === null) return next()
      const ownerId = this.#deps.sessionOwner(sessionId)
      if (ownerId === undefined) return next()
      const questions = sanitizeQuestions(req.questions)
      if (questions.length === 0) return next()
      return this.#waitForAnswer(req, ownerId, sessionId, questions)
    })
  }

  /** 本人视角的待答列表(过期条目过滤;作答后即消失)。 */
  listFor(ownerId: number): UserQuestionView[] {
    const now = Date.now()
    return [...this.#pending.values()]
      .filter(entry => entry.ownerId === ownerId && entry.view.expiresAt > now)
      .map(entry => entry.view)
      .sort((a, b) => a.requestedAt - b.requestedAt)
  }

  /** 当前归属人待答数(轻量面预留)。 */
  pendingCount(ownerId: number): number {
    return this.listFor(ownerId).length
  }

  /**
   * 本人提交答案。返回 false = 条目不存在/已收场/非归属人(跨用户一律拒绝)。
   * 返回 {ok:false,reason} = 答案批不合法(题目未答全、选项不存在等)。
   *
   * skip=true = 整卡跳过:按上游语义回落成每题 `selected: []` 且无 custom 的答案批
   * (dsh-tool-ask-user 描述:「An answer item with empty selected and no custom means
   * the user skipped that question: continue without it」)——模型照常继续,不把
   * 「跳过」冒充成「同意」。
   */
  answer(
    id: string,
    userId: number,
    body: { readonly answers?: unknown; readonly skip?: boolean },
  ): { readonly ok: true } | { readonly ok: false; readonly reason: string; readonly status: 404 | 400 } {
    const entry = this.#pending.get(id)
    if (entry === undefined || entry.ownerId !== userId) return { ok: false, reason: '提问不存在、已结束或不属于你', status: 404 }
    let answers: readonly QuestionAnswerItem[]
    if (body.skip === true) {
      answers = entry.view.questions.map(question => ({ id: question.id, selected: [] }))
    } else {
      const validated = validateAnswers(entry.view.questions, body.answers)
      if (!validated.ok) return { ok: false, reason: validated.reason, status: 400 }
      answers = validated.answers
    }
    this.#settle(entry, answers)
    this.#deps.audit({
      kind: 'access.question.answered',
      detail: {
        id,
        sessionId: entry.view.sessionId,
        callId: entry.view.callId,
        questionCount: entry.view.questions.length,
        skipped: body.skip === true,
      },
    })
    return { ok: true }
  }

  #waitForAnswer(
    request: QuestionRequestLike,
    ownerId: number,
    sessionId: string,
    questions: readonly PendingQuestionItem[],
  ): Promise<{ answers: QuestionAnswerItem[] }> {
    const id = randomUUID()
    const now = Date.now()
    const view: UserQuestionView = {
      id,
      sessionId,
      callId: optString(request.wait?.callId),
      questions,
      requestedAt: now,
      expiresAt: now + this.#deps.timeoutMs,
    }
    return new Promise<{ answers: QuestionAnswerItem[] }>((resolve, reject) => {
      let settled = false
      const timerHolder: { timer?: ReturnType<typeof setTimeout> } = {}
      const signal = typeof request.signal?.addEventListener === 'function' ? request.signal : undefined
      const cleanup = (): void => {
        if (timerHolder.timer !== undefined) clearTimeout(timerHolder.timer)
        signal?.removeEventListener?.('abort', onAbort)
        this.#pending.delete(id)
      }
      const onAbort = (): void => {
        if (settled) return
        // timed 模式的上游定时器以 ASK_TIMED_OUT 为 abort reason(dsh-user-questions
        // TimedQuestionWait:new UserQuestionError(..., 'ASK_TIMED_OUT'));按 reason
        // 分流审计标签,并把「上游超时」原样还原成 ASK_TIMED_OUT 抛回,让 askTimed
        // 的 pending 分支命中(tool 层回落 pending,而非工具报错)。
        const timedOut = codeOf(signal?.reason) === 'ASK_TIMED_OUT'
        settled = true
        cleanup()
        this.#deps.audit({ kind: timedOut ? 'access.question.timed-out' : 'access.question.aborted', detail: { id, sessionId, callId: view.callId } })
        reject(timedOut ? new QuestionTimedOutError() : new QuestionAbortedError())
      }
      const entry: PendingEntry = {
        id,
        ownerId,
        view,
        settle: (answers) => {
          if (settled) return
          settled = true
          cleanup()
          resolve({ answers: [...answers] })
        },
        fail: (reason) => {
          if (settled) return
          settled = true
          cleanup()
          this.#deps.audit({ kind: `access.question.${reason}`, detail: { id, sessionId, callId: view.callId, waitedMs: this.#deps.timeoutMs } })
          reject(reason === 'timed-out' ? new QuestionTimedOutError() : new QuestionAbortedError())
        },
      }
      // timed 模式由上游 TimedQuestionWait 治理时限(到点以 ASK_TIMED_OUT 收场并
      // 回落 pending);本桥定时器只做泄漏兜底,故加宽限期永不胜出——若本桥抢先
      // 以 ASK_TIMED_OUT 抛错,askTimed 会走「工具报错」而非 pending 分支
      // (它的 instanceof 判定只认同模块类,结构同构靠不住)。
      const settleDelayMs = request.wait?.timed === true ? this.#deps.timeoutMs + 10_000 : this.#deps.timeoutMs
      timerHolder.timer = setTimeout(() => { entry.fail('timed-out') }, settleDelayMs)
      signal?.addEventListener?.('abort', onAbort, { once: true })
      if (signal?.aborted === true) {
        onAbort()
        return
      }
      this.#pending.set(id, entry)
      this.#deps.audit({
        kind: 'access.question.surfaced',
        detail: { id, sessionId, callId: view.callId, ownerId, questionCount: questions.length, timeoutMs: this.#deps.timeoutMs },
      })
    })
  }

  #settle(entry: PendingEntry, answers: readonly QuestionAnswerItem[]): void {
    entry.settle(answers)
  }
}

/** 超时读取:ETERNA_USER_QUESTION_TIMEOUT_MS(毫秒,正整数),非法/缺省回 300s。 */
export function userQuestionTimeoutMs(env: NodeJS.ProcessEnv): number {
  const raw = Number.parseInt(env['ETERNA_USER_QUESTION_TIMEOUT_MS'] ?? '', 10)
  return Number.isInteger(raw) && raw > 0 ? raw : 300_000
}
