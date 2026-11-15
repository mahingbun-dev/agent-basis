import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { readFileSync } from 'node:fs'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  buildDomainTaggingUserText, DEFAULT_MIN_SESSIONS_FOR_NEW_DOMAIN, DomainRegistryStore,
  DomainTagParseError, DOMAIN_TAGGING_PROMPT, DOMAIN_TAG_CANDIDATE_LIMIT,
  DOMAIN_TAG_MESSAGE_MAX_CHARS, parseDomainTagOutput, resolveDomain, workspaceDomainKey,
} from '../src/index.ts'
import type { DomainRecord } from '../src/index.ts'

let dir = ''
let store: DomainRegistryStore
let clock = 0

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'eterna-memory-domain-'))
  clock = 1_000
  store = new DomainRegistryStore(':memory:', { now: () => clock })
})

afterEach(async () => {
  store.close()
  await rm(dir, { recursive: true, force: true })
})

describe('M-M1 T1 DomainRegistryStore:自由域候选与转正(Q2 决议)', () => {
  it('recordHit 未知候选首轮即建行(source=free,label 缺省=域键)', () => {
    const candidate = store.recordHit('contract-review')
    expect(candidate.domainKey).toBe('contract-review')
    expect(candidate.source).toBe('free')
    expect(candidate.label).toBe('contract-review')
    expect(candidate.hitSessions).toBe(1)
    expect(candidate.registered).toBeNull()
    expect(candidate.sessionCount).toBe(0)
    expect(candidate.memoryCount).toBe(0)
    expect(candidate.createdAt).toBe(1_000)
    expect(candidate.lastUsedAt).toBe(1_000)
  })

  it('候选计数未达阈值不转正;list(true) 不含候选', () => {
    store.recordHit('contract-review')
    const candidate = store.recordHit('contract-review')
    expect(candidate.hitSessions).toBe(2)
    expect(candidate.registered).toBeNull()
    expect(store.list()).toHaveLength(1)
    expect(store.list(true)).toHaveLength(0)
    expect(store.resolve('contract-review')?.hitSessions).toBe(2)
  })

  it(`候选第 ${DEFAULT_MIN_SESSIONS_FOR_NEW_DOMAIN} 次命中转正(默认阈值 3);转正后候选通道关闭`, () => {
    expect(DEFAULT_MIN_SESSIONS_FOR_NEW_DOMAIN).toBe(3)
    store.recordHit('deploy')
    store.recordHit('deploy')
    clock = 2_000
    const promoted = store.recordHit('deploy')
    expect(promoted.hitSessions).toBe(3)
    expect(promoted.registered).toBe(2_000)
    expect(store.list(true).map(row => row.domainKey)).toEqual(['deploy'])
    // 已注册域再命中:不累计候选计数、不刷新转正时间,只刷新最近使用
    clock = 3_000
    const after = store.recordHit('deploy')
    expect(after.hitSessions).toBe(3)
    expect(after.registered).toBe(2_000)
    expect(after.lastUsedAt).toBe(3_000)
  })

  it('recordHit 首建可携带展示名(label),已存在行不改动 label', () => {
    store.recordHit('deploy', '部署')
    const again = store.recordHit('deploy', '别的名字')
    expect(again.label).toBe('部署')
    expect(again.hitSessions).toBe(2)
  })

  it('minSessionsForNewDomain 可配置(18 §11 config domain.minSessionsForNewDomain)', () => {
    const strict = new DomainRegistryStore(':memory:', { now: () => clock, minSessionsForNewDomain: 2 })
    expect(strict.recordHit('deploy').registered).toBeNull()
    expect(strict.recordHit('deploy').registered).toBe(1_000)
    strict.close()
  })
})

