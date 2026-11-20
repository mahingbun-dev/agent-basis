# 回滚记录 · rc.5 上线（T56）

- 任务：T56（54 §4.9 / §10.5 / §10.6；49 §8/§11；51 §7；48 §7.6）
- 用途：把「旧镜像 + 冷备」的回滚点、命令、判定与**演练状态**固定成可执行记录；上线窗口按本文件操作，事后在 §7 填写实际回滚事件
- 当前状态：**回滚点已记录；迁移两遍 / 全库 integrity / 回滚演练（DATA-004/005/010）已在最终镜像 PASS**（见 §5）；生产容器未被本 lane 触碰
- 依据证据：`artifacts/rc5/p0/summary.json`（`rollback_point`/`backup`/`prod` 段）、`docs/design/48-容器数据持久化目录改造方案.md:517-525`、`deploy/README.md:95-133`

---

## 1. 回滚点（升级前生产态）

| 项 | 值 | 来源 |
|---|---|---|
| 生产容器 | `eterna-agent`，镜像 `eterna-agent:0.1.51`，`-p agent-basis` | `p0/summary.json` → `prod.container` |
| 当前/升级前镜像 digest | `sha256:3ca0d66055898b092f09761e5f67baa4a82741f1c7233d27bd2ddbd6de2b1a7b`（created `2026-11-19T17:19:57Z`） | `rollback_point.images[role=current]` |
| **次选回滚镜像** | `eterna-agent:0.1.50` = `sha256:6b306037b6593d94e7c797a97f15e8fb7f60fe97f871fd673da6ce659e7b2052`（p0 记为 role=`rollback`；若升级前生产已是 0.1.51，首选修回的是 0.1.51 本身，见上两行） | `rollback_point.images[role=rollback]` |
| 更早兜底 | `eterna-agent:0.1.38` = `sha256:b0dbe8bc6da4c918ee1a848548d92980d8caba4bb5301b26c5878932b5ae95e1` | `rollback_point.images[role=older-fallback]` |
| 数据卷 | named volume `agent-basis_eterna-home` → `/data`，mountpoint `/var/lib/docker/volumes/agent-basis_eterna-home/_data` | `prod.volume` |
| compose 文件 | `/Users/sunny/code/agent-basis-main-0.1.51/docker-compose.yml`（config hash `6f86bb7b88e1cb5beeb3d475cc850dcefa0b38e175f558a3df7debd8c7b295f0`） | `prod.container.compose_config_file` / `prod.volume.compose_config_hash` |
| 容器内内核 | `0.2.2-alpha.3`（升级前；rc.5 镜像重建后应变为 `0.2.2-rc.5`） | `prod.container.kernel_version_in_container` |
| 数据规模 | 19 个顶层条目，约 77 MB（profiles 34M / sessions 15M / market 14M / storages 4.8M / workspaces 4.2M） | `prod.data_top_level` |

> 回滚默认应回**升级前实际运行的那个 tag**（本次基线是 0.1.51，见上表）；0.1.50 是次选，0.1.38 仅作旧内核兜底。回滚时以 digest 为准，不以 tag 为准（tag 可能被覆盖）。

---

## 2. 冷备（回滚数据点）

| 项 | 值 |
|---|---|
| 包路径 | `/Users/sunny/eterna-data/backups/rc5-2026-11-20/eterna-home-20261120-021802.tgz` |
| 大小 | 26,566,225 B |
| sha256 | `5976686ff2caab6a668c7231daded925c10053e062b9d4b28ecb31e61fbbd281` |
| 条目数 | 10,466（含 16 个 SQLite 文件） |
| 一致性 | 16/16 `PRAGMA integrity_check = ok`（只读 URI，解包后检查，临时目录已删） |
| 权限 | 目录 0700 |
| 生成命令 | `docker run --rm --entrypoint sh -v agent-basis_eterna-home:/src:ro -v $HOME/eterna-data/backups/rc5-2026-11-20:/backup eterna-agent:0.1.51 -c 'tar czf /backup/eterna-home-20261120-021802.tgz -C /src .'`（EXIT=0） |
| 敏感性 | 包内含 `.credentials.yaml` 与 `relay-token`，**视同密钥**：不得入 git/镜像/工单，传输与落盘须加密 |
| 告警 | 这是**活卷 tar**（未停容器/未冻结写入）；一致性靠事后 `integrity_check` 反证。正式迁移窗口须按 48 §7.1 重做「停 → tar → 起」冷备 |

---

## 3. 回滚命令（旧镜像 + 旧卷/冷备）

### 3.1 情形 A：只回退镜像（数据未迁移，named volume 未动）

```bash
cd /Users/sunny/code/agent-basis-rc5          # 或部署时使用的 compose 目录
docker compose -p agent-basis down            # 不删卷
# 把镜像指回旧 tag（compose 的 ETERNA_IMAGE 或 image: 行）
ETERNA_IMAGE=eterna-agent:0.1.51 docker compose -p agent-basis up -d
bash deploy/verify.sh http://127.0.0.1:3210
docker exec eterna-agent dsh --version        # 期望 0.2.2-alpha.3（旧内核）
```

### 3.2 情形 B：rc.5 已完成数据根迁移（bind mount 生效）

```bash
docker compose -p agent-basis down            # 不删卷；宿主 bind 目录保留
# 恢复升级前 compose（external: true + named volume），镜像指回旧 tag
docker compose -p agent-basis up -d
bash deploy/verify.sh http://127.0.0.1:3210
```

