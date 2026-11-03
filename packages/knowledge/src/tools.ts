/**
 * 模型面四工具:knowledge_search / knowledge_read / knowledge_status / knowledge_propose(设计文档 11 §1/§2.1)。
 *
 * 形态:本地 KnowledgeToolSpec(纯 JSON in/out,框架无关,可直接单测)+ toDshToolDefinition 适配为
 * DSH 官方 ToolDefinition(seam 类型来自已发布 @deepseek-ai/dsh-tools 0.2.2-alpha.2,编译期钉住;
 * 注册形 ctx.tools.register(def) 见 tests/types.seam-pin.ts)。
 *
 * 出口规范:每条命中附统一引用 citation([《标题》](source_uri)(更新于…;状态))——过期信息在出口处自带警示。
 * propose 是唯一写入口:只产生提案,永不直接生效(未过审内容不会出现在任何检索结果)。
 */
import type { JsonSchemaNode, ToolDefinition, ToolRunContext } from '@deepseek-ai/dsh-tools'
import { formatCitation } from './frontmatter.ts'
import { isRecord } from './errors.ts'
import type { KnowledgeService } from './service.ts'
import type { KnowledgeHit, SearchMode } from './types.ts'

/** 本地工具规格(纯函数形态,便于测试与移植到其他工具运行时)。 */
export interface KnowledgeToolSpec {
  readonly name: string
  readonly description: string
  /** 模型入参 JSON Schema(ToolSchema.parameters 兼容)。 */
  readonly parameters: Record<string, unknown>
  /** 规范输出 schema(DSH 强制 JSON Schema 子集)。 */
  readonly outputSchema: JsonSchemaNode
  execute(args: unknown): Promise<unknown>
}

const STRING = { type: 'string' } as const

/** 四工具的固定形态(固定键避免 noUncheckedIndexedAccess 的 undefined 噪音)。 */
export interface KnowledgeTools {
  readonly search: KnowledgeToolSpec
  readonly read: KnowledgeToolSpec
  readonly status: KnowledgeToolSpec
  readonly propose: KnowledgeToolSpec
}

