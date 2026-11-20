/**
 * 工具入参/出参的 JSON Schema 节点(结构子集,对齐 dsh-tools json-schema 语义)。
 * 宽松承载:`[key: string]: unknown` 允许 provider 特有键;强校验是 @basis/tools 的职责。
 */
export interface JsonSchemaNode {
  /** 值类型;缺省 = 任意 JSON 值。 */
  type?: string
  description?: string
  /** `type: 'object'` 的属性 schema。 */
  properties?: Record<string, JsonSchemaNode>
  /** `false` 拒绝未声明键;缺省/`true` 为开放默认。 */
  additionalProperties?: boolean | JsonSchemaNode
  /** `type: 'array'` 的元素 schema。 */
  items?: JsonSchemaNode
  oneOf?: readonly JsonSchemaNode[]
  enum?: readonly (string | number)[]
  minimum?: number
  maximum?: number
  [key: string]: unknown
}
