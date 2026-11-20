# E1–E5 测试环境清单（rc.5 P5 / T46–T48）

生成时间：2026-11-20（宿主 macOS arm64；Docker 29.7.2 / Compose v5.3.1）
镜像：`eterna-agent:rc5-test` = `sha256:5b10f5136403…`，788,730,104 B（752.2 MiB）
准备脚本：`scripts/prepare-rc5-envs.mjs`（幂等；只写 `$HOME/eterna-data/test-rc5` 与测试容器）
验证脚本：`scripts/verify-rc5-env.mjs`、`scripts/verify-mcp-personal.mjs`、
`scripts/verify-terminal-guard.mjs`、`scripts/verify-chat-import.mjs`、
`scripts/verify-acp-stdio.mjs`、`scripts/verify-data-root.sh`、`scripts/soak-rc5.mjs`

> 铁律：E1/E3/E5 全部独立容器与独立数据根；生产容器 `eterna-agent`（3210）与生产数据根
> `$HOME/eterna-data/super` 不在任何准备/验证命令的写路径上。凭据只存在于 0600
> 测试 env 与 `$HOME/eterna-data/test-rc5/.test-accounts.json`（均不在仓库内）。

## 1. 环境矩阵

| 环境 | 用途 | 项目 / 容器 | 端口 | 数据根 | env 文件 | 状态 |
|---|---|---|---|---|---|---|
| E1 | 隔离 web（BOOT/MCPS/MCPP/TERM/IMP/OFF/CMD/HERO） | `rc5-test-e1` / `eterna-rc5-e1` | 3108（relay 9311） | `$HOME/eterna-data/test-rc5/e1` | `.env.e1`（0600） | healthy，账号已播种 |
| E2 | 三账号 + 三工作区（隔离/UI） | 复用 E1 | 3108 | 同上 | 同上 | admin + user_b + user_c 均可登录、各有工作区 |
| E3 | super 形态（workbench/tasks/terminal） | `rc5-test-e3` / `eterna-rc5-e3` | 3109（relay 9312） | `$HOME/eterna-data/test-rc5/e3` | `.env.e3`（0600） | healthy，`ETERNA_FORM=super`，profile=`eterna-super` |
| E4 | ACP stdio（按需 `compose run --rm -T`，不常驻） | `rc5-test-e4` / `eterna-rc5-e4`（run 时） | 无端口 | `$HOME/eterna-data/test-rc5/e4` | `.env.e4`（0600） | 数据根就绪；`compose --profile acp config` exit 0 |
| E5 | 迁移副本（旧卷 → 新根） | 不常驻（数据轨） | — | `$HOME/eterna-data/test-rc5/e5` | 复用 `.env.e1` 语义 | 冷备已解包并 `rsync -aH` 副本；DATA-004 实测通过 |

E1 override（脚本生成，0600）：`$HOME/eterna-data/test-rc5/.compose.e1.override.yml`
—— 夹具只读挂载 `/fixtures` + `ETERNA_MCP_*` 变量（compose 主文件未接这些变量，
见遗留项 `W5-COMPOSE-MCP`）。

## 2. 账号矩阵（口令不落证据）

| 角色 | 账号 | 工作区 |
|---|---|---|
| A（admin） | `rc5admin` | `7439e2fd-4920-44b0-8fb2-b2bf80790427` |
| B（user） | `rc5userb` | `adf1e03e-505e-468b-b1b0-9ebc31f5e1a4` |
| C（user） | `rc5userc` | `d50c1c6b-58d9-4f07-8368-df994fa1acc0` |

口令与 MCP master key：`$HOME/eterna-data/test-rc5/.test-accounts.json`（0600，不入仓、不入证据）。
E2 证据：`prepare/e2.log`（PASS=10 FAIL=0）。

## 3. 复现命令（原文与 EXIT 见各目录 `cmd.log`）

