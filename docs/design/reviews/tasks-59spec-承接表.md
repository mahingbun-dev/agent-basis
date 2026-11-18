# tasks 59 spec 承接对账表（35-A27 收口）

> 任务：35 号 A27「59 spec 承接收口与 M1 对齐」交付条款要求「承接统计之外另做逐文件归属对账：34 §4 全部目标测试文件……零悬空方可判『按 34 §4 落任务』成立」。本表即该对账：SA 侧 59 个 `tests/*.spec.*`（`ls` 实测，fixtures/ 目录不计）逐件登记去向（承接 / 合并承接 / 机制并入 / 不承接+理由），并与 `packages/tasks/tests` 现状对账。
> SA 副本路径（35 号 §0-B8 修订附记钉住）：`/Users/sunny/.zcode/workspace/1794762961511-29e33e2a-233c-4894-81a4-71a6894ae22f/dsh-superagent-prototype`。
> 对账时点：2026-11-18 02:41（本轮 A27 收口实测终态）。对账方法：`ls` SA tests 与 `packages/tasks/tests` 逐文件核对 × 34 号 §4 承接表目标列 × 35 号各任务「验收门禁」列具名文件 × `docs/design/reviews/2026-11-18-全量排查-未完成开发项目清单.md` 的任务状态列。
> 登记约定：**承接**=在本仓重写为对等测试（有具名目标文件）；**合并承接**=多个 SA spec 合并进一个具名目标文件；**机制并入**=测试对象不整搬、其守护的机制由本仓其他具名测试覆盖；**不承接**=面板/前端域或有明确去向（30 号 workbench / channels / 31 号 CI / SA 内部规则）。
> 状态口径：**已落**=目标文件在 `packages/tasks/tests` 存在且包级 verify 全绿；**本次补**=35-A27 本轮补齐；**并行落**=35 号其他任务线在本对账时段内落盘（附实测时刻）；**悬空**=具名目标文件未落，归属任务在列——A27 不越权代写其实现未落地的测试（实现缺失时测试无法全绿，违背 A27 门禁「tests/**/*.spec.ts 全绿」）。
> 收口核验（本轮实跑）：【C】`pnpm --filter @eterna/tasks run verify` → **oxlint 0 warnings 0 errors（70 文件）+ `tsc --noEmit` 过 + vitest 30 文件 / 665 用例全绿**；【C】SA 侧 `ls tests/*.spec.* | wc -l` → 59；【C】本仓侧 `ls tests/*.spec.ts | wc -l` → 30。

---

## A. 领域内核（5）

| SA spec | 34 §4 目标 | 去向 | 本仓落点 | 状态 | 备注 |
|---|---|---|---|---|---|
| `core-engine.spec.ts` | `tests/core-engine.spec.ts` | 承接 | `packages/tasks/tests/core-engine.spec.ts` | 已落 | duplicate/followup/stop/policyChanged/realm/R3 五断言族 + 交接与单写者事务（35-A5/A6/A7/A8） |
| `stage.spec.ts` | `tests/stage.spec.ts` | 承接 | `packages/tasks/tests/stage.spec.ts` | 已落 | 阶段表逐行（第一匹配行胜出）+ canRetry |
| `model-surface.spec.ts` | `tests/model-surface.spec.ts` | 承接 | `packages/tasks/tests/model-surface.spec.ts` | 已落 | prompt 资产/版本清单/装配分段/体积预算快照；头注自注 A20 工具清单与 A24 清单体积两项待其落地后扩展 |
| `class-docs.spec.ts` | `tests/class-docs.spec.ts` | 承接 | `packages/tasks/tests/class-docs.spec.ts` | **本次补（A27）** | SA 扫描规则逐字同构扫 `src/`（24 号 §8.1-6 工程纪律；35-A3 门禁「verify 含 class-docs 纪律扫描」的具名落点） |
| `docs.spec.ts` | — | 不承接（机制并入面暂无） | — | 不适用 | SA 内部文档编号规则（docs 链接只指向更早编号）；34 §4-A 判「机制并入本仓 docs lint（若有）」——实测本仓无 docs lint 任务，登记为 SA 内部规则不适用；如后续建 docs lint 再挂 |

## B. 策略与准入（2）

