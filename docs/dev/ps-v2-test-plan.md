# 提示词工作室三期改造测试计划（ps-v2）

> 生成：2026-11-11 ｜ 配套计划书：[plans/2026-11-11-提示词工作室全景化改造计划.md](plans/2026-11-11-提示词工作室全景化改造计划.md)（本文简称「计划书」）。
> 本文回答三件事：计划书 §6 每个任务的**完成判据可执行命令**、**必须新增/扩展的测试文件与断言要点**、**G-PS-01/02/03 三期 gate 的强断言清单与证据要求**，附门禁矩阵总表。
> 原则：宁严勿松；每条判据必须可用 `pnpm` / `git` / `node` 三命令执行；**t7 断言基线只增不减**（t7-e2e 72 项 / t7-smoke 38 项 / t7-ui-check 17 静态 + 1 循环生成断言，机械计数见 §2.2）；凡做不到自动化的（浏览器截图走查、admin 停用操作、无凭据时的真模型链路）一律写成**明确人工步骤并要求如实标注**，绝不以替代品冒充。

## 0. 基线事实（2026-11-11 实测，全部来自本 worktree）

| 事实 | 值 | 来源 |
| --- | --- | --- |
| worktree 分支 | `feat/prompt-studio-v2`，与 `origin/main` 零差异（`git diff origin/main --stat` 空） | 实测 |
| 生产挂载状态 | `profiles/eterna-web/cordis.patch.yml`（430 行）无 prompt-studio 行，唯一 `- insert:` 是 L419 的 `mcp-browser` | grep 实测 |
| `TOGGLEABLE_PLUGINS` | **已含** `{ id: 'eterna-prompt-studio', label: '提示词工作室' }` | `packages/access/src/routes.ts:53` |
| t7-e2e 断言基线 | **72** 项（`check(` 调用 72 处；台账记录「72 项断言全 PASS」） | `scripts/t7-e2e.mjs`、`docs/dev/t7-acceptance.md:6` |
| t7-smoke 断言基线 | **38** 项 | `docs/dev/t7-prompt-studio.md:85`（「smoke 断言(38 项,exit 0 可重复)」），`scripts/t7-smoke.mjs` 逐条对应 |
| t7-ui-check 断言基线 | **17 静态调用点 + 1 循环生成断言**（锚点数组 6 枚 → 运行时 ≥23 条；机械计数口径见 §2.2） | `scripts/t7-ui-check.mjs:166-168` |
| 单测现状 | 8 个文件 1913 行：approval-audit / client-bundle / host-plugin / persona-patch / trace / validator-diff / version-governance / version-store | `packages/prompt-studio/tests/` |
| 字节上限常量 | `MAX_PERSONA_BYTES = 65536`，65536 过 / 65537 拒（UTF-8 字节口径） | `tests/validator-diff.test.ts:40-52` |
| 主题令牌现状 | `src/client/styles.ts` 136 处 `--dsw-alias-*`、零字面 hex；bundle 层已有令牌断言 | grep 实测、`tests/client-bundle.test.ts:41` |
| 乐观锁拒绝分支 | 已实现：在途审批 baseVersionId 漂移拒收 + 保存前校验拒收 | `packages/prompt-studio/src/index.ts:385-387,439-441` |
| 隔离纪律 | DSH_HOME=`.eterna-home-t7`、Web 宿主一律 127.0.0.1:3108、清理只 `pkill -f 'profile t7-studio'` 精确模式、LITELLM 凭据只从 `.secrets/litellm-master-key.txt` / `.secrets/litellm-base-url.txt` 读进宿主进程环境 | `scripts/t7-smoke.mjs:26-29,68-73,199-201` |
| 验收台账 | 门禁工件入 `artifacts/gates/<门禁ID>/`、失败记录永久保留、**实现者及关联会话无判定权**、执行人由用户书面指定 | `acceptance/INDEX.md:3-8` |
| CI verify 链 | `pnpm -w run verify`（= `pnpm -r --if-present run verify`）+ packctl lint + `packctl tenant-scan` + dsh-evals replay | `.github/workflows/ci.yml:24-34`、根 `package.json:13` |
| 单包 verify | `build:client` → `oxlint` → `tsc --noEmit` → `vitest run` | `packages/prompt-studio/package.json:29` |

## 1. 既有测试设施盘点与复用方式

| 设施 | 位置 | 现状与断言面 | 三期复用方式 |
| --- | --- | --- | --- |
| vitest 单测 | `packages/prompt-studio/tests/`（8 文件） | 校验器全集/版本库并发与只增不删/patch 读写与原子写/审批与审计/端点全链（内存 KvUnit + 真实 cordis 根）/客户端 bundle 令牌 | **只增不改语义**：新增 registry / session-snapshot / configEditor / AI 相关测试文件；既有断言不许删 |
| 冒烟脚本 | `scripts/t7-smoke.mjs`（38 断言） | profile 自举+symlink 装载、dump-config 预检、pluginInventory、只读端点、save/rollback 两段式、盘面单元、审计 G5 字段 | 扩断言：per-entry 端点、快照端点、AI 端点缺席降级；末尾断言数只增 |
| UI 自检脚本 | `scripts/t7-ui-check.mjs`（17 静态 + 1 循环生成断言，§2.2 机械计数） | 启动日志洁净、pluginInventory、只读端点、花名册 `__DSH_BOOT__`、combo 含视图锚点 `data-t7-*` 6 枚、combo 无 `color:#hex` | 扩锚点：`data-ps-*`（分组导航/条目详情/diff/快照/AI 卡）；令牌断言扩展至新 bundle |
| E2E 脚本 | `scripts/t7-e2e.mjs`（72 断言，真模型） | 断言链 A–G：R3 卡→committed→新会话新文/旧会话旧文（pid 不变 5.7）→轨迹→回滚→导入导出→审计；`$events` 瀑布应答审批 | G-PS-02 热生效/快照/回放断言的主承载；每期 gate 都要整跑回归（基线只增不减） |
| 生产档真 boot | `scripts/verify-eterna-web.mjs` | 起 eterna-web 真实组合（OS 随机口、无模型调用），断言 pluginInventory 裁行/保留行 enabled+active、无 failed 行；`ETERNA_PROFILE_HOME` 隔离 | **T1.2 生产挂载的主判据**：扩展断言 `eterna-prompt-studio` 行 + 浏览器花名册含本包 client 条目 |
| packctl | `tools/packctl/`（vitest 9 spec）+ `bin/packctl.mjs` | `tenant-scan` 测试形态 = `makeRepo()` 造临时包源 → `tenantScan(dir)` → 按 finding code 断言（`tests/tenant.spec.ts:25-46`）；CI 已接 `node tools/packctl/bin/packctl.mjs tenant-scan`（ci.yml:31）。**lint 已知限制（2026-11-11 实测）**：`lint <包A> <包B>` 只扫第一个包且 exit 0（输出「共 1 个包」，第二路径被静默忽略——`resolvePackRoots` 只取 `positional[0]`，tools/packctl/src/cli.ts:113-119，经 :68/:127 分发）；`lint packs` 裸目录报「路径不是领域包根」exit 2 | T2.5 照抄该形态新增 `prompt-scan`（src/prompt.ts + tests/prompt.spec.ts + CI 步骤）；G-PS-01 的 lint 命令**逐包分两条跑**（见 §7.1） |
| 验收 harness 先例 | `packages/browser-relay/smoke/gate-{setup,run}.mjs` | harness 只采集观察数据，**PASS/FAIL 判定由独立验收代理依据门禁文本作出**（gate-run.mjs 头注） | G-PS-0x 沿用「采集脚本 + 独立判定」两分离；证据落 `artifacts/gates/G-PS-0x/` |
| INDEX 台账 | `acceptance/INDEX.md` | 表列：门禁 ID/阶段/执行人/执行日期/结论/工件/备注（L7-8） | G-PS-01 时一并补登 T7 存量门禁条目（计划书 §8 明示的现状缺口） |
| configEditor 热生效先例 | `packages/llm-doctor/src/index.ts:42-54,118-125` | `ConfigEditorFace` 结构子集接口 + `resolveConfigEditor` try/catch 缺席返回 undefined 不炸宿主 | T2.1 直接复用该接口形态；缺席兜底测试照抄其防御模式 |
| systemPrompt section 使用面 | `packages/memory/src/tools.ts:64`（`ctx.systemPrompt.section(section)`）、`packages/glue/src/plugins/memory-plugin.ts:15` | 运行时层现存使用者仅 memory/glue | T2.6 改造对象；「注册表缺席→内置文本兜底」单测落在这两包 |

