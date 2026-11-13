/**
 * 注册表条目元数据的客户端本地化词典(2026-11-13 用户需求:版本区信息随界面
 * 语言切换)。键约定 = `entry.<条目id>.description` / `entry.<条目id>.effectNote`,
 * 经 ctx.locale 注册进本插件命名空间,t() 自动跟随活跃语言。
 *
 * 单一事实源纪律:zh 侧是 registry.ts description/effect.note 的逐字副本——
 * 不在此处维护中文文案(改注册表即改这里),tests/registry.test.ts 的交叉
 * 钉住测试逐条目比对,漂移即红。en 侧为翻译,新增注册表条目时需补 en,
 * 缺键时 StudioPage 回退注册表中文原文(有键缺译不哑)。
 */

/** 条目描述的词典键(StudioPage 与本词典共用,避免裸字符串漂移)。 */
export const entryDescriptionKey = (id: string): string => `entry.${id}.description`
/** 条目生效注记的词典键。 */
export const entryEffectNoteKey = (id: string): string => `entry.${id}.effectNote`

/** zh:registry.ts 逐字副本(见头注单一事实源纪律)。 */
export const ENTRY_META_LOCALE_ZH: Record<string, string> = {
  [entryDescriptionKey('preset.standard.persona')]: '所有标准会话系统提示的第一段:告诉模型它是谁、用哪个模型,并钉住三条全局红线(预算不超支/不代付/比选中立)。改动会影响之后每一个新会话的开场人设。',
  [entryEffectNoteKey('preset.standard.persona')]: '保存经 R3 审批写回(configEditor 同步重组合)后即时生效:新会话立即用新文,宿主不重启;进行中会话沿用开启时快照(t7-e2e 5.11/6.2/8.1 实测)。',
  [entryDescriptionKey('preset.standard.agent-instructions')]: '指令链(用户级/项目级 AGENTS.md 等)渲染进系统提示时的字节容量上限(数值参数,非提示词文本):调小会截断长指令链,调大放宽。只影响 standard 预设会话。',
  [entryEffectNoteKey('preset.standard.agent-instructions')]: '调小/调大容量上限经 R3 审批写回后即时生效:新会话的指令链按新上限渲染(AGENTS.md 标记实测);进行中会话沿用首条指令消息(t7-e2e 15.2-15.8 实测)。',
  [entryDescriptionKey('preset.standard.plan-mode.section')]: 'plan 模式激活时注入的整段系统提示:规定模型只做只读探索与计划制定,必须经 exit_plan_mode 提交计划并获用户明确批准才能进入实现;plan 会话开场即带上。',
  [entryEffectNoteKey('preset.standard.plan-mode.section')]: '保存经 R3 审批写回后即时生效:改后新开的 plan 模式会话立即用新段;旧会话补轮沿用快照旧段(t7-e2e 14.7-14.10 实测;plan 模式激活时才注入)。',
  [entryDescriptionKey('preset.cordis.persona')]: '创造模式(cordis 预设)会话系统提示的第一段:定位与默认 persona 同源,同样钉三条全局红线;只影响创造模式会话。',
  [entryEffectNoteKey('preset.cordis.persona')]: '保存经 R3 审批写回(块标量整块替换)后即时生效:改后新开的创造模式会话立即用新文;进行中会话沿用开启时快照(t7-e2e 15.9-15.17 实测,同构 cordis 预设行)。',
  [entryDescriptionKey('preset.cordis.agent-instructions')]: '创造模式会话的指令链渲染字节上限(数值参数),作用同 standard 档;只影响 cordis 预设会话。',
  [entryEffectNoteKey('preset.cordis.agent-instructions')]: '与 standard 档同机制:写回后新会话的指令链按新上限渲染(AGENTS.md 标记实测于同构 cordis 预设行;进行中会话沿用首条指令消息)(t7-e2e 15.12-15.16)。',
  [entryDescriptionKey('preset.cordis.plan-mode.section')]: '创造模式下的 plan 模式整段系统提示,作用同 standard 档;只影响 cordis 预设的 plan 会话。',
  [entryEffectNoteKey('preset.cordis.plan-mode.section')]: '与 standard 档同机制:写回后改后新开的 plan 模式会话立即用新段(t7-e2e 15.18-15.23 实测于同构 cordis 预设行;plan 模式激活时才注入)。',
  [entryDescriptionKey('domain.event-planning.persona-prefix')]: '活动策划领域包的 persona 前缀:领域身份句+三条红线英文转述;装载该领域包时拼进系统提示开头,把通用 agent 定位成活动策划专家。',
  [entryEffectNoteKey('domain.event-planning.persona-prefix')]: '写回落点=仓库 pack 文件(直写兜底通道,写回/回滚闭环实测 t7-e2e 15.30F-15.35F);当前生产 eterna-web 档与 t7 隔离档的 profile bundles 均不含领域包——改动不进入任何运行中组合(写后 dump-config 实测),装载该包的宿主另行组合。',
  [entryDescriptionKey('domain.event-planning.persona-md')]: '活动策划领域的 persona 全文基准(角色/语气/全局硬约束/SOP 分诊):领域的真值文件;运行时生效面是 personaPrefix 行,本文件供对账与红线交叉钉住。',
  [entryEffectNoteKey('domain.event-planning.persona-md')]: '整文件基准:仓库内未见运行时注入代码,该文件当前不参与任何宿主组装(写后 dump-config 实测不含新文);写回/回滚闭环实测 t7-e2e 15.36H-15.39H。',
  [entryDescriptionKey('domain.industrial-analysis.persona-prefix')]: '工业数智分析领域包的 persona 前缀:领域身份句+四条行业红线(达梦只读/只经 MCP/对外发送须确认/deny 优先)英文转述;装载该领域包时生效。',
  [entryEffectNoteKey('domain.industrial-analysis.persona-prefix')]: '写回落点=仓库 pack 文件(直写兜底通道,写回/回滚闭环实测 t7-e2e 15.30G-15.35G);当前生产 eterna-web 档与 t7 隔离档的 profile bundles 均不含领域包——改动不进入任何运行中组合(写后 dump-config 实测)。',
  [entryDescriptionKey('domain.industrial-analysis.persona-md')]: '工业数智分析领域的 persona 全文基准(角色/全局硬约束),绑定行业专用四条红线规则集;运行时生效面是 personaPrefix 行。',
  [entryEffectNoteKey('domain.industrial-analysis.persona-md')]: '整文件基准:仓库内未见运行时注入代码,该文件当前不参与任何宿主组装(写后 dump-config 实测不含新文);写回/回滚闭环实测 t7-e2e 15.36I-15.39I。',
  [entryDescriptionKey('runtime.memory.index-section')]: '记忆索引段(运行时注入):每次会话装配系统提示时从记忆库动态构建 ≤500 token 的记忆索引,让模型知道已记住什么;无静态文本,不可编辑。',
  [entryEffectNoteKey('runtime.memory.index-section')]: '不可经工作室修改:保存对其 fail-closed 拒写(t7-e2e 15.26 实测);section 文本每次装配由宿主动态重建,不受会话快照回放冻结(回放按型跳过并审计,t7-e2e 15.28)。',
  [entryDescriptionKey('runtime.glue.memory-plugin')]: '记忆插件的 systemPrompt 挂载点(运行时注入):@eterna/glue 把记忆索引 section 挂进宿主的装配位声明;无静态文本,不可编辑。',
  [entryEffectNoteKey('runtime.glue.memory-plugin')]: '不可经工作室修改:保存对其 fail-closed 拒写(t7-e2e 15.27 实测);同一 section 的装载层,文本每次装配重建,不受快照回放冻结(回放按型跳过并审计,t7-e2e 15.28)。',
  [entryDescriptionKey('meta.studio.ai-polish')]: 'AI 润色的元提示词:工坊「AI 润色」调用模型时用它做 system 消息,规定润色纪律(只建议不生效、保留红线段等);改它即改润色行为,下次润色即用新文。',
  [entryEffectNoteKey('meta.studio.ai-polish')]: '不进入任何会话的系统提示组装;AI 润色调用时现读注册表当前值,改后经 R3 审批写回,下次润色调用即用新文。',
  [entryDescriptionKey('meta.studio.ai-review')]: 'AI 审校的元提示词:工坊「AI 审校」生成问题清单时用它做 system 消息,规定审校维度与输出格式;改它即改审校行为,下次审校即用新文。',
  [entryEffectNoteKey('meta.studio.ai-review')]: '不进入任何会话的系统提示组装;AI 审核调用时现读注册表当前值,改后经 R3 审批写回,下次审核调用即用新文。',
}

