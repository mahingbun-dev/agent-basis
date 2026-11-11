/**
 * T1(G4 修复):withinRoot symlink 越根矩阵——经 directoryPicker/list 守卫路由实测。
 * ≥5 例:根内 symlink→根外(拒)/根内 symlink→根内(放)/.. 串联(拒)/绝对路径逃逸(拒)/普通路径(放)。
 * realpath 双侧实解析:路径存在即解析,不存在退回 resolve 原判。
 */
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { SessionService } from '../src/session.ts'
import { UserStore } from '../src/store.ts'
import { registerTenantGuards, type TenantFetchRegistry } from '../src/tenant.ts'

describe('T1(G4):symlink 越根矩阵', () => {
  let dir: string
  let store: UserStore
  let session: SessionService
  let routes: Map<string, { fetch: (request: Request) => Promise<Response> }>
  let aliceId: number
  let root: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'eterna-symlink-'))
    store = new UserStore(join(dir, 'users.db'))
    routes = new Map()
    session = new SessionService(Buffer.from('tenant-secret-tenant-secret-000'))
    root = join(dir, 'workspaces')
    const alice = store.createUserWithSuffix({ account: 'alice', password: 'password8' })
    aliceId = alice.user.id
    // 夹具树:
    //   root/alice/{inside-a, inside-b}          用户根内真实目录
    //   root/alice/escape-link → dir/outside     根内 symlink 指根外(逃逸面)
    //   root/alice/link-to-b → root/alice/inside-b  根内 symlink 指根内(无害)
    //   dir/outside/{secret.txt}                 根外目标
    mkdirSync(join(root, 'alice', 'inside-a'), { recursive: true })
    mkdirSync(join(root, 'alice', 'inside-b'), { recursive: true })
    mkdirSync(join(dir, 'outside'), { recursive: true })
    writeFileSync(join(dir, 'outside', 'secret.txt'), 'x')
    symlinkSync(join(dir, 'outside'), join(root, 'alice', 'escape-link'))
    symlinkSync(join(root, 'alice', 'inside-b'), join(root, 'alice', 'link-to-b'))
    const reflect = { get: (key: string): unknown => (key === 'directoryPickerController' ? { list: () => ({ entries: [] }) } : undefined) }
    const registry: TenantFetchRegistry = { register: (route) => { routes.set(route.path, route); return () => Promise.resolve() } }
    registerTenantGuards({ store, session, reflect, tenantRoot: root, audit: () => {} }, { fetch: registry })
  })
  afterEach(() => {
    store.close()
    rmSync(dir, { recursive: true, force: true })
  })

  async function pickerList(path: string) {
    const handler = routes.get('/api/directoryPicker/list')
    if (handler === undefined) throw new Error('route missing')
    const cookie = `eterna_session=${session.issue({ userId: aliceId, passwordVersion: store.getUserById(aliceId)?.passwordVersion ?? 1 })}`
    const response = await handler.fetch(new Request('http://app.local/api/directoryPicker/list', {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ type: 'client-request', rpcId: 't1', method: 'directoryPicker/list', payload: { args: { path } } }),
    }))
    const result = JSON.parse(await response.text()) as Record<string, unknown>
    return result
  }

  it('根内 symlink 指向根外 → 拒绝(逃逸面被 realpath 解析识破)', async () => {
    const r = await pickerList(join(root, 'alice', 'escape-link'))
    expect(JSON.stringify(r)).toContain('tenant/denied')
  })
  it('根内 symlink 指向根内子目录 → 放行(无害别名)', async () => {
    const r = await pickerList(join(root, 'alice', 'link-to-b'))
    expect(JSON.stringify(r)).not.toContain('tenant/denied')
  })
  it('.. 串联逃逸 → 拒绝', async () => {
    const r = await pickerList(join(root, 'alice', '..', '..', 'outside'))
    expect(JSON.stringify(r)).toContain('tenant/denied')
  })
  it('绝对路径逃逸 → 拒绝', async () => {
    const r = await pickerList(join(dir, 'outside'))
    expect(JSON.stringify(r)).toContain('tenant/denied')
  })
  it('普通根内路径 → 放行(对照)', async () => {
    const r = await pickerList(join(root, 'alice', 'inside-a'))
    expect(JSON.stringify(r)).not.toContain('tenant/denied')
  })
  it('不存在的根内路径仍按 resolve 判定放行(守卫只管边界,存在性归上游)', async () => {
    const r = await pickerList(join(root, 'alice', 'not-yet-created'))
    expect(JSON.stringify(r)).not.toContain('tenant/denied')
  })
})