## 2. 全程通用纪律（每个任务、每期 gate 都适用）

1. **命令面**：自动化只用 `pnpm` / `git` / `node` 三个命令。默认每任务判据包含 `pnpm --filter @eterna/prompt-studio run verify`（oxlint + tsc strict + vitest，含 build:client）；涉及其他包时按 §3–§5 各任务列出的 `--filter` 目标追加。
2. **断言基线只增不减（配机械计数）**：三个 t7 脚本的既有 `check()` 一条不许删、不许改弱；扩展只能新增条目或在既有条目 detail 中加内容。基线与**机械计数命令**（2026-11-11 实测输出；每期 gate 判据必跑，防「删断言并同步改誊录」——誊录台账 PASS 数须与 grep 数对得上）：
   ```bash
   grep -c "check('" scripts/t7-e2e.mjs      # ≥ 72（静态调用点=运行时断言数，逐条独立）
   grep -c "check('" scripts/t7-smoke.mjs    # ≥ 38（同上，无循环生成）
   grep -c "check('" scripts/t7-ui-check.mjs # ≥ 17（静态字面调用点；另有 1 处循环生成断言 t7-ui-check.mjs:166-168——锚点数组现 6 枚，运行时合计 ≥23 条）
   grep -c 'check(`'  scripts/t7-ui-check.mjs # ≥ 1（循环生成断言在场，防锚点循环被删）
   ```
3. **隔离纪律**（照抄 t7-smoke.mjs:26-29）：运行态全在 `.eterna-home-t7`；宿主一律 3108；清理只 `pkill -f 'profile t7-studio'`；绝不误杀其他 dsh 实例。生产档验证用 `ETERNA_PROFILE_HOME` 指向独立 home，复用 verify-eterna-web.mjs 的约定。
4. **凭据纪律**：LITELLM key/baseURL 只从 `.secrets/litellm-*.txt` 读进宿主进程环境，不写入被跟踪文件/日志/argv（AGENTS.md 工程纪律）。缺凭据时真模型断言**如实标注「未跑+原因」**，不得用假数据填。**标注不豁免 gate 后果**：各期 gate 的核心真模型链（G-PS-01 t7-e2e / G-PS-02 热生效 E2E / G-PS-03 ps-v2-ai-smoke）未跑时该 gate 不得视为通过，「未执行+原因」只适用于非核心断言（截图走查、可选步骤）。
5. **证据纪律**：gate 证据目录 `artifacts/gates/G-PS-0x/`（断言原始输出誊录 + 深浅两主题截图 + frontend-style §4 清单自查 + E2E 轨迹），并按 INDEX.md 表列登记 `acceptance/INDEX.md`；实现者自测证据注明「非门禁判定」，最终判定归独立执行人（INDEX.md:3-5）。
6. **诚实标注**：任何在当前环境跑不了的断言（无浏览器、无真模型、无 admin 账号），在证据中写明「未执行 + 原因 + 建议执行人/环境」，不留空白也不造数。
7. **CI 超集纪律**：每期 gate 的无头命令必须是 CI verify 链（`.github/workflows/ci.yml:24-34` 四步：`pnpm -w run verify` → `packctl lint packs/event-planning` → `packctl tenant-scan` → dsh-evals replay 冒烟）的**超集**——本改造直接重写系统提示词注入面，evals 质量回归（persona 改动直接影响 replay 用例）与包结构门禁任何一期缺席，问题都会推迟到合并进 CI 才暴露。dsh-evals replay 为录放适配器、无凭据可跑（CI 无 secrets 环境运行即证）；退出码 0=放行 / 1=质量不达标 / 2=基础设施错误（ci.yml:36-38 注释）。

## 3. P1 任务测试矩阵（挂载与全景化）

### T1.1 新建 worktree/分支

- **(a) 完成判据命令**（git）：
  ```bash
  git -C /Users/sunny/code/agent-basis-prompt-studio-v2 merge-base --is-ancestor origin/main HEAD   # exit 0
  git -C /Users/sunny/code/agent-basis-prompt-studio-v2 status --porcelain                          # 交接时为空（或仅含本期任务文件）
  ```
- **(b) 测试要求**：无新增测试；此为环境任务。已实测当前 worktree 与 origin/main 零差异（§0）。

### T1.2 生产挂载（eterna-web insert 行 + 启停登记 + 花名册断言）

- **(a) 完成判据命令**：
  ```bash
  node scripts/verify-eterna-web.mjs        # 扩展后：eterna-prompt-studio 行 enabled+active；index.html 花名册含 @eterna/prompt-studio/client.js
  node scripts/t7-ui-check.mjs              # 既有 17 静态+1 循环断言不破（§2.2 机械计数）+ 新增花名册/锚点断言
  git grep -n "eterna-prompt-studio" -- profiles/eterna-web/cordis.patch.yml   # 命中 - insert: 行
  ```
- **(b) 测试文件与断言要点**：
  - **扩展 `scripts/verify-eterna-web.mjs`**（生产档主判据，t7-ui-check 只证明隔离档案不证明生产——见 §9 问题 1）：①pluginInventory 含 `eterna-prompt-studio` 行且 `enabled=true`、`fiberPhase=active`（含默认 preset 组合内检查，脚本既有循环里加本行）；②宿主 `index.html` 的 combo 花名册含本包 `client.js`（照抄 t7-ui-check.mjs:151-158 的三步换票 + combo 断言）；③启动日志无 `skipping|incompatible`。
  - **回归断言（access 侧）**：`pnpm --filter @eterna/access run verify`——①既有启停测试不回归：插件启停/删除 API、非 admin 403、红线拒停、停用持久化到 disabled-plugins.json、enable 恢复挂载已由 `packages/access/tests/routes.spec.ts:319-341` 覆盖（「裁剪逻辑坏」的机器层）；②新增 **id 三处交叉钉住**断言（防「登记 id 错」）：`TOGGLEABLE_PLUGINS` 的 `eterna-prompt-studio` id（routes.ts:53）≡ `profiles/eterna-web/cordis.patch.yml` insert 行 id ≡ 客户端 factory 注册 id（t7-ui-check.mjs:165 断言的 `id: "@eterna/prompt-studio"` 同源）——三处字符串一致，任一改动即红。
  - **admin 停用→重启被裁剪**（完整链路含 entrypoint 渲染管线，需登录态与重启）：**人工步骤**（计划书 T1.2 标注「可缺席」）：admin 在设置页停用提示词工作室 → 重启宿主 → `node scripts/verify-eterna-web.mjs` 观察本行 inactive/缺席。**不可静默省略**——做不了时必须在 gate 证据标注「未执行+原因」；其上的机器层（API 启停 + id 钉住）任何情况下都在 verify 内。

### T1.3 Prompt Registry 数据模型与存量登记

- **(a) 完成判据命令**：
  ```bash
  pnpm --filter @eterna/prompt-studio run verify   # 含新增 tests/registry.test.ts 全过
  ```
- **(b) 测试文件与断言要点**：新增 `packages/prompt-studio/tests/registry.test.ts`：
  1. **对账断言（真值基准，交叉钉住仓库事实源——照抄 validator-diff.test.ts:101-107 的真文件钉住手法）**。条目**先分型，判据按型执行**——不分型的「内容可读回」对 time-context 这类条目不可执行：
     - **patch 值型**（值在 patch 文件、可读回）：preset 层 `profiles/eterna-web/cordis.patch.yml` 两预设 `persona.prefix`（standard 裸标量 :288 / **cordis 块标量 `>-` :149-150**）、`agent-instructions`（`maxBytes: 65536` 行 :154/:292）、`plan-mode` 的 `config.section`（**`|` 多段字面块 :188-199 与 :331 起**）；领域层 `packs/event-planning/cordis.patch.yml:12-14` 与 `packs/industrial-analysis/cordis.patch.yml:12-14` 的 `system-prompt.personaPrefix` + 两包 `persona.md` 全文——断言定位锚点在场且反引值非空；
     - **行锚点只读型**（行在场但提示词文本由上游插件运行时生成）：`time-context` 两预设均为**无 config 裸行**（:155-156/:293-294），上游 config 面只有调度项 `refreshIntervalMs`/`timeZone`（node_modules `@deepseek-ai/dsh-time-context` README.md:34-46），无 patch 值亦无写回落点——断言裸行在场 + 条目型别=只读（运行时生成），**写链路对其 fail-closed 拒写并明示「该条目由上游插件生成，无 patch 写回落点」**，不造写回假象；
     - **运行时注入型**：memory（`packages/memory/src/tools.ts:64` section）与 glue 注入的 section 元数据——断言来源代码锚点在场。
  2. **条目模型完整性**：每条含 `{id, 层, 来源插件/包, patch 定位, 当前值, 条目型别(patch 值型/行锚点只读型/运行时注入型), 风险标注}`；id 全局唯一；层枚举闭合（preset/domain/runtime）；**型别枚举闭合且与判据 1 的对账分支一一对应——每型至少 1 条被真文件钉住**（防「删掉麻烦条目换轻松」的偷懒解）。
  3. **无遗漏对账清单**：新增 `docs/dev/ps-v2-registry-ledger.md`（文件:行号 逐条），registry.test.ts 内维护「清单 ↔ 注册表条目 id 集合」相等断言，且**型别字段一并入 ledger**——删条目或改型别都会打破相等，清单与代码互相锁住。
  4. **红旗锚点豁免语义**：persona 类条目标记红线必检，非 persona 条目（如 time-context）标记免红线——防止 T1.6 把红线规则错配到全部条目。

### T1.4 读侧 API 泛化（snapshot / prompt-get / prompt-versions 按条目查询）

- **(a) 完成判据命令**：
  ```bash
  pnpm --filter @eterna/prompt-studio run verify
  node scripts/t7-smoke.mjs      # 38 基线不破 + 新增 per-entry 只读断言
  ```
- **(b) 测试文件与断言要点**：
  - 扩展 `tests/host-plugin.test.ts`：`prompt-get {entryId}` / `prompt-versions {entryId}` / `snapshot` 的 `entries[]`——①每条目可取当前值与版本链（初始 seed 复用 ensureInitial 语义）；②未知 entryId → `rejected`/not-found 明示错误（不抛裸异常）；③不带 entryId 的旧调用形态**保持兼容**（既有 72+38+17+循环 断言里对旧形态的断言不许改弱）；④**块标量条目读回**：`>-`/`|` 形态条目（§3 T1.6 形态 A/B/C）的当前值反引正确——`unquoteYamlScalar` 现状对块标量返回 undefined 走 fail-closed（src/persona-patch.ts:86 起，既有语义与 tests/persona-patch.test.ts:88-89 断言**不动**），泛化必须走**新增独立块标量反引函数**，不许改弱旧断言；⑤**存量数据兼容**（API 形态兼容≠数据兼容）：v1 形状的存量版本记录（persona 单条、无 entryId 字段——形状对齐 t7-smoke 每轮在 `storages/eterna_prompt_studio/versions/` 产生的 JSON 文档）作 fixture（落 `tests/fixtures/`）注入泛化后的 store：`list`/`get` 仍可读、默认归 persona 条目（或显式迁移标记），**不许读失败、不许静默丢弃**；t7-smoke 每轮清场复现不了升级场景，该场景只由此 fixture 覆盖。
  - 扩展 `scripts/t7-smoke.mjs`：按条目只读断言——preset 条目采样**必须含 1 个块标量条目**（建议 plan-mode `section: |`，三类写形态中最难，见 §3 T1.6）+ 1 个领域 `personaPrefix` 条目 + 1 个行锚点只读型（time-context：返回值为「上游运行时生成」标注而非文本），断言 `prompt-get`/`prompt-versions` 按条目返回且值与 dump-config 组合树/pack 文件内容一致。

### T1.5 前端 StudioPage 全景改版

- **(a) 完成判据命令**：
  ```bash
  pnpm --filter @eterna/prompt-studio run verify    # client-bundle 令牌/锚点断言扩展后全过
  node scripts/t7-ui-check.mjs                      # 新锚点断言
  ```
- **(b) 测试文件与断言要点**：
  - 扩展 `tests/client-bundle.test.ts`：①令牌铁律扩展到**全部新增/改版组件源文件**（分组导航、条目详情、diff 视图、快照查看、AI 卡）——逐文件断言颜色声明只经 `var(--dsw-alias-…)`/`color-mix(…var(--dsw-alias-…))`/`transparent`（复用 :41 既有正则）；②新视图锚点 `data-ps-group-nav` / `data-ps-entry-detail` / `data-ps-diff-view` / `data-ps-entry-save` 存在于 bundle。
  - 扩展 `scripts/t7-ui-check.mjs`：combo 脚本含上述锚点；combo 无 `color:#hex`（既有断言保持，t7-ui-check.mjs:171-172）。
  - **键盘可达**（Tab 顺序/focus 光圈/`prefers-reduced-motion`）与 **640/760px 双断点响应式**（AGENTS.md 前端铁律 4）：静态断言只能覆盖锚点与令牌，**交互可达性与两断点走查是人工步骤**，随 gate 截图一并留证（frontend-style §4 清单逐项自查附证据目录）。
  - **深浅两主题截图**（全景列表/条目编辑/版本 diff 三页）：**人工浏览器步骤**，gate 证据入 `artifacts/gates/G-PS-01/`；无法执行时如实标注。

