# 54 号 Workflow 交付审计（2026-11-20 晚）

> 审计对象：`docs/design/54-rc.5开发与测试验收完整workflow.md`（8 阶段 v2）
> 口径：54 §3.2 阶段退出条件 + §9 RAID + §10 交付/部署；用例唯一口径 = 51 的 164 条
> （本文件所有数字均可在 `artifacts/rc5/` 对应路径复查，未跑项不标绿）
> 施工面：worktree `/Users/sunny/code/agent-basis-rc5`，分支 `feat/dsh-rc5-merge`，HEAD `ffeecf8`（领先 `origin/main` 21 提交，落后 0）

## 0. 结论

**54 的完整交付尚未满足**，但不是「代码未做完」：

| 类别 | 状态 |
|---|---|
| P0–P6 代码与测试 | **已收口到最终镜像**：矩阵 164 条 = **159 PASS / 0 FAIL / 5 MISSING**；P0 102 条 = **101 PASS / 0 FAIL / 1 MISSING** |
| 全工作区门禁 | `pnpm -w run verify` merge 前后各 **EXIT=0**；`ci.yml` 全步骤本地镜像 **35 步 EXIT=0** |
| P6 剩余 5 条 | 1 条 P0（API-005，真模型/realm 阻塞）+ 2 条 P1 同前置（API-006/007）+ 2 条 P1 时间窗（TERM-013/DATA-009 24h 未满） |
| P7 | **未执行**：未 push、未建 PR、未合并、未从 latest main 构建部署、无上线后 24h |
| 签字 | 四方签字栏空 |
| 远端 CI | 分支未 push，`upgrade-gate` / `v1-line` 无远端运行记录 |

> 一句话：**代码/证据面已到 P6 可交付状态；P7 与 1 条 P0 环境项、2 条 24h 时间窗、签字与远端 CI 未闭合。**
> 按 54 §3.2「P6 未收口，P7 不得启动」——当前不能宣称 54 全量交付完成。

---

## 1. 阶段审计（54 §3.2 退出条件逐条对照）

| 阶段 | 退出条件（摘要） | 实况 | 判定 |
|---|---|---|---|
| **P0** 基线冻结 | worktree/方案入库/基线/旧镜像 digest/冷备/verify.sh 基线 | `artifacts/rc5/p0/summary.json`；旧镜像 `0.1.51` digest、冷备 `rc5-2026-11-20/...tgz` sha、17 库 integrity 全在 | ✅ 关闭（历史 leftover P0-02 生产 verify.sh 全量执行仍受凭据/argv 边界约束，以本地等价证据替代并登记） |
| **P1** 依赖/API | install frozen 0、全仓 verify 0、llm-openai typecheck、版本残留 0、H2 worker smoke、ENV/API 子集 | 28 条 catalog 对齐 + `02f4857`；`p1/summary.json` 10/10；`verify-precommit.log` EXIT=0 | ✅ 关闭 |
| **P2** profile/preset | 双 boot 无 `disabling profile plugin`、unknown row 0、form-check 0、prompt-scan 0、BOOT-004..012、MCPS-008/011、迁移接线 | `p2/summary.json` 12/12；`ci-local.log` 双 boot/form-check/tenant-scan/prompt-scan 全 0；migrate 脚本接线 `docker/entrypoint.sh:222/228` | ✅ 关闭（R19 已补扫描根+未登记 key 拦截测试） |
| **P3** v1 + 派生件 | V1-001..007、含 v1 的全仓 verify、brand 扫描 0、compaction 语义、B10 typecheck、v1 CI 绿 | `p3/summary.json` 7/7；V1-008 运行时探针 8/8；`ci-local.log` v1-line 全步骤 EXIT=0 | ✅ 关闭（v1-line 远端运行仍缺，见 §4） |
| **P4** 能力 + 客户端 | 各包 verify、静态门禁、B14/B16/B19/B20 单测、UI-001..005/007/008、10 包 client 重建、`PluginTabProps.update()` | `p4/summary.json` 17/17；10 包 `lib/client.js` 重建提交 `5b91c5f`；R02 六件补证 PASS | ✅ 关闭 |
| **P5** 镜像/基座 | 镜像构建、dsh 版本、node≥24.9、symlink、v1 剥离、字体/Python、3108 测试容器、ENV/DATA/BOOT 子集、浸泡启动 | 最终镜像 `sha256:22fe8acb…`；`p5/summary.json` 16/16；E1/E2/E3/scale 容器均 healthy、restarts=0 | ✅ 关闭（浸泡「启动」满足；「满窗」归 P6） |
| **P6a** E2E 全组 | 51 P0 全绿、P1 清零或签字、跨租户矩阵、证据齐 | E1 58 PASS/1 NOTRUN；E2 67 PASS；E3 18 PASS/5 NOTRUN；矩阵 159/0/5 | ⚠️ **未全绿**：API-005（P0）+ API-006/007（P1）真模型前置；TERM-013（P1）24h 未满 |
| **P6b** 数据轨 | TERM-013/DATA-009 浸泡通过、DATA-004/005/008/009/010、证据齐、签字表齐 | DATA-004/005/007/008/010 PASS；DATA-009 两条 24h 窗口进行中（见 §3）；签字空 | ⚠️ **未收口**：24h 窗口未满 + 签字缺 |
| **P7** 回归→PR→合并→部署→准出 | 51 §6.1 全勾、PR CI 全绿、latest main 构建部署、§6.2 全勾、发布说明、回滚记录 | 发布说明/回滚记录/PR body 已定稿；**未 push/未建 PR/未合并/未部署** | ⛔ **未执行** |

