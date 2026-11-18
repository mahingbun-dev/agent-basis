# 24 - 主动工作体系融合设计（任务内核 × chat-demo 交互范式 × EternaAgent 基座）

> 状态：**讨论沉淀 / 待逐项确认**。本文记录 2026-11-16 对 DeepSeek 两个新开源仓库的研读结论、与 EternaAgent 现状的差距分析、融合架构与企业落地方案。
> 定位：这是**决策前的设计探讨**，不是实施排期。文末 §9 列出需要拍板的开放问题。
> 配套：`24a-融合设计决策速览.md`（一页纸评审版 + **拍板记录 2026-11-17 四轮**）· `25-业界架构对照与缺陷清单.md`（**外部依据与风险清单**，本文 §5.5 的 R1–R6 实施契约源自该文）· `26-扩展模型-插件领域包与专业agent.md`（融合后的功能生长方式）· `27-执行者模型与冲突解决-superagent与subagent对照.md`（执行者权力结构与并发控制）· `28-上下文策略-主Session滚动治理与自研压缩替换.md`（R1/R2 的上下文配套）· `29-统一工具编排与工具路由-模型定制工具包.md`（B4 方向）· `30-Subagent工作台与可视化监控.md`（新增范围）· `31-双形态治理-仓库发布迭代与容器切换.md`· `32-最终态开发方法-工作流与里程碑.md`（取代本文 §6）
> 关联：`08-基座插件体系与总体架构.md`、`12-功能点清单与承载方式决策.md`、`09-RSI自进化机制设计.md`、`19-记忆系统开发文档-M-M1至M-M3.md`
> 图示：融合架构与用户操作架构见 Excalidraw 画板 `fused-arch`（工作区 `fused-arch.excalidraw`）

---

## 0. 一句话结论

EternaAgent 已经把**企业护栏**（治理/审计/记忆/自进化/多租户）建完了，缺的是让 agent 能**承接工作**的对象模型。DeepSeek 刚开源的 `dsh-superagent-prototype` 恰好开源了这个模型，且**与本产品同宿主（DSH）**——它的 `src/core/` 零 I/O、零外部依赖，可整体移植为本仓新 L1 插件，**不需要网关桥接**。`chat-demo` 则提供交互范式（流式块归并、报告时间线、任务侧栏、多版本分支）。

融合后的产品定位从「**很懂你的聊天助手**」变为「**能接活的同事团队**」，企业侧的核心卖点从"效率"升级为"**可治理的自动化**"。

---

## 1. 三个参考对象的定位

| | 角色 | 许可 | 规模（实测） | 与本产品的关系 |
|---|---|---|---|---|
| **EternaAgent（本仓）** | 企业级「治理强、被动交互」的平台底座 | MIT | README: 1073 tests / 20 包 | **主角**，要补任务/委派能力 |
| `deepseek-ai/dsh-superagent-prototype` | 「任务内核」：准入→工单→派工→回报的完整对象模型 | MIT | `src` 15,205 行 TS/TSX · 59 个 spec 文件 · 13 个 prompt md · 9 篇编号文档 | **同宿主参考实现**，core 可直接移植 |
| `deepseek-ai/chat-demo` | 「对话表面」：极简交互范式 + 新协议栈示范 | MIT | 155 个文件 · 14,517 行 TS/TSX · 9 个运行时依赖 | **范式基准**；代码不直接用（UI 属上游 SPA） |

**关键结构判断**：superagent 是 Cordis plugin bundle（`dsh ^0.2.1-alpha.2`），本产品锚 `@deepseek-ai/dsh 0.2.2-rc.1`——**版本有差，但 Ports 解耦使其内核可移植**。⚠️ 不要把 superagent 作为第二个 bundle 并装（plugin id / stateDir / panel 路由三重冲突），**只取 core，不装 bundle**。

---

## 2. dsh-superagent 研读：值得移植的是什么

### 2.1 核心思想：注意力经济学

> 「**占用尽可能少的人类注意力，交付尽可能多的价值**」——`docs/000-philosophy.md`

由其推出五条行为律，可直接作为本产品的产品准则：

1. **只在被要求时行动**，或团队明文规则允许时（主动行为先进入「只记录不执行」的观察模式）；
2. **只在人必须行动或能用上结果时说话**——开工确认一次、干活全程沉默、完成/需决策/失败才出声；
3. **一次只问一个具体的结构化问题**；
4. **按影响停止，不按努力停止**；
5. **诚实汇报**——半成品标为半成品，失败报为失败。

