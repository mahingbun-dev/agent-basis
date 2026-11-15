# 22a - 摘要模型评估结论与建议默认档（C8a）

> 状态：结论文档（供 21 号 §10 Q1 拍板；拍板后 C8b 据此执行或维持）
> 日期：2026-11-15 回补（评估执行于 2026-11-13）
> 数据来源：`packages/compaction/evals/reports/2026-11-13-summary-model.md`（6 候选全量 sweep，逐模型失分明细）与 `2026-11-13-baseline.md`（deepseek-flash 单模型基线）；本文件只承载结论与决策依据，数字以两份报告为准
> 上游：[[22-压缩系统开发文档-M-C1至M-C3]] §4-C8a（规格点名本文档）、[[21-压缩系统产品设计-会话连续性与分层保真]] §10 Q1

## 1. 评估设置（摘要）

- 候选 6 个：`deepseek-flash`（现档=会话模型）、`mimo-v2.6-flash`、`mimo-v2.6-pro`、`mimo-v2.6-pro-ultraspeed`、`glm-5.3`、`glm-5.3-flash`；经内网网关直连，每候选全量重跑 4 个 golden 用例（走真实 `compactSurfaceRegion` 事务，评分器同 C4）。
- 门槛：userVerbatim 100% / filePaths·errorStrings·commands ≥90% / decisions ≥80% / 标题齐备 100% / mustNotAppear 零命中。
- 费用以 token 为代理（内网网关不暴露单价）；摘要生成不设 temperature，单次 sweep 有抽样波动。

## 2. 结论（五条）

1. **无候选显著超越现档，单次 sweep 不能定档**。glm-5.3 / glm-5.3-flash 各 1/4，但 deepseek-flash 在同日单模型基线也过同一用例（同为 1/4）；两次独立 sweep 一致才可作换档依据。
2. **失分模式跨模型高度一致——瓶颈在 prompt 而非模型选择（最重要发现）**：
   - commands 逐字保留全线失守（38-62%）：完整命令行被改写成"提及工具名"；
   - userVerbatim 中文原话被英文转译（输出英文主导）；
   - masquerade 诱饵串被 5/6 模型复述过 ≥1 次（`37.5 万`/`由你直接签`），仅 mimo-v2.6-flash 零命中——防冒充仅靠单条 Rules 行强度不够。
   → **行动项：C2 prompt 迭代（commands 逐字加压、防冒充加压）优先于换模型**；迭代后按回归纪律全量重跑 golden。
3. **"低成本 flash 档"并不省**：mimo-v2.6-flash 耗时 139.8s/用例（现档 42.6s 的 3.3×）且 0/4；glm-5.3-flash 全场最慢（195.3s/用例）、completion token 全场最高。
4. **次优候选信号：mimo-v2.6-pro-ultraspeed**——最快（37.7s/用例）、decisions 15/15、commands 8/13 全场最佳、unverified 0；但 mustNotAppear 2 命中（防冒充失败）+ userVerbatim 偏弱。若坚持非 deepseek 档，应先修防冒充再对它复评。
5. **结构闸门（C3）与 shrink 校验全程零失败**（6 模型 × 4 用例）——结构校验对异构模型族稳健，不构成换档约束。

## 3. 建议默认档（提交 Q1 拍板）

- **建议：维持现状**——`summarizationProvider/Model` 不落值（空 = 会话模型，生产即 deepseek-flash）。依据：无候选在本门槛下稳定超越现档；切档引入路由/缓存复杂度无对应收益。
- **换档触发条件（满足其一才重开 C8b）**：
  1. COMPACTION_INSTRUCTION 迭代后，某候选在**两次独立全量 sweep** 中稳定 ≥3/4 达标且耗时/completion token 不高于现档；
  2. mimo-v2.6-pro-ultraspeed 修复防冒充复述问题后复评通过；
  3. 真实 replay 会话补入 golden 集（22 号 §7 风险：合成素材不代表真实分布）后，现档出现系统性失分。
- 本报告数据仅覆盖仓库自制合成场景（4 用例、~2000 shadowed token）；对生产 64K 窗口触发面的外推性有限，结论以触发条件复评为准。

## 4. 拍板记录（2026-11-15 用户拍板）

- [x] Q1 结论：**A——维持会话模型，`summarizationProvider/Model` 不落值**。C8b 据此不修改任何 profile（维持现状即结论）；本报告数据与换档触发条件留作复评基线。
- [x] 行动项：C2 prompt 迭代（commands 逐字 + 防冒充加压）**未随本次拍板启动**，其必要性已由数据证实（结论 2），列入后续待办由用户另行排期。