### 1.1 阶段 summary 的时效说明

`artifacts/rc5/p{0..6b}/summary.json` 是各阶段**当时**的快照（如 `p6a` 仍记 97 例、旧 leftovers）；
最终权威状态以 `artifacts/rc5/acceptance-matrix.md`（HEAD `f1418dd` 头部）+ `p7/` 三件套为准。
阶段 summary 不得反向覆盖最终矩阵数字（54 §7.3「EXIT 只能来自真实命令」）。

---

## 2. RAID 台账现状（54 §9 的 21 项）

| id | 级别 | 现状 | 证据/说明 |
|---|---|---|---|
| R01 | P0 | **in_progress** | tasks API 已迁移（`e71e33d`），stub 模型 2 worker 真回执已跑；**API-005 真模型 E2E 仍缺** |
| R02 | P1 | **closed** | 六件逐项补证 PASS：`artifacts/rc5/p7/regression/R02/result.md`（LoggerLevel 引 API-009；投影帧参数序/GenerateOptions 泛型/ToolGuardDenial/PluginTabProps.update 均为 rc.5 安装源精确签名 + 本仓消费位 + verify EXIT=0） |
| R03 | P1 | **closed** | 版本残留 0（`p1/verify-rc5-env.*`、`p1/summary.json`） |
| R04 | P1 | **in_progress** | API-009 PASS；API-005/006/007 仍 MISSING（真模型/realm） |
| R05 | P0 | **closed** | mcpManager 管理面 admin-only：`MCPS-006`、`SEC-005` PASS；`mux.ts` `MCP_MANAGER_PATH_PREFIX` 403 分支 |
| R06 | P0 | **closed** | channels webhook 路由面移交 access（`packages/access/src/channels-webhook.ts` + entrypoint 接线）；tenant-scan **0 finding** |
| R07 | P1 | **closed** | 10 包 client 重建（`5b91c5f`；`ci-local.log` 10 包 build-client EXIT=0） |
| R08 | P1 | **closed** | prompt-scan 0（`p2/prompt-scan-r2.log`、`ci-local.log`） |
| R09 | P1 | **closed** | migrate 脚本接入 entrypoint（`docker/entrypoint.sh:222/228`）+ 干跑/单测证据（`p2/migrate-*`） |
| R10 | P1 | **closed** | `scripts/profile-upgrade-check.mjs` 存在且进 entrypoint 预检 |
| R11 | P1 | **closed** | B2/B3/B10：v1 线（`7dafc9f`）、compaction 语义测试、B10 typecheck 均绿 |
| R12 | P2 | **closed** | agent-team 真 boot/审计：`BOOT-013` PASS（E1 + E3） |
| R13 | P1 | **closed** | 默认集功能 E2E：session-search/market/chat-import/terminal 行在 E1/E2 车道覆盖（`MCPS-008/011`、`CMD-003`、`TERM-*`） |
| R14 | P2 | **closed** | P3 文件已提交（`7dafc9f`/`5b91c5f` 等） |
| R15 | P1 | **closed** | cordis 变更后全仓 verify：`p7/verify-postmerge.log` **EXIT=0** |
| R16 | P1 | **closed** | V1-001..007 PASS + V1-008 运行时探针 8/8 |
| R17 | P0 | **closed** | P0 基线/冷备/旧镜像 digest：`artifacts/rc5/p0/summary.json`、`p0/backup/` |
| R18 | P1 | **closed** | 发布说明 + 反代 `IMP-010` PASS：`p7/release-notes.md`、`E1/IMP/RC5-IMP-010` |
| R19 | P1 | **closed** | `PATCH_SCAN_ROOTS` 含 `docker/profile` + 未登记 key 被拦测试（`p2/acc-002`） |
| R20 | P1 | **closed（协议级；真实扩展 NOTRUN）** | 治理 ask/deny：`artifacts/rc5/E2/SEC/RC5-SEC-GOV/result.md`（deny/ask 均审计+会话事件+工具结果；ask 决策卡按产品 `approval:never` 口径不产生）；companion 中继：`p7/regression/supplement/companion-relay.md`（协议级 PASS；**真实扩展 NOTRUN**，见 §4.3-6）；审计 jsonl：`supplement.json`（2861 行、凭据值 0 命中） |
| R21 | P2 | **open（文档瑕疵）** | 51 分节标题计数落后实际行（BOOT/MCPS/ACP/OFF）；不影响 164 行判定，登记后续修标题 |

