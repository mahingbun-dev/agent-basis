# 34 - tasks 包详细设计（草案）

> 状态：**详细设计草案 / 待评审**。本文把 `dsh-superagent-prototype` 领域内核的移植方案落成可开工的工程设计：包结构、逐文件模块映射、Engine 角色接口、59 个 spec 的测试承接、与横切包的接线点。
> 定位：24 号（融合架构与 R1–R6 契约）· 24a 拍板记录（realm 进内核、一租户一 SQLite、R2 分层验收等）· 27 号（执行者权力结构与冲突机制）· 28 号（压缩组与活跃工单清单）之后的 **WS-A tasks 内核工作流**（32 号 §工作流划分）的实施蓝图。tasks 为 **Tier2（super 专属）包**（31 号双形态治理拍板）。
> 关联：`23-记忆多租户分库设计.md`（per-account store 池先例）· `25-业界架构对照与缺陷清单.md`（R1–R6 外部依据）· `26-扩展模型-插件领域包与专业agent.md`（worker 声明段 / D1 subagent_policies）· `30-Subagent工作台与可视化监控.md`（面板承接方）· `packages/interact`、`packages/governance`、`packages/access`、`packages/channels`（接线对端）。
> 源码基线：`dsh-superagent-prototype`（本工作区副本，路径下文简称 `SA/`）；本仓包风格基线：`packages/interact`、`packages/governance`。
> 日期：2026-11-17

---

## 0. 范围与不做什么

**做**：`packages/tasks` —— 移植 `SA/src/core/`（零 I/O 领域内核）+ `src/admission.ts` / `src/policy.ts`（策略与准入）+ `src/app/effects.ts` / `src/app/outbox.ts` / `src/app/store.ts`（持久副作用与存储）+ `src/executor/dsh.ts` / `src/executor/background.ts`（执行器）+ 主会话评估面（`src/app/assessment.ts` / `prompts.ts` / `tools/`），按 24a 拍板加 realm 维度与 R1–R6 契约落地。

**不做**（24 号 §8.2 不采纳清单 + 24a A5）：
- 不移植 `SA/src/client/`、`SA/src/app/views/`、`SA/src/app/http.ts`、`SA/src/app/cards.ts` 等面板与 HTTP 层——由 30 号 subagent 工作台承接；
- 不移植 `SA/src/sources/feishu*.ts`、`github*.ts` 的具体 Source 实现——channels 是统一接收面，tasks 只实现 **Source 适配端口**（A5 拍板：channels 统一接收面 + Source 扩展钩子）；
- 不照搬 git worktree（`SA/src/executor/dsh.ts:57` 的 `ticketWorktreeName` 是编码场景假设）；
- 不装 superagent bundle、不新建独立页面。

---

## 1. 包结构（packages/tasks/src 目录树）

