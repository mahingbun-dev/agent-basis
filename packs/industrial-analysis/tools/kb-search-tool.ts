/**
 * 工业知识库检索工具(确定性桩;首场景② 知识问答的确定性核心)。
 * 域语料(设备手册/工艺卡/预警规则库/处置案例)写死在桩内(Knowledge MCP 域语料
 * 接入前的桩):真实接入只换数据源、不动接口;输出恒带 source: 'stub-sample' 声明。
 * 纪律:结论必须带出处与版本(命中带 kb/docId/标题/版本与现成 citation,逐字引用);
 * 无命中是正常检索结局(count=0 + outcome='no-hit'),明说「知识库无命中」,绝不抛错兜底成编造。
 * 与基座 @basis/knowledge 的 knowledge_search(wiki-local/weknora 通用检索)分工:
 * 本工具只覆盖工业域语料;两者都经 Knowledge MCP(pgvector+图谱),不经公网。
 *
 * Cordis 纪律形态:
 * - 注册表 + 唯一 ID:@industrial-analysis/kb-search-tool(packctl lint CORD004 校验命名空间);
 * - 纯函数实现:无旁路全局、无裸定时器、无 Date.now(确定性,CORD001);
 * - 只读(R0 档):不做任何写入;语料修订走知识提案评审,不经本工具。
 */

/** 唯一 ID(注册表键;@industrial-analysis/* 命名空间)。 */
export const KB_SEARCH_TOOL_SERVICE_ID = '@industrial-analysis/kb-search-tool'

/** 域语料条目(样例;version 是结论引用的必带要素,不得虚构版本号)。 */
export interface KbDoc {
  readonly kbId: string
  readonly docId: string
  readonly title: string
  readonly version: string
  readonly updatedAt: string
  readonly keywords: readonly string[]
  readonly summary: string
}

/** 结构化命中:出处字段(kbId/docId/title/version)+ 现成 citation(逐字引用,不改写)。 */
export interface KbHit {
  readonly rank: number
  readonly kbId: string
  readonly docId: string
  readonly title: string
  readonly version: string
  readonly updatedAt: string
  readonly snippet: string
  readonly score: number
  /** 现成引用串:结论引用必须逐字带上(出处+版本),不得改写、不得虚构。 */
  readonly citation: string
}

/** 检索选项:topK 为返回条数上限(默认 5);kb 限定知识库(非法 kbId 抛错,口径不猜)。 */
export interface KbSearchOptions {
  readonly topK?: number
  readonly kb?: string
}

export interface KbSearchResult {
  readonly query: string
  readonly kb: string
  readonly count: number
  readonly hits: readonly KbHit[]
  /** 'hits' = 有命中;'no-hit' = 无命中(明说「知识库无命中」,不编造条文)。 */
  readonly outcome: 'hits' | 'no-hit'
  readonly source: 'stub-sample'
  /** 仅 outcome='no-hit' 时存在:无命中的应对口径(核对路径/语料补录走提案)。 */
  readonly hint?: string
}

/** 语料清单条目(knowledge/README.md 语料表的桩内侧;接入一条登一条)。 */
export interface KbSource {
  readonly kbId: string
  readonly name: string
  readonly corpus: string
  readonly docCount: number
  readonly source: 'stub-sample'
}

/** 可交换接口:任何提供同等 id 与能力的实现(真实 Knowledge MCP 域语料后端)可整体替换本模块。 */
export interface IndustrialKbSearchTool {
  readonly id: typeof KB_SEARCH_TOOL_SERVICE_ID
  /** 语料清单(样例):查检索词前先核对语料范围,超范围先确认是否接入,不硬查。 */
  listKb(): readonly KbSource[]
  /** 域语料检索:词命中计分(标题/关键词 ×2,摘要 ×1);无命中返回 count=0,不抛错。 */
  search(query: string, options?: KbSearchOptions): KbSearchResult
}

/** 样例语料(写死,确定性;与 timeseries/alert 桩同一套样例世界:RULE-* / ISO 10816 / 资产编号)。 */
const DOCS: readonly KbDoc[] = [
  {
    kbId: 'equipment-manuals',
    docId: 'MAN-MOTOR-VIB-001',
    title: '2#线电机轴承振动维护手册',
    version: 'v2026.09',
    updatedAt: '2026-09-30',
    keywords: ['电机', '轴承', '振动', '维护', '点检', '润滑', '对中', 'iso 10816'],
    summary: '轴承振动超 ISO 10816 C 区限值(4.5 mm/s)的处置路径:轴承点检 → 润滑确认 → '
      + '对中复查 → 视情更换轴承;连续 3 点越限即升级设备主管。',
  },
  {
    kbId: 'process-cards',
    docId: 'PROC-REACTOR-TEMP-002',
    title: '1#反应釜温度工艺卡',
    version: 'v2026.10',
    updatedAt: '2026-10-20',
    keywords: ['反应釜', '温度', '工艺', '超温', '保温', '降压'],
    summary: '运行区间 175–190 °C(上限对齐 RULE-TEMP-HIGH-190);超温处置:复核保温设定 → '
      + '降压降温 → 升级工艺;限值修订属工艺变更,走正式变更流程,不随口放宽。',
  },
  {
    kbId: 'rule-base',
    docId: 'RULE-KB-INDEX-003',
    title: '预警规则库速查(P0–P2)',
    version: 'v2026.11',
    updatedAt: '2026-11-01',
    keywords: ['规则', '限值', '分级', 'p0', 'p1', 'p2', 'rule', '升级路径'],
    summary: 'RULE-PRESS-HIGH-060(压力 0.60 MPa,P0 安全联锁)、RULE-TEMP-HIGH-190(温度 190 °C,P1)、'
      + 'RULE-VIB-ISO10816(振动 4.5 mm/s,P1)、RULE-STEAM-LOW-35(流量下限 35 t/h,P2);'
      + '升级路径:班组 → 工艺 → 设备 → 调度。',
  },
  {
    kbId: 'case-base',
    docId: 'CASE-STEAM-LOW-004',
    title: '蒸汽流量低限处置案例',
    version: 'v2026.08',
    updatedAt: '2026-08-15',
    keywords: ['流量', '锅炉', '蒸汽', '案例', '低限', '处置', '用汽负荷'],
    summary: '1#锅炉蒸汽流量骤降类(低于下限 35 t/h,RULE-STEAM-LOW-35):先核对用汽负荷与给水,'
      + '确认回升后观察至班末;同班复发 2 次即升级调度。',
  },
]

