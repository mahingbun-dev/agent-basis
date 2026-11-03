# 06 - 基于 DSH 底座的行业 Agent 开发 SOP(草案 v0.1,讨论稿)

> 状态:**草案,待讨论**。目标:定义"接到一个行业需求 → 交付一个通过评测验收的领域包"的标准流程。依据:[[01-业界调研-通用AgentHarness]](业界分层与评测先行共识)、[[04-DSH源码设计笔记]](机制映射)、[[05-Cordis论文研读笔记]](插件纪律)、[[07-评测体系-ai-evo对接与本地eval插件]]。

## 0. 底座分层(本文的地基)

```
L0 内核 = DSH 官方仓库(agent loop / session / tools / sandbox / approval / skills / llm / ptc / subagent)
          策略:锁版本 fork 自维护,升级走评测门禁
L1 基座层(我们自建,全行业共用)= dsh-basis bundle 体系:
          governance(细粒度权限插件、policy guard、审计投影)
          channels(webhook / 飞书 / 钉钉 / cron)
          observability(OTel → ai-evo / Langfuse)
          knowledge(检索工具插件 v0,后端待定 → WeKnora / pgvector)
          evals runner(本地轻量,见 07)
          pack 规范(领域包文件约定,内核无关)
L2 领域包(每行业一份)= dsh.bundle:
          persona(preset) + skills/ + tool plugins + policies + evals/ + hitl
```

## 1. SOP 总览(七步,每步有 DoD)

```
S0 立项评测先行 → S1 SOP 分诊 → S2 领域包实现 → S3 本地评测内环
→ S4 ai-evo 全量门禁 → S5 灰度发布 → S6 运营闭环(回灌 S1)
```

### S0 立项与评测先行(先于一切代码)

1. 和领域专家(SME)一起,从真实工单/卷宗/SOP 场景选 **30-100 条 golden tasks**,每条含:输入、参考答案或终态条件、SME 手写 rubric、高危边缘案例(生产日志里还没有的 rare case 由 SME 造)。
2. golden set 上传 ai-evo 建数据集(Excel 格式,字段对齐见 07)。
3. **Go/No-Go 实验**(在 S2 之前):用本地 eval runner 跑 golden set 的一个 20 条子集,实测 DeepSeek Flash 的工具调用成功率与任务通过率;同场对比 GLM-5/Kimi(ai-evo 里换被测模型即可)。
4. DSH spike:用 DSH + 手写最小 skill 跑通 10 条,验证 Skill 机制、审批挂起/恢复、KV-cache 命中率、换 provider 可跑性。

**DoD**:golden set v1 入库;模型选型有数据;DSH spike 通过;给出目标通过率(建议:终态校验通过率 ≥80% 才进 S2 之后,越高越好按行业定)。

### S1 SOP 分诊(把行业 SOP 翻译成六类资产)

拿到行业 SOP 文档后,按"变更频率 × 形态 × 关键性"分诊,每个部分落到唯一承载:

| SOP 内容 | 资产 | DSH 承载(见 04 笔记 §13) |
|---|---|---|
| 步骤化操作流程 | `skills/<name>/SKILL.md` | skill-filesystem 目录,body 按需加载 |
| SOP 中的确定性步骤 | `scripts/*.ts`(脚本化,不靠模型"读懂") | skill 的脚本引用 / tool 插件 |
| 事实性知识(手册/案例/FAQ) | `knowledge/` + 检索工具 | knowledge 插件(L1)调用行业知识源 |
| 外部系统动作 | tool 插件 | `defineTool` 注册进 bundle patch |
| 合规红线(不可绕过) | policy 配置 | permission-presets + approval policy + `tools/guard`(**不靠 prompt 约束**) |
| 何时升级给人 | `hitl.yaml` | `ctx.approval` 触发器定义 + `ask_user_question` 约定 |
| 金标准好例子 | few-shot 示例 | persona/system-prompt section |
| 角色与语气 | `persona.md` | preset/persona + system-prompt section |

分诊 checklist:每条 SOP 条目必须落到一行上表;落到 prompt 的只允许"角色/语气/全局硬约束";发现"既要又要"(如既是知识又是流程)拆开。

**DoD**:分诊表评审通过(平台团队 + SME 双签)。

### S2 领域包实现

按 pack 规范实现 bundle(模板见 §2),遵守 Cordis 三条纪律(见 05 笔记 §9):
1. **effect 配逆**:tool 插件的每个可观察变更注册时返回逆闭包;对外发射类动作(发消息/写外部系统)设计成 withhold-或-补偿,不做裸发射。
2. **coeffect 全声明**:inject 什么只用什么;不给旁路全局变量留位置。
3. **provide 可交换接口**:领域 tool/service 的 key 用"注册表 + 唯一 ID"形态,带作用域命名空间(`@<industry>/<pkg>`),peer range 保守。