| SA spec | 34 §4 目标 | 去向 | 本仓落点 | 状态 | 备注 |
|---|---|---|---|---|---|
| `policy.spec.ts` | `tests/policy.spec.ts` | 承接 | `packages/tasks/tests/policy.spec.ts` | 已落 | 三格矩阵/revalidate 五分支/admitsInferred/★联合 hash→policyEffects（:505 起）/★allowed 接 access 名单桩 |
| `admission-context.spec.ts` | `tests/candidate-context.spec.ts` | 承接 | `packages/tasks/tests/candidate-context.spec.ts` | 悬空 → **35-A19** | 窗口截断（前5+前后各5；400/1200/50）逐参数断言——被测实现 `src/session/candidate.ts` 未落地（排查清单 35-A19 missing），A27 不预登空断言 |

## C. 存储与副作用（7）

| SA spec | 34 §4 目标 | 去向 | 本仓落点 | 状态 | 备注 |
|---|---|---|---|---|---|
| `effects.spec.ts` | `tests/effects.spec.ts` | 承接 | `packages/tasks/tests/effects.spec.ts` | 已落 | UPSERT 合并/per-kind limit/指数退避/Later 不计失败/drain 留行/健康上报 |
| `outbox.spec.ts` | `tests/outbox.spec.ts` | 承接 | `packages/tasks/tests/outbox.spec.ts` | 已落 | 回执幂等/paused/behind 排队/channelIgnored·Gone→dropped（channels 桩） |
| `store.spec.ts` | `tests/store.spec.ts` | 承接 | `packages/tasks/tests/store.spec.ts` | 已落 | 表/生成列/嵌套 atomic/afterCommit/settings 版本史/★库路径 workspaces/<账号>/（tenant-scan 级） |
| `migration.spec.ts` | `tests/schema.spec.ts` | 承接 | `packages/tasks/tests/schema.spec.ts` | 已落 | tooOld/前向守卫/★本仓 v1 建库幂等 |
| `queue.spec.ts` | `tests/effects-resume.spec.ts` | 承接 | `packages/tasks/tests/effects-resume.spec.ts` | 已落 | 重启后 effect 行重派 + notice 去重（34 §4-C 行含「并入 effects/sections 测试」的 notice 半边已落 effects-resume） |
| `timeline.spec.ts` | `tests/timeline.spec.ts` | 承接 | `packages/tasks/tests/timeline.spec.ts` | 已落 | 分页/邻位/isoTime 归一（35-A27 交付条款点名→A11） |
| `cache.spec.ts` | 并入 `tests/assessor.spec.ts` | 机制并入 | `tests/assessor.spec.ts`（悬空） | 悬空 → **35-A19** | TextCache 机制随 assessor 上下文加载测试覆盖——被测实现 `src/session/assessor.ts` 未落地（35-A19 missing） |

## D. 评估与主会话（7）

| SA spec | 34 §4 目标 | 去向 | 本仓落点 | 状态 | 备注 |
|---|---|---|---|---|---|
| `assessment.spec.ts` | `tests/assessor.spec.ts` | 承接 | `packages/tasks/tests/assessor.spec.ts` | 悬空 → **35-A19** | per-eval 状态隔离/release 清理/上下文加载/R3 四要素进候选卡——被测实现未落地（35-A19 missing） |
| `prompts.spec.ts` | `tests/prompts.spec.ts`（合并） | 合并承接 | `packages/tasks/tests/prompts.spec.ts` | 已落 | 装配分段/版本绑定每次请求/团队覆盖不漂移 |
| `prompt-config.spec.ts` | 同上（合并） | 合并承接 | 同上 | 已落 | 「配置版本史(34 §4-D prompt-config 半边)」describe 段即其承接面 |
| `role-models.spec.ts` | `tests/role-models.spec.ts` | 承接 | `packages/tasks/tests/role-models.spec.ts` | 悬空 → **35-A25** | 双 preset 模型配置 + ★C5 摘要档位绑定——被测面 `cordis.patch.yml` preset 声明未落地（35-A25 missing；开放问题 9/12 未拍板） |
| `followups.spec.ts` | `tests/followups.spec.ts` | 承接 | `packages/tasks/tests/followups.spec.ts` | **并行落（A9 线，02:33）** | 人消息直达 worker 不起 Eval/handback 回 Eval/结束工单被追问恢复（模拟宿主 fixture 驱动；35-A9 门禁点名件） |
| `tools.spec.ts` | `tests/tools.spec.ts` | 承接 | `packages/tasks/tests/tools.spec.ts` | 悬空 → **35-A20** | 角色分面/R4 资源读路径/schema strict——被测实现 `src/tools/` 未落地（35-A20 missing） |
| `delivery.spec.ts` | `tests/delivery.spec.ts` | 承接 | `packages/tasks/tests/delivery.spec.ts` | 已落 | Inputs 逐条投递/readAt/deliverFailed/blocked·failed 压自动输入 |

