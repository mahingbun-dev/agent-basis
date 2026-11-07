import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import { PiiFilter } from '@basis/governance'
import auditPlugin, { defaultAuditDir, defineAuditPlugin } from '../src/plugin.ts'
import { AUDIT_ID, AUDIT_SERVICE_ID } from '../src/service.ts'
import type { AuditWorld } from '../src/service.ts'

const T1 = 1_760_000_000_000
const T2 = T1 + 86_400_000

const tempDirs: string[] = []

afterEach(async () => {
  await Promise.all(tempDirs.map(dir => rm(dir, { recursive: true, force: true })))
  tempDirs.length = 0
})

async function tempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'basis-audit-plugin-'))
  tempDirs.push(dir)
  return dir
}

/** 结构性假 ctx:只声明 apply 用到的 provide/on/governance 三面(不依赖 cordis 运行时)。 */
interface FakeContext {
  provide(name: string, value: unknown): () => Promise<void>
  on(event: string, listener: (session: unknown, event: unknown) => void): () => void
  governance?: { pii?: PiiFilter }
}

type SessionListener = (session: unknown, event: unknown) => void

function makeFakeContext(options: { governance?: { pii?: PiiFilter } } = {}) {
  const listeners = new Map<string, Set<SessionListener>>()
  const services = new Map<string, unknown>()
  const fake: FakeContext = {
    provide: (name, value) => {
      services.set(name, value)
      return async () => {
        services.delete(name)
      }
    },
    on: (event, listener) => {
      let set = listeners.get(event)
      if (set === undefined) {
        set = new Set()
        listeners.set(event, set)
      }
      set.add(listener)
      return () => {
        set.delete(listener)
      }
    },
    ...(options.governance !== undefined ? { governance: options.governance } : {}),
  }
  return {
    fake,
    emit(event: { type: string; data: unknown; seq: number; time: number }): void {
      for (const listener of [...(listeners.get('session/event') ?? [])]) listener({}, event)
    },
    listenerCount(event: string): number {
      return listeners.get(event)?.size ?? 0
    },
    services(): string[] {
      return [...services.keys()]
    },
    world(): AuditWorld {
      return services.get(AUDIT_SERVICE_ID) as AuditWorld
    },
  }
}

function callEvent(seq: number, callId: string, name: string, args: string, time: number) {
  return { type: 'tool/call', data: { turn: 1, step: 1, callId, name, arguments: args }, seq, time }
}

function resultEvent(seq: number, callId: string, isError: boolean, time: number) {
  return { type: 'tool/result', data: { turn: 1, step: 1, message: { toolCallId: callId, isError } }, seq, time }
}

async function readAllRecords(dir: string): Promise<Record<string, unknown>[]> {
  const names = (await readdir(dir).catch(() => [] as string[])).sort()
  const lines: string[] = []
  for (const name of names) {
    lines.push(...(await readFile(join(dir, name), 'utf8')).trim().split('\n').filter(line => line.length > 0))
  }
  return lines.map(line => JSON.parse(line) as Record<string, unknown>)
}

function mount(dir: string, harness: ReturnType<typeof makeFakeContext>): () => void {
  return defineAuditPlugin({ dir }).apply(harness.fake as unknown as Context)
}

