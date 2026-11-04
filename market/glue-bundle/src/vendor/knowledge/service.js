import { isVisibleInSearch } from "./visibility.js";
import { fuseByRRF } from "./rrf.js";
import { KnowledgeError } from "./errors.js";
const KNOWLEDGE_SERVICE_ID = "@basis/knowledge";
const BACKEND_PRIORITY = ["weknora", "wiki-local"];
function backendPriority(id) {
  const index = BACKEND_PRIORITY.indexOf(id);
  return index >= 0 ? index : BACKEND_PRIORITY.length;
}
function createKnowledgeService(config = {}) {
  const registry = /* @__PURE__ */ new Map();
  const unregister = (id) => {
    const entry = registry.get(id);
    if (entry === void 0) return;
    registry.delete(id);
    entry.dispose();
  };
  const service = {
    id: KNOWLEDGE_SERVICE_ID,
    registerBackend(backend) {
      unregister(backend.id);
      const entry = { backend, dispose: () => backend.dispose?.() };
      registry.set(backend.id, entry);
      return () => {
        if (registry.get(backend.id) === entry) unregister(backend.id);
      };
    },
    listBackends() {
      return [...registry.values()].map((e) => e.backend).sort((a, b) => backendPriority(a.id) - backendPriority(b.id) || a.id.localeCompare(b.id));
    },
    async search(query) {
      const backends = service.listBackends();
      const lists = [];
      const contributed = [];
      const degraded = [];
      for (const backend of backends) {
        try {
          const hits2 = await backend.search(query);
          const visible = hits2.filter((h) => isVisibleInSearch(h.provenance, query.filters));
          if (visible.length > 0) {
            lists.push(visible);
            contributed.push(backend.id);
          }
        } catch (cause) {
          degraded.push({ backend: backend.id, reason: String(cause) });
        }
      }
      const hits = fuseByRRF(lists, { k: config.fusionK, topK: query.top_k ?? 8 });
      return { hits, contributed, degraded };
    },
    async read(ref) {
      const backend = registry.get(ref.backend)?.backend;
      if (backend === void 0) throw new KnowledgeError(`\u540E\u7AEF ${ref.backend} \u672A\u6CE8\u518C`);
      return await backend.read(ref);
    },
    async status() {
      const reports = [];
      for (const backend of service.listBackends()) {
        const health = await backend.health();
        reports.push({
          id: backend.id,
          ok: health.ok,
          reason: health.reason,
          doc_count: health.doc_count,
          last_sync: health.last_sync,
          capabilities: backend.capabilities,
          configured: true
        });
      }
      return reports;
    },
    async propose(patch) {
      for (const backend of service.listBackends()) {
        if (backend.capabilities.write && backend.propose !== void 0) {
          const proposalId = await backend.propose(patch);
          return { backend: backend.id, proposal_id: proposalId };
        }
      }
      throw new KnowledgeError("\u65E0\u53EF\u5199\u540E\u7AEF(\u9700\u6CE8\u518C wiki-local)");
    },
    dispose() {
      for (const id of [...registry.keys()]) unregister(id);
    }
  };
  for (const backend of config.backends ?? []) service.registerBackend(backend);
  return service;
}
export {
  KNOWLEDGE_SERVICE_ID,
  createKnowledgeService
};
