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
import { existsSync, mkdtempSync, rmSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { remoteMethods } from '@deepseek-ai/dsh-typert-protocol'
import { LedgerStore } from '@eterna/evolve'
import {
  EternaMemoryGateway, listDomainViews, memoryStatsOf, name as adminPluginName,
  ETERNA_MEMORY_SERVICE_ID, ETERNA_MEMORY_SESSION_SERVICE_ID,
  MEMORY_STATE_ENDPOINT, MEMORY_UPDATE_ENDPOINT, MEMORY_DOMAINS_ENDPOINT,
  MEMORY_SESSION_DOMAIN_ENDPOINT, MEMORY_SELECT_DOMAIN_ENDPOINT,
  MEMORY_DISTILL_VIEW_ENDPOINT, MEMORY_DISTILL_SET_PARTICIPATE_ENDPOINT,
  MEMORY_DISTILL_REPORT_ENDPOINT, MEMORY_DISTILL_ENABLE_ENDPOINT, MEMORY_DISTILL_RUN_ENDPOINT,
  MEMORY_DISTILL_CANDIDATES_ENDPOINT, MEMORY_DISTILL_RELEASE_ENDPOINT, MEMORY_DISTILL_REJECT_ENDPOINT,
} from '../src/admin-plugin.ts'
import { EntityMemoryStore } from '../src/entity-store.ts'
import { DomainRegistryStore } from '../src/domain.ts'
import { DISTILL_REPORT_SCHEMA, accountParticipatesInDistill, writeDistillReport } from '../src/distill.ts'
import { curateDistillCandidates } from '../src/distill-curate.ts'

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

  it('原型携带 @Remote marker:十三个方法(既有五端点 + M-M4 蒸馏八端点)', () => {
    const markers = remoteMethods(Object.create(EternaMemoryGateway.prototype) as object)
    expect(markers.map(marker => marker.method).sort()).toEqual([
      'distillCandidateReject', 'distillCandidateRelease', 'distillCandidates', 'distillEnable',
      'distillReport', 'distillRun', 'distillView', 'domains',
      'selectDomain', 'sessionDomain', 'setDistillParticipate', 'state', 'updateConfig',
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

// ---------- M-M4 全局蒸馏端点(distillView/setDistillParticipate/distillReport/…) ----------

describe('M-M4 蒸馏端点(授权链 + 本人账号 opt-out + 报告/候选面)', () => {
  const tenants = mkdtempSync(join(tmpdir(), 'eterna-memory-distill-tenants-'))
  const distillRoot = mkdtempSync(join(tmpdir(), 'eterna-memory-distill-root-'))
  const accountsFace = {
    accountOfUser: (id: number): string | undefined => (id === 1 ? 'alice' : id === 2 ? 'bob' : undefined),
    dbPathForAccount: (account: string): string | undefined =>
      existsSync(join(tenants, account)) ? join(tenants, account, '.eterna', 'memory.sqlite3') : undefined,
    memoryForAccount: (account: string): unknown => {
      // 懒开通面(router create 同款先 mkdir 再开库;测试只建目录)。
      mkdirSync(join(tenants, account, '.eterna'), { recursive: true })
      return null
    },
  }

  afterAll(() => {
    rmSync(tenants, { recursive: true, force: true })
    rmSync(distillRoot, { recursive: true, force: true })
  })

  function gatewayDistillOf(ctx: never, extra: { accountsFace?: unknown; distillFace?: unknown } = {}): EternaMemoryGateway {
    const gateway = Object.create(EternaMemoryGateway.prototype) as EternaMemoryGateway
    Object.defineProperty(gateway, 'ctx', { value: ctx })
    Object.defineProperty(gateway, 'deps', {
      value: {
        dbPath,
        sessionDomainFace: () => undefined,
        distillRoot,
        ...(extra.accountsFace !== undefined ? { accountsFace: () => extra.accountsFace } : {}),
        ...(extra.distillFace !== undefined ? { distillFace: () => extra.distillFace } : {}),
      },
    })
    return gateway
  }

  it('端点常量与 @Remote marker:八个蒸馏端点', () => {
    expect(MEMORY_DISTILL_VIEW_ENDPOINT).toBe('eternaMemory/distillView')
    expect(MEMORY_DISTILL_SET_PARTICIPATE_ENDPOINT).toBe('eternaMemory/setDistillParticipate')
    expect(MEMORY_DISTILL_REPORT_ENDPOINT).toBe('eternaMemory/distillReport')
    expect(MEMORY_DISTILL_ENABLE_ENDPOINT).toBe('eternaMemory/distillEnable')
    expect(MEMORY_DISTILL_RUN_ENDPOINT).toBe('eternaMemory/distillRun')
    expect(MEMORY_DISTILL_CANDIDATES_ENDPOINT).toBe('eternaMemory/distillCandidates')
    expect(MEMORY_DISTILL_RELEASE_ENDPOINT).toBe('eternaMemory/distillCandidateRelease')
    expect(MEMORY_DISTILL_REJECT_ENDPOINT).toBe('eternaMemory/distillCandidateReject')
    const markers = remoteMethods(Object.create(EternaMemoryGateway.prototype) as object)
    const names = markers.map(marker => marker.method)
    for (const method of ['distillView', 'setDistillParticipate', 'distillReport', 'distillEnable', 'distillRun', 'distillCandidates', 'distillCandidateRelease', 'distillCandidateReject']) {
      expect(names).toContain(method)
    }
  })

  it('distillView:登录即可(owner peer 也放行);部署门回落根 overrides;参与缺省 true', () => {
    const alice = gatewayDistillOf(fakeCtxOf({ principal: { kind: 'eterna-user', userId: 1 } }), { accountsFace })
    const view = alice.distillView()
    expect(view.ok).toBe(true)
    if (view.ok) {
      expect(view.deploymentEnabled).toBe(false) // 双缺省 false(Q4)
      expect(view.participate).toBe(true)
      expect(view.minUsers).toBe(5)
    }
    const owner = gatewayDistillOf(fakeCtxOf())
    const ownerView = owner.distillView()
    expect(ownerView.ok).toBe(true)
  })

  it('setDistillParticipate:本人账号写本人 overrides;无 userId → invalid;越权面不存在(只能写自己)', () => {
    const alice = gatewayDistillOf(fakeCtxOf({ principal: { kind: 'eterna-user', userId: 1 } }), { accountsFace })
    const result = alice.setDistillParticipate({ participate: false })
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.participate).toBe(false)
    expect(accountParticipatesInDistill(join(tenants, 'alice'))).toBe(false)
    // distillView 跟随。
    const view = alice.distillView()
    if (view.ok) expect(view.participate).toBe(false)
    // bob(账号目录未开通)经 memoryForAccount 懒开通后写入。
    const bob = gatewayDistillOf(fakeCtxOf({ principal: { kind: 'eterna-user', userId: 2 } }), { accountsFace })
    const bobResult = bob.setDistillParticipate(false)
    expect(bobResult.ok).toBe(true)
    expect(accountParticipatesInDistill(join(tenants, 'bob'))).toBe(false)
    // owner peer(无 userId,本地单库形态)→ invalid 如实回报。
    const owner = gatewayDistillOf(fakeCtxOf(), { accountsFace })
    expect(owner.setDistillParticipate({ participate: true }).ok).toBe(false)
  })

  it('distillEnable:admin 写根 overrides 热改键;非 admin forbidden;distillView 门随动', () => {
    const nonAdmin = gatewayDistillOf(fakeCtxOf({ principal: { kind: 'eterna-user', userId: 1 }, adminRole: 'user' }), { accountsFace })
    expect(nonAdmin.distillEnable({ enabled: true }).ok).toBe(false)
    const admin = gatewayDistillOf(fakeCtxOf({ principal: { kind: 'eterna-user', userId: 1 }, adminRole: 'admin' }), { accountsFace })
    expect(admin.distillEnable({ enabled: true }).ok).toBe(true)
    const view = admin.distillView()
    if (view.ok) expect(view.deploymentEnabled).toBe(true)
    expect(admin.distillEnable(false).ok).toBe(true) // 裸布尔形态幂等
    const viewAfter = admin.distillView()
    if (viewAfter.ok) expect(viewAfter.deploymentEnabled).toBe(false)
  })

  it('distillReport:admin 直读 latest.json(未运行 null);非 admin forbidden', () => {
    const nonAdmin = gatewayDistillOf(fakeCtxOf({ principal: { kind: 'eterna-user', userId: 1 }, adminRole: 'user' }))
    expect(nonAdmin.distillReport().ok).toBe(false)
    const admin = gatewayDistillOf(fakeCtxOf({ principal: { kind: 'eterna-user', userId: 1 }, adminRole: 'admin' }))
    const empty = admin.distillReport()
    expect(empty.ok).toBe(true)
    if (empty.ok) expect(empty.report).toBeNull()
    writeDistillReport(distillRoot, {
      schema: DISTILL_REPORT_SCHEMA,
      generatedAt: 1,
      windowStart: 0,
      totals: { accounts: 0, participating: 0, optedOut: 0, entities: 0 },
      minUsers: 5,
      sampleSufficient: false,
      clusters: [],
      errors: [],
    })
    const seeded = admin.distillReport()
    expect(seeded.ok).toBe(true)
    if (seeded.ok) expect(seeded.report?.schema).toBe(DISTILL_REPORT_SCHEMA)
  })

  it('distillRun:face 缺席 → unavailable;face 在场转发 runNow(单飞在 face 内)', async () => {
    const admin = gatewayDistillOf(fakeCtxOf({ principal: { kind: 'eterna-user', userId: 1 }, adminRole: 'admin' }))
    const missing = await admin.distillRun()
    expect(missing.ok).toBe(false)
    if (!missing.ok) expect(missing.code).toBe('unavailable')
    const controlled: { runNow?: () => Promise<{ ok: true; detail: string } | { ok: false; message: string }> } = {}
    const withFace = gatewayDistillOf(fakeCtxOf({ principal: { kind: 'eterna-user', userId: 1 }, adminRole: 'admin' }), {
      distillFace: {
        gate: () => true,
        minUsers: 5,
        intervalMs: 3_600_000,
        runNow: () => (controlled.runNow ?? (async () => ({ ok: true as const, detail: '蒸馏报告:0 账号参与' })))(),
      },
    })
    const ok = await withFace.distillRun()
    expect(ok.ok).toBe(true)
    controlled.runNow = async () => ({ ok: false, message: '蒸馏任务已在运行,请稍后再试' })
    const busy = await withFace.distillRun()
    expect(busy.ok).toBe(false)
  })

  it('候选三端点:admin 席位 quarantine 清单/签发/拒绝;非 admin forbidden;重复签发 invalid', async () => {
    const nonAdmin = gatewayDistillOf(fakeCtxOf({ principal: { kind: 'eterna-user', userId: 1 }, adminRole: 'user' }))
    expect(nonAdmin.distillCandidates().ok).toBe(false)
    const admin = gatewayDistillOf(fakeCtxOf({ principal: { kind: 'eterna-user', userId: 1 }, adminRole: 'admin' }))
    // 种子:经 curateDistillCandidates 造两个候选(模板路径,零模型调用)。
    const report = {
      schema: DISTILL_REPORT_SCHEMA,
      generatedAt: 1,
      windowStart: 0,
      totals: { accounts: 2, participating: 2, optedOut: 0, entities: 2 },
      minUsers: 2,
      sampleSufficient: true,
      clusters: [
        { label: '共享站会模式示例', sharedTokens: ['站', '会'], userCount: 2, accounts: ['alice', 'bob'], entriesCount: 2, kindCounts: {}, domainCounts: {}, examples: ['共享站会模式示例'] },
        { label: '共享部署清单模式示例', sharedTokens: ['部', '署'], userCount: 2, accounts: ['alice', 'bob'], entriesCount: 2, kindCounts: {}, domainCounts: {}, examples: ['共享部署清单模式示例'] },
      ],
      errors: [],
    } as const
    const ledger = new LedgerStore(join(distillRoot, 'ledger.sqlite3'))
    await curateDistillCandidates({ report, outputDir: distillRoot, ledger, signal: new AbortController().signal })
    ledger.close()
    const listed = admin.distillCandidates()
    expect(listed.ok).toBe(true)
    if (listed.ok) expect(listed.candidates.length).toBeGreaterThanOrEqual(2)
    const firstId = listed.ok ? listed.candidates[0]?.meta.id ?? '' : ''
    const secondId = listed.ok ? listed.candidates[1]?.meta.id ?? '' : ''
    // 签发第一候选(探针复检 fail-closed 在 distill-curate;正文为中文模板,应过)。
    const released = admin.distillCandidateRelease({ id: firstId })
    expect(released.ok).toBe(true)
    if (released.ok) expect(released.meta.decision?.action).toBe('released')
    // 重复签发 → invalid。
    const again = admin.distillCandidateRelease({ id: firstId })
    expect(again.ok).toBe(false)
    // 拒绝第二候选;清单默认不再含它。
    const rejected = admin.distillCandidateReject({ id: secondId })
    expect(rejected.ok).toBe(true)
    const after = admin.distillCandidates()
    if (after.ok) expect(after.candidates.map(entry => entry.meta.id)).not.toContain(secondId)
    // 非法载荷。
    expect(admin.distillCandidateRelease({}).ok).toBe(false)
    expect(admin.distillCandidateRelease({ id: 'ghost' }).ok).toBe(false)
  })
})
