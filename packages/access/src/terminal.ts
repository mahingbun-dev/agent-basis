/**
 * P1-T4(2026-11-11):终端租户隔离——上游实例级 wrap(同协议替换件的简化形态)。
 *
 * 与隔离计划 T4 原案(整包替换 @eterna/terminal)的差异:T2 落地后 mux 调用已换血
 * (eterna-user principal),在服务入口按 invocation principal + 归属账本校验即可拦截
 * 跨用户终端访问,零协议面风险(客户端零改动);PTY 沙箱经 ctx.sandbox.confine 包装
 * spawnTerminal(bash-sandbox 同款 seam,landlock 写边界=账号根,由 T3 边界 wrap 钳定)。
 * 防漂移由 fixture 测试钉 8 方法名。
 *
 * 上游事实(2026-11-11 实核):
 * - 客户端每方法首参=sessionId(client.js:199/272/315,wire agentId)——攻击者可控;
 * - terminal/* 无 session 资源注册(agentId 不匹配 resolveSessionResource)→ T2 策略
 *   GLOBAL 放行 → 跨用户终端可达,必须在服务入口补租户校验;
 * - spawnTerminal 不经沙箱(subprocess-local lib/index.js:1618 直调 node-pty)→
 *   终端内 cd / 写 /tmp 本可成功,经 confine 后 landlock 写边界=账号根。
 */
export interface TerminalDeps {
  readonly sessionOwner: (sessionId: string) => number | undefined
  readonly accountOf: (userId: number) => string | undefined
}

/** 上游 8 方法(防漂移:tests/terminal-drift.spec.ts 与 typert.host.js 方法表对账)。 */
export const TERMINAL_METHODS: readonly string[] = [
  'environment', 'shells', 'list', 'create', 'close', 'rename', 'attach', 'retain',
] as const

interface InvocationLike {
  readonly principal?: { readonly kind?: string; readonly userId?: number }
}

interface TerminalServiceLike {
  readonly ctx?: { readonly invocation?: InvocationLike }
  readonly [method: string]: unknown
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
    const bound = (original as (...args: unknown[]) => unknown).bind(terminalService)
    originals.set(method, original)
    const guarded = (...args: unknown[]): unknown => {
      const principal = terminalService.ctx?.invocation?.principal
      if (principal?.kind === 'eterna-user' && typeof principal.userId === 'number') {
        const sessionId = sessionIdOf(args)
        const ownerId = sessionId === undefined ? undefined : deps.sessionOwner(sessionId)
        if (ownerId !== principal.userId) throw tenantDenied()
      }
      return bound(...args)
    }
    ;(terminalService as Record<string, unknown>)[method] = guarded
    wrapped.push(() => { (terminalService as Record<string, unknown>)[method] = original })
  }
  return () => {
    for (const restore of wrapped) restore()
    void originals
  }
}

interface SandboxLike {
  confine?: (argv: readonly string[], policy: unknown, signal?: AbortSignal) => Promise<{ argv: readonly string[] }>
}

interface SandboxPolicyLike {
  resolve?: (request?: unknown) => unknown
}

interface SpawnTerminalSpec {
  readonly argv?: readonly string[]
  readonly env?: { readonly DSH_SESSION_ID?: string }
}

interface SubprocessLike {
  spawnTerminal?: (spec: unknown) => Promise<unknown>
}

/**
 * PTY 沙箱包装:spawnTerminal 的 argv 经 ctx.sandbox.confine(bash-sandbox 同款 seam),
 * policy=sandboxPolicy.resolve({session})——T3 边界 wrap 已把 workspaceRoot 钳到账号根,
 * 故终端 shell 的 landlock 写边界=账号根;read-only 档随预设降级。
 * 沙箱服务缺席/unusable 时 confine 抛错 → 上游 fail-closed(创建终端报错,不裸奔)。
 */
export function installTerminalSandbox(
  sandbox: SandboxLike | undefined,
  sandboxPolicy: SandboxPolicyLike | undefined,
  subprocess: SubprocessLike | undefined,
): (() => void) | undefined {
  if (sandbox === undefined || typeof sandbox.confine !== 'function') return undefined
  if (sandboxPolicy === undefined || typeof sandboxPolicy.resolve !== 'function') return undefined
  if (subprocess === undefined || typeof subprocess.spawnTerminal !== 'function') return undefined
  const resolveFn = sandboxPolicy.resolve
  const original = subprocess.spawnTerminal.bind(subprocess)
  const wrapped = async (spec: unknown): Promise<unknown> => {
    const s = spec as SpawnTerminalSpec
    const sessionId = s.env?.DSH_SESSION_ID
    const argv = s.argv
    if (sessionId === undefined || argv === undefined || argv.length === 0) return original(spec)
    const policy = resolveFn.call(sandboxPolicy, { session: { id: sessionId } })
    if (policy === null || typeof policy !== 'object') return original(spec)
    const confineFn = sandbox.confine
    if (typeof confineFn !== 'function') return original(spec)
    const confined = await confineFn.call(sandbox, argv, policy)
    const confinedArgv = (confined as { argv?: readonly string[] } | undefined)?.argv
    if (confinedArgv === undefined || confinedArgv.length === 0) return original(spec)
    return original({ ...(spec as Record<string, unknown>), argv: confinedArgv })
  }
  ;(subprocess as Record<string, unknown>).spawnTerminal = wrapped
  return () => { (subprocess as Record<string, unknown>).spawnTerminal = original }
}