```bash
# E1（新建/修复幂等）：env + 数据根 + compose up + 健康等待 + 账号播种
node scripts/prepare-rc5-envs.mjs e1

# E2：三账号/三工作区校验（复用 E1）
node scripts/prepare-rc5-envs.mjs e2

# E3：独立 super 容器（3109）
node scripts/prepare-rc5-envs.mjs e3

# E4：ACP 数据根 + compose --profile acp config
node scripts/prepare-rc5-envs.mjs e4

# E5：冷备 .tgz → staging（拒绝绝对路径/.. 逃逸）→ rsync -aH → e5
node scripts/prepare-rc5-envs.mjs e5 \
  --source "$HOME/eterna-data/backups/rc5-2026-11-20/eterna-home-20261120-021802.tgz"

# 迁移副本硬链接/大小复核（DATA-004 实测）
bash scripts/verify-data-root.sh \
  --root "$HOME/eterna-data/test-rc5" --instance e1 \
  --container eterna-rc5-e1 --env-file "$HOME/eterna-data/test-rc5/.env.e1" \
  --migration-source "$HOME/eterna-data/test-rc5/.e5-cold/eterna-home-20261120-021802" \
  --migration-dest "$HOME/eterna-data/test-rc5/e5" \
  --json artifacts/rc5/p5/testbed/data-root/report-migration.json
```

E5 实测：`files=8620 bytes=108848480 linkGroups=3148` 源/副本完全一致（EXIT=0）。
E5 staging 归档清单 10,466 项，越界项 0。

## 4. 镜像断言（T48，EXIT=0 → `env-runtime/report.json`）

| 断言 | 结果 |
|---|---|
| `dsh --version` | `0.2.2-rc.5` |
| symlink realpath | `/usr/local/lib/node_modules/@deepseek-ai/dsh/lib/bin.js` |
| realpath 父目录包清单 | `0.2.2-rc.5`；`dsh-mcp-client` `0.2.2-rc.5`（同版） |
| `node -v` | `v24.22.3`（≥24.9.0；根 `engines.node` = `>=24.9.0`） |
| v1 剥离 | `/repo` 下 `core/`、`basis.yml`、6 个 @basis 包全部 absent |
| 夹具不进镜像 | `/repo/tests/fixtures` absent（当前镜像） |
| OFF-004 字体 | Noto Sans CJK / Liberation / DejaVu 三族均命中（10/16/6） |
| OFF-005 Python | `python3` 可 import `docx 0.8.11` / `openpyxl 3.0.9` / `pptx 1.0.2` |
| `flock` | `/usr/bin/flock` 存在（entrypoint 渲染锁） |
| compose config | exit 0；`/data` bind → `$HOME/eterna-data/test-rc5/e1` |

运行方式（`docker run --rm --network none`，不挂宿主目录）：

```bash
node scripts/verify-rc5-env.mjs --api-static \
  --runtime-image eterna-agent:rc5-test \
  --compose-env-file "$HOME/eterna-data/test-rc5/.env.e1" \
  --json artifacts/rc5/p5/testbed/env-runtime/report.json
```

## 5. 夹具（`tests/fixtures/**`；不进镜像）

| 夹具 | 用途 | 体量 |
|---|---|---|
| `mcp-fixture-core.mjs` / `mcp-echo-server.mjs` | stdio MCP（echo 工具，NDJSON 帧） | 协议核心共享 |
| `mcp-http-server.mjs` | 本地 Streamable HTTP MCP（`POST /mcp`，`mcp-session-id`） | 单文件 |
| `chat-import/generate.mjs` + `deepseek-export-11.zip` | DeepSeek 导出 **zip v3**（10 有效 + 1 坏 JSON；含约 6 MB 超大会话） | 62,335 B / 13 entries |
| `chat-import/sessions-10.ndjson` | 10 会话 + 1 坏行的 NDJSON 旁证 | ≈6 MB |
| `office/generate.py` + `sample.docx/.xlsx/.pptx` | 中文三格式样本（已用 python-* 与 soffice 回读验证） | 37,198 / 5,174 / 29,521 B |
| `long-process.sh` | 长驻心跳进程（SIGTERM 干净退出），供 TERM-013 | — |

