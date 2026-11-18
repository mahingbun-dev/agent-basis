/**
 * K1.3 规范化块协议单测(36 号 §3 表验收门禁,= 33 号 G2-B3):
 * - 四类块 JSON 往返(序列化-反序列化逐字段相等);
 * - 对全部块样例断言保留键名白名单外零泄漏(encrypted_content/signature/web_search_usage
 *   等禁入键不得出现——顶层与嵌套深度双重防护);
 * - publishTime 必须可空(29a R6 修正)与归一化容错(R6 unresolved-②:RFC1123 示例格式);
 * - 块协议状态 draft 钉死(O-2:字段集未经评审不固化 golden)。
 */
import { describe, expect, it } from 'vitest'
import {
  BLOCK_KEY_WHITELIST,
  BLOCK_PROTOCOL_STATUS,
  BlockLeakError,
  assertBlocksSerializable,
  findBlockLeaks,
  normalizePublishTime,
  serializeBlocks,
} from '../src/blocks/index.ts'
import type { AttachmentRefBlock, CitationBlock, NormalizedBlock, SearchStepBlock, SourceBlock } from '../src/blocks/index.ts'

/** 四类块全字段样例(字段级来源见 src/blocks/types.ts 各接口注释)。 */
const SOURCE: SourceBlock = {
  type: 'source',
  title: '场地选址指南',
  url: 'https://example.com/venue-guide',
  summary: '活动策划中的场地选址要素与档期核对清单。',
  publishTime: '2026-10-12T08:00:00.000Z',
  siteName: 'example.com',
  icon: 'https://example.com/favicon.ico',
}

const SOURCE_NULL_TIME: SourceBlock = {
  type: 'source',
  title: '无发布时间来源',
  url: 'https://example.com/no-date',
  summary: 'Tavily best-estimate 不可检测时 publish_date 为 null。',
  publishTime: null,
}

const CITATION: CitationBlock = { type: 'citation', index: 1, sourceIndex: 0 }

const SEARCH_STEP: SearchStepBlock = {
  type: 'search_step',
  step: 2,
  action: 'open_page',
  url: 'https://example.com/venue-guide',
  status: 'ok',
}

const SEARCH_STEP_ERROR: SearchStepBlock = {
  type: 'search_step',
  step: 3,
  action: 'search',
  query: '场地 档期',
  status: 'error',
  detail: 'invalid_tool_input:查询词条过长',
}

const ATTACHMENT: AttachmentRefBlock = { type: 'attachment_ref', fileId: 'file-9f2c', name: '选址手册.pdf' }

const ALL_BLOCKS: readonly NormalizedBlock[] = [SOURCE, SOURCE_NULL_TIME, CITATION, SEARCH_STEP, SEARCH_STEP_ERROR, ATTACHMENT]

describe('四类块 JSON 往返(29 §1 ④:渲染与 prompt 的唯一消费物)', () => {
  it('全部块样例序列化-反序列化逐字段相等', () => {
    for (const block of ALL_BLOCKS) {
      expect(JSON.parse(JSON.stringify(block))).toEqual(block)
    }
  })

  it('块序列整体往返相等', () => {
    expect(JSON.parse(serializeBlocks(ALL_BLOCKS))).toEqual(ALL_BLOCKS)
  })

  it('四类 type 判别值齐备', () => {
    const types = new Set(ALL_BLOCKS.map(block => block.type))
    expect([...types].sort()).toEqual(['attachment_ref', 'citation', 'search_step', 'source'])
  })
})

