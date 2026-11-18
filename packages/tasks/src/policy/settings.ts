/**
 * 运行时设置 schema、校验边界与分块保存面——SA/src/policy.ts 的 schema 半边拆出。
 *
 * 设计依据:34 号 §2.2 settings 行(`PolicyConfigSchema`/`RuleSchema`/`DEFAULT_RULES`
 * → 本文件)、limits 行(SA src/limits.ts 11 行常量内联,避免碎文件);35 号 A4;
 * 24 §8.3-1(zod 纪律:`.strict()` + `.describe()` + 默认值,模型面就是 API 面)。
 * ★改造(34 §2.2):SA `DEFAULT_RULES` 的编码场景示例规则(copy/visual)不搬运——
 * 规则默认空表,由领域包(26 号 §4 worker 声明段)与 hitl.yaml 供给。
 * ★realm 语义(34 §2.2;24 §5.2):一份 Settings 属于一个租户 realm,存储在租户库
 * (35 号 A11 store);`policy.sources` 的名单/准入表即「realm 内名单」。
 * 纯函数层不触碰 ctx 全局(Cordis 纪律,34 §2 通用要点④)。
 */
import { z } from 'zod'

/** 校验边界(SA src/limits.ts 内联,34 §2.2 limits 行):宿主 schema 与管理面板表单共用的界限。 */
export const LIMITS = {
  ruleName: 100,
  ruleInstruction: 2000,
  evalTimeoutSeconds: { min: 30, max: 600 },
  maxWorkers: { min: 1, max: 16 },
  prepareCommand: 4000,
  promptMaxChars: { min: 1000, max: 1_000_000 },
  admissionContextMaxPages: { min: 1, max: 100 },
  admissionContextTimeoutMs: { min: 1, max: 90_000 },
} as const

/** worker 运行所必需的命令(SA src/infra/environment.ts:18 内联):不得被 block——挡了它们等于挡掉全部工作。 */
const WORKER_COMMANDS: readonly string[] = ['gh', 'git', 'lark-cli']

/** 规则 id:字母数字下划线连字符,1–80 位(audit trace 与 Mandate.basis.rules 的稳定标识;assessment.ts 复用)。 */
export const RuleIdSchema = z.string().regex(/^[a-zA-Z0-9_-]{1,80}$/).describe('规则 id:字母/数字/_/-,1–80 位')

/** 一条评估规则;其指示也可规定 PR 审阅者与是否等待其批准。 */
export const RuleSchema = z.object({ id: RuleIdSchema, name: z.string().trim().min(1).max(LIMITS.ruleName), enabled: z.boolean(),
  instruction: z.string().trim().min(1).max(LIMITS.ruleInstruction) }).strict().describe('评估规则:id/名称/启停/指示文本')
export type Rule = z.infer<typeof RuleSchema>
/** 一个角色的模型选择(orchestrator/worker/评估模型)。 */
export const RoleModelSchema = z.object({
  provider: z.string().trim().min(1), model: z.string().trim().min(1), reasoningEffort: z.string().trim().min(1).optional(),
}).strict().describe('角色模型:供应商/模型名/推理力度(可选)')
export type RoleModel = z.infer<typeof RoleModelSchema>

/** 名单条目:Source 自有词汇里的身份(id)与可选显示名;比较大小写不敏感(gate.ts sameName)。 */
export const AllowedSchema = z.object({ id: z.string().trim().min(1).max(200), name: z.string().trim().max(100).optional() }).strict()
  .describe('realm 内名单条目:Source 侧身份 id + 可选显示名')
export type Allowed = z.infer<typeof AllowedSchema>
/** 未对准消息的两格不允许 explicit(见 admission.ts ADMISSION_OPTIONS),schema 层同步拒收。 */
const Weak = z.enum(['inferred', 'ignore'])
export const AdmissionRowSchema = z.object({ listedUnaddressed: Weak.optional(),
  unlistedAddressed: z.enum(['explicit', 'inferred', 'ignore']).optional(), unlistedUnaddressed: Weak.optional() }).strict()
  .describe('准入表一行(某接收 scope):按格覆写默认档')
