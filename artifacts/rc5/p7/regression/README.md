# T52 · 回归复跑与已知问题签字（rc.5 / P7）

- 任务：T52（54 §4.9 / §11；51 §6.1）
- 工作树：`/Users/sunny/code/agent-basis-rc5`，分支 `feat/dsh-rc5-merge`，HEAD `c75f876`
- 窗口：2026-11-20T01:34Z → 01:58Z（本轮）
- 证据根：`artifacts/rc5/p7/regression/**`（本目录）；产品代码零改动
- 边界：未 `git push/merge`；未停/改生产容器（`eterna-agent` 未触碰，StartedAt 仍为 2026-11-19T17:21Z）；未写 deepseek-harness；未碰 `/Users/sunny/code/agent-basis`；未 `reset/clean/stash`；凭据不落盘/日志/argv；证据已脱敏（见 `SANITIZE.md`，累计 11 处）

## 0. 结论（先读）

| 项 | 结果 |
|---|---|
| P0 用例（51 §3，共 97） | **PASS 68 / FAIL 9 / MISSING 1 / NOTRUN 4 / 未复跑 15** |
| P0 红线 | **9 条 FAIL + 1 条 MISSING + 4 条 NOTRUN 未清零 → 按 51 §6.1 不得判绿、不得进生产窗口** |
| 新红线（W5 PASS → 本轮 FAIL） | **RC5-ENV-004**（当前 `eterna-agent:rc5-test` 镜像含 `tests/fixtures`，6.0M） |
| 语义变化红（W5 PASS → 本轮 FAIL） | **RC5-TERM-008**（伪造 sessionId 的 `terminal/list` 由空列表变为 `remote-access/denied`；无枚举泄漏，属 fail-closed 收紧） |
| P1 | 未全量复跑；47 项列入签字表（产品签字或已知问题），不冒充全绿 |
| 12 行回归矩阵 | 4 行绿 / 5 行红 / 4 行带缺口绿（含补充行共 13 行；红=登录/会话、文件（读面）、市场（管理面）、知识库、多租户全链），见 `regmatrix.md` |
| 补充回归面 | 审计 jsonl 绿；治理 ask/deny 决策卡与 companion 实连接未执行（NOTRUN，待产品签字） |

> **停线口径**：本轮 P0 红 14 条（9 FAIL + 1 MISSING + 4 NOTRUN），其中 13 条为 W5 已登记问题或环境缺失、**ENV-004 为本轮新红**（镜像夹具）；P0 未清零。按 54 §8.3「W5 的 P0 红必须停线」，**T52 判定：回归复跑完成，整体不可判绿，停线**。

## 1. 本轮实跑环境（与 W5 对齐）

| 项 | 值 |
|---|---|
| 镜像 | `eterna-agent:rc5-test` = `sha256:48782afaf8ba665e3ec3ea0995c8f5b3e844ebad764e03f34c281b14e48389d3`（p6a 修复后构建） |
| E1 套件容器 | `rc5-e1suite`（项目 `rc5-e1suite`，端口 3118，数据根 `$HOME/eterna-data/test-20261120/e1`）本轮以当前镜像重建 |
| E2 套件容器 | `rc5-e2suite`（项目 `rc5-e2suite`，端口 3119，数据根 `.../e2`）本轮以当前镜像重建 |
| E3 容器 | `eterna-rc5-e3`（项目 `rc5-test-e3`，端口 3109，数据根 `$HOME/eterna-data/test-rc5/e3`）本轮以当前镜像重建 |
| E4 ACP | `docker compose -p rc5-test-e4 --profile acp run --rm -T --no-deps eterna-agent-acp` |
| 生产容器 | `eterna-agent`（3210）：**未 start/stop/exec**；只读 inspect 基线 |
| 24h 浸泡容器 | `eterna-rc5-e1`（3108）：**未重启**；本轮仅只读 `docker exec`（API harness 用独立 `DSH_HOME=/tmp/api-run-home`），浸泡 tick 持续 |

> 重建的是**测试容器**（独立项目/端口/数据根），不是生产容器；E1/E2 容器在 W5 结束后已退出，本轮按原 compose/env 以当前镜像重建，命令见 `rerun/logs/`。

## 2. 复跑方式（可复核）

套件脚本从 `artifacts/rc5/{E1,E2,e3-super}` **只读复制**到 `rerun/` 后运行，仅改以下常量，逐文件 diff 见 `harness-diff.md`：

