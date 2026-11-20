# T00 现场核对报告（54 §13.1 / §13.2 / §13.4 第 1 步）

- 工作树：`/Users/sunny/code/agent-basis-rc5`
- 采集窗口：2026-11-20 01:58–02:01 +0800
- 性质：只读核对。T00 仅新建本目录 `artifacts/rc5/p0/recon/`，未编辑任何既有/跟踪文件，未执行 push/merge/reset/clean/stash/checkout。
- 指令口径说明：派发单同时写有「可改文件：无（只读；不得编辑任何文件）」与「证据写入 `artifacts/rc5/p0/recon/`」。T00 按后者执行——**只新建证据文件，未改动任何既有文件**；`git status` 因此多出 `?? artifacts/rc5/p0/recon/`（被 `?? artifacts/rc5/p0/` 目录条目吸收），工作树代码面零改动。
- 原始命令与 EXIT：同目录 `recon-commands.log`；分组明细：`group-classification.txt`；阶段目录明细：`stage-dirs.txt`。

## 1. 分支 / HEAD / 日志（对应 §13.1）

- 分支：`feat/dsh-rc5-merge`（`git rev-parse --abbrev-ref HEAD`，EXIT=0）
- HEAD：`02f485788411b9aed1938a3c4b009793a090961e`，与 §13.1（`docs/design/54-rc.5开发与测试验收完整workflow.md:922`）写的 `02f4857` 一致。
- 最近提交（`git log --oneline -8`）：
  - `02f4857` rc5: P1 依赖族统一 0.2.2-rc.5 + H1 LlmError + subagent/流动作适配 + UI 桥接补全
  - `33b01e9` docs(rc5): 53 开发执行 workflow 入库
  - `c7dee18` docs(rc5): 47-51 方案与执行清单入库 + v1 线源码入库
  - 其后为 main 线的 `9f40c2a`/`6f061a8`/…（非本分支提交）
- recon 结束（02:00:44）再次 `git rev-parse HEAD` 仍为 `02f4857`：核对期间没有新提交。

## 2. `git status --short` 全量与 §13.2 分组

采集时计数：**已跟踪修改 M=37，MM=0，A=0；未跟踪条目 29（porcelain 默认折叠目录），展开文件 229（`-uall`，含本报告自身的 `recon-commands.log`）**。

其中：非 artifacts 的新文件 15 个；artifacts/rc5 在阶段扫描时刻磁盘 219 个文件，其中已跟踪 6 个（`p1/verify-1..4.log`、`p1/access-verify.log`、`p1/install-frozen.log`），其余为未跟踪证据。并行 lane 收尾期间 artifacts 文件数有小幅波动（分组分类时 G-F 计 216 行，含本报告 recon 文件；当前磁盘 223 个含 recon 4 个）。

### 2.1 各组实际文件（明细见 `group-classification.txt`）

| 组 | 实测数量 | 实际文件 |
|---|---|---|
| G-A P2 profile | 15 | `docker/profile/{cordis,cordis.super}.patch.yml.template`、`docker/profile/package.json`、`profiles/eterna-{web,super}/cordis.patch.yml`、`scripts/verify-eterna-{web,super}.mjs`、`packages/prompt-studio/{src/registry.ts,src/client/entry-meta.ts,tests/assembly-replay.test.ts,tests/registry.test.ts,tests/session-snapshot.test.ts}`、`tools/packctl/src/prompt.ts`、`tools/packctl/tests/prompt.spec.ts`、`docs/dev/ps-v2-registry-ledger.md` |
| G-B 迁移脚本 | 6（均新文件） | `docker/profile/migrate-mcp-servers.mjs`(+`.test.mjs`)、`migrate-profile-bundles.mjs`(+`.test.mjs`)、`package.acp.json`、`cordis.acp.patch.yml.template` |
| G-C P3 v1 | 12 | `.github/workflows/ci.yml`、`core/cordis/{README.md,package.json,src/context.ts,src/events.ts,src/fiber.ts,src/logger.ts,src/reflect.ts,src/utils.ts,tests/smoke.spec.ts}`、`core/runtime/src/cli.ts`、`core/cordis/LICENSE`（新） |
| G-D access/MCP | 7 | `packages/access/src/{mux,store,tenant}.ts`、`packages/access/src/mcp-personal.ts`（新）、`tests/gateway-role-gate.spec.ts`、`tests/{mcp-manager-drift,channels-webhook-contract}.spec.ts`（新）；`tests/mux-policy.spec.ts` 亦相关但落在组外（见 §2.2） |
| G-E tasks | 3 | `packages/tasks/src/executor/background.ts`、`tests/background.spec.ts`、`tests/fixtures/host.ts` |
| G-F 脚本/证据 | — | `scripts/verify-rc5-env.mjs`（新）+ `artifacts/rc5/**`（未跟踪 213 个文件；分类时含 recon 自身计 216） |
| G-G 文档 | 2 | `docs/design/53-…workflow.md`（M）、`docs/design/54-…workflow.md`（新） |

