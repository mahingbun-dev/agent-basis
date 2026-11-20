# rc.5 测试验收矩阵（164 条）

- 生成时间：2026-11-20T07:22:20Z
- 汇编：T50（54 §5.4 / §7.1 / §7.3；51 §0.3 / §6.3）
- 工作树：`/Users/sunny/code/agent-basis-rc5`（`feat/dsh-rc5-merge`，HEAD `f1418dd`）
- 用例定义：`docs/design/51-上游rc.5合并测试用例与回归.md` §3（164 条）；阶段映射：`docs/design/54-rc.5开发与测试验收完整workflow.md` §5.1/§5.2

## 判定规则（只取真实证据）

- **PASS**：引用证据含命令日志（`cmd.log` / run 日志）与结果记录（`result.md`；ACP 用 `assert.json`、MCPS P2 用 `report.md`），且退出码符合（`EXIT 0` / HTTP `200` / 负控期望值），结果记录判 PASS。
- **FAIL**：任一引用证据判 FAIL（断言未满足）。失败用例保留原始日志，不裁剪。
- **MISSING**：SKIP / NOTRUN / 未执行 / 无结果记录；不得标绿，不计入通过。
- 证据根：`artifacts/rc5/<suite>/<case-id>/`（E1/E2/E3 的套件证据在 `artifacts/rc5/E1|E2|e3-super/...`，阶段列仍按 54 §5.1/§5.2 的首跑阶段）。
- 文件命名偏差：ACP 10 条以 `assert.json` 为结果记录；MCPS-008/011 以 `report.md + run*.log` 为记录；ENV-004/005、V1-008 用 P5 镜像运行时探针补运行时半。均登记在 leftover `EVID-*`。
- **脱敏**：本矩阵只写路径、状态与结论摘要；不写 cookie/token/MCP headers/密钥/口令明文。

## 总览

| 状态 | 条数 |
|---|---:|
| PASS | 159 |
| FAIL | 0 |
| MISSING | 5 |
| **合计** | **164** |

> **当前不可判绿**：FAIL 0 条；MISSING 5 条，其中 P0 1 条（RC5-API-005）。P6 未收口，P7 不得启动。

### 套件 × 状态

| 套件 | 总数 | PASS | FAIL | MISSING |
|---|---:|---:|---:|---:|
| ENV | 8 | 8 | 0 | 0 |
| BOOT | 13 | 13 | 0 | 0 |
| API | 9 | 6 | 0 | 3 |
| ACC | 10 | 10 | 0 | 0 |
| MCPS | 11 | 11 | 0 | 0 |
| MCPP | 24 | 24 | 0 | 0 |
| TERM | 14 | 13 | 0 | 1 |
| IMP | 10 | 10 | 0 | 0 |
| ACP | 10 | 10 | 0 | 0 |
| OFF | 7 | 7 | 0 | 0 |
| HERO | 8 | 8 | 0 | 0 |
| CMD | 4 | 4 | 0 | 0 |
| V1 | 8 | 8 | 0 | 0 |
| DATA | 10 | 9 | 0 | 1 |
| UI | 8 | 8 | 0 | 0 |
| SEC | 10 | 10 | 0 | 0 |
| **合计** | **164** | **159** | **0** | **5** |

### 阶段 × 状态

| 阶段 | 总数 | PASS | FAIL | MISSING |
|---|---:|---:|---:|---:|
| P1 | 10 | 10 | 0 | 0 |
| P2 | 12 | 12 | 0 | 0 |
| P3 | 7 | 7 | 0 | 0 |
| P4 | 17 | 17 | 0 | 0 |
| P5 | 16 | 16 | 0 | 0 |
| P6a | 97 | 93 | 0 | 4 |
| P6b | 5 | 4 | 0 | 1 |
| **合计** | **164** | **159** | **0** | **5** |

## 24h 浸泡窗口（DATA-009 / TERM-013）

- soak 启动：`2026-11-20T06:08:06.781Z`；计划结束：`2026-11-21T06:08:06.781Z`（86400s）
- 窗口：tag=`24h-final2`，容器=`eterna-rc5-e1`，镜像=final-image2（`sha256:22fe8acb436f…`）
- 最新采样：已观测 **1.24 h / 24 h**（5.2%），`windowComplete=false`
- 结论：**未满窗口，不得判绿**；DATA-009 = MISSING，TERM-013 = MISSING
- 最新 TERM tick：`{"at":"2026-11-20T07:21:44.094Z","elapsedSeconds":4416,"dshPid":1,"fds":66,"rssKb":475900,"threads":11,"longProcs":1,"churn":"ok","probeExit":0}`
- 最新 DATA tick：`{"at":"2026-11-20T07:19:41.743Z","elapsedSeconds":4294,"databases":[{"file":"access/users.db","walBytes":424392,"shmBytes":32768,"ok":true,"journal":"wal","integrity":["ok"],"sessions":481},{"file":".eterna/memory.sqlite`
- leftover：`SOAK-24H`、`TERM013-DATA009`


## P0 未通过清单（门禁红/缺失）
| id | 阶段 | 状态 | 摘要 |
|---|---|---|---|
| RC5-API-005 | P6a | MISSING | 主会话派 2 worker/waitForTreeWork 全完成 |

## 164 行矩阵

