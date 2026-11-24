/**
 * @eterna/adviser Host 装配:把 {@link AdviserService} 接到真实宿主服务面,
 * 并以 `ctx.provide('eternaAdviser', …)` 暴露给 access 守卫路由。
 *
 * ## 为什么装配在这里、路由在 access
 * 铁律 T2:插件不得自注册 Web 路由/数据端点(`packctl tenant-scan` CI 强制)。
 * 数据面(fork 子会话、投递)只能由本包提供,HTTP 面只能由 access 登记。
 * 两端靠**结构面**相遇:本包 provide 一个普通对象,access 用
 * `ctx.reflect.get('eternaAdviser', false)` 现读(与 tasks 的 `settingsFace` 同款)。
 * 因此**两个包互不 import**,Tier1 内部无耦合(access 声明结构面、adviser 实现它)。
 *
 * ## 冷恢复的取舍
 * 父会话可能不 live(重启后未打开)。上游 `sessionController.resolveAgent()`
 * 自带「live → 复用 / 冷 → resume」且并发去重,是唯一正确入口;但它由 web-app
 * 装配,base 形态下缺席。故本模块按顺序尝试:
 *   ① `ctx.agents.get(id)` —— 已 live,零成本;
 *   ② `ctx.sessionController.resolveAgent(id)` —— 有 session-controller 时用它的去重冷恢复;
 *   ③ 都没有 → 返回 undefined(服务面回 `parent-missing`,fail-closed,不自造 resume)。
 * 不自造 `agents.resume()` 的理由:resume 需要正确的 `agentOptions`/`setup` 组合
 * (preset 装配),自造会产出「会话起来了但没有参谋预设」的错配。
 */
import type { Context } from '@deepseek-ai/cordis'
import {
  AdviserService,
  type AdviserPorts,
} from './service.ts'
import { registerTicketTool } from './ticket-tools.ts'

/** 服务 id:`ctx.eternaAdviser` 与 access 的 reflect 键(唯一事实源)。 */
export const ADVISER_SERVICE_ID = 'eternaAdviser'

/** 服务面暴露给 access 的结构子集(access 侧有同名结构声明,two-side 不 import)。 */
export interface AdviserFace extends AdviserService {}

/** 宿主 Agent 的最小子集(结构面:避免 import 上游 agent 包)。 */
interface HostAgent {
  readonly id: string
  inject(message: unknown): void
  followup(message: unknown): void
}

/** `ctx.sessionController` 的结构子集(web-app 装配时才在)。 */
interface SessionControllerLike {
  resolveAgent(sessionId: string): Promise<unknown>
}

/** `ctx.subagents` 的结构子集。 */
interface SubagentsLike {
  startActivation(spec: unknown): Promise<{ childId?: unknown; messageId?: unknown; dispose?: () => Promise<void> }>
  listDescendants(rootSessionId: string): Promise<readonly Record<string, unknown>[]>
}

/** 宿主侧读服务的统一入口(cordis 过滤上下文对未声明服务直读会抛)。 */
function readService(ctx: Context, name: string): unknown {
  try {
    return (ctx as unknown as { get(id: string): unknown }).get(name)
  } catch {
    return undefined
  }
}

/** 服务面的最小形状检查:`get` 存在即当作可用的 Agent 注册表。 */
function asAgentRegistry(value: unknown): { get(id: string): unknown } | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  return typeof (value as Record<string, unknown>).get === 'function'
    ? value as { get(id: string): unknown }
    : undefined
}

/** `ctx.subagents` 形状检查(两个方法都要在)。 */
function asSubagents(value: unknown): SubagentsLike | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  const candidate = value as Record<string, unknown>
  return typeof candidate.startActivation === 'function' && typeof candidate.listDescendants === 'function'
    ? value as SubagentsLike
    : undefined
}

/** `ctx.sessionController` 形状检查。 */
function asSessionController(value: unknown): SessionControllerLike | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  return typeof (value as Record<string, unknown>).resolveAgent === 'function'
    ? value as SessionControllerLike
    : undefined
}