### 2.2 文档快照之外（§13.2 七组未覆盖的 6 个状态项）

| 状态 | 文件 | 可追溯任务/内容（读自 diff/文件头） |
|---|---|---|
| M | `docker/entrypoint.sh` | 2.4 段新增 T12–T14 迁移接线（+35 行；`git diff` 实测）；§13.2 G-B 行注「entrypoint 接线（T12）仍在 G-D」，但 G-D 文件清单未列此文件 |
| M | `docs/dev/TODO.md` | 新增 2026-11-20 P0 开工记录（+27 行），内容与 p0 证据一致 |
| M | `packages/access/tests/mux-policy.spec.ts` | +6 行：`mcpManager/restart|probe` 仅 admin 的角色断言（B14） |
| ?? | `packages/tasks/tests/subagent-receipt.spec.ts` | 文件头注明 54 T06 / 51 RC5-API-005..007 回执集成测试 |
| ?? | `scripts/profile-upgrade-check.mjs` | 文件头注明 B1 / 54 §4.4 T12 升级预检 |
| ?? | `scripts/profile-upgrade-check.test.mjs` | 上述脚本单测 |

### 2.3 「缺失」判定

- §13.2 列名的文件**没有发现缺失**：G-A/G-B/G-C/G-D/G-E/G-G 所列路径全部就位。
- 但 §13.3/§13.4 点名的两项交付物不存在：
  - `artifacts/rc5/p2/acc-002/`（§13.3 第 4 条要求证据落此目录）——`ls` 报 No such file or directory。
  - `scripts/verify-mcp-personal.mjs`（§13.4 第 4 条要求补）——`ls` 报 No such file or directory。

## 3. artifacts/rc5 阶段证据（对应任务第 3 步）

| 目录 | 状态 | 文件数 | 最近 mtime（pre-recon，排除 recon/） |
|---|---|---|---|
| `artifacts/rc5/p0` | 存在 | 90 | 2026-11-20 01:45:47 |
| `artifacts/rc5/p1` | 存在 | 20 | 2026-11-20 01:57:39 |
| `artifacts/rc5/p2` | 存在 | 72 | 2026-11-20 01:58:23 |
| `artifacts/rc5/p3` | 存在 | 11 | 2026-11-20 01:00:32 |
| `artifacts/rc5/p4` | 存在 | 26 | 2026-11-20 01:58:16 |
| `artifacts/rc5/p5` | **不存在** | — | — |
| `artifacts/rc5/p6a` | **不存在** | — | — |
| `artifacts/rc5/p6b` | **不存在** | — | — |
| `artifacts/rc5/p7` | **不存在** | — | — |

- P0–P4 已有证据；P5/P6a/P6b/P7 仍为空（未开工，符合 §13.4 第 7 条「P5、P6、P7 尚未开始」）。
- P4 已不止「骨架」：实际含 `b12-glue/`（14 文件）与 `b14-system-gates/`（12 文件），后者含 `commands.txt`、`access-full-tests.log`、变异校验说明。与 §13.1 `:926`「p4/ 仅为骨架证据」相比，是快照后的新增证据。
- `artifacts/rc5` 顶层没有任何索引文件（`find -maxdepth 1 -type f` 为空）——§7.1 证据索引未落。
- 注：p0 目录 mtime 因 T00 写入 `recon/` 变为 02:00；上表已排除 recon/，p0 原有 90 个文件最近 mtime 仍为 01:45:47。

