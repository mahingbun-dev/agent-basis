# R6 宿主能力 seam 评估——tasks 引擎评审登记（35-A0 / G2-A12）

> 评审对象：DSH 宿主 `0.2.2-rc.1`（本仓 `node_modules/@deepseek-ai/dsh`，根 `package.json:26` 钉版；seam 家族另见 `pnpm-workspace.yaml:18` 注——catalog 钉 `0.2.2-alpha.2`，「seam 类型即取自该版本」）+ SA（`dsh-superagent-prototype`）副本。
> 任务号：35 号 §2 A0「R6 宿主能力 seam 评估与评审登记」（35:51-54）；依据条款：24 §5.5-R6（24:204）· 34 §6-1、§6-8、§2.3 effects 行（34:142）· 33 §1.3 G2-A12（33:120）、§2.3 评审类处置规约（33:251）、§6 缺口 1。
> 比对方式（33 §2.3 产物裁决形态）：本文件存在 + `grep -c "结论"` ≥1（G2-A12 原判据，33:120）；结论行逐项有处置（本文 §8 汇总）。
> 日期：2026-11-18。评审执行：S1-A0（工作流代理），全部证据为本日实测（命令与输出摘录见 §10）。

---

## 1. 结论速览

**R6 评估结论：「Effects 全量照搬」成立，A12 裁剪幅度 = 0。** DSH `0.2.2-rc.1` 宿主的三项候选能力各承一层、互不重叠，均**不构成** `launch/delivery/relay` 等引擎级 effect kind 的持久派发层：

- **tool-jobs**（`dsh-jobs`/`dsh-tool-jobs`）＝ worker 会话**内部**的后台命令/PTY 作业机制——合同明确 in-process、所有权按 agent session 隔离、重启不存活；
- **schedule**（`dsh-schedule`/`dsh-tool-schedule`）＝**时间驱动**的定时指令投递（at-least-once、无幂等键、无重试循环）——与 tasks 引擎**状态驱动 + per-requestId at-most-once** 的派发语义相反；
- **session persistence**（`dsh-session-persistence-jsonl` + `dsh-session`）＝唯一真正持久的承接面，但持久的是**会话事件流**，不是引擎状态（工单/授权/effect 行）——「状态半边」宿主承接、「派发半边」仍须 tasks 自建（SQLite 惯例）。

R6 带来的实际收缩在两处：①会话崩溃恢复不必自建（宿主 JSONL crash recovery + `TOOL_OUTCOME_UNKNOWN` 修复语义）；②定时触发可选挂 schedule 作 Source（A21 可选增强，v1 不依赖）。34 §2.3 effects 行③「能承接的 kind 优先挂宿主」经逐 kind 判定（§3.1 判定矩阵），**六个 kind 无一可移**，34 号的保守设计按原样执行。

---

## 2. 逐项结论表（总表）

