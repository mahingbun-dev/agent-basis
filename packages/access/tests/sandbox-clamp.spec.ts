/**
 * P1-T3 单测:工具参数钳制路径提取 + 沙箱边界 wrap 语义。
 */
import { mkdtempSync, mkdirSync, rmSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { extractClampPaths, installSandboxBoundary, installToolClamp, type SandboxDeps } from '../src/sandbox.ts'
import { UserStore } from '../src/store.ts'

describe('T3:extractClampPaths', () => {
  it('working_directory.cd 绝对路径提取;相对路径不提取(归沙箱边界管)', () => {
    expect(extractClampPaths('working_directory', { cd: '/var' })).toEqual(['/var'])
    expect(extractClampPaths('working_directory', { cd: 'relative/dir' })).toEqual([])
    expect(extractClampPaths('working_directory', {})).toEqual([])
  })
  it('bash.workdir 提取;无 workdir 空', () => {
    expect(extractClampPaths('bash', { command: 'ls', workdir: '/etc' })).toEqual(['/etc'])
    expect(extractClampPaths('bash', { command: 'ls' })).toEqual([])
  })
  it('write/edit.file_path 提取;其余工具空', () => {
    expect(extractClampPaths('write', { file_path: '/etc/passwd', content: 'x' })).toEqual(['/etc/passwd'])
    expect(extractClampPaths('edit', { file_path: '/tmp/a', old_string: 'a', new_string: 'b' })).toEqual(['/tmp/a'])
    expect(extractClampPaths('read', { file_path: '/etc/passwd' })).toEqual([])
    expect(extractClampPaths('bash', 'not-object')).toEqual([])
  })
})

describe('T3:installToolClamp', () => {
  let dir: string
  let store: UserStore
  let deps: SandboxDeps
  let aliceSessionId: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'eterna-clamp-'))
    store = new UserStore(join(dir, 'users.db'))
    const alice = store.createUserWithSuffix({ account: 'alice', password: 'password8' })
    aliceSessionId = 's-clamp'
    store.recordSession(aliceSessionId, alice.user.id, null)
    deps = {
      sessionOwner: id => store.sessionOwner(id),
      accountOf: id => store.getUserById(id)?.account,
      tenantRoot: join(dir, 'workspaces'),
    }
    mkdirSync(join(deps.tenantRoot, 'alice'), { recursive: true })
  })
  afterEach(() => {
    store.close()
    rmSync(dir, { recursive: true, force: true })
  })

  function makeOn() {
    const listeners: Array<(exec: never, next: never) => Promise<unknown>> = []
    const on = (_event: string, listener: never) => { listeners.push(listener); return () => {} }
    return { on, listeners: listeners as Array<(exec: { name: string; arguments?: unknown; agent?: { session?: { id?: string } } }, next: () => Promise<{ kind: 'allow' }>) => Promise<unknown>> }
  }

  it('越界 working_directory/bash/write → deny(中文文案);根内 → 放行;未归属会话放行', async () => {
    const { on, listeners } = makeOn()
    const audit = vi.fn()
    installToolClamp(deps, on as never, audit)
    const listener = listeners[0]
    if (listener === undefined) throw new Error('clamp listener missing')
    const next = async () => ({ kind: 'allow' as const })
    const root = join(deps.tenantRoot, 'alice')
    const deny1 = await listener({ name: 'working_directory', arguments: { cd: '/var' }, agent: { session: { id: aliceSessionId } } }, next)
    expect(deny1).toMatchObject({ kind: 'deny' })
    expect((deny1 as { reason: string }).reason).toContain('必须在你的目录')
    const deny2 = await listener({ name: 'bash', arguments: { command: 'ls', workdir: '/etc' }, agent: { session: { id: aliceSessionId } } }, next)
    expect(deny2).toMatchObject({ kind: 'deny' })
    const deny3 = await listener({ name: 'write', arguments: { file_path: '/etc/passwd' }, agent: { session: { id: aliceSessionId } } }, next)
    expect(deny3).toMatchObject({ kind: 'deny' })
    const ok1 = await listener({ name: 'write', arguments: { file_path: join(root, 'ok.txt') }, agent: { session: { id: aliceSessionId } } }, next)
    expect(ok1).toEqual({ kind: 'allow' })
    const ok2 = await listener({ name: 'bash', arguments: { command: 'x', workdir: '/somewhere' }, agent: { session: { id: 's-unknown' } } }, next)
    expect(ok2).toEqual({ kind: 'allow' })
    expect(audit).toHaveBeenCalledTimes(3)
  })

  it('根内 symlink 指根外 → deny(realpath 实解析)', async () => {
    const { on, listeners } = makeOn()
    installToolClamp(deps, on as never, vi.fn())
    const listener = listeners[0]
    if (listener === undefined) throw new Error('clamp listener missing')
    const next = async () => ({ kind: 'allow' as const })
    const root = join(deps.tenantRoot, 'alice')
    const outside = join(dir, 'outside')
    mkdirSync(outside, { recursive: true })
    symlinkSync(outside, join(root, 'escape'))
    const r = await listener({ name: 'write', arguments: { file_path: join(root, 'escape', 'x.txt') }, agent: { session: { id: aliceSessionId } } }, next)
    expect(r).toMatchObject({ kind: 'deny' })
  })
})

