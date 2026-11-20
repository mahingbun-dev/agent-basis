# RC5-DATA-007 · 迁移副本起 rc.5 容器 + 重启后数据全在

- 依据：51 §3.14 DATA-007；48 §7.4/§7.5（起容器→验收→重启后状态不丢）
- 对象：**生产冷备副本** `p6b-e5a`（第一遍迁移副本）→ rc.5 容器 `eterna-rc5-p6b-a`
  （镜像 `eterna-agent:rc5-test` = `sha256:99d8e85b509b`；端口 3230/9330；
  compose 项目 `rc5-p6b`；独立数据根；**未触碰生产 `eterna-agent`/E1/E3**）
- 凭据：只存在于 0600 的 `~/eterna-data/test-rc5/.env.p6b-a`（不入仓、不入证据、不进 argv）

## 实跑序列（EXIT 见 `cmd.log` 头注）

1. pre-boot 数据快照（容器 `--network none`，root 只读）→ `preboot.json`
2. `docker compose -p rc5-p6b --env-file … up -d --no-build` → EXIT=0，3s 内 healthy
3. post-boot 快照 → `postboot.json`
4. `docker restart eterna-rc5-p6b-a` → EXIT=0，7s healthy
5. post-restart 快照 → `postrestart.json`
6. 启动后全库 integrity_check → `../RC5-DATA-005/postboot-drill1.json`（17/17 ok）

## 启动日志要点（`container-boot.log`，bootstrap token 已脱敏）

- profile 由 rc.5 super 模板重渲染；移植用户标记 2 处、**保留用户新增 LLM provider `baidu-token-plan`**
- 工坊托管值移植 1 处（`preset.standard.persona`）
- 默认 bundle 追加 3 个（chat-import / session-search / terminal-bundle），
  `profile-upgrade-check` 移除 1 个已下架 bundle（agent-team-profile），留痕 `.upgrade-removed-bundles.json`
- MCP servers 零写（新模板自带 mcp-client 行承载 browser，避免双实例）
- 无 FATAL

## 数据面比对（pre → post → restart）

| 指标 | pre-boot | post-boot | post-restart |
|---|---|---|---|
| users 行数 | 2 | 2 | 2 |
| access `sessions` 行数 | 145 | 145 | 145 |
| workspaces | 3 | 3 | 3 |
| `.eterna` 记忆实体 / 域 | 12 / 15 | 12 / 15 | 12 / 15 |
| 工作区记忆实体 | 24 | 24 | 24 |
| tasks thread | 1 | 1 | 1 |
| sessions 文件数 | 396 | 396 | 396 |
| storages 文件数（提示词工坊快照） | 353 | 353 | 353 |
| relay-token sha256 | `913dbafe…4272b` | 同 | 同 |
| `.credentials.yaml` 权限 | 600 | 600 | 600 |
| profile 文件指纹 | — | 迁移后 | 与 post-boot 一致 |
| 总文件数 | 8620 | 8625 | 8625 |

HTTP（重启后）：`/login` 200、匿名 `/access/api/me` 401、`/` 302→`/login`。

断言（20/20 PASS）：上表全部等值 + 容器 healthy + start 时间晚于创建时间 + 无 FATAL。

## 备注（观察，不影响本 case 判定）

- 重启时 dsh 重写了一个会话归档 `sessions/--data-workspaces-Mr.Ma--/orchestrator-Mr.Ma/session.v4.jsonl.zstd`
  （post-boot 200,746 B → 重启后同文件变化，sessions 文件数不变；全库 integrity ok）。
- rc.5 对**带工坊编辑的存量 profile** 每次重启都走「模板变更/首启接管」重渲染路径
  （内容幂等：post-boot 与 post-restart 的 profile 指纹一致）；同一份数据用 0.1.51 起时走的是
  「模板未变，保留用户文件」keep 路径（见 DATA-010 `old-container.log`）。已记 leftover。

## 结论

**PASS**。生产数据副本在 rc.5 上正常启动，用户/会话/工作区/记忆/任务/提示词工坊/relay token 全部保留，
重启前后逐项一致，全库 integrity ok。
## 收尾

验收完成后执行 `docker stop -t 30 eterna-rc5-p6b-a`（EXIT=0，见 `../../p6b/boundary-check.log`），
释放 CPU/端口；数据根 `$HOME/eterna-data/test-rc5/p6b-e5a` 与全部证据保留。上文状态断言均为停止前实测。
