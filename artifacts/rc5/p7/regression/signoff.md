# T52 · 已知问题签字表（P7 / rc.5）

- 依据：51 §6.1（已知问题清单经产品签字）、51 §6.3（四方签字）、54 §11（P0 全绿；P1 清零或产品签字）
- 逐条 P0 对照见 `P0-comparison.md` / `.json`；命令与 EXIT 见 `rerun/logs/**`
- 原则：**未复跑 ≠ 绿**；本表只写「本轮实跑了什么、W5 记了什么、还缺什么」

## 1. P0 红项（本轮复跑仍红，共 14 条）

| case | 现象（本轮实测） | 级别 | W5 | 证据 |
|---|---|---|---|---|
| RC5-ENV-004 | 镜像 `/repo/tests/fixtures=present`（6.0M）；违反「夹具不进镜像」（54 §6.2）。根因：`Dockerfile:32 COPY . .` + `.dockerignore` 未排除 `tests/fixtures` | **P0（新红）** | PASS（旧镜像 99d8 构建早于夹具落盘） | `rerun/E0/verify-rc5-env-runtime.json`、`rerun/logs/ENV-runtime.log` |
| RC5-ACC-006 | 普通用户 B `mcpManager/probe|restart` → HTTP 200 / `ok=true` | P0 | FAIL | `rerun/E2/ACC/RC5-ACC-006/cmd.log` |
| RC5-ACC-008 | B 用 A 的 workspaceId：`workspaceFiles/list|stat|read` 未拒，读到 `E2-ADMIN-SECRET-MARKER-7f3a` | P0 | FAIL | `rerun/E2/ACC/RC5-ACC-008/cmd.log` |
| RC5-SEC-004 | 同 ACC-008（文件面跨租户） | P0 | FAIL | `rerun/E2/SEC/RC5-SEC-004/` |
| RC5-SEC-005 | 同 ACC-006（管理面 unary 可达） | P0 | FAIL | `rerun/E2/SEC/RC5-SEC-005/` |
| RC5-MCPS-006 | 普通用户 restart/probe 系统 MCP `200/true` | P0 | FAIL | `rerun/E1/MCPS/RC5-MCPS-006/cmd.log` |
| RC5-TERM-006 | A 自己 9 动作：create/rename/retain 失败（`session.snapshotEvents is not a function` / terminal unavailable） | P0 | FAIL | `rerun/E3/RC5-TERM-006/report.json`、`rerun/E2/TERM/RC5-TERM-006/` |
| RC5-TERM-008 | 伪造 sessionId 的 `terminal/list`：W5 `ok=true []` → 本轮 `remote-access/denied`（A/B 同）。无宿主枚举、无泄漏；断言按旧语义判红 | P0（语义变化） | PASS | `rerun/E2/TERM/RC5-TERM-008/cmd.log` |
| RC5-SEC-002 | 跟踪文件疑似口令字面量：**14 命中 / 7 文件**（`docs/ai-evo-integration.md` 1 + `packages/access/tests/*` 9 + `scripts/team-platform-gates/*` 4，脱敏计数） | P0 | FAIL（17 行/7 文件 + 固定测试口令） | `rerun/logs/E0-static.log` |
| RC5-BOOT-007 | `--dump-default-config` 仍 `EXIT=1 / 0 bytes`；runner「default=0 ⇒ missing=0」空集 PASS 不成立 | P0 | MISSING | `rerun/E1/BOOT/RC5-BOOT-007/cmd.log` |
| RC5-MCPS-003 | 需真实模型回合；E1 无 LLM 凭据，未执行 | P0 | MISSING | `rerun/E1/MCPS/RC5-MCPS-003/` |
| RC5-TERM-002 | 需浏览器键盘实测；create P1 阻断活终端 | P0 | MISSING | `rerun/E3/RC5-TERM-002/report.json` |
| RC5-TERM-012 | 套件中止；E3 亦未执行 | P0 | MISSING | `rerun/E3/RC5-TERM-012/report.json` |
| RC5-ACP-002 | `session/prompt` 模型 401（E4 占位 key）；W5 曾 `end_turn 184ms`（stub 口径）→ 需产品确认口径 | P0（口径） | PASS | `rerun/E4/acp-report.json`、`rerun/logs/E4-ACP.log` |

