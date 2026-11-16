# 19 - 记忆系统开发进度记录(M-M1 → M-M3)

> 状态:进度快照(2026-11-14 建档;**2026-11-16 增量:0.1.1 已合并上线**,见文末部署节)
> 上游:[[19-记忆系统开发文档-M-M1至M-M3]](任务总览见其 §2)、[[19a-spike-conclusions]](Spike 结论)、[[18-记忆机制定制设计-两层记忆与RSI上升]]
> 读法:§1 Git 快照;§2 Spike 指引;§3–§5 按 M-M1/M-M2/M-M3 三节逐任务一句话完成情况(每句附 `文件:行号` 或实测出处);§6 本次实测的测试状态;§7 遗留事项(如实,标注「指定」为既定事项、「核验发现」为本次记录时新查证)。

---

## 1. Git 快照(2026-11-14)

`git diff --cached --stat`(暂存区):**137 个文件,+26,266 / −310 行**。范围覆盖 packages/memory(数据层迁移/整固/Dream/客户端半边)、packages/glue(memory-plugin 挂载与配置面)、packages/panel(画像卡/审批队列)、packages/prompt-studio(提示词登记)、tools/packctl(tenant-scan 规则);暂存区同时含 22 号压缩系统(M-C)与 compaction evals 改动——属另一工作流,不在本文记录范围。

`git log --oneline -3`(最近提交,均为 prompt-studio 既有流,19 号实现尚无对应提交):

```
08affdd Merge pull request #77 from mahingbun-dev/feat/prompt-studio-lint-fix
e8cc521 fix(prompt-studio): 空响应诊断 output_tokens 收窄 number 再插值——CI lint 红修复
14651a4 Merge pull request #76 from mahingbun-dev/feat/prompt-studio-ai-hardening
```

---

## 2. Spike 结论指引

S-1~S-5 五项勘察已全部 resolved(结论/证据路径/退路三段式),见 **[19a-spike-conclusions.md](./19a-spike-conclusions.md)**。对实现影响最大的两条:S-4 判定 schedule seam **不可用**,重量 Dream 采用「会话尾触发 + 时间阈值合并」退路(`dream.cron` 键降级解释为间隔小时数,`packages/glue/src/plugins/memory-plugin.ts:38`);S-1 定稿 `turn/end`(reason.kind==='completed')为会话尾整固主触发。凡 19 号正文与 Spike 冲突处,以 19a 为准。

---

## 3. M-M1(数据层 / 工具层 / 读取层 / 画像 / 合规件)

| 任务 | 完成情况(一句话) |
|---|---|
| T1 数据层迁移 + domain_registry | 完成:`entity-store.ts:201-209` 九列幂等 ALTER 迁移 + `domain_registry` 表与存量前缀迁移(`legacy-org` 只留档不检索),新 `domain.ts` 导出 DomainRegistryStore(`ensureWorkspaceDomain`:118、`recordHit`:144 等);entity-store.spec 28 例、domain.spec 33 例绿。 |
| T2 工具层 | 完成:`tools.ts:289-297` `kind` 必填 + `explicit` 参数与判定口径,provenance(`origin_session_id/origin_turn_ref`)运行时盖章忽略模型传参,四操作 `decision`(add/update/noop,:317-341)与 review_state 写入口统一判定齐备;tools.spec 58 例绿。 |
| T3 读取层 | 完成:`index-builder.ts:98-113` 检索分公式(confidence×2^(−ageDays/halfLifeDays),halfLifeDays 默认 90)、:34-37 画像/域分预算参数、:68 时效尾标「(N 天未验证)」(>14 天);无域上下文逐字节回归锚点由 index-builder.spec.ts:145-173 钉住并过。 |
| T4 画像 v0 | 完成:`portrait.ts:72` `buildPortrait` 纯函数(frontmatter 含 source_memory_ids)+ `scripts/gen-portrait.mjs` node 直跑形态(无 UI 无定时,符合 M-M1 交付形态);portrait.spec 9 例绿。 |
| T5 tenant-scan + 提示词登记 | 基本完成:`tools/packctl/src/tenant.ts:37-38` memory 路径派生规则 + :118-120 fail-closed 锚(dbPath 锚 cwd/.eterna、portrait 与库同目录),packctl 85 例绿;`packages/prompt-studio/src/registry.ts:394` index-section 更新、:415 新增 `runtime.memory.search-prefix`——但 `runtime.glue.memory-plugin` 锚点行号漂移致 registry.test.ts 2 例红(见 §7-4)。 |

