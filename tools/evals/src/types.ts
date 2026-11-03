/**
 * golden case schema 与适配器接口的类型定义。
 *
 * 字段命名对齐 ai-evo(设计文档 12 §8.3「golden case/终态/轨迹断言规范 = S 文件约定,
 * 字段对齐 ai-evo」):user_input / answer / tags / final_state / trajectory / budget。
 *
 * 会话事件形态对齐 DSH(../dsh-repo,0.2.2-alpha.2,只读):
 * - SessionEvent 事件包 `{ type, seq, time, data }`:packages/core/session/src/types.ts:504-518;
 * - 事件词汇 64 种:packages/core/session/src/known-event-types.ts(turn/step/tool/approval…);
 * - approval/asked|decided 载荷:packages/interaction/user-approval/src/types.ts:44-58
 *   (已发布 @deepseek-ai/dsh-user-approval 0.2.2-alpha.2 同源);
 * - assistant/message.usage(TokenUsage):packages/llm/llm/src/types.ts:182-199。
 * 本包只声明评测实际消费的字段(fixture 与真实 session 的 JSON 都按此在运行期校验),
 * 由 tests/types.seam-pin.ts 在编译期断言官方类型可赋值进来。
 */

/** DSH SessionEvent 事件包的结构子集(fixture jsonl 每行一个;真实 session 同形)。 */
export interface SessionEventLike {
  readonly type: string
  readonly seq: number
  readonly time: number
  readonly data: unknown
  /** DSH 兼容标记:读者可安全跳过不认识的 type(types.ts:507-516)。 */
  readonly ignorable?: true
}

/**
 * DSH 实验插件记录(`plugin:` 前缀,packages/core/session/src/types.ts:546-566)。
 * replay fixture 用 `plugin:basis-evals/workspace` 携带终态工作区文件快照,
 * 让 file_assert / script 断言在回放模式下有真实对象可查。
 */
export interface PluginRecordLike {
  readonly type: `plugin:${string}`
  readonly seq: number
  readonly time: number
  readonly data: unknown
}

/** `plugin:basis-evals/workspace` 记录的 data 形态:`{ files: { <相对路径>: <内容> } }`。 */
export interface WorkspaceRecordData {
  readonly files: Readonly<Record<string, string>>
}

/** DSH TokenUsage 的结构子集(llm/src/types.ts:182-199;cache 字段可选)。 */
export interface TokenUsageLike {
  readonly inputTokens: number
  readonly outputTokens: number
  readonly totalTokens?: number
  readonly cacheReadTokens?: number
  readonly cacheWriteTokens?: number
  readonly reasoningTokens?: number
}

/** approval/decided.outcome(user-approval/src/types.ts:32)。 */
export type ApprovalOutcomeLike = 'allowed-once' | 'rejected' | 'cancelled' | 'unavailable'

/** golden case 的 answer 断言:contains(子串)或 match(正则)二选一。 */
export interface AnswerAssert {
  readonly contains?: string
  readonly match?: string
  readonly ignore_case?: boolean
}

/** final_state ①:文件终态断言。 */
export interface FileAssert {
  /** 相对 case 工作区根的路径;禁止绝对路径与 `..` 逃逸。 */
  readonly path: string
  readonly exists?: boolean
  readonly contains?: string
  readonly not_contains?: string
}

/** final_state ②:HTTP 终态断言(回放/真连均打到本地 mock 服务,不出外网)。 */
export interface HttpAssert {
  /** 期望 agent 曾发出的请求证据(从会话 tool/call 事件里找)。 */
  readonly request: {
    /** 记录该 http 调用的工具名,默认 `http_request`。 */
    readonly tool?: string
    readonly method?: string
    /** URL 的 path(+query)需包含的子串。 */
    readonly path?: string
    readonly body_contains?: string
  }
  /** mock 应答配置(把记录到的请求重放到本地 mock 上)。 */
  readonly respond?: {
    readonly status?: number
    readonly body?: string
  }
  /** 对 mock 响应的断言;缺省断言 status === respond.status(默认 200)。 */
  readonly assert?: {
    readonly status?: number
    readonly body_contains?: string
  }
}

/** final_state ③:脚本终态断言(exit 0 即过,可加 stdout 断言)。 */
export interface ScriptAssert {
  readonly command: string
  readonly stdout_contains?: string
}

/** final_state 联合:一条 golden case 顺序执行的全部终态断言。 */
export type FinalStateAssert = { file_assert: FileAssert } | { http_assert: HttpAssert } | { script: ScriptAssert }

/** 轨迹匹配四模式(对齐 ai-evo 轨迹校验器语义):
 * - strict:实际调用序列与 expected 完全一致(含顺序与次数);
 * - unordered:与 expected 次数一致但顺序任意(多重集相等);
 * - subset:expected 是实际的多重集子集(期望动作必须全部发生,允许 agent 多做);
 * - superset:实际是 expected 的多重集子集(agent 不得越出期望清单做任何调用)。 */
export type TrajectoryMode = 'strict' | 'unordered' | 'subset' | 'superset'

