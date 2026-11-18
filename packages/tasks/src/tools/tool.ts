/**
 * 工具面共享原语——模型面工具的形状、资源语法的读取工具构造,与 defineTool seam 的适配
 * (35 号 A20;34 号 §2.5 tools 行「SA src/app/tools/(tool.ts/main.ts/executor.ts)
 * → src/tools/orchestrator.ts + worker.ts;.strict()+describe()+AbortSignal+角色分面四纪律照搬;
 * 实现换 defineTool seam(ctx.tools.register 返回 disposer 进 ctx.effect,本仓已有参照
 * packages/memory/src/tools.ts:282)」)。
 *
 * 四纪律(24 号 §8.3,逐条落点):
 * 1. schema 用 zod `.strict()` + 默认值 + `.describe()`——模型面就是 API 面;本文件把 zod schema
 *    投影为宿主 `@deepseek-ai/dsh-tools` 的 `ParameterSchemaSpec`(经 zod v4 `z.toJSONSchema`),
 *    **execute 内以同一 zod schema 再校验**——zod 是唯一事实源,正则/refine/跨字段约束等
 *    宿主 schema 不表达的限制全部在 execute 强制;
 * 2. 工具描述给出资源语法(模型知道边界)——readTool 的描述与 resource 参数描述拼
 *    `resourceGrammar(executor)`(resources.ts);
 * 3. 执行函数必须接 `AbortSignal`——`Tool.execute(args, signal)` 签名钉死,适配层把宿主
 *    `exec.signal` 原样传入;
 * 4. 每个角色只给它该有的工具面(主会话 ≠ worker,防越权)——分面在 orchestrator.ts/
 *    worker.ts,断言在 tests/tools.spec.ts。
 * 词数与字数界限(IM_WORDS/NOTE_WORDS 等)出处:28 号 §1.1 表(ack ≤100 词、路由注释 ≤30 词)。
 */
import { defineTool, type ToolDefinition } from '@deepseek-ai/dsh-tools'
import { z } from 'zod'
import { resourceGrammar } from './resources.ts'

/** 一个模型面工具(SA tool.ts Tool 接口原样):名称、描述、zod schema 与接 AbortSignal 的执行函数。 */
export interface Tool<S extends z.ZodType = z.ZodType> {
  name: string
  description: string
  schema: S
  execute: (args: z.infer<S>, signal: AbortSignal) => Promise<unknown>
}
/** 收窄类型标注(实现处以 `tool({...})` 包裹,使 z.infer 不致散布 unknown)。 */
export const tool = <S extends z.ZodType>(definition: Tool<S>): Tool => definition

/** 中文分词统计(Intl.Segmenter;SA infra/text.ts wordCount 同构——中文按词、英文按词)。 */
const words = new Intl.Segmenter('zh', { granularity: 'word' })
/** 一条确认/答复类 IM 文本的词数上限(28 号 §1.1「ack ≤100 词」)。 */
export const IM_WORDS = 100
/** 一条路由注释的词数上限(28 号 §1.1「路由注释 ≤30 词」)。 */
export const NOTE_WORDS = 30
/** 统计词形片段数(忽略标点),中英混排同口径。 */
export function wordCount(text: string): number {
  let count = 0
  for (const segment of words.segment(text)) if (segment.isWordLike) count++
  return count
}

/**
 * `orchestrator_read` 的构造(两角色各一;SA tool.ts readTool 原语义):
 * 主会话可读全部资源,worker 只可读其工单子树(资源语法随角色收窄)。
 */
export function readTool(description: string, executor: boolean,
  read: (resource: string, offset: number, limit: number | undefined, signal: AbortSignal) => Promise<unknown>): Tool {
  return tool({
    name: 'orchestrator_read',
    description,
    schema: z.object({
      resource: z.string().min(1).describe(`资源路径,其一:${resourceGrammar(executor)}。`),
      offset: z.number().int().min(0).default(0).describe('照抄上一页的 next_offset;它按文本计字符、按列表计条目。'),
      limit: z.number().int().min(1).max(8000).optional()
        .describe('文本按字符(默认 4000、至多 8000),列表按条目(默认 20、至多 50)。'),
    }).strict(),
    execute: async (args, signal) => read(args.resource, args.offset, args.limit, signal),
  })
}

// ── defineTool seam 适配(zod → 宿主 ParameterSchemaSpec 投影;B4 先例形态)──────────────

/** JSON Schema 节点投影所需的最小形状(zod v4 z.toJSONSchema 的输出子集)。 */
interface JsonSchemaNode {
  type?: string
  description?: string
  default?: unknown
  enum?: readonly (string | number | boolean | null)[]
  const?: string | number | boolean | null
  items?: JsonSchemaNode
  properties?: Record<string, JsonSchemaNode>
  required?: readonly string[]
  additionalProperties?: boolean
  anyOf?: readonly JsonSchemaNode[]
}

