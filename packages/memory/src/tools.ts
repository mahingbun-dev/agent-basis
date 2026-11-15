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
 * 模型面语义(M-M1 T2 起,19 号 §3-T2):
 * - memory_write:写 M2 实体记忆(PII 先行,命中返回 blocked:'pii' 结构化失败,
 *   不中断 turn)。subject 收敛为 `user` / `domain:<域键>`(org 已禁用);
 * kind 必填(explicit 可选,用户显式「记住」时 true);provenance 运行时盖章
 * (exec.agent 会话面 + 宿主 sessionContext 回落,模型传参一律忽略);
 * 返回四操作决策 add/update/noop 与撤销提示——写入的逆闭包由服务侧持有,
 * memory_forget 即其面向模型的「应用逆」入口(真删);
 * - memory_read:按 (subject, key) 读 live 正文(渐进披露的正文侧);
 * - memory_search:M1 notes 全文 + M2 实体过滤的联合检索,返回带出处;
 *   scope/domain_key 过滤发生在相似度排序之前(Zep scoped retrieval);
 * - memory_forget:应用逆闭包**真删**(物理 DELETE 全部行),返回删除快照。
 *
 * 索引 section 取 `interpolate: false`:记忆正文可能包含 `{{…}}` 字面序列,
 * dsh 的变量插值是严格模式(未知引用会 fail assembly),字面保真避免误炸。
 */
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { Context } from '@deepseek-ai/cordis'
import type { PromptSection } from '@deepseek-ai/dsh-system-prompt'
import type { ToolDefinition, ToolRunContext } from '@deepseek-ai/dsh-tools'
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

/**
 * 召回前缀(M-M1 T3,19 §3-T3.4):memory_search 命中组装进模型上下文时附的
 * 一行纪律——检索结果是时点观察,引用前先验证仍然成立(Zcode semantic-recall
 * 同款;18 §4.1)。T5 起登记为提示词注册表条目 runtime.memory.search-prefix,
 * 本常量即该条目的内置兜底文本。
 */
export const MEMORY_SEARCH_RESULT_PREFIX = '检索结果为时点观察,引用前先验证仍然成立'

/** 输出契约:开放对象(全部字段 JSON-safe;render 成缩进 JSON 文本块)。 */
type MemoryToolOutput = Record<string, JsonValue>

// ---------- Sources 行数据面(M-M3 T12-④,勘察 S3 结论 b 路径) ----------
//
// memory_read / memory_search 的命中条目经 ToolOutputDefinition.presentationMeta
// 投影为 tool/result 事件 meta(dsh-tools pipeline 持久化进 session log,「Session
// log replay reproduces the card with no Host change」)——memory 插件是工具属主,
// 客户端 ConversationNodeDefinition 直读 event.data.meta 零解析(schedule 包窄化
// schedule_create 结果同款手法);不再从 message.content 抓 JSON 文本。

/** 单条记忆来源条目(Sources 行条目载荷;字段与 memory.search 的 MemorySearchHit 同形)。 */
export interface MemorySourceEntry {
  /** 出处锚点:entity → `entity:<subject>/<key>#<id>`;note → `notes/<file>#L<line>`。 */
  readonly source: string
  readonly kind: 'entity' | 'note'
  /** entity → `<subject>/<key>`;note → 文件路径。 */
  readonly title: string
  /** 一句话摘要(时效尾标随宿主检索面已带)。 */
  readonly summary: string
}

/** tool/result meta 载荷(客户端 `event.data.meta` 直读的形状;JSON-safe)。 */
export interface MemorySourcesMeta {
  /** 产出本条 meta 的记忆工具(memory_read=正文读,memory_search=联合检索)。 */
  readonly tool: 'memory_read' | 'memory_search'
  /** 本次调用实际送达模型上下文的记忆条目(零命中/失败=空表,Sources 行不挂载)。 */
  readonly reads: readonly MemorySourceEntry[]
}

/** 读取面记忆工具名(Sources 行采集口径;meta.tool 字段的合法值)。 */
export const MEMORY_SOURCES_TOOL_NAMES = ['memory_read', 'memory_search'] as const

/**
 * 从工具规范输出值投影 Sources 条目(防御收窄:execute 的输出是本文件构造的
 * 开放对象,形状仍按 JsonValue 逐字段校验,坏形状降级为空表不出错——meta 是
 * 展示位,不值得赌)。失败载荷(ok:false)与零命中 → reads=[]。
 */
