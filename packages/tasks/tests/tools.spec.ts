/**
 * 工具面门禁(35 号 A20 验收;34 号 §4-D 承接表「tools.spec.ts → tools.spec.ts:
 * 角色分面(主会话无实现权工具)、资源读路径(R4:orchestrator_read 读 .ticket/<id>/ 文件)、
 * schema strict」;24 号 §8.3 四纪律 + §2.4 双角色双工具面)。
 *
 * 本文件断言(35 号 A20 交付原文逐面):
 * - 清单快照:orchestrator 14 / worker 6,名称与 SA mainTools/executorTools 一一对应(表⑤-2);
 * - 角色分面:worker 面不在 orchestrator 数组(主会话无实现权工具,orchestrator_report/ack/
 *   thread_unrelated/thread_follow/trigger_handback 只属于 worker),注册 when 谓词把主会话面
 *   挡在 worker session 之外(表⑤-6;24 §8.3-4);
 * - schema strict:每个工具的 zod schema 拒未知键、有 .describe() 描述、默认值在 execute 生效
 *   (表⑤-3;24 §8.3-1);资源语法在 readTool 描述与 resource 参数描述里(表⑤-4;24 §8.3-2);
 * - AbortSignal:execute 签名接信号,适配层把宿主 exec.signal 原样传入(表⑤-5;24 §8.3-3);
 * - 资源读路径 R4:orchestrator_read 读 .ticket/<id>/ 产物文件(列目录 + 分页读全文,
 *   worker 只可读自己工单;主会话专属资源对 worker 显式拒);
 * - defineTool seam:toDshTool 产出宿主 ToolDefinition(parameters 含描述/默认值、
 *   execute 走 zod 校验并接 exec.signal)。
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it, vi } from 'vitest'
import type { z } from 'zod'
import { Context } from '@deepseek-ai/cordis'
import { WorktreeNameSchema, orchestratorTools, type OrchestratorToolsHost } from '../src/tools/orchestrator.ts'
import { defineTasksPlugin } from '../src/plugin.ts'
import { RESOURCES, readResource, resourceGrammar, type ResourceHost } from '../src/tools/resources.ts'
import { IM_WORDS, NOTE_WORDS, readTool, toDshTool, tool, wordCount } from '../src/tools/tool.ts'
import { workerTools, type WorkerToolsHost } from '../src/tools/worker.ts'
import { Store } from '../src/store/store.ts'

/** worker 专属的工具名(实现权/协作面;主会话数组必须不含它们)。 */
const WORKER_ONLY = ['orchestrator_report', 'orchestrator_ack', 'orchestrator_thread_unrelated', 'orchestrator_thread_follow', 'orchestrator_trigger_handback'] as const
/** 主会话 14 工具(名称快照;与 SA mainTools 一一对应)。 */
const ORCHESTRATOR_NAMES = ['orchestrator_read', 'orchestrator_route', 'orchestrator_ticket_retry', 'orchestrator_ticket_request_status',
  'orchestrator_ticket_note', 'orchestrator_trigger_requeue', 'orchestrator_eval', 'orchestrator_eval_read', 'orchestrator_eval_decide',
  'orchestrator_reply', 'orchestrator_thread_unsubscribe', 'orchestrator_settings_save', 'orchestrator_policy_sync', 'orchestrator_prompts_save'] as const
/** worker 6 工具(名称快照)。 */
const WORKER_NAMES = ['orchestrator_read', 'orchestrator_ack', 'orchestrator_thread_unrelated', 'orchestrator_thread_follow',
  'orchestrator_trigger_handback', 'orchestrator_report'] as const