- 48 §7.6 原文：`docker compose -p agent-basis down`（不删卷）→ 恢复 compose 旧版本（`external: true` + named volume）→ `up -d`。
- 旧卷 `agent-basis_eterna-home` 未动，回滚即回到迁移前；**稳定 ≥7 天**后再考虑删卷。
- 升级期间若宿主 bind 目录有新数据（rc.5 期间写入），回滚后这些数据**不会**自动回流旧卷——需要时先导出再按 48 §8.2 恢复。

### 3.3 情形 C：旧卷损坏/丢失 → 冷备恢复

```bash
# 目标宿主根目录为空；先停容器
tar xzf /Users/sunny/eterna-data/backups/rc5-2026-11-20/eterna-home-20261120-021802.tgz \
    -C "${ETERNA_DATA_ROOT:-$HOME/eterna-data}/<instance>"
# 确认权限（敏感文件 0600）；起旧镜像
docker compose -p agent-basis up -d
bash deploy/verify.sh http://127.0.0.1:3210
```

恢复后必须跑：登录 → 会话列表/历史可打开 → 设置分区 → 已装插件 → 审计 jsonl 追加 → `integrity_check`（48 §7.5/§8.2）。

---

## 4. 回滚判定（什么时候回）

| 触发 | 判定依据 | 动作 |
|---|---|---|
| verify.sh 红 / boot 失败 | 51 §6.1；48 §7.5 | 立即回滚（情形 A/B） |
| 跨租户可访问 | 51 §7「立即停止；按安全缺陷处理」 | **立即停容器** → 回滚 → 安全复盘 |
| 个人 MCP 串号/工具泄漏 | 49 §8 失败域表 | 先 `mcp.personal.enabled=false` kill switch；再回滚镜像 |
| 数据损坏 / WAL 错 | 48 §7.5 integrity_check | 停写 → 冷备恢复（情形 C） |
| 24h 观察出现 P0 告警 | 51 §6.2 | 回滚并记录 |

**H7 硬限制**：回滚后 rc.5 期间新建的会话不可打开（上游持久化前向不兼容）；回滚演练只验证旧会话，回滚前先导出需要保留的新会话。

---

## 5. 演练状态（如实记录）

| 演练项 | 状态 | 证据/原因 |
|---|---|---|
| 迁移两遍（DATA-004） | **PASS** | `artifacts/rc5/DATA/RC5-DATA-004/result.md`（硬链接结构/字节数/符号链接面保持；`rsync -aH` 口径） |
| 全库 integrity（DATA-005） | **PASS** | `artifacts/rc5/DATA/RC5-DATA-005/result.md`（冷备→两遍迁移→rc.5 首次启动→全库 ok） |
| 回滚演练（DATA-010） | **PASS** | `artifacts/rc5/DATA/RC5-DATA-010/result.md`（旧镜像 0.1.51 在旧卷副本上正常服务；旧卷未被新版本改动；切回 rc.5 无二次损坏） |
| 冷备恢复路径 | **已随 DATA-005 验证**（测试实例，非生产） | `artifacts/rc5/DATA/RC5-DATA-005/result.md` |
| 本轮（T56）实际执行的生产回滚 | **无** | 未部署，故无回滚事件；未停/改生产容器 |

> 结论：**回滚点、命令与演练证据齐备**（测试实例）；生产窗口若真正触发回滚，仍按 51 §6.1 记录到 §7。生产冷备请按 48 §7.1 在停写窗口重做一次。

---

## 6. 回滚后验收清单

- [ ] `docker exec eterna-agent dsh --version` = 旧内核版本（非 `0.2.2-rc.5`）；
- [ ] `bash deploy/verify.sh http://127.0.0.1:3210` EXIT=0；
- [ ] 登录（管理员）成功，会话数不低于升级前基线（48 §7.5 记录迁移前为 193 会话；p0 只记录 sessions 目录 15M，未复述条数）；
- [ ] 历史会话可打开（**仅旧会话**；不读 rc.5 新会话，H7）；
- [ ] 设置三分区、已装插件、提示词工坊版本仍在；
- [ ] 审计 jsonl 继续追加；companion 中继可用（`/data/relay-token` 不变）；
- [ ] `PRAGMA integrity_check` 三库 `ok`；
- [ ] 旧卷 `agent-basis_eterna-home` 保留，未删。

---

## 7. 实际回滚事件记录（上线时填写）

| 字段 | 值 |
|---|---|
| 回滚时间（UTC） | — |
| 触发原因 | — |
| 回滚前镜像 digest | — |
| 回滚到镜像 tag/digest | — |
| 数据处置（旧卷 / 冷备 / 保留 bind） | — |
| 使用的冷备包 + sha256 | — |
| H7 影响（rc.5 新会话数、是否已导出） | — |
| verify.sh 结果 / 会话数 | — |
| 操作人 / 复核人 | — |
| 后续（卷保留期、复盘单） | — |

---

## 8. 附：升级前生产基线快照（回滚比对用）

- 容器 `eterna-agent`：`3210->8080/tcp`、`9310->9310/tcp`，`restart=unless-stopped`，health `healthy`，form `super`，`DSH_HOME=/data`；
- 镜像 `eterna-agent:0.1.51`，`image_size_bytes=582574950`；
- env 共 20 个 key，证据只保留 `ETERNA_FORM/DSH_HOME/PATH` 三个（其余 17 个 key 未落盘）；
- 模板 bind（ro）：`cordis.patch.yml.template`、`cordis.super.patch.yml.template`；
- 以上数据源：`artifacts/rc5/p0/summary.json` → `prod`。