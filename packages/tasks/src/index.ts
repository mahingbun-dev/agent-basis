/**
 * @eterna/tasks —— 任务内核(Tier2 super 专属,31 号双形态治理;base 形态不挂载)。
 *
 * 设计依据:24 号 §5(架构与不变量)/§5.5(R1–R6 实施契约)、24a 拍板记录、
 * 27 号(冲突五机制与三层权力)、28 号(上下文策略)、34 号(包详细设计 §1 目录树)、
 * 35 号(A1 包骨架;后续 A3–A27 逐件落地)。
 *
 * 分层(Cordis 纪律,对齐 packages/governance/src/index.ts:1-13 先例):
 * - src/core/:领域内核目录(零 I/O、零外部依赖;SA/src/core 整体移植落点,34 §2.1)。
 *   A3–A9 已落地(model/ids/reasons/errors/stage/memory + engine/ports/part 五部件);
 * - src/store/:一租户一 SQLite 持久化(35 号 A11;34 号 §2.3)——Store(Repositories
 *   实现 + settings 版本史 + 回执)、schema 守卫、只读视图 reads、类型化 KV、
 *   TasksRealmRouter(realm → Store 的 LRU 池,23 号 §3.1 同构);
 * - src/effects/:持久副作用(35 号 A12/A13)——Effects 队列(健康面机制并入)、
 *   Outbox 回执投递(投递面经 ChannelsDelivery 端口接 channels 适配器);
 * - src/executor/:执行层(35 号 A14)——DshExecutor(去 worktree:R4 每工单
 *   `.ticket/<id>/` 目录 + 每工单一条 `worker-<ticketId>` DSH session;launch/delivery
 *   经 Effects、WorkerSlots 并发、四类宿主事件)、background(untilQuiet/stopBackground/
 *   jobs 收集)、slots(WorkerSlots + 插队计数);
 * - src/session/:会话面(35 号 A22/A23)——Sessions 的 ensure/prompt/promptedId/relay/holds
 *   契约,按本仓 DSH session 面(agents 注册表)重写;Prompts 双角色中文 prompt 资产
 *   装配、配置版本史与版本绑定每次模型请求、团队覆盖不漂移;
 * - src/plugin.ts:插件装配(35 号 A16)——createTasks() 真实装配(启动顺序
 *   store→effects→outbox→engine→assessor→executor→sources,sources 留接口位;关停配逆)、
 *   defineTasksPlugin(apply(ctx) 以 TASKS_SERVICE_ID provide ctx.tasks 服务,可配逆)、
 *   健康面/状态面(health()/stats(),供工作台与探针)与 assessor/executor 可控 stub
 *   (★A19/A22 替换点);
 * - 本文件:门面 re-export + createTasks() 装配入口。
 *
 * Cordis 纪律:组合层把 createTasks() 产物以 `ctx.tasks` 服务(注册表 + TASKS_SERVICE_ID
 * 唯一 ID)provide、可配逆——装配已由 35 号 A16(src/plugin.ts)落地。
 *
 * DSH seam 形态的编译期钉住见 tests/types.seam-pin.ts。
 */
export * from './core/index.ts'
// 策略与准入层(35 号 A4;34 号 §2.2):准入矩阵/SettingsSchema/策略门(名单注入口)/
// 评估转译(R3 四要素)/规则内容 hash 版本化(24a C3)。
export * from './policy/index.ts'

// 持久化与副作用层(35 号 A11–A13;34 号 §2.3):一租户一 SQLite Store + realm 路由、
// Effects 持久队列(健康面机制并入)、Outbox 回执投递(投递面换 channels 适配器端口)。
// Outbox 实现类以 ChannelOutbox 别名转出:core 端口已占名 Outbox(Engine 的回执面),
// 本类是其 channels 投递实现(A13「投递端换 channels」的命名落点)。
export {
  assertRealmName, defaultTenantRoot, tasksDbPath, Store,
  type Dropped, type DropReason, type Receipt, type SettingsVersion, type StoreOptions, type TimelinePlace,
} from './store/store.ts'
export { KV, type Family, type Key } from './store/kv.ts'
export { OLDEST_SCHEMA, SCHEMA_VERSION, tooOld } from './store/schema.ts'
export { storeReads } from './store/reads.ts'
export { TasksRealmRouter, type TasksRealmRouterOptions } from './store/realm.ts'
export {
  Effects, FAILURES_BEFORE_ERROR, HealthBoard, Later,
  type EffectKind, type EffectPayloads, type Health, type HealthEntry,
} from './effects/effects.ts'
export { Outbox as ChannelOutbox, type ChannelsDelivery, type OutboxHost } from './effects/outbox.ts'