## 4. 并行会话检查（对应任务第 4 步）

- **HEAD 未被移动**：核对开始与结束均为 `02f4857`；`git log` 顶部仍是该提交。
- `git reflog -12`：最近动作是 2026-11-20 00:50:57 的 `commit`（02f4857 / 33b01e9），此前是 00:41:05 `reset: moving to HEAD`（基线整理，非破坏性）。核对期间无新 reflog 条目。
- `git stash list`：仅 `stash@{0}: On dev: side-track cordis-core rollback 2026-11-06`（早于本窗，非本次会话产物）。
- `.git/{MERGE_HEAD,REBASE_HEAD,CHERRY_PICK_HEAD,rebase-merge,rebase-apply}` 全部 absent。
- `git worktree list`：rc5 为 `02f4857 [feat/dsh-rc5-merge]`，主树为 `b722a58 [feat/tasks-super-visibility]`，其余 worktree 均为 detached/别的分支——无第二个 rc5 worktree。
- **未发现来源不明的提交**。未跟踪/修改文件均可追溯到 54 号任务（见 §2.2；TODO=P0、entrypoint+profile-upgrade-check=T12、mux-policy=B14、subagent-receipt=T06）。
- **但并行 lane 在核对前 ~2 分钟内仍在写同一工作树**（非提交，仅工作区/证据）：
  - `packages/access/src/mux.ts` mtime 01:57:42（L4/B14）
  - `scripts/verify-rc5-env.mjs` 01:58:22、`artifacts/rc5/p1/*` 01:57:39（L1/P1）
  - `artifacts/rc5/p2/migrate-summary.txt` 01:58:14、`p2/migrate-*` 至 01:58:23（L2/T12–T14）
  - `artifacts/rc5/p4/b14-system-gates/*` 至 01:58:16（L4/B14）
  - 核对窗口内（02:00–02:01）未观察到新的 mtime 变化；但最早写入距核对开始不足 1 分钟，不能排除相关 lane 仍在收尾。
- 结论：现场未被外部会话「覆盖」，但处于**多 lane 同时收尾**状态；此刻提交任何一组都可能抓到尚未落定的半成品，建议先等各 lane 静默（mtime 静默）再按 §13.4 顺序提交。

## 5. 断言结果（本报告实际执行，不包含任何未跑测试）