### T1.6 写链路泛化（按条目 patch 定位重述写回 + R3 按条目授权）

- **(a) 完成判据命令**：
  ```bash
  pnpm --filter @eterna/prompt-studio run verify
  node scripts/t7-smoke.mjs        # 写链路按条目断言（一/二段式 + dump-config 干跑）
  node scripts/t7-e2e.mjs          # 72 基线回归（persona 主线不破）
  ```
- **(b) 测试文件与断言要点**：
  - 扩展 `tests/persona-patch.test.ts`（或新增 `tests/entry-patch.test.ts`）。**按条目定位泛化必须覆盖全部三种非单行标量写形态，任一缺形态即视为 T1.6 未完成**：
    - 形态 A｜领域层块标量 `>-`：`packs/{event-planning,industrial-analysis}/cordis.patch.yml:14` 的 `personaPrefix: >-`；
    - 形态 B｜preset-cordis 块标量 `>-`：`profiles/eterna-web/cordis.patch.yml:149-150` 的 `prefix: >-`——既有 `locatePrefixLine` 只在 preset-standard span 内匹配**单行** `prefix: 值`（实现见 src/persona-patch.ts:132-156，正则 :149，fail-closed throw 于 :153），对块头行做单行替换会**残留续行产生脏 YAML**，必须整块（块头+续行）一起替换；
    - 形态 C｜plan-mode `section: |` 多段字面块：`profiles/eterna-web/cordis.patch.yml:188-199` 与 :331 起——**三类中最难（多段落整段写回），必须有专项 vitest 断言**，不得只靠 smoke 采样兜底。
    每形态断言：①定位 0/≥2 命中 fail-closed（断言形态沿用 tests/persona-patch.test.ts:73-81；实现基准 src/persona-patch.ts:132-156）；②写后 YAML 往返一致（新文本反引==目标文本）且除目标块外逐字节不变 + `!!js` 行保真（沿用 tests/persona-patch.test.ts:132-150）；③**TOCTOU**：定位后写前文件被外部改写（模拟 profile 升级合并）→ 写前置基线校验失败即拒写、零落盘、文件保持外部改写后的状态（不覆盖他人改动）。块标量反引/重述走**新增独立函数**——`unquoteYamlScalar` 对 `|`/`>` 返回 undefined 的既有语义与 tests/persona-patch.test.ts:88-89 断言不动（基线只增不减）。
  - 扩展 `tests/host-plugin.test.ts`：R3 ruleId 从单 `eterna.prompt-studio.persona-write`（src/approval.ts:21）扩为按条目/通配——①未授权条目（模拟非 admin 规则集）一段直接 rejected；②通配规则覆盖新条目；③**字节上限逐条目**：per-entry `maxBytes` 边界值（65536 过/65537 拒，复用 validator-diff.test.ts:40-52 口径，按注册表条目参数化）；④**红线锚点逐条目**：persona 类条目缺红线拒收且 issues 指明缺哪条（复用 RED_LINE_RULES）；非 persona 条目不做红线检查（T1.3 的豁免标记生效）；⑤**回滚逐条目**（计划书成功标准 3「任一条目可回滚到历史版本」+ 范围行「版本库/审计/回滚覆盖全部条目」）：`prompt-rollback {entryId}` 两段式 → 新版本 `source=rollback`、`parentId=被回滚版本`、版本链只增不删、**块标量条目回滚后 patch 层反引值==被回滚文本**（**形态 A/B/C 各至少 1 例**，与 G-PS-01 强断言 3「三形态各有专项」严格对齐——既有回滚断言全是 persona 单条口径：t7-smoke/t7-e2e 链 D、version-store.test.ts:80-91 仅库级）；行锚点只读型条目（time-context）回滚请求 → fail-closed 明示不支持；⑥**导入通道逐条目**（否则超长/缺红线/坏块标量提示词可经导入直达版本库，绕过 ①–⑤ 全部新门禁；计划书对导入仅承诺 checksum 防篡改，per-entry 校验是本文补的门禁）：per-entry 导入包除 schemaVersion+checksum 外**走同一套按条目校验器**——字节上限超限拒收、persona 类缺红线拒收（issues 指明）、`baseVersionId` 乐观锁必查（过期拒收）、块标量条目导入后 patch 反引一致（形态 A/B/C 各 1 例）；拒收未入库 + 审计 `prompt-import.rejected`（既有 t7-e2e 链 F 10.1–10.12 仅 persona 单条口径，泛化后由 vitest 参数化覆盖全条目）。
  - 审计：写链路审计事件带 `entryId` 字段（既有 system/operator/versionId/at 之外只增字段），扩展 approval-audit 断言。