1. `REPO` / `rc5-test-client` 导入改为绝对路径（复制品位置变化）；
2. `LANE.evidenceRoot` 指向本目录（保证不覆盖 W5 证据）；
3. `LANE.imageId` 更新为当前镜像 ID；
4. E1/TERM 的 TERM-004 聚合由写死 `FAIL` 改为按 6 个断言计算（W5 修复后原写死值已过期；权威判定仍是 `verify-terminal-guard.mjs` 报告）。

**未改任何断言口径/期望值**；除上述常量外，套件逻辑与 W5 相同。

| 套件 | 命令（原文见日志） | EXIT | 结果 |
|---|---|---:|---|
| E2/ACC | `node artifacts/rc5/p7/regression/rerun/E2/ACC/run.mjs` | 0 | PASS 8 / FAIL 2（ACC-006/008） |
| E2/SEC | `node .../rerun/E2/SEC/run.mjs` | 0 | PASS 4 / FAIL 2 / SKIP 1 |
| E2/MCPP | `node .../rerun/E2/MCPP/run.mjs` | 0 | PASS 16 / SKIP 8（含 023 受控复测 PASS） |
| E2/TERM | `node .../rerun/E2/TERM/run.mjs` | 0 | PASS 11 / FAIL 2 / SKIP 3 |
| E1/BOOT | `node .../rerun/E1/BOOT/run.mjs` | 0 | PASS 11（BOOT-007 为空集假绿，改判 MISSING） |
| E1/MCPS | `node .../rerun/E1/MCPS/run.mjs` | 0 | PASS 4 / FAIL 1 / SKIP 5 / NOTRUN 1 |
| E1/TERM | `node .../rerun/E1/TERM/run.mjs` | 0 | PASS 3 / SKIP 11（004 已绿；套件在 005 静态项后未继续） |
| E1/IMP | `node scripts/verify-chat-import.mjs ... --workspace-id 6fd0ca27…` | 1 | PASS 7 / FAIL 1（005 即时读为记账延迟）+ 轮询探针 PASS |
| E3 | `node .../rerun/E3/run-suite.mjs <case>` ×21 + `--summary` | 1 | PASS 10 / FAIL 3 / NOTRUN 8 |
| E4/ACP | `node scripts/verify-acp-stdio.mjs ...` | 0 | PASS 6 / NOTRUN 1（002b 模型 401） |
| E0 静态 | `bash artifacts/rc5/p7/regression/run-e0-static.sh` | 1 | 仅 SEC-002 红 |
| ENV 运行时 | `node scripts/verify-rc5-env.mjs --runtime-image eterna-agent:rc5-test --json ...` | 1 | **ENV-004 红（fixtures 进镜像）** |
| API harness | `bash artifacts/rc5/p7/regression/run-api-harness.sh` | 0 | `ok=true`，回执 2/2 completed |
| API/SEC 单测 | `bash artifacts/rc5/p7/regression/run-api-sec-verify.sh` | 0 | API-001 241 / API-002 504 / API-004 864；全仓 38 包 4193 tests |
| DATA 快检 | `bash artifacts/rc5/p7/regression/run-data-quick.sh` | 0 | DATA-001/002/003/006/007 绿 |
| OFF 探针 | `bash artifacts/rc5/p7/regression/run-off-probe.sh` | 0 | docx/xlsx/pptx 三格式转换成功（wasm） |

> 套件 runner 设计上以 `summary.json` 承载判定，进程退出码恒 0；本表 EXIT 与判定分列，不用 EXIT=0 冒充全绿。

## 3. P0 对照与签字

- 逐条对照：`P0-comparison.md` / `P0-comparison.json`（97 行，W5 vs 本轮）
- 签字表：`signoff.md`（P0 红项、P1 未复跑项、四方签字栏）
- 遗留项：`leftovers.md`（`id|现象|级别|建议`）

### 3.1 本轮 P0 红/缺口（14 条）