export const AdmissionTableSchema = z.record(z.string(), AdmissionRowSchema).describe('准入表:行键为接收 scope(如会话行)')
/**
 * 某 Source 的策略分部:名单(allowed,★realm 内名单)、准入表,及 Source 自身的扩展键
 * (SA 原样经 catchall 透传,如 bots 名单——gate.ts listedBot 防御式解析)。
 * Source 自身的 config 不在这里(在 sources 块),「谁可以在该 Source 发起工作」也不映射到人跨 Source。
 */
export const SourcePolicySchema = z.object({
  allowed: z.array(AllowedSchema).default([]), admission: AdmissionTableSchema.default({}),
}).catchall(z.unknown()).describe('Source 策略分部:realm 内名单 + 准入表')
export type SourcePolicy = z.infer<typeof SourcePolicySchema>
/** 策略配置:评估规则表(★默认空表,示例规则不搬运)与各 Source 分部。 */
export const PolicyConfigSchema = z.object({
  rules: z.array(RuleSchema).refine(rules => new Set(rules.map(rule => rule.id)).size === rules.length, 'Duplicate rule IDs').default([]),
  sources: z.record(z.string().regex(/^[a-z][a-z0-9-]*$/), SourcePolicySchema).default({}),
}).strict().describe('策略配置:规则表(默认空)+ 各 Source 名单/准入表')
/** Eval 配置:受理档位(off/observe/auto,默认 observe)、超时与模型。 */
export const EvalConfigSchema = z.object({
  mode: z.enum(['off', 'observe', 'auto']).default('observe'),
  timeoutSeconds: z.number().int().min(LIMITS.evalTimeoutSeconds.min).max(LIMITS.evalTimeoutSeconds.max).default(120),
  model: RoleModelSchema.nullable().default(null),
}).strict().describe('Eval 配置:受理档位(默认 observe,B1 观察模式)/超时/模型')
/** 命令名:非 `.`/`..` 且不得为 worker 必需命令(WORKER_COMMANDS)。 */
const CommandNameSchema = z.string().regex(/^[A-Za-z0-9._-]+$/).refine(name => name !== '.' && name !== '..', 'Not a command name')
  .refine(name => !WORKER_COMMANDS.includes(name), `${WORKER_COMMANDS.join(', ')} cannot be blocked`)
/** 执行器设置:worker 模型、并发数、工单目录根(空 = `<stateDir>/work`)、prepare 命令与被禁命令。 */
export const ExecutorConfigSchema = z.object({
  model: RoleModelSchema.nullable().default(null),
  maxWorkers: z.number().int().min(LIMITS.maxWorkers.min).max(LIMITS.maxWorkers.max).default(3),
  directory: z.string().trim().refine(path => path === '' || path.startsWith('/'), 'An absolute path, or empty for <stateDir>/work').default(''),
  prepare: z.string().max(LIMITS.prepareCommand).default(''),
  blockedCommands: z.array(CommandNameSchema).default([]),
}).strict().describe('执行器:模型/并发上限/工单目录根/prepare 命令/被禁命令')
/** R1 单档预算上限(24 §5.5-R1;33 号 G2-A3「effort 三档分档上限可配」):缺省维度不设限(governance BudgetConfig 同语义)。 */
export const BudgetCapsSchema = z.object({
  maxTurns: z.number().int().min(1).optional(),
  maxTokens: z.number().int().min(1).optional(),
  maxCost: z.number().min(0).optional(),
}).strict().describe('effort 单档预算上限:maxTurns/maxTokens/maxCost(缺省维度不设限)')
/** effort 三档分档上限表(26 §4.1 effort 段「单工单成本上限」按档声明;35 号 A17 分档上限可配)。 */
const BudgetCapsByTierSchema = z.object({
  simple: BudgetCapsSchema.default({}), compare: BudgetCapsSchema.default({}), complex: BudgetCapsSchema.default({}),
}).strict().describe('effort 三档分档上限:simple/compare/complex 各一份')
/**
 * R1 预算守卫设置(24 §5.5-R1;24a C2 双轨拍板;33 号 G2-A3;35 号 A17):
 * - `caps`:三档分档上限(maxTokens/maxCost 硬截断的档位键,26 §4.1 effort 段供给档位);
 * - `pricing`:每百万 token 单价(技术侧 maxCost 记账口径;缺省不计成本,即 maxCost 不设限生效);
 * - `creditsPerMTokens`:token → 工单积分换算率——**部署配置,默认值未定**(35 号 §12-17:
 *   24a C2 拍板双轨、26 §7-3 单位统一未拍板覆盖),缺省不记积分轨,不发明换算默认。
 */