## E. 执行器（8）

| SA spec | 34 §4 目标 | 去向 | 本仓落点 | 状态 | 备注 |
|---|---|---|---|---|---|
| `background.spec.ts` | `tests/background.spec.ts` | 承接 | `packages/tasks/tests/background.spec.ts` | 已落 | untilQuiet/stopBackground/jobs 收集（27 号 §2.2） |
| `runtime-concurrency.spec.ts` | `tests/concurrency.spec.ts` | 承接 | `packages/tasks/tests/concurrency.spec.ts` | 已落 | 槽位不超 max/人插队 +1/唤醒先于新 launch/插队计数（G2-A4 同文件族） |
| `runtime.spec.ts` | `tests/plugin-boot.spec.ts` | 承接 | `packages/tasks/tests/plugin-boot.spec.ts` | 已落 | 装配启动序 store→effects→outbox→engine→assessor→executor→sources 与关停配逆（35-A16） |
| `environment.spec.ts` | `tests/workspace.spec.ts` | 承接 | `packages/tasks/tests/workspace.spec.ts` | 悬空 → **35-A15** | ★worktree 断言删除、`.ticket/<id>/` 布局断言——R4 布局实现已落（executor/dsh.ts:107-122）且断言实质在 runtime-lifecycle.spec.ts；具名文件与 `src/executor/workspace.ts`/`gates.ts`（R2 门禁）随 A15 收口 |
| `deployment.spec.ts` | — | 不承接 | — | 不适用 | 归 31 号双形态 CI（34 §4-E 原文） |
| `index.spec.ts` | — | 不承接 | — | 不适用 | SA deployment apply/config 装配面，同上归 31 号 |
| `service-script.spec.ts` | — | 不承接 | — | 不适用 | SA `scripts/dsh-superagent` 服务脚本（ps/tmux 管理面），归 31 号 CI |
| `bundle-patch.spec.ts` | `tests/preset.spec.ts` | 承接 | `packages/tasks/tests/preset.spec.ts` | 悬空 → **35-A25** | preset 结构/压缩组四件套行序（stale→basic→command→pruner）/上游 compaction disabled——被测面 `cordis.patch.yml` 未落地（35-A25 missing） |

## F. Sources（4）

| SA spec | 34 §4 目标 | 去向 | 本仓落点 | 状态 | 备注 |
|---|---|---|---|---|---|
| `sources.spec.ts` | `tests/channel-adapter.spec.ts` | 承接 | `packages/tasks/tests/channel-adapter.spec.ts` | 悬空 → **35-A21** | channels 事件→Trigger 归一化/scope 过滤 filtered/幂等 id 派生——被测实现 `src/sources/` 未落地（35-A21 missing；channels 对端 39-E2 已备） |
| `registry.spec.ts` | 并入 channel-adapter | 机制并入 | 同上（悬空） | 悬空 → **35-A21** | SA Source 注册表不搬（34 §0-A5），注册面归 channels；其守护的「scope 过滤/幂等 id」并入 channel-adapter 判据 |
| `github-read.spec.ts` | — | 不承接 | — | 不适用 | 渠道读取归 channels 包已有测试（34 §4-F 原文；39 号已交付对端） |
| `feishu-read.spec.ts` | — | 不承接 | — | 不适用 | 同上 |
| `feishu-image.spec.ts` | — | 不承接 | — | 不适用 | 同上 |

## G. 运行时治理（8）

