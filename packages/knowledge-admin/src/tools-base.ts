/**
 * Agent 工具面共享适配:`KnowledgeAdminService` → 库层 `KnowledgeService` 薄门面。
 *
 * ## 为什么需要这一层
 * 融合后只有一个 `KnowledgeAdminService` + 一个 `BackendPool`(按绝对路径 keyed)。
 * 库层的四工具(search/read/status/propose)是在 `KnowledgeService` 接口上构建的
 * (`buildKnowledgeTools`),故这里把管理面按调用者投影成该接口的一个**只读薄壳**:
 * - 不注册后端、不持有连接、`dispose()` no-op —— 绝不 dispose 共享池;
 * - `propose` 恒走 `saveDoc(publish:false)`(Agent 写入一律 pending,门禁在服务面);
 * - `read`/`search`/`status` 复用服务面同一 `#sanitize`(admin 缺省全局 `*`,
 *   普通账号缺省本人)。
 *
 * 工具描述/输出 schema/citation 全部复用库层实现,避免两套契约漂移。
 */
import {
  KnowledgeError, createDeniedService, toDshTools,
} from '@eterna/knowledge'
import type {
  BackendStatusReport, DocPatch, DocRef, KnowledgeBackend, KnowledgeDoc, KnowledgeHit, KnowledgeService,
  KnowledgeSessionResolver, SearchQuery, ServiceSearchResult,
} from '@eterna/knowledge'
import type { ToolDefinition } from '@deepseek-ai/dsh-tools'
import type { KnowledgeAdminService } from './service.ts'
import type { KnowledgeCallerRouter } from './routing.ts'
import type { KnowledgeAdminCaller, KnowledgeAdminDoc, KnowledgeAdminHit } from './types.ts'

/** 管理面命中 → 库层命中(字段同值;`source` 是管理面附加标注,库层无此字段)。 */
function toKnowledgeHit(hit: KnowledgeAdminHit): KnowledgeHit {
  return {
    ref: { doc_id: hit.ref.doc_id, source_uri: hit.ref.source_uri, backend: hit.ref.backend },
    title: hit.title,
    snippet: hit.snippet,
    score: hit.score,
    provenance: hit.provenance,
  }
}

/** 管理面文档 → 库层文档(changelog 条目同形)。 */
function toKnowledgeDoc(doc: KnowledgeAdminDoc): KnowledgeDoc {
  return {
    ref: { doc_id: doc.ref.doc_id, source_uri: doc.ref.source_uri, backend: doc.ref.backend },
    title: doc.title,
    tags: doc.tags,
    body: doc.body,
    wikilinks: doc.wikilinks,
    changelog: doc.changelog.map(entry => ({ date: entry.date, note: entry.note })),
    provenance: doc.provenance,
    citation: doc.citation,
  }
}

/** 失败封套 → 抛错(库层工具执行器按工具失败呈现,模型可见 code/message)。 */
function unwrap<T>(
  result: { readonly ok: true; readonly value: T } | { readonly ok: false; readonly code: string; readonly message: string },
): T {
  if (result.ok) return result.value
  throw new KnowledgeError(`${result.code}: ${result.message}`)
}

/**
 * 按调用者投影一个只读 `KnowledgeService`(每次工具调用新建;无共享可变状态)。
 * `propose` 的默认 origin 标 agent 撰写(服务面 `saveDoc` 的人写缺省不适用 Agent 通道)。
 */
export function createAdminKnowledgeFacade(service: KnowledgeAdminService, caller: KnowledgeAdminCaller): KnowledgeService {
  return {
    id: '@eterna/knowledge',

    registerBackend: (_backend: KnowledgeBackend): (() => void) => () => {},

    listBackends: (): readonly KnowledgeBackend[] => [],

    async search(query: SearchQuery): Promise<ServiceSearchResult> {
      const value = unwrap(await service.search(caller, {
        query: query.query,
        ...(query.top_k === undefined ? {} : { top_k: query.top_k }),
        ...(query.mode === undefined ? {} : { mode: query.mode }),
      }))
      return {
        hits: value.hits.map(toKnowledgeHit),
        contributed: value.contributed,
        degraded: value.degraded.map(item => ({ backend: item.source, reason: item.reason })),
      }
    },

    async read(ref: DocRef): Promise<KnowledgeDoc> {
      const value = unwrap(await service.readDoc(caller, { doc_id: ref.doc_id }))
      return toKnowledgeDoc(value)
    },

    async status(): Promise<readonly BackendStatusReport[]> {
      const value = unwrap(await service.statusBackends(caller, {}))
      return value.backends.map(report => ({
        id: report.id,
        ok: report.ok,
        ...(report.reason === undefined ? {} : { reason: report.reason }),
        doc_count: report.doc_count,
        ...(report.last_sync === undefined ? {} : { last_sync: report.last_sync }),
        capabilities: report.capabilities,
        configured: report.configured,
      }))
    },

    async propose(patch: DocPatch): Promise<{ backend: string; proposal_id: string }> {
      const value = unwrap(await service.saveDoc(caller, {
        title: patch.title,
        body: patch.body,
        ...(patch.tags === undefined ? {} : { tags: patch.tags }),
        origin: patch.origin ?? 'agent 撰写(经 knowledge_propose 提案)',
        ...(patch.path === undefined ? {} : { path: patch.path }),
        ...(patch.doc_id === undefined ? {} : { doc_id: patch.doc_id }),
        ...(patch.changelog_note === undefined ? {} : { changelog_note: patch.changelog_note }),
        publish: false,
      }))
      return { backend: 'wiki-local', proposal_id: value.proposal_id }
    },

    // 共享池的生命周期归 service/plugin;门面绝不 dispose。
    dispose: (): void => {},
  }
}

/**
 * 构建库层四工具(resolver 按会话把调用者投影成门面;解析失败 = 库层 Denied service,
 * fail-closed 语义与 glue 完全一致)。返回未注册的 ToolDefinition 列表。
 */
export function buildAdminKnowledgeTools(service: KnowledgeAdminService, router: KnowledgeCallerRouter): readonly ToolDefinition[] {
  const resolver: KnowledgeSessionResolver = {
    forSession: (sessionId: string | undefined): KnowledgeService | undefined => {
      const caller = router.resolveSession(sessionId)
      return caller === undefined ? undefined : createAdminKnowledgeFacade(service, caller)
    },
  }
  // base 仅在 resolver 缺席时使用;这里 resolver 恒在场,base 用 Denied 兜底(绝不泄露全局库)。
  return toDshTools(createDeniedService(), resolver)
}