/** 上游 id 是 branded string,运行时就是字符串;只认字符串,其余一律空串。 */
function asId(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

/**
 * 上游 `startActivation` 的两条**不兼容**形态(2026-11-24 实机定谳)。
 *
 * DSH 在 0.2.2 的 alpha 线与 rc 线之间把 `parent`/`prompt`/`agentPreset` 从
 * `spec.request` 子对象**搬到了 spec 顶层**:
 *
 * | 版本 | 形态 | 现场 |
 * |---|---|---|
 * | `0.2.2-alpha.2` | `spec.request.{parent,prompt,agentPreset}` | 仓库 catalog 钉版 |
 * | `0.2.2-rc.1` / `rc.5` | `spec.{parent,prompt,agentPreset}` | 本地 dsh、生产镜像 |
 *
 * 认错形态的后果不是报错而是**病态错误**:rc 线读 `spec.parent.id` 得
 * `Cannot read properties of undefined`,只在真实 boot 才暴露(单测的假端口
 * 按我们的假设写,永远测不出)。因此端口在调用瞬间**探测**形态:
 *
 * - 先看 `SubagentStartRequest` 的判别位——rc 线的 `assertCapabilities` 直接读
 *   `spec.agentPreset`;alpha 线读 `spec.request.agentPreset`。两者都"可能为
 *   undefined",所以不能靠值判断,只能靠**版本**判断。
 * - 版本从 `subagents` 服务实例自身取:上游是 `Service` 子类,`ctx.get` 拿到的
 *   对象上没有 version 字段,故改用**特性探测**:注入一个最小探针 spec 观察报错
 *   文本会污染日志,不可取。
 *
 * 采用**双写**方案(两条线都能跑,且无副作用):
 * - `spec.parent` / `spec.prompt` / `spec.agentPreset` 平铺(**rc 线用**);
 * - `spec.request` 同值装箱(**alpha 线用**)。
 *
 * alpha.2 的 `startActivation` 只读 `spec.request.*`,见不到的顶层字段无害;
 * rc 线只读顶层,见不到的 `request` 子对象同样无害。这是唯一同时正确且
 * 不需要版本嗅探的写法。
 */
function activationSpec(shared: {
  provider: string
  label: string
  name: string
  childId: string
  parent: HostAgent
  prompt: readonly { readonly type: 'text'; readonly text: string }[]
  agentPreset: string
  signal: AbortSignal
  delivery: 'caller'
}): unknown {
  const request = {
    parent: shared.parent,
    prompt: shared.prompt,
    agentPreset: shared.agentPreset,
  }
  return {
    provider: shared.provider,
    label: shared.label,
    name: shared.name,
    childId: shared.childId,
    signal: shared.signal,
    delivery: shared.delivery,
    // ── rc 线(0.2.2-rc.1 / rc.5):顶层平铺 ──
    parent: shared.parent,
    prompt: shared.prompt,
    agentPreset: shared.agentPreset,
    // ── alpha 线(0.2.2-alpha.2):request 装箱 ──
    request,
  }
}

/** 造一条 UserMessage(inject/followup 的入参形态;不新增事件类型)。 */
function userMessage(id: string, text: string, form: 'instructions' | 'notice', summary?: string): unknown {
  return {
    id,
    role: 'user',
    content: [{ type: 'text', text }],
    source: { kind: 'user', form, ...summary === undefined ? {} : { summary } },
  }
}

/** 把宿主 Agent 收窄成本包所需的最小面(防御性:只认真正用到的两个方法)。 */
function asHostAgent(value: unknown): HostAgent | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  const candidate = value as Record<string, unknown>
  if (typeof candidate.id !== 'string' || typeof candidate.inject !== 'function'
    || typeof candidate.followup !== 'function') return undefined
  return value as unknown as HostAgent
}

/**
 * 构造连到真实主机的端口。
 *
 * ## 服务必须**每次现读**,不能在 apply 时缓存快照
 * (2026-11-24 实机 E2E 实证的坑):插件装载顺序由**服务可用性**驱动,
 * adviser 常常在 `agents` / `subagents` 注册**之前** apply。若在此刻
 * `const agents = readService(...)` 把结果存成闭包常量,它就会永久是
 * `undefined`——表现为 `list` 恒空、`create` 恒 `parent-missing`,
 * 而与此同时 `ctx.get('subagents')` 明明已经就绪(诊断探针实证)。
 * 这与 tasks/access 自己踩过的「apply 时点服务未就绪」是同一类坑,
 * 修法也相同:**每次调用现读**。
 *
 * @param ctx - 插件上下文(apply 时点捕获,但每次操作重新解析服务)。
 * @returns 端口实现;依赖缺席时各方法自行降级(返回 undefined/false,不抛)。
 */