E1 内探针：`docker exec eterna-rc5-e1 test -f /fixtures/long-process.sh` → 存在（只读挂载）。
镜像内 `libreoffice-kit`（WASM 引擎，`backend=wasm`）对三格式样本转换全部成功：
docx 1 页 / xlsx 1 页 / pptx 2 页，`missingFonts` 分别 `[]` / `["Calibri"]` / `["Arial"]`
（证据 `office-probe.log`）。系统 `soffice` 未装**不是**缺陷：Linux 走 WASM 引擎。
**注意**：当前镜像因构建早于夹具创建而不含夹具；`.dockerignore` 仍缺 `tests/`，重建镜像会
把 6 MB 夹具带进镜像（遗留项 `W5-DOCKERIGNORE-TESTS`）。

## 6. 24h 浸泡（P5 起跑，P6 收口）

| 项 | 值 |
|---|---|
| startedAt | `2026-11-19T21:45:37.331Z`（本地 2026-11-20 05:45:37） |
| plannedEnd | `2026-11-20T21:45:37.331Z`（24h） |
| 脚本 | `scripts/soak-rc5.mjs`（后台 PID 记录在 `soak/soak.pid`） |
| TERM-013 日志 | `artifacts/rc5/p5/testbed/soak/term-013-24h.jsonl`（60s 采样：dsh PID/fd/RSS/Threads/长进程数/churn） |
| DATA-009 日志 | `artifacts/rc5/p5/testbed/soak/data-009-24h.jsonl`（5min：3 库 integrity/journal/WAL/SHM/sessions + 2 并发 session/create + `database is locked` 计数） |
| 控制台 | `artifacts/rc5/p5/testbed/soak/soak-24h.log` / `console-24h.log` |
| 摘要 | 窗口满后由脚本写 `summary-24h.json`；**未满窗口只作进度证据，不得判通过** |

T+1min 首读：3 库 `integrity=ok`、`journal=wal`、写 2/2 成功、锁命中 0；dsh fd=69、RSS≈573 MiB、Threads=11。
判据口径（脚本内）：启动 1h 为预热；比较 [1h,2h) 基线中位数与最后 30min 中位数
（fd 增长 ≤4 且预热后极差 ≤8；RSS 增长 ≤ max(24 MiB, 8%)）。窗口未满一律 NOTRUN。
TERM-013 的 `terminal/create` churn 每轮失败（rc.5 服务端 `gateway/internal:
session.snapshotEvents is not a function`），摘要会将该子项标 FAIL；attach 需 P6 WS 客户端。

> 两次起跑记录：21:32 的首跑用于验证采样链路；21:45 用最终判据重起（当前有效），
> 旧日志归档在 `soak/prestart-aborted/` 与 `soak/prestart-2/`，不参与 24h 判定。

## 7. P6 交接清单

- [ ] P6a 在 E1 跑 BOOT/MCPS/MCPP(live)/TERM(WS attach)/IMP/OFF/CMD/HERO；E2 双账号浏览器；E3 super；E4 ACP。
- [ ] P6b 收口 24h：确认 `window.complete=true`、TERM fd/RSS 曲线平稳、DATA 无锁/WAL 异常。
- [ ] 处理 P0：terminal unary 跨租户泄漏（B 用 A 的 sessionId 拿到 A 的 cwd/shells）。
- [ ] 处理 `terminal/create` 服务端内部错误（churn/attach 的前置）。
- [ ] 修正 `.dockerignore`（`tests/`、`artifacts/`）后再重建镜像，重跑本清单 §4 的「夹具不进镜像」。
- [ ] compose 主文件补 `ETERNA_MCP_MASTER_KEY/PERSONAL_*`（当前仅 E1 override 注入；生产会 fail-closed）。
- [ ] 生产反代 512MiB/读超时（IMP-007/010）在 E6 单独验证。