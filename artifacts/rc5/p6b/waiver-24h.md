# 24h 浸泡窗口豁免记录（TERM-013 / DATA-009）

- **决策**：产品负责人（用户）2026-11-21 00:28（UTC+8）明确指示：**「不用等24小时了，直接进行接下来的流程」**。
- **依据**：51 §3 遗留处置路径「按 51 步骤逐条补跑**或取得用户签字豁免**」、54 §3.2「P1 清零**或产品签字**」。本记录即产品签字，效力及于四方签字表中「产品」一栏对这两条的接受。
- **范围**：仅豁免这两条的「满 24h」时间判据；**不豁免任何其它用例**，不改变 51 其余口径。两条判 **WAIVED**（不是 PASS——未真实满窗，不冒充绿）。

## 决策时点的实测健康度（抽样证据，非 24h 结论）

| 面 | 已观测 | 实测 |
|---|---|---|
| TERM-013（主 soak，`eterna-rc5-e1`） | 37222s / 86400s（43%） | 609 tick 全部 `churn=ok`、`probeExit=0`；fd 292→280（无增长）；RSS 560MB→380MB（回落）；长进程存活 |
| DATA-009 基础面（同一窗口） | 37038s | 122 tick：写 244 次 0 失败、0 锁、3 库 integrity 全 ok |
| DATA-009 规模面（`eterna-rc5-scale`，50 会话） | 31864s（37%） | 读 26500 次 0 失败、写 5300 次 0 失败、0 锁、5 轮全库 integrity 全 ok |

证据原文：`artifacts/rc5/p6b/soak/final-image2/*.jsonl`、`artifacts/rc5/E2/DATA/scale/ticks.jsonl`（机器可读口径：`waiver-24h.json`）。

## 后续观察与残余风险

- **采样不中断**：两条进程跑满 24h 后自动写 `summary-24h-final2.json` / `scale/summary.json`（2026-11-21T06:08Z / 07:37Z）。摘要只作**事后观察证据**追加，不回改本豁免、不回改矩阵判定。
- **残余风险**：未观测的 13.5h / 15.5h 内若出现 fd 泄漏、`database is locked` 或 integrity 失败，将在生产上线后 24h 观察期（发布说明 §8）内暴露；回滚路径见 `p7/rollback-record.md`（旧镜像 0.1.51 + 冷备 `rc5-2026-11-20/…tgz`）。

## 链路

- 矩阵：`scripts/rc5-acceptance-matrix.mjs` 读 `waiver-24h.json` → 两行判 WAIVED；
- 签字表：`p7/regression/signoff.md` §2/§4 同步登记；
- 发布说明：`p7/release-notes.md` §7 第 1 条改记「产品豁免」。