```
packages/tasks/
├── package.json                  # @eterna/tasks，Tier2；exports ".": "./src/index.ts"
│                                 #   verify = oxlint --config ../../.oxlintrc.json . && tsc --noEmit && vitest run
│                                 #   （对齐 packages/interact/package.json scripts）
├── cordis.patch.yml              # 本包对 DSH 的 preset 声明：orchestrator / worker 两组
│                                 #   （压缩组挂 @eterna/compaction 四件套，28 号 §3）
├── prompts/                      # prompt 资产（版本化，每次模型请求绑定版本）
│   ├── orchestrator.md           # ← SA/prompts/orchestrator.md（主会话总纲）
│   ├── dispatch.md               # ← SA/prompts/dispatch.md（accept/attach/stop/ignore 四动作）
│   ├── worker.md                 # ← SA/prompts/worker.md（六态报告纪律）
│   ├── shared.md / replies.md / subscriptions.md / handoff-*.md / admission.md / work.md
│   └── VERSIONS.md               # prompt 版本清单（对应 SA/src/app/versions.ts 的数据面）
├── src/
│   ├── index.ts                  # 门面：re-export + createTasks() 装配入口（Cordis 纪律见 §2 风格行）
│   ├── core/                     # ★ 领域内核（零 I/O、零外部依赖，SA/src/core 整体移植）
│   │   ├── model.ts              # 领域模型与不变量谓词（+realm 维度，见 §2）
│   │   ├── ports.ts              # Policy/Assessor/Executor/Outbox/Repositories/DomainEvents 端口
│   │   ├── engine.ts             # Engine：单写者事务入口 + 五个角色 Pick 接口
│   │   ├── part.ts               # EnginePart 基类与 EngineOptions
│   │   ├── intake.ts             # Trigger 摄取 / 去重 / 订阅扇出 / Eval 排队
│   │   ├── evals.ts              # Thread 级评估批次 / Decision / Mandate 固化
│   │   ├── tickets.ts            # Ticket 生命周期 / Subscription / 唤醒 / 交接
│   │   ├── assignments.ts        # Assignment 生命周期 / 六态报告 / Attention
│   │   ├── replies.ts            # Outbox 回执消息的规则（ack/answer/result/attention）
│   │   ├── reasons.ts            # Reason 码表（审计可读的裁决理由）
│   │   ├── errors.ts             # UserError + USER_ERRORS 码表
│   │   ├── ids.ts                # 内容派生稳定 id（幂等键，27 号机制②）
│   │   ├── stage.ts              # ticketStage / canRetry（阶段分类，侧栏看板用）
│   │   ├── memory.ts             # MemoryRepositories（测试与临时实例用）
│   │   └── index.ts
│   ├── policy/                   # 策略与准入（SA/src/policy.ts 拆分 + SA/src/admission.ts）
│   │   ├── admission.ts          # 准入矩阵三格 × 三档（SA/src/admission.ts:8-13）
│   │   ├── settings.ts           # SettingsSchema（zod）+ SettingsBlock/Origin
│   │   ├── gate.ts               # settingsPolicy：gate / revalidate / admitsInferred
│   │   ├── assessment.ts         # assessmentOutcome + AdmissionDirection 校验 + R3 四要素
│   │   └── version.ts            # policyVersion = 规则内容 hash（24a C3 拍板）
│   ├── store/                    # 持久化：一租户一 SQLite（24a A1 拍板）
│   │   ├── store.ts              # Store（Repositories 实现 + settings 版本史 + receipts）
│   │   ├── schema.ts             # SCHEMA_VERSION / OLDEST_SCHEMA / 迁移（← SA/src/app/migration.ts）
│   │   ├── reads.ts              # 只读视图查询（← SA/src/app/store-read.ts）
│   │   ├── kv.ts                 # 类型化 KV（← SA/src/kv.ts）
│   │   └── realm.ts              # TasksRealmRouter：realm → Store 实例（LRU 池，23 号方案 C 同构）
│   ├── effects/                  # 持久副作用（事务内排队、提交后执行、失败退避）
│   │   ├── effects.ts            # Effects 队列（← SA/src/app/effects.ts）
│   │   └── outbox.ts             # Outbox 回执投递（← SA/src/app/outbox.ts，send 面改接 channels）
│   ├── executor/                 # 执行层
│   │   ├── dsh.ts                # DshExecutor（去 worktree；launch/delivery 经 Effects）
│   │   ├── slots.ts              # WorkerSlots（并发槽：maxWorkers + 人可插队 +1）
│   │   ├── background.ts         # untilQuiet / stopBackground / jobs 与 subagent 收集（← SA 同名）
│   │   ├── workspace.ts          # ★ R4：一工单一目录 + .ticket/<id>/ 产物布局约定
│   │   └── gates.ts              # ★ R2：ready 门禁适配（结构校验调用 + 金集 replay 触发）
│   ├── session/                  # 主会话（orchestrator）与 worker 会话管理
│   │   ├── assessor.ts           # MasterAssessor（← SA/src/app/assessment.ts）
│   │   ├── candidate.ts          # 候选卡构造：bounded 事实 + related_tickets ≤8（← admission-context）
│   │   ├── sessions.ts           # worker session ensure/prompt/relay（← SA/src/app/sessions.ts 适配）
│   │   └── sections.ts           # ★ 28 号 §6：活跃工单清单 system prompt section（pass 周期刷新，C6）
│   ├── tools/                    # 工具面（defineTool，注册进 ctx.tools 返回 disposer 进 ctx.effect）
│   │   ├── orchestrator.ts       # 主会话 14 工具面（decide/attach/read/report…）
│   │   └── worker.ts             # worker 6 工具面（report/handback/mark_unrelated…）
│   ├── sources/                  # Source 端口与 channels 适配
│   │   ├── port.ts               # Trigger 归一化契约 + SourceScope（← SA/src/sources/kind.ts/host.ts 的接口面）
│   │   └── channel-adapter.ts    # channels 事件 → Trigger（幂等 id 派生）；PR 生命周期类走扩展钩子（A5）
│   └── plugin.ts                 # 装配：createTasks() → ctx.tasks 服务（注册表 + TASKS_SERVICE_ID）
└── tests/                        # §4 承接表；类型 seam 钉住见 tests/types.seam-pin.ts（本仓惯例）
```

依赖方向（31 号单向铁律）：`tasks` → `core/`(纯函数) ← 无外部；`tasks` 可依赖 `@eterna/compaction`（preset 引用名）、`@eterna/interact`/`governance`/`access`/`channels` 的**类型与纯函数**（接线经端口注入，不直接 import 服务实例）；base 形态不挂载 tasks。

---

## 2. 模块映射表（superagent 源文件 → 目标路径 → 改造要点）

> 行号均指本工作区 `SA/` 副本实测。「TS 风格对齐本仓」通用要点（适用所有行，不逐行重复）：
> ① 包名 `@eterna/tasks`，package.json `description` 用中文并标注设计文档编号（对齐 `packages/interact/package.json` 写法）；
> ② `.ts` 扩展名 ESM 导入（两仓一致，无需改动）；
> ③ 模块头 `/** … */` 注释从英文改中文并标注设计依据（对齐 `packages/governance/src/index.ts:1-13` 风格）；
> ④ Cordis 纪律：策略纯函数层不触碰 ctx 全局，实例态挂 `createTasks()` 产物，组合层以 `ctx.tasks` 服务（注册表 + `TASKS_SERVICE_ID` 唯一 ID）provide、可配逆（对齐 interact/governance 的纪律声明）；
> ⑤ 每个类与公开函数保 JSDoc（`SA/tests/class-docs.spec.ts` 纪律保留为本仓测试）；
> ⑥ zod schema 用 `.strict()` + `.describe()` + 默认值（24 号 §8.3 工具纪律，`SA/src/policy.ts:13-105` 已是此风格）。

### 2.1 领域内核（SA/src/core/ → packages/tasks/src/core/）

