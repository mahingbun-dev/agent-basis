/**
 * Sources 行客户端单测(M-M3 T12-④;组件渲染需 react-dom,由 dsh web 壳运行时
 * 提供,本包依赖图不可达——这里钉会话事件累计器状态机与 turnTail 读取面):
 * - memorySourcesMatch:turn/start 与记忆工具 call/result 抓取,其余不相关;
 * - memorySourcesStart/Update:按 callId 配对追加,source 去重,不可变更新;
 * - memorySourcesBuildLocationData:turn 相位发布,值身份不变回 previous;
 * - selectMemorySources/sourcesFromMeta:无数据/坏 meta 防御降级。
 */
import { describe, expect, it } from 'vitest'
import {
  memorySourcesBuildLocationData, memorySourcesDefinition, memorySourcesMatch,
  memorySourcesStart, memorySourcesUpdate, selectMemorySources, sourcesFromMeta,
  MEMORY_SOURCES_DATA_KEY,
} from '../src/client/sources.tsx'
import type { MemorySourcesState, MemorySourcesTurnData } from '../src/client/sources.tsx'
import type { ConversationNodeContextLike, SessionEventLike } from '../src/client/client-types.ts'

/** 事件构造器(载荷形状对齐 dsh-session types:tool/call 与 tool/result)。 */
function turnStart(turn: number): SessionEventLike {
  return { type: 'turn/start', seq: turn, data: { turn } }
}
function toolCall(turn: number, callId: string, name: string): SessionEventLike {
  return { type: 'tool/call', seq: turn * 10, data: { turn, step: 1, callId, name, arguments: '{}' } }
}
function toolResult(turn: number, callId: string, meta: unknown): SessionEventLike {
  return {
    type: 'tool/result',
    seq: turn * 10 + 1,
    data: { turn, step: 1, message: { source: { callId } }, ...(meta !== undefined ? { meta } : {}) },
  }
}

const context = (state: MemorySourcesState): ConversationNodeContextLike & { readonly state: MemorySourcesState } => ({
  key: 'memory-sources:1', kind: MEMORY_SOURCES_DATA_KEY, id: '1', state,
})

const READ_META = {
  tool: 'memory_read',
  reads: [{ source: 'entity:user/lang#1', kind: 'entity', title: 'user/lang', summary: '周报用中文' }],
}
const SEARCH_META = {
  tool: 'memory_search',
  reads: [{ source: 'entity:user/lang#1', kind: 'entity', title: 'user/lang', summary: '周报用中文' }, { source: 'notes/a.md#L2', kind: 'note', title: 'a.md#L2', summary: '备注' }],
}

describe('memorySourcesMatch(S3 主路径第 1 步)', () => {
  it('turn/start → start 匹配(turn 号即身份)', () => {
    expect(memorySourcesMatch(turnStart(3))).toEqual({ id: '3', role: 'start' })
  })

  it('记忆工具的 tool/call → update;非记忆工具 → null', () => {
    expect(memorySourcesMatch(toolCall(3, 'c1', 'memory_read'))).toEqual({ id: '3', role: 'update' })
    expect(memorySourcesMatch(toolCall(3, 'c1', 'memory_search'))).toEqual({ id: '3', role: 'update' })
    expect(memorySourcesMatch(toolCall(3, 'c1', 'memory_write'))).toBeNull()
    expect(memorySourcesMatch(toolCall(3, 'c1', 'fs_read'))).toBeNull()
  })

  it('带 meta 的 tool/result → update;无 meta/坏 meta → null', () => {
    expect(memorySourcesMatch(toolResult(3, 'c1', READ_META))).toEqual({ id: '3', role: 'update' })
    expect(memorySourcesMatch(toolResult(3, 'c1', undefined))).toBeNull()
    expect(memorySourcesMatch(toolResult(3, 'c1', { tool: 'fs_read' }))).toBeNull()
  })

  it('其余事件类型一律 null', () => {
    expect(memorySourcesMatch({ type: 'user/message', data: {} })).toBeNull()
    expect(memorySourcesMatch({ type: 'assistant/message', data: {} })).toBeNull()
    expect(memorySourcesMatch({ type: 'turn/end', data: { turn: 3 } })).toBeNull()
  })

  it('turn 号缺席(turn/start 无 data.turn)→ null', () => {
    expect(memorySourcesMatch({ type: 'turn/start', data: {} })).toBeNull()
  })
})

