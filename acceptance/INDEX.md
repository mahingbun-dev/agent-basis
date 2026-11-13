# 验收记录索引

> 依据 plans/2026-11-10-companion扩展开发计划与测试门禁.md §4 治理原则建立。
> 全部门禁通过与失败的工件按门禁 ID 存入 `artifacts/gates/<门禁ID>/`；失败记录永久保留。
> 实现者及其关联会话无判定权；执行者由用户本人书面指定（含用户本人亲自担任）。

| 门禁 ID | 阶段 | 执行人 | 执行日期 | 结论 | 工件 | 备注 |
|---|---|---|---|---|---|---|
| G-G0-01 | E0（决策门） | 用户本人 | 2026-11-10 | ✅ 通过（D9–D15 七项全部有明确结论） | [artifacts/gates/G-G0-01/decision.md](../artifacts/gates/G-G0-01/decision.md) | 用户会话回复「没问题」确认逐项推荐方案；本记录为后续全部门禁的前置输入 |
| E0-T3 红线清单签核 | E0 | 用户本人 | 2026-11-10 | ✅ 签核（用户会话确认「继续执行」） | docs/design/companion-security-redlines.md | 十条红线作为后续协作与安全门禁组（G-UX-10/11/12/13）及总验收的判定基准 |
| E0-T2 / E1-T1 / E1-T2 / E1-T5 | E0+E1 实现 | 实现者（本会话） | 2026-11-10 | ✅ 实现完成 + 自测证据（**非门禁判定**） | packages/extension-companion、packages/browser-relay、`pnpm -w run verify` 退出码 0（125 测试全过）、packctl tenant-scan 0 findings | 见下「实现者自测证据」 |
| T7 存量补登（T7.5 集成验收等） | T7（ps-v2 前史） | T7.5 集成验收官（动态 workflow subagent） | 2026-11-07 | ✅ 实测通过（72 项断言全 PASS / 0 FAIL，exit 0，连续三次；**补录性质**） | [docs/dev/t7-acceptance.md](../docs/dev/t7-acceptance.md)、[docs/dev/t7-prompt-studio.md](../docs/dev/t7-prompt-studio.md) | 计划书 §8 现状缺口（T7 无 INDEX 条目）按 ps-v2 测试计划 §1「INDEX 台账」行于 G-PS-01 一并补登；数字出处 t7-acceptance.md 逐断言台账（当时插件名尚为 @basis/prompt-studio，改名前史） |
| G-PS-01 | P1（ps-v2：挂载+全景+写链路） | 独立验收代理（验收-G-PS-01，用户经工作流书面指定） | 2026-11-11 | ✅ 通过（§7.1 强断言 1–7 全过，第一手实测；真模型链 t7-e2e 72/72 已跑） | [artifacts/gates/G-PS-01/EVIDENCE.md](../artifacts/gates/G-PS-01/EVIDENCE.md) | 见下「G-PS-01 验收记录」；人工条款缺口（键盘全量走查、admin 停用裁剪[可缺席]）已如实标注未执行/部分执行 |
| T2.5 CI 接入（prompt-scan + verify job lint 循环化） | P2 实现（ps-v2） | 实现者（本会话，非门禁判定） | 2026-11-11 | 实现完成 + 本地自测（worktree 内）：`packctl prompt-scan` 全仓 0 findings、tenant-scan 0 findings 不回归、`@eterna/packctl` verify 78/78；`git grep -n "prompt-scan" -- .github/workflows/ci.yml` 命中、`git grep -c "for d in packs" -- .github/workflows/ci.yml` = 2 | .github/workflows/ci.yml、tools/packctl/ | 线上 CI 只能合并后验证——**待合并后首跑确认**（测试计划 §4 T2.5(b)4③，不得提前写「CI 绿」）；G-PS-02 gate 时按 §7.2 复核 |
| G-PS-02 | P2（ps-v2：热生效+快照+门禁） | 独立验收代理（验收-G-PS-02，用户经工作流书面指定） | 2026-11-11 | ⛔ **暂不通过（阻断 1 项）**：§7.2 强断言 1/2/3/4/6 共 5 条第一手实测全过（t7-e2e 热生效主链 140/140 exit 0 含 pid 不变/旧会话旧文；快照三型分语义+不可变 smoke 82/82+单测 17/17；矩阵 14 格断言编号对账 15.40；memory 90/90+glue 35/35；prompt-scan/tenant-scan 0 findings；CI 机械可查双命中）；**强断言 5 判据命令 `pnpm --filter @eterna/packctl run verify` exit 2**——T2.2（df28013）给 `PromptRegistryEntry` 新增必填 `effect` 未同步 packctl 测试夹具（prompt.spec.ts:70-99 六处 TS2741），vitest 因 && 链未执行（诊断性单跑 78/78 过、prompt.spec 6/6，扫描行为无恙）。待补夹具字段复跑后终判 | [artifacts/gates/G-PS-02/EVIDENCE.md](../artifacts/gates/G-PS-02/EVIDENCE.md) | 见下「G-PS-02 验收记录」；全仓 `pnpm -w run verify` 由外层 harness 另行运行判定（本代理未跑；packctl 类型回归预期同样红）。**G-PS-03 侧对账**：该阻断的修复（5f568be）经 G-PS-03 代理诊断性复跑 `pnpm --filter @eterna/packctl run verify` exit 0（78/78）确认闭合；终判落账归 G-PS-02 原执行链 |
| G-PS-03 | P3（ps-v2：AI 润色与审核） | 独立验收代理（验收-G-PS-03，用户经工作流书面指定） | 2026-11-11 | ✅ 通过（§7.3 强断言 1–6 全部第一手实测通过；**真模型核心链 ps-v2-ai-smoke 已跑 6/6 exit 0**——缺凭据条款不触发，AI 产出永不直接生效在单测/隔离档运行时/真模型/UI 截图会话四面复核） | [artifacts/gates/G-PS-03/EVIDENCE.md](../artifacts/gates/G-PS-03/EVIDENCE.md) | 见下「G-PS-03 验收记录」；两项如实登记：① 非阻断客户端缺陷转实现者（AI 可用性胶囊运行态恒滞留「检测中」——StudioPage.tsx:888 以 `{input:{}}` 调无参端点 ai-status 被 descriptor 拒收，一行修复面，探针复现 backend 无恙）；② 全仓 `pnpm -w run verify` 由外层 harness 另行运行判定（本代理未跑，其结果为本 gate 最终落账前提——G-PS-01/02 同口径） |
| G-CORE-01 | E1（核心链路） | 独立验收代理（用户指定派发） | 2026-11-10～11 | 通过（第一至四轮均 4/4；**终判轮（2026-11-11，第五轮，环境中断恢复后重采）4/4——五轮结论稳定，终判：通过**） | [artifacts/gates/G-CORE-01/verdict.md](../artifacts/gates/G-CORE-01/verdict.md)（含第二/三/四轮及终判轮判定段）、smoke/gate-evidence/G-CORE-01/（终判轮批次）、artifacts/gates/G-CORE-01/round2-evidence.txt、round3-evidence.txt、round4-evidence.txt、final-evidence.txt | 用户书面指定派发代理执行验收（litellm mimo-v2.6-flash）；五轮独立复核标题均逐字符一致（三方指纹 14ch:7dd9587a）；判据 4 以会话导出+egress 审计日志双源核验（seq 18 isError=false，窗口内关键词检索 0 命中）。遗留（五轮未闭合，定性为证据留痕形态缺口，不阻断布尔结论）：地址栏截图、扩展设置页截图；relay/扩展侧日志未归档；UI 工具条目为空 |
| G-CORE-02 | E1（核心链路） | 独立验收代理（用户指定派发） | 2026-11-10～11 | 通过（第一至五轮均不通过——判据 1/3 缺口逐轮收窄至「click 成功 0 次」；**终判轮（2026-11-11，第六轮，环境中断恢复后重采）4/4 首次全部通过——终判：通过，阻断解除**） | [artifacts/gates/G-CORE-02/verdict.md](../artifacts/gates/G-CORE-02/verdict.md)（含第二/三/四/五轮及终判轮判定段）、smoke/gate-evidence/G-CORE-02/（终判轮批次）、artifacts/gates/G-CORE-02/round2-evidence.txt、round3-evidence.txt、round4-evidence.txt、final-evidence.txt、digest.json | 失败-修复-重跑链：① egress 白名单补 hn.algolia.com（第二轮修复）→ 判据 2 转通过；② stale-ref 误拒根治（第三轮）；③ 纪律第 7 条消除 URL 直拼参数、fill 首次成功（第四轮）；④ 三步调用序列达成但 click 遭合理 STALE_REF 拒（第五轮）；⑤ **终判轮闭合**：模型在 fill 自动提交致 ref 失效后先重新 snapshot 取新 ref（e811）再 click——**六轮首次成功的 click**（isError=false，同 tab 导航至 HN 讨论页），判据 1（三类各 ≥1 成功+顺序子序列）/判据 3（最后一次点击后的快照含条目链接文本）成立，判据 2 与 hn.algolia API 基准逐字符一致（标题指纹 43ch:a22118cf、链接 70ch:d6f3515c）、判据 4 通过；第五轮判据 3 口径分歧随 click 成功消解。**digest 整改闭合**：gate-digest.mjs 重写版（按话术匹配会话/callId 配对/结构化 isError）输出与会话导出独立复算一致，恢复证明力（digest-session-calls.json 不再产出）。遗留：地址栏截图形态缺口、relay/扩展侧日志归档、UI 工具条目为空（均不阻断） |
| G-CORE-03 | E1（核心链路） | 独立验收代理（用户指定派发） | 2026-11-10～11 | 不通过（第一轮：任务未执行、4 判据全部无法判定；第二轮：1/4 不通过、2/3 通过；第三轮：1/2/4 不通过、3 通过——content_filter 中断）；**终判轮（2026-11-11，第四轮，裁决①②生效+场景经用户澄清细化为科技门户 IT之家）4/4——终判：通过，阻断解除** | [artifacts/gates/G-CORE-03/verdict.md](../artifacts/gates/G-CORE-03/verdict.md)（含第二/三轮及终判轮判定段）、smoke/gate-evidence/G-CORE-03/（终判轮批次）、artifacts/gates/G-CORE-03/round2-evidence.txt、round3-evidence.txt、final-evidence.txt、digest.json、ruling.md | 失败-修复-重跑链：harness 时序/悬置（已修复）→ stale-ref 误拒（已根治）→ 点击导航语义 openedTabs 回执（裁决①落地：本轮 click 回执 openedTabs 上报详情页 tab、标题含点击前锚文本、同 tabId 快照与截图佐证，因果链坐实，判据 1 通过）；content_filter 不可抗力（裁决②换站机制落地：场景经用户澄清细化为科技门户 IT之家、话术消歧「点开快照中第一条新闻链接」——细化依据派发单记录，ruling.md 文本未含、出处如实登记，建议补录）→ 本轮回答完整产出、无内容过滤中断，判据 2/4 通过（正文首段 75 字符基准逐字符比对一致、指纹 75ch:18ff80a0 复核无误取；3 次工具调用全 isError=false、turn completed）；判据 3 通过（ref=e340 点击前快照在案）。纯 snapshot→click→snapshot 三步浏览器链路，web_fetch/URL 直导航兜底未再现。「第一条新闻链接」落点核验自洽（热搜横幅①②编号条目与广告横幅渲染佐证 agent 消歧；更严口径分歧如实登记）。遗留：地址栏截图形态缺口、relay/扩展侧日志归档、UI 工具条目为空（均不阻断） |