/**
 * 把一个 JSON Schema 节点投影为宿主的值 schema:类型/枚举/描述/默认值照搬;
 * 宿主不表达的界限(min/max/pattern 等)丢弃——它们由 execute 内的 zod 再校验强制。
 * `anyOf` 的「T 或 null」(zod nullish/nullable)投影为 T 本体(宿主无 null 分支面;
 * null 容忍由 zod 校验),其余 anyOf/oneOf 投影为宿主 oneOf;无类型的节点投影为 `json`。
 */
function valueSpec(node: JsonSchemaNode): Record<string, unknown> {
  if (node.anyOf) {
    const branches = node.anyOf.filter(branch => branch.type !== 'null')
    if (branches.length === 1 && node.anyOf.length === 2) {
      // 「T 或 null」(zod nullish)投影为 T 本体,宿主层不表达 null 分支;null 容忍由 zod 校验。
      const merged: JsonSchemaNode = { ...branches[0] }
      if (node.description !== undefined) merged.description = node.description
      if (node.default !== undefined) merged.default = node.default
      return valueSpec(merged)
    }
    return { oneOf: node.anyOf.map(branch => valueSpec(branch)), ...(node.description ? { description: node.description } : {}) }
  }
  const shared = {
    ...(node.description ? { description: node.description } : {}),
    ...(node.default !== undefined ? { default: node.default } : {}),
  }
  switch (node.type) {
    case 'string': return { type: 'string', ...(node.enum ? { enum: node.enum } : {}), ...(node.const !== undefined ? { const: node.const } : {}), ...shared }
    case 'number': return { type: 'number', ...(node.enum ? { enum: node.enum } : {}), ...shared }
    case 'integer': return { type: 'integer', ...(node.enum ? { enum: node.enum } : {}), ...shared }
    case 'boolean': return { type: 'boolean', ...shared }
    case 'null': return { type: 'null', ...shared }
    case 'array': return { type: 'array', ...(node.items ? { items: valueSpec(node.items) } : {}), ...shared }
    case 'object': {
      const required = new Set(node.required ?? [])
      return { type: 'object', additionalProperties: node.additionalProperties ?? false,
        properties: Object.fromEntries(Object.entries(node.properties ?? {}).map(([name, child]) =>
          [name, { ...valueSpec(child), ...(required.has(name) ? { required: true } : {}) }])), ...shared }
    }
    default: return { type: 'json', ...shared }
  }
}

/**
 * zod schema → 宿主 parameters 投影:根对象按属性展开(required 逐属性标注),
 * 投影细节见 {@link valueSpec};解析与默认值填充在 execute 内以同一 zod schema 完成。
 */
function parameterSpec(schema: z.ZodType): Record<string, unknown> {
  const json = z.toJSONSchema(schema) as JsonSchemaNode & { properties?: Record<string, JsonSchemaNode>; required?: readonly string[] }
  if (!json.properties) return { value: { ...valueSpec(json), required: true } }
  return Object.fromEntries(Object.entries(json.properties).map(([name, child]) =>
    // 默认值使属性对调用方可选(JSON Schema 把带默认值的键也列进 required;zod parse 会填充默认值,
    // 模型面按「可省略」呈现)——只有无默认值的 required 键才标 required。
    [name, { ...valueSpec(child), ...(json.required?.includes(name) && child.default === undefined ? { required: true } : {}) }]))
}

/**
 * 一个 zod 工具 → 宿主 `ToolDefinition`(defineTool seam;`ctx.tools.register(def)` 直接可注册,
 * 返回的 disposer 由装配面进 ctx.effect——35 号表⑤-7)。execute 以同一 zod schema 解析参数
 * (默认值填充、strict 拒未知键、refine/superRefine 全部在此强制)并把宿主的
 * `exec.signal` 原样交给 `Tool.execute`(四纪律之三)。
 */
export function toDshTool(definition: Tool): ToolDefinition {
  const { name, schema } = definition
  return defineTool({
    name,
    description: definition.description,
    // defineTool 校验 const 泛型:此处为动态投影,经 as 断言收口——投影产物的形状由
    // valueSpec 保证(见上);值校验以 zod 为准,投影仅承载模型面。
    parameters: parameterSpec(schema) as never,
    output: {
      schema: { type: 'json' },
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value, null, 2) }],
    },
    // canonical JSON 值面:工具返回对象即 lossless JSON;投影产物经 as never 收口(值校验以 zod 为准)。
    execute: async (args: unknown, exec) => await definition.execute(schema.parse(args), exec.signal) as never,
  })
}
