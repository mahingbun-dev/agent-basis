/**
 * companion 身份注入（E4 多用户浏览器执行面，2026-11-13 重做注入点）。
 *
 * 为什么不在 tools/pre-execute 瀑布里写 arguments：内核在 createExecution 时对
 * arguments 做 snapshot + deepFreeze（dsh-tools pipeline.js:331），且合同明确禁止
 * pre-execute 改写输入（dsh-tools contracts.d.ts:312-336 "Input rewriting is
 * excluded"、README:197）——原地写 `_eternaToken` 在冻结对象上必炸（2026-11-12
 * 生产实测：mcp__browser__* 全灭，`Cannot add property _eternaToken, object is
 * not extensible`）。瀑布无改写 seam、同名重注册 fail-loud（egress-plugin.ts:8-11
 * 已记载）。
 *
 * 剩余自由度 = 分发边界：dispatchToolBody（pipeline.js:468-471）经
 * `tools.executable(name, scope, toolSet)` 取 ToolDefinition 后以
 * `tool.execute(exec.arguments, exec)` 调用。对 ToolsService.executable 做实例级
 * in-place wrap（本仓库既有先例：sandbox.ts installSandboxBoundary 的
 * sandboxPolicy.resolve wrap），对 mcp__browser__* 返回 shadow 定义——execute 收到
 * 冻结 args 后**展开成新对象**再注入令牌，绝不触碰冻结原件。
 *
 * 诚实边界：这不是「参数改写」合法化——内核记录/呈现的 arguments = 模型原始输入，
 * 未被触碰；本模块做的是服务端凭据在分发边界的装配。令牌因此继续不进日志、审计与
 * 工具 schema（presenters 走 ToolsService.get 拿原定义，卡片不显示 shadow 面），
 * 与 companion.spec「审计不落令牌值」一致。残余风险：若某 dispatch 路径提供自定义
 * source.get（pipeline.js:261 旁路 executable），wrap 不生效 → 退化为「不注入」
 * （主域，同未知会话行为），不会炸。
 */
import { COMPANION_TOKEN_MISSING_REASON } from './companion.ts'

/** 会话归属与令牌读取面（plugin.ts 装配，测试注入假件）。 */
export interface CompanionInjectDeps {
  /** dsh 会话 id → 归属用户 id；未知会话返回 undefined。 */
  readonly sessionOwner: (sessionId: string) => number | undefined
  /** 用户 id → 浏览器执行面令牌；未生成返回 undefined。 */
  readonly tokenOf: (ownerId: number) => string | undefined
}

/** 一次浏览器工具调用的 companion 路由裁决。 */
export type CompanionRoute =
  | { readonly kind: 'passthrough' }
  | { readonly kind: 'deny'; readonly reason: string }
  | { readonly kind: 'inject'; readonly token: string }

/**
 * 路由裁决（纯函数）：未知会话（系统任务等）→ passthrough（主域，同历史行为）；
 * 已知归属但未生成令牌 → deny（fail-closed，防跨用户路由到主浏览器）；其余 → inject。
 */
export function routeCompanion(deps: CompanionInjectDeps, sessionId: unknown): CompanionRoute {
  if (typeof sessionId !== 'string' || sessionId === '') return { kind: 'passthrough' }
  const ownerId = deps.sessionOwner(sessionId)
  if (ownerId === undefined) return { kind: 'passthrough' }
  const token = deps.tokenOf(ownerId)
  if (token === undefined) return { kind: 'deny', reason: COMPANION_TOKEN_MISSING_REASON }
  return { kind: 'inject', token }
}

/** shadow 定义只需复刻内核 dispatch 实际消费的 execute 面（其余字段原样透传）。 */
export interface ToolDefinitionLike {
  readonly execute: (args: unknown, exec: unknown) => Promise<unknown>
}

/** 从 exec 结构面提取会话 id（结构兼容 dsh ToolRunContext.agent.session.id）。 */
function sessionIdOf(exec: unknown): unknown {
  if (exec === null || typeof exec !== 'object') return undefined
  const agent = (exec as { agent?: { session?: { id?: unknown } } }).agent
  return agent?.session?.id
}

/**
 * shadow 定义：execute 展开冻结 args 为新对象后注入令牌（模型伪造的 `_eternaToken`
 * 被服务端值覆盖——服务端值赢，语义同原设计）；deny = throw（内核 toolErrorResult
 * 物化为 `Error: ${message}`，与 pre-execute deny 形态一致，turn 不中断）。
 */
export function companionShadowDefinition(
  def: ToolDefinitionLike,
  deps: CompanionInjectDeps,
): ToolDefinitionLike {
  const execute = async (args: unknown, exec: unknown): Promise<unknown> => {
    const route = routeCompanion(deps, sessionIdOf(exec))
    if (route.kind === 'deny') throw new Error(route.reason)
    if (route.kind === 'passthrough') return def.execute(args, exec)
    const base = args !== null && typeof args === 'object' ? args as Record<string, unknown> : {}
    return def.execute({ ...base, _eternaToken: route.token }, exec)
  }
  return { execute }
}

/** ToolsService 的结构面（只声明 wrap 触达的 executable；避免拖入 cordis 类型面）。 */
export interface ExecutableCapable {
  executable: (name: string, scope?: unknown, toolSet?: unknown) => ToolDefinitionLike | undefined
}

const COMPANION_TOOL_PREFIX = 'mcp__browser__'

/**
 * 实例级 wrap `tools.executable`（sandbox.ts installSandboxBoundary 同款手法）：
 * 非 mcp__browser__ 前缀直通原结果（executable 是热路径，先做前缀短路）；
 * browser 工具返回缓存 shadow（WeakMap 按原定义缓存，同一注册不重复包）。
 * 返回 disposer（还原原方法）。
 */
export function installCompanionExecutableWrap(
  tools: ExecutableCapable,
  deps: CompanionInjectDeps,
): () => void {
  const original = tools.executable
  const shadows = new WeakMap<ToolDefinitionLike, ToolDefinitionLike>()
  const wrapped = function(this: unknown, name: string, scope?: unknown, toolSet?: unknown) {
    const def = original.call(this, name, scope, toolSet)
    if (def === undefined || !name.startsWith(COMPANION_TOOL_PREFIX)) return def
    let shadow = shadows.get(def)
    if (shadow === undefined) {
      shadow = companionShadowDefinition(def, deps)
      shadows.set(def, shadow)
    }
    return shadow
  } as ExecutableCapable['executable']
  tools.executable = wrapped
  return () => {
    tools.executable = original
  }
}