| # | 评审项 | 结论 | 依据（本日实测） | 处置 |
|---|---|---|---|---|
| C1 | tool-jobs 能否承接 launch | **否** | `dsh-jobs` README Known Limitations 原文：「The contract is in-process — `JobSpec.run()` passes callbacks and the registry resolves the live `Agent` behind the owner session; a durable or cross-process backend must reshape identity, restart, ownership, and observation semantics before it can implement this seam」；`dsh-tool-jobs` README：「pending notices do not survive owner disposal」 | launch 留 Effects（A12）；tool-jobs 只作 worker 内部后台机制（34 §2.4 background 行照搬，`tests/background.spec.ts` 承接） |
| C2 | tool-jobs 能否承接 delivery/relay | **否** | 同 C1（所有权按 owner session 隔离：「A job belongs to the agent session that started it: another agent cannot read or stop it」）；delivery/relay 跨会话、需引擎读工单状态 | 同上；delivery/relay 留 Effects |
| C3 | schedule 能否承接 launch | **否** | `dsh-schedule` README：timing 七种（after/at/every/daily/weekly/cron/rrule）全部**时间驱动**；launch 是**状态驱动**（槽位空才启动，SA `dsh.ts:281` `error instanceof Later` 重排语义） | launch 留 Effects；schedule 不入派发链 |
| C4 | schedule 能否承接 delivery/relay | **否**（语义相反） | README Known Limitations 原文：「Session flush and task acknowledgment are separate commits, so delivery is at least once. Graceful Agent disposal can discard queued input after a receipt was saved; receipts establish inbox persistence, not execution」——at-least-once、无幂等键；tasks 不变量要求同一 requestId 永不重复投递（27 §3.2-②） | delivery/relay 留 Effects；**禁用** schedule 作幂等投递通道 |
| C5 | schedule 可承接面 | **定时 Trigger 生产（可选增强，v1 不做）** | 投递消息带 `source.kind === 'schedule'`（`dsh-schedule` `lib/types/runtime.d.ts:3-9` MessageSourceMap 扩展），可被 Source 适配器识别为触发 | 登记 A21 附注：定时/周期 Trigger 可桥 schedule（Source 扩展钩子，24a 拍板 A5），v1 不依赖；`deliveryHistory`（30 天/200 条回执）与 A13 Outbox receipts 的双账风险并入 35 §12 开放问题 7 备注 |
| C6 | schedule 模型面风险 | **登记关注点** | `dsh-tool-schedule` 提供 `schedule_create/list/view/edit` 模型工具（README 工具表）——worker 可在 Mandate 外创建定时任务 | 处置归 A18（subagent_policies/governance pre-execute 瀑布罩住 worker 工具面）；本评审只登记，不自行裁定 |
| C7 | session persistence 承接 launch/delivery/relay | **部分：状态半边承接，派发半边不承接** | `dsh-session-persistence-jsonl` README：append-only JSONL + 逐批 fsync + no-overwrite publish + 撕尾恢复（「An incomplete final raw line is discarded. A torn final Zstandard frame contributes only its complete decoded JSONL records」）；恢复语义 `TOOL_NOT_STARTED`/`TOOL_OUTCOME_UNKNOWN`（「tells the model to retry only read-only or idempotent work」）；单写者 `flock(2)` | worker session（`worker-<ticketId>`）状态跨重启存活＝R1 会话半边不自建；工单/授权/effect 行仍归 A11 租户 SQLite；**SA `resume()` 的 `assignmentInterrupted` 对账必须照搬**（宿主无引擎对账服务，SA `dsh.ts:520-532`） |
| C8 | 幂等投递原语 | **宿主无，须自建（照搬 SA AgentDelivery 模式）** | SA `src/app/delivery.ts:1-90`：at-most-once 按 requestId 基于 `ctx.sessionPersistence.flush()/open(agent.id,'read')` + `session/event` 监听 + `MessageSourceMap` 模块扩展（`'dsh-superagent'` kind，delivery.ts:9-12）实现；宿主无对应服务 | A22 delivery.spec 承接此模式；本仓 tasks 声明自有 source kind（不改宿主） |
| C9 | executor 四类宿主事件签名（0.2.2-rc.1） | **全部存在且钉住成功** | 逐条签名与实测文件：行见 §5 表（dsh-agent `runtime-types.d.ts:109/279/304/437`；dsh-session `index.d.ts:63`） | 签名逐条进 `tests/types.seam-pin.ts`（A1 建文件、A14 补断言；34 §6-8、33 G4-5 upgrade-gate 同款） |
| C10 | B9 版本差（SA 锚 0.2.1-alpha.2 vs 本仓）实测敞口 | **事件/会话/消息三面类型 alpha.2 与 rc.1 完全一致，当前敞口 = 0** | `diff -q` 实测三组文件字节级相同：dsh-agent `runtime-types.d.ts`、dsh-session `index.d.ts`+`types.d.ts`、dsh-llm `message.d.ts`（§10 命令 5-6） | seam-pin 仍必做（风险敞口随 rc 演进，33 G4-6 rc 红线）；结论记入 B9 复核基准 |
| C11 | sessions 面签名（resolveAgent/create/rename/agents/workspaceRegistry/permissionPresets/agentPresets/sessionPersistence） | **全部存在且签名与 SA 用法吻合** | 逐条见 §6 表（dsh-api-session-controller `agent.d.ts:57-63`、`index.d.ts:78/100/155` 等） | 同 C9 进 seam-pin；A22 按此实现（34 §2.5 sessions 行「实现按本仓 DSH session 面重写」） |
| C12 | Temporal 失败模式清单（25 卡点5 五行）对照 | **会话半边两项部分承接，引擎半边全部仍须 Effects** | 逐行对照见 §7 表 | 主结论＝§1；引擎层确定性重放/Worker Versioning 不自建也不虚设——以「Effects 行恢复 + resume 对账 + upgrade-gate」三件套替代，登记为 G2-A12 闭环口径 |

---

