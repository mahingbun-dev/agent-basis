# PR · `feat/dsh-rc5-merge` → `main`：上游 DSH 0.2.2-rc.5 合并

- 任务：T53（54 §4.9 / §10.1；53 §7）
- 分支：`feat/dsh-rc5-merge`，HEAD `f1418dd`（已 merge `origin/main` = `282675c feat(panel): 流程启动条每用户可配置`）
- 边界：**未 `git push`、未合并、未部署、未停/改生产容器**；push/合并/部署待生产确认
- 依据：`docs/design/49-上游rc.5合并总设计.md`、`50-上游rc.5合并开发落地文档.md`、`51-上游rc.5合并测试用例与回归.md`、`54-rc.5开发与测试验收完整workflow.md`

## 0. 状态摘要

| 项 | 值 |
|---|---|
| 验收矩阵（164 条） | **PASS 159 / FAIL 0 / MISSING 5** |
| P0（102 条） | **101 PASS / 0 FAIL / 1 MISSING（RC5-API-005）** |
| 全工作区门禁 | `pnpm -w run verify` **EXIT=0**（pre-merge 与 post-merge 各一次：`artifacts/rc5/p7/verify-precommit.log`、`verify-postmerge.log`） |
| CI 本地镜像 | `ci.yml` 三个 job 的全部步骤本地逐条复跑 **EXIT=0**（install/verify/runtime-home/transplant/form-check/双 boot/packs lint/tenant-scan/prompt-scan/evals/v1-line；`artifacts/rc5/p7/ci-local.log`） |
| 最终镜像复跑 | `eterna-agent:rc5-test` = `sha256:22fe8acb436f2ce24ea7a6b790b08462b9b769e10b98acb096590352b739bcfb` |
| 未通过 5 条 | API-005/006/007（真模型 + realm 对齐）、TERM-013/DATA-009（24h 浸泡未满窗） |
| 合并条件 | 1 条 P0 缺失需补跑或签字豁免；浸泡满窗后复核 |

> 结论：代码门禁已全绿；P6 仅剩「真模型 worker E2E」与「24h 浸泡窗口」两类环境/时间依赖项，均已登记 leftover 与处置。

---

## 1. 摘要

以 `dsh-v0.2.2-rc.5`（上游 commit `9c2670d3…`，2026-11-18）为唯一目标版本，一次性完成：

- **L1 依赖族升级**：28 个 `@deepseek-ai/dsh-*` catalog 条目、cordis `4.1.0`、cosmokit `1.9.0` 全族对齐；
- **L2 上游派生重放**：profile/preset 模板、bundle 行集、prompt-studio 锚点、compaction fork、`core/cordis` vendor；
- **L3 新能力**：MCP 两层（系统层 admin / 个人层按用户）、office（WASM 转换）、chat-import、ACP stdio profile、terminal-panel 全量、hero 品牌浮层、实验 bundle 默认集、v1 双入口线；
- **W5 门禁修复**：workspaceFiles / mcpManager 一元面换血、个人 MCP 生命周期补挂、terminal 二次 confine 移除、决策层空壳探测；
- **部署面**：数据从 named volume 迁到 `$HOME/eterna-data/<instance>` 整树单挂载（容器内 `/data` 语义不变）、Dockerfile 钉 `dsh@0.2.2-rc.5`、compose 参数化（web/super/acp）。

这不是 `git merge`：本仓与上游无共同 git 历史，合并 = L1 升级 + L2 重放 + L3 选择性采纳（49 §0）。分支共 14 个 `rc5:`/`docs(rc5):` 提交 + 本 PR 的 W5 修复/证据提交。

---

## 2. 决策摘要（49 §4，2026-11-19 定稿）

