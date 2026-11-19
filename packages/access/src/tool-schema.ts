/**
 * 工具参数 schema 归一化(2026-11-19 MiMo 400 事故,主会话首轮即炸)。
 *
 * 背景:宿主 `ToolDefinition.parameters` 是自由 `Record<string, unknown>`,注册/请求
 * 链路不做 JSON Schema 结构校验——原样进 provider 请求。手写工具或个人插件若用
 * 「裸 properties 映射」(`{ dir: {...}, name: {...} }`,无 `type:'object'`/`properties`
 * 包装),顶层键会与 JSON Schema 注解关键字撞名:`title`/`description` 被 provider
 * 当作注解而非参数名(实测 MiMo:submit_plugin_to_market 的 `title`/`description`
 * 参数 → 400 Invalid request parameters;单工具可复现,换规范 schema 后 70 工具请求
 * 200)。属性级 `required: true` 是 DSH 手写习惯里的非标准关键字,同样上提到根
 * `required` 数组。
 *
 * 归一化只处理「裸映射」;已是规范 schema(`type` 字符串/数组或 `$schema` 在场)
 * 原样返回,不重排键、不增删字段。
 */

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** 已是 JSON Schema(以 type/$schema 形态判定;裸映射的属性名不会恰好是 type 字符串)。 */
function looksLikeSchema(parameters: Record<string, unknown>): boolean {
  const type = parameters.type
  return typeof type === 'string' || Array.isArray(type) || typeof parameters.$schema === 'string'
}

/**
 * 把工具的 parameters 收敛成 provider 可接受的 JSON Schema 对象。
 * @param parameters - 工具定义的 parameters(裸映射/规范 schema/缺席)。
 * @returns `{type:'object',properties,required}`;已是规范 schema 时原样返回。
 */
export function normalizeToolParameters(parameters: unknown): Record<string, unknown> {
  if (!isPlainObject(parameters)) return { type: 'object', properties: {}, required: [] }
  if (looksLikeSchema(parameters)) return parameters
  const properties: Record<string, unknown> = {}
  const required: string[] = []
  for (const [name, value] of Object.entries(parameters)) {
    if (!isPlainObject(value)) {
      properties[name] = value
      continue
    }
    const { required: flag, ...schema } = value
    if (flag === true) required.push(name)
    properties[name] = schema
  }
  return { type: 'object', properties, required }
}