---

## 4. M-M2(写入管线)

| 任务 | 完成情况(一句话) |
|---|---|
| T6 整固 job 骨架 | 完成:`consolidation.ts:62` `consolidation_cursor` 游标表、:108-109 三门控(direct-write → no-user-prose → credential-redline,任一 skip 推进游标)、单 running + latest-pending 覆盖合并调度;glue 侧 `memory-plugin.ts` 挂 session/event 流(其 :6 注释即 T6 挂载说明),glue memory-consolidation.spec 13 例绿。 |
| T7 提取执行 | 完成:`extraction.ts:18` 冻结提示词与 `tests/fixtures/extraction-prompt.md` 逐字一致(「Nothing to save」契约见 fixture :16),curator 直调 ctx.llm(S-4 结论形态),会话快照冻结不重查。 |
| T8 Gm0/Gm1 | 完成:Gm0 写入口(单条 ≤2000 字/单域 live 上限/查重强制 UPDATE/NOOP,entity-store 侧),Gm1 `extraction.ts:51` 同 scope+kind 重叠 30–90% 触发 LLM 矛盾判定(冻结 fixture contradiction-judge-prompt.md),矛盾 → supersede 旧行;consolidation.spec 146 例(内含 Dream 断言)全绿。 |
| T9 审批闭环 | 完成:`approval.ts:107-112` buildMemoryApprovalCard 复用 interact ApprovalCardInput 并 fail-closed 校验,`audit.ts:29` JSONL 账本 `.eterna/memory-audit.jsonl`,panel `snapshot.ts:183-191` pendingCount + 审批列表与 eternaPanel/review 裁决(Memory.review 软失效语义);approval.spec 11 例、panel 42 例绿。 |

---

## 5. M-M3(域整固 / 画像自动化 / 前端 / 指标)

| 任务 | 完成情况(一句话) |
|---|---|
| T10 域检测与注册 | 完成:`domain.ts:353-357` resolveDomain 编排(先从已注册域归并 → workspace 显式域直接注册 → 候选 kebab 键 recordHit,≥3 独立会话转正,每会话至多计一次),glue 侧 domainOf 穿线进 attachMemory 盖 episodic 域归属;domain.spec 33 例、glue memory-domain.spec 11 例绿。 |
| T11 双频次整固 | 完成:轻量会话尾扩为域打标 + episodic 落域(confidence 0.5/source=consolidation,`memory-plugin.ts:35`),重量 Dream 四阶段 Orient/Gather(窄读)/Consolidate(晋升+稳定偏好+CONFLICT-FLAG+相对日期转绝对+证伪删除)/Prune(TTL 30 天挤出+画像再生成)在 `dream.ts:13-34`,周报落 audit dream 行(:34);用例含于 consolidation.spec.ts(121 处 Dream 断言),全绿。 |
| T12 前端四件 | 完成:①设置分区「记忆」(`client/settings.tsx`,开关/写入策略档位/蒸馏占位禁用态 :286,经 `client/index.tsx:114` inject settings.section);②面板画像卡+域浏览+审批队列(`PanelPage.tsx:221-251` 画像卡逐节「纠正此项」落显式通道,snapshot 增 portrait/domains/pending);③域 chip(`domain-chip.tsx:56`,conversation.input.right);④Sources 行(`sources.tsx:179` conversation.chat.turnTail + 会话事件累计);client-settings/client-sources/client-bundle/panel 测试全绿。 |
| T13 验收指标采集 | 部分完成:基础统计面已落(`admin-plugin.ts:126` memoryStatsOf 三数、audit JSONL 各类事件行、domain_registry 计数列),但 19 §5-T13 列名五项(打标准确率/晋升采纳率/审批响应时长/画像纠正率/索引预算占用分布)未见专项采集面,且 T10 的「人工标注 30 会话样本 ≥80%」验收未见执行记录(详见 §7-5)。 |

---