/** 构建四工具(绑定一个 KnowledgeService)。 */
export function buildKnowledgeTools(service: KnowledgeService): KnowledgeTools {
  const search: KnowledgeToolSpec = {
    name: 'knowledge_search',
    description:
      '检索企业知识库(默认本地 wiki,可选 WeKnora),返回带完整溯源(provenance)的命中列表。'
      + '已废弃/被取代/未过审的内容在出口处被统一过滤,不会出现。'
      + '引用知识时请使用返回的 citation 字段(自带更新时间与状态警示)。',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: '检索词(中文或英文)' },
        top_k: { type: 'integer', minimum: 1, maximum: 50, description: '返回条数,默认 8' },
        mode: { type: 'string', enum: ['hybrid', 'keyword', 'semantic'], description: '检索模式,默认 hybrid' },
      },
      required: ['query'],
    },
    outputSchema: SEARCH_OUTPUT,
    async execute(args) {
      const query = requireString(args, 'query')
      const topK = optionalInt(args, 'top_k')
      const mode = optionalMode(args)
      const result = await service.search({
        query,
        ...(topK !== undefined ? { top_k: topK } : {}),
        ...(mode !== undefined ? { mode } : {}),
      })
      return {
        ok: true,
        query,
        contributed: result.contributed,
        degraded: result.degraded,
        count: result.hits.length,
        hits: result.hits.map(toModelHit),
      }
    },
  }

  const read: KnowledgeToolSpec = {
    name: 'knowledge_read',
    description:
      '按 ref 读取一篇知识文档全文(含 changelog 段与完整溯源)。可读归档页(显式引用场景),'
      + 'citation 会自带废弃/取代警示。',
    parameters: {
      type: 'object',
      properties: {
        doc_id: { type: 'string', description: '文档 ID(KnowledgeHit.ref.doc_id)' },
        backend: { type: 'string', description: '后端 ID(wiki-local/weknora),默认 wiki-local' },
      },
      required: ['doc_id'],
    },
    outputSchema: READ_OUTPUT,
    async execute(args) {
      const docId = requireString(args, 'doc_id')
      const backend = optionalString(args, 'backend') ?? 'wiki-local'
      const doc = await service.read({ doc_id: docId, source_uri: '', backend })
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
          citation: doc.citation,
        },
      }
    },
  }

  const status: KnowledgeToolSpec = {
    name: 'knowledge_status',
    description: '查看知识后端状态(启用情况、文档数、能力)。WeKnora 未启用时显示 not-configured。',
    parameters: { type: 'object', properties: {} },
    outputSchema: STATUS_OUTPUT,
    async execute() {
      const reports = await service.status()
      return {
        ok: true,
        backends: reports.map(r => ({
          id: r.id,
          ok: r.ok,
          reason: r.reason,
          doc_count: r.doc_count,
          capabilities: r.capabilities,
        })),
      }
    },
  }

  const propose: KnowledgeToolSpec = {
    name: 'knowledge_propose',
    description:
      '知识写入的唯一入口:提交一篇新页/修改提案(只产生提案,不直接生效)。'
      + '提案需经 governance 门禁评审通过后才会发布为可检索页面;未过审内容不会进入检索结果。'
      + '请在 body 中给出完整正文并注明来源(origin)。',
    parameters: {
      type: 'object',
      properties: {
        title: { type: 'string', description: '页面标题' },
        body: { type: 'string', description: 'markdown 正文(完整内容)' },
        tags: { type: 'array', items: { type: 'string' }, description: '标签' },
        origin: { type: 'string', description: '权威来源(原文出处/URL),缺省标注 agent 撰写' },
        path: { type: 'string', description: '落盘相对路径(缺省 agent-drafts/<doc_id>.md)' },
      },
      required: ['title', 'body'],
    },
    outputSchema: PROPOSE_OUTPUT,
    async execute(args) {
      const title = requireString(args, 'title')
      const body = requireString(args, 'body')
      const tags = optionalStringArray(args, 'tags')
      const origin = optionalString(args, 'origin')
      const path = optionalString(args, 'path')
      const routed = await service.propose({
        title,
        body,
        ...(tags !== undefined ? { tags } : {}),
        ...(origin !== undefined ? { origin } : {}),
        ...(path !== undefined ? { path } : {}),
      })
      return {
        ok: true,
        proposal_id: routed.proposal_id,
        backend: routed.backend,
        state: 'pending',
        note: '提案已记录,等待 governance 门禁评审;未过审内容不会出现在检索结果中',
      }
    },
  }

  return { search, read, status, propose }
}

// ---- 输出 schema(DSH 强制 JSON Schema 子集:仅 type/properties/required/additionalProperties/items/enum/const/oneOf) ----

const HIT_SCHEMA: JsonSchemaNode = {
  type: 'object',
  properties: {
    ref: {
      type: 'object',
      properties: {
        doc_id: STRING,
        source_uri: STRING,
        backend: STRING,
      },
      required: ['doc_id', 'source_uri', 'backend'],
    },
    title: STRING,
    snippet: STRING,
    score: { type: 'number' },
    provenance: { type: 'object' },
    citation: STRING,
  },
  required: ['ref', 'title', 'snippet', 'score', 'provenance', 'citation'],
}

const SEARCH_OUTPUT: JsonSchemaNode = {
  type: 'object',
  properties: {
    ok: { const: true },
    query: STRING,
    contributed: { type: 'array', items: STRING },
    count: { type: 'integer' },
    hits: { type: 'array', items: HIT_SCHEMA },
  },
  required: ['ok', 'query', 'contributed', 'count', 'hits'],
}

const READ_OUTPUT: JsonSchemaNode = {
  type: 'object',
  properties: {
    ok: { const: true },
    doc: {
      type: 'object',
      properties: {
        ref: { type: 'object' },
        title: STRING,
        body: STRING,
        citation: STRING,
        changelog: { type: 'array' },
        provenance: { type: 'object' },
      },
      required: ['ref', 'title', 'body', 'citation', 'changelog', 'provenance'],
    },
  },
  required: ['ok', 'doc'],
}

