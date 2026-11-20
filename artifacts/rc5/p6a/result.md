# T50 — rc.5 验收矩阵与证据包汇编结果

- 任务：T50（54 §5.4 / §7.1 / §7.3；51 §0.3 / §6.3）
- 工作树：`/Users/sunny/code/agent-basis-rc5`，分支 `feat/dsh-rc5-merge`，HEAD `02f4857`
- 执行窗口：2026-11-19T22:22Z – 2026-11-20T00:57Z（soak 采样持续中）
- 产出：`artifacts/rc5/acceptance-matrix.md`（164 行）+ `artifacts/rc5/{p0..p7,p6a,p6b}/summary.json` + 本目录证据
- **总判定：不可判绿**。PASS 129 / FAIL 9（全部 P0）/ MISSING 26（其中 8 条 P0）；24h 浸泡窗口未满；P7 未启动。

## 1. 期望 vs 实际

| 检查 | 期望 | 实际 | 证据 |
|---|---|---|---|
| 矩阵行数 | 164（51 §3 全集 + 54 增补） | 164 行 / 164 个唯一 id | `verify-matrix.mjs` → `MATRIX_ROWS_164` / `MATRIX_UNIQUE_IDS_164`，EXIT=0 |
| 套件分布 | ENV8/BOOT13/API9/ACC10/MCPS11/MCPP24/TERM14/IMP10/ACP10/OFF7/HERO8/CMD4/V1 8/DATA10/UI8/SEC10 | 16 套件逐一相符 | `MATRIX_SUITE_COUNTS_16`，EXIT=0 |
| 阶段分布 | P1=10/P2=12/P3=7/P4=17/P5=16/P6a=97/P6b=5 | 逐项相符 | `MATRIX_PHASE_COUNTS`，EXIT=0 |
| 状态分布 | 不得虚绿 | PASS 129 / FAIL 9 / MISSING 26 | `MATRIX_STATUS_129_9_26`，EXIT=0 |
| PASS 可追溯 | 每行 PASS 有 `artifacts/rc5/` 证据路径 | 129/129 行满足 | `MATRIX_PASS_HAS_EVIDENCE`，EXIT=0 |
| 阶段 summary | p0–p7 均有 54 §7.3 键（phase/commit/imageTag/startedAt/finishedAt/commands/cases/leftovers） | 9 份全通过；p6b 另保留 lane 原 `cases` 数组 11 条 | `SUMMARY_*_KEYS`、`P6B_LANE_CASES_PRESERVED`，EXIT=0 |
| 24h 浸泡 | 满 86400s 才可判绿 | 观测 3.18h/24h，`windowComplete=false`；plannedEnd 2026-11-20T21:45:37Z | `SOAK_INCOMPLETE`、`SOAK_OBSERVED_LT_24H`，EXIT=0 |
| 两条浸泡用例 | 不满窗不得 PASS | DATA-009 = MISSING、TERM-013 = MISSING | `NOT_GREEN_RC5-DATA-009` / `-TERM-013`，EXIT=0 |
| 脱敏 | 矩阵/审计/result.md/9 份阶段 summary/soak-window 0 命中 cookie/token/密钥 | `hits=0`，RESULT=PASS | `secret-scan.log`、`SECRET_SCAN_HITS_0`，EXIT=0 |

重放方式（只读 evidence，仅写 `artifacts/rc5/**`）：

```bash
bash artifacts/rc5/p6a/run-t50-verify.sh > artifacts/rc5/p6a/scan-cmd.log 2>&1
# → T50_SELFTEST=PASS，SCRIPT_EXIT=0
```

命令原文、每次调用的 EXIT 与自检输出见 `scan-cmd.log`；断言汇总见 `assertions.log`；逐用例审计见 `case-audit.json`。

## 2. 判定口径（与 54 §5.4 一致）