/** en:翻译层(新增条目时补;缺键回退注册表中文原文)。 */
export const ENTRY_META_LOCALE_EN: Record<string, string> = {
  [entryDescriptionKey('preset.standard.persona')]: "The opening section of every standard session's system prompt: tells the model who it is, which model it runs on, and pins three global red lines (no budget overrun / no payments / neutral vendor selection). Changes affect the opening persona of every new session.",
  [entryEffectNoteKey('preset.standard.persona')]: 'Takes effect immediately after an R3-approved write-back (configEditor synchronous re-composition): new sessions use the new text at once, no host restart; in-flight sessions keep their opening snapshot (verified in t7-e2e 5.11/6.2/8.1).',
  [entryDescriptionKey('preset.standard.agent-instructions')]: 'Byte-capacity limit for rendering instruction chains (user/project AGENTS.md etc.) into the system prompt (a numeric parameter, not prompt text): lower truncates long chains, higher relaxes the cap. Affects standard-preset sessions only.',
  [entryEffectNoteKey('preset.standard.agent-instructions')]: 'Takes effect immediately after an R3-approved write-back of the new cap: new sessions render instruction chains under the new limit (verified via AGENTS.md marker); in-flight sessions keep their first instruction message (verified in t7-e2e 15.2-15.8).',
  [entryDescriptionKey('preset.standard.plan-mode.section')]: 'The full system-prompt section injected while plan mode is active: instructs the model to do read-only exploration and planning only, and to submit plans through exit_plan_mode with explicit user approval before any implementation; present from the start of plan sessions.',
  [entryEffectNoteKey('preset.standard.plan-mode.section')]: 'Takes effect immediately after an R3-approved write-back: plan-mode sessions opened after the change use the new section at once; older sessions keep the snapshot section on their next turn (verified in t7-e2e 14.7-14.10; injected only while plan mode is active).',
  [entryDescriptionKey('preset.cordis.persona')]: "The opening section of creation-mode (cordis preset) sessions' system prompt: same positioning as the default persona, pinning the same three global red lines; affects creation-mode sessions only.",
  [entryEffectNoteKey('preset.cordis.persona')]: 'Takes effect immediately after an R3-approved write-back (whole block-scalar replacement): creation-mode sessions opened after the change use the new text at once; in-flight sessions keep their opening snapshot (verified in t7-e2e 15.9-15.17 on the isomorphic cordis preset row).',
  [entryDescriptionKey('preset.cordis.agent-instructions')]: 'Byte-capacity limit for rendering instruction chains in creation-mode sessions (numeric parameter), same role as the standard preset; affects cordis-preset sessions only.',
  [entryEffectNoteKey('preset.cordis.agent-instructions')]: 'Same mechanism as the standard preset: after write-back, new sessions render instruction chains under the new cap (verified via AGENTS.md marker on the isomorphic cordis preset row; in-flight sessions keep their first instruction message) (t7-e2e 15.12-15.16).',
  [entryDescriptionKey('preset.cordis.plan-mode.section')]: 'The full plan-mode system prompt for creation mode, same role as the standard preset; affects plan sessions of the cordis preset only.',
  [entryEffectNoteKey('preset.cordis.plan-mode.section')]: 'Same mechanism as the standard preset: plan-mode sessions opened after the write-back use the new section at once (verified in t7-e2e 15.18-15.23 on the isomorphic cordis preset row; injected only while plan mode is active).',
  [entryDescriptionKey('domain.event-planning.persona-prefix')]: 'Persona prefix of the event-planning domain pack: a domain identity line plus an English rendering of the three red lines; prepended to the system prompt when the domain pack is loaded, positioning the general agent as an event-planning expert.',
  [entryEffectNoteKey('domain.event-planning.persona-prefix')]: 'Write-back target = repo pack file (direct-write fallback channel; write/rollback loop verified in t7-e2e 15.30F-15.35F); the current production eterna-web profile and the t7 isolated profile contain no domain packs — changes enter no running composition (verified via dump-config after write); hosts that load the pack compose it separately.',
  [entryDescriptionKey('domain.event-planning.persona-md')]: "Full persona baseline of the event-planning domain (role/tone/global hard constraints/SOP triage): the domain's source-of-truth file; the runtime-effective surface is the personaPrefix row, and this file serves reconciliation and red-line cross-pinning.",
  [entryEffectNoteKey('domain.event-planning.persona-md')]: 'Whole-file baseline: no runtime injection code found in the repo, and the file currently takes part in no host assembly (verified via dump-config after write); write/rollback loop verified in t7-e2e 15.36H-15.39H.',
  [entryDescriptionKey('domain.industrial-analysis.persona-prefix')]: 'Persona prefix of the industrial-analytics domain pack: a domain identity line plus four industry red lines (Dameng read-only / MCP-only / confirm before external sends / deny-first) in English; takes effect when the domain pack is loaded.',
  [entryEffectNoteKey('domain.industrial-analysis.persona-prefix')]: 'Write-back target = repo pack file (direct-write fallback channel; write/rollback loop verified in t7-e2e 15.30G-15.35G); the current production eterna-web profile and the t7 isolated profile contain no domain packs — changes enter no running composition (verified via dump-config after write).',
  [entryDescriptionKey('domain.industrial-analysis.persona-md')]: 'Full persona baseline of the industrial-analytics domain (role/global hard constraints), bound to the industry-specific four-red-line rule set; the runtime-effective surface is the personaPrefix row.',
  [entryEffectNoteKey('domain.industrial-analysis.persona-md')]: 'Whole-file baseline: no runtime injection code found in the repo, and the file currently takes part in no host assembly (verified via dump-config after write); write/rollback loop verified in t7-e2e 15.36I-15.39I.',
  [entryDescriptionKey('runtime.memory.index-section')]: 'Memory index section (runtime injection): on every system-prompt assembly the host builds a ≤500-token memory index from the memory store, so the model knows what has been remembered; no static text, not editable.',
  [entryEffectNoteKey('runtime.memory.index-section')]: 'Cannot be modified through the studio: the save path fail-closed rejects writes to it (verified in t7-e2e 15.26); the section text is rebuilt by the host at every assembly and is not frozen by session-snapshot replay (replay skips it by kind and audits, t7-e2e 15.28).',
  [entryDescriptionKey('runtime.glue.memory-plugin')]: "The memory plugin's systemPrompt mounting point (runtime injection): @eterna/glue mounts the memory-index section into the host's assembly declaration; no static text, not editable.",
  [entryEffectNoteKey('runtime.glue.memory-plugin')]: 'Cannot be modified through the studio: the save path fail-closed rejects writes to it (verified in t7-e2e 15.27); the loading layer of the same section, its text is rebuilt at every assembly and not frozen by snapshot replay (replay skips it by kind and audits, t7-e2e 15.28).',
  [entryDescriptionKey('meta.studio.ai-polish')]: "Meta-prompt for AI polish: the studio's \"AI polish\" uses it as the system message when calling the model, defining polish discipline (suggest-only, never applied, keep red-line sections, etc.); changing it changes polish behavior — the next polish run uses the new text.",
  [entryEffectNoteKey('meta.studio.ai-polish')]: "Enters no session's system-prompt assembly; AI polish reads the registry's current value at call time — after an R3-approved write-back, the next polish call uses the new text.",
  [entryDescriptionKey('meta.studio.ai-review')]: "Meta-prompt for AI review: the studio's \"AI review\" uses it as the system message when producing findings, defining review dimensions and output format; changing it changes review behavior — the next review run uses the new text.",
  [entryEffectNoteKey('meta.studio.ai-review')]: "Enters no session's system-prompt assembly; AI review reads the registry's current value at call time — after an R3-approved write-back, the next review call uses the new text.",
}