### 2.2 领域模型（精华）

```
Source → Trigger → Thread → Eval(Gate+Assessment) → Decision
  → Ticket(+Mandate) → Assignment → Executor → Report(六态)
  → Outbox → Channel
```

概念的判定标准：**Source / Thread / Eval / Mandate / Subscription 是核心域**，其余支撑。文档还专门列了「被拒绝的概念」表（如 Principal 实体、跨源身份映射、等待/撤销的 Eval 状态、一 Thread 一 Ticket）——这种"不引入什么"的记录是最有价值的工程资产。

### 2.3 让「团队协作」成立的六个机制（缺一个就退化成聊天机器人）

| # | 机制 | 解决什么 | 代码位置 |
|---|---|---|---|
| 1 | **准入矩阵**：`列名发送者 × 是否@` → `explicit / inferred / ignore` | 谁的话算派活 | `src/admission.ts` |
| 2 | **Mandate（授权凭证）**：accept 时固化「谁 + 哪版策略 + 范围 + 强度」，不可变；只有人的 stop 才撤销 | 为什么可以做、能做多远 | `src/core/model.ts` |
| 3 | **Subscription 扇出**：工单订阅线程后，后续讨论**无需再 @agent** 自动送达；追问可恢复已结束工单 | 追问不必重复上下文 | `src/core/model.ts` |
| 4 | **Assignment + WorkerSlots**：一工单一个 Session + 独立目录；人可插队占 1 个额外槽 | 并行而不互相踩 | `src/executor/dsh.ts` |
| 5 | **Report 六态 + Attention**：`progress / waiting / ready / blocked / failed / dropped`；问题只走结构化字段 | 何时闭嘴、何时升级 | `src/core/assignments.ts` |
| 6 | **Effects 持久队列 + Outbox 回执**：副作用在事务内排队、提交后执行、失败指数退避 | 崩溃可恢复、消息不重发 | `src/app/effects.ts` / `app/outbox.ts` |

### 2.4 双角色 = 双 prompt 组合 + 双 preset

- 主 Session（`orchestrator`，14 个工具，只读 + 路由 + 评估）→ `prompts/orchestrator.md` + `dispatch.md` + `admission.md` + `handoff-orchestrator.md`
- Worker（6 个工具，拥有实现）→ `prompts/worker.md` + `work.md` + `handoff-worker.md`
- 共享段 → `shared.md`（分工总纲）、`replies.md`（回复纪律）、`subscriptions.md`
- **每次模型请求绑定 prompt 版本**（`app/prompts.ts` + `Versions`），团队可覆盖但不漂移

一个容易被忽略的协作细节：worker 前台命令 **5 秒转后台**（`cordis.patch.yml` 的 `bash-sandbox.timeoutMs:5000`）——目的是**让长命令不阻塞别人插话**。这是「协作」与「单体 agent」的分水岭设计。

### 2.5 工程质量参照

core 零 I/O 零外部依赖；Ports 端口解耦；`tests/class-docs.spec.ts` 强制每个类有 JSDoc；`tests/docs.spec.ts` 校验"文档链接只能指向更早编号的文档"；`tests/model-surface.spec.ts` 校验模型面（工具/prompt/skill）不漂移。**README 自述"含 bug、风格不一致、研究代码"**——移植须视为重写级校对。

---

## 3. chat-demo 研读：可迁移的交互范式

### 3.1 客户端与服务端工具的两层结构（关键认知）

| | 服务端工具 | 客户端工具 |
|---|---|---|
| 谁执行 | DeepSeek 服务端 | 前端/后端 |
| 协议表现 | `server_tool_use` + 结果块，**start 事件即带完整 input，原子下发** | `tool_use` 块流式吐出，`stop_reason: 'tool_use'`，**调用方回灌 `tool_result`** |
| 前端工作量 | 零（只渲染结果卡片） | 完整 tool-call 循环 |
| chat-demo 的选择 | ✅ 全用（`deepseek_web_search` / `deepseek_read_url`） | ❌ 故意不支持：遇 `tool_use` 立即 `prefix: false`（`src/services/chat/reply.ts:88`） |

