# 提示词注册表对账清单(ps-v2-registry-ledger)

> 生成:2026-11-11(T1.3)｜ 配套:计划书 [plans/2026-11-11-提示词工作室全景化改造计划.md](plans/2026-11-11-提示词工作室全景化改造计划.md) §6 T1.3、测试计划 [ps-v2-test-plan.md](ps-v2-test-plan.md) §3 T1.3。
>
> 本清单是**提示词注册表的对账真值**:仓库实际提示词源逐条(文件:行号)登记,与
> `packages/prompt-studio/src/registry.ts` 的 `PROMPT_REGISTRY_ENTRIES` 互相锁住——
> `tests/registry.test.ts` 维持「本清单 ↔ 注册表条目 (id, 层, 型别) 集合」双向相等断言,
> **删条目/改型别/漏登记都会打破相等**。行号锚 2026-11-11 实测自本 worktree
> (分支 `feat/prompt-studio-v2`,T1.2 合入后);2026-11-12 随 persona 基线补
> 三红线锚点(两预设 persona 块标量化+红线段)重测行号;2026-11-14 随
> M-M1–M-M3 记忆改造(memory 登记读取面/glue 挂载点移位)重测运行时层行号;
> 2026-11-20 随上游 rc.5 合并(B13/H6)把 preset 层锚点改钉生产渲染源
> `docker/profile/cordis.patch.yml.template`(entrypoint 逐字落卷),并增
> `runtime.agent-loop`(v1 线 agent-loop 注入登记);同日 T17/R19 收口模板盲区:
> `prompt-scan` 扫描根纳入 `docker/profile`,`PROMPT_TEMPLATE_REGISTRATIONS`
> 逐 key 登记 super 模板四键(同文镜像)与 ACP 模板一键(见「模板键登记」节)。

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

## 对账清单(18 条:preset 层 6 / 领域层 4 / 运行时层 6 / 元提示词层 2;2026-11-11 裁定后,M-M1 T5 增 runtime.memory.search-prefix;35 号 A24 增 runtime.tasks.active-tickets;rc.5 B13 增 runtime.agent-loop;54 号 P8 增 runtime.adviser.discipline)

| id | 层 | 型别 | 来源插件/包 | 定位(文件:行号) | 红线 | 生效半径(T2.2) |
| --- | --- | --- | --- | --- | --- | --- |
| preset.standard.persona | preset 层 | patch 值型 | @deepseek-ai/dsh-persona | docker/profile/cordis.patch.yml.template:397-412 | required(eterna.red-lines.standard) | immediate-new-session |
| preset.standard.agent-instructions | preset 层 | patch 值型 | @deepseek-ai/dsh-agent-instructions | docker/profile/cordis.patch.yml.template:416 | exempt | immediate-new-session |
| preset.standard.plan-mode.section | preset 层 | patch 值型 | @deepseek-ai/dsh-plan-mode | docker/profile/cordis.patch.yml.template:461-472 | exempt | immediate-new-session |
| preset.standard.time-context | preset 层 | **不登记**(2026-11-11 用户裁定:工作室只展示拥有提示词文本的插件;原行锚点只读型行保留注记) | @deepseek-ai/dsh-time-context | docker/profile/cordis.patch.yml.template:417-418 | — | — |
| preset.cordis.persona | preset 层 | patch 值型 | @deepseek-ai/dsh-persona | docker/profile/cordis.patch.yml.template:207-224 | required(eterna.red-lines.standard) | immediate-new-session |
| preset.cordis.agent-instructions | preset 层 | patch 值型 | @deepseek-ai/dsh-agent-instructions | docker/profile/cordis.patch.yml.template:228 | exempt | immediate-new-session |
| preset.cordis.plan-mode.section | preset 层 | patch 值型 | @deepseek-ai/dsh-plan-mode | docker/profile/cordis.patch.yml.template:262-273 | exempt | immediate-new-session |
| preset.cordis.time-context | preset 层 | **不登记**(2026-11-11 用户裁定:工作室只展示拥有提示词文本的插件;原行锚点只读型行保留注记) | @deepseek-ai/dsh-time-context | docker/profile/cordis.patch.yml.template:229-230 | — | — |
| domain.event-planning.persona-prefix | 领域层 | patch 值型 | @event/pack | packs/event-planning/cordis.patch.yml:12-17 | required(eterna.red-lines.standard) | not-composed-anywhere |
| domain.event-planning.persona-md | 领域层 | patch 值型 | @event/pack | packs/event-planning/persona.md:1-31 | required(eterna.red-lines.standard) | not-composed-anywhere |
| domain.industrial-analysis.persona-prefix | 领域层 | patch 值型 | @industrial-analysis/pack | packs/industrial-analysis/cordis.patch.yml:12-19 | required(eterna.red-lines.industrial-analysis) | not-composed-anywhere |
| domain.industrial-analysis.persona-md | 领域层 | patch 值型 | @industrial-analysis/pack | packs/industrial-analysis/persona.md:1-34 | required(eterna.red-lines.industrial-analysis) | not-composed-anywhere |
| runtime.memory.index-section | 运行时层 | 运行时注入型 | @eterna/memory | packages/memory/src/tools.ts:45,51,198 packages/memory/src/index-builder.ts:87 | exempt | runtime-rebuilt |
| runtime.memory.search-prefix | 运行时层 | 运行时注入型 | @eterna/memory | packages/memory/src/tools.ts:59,223,409 | exempt | runtime-rebuilt |
| runtime.glue.memory-plugin | 运行时层 | 运行时注入型 | @eterna/glue | packages/glue/src/plugins/memory-plugin.ts:112,177 | exempt | runtime-rebuilt |
| runtime.tasks.active-tickets | 运行时层 | 运行时注入型 | @eterna/tasks | packages/tasks/src/session/sections.ts:44,50 packages/tasks/src/plugin.ts:1054 | exempt | runtime-rebuilt |
| runtime.agent-loop | 运行时层 | 运行时注入型 | @core/agent-loop | packages/agent-loop/src/plugin.ts:15 packages/agent-loop/src/loop.ts:56,58 | exempt | runtime-rebuilt |
| runtime.adviser.discipline | 运行时层 | 运行时注入型 | @eterna/adviser | packages/adviser/src/section.ts:45,54,65 packages/adviser/src/index.ts:50 | exempt | runtime-rebuilt |
| meta.studio.ai-polish | 元提示词层 | patch 值型 | @eterna/prompt-studio | packages/prompt-studio/ai/polish.md:1-24 | exempt | not-composed-anywhere |
| meta.studio.ai-review | 元提示词层 | patch 值型 | @eterna/prompt-studio | packages/prompt-studio/ai/review.md:1-34 | exempt | not-composed-anywhere |