| ID | 断言 | 结果 | 依据 |
|---|---|---|---|
| A-01 | 分支为 `feat/dsh-rc5-merge` | 通过 | `git rev-parse --abbrev-ref HEAD` EXIT=0 |
| A-02 | HEAD 为 `02f4857…`（= §13.1） | 通过 | `git rev-parse HEAD`，开始/结束两次一致 |
| A-03 | 核对期间无新提交/无并行覆盖提交 | 通过 | `git log -8`、`git reflog -12`、结束复跑 HEAD |
| A-04 | 无 merge/rebase/cherry-pick 进行中 | 通过 | `.git/*` 探针全部 absent |
| A-05 | T00 未执行 reset/clean/stash/checkout | 通过 | 只运行只读命令 + 写 `p0/recon/` 新文件；reflog 无对应动作 |
| A-06 | 工作树计数与 §13.1「34 个修改」 | **不符**：实测 37 个已跟踪修改 | `git status --porcelain` M=37；差额 3 恰为组外 3 个跟踪文件（见 §2.2），但无法从仓库内证明即快照后新增 |
| A-07 | §13.2 G-A..G-G 分组覆盖 | 通过（有 6 个组外状态项） | `group-classification.txt` |
| A-08 | p0–p4 证据存在、p5/p6a/p6b/p7 为空 | 通过 | `stage-dirs.txt`（`find`/`stat` 实跑） |
| A-09 | §13.3 G6 修法第 1 条（`PATCH_SCAN_ROOTS` 加 `docker/profile`） | **未落地** | `tools/packctl/src/prompt.ts:90` 仍为 `['profiles','packs','packages','market']` |
| A-10 | §13.3 第 2 条「豁免逐 key、禁止整文件前缀白名单」 | **不符**：新增整文件豁免 | `tools/packctl/src/prompt.ts:72` 与 `:76` 新增 `profiles/eterna-{web,super}/cordis.patch.yml` 条目；匹配器 `:216-217` 为 `path === entry.path \|\| path.startsWith(entry.path)` |
| A-11 | §13.3 第 3 条两条测试（真实模板 0 / 夹具模板非零且命中 docker/profile） | **未按原文落地**：仅新增 1 条「未豁免 clone 仍报错」测试 | `git diff -- tools/packctl/tests/prompt.spec.ts` |
| A-12 | §13.3 第 4 条证据目录 `p2/acc-002/` | **缺失** | `ls artifacts/rc5/p2/acc-002` EXIT=1 |
| A-13 | §13.4 第 4 条 `verify-mcp-personal.mjs` 与 bootstrap 接线 | **缺失/未接线** | `ls scripts/verify-mcp-personal.mjs` EXIT=1；`registerMcpPersonalRoutes` 仅在 `packages/access/src/mcp-personal.ts:500` 定义，`packages/access/src` 内无调用点（grep 实测） |
| A-14 | T25 `mcp-manager` 命名空间 gate | 代码在（不等同完成） | `packages/access/src/tenant.ts:839-854`；其验证仅见 `p4/b14-system-gates/` 既有日志，T00 **未复跑** |
| A-15 | store 个人层迁移 user_version 0→1 | 代码在（不等同完成） | `packages/access/src/store.ts:177-213`；T00 **未复跑** |

说明：本节所有「通过」仅指 T00 实跑的 git/文件系统检查；**T00 未运行任何测试、构建或 verify**，§13.2「已验证」栏的数值（form-check 0、prompt-scan 0、verify-eterna 229/235、prompt-studio 349）均为既有日志记录（`artifacts/rc5/p2/*.log`），不是本次复跑结果。

## 6. 与 54 号文档的关键偏差（只陈述实况，不判定任务完成）

1. **G6 做法偏离 §13.3**：文档要求把 `docker/profile` 纳入扫描根并逐 key 豁免；实际是「注册表锚点改到 `docker/profile/*.template`（`packages/prompt-studio/src/registry.ts` WEB_PATCH）+ 对两个开发档 patch 做整文件豁免」。`artifacts/rc5/p2/prompt-scan-r2.log` 记录 0 findings，但扫描根不含 `docker/profile`，该 0 并不覆盖模板面。是否等价需 T17/R19 负责人裁定。
2. **T26 未接线**：`registerMcpPersonalRoutes` 无调用点；`verify-mcp-personal.mjs` 不存在；与 §13.4 第 4 条「未接线前不得宣称 B14 完成」相印证。
3. **B14 证据在快照后新增**：`p4/b12-glue/`、`p4/b14-system-gates/` 于 01:38–01:58 落盘，§13.1 写「p4/ 仅为骨架」已过时。
4. **§13.1 的「34 个已跟踪修改」已过时**：实测 37。
5. **令牌风险**：`artifacts/rc5/p2/verify-eterna-web.log` 与 `verify-eterna-super.log` 末行含 `?token=…` 引导会话令牌（本报告未复制该值）。若 artifacts 入库，需按「凭据不落盘」纪律先脱敏。

## 7. 结论

- 现场可安全接管：HEAD、分支、reflog、worktree 均无外来提交或破坏性动作；未提交半成品完整保留。
- 不能把「代码已写」当「任务完成」：G6 修法与 54 §13.3 不一致且缺 acc-002 证据；T26 未接线且缺验收脚本；P5–P7 无证据。
- 接管下一步（§13.4 第 1 步）完成条件：确认并行 lane 静默后，按 G-A/G-B → G-D → G-E → G-C 顺序逐组提交；提交前补 G6 裁定与 acc-002 证据。