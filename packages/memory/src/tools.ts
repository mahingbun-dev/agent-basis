/**
 * 模型面工具(memory_write / memory_read / memory_search / memory_forget)
 * + systemPrompt 记忆索引 section + 宿主装配 seam。
 *
 * seam 依据(deepseek-harness,只读;类型取自已发布 0.2.2-alpha.2):
 * - packages/core/tools/README.md「Register a tool」:`defineTool({ name,
 *   description, parameters, output, execute })` → `ctx.tools.register(def)`
 *   返回 the exact disposer(effect-owned);
 * - packages/core/system-prompt/README.md「Contribute a prompt section」:
 *   `ctx.systemPrompt.section({ name, order, text, interpolate })` 返回 disposer。
 *
 * 模型面语义:
 * - memory_write:写 M2 实体记忆(PII 先行,命中返回 blocked:'pii' 结构化失败,
 *   不中断 turn);成功返回记录与撤销提示——写入的逆闭包由服务侧持有,
 *   memory_forget 即其面向模型的「应用逆」入口(真删);
 * - memory_read:按 (subject, key) 读 live 正文(渐进披露的正文侧);
 * - memory_search:M1 notes 全文 + M2 实体过滤的联合检索,返回带出处;
 * - memory_forget:应用逆闭包**真删**(物理 DELETE 全部行),返回删除快照。
 *
 * 索引 section 取 `interpolate: false`:记忆正文可能包含 `{{…}}` 字面序列,
 * dsh 的变量插值是严格模式(未知引用会 fail assembly),字面保真避免误炸。
 */
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { Context } from '@deepseek-ai/cordis'
import type { PromptSection } from '@deepseek-ai/dsh-system-prompt'
import type { ToolDefinition } from '@deepseek-ai/dsh-tools'
import { isPiiBlockedError } from './pii.ts'
import type { Memory } from './memory.ts'
import type { MemoryIndexOptions } from './index-builder.ts'

/**
 * 无损 JSON 值(dsh-util-values JsonValue 的结构镜像;该类型未从 dsh-tools
 * 公开导出,此处本地声明以钉住工具输出契约)。
 */
type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue }

/** 四个模型面工具名(固定顺序注册)。 */
export const MEMORY_TOOL_NAMES = ['memory_write', 'memory_read', 'memory_search', 'memory_forget'] as const

/** 索引 section 名(同 scope 重复注册会 throw,由 dsh registry 保证)。 */
export const MEMORY_INDEX_SECTION_NAME = 'memory:index'

/**
 * 索引 section 排序位:9000——在一方指导(≤10000)之后、deployment persona
 * suffix(10200)之前;先于运行时上下文常驻注入。
 */
export const MEMORY_INDEX_SECTION_ORDER = 9000

/** 输出契约:开放对象(全部字段 JSON-safe;render 成缩进 JSON 文本块)。 */
type MemoryToolOutput = Record<string, JsonValue>

/** 宿主 seam:工具注册 + prompt section 注册,各返回 disposer(effect 配逆)。 */
export interface MemoryHost {
  /** dsh 形态:`ctx.tools.register(definition)` → the exact disposer。 */
  registerTool(definition: ToolDefinition): () => void
  /** dsh 形态:`ctx.systemPrompt.section(section)` → the exact Cordis effect disposer。 */
  registerPromptSection(section: PromptSection): () => void
}

/** 把真实 dsh Context 适配为 MemoryHost(组合层唯一需要的宿主形态)。 */
export function dshHost(ctx: Context): MemoryHost {
  return {
    registerTool: definition => ctx.tools.register(definition),
    registerPromptSection: section => ctx.systemPrompt.section(section),
  }
}