## 3. 三能力细评（R6 ①：tool-jobs / schedule / session persistence 对六类 effect kind）

SA `EffectPayloads`（SA `src/app/effects.ts:11-24`）定义六个 kind：`assessment`（key=Eval ID）/ `launch`（key=Assignment ID）/ `delivery`（key=Ticket ID）/ `relay`（key=request ID）/ `notice`（key=名称）/ `reply`（key=消息 ID）。逐 kind × 三能力判定：

### 3.1 判定矩阵

| effect kind | tool-jobs（dsh-jobs/dsh-tool-jobs） | schedule（dsh-schedule） | session persistence | 判定 |
|---|---|---|---|---|
| `assessment` | ❌ in-process | ❌ 时间驱动 | ❌ 不含引擎状态 | 留 Effects（候选卡组装是 Eval 内逻辑） |
| `launch` | ❌ in-process、所有权按 session | ❌ 时间驱动、无槽位感知（`Later` 语义无处安放） | ◐ 会话状态存活（派发半边无） | **留 Effects**；会话半边靠 persistence |
| `delivery` | ❌ | ❌ at-least-once 无幂等键 | ◐ 同上 | **留 Effects**（逐条投递 + 每步重读工单状态，SA `dsh.ts:288-299`） |
| `relay` | ❌ | ❌ 同 C4 | ◐ 同上 | **留 Effects**；投递动作走宿主 steer 原语（SA sessions.ts:104 `prompt(..., 'steer')`） |
| `notice` | ❌ | ❌ | ◐ 同上 | **留 Effects**；注入动作走宿主 inject 原语（ContextFormed `notice` form，dsh-llm `message.d.ts:63-84`） |
| `reply` | ❌ | ❌ | ❌ 宿主无渠道发送 | 留 Effects；投递器换 channels 适配器（34 §2.3 outbox 行） |

### 3.2 tool-jobs：worker 内部机制，非引擎层

实测包：`.pnpm/@deepseek-ai+dsh-tool-jobs@0.2.2-rc.1_*/`、`.pnpm/@deepseek-ai+dsh-jobs@0.2.2-rc.1_776462*/`。

- 能力面：模型工具 `job_output(job_id, wait?, timeout_ms?)` / `job_list()` / `job_kill(job_id, reason?)`；作业完成以 in-session notice 送达（busy 下一步注入、idle 唤醒跟进 turn）；`maxConsecutiveWakes` 封顶自激励链；`completionDelivery: quiet` 保确定性转写。
- 边界（README Known Limitations 原文）：in-process 合同；settled 记录保留至 owner/service disposal 或显式 remove，无保留计数。
- 与 tasks 的正确关系：worker 的 `background.ts`（SA `runningJobs/collectJob/stopBackground/untilQuiet`，34 §2.4 background 行「原样」）本就通过 `ctx.jobs` 使用宿主作业——**这条承接成立且已照搬**；但引擎级 launch/delivery 与它无关（跨会话、需幂等、需槽位与暂停协调）。

### 3.3 schedule：时间驱动触发源，非派发队列

实测包：`.pnpm/@deepseek-ai+dsh-schedule@0.2.2-rc.1_9c311d3e*/`（附 `dsh-tool-schedule` 模型工具面）。

- 能力面：`create({ title, prompt, timing, target? })`，timing 七种（`after/at/every/daily/weekly/cron/rrule`）；target 三种（复用现有 `session` / 首投递创建并复用 `new_once` / 每次新建 `new`）；任务持久（JSON `<DSH_HOME>/storages/schedule.json` 或 SQLite `u_schedule_tasks.value`，unit 版本 2 兼容 1）；重启存活，recurring 重启只补最近一次错过；管理面 `list/view/edit/delete/run/history`，回执保留 `deliveryHistoryDays=30`/`deliveryHistoryRecords=200`。
- 边界（README Known Limitations 原文）：Host 须在运行；失败保留任务并告警、**无重试循环**；「delivery is at least once……receipts establish inbox persistence, not execution」。
- 判定：与 tasks 派发语义（状态驱动 + per-requestId at-most-once + `Later` 暂停重排 + 槽位 `limit()`）逐条相反——**不可作 delivery/relay/launch 通道**（27 §3.2-② 幂等不变量会被 at-least-once 直接破坏）。可承接面＝定时/周期 Trigger 生产：投递消息 `source.kind === 'schedule'` 可识别，A21 channel-adapter 可加 schedule 桥（可选增强）；`deliveryHistory` 回执与 A13 Outbox receipts 若并存须避免双账（并入 35 §12 开放问题 7 备注）。
- 模型面风险：`schedule_create` 等工具让 agent 可自行创建定时任务（Mandate 外副作用）——登记 C6，处置归 A18。

