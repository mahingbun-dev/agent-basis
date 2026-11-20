# RC5-DATA-008 · 冷备 → 删除测试文件 → 恢复

- 依据：51 §3.14 DATA-008；48 §8.1（冷备 stop→tar→start）、§8.2（恢复到空目录→校验）
- 对象：迁移副本实例 `p6b-e5a` + 容器 `eterna-rc5-p6b-a`（独立测试根；不碰生产）
- 脚本：`deploy/backup-data.sh`（本身不改）

## 阶段 A：全链冷备（脚本内置 stop → tar → start）

```bash
ETERNA_DATA_ROOT=$HOME/eterna-data/test-rc5 BACKUP_DIR=…/.p6b-data008-backups \
ETERNA_CONTAINER_NAME=eterna-rc5-p6b-a bash deploy/backup-data.sh p6b-e5a
```

- EXIT=0；备份包 `p6b-e5a-20261120-062230.tgz`（25,945,846 B）0600；备份目录 0700
- `tar tzf` 校验通过；包内含测试 marker；**不含** `office-kit/outputs`、**不含** `.pnpm-store`
- 容器被脚本重新拉起（`Running=true`），随后 healthy

## 阶段 B：冷态确定性备份 → 删除 → 空目录恢复

1. `docker stop`（取冷态基线）→ 清单 5,428 个文件（路径|大小|权限）
2. `SKIP_STOP=1 backup-data.sh`（冷态归档，避免运行期会话写盘影响清单比对）
3. `docker start`
4. 删除测试文件 `p6b-backup-marker.txt`
5. `tar xzf` 到全新空目录 `$HOME/eterna-data/test-rc5/p6b-restore`
6. 比对：marker sha256 一致（`5a20d6e9…862`）；清单 5,428 行逐行一致（路径/大小/权限）
7. 恢复副本全库 integrity_check：16 库全 ok（源 17 − 备份排除的 `.pnpm-store/v11/index.db`）

## 断言（15/15 PASS）

| 断言 | 实测 |
|---|---|
| 备份脚本 EXIT=0 | 0 |
| 备份包存在 / 0600 / 目录 0700 | yes / 600 / 700 |
| 包内含 marker | 1 |
| 包内不含 office-kit/outputs、.pnpm-store | 0 / 0 |
| 脚本重新启动容器 | true |
| 测试文件已删除 | deleted |
| 恢复解包 EXIT=0 | 0 |
| 恢复后 marker 内容一致 | sha256 相同 |
| 恢复清单与备份前一致 | identical（5428 files） |
| 恢复副本 integrity_check | EXIT=0，16/16 ok |

## 结论

**PASS**。备份/恢复链路可用，排除项符合 48 §8.1；恢复后逐文件（大小/权限）与备份前一致，
SQLite 全库完整。恢复未验证「容器起在恢复根上」——该点由 DATA-010 的旧卷副本启动与
DATA-007 的迁移副本启动分别覆盖，恢复根未再起容器（成本/端口考虑，非阻断）。

## 证据

- `cmd.log`、`manifest-before.txt`、`manifest-restored.txt`、`restore-integrity.json`
- 备份包在 `$HOME/eterna-data/test-rc5/.p6b-data008-backups/`（不进仓）