## 实现者自测证据（2026-11-10，E1 冒烟——非门禁判定）

- 环境：Chromium for Testing 159.0.8154.0（headless=new + --force-renderer-accessibility + --load-extension）+ relay 127.0.0.1:9310 + 扩展 0.1.0 开发者加载。
- 全链结果（smoke/e1-smoke-result.json，exit=0）：
  1. ✅ relay 启动（/extension /cdp /api/tools /fixture）
  2. ✅ 扩展 SW → wss 连接 relay（hello 握手 proto=1）
  3. ✅ browser_snapshot {url:fixture} → a11y 快照（heading/paragraph/textbox[ref=e10]/button「提交」[ref=e13]/link[ref=e16]）
  4. ✅ browser_fill（selector=#kw → value=playwright）
  5. ✅ browser_click（selector=#go → 导航至 /fixture/result?text=playwright）
  6. ✅ 动作后快照含预期内容（关键词：playwright）
  7. ✅ example.com 真实快照（R-02 场景，title=Example Domain）
- 工具协议要点：感知走 DOMSnapshot.captureSnapshot（browser-use 同款主通道；chrome.debugger 下 AX 域整树 ignored 不可控，已实测确认并绕开）；ref=e<backendNodeId> 文档内稳定；点击为 CDP Input 可信事件（DOM.resolveNode→callFunctionOn 取视口中心）。
- 单测：relay-core 10 项（握手/自动挂载/session 转发/detach 分类/生命周期/错误码）+ ax-snapshot 7 项（已由 DOMSnapshot 通道替代，保留作 AX 通道回归基础）。

