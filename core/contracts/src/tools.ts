/**
 * tools seam 契约:模型面工具的注册/执行/门禁形态。
 *
 * 与上游(dsh-tools 0.2.2-alpha.2)语义对齐的自有子集:
 * - `defineTool({ name, description, parameters, output, execute })` → `ctx.tools.register(def)`
 *   返回 the exact disposer(effect 配逆);
 * - `tools/pre-execute` waterfall:`(exec, next) => PreToolDecision`,监听者可改写/拒绝
 *   (governance 规则引擎 / pack 的 ask 门都注册在此);
 * - `tools/post-execute` emit:结果投影后的观测点(observe 消费)。
 */
import type { ContentBlock } from './content.ts'
import type { JsonSchemaNode } from './json-schema.ts'

/** 模型入参 schema —— 键级形态。 */
export type ToolParameters = Record<string, JsonSchemaNode>
/** 模型入参 schema —— 允许对象级(整个 JSON Schema 节点)或键级;校验在 defineTool。 */
export type ToolParametersLike = ToolParameters | JsonSchemaNode

/** 工具 schema(模型可见面;register 后由 schemas() 白名单产出)。 */
export interface ToolSchema {
  readonly name: string
  readonly description: string
  readonly parameters: ToolParametersLike
}

/** 工具自有规范输出契约:JSON Schema + 纯渲染投影。 */
export interface ToolOutputDefinition {
  /** 成功返回值必须满足的 JSON Schema(子集)。 */
  readonly schema: JsonSchemaNode
  /** 参数 + 规范值 → 模型内容块的纯投影。 */
  render(args: unknown, value: unknown): readonly ContentBlock[]
}

/** 单次工具执行的执行身份与取消信号。 */
export interface ToolRunContext {
  readonly callId: string
  readonly name: string
  readonly signal: AbortSignal
}

/** pre-execute / post-execute 事件载荷(结构兼容 governance ToolCallLike:name/arguments)。 */
export interface ToolExecution {
  readonly callId: string
  readonly name: string
  /** 已解析的模型参数对象(tool/call 会话事件里的 arguments 为原始 JSON 串)。 */
  readonly arguments: unknown
  readonly signal: AbortSignal
  readonly turn?: number
  readonly step?: number
}

/** 一次工具调用的规范化结果。 */
export interface ToolResult {
  readonly callId: string
  readonly name: string
  readonly ok: boolean
  /** 规范 JSON 值(output.schema 校验对象);失败时缺省。 */
  readonly value?: unknown
  /** 模型面内容。 */
  readonly content: readonly ContentBlock[]
  readonly error?: { readonly name: string; readonly message: string }
}

/** pre-execute 决策(治理只产生 allow/deny/ask;deny 优先 fail-closed;ask 理由可缺省)。 */
export type PreToolDecision =
  | { readonly kind: 'allow' }
  | { readonly kind: 'deny'; readonly reason: string }
  | { readonly kind: 'ask'; readonly reason?: string }

/** agent 作用域的工具遮罩(allow 名单 / deny glob;reviewer preset 消费)。 */
export interface ToolRestriction {
  readonly allow?: readonly string[]
  readonly deny?: readonly string[]
}

/** 一个注册的工具:schema + 执行体 + 输出契约。 */
export interface ToolDefinition extends ToolSchema {
  readonly output: ToolOutputDefinition
  /** 并发安全标记:仅 `true` 视为可并行;缺省串行执行。 */
  readonly isConcurrencySafe?: (args: unknown) => boolean
  /** 协作式超时预算(ms);由执行器实现,不进模型 schema。 */
  readonly timeoutMs?: number
  execute(args: unknown, exec: ToolRunContext): Promise<unknown>
}

/** tools 注册表(ctx.tools 服务面)。 */
export interface ToolRegistry {
  /** 注册工具,返回 the exact disposer(effect 配逆)。 */
  register(definition: ToolDefinition): () => void
  get(name: string): ToolDefinition | undefined
  list(): readonly ToolDefinition[]
  /** 模型面 schema 白名单(仅 name/description/parameters)。 */
  schemas(): readonly ToolSchema[]
  /** agent 作用域遮罩(实现方决定作用域纪律;返回解除器)。 */
  restrict?(filter: ToolRestriction): () => void
}