**DoD**:bundle 安装/卸载各一遍无残留(Cordis 回收验证:卸载后无孤儿定时器/连接/注册项);`dsh --profile <pack>` 可启动;smoke 手册执行通过。

### S3 本地评测内环(分钟级,开发者自用)

用 L1 的本地 eval runner 跑 golden set 子集(20 条,目标 <10 分钟):
- 终态断言 + 轨迹断言(确定性优先,见 07);
- 每次改动 skill/persona/tool 后必跑;
- 产出 report.md(通过率、工具调用成功率、token 成本、缓存命中率、平均轮数)。

**DoD**:改动→评测→修复的内环跑通,单次内环 <10 分钟;缓存命中率 ≥70%(DeepSeek 50 倍缓存价差的直接要求)。

### S4 ai-evo 全量门禁(小时级,平台侧)

本地通过后推 ai-evo(通道见 07):全量 golden set + Agent 长会话裁判 + 终态校验器 + 轨迹匹配 + 门禁阈值。发布前追加:
- **仿真评测**(persona 用户模拟 + 故障注入,trials=3,pass^3):发布前交互回归;
- **安全红队**:上线前门禁(中文 PII/敏感词检测器 + rubric 双通道)。

**DoD**:门禁全部阈值通过(终态校验通过率、轨迹匹配率、裁判均分);评测报告归档作为发布证据。

### S5 灰度发布

- 版本策略:内核锁版;领域包独立版本化(`@<industry>/pack-x.y.z`);升级 = 新领域包版本 + 老 kernel,先评测后切。
- 灰度:影子/小流量先行(观察 OTel trace),rainbow 式切流;审批挂起/恢复在小流量环境实测。

**DoD**:首个真实用户小流量无 P0/P1 事故;审批链路可用性验证。

### S6 运营闭环(回灌)

- 线上会话抽样 → OTel ingest 推 ai-evo → 周度人工评审失败轨迹;
- 失败案例修复后**沉淀回 golden set**(回归防复发);
- "agent 重复犯同一错误"→ 新增规则/Skill 条目(Cursor 同款判据);行为问题考虑微调,知识问题补 knowledge,**顺序不可反**。

**DoD**:golden set 月度增长;同一失败模式不复发。

## 2. 领域包模板(packs/_template)

```
packs/<industry>/
├── package.json          # name: @<industry>/pack, dsh.bundle → cordis.patch.yml
├── cordis.patch.yml      # 注册:tool 插件 / services / skills 源 / preset
├── profile.yml           # 继承 dsh-base,叠加本包 bundle 与 L1 基座 bundles
├── persona.md            # 角色与全局硬约束(system-prompt section)
├── skills/               # SOP 编码:每个 <name>/SKILL.md + scripts/ + references/
├── tools/                # 行业 tool 插件源码(defineTool)
├── knowledge/            # 领域语料元数据 + 检索配置(本体走 knowledge 插件)
├── policies/             # permission-presets / approval policy / guard 配置
├── evals/
│   ├── golden/           # golden cases(格式与 ai-evo Excel 字段对齐,见 07)
│   ├── validators/       # 终态断言脚本(file_assert / http_assert 对齐)
│   ├── trajectories/     # 轨迹断言(工具序列)
│   └── threshold.yml     # 门禁阈值(与 ai-evo 门禁配置同源)
└── hitl.yaml             # 升级触发器(高风险动作 / 失败阈值 / 不可逆操作)
```

## 3. 待讨论的开放问题

1. **第一个行业选哪个?** 决定 golden set 形态(文档型/交易型/对话型)与 tool 集优先级。
2. **领域包分发形态**:私有 pnpm registry / git repo 直装 / DSH plugin_manager?建议先 git repo + 锁 tag。
3. **governance 插件**:基于社区 dsh-tool-permission fork 改,还是自研 vendor 进基座层?倾向:自研最小实现(fail-closed、 deny 不可绕过、按 pack 声明),避免第三方依赖。
4. **knowledge 插件后端**:NAS 上已有 WeKnora(知识库 RAG,容器在跑)——v0 直接对接 WeKnora API?还是自建 pgvector?倾向 WeKnora 起步,ai-evo 恰好有 RAG 检索评测类型可闭环验收。
5. **本地 judge 还是平台 judge**:内环只做确定性断言(快、免费),judge 全部推 ai-evo?还是内环也允许经 litellm-gateway 调小模型 judge?倾向前者,内环确定性优先。
6. **轮数/预算守卫**:DSH 无内置 turn budget——基座层补一个 `agent/turn-stopping` 策略插件(默认 max steps + token 预算),归 governance 管。是否同意?
7. **多行业隔离**:preset `isolate` realm 的使用粒度(每行业一个 realm?每客户一个 realm?)。
