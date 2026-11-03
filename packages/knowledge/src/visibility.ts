/**
 * 检索可见性裁决(纯函数)——"废弃知识不影响 agent"的第一道闸(设计文档 11 §2.1/§5)。
 *
 * 三条硬规则,任何一条命中即不可见:
 * 1. status=deprecated:废弃页物理留档(归档不删),检索出口逻辑不可见;
 * 2. superseded_by 非空:已被取代页与 deprecated 同等对待(旧结论只进 changelog/归档);
 * 3. trust=agent_drafted 且未过审(review=pending):AgentPoison 防线,agent 草稿必须过 governance
 *    门禁(trust 转 verified/official 或 review 转 reviewed)才能进入检索结果。
 *
 * 该裁决在 SQL 层(索引器)与出口层(KnowledgeService)各执行一次——纵深防御。
 */
import type { Provenance, SearchFilters } from './types.ts'

/** 不可见原因(空串 = 可见;用于测试断言与审计日志)。 */
export function hiddenReason(provenance: Provenance): string {
  if (provenance.status === 'deprecated') return 'status=deprecated(废弃页物理留档,检索不可见)'
  if (provenance.superseded_by !== undefined && provenance.superseded_by.length > 0) {
    return `已被 ${provenance.superseded_by} 取代(superseded)`
  }
  if (provenance.trust === 'agent_drafted' && provenance.review !== 'reviewed') {
    return 'agent_drafted 未过审(投毒防线:必须过 governance 门禁)'
  }
  return ''
}

/** 是否可进入检索结果(硬规则 + 调用方追加过滤)。 */
export function isVisibleInSearch(provenance: Provenance, filters?: SearchFilters): boolean {
  if (hiddenReason(provenance) !== '') return false
  if (filters !== undefined) {
    if (filters.trust !== undefined && !filters.trust.includes(provenance.trust)) return false
    if (filters.exclude_stale === true && provenance.status === 'stale') return false
  }
  return true
}
