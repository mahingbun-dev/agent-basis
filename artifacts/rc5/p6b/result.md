# P6b 数据轨 · E5 迁移与 24h 浸泡（LaneReport 正文）

- 任务：T51（54 §4.8）；用例 51 §3.14 DATA-001..010；方案 48 §7–§10；浸泡安排 54 §3.5
- 工作树：`/Users/sunny/code/agent-basis-rc5`，分支 `feat/dsh-rc5-merge`，HEAD `02f4857`
- 镜像：新 `eterna-agent:rc5-test` = `sha256:99d8e85b509b`；旧（回滚点）`eterna-agent:0.1.51` = `sha256:3ca0d6605589`
- 数据源：生产冷备 `$HOME/eterna-data/backups/rc5-2026-11-20/eterna-home-20261120-021802.tgz`
  （P0 活卷 tar，sha256 `5976686f…d281`，10,466 条目）——只读；**生产容器/生产卷零接触**

## 1. 结果总表

| 用例 | 状态 | 断言 | 一句话 |
|---|---|---|---|
| RC5-DATA-001 新宿主目录 | PASS | 11/11 | init-data-dirs 幂等；根/实例/16 子目录 0700；4 条负控全拒 |
| RC5-DATA-002 /data bind | PASS | 7/7 | E1 `/data`→`test-rc5/e1`（bind,rw）；compose config 命中；漏挂拒启 EXIT=1 |
| RC5-DATA-003 DSH_HOME | PASS | 1/1 | 容器内 `/data` |
| RC5-DATA-004 迁移副本 | PASS | 4/4 | 两遍迁移统计全等：8620 文件 / 108,848,480 B / 3148 硬链接组 / 352 符号链接 |
| RC5-DATA-005 integrity 全库 | PASS | 1/1 聚合 | 4 份副本 + rc.5 启动后：每份 17 库 `ok` |
| RC5-DATA-006 DSH_AGENTS_HOME | PASS | 3/3 | `/data/agents`，容器+宿主均存在 |
| RC5-DATA-007 重启数据全在 | PASS | 20/20 | 生产副本起 rc.5：用户 2/会话 145/工作区 3/记忆 12+24/任务 1/工坊 353/relay token 全在；重启前后一致 |
| RC5-DATA-008 备份恢复 | PASS | 15/15 | 冷备 stop→tar→start；删 marker→空目录恢复：5428 文件清单一致、16 库 ok |
| RC5-DATA-009 24h 浸泡 | **NOTRUN** | 采样 6/6 | 观测 0.67h/24h；采样内 0 锁/0 WAL 异常/写 18 成功/integrity 9/9 ok；**窗口未满不得判绿** |
| RC5-DATA-010 回滚演练 | PASS | 17/17 | 旧镜像 0.1.51 + 旧卷副本可用（login 200/me 401/relay 200/17 库 ok）；切回 rc.5 无二次损坏 |
| FUSE 声明检查 | PASS | 5/5 | bind=virtiofs/fuseblk；chmod 落宿主、chown 不生效；flock 互斥；8×200 WAL 0 BUSY + 崩溃恢复 ok |

合计：10 PASS / 1 NOTRUN / 0 FAIL；90 条断言 PASS、0 FAIL（其中 DATA-009 的 6 条只证明「已采样窗口」口径，
该 case 整体仍判 NOTRUN）。

## 2. 关键实测

### 2.1 迁移两遍（DATA-004）

- 安全清单：10466 条目，绝对路径/`..` 越界 0
- `tar xzf`（staging）→ `rsync -aH`（保留硬链接）→ 统计：
  - 每一遍：`files=8620 bytes=108,848,480 linkGroups=3148 symlinks=352`，与 staging **逐项相等**
  - 两遍之间、以及与 P5 既有 E5 副本之间也逐项相等
- `cp -a` 在 macOS 不保硬链接的陷阱已绕开（统一 `rsync -aH`）

### 2.2 全库完整性（DATA-005）

