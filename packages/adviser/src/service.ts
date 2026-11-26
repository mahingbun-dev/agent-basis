/**
 * @eterna/adviser Host 半边:参谋会话的生命周期与投递面。
 *
 * ## 职责
 * - **创建**:`ctx.subagents.startActivation` + **spawn provider** + 只读 preset
 *   (见 {@link ADVISER_PROVIDER} 的取舍说明),child 进父 catalog、`origin==='subagent'`。
 * - **发现/多开**:参谋会话无需自建登记表——它们就在父会话的 subagent catalog 里,
 *   以 `label === 'adviser'` 区分(54 号 §9 实测:重启后仍可推导)。
 * - **投递双通道**:`inject`(不唤醒,下次发言才见)与 `followup`(自成一轮,立即处理)。
 *
 * ## 契约边界(为什么这里不开路由)
 * 铁律 T2:插件不得自注册 Web 路由/数据端点,必须经 eterna-access 租户守卫
 * (`packctl tenant-scan` CI 强制)。本模块因此只提供**进程内服务面**,
 * 由 access 守卫路由按登录身份调用;身份与归属校验全在 access 侧
 * (`store.sessionOwner`),本模块不信任调用方传入的父会话 id。
 *
 * ## 持久化纪律
 * 不新增 `SessionEventMap` 事件类型——v4 持久化恢复拒载未知非 ignorable 事件
 * (`git show 2e3fa84` 的 `/clear` 同一手法)。参谋的持久事实全部落在既有事件里:
 * 会话自身的事件日志 + 父会话 catalog 的 `subagent/...` 记录。
 */
import type { Context } from '@deepseek-ai/cordis'

/** 参谋会话在父会话 catalog 里的 durable 标签(区分参谋与普通 worker)。 */
export const ADVISER_LABEL = 'adviser'

/**
 * 参谋会话的子代理 provider —— **`spawn`,不是 `fork`**。
 *
 * ## 为什么不是 fork(2026-11-24 实测定谳)
 * fork 与「独立 preset」在上游是**结构互斥**的:
 *
 * ```
 * subagent-fork-in-process/src/index.ts:63
 *   capabilities = { agentPreset: false, … }
 *   inheritsParentContext = true
 * // 注释原文:The child inherits its parent's preset composition.
 *
 * subagent/subagent/src/index.ts:581 (assertCapabilities)
 *   request.agentPreset !== undefined && !provider.capabilities.agentPreset
 *     → SubagentError('…does not support independent agent preset selection', 'UNSUPPORTED_CAPABILITY')
 * ```
 *
 * 即:用 fork 建参谋,参谋就**必须**继承父会话的完整工具面(可写盘、可执行命令、
 * 可委派),P2 的只读 `eterna-adviser` preset 完全无法施加——「只读纪律」只能靠
 * 提示词,没有硬保证。这对「顾问/参谋」的产品定位是不可接受的。
 *
 * ## spawn 的代价与补偿
 * spawn **不继承**父对话(`inheritsParentContext = false`),参谋开局不知道主会话
 * 在聊什么。这由**按需读父**补偿:参谋 preset 挂了 tool-session-query,其跨会话
 * 授权规则是「目标会话 cwd 与调用者 cwd 精确相等」,而 spawn 子会话继承父会话的
 * cwd(实测 `parent.cwd === child.cwd`),故参谋可读父会话;且搜索天然排除调用者
 * 自身。P4 实测:cwd 相同 → `filterSessions` 命中 1 条(授权通过)、父会话标记词
 * 可读;cwd 不同 → 命中 0(正确拒绝)。
 *
 * 这与原设计「不做实时全量镜像,按需读父」完全一致——参谋本就不该在开局吃掉
 * 一份父会话快照。
 */
export const ADVISER_PROVIDER = 'spawn'

/** 参谋会话的 agent preset id(与 cordis.patch.yml 的 preset 段一致)。 */
export const ADVISER_PRESET_ID = 'eterna-adviser'

/** 每父会话的参谋上限(计划书 §4 待定项:软上限 3,防无节制消耗)。 */
export const ADVISER_MAX_PER_PARENT = 3

