/**
 * Agent 面工具 `knowledge_admin`(管理面只读/受限写)。
 *
 * ## 与浏览器面板的分工
 * - 浏览器面板(需要 cookie 身份 + 人类点击)能做的:`ask`、成员权限写、审计查看;
 * - 本工具**不做**上面三项 —— Agent 不应代做权限变更与审计巡检;
 * - 本工具能做:`list | read | search | save(默认 pending) | deprecate | status | import_markdown |
 *   propose | review(显式 approve/reject 才接受) | list_proposals`。
 *
 * ## 红线落地
 * - **save 缺省 publish=false**:Agent 只落 pending 提案;**publish=true 仅在调用方显式传**时生效,
 *   并在结果里如实标注"经显式请求发布";
 * - **review 不接受 "auto"/模糊值**:只接受字面 `approve`/`reject`,避免模型把"看起来没问题"翻译成发布;
 * - 错误**绝不静默**:失败返回 `{ok:false, code, message}`,工具描述里要求模型如实转述 reason;
 * - 身份:调用者由 plugin 从会话注入;缺失 → `unauthorized` fail-closed(多租户不可退回全局库)。
 *
 * ## 形态
 * 本地 `KnowledgeAdminToolSpec`(纯 JSON in/out,可直接单测)+ `toDshToolDefinition` 适配为
 * `@deepseek-ai/dsh-tools` 0.2.2-alpha.2 的 ToolDefinition(seam 类型编译期钉住)。
 */
import type { JsonSchemaNode, ToolDefinition, ToolRunContext } from '@deepseek-ai/dsh-tools'
import type { KnowledgeAdminCaller, KnowledgeResult } from './types.ts'
import { KNOWLEDGE_ADMIN_TOOL_NAME, fail } from './types.ts'
import type { KnowledgeAdminService } from './service.ts'

/** 可用 action 清单(工具 schema 的 enum 与执行面同一份)。 */
export const TOOL_ACTIONS = [
  'list', 'read', 'search', 'save', 'propose', 'review', 'deprecate', 'status', 'import_markdown', 'list_proposals',
] as const

export type ToolAction = typeof TOOL_ACTIONS[number]

/** 本地工具规格(框架无关;测试直接调 execute)。 */
export interface KnowledgeAdminToolSpec {
  readonly name: string
  readonly description: string
  readonly parameters: Record<string, unknown>
  readonly outputSchema: JsonSchemaNode
  execute(args: unknown, exec?: ToolRunContext): Promise<KnowledgeResult<unknown>>
}

/** 调用者解析面:由 plugin 注入(取会话身份 → 账号分库名);缺省返回 undefined(= fail-closed)。 */
export type CallerResolver = (exec: ToolRunContext | undefined) => KnowledgeAdminCaller | undefined

/** 输出 schema(统一封套;成功与失败都能放进 JSON Schema 子集)。 */
const OUTPUT_SCHEMA: JsonSchemaNode = {
  type: 'object',
  properties: {
    ok: { type: 'boolean' },
    value: { type: 'object' },
    code: { type: 'string' },
    message: { type: 'string' },
  },
  required: ['ok'],
}