### T1.7 Spike：assemble waterfall 会话区分

- **(a) 完成判据命令**：
  ```bash
  node scripts/ps-v2-waterfall-spike.mjs   # 新增 spike 脚本：起 t7-studio 宿主 + 注册 system-prompt/assemble 监听 + 一次真模型回合，dump AssembleContext 观测
  ```
  产出 `docs/dev/ps-v2-waterfall-spike.md`，结论必须二选一：「能按会话回放」（附 scope 身份证据）或「不能」（附降级方案，报用户裁定后再进 P2——计划书 §4 待定项 1）。
- **(b) 测试要求**：spike 不是回归测试，**不进 verify 链**；但结论落文档且 P2 各任务的断言依赖它（T2.4 只在「能」时执行）。spike 需一次真模型回合（LITELLM 凭据）；无凭据时**如实标注「spike 未跑+原因」，P2 相应任务挂起**，不得默认「能」。

### T1.8 P1 验收 gate G-PS-01

见 §7.1。

## 4. P2 任务测试矩阵（热生效 · 会话快照 · 门禁）

### T2.1 写穿 configEditor 热生效

- **(a) 完成判据命令**：
  ```bash
  pnpm --filter @eterna/prompt-studio run verify
  node scripts/t7-e2e.mjs    # 新增 configEditor 通道断言：写回后宿主内 dump-config 干跑通过 + pid 不变 + 新会话即用新文
  ```
- **(b) 测试文件与断言要点**：
  - 新增 `tests/config-editor-write.test.ts`：①注入假 `ConfigEditorFace`（接口照抄 `packages/llm-doctor/src/index.ts:42-54`）断言 `edit()` 收到正确的 entry id 与 change 函数返回的覆写；②**configEditor 缺席降级**：`ctx.get('configEditor')` 抛/undefined → 自动落 persona-patch 纯文本重述兜底路径且审计记录通道字段（照抄 resolveConfigEditor 的 try/catch 防御，llm-doctor/src/index.ts:118-125）；③写成功后热生效验证钩子（宿主内 dump-config 干跑）失败 → 回滚已写状态（对齐 persona-patch.test.ts:159-167 的 verify-fail 还原纪律）。
  - 扩展 `scripts/t7-e2e.mjs`：persona 条目走 configEditor 通道保存后，**同进程**（断言 `host.pid` 不变，沿用 :547 口径）dump-config 干跑 + 新会话系统提示含新文（沿用 :574-575 口径）。

### T2.2 逐条目热生效实测矩阵

- **(a) 完成判据命令**（**唯一通道，不设「或」**）：
  ```bash
  node scripts/t7-e2e.mjs    # 矩阵断言全部落在 t7-e2e.mjs 内（基线 72 只增不减）：对矩阵内每条目执行「改→同进程生效验证→回滚」，逐条目输出 PASS/FAIL
  ```
  产出 `docs/dev/ps-v2-hot-effect-matrix.md`：每条目标注「即时 / 重开会话 / 需重启」+ 引用 t7-e2e.mjs 断言编号（无断言编号的格子判为未实测）。**不允许另写专用脚本替代整跑 e2e**——矩阵断言以新增条目并入 t7-e2e.mjs，既保 72 项基线回归，又保判据通道唯一。
