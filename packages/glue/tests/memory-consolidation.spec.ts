/**
 * M-M2 T6 glue 挂载(config.consolidation):memory 插件在 session/event 流上的
 * 整固接线——turn/end(completed) 触发、facts 按 session 分桶、非 completed 不
 * 触发、enabled 开关、session/disposed 兜底不炸、disposer 摘监听。
 * M-M2 T7:整固任务接线 curator 直调提取体——DSH_HOME 隔离 + 真实形状 zstd
 * 会话日志,harness fake llm 收到直调、提案落库(source=consolidation、pending)、
 * config.consolidation.model 覆写进 prepareCall 路由。
 * M-M3 T11:双频次接线(19 号 §5-T11 + 19a 号 S4 结论)——轻量 domainOf 穿线
 * (episodic 会话史落域)、重量 Dream 会话尾触发(dream 游标行推进 = lastDreamAt,
 * S4-B 退路)、config.dream.enabled=false 回滚面。
 * 观察面 = 游标表(独立 ConsolidationCursorStore 连接读同一 sqlite)+ llm 假体
 * 调用记录(门控判定与调度语义的 exhaustive 用例在 @eterna/memory
 * tests/consolidation.spec.ts,此处只钉挂载接线)。
 */
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { zstdCompressSync } from 'node:zlib'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import {
  ConsolidationCursorStore, DEFAULT_EXTRACTION_MAX_TOKENS, DREAM_CURSOR_SESSION_ID, createMemory,
} from '@eterna/memory'
import { defineMemoryPlugin } from '../src/plugins/memory-plugin.ts'
import { makePluginHarness } from './memory-plugin-harness.ts'

/** 事件信封弱形状(与 fake emitSession 的入参一致)。 */
interface EventLike {
  readonly type: string
  readonly data: unknown
  readonly seq?: number
  readonly time?: number
}

const T0 = 1_793_760_000_000

function userProse(text: string, seq: number): EventLike {
  return {
    type: 'user/message',
    seq,
    time: T0 + seq,
    data: { role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text }] },
  }
}

function turnEnd(kind: string, turn: number, seq: number): EventLike {
  return { type: 'turn/end', seq, time: T0 + seq, data: { turn, reason: { kind } } }
}