| # | 决策 | 结论 | 关键约束 |
|---|---|---|---|
| D1 | rc.5 是否上生产 | **是** | `upgrade-gate` §7 书面例外 + 全门禁 + 旧镜像回滚 |
| D2 | 单段还是两段升级 | **直接 rc.5** | 无 rc.1 检查点；回滚靠旧镜像 + 冷备 |
| D3 | profile 迁移 | 预检 + 迁移脚本 | 坏 bundle 留痕，不静默 |
| D4 | MCP | **系统层 admin + 个人层按用户** | 普通用户可增删自己的；全局表仍 admin |
| D5 | office | **纳入** | WASM + 字体/Python + 输出限额 |
| D6 | worktree | **基于 `origin/main` 新建** | 不开脏树 |
| D7 | Dockerfile workaround | 单独实验后删 | 删不掉则保留并注因 |
| D8 | 上游实验 bundle | **默认集 + 可开/不可用矩阵** | 只默认 chat-import/session-search/plugin-market |
| D9 | access 新端点 | 漂移测试驱动 | 差集清零才放行 |
| D10 | 视觉 | 双主题 × 三视口硬门禁 | v4 令牌，无字面色值 |
| D11 | 回滚不可逆面 | 接受前向不兼容窗口 | rc.5 新会话只在 rc.5+ 打开 |
| D12 | chat-import | **支持** | 路由门 + workspaceOwner + 流式记账 |
| D13 | ACP | **加入** | 独立 profile/service，无端口，仅运维 |
| D14 | 默认集 | **chat-import / session-search / plugin-market** | session-search 按 cwd；市场写 admin |
| D15 | hero 品牌 | **合入并替换** | `@eterna/brand` 两 slot；官方品牌禁用 |
| D16 | terminal-panel | **全量应用（web+super）** | `readUserTerminals:false`；9 动作守卫 |
| D17 | WebWorker | **接受不产品化** | 不进镜像/profile |
| D18 | 单段回滚 | 旧镜像 + 冷备 | Phase 1 未全绿不进后续 |
| D19 | 数据根 | **`$HOME/eterna-data`** | 每实例子目录；0700 |
| D20 | v1 线 | **进本分支** | cordis 4.1.0；独立 CI 车道 |
| D21 | 干净 worktree | **`origin/main`** | 本分支由 worktree 新建 |
| D22 | 普通用户 MCP | **能（个人层）** | HTTP 接受 `http:`/任意 host，白名单暂关 |
| D23 | B14/B15 配套 | **不缩减** | 安全门/镜像清单全做 |
| D24 | 默认集确认 | **按 D14** | 迁移只追加一次，opt-out 不回加 |

> 原文：`docs/design/49-上游rc.5合并总设计.md:160-187`。

---

## 3. 变更面

| 层 | 主要内容 | 代表提交 |
|---|---|---|
| L1 依赖/API | catalog 28 条 `dsh-*` + cordis/cosmokit 对齐；peer 补 8 个；H1 `LlmError.fromFailure`；H2 tasks 改 `waitForTreeWork/listDescendants/drainDescendants`；行为项（LoggerLevel 数值、投影帧、`GenerateOptions`、`ToolGuardDenial`、`PluginTabProps.update()`） | `02f4857` |
| L2 profile/preset | profile 模板（web/super 共用基础 + super 补丁 + 新增 acp 补丁）、6 项 bundle 清单（base/web-app/chat-import/session-search/plugin-market/terminal；ACP 只 base+acp-app）、bundle/mcp-servers 迁移脚本、prompt 锚点 | `67aac03` `6930e92` |
| L3 access/租户 | `mcp-personal.ts`（5 RPC + AES-256-GCM + stdio 目录白名单 + 元数据拒）、`GATEWAY_SETTINGS_NS` 扩到 `{llm-pi-ai, mcp-manager}`、terminal 9 动作入 mux（stream: attach/retain/watch；unary: close/create/environment/list/rename/shells）、chat-import 路由门 | `e5231cb` |
| L3 tasks | rc.5 subagent 树 API 适配 + LLM/命令内核适配 | `e71e33d` |
| L3 客户端 | 10 包 `build-client` 重建 + brand hero（`conversation.hero.frame` / `.brand.mark`） | `5b91c5f` |
| v1 线 | `core/{cordis,contracts,runtime}`、`basis.yml`、6 个 `@basis/*`；独立 CI `v1-line` 车道 | `7dafc9c` |
| 部署/数据 | Dockerfile 钉 `dsh@0.2.2-rc.5` + 字体/Python + 构建期断言；entrypoint ACP 无全局 `exec 1>&2`；compose 参数化 + `$HOME/eterna-data/<instance>:/data` | `ccd9380` |
| W5 修复 | workspaceFiles 一元面换血（ACC-008/SEC-004）；mcpManager 仅 admin（MCPS-006/SEC-005）；个人 MCP `agentsOf`/`mountSession` 补挂 + parentSession 上溯 + reconnect 3 次；移除 terminal 本地二次 confine（TERM-006）；决策层空壳探测（UI-006）；`deepseekChatImport/limits` 门 | 本 PR |
| 证据/文档 | 验证脚本与夹具、54 号 workflow、全车道复跑证据、验收矩阵、PR/发布/回滚记录 | `a72d187` `a89a73a` `6375f27` `c75f876` + 本 PR |

