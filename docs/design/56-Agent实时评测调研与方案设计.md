# 56 - Agent 实时评测调研与方案设计

> 状态：**调研稿 v0.1（2026-11-24）**。本轮只调研、只设计，**未改任何产品代码**。
> 需求：基于当前会话轨迹做 Agent 实时评测；面向结果 + 面向过程；通用指标 + 业务指标；提供「结果展示」与「评测指标配置」两个前端交互面。
> 定位：[07 号](07-评测体系-ai-evo对接与本地eval插件.md) 双轨评测之外的**第三轨（在线会话评测）**，不替换前两轨；会话内面板形态沿用 [54 号](54-adviser-P0-probe.md) 参谋面板的先例。
>
> **取证口径**（每个外部事实后带方括号来源，对应 §8）：
> 〔直读〕= 本轮主会话直接抓取原文核对；〔子调研〕= 本轮 4 路子调研抓取原文（承重子集已由主会话独立复核，清单见 §8.0）；
> 〔摘要〕= 只拿到搜索摘要；〔未取得〕= 没读到正文，**不采信、不写入结论**。仓库内事实给 `文件:行`。

---

## 0. 摘要

| 问题 | 一句话答案 |
|---|---|
| 做不做、怎么定位 | 做。定位为 07 号「本地金集回归 + ai-evo 平台门禁」之外的**第三轨：在线会话评测**，三轨共用同一套断言语义与指标定义。 |
| 「实时」能做到什么程度 | 业界**没有**「会话进行中逐条同步出分或拦截」的成熟先例——已核实的四家产品在线评测全部异步事后〔子调研 D1–D11〕。本方案的「实时」= 规则类指标随事件流即时更新（毫秒级）+ 每轮结束后增量出裁判分（秒到分钟）+ 会话空闲后整条终评。 |
| 结果与过程怎么分 | 沿用 Microsoft Foundry 的官方二分：System evaluation 评端到端结果，Process evaluation 评逐步执行〔直读 D16〕。**结果指标可做通过判定；过程指标默认只做诊断，不进门禁。** |
| 判定怎么分层 | 确定性规则（全量、零模型成本）→ LLM 裁判（抽样、异步、只补语义类）→ 人工复核（校准裁判）。 |
| 最大的坑 | ① 成功判定没有一个裁判 precision 超过 70%〔子调研 P4〕；② 只看最终回复的裁判对「不改变回复的过程故障」没有判别力〔直读 P23〕；③ 在线判定准确率明显低于事后〔直读 P22〕；④ 把「评不了」当成 0 分。 |
| 落在哪 | 一个新包（双面包）：结果面 = 右栏「评测」tab（adviser 同款槽位）；配置面 = 设置弹窗「评测」分区；总览页（`sidebar.panellist` + `main`，usage-stats 同款）放 P2。**不建独立页面。** |
| 需要你拍板 | §7 的 D1–D8。 |

---

## 1. 需求与本产品现状（全部可追溯）

### 1.1 需求拆解

需求可拆成「指标 × 交互面 × 时机」三个维度：

| | 面向结果 | 面向过程 |
|---|---|---|
| **通用指标** | 任务是否完成、答案是否正确、约束是否满足、是否有据、是否触碰安全红线 | 步数/成本/时延、工具调用质量、循环与冗余、计划与纠错 |
| **业务指标** | 领域评分标准（如「预算超支 15% 必须走审批」）、必达信息、禁语与合规 | 领域流程断言（必须/不得调用某工具、必须触发审批） |

交互面两个：**结果展示**（会话内逐会话 + 跨会话聚合）、**评测指标配置**。时机是「实时」。

### 1.2 既有家底（新方案必须建立在这些之上）

| 资产 | 位置 | 已有能力 | 与本需求的关系 |
|---|---|---|---|
| 07 号双轨评测 | `docs/design/07-评测体系-ai-evo对接与本地eval插件.md` | 本地 dsh-evals（管「快」）+ ai-evo 平台（管「全、准、有证据」）。原则：「确定性校验优先，评终态而非过程，judge 需治理」（07:3）；非目标：「不做裁判 UI/统计/趋势（平台职责）」「不在 agent 会话内暴露评测工具（避免被测 agent 自评）」（07:68-69） | **全是离线**。本需求是它没覆盖的在线面；它的两条原则本方案都继承（见 §3） |
| `@eterna/evals`（dsh-evals） | `tools/evals/src/`、`tools/evals/README.md` | golden case：`answer`（contains/正则）、`final_state`（file/http/script 断言）、`trajectory`（strict/unordered/subset/superset 四模式 + `must_call`/`must_not_call`/`max_steps`/`approval_flow`）、`budget`（`max_turns`/`max_tokens`）（README:18-28）；`summarize()`（`events.ts:139`）、`assertTrajectory()`（`trajectory.ts:119`） | **确定性指标的定义与断言器已经存在**，在线评测应复用同一套语义，不另造 |
| `@eterna/observe` | `packages/observe/src/metrics.ts:97` | `aggregateSessionMetrics()`：轮数/步数/模型调用数/token 四桶/缓存命中率/成本估算/结束原因/逐轮派生；另有漂移检测与信号库（`types.ts:56` 含 `eval_fail`） | **过程类效率指标的底座已存在** |
| 工作台评测视图 | `packages/workbench/src/project/eval-view.ts` | 金集通过率趋势、路由金集衰减、漂移检测、本周回归跑批四张卡 | 跨会话聚合展示的先例 |
| 压缩裁判 | `packages/compaction/evals/judge.ts` | 冻结 system prompt（:24）、只输出 JSON、`parseJudgeVerdict` 严格校验（:97）、裁判作**覆盖层**合并而不改确定性评分（:135） | **LLM 裁判的调用与校验先例**。头注教训：确定性启发式两轮校准后停止打补丁，语义等价必须靠 judge（:5-9） |
| 候选卡裁决 | `packages/tasks/src/session/assessor.ts:136`、`policy/assessment.ts:80` | zod `strict()` 定义输出结构；结构校验不靠 prompt | 裁判输出的结构化校验先例 |
| 领域包金集 | `packs/event-planning/evals/` | golden case 文件 + `threshold.yml`（注释：smoke 9 条、全量 30 条；release 档 `verification_pass_rate_min: 0.85`、`trajectory_match_rate_min: 0.8`、`judge_score_min: 4.0`、`cache_hit_rate_min: 0.7`） | **业务指标的现成真源**，例：`budget-overrun-15pct-silent-forbidden` |
| ai-evo 平台 | 07 号 §2（2026-11 之前实测记载，本轮未复测） | AI 裁判、Agent 长会话、一致性、成功率、RAG 指标、仿真（pass^k）、终态校验器、轨迹匹配、裁判治理 | 第二轨；与本需求的职责边界见 D6 |

### 1.3 可直接复用的宿主插座（本轮核对）

| 插座 | 用法 | 先例 |
|---|---|---|
| 实时事件 | `ctx.on('session/event', (session, event) => …)` | `packages/tasks/src/session/sessions.ts:189`、`packages/glue/src/plugins/memory-plugin.ts:744`、`packages/audit/src/plugin.ts:62` |
| 全量历史 | `sessionQuery.readSession(id)` → `SessionLogSnapshot.events` | 54 号 §8.2 |
| LLM 一次性直调 | `ctx.llm.prepareCall({provider, model, maxTokens})` → `call.stream()` | `packages/memory/src/extraction.ts:216`（`runCuratorOneShot`） |
| 会话内面板 | `sidebar.right.pane.tab` | `packages/adviser/src/client/index.ts` |
| 逐轮内联 | `conversation.chat.turnTail` | `packages/memory/src/client/index.tsx:165`（注册在宿主 chat rc.1 上有版本坑，见 :157-164 的 M-C4 记录） |
| 总览页 | `sidebar.panellist` + `main`（keyed 面板） | `packages/usage-stats/src/client/index.tsx:260-268` |
| 设置分区 | `settings.section` | access / tasks / panel / memory / compaction |
| 数据面与路由 | 包内 `ctx.provide('eternaXxx', service)`；路由只由 access 守卫登记（`POST` + JSON，登录 + 归属） | `packages/access/src/routes.ts:232`、`:242`（adviser 先例） |
| 按身份裁剪 | 端点内读 `invocation.principal`，admin 全局、普通用户本人 | `packages/usage-stats/src/index.ts:63` |
| 持久化 | `node:sqlite`，路径在 `DSH_HOME` 语义下 | `packages/observe`（README「口径说明」） |

### 1.4 会话轨迹里有什么（dsh-session 0.2.2-rc.1，`src/types.ts`）

| 事件 | 载荷 | 位置 |
|---|---|---|
| `tool/call` | `{ turn, step, callId, name, arguments }`，`arguments` 是模型产出的原始 JSON 字符串 | types.ts:369 |
| `tool/result` | `{ turn, step, message: ToolResultMessage, error?, meta? }`；失败口径 `message.isError === true` 或 `data.error` 存在 | types.ts:383；`tools/evals/src/events.ts:210-220` |
| `assistant/message` | `{ turn, step, message, stream, usage?, interrupted? }`，用量骑在该事件上 | types.ts:349 |
| `turn/end` | `{ turn, reason }` | types.ts:303 |
| `request/header`、`request/context` | provider/model 路由锚点 | types.ts:398、:410 |
| `approval/asked`、`approval/decided` | 审批请求与结局，按 `callId` 配对 | `tools/evals/src/events.ts:57-78` |

两点对指标计算有直接影响：被拒的调用**仍会记** `tool/call`，其 `tool/result` 带 error，所以要按 `callId` 判（`tools/evals/README.md:47-50`）；07 号记载事件流共 66 种（07:34，本轮未重数），未识别事件类型应静默跳过（`packages/observe/src/metrics.ts:94` 的既有做法）。

### 1.5 缺口

| # | 缺口 | 说明 |
|---|---|---|
| G1 | 没有在线评测 | 07 号把运行时抽样交给平台（OTel 通道 B），产品内没有「对着当前会话出分」的能力 |
| G2 | 没有指标配置模型 | `threshold.yml` 只是一组门禁阈值，没有逐指标的定义、量表、裁判配置、生效范围 |
| G3 | 没有评分存储 | 评分不在会话日志里；且**不应新增 `SessionEventMap` 事件类型**（v4 持久化恢复拒载未知事件，`packages/adviser/README.md`「关键约束」） |
| G4 | 没有会话内结果展示 | 现有评测视图只在 super 形态的工作台里，且是金集聚合，不是逐会话 |
| G5 | 原则需要调和 | 07 号「评终态而非过程」针对的是门禁；本需求要过程诊断，必须显式说明二者关系，不能默默并存 |
| G6 | 纯函数分居两侧 | `observe`（packages）与 `@eterna/evals`（tools）各有一套事件解析与聚合，没有共享库 |

---

## 2. 业界调研

### 2.1 开源框架与可观测平台

stars 与最近推送为 2026-11-24 GitHub API 读数（标 ✓ 的 10 个由主会话用 `gh api` 复核，其余为子调研读数）。

