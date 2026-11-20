# 发布说明 · EternaAgent 上游 DSH 0.2.2-rc.5 合并（草案，未发布）

- 任务：T56（54 §4.9 / §10.4；51 §6.2；49 §11）
- 版本：产品镜像 **`eterna-agent:0.2.0-rc.5` = `sha256:57ab618f41079a7029fc541944e2f5f77d1f6aeefd56137dce303f80a473fb14`**（自 latest main `343ea70` 构建），内核 `@deepseek-ai/dsh* = 0.2.2-rc.5`（cordis 4.1.0 / cosmokit 1.9.0）
- 合并：PR **#137** 已合并（merge commit `343ea70`，远端 CI 全绿）；**2026-11-21T16:47Z 已部署生产**（停机 100s，`p7/deploy-record.md`）
- 依据：`docs/design/49-上游rc.5合并总设计.md`、`docs/design/51-上游rc.5合并测试用例与回归.md` §6.2、`docs/design/54-rc.5开发与测试验收完整workflow.md` §10.4/§10.6、`docs/upgrade-gate.md` §7
- 状态：**已上线（2026-11-21）。产品门禁全绿（矩阵 162 PASS / 0 FAIL / 0 MISSING / 2 WAIVED，P0 102/102）；24h 满窗判据经产品签字豁免。剩上线后 24h 观察与四方补签（§8）。**

> **发布前提**：远端 CI 绿；`verify.sh` 绿；四方签字（产品对 24h 豁免的签字已落字）。P0 已 **102/102** 通过（API-005 真模型档已 PASS）；24h 浸泡满窗判据经产品豁免（`artifacts/rc5/p6b/waiver-24h.{json,md}`），残余风险由上线后 24h 观察覆盖。

---

## 1. 版本与例外记录（`upgrade-gate` §7）

`docs/upgrade-gate.md:83-86` 规定：`-rc.*` / `-alpha.*` 预发布版本**不上生产**，只允许进开发分支演练。本次上生产属于**书面例外**，范围与依据：

| 项 | 记录 |
|---|---|
| 例外对象 | `@deepseek-ai/dsh* = 0.2.2-rc.5`（上游 tag `dsh-v0.2.2-rc.5` = `9c2670d3bce5275e0d1610272958121af87787bb`，2026-11-18） |
| 例外范围 | **仅覆盖 `0.2.2-rc.5`**；不覆盖后续 rc/alpha，不构成常态放行 |
| 授权出处 | 49 §2.1「生产例外」行、49 §4 D1（产品拍板「是」）、54 §10.6 风险表首行 |
| 前置条件 | 全门禁（E0–E5）+ 精确钉版 + 旧镜像 digest + `/data` 冷备 + 回滚演练 |
| 未提供之物 | 独立签字例外单尚未签；当前依据是设计文档条目 + `artifacts/rc5/p7/regression/signoff.md` 签字栏（待四方签字） |

**对用户的影响**：升级后**不可回退到 rc.1 中间态**；回滚只有「旧镜像 + 旧卷/冷备」一条路（§6）。

---

## 2. 本版内容

| 能力 | 说明 |
|---|---|
| 内核升级 | 全仓依赖族统一 `0.2.2-rc.5`；修复 `LlmError` 构造器、subagent 树 API、客户端跨 release 拒收三个确定性破坏面 |
| MCP 两层 | 系统层仍由管理员维护全局表；**新增个人层**：每个用户可增删自己的 MCP 服务器，仅本人 Agent scope 可见 |
| office | 文档转换（docx/xlsx/pptx）由 WASM 在容器内完成；输出落 `/data/office-kit/outputs/session-*`，24h/512MB 自清理 |
| chat-import | 支持导入 DeepSeek 聊天归档；路由由 access 门保护（未登录 401、跨用户 403） |
| ACP | 新增独立 `eterna-acp` profile/service（stdio，无端口），仅运维本机可用，不暴露给终端用户 |
| terminal-panel | web/super 形态全量启用；6 个 `terminal_*` 工具 + 侧栏旁观/首次按键接管 |
| hero 品牌 | 首页品牌浮层替换为 `@eterna/brand`；官方品牌 UI 保持禁用 |
| 实验 bundle | 默认开 chat-import / session-search / plugin-market / terminal；其余默认关、插件页可开 |
| v1 线 | 仓库含 v1 独立内核（`core/*` + 6 个 `@basis/*`），**仅供开发/兼容，不随生产镜像发布** |
| 数据面 | 容器内 `/data` 语义不变；宿主数据根改为 `$HOME/eterna-data/<instance>`（0700），整树单挂载 |

