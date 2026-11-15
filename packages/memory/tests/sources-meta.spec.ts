/**
 * Sources 行数据面(M-M3 T12-④,勘察 S3 结论 b 路径)服务面单测:
 * - memory_read/memory_search 输出定义携带 presentationMeta(S3 结论 b:
 *   工具属主投影,客户端 event.data.meta 直读零解析);
 * - memorySourcesMetaOf 防御投影:命中/零命中/失败载荷三态;
 * - 端到端:write→read 的 meta 锚点可追溯(entity:<subject>/<key>#<id>)。
 */
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import type { ToolRunContext } from '@deepseek-ai/dsh-tools'
import { createMemory, defineMemoryTools, memorySourcesMetaOf, MEMORY_SOURCES_TOOL_NAMES } from '../src/index.ts'
import type { Memory } from '../src/index.ts'

const dir = mkdtempSync(join(tmpdir(), 'eterna-memory-sources-'))
const memory: Memory = createMemory({ workspaceDir: dir, dbPath: join(dir, 'memory.db') })
afterAll(() => {
  memory.dispose()
  rmSync(dir, { recursive: true, force: true })
})

/** 最小执行上下文(工具只依赖 signal 语义)。 */
const fakeExec = { name: 'test', signal: new AbortController().signal } as unknown as ToolRunContext

describe('MEMORY_SOURCES_TOOL_NAMES(采集口径)', () => {
  it('恰为 memory_read 与 memory_search(Sources 行只采读取面)', () => {
    expect([...MEMORY_SOURCES_TOOL_NAMES]).toEqual(['memory_read', 'memory_search'])
  })
})

describe('presentationMeta 投影(S3 结论 b)', () => {
  it('memory_read/memory_search 输出定义都声明 presentationMeta', () => {
    const definitions = defineMemoryTools(memory)
    for (const name of MEMORY_SOURCES_TOOL_NAMES) {
      const found = definitions.find(definition => definition.name === name)
      expect(typeof found?.output.presentationMeta === 'function', `${name} 缺 presentationMeta`).toBe(true)
    }
  })

  it('memory_search 命中 → meta 携带 hits 全量条目', () => {
    const meta = memorySourcesMetaOf('memory_search', {
      ok: true,
      query: '周报',
      count: 2,
      hits: [
        { source: 'entity:user/report-lang#3', kind: 'entity', title: 'user/report-lang', summary: '周报用中文' },
        { source: 'notes/venue.md#L4', kind: 'note', title: 'venue.md#L4', summary: '场地候选' },
      ],
    })
    expect(meta).toEqual({
      tool: 'memory_search',
      reads: [
        { source: 'entity:user/report-lang#3', kind: 'entity', title: 'user/report-lang', summary: '周报用中文' },
        { source: 'notes/venue.md#L4', kind: 'note', title: 'venue.md#L4', summary: '场地候选' },
      ],
    })
  })

  it('零命中/失败载荷 → reads 空表(客户端按空不挂载)', () => {
    expect(memorySourcesMetaOf('memory_search', { ok: true, query: 'x', count: 0, hits: [] }).reads).toEqual([])
    expect(memorySourcesMetaOf('memory_search', { ok: false, message: 'blocked' }).reads).toEqual([])
    expect(memorySourcesMetaOf('memory_read', { ok: true, found: false, subject: 'user', key: 'x' }).reads).toEqual([])
  })

  it('memory_read found → meta 携带单条实体锚点(entity:<subject>/<key>#<id>)', () => {
    const meta = memorySourcesMetaOf('memory_read', {
      ok: true,
      found: true,
      record: { id: 7, subject: 'user', key: 'report-lang', content: '周报用中文', summary: null },
    })
    expect(meta.tool).toBe('memory_read')
    expect(meta.reads).toEqual([
      { source: 'entity:user/report-lang#7', kind: 'entity', title: 'user/report-lang', summary: '' },
    ])
  })

  it('坏形状防御降级:条目缺 source/kind 非法 → 跳过不抛', () => {
    const meta = memorySourcesMetaOf('memory_search', {
      ok: true,
      count: 2,
      hits: [{ title: 'no-source' }, { source: 's', kind: 'wrong', title: 't' }, { source: 's2', kind: 'note', title: 't2' }],
    })
    expect(meta.reads).toEqual([{ source: 's2', kind: 'note', title: 't2', summary: '' }])
  })

  it('端到端:工具 execute 后 presentationMeta 与输出一致(write→read)', async () => {
    const definitions = defineMemoryTools(memory)
    const write = definitions.find(definition => definition.name === 'memory_write')
    const read = definitions.find(definition => definition.name === 'memory_read')
    await write?.execute(
      { subject: 'user', key: 'e2e-src', content: '跨会话记忆来源端到端', kind: 'semantic', summary: '来源端到端' },
      fakeExec,
    )
    const value = await read?.execute({ subject: 'user', key: 'e2e-src' }, fakeExec) as Record<string, unknown>
    const meta = read?.output.presentationMeta?.({}, value as never) as { tool: string; reads: { source: string }[] }
    expect(meta.tool).toBe('memory_read')
    expect(meta.reads[0]?.source).toContain('entity:user/e2e-src#')
  })
})
