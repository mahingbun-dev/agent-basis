# 10 - dsh-evolve 受控自进化 详细设计(v1.0)

> 状态:详细设计,待评审实现。上游:[[09-RSI自进化机制设计]](机制与铁律)、[[07-评测体系-ai-evo对接与本地eval插件]]、[[08-基座插件体系与总体架构]]。
> 2026-11-03 完成现实核实(DSH skill 机制 / ai-evo 门禁能力 / WeKnora schema),五个开放问题全部落为决议(§0)。

## 0. 决议记录(问题 → 决议 → 核实证据)

| # | 议题 | 决议 | 核实证据 |
|---|---|---|---|
| D1 | reflector 模型 | **全可配置,不写实;默认 Flash**(用户拍板) | 配置形状见 §1;DSH `ctx.llm` + settings 表单原生支持 |
| D2 | ACE 条目化落点 | **SKILL.md 正文条目化**,frontmatter `metadata.evo` 承载计数器,保持 pack 形态 | skill-filesystem README:**catalog/body 生命周期分离,"every load re-reads the current file"→ 编辑 body 无需版本化/缓存失效,delta 下一轮加载即生效**;frontmatter 可选 `metadata` 自由字段;格式限目录包 `<name>/SKILL.md` 或扁平 `<name>.md`,**顶层 only、不嵌套发现**(pack skills 必须扁平摆根级);roots 优先级 project-dsh(100) > project-agents > custom > user |
| D3 | held-out 门禁集 | ≥30 条、季度轮换、与 golden 物理分离;Phase 1 用 golden 随机留出 20% 过渡 | ai-evo 无原生 held-out 轮换 → 用**三个数据集 + 三个门禁任务**实现;aievo-cli:`run task --wait` 退出码 0 通过/1 不达标/2 错误;`datasets upload` 支持程序化换血 |
| D4 | WeKnora 时效能力 | **supersession 索引建在 dsh-knowledge,WeKnora 仅作检索基底** | WeKnora v0.8.3 实测 schema:knowledges/chunks/**chunk_revisions**(修订链雏形)/audit_logs/temporary_documents(metadata JSON),**无任何 bi-temporal 字段**;API `/api/v1`(JWT/APIKey),KB 更新后需显式重解析端点。**→ 2026-11-03 晚更新**:知识层改为可插拔双后端,默认 `wiki-local`(markdown wiki+SQLite 混检,git 版本化),bi-temporal 简化版改由 **wiki frontmatter(status/superseded_by)+changelog+git 历史**承载,与 RSI 废弃阶段共用语义;storage-domain 索引仅保留为 WeKnora 后端的 sidecar 补充。见 [[11-知识插件-dsh-knowledge可插拔设计]] |
| D5 | 授权矩阵落地 | 按 09 §3 矩阵,每级绑定 DSH 原生强制点 | L2/L3 提案走 `ctx.approval` waterfall;插件安装走 **plugin_manager:每个动作需 danger-full-access 或逐次审批 + pnpm build-script 审批(approvedBuilds)+ compatibility.json 豁免需 acceptRisk 显式确认**;L4 规则文件置于 pack 的 stable 产物,运行时只读,变更走 git PR + 人签发 |

**边界澄清(核实中发现的坑)**:WeKnora 自带 `memory_subjects/memory_items` 跨会话记忆(Lite,含 extract 调度)——**不采用**,避免双记忆源不一致;WeKnora 对我们只是"带权限与解析管线的检索基底",记忆统一归 dsh-memory(storage-domain),知识时效归 dsh-knowledge 的 supersession 索引。

## 1. 配置设计(不写死任何模型)

dsh-evolve 的 Config schema(Schemastery,自动获得 settings 表单;领域包/部署只改配置不改代码):

```yaml
# dsh-basis 对 dsh-evolve 的默认配置(profile patch 可覆写)
dsh-evolve:
  models:                        # 所有模型角色可配置;provider+model 引用 ctx.llm catalog
    reflector:  { provider: deepseek, model: deepseek-flash }    # 归因/打标/整固抽取,默认 Flash
    curator:    { provider: deepseek, model: deepseek-flash }    # delta 起草
    reviewer:   { provider: deepseek, model: deepseek-pro }      # 高危提案复核建议(仅建议,不替代人审)
  trigger:
    sessionEndReflect: true      # 会话结束快速反思
    weeklyReport: { cron: "0 9 * * 1" }   # 周度归因报告(schedule 承载)
    repeatThreshold: 2           # 同一错误模式 ≥N 次才立项(Cursor/Anthropic 准则)
  gates:
    local:    { subset: smoke, timeoutMin: 10 }
    aievo:
      baseUrl: ""                # 部署时填;API Key 走 credentials 引用,不进配置
      credentialsRef: "aievo-ci-key"
      tasks: { release: "task-release-gate", admission: "task-admission-gate", heldout: "task-heldout-gate" }
      timeoutMin: 120
  promotion:
    autoPromoteScopes: [memory.project]   # 允许全自动晋升的对象白名单(其余人审)
    requireHumanApproval: [skill, knowledge, rule, memory.user, memory.org]
  deprecation:
    promptAuditCron: "0 9 1 * *"  # 月度 prompt-audit 扫描
    confidenceHalfLifeDays: 90    # M2 记忆置信衰减
  ledger: { backend: storage-sqlite }
```

## 2. 信号采集明细(dsh-observe → 信号表)

storage-domain 记录 `evolve_signal`:

```
evolve_signal {
  id, ts, pack_id, session_id?
  kind: feedback_low | approval_modified | approval_rejected | eval_fail | drift | audit_scan
  ref: (指向 feedback 事件 / approval/decided 事件 / aievo 任务行 / 指标快照)
  payload: { summary, tags[], trajectory_hash? }
}
```

采集点(全部已存在,零新机制):feedback(messageFeedback 服务)、approval/* 事件(interact 传)、eval 失败(dsh-evals + aievo-cli)、漂移(observe 指标快照 diff)、prompt-audit 扫描结果(§7)。

## 3. reflector 流水线(job,sleep-time)

```
输入: 窗口期内 evolve_signal + 对应 session log(session-query 检索)
步骤:
 1. 聚合去重 → 按 trajectory_hash 聚类同一失败模式
 2. MAST 打标(3 类 14 模式 rubric,reflector 模型):spec 缺陷 / agent 间失配 / 验证缺失 + 自定义行业模式
 3. 重复度统计:同一 (模式, 根因) 计数 ≥ repeatThreshold 才立项
 4. 归因分流(Devin 口诀):环境坏/上下文偏 → 建议"重启+全量指令",不生成知识提案
 5. 输出:候选提案清单(交 curator) + 周度归因报告(人读,channels 推送)
```

调度:会话结束钩子(轻量,只做打标落库)+ schedule 周任务(重量,聚类归因报告)。两者都过 governance 审计。

## 4. curator:四类 delta 格式规范

### 4.1 Skill delta(ACE 条目化 SKILL.md)

SKILL.md 约定(向 ACE 对齐,保持人可读):

```markdown
---
name: contract-review
description: ...(what+when,触发词维护重点)
metadata:
  evo:
    entries:
      - { id: "S-contract-review-001", helpful: 12, harmful: 0, updated: 2026-11-01, origin: "case-042+case-047" }
      - { id: "S-contract-review-002", helpful: 3,  harmful: 2, updated: 2026-10-20, origin: "case-013" }
---
## 步骤
<!-- E: S-contract-review-001 -->
先读取合同模板识别标准条款位……(条目正文,XML 注释锚点定位)
<!-- /E -->
## 注意
<!-- E: S-contract-review-002 -->
若对方为格式合同方,优先检查……
<!-- /E -->
```

- **条目锚点**用 HTML 注释包裹(对人无扰,对 packctl 可解析);计数器在 `metadata.evo.entries`——DSH 原生 `metadata` 字段,不侵入标准。
- **delta 操作集**(提案即操作列表,非重写):`add_entry / update_entry(改写正文) / bump_counter(helpful/harmful) / deprecate_entry(移入文末"已废弃"节,保留 30 天) / merge_entries(语义去重后合并)`。
- harmful ≥3 的条目由 deprecation 扫描自动转 `deprecate` 提案(L2 人审确认)。
- **生效机制**:body 每次加载重读(核实结论),合并后**下一次会话即生效**,零重启零缓存失效。

### 4.2 Knowledge delta(WeKnora 操作提案)

```
knowledge_proposal {
  action: upload_new | supersede | tag_stale | propose_delete
  doc: { kb_id, source_url, version, title }
  supersedes: doc_version_id?       # 触发 supersession 索引 close 窗口
  evidence: [signal_id...]          # 哪些失败轨迹证明旧知识有害/过时
  approval: L3(人裁决,Glean 模式)
}
```

supersession 索引(dsh-knowledge,storage-domain 表 `knowledge_timeline`):`doc_version_id, kb_id, source_url, version, valid_at, invalid_at?, superseded_by?, created_at`。检索路径:WeKnora 召回 → 按 `knowledge_timeline` 过滤 `invalid_at IS NULL`(开放窗口)→ 返回带版本与出处。WeKnora 内的物理删除/更新走其 API 后,索引同步 close;删除传播 = WeKnora 重解析/删除端点 + 索引关闭 + 下次 prompt-audit 验证无残留。

### 4.3 Rule / hitl diff 与 4.4 Memory 修正

- rule/hitl diff:统一 `git diff` 形态作用于 `packs/<industry>/policies|hitl.yaml`,**L4**:PR + 人签发;governance 规则文件在 stable 产物中只读(内核 approval waterfall 消费,agent 无写路径)。
- memory 修正提案:`memory_update{subject, key, new_content, supersedes_key?}`,走 dsh-memory 现有工具与审批策略;M1 全自动(M2 除外,08 已定)。

## 5. 验证流水线(三级,生成器/评估器异构)

```
delta 提案
 ├─ G0 lint(packctl):Cordis 纪律 / SKILL.md 结构 / 条目锚点完整 / 引用文件存在
 ├─ G1 本地(dsh-evals,quarantine 实例):
 │    candidate pack checkout 到隔离 profile(不复用 stable 目录,实例级隔离=Cordis"事故域")
 │    跑 golden smoke 子集 + 本变更触发的定向 cases;含会话级回归(变更前后对比)
 └─ G2 ai-evo 三层门禁(aievo-cli --wait,退出码 0 才放行):
      release-gate(发布集全量):门禁指标 = verification_pass_rate + trajectory_match_rate + 任务均分
      admission-gate(准入集,canary 标记):防刷分的第一道独立样本
      heldout-gate(held-out 集,≥30 条季度轮换,Phase1=golden 留出 20%):终审
      附带安全回归探针:投毒探针(记忆写入)、越权探针(R2/R3 触发率)、注入探针——任一退化即红
```

- 轨迹断言直接用 ai-evo 原生四模式(strict/unordered/subset/superset)+ forbidden 调用(如 `forbidden: send_email`)——07 的 golden case 字段对齐为此格式。
- **防作弊纪律**:被测对象(candidate pack)永接触不到 held-out 内容与 judge prompt;judge 配置走 ai-evo 裁判治理(快照/消毒/金丝雀);监控指标不回灌为改进目标(只做门禁)。

## 6. 发布与进化账本

- 三态流转:`quarantine(隔离试跑)→ candidate(过 G0-G1)→ stable(过 G2 + 人审合并)`,stable 只读。
- 版本:pack git tag `@<industry>/pack-x.y.z`(semver:delta=patch,新 skill=minor,规则变更=major);provenance 写进 tag message 与账本。
- 账本 record(storage-domain,`evolve_ledger`):

```
{ id, ts, pack, kind: skill|knowledge|rule|memory
  signal_ids[], mast_label, proposal_ref(diff)
  verification: { local: report_ref, aievo: {task, exit_code, metrics} , probe: pass|fail }
  release: { from_version, to_version, tag, approver }
  effect: { before_metrics, after_metrics, reviewed_at }   # 发布后 T+7d 回填
  status: proposed|verified|approved|released|superseded|rolled_back }
```

- 回滚 = git revert 到上一 stable tag + 账本记 `rolled_back`;skill 文件回滚即时生效(重读机制)。

## 7. 废弃机制实现

| 资产 | 扫描器 | 动作 |
|---|---|---|
| Skill 条目 | 月度 prompt-audit job:引用不存在文件 / harmful≥3 / 90 天零 helpful / 与新条目语义相似度 >0.9(合并) | `deprecate_entry` 提案(L2);归档节保留 30 天后物理移除 |
| Knowledge | 源变更信号(WeKnora webhook/轮询)+ TTL 分档(政策类随发布失效/事实类窗口失效,FreshLLMs 口径) | `tag_stale/supersede` 提案(L3);索引 close 窗口;传播删除 |
| Rule/hitl | 反向证据:零命中且曾误触发 | diff 移除(L4 人签发) |
| M2 记忆 | 置信半衰期(90d,可配)+ 整固合并 | 应用逆闭包或 close 窗口(审计留档) |

**"不影响 agent"的技术保证**:所有检索入口(memory_search / knowledge_search / skill catalog 注入)统一过滤开放窗口(`invalid_at IS NULL` / 非 deprecated 条目)——过期内容物理留档、逻辑不可见。

## 8. 端到端时序(一次 skill delta 全流程)

```mermaid
sequenceDiagram
    participant U as 用户/SME
    participant AG as Agent(会话)
    participant OB as dsh-observe
    participant RF as reflector job
    participant CU as curator
    participant EV as dsh-evals
    participant AI as ai-evo(aievo-cli)
    participant PK as pack 仓库(git)
    AG->>OB: approval 被改 + feedback 低分(信号落库)
    Note over RF: 周任务:聚类→MAST 打标→同因≥2 次→立项
    RF->>CU: 候选提案(refine S-contract-review-002)
    CU->>CU: 生成 delta(add/update/bump 计数器)
    CU->>EV: G0 lint + G1 quarantine 实例试跑
    EV->>AI: G2 三层门禁(--wait)
    AI-->>EV: exit 0(逐阈值通过)
    EV->>U: PR 请求合并(diff+验证报告链接)
    U->>PK: approve & merge → stable tag
    Note over AG: 下一次会话加载 skill body 即读到新条目(重读机制)
    PK->>OB: 账本回填 release+provenance;T+7d 效果对比
```

## 9. 实现里程碑

| 里程碑 | 内容 | 依赖 | 预估 |
|---|---|---|---|
| M-E0 | 账本+信号表(storage-domain)+ aievo-cli 连通验证(baseUrl/Key 待用户给) | ai-evo 访问入口 | 3 天 |
| M-E1 | reflector job(MAST rubric + 聚类归因报告)+ 周报推送 | observe、schedule | 1 周 |
| M-E2 | curator skill-delta(G0/G1)+ PR 人审流 | packctl、dsh-evals | 1-2 周 |
| M-E3 | G2 三层门禁任务搭建(发布/准入/held-out 数据集)+ 安全探针集 | ai-evo 账号、golden set v1 | 1 周(与 S0 并行) |
| M-E4 | knowledge supersession 索引 + 废弃扫描器 | dsh-knowledge(WeKnora 连通) | 1 周 |
| M-E5 | 自动晋升白名单(M1 记忆)+ 效果回填 | 全部 | 3 天 |

## 10. 依赖与风险

1. **ai-evo 访问入口未定**(老问题):baseUrl + API Key(tasks:run/read、datasets:write)是 M-E0 的硬依赖;连通后需实测 aievo-cli 与平台的 API Key scope 是否齐备(文档已列,未实测)。
2. **WeKnora API 细节待 token 实测**:文档检索/删除/重解析端点的鉴权形态(JWT vs APIKey)与 web 文档描述需连通确认;schema 结论已从容器迁移脚本核实,风险低。
3. **skill-filesystem 不做嵌套发现**:pack 的 skills 必须扁平摆根级(`<name>/SKILL.md` 或 `<name>.md`),packctl lint 强制;多 provider 顺序查询有性能串扰(skill registry README),pack 用 customSkillDirs 单根收敛。
4. **held-out 轮换的 SME 成本**:季度 ≥30 条新增是持续人力承诺;Phase 1 用 golden 留出 20% 过渡(已在门禁任务中物理分离)。
5. **DSH pre-stable**:dsh-evolve 挂 schedule/jobs/storage-domain/feedback 四个 seam,升级跟随 upgrade-guide;CI 里对这四个接口做冒烟测试钉住(08 §8 风险 1 的落实)。