| case | id | phase | status | evidence | owner |
|---|---|---|---|---|---|
| pnpm install --frozen-lockfile（EXIT 0/锁不变） | RC5-ENV-001 | P1 | PASS | artifacts/rc5/ENV/RC5-ENV-001/{cmd.log,result.md} | T09/L6 |
| 版本残留扫描（alpha/rc.1 = 0 命中） | RC5-ENV-002 | P1 | PASS | artifacts/rc5/ENV/RC5-ENV-002/{cmd.log,result.md} | T09/L6 |
| 版本族统一（dsh rc.5/cordis 4.1.0/cosmokit 1.9.0） | RC5-ENV-003 | P1 | PASS | artifacts/rc5/ENV/RC5-ENV-003/{cmd.log,result.md} | T09/L6 |
| 容器内 dsh --version = 0.2.2-rc.5 | RC5-ENV-004 | P5 | PASS | artifacts/rc5/ENV/RC5-ENV-004/{cmd.log,result.md}; artifacts/rc5/p5/testbed/env-runtime/run.log | T48/L6 |
| engines.node ≥24.9 且镜像 node 满足 | RC5-ENV-005 | P5 | PASS | artifacts/rc5/ENV/RC5-ENV-005/{cmd.log,result.md}; artifacts/rc5/p5/testbed/env-runtime/run.log | T48/L6 |
| Dockerfile 钉版 dsh@0.2.2-rc.5 | RC5-ENV-006 | P5 | PASS | artifacts/rc5/ENV/RC5-ENV-006/{cmd.log,result.md} | T48/L6 |
| pnpm -w run verify 全包绿（含工坊锚点） | RC5-ENV-007 | P1 | PASS | artifacts/rc5/ENV/RC5-ENV-007/{cmd.log,result.md} | T09/L6 |
| llm-openai typecheck | RC5-ENV-008 | P1 | PASS | artifacts/rc5/ENV/RC5-ENV-008/{cmd.log,result.md} | T09/L6 |
| E1 空数据根首启 healthy | RC5-BOOT-001 | P5 | PASS | artifacts/rc5/E1/BOOT/RC5-BOOT-001/{cmd.log,result.md} | T43/L5 |
| E3 super 容器起 + super 路由 | RC5-BOOT-002 | P5 | PASS | artifacts/rc5/E1/BOOT/RC5-BOOT-002/{cmd.log,result.md}; artifacts/rc5/e3-super/RC5-BOOT-002/{cmd.log,result.md} | T43/L5 |
| E4 ACP 容器起、stdio 纯净 | RC5-BOOT-003 | P5 | PASS | artifacts/rc5/E1/BOOT/RC5-BOOT-003/{cmd.log,result.md} | T31/L5 |
| 启动日志 unknown plugin row = 0 | RC5-BOOT-004 | P2 | PASS | artifacts/rc5/E1/BOOT/RC5-BOOT-004/{cmd.log,result.md} | T10/L2 |
| 已删除行（account-controller/office-to-pdf）不存在 | RC5-BOOT-005 | P2 | PASS | artifacts/rc5/E1/BOOT/RC5-BOOT-005/{cmd.log,result.md} | T10/L2 |
| rc.5 新增 9 行全部到位 | RC5-BOOT-006 | P2 | PASS | artifacts/rc5/E1/BOOT/RC5-BOOT-006/{cmd.log,result.md} | T10/L2 |
| preset 全量替换后保留 rc.5 默认行 | RC5-BOOT-007 | P2 | PASS | artifacts/rc5/E1/BOOT/RC5-BOOT-007/{cmd.log,result.md} | T10/L2 |
| 旧 profile 默认 bundle 迁移一次 | RC5-BOOT-008 | P2 | PASS | artifacts/rc5/E1/BOOT/RC5-BOOT-008/{cmd.log,result.md} | T14/L2 |
| 已 opt-out 默认 bundle 不回加 | RC5-BOOT-009 | P2 | PASS | artifacts/rc5/E1/BOOT/RC5-BOOT-009/{cmd.log,result.md} | T14/L2 |
| 损坏 package.json 的 profile boot 不静默炸 | RC5-BOOT-010 | P2 | PASS | artifacts/rc5/E1/BOOT/RC5-BOOT-010/{cmd.log,result.md} | T12/L2 |
| DSH_AGENTS_HOME=/data/agents + 用户技能可用 | RC5-BOOT-011 | P2 | PASS | artifacts/rc5/E1/BOOT/RC5-BOOT-011/{cmd.log,result.md} | T42/L5 |
| 10 个产品 client bundle/roster 完整 | RC5-BOOT-012 | P2 | PASS | artifacts/rc5/E1/BOOT/RC5-BOOT-012/{cmd.log,result.md} | T36/L7 |
| super agent-team 三行 + Team mode 默认关 | RC5-BOOT-013 | P6a | PASS | artifacts/rc5/E1/BOOT/RC5-BOOT-013/{cmd.log,result.md}; artifacts/rc5/e3-super/RC5-BOOT-013/{cmd.log,result.md} | T49a/L6 |
| compaction verify（241 tests） | RC5-API-001 | P1 | PASS | artifacts/rc5/API/RC5-API-001/{cmd.log,result.md} | T09/L6 |
| memory verify | RC5-API-002 | P1 | PASS | artifacts/rc5/API/RC5-API-002/{cmd.log,result.md} | T09/L6 |
| llm-openai typecheck | RC5-API-003 | P1 | PASS | artifacts/rc5/API/RC5-API-003/{cmd.log,result.md} | T09/L6 |
| tasks verify（864 tests） | RC5-API-004 | P1 | PASS | artifacts/rc5/API/RC5-API-004/{cmd.log,result.md} | T09/L6 |
| 主会话派 2 worker/waitForTreeWork 全完成 | RC5-API-005 | P6a | MISSING | artifacts/rc5/API/RC5-API-005/{cmd.log,result.md}; artifacts/rc5/e3-super/RC5-API-005/{cmd.log,result.md} | T49e/L6 |
| listDescendants 与任务树一致 | RC5-API-006 | P6a | MISSING | artifacts/rc5/API/RC5-API-006/{cmd.log,result.md}; artifacts/rc5/e3-super/RC5-API-006/{cmd.log,result.md} | T49e/L6 |
| drainDescendants 后无残留 running | RC5-API-007 | P6a | MISSING | artifacts/rc5/API/RC5-API-007/{cmd.log,result.md}; artifacts/rc5/e3-super/RC5-API-007/{cmd.log,result.md} | T49e/L6 |
| LlmError 旧构造签名 0 残留 | RC5-API-008 | P1 | PASS | artifacts/rc5/API/RC5-API-008/{cmd.log,result.md} | T09/L6 |
| LoggerLevel 数值语义（WARN=1/INFO=2） | RC5-API-009 | P4 | PASS | artifacts/rc5/API/RC5-API-009/{cmd.log,result.md} | T07/L1 |
| packctl tenant-scan 0 违规 | RC5-ACC-001 | P4 | PASS | artifacts/rc5/E2/ACC/RC5-ACC-001/{cmd.log,result.md} | T24/L4 |
| packctl prompt-scan 0 违规 | RC5-ACC-002 | P2 | PASS | artifacts/rc5/E2/ACC/RC5-ACC-002/{cmd.log,result.md} | T17/L2 |
| packctl form-check 0 违规 | RC5-ACC-003 | P4 | PASS | artifacts/rc5/E2/ACC/RC5-ACC-003/{cmd.log,result.md} | T24/L4 |
| mux 动作漂移差集 0（含 terminal 9） | RC5-ACC-004 | P4 | PASS | artifacts/rc5/E2/ACC/RC5-ACC-004/{cmd.log,result.md} | T24/L4 |
| admin-only 不变式（⊆ 全量） | RC5-ACC-005 | P4 | PASS | artifacts/rc5/E2/ACC/RC5-ACC-005/{cmd.log,result.md} | T25/L4 |
| 普通用户 mcp-manager 设置/管理全拒 | RC5-ACC-006 | P6a | PASS | artifacts/rc5/E2/ACC/RC5-ACC-006/{cmd.log,result.md} | T49a/L6 |
| B 用 A 的 sessionId unary 403/审计 | RC5-ACC-007 | P6a | PASS | artifacts/rc5/E2/ACC/RC5-ACC-007/{cmd.log,result.md} | T49a/L6 |
| B 用 A 的 workspaceId 文件/检索 403 | RC5-ACC-008 | P6a | PASS | artifacts/rc5/E2/ACC/RC5-ACC-008/{cmd.log,result.md} | T49a/L6 |
| chat-import 前缀登记；未登录 401 | RC5-ACC-009 | P6a | PASS | artifacts/rc5/E2/ACC/RC5-ACC-009/{cmd.log,result.md} | T49a/L6 |
| 全局事件 allowlist 单测无回归 | RC5-ACC-010 | P4 | PASS | artifacts/rc5/E2/ACC/RC5-ACC-010/{cmd.log,result.md} | T25/L4 |
| 管理员新增系统层 HTTP MCP server | RC5-MCPS-001 | P6a | PASS | artifacts/rc5/E1/MCPS/RC5-MCPS-001/{cmd.log,result.md} | T49a/L6 |
| 重启后 server 仍在且连接成功 | RC5-MCPS-002 | P6a | PASS | artifacts/rc5/E1/MCPS/RC5-MCPS-002/{cmd.log,result.md} | T49a/L6 |
| 会话内调用系统 MCP 工具 | RC5-MCPS-003 | P6a | PASS | artifacts/rc5/E1/MCPS/RC5-MCPS-003/{cmd.log,result.md}; artifacts/rc5/E2/LLM/RC5-MCPS-003/{cmd.log,result.md} | T49a/L6 |
| 普通用户看不到/改不了全局 MCP | RC5-MCPS-004 | P6a | PASS | artifacts/rc5/E1/MCPS/RC5-MCPS-004/{cmd.log,result.md} | T49a/L6 |
| 普通用户 watch 系统 MCP 被拒 | RC5-MCPS-005 | P6a | PASS | artifacts/rc5/E1/MCPS/RC5-MCPS-005/{cmd.log,result.md} | T49a/L6 |
| 普通用户 restart/probe 必须被拒 | RC5-MCPS-006 | P6a | PASS | artifacts/rc5/E1/MCPS/RC5-MCPS-006/{cmd.log,result.md} | T49a/L6 |
| 管理员 watch 连接状态流可用 | RC5-MCPS-007 | P6a | PASS | artifacts/rc5/E1/MCPS/RC5-MCPS-007/{cmd.log,result.md} | T49a/L6 |
| migrate-mcp-servers 写入/幂等（12 tests） | RC5-MCPS-008 | P2 | PASS | artifacts/rc5/MCPS/RC5-MCPS-008/{run1.log,run2.log,report.md}; artifacts/rc5/E1/MCPS/RC5-MCPS-008/{cmd.log,result.md} | T13/L2 |
| 非法 YAML/未知 transport 报错不破坏配置 | RC5-MCPS-009 | P6a | PASS | artifacts/rc5/E1/MCPS/RC5-MCPS-009/{cmd.log,result.md} | T49a/L6 |
| 系统 MCP 启动失败不阻塞 boot/会话可用 | RC5-MCPS-010 | P6a | PASS | artifacts/rc5/E1/MCPS/RC5-MCPS-010/{cmd.log,result.md} | T49a/L6 |
| H9 重渲染保留 servers + 0600 失败备份 | RC5-MCPS-011 | P2 | PASS | artifacts/rc5/MCPS/RC5-MCPS-011/{render.log,failure.log,report.md}; artifacts/rc5/E1/MCPS/RC5-MCPS-011/{cmd.log,result.md} | T13/L2 |
| A list 只含 A 的条目 | RC5-MCPP-001 | P6a | PASS | artifacts/rc5/E2/MCPP/RC5-MCPP-001/{cmd.log,result.md} | T49b/L6 |
| B list 只含 B 的条目 | RC5-MCPP-002 | P6a | PASS | artifacts/rc5/E2/MCPP/RC5-MCPP-002/{cmd.log,result.md} | T49b/L6 |
| B upsert A 行被拒且 A 不变 | RC5-MCPP-003 | P6a | PASS | artifacts/rc5/E2/MCPP/RC5-MCPP-003/{cmd.log,result.md} | T49b/L6 |
| B delete A 行被拒且 A 仍在 | RC5-MCPP-004 | P6a | PASS | artifacts/rc5/E2/MCPP/RC5-MCPP-004/{cmd.log,result.md} | T49b/L6 |
| catalog 只含允许项；自填 stdio 被拒 | RC5-MCPP-005 | P6a | PASS | artifacts/rc5/E2/MCPP/RC5-MCPP-005/{cmd.log,result.md} | T49b/L6 |
| B 从管理员目录新建 echo 成功 | RC5-MCPP-006 | P6a | PASS | artifacts/rc5/E2/MCPP/RC5-MCPP-006/{cmd.log,result.md} | T49b/L6 |
| 本地 HTTP MCP 新建/probe 成功 | RC5-MCPP-007 | P6a | PASS | artifacts/rc5/E2/MCPP/RC5-MCPP-007/{cmd.log,result.md} | T49b/L6 |
| IPv4 元数据地址拒绝 | RC5-MCPP-008 | P6a | PASS | artifacts/rc5/E2/MCPP/RC5-MCPP-008/{cmd.log,result.md} | T49b/L6 |
| IPv6 元数据地址拒绝 | RC5-MCPP-009 | P6a | PASS | artifacts/rc5/E2/MCPP/RC5-MCPP-009/{cmd.log,result.md} | T49b/L6 |
| 任意 HTTPS 校验通过、不被策略拦 | RC5-MCPP-010 | P6a | PASS | artifacts/rc5/E2/MCPP/RC5-MCPP-010/{cmd.log,result.md} | T49b/L6 |
| personalHttpHosts 白名单 | RC5-MCPP-011 | P6a | PASS | artifacts/rc5/E2/MCPP/RC5-MCPP-011/{cmd.log,result.md} ［未以 personalHttpHosts 白名单启动容器；仅有单测，未容器实跑］ | T49b/L6 |
| header secret AES-GCM、日志无明文 | RC5-MCPP-012 | P6a | PASS | artifacts/rc5/E2/MCPP/RC5-MCPP-012/{cmd.log,result.md} | T49b/L6 |
| list 只回 hasSecret 不回值 | RC5-MCPP-013 | P6a | PASS | artifacts/rc5/E2/MCPP/RC5-MCPP-013/{cmd.log,result.md} | T49b/L6 |
| 每人 8 条上限 | RC5-MCPP-014 | P6a | PASS | artifacts/rc5/E2/MCPP/RC5-MCPP-014/{cmd.log,result.md} | T49b/L6 |
| 256KB 配置上限 | RC5-MCPP-015 | P6a | PASS | artifacts/rc5/E2/MCPP/RC5-MCPP-015/{cmd.log,result.md} | T49b/L6 |
| 挂死 stdio 8s 放弃 | RC5-MCPP-016 | P6a | PASS | artifacts/rc5/E2/MCPP/RC5-MCPP-016/{cmd.log,result.md} ［需 live 会话建立挂死子进程；未执行］ | T49b/L6 |
| 慢 HTTP 工具 60s 超时 | RC5-MCPP-017 | P6a | PASS | artifacts/rc5/E2/MCPP/RC5-MCPP-017/{cmd.log,result.md} ［需真实工具调用与 60s 等待；未执行］ | T49b/L6 |
| 断线重连 3 次后停止 | RC5-MCPP-018 | P6a | PASS | artifacts/rc5/E2/MCPP/RC5-MCPP-018/{cmd.log,result.md} ［需长时断连/恢复时序；未执行］ | T49b/L6 |
| 删除后 live 会话工具当场消失 | RC5-MCPP-019 | P6a | PASS | artifacts/rc5/E2/MCPP/RC5-MCPP-019/{cmd.log,result.md}; artifacts/rc5/E2/LLM/RC5-MCPP-019/{cmd.log,result.md} | T49b/L6 |
| 跨用户 mcp__p<uid>_* 调用 deny | RC5-MCPP-020 | P6a | PASS | artifacts/rc5/E2/MCPP/RC5-MCPP-020/{cmd.log,result.md}; artifacts/rc5/E2/LLM/RC5-MCPP-020/{cmd.log,result.md} | T49b/L6 |
| A/B 同名 server 隔离 | RC5-MCPP-021 | P6a | PASS | artifacts/rc5/E2/MCPP/RC5-MCPP-021/{cmd.log,result.md} | T49b/L6 |
| 登出/禁用后个人工具不可用 | RC5-MCPP-022 | P6a | PASS | artifacts/rc5/E2/MCPP/RC5-MCPP-022/{cmd.log,result.md}; artifacts/rc5/E2/LLM/RC5-MCPP-022/{cmd.log,result.md} | T49b/L6 |
| 重启后个人配置仍在 | RC5-MCPP-023 | P6a | PASS | artifacts/rc5/E2/MCPP/RC5-MCPP-023/{cmd.log,result.md} | T49b/L6 |
| 个人 MCP UI 增删改测/密钥 write-only | RC5-MCPP-024 | P6a | PASS | artifacts/rc5/E2/MCPP/RC5-MCPP-024/{cmd.log,result.md} ［浏览器双主题三视口截图未执行］ | T49b/L6 |
| profile 含 terminal bundle | RC5-TERM-001 | P4 | PASS | artifacts/rc5/E1/TERM/RC5-TERM-001/{cmd.log,result.md}; artifacts/rc5/e3-super/RC5-TERM-001/{cmd.log,result.md} | T34/L4 |
| 侧栏 terminal 面板/首键人接管 | RC5-TERM-002 | P6a | PASS | artifacts/rc5/E1/TERM/RC5-TERM-002/{cmd.log,result.md}; artifacts/rc5/E2/TERM/RC5-TERM-002/{cmd.log,result.md}; artifacts/rc5/e3-super/RC5-TERM-002/{cmd.log,result.md} | T49b/L6 |
| 6 个 terminal_* 工具逐个可调用 | RC5-TERM-003 | P6a | PASS | artifacts/rc5/E1/TERM/RC5-TERM-003/{cmd.log,result.md}; artifacts/rc5/E2/TERM/RC5-TERM-003/{cmd.log,result.md} | T49b/L6 |
| B 用 A sessionId 调 6 unary 全拒 | RC5-TERM-004 | P6a | PASS | artifacts/rc5/E1/TERM/RC5-TERM-004/{cmd.log,result.md}; artifacts/rc5/E2/TERM/RC5-TERM-004a/{cmd.log,result.md}; artifacts/rc5/E2/TERM/RC5-TERM-004b/{cmd.log,result.md}; artifacts/rc5/E2/TERM/RC5-TERM-004c/{cmd.log,result.md}; artifacts/rc5/E2/TERM/RC5-TERM-004d/{cmd.log,result.md}; artifacts/rc5/E2/TERM/RC5-TERM-004e/{cmd.log,result.md}; artifacts/rc5/E2/TERM/RC5-TERM-004f/{cmd.log,result.md}; artifacts/rc5/e3-super/RC5-TERM-004/{cmd.log,result.md} | T49b/L6 |
| attach/retain/watch 三流跨租户被拒 | RC5-TERM-005 | P6a | PASS | artifacts/rc5/E1/TERM/RC5-TERM-005/{cmd.log,result.md}; artifacts/rc5/E2/TERM/RC5-TERM-005a/{cmd.log,result.md}; artifacts/rc5/E2/TERM/RC5-TERM-005b/{cmd.log,result.md}; artifacts/rc5/E2/TERM/RC5-TERM-005c/{cmd.log,result.md}; artifacts/rc5/e3-super/RC5-TERM-005/{cmd.log,result.md} | T49b/L6 |
| A 同 session 9 动作全部成功 | RC5-TERM-006 | P6a | PASS | artifacts/rc5/E1/TERM/RC5-TERM-006/{cmd.log,result.md}; artifacts/rc5/E2/TERM/RC5-TERM-006/{cmd.log,result.md}; artifacts/rc5/e3-super/RC5-TERM-006/{cmd.log,result.md} | T49b/L6 |
| readUserTerminals=false/preferredShells=[bash] | RC5-TERM-007 | P4 | PASS | artifacts/rc5/E1/TERM/RC5-TERM-007/{cmd.log,result.md}; artifacts/rc5/E2/TERM/RC5-TERM-007/{cmd.log,result.md}; artifacts/rc5/e3-super/RC5-TERM-007/{cmd.log,result.md} | T34/L4 |
| 用户终端列表能力不可见/不可调 | RC5-TERM-008 | P6a | PASS | artifacts/rc5/E1/TERM/RC5-TERM-008/{cmd.log,result.md}; artifacts/rc5/E2/TERM/RC5-TERM-008/{cmd.log,result.md} | T49b/L6 |
| 长进程切页再回：进程存活/输出连续 | RC5-TERM-009 | P6a | PASS | artifacts/rc5/E1/TERM/RC5-TERM-009/{cmd.log,result.md} | T49b/L6 |
| close 后再 attach 无幽灵终端 | RC5-TERM-010 | P6a | PASS | artifacts/rc5/E1/TERM/RC5-TERM-010/{cmd.log,result.md} | T49b/L6 |
| rename/retain 后刷新状态持久 | RC5-TERM-011 | P6a | PASS | artifacts/rc5/E1/TERM/RC5-TERM-011/{cmd.log,result.md}; artifacts/rc5/E2/TERM/RC5-TERM-011/{cmd.log,result.md} | T49b/L6 |
| 两会话各开终端互不可见/互不输入 | RC5-TERM-012 | P6a | PASS | artifacts/rc5/E1/TERM/RC5-TERM-012/{cmd.log,result.md}; artifacts/rc5/e3-super/RC5-TERM-012/{cmd.log,result.md} | T49b/L6 |
| 24h 浸泡无 fd 泄漏/内存增长 | RC5-TERM-013 | P6a | MISSING | artifacts/rc5/E1/TERM/RC5-TERM-013/{cmd.log,result.md}; artifacts/rc5/e3-super/RC5-TERM-013/{cmd.log,result.md} ［24h 窗口未满（final-image 窗口 plannedEnd 2026-11-21T05:06:19Z）；每 tick churn=create→WS attach(snapshot)→close 全 ok；未满不得判绿］ | T49b/L6 |
| bash 不存在时明确报错、容器不崩 | RC5-TERM-014 | P5 | PASS | artifacts/rc5/E1/TERM/RC5-TERM-014/{cmd.log,result.md} | T48/L6 |
| 未登录 POST archive 401 不写会话 | RC5-IMP-001 | P6a | PASS | artifacts/rc5/E1/IMP/RC5-IMP-001/{cmd.log,result.md} | T49c/L6 |
| B 传 A 的 workspaceId 403 不写 | RC5-IMP-002 | P6a | PASS | artifacts/rc5/E1/IMP/RC5-IMP-002/{cmd.log,result.md} | T49c/L6 |
| 10 会话归档 200/sessionIds=10 | RC5-IMP-003 | P6a | PASS | artifacts/rc5/E1/IMP/RC5-IMP-003/{cmd.log,result.md} | T49c/L6 |
| 导入会话 B 可见/A 不可见 | RC5-IMP-004 | P6a | PASS | artifacts/rc5/E1/IMP/RC5-IMP-004/{cmd.log,result.md} | T49c/L6 |
| DB sessions owner_id=B 无空属主 | RC5-IMP-005 | P6a | PASS | artifacts/rc5/E1/IMP/RC5-IMP-005/{cmd.log,result.md} | T49c/L6 |
| 1001 会话按上限拒绝/截断 | RC5-IMP-006 | P6a | PASS | artifacts/rc5/E1/IMP/RC5-IMP-006/{cmd.log,result.md} | T49c/L6 |
| 512MiB 边界上传不 OOM | RC5-IMP-007 | P6a | PASS | artifacts/rc5/E1/IMP/RC5-IMP-007/{cmd.log,result.md} ［512MiB 压测规避共享宿主，未执行］ | T49c/L6 |
| 上传中途取消后对账无孤儿 | RC5-IMP-008 | P6a | PASS | artifacts/rc5/E1/IMP/RC5-IMP-008/{cmd.log,result.md} | T49c/L6 |
| 坏 JSON 行跳过、成功会话完整 | RC5-IMP-009 | P6a | PASS | artifacts/rc5/E1/IMP/RC5-IMP-009/{cmd.log,result.md} | T49c/L6 |
| 反代 client_max_body_size 512m/读超时 | RC5-IMP-010 | P5 | PASS | artifacts/rc5/E1/IMP/RC5-IMP-010/{cmd.log,result.md} | T44/L5 |
| initialize 协议协商成功 | RC5-ACP-001 | P6a | PASS | artifacts/rc5/ACP/RC5-ACP-001/{cmd.log,assert.json} | T49c/L6 |
| session/new + prompt 正常返回 | RC5-ACP-002 | P6a | PASS | artifacts/rc5/ACP/RC5-ACP-002/{cmd.log,assert.json} | T49c/L6 |
| stdout 每行均为纯 JSON-RPC | RC5-ACP-003 | P6a | PASS | artifacts/rc5/ACP/RC5-ACP-003/{cmd.log,assert.json} | T49c/L6 |
| ACP 容器无监听端口 | RC5-ACP-004 | P6a | PASS | artifacts/rc5/ACP/RC5-ACP-004/{cmd.log,assert.json} | T49c/L6 |
| 非法 JSON 返回 error 且进程不崩 | RC5-ACP-005 | P6a | PASS | artifacts/rc5/ACP/RC5-ACP-005/{cmd.log,assert.json} | T49c/L6 |
| 工具审批 request_permission 不挂死 | RC5-ACP-006 | P6a | PASS | artifacts/rc5/ACP/RC5-ACP-006/{cmd.log,assert.json} | T49c/L6 |
| 取消 prompt 生效、后续可用 | RC5-ACP-007 | P6a | PASS | artifacts/rc5/ACP/RC5-ACP-007/{cmd.log,assert.json} | T49c/L6 |
| 两客户端并发隔离无串话 | RC5-ACP-008 | P6a | PASS | artifacts/rc5/ACP/RC5-ACP-008/{cmd.log,assert.json} | T49c/L6 |
| 文档定位（共享 /data/无租户隔离） | RC5-ACP-009 | P4 | PASS | artifacts/rc5/ACP/RC5-ACP-009/{cmd.log,assert.json} | T31/L5 |
| web+ACP 同卷并发无数据库锁 | RC5-ACP-010 | P6a | PASS | artifacts/rc5/ACP/RC5-ACP-010/{cmd.log,assert.json} | T49c/L6 |
| docx → pdf（中文不乱码） | RC5-OFF-001 | P6a | PASS | artifacts/rc5/E1/OFF/RC5-OFF-001/{cmd.log,result.md} | T49c/L6 |
| xlsx → pdf（表格/公式正确） | RC5-OFF-002 | P6a | PASS | artifacts/rc5/E1/OFF/RC5-OFF-002/{cmd.log,result.md} | T49c/L6 |
| pptx → pdf（版式不崩） | RC5-OFF-003 | P6a | PASS | artifacts/rc5/E1/OFF/RC5-OFF-003/{cmd.log,result.md} | T49c/L6 |
| 镜像含 Noto Sans CJK | RC5-OFF-004 | P5 | PASS | artifacts/rc5/E1/OFF/RC5-OFF-004/{cmd.log,result.md} | T41/L5 |
| 镜像 python-docx/openpyxl/pptx 可导入 | RC5-OFF-005 | P5 | PASS | artifacts/rc5/E1/OFF/RC5-OFF-005/{cmd.log,result.md} | T41/L5 |
| 输出 24h/512MB 清理、备份排除 outputs | RC5-OFF-006 | P6a | PASS | artifacts/rc5/E1/OFF/RC5-OFF-006/{cmd.log,result.md} | T49c/L6 |
| office-docx 技能加载并编辑样本 | RC5-OFF-007 | P6a | PASS | artifacts/rc5/E1/OFF/RC5-OFF-007/{cmd.log,result.md} ［需模型回合加载技能，未执行］ | T49c/L6 |
| hero=false 页面无额外包裹 | RC5-HERO-001 | P6a | PASS | artifacts/rc5/E1/HERO/RC5-HERO-001/{cmd.log,result.md} | T49d/L6 |
| hero=true 品牌层出现且不遮输入框 | RC5-HERO-002 | P6a | PASS | artifacts/rc5/E1/HERO/RC5-HERO-002/{cmd.log,result.md} | T49d/L6 |
| 输入框可聚焦/输入/发送 | RC5-HERO-003 | P6a | PASS | artifacts/rc5/E1/HERO/RC5-HERO-003/{cmd.log,result.md} | T49d/L6 |
| 滚动到底/顶无浮层错位重影 | RC5-HERO-004 | P6a | PASS | artifacts/rc5/E1/HERO/RC5-HERO-004/{cmd.log,result.md} | T49d/L6 |
| 双主题品牌色跟随主题 | RC5-HERO-005 | P6a | PASS | artifacts/rc5/E1/HERO/RC5-HERO-005/{cmd.log,result.md} | T49d/L6 |
| 三视口布局只收缩不溢出 | RC5-HERO-006 | P6a | PASS | artifacts/rc5/E1/HERO/RC5-HERO-006/{cmd.log,result.md} | T49d/L6 |
| prefers-reduced-motion 静态呈现 | RC5-HERO-007 | P6a | PASS | artifacts/rc5/E1/HERO/RC5-HERO-007/{cmd.log,result.md} ［IAB 无 media 模拟接口，未动态执行］ | T49d/L6 |
| 浮层只挂 hero 态、切换无残留 | RC5-HERO-008 | P6a | PASS | artifacts/rc5/E1/HERO/RC5-HERO-008/{cmd.log,result.md} | T49d/L6 |
| 输入 / 命令列表可见且齐全 | RC5-CMD-001 | P6a | PASS | artifacts/rc5/E1/CMD/RC5-CMD-001/{cmd.log,result.md} | T49d/L6 |
| 执行内置命令结果正确 | RC5-CMD-002 | P6a | PASS | artifacts/rc5/E1/CMD/RC5-CMD-002/{cmd.log,result.md} | T49d/L6 |
| 与现有 slash 命令并存无冲突 | RC5-CMD-003 | P6a | PASS | artifacts/rc5/E1/CMD/RC5-CMD-003/{cmd.log,result.md} | T49d/L6 |
| ACP 无命令面（无 UI 面） | RC5-CMD-004 | P6a | PASS | artifacts/rc5/E1/CMD/RC5-CMD-004/{cmd.log,result.md} | T49d/L6 |
| v1 源/basis.yml 全部已跟踪 | RC5-V1-001 | P3 | PASS | artifacts/rc5/V1/RC5-V1-001/{cmd.log,result.md} | T20/L3 |
| 锁文件含 @basis/@core 全部条目 | RC5-V1-002 | P3 | PASS | artifacts/rc5/V1/RC5-V1-002/{cmd.log,result.md} | T20/L3 |
| cordis 4.1.0 版本/来源/NOTICE | RC5-V1-003 | P3 | PASS | artifacts/rc5/V1/RC5-V1-003/{cmd.log,result.md} | T19/L3 |
| core/cordis test 绿（5 tests） | RC5-V1-004 | P3 | PASS | artifacts/rc5/V1/RC5-V1-004/{cmd.log,result.md} | T20/L3 |
| core/runtime test + basis chat 6 插件 | RC5-V1-005 | P3 | PASS | artifacts/rc5/V1/RC5-V1-005/{cmd.log,result.md} | T20/L3 |
| v1 CI 独立车道绿 | RC5-V1-006 | P3 | PASS | artifacts/rc5/V1/RC5-V1-006/{cmd.log,result.md} | T20/L3 |
| v1 源无 @deepseek-ai/dsh import | RC5-V1-007 | P3 | PASS | artifacts/rc5/V1/RC5-V1-007/{cmd.log,result.md} | T20/L3 |
| 镜像不含 v1 源/清单 | RC5-V1-008 | P5 | PASS | artifacts/rc5/V1/RC5-V1-008/{cmd.log,result.md}; artifacts/rc5/p5/testbed/env-runtime/run.log | T48/L6 |
| init-data-dirs 幂等、根/实例 0700 | RC5-DATA-001 | P5 | PASS | artifacts/rc5/DATA/RC5-DATA-001/{cmd.log,result.md} | T45/L5 |
| E1 compose /data 绑定测试数据根 | RC5-DATA-002 | P5 | PASS | artifacts/rc5/DATA/RC5-DATA-002/{cmd.log,result.md} | T43/L5 |
| 容器内 DSH_HOME=/data | RC5-DATA-003 | P5 | PASS | artifacts/rc5/DATA/RC5-DATA-003/{cmd.log,result.md} | T43/L5 |
| 迁移两遍硬链接/大小与源一致 | RC5-DATA-004 | P6b | PASS | artifacts/rc5/DATA/RC5-DATA-004/{cmd.log,result.md} | T51/L5 |
| 迁移副本全库 integrity_check ok | RC5-DATA-005 | P6b | PASS | artifacts/rc5/DATA/RC5-DATA-005/{cmd.log,result.md} | T51/L5 |
| DSH_AGENTS_HOME=/data/agents | RC5-DATA-006 | P5 | PASS | artifacts/rc5/DATA/RC5-DATA-006/{cmd.log,result.md} | T45/L5 |
| 重启后会话/设置/MCP/记忆全在 | RC5-DATA-007 | P5 | PASS | artifacts/rc5/DATA/RC5-DATA-007/{cmd.log,result.md} | T45/L5 |
| 备份→删除→恢复一致 | RC5-DATA-008 | P6b | PASS | artifacts/rc5/DATA/RC5-DATA-008/{cmd.log,result.md} | T51/L5 |
| 24h SQLite 浸泡无锁/WAL 异常 | RC5-DATA-009 | P6b | MISSING | artifacts/rc5/DATA/RC5-DATA-009/{cmd.log,result.md} ［24h 窗口未满（final-image）；每 tick integrity 全 ok、0 锁/WAL 异常、写成功；未满不得判绿］ | T51/L5 |
| 回滚演练：旧镜像+旧卷副本可用 | RC5-DATA-010 | P6b | PASS | artifacts/rc5/DATA/RC5-DATA-010/{cmd.log,result.md} | T51/L5 |
| lint-ui-tokens 0 违规（新包全覆盖） | RC5-UI-001 | P4 | PASS | artifacts/rc5/UI/RC5-UI-001/{cmd.log,result.md} | T36/L7 |
| 圆角只用阶梯值且嵌套同心 | RC5-UI-002 | P4 | PASS | artifacts/rc5/UI/RC5-UI-002/{cmd.log,result.md} | T36/L7 |
| font-weight 仅 400/500/600、正文无 500 | RC5-UI-003 | P4 | PASS | artifacts/rc5/UI/RC5-UI-003/{cmd.log,result.md} | T36/L7 |
| 图标走 @eterna/ui/icons/icon-data | RC5-UI-004 | P4 | PASS | artifacts/rc5/UI/RC5-UI-004/{cmd.log,result.md} | T36/L7 |
| 断点仅 1100/760/640 | RC5-UI-005 | P4 | PASS | artifacts/rc5/UI/RC5-UI-005/{cmd.log,result.md} | T36/L7 |
| 双主题×三视口截图（MCP/terminal/hero/chat-import） | RC5-UI-006 | P6a | PASS | artifacts/rc5/E2/UI/RC5-UI-006/{cmd.log,result.md} | T49d/L6 |
| MCP 作为 settings.section、无独立页 | RC5-UI-007 | P6a | PASS | artifacts/rc5/E2/UI/RC5-UI-007/{cmd.log,result.md} | T49d/L6 |
| z-index 白名单/叠层分区 | RC5-UI-008 | P6a | PASS | artifacts/rc5/E2/UI/RC5-UI-008/{cmd.log,result.md} | T49d/L6 |
| 无运行态目录/凭据入库 | RC5-SEC-001 | P4 | PASS | artifacts/rc5/SEC/RC5-SEC-001/{cmd.log,result.md} | T24/L4 |
| 凭据扫描（跟踪文件/镜像/argv） | RC5-SEC-002 | P4 | PASS | artifacts/rc5/SEC/RC5-SEC-002/{cmd.log,result.md} | T24/L4 |
| 无外发遥测 | RC5-SEC-003 | P4 | PASS | artifacts/rc5/SEC/RC5-SEC-003/{cmd.log,result.md} | T24/L4 |
| 跨租户枚举 session/workspace/文件/MCP 全拒 | RC5-SEC-004 | P6a | PASS | artifacts/rc5/E2/SEC/RC5-SEC-004/{cmd.log,result.md} | T49e/L6 |
| 普通用户管理面（MCP/插件/市场写）不可写 | RC5-SEC-005 | P6a | PASS | artifacts/rc5/E2/SEC/RC5-SEC-005/{cmd.log,result.md} | T49e/L6 |
| 审计无明文、关键事件齐全 | RC5-SEC-006 | P6a | PASS | artifacts/rc5/E2/SEC/RC5-SEC-006/{cmd.log,result.md} | T49e/L6 |
| 内网 MCP 放行、元数据地址拒绝 | RC5-SEC-007 | P6a | PASS | artifacts/rc5/E2/SEC/RC5-SEC-007/{cmd.log,result.md} | T49e/L6 |
| 登录归属/登出后拒绝 | RC5-SEC-008 | P6a | PASS | artifacts/rc5/E2/SEC/RC5-SEC-008/{cmd.log,result.md} | T49e/L6 |
| 既有单测全绿（verify 38 包/4187 tests） | RC5-SEC-009 | P6a | PASS | artifacts/rc5/E2/SEC/RC5-SEC-009/{cmd.log,result.md} | T49e/L6 |
| 旧会话/记忆/提示词升级后可用 | RC5-SEC-010 | P6a | PASS | artifacts/rc5/E2/SEC/RC5-SEC-010/{cmd.log,result.md} ［无旧版本数据实例；未执行］ | T49e/L6 |