### 3.4 session persistence：状态半边的真正承接面

实测包：`.pnpm/@deepseek-ai+dsh-session-persistence-jsonl@0.2.2-rc.1_f6a4d672*/`、`.pnpm/@deepseek-ai+dsh-session@0.2.2-rc.1_*/`。

- 持久性：每会话一个 append-only JSONL（可选 Zstandard），「Each subsequent batch appends lines or one compressed frame and `fsync`s before the append resolves」；no-overwrite publish；崩溃后「the stored log keeps its interrupted final turn——every record in the committed prefix survives」；不完整末行丢弃、撕裂 zstd 帧只取完整解码记录并截断重写；完整帧校验失败按腐蚀拒绝。
- 恢复语义：`SESSION_FORMAT_VERSION = 4` + 相邻迁移链（v0→v1→…→v3→v4 四个 format 迁移包实测在库）+ `tooOld` 拒开；中断调用修复为 `TOOL_NOT_STARTED`（无持久调用的 assistant request）或 `TOOL_OUTCOME_UNKNOWN`（有调用无结果）——「tells the model to retry only read-only or idempotent work and to verify possible side effects」。
- 并发：单活写者——写句柄独占 + 内核锁（`session.lock` 上非阻塞 `flock(2)`；Windows 命名信号量），崩溃持有者随进程消亡。
- 判定：worker session 状态跨重启存活＝R1「崩溃恢复」的会话半边**不自建**；但它持久的是会话事件流，工单/授权/决策/effect 行等引擎状态宿主不管——A11 租户 SQLite 仍是必需；重启后「谁该继续跑」的对账宿主不提供，SA `resume()`（`dsh.ts:520-532`：running → cancel + `assignmentInterrupted`，pending → 重排 launch）必须照搬到 A14。

---

## 4. R6 ②：executor 四类宿主事件签名钉住（0.2.2-rc.1 实测）

SA `install()`（SA `src/executor/dsh.ts:477-512`）订阅的四类事件在本仓 DSH 0.2.2-rc.1 类型面逐一钉住如下（文件均以 `node_modules/.pnpm/<pkg>@0.2.2-rc.1_<hash>/node_modules/@deepseek-ai/<pkg>/lib/types/` 为根）：

| 事件 | 0.2.2-rc.1 签名（逐字） | 实测出处 | SA 用法（对照） |
|---|---|---|---|
| `agent/status` | `'agent/status'(this: Scoped<Agent>, payload: { agent: Agent; status: AgentStatus }): void`；`AgentStatus = 'idle' \| 'running'`（生命周期注释：`idle`＝无活动 driver；`running`＝waking input 起 cancellable pre-step 起） | dsh-agent `runtime-types.d.ts:279-285`（类型定义 `:115`） | SA `dsh.ts:479` `({ agent, status }) => …` 吻合 |
| `agent/inbox/claimed` | `'agent/inbox/claimed'(this: Scoped<Agent>, payload: { agent: Agent; message: UserMessage; turn: number }): void`（注释：被拒 step 的 claimed message「ends here: it is neither discarded nor re-emitted as a user/message」） | dsh-agent `runtime-types.d.ts:304-309` | SA `dsh.ts:489` `({ agent, message }) => …` 吻合（`message.source.kind === 'user'` 判人输入） |
| `session/event` | `'session/event'(this: Scoped<Session>, session: Session, event: SessionEvent): void`（emit 模式；姊妹事件 `session/flush` 为 parallel 检查点） | dsh-session `index.d.ts:63`；事件形状 `{ type; seq; time; data; ignorable? }`（types.d.ts:497-516）；`'user/message': UserMessage`（types.d.ts:300） | SA `dsh.ts:495` `(session, event) => …` + `event.type !== 'user/message'` + `event.data.source.kind !== 'dsh-superagent'` 吻合 |
| `agent/error` | `'agent/error'(this: Scoped<Agent>, payload: { agent: Agent; turn: number; step: number; error: unknown }): void`（「A step or turn errored. The machine reports a failure here even when the error has no in-turn position for a durable record」） | dsh-agent `runtime-types.d.ts:437-443` | SA `dsh.ts:506` `({ agent, error }) => …` 吻合（`error: unknown` 逐字透传进 `retries()`/`failed()`） |

