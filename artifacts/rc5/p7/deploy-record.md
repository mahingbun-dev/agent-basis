# 生产部署记录 · rc.5 上线（2026-11-21）

> 授权：用户 2026-11-21 00:28「不用等24小时了，直接进行接下来的流程」。
> 执行：runbook `artifacts/rc5/p7/deploy-runbook.md`；回滚点 `p7/rollback-record.md`。
> 全程在停机窗口内完成数据迁移；本文所有数字为实测。

## 1. 交付物

| 项 | 值 |
|---|---|
| 合并 | PR **#137** merge commit `343ea70b5e93eefa44af7398f67e011bc567e739`（CI：verify 2m36s / upgrade-gate 2m47s / v1-line 48s 全绿；daily-boot-gate 按设计 skip） |
| 新镜像 | `eterna-agent:0.2.0-rc.5` = `sha256:57ab618f41079a7029fc541944e2f5f77d1f6aeefd56137dce303f80a473fb14`（从 latest main `343ea70` 构建，内核 `0.2.2-rc.5`） |
| 部署树 | `/Users/sunny/code/agent-basis-main-0.2.0-rc.5`（main 冻结克隆；`.env` 0600） |
| 数据根 | `/Users/sunny/eterna-data/super`（bind，0700；自旧卷迁移） |
| 旧态保留 | named volume `agent-basis_eterna-home` 未删；旧镜像 0.1.51（`sha256:3ca0d660…`）在本地；两份冷备（见 §2） |

## 2. 停机窗口与数据迁移

| 步骤 | 实测 |
|---|---|
| 停机窗口 | `2026-11-20T16:47:10Z` → `16:48:50Z`，**100 秒** |
| 迁移前活动检查 | `deploy/pre-restart-check.sh`：静默窗 120s 内无会话活动 ✅ |
| 冷备（停写窗口重做，48 §7.2） | `~/eterna-data/backups/rc5-2026-11-21/eterna-home-20261120-164733.tgz`（26,811,060 B，sha256 `7c8b0560599205d3…`） |
| 数据拷贝 | tar 在 macOS FUSE 抽符号链接面报「Directory renamed」（与 DATA-004 结论一致）→ 改走 DATA-004 已验证口径：**冷备 tar → 宿主 APFS staging 解包 → `rsync -aH` → super** |
| 拷贝一致性 | staging 与 super 完全一致：**8618 文件 / 109,320,490 B / 7362 硬链接组 / 64 符号链接**（差异仅为新增 `.secrets/mcp-master-key` 45B）；`sessions/`、`storages/` 清单逐项 diff 一致 |
| 迁移后 integrity（宿主 + 容器双跑） | `access/users.db` / `.eterna/memory.sqlite3` / `.eterna/knowledge.sqlite3` 全 `ok` |

## 3. 新栈启动

- `docker compose -p agent-basis up -d`：容器 `eterna-agent`（镜像 0.2.0-rc.5），端口 3210/9310 不变，healthy、`RestartCount=0`。
- entrypoint 钩子全按预期：
  - profile 重渲染（模板变更接管 + 工坊值移植 **1 处** `preset.standard.persona`，基线重写留痕）；
  - `migrate-profile-bundles`：追加默认 bundle（chat-import / session-search / terminal），备份 `package.json.bak-…499Z`；
  - `migrate-mcp-servers`：新 patch 自带 mcp-client browser 行，**跳过系统层迁移（零写）**；
  - `profile-upgrade-check`：移除 `dsh-experimental-agent-team-profile`（rc.5 换 BOOT-013 机制），备份+留痕 `.upgrade-removed-bundles.json`，「无坏项」；
  - governance rules 接线 `/data/.eterna/governance.rules.yml`。
- env 保真：15 个键（三家 API key / OpenDesign / access 四件 / relay 两件 / market 三件 / 公网两件）**新旧容器值逐一相等**（凭据不打印）。
- 个人 MCP 主密钥：`/data/.secrets/mcp-master-key`（0600）在位，个人层 enabled。

## 4. 验收（48 §7.5 + deploy/verify.sh）

| 项 | 实测 |
|---|---|
| `bash deploy/verify.sh http://127.0.0.1:3210` | **14 过 / 0 败，EXIT=0**（登录页/匿名拒绝/根路径跳转/管理员登录/me 角色/红线标记/无会话变更拒绝/错密码拒绝/治理规则活性/知识底座装载+运行探针/中继 status/扩展 zip/guide 页） |
| `docker exec eterna-agent dsh --version` | `0.2.2-rc.5` |
| 容器内三库 integrity | 全 `ok` |
| 会话/工坊快照 | `sessions/` 18 项、`storages/` 4 项，与迁移前逐项一致 |
| 审计 | `/data/.eterna/audit-20261120.jsonl` 继续追加（启动事件落盘） |
| companion 中继 | `/api/status` 200、`/data/relay-token` 原值（拷贝保持） |
| profile 插件面 | `@eterna` 22 包 symlink 齐（tasks/workbench/channels/interact/toolkit/…）；`@eterna/tasks` 未进 bundles 的 R22 现状不变（已知遗留） |

**端到端回归（部署后追加执行，2026-11-21T17:0x-17:2xZ）**：API 面 **12/12 PASS**（门禁/登录/铸票/模型面/建会话/**真·模型回合**/terminal churn/个人 MCP/chat-import 门/companion/清理/审计）+ 浏览器面 **PASS**（公网入口、系统 Chrome、UI 发送 → mimo 助手回复上屏，服务端事件双确认）+ `verify.sh` 复查 14/0。**未发现产品缺陷，「修复→再合并→再部署」循环未触发**。证据：`p7/post-deploy-e2e/{result.md,summary.json,ui-result.json,ui-evidence-*.png}`。

**待人工**（用户侧）：上线后 24h 观察无 P0 告警；四方补签。

## 5. 边界与说明

- 未删除旧卷/旧镜像/旧冷备；回滚按 `p7/rollback-record.md` §3（现处情形 B：bind 已生效）。
- 本机 24h 浸泡采样（`eterna-rc5-e1`/`eterna-rc5-scale`）继续跑到满窗，摘要仅作事后观察证据（`p6b/waiver-24h.md`）。
- NAS 反代/DNS 未改动（端口与域名不变）。
