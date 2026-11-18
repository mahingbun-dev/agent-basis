# 35 - tasks 包内核开发文档（WS-A 落地）

> 状态：**开发文档 / 待评审**。本文把 `34-tasks包详细设计-草案.md` 落成可开工、可验收的任务分解：每条任务两列可追溯——「依据条款」（设计文档号§节，精确到节）与「验收门禁」（可执行命令或测试文件，类型标注对齐 33 号 §2.1 的【C】命令/【T】测试/【A】产物三形态）。
> 定位：32 号 §2 工作流 **WS-A tasks 内核**（关键路径最长线）的实施文档；33 号 §1.3 WS-A 门禁表（G2-A1…A20）是其验收体系的唯一事实源，本文不另立门禁、只做任务级承接。
> 规格来源：`34-tasks包详细设计-草案.md` 全文 · `24-主动工作体系融合设计`（§5 架构与不变量、§5.5 R1–R6 实施契约、§8.1/§8.3 纪律）· `24a-融合设计决策速览`（拍板记录 2026-11-17 四轮）· `27-执行者模型与冲突解决`（§3 冲突五机制与三层权力）· `28-上下文策略`（§1.1 候选卡窗口、§3 压缩组、§5 路由金集、§6 活跃工单清单）· `26-扩展模型`（§4.1 worker 声明段）· `29-统一工具编排`（§6 与 tasks 的关系）· `30-Subagent工作台`（§2/§7 事件面消费方）· `33-开发总工作流与门禁`（G0–G4）。
> 铁律：本文不发明上述文档之外的任何行为；设计缺口一律进 §12 开放问题，不自行补设计。涉及前端/交互的任务附「交互细节对照表」（出处限 24/26/27/28/29/30 号及 24a 拍板记录；实现位置精确到本包文件）。
> 日期：2026-11-17

---

## 0. 现实基线（本日实测代码事实）

| # | 事实 | 证据 |
|---|---|---|
| B1 | `packages/tasks` 不存在，待新建 | 本日实测 `ls packages/` 无 tasks 目录 |
| B2 | 包级 verify 惯例 = `oxlint --config ../../.oxlintrc.json . && tsc --noEmit && vitest run` | 实测 `packages/interact/package.json` scripts（34 §1 已引用对齐） |
| B3 | Cordis 纪律先例：策略纯函数层不触碰 ctx 全局，组合层以服务（注册表 + 唯一 SERVICE_ID）provide、可配逆；模块头中文注释标注设计依据 | 实测 `packages/governance/src/index.ts:1-13` |
| B4 | defineTool seam 先例：`ctx.tools.register(def)` 返回 disposer 必须进 `ctx.effect` | 实测 `packages/memory/src/tools.ts:282`（24 §8.3 引注原文） |
| B5 | per-account store 池先例：LRU（上限 8、闲置 10min 关库）、`accountOf()` 单一真值、fail-closed 解析失败不开库 | 23 号 §3.1（34 §2.3 同构引用） |
| B6 | 压缩组四件套生产已替换、上游 `dsh-compaction-basic` 从未挂载 | 28 号 §2.1（22b 实施报告实测） |
| B7 | `packctl form-check` 与 `scripts/verify-eterna-super.mjs` 尚不存在（G0-6/G1-2 待建） | 33 号 §6-1 实测 |
| B8 | SA 源码（`dsh-superagent-prototype`）**未在本仓内定位到**（find 全仓无该目录）；34 号行号引用系其「本工作区副本」实测。本表任务引用 SA 行号时一律沿用 34 号实测值，开工首日须先钉住 SA 副本路径（A0-2）。**修订附记（2026-11-17）**：已在 zcode 工作区定位到 SA 副本 `/Users/sunny/.zcode/workspace/1794762961511-29e33e2a-233c-4894-81a4-71a6894ae22f/dsh-superagent-prototype`，行号抽查（model.ts:75/349、engine.ts:261、dsh.ts:24）与 34 号引用吻合，A23 的 prompts/ 实测出于此副本——正式钉住与全量复核仍按 A0-2。**复核完成（2026-11-18，A0）**：路径本日实测仍存在；34 号 §2.3/§2.4/§2.1 引用的 21 处 SA 行号（effects/outbox/store/model/intake/engine/dsh）逐条实测全部吻合，详见 `docs/design/reviews/tasks-engine-review.md` §7——A0-2 关闭，后续任务引用 SA 行号以上述路径为复核基准 | 本日实测 `find` 无结果；34 号 § 头「源码基线」；修订日对上述副本实测；2026-11-18 A0 复核同路径实测 |
| B9 | DSH 版本差：SA 锚 `0.2.1-alpha.2`，本仓 `0.2.2-rc.1` | 24 号 §1；34 号 §6-8 |

---

## 1. 任务总览（七个阶段，A0–A27）

```
阶段 0  前置与骨架     A0 R6 宿主 seam 评估 · A1 包骨架 · A2 双形态基建三件
阶段 1  纯函数模块     A3 core 纯函数底座 · A4 policy 纯函数层
阶段 2  Engine 五部件  A5 engine/ports/part 单写者骨架 · A6 intake · A7 evals(R3)
                       · A8 tickets(冲突机制④/交接) · A9 assignments+replies(Attention)
阶段 3  持久化与适配   A10 policy/admission 接线 · A11 store+realm router · A12 effects
                       · A13 outbox
阶段 4  执行层与模拟宿主 A14 executor 主体 · A15 workspace+gates(R4/R2) · A16 plugin 装配
                       + 模拟宿主 runtime 测试 · A17 R1 预算接线 · A18 D1 subagent_policies
阶段 5  会话/工具/Source A19 assessor+candidate · A20 tools 双面 · A21 sources 适配
                       · A22 worker sessions
阶段 6  prompts/压缩/金集 A23 中文 prompts+版本绑定 · A24 活跃工单清单 section
                       · A25 preset 压缩组+C5 分档 · A26 路由金集 · A27 59 spec 承接收口
```

依赖关系（32 号 §2：WS-A 关键路径；30 号 §6：DomainEvents 是 WS-D 实接的前置）：
A0 → A1 → A2 ∥ A3 → A4 → A5 → (A6/A7/A8/A9) → (A10∥A11) → (A12→A13) → A14 → A15 → A16 → (A17∥A18∥A19∥A20∥A21∥A22) → A23 → A24 → A25 → A26 → A27。A11 只依赖 A3（model/ports 类型）；A12 依赖 A11（effect 表落库）。里程碑归着：A0–A15、A17、A18 → G3-M1；A16 → G3-M1（plugin-boot）；A24/A25/A26 → M4 前窗（33 号 §1.3 各行「所属里程碑」列）。

---

## 2. 阶段 0：前置评估与包骨架

### A0 R6 宿主能力 seam 评估与评审登记
**交付**：对 DSH `0.2.2-rc.1` 宿主做一次 seam 评估并记录结论：① `tool-jobs`/`schedule`/session persistence 能否承接 `launch/delivery/relay` 等 effect kind（决定 A12 的裁剪幅度；结论未出前按「Effects 全量照搬」保守设计）；② executor 依赖的四类宿主事件（agent/status、agent/inbox/claimed、session/event、agent/error）与 sessions 面签名钉住（B9 版本差）；③ Temporal 失败模式清单当 checklist 对照。产物 `docs/design/reviews/tasks-engine-review.md`（含结论表）。**另**：钉住 SA 副本在本机的绝对路径并回填本文 §0-B8（34 号全部 SA 行号引用的复核基准）。
**依据条款**：24 §5.5-R6；34 §6-1、§6-8、§2.3 effects 行「先评估 DSH 宿主」；33 §1.3 G2-A12、§6 缺口 1。
**验收门禁**：【A】`docs/design/reviews/tasks-engine-review.md` 存在且 `grep -c "结论" docs/design/reviews/tasks-engine-review.md` ≥1（=G2-A12 原判据）；结论行逐项有处置（33 §2.3 评审类处置规约）。