## E1 挂载验证（实现者证据，2026-11-10）

- `scripts/verify-eterna-web.mjs`（真 boot + pluginInventory/list 断言）exit=0：
  200 host entries 全 settle、`mcp-browser` enabled+active、22 裁行全 inactive、124 保留行 enabled+active。
- MCP 协议级：官方 SDK 2.2.0 Client + StdioClientTransport 对 `dist/mcp.mjs` connect 220ms 成功、
  tools/list 返回三工具（实测根因：响应帧缺 `jsonrpc:'2.0'` 时 SDK zod 校验静默丢弃全部响应——
  根因与修复已注释在 mcp.ts）；era 探针 `server/discover` 按 -32022+supported 语义毫秒级回落 legacy。
- 工具面挂载完成 → G-CORE-01/02/03/05 的「eterna 会话」前置条件就绪（待模型 key + 独立验收代理）。

## G-CORE 门禁待执行清单（实现者无权判定，待独立验收代理）

| 门禁 | 阻塞前置 |
|---|---|
| G-CORE-01/02/03/05 | ① 浏览器工具挂进 eterna 会话工具面（MCP server 化或 DSH provider 化——实现者待办）；② 用户书面指定独立验收代理 |
| G-CORE-04（登录态只读） | 用户本人提供已登录站点环境 + 书面确认单 |

