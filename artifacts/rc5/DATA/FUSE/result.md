# FUSE 声明检查（48 §4.5 / §9）

- 依据：48 §4.5（macOS Docker Desktop 的 bind = virtiofs/fuseblk，SQLite WAL/-shm 依赖 POSIX 锁与 mmap，
  必须先验证）、§9（chmod/chown 不落宿主、0600 语义）
- 环境：rc.5 镜像容器（`--network none`），宿主 bind 挂到 `/data`
  （`$HOME/eterna-data/test-rc5/.p6b-fuse/data`），另以容器 `/tmp`（overlayfs）做对照
- 工具：`_tools/fuse-sqlite-stress.mjs`（8 写者 × 200 事务 + 未提交事务进程退出恢复）

## 1. 文件系统类型（容器内）

```
virtiofs0 /data virtiofs rw,nosuid,nodev,relatime,ignore_atime,no_xattr 0 0
stat -f -c %T /data  → fuseblk
stat -f -c %T /tmp   → overlayfs
stat -f -c %T /      → overlayfs
```

**声明成立**：宿主 bind 在容器内是 virtiofs（`stat` 报 fuseblk），不是 ext4。挂载选项含
`no_xattr`（SQLite 不需要 xattr；若未来插件依赖 xattr 需另行验证）。

## 2. 权限与属主语义

| 容器内操作 | 宿主侧实测 |
|---|---|
| `chmod 600` 文件 | `-rw-------`（600）落宿主 |
| `chmod 700` 目录 | `drwx------`（700）落宿主 |
| `chown 1000:1000` 文件 | 容器内 `chown` 返回 0，但容器内 `stat -c %u` 仍为 0；宿主属主仍为 `sunny:staff` |
| 容器 root 创建文件 | 宿主属主 `sunny:staff`（uid 不映射） |
| `ln` 硬链接 | 容器内 inode 相同；宿主侧两路径同一 inode |

对应 48 §9 的声明：**chmod 落宿主、chown 不落宿主（容器内也不生效）**。生产敏感文件仍是
`sunny` 属主 + 0600（`.credentials.yaml` 实测 600，见 DATA-007），在 macOS 单用户机上可接受；
迁 Linux 时属主语义会变（48 §9 已记）。

## 3. flock（POSIX 建议锁）

```
flock -n /data/fuse/lock/l1 -c 'echo first-acquired'   → acquired, rc=0
（另一进程持锁 2s）
flock -n /data/fuse/lock/l1 -c 'echo second-acquired'  → rc=1（被正确拒绝）
```

互斥语义在 virtiofs 上成立。

## 4. SQLite WAL 并发 + 崩溃恢复（bind vs overlay）

`node:sqlite`，`PRAGMA journal_mode=WAL`、`synchronous=NORMAL`、`busy_timeout=5000`，
8 个独立进程各 200 个 `BEGIN IMMEDIATE`…`COMMIT`，再跑一次「未提交事务时进程退出」的崩溃恢复。

| 指标 | bind（virtiofs） | overlay 对照 |
|---|---|---|
| 成功提交 | 1600 / 1600 | 1600 / 1600 |
| `SQLITE_BUSY`/locked | 0 | 0 |
| 落库行数 | 1600 | 1600 |
| 耗时 | 568 ms | 86 ms（约 6.6× 快） |
| `integrity_check` / `quick_check` | ok / ok | ok / ok |
| `journal_mode` | wal | wal |
| `mmap_size=256MiB` | 接受（268435456） | 接受 |
| 崩溃恢复（未提交事务进程退出 97） | integrity ok，未提交行 0（正确回滚） | 同 |
| WAL/-shm 文件 | 4152 B / 32768 B | 4152 B / 32768 B |

E1 容器日志全量扫描 `database is locked|SQLITE_BUSY`：0 命中。

## 断言（5/5 PASS）

宿主侧 f600=600、d700=700、硬链接同 inode；bind WAL 并发+崩溃恢复 EXIT=0；overlay 对照 EXIT=0。

## 结论

**PASS（声明检查）**。在该宿主（macOS + Docker Desktop）上，virtiofs bind 支持 SQLite WAL、
flock 与 mmap，8 并发写者零 BUSY、崩溃后 integrity ok；chmod 落宿主、chown 不生效，与 48 §9
声明一致。注意这是**短时压力**证据，不能替代 24h 浸泡（DATA-009 仍 NOTRUN）。

## 证据

- `cmd.log`、`wal-bind.json`、`wal-overlay.json`