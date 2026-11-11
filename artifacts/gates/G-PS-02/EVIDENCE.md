# G-PS-02 验收证据（P2：热生效 + 快照 + 门禁）

> 门禁定义：`docs/dev/ps-v2-test-plan.md` §7.2（强断言清单 1–6 + 无头命令清单 + 浏览器/真模型条款）。
> 执行：独立验收代理「验收-G-PS-02」（用户经工作流书面指定；实现者会话无判定权——INDEX.md:3-5）。
> 日期：2026-11-11 ｜ worktree：`/Users/sunny/code/agent-basis-prompt-studio-v2` @ 分支 `feat/prompt-studio-v2`，HEAD=`df28013`（T2.2 收口提交），验收时工作树洁净（仅本证据目录未跟踪，验收后 `git status packs/` 干净复核过）。
> 范围：T2.1 configEditor 热生效 / T2.2 逐条目热生效矩阵 / T2.3 会话快照 / T2.4 历史会话严格回放（spike=能，按测试计划执行）/ T2.5 packctl prompt-scan / T2.6 memory·glue 运行时自管。
>
> **总结论：⛔ 未全过——§7.2 强断言 1/2/3/4/6 第一手实测全过；强断言 5 的判据命令之一 `pnpm --filter @eterna/packctl run verify` exit 2（T2.2 给 `PromptRegistryEntry` 新增必填 `effect` 字段未同步 packctl 测试夹具的跨包类型回归；prompt-scan 扫描行为本身经具名命令实测 0 findings）。按「宁严勿松」口径计为阻断项，待修复后仅需复跑 §1 #2 及受影响面。**

## 0. 环境

| 项 | 值 |
| --- | --- |
| 主机 | macOS darwin 27.0.0 arm64 ｜ node v24.18.0 ｜ pnpm v11.7.0 |
| 真模型凭据 | `.secrets/litellm-master-key.txt`、`.secrets/litellm-base-url.txt` 在位（只读进宿主进程环境，不入任何被跟踪文件/日志/argv） |
| 截图浏览器 | 系统 Google Chrome headless（playwright-core 驱动，`packages/browser-relay/node_modules` 提供驱动；G-PS-01 已验证配方沿用） |
| 隔离纪律 | t7 运行态全在 `.eterna-home-t7`（gitignored）；宿主一律 127.0.0.1:3108；清理只 `pkill -f 'profile t7-studio'` 精确模式；生产档用独立 `ETERNA_PROFILE_HOME`（verify-eterna-web 默认 `.eterna-home`）真 boot 后即停 |
| 验收前环境 | `packages/llm-openai/lib/` 已构建（G-PS-01 环境发现在场性复核：lib/adapter.js 等产物在位）；t7-studio profile 在位（t7-e2e 本轮冷自举重建） |

## 1. 命令执行台账（本代理本会话逐条实测；原始输出誊录于 `outputs/`）

