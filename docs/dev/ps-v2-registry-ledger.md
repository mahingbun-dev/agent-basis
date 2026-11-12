# 提示词注册表对账清单(ps-v2-registry-ledger)

> 生成:2026-11-11(T1.3)｜ 配套:计划书 [plans/2026-11-11-提示词工作室全景化改造计划.md](plans/2026-11-11-提示词工作室全景化改造计划.md) §6 T1.3、测试计划 [ps-v2-test-plan.md](ps-v2-test-plan.md) §3 T1.3。
>
> 本清单是**提示词注册表的对账真值**:仓库实际提示词源逐条(文件:行号)登记,与
> `packages/prompt-studio/src/registry.ts` 的 `PROMPT_REGISTRY_ENTRIES` 互相锁住——
> `tests/registry.test.ts` 维持「本清单 ↔ 注册表条目 (id, 层, 型别) 集合」双向相等断言,
> **删条目/改型别/漏登记都会打破相等**。行号锚 2026-11-11 实测自本 worktree
> (分支 `feat/prompt-studio-v2`,T1.2 合入后);2026-11-12 随 persona 基线补
> 三红线锚点(两预设 persona 块标量化+红线段)重测行号。

## 分型判据(型别枚举闭合,与测试分型断言一一对应)

| 型别 | 判据 | 对账方式 |
| --- | --- | --- |
| patch 值型 | 值在 patch/包文件里,结构定位可反引读回 | 锚点在场 + 反引值非空(块标量经独立反引函数) |
| 运行时注入型 | `ctx.systemPrompt.section` 动态注入,无静态全文 | 来源代码锚点在场 + section 元数据(name/order) |

> **2026-11-11 用户裁定**:「工作室只展示拥有提示词文本的插件」。注册表只登记拥有
> 提示词文本/提示词参数的条目;纯运行时数据注入器(如 time-context 时钟读数,两
> 预设的无 config 裸行)不登记。原第三型「行锚点只读型」随 time-context 整体
> 移除登记而清除(型别/生效半径枚举与全部只读分支一并移除);下表 time-context
> 两行保留为「不登记」注记行,不计入对账(审计可追溯)。边界:agent-instructions
> (maxBytes 数值参数,但该插件本体是提示词注入器)与 T3.1 meta 元提示词条目保留
> ——它们拥有提示词语义。

## 对账清单(14 条:preset 层 6 / 领域层 4 / 运行时层 2 / 元提示词层 2;2026-11-11 裁定后)

| id | 层 | 型别 | 来源插件/包 | 定位(文件:行号) | 红线 | 生效半径(T2.2) |
| --- | --- | --- | --- | --- | --- | --- |
| preset.standard.persona | preset 层 | patch 值型 | @deepseek-ai/dsh-persona | profiles/eterna-web/cordis.patch.yml:300-312 | required(eterna.red-lines.standard) | immediate-new-session |
| preset.standard.agent-instructions | preset 层 | patch 值型 | @deepseek-ai/dsh-agent-instructions | profiles/eterna-web/cordis.patch.yml:313 | exempt | immediate-new-session |
| preset.standard.plan-mode.section | preset 层 | patch 值型 | @deepseek-ai/dsh-plan-mode | profiles/eterna-web/cordis.patch.yml:352-363 | exempt | immediate-new-session |
| preset.standard.time-context | preset 层 | **不登记**(2026-11-11 用户裁定:工作室只展示拥有提示词文本的插件;原行锚点只读型行保留注记) | @deepseek-ai/dsh-time-context | profiles/eterna-web/cordis.patch.yml:314-315 | — | — |
| preset.cordis.persona | preset 层 | patch 值型 | @deepseek-ai/dsh-persona | profiles/eterna-web/cordis.patch.yml:149-164 | required(eterna.red-lines.standard) | immediate-new-session |
| preset.cordis.agent-instructions | preset 层 | patch 值型 | @deepseek-ai/dsh-agent-instructions | profiles/eterna-web/cordis.patch.yml:162 | exempt | immediate-new-session |
| preset.cordis.plan-mode.section | preset 层 | patch 值型 | @deepseek-ai/dsh-plan-mode | profiles/eterna-web/cordis.patch.yml:196-207 | exempt | immediate-new-session |
| preset.cordis.time-context | preset 层 | **不登记**(2026-11-11 用户裁定:工作室只展示拥有提示词文本的插件;原行锚点只读型行保留注记) | @deepseek-ai/dsh-time-context | profiles/eterna-web/cordis.patch.yml:163-164 | — | — |
| domain.event-planning.persona-prefix | 领域层 | patch 值型 | @event/pack | packs/event-planning/cordis.patch.yml:12-17 | required(eterna.red-lines.standard) | not-composed-anywhere |
| domain.event-planning.persona-md | 领域层 | patch 值型 | @event/pack | packs/event-planning/persona.md:1-31 | required(eterna.red-lines.standard) | not-composed-anywhere |
| domain.industrial-analysis.persona-prefix | 领域层 | patch 值型 | @industrial-analysis/pack | packs/industrial-analysis/cordis.patch.yml:12-19 | required(eterna.red-lines.industrial-analysis) | not-composed-anywhere |
| domain.industrial-analysis.persona-md | 领域层 | patch 值型 | @industrial-analysis/pack | packs/industrial-analysis/persona.md:1-34 | required(eterna.red-lines.industrial-analysis) | not-composed-anywhere |
| runtime.memory.index-section | 运行时层 | 运行时注入型 | @eterna/memory | packages/memory/src/tools.ts:41,47,64 | exempt | runtime-rebuilt |
| runtime.glue.memory-plugin | 运行时层 | 运行时注入型 | @eterna/glue | packages/glue/src/plugins/memory-plugin.ts:15,27 | exempt | runtime-rebuilt |
| meta.studio.ai-polish | 元提示词层 | patch 值型 | @eterna/prompt-studio | packages/prompt-studio/ai/polish.md:1-24 | exempt | not-composed-anywhere |
| meta.studio.ai-review | 元提示词层 | patch 值型 | @eterna/prompt-studio | packages/prompt-studio/ai/review.md:1-34 | exempt | not-composed-anywhere |

