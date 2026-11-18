# 28 - 上下文策略：主 Session 滚动治理与自研压缩替换

> 状态：**讨论沉淀 / 三件实施小事待做**。本文回答两个衔接问题：① superagent 主 Session 如何治理上下文滚动与压缩（研读结论）；② 融合后能否用本仓迭代过的压缩系统（M-C1→M-C3）替换上游 `dsh-compaction-basic`（结论：能，且生产已替换，融合场景照搬即可）。
> 定位：`24` 号实施契约 R1（预算守卫）与 R2（ready 过门禁）的**上下文配套专题**，衔接本仓压缩线文档（21/22/22a/22b）。
> 关联：`24-主动工作体系融合设计-任务内核与chat-demo范式.md`、`25-业界架构对照与缺陷清单.md`（卡点 1 上下文成本、卡点 2 验证）、`26-扩展模型`、`27-执行者模型与冲突解决`、`21-压缩系统产品设计-会话连续性与分层保真.md`（D1–D6 决策）、`22a-summary-model-eval.md`、`22b-压缩系统实施报告.md`、`packages/compaction`、`profiles/eterna-web/cordis.patch.yml`
> 日期：2026-11-17

---

## 0. 一句话结论

superagent 对上下文问题的答案是三层递进——**结构上让上下文可丢**（状态外置 + 决策局部化）、**机制上限制生长**（入站预算 + 工具修剪 + 通知不唤醒）、**协议上兜底恢复**（压缩后对账 + 幂等键）。它没做的（压缩后路由质量度量、成本上限、保留策略定制）恰好是本仓能补的：**压缩契约可插拔已在本仓验证并生产挂载**（`@eterna/compaction/*` 四件套），融合后 tasks 的 preset 归我们定义，替换只是"写 preset 时挂自己的压缩组"。剩余三件小事见 §7。

---

## 1. superagent 主 Session 的上下文策略（研读结论）

### 1.1 核心思想：上下文是"缓存"，不是"账本"

**状态外置**——所有持久状态（Trigger/Thread/Decision/Ticket/Assignment）在 SQLite，主 Session 经 `orchestrator_read` 按需读取；上下文里流动的只有候选卡、报告、通知三类事件流水。

**决策局部化**——每个候选卡是**自包含决策包**，裁决不依赖历史记忆：

| 决策依据 | 提供方式 |
|---|---|
| 触发原文 | 卡片文本 ≤4000 字符 |
| 对话上下文 | 线程窗口：前 5 条 + 触发点前后各 5 条（400/1200 字符），其余折叠为 50 字符存根 |
| 相关工单 | `related_tickets` ≤8（open 优先）+ `tickets_total`——**Engine 计算，不靠模型记忆** |
| 策略版本 | `policy_version` |

**推论**：压缩丢掉历史，丢不掉任何待决候选的决策依据——这是"压缩安全"的结构性保证。

### 1.2 四层滚动/压缩机制

| 层 | 机制 | 事实来源 |
|---|---|---|
| **① 入站有界化** | 候选卡 ≤4000 字符；窗口消息 ≤400/1200；报告摘要 ≤600；ack ≤100 词；路由注释 ≤30 词；委派任务书 ≤1500 字符；反向纪律 "Never read detailed transcripts to invent a plan" | `prompts/dispatch.md` / doc 007 |
| **② 工具结果修剪** | router 与 worker preset 均挂 `toolResultPruner: true`——上下文大头（`orchestrator_read` 分页结果）用完即修 | `cordis.patch.yml`（已核实） |
| **③ 上游压缩栈** | router 挂 `compaction` 组（`isolate: {compaction: true}` + `compaction-basic`）——与 worker 相同 | `cordis.patch.yml`（已核实） |
| **④ 减少滚动本身** | 通知注入**不唤醒**（不触发 turn）；relay 批量合并（一波 followup = 1 次调用）；不自嗨（自己执行的操作不发冗余通知） | `app/notices.ts` / doc 007 |

### 1.3 压缩后的恢复协议（最易被忽略的一环）

`prompts/dispatch.md:44`：**"Check ticket summaries after compaction to avoid duplicate work."**

三层兜底，不靠"希望模型记得"：
1. **prompt 纪律**（上句）；
2. **工具支撑**（`orchestrator_read tickets` 随时可读全部工单状态）；
3. **幂等兜底**（"An accept is idempotent by trigger ID"——即使压缩后误判，重复 accept 也不产生第二张工单）。

### 1.4 决策空间刻意做小（"事情太杂"的解）

主 Session 是**分类器不是规划器**：只有 `accept / attach / stop / ignore` 四个动作。dispatch.md 明令禁止超纲（不读代码、不评估技术范围、不设计方案权、不改写请求——"'Could we add a dark mode?' 应以原文到达，不带 router 自选的配色方案或维护计划"）。**分发质量与上下文杂音基本解耦：每个判决都是局部自包含分类**。提示词总量本身有 CI 预算（`tests/model-surface.spec.ts`）。

