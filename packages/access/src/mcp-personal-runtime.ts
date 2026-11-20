/**
 * B14(2026-11-20,WP4-3):个人 MCP 运行时挂载——按会话归属把每用户的启用条目
 * 以 createScope + dsh-mcp-client 挂到该 Agent 的 scope,并在删除/禁用/登出/
 * agent 销毁时立即摘除。
 *
 * 安全与资源纪律(47 §7 / 50 §3.4.3 / 54 §13.4):
 * - agent/created:sessionOwner(session.id) 无归属 → 不挂;每 Agent 最多 4 连接,
 *   单条 8s 启动预算,失败只 logger.warn(不阻塞 Agent 创建,不炸 boot);
 * - 双守卫 tools/pre-execute + tools/execute,监听必须带 {global:true}——否则
 *   scope 过滤只看本 Agent,跨租户调用会逃检(50 §3.4.3 红字);
 * - 工具名 `mcp__p<uid>_[slug]__<tool>`:uid 与会话归属不一致 → deny(同用户子代理
 *   因账本归属相同而放行);归属未知同样 deny(防 fail-open);
 * - kill switch:config.enabled=false / 配置解析失败 / 缺主密钥 → 不挂且守卫拒绝
 *   任何 mcp__p* 调用(与路由面 503 同口径);
 * - disposeUser / disposeAll 幂等;secret 只在 createScope 的连接配置里解密,
 *   不写日志、不进审计。
 *
 * 测试注入面:createScope / mcpClientConfigOf / mcpClientPlugin / logger 均可替换,
 * 生产缺省用 @deepseek-ai/dsh-scope 与 @deepseek-ai/dsh-mcp-client 真件。
 */
import type { Context } from '@deepseek-ai/cordis'
import { createScope as createRealScope } from '@deepseek-ai/dsh-scope'
import * as mcpClientModule from '@deepseek-ai/dsh-mcp-client'
import {
  MCP_PERSONAL_MAX_CONNECTIONS, MCP_PERSONAL_STARTUP_TIMEOUT_MS,
  decryptMcpSecret, resolveMcpTransport,
  type McpPersonalConfig, type McpResolvedTransport,
} from './mcp-personal.ts'
import type { UserStore } from './store.ts'

/** 运行时消费的 Agent 结构子集(access 不 import @deepseek-ai/dsh-agent 类型面)。 */
export interface PersonalMcpAgent {
  readonly session: { readonly id: string }
}

/** createScope 的最小结构面(dsh-scope 的 Scope 满足)。 */
export interface PersonalMcpScope {
  readonly ctx: { plugin(plugin: unknown, config?: unknown): unknown }
  dispose(): Promise<void> | void
}

/** 个人工具名模式:`mcp__p<uid>_[slug]__<tool>`(serverName 由路由服务端生成)。 */
const PERSONAL_TOOL_PATTERN = /^mcp__p(\d+)_/

/** 默认单次工具调用超时(与上游 mcp-client 默认一致;个人层不另设上限)。 */
const DEFAULT_TOOL_CALL_TIMEOUT_MS = 60_000

export interface PersonalMcpLogger {
  warn(message: string): void
}

/** connection.fetch / cordis 事件面的结构子集(测试用假件)。 */
type PersonalListener = (...args: never[]) => unknown

export interface PersonalEventHost {
  on(event: string, listener: PersonalListener, options?: { readonly global?: boolean }): () => unknown
  effect?(execute: () => () => Promise<void>, label?: string): unknown
}