export function memorySourcesMetaOf(tool: 'memory_read' | 'memory_search', value: MemoryToolOutput): MemorySourcesMeta {
  return { tool, reads: sourcesOf(tool, value) }
}

/** 防御收窄命中条目(memory_search 走 hits 数组;memory_read 走单 record)。 */
function sourcesOf(tool: 'memory_read' | 'memory_search', value: MemoryToolOutput): MemorySourceEntry[] {
  if (value.ok !== true) return []
  if (tool === 'memory_search') return searchSourcesOf(value)
  return readSourcesOf(value)
}

function entryOf(raw: unknown): MemorySourceEntry | null {
  if (typeof raw !== 'object' || raw === null) return null
  const hit = raw as Record<string, unknown>
  if (typeof hit.source !== 'string' || typeof hit.title !== 'string') return null
  if (hit.kind !== 'entity' && hit.kind !== 'note') return null
  return {
    source: hit.source,
    kind: hit.kind,
    title: hit.title,
    summary: typeof hit.summary === 'string' ? hit.summary : '',
  }
}

function searchSourcesOf(value: MemoryToolOutput): MemorySourceEntry[] {
  if (!Array.isArray(value.hits) || typeof value.count !== 'number' || value.count <= 0) return []
  const reads: MemorySourceEntry[] = []
  for (const raw of value.hits) {
    const entry = entryOf(raw)
    if (entry !== null) reads.push(entry)
  }
  return reads
}

function readSourcesOf(value: MemoryToolOutput): MemorySourceEntry[] {
  if (value.found !== true || typeof value.record !== 'object' || value.record === null) return []
  const record = value.record as Record<string, unknown>
  if (typeof record.subject !== 'string' || typeof record.key !== 'string') return []
  const id = typeof record.id === 'number' ? `#${record.id}` : ''
  return [{
    source: `entity:${record.subject}/${record.key}${id}`,
    kind: 'entity',
    title: `${record.subject}/${record.key}`,
    summary: typeof record.summary === 'string' ? record.summary : '',
  }]
}

/**
 * 会话出处上下文(provenance 盖章的宿主注入回落源,19 号 §3-T2.1)。
 * 首选取值在 memory_write execute 内直接读 `exec.agent?.session?.id`
 * (agent-less 派发时缺席);本注入面供 glue 层闭包补值——尤其 turnRef
 * (不在 exec 上,S-5 结论)。两者都缺席时 provenance 盖 null。
 */
export interface MemorySessionContext {
  readonly sessionId: string
  readonly turnRef?: string
}

/** 宿主 seam:工具注册 + prompt section 注册,各返回 disposer(effect 配逆)。 */
export interface MemoryHost {
  /** dsh 形态:`ctx.tools.register(definition)` → the exact disposer。 */
  registerTool(definition: ToolDefinition): () => void
  /** dsh 形态:`ctx.systemPrompt.section(section)` → the exact Cordis effect disposer。 */
  registerPromptSection(section: PromptSection): () => void
  /** 可选:glue 层注入的会话出处(exec.agent 缺席时的回落源;每次写入现取)。 */
  sessionContext?(): MemorySessionContext | undefined
}

/**
 * 提示词装配上下文的结构视图(dsh-system-prompt AssembleContext + dsh-agent
 * 对 AssembleContext.agent 的声明合并增广):memory 不依赖 dsh-agent,本地结构
 * 收窄 access/sandbox ToolExecLike 先例(S-5 同款口径);真实装配上下文由
 * dsh-agent 的 assembleContextFor 构造(`{agent, scope: agent, signal}`),
 * scope 与 agent 同身份。
 */
export interface MemoryAssemblyContext {
  /** dsh-scope 的 ScopeKey(与 agent 同身份的对象);memory 不消费,仅承载形状。 */
  readonly scope?: unknown
  /** 装配主体 Agent(dsh-agent 增广;runtime 增广 session 字段)。 */
  readonly agent?: unknown
}

/**
 * 装配上下文 → 会话 id(防御收窄):`agent.session.id`(dsh-agent 运行时增广)
 * 优先,回落 `agent.id`(基础接口,同为 SessionId);缺席/形状不符返回 null
 * (装配面不可归属 → 无域上下文,索引退回单区锚点形态)。
 */
