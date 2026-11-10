# G-PS-01 验收证据（P1：挂载 + 全景 + 写链路）

> 门禁定义：`docs/dev/ps-v2-test-plan.md` §7.1（强断言清单 1–7 + 命令清单 + 人工步骤条款）。
> 执行：独立验收代理「验收-G-PS-01」（用户经工作流书面指定；实现者会话无判定权——INDEX.md:5）。
> 日期：2026-11-11 ｜ worktree：`/Users/sunny/code/agent-basis-prompt-studio-v2` @ 分支 `feat/prompt-studio-v2`，HEAD=`a769dca`（T1.5 收口提交），验收时工作树洁净（仅本证据目录未跟踪）。
> 范围：T1.2 生产挂载 / T1.3 注册表与对账 / T1.4 读 API / T1.6 写链路 / T1.5 前端全景改版 / 附带交付（T1.7 spike 报告在场性 + T7 存量门禁补登 INDEX）。

## 0. 环境

| 项 | 值 |
| --- | --- |
| 主机 | macOS darwin 27.0.0 arm64 |
| Node / pnpm | node v24.18.0 ｜ pnpm v11.7.0 |
| 真模型凭据 | `.secrets/litellm-master-key.txt`、`.secrets/litellm-base-url.txt` 在位（只读进宿主进程环境，不入任何被跟踪文件/日志/argv） |
| 截图浏览器 | 系统 Google Chrome headless（playwright-core 驱动，`packages/browser-relay/node_modules` 提供驱动） |
| 隔离纪律 | t7 运行态全在 `.eterna-home-t7`（gitignored）；宿主一律 127.0.0.1:3108；清理只 `pkill -f 'profile t7-studio'` 精确模式；生产档用 `ETERNA_PROFILE_HOME`（verify-eterna-web 默认 `.eterna-home`）真 boot 后即停 |

## 1. 命令执行台账（本代理本会话逐条实测；原始输出誊录于 `outputs/`）

| # | 命令（均在本 worktree 根执行） | exit | 关键实测 | 誊录 |
| --- | --- | --- | --- | --- |
| 1 | `pnpm --filter @eterna/prompt-studio run verify` | **0** | build:client 98.5kb → oxlint 0 错（35 文件 87 规则）→ tsc --noEmit 过 → vitest **10 文件 211/211 全过** | outputs/verify-prompt-studio.log |
| 2 | `pnpm --filter @eterna/access run verify` | **0** | vitest 67/67（含 T1.2(b) 启停/红线/持久化回归面） | outputs/verify-access.log |
| 3 | `node scripts/verify-eterna-web.mjs`（生产档真 boot） | **0** | **11/11 PASS**：201 entries 全 settle 无 failed；22 裁行全 inactive；105 保留宿主行 + 20 保留 preset 行 enabled+active；`eterna-prompt-studio` 行 enabled+active；启动日志无 skipping/incompatible；index.html 200 且注入 `__DSH_BOOT__`；combo 花名册含 `@eterna/prompt-studio/client.js`；combo 脚本 1,905,234 字节含 factory 注册 `id: "@eterna/prompt-studio"` | outputs/verify-eterna-web.log |
| 4 | `node scripts/t7-smoke.mjs` | **0** | **68/68 PASS**（基线 38 → 只增；§5.5 per-entry 读侧三型采样、§6.5 T1.6 按条目写回/回滚/拒写、§7 条目错配守卫、§8 磁盘 13 文档对账） | outputs/t7-smoke.log |
| 5 | `node scripts/t7-ui-check.mjs` | **0** | **31/31 PASS**（17 静态基线 + T1.5 锚点 `data-ps-*`×4 + 交叉钉住×4 + combo 令牌零 hex 等） | outputs/t7-ui-check.log |
| 6 | `node scripts/t7-e2e.mjs`（真模型 A–G 链） | **0** | **72/72 PASS**（含 6.3 审批瀑布 allowed-once、7.2/7.3 工具调用与审批点、7.4 真模型 usage；5.7 pid 不变；8.1 旧会话旧文） | outputs/t7-e2e.log（前 4 次运行历史见 §5 环境发现） |
| 7 | `node tools/packctl/bin/packctl.mjs tenant-scan` | **0** | **0 findings** | outputs/tenant-scan.log |
| 8 | `node tools/packctl/bin/packctl.mjs lint packs/event-planning` | **0** | 0 error / 0 warning（共 1 个包） | outputs/lint-event-planning.log |
| 9 | `node tools/packctl/bin/packctl.mjs lint packs/industrial-analysis` | **0** | 0 error / 0 warning（共 1 个包） | outputs/lint-industrial-analysis.log |
| 10 | `node tools/evals/bin/dsh-evals.mjs run --pack packs/event-planning --subset t14-replay --adapter replay` | **0** | 9 用例全 PASS（replay 录放，无凭据） | outputs/dsh-evals-replay.log |
| 11 | 机械计数（§2.2 口径） | — | `grep -c "check('"`：t7-e2e **72**（≥72 ✅）｜t7-smoke **68**（≥38 ✅）｜t7-ui-check **21**（≥17 ✅）；`grep -c 'check(\`'` t7-ui-check **1**（循环生成断言在场 ✅）。誊录台账 PASS 数与 grep 数一致：68/31/72（t7-ui-check 31=21 静态+6 循环锚点+条件分支） | outputs/mechanical-counts.txt |
| 12 | `git grep -n "eterna-prompt-studio" -- profiles/eterna-web/cordis.patch.yml`（T1.2(a) 判据命令） | 0 | 命中 2 行：`:9`（块注释）与 `:443`（`- id: eterna-prompt-studio` insert 行） | 本节文字即誊录 |