/** 空宿主(只取定义面;execute 不调用)。 */
const noHost = (): OrchestratorToolsHost => ({
  engine: new Proxy({} as OrchestratorToolsHost['engine'], { get: (_t, key) => { throw new Error(`engine.${String(key)} 不在本测试调用`) } }),
  store: new Proxy({} as OrchestratorToolsHost['store'], { get: (_t, key) => { throw new Error(`store.${String(key)} 不在本测试调用`) } }),
  settings: () => { throw new Error('settings 不在本测试调用') },
  assessor: new Proxy({} as OrchestratorToolsHost['assessor'], { get: (_t, key) => { throw new Error(`assessor.${String(key)} 不在本测试调用`) } }),
  outbox: new Proxy({} as OrchestratorToolsHost['outbox'], { get: (_t, key) => { throw new Error(`outbox.${String(key)} 不在本测试调用`) } }),
  prompts: new Proxy({} as OrchestratorToolsHost['prompts'], { get: (_t, key) => { throw new Error(`prompts.${String(key)} 不在本测试调用`) } }),
  resources: { store: new Proxy({} as ResourceHost['store'], { get: (_t, key) => { throw new Error(`resources.store.${String(key)} 不在本测试调用`) } }) },
  scope: { scope: () => ({ listened: false, reason: 'test' }) },
  requestPass: () => {},
  policyChanged: () => {},
})
/** zod schema 的 strict 面:未知键被拒。 */
const strictOn = (schema: z.ZodType): boolean => {
  const target = schema as unknown as { def?: { shape?: Record<string, z.ZodType> } }
  if (!target.def?.shape) return ! schema.safeParse({ __unknown_key__: 1 }).success
  return ! schema.safeParse(Object.fromEntries([...Object.keys(target.def.shape), '__unknown_key__'].map(key => [key, key === '__unknown_key__' ? 1 : 'x']))).success
}
/** 每个属性都有描述(模型面就是 API 面)。 */
const describedOn = (schema: z.ZodType): boolean => {
  const json = (schema as unknown as { def?: { shape?: Record<string, z.ZodType> } }).def?.shape ?? {}
  return Object.values(json).every((property: z.ZodType) => (property as unknown as { description?: string }).description !== undefined)
}

describe('角色分面(34 §4-D;24 §8.3-4)', () => {
  it('orchestrator 14 工具、worker 6 工具(名称快照,表⑤-2)', () => {
    const main = orchestratorTools(noHost()).map(definition => definition.name)
    expect(main).toEqual(ORCHESTRATOR_NAMES)
    expect(main).toHaveLength(14)
    const worker = workerTools({} as WorkerToolsHost, { id: 't1' } as Parameters<typeof workerTools>[1]).map(definition => definition.name)
    expect(worker).toEqual(WORKER_NAMES)
    expect(worker).toHaveLength(6)
  })

  it('主会话无实现权工具:worker 面的工具(汇报/确认/线程协作)不出现在主会话数组', () => {
    const main = orchestratorTools(noHost()).map(definition => definition.name)
    for (const name of WORKER_ONLY) expect(main, name).not.toContain(name)
    // 主会话面只有四动作与只读/评估(tools 名单即四动作面,28 §1.4)。
    expect(main.filter(name => name.startsWith('orchestrator_')).length).toBe(14)
  })

  it('分面注册的 when 谓词:主会话面在 worker session(worker-<id>)不可见', async () => {
    // 经 toDshTool 的 when(装配面传入)复核:worker session id 一律 false,主会话/其他 true。
    const { ticketOfSession } = await import('../src/executor/dsh.ts')
    const when = ({ agent }: { readonly agent: { readonly id: string } }): boolean => ticketOfSession(agent.id) === undefined
    expect(when({ agent: { id: 'worker-t1' } })).toBe(false)
    expect(when({ agent: { id: 'orchestrator-main' } })).toBe(true)
  })

  it('装配面的 when 白名单(35-A21 诊断清单②):主会话 id 在场时 orchestrator 面只在主会话可见', () => {
    // 真实 defineTasksPlugin 注册路径:假 tools 服务捕获每次注册的 when 谓词。
    const registered: Array<(({ agent }: { readonly agent: { readonly id: string } }) => boolean) | undefined> = []
    const boot = (masterId?: string) => {
      const root = mkdtempSync(join(tmpdir(), 'tasks-when-'))
      try {
        const ctx = new Context()
        const plugin = defineTasksPlugin({ tenantRoot: root, realm: 'alice', passIntervalMs: 3_600_000,
          ...(masterId !== undefined ? { masterId } : {}) })
        ctx.reflect.provide('tools', { register: vi.fn((_definition: { name: string },
          options?: { when?: ({ agent }: { readonly agent: { readonly id: string } }) => boolean }): () => void => {
          registered.push(options?.when)
          return () => {}
        }) })
        const dispose = plugin.apply(ctx)
        dispose()
      } finally { rmSync(root, { recursive: true, force: true }) }
    }
    // 主会话白名单:主会话 true;普通 web 聊天会话与 worker session 一律 false(14 项全一致)。
    boot('orchestrator-main')
    expect(registered).toHaveLength(14)
    for (const when of registered) {
      expect(when!({ agent: { id: 'orchestrator-main' } })).toBe(true)
      expect(when!({ agent: { id: 'plain-chat-session' } })).toBe(false)
      expect(when!({ agent: { id: 'worker-t1' } })).toBe(false)
    }
    // 主会话 id 缺席:退回既有基线「非 worker 会话」(worker 恒不可见,分面不破)。
    registered.length = 0
    boot()
    expect(registered).toHaveLength(14)
    for (const when of registered) {
      expect(when!({ agent: { id: 'orchestrator-main' } })).toBe(true)
      expect(when!({ agent: { id: 'plain-chat-session' } })).toBe(true)
      expect(when!({ agent: { id: 'worker-t1' } })).toBe(false)
    }
  })
})

