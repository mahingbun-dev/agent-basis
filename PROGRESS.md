# PROGRESS —— 14 个工作流任务状态表

> 源自设计文档 14 号《开发总排期与工作流执行》:一条 workflow、五个相位、T0 地基 + T1–T14 共 14 个任务。
> 列说明:**状态** ∈ 待开发 / 开发中 / 完成 / 受阻;**提交** 填完成该任务的 commit 主题(以任务号开头,`git log --oneline` 可查);**备注** 一句话结论或阻塞原因。
> 每个任务的验收门:`pnpm --filter <包名> run verify`(= oxlint + tsc --noEmit + vitest run)。

| 任务 | 状态 | 提交 | 备注 |
|---|---|---|---|
| T0 地基 @basis/root | 待开发 | | monorepo 脚手架(pnpm/tsconfig strict/vitest/oxlint/verify)+ git init |
| T1 治理 @basis/governance | 待开发 | | 规则引擎 allow/ask/deny、预算守卫、PII、审计投影、egress-lite |
| T2 记忆 @basis/memory | 待开发 | | M1 文件记忆 + M2 sqlite 实体记录,effect 配逆真删 |
| T3 交互 @basis/interact | 待开发 | | hitl.yaml 校验、R0-R3 映射、富审批卡片、提问合并 |
| T4 评测 @basis/evals | 待开发 | | golden YAML、AgentAdapter 双适配、终态+轨迹断言、CLI |
| T5 脚手架 @basis/packctl | 待开发 | | pack init / lint / check |
| T6 金集 packs/event-planning | 待开发 | | @event/pack 骨架 + 30 条 golden(含 3 条审批红线) |
| T7 平台对接 docs/ | 待开发 | | ai-evo 探活;无 Key 则产手动对接文档,不阻塞 |
| T8 知识 @basis/knowledge | 待开发 | | wiki-local FTS5+LIKE 回退、provenance、四工具、dual RRF 骨架 |
| T9 观测 @basis/observe | 待开发 | | evolve_signal 存储、成本/缓存命中率聚合、漂移快照 |
| T10 自进化 @basis/evolve | 待开发 | | 条目解析+五种 delta、ledger、G0/G1/G2 流水线、prompt-audit |
| T11 通道 @basis/channels | 待开发 | | 渠道绑定、webhook 网关、一次性审批令牌、适配器接口 |
| T12 缓存守护 @basis/cache-guard | 待开发 | | 前缀稳定性检查(动态前缀检测)、命中率指标 |
| T13 收尾 @basis/extra | 待开发 | | egress 完整版、reviewer preset、tenant realm 规范 |
| T14 总装(全仓) | 待开发 | | 根 verify + packctl lint + replay 20 条 + DEV-REPORT + 回写 15 号 |