### A1 包骨架：`packages/tasks` 落地
**交付**：按 34 §1 目录树建包：`package.json`（`@eterna/tasks`，Tier2；`description` 中文并标注设计文档编号；`exports ".": "./src/index.ts"`；verify = B2 命令）＋ `src/index.ts`（门面 re-export + `createTasks()` 装配入口）＋ 空目录骨架与 `tests/`；`tests/types.seam-pin.ts` 钉住 DSH seam 类型（B3 先例，34 §1 tests 行「类型 seam 钉住见 tests/types.seam-pin.ts（本仓惯例）」）。`.ts` 扩展名 ESM 导入；每类与公开函数 JSDoc 中文并标注设计依据。
**依据条款**：34 §1（目录树全文）、§2 通用要点①–⑤；24a 第四轮拍板（Tier2 = tasks、workbench）；33 §6-2（新包命令为预定形态）。
**验收门禁**：【C】`pnpm --filter @eterna/tasks run verify` 退出码 0（空壳：oxlint + `tsc --noEmit` + vitest 空跑）。

### A2 双形态基建三件 + Tier 登记
**交付**：① base/super 模板拆分 + `docker-compose.super.yml` + entrypoint `ETERNA_FORM`；② 新建 `scripts/verify-eterna-super.mjs`（复制 verify-eterna-web 模式，super 挂载面口径）；③ 新建 `packctl form-check` 子命令 + Tier 真值源 `docs/tiers.yml`（Tier2 登记 tasks；import 静态扫描错误码 TIER001、挂载清单比对 FORM001）。
**依据条款**：33 §1.3 G2-A11、§1.1 G0-6、§6 缺口 1；31 号 §4-1/§6-1/6-2/6-3（经 33 号转引）；34 §1 依赖方向行（base 形态不挂载 tasks）。
**验收门禁**：【C】`node scripts/verify-eterna-super.mjs` 退出码 0；`node tools/packctl/bin/packctl.mjs form-check` 退出码 0；`node scripts/verify-eterna-web.mjs` 退出码 0（base 不受扰动，G1-1）。落地前（若 A2 晚于 A1）以 G1-1 + PR 评审项代替（33 §1.1 触发时机注）。

---

## 3. 阶段 1：纯函数模块

### A3 core 纯函数底座（model / ids / reasons / errors / stage）
**交付**：移植 `SA/src/core/` 中纯函数件到 `src/core/`：`model.ts`（`Mandate`、`Ticket` 增必填 `realm: string`；`ThreadRef`/`Trigger` 不加；谓词 `followupOwners`（SA model.ts:75-88）与 `waitsForPerson`（SA model.ts:349-353）**原样保留**）；`ids.ts`（内容派生稳定 id）；`reasons.ts`（Reason 码表）；`errors.ts`（UserError + USER_ERRORS 码表）；`stage.ts`（`ticketStage`/`canRetry`，阶段表逐行对齐 SA docs/003「第一匹配行胜出」）；`memory.ts`（MemoryRepositories，测试与临时实例用）。纯函数、零 I/O、零外部依赖。
**依据条款**：34 §2.1 model 行、reasons/errors/ids/stage/memory 行；24a 拍板记录·A1（realm 进内核模型）；24 §5.3-1（幂等 id 不变量）、§5.3-2（原文「授权只在 Mandate 里，只有人的 stop 才撤销」；「不可变」字样在 24 §2.3-2 与 §7.5）；27 §3.2-②（幂等键机制）。
**验收门禁**：【T】`packages/tasks/tests/stage.spec.ts`（阶段表逐行断言，34 §4-A stage 行）；`pnpm --filter @eterna/tasks run verify`（含 class-docs 纪律扫描，见 A27）。

#### 交互细节对照表①：工单阶段（stage）数据面（消费方 = 30 号工作监控看板/任务侧栏）
| # | 已拍板交互细节 | 出处 | 实现位置 |
|---|---|---|---|
| 1 | 看板按 `person/*`、`working/queued`、`idle` 三列分组 | 30 §2 视图 1 | `src/core/stage.ts` 的 `ticketStage` 分类表（数据面）；列布局与渲染归 WS-D workbench，本包不实现 |
| 2 | 「等谁」可见化建立在 `waitsForPerson` 谓词之上 | 28 §6（示例「等你回答」）、28 §9 关系图（「27 号 waitsForPerson 的可见化」） | `src/core/model.ts`（谓词原样保留）＋ `src/session/sections.ts`（A24 消费） |
| 3 | 阶段表第一匹配行胜出（分类表可测） | 34 §4-A stage 行（承 SA docs/003） | `src/core/stage.ts`；断言在 `tests/stage.spec.ts` |
| 4 | 看板断点（1100/760/640）、`--et-*` 令牌、深浅双主题、卡点警示色驻留 | 30 §4（UI 铁律）、§2.1（卡点高亮） | **本包不实现**——归 WS-D workbench（30 §4 UI 落点）；本包仅保证 stage 值域稳定供其分组 |

### A4 policy 纯函数层（settings / admission / gate / assessment / version 的纯函数面）
**交付**：`src/policy/settings.ts`（SettingsSchema（zod `.strict()`+`.describe()`+默认值）+ SettingsBlock/Origin；`LIMITS` 常量内联）；`src/policy/admission.ts`（三格×三档矩阵与 `ADMISSION_DEFAULTS` 原样；语义升级为「realm 内名单」，存储在租户库）；`src/policy/gate.ts`（`gate`/`revalidate` 五分支/`admitsInferred` 仅 auto；`policyEffects`「规则变更→逐工单算 effect→只通知不撤销」结构）；`src/policy/assessment.ts`（`assessmentOutcome` + `AdmissionDirection` 四方向 + R3 四要素必填校验；`would_accept` 观察模式语义）；`src/policy/version.ts`（`policyVersion` = 规则内容 hash）。`DEFAULT_RULES` 的编码场景示例（copy/visual）**不搬运**，默认空表。
**依据条款**：34 §2.2 全表；24 §5.2（allowed list = access 用户；准入表按租户分 realm）；24a 拍板记录·B1（主动巡检仅观察模式）、C3（版本=内容 hash）；24 §8.3-1（zod 纪律）；27 §3.2-④（策略变更只通知不撤销）。
**验收门禁**：【T】`packages/tasks/tests/policy.spec.ts`（gate 三格矩阵、revalidate 五分支、admitsInferred 仅 auto、联合版本 hash 变更触发 policyEffects、allowed 判定接 access 名单桩——34 §4-B）；`pnpm --filter @eterna/tasks run verify`。

---

## 4. 阶段 2：Engine 五部件

### A5 Engine 单写者骨架（engine / ports / part）
**交付**：`src/core/engine.ts`（唯一事务写入者：`repo.atomic` 包裹每个命令，SA engine.ts:48-257 原样；五个角色 Pick 接口 SA engine.ts:261-270 签名不变；`evaluateDue` 的 pass 驱动由本仓 pass 周期调用）；`src/core/ports.ts`（Policy/Assessor/Executor/Outbox/Repositories/DomainEvents 端口；Repositories 全同步契约保留；`DomainEvents` 的 `ticket.ended` 载荷增加 `realm` 字段）；`src/core/part.ts`（EnginePart 基类；`EngineOptions` 增加 `realmOf: (trigger: Trigger) => string` 注入项；`prepareTicket` 钩子保留）。
**依据条款**：34 §2.1 engine/ports/part 三行、§3（五角色接口清单全文）；24 §5.3-6（单写者不变量）；27 §3.2-①（单写者=可串行化）、§3.1-5（线程串行化）；24 §5.4（ticket.ended 挂记忆整固钩子）；28 §8-3（pass 周期）。
**验收门禁**：【T】`packages/tasks/tests/core-engine.spec.ts`（duplicate 不二开票、followup 不进 Eval、stop 唯一撤销、policyChanged 不撤销在跑授权、realm 标注落库断言——34 §4-A core-engine 行）＋ realm 断言并入 `tests/realm.spec.ts`（=G2-A7）。