**chat-demo 里没有客户端工具循环**（`MessageParam` 的 user 内容只允许 `FileBlockParam | TextBlockParam`，连 `tool_result` 类型都未定义）。这不是缺陷，是纯静态无后端下的边界承认。**"快速构建工具包"的正确顺序是四层**：协议类型层 → SSE 层 → 工具循环层（chat-demo 缺的这块）→ UI 渲染层。

### 3.2 SSE 解析是全场最值得逐字读的代码

`src/services/api/sse.ts`（136 行）按 WHATWG 规范实现了三个陷阱的正确处理：

| 陷阱 | 处理 |
|---|---|
| 一个事件被切成半个 | `buffer` 累积，只在空行派发 |
| `\r` 是 CRLF 的半个 | 结尾 CR 不下发，等下一片 |
| 多字节中文被切断 | `TextDecoder.decode(value, {stream:true})` |

### 3.3 其它可复用模式

| 模式 | 位置 | 价值 |
|---|---|---|
| 事件归并为不可变消息 | `chat/reply.ts` 的 `applyEvent`（临时 index → blocks 下标映射，跳过的块不占位） | 流式 UI 的标准做法 |
| 纯函数投影（派生状态） | `chat/view.ts`（blocks → `SearchStep[] / Source[] / 引用角标`） | blocks 需原样回传，故展示层只计算不改数据 |
| 引用引用不变则跳过重绘 | `branches.ts` 的 `buildMessageVersions` | 流式更新不重绘历史消息 |
| 大对象不进 messages | `attachments.ts` + Files API（`file_id` 引用；`purpose` 二选一） | 文档类能力最快落地路径 |
| 导入用「暂存 → 单事务替换」 | `chat/db.ts`（`sessionsStaging` / `filesStaging` + `commitStaging`） | 中途关页面不损坏本地数据 |

---

## 4. EternaAgent 现状差距（附证据）

| # | 缺口 | 证据 | 影响 |
|---|---|---|---|
| G1 | **交互纯被动** | 全仓无 Trigger/Ticket/Task/Mandate/Attention/dispatch/orchestrator/worker 概念；一切工作由用户消息驱动 turn | 用户不发消息，agent 不动 |
| G2 | **审批是唯一跨 turn 挂起物，且半接线** | `interact` 的 `escalate`、`cooling_period_sec`、`double_confirm`、`on_no_answer: escalate` 只有声明，全仓无 `ctx.channels` 消费者；超时=`unavailable`；无「谁欠谁一个回答」台账 | 声明的能力实际不可用 |
| G3 | **授权粒度断层** | 只有全局规则（`governance/src/rules.ts`）+ 单次 `allowed-once`（`access/src/approval-bridge.ts`），中间缺任务级授权委托；治理规则与 `hitl.yaml` 均无版本化 | 任务级"可解释授权"缺位；规则变更时在跑工作不知情 |
| G4 | **channels 已建未挂** | `packages/channels` 的绑定表/webhook/一次性审批令牌/卡片渲染器就绪，但生产 profile 未装配；绑定语义仅 `channel_user → session` | 渠道追问只能续接「会话」，不能续接「工作」 |
| G5 | **会话即一切，粒度太粗** | 一个会话承担对话 + 工作 + 历史三件事，无独立工作对象 | 无法按工作审理、交接、恢复 |
| G6 | **无编排** | 无主/worker 分工、无并发槽、无扇出；定时任务依赖上游 `tool-schedule` 投递 prompt，无结构化对象、不可策略化 | 无法限定并发与成本边界；定时不可审计 |

### 4.1 已有优势（两个参考仓库都没有的）

治理合规栈（规则引擎 deny-wins / fail-closed、预算守卫、PII、egress）· append-only 审计（NDJSON）· 三层记忆（M1 NOTES / M2 实体 / 派生画像，forget = 逆闭包真删）· 知识双后端（FTS5 ↔ WeKnora）· **HITL R0–R3 + 富审批卡 + 提问合并 + 负信号总线** · 受控自进化（G0/G1/G2 门禁 + 进化账本）· 多租户门禁与工作区钳制 · cache-guard · 账号体系。

---

## 5. 融合架构

### 5.1 五层结构