| 项目 | 形态 | License | stars | 最近推送 | 在线评测 | 指标配置 | 可内嵌性 |
|---|---|---|---|---|---|---|---|
| deepeval | SDK（Python + TS）+ CLI | Apache-2.0 | 19,637 ✓ | 2026-11-24 | 进程内：metric 挂 `@observe`，轨迹指标在 trace 结束后评、步骤指标在 span 级评 | 代码构造参数 | 高，但 TS 包仍早期（0.9.26） |
| Langfuse | 自托管平台 | MIT + `ee/` 另许（API 报 NOASSERTION） | 37,792 ✓ | 2026-11-24 | 有：Evaluator（怎么评）+ Rule（对谁评） | UI / API | 低，须部署 web + worker + DB |
| promptfoo | CLI + Node 库 + Web UI | MIT | 27,621 ✓ | 2026-11-24 | 无生产在线 | YAML | 中 |
| Arize Phoenix | 自托管平台 + evals 库 + TS client | ELv2（API 报 NOASSERTION） | 12,400 ✓ | 2026-11-24 | 定时抽样跑 evaluator 再回写 annotation | 代码 / UI / GraphQL | 中；ELv2 非 OSI 许可 |
| Inspect AI | Python 评测框架 | MIT | 3,324 ✓ | 2026-11-24 | 无；Scanners 在样本完成即扫描 | 代码 | 中 |
| ragas | Python SDK | Apache-2.0 | 16,417 ✓ | 2026-11-14 | 未见 | 代码 | 中，仅 Python |
| autoevals（Braintrust 维护） | SDK（TS + Python） | MIT | 1,087 ✓ | 2026-11-19 | 未见 | 代码 + YAML 模板 | 高 |
| openai/evals | 框架 + registry | MIT | 19,793 | 2026-04-14 | 无 | 代码 | 低，已停更 |
| langchain agentevals / openevals | SDK（JS + Python） | MIT | 764 / 1,262 | 2026-07-14 / 2026-11-18 | 未见 | 代码 + 预置 prompt | JS 版 0.0.7，早期 |
| OpenCompass / AgentCompass | 基准评测框架 | Apache-2.0 | 7,635 / 201 | 2026-11-24 | 无 | Python 配置 | 低 |
| EvalScope | 基准评测框架 + Dashboard | Apache-2.0 | 3,731 | 2026-11-24 | 无 | CLI / Python | 低 |

以上未标 ✓ 的行、以及本节其后的细节均为〔子调研 F1–F11〕。归属变更（子调研核实）：ragas 已迁到 `vibrantlabsai/ragas`；`openai/autoevals` 现 404，仓库为 `braintrustdata/autoevals`；microsoft/autogen 已归档。

与本需求最相关的几点：

- **deepeval 的 agent 轨迹指标**是现成的命名参考：Task Completion、Step Efficiency、Plan Adherence、Plan Quality（都要 trace、都不需参考答案），Tool Correctness（规则为主）、Argument Correctness（裁判），以及**零模型成本**的 AgentLoopDetection（工具重复调用、推理停滞、调用图成环）。注意它的反例：Plan Adherence / Plan Quality 在「没有计划」时记满分，会虚高。
- **轨迹比对四模式是业界公约**：本仓 dsh-evals 的 strict/unordered/subset/superset，与 langchain agentevals 的 `trajectory_match` 四模式同名同义；Azure Foundry 也有 exact / in_order / any_order 三档〔直读 D16〕。
- **结果数据模型四家一致**：Phoenix `Score`、Langfuse `Score`、OpenInference annotations、OTel `gen_ai.evaluation.result` 都是「名称 + 数值或标签 + 解释 + 裁判类型（人/LLM/代码）」。
- **Inspect AI 的评分策略**把结局分三种：给出判定 / 评分器出错 / `unscored`（不计入分母），并用按责任方区分的 reason 词表（`invalid_response_format`、`refusal` 属被测模型，`grader_failed`、`scoring_failed` 属评分器）。
- **能内嵌进 TypeScript 的现成 agent 指标库都还早期**，且 deepeval 的 hybrid / system_one 模式与 Langfuse 的 decision model 依赖外部 SaaS（TypeSafe 的 Jev），不符合「数据不出内网」。结论：**借定义、自己实现，不内嵌**。

### 2.2 基准是怎么判分的

| 基准 | 成功判定 | 过程分 | 对本方案的启示 |
|---|---|---|---|
| τ-bench | `r = r_action × r_output`：终态数据库等于目标态，且回复含全部必含信息；一致性用 pass^k | 无；论文明言 r=1 是「必要非充分」 | 终态比对会漏「未获确认就执行」这类违规，需要自然语言断言补 |
| τ²-bench | 任务用 `reward_basis` 声明哪些分量进门禁（DB / ENV_ASSERTION / COMMUNICATE / NL_ASSERTION / ACTION），连乘 | `partial_action_reward` 只作诊断 | **「每项指标声明是否进门禁」正是配置页需要的数据结构**；ACTION 只在确信唯一解时启用 |
| BFCL | 单轮 AST 比对；多轮逐轮「状态检查 + 响应检查」，全轮通过才有效 | 无，失败即返回 `error_type` | 逐轮增量判定有先例；细分错误类型比单一失败位有用 |
| AppWorld | README 明言「评测基于数据库状态而非过程」 | — | 评产出不评路径 |
| TheAgentCompany | checkpoint 积分；`S_partial = 0.5·Result/Total + 0.5·S_full` | 有 | 进度分与完成分各半是一种可选的聚合口径 |
| SWE-bench | 跑单测 FAIL_TO_PASS + PASS_TO_PASS | 现版有 PARTIAL 状态 | 终态断言里「单元测试」这一类 |
| ToolSandbox | `score = score(M+) × I(score(M−) = 0)`：里程碑得分 × 未踩雷 | 有 | **关键项门控**的简洁表达：碰红线则总分归零 |

以上为〔子调研 B1–B8、P5、P6、P26〕。一条贯穿的结论：**参考轨迹只是一条可行路径**。τ²-bench 的文档强调动作匹配 0/n 仍可能完全正确，所以动作匹配不计入正式分。

### 2.3 论文：结果与过程、裁判可靠性、在线评测

| 论文 | 与本需求最相关的结论（数字均出自原文） | 级别 |
|---|---|---|
| Survey on Evaluation of LLM-based Agents（2503.16416） | 评测粒度分 final response / stepwise / trajectory；trajectory 再分 reference-based 与 reference-free。指出现有框架忽略「评测自身的成本」 | 子调研 |
| Establishing Best Practices for Rigorous Agentic Benchmarks（2507.02825） | 基准缺陷可致相对高估或低估最多 100%；用 LLM judge 前要先做 pilot 测准确率与自一致性 | 子调研 |
| Agent-as-a-Judge（2410.10934） | 与人工共识一致率 90%（LLM-as-a-Judge 为 70%）；比 3 名专家省 97.72% 时间、97.64% 成本 | 子调研 |
| AgentRewardBench（2504.08942） | 1,302 条轨迹、5 个基准、4 个模型、12 个裁判；没有一个裁判全面胜出；规则法**系统性低估**成功率。正文：最佳裁判 precision 69.8 / recall 83.1，规则法 83.8 / 55.9 | 直读摘要；数字为子调研正文 |
| τ-bench（2406.12045） | pass^k；gpt-4o retail pass^1 约 61%，pass^8 低于 25% | 子调研 |
| Who&When（2505.00212）/ Who&When Pro（2607.09996） | 步级归因最好只有 14.2%；轨迹到 93–130 步时接近 0%。步准确率从 <3K token 的 94% 降到 >12K token 的 50%；整条一次评比逐步评高 7.6 个百分点 | 子调研 |
| TRAIL（2505.08638） | 最佳模型联合准确率 11%；8 个模型中 3 个放不下完整上下文 | 子调研 |
| AgentErrorBench / AgentDebug（2509.25370） | 错误集中在第 6–15 步并向下级联，作者结论是「早发现早纠正至关重要」 | 子调研 |
| MAST（2503.13657） | 3 大类 14 种失败模式；带 few-shot 的 LLM 标注器与人工一致率 94%（κ 0.77）；每条 trace 平均 1.8 美元 | 子调研 |
| Judging LLM-as-a-Judge with MT-Bench（2306.05685） | GPT-4 位置一致性 65.0%；「重复列表」冗长攻击对 GPT-3.5 失败率 91.3%、对 GPT-4 为 8.7% | 子调研 |
| JudgeBench（2410.12784） | 客观正确性上 GPT-4o 准确率 50.86%（pairwise 随机为 50%） | 子调研 |
| Holistic Agent Leaderboard（2510.11977）/ AI Agents That Matter（2407.01502） | 同一基准换 scaffold 成本差 9 倍（171 对 1,577 美元），准确率只差 2 个百分点；主张画准确率–成本 Pareto | 子调研 |
| The Danger of Overthinking（2502.08235） | overthinking 0–10 评分，三种模式：Analysis Paralysis、Rogue Actions、Premature Disengagement | 子调研 |
| **AgentForesight（2605.08715）** | 定义 online auditing：每步只看已执行前缀，输出 continue 或 alarm。7B 审计器比 GPT-4.1、DeepSeek-V4-Pro 等最高高 19.9%。正文：把事后方法直接套到前缀上「ill-posed」（Exact-F1 仅 9.63）；提出「误报率 ≤ 20% 且步准确率 ≥ 50%」为可部署区 | **直读摘要**；正文数字为子调研 |
| **ProMAS（2603.20260）** | 在线错误预测在 Who&When 上步级准确率 22.97%，只处理 27% 的日志；作者承认相对事后方法有精度代价 | **直读摘要** |
| **trajectory-judge（2609.00038）** | 单作者预印本，400 条轨迹。只看请求与最终回复的 14B 裁判，对四类不改变回复的故障召回 34–76%，但**配对判别力为零**（输入与干净轨迹完全相同）。被明确要求逐步检查后，同模型标出这四类全部故障，100 条干净轨迹误报 0。看到了每一步但只被问最终回复时配对判别力 +0.69，被要求逐步检查时 +1.00 | **直读摘要** |
| MobileJudgeBench（2608.11434） | 简单基线 90.9%，复杂管线并不更好；换裁判骨干会使失败画像在「保守」与「宽松」之间反转 | 子调研 |
| SWE-PRM（2509.02360） | 滑窗 + 原始任务描述的实时纠偏：解决率 40.0% → 50.6%；每 100 实例裁判调用花 22.4 美元，被评策略模型只花 3.61 美元 | 子调研 |
| AgentSpec（2503.18666） | 规则谓词求值 1.11–2.83 ms，而被保护 agent 平均执行 9.82–25.4 s | 子调研 |
| AgentProcessBench（2603.14465） | LLM 做奖励模型时明显偏向给正标签；弱 agent 提前终止会抬高「正确步比例」，须配「首个错误步」指标 | 子调研 |
| Mind2Web 2（2506.21506） | rubric 树：任一 critical 子节点未过则为 0，否则取非 critical 子节点均值 | 子调研 |
| GDPval（2510.04374） | 自动裁判与人一致率 65.7%，人际一致率 70.8% | 子调研 |

> 题录更正（子调研核实，避免写错）：AgentBoard 的题名是 “AgentBoard: An Analytical Evaluation Board of Multi-turn LLM Agents”；AgentErrorBench 的论文题名是 “Where LLM Agents Fail and How They can Learn From Failures”。

### 2.4 业界产品：指标配置与结果展示

