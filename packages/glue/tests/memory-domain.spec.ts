/**
 * M-M3 T10 glue 挂载(config.domain,缺省开启):memory 插件在 session/event 流上的
 * 会话域解析接线——首条真人类用户消息触发 resolveDomain(workspace 显式域跳过打标;
 * curator 打标先归并/候选计数),绑定域经装配上下文注入索引当前域区、episodic 写入
 * 的域归属经 domainOf 盖章(18 §1.3);候选期不绑定;解析失败下一条用户消息重试
 * (持久去重不重复计数);disposer 摘监听并关注册表。
 * 库内语义(解析三态/转正阈值/解析防御)在 @eterna/memory tests/domain.spec.ts 钉死,
 * 此处只钉挂载接线与端到端数据流。观察面 = 独立 DomainRegistryStore 连接读同一
 * sqlite + 索引 section 渲染 + memory_write 工具直调(harness toolDefs 捕获)。
 */
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import { DomainRegistryStore, readMemoryAuditEvents } from '@eterna/memory'
import type { ToolDefinition, ToolRunContext } from '@deepseek-ai/dsh-tools'
import { defineMemoryPlugin } from '../src/plugins/memory-plugin.ts'
import { makePluginHarness } from './memory-plugin-harness.ts'

const T0 = 1_793_760_000_000

/** 真人类用户文本事件(与 fake emitSession 的入参一致)。 */
function userProse(text: string, seq: number): { type: string; data: unknown; seq: number; time: number } {
  return {
    type: 'user/message',
    seq,
    time: T0 + seq,
    data: { role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text }] },
  }
}