17 个 SQLite 库/份：9 个 `wal`（含 `access/users.db`、`.eterna/memory.sqlite3`、
`workspaces/Mr.Ma/.eterna/memory.sqlite3`、`tasks.sqlite3`）、8 个 `delete`
（含 `knowledge-admin/access.sqlite3`、`memory-distill/ledger.sqlite3`）。
四份副本 + rc.5 启动后复测：全部 `checked=17 ok=17 fail=0`。

### 2.3 生产副本起 rc.5（DATA-007）

- `docker compose -p rc5-p6b --env-file <0600> -f docker-compose.yml up -d --no-build` → 3s healthy
- 迁移日志：profile 重渲染并**保留用户新增 LLM provider `baidu-token-plan`**；追加 3 个默认 bundle；
  移除已下架 agent-team-profile（留痕）；MCP servers 零写
- 数据面前后：`users 2 / access sessions 145 / workspaces 3 / memory 12·15 / workspace memory 24 /
  tasks thread 1 / sessions files 396 / storages 353 / relay-token sha 913dbafe…4272b`
  —— 启动与 `docker restart` 后逐项不变；全库 integrity ok
- HTTP：`/login` 200、匿名 `/me` 401、`/` 302→`/login`

### 2.4 备份/恢复（DATA-008）

- `deploy/backup-data.sh` 全链（stop→tar→start）EXIT=0；包 0600、目录 0700、25.9 MB；
  含 marker、不含 `office-kit/outputs`、不含 `.pnpm-store`
- 冷态确定性备份 → 删 marker → 空目录恢复：**5428 个文件的路径/大小/权限逐行一致**，
  marker sha256 一致，恢复副本 16 库全 ok（17 − `.pnpm-store/v11/index.db` 备份排除项）

### 2.5 回滚（DATA-010）

- 旧镜像 0.1.51 起在**未受 rc.5 触碰**的旧卷副本（p6b-e5b）上：login 200 / me 401 / relay 200，
  users=2、sessions=145、17 库 ok；日志显示旧版本走「模板未变，保留用户文件」keep 路径
- 切回 rc.5：healthy、`/login` 200、新根 17 库 ok；往返前后 DB 行数/令牌/工坊/会话文件数/总文件数全等

### 2.6 FUSE（48 §4.5 声明检查）

- 容器内 `/data`：`virtiofs0 … virtiofs rw,nosuid,nodev,relatime,ignore_atime,no_xattr`；`stat %T=fuseblk`
- `chmod 600/700` 落宿主；`chown 1000:1000` 返回 0 但 uid 不映射（容器内仍 0、宿主仍 sunny:staff）
- `flock` 互斥成立（持锁时第二进程 rc=1）
- SQLite WAL：8 写者 × 200 事务 = 1600/1600、`SQLITE_BUSY` 0、integrity+quick ok、
  `mmap_size=256MiB` 接受、kill -9 未提交事务后 integrity ok（回滚正确）；耗时 568ms（overlay 86ms）

### 2.7 24h 浸泡（DATA-009，NOTRUN）

| 项 | 值 |
|---|---|
| 窗口 | 起 `2026-11-19T21:45:37Z`，止计划 `2026-11-20T21:45:37Z`；观测时 0.67h |
| 进程 | PID 56706 存活（P5 lane 按 54 §3.5 起跑） |
| DATA 采样 | 9 tick（5min）：integrity 9/9 ok；写 18/0；lock 0；WAL 异常 0；会话 136 |
| TERM 采样 | 41 tick（60s）：fd 69→88（min69/max88）；RSS 586,976→298,072 KB；churn 失败 41/41（已知服务端错误） |

**结论必须是 NOTRUN**：窗口未满，按 54 §6.3 不得判通过；且现行 soak 的并发/全库覆盖未达 48 §4.5
（详见 leftover `DATA-009-SCALE`）。

## 3. 边界与合规

- 未 `git push/merge`；未停/改生产容器 `eterna-agent`（0.1.51，3210；StartedAt `2026-11-19T17:21:06Z` 全程未变）
- 本 lane 未对 E1/E3 执行 stop/restart：E1 StartedAt `21:09:04Z` 未变（浸泡连续）；E3 的
  StartedAt `22:15:24Z` 变化来自其它 lane 的重建，本 lane 对 E3 无任何命令（见 `boundary-check.log`）