/** 审批红线断言:期望 approval_flow 被命中(approval/asked 事件存在,可再要求结局)。 */
export interface ApprovalFlowAssert {
  /** approval/asked.toolName 需等于的工具名;缺省匹配任意审批。 */
  readonly tool?: string
  /** 需要存在的 decided 结局(与命中的 asked 按 id 配对)。 */
  readonly outcome?: ApprovalOutcomeLike
  /** 为 true 时,命中的审批关联的工具调用不得成功执行
   * (DSH 语义:被拒调用仍记 tool/call,但其 tool/result 带 error——按 callId 配对判成功与否)。 */
  readonly not_executed?: boolean
  /** 最少命中次数,默认 1。 */
  readonly min_count?: number
}

export interface TrajectoryAssert {
  readonly mode?: TrajectoryMode
  /** 期望的工具调用名序列(按 mode 匹配)。 */
  readonly calls?: readonly string[]
  /** 每个命名工具至少被调用一次(顺序无关)。 */
  readonly must_call?: readonly string[]
  /** 每个命名工具都不得被调用。 */
  readonly must_not_call?: readonly string[]
  /** step/start 事件数上限。 */
  readonly max_steps?: number
  readonly approval_flow?: ApprovalFlowAssert
}

export interface BudgetAssert {
  /** turn/start 事件数上限。 */
  readonly max_turns?: number
  /** assistant usage 总 token 上限(input+output+cacheRead+cacheWrite 口径)。 */
  readonly max_tokens?: number
}

export interface ReplayAdapterConfig {
  /** fixture 文件名;缺省 `<pack>/fixtures/<case-id>.jsonl`。 */
  readonly fixture?: string
}

export interface AcpAdapterConfig {
  readonly dsh_home?: string
  readonly provider?: string
  readonly model?: string
  readonly reasoning_effort?: string
  readonly max_tokens?: number
  /** 驱动超时秒数,默认 600。 */
  readonly timeout_seconds?: number
}

/** golden case(golden YAML 的解析产物)。 */
export interface GoldenCase {
  readonly id: string
  readonly description?: string
  readonly user_input: string
  readonly answer?: AnswerAssert
  readonly tags: readonly string[]
  readonly final_state: readonly FinalStateAssert[]
  readonly trajectory?: TrajectoryAssert
  readonly budget?: BudgetAssert
  /** 用哪个适配器跑;缺省 replay。 */
  readonly adapter?: 'replay' | 'acp'
  readonly replay?: ReplayAdapterConfig
  readonly acp?: AcpAdapterConfig
  /** 来源文件(报告引用)。 */
  readonly sourceFile: string
}

/** 失败原因分类(report.md 失败分类统计的口径)。 */
export type FailureCategory =
  | 'schema' // golden YAML 非法/加载失败
  | 'answer' // 期望答案未命中
  | 'final_state' // file/http/script 终态断言未过
  | 'trajectory' // 四模式/must_call/must_not_call/max_steps/approval_flow 未过
  | 'budget' // 轮数/ token 超预算
  | 'harness' // 适配器自身错误(fixture 缺失、驱动崩溃、超时…)
  | 'assert' // 断言器内部缺陷(评测器 bug,不应出现)

export interface FailureDetail {
  readonly category: FailureCategory
  readonly message: string
}

/** 适配器输入:runner 为每条 case 准备的执行环境。 */
export interface AgentRunInput {
  readonly caseData: GoldenCase
  readonly packDir: string
  /** 每 case 独立的临时工作区(适配器可往里物化终态文件)。 */
  readonly workspaceDir: string
  readonly signal?: AbortSignal
}

/** 适配器产物:一次 agent 会话的可断言视图。 */
export interface AgentRunResult {
  /** 会话引用(fixture 路径或真实 session id),写入 sessions.jsonl。 */
  readonly sessionRef: string
  /** 会话事件流(DSH SessionEvent 形态;按 seq 升序)。 */
  readonly events: readonly SessionEventLike[]
  /** 最终助手回答文本(最后一个 assistant/message 的 text 拼接)。 */
  readonly finalAnswerText: string
  /** 非致命说明(进报告备注,不构成失败)。 */
  readonly notes?: readonly string[]
}

/** AgentAdapter:可交换适配器接口(注册表 + 唯一 id;provide 可交换)。 */
export interface AgentAdapter {
  readonly id: string
  run(input: AgentRunInput): Promise<AgentRunResult>
}

/** 单条 case 的评测结果。 */
export interface CaseResult {
  readonly caseData: GoldenCase
  readonly status: 'pass' | 'fail'
  readonly failures: readonly FailureDetail[]
  readonly sessionRef: string
  readonly metrics: CaseMetrics
  readonly finalAnswerText: string
  readonly durationMs: number
  readonly notes: readonly string[]
}

/** 从会话事件流聚合的指标(sessions.jsonl / report.md 消费)。 */
export interface CaseMetrics {
  readonly turns: number
  readonly steps: number
  readonly toolCalls: readonly string[]
  readonly totalTokens: number
  readonly approvalAsks: number
  readonly eventCount: number
}

/** 整包运行结果。 */
export interface PackRunResult {
  readonly packDir: string
  readonly adapterId: string
  readonly subset?: string
  readonly startedAt: string
  readonly durationMs: number
  readonly results: readonly CaseResult[]
  /** schema 加载失败(不进入 results)的文件与原因。 */
  readonly loadErrors: readonly { file: string; message: string }[]
}