| SA 源文件（行数） | 目标路径 | 改造要点 |
|---|---|---|
| `src/core/model.ts`（353） | `src/core/model.ts` | **realm 维度**（A1 拍板「realm 进内核模型」）：`Mandate`（model.ts:126-133）与 `Ticket`（model.ts:277-308）增加必填 `realm: string`；`ThreadRef`/`Trigger` 不加（Source 事件天然带渠道与租户上下文，由 intake 时从 SourceScope 注入 realm 再落库，见 intake 行）。谓词 `followupOwners`（model.ts:75-88）与 `waitsForPerson`（model.ts:349-353）**原样保留**——P0 Attention 台账与 28 号 §6「等谁」可见化都建在其上。`Ticket.attention`（model.ts:275）映射 interact 审批卡的超集（R5，见 §5-interact）。 |
| `src/core/engine.ts`（270） | `src/core/engine.ts` | 唯一事务写入者原样保留（27 号机制①单写者：`repo.atomic` 包裹每个命令，engine.ts:48-257）。五个角色 Pick 接口（engine.ts:261-270）签名不变、见 §3。`evaluateDue` 的 pass 驱动（engine.ts:75-85）由本仓 pass 周期调用（对齐 28 号 C6「pass 周期刷新」节奏）。 |
| `src/core/ports.ts`（134） | `src/core/ports.ts` | `Policy` 端口（ports.ts:16-27）实现方从 SA 的 `settingsPolicy` 换为本仓 `policy/gate.ts`（governance 规则版本注入，见 §5-governance）；`Executor`（ports.ts:59-69）与 `Outbox`（ports.ts:76-83）端口不变；`DomainEvents`（ports.ts:86-102）增加 `ticket.ended` 载荷 `realm` 字段——记忆整固钩子与 observe 冲突指标按 realm 归账。`Repositories`（ports.ts:105-134）全同步契约保留（atomic 可串行化的根基）。 |
| `src/core/part.ts`（80） | `src/core/part.ts` | `EngineOptions`（part.ts:7-18）增加 `realmOf: (trigger: Trigger) => string` 注入项（intake 落库时标注 realm）；`prepareTicket` 钩子保留（executor 用它写入 execution 元数据，part.ts:15）。 |
| `src/core/intake.ts`（63） | `src/core/intake.ts` | `receive`（intake.ts:19-62）幂等三态 `stored/duplicate/filtered` 原样保留（27 号机制②幂等键 + D2 冲突指标的数据源）。改造：Trigger 保存前用 `realmOf` 标注 realm（A1）。 |
| `src/core/evals.ts`（340） | `src/core/evals.ts` | `decide` 的 inferred 只在 auto 档可 accept（evals.ts:152-154）——对接 24a B1「主动巡检仅观察模式」：observe 档全量记录 `would_accept`（policy.ts:55-58 同语义保留）。`accept` 固化 Mandate（evals.ts:306-316）增加 realm 字段。**R3 落点**：`AssessmentOutcome.accept`（ports.ts:44-45）扩展为必须携带四要素（objective/output format/tool guidance/task boundaries），缺失在 `decide` 抛 `UserError('delegationIncomplete')`——比 SA 的卡片约定更硬（25 号证据：模糊委派是重复劳动首因）。 |
| `src/core/tickets.ts`（423） | `src/core/tickets.ts` | **27 号机制④权力层级**：`policyChanged`（tickets.ts:200-208）只注入 `policy-changed` Input、不撤销 Mandate——原样保留（C3「在跑工单钉旧版，新规则只影响新工单」的内核保证）。`wake`/`refuse` 的 Mandate revalidate（tickets.ts:252-270）保留。`attach`（tickets.ts:121-144）是 27 号情况 B「合并请求替代竞速」的落点，不改。 |
| `src/core/assignments.ts`（140） | `src/core/assignments.ts` | `report`（assignments.ts:99-134）六态 + Attention 生命周期原样保留；**R2 落点**：`ready` 报告在 Engine 内部不改，门禁挂在 executor/gates.ts（Assignment 层记 `report.state='ready'` 前的判定由执行器侧完成，Engine 保持纯域）；A2 拍板「结构校验每单必跑 + 金集 replay 仅发布门禁与高风险抽样」在 gates.ts 分层实现（见 §2.3）。 |
| `src/core/replies.ts`（95） | `src/core/replies.ts` | 四种 purpose 规则（replies.ts:14-18）与幂等 id 原样保留；投递面从 SA SourceRegistry 换 channels（§5-channels）。 |
| `src/core/reasons.ts`（38）/ `errors.ts`（61）/ `ids.ts`（5）/ `stage.ts`（26）/ `memory.ts`（50）/ `index.ts`（10） | 同名 | 原样移植。`ids.ts` 内容派生 hash（27 号幂等键基石）；`stage.ts` 的 `ticketStage`（stage.ts:9-21）供 30 号看板分组。 |

### 2.2 策略与准入（SA/src/admission.ts + policy.ts → src/policy/）

| SA 源文件 | 目标路径 | 改造要点 |
|---|---|---|
| `src/admission.ts`（13） | `src/policy/admission.ts` | 三格三档矩阵与 `ADMISSION_DEFAULTS`（admission.ts:8-13）原样。**维度升级**：准入表按租户分 realm——`SourcePolicy.allowed` 的语义从「单团队名单」改为「realm 内名单」，存储在租户库（A1 一租户一 SQLite 使然），allowed list 数据源对接 access 用户表（§5-access）。 |
| `src/policy.ts`（242）——`PolicyConfigSchema`/`RuleSchema`/`DEFAULT_RULES`（policy.ts:62-82） | `src/policy/settings.ts` | schema 拆出；`DEFAULT_RULES` 的编码场景示例规则（copy/visual）**不搬运**，默认空表 + 由领域包（26 号 §4 worker 声明段）与 hitl.yaml 供给。 |
| `src/policy.ts:111-118` `policyVersion` | `src/policy/version.ts` | **C3 拍板**：版本 = 规则内容 hash（SA 已是 `key(POLICY_REVISION, JSON.stringify(...))` 内容派生，语义吻合）；改造点是把「规则」的定义从 SA settings.rules 扩为 **governance rules.yaml + hitl.yaml + tasks 准入表** 的联合 hash，由 glue 层在热改时重算并调 `Engine.policyChanged`（§5-governance）。 |
| `src/policy.ts:143-165` `policyEffects` | `src/policy/gate.ts` | 保留「规则变更→逐工单算 effect→只通知不撤销」的结构；effect 判定输入接 governance 规则版本对照。 |
| `src/policy.ts:167-242` `settingsPolicy` | `src/policy/gate.ts` | `gate`/`revalidate`/`admitsInferred` 逻辑保留；`allowed` 名单查询从 settings 改为 access 用户 + realm 准入表联合判定（24 号 §5.2「allowed list = access 用户；准入表按租户分 realm」）。 |
| `src/policy.ts:25-61` `assessmentOutcome` + `AdmissionDirection` | `src/policy/assessment.ts` | **R3 落点**：`AdmissionDirection`（implementation_requested/target_basis/requires_design_decision/evidence）之上增加委派四要素必填校验；`would_accept` 观察模式语义保留（B1）。 |
| `src/limits.ts`（11） | `src/policy/settings.ts` 内联 | LIMITS 常量并入 settings，避免碎文件。 |