- **(b) 测试要求**：矩阵结论**必须来自实测**（README/docs 数字实测可追溯铁律）；不热生效条目在 UI 明示的断言由 T1.5 前端锚点/文案覆盖（combo 含「需重开会话生效」类提示文案锚点）。本任务主要是实测记录 + 前端标注，无新单测文件。

### T2.3 会话快照（开启事件 → 快照入 DSH_HOME 存储 + 查看视图）

- **(a) 完成判据命令**：
  ```bash
  pnpm --filter @eterna/prompt-studio run verify
  node scripts/t7-smoke.mjs    # 新增快照端点断言：新会话开启即有快照、可按会话查询
  ```
- **(b) 测试文件与断言要点**：新增 `tests/session-snapshot.test.ts`（**快照不可变性是本任务核心**，详见 §6.7）：①快照记录含条目版本指针 + 内容 checksum（sha256 口径同 version-store），**指针按条目型别分语义**（对齐 T1.3 分型，未定义语义的型别不得静默空段）：patch 值型 → `entryId → versionId`；**行锚点只读型（time-context，无版本链）→ 在场标记 +「上游运行时生成」标注（不伪造 versionId）**；**运行时注入型（memory/glue section）→ 开启时可解析的 section 文本或元数据在场标记**；②**改提示词后已存快照字节不变**（再次读回 checksum 一致）；③快照 store 无删除/改写原语（原型方法面钉死，照抄 version-governance.test.ts:104「只有 append/list/get/close」形态）；④快照写入与提示词写并发（改提示词瞬间开会话）→ 快照要么全旧要么全新，不出现混合版本（原子性）；⑤「查任一会话当时提示词」端点对三型条目全部返回结构化结果（文本或明示标注），**两型无版本链条目不得报错、不得返回空段冒充**；快照查看视图对只读型/运行时注入型明示「不可回放/上游生成」降级标注（前端文案锚点，随 T1.5 模式入 t7-ui-check）。
  - 扩展 `tests/host-plugin.test.ts`：快照查询端点——按 sessionId 返回当时 effective prompt；未知 sessionId → 明示 not-found 不炸。
  - 快照查看视图前端断言同 T1.5 模式（锚点 + 令牌 + 截图人工步骤）。

### T2.4 历史会话回放（仅当 T1.7 结论=能）

- **(a) 完成判据命令**：
  ```bash
  node scripts/t7-e2e.mjs    # 扩展：改 persona → 同一服务不重启 → 旧会话补轮仍旧文、新会话用新文（既有 6.2/8.1 已覆盖 persona；扩展到 ≥1 个非 persona 条目）
  ```
- **(b) 测试要求**：t7-e2e 扩断言（waterfall 监听按会话快照替换条目文本——**只替换 patch 值型条目；行锚点只读型/运行时注入型跳过并记录跳过原因**，语义对齐 T2.3 分型，两型不得因无 versionId 而失败）；若 T1.7 结论=不能，本任务**不执行**，降级方案（快照存证可查 + 会话头提示）的断言落在 T2.3 端点 + 前端提示文案锚点，并在 gate 证据如实标注降级路径与用户裁定记录。

### T2.5 packctl 提示词门禁（prompt-scan）

- **(a) 完成判据命令**：
  ```bash
  pnpm --filter @eterna/packctl run verify               # 新增 tests/prompt.spec.ts 全过
  node tools/packctl/bin/packctl.mjs prompt-scan         # 全仓 0 findings（对账真值=T1.3 清单）
  node tools/packctl/bin/packctl.mjs tenant-scan         # 既有扫描不回归
  ```
- **(b) 测试文件与断言要点**：新增 `tools/packctl/tests/prompt.spec.ts`（**照抄 tenant.spec.ts 测试形态**，makeRepo 临时包）：
  1. 未登记提示词被拦：①cordis.patch.yml 含 prompt 型 config 键（personaPrefix/prefix/section/persona.md 引用）而无注册表条目 → finding code（建议 `prompt/unregistered-prompt-key`）；②源码含 `ctx.systemPrompt.section` 使用而无登记元数据 → finding；③packs persona 未登记 → finding。
  2. 登记后通过：同构造 + 登记元数据 → 0 findings。
  3. **误报防护**：注释行/测试文件豁免（对齐 tenant.spec.ts:48-51）；白名单与豁免标注机制有单测。
  4. CI 接入（验证点机械化，不留「已提交」这种弱口径）：①`.github/workflows/ci.yml` 在 tenant-scan 步骤后加 `node tools/packctl/bin/packctl.mjs prompt-scan`——机械可查：`git grep -n "prompt-scan" -- .github/workflows/ci.yml` 必命中；②**同一 CI 变更把 verify job 的 lint 步骤从单包改为 `for d in packs/*/` 循环**（照抄同文件 upgrade-gate job 既有形态——「Lint 所有领域包」步骤在 ci.yml:57，循环行 :59），一次关掉 industrial-analysis 的永久 lint 缺口（§9 问题 6）——机械可查：`git grep -c "for d in packs" -- .github/workflows/ci.yml` ≥ 2；③合并后首个 CI run 全绿为**跟进项登记 INDEX 备注列**（worktree 不 push，线上运行只能合并后验证——如实标注「待合并后首跑确认」，不得提前写「CI 绿」）。

### T2.6 运行时层自管改造（memory/glue section 从注册表读）

- **(a) 完成判据命令**：
  ```bash
  pnpm --filter @eterna/memory run verify
  pnpm --filter @eterna/glue run verify
  pnpm --filter @eterna/prompt-studio run verify
  ```
- **(b) 测试文件与断言要点**：扩展 memory/glue 既有测试：①**注册表在场**：section 文本随注册表条目版本变化（改注册表值 → 重建 section 得新文，vitest 假 ctx 注入注册表读取面）；②**注册表缺席降级不炸宿主**：`ctx.get` 无注册表服务 → 落内置兜底文本，宿主照常起（注入缺席 ctx 断言不抛 + 兜底文本非空）；③`prompt-scan` 扫描 memory/glue 源码时因已登记而 0 findings（与 T2.5 对账闭环）。

### T2.7 P2 验收 gate G-PS-02

见 §7.2。

## 5. P3 任务测试矩阵（AI 润色与审核）

### T3.1 AI 链路封装（进程内 ctx.llm + 元提示词自管）

- **(a) 完成判据命令**：
  ```bash
  pnpm --filter @eterna/prompt-studio run verify     # 假 ctx.llm 单测全过（降级/不炸）
  node scripts/ps-v2-ai-smoke.mjs                    # 新增：真模型连通性冒烟（需 LITELLM 凭据）
  ```
- **(b) 测试文件与断言要点**：新增 `tests/ai-service.test.ts`：①假 `ctx.llm` 注入——润色调用返回建议稿、审核返回问题清单（结构断言）；②**无 key / llm 服务缺席优雅降级**：端点返回明确降级状态（非 5xx、不炸宿主），UI 文案锚点「AI 能力不可用」类；③元提示词本身是注册表条目（吃自己狗粮）——对账断言：元提示词条目在 T1.3 清单中、可版本化；④AI 调用超时/异常 → 降级响应 + 审计记录，不留半写状态。

### T3.2 AI 润色（建议稿 + diff 预览 + 作为提案进 R3）