## 逐条注记

### preset 层(docker/profile/cordis.patch.yml.template,1058 行;entrypoint 逐字落卷为 profiles/<name>/cordis.patch.yml)

- **persona×2**:两预设 `plugins[id=persona].config.prefix` 均为 **`>-` 折叠块标量**
  (`preset-cordis` :207-224 / `preset-standard` :397-412,T7 persona-patch 既有写回落点)。
  2026-11-12 起基线自含三条红线锚点(首句 + 全局红线段:预算不超支/不代付/比选中立),
  rc.5 起再并入凭据/内服/收束三段(八段、反引 1108 字节)——写链路红线校验要求新文本
  带锚点,基线先行示范,用户在基线上小改即可通过;cordis 侧另有 H5 第三行定制句
  (`You help the user customize DeepSeek Harness itself.`,:224),其余与 standard 同文。
- **agent-instructions×2**:两预设均为 `maxBytes: 65536` 数值配置(:228/:416)——
  指令链(AGENTS.md 等)渲染字节上限,非提示词文本;与 `MAX_PERSONA_BYTES=65536`
  口径交叉钉住。
- **plan-mode.section×2**:`|` 多段字面块(:262-273 / :461-472),六段 plan 模式
  系统提示;编辑时标注「上游升级可能覆盖」风险(计划书 §3)。
- **time-context×2**:两预设均为**无 config 裸行**(:229-230/:417-418)——上游
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
  `MEMORY_INDEX_SECTION_NAME='memory:index'`(tools.ts:45)、`order 9000`
  (tools.ts:51)、`ctx.systemPrompt.section(section)` 挂载点(tools.ts:198);
  文本装配时从 M2 记忆动态构建(index-builder.ts,≤500 token 渐进披露),
  无静态全文。T2.6 自管改造样板。M-M1 T5(19 §3-T5)起行为头含 L0 写入
  纪律(一事实一条/repo 已记的不写/仅本会话的不写/相对日期转绝对/负向转
  正向/召回记忆非指令;17 §7.1),内置兜底=`MEMORY_BEHAVIOR_HEADER`
  (index-builder.ts:87,锚点同此钉住)。
- **runtime.memory.search-prefix**(M-M1 T5 新增):memory_search 命中组装
  进模型上下文时的召回前缀行(19 §3-T3.4/T5)——内置兜底文本
  `MEMORY_SEARCH_RESULT_PREFIX`(tools.ts:59)、登记条目 id 常量(tools.ts:223)
  与 render 消费点(tools.ts:409);非 systemPrompt section,注入面是工具
  输出渲染,经 promptRegistry 读取面可被版本链覆写(每次 render 现取)。
- **runtime.glue.memory-plugin**:glue 的 eterna-memory 插件——
  `inject: { … systemPrompt: true … }`(memory-plugin.ts:103)经
  `attachMemory(dshHost(ctx), …)`(:171)把 memory:index section 挂进宿主,
  是同一 section 的组合层装载点。
