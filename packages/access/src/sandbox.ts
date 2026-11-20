/**
 * P1-T3(2026-11-11):沙箱写边界钉死=账号目录 + 工具参数逃逸钳制。
 *
 * 背景(隔离计划 §6.3):上游沙箱可写边界=session cwd(dsh-sandbox-policy lib/index.js:170),
 * 而 working_directory 可把 cwd 挪到任意目录(只 stat 无校验)→ 边界跟着漂移;danger-full-access
 * 预设 + ui-permission 未裁 → 用户自助切档后写全宿主(多用户共享一个 OS 用户=跨租户互写)。
 *
 * 三层防线:
 * 1. resolve wrap:ctx.sandboxPolicy.resolve 的 workspaceRoot 若越出会话归属账号根 →
 *    钳回账号根(sandboxPolicy 经 reflect 可得,惰性安装同 mux)。
 * 2. 权限档裁剪:profile patch 覆写 `permission` 行只留 read-only/workspace-write +
 *    `ui-permission` 行 disabled(docker/profile/cordis.patch.yml.template,本文件不承载)。
 * 3. pre-execute 钳制:working_directory(cd)/bash(workdir)/write/edit(file_path) 的
 *    绝对路径参数必须 withinRoot(会话归属账号根),realpath 后比对(沿 T1 withinRoot)。
 */
import { userRootFor } from './tenant.ts'
import { withinRoot } from './within-root.ts'

export interface SandboxDeps {
  readonly sessionOwner: (sessionId: string) => number | undefined
  readonly accountOf: (userId: number) => string | undefined
  readonly tenantRoot: string
}

interface ServiceHandle {
  resolve?: (request?: unknown) => unknown
  on?: never
}

interface ToolExecLike {
  readonly name: string
  readonly arguments?: unknown
  readonly agent?: { readonly session?: { readonly id?: string } }
}

export type PreExecDecision = { kind: 'deny'; reason: string } | { kind: 'allow' }
export type PreExecNext = () => Promise<PreExecDecision>

/** 提取一个工具调用的全部路径参数(按 T3 钳制清单;相对路径交给沙箱边界,不在此拒)。 */
export function extractClampPaths(tool: string, args: unknown): string[] {
  if (args === undefined || args === null || typeof args !== 'object') return []
  const a = args as Record<string, unknown>
  const abs = (v: unknown): string | undefined =>
    typeof v === 'string' && v.startsWith('/') ? v : undefined
  switch (tool) {
    case 'working_directory': {
      const p = abs(a.cd)
      return p === undefined ? [] : [p]
    }
    case 'bash': {
      const p = abs(a.workdir)
      return p === undefined ? [] : [p]
    }
    case 'write':
    case 'edit': {
      const p = abs(a.file_path)
      return p === undefined ? [] : [p]
    }
    default:
      return []
  }
}

/** 3. pre-execute 钳制监听(返回 disposer)。 */
export function installToolClamp(
  deps: SandboxDeps,
  on: (event: 'tools/pre-execute', listener: (exec: ToolExecLike, next: PreExecNext) => Promise<PreExecDecision>) => () => void,
  audit: (detail: Record<string, unknown>) => void,
): () => void {
  return on('tools/pre-execute', async (exec, next) => {
    const sessionId = exec.agent?.session?.id
    const ownerId = sessionId === undefined ? undefined : deps.sessionOwner(sessionId)
    if (ownerId === undefined) return next()
    const account = deps.accountOf(ownerId)
    if (account === undefined) return next()
    const root = userRootFor(deps.tenantRoot, account)
    for (const p of extractClampPaths(exec.name, exec.arguments)) {
      if (!withinRoot(p, root)) {
        audit({ tool: exec.name, path: p, decision: 'deny' })
        return { kind: 'deny', reason: `路径必须在你的目录 ${root} 之内（${exec.name}）` }
      }
    }
    return next()
  })
}

/** 1. resolve wrap(返回 disposer;sandboxPolicy 服务缺席返回 undefined)。 */
export function installSandboxBoundary(
  deps: SandboxDeps,
  sandboxPolicy: ServiceHandle | undefined,
): (() => void) | undefined {
  if (sandboxPolicy === undefined || typeof sandboxPolicy.resolve !== 'function') return undefined
  const original = sandboxPolicy.resolve.bind(sandboxPolicy)
  // 活会话判定:上游 resolve 会读 session.header 并做 projection 快照
  // (sandboxPolicy.overrideOf → sessionProjections.cellFor → session.snapshotEvents),
  // 只带 {id} 的伪会话会 TypeError(TERM-006 实证)。防御面:伪会话先剥掉再
  // resolve,归属仍按 id 从账本解析,workspaceRoot 直接钳到账号根。
  const liveSession = (value: unknown): boolean => {
    if (typeof value !== 'object' || value === null) return false
    const s = value as { snapshotEvents?: unknown }
    return typeof s.snapshotEvents === 'function'
  }
  const wrapped = (request?: unknown): unknown => {
    const requestRecord = request as { session?: { id?: string } } | undefined
    // 边界面对的是运行期任意值：类型上 session 可空，调用方也可能真传 null。
    const session = requestRecord?.session as { id?: string } | null | undefined
    const synthetic = session !== undefined && session !== null && typeof session === 'object' && !liveSession(session)
    const sessionId = synthetic ? session.id : session?.id
    // 伪会话 → 以无 session 形态解析(默认 mode + 配置根),随后强制钳到账号根
    const effective = synthetic ? { ...(requestRecord ?? {}), session: undefined } : request
    const resolved: unknown = original(effective)
    if (resolved === null || typeof resolved !== 'object') return resolved
    const shape = resolved as { workspaceRoot?: unknown; sessionId?: unknown }
    const resolvedSessionId = typeof shape.sessionId === 'string' ? shape.sessionId : sessionId
    const ownerId = resolvedSessionId === undefined ? undefined : deps.sessionOwner(resolvedSessionId)
    const account = ownerId === undefined ? undefined : deps.accountOf(ownerId)
    if (account === undefined) return resolved
    const root = userRootFor(deps.tenantRoot, account)
    // 伪会话无真实 cwd/档位可读:直接落账号根(不可越界)
    if (synthetic) return { ...resolved, workspaceRoot: root, ...(resolvedSessionId === undefined ? {} : { sessionId: resolvedSessionId }) }
    const boundary = typeof shape.workspaceRoot === 'string' ? shape.workspaceRoot : undefined
    // 边界越出账号根 → 钳回;边界在账号根内(session cwd 归属目录) → 保持
    if (boundary !== undefined && !withinRoot(boundary, root)) {
      return { ...resolved, workspaceRoot: root }
    }
    return resolved
  }
  ;(sandboxPolicy as { resolve: unknown }).resolve = wrapped
  return () => {
    ;(sandboxPolicy as { resolve: unknown }).resolve = original
  }
}