/** 投递方式:inject 不唤醒(下次发言才见)/ followup 自成一轮(立即处理)。 */
export type AdviserDelivery = 'inject' | 'followup'

/** 一条参谋会话的视图(纯 JSON,可跨进程/浏览器传输)。 */
export interface AdviserSessionView {
  /** 参谋会话 id。 */
  readonly sessionId: string
  /** 创建时给定的 durable 标签。 */
  readonly label: string
  /** 激活状态。 */
  readonly activity: 'running' | 'inactive'
}

/** 创建结果。 */
export type AdviserCreateResult =
  | { readonly ok: true; readonly sessionId: string; readonly messageId: string }
  | { readonly ok: false; readonly code: AdviserFailureCode; readonly message: string }

/** 投递结果。 */
export type AdviserDeliverResult =
  | { readonly ok: true; readonly delivery: AdviserDelivery; readonly sessionId: string }
  | { readonly ok: false; readonly code: AdviserFailureCode; readonly message: string }

/**
 * 参谋会话的模型选择(与上游 `ModelSelection` 同形:provider + model + 可选档位)。
 * 只承载**路由选择**,不含采样参数——参谋的上下文预算等仍沿用父会话派生值。
 */
export interface AdviserModelSelection {
  readonly provider: string
  readonly model: string
  /** 显式思考档位;省略=由适配器默认/FETCH 时解析(与上游语义一致)。 */
  readonly reasoningEffort?: string
}

/** 模型读/写结果(失败码与投递/创建同一闭集,便于 access 统一映射 HTTP)。 */
export type AdviserModelOutcome =
  | { readonly ok: true; readonly selection: AdviserModelSelection | undefined }
  | { readonly ok: false; readonly code: AdviserFailureCode; readonly message: string }

/**
 * 模型写入被端口层拒绝(可用性校验失败 / 冷会话被占用)。
 * 端口抛这个类型,服务面按 `code` 映射失败码;不把内部异常原文递给浏览器。
 */
export class AdviserModelRejection extends Error {
  readonly code: 'invalid' | 'unavailable'

  constructor(code: 'invalid' | 'unavailable', message: string) {
    super(message)
    this.name = 'AdviserModelRejection'
    this.code = code
  }
}

/** 失败码闭集(中文 message 面向用户)。 */
export type AdviserFailureCode =
  | 'forbidden'        // 目标会话不属于调用者 / 不是参谋
  | 'limit'            // 已达每父会话参谋上限
  | 'parent-missing'   // 父会话不存在或未 live 且无法恢复
  | 'preset-missing'   // eterna-adviser preset 未装配
  | 'unavailable'      // 依赖服务缺席
  | 'invalid'          // 载荷非法

/** 起一个 subagent child 的调用形态。 */
export interface AdviserActivationSpec {
  readonly provider: string
  readonly label: string
  readonly name: string
  readonly childId: string
  /**
   * `parent` / `prompt` / `agentPreset` 三个字段的**中立容器**。
   *
   * ⚠ 上游在 0.2.2 的 alpha 与 rc 线之间**改过这些字段的层级**,两版不兼容:
   *
   * | 版本 | 形态 |
   * |---|---|
   * | `0.2.2-alpha.2`(仓库 catalog 钉版) | `startActivation({ …, request: { parent, prompt, agentPreset } })` |
   * | `0.2.2-rc.1` / `rc.5`(实机与生产) | `startActivation({ …, parent, prompt, agentPreset })` **顶层平铺** |
   *
   * 服务层因此**不决定层级**:它只把三个值装进这个中立对象,由端口层
   * (`host.ts` 的 `startActivation`)按**运行时探测到的形态**摊平或装箱。
   * 这样同一份服务代码在两条线上都正确,升级上游不需要改这里。
   *
   * 2026-11-24 实证教训:此前把「必须在 request 内」当成普适结论写死,
   * 在 rc.1 上表现为 `spec.parent` 为 undefined → `Cannot read properties of
   * undefined (reading 'id')`;而单测用假端口,永远测不出。
   */
  readonly request: {
    readonly parent: unknown
    readonly prompt: readonly { readonly type: 'text'; readonly text: string }[]
    readonly agentPreset: string
    /**
     * 创建时继承的**父会话当前模型**(2026-11-25)。
     *
     * 必须显式传,不能指望 spawn 的默认继承:上游 `resolveChildAgentOptions`
     * 只读 `parent.options`(会话创建时的路由),而用户在会话里切过的模型落在
     * `model/selection` 事件与 `agent.model.current()` 上——不传就会得到一个
     * 「与主会话当前模型不一致」的参谋。传了以后参谋从第一条消息起就用同一路由,
     * 此后两边各自独立(切换互不影响)。
     */
    readonly agentOptions?: AdviserModelSelection
  }
  readonly signal: AbortSignal
  readonly delivery: 'caller'
}

