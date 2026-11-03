# PROGRESS —— 14 个工作流任务状态表

> 源自设计文档 14 号《开发总排期与工作流执行》:一条 workflow、五个相位、T0 地基 + T1–T14 共 14 个任务。
> 列说明:**状态** ∈ 待开发 / 开发中 / 完成 / 受阻;**提交** 填完成该任务的 commit 主题(以任务号开头,`git log --oneline` 可查);**备注** 一句话结论或阻塞原因。
> 每个任务的验收门:`pnpm --filter <包名> run verify`(= oxlint + tsc --noEmit + vitest run)。

| 任务 | 状态 | 提交 | 备注 |
|---|---|---|---|
| T0 地基 @basis/root | 完成 | T0: agent-basis monorepo 脚手架 | 验收门通过:pnpm --filter @basis/root run verify exit 0(oxlint+tsgolint 桥、tsc strict、vitest 5 测试全绿;tools/basis-smoke 为约定载体包) |
| T1 治理 @basis/governance | 完成 | T1: @basis/governance 五模块+DSH seam 钉住 | 验收门通过:pnpm --filter @basis/governance run verify exit 0(oxlint 0 错、tsc strict、vitest 74/74);规则引擎 deny 优先 fail-closed、预算截断(turn-stopping cancel+工具 deny)、PII 拦截、审计双 sink、egress 白名单;seam 用已发布 dsh-* 0.2.2-alpha.2 类型编译期钉住,真实 DSH 运行时联调后置 |
| T2 记忆 @basis/memory | 待开发 | | M1 文件记忆 + M2 sqlite 实体记录,effect 配逆真删 |
| T3 交互 @basis/interact | 完成 | T3: @basis/interact 五模块(hitl 分档/预设产物/富审批卡片/提问合并/负信号) | 验收门通过:pnpm --filter @basis/interact run verify exit 0(oxlint 0 错、tsc strict、vitest 55/55);hitl.yaml 校验 fail-closed(default_grade 只许 R2/R3、R3 专属键严检、最高档优先裁决)、R0-R3→permission-presets 产物、卡片五字段+R3 附加、≤3 问/卡合并+合并率统计、被拒/被修改负信号总线;seam 直用已发布 dsh-{user-questions,user-approval,permission-presets,sandbox} 0.2.2-alpha.2 官方类型,真实 DSH 运行时联调后置 |
| T4 评测 @basis/evals | 待开发 | | golden YAML、AgentAdapter 双适配、终态+轨迹断言、CLI |
| T5 脚手架 @basis/packctl | 完成 | T5: @basis/packctl init/lint/check 三命令 | 验收门通过:pnpm --filter @basis/packctl run verify exit 0(oxlint 0 错、tsc strict、vitest 63/63);init 生成 06 号模板骨架且原样过自身 lint/check;lint=结构(PACK0xx)+Cordis 纪律(CORD001 旁路全局/CORD002-005 注册表+唯一 ID 可交换接口)+SKILL.md 锚点↔metadata.evo.entries 双向配对(SKILL0xx)+golden 完整可加载(GOLD0xx,加载器供 T4 复用);check=CHK001-004 静态引用冒烟;三类坏包(缺锚点/缺 golden/引用缺失)必报错有单测钉住;真实装卸冒烟留 blockers(CHK900 常态告警) |
| T6 金集 packs/event-planning | 待开发 | | @event/pack 骨架 + 30 条 golden(含 3 条审批红线) |
| T7 平台对接 docs/ | 待开发 | | ai-evo 探活;无 Key 则产手动对接文档,不阻塞 |
| T8 知识 @basis/knowledge | 待开发 | | wiki-local FTS5+LIKE 回退、provenance、四工具、dual RRF 骨架 |
| T9 观测 @basis/observe | 完成 | T9: @basis/observe 观测插件四模块+DSH seam 钉住 | 验收门通过:pnpm --filter @basis/observe run verify exit 0(oxlint 0 错、tsc strict、vitest 60/60);evolve_signal sqlite 存取((kind,ref) 去重幂等+trajectory_hash 聚类+json_each tag 查询)、事件流→指标聚合(request/header 类事件锚定路由,tokens 互斥四桶/成本估算/缓存命中率/轮数)、feedback 低分入队(版本 churn 不重复)、漂移快照 diff(默认+自定义阈值/方向语义/除零护栏);seam 用已发布 dsh-{session,llm,message-feedback} 0.2.2-alpha.2 类型编译期钉住,真实 DSH 运行时联调后置 |
| T10 自进化 @basis/evolve | 待开发 | | 条目解析+五种 delta、ledger、G0/G1/G2 流水线、prompt-audit |
| T11 通道 @basis/channels | 完成 | T11: @basis/channels 通道插件六模块 | 验收门通过:pnpm --filter @basis/channels run verify exit 0(oxlint 0 错、tsc strict、vitest 49/49);绑定存储多渠道收敛+移绑续接(node:sqlite,storage-domain KvTable 视图)、一次性审批令牌单次防重放+过期+revokeAll、webhook 网关 HMAC 验签失败 401/未知绑定 404/令牌重放 410、出站卡片统一携带审批动作载荷(飞书 value/钉钉 URL/邮件链接/微信文本)、邮箱正文"同意"永不放行、微信三路径接口+实现文档;IMAP/SMTP/微信 transport 真连与 acp SessionPort 桥接需运行时联调 |
| T12 缓存守护 @basis/cache-guard | 待开发 | | 前缀稳定性检查(动态前缀检测)、命中率指标 |
| T13 收尾 @basis/extra | 待开发 | | egress 完整版、reviewer preset、tenant realm 规范 |
| T14 总装(全仓) | 待开发 | | 根 verify + packctl lint + replay 20 条 + DEV-REPORT + 回写 15 号 |
