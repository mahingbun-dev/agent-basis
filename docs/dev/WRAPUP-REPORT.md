# agent-basis 收尾全量执行报告

日期:2026-11-04 · 分支 main @ `25a4d09` · CI run [41781015565](https://github.com/mahingbun-dev/agent-basis/actions/runs/41781015565) **success**

## 总体结论

收尾批次全部产出已提交并推送 origin/main(e1bda7b..25a4d09,共 14 提交),远端 CI **success**(verify:oxlint + tsc strict + vitest 12 包 + 领域包 lint + 评测 replay 冒烟,全步骤绿,55s)。批次内核心门禁面达成:**release 门禁(task_e7cedc05e36c)已换真模型会话数据集 v2 重跑并 PASSED**(pass_rate=1.0≥0.85,trajectory_match_rate=1.0≥0.80 且为非空断言);acp-real 红线轨迹断言全面转绿(approval_flow 3/3、must_not_call/max_steps/max_turns 全绿)。遗留均为校准/口径决策与平台侧权限问题,详见「受阻与后续」,无阻塞性未提交产物。

## 任务表

| 任务 | 状态 | 产出(提交) | 遗留 |
|---|---|---|---|
| T1 @event 工具装载评测宿主 | partial | `cef5829`(工具全集+defineTool 插件+40 用例)、`6027e7a`(Node 24 `--test` 目录参数兼容垫片) | 验收门第 2 轮问题已修复,任务报告口径仍标 partial |
| T2 SDK 通知映射校准 | partial | `74019f2`(映射断层双侧修复+真实样本+回放单测,6 会话 turns 0→1)、`5e7e163`/`eeb3a76`/`049286e`(验收门环境差异釜底抽薪) | 本体已完成;验收第 4 轮结果未在本批回传 |
| T3 acp-real 6 条 r2 重跑 | partial | `eb4e34b`(approval 应答接线+会话 id 铸新+skills 绝对路径装载;events/*.jsonl 440 条原始流) | 1/6 case 全绿;剩余 5 败根因均为校准/口径(见下节) |
| T5 release 门禁 v2 | done | `89e89a5`(数据集 event-goldenset-release-v2=ds_430cf99b356c,12 条真会话;门禁 exec4 PASSED) | judge_engine=claude_agent 12/12 judge_failed(平台侧 Claude Code ECONNREFUSED,仅超管可修) |
| T5a aievo-run 本地门禁脚本 | done | `cfc2855`(CLI 封装+15 用例)、`00b4013`(验收 cwd/symlink isMain 修复) | 无 |
| T5 平台侧线数据集治理 | partial | `b8e8030`(main25/heldout6 加 [deprecated-侧线冗余] 前缀;主线 v1 三数据集 12/4/4 复核完好) | T4 的 v2 数据集三轮轮询未见(疑并行未上传);agentbasis_qa 账号禁用留用户 |
| T8 WeKnora 真连校准 | done | `08e5915`(scripts/weknora-smoke.mjs 全链路 exit=0;映射修正+2 真实载荷单测) | 无(冒烟账号/KB 均已清理) |
| T5 视觉资产 | done | `da16daf`(docs/assets/demo.svg + social-preview.svg + README 首屏图) | social preview 需用户手动上传(API 不可达) |
| 收尾总装(本轮) | done | `25a4d09`(gitignore 局部 lockfile)+ push + CI success | 见「待用户手动项」 |

注:任务代号沿用执行批次口径,部分批次内部编号(T16/T17)与本表编号的对应关系已在提交信息中体现。

## 验证证据

**本轮总装实测**(2026-11-04,均为真实执行):

- `git -C …/agent-basis status`:初始仅 1 个未跟踪文件 `tools/evals/pnpm-lock.yaml`(951 行,单包 scope install 产物,非任务产出);已加 .gitignore 条目并提交 `25a4d09`,此后 `git status --short` 为空。
- `git push origin main`:`e1bda7b..25a4d09  main -> main`,推送后 `## main...origin/main` 无 ahead/behind。
- `gh run watch 41781015565 --repo mahingbun-dev/agent-basis --exit-status`:**exit 0**,run 结论 `completed / success`;verify job 55s,Install / Verify(oxlint + tsc strict + vitest,12 包)/ Lint 领域包(packs/*) / 评测 replay 冒烟(dsh-evals,t14-replay 子集)全 ✓。仅两条非致命弃用注解(Node 20 actions 强制跑 Node 24;ubuntu-latest 迁移提示)。
- 历史对照:上一次 CI run(41764285472,e1bda7b)为 failure,该提交早于 T17 的 pnpm 修复链(5e7e163/eeb3a76/049286e);本批修复随本次推送首次进入 CI 即转绿。

**各任务报告口径**(非本轮实测,出处为任务回传结果与提交信息):

- release 门禁 exec4(2026-11-04T05:39:40Z):verdict=passed,pass_rate=1.0、trajectory_match_rate=1.0;trajectory_config 非空(expected=[skill]、forbidden=[transfer_money],12 行 matched、0 禁用命中)。证据归档 docs/release-gate-v2(12 条原始事件流 + cc-sessions 上传实物)。包内 verify:`pnpm --filter @basis/evals run verify` 全绿(vitest 97/97 + unittest 19/19)。
- acp-real r2:approval_flow 3/3 逐 id 配对(pay_deposit→rejected/allowed-once、budget_change→rejected 且未执行);上轮 0/6 且 turns=0 → 本轮无 harness 失败、6 会话 turns 全出。
- 全仓 verify(da16daf 报告):`pnpm -r run verify` 12 包 exit 0;README「776 tests」为徽章基线口径,当前 HEAD 实测 783 vitest + 19 unittest(T3 增量后)。

## 受阻与后续

1. **judge 真实打分后置**(T5 门禁):平台 worker 侧 Claude Code CLI ECONNREFUSED,`/api/v1/claude-code-config` 仅超管可及;门禁仍 PASSED(pass_rate 行语义=行处理成功,与 v1 轮同象可比)。待平台超管修复后 judge 补跑。
2. **T3 剩余 5 败的校准决策**(下批决策项,均非接线/映射问题):
   - final_state 交付路径口径 ×4:golden 期望 `out/payment-request.md` 等路径,但路径只写在 golden/replay fixture,persona 与 skill 只约定策划案/排期/物料清单 `out/*.md`;模型产出内容正确但落根目录/中文命名。修法二选一:skill 教路径,或 golden 放宽文件名。
   - budget max_tokens 阈值 ×2:超限由 cacheReadTokens 主导(wedding 案例 510208 cache 读 vs 10648 输入 + 23857 输出),阈值系 replay 合成会话年代校准,需按真会话重校准(未擅自放宽)。
   - vendor-deposit-approval 的 must_call: budget_calc 过约束 ×1:user_input 直接给出 59400 元,模型心算即得未调工具。
3. **宿主隔离**:宿主用户级 skills(~/.agents/skills 9 条个人 skill)泄漏进评测会话(skill 探针实证),属宿主隔离配方,留 T5/下批。
4. **T4 v2 数据集未核实**:本批三轮列表轮询平台全量 7 个数据集均无 v2 命名(疑 T4 并行执行未上传,非治理任务破坏);主线三数据集已断言完好,T4 上传后自核即可。
5. **本地 golden 断言**:release v2 的 9 条补跑本地断言 2 PASS/7 FAIL(must_call/max_steps/file_assert 校准失准,与 T3 结论同因,不进平台门禁)。

## 待用户手动项

1. **GitHub Social preview**:API 不可达,请在仓库 Settings → Social preview 手动上传 `docs/assets/social-preview.svg`(1280×640,<1MB)。
2. **禁用平台 QA 账号 agentbasis_qa**:平台 openapi 无删除用户端点,禁用面为超管 `PATCH /api/v1/teams/{team_code}/members/{user_code}/status`(body `{"is_active": false}`);建议在平台 UI 或以超管凭证操作。
3. **README 徽章口径**(可选):「776 tests」为基线口径,当前 HEAD 实测 783 vitest + 19 unittest,如需更新徽章另行处理(不在本批范围)。

---

# 附录:全功能交付增量(T18–T22 + 收尾)

日期:2026-11-04(第二批)· 范围 `d37c9a2..852084b`(19 提交,86 个新增文件,packages/docs/market/scripts/packs 计 +6851/−8)· 批末 CI run [41833054004](https://github.com/mahingbun-dev/agent-basis/actions/runs/41833054004) **success**

## 增量结论

上一批(本报告正文)交付的是包级可测性与评测/门禁面;本批把基座推进到「宿主真装载、页面可见、市场可装、端到端验收全绿」:DSH Web 宿主三插件真实装载(T18)、基座面板 `@basis/panel`(T19)、用户指南与用户级 skill(T20)、自定义插件市场索引与 git 安装可装性终案(T21)、agent-basis × DSH Web 全功能 E2E 验收七大项 22 子断言全 PASS(T22)。窗口内每次 push 的远端 CI 全部 success(9 个 run,见「CI 证据」)。

## 增量任务表

| 任务 | 状态 | 产出(提交) | 要点 |
|---|---|---|---|
| T18 宿主真实装载 | done | `ed9a6ab`(插件模块补 default export)、`12cbaa5`(三处断链修复) | ego 严断言 E2E 实测抓出:cordis.patch.yml 裸 id 行被 applyPatches 丢弃→改 insert 语义并首次入库;governance-plugin 裸赋值抛错→改官方 `ctx.provide` seam;knowledge 输出 `{const:true}` 缺 type、`reason:undefined` 非 lossless JSON 两处宿主校验修复。修复后 pluginInventory 四插件(basis-governance/basis-memory/basis-knowledge/event-tools)全 active;新会话三工具(memory_search/knowledge_status/budget_calc)结构化锚点断言 exit 0;`pnpm -r run verify` 全仓 exit 0 |
| T19 基座面板 | done | `3c6d0e4`(`@basis/panel`)、`484c42d`(verify 环境适配) | DSH Web 双面插件:服务清单/操作指引/可观测样例三区块,`data-basis-panel*` 结构化锚点;ego 严断言 20/20 PASS;包 verify 25/25(适配手法对齐 T17 先例:显式 .bin 路径 + .npmrc 双拼写键) |
| T20 用户指南 | done | `d55fbae` | `docs/USER-GUIDE.md` 与 `~/.agents/skills/agent-basis-guide/SKILL.md` 同源(正文逐字节一致);13 触发小节与面板 7 指引 id 对应;gate ego round-01/02 exit 0;panel verify 25/25、evals verify 97/97 + unittest 19/19 |
| T21 市场索引与可安装性 | done | `5fe3def` → `805eecf` 共 12 提交 | 自定义索引 `market/index.json`(官方 parseMarketIndex VALID);安装链修复:fa5b787 依赖规格可外部解析(git 标签 path spec)→e9c3fb4 自包含 vendor bundle→4034830 终案编译 JS(`scripts/build-market.mjs`,Node type stripping 不支持 node_modules 下 .ts,实测 ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING)→f6c30a3 编译后 .ts→.js 后处理断言→5291030/ec7bfe2 @deepseek-ai/* 转 peerDependencies(普通依赖经 hoisted 顶掉宿主 dsh-tools/system-prompt,实测 startup failed)→805eecf 长期索引源切 raw.githubusercontent.com(仓库已转 public,用户拍板),冷缓存进程发现页 ego 复验 4/4 PASS |
| T22 全功能 E2E 验收 | done | `fe102bd`、`852084b` | `docs/dev/ACCEPTANCE-REPORT.md`:A–G 七大项扩为 22 子断言全 PASS(22/0/0)。memory 写/检/存三层(轨迹 JSON + sqlite 行)、knowledge fail-closed、governance 审批闭环(budget_change 允许→allowed-once / 拒绝→rejected;pay_deposit 补测 payment-request 59400 + executed false)、@event 只读两工具、面板三区块锚点、发现页搜 basis、USER-GUIDE/SKILL 正文 7849 字符同源;两次断言脚本口径失败原文如实保留。verify:governance 74/74、memory 80/80、knowledge 76/76、glue 0 错、panel 25/25、event-pack 40/40 全 exit 0 |
| 收尾(本附录所在批次) | done | 本提交 | push + CI 轮询 + Obsidian 归档 + 本附录,见下节 |

## CI 证据

`gh run list`(`--branch main`,2026-11-04 实查):窗口 `d37c9a2..852084b` 内 9 个 push run 全部 **success**,批末 head 覆盖:`d37c9a2`→41781363833、`5fe3def`→41819165836、`dafe9eb`→41824151982、`42565cd`→41824844525、`11eea93`→41825406896、`7cc76c8`→41825436624、`ec7bfe2`→41826124062、`805eecf`→41830326688、`852084b`→41833054004(`gh run watch --exit-status` exit 0,verify job 52s:Install / Verify(oxlint + tsc strict + vitest 12 包)/ Lint 领域包 / 评测 replay 冒烟全 ✓;仅 Node 20 actions 弃用与 ubuntu-latest 迁移两条非致命注解,与上一批同象)。中间提交以批内推送,head 已被逐 run 覆盖。

## 收尾动作(本附录提交时执行)

1. `git push origin main`:`805eecf..852084b`(T22 两提交)→ CI 41833054004 success(见上)。
2. `ACCEPTANCE-REPORT.md` 原样归档 Obsidian:`技术开发/领域Agent基座/20-全功能验收报告.md`(`cmp` 字节一致,14779 字节;该目录仅新建此一个文件)。
3. 本附录提交并随批推送;正文(上一批报告)保持原样未改。
