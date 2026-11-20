# T52 · 12 行回归矩阵抽样（51 §5；54 §5.5）

- 抽样口径：每行至少跑 1 条自动化用例；优先选 P0 与跨租户/破坏面；**非全量**。
- 判定：**绿** = 抽跑用例全 PASS；**红** = 抽跑用例出现 FAIL；**带缺口绿** = 无 FAIL 但有 SKIP/NOTRUN（不得冒充全绿）。
- 证据均在 `artifacts/rc5/p7/regression/rerun/**`；命令原文与 EXIT 见各 `cmd.log`/`logs/*.log`。

| # | 既有能力 | 抽跑用例（本轮实跑） | 结果 | 证据 | 行判定 |
|---|---|---|---|---|---|
| 1 | 登录/会话 | ACC-006（mcp-manager 设置/管理）、ACC-007（B 用 A sessionId unary）、ACC-008（B 用 A workspaceId 文件）、SEC-004（跨租户枚举）、SEC-008（登录归属/登出） | ACC-006 FAIL、ACC-008 FAIL、SEC-004 FAIL；ACC-007 PASS、SEC-008 PASS | `rerun/E2/ACC/summary.json`、`rerun/E2/SEC/summary.json` | **红**（跨租户/管理面） |
| 2 | 对话/流式 | ENV-007（全仓 verify）、API-001（compaction 241）、API-002（memory 504）、API-003（llm-openai typecheck）、SEC-009（全仓 verify 38 包/4193 tests） | 全 PASS（EXIT 0） | `rerun/logs/API-SEC-verify.log`、`rerun/E2/SEC/summary.json` | 绿 |
| 3 | 文件上传/下载 | IMP-001（未登录 401）、IMP-002（B 传 A workspace 403）、IMP-003（10 会话导入）、IMP-004（B 可见 A 不可见）、IMP-005（DB 属主）、IMP-009（坏 JSON 跳过）、ACC-008（B 读 A 文件） | IMP 全 PASS（005 需轮询，见 `probes/imp005-poll.log`）；ACC-008 FAIL | `rerun/E1/IMP/IMP-report.json`、`rerun/E2/ACC/RC5-ACC-008/` | **红**（读面隔离）/ 写面绿 |
| 4 | 任务/子代理 | API-004（tasks verify 864）、API-005/006/007（真宿主 harness：2 worker、回执 2/2、drain 后 idle） | 全 PASS（harness `ok=true`，EXIT 0） | `rerun/logs/API-004.log`、`rerun/API/out/results.json`、`rerun/logs/API-harness-rerun.log` | 绿 |
| 5 | 记忆 | API-002（memory 504）、ENV-007（全仓 verify）、SEC-010（旧数据升级） | API-002/ENV-007 PASS；SEC-010 SKIP（无旧版本数据实例） | `rerun/logs/API-002.log`、`rerun/E2/SEC/summary.json` | 带缺口绿 |
| 6 | 压缩 | API-001（compaction 241）、SEC-010 | API-001 PASS；SEC-010 SKIP | `rerun/logs/API-001.log` | 带缺口绿 |
| 7 | 提示词工坊 | ENV-007（含工坊锚点）、BOOT-004（启动 0 unknown plugin row）、SEC-010 | ENV-007/BOOT-004 PASS；SEC-010 SKIP | `rerun/logs/API-SEC-verify.log`、`rerun/E1/BOOT/RC5-BOOT-004/` | 带缺口绿 |
| 8 | 插件市场 | BOOT-008/009（默认 bundle 迁移/opt-out 不回加）、SEC-005（普通用户管理面不可写） | BOOT-008/009 PASS；**SEC-005 FAIL**（mcpManager probe/restart 可达） | `rerun/E1/BOOT/RC5-BOOT-008|009/`、`rerun/E2/SEC/RC5-SEC-005/` | **红**（管理面） |
| 9 | 用量统计 | BOOT-012（10 包 client bundle/roster 完整） | PASS | `rerun/E3/RC5-BOOT-012/report.json`、`rerun/E1/BOOT/RC5-BOOT-012/` | 绿 |
| 10 | 工作台 | BOOT-012、WB-001..004（工作台 4 项）、ENV-007 | 全 PASS | `rerun/E3/WB-00{1..4}/report.json` | 绿 |
| 11 | 知识库 | ACC-008（B 读 A workspace 文件/检索）、SEC-009（全仓单测） | ACC-008 FAIL；SEC-009 PASS | `rerun/E2/ACC/RC5-ACC-008/`、`rerun/E2/SEC/summary.json` | **红**（读面隔离） |
| 12 | 多租户全链 | MCPP-001..023（16 PASS/8 SKIP）、TERM-004（6/6 denied）、TERM-005（attach/retain/watch 拒绝）、SEC-004 | TERM-004/005 PASS、MCPP 16 PASS；**SEC-004 FAIL**；MCPP-019/020/022 P0 SKIP | `rerun/E2/MCPP/summary.json`、`rerun/E1/TERM/RC5-TERM-004/terminal-guard-report.json`、`rerun/E2/TERM/summary.json` | **红**（文件面；链上其余绿） |
| 13 | 部署/数据（51 §5 第 13 行，补充） | DATA-001（init-data-dirs 幂等/0700）、DATA-002（/data bind）、DATA-003（DSH_HOME）、DATA-006（DSH_AGENTS_HOME）、DATA-007（重启后数据在） | 全 PASS（重启前后 sessions 1217、users 3；/login 200） | `rerun/logs/DATA-quick.log` | 带缺口（004/005/008/010 演练未复跑；009 浸泡未满） |

## 行级结论

- **红 5 行**：登录/会话、文件上传/下载（读面）、插件市场（管理面）、知识库、多租户全链 —— 同一根因族：`workspaceFiles/*` 跨租户未拒 + `mcpManager/probe|restart` 管理面 unary 可达（对应 `CROSS-TENANT` 遗留项）。
- **绿 4 行**：对话/流式、任务/子代理、用量统计、工作台。
- **带缺口绿 4 行**：记忆、压缩、提示词工坊、部署/数据（SKIP/NOTRUN 已列 `signoff.md`，不冒充全绿）。

> 注：51 §5 原表 13 行；任务口径的 12 行不含「部署/数据」，本表保留为第 13 行补充。