**默认 bundle 集**（`docker/profile/package.json`）：`base + web-app + deepseek-chat-import + experimental-session-search + experimental-plugin-market-bundle + experimental-terminal-bundle`；
`package.acp.json`：`base + acp-app`。

---

## 4. 测试结果

### 4.1 最终镜像车道结果

最终镜像：`eterna-agent:rc5-test` = `sha256:22fe8acb436f2ce24ea7a6b790b08462b9b769e10b98acb096590352b739bcfb`。

| 车道 | 结果 |
|---|---|
| E1（BOOT 11 / CMD 4 / HERO 8 / IMP 10 / MCPS 11 / OFF 7 / TERM 8） | 58 PASS / 0 FAIL / 1 NOTRUN（TERM-013 等浸泡） |
| E2（ACC 10 / LLM 5 / MCPP 24 / SEC 7 / TERM 16 / UI 8） | 67 PASS / 0 FAIL（MCPP 3 条 SKIP 由 LLM 车道覆盖） |
| E3（super） | 18 PASS / 0 FAIL / 5 NOTRUN（API-005/006/007、TERM-013、E3-UI-002） |
| 矩阵（164 条） | **159 PASS / 0 FAIL / 5 MISSING**（`artifacts/rc5/acceptance-matrix.md`） |
| 全工作区门禁 | **EXIT=0**（38 个 workspace 包 `verify: Done`；pre-merge `verify-precommit.log`、post-merge `verify-postmerge.log`） |

### 4.2 P0 结果表（102 条）

| 套件 | P0 总数 | PASS | FAIL | MISSING |
|---|---:|---:|---:|---:|
| ACC | 8 | 8 | 0 | 0 |
| ACP | 7 | 7 | 0 | 0 |
| API | 5 | 4 | 0 | 1 |
| BOOT | 11 | 11 | 0 | 0 |
| DATA | 8 | 8 | 0 | 0 |
| ENV | 6 | 6 | 0 | 0 |
| HERO | 3 | 3 | 0 | 0 |
| IMP | 5 | 5 | 0 | 0 |
| MCPP | 16 | 16 | 0 | 0 |
| MCPS | 7 | 7 | 0 | 0 |
| OFF | 3 | 3 | 0 | 0 |
| SEC | 7 | 7 | 0 | 0 |
| TERM | 9 | 9 | 0 | 0 |
| UI | 2 | 2 | 0 | 0 |
| V1 | 5 | 5 | 0 | 0 |
| **合计** | **102** | **101** | **0** | **1** |

- 唯一 P0 缺失：`RC5-API-005`（主会话派 2 worker / `waitForTreeWork` 全完成）。E3 实测阻断：模型 `AUTH 401 invalid API Key` + `realm=Mr.Ma 不在 access 用户表`；P7 回归 harness 已用**真实 tasks 装配 + stub 模型**跑通 2 worker 真回执/`listDescendants`/`drainDescendants`（`artifacts/rc5/p7/regression/rerun/API/out/results.json`），但按 51「真 worker」口径仍记 MISSING（见 §8.2）。
- 164 行矩阵中其余 4 条 MISSING：API-006/007（同前置）、TERM-013/DATA-009（24h 浸泡未满窗）。

### 4.3 关键修复的复验证据

| 修复 | 证据 |
|---|---|
| 跨租户文件面 ACC-008 / SEC-004 | `artifacts/rc5/E2/ACC/RC5-ACC-008/result.md`、`artifacts/rc5/E2/SEC/RC5-SEC-004/result.md`（PASS） |
| 系统 MCP 管理面 MCPS-006 / SEC-005 | `artifacts/rc5/E1/MCPS/RC5-MCPS-006/result.md`、`artifacts/rc5/E2/SEC/RC5-SEC-005/result.md`（PASS） |
| terminal TERM-006 / UI-006 | `artifacts/rc5/E2/TERM/RC5-TERM-006/result.md`、`artifacts/rc5/E2/UI/RC5-UI-006/`（PASS，含双主题三视口截图） |
| 镜像不含测试夹具 ENV-004 | `artifacts/rc5/ENV/RC5-ENV-004/result.md`（PASS） |
| 口令字面量 SEC-002 | `artifacts/rc5/SEC/RC5-SEC-002/`（PASS） |
| 旧数据升级 SEC-010 | `artifacts/rc5/E2/SEC/RC5-SEC-010/result.md`（PASS：旧会话逐字一致、记忆/提示词不变、可续聊） |