| # | 命令（均在本 worktree 根执行） | exit | 关键实测 | 誊录 |
| --- | --- | --- | --- | --- |
| 1 | `pnpm --filter @eterna/prompt-studio run verify` | **0** | build:client → oxlint 0 错 → tsc --noEmit 过 → vitest **13 文件 288/288 全过**（新增：config-editor-write 20 / session-snapshot 17 / assembly-replay 33；host-plugin 48 含快照端点与 T2.1 通道面） | outputs/verify-prompt-studio.log |
| 2 | `pnpm --filter @eterna/packctl run verify` | **⛔ 2** | oxlint 0 错（24 文件 87 规则）→ **tsc --noEmit 失败：6 处 `error TS2741: Property 'effect' is missing … but required in type 'PromptRegistryEntry'`（tests/prompt.spec.ts:70/76/82/88/94/99，全部是测试夹具构造的注册表条目缺 T2.2 新增必填字段）** → `&&` 链断，vitest 未执行。诊断性单跑 vitest（**非具名命令，仅定位失败层**）：9 文件 78/78 全过、prompt.spec.ts 6/6 | outputs/verify-packctl.log、outputs/diag-packctl-vitest-only.log |
| 3 | `pnpm --filter @eterna/memory run verify` | **0** | 7 文件 90/90（index-builder.spec.ts 8 含 T2.6 behaviorHeader 登记制 2 条） | outputs/verify-memory.log |
| 4 | `pnpm --filter @eterna/glue run verify` | **0** | 5 文件 35/35（memory-plugin.spec.ts 5 条 T2.6 登记制专项） | outputs/verify-glue.log |
| 5 | `node scripts/verify-eterna-web.mjs`（生产档真 boot） | **0** | **11/11 PASS**：201 entries 全 settle 无 failed；22 裁行全 inactive；105+20 保留行 enabled+active；`eterna-prompt-studio` 行 enabled+active；启动日志无 skipping/incompatible；combo 花名册含 `@eterna/prompt-studio/client.js`（factory 注册 1,923,420 字节） | outputs/verify-eterna-web.log |
| 6 | `node scripts/t7-smoke.mjs` | **0** | **82/82 PASS / 0 FAIL**（基线 38 → 只增；§T2.3 快照端点 20 条断言含三型分语义/不可变/磁盘对账） | outputs/t7-smoke.log |
| 7 | `node scripts/t7-ui-check.mjs` | **0** | **42/42 PASS / 0 FAIL**（17→24 静态 + 循环生成；新增 `data-ps-session-snapshot`/`data-ps-snapshot-session-row`/`data-ps-snapshot-detail`/`data-ps-snapshot-entry`/`data-ps-snapshot-entry-text`/`data-ps-entry-effect` 六锚点 + combo 零 hex 令牌） | outputs/t7-ui-check.log |
| 8 | `node scripts/t7-e2e.mjs`（真模型 A–G 链 + 断言链 14/15） | **0** | **140/140 PASS / 0 FAIL**（台账 `断言台账:PASS=140 FAIL=0`；热生效主链 5.8–5.11（configEditor 通道+pid 不变+新会话即新文）、严格回放 8.1/14.2–14.12、热生效矩阵链 15 全 52 条含 15.41 矩阵全程 pid=21243 不变、15.42 领域层零残留） | outputs/t7-e2e.log |
| 9 | `node tools/packctl/bin/packctl.mjs prompt-scan` | **0** | **0 findings**（全仓，含 memory/glue 源码对账） | outputs/prompt-scan.log |
| 10 | `node tools/packctl/bin/packctl.mjs tenant-scan` | **0** | **0 findings**（隔离铁律不回归） | outputs/tenant-scan.log |
| 11 | `node tools/packctl/bin/packctl.mjs lint packs/event-planning` | **0** | 0 error / 0 warning（共 1 个包） | outputs/lint-event-planning.log |
| 12 | `node tools/packctl/bin/packctl.mjs lint packs/industrial-analysis` | **0** | 0 error / 0 warning（共 1 个包） | outputs/lint-industrial-analysis.log |
| 13 | `node tools/evals/bin/dsh-evals.mjs run --pack packs/event-planning --subset t14-replay --adapter replay` | **0** | **20 用例全 PASS / 0 FAIL**（replay 录放，无凭据；比 G-PS-01 时的 9 用例只增） | outputs/dsh-evals-replay.log |
| 14 | 机械计数（§2.2 口径） | — | `grep -c "check('"`：t7-e2e **120**（≥72 ✅）｜t7-smoke **82**（≥38 ✅）｜t7-ui-check **24**（≥17 ✅）；`grep -c 'check(\`'` t7-ui-check **1**（循环生成断言在场 ✅）。誊录台账 PASS 数与运行输出一致：82（smoke）/42（ui-check）/140（e2e，120 静态 + F/G、H/I 循环生成 20 条） | outputs/mechanical-counts.txt |
| 15 | `git grep -n "prompt-scan" -- .github/workflows/ci.yml`（T2.5.4①机械可查） | 0 | 命中 2 行：`:37`（步骤名「提示词登记扫描…prompt-scan」）与 `:38`（`run: node tools/packctl/bin/packctl.mjs prompt-scan`） | outputs/mechanical-counts.txt |
| 16 | `git grep -c "for d in packs" -- .github/workflows/ci.yml`（T2.5.4②机械可查） | 0 | **2**（≥2 ✅：verify job lint 循环化 + upgrade-gate 既有行） | outputs/mechanical-counts.txt |