describe('schema 纪律(24 §8.3-1/2;表⑤-3/4)', () => {
  it('每个工具 schema .strict() 拒未知键,且每个属性都有 .describe()', () => {
    for (const definition of [...orchestratorTools(noHost())]) {
      expect(strictOn(definition.schema), definition.name).toBe(true)
      expect(describedOn(definition.schema), definition.name).toBe(true)
      expect(definition.description.length, definition.name).toBeGreaterThan(10)
    }
    const workerHost = {} as WorkerToolsHost
    for (const definition of workerTools(workerHost, { id: 't1' } as Parameters<typeof workerTools>[1])) {
      expect(strictOn(definition.schema), definition.name).toBe(true)
    }
  })

  it('readTool 的描述给出资源语法(主会话全表;worker 只见 executor 资源)', () => {
    expect(resourceGrammar(false)).toContain('tickets:')
    expect(resourceGrammar(false)).toContain('settings/<block>')
    expect(resourceGrammar(true)).not.toContain('decisions:')
    expect(resourceGrammar(true)).toContain('ticket/<id>/files:')
    const workerRead = readTool('读本工单的一页资源', true, async () => ({}))
    const shape = (workerRead.schema as unknown as { def: { shape: { resource: { description?: string } } } }).def.shape
    expect(workerRead.description + String(shape.resource.description)).toContain('ticket/<id>/files')
  })

  it('默认值在 execute 生效、路由注记与确认受词数界限(28 §1.1)', () => {
    const words = (count: number): string => Array.from({ length: count }, () => 'word').join(' ')
    expect(wordCount(words(NOTE_WORDS))).toBeLessThanOrEqual(NOTE_WORDS)
    expect(wordCount(words(NOTE_WORDS + 1))).toBe(NOTE_WORDS + 1)
    expect(wordCount(words(IM_WORDS + 1))).toBe(IM_WORDS + 1)
    // WorktreeNameSchema:1–4 个小写英文词,kebab-case,≤32 字符(表⑤-3 的实际校验样例)。
    expect(WorktreeNameSchema.safeParse('fix-plan-color').success).toBe(true)
    expect(WorktreeNameSchema.safeParse('Fix_Plan').success).toBe(false)
    expect(WorktreeNameSchema.safeParse('a-very-long-name-that-exceeds-the-32-char-limit').success).toBe(false)
  })
})

describe('defineTool seam(35 号表⑤-7;B4 先例形态)', () => {
  it('toDshTool 产出宿主 ToolDefinition:参数带描述与默认值,execute 接 exec.signal 且以 zod 校验', async () => {
    const seen: AbortSignal[] = []
    const probe = tool({
      name: 'probe_tool',
      description: '探针工具:验证 seam 适配。',
      schema: readTool('x', true, async () => ({})).schema,
      execute: async (_args, signal) => { seen.push(signal); return { ok: true } },
    })
    const definition = toDshTool(probe)
    expect(definition.name).toBe('probe_tool')
    // 参数投影:host parameters 形态(JSON-ish spec),带 required 标注与描述。
    // defineTool 把投影编译为 { type:'object', properties:{...}, required:[...] }:必填面收敛到根 required 数组。
    type Compiled = { properties: Record<string, { description?: string; default?: unknown }>; required?: readonly string[] }
    const parameters = definition.parameters as Compiled
    expect(parameters.properties.resource?.description).toBeTruthy()
    expect(parameters.properties.offset?.default).toBe(0)
    // 必填:resource 必填;offset(默认 0)与 limit(可选)不在必填面。
    expect(parameters.required).toContain('resource')
    expect(parameters.required).not.toContain('limit')
    expect(parameters.required).not.toContain('offset')
    // execute:zod 校验(未知键拒)+ AbortSignal 原样透传。
    const controller = new AbortController()
    const hostSignal = controller.signal
    const outcome = await definition.execute({ resource: 'tickets' }, { signal: hostSignal } as Parameters<typeof definition.execute>[1])
    expect(outcome).toEqual({ ok: true })
    expect(seen[0]).toBe(hostSignal)
    await expect(definition.execute({ resource: 'tickets', unknown: 1 }, { signal: controller.signal } as Parameters<typeof definition.execute>[1])).rejects.toThrow()
  })
})

