# 53 - 主会话上下文治理：orchestrator 特化压缩与话题分治

> 状态：**定稿 2026-11-23（D1–D6 已确认）；同日 P0–P4 已实施于 `feat/53-master-session-context-governance`（7 提交，未 push，双门禁与 M4 E2E 待补）；§1.5/§4-P0 有 2026-11-23 勘误（main 基线已随 rc.5-3 闭合 presets 接线）**。本文回答一个问题：super 形态的主会话 `orchestrator-<realm>` 是跨重启复用的单一长会话，用户每轮问的问题主题各异，会话内容持续膨胀——上下文应如何治理。
> 定位：`28` 号 §8-4 开放问题（「basic-plugin 是否需要 orchestrator 特化参数」）的拍板载体；同时收口 `20` 号 §3.1 登记未实现的「任务边界触发」、`35` 号 G2-A9（压缩态回放驱动）与 `28` 号 §7-2（cache-guard 打标）。
> 关联：`28-上下文策略-主Session滚动治理与自研压缩替换.md`（§5 金集/§6 清单/§8-4）、`20/21/22/22b`（压缩线）、`34/35`（tasks 内核）、`24a`（拍板记录）、`43`（M4 真实链路验收）、`packages/compaction`、`packages/tasks`、`profiles/eterna-super/cordis.patch.yml`
> 日期：2026-11-23

---

## 0. 一句话结论

主会话膨胀的根源不是摘要做得不够好，而是**三类内容混在同一条 append-only 流里**：跨 turn 的事实、任务状态、对话流水各有归宿（记忆 / SQLite+工单文件 / 压缩治理），「每次问不同的问题」正是把 ①② 当 ③ 用。结构性解法 = **话题分治**（新话题值得多轮就开工单，主会话只留路由流水）+ **orchestrator 特化压缩参数**（更早压缩 + 压缩后附件重读）+ **任务边界触发**（工单完结的干净边界上主动压），全部参数改动以「压缩 golden + 路由金集压缩态回放」双门禁看护。

---

## 1. 改前事实（全部实测 2026-11-23）

### 1.1 主会话是单一长会话，三类内容各有归宿

| 内容 | 正确归宿 | 现状 |
|---|---|---|
| ① 跨 turn 事实/偏好 | 记忆索引 ≤500 token 常驻 + 正文按需读 | 已有：`packages/memory/src/tools.ts:520-537`（text provider 每次装配现取，多租户 fail-closed）、order 9000（`packages/tasks/src/session/sections.ts:46-49` 注） |
| ② 任务状态（哪些活、各等谁） | SQLite + `.ticket/<id>/` 文件 + `[active-tickets]` 常驻 section | 已有：`sections.ts:44-58`（`eterna-tasks:active-tickets`、order 9050、上限 20 行超出折叠）、pass 周期刷新 `packages/tasks/src/plugin.ts:717`、注册 `plugin.ts:1045-1054` |
| ③ 对话流水（当轮局部连贯） | 压缩四件套治理 | 已有：super 档两 preset 均挂全套（`profiles/eterna-super/cordis.patch.yml:226-256` preset-cordis、`:396-426` preset-standard），行序 stale(L2)→basic(L3)→command→pruner(L1) |

### 1.2 压缩参数与触发面现状

- 全部默认参：thresholdRatio **0.8** / retainRatio **0.16** / headroomTokens **65536** / attachments **false**（`packages/compaction/src/basic/config.ts:20,23,85,117`）；阈值公式 `min(W×ratio, W−completion预留−headroom)`（`config.ts:203-216` `resolveCompactSpec`）。
- 触发四路径：`agent/pre-step` 压力自动（`basic/index.ts:345-367`）、`agent/request-error` 溢出恢复、模型切换重计价（`index.ts:375-396`）、手动 `/compact`（`command-plugin.ts:67` → `compactNow`，`basic/index.ts:618-669`；**要求 idle**，非 idle 抛 `ManualCompactionError('busy')`，`index.ts:664-669`）。
- rapid-refill 熔断：3 步窗内连续 3 次压力触发即跳过本次自动压缩，状态落 `.eterna/compaction.state.json`（`basic/index.ts:290-308`）。
- C11 checkpoint 附件（压缩后重读最近动过的 workspace 文件）已实现但默认关（`config.ts:36-37,117`；22 号 §5-C11）。

### 1.3 入站有界化现状（主会话的上下文增速已被压住）

- worker 报告 relay **硬截 600 字符** + `read: ticket/<id>/result` 指针（`packages/tasks/src/executor/dsh.ts:195-200`）——是 `slice` 不是蒸馏；
- 候选卡触发原文 ≤4000 字符、线程窗口 400/1200/50 字符折叠（`packages/tasks/src/session/candidate.ts:24-30`）；
- `orchestrator_read` 列表 20/至多 50 条、文本页 4000/至多 8000 字符（`packages/tasks/src/tools/resources.ts:25`）。

