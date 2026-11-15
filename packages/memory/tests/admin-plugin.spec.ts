/**
 * 宿主 SRC 网关 eternaMemory/*(M-M3 T12-①②③ 数据面)单测:
 * - @Remote marker(手工施加等价于装饰器糖;panel host-plugin 同款);
 * - state/updateConfig:配置文件桥读写(临时 workspace 隔离,overrides 路径随
 *   deps.dbPath 经 config-bridge 唯一真值派生)+ admin 鉴权口径;
 * - domains:domain_registry 只读投影 + 每域待审计数;
 * - sessionDomain/selectDomain:转发 glue 会话域面(缺席 → unavailable;
 *   非法域键 → invalid)。
 * 构造形态:不经构造器(cordis Service 注册面,panel host-plugin 同款)——
 * Object.create 原型 + defineProperty ctx/deps,方法体直调。
 */
import { mkdtempSync, rmSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { remoteMethods } from '@deepseek-ai/dsh-typert-protocol'
import {
  EternaMemoryGateway, listDomainViews, memoryStatsOf, name as adminPluginName,
  ETERNA_MEMORY_SERVICE_ID, ETERNA_MEMORY_SESSION_SERVICE_ID,
  MEMORY_STATE_ENDPOINT, MEMORY_UPDATE_ENDPOINT, MEMORY_DOMAINS_ENDPOINT,
  MEMORY_SESSION_DOMAIN_ENDPOINT, MEMORY_SELECT_DOMAIN_ENDPOINT,
} from '../src/admin-plugin.ts'
import { EntityMemoryStore } from '../src/entity-store.ts'
import { DomainRegistryStore } from '../src/domain.ts'

const workspace = mkdtempSync(join(tmpdir(), 'eterna-memory-admin-'))

beforeAll(() => {
  // sqlite/域注册表落 workspace/.eterna(缺省布局;stores 不建父目录,先备好)
  mkdirSync(join(workspace, '.eterna'), { recursive: true })
})

afterAll(() => {
  rmSync(workspace, { recursive: true, force: true })
})

const dbPath = join(workspace, '.eterna', 'memory.sqlite3')

/** 伪 ctx(get 白名单;compaction/panel fake ctx 同款最小面)。 */
function fakeCtxOf(options: {
  sessionFace?: unknown
  principal?: { kind?: string; userId?: number }
  adminRole?: string
} = {}): never {
  return {
    get: (name: string) => name === ETERNA_MEMORY_SESSION_SERVICE_ID ? options.sessionFace : undefined,
    invocation: options.principal === undefined ? undefined : { principal: options.principal },
    reflect: {
      get: (name: string) => {
        if (name !== 'eternaAccessStore') return undefined
        return { getUserById: () => (options.adminRole === undefined ? undefined : { role: options.adminRole }) }
      },
    },
  } as never
}

function gatewayOf(ctx: never, sessionDomainFace?: () => unknown, dbPathOverride?: string): EternaMemoryGateway {
  const gateway = Object.create(EternaMemoryGateway.prototype) as EternaMemoryGateway
  Object.defineProperty(gateway, 'ctx', { value: ctx })
  const fallbackFace = (): unknown => (ctx as { get(name: string): unknown }).get(ETERNA_MEMORY_SESSION_SERVICE_ID)
  Object.defineProperty(gateway, 'deps', {
    value: {
      dbPath: dbPathOverride ?? dbPath,
      sessionDomainFace: sessionDomainFace ?? fallbackFace,
    },
  })
  return gateway
}

describe('端点常量与 @Remote marker', () => {
  it('服务名与五个端点字符串(客户端 endpoints.ts 字面契约)', () => {
    expect(ETERNA_MEMORY_SERVICE_ID).toBe('eternaMemory')
    expect(MEMORY_STATE_ENDPOINT).toBe('eternaMemory/state')
    expect(MEMORY_UPDATE_ENDPOINT).toBe('eternaMemory/updateConfig')
    expect(MEMORY_DOMAINS_ENDPOINT).toBe('eternaMemory/domains')
    expect(MEMORY_SESSION_DOMAIN_ENDPOINT).toBe('eternaMemory/sessionDomain')
    expect(MEMORY_SELECT_DOMAIN_ENDPOINT).toBe('eternaMemory/selectDomain')
  })

  it('原型携带 @Remote marker:五个方法(panel host-plugin 同款断言)', () => {
    const markers = remoteMethods(Object.create(EternaMemoryGateway.prototype) as object)
    expect(markers.map(marker => marker.method).sort()).toEqual([
      'domains', 'selectDomain', 'sessionDomain', 'state', 'updateConfig',
    ])
  })

  it('default 插件形态:name = eterna-memory-admin(宿主载具行解析)', () => {
    expect(adminPluginName).toBe('eterna-memory-admin')
  })
})

describe('state/updateConfig(配置文件桥)', () => {
  it('基线视图:空 overrides → 全缺省 + 统计三数(空库)', () => {
    const view = gatewayOf(fakeCtxOf()).state()
    expect(view).toMatchObject({
      ok: true,
      config: { portraitEnabled: true, domainEnabled: true, writePolicy: 'auto-review' },
      stats: { entityCount: 0, pendingCount: 0, domainCount: 0 },
    })
  })

  it('updateConfig 合并写文件 → state 回读;非法载荷 invalid(中文 message)', () => {
    const gateway = gatewayOf(fakeCtxOf())
    const updated = gateway.updateConfig({ portraitEnabled: false, writePolicy: 'explicit-only' })
    expect(updated).toMatchObject({
      ok: true,
      config: { portraitEnabled: false, domainEnabled: true, writePolicy: 'explicit-only' },
    })
    // 二次更新只改一个键(合并语义,不丢前次)
    const second = gateway.updateConfig({ domainEnabled: false })
    expect(second).toMatchObject({
      ok: true,
      config: { portraitEnabled: false, domainEnabled: false, writePolicy: 'explicit-only' },
    })
    const bad = gateway.updateConfig({ writePolicy: 'no-gate' })
    expect(bad).toMatchObject({ ok: false, code: 'invalid' })
    expect(gateway.updateConfig('text').ok).toBe(false)
  })

  it('鉴权:owner Peer 放行;eterna-user 流通道须 admin(compaction 同款口径)', () => {
    expect(gatewayOf(fakeCtxOf()).state().ok).toBe(true)
    expect(gatewayOf(fakeCtxOf({ principal: { kind: 'eterna-user', userId: 1 }, adminRole: 'admin' })).state().ok).toBe(true)
    const memberView = gatewayOf(fakeCtxOf({ principal: { kind: 'eterna-user', userId: 2 }, adminRole: 'member' })).state()
    expect(memberView).toMatchObject({ ok: false, code: 'forbidden' })
    const denied = gatewayOf(fakeCtxOf({ principal: { kind: 'eterna-user', userId: 2 }, adminRole: 'member' })).updateConfig({})
    expect(denied.ok).toBe(false)
  })

  it('写盘失败 → unavailable 且不谎报成功(overrides 路径被目录占用)', () => {
    // 隔离 workspace:该用例的 overrides 路径必须是"目录",不受前序用例已写的文件影响
    const occupied = mkdtempSync(join(tmpdir(), 'eterna-memory-admin-occupied-'))
    mkdirSync(join(occupied, '.eterna', 'memory.config.json'), { recursive: true })
    try {
      // overrides 路径随 deps.dbPath 派生(memoryOverridesPathForDb 同目录):
      // 注入占用 workspace 的 dbPath 即命中被目录占用的写路径
      const view = gatewayOf(fakeCtxOf(), undefined, join(occupied, '.eterna', 'memory.sqlite3'))
        .updateConfig({ portraitEnabled: false })
      expect(view).toMatchObject({ ok: false, code: 'unavailable' })
    } finally {
      rmSync(occupied, { recursive: true, force: true })
    }
  })
})

describe('domains(域清单只读投影)与 memoryStatsOf(统计面)', () => {
  it('库缺席 → 空表/全 0', () => {
    expect(listDomainViews(join(workspace, 'absent.sqlite3'))).toEqual([])
    expect(memoryStatsOf(join(workspace, 'absent.sqlite3'))).toEqual({ entityCount: 0, pendingCount: 0, domainCount: 0 })
  })

  it('domain_registry 行投影 + 每域待审计数;统计按口径计数(pending 不算生效)', () => {
    const registry = new DomainRegistryStore(dbPath)
    registry.ensureWorkspaceDomain('deploy', '部署')
    const candidate = registry.recordHit('contract-review', '合同审查')
    expect(candidate.registered).toBeNull()
    // 写一行 pending + 一行 approved 到 deploy 域(逐域待审计数)
    const store = new EntityMemoryStore(dbPath, { now: () => Date.now() })
    store.write({ subject: 'domain:deploy', key: 'fact-1', content: '待审事实', kind: 'semantic', scope: 'domain', domainKey: 'deploy', reviewState: 'pending' })
    store.write({ subject: 'domain:deploy', key: 'fact-2', content: '已审事实', kind: 'semantic', scope: 'domain', domainKey: 'deploy', reviewState: 'approved' })
    store.close()
    registry.close()
    const views = listDomainViews(dbPath)
    expect(views).toHaveLength(2)
    const deploy = views.find(view => view.domainKey === 'deploy')
    expect(deploy?.registered).not.toBeNull()
    expect(deploy?.pendingCount).toBe(1)
    const candidateView = views.find(view => view.domainKey === 'contract-review')
    expect(candidateView?.registered).toBeNull()
    const stats = memoryStatsOf(dbPath)
    expect(stats.pendingCount).toBe(1)
    expect(stats.entityCount).toBe(1)
    expect(stats.domainCount).toBe(1)
    const view = gatewayOf(fakeCtxOf()).domains()
    expect(view.ok).toBe(true)
    if (view.ok) expect(view.domains).toHaveLength(2)
  })
})

describe('sessionDomain/selectDomain(会话域切换面转发)', () => {
  /** 假会话域面(结构子集,glue sessionFace 鸭子一致)。 */
  function fakeFace(overrides: Map<string, string> = new Map([['s1', 'deploy']])): unknown {
    return {
      domainOf: (sessionId: string) => overrides.get(sessionId),
      sessionDomainView: (sessionId: string) => {
        const override = overrides.get(`o:${sessionId}`)
        if (override !== undefined) return { domainKey: override, overridden: true }
        return { domainKey: overrides.get(sessionId) ?? null, overridden: false }
      },
      overrideDomain: (sessionId: string, domainKey: string | null) => {
        if (domainKey !== null && domainKey !== 'deploy') {
          throw new RangeError(`[memory] 域 ${domainKey} 未注册(候选中或不存在),不能切换为当前会话域`)
        }
        if (domainKey === null) overrides.delete(`o:${sessionId}`)
        else overrides.set(`o:${sessionId}`, domainKey)
        return { domainKey }
      },
      listRegisteredDomains: () => [{ domainKey: 'deploy', label: '部署' }],
    }
  }

  it('sessionDomain:转发面视图;载荷校验/面缺席 → invalid/unavailable', () => {
    const gateway = gatewayOf(fakeCtxOf(), () => fakeFace())
    expect(gateway.sessionDomain({ sessionId: 's1' })).toEqual({ ok: true, domainKey: 'deploy', overridden: false })
    expect(gateway.sessionDomain({ sessionId: '' }).ok).toBe(false)
    const missing = gatewayOf(fakeCtxOf({}))
    const view = missing.sessionDomain({ sessionId: 's1' })
    expect(view.ok).toBe(false)
    if (!view.ok) expect(view.code).toBe('unavailable')
  })

  it('selectDomain:切换与清除(null)双路径;非法域键 → invalid(中文 message)', () => {
    const gateway = gatewayOf(fakeCtxOf(), () => fakeFace())
    expect(gateway.selectDomain({ sessionId: 's2', domainKey: 'deploy' })).toEqual({ ok: true, domainKey: 'deploy', overridden: true })
    expect(gateway.selectDomain({ sessionId: 's2', domainKey: null })).toEqual({ ok: true, domainKey: null, overridden: false })
    const illegal = gateway.selectDomain({ sessionId: 's2', domainKey: 'ghost-domain' })
    expect(illegal.ok).toBe(false)
    if (!illegal.ok) expect(illegal.message).toContain('未注册')
  })

  it('selectDomain:载荷校验(domainKey 类型/sessionId 空串)', () => {
    const gateway = gatewayOf(fakeCtxOf(), () => fakeFace())
    expect(gateway.selectDomain({ domainKey: 'deploy' }).ok).toBe(false)
    expect(gateway.selectDomain({ sessionId: 's1', domainKey: 42 }).ok).toBe(false)
    expect(gateway.selectDomain('text').ok).toBe(false)
  })
})
