/**
 * T2.6 运行时层自管改造(memory 插件经提示词注册表读 section 行为头):
 * - 注册表在场:挂载的 memory:index section 文本取注册表条目当前生效文本,
 *   注册表值变化后同一 section 再装配即新文(读取面每轮活取,装载顺序无关);
 * - 注册表缺席:apply 不抛,section 落 @eterna/memory 内置兜底文本(非空),宿主照常起;
 * - disposer 语义不变:卸载全部工具与 section,幂等。
 * ctx 形态 = makeFakeContext(服务经 services 表 + ctx.get 机会读取,对齐真实 cordis
 * reflect mixin;tools/systemPrompt 两个 inject 面以属性镜像注入)。
 */
import { mkdirSync, readFileSync } from 'node:fs'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { zstdCompressSync } from 'node:zlib'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import { MEMORY_BEHAVIOR_HEADER, MEMORY_SECTION_REGISTRY_ENTRY_ID, PROMPT_REGISTRY_SERVICE_ID } from '@eterna/memory'
import type { PromptRegistryFace } from '@eterna/memory'
import { defineMemoryPlugin, ETERNA_MEMORY_PLUGIN_NAME } from '../src/plugins/memory-plugin.ts'
import { makePluginHarness } from './memory-plugin-harness.ts'
import type { SectionLike } from './memory-plugin-harness.ts'

/** 可变注册表假体(记录取值条目 id;文本可变模拟注册表版本变化)。 */
function fakeRegistry(initial: string): { face: PromptRegistryFace; asked: string[]; setText(text: string): void } {
  const state = { text: initial }
  const asked: string[] = []
  return {
    asked,
    setText: (text: string) => { state.text = text },
    face: {
      resolveRuntimePromptText: (entryId: string): string => {
        asked.push(entryId)
        return state.text
      },
    },
  }
}

