# Agent 基座(Harness)调研报告:通用 Harness + 行业 SOP 快速定制

> 调研时间:2026-11-03。方法:五路并行调研,全部基于一手工程资料(Anthropic / OpenAI / Cognition / Manus / Harvey / Sierra 工程博客与产品文档、框架官方文档、12-factor agents、MAST 论文、Latent Space、LangChain 行业报告等),每条结论附来源。

---

## 0. TL;DR:核心结论

1. **你的方向是行业正在收敛的方向,但公式需要修正。** 从业者共识形态是:**薄基座(buy/adapt)+ 厚领域上下文与 SOP(own)+ 厚权限治理与领域评测集(own)= 领域 agent**。基座必须"薄"——只拥有与业务无关的机制;行业团队拥有 prompt、context 组装、SOP、agent 拆分粒度和评测集。
2. **行业 SOP 的标准化注入机制已经出现:Agent Skills。** Anthropic 2025-10 发布,2025-12 转为开放标准(agentskills.io)。SKILL.md + scripts + references 的三级渐进式披露,正是"把 SOP 快速补上"的业界答案;MCP 则解决工具接入标准化。二者是领域定制层的两大支柱。
3. **最大的误区是低估评测。** LangChain 2026 调研:89% 团队已建可观测,仅 52% 建了评测——评测是全行业最大短板;而 Shreya Shankar 的判断是行业任务不在模型 post-training 覆盖内,**领域评测集是唯一护城河**。Anthropic 实测:20 条真实任务的小评测集就能把成功率从 30% 提到 80%。
4. **harness 的价值已获量化证实:** Latent Space Harness-Bench 显示同一模型在不同 harness 下分差达 23.8 分;Databricks 真实代码库基准显示同模型不同 harness 每任务成本差 2 倍以上。但投资要选对部位:**权限、审批、身份、审计、评测、触发通道**这些"组织向"部件不会过时;**压缩、记忆、原生工具**这些"模型向"部件正被模型层吸收(Anthropic 已砍掉 Claude Code 80% 的 system prompt)。
5. **选型默认路径是"基于 SDK 改"而非完全自研:** 模型中立 → LangGraph / Pydantic AI(+Temporal/DBOS 做 durable execution);接受 Claude 绑定 → Claude Agent SDK(开箱最强的 harness 内核)。12-factor agents 的警告:套用重框架的团队通常撞 70-80% 质量天花板。

---

## 1. 概念澄清:harness / 基座 / 框架 / workflow

