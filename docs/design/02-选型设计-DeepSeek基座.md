# Agent 基座设计:DeepSeek 模型 + 自研 Harness + 通用插件框架

> 前置文档:[agent-harness-research.md](./agent-harness-research.md)(业界调研)。本文把调研结论落到你的具体选型上。

---

## 1. 模型选型核实(2026-11-03 时点)

### 1.1 DeepSeek 产品线现状

| 时间 | 型号 | 定位 |
|---|---|---|
| 2026-04-24 | V4-Flash 预览 | Flash 线首发 |
| 2026-07-31 | V4-Flash-0731 | 正式版,284B MoE / 激活 13B |
| 2026-08 | V4 Pro 0813 | 深度推理线,Terminal-Bench 2.1 达 87.9(前代 72.1) |
| 2026-10-17 | **V4.1-Flash-1017(当前最新)** | 552B MoE,Causal-Encoder-Decoder 架构,原生多模态,低延迟低成本,官方称已适配 Agent Harness |

结论:**"DeepSeek Flash"是真实产品线,且 Flash(低成本主力)+ Pro(深度推理)双线分工**——这正好对应 harness 里的模型路由设计。

### 1.2 定价与成本结构

- V4.1 Flash 约 **$0.15/M 输入、$0.60/M 输出**([Morphllm 汇总](https://www.morphllm.com/deepseek-api)、[TLDL](https://tldl.io/resources/deepseek-api-pricing)),官方定价页:[api-docs.deepseek.com/zh-cn/quick_start/pricing](https://api-docs.deepseek.com/zh-cn/quick_start/pricing)
- **缓存命中价差极大**:硬盘缓存命中约 0.02-0.04 元/M(空闲/高峰),未命中 1-2 元/M——**~50 倍差价**([KV 缓存说明](https://api-docs.deepseek.com/zh-cn/guides/kv_cache))。90% 命中率下有效输入成本可降到 ~$0.0177/M([Activepieces 分析](https://www.activepieces.com/blog/deepseek-api-pricing-2026-cost-per-1m-tokens))
- ⚠️ **定价波动风险**:2026-08 有过一次调价,缓存命中价格涨幅据报道达 4 位数百分比([Reddit 讨论](https://www.reddit.com/r/DeepSeek/comments/1vn81do/),需以官方页为准)。**这意味着:成本模型不能写死在架构里,必须做成可配置的路由策略。**

### 1.3 与竞品的横向位置

2026 年国产第一梯队:GLM-5/5.1、Kimi K2.5/K2.6、MiniMax M2.1/M2.5(官方主打 Agent 工具脚手架泛化)、Qwen3.5,且[阿里云百炼已支持一站切换四家](https://post.smzdm.com/p/apwdew67);[国产开源模型在 HF 榜单前十占 8 席](https://post.smzdm.com/p/aqr3p3xk)。DeepSeek 的差异化优势:**开源权重(可私有化,金融/医疗/法律行业的硬需求)+ 极致低价 + OpenAI 兼容 API**;MiniMax/GLM/Kimi 在 agent 工具调用上同样在深度优化。

### 1.4 选型结论(建议)

✅ **DeepSeek Flash 做主力模型成立**,但架构上必须满足三个前提:

1. **模型适配层是内核一等公民,不绑死 DeepSeek。** 所有候选(GLM/Kimi/Qwen/MiniMax)都是 OpenAI 兼容 API,适配成本≈0;而定价波动(1.2 已发生)+ 单模型工具调用风格差异,都要求随时可切。用你自己的领域 eval 选模型,不信榜单。
2. **Flash 与 Pro/reasoner 分工路由**:工具循环、简单任务 → Flash 线;规划、审查、judge、复杂推理 → Pro/reasoner 线。路由策略做成插件。
3. **DeepSeek 没有 Anthropic 式托管能力**(memory tool、context editing、hosted web search、computer use、sandbox)——这些全部由你的 harness 自建。工程量要预期到位,但这恰好与 12-factor "own your context window" 一致,**对基座产品反而是好事:能力都在自己手里**。

---

## 2. DeepSeek 特定的 harness 调优清单

这是与"基于 Claude 建基座"最不同的部分,逐条都是硬约束:

| # | 约束 | harness 应对 |
|---|---|---|
| 1 | **硬盘缓存命中价差 ~50 倍** | 缓存命中率是第一成本指标:system prompt 前缀字节级稳定(禁动态时间戳/随机 ID)、工具定义放最前且顺序固定、上下文 append-only、会话内多轮复用同一前缀。内核要有 `cache_guard`:任何破坏前缀稳定性的组件启动时报 warning |
| 2 | **上下文窗口 ~128K 级**(小于 Claude 200K/1M) | compaction 阈值设 ~100K 提前触发;工具结果默认截断比 Claude Code 的 25K 更保守(建议 8-12K);microcompaction(清陈旧工具结果)自研 |
| 3 | **无官方 memory/context-editing API** | 文件系统即记忆(Manus 模式)自建:`memory/` 目录 CRUD 工具 + 会话摘要落盘;压缩必须可恢复(留引用丢正文) |
| 4 | **无 hosted tools**(无服务端搜索/代码执行) | 自建:沙箱(Docker 本地起步,E2B/Daytona 可选)+ 搜索插件(Bocha 博查/SearXNG 自托管/Tavily)+ Python 执行插件 |
| 5 | **工具调用格式稳定性弱于 Claude**(需自证) | 防御性设计:strict JSON schema + 调用前参数校验 + 失败错误回灌(12-factor #9)+ 单轮工具数 ≤20-30;**Phase 0 用领域 eval 实测 Flash 的工具调用成功率,这是 Go/No-Go 数据** |
| 6 | **Flash vs Pro 双线** | 路由插件:按任务类型/步数/风险等级选模型;judge 和规划固定用 Pro 线 |
| 7 | **开源权重可自部署** | 预留 vLLM 部署路径(注意 [vLLM 上 V3.2 的性能问题 issue](https://github.com/vllm-project/vllm/issues/30853));初期直接用官方 API,私有化需求出现再切 |
| 8 | **system prompt 遵循度** | 硬规则不靠 prompt 重复强调,下沉到 hook/policy engine(与 Claude Code 同一原则,在 DeepSeek 上更重要) |

---

## 3. 架构:三层结构(内核 / 通用插件 / 领域包)

```
┌─────────────────────────────────────────────────────┐
│ 触发通道层(插件):API / CLI / Web / 飞书·钉钉·企微    │
│                / webhook / cron                      │
└──────────────────────┬──────────────────────────────┘
┌──────────────────────▼─ 基座内核(自研,薄,非插件)────┐
│ Loop Engine      gather context → act → verify 循环  │
│ Event Store      append-only 事件流 + reducer 状态    │
│                  (12-factor #12:agent=无状态 reducer)│
│ Model Router     OpenAI 兼容适配器(deepseek-flash /  │
│                  pro / 备选模型)+ 路由策略插件位      │
│ Context Manager  组装 + compaction + microcompact    │
│                  + cache_guard(前缀稳定性守护)        │
│ Tool Registry    schema 校验 + 执行 + 错误归一化      │
│ Permission Eng.  allow/ask/deny + 审批持久化 + 幂等键 │
│ Hook Bus         生命周期事件(pre/post-tool、stop…)  │
│ Session Store    SQLite→Postgres,resume / fork       │
└──────────────────────┬──────────────────────────────┘
┌──────────────────────▼─ 通用插件层(基座自带,可插拔)─┐
│ 工具类   fs / shell(沙箱) / web-search / fetch /    │
│          python-exec / MCP client                    │
│ 记忆类   file-memory(主)/ vector-memory(可选)      │
│ 技能类   SKILL.md 加载器(agentskills.io 开放标准)   │
│ 子agent  subagent runner(独立上下文+只回摘要)        │
│ HITL     审批 gate(挂起→人→恢复,状态持久化)         │
│ 治理类   policy engine(OPA/Rego,fail-closed)/       │
│          PII 过滤 / 审计日志                          │
│ 观测类   OTel GenAI spans → Langfuse(自托管)         │
│ 评测类   evals runner + judge 管理 + trace 回放       │
│ 成本类   模型路由策略 + token 预算 + 缓存命中率报表   │
└──────────────────────┬──────────────────────────────┘
┌──────────────────────▼─ 领域包(每个行业一份,即插即用)┐
│ persona.md / skills/ / tools/ / knowledge/ /         │
│ policies/ / evals/ / hitl.yaml                       │
│ 验收标准 = 本包 evals 达标(报告详见调研文档第 8 节)  │
└─────────────────────────────────────────────────────┘
```

> **2026-11-03 修订**:本节"内核自研"的推荐已被 [dsh-evaluation.md](./dsh-evaluation.md) 修订——DeepSeek 官方 2026-08-13 开源了 DeepSeek Harness(DSH,MIT 许可,"一切皆插件"架构,模型无关 provider 机制),可直接作为基座内核,自研内核取消;治理/领域包/评测/通道四层工程仍需自建。下方"自研内核"段落保留作为 fallback 方案。

**原方案(现为 fallback):为什么内核自研而不是用 LangGraph/Pydantic AI**:你要做的是"基座产品"——循环、上下文、权限就是你的核心资产,这正是 12-factor 警告"套框架撞 70-80% 天花板"的部分;而 DeepSeek 没有 Anthropic 托管能力,框架托管能力也帮不上(框架的持久化/HITL 价值主要在 LangGraph 生态)。薄内核(事件流 + reducer + 插件总线)约 2-3k 行,mini-SWE-agent(100 行)和 OpenHands SDK(事件溯源)是直接可抄的参考实现。可以局部借力:JSON schema 校验用 pydantic,durable 后置用 DBOS。

### 插件契约(所有插件统一)

```yaml
# 每个插件一个目录,manifest.yaml 声明
name: web-search
kind: tool        # tool | hook | memory | channel | governance | provider | evals
version: 0.1.0
provides:         # 提供的工具/schema/事件 handler 清单
  tools: [web_search, news_search]
config_schema: { provider: enum[bocha, searxng, tavily] }
permissions:
  default: ask    # allow | ask | deny(内核权限引擎消费)
  egress: whitelist
```

插件只通过三个接口与内核交互:①注册工具/hook;②声明权限需求;③读写 event store。**领域包与通用插件的唯一区别:通用插件随基座发版,领域包按行业交付。**

---

## 4. 推荐目录结构

```
agent-basis/
├── core/                      # 内核:loop / events / session / context /
│                              # models/ / tools/ / permissions / hooks / config
├── plugins/
│   ├── tools/      fs / shell-sandbox / web-search / fetch / python-exec / mcp-client
│   ├── memory/     file-memory / vector-memory
│   ├── skills/     skill-loader(agentskills.io 标准)
│   ├── subagents/
│   ├── hitl/       approval-gate
│   ├── governance/ policy-opa / pii-filter / audit-log
│   ├── observability/ otel / langfuse
│   ├── evals/      runner / judge
│   ├── cost/       model-router / budget-guard / cache-report
│   └── channels/   api / cli / lark / dingtalk / webhook / cron
├── packs/
│   └── _template/  # 领域包模板:persona.md skills/ tools/ knowledge/
│                   # policies/ evals/ hitl.yaml
├── sdk/                       # 业务团队接入 SDK(装领域包=一个函数)
└── ops/                       # 部署:docker 沙箱镜像 / langfuse / dbos / evals CI
```

---

## 5. 分阶段路线(含 Go/No-Go 检查点)

| 阶段 | 内容 | 出口标准 |
|---|---|---|
| **P0 评测先行(第 1-2 周)** | 选第一个行业;和领域专家建 30-100 条 golden tasks + rubric;用这套 eval 实测 deepseek-flash vs pro vs GLM-5/Kimi K2.5 的工具调用成功率与成本 | Flash 在你的任务上工具调用成功率达标(建议 ≥90% 起步线),否则换模型——**这一步决定整个选型,先于任何代码** |
| **P1 薄内核(2-4 周)** | loop / events / session / context(compaction + cache_guard)/ tool registry / permissions;四个必备插件:fs、shell-沙箱、web-search、MCP client | 单 agent 在 eval 集上跑通,成本报表显示缓存命中率 ≥70% |
| **P2 定制机制(4-6 周)** | skill-loader、file-memory、subagent、HITL 审批、OTel→Langfuse | 领域包模板可用;一个真实 SOP 以 skill 形式上线 |
| **P3 生产件(按需)** | policy-opa、PII、审计、通道插件(飞书/钉钉)、evals CI、DBOS durable | 首个行业客户灰度(rainbow deployment) |

## 6. 风险清单

1. **DeepSeek 定价波动**(2026-08 已发生一次):路由策略 + 预算护栏做成配置而非代码;每月用领域 eval 复测一次备选模型,保持"随时可切"能力。
2. **工具调用稳定性未经验证**:这是 P0 的存在理由;若 Flash 不达标,备选路径是 GLM-5 / Kimi K2.5 / MiniMax M2.5(全部 OpenAI 兼容,内核零改动)。
3. **上下文窗口小于 Claude**:compaction 策略更积极;长文档场景优先 RAG 而不是整篇塞入(与调研结论一致:知识问题走 RAG)。
4. **自部署性能坑**:[vLLM issue #30853](https://github.com/vllm-project/vllm/issues/30853);私有化需求出现时先做 PoC 再承诺。
5. **生态自建工程量**:无 hosted tools / memory API 意味着沙箱、搜索、记忆、审批全部自己做——P1-P2 的工期估算已包含,不要按"接个 API"的心理预期排期。

---

### 主要来源

- DeepSeek 产品线:[V4.1-Flash-1017(36氪等报道,2026-10-17)](https://www.36kr.com) · [V4 Pro 0813 agentic 基准](https://explainx.ai/blog/deepseek-v4-pro-0813-terminal-bench-cline-august-2026) · [V3.2 技术深析(Raschka)](https://magazine.sebastianraschka.com/p/technical-deepseek)
- 定价与缓存:[官方定价页](https://api-docs.deepseek.com/zh-cn/quick_start/pricing) · [KV 缓存](https://api-docs.deepseek.com/zh-cn/guides/kv_cache) · [Activepieces 成本分析](https://www.activepieces.com/blog/deepseek-api-pricing-2026-cost-per-1m-tokens) · [调价讨论](https://www.reddit.com/r/DeepSeek/comments/1vn81do/)
- 竞品格局:[百炼多模型切换](https://post.smzdm.com/p/apwdew67) · [国产开源登顶 HF](https://post.smzdm.com/p/aqr3p3xk) · [MiniMax M2.1 Agent 适配](https://www.163.com/dy/article/KJDKK8OB05566T0A.html) · [GLM vs Kimi 选型](https://zhuanlan.zhihu.com/p/1970257733946148474)
- 工程依据:上一份调研报告(agent-harness-research.md)第 2、5、8 节;[12-factor agents](https://github.com/humanlayer/12-factor-agents);[mini-SWE-agent](https://github.com/SWE-agent/SWE-agent);[OpenHands SDK](https://arxiv.org/abs/2511.03690)
