# T52 · 遗留项（leftovers）

> **历史快照（2026-11-20 上午，HEAD `c75f876`）**：本文记录 T52 复跑时的红项，其中 ENV-004/CROSS-TENANT/TERM-006/SEC-002/UI-006/DATA-DRILLS/API005 stub 等已在最终镜像 `sha256:22fe8acb…` 上复跑清零。
> **现行遗留项以 `artifacts/rc5/acceptance-matrix.md` §遗留项 为准**（5 条 MISSING：API-005/006/007、TERM-013、DATA-009）。

格式：`id|现象|级别|建议`。级别：P0 = 停线/发布阻断；P1 = 发布前补跑或签字；P2 = 证据/脚手架瑕疵。

| id | 现象 | 级别 | 建议 |
|---|---|---|---|
| ENV-004-FIXTURES | 当前发布镜像 `eterna-agent:rc5-test` 含 `/repo/tests/fixtures`（6.0M：chat-import zip、mcp-echo/http 夹具、office 样本），违反「夹具不进镜像」；根因 `Dockerfile:32 COPY . .` 且 `.dockerignore` 无 `tests/fixtures` | P0 | 在 `.dockerignore` 排除 `tests/fixtures`（或 Dockerfile 复制后删除），重建镜像并重跑 `verify-rc5-env --runtime-image`（ENV-004）与 OFF-005；发布镜像 digest 记录前必须绿 |
| CROSS-TENANT | ACC-006/008、SEC-004/005、MCPS-006 仍红：B 可读 A workspaceFiles；普通用户可 probe/restart 系统 MCP（HTTP 200/ok=true） | P0 | 修 workspaceFiles 路由租户判定与 mcp-manager unary 的 admin 守卫（mux/admin-only unary 请求级拦截），重跑 ACC/MCPS/SEC 全组 |
| TERM-006 | A 自己 9 动作：create/rename/retain 失败（`session.snapshotEvents is not a function` / terminal unavailable） | P0 | 按上游 rc.5 会话 API 修复 terminal create/rename/retain 适配；修后重跑 TERM-006/011/013 |
| TERM-008-SEMANTIC | 伪造 sessionId 的 `terminal/list` 由 `ok=true []` 变为 `remote-access/denied`（守卫收紧）；无枚举/泄漏，但自动断言按旧语义红 | P0 | 产品确认 fail-closed 语义可接受；更新断言为「denied 或空列表」二选一，并在发布说明记行为变化 |
| SEC-002 | 跟踪测试文件疑入口令字面量：14 行/7 文件（`docs/ai-evo-integration.md` 1 + `packages/access/tests/*` 9 + `scripts/team-platform-gates/*` 4，脱敏计数） | P0 | 替换为明显假值（如 `test-password-not-a-secret`），全仓重扫；补镜像/日志/argv 扫描 |
| BOOT-007 | `--dump-default-config` 仍 `EXIT=1 / 0 bytes`；空集 PASS 不成立 | P0 | 修命令（或上游用法）；修前不得据此判默认行无丢失 |
| MISSING-P0-LIVE | MCPS-003、TERM-002、TERM-012、MCPP-019/020/022 未执行；ACP-002 因模型 401 未完成 | P0 | 真模型/浏览器/子代理环境补跑；补跑前保持 MISSING |
| ACP-002-CRED | E4 占位 key 下 `session/prompt` 401；W5 曾 `end_turn 184ms`（stub 口径） | P0 | 明确 ACP 验收是 stub 口径还是真模型；若 stub，固化 stub 配置进 E4 env |
| UI-006 | 双主题×三视口 24 张截图仍红（390 hero 遮挡 chip、terminal 5/6 错误页、chat-import 6/6 无入口）；本轮未重截 | P0 | 修复后重截 24 张并人工复核 |
| SOAK-24H | 24h 浸泡窗口未满（本轮 4.12h/24h，plannedEnd 2026-11-20T21:45:37Z）；期间 0 锁/WAL 异常、integrity 全 ok；churn=create 持续 fail | P0 | 满窗后复核 `window.complete=true` 与 verdict；DATA-009/TERM-013 未满不得判绿 |
| API005-REALMODEL | API-005/006/007 本轮以「真 tasks/subagent + stub 模型」通过；真模型 E2E 仍未跑 | P0 | 真模型 + realm 对齐账号补跑；发布说明标注 stub 口径 |
| P7-FULL-NOTRUN | 本轮只复跑 P0 全量 + P1 抽样（47 条 P1 未跑），未做 164 全量复跑 | P0 | 上述 P0 清零后按 51 §6.1/§6.2 做全量复跑并归档 |
| P1-NOT-RERUN | 47 条 P1 未复跑（清单见 `signoff.md` §2） | P1 | 按签收逐条补跑或产品书面签字接受 |
| DATA-DRILLS | DATA-004/005/010（迁移两遍/全库 integrity/回滚演练）未在共享宿主重放 | P1 | 在独立 E5 卷副本上重放或登记 W5 证据豁免 |
| GOVERNANCE-ASK | 治理规则 `default: allow`（2026-11-19 拍板），ask/deny 各一例未执行（需模型回合 + 决策卡） | P1 | 用模型回合跑 ask/deny 各一例并截决策卡 + 审计 |
| COMPANION-LIVE | companion 路由绿（匿名 401/管理员 200/guideUrl 在），扩展连接与 `mcp__browser__*` 未实跑 | P1 | 真实浏览器+模型补证；记录中继 token 不变 |
| E3-TERM004-MATCHER | E3 套件 `denied()` 只认 403/tenant-denied，不认 `remote-access/denied`（HTTP 200 + ok=false），造成 TERM-004 假红 | P2 | 更新套件匹配器（测试脚手架修复），勿改产品 |
| E3-PREP-BASELINE | E3-PREP 的生产容器基线为空（`before=[]`）→ 每次假红 | P2 | 首跑时落基线文件；或在断言中显式允许「基线缺失=不可判」 |
| MCPP-023-SCRIPT | 官方脚本重启后用仅 `eterna_session` 的 cookie 调 `mcp-personal/list` → 空列表假红；套件受控复测 PASS | P2 | 修脚本（补 dsh-auth cookie）或登记等价证据规范 |
| IMP-005-LAG | 官方脚本上传后立即读 access 库 → 记账异步假红；轮询 10/10 行 owner=B | P2 | 脚本加 5–10s 轮询；保留 P2 记账延迟记录 |
| IMP-WS-STALE | E1 数据根 B 有两条 workspace 行，首行 `adf1e03e…` 已不存在，脚本取首行导致 `workspace-not-found` 假红 | P2 | 清理陈旧 workspace 行；脚本按「可用的活 workspace」选择 |
| EVID-V1-ROWS | `acceptance-matrix.md` 标题 164 条，实际 164 行表只有 156 行（缺 V1 8 条）；V1 仅见于套件统计表 | P2 | 补 V1 8 行到矩阵，或把套件表与行表口径统一 |
| E1-TERM-HALT | E1 TERM runner 在 TERM-005 静态项后按设计 SKIP 006–014；TERM-005 实际由 E2 流动作覆盖 | P2 | 套件说明里登记「005 由 E2 补、E1 不再中止」 |
| SANITIZE-LOG | 复跑日志中出现 dsh boot token / `?token=`（累计已脱敏 11 处 / 11 文件，见 `SANITIZE.md`） | P2 | 脚本侧默认 redact（`rc5-test-client.redact` 覆盖 URL token） |

> 本轮**未改产品代码**；上表建议均待对应 lane 执行。