### 1.5 残余弱点（→ 本仓补）

| 弱点 | 本仓对策 |
|---|---|
| `compaction-basic` 是保守基础款，无"保什么"定制 | 本仓压缩线已迭代（见 §2）；另加活跃工单清单 section（§6） |
| 压缩后路由质量**零度量** | 路由回归金集（§5） |
| 无主动成本上限 | R1 已覆盖（effort 分级 + maxTokens/maxCost 硬截断） |

---

## 2. 自研压缩替换：已完成，无需新技术工作

### 2.1 契约可插拔 + 生产已替换（事实）

`profiles/eterna-web/cordis.patch.yml:208-238` 压缩组挂载的已是本仓实现（`id` 保留占位、`name` 已换）：

```yaml
- id: compaction            # cordis:group；isolate: compaction + toolResultPruner + staleToolResultPruner
  config:
    - id: stale-tool-result-pruner   # @eterna/compaction/stale-plugin（L2 陈旧清理，先泄压后摘要）
      config: { keepGroups: 5, minSavingsTokens: 4096, thresholdRatio: 0.7 }
    - id: compaction-basic           # @eterna/compaction/basic-plugin（沿用上游默认参 0.8/0.16/重试1）
      config: {}
    - id: command-compact            # @eterna/compaction/command-plugin
    - id: tool-result-pruner         # @eterna/compaction/pruner-plugin（8192/4096/1024）
```

验收证据（`22b` 实施报告，全部【实测】2026-11-14）：包级 **192 测试全绿**（14 spec，含 evals-golden 25 用例）；eterna-web 真实 boot 门禁 15 项 PASS（22 cut rows inactive / kept rows active）；embed dump-config 探针断言**上游行 `disabled: true`**；`tenant-scan` / `prompt-scan` 零 findings。

### 2.2 上游默认参数对照（basic-plugin 沿用，未覆写）

thresholdRatio 0.8 · retainRatio 0.16 · 重试 1——与上游 `dsh-compaction-basic` 默认一致，`config` 留空便于按部署调参（profile 内注释原文）。

---

## 3. 融合场景的落点：tasks 的 preset 由我们定义

融合后 router/worker preset 定义在**本仓自己的** patch / 插件里（superagent 在其 `cordis.patch.yml` 定义 `dsh-superagent-router/worker`，我们对等定义）。替换不是侵入上游，而是**写 preset 时直接挂自己的压缩组**：

```yaml
# tasks orchestrator preset 内（对照 superagent router preset 的 compaction 组）
- id: compaction
  name: cordis:group
  group: true
  isolate:
    compaction: true
    toolResultPruner: true
    staleToolResultPruner: true
  config:
    - id: stale-tool-result-pruner      # 行序保留：先陈旧清理泄压，后摘要压缩
      name: '@eterna/compaction/stale-plugin'
      config: { keepGroups: 5, minSavingsTokens: 4096, thresholdRatio: 0.7 }
    - id: compaction-basic
      name: '@eterna/compaction/basic-plugin'
      config: {}                        # 或按 orchestrator 场景调参
    - id: command-compact
      name: '@eterna/compaction/command-plugin'
    - id: tool-result-pruner
      name: '@eterna/compaction/pruner-plugin'
      config: { thresholdChars: 8192, headChars: 4096, tailChars: 1024 }
```

与通用替换相比风险更低：preset 归我们，无上游覆盖问题；上游 `dsh-compaction-basic` 从未挂载，无并存冲突。

---

## 4. 四个注意点

| # | 注意点 | 说明 |
|---|---|---|
| 1 | **契约版本钉住** | basic-plugin 实现的是 `@deepseek-ai/dsh 0.2.2-rc.1` 的 compaction 契约；DSH pre-stable 期契约可能变（rc.3 曾全仓改名不留兼容）→ 纳入 `upgrade-gate.md` 门禁清单 |
| 2 | **行序保留** | stale 层排在 basic 之前是有意的（agent/pre-step 先于摘要层泄压，22 号 §4-C6）——调换顺序会导致陈旧清理在摘要后才动手，白烧一次摘要模型调用 |
| 3 | **cache-guard 联动** | 每次压缩打断 KV 缓存前缀（DeepSeek 缓存价差 ~50×）→ 建议在 cache-guard 监控中**给压缩事件打标**，命中率下降时可区分"压缩导致"vs"前缀污染"，避免误报掩盖真问题 |
| 4 | **摘要模型按角色分档** | 22a 已做 summary-model-eval。主 Session 压缩质量直接影响分发裁决（丢掉的"关键微妙上下文"正是重复/冲突判决依据），worker 影响单工单实现 → 主 Session 用更高档摘要模型（或至少分档配置），成本差异由 R1 工单预算吸收 |