**未由本代理执行的命令（如实标注）**：
- `pnpm -w run verify`（全仓 verify）：**未执行**——验收工作流约定该项由外层 harness 另行运行并判定（本 ask 明示「不要自己跑」）。**交叉提示（非本代理判定）**：#2 的 packctl 类型回归在 `pnpm -r verify` 下同样会红，外层 harness 运行结果以其实测为准。
- 修复动作：**未执行**——packctl 夹具补 `effect` 字段属本期任务代码，本代理无修改权限（ask 明示「不要改本期任务代码」），只登记阻断项。

## 2. §7.2 强断言清单逐条判定

| # | 强断言 | 判定 | 依据（全部第一手实测） |
| --- | --- | --- | --- |
| 1 | 不重启换提示词：保存全程 `host.pid` 不变 + 同进程新会话即用新文 + 旧会话补轮仍旧文 + 轨迹 dump | ✅ | #8：5.11「新会话 C 不等 HMR 即用新文(configEditor 同步重组合;**同进程 pid 不变**)」、8.1「旧会话 A 补轮后系统提示仍不含新文本 V2」、14.11「宿主 pid 未变(pid=21243)」、15.41「矩阵收尾: 宿主 pid 未变(矩阵全程同一服务,无重启) pid=21243」——「视频级证据」按 §9 问题 3 落地方案以 pid 逐段记录+新旧会话 system-prompt 原文对比+turn 轨迹 dump 呈交（e2e 日志全程誊录）；真录屏为可选项，未做（见 §3 末标注） |
| 2 | 逐条目热生效矩阵表在场且每格有断言编号/证据引用；不热生效条目 UI 明示（combo 文案锚点） | ✅ | `docs/dev/ps-v2-hot-effect-matrix.md` 14 条 × 半径逐格带断言编号（§2 表：5.11/15.5/15.15/15.22/15.24-15.27/15.30F–15.39I/15.28/15.29）；#8 15.1「entries[] 14 条全部带 effect.radius」+ 15.40「声明对账:preset×6=即时;time-context×2=readonly-upstream;domain×4=not-composed;runtime×2=runtime-rebuilt（与实测逐面一致）」；#7 combo 含 `data-ps-entry-effect` 锚点 PASS；截图辅证见 §3-2（只读条目「生效条件」卡明示拒写与无生效半径） |
| 3 | 会话快照：开启即有快照、不可变（§6.7 全过）、可查任一会话当时提示词（端点）——三型条目分语义 | ✅ | #6：T2.3 断言 20 条——「session/create 新会话开启即有快照(轮询≤10s 在场)」「快照全景 entries=14」「指针 versionId=当时链最新」「行锚点只读型=在场标记+『上游运行时生成』标注(不伪造 versionId)」「运行时注入型=在场标记标注(不炸不空段)」「checksum 与规范化载荷 sha256 复核一致」「改提示词后已存快照逐字节不变」「未知 sessionId→not-found 明示不炸」「磁盘证据:快照单元落 storages/eterna_prompt_snapshots/ 一文档一快照」；#1 session-snapshot.test.ts **17/17**（原型方法面钉死§6.7② / append·get 往返 / 同 sessionId 二次 append fail-closed / 并发 append 无丢写 / 指针分型语义全集 / 读值失败 text=null+problems / 网关链路开启→入库→端点 / storage 缺席 ready=false 不 5xx / 开启先于挂载队列保底 / 载荷防御 / **§6.7①⑤ 写操作后逐字节不变** / **§6.7④ 并发写开会话不混合版本** / 真实 cordis Context 事件接线 / 插件源码接线钉住）；host-plugin 48/48 含按会话查询端点；#8 15.29 快照分型实测 |
| 4 | 回放（spike=能）：≥2 条目（含非 persona）改后旧会话旧文/新会话新文；两型无版本链条目跳过且记录原因 | ✅ | T1.7 spike 结论=能（docs/dev/ps-v2-spike.md:5「✅ 能按会话区分并替换段落文本」），T2.4 已执行。#8 覆盖 **3 个条目**：persona（5.11 新会话新文 + 8.1 旧会话旧文）、plan-mode.section 非 persona（14.7/14.8 新会话 Q 新文 + 14.9/14.10 旧会话 P 仍旧段 + 14.12 审计 governed 身份从快照解析）、cordis 同构 persona（15.15）；跳过记录：15.28「回放事件(applied\|governed)的 skippedEntries 含两条 runtime 条目(reason=runtime-injection,按型跳过实测) applied=10 runtimeSkips=20」；#1 assembly-replay.test.ts **33/33**（映射完整性互锁 / 身份提取 / complete 段在场检测 / 替换·歧义 fail-safe 双路 / 跨预设不张冠李戴 / 降级双态 / 真 cordis waterfall 集成 ⑩——applied·governed·链保序·竞态·卸载·complete-owner） |
| 5 | prompt-scan：故意未登记构造被拦 + 全仓 0 findings + CI 步骤机械可查 | ⛔ 部分 | 全仓 0 findings：#9 exit 0 ✅；CI 机械可查：#15（ci.yml:37-38 命中）+ #16（`for d in packs`=2）✅；**「被拦」单测经具名命令未跑到**——#2 `pnpm --filter @eterna/packctl run verify` exit 2：tsc 在 vitest 之前失败（6 处 TS2741，夹具条目缺 `effect`），**链断后测试未执行**。诊断性单跑 vitest（明示为替代，非具名命令）：prompt.spec.ts 6/6 过（含「方向 1\|未登记被拦:patch 键/section 使用/packs persona 三个面各有 finding」「CLI 形态:违规仓库退出码 1」）。按宁严勿松口径：本断言不记通过，待修复复跑 |
| 6 | memory/glue 自管：注册表缺席降级单测过 + prompt-scan 对两包 0 findings | ✅ | #3 memory 90/90（behaviorHeader 登记制：缺省=内置兜底非空 / 显式覆写）；#4 glue 35/35（memory-plugin.spec.ts：注册表在场取条目文本/缺席落内置兜底不炸宿主/**活绑定:装载顺序无关,注册表上桌后同 section 再装配即新文**/读取面抛异常落兜底/disposer 幂等）；#9 prompt-scan 全仓 0 findings（扫描面含 packages/memory、packages/glue 源码，登记对账闭环） |