### 1.4 度量面现状

- 路由金集 v0 **已有**：20 条人工判例 RG-01…RG-20 四类（accept/attach/ignore-bot/stop），干净态回放随包 verify（`packages/tasks/tests/route-golden/README.md:14,25-28`）；
- **压缩态回放 + 差值门禁未建**（G2-A9 待建：dsh-evals replay pack 适配 + `diff-pass-rate.mjs`，跑动节奏 nightly 已登记，`route-golden/README.md:19-24`）；
- 压缩 golden（evals-golden 25 用例）已有，纪律「分档配置改动必全量重跑压缩 golden」已登记（`packages/tasks/cordis.patch.yml:223` 注）。

### 1.5 角色 preset：装配接线（**2026-11-23 勘误：main 已随 rc.5-3 闭合**）

> **勘误**：本节初稿（2026-11-23 上午）断言「生产装配链没有任何一环注入 presets，主/worker 会话实际运行宿主缺省 preset」——该断言只在勘察时所在分支 `feat/tasks-super-visibility` 成立。**实测 origin/main（ddecd00 = 0.2.0-rc.5-3，PR#142 合入线）的 `packages/tasks/src/plugin.ts:652` 已含派生缺省**：`presets: options.sessionHost.presets ?? { orchestrator: ORCHESTRATOR_PRESET_ID, worker: WORKER_PRESET_ID }`（显式注入恒优先，注释 `:639-642`）。角色 preset 接线在 main 基线已是现状，主会话运行 `eterna-tasks-orchestrator` preset（只读+路由工具面）自 rc.5-3 起即生产事实。以下初稿两行保留作勘察记录，结论以本勘误为准。

- 两角色 preset 已声明于 `packages/tasks/cordis.patch.yml`：`eterna-tasks-orchestrator-preset`（id `eterna-tasks-orchestrator`，`:147-152`，只含路由所需工具、fs 只读）与 `eterna-tasks-worker-preset`（id `eterna-tasks-worker`，`:51-54`），各自带独立 compaction 组（orchestrator 的在 `:203-234`，worker 的在 `:116-143`）；yml 与常量双向钉住（`packages/tasks/src/session/presets.ts:14,17,20`、`tests/preset.spec.ts:51-57`、`tests/role-models.spec.ts:58-67`）。
- 消费面已备：`SessionsHost.presets?: Partial<Record<SessionRole, string>>`（`packages/tasks/src/session/sessions.ts:128`），`Sessions.ensure` 按 role 取用并传 `agentPreset` 建会话（`sessions.ts:188-190`）。
- ~~**但生产装配链没有任何一环注入它**~~（勘误：见上——main 的 `sessionHostFromContext` 派生返回值已带 presets 缺省，`plugin.ts:652`）。
- ~~**推论**：…角色 preset 的「专用工具面 + 特化压缩参数」双未生效…~~（勘误：两者在 main 均已生效；P2 参数落地的前提早已满足）。**修正后的推论**：§4-P0 的净增量收窄为**可见性与钉住**——boot 探针与 `Sessions.ensure` 断言建会话请求带正确 `agentPreset`（实施分支 `plugin-boot` 探针 14/14）；「主会话工具面收窄」不再是本清单的行为变更，其 M4 E2E 重跑转为 **rc.5-3 存量行为的验收债**（仍须补跑）。

### 1.6 摘要模型

Q1 已拍板「维持会话模型、不落值」——orchestrator preset 的 compaction-basic 已落空串对占位（`packages/tasks/cordis.patch.yml:217-226`，引 22a §4；二者必须成对置空/置值，`basic/config.ts:325-345` `validateSummarizationPair`）。主会话摘要分档仍属 35 号 §12-9 开放问题，本文档不翻案、不碰。

---

## 2. 问题定性：为什么「每轮问题都不同」让主会话退化

1. **摘要单主线 vs 多主题流水**：压缩摘要 8 段模板的 `Primary Request and Intent` 只有一条主线；用户每轮换话题时，被遮蔽段的异质意图被折叠进同一条主线，旧话题的待决事项容易在摘要中失真。20 号 §3.1 的结论「任务边界触发（阶段完成时压缩质量最高、干扰最小）」正针对此——压缩应落在话题/任务边界上，而不是压到一半（`20` 号 §3.1「附加触发」条，`:156`）。
2. **尾段被单一话题占满**：retainTokens = 16% 逐字保留的是「最近的消息」，若最后一轮是长话题，其它活跃工单的近况只剩 `[active-tickets]` section 兜底（这是 §6 清单设计的价值，28 号 §6）。
3. **决策局部化能兜住裁决，兜不住对话**：候选卡自包含决策包（28 §1.1）保证压缩不丢裁决依据；但用户在主会话里的**纯对话**（没开工单的多轮讨论）没有等价的结构化保护——这是话题分治纪律要补的洞。