// 执行层与会话面(35 号 A14/A22;34 号 §2.4/§2.5):DshExecutor(launch/delivery 经
// Effects、WorkerSlots 并发、四类宿主事件)、后台工作停止与收集、worker session 的
// ensure/prompt/promptedId/relay/holds 投递面。
export {
  DshExecutor, batchLine, batchOf, inputMessage, inputResource, resultRelay, sourceTrigger,
  ticketExecution, ticketOfSession, transient, triggerMessage, workerSessionId,
  type ExecutorHost,
} from './executor/dsh.ts'
export { WorkerSlots } from './executor/slots.ts'
export {
  cancelled, collectJob, killJobs, runningJobs, stopBackground, stopSubagents, until, untilQuiet,
} from './executor/background.ts'
// R4 工单工作区与 R2 分层门禁(35 号 A15;24 §5.5-R4/R2、24a A2 拍板):`.ticket/<id>/` 布局
// 与主 Session 读文件面、deliverable 结构校验(每单必跑)与金集 replay 抽样(replay 面经端口,
// glue 适配 @eterna/evolve gates)、Mandate 执行契约条款(「ready=门禁通过」不可自述绕过)。
export {
  TICKETS_DIR, TICKET_FILES, readTicketFile, ticketDir, ticketFile,
  type TicketFileKind,
} from './executor/workspace.ts'
export {
  DEFAULT_DELIVERABLE_SPEC, GATE_CONTRACT_CLAUSE, GATE_STRUCTURE_REASON, TicketGates, UNWIRED_REPLAY_GATE,
  checkDeliverable, formatFindings, sampleReplay, ticketFileReader,
  type DeliverableFileSpec, type DeliverableSpec, type GateFinding, type GateReportResult, type ReplayGate,
} from './executor/gates.ts'
// R1 预算守卫接线(35 号 A17;24 §5.5-R1、24a C2 双轨):effort 三档 → governance BudgetGuard
// 的分档上限映射、token→工单积分换算(部署配置,默认未定不发明)、工单级守卫档与双轨用量面。
export {
  budgetUsage, effortGuide, ticketBudget, ticketBudgetEntry, toCredits,
  type TicketBudgetEntry, type TicketBudgetUsage,
} from './executor/budget.ts'
// D1 subagent_policies(35 号 A18;24a D1 拍板;26 §4.1 worker 段):声明段消费面 types seam
// (不预设 YAML 格式)、默认只读 reviewer 类(引用 @eterna/extra reviewer preset 平台资产)、
// worker 派生 subagent 的借权约束门(借权不越 Mandate,不改内核)。
export {
  DEFAULT_SUBAGENT_POLICIES, REVIEWER_PRESET_ID, SubagentPolicyViolation, constrainForWorker,
  resolveSubagentPolicy, validateSubagentPolicies,
  type ConstrainedSpawn, type SubagentPolicies, type SubagentPolicy, type SubagentSpawnIntent,
} from './executor/subagent-policies.ts'
export { Sessions, messageId, type SessionHostPorts, type SessionRole, type SessionsHost } from './session/sessions.ts'

// Source 端口与 channels 适配(35 号 A21;34 号 §2.5 port/channel-adapter 两行、§0-A5):
// Trigger 归一化契约与 SourceScope 契约位(注册表与轮询不搬,channels 是统一接收面)、
// channels 事件 → Engine 的被动汇(channel_user 收敛身份透传、幂等 id 以 core key() 重派、
// PR 生命周期转发落 bindThread/threadClosed)。对 @eterna/channels 仅类型依赖(34 §1 依赖方向行)。
export {
  normalizeChannelTrigger, threadRefOf, ChannelTriggerAdapter, applyLifecycleForwards,
  type ChannelAdapterHost,
} from './sources/channel-adapter.ts'
export type { SourceSink } from './sources/port.ts'
export type { ChannelsLifecycleForward, ChannelsThreadRefAligned, ChannelsTriggerAligned, SourceSinkIsTriggerSink } from './sources/port.ts'
export type { ScopeResult as SourceScopeResult, SourceScope as SourceScopePort } from './sources/port.ts'

// prompt 资产与装配面(35 号 A23;34 号 §1 prompts/ 行、§2.5 prompts 行、§4-D):
// 双角色中文 prompt 资产(prompts/ 12 件)、分段装配、Policy/执行环境生成段、
// 配置版本史与每次模型请求的版本绑定(24 §8.1-4)、团队覆盖不漂移(base 留档)。
export {
  admissionPolicy, builtInBase, builtInPart, builtInParts, composePrompt, defaultPrompts, environmentSection,
  guides, handoffPolicy, orchestratorPrompt, PART_KEYS, policySection, promptFile, promptParts, Prompts,
  PromptConflict, sharedPrompt, SKILL_NAME, TEAM_SECTIONS, workerPrompt,
  type BuiltInPart, type DefaultChange, type PartKey, type PromptConfig, type PromptPart, type PromptVersion, type TeamSection,
} from './session/prompts.ts'