describe('memory 插件 M-M2 T6 整固挂载(config.consolidation)', () => {
  let dir = ''
  let reader: ConsolidationCursorStore | undefined

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'eterna-glue-memory-consolidation-'))
  })

  afterEach(async () => {
    reader?.close()
    reader = undefined
    await rm(dir, { recursive: true, force: true })
  })

  /** 开同库独立读连接(dispose 后插件侧连接已关,读面不受影响)。 */
  function openCursorReader(): ConsolidationCursorStore {
    reader = new ConsolidationCursorStore(join(dir, 'memory.sqlite3'))
    return reader
  }

  /**
   * 域解析接线(config.domain,T10)是独立监听面,本 spec 只钉整固挂载——统一
   * 关闭,监听数/llm 调用数断言保持 T7 时期的口径;域接线的挂载/索引注入/
   * episodic 盖章见 memory-domain.spec.ts(其内反向钉「缺省开启」)。
   * M-M3 T11:重量 Dream 缺省开启,单面测试经 extra 显式关闭(T11 专用用例
   * 在文末:轻量落域 / Dream 触发 / 回滚面)。
   */
  function applyPlugin(harness: ReturnType<typeof makePluginHarness>, consolidation?: unknown, extra?: unknown): () => void {
    const plugin = defineMemoryPlugin({
      notesDir: join(dir, 'NOTES'),
      dbPath: join(dir, 'memory.sqlite3'),
      domain: { enabled: false },
      ...(consolidation !== undefined && { consolidation: consolidation as never }),
      ...(extra !== undefined && { ...(extra as Record<string, unknown>) }),
    })
    return plugin.apply(harness.fake as unknown as Context)
  }

  it('默认开启:真人类 prose 会话的 turn/end(completed) 触发整固,游标落行', async () => {
    const harness = makePluginHarness()
    applyPlugin(harness)
    expect(harness.listenersOf('session/event')).toHaveLength(1)
    expect(harness.listenersOf('session/disposed')).toHaveLength(1)
    harness.emitSession(userProse('以后周报用中文', 1), { id: 'session-a' })
    harness.emitSession(turnEnd('completed', 1, 9), { id: 'session-a' })
    const cursor = openCursorReader()
    await vi.waitFor(() => { expect(cursor.doneAt('session-a')).not.toBeNull() })
  })

  it('direct-write 防双写走挂载面:同会话 memory_write 后的会话尾仍推进游标(门控判定在库内钉死)', async () => {
    const harness = makePluginHarness()
    applyPlugin(harness)
    harness.emitSession(userProse('以后周报用中文', 1), { id: 'session-a' })
    harness.emitSession({
      type: 'tool/call',
      seq: 5,
      time: T0 + 5,
      data: { turn: 1, step: 1, callId: 'c1', name: 'memory_write', arguments: '{}' },
    }, { id: 'session-a' })
    harness.emitSession(turnEnd('completed', 1, 9), { id: 'session-a' })
    const cursor = openCursorReader()
    await vi.waitFor(() => { expect(cursor.doneAt('session-a')).not.toBeNull() })
  })

  it('turn/end 非 completed 不触发(reason=aborted)', async () => {
    const harness = makePluginHarness()
    applyPlugin(harness)
    harness.emitSession(userProse('以后周报用中文', 1), { id: 'session-a' })
    harness.emitSession(turnEnd('aborted', 1, 9), { id: 'session-a' })
    await new Promise(resolve => setTimeout(resolve, 25))
    expect(openCursorReader().doneAt('session-a')).toBeNull()
  })

  it('facts 按 session 分桶:A 的 memory_write 不污染 B 的会话尾(A 无 turn/end 则 A 不触发)', async () => {
    const harness = makePluginHarness()
    applyPlugin(harness)
    harness.emitSession({
      type: 'tool/call',
      seq: 1,
      time: T0 + 1,
      data: { turn: 1, step: 1, callId: 'c1', name: 'memory_write', arguments: '{}' },
    }, { id: 'session-a' })
    harness.emitSession(userProse('以后周报用中文', 2), { id: 'session-b' })
    harness.emitSession(turnEnd('completed', 1, 9), { id: 'session-b' })
    const cursor = openCursorReader()
    await vi.waitFor(() => { expect(cursor.doneAt('session-b')).not.toBeNull() })
    expect(cursor.doneAt('session-a')).toBeNull() // A 无会话尾标记,从不触发
  })

  it('config.consolidation.enabled=false 且 dream 关:完全不挂监听,事件照发不触发', async () => {
    const harness = makePluginHarness()
    applyPlugin(harness, { enabled: false, trigger: 'session-end' }, { dream: { enabled: false } })
    expect(harness.listenersOf('session/event')).toHaveLength(0)
    expect(harness.listenersOf('session/disposed')).toHaveLength(0)
    harness.emitSession(userProse('以后周报用中文', 1), { id: 'session-a' })
    harness.emitSession(turnEnd('completed', 1, 9), { id: 'session-a' })
    await new Promise(resolve => setTimeout(resolve, 25))
    expect(openCursorReader().doneAt('session-a')).toBeNull()
  })

  it('config.consolidation.enabled=false 且 Dream 缺省开:仅挂 Dream 链(键解耦,low#18)', async () => {
    const harness = makePluginHarness()
    applyPlugin(harness, { enabled: false, trigger: 'session-end' })
    expect(harness.listenersOf('session/event')).toHaveLength(1)
    harness.emitSession(turnEnd('completed', 1, 9), { id: 'session-a' })
    await new Promise(resolve => setTimeout(resolve, 25))
    // 轻量提取 no-op:nothing-to-save 仍推进游标(游标照常前进,Dream 阈值合并继续)
    expect(openCursorReader().doneAt('session-a')).not.toBeNull()
  })

  it('trigger 显式声明 session-end(M-M2 唯一档)照常挂载', () => {
    const harness = makePluginHarness()
    applyPlugin(harness, { trigger: 'session-end' })
    expect(harness.listenersOf('session/event')).toHaveLength(1)
  })

  it('session/disposed 兜底:派发不炸(单会话 abort/摘桶在库内钉死)', () => {
    const harness = makePluginHarness()
    applyPlugin(harness)
    expect(() => { harness.emitDisposed({ id: 'session-a' }) }).not.toThrow()
  })

  it('插件 disposer:摘全部监听并收尾,后续事件不再触发', async () => {
    const harness = makePluginHarness()
    const dispose = applyPlugin(harness)
    dispose()
    expect(harness.listenersOf('session/event')).toHaveLength(0)
    expect(harness.listenersOf('session/disposed')).toHaveLength(0)
    harness.emitSession(userProse('以后周报用中文', 1), { id: 'session-a' })
    harness.emitSession(turnEnd('completed', 1, 9), { id: 'session-a' })
    await new Promise(resolve => setTimeout(resolve, 25))
    expect(openCursorReader().doneAt('session-a')).toBeNull()
  })

  // ---------- M-M2 T7:curator 直调提取体接线 ----------

  /** 隔离 DSH_HOME 并放入真实形状的 zstd 会话日志(返回环境恢复函数)。 */
  async function withIsolatedDshHome(sessionId: string): Promise<() => void> {
    const home = join(dir, 'dsh-home')
    const logDir = join(home, 'sessions', '--private-tmp-x--', sessionId)
    await mkdir(logDir, { recursive: true })
    const lines = [
      `{"type":"session","version":4,"id":"${sessionId}","createdAt":1,"cwd":"/w","isSeeded":false,"delegationDepth":0}`,
      '{"type":"user/message","seq":2,"time":1100,"data":{"role":"user","source":{"kind":"user"},"content":[{"type":"text","text":"以后周报用中文"}],"id":"u1"}}',
      '{"type":"assistant/message","seq":4,"time":1300,"data":{"turn":1,"step":1,"message":{"role":"assistant","content":[{"type":"text","text":"好的,之后周报都用中文。"}],"source":{"kind":"model","provider":"p","model":"m"}}}}',
      '{"type":"turn/end","seq":5,"time":1400,"data":{"turn":1,"reason":{"kind":"completed"}}}',
    ]
    await writeFile(join(logDir, 'session.v4.jsonl.zstd'), zstdCompressSync(Buffer.from(`${lines.join('\n')}\n`, 'utf8')))
    const previous = process.env.DSH_HOME
    process.env.DSH_HOME = home
    return () => {
      if (previous === undefined) delete process.env.DSH_HOME
      else process.env.DSH_HOME = previous
    }
  }

  it('T7 接线:turn/end 触发 curator 直调,提案落库(source=consolidation、user+semantic→pending),游标推进', async () => {
    const restore = await withIsolatedDshHome('session-t7')
    try {
      const harness = makePluginHarness()
      harness.setLlmReply(JSON.stringify([
        { op: 'add', scope: 'user', kind: 'semantic', key: 'weekly-report-language', content: '周报用中文。', confidence: 0.9 },
      ]))
      applyPlugin(harness, undefined, { dream: { enabled: false } })
      harness.emitSession(userProse('以后周报用中文', 1), { id: 'session-t7' })
      harness.emitSession(turnEnd('completed', 1, 9), { id: 'session-t7' })
      await vi.waitFor(() => { expect(harness.llmPrepared).toHaveLength(1) })
      const cursor = openCursorReader()
      await vi.waitFor(() => { expect(cursor.doneAt('session-t7')).not.toBeNull() })
      const memory = createMemory({ workspaceDir: join(dir, 'NOTES'), dbPath: join(dir, 'memory.sqlite3') })
      try {
        const row = memory.readEntity('user', 'weekly-report-language')
        expect(row?.source).toBe('consolidation')
        expect(row?.originSessionId).toBe('session-t7')
        expect(row?.reviewState).toBe('pending')
        expect(memory.entities.listLive()).toHaveLength(0) // pending 不进检索面,物理行在
      } finally {
        memory.dispose()
      }
    } finally {
      restore()
    }
  })

  it('T7 接线:config.consolidation.model 覆写进 curator 路由(目录无命中回落 deepseek)', async () => {
    const restore = await withIsolatedDshHome('session-t7-model')
    try {
      const harness = makePluginHarness()
      applyPlugin(harness, { model: 'my-curator' }, { dream: { enabled: false } })
      harness.emitSession(userProse('以后周报用中文', 1), { id: 'session-t7-model' })
      harness.emitSession(turnEnd('completed', 1, 9), { id: 'session-t7-model' })
      await vi.waitFor(() => { expect(harness.llmPrepared).toHaveLength(1) })
      expect(harness.llmPrepared[0]).toEqual({
        provider: 'deepseek', model: 'my-curator', maxTokens: DEFAULT_EXTRACTION_MAX_TOKENS,
      })
      const cursor = openCursorReader()
      await vi.waitFor(() => { expect(cursor.doneAt('session-t7-model')).not.toBeNull() })
    } finally {
      restore()
    }
  })

  // ---------- M-M3 T11:双频次接线(轻量落域 + 重量 Dream;19 号 §5-T11) ----------

  it('T11 轻量:domainOf 穿线(显式 workspace 域)→ episodic 会话史落域', async () => {
    const restore = await withIsolatedDshHome('session-t11-light')
    try {
      const harness = makePluginHarness()
      harness.setLlmReply('Nothing to save')
      applyPlugin(harness, undefined, { dream: { enabled: false }, domain: { workspaceName: 'deploy' } })
      harness.emitSession(userProse('以后周报用中文', 1), { id: 'session-t11-light' })
      harness.emitSession(turnEnd('completed', 1, 9), { id: 'session-t11-light' })
      await vi.waitFor(() => { expect(harness.llmPrepared).toHaveLength(1) }) // 显式域跳过打标,仅提取直调
      const memory = createMemory({ workspaceDir: join(dir, 'NOTES'), dbPath: join(dir, 'memory.sqlite3') })
      try {
        const row = memory.readEntity('domain:deploy', 'session-session-t11-light')
        expect(row).not.toBeNull()
        expect(row).toMatchObject({
          kind: 'episodic', scope: 'domain', domainKey: 'deploy', confidence: 0.5,
          source: 'consolidation', reviewState: 'approved', originSessionId: 'session-t11-light',
        })
        expect(row?.content).toContain('以后周报用中文')
      } finally {
        memory.dispose()
      }
    } finally {
      restore()
    }
  })

  it('T11 重量:首个会话尾到期即触发 Dream,轻量先落定、dream 游标行推进(lastDreamAt)、画像落盘', async () => {
    const restore = await withIsolatedDshHome('session-t11-dream')
    try {
      const harness = makePluginHarness()
      harness.setLlmReply('Nothing to save')
      applyPlugin(harness) // dream 缺省开
      harness.emitSession(userProse('以后周报用中文', 1), { id: 'session-t11-dream' })
      harness.emitSession(turnEnd('completed', 1, 9), { id: 'session-t11-dream' })
      const cursor = openCursorReader()
      await vi.waitFor(() => { expect(cursor.doneAt('session-t11-dream')).not.toBeNull() }) // 轻量先落定
      await vi.waitFor(() => { expect(cursor.doneAt(DREAM_CURSOR_SESSION_ID)).not.toBeNull() }) // Dream 接续完成
      expect(harness.llmPrepared).toHaveLength(2) // 提取直调 + Dream 整固直调(对账材料缺席跳过)
      expect(existsSync(join(dir, 'portrait.md'))).toBe(true) // Prune:首次画像再生成
    } finally {
      restore()
    }
  })

  it('T11 回滚面:config.dream.enabled=false → 无 dream 游标行,轻量照常', async () => {
    const restore = await withIsolatedDshHome('session-t11-off')
    try {
      const harness = makePluginHarness()
      applyPlugin(harness, undefined, { dream: { enabled: false } })
      harness.emitSession(userProse('以后周报用中文', 1), { id: 'session-t11-off' })
      harness.emitSession(turnEnd('completed', 1, 9), { id: 'session-t11-off' })
      const cursor = openCursorReader()
      await vi.waitFor(() => { expect(cursor.doneAt('session-t11-off')).not.toBeNull() })
      await new Promise(resolve => setTimeout(resolve, 25))
      expect(cursor.doneAt(DREAM_CURSOR_SESSION_ID)).toBeNull() // Dream 未触发
      expect(harness.llmPrepared).toHaveLength(1) // 只有提取直调
    } finally {
      restore()
    }
  })
})
