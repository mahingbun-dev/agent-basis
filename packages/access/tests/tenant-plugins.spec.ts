/**
 * T6 装载器单测(2026-11-18):装载契约 fail-closed 矩阵/受限 ctx(命名空间+
 * when 归属可见性)/生命周期(mount-unmount-bootScan)/撞名拒绝。
 * 真文件夹具(动态 import 走真实 Node ESM 管线);tools 服务用记录器假件。
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createTenantPluginLoader, type TenantPluginToolsFace, type TenantPluginWhen } from '../src/tenant-plugins.ts'

/** 真实工具插件夹具:package.json(main+type module)+ index.js(apply 内注册工具)。 */
function writeToolPlugin(dir: string, toolName: string, body = ''): string {
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: `fixture-${toolName}`, version: '0.0.0', type: 'module', main: 'index.js' }))
  writeFileSync(join(dir, 'index.js'), [
    'export const inject = ["tools"]',
    'export function apply(ctx) {',
    '  ctx.tools.register({',
    `    name: ${JSON.stringify(toolName)},`,
    '    description: "fixture tool",',
    '    parameters: {},',
    '    output: { schema: { type: "string" }, render: (_a, v) => [{ type: "text", text: String(v) }] },',
    '    execute() { return "ok" },',
    '  })',
    body,
    '}',
  ].join('\n'))
  return dir
}

function writeManifestOnly(dir: string, manifest: Record<string, unknown>): string {
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'fixture-x', version: '0.0.0', ...manifest }))
  return dir
}

/** tools 记录器假件:登记名+when 存档;disposer 标记注销。 */
interface RecordedTool {
  name: string
  when: TenantPluginWhen | undefined
  disposed: boolean
}
function recorderTools(): { face: TenantPluginToolsFace; registered: RecordedTool[] } {
  const registered: RecordedTool[] = []
  return {
    registered,
    face: {
      register(definition, options) {
        const row = { name: String(definition.name), when: options?.when, disposed: false }
        registered.push(row)
        return () => { row.disposed = true }
      },
    },
  }
}

describe('T6 装载器:契约 fail-closed', () => {
  let dir: string
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'eterna-tpl-')) })
  afterEach(() => { rmSync(dir, { recursive: true, force: true }) })

  function mkLoader(): ReturnType<typeof createTenantPluginLoader> {
    const { face } = recorderTools()
    return createTenantPluginLoader({
      store: { allEnabledUserPlugins: () => [], sharedPlugins: () => [], getUserById: () => undefined },
      sessionOwnerOf: () => undefined,
      readTools: () => face,
      audit: () => {},
    })
  }

  it('缺 package.json / 入口缺失 / main 非 JS / UI manifest / bundle manifest 全部拒载', async () => {
    const loader = mkLoader()
    const noManifest = join(dir, 'p1'); mkdirSync(noManifest)
    expect((await loader.mount('x1', { dir: noManifest })).ok).toBe(false)
    const noEntry = writeManifestOnly(join(dir, 'p2'), { main: 'index.js' })
    const r2 = await loader.mount('x2', { dir: noEntry })
    expect(r2.ok).toBe(false); expect(r2.error).toContain('入口文件不存在')
    const tsMain = writeManifestOnly(join(dir, 'p3'), { main: 'index.ts' })
    const r3 = await loader.mount('x3', { dir: tsMain })
    expect(r3.ok).toBe(false); expect(r3.error).toContain('纯 JS')
    const ui = writeManifestOnly(join(dir, 'p4'), { dsh: { client: { platform: 'web' } } })
    const r4 = await loader.mount('x4', { dir: ui })
    expect(r4.ok).toBe(false); expect(r4.error).toContain('dsh.client')
    const bundle = writeManifestOnly(join(dir, 'p5'), { dsh: { bundle: { patch: './cordis.patch.yml' } } })
    const r5 = await loader.mount('x5', { dir: bundle })
    expect(r5.ok).toBe(false); expect(r5.error).toContain('dsh.bundle')
    const noApply = join(dir, 'p6'); mkdirSync(noApply)
    writeFileSync(join(noApply, 'package.json'), JSON.stringify({ name: 'f', type: 'module', main: 'index.js' }))
    writeFileSync(join(noApply, 'index.js'), 'export const value = 1')
    const r6 = await loader.mount('x6', { dir: noApply })
    expect(r6.ok).toBe(false); expect(r6.error).toContain('apply')
  })

  it('inject 越权拒载(仅允许缺省或 [tools])', async () => {
    const loader = mkLoader()
    const bad = join(dir, 'bad'); mkdirSync(bad)
    writeFileSync(join(bad, 'package.json'), JSON.stringify({ name: 'f', type: 'module', main: 'index.js' }))
    writeFileSync(join(bad, 'index.js'), 'export const inject = ["tools", "webServer"]\nexport function apply() {}')
    const r = await loader.mount('xb', { dir: bad })
    expect(r.ok).toBe(false); expect(r.error).toContain('inject 越权')
  })

  it('tools 服务未就绪 = 装载器惰性(明确报错不炸)', async () => {
    const loader = createTenantPluginLoader({
      store: { allEnabledUserPlugins: () => [], sharedPlugins: () => [], getUserById: () => undefined },
      sessionOwnerOf: () => undefined,
      readTools: () => undefined,
      audit: () => {},
    })
    const plugin = writeToolPlugin(join(dir, 'hello'), 'greet')
    const r = await loader.mount('x', { dir: plugin })
    expect(r.ok).toBe(false); expect(r.error).toContain('未就绪')
    await expect(loader.bootScan()).resolves.toBeUndefined()
  })
})

