import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { ToolDefinition, ToolRunContext } from '@deepseek-ai/dsh-tools'
import {
  attachMemory, createMemory, createMemoryIndexSection, defineMemoryTools,
  estimateTokens, MEMORY_TOOL_NAMES,
} from '../src/index.ts'
import type { Memory, MemoryHost } from '../src/index.ts'

let dir = ''
let memory: Memory

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'basis-memory-tools-'))
  memory = createMemory({ workspaceDir: dir, dbPath: join(dir, 'memory.db') })
})

afterEach(async () => {
  memory.dispose()
  await rm(dir, { recursive: true, force: true })
})

/** 最小执行上下文(工具只依赖 name/signal 语义,其余字段不触达)。 */
const fakeExec = { name: 'test', signal: new AbortController().signal } as unknown as ToolRunContext

function tool(name: string): ToolDefinition {
  const found = defineMemoryTools(memory).find(definition => definition.name === name)
  if (found === undefined) throw new Error(`工具不存在:${name}`)
  return found
}

describe('defineMemoryTools:定义面', () => {
  it('恰好四个工具,名字与导出清单一致', () => {
    const definitions = defineMemoryTools(memory)
    expect(definitions.map(definition => definition.name)).toEqual([...MEMORY_TOOL_NAMES])
  })

  it('read/search 声明并发安全;write/forget 独占(未声明)', () => {
    // defineTool 对 isConcurrencySafe 做 args 校验包装:非法 args 视为 exclusive,
    // 故传各工具的合法最小 args 验证「有效调用可并行」
    const readDef = tool('memory_read') as { isConcurrencySafe?: (args: unknown) => boolean }
    const searchDef = tool('memory_search') as { isConcurrencySafe?: (args: unknown) => boolean }
    const writeDef = tool('memory_write') as { isConcurrencySafe?: (args: unknown) => boolean }
    const forgetDef = tool('memory_forget') as { isConcurrencySafe?: (args: unknown) => boolean }
    expect(readDef.isConcurrencySafe?.({ subject: 's', key: 'k' })).toBe(true)
    expect(searchDef.isConcurrencySafe?.({ query: 'q' })).toBe(true)
    expect(readDef.isConcurrencySafe?.({})).toBe(false)
    expect(writeDef.isConcurrencySafe).toBeUndefined()
    expect(forgetDef.isConcurrencySafe).toBeUndefined()
  })

  it('output.render 把规范值渲染为可读 JSON 文本块', () => {
    const value = { ok: true, key: 'k' }
    const blocks = tool('memory_read').output.render({ subject: 's', key: 'k' }, value)
    expect(blocks).toHaveLength(1)
    expect(blocks[0]).toMatchObject({ type: 'text' })
    expect(JSON.parse((blocks[0] as { text: string }).text)).toEqual(value)
  })
})

describe('memory_write 工具执行', () => {
  it('成功写入:ok true 且落库可读', async () => {
    const result = await tool('memory_write').execute(
      { subject: 'user:alice', key: 'prefers-email-summary', content: '周报偏好邮件摘要', summary: '邮件摘要', confidence: 0.9 },
      fakeExec,
    )
    expect(result).toMatchObject({ ok: true, subject: 'user:alice', key: 'prefers-email-summary', confidence: 0.9 })
    expect(memory.readEntity('user:alice', 'prefers-email-summary')?.content).toBe('周报偏好邮件摘要')
  })

  it('PII 命中:结构化 blocked 载荷(不中断 turn),库无残留', async () => {
    const result = await tool('memory_write').execute(
      { subject: 'user:alice', key: 'contact', content: '手机 13812345678' },
      fakeExec,
    )
    expect(result).toMatchObject({ ok: false, blocked: 'pii' })
    expect(memory.entities.count()).toBe(0)
  })

  it('confidence 越界:结构化失败载荷带 message', async () => {
    const result = await tool('memory_write').execute(
      { subject: 'u', key: 'k', content: 'v', confidence: 2 },
      fakeExec,
    )
    expect(result).toMatchObject({ ok: false })
    expect((result as { message: string }).message).toMatch(/confidence/)
  })
})

describe('memory_read 工具执行', () => {
  it('命中返回完整正文;未命中 found:false', async () => {
    await tool('memory_write').execute({ subject: 'org:acme', key: 'k', content: '正文内容' }, fakeExec)
    const found = await tool('memory_read').execute({ subject: 'org:acme', key: 'k' }, fakeExec)
    expect(found).toMatchObject({ ok: true, found: true })
    expect((found as { record: { content: string } }).record.content).toBe('正文内容')

    const missing = await tool('memory_read').execute({ subject: 'org:acme', key: 'nope' }, fakeExec)
    expect(missing).toMatchObject({ ok: true, found: false })
  })
})