> 另有 P0 **未复跑 15 条**（见 §3），不计入红，但同样**不得视为绿**。

## 2. P1 未复跑项（47 条，产品签字或补跑）

| case | W5 | 未复跑原因（本轮） |
|---|---|---|
| RC5-ACP-008 | PASS | 需双客户端并发/模型回合；本轮 ACP 仅跑 001–005 |
| RC5-ACP-009 | PASS | 文档定位（共享 /data）静态项，本轮未重跑 |
| RC5-ACP-010 | PASS | web+ACP 同卷并发需双容器长跑 |
| RC5-CMD-001 | PASS | 命令面需浏览器渲染 |
| RC5-CMD-002 | PASS | 内置命令执行需浏览器 |
| RC5-CMD-003 | PASS | slash 命令并存需浏览器 |
| RC5-CMD-004 | PASS | ACP 无命令面（静态），本轮未重跑 |
| RC5-DATA-008 | PASS | 备份→删除→恢复演练需 p6b 容器/备份链 |
| RC5-DATA-009 | MISSING | 24h 浸泡窗口未满（本轮 4.12h/24h，plannedEnd 2026-11-20T21:45:37Z） |
| RC5-ENV-008 | PASS | llm-openai typecheck 已由 API-003 覆盖（同命令）；未单列重跑 |
| RC5-HERO-004 | PASS | hero 滚动/浮层需浏览器 |
| RC5-HERO-005 | PASS | 双主题品牌色需浏览器截图 |
| RC5-HERO-006 | PASS | 三视口布局需浏览器 |
| RC5-HERO-007 | MISSING | `prefers-reduced-motion` 需动态媒体模拟 |
| RC5-HERO-008 | PASS | hero 态切换需浏览器 |
| RC5-MCPP-011 | MISSING | 需以 `personalHttpHosts` 白名单启动容器；本轮沿用默认实例 |
| RC5-MCPP-016 | MISSING | 挂死 stdio 8s 需 live 会话 |
| RC5-MCPP-017 | MISSING | 慢 HTTP 60s 超时需真实工具调用 |
| RC5-MCPP-018 | MISSING | 断线重连 3 次需长时断连/恢复时序 |
| RC5-MCPP-024 | MISSING | MCP UII 双主题三视口需浏览器 |
| RC5-MCPS-007 | MISSING | 套件在 MCPS-006 红后中止 |
| RC5-MCPS-008 | PASS | migrate-mcp-servers 单测（12）；本轮未单跑 |
| RC5-MCPS-009 | MISSING | 套件中止 |
| RC5-MCPS-010 | MISSING | 套件中止 |
| RC5-OFF-006 | PASS | 输出 24h/512MB 清理/备份排除需 p6b 容器时序 |
| RC5-OFF-007 | MISSING | 需模型回合加载技能 |
| RC5-SEC-010 | MISSING | 无旧版本数据实例（不伪造 PASS） |
| RC5-TERM-009 | MISSING | 长进程切页需浏览器 + 活终端（create P1 阻断） |
| RC5-TERM-010 | MISSING | close 后再 attach 需活终端 |
| RC5-TERM-011 | MISSING | rename/retain 持久需 create 成功 |
| RC5-TERM-013 | MISSING | 24h 浸泡未满（churn=create 持续 fail） |
| RC5-TERM-014 | MISSING | bash 缺失探针未在本轮执行 |
| RC5-UI-002 | PASS | 圆角阶梯需人工/静态扫描；本轮只跑 UI-001 lint |
| RC5-UI-003 | PASS | font-weight 人工核对未重跑 |
| RC5-UI-004 | PASS | 图标来源核对未重跑 |
| RC5-UI-005 | PASS | 断点核对未重跑 |
| RC5-UI-007 | PASS | settings.section 结构核对未重跑 |
| RC5-UI-008 | PASS | z-index 白名单核对未重跑 |
| RC5-V1-002 | PASS（矩阵套件表） | 锁文件条目静态项未重跑 |
| RC5-V1-003 | PASS（矩阵套件表） | cordis 版本/NOTICE 静态项未重跑 |
| RC5-V1-006 | PASS（矩阵套件表） | v1 CI 车道需远端 CI |
| RC5-V1-007 | PASS（矩阵套件表） | v1 源 import 扫描未重跑 |
| RC5-V1-008 | PASS（矩阵套件表） | 镜像不含 v1 源（P5 探针）未重跑 |
| RC5-IMP-006 | PASS | 1001 会话归档需重建 1001 会话夹具 |
| RC5-IMP-007 | MISSING | 512MiB 压测规避共享宿主 |
| RC5-IMP-008 | PASS | 上传中途取消需浏览器/中断控制 |
| RC5-IMP-010 | PASS | 反代 512m/读超时属 E6 配置核对 |