**未由本代理执行的命令（如实标注）**：
- `pnpm -w run verify`（全仓 20 包 verify）：**未执行**——验收工作流约定该项由外层 harness 另行运行并判定（本 ask 明示「不要自己跑」）。本代理以 #1/#2 两个包级 verify 覆盖了本期待测包（prompt-studio/access）；其余包的 verify 结论以外层 harness 运行为准，本证据不作代答。
- `node docs/dev/ps-v2-waterfall-spike.mjs`（spike 复跑）：**未执行**——非 §7.1 门禁命令；spike 交付物在场性已核（§4.T1.7），其历史实测数据（2026-11-10T17:35Z，27/27）为实现者记录，本证据仅作交付物在场性引用。

## 2. §7.1 强断言清单逐条判定

| # | 强断言 | 判定 | 依据（全部第一手实测） |
| --- | --- | --- | --- |
| 1 | 生产档 pluginInventory 含 `@eterna/prompt-studio` 行 enabled+active，浏览器花名册 combo 含其 client.js | ✅ | #3：`PASS eterna-prompt-studio (prompt studio panel) enabled+active` + `PASS browser roster: combo 花名册含 @eterna/prompt-studio/client.js` + factory 注册（1,905,234 字节）；隔离档同象（#4/#5 pluginInventory 行三断言） |
| 2 | 注册表三层条目与仓库事实源逐条对账全过，按条目型别分判据；ledger 的 id 与型别双一致 | ✅ | #1 registry.test.ts **24/24**：ledger↔注册表 `(id,层,型别,红线)` 集合双向相等（registry.test.ts:267）、每型至少 1 条真文件钉住（:209）、patch 值型逐条反引非空（:220）、行锚点只读型裸行在场+拒写明示（:130/:161）、运行时注入型代码锚点（:170/:180）、required=persona 6 条/exempt 8 条（:321）；#4 运行时 snapshot `entries=14` 全景与三型采样断言 |
| 3 | 写读回滚闭环逐形态成立；块标量三形态写回+回滚各有专项 vitest；smoke 采样含块标量与只读型拒写 | ✅ | 专项：entry-patch.test.ts **22/22**（形态 A :129-201 / 形态 B :203-255 / 形态 C :256 起，各含定位 fail-closed + 整块写回 round-trip + TOCTOU 拒写零落盘）；host-plugin.test.ts ⑤ 回滚形态 A（:1067）与 B+C（:1086）、只读型回滚 fail-closed（:1108）；运行时链：#4 T1.6 plan-mode（`\|`）save 两段式 ruleId=`eterna.prompt-studio.entry-write.preset.standard.plan-mode.section` + 回滚反引==原文、time-context 拒写明示「该条目由上游插件生成,无 patch 写回落点」、领域形态 A 真 pack 文件写回+回滚+字节还原；#6 e2e D/E 链（轨迹+回滚 source=rollback/parentId） |
| 4 | TOCTOU/字节上限/红线逐条目生效且导入通道同门禁 | ✅ | #1：host-plugin.test.ts ③ 字节上限按条目参数化（恰限过/+1 字节拒收，:1000/:1023）、④ 红线逐条目+工业规则集（:1036/:1054）、① 受限规则集未授权条目一段 rejected（:965）、② 通配规则（:987）、⑥ 导入同门禁「超限/缺红线/stale 锁拒收未入库+审计 prompt-import.rejected 带 entryId；块标量导入反引一致(形态 A/B/C)」（:1118）、横切 1 TOCTOU（:1189）；entry-patch 三形态 TOCTOU；#6 e2e 链 F（篡改包拒收+原样导入走 R3） |
| 5 | t7-e2e 72 项全 PASS（基线不破，机械计数核对誊录一致） | ✅ | #6：`断言台账:PASS=72 FAIL=0` exit 0；#11 grep=72 == 誊录 72 |
| 6 | 令牌断言：新增组件零字面色值 | ✅ | #1 client-bundle.test.ts 12/12（逐文件颜色声明只经 `--dsw-alias-*`/color-mix/transparent，:89；数量只增 ≥136，:110）；#5 combo 无 `color:#hex`/`background:#hex`；实测 client 源 `--dsw-alias` 出现 **173** 次、字面 hex 色值 **0**（基线 136 → 只增） |
| 7 | evals replay 冒烟 exit 0 | ✅ | #10：9 用例全 PASS，exit 0 |

