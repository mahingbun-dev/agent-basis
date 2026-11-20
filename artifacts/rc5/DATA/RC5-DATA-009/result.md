# RC5-DATA-009 · 24h SQLite/terminal 浸泡（窗口未满 → NOTRUN）

- 依据：51 §3.14 DATA-009；48 §4.5（macOS FUSE 前置门禁：≥50 会话并发、持续 24h、
  每 2h 全库 integrity_check、观察 `SQLITE_BUSY`/`database is locked`）；54 §3.5（P5 起跑、P6b 收口）
- 状态：**NOTRUN —— 已采样 0.67h / 24h，窗口未满，不得判绿**
- 窗口：`startedAt=2026-11-19T21:45:37Z`，`plannedEndAt=2026-11-20T21:45:37Z`（剩余 ~23.33h）
- 进程：PID 56706，`node scripts/soak-rc5.mjs --suite both --duration 24h --interval 60s
  --db-interval 5m --writers 2 --container eterna-rc5-e1 --data-root ~/eterna-data/test-rc5/e1`
  —— 由 P5 lane 按 54 §3.5 起跑，本 lane 接管观测/归档
- 采样写盘：`artifacts/rc5/p5/testbed/soak/`（本 lane 只读，不修改）；快照已复制到本目录与
  `artifacts/rc5/p6b/soak/`

## 已采样窗口（`window.json`）

| 项 | 值 |
|---|---|
| DATA 采样 tick | 9（5min/次） |
| 全库 integrity ok 的 tick | 9/9（逐库 `PRAGMA integrity_check`） |
| 并发写（2 writers） | 18 成功 / 0 失败 |
| `database is locked` / `SQLITE_BUSY` 日志命中 | 0 |
| WAL 相关异常命中 | 0 |
| WAL 库 | `access/users.db`、`.eterna/memory.sqlite3`、`knowledge-admin/access.sqlite3`（后者 delete 模式） |
| 最后会话行数 | 136 |
| TERM 采样 tick | 41（60s/次）；fd 69→88（min 69 / max 88）；RSS 586,976→298,072 KB |
| TERM churn 失败 tick | 41/41（rc.5 `terminal/create` 已知服务端错误 `session.snapshotEvents is not a function`，非本 case 判据） |

## 断言（6/6 PASS，全部是「窗口未满」口径）

| 断言 | 实测 |
|---|---|
| 窗口未满 24h（`complete=false`，不得标绿） | False |
| 采样 tick 数 > 0 | 9 |
| 已采样窗口内 integrity 全 ok | 9/9 |
| 已采样窗口内无写失败 | 0 |
| 已采样窗口内 lock 命中 0 | 0 |
| 已采样窗口内 WAL 异常 0 | 0 |

## 与 48 §4.5 口径的差距（必须随 NOTRUN 一起记）

| 48 §4.5 要求 | 现行浸泡实际 | 差距 |
|---|---|---|
| 注入并发读写（**≥50 会话**，持续 24h） | `--writers 2`；会话存量 136 但并发写只有 2 | 并发强度不足 |
| 每 **2h** 对**全库**（含 workspaces/*/.eterna/*.sqlite3）跑 integrity_check | 每 5min 检 3 个库（access/users.db、.eterna/memory.sqlite3、knowledge-admin/access.sqlite3） | 库覆盖少 14 个 |
| 观察 `SQLITE_BUSY`/`database is locked` | 每 5min 扫日志匹配数（0） | 口径一致 |
| 24h 窗口 | 0.67h | 未满 |

因此即便满窗，现行 soak 也只能证明「3 库 + 2 写者」；48 §4.5 的全库/≥50 会话门禁需另跑
（建议用本 lane 的 `_tools/check-sqlite.mjs` 做 2h 全库巡检，并把 writers 提到 ≥50 的会话级并发）。

## 结论

**NOTRUN**。已采样窗口（~40min）内无锁异常、WAL 异常、写失败，integrity 每 tick 全 ok；
但 24h 窗口未满，按 54 §6.3 纪律**不得判通过**；且现行 soak 的并发/全库覆盖未达 48 §4.5 口径。
满窗由 P6b 收口（脚本会在满窗时写 `summary-24h.json` 并给 verdict）。补一条独立佐证：同宿主 bind 上的
8×200 并发 WAL + kill -9 恢复测试见 `../FUSE/wal-bind.json`（0 busy、integrity ok）。

## 证据

- `window.json`（窗口计算与 verdict）
- `data-009-24h.snapshot.jsonl`、`term-013-24h.snapshot.jsonl`、`console-24h.snapshot.log`、
  `soak-24h.snapshot.log`、`meta-24h.json`
- `cmd.log`（进程存活/ps 输出 + 断言）