/** 依赖的服务面(结构端口,便于单测注入假件)。 */
export interface AdviserPorts {
  /** 取活的 Agent(存在则返回,不创建)。 */
  getAgent(sessionId: string): { id: string } | undefined
  /** 建/恢复父 Agent(冷恢复用)。 */
  ensureAgent(sessionId: string): Promise<{ id: string } | undefined>
  /** 起一个 subagent child。 */
  startActivation(spec: AdviserActivationSpec): Promise<{ childId: string; messageId?: string }>
  /** 列父会话的 subagent catalog。 */
  listDescendants(parentSessionId: string): Promise<readonly { readonly id: string; readonly label?: string; readonly activity?: string }[]>
  /** 给某个 live Agent 投递(不唤醒)。 */
  inject(agentId: string, text: string): boolean
  /** 给某个 live Agent 投递(自成一轮)。 */
  followup(agentId: string, text: string): boolean
  /**
   * 父会话**当前**模型(创建参谋时继承用;缺席=不覆盖上游默认)。
   * 读 `agent.model.current()`(pending ?? lastUsed ?? 创建时 options)。
   */
  parentModel(parentSessionId: string): AdviserModelSelection | undefined
  /**
   * 读参谋会话当前模型:live 走 `agent.model.current()`,冷会话走
   * `sessionQuery.observeSession` 的 modelSelection 投影(`next ?? lastUsed`)。
   */
  readModel(childSessionId: string): Promise<AdviserModelSelection | undefined>
  /**
   * 写参谋会话模型:live 走 `agent.model.select()`(落 `model/selection` 事件);
   * 冷会话直接向持久化日志追加同一事件(取写句柄→append→flush)。
   * 模型不可用抛 {@link AdviserModelRejection}('invalid');冷会话被占用/持久化
   * 缺席抛同类的 'unavailable'。
   */
  writeModel(childSessionId: string, selection: AdviserModelSelection): Promise<void>
}

/** 参谋服务面(access 守卫路由的调用对象)。 */
export class AdviserService {
  // ⚠ 不得写成 TypeScript 参数属性(`constructor(private readonly ports: …)`):
  // DSH 以 Node 的 **strip-only** 模式直接加载 `src/*.ts`(node --experimental-strip-types),
  // 该模式不支持参数属性,会以 ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX 拒绝装载整个插件——
  // 且 **vitest 会先编译,单测完全测不出这个死法**(实机实证:eterna-adviser 静默装载失败)。
  private readonly ports: AdviserPorts

  constructor(ports: AdviserPorts) {
    this.ports = ports
  }

  /**
   * 列某父会话下的全部参谋。
   * @param parentSessionId - 父会话 id(调用方须已校验归属)。
   */
  async list(parentSessionId: string): Promise<readonly AdviserSessionView[]> {
    const rows = await this.ports.listDescendants(parentSessionId)
    return rows
      .filter(row => row.label === ADVISER_LABEL)
      .map(row => ({
        sessionId: row.id,
        label: ADVISER_LABEL,
        activity: row.activity === 'running' ? 'running' as const : 'inactive' as const,
      }))
  }

