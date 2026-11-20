/**
 * P1-T4(2026-11-11):终端租户隔离——上游实例级 wrap(同协议替换件的简化形态)。
 *
 * 与隔离计划 T4 原案(整包替换 @eterna/terminal)的差异:T2 落地后 mux 调用已换血
 * (eterna-user principal),在服务入口按 invocation principal + 归属账本校验即可拦截
 * 跨用户终端访问,零协议面风险(客户端零改动);PTY 沙箱经 ctx.sandbox.confine 包装
 * spawnTerminal(bash-sandbox 同款 seam,landlock 写边界=账号根,由 T3 边界 wrap 钳定)。
 * 防漂移由 fixture 测试钉 9 方法名(rc.5 增 watch)。
 *
 * 上游事实(2026-11-11 实核;2026-11-20 rc.5 W5 门禁复核修订):
 * - 客户端每方法首参=sessionId(client.js:199/272/315,wire agentId)——攻击者可控;
 * - ~~terminal/* 无 session 资源注册~~ **rc.5 已不成立**:六方法的资源逐会话
 *   (agent lookup→session、list 具名 sessionId),网关对非 owner Peer 会 decide;
 *   但**身份面变了**:`ctx.invocation` 不再直挂 principal,而是 `invocation.peer.principal`
 *   (dsh-api-gateway lib/index.js 的 GatewayInvocation;typert-protocol
 *   principalOf=invocation?.peer.principal),旧读法恒 undefined=整条校验静默失效
 *   (TERM-004 跨租户读 cwd/shells 的根因)。另:`/api/terminal/*` 一元请求经
 *   connection.admit 恒 owner Peer,必须在 mux.ts 的 admit 包装换血成 eterna-user
 *   Peer 才能让本守卫拿到身份;
 * - spawnTerminal 不经沙箱(subprocess-local lib/index.js:1618 直调 node-pty)→
 *   终端内 cd / 写 /tmp 本可成功,经 confine 后 landlock 写边界=账号根。
 */
export interface TerminalDeps {
  readonly sessionOwner: (sessionId: string) => number | undefined
  readonly accountOf: (userId: number) => string | undefined
}

/** 上游 9 方法(rc.5;防漂移:tests/terminal-tenant.spec.ts 与 typert.host 方法表对账)。
 *  watch 是 rc.5 新增的会话级流(sessionId 具名参数),必须同时进 mux 会话流守卫。 */
export const TERMINAL_METHODS: readonly string[] = [
  'environment', 'shells', 'list', 'create', 'close', 'rename', 'attach', 'retain', 'watch',
] as const

interface InvocationLike {
  /** alpha.3 旧形态:principal 直挂 invocation。 */
  readonly principal?: { readonly kind?: string; readonly userId?: number }
  /** rc.5 形态:GatewayInvocation 只暴露 peer(dsh-api-gateway lib/index.js:1653-1662
   *  字段 request/service/peer/signal/uplink_;身份在 peer.principal,
   *  typert-protocol lib/index.js:294 principalOf = invocation?.peer.principal)。 */
  readonly peer?: { readonly principal?: { readonly kind?: string; readonly userId?: number } }
}

interface TerminalServiceLike {
  readonly ctx?: { readonly invocation?: InvocationLike }
  readonly [method: string]: unknown
  /**
   * cordis 服务经 ctx 追踪(tracker.associate=name):方法以调用方(网关
   * receiverContext,内含 invocation)上下文执行,故 `this.ctx.invocation`
   * 才是本次 Remote 调用的身份面(上游 terminal-controller lib/index.js:1316
   * 读法同构)。实例自身的 ctx 是定义侧上下文,恒无 invocation。
   */
}

interface TerminalRemoteErrorLike extends Error {
  readonly code?: string
}

function tenantDenied(): TerminalRemoteErrorLike {
  const error = new Error('终端不存在或不属于你的会话') as TerminalRemoteErrorLike & { code: string }
  error.code = 'terminal/tenant-denied'
  return error
}

/** 从方法参数提取 sessionId:list 首参是字符串;其余首参是 agent(带 .session.id)。 */
function sessionIdOf(args: readonly unknown[]): string | undefined {
  const first = args[0] as { session?: { id?: string } } | string | undefined
  if (typeof first === 'string') return first
  return first?.session?.id
}