describe('M-M1 T1 DomainRegistryStore:workspace 显式域', () => {
  it('ensureWorkspaceDomain 登记即注册(跳过打标,source=workspace)', () => {
    clock = 2_000
    const domain = store.ensureWorkspaceDomain('acme-site', '客户甲官网')
    expect(domain.registered).toBe(2_000)
    expect(domain.source).toBe('workspace')
    expect(domain.label).toBe('客户甲官网')
    expect(store.list(true).map(row => row.domainKey)).toContain('acme-site')
  })

  it('重复 ensure:更新 label,保留首次注册时间与既有计数', () => {
    const first = store.ensureWorkspaceDomain('acme-site', '官网')
    clock = 5_000
    store.touchUsed('acme-site')
    const second = store.ensureWorkspaceDomain('acme-site', '客户甲官网')
    expect(second.registered).toBe(first.registered)
    expect(second.label).toBe('客户甲官网')
    expect(second.sessionCount).toBe(1)
  })

  it('已有候选经 ensure 升格:hit_sessions 留档,registered 补齐', () => {
    store.recordHit('deploy')
    clock = 2_000
    const promoted = store.ensureWorkspaceDomain('deploy', '部署')
    expect(promoted.source).toBe('workspace')
    expect(promoted.registered).toBe(2_000)
    expect(promoted.hitSessions).toBe(1)
  })
})

describe('M-M1 T1 DomainRegistryStore:touchUsed 与校验', () => {
  it('touchUsed:session_count+1、last_used_at 刷新;未知键返回 null 且不隐式建行', () => {
    store.ensureWorkspaceDomain('deploy', '部署')
    clock = 2_000
    const touched = store.touchUsed('deploy')
    expect(touched?.sessionCount).toBe(1)
    expect(touched?.lastUsedAt).toBe(2_000)
    clock = 3_000
    expect(store.touchUsed('deploy')?.sessionCount).toBe(2)
    expect(store.touchUsed('nowhere')).toBeNull()
    expect(store.resolve('nowhere')).toBeNull()
    expect(store.list()).toHaveLength(1)
  })

  it('domain_key 必须 kebab-case ≤64;label 非空 ≤128', () => {
    expect(() => store.recordHit('Deploy')).toThrow(/kebab/)
    expect(() => store.recordHit('contract_review')).toThrow(/kebab/)
    expect(() => store.recordHit('合同')).toThrow(/kebab/)
    expect(() => store.ensureWorkspaceDomain('deploy', 'v')).not.toThrow()
    expect(() => store.recordHit('d'.repeat(65))).toThrow(/超长/)
    expect(() => store.ensureWorkspaceDomain('deploy', ' ')).toThrow(/label/)
    expect(() => store.ensureWorkspaceDomain('deploy', '长'.repeat(129))).toThrow(/超长/)
  })

  it('minSessionsForNewDomain <1 拒绝', () => {
    expect(() => new DomainRegistryStore(':memory:', { minSessionsForNewDomain: 0 })).toThrow(/minSessionsForNewDomain/)
  })

  it('文件库跨实例持久化(同一 dbPath 重开可见)', () => {
    const fileStore = new DomainRegistryStore(join(dir, 'domain.db'), { now: () => clock })
    fileStore.recordHit('deploy')
    fileStore.ensureWorkspaceDomain('acme-site', '官网')
    fileStore.close()

    const reopened = new DomainRegistryStore(join(dir, 'domain.db'), { now: () => clock })
    expect(reopened.resolve('deploy')?.hitSessions).toBe(1)
    expect(reopened.resolve('acme-site')?.registered).toBe(1_000)
    expect(reopened.list(true).map(row => row.domainKey)).toEqual(['acme-site'])
    reopened.close()
  })

  it('close 幂等;关闭后操作拒绝', () => {
    store.close()
    store.close()
    expect(() => store.resolve('deploy')).toThrow(/已关闭/)
  })
})