describe('audit 插件:装载 / 投影 / 卸载', () => {
  it('default export 是插件实例(硬性规范 1:loader 取实例,漏写 = 静默不装载)', () => {
    expect(auditPlugin.name).toBe('basis-audit')
    expect(typeof auditPlugin.apply).toBe('function')
    expect(defaultAuditDir()).toBe(join(process.cwd(), '.basis'))
  })

  it('装载即 provide("audit") → ctx.audit;session/event 增量投影落盘 tool-call 记录', async () => {
    const dir = await tempDir()
    const harness = makeFakeContext()
    const disposer = mount(dir, harness)

    expect(harness.services()).toEqual([AUDIT_SERVICE_ID])
    expect(harness.world().id).toBe(AUDIT_ID)
    expect(harness.listenerCount('session/event')).toBe(1)

    harness.emit(callEvent(1, 'c1', 'budget_calc', '{"totalCny":59400}', T1))
    harness.emit(resultEvent(2, 'c1', false, T1))
    await harness.world().trail.flush()
    const records = await readAllRecords(dir)
    expect(records).toHaveLength(1)
    expect(records[0]).toMatchObject({ kind: 'tool-call', tool: 'budget_calc', isError: false, turn: 1, step: 1 })
    disposer()
  })

  it('参数预览默认过 PII;ctx.governance.pii 在场时复用其实例(机会读取,不 inject)', async () => {
    const dir = await tempDir()
    const harness = makeFakeContext()
    const disposer = mount(dir, harness)
    harness.emit(callEvent(1, 'c1', 'send_email', '{"to":"13800138000@example.com"}', T1))
    harness.emit(resultEvent(2, 'c1', false, T1))
    await harness.world().trail.flush()
    expect(String((await readAllRecords(dir))[0]?.argsPreview)).toContain('[PII:cn-mobile]')
    disposer()

    const dir2 = await tempDir()
    const harness2 = makeFakeContext({ governance: { pii: new PiiFilter([{ id: 'vendor-token', pattern: /SECRET/ }]) } })
    const disposer2 = mount(dir2, harness2)
    harness2.emit(callEvent(1, 'c1', 'send_email', '{"body":"SECRET and 13800138000"}', T1))
    harness2.emit(resultEvent(2, 'c1', false, T1))
    await harness2.world().trail.flush()
    const preview = String((await readAllRecords(dir2))[0]?.argsPreview)
    expect(preview).toContain('[PII:vendor-token]')
    expect(preview).not.toContain('[PII:cn-mobile]')
    expect(preview).toContain('13800138000') // governance 实例没有手机号模式 → 证明复用的是它而非兜底
    disposer2()
  })

  it('report():治理侧直投,detail.actor 提升为记录级 actor(⑧插件粒度)', async () => {
    const dir = await tempDir()
    const harness = makeFakeContext()
    const disposer = mount(dir, harness)
    const produced = harness.world().report({
      source: 'token-verifier',
      event: 'token-denied',
      actor: { pluginId: '@vendor/third-party', source: 'decision' },
    })
    expect(produced).toHaveLength(1)
    await harness.world().trail.flush()
    expect((await readAllRecords(dir))[0]).toMatchObject({
      kind: 'governance',
      actor: { pluginId: '@vendor/third-party', source: 'decision' },
      detail: { source: 'token-verifier', event: 'token-denied' },
    })
    disposer()
  })

  it('argsPreviewLimit 透传投影器', async () => {
    const dir = await tempDir()
    const harness = makeFakeContext()
    const disposer = defineAuditPlugin({ dir, argsPreviewLimit: 8 }).apply(harness.fake as unknown as Context)
    harness.emit(callEvent(1, 'c1', 'budget_calc', '{"totalCny":59400,"lines":[]}', T1))
    harness.emit(resultEvent(2, 'c1', false, T1))
    await harness.world().trail.flush()
    expect((await readAllRecords(dir))[0]?.argsPreview).toBe('{"totalC…')
    disposer()
  })

  it('卸载逆闭包:服务撤销、监听摘除、卸载后无新增 tool-call 记录(含在途 tool/result 口径,§3.3)', async () => {
    const dir = await tempDir()
    const harness = makeFakeContext()
    const disposer = mount(dir, harness)

    // 在途窗口:tool/call 已进 pending,tool/result 故意留到卸载后(逆②摘除后无人消费)
    harness.emit(callEvent(1, 'c1', 'budget_calc', '{}', T1))
    const before = (await readAllRecords(dir)).length
    expect(before).toBe(0) // 配对折叠:call 本身不产记录

    disposer()
    await Promise.resolve() // 让 provide disposer(异步)落地

    expect(harness.services()).toEqual([])
    expect(harness.listenerCount('session/event')).toBe(0)

    harness.emit(resultEvent(2, 'c1', false, T1)) // 在途 result
    harness.emit(callEvent(3, 'c2', 'web_fetch', '{}', T2)) // 卸载后新调用
    harness.emit(resultEvent(4, 'c2', false, T2))
    expect(harness.services()).toEqual([])

    const after = await readAllRecords(dir)
    expect(after).toHaveLength(before) // 验收口径:无新增 tool-call 记录(非「行数不变」绝对口径)
  })
})
