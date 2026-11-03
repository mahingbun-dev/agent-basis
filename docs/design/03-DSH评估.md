# DSH(DeepSeek Harness)作为基座的可行性评估

> 评估时间:2026-11-03。前置文档:[agent-harness-research.md](./agent-harness-research.md)(业界调研)、[agent-harness-deepseek-design.md](./agent-harness-deepseek-design.md)(原设计,其"自研内核"结论已被本文修订)。

---

## 1. DSH 是什么(事实卡)

- **DeepSeek 官方开源的 Agent Harness**,2026-08-13 发布,定位从"基于 Harness SDK 的编码 agent"演进为"通用 agent harness",对标 Claude Code / Codex([官方仓库](https://github.com/deepseek-ai/deepseek-harness)、[官方文档](https://deepseek-harness.github.io/deepseek-harness/))
- **许可证:MIT**;TypeScript monorepo(227 个可发布包)+ 部分 Python;约 27 万 star、24,922 commits,发布三日即数万 star——社区采纳速度历史级
- **"一切皆插件"**:模型、工具、技能、会话、沙箱、存储、循环、调度、UI 全部插件化,底层是内嵌的 **Cordis 插件框架**(有正式设计论文 arXiv:2608.25512)
- **四种运行模式**:标准 / 极简 / 创造 / **PTC(程序化工具调用,模型写程序组合多轮工具调用)**;社区有 [dsh-ptc-plus](https://github.com/muyuanjin/dsh-ptc-plus) 增强版
- **模型无关**:[Discussion #611](https://github.com/deepseek-ai/deepseek-harness/discussions/611) 确认 provider 机制——内置 anthropic / openai / moonshotai,支持自定义 Provider ID + Base URL,任意 OpenAI 兼容端点可接。rc.7/rc.8 起 Codex/Claude Code 也以 Provider Bundle 形式解耦出核心
- 安全机制被**腾讯玄武实验室红队实测**(14,560 次运行测提示注入链路),肯定了策略钩子、Guard、审批、沙箱、Session Event 的工程化能力([报告](https://matrix.tencent.com/zh/2026/08/20/deepseek-harness-agent-injection-risk))

## 2. 对照 harness 12 组件清单的覆盖评估

对照业界调研报告第 2 节的组件清单:

| 组件 | DSH 覆盖 | 说明 |
|---|---|---|
| ① 循环引擎 | ✅ 内置 | agent loop 本身可插件替换 |
| ② 上下文管理 | ◐ 部分 | compaction 有;KV-cache 50 倍价差利用、工具结果截断策略需自己验证和调 |
| ③ 工具层 | ✅ | 工具注册/执行/呈现 + MCP client(自动重连) |
| ④ 权限/审批 | **◐ 弱** | 原生只有 ask/never 全局策略 + sandbox 模式;细粒度 allow/deny/ask 靠**社区插件** [dsh-tool-permission](https://blog.csdn.net/weixin_43837268/article/details/164375145)——行业合规场景不能依赖第三方插件 |
| ⑤ 沙箱 | ✅ | 三层沙箱(权限预设→用户审批→文件隔离)+ 三平台后端;**Windows 有多个已知问题**,建议 Linux 部署 |
| ⑥ 记忆 | ◐ 未证实 | Skill 是"建议性指令"按名加载、不进会话事件日志;长期状态官方指引走 Cordis service(见 Discussion #68 迁移指引) |
| ⑦ 子 agent | ✅ | 后台 Subagent、可续接、Child Identity;agent-teams 在 experimental |
| ⑧ Hooks/扩展点 | ✅ | Cordis 插件树 + 策略钩子/ Guard |
| ⑨ 可观测 | ◐ | 有 telemetry(含"什么数据会离开你"说明);OTel GenAI 标准对接需自建插件 |
| ⑩ 评测 | **❌ 无** | 无 evals runner / judge / golden set 管理——这本来就是自建资产,不算损失,但要明确 |
| ⑪ Durable | ❓ 未证实 | 会话持久化有;崩溃自动重放(durable execution 语义)未见 |
| ⑫ 触发通道 | ◐ | CLI + Web UI;飞书/钉钉/webhook/cron 通道需自建插件 |
| — Skills | ✅ | 技能机制原生支持(注意:官方否决过"Skill Registry API"提案,分发生态尚未产品化) |

## 3. 结论:分两种"基座"含义回答

### 场景 A:如果"基座 agent"= 通用 agent 产品(类 Claude Code,给开发者/团队用)
**可以,直接用 DSH,不需要自研框架。** 它就是这个定位,且 MIT + 模型无关 + 社区生态爆炸。你要做的只是写插件和 Skill。

### 场景 B:如果"基座"= 行业 agent 平台(你的原始目标:领域包跨行业交付、evals 验收)
**用 DSH 替代自研内核是成立的,但"不用自研框架"≠"不用做工程"。** 你的角色从"造内核的人"变成"DSH 平台上的插件与领域包开发者"。仍有四层必须自己做:

1. **治理层**:细粒度权限(不能靠社区插件)、policy engine(合规红线 fail-closed)、审计日志、PII——这是行业 agent 的核心资产
2. **领域包规范**:DSH 的分发单位是"插件 + Skill",没有"领域包 = persona+skills+tools+knowledge+policies+evals+hitl"的产品化打包概念;你要在 Cordis service + skills 之上定义自己的 pack 规范(这正是调研报告说的"模型吞噬不到、框架覆盖不了"的护城河层)
3. **评测体系**:golden tasks + runner + judge + 回归 CI
4. **企业通道**:飞书/钉钉/多租户/registry

### 必须正视的风险(场景 B 的决策变量)

| 风险 | 事实 | 缓释 |
|---|---|---|
| **成熟度(最大风险)** | 2026-08-13 发布,官方自述 developer preview、"会有破坏性变更";rc.3 全仓改名**不留任何兼容包**;无 GitHub Releases 页 | 锁定版本 + fork 自维护;升级走灰度 |
| 可靠性 | [实测](https://www.atlascloud.ai/zh/blog/tips/deepseek-harness-review):3 次运行中 1 次"声称完成但仅 1 页生效" | 用自己的领域 eval 验收,不信任 agent 的完成声明(Anthropic 同款原则:评终态) |
| Windows 沙箱坑 | 受限令牌掐断 HTTPS、icacls 权限、workspace 路径崩溃([#9994](https://github.com/deepseek-ai/deepseek-harness/discussions/9994) 等) | 生产环境 Linux/Docker |
| 非 DeepSeek 模型的特性兼容 | PTC/code mode 等特性对其他模型的适配未经广泛验证 | P0 评测里加一条:GLM-5/Kimi 在 DSH 上跑同一 eval |
| 快速演进方向不可控 | 官方设计笔记显示 11 个提案被否决(含 Skill Registry API、Workflow 合并),产品路线由 DeepSeek 主导 | 领域包规范与 DSH 解耦(纯文件约定),内核可替换 |

## 4. 修订后的路线(替代原设计文档 P1)

```
P0(不变,评测先行)
├── 选第一个行业,建 30-100 条 golden tasks + rubric
├── eval 实测:DeepSeek Flash/Pro 工具调用成功率(Go/No-Go)
└── 新增 DSH spike:用 DSH 搭最小领域包原型,跑通 10 条 golden tasks
    (验证:Skill 机制够不够用、审批挂起/恢复、KV-cache 命中率、
     换 GLM-5/Kimi provider 是否可跑)

P1(原"自研薄内核"→"DSH 二次开发")
├── 锁版本 fork + 权限细化插件(自研,替代社区插件)
├── OTel→Langfuse 插件、审批持久化验证、飞书/钉钉通道插件
└── 领域包规范 v1(persona/skills/tools/knowledge/policies/evals/hitl)

P2/P3(不变)定制机制固化 → 生产件,evals CI 承接验收

对冲:领域包规范与 evals 是内核无关的纯文件约定;
     若 DSH 被破坏性变更/可靠性卡死,回退自研薄内核
     (原设计文档方案),领域包与评测资产零损失迁移。
```

## 5. 一句话回答你的问题

**可以不用自研框架——DSH 直接当基座内核,自研内核取消;但你原来要做的"插件层 + 领域包 + 评测 + 治理"四层工程不会消失,只是从"造轮子"变成"在 DSH 上装轮子和定规范"。** 真正决定成败的 P0(领域评测集先行)与模型选型验证,一步都不能省。

---

### 主要来源

- 官方:[GitHub 仓库](https://github.com/deepseek-ai/deepseek-harness) · [官方文档站](https://deepseek-harness.github.io/deepseek-harness/) · [Discussion #611(模型 provider)](https://github.com/deepseek-ai/deepseek-harness/discussions/611) · [Discussion #68(prompt→Skill 迁移指引)](https://github.com/deepseek-ai/deepseek-harness/discussions/68) · [Discussion #9994(Windows 问题)](https://github.com/deepseek-ai/deepseek-harness/discussions/9994)
- 架构拆解:[SegmentFault:拆解 dsh 系列(源码与版本演进)](https://segmentfault.com/a/1190000048223776) · [CSDN:架构深潜](https://blog.csdn.net/u012220174/article/details/163858483) · [runoob 教程](https://www.runoob.com/deepseek-harness/deepseek-harness-tutorial.html)
- 能力与安全:[四层安全体系](https://blog.csdn.net/weixin_63132747/article/details/163827111) · [三层沙箱架构](https://blog.csdn.net/weixin_35774598/article/details/169068001) · [腾讯玄武实验室红队报告](https://matrix.tencent.com/zh/2026/08/20/deepseek-harness-agent-injection-risk) · [dsh-tool-permission 细粒度权限](https://blog.csdn.net/weixin_43837268/article/details/164375145)
- 生态:[dsh-agent-teams](https://github.com/NanmiCoder/dsh-agent-teams) · [DSH-Plugins](https://github.com/gityuanbao/DSH-Plugins) · [dsh-kit](https://github.com/zhouzhencheng07/dsh-kit) · [dsh-ptc-plus](https://github.com/muyuanjin/dsh-ptc-plus)
- 实测:[Atlas Cloud 评测](https://www.atlascloud.ai/zh/blog/tips/deepseek-harness-review) · [SegmentFault:10 场景对比 Codex/Claude Code](https://segmentfault.com/a/1190000048175410)