---

## 5. 度量补全：路由回归金集（压缩后跑一遍）

上轮研读的最大缺口：superagent 的压缩后恢复只有 prompt 纪律，**无任何路由准确率度量**。本仓已有半套基建：

| 侧 | 现状 | 依据 |
|---|---|---|
| 压缩质量回归 | ✅ 已有：`evals-golden`（25 用例：关键事实召回 / 误报率） | doc 21 **D4**："压缩比不是质量指标；golden 回归是 prompt 与阈值改动的前置门禁" |
| **路由质量回归** | ❌ 待建 | 本文新增 |

**方案**：新建**路由金集**（30–50 条候选 → 裁决对：明确的 accept / 应 attach 到已有工单 / 应 ignore 的 bot 消息 / 应 stop 的），**在压缩后的会话状态上跑**，度量分发准确率衰减。复用 dsh-evals replay 适配器与 evals-golden 基建。

**定制品**：doc 21 **D3**（用户指令逐字保留）与 Mandate 天然契合——把"触发原文"列为压缩的强制保留项。

**验收口径**：压缩前后路由金集通过率差 ≤ 2 个百分点视为无衰减；衰减超标则调整摘要模型档位或保留策略（§6），不允许靠改 prompt 纪律硬扛（25 号教训：干预效果混合，结构性方案优先）。

---

## 6. 活跃工单清单 section（保底摘要，压缩的互补件）

给主 Session 增加一个 **system prompt section：活跃工单清单**，由 tasks 插件经 prompt section seam 注入（已有模式，同 dsh-memory 渐进披露）：

```
[active-tickets]
T-3f2a 合同审查｜working｜等 worker
T-9c81 报价对比｜person/answer｜等你回答（Attention #12，已 4h）
T-1d07 活动排期｜working/queued｜排队（2/4 槽）
```

一行一张：id + 阶段 + 等谁。**压缩无论怎么摘要，"当前有哪些活、各等谁"永远在场**——比指望压缩算法保住它可靠得多。这正是 superagent 靠 `dispatch.md` 那句"压缩后主动对账"想达成的目标的结构化版本：从"指望模型想起来去读"变成"状态常驻 prompt"。

预算约束：清单行数随活跃工单线性增长 → 设上限（如 20 行，超出折叠为 `…+N more, orchestrator_read tickets`），由 `model-surface` 体积预算测试看护。

---

## 7. 实施清单（三件小事）

| # | 事项 | 工作量 | 依赖 |
|---|---|---|---|
| 1 | tasks preset 压缩组照搬（保留行序；上游 compaction-basic 不挂载） | 小（P1 preset 定义时顺手） | P1 `packages/tasks` |
| 2 | cache-guard 给压缩事件打标 | 小（监控项 + 标签） | 无，可先行 |
| 3 | 路由回归金集 + "压缩前后各跑一遍"（§5）；活跃工单清单 section（§6） | 中（金集 30–50 条 + section 注入） | P1 后、试点前完成 |

---

## 8. 待拍板的开放问题

1. **路由金集的判例来源**：从试点期真实 Eval 记录（audit trace）里抽取，还是先人工编写？建议：人工编写 20 条起步 + 试点期每月从真实 Decision 增补；
2. **摘要模型分档的档位**：主 Session 用哪一档（22a 结论对照）；成本差多少进 R1 预算；
3. **活跃工单清单的刷新时机**：每次 Engine 事务后重算注入，还是 pass 周期（2s）刷新？前者实时、后者省事——倾向后者（清单是提示不是协议，秒级延迟无害）；
4. **basic-plugin 是否需要 orchestrator 特化参数**（如更低的 thresholdRatio，让主 Session 更早压缩）：建议试点期用默认参起步，凭 §5 的度量数据决定是否调；
5. **eterna-embed 档是否同步**：embed 档已挂同一套压缩组（22b 验收含 embed 探针），融合 tasks 后无头宿主是否也需要 orchestrator preset（还是 embed 档不启用任务层）——牵涉 embed 产品定位，需单独拍板。

---

## 9. 与既有文档的关系

```
21/22/22a/22b（压缩线）──本文直接复用其成果（D3/D4 决策、四件套、golden 基建）
24（R1 预算 / R2 ready 门禁）──本文是其上下文配套；§5 路由金集 = R2 哲学用于 orchestrator 自身
25（卡点 1 上下文成本 / 卡点 2 验证）──本文 §1.5 逐条对应补齐
26（prompt section seam）──本文 §6 活跃工单清单的注入方式
27（冲突五机制）──本文 §6 清单里的"等谁"即 27 号 waitsForPerson 的可见化
```

本文不改变 `24` 号路线与排期；§7 三件事按其依赖关系并入 P1 / 试点前检查单。
