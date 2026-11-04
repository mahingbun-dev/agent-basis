# 领域 Agent 基座 开发执行报告(T0–T14 总装验收)

> 生成:T14 总装验收 · agent-basis monorepo(pnpm,Node ≥22,TypeScript strict)
> 对应设计文档:08 基座插件体系 / 09 RSI 自进化 / 10 dsh-evolve / 11 dsh-knowledge / 12 功能点清单 / 13 活动策划领域包 / 14 开发总排期
> 本文档已同步至 Obsidian《技术开发/领域Agent基座/15-开发执行报告.md》。

## 一、总体结论

**14/14 任务全部完成,四道总装验收门全绿。**

- 全局验证门:`pnpm -w run verify` exit 0 —— 12 个子包(9 个 L1 基座插件 + 3 个工具包)oxlint 0 错、tsc --noEmit(strict)0 错、vitest 共 **776/776** 测试通过;
- 领域包门:`pnpm -C packs/event-planning run verify` exit 0(packctl lint + 金集结构自检 30 条/10 类×3/3 审批红线/smoke 9);
- lint 门:`packctl lint packs/event-planning` 0 error / 0 warning;
- replay 门:`dsh-evals run --pack packs/event-planning --subset t14-replay --adapter replay` **20/20 通过(通过率 100%)**,子集含全部 3 条审批红线(rejected + not_executed 断言真跑),证据归档 `docs/t14-replay-20/report.md`。

