/**
 * @eterna/memory —— L1 记忆插件(M1 项目记忆 + M2 实体记忆)。
 *
 * 模块地图:
 * 1. tokens.ts:token 保守估算(注入预算度量衡,CJK 1/字 + 其他 4 字符/token);
 * 2. pii.ts:PII 写入守卫注入接口(PiiGuard)+ 内置降级实现(BuiltinPiiGuard,
 *    governance 未就绪时兜底;governance PiiFilter 结构满足 PiiGuard 可直接注入);
 * 3. notes.ts:M1 项目记忆——workspace NOTES 文件读写+检索,路径安全,写入过 PII,
 *    write/append 返回 undo(effect 配逆);
 * 4. entity-store.ts:M2 实体记忆——node:sqlite 表(subject/key/content/valid_at/
 *    invalid_at/confidence + M-M1 T1 增列 kind/scope/domain_key/review_state/
 *    origin_session_id/origin_turn_ref/source/last_used_at/use_count),同键顶替+
 *    全历史,write 返回 undo,forget 物理真删;开库幂等迁移(缺列补列 + 存量
 *    subject 前缀四分支);review 软失效 / supersede Gm1 软失效 / touch 命中强化 /
 *    listForReview 评审队列;检索默认只取 approved 且非 legacy-org,
 *    scope/domain_key 过滤先于排序(M-M1 T2);
 * 5. domain.ts:域注册表(domain_registry)——workspace 显式域登记即注册,
 *    自由域候选 ≥3 独立会话命中转正(Q2 决议),touchUsed 使用计数;
 *    M-M3 T10 增:recordSessionHit 每会话持久命中去重(domain_hit_sessions)、
 *    冻结打标提示词 DOMAIN_TAGGING_PROMPT(fixture 逐字钉住)、防御解析
 *    parseDomainTagOutput、resolveDomain 编排(workspace 直注 → 打标先归并 →
 *    候选计数/转正绑定;打标 LLM 经 DomainTagger seam 注入,工厂在 extraction.ts);
 * 6. index-builder.ts:记忆索引(≤500 token,key+一句话摘要,装不下低优先截断);
 * 7. memory.ts:Memory 服务组合层(注册表+唯一 ID 形态,coeffect 全声明);
 *    writeEntity 写入口四操作决策(add/update/noop,重叠 0.6/0.9 阈值)与
 *    review_state 分级卡控统一判定(M-M1 T2);review/listForReview/touch/
 *    supersede 管理面;
 * 8. tools.ts:四个模型面工具(defineTool;memory_write 带 kind/explicit、
 *    provenance 运行时盖章与 episodic 会话域归属盖章(T10,host faces 注入),
 *    memory_search 带 scope/domain_key)+
 *    systemPrompt 索引 section(解析器形态带装配上下文,glue 按会话注入域区)+
 *    MemoryHost seam(dshHost 适配真实 ctx.tools/ctx.systemPrompt;sessionContext
 *    可选注入面)+ 装配上下文结构视图 assemblySessionIdOf +
 *    提示词注册表读取面(T2.6 登记制:promptRegistry 服务,缺席回落内置头);
 * 9. portrait.ts:用户画像 v0 派生视图(M-M1 T4)——user 层 approved semantic
 *    记录聚合为四分节 Markdown(frontmatter 记 version/generated_at/
 *    source_memory_ids),纯函数不落盘;生成入口 scripts/gen-portrait.mjs;
 * 10. consolidation.ts:整固 job 骨架(M-M2 T6)——会话尾触发(三门控:direct-write
 *     防双写 / no-user-prose≥3 词 / 凭据红线跳过)+ 单 running+latest-pending
 *     覆盖合并调度 + consolidation_cursor 会话粒度游标(success/no-op/skip 推进,
 *     error/abort 不推进)+ 快照冻结 + session close 先 abort 后 60s 有界 drain;
 *     提取执行体(T7)经 ConsolidationTask seam 注入,骨架默认任务恒
 *     nothing-to-save;盘面日志定位 findSessionLogPath(S1-D);
 * 11. extraction.ts:提取执行(M-M2 T7 + T8;M-C3 C10 压缩×记忆联动)——curator
 *     直调(ctx.llm.prepareCall 一次性 one-shot,冻结提示词与
 *     tests/fixtures/extraction-prompt.md 逐字一致)
 *     + 会话快照(多帧 zstd 日志解码 + user/assistant 文本抽取;checkpoint 节点
 *     以「二手摘要」标注进材料,仅作 episodic 线索)+ 现有记忆
 *     manifest(提案前查重面)+ 提案防御解析(Nothing 门/JSON 抢救/逐条校验)
 *     + 落库(统一走 writeEntity,source=consolidation/compaction,provenance
 *     盖章;含 checkpoint 的会话提案一律 source='compaction' 强制 pending——
 *     摘要来源投毒防线;T8 起入库前过 Gm1 一致性闸:重叠 [0.3,0.9) 一次 LLM
 *     矛盾判定,矛盾→supersede / 互补→合并 / 无关→照 ADD,判定失败
 *     fail-closed 拦截)
 *     + createExtractionTask 组装成 ConsolidationTask(glue 层注入调度器);
 * 12. audit.ts:记忆审计账本(M-M2 T9)——每次整固提案/门控/审批/重量 Dream
 *     周报各一行 JSONL(.eterna/memory-audit.jsonl,与 sqlite 同目录;写入
 *     fail-open 不反噬主流程);
 * 13. approval.ts:记忆审批卡片(M-M2 T9 + 勘察 S2 结论)——pending 产生时组
 *     interact ApprovalCardInput(标题「从本次会话学到…」/Why=出处会话摘要/
 *     Action=记住跳过),类型复用不投官方通道(送达=面板审批队列;官方
 *     user-questions 载荷经 memoryApprovalAskRequest 预留零转换切换面)+
 *     withReviewAudit(评审落定审计包装);
 * 14. dream.ts:重量 Dream 四阶段(M-M3 T11,19 号 §5-T11 + 19a 号 S4 结论 B)
 *     ——Orient 盘点 / Gather 窗口期 episodic 窄读(不全量,未挂载 evolve 信号)
 *     / Consolidate(域内晋升复用 @eterna/evolve clusterSignals 聚类 ≥2 + curator
 *     冻结提示词起草,稳定偏好走 user 层提案,Q3 全审 sampling 1.0,NOTES/AGENTS
 *     对账 CONFLICT-FLAG,相对日期转绝对,被证伪事实回收为 supersede 软失效)
 *     / Prune(episodic TTL 30 天淘汰 + perDomainLimit 半衰期降权挤出 + 画像
 *     再生成);触发=会话尾 + lastDreamAt 时间阈值合并(S4-B 退路,调度面在
 *     consolidation.ts 的 maybeEnqueueDream),周报落 audit dream 行;
 *
 * Cordis 纪律:effect 配逆(write.undo / forget 真删 / attachMemory 总 disposer);
 * coeffect 全声明(workspaceDir/dbPath/pii/now 构造注入,不碰全局);provide 可交换
 * (MEMORY_SERVICE_ID 唯一 ID;同 ID 重复注册先配逆旧的由宿主 effect 树负责)。
 *
 * seam 编译期钉住(防 DSH pre-stable 漂移)见 tests/types.seam-pin.ts。
 */