### 2.3 持久化与副作用（SA/src/app/ → src/store/ + src/effects/）

| SA 源文件 | 目标路径 | 改造要点 |
|---|---|---|
| `src/app/store.ts`（291） | `src/store/store.ts` | **A1 拍板「一租户一 SQLite」**：构造签名增加 realm（路径派生自 `$DSH_HOME/workspaces/<账号>/`，T1 铁律，23 号 §1 证据）；表结构（trigger/disposition/thread/ticket/decision/outbox/trigger_thread/effect/kv，store.ts:71-87）、生成列工作集（store.ts:30-44）、savepoint 嵌套 atomic + afterCommit（store.ts:133-162）**原样保留**——这是 27 号机制①的物理基础。settings 版本史（store.ts:183-199）保留。 |
| `src/app/migration.ts` | `src/store/schema.ts` | 迁移机制保留；**schema 前向守卫**（31 号拍板）：`SCHEMA_VERSION` 提升纳入双 tag 发布检查，`tooOld` 拒开策略保留（store.ts:66-67）。本仓首版直接建 v1（不搬 SA 的 schema 10→11 迁移史）。 |
| `src/app/store-read.ts` | `src/store/reads.ts` | 只读视图原样；查询全部带 realm 隐含（一库一 realm，天然过滤，无需 SQL 改造——A1 选内嵌而非外层过滤的理由，24 §9-3）。 |
| `src/kv.ts`（58） | `src/store/kv.ts` | 原样。 |
| （新增） | `src/store/realm.ts` | `TasksRealmRouter`：realm → Store 的 LRU 池（23 号 §3.1 MemoryAccountRouter 同构，账号解析同用 `accountOf()` 单一真值）；fail-closed：解析失败不开库。 |
| `src/app/effects.ts`（161） | `src/effects/effects.ts` | **R6 拍板**：不重写持久执行引擎，Effects 设计照搬——enqueue 事务内 UPSERT 合并（effects.ts:61-66）、按 kind 并发限、指数退避（effects.ts:130-146）、`Later` 不计失败、health 上报。改造：①`EffectPayloads`（effects.ts:11-24）的 `reply` 投递器换 channels；②`launch/delivery` handler 接 executor；③**先评估 DSH 宿主 `tool-jobs`/`schedule` 能力**（R6 原文），能承接的 kind 优先挂宿主，Effects 只兜宿主没有的——该评估结论是开工前置项（见 §6-1）。 |
| `src/app/outbox.ts`（52） | `src/effects/outbox.ts` | 回执表 + 顺序投递 + `behind` 同会话排队（outbox.ts:44-51）保留；`sources.send` 换 `channels` 适配器（§5-channels）。 |
| `src/app/versions.ts` / `src/app/settings-history.ts` | 并入 `src/store/store.ts` | Versions 泛型版本史类保留在 store 内部。 |

### 2.4 执行层（SA/src/executor/ → src/executor/）

| SA 源文件 | 目标路径 | 改造要点 |
|---|---|---|
| `src/executor/dsh.ts`（673） | `src/executor/dsh.ts`（主体）+ `slots.ts` + `workspace.ts` + `gates.ts` 拆分 | 拆四个文件避免单文件 673 行（本仓可读性惯例）。**去 worktree**：`ticketExecution`（dsh.ts:97-111）与 `ticketWorktreeName`（dsh.ts:57）删除，目录改为 `workspace.ts` 的 `<realm 工作区>/.tickets/<ticketId>/`（R4：progress/决策/evidence 落文件，主 Session `orchestrator_read` 读文件不读消息）。**R1 落点**：`launchQueued`（dsh.ts:270-285）与 `resumeAfter`（dsh.ts:555-576）接入 governance budget（effort 分级 + maxTokens/maxCost 硬截断，超限走 `failed` 报告而非无限重试）。**R2 落点**：worker `report({state:'ready'})` 上报路径（`report` 调用，dsh.ts:418-422）前置 `gates.ts` 判定——A2 分层：deliverable 结构校验（`.ticket/<id>/` 必备产物存在性与 schema）每单必跑，不过则记 `failed('gate:structure')`；金集 replay（evolve/gates.ts G1 适配器）仅发布门禁与高风险抽样触发。`workerIdle` 的 30 分钟后台限（dsh.ts:601-672）与 `BACKGROUND_LIMIT_MS` 保留。`install()` 的四类宿主事件订阅（dsh.ts:477-512）对齐本仓 DSH 0.2.2-rc.1 事件名（seam 钉住，§6-8）。 |
| （dsh.ts:171-199）`WorkerSlots` | `src/executor/slots.ts` | **27 号机制④资源冲突**：maxWorkers 槽位 + 人可插队 +1 槽 + 唤醒优先于新 launch——原样保留；插队次数计数暴露给 observe（D2 冲突三指标之一）。 |
| `src/executor/background.ts`（165） | `src/executor/background.ts` | `untilQuiet`/`stopBackground`/`stopSubagents`/jobs 收集原样（27 号 §2.2 点名参考）；subagent 权限遵循 D1：worker 声明段 `subagent_policies`（默认只读 reviewer 类，26 号 §4.1 扩展）。 |
| （新增） | `src/executor/gates.ts` | R2 门禁适配器：结构校验（纯函数，每单）+ 金集 replay 触发（调 `@eterna/evolve` gates 的 replay 适配器，仅发布/抽样）。 |