/** 入参 schema(action 驱动;每 action 只填自己那几个键)。 */
const PARAMETERS: Record<string, unknown> = {
  type: 'object',
  properties: {
    action: {
      type: 'string',
      enum: [...TOOL_ACTIONS],
      description: 'list=列文档,read=读全文,search=检索,save=新建/改写文档,propose=只落 pending 提案,'
        + 'review=审核提案(只接受 approve|reject),deprecate=标记废弃,status=库概览,'
        + 'import_markdown=导入 markdown,list_proposals=列待审提案',
    },
    account: {
      type: 'string',
      description: '目标账号(缺省=调用者本人账号;非管理员指定他人账号会被拒绝 forbidden)',
    },
    doc_id: { type: 'string', description: 'read/save(改写)/deprecate 的文档 id' },
    title: { type: 'string', description: 'save/propose:标题(必填)' },
    body: { type: 'string', description: 'save/propose:markdown 正文(必填)' },
    tags: { type: 'array', items: { type: 'string' }, description: 'save/propose:标签' },
    origin: { type: 'string', description: 'save/propose:权威来源(建议填文件路径或 URL,人可核对)' },
    publish: {
      type: 'boolean',
      description: 'save:是否直接发布。缺省 false(只落 pending 提案,待人审)。'
        + '仅在人类明确要求"直接发布"时才传 true。',
    },
    query: { type: 'string', description: 'list:标题/路径关键词;search:检索词' },
    top_k: { type: 'integer', minimum: 1, maximum: 50 },
    limit: { type: 'integer', minimum: 1, maximum: 200 },
    offset: { type: 'integer', minimum: 0 },
    reason: { type: 'string', description: 'deprecate:废弃理由(必填);review reject:拒绝理由(必填)' },
    superseded_by: { type: 'string', description: 'deprecate:取代该页的文档 id(后端要求废弃必须给取代者或已有值)' },
    proposal_id: { type: 'string', description: 'review:待审提案 id' },
    decision: { type: 'string', enum: ['approve', 'reject'], description: "review:裁决(只接受 'approve' | 'reject')" },
    include_sources: { type: 'boolean', description: 'search:是否附带外部来源(DeepWiki),默认 true' },
    documents: {
      type: 'array',
      description: 'import_markdown:待导入文档数组(全部落 pending 提案,绝不直接发布)',
      items: {
        type: 'object',
        properties: {
          title: { type: 'string' },
          body: { type: 'string' },
          tags: { type: 'array', items: { type: 'string' } },
          origin: { type: 'string' },
        },
        required: ['title', 'body'],
      },
    },
  },
  required: ['action'],
}

/** 工具描述(sentence case? 不:工具描述是给模型的中文操作契约,保持中文以降低误用)。 */
const DESCRIPTION = [
  '知识库管理工具(按登录账号隔离的分库)。',
  '动作:list/read/search/save/propose/review/deprecate/status/import_markdown/list_proposals。',
  '写操作默认只产生 pending 提案(save 的 publish 缺省 false),必须由人类在面板审核后才生效;',
  'review 只接受显式 approve/reject,不要自行把"看起来没问题"翻译成 approve;',
  'deprecate 会立即生效但返回 undo_token(30 分钟内可撤销,撤销需人类在面板操作)。',
  '只依据返回的 citation/provenance 陈述事实;失败时如实转述返回的 code 与 message,不要静默忽略或编造成功。',
].join('')

/** 构建工具(绑定 service + 调用者解析器)。 */
export function buildKnowledgeAdminTool(service: KnowledgeAdminService, callerOf: CallerResolver): KnowledgeAdminToolSpec {
  return {
    name: KNOWLEDGE_ADMIN_TOOL_NAME,
    description: DESCRIPTION,
    parameters: PARAMETERS,
    outputSchema: OUTPUT_SCHEMA,
    async execute(args, exec) {
      const caller = callerOf(exec)
      if (caller === undefined || caller.account.length === 0) {
        return fail('unauthorized', `${KNOWLEDGE_ADMIN_TOOL_NAME}:无法从会话解析登录账号,拒绝(多租户 fail-closed;请在有身份的会话中重试)`)
      }
      const input = typeof args === 'object' && args !== null && !Array.isArray(args) ? args as Record<string, unknown> : {}
      const action = typeof input.action === 'string' ? input.action : ''
      if (action.length === 0) return fail('invalid', `action 必填(可用:${TOOL_ACTIONS.join('|')})`)
      return await service.runTool(caller, action, input)
    },
  }
}

/** 适配为 DSH ToolDefinition(注册形 `ctx.tools.register(def)`)。 */
export function toDshToolDefinition(spec: KnowledgeAdminToolSpec): ToolDefinition {
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
      return await spec.execute(args, exec)
    },
  }
}