describe('T6 装载器:受限 ctx 与生命周期', () => {
  let dir: string
  let registered: Array<{ name: string; when: TenantPluginWhen | undefined; disposed: boolean }>
  let owners: Map<string, number>
  let loader: ReturnType<typeof createTenantPluginLoader>

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'eterna-tpl2-'))
    owners = new Map()
    const rec = recorderTools()
    registered = rec.registered
    loader = createTenantPluginLoader({
      store: {
        allEnabledUserPlugins: () => [],
        sharedPlugins: () => [],
        getUserById: id => (id === 1
          ? { id: 1, account: 'alice', nickname: 'alice', role: 'user' as const, passwordVersion: 1 }
          : id === 2
            ? { id: 2, account: 'bob', nickname: 'bob', role: 'user' as const, passwordVersion: 1 }
            : undefined),
      },
      sessionOwnerOf: sessionId => owners.get(sessionId),
      readTools: () => rec.face,
      audit: () => {},
    })
  })
  afterEach(() => { loader.dispose(); rmSync(dir, { recursive: true, force: true }) })

  it('正常 mount:工具名命名空间 user_<账号>_<原名>;when 按归属过滤', async () => {
    const plugin = writeToolPlugin(join(dir, 'hello'), 'greet')
    const r = await loader.mount('user:alice:hello', { dir: plugin, ownerUserId: 1 })
    expect(r.ok).toBe(true)
    expect(r.tools).toEqual(['user_alice_greet'])
    const when = registered[0]?.when
    expect(when).toBeDefined()
    // 未登记归属 = 不可见(fail-closed),登记后本人会话可见(session.id 与 agent.id 两条取径)
    expect(when?.({ agent: { session: { id: 's-owner' } } })).toBe(false)
    owners.set('s-owner', 1)
    expect(when?.({ agent: { session: { id: 's-owner' } } })).toBe(true)
    expect(when?.({ agent: { id: 's-owner' } })).toBe(true)
    // 他人会话/无主/缺 agent 不可见(fail-closed)
    owners.set('s-other', 2)
    expect(when?.({ agent: { session: { id: 's-other' } } })).toBe(false)
    expect(when?.({ agent: { session: { id: 's-unknown' } } })).toBe(false)
    expect(when?.({})).toBe(false)
    // 共享 mount(无 owner)= 恒可见(when 缺省);命名空间段取 plugin_id 账号段
    const shared = writeToolPlugin(join(dir, 'shared'), 'wave')
    const rs = await loader.mount('user:alice:shared', { dir: shared })
    expect(rs.ok).toBe(true)
    expect(rs.tools).toEqual(['user_alice_wave'])
    expect(registered[1]?.when).toBeUndefined()
  })

  it('unmount 回收:disposer 执行、名字释放、再装不撞名', async () => {
    const plugin = writeToolPlugin(join(dir, 'hello'), 'greet')
    await loader.mount('user:alice:hello', { dir: plugin, ownerUserId: 1 })
    expect(registered[0]?.disposed).toBe(false)
    loader.unmount('user:alice:hello')
    expect(registered[0]?.disposed).toBe(true)
    const again = await loader.mount('user:alice:hello', { dir: plugin, ownerUserId: 1 })
    expect(again.ok).toBe(true)
    expect(again.tools).toEqual(['user_alice_greet'])
  })

  it('同账号两插件同名工具 = 撞名拒载;卸载前者后可装', async () => {
    const a = writeToolPlugin(join(dir, 'a'), 'greet')
    const b = writeToolPlugin(join(dir, 'b'), 'greet')
    const ra = await loader.mount('user:alice:a', { dir: a, ownerUserId: 1 })
    expect(ra.ok).toBe(true)
    const rb = await loader.mount('user:alice:b', { dir: b, ownerUserId: 1 })
    expect(rb.ok).toBe(false); expect(rb.error).toContain('撞名')
    expect(loader.stateOf('user:alice:b').mounted).toBe(false)
    loader.unmount('user:alice:a')
    const rb2 = await loader.mount('user:alice:b', { dir: b, ownerUserId: 1 })
    expect(rb2.ok).toBe(true)
  })

  it('apply 抛错 = mount 拒载且零残留(已注册工具回收)', async () => {
    const broken = writeToolPlugin(join(dir, 'broken'), 'greet', '  throw new Error("boom")')
    const r = await loader.mount('user:alice:broken', { dir: broken, ownerUserId: 1 })
    expect(r.ok).toBe(false); expect(r.error).toContain('boom')
    expect(registered.every(t => t.disposed)).toBe(true)
    expect(loader.stateOf('user:alice:broken').mounted).toBe(false)
  })

  it('bootScan:个人 enabled 行按 owner 挂、共享 enabled 行全局挂;单插件失败不炸', async () => {
    const good = writeToolPlugin(join(dir, 'good'), 'greet')
    const bad = join(dir, 'bad'); mkdirSync(bad)
    const scanLoader = createTenantPluginLoader({
      store: {
        allEnabledUserPlugins: () => [{ pluginId: 'user:alice:good', dir: good, userId: 1 }, { pluginId: 'user:alice:bad', dir: bad, userId: 1 }],
        sharedPlugins: () => [{ pluginId: 'user:alice:good', dir: good, enabled: true }],
        getUserById: id => (id === 1 ? { id: 1, account: 'alice', nickname: 'alice', role: 'user' as const, passwordVersion: 1 } : undefined),
      },
      sessionOwnerOf: () => undefined,
      readTools: () => recorderTools().face,
      audit: () => {},
    })
    await expect(scanLoader.bootScan()).resolves.toBeUndefined()
    expect(scanLoader.stateOf('user:alice:good').mounted).toBe(true)
    expect(scanLoader.stateOf('user:alice:bad').mounted).toBe(false)
    scanLoader.dispose()
  })

  it('工具名非法(宿主保留字符)拒载', async () => {
    const weird = join(dir, 'weird'); mkdirSync(weird)
    writeFileSync(join(weird, 'package.json'), JSON.stringify({ name: 'f', type: 'module', main: 'index.js' }))
    writeFileSync(join(weird, 'index.js'), 'export function apply(ctx) { ctx.tools.register({ name: "bad name!", execute() {} }) }')
    const r = await loader.mount('user:alice:weird', { dir: weird, ownerUserId: 1 })
    expect(r.ok).toBe(false); expect(r.error).toContain('工具名非法')
  })
})