```
① 用户面 · 触达     Web 会话（聊天 + 任务侧栏）/ 移动端 / IM 通道 / 外部事件
        ↓ 一律归一化为 Trigger
② 任务内核         packages/tasks（新建 L1，源自 superagent core）
                   Thread → Eval → Decision → Ticket(+Mandate) → Assignment
                   → Report(六态) → Outbox / Attention
                   【唯一拥有业务状态的地方；Engine 单一事务写入者 + Effects 持久队列】
        ↓ Assignment / Report
③ 执行层 · DSH 内核  主 Session（orchestrator，只读+路由+评估）· Worker Session × N
                   · 工具面 defineTool · 子代理 / 后台 jobs / 定时
        ↕ 挂断点
④ 横切层            governance / interact / audit / memory / knowledge / observe→evolve
                   【不拥有业务状态，只挂内核断点】
        ↓
⑤ 存储             SQLite（内核表）· 审计 NDJSON · 工作区 · 租户 realm
```

**三条方向性约束**：
- **Attention → 用户面**：唯一"从系统回到人"的强制通道；
- **执行层 → 横切层**：治理/审批挂工具面（pre-execute），不是事后审计；
- **Report ← Assignment**：worker 只报六态，不直接与人对话（防越权）。

### 5.2 概念映射（融合的接口清单）

| superagent 概念 | EternaAgent 现成资产 | 对接方式 |
|---|---|---|
| Mandate | governance 规则引擎 + access 用户体系 | accept 时固化命中规则集 + 申请人 + **规则版本**；策略变更经 `policyChanged` 通知在跑工单（**需新增规则版本化**） |
| Attention | **interact 富审批卡 + R0–R3** | attention 卡 = 审批卡超集，直接复用 `card.ts` 渲染管线与 `on_no_answer` 策略 |
| 允许名单 / 准入 | access 用户 + 多租户 realm | allowed list = access 用户；准入表按租户分 realm |
| Executor | access 工作区钳制 + mux + `extra` 的 reviewer preset | worker session 建在租户 realm 内；**不照搬 `git worktree`**（那是编码场景） |
| Source | `packages/channels` 适配器 + webhook 网关 | binding 从 `channel_user → session` **升级为 `→ thread / ticket`** |
| Outbox / Effects | audit NDJSON + sqlite 惯例 | 持久副作用队列照搬设计，落本仓存储规范 |
| Report 六态 | observe 失败信号表 + evolve 负信号 | report 直接喂 observe → evolve 闭环（见 §5.4） |

### 5.3 六个不变量（融合后必须始终成立）

1. 事件先成 Trigger（**幂等 id**，重读安全）；
2. 授权只在 Mandate 里，**只有人的 stop 才撤销**；
3. 报告只说六态，**问题只走 Attention**；
4. 副作用只经 Effects / Outbox（**崩溃可恢复**）；
5. 横切插件**不拥有业务状态**，只挂断点；
6. 每种状态**只有一个写者**（Engine / Source / Settings / Prompts / Effects / Outbox 各司其职）。

### 5.4 差异化：任务闭环 × 受控自进化（两个官方仓库都没有的）

```
report: blocked / failed
   → observe 失败信号表
   → evolve 产出 SKILL delta（五操作）
   → G0 / G1 / G2 门禁
   → worker 下次接同类任务更准
   ↑__________________________________|
```

外加 **`ticket.ended` 挂记忆整固钩子**（现有整固只认 `turn/end`）——"任务尾"成为第二个学习时机。这是「越用越懂你」的**可审计企业版**。

### 5.5 实施契约（R1–R6，移植时必须落地）

> 依据：`25-业界架构对照与缺陷清单.md` §5。这六条**改变 P1 的实施契约，不改变路线顺序**。缺任一条，superagent 式的已知缺陷会被一起继承。