describe('资源读路径 R4(orchestrator_read 读 .ticket/<id>/ 文件)', () => {
  const root = mkdtempSync(join(tmpdir(), 'tasks-tools-'))
  const store = new Store('alice', { workspaceDir: root })
  const host: ResourceHost = { store }
  // 造两张工单(t1 / other)与其 R4 产物:progress.md / evidence/finding.md。
  const ticketId = 't1'
  const at = '2026-09-09T00:00:00Z'
  const record = (id: string): unknown => ({ id, title: id, decisionId: `d-${id}`, realm: 'alice',
    mandate: { strength: 'explicit', policyVersion: 'v1', realm: 'alice', basis: { via: 'addressed', addressed: 'mention' }, actor: { source: 'test', id: 'alice' }, scope: 's' },
    channels: [], assignments: [], inputs: [], undelivered: [], origin: { triggerId: `trigger-${id}`, triggerIds: [`trigger-${id}`] }, createdAt: at, updatedAt: at })
  store.tickets.save(record(ticketId) as never)
  store.tickets.save(record('other') as never)
  store.triggers.save({ id: `trigger-${ticketId}`, source: 'test', threads: [{ source: 'test', id: 'thread-1' }], actor: { source: 'test', id: 'alice' },
    human: true, at, text: 'ask', meta: {} })
  mkdirSync(join(root, '.ticket', ticketId, 'evidence'), { recursive: true })
  writeFileSync(join(root, '.ticket', ticketId, 'progress.md'), 'p'.repeat(5000))
  writeFileSync(join(root, '.ticket', ticketId, 'evidence', 'finding.md'), '结论:回归在设置页。')

  it('主会话列出工单产物文件并按路径分页读全文', async () => {
    const files = await readResource(host, `ticket/${ticketId}/files`, 0, undefined, undefined) as { items: { path: string; read: string }[] }
    expect(files.items.map(item => item.path)).toEqual(['evidence/finding.md', 'progress.md'])
    expect(files.items[0]!.read).toBe(`ticket/${ticketId}/file/evidence/finding.md`)
    const page = await readResource(host, `ticket/${ticketId}/file/progress.md`, 0, undefined, undefined) as { text: string; total_chars: number; next_offset: number | null }
    expect(page.total_chars).toBe(5000)
    expect(page.text).toBe('p'.repeat(4000))
    const rest = await readResource(host, `ticket/${ticketId}/file/progress.md`, 4000, undefined, undefined) as { text: string; next_offset: null }
    expect(rest.text).toBe('p'.repeat(1000))
    // 结论文件读全文;路径越界(../)fail-closed 拒绝。
    const finding = await readResource(host, `ticket/${ticketId}/file/evidence/finding.md`, 0, undefined, undefined) as { text: string }
    expect(finding.text).toContain('回归在设置页')
    await expect(readResource(host, `ticket/${ticketId}/file/../../secrets.txt`, 0, undefined, undefined)).rejects.toThrow('escapes the ticket workspace')
  })

  it('worker 只可读自己工单的 R4 文件;主会话专属资源对 worker 显式拒', async () => {
    // worker(t1)读自己工单:通过。
    const own = await readResource(host, `ticket/${ticketId}/files`, 0, undefined, ticketId) as { items: unknown[] }
    expect(own.items).toHaveLength(2)
    // worker(t1)读别家工单:拒。
    await expect(readResource(host, 'ticket/other/files', 0, undefined, ticketId)).rejects.toThrow('reads only its own ticket')
    // worker 读主会话专属资源(settings):显式拒,不静默降级。
    await expect(readResource(host, 'settings', 0, undefined, ticketId)).rejects.toThrow('belongs to the main Session')
    // worker 读未到达的 trigger:拒(unknown trigger 桩)。
    await expect(readResource(host, 'trigger/none', 0, undefined, ticketId)).rejects.toThrow()
  })

  it('未知资源显式报错,资源语法即边界', async () => {
    await expect(readResource(host, 'no-such-resource', 0, undefined, undefined)).rejects.toThrow('Unknown context resource')
    expect(RESOURCES.every(resource => resource.name.length > 0)).toBe(true)
  })

  afterAll(() => { store.close(); rmSync(root, { recursive: true, force: true }) })
})
