# RC5-DATA-005 · 迁移副本全库 `PRAGMA integrity_check`

- 依据：51 §3.14 DATA-005；48 §7.5（容器内 `node:sqlite` 检查）
- 方法：在 rc.5 镜像容器内跑 `_tools/check-sqlite.mjs`；源目录 `:ro` 挂载，
  每个 DB（识别 `SQLite format 3\0` 文件头）连同 `-wal`/`-shm` 复制到容器 `/tmp` 后再开——
  不写源目录、不 checkpoint 源库。

```bash
docker run --rm --network none -v <host-root>:/src:ro -v artifacts/rc5/DATA/_tools:/tools:ro \
  eterna-agent:rc5-test node /tools/check-sqlite.mjs /src --copy
```

## 实测（5 份根，每份 17 个库）

| 根 | 库数 | ok | fail | EXIT |
|---|---|---|---|---|
| 第一遍副本 p6b-e5a | 17 | 17 | 0 | 0 |
| 第二遍副本 p6b-e5b | 17 | 17 | 0 | 0 |
| P5 E5 副本 e5 | 17 | 17 | 0 | 0 |
| 冷备解包 staging（drill-1） | 17 | 17 | 0 | 0 |
| p6b-e5a **rc.5 启动之后** | 17 | 17 | 0 | 0 |

库清单与日志模式（17 个）：`wal` 9 个（含 `access/users.db`、`.eterna/memory.sqlite3`、
`workspaces/Mr.Ma/.eterna/memory.sqlite3`、`tasks.sqlite3` 等），`delete` 8 个
（含 `knowledge-admin/access.sqlite3`、`memory-distill/ledger.sqlite3`、`.eterna/channels.sqlite3`）；
`.eterna/memory.sqlite3.migrated-1794768912209` 也作为 SQLite 文件被检查（ok）。

断言（1/1 PASS）：四份副本 + 启动后复测全部 `checked>0 && fail=0`。

## 结论

**PASS**。冷备→两遍迁移→rc.5 首次启动（profile 重渲染/存量迁移）→ 全库完整性仍全 ok。

## 证据

- `drill1.json` / `drill2.json` / `p5-e5.json` / `staging1.json` / `postboot-drill1.json`
- `cmd.log`
## 口径说明

17 个库 = P0 备份清单记的 16 个 DB 文件 + `.eterna/memory.sqlite3.migrated-<ts>`
（头部同样是 `SQLite format 3\0`，按库计入）。所有 17 个都跑了 `PRAGMA integrity_check`。
