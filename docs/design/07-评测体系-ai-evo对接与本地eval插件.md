# 07 - 评测双轨体系:ai-evo 平台对接 + 本地轻量 eval 插件

> 状态:设计稿 v0.1。定位:补齐 DSH 的评测缺口(见 [[04-DSH源码设计笔记]] §12),支撑 SOP 的 S3(本地内环)与 S4(平台门禁)。原则与业界一致:**确定性校验优先,评终态而非过程,judge 需治理**。

## 1. 双轨分工

| | 本地 eval runner(L1 基座层插件) | ai-evo 平台(NAS 已部署) |
|---|---|---|
| 使用场景 | 开发者内环:改动 skill/persona/tool 后必跑 | CI 门禁 / 夜间回归 / 发布验收 / 线上抽样 |
| 规模 | golden 子集 ~20 条,<10 分钟 | 全量 30-100+ 条,含裁判/仿真/红队 |
| 判定 | **确定性优先**:终态断言 + 轨迹断言;可选轻量 judge | 裁判引擎(Claude Code / **DeepSeek Harness 裁判**)+ 终态校验器 + 轨迹匹配 + 裁判治理 |
| 成本 | 无裁判成本(不调大模型或走 litellm 小模型) | 裁判模型成本(litellm-gateway 统一出网) |
| 产物 | report.md + sessions.jsonl(可上传) | 评分分布、趋势、A/B、门禁判定、审计留痕 |

**分工原则:本地管"快",平台管"全、准、有证据"。两轨共用同一份 golden set 与同一套断言语义,本地是平台的子集。**

## 2. ai-evo 平台能力盘点(NAS 实测,容器 ai-evo-api/worker/executor + postgres + redis,模型经 litellm-gateway:4000)

与本项目直接相关的能力(来自平台内置《使用文档》):