---

## 3. 拍板项（D1–D6，待确认）

| # | 决策 | 内容 | 理由 |
|---|---|---|---|
| **D1** | **话题分治纪律（提示词一行）** | `prompts/dispatch.md` 增加一行纪律：用户新话题若值得多轮跟进（≠一句话可答）→ 转工单分派；不值得的简答后把长期有效的事实交记忆。主会话对话流只应积累「路由流水 + 简答」，不积累专题讨论。 | super 形态本来就为此设计（relay 600 字符 + 指针 + 分页拉取，§1.3）；本纪律把「该开工单的被就地聊掉」这一膨胀主源关掉。改 prompt 走 prompt-registry 行号锚点纪律与 CI 体积预算 |
| **D2** | **orchestrator 特化压缩参数：做，落角色 preset** | 落点 = `packages/tasks/cordis.patch.yml` orchestrator preset 的 compaction-basic config（`:217-226` 处加键）。拍板初值：**thresholdRatio 0.8→0.7**（与 L2 stale 同档：stale 先泄压、basic 只在泄压不足时摘要兜底，符合 20 号 §3.2 分层意图）、**attachments false→true**（开启 C11 附件重读，多主题会话压缩后现场恢复最近文件）；retainRatio/摘要模型/重试**均不动**。正式值以 P1 度量 + P2 双门禁为准，初值即候选值。 | 28 号 §8-4 顺向闭环；主会话话题杂、宁早压；熔断（§1.2）兜住「压完立刻回满」的退化情形 |
| **D3** | **任务边界触发：做** | 工单进入终态（`ended`）落定时，若主会话 **idle 且 Effects 队列空** → 经 `ctx.compaction` 结构端口（不 import compaction 包，同 tasks-access-bridge 的结构子集纪律）调 `compactNow`；非 idle 抛 busy 即**静默跳过**（记 debug，下一边界再试），fail-open 不阻断工单流。接线点 = tasks 装配面（pass 驱动或 Engine 终态迁移处；`plugin.ts:717` 在场）。 | 20 号 §3.1 落地；让 checkpoint 落在干净边界，摘要质量最高；idle 约束与 `/compact` 同源（§1.2），busy 跳过避免与在途回合互踩 |
| **D4** | **摘要模型：维持会话模型** | 不翻 Q1 案（§1.6）；主会话分档继续挂 35 号 §12-9。 | 22a 全量 sweep 无一稳定超越现档 |
| **D5** | **worker 报告自动蒸馏：明确不做** | 维持 600 字符硬截 + 指针 + `orchestrator_read` 按需分页拉取。 | 蒸馏 = 每份报告多一次 LLM 调用（成本+延迟），且 KV 缓存前缀不受影响的前提被打破；深度结果本就按需拉取，蒸馏收益不覆盖成本 |
| **D6** | **cache-guard 压缩事件打标：做（收口 28 §7-2）** | 压缩事件进入 cache-guard 监控标签，命中率下降可区分「压缩导致」vs「前缀污染」。 | 28 号 §7 事项 2 遗留；D2/D3 上线后压缩频次上升，无此打标会污染缓存观测 |

**运营手段（非决策，随文档交付）**：话题收尾时可手动 `/compact`（走 idle 串行通道）；admin 观测面关注主会话 rapidRefillCount——频繁熔断 = 当前参数撑不住话题密度，回到 P2 调参流程。

---

## 4. 实施清单（P0–P4，依赖序）