#### 交互细节对照表②：DomainEvents 事件面（消费方 = 30 号信息流实时图/工作监控）
| # | 已拍板交互细节 | 出处 | 实现位置 |
|---|---|---|---|
| 1 | Engine 的 11 个 DomainEvents 枚举移植保留（节点即领域对象、边即事件） | 30 §2 视图 2 | `src/core/ports.ts`（DomainEvents 端口，枚举原样移植） |
| 2 | `ticket.ended` 载荷带 `realm`（记忆整固与冲突指标按 realm 归账） | 34 §2.1 ports 行（承 24 §5.4） | `src/core/ports.ts` 载荷类型 |
| 3 | 冲突三指标数据源：attach 次数 / receive duplicate 比例 / 槽位插队次数，试点期每日可查、先记录不告警 | 27 §5-2；24a 拍板记录·D2 | 计数暴露点：`src/core/evals.ts`（attach）、`src/core/intake.ts`（duplicate）、`src/executor/slots.ts`（插队）；observe 消费面归 `packages/observe`（G2-A10） |
| 4 | 事件流传输=管理面 SSE（快照+增量、`Last-Event-ID` 续）、**非** loopback-only、经 access 鉴权 | 30 §3 | **本包不实现**——管理面扩展归 WS-D/管理面（34 §0 明确不移植 http 层）；本包仅经 DomainEvents 端口可订阅 |
| 5 | 200ms 合批、暂停、单工单回放（数据源 audit trace）；全局时间轴回放不做 | 30 §7-2（第三轮拍板） | **本包不实现**（workbench 侧）；本包保证事件可按 ticketId 过滤回放（reads 面查询，`src/store/reads.ts`） |
| 6 | 审计 trace 一份数据两用：Trigger→候选卡→Decision 理由→四要素→报告→门禁全链可查 | 24 §5.5 附加确认 | `DomainEvents` + `src/core/reasons.ts` 码表即 trace 面（34 §5-audit 行）；NDJSON 落盘归 audit 包 |

### A6 intake（Trigger 摄取 / 幂等三态 / realm 标注）
**交付**：`src/core/intake.ts`：`receive` 幂等三态 `stored/duplicate/filtered` 原样（SA intake.ts:19-62）；Trigger 保存前用 `realmOf` 标注 realm；订阅扇出 + Eval 排队。
**依据条款**：34 §2.1 intake 行；24 §5.3-1；27 §3.2-②（幂等键）、§3.3-C（重复投递收敛为一单）；24a 拍板记录·A1。
**验收门禁**：【T】`packages/tasks/tests/idempotency.spec.ts`（=G2-E3 的 tasks 半边：重复投递经幂等键收敛为一单）＋ `tests/core-engine.spec.ts` duplicate 断言；`pnpm --filter @eterna/tasks run verify`。

### A7 evals（评估批次 / Decision / R3 四要素硬约束）
**交付**：`src/core/evals.ts`：`decide` 的 inferred 只在 auto 档可 accept；observe 档全量记录 `would_accept`（B1 观察模式）；`accept` 固化 Mandate 时写入 realm；**R3 落点**：`AssessmentOutcome.accept` 必须携带委派四要素（objective / output format / tool guidance / task boundaries），缺失在 `decide` 抛 `UserError('delegationIncomplete')`。
**依据条款**：34 §2.1 evals 行；24 §5.5-R3（缺项则 Eval 拒绝）；24a 拍板记录·B1；24 §5.5-R3 行（业界证据：模糊委派是重复劳动首因）。
**验收门禁**：【T】`packages/tasks/tests/eval-delegation.spec.ts`（=G2-A5：候选卡缺任一要素 → Eval 拒绝，结构校验不靠 prompt）；`pnpm --filter @eterna/tasks run verify`。

### A8 tickets（生命周期 / Subscription / 冲突机制④ / 交接）
**交付**：`src/core/tickets.ts`：`policyChanged` 只注入 `policy-changed` Input、**不撤销 Mandate**（在跑工单钉旧版，新规则只影响新工单）；`wake`/`refuse` 的 Mandate revalidate 保留；`attach` 挂到已有工单而非新建（27 号情况 B「合并请求替代竞速」）；交接（handoff）支持 A6 拍板语义：**Mandate 独立** + 原 Ticket 订阅新工单线程。
**依据条款**：34 §2.1 tickets 行、§3 EngineForMainSession `attach` 行；27 §3.2-④（权力层级：策略新版本只通知不撤销）、§3.3-B（Eval 强制看到线程上所有工单含已结束 → attach）；24a 拍板记录·C3、A6。
**验收门禁**：【T】`tests/core-engine.spec.ts`（policyChanged 不撤销在跑授权）＋ `packages/tasks/tests/mandate-policy.spec.ts`（=G2-A15 的 tasks 半边：Mandate 固化创建时策略版本、热改后新工单用新版在跑钉旧版）；`pnpm --filter @eterna/tasks run verify`。

### A9 assignments + replies（六态报告 / Attention / 回执规则）
**交付**：`src/core/assignments.ts`：`report` 六态（progress/waiting/ready/blocked/failed/dropped）+ Attention 生命周期原样；ready 报告在 Engine 内部不改（门禁挂 executor 侧，A15）。`src/core/replies.ts`：四种 purpose（ack/answer/result/attention）规则与幂等 id 原样，投递面换 channels（A13）。
**依据条款**：34 §2.1 assignments/replies 两行、§3 EngineForExecutor `report` 行；24 §2.3-5（六态+Attention 机制）、§5.3-3（报告只说六态、问题只走 Attention）、§5.5-R5（Attention 显式化、追认可恢复结案工单）；24a 拍板记录·A6。
**验收门禁**：【T】`packages/tasks/tests/attention.spec.ts`（=G2-A6 半边：Attention 结构化字段齐全、升级不并发、结案工单可被追问恢复）＋ `tests/followups.spec.ts`（人消息直达 worker 不起 Eval、handback 回 Eval——34 §4-D）；`pnpm --filter @eterna/tasks run verify`。

#### 交互细节对照表③：Attention 状态机与「等谁」台账（消费方 = interact 审批卡 / 30 号待人项）
| # | 已拍板交互细节 | 出处 | 实现位置 |
|---|---|---|---|
| 1 | worker 只报六态、不直接与人对话（防越权）；问题只走 Attention 结构化字段 | 24 §5.1 三条约束·Report←Assignment 行、§5.3-3；27 §1.2 表「汇报对象」 | `src/core/assignments.ts`（report 六态）＋ `src/tools/worker.ts`（无对话类工具） |
| 2 | 一次只问一个具体的结构化问题；Attention 场景取严为单问 | 24 §2.2 行为律 3；34 §5-interact 行（「两者取严：Attention 场景单问」） | `src/core/assignments.ts` Attention 生命周期（单问语义）；卡面合并归 interact |
| 3 | Attention = interact 富审批卡**超集**，复用 `card.ts` 渲染管线与 R0–R3 分档、`on_no_answer` 挂起策略 | 24 §5.2 概念映射表；26 §2 interact 行 | `src/core/model.ts`（`Ticket.attention` 映射超集，34 §2.1 model 行）；渲染/分档归 interact（本包不实现） |
| 4 | 追问可恢复已结束工单（不向 A2A 终态拒收语义妥协） | 24 §5.5-R5；34 §4-D followups 行 | `src/core/tickets.ts`（Subscription 唤醒语义）＋ `tests/followups.spec.ts` |
| 5 | 交接：Mandate 独立 + 原 Ticket 订阅新工单线程（跨工单协调走交接不走 agent 互聊） | 24a 拍板记录·A6；26 §6.2（工单交接替代互聊）；27 §2.1-2 | `src/core/tickets.ts` handoff 路径 |
| 6 | Attention 定向到「审批人」角色（access 新增角色字段） | 30 §7-3（第三轮拍板 Q3）；34 §5-access 行 | 定向读取走 `realmOf`/access 注入面（`src/plugin.ts` 装配）；角色字段本身归 WS-C |
| 7 | Attention 被拒/被修改 → 负信号进 observe（与 blocked/failed 同一信号面） | 34 §5-interact negative 行（承 24 §5.4） | 信号发布经 DomainEvents；observe 消费归 observe 包 |
| 8 | escalate/冷静期/双确认运行时接线（超时正确升级、暂停非失败、replay 可恢复） | 24 §4-G2、26 §2 interact 行；32 §3（P0 溶解进 WS-E） | **接线归 WS-E**（32 §3 原文）；本包交付台账谓词 `waitsForPerson`/`followupOwners`（A3）与 Attention 状态机 |
| 9 | Attention 卡两形态：站内横幅 + 渠道卡片（原型先行） | 30 §5 首批原型清单 2 | **本包不实现**——原型与渲染归 WS-D/interact/channels；本包仅保证 Attention 载荷结构完整 |
| 10 | 断点/a11y/focus/深浅主题等卡面细节 | 30 §4 UI 铁律 | **本包不实现**（同上） |