已核实四家 + OpenAI + Azure。国内厂商与其余第三方**本轮未核实**（见 §8.0）。

| 产品 | 在线评测怎么触发 | 指标配置模型 | 结果展示 |
|---|---|---|---|
| LangSmith | run 级按到达即评；thread 级在会话**空闲后**整会话评一次（默认 10 分钟，最小 2 分钟）；过滤 + 采样率 + 花费上限 + 回填 | 工作区级 evaluator；裁判表单 = Prompt + Model + 变量映射 + Preview；分数类型 Boolean / Categorical / Continuous | trace 侧栏分 Trajectory / Turns / Details 三层；分数可悬停进裁判 trace；实验对比以基线为锚标红绿回归 |
| Langfuse〔直读 D6〕 | observation 级按到达即评，由 worker 队列异步执行；**trace 级评测器在 v4 已弃用**，observation 级不加载同 trace 的兄弟或子节点 | Evaluator（怎么评）与 Rule（对谁评）分离；Rule = 过滤 + 采样率 | trace 详情的 Scores / Annotations 页签；Score Analytics 含人机一致性（Cohen's Kappa）与混淆矩阵 |
| Braintrust | Span / Trace / Group 三种 scope，后台异步；Trace scope 空闲超时默认 30 秒 | scorer（0–1 数值）与 classifier（类别）；裁判字段含 Choice scores、Use CoT、Allow skip、Pass threshold | Timeline：每 span 一根条，宽度可按时长 / token / 成本缩放；Evaluators 页签行内展开理由 |
| Arize Phoenix | SDK 批量跑后写回 annotation；server evals 只挂数据集 | `Score(name, score, label, explanation, metadata, kind, direction)`，`kind` ∈ human / llm / heuristic / code；annotation config 三型，各带优化方向 | span / trace / session 三级 Annotations 页签，显示来源便于看分歧 |
| OpenAI Evals / Graders | **已进入弃用关停时间表**：2026-10-31 起只读，2026-11-30 关停，官方建议迁 Promptfoo（子调研读到弃用页；主会话复核被 403 拦截，经官方社区公告的搜索摘要交叉印证） | 指南页列出 `string_check`、`text_similarity`、`score_model`、`python`、`multi` 五型；SDK 类型里另有 `label_model` | 已核实范围内**没有**面向完整 agent 轨迹的 grader |
| **Microsoft Foundry agent evaluators〔直读 D16〕** | 云端批量评测（非在线） | 官方二分 **System evaluation**（评端到端结果）与 **Process evaluation**（评逐步执行）；输出二值 Pass/Fail（或 1–5 分按阈值转二值）；复合评测器把多个维度并入**一次**裁判调用以降成本与延迟；不适用的分量跳过、全跳过则 `not_applicable` | 每个分量带 `_score` / `_result` / `_reason` / `_status` |

Microsoft Foundry 的指标表最贴近本需求的四象限，照录其定义〔直读 D16〕：

| 评测器 | 类别 | 测什么 | 需要的输入 |
|---|---|---|---|
| Task Completion | 结果 | 是否完成了请求的任务、交付物可用且满足全部用户要求 | `query`、`response` 或 `messages` |
| Task Adherence | 结果 | 动作是否遵循系统指令里的规则、流程与政策约束 | 同上（系统指令有用） |
| Intent Resolution | 结果 | 是否正确识别了用户意图 | `query`、`response` 或 `messages` |
| Task Navigation Efficiency | 结果 | 工具调用序列是否高效（**需要期望序列**） | `actions`、`expected_actions` |
| Tool Call Accuracy | 过程 | 是否以正确参数做了正确的工具调用、无冗余 | `query`/`messages` + `tool_definitions` |
| Tool Selection | 过程 | 是否选对了工具且没选多余的 | 同上 |
| Tool Input Accuracy | 过程 | 参数是否正确（接地、类型、格式、必填、无多余参数、取值六条） | 同上 + `response` |
| Tool Output Utilization | 过程 | 是否正确理解并使用了工具返回结果 | 同上 |
| Tool Call Success | 过程 | 工具调用是否成功、有无技术错误（**不需要 LLM**） | `response` 或 `messages` |

四家产品的共性数据模型（子调研归纳，本方案 §5.3 采用）：

- **指标定义**：key / 名称 / 说明、类型（规则、裁判、人工）、作用层级（步骤、轮、会话）、输入映射、值类型（布尔 / 类别 / 数值 / 文本）与刻度、优化方向、通过条件、裁判配置、版本。
- **生效规则**（与定义分离，一条定义可挂多条规则）：作用范围、过滤条件、采样率、空闲超时、回填起点、预算上限。
- **评分记录**：指标 key + 版本、挂载目标、值、来源（裁判 / 规则 / 人工 / 用户反馈）、理由、人工纠正、**状态**（pending / ok / error / skipped / 未采样）、裁判自身的 trace 与成本。

几条文档明写的坑：检测问题类模板是「`true` = 发现了问题」，不能染成通过色；会话级与步骤级不要共用同一个 key；裁判保存前先发一次结构化输出测试请求，模型不支持就直接阻断（Langfuse，主会话直读确认）。

### 2.5 共识与非共识

**共识（可直接采纳）**

1. 确定性优先，LLM 裁判只补语义类。Anthropic 工程博客、τ²-bench、AgentHarm、Phoenix 的 “Code first”、Azure（Tool Call Success 与 Task Navigation Efficiency 不走 LLM）口径一致。
2. 指标定义与生效规则是两个对象。
3. 评分记录 = 名称 + 值或标签 + 理由 + 来源 + 方向。
4. 评终态优先，路径只作诊断。
5. 裁判上线前要校准：LangSmith 建议至少 20 条且正负均衡；Phoenix 文档主张 100+ 条人工样本、准确率 > 80%、TPR 与 TNR > 70%（子调研）。
6. 分数与成本一起报。
7. 在线评测一律异步，不阻塞业务请求。

**非共识或未解（设计时要留开关）**

1. 二值还是 1–5：Phoenix 主张二值优于 Likert；deepeval、Azure 用 1–5 再按阈值转二值。
2. 逐步评与整条评谁更准：Who&When（2025）说逐步最好，Who&When Pro（2026）说整条最好；两者数据构造不同，不能简单取舍。
3. 给裁判更多输入是否更好：AgentRewardBench 发现同时给 a11y 树和截图反而不如只给截图。
4. Agent-as-a-Judge 是否优于普通 LLM 裁判：2024 年报 90% 对 70%；2026 年综述汇总显示「没有一致的 agentic 优势」。
5. 偏差方向相反：规则法偏严（漏判成功），LLM 裁判偏松（误判成功）。所以是「先规则，规则判不了的再给裁判」。

---

## 3. 关键结论

1. **「实时」要诚实定义。** 做不到也不必做「逐条同步判定」。本方案的三档见 §5.1；界面上必须区分「截至当前的滚动评分」与「终评」。
2. **结果指标判通过，过程指标做诊断。** 这同时满足需求和 07 号的「评终态」原则：门禁口径不变，过程信号另开一面。例外是**硬规则**（禁用工具、审批红线），它们是确定性的，违反即成立，可以作为关键项。
3. **规则全量，裁判抽样。** 规则求值毫秒级；API 级大模型单次 3–26 秒，裁判开销可达被评 agent 的数倍（SWE-PRM：22.4 对 3.61 美元）。逐步全量调用强裁判在实时链路上不可行。
4. **裁判必须看到步骤，并被明确要求逐步检查。** 只给最终回复的裁判对「不改变回复的故障」没有判别力。
5. **在线判定只作提示，终评才作结论。** 在线步级准确率 22.97%（ProMAS），事后方法搬到在线只有 9.63 Exact-F1（AgentForesight 正文）。
6. **「评不了」不是 0 分。** 评分要有状态机；不适用、出错、未采样都不进分母。
7. **裁判用不同来源的模型，上线前先校准。** 综述建议不要用与被评对象相同的模型；本产品被评 agent 与裁判多半同源（内网 provider 有限），这一条风险比业界更突出，至少要做位置交换与多次采样，并在界面上标出该裁判偏「保守」还是偏「宽松」。
8. **不内嵌第三方评测库。** 能内嵌的 TS 库都早期，且部分模式依赖外部 SaaS；Phoenix 是 ELv2。借定义、自己写纯函数。

---

## 4. 指标目录

列说明——**判定**：规则 / 环境 / 裁判；**需参考**：是否需要参考答案、期望轨迹或领域清单；**在线档位**：L0 即时（事件到达即算）、L1 轮末（该轮结束后定稿）、L2 终评（会话空闲后）、× 在线不可行（需重跑）。

### 4.1 结果类

| # | 指标 | 判定 | 需参考 | 档位 | 出处 | 本仓底座 |
|---|---|---|---|---|---|---|
| 1 | 任务完成 | 裁判 | 否 | L2 | D16；F1 | 新增 |
| 2 | 答案匹配（contains / 正则 / 精确） | 规则 | 是 | L1 | R2 `answer` | dsh-evals 已有语义 |
| 3 | 终态断言（文件 / HTTP / 脚本 / 单测） | 环境 | 是 | L2 | R2 `final_state`；B5；B6 | dsh-evals 已有断言器 |
| 4 | 任务遵循（是否守住指令里的规则与约束） | 裁判 | 否 | L2 | D16 | 新增 |
| 5 | 意图解析 | 裁判（1–5 → 阈值） | 否 | L1、L2 | D16 | 新增 |
| 6 | 忠实度 / 有据性 | 裁判 | 否 | L2 | F1；F2；D16 | 新增（知识问答场景） |
| 7 | 引用可核 | 裁判 + 抓取 | 否 | L2 | B11 | 新增 |
| 8 | 安全红线（`must_not_call`、`approval_flow`） | 规则 | 是（红线清单） | L0 | R2；R9 | dsh-evals 已有断言 |
| 9 | 拒答适当性（应拒答时拒答） | 规则 + 裁判 | 是（负样本） | L2 | B3；B10；B12 | 新增 |

### 4.2 过程类（确定性，零模型成本，可全量）

| # | 指标 | 档位 | 出处 | 本仓底座 |
|---|---|---|---|---|
| 10 | 轮数 / 步数 | L0 | R3；R2 | observe、dsh-evals 已有 |
| 11 | 预算超限（`max_turns` / `max_tokens`） | L0 | R2 `budget` | dsh-evals 已有 |
| 12 | Token 四桶 / 成本估算 | L0 | R3 | observe 已有 |
| 13 | 缓存命中率 | L0 | R3；R9 | observe 已有 |
| 14 | 工具调用数 / 成功率 / 失败率 | L0、L1 | D16；`events.ts:213` | 视图已有，指标新增 |
| 15 | 参数合法率（JSON 可解析且符合工具 schema） | L0 | B3；F5；D16 | 新增 |
| 16 | 非法动作率（调用了不存在或不可见的工具） | L0 | P10 | 新增 |
| 17 | 循环 / 重复检测（重复调用、调用图成环、推理停滞） | L0、L1 | F1 | 新增 |
| 18 | 时延（轮耗时、首 token） | L1 | P25；D11 | 新增 |
| 19 | 错误轮率 / 终止原因分布 | L1 | R3；B2 | observe 已有 |

### 4.3 过程类（裁判）