**需真模型条款**：#6 t7-e2e 全链已跑（凭据在位），6.2 新会话即用新文、6.3 $events 审批瀑布 answered、7.4 真模型 usage 计入轮次均有 PASS 行——核心链不缺席。

**人工步骤条款（如实标注）**：
- **深浅两主题 × 全景列表/条目编辑/版本 diff 截图：已执行**（脚本化采集 + AI 视觉复核，见 §3；这是「尽力而为」的机器替代，真人走查仍可复核）。
- **键盘可达与 640/760px 双断点走查：部分执行**。640px 断点有截图辅证（§3 之 4）；键盘走查未执行（人工步骤，本代理无完整人工走查能力）。静态替代证据：focus-visible 规则在场（styles.ts:86/:96/:368）、640px 断点媒体查询在场（styles.ts:380）、`prefers-reduced-motion`——studio 样式 **0** 处 animation/transition（实测 grep=0，无动画可减，规约平凡满足；对照 access 因有 transition 而显式落了降级块）；760px 断点不适用于本面板（单列布局，仅 640 一档收边距，styles.ts:379 注释明示）。
- **admin 停用→重启裁剪验证（计划书 T1.2 标注可缺席）：未执行**。原因：需 admin 登录态在设置页做停用操作并重启宿主，属人工浏览器步骤（计划书明示「可缺席」）；其机器层不等价物已全绿——id 三处交叉钉住（#5 交叉钉住×4：access routes.ts ≡ 生产 patch insert 行 ≡ docker 模板行；embed 档无行）+ access 包启停 API/持久化/红线拒停 vitest 67/67（#2）。**未静默省略**，按 §7.1 条款如实登记。

## 3. 截图（深浅两主题 × 三页 + 640px 辅证）

采集脚本：`screenshot-capture.mjs`（本目录，可复现；playwright-core + 系统 Chrome headless，`colorScheme: light/dark` 模拟 `prefers-color-scheme`——dsh-client-ui-theme 默认跟随该媒体查询，实测深色截图确为深色）。清单与指纹（`shots-summary.json` 同步记录）：