| case | W5 | 本轮 | 摘要 |
|---|---|---|---|
| RC5-ENV-004 | PASS | **FAIL（新）** | 运行时探针 `/repo/tests/fixtures=present`（6.0M：chat-import zip、mcp 夹具）→ 违反「夹具不进镜像」 |
| RC5-ACC-006 | FAIL | FAIL | B 普通用户 `mcpManager/probe|restart` 仍 `200/ok=true` |
| RC5-ACC-008 | FAIL | FAIL | B 用 A 的 workspaceId 读 `workspaceFiles/list|stat|read` 未拒，A 文件内容泄漏 |
| RC5-SEC-004 | FAIL | FAIL | 同 ACC-008（跨租户文件面） |
| RC5-SEC-005 | FAIL | FAIL | 同 ACC-006（管理面 unary 可达） |
| RC5-MCPS-006 | FAIL | FAIL | 普通用户 restart/probe 系统 MCP `200/true` |
| RC5-TERM-006 | FAIL | FAIL | A 自己 9 动作：create/rename/retain 失败（`session.snapshotEvents is not a function` / terminal unavailable） |
| RC5-TERM-008 | PASS | **FAIL（语义变化）** | 伪造 sessionId 的 `terminal/list` 由 `ok=true []` 变为 `remote-access/denied`；无枚举泄漏，但断言按旧语义判红 |
| RC5-SEC-002 | FAIL | FAIL | 跟踪文件疑似口令字面量 14 命中/7 文件（docs 1 + access tests 9 + team-platform-gates 4） |
| RC5-BOOT-007 | MISSING | MISSING | `--dump-default-config` 仍 `EXIT=1 / 0 bytes`；runner 空集 PASS 不成立 |
| RC5-MCPS-003 | MISSING | NOTRUN | 需真实模型回合；E1 无 LLM 凭据 |
| RC5-TERM-002 | MISSING | NOTRUN | 需浏览器键盘实测；create P1 阻断活终端 |
| RC5-TERM-012 | MISSING | NOTRUN | 套件中止；E3 亦未执行 |
| RC5-ACP-002 | PASS | NOTRUN | `session/prompt` 模型 401（E4 占位 key）；W5 曾 200/end_turn（stub 口径），需产品确认口径 |

其余 4 条 NOTRUN：MCPS-003、TERM-002、TERM-012、ACP-002（上表已含）；未复跑 15 条见 `signoff.md` §3。

## 4. 12 行回归矩阵抽样（51 §5 / 54 §5.5）

见 `regmatrix.md`：登录/会话、对话/流式、文件、任务/子代理、记忆、压缩、工坊、市场、用量、工作台、知识库、多租户 + 部署/数据补充行。**5 行红**（登录/会话、文件（读面）、市场（管理面）、知识库、多租户全链），4 行绿，4 行带缺口绿（SKIP/NOTRUN 已列签字表）。

## 5. 补充回归面（54 §5.5）

原始数据：`supplement/supplement.json`。

| 面 | 结果 | 证据 |
|---|---|---|
| 审计 jsonl | 绿：两文件 790 行，本轮窗口 117 行、12 类事件；未发现凭据值（2 条命中为 server 名 `secret-b`，非值） | `supplement/supplement.json`、SEC-006 行 |
| 治理规则 | 规则文件在位（7839 B，`default: allow` 为 2026-11-19 拍板）；**ask/deny 各一例未执行**（需模型回合+浏览器决策卡） | 同上 |
| companion/浏览器执行面 | 路由绿：匿名 401 / 管理员 200，guideUrl 在；**扩展连接与 `mcp__browser__*` 未执行**（需真实浏览器+模型） | 同上 |

## 6. 证据索引

| 路径 | 内容 |
|---|---|
| `P0-comparison.md` / `.json` | P0 97 条 W5↔本轮对照 |
| `signoff.md` | P0/P1 签字表与四方签字栏 |
| `leftovers.md` | 遗留项（id/现象/级别/建议） |
| `regmatrix.md` | 12 行回归矩阵 |
| `harness-diff.md` | 套件复制品与原件的逐文件差异 |
| `run-*.sh` / `build-comparison.mjs` / `sanitize.mjs` | 复跑与合并、脱敏脚本（可重放） |
| `rerun/logs/**` | 每个套件/脚本的 `$ 命令` 与 `EXIT` 原文 |
| `rerun/E1|E2|E3|E4/**/<case>/` | 用例级 `cmd.log` + `result.md`/`report.json`/`summary.json` |
| `rerun/E0/verify-rc5-env-runtime.json` | ENV-004/005/006、OFF-004/005 运行时断言 |
| `rerun/API/out/results.json` | API-005/006/007 容器内 harness 结果 |
| `supplement/supplement.json` | 审计/治理/companion |
| `SANITIZE.md` / `SANITIZE-HISTORY.md` | 脱敏清单：累计 11 处标记 / 11 文件；本轮幂等复核 0 新增（多轮记录见 HISTORY） |
| `w5-baseline/` | W5 基线快照（矩阵、E2/E3 summary） |