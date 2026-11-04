import { formatCitation } from "./frontmatter.js";
import { isRecord } from "./errors.js";
const STRING = { type: "string" };
function buildKnowledgeTools(service) {
  const search = {
    name: "knowledge_search",
    description: "\u68C0\u7D22\u4F01\u4E1A\u77E5\u8BC6\u5E93(\u9ED8\u8BA4\u672C\u5730 wiki,\u53EF\u9009 WeKnora),\u8FD4\u56DE\u5E26\u5B8C\u6574\u6EAF\u6E90(provenance)\u7684\u547D\u4E2D\u5217\u8868\u3002\u5DF2\u5E9F\u5F03/\u88AB\u53D6\u4EE3/\u672A\u8FC7\u5BA1\u7684\u5185\u5BB9\u5728\u51FA\u53E3\u5904\u88AB\u7EDF\u4E00\u8FC7\u6EE4,\u4E0D\u4F1A\u51FA\u73B0\u3002\u5F15\u7528\u77E5\u8BC6\u65F6\u8BF7\u4F7F\u7528\u8FD4\u56DE\u7684 citation \u5B57\u6BB5(\u81EA\u5E26\u66F4\u65B0\u65F6\u95F4\u4E0E\u72B6\u6001\u8B66\u793A)\u3002",
    parameters: {
      type: "object",
      properties: {
        query: { type: "string", description: "\u68C0\u7D22\u8BCD(\u4E2D\u6587\u6216\u82F1\u6587)" },
        top_k: { type: "integer", minimum: 1, maximum: 50, description: "\u8FD4\u56DE\u6761\u6570,\u9ED8\u8BA4 8" },
        mode: { type: "string", enum: ["hybrid", "keyword", "semantic"], description: "\u68C0\u7D22\u6A21\u5F0F,\u9ED8\u8BA4 hybrid" }
      },
      required: ["query"]
    },
    outputSchema: SEARCH_OUTPUT,
    async execute(args) {
      const query = requireString(args, "query");
      const topK = optionalInt(args, "top_k");
      const mode = optionalMode(args);
      const result = await service.search({
        query,
        ...topK !== void 0 ? { top_k: topK } : {},
        ...mode !== void 0 ? { mode } : {}
      });
      return {
        ok: true,
        query,
        contributed: result.contributed,
        degraded: result.degraded,
        count: result.hits.length,
        hits: result.hits.map(toModelHit)
      };
    }
  };
  const read = {
    name: "knowledge_read",
    description: "\u6309 ref \u8BFB\u53D6\u4E00\u7BC7\u77E5\u8BC6\u6587\u6863\u5168\u6587(\u542B changelog \u6BB5\u4E0E\u5B8C\u6574\u6EAF\u6E90)\u3002\u53EF\u8BFB\u5F52\u6863\u9875(\u663E\u5F0F\u5F15\u7528\u573A\u666F),citation \u4F1A\u81EA\u5E26\u5E9F\u5F03/\u53D6\u4EE3\u8B66\u793A\u3002",
    parameters: {
      type: "object",
      properties: {
        doc_id: { type: "string", description: "\u6587\u6863 ID(KnowledgeHit.ref.doc_id)" },
        backend: { type: "string", description: "\u540E\u7AEF ID(wiki-local/weknora),\u9ED8\u8BA4 wiki-local" }
      },
      required: ["doc_id"]
    },
    outputSchema: READ_OUTPUT,
    async execute(args) {
      const docId = requireString(args, "doc_id");
      const backend = optionalString(args, "backend") ?? "wiki-local";
      const doc = await service.read({ doc_id: docId, source_uri: "", backend });
      return {
        ok: true,
        doc: {
          ref: doc.ref,
          title: doc.title,
          tags: doc.tags,
          body: doc.body,
          wikilinks: doc.wikilinks,
          changelog: doc.changelog,
          provenance: doc.provenance,
          citation: doc.citation
        }
      };
    }
  };
  const status = {
    name: "knowledge_status",
    description: "\u67E5\u770B\u77E5\u8BC6\u540E\u7AEF\u72B6\u6001(\u542F\u7528\u60C5\u51B5\u3001\u6587\u6863\u6570\u3001\u80FD\u529B)\u3002WeKnora \u672A\u542F\u7528\u65F6\u663E\u793A not-configured\u3002",
    parameters: { type: "object", properties: {} },
    outputSchema: STATUS_OUTPUT,
    async execute() {
      const reports = await service.status();
      return {
        ok: true,
        backends: reports.map((r) => ({
          id: r.id,
          ok: r.ok,
          // DSH 工具输出须 lossless JSON:undefined 值属性会被 snapshotJsonValue 判非 JSON
          // ("value is not lossless JSON");健康时 reason 缺席,条件展开而非赋 undefined。
          ...r.reason !== void 0 ? { reason: r.reason } : {},
          doc_count: r.doc_count,
          capabilities: r.capabilities
        }))
      };
    }
  };
  const propose = {
    name: "knowledge_propose",
    description: "\u77E5\u8BC6\u5199\u5165\u7684\u552F\u4E00\u5165\u53E3:\u63D0\u4EA4\u4E00\u7BC7\u65B0\u9875/\u4FEE\u6539\u63D0\u6848(\u53EA\u4EA7\u751F\u63D0\u6848,\u4E0D\u76F4\u63A5\u751F\u6548)\u3002\u63D0\u6848\u9700\u7ECF governance \u95E8\u7981\u8BC4\u5BA1\u901A\u8FC7\u540E\u624D\u4F1A\u53D1\u5E03\u4E3A\u53EF\u68C0\u7D22\u9875\u9762;\u672A\u8FC7\u5BA1\u5185\u5BB9\u4E0D\u4F1A\u8FDB\u5165\u68C0\u7D22\u7ED3\u679C\u3002\u8BF7\u5728 body \u4E2D\u7ED9\u51FA\u5B8C\u6574\u6B63\u6587\u5E76\u6CE8\u660E\u6765\u6E90(origin)\u3002",
    parameters: {
      type: "object",
      properties: {
        title: { type: "string", description: "\u9875\u9762\u6807\u9898" },
        body: { type: "string", description: "markdown \u6B63\u6587(\u5B8C\u6574\u5185\u5BB9)" },
        tags: { type: "array", items: { type: "string" }, description: "\u6807\u7B7E" },
        origin: { type: "string", description: "\u6743\u5A01\u6765\u6E90(\u539F\u6587\u51FA\u5904/URL),\u7F3A\u7701\u6807\u6CE8 agent \u64B0\u5199" },
        path: { type: "string", description: "\u843D\u76D8\u76F8\u5BF9\u8DEF\u5F84(\u7F3A\u7701 agent-drafts/<doc_id>.md)" }
      },
      required: ["title", "body"]
    },
    outputSchema: PROPOSE_OUTPUT,
    async execute(args) {
      const title = requireString(args, "title");
      const body = requireString(args, "body");
      const tags = optionalStringArray(args, "tags");
      const origin = optionalString(args, "origin");
      const path = optionalString(args, "path");
      const routed = await service.propose({
        title,
        body,
        ...tags !== void 0 ? { tags } : {},
        ...origin !== void 0 ? { origin } : {},
        ...path !== void 0 ? { path } : {}
      });
      return {
        ok: true,
        proposal_id: routed.proposal_id,
        backend: routed.backend,
        state: "pending",
        note: "\u63D0\u6848\u5DF2\u8BB0\u5F55,\u7B49\u5F85 governance \u95E8\u7981\u8BC4\u5BA1;\u672A\u8FC7\u5BA1\u5185\u5BB9\u4E0D\u4F1A\u51FA\u73B0\u5728\u68C0\u7D22\u7ED3\u679C\u4E2D"
      };
    }
  };
  return { search, read, status, propose };
}
const HIT_SCHEMA = {
  type: "object",
  properties: {
    ref: {
      type: "object",
      properties: {
        doc_id: STRING,
        source_uri: STRING,
        backend: STRING
      },
      required: ["doc_id", "source_uri", "backend"]
    },
    title: STRING,
    snippet: STRING,
    score: { type: "number" },
    provenance: { type: "object" },
    citation: STRING
  },
  required: ["ref", "title", "snippet", "score", "provenance", "citation"]
};
const SEARCH_OUTPUT = {
  type: "object",
  properties: {
    ok: { type: "boolean", const: true },
    query: STRING,
    contributed: { type: "array", items: STRING },
    count: { type: "integer" },
    hits: { type: "array", items: HIT_SCHEMA }
  },
  required: ["ok", "query", "contributed", "count", "hits"]
};
const READ_OUTPUT = {
  type: "object",
  properties: {
    ok: { type: "boolean", const: true },
    doc: {
      type: "object",
      properties: {
        ref: { type: "object" },
        title: STRING,
        body: STRING,
        citation: STRING,
        changelog: { type: "array" },
        provenance: { type: "object" }
      },
      required: ["ref", "title", "body", "citation", "changelog", "provenance"]
    }
  },
  required: ["ok", "doc"]
};
const STATUS_OUTPUT = {
  type: "object",
  properties: {
    ok: { type: "boolean", const: true },
    backends: {
      type: "array",
      items: {
        type: "object",
        properties: {
          id: STRING,
          ok: { type: "boolean" },
          doc_count: { type: "integer" }
        },
        required: ["id", "ok", "doc_count"]
      }
    }
  },
  required: ["ok", "backends"]
};
const PROPOSE_OUTPUT = {
  type: "object",
  properties: {
    ok: { type: "boolean", const: true },
    proposal_id: STRING,
    backend: STRING,
    state: { type: "string", enum: ["pending"] },
    note: STRING
  },
  required: ["ok", "proposal_id", "backend", "state", "note"]
};
class ToolArgError extends Error {
  constructor(message) {
    super(message);
    this.name = "ToolArgError";
  }
}
function bad(message) {
  throw new ToolArgError(message);
}
function requireString(args, key) {
  if (!isRecord(args)) bad("\u53C2\u6570\u5FC5\u987B\u662F\u5BF9\u8C61");
  const value = args[key];
  if (typeof value !== "string" || value.trim().length === 0) bad(`\u53C2\u6570 ${key} \u5FC5\u987B\u662F\u975E\u7A7A\u5B57\u7B26\u4E32`);
  return value;
}
function optionalString(args, key) {
  if (!isRecord(args)) bad("\u53C2\u6570\u5FC5\u987B\u662F\u5BF9\u8C61");
  const value = args[key];
  if (value === void 0) return void 0;
  if (typeof value !== "string") bad(`\u53C2\u6570 ${key} \u5FC5\u987B\u662F\u5B57\u7B26\u4E32`);
  return value;
}
function optionalInt(args, key) {
  if (!isRecord(args)) bad("\u53C2\u6570\u5FC5\u987B\u662F\u5BF9\u8C61");
  const value = args[key];
  if (value === void 0) return void 0;
  if (typeof value !== "number" || !Number.isInteger(value)) bad(`\u53C2\u6570 ${key} \u5FC5\u987B\u662F\u6574\u6570`);
  return value;
}
function optionalMode(args) {
  const raw = optionalString(args, "mode");
  if (raw === void 0) return void 0;
  if (raw !== "hybrid" && raw !== "keyword" && raw !== "semantic") bad("\u53C2\u6570 mode \u5FC5\u987B\u662F hybrid|keyword|semantic");
  return raw;
}
function optionalStringArray(args, key) {
  if (!isRecord(args)) bad("\u53C2\u6570\u5FC5\u987B\u662F\u5BF9\u8C61");
  const value = args[key];
  if (value === void 0) return void 0;
  if (!Array.isArray(value) || value.some((v) => typeof v !== "string")) bad(`\u53C2\u6570 ${key} \u5FC5\u987B\u662F\u5B57\u7B26\u4E32\u6570\u7EC4`);
  return value;
}
function toModelHit(hit) {
  return {
    ref: hit.ref,
    title: hit.title,
    snippet: hit.snippet,
    score: round3(hit.score),
    provenance: hit.provenance,
    citation: formatCitation(hit)
  };
}
function round3(n) {
  return Math.round(n * 1e3) / 1e3;
}
function toDshToolDefinition(spec) {
  return {
    name: spec.name,
    description: spec.description,
    parameters: spec.parameters,
    output: {
      schema: spec.outputSchema,
      render: (_args, value) => [{ type: "text", text: JSON.stringify(value, null, 2) }]
    },
    execute: async (args, exec) => {
      if (exec.signal.aborted) throw new Error(`${spec.name}: \u8C03\u7528\u5DF2\u88AB\u53D6\u6D88(signal aborted)`);
      return await spec.execute(args);
    }
  };
}
function toDshTools(service) {
  const tools = buildKnowledgeTools(service);
  return [tools.search, tools.read, tools.status, tools.propose].map(toDshToolDefinition);
}
export {
  buildKnowledgeTools,
  toDshToolDefinition,
  toDshTools,
  toModelHit
};