| 视图 | 文件 | 字节 | md5 |
| --- | --- | --- | --- |
| 全景列表（浅） | screenshots/studio-panorama-light.png | 334,616 | 8d427bfa… |
| 条目编辑·领域条目（浅） | screenshots/studio-entry-edit-light.png | 343,508 | d4890fe0… |
| 版本 diff（浅） | screenshots/studio-diff-light.png | 379,737 | a2d04e82… |
| 全景@640px（浅） | screenshots/studio-panorama-640-light.png | 363,472 | 2d6aeef9… |
| 全景列表（深） | screenshots/studio-panorama-dark.png | 340,045 | efcbecf1… |
| 条目编辑·领域条目（深） | screenshots/studio-entry-edit-dark.png | 348,037 | 1e54b83a… |
| 版本 diff（深） | screenshots/studio-diff-dark.png | 384,374 | a7f7acd3… |
| 全景@640px（深） | screenshots/studio-panorama-640-dark.png | 367,261 | b1ec9415… |

AI 视觉复核记录（复核输入即上述文件）：
- 浅色全景：完整滚动列含三层分组导航——preset 层 8 条 / 领域层 4 条 / 运行时层 2 条 = 14 条，与顶部统计「14 提示词条目」一致；底部条目详情卡（风险框/来源路径/编辑器 54/65,536 字节/R3 保存按钮/版本列表 #3 rollback→#1 initial/导入区）完整无截断。
- 深色全景：确为深色主题（近黑背景/深灰卡片/白色主文字），与浅色版结构一一对应，对比度可读，无白底黑字块或透明文字等样式错乱——令牌深浅跟随的实证。
- 版本 diff（浅）：`#2 → #3 +0 新增行，-1 移除行` 行级对比块在场，红色 `-` 行为 t7-smoke 回滚移除的红线行。

采集过程中的 DOM 事实（供复现者）：首跑有「预览版说明」aria-modal 把侧栏置 inert，需先关掉；侧栏入口=`button[aria-label="提示词工坊"]`（面板标题 span inert 不可点）；`[data-t7-studio-root]` 自身是滚动容器（外层布局把 border-box 钳到视口高，scrollHeight≈3362），截图前须解除其滚动裁剪才能整页成帧——脚本 `uncapScroll` 已固化该配方。

## 4. 逐任务断言映射（T1.2–T1.7）

### T1.2 生产挂载 ✅
- 生产 patch insert 行在场：`profiles/eterna-web/cordis.patch.yml:443`（#12 git grep 实测）；docker 模板同步行（#5 交叉钉住）。
- 生产档真 boot：#3 三断言（行 enabled+active / 花名册 combo 含 client.js / factory 注册）+ 启动日志洁净 + 201 行零 failed。
- 启停登记不回归：#2 access verify 67/67；id 三处交叉钉住（#5）。
- admin 停用→重启裁剪：未执行（人工，见 §2 标注）。

### T1.3 注册表与对账 ✅
- #1 registry.test.ts 24/24（对账/互锁/不变量/红线豁免，逐 test 名见 §2 断言 2 行）。
- 运行面：#4 `snapshot entries=14`（三层全量）+ 三型采样条目在场。
- 清单工件：`docs/dev/ps-v2-registry-ledger.md`（14 条，含型别与红线列）与测试互锁。

### T1.4 读侧 API 泛化 ✅
- #1 host-plugin.test.ts 44/44：per-entry get/versions（:543）、只读型/注入型 note 明示（:567）、未知 entryId not-found（:580）、**旧调用形态兼容**（:591）、**存量 v1 文档 fixture 兼容（默认归 persona、不丢不重种）**（:651，fixture=tests/fixtures/legacy-v1-version-records.json）、live patch 缺行条目 problems 明示（:628）。
- #4 §5.5 运行时链：plan-mode `|` 整段反引 2362 字节且与 dump-config 组合树一致、领域 `>-` 折叠反引与 pack 文件逐字一致 212 字节、time-context text=null+「上游插件运行时生成」、persona per-entry 与旧口径同值同链。
- 块标量读回走新增独立反引函数；`unquoteYamlScalar` 旧语义未改弱（persona-patch.test.ts 20/20 全过，#1）。

### T1.5 前端全景改版 ✅（人工走查部分除外，见 §2）
- #1 client-bundle.test.ts 12/12（令牌逐文件 + 数量只增 + `data-ps-*` 锚点）。
- #5 combo 含 `data-ps-group-nav/entry-detail/diff-view/entry-save` + 零字面 hex + 两面板 id。
- 截图 8 张 + 视觉复核（§3）。frontend-style §4 清单自查见 `frontend-style-selfcheck.md`。