**需真模型条款**：#8 t7-e2e 全链已跑（凭据在位），140/140 含热生效主链（5.8–5.11）、审批瀑布（6.3）、真模型 usage（7.4）——核心链不缺席。

**必须浏览器条款（如实标注）**：
- **快照查看视图深浅截图：已执行**（脚本化采集 + DOM 机器核验 + AI 视觉复核，见 §3）。
- **「会话头提示词已更新」提示（降级路径时）截图：条件不成立，未截**——该项限定「降级路径时」；T1.7 spike 结论=能（回放路径在场，T2.4 已执行），客户端无降级横幅文案（locales.ts 全文 grep「已更新/会话头」零命中，仅 spike 文档提及降级备选方案）。非静默省略。
- **（可选）真录屏：未执行**——§7.2 列为可选人工步骤，本代理无录屏工具；按 §9 问题 3 落地方案以轨迹 dump 为准（#8 日志全程誊录即轨迹台账）。

## 3. 截图（深浅两主题 × 快照查看视图 + 生效条件卡辅证）

采集脚本：`screenshot-capture.mjs`（本目录，可复现；G-PS-01 配方沿用：系统 Chrome headless + `colorScheme: light/dark` 模拟 `prefers-color-scheme`；起隔离档宿主后点侧栏「提示词工坊」入面板）。快照数据源为 t7-e2e 落盘的持久化快照（宿主重启后仍可查——快照持久化本身即 T2.3 断言面）。帧内容机器核验：`screenshot-dom-verify.mjs` → outputs/screenshot-dom-verification.txt（**9/9 PASS**：分区标题「会话快照(开启时冻结)」在场、会话行卡 12 张含 sessionId/时间/条目数/checksum 前缀、详情卡含冻结时刻/捕获事件 session/created/条目数 14/校验和、14 条目分型徽章采样（patch 值型带版本指针 v-000004-853b948e）、不可回放标注在场、冻结文本展开可见首段「T7_E2E_PERSONA_BASE alpha…」、生效条件卡 radius=readonly-upstream+只读卡在场）。

