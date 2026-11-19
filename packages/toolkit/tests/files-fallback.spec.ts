/**
 * K2.3 files 混合兜底单测【=G2-B8 测试半】(36 号 §3 表/§6 门禁总表)。
 *
 * 29 §7-3 Q3 拍板:图片对视觉模型 base64 内联;文档文本抽取 + 体积上限;
 * 不可解析→显式降级(unavailable+错误步骤块,不静默消失);矩阵如实标注 generic=「文本级」。
 * 体积上限与抽取器均为注入位(契约未给上限数字/提供方无文件端点——不发明默认值)。
 */
import { describe, expect, it } from 'vitest'
import { executeFilesFallback, runGenericCapability } from '../src/index.ts'
import { createCapabilityRequest } from '../src/index.ts'
import { routeCapability } from '../src/index.ts'

const encoder = new TextEncoder()

function item(block: Uint8Array): string {
  let binary = ''
  for (const byte of block) binary += String.fromCharCode(byte)
  return btoa(binary)
}

describe('Q3 · 按类型混合兜底', () => {
  it('图片:base64 内联 data URL(视觉模型),字节可逆', async () => {
    const bytes = encoder.encode('png-bytes')
    const [result] = await executeFilesFallback(
      [{ kind: 'image', name: '截图.png', bytes, mediaType: 'image/png' }],
      { maxBytes: 1024 },
      {},
    )
    expect(result?.status).toBe('ok')
    expect(result?.inlineDataUrl).toBe(`data:image/png;base64,${item(bytes)}`)
    expect(result?.block).toEqual({ type: 'search_step', step: 1, action: 'tool_call', status: 'ok' })
  })

  it('图片缺 mediaType:显式降级(不发明默认前缀)', async () => {
    const [result] = await executeFilesFallback(
      [{ kind: 'image', name: 'a.jpg', bytes: encoder.encode('x') }],
      { maxBytes: 1024 },
      {},
    )
    expect(result?.status).toBe('unavailable')
    expect(result?.reason).toContain('mediaType')
    expect(result?.block.status).toBe('error')
  })

  it('超体积上限:显式降级且不调抽取器(体积上限,29 §7-3 Q3)', async () => {
    let extractions = 0
    const [result] = await executeFilesFallback(
      [{ kind: 'document', name: 'big.pdf', bytes: encoder.encode('123456789') }],
      { maxBytes: 4 },
      {
        extractText: async () => {
          extractions += 1
          return '不应被抽取'
        },
      },
    )
    expect(extractions).toBe(0)
    expect(result?.status).toBe('unavailable')
    expect(result?.reason).toContain('超体积上限')
  })

  it('文档:抽取器注入路径 ok(文本入消息内容)', async () => {
    const [result] = await executeFilesFallback(
      [{ kind: 'document', name: '规格.docx', bytes: encoder.encode('doc') }],
      { maxBytes: 1024 },
      { extractText: async () => '抽取出的文档文本' },
    )
    expect(result?.status).toBe('ok')
    expect(result?.text).toBe('抽取出的文档文本')
  })

  it('不可解析(抽取器返回空)/抽取抛错/未配置抽取器:三态都显式降级,不静默消失', async () => {
    const [unparseable] = await executeFilesFallback(
      [{ kind: 'document', name: 'a.pdf', bytes: encoder.encode('x') }],
      { maxBytes: 1024 },
      { extractText: async () => null },
    )
    expect(unparseable?.status).toBe('unavailable')
    expect(unparseable?.reason).toContain('不可解析')

    const [threw] = await executeFilesFallback(
      [{ kind: 'document', name: 'b.pdf', bytes: encoder.encode('x') }],
      { maxBytes: 1024 },
      {
        extractText: async () => {
          throw new Error('解析器崩溃')
        },
      },
    )
    expect(threw?.status).toBe('unavailable')
    expect(threw?.reason).toContain('解析器崩溃')

    const [noExtractor] = await executeFilesFallback(
      [{ kind: 'document', name: 'c.pdf', bytes: encoder.encode('x') }],
      { maxBytes: 1024 },
      {},
    )
    expect(noExtractor?.status).toBe('unavailable')
    expect(noExtractor?.reason).toContain('无文本抽取器')
  })

  it('混合批次:步骤序号连续;部分降级整体 degraded(reason 逐项留痕)', async () => {
    const results = await executeFilesFallback(
      [
        { kind: 'image', name: 'ok.png', bytes: encoder.encode('img'), mediaType: 'image/png' },
        { kind: 'document', name: 'bad.pdf', bytes: encoder.encode('x'), mediaType: 'application/pdf' },
      ],
      { maxBytes: 1024 },
      { extractText: async () => null },
    )
    expect(results.map(result => result.block.step)).toEqual([1, 2])
    const outcome = await runGenericCapability(
      createCapabilityRequest('files', {}),
      { extractText: async () => null },
      {
        filesInputs: [
          { kind: 'image', name: 'ok.png', bytes: encoder.encode('img'), mediaType: 'image/png' },
          { kind: 'document', name: 'bad.pdf', bytes: encoder.encode('x'), mediaType: 'application/pdf' },
        ],
        filesLimits: { maxBytes: 1024 },
      },
    )
    expect(outcome.status).toBe('degraded')
    expect(outcome.reason).toContain('不可解析')
    expect(JSON.parse(outcome.toolResult ?? '[]')).toEqual([
      { name: 'ok.png', kind: 'image', status: 'ok' },
      { name: 'bad.pdf', kind: 'document', status: 'unavailable', reason: expect.stringContaining('不可解析') as unknown },
    ])
  })

  it('能力级入口防呆:空输入/缺体积上限都显式 unavailable(不发明默认上限)', async () => {
    const empty = await runGenericCapability(createCapabilityRequest('files', {}), {})
    expect(empty.status).toBe('unavailable')
    expect(empty.reason).toContain('filesInputs')
    const noLimits = await runGenericCapability(
      createCapabilityRequest('files', {}),
      {},
      { filesInputs: [{ kind: 'document', name: 'a.pdf', bytes: encoder.encode('x') }] },
    )
    expect(noLimits.status).toBe('unavailable')
    expect(noLimits.reason).toContain('体积上限必填')
  })
})

describe('Q3 · 矩阵粒度标注', () => {
  it('generic 对话模型 files 裁决=fallback(generic-function-loop)+文本级(29 §7-3)', () => {
    const decision = routeCapability({ providers: {} }, { provider: 'generic', model: 'third-party-chat' }, 'files')
    expect(decision.route).toBe('fallback')
    expect(decision.adapter).toBe('generic-function-loop')
    expect(decision.filesGranularity).toBe('text-level')
  })
})