## G-PS-01 验收记录（ps-v2 P1，2026-11-11，独立验收代理实测）

- **判定文本**：`docs/dev/ps-v2-test-plan.md` §7.1 强断言 1–7；证据目录 `artifacts/gates/G-PS-01/`（逐任务断言映射 + 命令台账 + 截图 + §4 自查 + 全部原始输出誊录，含失败运行日志）。
- **无头命令实测**（均 exit 0）：verify-eterna-web 11/11（生产档 studio 行 enabled+active + 花名册 combo 含 client.js/factory 注册）；t7-smoke **68/68**；t7-ui-check **31/31**；t7-e2e **72/72**（真模型 A–G 链，凭据在位）；packctl tenant-scan 0 findings；packctl lint 逐包两条（event-planning / industrial-analysis）各 0/0；dsh-evals replay t14-replay 9 用例全过。机械计数：t7-e2e 72 / t7-smoke 68 / t7-ui-check 21+1 循环（基线 ≥72/≥38/≥17+循环，只增达标，誊录与 grep 一致）。
- **包级 verify 实测**：`@eterna/prompt-studio` 211/211（含 registry 24 / entry-patch 22 三形态专项 / host-plugin 44 per-entry 六项 / client-bundle 12 令牌）、`@eterna/access` 67/67（启停登记回归面）。全仓 `pnpm -w run verify` 由验收工作流外层 harness 另行运行判定，不入本代理证据。
- **截图**：深浅两主题 × 全景列表/条目编辑/版本 diff 三页 + 640px 断点 × 双主题共 8 张（playwright-core+系统 Chrome，脚本随证据目录可复现）；AI 视觉复核：浅色三层 14 条全景完整、深色主题正确无样式错乱。
- **人工条款如实标注**：键盘可达全量走查未执行（静态 focus-visible/断点规则在场已给替代证据）；admin 停用→重启裁剪未执行（计划书 T1.2 标注可缺席；机器层 id 三处交叉钉住 + access verify 已覆盖）。
- **环境发现（转实现者，非门禁阻断）**：① `scripts/t7-e2e.mjs` 冷自举 pnpm-workspace 模板缺 `@google/genai`/`protobufjs` allowBuilds 裁定（t7-smoke 已修，t7-e2e 未同步）——全新 profile 下 install 失败，本次验收以 scratch 侧手工补齐绕过（未改任务代码）；② 新 worktree 需先 `pnpm --filter @eterna/llm-openai run build`，否则 t7 宿主 eterna-llm 装载失败且 t7-e2e 四断言以远离根因形态变红（建议加 eterna-llm active 启动断言）；失败链 4 次运行日志完整保留于证据目录。

## G-PS-02 验收记录（ps-v2 P2，2026-11-11，独立验收代理实测）

- **判定文本**：`docs/dev/ps-v2-test-plan.md` §7.2 强断言 1–6；证据目录 `artifacts/gates/G-PS-02/`（逐任务断言映射 + 命令台账 + 截图 + DOM 机器核验 + 全部原始输出誊录，含失败命令完整日志）。
- **无头命令实测**（exit）：verify-prompt-studio **0**（288/288，新增 config-editor-write 20/session-snapshot 17/assembly-replay 33）、verify-packctl **⛔ 2**（tsc 六处 TS2741——见下阻断项；诊断性 vitest 单跑 78/78）、verify-memory **0**（90/90）、verify-glue **0**（35/35）、verify-eterna-web **0**（11/11 生产档 boot 洁净+studio 行 active+花名册）、t7-smoke **0**（82/82，T2.3 快照端点 20 条）、t7-ui-check **0**（42/42，快照视图六锚点+`data-ps-entry-effect`）、t7-e2e **0**（**140/140** 真模型：5.8-5.11 configEditor 通道热生效 pid 不变、8.1/14.2-14.12 严格回放旧会话旧文、15 链矩阵 52 条含 15.40 声明对账与 15.41 全程 pid=21243）、prompt-scan **0**（0 findings）、tenant-scan **0**（0 findings）、lint 两包各 **0**（0/0）、dsh-evals replay **0**（20 用例全过）。
- **机械计数**：t7-e2e 120 静态（≥72）/smoke 82（≥38）/ui-check 24+1 循环（≥17+1）；誊录台账 PASS 数与 grep 数一致（82/42/140=120+20 循环）。CI 机械可查：`git grep -n "prompt-scan" -- .github/workflows/ci.yml` 命中 :37-38；`git grep -c "for d in packs"` = 2。
- **截图**：快照查看视图深浅 ×2 + 条目「生效条件」卡深浅 ×2（playwright-core+系统 Chrome；G-PS-01 配方沿用）；DOM 机器核验 9/9（会话行卡 12 张/详情含冻结时刻·捕获事件·校验和/14 条目分型徽章/不可回放标注/冻结文本展开/生效条件卡 readonly-upstream）；AI 视觉复核浅深两主题正确无样式错乱。「会话头提示词已更新」横幅条款条件不成立（spike=能，回放路径在场，客户端无该文案——locales 全文 grep 零命中），如实标注未截。
- **⛔ 阻断项（转实现者）**：`pnpm --filter @eterna/packctl run verify` exit 2——T2.2（df28013）给 `packages/prompt-studio/src/registry.ts:138` 的 `PromptRegistryEntry` 新增必填 `effect` 字段，packctl 经 workspace 类型引用（src/prompt.ts:38）而 T2.5 先落地的 tests/prompt.spec.ts 夹具（:70/:76/:82/:88/:94/:99 六条目）未补字段 → tsc 红、vitest 未执行。修复面小（夹具补字段），修复后复跑该命令+外层 harness 全仓 verify 即闭环；**全仓 verify 绿之前本 gate 不记通过**（合并前必须修，否则 CI verify job 必红）。
- **环境正面记录**：G-PS-01 两条环境发现（llm-openai lib 构建、t7-e2e 冷自举 allowBuilds）本轮不复发；t7-e2e 一次通过无失败链；验收后 `git status packs/` 干净、3108 端口释放。