| # | 指标 | 需参考 | 档位 | 出处 | 说明 |
|---|---|---|---|---|---|
| 20 | 步骤效率 | 否 | L2 | F1 | 步骤是否必要、是否最短路径 |
| 21 | 计划遵循 / 计划质量 | 否 | L2 | F1 | 没有计划时记「不适用」，不记满分 |
| 22 | 工具选择 | 否 | L1 | D16；F3 | 选对且没选多余 |
| 23 | 工具调用准确性 | 否 | L1 | D16；F1；F2 | 参数与冗余 |
| 24 | 工具结果利用 | 否 | L1、L2 | D16；F3 | 是否读懂并用了返回结果 |
| 25 | 过度思考（0–10） | 否 | L2 | P18 | 三种模式 |
| 26 | 导航效率（与期望工具序列比对） | 是 | L1 | D16；F11；R2 | 仅在有标准流程时启用，默认只作诊断 |
| 27 | 错误分类标注（TRAIL / AgentErrorTaxonomy 的裁判子集） | 否 | L2 | P8；P9；P11 | 用分类法引导裁判 |

### 4.4 业务类

| # | 指标 | 判定 | 需参考 | 档位 | 出处 |
|---|---|---|---|---|---|
| 28 | 业务 rubric（关键项门控 + 非关键项平均，可负分） | 裁判 | 是（rubric） | L2 | P30；B10 |
| 29 | 必达信息 / 自然语言断言 | 规则（子串）或裁判（语义） | 是 | L2 | B2 |
| 30 | 禁语 / 合规检查 | 规则（词表）+ 裁判（语义） | 是 | L0、L2 | B10；R9 |

### 4.5 不在线做

| 指标 | 原因 | 归属 |
|---|---|---|
| pass^k 一致性 | 同一会话无法重跑 | 第二轨（ai-evo 仿真 / dsh-evals 重放） |
| 裁判与人的同意率、配对判别力 | 需要人工标注样本 | 本方案的校准面（P2） |

---

## 5. 方案设计

### 5.1 三轨关系与「实时」三档

```
第一轨  dsh-evals 本地金集回归     改动后必跑 · 确定性 · 离线          （已有）
第二轨  ai-evo 平台门禁           全量 / 仿真 / 红队 / 裁判治理 · 离线  （已有）
第三轨  在线会话评测（本方案）    对正在进行的会话出分 · 实时          （新增）
        └─ 三轨共用：断言语义（dsh-evals）、领域包 evals/ 目录、裁判治理口径（07 号）
```

| 档 | 时机 | 评什么 | 延迟 | 成本 | 界面标识 |
|---|---|---|---|---|---|
| **L0 即时** | 每个 `session/event` 到达 | 确定性过程指标；硬规则（禁用工具、审批红线）违反即标 | 毫秒级 | 零 | 实时数字 |
| **L1 轮末** | `turn/end` 后异步 | 该轮确定性指标定稿；抽样的步骤级裁判（工具选择、参数、结果利用） | 秒到分钟 | 抽样 | 「滚动评分 · 截至第 N 轮」 |
| **L2 终评** | 会话空闲（轮结束后一段时间无新输入）或用户手动点「立即评测」 | 结果类裁判（任务完成、约束满足、业务 rubric）整条评 | 秒到分钟 | 按需 | 「终评」 |

依据：在线评测全部异步（§2.4）；空闲超时先例为 Braintrust 30 秒、LangSmith 10 分钟（最小 2 分钟）；整条评比逐步评准（Who&When Pro）；在线判定准确率低（ProMAS、AgentForesight）。

### 5.2 判定分层

```
session/event ──▶ 轨迹投影（纯函数）──▶ ① 规则层：全量，零模型成本
                                          │ 规则判不了的
                                          ▼
                                       ② 裁判层：抽样 / 按需，异步队列
                                          │ 输出经 zod 校验；状态机
                                          ▼
                                       ③ 人工复核（P2）：纠正分数 → 校准数据
```

- **① 规则层**：复用 `observe.aggregateSessionMetrics` 的口径与 dsh-evals 的 `summarize` / `assertTrajectory`，新增循环检测、参数 schema 校验、工具成功率（§4.2）。
- **② 裁判层**：走 `runCuratorOneShot` 同管道的一次性直调；冻结提示词；输出必须是 JSON 并经 zod `strict()` 校验，校验不过记 `error` 而不是猜。裁判输入 = **原始任务描述 + 滑窗轨迹 + 工具定义**，不塞全量；被明确要求逐步检查；一个问题只判一件事。
- **③ 人工复核**：对裁判分数标记对错，用于计算一致率与混淆矩阵。

### 5.3 数据模型（草案）

```ts
/** 指标定义：评什么、怎么评。内置指标随包；业务指标来自领域包；自定义指标由 UI 新建。 */
interface MetricDef {
  key: string
  name: string
  description: string
  category: 'outcome' | 'process'
  origin: 'builtin' | 'business' | 'custom'
  kind: 'rule' | 'judge' | 'composite'
  scope: 'step' | 'turn' | 'session'
  valueType: 'boolean' | 'categorical' | 'numeric'
  direction: 'higher' | 'lower' | 'none'
  /** 通过条件；并显式声明 true 的含义是「通过」还是「发现问题」。 */
  pass?: { threshold?: number; expected?: string; trueMeans: 'pass' | 'problem' }
  rule?: { builtin: string; params?: Record<string, unknown> }
  judge?: {
    route: { provider: string; model: string }
    messages: Array<{ role: 'system' | 'user'; content: string }>
    window: { maxSteps: number; maxChars: number }
    allowSkip: boolean
  }
  composite?: { of: string[]; aggregate: 'weighted_mean' | 'all_pass'; weights?: Record<string, number> }
  /** 是否关键项：关键项未过则综合结论不通过；非关键项只进加权分。 */
  gating: boolean
  weight?: number
  version: number
}

/** 生效规则：对谁评、何时评、评多少。一条定义可挂多条规则。 */
interface MetricRule {
  metricKey: string
  scope: { packId?: string; workspace?: string }
  trigger: 'event' | 'turn_end' | 'session_idle'
  idleTimeoutMs?: number
  sampling: number
  budget?: { maxJudgeTokensPerDay: number }
  enabled: boolean
}

/** 评分记录：一次判定。 */
interface Score {
  id: string
  sessionId: string
  metricKey: string
  metricVersion: number
  target: { type: 'step' | 'turn' | 'session'; turn?: number; step?: number; seq?: number }
  /** 只有 ok 进分母。 */
  status: 'pending' | 'ok' | 'error' | 'skipped' | 'not_applicable' | 'sampled_out'
  value?: number
  label?: string
  rationale?: string
  source: 'rule' | 'judge' | 'human' | 'feedback'
  /** 裁判自身的留痕：路由、用量、耗时。 */
  judge?: { route: { provider: string; model: string }; usage?: unknown; latencyMs: number }
  createdAt: number
}
```

综合结论的聚合照 τ²-bench 的 `reward_basis` 思路：**关键项全过才算通过，非关键项加权平均**；`not_applicable` 与 `error` 不进分母。

### 5.4 评测引擎要点

| 关注点 | 做法 | 依据 |
|---|---|---|
| 存储 | `node:sqlite`，落 `$DSH_HOME/.eterna/` 下；**不写会话日志、不新增事件类型** | G3；observe 先例 |
| 归属 | 评分按会话归属裁剪，复用 access 的 `sessionOwner`（含子会话父链回退） | 54 号 §10.3 |
| 队列 | 裁判调用进独立队列，设并发上限；不占用会话回合 | Langfuse 在 worker 队列执行、默认并发 5 |
| 失败处理 | 可重试错误（限流）进 `pending` 延后重试；结构校验失败进 `error` 且不自动重试；界面可手动重评 | Langfuse 状态机（直读） |
| 裁判自检 | 保存裁判指标时先发一次结构化输出测试，不支持则阻断保存 | Langfuse（直读） |
| 长轨迹 | 滑窗 + 原始任务描述；L2 终评放不下时先做确定性摘要再评 | SWE-PRM；TRAIL |
| 版本 | 指标定义改一次版本加一；评分记录带版本；**换裁判模型等于换榜单**，结果上必须显示裁判路由 | DeepResearch Bench 做法的前车之鉴（子调研） |
| 评测自身的成本 | 裁判用量单列，不混入被测会话成本；采样率旁显示预估调用量 | Braintrust；HAL |
| 不进被测 agent | 默认不向被测会话注入评测结果 | 07:69；D5 |

### 5.5 前端信息架构

全部走 DSH 原生扩展点，不建独立页面；样式只用 `--et-*` 令牌，图标走 `@eterna/ui/icons`，文案中文。

**A. 会话内「评测」面板**（`sidebar.right.pane.tab`，与「参谋」并列）

| 区块 | 内容 |
|---|---|
| 头部 | 综合结论（通过 / 未通过 / 未评 / 部分未评）+ 时态标识（「滚动评分 · 截至第 N 轮」或「终评」）+「立即评测」按钮 |
| 结果 | 关键项逐条：通过 / 未过 / 待评 / 不适用。硬规则违反用 danger 字色，不用实心填充 |
| 过程 | 确定性指标：步数、工具调用（成功 / 失败）、循环、token、成本、时延；其下是裁判类诊断项，标注「未校准」或裁判倾向 |
| 问题 | 按错误类别列出（可判子集来自规则，其余来自裁判），点击定位到对话的对应轮次 |

每个分数显示：值、来源徽标（规则 / 裁判 / 人工）、版本号、理由（默认折叠，展开后正文不超过 3 行）。没有分数时按状态分别显示「未采样」「排队中」「评测失败」「不适用」，一律不显示为 0。

**B. 逐轮内联徽标**（`conversation.chat.turnTail`）：在轮尾显示本轮的过程摘要（如「2 次工具失败」）。该槽位在宿主 chat rc.1 上有注册坑（`packages/memory/src/client/index.tsx:157-164`），P1 末在真实 profile 上验证后再决定是否启用。

**C. 设置弹窗「评测」分区**（`settings.section`）

| 子分区 | 内容 |
|---|---|
| 指标库 | 左列表（内置 / 业务 / 自定义）+ 右编辑卡。编辑卡分四块：基本信息、判定方式、量表与通过条件、是否关键项。切换类型只换对应卡片 |
| 生效规则 | 作用范围 × 触发时机 × 采样率（旁显示预估调用量）× 预算 |
| 裁判模型 | 只能从已配置的内网 provider 里选；结构化输出自检；用一条样本轨迹试跑并显示分数、理由、原始输出 |
| 校准（P2） | 人工标注对裁判分数：一致率、混淆矩阵 |

交互纪律：资料类字段合并保存（脏检查 + 单按钮）；重评防重复点击；破坏性操作两击确认；不用原生 `confirm()`。

**D. 总览页「评测总览」**（P2，`sidebar.panellist` + `main`，usage-stats 同款）：通过率趋势、按指标分布、分数与成本并列、按版本 / 模型分组；与工作台的金集通过率并列呈现，标清「在线」与「离线」。

### 5.6 与本仓库的映射

新建一个包，建议 `packages/session-eval`（避免与现有 `@eterna/evals` 重名）：