export function createHostPorts(ctx: Context): AdviserPorts {
  // 每次访问都重新解析(不做 apply 时快照——见上注)。
  const agentsNow = (): { get(id: string): unknown } | undefined => asAgentRegistry(readService(ctx, 'agents'))
  const subagentsNow = (): SubagentsLike | undefined => asSubagents(readService(ctx, 'subagents'))
  const controllerNow = (): SessionControllerLike | undefined => asSessionController(readService(ctx, 'sessionController'))

  /** ① live 优先;② 有 session-controller 时委托它的去重冷恢复;③ 否则放弃。 */
  const resolveAgent = async (sessionId: string): Promise<HostAgent | undefined> => {
    const live = asHostAgent(agentsNow()?.get(sessionId))
    if (live !== undefined) return live
    const controller = controllerNow()
    if (controller === undefined) return undefined
    try {
      const resolved = await controller.resolveAgent(sessionId) as { agent?: unknown } | undefined
      return asHostAgent(resolved?.agent)
    } catch {
      // 上游拒绝(会话不存在 / 归属 subagent / 装配竞态)一律视为不可用,
      // 由服务面映射为 parent-missing,不把内部异常抛给 HTTP 层。
      return undefined
    }
  }

  return {
    getAgent: sessionId => asHostAgent(agentsNow()?.get(sessionId)),
    ensureAgent: sessionId => resolveAgent(sessionId),
    async startActivation(spec) {
      const subagents = subagentsNow()
      if (subagents === undefined) throw new Error('subagents 服务未就绪')
      // parent 必须是**活的 Agent 实例**(上游 startActivation 会做身份恒等校验:
      // `ctx.get('agents').get(spec.parent.id) !== spec.parent` → UNAUTHORIZED)。
      // 故这里用端口自己解析出的真 Agent,而非服务面传进来的结构件。
      const parent = await resolveAgent((spec.request.parent as { id: string }).id)
      if (parent === undefined) throw new Error('parent-missing: 主会话不可用')
      // 形态自适应(平铺 + 装箱双写):见 activationSpec 注。
      const activation = await subagents.startActivation(activationSpec({
        provider: spec.provider,
        label: spec.label,
        name: spec.name,
        childId: spec.childId,
        parent,
        prompt: spec.request.prompt,
        agentPreset: spec.request.agentPreset,
        signal: spec.signal,
        delivery: spec.delivery,
      }))
      const childId = asId(activation.childId) === '' ? spec.childId : asId(activation.childId)
      // 工单概览工具(P4 收尾):**只能在这里注册**——预设 scope 是 isolate 的,
      // 预设内的插件读不到宿主根 ctx 的 `tasks`(实机定谳,见 ticket-tools.ts 头注)。
      // 注册到参谋 agent 自己的 ctx 上,并用 when 谓词按 agent id 钉住,连同一 preset
      // 的其它会话也看不到。base 形态 tasks 缺席 → registerTicketTool 直接返回空
      // disposer(优雅缺席,不给模型一个必失败的坏工具)。
      //
      // 失败一律降级:工单面只是增强,不该让参谋创建整体失败。
      try {
        const child = agentsNow()?.get(childId)
        const childCtx = (child as { readonly ctx?: Context } | undefined)?.ctx
        if (childCtx !== undefined) {
          registerTicketTool(ctx, childCtx, child as { readonly id?: unknown })
        }
      } catch {
        // 子会话尚未进 registry / ctx 形状不符:跳过工单工具。
      }
      return {
        childId,
        ...asId(activation.messageId) === '' ? {} : { messageId: asId(activation.messageId) },
      }
    },
    async listDescendants(parentSessionId) {
      const subagents = subagentsNow()
      if (subagents === undefined) return []
      try {
        const rows = await subagents.listDescendants(parentSessionId)
        const mapped = rows.map((row) => {
          const id = asId(row.id)
          const label = asId(row.label)
          const activity = asId(row.activity)
          return {
            id,
            ...label === '' ? {} : { label },
            ...activity === '' ? {} : { activity },
          }
        })
        return mapped.filter(row => row.id !== '')
      } catch {
        // 父会话不存在/投影未就绪:catalog 读不到 → 空表(服务面据此回 limit 判定为 0,
        // 随后 create 会在 parent-missing 处 fail-closed)。
        return []
      }
    },
    inject(agentId, text) {
      const agent = asHostAgent(agentsNow()?.get(agentId))
      if (agent === undefined) return false
      try {
        agent.inject(userMessage(`adviser-inject-${Date.now()}`, text, 'notice', '参谋附言'))
        return true
      } catch {
        return false
      }
    },
    followup(agentId, text) {
      const agent = asHostAgent(agentsNow()?.get(agentId))
      if (agent === undefined) return false
      try {
        agent.followup(userMessage(`adviser-followup-${Date.now()}`, text, 'instructions'))
        return true
      } catch {
        return false
      }
    },
  }
}

/**
 * 装配服务并 provide 成 `ctx.eternaAdviser`。
 * @param ctx - 插件上下文。
 * @returns disposer(注销 provide)。
 */
export function mountAdviser(ctx: Context): () => void {
  const service = new AdviserService(createHostPorts(ctx))
  const provide = (ctx as unknown as { provide?: (id: string, value: unknown) => () => void }).provide
  if (typeof provide !== 'function') return () => {}
  return provide.call(ctx, ADVISER_SERVICE_ID, service)
}
