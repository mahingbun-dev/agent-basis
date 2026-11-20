# rc.5 测试基座 · 结果汇总（P5 / T46–T48）

生成：2026-11-20。所有命令都在 worktree `/Users/sunny/code/agent-basis-rc5` 执行；
每条命令原文与退出码见各目录 `cmd.log`，完整断言见 `report.json` / `run.log`。
镜像：`eterna-agent:rc5-test`（`sha256:5b10f5136403…`，752.2 MiB）。
环境：E1（3108，`eterna-rc5-e1`）、E3（3109，super）、E4（ACP 按需）、E5（迁移副本）；
详见 `E1-E5-checklist.md`。

## 1. 六个脚本

| 套件 | 脚本 | EXIT | 结果 | 证据 |
|---|---|---|---|---|
| ENV / T48 | `scripts/verify-rc5-env.mjs --api-static --runtime-image …` | 0 | 10 sections PASS（含 API-008/009 静态、镜像运行时、字体/Python、compose config） | `env-runtime/{cmd.log,run.log,report.json}` |
| MCPP | `scripts/verify-mcp-personal.mjs` | 0 | PASS=15 FAIL=0 SKIP=7 | `mcp-personal/{cmd.log,run.log,report.json}` |
| TERM | `scripts/verify-terminal-guard.mjs` | 1 | PASS=5 **FAIL=4** NOTRUN=3 | `terminal-guard/{cmd.log,run.log,report.json}` |
| IMP | `scripts/verify-chat-import.mjs` | 0 | PASS=8 FAIL=0 SKIP=4 | `chat-import/{cmd.log,run.log,report.json}` |
| ACP | `scripts/verify-acp-stdio.mjs` | 0 | PASS=6 FAIL=0 NOTRUN=1 | `acp-stdio/{cmd.log,run.log,report.json}` |
| DATA | `scripts/verify-data-root.sh`（+ E5 迁移源/副本参数） | 0 | PASS=6 FAIL=0 NOTRUN=0（DATA-004 实跑） | `data-root/{cmd.log,run.log,report.json,cmd-migration.log,run-migration.log,report-migration.json}` |

补充：`soak-smoke/` 是 `scripts/soak-rc5.mjs` 的 10–20s 冒烟验证（用于确认采样/记账
逻辑与 24h 主跑一致；其 verdict 不代表 24h）。

## 2. 关键结论

- **镜像断言全绿**：`dsh --version=0.2.2-rc.5`、`node v24.22.3`、realpath
  `…/@deepseek-ai/dsh/lib/bin.js`、`dsh-mcp-client` 同版、v1 剥离（core/、basis.yml、
  6 包）、字体三族、Python 三库、`flock`、`/data` bind；当前镜像 `tests/fixtures` absent。
- **MCPP 全绿**：目录/自填限制、serverName 隔离、A/B 同名不覆盖、metadata IP 拒绝、
  header secret AES-GCM 落库且 list 只回 `hasSecret`、8/256KB 上限（本轮未开 `--full`）等。
- **IMP 全绿**：未登录 401、跨工作区 403、10 会话导入、DB owner/行数、B 可见 A 不可见、
  坏 JSON 跳过。归档夹具是真实 **zip v3**（51 号 §1 的「NDJSON」只对应响应进度流）。
- **ACP 全绿**：initialize 协议 1、session/new、stdout 纯 JSON-RPC（5 帧 0 污染）、
  非法 JSON -32700 后仍存活、无应用监听端口；prompt 因测试占位 key 记 NOTRUN。
- **DATA 全绿**：数据根 0700/幂等、`/data` bind、DSH_HOME/DSH_AGENTS_HOME、E5 副本
  `files=8620 bytes=108848480 linkGroups=3148` 与冷备源一致。
- **OFF 转换链可用**（镜像内 `libreoffice-kit` WASM 引擎，不依赖系统 soffice）：
  `libreoffice-kit createConverter().convert()` 对三格式样本全部成功
  （docx 1 页 / xlsx 1 页 / pptx 2 页，中文无乱码）；`missingFonts` 为
  docx `[]`、xlsx `["Calibri"]`、pptx `["Arial"]`（西文声明字体未装）。
  证据：`office-probe.{cmd.log,log}`。

## 3. P0 发现：terminal unary 跨租户未隔离

复现（E1，A=rc5admin，B=rc5userb）：A 建会话后，B 用 **A 的 sessionId** 调
`terminal/environment` / `terminal/shells`：

- B 收到 A 的 `cwd=/data/workspaces/rc5admin` 与 `[{path:/bin/bash,…}]`；
- `terminal/list` 未被拒绝（A/B 均 `[]`），`terminal/close` 返回 ok（no-op）；
- 根因：`packages/access/src/terminal.ts:72` 的守卫只在
  `principal.kind === 'eterna-user'` 时生效——HTTP unary 请求的 principal 不是该形态，
  直接放行；WS mux 面有 principal，故此前只在 WS 侧验证过。
- 影响：任意已登录用户可读/操作他人终端环境（信息泄漏 + 潜在会话劫持面）。
- 证据：`terminal-guard/report.json`（TERM-004a/b/c/e FAIL，detail 含脱敏值）。

附带服务端错误（同套件 TERM-004d/f NOTRUN）：`terminal/create` 对 A 自己的会话也返回
`gateway/internal: session.snapshotEvents is not a function`；修复前 attach/close churn
无法作为隔离判据，24h 浸泡的 churn 子项会持续记 FAIL。

## 4. 24h 浸泡

| 项 | 值 |
|---|---|
| startedAt / plannedEnd | `2026-11-19T21:45:37.331Z` / `2026-11-20T21:45:37.331Z` |
| 进程 | `soak/soak.pid`（`nohup node scripts/soak-rc5.mjs … --tag 24h`） |
| TERM-013 | `soak/term-013-24h.jsonl`（60s：fd/RSS/Threads/长进程数/churn） |
| DATA-009 | `soak/data-009-24h.jsonl`（5min：3 库 integrity/WAL/SHM、2 并发 session/create、锁计数） |
| 摘要 | `soak/summary-24h.json`（窗口满才写 PASS/FAIL；未满一律 NOTRUN + `window.complete=false`） |

起跑后 1 分钟首读：3 库 `integrity=ok`、`journal=wal`、写 2/2、锁命中 0；
dsh `fd=69`、`RSS≈573 MiB`、`Threads=11`。**当前窗口未满，不得当作 24h 通过**。
判据：启动 1h 预热，之后 [1h,2h) 基线中位数 vs 末 30min 中位数（fd 增长 ≤4、
极差 ≤8；RSS 增长 ≤ max(24 MiB, 8%)）；窗口未满一律 NOTRUN。

## 5. 遗留项

见 LaneReport `leftovers`；其中阻断性最高的是 `W5-TERM-P0`（terminal 跨租户泄漏）
与 `W5-TERM-CREATE`（terminal/create 内部错误）。