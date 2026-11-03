/** RRF 融合原语测试:排序、同源去重、优先级代表、k/topK、归一化。 */
import { describe, expect, it } from 'vitest'
import { fuseByRRF, hitKey } from '../src/index.ts'
import type { KnowledgeHit } from '../src/index.ts'

function hit(backend: string, docId: string, title = docId): KnowledgeHit {
  return {
    ref: { doc_id: docId, source_uri: `x://${docId}`, backend },
    title,
    snippet: '',
    score: 0.5,
    provenance: { origin: 't', status: 'active', trust: 'official', review: 'reviewed' },
  }
}

describe('fuseByRRF', () => {
  it('双列表:双路同时首位者得分最高(跨后端同 doc_id 各自保留,均排前)', () => {
    const wiki = [hit('wiki-local', 'a'), hit('wiki-local', 'b')]
    const weknora = [hit('weknora', 'a'), hit('weknora', 'c')]
    const fused = fuseByRRF([weknora, wiki])
    // 两个 a(weknora 版与 wiki 版,key 不同各自保留)并列首位,均高于单路名次第二的 b/c
    expect(fused.slice(0, 2).map(h => h.ref.doc_id)).toEqual(['a', 'a'])
    expect(fused.slice(2).map(h => h.ref.doc_id).sort()).toEqual(['b', 'c'])
    expect(fused[0]!.score).toBeLessThanOrEqual(1)
    expect(fused[0]!.score).toBeGreaterThan(fused[2]!.score)
  })

  it('同源去重:同 backend:doc_id 只保留一份(优先级高列表的代表对象)', () => {
    const primary = [hit('weknora', 'a', '权威标题')]
    const secondary = [{ ...hit('weknora', 'a', '次要标题'), score: 0.9 }]
    const fused = fuseByRRF([primary, secondary])
    expect(fused.length).toBe(1)
    expect(fused[0]!.title).toBe('权威标题')
    expect(fused[0]!.score).toBeCloseTo(1, 5) // 两列表均首位 → 归一满分
  })

  it('跨后端同 doc_id 不去重(不同知识域,各自保留)', () => {
    const fused = fuseByRRF([[hit('wiki-local', 'a')], [hit('weknora', 'a')]])
    expect(fused.length).toBe(2)
    expect(hitKey(fused[0]!)).not.toBe(hitKey(fused[1]!))
  })

  it('topK 截断;k 影响平滑度', () => {
    const list = [hit('wiki-local', 'a'), hit('wiki-local', 'b'), hit('wiki-local', 'c')]
    expect(fuseByRRF([list], { topK: 2 }).length).toBe(2)
    // 同列表内名次分严格递减(k=1 强调头部)
    const sharp = fuseByRRF([list], { k: 1 })
    expect(sharp[0]!.score).toBeGreaterThan(sharp[1]!.score)
    expect(sharp[1]!.score).toBeGreaterThan(sharp[2]!.score)
  })

  it('空输入稳健', () => {
    expect(fuseByRRF([])).toEqual([])
    expect(fuseByRRF([[], []])).toEqual([])
  })
})