## G-PS-03 验收记录（ps-v2 P3，2026-11-11，独立验收代理实测）

- **判定文本**：`docs/dev/ps-v2-test-plan.md` §7.3 强断言 1–6 + 缺凭据条款；证据目录 `artifacts/gates/G-PS-03/`（命令台账 + 逐断言判定 + 逐任务映射 + 4 张截图与 DOM 机器核验 + frontend-style §4 自查 + 全部原始输出誊录）。
- **无头命令实测**（exit）：verify-prompt-studio **0**（**329/329**，ai-service **30**=T3.1 四组+T3.2 四判据+T3.3 三判据；client-bundle 20 含 AI 锚点/接线/纪律文案/diff 同源）、verify-eterna-web **0**（11/11 生产档 boot 洁净+studio 行 active+T3 后新 bundle 1,961,935B）、t7-smoke **0**（**93/93** 无 key 全绿，T3.2 断言簇 13 条：unavailable 三端点明示/AI 永不直接生效三不变(运行时)/ai-proposal 两段式 source='ai-proposal'/磁盘 storages 记录/审计 aiSource）、t7-ui-check **0**（**60/60**，AI 降级/提案/报告卡文案锚点与四端点接线 combo 级 PASS）、ps-v2-ai-smoke **0**（**6/6 真模型**：路由三元组 keySource=env；润色 draftBytes=201 latencyMs=2381 metaPromptEntryId=meta.studio.ai-polish；审核含红线稿 ruleFindings 空+aiFindings 6/缺红线稿 ruleFindings 三条红线 finding；版本 total 7→7+pendingApproval=null）、tenant-scan **0**（0 findings）、lint 两包各 **0**（0/0）、dsh-evals replay **0**（20 用例全过）；prompt-scan **0**（0 findings，G-PS-02 判据面回归——T3 新增 ai/polish.md、ai/review.md 已登记不触发 finding）。
- **机械计数**：t7-e2e 120（≥72）/t7-smoke 93（≥38）/t7-ui-check 28+1 循环（≥17+1）；誊录对账 smoke 93=grep 93、ui-check 运行 60（28 静态+锚点循环生成）、ai-smoke 6。
- **截图**：diff 视图+审核报告卡 × 深浅共 4 张（playwright-core+系统 Chrome，G-PS-02 配方沿用；采集路径只读——不点保存/不点提案提交，收尾 patch 层字节对比 `patchUnchanged=true`）；DOM 机器核验双主题一致（diff-empty=false/proposeBtn 在场/review status=ok+rule-count=3+ai-count=5~6+建议列表逐条在场/「不直接生效」纪律文案在场）；AI 视觉复核浅深两主题无样式错乱。键盘走查/640px AI 区真人走查未执行（非 §7.3 具名要求，静态规则在场+G-PS-01 先例，如实标注）。
- **数字追溯**：docs/README 无任何 AI 成功率/延迟数字引用（grep 实测）；本台账延迟数字（2381/18941ms、截图 4507/6319/5970/9031ms）全部出自本 gate 命令输出（outputs/ps-v2-ai-smoke.log、shots-summary.json）。
- **⚠️ 发现缺陷（非阻断，转实现者）**：客户端 `StudioPage.tsx:888` 以 `{input:{}}` 调无参端点 ai-status（对照 `client/index.ts:63` snapshot 无参形态）被 descriptor 拒收（`unexpected "input"`）→ 可用性胶囊运行态恒滞留「检测中」、`[data-ps-ai-unavailable-note]` 降级说明在 UI 运行态不出现；润色/审核按钮不受 error 态禁用（防御设计），主链可用（截图真链跑通）。三层测试均未覆盖该交界面（单测 mock call/smoke 直查端点/ui-check grep bundle）——修复面一行，建议同补胶囊分态 DOM 级断言。凭据纪律全程：证据目录 key/baseURL 值泄密扫描 0 命中。
- **前置对账**：G-PS-02 阻断（packctl 夹具）经本代理诊断性复跑 exit 0（78/78）确认修复闭合（5f568be）；G-PS-02 终判归其执行链。收尾：3108 释放、packs/ 干净、工作树仅本证据目录未跟踪。

