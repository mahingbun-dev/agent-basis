# RC5-DATA-010 · 回滚演练（旧镜像 + 旧卷副本）

- 依据：51 §3.14 DATA-010；48 §7.6（停新容器 → 恢复旧 compose/旧卷 → 旧版本可用；旧卷未动）
- 对象（全部独立，不碰生产 `eterna-agent`）：
  - 新：容器 `eterna-rc5-p6b-a`（rc.5，`sha256:99d8e85b509b`）+ 新根 `p6b-e5a`
  - 旧：镜像 `eterna-agent:0.1.51`（`sha256:3ca0d6605589`，P0 记录的当前生产镜像）
    + 旧卷副本 `p6b-e5b`（冷备解包 + rsync 副本，**rc.5 从未启动过**，等价「旧卷未动」）
- 旧容器用 `docker run` 直接起（不挂 rc.5 compose 的模板，模拟旧部署），端口 3231/9331

## 序列与实测

| 步骤 | 命令/探针 | 实测 |
|---|---|---|
| 停新容器 | `docker stop -t 60 eterna-rc5-p6b-a` | Running=false |
| 起旧版本 | `docker run -d … eterna-agent:0.1.51` + 旧卷副本 | EXIT=0，running |
| 旧版本可用 | `GET /login` / `GET /access/api/me` / relay `GET /api/status` | 200 / 401 / 200 |
| 旧版本数据在 | 旧卷副本快照（`snapshot-data.mjs`） | users=2，access sessions=145 |
| 旧卷完整性 | 全库 integrity_check | 17/17 ok |
| 停旧容器 | `docker stop -t 60 eterna-rc5-p6b-old` | 0 |
| 起回新容器 | `docker start eterna-rc5-p6b-a` | healthy；`/login` 200 |
| 新根无二次损坏 | 全库 integrity_check | 17/17 ok |
| 往返前后指纹 | DB 行数 / relay-token / storages / sessions 文件数 / 总文件数 | 全等 |

旧容器启动日志显示 `[entrypoint] profile 渲染:模板未变,保留用户文件 …`（`old-container.log`），
即旧版本对其自身模板走 keep 路径，未重写 profile；旧卷副本启动后全库仍 ok。

## 断言（17/17 PASS）

新容器已停；旧容器 EXIT=0/running；旧版本 3 个探针；旧卷 users=2、sessions=145；
旧卷全库 ok；新容器恢复 healthy、`/login` 200；新根全库 ok；往返后 db/secret/storages/sessions/files 全等。

## 结论

**PASS**。旧镜像 0.1.51 能在「旧卷副本」上正常服务（登录页/鉴权/中继/数据全在），
旧卷未被新版本改动；切回 rc.5 后新根数据面无二次损坏。

## 证据

- `cmd.log`、`old-container.log`（bootstrap token 已脱敏）、`old-volume-integrity.json`、
  `old-volume-after-boot.json`、`new-before-rollback.json`、`new-after-rollback.json`、
  `new-after-rollback-integrity.json`、`compare.txt`
## 收尾

回滚往返验证完成后演练容器已停止（`eterna-rc5-p6b-a` stop，`../p6b/boundary-check.log`）；
旧容器 `eterna-rc5-p6b-old` 为 Exited(0)。旧卷副本 `p6b-e5b` 与新根 `p6b-e5a` 均保留。
