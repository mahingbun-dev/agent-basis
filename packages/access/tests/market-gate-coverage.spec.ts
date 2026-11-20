/**
 * T38 检索/市场回归(2026-11-20;47 §B7/B8 · 50 §3.4 · 54 §4.6/§4.11)。
 *
 * 市场面(可执行部分):
 * - **上游方法表防漂移**:从 node_modules 上游 typert 描述符取
 *   `pluginManager/*`(15)+ `pluginMarket/*`(4)全表,逐个断言
 *   `access admit` 的市场门行为——匿名 401、普通用户 403(不触达原 admit)、
 *   admin 放行(owner Peer)。上游加方法而门失效/清单漏改时本测试红;
 * - **安装/卸载/启停/索引源写**动作(installBundle/updateBundle/removeBundle/
 *   setBundleEnabled/setPluginEnabled/setVersionExemption/setIndexes)全在表内;
 * - **双层键控**:共享层 = 市场 RPC(admin-only,落共享 profile);个人层 =
 *   `/api/my-plugins/*`(access 守卫路由,cookie 判归属,`user:<account>:<name>`
 *   命名禁 shadow 公共 id)——个人层**不在**市场门内,普通用户照常可用。
 *
 * 检索面(web_search/web_fetch 三路由)是模型链路 E2E(需 deepseek/mimo/glm 三家
 * 真凭据 + 出网),本套件不做假绿灯;静态事实(模板 tool-web 行/三 provider)见
 * artifacts/rc5/p4/chat-import/t38-search-market.txt 与 LaneReport leftovers。
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { installMuxIsolation, MARKET_ADMIN_PREFIXES, MUX_PATH } from '../src/mux.ts'
import { SessionService } from '../src/session.ts'
import { UserStore } from '../src/store.ts'
import { personalPluginId, USER_PLUGINS_PREFIX } from '../src/user-plugins.ts'

/** 上游 rc.5 市场方法全表(15 + 4;源=各包 lib/typert.remote-client.js)。 */
const EXPECTED_MARKET_METHODS = [
  'pluginManager/cancelInstall',
  'pluginManager/inspect',
  'pluginManager/installBundle',
  'pluginManager/listBundles',
  'pluginManager/listPlugins',
  'pluginManager/listVersionExemptions',
  'pluginManager/listVersions',
  'pluginManager/readBundleDetail',
  'pluginManager/registries',
  'pluginManager/removeBundle',
  'pluginManager/setBundleEnabled',
  'pluginManager/setPluginEnabled',
  'pluginManager/setVersionExemption',
  'pluginManager/updateBundle',
  'pluginManager/waitForInstall',
  'pluginMarket/listIndexes',
  'pluginMarket/readEntryDetail',
  'pluginMarket/search',
  'pluginMarket/setIndexes',
] as const

/** detail-file fetch 路由(上游两包各自的 exact 路由;mux.ts 头注证据链)。 */
const DETAIL_FILE_PATHS = [
  '/api/plugin-manager/detail-file',
  '/api/plugin-market/detail-file',
] as const

function findPnpmRoot(): string {
  let dir = new URL('..', import.meta.url).pathname
  for (let index = 0; index < 6; index += 1) {
    const candidate = join(dir, 'node_modules', '.pnpm')
    if (existsSync(candidate)) return candidate
    dir = join(dir, '..')
  }
  throw new Error('找不到 node_modules/.pnpm(上游包根)')
}