## 逐条注记

### preset 层(profiles/eterna-web/cordis.patch.yml,479 行)

- **persona×2**:两预设 `plugins[id=persona].config.prefix` 均为 **`>-` 折叠块标量**
  (`preset-cordis` :149-164 / `preset-standard` :300-312,T7 persona-patch 既有写回落点)。
  2026-11-12 起两处基线同文且**自含三条红线锚点**(首句 + 全局红线段:预算不超支/
  不代付/比选中立,反引 466 字节)——写链路红线校验要求新文本带锚点,基线先行示范,
  用户在基线上小改即可通过;测试互证两块标量反引一致。
- **agent-instructions×2**:两预设均为 `maxBytes: 65536` 数值配置(:162/:313)——
  指令链(AGENTS.md 等)渲染字节上限,非提示词文本;与 `MAX_PERSONA_BYTES=65536`
  口径交叉钉住。
- **plan-mode.section×2**:`|` 多段字面块(:196-207 / :352-363),六段 plan 模式
  系统提示;编辑时标注「上游升级可能覆盖」风险(计划书 §3)。
- **time-context×2**:两预设均为**无 config 裸行**(:163-164/:314-315)——上游
  `@deepseek-ai/dsh-time-context` 的 config 面只有调度项 `refreshIntervalMs`/
  `timeZone`,提示词文本每次注入时运行时生成,无 patch 值亦无写回落点。
  **2026-11-11 用户裁定后不登记**(工作室只展示拥有提示词文本的插件;time-context
  是纯运行时时钟数据注入器):两条目已从注册表整体移除登记(不是隐藏,是不登记),
  上表对应行保留「不登记」注记供审计追溯;原「行锚点只读型」型别与
  `readonly-upstream` 生效半径随之清除,live patch 里的裸行本身不动。

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

### 元提示词层(T3.1 新增:工作室 AI 能力自管,计划书 §4「吃自己的狗粮」裁定)

- **meta.studio.ai-polish / meta.studio.ai-review**:AI 润色/审核的元提示词
  本体(整文件值:`ai/polish.md`、`ai/review.md`)——AI 调用时经注册表读取面
  现读当前值作 system 消息(取值坐标 = `src/ai-service.ts`
  `AI_META_POLISH_ENTRY_ID`/`AI_META_REVIEW_ENTRY_ID`);改后经 R3 审批写回,
  下次 AI 调用即用新文。**不进入任何会话的系统提示组装**(会话快照回放按
  「无对应段落」跳过并记录)。AI 产出(建议稿/问题清单)永不直接生效
  (计划书 §5「不做 AI 自动生效」),生效走 T3.2 的「作为提案提交」R3 链路。

## 红线豁免语义(T1.3(b)4)

- **required(6 条)**:全部 persona 类条目(两预设 persona、两包 personaPrefix
  与 persona.md)——写链路必检红线锚点,防「编辑把 safety rails 删掉」。
- **exempt(8 条)**:plan-mode.section×2、agent-instructions×2、运行时 section×2、
  元提示词×2——非 persona 条目不做红线检查,防止 T1.6 把 `RED_LINE_RULES` 错配到
  全部条目。(原 time-context×2 随 2026-11-11 不登记裁定移出本清单。)
- required 条目带规则集 id:`eterna.red-lines.standard` = `validator.ts`
  `RED_LINE_RULES`(锚点对齐 event-planning persona.md);industrial-analysis
  两条目绑定 `eterna.red-lines.industrial-analysis`(T1.6 落地规则本体)。

## 互锁机制

`packages/prompt-studio/tests/registry.test.ts`:

1. 解析本文件上表 → (id, 层, 型别) 集合,与 `PROMPT_REGISTRY_ENTRIES` **双向相等**
   (标签映射取 `LAYER_LABELS`/`ENTRY_KIND_LABELS` 单一来源);
2. 逐条目对**仓库真文件**核对锚点(行在场 + 行内容含锚点片段)并按型别分判据
   (patch 值型反引值非空/运行时注入型代码锚点在场);
3. `registryInvariants()` 钉条目模型完整性(id 唯一、枚举闭合、字段齐备、红线
   required⇔规则集绑定)。

上游升级/文件重构导致行号漂移时,本清单与测试同时红——更新二者即完成再对账。