const STATUS_OUTPUT: JsonSchemaNode = {
  type: 'object',
  properties: {
    ok: { const: true },
    backends: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: STRING,
          ok: { type: 'boolean' },
          doc_count: { type: 'integer' },
        },
        required: ['id', 'ok', 'doc_count'],
      },
    },
  },
  required: ['ok', 'backends'],
}

const PROPOSE_OUTPUT: JsonSchemaNode = {
  type: 'object',
  properties: {
    ok: { const: true },
    proposal_id: STRING,
    backend: STRING,
    state: { type: 'string', enum: ['pending'] },
    note: STRING,
  },
  required: ['ok', 'proposal_id', 'backend', 'state', 'note'],
}

// ---- 参数窄化(模型入参防御;非法入参抛 ToolArgError,由 DSH 执行器按工具失败呈现) ----

class ToolArgError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ToolArgError'
  }
}

function bad(message: string): never {
  throw new ToolArgError(message)
}

function requireString(args: unknown, key: string): string {
  if (!isRecord(args)) bad('参数必须是对象')
  const value = args[key]
  if (typeof value !== 'string' || value.trim().length === 0) bad(`参数 ${key} 必须是非空字符串`)
  return value
}

function optionalString(args: unknown, key: string): string | undefined {
  if (!isRecord(args)) bad('参数必须是对象')
  const value = args[key]
  if (value === undefined) return undefined
  if (typeof value !== 'string') bad(`参数 ${key} 必须是字符串`)
  return value
}

function optionalInt(args: unknown, key: string): number | undefined {
  if (!isRecord(args)) bad('参数必须是对象')
  const value = args[key]
  if (value === undefined) return undefined
  if (typeof value !== 'number' || !Number.isInteger(value)) bad(`参数 ${key} 必须是整数`)
  return value
}

function optionalMode(args: unknown): SearchMode | undefined {
  const raw = optionalString(args, 'mode')
  if (raw === undefined) return undefined
  if (raw !== 'hybrid' && raw !== 'keyword' && raw !== 'semantic') bad('参数 mode 必须是 hybrid|keyword|semantic')
  return raw
}

function optionalStringArray(args: unknown, key: string): readonly string[] | undefined {
  if (!isRecord(args)) bad('参数必须是对象')
  const value = args[key]
  if (value === undefined) return undefined
  if (!Array.isArray(value) || value.some(v => typeof v !== 'string')) bad(`参数 ${key} 必须是字符串数组`)
  return value as readonly string[]
}

/** KnowledgeHit → 模型可见形态(追加统一引用)。 */
export function toModelHit(hit: KnowledgeHit): Record<string, unknown> {
  return {
    ref: hit.ref,
    title: hit.title,
    snippet: hit.snippet,
    score: round3(hit.score),
    provenance: hit.provenance,
    citation: formatCitation(hit),
  }
}

function round3(n: number): number {
  return Math.round(n * 1000) / 1000
}

// ---- DSH ToolDefinition 适配(seam:已发布 @deepseek-ai/dsh-tools 类型) ----

/** 适配为 DSH 官方 ToolDefinition(tools.ts 的 spec → ctx.tools.register(def) 直接可注册)。 */
export function toDshToolDefinition(spec: KnowledgeToolSpec): ToolDefinition {
  return {
    name: spec.name,
    description: spec.description,
    parameters: spec.parameters,
    output: {
      schema: spec.outputSchema,
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value, null, 2) }],
    },
    execute: async (args: unknown, exec: ToolRunContext) => {
      if (exec.signal.aborted) throw new Error(`${spec.name}: 调用已被取消(signal aborted)`)
      return await spec.execute(args)
    },
  }
}

/** 四工具全量适配(注册入口便利)。 */
export function toDshTools(service: KnowledgeService): readonly ToolDefinition[] {
  const tools = buildKnowledgeTools(service)
  return [tools.search, tools.read, tools.status, tools.propose].map(toDshToolDefinition)
}