/** 构建四个模型面工具定义(注册进 ctx.tools 即对模型可见)。 */
export function defineMemoryTools(memory: Memory): ToolDefinition[] {
  return [
    defineTool({
      name: 'memory_write',
      description: '写入一条长期实体记忆(M2,sqlite 持久,跨会话)。同 (subject,key) 重复写入会顶替旧值(历史保留可审计)。写入前强制 PII 过滤:含手机号/身份证/邮箱/IP 等敏感信息会被拒绝。',
      parameters: {
        subject: { type: 'string', required: true, description: '主体,约定前缀 user:<名> / org:<名> / project:<名>' },
        key: { type: 'string', required: true, description: '记忆键,同 subject 内唯一,不含空白,如 prefers-email-summary' },
        content: { type: 'string', required: true, description: '记忆正文(长期保存,勿写入个人敏感信息)' },
        summary: { type: 'string', description: '一句话摘要(进 systemPrompt 记忆索引;缺省从正文派生)' },
        confidence: { type: 'number', description: '置信度 0-1,默认 0.8' },
      },
      output: {
        schema: { type: 'object', additionalProperties: true },
        render: (_args, value) => [{ type: 'text', text: JSON.stringify(value, null, 2) }],
      },
      execute: (args, _exec): Promise<MemoryToolOutput> => {
        try {
          const { record } = memory.writeEntity({
            subject: args.subject,
            key: args.key,
            content: args.content,
            ...(args.summary !== undefined && { summary: args.summary }),
            ...(args.confidence !== undefined && { confidence: args.confidence }),
          })
          return Promise.resolve({
            ok: true,
            subject: record.subject,
            key: record.key,
            id: record.id,
            confidence: record.confidence,
            validAt: record.validAt,
            hint: '撤销用 memory_forget(subject, key):应用逆闭包真删',
          })
        } catch (error) {
          return Promise.resolve(failureOf(error))
        }
      },
    }),
    defineTool({
      name: 'memory_read',
      description: '读取一条长期记忆的当前正文(systemPrompt 只注入索引,正文按需读本工具)。',
      parameters: {
        subject: { type: 'string', required: true, description: '主体(与写入时一致)' },
        key: { type: 'string', required: true, description: '记忆键' },
      },
      output: {
        schema: { type: 'object', additionalProperties: true },
        render: (_args, value) => [{ type: 'text', text: JSON.stringify(value, null, 2) }],
      },
      isConcurrencySafe: () => true,
      execute: (args, _exec): Promise<MemoryToolOutput> => {
        const record = memory.readEntity(args.subject, args.key)
        if (record === null) {
          return Promise.resolve({ ok: true, found: false, subject: args.subject, key: args.key })
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
            updatedAt: record.updatedAt,
          },
        })
      },
    }),
    defineTool({
      name: 'memory_search',
      description: '联合检索记忆:M2 实体记忆(key/摘要/正文/主体)+ M1 工作区 NOTES 文件全文,多词 AND,返回带出处。',
      parameters: {
        query: { type: 'string', required: true, description: '检索词,空格分隔多词(AND)' },
        subject: { type: 'string', description: '限定 M2 主体(精确匹配);缺省全主体' },
        limit: { type: 'number', description: '最多返回条数,默认 20' },
      },
      output: {
        schema: { type: 'object', additionalProperties: true },
        render: (_args, value) => [{ type: 'text', text: JSON.stringify(value, null, 2) }],
      },
      isConcurrencySafe: () => true,
      execute: async (args, _exec): Promise<MemoryToolOutput> => {
        try {
          const hits = await memory.search(args.query, {
            ...(args.subject !== undefined && { subject: args.subject }),
            ...(args.limit !== undefined && { limit: args.limit }),
          })
          return {
            ok: true,
            query: args.query,
            count: hits.length,
            hits: hits.map(hit => ({ source: hit.source, kind: hit.kind, title: hit.title, summary: hit.summary })),
          }
        } catch (error) {
          return failureOf(error)
        }
      },
    }),
    defineTool({
      name: 'memory_forget',
      description: '遗忘一条长期记忆:应用写入逆闭包**真删**该 (subject,key) 的全部行(含历史),不可经检索再得;返回删除快照。',
      parameters: {
        subject: { type: 'string', required: true, description: '主体' },
        key: { type: 'string', required: true, description: '记忆键' },
      },
      output: {
        schema: { type: 'object', additionalProperties: true },
        render: (_args, value) => [{ type: 'text', text: JSON.stringify(value, null, 2) }],
      },
      execute: (args, _exec): Promise<MemoryToolOutput> => {
        try {
          const { forgotten, records } = memory.forget(args.subject, args.key)
          return Promise.resolve({
            ok: true,
            subject: args.subject,
            key: args.key,
            forgotten,
            deleted: records.map(record => ({
              id: record.id,
              key: record.key,
              validAt: record.validAt,
              invalidAt: record.invalidAt,
              confidence: record.confidence,
            })),
          })
        } catch (error) {
          return Promise.resolve(failureOf(error))
        }
      },
    }),
  ]
}

/**
 * 构建记忆索引 section(systemPrompt 注入载荷):
 * text provider 每次装配时同步重建(M2 sqlite 同步取数),预算内只放
 * key + 一句话摘要;`interpolate: false` 保真记忆文本里的 `{{…}}` 字面。
 */
export function createMemoryIndexSection(memory: Memory, options: MemoryIndexOptions = {}): PromptSection {
  return {
    name: MEMORY_INDEX_SECTION_NAME,
    order: MEMORY_INDEX_SECTION_ORDER,
    text: (): string => memory.buildIndex(options).text,
    interpolate: false,
  }
}

/** attachMemory 选项。 */
export interface AttachMemoryOptions {
  /** 记忆索引 section 的预算/摘要参数(默认 500 token)。 */
  readonly index?: MemoryIndexOptions
  /** 是否注册索引 section(默认 true;纯工具场景可关)。 */
  readonly includeIndexSection?: boolean
}

/**
 * 装配:注册四工具 + 索引 section;返回总 disposer(应用全部逆,幂等)。
 * 这是本插件的宿主级 effect,配逆即卸载干净(Cordis 纪律 1)。
 */
export function attachMemory(host: MemoryHost, memory: Memory, options: AttachMemoryOptions = {}): () => void {
  const disposers: (() => void)[] = []
  for (const definition of defineMemoryTools(memory)) {
    disposers.push(host.registerTool(definition))
  }
  if (options.includeIndexSection !== false) {
    disposers.push(host.registerPromptSection(createMemoryIndexSection(memory, options.index)))
  }
  let detached = false
  return (): void => {
    if (detached) return
    detached = true
    for (const dispose of disposers.splice(0)) dispose()
  }
}

/** 工具级失败载荷:PII 命中给结构化 blocked 标记;其余给可读 message(均不中断 turn)。 */
function failureOf(error: unknown): MemoryToolOutput {
  const message = error instanceof Error ? error.message : 'unknown error'
  if (isPiiBlockedError(error)) return { ok: false, blocked: 'pii', message }
  return { ok: false, message }
}
