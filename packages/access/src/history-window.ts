/**
 * 历史分页窗口钳制(2026-11-24):把上游会话历史流的「每次请求消息预算」压到
 * 产品口径——首屏只取最近 N 条,更早的消息交给「加载更早」按页续取。
 *
 * ## 背景(生产实测,非推测)
 *
 * 上游客户端把页大小写死在 bundle 内:源码
 * `packages/api/session-controller/src/client/sessions/session.ts:54`
 * `HISTORY_PAGE_OPTIONS = { maxMessages: 500, turnWindow: { minMessages: 50, minTurns: 2 } }`,
 * 首发 `follow` 开窗与 `page` 补页都按它请求;服务端 `paginate`
 * (lib/history.ts:132)以「消息条数」为预算,而单个 Turn 内的
 * tool/result、job/* 与长 assistant 正文也各占一条记录——会话越"干活型",
 * 每单位消息携带的字节越多。
 *
 * 后果:首屏要等累计到 2 个 turn 或 500 条消息才收口,长会话一次即取回近乎整份
 * 日志。扫描生产会话树 218 份 zstd 日志实测:
 * - 最坏会话 3,677 条事件 / 14.2 MB JSON 一次过线(首屏 13.69 MB,其中
 *   assistant/message 占 9.1 MB);
 * - 8 份日志首屏 >2 MB,3 份 >5 MB;
 * - 同一会话按 30 条消息分页:首屏 0.48 MB,续页 0.02–2.57 MB(中位 ≈0.8 MB)。
 *
 * 前端因此长期停在「载入历史…」(`ChatView` 仅在 openState==='open' 后渲染正文),
 * 传输与浏览器内存同时受压。而上游 UI 本就带「加载更早」按钮
 * (ChatView.tsx:239)与 `hasMore` 游标——缺的只是**首屏窗口过大使该按钮永不出现**。
 *
 * 续页仍有 2 MB 级页属上游既定语义、本层不动:`paginate` 会把消息按
 * `sourceEventSeqs` 展开到整组起点(history.ts:154-160),压缩检查点等复用事件的
 * 来源组可跨数百条记录;拆开会让一条消息失去其来源上下文。本层只保证**首屏**快捷,
 * 续页由用户按需点「加载更早」触发,慢一些不阻塞首次进入。
 *
 * ## 修法
 *
 * 在 Host 侧这一族入口的入参上做兜底收敛(沿 login-gate.ts / mux.ts 的运行时
 * 包装先例,不碰上游源码与 node_modules):
 * - `follow`(首屏开窗)、`events`/`page` 的**普通补页**统一收到 `PAGE_MESSAGES`;
 * - 只降不升:调用方传了更小的预算就按它的(未来客户端改小无需改本层);
 * - `turnWindow` 是「至少多少条消息 / 多少轮」的下限规则,与上限冲突会被上游
 *   `validateHistoryWindow` 判 `gateway/bad-request`(lib/history.ts:33-48),故
 *   收窄时同步收敛;`minMessages` 超出新预算即整体丢弃(退化为纯消息数分页)。
 *
 * **轮次跳转(loadThrough)例外**:上游 Turn 导航跳到未加载回合时,以
 * `turnWindow.minMessages = JUMP_PAGE_MESSAGES(200)` 的形态循环回补;把这种页也压到
 * 30 条会让跨千条事件的一次跳转变成上百次串行 RPC。故识别该形态并原样放行。
 * 若上游日后改了 JUMP_PAGE_MESSAGES 取值,识别失效只会退回「压到 30」——语义仍
 * 正确,仅跳转变慢,属可接受的降级方向。
 *
 * 边界:`throughSeq`/`beforeSeq` 游标一律不动(连续性由上游 journal-stream 断言),
 * 本层只收窄预算维度;子代理地址与普通会话同路,无需分支。
 */

/**
 * 首屏与普通续页的消息预算(条)。
 * 30 条≈常见一个回合的可读量;实测最大会话 30 条消息 ≈0.45 MB。
 * 运维可用 `ETERNA_HISTORY_PAGE_MESSAGES` 覆盖(无需重建镜像)。
 */
export const DEFAULT_PAGE_MESSAGES = 30

/** 上游轮次跳转页的最小消息下限(`JUMP_PAGE_OPTIONS.turnWindow.minMessages`)。 */
const UPSTREAM_JUMP_MIN_MESSAGES = 200

/** 被钳制的会话历史入口(上游 SessionController 的方法名)。 */
export const CLAMPED_SESSION_METHODS = ['events', 'page', 'follow'] as const

/** 上游 SessionPageRequest 的本层消费子集(只读预算字段,其余原样透传)。 */
export interface HistoryWindowRequest {
  readonly beforeSeq?: number
  readonly maxMessages?: number
  readonly turnWindow?: { readonly minMessages: number; readonly minTurns: number }
}