export interface PersonalMcpRuntimeDeps {
  /** 只读面:启用条目 + 密文读取。 */
  readonly store: Pick<UserStore, 'listEnabledMcpServers' | 'getMcpSecret'>
  /** 会话归属账本(users.db sessions.owner_id);未知返回 undefined。 */
  sessionOwnerOf(sessionId: string): number | undefined
  readonly logger: PersonalMcpLogger
  readonly config: McpPersonalConfig
  /** 主密钥;缺席=kill switch(不挂 + 守卫 deny)。 */
  readonly masterKey?: Buffer | undefined
  /** stdio 子进程工作目录(建议用户根;缺省 process.cwd())。 */
  readonly cwdOf?: ((userId: number) => string | undefined) | undefined
  /** 单条工具调用超时(测试可缩短;默认 60s)。 */
  readonly toolCallTimeoutMs?: number | undefined
  /** 每 Agent 同时挂载连接上限(默认 4)。 */
  readonly connectionsLimit?: number | undefined
  /** 单条启动预算(默认 8s)。 */
  readonly startupTimeoutMs?: number | undefined
  /** 测试注入:scope 工厂(默认 dsh-scope createScope)。 */
  readonly createScope?: ((ctx: Context, agent: PersonalMcpAgent) => PersonalMcpScope) | undefined
  /** 测试注入:McpClient.Config 等价物(默认 dsh-mcp-client Config)。 */
  readonly mcpClientConfigOf?: ((input: Record<string, unknown>) => unknown) | undefined
  /** 测试注入:插件本体(默认 dsh-mcp-client 命名空间插件)。 */
  readonly mcpClientPlugin?: unknown
}

export interface PersonalMcpRuntime {
  /** 删除/禁用/登出:摘除该用户所有 live Agent 的个人 MCP scope;幂等。 */
  disposeUser(userId: number): Promise<void>
  /** 卸载/关闭个人层:摘除全部 live scope;幂等。 */
  disposeAll(): Promise<void>
  /** 观测面(测试与审计):当前挂载的 Agent 数与连接数。 */
  mountedAgents(userId?: number): number
  connectionsOf(userId: number): number
}

interface MountedAgent {
  readonly userId: number
  readonly scope: PersonalMcpScope
  connections: number
}

/** 单条连接预算;超时也确保底层 promise 的失败被消费(unhandledRejection 防线)。 */
function withBudget<T>(work: Promise<T>, ms: number): Promise<T> {
  work.catch(() => { /* 超时后仍可能失败;race 已给出结果,此处消费避免 unhandledRejection */ })
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => { reject(new Error(`MCP 启动超过 ${ms}ms 预算`)) }, ms)
  })
  return Promise.race([work, timeout]).finally(() => {
    if (timer !== undefined) clearTimeout(timer)
  })
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** 解析传输 → 上游 McpClient.Config 输入(secret 在 resolveMcpTransport 内解密)。 */
export function personalMcpClientInput(
  resolved: McpResolvedTransport,
  options: {
    readonly toolCallTimeoutMs?: number | undefined
    readonly startupTimeoutMs?: number | undefined
    readonly cwd?: string | undefined
  } = {},
): Record<string, unknown> {
  const common = {
    toolCallTimeoutMs: options.toolCallTimeoutMs ?? DEFAULT_TOOL_CALL_TIMEOUT_MS,
    startupTimeoutMs: options.startupTimeoutMs ?? MCP_PERSONAL_STARTUP_TIMEOUT_MS,
    failOnStartupError: false,
    reconnect: { enabled: false },
  }
  if (resolved.transport === 'stdio') {
    return {
      transport: 'stdio',
      serverName: resolved.serverName,
      command: resolved.command,
      args: [...resolved.args],
      env: { ...resolved.env },
      cwd: options.cwd ?? process.cwd(),
      ...common,
    }
  }
  return {
    transport: 'streamable-http',
    serverName: resolved.serverName,
    url: resolved.url,
    headers: { ...resolved.headers },
    ...common,
  }
}

/**
 * 把个人 MCP 运行时挂到 Host root 上下文。返回 runtime(disposeUser 供路由与登出
 * 钩子调用);scope 在 ctx effect 卸载时统一释放。
 */