// 候选评估与决策局部化(35 号 A19;34 号 §2.5 assessor/candidate 两行):候选卡的有界事实
// (threadWindow 前 5 + 前后各 5、400/1200/50、related_tickets ≤8 open 优先 + tickets_total、
// policy_version——Engine 计算不靠模型记忆)、MasterAssessor(per-eval 状态隔离/release
// 清理/'assessment' 候选卡投递/TextCache)及其 TriggerContext 端口。
export {
  admissionContext, cut, decisionCard, preview, relatedTickets, textPage, threadCard, threadWindow,
  TICKET_STATES, ticketCard, triggerCard, TRIGGER_CHARS, NEAR_CHARS, STUB_CHARS, RELATED_TICKETS,
  WINDOW_CHARS, ADMISSION_CONTEXT_MAX_PAGES, windowProjection,
} from './session/candidate.ts'
export type { TicketCardState } from './session/candidate.ts'
export {
  AssessmentSchema, EvalReadSchema, MasterAssessor, TextCache,
  type Assessment, type AssessorHost, type ContextMessage, type EvalRead, type ThreadPage, type TriggerContext,
} from './session/assessor.ts'

// 工具面(35 号 A20;34 号 §2.5 tools 行、§1 tools 两行):orchestrator 14 工具(只读+路由+
// 评估,无实现权工具)与 worker 6 工具(report/handback/mark_unrelated…)——四纪律
// (zod .strict()+默认值+.describe()、描述给资源语法、执行必接 AbortSignal、按角色分面,
// 24 §8.3),defineTool seam 适配(zod → 宿主 ToolDefinition,注册即 ctx.tools.register、
// disposer 进 ctx.effect,35 号表⑤-7)与 R4 资源读取面(orchestrator_read 读
// .ticket/<id>/ 文件,24 §5.5-R4)。
export { IM_WORDS, NOTE_WORDS, readTool, toDshTool, tool, wordCount, type Tool } from './tools/tool.ts'
export { RESOURCES, readResource, resourceGrammar, type ResourceHost } from './tools/resources.ts'
export { orchestratorTools, WorktreeNameSchema, type OrchestratorToolsHost } from './tools/orchestrator.ts'
export { workerTools, type WorkerToolsHost } from './tools/worker.ts'

// [active-tickets] 活跃工单清单 section 与 preset 声明常量(35 号 A24/A25;34 号 §2.5
// sections 行、§1 cordis.patch.yml 行):一行一单( id+标题截断+stage+等谁 )、20 行折叠、
// pass 周期刷新的 section 面;cordis.patch.yml 两组 preset 的 config.id 单一真值。
export {
  ACTIVE_TICKETS_HEADING, ACTIVE_TICKETS_MAX_LINES, ACTIVE_TICKETS_SECTION_NAME, ACTIVE_TICKETS_SECTION_ORDER,
  ACTIVE_TICKETS_TITLE_MAX_CHARS, activeTicketsFace, activeTicketsFoldLine, activeTicketsSection, renderActiveTickets,
  type ActiveTicketsRenderOptions, type ActiveTicketsSection, type ActiveTicketsSource,
} from './session/sections.ts'
export {
  COMPACTION_ROW_ORDER, CORDIS_PATCH_FILE, ORCHESTRATOR_PRESET_ID, WORKER_PRESET_ID,
} from './session/presets.ts'

// 插件装配(35 号 A16;34 号 §1 plugin.ts 行):createTasks() 真实装配(store→effects→outbox
// →engine→assessor→executor→sources,关停配逆)、defineTasksPlugin(ctx.tasks 服务 provide,
// TASKS_SERVICE_ID 唯一)、健康面/状态面(assessor 已于 A19 接线 MasterAssessor;
// executor 于 A22 接线真实 DshExecutor+Sessions——TasksOptions.sessionHost 注入即替换
// 可控 stub,sources 于 A21 接线 channels 入站汇)。
export {
  createTasks, defaultTasksDirOf, defineTasksPlugin, DEFAULT_TASKS_REALM,
  PASS_INTERVAL_MS, StubExecutor, TASKS_PLUGIN_NAME, TASKS_SERVICE_ID,
} from './plugin.ts'
export type {
  ExecutorCall, TasksHealth, TasksOptions, TasksPluginConfig, TasksRuntime, TasksSnapshotView, TasksStats, TasksWorld,
} from './plugin.ts'
// DSH bundle loader 取 default export 插件实例(profiles/eterna-super/cordis.patch.yml 的
// eterna-tasks 行 name 指向包根 exports ".";panel/llm-doctor 包根 default 同款形态)。
export { default } from './plugin.ts'