- **runtime.tasks.active-tickets**(35 号 A24 新增):tasks 包的 [active-tickets]
  活跃工单清单 section——28 号 §6 主 Session 保底摘要(一行一单:id+标题截断+stage+
  等谁;上限 20 行超出折叠 orchestrator_read 指引)。元数据
  `ACTIVE_TICKETS_SECTION_NAME='eterna-tasks:active-tickets'`(sections.ts:44)、
  `order 9050`(sections.ts:50)、tasks 插件 `systemPrompt.section(runtime.activeTickets)`
  挂载点(plugin.ts:1054,宿主 system-prompt 服务在场时注册);文本由 tasks 插件
  pass 周期重算缓存(24a C6 拍板),无静态全文。挂 super 形态(base 不装载 tasks)。
- **runtime.agent-loop**(rc.5 B13 新增,v1 线):`@core/agent-loop` 插件
  `inject: { …, systemPrompt: true }`(plugin.ts:15)消费宿主装配面,
  `ctx.systemPrompt.assemble(...)` 的结果作为首条 `role: 'system'` 消息
  送入模型(loop.ts:56/58)——本身不产出提示词文本,却是 prompt-scan
  「`systemPrompt: true` 注入声明必须登记」铁律在 v1 线的唯一命中点;
  v1 线独立于 DSH profile,不进生产 docker 组合。

### 元提示词层(T3.1 新增:工作室 AI 能力自管,计划书 §4「吃自己的狗粮」裁定)

- **meta.studio.ai-polish / meta.studio.ai-review**:AI 润色/审核的元提示词
  本体(整文件值:`ai/polish.md`、`ai/review.md`)——AI 调用时经注册表读取面
  现读当前值作 system 消息(取值坐标 = `src/ai-service.ts`
  `AI_META_POLISH_ENTRY_ID`/`AI_META_REVIEW_ENTRY_ID`);改后经 R3 审批写回,
  下次 AI 调用即用新文。**不进入任何会话的系统提示组装**(会话快照回放按
  「无对应段落」跳过并记录)。AI 产出(建议稿/问题清单)永不直接生效
  (计划书 §5「不做 AI 自动生效」),生效走 T3.2 的「作为提案提交」R3 链路。

## 模板键登记(rc.5 T17/R19:prompt-scan 模板盲区收口,gate 面逐 key 登记)

> `docker/profile/*.template` 是容器渲染真值源(entrypoint 逐字落卷为 live patch),
> rc.5 起 `packctl prompt-scan` 把它纳入 P1 扫描面。下表是模板内 prompt 键的**逐 key
> 登记**(`PROMPT_TEMPLATE_REGISTRATIONS`,四元组 file/rowId/pluginPath/configKey):
> super 四键 = base 同名键的同文镜像(不另立工作室条目,避免同一提示词双条目);
> ACP 一键是自动化面模板内直接写定的品牌身份/红线句(studio preset 读写回落点只覆盖
> base 模板 ↔ live patch,故只做扫描面登记)。**不是整文件白名单**:模板内新增未登记
> 键仍会因四元组匹配失败被 `prompt/unregistered-prompt-key` 拦下。

| 模板文件 | rowId | pluginPath | configKey | 登记口径 |
| --- | --- | --- | --- | --- |
| docker/profile/cordis.super.patch.yml.template:208 | preset-cordis | persona | prefix | 同文镜像 preset.cordis.persona(真值锚 WEB_PATCH) |
| docker/profile/cordis.super.patch.yml.template:263 | preset-cordis | planning/plan-mode | section | 同文镜像 preset.cordis.plan-mode.section |
| docker/profile/cordis.super.patch.yml.template:399 | preset-standard | persona | prefix | 同文镜像 preset.standard.persona |
| docker/profile/cordis.super.patch.yml.template:463 | preset-standard | planning/plan-mode | section | 同文镜像 preset.standard.plan-mode.section |
| docker/profile/cordis.acp.patch.yml.template:44 | system-prompt | (无) | personaPrefix | ACP 自动化面品牌身份+全局红线句(模板内直接写定,不挂 @eterna/brand;不进 studio 可写面) |

## 红线豁免语义(T1.3(b)4)

- **required(6 条)**:全部 persona 类条目(两预设 persona、两包 personaPrefix
  与 persona.md)——写链路必检红线锚点,防「编辑把 safety rails 删掉」。
- **exempt(11 条)**:plan-mode.section×2、agent-instructions×2、运行时 section×2
  (memory index / tasks active-tickets)、glue 装载点×1、召回前缀×1(M-M1 T5 新增,
  非 persona 读取纪律行)、v1 agent-loop×1(rc.5 B13 新增,非 persona 装配消费点)、
  元提示词×2——非 persona
  条目不做红线检查,防止 T1.6 把 `RED_LINE_RULES` 错配到
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