| SA spec | 34 §4 目标 | 去向 | 本仓落点 | 状态 | 备注 |
|---|---|---|---|---|---|
| `passes.spec.ts` | `tests/pass.spec.ts` | 承接 | `packages/tasks/tests/pass.spec.ts` | **本次补（A27）** | pass 调度合并（PassDriver 直测：在跑不重入/周期驱动/stop 停驱动/start 幂等）+ 暂停时 deadline 顺延（pausedAt 记录、越期不到期）+ 恢复重排（顺延 +121s、可裁决；对照：无暂停同间隔即过期重排重启）。SA passes.ts 不整体移植、机制并入装配（34 §2.6 第二行）——pass 周期面=src/plugin.ts PassDriver（本轮为其补可测导出，行为语义不变）、顺延面=src/core/evals.ts due() |
| `health.spec.ts` | `tests/health.spec.ts`（合并） | 合并承接 | `packages/tasks/tests/health.spec.ts` | **本次补（A27）** | HealthBoard 认领制（单写者/release 注销/重复 claim 拒）+ Effects per-kind 三败置 error、恢复转 ready、quiet 不置（SA health.spec 三 kind 语义经假 handler 直驱等价承接）；装配级健康面见 plugin-boot.spec.ts 不重复 |
| `retry-health.spec.ts` | 同上（合并） | 合并承接 | 同上 | **本次补（A27）** | 瞬时判定机制面=`transient()`（PASSING 正则 + status/code：408/429/5xx 与网络字样可重试，budget/400/401/404 等确定性失败不进退避）；SA RetryHealth 的 llm/retry 事件投影属面板消费面不承接（30 号 workbench）；退避重试计数面已由 effects.spec.ts 指数退避断言覆盖 |
| `settings.spec.ts` | `tests/settings.spec.ts` | 承接 | `packages/tasks/tests/settings.spec.ts` | **并行落（A10 线，02:33）** | 分块保存乐观并发/暂停切换/★策略同步触发联合 hash 重算（真实 Store 面） |
| `commands.spec.ts` | 并入 `tests/workspace.spec.ts` | 机制并入 | 同上（悬空） | 悬空 → **35-A15** | blockedCommands 机制已落 `src/policy/settings.ts:82`（schema 面拒收 worker 必需命令），其消费面断言随 workspace.spec；SA 侧该文件的 lark/github 命令基建半边（CliError/账号隔离）随 channels 包（39 号已交付） |
| `http.spec.ts` | — | 不承接 | — | 不适用 | 面板/HTTP 层（24 号 §8.2 明确不取；管理面 SSE 归 WS-D/管理面） |
| `cards.spec.ts` | — | 不承接 | — | 不适用 | 渠道卡/面板卡渲染——归 30 号 workbench 与 channels 渠道卡（34 §4-G 原文） |
| `views.spec.ts` | — | 不承接 | — | 不适用 | 面板视图域，归 30 号 workbench |

## H. 前端（17 件：client/controls/draft/markdown/marks/navigation/locales/styles + panel-* × 9）

| SA spec | 去向 | 备注 |
|---|---|---|
| `client.spec.tsx` | 不承接 | 34 §4-H：24 号 §8.2 明确不取其面板与 HTTP 层；交互范式按 24 号 §3 由 P2 表面工作在 panel slots 扩展点重做，测试随 30 号 workbench 计划另立 |
| `controls.spec.tsx` | 不承接 | 同上 |
| `draft.spec.ts` | 不承接 | 同上 |
| `markdown.spec.ts` | 不承接 | 同上 |
| `marks.spec.ts` | 不承接 | 同上 |
| `navigation.spec.ts` | 不承接 | 同上 |
| `locales.spec.ts` | 不承接 | 同上 |
| `styles.spec.ts` | 不承接 | 同上 |
| `panel-deployment.spec.tsx` | 不承接 | 同上（panel ×9 随 workbench 另立） |
| `panel-eval.spec.tsx` | 不承接 | 同上 |
| `panel-execution.spec.tsx` | 不承接 | 同上 |
| `panel-overview.spec.tsx` | 不承接 | 同上 |
| `panel-panel.spec.tsx` | 不承接 | 同上 |
| `panel-prompts.spec.tsx` | 不承接 | 同上 |
| `panel-settings.spec.tsx` | 不承接 | 同上 |
| `panel-source.spec.tsx` | 不承接 | 同上 |
| `panel-trigger.spec.tsx` | 不承接 | 同上 |

> 注：34 §4-H 标题计「18」件，逐文件实测为 17 件（8 非面板 + 9 panel-*）——34 号定稿时宜勘误；本表按实测数登记，不影响零悬空判定（H 组全部不承接、去向一致）。

---

## 逐文件对账统计（按 SA spec 数计）

| 去向 | 件数 | SA spec |
|---|---|---|
| 承接——目标已落（verify 全绿） | 22 | core-engine, stage, model-surface, class-docs（本次补）, policy, effects, outbox, store, migration→schema, queue→effects-resume, timeline, delivery, background, runtime-concurrency→concurrency, runtime→plugin-boot, prompts + prompt-config→prompts（2 件合并）, followups（A9 线）, settings（A10 线）, passes→pass（本次补）, health + retry-health→health（2 件合并，本次补） |
| 承接——目标悬空（归属任务在列） | 7 | admission-context→candidate-context（A19）, assessment→assessor（A19）, role-models（A25）, tools（A20）, bundle-patch→preset（A25）, sources→channel-adapter（A21）, environment→workspace（A15） |
| 机制并入（随并入目标悬空） | 3 | cache→assessor（A19）, registry→channel-adapter（A21）, commands→workspace（A15） |
| 不承接（去向明确） | 27 | docs（SA 内部规则;机制并入面=本仓 docs lint 暂无,登记不适用）+ http/cards/views（3）+ deployment/index/service-script（3,归 31 号）+ github-read/feishu-read/feishu-image（3,归 channels）+ H 组 17（归 30 号 workbench） |
| **合计** | **59** | 与 SA `ls tests/*.spec.*` 实测数一致 |