describe('M-M3 T10 recordSessionHit:每会话持久命中去重', () => {
  it('未知候选首建(counted=true,hit_sessions=1);同会话重复不重复计数', () => {
    const first = store.recordSessionHit('contract-review', 'session-a')
    expect(first.counted).toBe(true)
    expect(first.record.hitSessions).toBe(1)
    expect(first.record.registered).toBeNull()
    clock = 2_000
    const again = store.recordSessionHit('contract-review', 'session-a')
    expect(again.counted).toBe(false)
    expect(again.record.hitSessions).toBe(1)
    expect(store.sessionHitAt('contract-review', 'session-a')).toBe(1_000)
    expect(store.sessionHitAt('contract-review', 'session-b')).toBeNull()
  })

  it('独立会话分别计数;第 3 会话触发转正(持久 marker 是计数口径)', () => {
    // 持久去重必须走文件库(:memory: 跨实例不可见,持久化语义单独验证)
    const fileStore = new DomainRegistryStore(join(dir, 'hits.db'), { now: () => clock })
    fileStore.recordSessionHit('deploy', 'session-a')
    fileStore.recordSessionHit('deploy', 'session-b')
    expect(fileStore.resolve('deploy')?.registered).toBeNull()
    clock = 2_000
    const third = fileStore.recordSessionHit('deploy', 'session-c')
    expect(third.counted).toBe(true)
    expect(third.record.registered).toBe(2_000)
    fileStore.close()
    // 进程重启(新 store 实例、同库)后同会话重放不重复计数——持久去重
    const reopened = new DomainRegistryStore(join(dir, 'hits.db'), { now: () => clock })
    const replay = reopened.recordSessionHit('deploy', 'session-c')
    expect(replay.counted).toBe(false)
    expect(replay.record.hitSessions).toBe(3)
    expect(replay.record.registered).toBe(2_000)
    reopened.close()
  })

  it('已注册域走绑定计数(session_count+1),不进候选通道', () => {
    store.ensureWorkspaceDomain('deploy', '部署')
    clock = 2_000
    const hit = store.recordSessionHit('deploy', 'session-a')
    expect(hit.counted).toBe(true)
    expect(hit.record.sessionCount).toBe(1)
    expect(hit.record.hitSessions).toBe(0)
    clock = 3_000
    expect(store.recordSessionHit('deploy', 'session-a').counted).toBe(false)
    expect(store.resolve('deploy')?.sessionCount).toBe(1)
  })

  it('label 仅未登记键首建生效;sessionId 校验(空/超长拒绝)', () => {
    const hit = store.recordSessionHit('deploy', 'session-a', '部署')
    expect(hit.record.label).toBe('部署')
    expect(() => store.recordSessionHit('deploy', ' ')).toThrow(/sessionId/)
    expect(() => store.recordSessionHit('deploy', 's'.repeat(129))).toThrow(/sessionId/)
    expect(() => store.sessionHitAt('deploy', '')).toThrow(/sessionId/)
  })
})