附带钉住（SA Sessions/executor 装配同面依赖）：

| 事件/服务 | 签名 | 实测出处 |
|---|---|---|
| `agent/created` | `(payload: { agent: Agent; source: SessionStartSource; signal?: AbortSignal }) => undefined \| Promise<undefined>`；`SessionStartSource = 'startup' \| 'resume' \| 'clear' \| 'compact'` | dsh-agent `runtime-types.d.ts:254-260`、`:130` |
| `agent/disposed` | `(payload: { agent: Agent }): void` | dsh-agent `runtime-types.d.ts:267-273` |
| `agent/inbox/inserted` / `agent/inbox/discarded` | `(payload: { agent: Agent; message: UserMessage }): void` | dsh-agent `runtime-types.d.ts:287-302` |
| `MessageSourceMap` 扩展点 | merge-extensible（「each producer declares its own `kind` in its own module; there is no shared catch-all `plugin` kind」）；宿主自带 `user/model/tool/system-prompt`，schedule 扩展 `'schedule'`，SA 扩展 `'dsh-superagent'` | dsh-llm `message.d.ts:89-98`（原文）、dsh-schedule `runtime.d.ts:3-9`、SA `delivery.ts:9-12` |

**版本差实测（C10，开放问题 8 / B9）**：catalog 钉的 seam 家族为 0.2.2-alpha.2（`pnpm-workspace.yaml:18-24`），CLI 为 0.2.2-rc.1——对上述 seam 文件做 `diff -q`：dsh-agent `runtime-types.d.ts`、dsh-session `index.d.ts` + `types.d.ts`、dsh-llm `message.d.ts` 三组**字节级相同**（§10 命令 5-6）。当前事件面升级敞口实测为 0；seam-pin 照常落地（敞口随 rc 演进，G4-6 rc 红线照守）。

---

## 5. R6 ②（续）：sessions 面签名钉住（0.2.2-rc.1 实测）

SA `Sessions`（SA `src/app/sessions.ts:24-36,138-171`）依赖的宿主面在 0.2.2-rc.1 逐一存在且签名吻合：

| 宿主面 | 0.2.2-rc.1 签名（逐字） | 实测出处 | SA 用法 |
|---|---|---|---|
| `ctx.sessionController.resolveAgent` | `resolveAgent(sessionId: SessionId): Promise<ApiSessionAgentResult>` | dsh-api-session-controller `index.d.ts:78`、`agent.d.ts:95` | SA sessions.ts:141（`session/not-found` 判新建） |
| `ApiSessionAgentResult` | `{ readonly agent: Agent } \| { readonly error: ApiSessionAgentError }`；错误码 `'session/not-found' \| 'session/agent-busy' \| 'session/writer-held' \| 'gateway/internal'` | 同包 `agent.d.ts:57-63` | SA 判 `'error' in result` 吻合 |
| `ctx.sessionController.create` | `create(request: SessionCreateRequest): Promise<SessionCreateValue>`；request 字段 `workspaceId?/cwd?/sessionId?/agentPreset?`（`agentPreset`：「Preset the Session runs, replacing a reused Session's recorded preset」） | 同包 `commands.d.ts:32`、`types.d.ts:264-280` | SA sessions.ts:143-146（`{ sessionId, workspaceId, agentPreset }`）吻合 |
| `ctx.sessionController.rename` | `rename(request: SessionRenameRequest): Promise<SessionRenameValue>` | 同包 `commands.d.ts:44`、`index.d.ts:155` | SA sessions.ts:152 |
| `ctx.agents` | `agents: AgentRegistry`；`get(id: SessionId): Agent \| undefined`（「the agent, or undefined when no live agent has that id」） | dsh-agent `index.d.ts:21`、`:357` | SA dsh.ts:524（resume 取 worker agent）、sessions.ts:117 |
| `ctx.workspaceRegistry` | `workspaceRegistry: WorkspaceRegistry`；`create(path: string, title?: string): Promise<Workspace>` | dsh-workspace `index.d.ts:82`、`:146` | SA sessions.ts:144 |
| `ctx.permissionPresets` | `permissionPresets: PermissionPresetService`；`set(session: Session, name: string): void` | dsh-permission-presets `index.d.ts:12`、`:177` | SA sessions.ts:150（`'danger-full-access'`） |
| `ctx.agentPresets` | `agentPresets: AgentPresetRegistry`；`select(agent: Agent, agentPreset: string): Promise<string>` | dsh-agent-preset-registry `index.d.ts:18`、`:132` | SA sessions.ts:124-129（preset 重选兜底） |
| `ctx.sessionPersistence` | 服务名 seam（JSONL 后端 README：「consumers couple to `ctx.sessionPersistence`」；契约套件 `runPersistenceContract`/`runLiveWritePathContract` 钉其行为） | dsh-session-persistence-jsonl README:107 | SA delivery.ts:45-46（`flush()` + `open(agent.id, 'read')` 逐事件对账） |

