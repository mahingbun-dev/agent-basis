# 提示词注册表对账清单(ps-v2-registry-ledger)

> 生成:2026-11-11(T1.3)｜ 配套:计划书 [plans/2026-11-11-提示词工作室全景化改造计划.md](plans/2026-11-11-提示词工作室全景化改造计划.md) §6 T1.3、测试计划 [ps-v2-test-plan.md](ps-v2-test-plan.md) §3 T1.3。
>
> 本清单是**提示词注册表的对账真值**:仓库实际提示词源逐条(文件:行号)登记,与
> `packages/prompt-studio/src/registry.ts` 的 `PROMPT_REGISTRY_ENTRIES` 互相锁住——
> `tests/registry.test.ts` 维持「本清单 ↔ 注册表条目 (id, 层, 型别) 集合」双向相等断言,
> **删条目/改型别/漏登记都会打破相等**。行号锚 2026-11-11 实测自本 worktree
> (分支 `feat/prompt-studio-v2`,T1.2 合入后)。

## 分型判据(型别枚举闭合,与测试分型断言一一对应)

| 型别 | 判据 | 对账方式 |
| --- | --- | --- |
| patch 值型 | 值在 patch/包文件里,结构定位可反引读回 | 锚点在场 + 反引值非空(块标量经独立反引函数) |
| 行锚点只读型 | 行在场但提示词文本由上游插件运行时生成 | 裸行在场 + 条目型别=只读 + 写链路 fail-closed 拒写明示 |
| 运行时注入型 | `ctx.systemPrompt.section` 动态注入,无静态全文 | 来源代码锚点在场 + section 元数据(name/order) |

## 对账清单(14 条:preset 层 8 / 领域层 4 / 运行时层 2)

| id | 层 | 型别 | 来源插件/包 | 定位(文件:行号) | 红线 |
| --- | --- | --- | --- | --- | --- |
| preset.standard.persona | preset 层 | patch 值型 | @deepseek-ai/dsh-persona | profiles/eterna-web/cordis.patch.yml:288 | required(eterna.red-lines.standard) |
| preset.standard.agent-instructions | preset 层 | patch 值型 | @deepseek-ai/dsh-agent-instructions | profiles/eterna-web/cordis.patch.yml:292 | exempt |
| preset.standard.plan-mode.section | preset 层 | patch 值型 | @deepseek-ai/dsh-plan-mode | profiles/eterna-web/cordis.patch.yml:331-342 | exempt |
| preset.standard.time-context | preset 层 | 行锚点只读型 | @deepseek-ai/dsh-time-context | profiles/eterna-web/cordis.patch.yml:293-294 | exempt |
| preset.cordis.persona | preset 层 | patch 值型 | @deepseek-ai/dsh-persona | profiles/eterna-web/cordis.patch.yml:149-150 | required(eterna.red-lines.standard) |
| preset.cordis.agent-instructions | preset 层 | patch 值型 | @deepseek-ai/dsh-agent-instructions | profiles/eterna-web/cordis.patch.yml:154 | exempt |
| preset.cordis.plan-mode.section | preset 层 | patch 值型 | @deepseek-ai/dsh-plan-mode | profiles/eterna-web/cordis.patch.yml:188-199 | exempt |
| preset.cordis.time-context | preset 层 | 行锚点只读型 | @deepseek-ai/dsh-time-context | profiles/eterna-web/cordis.patch.yml:155-156 | exempt |
| domain.event-planning.persona-prefix | 领域层 | patch 值型 | @event/pack | packs/event-planning/cordis.patch.yml:12-17 | required(eterna.red-lines.standard) |
| domain.event-planning.persona-md | 领域层 | patch 值型 | @event/pack | packs/event-planning/persona.md:1-31 | required(eterna.red-lines.standard) |
| domain.industrial-analysis.persona-prefix | 领域层 | patch 值型 | @industrial-analysis/pack | packs/industrial-analysis/cordis.patch.yml:12-19 | required(eterna.red-lines.industrial-analysis) |
| domain.industrial-analysis.persona-md | 领域层 | patch 值型 | @industrial-analysis/pack | packs/industrial-analysis/persona.md:1-34 | required(eterna.red-lines.industrial-analysis) |
| runtime.memory.index-section | 运行时层 | 运行时注入型 | @eterna/memory | packages/memory/src/tools.ts:41,47,64 | exempt |
| runtime.glue.memory-plugin | 运行时层 | 运行时注入型 | @eterna/glue | packages/glue/src/plugins/memory-plugin.ts:15,27 | exempt |

## 逐条注记

### preset 层(profiles/eterna-web/cordis.patch.yml,430 行)

