/**
 * P1-T4(2026-11-11):终端租户校验 + PTY 沙箱包装 + 方法名防漂移。
 */
import { mkdtempSync, readFileSync, rmSync, existsSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { installTerminalTenant, installTerminalSandbox, TERMINAL_METHODS } from '../src/terminal.ts'
import { UserStore } from '../src/store.ts'

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
    }
    return { svc, calls }
  }

  it('eterna-user 访问归属会话 → 放行;他人会话 → terminal/tenant-denied(8 方法)', () => {
    const { svc, calls } = fakeService({ kind: 'eterna-user', userId: aliceId })
    const dispose = installTerminalTenant(deps, svc)
    expect(dispose).toBeDefined()
    for (const m of TERMINAL_METHODS) {
      const fn = (svc as unknown as Record<string, ((...args: unknown[]) => unknown) | undefined>)[m]
      if (fn === undefined) throw new Error(`${m} missing`)
      if (m === 'list') fn(aliceSession)
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

  it('防漂移:TERMINAL_METHODS 与上游 typert.host 方法表一致(差集=∅)', () => {
    const upstream = upstreamTerminalMethods()
    expect(upstream.length).toBeGreaterThanOrEqual(8)
    expect([...TERMINAL_METHODS].sort()).toEqual(upstream)
  })
})

describe('T4:PTY 沙箱包装', () => {
  it('spawnTerminal argv 经 sandbox.confine 包装;无 DSH_SESSION_ID 原样;confine 缺席原样', async () => {
    const confine = vi.fn(async (argv: readonly string[]) => ({ argv: ['/launcher', ...argv] }))
    const resolve = vi.fn(() => ({ mode: 'workspace-write', workspaceRoot: '/data/workspaces/alice' }))
    const spawnTerminal = vi.fn(async (spec: unknown) => spec)
    const subprocess = { spawnTerminal }
    const dispose = installTerminalSandbox(
      { confine },
      { resolve },
      subprocess,
    )
    expect(dispose).toBeDefined()
    // 带 sessionId → confine
    await subprocess.spawnTerminal({ argv: ['/bin/bash', '--login'], env: { DSH_SESSION_ID: 's1' }, cwd: '/x' })
    expect(confine).toHaveBeenCalledWith(['/bin/bash', '--login'], expect.objectContaining({ mode: 'workspace-write' }))
    expect(spawnTerminal).toHaveBeenCalledWith(expect.objectContaining({ argv: ['/launcher', '/bin/bash', '--login'] }))
    // 无 sessionId → 原样
    await subprocess.spawnTerminal({ argv: ['/bin/sh'] })
    expect(confine).toHaveBeenCalledTimes(1)
    // resolve 返回非对象 → 原样
    ;(resolve as ReturnType<typeof vi.fn>).mockReturnValueOnce(undefined)
    await subprocess.spawnTerminal({ argv: ['/bin/sh'], env: { DSH_SESSION_ID: 's2' } })
    expect(confine).toHaveBeenCalledTimes(1)
    dispose?.()
    // dispose 后不再包装
    await subprocess.spawnTerminal({ argv: ['/bin/sh'], env: { DSH_SESSION_ID: 's3' } })
    expect(confine).toHaveBeenCalledTimes(1)
  })
})