### 2.5 主会话与 Source（SA/src/app/ + sources/ → src/session/ + src/sources/）

| SA 源文件 | 目标路径 | 改造要点 |
|---|---|---|
| `src/app/assessment.ts` | `src/session/assessor.ts` | MasterAssessor per-eval 状态与候选卡投递保留；**28 号 §1.1 决策局部化**不变（候选卡 ≤4000 字符、窗口 400/1200、related_tickets ≤8 由 Engine 计算不靠模型记忆——`Candidate.tickets` 含已结束工单，ports.ts:30-38，正是 27 号情况 B 防线）。 |
| `src/sources/admission-context.ts` | `src/session/candidate.ts` | `threadWindow`（前 5 + 前后各 5，400/1200 字符，50 字符存根）原样（28 号 §1.1 表格的事实来源）。 |
| `src/app/sessions.ts` | `src/session/sessions.ts` | ensure/prompt/promptedId/relay/holds 契约保留，实现按本仓 DSH session 面重写（worker session id `worker-<ticketId>` 约定保留，dsh.ts:24）。 |
| `src/app/prompts.ts` + `prompts/*.md` | `src/session/`（装配）+ `prompts/`（资产） | prompt 版本绑定每次请求保留（24 号 §8.1-4）；prompt 文本本地化为中文为主（§6-9）。 |
| （新增） | `src/session/sections.ts` | **28 号 §6**：活跃工单清单 system prompt section——一行一单（id + 标题截断 + stage + 等谁），上限 20 行超出折叠为 `…+N more, orchestrator_read tickets`；**C6 拍板 pass 周期刷新**；体积纳入 model-surface 预算测试。 |
| `src/app/tools/`（tool.ts/main.ts/executor.ts） | `src/tools/orchestrator.ts` + `worker.ts` | `.strict()`+`describe()`+`AbortSignal`+角色分面四纪律照搬（24 号 §8.3）；实现换 `defineTool` seam（`ctx.tools.register` 返回 disposer 进 `ctx.effect`，本仓已有参照 `packages/memory/src/tools.ts:282`）。 |
| `src/sources/kind.ts` / `host.ts` / `registry.ts` / `poll.ts` | `src/sources/port.ts` | 只取 **Source 契约面**（Trigger 归一化、SourceScope.scope 返回 listened/observed/row，ports.ts:9-14）；注册表与轮询不搬——channels 是统一接收面（A5）。 |
| `src/sources/feishu*.ts` / `github*.ts` | `src/sources/channel-adapter.ts`（替代） | channels 事件 → Trigger：`channel_user` 收敛身份（27 号情况 A 归一化防线）、幂等 id 从事件内容派生；PR 生命周期绑定类（GitHub PR merge→`threadClosed`，engine.ts:62-65）走 Source 扩展钩子（A5 明确保留此类钩子）。 |

### 2.6 明确不移植（映射到「无」）

| SA 源文件 | 处置 | 依据 |
|---|---|---|
| `src/client/`（20 文件）、`src/app/views/`、`src/app/cards.ts`、`src/app/http.ts`、`src/app/api.ts` | 不移植 | 24 号 §8.2；面板由 30 号 workbench 承接（信息流图/看板/日志/评测监控） |
| `src/app/runtime.ts`、`passes.ts`、`health.ts`、`retry-health.ts`、`notices.ts`、`delivery.ts`、`links.ts`、`cache.ts`、`resources.ts`、`role-models.ts`、`execution-environment.ts`、`skill-files.ts` | 不整体移植；pass 驱动/健康面/notice 合并等**机制**并入 `plugin.ts` 装配与 effects，按需重写 | 这些是 bundle 运行时胶水，本仓 plugin.ts + glue 层有对应惯例；机制出处已在 §4 承接表标注验收 |
| `src/deployment.ts`、`src/setup.ts`、`src/navigation.ts`、`src/infra/`（除 text.ts 的 `sameName` 并入 policy） | 不移植 | 部署与安装归本仓双形态治理（31 号：单镜像双模板） |

---

## 3. Engine 角色接口清单（engine.ts:261-270 原文结构，融合版增注）

Engine 是领域状态**唯一事务写入者**；调用方只拿到角色裁剪的 `Pick` 接口（防越权面，24 号 §5.3-6 单写者不变量）。签名逐项列出（SA 实测，engine.ts:40-257），融合版改动以 ★ 标注：

**EngineForSources**（engine.ts:261）——channels 适配器持有：
- `receive(trigger: Trigger): 'stored' | 'duplicate' | 'filtered'` —— 幂等入库 + 订阅扇出 + Eval 排队（intake.ts:19-62）；★ Trigger 构造时带 realm；
- `bindThread(ticketId, thread: ThreadRef, own: boolean): Ticket` —— Source 事实：工单跟随线程（PR 绑定类，A5 扩展钩子调）；
- `threadClosed(thread, outcome: 'merged'|'closed', at): void` —— 线程关闭 → followsDone 判定收尾。

**EngineForMainSession**（engine.ts:263）——orchestrator 工具面持有：
- `candidate(triggerId): Candidate | undefined`；
- `candidateDelivered(evalId): void` —— 超时计时起点；
- `decide(triggerId, outcome: Outcome): Decision` —— 四动作 accept/attach(经单独方法)/stop/ignore + unavailable；★ R3：accept 缺四要素抛错；
- `attach(ticketId, triggerId, note?): Ticket` —— 27 号情况 B：挂到已有工单而非新建；
- `reply(request: ReplyRequest): Reply` —— ack/answer/result/attention 四规则（replies.ts:14-18）；
- `requestStatus(ticketId): boolean`；`note(ticketId, text): Ticket`。
- ★ 新增 `read` 面（只读投影走 store/reads.ts，不经 Engine——保持写者唯一、读者旁路）。