- **PASS**：引用证据同时具备命令日志（`cmd.log`/run 日志）与结果记录（`result.md`；ACP 用 `assert.json`，MCPS P2 用 `report.md`），退出码符合（0 / HTTP 200 / 负控期望 400/401），结果记录判 PASS。
- **FAIL**：任一引用证据判 FAIL。9 条 FAIL 均保留原始日志，未裁剪：
  - 跨租户/管理面：ACC-006、ACC-008、MCPS-006、TERM-004、TERM-006、SEC-004、SEC-005（7 条）
  - 凭据：SEC-002（跟踪测试文件含疑似口令字面量）
  - UI：UI-006（390 hero 提示遮挡 chip；terminal 5/6 错误页；chat-import 6/6 无入口）
- **MISSING**：SKIP/NOTRUN/未执行/无结果记录/EXIT 与 PASS 不符。典型：
  - BOOT-007：`result.md` 写 PASS，但 `--dump-default-config` `EXIT=1`、输出 0 bytes，属空集假 PASS → 记 MISSING，需修命令重跑，**不标绿**。
  - 8 条 P0 缺失：MCPS-003、MCPP-019/020/022、TERM-002/003/012 未执行；BOOT-007 如上。
  - 其余缺失集中在依赖 live 会话/真模型/浏览器键盘/CDP 的用例（清单见矩阵）。
- P0 优先级行共 102 条，非 PASS 17 条（FAIL 9 + MISSING 8）→ 门禁红。

## 3. 24h 浸泡窗口

- 启动 2026-11-19T21:45:37.331Z，计划结束 2026-11-20T21:45:37.331Z（86400s）。
- 最新采样 2026-11-20T00:56:11Z：已观测 **3.18h / 24h**，`windowComplete=false`。
- 最新 tick：3 库 `integrity=ok`；write ok=2 / failed=0；`lockMatches=0`、`walLogMatches=0`。
- TERM churn 持续失败（`terminal/create` 返回 `gateway/internal: session.snapshotEvents is not a function`），与 P5/P6a 的 P0 根因同源，不据此判 DATA 红/绿。
- 结论：**窗口未满，DATA-009 / TERM-013 均 MISSING**，登记 `SOAK-24H`；满窗后须复核 `window.complete=true` 与 verdict 才可改判。

## 4. 证据口径偏差（已在矩阵内登记，不隐藏）

| 偏差 | 处理 |
|---|---|
| ACP-001..010 用 `assert.json` 而非 `result.md` | 接受为等价结果记录（含断言级 pass/fail），登记 `EVID-ACP` |
| MCPS-008/011 用 `report.md + run*.log` | 接受为等价证据，登记 `EVID-MCPS` |
| ENV-004/005、V1-008 的运行时半来自 P5 镜像探针 `env-runtime/run.log` 标记行 | 矩阵引用双来源，登记 `EVID-ENV-V1` |
| API-005..007 文档标 E3，实跑在 E1(3108) | 状态按实跑证据计 PASS，环境偏差登记 `API005-ENV` |
| API-005..007 LLM 为 stub | PASS 仅覆盖 worker/子代理路径，真模型 E2E 未跑，登记 `API005-REALMODEL` |
| 顶部 BOOT/UI/SEC 与 E1/E2 同名目录证据并存 | 选取覆盖证据，部分来源标 `cover:false`，不重复计分（见 `case-audit.json`） |

## 5. summary 合并与幂等

- `p0/summary.json`、`p6b/summary.json` 原 lane 字段全部保留；新增 54 §7.3 键为增量字段；合并前原件备份在 `pre-merge-backup/`。
- 重跑幂等：`cmp` 前后 p0/p6b summary 均 `EXIT=0`，备份 `shasum -c` 全 OK（见 `scan-cmd.log` §2）。`generatedAt` 合并时保留首版，避免无意义 diff。

## 6. 遗留项（14 条，与矩阵 §遗留项 一致）