> **与 34 §4 统计行的口径差（登记备查，不视为缺陷）**：34 §4 统计行「整承接重写 24 + 合并承接 8 + 机制并入 7 + 明确不承接 20」按其分组口径计；本表按逐文件实际归属计为「承接 29（已落 22 + 悬空 7）+ 机制并入 3 + 不承接 27 = 59」（docs.spec.ts 兼具「不承接+机制并入」两性，计入不承接）。两口径差主要来自：① 34 §4-E 的 deployment/index/service-script 在统计行归入「合并承接」口径、本表按其原文「归 31 号」计入不承接；② H 组实测 17 件 vs 统计行 18 件；③ read 三件（github/feishu）34 §4-F 明文不承接。**零悬空判定不受影响**：59 件全部有名有姓、有去向、有理由。

## 本轮（35-A27）变更清单

| 变更 | 内容 |
|---|---|
| 新增 `tests/class-docs.spec.ts` | SA class-docs.spec.ts 整承接（34 §4-A；24 §8.1-6 工程纪律具名落点） |
| 新增 `tests/pass.spec.ts` | SA passes.spec.ts 承接（PassDriver 合并/周期/停驱直测 + evals due() 暂停顺延与恢复重排，对照无暂停过期重排） |
| 新增 `tests/health.spec.ts` | SA health + retry-health.spec.ts 合并承接（HealthBoard 认领制 + Effects per-kind 错误态与恢复 + transient() 判定正/负用例） |
| 新增 `tests/fixtures/engine.ts` | Engine 假件 harness 共享 fixture（34 §4-A 假件模式，core-engine.spec 同构抽取；pass.spec 消费） |
| `src/plugin.ts` 导出 `PassDriver` | 仅为其单测面（头注注明）；生产行为语义不变——createTasks 装配持有方式不变 |
| 新增 `docs/design/reviews/tasks-59spec-承接表.md` | 本表（独立承接表；A0 的 tasks-engine-review.md 建立时应引用或吸收本对账） |

## 34 §4 目标列 ↔ 35 号「验收门禁」列对账（承接统计之外的逐文件归属）

34 §4 全部具名目标文件在 35 号各任务「验收门禁」列的归属（A27 交付条款的核对项）：