**EngineForPeople**（engine.ts:265）——面板/workbench 与审批卡动作持有：
- `stopTicket(ticketId, reason?): Ticket` —— **唯一撤销 Mandate 的人动作**（27 号机制④顶层）；
- `retryTicket(ticketId): Ticket` —— failed/blocked 后新 Assignment = 新分支；
- `reevaluate(triggerId): boolean`；`dismiss(decisionId): Decision`；`unsubscribe(thread): boolean`。
- ★ 调用侧由 access mux principal 解析 realm，路由到该租户的 Engine 实例（realm router 前置，接口签名不变）。

**EngineForSettings**（engine.ts:267）——glue 层持有：
- `policyChanged(from, to, effects?): void` —— 在跑工单只收 `policy-changed` Input、在跑 Eval 重开（tickets.ts:200-208）；★ from/to 来自 governance+hitl+准入表联合 hash（C3），热改即新版本。

**EngineForExecutor**（engine.ts:269-270）——executor 与 worker 工具面持有：
- `assignmentStarted` / `inputsDelivered` / `inputsRead` / `turnEnded` / `deliveryFailed` / `assignmentInterrupted`（宿主重启恢复，assignments.ts:83-92）；
- `report(ticketId, report: WorkerReport): Ticket` —— 六态 + question/answers（assignments.ts:11-20）；★ R2：executor 侧先过 gates.ts 再上报 ready；
- `markUnrelated` / `followForContext` / `handback` / `reply`。

---

## 4. 测试承接表（59 个 spec → 按域分组 → 目标与验收判据）

> 59 = 59 个 `tests/*.spec.ts(x)`（实测 `ls`，fixtures/ 为目录不计）。分组判据：文件头注释与 import 实测。「承接」= 在本仓重写为对等测试；「机制并入」= 测试对象不整搬，但其守护的机制由本仓其他测试覆盖；「不承接」= 面板/前端域，归 30 号或明确放弃。

### A. 领域内核（5）

| SA spec | 实测内容 | 目标 | 验收判据 |
|---|---|---|---|
| `core-engine.spec.ts` | Engine 全流程（MemoryRepositories + 假 Assessor/Executor/Policy） | `packages/tasks/tests/core-engine.spec.ts` | 同源全量移植改造：duplicate 不二开票、followup 不进 Eval、stop 唯一撤销、policyChanged 不撤销在跑授权、★realm 标注落库断言、★R3 缺四要素拒 accept |
| `stage.spec.ts` | ticketStage/canRetry 分类表 | `packages/tasks/tests/stage.spec.ts` | 阶段表逐行对齐 docs/003 规则（第一匹配行胜出） |
| `model-surface.spec.ts` | 模型面（工具/prompt/skill/体积）不漂移 | `packages/tasks/tests/model-surface.spec.ts` | 工具清单、prompt 版本、★活跃工单清单 section 体积预算（28 号 §6 上限）快照断言 |
| `class-docs.spec.ts` | 每个类有 JSDoc | `packages/tasks/tests/class-docs.spec.ts` | 同规则扫 src/（本仓工程纪律，24 号 §8.1-6 采纳） |
| `docs.spec.ts` | 文档链接只指向更早编号 | 不承接（SA 内部文档编号规则）；机制并入本仓 docs lint（若有） | — |

### B. 策略与准入（2）

| SA spec | 目标 | 验收判据 |
|---|---|---|
| `policy.spec.ts` | `packages/tasks/tests/policy.spec.ts` | gate 三格矩阵、revalidate 五分支（policy.ts:213-240）、admitsInferred 仅 auto、★联合版本 hash 变更触发 policyEffects、★allowed 判定接 access 名单桩 |
| `admission-context.spec.ts` | `packages/tasks/tests/candidate-context.spec.ts` | 窗口截断（前5+前后各5；400/1200/50 字符）逐参数断言（28 号 §1.1 表） |

### C. 存储与副作用（7）

| SA spec | 目标 | 验收判据 |
|---|---|---|
| `effects.spec.ts` | `packages/tasks/tests/effects.spec.ts` | UPSERT 合并保序、per-kind limit、指数退避、Later 不计失败、drain 留行重试、健康上报（effects.ts 全行为） |
| `outbox.spec.ts` | `packages/tasks/tests/outbox.spec.ts` | 回执幂等（同 id 不二发）、paused 挂起、同会话 behind 排队、channelIgnored/channelGone 落 dropped（投递端换 channels 桩） |
| `store.spec.ts` | `packages/tasks/tests/store.spec.ts` | 表/生成列/索引建全、嵌套 atomic 回滚、afterCommit 时序、settings 版本史；★库路径必须派生自 workspaces/<账号>/（tenant-scan 级断言） |
| `migration.spec.ts` | `packages/tasks/tests/schema.spec.ts` | 旧库拒开（tooOld）、新库拒开（前向守卫）、★本仓 v1 建库幂等 |
| `queue.spec.ts` | `packages/tasks/tests/effects-resume.spec.ts` | 重启后 effect 行重派、notice 去重机制（并入 effects/sections 测试） |
| `timeline.spec.ts` | `packages/tasks/tests/timeline.spec.ts` | 线程时间线分页/邻位/时间戳归一（isoTime） |
| `cache.spec.ts` | 并入 `assessor.spec.ts` | TextCache 机制由 assessor 上下文加载测试覆盖 |

### D. 评估与主会话（7）