describe('memory 插件 M-M3 T10 域解析挂载(config.domain)', () => {
  let dir = ''
  let reader: DomainRegistryStore | undefined

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'eterna-glue-memory-domain-'))
  })

  afterEach(async () => {
    reader?.close()
    reader = undefined
    await rm(dir, { recursive: true, force: true })
  })

  /** 开同库独立读连接(观察注册表状态;dispose 后插件侧连接已关,读面不受影响)。 */
  function openReader(): DomainRegistryStore {
    reader = new DomainRegistryStore(join(dir, 'memory.sqlite3'))
    return reader
  }

  /** 预置已注册域(独立连接写同库,模拟历史转正域)。 */
  function seedDomain(key: string, label: string): void {
    const seeder = new DomainRegistryStore(join(dir, 'memory.sqlite3'))
    try {
      seeder.ensureWorkspaceDomain(key, label)
    } finally {
      seeder.close()
    }
  }

  /** 预置一条已批准的域内记忆(域索引区有行才渲染域区头——buildEntityIndex 既有语义)。 */
  function seedMemoryFact(harness: ReturnType<typeof makePluginHarness>, domainKey: string, key: string): void {
    const memory = harness.service('@eterna/memory') as {
      writeEntity(input: { subject: string; key: string; content: string; kind: string }): unknown
    }
    memory.writeEntity({ subject: `domain:${domainKey}`, key, content: `${key} 的域内事实`, kind: 'episodic' })
  }

  function applyPlugin(harness: ReturnType<typeof makePluginHarness>, domain?: unknown): () => void {
    // 本 spec 只钉域解析接线:整固监听面关闭,session/event 监听数恒 1(域解析)
    const plugin = defineMemoryPlugin({
      notesDir: join(dir, 'NOTES'),
      dbPath: join(dir, 'memory.sqlite3'),
      consolidation: { enabled: false },
      ...(domain !== undefined && { domain: domain as never }),
    })
    return plugin.apply(harness.fake as unknown as Context)
  }

  /**
   * 等待会话域解析落库(独立读连接轮询命中 marker)+ 宏任务 flush:DB 行可见时
   * 「resolution 定格到插件内存态」仍在微任务链上,setTimeout(0) 等其排空后再
   * 断言渲染面(微任务必先于下一个宏任务排空,确定性)。
   */
  async function waitForSessionHit(key: string, sessionId: string): Promise<void> {
    await vi.waitFor(() => { expect(openReader().sessionHitAt(key, sessionId)).not.toBeNull() })
    await new Promise(resolve => setTimeout(resolve, 0))
  }

  /** 渲染索引 section(装配上下文按 sessionId 反查域绑定)。 */
  function renderIndex(harness: ReturnType<typeof makePluginHarness>, sessionId: string | null): string {
    const section = harness.sections.find(entry => entry.name === 'memory:index')
    expect(section).toBeDefined()
    const render = section?.text as (assembly: unknown) => string
    return render(sessionId === null ? {} : { agent: { session: { id: sessionId } } })
  }

  function writeTool(harness: ReturnType<typeof makePluginHarness>): ToolDefinition {
    const definition = harness.toolDefs.get('memory_write') as ToolDefinition | undefined
    if (definition === undefined) throw new Error('memory_write 未注册')
    return definition
  }

  function execOf(sessionId: string): ToolRunContext {
    return { name: 'memory_write', callId: 'call-t10', signal: new AbortController().signal, agent: { session: { id: sessionId } } } as unknown as ToolRunContext
  }

  it('缺省开启:挂 session/event + session/disposed 监听(整固关闭后恒 1+1)', () => {
    const harness = makePluginHarness()
    const dispose = applyPlugin(harness)
    expect(harness.listenersOf('session/event')).toHaveLength(1)
    expect(harness.listenersOf('session/disposed')).toHaveLength(1)
    dispose()
    expect(harness.listenersOf('session/event')).toHaveLength(0)
    expect(harness.listenersOf('session/disposed')).toHaveLength(0)
  })

  it('config.domain.enabled=false:不挂域解析监听,事件照发不触发打标', () => {
    const harness = makePluginHarness()
    applyPlugin(harness, { enabled: false })
    expect(harness.listenersOf('session/event')).toHaveLength(0)
    harness.emitSession(userProse('帮我把部署脚本改成蓝绿', 1), { id: 'session-a' })
    expect(harness.llmPrepared).toHaveLength(0)
  })

  it('打标先归并:命中已注册域 → 绑定并注入索引当前域区(session_count+1)', async () => {
    seedDomain('deploy', '部署')
    const harness = makePluginHarness()
    harness.setTagReply('{"match":"deploy"}')
    const dispose = applyPlugin(harness)
    harness.emitSession(userProse('帮我把部署脚本改成蓝绿', 1), { id: 'session-a' })
    await waitForSessionHit('deploy', 'session-a')
    const store = openReader()
    expect(store.resolve('deploy')?.sessionCount).toBe(1)
    expect(store.resolve('deploy')?.source).toBe('workspace') // 预置来源不变(归并不改来源)
    seedMemoryFact(harness, 'deploy', 'deploy-fact')
    const bound = renderIndex(harness, 'session-a')
    expect(bound).toContain('## 当前域索引(deploy)')
    // 不可归属的装配面(无 agent)→ 无域上下文,单区锚点形态
    expect(renderIndex(harness, null)).not.toContain('## 当前域索引')
    dispose()
  })

  it('无匹配 → 候选计数不绑定(索引无域区);≥3 独立会话转正,转正当次起绑定', async () => {
    const harness = makePluginHarness()
    harness.setTagReply('{"new":{"key":"deploy","label":"部署"}}')
    const dispose = applyPlugin(harness)
    harness.emitSession(userProse('部署相关任务', 1), { id: 'session-a' })
    await waitForSessionHit('deploy', 'session-a')
    const store = openReader()
    expect(store.resolve('deploy')?.hitSessions).toBe(1)
    expect(store.resolve('deploy')?.registered).toBeNull()
    expect(renderIndex(harness, 'session-a')).not.toContain('## 当前域索引') // 候选期不绑定
    harness.emitSession(userProse('部署相关任务', 2), { id: 'session-b' })
    await waitForSessionHit('deploy', 'session-b')
    expect(store.resolve('deploy')?.registered).toBeNull()
    harness.emitSession(userProse('部署相关任务', 3), { id: 'session-c' })
    await waitForSessionHit('deploy', 'session-c')
    expect(store.resolve('deploy')?.registered).not.toBeNull()
    seedMemoryFact(harness, 'deploy', 'deploy-fact')
    expect(renderIndex(harness, 'session-c')).toContain('## 当前域索引(deploy)')
    // 独立会话纪律:同会话内的后续用户消息不再触发打标(llm 调用恒 3 次)
    harness.emitSession(userProse('部署相关任务又一条', 4), { id: 'session-a' })
    await new Promise(resolve => setTimeout(resolve, 25))
    expect(harness.llmPrepared).toHaveLength(3)
    dispose()
  })

  it('workspace 显式域:跳过打标直接注册绑定(零 llm 调用),中文名落稳定 ws- 键', async () => {
    const harness = makePluginHarness()
    const dispose = applyPlugin(harness, { workspaceName: 'acme-site' })
    harness.emitSession(userProse('任意首条消息', 1), { id: 'session-a' })
    await waitForSessionHit('acme-site', 'session-a')
    const store = openReader()
    const record = store.resolve('acme-site')
    expect(record?.source).toBe('workspace')
    expect(record?.registered).not.toBeNull()
    expect(record?.sessionCount).toBe(1)
    expect(harness.llmPrepared).toHaveLength(0) // 显式域不花打标调用
    seedMemoryFact(harness, 'acme-site', 'site-fact')
    expect(renderIndex(harness, 'session-a')).toContain('## 当前域索引(acme-site)')
    dispose()

    const harness2 = makePluginHarness()
    const dispose2 = applyPlugin(harness2, { workspaceName: '客户甲官网' })
    harness2.emitSession(userProse('任意首条消息', 1), { id: 'session-b' })
    await vi.waitFor(() => { expect(openReader().list().some(row => row.domainKey.startsWith('ws-'))).toBe(true) })
    const wsKey = openReader().list().find(row => row.domainKey.startsWith('ws-'))?.domainKey ?? ''
    expect(wsKey).toMatch(/^ws-[0-9a-f]{8}$/u)
    expect(openReader().resolve(wsKey)?.label).toBe('客户甲官网')
    seedMemoryFact(harness2, wsKey, 'ws-fact')
    expect(renderIndex(harness2, 'session-b')).toContain(`## 当前域索引(${wsKey})`)
    dispose2()
  })

  it('episodic 域归属盖章:绑定会话的 memory_write(kind=episodic)以会话域为准,模型域键不信任', async () => {
    seedDomain('deploy', '部署')
    const harness = makePluginHarness()
    harness.setTagReply('{"match":"deploy"}')
    const dispose = applyPlugin(harness)
    harness.emitSession(userProse('帮我把部署脚本改成蓝绿', 1), { id: 'session-a' })
    await waitForSessionHit('deploy', 'session-a')
    const result = await writeTool(harness).execute(
      { subject: 'domain:other', key: 'turn-fact', content: '本次会话做了蓝绿切换', kind: 'episodic' },
      execOf('session-a'),
    )
    expect(result).toMatchObject({ ok: true, subject: 'domain:deploy', sessionDomain: 'deploy', reviewState: 'approved' })
    const memory = harness.service('@eterna/memory') as { readEntity(subject: string, key: string): { subject: string; domainKey: string; originSessionId: string } | null }
    const row = memory.readEntity('domain:deploy', 'turn-fact')
    expect(row?.subject).toBe('domain:deploy')
    expect(row?.domainKey).toBe('deploy')
    expect(row?.originSessionId).toBe('session-a')
    dispose()
  })

  it('episodic 域归属:semantic 写入与未绑定会话不受干预(模型 subject 照旧)', async () => {
    seedDomain('deploy', '部署')
    const harness = makePluginHarness()
    harness.setTagReply('{"match":"deploy"}')
    const dispose = applyPlugin(harness)
    const write = writeTool(harness)
    // 未绑定会话:episodic 模型域键照旧
    const unbound = await write.execute(
      { subject: 'domain:other', key: 'unbound-fact', content: '未绑定会话记录', kind: 'episodic' },
      execOf('session-z'),
    )
    expect(unbound).toMatchObject({ ok: true, subject: 'domain:other' })
    // 绑定会话的 semantic 写入:模型域键说了算(域归属只盖 episodic)
    harness.emitSession(userProse('帮我把部署脚本改成蓝绿', 1), { id: 'session-a' })
    await waitForSessionHit('deploy', 'session-a')
    const semantic = await write.execute(
      { subject: 'domain:other', key: 'fact', content: '稳定事实', kind: 'semantic' },
      execOf('session-a'),
    )
    expect(semantic).toMatchObject({ ok: true, subject: 'domain:other' })
    dispose()
  })

  it('打标失败:不绑定并下一条用户消息重试,成功后计数一次(持久去重不重复)', async () => {
    seedDomain('deploy', '部署')
    const harness = makePluginHarness()
    harness.setTagReply('模型抽风了,不是 JSON')
    const dispose = applyPlugin(harness)
    harness.emitSession(userProse('帮我把部署脚本改成蓝绿', 1), { id: 'session-a' })
    await new Promise(resolve => setTimeout(resolve, 25))
    const store = openReader()
    expect(store.sessionHitAt('deploy', 'session-a')).toBeNull()
    expect(renderIndex(harness, 'session-a')).not.toContain('## 当前域索引')
    // 下一条消息重试:换好应答 → 绑定;命中计数恰一次
    harness.setTagReply('{"match":"deploy"}')
    harness.emitSession(userProse('继续部署的事', 2), { id: 'session-a' })
    await waitForSessionHit('deploy', 'session-a')
    expect(store.resolve('deploy')?.sessionCount).toBe(1)
    seedMemoryFact(harness, 'deploy', 'deploy-fact')
    expect(renderIndex(harness, 'session-a')).toContain('## 当前域索引(deploy)')
    dispose()
  })

  it('session/disposed 摘状态:已定格会话 dispose 后同 id 重新触发解析', async () => {
    seedDomain('deploy', '部署')
    const harness = makePluginHarness()
    harness.setTagReply('{"match":"deploy"}')
    const dispose = applyPlugin(harness)
    harness.emitSession(userProse('帮我把部署脚本改成蓝绿', 1), { id: 'session-a' })
    await waitForSessionHit('deploy', 'session-a')
    harness.emitDisposed({ id: 'session-a' })
    // 同 id 再来一条用户消息:状态已摘,重新解析(同会话 id 不会重复计数——持久 marker)
    harness.setTagReply('{"new":{"key":"deploy"}}')
    harness.emitSession(userProse('又一条部署消息', 2), { id: 'session-a' })
    await new Promise(resolve => setTimeout(resolve, 25))
    expect(harness.llmPrepared).toHaveLength(2) // 二次打标调用发生(状态确已摘除)
    dispose()
  })

  it('插件 disposer:摘监听并关注册表,后续用户消息不再触发解析', async () => {
    seedDomain('deploy', '部署')
    const harness = makePluginHarness()
    harness.setTagReply('{"match":"deploy"}')
    const dispose = applyPlugin(harness)
    dispose()
    expect(harness.listenersOf('session/event')).toHaveLength(0)
    harness.emitSession(userProse('帮我把部署脚本改成蓝绿', 1), { id: 'session-a' })
    await new Promise(resolve => setTimeout(resolve, 25))
    expect(harness.llmPrepared).toHaveLength(0)
    expect(openReader().sessionHitAt('deploy', 'session-a')).toBeNull()
  })

  it('config.domain.indexTokens:覆写索引域区 token 上限(进装配选项)', async () => {
    seedDomain('deploy', '部署')
    const harness = makePluginHarness()
    harness.setTagReply('{"match":"deploy"}')
    applyPlugin(harness, { indexTokens: 120 })
    harness.emitSession(userProse('帮我把部署脚本改成蓝绿', 1), { id: 'session-a' })
    await waitForSessionHit('deploy', 'session-a')
    seedMemoryFact(harness, 'deploy', 'deploy-fact')
    expect(renderIndex(harness, 'session-a')).toContain('## 当前域索引(deploy)')
    // 预算收紧的可观察面:域区行受 120 token 上限约束(渲染仍含域区头,截断行为在库内钉死)
  })

  it('T13 指标埋点:解析定格写 domain-resolve 审计行(归并绑定;每会话一行)', async () => {
    seedDomain('deploy', '部署')
    const harness = makePluginHarness()
    harness.setTagReply('{"match":"deploy"}')
    const dispose = applyPlugin(harness)
    try {
      harness.emitSession(userProse('帮我把部署脚本改成蓝绿', 1), { id: 'session-audit' })
      await waitForSessionHit('deploy', 'session-audit')
      const events = readMemoryAuditEvents(join(dir, 'memory-audit.jsonl'))
      const resolves = events.filter(entry => (entry as { kind?: string }).kind === 'domain-resolve')
      expect(resolves).toHaveLength(1)
      expect(resolves[0]).toMatchObject({
        kind: 'domain-resolve', sessionId: 'session-audit', domainKey: 'deploy', source: 'merged', bound: true,
      })
    } finally {
      dispose()
    }
  })
})