---

## 5. 阶段 3：持久化与策略适配

### A10 policy/admission 接线（access 名单 + governance 联合 hash 版本）
**交付**：`src/policy/gate.ts` 的 `allowed` 名单查询从 settings 改为 **access 用户 + realm 准入表联合判定**（名单数据源对接 access 用户表，接线经端口注入、不 import 服务实例）；`policyVersion` 的「规则」定义扩为 **governance rules.yaml + hitl.yaml + tasks 准入表** 联合 hash，由 glue 层在热改时重算并调 `Engine.policyChanged`。计算归属（governance 侧 vs glue 层）见 §12 开放问题 3，未决前按 34 §2.2 version 行的 glue 层方案实现。
**依据条款**：34 §2.2 policyVersion/settingsPolicy 行、§5-access、§5-governance（C3 联合 hash）、§4-G settings 行；24 §5.2 表「Mandate…规则版本」行；24a 拍板记录·C3。
**验收门禁**：【T】`packages/tasks/tests/mandate-policy.spec.ts` + `packages/governance/tests/rules-version.spec.ts`（=G2-A15 全条）；`tests/policy.spec.ts` allowed 名单桩断言；`tests/settings.spec.ts`（34 §4-G settings 行归属本任务：分块保存乐观并发、暂停切换、★策略同步触发联合 hash 重算——前两项的被测存储面为 A11 store.ts settings 版本史，两任务并行、断言随先合入者跑，全绿由 A27 收口）；`pnpm --filter @eterna/tasks run verify`。