| # | 契约 | 为什么（业界证据） | 落点 |
|---|---|---|---|
| **R1** | **主 Session 预算守卫**：effort scaling 分级（简单 1 agent / 比较 2–4 subagent / 复杂 10+）+ `maxTokens`/`maxCost` 硬截断 | 多智能体 token 约 **15×** chat；token 用量解释 **80%** 性能方差；superagent 全仓**无主动成本上限**，只有事后 `budget_exceeded` 观测 | `governance/budget.ts` + `agent/turn-stopping` |
| **R2** | **`ready` 必须过门禁**：由系统判定（G1 金集 replay），worker 自述作废 | MAST **FM-3.2/3.3**（无验证/验证不正确）是头号失败类；superagent 的 `ready` 仅靠 `prompts/work.md:49` 的 prompt 纪律 | Mandate 执行契约 + `evolve/gates.ts` |
| **R3** | **委派四要素硬约束**：候选卡必须带 objective / output format / tool guidance / task boundaries，缺项则 Eval 拒绝 | Anthropic 实测：模糊委派导致重复劳动、过程缺口、找不到信息；甚至有"为简单查询建 50 个 subagent" | `packages/tasks` 的 Eval 与候选卡 |
| **R4** | **worker 输出落文件系统**：`.ticket/<id>/` 写 progress/决策/evidence，主 Session 读文件而非读消息 | Cognition：跨 agent 隐式决策冲突无解；Anthropic：subagent 输出落文件系统可避免"game of telephone" | executor 适配器 + `orchestrator_read` |
| **R5** | **Attention 显式化**：状态可映射 A2A `input-required`（`taskId`+`contextId` 续接语义）；**但保留「讨论可恢复已结束工单」** | A2A 终态后拒收消息，而真实协作的追问常发生在结案之后——superagent 这点优于标准，不要向标准妥协 | `interact` + tasks 状态机 |
| **R6** | **不重写持久执行引擎**：先评估 DSH 宿主能力（`tool-jobs`/`schedule`/session persistence），再用本仓 SQLite 惯例承接；Temporal 的失败模式清单当 checklist | superagent 自建 effects/outbox 相当于从零手写 mini-Temporal，缺确定性重放与 Worker Versioning | P1 范围收缩 |

**附加确认**：`audit` 从"合规留痕"升级为"调试 trace"（一份数据两用）——一条工单的 Trigger → 候选卡 → Decision 理由 → 委派四要素 → 报告 → 门禁结果全程可查。优于新建 trace 系统。

---

## 6. 分阶段路线

> **2026-11-17 拍板更新：本节组织方式已被 `32-最终态开发方法-工作流与里程碑.md` 取代**——不再按 P0–P3 阶段推进，改为最终态并行工作流。各阶段的**工作内容**仍有效，去向对照见 32 号 §3；本节保留作历史参考。

| 阶段 | 系统侧 | 组织侧 | 验收标准 |
|---|---|---|---|
| **P0（约 1 周）还债** | Attention 台账（移植 `waitsForPerson` / `followupOwners` 谓词）· escalate 接 channels · 冷静期/双确认运行时接线 | 指定 1 名领域专家 + 1 名审批人 | 审批 100% 可在飞书闭环；超时正确升级 |
| **P1（2–4 周）内核** | `packages/tasks` 上线，**先只做 explicit 委托**；worker 建在租户工作区内 | 定首批 3 个高频场景 + 每组 10 条金集 | 3 场景金集 ≥ 90%；无越权工具调用 |
| **P2（约 2 周）表面** | 任务侧栏（按 stage 分组）· 报告时间线（复用 assistant blocks 范式）· Attention 卡片回答 · 多 Assignment 分支切换 | 严守 AGENTS.md：走 slots 扩展点，不建独立页面 | 深浅主题截图自查通过；移动端可用 |
| **P3 差异化** | `inferred` 观察模式（dry-run）→ 放量 · ticket 尾记忆整固 · observe→evolve 闭环 | 主管每周审 dry-run 清单 | 误报率 < 10% 才考虑放行 |

### 6.1 一条铁律（引自 superagent philosophy）

> **「发现它吵，就把 prompt 改短改严或直接暂停，而不是加更多消息去解释吵闹。」**

### 6.2 试点扩面节奏（90 天）

第 1–2 周 P0 还债 → 第 3–6 周 P1 内核（单租户、3 场景）→ 第 7–10 周试点（10–20 名员工，每日审 5 条工单，人的动作 ≤ 5 次/单、退回率 < 20%）→ 第 11–12 周开 `inferred` 观察模式 → 第 13 周起多租户 + 第二领域包，建「红黑名单 + 红线」维护流程。

---

## 7. 企业落地：谁用、怎么用、能做什么

### 7.1 产品隐喻转变

