/**
 * tools 冒烟:注册表唯一名/schemas 白名单/restrict 遮罩/执行链
 * (pre-execute deny 与 ask→approval、成功投影、失败规范化)。
 */
import { describe, expect, it } from 'vitest'
import { Context } from '@core/cordis'
import { defineTool } from '@core/contracts'
import type { ApprovalOutcome, ApprovalRequest, ToolDefinition, ToolRegistry } from '@core/contracts'
import { ToolRegistryImpl, matchesPattern } from '../src/registry.ts'
import { createToolExecutor } from '../src/executor.ts'
import plugin from '../src/index.ts'

function echoTool(): ToolDefinition {
  return defineTool({
    name: 'echo',
    description: '原样返回',
    parameters: { text: { type: 'string', required: true } },
    output: { schema: { type: 'object' }, render: () => [{ type: 'text', text: 'ok' }] },
    isConcurrencySafe: () => true,
    execute: async args => ({ echo: (args as { text: string }).text }),
  })
}

describe('ToolRegistryImpl', () => {
  it('唯一名纪律;disposer 配逆', () => {
    const registry = new ToolRegistryImpl()
    const off = registry.register(echoTool())
    expect(() => registry.register(echoTool())).toThrow(/已注册/)
    off()
    expect(registry.list().length).toBe(0)
  })

  it('schemas 只露 name/description/parameters;restrict 遮罩 schemas 与 get', () => {
    const registry = new ToolRegistryImpl()
    registry.register(echoTool())
    registry.register(defineTool({ ...echoTool(), name: 'web_fetch', description: '出网' }))
    expect(registry.schemas().map(schema => schema.name).sort()).toEqual(['echo', 'web_fetch'])
    const off = registry.restrict({ deny: ['web_*'] })
    expect(registry.get('web_fetch')).toBeUndefined()
    expect(registry.schemas().map(schema => schema.name)).toEqual(['echo'])
    expect(registry.restricted('web_fetch')).toBe(true)
    expect(registry.list().length).toBe(2)
    off()
    expect(registry.get('web_fetch')).toBeDefined()
  })

  it('matchesPattern:尾部 * 前缀通配', () => {
    expect(matchesPattern('web_fetch', 'web_*')).toBe(true)
    expect(matchesPattern('memory_write', 'web_*')).toBe(false)
    expect(matchesPattern('echo', 'echo')).toBe(true)
  })
})

describe('执行链', () => {
  it('成功:pre-execute 放行 → execute → 投影 → post-execute', async () => {
    const ctx = new Context()
    const registry = new ToolRegistryImpl()
    registry.register(echoTool())
    const executor = createToolExecutor(ctx, registry)
    ctx.provide('tools', registry)
    const posted: string[] = []
    ctx.events.on('tools/post-execute', (exec, result) => {
      const call = exec as { readonly name: string }
      const outcome = result as { readonly ok: boolean }
      posted.push(`${call.name}:${String(outcome.ok)}`)
    })
    const result = await executor.exec({ name: 'echo', args: { text: 'hi' } })
    expect(result.ok).toBe(true)
    expect(result.value).toMatchObject({ echo: 'hi' })
    expect(posted).toEqual(['echo:true'])
  })

  it('deny:pre-execute 监听拒绝 → 规范化失败,execute 不执行', async () => {
    const ctx = new Context()
    const registry = new ToolRegistryImpl()
    let executed = false
    registry.register(defineTool({
      ...echoTool(),
      execute: async () => { executed = true; return {} },
    }))
    const executor = createToolExecutor(ctx, registry)
    ctx.events.on('tools/pre-execute', (_exec, next) => {
      void next
      return Promise.resolve({ kind: 'deny', reason: '规则命中' })
    })
    const result = await executor.exec({ name: 'echo', args: { text: 'x' } })
    expect(result.ok).toBe(false)
    expect(result.error?.name).toBe('ToolGateError')
    expect(result.content[0]?.text).toContain('规则命中')
    expect(executed).toBe(false)
  })

  it('ask:送 ctx.approval;allowed-once 放行,rejected 阻断', async () => {
    for (const outcome of ['allowed-once', 'rejected'] as const) {
      const ctx = new Context()
      const registry = new ToolRegistryImpl()
      registry.register(echoTool())
      const executor = createToolExecutor(ctx, registry)
      const requests: ApprovalRequest[] = []
      ctx.provide('approval', {
        request: (request: ApprovalRequest): Promise<ApprovalOutcome> => {
          requests.push(request)
          return Promise.resolve(outcome)
        },
      })
      ctx.events.on('tools/pre-execute', (_exec, next) => {
        void next
        return Promise.resolve({ kind: 'ask', reason: 'R3 动作' })
      })
      const result = await executor.exec({ name: 'echo', args: { text: 'x' } })
      expect(requests.length).toBe(1)
      expect(requests[0]?.riskTier).toBe('R2')
      expect(result.ok).toBe(outcome === 'allowed-once')
    }
  })

  it('非法参数:defineTool 包装拒绝,规范化为失败', async () => {
    const ctx = new Context()
    const registry = new ToolRegistryImpl()
    registry.register(echoTool())
    const executor = createToolExecutor(ctx, registry)
    const result = await executor.exec({ name: 'echo', args: {} })
    expect(result.ok).toBe(false)
    expect(result.error?.message).toContain('缺少必填参数 text')
  })
})

describe('插件装配', () => {
  it('provide 的 ctx.tools 带 exec 执行面', async () => {
    const ctx = new Context()
    const fiber = ctx.plugin(plugin)
    await fiber
    const tools = ctx.tools as ToolRegistry & { exec(input: { name: string; args: unknown }): Promise<{ ok: boolean }> }
    expect(typeof tools.exec).toBe('function')
    await fiber.dispose()
  })
})
