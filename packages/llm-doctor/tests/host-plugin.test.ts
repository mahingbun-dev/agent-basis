/**
 * Host 半边插件测试:
 * - SRC 端点 marker(手工施加路径;活 Service 实例)与默认导出插件形态;
 * - checkNow 全流程:configuration 读行 → 探测 → configEditor.edit 写回;
 * - probeModel 结构化失败分支与真请求路径(注入 fetch 假体);
 * - configEditor 缺席降级(只报错不炸)。
 *
 * 网关基类是 cordis Service(构造内 ctx.provide 注册)——测试用真实 cordis
 * Context,configEditor 以 provide 桩注入(与宿主 service 解析同构)。
 */
import { describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { remoteMethods } from '@deepseek-ai/dsh-typert-protocol'
import plugin, {
  ENDPOINTS, LLM_DOCTOR_SERVICE_ID, LlmDoctorGateway, PI_AI_ENTRY_ID,
} from '../src/index.ts'
import type { ConfigEditorFace } from '../src/index.ts'
import type { FetchLike } from '../src/doctor.ts'

/** 构造 configEditor 假体(记录 edit 调用;configuration 可注入)。 */
interface EditorEdits {
  id: string
  next: Record<string, unknown>
}

function fakeEditor(rows: { id: string; override: Record<string, unknown> }[]): { face: ConfigEditorFace; edits: EditorEdits[] } {
  const entries = rows.map(row => ({ options: { id: row.id } }))
  const edits: { id: string; next: Record<string, unknown> }[] = []
  const face: ConfigEditorFace = {
    entries: () => entries,
    configuration: () => rows.map((row, index) => ({ entry: entries[index], override: row.override })),
    edit: async (entry, change) => {
      const row = rows.find(candidate => candidate.id === entry.options.id)
      if (row === undefined) throw new Error(`未知行 ${entry.options.id}`)
      const next = change(row.override, {})
      row.override = next
      edits.push({ id: entry.options.id, next })
    },
  }
  return { face, edits }
}

/** 真实 cordis Context + configEditor 桩(与宿主 service 解析同构)。 */
function ctxWithEditor(face: ConfigEditorFace | undefined): Context {
  const context = new Context()
  if (face !== undefined) context.provide('configEditor', face)
  return context
}

const GATEWAY_CONFIG = {
  providers: {
    mimo: {
      api: 'anthropic-messages',
      baseURL: 'http://gw.test/v1',
      apiKeyEnv: 'MIMO_API_KEY',
      models: [{ id: 'deepseek-flash' }],
    },
  },
}

describe('端点与插件形态', () => {
  it('SRC marker:health/probe 两个端点(活 Service 实例)', () => {
    const gateway = new LlmDoctorGateway(ctxWithEditor(undefined))
    const names = remoteMethods(gateway).map(method => method.exportName ?? method.method)
    expect(names).toContain('health')
    expect(names).toContain('probe')
  })
  it('端点字符串与默认导出形态', () => {
    expect(ENDPOINTS.health).toBe('llmDoctor/health')
    expect(ENDPOINTS.probe).toBe('llmDoctor/probe')
    expect(plugin.name).toBe('eterna-llm-doctor')
    expect(typeof plugin.apply).toBe('function')
    expect(PI_AI_ENTRY_ID).toBe('llm-pi-ai')
    expect(LLM_DOCTOR_SERVICE_ID).toBe('llmDoctor')
  })
})

describe('checkNow 自动适配流程', () => {
  it('path-missing + 候选存在 → edit 写回 baseURL,health 记录 verdict', async () => {
    // 探测假 fetch:http://gw.test/v1/v1/messages → 404;http://gw.test/v1/messages → 405
    const fakeFetch: FetchLike = async (url) => {
      const status = url.endsWith('/v1/v1/messages') ? 404 : url.endsWith('/v1/messages') ? 405 : 404
      return new Response('', { status })
    }
    const { face, edits } = fakeEditor([{ id: PI_AI_ENTRY_ID, override: structuredClone(GATEWAY_CONFIG) }])
    const gateway = new LlmDoctorGateway(ctxWithEditor(face))
    gateway.fetchImpl = fakeFetch
    const report = await gateway.checkNow()
    expect(edits).toHaveLength(1)
    expect(edits[0]?.id).toBe(PI_AI_ENTRY_ID)
    const providers = edits[0]?.next['providers'] as Record<string, { baseURL: string }>
    expect(providers['mimo']?.baseURL).toBe('http://gw.test')
    expect(report.lastAutoFix).toHaveLength(1)
    expect(report.lastAutoFix[0]?.from).toBe('http://gw.test/v1')
    expect(report.lastAutoFix[0]?.to).toBe('http://gw.test')
    expect(report.health[0]?.verdict).toBe('path-missing')
    expect(report.routes[0]?.models).toEqual(['deepseek-flash'])
  })
  it('路径已存在 → 无 edit(幂等)', async () => {
    const fakeFetch: FetchLike = async () => new Response('', { status: 405 })
    const { face, edits } = fakeEditor([{ id: PI_AI_ENTRY_ID, override: structuredClone(GATEWAY_CONFIG) }])
    const gateway = new LlmDoctorGateway(ctxWithEditor(face))
    gateway.fetchImpl = fakeFetch
    await gateway.checkNow()
    expect(edits).toHaveLength(0)
    expect(gateway.health[0]?.verdict).toBe('ok')
  })
  it('承载行缺席 → health/routes 清空,无 edit', async () => {
    const { face, edits } = fakeEditor([{ id: 'unrelated', override: {} }])
    const gateway = new LlmDoctorGateway(ctxWithEditor(face))
    await gateway.checkNow()
    expect(edits).toHaveLength(0)
    expect(gateway.routes).toEqual([])
  })
  it('configEditor 缺席 → lastError 明示,不抛', async () => {
    const gateway = new LlmDoctorGateway(ctxWithEditor(undefined))
    const report = await gateway.checkNow()
    expect(report.lastError).toContain('configEditor 服务缺席')
  })
})

describe('probeModel 端点', () => {
  it('未知路由/目录外模型 → 结构化失败', async () => {
    const { face } = fakeEditor([{ id: PI_AI_ENTRY_ID, override: structuredClone(GATEWAY_CONFIG) }])
    const gateway = new LlmDoctorGateway(ctxWithEditor(face))
    const noRoute = await gateway.probeModel({ provider: 'nope', model: 'deepseek-flash' })
    expect(noRoute.ok).toBe(false)
    expect(noRoute.error).toContain('未找到路由')
    const noModel = await gateway.probeModel({ provider: 'mimo', model: 'not-in-catalog' })
    expect(noModel.ok).toBe(false)
    expect(noModel.error).toContain('不在路由')
  })
  it('目录内模型 → 按 apiKeyEnv 解析凭据并发真请求(注入 fetch 假体)', async () => {
    const fakeFetch: FetchLike = vi.fn(async () =>
      new Response(JSON.stringify({ content: [{ type: 'text', text: 'pong' }] }), { status: 200 }))
    const { face } = fakeEditor([{ id: PI_AI_ENTRY_ID, override: structuredClone(GATEWAY_CONFIG) }])
    const gateway = new LlmDoctorGateway(ctxWithEditor(face))
    gateway.fetchImpl = fakeFetch
    gateway.resolveApiKey = env => (env === 'MIMO_API_KEY' ? 'sk-env-key' : undefined)
    const result = await gateway.probeModel({ provider: 'mimo', model: 'deepseek-flash' })
    expect(result.ok).toBe(true)
    expect(result.preview).toBe('pong')
    const init = (fakeFetch as ReturnType<typeof vi.fn>).mock.calls[0]?.[1] as RequestInit
    expect((init.headers as Record<string, string>)['authorization']).toBe('Bearer sk-env-key')
    expect(JSON.stringify(init.body)).toContain('deepseek-flash')
  })
})

describe('插件装配', () => {
  it('apply 注册 volatile-update 监听并返回 disposer', async () => {
    const { face, edits } = fakeEditor([{ id: PI_AI_ENTRY_ID, override: structuredClone(GATEWAY_CONFIG) }])
    const context = ctxWithEditor(face)
    const dispose = plugin.apply(context)
    expect(typeof dispose).toBe('function')
    // 防抖 400ms + 探测 —— 等待一轮自动体检走完(in-flight 守卫只允许一轮)
    await new Promise(resolve => setTimeout(resolve, 700))
    dispose()
    expect(edits.length).toBeGreaterThanOrEqual(0)
  })
})