> 按 54 §9 目标「P0/P1 清零」：当前 **P0 仅 R01 未清（API-005）**；P1 仅 **R04 未清（API-005/006/007）**，其余 P1 已闭。

---

## 3. 时间窗长跑项（P6b）

| 窗口 | 容器/数据根 | 起止 | 现状 | 收口判定 |
|---|---|---|---|---|
| TERM-013 + DATA-009（主 soak） | `eterna-rc5-e1` / `~/eterna-data/test-20261120/e1` | 起 `2026-11-20T06:08:06Z` → 止 **`2026-11-21T06:08:06Z`** | healthy，RestartCount=0；data tick 101：3 库 integrity ok、0 锁、写 2/2；term 采样同步追加 | 满窗后跑 `summary-24h` 复核；未满 = NOTRUN |
| DATA-009 规模补证（48 §4.5） | `eterna-rc5-scale` / `~/eterna-data/test-rc5/scale` | 起 `2026-11-20T07:37:17Z` → 止 **`2026-11-21T07:37:17Z`** | 50 持久会话；每 60s 50 并发读、每 5min 50 并发写、每 2h 全库 integrity；tick 36 读写 50/50、locks=0；`restarts=0` | 满窗且 0 读写失败/0 integrity 失败/0 锁 = PASS；未满 = NOTRUN |

> 两条窗口都在**最终镜像** `sha256:22fe8acb…` 上跑；到期前不得用采样冒充 24h（54 §3.5、48 §4.5）。

---

## 4. 当前待解决问题（按可解除性排序）

### 4.1 环境/时间依赖（可自行收口）