describe('M-M3 T10 打标提示词与解析(冻结面)', () => {
  it('DOMAIN_TAGGING_PROMPT 与 tests/fixtures/domain-tagging-prompt.md 逐字一致(改动须两处同步)', () => {
    const fixture = readFileSync(join(import.meta.dirname, 'fixtures/domain-tagging-prompt.md'), 'utf8').replace(/\n$/u, '')
    expect(DOMAIN_TAGGING_PROMPT).toBe(fixture)
    expect(DOMAIN_TAGGING_PROMPT).toContain('先归并')
    expect(DOMAIN_TAGGING_PROMPT).toContain('{"match":"deploy"}')
    expect(DOMAIN_TAGGING_PROMPT).toContain('{"new":{"key":"contract-review","label":"合同审查"}}')
    expect(DOMAIN_TAGGING_PROMPT).toContain('不打标:{}')
  })

  it('parseDomainTagOutput 三态:归并/新域(含 label)/不打标', () => {
    expect(parseDomainTagOutput('{"match":"deploy"}')).toEqual({ kind: 'match', domainKey: 'deploy' })
    expect(parseDomainTagOutput('{"new":{"key":"contract-review","label":"合同审查"}}'))
      .toEqual({ kind: 'new', domainKey: 'contract-review', label: '合同审查' })
    expect(parseDomainTagOutput('{"new":{"key":"deploy"}}')).toEqual({ kind: 'new', domainKey: 'deploy' })
    expect(parseDomainTagOutput('{}')).toEqual({ kind: 'none' })
    expect(parseDomainTagOutput('{"other":1}')).toEqual({ kind: 'none' })
  })

  it('杂文/围栏/前后噪声均可抢救;坏键收敛为 none;无 JSON 抛 DomainTagParseError', () => {
    expect(parseDomainTagOutput('结果:{"match":"Deploy"} 请查收')).toEqual({ kind: 'match', domainKey: 'deploy' })
    expect(parseDomainTagOutput('```json\n{"new":{"key":"Contract Review","label":"合同审查"}}\n```'))
      .toEqual({ kind: 'new', domainKey: 'contract-review', label: '合同审查' })
    expect(parseDomainTagOutput('前缀 {"match":"合同审查"} 后缀')).toEqual({ kind: 'none' })
    expect(parseDomainTagOutput('{"new":{"key":"!!","label":"无键"}}')).toEqual({ kind: 'none' })
    expect(parseDomainTagOutput('{"new":{"key":"x","label":"  "}}')).toEqual({ kind: 'new', domainKey: 'x' })
    expect(() => parseDomainTagOutput('Nothing to save')).toThrow(DomainTagParseError)
    expect(() => parseDomainTagOutput('[1,2]')).toThrow(/顶层不是 JSON 对象/)
  })

  it('buildDomainTaggingUserText:清单 key:label、空清单占位、消息截头并注明', () => {
    const domains: DomainRecord[] = [
      { domainKey: 'deploy', label: '部署', source: 'free', hitSessions: 3, registered: 1, sessionCount: 2, memoryCount: 0, lastUsedAt: 1, createdAt: 1 },
      { domainKey: 'contract-review', label: '合同审查', source: 'workspace', hitSessions: 0, registered: 1, sessionCount: 1, memoryCount: 0, lastUsedAt: 2, createdAt: 1 },
    ]
    const text = buildDomainTaggingUserText({ firstUserMessage: '帮我把部署脚本改成蓝绿', registeredDomains: domains })
    expect(text).toContain('帮我把部署脚本改成蓝绿')
    expect(text).toContain('- deploy:部署')
    expect(text).toContain('- contract-review:合同审查')
    const empty = buildDomainTaggingUserText({ firstUserMessage: '你好', registeredDomains: [] })
    expect(empty).toContain('(无)')
    const long = buildDomainTaggingUserText({ firstUserMessage: '长'.repeat(DOMAIN_TAG_MESSAGE_MAX_CHARS + 10), registeredDomains: domains })
    expect(long).toContain('(消息过长,已截断)')
    // 截头保 MAX 码点(消息体在第 2 行;「过长」一词含「长」字,只数消息体行)
    expect((long.split('\n')[1]?.match(/长/gu) ?? []).length).toBe(DOMAIN_TAG_MESSAGE_MAX_CHARS)
    const overflow = buildDomainTaggingUserText({
      firstUserMessage: 'x',
      registeredDomains: Array.from({ length: DOMAIN_TAG_CANDIDATE_LIMIT + 5 }, () => ({ ...domains[0]! })),
    })
    expect(overflow).toContain('另有 5 个已注册域省略')
  })
})

describe('M-M3 T10 workspaceDomainKey:显式域键收敛', () => {
  it('ASCII 名收敛 kebab-case;重复调用稳定', () => {
    expect(workspaceDomainKey('Acme Site')).toBe('acme-site')
    expect(workspaceDomainKey('  my_project-2 ')).toBe('my-project-2')
    expect(workspaceDomainKey('agent-basis')).toBe('agent-basis')
  })

  it('纯非 ASCII 名回落 ws-<FNV-1a 8hex> 稳定键(中文工作区名)', () => {
    const key = workspaceDomainKey('客户甲官网')
    expect(key).toMatch(/^ws-[0-9a-f]{8}$/u)
    expect(workspaceDomainKey('客户甲官网')).toBe(key)
    expect(workspaceDomainKey('客户乙官网')).not.toBe(key)
  })

  it('混合名优先 ASCII 收敛(不走哈希)', () => {
    expect(workspaceDomainKey('部署 deploy 2')).toBe('deploy-2')
  })
})

