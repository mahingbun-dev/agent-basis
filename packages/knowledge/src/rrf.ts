/**
 * 倒数排名融合(Reciprocal Rank Fusion)——dual 模式骨架的融合原语(设计文档 11 §1:dual=RRF 融合、同源去重)。
 *
 * 纯函数:多路有序命中列表 → 单列表。列表顺序即优先级(权威后端在前),同 key 命中取优先级最高列表的对象;
 * score = Σ 1/(k+rank) 归一化到 (0,1]。k=60 为 RRF 文献常用值。
 */
import type { KnowledgeHit } from './types.ts'

/** 命中去重键:backend + doc_id(同源去重)。 */
export function hitKey(hit: KnowledgeHit): string {
  return `${hit.ref.backend}:${hit.ref.doc_id}`
}

export interface FuseOptions {
  /** RRF 平滑常数,默认 60。 */
  readonly k?: number | undefined
  /** 融合后截断条数;缺省不截断。 */
  readonly topK?: number | undefined
}

/** RRF 融合;空列表集或全空列表返回 []。 */
export function fuseByRRF(lists: readonly (readonly KnowledgeHit[])[], options?: FuseOptions): KnowledgeHit[] {
  const k = options?.k ?? 60
  const topK = options?.topK
  const scores = new Map<string, number>()
  const representative = new Map<string, KnowledgeHit>()
  for (const list of lists) {
    for (let i = 0; i < list.length; i++) {
      const hit = list[i]
      if (hit === undefined) continue
      const key = hitKey(hit)
      // 同列表内重复 key 只记首现(列表自身保证有序)
      if (!representative.has(key)) representative.set(key, hit)
      const contribution = 1 / (k + i + 1)
      scores.set(key, (scores.get(key) ?? 0) + contribution)
    }
  }
  const fused: KnowledgeHit[] = [...representative.entries()].map(([key, hit]) => ({
    ...hit,
    score: normalizeRrf(scores.get(key) ?? 0, k, lists.length),
  }))
  fused.sort((a, b) => b.score - a.score || hitKey(a).localeCompare(hitKey(b)))
  return topK === undefined ? fused : fused.slice(0, topK)
}

/** Σ 1/(k+rank) → (0,1]:除以单列表理论满分 Σ_{i=0}^{n-1} 1/(k+i+1),保证两后端全命中同一文档时 ≈1。 */
function normalizeRrf(sum: number, k: number, listCount: number): number {
  if (listCount <= 0) return 0
  let full = 0
  for (let i = 0; i < listCount; i++) full += 1 / (k + i + 1)
  return Math.min(1, sum / full)
}