默认 bundle 集：`base + web-app + deepseek-chat-import + experimental-session-search + experimental-plugin-market-bundle + experimental-terminal-bundle`。

---

## 3. MCP HTTP 策略（H16，产品已接受）

**一句话**：个人 MCP 的 HTTP 传输**可以访问本机/内网地址**；这是为 localhost/内网 MCP 的真实需求而接受的产品风险，不是漏洞豁免。

| 层 | 谁能管理 | 存储 | 传输与边界 |
|---|---|---|---|
| 系统层 | 仅 admin | profile `mcp-manager.config.servers` | stdio/HTTP 由 admin 决定；普通用户 `watch/restart/probe` 应被拒（本轮仍有缺口，见 §7） |
| 个人层 | 每个用户（仅自己的） | `/data/access` 的 `mcp_personal_server` / `mcp_personal_secret`（密钥 AES-256-GCM） | stdio 只认管理员目录，自填 `command` 一律 400；HTTP 接受 `http:`/`https:` 任意 host |

个人层硬边界（`packages/access/src/mcp-personal.ts`）：

- 拒云元数据地址 `169.254.169.254` / `fd00:ec2::254`（`:425-437`）；
- `mcp.personal.personalHttpHosts`（或 `ETERNA_MCP_PERSONAL_HTTP_HOSTS`）：**空 = 全放行；非空 = 只允许精确 host / host:port / `*.suffix`**——这是随时可收紧的白名单开关；
- 限额：8 条/用户、4 连接/用户、8s 启动、60s 调用（probe 10s）、配置 ≤256KB、`serverName=p<uid>_<slug>` ≤32；
- kill switch：`mcp.personal.enabled=false`（或 `ETERNA_MCP_PERSONAL_ENABLED=0`）→ 整面不挂载并拒绝；缺主密钥同样 fail-closed；
- 审计只记账号/条目名/transport/host，不记 headers/env/args 原值；日志/错误中密钥 redacted。

**给用户的话**：请只添加你信任的内网/本机 MCP 服务；管理员可随时收紧白名单或整体关闭个人层。

---

## 4. 已知风险（49 §11）

### 4.1 H7 · 回滚后 rc.5 新会话不可读

rc.5 的会话持久化新增 `team/mode` 事件与 catalog v3；旧 rc.1 内核读新日志会被拒。因此：

- **回滚后，rc.5 期间新建的会话不可打开**（旧会话不受影响）；
- 回滚演练只验证旧会话；
- **回滚前请先导出需要保留的新会话**；
- 不提供 rc.5 → rc.1 的中间版本。

### 4.2 H16 · 个人 MCP HTTP 的内网访问面

见 §3：localhost/私网可达是**已接受的产品风险**；控制项为元数据拒绝、限额、审计、kill switch 与可收紧白名单。

### 4.3 其余已接受边界

| 项 | 说明 |
|---|---|
| 上游预发布上生产 | 精确钉 `0.2.2-rc.5`，`upgrade-gate` §7 书面例外（§1） |
| 单段升级 | 无 rc.1 检查点；回滚 = 旧镜像 + 旧卷/冷备 |
| terminal 接管 | 见 §5 |
| v1 双内核同仓 | 独立入口/独立 CI 车道/不进镜像 |

---

## 5. terminal 限制（必读）

- **接管后不可交还**：用户从侧栏首次按键接管终端后，控制权不再交回 Agent（上游语义）；
- **不读取用户 HISTFILE**：`readUserTerminals:false`，容器内固定 `bash`（`docker/profile/cordis.patch.yml.template:174-178`、`cordis.super.patch.yml.template` 同构）；
- Agent 侧 6 个 `terminal_*` 工具；远程 9 个动作（`attach/close/create/environment/list/rename/retain/shells/watch`）全部登记 access，按 `sessionId` 查属主，跨用户 deny；
- 默认 sandbox 不放宽；资源耗尽时的处置是「从 profile 移除 terminal bundle（需重建 profile）」。

---

## 6. 数据与回滚

- 容器内路径不变：`DSH_HOME=/data`、`working_dir=/data`、`DSH_AGENTS_HOME=/data/agents`；宿主侧改为 `${ETERNA_DATA_ROOT:-$HOME/eterna-data}/<instance>:/data`，目录 0700。
- 旧 named volume `agent-basis_eterna-home` **保留**为回滚点，稳定 ≥7 天后再考虑删除。
- 冷备：`/Users/sunny/eterna-data/backups/rc5-2026-11-20/eterna-home-20261120-021802.tgz`（`sha256:5976686f…b281`，16 个 SQLite `integrity_check=ok`）。
- **回滚命令**（旧镜像 + 旧卷）：