export function assemblySessionIdOf(assembly: MemoryAssemblyContext | undefined): string | null {
  const agent: unknown = assembly?.agent
  if (typeof agent !== 'object' || agent === null) return null
  const origin = agent as AgentSessionOrigin
  const sessionId = origin.session?.id ?? origin.id
  return typeof sessionId === 'string' ? sessionId : null
}

/** 把真实 dsh Context 适配为 MemoryHost(组合层唯一需要的宿主形态)。 */
export function dshHost(ctx: Context): MemoryHost {
  return {
    registerTool: definition => ctx.tools.register(definition),
    registerPromptSection: section => ctx.systemPrompt.section(section),
  }
}

// ---------- 提示词注册表读取面(T2.6 登记制落地样板) ----------
//
// 索引 section 的行为指令头(memory:index 的静态提示词半边)不再只来自本文件内联
// 常量:经宿主上的 `promptRegistry` 服务(提示词工作室插件提供)读注册表条目
// runtime.memory.index-section 的当前生效文本,注册表缺席/无版本/读取失败一律
// 回落内置 MEMORY_BEHAVIOR_HEADER——不炸宿主,行为与改造前一致。索引半边
// (key+摘要)始终来自 M2 记忆库,不进注册表(运行时数据不是提示词)。
// 手法对齐 packages/llm-doctor 的 ConfigEditorFace/resolveConfigEditor:消费面
// 只声明结构子集 + try/catch 防御解析,不依赖(也不引入)工作室包。

/** 注册表读取服务名(与 @eterna/prompt-studio 的 provide 名互为真值;锚点交叉钉住见 prompt-studio tests/registry.test.ts)。 */
export const PROMPT_REGISTRY_SERVICE_ID = 'promptRegistry'

/** 本 section 在提示词注册表(T1.3)登记的条目 id(运行时注入型)。 */
export const MEMORY_SECTION_REGISTRY_ENTRY_ID = 'runtime.memory.index-section'

/**
 * 召回前缀在提示词注册表登记的条目 id(M-M1 T5,19 §3-T5;运行时注入型——
 * 前缀随 memory_search 命中组装进模型上下文,非 systemPrompt section)。
 * 内置兜底 = MEMORY_SEARCH_RESULT_PREFIX(读取面缺席/无版本/读取失败)。
 */
export const MEMORY_SEARCH_PREFIX_REGISTRY_ENTRY_ID = 'runtime.memory.search-prefix'

/**
 * 提示词注册表运行时读取面(结构子集;由提示词工作室插件提供)。
 * resolveRuntimePromptText 返回条目当前生效文本(随注册表版本变化);
 * 无版本/未知条目 → undefined(调用方回落内置兜底,不抛)。
 */
export interface PromptRegistryFace {
  resolveRuntimePromptText(entryId: string): string | undefined
}

/** 注册表读取面的宿主消费面(结构子集;真实 cordis Context 的 reflect mixin `get` 满足之)。 */
export interface PromptRegistryHost {
  get(name: string): unknown
}

/**
 * 防御解析 promptRegistry 服务(照抄 llm-doctor resolveConfigEditor 防御模式):
 * 服务缺席/未就绪/形状不符/读取抛异常 → undefined,绝不炸宿主。
 * 每次调用现取(live),插件装载顺序不影响后续装配轮次拿取。
 */
export function resolvePromptRegistry(host: PromptRegistryHost): PromptRegistryFace | undefined {
  try {
    const service = host.get(PROMPT_REGISTRY_SERVICE_ID) as PromptRegistryFace | undefined
    if (service !== undefined && typeof service.resolveRuntimePromptText === 'function') return service
    return undefined
  } catch {
    return undefined
  }
}

/** 经读取面取条目文本;任何失败(服务缺席/方法抛)→ undefined(回落内置兜底,装配永不因读取面失败)。 */
function registryTextOf(source: PromptRegistryFace | undefined, entryId: string): string | undefined {
  if (source === undefined) return undefined
  try {
    return source.resolveRuntimePromptText(entryId)
  } catch {
    return undefined
  }
}