结论（C11）：SA `Sessions` 契约面（`ensure/prompt/promptedId/relay/holds`）在 0.2.2-rc.1 宿主原语上**无缺失原语**，全部可按 34 §2.5 sessions 行「实现按本仓 DSH session 面重写」执行；A22 `worker session id 约定 worker-<ticketId>`（SA `dsh.ts:24` 实测 `const workerSessionId = (ticketId: string): string => \`worker-${ticketId}\``）不受版本差影响。

---

## 6. R6 ③：Temporal 失败模式清单对照（25 卡点5 → 宿主实测）

25 号 §5（25:110-122）五项逐行对照 DSH 0.2.2-rc.1：

| # | Temporal 提供 | SA 现状（25 号实测） | DSH 0.2.2-rc.1 宿主实测 | 结论与处置 |
|---|---|---|---|---|
| T1 | 确定性重放（event history 回放重建状态） | ❌ 无；靠 `assignmentInterrupted` + effect 行恢复 | 会话层有 event-sourced JSONL（seq 单调、可重放会话状态、`SESSION_FORMAT_VERSION=4` 迁移链）；**引擎层无**（工单/授权/effect 行不在其中） | 部分承接（会话半边）。处置：引擎层不自建重放也不虚设——按 SA 同款「effect 行恢复 + `resume()` 对账」执行（A12/A14），并保持 Engine 单写者（24 §5.3-6）使状态重建＝重读租户库 |
| T2 | Activity 重试/超时/心跳平台配置 | ✅ 自建，6 kind 各有策略（`retry: [2000, 60_000]` 指数退避，SA effects.ts:130-146 实测 `delay = min(retry[1], retry[0] * 2 ** min(attempts, 16))`） | 零散提供：tool-jobs 有 wait/timeout/cancel；schedule **无重试循环**；模型请求有 dsh-llm-retry | 非平台级。处置：Effects 指数退避 + `Later` 不计失败**照搬**（A12 验收 `tests/effects.spec.ts` 已列） |
| T3 | Signal / Query / Update（运行中干预） | ⚠️ 部分（note / requestStatus） | 干预原语良好：prompt 三模式 `'queue'/'steer'/{inject}`（SA sessions.ts:162）、`agent/inbox/*` 事件族、ContextFormed 注入 | 承接面成立。处置：relay/notice handler 走宿主 steer/inject 原语，Effects 只管「何时投」不管「怎么投」（与 34 §2.3 改造①②一致） |
| T4 | Worker Versioning（升级不打断在跑 agent） | ❌ 无 | 宿主无 worker 代码版本化；有会话**格式**版本（SESSION_FORMAT_VERSION=4 + 迁移链）与 preset 会话绑定（「A Session keeps the preset it was created with」） | 不承接。处置：以既有体系缓解——seam-pin（C9/C11）+ upgrade-gate（33 G4-5/G4-6 rc 红线）+ 包可配逆回退（35 §10 回退行）；不自建版本化 |
| T5 | 崩溃后「在哪停就从哪继续」 | ⚠️ 只恢复排队副作用，不能重放整个 turn | 会话层承接（§3.4：committed prefix 存活 + `TOOL_OUTCOME_UNKNOWN` 修复）；schedule 任务重启存活；tool-jobs **不**存活；引擎 effect 行恢复宿主不管 | 会话半边承接、作业/引擎半边不承接。处置：SA `resume()` 对账 + `tests/effects-resume.spec.ts` 重派断言照搬（A12/A14）；worker 后台作业的 30 分钟 `BACKGROUND_LIMIT_MS` 语义维持（越限即停，不跨重启续跑） |

Temporal 官方列举的失败模式（25:122 引：「crash 或重新部署时丢失 in-flight 状态，导致要自己维护状态表、检查点、对账作业」）在 tasks 落地形态下的残集＝**引擎状态表（A11）+ effect 派发对账（A12/A14）**两项，均在 34 号保守设计内；宿主吃掉的是会话检查点与崩溃恢复这一最重的一块。