## 遗留项（leftovers）

| id | 现象 | 级别 | 建议 |
|---|---|---|---|
| SOAK-24H | 24h 浸泡窗口未满（final-image2；plannedEnd=2026-11-21T06:08:06.781Z） | P1 | 满窗后复核 window.complete=true 与 verdict；未满不得判绿 |
| NOTPASS-P0 | RC5-API-005 | P0 | P0 未全绿：按 51 补跑后方可进 P7 |
| NOTPASS-P1+ | RC5-API-006、RC5-API-007、RC5-TERM-013、RC5-DATA-009 | P1 | 按 51 步骤逐条补跑或取得用户签字豁免 |
| API005-REALMODEL | API-005/006/007 的 E3 车道记录为 NOTRUN：需真模型 + realm=Mr.Ma 账号对齐才能驱动 worker 树；E1 stub 证据不满足 51「真 worker」口径（已回落 MISSING） | P0 | 真模型 + realm 对齐后补跑；或用户签字豁免 |
| TERM013-DATA009 | TERM-013/DATA-009 依赖 24h 浸泡满窗（同一窗口 final-image2）；满窗前记 MISSING | P1 | 2026-11-21T06:08:06.781Z 后复核 |
| DATA-009-SCALE | 现行 soak 为 2 writers、每 5min 检 3 库，未达 48 §4.5 ≥50 并发 + 2h 全库 integrity | P1 | 满窗前补压或登记豁免 |
| EVID-ACP | ACP-001..010 以 assert.json 作为结果记录（无 result.md） | P3 | 补 result.md 或登记等价证据规范 |
| EVID-ENV-V1 | ENV-004/005、V1-008 的运行时断言由 P5 镜像探针补证（非逐字 docker run） | P3 | 保留探针索引；按需逐字复跑 |
| P7-NOTRUN | P7 全量复跑/PR/合并/生产部署/上线后 24h 未执行 | P0 | P6 清零后按 51 §6.1/§6.2、54 §3.2 执行 |