| | 现状 | 融合后 |
|---|---|---|
| 隐喻 | 一个很懂你的**聊天助手** | 一个能接活的**同事团队** |
| 工作归属 | 在会话里，关掉就散 | 在工单里，有主、可恢复、可审计 |
| 人的角色 | 提问者 + 全程盯着 | 发起者 + 关键点判断者 |
| 企业顾虑 | 能聊但不能干事 | **敢让它干事**——每步有授权与红线 |

本质：**把员工的注意力从"搬运和盯着"转移到"判断和验收"上**。

### 7.2 五个角色，五种界面

| 角色 | 在哪操作 | 做什么 | 频率 |
|---|---|---|---|
| **发起人**（业务员工） | Web 会话 / 飞书 / 邮件，**用平常说话的方式** | 说清要什么；回答 Attention；验收 | 每天数次 |
| **审批人**（主管/合规/财务） | Attention 卡（站内横幅 + 飞书卡片 + 邮件链接） | 批 / 拒 / 要求改；R3 双确认与冷静期 | 每周数次，**只在红线处** |
| **领域专家**（业务骨干） | 插件后台：`hitl.yaml` / persona / skills / 知识库 / 金集 | 定义"什么算做好"、红线在哪、写 SOP | 上线前 2–3 天 + 迭代 |
| **平台管理员**（IT） | 设置弹窗分区 + 面板 | 装插件、开租户、配模型网关、看用量与健康 | 每周巡检 |
| **审计/合规** | 审计查询 API + 面板 | 查工单全链路、红线命中率、复盘 | 按季度/事件驱动 |

**关键设计**：发起人不需要知道 Trigger/Ticket/Mandate 这些词，只看到三件事——**侧栏有状态点、该我拍板时弹卡、做完结果回到原对话**。

### 7.3 端到端叙事（一次真实委托）

场景：「帮我把这三家供应商的报价做成对比，出一版给采购总监的材料」

| 时刻 | 发生什么 | 人做什么 |
|---|---|---|
| T+0 | 员工在飞书群 @agent，附三份 PDF | 说一句话 |
| T+2s | Trigger（幂等 id）→ 准入矩阵「名单内 + 明确@」→ explicit → 建 Mandate（范围/强度/策略版本） | 无 |
| T+5s | 主 Session 裁决 accept → Ticket → worker 在独立目录开工 | 无 |
| T+1min | 侧栏出现「工作中」；群里一句轻确认 | 一眼可见 |
| T+8min | 发现两份报价口径不一致（含税/不含税）→ `blocked` + Attention **只问一个问题** | **回答一句话**（唯一必答点） |
| T+20min | 产出材料 → `ready` → Outbox 把结果（文件 + 摘要卡）发回原群 | 验收：通过 / 退回 |
| T+21min | 退回 → 同 Ticket 新 Assignment = 新分支；人直接说"表 2 换成含税口径"，**无需再 @agent** | 说一句话 |
| 任意时刻 | 总监追问"这单为什么这么定" → 审计查全部 Trigger/Decision/审批/工具调用 | 按需 |
| +30 天 | 同类需求再来，worker 因 evolve 学到"报价先问税口径"，不再重复提问 | 无感变快 |

**人的总动作 = 4 次**（发起、答一问、验收、可能的退回说明）。同类工作现状需 2–4 小时人工。

### 7.4 三类典型场景

**场景 1｜日常业务委派（L2 领域包，最快见效）**
以 `event-planning`（30 条金集 + 3 条审批红线）为模板。特征：SOP 明确、产出物明确、红线与钱相关——正适合「工单 + 审批」。度量：金集通过率直接作为上线质量门。

**场景 2｜跨渠道统一受理（把已有系统变成可派活的入口）**
同一个 agent，飞书/微信/邮件/GitHub 都能派活，结果回到发起的那个渠道。企业不必让员工换工具、不必改造现有系统，**只在现有工作流上挂一层**。

**场景 3｜主动巡检（「敢不敢开自主性」的分水岭）**
观察模式先跑 2 周（只记录"这里本可以做什么"）→ 主管每日审清单 → 命中率高且误报低才按 `auto` 档放行规则内的主动行为。可落地的前提正是：**governance deny-wins + Mandate 策略版本 + 审计**，使主动行为可回滚、可解释、可关闭。

### 7.5 优势清单（按决策者视角）