/**
 * 解析生效的消息预算:`ETERNA_HISTORY_PAGE_MESSAGES` 合法正整数优先,否则 30。
 * 非法值(含 0/负数/小数/非数字)静默回落缺省——配置错误不应让历史读取失败。
 *
 * @param raw - 环境变量原值(调用方传入,便于单测)。
 * @returns 生效的消息条数预算。
 */
export function resolvedPageMessages(raw: string | undefined): number {
  if (raw === undefined || raw.trim() === '') return DEFAULT_PAGE_MESSAGES
  const value = Number(raw)
  if (!Number.isSafeInteger(value) || value <= 0) return DEFAULT_PAGE_MESSAGES
  return value
}

/**
 * 判断一次历史请求是否为上游轮次跳转页(loadThrough 的循环回补形态)。
 * @param request - 历史请求(只读预算字段)。
 * @returns 是则本层原样放行,不参与收敛。
 */
function isJumpPage(request: HistoryWindowRequest): boolean {
  if (request.beforeSeq === undefined) return false
  const window = request.turnWindow
  return window !== undefined && window.minMessages >= UPSTREAM_JUMP_MIN_MESSAGES
}

/**
 * 按产品口径收敛一次历史请求的消息预算。
 *
 * @param request - 原始请求(缺预算字段时按产品缺省收敛)。
 * @param pageMessages - 生效预算条数(缺省 {@link DEFAULT_PAGE_MESSAGES})。
 * @returns 预算已收敛的新请求对象;输入未被修改。跳转页原样返回。
 */
export function clampHistoryWindow(
  request: HistoryWindowRequest,
  pageMessages: number = DEFAULT_PAGE_MESSAGES,
): HistoryWindowRequest {
  if (isJumpPage(request)) return request
  const requested = request.maxMessages
  const maxMessages = requested !== undefined && Number.isSafeInteger(requested) && requested > 0
    ? Math.min(requested, pageMessages)
    : pageMessages
  const window = request.turnWindow
  if (window === undefined) return { ...request, maxMessages }
  if (window.minMessages > maxMessages) {
    // 下限规则与上限冲突(上游会判 bad-request):丢弃轮次窗口,退化为纯消息数分页。
    const { turnWindow: _dropped, ...rest } = request
    return { ...rest, maxMessages }
  }
  return { ...request, maxMessages, turnWindow: { minMessages: window.minMessages, minTurns: window.minTurns } }
}

/** 可被包装的上游服务结构子集(仅本层触及的三个入口)。 */
type ClampableMethod = (request: unknown, signal?: AbortSignal) => unknown
export interface ClampableService {
  events?: ClampableMethod
  page?: ClampableMethod
  follow?: ClampableMethod
}

/** 一次包装的结果面:还原闭包 + 实际被包装的入口名(供审计/防漂移观测)。 */
export interface HistoryWindowClampInstall {
  /** 还原被包装的入口(幂等)。 */
  readonly dispose: () => void
  /** 实际包装成功的入口名;空数组=上游形态不匹配,未做任何改动。 */
  readonly clamped: readonly string[]
}

/**
 * 在 Host 服务实例上安装历史预算钳制;返回还原闭包。
 *
 * 只包装确实以函数存在的入口(上游版本漂移/方法缺席时跳过该入口,不上抛);
 * 原方法以实例为 this 调用,`follow` 的 AsyncIterable 原样返回。
 * 不可写(冻结/原型受限)时静默放弃该入口并继续其余入口,保持既有行为。
 *
 * @param service - 上游 SessionController 实例(结构化子集)。
 * @param pageMessages - 生效预算条数(缺省 {@link DEFAULT_PAGE_MESSAGES})。
 * @returns 安装结果;没有任何入口被包装时返回 undefined。
 */
export function installHistoryWindowClamp(
  service: ClampableService | undefined,
  pageMessages: number = DEFAULT_PAGE_MESSAGES,
): HistoryWindowClampInstall | undefined {
  if (service === undefined) return undefined
  // 动态入口访问:上游只以这三个成员名出现,按名取/按名写,便于统一包装与还原。
  const slots = service as Record<string, ClampableMethod | undefined>
  const restores: (() => void)[] = []
  const clamped: string[] = []
  for (const method of CLAMPED_SESSION_METHODS) {
    const original = slots[method]
    if (typeof original !== 'function') continue
    const wrapped = function (this: unknown, request: unknown, signal?: AbortSignal): unknown {
      const next = request !== null && typeof request === 'object' && !Array.isArray(request)
        ? clampHistoryWindow(request, pageMessages)
        : request
      return original.call(this, next, signal)
    }
    try {
      slots[method] = wrapped
    } catch {
      continue
    }
    clamped.push(method)
    restores.push(() => {
      if (slots[method] === wrapped) slots[method] = original
    })
  }
  if (restores.length === 0) return undefined
  return {
    clamped,
    dispose: () => {
      for (const restore of restores.reverse()) restore()
    },
  }
}