describe('T3:installSandboxBoundary', () => {
  let dir: string
  let store: UserStore
  let deps: SandboxDeps

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'eterna-boundary-'))
    store = new UserStore(join(dir, 'users.db'))
    const alice = store.createUserWithSuffix({ account: 'alice', password: 'password8' })
    store.recordSession('s-b1', alice.user.id, null)
    deps = {
      sessionOwner: id => store.sessionOwner(id),
      accountOf: id => store.getUserById(id)?.account,
      tenantRoot: join(dir, 'workspaces'),
    }
    mkdirSync(join(deps.tenantRoot, 'alice'), { recursive: true })
  })
  afterEach(() => {
    store.close()
    rmSync(dir, { recursive: true, force: true })
  })

  it('边界越出账号根 → 钳回账号根;边界在根内 → 保持;未归属 → 原样', () => {
    const original = vi.fn((request?: unknown) => ({
      mode: 'workspace-write',
      workspaceRoot: (request as { session?: { header?: { cwd?: string } } })?.session?.header?.cwd ?? '/data',
      sessionId: (request as { session?: { id?: string } })?.session?.id,
    }))
    const svc = { resolve: original }
    const dispose = installSandboxBoundary(deps, svc)
    expect(dispose).toBeDefined()
    const root = join(deps.tenantRoot, 'alice')
    // cwd 漂移到根外 → 钳回账号根
    const drifted = (svc.resolve as (r?: unknown) => { workspaceRoot: string })({ session: { id: 's-b1', header: { cwd: '/var' } } })
    expect(drifted.workspaceRoot).toBe(root)
    // cwd 在账号根内 → 保持
    const inside = (svc.resolve as (r?: unknown) => { workspaceRoot: string })({ session: { id: 's-b1', header: { cwd: join(root, 'proj') } } })
    expect(inside.workspaceRoot).toBe(join(root, 'proj'))
    // 未归属会话 → 原样
    const orphan = (svc.resolve as (r?: unknown) => { workspaceRoot: string })({ session: { id: 's-none', header: { cwd: '/var' } } })
    expect(orphan.workspaceRoot).toBe('/var')
    dispose?.()
    // 行为断言:dispose 后不再钳回(漂移边界原样返回)
    const after = (svc.resolve as (r?: unknown) => { workspaceRoot: string })({ session: { id: 's-b1', header: { cwd: '/var' } } })
    expect(after.workspaceRoot).toBe('/var')
  })
})