export function mountPersonalMcp(ctx: Context, deps: PersonalMcpRuntimeDeps): PersonalMcpRuntime {
  const host = ctx as unknown as PersonalEventHost
  const byAgent = new Map<PersonalMcpAgent, MountedAgent>()
  const byUser = new Map<number, Set<PersonalMcpAgent>>()
  const connectionLimit = Math.max(1, deps.connectionsLimit ?? MCP_PERSONAL_MAX_CONNECTIONS)
  const startupBudget = deps.startupTimeoutMs ?? MCP_PERSONAL_STARTUP_TIMEOUT_MS
  const createScope = deps.createScope
    ?? ((scopeCtx: Context, agent: PersonalMcpAgent) => createRealScope(scopeCtx, agent))
  const configOf = deps.mcpClientConfigOf
    ?? ((input: Record<string, unknown>) => mcpClientModule.Config(input as never))
  const clientPlugin = deps.mcpClientPlugin ?? mcpClientModule
  let disposed = false

  /** kill switch:关闭/解析失败/缺主密钥 → 不挂且拒绝个人工具。 */
  const personalEnabled = (): boolean =>
    !disposed && deps.config.enabled && deps.config.error === undefined && deps.masterKey !== undefined

  const secretOf = (userId: number) => (ref: string): string | undefined => {
    const blob = deps.store.getMcpSecret(userId, ref)
    return blob === undefined ? undefined : decryptMcpSecret(deps.masterKey as Buffer, blob)
  }

  const forget = (agent: PersonalMcpAgent): MountedAgent | undefined => {
    const mounted = byAgent.get(agent)
    if (mounted === undefined) return undefined
    byAgent.delete(agent)
    const agents = byUser.get(mounted.userId)
    agents?.delete(agent)
    if (agents !== undefined && agents.size === 0) byUser.delete(mounted.userId)
    return mounted
  }

  const disposeAgent = async (agent: PersonalMcpAgent): Promise<void> => {
    const mounted = forget(agent)
    if (mounted === undefined) return
    try {
      await mounted.scope.dispose()
    } catch (error) {
      deps.logger.warn(`[mcp-personal] scope dispose 失败:${errorText(error)}`)
    }
  }

  const disposeUser = async (userId: number): Promise<void> => {
    const agents = [...(byUser.get(userId) ?? [])]
    await Promise.allSettled(agents.map(agent => disposeAgent(agent)))
  }

  const disposeAll = async (): Promise<void> => {
    disposed = true
    const agents = [...byAgent.keys()]
    await Promise.allSettled(agents.map(agent => disposeAgent(agent)))
    byUser.clear()
  }

  const connectOne = async (mounted: MountedAgent, resolved: McpResolvedTransport): Promise<void> => {
    try {
      const cwd = resolved.transport === 'stdio' ? (resolved.cwd ?? deps.cwdOf?.(mounted.userId)) : undefined
      const config = configOf(personalMcpClientInput(resolved, {
        toolCallTimeoutMs: deps.toolCallTimeoutMs,
        startupTimeoutMs: startupBudget,
        cwd,
      }))
      await withBudget(Promise.resolve(mounted.scope.ctx.plugin(clientPlugin, config)), startupBudget)
      mounted.connections += 1
    } catch (error) {
      // 失败只 warn:不阻塞 Agent 创建,不输出 secret/headers 值。
      deps.logger.warn(`[mcp-personal] ${resolved.serverName} 连接失败:${errorText(error)}`)
    }
  }

  const mountAgent = async (agent: PersonalMcpAgent): Promise<void> => {
    if (!personalEnabled() || byAgent.has(agent)) return
    let userId: number | undefined
    try {
      userId = deps.sessionOwnerOf(agent.session.id)
    } catch (error) {
      deps.logger.warn(`[mcp-personal] 归属解析失败:${errorText(error)}`)
      return
    }
    if (userId === undefined) return
    let rows
    try {
      rows = deps.store.listEnabledMcpServers(userId).slice(0, connectionLimit)
    } catch (error) {
      deps.logger.warn(`[mcp-personal] 读取条目失败:${errorText(error)}`)
      return
    }
    if (rows.length === 0) return
    const secret = secretOf(userId)
    const resolvedList: McpResolvedTransport[] = []
    for (const row of rows) {
      const resolved = resolveMcpTransport(row, deps.config, secret, { cwd: deps.cwdOf?.(userId) })
      if (resolved === undefined) {
        // 条目配置不完整(目录/密钥被删):跳过并告警,不中断其它条目。
        deps.logger.warn(`[mcp-personal] ${row.serverName} 配置不完整,跳过挂载`)
        continue
      }
      resolvedList.push(resolved)
    }
    if (resolvedList.length === 0) return
    const scope = createScope(ctx, agent)
    const mounted: MountedAgent = { userId, scope, connections: 0 }
    byAgent.set(agent, mounted)
    let agents = byUser.get(userId)
    if (agents === undefined) byUser.set(userId, agents = new Set())
    agents.add(agent)
    await Promise.allSettled(resolvedList.map(resolved => connectOne(mounted, resolved)))
    // 全部连接失败:立即释放空 scope(不在账本里留僵尸)。
    if (mounted.connections === 0) await disposeAgent(agent)
  }

  const guardFor = (exec: { readonly name: string; readonly agent?: PersonalMcpAgent | undefined }): string | undefined => {
    const match = PERSONAL_TOOL_PATTERN.exec(exec.name)
    if (match === null) return undefined
    if (!personalEnabled()) return 'mcp-personal: 个人 MCP 已关闭或未配置主密钥'
    const ownerId = Number(match[1])
    const sessionId = exec.agent?.session.id
    let owner: number | undefined
    try {
      owner = sessionId === undefined ? undefined : deps.sessionOwnerOf(sessionId)
    } catch {
      // 归属账本异常 = 无法证明同租户 → deny(fail-closed,不让异常穿透成工具未捕获错)。
      owner = undefined
    }
    // 同用户子代理的会话归属同为该用户 → 放行;跨用户/无归属 → deny(防 fail-open)。
    if (owner === undefined || owner !== ownerId) return 'mcp-personal: cross-tenant tool call denied'
    return undefined
  }

  // 【全局监听】必须 {global:true}(50 §3.4.3):scope 过滤下只能看到本 Agent,
  // 跨租户调用会逃检。
  host.on('agent/created', async (payload: { readonly agent: PersonalMcpAgent }) => {
    await mountAgent(payload.agent)
  }, { global: true })
  host.on('agent/disposed', (payload: { readonly agent: PersonalMcpAgent }) => {
    void disposeAgent(payload.agent)
  }, { global: true })
  host.on('tools/pre-execute', async (
    exec: { readonly name: string; readonly agent?: PersonalMcpAgent | undefined },
    next: () => Promise<unknown>,
  ) => {
    const denied = guardFor(exec)
    if (denied !== undefined) return { kind: 'deny', reason: denied }
    return next()
  }, { global: true })
  host.on('tools/execute', async (
    exec: { readonly name: string; readonly agent?: PersonalMcpAgent | undefined },
    next: () => Promise<unknown>,
  ) => {
    const denied = guardFor(exec)
    if (denied !== undefined) throw new Error(denied)
    return next()
  }, { global: true })

  // scope 随插件卸载统一回收(effect 支持异步 disposer,清理失败不抛出)。
  host.effect?.(() => async () => { await disposeAll() }, 'mcp-personal.sessions')

  return {
    disposeUser,
    disposeAll,
    mountedAgents(userId?: number): number {
      return userId === undefined ? byAgent.size : (byUser.get(userId)?.size ?? 0)
    },
    connectionsOf(userId: number): number {
      let total = 0
      for (const agent of byUser.get(userId) ?? []) total += byAgent.get(agent)?.connections ?? 0
      return total
    },
  }
}

/**
 * 生产 probe 适配器:dsh-mcp-client probeServer(不注册工具、不占用 serverName)。
 * 结果收敛为 {ok,toolCount,error?};错误文本由路由层脱敏后回给调用方。
 */
export function createMcpClientProbe(
  ctx: Context,
  options: { readonly timeoutMs?: number } = {},
): (config: McpResolvedTransport, signal: AbortSignal) => Promise<{ ok: boolean; toolCount: number; error?: string }> {
  return async (resolved, signal) => {
    const input = personalMcpClientInput(resolved, {
      cwd: resolved.transport === 'stdio' ? resolved.cwd : undefined,
    })
    const result = await mcpClientModule.probeServer(ctx, mcpClientModule.Config(input as never), {
      ...(options.timeoutMs === undefined ? {} : { timeoutMs: options.timeoutMs }),
      signal,
    })
    if (result.ok) return { ok: true, toolCount: result.toolNames.length }
    return { ok: false, toolCount: 0, error: result.message }
  }
}