- 未写 `/Users/sunny/code/agent-basis`、deepseek-harness；未改 `packages/**`/`scripts/**`
- 所有演练容器独立命名（`eterna-rc5-p6b-a/-old`）、独立数据根（`test-rc5/p6b-e5*`）、独立端口（3230/3231、9330/9331）
- 凭据只存在于 0600 测试 env（`test-rc5/.env.p6b-a`、`.env.p6b-old`），命令 argv 与证据均无凭据；
  容器日志中的 bootstrap token 已脱敏
- 证据只写 `artifacts/rc5/DATA/**` 与 `artifacts/rc5/p6b/**`；p5 浸泡目录只读快照，未修改

## 4. 遗留（格式 id|现象|级别|建议）

1. **DATA-009-24H** | 24h 浸泡窗口未满（0.67h/24h；采样内无锁/WAL 异常、integrity 9/9 ok）；
   plannedEnd `2026-11-20T21:45:37Z` | **P0** | 满窗后由 P6b 复核 `summary-24h.json` 的
   `window.complete=true` 与 verdict；未满不得判绿
2. **DATA-009-SCALE** | 现行 soak 仅 2 并发写者、每 5min 检 3 库，未达 48 §4.5 的「≥50 会话并发 +
   每 2h 全库 integrity」 | **P1** | 满窗前补：writers 提到 ≥50 会话级并发；用
   `artifacts/rc5/DATA/_tools/check-sqlite.mjs` 做 2h 全库（17 库）巡检
3. **DATA-007-RERENDER** | rc.5 对带工坊编辑的存量 profile 每次重启都走「模板变更/首启接管」重渲染
   （内容幂等；同数据用 0.1.51 起时走 keep 路径） | **P2** | 在 `migrate-prompt-edits` 之后重算并重写
   `.rendered.*.sha256`（或让移植写入参与哈希），恢复「模板未变即保留」；另测插件启停/模型设置跨重启
4. **DATA-007-SESSION-CHURN** | 重启时 dsh 重写一个会话归档 `session.v4.jsonl.zstd`（文件数不变、integrity ok） | **P3** |
   确认上游 compact/重写为预期；升级验收加「重启后会话内容可比对」口径
5. **DATA-009-TERM-CHURN** | TERM churn 41/41 tick 失败（`terminal/create` 返回
   `gateway/internal: session.snapshotEvents is not a function`），属 P5 已记 P0，非 DATA 判据 | **P1** |
   由 TERM-013 lane 修复后复跑；DATA 轨不据此判绿也不据此判红
6. **DATA-008-RESTORE-BOOT** | 恢复演练只做文件清单/SQLite 校验，未在恢复根上起容器 | **P3** |
   正式迁移窗口按 48 §8.2 第 4–5 步在恢复根起容器 + `verify.sh`；本 lane 的「起容器」面已由
   DATA-007/010 覆盖
7. **FUSE-LOWPRI** | bind 为 virtiofs 且带 `no_xattr`；容器内 `chown` 返回 0 但 uid 不映射
   （宿主始终 sunny:staff） | **P3** | 如后续插件用 xattr 或依赖属主隔离，需在目标宿主重验；
   macOS 单用户机上可接受

## 5. 证据索引

- `artifacts/rc5/DATA/RC5-DATA-001 … 010/`（每 case：`cmd.log` + `result.md` + 原始输出/快照）
- `artifacts/rc5/DATA/FUSE/`（`cmd.log`、`result.md`、`wal-bind.json`、`wal-overlay.json`）
- `artifacts/rc5/DATA/_tools/`（可复跑脚本：`record.sh`、`migrate-drill.sh`、`check-sqlite.mjs`、
  `snapshot-data.mjs`、`fuse-sqlite-stress.mjs`、`case-*.sh`）
- `artifacts/rc5/p6b/summary.json`、`artifacts/rc5/p6b/soak/`（浸泡快照）
- 测试根（仓外，`$HOME/eterna-data/test-rc5`）：`p6b-e5a`（rc.5 已启动）、`p6b-e5b`（旧卷副本）、
  `p6b-restore`（恢复演练目标）、`.p6b-data008-backups/`（备份包，0600）