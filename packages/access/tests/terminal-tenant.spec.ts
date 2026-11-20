/**
 * P1-T4(2026-11-11):终端租户校验 + PTY 沙箱包装 + 方法名防漂移。
 */
import { mkdtempSync, readFileSync, rmSync, existsSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { installTerminalTenant, TERMINAL_METHODS } from '../src/terminal.ts'
import { UserStore } from '../src/store.ts'

/** 上游 dsh-terminal-bash lib/index.js(读实库,TERM-006 修复锚)。 */
function upstreamTerminalBashSource(): string {
  let dir = new URL('..', import.meta.url).pathname
  for (let i = 0; i < 6; i++) {
    const candidate = join(dir, 'node_modules', '.pnpm')
    if (existsSync(candidate)) {
      for (const entry of readdirSync(candidate, { withFileTypes: true })) {
        if (!/^@deepseek-ai\+dsh-terminal-bash@/.test(entry.name)) continue
        const file = join(candidate, entry.name, 'node_modules', '@deepseek-ai', 'dsh-terminal-bash', 'lib', 'index.js')
        if (existsSync(file)) return readFileSync(file, 'utf8')
      }
    }
    dir = join(dir, '..')
  }
  throw new Error('找不到 dsh-terminal-bash lib/index.js')
}

/** 上游 typert.host.js 的 terminalController 方法表(读实库,防漂移)。 */
function upstreamTerminalMethods(): string[] {
  let dir = new URL('..', import.meta.url).pathname
  let root = ''
  for (let i = 0; i < 6; i++) {
    const candidate = join(dir, 'node_modules', '.pnpm')
    if (existsSync(candidate)) { root = candidate; break }
    dir = join(dir, '..')
  }
  if (root === '') throw new Error('找不到 .pnpm')
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const m = /^@deepseek-ai\+([a-z-]+)@/.exec(entry.name)
    if (m?.[1] !== 'dsh-api-terminal-controller') continue
    const host = join(root, entry.name, 'node_modules', '@deepseek-ai', m[1], 'lib', 'typert.host.js')
    if (!existsSync(host)) continue
    const text = readFileSync(host, 'utf8')
    return [...text.matchAll(/'terminal\/([a-zA-Z]+)': \{/g)].map(x => x[1] ?? '').sort()
  }
  throw new Error('找不到 terminal typert.host.js')
}

describe('T4:终端租户校验', () => {
  let dir: string
  let store: UserStore
  let deps: { sessionOwner: (id: string) => number | undefined; accountOf: (id: number) => string | undefined }
  let aliceId: number
  let aliceSession: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'eterna-term-'))
    store = new UserStore(join(dir, 'users.db'))
    const alice = store.createUserWithSuffix({ account: 'alice', password: 'password8' })
    aliceId = alice.user.id
    aliceSession = 's-term-a'
    store.recordSession(aliceSession, aliceId, null)
    deps = {
      sessionOwner: id => store.sessionOwner(id),
      accountOf: id => store.getUserById(id)?.account,
    }
  })
  afterEach(() => { store.close(); rmSync(dir, { recursive: true, force: true }) })

  function fakeService(principal: { readonly kind?: string; readonly userId?: number } | undefined) {
    const calls: string[] = []
    const svc = {
      ctx: { invocation: principal === undefined ? {} : { principal } },
      environment: vi.fn(() => { calls.push('environment'); return { cwd: '/' } }),
      shells: vi.fn(() => { calls.push('shells'); return [] }),
      list: vi.fn(() => { calls.push('list'); return [] }),
      create: vi.fn(() => { calls.push('create'); return {} }),
      close: vi.fn(() => { calls.push('close'); return {} }),
      rename: vi.fn(() => { calls.push('rename'); return {} }),
      attach: vi.fn(() => { calls.push('attach'); return {} }),
      retain: vi.fn(() => { calls.push('retain'); return {} }),
      watch: vi.fn(() => { calls.push('watch'); return {} }),
    }
    return { svc, calls }
  }

  it('eterna-user 访问归属会话 → 放行;他人会话 → terminal/tenant-denied(9 方法)', () => {
    const { svc, calls } = fakeService({ kind: 'eterna-user', userId: aliceId })
    const dispose = installTerminalTenant(deps, svc)
    expect(dispose).toBeDefined()
    for (const m of TERMINAL_METHODS) {
      const fn = (svc as unknown as Record<string, ((...args: unknown[]) => unknown) | undefined>)[m]
      if (fn === undefined) throw new Error(`${m} missing`)
      if (m === 'list' || m === 'watch' || m === 'retain') fn(aliceSession)
      else fn({ session: { id: aliceSession } }, {})
      expect(calls).toContain(m)
    }
    // 他人会话
    const other = fakeService({ kind: 'eterna-user', userId: aliceId + 1 })
    installTerminalTenant(deps, other.svc)
    for (const m of TERMINAL_METHODS) {
      const fn = (other.svc as unknown as Record<string, ((...args: unknown[]) => unknown) | undefined>)[m]
      if (fn === undefined) throw new Error(`${m} missing`)
      expect(() => fn({ session: { id: aliceSession } }, {})).toThrow('终端不存在或不属于你的会话')
      expect(other.calls).toHaveLength(0)
    }
    dispose?.()
  })

  it('list(字符串首参)同样校验;owner Peer 原样放行', () => {
    const { svc, calls } = fakeService({ kind: 'eterna-user', userId: aliceId })
    installTerminalTenant(deps, svc)
    const listFn = (svc as unknown as Record<string, ((...args: unknown[]) => unknown) | undefined>).list
    if (listFn === undefined) throw new Error('list missing')
    listFn(aliceSession)
    expect(calls).toContain('list')
    const ownerSvc = fakeService({ kind: 'owner' })
    installTerminalTenant(deps, ownerSvc.svc)
    for (const m of TERMINAL_METHODS) {
      const fn = (ownerSvc.svc as unknown as Record<string, ((...args: unknown[]) => unknown) | undefined>)[m]
      if (fn === undefined) throw new Error(`${m} missing`)
      fn({ session: { id: 's-someone-else' } }, {})
    }
    expect(ownerSvc.calls).toHaveLength(TERMINAL_METHODS.length)
  })

  it('rc.5 身份形态:invocation.peer.principal 同样校验(旧 invocation.principal 恒 undefined 的回归锚)', () => {
    // 2026-11-20 W5 门禁 TERM-004 根因:rc.5 GatewayInvocation 只暴露 peer,
    // 旧读法 invocation.principal 恒 undefined → 他人会话不被拒(B 读到 A 的 cwd)。
    const rc5Service = (principal: { kind?: string; userId?: number }) => {
      const calls: string[] = []
      const svc = {
        ctx: { invocation: { peer: { principal } } },
        environment: vi.fn((_agent?: unknown, _request?: unknown) => { calls.push('environment'); return { cwd: '/' } }),
        shells: vi.fn((_agent?: unknown, _request?: unknown) => { calls.push('shells'); return [] }),
        list: vi.fn((_sessionId?: string) => { calls.push('list'); return [] }),
      }
      return { svc, calls }
    }
    const own = rc5Service({ kind: 'eterna-user', userId: aliceId })
    const disposeOwn = installTerminalTenant(deps, own.svc)
    const env = own.svc.environment
    env({ session: { id: aliceSession } }, {})
    expect(own.calls).toContain('environment')
    disposeOwn?.()

    const foreign = rc5Service({ kind: 'eterna-user', userId: aliceId + 1 })
    installTerminalTenant(deps, foreign.svc)
    expect(() => foreign.svc.environment({ session: { id: aliceSession } }, {})).toThrow('终端不存在或不属于你的会话')
    expect(foreign.calls).toHaveLength(0)

    expect(() => foreign.svc.list(aliceSession)).toThrow('终端不存在或不属于你的会话')
    expect(foreign.calls).toHaveLength(0)
  })

  it('调用点 this 透传:上游本体以网关 receiverContext 为 this 执行(流面 this.ctx.invocation 生命线)', () => {
    // bind 到服务实例会把 cordis ctx 追踪钉在装配侧上下文 → attach/retain 的
    // this.ctx.invocation 退化为 undefined("Terminal attachment requires a Remote
    // invocation")。本锚断言 this 原样传给上游本体。
    const seen: unknown[] = []
    const svc = {
      ctx: { invocation: { peer: { principal: { kind: 'eterna-user', userId: aliceId } } } },
      environment: function (this: unknown) { seen.push(this); return { cwd: '/' } },
    }
    installTerminalTenant(deps, svc)
    const callSite = { ctx: { invocation: { peer: { principal: { kind: 'eterna-user', userId: aliceId } } } }, marker: 'gateway-receiver' }
    // oxlint-disable-next-line typescript/unbound-method -- 故意取未绑定引用以验证 this 透传
    const fn = svc.environment as unknown as (this: unknown, ...args: unknown[]) => unknown
    Reflect.apply(fn, callSite, [{ session: { id: aliceSession } }, {}])
    expect(seen[0]).toBe(callSite)
  })

  it('防漂移:TERMINAL_METHODS 与上游 typert.host 方法表一致(差集=∅)', () => {
    const upstream = upstreamTerminalMethods()
    expect(upstream.length).toBeGreaterThanOrEqual(8)
    expect([...TERMINAL_METHODS].sort()).toEqual(upstream)
  })
})

describe('T4:PTY 沙箱(rc.5 上游内生)', () => {
  it('本层不再包装 subprocess.spawnTerminal(TERM-006 根因锚)', async () => {
    // rc.5 terminal-bash 后端在 spawn 内已用真实 session resolve 并在 spawnArgv
    // confine;旧 T4 wrapper 传伪 session {id} → session.snapshotEvents TypeError
    // (terminal/create 恒 gateway/internal)。移除后模块不再导出该函数。
    const terminalModule = await import('../src/terminal.ts')
    expect('installTerminalSandbox' in terminalModule).toBe(false)
    // 上游 spawn 路径仍在(terminal-bash/lib/index.js 的 resolve + spawnArgv)
    const source = upstreamTerminalBashSource()
    expect(source).toContain('this.ctx.sandboxPolicy.resolve({ session: spec.owner.session })')
    expect(source).toContain('await spawnArgv(this.ctx, this.config, policy, spec.signal)')
  })
})