---

## 7. SA 副本钉住与 34 号行号复核（35-A0「另」项）

**SA 副本绝对路径（钉死）**：`/Users/sunny/.zcode/workspace/1794762961511-29e33e2a-233c-4894-81a4-71a6894ae22f/dsh-superagent-prototype`（2026-11-18 实测存在；即 35 §0-B8 修订附记 2026-11-17 所钉路径，本日复核未变）。

34 号引用行号抽查（本日实测，全部吻合；SA 路径缩写为上）：

| 34 号引用 | SA 位置 | 实测 |
|---|---|---|
| effects.ts:11-24 `EffectPayloads` | ✓ | 六 kind 定义逐字吻合 |
| effects.ts:61-66 enqueue UPSERT | ✓ | `INSERT … ON CONFLICT(kind, key) DO UPDATE` 在 61-66 行 |
| effects.ts:130-146 指数退避 | ✓ | `attempt()` + `delay = Math.min(handler.retry[1], handler.retry[0] * 2 ** Math.min(row.attempts, 16))` |
| outbox.ts:44-51 `behind` 排队 | ✓ | `store.receipts.behind(id, FAILURES_BEFORE_ERROR)` + `channelIgnored`/`channelGone` 结算 |
| store.ts:30-44 生成列工作集 | ✓ | `SETS` 表（ticket.open/active…） |
| store.ts:71-87 表结构 | ✓ | trigger/disposition/thread/ticket/decision… CREATE TABLE |
| store.ts:133-162 savepoint 嵌套 atomic + afterCommit | ✓ | `atomic<T>()` 在 140 行、`committed` 回调分层 |
| store.ts:183-199 settings 版本史 | ✓ | `settingsVersions`/`blockRevision` |
| model.ts:75-88 `followupOwners` | ✓ | 谓词逐字吻合 |
| model.ts:349-353 `waitsForPerson` | ✓ | 谓词逐字吻合 |
| intake.ts:19-62 `receive` 幂等三态 | ✓ | `stored/duplicate/filtered`（`receive` 在 19 行起） |
| engine.ts:48-257 Engine 命令体 | ✓ | `receive` 在 48 行、`policyChanged` 在 255 行 |
| engine.ts:261-270 五角色 Pick | ✓ | `EngineForSources/ForMainSession/ForPeople/ForSettings/ForExecutor` |
| dsh.ts:24 `workerSessionId` | ✓ | `` `worker-${ticketId}` `` |
| dsh.ts:57 `ticketWorktreeName` | ✓ |（A14 去除项，原样在 SA） |
| dsh.ts:97-111 `ticketExecution` | ✓ |（A14 去除项，原样在 SA） |
| dsh.ts:270-285 `launchQueued` | ✓ | 函数体 271-287（引用区间覆盖） |
| dsh.ts:418-422 `report failed` 路径 | ✓ | `engine.report(ticketId, { state: 'failed', summary })` + relay |
| dsh.ts:477-512 `install()` 四类订阅 | ✓ | 订阅体 478-510 |
| dsh.ts:555-576 `resumeAfter` | ✓ | 函数在 555 行起 |
| dsh.ts:601-672 `workerIdle`/`BACKGROUND_LIMIT_MS` | ✓ | `workerIdle` 在 601 行；`BACKGROUND_LIMIT_MS = 30 * 60_000` 在 30 行 |

复核范围说明：上表覆盖 34 号 §2.3/§2.4/§2.1 中与 A12/A14 及内核移植直接引用的行号；34 号其余任务（A6/A8 等）引用的行号属对应任务开工时的首日复核事项，不在本评审范围（B8 的「复核基准」自本评审起为已验证状态）。

---

## 8. 处置清单（33 §2.3 评审类处置规约：结论行逐项有处置）