export const BudgetConfigSchema = z.object({
  caps: BudgetCapsByTierSchema.default(() => BudgetCapsByTierSchema.parse({})),
  pricing: z.object({ inputPerMTokens: z.number().min(0), outputPerMTokens: z.number().min(0) }).strict().optional(),
  creditsPerMTokens: z.number().min(0).optional(),
}).strict().describe('R1 预算守卫:effort 三档上限/计价/双轨换算率(部署配置)')
/**
 * R2 门禁触发配置(24a A2 拍板分层;33 号 G2-A4「两层的触发配置入库」;35 号 A15):
 * 结构校验层**每单必跑**,不是配置项——入库的只有金集 replay 抽样层的触发面:
 * `highRiskRules` 列出高风险工单的命中规则 id(hitl.yaml R3 红线规则,26 §4.1),
 * 其 Mandate basis.rules 命中任一的工单被抽样进金集 replay;发布门禁全跑在包流水线
 (dsh-evals --adapter replay),不在每租户设置内。
 */
export const GatesConfigSchema = z.object({
  highRiskRules: z.array(RuleIdSchema).default([]),
}).strict().describe('R2 门禁触发配置:高风险抽样规则集(结构校验每单必跑,不属配置)')
export type BudgetCaps = z.infer<typeof BudgetCapsSchema>
export type BudgetSettings = z.infer<typeof BudgetConfigSchema>
export type GatesSettings = z.infer<typeof GatesConfigSchema>
/** 某 Source 实例的启停与自由配置(config 形状由 Source kind 自定)。 */
export const SourceInstanceSchema = z.object({
  enabled: z.boolean().default(true), config: z.record(z.string(), z.unknown()).default({}),
}).strict().describe('Source 实例:启停 + kind 自有配置')
/**
 * 设置总 schema(严格模式):暂停、各 Source 实例、策略、Eval、执行器、R1 预算守卫与
 * R2 门禁触发配置。每个键都有默认值——`SettingsSchema.parse({})` 产出全默认的一份
 * (realm 租户库的出厂形态;budget.pricing/creditsPerMTokens 可选缺席,默认未定不发明)。
 */
export const SettingsSchema = z.object({
  paused: z.boolean().default(false),
  sources: z.record(z.string().regex(/^[a-z][a-z0-9-]*$/), SourceInstanceSchema).default({}),
  policy: PolicyConfigSchema.default(() => PolicyConfigSchema.parse({})),
  eval: EvalConfigSchema.default(() => EvalConfigSchema.parse({})),
  executor: ExecutorConfigSchema.default(() => ExecutorConfigSchema.parse({})),
  budget: BudgetConfigSchema.default(() => BudgetConfigSchema.parse({})),
  gates: GatesConfigSchema.default(() => GatesConfigSchema.parse({})),
}).strict().describe('任务内核设置(严格模式,按租户库存储)')
export type Settings = z.infer<typeof SettingsSchema>
/** 可分块保存的块:策略 / Eval / 执行器 / 预算 / 门禁 / 某 Source(`source:<name>`)。 */
export type SettingsBlock = 'policy' | 'eval' | 'executor' | 'budget' | 'gates' | `source:${string}`
/** 一次保存动作的目标:某块,或暂停切换。 */
export type SettingsSave = SettingsBlock | 'pause'
/** 保存来源:管理面板 / 模型工具 / 同步。 */
export type SettingsOrigin = 'panel' | 'tool' | 'sync'