```bash
docker compose -p agent-basis down          # 不删卷
# 恢复旧 compose（external: true + named volume），镜像指回升级前实际运行的 tag
#（本次基线 eterna-agent:0.1.51；digest 与次选 0.1.50 见回滚记录 §1）
docker compose -p agent-basis up -d
bash deploy/verify.sh http://127.0.0.1:3210
```

完整回滚点（digest）、冷备校验与演练缺口见 `artifacts/rc5/p7/rollback-record.md`；产品侧恢复步骤见 48 §7.6。

---

## 7. 已知问题（发布前须补跑或签字豁免）

| # | 问题 | 级别 | 影响与现状 |
|---|---|---|---|
| 1 | 24h 浸泡满窗判据（TERM-013/DATA-009）：**产品签字豁免**（2026-11-21 00:28，指令「不用等24小时了，直接进行接下来的流程」）；决策时点主 soak 10.3h、规模 8.9h 全健康（609 tick churn 全 ok、fd 292→280、写/锁/integrity 0 异常） | P1（豁免，WAIVED） | 采样跑到满窗（06:08Z/07:37Z）作事后观察证据；残余风险由上线后 24h 观察覆盖（§8） |
| 2 | R22 任务角色 prompt/preset 接线：super profile `bundles` 未含 `@eterna/tasks`，orchestrator/worker preset 与角色 prompt 未生效 | P1（产品遗留，非 RC5 回归） | 主会话按标准 preset 创建，可能自行派 subagent 与 tasks 路由重复；**不影响 API-005/006/007 判据**；随下一次镜像变更窗口修复（`p7/doc54-delivery-audit.md` §2.1） |
| 3 | 四方签字未完成（`artifacts/rc5/p7/regression/signoff.md`；产品对 24h 豁免的签字已落字） | P0 | 合并/上线前补签 |
| 4 | CI 未跑（分支未 push；`upgrade-gate` / `v1-line` 无运行记录） | P0 | push 后以 CI 为准，不以本地结果代替 |

> 已清零项（本轮最终镜像复验）：**API-005/006/007 真模型档 PASS**（E3，`mimo/mimo-v2.6-pro`）、跨租户文件面 ACC-008/SEC-004、系统 MCP 管理面 MCPS-006/SEC-005、terminal TERM-006/008、镜像夹具 ENV-004、口令字面量 SEC-002、UI-006 双主题三视口、迁移两遍/全库 integrity/回滚演练 DATA-004/005/010。
> 明细与证据：`artifacts/rc5/acceptance-matrix.md` §遗留项（现行）、`artifacts/rc5/p7/regression/signoff.md`；T52 的 `leftovers.md` 为历史快照（顶部有说明）。

---

## 8. 上线后准出（51 §6.2，发布时逐条勾）

- [ ] `bash deploy/verify.sh http://127.0.0.1:3210` 绿；
- [ ] 登录 / 对话 / 文件 / 记忆 / 工作台冒烟；
- [ ] ACP stdio 冒烟（如启用）；
- [ ] 24h 观察无 P0 级告警（承担 24h 豁免的残余风险）；
- [x] 本说明记录 rc.5 例外、MCP HTTP 策略、H7/H16、terminal 限制（§1/§3/§4/§5 已就位）；
- [x] API-005/006/007 真模型档 PASS（E3 `mimo/mimo-v2.6-pro`；证据 `artifacts/rc5/e3-super/API-005-real-model.md`、`artifacts/rc5/e3-super/real-harness/`）；
- [x] 24h 满窗判据产品豁免已登记（2026-11-21 00:28，`p6b/waiver-24h.{json,md}`）。

---

## 9. 变更记录

| 日期 | 变更 |
|---|---|
| 2026-11-20 | 草案创建（T56）：写入 rc.5 例外、MCP HTTP、H7/H16、terminal 限制、回滚入口 |
| 2026-11-20 | 最终镜像全车道复跑后更新：门禁 159 PASS / 0 FAIL / 5 MISSING；§7 收敛为 5 类环境/时间依赖项；补 DATA-004/005/010 已 PASS |
| 2026-11-20 | API-005/006/007 真模型补跑 PASS（E3）：门禁 **162 PASS / 0 FAIL / 2 MISSING**，P0 **102/102**；§7 收敛为 2 条 24h 时间窗 + R22 + 签字/CI |
| 2026-11-21 | 产品豁免 24h 满窗判据（TERM-013/DATA-009 → WAIVED）：矩阵 **162 PASS / 0 FAIL / 0 MISSING / 2 WAIVED**；P6 收口，P7 启动（push → PR → 合并 → 部署） |