| id | 现象 | 级别 | 建议 |
|---|---|---|---|
| SOAK-24H | 24h 浸泡窗口未满（实时观测见 `p6a/soak-window.json`；plannedEnd 2026-11-20T21:45:37.331Z） | P0 | 满窗后复核 `window.complete=true` 与 verdict；DATA-009/TERM-013 未满不得判绿 |
| CROSS-TENANT | TERM-004/006、ACC-006/008、SEC-004/005、MCPS-006 共 7 条 P0 跨租户/管理面未拒 | P0 | 修 terminal/workspaceFiles 租户守卫与 mux ADMIN_ONLY/GLOBAL_UNARY 后重跑 ACC/TERM/MCPS/SEC 全组 |
| MISSING-P0 | 8 条 P0 未通过：MCPS-003、MCPP-019/020/022、TERM-002/003/012 未执行；BOOT-007 dump-default EXIT=1/0 bytes | P0 | 补 live 会话、跨用户工具调用、键盘实测；修 BOOT-007 后重跑 |
| MISSING-P1 | 17 条 P1/P2 未执行（MCPS-007/009/010、MCPP-011/016/017/018/024、TERM-009/010/011/013/014、IMP-007、OFF-007、HERO-007、SEC-010） | P1 | 按 51 步骤逐条补跑 |
| SEC-002 | 跟踪测试文件含疑似口令字面量（17 行/7 文件 + 固定测试口令 5 行）；镜像/argv 扫描未做 | P0 | 替换为明显假值并全仓重扫；补镜像/日志/argv 扫描 |
| API005-REALMODEL | API-005..007 以真实 worker/子代理路径通过，但 LLM 为 stub | P0 | 真模型 + realm 对齐后补跑 |
| API005-ENV | API-005..007 文档标 E3，实跑在 E1(3108) | P2 | E3 补跑或登记环境豁免 |
| UI-006 | 24 张截图已产出，但 390 hero 遮挡、terminal 5/6 错误页、chat-import 6/6 无入口 | P0 | 修复后重截 24 张 |
| MCPS-011-E2E | H9 容器端到端重渲染 deferred（本地机制 11/11 PASS） | P1 | 用旧 profile 副本起容器实测 servers 保留与 0600 备份 |
| EVID-ACP | ACP-001..010 以 assert.json 为结果记录，缺 result.md | P2 | 补 result.md 或登记等价证据规范 |
| EVID-MCPS | MCPS-008/011 以 report.md + run*.log 为记录，缺 result.md | P2 | 补 result.md 或登记等价证据规范 |
| EVID-ENV-V1 | ENV-004/005、V1-008 运行时断言由 P5 镜像探针补证 | P3 | 保留 P5 探针索引；按需逐字复跑 |
| DATA-009-SCALE | soak 仅 2 writers、每 5min 检 3 库，未达 48 §4.5 ≥50 并发 + 2h 全库 integrity | P1 | 满窗前补压 |
| P7-NOTRUN | P7 全量复跑/PR/合并/生产部署/上线后 24h 未执行（P6 未收口） | P0 | P6 清零后按 51 §6.1/§6.2、54 §3.2 执行 |

## 7. 边界声明

- 未 `git push` / `git merge`；未停止或修改生产容器；未写 `deepseek-harness`；未触碰 `/Users/sunny/code/agent-basis`；未改其它 lane 独占文件。
- 仓库内写入仅限 `artifacts/rc5/**`：矩阵、9 份阶段 summary、`p6a/` 证据（汇编脚本 `scan-matrix.mjs`、自检 `verify-matrix.mjs`/`run-t50-verify.sh`、`case-audit.json`、`assertions.log`、`secret-scan.log`、`soak-window.json`、`scan-cmd.log`、`pre-merge-backup/`）。
- 凭据未落盘/日志/argv；矩阵、审计、result.md、9 份阶段 summary 与 soak-window 经模式扫描 0 命中（`secret-scan.log`）。