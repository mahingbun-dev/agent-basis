/**
 * 契约冒烟:Context/Events 增强的类型面 + defineTool fail-loud + kv 内存实现。
 * 编译期(tsc)已验证增强后的 ctx.tools 等访问形态;本文件再锁运行时可装配。
 */
import { describe, expect, it } from 'vitest'
import { Context } from '@core/cordis'
import { defineTool, memoryKvTable } from '../src/index.ts'
import type { ToolDefinition, ToolRegistry } from '../src/index.ts'

const echoTool: ToolDefinition = defineTool({
  name: 'echo',
  description: '原样返回输入(契约冒烟用)',
  parameters: { text: { type: 'string' } },
  output: {
    schema: { type: 'object' },
    render: () => [{ type: 'text', text: 'ok' }],
  },
  execute: async args => ({ echo: args }),
})

const registry: ToolRegistry = {
  register(definition) {
    map.set(definition.name, definition)
    return () => { map.delete(definition.name) }
  },
  get: name => map.get(name),
  list: () => [...map.values()],
  schemas: () => [...map.values()].map(({ name, description, parameters }) => ({ name, description, parameters })),
}
const map = new Map<string, ToolDefinition>()

describe('@core/contracts smoke', () => {
  it('Context 增强:provide 后 ctx.tools 类型面与运行时一致', async () => {
    const off = registry.register(echoTool)
    const ctx = new Context()
    const dispose = ctx.provide('tools', registry)
    // 服务就绪需要一次通知循环
    await Promise.resolve()
    const fiber = ctx.inject({ tools: true }, (inner) => {
      expect(inner.tools.get('echo')?.name).toBe('echo')
      expect(inner.tools.schemas().length).toBe(1)
    })
    await fiber
    dispose()
    off()
    expect(registry.list().length).toBe(0)
  })

  it('defineTool fail-loud', () => {
    expect(() => defineTool({ ...echoTool, name: '' })).toThrow(TypeError)
    expect(() => defineTool({ ...echoTool, description: '' })).toThrow(TypeError)
    const noExecute: Record<string, unknown> = { ...echoTool }
    delete noExecute['execute']
    expect(() => defineTool(noExecute as unknown as ToolDefinition)).toThrow(/execute/)
    const { output: _output, ...noOutput } = echoTool
    expect(() => defineTool(noOutput as ToolDefinition)).toThrow(/output/)
  })

  it('memoryKvTable 语义', async () => {
    const kv = memoryKvTable<number>()
    await kv.put('a', 1)
    expect(kv.get('a')).toBe(1)
    expect(await kv.delete('a')).toBe(true)
    expect(await kv.delete('a')).toBe(false)
    expect(kv.get('a')).toBeUndefined()
  })
})
