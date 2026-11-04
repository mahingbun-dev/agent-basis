import { isRecord } from "./errors.js";
import { formatCitation } from "./frontmatter.js";
const SEARCH_PATH = "/api/v1/knowledge-search";
class WeKnoraBackend {
  id = "weknora";
  capabilities = { write: false, deprecate: false, graph: false };
  lastError;
  config;
  constructor(config = {}) {
    this.config = config;
  }
  /** 是否已配置可用(enabled + baseUrl + 凭据三要素)。 */
  isConfigured() {
    return this.config.enabled === true && (this.config.baseUrl ?? "").length > 0 && (this.config.token !== void 0 || this.config.tokenRef !== void 0);
  }
  /** 凭据解析:token 直用;tokenRef 经 resolveCredential(缺省拒用:引用无解析器=未配置)。 */
  async resolveToken() {
    if (this.config.token !== void 0) return this.config.token;
    if (this.config.tokenRef !== void 0 && this.config.resolveCredential !== void 0) {
      return await this.config.resolveCredential(this.config.tokenRef);
    }
    return void 0;
  }
  async search(query) {
    if (!this.isConfigured()) return [];
    const token = await this.resolveToken();
    if (token === void 0) {
      this.lastError = "\u51ED\u636E\u4E0D\u53EF\u7528(tokenRef \u65E0\u89E3\u6790\u7ED3\u679C)";
      return [];
    }
    const topK = query.top_k ?? 8;
    const body = JSON.stringify({
      query: query.query,
      knowledge_base_ids: this.config.knowledgeBaseIds ?? [],
      match_count: topK,
      rerank: { enabled: true }
    });
    const url = `${this.config.baseUrl ?? ""}${SEARCH_PATH}`;
    const fetchImpl = this.config.fetchImpl ?? ((u, init) => globalThis.fetch(u, init));
    try {
      const response = await fetchImpl(url, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
        body,
        signal: AbortSignal.timeout(this.config.timeoutMs ?? 1e4)
      });
      if (!response.ok) {
        this.lastError = `HTTP ${response.status}`;
        return [];
      }
      const payload = await response.json();
      this.lastError = void 0;
      return mapSearchResponse(payload, topK);
    } catch (cause) {
      this.lastError = `\u8BF7\u6C42\u5931\u8D25:${String(cause)}`;
      return [];
    }
  }
  read(_ref) {
    return Promise.reject(new Error("weknora read \u672A\u5B9E\u73B0:ref \u7F3A\u5E93\u5F52\u5C5E,\u5F85\u5E73\u53F0\u6587\u6863\u8BE6\u60C5\u63A5\u53E3\u8054\u8C03(\u68C0\u7D22\u7ED3\u679C\u5DF2\u542B content,\u53EF\u5148\u7528 knowledge_search)"));
  }
  health() {
    if (!this.isConfigured()) return Promise.resolve({ ok: false, doc_count: 0, reason: "not-configured" });
    return Promise.resolve(this.lastError === void 0 ? { ok: true, doc_count: 0 } : { ok: false, doc_count: 0, reason: this.lastError });
  }
}
function mapSearchResponse(payload, topK) {
  if (!isRecord(payload) || payload.success !== true || !Array.isArray(payload.data)) return [];
  const hits = [];
  for (const [index, entry] of payload.data.entries()) {
    if (!isRecord(entry)) continue;
    const content = pickString(entry, "content", "text") ?? "";
    const docId = pickString(entry, "knowledge_id", "id", "document_id");
    if (docId === void 0) continue;
    const title = pickString(entry, "knowledge_title", "document_name", "title", "name", "knowledge_filename") ?? docId;
    const score = pickScore(entry, index);
    const locator = firstLocator(entry);
    const originParts = [pickString(entry, "knowledge_title", "document_name", "title"), locator?.quote, locator?.section];
    const origin = originParts.filter((p) => p !== void 0).join(" / ");
    hits.push({
      ref: { doc_id: docId, source_uri: `weknora://${docId}`, backend: "weknora" },
      title,
      snippet: content.length > 200 ? `${content.slice(0, 200)}\u2026` : content,
      score,
      provenance: {
        origin: origin.length > 0 ? origin : "WeKnora \u5E73\u53F0\u6587\u6863",
        status: "active",
        trust: "official",
        review: "reviewed"
      }
    });
    if (hits.length >= topK) break;
  }
  return hits;
}
function pickString(item, ...keys) {
  for (const key of keys) {
    const value = item[key];
    if (typeof value === "string" && value.length > 0) return value;
  }
  return void 0;
}
function pickScore(item, index) {
  const direct = item.similarity ?? item.score;
  if (typeof direct === "number" && Number.isFinite(direct)) return clamp01(direct);
  const meta = item.metadata;
  if (isRecord(meta)) {
    for (const key of ["base_score", "model_score"]) {
      const value = meta[key];
      if (typeof value === "number" && Number.isFinite(value)) return clamp01(value);
    }
  }
  return 1 / (index + 2);
}
function firstLocator(item) {
  const locators = item.source_locators;
  if (!Array.isArray(locators)) return void 0;
  for (const locator of locators) {
    if (!isRecord(locator)) continue;
    const out = {};
    if (typeof locator.quote === "string") out.quote = locator.quote;
    if (typeof locator.section === "string") out.section = locator.section;
    return out;
  }
  return void 0;
}
function clamp01(value) {
  return Math.min(1, Math.max(0, value));
}
function weknoraCitation(hit) {
  return formatCitation(hit);
}
export {
  WeKnoraBackend,
  mapSearchResponse,
  weknoraCitation
};