- **persona×2**:`preset-standard` 行 `plugins[id=persona].config.prefix` 是**裸标量**
  (:288,T7 persona-patch 既有写回落点);`preset-cordis` 行是 **`>-` 折叠块标量**
  (:149-150)。两处当前同文(`You are a coding agent powered by the {{model}} model.`,
  反引 54 字节)——测试互证裸标量与块标量反引一致。
- **agent-instructions×2**:两预设均为 `maxBytes: 65536` 数值配置(:154/:292)——
  指令链(AGENTS.md 等)渲染字节上限,非提示词文本;与 `MAX_PERSONA_BYTES=65536`
  口径交叉钉住。
- **plan-mode.section×2**:`|` 多段字面块(:188-199 / :331-342),六段 plan 模式
  系统提示;编辑时标注「上游升级可能覆盖」风险(计划书 §3)。
- **time-context×2**:两预设均为**无 config 裸行**(:155-156/:293-294)——上游
  `@deepseek-ai/dsh-time-context` 的 config 面只有调度项 `refreshIntervalMs`/
  `timeZone`,提示词文本每次注入时运行时生成,**无 patch 值亦无写回落点**。
  按测试计划 §9.7 口径登记为行锚点只读型:写链路 fail-closed 拒写并明示
  「该条目由上游插件生成,无 patch 写回落点」,不造写回假象(与计划书
  「全景查看+全部可编辑」表述存在事实出入,只读口径以测试计划为准)。

### 领域层(packs/{event-planning,industrial-analysis})

- **personaPrefix×2**:`system-prompt` 行 `config.personaPrefix`,均为 `>-` 折叠
  块标量(块头 :14,内容 :15-17 / :15-19)——领域身份 + 红线英文转述。
- **persona.md×2**:领域 persona 全文基准(角色/语气/全局硬约束;06 号 SOP S1
  分诊),整文件值。**红线事实(2026-11-11 实测)**:event-planning persona.md 含
  标准三条红线锚点(预算超支/不得代付/比选中立,过 `RED_LINE_RULES`);
  industrial-analysis persona.md 自有四条红线(达梦只读/只经 MCP/R2 确认/deny
  优先),**不含**标准三条 CJK 锚点——其条目绑定独立规则集
  `eterna.red-lines.industrial-analysis`(规则本体 T1.6 落地,注册表先钉绑定)。
- 当前**未见运行时注入 persona.md 的代码**(pack 注释「由组合层注入」未找到
  装配实现);运行时生效面是 personaPrefix 行。persona.md 按文件真值基准登记,
  供红线交叉钉住与 T1.6/T2.5 对账。

### 运行时层(ctx.systemPrompt.section 动态注入)

- **runtime.memory.index-section**:memory 包的记忆索引 section——元数据
  `MEMORY_INDEX_SECTION_NAME='memory:index'`(tools.ts:41)、`order 9000`
  (tools.ts:47)、`ctx.systemPrompt.section(section)` 挂载点(tools.ts:64);
  文本装配时从 M2 记忆动态构建(index-builder.ts,≤500 token 渐进披露),
  无静态全文。T2.6 自管改造样板。
- **runtime.glue.memory-plugin**:glue 的 eterna-memory 插件——
  `inject: { systemPrompt: true }`(memory-plugin.ts:15)经
  `attachMemory(dshHost(ctx), …)`(:27)把 memory:index section 挂进宿主,
  是同一 section 的组合层装载点。

## 红线豁免语义(T1.3(b)4)

- **required(6 条)**:全部 persona 类条目(两预设 persona、两包 personaPrefix
  与 persona.md)——写链路必检红线锚点,防「编辑把 safety rails 删掉」。
- **exempt(8 条)**:time-context×2、plan-mode.section×2、agent-instructions×2、
  运行时 section×2——非 persona 条目不做红线检查,防止 T1.6 把 `RED_LINE_RULES`
  错配到全部条目。
- required 条目带规则集 id:`eterna.red-lines.standard` = `validator.ts`
  `RED_LINE_RULES`(锚点对齐 event-planning persona.md);industrial-analysis
  两条目绑定 `eterna.red-lines.industrial-analysis`(T1.6 落地规则本体)。

## 互锁机制

`packages/prompt-studio/tests/registry.test.ts`:

1. 解析本文件上表 → (id, 层, 型别) 集合,与 `PROMPT_REGISTRY_ENTRIES` **双向相等**
   (标签映射取 `LAYER_LABELS`/`ENTRY_KIND_LABELS` 单一来源);
2. 逐条目对**仓库真文件**核对锚点(行在场 + 行内容含锚点片段)并按型别分判据
   (patch 值型反引值非空/行锚点只读型裸行在场 + 拒写明示/运行时注入型代码锚点在场);
3. `registryInvariants()` 钉条目模型完整性(id 唯一、枚举闭合、字段齐备、红线
   required⇔规则集绑定)。

上游升级/文件重构导致行号漂移时,本清单与测试同时红——更新二者即完成再对账。