export { BuiltinPiiGuard, BUILTIN_PII_PATTERNS, isPiiBlockedError, PiiBlockedError } from './pii.ts'
export type { PiiFinding, PiiGuard } from './pii.ts'
export { NotesStore, tokenize } from './notes.ts'
export type { NoteHit, NoteSearchOptions, NoteWriteResult } from './notes.ts'
export { DomainRegistryStore, DEFAULT_MIN_SESSIONS_FOR_NEW_DOMAIN } from './domain.ts'
export {
  buildDomainTaggingUserText, DOMAIN_TAGGING_PROMPT, parseDomainTagOutput, resolveDomain,
  workspaceDomainKey, DomainTagParseError,
  DEFAULT_DOMAIN_TAG_MAX_TOKENS, DOMAIN_TAG_CANDIDATE_LIMIT, DOMAIN_TAG_MESSAGE_MAX_CHARS,
} from './domain.ts'
export type {
  DomainResolveOptions, DomainResolution, DomainResolutionInput, DomainResolutionSource,
  DomainTagParse, DomainTagger, DomainTaggerInput, DomainRecord, DomainRegistryStoreOptions, DomainSource,
} from './domain.ts'
export { EntityMemoryStore, coerceDomainKey } from './entity-store.ts'
export type {
  EntityKind, EntityRecord, EntityReviewDecision, EntityReviewState, EntitySearchHit, EntitySearchOptions,
  EntityScope, EntitySource, EntityWriteDecision, EntityWriteInput, EntityWriteResult,
} from './entity-store.ts'
export {
  buildEntityIndex, memoryRecallScore, stalenessSuffix, MEMORY_BEHAVIOR_HEADER,
  MEMORY_DOMAIN_INDEX_BUDGET_TOKENS, MEMORY_HALF_LIFE_DAYS,
  MEMORY_PORTRAIT_BUDGET_TOKENS, MEMORY_STALENESS_DAYS,
} from './index-builder.ts'
export type { MemoryIndexOptions, MemoryIndexResult } from './index-builder.ts'
export { buildPortrait, parsePortraitDocument, PORTRAIT_MAX_PER_SECTION } from './portrait.ts'
export type { PortraitDocument, PortraitOptions, PortraitSectionView } from './portrait.ts'
export {
  ConsolidationCursorStore, ConsolidationMetaStore, SessionEndConsolidator, SessionGateFactsRegistry,
  SKELETON_CONSOLIDATION_TASK, countUserProseWords, dreamIntervalMs, dreamSnapshot,
  evaluateSessionGates, findSessionLogPath, resolveDshSessionsRoot, userMessageTextOf,
  DEFAULT_DRAIN_TIMEOUT_MS, DEFAULT_DREAM_INTERVAL_HOURS, DREAM_CURSOR_SESSION_ID, MIN_USER_PROSE_WORDS,
} from './consolidation.ts'
export type {
  ConsolidationJobKind, ConsolidationLogger, ConsolidationSkipReason, ConsolidationSnapshot,
  ConsolidationTask, ConsolidationTaskResult, ConsolidationTriggerOutcome,
  SessionEndConsolidatorOptions, SessionEndRef, SessionEventLike, SessionGateFacts,
} from './consolidation.ts'
export {
  CHECKPOINT_TRANSCRIPT_PREFIX, CONTRADICTION_JUDGE_PROMPT, EXTRACTION_PROMPT, NOTHING_TO_SAVE_MARKER,
  DEFAULT_CURATOR_MODEL, DEFAULT_EXTRACTION_MAX_TOKENS, DEFAULT_JUDGMENT_MAX_TOKENS,
  FALLBACK_CURATOR_PROVIDER,
  EXTRACTION_RECENT_MESSAGES, EXTRACTION_MAX_TRANSCRIPT_CHARS, EXTRACTION_MANIFEST_MAX_ROWS,
  MAX_SESSION_LOG_BYTES, ExtractionParseError,
  applyExtractionProposals, buildExtractionUserText, buildJudgmentUserText, buildMemoryManifest,
  buildSessionTranscript, createDomainTagger, createExtractionTask, createGm1Judge, decodeZstdLog,
  isCompactionCheckpointSource, parseExtractionOutput, parseGm1Verdict, resolveCuratorRoute,
  runCuratorOneShot, runExtractionCall, sessionLogHasCheckpoint,
} from './extraction.ts'
export type {
  DomainTaggerOptions, ExtractionCallOptions, ExtractionCallResult, ExtractionParseResult,
  ExtractionProposalOp, ExtractionProposalScope, ExtractionRoute, ExtractionSource, ExtractionTaskOptions,
  Gm1Gate, Gm1Judge, Gm1JudgeOptions, Gm1Verdict,
  MemoryExtractionProposal, ProposalApplyReport, ProposalProvenance, SessionTranscriptOptions,
} from './extraction.ts'
export {
  MemoryAuditLedger, MEMORY_AUDIT_FILENAME, defaultMemoryAuditPath,
} from './audit.ts'
export type {
  CorrectionAuditEntry, DomainResolveAuditEntry,
  DreamAuditEntry, GateAuditEntry, MemoryAuditCard, MemoryAuditEvent, MemoryAuditLedgerOptions,
  MemoryAuditPendingItem, ProposalAuditEntry, ReviewAuditEntry,
} from './audit.ts'
export { MemoryAccountRouter, MemoryAccountDeniedError, createDeniedMemory, isMemoryAccountDeniedError } from './account-router.ts'
export type { MemorySessionResolver } from './account-router.ts'
export { buildMemoryAccountView } from './account-view.ts'
export type { MemoryAccountView } from './account-view.ts'
export {
  buildMemoryMetrics, computeIndexZoneTokens, readMemoryAuditEvents,
} from './metrics.ts'
export type {
  MemoryCorrectionMetrics, MemoryDomainResolveMetrics, MemoryIndexZoneTokens, MemoryMetricsExtras,
  MemoryMetricsReport, MemoryReviewLatencyMetrics, MemoryReviewMetrics,
} from './metrics.ts'
export {
  DREAM_CONFLICT_PROMPT, DREAM_CONSOLIDATION_PROMPT, DreamParseError,
  absolutizeRelativeDates, applyConflictFlags, applyDreamConsolidation,
  buildDreamConflictUserText, buildDreamConsolidationUserText, clusterEpisodicRows,
  collectConflictMaterials, createDreamTask, gatherEpisodicWindow, maybeRegeneratePortrait,
  orientMemory, parseDreamConflictOutput, parseDreamConsolidationOutput, pruneMemory,
  sampleForReview,
  CONFLICT_FLAG_PREFIX, DEFAULT_DREAM_CONSOLIDATION_MAX_TOKENS, DEFAULT_DREAM_CONFLICT_MAX_TOKENS,
  DEFAULT_DREAM_MAX_TURNS, DEFAULT_EPISODIC_PER_DOMAIN_LIMIT, DEFAULT_EPISODIC_TTL_DAYS,
  DEFAULT_USER_PROMOTION_SAMPLE_RATE, DREAM_MIN_CLUSTER_COUNT,
  PORTRAIT_META_GENERATED_AT, PORTRAIT_META_USER_COUNT, PORTRAIT_REGEN_INTERVAL_HOURS,
} from './dream.ts'
export type {
  DreamApplyOptions, DreamApplyReport, DreamClusterView, DreamConflictApplyOptions,
  DreamConflictItem, DreamConflictMaterial, DreamConflictOutput, DreamConflictReport,
  DreamConsolidationOutput, DreamGatherOptions, DreamGatherReport, DreamOrientOptions,
  DreamOrientReport, DreamPreferenceProposal, DreamPromotionProposal, DreamPruneOptions,
  DreamPruneReport, DreamRetractionProposal, DreamTaskOptions, PortraitRegenOptions,
  PortraitRegenReport,
} from './dream.ts'
export {
  buildMemoryApprovalCard, buildSessionDigest, memoryApprovalAskRequest,
  truncateDigest, withReviewAudit,
  MEMORY_APPROVE_LABEL, MEMORY_CARD_DIGEST_MAX_CHARS, MEMORY_DIGEST_ABSENT,
  MEMORY_DIGEST_PII_FALLBACK, MEMORY_REJECT_LABEL, MEMORY_REVIEW_CARD_TITLE,
  MEMORY_REVIEW_GRADE, MEMORY_REVIEW_RULE_ID,
} from './approval.ts'
export type { MemoryApprovalCardSpec, MemoryPendingItemView } from './approval.ts'
export {
  DEFAULT_MEMORY_WRITE_POLICY, MEMORY_OVERRIDES_FILENAME, MEMORY_WRITE_POLICIES,
  memoryOverridesDir, memoryOverridesDirForDb, memoryOverridesPath, memoryOverridesPathForDb,
  parseMemoryOverrides, parsedOverridesOf, readMemoryOverridesFile, resolveEffectiveFlags,
} from './config-bridge.ts'
export type { MemoryEffectiveFlags, MemoryOverrides, MemoryWritePolicy } from './config-bridge.ts'
export {
  EternaMemoryGateway, listDomainViews, memoryStatsOf,
  ETERNA_MEMORY_SERVICE_ID, ETERNA_MEMORY_SESSION_SERVICE_ID,
  MEMORY_DOMAINS_ENDPOINT, MEMORY_SELECT_DOMAIN_ENDPOINT, MEMORY_SESSION_DOMAIN_ENDPOINT,
  MEMORY_STATE_ENDPOINT, MEMORY_UPDATE_ENDPOINT,
} from './admin-plugin.ts'
export type {
  MemoryDomainView, MemoryGatewayDeps, MemoryDomainsView, MemorySelectDomainView,
  MemorySessionDomainFace, MemorySessionDomainView, MemoryStateError, MemoryStateView,
} from './admin-plugin.ts'
export { MEMORY_INDEX_BUDGET_TOKENS, estimateTokens } from './tokens.ts'
export {
  createMemory, dedupTokens, mergeMemoryContents, MEMORY_SERVICE_ID,
  MEMORY_CONTENT_MAX_CHARS, MEMORY_DEDUP_MERGE_OVERLAP, MEMORY_DEDUP_NOOP_OVERLAP,
  MEMORY_GM1_JUDGE_MIN_OVERLAP, MEMORY_PER_DOMAIN_LIVE_LIMIT,
  resolveWriteReviewState, tokenOverlapRatio,
} from './memory.ts'
export type { Memory, MemoryOptions, MemorySearchHit, MemorySearchOptions } from './memory.ts'
export {
  assemblySessionIdOf, attachMemory, createMemoryIndexSection, defineMemoryTools, dshHost,
  memorySourcesMetaOf, MEMORY_INDEX_SECTION_NAME, MEMORY_INDEX_SECTION_ORDER,
  MEMORY_SOURCES_TOOL_NAMES, MEMORY_SECTION_REGISTRY_ENTRY_ID,
  MEMORY_SEARCH_PREFIX_REGISTRY_ENTRY_ID, MEMORY_SEARCH_RESULT_PREFIX, MEMORY_TOOL_NAMES,
  PROMPT_REGISTRY_SERVICE_ID, resolvePromptRegistry,
} from './tools.ts'
export type {
  AttachMemoryOptions, MemoryAssemblyContext, MemoryHost, MemorySessionContext,
  MemorySourceEntry, MemorySourcesMeta,
  PromptRegistryFace, PromptRegistryHost,
} from './tools.ts'

/**
 * 包根 = 宿主载具行(M-M3 T12 前端四件配套,2026-11-15 修复 boot failed to import)。
 *
 * eterna-web 宿主层的 `eterna-memory-client` 行(name=`@eterna/memory`,两段名)把本包
 * 根当作宿主 Loader 条目加载——client-modules 收集器只认两段名(照 @eterna/compaction
 * 包根先例),而本包根此前只有具名 re-export、无 default 导出,宿主 boot 报
 * "failed to import"。本载具宿主侧零职责(idle 插件,同 usage-stats/compaction
 * 宿主行配方);设置分区数据面是 ./admin-plugin,引擎面是 glue 的 eterna-memory 行。
 */
export const name = 'eterna-memory-client'

export default {
  name,
  apply(): () => void {
    return () => {}
  },
}