---

## 5. 已知风险（49 §11，产品书面接受）

| 风险 | 接受理由 | 控制（本轮落实） | 发布说明措辞 |
|---|---|---|---|
| **H16 个人 MCP HTTP 可访问内网** | localhost/内网 MCP 是真实需求 | 拒云元数据（`169.254.169.254`/`fd00:ec2::254`）；`personalHttpHosts` 空=全放行、非空=白名单；8 条/4 连接/8s 启动/60s 调用/256KB；`mcp.personal.enabled=false` kill switch；审计只记账号/条目/transport/host | “个人 MCP 的 HTTP 传输可访问内网；默认放行，管理员可收紧或关闭” |
| **H7 回滚后 rc.5 新会话不可读** | 上游持久化变更（新增 `team/mode` 事件与 catalog v3） | 回滚演练只验证旧会话（DATA-010 PASS）；发布说明明示；回滚前导出 | “rc.5 期间新建会话在回滚后不可打开；回滚前请导出” |
| **terminal 接管不可交还 / 不读 HISTFILE** | 上游语义 | `readUserTerminals:false`、`preferredShells:[bash]`、9 动作全部登记 access、默认 sandbox | “终端面板接管后不可交还；不读取用户 HISTFILE” |
| rc.5 预发布上生产 | 产品拍板 + 全门禁 | 精确钉 `0.2.2-rc.5`；旧镜像 digest + `/data` 冷备；`upgrade-gate` §7 例外 | “上游预发布版本；升级后不可回退到 rc.1 中间态” |
| 单段升级无中间回滚点 | rc.1 破坏面与 rc.5 重叠 | 回滚 = 旧镜像 + 旧卷/冷备；不提供 rc.5→rc.1 中间版本 | 同左 |
| v1 双内核同仓 | 产品拍板 v1 进分支 | 独立入口 `core/runtime/bin/basis.mjs`、独立 CI `v1-line`、**不进镜像** | “仓库含 v1 独立内核，仅供开发/兼容，不随生产镜像发布” |

> 原文：`docs/design/49-上游rc.5合并总设计.md:423-432`；控制项代码位：`packages/access/src/mcp-personal.ts`、`docker/profile/cordis.patch.yml.template`。

---

## 6. 回滚方式（旧镜像 + 冷备）

| 项 | 值 |
|---|---|
| 升级前生产镜像 | `eterna-agent:0.1.51` = `sha256:3ca0d66055898b092f09761e5f67baa4a82741f1c7233d27bd2ddbd6de2b1a7b` |
| 次选回滚镜像 | `eterna-agent:0.1.50` = `sha256:6b306037b6593d94e7c797a97f15e8fb7f60fe97f871fd673da6ce659e7b2052` |
| 更早兜底 | `eterna-agent:0.1.38` = `sha256:b0dbe8bc6da4c918ee1a848548d92980d8caba4bb5301b26c5878932b5ae95e1` |
| 冷备 | `/Users/sunny/eterna-data/backups/rc5-2026-11-20/eterna-home-20261120-021802.tgz`，26,566,225 B，`sha256:5976686ff2caab6a668c7231daded925c10053e062b9d4b28ecb31e61fbbd281`，10,466 条目，16 个 SQLite 全部 `integrity_check=ok` |
| 生产 compose/卷 | `/Users/sunny/code/agent-basis-main-0.1.51`，`-p agent-basis`，named volume `agent-basis_eterna-home` → `/data`（未改动） |

```bash
docker compose -p agent-basis down          # 不删卷
# 恢复旧 compose（external: true + named volume），镜像指回 0.1.51
docker compose -p agent-basis up -d
bash deploy/verify.sh http://127.0.0.1:3210
```

- 回滚点/命令/判定/演练状态完整记录：`artifacts/rc5/p7/rollback-record.md`。
- 回滚演练（DATA-010）：PASS（旧镜像在旧卷副本上正常服务）。
- **H7**：回滚后 rc.5 期间新建的会话不可打开；回滚前先导出。

---

## 7. 证据索引