## 6. 测试状态(本次实际执行)

以下均为本次记录时在仓库内实跑的命令与输出(各包目录内执行 `./node_modules/.bin/vitest run`;首次尝试 `npx vitest run` 因 npx 解析挂起被终止,改用本地二进制后正常):

| 包 | 结果 |
|---|---|
| packages/memory | 17 个测试文件 / **424 用例全绿**(1.3s;Dream 用例含于 consolidation.spec.ts) |
| packages/glue | 8 个测试文件 / **77 用例全绿** |
| packages/panel | 6 个测试文件 / **42 用例全绿** |
| tools/packctl | 9 个测试文件 / **85 用例全绿** |
| packages/prompt-studio | 14 个测试文件 / **2 用例红、336 绿**(红因见 §7-4) |

未跑:`packctl tenant-scan` / `prompt-scan` 门禁命令本体(本次未执行,§3/§4 引用的规则面以源码与单测为证)、隔离 profile E2E(见 §7-1)。

---

## 7. 遗留事项(如实)

1. **隔离 profile 全链路 E2E 未自动执行**(指定):19 §4-M-M2 与 §9-3 要求的隔离 profile E2E(会话 A 学偏好 → 会话尾整固 → pending 审批 → 会话 B 索引命中;双账号互不可见)未建自动脚本——`scripts/` 仅 `t7-e2e.mjs`、`verify-governance-e2e.mjs` 两个既有其他流脚本,无 memory 专项 E2E;隔离语义目前仅由 packctl tenant-scan 规则 + 单测面覆盖。
2. **UI 深浅主题截图待人工补 PR**(指定;**2026-11-15 已用 ego lite 完成验收截图**):AGENTS.md 前端铁律与 19 §5-T12 要求新增 UI 的 PR 附深浅两主题截图并按 frontend-style §4 清单自查。
   - **2026-11-15 增量**:隔离容器(独立卷 3108→改 3110,挂载 memory/panel/glue 三包+模板+宽松 peer glue 副本)+ ego lite 完成深浅两主题共 12 张截图,落 `gui-test-screenshots/memory-t13-1115/`(设置记忆分区/会话域 chip/基座面板画像卡+审批+功能域+记忆指标,深浅各半);视觉验收(图像模型逐张)通过:指标数值与种子数据一致、四分节画像+逐节「纠正此项」、审批队列记住/跳过、域浏览 2 域均正确渲染。
   - 验收顺带**实跑发现的缺口与修复**:① entrypoint §3 symlink 清单缺 `memory`(行被静默 disable)——已补并 staged;② docker 模板缺 `eterna-panel` Host 行(基座面板浏览器半边从未进花名册,**历史缺口**)——已补并 staged;③ **T12-④ Sources 行未渲染**(实测会话中 memory_search 已执行、回复含检索结果,但 `sources-row` 节点不出现)——疑似 turnTail 事件累计口径与 dsh 运行时事件形状不符(S3 当时以既有证据置信、未实跑抓包),**待修**;④ 面板域浏览「记忆 N 条」恒 0(memory_count 无维护者,M-M1 评审发现的回归);⑤ 轻微 UI:指标行右端贴边截断、小号浅灰标签对比度偏低(frontend-style §4 可访问性边缘项)。
   - 容器内另见:web 多用户下面板/记忆库路径跟随**宿主进程 cwd**(单容器单租户形态 = /data/.eterna 全局库)——多租户 web 部署的记忆分库归属需专项确认(tenant-scan 规则已覆盖 dbPath 派生面,运行时 cwd 语义待核)。