describe('memorySourcesStart/Update(累计状态机)', () => {
  it('start 从 turn/start 建空状态', () => {
    const state = memorySourcesStart({ key: 'k', kind: 'k', id: '1' }, { event: turnStart(5), role: 'start' })
    expect(state).toEqual({ turn: 5, reads: [], calls: new Map() })
  })

  it('start 非 turn/start 抛错(契约)', () => {
    expect(() => memorySourcesStart(
      { key: 'k', kind: 'k', id: '1' },
      { event: toolCall(1, 'c', 'memory_read'), role: 'start' },
    )).toThrow()
  })

  it('update:tool/call 记调用身份 → tool/result 按 callId 配对追加', () => {
    let state = memorySourcesStart({ key: 'k', kind: 'k', id: '1' }, { event: turnStart(2), role: 'start' })
    state = memorySourcesUpdate(context(state), { event: toolCall(2, 'call-a', 'memory_read'), role: 'update' })
    expect(state.calls.get('call-a')).toBe('memory_read')
    state = memorySourcesUpdate(context(state), { event: toolResult(2, 'call-a', READ_META), role: 'update' })
    expect(state.reads).toEqual(READ_META.reads)
  })

  it('update:未配对调用(callId 不在 calls)→ 不归属本回合', () => {
    let state = memorySourcesStart({ key: 'k', kind: 'k', id: '1' }, { event: turnStart(2), role: 'start' })
    state = memorySourcesUpdate(context(state), { event: toolResult(2, 'ghost', READ_META), role: 'update' })
    expect(state.reads).toEqual([])
  })

  it('update:同一 source 跨调用去重(首见序)', () => {
    let state = memorySourcesStart({ key: 'k', kind: 'k', id: '1' }, { event: turnStart(2), role: 'start' })
    state = memorySourcesUpdate(context(state), { event: toolCall(2, 'a', 'memory_read'), role: 'update' })
    state = memorySourcesUpdate(context(state), { event: toolCall(2, 'b', 'memory_search'), role: 'update' })
    state = memorySourcesUpdate(context(state), { event: toolResult(2, 'a', READ_META), role: 'update' })
    state = memorySourcesUpdate(context(state), { event: toolResult(2, 'b', SEARCH_META), role: 'update' })
    expect(state.reads.map(entry => entry.source)).toEqual(['entity:user/lang#1', 'notes/a.md#L2'])
  })

  it('update:非记忆工具 call/result 不改状态', () => {
    let state = memorySourcesStart({ key: 'k', kind: 'k', id: '1' }, { event: turnStart(2), role: 'start' })
    state = memorySourcesUpdate(context(state), { event: toolCall(2, 'x', 'memory_write'), role: 'update' })
    state = memorySourcesUpdate(context(state), { event: toolResult(2, 'x', READ_META), role: 'update' })
    expect(state.reads).toEqual([])
  })

  it('update:不可变更新(旧 state 与 calls 引用不被改写)', () => {
    const initial = memorySourcesStart({ key: 'k', kind: 'k', id: '1' }, { event: turnStart(2), role: 'start' })
    const afterCall = memorySourcesUpdate(context(initial), { event: toolCall(2, 'a', 'memory_read'), role: 'update' })
    expect(initial.calls.size).toBe(0)
    expect(afterCall.calls.get('a')).toBe('memory_read')
  })
})

describe('memorySourcesBuildLocationData(S3 主路径第 2 步)', () => {
  const base = memorySourcesStart({ key: 'k', kind: 'k', id: '1' }, { event: turnStart(4), role: 'start' })
  const withReads = memorySourcesUpdate(context(base), { event: toolCall(4, 'a', 'memory_read'), role: 'update' })
  const published = memorySourcesUpdate(context(withReads), { event: toolResult(4, 'a', READ_META), role: 'update' })

  it('step 相位返回 null(只发布 turn 相位)', () => {
    expect(memorySourcesBuildLocationData(context(base), 'step', null)).toBeNull()
  })

  it('turn 相位发布 {kind:"turn", turn, key, value:{reads}}', () => {
    const data = memorySourcesBuildLocationData(context(published), 'turn', null)
    expect(data).not.toBeNull()
    expect(data?.kind).toBe('turn')
    expect(data?.turn).toBe(4)
    expect(data?.key).toBe('memory-sources')
    expect((data?.value as MemorySourcesTurnData).reads).toEqual(READ_META.reads)
  })

  it('值身份不变 → 返回 previous(deliverables 同款省发布)', () => {
    const first = memorySourcesBuildLocationData(context(published), 'turn', null)
    const again = memorySourcesBuildLocationData(context(published), 'turn', first)
    expect(again).toBe(first)
  })
})

describe('turnTail 读取面(第 2 步消费)', () => {
  it('sourcesFromMeta:坏 meta / 非记忆工具 / 坏条目防御降级', () => {
    expect(sourcesFromMeta(undefined)).toEqual([])
    expect(sourcesFromMeta('text')).toEqual([])
    expect(sourcesFromMeta({ tool: 'memory_write', reads: [{}] })).toEqual([])
    expect(sourcesFromMeta({ tool: 'memory_read', reads: [{ source: 's', kind: 'entity', title: 't', summary: 'm' }] })).toEqual([
      { source: 's', kind: 'entity', title: 't', summary: 'm' },
    ])
  })

  it('selectMemorySources:无数据/空 reads 返回 null(deliverables 同款不挂载闸)', () => {
    const emptyOwner = { turn: 1, status: "closed" as const, data: { get: (): undefined => undefined } }
    expect(selectMemorySources(emptyOwner)).toBeNull()
    const blankOwner = { turn: 1, status: "closed" as const, data: { get: () => ({ reads: [] }) } }
    expect(selectMemorySources(blankOwner)).toBeNull()
  })

  it('selectMemorySources:有 reads 返回条目清单', () => {
    const owner = { turn: 1, status: "closed" as const, data: { get: () => ({ reads: READ_META.reads }) } }
    expect(selectMemorySources(owner)).toEqual(READ_META.reads)
  })

  it('definition kind 与 Location key 一致(引擎归属键面)', () => {
    expect(memorySourcesDefinition.kind).toBe(MEMORY_SOURCES_DATA_KEY)
    expect(memorySourcesDefinition.buildLocationData).toBeTypeOf('function')
  })
})