| SA spec | 目标 | 验收判据 |
|---|---|---|
| `assessment.spec.ts` | `packages/tasks/tests/assessor.spec.ts` | per-eval 状态隔离、release 清理、上下文加载；★R3 四要素进入候选卡与 outcome 校验 |
| `prompts.spec.ts` / `prompt-config.spec.ts` | `packages/tasks/tests/prompts.spec.ts`（合并） | prompt 装配分段、版本绑定每次请求、团队覆盖不漂移 |
| `role-models.spec.ts` | `packages/tasks/tests/role-models.spec.ts` | orchestrator/worker 双 preset 模型配置；★C5 主 Session 摘要档位绑定（22a 结论档） |
| `followups.spec.ts` | `packages/tasks/tests/followups.spec.ts` | 人消息直达 worker 不起 Eval、handback 回 Eval、结束工单被追问恢复（R5 后半：追认可恢复结案工单） |
| `tools.spec.ts` | `packages/tasks/tests/tools.spec.ts` | 角色分面（主会话无实现权工具）、资源读路径（R4：orchestrator_read 读 `.ticket/<id>/` 文件）、schema strict |
| `delivery.spec.ts` | `packages/tasks/tests/delivery.spec.ts` | Inputs 逐条投递、readAt 记录、deliverFailed 上票、blocked/failed 压自动输入 |

### E. 执行器（8）

| SA spec | 目标 | 验收判据 |
|---|---|---|
| `background.spec.ts` | `packages/tasks/tests/background.spec.ts` | untilQuiet/stopBackground/jobs 收集（27 号 §2.2） |
| `runtime-concurrency.spec.ts` | `packages/tasks/tests/concurrency.spec.ts` | 重叠 trigger/delivery/launch 下：槽位不超 max、人插队 +1、唤醒先于新 launch（27 号机制③④）；★插队计数暴露 observe（D2） |
| `runtime.spec.ts` | `packages/tasks/tests/plugin-boot.spec.ts` | 装配启动顺序（store→effects→engine→assessor→executor→sources）与关停配逆 |
| `environment.spec.ts` | `packages/tasks/tests/workspace.spec.ts` | 执行环境校验；★worktree 断言删除、`.tickets/<id>/` 布局断言（R4） |
| `deployment.spec.ts` / `index.spec.ts` / `service-script.spec.ts` / `bundle-patch.spec.ts` | 不整体承接；`bundle-patch` → `packages/tasks/tests/preset.spec.ts` | preset spec：orchestrator/worker preset 结构、压缩组四件套行序（stale→basic→command→pruner，28 号 §4-2 行序不可调换）、上游 compaction 行 disabled 断言（22b 探针模式）。deployment/service-script 归 31 号双形态 CI |

### F. Sources（4）

| SA spec | 目标 | 验收判据 |
|---|---|---|
| `sources.spec.ts` | `packages/tasks/tests/channel-adapter.spec.ts` | channels 事件→Trigger 归一化、scope 过滤 filtered、幂等 id 派生（27 号情况 C） |
| `registry.spec.ts` | 并入 channel-adapter | 注册面由 channels 侧承担 |
| `github-read.spec.ts` / `feishu-read.spec.ts` / `feishu-image.spec.ts` | 不承接（渠道读取归 channels 包已有测试） | — |

### G. 运行时治理（8）

| SA spec | 目标 | 验收判据 |
|---|---|---|
| `passes.spec.ts` | `packages/tasks/tests/pass.spec.ts` | pass 调度合并、暂停时 deadline 顺延（evals.ts:35-46）、恢复重排 |
| `health.spec.ts` / `retry-health.spec.ts` | `packages/tasks/tests/health.spec.ts`（合并） | 组件健康错误态与恢复、瞬时错误（transient 正则，dsh.ts:44-55）退避重试 |
| `settings.spec.ts` | `packages/tasks/tests/settings.spec.ts` | 分块保存乐观并发、暂停切换、★策略同步触发联合 hash 重算 |
| `commands.spec.ts` | `packages/tasks/tests/workspace.spec.ts` 内 | worker 命令黑名单机制（blockedCommands）并入 workspace 测试 |
| `http.spec.ts` / `cards.spec.ts` / `views.spec.ts` | 不承接（面板域归 30 号 workbench） | — |

### H. 前端（18：`client/controls/draft/markdown/marks/navigation/locales/styles` + `panel-*` × 9）

不承接。24 号 §8.2 明确不取其面板与 HTTP 层；交互范式（流式块归并、报告时间线、任务侧栏）按 24 号 §3 由 P2 表面工作在 panel slots 扩展点重做，测试随 30 号 workbench 计划另立。

**承接统计**：整承接重写 24 个、合并承接 8 个、机制并入 7 个、明确不承接 20 个（18 前端 + docs + http/cards/views 中已计）——不承接项全部有明确去向（30 号 / channels / 31 号 CI）。

---

## 5. 与 access / governance / interact / channels 的接线点

> 原则（24 号 §5.3-5）：横切插件**不拥有业务状态**，只挂内核断点；接线经端口注入，tasks 不 import 服务实例。

**access（`packages/access/src/`）**
- `tenant.ts` + `mux.ts`：principal → realm 解析，是 `TasksRealmRouter` 的唯一账号真值来源（与 23 号 `accountOf()` 同一实现复用）；EngineForPeople/面板调用前置路由；
- 用户表：准入 allowed list 数据源（`allowedSender` 判定改查 access 用户 + realm 准入表，§2.2）；★30 号 Q3 新增「审批人」角色字段同样供 tasks 的 Attention 定向；
- `approval-bridge.ts`：Mandate 的「谁」维度（申请人身份）与 allowed-once 的任务级升级（G3 缺口缝合点）；
- 工作区钳制：worker session 一律建在租户 realm 工作区内（`sandbox.ts`/`within-root.ts` 钳制 R4 目录）；A4 拍板 v1 用现有沙箱旋钮，专用 worker 沙箱列多租户商用前评审（§6-4）。

**governance（`packages/governance/src/`）**
- `rules.ts`（deny-wins/fail-closed）：pre-execute 瀑布天然罩所有 session（含 worker 与其 subagent，27 号 §2.1-1）——**不改内核**，是 Mandate 范围的执行期兜底；
- 规则版本化（C3）：`rules.yaml` + hitl.yaml + tasks 准入表内容 hash → `policyVersion`；热改由 glue 监听文件变化重算并调 `Engine.policyChanged`（在跑工单钉旧版，Evals 重开）；
- `budget.ts`（R1）：maxTurns/maxTokens/maxCost + turn-stopping 硬截断挂 worker session 与 orchestrator；effort 分级（简单 1 / 比较 2–4 / 复杂 10+）进候选卡字段与 Mandate 执行契约。