- **(a) 完成判据命令**：
  ```bash
  pnpm --filter @eterna/prompt-studio run verify
  node scripts/t7-smoke.mjs    # 扩展：AI 端点缺席降级断言（无 LITELLM key 环境下 smoke 仍全绿）
  ```
- **(b) 测试文件与断言要点**：扩展 `tests/ai-service.test.ts` / `tests/host-plugin.test.ts`：①**AI 稿永不直接生效**：润色端点调用后版本数不变、patch 文件字节不变、无在途审批（三重断言，口径照抄 t7-e2e.mjs:654-658 只读证明手法）；②建议稿 →「作为提案提交」→ 进入 R3 两段式（ruleId 按 T1.6 泛化规则，`source='ai-proposal'` 新版本来源或等价标记，审计含 AI 来源字段）；③diff 预览复用 `diff.ts`（lineDiffOps 口径不变，既有 diff 单测不许改弱）；④元提示词自管的递归保护：润色目标为元提示词自身时链路仍收敛（不无限递归—— mocked llm 单层即断言）。

### T3.3 AI 审核（问题清单 + 报告卡）

- **(a) 完成判据命令**：
  ```bash
  pnpm --filter @eterna/prompt-studio run verify
  ```
- **(b) 测试文件与断言要点**：①审核规则与 T1.6 校验器**同源复用**（红线冲突/长度/变量引用/一致性）：单测断言审核报告的规则集来自同一模块导出（非复制粘贴的第二实现——同源断言：import 同一常量/函数）；②报告仅展示：审核端点只读（版本数/patch/pendingApproval 三不变，同 T3.2 ① 口径）；③报告卡前端锚点 + 令牌断言（client-bundle / t7-ui-check 扩展）；深浅截图人工步骤。

### T3.4 P3 验收 gate G-PS-03

见 §7.3。

## 6. 七项横切断言要求（必须全部落进具体文件）

| # | 专项 | 落点文件 | 断言要点（全部可执行） | 既有基线（不许改弱） |
| --- | --- | --- | --- | --- |
| 1 | **TOCTOU** | `tests/entry-patch.test.ts`（新）、`tests/host-plugin.test.ts` | ①写前基线校验：定位后文件被外部改写 → 拒写零落盘；②patch 定位 0/≥2 命中 fail-closed；③verify（dump-config 干跑）失败自动还原（字节级还原断言） | persona-patch.test.ts:159-167（verify 失败还原）、:73-81（唯一行 fail-closed） |
| 2 | **字节上限** | `tests/host-plugin.test.ts`（按条目参数化）、registry 校验 | 每条目按注册表 `maxBytes`：边界值恰限通过、+1 字节拒收（UTF-8 字节口径，CJK 按字节计）；preset `agent-instructions` 条目与 patch 里 `maxBytes: 65536` 行交叉钉住 | validator-diff.test.ts:40-52（65536/65537 边界） |
| 3 | **红线锚点** | `tests/registry.test.ts`、`tests/host-plugin.test.ts` | persona 类条目缺任一红线锚点拒收且 issues 指明缺哪条；非 persona 条目豁免（T1.3 标记）；两 pack persona.md 真文件交叉钉住全部通过 | validator-diff.test.ts:78-108（含 :101-107 event-planning persona.md 钉住；**补 industrial-analysis/persona.md 钉住**） |
| 4 | **主题令牌零硬编码** | `tests/client-bundle.test.ts`、`scripts/t7-ui-check.mjs` | ①源文件级：全部新增/改版组件逐文件断言颜色声明只经 `--dsw-alias-*`；②bundle 级：combo 无 `color:#hex`/`background:#hex`；③新锚点在 combo 中在场 | client-bundle.test.ts:41、t7-ui-check.mjs:171-172；styles.ts 现状 136 处别名零 hex（改版后数量**只增**且 hex 仍为 0） |
| 5 | **插件缺席降级** | `tests/config-editor-write.test.ts`、memory/glue 各自测试、`tests/host-plugin.test.ts` | ①configEditor 缺席 → persona-patch 兜底路径 + 审计通道字段；②注册表缺席 → memory/glue 内置文本兜底、宿主不炸；③storage 缺席 → snapshot ready=false 明示（index 端点不 5xx）；④AI 缺 key → 降级状态不炸 | host-plugin.test.ts:171（未挂载降级）、:146（attach 前 RemoteError 明示）；llm-doctor resolveConfigEditor 防御先例 |
| 6 | **并发写与乐观锁** | `tests/host-plugin.test.ts`、`tests/version-store.test.ts`（扩展 per-entry store） | ①stale `baseVersionId` 拒收（保存前与审批确认两处分支，逐条目参数化）；②并发 append 串行化、seq 唯一连续、无丢写；③两客户端并发保存**不同条目**共用同一 patch 文件 → 单写者串行、后者获「版本已前进」明示；④读写在途一致性 | index.ts:385-387,439-441（待测分支）；version-store.test.ts:54-78（并发 20 写）；host-plugin.test.ts:227（乐观锁不符）；persona-patch.test.ts:178-198（单写者串行） |
| 7 | **快照不可变性** | `tests/session-snapshot.test.ts`（新） | ①快照只增不改：写后任何提示词变更不改动已存快照（checksum 逐字节复核）；②无删除/改写原语（原型方法面钉死）；③含条目版本指针 + 内容 checksum；④写瞬间并发 → 原子性（不混合版本）；⑤回滚/导入等所有写操作对既有快照零影响 | version-store.test.ts:80-91（只增不删先例）、version-governance.test.ts:104（方法面钉死先例） |

表外补注：①**回滚逐条目**（计划书成功标准 3 的对账断言）不设横切行，落点为 §3 T1.6(b) 第 ⑤ 项与 G-PS-01 强断言 3——非 persona 条目（尤其块标量形态 A/B/C）的回滚端点坏了，G-PS-01 必须红；②**导入通道同门禁**（横切行 1/2/3/6 的校验全部经 §3 T1.6(b) 第 ⑥ 项施加到 `prompt-import`）——导入是写操作（§6.7⑤ 自己承认），超限/缺红线/坏块标量/stale 锁经导入绕过者，G-PS-01 必须红。

## 7. 三期 Gate：强断言清单与证据要求

通用：每期 gate 证据目录 `artifacts/gates/G-PS-0x/`，内容至少含 ①各命令原始输出誊录（PASS/FAIL 逐条）②深浅两主题截图 ③frontend-style §4 清单自查 ④E2E 断言台账；登记 `acceptance/INDEX.md`（表列：门禁 ID/阶段/执行人/执行日期/结论/工件/备注）。**采集与判定分离**（browser-relay gate-run.mjs 先例）：本计划给出采集脚本与断言文本，最终 PASS/FAIL 由用户书面指定的执行人判定；实现者自测证据须注明「非门禁判定」。

### 7.1 G-PS-01（P1：挂载 + 全景 + 写链路）

**无头可跑（自动化采集，按序执行）**：