> V1 五条在 `acceptance-matrix.md` 的 164 行表中**没有行**（表实际只有 156 行，缺 V1 8 条），本轮按套件表与证据目录记 PASS；见 leftover `EVID-V1-ROWS`。

## 3. P0 未复跑（15 条）

`RC5-ENV-001`（pnpm install 冻结锁，改 node_modules，同一 worktree 其它 lane 共用→未重跑）、`RC5-MCPS-011`（套件中止）、`RC5-MCPP-019/020/022`（需 live 会话/子代理/登出作用域）、`RC5-TERM-003`（需模型回合）、`RC5-ACP-006/007`（本轮 ACP 脚本未覆盖，W5 PASS）、`RC5-HERO-001/002/003`（浏览器 hero 主路径）、`RC5-DATA-004/005/010`（P6b 迁移/回滚演练，未在共享宿主重放）、`RC5-UI-006`（双主题三视口 24 张截图；W5 FAIL 未修）。

## 4. 补充回归面签字

| 面 | 本轮证据 | 需签字内容 |
|---|---|---|
| 审计 jsonl | 790 行；本轮窗口 117 行、12 类事件；无凭据值（`secret-b` 为 server 名误命中） | 测试确认「事件齐全/无明文」 |
| 治理规则 | 文件在位（7839 B，`default: allow` 为 2026-11-19 拍板）；ask/deny 各一例**未执行** | 产品确认「default allow + 显式 ask/deny 保留」仍可接受；或安排模型回合补证 |
| companion | 匿名 401 / 管理员 200 / guideUrl 在；扩展连接与 `mcp__browser__*` **未执行** | 产品/测试确认浏览器执行面在发布前补证或登记风险 |

## 5. 四方签字栏（51 §6.3）

| 角色 | 签字内容 | 本轮状态 | 日期 |
|---|---|---|---|
| 开发 | P0 用例执行完毕、证据齐 | **未签**：P0 红 14 条（含新红 ENV-004） | |
| 测试 | 用例覆盖与结果复核 | **可签**：97 P0 已逐条对照，红/缺口已列；P1 47 条未复跑已列 | |
| 产品 | 已知问题/风险接受 | **未签**：需接受 §1 的 P0 红与 §2/§4 缺口，并确认 ENV-004 处理（修 `.dockerignore`+重建镜像） | |
| 运维 | 冷备/回滚/窗口确认 | **未签**：24h 浸泡未满（4.12h/24h）；上线窗口未定 | |

> 结论：**T52 复跑与对照完成；因 P0 未清零（且新增 ENV-004 镜像红线），不得判绿、不得进生产窗口。**