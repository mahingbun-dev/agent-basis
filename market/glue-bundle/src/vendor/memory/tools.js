import { defineTool } from "@deepseek-ai/dsh-tools";
import { isPiiBlockedError } from "./pii.js";
const MEMORY_TOOL_NAMES = ["memory_write", "memory_read", "memory_search", "memory_forget"];
const MEMORY_INDEX_SECTION_NAME = "memory:index";
const MEMORY_INDEX_SECTION_ORDER = 9e3;
function dshHost(ctx) {
  return {
    registerTool: (definition) => ctx.tools.register(definition),
    registerPromptSection: (section) => ctx.systemPrompt.section(section)
  };
}
function defineMemoryTools(memory) {
  return [
    defineTool({
      name: "memory_write",
      description: "\u5199\u5165\u4E00\u6761\u957F\u671F\u5B9E\u4F53\u8BB0\u5FC6(M2,sqlite \u6301\u4E45,\u8DE8\u4F1A\u8BDD)\u3002\u540C (subject,key) \u91CD\u590D\u5199\u5165\u4F1A\u9876\u66FF\u65E7\u503C(\u5386\u53F2\u4FDD\u7559\u53EF\u5BA1\u8BA1)\u3002\u5199\u5165\u524D\u5F3A\u5236 PII \u8FC7\u6EE4:\u542B\u624B\u673A\u53F7/\u8EAB\u4EFD\u8BC1/\u90AE\u7BB1/IP \u7B49\u654F\u611F\u4FE1\u606F\u4F1A\u88AB\u62D2\u7EDD\u3002",
      parameters: {
        subject: { type: "string", required: true, description: "\u4E3B\u4F53,\u7EA6\u5B9A\u524D\u7F00 user:<\u540D> / org:<\u540D> / project:<\u540D>" },
        key: { type: "string", required: true, description: "\u8BB0\u5FC6\u952E,\u540C subject \u5185\u552F\u4E00,\u4E0D\u542B\u7A7A\u767D,\u5982 prefers-email-summary" },
        content: { type: "string", required: true, description: "\u8BB0\u5FC6\u6B63\u6587(\u957F\u671F\u4FDD\u5B58,\u52FF\u5199\u5165\u4E2A\u4EBA\u654F\u611F\u4FE1\u606F)" },
        summary: { type: "string", description: "\u4E00\u53E5\u8BDD\u6458\u8981(\u8FDB systemPrompt \u8BB0\u5FC6\u7D22\u5F15;\u7F3A\u7701\u4ECE\u6B63\u6587\u6D3E\u751F)" },
        confidence: { type: "number", description: "\u7F6E\u4FE1\u5EA6 0-1,\u9ED8\u8BA4 0.8" }
      },
      output: {
        schema: { type: "object", additionalProperties: true },
        render: (_args, value) => [{ type: "text", text: JSON.stringify(value, null, 2) }]
      },
      execute: (args, _exec) => {
        try {
          const { record } = memory.writeEntity({
            subject: args.subject,
            key: args.key,
            content: args.content,
            ...args.summary !== void 0 && { summary: args.summary },
            ...args.confidence !== void 0 && { confidence: args.confidence }
          });
          return Promise.resolve({
            ok: true,
            subject: record.subject,
            key: record.key,
            id: record.id,
            confidence: record.confidence,
            validAt: record.validAt,
            hint: "\u64A4\u9500\u7528 memory_forget(subject, key):\u5E94\u7528\u9006\u95ED\u5305\u771F\u5220"
          });
        } catch (error) {
          return Promise.resolve(failureOf(error));
        }
      }
    }),
    defineTool({
      name: "memory_read",
      description: "\u8BFB\u53D6\u4E00\u6761\u957F\u671F\u8BB0\u5FC6\u7684\u5F53\u524D\u6B63\u6587(systemPrompt \u53EA\u6CE8\u5165\u7D22\u5F15,\u6B63\u6587\u6309\u9700\u8BFB\u672C\u5DE5\u5177)\u3002",
      parameters: {
        subject: { type: "string", required: true, description: "\u4E3B\u4F53(\u4E0E\u5199\u5165\u65F6\u4E00\u81F4)" },
        key: { type: "string", required: true, description: "\u8BB0\u5FC6\u952E" }
      },
      output: {
        schema: { type: "object", additionalProperties: true },
        render: (_args, value) => [{ type: "text", text: JSON.stringify(value, null, 2) }]
      },
      isConcurrencySafe: () => true,
      execute: (args, _exec) => {
        const record = memory.readEntity(args.subject, args.key);
        if (record === null) {
          return Promise.resolve({ ok: true, found: false, subject: args.subject, key: args.key });
        }
        return Promise.resolve({
          ok: true,
          found: true,
          record: {
            id: record.id,
            subject: record.subject,
            key: record.key,
            content: record.content,
            summary: record.summary,
            validAt: record.validAt,
            invalidAt: record.invalidAt,
            confidence: record.confidence,
            createdAt: record.createdAt,
            updatedAt: record.updatedAt
          }
        });
      }
    }),
    defineTool({
      name: "memory_search",
      description: "\u8054\u5408\u68C0\u7D22\u8BB0\u5FC6:M2 \u5B9E\u4F53\u8BB0\u5FC6(key/\u6458\u8981/\u6B63\u6587/\u4E3B\u4F53)+ M1 \u5DE5\u4F5C\u533A NOTES \u6587\u4EF6\u5168\u6587,\u591A\u8BCD AND,\u8FD4\u56DE\u5E26\u51FA\u5904\u3002",
      parameters: {
        query: { type: "string", required: true, description: "\u68C0\u7D22\u8BCD,\u7A7A\u683C\u5206\u9694\u591A\u8BCD(AND)" },
        subject: { type: "string", description: "\u9650\u5B9A M2 \u4E3B\u4F53(\u7CBE\u786E\u5339\u914D);\u7F3A\u7701\u5168\u4E3B\u4F53" },
        limit: { type: "number", description: "\u6700\u591A\u8FD4\u56DE\u6761\u6570,\u9ED8\u8BA4 20" }
      },
      output: {
        schema: { type: "object", additionalProperties: true },
        render: (_args, value) => [{ type: "text", text: JSON.stringify(value, null, 2) }]
      },
      isConcurrencySafe: () => true,
      execute: async (args, _exec) => {
        try {
          const hits = await memory.search(args.query, {
            ...args.subject !== void 0 && { subject: args.subject },
            ...args.limit !== void 0 && { limit: args.limit }
          });
          return {
            ok: true,
            query: args.query,
            count: hits.length,
            hits: hits.map((hit) => ({ source: hit.source, kind: hit.kind, title: hit.title, summary: hit.summary }))
          };
        } catch (error) {
          return failureOf(error);
        }
      }
    }),
    defineTool({
      name: "memory_forget",
      description: "\u9057\u5FD8\u4E00\u6761\u957F\u671F\u8BB0\u5FC6:\u5E94\u7528\u5199\u5165\u9006\u95ED\u5305**\u771F\u5220**\u8BE5 (subject,key) \u7684\u5168\u90E8\u884C(\u542B\u5386\u53F2),\u4E0D\u53EF\u7ECF\u68C0\u7D22\u518D\u5F97;\u8FD4\u56DE\u5220\u9664\u5FEB\u7167\u3002",
      parameters: {
        subject: { type: "string", required: true, description: "\u4E3B\u4F53" },
        key: { type: "string", required: true, description: "\u8BB0\u5FC6\u952E" }
      },
      output: {
        schema: { type: "object", additionalProperties: true },
        render: (_args, value) => [{ type: "text", text: JSON.stringify(value, null, 2) }]
      },
      execute: (args, _exec) => {
        try {
          const { forgotten, records } = memory.forget(args.subject, args.key);
          return Promise.resolve({
            ok: true,
            subject: args.subject,
            key: args.key,
            forgotten,
            deleted: records.map((record) => ({
              id: record.id,
              key: record.key,
              validAt: record.validAt,
              invalidAt: record.invalidAt,
              confidence: record.confidence
            }))
          });
        } catch (error) {
          return Promise.resolve(failureOf(error));
        }
      }
    })
  ];
}
function createMemoryIndexSection(memory, options = {}) {
  return {
    name: MEMORY_INDEX_SECTION_NAME,
    order: MEMORY_INDEX_SECTION_ORDER,
    text: () => memory.buildIndex(options).text,
    interpolate: false
  };
}
function attachMemory(host, memory, options = {}) {
  const disposers = [];
  for (const definition of defineMemoryTools(memory)) {
    disposers.push(host.registerTool(definition));
  }
  if (options.includeIndexSection !== false) {
    disposers.push(host.registerPromptSection(createMemoryIndexSection(memory, options.index)));
  }
  let detached = false;
  return () => {
    if (detached) return;
    detached = true;
    for (const dispose of disposers.splice(0)) dispose();
  };
}
function failureOf(error) {
  const message = error instanceof Error ? error.message : "unknown error";
  if (isPiiBlockedError(error)) return { ok: false, blocked: "pii", message };
  return { ok: false, message };
}
export {
  MEMORY_INDEX_SECTION_NAME,
  MEMORY_INDEX_SECTION_ORDER,
  MEMORY_TOOL_NAMES,
  attachMemory,
  createMemoryIndexSection,
  defineMemoryTools,
  dshHost
};