### T1.6 写链路泛化 ✅
- 专项 vitest：entry-patch 22/22（三形态各：定位唯一性 fail-closed / 整块写回 round-trip 逐字节保真 / TOCTOU）+ host-plugin ①–⑥（R3 按条目/通配、字节上限参数化、红线逐条目+工业规则集、回滚形态 A/B/C、只读型拒回滚、**导入同门禁**）+ validator-diff 33/33 + approval-audit 15/15。
- #4 §6.5/§7/§8 运行时链：见 §2 断言 3 行；审计事件带 entryId（`prompt-save.committed` 等三链 committed 全带）。
- #6 真模型 E2E A–G 链 72/72。

### T1.7 spike（附带交付：报告在场）✅ 在场
- `docs/dev/ps-v2-spike.md` 结论：**能按会话回放**（T2.4 可执行）；产物 `ps-v2-waterfall-spike.mjs`/`ps-v2-spike-observations.jsonl`/`ps-v2-spike-run.json` 齐备。
- `ps-v2-spike-run.json` 实读：checks=27、failures=0（实现者 2026-11-10T17:35Z 记录运行，本代理核对文件内容，未复跑——非门禁命令）。
- 无「不能」情形，故无用户裁定记录要求。

## 5. 环境发现与过程记录（不藏失败）

1. **t7-e2e 前 4 次运行失败链（全部环境根因，非本期任务代码缺陷）**：run1/run2 各 68/72（FAIL 6.3/7.2/7.3/7.4——会话 B 工具回合无工具调用/无审批瀑布/无 usage），run3 同象，run4 冷自举失败（pnpm install）。根因两层：
   - `packages/llm-openai/lib/`（gitignored 构建产物）在本 worktree 从未构建，t7 profile 经 `file:` 协议装的是**无 lib 的拷贝**→宿主启动即 `eterna-llm failed to import`（host log 实证），真模型回合静默退化（turn/end 照发但无 LLM 调用）→ 上述 4 断言必红。修复（环境侧，未改任何仓库代码）：`pnpm --filter @eterna/llm-openai run build` + 重建 profile node_modules。
   - **发现（建议转实现者，非门禁阻断）**：`scripts/t7-e2e.mjs` 冷自举模板的 `pnpm-workspace.yaml`（t7-e2e.mjs:109-116）缺 `@google/genai`/`protobufjs` 两条 allowBuilds 裁定（t7-smoke.mjs:110-114 已有 2026-11-11 修复），全新 profile 下 `pnpm install` 即 `ERR_PNPM_IGNORED_BUILDS` 失败。本代理以手工补 profile 侧 yaml（scratch 运行态）绕过；t7-e2e.mjs 属本期任务代码，未动。
   - **发现（建议）**：t7-e2e 断言面不含「eterna-llm 行 active」，LLM 适配器装载失败时 4 断言以远离根因的形态变红——建议加启动断言（如 pluginInventory eterna-llm enabled+active 或日志无 `failed to import`）。
   - 全部运行日志保留：outputs/t7-e2e.run1.log、.run2.log、.run3.log、.run4.log（失败链完整可溯），最终 outputs/t7-e2e.log（72/72）。
2. **t7-smoke/t7-ui-check 首轮在 llm 修复前运行亦全绿**（68/68、31/31）——两脚本不做模型调用，eterna-llm 装载失败不影响其断言；环境修复后按规范顺序（smoke→ui-check→e2e）整体重跑一遍，各自再次全绿，工件目录保留的是修复后运行。
3. t7-smoke 6.5 节写真 worktree 的 pack 文件，其收场字节还原（`restorePackFile:restored`）后 `git status` 确认工作树洁净（仅本证据目录），无测试残留泄漏进提交。

## 6. frontend-style §4 清单自查

见本目录 `frontend-style-selfcheck.md`（6 项逐项：令牌/双主题截图/无原生对话框/合并保存与防重复/640px+reduced-motion/no-store 适用性说明）。

## 7. 结论

§7.1 强断言 1–7 全部 ✅（第一手实测）；真模型链已跑；截图已采；人工条款（键盘走查全量、admin 停用裁剪）按门禁文本如实标注未执行/部分执行。判定权在用户书面指定之执行人复核后落 INDEX；本证据目录即判定材料。
