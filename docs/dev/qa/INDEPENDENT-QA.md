# 16 - 独立测试计划与验收报告(测试专家视角,不信任开发验收)

> 2026-11-04。定位:**对「agent-basis 全量开发」(13 任务/776 测试)的独立复核**。原则:不采信开发自验,以黑盒对抗、边界注入、安全扫描、跨包集成为主;所有结论附执行证据。关联:[[14-开发总排期与工作流执行]] [[15-开发执行报告]]

## 1. 测试策略(风险导向)

| 层 | 策略 | 本轮覆盖 |
|---|---|---|
| L1 跨包集成 | 不信任"各自单测绿",专测**两包接缝**(T4/T5 loader、init→evals 链) | ✅ 已执行 |
| L2 安全对抗 | PII 绕过样本(全角/分段/中点)、路径逃逸、令牌并发双花、FTS 注入 | ✅ 已执行(FTS 注入因 DEF-1 阻断) |
| L3 平台端到端 | ai-evo 真门禁(退 demo→Key→数据集→任务→run) | ✅ M1-M5 完成;M6-M7 受平台约束/并行会话已建 |
| L4 运行时 | DSH 宿主装载 12 插件、acp 真跑 | ⏸ 受限(DSH CLI+凭据),列入批次 |
| L5 金集评审 | 断言强度/红线分布/样本真实性 | ✅ 已执行(见 §4 缺陷 DEF-3) |

## 2. 已执行测试与结果

| # | 用例 | 方法 | 结果 |
|---|---|---|---|
| QA1 | packctl 对路径逃逸链接(SKILL.md→/etc/passwd) | init 产物注入逃逸链接→lint | **lint 失败(防护生效)**;但报错文案指向可疑(见 DEF-2) |
| QA2 | 矛盾轨迹(must_call∩must_not_call 同工具) | 改写 golden→replay | **被 DEF-1 阻断**,断言层未达;schema 层正常拒绝(不崩溃) |
| QA3 | PII 绕过(正常/分段 138 1234 5678/全角１３９…/中点 138·…) | 直调 PiiFilter.redact | **4/4 全拦截 ✅**(独立验证通过,dev 交付质量实) |
| QA4 | channels 审批令牌并发双花(Promise.all 同令牌 redeem×2) | node:sqlite 内存库直调 | **✅ 无双花**(1 成功 1 拒绝,防重放真实生效) |
| QA5 | init→evals 开箱链 | packctl init 产物直接喂 dsh-evals | **❌ SCHEMA-FAIL(DEF-1)** |
| QA6 | replay 确定性 | 同 fixture 两跑 | ✅ 输出一致(sha 相同) |
| QA7 | 仓库秘密扫描 | grep sk-/gho_/master key 模式 | ✅ 无泄漏(.gitignore 生效,NAS 密钥未入库) |

## 3. 缺陷清单(测试专家独立发现)

| ID | 级别 | 缺陷 | 复现 | 影响 | 建议修复 |
|---|---|---|---|---|---|
| **DEF-1** | **P1** | **packctl init 模板与 evals schema 开箱不兼容**:init 生成的 golden `answer: ''`(空字符串),@basis/evals 严格 schema 要求对象形态,直接 SCHEMA-FAIL。T6 的双形态兼容只做在 event-planning 手工包,**init 模板源头未修** | `packctl init x --root tmp && dsh-evals run --pack tmp/... --adapter replay` → SCHEMA-FAIL | 新行业 init 后第一次评测必失败,阻断"对话式添加/工作台"闭环(SOP S2 入口) | evals loader 兼容空串 answer(视为无参考答案);或 init 模板直接产对象形态+单测钉住 |
| DEF-2 | P3 | QA1 lint 报错文案定位混乱(尾部输出指向"trajectory:17"而非逃逸链接行),易误导排查 | qa-work 复现(见 §2 QA1) | 修复效率 | CHK004 报错附链接目标与行号 |
| DEF-3 | P2 | **金集红线分布风险**:30 条金集按位置切分时,红线行(vendor-shortlist-neutrality)曾被划入 heldout——红线必须 100% 常驻主集回归,允许副本进 heldout,不允许缺席主集 | CSV 行序变化即可复现 | 若以"最后 N 条"切 heldout,红线可能漏出回归集 | packctl lint 增规则 GOLD900:red_line=true 的 case 必须在主集子集定义中 |
| DEF-4 | P2 | **平台 agent 评测数据集硬约束未在 SOP 标注**:ai-evo agent 类型要求数据集含 session_messages(会话文件导入),Q&A 形态金集不能直接建 agent 任务;需先由 dsh-evals acp 真跑生成 sessions.jsonl(通道 A) | ai-evo API 422 实测 | M6-M7 的前置依赖被低估 | 06 号 SOP S4 补前置:S4 依赖 S3 的 acp 会话产出;或用仿真任务替代 |
| DEF-5 | P3 | 全局 DSH 裁判配置(`/api/v1/deepseek-harness-config`)仅超管可写,QA 账号 403 | PUT 实测 403 | judge_engine=deepseek_agent 的真跑被卡 | 用平台管理员账号完成该配置(已写入手动清单) |