| 视图 | 文件 | 字节 | md5 |
| --- | --- | --- | --- |
| 快照查看·列表+详情（浅） | screenshots/studio-snapshot-light.png | 720,330 | 5d971449… |
| 快照查看·列表+详情（深） | screenshots/studio-snapshot-dark.png | 726,378 | 83c666e6… |
| 条目详情·生效条件卡（浅） | screenshots/studio-entry-effect-light.png | 619,133 | d92d09b9… |
| 条目详情·生效条件卡（深） | screenshots/studio-entry-effect-dark.png | 621,744 | 344625db… |

AI 视觉复核记录（复核输入即上述文件；全高 5822px 长图对视觉模型自动降采样，浅色另裁原分辨率切片复核）：
- 深色快照图：确为**深色主题**（近黑背景/浅色文字），无白底黑字异常块、无重叠/透明文字等样式错乱。
- 浅色快照切片（原分辨率）：浅色主题确认；可见「快照详情」说明段（「快照会在会话开启事件时冻结，只读不可变……行锚点只读型与运行时注入型条目不可回放(上游生成/装配时构建)，仅记在场标记」）、9 张会话行卡（sessionId 加粗+时间+14 条目数+校验和前缀）、条目型别徽章（patch 值型/行锚点只读型）、「不可回放(上游生成)」「无版本指针(不伪造)」标注、版本指针（v-000004-853b948e）、展开的冻结文本块（T7_E2E_PERSONA_BASE alpha / T7_E2E_STUDIO_V2 红线）——与 DOM 核验逐项对上。

## 4. 逐任务断言映射（T2.1–T2.6）

### T2.1 写穿 configEditor 热生效 ✅（单测面）；运行链 ✅
- #1 config-editor-write.test.ts **20/20**：纯变换（persona 目标键替换/`{__jsExpr}` 引用保真/plan-mode 嵌套逐级导航/maxBytes 数值类型对齐/0·≥2 命中 fail-closed/行级键直置）；resolveConfigEditor 缺席防御（bare/get 抛/provide 桩）；真实 cordis 根通道链——① configEditor 在场 edit 收到正确行 id+整行覆写+审计 channel=config-editor+不双写、② 缺席（未 provide/get 抛/行缺席）→ persona-patch 直写兜底+审计 channel=entry-patch、③ verify(dump-config 干跑) 失败→seam 还原回审批前行 config 字节=基线零追加、①b 瞬态错误退避重试、①c 活引用竞态每次重取、② 落点守卫 A/B（patchPath 偏离/documentPath 不符→兜底直写）、③ seam 还原不可用退字节级还原、runGoverned TOCTOU+verify-fail 还原。
- #8 运行链（真模型）：5.8「保存经 configEditor 通道(审计 committed 带 channel=config-editor)」、5.9「`!!js` 表达式保真(未被求值 bake) jsExpr 行数=2」、5.10「写回后 dump-config 干跑通过且组合树含新文(V2)」、5.11「新会话 C 不等 HMR 即用新文(同进程 pid 不变)」。

