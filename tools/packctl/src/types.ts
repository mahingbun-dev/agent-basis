/**
 * packctl 公共类型与错误码表。
 *
 * 错误码分段(README 有同表):
 * - PACK0xx  结构完整(pack 骨架 / package.json / profile.yml)
 * - SKILL0xx SKILL.md frontmatter 与条目锚点(ACE 条目化,10 号文档 §4.1)
 * - GOLD0xx  golden set 完整性与可加载性(07 号文档 §3.2 字段口径)
 * - CORD0xx  Cordis 纪律静态检查(05 号笔记 §9 / 08 号文档 §1)
 * - CHK0xx   pack check 静态冒烟(bundle 声明引用的文件存在)
 */

/** lint/check 输出的最小可机读发现。 */
export interface Finding {
  readonly code: string
  readonly severity: 'error' | 'warning'
  /** 相对 pack 根的路径;pack 级问题用 '<pack>'。 */
  readonly path: string
  readonly message: string
}

export function error(code: string, path: string, message: string): Finding {
  return { code, severity: 'error', path, message }
}

export function warning(code: string, path: string, message: string): Finding {
  return { code, severity: 'warning', path, message }
}

export function hasErrors(findings: readonly Finding[]): boolean {
  return findings.some(f => f.severity === 'error')
}

// ── golden case(07 号文档 §3.2;字段与 ai-evo Excel/终态校验器/轨迹断言同口径)──
// 双形态口径(T6 与 @eterna/evals(T4)对齐后钉住):
// - 映射形态(packctl init 模板):final_state 是单断言映射;approval_flow 是字符串数组;
//   answer 是字符串;
// - 条目形态(@eterna/evals / ai-evo 可执行口径):final_state 是单键条目数组
//   [{file_assert|http_assert|script}, …];approval_flow 是 {tool,outcome,not_executed,min_count};
//   answer 是 {contains|match,ignore_case}。
// 两种形态都合法;评测执行(@eterna/evals runner)消费条目形态,pack lint 对两者都只做结构校验。

export interface GoldenFileAssert {
  readonly path: string
  /** 映射形态:字符串数组;条目形态(@eterna/evals FileAssert):单个字符串。 */
  readonly contains?: readonly string[] | string
  readonly not_contains?: string
  readonly exists?: boolean
}

export interface GoldenHttpAssert {
  /** 映射形态必填;条目形态(@eterna/evals HttpAssert)用 request/respond/assert,无 url。 */
  readonly url?: string
  readonly expect_status?: number
  readonly contains?: readonly string[]
  readonly request?: Record<string, unknown>
  readonly respond?: Record<string, unknown>
  readonly assert?: Record<string, unknown>
}

export interface GoldenScriptAssert {
  readonly command: string
  readonly expect_exit?: number
  readonly stdout_contains?: string
}

export interface GoldenFinalState {
  readonly file_assert?: GoldenFileAssert
  readonly http_assert?: GoldenHttpAssert
  readonly db_assert?: Record<string, unknown>
  readonly script?: GoldenScriptAssert
}

/** 条目形态的 final_state 单键条目(对齐 @eterna/evals FinalStateAssert 联合)。 */
export type GoldenFinalStateEntry =
  | { readonly file_assert: GoldenFileAssert }
  | { readonly http_assert: GoldenHttpAssert }
  | { readonly script: GoldenScriptAssert }

/** 审批红线断言(条目形态;对齐 @eterna/evals ApprovalFlowAssert,语义由其 runner 执行)。 */
export interface GoldenApprovalFlow {
  readonly tool?: string
  readonly outcome?: 'allowed-once' | 'rejected' | 'cancelled' | 'unavailable'
  readonly not_executed?: boolean
  readonly min_count?: number
}

/** answer 断言(条目形态;contains 子串或 match 正则,二选一)。 */
export interface GoldenAnswerAssert {
  readonly contains?: string
  readonly match?: string
  readonly ignore_case?: boolean
}

/** 轨迹断言:四模式对齐 ai-evo(strict/unordered/subset/superset)+ forbidden 调用。 */
export interface GoldenTrajectory {
  readonly mode?: 'strict' | 'unordered' | 'subset' | 'superset'
  readonly calls?: readonly string[]
  readonly must_call?: readonly string[]
  readonly must_not_call?: readonly string[]
  readonly max_steps?: number
  /** 映射形态:字符串数组;条目形态:GoldenApprovalFlow 对象。 */
  readonly approval_flow?: readonly string[] | GoldenApprovalFlow
}

export interface GoldenBudget {
  readonly max_turns?: number
  readonly max_tokens?: number
  readonly max_cost_cny?: number
  readonly cache_hit_rate_min?: number
}

export interface GoldenJudge {
  readonly rubric: string
}

/** 一条 golden case 的规范形态(未知字段保留,便于 ai-evo 扩展列)。 */
export interface GoldenCase {
  readonly id: string
  readonly user_input: string
  readonly answer?: string | GoldenAnswerAssert
  readonly tags?: readonly string[]
  readonly final_state?: GoldenFinalState | readonly GoldenFinalStateEntry[]
  readonly trajectory?: GoldenTrajectory
  readonly budget?: GoldenBudget
  readonly judge?: GoldenJudge
  readonly extra?: Readonly<Record<string, unknown>>
}

// ── 领域包 package.json 的 dsh 声明(对齐 @deepseek-ai/dsh-package-manifest 公共形态)──

export interface DshBundleManifest {
  readonly patch: string | readonly string[]
}

export interface DshManifest {
  readonly manifestVersion?: number
  readonly bundle: DshBundleManifest
}

/** 领域包 package.json 里 packctl 消费的字段。 */
export interface PackPackageJson {
  readonly name: string
  readonly version?: string
  readonly dsh?: DshManifest
}

/** packctl 从 pack 名推导的命名空间:`@event/pack` → `@event`。 */
export function scopeOf(packName: string): string | undefined {
  const match = /^@([a-z0-9][a-z0-9-.]*)\/[a-z0-9][a-z0-9-.]*$/.exec(packName)
  return match?.[1]
}