const DEFAULT_TOP_K = 5

/** 知识库清单名称(与 knowledge/README.md 语料表逐行对齐)。 */
const KB_NAMES: Readonly<Record<string, string>> = {
  'equipment-manuals': '设备手册库',
  'process-cards': '工艺卡库',
  'rule-base': '预警规则库',
  'case-base': '历史处置案例库',
}

/** 现成引用串(确定性):结论引用逐字带上,出处+版本齐全。 */
function citationOf(doc: KbDoc): string {
  return `《${doc.title}》 ${doc.version}(${doc.kbId}/${doc.docId},更新于 ${doc.updatedAt})`
}

/** 词命中计分:标题/关键词命中 ×2,摘要命中 ×1;大小写不敏感,子串包含。 */
function scoreDoc(doc: KbDoc, terms: readonly string[]): number {
  const title = doc.title.toLowerCase()
  const keywords = doc.keywords.map(k => k.toLowerCase())
  const summary = doc.summary.toLowerCase()
  let score = 0
  for (const term of terms) {
    if (title.includes(term) || keywords.some(k => k.includes(term) || term.includes(k))) score += 2
    else if (summary.includes(term)) score += 1
  }
  return score
}

export function createKbSearchTool(): IndustrialKbSearchTool {
  return {
    id: KB_SEARCH_TOOL_SERVICE_ID,
    listKb() {
      const kbIds = [...new Set(DOCS.map(doc => doc.kbId))]
      return kbIds.map(kbId => {
        const docs = DOCS.filter(doc => doc.kbId === kbId)
        return {
          kbId,
          name: KB_NAMES[kbId] ?? kbId,
          corpus: docs.map(doc => doc.docId).join(' / '),
          docCount: docs.length,
          source: 'stub-sample' as const,
        }
      })
    },
    search(query, options) {
      if (typeof query !== 'string' || query.trim().length === 0) {
        throw new Error('kb_search: query 必填(非空字符串;空格分词,设备/部位/主题词优先)')
      }
      const topK = options?.topK ?? DEFAULT_TOP_K
      if (!Number.isInteger(topK) || topK < 1) {
        throw new Error(`kb_search: topK 必须是正整数,收到: ${String(topK)}`)
      }
      const kbFilter = options?.kb
      const kbIds = [...new Set(DOCS.map(doc => doc.kbId))]
      if (kbFilter !== undefined && !kbIds.includes(kbFilter)) {
        throw new Error(`kb_search: 知识库 ${kbFilter} 不在语料清单内(可用: ${kbIds.join(' / ')};口径不猜)`)
      }

      // 检索词归一:小写、按空白分词、去重(确定性计分)。
      const terms = [...new Set(query.toLowerCase().split(/\s+/).filter(term => term.length > 0))]
      const pool = kbFilter === undefined ? DOCS : DOCS.filter(doc => doc.kbId === kbFilter)
      const matched = pool
        .map(doc => ({ doc, score: scoreDoc(doc, terms) }))
        .filter(entry => entry.score > 0)
        .sort((a, b) => b.score - a.score || (a.doc.docId < b.doc.docId ? -1 : 1))
        .slice(0, topK)

      if (matched.length === 0) {
        const result: KbSearchResult = {
          query,
          kb: kbFilter ?? 'all',
          count: 0,
          hits: [],
          outcome: 'no-hit',
          source: 'stub-sample',
          hint: '知识库无命中:明说「知识库无命中」,不编造条文、不拿邻近语料冒充;'
            + '核对资产编号/检索词后重查,语料缺失走知识提案评审补录(未过审不进检索)。',
        }
        return result
      }
      const hits: KbHit[] = matched.map((entry, index) => ({
        rank: index + 1,
        kbId: entry.doc.kbId,
        docId: entry.doc.docId,
        title: entry.doc.title,
        version: entry.doc.version,
        updatedAt: entry.doc.updatedAt,
        snippet: entry.doc.summary,
        score: entry.score,
        citation: citationOf(entry.doc),
      }))
      return {
        query,
        kb: kbFilter ?? 'all',
        count: hits.length,
        hits,
        outcome: 'hits',
        source: 'stub-sample',
      }
    },
  }
}