/**
 * 模型入参校验(键级 required:type 布尔 / 对象级 required:名称数组两种形态都认)。
 * 返回问题列表(空 = 合法);供 defineTool 包装 execute / isConcurrencySafe。
 */
export function validateToolArgs(parameters: ToolParametersLike, args: unknown): string[] {
  if (args === null || typeof args !== 'object' || Array.isArray(args)) return ['参数必须是对象']
  const record = args as Record<string, unknown>
  const issues: string[] = []
  const schemas = Object.values(parameters).filter(schema => typeof schema === 'object' && schema !== null) as JsonSchemaNode[]
  const objectLevel = schemas.some(schema => schema.type === 'object' && schema.properties !== undefined)
  if (objectLevel) {
    for (const node of schemas) {
      const required = node['required']
      const properties = node.properties ?? {}
      if (Array.isArray(required)) {
        for (const key of required as readonly string[]) {
          if (record[key] === undefined) issues.push(`缺少必填参数 ${key}`)
        }
      }
      for (const [key, propertySchema] of Object.entries(properties)) {
        if (record[key] === undefined) continue
        const issue = typeIssue(record[key], propertySchema.type)
        if (issue !== undefined) issues.push(`参数 ${key} ${issue}`)
      }
    }
    return issues
  }
  for (const [key, schema] of Object.entries(parameters)) {
    if (typeof schema !== 'object' || schema === null) continue
    const node = schema as JsonSchemaNode
    if (node['required'] === true && record[key] === undefined) issues.push(`缺少必填参数 ${key}`)
    if (record[key] === undefined) continue
    const issue = typeIssue(record[key], node.type)
    if (issue !== undefined) issues.push(`参数 ${key} ${issue}`)
  }
  return issues
}

function typeIssue(value: unknown, type: string | undefined): string | undefined {
  if (type === undefined) return undefined
  let matches: boolean
  switch (type) {
    case 'integer': {
      matches = typeof value === 'number' && Number.isInteger(value)
      break
    }
    case 'number': {
      matches = typeof value === 'number' && Number.isFinite(value)
      break
    }
    case 'string': {
      matches = typeof value === 'string'
      break
    }
    case 'boolean': {
      matches = typeof value === 'boolean'
      break
    }
    case 'array': {
      matches = Array.isArray(value)
      break
    }
    case 'object': {
      matches = typeof value === 'object' && value !== null && !Array.isArray(value)
      break
    }
    default: {
      matches = true
    }
  }
  return matches ? undefined : `应为 ${type} 类型`
}

/**
 * defineTool:注册前校验(fail-loud)+ 参数校验包装(execute 拒绝非法参数、
 * isConcurrencySafe 对非法参数恒 false —— fail-closed,与上游语义一致)。
 */
export function defineTool(definition: ToolDefinition): ToolDefinition {
  if (typeof definition.name !== 'string' || definition.name.length === 0) {
    throw new TypeError('defineTool: name 必须是非空字符串')
  }
  if (typeof definition.description !== 'string' || definition.description.length === 0) {
    throw new TypeError(`defineTool(${definition.name}): description 必须是非空字符串`)
  }
  if (typeof definition.execute !== 'function') {
    throw new TypeError(`defineTool(${definition.name}): execute 必须是函数`)
  }
  const output = definition.output as Partial<ToolOutputDefinition> | undefined
  if (output === undefined || typeof output.render !== 'function' || output.schema === undefined) {
    throw new TypeError(`defineTool(${definition.name}): output.schema 与 output.render 必须提供`)
  }

  const wrappedExecute: ToolDefinition['execute'] = (args, exec) => {
    const issues = validateToolArgs(definition.parameters, args)
    if (issues.length > 0) {
      return Promise.reject(new TypeError(`${definition.name} 参数不合法:${issues.join('; ')}`))
    }
    return definition.execute(args, exec)
  }
  const originalConcurrencySafe = definition.isConcurrencySafe
  const concurrencySafe = originalConcurrencySafe === undefined
    ? undefined
    : (args: unknown): boolean => {
      if (validateToolArgs(definition.parameters, args).length > 0) return false
      return originalConcurrencySafe(args)
    }
  return {
    ...definition,
    execute: wrappedExecute,
    ...(concurrencySafe !== undefined ? { isConcurrencySafe: concurrencySafe } : {}),
  }
}
