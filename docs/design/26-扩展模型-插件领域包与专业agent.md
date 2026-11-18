# 26 - 扩展模型：插件、领域包与专业 Agent（融合后的功能生长方式）

> 状态：**讨论沉淀 / 待逐项确认**。本文回答融合改造（见 `24` 号）后的三个落地问题：现有插件机制如何适配、后续加功能的判定思路、"制作不同专业的 agent"的标准做法。
> 定位：`24` 号（融合设计）与 `25` 号（业界依据）之后的**扩展指南**，面向后续所有功能新增决策。
> 关联：`24-主动工作体系融合设计-任务内核与chat-demo范式.md`（含 §5.5 实施契约 R1–R6）、`25-业界架构对照与缺陷清单.md`、`27-执行者模型与冲突解决-superagent与subagent对照.md`（§6.2 包间协作的机制依据、worker 段的 subagent_policies）、`12-功能点清单与承载方式决策.md`（承载方式 A/B/B'/S/L2/D? 五准则）、`13-活动策划领域包v0草案.md`、`docs/PLUGIN-AUTHORING.md`、`tools/packctl`
> 日期：2026-11-17

---

## 0. 一句话结论

**"添加插件还是做一个 agent"是伪二选一**——在本架构里，"专业 agent"不是被"做"出来的新东西，而是 **L2 领域包在运行时的装配产物**。现有 L1/L2 分层已经内置了这个答案；融合只是让领域包从"定义一个会聊天的助手"升级为"定义一个能接工单的专业员工"。

---

## 1. 心智模型：三层职责

```
「谁干这个活」（专业）   →  L2 领域包    persona · skills · 知识 · 红线 · 金集   ← 领域专家维护
「怎么干活」（能力）     →  L1 插件      tasks · governance · memory · channels  ← 平台团队维护
「在哪干活」（运行时）   →  DSH 内核     Session · preset · 工具 seam · 审批瀑布 ← 官方维护，零改动
```

| 层 | 回答的问题 | 判定特征 | 维护者 |
|---|---|---|---|
| **L1 插件** | **How**——横切所有行业的能力 | 换一个行业它依然成立（授权、记忆、审计、渠道） | 平台团队 |
| **L2 领域包** | **What**——一个行业的专业内容 | 换一个行业它就不成立（合同审查的 SOP 对活动策划无意义） | 领域专家 |
| **DSH 内核** | **Where**——运行时宿主 | 官方演进，本仓零改动（upgrade-gate SOP） | DeepSeek |

**专业 agent = 包 × 运行时**：一个 worker Session 被领域包装配出来——不是新插件、不是新进程、不是新代码仓。用户看到的是"@法务 合同审查"，系统看到的是"某 realm 内、按某包内容合成的 worker preset + persona + skills + 知识 + 红线 + 验收"。

---

## 2. 现有插件如何适配（逐包清单）

关键原则：**插件机制本身（Cordis seam、`ctx.*` 接口、双面插件形态）一个都不改**。融合只新增一个 L1 插件（tasks），其他包各自挂上它的钩子。

| 包 | 适配程度 | 具体变化 |
|---|---|---|
| **tasks**（新增） | — | 唯一新增 L1：Engine / Mandate / Ticket / Subscription / Effects / Outbox / Attention |
| **governance** | 中改 | ① 规则版本化（Mandate 须钉版本，方案待定，见 `24` §9-2）；② 预算守卫从 turn 级扩展到**工单级**（R1）；③ 准入矩阵归 tasks，但**名单源是 access 用户**；④ deny-wins 瀑布天然罩住 worker 工具面，无需改 |
| **interact** | 中改 | ① 审批卡升级为 Attention 卡（超集，复用 `card.ts` 渲染管线）；② `escalate` / `cooling_period_sec` / `double_confirm` 接线（P0）；③ 提问合并保持，新增"升级不并发"纪律 |
| **channels** | 中改 | ① 生产 profile 正式挂载；② binding 从 `channel_user → session` 升级为 `→ thread / ticket`；③ webhook 网关获得 Source 角色（事件归一化为 Trigger）；④ `cards.ts` 增加报告六态渲染 |
| **memory** | 小改 | 整固触发器增加 `ticket.ended` 钩子（第二学习时机）；M2 实体库记录工单产出 |
| **observe** | 小改 | 失败信号表直接消费 report 六态；成本指标按工单聚合（喂 R1） |
| **evolve** | **大改（价值最高）** | G1 金集 replay 从"发布门禁"升级为验收体系的一部分（R2，见 §5.2 成本注意） |
| **knowledge** | 小改 | `knowledge_search` 按包作用域；worker 经现有工具读取 |
| **audit** | 小改 | 从合规留痕升级为调试 trace（一份数据两用）：Trigger → Decision → 委派 → 报告 → 门禁全链可查 |
| **access** | 小改 | Ticket / Mandate 继承 realm；allowed list = access 用户表 |
| panel / prompt-studio / brand / cache-guard / llm-doctor | 不变 | — |