  /**
   * 建一个参谋会话。
   *
   * **不继承父对话**:参谋用 spawn provider 建(见 {@link ADVISER_PROVIDER}),
   * 开局只有 `seedText` 这条消息。它靠 preset 里的 tool-session-query 按需读父
   * 会话(同 cwd 授权已实测),而不是靠开局快照——这与「不做实时全量镜像」的
   * 原设计一致。
   *
   * @param parentSessionId - 父会话 id(调用方须已校验归属)。
   * @param seedText - 参谋的首条用户消息(选中文字入口会把它作为初始上下文)。
   * @param childId - 可选的预留 id(多开与恢复要求确定性 id)。
   */
  async create(parentSessionId: string, seedText: string, childId?: string): Promise<AdviserCreateResult> {
    const existing = await this.list(parentSessionId)
    if (existing.length >= ADVISER_MAX_PER_PARENT) {
      return { ok: false, code: 'limit', message: `每个会话最多 ${ADVISER_MAX_PER_PARENT} 个参谋,请先关闭闲置的参谋` }
    }
    const parent = this.ports.getAgent(parentSessionId) ?? await this.ports.ensureAgent(parentSessionId)
    if (parent === undefined) {
      return { ok: false, code: 'parent-missing', message: '主会话不存在或当前不可用' }
    }
    const resolvedChildId = childId ?? mintAdviserSessionId(parentSessionId, existing.length + 1)
    const ordinal = existing.length + 1
    // 创建时继承主会话**当前**路由(注意不是 parent.options 的创建时路由:
    // 用户在会话里切过模型后二者不同,见 request.agentOptions 注)。
    const inheritedModel = this.ports.parentModel(parentSessionId)
    try {
      const activation = await this.ports.startActivation({
        // spawn(不是 fork):只有它支持独立 preset,而只读纪律必须由**工具面缺失**
        // 硬保证,不能靠提示词。详见 ADVISER_PROVIDER 注与 54 号 §11。
        provider: ADVISER_PROVIDER,
        label: ADVISER_LABEL,
        name: `adviser-${ordinal}`,
        childId: resolvedChildId,
        request: {
          parent,
          prompt: [{ type: 'text', text: seedText }],
          // preset 在 request 内(与 parent/prompt 同级),不是顶层字段。
          agentPreset: ADVISER_PRESET_ID,
          ...inheritedModel === undefined ? {} : { agentOptions: inheritedModel },
        },
        signal: new AbortController().signal,
        delivery: 'caller',
      })
      return { ok: true, sessionId: activation.childId, messageId: activation.messageId ?? '' }
    } catch (error) {
      return { ok: false, ...describeFailure(error) }
    }
  }

  /**
   * 把一个结论投递给主会话(用户确认后才调用;双通道语义见 AdviserDelivery)。
   * @param parentSessionId - 目标主会话 id(调用方须已校验归属)。
   * @param text - 要投递的内容。
   * @param delivery - inject(不唤醒)或 followup(自成一轮)。
   */
  async deliver(parentSessionId: string, text: string, delivery: AdviserDelivery): Promise<AdviserDeliverResult> {
    const trimmed = text.trim()
    if (trimmed === '') return { ok: false, code: 'invalid', message: '投递内容不能为空' }
    const agentId = typeof this.ports.getAgent(parentSessionId)?.id === 'string'
      ? parentSessionId
      : (await this.ports.ensureAgent(parentSessionId))?.id
    if (agentId === undefined) {
      return { ok: false, code: 'parent-missing', message: '主会话不存在或当前不可用' }
    }
    const delivered = delivery === 'inject'
      ? this.ports.inject(agentId, trimmed)
      : this.ports.followup(agentId, trimmed)
    if (!delivered) {
      return { ok: false, code: 'unavailable', message: '主会话当前不接受投递(可能正在卸载或已关闭)' }
    }
    return { ok: true, delivery, sessionId: parentSessionId }
  }