| # | 处置 | 承接任务 | 状态 |
|---|---|---|---|
| D1 | Effects 六 kind 全量照搬（裁剪幅度=0），34 §2.3 保守设计按原样执行 | A12（35:156） | 本评审拍板，A12 交付即闭环 |
| D2 | C9/C11 的四类事件 + sessions 面签名逐条进 `tests/types.seam-pin.ts` | A1 建文件、A14 补断言（35:57/180） | 类型面已钉（本文 §4/§5），测试文件随 A1 |
| D3 | SA `resume()` 对账（`assignmentInterrupted` + pending 重排）与 `AgentDelivery` at-most-once 模式照搬 | A14/A22（35:180/237） | 模式已核（§3.4/§8-C8） |
| D4 | session persistence 为 worker 会话持久层（不自建会话检查点/崩溃恢复）；`worker-<ticketId>` 建在租户 realm 工作区 | A22（35:237） | 本评审确认 |
| D5 | tool-jobs 保留为 worker 内部后台机制（`ctx.jobs`），不入引擎派发链 | A14（34 §2.4 background 行） | 本评审确认 |
| D6 | schedule 作定时 Trigger Source 的可选桥（`source.kind === 'schedule'`）——**v1 不做**，A21 附注登记 | A21（35:232） | 登记，不阻塞 |
| D7 | schedule `deliveryHistory` 与 A13 Outbox receipts 双账风险 | 35 §12 开放问题 7 备注 | 登记（本评审不裁归属） |
| D8 | worker 经 `dsh-tool-schedule` 创建定时任务＝Mandate 外副作用，须 governance 瀑布/subagent_policies 罩住 | A18（35:200） | 登记关注点（C6），处置归 A18 |
| D9 | 版本差实测敞口=0 的结论随 seam-pin 落地保持可回归；upgrade-gate 照守 | A1/A14 + 33 G4-5/G4-6 | 持续门禁 |
| D10 | 本评审结论回填 35 §0-B8（SA 副本路径复核完成、行号抽查 21 处吻合） | 本文 §7 | 本日执行（见 35 号 B8 行补记） |

---

## 9. 验收门禁自证（G2-A12 原判据）

判据：`grep -c "结论" docs/design/reviews/tasks-engine-review.md` ≥1；结论行逐项有处置。本评审完成后的自跑输出见本文末尾「§10 实测记录」命令 8（执行日实测计数 15 ≥1，含 §1 速览、§2 总表结论列、§8 处置各行）。

---

## 10. 实测记录（2026-11-18，评审执行环境 = 本机）

1. 版本核对：`cat node_modules/@deepseek-ai/dsh/package.json` → `"version": "0.2.2-rc.1"`；根 `package.json:26` `"@deepseek-ai/dsh": "0.2.2-rc.1"`；`pnpm-workspace.yaml:24-46` seam 家族 catalog 钉 `0.2.2-alpha.2`。
2. 事件面钉住：`grep -n "agent/status\|agent/error\|agent/inbox/claimed" node_modules/.pnpm/@deepseek-ai+dsh-agent@0.2.2-rc.1_*/node_modules/@deepseek-ai/dsh-agent/lib/types/runtime-types.d.ts` → 109/279/304/437 行命中；逐段 `sed` 读取签名（§4 表）。
3. session/event 钉住：`grep -n "session/event" …/dsh-session/lib/types/index.d.ts` → `:63`；`user/message` → `types.d.ts:300`；SessionEvent 形状 → `types.d.ts:497-516`。
4. 三能力证据：`dsh-jobs`/`dsh-tool-jobs`/`dsh-schedule`/`dsh-session-persistence-jsonl` 四包 README 全文或局限节读取（引文见 §2/§3）；`dsh-schedule` `runtime.d.ts:3-9` MessageSourceMap 扩展实测。
5. 版本差 diff：`diff -q` dsh-agent `runtime-types.d.ts`（alpha.2 `cf3b7946…` vs rc.1 `d9740b81…`）→ IDENTICAL；dsh-session `index.d.ts`+`types.d.ts`（alpha.2 `1c96c846…` vs rc.1 `2c1eb9e8…`）→ IDENTICAL。
6. 消息面 diff：`diff -q` dsh-llm `message.d.ts`（alpha.2 vs rc.1）→ IDENTICAL。
7. SA 复核：对 §7 表 21 处行号逐条 `sed -n` 实测（SA 副本路径见 §7）。
8. 门禁自跑：`grep -c "结论" docs/design/reviews/tasks-engine-review.md` → 本评审写入当日实测输出 `15`（≥1，通过）。

> 局限：本评审为静态类型面 + README + SA 源码评估，未起真宿主跑 e2e（真跑属 A16 模拟宿主 runtime 测试与 G1 门禁范畴）；schedule 的 SQLite 后端路径（`u_schedule_tasks`）实测自其 README 存储节，本仓当前组合使用 JSON 后端与否随部署配置，不影响结论。
