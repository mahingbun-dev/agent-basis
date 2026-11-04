/**
 * KnowledgeService 组合层(设计文档 11 §1:宿主面 Cordis service ctx.knowledge 的本体)。
 *
 * - 注册表 + 唯一 ID(provide 可交换):registerBackend 按后端 id 注册,同 id 重复注册先配逆旧的;
 *   返回的 disposer 即配逆闭包;
 * - 统一出口:search 把全部已启用后端的命中做出口级可见性复滤(纵深防御,不信任何单一后端的过滤)
 *   + RRF 融合(weknora 权威优先 → 其余按 id 序),top_k 截断;
 * - dual 模式即 wiki-local + weknora 同时注册的特例,无需专门开关;
 * - 失败语义:单后端 search 抛错不拖垮整体(fail-soft 记入 status),全部失败返回 []。
 */
import { isVisibleInSearch } from './visibility.ts'
import { fuseByRRF } from './rrf.ts'
import { KnowledgeError } from './errors.ts'
import type {
  BackendId, BackendStatusReport, DocPatch, DocRef, KnowledgeBackend, KnowledgeDoc, KnowledgeHit, SearchQuery,
} from './types.ts'

/** 组合层注册 ctx.knowledge 服务时的唯一 ID(注册表 + 唯一 ID 形态,provide 可交换)。 */
export const KNOWLEDGE_SERVICE_ID = '@basis/knowledge'

export interface ServiceSearchResult {
  readonly hits: readonly KnowledgeHit[]
  /** 实际参与融合的后端(按优先级序)。 */
  readonly contributed: readonly BackendId[]
  /** 检索中被跳过的后端及原因(fail-soft)。 */
  readonly degraded: readonly { backend: BackendId; reason: string }[]
}

export interface KnowledgeService {
  readonly id: typeof KNOWLEDGE_SERVICE_ID
  /** 注册后端(同 id 重复注册先配逆旧的);返回 disposer(配逆闭包)。 */
  registerBackend(backend: KnowledgeBackend): () => void
  listBackends(): readonly KnowledgeBackend[]
  search(query: SearchQuery): Promise<ServiceSearchResult>
  read(ref: DocRef): Promise<KnowledgeDoc>
  status(): Promise<readonly BackendStatusReport[]>
  /** 统一写入口:路由到首个可写后端(默认 wiki-local);只产生提案。 */
  propose(patch: DocPatch): Promise<{ backend: BackendId; proposal_id: string }>
  /** 配逆:注销全部后端(逐个调用注册 disposer)。 */
  dispose(): void
}

export interface KnowledgeServiceConfig {
  /** 初始后端集(也可之后 registerBackend 增删)。 */
  readonly backends?: readonly KnowledgeBackend[]
  /** RRF 平滑常数(缺省 60)。 */
  readonly fusionK?: number
}

/** 后端融合优先级:weknora(authoritative)优先,wiki 补充(设计文档 11 §1 dual 策略);其余按 id 稳定序。 */
const BACKEND_PRIORITY: readonly BackendId[] = ['weknora', 'wiki-local']

function backendPriority(id: BackendId): number {
  const index = BACKEND_PRIORITY.indexOf(id)
  return index >= 0 ? index : BACKEND_PRIORITY.length
}

export function createKnowledgeService(config: KnowledgeServiceConfig = {}): KnowledgeService {
  const registry = new Map<BackendId, { backend: KnowledgeBackend; dispose: () => void }>()

  /** 注销:移出注册表并配逆后端持有的资源(不回调注册 disposer,避免环)。 */
  const unregister = (id: BackendId): void => {
    const entry = registry.get(id)
    if (entry === undefined) return
    registry.delete(id)
    entry.dispose()
  }

  const service: KnowledgeService = {
    id: KNOWLEDGE_SERVICE_ID,

    registerBackend(backend) {
      unregister(backend.id) // provide 可交换:同 ID 重复注册先配逆旧的(幂等)
      const entry = { backend, dispose: () => backend.dispose?.() }
      registry.set(backend.id, entry)
      return (): void => {
        // 只有当前登记仍是本条时才注销(旧 disposer 不得误伤换上的新后端)
        if (registry.get(backend.id) === entry) unregister(backend.id)
      }
    },

    listBackends() {
      return [...registry.values()]
        .map(e => e.backend)
        .sort((a, b) => backendPriority(a.id) - backendPriority(b.id) || a.id.localeCompare(b.id))
    },

    async search(query) {
      const backends = service.listBackends()
      const lists: KnowledgeHit[][] = []
      const contributed: BackendId[] = []
      const degraded: { backend: BackendId; reason: string }[] = []
      for (const backend of backends) {
        try {
          const hits = await backend.search(query)
          // 出口级可见性复滤(纵深防御):不信任何单一后端自己的过滤
          const visible = hits.filter(h => isVisibleInSearch(h.provenance, query.filters))
          if (visible.length > 0) {
            lists.push(visible)
            contributed.push(backend.id)
          }
        } catch (cause) {
          degraded.push({ backend: backend.id, reason: String(cause) })
        }
      }
      const hits = fuseByRRF(lists, { k: config.fusionK, topK: query.top_k ?? 8 })
      return { hits, contributed, degraded }
    },

    async read(ref) {
      const backend = registry.get(ref.backend)?.backend
      if (backend === undefined) throw new KnowledgeError(`后端 ${ref.backend} 未注册`)
      return await backend.read(ref)
    },

    async status() {
      const reports: BackendStatusReport[] = []
      for (const backend of service.listBackends()) {
        const health = await backend.health()
        reports.push({
          id: backend.id,
          ok: health.ok,
          reason: health.reason,
          doc_count: health.doc_count,
          last_sync: health.last_sync,
          capabilities: backend.capabilities,
          configured: true,
        })
      }
      return reports
    },

    async propose(patch) {
      for (const backend of service.listBackends()) {
        if (backend.capabilities.write && backend.propose !== undefined) {
          const proposalId = await backend.propose(patch)
          return { backend: backend.id, proposal_id: proposalId }
        }
      }
      throw new KnowledgeError('无可写后端(需注册 wiki-local)')
    },

    dispose() {
      for (const id of [...registry.keys()]) unregister(id)
    },

  }

  for (const backend of config.backends ?? []) service.registerBackend(backend)
  return service
}