describe('memory 插件 T2.6 登记制(section 行为头从提示词注册表读)', () => {
  let dir = ''

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'eterna-glue-memory-plugin-'))
  })

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  function applyPlugin(harness: ReturnType<typeof makePluginHarness>): () => void {
    const plugin = defineMemoryPlugin({ notesDir: join(dir, 'NOTES'), dbPath: join(dir, 'memory.sqlite3') })
    expect(plugin.name).toBe(ETERNA_MEMORY_PLUGIN_NAME)
    return plugin.apply(harness.fake as unknown as Context)
  }

  function indexSectionOf(harness: ReturnType<typeof makePluginHarness>): SectionLike {
    const section = harness.sections.find(item => item.name === 'memory:index')
    expect(section, 'memory:index section 未挂载').toBeDefined()
    return section as SectionLike
  }

  it('注册表在场:section 文本取注册表条目文本(以注册表条目 id 取值),四工具照常挂载', () => {
    const harness = makePluginHarness()
    const registry = fakeRegistry('## 长期记忆(注册表版 V1)')
    harness.provide(PROMPT_REGISTRY_SERVICE_ID, registry.face)
    applyPlugin(harness)
    expect(harness.tools).toHaveLength(4)
    const render = indexSectionOf(harness).text as () => string
    expect(render()).toContain('## 长期记忆(注册表版 V1)')
    expect(render()).not.toContain(MEMORY_BEHAVIOR_HEADER)
    // 每次装配都以注册表条目 id 取值(render 调了两次,asked 记两条,条目 id 恒一)。
    expect(registry.asked.length).toBeGreaterThan(0)
    expect([...new Set(registry.asked)]).toEqual([MEMORY_SECTION_REGISTRY_ENTRY_ID])
  })

  it('注册表缺席:apply 不抛,section 落内置兜底文本(非空),宿主照常起', () => {
    const harness = makePluginHarness()
    expect(() => { applyPlugin(harness) }).not.toThrow()
    expect(harness.tools).toHaveLength(4)
    const text = (indexSectionOf(harness).text as () => string)()
    expect(text).toContain(MEMORY_BEHAVIOR_HEADER)
    expect(MEMORY_BEHAVIOR_HEADER.trim().length).toBeGreaterThan(0)
  })

  it('活绑定:插件装载时注册表未挂 → 先落兜底;随后注册表上桌,同一 section 再装配即新文(装载顺序无关)', () => {
    const harness = makePluginHarness()
    applyPlugin(harness)
    const render = indexSectionOf(harness).text as () => string
    expect(render()).toContain(MEMORY_BEHAVIOR_HEADER)
    const registry = fakeRegistry('## 长期记忆(晚装载注册表 V2)')
    const disposeService = harness.provide(PROMPT_REGISTRY_SERVICE_ID, registry.face)
    expect(render()).toContain('晚装载注册表 V2') // 读取面每轮装配现取服务,不缓存于 apply 时刻
    registry.setText('## 长期记忆(晚装载注册表 V3)')
    expect(render()).toContain('晚装载注册表 V3')
    disposeService()
    expect(render()).toContain(MEMORY_BEHAVIOR_HEADER) // 服务下桌 → 回落兜底
  })

  it('读取面方法抛异常:装配不炸,落内置兜底文本', () => {
    const harness = makePluginHarness()
    harness.provide(PROMPT_REGISTRY_SERVICE_ID, {
      resolveRuntimePromptText: () => { throw new Error('注册表读取面故障') },
    })
    applyPlugin(harness)
    const render = indexSectionOf(harness).text as () => string
    expect(render).not.toThrow()
    expect(render()).toContain(MEMORY_BEHAVIOR_HEADER)
  })

  it('disposer 语义不变:卸载全部工具与 section,幂等', () => {
    const harness = makePluginHarness()
    harness.provide(PROMPT_REGISTRY_SERVICE_ID, fakeRegistry('## 长期记忆(注册表版 V1)').face)
    const dispose = applyPlugin(harness)
    expect(harness.tools).toHaveLength(4)
    expect(harness.sections).toHaveLength(1)
    dispose()
    expect(harness.tools).toHaveLength(0)
    expect(harness.sections).toHaveLength(0)
    dispose() // 幂等
  })
  // ---------- M-M1 T3(portrait.md 缓存读取):置于本 describe 内以复用 harness/dir 助手 ----------
  it('文件上桌:画像区注入正文并剥离 frontmatter;再生成后同 section 下一轮装配即新文(活取)', async () => {
    const harness = makePluginHarness()
    applyPlugin(harness)
    const render = indexSectionOf(harness).text as () => string
    expect(render()).not.toContain('## 用户画像') // 尚无画像文件 → 省略画像区

    await writeFile(join(dir, 'portrait.md'), '---\nversion: 1\nsource_memory_ids: [3, 7]\n---\n## 工作习惯\n偏好中文周报\n', 'utf8')
    const withPortrait = render()
    expect(withPortrait).toContain('## 用户画像')
    expect(withPortrait).toContain('偏好中文周报')
    expect(withPortrait).not.toContain('source_memory_ids') // frontmatter(版本溯源元数据)不进 systemPrompt

    await writeFile(join(dir, 'portrait.md'), '---\nversion: 2\nsource_memory_ids: [3]\n---\n## 工作习惯\n偏好英文周报\n', 'utf8')
    expect(render()).toContain('偏好英文周报') // T4 再生成后无需重启
    expect(render()).not.toContain('偏好中文周报')
  })

  it('画像文件缺失/只剩 frontmatter:持续省略画像区,装配不炸', async () => {
    const harness = makePluginHarness()
    applyPlugin(harness)
    const render = indexSectionOf(harness).text as () => string
    expect(render()).not.toContain('## 用户画像')
    expect(render()).toContain(MEMORY_BEHAVIOR_HEADER)

    await writeFile(join(dir, 'portrait.md'), '---\nversion: 1\n---\n', 'utf8') // 空画像(只有 frontmatter)
    expect(render()).not.toContain('## 用户画像')
    expect(render()).toContain('## 记忆索引')
  })
})

// ---------- M-M2 T9 审批闭环(19 号 §4-T9 + 勘察 S2 结论) ----------