  /**
   * 读/写某个参谋的模型(2026-11-25 模型解耦)。
   *
   * 归属校验在服务层再做一次(不只信 access):`childSessionId` 必须出现在本
   * 父会话的参谋清单里——否则一个合法登录用户可以把任意子会话 id 塞进来改模型
   * (access 只校验了父会话归属,子父关系是本层知识)。
   *
   * @param parentSessionId - 主会话 id(调用方须已校验归属)。
   * @param childSessionId - 参谋会话 id。
   * @param selection - 省略=只读;给出=切换(路由 + 可选档位)。
   */
  async model(
    parentSessionId: string,
    childSessionId: string,
    selection?: AdviserModelSelection,
  ): Promise<AdviserModelOutcome> {
    if (childSessionId === '') {
      return { ok: false, code: 'invalid', message: '参数不合法:缺少参谋会话 id' }
    }
    const rows = await this.list(parentSessionId)
    if (!rows.some(row => row.sessionId === childSessionId)) {
      // 不泄漏该会话是否存在:不是本父会话的参谋一律同一种说法。
      return { ok: false, code: 'forbidden', message: '该会话不是本主会话的参谋' }
    }
    if (selection === undefined) {
      try {
        return { ok: true, selection: await this.ports.readModel(childSessionId) }
      } catch (error) {
        return { ok: false, code: 'unavailable', message: `读取参谋模型失败:${errorText(error)}` }
      }
    }
    const normalized = normalizeModelSelection(selection)
    if (normalized === undefined) {
      return { ok: false, code: 'invalid', message: '参数不合法:provider/model 不能为空' }
    }
    try {
      await this.ports.writeModel(childSessionId, normalized)
    } catch (error) {
      const code = (error as { code?: unknown } | undefined)?.code
      if (code === 'invalid' || code === 'unavailable') {
        return { ok: false, code, message: errorText(error) }
      }
      return { ok: false, code: 'unavailable', message: `切换参谋模型失败:${errorText(error)}` }
    }
    return { ok: true, selection: normalized }
  }
}

/**
 * 推导参谋会话 id:父会话 id + ordinal 的确定性拼装。
 * 确定性 id 让「多开」与「刷新后恢复」无需额外登记表——catalog 已是唯一真值源。
 * @param parentSessionId - 父会话 id。
 * @param ordinal - 第几个参谋(从 1 起)。
 */
export function mintAdviserSessionId(parentSessionId: string, ordinal: number): string {
  return `${parentSessionId}--adviser-${ordinal}`
}

/** 把异常映射为失败码与中文消息(失败码是闭集,未知一律 unavailable)。 */
function describeFailure(error: unknown): { code: AdviserFailureCode; message: string } {
  const codeValue = (error as { code?: unknown } | undefined)?.code
  const code = typeof codeValue === 'string' ? codeValue : ''
  const raw = error instanceof Error ? error.message : String(error)
  if (code.includes('agent-preset') || raw.includes('agent-preset')) {
    return { code: 'preset-missing', message: `参谋组合(agent preset)未装配:${raw}` }
  }
  if (code.includes('unauthorized') || raw.includes('unauthorized')) {
    return { code: 'forbidden', message: '无权在该会话上创建参谋' }
  }
  return { code: 'unavailable', message: `参谋会话创建失败:${raw}` }
}

/** 异常文本(空消息兜一个可读类型名;不把堆栈递给 HTTP 层)。 */
function errorText(error: unknown): string {
  if (error instanceof Error) return error.message === '' ? error.name : error.message
  return String(error)
}

/**
 * 规范化模型选择(纯函数,单测可钉):
 * provider/model 去空白后必须非空;档位空串视同省略(与上游 `exactOptional` 一致)。
 * @param selection - 待规范化的选择。
 * @returns 规范化结果;非法=undefined(服务面映射 invalid)。
 */
export function normalizeModelSelection(selection: {
  readonly provider?: unknown
  readonly model?: unknown
  readonly reasoningEffort?: unknown
}): AdviserModelSelection | undefined {
  const provider = typeof selection.provider === 'string' ? selection.provider.trim() : ''
  const model = typeof selection.model === 'string' ? selection.model.trim() : ''
  if (provider === '' || model === '') return undefined
  const effort = typeof selection.reasoningEffort === 'string' ? selection.reasoningEffort.trim() : ''
  return { provider, model, ...effort === '' ? {} : { reasoningEffort: effort } }
}

/** DSH bundle loader 取 default export 插件实例。 */
export default {
  name: 'eterna-adviser',
  apply(ctx: Context): () => void {
    // P3:服务面装配留到访问 access 守卫路由接线时注入真实端口
    // (见计划书 P3「@Remote 方法面」与 P9 挂载项)。
    // 本阶段导出 AdviserService 供单测与后续装配使用,不自行 provide,
    // 避免在无身份的进程内被误用(铁律 T2:数据面经服务提供、路由经 access 登记)。
    void ctx
    return () => { /* 无资源需要撤销 */ }
  },
}