### T2.2 逐条目热生效矩阵 ✅
- 交付物在场：`docs/dev/ps-v2-hot-effect-matrix.md`（14 条 × 三档半径 + 不可写两型，每格断言编号；§3「需重启」一档现状=零条目并给出 entry-patch 通道 HMR 等待窗说明；§4 已知限制 6 条如实登记——生产档两预设 plan 段同文致回放身份 fail-safe 跳过、cordis 半径在 t7 同构夹具上测得等）。
- #8 实测背书：断言链 15 全 52 条 PASS（15.1 声明面 effect.radius 透传 → 15.2–15.23 preset 六条目逐条「改→同进程生效验证→回滚」→ 15.24–15.27 只读/运行时拒写 → 15.28–15.29 回放跳过+快照分型 → 15.30F–15.39I 领域四条目写回+组合树不含+回滚 → 15.40 声明对账 → 15.41/15.42 收尾）；matrix §6 实测迭代记录（run2 96/2→run3 135/5→run4 140/0）与判据修正过程留档。
- UI 明示：#7 combo 锚点 `data-ps-entry-effect` PASS + #3-2 截图（只读条目生效条件卡文案「不可编辑(上游每次组装生成)……不存在『改后生效半径』」）。

### T2.3 会话快照 ✅
- #1 session-snapshot.test.ts **17/17** + host-plugin 48/48（端点面）；#6 t7-smoke T2.3 断言 20 条（运行面+磁盘对账）；#8 15.29（快照分型 runtime 条目在场标注 versionId=null 不伪造）。详见 §2 断言 3 行。

### T2.4 历史会话严格回放 ✅（spike=能路径）
- #1 assembly-replay.test.ts **33/33**（纯函数身份判定/歧义 fail-safe 双路/complete-owner/未映射条目按型跳过明示 + 真 cordis waterfall 集成 ⑩ 场景）。
- #8 真模型链：8.1（persona 旧会话旧文）、14.2–14.12（plan-mode 非 persona：旧会话 P 仍旧段/新会话 Q 新文/pid 不变/审计 governed 身份从快照解析）、15.15（cordis 夹具条目即时新文）、15.28（runtime 两型 skippedEntries reason=runtime-injection）。

### T2.5 packctl 提示词门禁 ⛔（扫描行为实测过；verify 命令失败——见 §5 阻断项）
- 具名命令过：#9 prompt-scan 全仓 0 findings（对账真值=T1.3 清单+T2.6 登记）、#10 tenant-scan 0 findings 不回归、#15/#16 CI 机械可查双命中（ci.yml:37-38 prompt-scan 步骤；verify job lint 循环化 `for d in packs` 计 2）。
- 具名命令败：#2 `pnpm --filter @eterna/packctl run verify` exit 2（tsc 6 处 TS2741；vitest 因 `&&` 链未执行）。诊断性单跑（替代证据，明示非具名命令）：78/78 过，prompt.spec.ts 6/6——「方向 1 未登记被拦（三面各有 finding）」「方向 2 登记后通过（注入元数据+真实注册表对账）」「误报防护（注释/测试文件豁免/非 persona 插件同名键）」「白名单与豁免标注（缺 reason 出 warning）」「CLI 形态（违规仓库退出码 1）」测试逻辑本身全绿。

### T2.6 运行时层自管（memory/glue section 从注册表读）✅
- #3 memory verify 90/90：index-builder.spec.ts behaviorHeader 选项（缺省=内置 MEMORY_BEHAVIOR_HEADER 兜底非空/显式覆写头部换文本且索引半边不受影响）。
- #4 glue verify 35/35：memory-plugin.spec.ts 登记制 5 条（注册表在场取条目文本且四工具照常挂载/缺席落内置兜底宿主照常起/**活绑定：装载时注册表未挂先落兜底，注册表上桌后同一 section 再装配即新文**/读取面抛异常落兜底不炸/disposer 语义不变幂等）。
- ③ prompt-scan 对账闭环：#9 全仓 0 findings（memory/glue 源码 `ctx.systemPrompt.section` 使用面已登记）。