/**
 * T9 接线:Memory 服务以 '@eterna/memory' provide 到 ctx(面板裁决端点消费面);
 * 审计账本(.eterna/memory-audit.jsonl,与 dbPath 同目录)三类事件穿线——
 * review 包装器记审批行 / 门控 skip 记门控行 / 提取落库记提案行(含 pending 卡片)。
 */
describe('memory 插件 T9 审批闭环(服务注册 + 审计账本)', () => {
  let dir = ''
  let previousHome: string | undefined

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'eterna-glue-memory-t9-'))
    previousHome = process.env.DSH_HOME
  })

  afterEach(async () => {
    if (previousHome === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = previousHome
    await rm(dir, { recursive: true, force: true })
  })

  /** 账本事件回读(一行一事;坏行忽略)。 */
  function auditEvents(): Array<Record<string, unknown>> {
    try {
      return readFileSync(join(dir, 'memory-audit.jsonl'), 'utf8')
        .split('\n').filter(line => line.trim().length > 0)
        .map(line => JSON.parse(line) as Record<string, unknown>)
    } catch {
      return []
    }
  }

  async function until(condition: () => boolean, timeoutMs = 2_000): Promise<void> {
    const deadline = Date.now() + timeoutMs
    while (!condition()) {
      if (Date.now() > deadline) throw new Error('等待审计事件超时')
      await new Promise(resolve => setTimeout(resolve, 10))
    }
  }

  /** 记忆服务消费面(结构子集;真实实例由插件 provide)。 */
  interface MemoryServiceLike {
    writeEntity(input: Record<string, unknown>): { record: { id: number } }
    review(id: number, decision: 'approved' | 'rejected'): unknown
  }

  it('Memory 服务以 @eterna/memory 注册;review 落定经包装器记一行审批审计', () => {
    const harness = makePluginHarness()
    const plugin = defineMemoryPlugin({ notesDir: join(dir, 'NOTES'), dbPath: join(dir, 'memory.sqlite3') })
    const disposer = plugin.apply(harness.fake as unknown as Context)
    const memory = harness.service('@eterna/memory') as MemoryServiceLike
    expect(memory).toBeDefined()

    // user+semantic 写入 → pending;review 落定 → 审批行(kind/decision/subject/key)
    const written = memory.writeEntity({ subject: 'user', key: 'audit-flow', content: '周报用中文。', kind: 'semantic' })
    expect(memory.review(written.record.id, 'approved')).toMatchObject({ reviewState: 'approved' })
    const events = auditEvents()
    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({
      kind: 'review', id: written.record.id, decision: 'approved', subject: 'user', key: 'audit-flow',
    })
    expect(typeof events[0]?.time).toBe('string')

    // 行不存在:没有裁决发生,不记行
    expect(memory.review(999_999, 'rejected')).toBeNull()
    expect(auditEvents()).toHaveLength(1)

    disposer()
    expect(harness.service('@eterna/memory')).toBeUndefined() // 配逆即注销
  })

  it('门控 skip 记一行门控审计(direct-write / no-user-prose / credential-redline)', () => {
    const harness = makePluginHarness()
    const plugin = defineMemoryPlugin({ notesDir: join(dir, 'NOTES'), dbPath: join(dir, 'memory.sqlite3') })
    const disposer = plugin.apply(harness.fake as unknown as Context)

    // 会话有 memory_write 调用 + 会话尾(turn/end completed,endedAt=1400)→ direct-write skip
    harness.emitSession({ type: 'tool/call', seq: 1, time: 1000, data: { turn: 1, step: 1, callId: 'c1', name: 'memory_write', arguments: '{}' } }, { id: 'session-skip' })
    harness.emitSession({ type: 'turn/end', seq: 2, time: 1400, data: { turn: 1, reason: { kind: 'completed' } } }, { id: 'session-skip' })
    expect(auditEvents()).toEqual([expect.objectContaining({ kind: 'gate', sessionId: 'session-skip', reason: 'direct-write' })])

    // 无 prose 会话(no-user-prose):单字用户文本 <3 词
    harness.emitSession({ type: 'user/message', seq: 1, time: 1000, data: { role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text: '好' }], id: 'u1' } }, { id: 'session-prose' })
    harness.emitSession({ type: 'turn/end', seq: 2, time: 1400, data: { turn: 1, reason: { kind: 'completed' } } }, { id: 'session-prose' })
    // 凭据红线(credential-redline):approval/asked 在场(有 prose,跳过 no-user-prose 门,
    // 落到顺序第三的凭据红线门)
    harness.emitSession({ type: 'user/message', seq: 1, time: 1000, data: { role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text: '请帮我付款给供应商' }], id: 'u1' } }, { id: 'session-asked' })
    harness.emitSession({ type: 'approval/asked', seq: 2, time: 1100, data: {} }, { id: 'session-asked' })
    harness.emitSession({ type: 'turn/end', seq: 2, time: 1400, data: { turn: 1, reason: { kind: 'completed' } } }, { id: 'session-asked' })
    const reasons = auditEvents().map(event => event['reason'])
    expect(reasons).toEqual(['direct-write', 'no-user-prose', 'credential-redline'])
    disposer()
  })

  it('端到端:会话尾整固提案落库 → 提案审计行含 pending 卡片(标题/出处摘要/键);pending 行入库', async () => {
    // 盘面会话日志($DSH_HOME/sessions/<area>/<sessionId>/session.v4.jsonl.zstd)
    process.env.DSH_HOME = dir
    const logDir = join(dir, 'sessions', 'workspace', 'session-a')
    mkdirSync(logDir, { recursive: true })
    const logLines = [
      '{"type":"session","version":4,"id":"session-a","createdAt":1,"cwd":"/w","isSeeded":false,"delegationDepth":0}',
      '{"type":"user/message","seq":2,"time":1100,"data":{"role":"user","source":{"kind":"user"},"content":[{"type":"text","text":"以后周报用中文"}],"id":"u1"}}',
      '{"type":"turn/end","seq":5,"time":1400,"data":{"turn":1,"reason":{"kind":"completed"}}}',
    ]
    await writeFile(join(logDir, 'session.v4.jsonl.zstd'), zstdCompressSync(Buffer.from(`${logLines.join('\n')}\n`, 'utf8')))

    const harness = makePluginHarness()
    harness.setLlmReply(JSON.stringify([
      { op: 'add', scope: 'user', kind: 'semantic', key: 'weekly-report-language', content: '周报用中文。', summary: '周报用中文', confidence: 0.9 },
    ]))
    const plugin = defineMemoryPlugin({ notesDir: join(dir, 'NOTES'), dbPath: join(dir, 'memory.sqlite3') })
    const disposer = plugin.apply(harness.fake as unknown as Context)

    // 门控全过(≥3 词用户文本)→ 调度整固;任务异步收尾,轮询提案行
    harness.emitSession({ type: 'user/message', seq: 1, time: 1100, data: { role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text: '以后周报用中文' }], id: 'u1' } }, { id: 'session-a' })
    harness.emitSession({ type: 'turn/end', seq: 2, time: 1400, data: { turn: 1, reason: { kind: 'completed' } } }, { id: 'session-a' })
    await until(() => auditEvents().some(event => event['kind'] === 'proposal'))

    const proposal = auditEvents().find(event => event['kind'] === 'proposal')
    expect(proposal).toMatchObject({
      sessionId: 'session-a', turn: 1, source: 'consolidation', add: 1, skipped: 0,
      pending: [expect.objectContaining({ subject: 'user', key: 'weekly-report-language' })],
    })
    const card = proposal?.['card'] as Record<string, unknown>
    expect(card['title']).toBe('从本次会话学到…')
    expect(card['grade']).toBe('R2')
    expect(String(card['detail'])).toContain('出处会话摘要:以后周报用中文')
    expect(String(card['detail'])).toContain('待审记忆 1 条:weekly-report-language')

    // pending 行已入库(写入口分级卡控),批准后生效
    const memory = harness.service('@eterna/memory') as MemoryServiceLike & {
      readEntity(subject: string, key: string): { reviewState: string } | null
      listForReview(state: string): readonly unknown[]
    }
    expect(memory.readEntity('user', 'weekly-report-language')?.reviewState).toBe('pending')
    expect(memory.listForReview('pending')).toHaveLength(1)
    disposer()
  })
})