### A11 store + realm router（一租户一 SQLite）
**交付**：`src/store/store.ts`（Repositories 实现 + settings 版本史 + receipts；表结构 trigger/disposition/thread/ticket/decision/outbox/trigger_thread/effect/kv、生成列工作集、savepoint 嵌套 atomic + afterCommit **原样保留**；构造签名增加 realm，库路径派生自 `$DSH_HOME/workspaces/<账号>/`）；`src/store/schema.ts`（SCHEMA_VERSION/OLDEST_SCHEMA 迁移机制保留；`tooOld` 拒开保留；本仓首版直接建 v1，不搬 SA 10→11 迁移史）；`src/store/reads.ts`（只读视图原样，一库一 realm 天然过滤）；`src/store/kv.ts`（类型化 KV 原样）；`src/store/realm.ts`（`TasksRealmRouter`：realm → Store 的 LRU 池，23 号 §3.1 同构；账号解析复用 `accountOf()` 单一真值；fail-closed：解析失败不开库）。
**依据条款**：34 §2.3 store/migration/reads/kv/realm 五行（reads 行原文引「24 §9-3」）、§4-C timeline 行；24 §9-3（realm 进内核模型 vs Engine 外层过滤——A1 选内嵌而非外层过滤的理由；注：34 号全文止于 §7、无 §9，该指针实指 24 号）；24a 拍板记录·A1（一租户一 SQLite）；23 §3.1（B5 先例，经 34 §2.3 同构引用）；33 §1.3 G2-A7。
**验收门禁**：【T】`packages/tasks/tests/store.spec.ts`（表/生成列/索引建全、嵌套 atomic 回滚、afterCommit 时序、settings 版本史；**库路径必须派生自 workspaces/<账号>/** tenant-scan 级断言——34 §4-C）＋ `packages/tasks/tests/realm.spec.ts`（=G2-A7）＋ `tests/schema.spec.ts`（旧库拒开/新库拒开/本仓 v1 建库幂等）＋ `tests/timeline.spec.ts`（线程序时间线分页/邻位/时间戳归一 isoTime——34 §4-C timeline 行，被测面为 `src/store/reads.ts` 只读视图）；【C】`node tools/packctl/bin/packctl.mjs tenant-scan` 0 findings（=G0-4）。

### A12 effects（持久副作用队列）
**交付**：`src/effects/effects.ts`：Effects 设计照搬——enqueue 事务内 UPSERT 合并、按 kind 并发限、指数退避、`Later` 不计失败、健康上报；改造：① `reply` 投递器换 channels；② `launch/delivery` handler 接 executor；③ 按 A0 的 R6 评估结论裁剪（能由 DSH 宿主 `tool-jobs`/`schedule` 承接的 kind 优先挂宿主，Effects 只兜宿主没有的；结论未出前全量照搬）。
**依据条款**：24 §5.5-R6、§5.3-4（副作用只经 Effects/Outbox、崩溃可恢复）；34 §2.3 effects 行、§6-1；24 §2.3-6。
**验收门禁**：【T】`packages/tasks/tests/effects.spec.ts`（UPSERT 合并保序、per-kind limit、指数退避、Later 不计失败、drain 留行重试、健康上报——34 §4-C）＋ `tests/effects-resume.spec.ts`（重启后 effect 行重派）；`pnpm --filter @eterna/tasks run verify`。

### A13 outbox（回执投递 → channels）
**交付**：`src/effects/outbox.ts`：回执表 + 顺序投递 + `behind` 同会话排队保留；`sources.send` 换 channels 适配器；`channelIgnored`/`channelGone` 落 dropped。
**依据条款**：34 §2.3 outbox 行、§5-channels（Outbox reply 投递器经 channels 适配器出站、结果回到发起渠道）；24 §2.3-6；27 §3.2-②（回执幂等：同一 id 永不排队两次）。
**验收门禁**：【T】`packages/tasks/tests/outbox.spec.ts`（回执幂等同 id 不二发、paused 挂起、同会话 behind 排队、channelIgnored/channelGone 落 dropped——投递端换 channels 桩，34 §4-C）；`pnpm --filter @eterna/tasks run verify`。

#### 交互细节对照表④：Outbox 回执（消费方 = channels 渠道卡渲染）
| # | 已拍板交互细节 | 出处 | 实现位置 |
|---|---|---|---|
| 1 | 四种 purpose：ack / answer / result / attention，规则原样 | 24 §2.3-6；34 §2.1 replies 行 | `src/core/replies.ts`；`src/effects/outbox.ts` 投递 |
| 2 | 同一回执 id 永不排队两次（幂等） | 27 §3.2-② | `src/effects/outbox.ts`；断言在 `tests/outbox.spec.ts` |
| 3 | 结果回到发起的那个渠道（员工不必换工具） | 24 §7.4 场景 2；34 §5-channels | `src/effects/outbox.ts` send 面经 channels 适配器 |
| 4 | 渠道端渲染：结果卡/摘要卡；`cards.ts` 增加报告六态渲染 | 34 §5-channels cards 行；26 §2 channels 行 | **本包不实现**——归 channels 包（WS-E）；本包保证 purpose/六态载荷完整 |
| 5 | `behind` 同会话排队（顺序投递） | 34 §2.3 outbox 行（SA outbox.ts:44-51） | `src/effects/outbox.ts` |
| 6 | 回执文案语言（中文或英文）**未见拍板**（prompt 中文化拍板未显式覆盖回执文本） | 34 §6-9 只覆盖 prompt 资产 | **进 §12 开放问题 13，不自行定文案语言**；结构字段按 SA 原样 |

---

## 6. 阶段 4：执行层与模拟宿主 runtime 测试

### A14 executor 主体（dsh / slots / background）
**交付**：`src/executor/dsh.ts`（主体，去 worktree：`ticketExecution`/`ticketWorktreeName` 删除；`install()` 四类宿主事件订阅按本仓 DSH 0.2.2-rc.1 事件名对齐，seam 钉住 `tests/types.seam-pin.ts`；`workerIdle` 30 分钟后台限与 `BACKGROUND_LIMIT_MS` 保留）；`src/executor/slots.ts`（WorkerSlots：maxWorkers 槽位 + 人可插队 +1 槽 + 唤醒优先于新 launch 原样；插队次数计数暴露给 observe——D2 指标之一）；`src/executor/background.ts`（`untilQuiet`/`stopBackground`/`stopSubagents`/jobs 收集原样）。
**依据条款**：34 §2.4 dsh/slots/background 三行；24 §2.3-4（Assignment+WorkerSlots 机制）、§5.2 Executor 行（「不照搬 `git worktree`（那是编码场景）」——该决策出处即此行与 24a「不做什么」，24 §8.2 不采纳清单内无 worktree 条目，勿再误挂）；27 §3.1-4（资源冲突→槽位制）、§3.2-④（插队+1、唤醒优先）、§5-2（插队计数）、§2.2（background.ts 点名参考）。
**验收门禁**：【T】`packages/tasks/tests/concurrency.spec.ts`（重叠 trigger/delivery/launch 下：槽位不超 max、人插队 +1、唤醒先于新 launch；插队计数暴露 observe——=G2-A4 同文件族/34 §4-E）＋ `tests/background.spec.ts`（untilQuiet/stopBackground/jobs 收集）；seam 断言并入 `tests/types.seam-pin.ts`（34 §6-8）。

### A15 workspace + gates（R4 一工单一目录 + R2 分层门禁）
**交付**：`src/executor/workspace.ts`（R4：`<realm 工作区>/.ticket/<id>/` 产物布局：progress/决策/evidence 落文件，主 Session `orchestrator_read` 读文件不读消息；目录名以 24 §5.5-R4 原文 `.ticket/<id>/` 为准——34 号 §2.4 的 `.tickets/` 变体见 §12 开放问题 11，不自行裁定）；`src/executor/gates.ts`（R2 分层：deliverable 结构校验纯函数**每单必跑**，不过则记 `failed('gate:structure')`；金集 replay（调 `@eterna/evolve` gates 的 replay 适配器）**仅发布门禁与高风险抽样**触发；「ready=门禁通过」写进 Mandate 执行契约，不可被 worker 自述绕过）。
**依据条款**：24 §5.5-R2、§5.5-R4；24a 拍板记录·A2（R2 分层验收）；26 §7-2（分层建议，经 A2 拍板采纳）；27 §2.1-3（subagent 输出落文件）；34 §2.4 workspace/gates 行；33 §1.3 G2-A4。
**验收门禁**：【T】`packages/tasks/tests/workspace.spec.ts`（worktree 断言删除、`.ticket/<id>/` 布局断言——34 §4-E）＋ `packages/tasks/tests/deliverable-check.spec.ts`（=G2-A4①：结构校验每单必跑、缺段不 ready）＋ `packages/tasks/tests/assignment-files.spec.ts`（=G2-A6 前半：worker 产出写 `.ticket/<id>/`、主 Session 读文件非读消息）；【C】抽样跑法 `node tools/evals/bin/dsh-evals.mjs run --pack packs/<行业> --adapter replay`（=G2-A4②）。

### A16 plugin 装配 + 模拟宿主 runtime 测试
**交付**：`src/plugin.ts`：`createTasks()` → `ctx.tasks` 服务（注册表 + `TASKS_SERVICE_ID` 唯一 ID，可配逆）；装配启动顺序 **store→effects→engine→assessor→executor→sources**，关停配逆；pass 驱动/健康面/notice 合并等机制并入装配与 effects（34 §2.6 第二行：不整体移植、机制按需重写）。测试以**模拟宿主**（fake DSH session/事件 seam + MemoryRepositories + 假 Assessor/Executor/Policy，承 34 §4-A core-engine 的假件模式）驱动 runtime 级用例。
**依据条款**：34 §1 plugin.ts 行、§2.6 runtime 胶水行、§4-E runtime.spec→plugin-boot.spec 行、§4-G passes/health 行；26 §2.1-1（tasks 对外暴露 `ctx.tasks` 服务，与消费 `ctx.audit` 同构）；24 §5.3-5/6（横切不拥有业务状态、每状态单写者）。
**验收门禁**：【T】`packages/tasks/tests/plugin-boot.spec.ts`（装配启动顺序与关停配逆——34 §4-E）＋ `tests/pass.spec.ts`（pass 调度合并、暂停时 deadline 顺延、恢复重排——34 §4-G passes 行；SA passes.ts 不整体移植、pass 驱动机制并入本任务装配面，34 §2.6 第二行）＋ `tests/health.spec.ts`（组件健康错误态与恢复、瞬时错误退避重试——34 §4-G health 行，SA health/retry-health 两 spec 合并承接；健康面并入装配与 effects）；【C】`pnpm --filter @eterna/tasks run verify`；`node scripts/verify-eterna-super.mjs`（super 挂载面 tasks 行 active，A2 交付后）。

### A17 R1 预算守卫接线（effort 分级 + 硬截断 + 双轨计量）
**交付**：`launchQueued` 与 `resumeAfter` 接 governance budget：effort 三档（simple 1 / compare 2–4 / complex 10+）进候选卡字段与 Mandate 执行契约；`maxTokens`/`maxCost` 硬截断，超限走 `failed` 报告而非无限重试；计量双轨（技术 token / 产品工单积分）两种单位可配并正确换算（换算率口径见 §12 开放问题 17）。effort 档位声明段（26 §4.1）由领域包供给，tasks 消费。
**依据条款**：24 §5.5-R1（含 effort 分级与业界证据）；34 §2.4 dsh 行 R1 落点、§5-governance budget 行；26 §4.1 effort 段；24a 拍板记录·C2。
**验收门禁**：【T】`packages/tasks/tests/budget.spec.ts`（含双轨换算用例）+ `packages/governance/tests/budget*.spec.ts` 工单级扩展用例（=G2-A3 全条）；`pnpm --filter @eterna/tasks run verify`。

### A18 D1 subagent_policies（worker 声明段）
**交付**：worker 派生 subagent 的权限策略进包声明段 `subagent_policies`（默认只读 reviewer 类——`packages/extra` reviewer preset 变成包可引用的平台资产）；worker session 建 subagent 时受 policies 约束（借权不越 Mandate）；governance pre-execute 瀑布天然罩住 worker 与其 subagent，**不改内核**。声明段 schema 依赖 26 号 §7-1 待拍板项（G2-A18），schema 未定前以 types seam 钉住消费面形状、不预设 YAML 格式。
**依据条款**：24a 拍板记录·D1；27 §2.1-1（subagent 永不越过 Mandate）、§5-1；26 §4.1（worker 段扩展）、§7-1（schema 待拍板）；34 §2.4 background 行；33 §1.3 G2-A16、§6 缺口 14。
**验收门禁**：【T】`packages/tasks/tests/subagent-policies.spec.ts`（=G2-A16：声明段含 subagent_policies、worker 派 subagent 受约束）；schema 校验待 G2-A18 码表扩展后接 `node tools/packctl/bin/packctl.mjs lint packs/<行业>`（33 §1.3 G2-A18 占位登记）。

---

## 7. 阶段 5：会话面、工具面与 Source

### A19 assessor + candidate（候选卡决策局部化）
**交付**：`src/session/assessor.ts`（MasterAssessor per-eval 状态隔离、release 清理、候选卡投递、TextCache 机制）；`src/session/candidate.ts`（`threadWindow`：前 5 条 + 触发点前后各 5 条、400/1200 字符、50 字符存根；候选卡 ≤4000 字符；`related_tickets` ≤8（open 优先）+ `tickets_total`，**Engine 计算不靠模型记忆**、含已结束工单——27 号情况 B 防线）。
**依据条款**：34 §2.5 assessor/candidate 两行；28 §1.1 表（决策局部化四行依据）；27 §3.3-B；24 §5.3（横切断点）。
**验收门禁**：【T】`packages/tasks/tests/assessor.spec.ts`（per-eval 状态隔离、release 清理、上下文加载；R3 四要素进入候选卡与 outcome 校验——34 §4-D）＋ `packages/tasks/tests/candidate-context.spec.ts`（窗口截断逐参数断言：前5+前后各5；400/1200/50——34 §4-B）；`pnpm --filter @eterna/tasks run verify`。

### A20 tools 双面（orchestrator 14 / worker 6）
**交付**：`src/tools/orchestrator.ts`（主会话 14 工具面：decide/attach/read/report…，只读+路由+评估、无实现权工具；`orchestrator_read` 读 `.ticket/<id>/` 文件）与 `src/tools/worker.ts`（worker 6 工具面：report/handback/mark_unrelated…）；实现换 `defineTool` seam（`ctx.tools.register` 返回 disposer 进 `ctx.effect`，B4 先例）；四纪律：schema `.strict()`+默认值+`.describe()`、描述给资源语法、执行必接 `AbortSignal`、按角色分面。
**依据条款**：34 §2.5 tools 行、§1 tools 两行；24 §8.3 全节（四纪律 + defineTool 引注）；24 §2.4（双角色双工具面）；24 §5.5-R4（读文件不读消息）。
**验收门禁**：【T】`packages/tasks/tests/tools.spec.ts`（角色分面：主会话无实现权工具；资源读路径 R4；schema strict——34 §4-D）；`pnpm --filter @eterna/tasks run verify`。

#### 交互细节对照表⑤：模型面工具（交互对象 = orchestrator/worker 两个模型角色）
| # | 已拍板交互细节 | 出处 | 实现位置 |
|---|---|---|---|
| 1 | 主 Session 是分类器不是规划器：只有 accept/attach/stop/ignore 四动作，明令禁止超纲（不读代码/不评估技术范围/不设计方案/不改写请求） | 28 §1.4 | `src/tools/orchestrator.ts`（工具面即四动作，无实现权工具）；断言在 `tests/tools.spec.ts` |
| 2 | orchestrator 14 工具、worker 6 工具（双角色双 preset） | 24 §2.4；34 §1 tools 行 | `src/tools/orchestrator.ts` / `src/tools/worker.ts`；清单快照进 `tests/model-surface.spec.ts` |
| 3 | schema `.strict()` + 默认值 + `.describe()`——模型面就是 API 面 | 24 §8.3-1；26 §4.3 | 两工具文件的 zod schema |
| 4 | 工具描述给出资源语法（模型知道边界） | 24 §8.3-2；26 §4.3（description「何时用/给什么/资源语法边界」） | 每个工具 description |
| 5 | 执行函数必须接 `AbortSignal` | 24 §8.3-3 | 每个工具 execute 签名 |
| 6 | 每角色只给它该有的工具面（主会话 ≠ worker，防越权） | 24 §8.3-4 | 分面注册；断言 `tests/tools.spec.ts` |
| 7 | 注册即 `ctx.tools.register(def)`，disposer 必须进 `ctx.effect` | 24 §8.3 引注；34 §2.5 tools 行 | `src/plugin.ts` 装配（参照 `packages/memory/src/tools.ts:282`） |
| 8 | worker 的工具声明走 toolkit 能力契约——worker 在任何模型获得同一能力面、任务金集模型无关 | 29 §6 tasks 行 | 声明层对接点在 worker 工具装配（`src/plugin.ts`）；toolkit 属 WS-B 并行线、v1 不阻塞（29 §4「与 P1 无依赖冲突，可并行」） |
| 9 | 工具面变更受 model-surface drift 测试看护 | 24 §8.1-6 | `tests/model-surface.spec.ts`（工具清单快照断言） |

### A21 sources 端口与 channels 适配
**交付**：`src/sources/port.ts`（Trigger 归一化契约 + SourceScope `listened/observed/row`，只取 SA Source 契约面；注册表与轮询**不搬**）；`src/sources/channel-adapter.ts`（channels 事件 → Trigger：`channel_user` 收敛身份（27 号情况 A 归一化防线）、幂等 id 从事件内容派生；PR 生命周期绑定类（GitHub PR merge → `threadClosed`）走 Source 扩展钩子）。
**依据条款**：34 §2.5 port/channel-adapter 两行、§0 不做清单（A5）；24a 拍板记录·A5（channels 统一接收面 + Source 扩展钩子）；27 §3.3-A/C；24 §8.2（不采纳 SA 的 GitHub/飞书 Source 实现）。
**验收门禁**：【T】`packages/tasks/tests/channel-adapter.spec.ts`（channels 事件→Trigger 归一化、scope 过滤 filtered、幂等 id 派生——34 §4-F）；`pnpm --filter @eterna/tasks run verify`。

### A22 worker sessions（ensure/prompt/relay）
**交付**：`src/session/sessions.ts`：ensure/prompt/promptedId/relay/holds 契约保留，实现按本仓 DSH session 面重写；worker session id 约定 `worker-<ticketId>`（SA dsh.ts:24）保留；worker session 一律建在租户 realm 工作区内（access `sandbox.ts`/`within-root.ts` 钳制 R4 目录）。
**依据条款**：34 §2.5 sessions 行、§5-access 工作区钳制行；24 §5.2 表 Executor 行（worker session 建在租户 realm 内、不照搬 worktree）；24a 拍板记录·A4（v1 用现有沙箱旋钮）。
**验收门禁**：【T】`packages/tasks/tests/delivery.spec.ts`（Inputs 逐条投递、readAt 记录、deliverFailed 上票、blocked/failed 压自动输入——34 §4-D）；`pnpm --filter @eterna/tasks run verify`。

---

## 8. 阶段 6：中文 prompts、压缩组与路由金集

### A23 prompts 中文化 + 版本绑定 + model-surface 重标定
**交付**：`prompts/` 资产 **12 件**（= 34 §1 prompts/ 树具名 8 件（orchestrator/dispatch/worker/shared/replies/subscriptions/admission/work）＋ `handoff-*` 通配按 SA 副本 `prompts/` 实测展开 3 件（handoff.md/handoff-orchestrator.md/handoff-worker.md）＋ 新增 `VERSIONS.md` 版本清单 1 件；实测依据见 §0-B8 修订附记。SA `prompts/` 另有 `cli.md` 与 `team/` 子目录（communication/delivery/scope 3 件）不在 34 §1 清单与 §4 承接表内，处置未定 → §12 开放问题 18，本任务不自行裁定）；prompt 文本本地化为**中文为主**（34 §6-9），重写后 model-surface 体积预算**重标定**（预算数字按重写后实测回填，禁止沿用 SA 英文预算——数字未定前进 §12 开放问题 9）；版本绑定每次模型请求保留（团队可覆盖但不漂移）。
**依据条款**：34 §1 prompts/ 行、§2.5 prompts 行、§6-9；24 §8.1-4（prompt 版本绑定每次请求）、§8.1-6（模型面 drift 测试）。
**验收门禁**：【T】`packages/tasks/tests/prompts.spec.ts`（装配分段、版本绑定每次请求、团队覆盖不漂移——34 §4-D）＋ `tests/model-surface.spec.ts`（体积预算快照）；【C】`node tools/packctl/bin/packctl.mjs prompt-scan` 0 findings（运行时 section/prompt 登记面，=G0-5）。

### A24 活跃工单清单 section（28 §6）
**交付**：`src/session/sections.ts`：`[active-tickets]` system prompt section，经 prompt section seam 注入（同 dsh-memory 渐进披露先例）；一行一单（id + 标题截断 + stage + 等谁）；上限 20 行，超出折叠；**pass 周期刷新**（C6 拍板；由 plugin pass 驱动重算注入，秒级延迟无害——28 §8-3）；体积纳入 model-surface 预算测试。
**依据条款**：34 §2.5 sections 行；28 §6 全节、§8-3；24a 拍板记录·C6；33 §1.3 G2-A8。
**验收门禁**：【T】`packages/tasks/tests/active-tickets.spec.ts`（≤20 行、折叠文案、section 注入、pass 周期刷新、体积断言——=G2-A8 原判据）；【C】`node tools/packctl/bin/packctl.mjs prompt-scan` 0 findings（运行时 section 注入为三扫描面之一）。

#### 交互细节对照表⑥：活跃工单清单 section（消费方 = orchestrator 主会话 prompt）
| # | 已拍板交互细节 | 出处 | 实现位置 |
|---|---|---|---|
| 1 | section 键名 `[active-tickets]`，经 prompt section seam 注入（同 dsh-memory 渐进披露模式） | 28 §6 首段 | `src/session/sections.ts`（注入挂载在 `src/plugin.ts`） |
| 2 | 一行一单：`T-3f2a 合同审查｜working｜等 worker`（id + 标题 + 阶段 + 等谁，竖线分隔） | 28 §6 示例三行；34 §2.5 sections 行（标题截断） | `src/session/sections.ts` 行渲染纯函数 |
| 3 | 「等谁」三种样态：等 worker / 等你回答（Attention #N，已 Xh）/ 排队（n/m 槽） | 28 §6 示例三行 | `src/session/sections.ts`（读 `waitsForPerson`/槽位状态） |
| 4 | 「等谁」即 waitsForPerson 的可见化 | 28 §9 关系图 | `src/core/model.ts` 谓词（A3 保留）＋ sections 消费 |
| 5 | 上限 20 行 | 28 §6（「设上限（如 20 行）」）；34 §2.5（「上限 20 行」）；33 §2.2（≤20 行已登记） | `src/session/sections.ts`；断言 `tests/active-tickets.spec.ts` |
| 6 | 超出折叠为 `…+N more, orchestrator_read tickets` | 28 §6；34 §2.5（折叠文案原文） | `src/session/sections.ts`（**降级态：折叠即显式指引工具读取，不静默截断**） |
| 7 | 刷新时机 = pass 周期（清单是提示不是协议，秒级延迟无害） | 24a 拍板记录·C6；28 §8-3 | `src/plugin.ts` pass 驱动（对齐 A5 `evaluateDue` pass 驱动，34 §2.1 engine 行） |
| 8 | 体积受 model-surface 体积预算测试看护 | 28 §6 末段；33 G2-A8 | `tests/model-surface.spec.ts` |
| 9 | 文案中文（示例即中文样） | 28 §6 示例 | `src/session/sections.ts`（按示例形态实现） |

### A25 preset 压缩组 + C5 摘要分档
**交付**：`cordis.patch.yml` 定义 orchestrator/worker 两组 preset，压缩组照搬本仓四件套且**行序保留**：stale-tool-result-pruner → compaction-basic → command-compact → tool-result-pruner（28 §3 YAML 原文照搬；上游 `dsh-compaction-basic` 不挂载）；`isolate: compaction/toolResultPruner/staleToolResultPruner` 三键；summarization 分档配置键落位（orchestrator 用 22a 最优档——具体档名与成本口径见 §12 开放问题 9）；分档配置改动必全量重跑压缩 golden。
**依据条款**：34 §1 cordis.patch.yml 行、§4-D role-models 行；28 §3（YAML 全文）、§4-1/4-2/4-4（契约钉住/行序/分档）；24a 拍板记录·C5；33 §1.3 G2-A17、§4「压缩组挂载」行。
**验收门禁**：【T】`packages/tasks/tests/preset.spec.ts`（orchestrator/worker preset 结构、压缩组四件套行序不可调换、上游 compaction 行 `disabled: true` 断言——34 §4-E bundle-patch 承接）＋ `tests/role-models.spec.ts`（orchestrator/worker 双 preset 模型配置、★C5 主 Session 摘要档位绑定——34 §4-D role-models 行；SA role-models.ts 不整体移植、preset 声明落本任务 `cordis.patch.yml`，34 §2.6 第二行）；【C】`node packages/compaction/scripts/run-golden.mjs --judge`（报告入库，=G2-A17）；【C】`node scripts/verify-eterna-super.mjs`（preset 挂载行 active 且行序正确，A2 交付后）。

### A26 路由金集（压缩前后回归）
**交付**：路由金集 v0：**人工 20 条起步**（目标 30–50 条），判例四类——明确的 accept / 应 attach 到已有工单 / 应 ignore 的 bot 消息 / 应 stop；**在压缩后的会话状态上跑**，度量分发准确率衰减；「触发原文」列为压缩强制保留项（21 号 D3 定制品）；复用 dsh-evals replay 适配器与 evals-golden 基建；试点期月度从真实 Decision 增补。存放位置与 CI/发布触发口径未决（§12 开放问题 10），按 34 §4 精神先落 `packages/tasks/tests/fixtures/routing-golden/`（vitest 可跑）并同步登记 dsh-evals pack 适配——**该落位选择待开放问题 10 拍板后可迁移，不视为设计定稿**。
**依据条款**：28 §5 全节（方案/定制品/验收口径）；24a 拍板记录·C4（20 条起步+月度增补）；33 §1.3 G2-A9、§6 缺口 4。
**验收门禁**：【C】压缩前后各一次 `node tools/evals/bin/dsh-evals.mjs run --pack packs/<行业> --adapter replay` ＋ `node scripts/diff-pass-rate.mjs <run1> <run2>`【待建，落地前按 G2-A9：两份 report.md 归档 + 差值一行记入里程碑评审登记】；验收口径 = 通过率差 ≤2 个百分点（28 §5）。

#### 交互细节对照表⑦：路由金集判例形态（消费方 = 评测监控视图 / dsh-evals）
| # | 已拍板交互细节 | 出处 | 实现位置 |
|---|---|---|---|
| 1 | 判例四类：明确 accept / 应 attach / 应 ignore 的 bot 消息 / 应 stop | 28 §5 | 金集条目 `expected` 字段四值域；`packages/tasks/tests/fixtures/routing-golden/` |
| 2 | 规模：人工 20 条起步（拍板），目标 30–50 条（设计）——两处非冲突 | 24a 拍板记录·C4；28 §5；33 §2.2（数字溯源注） | 金集条目计数；v0 = 20 |
| 3 | 在**压缩后的会话状态**上跑（度量衰减，不是干净态） | 28 §5 | replay 跑法（`--adapter replay` 压缩前后各一遍）；驱动脚本随 G2-A9 |
| 4 | 验收口径：差 ≤2 个百分点视为无衰减 | 28 §5；33 G2-A9 | `scripts/diff-pass-rate.mjs`【待建】阈值 |
| 5 | 超标处置：调摘要模型档位或保留策略，**不允许靠改 prompt 纪律硬扛** | 28 §5（25 号教训引注） | 流程约束（评审登记），非代码 |
| 6 | 「触发原文」= 压缩强制保留项（用户指令逐字保留 D3 × Mandate） | 28 §5 定制品行 | 金集条目结构含触发原文字段；保留策略归 compaction |
| 7 | 复用 dsh-evals replay 适配器与 evals-golden 基建 | 28 §5 | 适配器对接点 `src/executor/gates.ts`（replay 触发同源） |
| 8 | 试点期月度从真实 Decision 增补 | 24a 拍板记录·C4 | 增补流程（人工），条目来源审计 trace |
| 9 | 金集通过率趋势与衰减曲线展示 | 30 §2 视图 4（评测监控） | 数据面：dsh-evals report；**视图归 WS-D workbench**，本包不实现 |

### A27 59 spec 承接收口与 M1 对齐
**交付**：按 34 §4 承接表收口全部测试：整承接重写 24 + 合并承接 8 + 机制并入 7 + 明确不承接 20（不承接项去向：30 号 workbench / channels / 31 号 CI）——**承接统计之外另做逐文件归属对账**：34 §4 全部目标测试文件（含通配门禁覆盖的每一件）在本文各任务「验收门禁」列有名有姓（timeline.spec.ts→A11、settings.spec.ts→A10、pass.spec.ts/health.spec.ts→A16、role-models.spec.ts→A25，余者见各任务门禁），收口时以 34 §4 目标列逐文件 grep 本文核对、零悬空方可判「按 34 §4 落任务」成立；`tests/class-docs.spec.ts`（每个类有 JSDoc 纪律，24 §8.1-6 采纳为工程纪律）；`tests/model-surface.spec.ts`（工具清单、prompt 版本、活跃工单清单体积预算快照）；M1 收口前对照 33 号 G3-M1 四项判据自查（含 base 基线 diff 为空）。
**依据条款**：34 §4 全节（A–H 组与承接统计行）；24 §2.5（59 spec 当验收清单）、§7.6；33 §1.4 G3-M1、§1.3 G2-A2。
**验收门禁**：【T】`packages/tasks/tests/**/*.spec.ts` 全绿（=G2-A2）；【C】`pnpm --filter @eterna/tasks run verify`；G3-M1 ③ base 基线：`node scripts/verify-eterna-web.mjs` 输出 diff `docs/baselines/verify-eterna-web-m0.txt` 为空（33 G3-M1 ③ 原判据）。

---

## 9. 配置面（新增键与 preset，键名即最终形态）

| 键/文件 | 内容 | 依据 |
|---|---|---|
| `cordis.patch.yml`（orchestrator 组） | preset + 压缩组四件套（行序 stale→basic→command→pruner）＋ summarize 分档键 | 28 §3/§4-4；24a C5 |
| `cordis.patch.yml`（worker 组） | 同上压缩组；`bash-sandbox.timeoutMs`（SA 5s 与本仓 standard 60s 不一致，**未拍板**，见 §12 开放问题 12） | 24 §2.4（SA 值）；27 §2.2（本仓约定 60s） |
| `SettingsSchema`（settings.ts） | 准入矩阵（realm 内名单）、策略规则表（默认空表）、分块保存/暂停切换、effort 档位、预算双轨单位与换算配置 | 34 §2.2；24a C2；26 §4.1 |
| `prompts/VERSIONS.md` | prompt 版本清单（版本绑定每次请求） | 34 §1；24 §8.1-4 |

---

## 10. 风险与回退

| 风险 | 对策 | 依据 |
|---|---|---|
| SA「研究代码、含 bug、风格不一致」→ 移植视为重写级校对 | 59 spec 逐条承接为验收清单（A27），SA 行号引用经 A0-2 复核 | 24 §2.5/§7.6；34 §0 |
| DSH 0.2.1→0.2.2-rc.1 契约差破坏 executor | 四类事件与 sessions 面 seam 钉住 `tests/types.seam-pin.ts`；升版走 upgrade-gate SOP | 34 §6-8；28 §4-1；33 G4-5 |
| base 形态被 Tier2 扰动 | Tier 规则 + G0-6 form-check + G1-1/G1-2 双门禁 + M1 基线 diff | 33 §1.1/§1.2/§1.4；31 号 |
| Effects 重复造 mini-Temporal | A0 R6 评估先行，宿主能承接的 kind 不自建；Temporal 失败模式清单当 checklist | 24 §5.5-R6；34 §6-1 |
| prompt 中文化引起体积/行为漂移 | model-surface 预算重标定 + 路由金集压缩前后回归（A23/A26） | 34 §6-9；28 §5 |
| 回退 | 包可配逆（plugin 装配关停配逆，A16）；super 形态停挂 tasks 后 base 门禁复绿（G2-B9 同款可缺席验证纪律） | 26 §2.1；33 §1.3 G2-B9（同款纪律） |

---

## 11. 验收总表（本包门禁 → 33 号体系映射）

| 里程碑 | 本文档任务 | 33 号门禁 |
|---|---|---|
| M1 | A1–A18、A27 | G2-A1…A8、A11…A16、G2-A2；G3-M1 四项判据 |
| M4 前窗 | A19–A26（依赖 WS-E/WS-D 合拢的端到端在 M4） | G2-A9（A26）、G2-A17（A25）；G3-M4 ⑤ |
| 持续 | 每条任务的【C】命令均属 G0/G1 已有链 | G0-1/4/5、G1-1/G1-2 |

---

## 12. 开放问题（发现即登记，不自行补设计）

1. **R6 宿主能力评估的前置性**（34 §6-1）：`tool-jobs`/`schedule`/session persistence 能否承接 `launch/delivery/relay` 决定 A12 裁剪幅度——A0 交付结论前按「Effects 全量照搬」保守设计。
2. **realm 键形态**（34 §6-2）：24a A1 拍板「realm 进内核模型 + 一租户一 SQLite」，本文按 34 §2.3/§5-access 基线实现为 access principal 经 `accountOf()` 解析的账号粒度；但「一账号多 workspace 时工单归属谁」子问未决。**另**：本任务书传达中出现过「24a 拍板 realm=账号id」表述，24a 原文无此字样——若「realm=账号 id」为拍板，需回填 24a 拍板记录后本文 §5/A11 措辞随之固化。
3. **policyVersion 联合 hash 的计算归属**（34 §6-3）：governance 侧算还是 glue 层算；rules.yaml 热改监听方式（fs watch vs 保存时）——A10 暂按 glue 层方案实现，待与 governance 规则版本化专项合流。
4. **worker 沙箱边界**（34 §6-4；24a A4）：「worker 以操作者 OS 用户身份跑命令」的残余面何时列商用前安全评审、判据是什么——A4 v1 用现有旋钮，评审报告归 G3-M5 ⑦。
5. **R2 结构校验的 deliverable schema 归属**（34 §6-5）：`.ticket/<id>/` 必备产物的文件名与格式由领域包（26 号声明段）定还是 tasks 内置默认 + 包覆盖——依赖 26 §7-1 五段 schema 拍板（33 §6-14；G2-A18 占位）。
6. **orchestrator 主会话宿主形态**（34 §6-6）：独立常驻 DSH session（SA `masterId` 模式）还是 pass 驱动无头循环；B3 拍板「embed 档启用任务层（API 面，无 UI）」暗示需无头形态，两形态是否共用同一 assessor——影响 A19/A22 实现形态。
7. **Outbox 回执归属**（34 §6-7）：receipts 留 tasks 租户库（A13 现方案）还是 channels 统一回执面；若 channels 已有投递状态存储需避免双账。
8. **DSH 契约版本差**（34 §6-8）：四类事件名与 sessions 面签名 seam 钉住并纳入 upgrade-gate（A0/A14 承接，风险敞口随 DSH rc 演进）。
9. **prompt 中文体积预算与 C5 档名**（34 §6-9）：中文化后 model-surface 预算数字重标定（A23）；C5「主 Session 用 22a 最优档」的具体档名与成本进 R1 预算的计量口径（A25 分档键暂留占位）。
10. **路由金集的存放与触发**（34 §6-10；33 §6-4）：`packages/tasks/tests/` 还是 dsh-evals pack；「压缩前后各跑一遍」挂 CI 还是发布门禁；`scripts/diff-pass-rate.mjs` 待建——A26 的 fixtures 落位为暂定，可迁移。
11. **`.ticket/` 与 `.tickets/` 目录名不一致**：24 §5.5-R4、34 §1、34 §4-D 用 `.ticket/<id>/`，34 §2.4 workspace 行用 `.tickets/<ticketId>/`——同一设计文档内部笔误，本文统一按 24 号 R4 原文 `.ticket/<id>/` 实现（A15），需在 34 号定稿时勘误统一。
12. **worker 前台命令转后台时限**：SA worker preset 为 `bash-sandbox.timeoutMs: 5000`（24 §2.4），本仓 DSH 约定 standard preset 前台命令 60 秒转后台（27 §2.2）——tasks worker preset 取 5s 还是 60s 未见拍板，A25 的该键值待裁决。
13. **Outbox 回执文案语言**：prompt 中文化拍板（34 §6-9）未显式覆盖渠道回执文本（ack/answer/result 渠道卡文案中文与否）——A13 不定文案语言，仅保结构。
14. **SA 副本路径**：本仓内未定位到 `dsh-superagent-prototype`（§0-B8 实测）——A0-2 钉路径后方可逐行复核 34 号全部 SA 行号引用。
15. **form-check / verify-eterna-super 待建**（33 §6-1）：A2 交付前，Tier 与 super boot 门禁以 G1-1 + PR 评审项代替。
16. **ai-evo 任务层门禁待建**（33 §6-7）：M5 项，非本包阻塞。
17. **计量双轨换算口径**（24a C2 拍板双轨；26 §7-3 单位统一问题未被拍板覆盖）：token ↔ 工单积分换算率为部署配置，默认值未定——A17 的换算配置默认值待试点定。
18. **SA prompts/ 未入清单资产的处置**：SA `prompts/` 实测另有 `cli.md` 与 `team/` 子目录（communication/delivery/scope 3 件），34 §1 prompts/ 树未列、34 §4 承接表亦无对应 spec——承接与否未拍板；A23 按 34 §1 清单交付 12 件（具名 8 ＋ handoff-* 实测 3 ＋ VERSIONS.md），本项待 34 号定稿裁决。

---

## 13. 与既有文档的关系

```
34（tasks 包详细设计）──本文是其任务级实施分解（逐行承接 §1–§5）
24（§5 架构/不变量 · §5.5 R1–R6 · §8.3 纪律）──每条任务的契约依据
24a（拍板记录四轮）──A1/A2/A4/A5/A6/B1/C2/C3/C4/C5/C6/D1/D2 逐条落位
27（冲突五机制/三层权力）──A5–A9、A14、表①②③
28（§1.1 窗口/§3 压缩组/§5 金集/§6 清单）──A19、A24–A26、表⑥⑦
26（§4.1 声明段/§4.3 配方）──A17、A18、A20、表⑤
29（§6 与 tasks 关系）──表⑤-8（worker 能力面，WS-B 并行不阻塞）
30（§2/§7 事件面消费方）──表①②③⑥的不实现项去向（WS-D）
33（G0–G4 门禁体系）──全部验收门禁的唯一事实源（§11 映射）
32（§2 WS-A/§4 M1）──阶段与里程碑归着
```

本文不改变 24a 拍板与 33 号门禁；§12 十八项开放问题确认后随 34 号定稿一并升级。