| 路径 | 内容 |
|---|---|
| `artifacts/rc5/acceptance-matrix.md` | 164 行验收矩阵（159/0/5；生成器 `scripts/rc5-acceptance-matrix.mjs`） |
| `artifacts/rc5/E1/*/summary.json`、`E2/*/summary.json` | 最终镜像车道汇总（镜像 id、容器、数据根） |
| `artifacts/rc5/e3-super/*/report.json` | E3 super 逐用例报告（18 PASS / 5 NOTRUN） |
| `artifacts/rc5/p6a/rerun-{e1,e2,e3,acp}-final.log` | 最终镜像全车道复跑命令与 EXIT 原文 |
| `artifacts/rc5/p7/verify-precommit.log` / `verify-postmerge.log` | `pnpm -w run verify` 全工作区 EXIT=0（合并 main 前后各一次） |
| `artifacts/rc5/p7/ci-local.log` | `ci.yml` 全步骤本地镜像（35 个 EXIT=0，含双 boot/扫描/evals/v1-line） |
| `artifacts/rc5/E2/SEC/RC5-SEC-010/result.md` | 旧数据升级验证 |
| `artifacts/rc5/p6b/soak/final-image2/` | 24h 浸泡 meta/term/data 采样（未满窗） |
| `artifacts/rc5/p7/regression/rerun/API/out/results.json` | API-005/006/007 真实 tasks 装配 harness（stub 模型） |
| `artifacts/rc5/p7/PR.md` / `release-notes.md` / `rollback-record.md` | 本描述、发布说明、回滚记录 |

> 证据已脱敏（`artifacts/rc5/p7/regression/SANITIZE.md`）；不含 cookie/token/密钥明文。

---

## 8. 门禁状态与合并条件

### 8.1 已绿（有证据）

- 164 行矩阵 159 PASS / 0 FAIL；P0 101/102。
- `pnpm -w run verify` 全工作区 EXIT=0（38 包；merge `origin/main` 前后各一次）。
- `ci.yml` 全步骤本地镜像 EXIT=0（`ci-local.log`，含双 boot、tenant-scan、prompt-scan、evals、v1-line）。
- 最终镜像 E1/E2/E3 全车道复跑；TERM-002/005/006、API-004 等此前红项均在最终镜像转绿。
- 迁移两遍、全库 integrity、回滚演练（DATA-004/005/010）PASS。
- 双主题 × 三视口 UI 截图 24 张已归档（`artifacts/rc5/E2/UI/RC5-UI-006/`、`E2/MCPP/RC5-MCPP-024/`）。
- 旧数据升级 SEC-010 PASS。

### 8.2 未绿（阻塞合并/上线）

1. **RC5-API-005（P0）**：主会话派 2 worker 的 app 级 E2E 未成立。E3 实测 `AUTH 401 invalid API Key` + `realm=Mr.Ma 不在 access 用户表`；P7 harness（stub 模型 + 真实 tasks 装配）已跑通但按 51 口径记 MISSING。
   - 出路：真模型 + realm 对齐后补跑，或产品签字豁免。
2. **API-006/007（P1）**：`listDescendants`/`drainDescendants` 无公开 RPC，需真实后代树；harness 已覆盖，app 级未覆盖。
3. **TERM-013 / DATA-009（P1）**：24h 浸泡未满窗（`final-image2`，`plannedEndAt=2026-11-21T06:08:06.781Z`）；DATA-009 现行 soak 为 2 writers / 5min，未达 48 §4.5 的 ≥50 并发 + 2h 全库 integrity。
4. **远端 CI 未跑**：分支未 push；`ci.yml` 全步骤已在本地逐条复跑 EXIT=0（`ci-local.log`），但远端 `upgrade-gate` / `v1-line` 仍无运行记录，不得以本地代替。
5. **签字**：`artifacts/rc5/p7/regression/signoff.md` 四方签字栏未签。

### 8.3 解除条件

- API-005 真模型/realm 补跑通过，或产品签字豁免；
- 24h 浸泡满窗（2026-11-21T06:08:06Z 后）复核 TERM-013/DATA-009；
- CI 全绿（含 `v1-line`）+ 人工复核；
- 四方签字。

---

## 9. 本 PR 未做的事（边界声明）

- 未 `git push`、未创建远端分支、未合并、未部署；
- 未停/改生产容器 `eterna-agent`，未改生产 compose；
- 未写 `/Users/sunny/code/deepseek-harness`；未碰 `/Users/sunny/code/agent-basis` 工作树；
- 未把凭据写入任何被跟踪文件/日志/argv；
- 浸泡容器 `eterna-rc5-e1` 保持运行（`final-image2` 窗口），不受本 PR 影响。