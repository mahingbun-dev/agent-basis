# RC5-DATA-004 · 迁移演练两遍（硬链接/大小/符号链接与源一致）

- 依据：51 §3.14 DATA-004；48 §7.3（tar 保留符号链接；比对 `du -sh` 与顶层清单）
- 源：生产冷备 `$HOME/eterna-data/backups/rc5-2026-11-20/eterna-home-20261120-021802.tgz`
  （P0 活卷 tar，sha256 `5976686f…d281`，10,466 条目；本 lane 只读）
- 目标：`$HOME/eterna-data/test-rc5/p6b-e5a`（第一遍）、`…/p6b-e5b`（第二遍）——
  两遍都是全新实例根，脚本对非空目标拒绝（`_tools/migrate-drill.sh:23`）。
- 方法（48 §7.3 口径）：安全清单检查（绝对路径/`..` = 0）→ `tar xzf` 到 staging →
  `rsync -aH`（保留硬链接）→ 统计比对。

## 实测（两遍完全相同）

| 指标 | 源 staging | 第一遍 p6b-e5a | 第二遍 p6b-e5b | P5 E5 副本（第三份） |
|---|---|---|---|---|
| 普通文件数 | 8620 | 8620 | 8620 | 8620 |
| 总字节 | 108,848,480 | 108,848,480 | 108,848,480 | 108,848,480 |
| 硬链接组（inode 链接数>1） | 3148 | 3148 | 3148 | 3148 |
| 符号链接数 | 352 | 352 | 352 | 352 |

归档安全性：entries=10466，unsafe（绝对路径/`..`）=0。
rsync 报告：Number of files 10466（含目录/链接），total size 108,882,060 B。

## 断言（4/4 PASS）

| 断言 | 实测 |
|---|---|
| 第一遍 files/bytes/linkGroups/symlinks 与源一致 | true |
| 第二遍同 | true |
| 两遍副本统计完全一致 | `{8620, 108848480, 3148, 352}` |
| P5 E5 副本（第三份）与两遍一致 | 同上 |

## 结论

**PASS**。迁移两遍的硬链接结构、字节数与符号链接面全部保持；`cp -a` 不保硬链接的
macOS 陷阱已被绕开（统一 `rsync -aH`，与 `scripts/verify-data-root.sh` 头注同口径）。

## 证据

- `drill-1/cmd.log`、`drill-1/stats.json`、`drill-1/archive-entries.txt`
- `drill-2/cmd.log`、`drill-2/stats.json`、`drill-2/archive-entries.txt`
- `cmd.log`（本 case 复核断言）