| # | 事项 | 落点 | 工作量 | 依赖 |
|---|---|---|---|---|
| **P0** | **presets 接线闭合**（2026-11-23 勘误：main 的 `sessionHostFromContext` 已随 rc.5-3 带派生缺省 `plugin.ts:652`，本项落地内容=探针与单测钉住）：boot 探针 + `Sessions.ensure` 断言主/worker 会话建会话请求带正确 `agentPreset`（实施分支 plugin-boot 探针 14/14）。~~行为变更需评审~~——「主会话切到 `eterna-tasks-orchestrator`（只读+路由工具）」自 rc.5-3 即 main 现状，不再是本清单的行为变更；其 M4 真实链路 E2E 重跑转为存量行为验收债（43 号全链，仍须补跑） | `packages/tasks/src/plugin.ts` | 小 | 无，其余全部前置 |
| **P1** | **G2-A9 压缩态回放驱动**：dsh-evals replay pack 适配（数据源 = `route-golden/entries.ts`）+ `scripts/diff-pass-rate.mjs`，nightly 挂接；落位与 CI/发布门禁口径随 35 号 §12-10 一并拍板 | `packages/tasks/tests/route-golden/`、`tools/evals/` | 中 | P0（回放需真实 preset 态） |
| **P2** | **D2 参数落地**：orchestrator preset compaction-basic config 加键；**双门禁全绿才许合入**——压缩 golden（门槛基线：userVerbatim 召回 100%，`22` 号 `:185`）+ 路由金集压缩态回放（通过率差 ≤2pp，28 号 §5 口径） | `packages/tasks/cordis.patch.yml:217-226` | 小 | P0、P1 |
| **P3** | **D3 任务边界触发**：tasks 侧 compaction 结构端口 + 工单终态钩子 + busy 静默跳过；端口为**每触发现读面**（复审 F3 修复：agent 作用域实例优先 = orchestrator 特化参数位，宿主 `ctx.compaction` 兜底；boot 后晚挂载下一边界自愈）——不钉死 boot 实例；单测覆盖「busy 跳过不重试风暴」「fail-open 不阻断工单流」「晚挂载自愈」「agent 作用域优先」 | `packages/tasks/src/plugin.ts`、`prompts/dispatch.md`（D1 同文件顺带） | 中 | P0 |
| **P4** | **D6 cache-guard 打标** + D1 提示词行（若未随 P3 顺带） | glue audit/cache-guard 监控面 | 小 | 无，可先行 |

**明确不做**：摘要模型分档（等 35 号 §12-9）；worker 报告自动蒸馏（D5）；把主会话拆成多会话（super 流程只在主会话可达，拆会话破坏 40 号形态门禁与 44 号收官口径；话题隔离由工单承担）。

---

## 5. 验收口径（全部实测可追溯）

| 项 | 口径 | 来源 |
|---|---|---|
| P0 | 建会话探针：orchestrator/worker 建会话请求带正确 `agentPreset`；M4 真实链路 E2E 全绿（出票→分派→报告→relay） | 43 号验收链 |
| P1 | 压缩态回放跑通：同一金集在压缩前后各一遍，`diff-pass-rate.mjs` 出差值 | route-golden README :19-24 |
| P2 | 压缩 golden userVerbatim 召回 100%（22 号 :185 门槛基线）；路由金集压缩前后差 ≤2pp；admin 观测面实读 orchestrator 会话 thresholdRatio=0.7、attachments=true | 22 号 C4、28 号 §5 |
| P3 | 工单终态落定 + 主会话 idle → session log 出现 compaction/start-end 标记对；busy → debug 日志、无第二次尝试；工单流不受影响（出票 E2E 回归） | 本文 D3 |
| 熔断兜底 | P2 上线后主会话 rapidRefillCount 无持续增长趋势（连续观测 ≥1 周） | `basic/index.ts:290-308` |

---

## 6. 风险与回滚

| 风险 | 缓解 | 回滚 |
|---|---|---|
| P0 收窄主会话工具面后，现网用户依赖主会话 bash/写盘的习惯被破坏 | D1 纪律同时落地（该做的事开工单）；上线前 M4 E2E + 试点期观察 | profile 摘除 presets 注入或派生返回值回退（一行） |
| thresholdRatio 0.7 导致压缩频次上升、KV 缓存打断变多（DeepSeek 缓存价差 ~50×，28 号 §4-3） | D6 打标先行可归因；熔断兜底；P2 双门禁数据说话 | preset config 摘键即回默认参 |
| 任务边界触发与在途 relay 竞态（压缩中 worker 报告到达） | compactNow 本身 idle-gated + durable log 全保留；busy 静默跳过 | 摘除钩子（纯增量，不动 Engine） |
| 附件重读放大上下文（预算默认 5 文件/单文件 5000/总 50000 token，`22` 号 `:292`） | 预算上限已在 attachments 实现内硬约束 | attachments 键回 false |

---

## 7. 与既有文档的关系

```
28（§8-4 开放问题）──本文 D2 即其拍板载体；§5 金集口径在 P1/P2 直接复用；§7-2 由 D6 收口
20（§3.1 附加触发）──本文 D3 落地「任务边界触发」
21/22/22b（压缩线）──复用四件套与 golden 基建；不改阈值公式与分层策略
34/35（tasks 内核）──P0/P3 落 tasks 装配面；G2-A9（P1）与 §12-10 拍板联动
40/44（super 形态）──「明确不做：拆多会话」的依据
46（角色模型）──presets（本文件 P0）与 roleModel 两端口并行，互不覆盖
24a（拍板记录）──C4 金集增补流程延续（月度从真实 Decision 增补）
```

本文不改 `24` 号路线与排期；P0–P4 按 §4 依赖序并入任务内核里程碑。