```
src/index.ts          Host 入口：provide 服务面 + 订阅 session/event
src/trajectory.ts     事件流 → 轨迹投影（纯函数）
src/metrics/*.ts      内置规则指标（纯函数）
src/judge.ts          裁判调用、zod 校验、状态机
src/store.ts          评分库（node:sqlite）
src/service.ts        编排：规则匹配、采样、队列、预算
src/client/index.ts   槽位注册：右栏 tab / 设置分区 /（轮尾徽标）
```

必须过的关卡（均有先例可照抄）：

| 关卡 | 要求 | 先例 |
|---|---|---|
| 路由 | 包内不注册路由；access 登记 `/access/api/<前缀>/*`（`POST` + JSON）；`TOGGLEABLE_PLUGINS` 登记 | `packages/access/src/routes.ts:158`、`:232` |
| 挂载 | 两份 profile + 两份容器模板 + `entrypoint.sh` symlink + `verify-eterna-{web,super}.mjs` 行表 | 54 号 §14.1 |
| 语法 | Node strip-only：不用参数属性、`enum`、`namespace`、装饰器；包内加语法扫描测试 | 54 号 §10.5–10.6 |
| 分层 | Tier1 包不 import Tier2（tasks / workbench） | `packctl TIER001` |
| 提示词登记 | 裁判提示词模板登记进 `PROMPT_REGISTRY_ENTRIES` | PLUGIN-AUTHORING §1.2 |
| UI | `node scripts/lint-ui-tokens.mjs` 全绿；深浅两主题 × 1440 / 900 / 390 截图 | AGENTS.md |
| 验收 | 真 boot 探针要覆盖真实调用路径（真的评一条会话），不能只验装载清单 | 54 号 §16.2 |

### 5.7 分期

| 期 | 范围 | 验收 |
|---|---|---|
| **P0 确定性底座** | 轨迹投影；§4.2 的规则指标；右栏「评测」面板只读展示；`snapshot` 路由 | 指标手算对账（照 observe 的测试写法）；真实会话截图；零模型成本 |
| **P1 裁判与配置** | 评分库与状态机；队列与预算；裁判管道；§4.3 中 5–8 个裁判指标；设置分区（指标库 / 编辑器 + YAML 生成 / 生效规则 / 裁判模型 / 试跑 / 导入） | 裁判输出校验的单测；保存自检；试跑在真实模型上出分；业务指标保存后 YAML 可被加载器原样读回 |
| **P2 业务与运营** | 业务指标配置与 `metrics.yaml` 读写（§9）；rubric 关键项门控；人工复核与校准；总览页；评分回灌 dsh-evals（本地金集，§9.7） | 一个领域包端到端；校准卡出一致率；YAML 往返无损 |

### 5.8 明确不做

- 不同步拦截、不做运行时干预（那是另一个课题，见 AgentSpec / GuardAgent 一类工作）。
- 不做数据集管理、实验对比、红队（第二轨的职责）。
- 不内嵌 deepeval / Langfuse / Phoenix 等第三方库。
- 不新增 `SessionEventMap` 事件类型。
- 不建独立页面。

---

## 6. 风险与边界

| 风险 | 说明 | 对策 |
|---|---|---|
| 裁判不可靠 | 成功判定没有裁判 precision 超过 70%；难题上接近随机 | 规则优先；裁判抽样；上线前校准；界面标「未校准」 |
| 同源自评 | 被评 agent 与裁判多半来自同一家内网 provider | 优先选不同来源；位置交换与多次采样；标出裁判倾向 |
| 误报打扰用户 | 在线审计误报率可到 43.2%（AgentForesight 正文，子调研） | L0/L1 结果默认只作提示；只有终评给结论 |
| 成本与容量 | 裁判开销可达被评 agent 的数倍；会挤占业务推理容量 | 采样率 + 并发上限 + 每日预算；评测用量单列 |
| 长轨迹 | 超过 12K token 步准确率降到 50% | 滑窗 + 任务描述；终评先摘要 |
| 数据不出内网 | 第三方库有默认外发路径 | 不内嵌；裁判只走 `ctx.llm` 已配置路由 |
| 轮尾槽位 | 宿主 chat rc.1 上的注册坑 | P1 末真机验证后再启用 |
| 研究本身的局限 | 多数论文的裁判是前沿闭源模型；内网小模型做裁判的证据偏弱（8B 模型会把所有轨迹都报成有问题，开源 PRM 几乎无益） | 内网裁判必须单独校准，不能照搬论文结论 |
| 调研未覆盖 | 见 §8.0 的未核实清单 | 需要时补查 |

---

## 7. 决策与决议（2026-11-25 已拍板）

> 决议按**内容**对齐（v0.1 表内编号顺序与对外沟通时的口头编号不同，故以内容为准）。
> 除 D3、D4 外均按建议通过。

| # | 决策 | 建议 | 决议 |
|---|---|---|---|
| D1 | 「实时」的口径 | 三档：规则即时 + 轮末增量 + 空闲终评；不做逐步同步判定 | **通过** |
| D2 | 过程指标的定位 | 默认只做诊断，不进门禁、不进总分；硬规则（禁用工具、审批红线）例外，作关键项 | **通过** |
| D3 | 业务指标的配置归属 | v0.1 建议：以领域包 `metrics.yaml` 为真源，UI 只做启停/阈值/采样/裁判模型 | **改**：业务指标必须**在前端配置**，保存后写出 YAML；前端需出交互原型。→ 契约见 §9，原型见 §10 |
| D4 | 与 ai-evo 平台的关系 | v0.1 建议：划职责边界（产品内实时 + 轻量配置，平台做批量/仿真/红队） | **改**：**去掉 ai-evo，只保留实时评测**。本方案不写入、不依赖 ai-evo；07 号的双轨改为「本地金集回归 + 实时评测」两轨。仓库既有 ai-evo 集成代码的处理见 R1 |
| D5 | 裁判模型与校准门槛 | 只从已配置 provider 选，优先与被评 agent 不同来源；≥20 条人工样本校准后才显示为可信 | **通过** |
| D6 | 评测结果是否进入被测 agent | 默认不进入，只给人看；将来纠偏回写走 adviser 式 `inject` + 用户确认，单独立项 | **通过** |
| D7 | 评测用量怎么记 | 裁判 token 单列「评测用量」，不计入被测会话成本 | **通过** |
| D8 | 默认成本控制 | 规则类全量；裁判类低采样；并发上限先按 5，P1 用真实数据定 | **通过** |
| R1 | **仓库既有 ai-evo 集成代码是否下线**（新增待定） | 不建议本轮动：`packages/evolve`（三层门禁包装）、`memory` 蒸馏 G2、`observe` 信号引用、`tools/aievo-run.mjs`、`tools/ai-evo-bootstrap.py`、`tools/release-gate-v2.py`、领域包 `evals/export` 等仍有运行面。影响清单见 §11 | **不在本方案内擅自改动**；需单独安排一次「去 ai-evo」改造 |


## 8. 参考资料

### 8.0 核实说明

**主会话直接抓取原文核对的范围（〔直读〕）**

- arXiv 摘要页：AgentRewardBench（2504.08942）、AgentForesight（2605.08715）、ProMAS（2603.20260）、trajectory-judge（2609.00038）。
  注：trajectory-judge 摘要（v4，2026-11-03）里的数字与子调研读到的正文数字有出入，§2.3 只采用主会话直读的摘要数字。
- 官方文档：Microsoft Foundry “Agent Evaluators for Generative AI”全文；Langfuse “LLM-as-a-Judge”页的状态机、重试、保存自检与 worker 队列部分。
- GitHub API：deepeval、langfuse、promptfoo、phoenix、inspect_ai、ragas、autoevals、tau2-bench、agent-as-a-judge、agent-reward-bench 共 10 个仓库的 stars / license / 最近推送。
- OpenAI Evals 弃用：子调研读到 deprecations 页；主会话复核时该页返回 403，改由官方社区公告的搜索摘要交叉印证，级别记〔摘要〕。

**本轮未核实（不采信，需要时补查）**

- 产品文档：Anthropic develop-tests（地区限制）、Google Vertex AI 评测服务、AWS Bedrock 评测器、HoneyHive / Galileo / LangWatch / Openlayer / Agenta / Patronus / Lastmile。
- 国内厂商：阿里云百炼、腾讯云、字节扣子 / 火山方舟、百度千帆、智谱、讯飞的智能体评测。
- 指标口径：RAG 类指标在 RAGAS / TruLens / DeepEval 中的细节；客服的 containment、转人工率、CSAT 代理指标；数据分析与办公类基准（DABstep、SpreadsheetBench、WorkArena++）；Opik、mlflow、llama_index、TruLens 的指标清单。
- 本产品的 ai-evo 平台能力沿用 07 号记载，本轮未复测。

### 8.1 本仓库（R）

- R1 `docs/design/07-评测体系-ai-evo对接与本地eval插件.md`
- R2 `tools/evals/README.md`；`tools/evals/src/events.ts`、`trajectory.ts`
- R3 `packages/observe/src/metrics.ts`、`types.ts`；`packages/observe/README.md`
- R4 `packages/workbench/src/project/eval-view.ts`
- R5 `packages/compaction/evals/judge.ts`
- R6 `packages/tasks/src/session/assessor.ts`；`packages/tasks/src/policy/assessment.ts`
- R7 `docs/design/54-adviser-P0-probe.md`；`packages/adviser/README.md`
- R8 `docs/design/26-扩展模型-插件领域包与专业agent.md`
- R9 `packs/event-planning/evals/threshold.yml`；`packs/event-planning/evals/golden/`
- R10 `packages/usage-stats/src/index.ts`；`packages/usage-stats/src/client/index.tsx`
- R11 `packages/memory/src/extraction.ts`；`packages/memory/src/client/index.tsx`
- R12 `packages/access/src/routes.ts`
- R13 `@deepseek-ai/dsh-session@0.2.2-rc.1` `src/types.ts`
- R14 `AGENTS.md`；`docs/PLUGIN-AUTHORING.md`

### 8.2 开源项目（F）

- F1 deepeval — https://github.com/confident-ai/deepeval
- F2 ragas — https://github.com/vibrantlabsai/ragas
- F3 Arize Phoenix — https://github.com/Arize-ai/phoenix
- F4 Langfuse — https://github.com/langfuse/langfuse
- F5 promptfoo — https://github.com/promptfoo/promptfoo
- F6 Inspect AI — https://github.com/UKGovernmentBEIS/inspect_ai
- F7 openai/evals — https://github.com/openai/evals ；openai-agents-python — https://github.com/openai/openai-agents-python
- F8 autoevals — https://github.com/braintrustdata/autoevals
- F9 OpenCompass — https://github.com/open-compass/opencompass ；AgentCompass — https://github.com/open-compass/AgentCompass
- F10 EvalScope — https://github.com/modelscope/evalscope
- F11 langchain agentevals — https://github.com/langchain-ai/agentevals ；openevals — https://github.com/langchain-ai/openevals
- F12 OpenTelemetry GenAI 语义约定 — https://github.com/open-telemetry/semantic-conventions-genai
- F13 OpenInference — https://github.com/Arize-ai/openinference

### 8.3 论文（P，均为 arXiv）