### 2.1 插件机制本身的三个适配点（就这三处，其余不动）

1. **tasks 对外暴露服务**：其他包经 Cordis inject 消费 `ctx.tasks`（订阅 `ticket.ended` 等领域事件）——与消费 `ctx.audit` 的模式同构；
2. **租户铁律继承**：tasks 持久化走 DSH_HOME 语义 + realm 分库（对齐 `packctl tenant-scan` CI），路由面不与 access 冲突；
3. **UI 铁律继承**（AGENTS.md）：任务侧栏 / Attention 卡全走 slots 扩展点，不建独立页面，深浅主题截图自查。

---

## 3. 后续加功能的决策树

扩展 `12` 号文档的五条判定准则（有 seam 吗 / 能否强制 / 平台还是行业 / 内核代价 / 数据面控制面），融合后**先问"这个功能属于哪层"**：

```
新功能需求
  │
  ├─ 是"某个行业怎么做事"的内容？（人设 / SOP / 红线 / 验收标准）
  │    → 做进 L2 包（或新建包）── 这就是"做一个专业 agent"
  │
  ├─ 是"所有行业都需要的能力"？（新记忆机制 / 新治理规则 / 新任务状态）
  │    → L1 插件（有 seam 就插件；无 seam 先上游 PR，最后才内核 patch）
  │
  ├─ 是"一个新的触达入口"？（新渠道 / 新事件源）
  │    → channels 适配器 / Source kind，不是独立插件
  │
  ├─ 是"一个新工具"？（模型可调用的一个动作）
  │    → defineTool 配方（见 §4.3）
  │
  └─ 是"一个独立的执行者"？（跨组织 / 跨厂商的外部 agent）
       → A2A 对接（远期），不进本仓
```

**判断口诀：改内容 → 包；加能力 → 插件；加入口 → 适配器；加动作 → 工具；加外部执行者 → 协议。**

---

## 4. 制作专业 Agent = 制作 L2 领域包

### 4.1 包格式的 5 个新增声明段

现有段（persona / skills / tools / policies / knowledge / hitl.yaml / 金集）**全保留**，融合后新增：

| 新增段 | 内容 | 服务的契约 |
|---|---|---|
| `worker` | 预设**增量**：工具白名单增删、沙箱级别、模型档位 | 保持 preset 数量 O(1)：平台只有一个默认 worker preset，包声明增量，tasks 建 Session 时合成（见 `25` 号卡点 3 的教训：不按专业复制整套预设） |
| `deliverable` | 交付物定义：什么算"完成"（报告结构 / 文件格式 / 必含字段） | R2 的**结构性判定依据**（可程序校验的部分） |
| `acceptance` | 金集即验收：10–30 条任务 + 通过标准 | 一份数据两用：G1 发布门禁 + R2 运行时验收（运行时成本注意见 §6-3） |
| `effort` | 档位声明：simple / compare / complex + 单工单成本上限 | R1 effort scaling + 预算守卫 |
| `bindings` | 默认渠道绑定与展示名（"@法务 合同审查"） | 用户面与跨渠道受理 |

### 4.2 七个标准步骤（全用现有工具链）

```bash
# 1. 脚手架（packctl 增加上述 5 段模板）
node tools/packctl/bin/packctl.mjs init <industry> --root packs

# 2. 写专业内容：persona（懂什么）+ skills（怎么做事）+ knowledge（语料）
# 3. 定义红线：hitl.yaml —— 该行业哪些动作 R2 需确认、R3 高危
# 4. 定义工具：优先复用 L1 已有工具；缺的按 §4.3 配方新增
# 5. 写验收：deliverable 契约 + 10~30 条金集（先小后大；Hamel：~20 条起步）
# 6. 验证三连：
node tools/packctl/bin/packctl.mjs lint packs/<industry>                        # G0
node tools/evals/bin/dsh-evals.mjs run --pack packs/<industry> --adapter replay # G1 ≥90%
# 7. 影子运行（观察模式）→ 单租户试点 → 放量
```

**分工效果**：领域专家（法务/财务/行政）**不写任何平台代码**，只填包内容；平台代码只有 tasks 一份，所有专业共享。

### 4.3 新工具配方（30 分钟/个，源自 `25` 号 §3.2 共识）

```ts
defineTool({
  name: '<pack>_<action>',
  description: '何时用 / 给什么 / 资源语法边界',
  parameters: z.object({ ... }).strict(),   // schema 即 API 面
  output: /* 结构化输出，工具即 JSON */,
  execute: async (args, signal) => { /* 必须接 AbortSignal */ },
})
// 注册：ctx.tools.register(def) → disposer 进 ctx.effect
// 治理：governance pre-execute 瀑布自动覆盖，无需工具自写权限
// 回归：进 pack 金集 + model-surface 检查
```