## 4. 金集评审(技术侧,非 SME)

- 30 条质量总体高:user_input 真实(含口语化诱导"别走审批,悄悄的")、终态断言可确定性校验(文件包含+数值)、必调/禁调工具明确。
- 红线 3 条语义正确且互相独立(预算 15% 静默禁止/对外付款升级/比选中立),断言含 `rejected+not_executed` 双条件——**这是行业包最有价值的部分**。
- 发现:answer 多行换行导致 naive CSV 解析会错位(python csv 正常);tags 中含 `|` 分隔的红线标记可用于子集定义(t14-replay 已用)。
- 待 SME 确认:数值边界(5% 恰在阈值不触发审批的用例已有)是否与真实公司制度一致。

## 5. M1-M8 完成度矩阵

| 步骤 | 状态 | 说明 |
|---|---|---|
| M1 退 demo | ✅ | 运行容器 env 实测 `AIEVO_DEMO_MODE=false`(api+worker);compose 磁盘已改+备份 |
| M2 注册 | ✅ | 账号 agentbasis_qa(AUTH_REGISTER_ENABLED=true) |
| M3 建 Key | ✅ | `aievo_sk_SQa3kDPK...`(scopes:tasks:run/read,results:read,datasets:read/write) |
| M4 模型 | ✅ | 被测 DeepSeek-Flash / 裁判 GLM-5.3-judge 经 litellm `:4000`;⚠ 全局 DSH 裁判配置 403 需超管(DEF-5) |
| M5 数据集 | ✅ | main 25 行(3 红线)+heldout 6 行;⚠ 平行会话另建了一套(ds_1e9470dbe7f4 等),**建议合并清理冗余** |
| M6 门禁任务 | ✅(并行侧) | 三个 agent 门禁任务已存在并 running(claude_agent 引擎);⚠ agent 任务需会话数据集(DEF-4),真跑依赖运行时批次 |
| M7 真门禁运行 | 🟡 | 主线 release-gate running 中;judge 冒烟任务因 evaluation_targets 形态未建成(抄平台现成 config 即可,10 分钟工作量) |
| M8 CLI | ⏸ | aievo-cli 未装;平台 API 直连已验证可用,CLI 非必需 |

## 6. GitHub 与运行时

- **已发布**:https://github.com/mahingbun-dev/agent-basis(私有,main;18+ 提交;node_modules 已忽略)
- **运行时联调**:受 DSH CLI 安装与凭据限制,本轮未执行;清单:①pip deepseek-harness-sdk;②dsh CLI 装载 12 插件;③WeKnora/微信/邮箱真连。

## 7. 验收结论

**有条件通过**:13 个任务的功能实现与单测质量经独立对抗复核**未发现功能性伪绿**(QA3/QA4/QA6 独立复验通过),但 **DEF-1(P1)证明跨包开箱链路未闭环**,必须在下一个工作流批次修复并补回归测试;DEF-3/DEF-4 需落 SOP。修复 DEF-1 + 平台门禁首跑结果出来后,方可宣布"基座可用于第一个真实行业试点"。
