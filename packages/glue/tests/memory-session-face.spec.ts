/**
 * memory 插件 M-M3 T12 服务面单测(19 号 §5-T12):
 * - 配置文件桥热应用:.eterna/memory.config.json 的 writePolicy 键经
 *   MemoryOptions.writePolicy 每次写入现读——full-auto 档 user+semantic 写入
 *   直接 approved;explicit-only 档一律 pending;文件缺席回落现行规则。
 *   布局用生产缺省形态(dbPath=<dir>/.eterna/memory.sqlite3,overrides 文件经
 *   memoryOverridesPathForDb 与 dbPath 同目录)并写在 admin 语义写路径
 *   (memoryOverridesPath(dir))——缺省布局下两端同路径的端到端回归
 *   (M-M3 评审:glue 曾误拼 .eterna 两层,热改键永不生效);
 * - 会话域切换面('eternaMemorySession' 服务,域识别 chip 数据面):
 *   provide 存在性(域开/关)、sessionDomainView 三态、overrideDomain 写
 *   domain_registry last_used + 下次索引装配用新域、非法域键拒绝、清除回自动。
 */
import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import type { ToolDefinition, ToolRunContext } from '@deepseek-ai/dsh-tools'
import { DomainRegistryStore } from '@eterna/memory'
import { defineMemoryPlugin } from '../src/plugins/memory-plugin.ts'
import { ETERNA_MEMORY_SESSION_SERVICE_ID, memoryOverridesPath } from '@eterna/memory'
import { makePluginHarness } from './memory-plugin-harness.ts'

let dir = ''
let reader: DomainRegistryStore | undefined

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'eterna-glue-memory-t12-'))
  // 生产缺省布局前置:.eterna/ 目录(sqlite/overrides/域注册表都落这里)
  await mkdir(join(dir, '.eterna'), { recursive: true })
})

afterEach(async () => {
  reader?.close()
  reader = undefined
  await rm(dir, { recursive: true, force: true })
})

/** 生产缺省布局的 dbPath(<dir>/.eterna/memory.sqlite3;overrides 文件随之同目录)。 */
function dbPath(): string {
  return join(dir, '.eterna', 'memory.sqlite3')
}

function openReader(): DomainRegistryStore {
  reader = new DomainRegistryStore(dbPath())
  return reader
}

function seedDomain(key: string, label: string): void {
  const seeder = new DomainRegistryStore(dbPath())
  try {
    seeder.ensureWorkspaceDomain(key, label)
  } finally {
    seeder.close()
  }
}

function applyPlugin(harness: ReturnType<typeof makePluginHarness>, domain?: unknown): () => void {
  const plugin = defineMemoryPlugin({
    notesDir: join(dir, 'NOTES'),
    dbPath: dbPath(),
    consolidation: { enabled: false },
    ...(domain !== undefined && { domain: domain as never }),
  })
  return plugin.apply(harness.fake as unknown as Context)
}

function writeTool(harness: ReturnType<typeof makePluginHarness>): ToolDefinition {
  const definition = harness.toolDefs.get('memory_write') as ToolDefinition | undefined
  if (definition === undefined) throw new Error('memory_write 未注册')
  return definition
}

function execOf(sessionId: string): ToolRunContext {
  return { name: 'memory_write', callId: 'call-t12', signal: new AbortController().signal, agent: { session: { id: sessionId } } } as unknown as ToolRunContext
}

function sessionFaceOf(harness: ReturnType<typeof makePluginHarness>): {
  sessionDomainView(sessionId: string): { domainKey: string | null; overridden: boolean }
  overrideDomain(sessionId: string, domainKey: string | null): { domainKey: string | null }
  listRegisteredDomains(): readonly { domainKey: string; label: string }[]
} {
  const face = harness.service(ETERNA_MEMORY_SESSION_SERVICE_ID)
  if (face === undefined || face === null) throw new Error('eternaMemorySession 服务未注册')
  return face as never
}

/** 渲染索引 section(装配上下文按 sessionId 反查域绑定)。 */
function renderIndex(harness: ReturnType<typeof makePluginHarness>, sessionId: string | null): string {
  const section = harness.sections.find(entry => entry.name === 'memory:index')
  expect(section).toBeDefined()
  const render = section?.text as (assembly: unknown) => string
  return render(sessionId === null ? {} : { agent: { session: { id: sessionId } } })
}

describe('T12-① 写入策略档位热应用(配置文件桥)', () => {
  it('full-auto 档:user+semantic 的 agent 写入直接 approved(不再 pending)', async () => {
    // admin 语义写路径(memoryOverridesPath(dir)):缺省布局下 glue 经
    // memoryOverridesPathForDb(dbPath) 热读同一文件——两端同路径回归
    await writeFile(memoryOverridesPath(dir), JSON.stringify({ writePolicy: 'full-auto' }))
    const harness = makePluginHarness()
    applyPlugin(harness)
    const result = await writeTool(harness).execute(
      { subject: 'user', key: 'pref', content: '全自动档的偏好', kind: 'semantic' },
      execOf('session-full'),
    ) as { reviewState: string }
    expect(result.reviewState).toBe('approved')
  })

  it('explicit-only 档:agent 写入一律 pending(最大审批面)', async () => {
    await writeFile(memoryOverridesPath(dir), JSON.stringify({ writePolicy: 'explicit-only' }))
    const harness = makePluginHarness()
    applyPlugin(harness)
    const result = await writeTool(harness).execute(
      { subject: 'domain:deploy', key: 'note-1', content: '仅显式档的会话记录', kind: 'episodic' },
      execOf('session-explicit'),
    ) as { reviewState: string }
    expect(result.reviewState).toBe('pending')
  })

  it('文件缺席:回落现行规则(user+semantic → pending,domain+episodic → approved)', async () => {
    const harness = makePluginHarness()
    applyPlugin(harness)
    const userResult = await writeTool(harness).execute(
      { subject: 'user', key: 'pref', content: '现行规则的偏好', kind: 'semantic' },
      execOf('session-base-a'),
    ) as { reviewState: string }
    expect(userResult.reviewState).toBe('pending')
    const episodicResult = await writeTool(harness).execute(
      { subject: 'domain:deploy', key: 'note-1', content: '现行规则的会话记录', kind: 'episodic' },
      execOf('session-base-b'),
    ) as { reviewState: string }
    expect(episodicResult.reviewState).toBe('approved')
  })
})