四条纪律：`.strict()` + 默认值 + `.describe()`；描述给资源语法；必接 `AbortSignal`；按角色给工具面（主会话 ≠ worker）。

---

## 5. 完整示例：法务合同审查 Agent

| 步骤 | 内容示例 |
|---|---|
| **persona** | "你是合同审查专员，输出风险分级意见书；不确定的法条必须引用知识库原文，不得凭记忆断言" |
| **skills** | `review-standard-terms.md`（标准条款清单）、`risk-grading.md`（A/B/C 分级）、`redline-extraction.md` |
| **knowledge** | 公司合同模板库、历史审查意见、适用法规（FTS5 ↔ WeKnora 现成） |
| **hitl.yaml 红线** | 对外发送审查意见 → R3（escalate + 冷静期）；修改条款建议 → R2；纯阅读分析 → R0 |
| **工具** | 复用 `knowledge_search` / attachments 读取；新增 `clause_extract`（条款抽取） |
| **deliverable** | 意见书必含四段：风险等级 / 条款原文引用 / 修改建议 / 法条出处——缺一不 ready |
| **acceptance** | 20 条金集，含 3 条"陷阱合同"（知识库没有的条款——**必须拒答而非编造**） |
| **effort** | compare 档；单工单成本上限（R1） |
| **上线后闭环** | worker 报 `blocked`（"甲方模板缺违约条款上下文"）→ observe 信号 → evolve 产 skill delta → G0/G1 → 下次自动先查模板库 |

---

## 6. 三个边界问题（已有答案，提前钉死）

### 6.1 每个专业一个 orchestrator？——不要

主 Session（准入/路由）保持**全局一个**（按 realm 分实例）。理由：
1. 准入矩阵是**组织级**规则，不是专业级；
2. "路由到哪个包的 worker"只是 Eval 的一个分类输出（"这是合同审查类请求"）；
3. 多 orchestrator 会撕裂注意力经济——同一个"待审清单"出现在 N 个地方。

**专业的边界在 worker 装配层，不在路由层。**

### 6.2 包之间要协作怎么办？

"合同审查"发现需要财务复核 → 正确做法是 orchestrator **开一个新 Ticket**（财务包的 worker 接手），而不是两个 worker 直接对话。

依据：`25` 号卡点 3——跨 agent 隐式决策协调当前不可靠（Cognition）；用**工单交接**（结构化、带 Mandate、可审计）替代 agent 互聊。新工单可以引用原工单（`referenceTaskIds` 语义，与 A2A 对齐）。

### 6.3 什么时候才真的"做一个独立的 agent"？

只有两种情况：
1. **外部世界的 agent**（别的公司/别的框架）→ A2A 对接，不进本仓；
2. **某专业的运行时需求大到 preset 增量表达不了**（如需独立沙箱镜像）→ 那也不是新插件，而是新增一个**平台级 preset**，包声明引用它。

---

## 7. 待拍板的开放问题

1. **packctl 新增段 schema**：`worker` / `deliverable` / `acceptance` / `effort` / `bindings` 五段的具体格式与 lint 规则，是否按 §4.1 方向设计？
2. **R2 运行时验收的成本**（重要）：每工单跑全量金集 replay 不可行（20–30 条 × 每条多次模型调用）。建议分层——`deliverable` **结构校验**每单必跑（纯程序，近零成本）；金集 replay 仅**发布门禁**全跑 + 运行时对高风险工单**抽样**或按需触发。需确认此分层是否符合 R2 原意。
3. **effort/成本上限的计量单位**：token、金额还是"工单积分"？与 `governance/budget.ts` 现有 maxTokens/maxCost 如何统一？
4. **包间工单交接的语义**：新 Ticket 引用原 Ticket 时，Mandate/授权是否独立？原 Ticket 是否订阅新 Ticket 的线程（Subscription 关联）？
5. **平台级 preset 清单**：默认 worker preset 之外，第一年是否需要第二个（如"高隔离 worker"）？还是坚持 O(1)？
6. **领域专家的维护界面**：包内容（persona/金集/红线）由领域专家维护，但他们不用 IDE——是否需要经 prompt-studio / panel 提供受控编辑面（走 R3 审批）？还是 v1 由工程代维护？

---

## 8. 与既有文档的关系

```
12（承载方式五准则）──扩展──→ 本文 §3 决策树（先问属于哪层）
13（活动策划领域包草案）──演进──→ 本文 §4 包格式新增 5 段
24（融合设计 §5.5）──实施契约──→ 本文 §4.1 各段服务的 R1/R2 引用
25（业界对照）──依据──→ 本文 §6.2 工单交接（卡点 3）、§4.3 工具配方（12-Factor）
```

本文不改变 `24` 号的路线与排期，只定义**路线走完之后的持续扩展方式**。