- 2503.16416 Survey on Evaluation of LLM-based Agents — https://arxiv.org/abs/2503.16416
- 2507.02825 Establishing Best Practices for Building Rigorous Agentic Benchmarks — https://arxiv.org/abs/2507.02825
- 2410.10934 Agent-as-a-Judge — https://arxiv.org/abs/2410.10934
- 2504.08942 AgentRewardBench — https://arxiv.org/abs/2504.08942
- 2406.12045 τ-bench — https://arxiv.org/abs/2406.12045
- 2506.07982 τ²-bench — https://arxiv.org/abs/2506.07982
- 2505.00212 Who&When — https://arxiv.org/abs/2505.00212
- 2505.08638 TRAIL — https://arxiv.org/abs/2505.08638
- 2509.25370 Where LLM Agents Fail and How They Can Learn From Failures — https://arxiv.org/abs/2509.25370
- 2401.13178 AgentBoard — https://arxiv.org/abs/2401.13178
- 2503.13657 Why Do Multi-Agent LLM Systems Fail? — https://arxiv.org/abs/2503.13657
- 2306.05685 Judging LLM-as-a-Judge with MT-Bench and Chatbot Arena — https://arxiv.org/abs/2306.05685
- 2410.12784 JudgeBench — https://arxiv.org/abs/2410.12784
- 2510.11977 Holistic Agent Leaderboard — https://arxiv.org/abs/2510.11977
- 2407.01502 AI Agents That Matter — https://arxiv.org/abs/2407.01502
- 2502.08235 The Danger of Overthinking — https://arxiv.org/abs/2502.08235
- 2605.08715 AgentForesight — https://arxiv.org/abs/2605.08715
- 2603.20260 ProMAS — https://arxiv.org/abs/2603.20260
- 2609.00038 trajectory-judge — https://arxiv.org/abs/2609.00038
- 2608.11434 MobileJudgeBench — https://arxiv.org/abs/2608.11434
- 2509.02360 SWE-PRM — https://arxiv.org/abs/2509.02360
- 2503.18666 AgentSpec — https://arxiv.org/abs/2503.18666
- 2603.14465 AgentProcessBench — https://arxiv.org/abs/2603.14465
- 2506.21506 Mind2Web 2 — https://arxiv.org/abs/2506.21506
- 2510.04374 GDPval — https://arxiv.org/abs/2510.04374
- 2607.09996 Who&When Pro — https://arxiv.org/abs/2607.09996
- 2408.04682 ToolSandbox — https://arxiv.org/abs/2408.04682
- Anthropic 工程博客 Demystifying evals for AI agents — https://www.anthropic.com/engineering/demystifying-evals-for-ai-agents

### 8.4 基准仓库（B）

- B1 tau-bench — https://github.com/sierra-research/tau-bench
- B2 tau2-bench — https://github.com/sierra-research/tau2-bench
- B3 BFCL — https://github.com/ShishirPatil/gorilla
- B4 WebArena — https://github.com/web-arena-x/webarena
- B5 OSWorld — https://github.com/xlang-ai/OSWorld
- B6 SWE-bench — https://github.com/SWE-bench/SWE-bench
- B7 Terminal-Bench / harbor — https://github.com/harbor-framework/harbor
- B8 TheAgentCompany — https://github.com/TheAgentCompany/TheAgentCompany
- AppWorld — https://github.com/StonyBrookNLP/appworld
- B10 simple-evals（BrowseComp、HealthBench）— https://github.com/openai/simple-evals
- B11 DeepResearch Bench — https://github.com/Ayanami0730/deep_research_bench
- B12 CRMArena — https://github.com/SalesforceAIResearch/CRMArena
- AgentHarm 论文 — https://arxiv.org/abs/2410.09024

### 8.5 产品文档（D）

- D1 LangSmith 在线 LLM 裁判评测器 — https://docs.langchain.com/langsmith/online-evaluations-llm-as-judge
- D2 LangSmith 多轮在线评测器 — https://docs.langchain.com/langsmith/online-evaluations-multi-turn
- D3 LangSmith 评测器管理 — https://docs.langchain.com/langsmith/evaluators
- D4 LangSmith 反馈数据格式 — https://docs.langchain.com/langsmith/feedback-data-format
- D5 LangSmith 改进裁判评测器 — https://docs.langchain.com/langsmith/improve-judge-evaluator-feedback
- D6 Langfuse LLM-as-a-Judge — https://langfuse.com/docs/evaluation/evaluation-methods/llm-as-a-judge
- D7 Langfuse 分数数据模型 — https://langfuse.com/docs/evaluation/scores/data-model
- D8 Langfuse 评测核心概念 — https://langfuse.com/docs/evaluation/core-concepts
- D9 Braintrust 对生产流量评分 — https://docs.braintrust.dev/evaluate/score-online
- D10 Braintrust LLM-as-a-judge — https://docs.braintrust.dev/evaluate/llm-as-a-judge
- D11 Braintrust 查看 traces — https://docs.braintrust.dev/observe/examine-traces
- D12 Phoenix 记录评测结果 — https://arize.com/docs/phoenix/tracing/how-to-tracing/feedback-and-annotations/llm-evaluations
- D13 Phoenix 在界面中标注 — https://arize.com/docs/phoenix/tracing/how-to-tracing/feedback-and-annotations/annotating-in-the-ui
- D14 OpenAI Graders — https://developers.openai.com/api/docs/guides/graders
- D15 OpenAI 弃用公告（Evals 关停）— https://community.openai.com/t/deprecation-notice-evals-will-be-shut-down-on-november-30th-2026/1385537
- D16 Microsoft Foundry Agent Evaluators — https://learn.microsoft.com/en-us/azure/foundry/concepts/evaluation-evaluators/agent-evaluators

---

## 9. 业务指标配置与 YAML 契约（D3 决议落地）

### 9.1 前端配置面

设置弹窗「评测」分区四个子页，全部在前端完成业务指标的增删改：

| 子页 | 职责 | 关键交互 |
|---|---|---|
| 指标库 | 内置与业务指标的统一列表 | 搜索；按类别（结果/过程）、来源（内置/业务）筛选；启停；点业务指标进编辑器 |
| 指标编辑器 | 读写一条指标的完整定义 | 左表单（基本信息 / 判定方式 / 评分标准），右侧**实时 YAML 预览**并高亮当前指标 |
| 生效规则 | 作用范围、触发时机、采样率、预算 | 采样率滑杆旁实时显示预估调用量；关键项不可抽样 |
| 导入 YAML | 从既有文件导入 | 解析后填入编辑器，**确认再保存**；解析错误给行号与字段名 |

内置指标可以启停，不可改定义（保证跨版本可比）；业务指标可改，保存即生成 YAML。

### 9.2 文件位置与写回策略（实现建议）

| 来源 | 路径 | 谁写 |
|---|---|---|
| 领域包内置 | `packs/<行业>/evals/metrics.yaml` | 领域包作者（git 托管，前端**只读**） |
| 工作区覆盖层 | `$DSH_HOME/workspaces/<账号>/.eterna/eval/metrics.yaml` | 前端保存时写入 |

前端保存时写**覆盖层**，不修改 git 托管的领域包文件；加载时按 `key` 合并，覆盖层优先。这样既满足「前端配置、保存生成 YAML」，又不让运行时改动污染包仓库（与记忆 T1「持久化必须在 DSH_HOME 语义下」一致）。

### 9.3 字段契约

```yaml
version: 5                       # 文件级版本，每次保存 +1
updated_at: '2026-11-24T21:40:12+08:00'
updated_by: admin
metrics:
  - key: vendor-neutrality       # 唯一标识，保存后不可改
    name: 供应商比选保持中立      # ≤ 20 字
    description: 比选材料同等呈现各家报价，不出倾向性结论   # ≤ 120 字
    category: outcome            # outcome | process
    scope: session               # turn | session
    gating: true                 # 关键项：没过则综合结论不通过
    judge:
      model: deepseek-flash      # 必须来自平台已配置的内网 provider
      window:
        max_steps: 12            # 裁判最多看最近多少步
      allow_skip: true           # 判不了时记 not_applicable，不记 0
      pass:
        min_score: 0.8           # 0–1
      criteria:                  # 一条只判一件事
        - text: 三家报价以同等篇幅呈现，含总价、单价与交付周期
          weight: 2
          critical: true
        - text: 出现「建议选某一家」这类倾向性结论
          weight: -3             # 负权重扣分
          critical: false
```

规则类指标沿用 dsh-evals 金集的既有断言语义，不新增语法：

```yaml
  - key: budget-oversign-approval
    category: outcome
    scope: session
    gating: true
    trajectory:
      approval_flow: { tool: budget_change, min_count: 1 }
  - key: reply-forbidden-words
    answer:
      not_contains: [保证搞定, 内部关系]
  - key: budget-limit
    budget: { max_turns: 30, max_tokens: 200000 }
```

### 9.4 序列化规则（保存即确定）

- 键序固定：`key → name → description → category → scope → gating → judge|trajectory|answer|budget`；`criteria` 按界面顺序。
- 2 空格缩进；数组项 `- ` 紧跟父键。
- 字符串含 `: # { } [ ] , & * ' " |`、首尾空格、或形似数字/布尔时**加单引号**，内部单引号写作 `''`。
- `pass.min_score`、`weight` 为数值字面量，不加引号；`gating`、`critical`、`allow_skip` 用 `true`/`false`。
- 文件头三行注释固定（说明生成来源与「手改会被覆盖」）。
- 同一文件同一 `key` 只出现一次；保存即替换该条，不改动其它条目的顺序与内容。

### 9.5 校验（保存前，fail-closed）

| 字段 | 规则 | 失败提示 |
|---|---|---|
| name | 非空、≤ 20 字 | 定位到名称输入框 |
| key | `^[a-z0-9][a-z0-9-]{1,39}$`；新建时不得与既有 key 冲突；已保存的不可改 | 定位到标识输入框 |
| description | ≤ 120 字 | 定位到说明 |
| criteria | 至少一条；每条 `text` 非空；`weight` 为 -5..5 的非零数；**至少一条正权重**（否则算不出得分） | 定位到对应行 |
| pass.min_score | 0–1 | 定位到通过线 |
| judge.window | 正整数 | 定位到步数 |
| 规则类 | 工具名/禁语非空；`budget` 两值为数字 | 定位到对应字段 |

行为：首次**失焦**才提示；已在错误态的字段边输入边清除；提交时若有错，顶部错误摘要接管焦点，逐条锚到字段，**不保存**。

### 9.6 版本与并发

- 文件级 `version` 每次保存 +1；条目级版本 = 该指标被保存的次数（界面显示 `v3`）。
- 保存请求带 `baseVersion`；服务端不一致返回冲突，前端提示「文件已被他人修改，请刷新后重试」，不静默覆盖。
- 删除以 `enabled: false` 表达（停用），不物理删除行——历史评分仍要能追溯到当时的定义版本。

### 9.7 与既有评测体系的关系

- 规则类字段的语义与 `tools/evals`、`packs/*/evals/golden` 完全一致，因此同一套断言可离线跑金集、在线跑会话。
- 不新增 `SessionEventMap` 事件类型；指标定义与评分均落在 DSH_HOME 下的既有存储面。

---

## 10. 前端原型与实测验收

### 10.1 交付物