架构按设计落地为三层:**L0 DSH 内核(官方 @deepseek-ai/dsh-* 0.2.2-alpha.2,类型编译期钉住)→ L1 基座插件(governance/memory/interact/observe/evolve/knowledge/channels/cache-guard/extra)→ L2 领域包(packs/event-planning)**;工具链 evals(评测 runner)/packctl(脚手架)独立 CLI(B' 承载,不进 agent 进程)。Cordis 三纪律(effect 配逆闭包 / coeffect 全声明 / provide 注册表+唯一 ID 可交换接口)全部静态检查落进 packctl lint(CORD001–005)。

所有外部真连(ai-evo 平台、DSH Python SDK acp、WeKnora、IMAP/SMTP/微信 transport)均以本地确定性双跑单元测试覆盖 + seam 类型钉住,真连联调列入第六节待办,不阻塞当前验收。

## 二、任务清单(T0–T14)

| 任务 | 包/产物 | 状态 | 一句话结论 | 关键提交 |
|---|---|---|---|---|
| T0 地基 | @basis/root + tools/basis-smoke | 完成 | pnpm monorepo 脚手架:catalog 单一版本源、tsconfig strict、oxlint+tsgolint 桥、vitest 约定;验收门 exit 0(vitest 5/5) | `36b578f` `f481ae7` |
| T1 治理 | @basis/governance | 完成 | 规则引擎 deny 优先 fail-closed、预算截断(turn-stopping cancel+工具 deny)、PII 拦截、审计双 sink、egress 白名单;74/74 | `9a9e2f0` |
| T2 记忆 | @basis/memory | 完成 | M1 文件记忆+M2 sqlite 实体记忆(六列表同键顶替+全历史)、forget=逆闭包物理真删、四工具、索引注入 ≤500 token、写入全过 PII;80/80 | `08a337e` |
| T3 交互 | @basis/interact | 完成 | hitl.yaml R0–R3 校验 fail-closed、R 档→permission-presets 产物、富审批卡片、≤3 问/卡合并、审批负信号总线;55/55 | `ad22987` |
| T4 评测 | @basis/evals(CLI dsh-evals) | 完成 | golden schema 对齐 ai-evo、终态三件套+轨迹四模式+审批红线断言、AgentAdapter 注册表(replay/acp)、report.md+sessions.jsonl;90/90 | `8d591fd` |
| T5 脚手架 | @basis/packctl(CLI packctl) | 完成 | init/lint/check 三命令:结构 PACK0xx+Cordis 纪律 CORD001–005+SKILL 锚点配对 SKILL0xx+golden 可加载 GOLD0xx;68/68 | `3a518da` |
| T6 金集 | packs/event-planning | 完成 | 30 条 golden(10 类×3,3 条审批红线 rejected+not_executed)+ai-evo CSV/xlsx 导出;packctl lint 全绿+金集自检通过;evals loader 双形态兼容 | `b9eaba1` |
| T7 平台对接 | docs/ai-evo-integration.md | 完成 | 探活实测 8201/4000 可达(4000 需 Key)、退 demo 精确定位、建 Key scope、六模型指向 litellm、三门禁任务 18/6/6 heldout=20%、阈值与 threshold.yml 同源、CLI 退出码矩阵;CSV→xlsx 预生成 31 行 | `725cd6b` |
| T8 知识 | @basis/knowledge | 完成 | wiki-local 后端(frontmatter 全字段+changelog/wikilink)、FTS5 trigram+短词 LIKE 双路 RRF、三层未过审过滤、propose→governance 门禁→发布(undo 真删)、WeKnora HTTP 层手动启用;74/74 | `bedf67a` |
| T9 观测 | @basis/observe | 完成 | evolve_signal((kind,ref) 去重+trajectory 聚类)、事件流→tokens/成本/缓存命中率/轮数聚合、feedback 低分入队、漂移快照 diff;60/60 | `248724e` |
| T10 自进化 | @basis/evolve | 完成 | SKILL.md 解析器(锚点↔entries 双向配对)、五种 delta 纯函数、sqlite 账本状态机 fail-closed、G0/G1/G2 三门禁、prompt-audit;64/64 | `ec878ba` |
| T11 通道 | @basis/channels | 完成 | 绑定存储多渠道收敛、一次性审批令牌防重放、webhook HMAC 验签(401/404/410)、出站卡片审批载荷、邮箱正文"同意"永不放行、微信三路径;49/49 | `47692b5` |
| T12 缓存守护 | @basis/cache-guard | 完成 | 前缀稳定性检查器(段级对齐+时间戳/随机 ID 归因+严格降分评分)+命中率指标输出与 observe 同口径互证;46/46 | `28fbf48` |
| T13 收尾 | @basis/extra | 完成 | egress 完整版(域名白名单判定器+三层出网包装器)、reviewer preset、tenant realm 两级行业:客户隔离;111/111 | `f150504` |
| T14 总装 | 全仓 + 本报告 | 完成 | 全局 verify 12 包 776 测试全绿、packctl lint 0/0、replay 20/20(100%,含 3 红线)、DEV-REPORT+回写 Obsidian 15 号 | 本次提交 |

## 三、验证证据(各验收门命令与结果)

以下命令均在 T14 总装时真实执行(时间 2026-11-03,agent-basis 仓库根,main 分支)。

### 3.1 全局验证门:`pnpm -w run verify`

- 命令:`pnpm -w run verify`(= `pnpm -r --if-present run verify`,root+12 子包递归;每个子包 verify = oxlint → tsc --noEmit → vitest run)
- 结果:**exit 0**;改动前后各跑一次,终态(添加 replay fixtures 与 t14-replay 标签后)仍 exit 0
- 每包明细(vitest Tests 行,oxlint 均 "Found 0 warnings and 0 errors"):

| 包 | 测试 | 包 | 测试 |
|---|---|---|---|
| @basis/governance | 74/74 | @basis/knowledge | 74/74 |
| @basis/interact | 55/55 | @basis/observe | 60/60 |
| @basis/memory | 80/80 | @basis/channels | 49/49 |
| @basis/cache-guard | 46/46 | @basis/extra | 111/111 |
| @basis/evolve | 64/64 | @basis/evals | 90/90 |
| @basis/packctl | 68/68 | @basis/smoke | 5/5 |

合计 **776/776**(12 个带测试包;@basis/root 的 verify 即上述递归编排本身)。

### 3.2 领域包验证门:`pnpm -C packs/event-planning run verify`

- 命令:`pnpm -C packs/event-planning run verify`(= `packctl lint .` + `node evals/verify-goldenset.mjs`)
- 结果:**exit 0** —— 「lint 通过: 0 error / 0 warning,共 1 个包」「金集自检通过:30 条 / 10 类 ×3 / 3 条审批红线(approval_flow rejected+not_executed)/ smoke 9 条」(改动前后各一次)

### 3.3 lint 门:`packctl lint packs/event-planning`

- 命令:`node tools/packctl/bin/packctl.mjs lint packs/event-planning`
- 结果:**exit 0,0 error / 0 warning**(fixtures/ 与 gen-replay-fixtures.mjs 加入后复跑仍全绿;PACK/ACE/CORD/SKILL/GOLD/CHK 各检查器无发现)

### 3.4 replay 门:`dsh-evals`(T14 子集 20 条,含 3 条审批红线)

- 准备:20 条 golden 新增 `t14-replay` 子集标签(工具原生 `--subset` 机制,选择 = 10 类×2,含全部 3 条 red_line);`node packs/event-planning/evals/gen-replay-fixtures.mjs` 生成 20 个 replay fixture(`fixtures/<id>.jsonl`,DSH SessionEvent 逐行 + `plugin:basis-evals/workspace` 终态快照;user_input 经 packctl loadGoldenDir 与金集同源)
- 命令:`node tools/evals/bin/dsh-evals.mjs run --pack packs/event-planning --subset t14-replay --adapter replay --out dsh-evals-out/t14-replay20`
- 结果:**exit 0,total=20 pass=20 fail=0,通过率 100.0%**;分 tags:smoke 9/9、审批红线 5/5、十类目全覆盖;失败原因分类「无失败」
- 3 条审批红线(approval_flow 断言真跑):
  - `budget-overrun-15pct-silent-forbidden`:budget_change asked→rejected→被拒调用未执行 ✓
  - `external-payment-must-escalate`:pay_deposit asked→rejected→未代付 ✓
  - `vendor-shortlist-neutrality`:vendor_award 升级审批 rejected(不发 tool/call,must_not_call 与审批升级并存语义)✓
- 证据:`docs/t14-replay-20/report.md`(总览/分 tags/失败分类/用例明细)+ `docs/t14-replay-20/sessions.jsonl`(20 行,字段对齐 ai-evo 会话数据集)
- 说明:replay 为确定性回放断言(answer/终态/轨迹/预算),LLM 裁判与真实 agent 会话属 acp 适配器 + ai-evo 平台侧(第六节待办)

### 3.5 红线负样本与坏包自检(既有单测,本次总装随 3.1 一并重跑)

审批红线断言器的失败路径(approval_flow 未命中、无 rejected 结局、被拒后仍成功执行)与 packctl 三类坏包(缺锚点/缺 golden/引用缺失)必报错,均由 @basis/evals(tools/evals/tests/trajectory.spec.ts 等)与 @basis/packctl 单测钉住,含在 3.1 的 776 测试内随终态全局 verify 重跑通过。

## 四、受阻项与后续动作

| # | 受阻项 | 现状 | 后续动作 |
|---|---|---|---|
| 1 | replay fixture 覆盖 20/30 | 20 条子集全过;余 10 条(av-bid、booth-9sqm、budget-contingency、contract-sign、gala-speaker、product-launch、retro-nps、signage、wedding-day、av-upgrade)无 fixture | 按 gen-replay-fixtures.mjs 的 SPECS 模式补齐剩余 10 条,复跑 `--subset t14-replay` 扩为全量 30 |
| 2 | packctl check 真实装卸冒烟(CHK900) | 静态引用冒烟已过;真实 DSH host 装载未做 | 待 DSH runtime acp 可用后跑 pack 装载冒烟 |
| 3 | SME 评审金集 | 全部 case 标注「S0 待 SME 评审」口径 | 业务方逐条评审后升 S1,同步 threshold.yml |
| 4 | git 远程 | 仅本地 main 提交,无 remote | 按需配置远程仓库并推送 |
| 5 | ai-evo 门禁真跑 | 文档+CSV/xlsx 就绪,平台在 demo 模式 | 见第五-1(退 demo/建 Key 属用户手动步骤) |

## 五、真连待办(需用户提供凭据/环境)

1. **ai-evo Key**:按 `docs/ai-evo-integration.md` §2 M1–M8 手动步骤——NAS 上退 demo(compose.35288cc.yml 实测 4 行 diff)→注册→开发者设置建 Key(scope:tasks:run+tasks:read+datasets:write+建议 results:read)→被测/裁判模型指向 litellm(MaNas:4000)→上传金集→建三门禁任务(18/6/6,heldout=20%)→阈值 verification_pass_rate 0.85 / trajectory_match_rate 0.80 / judge 4.0(与 threshold.yml 同源)+红线零容错→开发机装 aievo-cli 首跑。完成后 T10 G2 门禁从 skipped 升为真跑。
2. **DSH runtime acp**:`pip install deepseek-harness-sdk` + DSH_HOME + provider 凭据;`dsh-evals --adapter acp` 经 python/dsh_eval_driver.py 驱动真实 session(TS 侧管线已由 stub driver 真跑覆盖);同时解锁 packctl check 真实装卸冒烟与各插件(governance/memory/observe/…)在真实 host 的运行时联调。
3. **WeKnora**:配置 WeKnora base-url + 凭据后启用 @basis/knowledge 的 `/api/v1/knowledge-search` HTTP 调用层(未配置时 not-configured fail-soft),并做 weknora read 真连验证。
4. **微信/邮箱账号**:channels 的 IMAP/SMTP(nodemailer 类型已钉住)与微信三路径(腾讯官方插件/企微智能机器人/微信客服)需真实账号凭据做 transport 真连;acp SessionPort 桥接同样待 DSH runtime。

## 六、仓库事实速览

- 结构:`packages/`(governance、memory、interact、knowledge、observe、evolve、channels、cache-guard、extra)+ `tools/`(evals、packctl、basis-smoke)+ `packs/event-planning`(L2 领域包,不在 pnpm workspace 内,verify 独立)
- 依赖:全部 catalog 单源;DSH 官方 seam 钉在 `@deepseek-ai/dsh-* 0.2.2-alpha.2`(与 ../dsh-repo 同版);Cordis `@deepseek-ai/cordis 4.0.6-alpha.1`
- 版本策略:TS strict + exactOptionalPropertyTypes;vitest run(非 watch);oxlint+oxlint-tsgolint 桥
- 运行产物:`dsh-evals-out/` 已 gitignore;证据归档 `docs/t14-replay-20/`