```bash
pnpm -w run verify                                   # 全仓 20 包 verify 不回归（CI 同款，ci.yml:24-25）
node scripts/verify-eterna-web.mjs                   # 生产档真 boot：studio 行 enabled+active + 花名册含本包
node scripts/t7-smoke.mjs                            # ≥38+新增：装载/端点/per-entry 读写/审计
node scripts/t7-ui-check.mjs                         # ≥17+循环断言+新增：花名册/锚点/令牌
node scripts/t7-e2e.mjs                              # =72 回归（persona 主线写链路；需 LITELLM 凭据）
node tools/packctl/bin/packctl.mjs tenant-scan       # 0 findings（隔离铁律不回归）
node tools/packctl/bin/packctl.mjs lint packs/event-planning        # ⚠ 逐包分跑：CLI 只扫第一个 positional（cli.ts:113-119 实测，两参数只扫 1 包且 exit 0=假绿）
node tools/packctl/bin/packctl.mjs lint packs/industrial-analysis   # ⚠ CI 现只 lint event-planning（ci.yml:27-28），本条是 industrial-analysis 唯一 lint 门禁机会
node tools/evals/bin/dsh-evals.mjs run --pack packs/event-planning --subset t14-replay --adapter replay   # evals 质量回归（CI 链第 4 步同款，ci.yml:33-34；replay 录放无凭据；本改造动提示词面，缺席=推迟到合并才暴露）
```

**强断言清单（gate 判定文本）**：
1. 生产档 pluginInventory 含 `@eterna/prompt-studio` 行 enabled+active，且浏览器花名册 combo 含其 client.js（生产可见性的机器证据）；
2. 注册表三层条目与仓库事实源逐条对账全过，**按条目型别分判据**（patch 值型反引读回 / 行锚点只读型裸行在场且写链路拒写明示 / 运行时注入型代码锚点在场；registry.test.ts + docs/dev/ps-v2-registry-ledger.md 的 id 与型别双一致）；
3. 写读回滚闭环逐形态成立：任一条目改 → R3 两段式 → 写回 → 宿主内 dump-config 干跑通过 → **回滚两段式恢复历史版本**（计划书成功标准 3）；块标量三形态（领域 `>-` / preset-cordis `>-` / plan-mode `|`）的写回+回滚**各有**专项 vitest 断言（§3 T1.6，形态 A/B/C 逐一），t7-smoke 采样含块标量条目与只读型条目（拒写明示）；
4. TOCTOU/字节上限/红线逐条目生效**且导入通道同门禁**（§6.1–6.3 对应 vitest 全过 + §3 T1.6 ⑥ 导入逐条目校验全过——超限/缺红线/坏块标量/stale 锁经导入闯入者必须拒收）；
5. t7-e2e 72 项全 PASS（基线不破，机械计数 §2.2 核对誊录一致）；
6. 令牌断言：新增组件零字面色值（§6.4）；
7. evals replay 冒烟 exit 0（提示词面改动未造成录放用例质量回归）。

**必须浏览器（人工步骤，做不了时如实标注）**：深浅两主题 × 全景列表/条目编辑/版本 diff 三页截图；键盘可达与 640/760px 双断点走查记录。
**需真模型**：t7-e2e 的 A–G 断言链（LITELLM 凭据）；缺凭据时该链标注「未跑」，gate 不得视为通过（写链路 E2E 是本 gate 核心）。
**可选/可缺席（不可静默省略）**：admin 停用→重启裁剪验证（计划书 T1.2 标注可缺席；缺席时证据必须写「未执行+原因」，其上机器层见 §3 T1.2(b)）。
**附带交付**：T7 存量门禁补登 INDEX（计划书 §8 现状缺口）；T1.7 spike 报告在场（无论结论能/不能，不能时须含用户裁定记录）。

### 7.2 G-PS-02（P2：热生效 + 快照 + 门禁）

**无头可跑**：

```bash
pnpm -w run verify
node scripts/verify-eterna-web.mjs                   # 生产组合机器证据：本改造动提示词面，生产档 boot 洁净 + studio 行 active 每期都要（隔离档不证明生产，§9 问题 1 口径）
node scripts/t7-smoke.mjs                            # +快照端点断言
node scripts/t7-ui-check.mjs                         # +快照视图锚点/不热生效条目 UI 明示文案锚点（combo 级断言的唯一采集载体，t7-ui-check.mjs:151-172；缺本条则断言 2 的文案锚点无运行通道）
node scripts/t7-e2e.mjs                              # +热生效/快照/回放断言（核心证据，需真模型）
pnpm --filter @eterna/packctl run verify
node tools/packctl/bin/packctl.mjs prompt-scan       # 全仓 0 findings
node tools/packctl/bin/packctl.mjs tenant-scan
node tools/packctl/bin/packctl.mjs lint packs/event-planning        # CI 超集纪律（§2.7）：lint 逐包分跑
node tools/packctl/bin/packctl.mjs lint packs/industrial-analysis
node tools/evals/bin/dsh-evals.mjs run --pack packs/event-planning --subset t14-replay --adapter replay   # evals 质量回归（热生效改组合树，缺席=推迟到合并才暴露）
```

**强断言清单**：
1. **不重启换提示词**：保存全程宿主 `host.pid` 不变（t7-e2e :547 口径）+ 同进程新会话系统提示含新文 + 旧会话（保存前已开）补轮仍旧文——「视频级证据」的落地方案（见 §9 问题 4）：宿主 pid 逐段记录 + 新旧会话 system-prompt 原文对比 + turn 轨迹 dump；如需真录屏，为人工步骤（SMOKE_HEADLESS=0 起浏览器 + 录屏工具），做不了时如实标注并以轨迹 dump 为准；
2. 逐条目热生效矩阵表在场且每格有断言编号/证据引用（T2.2），不热生效条目 UI 明示（combo 文案锚点）；
3. 会话快照：新会话开启即有快照、快照不可变（§6.7 全过）、工作室可查任一会话当时提示词（端点断言）——**三型条目分语义**（T2.3：patch 值型全文本 / 行锚点只读型与运行时注入型返回明示标注，不炸不空段）；
4. 回放（若 spike=能）：≥2 条目（含非 persona）改后旧会话旧文/新会话新文，两型无版本链条目跳过且记录原因；若 spike=不能：降级路径断言 + 用户裁定记录在场；
5. prompt-scan：故意未登记构造被拦 + 全仓 0 findings + **CI 步骤机械可查**（`git grep -n "prompt-scan" -- .github/workflows/ci.yml` 命中，T2.5.4）；
6. memory/glue 自管：注册表缺席降级单测过 + prompt-scan 对两包 0 findings。

**必须浏览器（人工）**：快照查看视图深浅截图；「会话头提示词已更新」提示（降级路径时）截图。
**需真模型**：热生效 E2E 主链（本 gate 核心，不可豁免）。

### 7.3 G-PS-03（P3：AI 润色与审核）

**无头可跑**：

```bash
pnpm -w run verify
node scripts/verify-eterna-web.mjs                   # 生产组合机器证据（§2.7 CI 超集纪律；AI 端点不影响 boot，但提示词面改造的生产档回归每期都要）
node scripts/t7-smoke.mjs                            # +AI 端点缺席降级断言（无 key 环境全绿）
node scripts/t7-ui-check.mjs                         # +AI 不可用降级文案/报告卡锚点（combo 级断言的唯一采集载体；缺本条则断言 4 的 UI 文案锚点无运行通道）
node scripts/ps-v2-ai-smoke.mjs                      # 真模型冒烟：润色出建议稿、审核出清单（需凭据）
node tools/packctl/bin/packctl.mjs tenant-scan       # CI 超集纪律（§2.7）：隔离铁律不回归
node tools/packctl/bin/packctl.mjs lint packs/event-planning        # lint 逐包分跑
node tools/packctl/bin/packctl.mjs lint packs/industrial-analysis
node tools/evals/bin/dsh-evals.mjs run --pack packs/event-planning --subset t14-replay --adapter replay   # evals 质量回归（元提示词也是注册表条目，缺席=推迟到合并才暴露）
```

