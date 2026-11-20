/**
 * prompts seam 契约:system prompt section 注册与组装。
 * 对齐 dsh-system-prompt 语义:唯一 name(重复注册抛错)、order 升序拼接、
 * text 可为静态串或每次装配时求值的 provider、interpolate=false 保真字面。
 */

/** 装配上下文(v1 仅插值变量表)。 */
export interface PromptAssembleContext {
  readonly variables: Readonly<Record<string, string>>
}

/** 一段 system prompt 贡献。 */
export interface PromptSection {
  /** 唯一名 —— 同名重复注册抛错。 */
  readonly name: string
  /** 升序拼接位;同 order 按名的 code-unit 序。 */
  readonly order: number
  /** 静态文本或每次装配时求值的 provider。 */
  readonly text: string | ((context: PromptAssembleContext) => string)
  /** 是否插值 `{{variable}}`;默认 true,false 保真字面(记忆正文含 `{{…}}` 字面序列时必须关)。 */
  readonly interpolate?: boolean
}

/** prompts 注册表(ctx.systemPrompt 服务面)。 */
export interface PromptRegistry {
  /** 注册 section,返回 the exact disposer(effect 配逆);同名重复抛错。 */
  section(section: PromptSection): () => void
  /** 按当前注册集组装完整 system prompt(升序、换行连接、按需插值)。 */
  assemble(context?: PromptAssembleContext): string
}