## 5. 阻断项与过程记录（不藏失败）

1. **⛔ 阻断项：`pnpm --filter @eterna/packctl run verify` exit 2（§7.2 无头命令清单第 6 条）**。
   - 现象：`tsc --noEmit` 6 处 `error TS2741: Property 'effect' is missing in type … but required in type 'PromptRegistryEntry'`，全部位于 `tools/packctl/tests/prompt.spec.ts:70/76/82/88/94/99`（测试夹具构造的注册表条目对象）。
   - 根因（实测定位）：T2.2 提交 df28013 给 `packages/prompt-studio/src/registry.ts:138` 的 `PromptRegistryEntry` 新增**必填**字段 `effect: { radius, note }`；packctl 的 `src/prompt.ts:38` 以 `import type { PromptRegistryEntry } from '@eterna/prompt-studio/registry'` 引用同一类型（workspace 链接指向活源码），而 T2.5（39a8d05，时间序在 T2.2 之前）落地的 prompt.spec.ts 夹具未随之补字段——**跨包类型契约回归，T2.2 收口时未重跑 packctl verify**（INDEX L14 的 78/78 记录是 T2.5 时点）。
   - 影响面：① 本 gate 强断言 5 的「被拦」单测在具名命令下未执行（诊断跑过，见 §4.T2.5）；② 外层 harness 的 `pnpm -w run verify` 预期同样红（非本代理判定，交叉提示）；③ CI 的 verify job 合并后会红——与 INDEX L14「待合并后首跑确认」条款冲突，**修复须先于合并**。
   - 处置：本代理无改任务代码权限，未修复；修复面极小（夹具 6 个条目各补 `effect` 字段或夹具改用 `satisfies` 宽形），修复后复跑 §1 #2 即可闭环。**在全仓 verify 绿之前，G-PS-02 不应记为通过。**
2. **t7-e2e 一次通过（140/0）**：与 matrix §6 记录的 run4 定稿一致；本轮无环境前置失败——G-PS-01 的两条环境发现（llm-openai lib 构建、t7-e2e 冷自举 allowBuilds）在本 worktree 已不复发（lib 产物在位复核；本轮冷自举 install 直接成功）。
3. **验收后工作树洁净复核**：`git status --porcelain` 仅本证据目录未跟踪；`packs/` 无矩阵标记残留（#8 15.42 markerFree=true + 脚本 finally 兜底双保险）；宿主清理纪律执行（每脚本收尾 `pkill -f 'profile t7-studio'` 精确模式，3108 端口释放复核）。
4. **截图采集对运行态的影响**：截图/复核脚本各起一次隔离档宿主（同 3108 端口、同 `.eterna-home-t7`），未触碰生产档（生产档仅 verify-eterna-web 短暂真 boot 后即停，`ETERNA_PROFILE_HOME` 隔离）。

## 6. 结论

§7.2 强断言 1/2/3/4/6 共 5 条 ✅（第一手实测）；强断言 5 ⛔ 部分（具名命令 `pnpm --filter @eterna/packctl run verify` exit 2，类型回归，扫描行为本身经具名 prompt-scan 命令与诊断性 vitest 实测无恙）。真模型链已跑（140/140）；截图已采（快照视图深浅 + 生效条件卡辅证 + DOM 机器核验 + 视觉复核）；「降级路径横幅」条款条件不成立（spike=能）已如实说明。**判定：G-PS-02 暂不通过（阻断 1 项），待实现者补 packctl 夹具 `effect` 字段后复跑 §1 #2（及外层 harness 全仓 verify）再行终判。** 本证据目录即判定材料；判定权在用户书面指定之执行人复核后落 INDEX。