/** 调用方身份面:rc.5 `invocation.peer.principal` 优先,alpha.3 `invocation.principal` 兜底。 */
function principalOf(invocation: InvocationLike | undefined): { readonly kind?: string; readonly userId?: number } | undefined {
  if (invocation === undefined) return undefined
  return invocation.peer?.principal ?? invocation.principal
}

/** 读 `this` 或服务实例上的 invocation(调用点上下文优先——见 TerminalServiceLike 注释)。 */
function invocationOf(holder: unknown, fallback: TerminalServiceLike): InvocationLike | undefined {
  const fromCallSite = (holder as { ctx?: { invocation?: InvocationLike } } | undefined)?.ctx?.invocation
  if (fromCallSite !== undefined) return fromCallSite
  return fallback.ctx?.invocation
}

/**
 * 服务入口租户校验:eterna-user principal 只能访问归属会话的终端。
 * owner Peer(本地流)与非 eterna principal 原样放行。返回 disposer。
 */
export function installTerminalTenant(
  deps: TerminalDeps,
  terminalService: TerminalServiceLike | undefined,
): (() => void) | undefined {
  if (terminalService === undefined) return undefined
  const originals = new Map<string, unknown>()
  const wrapped: Array<() => void> = []
  for (const method of TERMINAL_METHODS) {
    const original = terminalService[method]
    if (typeof original !== 'function') continue
    const target = original as (...args: unknown[]) => unknown
    originals.set(method, original)
    // 非箭头函数:网关以 receiverContext(内含 invocation)为 this 调用方法,
    // 身份面必须从调用点 this.ctx.invocation 读(实例自身 ctx 恒无 invocation)。
    // 同理,上游本体必须用**调用点的 this** 执行——bind 到服务实例会把 cordis 的
    // ctx 追踪钉在装配侧上下文,上游 `this.ctx.invocation`(attach/retain 的流面)
    // 将退化为 undefined("Terminal attachment requires a Remote invocation")。
    const guarded = function (this: unknown, ...args: unknown[]): unknown {
      const principal = principalOf(invocationOf(this, terminalService))
      if (principal?.kind === 'eterna-user' && typeof principal.userId === 'number') {
        const sessionId = sessionIdOf(args)
        const ownerId = sessionId === undefined ? undefined : deps.sessionOwner(sessionId)
        if (ownerId !== principal.userId) throw tenantDenied()
      }
      return Reflect.apply(target, this ?? terminalService, args)
    }
    ;(terminalService as Record<string, unknown>)[method] = guarded
    wrapped.push(() => { (terminalService as Record<string, unknown>)[method] = original })
  }
  return () => {
    for (const restore of wrapped) restore()
    void originals
  }
}

/**
 * PTY 沙箱(2026-11-20 W5 门禁修复 TERM-006):**无本地包装**,上游已自带。
 *
 * alpha.3 期 T4 在本层包装 `subprocess.spawnTerminal` 再 confine 一次;rc.5 的
 * `dsh-terminal-bash` 后端在 `BashTerminalBackend.spawn` 已用**真实 session**
 * 解析策略并 `spawnArgv` 内 confine(lib/index.js:1056-1068 + 970-979):
 *   `const policy = this.ctx.sandboxPolicy.resolve({ session: spec.owner.session })`
 *   `const argv = await spawnArgv(this.ctx, this.config, policy, spec.signal)`
 * 旧包装传的是伪 session `{id}`(只为拿 DSH_SESSION_ID),上游 `overrideOf` →
 * `sessionProjections.cellFor` 会调 `session.snapshotEvents()`,伪对象无此方法 →
 * `terminal/create` 恒 `gateway/internal: session.snapshotEvents is not a function`
 * (TERM-006/UI-006 根因);即便修好也会对已 confine 的 argv 二次 confine。
 * 写边界仍由 sandbox.ts 的 resolve wrap 钳到账号根;profile 固定 terminal-bash,
 * 该后端是唯一 spawn 入口,故本层不再包装。
 */