3. **M-M4 全局蒸馏未启动(范围外)**(指定):19 §9 明示 M-M4 依赖 ai-evo 连通、不在本文档范围;§6 的 `distill?: { enabled: false }` 配置键未落(全仓 grep 仅 `client/settings.tsx:286` 占位禁用态复选框,文案按 Q4 默认关处理),M-M4 启动时需补配置键。
4. **prompt-studio registry.test.ts 2 例红**(核验发现):`runtime.glue.memory-plugin` 条目锚点行号漂移——`packages/prompt-studio/src/registry.ts:441` 钉 `packages/glue/src/plugins/memory-plugin.ts:171` 须含片段 `attachMemory(dshHost(ctx)`,M-M2 挂载面扩写后该片段实际移至 :173(:171 现为 domainOf 相关行);属 M-M2 改动未同步 T5 锚点的回归债,修复 = 锚点行号 171→173 一行对齐后复跑(本记录仅如实登记,不改代码)。
5. **T13 五项验收指标专项采集面未落地**(核验发现;**2026-11-15 已起步落地**):域打标准确率/晋升提案采纳率/审批卡片响应时长/画像纠正率/索引预算占用分布均无专项采集(全仓 grep 无命中);此为 18 §13 的 Q3 抽样降档与 Q2 归并质量前置证据,首月数据落 panel 的 §9-6 验收项未就位。
   - **2026-11-15 增量**:审计账本新增 `domain-resolve`(域解析定格,glue 域接线埋点)与 `correction`(画像纠正动作,panel 经 `eternaPanel/trackCorrection` 转发)两类事件;新 `src/metrics.ts`(buildMemoryMetrics 四项在线指标纯聚合 + computeIndexZoneTokens 只读现算第五项——曾修一个联动缺陷:经 EntityMemoryStore 打开会触发迁移写,现改 DatabaseSync readOnly,且 classifyLegacySubject 补新编码防改写);索引结果增 `zoneTokens` 分区统计;facade 增 `metrics()`;panel 快照增 `memory.metrics` 与「记忆指标」区块;离线脚本 `scripts/memory-domain-accuracy.mjs`(人工标注 × 账本比对,样本待标注 ≥30 会话)。实测:memory 439 / glue 78 / panel 47 用例全绿,三包 oxlint+tsc 绿,tenant-scan 0,lint-ui-tokens 过(prompt-scan 时点 1 finding 属并行会话未完成 @basis/agent-loop 包,非本面)。
6. **M-M1 个别验收项未复跑**(核验发现):「隔离 profile 手动 gen-portrait 产出画像文件」本次未执行(函数与脚本在位、portrait.spec 9 例绿);「无域上下文逐字节一致」回归锚点已由 index-builder.spec.ts:145-173 钉住并通过。

---

## 8. 部署记录(2026-11-16,0.1.1 上线)

**PR #79 合并进 main(012ad49)→ worktree 构建镜像 `eterna-agent:0.1.1`(sha 比对一致)→ compose 切版(a178e58)→ `docker compose up -d`。**