## 失败-修复-重跑链

- 2026-11-11 G-PS-01 运行（验收代理，环境根因）：t7-e2e run1–run4 失败（4 断言簇 + 冷自举 install 失败）→ 根因=llm-openai lib 构建产物缺失（file: 拷贝无 lib → eterna-llm failed to import → 真模型回合静默退化）+ t7-e2e 冷自举模板缺 allowBuilds 裁定 → 环境侧修复（build + 重建 profile node_modules）后终跑 72/72 exit 0。全部日志保留 artifacts/gates/G-PS-01/outputs/（t7-e2e.run1–4.log + 终跑 t7-e2e.log）。
- 2026-11-10 E1 自测期间（实现者内部迭代，非门禁运行）：chrome.debugger attach 竞态（Another debugger）→ 两端在途去重；AX 域整树 ignored → 感知通道切换 DOMSnapshot；backendNodeId 跨域编号 → DOM.resolveNode 桥接。修复过程细节见实现会话记录。


## 升级裁决登记（2026-11-10）

- G-CORE-03 两项升级裁决（判据 1 新标签口径 / content_filter 不可抗力换站重跑）：用户本人裁决，见 artifacts/gates/G-CORE-03/ruling.md；第四轮判定按裁决口径执行。

## 环境中断登记（2026-11-11 01:5x）

- litellm 网关（192.168.31.165:4000）不可达（Connection error，模型重试 5/5 失败）——第六轮采集被阻塞。
- 中断前最后一轮完整采集（2026-11-11 00:13-00:14，纪律分支引导版）：G-CORE-02 实序 snapshot→fill→click!STALE_REF→snapshot（站点自动提交致 ref 失效，模型未用新 ref 重试 click——判定代理第五轮已定性）；G-CORE-03 机械 digest 全绿（snapshot→click→snapshot 三步零错误、ref e220 在点击前快照在案、openedTabs 上报详情页、判据 2 基准比对一致、无 content_filter 中断——裁决①②生效下四判据证据齐备）。
- 待办：①网关恢复后重采一轮 → G-CORE-02 终判（click 重试验证）；②G-CORE-03 判定通道待用户指定（LLM 判定代理因被测页面时政内容触发 provider 输出过滤，无法出判定书；机械 digest 证据链已备齐——四判据布尔/哈希在案）。
## 环境重建事故与回归轮（2026-11-11 上午，终判后）

**事故（非门禁运行）**：上一代 dsh（02:40 世代）残留占 50454 端口 + `gate-boot.log` 为追加模式（旧 `dsh web:` 行留存）→ gate-setup boot 循环匹配旧行假就绪退出、新 dsh 因端口占用崩死 → gate-run 以新凭据登录旧 dsh 报「账号或密码不正确」。处置：杀残留进程、清 boot log 与 gate-env.json、完整重跑 gate-setup。教训已入 gate-setup 运维口径（boot 循环应校验行时间戳或启动前清 log）。

**前端引导链路（用户确认实现，随 E1 交付）**：
- relay 三端点实测：`GET /companion/download.zip`（200，application/zip，6298B，4 文件；`--zip` CLI 通道传入包路径，缺省 404 文本）、`GET /companion/guide`（200，三态自检页——同源轮询 /api/status 渲染 已连接/未连接/失败 + 安装步骤 + 企业策略分支文案）、`GET /api/status`（CORS `access-control-allow-origin: *`）。
- 报错引导闭环：扩展未连接时 browser 工具报错文案附指引页 URL（模型转告用户）；`classify()` 保留业务 code（NO_EXTENSION/NO_TAB），不再被 TOOL_ERROR 兜底覆盖。
- zip 打包修复：extension-companion build.mjs 曾因未导入 `rmSync`（ReferenceError 被 `catch {}` 静默吞）不出包；修复后 esbuild+zip 一体产出。zip 产物入 .gitignore。
- 探测形态裁定：**不**给扩展加全页 content-script DOM 标记（红线 8 最小权限）；引导页自检走同源 /api/status 已闭环。会话内 settings.section 插件分区（三态横幅完整版）归 E2.5-T4。

