# E3 super 形态套件 · 汇总（54 §6.1 / 51）

- 提交：`c75f876c986415431c92b28cce771d847a36c52f`；镜像：`eterna-agent:rc5-test`（`sha256:48782afaf8ba…`）
- 容器：`eterna-rc5-e3`（项目 `rc5-test-e3`，3109，数据根 `/Users/sunny/eterna-data/test-rc5/e3`）
- 窗口：2026-11-20T01:45:06.480Z → 2026-11-20T01:48:25.649Z
- 统计：total=21 pass=10 fail=3 skip=0 notrun=8
- 生产容器未变：**false**（`ID=492c35a4d450fddd1e65c993e4237e14fb497499e9fb077095dec796786fae7c StartedAt=2026-11-19T17:21:06.582265918Z RestartCount=0 Image=eterna-agent:0.1.51`）

| 用例 | 优先级 | 结论 | 标题 |
|---|---|---|---|
| E3-PREP | P0 | FAIL | E3 super 独立测试容器（项目/端口/数据根/镜像） |
| RC5-BOOT-002 | P0 | PASS | E3 super 容器起：healthy + super 路由可访问 |
| RC5-BOOT-013 | P1 | PASS | agent-team 三行与 Team mode（BOOT-013） |
| RC5-BOOT-012 | P0 | PASS | 浏览器加载：10 个产品 client bundle 无版本不匹配（BOOT-012 → workbench 回归面） |
| RC5-API-004 | P0 | NOTRUN | tasks 包 verify（API-004）——替代覆盖：test/typecheck/oxlint |
| RC5-API-005 | P0 | NOTRUN | 主会话派 2 个 worker：waitForTreeWork 等到全部完成（API-005） |
| RC5-API-006 | P1 | NOTRUN | 查询后代列表与任务树一致（API-006） |
| RC5-API-007 | P1 | NOTRUN | 排空后代后无残留 running（API-007） |
| E3-TASKS-SURFACE | P1 | PASS | （lane 本地）tasks 设置/角色面 live 契约 |
| RC5-TERM-001 | P0 | PASS | profile bundle 清单含 terminal bundle（TERM-001） |
| RC5-TERM-007 | P0 | PASS | terminal 配置（TERM-007） |
| RC5-TERM-006 | P0 | FAIL | 同 session 调 9 动作全部成功（TERM-006） |
| RC5-TERM-004 | P0 | FAIL | B 用 A 的 sessionId：6 个 terminal unary 全部拒绝（TERM-004） |
| RC5-TERM-005 | P0 | NOTRUN | attach/retain/watch 三流动作跨租户被拒（TERM-005） |
| RC5-TERM-002 | P0 | NOTRUN | 侧栏 terminal 面板可见/可开/首次按键接管（TERM-002） |
| RC5-TERM-012 | P0 | NOTRUN | 两会话各开终端互不可见（TERM-012） |
| RC5-TERM-013 | P1 | NOTRUN | 24h 浸泡：长进程 + attach/close 无 fd 泄漏（TERM-013） |
| WB-001 | P1 | PASS | （workbench）实时流首帧快照契约 |
| WB-002 | P1 | PASS | （workbench）panel 挂载 + 客户端工件 |
| WB-003 | P1 | PASS | （workbench）单元/类型/静态门 |
| WB-004 | P1 | PASS | （workbench）tasks↔workbench 主会话/健康面链路 |

## 失败项

- **E3-PREP** E3 super 独立测试容器（项目/端口/数据根/镜像）：生产容器未重启/未换容器（ID+StartedAt+RestartCount 与基线一致）
- **RC5-TERM-006** 同 session 调 9 动作全部成功（TERM-006）：terminal/create 成功（9 动作前置）；6 个 unary 动作全部成功
- **RC5-TERM-004** B 用 A 的 sessionId：6 个 terminal unary 全部拒绝（TERM-004）：B 用 A 的 sessionId 调 6 个 unary 全部 403/deny

## 未跑项（NOTRUN）

- **RC5-API-004** tasks 包 verify（API-004）——替代覆盖：test/typecheck/oxlint：51 的 API-004 命名命令 `pnpm --filter @eterna/tasks verify` 含 build:client（写 packages/tasks/lib/client.js）；本 lane 可改文件仅限 artifacts/rc5/e3-super/**，故未跑复合 verify，改跑 test/typecheck/oxlint 三段并如实标注。
- **RC5-API-005** 主会话派 2 个 worker：waitForTreeWork 等到全部完成（API-005）：E3 测试账号 rc5admin 与模板 realm=Mr.Ma 不对齐 → orchestrator 主会话未登记；API-005 的「主会话派 2 个 worker」在 E3 无法成立（P6 需真模型 + realm 对齐账号）。
- **RC5-API-006** 查询后代列表与任务树一致（API-006）：listDescendants 属宿主 subagent 服务方法，无公开 RPC；需由真实 worker 树驱动。前置（模型/ realm）见 RC5-API-005。
- **RC5-API-007** 排空后代后无残留 running（API-007）：drainDescendants 需真实后代树；前置（模型/ realm）见 RC5-API-005。
- **RC5-TERM-005** attach/retain/watch 三流动作跨租户被拒（TERM-005）：TERM-005 为 P0 未跑项：需要 WS mux 客户端（同 P5 记录）。unary 面已证同族跨租户泄漏（TERM-004）。
- **RC5-TERM-002** 侧栏 terminal 面板可见/可开/首次按键接管（TERM-002）：侧栏 terminal 面板的「可见/可开/首次按键接管/Agent 只读」需真浏览器交互与输入；本轮不做（凭据边界见 E3-UI-002）。
- **RC5-TERM-012** 两会话各开终端互不可见（TERM-012）：terminal/create 被 gateway/internal（session.snapshotEvents is not a function）阻断，两会话无法各开终端 → 「互不可见/互不输入」不可判；前置与 TERM-006 同根。
- **RC5-TERM-013** 24h 浸泡：长进程 + attach/close 无 fd 泄漏（TERM-013）：P5 24h 浸泡在 E1 运行，plannedEndAt=?；当前采样 0 条、窗口未满不得判过；且 churn=create 持续 fail（同 session.snapshotEvents 错误）。