**强断言清单**：
1. AI 产出永不直接生效：调用后版本数/patch 字节/pendingApproval 三不变（机器断言）；
2. 建议稿 → R3 提案 → 两段式生效（source 标记 + 审计含 AI 来源）；
3. 审核规则与 T1.6 校验器同源（同一模块导出断言）；
4. 无 key/llm 缺席优雅降级（端点非 5xx + UI 文案锚点 + smoke 无 key 全绿）；
5. 元提示词自管：元提示词是注册表条目且在版本链中可见；
6. 真模型冒烟输出（建议稿/问题清单样例）入证据；README/docs 若引用成功率/延迟等数字，**逐个可追溯到本 gate 命令输出**。

**必须浏览器（人工）**：diff 视图与审核报告卡深浅两主题截图 + §4 清单自查。
**缺凭据条款**：`ps-v2-ai-smoke` 未跑（无 LITELLM 凭据）时，G-PS-03 **不得视为通过**——AI 真链路是本 gate 的全部主题，假 llm 单测与降级断言只是必要条件而非充分证据。§2.6 的「未执行+原因」标注只适用于非核心断言（截图走查等），**不豁免核心真模型链**（与 G-PS-01「缺凭据时 gate 不得视为通过」、G-PS-02「不可豁免」同口径）。

## 8. 门禁矩阵总表

| 门禁 | 期/任务 | 断言域 | 无头自动（每期 ⊇ CI verify 链四步，§2.7） | 需浏览器（人工标注） | 需真模型（凭据） | 证据工件（artifacts/gates/G-PS-0x/） | INDEX 登记 |
| --- | --- | --- |---|---|---|---|---|
| G-PS-01 | P1 / T1.1–T1.8 | 生产挂载、注册表分型对账、per-entry 读写/回滚/导入同门禁、块标量三形态写回、TOCTOU/字节/红线、令牌 | verify（-w）、verify-eterna-web、t7-smoke、t7-ui-check、t7-e2e、tenant-scan、packctl lint（逐包两条）、dsh-evals replay | 深浅截图 ×3 页、键盘可达+640/760px 走查、（可缺席但不可静默省略）admin 停用裁剪 | t7-e2e 72 项回归 | 断言誊录 + 机械计数输出 + 截图 + §4 自查 + 对账清单（含型别）+ spike 报告 | 是（含 T7 存量补登） |
| G-PS-02 | P2 / T2.1–T2.7 | 不重启热生效（pid 不变）、热生效矩阵、快照不可变（三型分语义）、回放或降级、prompt-scan、memory/glue 自管 | verify（-w）、verify-eterna-web、t7-smoke（快照）、t7-ui-check（快照视图/生效半径文案）、t7-e2e、prompt-scan、tenant-scan、packctl lint（逐包两条）、dsh-evals replay | 快照视图深浅截图、（可选）录屏 | t7-e2e 热生效主链（不可豁免） | 断言誊录 + 机械计数输出 + 轨迹 dump + 矩阵表 + 截图 | 是 |
| G-PS-03 | P3 / T3.1–T3.4 | AI 永不直接生效、R3 提案链、审核同源、缺席降级、元提示词自管 | verify（-w）、verify-eterna-web、t7-smoke（无 key 全绿）、t7-ui-check（降级文案/报告卡锚点）、ps-v2-ai-smoke、tenant-scan、packctl lint（逐包两条）、dsh-evals replay | diff/报告卡深浅截图 | ps-v2-ai-smoke 真模型冒烟（缺凭据不得视为通过） | 断言誊录 + 机械计数输出 + AI 产出样例 + 截图 + 数字追溯表 | 是 |

每期 gate 前置：上一期 INDEX 条目已判定通过；t7 三脚本断言数经 §2.2 机械计数核对 ≥ 基线（72 / 38 / 17+循环）。

## 9. 计划书本身的问题（测试视角发现）

以下问题不阻塞执行，按计划书为准推进，但已在本文相应任务中做了落地方案：

1. **T1.2 的「t7-ui-check 花名册断言」口径错位**：t7-ui-check.mjs 只对隔离档案 `t7-studio`（.eterna-home-t7, 3108）自检，**不能证明生产 eterna-web 档可见**；生产挂载的机器判据应扩展 `scripts/verify-eterna-web.mjs`（真 boot 生产组合 + pluginInventory + 花名册）。本计划 T1.2 两者都要求。
2. **T1.2 的「TOGGLEABLE_PLUGINS 登记」已在基线完成**：`packages/access/src/routes.ts:53` 在 origin/main 已含 `eterna-prompt-studio`，非新增工作；本计划改为防回归断言。
3. **G-PS-02「视频级证据」未定义格式**：仓库既有 E2E 证据形态是逐条 PASS/FAIL 台账 + 轨迹 dump（t7-acceptance.md），无录屏先例。本计划落为「pid 全程不变 + 新旧会话 system-prompt 原文对比 + turn 轨迹 dump」的可执行强断言，真录屏列为可选人工步骤。
4. **断言基线只写了 72**：计划书 §8 只钉 t7-e2e 的 72 项；t7-smoke 38 项、t7-ui-check 17 静态+1 循环生成断言同样必须只增不减，且须配机械计数核对（本文 §2.2 补钉）。
5. **块标量写形态共三种、计划书只隐含一种**：领域层 personaPrefix 是 `>-` 块标量（packs/*/cordis.patch.yml:14）之外，preset 层实测还有 preset-cordis persona `prefix: >-`（profiles/eterna-web/cordis.patch.yml:149-150）与两预设 plan-mode `section: |` 多段字面块（:188-199/:331 起）——既有定位器只认 preset-standard span 内单行 `prefix:`（src/persona-patch.ts:132-156），对块头行单行替换会残留续行产生脏 YAML。T1.6 泛化的真实工作量比计划书一句「按条目 patch 定位重述写回」大，本文 §3 T1.6 已按三形态列专项断言。
6. **packctl lint 单 positional 限制 + CI 只 lint 一个包**（2026-11-11 实测）：`lint <包A> <包B>` 只扫第一个包且 exit 0（输出「共 1 个包」，第二路径被静默忽略——`resolvePackRoots` 只取 `positional[0]`，tools/packctl/src/cli.ts:113-119，经 :68/:127 分发）；`lint packs` 裸目录报「路径不是领域包根」exit 2。而 CI 只 lint packs/event-planning（ci.yml:27-28），industrial-analysis 在现状 CI **无任何 lint 门禁**。本文对策：三期 gate 均逐包两条命令（§7.1–7.3），且 T2.5.4 的 CI 变更**一并把 verify job lint 步骤循环化**（照抄 upgrade-gate job ci.yml:57-59 形态，机械可查）——合并后缺口永久关闭，不只靠 gate 一次性兜底；CLI 多 positional 支持仍建议三期外另做。
7. **计划书 T1.3 把 time-context 列为登记对象，但它无可编辑值**：两预设均为无 config 裸行（cordis.patch.yml:155-156/:293-294），上游 config 面只有调度项 `refreshIntervalMs`/`timeZone`（node_modules `@deepseek-ai/dsh-time-context` README.md:34-46），提示词文本由上游插件运行时生成——计划书「开放范围=全景查看+全部可编辑」对它不可达。本文按「行锚点只读型」落判据（登记可见 + 写链路 fail-closed 拒写明示），与计划书表述存在事实出入，**T1.3 设计时须向用户明示确认只读口径**。