- **评测类型**:AI 裁判员 / Agent 长会话(导入会话评,不调被测模型)/ 一致性 / 成功率 / RAG 检索(6 指标)/ 二分分类 / 响应耗时 / 插件评测 / 安全红队(双通道)/ **仿真评测**(persona 用户模拟器 × 被测 Agent 多轮对话 + 环境重置 + 故障注入[工具超时/错误响应/污染数据/矛盾指令/上下文超长] + trials 1-5 = pass^k;**无终态校验器的仿真不允许保存**——平台强制 end-state verification 纪律)。
- **终态校验器**(M2+):脚本 / `db_assert` / `file_assert` / `http_assert` 回调断言——与 Anthropic"评终态"原则同构,**领域包 evals/validators 直接按这四类口径写,双轨语义一致**。
- **轨迹匹配**(M2+):agent 会话工具序列断言,聚合出 `trajectory_match_rate`,可挂门禁——正好对应我们关心的"工具调用正确性/顺序"。
- **裁判引擎**:Claude Code Agent 裁判 + **DeepSeek Harness 裁判配置**(API 地址/Key/协议[DeepSeek 官方/OpenAI 兼容/Anthropic Messages]/Provider/模型/Profile/超时/MaxTokens),M8 起支持与 Claude Code **双引擎对拍**;裁判治理:配置快照可追溯、输入默认定界消毒、金丝雀探针自检"裁判可被欺骗"。
- **数据导入**:Excel(user_input/answer 标准字段,最多 20 扩展字段,支持中文列名);Agent 会话文件(.jsonl/.json,Claude Code / Langfuse 格式,一个会话=一条数据);**OTel ingest API**:`POST /api/v1/ingest/otel-traces?dataset_name=...`(OTLP/HTTP JSON、Phoenix、Langfuse 三形态自动识别)——**DSH 的 `telemetry/otel` 插件(SessionLogReporter)可以直接对接**。
- **门禁配置**:任务级阈值(任务均分/行通过率/维度均分/**校验通过率/轨迹匹配率**),判定方式全部通过或任一通过;**CLI 与 CI 集成(评测即门禁)**能力在文档 §3 有专门章节。
- **被测通道**:仿真评测的被测 Agent 指令支持 **Claude Code / DeepSeek 通道**——与我们的 DSH 栈原生同构。

## 3. 本地轻量 eval 插件设计(dsh-evals,L1 基座层)

### 3.1 形态与运行方式

- 形态:DSH 插件 + 独立 CLI(不进 agent 运行时路径,避免污染被测会话;以工具形式提供 `pnpm dsh-evals run --pack packs/<industry> --subset smoke`)。
- 驱动:**DSH Python SDK**(repo `python/`,BENCHMARK.md 即此用法)按 case 起 session(`dsh --profile <pack>` 子进程),订阅 session 事件流(66 种事件,含 `tool/call|result`、`approval/*`、`compaction/*`),采集完整 session log。

### 3.2 golden case 格式(与 ai-evo 字段对齐,可互导)

```yaml
# packs/<industry>/evals/golden/case-001.yaml
id: case-001
user_input: |
  (真实任务输入)
answer: |          # 参考答案(对应 ai-evo Excel answer 列,可选)
  ...
tags: [合同审查, 高危]          # 对应 Excel 扩展字段
final_state:                   # → ai-evo 终态校验器同口径
  file_assert: { path: "out/report.docx", contains: ["违约金", "第12条"] }
  # http_assert / db_assert / script 四选多
trajectory:                    # → ai-evo 轨迹断言同口径
  must_call: [contract_search, risk_scan]
  must_not_call: [send_email]              # 红线:未获批不得外发
  max_steps: 30
  approval_flow: [risk_scan]               # 期望触发审批的动作
budget: { max_tokens: 200000, max_cost_cny: 1.0, cache_hit_rate_min: 0.7 }
judge:                          # 可选,仅平台侧默认启用;本地默认关
  rubric: |
    (SME 手写评分标准)
```

### 3.3 判定与报告

- 每条 case 输出:pass/fail(终态优先)、轨迹判定、轮数、token/成本、缓存命中率、session log 路径。
- 聚合 report.md:通过率、分 tags 通过率、失败案例 top 原因分类(工具调用失败/知识缺失/流程偏离/超预算)、与上一版的 diff。
- **失败会话自动存档**,一条命令转成 ai-evo 会话数据集格式(jsonl)供平台复评。

### 3.4 非目标(刻意不做)

- 不做裁判 UI/统计/趋势(平台职责);不做并发调度与排队(平台 worker 职责);不做红队样本库(平台已有)。
- 不在 agent 会话内暴露评测工具(避免被测 agent 自评)。

## 4. 三条对接通道(S3→S4 的数据流)

```
[通道A 会话导入] 本地 runner 的 sessions.jsonl → ai-evo「会话文件导入」
                → Agent 长会话评测(裁判)+ 终态校验 + 轨迹匹配 + 门禁
[通道B OTel]    DSH telemetry/otel(SessionLogReporter)→ POST /api/v1/ingest/otel-traces
                → 线上会话抽样进平台(S6 运营闭环复用同一通道)
[通道C 仿真]    ai-evo 仿真场景:persona 模拟器 × 被测 DSH agent(DeepSeek 通道)
                + 环境初始文件 + 终态校验器 + 故障注入,pass^3 → 发布门禁
```

模型接入约定:平台一切大模型调用经 litellm-gateway(NAS :4000);被测模型 = DeepSeek Flash/Pro(OpenAI 兼容接入),裁判模型经 DeepSeek Harness 裁判配置。**注意**:网关后模型名按部署约定(文档示例 `mimo-V2.6`),实际用什么裁判模型需要在平台「模型配置」里定——列入待办。

## 5. 落地顺序建议

1. **第 1 周**:golden set v1(30 条)+ 本地 runner 最小版(终态断言 file_assert + 轨迹 must_call)+ report;S0 Go/No-Go 用它跑。
2. **第 2 周**:ai-evo 通道 A 打通(会话导入 + Agent 长会话评测 + 门禁阈值);裁判配置定版(DeepSeek Harness 裁判,与 Claude Code 对拍一次基线)。
3. **S2 领域包开发期**:内环常规化;首次全量门禁演练。
4. **发布前**:通道 C 仿真场景(3-5 个核心流程 + 故障注入)+ 安全红队首跑。
5. **上线后**:通道 B 周度抽样评审,失败回灌 golden set。

## 6. 待确认问题

1. **ai-evo 访问入口**:api 容器未映射 host 端口——外部是通过 Synology 反代/内网 IP 直连?CLI 与 CI 需要一个稳定的 base URL 与账号(API Key 已支持,见平台「开发者设置」)。
2. 裁判模型定版:DeepSeek Harness 裁判用哪个 Provider/模型?与 Claude Code 对拍的结论留档。
3. golden case 的 `db_assert` 场景:行业系统如果没有可直连的测试库,终态校验是否统一降级为 file_assert/http_assert?
4. 仿真评测的用户模拟器 persona 卡片规范:与领域包 persona 的关系(平台 persona 是"用户",领域包 persona 是"agent",命名要区分)。