**业务负责人**
| 现状痛点 | 融合后 |
|---|---|
| AI 只给建议，落地靠人 | 直接产出**可交付物** |
| 成果散在各人聊天记录 | 工单**有归属**，可追溯/交接/恢复 |
| 员工盯 AI 反而更累 | 注意力只花在**判断点**，其余沉默 |
| 同类工作每次重新解释 | Subscription + memory + evolve → 越用越准 |

**IT / 平台**
| 优势 | 依据 |
|---|---|
| 零内核改动 | 全为 Cordis 插件；DSH 升级不拖代码（`upgrade-gate.md` SOP 已有） |
| 单机可跑、内网闭环 | docker compose 一键；模型走自建网关；数据不出内网 |
| 多租户隔离 | access 的 realm 钳制 + mux 隔离，工单层只需继承 |
| 成本可控 | 预算守卫（maxTurns/Tokens/Cost）+ cache-guard + 并发槽限流 |
| 可回归 | 本仓 1073 tests + superagent 59 spec 双向验收 |

**合规 / 审计**
| 优势 | 依据 |
|---|---|
| 每条授权可解释 | Mandate 固化「谁 + 哪版策略 + 范围 + 强度」，不可变 |
| 红线不可翻案 | deny-wins、fail-closed；内核保证 deny 不可被审批回翻 |
| 全链路留痕 | audit NDJSON append-only：Trigger→Decision→审批→工具调用→交付 |
| 人的撤回权唯一 | 只有手动 stop 撤销 Mandate；策略变更只通知不撤销（避免半途废弃） |

### 7.6 风险与对策

| 风险 | 表现 | 对策 |
|---|---|---|
| 规则维护成为新负担 | 准入表/红线无人维护而失真 | 指定 owner；规则纳入变更流程（版本化后必须） |
| 调试成本转移 | 从"写代码"变成"调 prompt + 金集" | dsh-evals 每次改动跑回归；prompt 版本绑定请求 |
| 过度打扰 | Attention 滥用，人开始无视卡片 | 强制「一次一问 + 进度不进 IM」；面板只列待人项 |
| worker 权限过宽 | 无审批跑命令 | R2/R3 必须罩住 worker 工具面；沙箱 + egress 白名单 |
| 研究代码移植风险 | superagent 含 bug、风格不一致 | 视为重写级校对，用其 59 个 spec 当验收清单 |
| 期望管理 | 「是不是什么都能干」 | 明确：只有写了规则的才主动，只有给了授权的才跨界 |

---

## 8. 采纳 / 不采纳清单

### 8.1 采纳（设计原则级）

1. **注意力经济学** → panel 与通知的设计准绳（面板只显示需要人的东西）；
2. **诚实报告六态** → worker/report 枚举 + "半成品标为半成品"纪律（与负信号体系同源）；
3. **一次只问一个具体问题** → interact 提问合并已有，补"升级不并发"纪律；
4. **prompt 版本绑定每次请求** → prompt-studio 已有版本库，补运行时绑定；
5. **观察模式先行** → governance dry-run 档；
6. **模型面 drift 测试**（`tests/model-surface.spec`）→ 采纳为工程纪律；
7. **单写者原则 + 持久副作用队列** → 内核状态管理范式。

### 8.2 不采纳

- superagent 的 GitHub / 飞书 Source 实现（channels 已覆盖且更广）；
- 其面板与 HTTP 层（本仓有 panel 纪律与多租户要求）；
- 其「单团队单仓库」假设（Ticket / Policy 必须带 realm 维度）；
- chat-demo 的存储层与协议客户端（会话归属上游 DSH；BYOK 不符合本仓账号门禁模型）；
- 任何"第二个 bundle 并装"的方案（三重冲突）。

### 8.3 工具包构建的四条纪律（源自 superagent `app/tools/tool.ts`）

- schema 用 `.strict()` + 默认值 + `.describe()` —— 模型面就是 API 面；
- 工具描述给出**资源语法**，让模型知道边界；
- 执行函数必须接 `AbortSignal`；
- 每个角色只给它该有的工具面（主会话 vs worker 不同，防越权）。

> 本仓已有 `defineTool` seam 可参照实现：`packages/memory/src/tools.ts:282`、`packages/knowledge/src/tools.ts:332`；注册即 `ctx.tools.register(def)`，返回 disposer 必须进 `ctx.effect`。

---

## 9. 待拍板的开放问题

以下问题本文未给出结论，需要讨论确认：