1. **TERM-013 / DATA-009 24h**：等 `2026-11-21T06:08:06Z` 与 `07:37:17Z` 满窗后复核，更新矩阵两行；若 0 异常即转 PASS。
2. **远端 CI**：分支未 push，`ci.yml` 的远端 `upgrade-gate`/`v1-line` 无运行记录；本地镜像已 35 步 EXIT=0，但**不能以本地代替远端**（PR §8.2-4）。

### 4.2 需要用户授权/外部条件

3. **API-005（P0）/ API-006 / API-007**：真模型 + `realm=Mr.Ma` 对齐才能跑 app 级 worker E2E。当前环境实测 `AUTH 401 invalid API Key` + realm 不在 access 用户表；P7 harness 已用真实 tasks 装配 + stub 模型跑通 2 worker 真回执（`p7/regression/rerun/API/out/results.json`），但按 51 口径仍记 MISSING。
   - 出路：提供可用模型凭据并授权测试 lane 使用；或产品签字豁免（PR §8.2-1）。
4. **四方签字**：`p7/regression/signoff.md` 未签；需产品/研发/测试/运维签字。
5. **P7 生产操作**：`git push`、创建 PR、合并、从 latest main 构建部署、上线后 24h 观察——**均需用户单独确认**（54 §10.2、§13.6）；当前一律未做。

### 4.3 已知边界（非缺陷，需在发布说明落字）

6. **真实 Chrome 扩展 REAL-EXT = NOTRUN**：headless 无人值守环境不能交互式加载未打包 MV3 扩展；中继协议/令牌/在线探测已协议级 PASS（`companion-relay.md`）。若要实测，需在带桌面会话的验收机执行。
7. **H16 个人 MCP HTTP 可访问内网 / H7 回滚后 rc.5 新会话不可读 / terminal 接管不可交还**：49 §11 产品已书面接受，PR §5 与发布说明已逐条落字，控制项证据在 `packages/access/src/mcp-personal.ts`、`p7/rollback-record.md`、TERM 车道。

---

## 5. 本轮新增/刷新的证据

| 证据 | 内容 | 结果 |
|---|---|---|
| `artifacts/rc5/E2/SEC/RC5-SEC-GOV/{cmd.log,result.md}` | 治理 deny/ask 实跑：探针规则经 `access/governance.rules.yml` 注入，跑完还原 | **PASS**（deny：`命中规则 probe-deny(deny)` + 审计 decision=deny；ask：`approval/asked` → `approval/decided=rejected`（policy=never）+ 审计 decision=ask） |
| `artifacts/rc5/p7/regression/R02/{cmd.log,result.md}` | R02 六件逐项补证 | **PASS**（9/9 断言） |
| `artifacts/rc5/p7/regression/supplement/companion-relay.{log,md}` | companion 令牌/relay 协议实测 | **PASS（协议级）**；REAL-EXT NOTRUN |
| `artifacts/rc5/p7/regression/supplement/supplement.json` | 审计 jsonl/治理规则计数（2861 行；凭据值 0 命中） | 刷新 |

---

## 6. 54 何时可判「交付完成」

全部满足才可：

- [ ] API-005 真模型/realm 补跑 PASS，或产品签字豁免（同时解除 API-006/007 口径）；
- [ ] TERM-013 + DATA-009 主窗口满窗通过（`2026-11-21T06:08:06Z` 后）；
- [ ] DATA-009 规模窗口满窗通过（`2026-11-21T07:37:17Z` 后，50 并发口径）；
- [ ] 矩阵 164 行无 MISSING（或全部经签字豁免），P0 102/102；
- [ ] 分支 push → PR → 远端 CI 全绿（含 `v1-line`）→ 合并；
- [ ] latest main 构建镜像并部署，`verify.sh` + 冒烟全过；
- [ ] 上线后 24h 无 P0 告警；
- [ ] 四方签字 + 发布说明/回滚记录归档。

> 未满足上述任一项前，本文件只能判 **「P0–P6 代码/测试面可交付，P7 未启动」**，不得写成「54 全量完成」。