Latent Space 对 harness 的定义最干净:**"模型权重之外,让 agent 运转的一切"**([The Evolution of the Agent Harness](https://latent.space/p/attention-interface))。对应到你说的"基座":

| 术语 | 含义 | 与"基座"的关系 |
|---|---|---|
| **Harness(基座)** | 循环引擎、上下文管理、工具执行、权限/沙箱、记忆、子 agent、hooks、可观测、评测基建 | 就是你要做的东西 |
| **Framework(框架)** | LangGraph/Agents SDK 等,提供编排抽象 | 基座的候选内核,不是基座本身 |
| **Workflow(工作流)** | 代码预定义的 LLM 编排(chaining/routing/orchestrator-workers 等) | 基座支持的一种运行模式;Anthropic 主张能用 workflow 就不用 agent |
| **Agent** | 模型在循环中自主决定流程与工具使用 | 基座上运行的最高自主度形态 |

Anthropic 对 agent 的定义:"在循环中根据环境反馈使用工具的 LLM"([Building effective agents](https://www.anthropic.com/engineering/building-effective-agents))。Claude Agent SDK 把循环概括为 **gather context → take action → verify work → repeat**([来源](https://claude.com/blog/building-agents-with-the-claude-agent-sdk))。

---

## 2. 基座层:harness 的标准组件清单(行业共识)

这是五路调研交叉验证后的组件表,每个组件给出主流做法与出处。

### 2.1 循环引擎
- **自写 while 循环**:Anthropic 明确建议直接用 LLM API 起步,框架抽象"遮蔽底层提示与响应,难以调试";OpenAI 同样反对声明式图,主张 code-first。
- **SDK Runner**:OpenAI Agents SDK 的 `Runner.run()` 循环执行至退出条件(final output / 不再调用工具 / 报错 / 最大轮数)。
- 设计要点:退出条件、最大轮数、每轮的 gather→act→verify 结构化。
- 来源:[Building effective agents](https://www.anthropic.com/engineering/building-effective-agents) | [OpenAI 实用指南](https://cdn.openai.com/business-guides-and-resources/a-practical-guide-to-building-agents.pdf)

### 2.2 上下文管理
- **全量压缩(compaction)**:接近窗口上限时用模型总结历史;Claude Code 要求固定 9 章节摘要并保留全部用户消息防漂移(机制考据见[第三方源码分析](https://oldeucryptobiot.com/blog/context-compaction-deep-dive))。
- **微压缩(context editing)**:不调模型,直接清除陈旧工具结果;Anthropic 官方 API 使 agentic search 评测 +29%,加 memory tool 达 +39%,100 轮任务省 84% token([Anthropic context management](https://claude.com/blog/context-management))。
- **KV-cache 友好设计**:Manus 把 cache 命中率列为"生产级 agent 最关键单一指标"——prompt 前缀稳定(不能有动态时间戳)、上下文 append-only、显式缓存断点([Manus](https://manus.im/blog/Context-Engineering-for-AI-Agents-Lessons-from-Building-Manus))。
- 共识原则:上下文是稀缺资源,LLM 有"attention budget",目标是"最小高信号 token 集"([Anthropic context engineering](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents));Cognition:"context engineering 是构建 agent 的工程师的第一工作"([Don't Build Multi-Agents](https://cognition.com/blog/dont-build-multi-agents))。

### 2.3 工具层(ACI,Agent-Computer Interface)
- SWE-agent 论文确立:**LM 是一类新的最终用户,需要自己的 IDE**。消融实验:去掉 linting 编辑接口 18.0%→15.0%,去掉编辑接口降到 10.3%;搜索结果超 50 条时拒答并要求改写查询,反而优于逐条翻看(18.0% vs 12.0%)([SWE-agent 论文](https://arxiv.org/abs/2405.15793))。
- Anthropic 工具写作准则([Writing effective tools](https://www.anthropic.com/engineering/writing-tools-for-agents)):少而精;合并多步操作(`search_logs` 而非 `read_logs`);命名空间前缀分组;返回语义字段而非 UUID;默认分页/截断(Claude Code 默认 25K token 上限);**错误信息写成可执行的改进建议**。团队自述"花在优化工具上的时间多于整个 prompt"。
- hosted 工具路线:OpenAI Responses API 把 web_search / file_search / computer use / code_interpreter / MCP 做成服务端托管工具([文档](https://platform.openai.com/docs/guides/tools))。

### 2.4 权限与审批(HITL)
- Claude Code 分层模型:非确定性指令(prompt/skills)与确定性管控(hooks、deny 规则)分离;`deny` 规则连 bypassPermissions 也拦不住;hooks 的 PreToolUse 可 allow/deny/ask 或改写参数([Best practices](https://code.claude.com/docs/en/best-practices) | [Hooks](https://code.claude.com/docs/en/hooks))。注意:Bash 规则**不是安全边界**(`/bin/rm` 可绕过 `Bash(rm *)`)。
- OpenAI 指南:乐观执行 + 并行护栏;人工介入两触发器——超过失败阈值、高风险不可逆动作(指南 p.31)。
- 12-factor 第 7 条:**把人审批建模为一种工具调用**。
- 审批 ≠ exactly-once:副作用工具必须幂等键([OpenAI Agents SDK HITL](https://openai.github.io/openai-agents-python/human_in_the_loop/))。

### 2.5 沙箱
- Claude Code:OS 级边界(macOS Seatbelt / Linux bubblewrap+socat),默认可写仅工作目录与临时目录,网络全走本机代理按域名白名单过滤;对 `.claude` 设置等设"受保护路径"防自我提权([Sandboxing](https://code.claude.com/docs/en/sandboxing))。
- 服务端沙箱:E2B(Firecracker microVM)、Daytona(持久容器)、Modal(gVisor)。关键洞察:**受限出口(gVisor + 锁 egress)比无网络限制的 microVM 更可防御**([Fly.io 对比](https://fly.io/learn/sprites-vs-e2b-vs-modal-vs-daytona))。

### 2.6 记忆
- **文件系统即记忆**(已被 Manus 与 Anthropic 双重验证):memory tool 对记忆目录做 CRUD;Manus:"treat the file system as the ultimate context",压缩必须可逆(留 URL 丢正文);保留失败记录在上下文中("Erasing failure removes evidence")。
- 结构化笔记:agent 定期写 NOTES.md/todo.md 并持续复诵目标,对抗 lost-in-the-middle。
- 产品化路线:Letta(MemGPT)的 Memory Block 可被 agent 工具自编辑;mem0 抽取+向量;Zep 时序知识图谱。([Letta docs](https://docs.letta.com/guides/agents/memory))

### 2.7 子 agent
- Claude Code:独立上下文 + 独立 system prompt + 工具白名单(可强制只读审查者),并发上限 20、嵌套默认 3 层;"subagent 在自己的上下文里干活,只回传摘要"([Subagents](https://code.claude.com/docs/en/sub-agents))。
- Anthropic 研究系统:orchestrator-worker(lead + 3-5 并行子 agent)比单 agent 高 90.2%,代价是 token 为聊天 **15 倍**;产物落文件系统、回传轻量引用;prompt 固化努力缩放规则(简单事实=1 个 agent 3-10 次调用,复杂=10+ 子 agent)([来源](https://www.anthropic.com/engineering/built-multi-agent-research-system))。
- 本质共识:子 agent 的价值是**上下文压缩与隔离**,不是并行本身。

### 2.8 Hooks / 扩展点
- Claude Code 约 30 个生命周期事件(SessionStart、PreToolUse、PostToolUse、Stop、PreCompact…),五种 handler(shell/HTTP/MCP/prompt/subagent);退出码 2 语义为"阻止动作"。
- 判据:"如果不断给 CLAUDE.md 里一行加强调它还是被忽略,说明这行该进 hook"——**强制性规则交给确定性机制**。

### 2.9 可观测性
- OpenTelemetry GenAI semantic conventions(2026-05 仍 Development 状态):agent span 树 = 顶层 agent/workflow span → LLM 推理 span → execute_tool span → retrieval/memory 子 span;敏感内容默认不采集([spec](https://github.com/open-telemetry/semantic-conventions-genai/blob/main/docs/gen-ai/gen-ai-spans.md))。
- Anthropic 经验:非确定性使传统调试失效,需全量生产 tracing(只记决策模式不记内容);长任务必须支持 checkpoint + 恢复;部署用 rainbow deployment(新旧版本并存渐进切流)。

### 2.10 评测基建(注意:评测基建在基座,领域评测集在定制层)
- 评测 runner / trace 回放 / judge 管理 / held-out 集管理属于基座;golden tasks 与 rubric 属于行业。
- 主流方法:LLM-as-judge 单次调用打 0-1 分(比多 judge 一致)+ 人工评估补充;Databricks 反对 LLM 评委("rewards sounding right over being right"),主张直接用保留测试判分([Databricks 基准](https://www.databricks.com/blog/benchmarking-coding-agents-databricks-multi-million-line-codebase))。
- 改状态的多轮 agent:**评终态而非逐步路径**;工具评测跑真实多步任务并把 transcript 喂给模型自动改工具,held-out 表现超专家手写。

### 2.11 Durable execution(长任务可靠性)
- 2026 年工程共识:**checkpoint ≠ durable execution**。Diagrid 对 Microsoft Agent Framework / LangGraph / Google ADK 的批评:checkpoint"只是存储操作",无自动故障检测、无分布式锁、恢复需手动([Still Not Durable](https://www.diagrid.io/blog/still-not-durable-how-microsoft-agent-framework-and-strands-agents-repeat-the-same-mistake) | [Checkpoints are not durable execution](https://www.diagrid.io/blog/checkpoints-are-not-durable-execution-why-langgraph-crewai-google-adk-and-others-fall-short-for-production-agent-workflows))。
- 生产级方案:Temporal(确定性重放,官方集成 OpenAI SDK / Pydantic AI)、Restate(journaling)、DBOS(Postgres 内嵌)。
- 判断:分钟级任务 checkpoint 足够;小时级/涉资金/长审批等待用 durable 引擎。

### 2.12 触发通道
- 12-factor 第 11 条:随处触发、到用户所在处(API/CLI/Web/Slack/邮件/webhook/cron)。这也是"组织向"部件,模型层不会吸收。

---

## 3. 定制层:"SOP 快速补上"的机制(你的问题的核心)

### 3.1 六层注入模型

业界共识(Sierra、Harvey、Anthropic、Glean 同构):领域内容**不一股脑塞 prompt**,按"变更频率 × 形态 × 关键性"分层注入:

| 层 | 注入形式 | 适用条件 | 反模式 |
|---|---|---|---|
| **System prompt** | 角色、语气、全局硬约束 | 低频变更、每任务都需要 | 把百科知识塞进去撑爆上下文 |
| **Skill** | SKILL.md + scripts/references/assets | 步骤化 SOP;确定性步骤写成脚本 | 单文件超 500 行不拆;本该用代码保证的步骤靠模型"读懂" |
| **Knowledge** | RAG / 语料库 | 事实性、频繁更新、需引用出处 | 不清权限与过期版本直接灌入;把程序性 SOP 当知识检索 |
| **Tool / MCP** | 业务系统读写接口 | 真实动作(退款、建单、立案) | 工具描述敷衍;不做最小权限 |
| **Rule / Policy engine** | 代码级策略(Rego 等) | 合规红线,需 fail-closed | 用 prompt 约束代替引擎(可被注入绕过) |
| **Eval** | golden tasks + SME rubric | 一切改动的回归门禁 | 上线后才补评测 |

### 3.2 Agent Skills:SOP 注入的标准机制(重点)

- 结构:目录含 `SKILL.md`(YAML frontmatter:name ≤64 字符、description ≤1024 字符须写清 **what + when**、可选 allowed-tools)+ 正文 + `scripts/`、`references/`、`assets/`([spec](https://agentskills.io/specification))。
- **三级渐进式披露**:L1 元数据(~100 token,启动时全部进 system prompt 供触发判断)→ L2 正文激活时加载(建议 <5000 token)→ L3 资源按需读取,"上下文实际上无上限"。
- 关键设计:PDF 处理等案例中**脚本直接执行、不进上下文**——"很多应用需要只有代码能提供的确定性可靠性"。这是"SOP 中确定性步骤下沉为代码"的官方机制。
- 生态:已转开放标准(agentskills.io),OpenAI Codex 等跨平台兼容,`/v1/skills` API 做版本管理,支持组织内共享与 marketplace([Anthropic 博客](https://www.anthropic.com/engineering/equipping-agents-for-the-real-world-with-agent-skills))。
- **与 MCP 的分工**:MCP 管"活连接"(工具/数据/认证,现行 spec 2026-07-28 引入 stateless core、Tasks、统一发现,官方 registry 已 preview);Skills 管"程序性知识"(SOP)。

### 3.3 标杆案例的定制机制拆解

**Harvey(法律)——SOP 的结构化编码。** 法律 playbook 编码为"结构化规则定义(标准位/可接受偏差/否决点/条款可否缺失)+ 自然语言 guidance"。新架构 orchestrator-worker:lead agent 以"主办律师"身份按每条规则 spawn 子代理(数十个并行),各子代理读规则→检索合同(每个文档元素有唯一 ID)→在 versioned document model 的自己分支上编辑→提交备忘;分支像 git 一样 reconcile,冲突升级给 lead。评测:in-house 律师写 rubric + 三个前沿模型委员会投票;redline 质量 53%→87%,延迟 +47% 是主动换质量。与律所共创:A&O Shearman 3500 律师、试点期 4 万次真实查询打磨工作流([Rebuilding Playbook Review](https://www.harvey.ai/blog/rebuilding-playbook-review-as-a-multi-agent-system) | [MCP Policy Engine](https://www.harvey.ai/blog/building-harveys-mcp-policy-engine))。

**Sierra(客服)——Agent OS 分层。** 客户声明 policies / tools / guardrails / knowledge / brand and tone,平台编译为生产 agent;模块化 task 抽象隔离职责,低风险任务可独立更新不碰敏感 guardrail;Constellation of models:15+ 模型按任务匹配,supervisor 模型对高自主任务逐条实时校验([Constellation of Models](https://sierra.ai/blog/constellation-of-models))。其开源评测 τ²-bench(工具-agent-用户三方交互)已成为行业标准之一。

**Cognition/Devin——反多智能体的 context engineering。** 两原则:"share full agent traces"(只传消息不够)、"actions carry implicit decisions"(并行子代理基于未声明的冲突假设产出烂结果);默认单线程线性 agent + compaction(为压缩历史专门微调小模型)([Don't Build Multi-Agents](https://cognition.com/blog/dont-build-multi-agents))。

**Intercom Fin / Cursor——规则工程化。** Fin:政策/流程训练进自研 Apex 模型(含 "Apex for Procedures" 处理多步 SOP),上线前 simulations+回归,上线后 AI Insights 一键转配置。Cursor:`.cursor/rules/*.mdc` 四种注入模式(Always / Auto Attached by globs / Agent Requested / Manual),最佳实践:**"只在 agent 重复犯同一错误时加规则"**、规则 <500 行、风格问题交给 lint([Cursor Rules](https://cursor.com/docs/context/rules))。

**Morgan Stanley(金融)——评测先行。** 10 万文档语料,文档可达率 20%→80%,98% 顾问团队日用;三类 eval 均由顾问+prompt 工程师人工评分迭代;每日跑回归套件;治理委员会把关([OpenAI 案例](https://openai.com/index/morgan-stanley/))。

### 3.4 接入一个新行业的从业者流程(SOP → 可评测 agent)

1. **评测先行**:从真实工单/卷宗/SOP 场景选 30-100 个 golden tasks,含领域专家(SME)手写的高危边缘案例;每条带 SME rubric(通用 rubric 在领域任务上失效)。
2. **SOP 分诊**:程序性步骤 → skill/规则;事实性知识 → knowledge;硬红线 → policy engine;外部动作 → tool/MCP;金标准好例子 → few-shot。
3. **编码**:写 SKILL.md(触发词写进 description;细节下沉 references/;确定性操作写 scripts/,注明"直接执行还是读作参考");把 LLM 成功轨迹回写成 skill 内容。
4. **架构选择**:默认最简(单次调用 + RAG + 示例);可预分解的固定任务用 workflow;步数不可预测的开放任务才用 agent。多智能体的边界:Cognition 反例 vs Harvey 正例——**只有当规则间强冲突、需要显式 reconcile 机制时才拆**。
5. **检索路线**:私有事实但行为 OK → RAG;语料数百页内 → 长上下文;实体关系/权限感知推理 → 知识图谱(Glean 全公司图谱+查询时 ACL)。失效场景:RAG 败于规则交互与长文档质量衰减(Harvey 旧系统教训);长上下文败于成本与"中间遗忘"。
6. **微调时机**:一致风格/格式、延迟成本、工具调用可靠性,且 prompt+eval 已到顶再上(Harvey Tenet、Sierra 定向微调、Fin Apex 均在规模化后);**行为问题微调、知识问题 RAG**。
7. **闭环**:线上 trace → 人工评审 → 沉淀回 golden set 并每日回归(Morgan Stanley 每日回归、Fin 会话学习、Harvey 红线接受/拒绝反馈);高危动作留 HITL 升级出口。

---

## 4. 框架横评与选型(2026-11 时点)

### 4.1 对比表(节选,完整见来源)

| 框架 | 许可证 | 核心抽象 | 状态/持久化 | 定位 |
|---|---|---|---|---|
| LangGraph 1.0 | MIT | StateGraph + checkpointer + interrupt | 多后端 checkpoint + thread | 编排内核,生产采用最广(57% 受访有 agent 上线) |
| OpenAI Agents SDK | MIT | Agent/Handoffs/Guardrails/Sessions | Sessions(无长度管理,需外挂) | 薄内核,OpenAI 生态 |
| Pydantic AI | MIT | 类型化 Agent + durable engine | 同一 agent 代码跑 8 种引擎(Temporal/DBOS/Restate…) | 类型安全 + durable 先锋 |
| Microsoft Agent Framework | MIT | 图 Workflow + checkpoint | checkpoint 需 Azure 才完整 durable | Azure/.NET 企业 |
| Google ADK | Apache-2.0 | LlmAgent + Workflow Agent | Session 级 | GCP 生态 |
| CrewAI | MIT | Crew/Task/Flow | Flow 可持久化,生产可靠性靠商业版 | 演示友好,开源层控制力弱 |
| Claude Agent SDK | 专有分发 | Harness/loop/Skills/Hooks/Subagents | Session resume/fork | 开箱最强 harness 内核,绑定 Claude |
| Letta | Apache-2.0 | Memory Block 一等公民 | 全量入库 Postgres | memory-centric |
| Mastra / Agno | Apache-2.0 系 | TS 全家桶 / AgentOS | 可插拔存储 / resume+replay | TS 生态 / 平台化激进 |
| OpenHands SDK | MIT | 事件溯源 Agent/Server | 事件溯源 | 参考实现,"harness as product" |
| Temporal/DBOS/Restate | MIT 系 | 确定性重放 | 事件历史 | durable 底座,与任何内核组合 |
| Dify/Coze/n8n | 混合 | 可视化 DSL | 平台托管 | **配置驱动的交付层,不是内核**;Flowise 已归档应剔除 |

来源:[LangGraph docs](https://docs.langchain.com/oss/python/langgraph/interrupts) | [Pydantic AI](https://pydantic.dev/docs/ai/capabilities/durable_execution/overview) | [OpenHands SDK 论文](https://arxiv.org/abs/2511.03690) | [Diagrid 评测](https://www.diagrid.io/blog/still-not-durable-how-microsoft-agent-framework-and-strands-agents-repeat-the-same-mistake) | [LangChain State of Agent Engineering](https://www.langchain.com/state-of-agent-engineering)

### 4.2 分类结论

- **适合做基座内核**:LangGraph(编排+持久化+HITL 最完整,生态最大,但抽象偏多);Pydantic AI(工程纪律最好,durable 内建);Claude Agent SDK(接受模型绑定时开箱最强);Microsoft Agent Framework(限 Azure 栈;其 checkpoint 在云中立场景不完整 durable)。
- **适合做可靠性层**:Temporal / DBOS / Restate,可垫在任何内核之下。
- **适合做参考实现学习**:OpenHands SDK(事件溯源)、mini-SWE-agent(~100 行,SWE-bench Verified 74%+,"极简循环胜过复杂脚手架"的实证)、Claude Code 本身(harness/skills/hooks 体系)、Letta(记忆即状态机)。
- **不适合做内核**:CrewAI(开源层持久化/控制力不足);低代码平台(引擎黑盒、定制受 DSL 限制、Dify/n8n 许可对 SaaS 化有限制)——Dify 应定位为"交付层"而非基座。

---

## 5. 五个关键架构决策点(从业者分歧)

**① 单 agent vs 多 agent。** Cognition:并行 multi-agent "only results in fragile systems",推荐单线程线性 agent + 专用压缩模型。Anthropic 实证反驳:开放型可并行任务上多 agent +90.2%,但 token 为 15 倍,只配高价值任务。OpenAI 折中:先榨干单 agent(>15 个重叠工具才拆分)。Harvey 案例给出多 agent 的真正边界条件:**规则间强冲突、需要显式 reconcile 时才拆**。

**② 框架 vs 裸写循环。** Anthropic/OpenAI 均反框架(抽象遮蔽 prompts 与响应,难调试;12-factor:套框架团队撞 70-80% 天花板)。LangChain 让步式回应:承认抽象"低地板低天花板",但主张循环之外的**生产特性(持久化、HITL、流式、容错、可观测)才是框架的持久价值**。共识:若用框架,必须 own 你的 prompt、context 与控制流(12-factor ②③⑧)。

**③ 压缩 vs 外部记忆 vs 更大窗口。** Manus/Cognition 押注压缩+文件系统外置;Anthropic 平台两路并给;而 Claude Code Best Practices 又宣布"激进管理上下文"已过时(1M 窗口时代)——同一公司内部随窗口扩大出现路线摇摆。

**④ Harness vs 模型谁决定上限。** 正方:同一模型不同 harness 分差 23.8 分(Latent Space)、成本差 2 倍(Databricks)。反方:模型能力提升正在吸收 harness 职责(GPT-5.1-Codex-Max 原生跨窗口 compaction;Anthropic 砍掉 Claude Code 80% system prompt)。**综合判断(Latent Space"吸收倒转论"):模型向部件(压缩/记忆/原生工具)持续变薄甚至消失;组织向部件(权限、身份、审批、审计、领域 evals、触发通道)持续变厚——基座应投资后者,别和模型厂商抢前者。**

**⑤ LLM-as-judge 用不用。** Anthropic 用单 judge 0-1 分 + 人工补充(人工发现了偏 SEO 内容农场的盲区);Databricks 反对("sounding right over being right")。折中:judge 必须先与人工标签做 precision/recall 对齐,judge 本身也要 mini-eval 维护。

---

## 6. 生产化"七件套"checklist

1. **自建小评测集**:20-100 条 golden tasks 起步 + SME rubric;三级流水线(L1 单元断言每次改动跑 / L2 人工+模型评 trace / L3 A/B 产品成熟后);先做错误分析,"读日志直到读不出新东西"。反模式:用通用 benchmark 排名代替领域评测;judge 不对齐就上线。
2. **OTel 标准 trace**:打点层用 GenAI semantic conventions 防锁定;span 树结构化;敏感内容默认不采集。平台选型:Langfuse(开源可自托管)/ Phoenix(开源)/ LangSmith(闭源,LangChain 生态)/ Braintrust(eval-first)。
3. **文件式记忆**:file system as memory(Manus + Anthropic 双重验证);压缩必须可恢复;保留失败记录。反模式:无差别向量化塞库;压缩时删失败证据。
4. **Trifecta 防御**:Simon Willison "lethal trifecta"——私有数据访问 + 暴露于不可信内容 + 对外通信,三者齐备即无可靠修复;防御组合 = 沙箱 + 权限规则 + egress 白名单 + deny 规则;高权限凭据不交给能读不可信内容的 agent。OWASP LLM Top 10 2025 作 checklist。
5. **持久化审批 gate**:人审批建模为工具调用;审批状态必须持久化可恢复(人几分钟不响应,agent 状态不能丢);副作用工具幂等键。
6. **缓存优先的成本设计**:KV-cache 命中率是第一指标(前缀稳定、append-only);prompt caching 读取 0.1× 价格;换更强模型的提升大于双倍 token 预算;多 agent 化先核算 token 放大(15×)。
7. **Durable execution**:分钟级任务 checkpoint 足够;小时级/涉资金/长审批用 Temporal/DBOS/Restate;rainbow deployment 渐进切流;全量 tracing 只记决策模式。

---

## 7. 反模式清单(全部来自一手复盘)

- 把百科知识塞 system prompt;单 skill 超 500 行不拆
- 用 prompt 约束代替 policy engine 做合规红线(可被注入绕过)
- 工具返回 UUID 而非语义字段;错误信息不写改进建议;搜索结果不设上限
- 系统提示里放动态时间戳(毁 KV-cache);上下文原地编辑
- 运行中动态增删工具(毁缓存且困惑模型,Manus)
- 靠 system prompt 求模型拒绝注入
- microVM + 无限制出口 = 假隔离
- 审批流无持久化;sticky 的 always-approve 跨 agent 共享(OpenAI 点名的安全风险)
- 把业务状态埋在对话历史里(12-factor 第 5 条:执行状态与业务状态统一)
- 上线后才补评测;用通用 benchmark 代替领域评测
- 模糊委派子 agent("研究一下 X"式任务描述导致重复劳动;曾有 50 个 subagent 跑琐碎查询的失控案例)
- 为省钱让 50 步 agent 全程用最小模型

---

## 8. 对你的落地建议

### 8.1 组织形态:平台团队 vs 业务团队

Monte Carlo 总结的内部 AI 平台团队六项职责(与你说的"基座"完全对应):①模型网关(路由/故障切换/预算);②共享评测与回归基建;③context 与检索基建;④agent 运行时(循环、恢复、沙箱、**权限**);⑤guardrails 与治理(PII、防注入、审计);⑥成本与可观测。配套:agent registry(注册/发现/审计 agent/工具/MCP 清单)+ prompt/评测版本管理由平台统一托管。

边界原则:平台"当产品而非项目"做自助化,否则业务绕行,成本/安全/质量问题全部回流。

### 8.2 Build / Adapt / Buy 决策

| 路径 | 适用条件 |
|---|---|
| **自研 harness** | agent 循环本身是核心竞争力;有平台团队与 evals 能力;复杂权限/合规/审计 |
| **基于 SDK 改(默认项)** | 需要成熟循环/压缩/子 agent/MCP,但要 own prompt、context、业务流程 |
| **直接用平台** | 低差异化内部场景;无平台团队的小团队 |

你的情况("通用基座 + 多行业快速接入")落在前两者的结合:**基座内核 adopt(Pydantic AI 或 LangGraph,或 Claude Agent SDK 若接受绑定),定制层规范与治理自研**。12-factor 的分界线作为设计宪法:基座 own ①自然语言→工具调用 ⑤统一执行状态 ⑥暂停/恢复 ⑦HITL ⑧控制流 ⑨错误回灌 ⑪触发通道 ⑫无状态 reducer;行业团队 own ②prompts ③context 组装 ④工具定义 ⑩agent 拆分粒度与 SOP。

### 8.3 基座目录与领域包的推荐形态

```
基座(跨行业复用,尽量薄)
├── 循环引擎        gather → act → verify;模型无关
├── 上下文管理       compaction / 清陈旧工具结果 / append-only / 缓存断点
├── 工具执行层       registry + schema 校验 + 错误归一化 + 截断分页
├── 连接层          MCP client + hosted tools
├── 沙箱            文件系统/网络边界 + egress 白名单
├── 权限与审批       allow/ask/deny 规则 + 审批持久化 + 幂等键
├── 子 agent         独立上下文 + 只回摘要
├── 记忆            文件系统即记忆
├── durable 执行     checkpoint + 重放(可后置)
├── 可观测          OTel GenAI spans
├── 评测基座         runner / trace 回放 / judge 管理
└── 触发通道         API / CLI / Web / webhook / cron

领域包(每个行业一份,接上即用)
├── persona.md       角色与全局硬约束(system prompt 片段)
├── skills/          SOP 编码(SKILL.md + scripts/ + references/)
├── tools/           行业 MCP server / API 封装
├── knowledge/       领域语料与检索配置
├── policies/        合规红线(Rego 等,fail-closed)
├── evals/           golden tasks + SME rubric   ← 真正的护城河
└── hitl.yaml        何时升级给人(触发器定义)
```

"接入新行业 = 交付一份领域包",这份包的验收标准就是其中 evals 达到目标通过率——**评测集既是质量门禁,也是基座复用性的验收测试**。

### 8.4 阶段路线

- **Phase 0(评测先行)**:选第一个行业,和领域专家一起建 30-100 条 golden tasks + rubric。这一步先于一切代码。
- **Phase 1(薄基座跑通)**:Pydantic AI(或 LangGraph)+ 自有 prompt/context 层 + MCP 工具网关,单 agent + workflow 起步;借 mini-SWE-agent/OpenHands SDK 做架构参考。
- **Phase 2(定制机制固化)**:Skills 目录规范、policy engine、evals runner、HITL 审批流——把第 3 节的六层注入模型做成工程规范。
- **Phase 3(生产七件套)**:OTel、durable、沙箱与 egress、rainbow deployment。按需后置,不要一开始全建。

### 8.5 对这个产品形态的从业者判断(正反)

**正方**:Manus 证明不训练模型、纯 context engineering 也能跑复杂领域流程;MAST 论文(150+ 任务、1642 条失败轨迹)证明多数失败源于系统设计而非模型能力——好基座可复用修复;行业 SOP 恰是 12-factor 留给应用层的部分。

**反方**:Karpathy——当前模型长程可靠性不足以承载全自治行业流程,先做"部分自治"(人提议 AI 验证或反之);行业任务隐性知识难以 prompt 化;MAST 同时显示 multi-agent 失败率可达 60-80%;**基座可复用、资产(评测集/工具集成/审批流)不可复用**。

**中间结论(材料共同指向)**:可行,但护城河不在基座本身——在评测集、工具集成与审批流。这恰是模型能力吞噬不到、框架抽象覆盖不了的部分。你的基座战略应该是:**基座做得足够薄、足够标准(skills + MCP + evals 三个开放协议),把所有差异化投资压在领域包的工程规范和治理上。**

---

## 9. 主要来源汇总

**Anthropic**:[Building effective agents](https://www.anthropic.com/engineering/building-effective-agents) · [Effective context engineering](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents) · [Writing effective tools](https://www.anthropic.com/engineering/writing-tools-for-agents) · [Multi-agent research system](https://www.anthropic.com/engineering/built-multi-agent-research-system) · [Agent Skills](https://www.anthropic.com/engineering/equipping-agents-for-the-real-world-with-agent-skills) · [Context management](https://claude.com/blog/context-management) · [Claude Agent SDK](https://claude.com/blog/building-agents-with-the-claude-agent-sdk) · [CC Best practices](https://code.claude.com/docs/en/best-practices) / [Hooks](https://code.claude.com/docs/en/hooks) / [Subagents](https://code.claude.com/docs/en/sub-agents) / [Sandboxing](https://code.claude.com/docs/en/sandboxing) / [Permissions](https://code.claude.com/docs/en/permissions)

**OpenAI**:[A practical guide to building agents](https://cdn.openai.com/business-guides-and-resources/a-practical-guide-to-building-agents.pdf) · [Agents SDK](https://openai.github.io/openai-agents-python/) / [HITL](https://openai.github.io/openai-agents-python/human_in_the_loop/) · [Responses API tools](https://platform.openai.com/docs/guides/tools) · [HealthBench](https://openai.com/index/healthbench) · [Morgan Stanley 案例](https://openai.com/index/morgan-stanley/)

**其他实践者**:[Cognition: Don't Build Multi-Agents](https://cognition.com/blog/dont-build-multi-agents) · [Manus: Context Engineering](https://manus.im/blog/Context-Engineering-for-AI-Agents-Lessons-from-Building-Manus) · [SWE-agent (ACI)](https://arxiv.org/abs/2405.15793) · [MAST: Why Do Multi-Agent LLM Systems Fail?](https://www.alphaxiv.org/abs/2503.13657) · [12-factor agents](https://github.com/humanlayer/12-factor-agents) · [Shreya Shankar: In Defense of AI Evals](https://www.sh-reya.com/blog/in-defense-ai-evals) · [Hamel Husain: Evals](https://hamel.dev/blog/posts/evals/index.html) · [Latent Space: Evolution of the Agent Harness](https://latent.space/p/attention-interface) · [Databricks 基准](https://www.databricks.com/blog/benchmarking-coding-agents-databricks-multi-million-line-codebase) · [Diagrid: Still Not Durable](https://www.diagrid.io/blog/still-not-durable-how-microsoft-agent-framework-and-strands-agents-repeat-the-same-mistake) · [Simon Willison: lethal trifecta](https://simonwillison.net/2025/Jun/16/the-lethal-trifecta/) · [OWASP LLM Top 10](https://genai.owasp.org/llm-top-10/)

**垂直案例**:[Harvey Playbook Review](https://www.harvey.ai/blog/rebuilding-playbook-review-as-a-multi-agent-system) · [Harvey MCP Policy Engine](https://www.harvey.ai/blog/building-harveys-mcp-policy-engine) · [Sierra: Constellation of Models](https://sierra.ai/blog/constellation-of-models) · [τ²-bench](https://github.com/sierra-research/tau2-bench) · [Cursor Rules](https://cursor.com/docs/context/rules) · [Glean](https://www.glean.com/product/agents)

**标准与框架**:[agentskills.io spec](https://agentskills.io/specification) · [MCP spec](https://modelcontextprotocol.io/specification/versioning) · [LangGraph](https://docs.langchain.com/oss/python/langgraph/interrupts) · [Pydantic AI durable](https://pydantic.dev/docs/ai/capabilities/durable_execution/overview) · [OpenHands SDK](https://arxiv.org/abs/2511.03690) · [Letta](https://docs.letta.com/guides/agents/memory) · [A2A](https://github.com/a2aproject/a2a) · [OTel GenAI semconv](https://github.com/open-telemetry/semantic-conventions-genai/blob/main/docs/gen-ai/gen-ai-spans.md) · [LangChain State of Agent Engineering](https://www.langchain.com/state-of-agent-engineering) · [Monte Carlo: Internal AI Platform Team](https://montecarlo.ai/blog-the-rise-of-the-internal-ai-platform-team)

> 时效说明:所有结论以 2026-11-03 为时点。低代码平台中 Flowise 已归档;Microsoft Agent Framework 与 Google ADK 的 durable 能力仍在演进;OTel GenAI semconv 尚未 stable,下游硬编码依赖需谨慎。