describe('T12-③ 会话域切换面(eternaMemorySession)', () => {
  const T0 = 1_700_000_000_000

  /** user/message 事件(shape 对齐 dsh-session:userMessageTextOf 只认 source.kind='user' 的文本块)。 */
  function userProse(text: string, seq: number): { type: string; data: unknown; seq: number; time: number } {
    return {
      type: 'user/message',
      seq,
      time: T0 + seq,
      data: { role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text }] },
    }
  }

  async function bindAuto(harness: ReturnType<typeof makePluginHarness>, sessionId: string, tagReply: string): Promise<void> {
    harness.setTagReply(tagReply)
    harness.emitSession(userProse('帮我把部署脚本改成蓝绿', 1), { id: sessionId })
    await vi.waitFor(() => { expect(openReader().sessionHitAt('deploy', sessionId)).not.toBeNull() })
    await new Promise(resolve => setTimeout(resolve, 0))
  }

  /** 预置一条已批准的域内记忆(域索引区有行才渲染域区头——buildEntityIndex 既有语义)。 */
  function seedMemoryFact(harness: ReturnType<typeof makePluginHarness>, domainKey: string, key: string): void {
    const memory = harness.service('@eterna/memory') as {
      writeEntity(input: { subject: string; key: string; content: string; kind: string; reviewState?: string }): unknown
    }
    memory.writeEntity({ subject: `domain:${domainKey}`, key, content: `${key} 的域内事实`, kind: 'semantic', reviewState: 'approved' })
  }

  it('域识别开启 → 服务在场;关闭(config.domain.enabled=false)→ 不提供', () => {
    const harness = makePluginHarness()
    const detach = applyPlugin(harness, { enabled: true })
    expect(harness.service(ETERNA_MEMORY_SESSION_SERVICE_ID)).toBeDefined()
    detach()
    const harnessOff = makePluginHarness()
    applyPlugin(harnessOff, { enabled: false })
    expect(harnessOff.service(ETERNA_MEMORY_SESSION_SERVICE_ID)).toBeUndefined()
  })

  it('自动绑定 → view.bound;overrideDomain(已注册域)→ overridden+写 last_used;清除回自动', async () => {
    seedDomain('deploy', '部署')
    seedDomain('contract-review', '合同审查')
    const harness = makePluginHarness()
    const detach = applyPlugin(harness)
    await bindAuto(harness, 'session-sw', '{"match":"deploy"}')
    const face = sessionFaceOf(harness)
    // 自动绑定态
    expect(face.sessionDomainView('session-sw')).toEqual({ domainKey: 'deploy', overridden: false })
    // 人工切换:写 last_used(session_count+1)并记 override
    const before = openReader().resolve('contract-review')
    const switched = face.overrideDomain('session-sw', 'contract-review')
    expect(switched).toEqual({ domainKey: 'contract-review' })
    expect(face.sessionDomainView('session-sw')).toEqual({ domainKey: 'contract-review', overridden: true })
    const after = openReader().resolve('contract-review')
    expect(after?.lastUsedAt).toBeGreaterThanOrEqual(before?.lastUsedAt ?? 0)
    // 下次索引装配即用新域(19 号 §5-T12.3「当前索引域更新」;域区有行才渲染域区头)
    seedMemoryFact(harness, 'contract-review', 'switched-fact')
    expect(renderIndex(harness, 'session-sw')).toContain('contract-review')
    // 清除 → 回自动绑定域
    face.overrideDomain('session-sw', null)
    expect(face.sessionDomainView('session-sw')).toEqual({ domainKey: 'deploy', overridden: false })
    detach()
  })

  it('overrideDomain 域键合法性:候选/未知键 RangeError 拒绝(不写 override)', async () => {
    seedDomain('deploy', '部署')
    const harness = makePluginHarness()
    const detach = applyPlugin(harness)
    await bindAuto(harness, 'session-guard', '{"match":"deploy"}')
    const face = sessionFaceOf(harness)
    expect(() => face.overrideDomain('session-guard', 'ghost-domain')).toThrow(/未注册/)
    expect(face.sessionDomainView('session-guard')).toEqual({ domainKey: 'deploy', overridden: false })
    detach()
  })

  it('listRegisteredDomains:只列已转正域(候选不进 chip 列表)', () => {
    seedDomain('deploy', '部署')
    const harness = makePluginHarness()
    const detach = applyPlugin(harness)
    const seeder = new DomainRegistryStore(dbPath())
    seeder.recordHit('candidate-domain')
    seeder.close()
    expect(sessionFaceOf(harness).listRegisteredDomains()).toEqual([{ domainKey: 'deploy', label: '部署' }])
    detach()
  })
})
