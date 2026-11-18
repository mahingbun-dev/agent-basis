/**
 * 契约与规范化块两侧的禁入键清单(双向防护)。
 *
 * 依据 36 号 §2.3 禁入清单 / 29 号 §2.1「契约里禁止出现提供方特有字段」:
 * - ① 提供方特有字段——`encrypted_content`、thinking `signature` 等。signature 多轮
 *   原样回传是 deepseek 适配器**内部**行为(29a R4),出块即剥离;禁入键在任何深度
 *   命中即拒绝,防提供方字段回归泄漏。
 * - ② OpenAI 特有/已废弃字段——`strict`/`custom`/`allowed_tools`/`namespace`/
 *   `defer_loading`/Responses 全家(`function_call`/`function_call_output`/
 *   `previous_response_id` 等)/已废弃 `functions`/`function_call`(29a R3)。
 *
 * 本模块是运行时校验函数,供能力声明构造(①侧)与规范化块序列化防护(④侧)复用。
 */

/** ① 提供方特有字段(29 §2.1;deepseek/MiMo 字段级来源 29a R4/R2)。 */
export const FORBIDDEN_PROVIDER_KEYS = [
  'encrypted_content', // deepseek 联网工具加密引用内容——只存在于 deepseek 适配器内部
  'signature', // thinking 不透明签名——多轮原样回传是适配器内部行为,翻译后丢弃
  'web_search_usage', // MiMo usage 记账字段({tool_usage,page_usage})——适配器内部消耗
] as const

/** ② OpenAI 特有/已废弃字段(29a R3 最大公约数裁剪清单,逐字对齐)。 */
export const FORBIDDEN_OPENAI_KEYS = [
  'strict', // Structured Outputs 特有,不合规请求会被拒
  'custom', // OpenAI custom 工具
  'allowed_tools', // OpenAI 特有
  'namespace', // OpenAI 特有
  'defer_loading', // OpenAI 特有
  'functions', // 旧参数,规格已标 deprecated
  'function_call', // 旧参数/Responses 输出项
  'function_call_output', // Responses 轨道回灌项(双 ID 语义,不进公共子集)
  'previous_response_id', // Responses 轨道服务端状态引用
] as const

export type ForbiddenProviderKey = (typeof FORBIDDEN_PROVIDER_KEYS)[number]
export type ForbiddenOpenAIKey = (typeof FORBIDDEN_OPENAI_KEYS)[number]
export type ForbiddenKey = ForbiddenProviderKey | ForbiddenOpenAIKey

/** 双向禁入全集(①+②)。 */
export const FORBIDDEN_KEYS: ReadonlySet<string> = new Set<string>([
  ...FORBIDDEN_PROVIDER_KEYS,
  ...FORBIDDEN_OPENAI_KEYS,
])

/** 一处禁入键命中(含定位路径,便于错误信息与测试断言)。 */
export interface ForbiddenKeyViolation {
  /** 命中路径(JSONPath 风格,根为 `$`)。 */
  readonly path: string
  /** 命中的禁入键名。 */
  readonly key: string
  /** 禁入来源(①提供方特有 / ②OpenAI 特有)。 */
  readonly source: 'provider' | 'openai'
}

const PROVIDER_KEY_SET: ReadonlySet<string> = new Set<string>(FORBIDDEN_PROVIDER_KEYS)

function walk(value: unknown, path: string, out: ForbiddenKeyViolation[]): void {
  if (Array.isArray(value)) {
    value.forEach((item, index) => {
      walk(item, `${path}[${index}]`, out)
    })
    return
  }
  if (value !== null && typeof value === 'object') {
    for (const [key, child] of Object.entries(value)) {
      if (FORBIDDEN_KEYS.has(key)) {
        out.push({
          path: `${path}.${key}`,
          key,
          source: PROVIDER_KEY_SET.has(key) ? 'provider' : 'openai',
        })
      }
      walk(child, `${path}.${key}`, out)
    }
  }
}

/** 深度遍历找全部禁入键命中(不抛错;构造侧与测试断言消费)。 */
export function findForbiddenKeys(value: unknown): ForbiddenKeyViolation[] {
  const out: ForbiddenKeyViolation[] = []
  walk(value, '$', out)
  return out
}

/** 契约/块禁入键违例错误——静态拒绝的唯一异常形态(仅事实,不带提供方值)。 */
export class ForbiddenKeyError extends Error {
  readonly violations: readonly ForbiddenKeyViolation[]

  constructor(violations: readonly ForbiddenKeyViolation[]) {
    super(
      `契约禁入键命中: ${violations.map(v => `${v.path}(${v.source})`).join(', ')}`
      + ' —— 提供方/OpenAI 特有字段不得进入契约与规范化块(29 §2.1;29a R3/R4)',
    )
    this.name = 'ForbiddenKeyError'
    this.violations = violations
  }
}

/** 断言无禁入键(任何深度);命中即抛 ForbiddenKeyError。 */
export function assertNoForbiddenKeys(value: unknown): void {
  const violations = findForbiddenKeys(value)
  if (violations.length > 0) throw new ForbiddenKeyError(violations)
}