/** 上游 typert 描述符里的方法键(`'pluginManager/installBundle': {` 形态)。 */
function upstreamMarketMethods(): string[] {
  const root = findPnpmRoot()
  const found = new Set<string>()
  for (const pkg of ['dsh-plugin-manager', 'dsh-plugin-market']) {
    const prefix = `@deepseek-ai+${pkg}@`
    const entry = readdirSync(root, { withFileTypes: true })
      .find(row => row.isDirectory() && row.name.startsWith(prefix))
    if (entry === undefined) throw new Error(`上游包 ${pkg} 不在 .pnpm(锁版漂移)`)
    const file = join(root, entry.name, 'node_modules', '@deepseek-ai', pkg, 'lib', 'typert.remote-client.js')
    const text = readFileSync(file, 'utf8')
    for (const match of text.matchAll(/'((?:pluginManager|pluginMarket)\/[A-Za-z]+)': \{/g)) {
      const key = match[1]
      if (key !== undefined) found.add(key)
    }
  }
  return [...found].sort()
}

describe('T38 市场面:admit 市场门 × 上游全方法表', () => {
  let dir: string
  let store: UserStore
  let session: SessionService
  let aliceId: number
  let aliceCookie: string
  let adminCookie: string

  const cookieOf = (userId: number): string =>
    `eterna_session=${session.issue({ userId, passwordVersion: store.getUserById(userId)?.passwordVersion ?? 1 })}`

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'eterna-market-gate-'))
    store = new UserStore(join(dir, 'users.db'))
    session = new SessionService(Buffer.from('market-gate-secret-market-gate-01'))
    const alice = store.createUserWithSuffix({ account: 'alice', password: 'password8' })
    aliceId = alice.user.id
    aliceCookie = cookieOf(aliceId)
    const root = store.createUserWithSuffix({ account: 'root', password: 'password8' })
    store.setUserRole(root.user.id, 'admin')
    adminCookie = cookieOf(root.user.id)
  })

  afterEach(() => {
    store.close()
    rmSync(dir, { recursive: true, force: true })
  })

  function fakeConnection() {
    const original = () => ({ peer: 'owner-peer' })
    return {
      original,
      created: [] as Array<{ principal: unknown }>,
      admit: original as (request: unknown) => unknown,
      createPeer: (options: { principal: unknown }) => ({ id: 'peer', principal: options.principal, dispose: () => {} }),
    }
  }

  type Connection = ReturnType<typeof fakeConnection>
  const admitOf = (connection: Connection) => connection.admit as unknown as (request: unknown) => { peer?: unknown; rejection?: number }
  const requestOf = (path: string, cookie?: string) => ({
    url: `http://app.local${path}`,
    headers: typeof cookie === 'string' ? { cookie } : {},
  })

  it('上游方法表 = 15 pluginManager + 4 pluginMarket(锁版 rc.5;漂移即红)', () => {
    const upstream = upstreamMarketMethods()
    expect(upstream.filter(key => key.startsWith('pluginManager/'))).toHaveLength(15)
    expect(upstream.filter(key => key.startsWith('pluginMarket/'))).toHaveLength(4)
    expect(upstream).toEqual([...EXPECTED_MARKET_METHODS].sort())
  })

  it('19 个方法逐条:匿名 401、普通用户 403(不触达原 admit)、admin 放行', () => {
    const connection = fakeConnection()
    const install = installMuxIsolation({ store, session }, connection, { registerPolicy: () => {} })
    const admit = admitOf(connection)
    let adminCalls = 0
    for (const method of EXPECTED_MARKET_METHODS) {
      const path = `/api/${method}`
      expect(admit(requestOf(path)).rejection, `${method} 匿名应 401`).toBe(401)
      expect(admit(requestOf(path, aliceCookie)).rejection, `${method} 普通用户应 403`).toBe(403)
      const allowed = admit(requestOf(path, adminCookie))
      expect(allowed.peer, `${method} admin 应放行`).toBe('owner-peer')
      adminCalls += 1
    }
    expect(adminCalls).toBe(EXPECTED_MARKET_METHODS.length)
    install?.dispose()
  })

  it('安装/卸载/更新/启停/索引源写:写动作全在门内(共享 profile 收口)', () => {
    const connection = fakeConnection()
    const install = installMuxIsolation({ store, session }, connection, { registerPolicy: () => {} })
    const admit = admitOf(connection)
    const writes = [
      'pluginManager/installBundle',
      'pluginManager/updateBundle',
      'pluginManager/removeBundle',
      'pluginManager/setBundleEnabled',
      'pluginManager/setPluginEnabled',
      'pluginManager/setVersionExemption',
      'pluginManager/cancelInstall',
      'pluginMarket/setIndexes',
    ]
    for (const method of writes) {
      expect(admit(requestOf(`/api/${method}`, aliceCookie)).rejection, `${method} 普通用户应 403`).toBe(403)
    }
    install?.dispose()
  })

  it('detail-file 两条 exact 路由(带 query)同样在门内;近形路径不倒', () => {
    const connection = fakeConnection()
    const install = installMuxIsolation({ store, session }, connection, { registerPolicy: () => {} })
    const admit = admitOf(connection)
    for (const path of DETAIL_FILE_PATHS) {
      expect(admit(requestOf(`${path}?document=d&path=img/a.png`, aliceCookie)).rejection).toBe(403)
      expect(admit(requestOf(`${path}?document=d&path=img/a.png`)).rejection).toBe(401)
      expect(admit(requestOf(`${path}?document=d&path=img/a.png`, adminCookie)).peer).toBe('owner-peer')
    }
    for (const path of ['/api/plugin-managers/detail-file', '/api/pluginmanager/detail-file']) {
      expect(admit(requestOf(path, aliceCookie)).peer, `${path} 不在市场面`).toBe('owner-peer')
    }
    install?.dispose()
  })

  it('双层键控:个人层 /api/my-plugins/* 不在市场门内(普通用户可用),共享层在市场门内', () => {
    expect(MARKET_ADMIN_PREFIXES.some(prefix => USER_PLUGINS_PREFIX.startsWith(prefix))).toBe(false)
    expect(MARKET_ADMIN_PREFIXES).toEqual([
      '/api/pluginManager/',
      '/api/pluginMarket/',
      '/api/plugin-manager/',
      '/api/plugin-market/',
    ])

    const connection = fakeConnection()
    const install = installMuxIsolation({ store, session }, connection, { registerPolicy: () => {} })
    const admit = admitOf(connection)
    for (const action of ['list', 'install', 'enable', 'disable', 'remove', 'scan', 'shared/list']) {
      expect(admit(requestOf(`${USER_PLUGINS_PREFIX}/${action}`, aliceCookie)).peer, `${action} 个人层应放行`)
        .toBe('owner-peer')
    }
    // 个人插件 id 键 = user:<account>:<name>(禁 shadow 公共 id)
    expect(personalPluginId('alice', 'demo-plugin')).toBe('user:alice:demo-plugin')
    expect(personalPluginId('alice', '../escape')).toBeUndefined()
    expect(personalPluginId('alice', '')).toBeUndefined()
    install?.dispose()
  })

  it('mux 路径不受市场门影响(市场门只认路径前缀)', () => {
    const connection = fakeConnection()
    const install = installMuxIsolation({ store, session }, connection, { registerPolicy: () => {} })
    const mux = admitOf(connection)(requestOf(MUX_PATH, aliceCookie)) as { peer?: { principal?: unknown } }
    expect(mux.peer?.principal).toEqual({ kind: 'eterna-user', userId: aliceId })
    install?.dispose()
  })
})
