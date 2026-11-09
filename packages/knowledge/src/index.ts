/**
 * @eterna/knowledge —— L1 知识插件(设计文档 11:一个出口,两个后端)。
 *
 * 模块地图:
 * 1. types.ts        —— KnowledgeHit 统一 schema + provenance 全量规范(两后端同形);
 * 2. frontmatter.ts  —— markdown 页面解析/序列化(status/trust/last_verified/superseded_by/source + changelog + wikilink);
 * 3. visibility.ts   —— 检索可见性硬过滤(deprecated / superseded / agent_drafted 未过审);
 * 4. indexer.ts      —— node:sqlite FTS5(trigram)+ 短词 LIKE 回退双路召回,RRF 融合,提案表;
 * 5. wiki.ts         —— wiki-local 后端:混合检索(关键词优先、向量接口留位)+ propose→门禁→发布 流水线;
 * 6. weknora.ts      —— WeKnora HTTP 适配器(手动启用;真连后置,见 blockers);
 * 7. rrf.ts          —— RRF 融合原语(dual 模式骨架);
 * 8. service.ts      —— KnowledgeService 组合层(注册表 + KNOWLEDGE_SERVICE_ID,出口级复滤 + dual 融合);
 * 9. tools.ts        —— 模型面四工具 knowledge_search/read/status/propose + DSH ToolDefinition 适配。
 *
 * Cordis 纪律:effect 配逆(registerBackend/reviewProposal/deprecate 均返回 undo/disposer);
 * coeffect 全声明(fs/fetch/时钟/门禁/凭据解析器构造注入);provide 可交换(KNOWLEDGE_SERVICE_ID 唯一 ID 注册表)。
 * DSH seam 用已发布 @deepseek-ai/dsh-tools 0.2.2-alpha.2 类型编译期钉住(tests/types.seam-pin.ts)。
 */
export { KnowledgeError, KnowledgeFormatError, KnowledgeNotFoundError, KnowledgeStateError, isRecord } from './errors.ts'
export { extractChangelog, extractSnippet, extractWikilinks, formatCitation, parseWikiPage, serializeWikiPage } from './frontmatter.ts'
export type { WikiFrontmatter, WikiPage } from './frontmatter.ts'
export { WikiIndexer } from './indexer.ts'
export type { IndexerOptions, PageRecord } from './indexer.ts'
export { hiddenReason, isVisibleInSearch } from './visibility.ts'
export { fuseByRRF, hitKey } from './rrf.ts'
export type { FuseOptions } from './rrf.ts'
export { WikiLocalBackend, createNodeFsAdapter, slugify } from './wiki.ts'
export type { ReviewOutcome, WikiFsAdapter, WikiLocalConfig } from './wiki.ts'
export { WeKnoraBackend, mapSearchResponse, weknoraCitation } from './weknora.ts'
export type { WeKnoraConfig, WeKnoraFetch, WeKnoraRequestInit, WeKnoraResponse } from './weknora.ts'
export { KNOWLEDGE_SERVICE_ID, createKnowledgeService } from './service.ts'
export type { KnowledgeService, KnowledgeServiceConfig, ServiceSearchResult } from './service.ts'
export { buildKnowledgeTools, toDshToolDefinition, toDshTools } from './tools.ts'
export type { KnowledgeToolSpec } from './tools.ts'
export type {
  BackendCapabilities, BackendHealth, BackendId, BackendStatusReport, ChangelogEntry, DocPatch, DocRef, DocStatus,
  GateDecision, GovernanceGate, KnowledgeBackend, KnowledgeDoc, KnowledgeHit, KnowledgeProposal, ProposalState,
  Provenance, ReviewState, SearchFilters, SearchMode, SearchQuery, SemanticSearchProvider, TrustLevel,
} from './types.ts'