describe('memory_search 工具执行', () => {
  it('M1+M2 联合命中,返回带出处', async () => {
    await tool('memory_write').execute({ subject: 'org:acme', key: 'venue', content: '科技园报告厅' }, fakeExec)
    await memory.writeNote('NOTES.md', '备忘:科技园报告厅容量 200')
    const result = await tool('memory_search').execute({ query: '科技园' }, fakeExec)
    expect(result).toMatchObject({ ok: true, count: 2 })
    const hits = (result as { hits: Array<{ kind: string; source: string }> }).hits
    expect(hits[0]!.kind).toBe('entity')
    expect(hits[1]!.source).toBe('notes:NOTES.md#L1')
  })
})

describe('memory_forget 工具执行', () => {
  it('应用逆闭包真删:forgotten 计数、正文不可再得', async () => {
    await tool('memory_write').execute({ subject: 'org:acme', key: 'k', content: '待遗忘内容' }, fakeExec)
    await tool('memory_write').execute({ subject: 'org:acme', key: 'k', content: '顶替后的内容' }, fakeExec)
    const result = await tool('memory_forget').execute({ subject: 'org:acme', key: 'k' }, fakeExec)
    expect(result).toMatchObject({ ok: true, forgotten: 2 })
    expect(memory.readEntity('org:acme', 'k')).toBeNull()
    expect(memory.entities.count()).toBe(0)
    const after = await tool('memory_search').execute({ query: '遗忘内容' }, fakeExec)
    expect((after as { count: number }).count).toBe(0)
  })

  it('遗忘不存在的键:forgotten 0 不报错', async () => {
    const result = await tool('memory_forget').execute({ subject: 'u', key: 'none' }, fakeExec)
    expect(result).toMatchObject({ ok: true, forgotten: 0 })
  })
})

describe('createMemoryIndexSection(systemPrompt 注入)', () => {
  it('PromptSection 形态:name/order/interpolate false;text 是预算内索引', () => {
    const section = createMemoryIndexSection(memory)
    const text = (section.text as () => string)()
    expect(section.name).toBe('memory:index')
    expect(section.order).toEqual(expect.any(Number))
    expect(section.interpolate).toBe(false)
    expect(estimateTokens(text)).toBeLessThanOrEqual(500)
  })

  it('text provider 动态:写入后内容变化(每次装配重建)', () => {
    const section = createMemoryIndexSection(memory)
    const render = section.text as () => string
    const before = render()
    memory.writeEntity({ subject: 'user:alice', key: 'new-fact', summary: '新事实', content: '新事实正文' })
    const after = render()
    expect(before).not.toContain('new-fact')
    expect(after).toContain('new-fact')
  })

  it('text 含 {{字面}} 的记忆不炸插值(interpolate:false 保真)', () => {
    memory.writeEntity({ subject: 'u', key: 'template-fact', content: '模板 {{var}} 字面保留', summary: '模板字面' })
    const text = (createMemoryIndexSection(memory).text as () => string)()
    expect(text).toContain('模板字面')
  })
})

describe('attachMemory(宿主级 effect,配逆即卸载干净)', () => {
  function fakeHost(): { host: MemoryHost; tools: string[]; sections: string[] } {
    const tools: string[] = []
    const sections: string[] = []
    return {
      tools,
      sections,
      host: {
        registerTool: (definition) => {
          tools.push(definition.name)
          return () => {
            const index = tools.indexOf(definition.name)
            if (index >= 0) tools.splice(index, 1)
          }
        },
        registerPromptSection: (section) => {
          sections.push(section.name)
          return () => {
            const index = sections.indexOf(section.name)
            if (index >= 0) sections.splice(index, 1)
          }
        },
      },
    }
  }

  it('注册四工具 + 索引 section;disposer 全部卸载;幂等', () => {
    const { host, tools, sections } = fakeHost()
    const dispose = attachMemory(host, memory)
    expect(tools).toEqual([...MEMORY_TOOL_NAMES])
    expect(sections).toEqual(['memory:index'])

    dispose()
    expect(tools).toHaveLength(0)
    expect(sections).toHaveLength(0)
    dispose()
  })

  it('includeIndexSection:false 只注册工具', () => {
    const { host, tools, sections } = fakeHost()
    attachMemory(host, memory, { includeIndexSection: false })
    expect(tools).toHaveLength(4)
    expect(sections).toHaveLength(0)
  })
})