| 文件 | 内容 |
|---|---|
| `docs/prototypes/06-实时评测-可交互原型.html` | 可交互原型（单文件、离线打开、深浅主题、三视口、URL 直达某屏） |
| `docs/prototypes/06-实时评测-无限画布.html` | 无限画布：项目背景 / 设计系统 / 16 屏真实截图，按使用顺序排列 |
| `docs/prototypes/prototype-shots/*.png` | 18 张真实渲染截图（画布引用其中的 16 张） |
| `docs/design/design-system/eterna-v4.md` | v4 令牌的机读形式（从 `packages/ui/src/tokens.ts` 导入，供设计检查使用；真值仍是 tokens.ts） |

原型的 URL 参数：`?view=session|overview|settings-library|settings-editor|settings-import|settings-rules|settings-judge|settings-calib&theme=dark&state=final|running|error`。

### 10.2 屏幕清单

| # | 屏幕 | 覆盖的判断 |
|---|---|---|
| 1 | 会话 + 评测面板（浅） | 结论 / 关键项 / 过程诊断 / 问题定位 / 用量 |
| 2 | 指标库 | 内置与业务混排、筛选、启停、版本 |
| 3 | 指标编辑器 + YAML | **表单 ↔ 生成文件同屏**、定位高亮、脏检查 |
| 4 | 导入 YAML | 解析、行号级错误、确认后进编辑器 |
| 5 | 生效规则 | 三档时机、采样率与预估调用量、关键项不抽样 |
| 6 | 裁判模型与试跑 | 内网路由、自检、同源偏差提示、试跑结果与原始输出 |
| 7 | 校准 | 一致率、混淆矩阵、偏松/偏紧结论 |
| 8 | 评测总览 | 通过率、趋势、按指标表、成本与延迟 |
| 9 | 终评完成 | 时态切换（滚动 → 终评） |
| 10 | 评测失败 | 「没评完」独立成态、不记 0 分、可重试 |
| 11–14 | 深色版（面板 / 编辑器 / 指标库 / 总览） | 双主题 |
| 15 | 900 视口 | 右栏收为抽屉 |
| 16–18 | 390 视口（会话 / 编辑器 / 深色会话） | 单列、标题承担导航、控制区不遮挡 |

### 10.3 实测验收（2026-11-25，本机 agent-browser + CDP 注入技能自带审计脚本）

| 屏 / 态 | mustFix | advisory |
|---|---|---|
| 会话 + 评测面板（1440 浅） | **0** | tableNumbers 1、leftEdge 2（消息气泡左右交错为设计意图） |
| 会话（390 浅） | **0** | tableNumbers 1 |
| 会话（1440 深） | **0** | 同上 |
| 指标编辑器 + YAML（1440 浅 / 390 浅 / 1440 深） | **0** | 0 |
| 指标库（1440 浅） | **0** | 0 |
| 生效规则（1440 浅） | **0** | tableNumbers 1 |
| 裁判模型与试跑（1440 浅） | **0** | 0 |
| 校准（1440 浅） | **0** | echoLabel 1、tableNumbers 2、leftEdge 1 |
| 导入 YAML（1440 浅） | **0** | 0 |
| 评测总览（1440 浅） | **0** | leftEdge 1 |

其他验收：

| 项 | 结果 |
|---|---|
| 静态设计检查 `design-lint` | **0 violation**；`[color]` 提示全部位于注入的 `tokens.ts` 令牌定义块（阴影/斜面取值），自写样式无脱离令牌的颜色 |
| 横向溢出 | 1440 / 900 / 390 均 `scrollWidth === clientWidth` |
| 控制台错误 | 无 |
| 交互实测 | 改名 → 脏标记 + 预览版本递增；保存 → 提示「文件第 5 版」、行变 `v4` 并高亮、焦点回该行；试跑 → 成功 / 非法 JSON 两态；自检 → 通过 / 不通过；面板展开 → 理由 + 「判得对/判错了」；导入 → 行号级解析错误 |
| 响应式 | 1100 右栏转抽屉、760 侧栏转抽屉且标题承担导航、640 单列；断点只用 1100/760/640 |
| 双主题 | 深浅各出全套；深色令牌实测解析为 `#161917` / `#eceee9` |

审计过程中修掉的真缺陷（都是「小图或单测看不出、真渲染才暴露」）：

1. `hidden` 属性被自定义 `display` 覆盖 → 设置弹窗一加载就弹开且内容为空。
2. 共享组件样式作用域 `[data-eterna-ui]` 未覆盖弹窗与控制条 → 按钮退回浏览器默认样式（无圆角、灰底）。
3. 非贪婪正则剥离「跟随系统」媒体块破坏了花括号配对 → 深色规则被 CSS 解析器吞掉，切深色无反应。
4. 串接选择器（`.se-app .se-menu`）的 `display:none` 被 `[data-eterna-ui] .et-btn` 覆盖 → 窄屏专用按钮在 1440 全部露出。
5. `auto` 网格列遇到 `nowrap` 内容被压成 0 宽 → 「问题」行轮次标签压在正文上。
6. 控制条换行后遮挡内容 → 改为文档流 + 抽屉让出实测高度（CSS 变量）。
7. sticky 保存栏遮住表单最后一行 → 改为随内容滚动。
8. YAML 预览内部滚动与跨行高亮使可见区域与测量不一致 → 取消内部滚动、代码块不折行改横向滚动、列宽加到 300–360。
9. 字号与对比度：12px 长文本（YAML 代码块）提到 15px；`jade`/`warn` 徽标与 `--et-meta` 提示文字在各自底色上不足 4.5:1 → 改文字色，语义交给文案与形状。

**顺带发现的共享组件缺陷（应反馈到 `packages/ui`）**：`COMPONENT_CSS` 里 `.et-input::placeholder` 用 `--et-meta`，在输入底 `--et-surface-3` 上实测 3.68:1，低于 4.5:1；`.et-badge[data-tone="jade"]` 字色 `--et-jade` 在 12px 玉面上实测 3.97:1；`[data-tone="warn"]` 4.22:1。本原型已在包外覆盖，生产组件未动。

### 10.4 本轮未做

- 未接真实数据：所有数字与文案均标注「演示数据 · 原型」。
- 未做截图化的空数据首次态（代码里有该分支，未纳入本轮 18 屏）。
- 未做无障碍自动化（axe 等）与键盘全路径走查（仅实现焦点圈、Esc 关闭、弹窗焦点陷阱、方向键切页签）。
- 未做 Figma 导出与动效演示。

---

## 11. 去掉 ai-evo 的影响面（D4 决议，供 R1 排期）

> 本轮**不改这些代码**。它们是运行中的既有集成，改动需单独评估与回归。

| 位置 | 作用 | 去掉时的处理 | 风险 |
|---|---|---|---|
| `packages/evolve/src/aievo.ts` + `gates.ts`/`pipeline.ts`/`ledger.ts` | G2 三层门禁 CLI 包装（release/admission/heldout 三任务，退出码 0/1/2 契约） | 删包装或置 `disabled`；门禁结果字段从账本移除需迁移 | 进化流水线的门禁段会空转；账本历史含 aievo 行 |
| `packages/memory/src/distill-curate.ts`、`client/distill-report.tsx` | 蒸馏门禁 G2 与界面文案（「G2 降级跳过（ai-evo 未接入）」） | 改为「G2 由实时评测承担」或删除该档 | 蒸馏报告的完整性口径变化 |
| `packages/observe/src/signals.ts` | 信号 `ref` 注释指向 aievo 任务行（仅注释与来源约定） | 改注释与来源约定；不影响存储结构 | 低 |
| `tools/aievo-run.mjs`、`tools/ai-evo-bootstrap.py`、`tools/release-gate-v2.py` | 平台调用脚本、数据集灌入、发布门禁 | 下线脚本；发布流程改调本地金集 + 实时评测 | **发布门禁能力缺口**，需先用 dsh-evals 补足 |
| `tools/dsh2cc-jsonl.mjs`、`tools/evals/src/sessions.ts` | 会话导出供平台导入的格式 | 保留（格式本身无害），或标记为可选 | 低 |
| `packs/event-planning/evals/export/*`、`threshold.yml` 注释 | 面向平台的金集导出与门禁阈值 | 保留金集，导出脚本可下线 | 领域包作者工作流变化 |
| `docs/ai-evo-integration.md`、`docs/USER-GUIDE.md`、07 号 §2/§4、`README*` | 文档与双轨叙述 | 改为「本地金集回归 + 实时评测」两轨 | 文档一致性 |
| `acceptance/team-platform/**`、`docs/release-gate-v2/**` | 历史验收证据 | 保留为历史记录，标注「已完成历史」 | 低 |

建议顺序：① 先让实时评测 P0 提供会话级结论 → ② 用 dsh-evals 补发布门禁 → ③ 再摘除 evolve/memory 的 aievo 依赖 → ④ 最后改文档与脚本，避免中途出现「既无平台门禁也无在线评测」的空窗。

---

## 12. 实现状态（2026-11-25：P0 + P1 已入库）

> 数字全部为当轮实测：`pnpm --filter @eterna/session-eval verify`、`node scripts/verify-eterna-web.mjs`、
> `node scripts/verify-eterna-super.mjs`、`node scripts/lint-ui-tokens.mjs`、
> `node tools/packctl/bin/packctl.mjs {form-check,tenant-scan,prompt-scan}`。

### 12.1 已交付

| 面 | 内容 | 位置 |
|---|---|---|
| 包 | `@eterna/session-eval`：Host 半边（服务 + 裁判引擎）+ 浏览器半边（右栏 tab + 设置分区） | `packages/session-eval` |
| 原生扩展点 | `sidebar.right.pane.tab`（tab 类型 id `@eterna/session-eval/panel`，kind `eval`）+ `settings.section`（id `@eterna/session-eval/settings`，order 48，label「评测」） | `src/client/index.ts` |
| 路由面 | `POST /access/api/session-eval/{snapshot,evaluate,settings,config/save}`（401/403/404/405/409/429/503 契约 + `cache-control: no-store`） | `packages/access/src/routes.ts` |
| P0 规则层 | 轨迹投影、15 项确定性指标、问题定位、结论卡；零模型成本 | `src/trajectory.ts` / `src/metrics.ts` |
| P1 裁判层 | 输入投影、6 项冻结裁判指标（结果类 3 / 过程类 3）、严格单 JSON 校验（多键/坏 JSON 即 error，不重试不猜）、评分库（按 session+metric+target 幂等 upsert）、并发 5 队列、L1 轮末抽样（采样率 × 3 项过程指标）+ L2 空闲终评（默认 120s，新输入撤销）、每日 token 预算（`judge_usage` 单列，不混入会话成本）、手动「立即评测」 | `src/judge-*.ts` / `src/engine.ts` / `src/host.ts` |
| 配置 | `$DSH_HOME/.eterna/session-eval/config.json`（缺失用缺省；损坏回退缺省 + 中文告警；保存 = 校验 + provider 目录自检 + 原子写） | `src/judge-config.ts` |
| 评分库 | `$DSH_HOME/.eterna/session-eval/scores.db`（`node:sqlite` STRICT；父目录显式 mkdir） | `src/score-store.ts` |
| 面板 | 裁判卡紧跟结论卡：综合结论（关键项门控）、排队/预算、立即评测、6 项评分 + 轮次徽标 + 耗时、理由与用量折叠（路由/tokens/耗时单列） | `src/client/EvalPanel.tsx` |
| 设置分区 | 裁判模型（provider/model 目录自选）、自动评测开关、轮末抽样率（含预估调用量）、每日预算、空闲终评、6 指标启停；资料类合并保存 + 脏检查 + 单按钮；非管理员只读 | `src/client/EvalSettings.tsx` |