| 34 §4 目标文件 | 35 号归属任务 | 门禁原文落点 | 状态 |
|---|---|---|---|
| core-engine.spec.ts | A5（另 A3/A6/A7/A8/A9 断言并入） | §4-A5 验收门禁 | 已落 |
| stage.spec.ts | A3 | §3-A3 验收门禁 | 已落 |
| policy.spec.ts | A4 | §3-A4 验收门禁 | 已落 |
| candidate-context.spec.ts | A19 | §7-A19 验收门禁 | 悬空（A19） |
| effects.spec.ts / effects-resume.spec.ts | A12 | §5-A12 验收门禁 | 已落 |
| outbox.spec.ts | A13 | §5-A13 验收门禁 | 已落 |
| store.spec.ts / schema.spec.ts / timeline.spec.ts | A11 | §5-A11 验收门禁（timeline 由 A27 交付条款点名→A11） | 已落 |
| assessor.spec.ts | A19 | §7-A19 验收门禁 | 悬空（A19） |
| prompts.spec.ts | A23 | §8-A23 验收门禁 | 已落 |
| role-models.spec.ts | A25 | §8-A25 验收门禁（A27 交付条款点名） | 悬空（A25） |
| followups.spec.ts | A9 | §4-A9 验收门禁 | 已落（A9 线） |
| tools.spec.ts | A20 | §7-A20 验收门禁 | 悬空（A20） |
| delivery.spec.ts | A22 | §7-A22 验收门禁 | 已落 |
| background.spec.ts / concurrency.spec.ts | A14 | §6-A14 验收门禁 | 已落 |
| plugin-boot.spec.ts / pass.spec.ts / health.spec.ts | A16 | §6-A16 验收门禁（pass/health 由 A27 交付条款点名→A16） | 已落（pass/health 本次补） |
| workspace.spec.ts（+ deliverable-check/assignment-files） | A15 | §6-A15 验收门禁 | 悬空（A15） |
| preset.spec.ts / role-models.spec.ts | A25 | §8-A25 验收门禁 | 悬空（A25） |
| channel-adapter.spec.ts | A21 | §7-A21 验收门禁 | 悬空（A21） |
| settings.spec.ts | A10 | §5-A10 验收门禁（A27 交付条款点名→A10） | 已落（A10 线） |
| class-docs.spec.ts / model-surface.spec.ts | A27 | §8-A27 交付条款具名 | 已落（class-docs 本次补） |
| idempotency.spec.ts（G2-E3 tasks 半边） | A6 | §4-A6 验收门禁 | 已落（A6 线） |
| eval-delegation.spec.ts（G2-A5） | A7 | §4-A7 验收门禁 | 已落（A7 线） |
| mandate-policy.spec.ts（G2-A15 tasks 半边） | A8 | §4-A8 验收门禁 | 已落（A8 线） |
| attention.spec.ts（G2-A6 半边） | A9 | §4-A9 验收门禁 | 已落（A9 线） |
| active-tickets.spec.ts（G2-A8） | A24 | §8-A24 验收门禁 | 悬空（A24） |
| budget.spec.ts（G2-A3 tasks 侧） | A17 | §6-A17 验收门禁 | 悬空（A17） |
| subagent-policies.spec.ts（G2-A16） | A18 | §6-A18 验收门禁 | 悬空（A18） |

**悬空具名文件清单（截至对账时点 02:41，全部归属在列、无一悬空无主）**：candidate-context / assessor（A19）、role-models / preset（A25）、tools（A20）、workspace + deliverable-check / assignment-files（A15）、channel-adapter（A21）、active-tickets（A24）、budget（A17）、subagent-policies（A18），另 packages/governance 侧 rules-version.spec.ts（A10/governance 规则版本化专项）。悬空原因一致：被测实现未落地（35-A15/A17/A18/A19/A20/A21/A24/A25 在排查清单为 missing/partial），A27 门禁要求全绿故不预登空断言；随归属任务落地时补齐。

## 本仓自有测试（非 SA 承接面，备查）

`packages/tasks/tests` 另有六件非 34 §4 承接表目标的自有测试（均由 35 号任务门禁具名）：`memory.spec.ts`（A3 memory.ts 不变量+SA store.spec 内存半边）、`model.spec.ts`（A3 realm 类型钉住+谓词）、`realm.spec.ts`（A11，G2-A7）、`routing-golden.spec.ts`（A26，G2-A9）、`runtime-lifecycle.spec.ts`（A16 模拟宿主）、`skeleton.spec.ts`（A1）；另有四件 G2 门禁具名文件（非 SA spec）：`idempotency.spec.ts`（A6/G2-E3）、`eval-delegation.spec.ts`（A7/G2-A5）、`mandate-policy.spec.ts`（A8/G2-A15）、`attention.spec.ts`（A9/G2-A6）。`types.seam-pin.ts`（A1 类型钉住，非 spec）；`fixtures/engine.ts`（本轮 A27 抽取的假件 fixture）、`fixtures/host.ts`（A14/A22 模拟宿主）、`fixtures/routing-golden/`（A26 金集）。

## 对账时点的可执行核验（本轮实跑）

- 【C】SA 侧计数：`ls /Users/sunny/.zcode/workspace/…/dsh-superagent-prototype/tests/*.spec.* | wc -l` → **59**
- 【C】本仓侧：`ls packages/tasks/tests/*.spec.ts | wc -l` → **30**
- 【T/C】`pnpm --filter @eterna/tasks run verify` → **oxlint 0 warnings 0 errors（70 文件）+ `tsc --noEmit` 通过 + vitest `Test Files 30 passed (30)` / `Tests 665 passed (665)`**（2026-11-18 02:41 实跑两次，终态全绿）
- 备注：对账时段（02:27–02:34）35 号 A6/A7/A8/A9/A10 各任务线在同一工作树并行落盘其具名门禁文件，期间 verify 曾红于其在途文件（eval-delegation 10 lint 错/idempotency 1 失败/mandate-policy 1 失败/attention 7 tsc 错等），至 02:41 各线自修完毕、全树 verify 全绿——本表状态列以终态为准。