1. **P0 的取舍**：Attention 台账与 escalate 接线是否值得先做？还是直接进 P1 内核、把 Attention 一并实现？（前者零风险、独立可交付；后者省一次重构）
2. **规则版本化的落点**：`governance/src/rules.ts` 现在是免重建热改的 YAML，加版本化会不会损害"运维热改"的便利？可能的折中：版本号由文件内容 hash 派生，热改即产生新版本，历史可查。
3. **realm 维度如何进内核**：Mandate / Ticket 的 realm 字段放在内核模型里，还是由 `packages/tasks` 在 Engine 外层做租户过滤？（前者不变量更硬，后者改动更小）
4. **worker 的权限模型**：superagent 的 worker 以操作者 OS 用户身份无审批跑命令。本仓 R2/R3 罩住 worker 工具面是否足够？是否还需要专用 worker 沙箱？
5. **Source 的边界**：channels 升级为 Source 层后，GitHub 类的事件源是否仍需要单独的 Source 实现，还是完全复用 channels 的适配器接口？
6. **首批 3 个场景选型**：候选是（a）event-planning 现有领域包、（b）跨渠道受理、（c）主动巡检。是否按此顺序？还是先做跨渠道（对现有工作流侵入最小）？
7. **chat-demo 的定位**：仅作范式参考，还是在未来某个时点做轻量 BYOK 入口（面向外部客户/个人）？若做，与本仓账号门禁模型如何并存？
8. **是否贡献上游**：内核中的 realm 与 Policy 版本化等改动，是否有价值向 DSH 上游提 PR（MIT，可贡献）？

---

## 10. 附录

### 10.1 学习路径（5 天）

| 天 | chat-demo（1–2h） | superagent（2h） |
|---|---|---|
| D1 | `api/types.ts` → `api/sse.ts`（逐字） | `docs/000-philosophy` + `001-domain` |
| D2 | `chat/reply.ts` 的 `applyEvent` + `toRequestMessages` | `core/model.ts` + `core/engine.ts` 的 5 part |
| D3 | `chat/view.ts`（投影）+ `attachments.ts` | `core/tickets.ts` + `core/assignments.ts` |
| D4 | 自建一个客户端工具循环（当玩具） | `executor/dsh.ts` + `app/effects.ts` |
| D5 | `chat/history/README.md` | `prompts/*.md` 全部 + `cordis.patch.yml` preset |

### 10.2 代码索引

**dsh-superagent-prototype**
- 领域核心：`src/core/`（`engine.ts` / `model.ts` / `ports.ts` / `intake.ts` / `evals.ts` / `tickets.ts` / `assignments.ts` / `replies.ts` / `stage.ts` / `reasons.ts` / `ids.ts` / `memory.ts`）
- 适配器：`src/executor/dsh.ts`（673 行，WorkerSlots / launch / delivery）· `src/app/assessment.ts`（MasterAssessor）· `src/sources/`（GitHub / 飞书）
- 基础设施：`src/app/effects.ts` · `src/app/outbox.ts` · `src/app/store.ts`（SQLite）· `src/infra/`
- 配置与表面：`src/admission.ts` · `src/policy.ts` · `src/limits.ts` · `src/kv.ts` · `prompts/` · `skills/` · `cordis.patch.yml`
- 文档：`docs/000`–`008`（philosophy / domain / authorization / execution / prompts / panel / deployment / architecture / cookbook）

**chat-demo**
- 协议：`src/services/api/{types,client,sse,parseEvent,errors,speech}.ts`
- 会话与存储：`src/services/chat/{reply,store,branches,db,view,drafts,history/}.ts`
- 表面：`src/components/{messages,search,markdown,settings,chatInput,sider}/`
- 构建：`rspack.config.ts`（`createConfig({ apiOrigin })`）

**本仓待改造点**
- `packages/interact/src/{hitl,presets,card,ask,negative}.ts`（P0 接线）
- `packages/governance/src/{rules,budget,pii,egress}.ts`（规则版本化）
- `packages/channels/src/{binding,webhook,token,cards}.ts`（binding 升级）
- `packages/access/src/{approval-bridge,tenant,mux}.ts`（realm 与审批桥）
- `packages/{memory,observe,evolve}`（ticket 钩子与闭环）
- 新增：`packages/tasks/`（内核移植）