describe('保留键名白名单外零泄漏(29 §2.1 禁提供方字段透传)', () => {
  it('全部块样例零泄漏', () => {
    expect(findBlockLeaks(ALL_BLOCKS)).toEqual([])
    expect(() => {
      assertBlocksSerializable(ALL_BLOCKS)
    }).not.toThrow()
  })

  it('白名单键集与四类块字段一一对应(顶层键上限)', () => {
    expect([...BLOCK_KEY_WHITELIST.source]).toEqual(['type', 'title', 'url', 'summary', 'publishTime', 'siteName', 'icon'])
    expect([...BLOCK_KEY_WHITELIST.citation]).toEqual(['type', 'index', 'sourceIndex'])
    expect([...BLOCK_KEY_WHITELIST.search_step]).toEqual(['type', 'step', 'action', 'query', 'url', 'status', 'detail'])
    expect([...BLOCK_KEY_WHITELIST.attachment_ref]).toEqual(['type', 'fileId', 'name'])
  })

  it('顶层白名单外键命中(Tavily score 不得透传进块)', () => {
    const leaks = findBlockLeaks([{ ...SOURCE, score: 0.97 }])
    expect(leaks).toHaveLength(1)
    expect(leaks[0]).toMatchObject({ path: '$[0].score', key: 'score', reason: 'not-whitelisted' })
    expect(() => {
      assertBlocksSerializable([{ ...SOURCE, score: 0.97 }])
    }).toThrow(BlockLeakError)
  })

  it('encrypted_content 顶层混入 → 双重命中(白名单外键 + 禁入键)', () => {
    const leaks = findBlockLeaks([{ ...SOURCE, encrypted_content: 'blob' }])
    expect(leaks).toHaveLength(2)
    expect(leaks).toEqual(expect.arrayContaining([
      expect.objectContaining({ key: 'encrypted_content', reason: 'forbidden', source: 'provider' }),
      expect.objectContaining({ key: 'encrypted_content', reason: 'not-whitelisted' }),
    ]))
  })

  it('signature 嵌套混入(summary 值内层对象藏 signature) → 拒绝', () => {
    const smuggled = { ...SOURCE, summary: { text: 'x', signature: 'sig-1' } } as unknown
    expect(findBlockLeaks([smuggled])).toHaveLength(1)
    expect(() => {
      assertBlocksSerializable([smuggled])
    }).toThrow(/signature/)
  })

  it('web_search_usage 混入 → 双重命中(白名单外键 + 禁入键;MiMo 记账字段)', () => {
    const leaks = findBlockLeaks([{ ...SEARCH_STEP, web_search_usage: { tool_usage: 1 } }])
    expect(leaks).toHaveLength(2)
    expect(leaks).toEqual(expect.arrayContaining([
      expect.objectContaining({ key: 'web_search_usage', reason: 'forbidden', source: 'provider' }),
      expect.objectContaining({ key: 'web_search_usage', reason: 'not-whitelisted' }),
    ]))
  })

  it('未知块类型/非对象成员 → not-whitelisted', () => {
    expect(findBlockLeaks([{ type: 'mystery' }])[0]?.reason).toBe('not-whitelisted')
    expect(findBlockLeaks([null])[0]?.reason).toBe('not-whitelisted')
  })

  it('serializeBlocks 守卫先行:泄漏时抛错不产 JSON', () => {
    expect(() => {
      serializeBlocks([{ ...SOURCE, encrypted_content: 'x' }])
    }).toThrow(BlockLeakError)
  })
})

describe('publishTime 可空与归一化(29a R6 修正 + unresolved-② 容错)', () => {
  it('publishTime 必须可空——null 样例守卫通过', () => {
    expect(SOURCE_NULL_TIME.publishTime).toBeNull()
    expect(findBlockLeaks([SOURCE_NULL_TIME])).toEqual([])
  })

  it('null/undefined/空串 → null', () => {
    expect(normalizePublishTime(null)).toBeNull()
    expect(normalizePublishTime(undefined)).toBeNull()
    expect(normalizePublishTime('')).toBeNull()
  })

  it('RFC1123 示例格式(R6 官方示例)→ ISO 8601 UTC', () => {
    expect(normalizePublishTime('Tue, 11 Mar 2025 17:00:00 GMT')).toBe('2025-03-11T17:00:00.000Z')
  })

  it('ISO 8601 输入归一为 UTC ISO 串', () => {
    expect(normalizePublishTime('2026-10-12T16:00:00+08:00')).toBe('2026-10-12T08:00:00.000Z')
  })

  it('不可解析串原样保留(容错:不虚构时间、不静默丢弃)', () => {
    expect(normalizePublishTime('not-a-date')).toBe('not-a-date')
  })
})

describe('块协议状态(O-2)', () => {
  it('字段集固化前恒为 draft(评审确认 §2.3 字段集后才改 golden)', () => {
    expect(BLOCK_PROTOCOL_STATUS).toBe('draft')
  })
})