**权限口径**：`settings` 登录即可读（返回 `admin` 标志）；`config/save` 仅管理员（403 且服务面不被触达，实现 + 测试双钉）；`snapshot/evaluate` 按 `store.sessionOwner` 校归属，跨租户 404。审计事件 `access.session-eval.evaluate` / `access.session-eval.config`（成功与失败都记）。

**有意为之的两个决定**：
1. **裁判提示词冻结在包内**，不登记 prompt-studio：prompt-scan 只扫 `systemPrompt: true` / `ctx.systemPrompt.section` 注册面；裁判提示词是评测口径的一部分，必须随版本冻结、由单测钉住（`tests/judge-metrics.test.ts` 逐字断言），登记进工坊反而让「换提示词等于换榜单」失去约束。
2. **裁判用量单列**：`judge_usage` 只服务预算闸与面板展示，不并入被测会话的 token/成本（否则「评测动作改变被评对象」）。

**本轮 P1 的范围收窄（与 §5.7 的差异，明确记账）**：§5.7 把「业务指标编辑器 + YAML 生成 + 试跑 + 导入」列在 P1 末段，但它们与 P2 的 `metrics.yaml` 契约（§9）同源；分两轮写会先产出一版 YAML 生成器再被编辑器推翻。故本轮 P1 只落**裁判层 + 基础设置分区（模型/抽样/预算/空闲/指标启停）**，业务指标那一组整体并入 P2，一次落地。同理，§5.7 P1 验收里的「试跑在真实模型上出分」需生产凭据，本轮**未做**（裁判管道由 fake llm 端口单测钉住），留部署后演练。

### 12.2 验证证据

| 门禁 | 结果 |
|---|---|
| `pnpm --filter @eterna/session-eval verify`（build-client + oxlint + tsc + vitest） | oxlint 0 warning / 0 error；14 个测试文件 **114 passed** |
| `packages/access` 路由门禁 | 16 项通过（跨租户/管理员/预算 429/在途 409/no-store/审计） |
| 全仓 `pnpm -w run verify` | **EXIT=0**（含面板/参谋/记忆等全部既有包） |
| `verify-eterna-web.mjs`（真实 boot） | OK — **232** host entries；slot drift `settings.section=5`、12 个挂载包 declared==served |
| `verify-eterna-super.mjs`（真实 boot） | OK — **240** host entries；slot drift `settings.section=6`、14 个挂载包 declared==served |
| `scripts/lint-ui-tokens.mjs` | 19 目录 340 文件、79 个 `--et-*` 令牌、v4 阶梯 **0 债务** |
| `packctl form-check / tenant-scan / prompt-scan` | 0 findings / 0 findings / 0 findings |
| `deploy/verify.sh` §8.7 | 新增匿名 `settings` 401 探针（路由面漏接线时恒 404） |

截图（深浅 × 1440/900/390，均来自真实 `lib/client.js` 工件 + 真实令牌；演示数据只用于填满视觉状态，不冒充实测）：

| 面板 | 设置分区 |
|---|---|
| `docs/assets/screenshots/session-eval-p1-panel-{light,dark}-{1440,900,390}.png` | `docs/assets/screenshots/session-eval-p1-settings-{light,dark}-{1440,900,390}.png` |

§7 自查结论：无横向溢出（390 下右栏全宽、设置表单标签上/控件下）；控件 36px 触控热区；`:focus-visible` 光圈齐备；深色走宿主 `data-ds-dark-theme` → `--dsw-alias-*` 桥接实测换肤；强调色只在「关键项」徽标与控件上，未超两处强调；卡内正文 ≤3 行；断点只用 1100/760/640。

### 12.3 P2 待做（按 §5.7 分期；P2-1 已落地，见 §13）

业务指标前端配置 + `metrics.yaml` 读写与回读校验（§9）、rubric 权重/关键项门控落地、人工校准与一致率、评测总览页、dsh-evals 回放对接；轮尾内联徽标（`conversation.chat.turnTail`）仍按 §5.5-B 留到真机验证后再启用。

---

## 13. 实现状态（2026-11-25：P2-1 业务指标账号覆盖层已入库）

> 数字全部为当轮实测：`pnpm --filter @eterna/session-eval verify`、`packages/access` verify、
> `pnpm -w run verify`、`node scripts/verify-eterna-{web,super}.mjs`、
> `node scripts/lint-ui-tokens.mjs`、`node tools/packctl/bin/packctl.mjs {form-check,tenant-scan,prompt-scan}`。

### 13.1 已交付

| 面 | 内容 | 位置 |
|---|---|---|
| 指标契约 | `BusinessMetric`（judge / trajectory / answer / budget 恰一种）、§9.4 固定键序序列化（引号触发与单引号翻倍）、§9.5 逐字段校验、`metricInputOf`（文件条目 → 保存端点输入） | `src/business-metrics.ts` |
| YAML 解析 | `parseDocument({strict,uniqueKeys})`；语法错误带行号；文件级/条目级校验失败一律中文原因；重复指标 key 拒绝；`snake_case → camelCase` 归一 | `src/business-yaml.ts` |
| 账号存储 | `$DSH_HOME/workspaces/<账号>/.eterna/eval/metrics.yaml`；账号白名单 + 逐段 `resolve` 前缀校验；临时文件 + rename 原子写；文件版本乐观锁（冲突 409）；条目版本每次保存 +1；**损坏文件拒绝覆盖**（避免一次保存抹掉人工内容）；停用写 `enabled: false` 不删行 | `src/business-store.ts` |
| rubric 裁判 | 提示词按条目动态生成（细则权重 / 关键标记 / 负权重=红线）；输出严格 `{"criteria":[{index,hit}…],"rationale"}`（条数/index 唯一/hit 三态）；得分由引擎算（命中正权重 / 正权重总和，负权重命中扣分，关键条直接门控）；**`na` 的正权重从分母剔除**；`allow_skip: false` 时 na 落 error 不猜结论 | `src/business-judge.ts` |
| 引擎接线 | `settings(account)` 带账号覆盖层视图（损坏带 warning + 原文）；`saveBusinessMetric(account,input,baseVersion)`；手动评测按账号执行 rubric 业务指标；`gating` / `metric_version` 两列随评分落库（含 `ALTER TABLE` 迁移循环） | `src/engine.ts` / `src/score-store.ts` |
| 路由面 | `POST /access/api/session-eval/metrics/save`：**写入账号只认登录身份**（body 里的 account 忽略），baseVersion 非负整数校验，ok→200 / conflict→409 / invalid→400 / io→503，`no-store`，审计 `access.session-eval.metrics`；`settings`/`evaluate` 透传 `user.account` | `packages/access/src/routes.ts` |
| 客户端 | 设置分区新增「业务指标（当前账号）」：条目列表（类别/范围/rubric 或规则型/关键项/已停用徽标）、启用开关（即改即存）、rubric 编辑器（标识不可改、名称/说明/类别/范围/关键项/通过线/窗口/allow_skip、细则 text/weight/critical 增删）、**YAML 实时预览**（与服务端同一序列化器，`updated_at/updated_by` 注明保存时写入）、409 冲突自动重读 | `src/client/BusinessMetricsSection.tsx` |

### 13.2 口径决定（本轮）

1. **业务指标存每账号覆盖层**（2026-11-25 用户拍板）：文件在 `workspaces/<账号>/.eterna/eval/metrics.yaml`，普通用户自助读写；裁判配置（模型/预算/抽样）仍部署级、管理员只读，两条边界互不覆盖。
2. **自动抽样只跑内置六项**：宿主侧自动触发没有账号上下文；业务指标只在「立即评测」按当前登录账号执行。面板文案如实说明（§13.1 客户端）。
3. **校验器/序列化器单一来源**：前端预览与保存端点 import 同一纯模块，服务端二次校验为准；`metrics.yaml` 的键序、引号规则、错误文案不因入口不同而漂移。
4. **评分行记条目版本**：`metric_version` 随评分落库，条目改版后历史分数仍可追溯到当时定义；覆盖层文件控制「是否执行 / 用哪版」，不改变「某会话已产生的评分」的可见性（评分属于会话）。
5. **规则型（trajectory/answer/budget）本轮只做存储与启停**：校验/序列化/往返已就绪，执行引擎与 YAML 导入留 P2-2；列表里可启停但「编辑」禁用并附说明（title），不静默忽略。

### 13.3 验证证据

| 门禁 | 结果 |
|---|---|
| `pnpm --filter @eterna/session-eval verify` | oxlint 0/0；18 个测试文件 **162 passed**（+48：business-metrics 13 / business-yaml 6 / business-store 12 / business-judge 10 / engine 业务路径 7） |
| `packages/access` verify | 55 个测试文件 **625 passed**；session-eval 路由 **20 项**（+4：账号透传、metrics/save 自助写/参数/冲突 409/校验 400/存储 503/审计） |
| 全仓 `pnpm -w run verify` | **EXIT=0** |
| `verify-eterna-web.mjs`（真实 boot） | OK — **232** host entries；`settings.section=5`；12 个挂载包 declared==served |
| `verify-eterna-super.mjs`（真实 boot） | OK — **240** host entries；`settings.section=6`；14 个挂载包；super 挂载面 24 行 active |
| `scripts/lint-ui-tokens.mjs` | 19 目录 **345** 文件、79 个 `--et-*` 令牌、状态点 30/30、v4 阶梯 0 债务 |
| `packctl form-check / tenant-scan / prompt-scan` | 0 / 0 / 0 findings |

截图（深浅 × 1440/900/390，真实 `lib/client.js` + 真实令牌；YAML 预览由真实序列化器生成，条目数值为演示数据）：

| 业务指标分区（列表） | rubric 编辑器 + YAML 预览 |
|---|---|
| `docs/assets/screenshots/session-eval-p2-business-{light,dark}-{1440,900,390}.png` | `docs/assets/screenshots/session-eval-p2-editor-{light,dark}-{1440,900,390}.png` |

§7 自查与截图实测抓到的两个真缺陷（均已修，截图复验）：
1. **390 下设置卡片横向溢出**（`document.scrollWidth=449 > 390`）：根因是 `<pre>` 的 `white-space: pre` 让最长 YAML 行成为整卡最小宽度；改 `pre-wrap + overflow-wrap: anywhere`（预览仍可读，长行不再撑宽）。
2. **窄屏输入框撑出网格**：`width:100%` 配默认 `content-box`，内边距叠加到控件宽度；给设置面 input/select 补 `box-sizing: border-box`（对照修复前后 `scrollWidth` 390）。另把 `.et-eval-button:disabled` 光标从 `progress` 改为 `not-allowed`（停用/进行中是两种语义）。

### 13.4 P2 余下（按 §5.7 分批）

规则型业务指标执行（`trajectory.approval_flow` / `answer.not_contains` / `budget` 与 YAML 导入及行级错误）、三角色 rubric 试跑（真实模型）、人工校准（一致率/混淆矩阵）、评测总览（遵守「不做独立页面」：候选为面板内视图切换）、dsh-evals 回放对接。条目级 `judge.model` 本轮只落盘，执行仍用全局裁判路由（§9.3 注记）。