- 部署期新增修复(均在镜像内):entrypoint symlink 补 memory(d33232a)、模板补 eterna-panel 行、构建期 peer 对齐(73118a7)/auto-install-peers 关(ab375c7)/verifyDepsBeforeRun 权威位关(3e9ba99,压缩线同题)/逐包 node 直跑(b1c9bb1)——五道部署坑全部由首次镜像重建暴露并闭环;
- memory_count 投影现算修复(5c70d97)随镜像上线;
- **上线验证(生产域名 GUI 实测)**:0 禁用/failed;设置分区「记忆」在场(写入策略/用户画像/域识别/蒸馏占位/成本提示全渲染);域 chip 在场;基座面板入口在场,画像卡/审批队列/功能域/记忆指标四区块渲染;显式写入「请记住:…」→「已记住」走通。
- **带病项(如实)**:Sources 行(turnTail 条目)宿主 rc.1 会话作用域 slot 合并不生效——取证结论与双挂载兼容见提交 5c70d97 与 index.tsx 注释;Definition 数据面已实测可用,宿主升版后零改动生效。CI 的 tools/evals+compaction 两红属压缩线(PR #79 留言归属)。
- **多租户分库专项**:[[23-记忆多租户分库设计]] 已提交待评审(方案 C per-account store 池;四个开放问题待拍板)。

---

## 9. 部署记录二:0.1.2 → 0.1.3(2026-11-16,多租户分库 + S-6 修复)

**0.1.2(多租户分库 M-T1~T3)**:MemoryAccountRouter 路由面/整固 Dream 账号路由/双账号隔离集成测/迁移脚本/tenant-scan 锚(2722e24+92ed7a8)。部署后生产取证发现 **S-6**:panel unary 通道 principal 是 owner peer(无 userId,mux.ts 头注明示)→ 面板账号路由解析恒失败回落全局(已归档改名→面板记忆区空)。**根因归属:宿主 unary principal 形态,非记忆包**;修复=panel 记忆端点迁入 access 守卫面(42288a9):access registerTenantGuards 增 /api/eternaMemory/{accountSnapshot,review,trackCorrection}(cookie→userId/account→glue provide 的 eterna-memory-accounts face),memory 新导出 buildMemoryAccountView(账号区只读组装,与 panel readMemory 同源),glue face 增 viewForAccount/reviewForAccount/recordCorrectionFor。**0.1.3 上线后生产实测:面板 memory 区=Mr.Ma 账号库内容(迁移行可见),全链路通**。

**数据事件(如实,零静默)**:0.1.2 验证期 agent 写入的 3 条探针记忆(multi-tenant-sharding-live/mt-go-live-2026-11-16/probe-final-1116)因迁移脚本首版 rename 只动主文件、WAL 被误删而**丢失**(WAL bug 已修:9ed95d8 三件齐 rename;丢失行均为验证探针,内容已在会话日志留档)。当前 Mr.Ma 账号库 2 行健康(迁移行+直写探针)。

**验证矩阵(0.1.3)**:0 禁用/失败;面板 memory 区=登录账号库(迁移行可见);显式写入链路通;memory 449/glue 81(双账号隔离 3 例)/panel 47/access 199/packctl 85 全绿;tenant-scan 0;lint-ui-tokens 过。

**待办**:双生产账号人工验证(待第二账号);CI tools/evals+compaction 两红属压缩线。

---

## 10. 遗留项全景治理表(2026-11-16,开发计划)

| # | 遗留项 | 处置 | 状态 |
|---|---|---|---|
| 1 | Sources 行未渲染(0.1.2 判"宿主版本阻塞") | **重新取证推翻旧结论**:selectMemorySources 双重解引用(TurnLocation 误再解 .turn)——我方 bug 非宿主 | **已修**(f5e819c),0.1.4 上线验证 |
| 2 | CI 两红(tools/evals+compaction admin-stats) | 当前 main 本地复跑均已绿(97/14),压缩线已自修 | **已消失** |
| 3 | prompt-scan agent-loop 未登记 section | 属并行会话活跃工作面,不越界代修 | 待该线自行登记 |
| 4 | 双生产账号人工验证 | 依赖第二账号创建 | 待人工 |
| 5 | M-M4 全局蒸馏 | 依赖 ai-evo(容器已删+baseUrl 未定) | 依赖就绪后启动 |
| 6 | 隔离 profile 全链路 E2E 自动脚本 | 已有库级/集成层双账号隔离测(glue routing spec 3 例);全链路脚本列 0.1.5 | 计划内 |
| 7 | 键解耦(consolidation.enabled 连带关 Dream,low#18) | **已修**(f5e819c):consolidation 只管轻量链,Dream 独立 | 已上线 0.1.4 |
| 8 | 配置键补全(halfLifeDays/perDomainLimit/portrait/domain.indexTokens 部署侧) | 0.1.2 已大半补齐(routing/episodic/halfLifeDays 键);余 portrait.maxTokens 等 | 0.1.5 打磨 |
| 9 | Dream 淘汰条目级留痕(low#17) | DreamAuditEntry 扩被淘汰明细 | 0.1.5 |
| 10 | turn/end 每回合触发提取成本(low#12) | 时间阈值合并(复用 S4-B Dream 先例形态) | 0.1.5 |
| 11 | 轻量 episodic 摘要=确定性截断(T11 偏离①) | 升级 LLM 摘要需改冻结提示词契约面 | 0.1.5 |
| 12 | 画像关键词启发式归类(T4 偏离②) | 升级 LLM 归类 | 0.1.5 |
| 13 | UI 可访问性微调(指标行右端贴边/小号浅灰对比度) | frontend-style §4 | 0.1.5 |
| 14 | SRC 端点命名与规格偏差(low#20,功能等价) | 文档对账即可(实现形态更优:reviewForAccount 守卫面) | 关闭(以 19-progress 为准) |
| 15 | 迁移脚本 WAL 三件齐(low,首迁实测) | **已修**(9ed95d8) | 已上线 0.1.3 |