**interact（`packages/interact/src/`）**
- Attention = 富审批卡超集：`card.ts` 渲染管线 + R0–R3 分档（`hitl.ts`）+ `on_no_answer` 挂起策略（escalate/cooling_period/double_confirm 运行时接线——G2 半接线在此缝合）；
- `ask.ts` 提问合并纪律对齐「一次只问一个问题」（superagent Attention 单问语义 + interact 一卡 ≤3 问合并，两者取严：Attention 场景单问）；
- `negative.ts` 负信号：Attention 被拒/被修改 → observe（与 report blocked/failed 同一信号面）。

**channels（`packages/channels/src/`）**
- `binding.ts` 升级：`channel_user → session` 增补 `→ thread / ticket`（24 号 §5.2 中改项；27 号情况 A 整条防线建于此）——多渠道收敛同一身份→同一线程→串行化；
- `webhook.ts`/`token.ts`：外部事件入口 → `channel-adapter.ts` 归一化为 Trigger（幂等 id）；Outbox `reply` 投递器经 channels 适配器出站（结果回到发起渠道）；
- `cards.ts`：Outbox 消息的渠道端渲染（结果卡/摘要卡）。

**其它（audit / observe / evolve / memory / compaction）**
- `audit`：一份数据两用——Trigger→候选卡→Decision 理由→四要素→报告→门禁结果全程 NDJSON 留痕（24 号 §5.5 附加确认；`DomainEvents` + reasons 码表就是 trace 面）；
- `observe/evolve`：D2 冲突三指标（attach 次数 / receive duplicate 比例 / 槽位插队次数）+ report blocked/failed → 信号表 → G0/G1/G2 → skill delta（24 号 §5.4 闭环）；
- `memory`：`ticket.ended` 事件挂记忆整固钩子（现只认 `turn/end`，24 号 §5.4）；
- `compaction`：orchestrator/worker preset 挂 `@eterna/compaction` 四件套（行序 stale→basic→command→pruner；28 号 §3 YAML 照搬；C5 摘要档位、cache-guard 压缩打标）。

---

## 6. 开放问题

1. **R6 宿主能力评估的前置性**：`tool-jobs`/`schedule`/session persistence 能否承接 `launch/delivery/relay` 等 effect kind，决定 Effects 队列的裁剪幅度——需在开工前对 DSH 0.2.2-rc.1 宿主做一次 seam 评估并记录结论（本文按「Effects 全量照搬」保守设计）。
2. **realm 键形态**：`Mandate.realm` 用 access 账号 id、workspace 名还是独立 realm id？与 23 号 `accountOf()` 的账号粒度是否一致（一账号多 workspace 时工单归属谁）——影响 realm router 的池键与库路径。
3. **policyVersion 联合 hash 的计算归属**：governance 侧算还是 glue 层算？rules.yaml 热改监听（fs watch vs 保存时）与「热改即新版本」的触发时机需与 governance 规则版本化专项（24 §9-2）合流。
4. **worker 沙箱边界**：v1 用 R2/R3 瀑布 + 现有沙箱旋钮（A4），但「worker 以操作者 OS 用户身份跑命令」的残余面（非工具通道的 shell 逃逸）何时列入商用前安全评审清单、评审判据是什么。
5. **R2 结构校验的 deliverable schema**：`.ticket/<id>/` 必备产物（progress/决策/evidence）的具体文件名与格式由谁定——领域包（26 号声明段）还是 tasks 内置默认 + 包覆盖？
6. **orchestrator 主会话的宿主形态**：独立常驻 DSH session（SA 模式，`masterId`）还是本仓 pass 驱动的无头循环？B3 拍板「embed 档启用任务层（API 面，无 UI）」暗示需要无头形态，两形态是否共用同一 assessor 实现。
7. **Outbox 回执归属**：receipts 表留在 tasks 租户库（本文设计）还是 channels 统一回执面？若 channels 已有投递状态存储需避免双账。
8. **DSH 契约版本差**：SA 锚 `dsh 0.2.1-alpha.2`、本仓 `0.2.2-rc.1`——executor 依赖的四类事件（agent/status、agent/inbox/claimed、session/event、agent/error）与 sessions 面签名需 seam 钉住并纳入 upgrade-gate 门禁（28 号 §4-1 同款风险）。
9. **prompt 资产语言与摘要档位**：SA prompt 全英文、注释纪律极强；本仓用户中文为主——orchestrator/worker prompt 重写为中文时的 model-surface 体积预算重标定，以及 C5「主 Session 用 22a 最优档」的具体档名与成本入 R1 预算的计量口径。
10. **路由金集的存放与触发**（28 号 §5）：30–50 条判例放 `packages/tasks/tests/` 还是 dsh-evals pack？「压缩前后各跑一遍」挂 CI 还是发布门禁——与 C4（金集人工 20 条起步 + 月度增补）的执行流程需合并定义。

---

## 7. 与既有文档的关系

```
24（融合架构 §5 / R1–R6 §5.5）──本文是其 WS-A 实施蓝图
24a 拍板（A1 realm/A2 分层验收/A5 channels/C3 hash/C6 pass 刷新/D1/D2）──逐条落进 §2 改造要点列
27（冲突五机制/三层权力）──§2 内核行、§4-E 并发验收、§5 observe 指标
28（压缩组/活跃工单清单/路由金集）──§2.5 sections、§4-E preset spec、§6-10
23（per-account store 池）──§2.3 realm router 同构引用
30（workbench）──§4 H 组与 G 组不承接项的去向
31/32（双形态/工作流）──Tier2 归属与 WS-A 排期上下文
```

本文不改变既有拍板；§6 十项开放问题确认后升级为定稿。