/**
 * 构建四个模型面工具定义(注册进 ctx.tools 即对模型可见)。
 * sessionContext:宿主注入的 provenance 回落源(exec.agent 缺席时;19 号 §3-T2.1),
 * 缺省不注入——provenance 盖 null,写入不受影响。
 * promptSource(M-M1 T5):提示词注册表读取面——memory_search 命中渲染的召回
 * 前缀优先取条目 MEMORY_SEARCH_PREFIX_REGISTRY_ENTRY_ID 当前生效文本,缺席/
 * 无版本/读取失败回落内置 MEMORY_SEARCH_RESULT_PREFIX(render 时现取,随版本变化)。
 * domainOf(M-M3 T10):会话域归属读取面——glue 按 sessionId 返回会话绑定域;
 * memory_write 的 episodic 写入以会话域为权威归属(18 §1.3「域归属同时写入
 * 会话元数据」),缺席/未绑定不干预,模型 subject 照旧。
 */
export function defineMemoryTools(
  memory: Memory,
  sessionContext?: () => MemorySessionContext | undefined,
  promptSource?: PromptRegistryFace,
  domainOf?: (sessionId: string) => string | undefined,
): ToolDefinition[] {
  return [
    defineTool({
      name: 'memory_write',
      description: '写入一条长期实体记忆(M2,sqlite 持久,跨会话)。主体由系统管理:用户画像层用 `user`;功能域用 `domain:<域键>`;不需要也无法写 org(已禁用)。同 (subject,key) 重复写入会顶替旧值;内容高度相似的写入会被合并进既有记忆或判定为无需写入。写入前强制 PII 过滤:含手机号/身份证/邮箱/IP 等敏感信息会被拒绝。',
      parameters: {
        subject: { type: 'string', required: true, description: '主体:用户画像层固定 `user`;功能域 `domain:<域键>`(kebab-case,如 domain:deploy);org 已禁用' },
        key: { type: 'string', required: true, description: '记忆键,同 subject 内唯一,不含空白,如 prefers-email-summary' },
        content: { type: 'string', required: true, description: '记忆正文(一个事实、自包含,≤2000 字;长期保存,勿写入个人敏感信息)' },
        kind: {
          type: 'string',
          required: true,
          enum: ['semantic', 'episodic', 'procedural'],
          description: '认知类型判定口径:semantic=稳定事实与偏好;episodic=本次会话的具体事件/操作记录;procedural=可复用的做法或流程',
        },
        summary: { type: 'string', description: '一句话摘要(进 systemPrompt 记忆索引;缺省从正文派生)' },
        confidence: { type: 'number', description: '置信度 0-1,默认 0.8' },
        explicit: { type: 'boolean', description: '用户显式说「记住…/记一下…」时 true(写入即生效);自主判断值得记时省略(部分类型将先待审,批准后才入索引)' },
      },
      output: {
        schema: { type: 'object', additionalProperties: true },
        render: (_args, value) => [{ type: 'text', text: JSON.stringify(value, null, 2) }],
      },
      execute: (args, exec): Promise<MemoryToolOutput> => {
        try {
          const provenance = stampProvenance(exec, injectedContextOf(sessionContext))
          const scope = toolScopeOf(args.subject)
          // 会话域归属盖章(T10,18 §1.3):会话已绑定域且写入为 episodic(domain
          // 层)时,域归属以会话绑定为准——episodic 是会话事件记录,跟随会话域,
          // 模型传的域键不信任(provenance 盖章同纪律);semantic/procedural 与
          // user 层写入不受干预。模型经返回的 subject/sessionDomain 看到实际落点。
          const sessionDomain = provenance.sessionId === null
            ? undefined
            : domainSessionOf(domainOf, provenance.sessionId)
          const subject = scope === 'domain' && args.kind === 'episodic' && sessionDomain !== undefined
            ? `domain:${sessionDomain}`
            : args.subject
          const { record, decision, superseded } = memory.writeEntity({
            subject,
            key: args.key,
            content: args.content,
            kind: args.kind,
            scope,
            source: args.explicit === true ? 'explicit' : 'agent',
            ...(args.summary !== undefined && { summary: args.summary }),
            ...(args.confidence !== undefined && { confidence: args.confidence }),
            ...(provenance.sessionId !== null && { originSessionId: provenance.sessionId }),
            ...(provenance.turnRef !== null && { originTurnRef: provenance.turnRef }),
          })
          if (decision === 'noop') {
            return Promise.resolve({
              ok: true,
              decision,
              existingKey: record.key,
              reviewState: record.reviewState,
              ...(subject !== args.subject && sessionDomain !== undefined && { sessionDomain }),
              hint: '内容与既有记忆几乎一致,本次未写入',
            })
          }
          return Promise.resolve({
            ok: true,
            decision,
            subject: record.subject,
            key: record.key,
            ...(record.key !== args.key && { mergedFromKey: args.key }),
            ...(subject !== args.subject && sessionDomain !== undefined && { sessionDomain }),
            id: record.id,
            confidence: record.confidence,
            validAt: record.validAt,
            reviewState: record.reviewState,
            supersededCount: superseded.length,
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
        subject: { type: 'string', required: true, description: '主体,与写入时一致(用户画像层 `user`;功能域 `domain:<域键>`)' },
        key: { type: 'string', required: true, description: '记忆键' },
      },
      output: {
        schema: { type: 'object', additionalProperties: true },
        render: (_args, value) => [{ type: 'text', text: JSON.stringify(value, null, 2) }],
        // Sources 行投影(T12-④,S3 结论 b):命中条目持久化为 tool/result meta,
        // 客户端 ConversationNodeDefinition 直读零解析;失败/未命中 → 空 meta 表。
        // MemorySourcesMeta 是结构接口(无索引签名),按 dsh JsonValue 契约过桥断言。
        presentationMeta: (_args, value) => memorySourcesMetaOf('memory_read', value) as unknown as JsonValue,
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
      description: '联合检索记忆:M2 实体记忆(key/摘要/正文/主体)+ M1 工作区 NOTES 文件全文,多词 AND,返回带出处。可用 scope/domain_key 限定检索范围(过滤发生在相似度排序之前)。',
      parameters: {
        query: { type: 'string', required: true, description: '检索词,空格分隔多词(AND)' },
        subject: { type: 'string', description: '限定 M2 主体(精确匹配);缺省全主体' },
        scope: { type: 'string', enum: ['user', 'domain'], description: '限定作用域:user=用户画像层,domain=功能域;缺省两层都查' },
        domain_key: { type: 'string', description: '限定域键(kebab-case,如 deploy;与 scope=domain 联用)' },
        limit: { type: 'number', description: '最多返回条数,默认 20' },
      },
      output: {
        schema: { type: 'object', additionalProperties: true },
        render: (_args, value) => [{ type: 'text', text: renderSearchOutput(value, searchPrefixOf(promptSource)) }],
        // Sources 行投影(T12-④,S3 结论 b):同 memory_read。
        presentationMeta: (_args, value) => memorySourcesMetaOf('memory_search', value) as unknown as JsonValue,
      },
      isConcurrencySafe: () => true,
      execute: async (args, _exec): Promise<MemoryToolOutput> => {
        try {
          const hits = await memory.search(args.query, {
            ...(args.subject !== undefined && { subject: args.subject }),
            ...(args.scope !== undefined && { scope: args.scope }),
            ...(args.domain_key !== undefined && { domainKey: args.domain_key }),
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
        subject: { type: 'string', required: true, description: '主体,与写入时一致(用户画像层 `user`;功能域 `domain:<域键>`)' },
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
 *
 * T2.6 登记制:行为指令头优先经 promptSource(注册表读取面)取条目
 * MEMORY_SECTION_REGISTRY_ENTRY_ID 的当前生效文本,每次装配现取(版本变化
 * 即新文);缺席/无版本/读取失败回落内置 MEMORY_BEHAVIOR_HEADER。
 *
 * M-M1 T3:options 支持解析器形态(每次装配现取)——glue 层读 portrait.md
 * 缓存(19 §3-T4:画像再生成后无需重启即生效)与 M-M3 T10 的会话域上下文
 * 都经此注入;解析器抛异常回落空选项(装配永不因读取面失败)。
 * M-M3 T10:解析器收装配上下文(text provider 的 AssembleContext 原样透传),
 * glue 经 assemblySessionIdOf 反查会话 → 域绑定,注入当前域索引区。
 */
export function createMemoryIndexSection(
  memory: Memory,
  options: MemoryIndexOptions | ((assembly: MemoryAssemblyContext) => MemoryIndexOptions) = {},
  promptSource?: PromptRegistryFace,
): PromptSection {
  return {
    name: MEMORY_INDEX_SECTION_NAME,
    order: MEMORY_INDEX_SECTION_ORDER,
    text: (assembly: MemoryAssemblyContext): string => {
      const base = typeof options === 'function' ? resolveOptionsOf(() => options(assembly)) : options
      const behaviorHeader = registryTextOf(promptSource, MEMORY_SECTION_REGISTRY_ENTRY_ID)
      return memory.buildIndex(behaviorHeader === undefined ? base : { ...base, behaviorHeader }).text
    },
    interpolate: false,
  }
}

/** 解析器形态防御调用:抛异常回落空选项(照 resolvePromptRegistry 防御模式)。 */
function resolveOptionsOf(resolve: () => MemoryIndexOptions): MemoryIndexOptions {
  try {
    return resolve()
  } catch {
    return {}
  }
}

/** attachMemory 选项。 */
export interface AttachMemoryOptions {
  /**
   * 记忆索引 section 的预算/摘要/画像/域上下文参数(默认 500 token)。
   * 解析器形态=每次装配现取(M-M1 T3:glue 读 portrait.md 缓存注入画像区;
   * M-M3 T10:解析器收装配上下文,按会话注入当前域索引区)。
   */
  readonly index?: MemoryIndexOptions | ((assembly: MemoryAssemblyContext) => MemoryIndexOptions)
  /** 是否注册索引 section(默认 true;纯工具场景可关)。 */
  readonly includeIndexSection?: boolean
  /** 提示词注册表读取面(T2.6;缺席→内置兜底文本,装配不受影响)。 */
  readonly promptSource?: PromptRegistryFace
  /**
   * 会话域归属读取面(M-M3 T10):按 sessionId 返回会话绑定域(未绑定/缺席
   * 返回 undefined)。memory_write 的 episodic 写入以会话域为权威归属
   * (18 §1.3);缺席=不干预,模型 subject 照旧。
   */
  readonly domainOf?: (sessionId: string) => string | undefined
}

/**
 * 装配:注册四工具 + 索引 section;返回总 disposer(应用全部逆,幂等)。
 * 这是本插件的宿主级 effect,配逆即卸载干净(Cordis 纪律 1)。
 * promptSource 只读不注册,不引入新的 effect 面——disposer 语义与改造前一致;
 * M-M1 T5 起同时穿线给 memory_search 的召回前缀(index-section 之外的第二消费点)。
 * host.sessionContext(若宿主提供)穿线进 memory_write 的 provenance 盖章回落链;
 * options.domainOf(M-M3 T10)穿线进 memory_write 的 episodic 域归属盖章。
 */
export function attachMemory(host: MemoryHost, memory: Memory, options: AttachMemoryOptions = {}): () => void {
  const disposers: (() => void)[] = []
  for (const definition of defineMemoryTools(
    memory,
    host.sessionContext === undefined ? undefined : () => host.sessionContext?.(),
    options.promptSource,
    options.domainOf,
  )) {
    disposers.push(host.registerTool(definition))
  }
  if (options.includeIndexSection !== false) {
    disposers.push(host.registerPromptSection(createMemoryIndexSection(memory, options.index, options.promptSource)))
  }
  let detached = false
  return (): void => {
    if (detached) return
    detached = true
    for (const dispose of disposers.splice(0)) dispose()
  }
}

/**
 * 召回前缀现取(M-M1 T5):登记读取面在场取条目 MEMORY_SEARCH_PREFIX_REGISTRY_ENTRY_ID
 * 当前生效文本(每次 render 现取,随注册表版本变化);缺席/无版本/读取失败回落
 * 内置兜底 MEMORY_SEARCH_RESULT_PREFIX。
 */
function searchPrefixOf(promptSource: PromptRegistryFace | undefined): string {
  return registryTextOf(promptSource, MEMORY_SEARCH_PREFIX_REGISTRY_ENTRY_ID) ?? MEMORY_SEARCH_RESULT_PREFIX
}

/**
 * memory_search 渲染(M-M1 T3):有命中时先给召回前缀行(19 §3-T3.4——
 * 检索结果是时点观察的纪律随正文一起进上下文),再给规范 JSON;零命中
 * 没有正文要组装,不加前缀噪声。前缀文本 M-M1 T5 起经登记读取面注入
 * (兜底=MEMORY_SEARCH_RESULT_PREFIX),由调用方现取后穿入。
 */
function renderSearchOutput(value: MemoryToolOutput, prefix: string): string {
  const json = JSON.stringify(value, null, 2)
  return typeof value.count === 'number' && value.count > 0 ? `${prefix}\n${json}` : json
}

/** 工具级失败载荷:PII 命中给结构化 blocked 标记;其余给可读 message(均不中断 turn)。 */
function failureOf(error: unknown): MemoryToolOutput {
  const message = error instanceof Error ? error.message : 'unknown error'
  if (isPiiBlockedError(error)) return { ok: false, blocked: 'pii', message }
  return { ok: false, message }
}

// ---------- provenance 盖章与 subject 收敛(M-M1 T2,19 号 §3-T2.1/T2.3) ----------

/**
 * exec 上 agent 的结构化窄取面:`session` 是 dsh-agent 的运行时增广字段
 * (runtime-types 声明合并),本包类型视图(dsh-tools 的 Agent 基础接口)只有
 * `id`——照 access/sandbox ToolExecLike 先例本地声明,不做包依赖。
 */
interface AgentSessionOrigin {
  readonly id?: string
  readonly session?: { readonly id?: string }
}

/**
 * provenance 运行时盖章(S-5 结论):sessionId 首选 `exec.agent?.session?.id`
 * (agent loop 派发必带),回落 `exec.agent?.id`(基础接口,同为 SessionId 品牌),
 * 再回落宿主 sessionContext() 注入;全部缺席盖 null(agent-less 派发降级路径)。
 * turnRef 不在 exec 上:优先宿主注入值,缺席存 `exec.callId`(必在;turn/step
 * 可后置从 session log 的 tool/call 事件按 callId 解析)。模型传参一律忽略——
 * 工具参数无 provenance 字段,此处值全部来自运行时。
 */
function stampProvenance(
  exec: ToolRunContext,
  injected: MemorySessionContext | undefined,
): { sessionId: string | null; turnRef: string | null } {
  const agent = exec.agent as AgentSessionOrigin | undefined
  const sessionId = agent?.session?.id ?? agent?.id ?? injected?.sessionId ?? null
  const turnRef = injected?.turnRef ?? (typeof exec.callId === 'string' ? exec.callId : null)
  return { sessionId, turnRef }
}

/** 宿主注入面防御调用(glue 侧 getter 抛异常不应阻断写入;照 resolvePromptRegistry 防御模式)。 */
function injectedContextOf(
  sessionContext: (() => MemorySessionContext | undefined) | undefined,
): MemorySessionContext | undefined {
  if (sessionContext === undefined) return undefined
  try {
    return sessionContext()
  } catch {
    return undefined
  }
}

/** 会话域归属读取面防御调用(glue 侧查询抛异常不应阻断写入;同防御模式)。 */
function domainSessionOf(
  domainOf: ((sessionId: string) => string | undefined) | undefined,
  sessionId: string,
): string | undefined {
  if (domainOf === undefined) return undefined
  try {
    const domainKey = domainOf(sessionId)
    return typeof domainKey === 'string' && domainKey.length > 0 ? domainKey : undefined
  } catch {
    return undefined
  }
}

/**
 * subject 收敛(19 号 §1.3-1/T2.3):新编码只有 `user` 与 `domain:<域键>`;
 * org 已禁用(Q1 决议,跨用户共享走 RSI 上升)。legacy 前缀一律结构化拒绝
 * (写入面 fail-closed);域键格式(kebab-case ≤64)由数据层校验兜底。
 */
function toolScopeOf(subject: string): 'user' | 'domain' {
  if (subject === 'user') return 'user'
  if (subject.startsWith('domain:')) {
    if (subject.length === 'domain:'.length) {
      throw new RangeError('[memory] subject 域键不能为空:domain:<域键>(kebab-case)')
    }
    return 'domain'
  }
  if (subject.startsWith('org:')) {
    throw new RangeError('[memory] org 作用域已禁用(Q1 决议):跨用户共享记忆不落库;用户画像层用 user,功能域用 domain:<域键>')
  }
  throw new RangeError(`[memory] subject 必须是 user 或 domain:<域键>(kebab-case),得到:${subject}`)
}