**回归轮（终判后环境重建首采，回归一致性——非门禁判定）**：G-CORE-01/02/03 三用例全链真跑：G-CORE-02 序列 snapshot→fill→snapshot→click 全零错误（fill 触发站点自动提交→模型按纪律分支①重新 snapshot 取新 ref 再 click 成功，orderSubsequence=true；click 为本会话终点、落点验证走 click 回执 url/title——与终判轮「click 后快照」形态差异，登记不阻断）；G-CORE-03 纯 snapshot→click→snapshot 三步零错误、ref e230 点击前快照在案、openedTabs 上报详情页（ithome.com/1/024/864.htm）、判据 2 基准首段 77 字符逐字符包含一致（指纹 77ch:9ef6b2a6）、无 content_filter、turnFailed=false。digest 证据：smoke/gate-evidence/regression-2026-11-11/（2026-11-11 上午批次；终判轮原始工件未被覆盖——回归批次独立目录，tracked 终判工件经 git checkout 恢复）。

## 生产落地（2026-11-11 上午，用户指令：功能完整生产部署）

链路：PR #9/#10（引导链路+生产落地）→ PR #11/#12（dsh-mcp-client 钉同族 alpha.3）→ PR #13/#14（egress companion 豁免）→ main=ec91ae9 → 干净 worktree 构建镜像 → 容器重部署 healthy。

**生产实测抓到并修复的两个阻断**（均为验收环境覆盖不到的生产实跑发现）：
1. **dsh-mcp-client 版本族**：rc.1 被 dsh@0.2.2-alpha.3 内核静默 disable（requirements 整组 rc.1 包不匹配）——「@deepseek-ai 须同版本」老坑的版本族变体；改装同族 0.2.2-alpha.3 后零拒装、容器内 MCP initialize+tools/list 三工具全通。
2. **egress 语义错位**：mimo-pro 调 browser_snapshot(url=example.com) 被域名白名单（3 条内网规则）拒——mcp__browser__* 的 url 参数=用户浏览器导航目的地（出站在用户机器），被当服务端出站审计。修复=egress 加 exemptToolGlobs（缺省豁免 mcp__browser__*，配置可收窄；extra 17+glue 25 测试）。

**生产端到端终验（公网入口真实会话）**：模型按纪律调 mcp__browser__browser_snapshot → relay 回 NO_EXTENSION+指引页 URL → 模型完整转告用户（原因+三步安装操作+「告诉我已连接我会重试」）——工具面挂载与引导报错链路在生产同时坐实。verify.sh 10/10（9310 三项真·生产容器——第一轮 verify 曾误打本机残留验收 relay（127.0.0.1 优先命中），清场后复验）。

**运维待办（公网形态两步，用户操作）**：① .env 设 `ETERNA_RELAY_PUBLIC_URL=wss://eternity-electricity.cn:3210/relay/extension`；② DSM 反代加 `/relay` → `本机IP:9310`（WebSocket 开）——guide 页/报错文案即按公网地址展示（当前展示 127.0.0.1:9310，仅本机/局域网形态可用）。token：`docker exec eterna-agent cat /data/relay-token`（或 .env 设 ETERNA_RELAY_TOKEN）。

**外网形态打通（2026-11-11，用户配完 DSM 反代后全链验证通过）**：
- 方案修正：DSM 反代规则来源只有 协议+主机名+端口（无路径字段），`/relay` 路径前缀方案在 DSM 上不可行（公网 404 来自 DSM nginx）→ 改为**独立端口规则**（来源 `HTTPS/*:9310` → 目的地 `HTTP/192.168.31.44:9310`，与既有 eternaAgent 3210 规则并存）+ 公网防火墙放行 9310；`.env` 改 `ETERNA_RELAY_PUBLIC_URL=wss://eternity-electricity.cn:9310/extension` 后 up -d 重渲染。
- 公网四项全过：guide 200 / download.zip 200(application/zip 6298B) / wss 无 token 401 / wss 带 token 连接成功——token 鉴权在公网生效（红线 9）。
- **验证工装坑**：node ws 客户端对 wss 未显式声明 ALPN 时可被 TLS 协商成 HTTP/2→upgrade 404（假阴性）；`ALPNProtocols:['http/1.1']` 或 `curl --http1.1` 才是真实验证姿势——浏览器扩展用原生 WebSocket（强制 http/1.1）不受影响。

## 多用户并发 + 前端令牌卡（2026-11-11 下午，产品要求"必须支持多并发"）

链路：PR #19/#20（relay 多用户+access 令牌基建+UI 卡）→ PR #22/#23（cli --tokens-file 生产实测修复）→ main=ce32131 → 干净 worktree 重建部署 healthy（镜像 4a52ef9f5b8b）。

