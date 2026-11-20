# rc.5 · P7 签字表（最终状态）

- 依据：51 §6.1（已知问题清单经产品签字）、51 §6.3（四方签字）、54 §11 / §3.2（P0 全绿；P1 清零或产品签字）
- 权威状态：`artifacts/rc5/acceptance-matrix.md`（164 行）+ `artifacts/rc5/p7/doc54-delivery-audit.md`
- 原则：**未复跑 ≠ 绿**；本表只写「最终镜像上实跑了什么、还缺什么」
- 历史 T52 快照（14 条 P0 红项与 47 条 P1 未复跑清单）见 git 历史 `c75f876:artifacts/rc5/p7/regression/signoff.md`

## 1. 最终结果摘要

| 项 | 结果 | 证据 |
|---|---|---|
| 矩阵 164 条 | **159 PASS / 0 FAIL / 5 MISSING** | `artifacts/rc5/acceptance-matrix.md` |
| P0 102 条 | **101 PASS / 0 FAIL / 1 MISSING（RC5-API-005）** | 同上 |
| 全工作区 verify | merge 前后各 **EXIT=0** | `p7/verify-precommit.log`、`verify-postmerge.log` |
| CI 本地镜像 | `ci.yml` 全步骤 **35 EXIT=0**（含双 boot/tenant-scan/prompt-scan/evals/v1-line） | `p7/ci-local.log` |
| 最终镜像 | `eterna-agent:rc5-test` = `sha256:22fe8acb…` | 各 lane summary.json |
| 治理 ask/deny | **PASS**（deny/ask 审计+会话事件+工具结果；ask 卡片按 `approval:never` 产品口径不产生） | `E2/SEC/RC5-SEC-GOV/result.md` |
| companion 中继 | **PASS（协议级）**；真实扩展 **NOTRUN** | `p7/regression/supplement/companion-relay.md` |
| R02 行为项六件 | **PASS** | `p7/regression/R02/result.md` |

## 2. 剩余 MISSING（不得视为绿）

| case | 级别 | 缺口 | 解除条件 |
|---|---|---|---|
| RC5-API-005 | **P0** | 主会话派 2 worker 的 app 级 E2E 需真模型 + `realm=Mr.Ma` 对齐；E3 实测 `AUTH 401` + realm 不在 access 用户表。P7 harness（真实 tasks 装配 + stub 模型）已跑通 2 worker 真回执，但按 51 口径不计 PASS | 真模型/realm 补跑通过，或产品签字豁免 |
| RC5-API-006/007 | P1 | `listDescendants`/`drainDescendants` 无公开 RPC，需真实后代树 | 同 API-005 前置 |
| RC5-TERM-013 | P1 | 24h fd/内存窗口未满（`eterna-rc5-e1`，止 `2026-11-21T06:08:06Z`） | 满窗且无持续增长/无异常 |
| RC5-DATA-009 | P1 | 24h 浸泡未满（主窗口同上；50 并发规模窗口 `eterna-rc5-scale` 止 `2026-11-21T07:37:17Z`） | 满窗 + 0 锁/0 WAL 异常/全库 integrity ok |

> P0/P1 之外：远端 CI 未运行（分支未 push）、真实扩展 NOTRUN、四方签字未签、P7 生产操作未执行。

## 3. 补充回归面签字

| 面 | 最终证据 | 需签字内容 | 建议结论 |
|---|---|---|---|
| 审计 jsonl | `p7/regression/supplement/supplement.json`：2749 行、窗口 2076 行、凭据值 0 命中（10 行夹具名单列） | 测试确认「事件齐全/无明文」 | 可签 |
| 治理规则 | `E2/SEC/RC5-SEC-GOV/result.md`：deny/ask 各一例均命中并留痕；ask 因 `approval:never` 确定性 rejected，不产生决策卡 | 产品确认「ask 无卡片」仍符合 2026-11-19 静默裁决 | 可签（产品口径） |
| companion 中继 | `supplement/companion-relay.md`：匿名 401、reset 签发、错误 token 拒、在线探测/断开回收全 PASS；真实扩展 NOTRUN | 产品/测试确认协议级口径可接受，或安排桌面验收机补真实扩展 | 待产品裁决 |

## 4. 四方签字栏（51 §6.3）

| 角色 | 签字内容 | 状态 | 日期 |
|---|---|---|---|
| 开发 | P0 用例执行完毕、证据齐 | **未签**：等 API-005 补跑或豁免 | |
| 测试 | 用例覆盖与结果复核 | **未签**：159/0/5 已核；5 条 MISSING 与补充面边界已列 | |
| 产品 | 已知问题/风险接受（H7/H16/terminal/rc.5 预发布；API-005 豁免与否；companion 口径） | **未签** | |
| 运维 | 冷备/回滚/生产窗口确认（24h 窗口满、部署时间） | **未签** | |

> 结论：**代码/测试面已到 P6 可交付状态；P7 签字与生产操作待上表四项完成后启动**（54 §3.2：P6 未收口，P7 不得启动）。