describe('M-M3 T10 resolveDomain:workspace 直注 / 打标归并 / 候选转正', () => {
  it('workspace 显式域:跳过打标直接注册绑定(tagger 不被调用),每会话一次计数', async () => {
    let taggerCalls = 0
    const resolution = await resolveDomain(
      { registry: store, sessionId: 'session-a', workspaceName: '客户甲官网', firstUserMessage: '部署上线' },
      async () => {
        taggerCalls += 1
        return '{"match":"deploy"}'
      },
    )
    expect(taggerCalls).toBe(0)
    expect(resolution.source).toBe('workspace')
    expect(resolution.bound).toBe(true)
    expect(resolution.counted).toBe(true)
    expect(resolution.label).toBe('客户甲官网')
    expect(resolution.domainKey ?? '').toMatch(/^ws-[0-9a-f]{8}$/u)
    expect(store.resolve(resolution.domainKey ?? '')?.source).toBe('workspace')
    clock = 2_000
    const replay = await resolveDomain(
      { registry: store, sessionId: 'session-a', workspaceName: '客户甲官网' },
      async () => '',
    )
    expect(replay.counted).toBe(false)
    expect(replay.bound).toBe(true)
  })

  it('ASCII workspace 名直接作键(18 §1.2 workspace id 即 domain_key)', async () => {
    const resolution = await resolveDomain({ registry: store, sessionId: 's1', workspaceName: 'acme-site' })
    expect(resolution.domainKey).toBe('acme-site')
    expect(resolution.label).toBe('acme-site')
  })

  it('先归并:命中已注册域 → 绑定 + session_count+1(counted=true)', async () => {
    store.ensureWorkspaceDomain('deploy', '部署')
    const resolution = await resolveDomain(
      { registry: store, sessionId: 'session-a', firstUserMessage: '帮我把部署脚本改成蓝绿' },
      async (input) => {
        expect(input.registeredDomains.map(row => row.domainKey)).toEqual(['deploy'])
        return '{"match":"deploy"}'
      },
    )
    expect(resolution).toEqual({ domainKey: 'deploy', label: '部署', source: 'merged', bound: true, counted: true })
    expect(store.resolve('deploy')?.sessionCount).toBe(1)
    expect(store.sessionHitAt('deploy', 'session-a')).not.toBeNull()
  })

  it('无匹配 → 候选计数不绑定;≥3 独立会话转正,转正当次起绑定(promoted)', async () => {
    const tagOf = (text: string) => async (): Promise<string> => text
    const first = await resolveDomain(
      { registry: store, sessionId: 'session-a', firstUserMessage: '合同审查流程怎么走' },
      tagOf('{"new":{"key":"contract-review","label":"合同审查"}}'),
    )
    expect(first).toEqual({ domainKey: 'contract-review', label: '合同审查', source: 'candidate', bound: false, counted: true })
    await resolveDomain({ registry: store, sessionId: 'session-b', firstUserMessage: '合同审查模板' }, tagOf('{"new":{"key":"contract-review"}}'))
    expect(store.resolve('contract-review')?.registered).toBeNull()
    expect(store.resolve('contract-review')?.hitSessions).toBe(2)
    const third = await resolveDomain(
      { registry: store, sessionId: 'session-c', firstUserMessage: '又改合同了' },
      tagOf('{"new":{"key":"contract-review"}}'),
    )
    expect(third.source).toBe('promoted')
    expect(third.bound).toBe(true)
    // label 取首建行展示名(第一会话携带的中文 label 持久留档)
    expect(third.label).toBe('合同审查')
    expect(store.resolve('contract-review')?.registered).toBe(1_000)
    expect(store.list(true).map(row => row.domainKey)).toEqual(['contract-review'])
  })

  it('同会话重复解析不重复计数(marker 已落);候选转正后同会话再解析按 merged 绑定', async () => {
    const tagOf = (text: string) => async (): Promise<string> => text
    await resolveDomain({ registry: store, sessionId: 'session-a', firstUserMessage: '部署一下' }, tagOf('{"new":{"key":"deploy","label":"部署"}}'))
    await resolveDomain({ registry: store, sessionId: 'session-b', firstUserMessage: '部署' }, tagOf('{"new":{"key":"deploy"}}'))
    await resolveDomain({ registry: store, sessionId: 'session-c', firstUserMessage: '部署' }, tagOf('{"new":{"key":"deploy"}}'))
    expect(store.resolve('deploy')?.registered).not.toBeNull()
    // 同会话 a 再解析:marker 命中 → counted=false;域已注册 → 归并绑定
    const again = await resolveDomain(
      { registry: store, sessionId: 'session-a', firstUserMessage: '部署' },
      tagOf('{"new":{"key":"deploy"}}'),
    )
    expect(again.counted).toBe(false)
    expect(again.source).toBe('merged')
    expect(again.bound).toBe(true)
  })

  it('模型给的清单外键视作新候选(不信任「归并」宣称);清单内候选键不被归并', async () => {
    store.ensureWorkspaceDomain('deploy', '部署')
    const outsider = await resolveDomain(
      { registry: store, sessionId: 'session-a', firstUserMessage: '改部署' },
      async () => '{"match":"deploy-x"}',
    )
    expect(outsider.source).toBe('candidate')
    expect(outsider.bound).toBe(false)
    expect(store.resolve('deploy-x')?.hitSessions).toBe(1)
  })

  it('打标输出不打标(none)→ 无域;消息空白或 tagger 缺席 → 无域且不调 LLM', async () => {
    store.ensureWorkspaceDomain('deploy', '部署')
    const none = await resolveDomain(
      { registry: store, sessionId: 'session-a', firstUserMessage: '你好' },
      async () => '{}',
    )
    expect(none).toEqual({ domainKey: null, label: null, source: 'none', bound: false, counted: false })
    const noMessage = await resolveDomain({ registry: store, sessionId: 'session-a' }, async () => {
      throw new Error('不应被调用')
    })
    expect(noMessage.source).toBe('none')
    const noTagger = await resolveDomain({ registry: store, sessionId: 'session-a', firstUserMessage: '部署' })
    expect(noTagger.source).toBe('none')
    expect(store.sessionHitAt('deploy', 'session-a')).toBeNull()
  })

  it('打标失败/解析失败原样上抛(glue 按「下一条消息重试」处理;不产生半计数)', async () => {
    store.ensureWorkspaceDomain('deploy', '部署')
    await expect(resolveDomain(
      { registry: store, sessionId: 'session-a', firstUserMessage: '部署' },
      async () => { throw new Error('llm down') },
    )).rejects.toThrow('llm down')
    await expect(resolveDomain(
      { registry: store, sessionId: 'session-b', firstUserMessage: '部署' },
      async () => '模型抽风了,不是 JSON',
    )).rejects.toThrow(DomainTagParseError)
    expect(store.resolve('deploy')?.sessionCount).toBe(0)
    expect(store.sessionHitAt('deploy', 'session-a')).toBeNull()
    expect(store.sessionHitAt('deploy', 'session-b')).toBeNull()
  })

  it('候选清单截头上限注入(maxCandidates)', async () => {
    for (let index = 0; index < 4; index += 1) {
      store.ensureWorkspaceDomain(`domain-${index}`, `域${index}`)
    }
    await resolveDomain(
      { registry: store, sessionId: 'session-a', firstUserMessage: '任意' },
      async (input) => {
        expect(input.registeredDomains).toHaveLength(2)
        return '{}'
      },
      { maxCandidates: 2 },
    )
  })
})