**多用户架构**（产品硬性要求落地）：
- relay 扩展腿按「凭据串=命名空间」多路复用：每 token 一台浏览器，tabs/sessions/ref 注册表全隔离；同令牌二接入 409（token=浏览器实例身份），不同用户完全并行
- 身份路由链：dsh 会话（exec.agent.session.id）→ sessions 表 owner（access 既有）→ companion-tokens.json 用户令牌 → 对应扩展连接；已知归属未生成令牌 → deny（fail-closed）
- **注入点更正（2026-11-13 生产事故修复）**：原「tools/pre-execute 瀑布末段原地覆盖 _eternaToken」在内核 deepFreeze 的冻结参数上必炸（`mcp__browser__*` 全灭，`Cannot add property _eternaToken, object is not extensible`）——内核合同本就禁止 pre-execute 改写输入（dsh-tools contracts.d.ts:312-336、README:197）。现注入点= `ToolsService.executable` 分发边界实例 wrap（`packages/access/src/companion-inject.ts`：冻结 args 展开新对象注入，模型不可伪造语义不变；令牌不进日志/审计/schema；pre-execute 监听保留 fail-closed deny 判定，先于人审）。合同记录：docs/PLUGIN-AUTHORING.md §1.3
- /api/tools 凭据校验（x-relay-token）——回闭公网反代透传暴露的上一轮缺口
- **网页链接默认打开方式联动（2026-11-13）**：上游 chat 设置 linkOpening 出厂默认 sidebar（应用内侧边栏）；当用户已生成 companion 令牌、自己的扩展在线（relay `/api/status?token=` 按令牌探测返回 `tokenConnected`，ns=令牌串）、且从未显式选择过该设置时，access 客户端（`src/client/link-opening.ts`，经公开服务 `configForms.get('ui-chat')` 与设置行同一写面）静默改默认为 new-tab（系统默认浏览器开新页签）——对话链接与浏览器任务执行面保持同一台浏览器；用户显式选择一律尊重，扩展离线/令牌未生成/探测失败全部跳过

**前端令牌卡**（设置→账号→浏览器执行面，全用户可见）：令牌等宽展示+一键复制+生成/重置两击确认+安装指引新窗跳转（guideUrl 由 ETERNA_RELAY_PUBLIC_URL 推导）。

**生产 API 层全链验证**（公网入口 admin 会话）：初始 token=null → reset 生成 ec- 令牌 → view 命中 → 清单文件 /data/access/companion-tokens.json 落盘（0600）→ relay 直读认证（用户令牌 ws 接入+/api/tools 200）→ guideUrl 公网推导正确；verify.sh 10/10。

**生产实测修复**：cli.ts 未接 --tokens-file（server 选项已备 CLI 漏接→清单恒空全 401）——集成测试直构 RelayServer 未盖 CLI 解析面的盲区。

**阻塞登记（并行会话迁移中间态，非本工作范围）**：
1. 新镜像含用量统计插件改造（侧栏重排：用量统计/更多/工作区）——**「⚙ 设置」入口在侧栏消失**（DOM 扫描 60+ 交互元素无设置项；头像/⌘,/右侧栏/更多浮层均无）→ UI 卡生产可见性阻塞（深浅主题截图挂账）。卡本身已交付（bundle 含 CompanionCard），等设置入口恢复即可见。
2. **历史会话全部报 `no adapter registered for provider "litellm"`**（P2 多供应商直连迁移摘除 litellm 后既有会话模型路由失效）——本会话早前 MCP 探针（14:40 之前）的会话正常，之后全失败。

## team-platform 合并后验收（2026-11-11 下午，用户指令验收）

背景：另一会话 feat/team-platform 整体合入 main（d1d0be6，P2 多供应商直连+用量统计+提示词工坊），本会话按指令对 companion 交付做合并后验收。

**companion 交付验收结论：通过（API 层+relay 全链）**：干净 worktree 重建部署 healthy（镜像 314078ac6dcb）；verify.sh 10/10；relay 带公网 publicWsUrl 与多连接字段（connectedBrowsers/browsers）；令牌 API/清单/relay 认证链不受合并影响。

**模型路由验收**：P2 直连正常——历史 litellm 会话内切 DeepSeek Flash 后发话术 1 秒完整回答（瑞利散射）；「no adapter」仅影响**迁移前创建的 litellm 路由历史会话**（用户在会话内重选直连模型即恢复，非生产故障）。

**遗留阻塞（升级上报，team-platform 回归）**：新版侧栏（提示词工坊/循环轨迹/用量统计/更多/工作区）**无「设置」入口**——全 DOM 扫描（含 hidden）、更多浮层（仅「创建你的插件」一项）、头像菜单、⌘, 快捷键、右侧边栏均无。设置弹窗承载的 access 令牌卡/账号管理/通用设置全部不可达。需 team-platform 侧恢复设置入口；恢复后本会话令牌卡（已交付在 bundle 中）即刻可见，深浅主题截图补验。
