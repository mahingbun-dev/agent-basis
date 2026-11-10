/**
 * 提示词注册表(T1.3,计划书 §6/§5「条目模型 + 三层存量全量登记」):
 *
 * 全产品提示词的唯一登记面——preset 层(profiles/eterna-web/cordis.patch.yml 两预设)、
 * 领域层(packs/{event-planning,industrial-analysis} 的 personaPrefix + persona.md)、运行时层
 * (ctx.systemPrompt.section 动态注入,现存使用者 memory/glue)、meta 层(工作室 AI 能力
 * 自管的元提示词,T3.1:计划书 §4「元提示词本身也进工作室注册表自管——吃自己的狗粮」)。
 * 对账真值 =
 * docs/dev/ps-v2-registry-ledger.md(文件:行号 逐条,型别一并入 ledger),
 * tests/registry.test.ts 维持「ledger ↔ 注册表条目 (id,型别) 集合」双向相等——
 * 删条目/改型别/漏登记都会打破相等,清单与代码互相锁住。
 *
 * 条目型别三分(与对账判据一一对应,测试计划 §3 T1.3):
 * - patch 值型:值在 patch/包文件里,可结构定位并反引读回(persona 前缀、
 *   agent-instructions maxBytes、plan-mode section、领域 personaPrefix/persona.md);
 * - 行锚点只读型:行在场但提示词文本由上游插件运行时生成(time-context 两预设均
 *   无 config 裸行;上游 config 面只有 refreshIntervalMs/timeZone 调度项)——
 *   写链路 fail-closed 拒写,不造写回假象;
 * - 运行时注入型:section 元数据 + 来源代码锚点(memory/glue),无静态全文。
 *
 * 红线豁免语义(T1.3(b)4):persona 类条目标记 required(红线必检),非 persona
 * 条目(time-context/plan-mode/agent-instructions/运行时 section)标记 exempt——
 * 防止 T1.6 把 RED_LINE_RULES 错配到全部条目。required 条目另带规则集 id:
 * 'eterna.red-lines.standard' = validator.ts RED_LINE_RULES(预算不超支/不代付/
 * 比选中立,锚点与 packs/event-planning/persona.md 对齐;T1.6 起双语——同集条目
 * 既有中文全文也有英文转述前缀);industrial-analysis persona 自有四条红线(达梦
 * 只读/只经 MCP/R2 确认/deny 优先),不含标准三条 CJK 锚点(2026-11-11 实测),
 * 规则本体=validator.ts INDUSTRIAL_RED_LINE_RULES(T1.6 落地,双语)。
 */
import { byteLength } from './checksum.ts'
import { unquoteYamlScalar } from './persona-patch.ts'
import { MAX_PERSONA_BYTES } from './validator.ts'

/**
 * 层枚举(闭合;preset=profile patch 层,domain=领域包,runtime=运行时注入,
 * meta=工作室 AI 能力自管的元提示词,T3.1 吃自己狗粮)。
 */
export type PromptLayer = 'preset' | 'domain' | 'runtime' | 'meta'

/**
 * 条目型别枚举(闭合;与对账判据一一对应,每型至少 1 条被真文件钉住——
 * tests/registry.test.ts 分型断言)。
 */
export type PromptEntryKind = 'patch-value' | 'line-anchor-readonly' | 'runtime-injection'

/** 层的 ledger/UI 中文标签(docs/dev/ps-v2-registry-ledger.md 与测试共用单一来源)。 */
export const LAYER_LABELS: Readonly<Record<PromptLayer, string>> = {
  preset: 'preset 层',
  domain: '领域层',
  runtime: '运行时层',
  meta: '元提示词层',
}

/** 型别的 ledger/UI 中文标签(测试计划 §3 T1.3 的分型判据用语)。 */
export const ENTRY_KIND_LABELS: Readonly<Record<PromptEntryKind, string>> = {
  'patch-value': 'patch 值型',
  'line-anchor-readonly': '行锚点只读型',
  'runtime-injection': '运行时注入型',
}

/**
 * 生效半径枚举(T2.2 逐条目热生效实测矩阵的结论口径;对账真值 =
 * docs/dev/ps-v2-hot-effect-matrix.md,每格引用 scripts/t7-e2e.mjs 断言编号——
 * 矩阵文档与 registry.effect 字段互相锁住,改半径先改实测):
 * - immediate-new-session:即时——同进程写回(经审批)后,新会话立即用新文
 *   (configEditor 同步重组合;宿主 pid 不变);进行中会话沿用开启时快照(T2.4);
 * - not-composed-anywhere:无组合面——写回落点=仓库 pack 文件,但当前无任何宿主
 *   (生产 eterna-web 与 t7 隔离档的 dsh.profile.bundles 均不含领域包)装载该来源,
 *   改动不进入任何运行中组合(实测:写后同进程 dump-config 组合树不含新文);
 * - readonly-upstream:不可写——行锚点只读型,上游插件每次组装生成,写链路
 *   fail-closed 拒写,无「改后生效」语义;
 * - runtime-rebuilt:不可写——运行时注入型,文本由代码每次装配动态构建,
 *   写链路 fail-closed 拒写,不受快照回放冻结(回放按型跳过)。
 */
export type PromptEffectRadius = 'immediate-new-session' | 'not-composed-anywhere' | 'readonly-upstream' | 'runtime-rebuilt'

/** 生效半径的 ledger/UI 中文标签(标签文案随 locale 字典二次本地化,本表供文档对账)。 */
export const EFFECT_RADIUS_LABELS: Readonly<Record<PromptEffectRadius, string>> = {
  'immediate-new-session': '即时(新会话;进行中会话沿用快照)',
  'not-composed-anywhere': '无组合面(不进入任何会话)',
  'readonly-upstream': '不可写(上游每次组装生成)',
  'runtime-rebuilt': '不可写(每次装配动态构建)',
}

/**
 * 文件行锚点(对账真值):file 为仓库根相对 POSIX 路径,line 为 1-based 行号,
 * contains 为该行必须包含的文本片段——行号漂移或内容被改即对账失败(交叉钉住,
 * 手法对齐 tests/validator-diff.test.ts:101-107 的真文件钉住)。
 */
export interface CodeAnchor {
  readonly file: string
  readonly line: number
  readonly contains: string
}

/**
 * YAML 结构定位(T1.4 读侧/T1.6 写侧的运行时寻址,行锚点之外的结构面):
 * 顶层行 id → (可选)行内插件列表项路径 → config 键。
 * 例:preset persona = rowId 'preset-standard' + pluginPath ['persona'] + 'prefix';
 * plan-mode = pluginPath ['planning','plan-mode'](嵌套组);领域包 = rowId
 * 'system-prompt' 无 pluginPath + 'personaPrefix'。persona.md 等整文件条目无
 * yaml 定位(值=全文)。
 */
export interface YamlLocator {
  readonly file: string
  readonly rowId: string
  readonly pluginPath?: readonly string[]
  readonly configKey: string
}

/** 红线策略标记:persona 类=required(必检),其余=exempt(豁免,防错配)。 */
export type RedLinePolicy = 'required' | 'exempt'

/**
 * 注册表条目(计划书 §5「条目模型」:「当前值」是运行时读出的(见 readEntryValue),
 * 静态登记面为定位/型别/风险/红线/字节上限等元数据)。
 */
export interface PromptRegistryEntry {
  /** 全局唯一 id(ledger/审计/端点 entryId 引用)。 */
  readonly id: string
  readonly layer: PromptLayer
  readonly kind: PromptEntryKind
  /** 来源插件/包(上游 dsh-* / 领域包 / 本仓运行时插件)。 */
  readonly source: string
  /** YAML 结构定位(patch 值型 persona.md 以外的条目必有;整文件条目缺省)。 */
  readonly yaml?: YamlLocator
  /** 文件行锚点(≥1 条;对账真值,测试逐条钉住)。 */
  readonly anchors: readonly CodeAnchor[]
  /** 型别注记(只读/运行时生成等 UI 文案与拒写明示来源)。 */
  readonly note: string
  /** 风险标注(≥1 条,UI 直接展示;如「profile 升级合并可能覆盖」)。 */
  readonly risks: readonly string[]
  /** 红线策略(T1.3(b)4 豁免语义)。 */
  readonly redLine: RedLinePolicy
  /** redLine=required 时的规则集 id('eterna.red-lines.standard'=RED_LINE_RULES)。 */
  readonly redLineRuleSet?: string
  /** 写链路字节上限(逐条目校验口径,默认 MAX_PERSONA_BYTES)。 */
  readonly maxBytes: number
  /**
   * 生效半径标注(T2.2 实测矩阵结论;UI「生效条件」明示与矩阵文档共用单一来源)。
   * radius=枚举(见 PromptEffectRadius);note=逐条目生效条件中文说明(实测口径,
   * 引用断言编号见 docs/dev/ps-v2-hot-effect-matrix.md)。
   */
  readonly effect: { readonly radius: PromptEffectRadius; readonly note: string }
}

// ---------- 三层存量登记(对账基准=计划书 §2 现状清单,行号 2026-11-11 实测) ----------

/**
 * preset 层 patch 文件(仓库根相对)。运行时(T1.4 读侧)由网关映射到本宿主的
 * live patch 层(profileContext.patchPath)——生产 eterna-web 档两者是同一文件。
 */
export const WEB_PATCH = 'profiles/eterna-web/cordis.patch.yml'

/**
 * 缺省条目 id(T1.4):不带 entryId 的旧调用形态(prompt-get/prompt-versions/
 * snapshot.versions)一律指 preset.standard.persona——T7 时代唯一管理对象,
 * 旧断言与旧客户端零改动保持兼容;亦是版本库 v1 存量记录(无 entryId 字段)的
 * 归属条目(见 version-store recordOf)。
 */
export const DEFAULT_ENTRY_ID = 'preset.standard.persona'

/** profile/pack 升级合并的通用风险(计划书 §3「升级可能覆盖」+ §7 风险表)。 */
const UPGRADE_OVERWRITE_RISK = 'profile/pack 升级合并可能覆盖本地编辑(版本库可回滚兜底)'

/**
 * 全部存量条目(16 条:preset×8、domain×4、runtime×2、meta×2——meta 层为
 * T3.1 新增的元提示词登记)。行号锚 2026-11-11 实测自本 worktree(T1.2 合入后):
 * persona×2 = :288(standard 裸标量)/:149-150(cordis 块标量 >-);
 * agent-instructions = :154/:292(maxBytes: 65536);
 * time-context = :155-156/:293-294(无 config 裸行);
 * plan-mode section = :188-199/:331 起(| 多段字面块)。
 */
export const PROMPT_REGISTRY_ENTRIES: readonly PromptRegistryEntry[] = [
  // ── preset 层:preset-standard(默认预设,T7 persona-patch 既有写回落点)──────
  {
    id: 'preset.standard.persona',
    layer: 'preset',
    kind: 'patch-value',
    source: '@deepseek-ai/dsh-persona',
    yaml: { file: WEB_PATCH, rowId: 'preset-standard', pluginPath: ['persona'], configKey: 'prefix' },
    anchors: [
      { file: WEB_PATCH, line: 288, contains: 'prefix: You are a coding agent powered by the {{model}} model.' },
    ],
    note: '默认预设 persona 前缀(裸标量):T7 persona-patch 既有管理对象,preset-standard 行 plugins[id=persona].config.prefix。',
    risks: [UPGRADE_OVERWRITE_RISK, 'persona 红线锚点必检(标准三条),改动影响全部标准会话的系统提示开头。'],
    redLine: 'required',
    redLineRuleSet: 'eterna.red-lines.standard',
    maxBytes: MAX_PERSONA_BYTES,
    effect: {
      radius: 'immediate-new-session',
      note: '保存经 R3 审批写回(configEditor 同步重组合)后即时生效:新会话立即用新文,宿主不重启;进行中会话沿用开启时快照(t7-e2e 5.11/6.2/8.1 实测)。',
    },
  },
  {
    id: 'preset.standard.agent-instructions',
    layer: 'preset',
    kind: 'patch-value',
    source: '@deepseek-ai/dsh-agent-instructions',
    yaml: { file: WEB_PATCH, rowId: 'preset-standard', pluginPath: ['agent-instructions'], configKey: 'maxBytes' },
    anchors: [
      { file: WEB_PATCH, line: 292, contains: 'maxBytes: 65536' },
    ],
    note: '指令段容量上限(数值配置,非提示词文本):每条指令链(用户级/项目级 AGENTS.md)的渲染字节上限。',
    risks: [UPGRADE_OVERWRITE_RISK, '值是数值不是提示词文本;调小会截断指令链渲染,与 MAX_PERSONA_BYTES=65536 口径交叉钉住。'],
    redLine: 'exempt',
    maxBytes: MAX_PERSONA_BYTES,
    effect: {
      radius: 'immediate-new-session',
      note: '调小/调大容量上限经 R3 审批写回后即时生效:新会话的指令链按新上限渲染(AGENTS.md 标记实测);进行中会话沿用首条指令消息(t7-e2e 15.2-15.8 实测)。',
    },
  },
  {
    id: 'preset.standard.plan-mode.section',
    layer: 'preset',
    kind: 'patch-value',
    source: '@deepseek-ai/dsh-plan-mode',
    yaml: { file: WEB_PATCH, rowId: 'preset-standard', pluginPath: ['planning', 'plan-mode'], configKey: 'section' },
    anchors: [
      { file: WEB_PATCH, line: 331, contains: 'section: |' },
      { file: WEB_PATCH, line: 332, contains: 'You are in plan mode.' },
    ],
    note: 'plan 模式整段系统提示(| 多段字面块,行 331 起):planning 组内 plan-mode 插件的 config.section。',
    risks: [UPGRADE_OVERWRITE_RISK, '上游 @deepseek-ai/dsh-plan-mode 升级改写该段时,本地编辑需与新版重新对齐(计划书 §3 风险标注)。'],
    redLine: 'exempt',
    maxBytes: MAX_PERSONA_BYTES,
    effect: {
      radius: 'immediate-new-session',
      note: '保存经 R3 审批写回后即时生效:改后新开的 plan 模式会话立即用新段;旧会话补轮沿用快照旧段(t7-e2e 14.7-14.10 实测;plan 模式激活时才注入)。',
    },
  },
  {
    id: 'preset.standard.time-context',
    layer: 'preset',
    kind: 'line-anchor-readonly',
    source: '@deepseek-ai/dsh-time-context',
    anchors: [
      { file: WEB_PATCH, line: 293, contains: '- id: time-context' },
      { file: WEB_PATCH, line: 294, contains: "'@deepseek-ai/dsh-time-context'" },
    ],
    note: '行锚点只读型:该条目由上游插件运行时生成,无 patch 写回落点(上游 config 面只有 refreshIntervalMs/timeZone 调度项,提示词文本每次注入时生成)。',
    risks: ['无 patch 值亦无写回落点——写链路 fail-closed 拒写并明示,不造写回假象(测试计划 §9.7 口径)。'],
    redLine: 'exempt',
    maxBytes: MAX_PERSONA_BYTES,
    effect: {
      radius: 'readonly-upstream',
      note: '不可经工作室修改:保存对其 fail-closed 拒写(t7-e2e 15.24 实测);时间文本由上游每次组装重新生成,不存在「改后生效半径」。',
    },
  },
  // ── preset 层:preset-cordis(创造模式,2026-11-09 用户裁定回加)────────────
  {
    id: 'preset.cordis.persona',
    layer: 'preset',
    kind: 'patch-value',
    source: '@deepseek-ai/dsh-persona',
    yaml: { file: WEB_PATCH, rowId: 'preset-cordis', pluginPath: ['persona'], configKey: 'prefix' },
    anchors: [
      { file: WEB_PATCH, line: 149, contains: 'prefix: >-' },
      { file: WEB_PATCH, line: 150, contains: 'You are a coding agent powered by the {{model}} model.' },
    ],
    note: '创造模式 persona 前缀(>- 折叠块标量,行 149-150):preset-cordis 行 plugins[id=persona].config.prefix。',
    risks: [UPGRADE_OVERWRITE_RISK, '块标量写回必须整块替换(块头+续行),单行替换会残留续行产生脏 YAML(测试计划 §9.5)。'],
    redLine: 'required',
    redLineRuleSet: 'eterna.red-lines.standard',
    maxBytes: MAX_PERSONA_BYTES,
    effect: {
      radius: 'immediate-new-session',
      note: '保存经 R3 审批写回(块标量整块替换)后即时生效:改后新开的创造模式会话立即用新文;进行中会话沿用开启时快照(t7-e2e 15.9-15.17 实测,同构 cordis 预设行)。',
    },
  },
  {
    id: 'preset.cordis.agent-instructions',
    layer: 'preset',
    kind: 'patch-value',
    source: '@deepseek-ai/dsh-agent-instructions',
    yaml: { file: WEB_PATCH, rowId: 'preset-cordis', pluginPath: ['agent-instructions'], configKey: 'maxBytes' },
    anchors: [
      { file: WEB_PATCH, line: 154, contains: 'maxBytes: 65536' },
    ],
    note: '指令段容量上限(数值配置,非提示词文本),preset-cordis 行内与 standard 同值 65536。',
    risks: [UPGRADE_OVERWRITE_RISK, '值是数值不是提示词文本;调小会截断指令链渲染。'],
    redLine: 'exempt',
    maxBytes: MAX_PERSONA_BYTES,
    effect: {
      radius: 'immediate-new-session',
      note: '与 standard 档同机制:写回后新会话的指令链按新上限渲染(AGENTS.md 标记实测于同构 cordis 预设行;进行中会话沿用首条指令消息)(t7-e2e 15.12-15.16)。',
    },
  },
  {
    id: 'preset.cordis.plan-mode.section',
    layer: 'preset',
    kind: 'patch-value',
    source: '@deepseek-ai/dsh-plan-mode',
    yaml: { file: WEB_PATCH, rowId: 'preset-cordis', pluginPath: ['planning', 'plan-mode'], configKey: 'section' },
    anchors: [
      { file: WEB_PATCH, line: 188, contains: 'section: |' },
      { file: WEB_PATCH, line: 189, contains: 'You are in plan mode.' },
    ],
    note: 'plan 模式整段系统提示(| 多段字面块,行 188-199):preset-cordis 行内 planning 组的 plan-mode config.section。',
    risks: [UPGRADE_OVERWRITE_RISK, '上游 @deepseek-ai/dsh-plan-mode 升级改写该段时,本地编辑需与新版重新对齐。'],
    redLine: 'exempt',
    maxBytes: MAX_PERSONA_BYTES,
    effect: {
      radius: 'immediate-new-session',
      note: '与 standard 档同机制:写回后改后新开的 plan 模式会话立即用新段(t7-e2e 15.18-15.23 实测于同构 cordis 预设行;plan 模式激活时才注入)。',
    },
  },
  {
    id: 'preset.cordis.time-context',
    layer: 'preset',
    kind: 'line-anchor-readonly',
    source: '@deepseek-ai/dsh-time-context',
    anchors: [
      { file: WEB_PATCH, line: 155, contains: '- id: time-context' },
      { file: WEB_PATCH, line: 156, contains: "'@deepseek-ai/dsh-time-context'" },
    ],
    note: '行锚点只读型:该条目由上游插件运行时生成,无 patch 写回落点(preset-cordis 行内同样是无 config 裸行)。',
    risks: ['无 patch 值亦无写回落点——写链路 fail-closed 拒写并明示,不造写回假象。'],
    redLine: 'exempt',
    maxBytes: MAX_PERSONA_BYTES,
    effect: {
      radius: 'readonly-upstream',
      note: '不可经工作室修改:保存对其 fail-closed 拒写(t7-e2e 15.25 实测);时间文本由上游每次组装重新生成。',
    },
  },
  // ── 领域层:两 pack 的 system-prompt.personaPrefix(>- 块标量)+ persona.md 全文 ──
  {
    id: 'domain.event-planning.persona-prefix',
    layer: 'domain',
    kind: 'patch-value',
    source: '@event/pack',
    yaml: { file: 'packs/event-planning/cordis.patch.yml', rowId: 'system-prompt', configKey: 'personaPrefix' },
    anchors: [
      { file: 'packs/event-planning/cordis.patch.yml', line: 12, contains: '- id: system-prompt' },
      { file: 'packs/event-planning/cordis.patch.yml', line: 14, contains: 'personaPrefix: >-' },
    ],
    note: '活动策划领域 persona 前缀(>- 折叠块标量,行 14-17):system-prompt 行 config.personaPrefix,英文三红线句(预算/代付/比选中立的英文转述)。',
    risks: [UPGRADE_OVERWRITE_RISK, '块标量写回必须整块替换;pack 重装/升级可能覆盖。'],
    redLine: 'required',
    redLineRuleSet: 'eterna.red-lines.standard',
    maxBytes: MAX_PERSONA_BYTES,
    effect: {
      radius: 'not-composed-anywhere',
      note: '写回落点=仓库 pack 文件(直写兜底通道,写回/回滚闭环实测 t7-e2e 15.30F-15.35F);当前生产 eterna-web 档与 t7 隔离档的 profile bundles 均不含领域包——改动不进入任何运行中组合(写后 dump-config 实测),装载该包的宿主另行组合。',
    },
  },
  {
    id: 'domain.event-planning.persona-md',
    layer: 'domain',
    kind: 'patch-value',
    source: '@event/pack',
    anchors: [
      { file: 'packs/event-planning/persona.md', line: 1, contains: '# persona' },
    ],
    note: '活动策划领域 persona 全文基准(整文件值:角色/语气/全局硬约束;06 号 SOP S1 分诊):标准三条红线锚点在此文件内(交叉钉住)。',
    risks: [UPGRADE_OVERWRITE_RISK, 'pack 文件,编辑随包版本走;当前未见运行时注入代码,登记为文件真值基准(运行时注入=personaPrefix 行)。'],
    redLine: 'required',
    redLineRuleSet: 'eterna.red-lines.standard',
    maxBytes: MAX_PERSONA_BYTES,
    effect: {
      radius: 'not-composed-anywhere',
      note: '整文件基准:仓库内未见运行时注入代码,该文件当前不参与任何宿主组装(写后 dump-config 实测不含新文);写回/回滚闭环实测 t7-e2e 15.36H-15.39H。',
    },
  },
  {
    id: 'domain.industrial-analysis.persona-prefix',
    layer: 'domain',
    kind: 'patch-value',
    source: '@industrial-analysis/pack',
    yaml: { file: 'packs/industrial-analysis/cordis.patch.yml', rowId: 'system-prompt', configKey: 'personaPrefix' },
    anchors: [
      { file: 'packs/industrial-analysis/cordis.patch.yml', line: 12, contains: '- id: system-prompt' },
      { file: 'packs/industrial-analysis/cordis.patch.yml', line: 14, contains: 'personaPrefix: >-' },
    ],
    note: '工业数智分析领域 persona 前缀(>- 折叠块标量,行 14-19):system-prompt 行 config.personaPrefix,英文红线句(数据溯源/只读/MCP-only/R2/deny-first)。',
    risks: [UPGRADE_OVERWRITE_RISK, '块标量写回必须整块替换;pack 重装/升级可能覆盖。'],
    redLine: 'required',
    redLineRuleSet: 'eterna.red-lines.industrial-analysis',
    maxBytes: MAX_PERSONA_BYTES,
    effect: {
      radius: 'not-composed-anywhere',
      note: '写回落点=仓库 pack 文件(直写兜底通道,写回/回滚闭环实测 t7-e2e 15.30G-15.35G);当前生产 eterna-web 档与 t7 隔离档的 profile bundles 均不含领域包——改动不进入任何运行中组合(写后 dump-config 实测)。',
    },
  },
  {
    id: 'domain.industrial-analysis.persona-md',
    layer: 'domain',
    kind: 'patch-value',
    source: '@industrial-analysis/pack',
    anchors: [
      { file: 'packs/industrial-analysis/persona.md', line: 1, contains: '# persona' },
    ],
    note: '工业数智分析领域 persona 全文基准(整文件值):自有四条红线(达梦只读/只经 MCP/R2 确认/deny 优先),不含标准三条 CJK 锚点(2026-11-11 实测),规则本体 T1.6 落地。',
    risks: [UPGRADE_OVERWRITE_RISK, 'pack 文件,编辑随包版本走;标准红线规则集不适用于本条目(豁免错配,规则集另立)。'],
    redLine: 'required',
    redLineRuleSet: 'eterna.red-lines.industrial-analysis',
    maxBytes: MAX_PERSONA_BYTES,
    effect: {
      radius: 'not-composed-anywhere',
      note: '整文件基准:仓库内未见运行时注入代码,该文件当前不参与任何宿主组装(写后 dump-config 实测不含新文);写回/回滚闭环实测 t7-e2e 15.36I-15.39I。',
    },
  },
  // ── 运行时层:ctx.systemPrompt.section 动态注入(现存使用者 memory/glue)────
  {
    id: 'runtime.memory.index-section',
    layer: 'runtime',
    kind: 'runtime-injection',
    source: '@eterna/memory',
    anchors: [
      { file: 'packages/memory/src/tools.ts', line: 41, contains: "MEMORY_INDEX_SECTION_NAME = 'memory:index'" },
      { file: 'packages/memory/src/tools.ts', line: 47, contains: 'MEMORY_INDEX_SECTION_ORDER = 9000' },
      { file: 'packages/memory/src/tools.ts', line: 64, contains: 'ctx.systemPrompt.section(section)' },
    ],
    note: '运行时注入型:记忆索引 section(memory:index,order 9000),文本装配时从 M2 记忆动态构建(渐进披露,≤500 token 预算),无静态全文。',
    risks: ['section 文本随运行时状态(记忆库内容)动态变化;T2.6 改造为从注册表读的样板对象(登记制落地)。'],
    redLine: 'exempt',
    maxBytes: MAX_PERSONA_BYTES,
    effect: {
      radius: 'runtime-rebuilt',
      note: '不可经工作室修改:保存对其 fail-closed 拒写(t7-e2e 15.26 实测);section 文本每次装配由宿主动态重建,不受会话快照回放冻结(回放按型跳过并审计,t7-e2e 15.28)。',
    },
  },
  {
    id: 'runtime.glue.memory-plugin',
    layer: 'runtime',
    kind: 'runtime-injection',
    source: '@eterna/glue',
    anchors: [
      { file: 'packages/glue/src/plugins/memory-plugin.ts', line: 15, contains: 'systemPrompt: true' },
      { file: 'packages/glue/src/plugins/memory-plugin.ts', line: 27, contains: 'attachMemory(dshHost(ctx)' },
    ],
    note: '运行时注入型:glue 的 eterna-memory 插件(inject systemPrompt)经 attachMemory/dshHost 把 memory:index section 挂进宿主——同一 section 的装载层。',
    risks: ['与 runtime.memory.index-section 同一 section 的组合层挂载点;T2.6 与 memory 条目一并自管改造。'],
    redLine: 'exempt',
    maxBytes: MAX_PERSONA_BYTES,
    effect: {
      radius: 'runtime-rebuilt',
      note: '不可经工作室修改:保存对其 fail-closed 拒写(t7-e2e 15.27 实测);同一 section 的装载层,文本每次装配重建,不受快照回放冻结(回放按型跳过并审计,t7-e2e 15.28)。',
    },
  },
  // ── meta 层:工作室 AI 能力自管的元提示词(T3.1,计划书 §4「吃自己的狗粮」)────
  // AI 润色/审核调用时现读本层条目当前值作 system 消息——元提示词改后经 R3 审批
  // 写回,下次 AI 调用即用新文;永不进入任何会话的系统提示组装(回放按无映射段跳过)。
  {
    id: 'meta.studio.ai-polish',
    layer: 'meta',
    kind: 'patch-value',
    source: '@eterna/prompt-studio',
    anchors: [
      { file: 'packages/prompt-studio/ai/polish.md', line: 1, contains: '# AI 润色元提示词' },
    ],
    note: '元提示词层(整文件值):AI 润色的元提示词本体——吃自己的狗粮,工作室 AI 能力的提示词也经注册表登记/版本化/R3 审批管理;润色调用现读当前值作 system 消息。',
    risks: [
      '元提示词改动直接改变 AI 润色行为(输出契约围栏被改坏时润色链路按失败降级,不静默)',
      'AI 建议稿永不直接生效:仅作 diff 预览与 R3 提案素材(计划书 §5「不做 AI 自动生效」)。',
    ],
    redLine: 'exempt',
    maxBytes: MAX_PERSONA_BYTES,
    effect: {
      radius: 'not-composed-anywhere',
      note: '不进入任何会话的系统提示组装;AI 润色调用时现读注册表当前值,改后经 R3 审批写回,下次润色调用即用新文。',
    },
  },
  {
    id: 'meta.studio.ai-review',
    layer: 'meta',
    kind: 'patch-value',
    source: '@eterna/prompt-studio',
    anchors: [
      { file: 'packages/prompt-studio/ai/review.md', line: 1, contains: '# AI 审核元提示词' },
    ],
    note: '元提示词层(整文件值):AI 审核的元提示词本体(问题清单契约:红线冲突/长度预算/变量引用/一致性/清晰度五维);审核调用现读当前值作 system 消息,清单与本地校验器同源互补。',
    risks: [
      '元提示词改动直接改变 AI 审核行为(JSON 契约被改坏时审核按失败降级并明示,不静默)',
      'AI 审核清单永不直接生效:仅作报告展示(计划书 §5「不做 AI 自动生效」)。',
    ],
    redLine: 'exempt',
    maxBytes: MAX_PERSONA_BYTES,
    effect: {
      radius: 'not-composed-anywhere',
      note: '不进入任何会话的系统提示组装;AI 审核调用时现读注册表当前值,改后经 R3 审批写回,下次审核调用即用新文。',
    },
  },
]

// ---------- 查询面 ----------

/** 全部条目(防御性浅拷贝,防调用方原地改登记数据)。 */
export function listPromptRegistryEntries(): readonly PromptRegistryEntry[] {
  return [...PROMPT_REGISTRY_ENTRIES]
}

/** 按 id 取条目(未知 id → undefined;端点侧明示 not-found,不抛)。 */
export function getPromptRegistryEntry(id: string): PromptRegistryEntry | undefined {
  return PROMPT_REGISTRY_ENTRIES.find(entry => entry.id === id)
}

/**
 * 登记数据不变量(T1.3(b)2 条目模型完整性,测试与 packctl prompt-scan 复用):
 * id 全局唯一、层/型别/红线/生效半径枚举闭合、每条锚点≥1/风险≥1/注记非空、
 * required⇒规则集在场、exempt⇒规则集缺席、maxBytes>0、运行时注入型不带
 * YAML 结构定位、生效半径与型别绑定(kind↔radius 一致性,T2.2 矩阵口径:
 * patch 值型∈{immediate-new-session,not-composed-anywhere}、行锚点只读型=
 * readonly-upstream、运行时注入型=runtime-rebuilt)。
 */
export function registryInvariants(): { ok: boolean; problems: readonly string[] } {
  const problems: string[] = []
  const seen = new Set<string>()
  const layers: readonly string[] = ['preset', 'domain', 'runtime', 'meta']
  const kinds: readonly string[] = ['patch-value', 'line-anchor-readonly', 'runtime-injection']
  const radii: readonly string[] = ['immediate-new-session', 'not-composed-anywhere', 'readonly-upstream', 'runtime-rebuilt']
  for (const entry of PROMPT_REGISTRY_ENTRIES) {
    if (seen.has(entry.id)) problems.push(`id 重复:${entry.id}`)
    seen.add(entry.id)
    if (!layers.includes(entry.layer)) problems.push(`${entry.id}:层枚举外 ${entry.layer}`)
    if (!kinds.includes(entry.kind)) problems.push(`${entry.id}:型别枚举外 ${entry.kind}`)
    if (entry.anchors.length === 0) problems.push(`${entry.id}:无文件行锚点(对账真值缺失)`)
    if (entry.risks.length === 0) problems.push(`${entry.id}:无风险标注`)
    if (entry.note.trim() === '') problems.push(`${entry.id}:型别注记为空`)
    if (entry.redLine === 'required' && entry.redLineRuleSet === undefined) {
      problems.push(`${entry.id}:redLine=required 但缺规则集 id`)
    }
    if (entry.redLine === 'exempt' && entry.redLineRuleSet !== undefined) {
      problems.push(`${entry.id}:redLine=exempt 但带了规则集 id`)
    }
    if (entry.maxBytes <= 0) problems.push(`${entry.id}:maxBytes 非正`)
    if (entry.kind === 'runtime-injection' && entry.yaml !== undefined) {
      problems.push(`${entry.id}:运行时注入型不应带 YAML 定位`)
    }
    // T2.2 生效半径(矩阵口径):枚举闭合 + 型别绑定 + 注记非空。
    if (!radii.includes(entry.effect.radius)) problems.push(`${entry.id}:生效半径枚举外 ${entry.effect.radius}`)
    if (entry.effect.note.trim() === '') problems.push(`${entry.id}:生效条件注记为空`)
    if (entry.kind === 'line-anchor-readonly' && entry.effect.radius !== 'readonly-upstream') {
      problems.push(`${entry.id}:行锚点只读型的生效半径应为 readonly-upstream`)
    }
    if (entry.kind === 'runtime-injection' && entry.effect.radius !== 'runtime-rebuilt') {
      problems.push(`${entry.id}:运行时注入型的生效半径应为 runtime-rebuilt`)
    }
    if (entry.kind === 'patch-value' && !['immediate-new-session', 'not-composed-anywhere'].includes(entry.effect.radius)) {
      problems.push(`${entry.id}:patch 值型的生效半径应为 immediate-new-session 或 not-composed-anywhere`)
    }
  }
  return { ok: problems.length === 0, problems }
}

// ---------- 写守卫(T1.6 写链路逐条目调用;T1.3 先落型别语义) ----------

/**
 * 写前置检查(fail-closed):行锚点只读型/运行时注入型无 patch 写回落点,拒写并
 * 明示原因——不造写回假象(测试计划 §3 T1.3(b)1)。patch 值型可经「按条目 patch
 * 定位重述写回」(T1.6)。
 */
export function ensureEntryWritable(entry: PromptRegistryEntry): void {
  if (entry.kind === 'line-anchor-readonly') {
    throw new Error(`该条目由上游插件生成,无 patch 写回落点(条目 ${entry.id};写链路 fail-closed 拒写)`)
  }
  if (entry.kind === 'runtime-injection') {
    throw new Error(`该条目为运行时注入型,内容由代码在装配时生成,无 patch 写回落点(条目 ${entry.id};自管改造见 T2.6)`)
  }
}

// ---------- 锚点对账与读值 ----------

/** 文件读取面(file=仓库根相对路径;测试注入真 fs,运行时(T1.4)映射到宿主路径)。 */
export type RegistryFileReader = (file: string) => string

/** 逐锚点核对(行在场且包含片段)。 */
export function checkEntryAnchors(
  entry: PromptRegistryEntry,
  readFile: RegistryFileReader,
): { ok: boolean; problems: readonly string[] } {
  const problems: string[] = []
  for (const anchor of entry.anchors) {
    let lines: readonly string[]
    try {
      lines = readFile(anchor.file).split('\n')
    } catch (error) {
      problems.push(`${anchor.file}:${anchor.line}:文件不可读(${error instanceof Error ? error.message : String(error)})`)
      continue
    }
    const line = lines[anchor.line - 1]
    if (line === undefined) {
      problems.push(`${anchor.file}:${anchor.line}:行不存在(文件共 ${lines.length} 行,锚点漂移)`)
    } else if (!line.includes(anchor.contains)) {
      problems.push(`${anchor.file}:${anchor.line}:行内容不含锚点片段「${anchor.contains}」`)
    }
  }
  return { ok: problems.length === 0, problems }
}

/** 条目当前值读取结果(分型语义)。 */
export interface EntryValueRead {
  readonly entryId: string
  readonly kind: PromptEntryKind
  /** 锚点是否全部在场(对账判据)。 */
  readonly anchorsPresent: boolean
  /** 锚点/读值问题明细(anchorsPresent=false 或 text=null 时非空)。 */
  readonly problems: readonly string[]
  /** 当前值:patch 值型=反引文本(非空);行锚点只读型/运行时注入型=null(无静态值)。 */
  readonly text: string | null
  /** text 的 UTF-8 字节数(无静态值时 null)。 */
  readonly bytes: number | null
  /** 型别注记(只读型/运行时型的「上游运行时生成」标注来源)。 */
  readonly note: string
}

/**
 * 读条目当前值(分型):patch 值型→结构定位+反引(裸/引号标量经 unquoteYamlScalar,
 * 块标量经 readBlockScalarValue;整文件条目→全文);行锚点只读型/运行时注入型→
 * text=null + note 明示。读失败不抛:problems 记明细(对齐 PersonaPatchFile.read
 * 的容错降级纪律)。值读取本体在 readEntryText(运行时读侧 T1.4 复用)。
 */
export function readEntryValue(entry: PromptRegistryEntry, readFile: RegistryFileReader): EntryValueRead {
  const anchorCheck = checkEntryAnchors(entry, readFile)
  const problems = [...anchorCheck.problems]
  if (!anchorCheck.ok) {
    return { entryId: entry.id, kind: entry.kind, anchorsPresent: false, problems, text: null, bytes: null, note: entry.note }
  }
  if (entry.kind !== 'patch-value') {
    return { entryId: entry.id, kind: entry.kind, anchorsPresent: true, problems, text: null, bytes: null, note: entry.note }
  }
  const read = readEntryText(entry, readFile)
  problems.push(...read.problems)
  if (read.text === undefined || read.text === '') {
    problems.push(`${entry.id}:反引值为空(锚点在场但值不可读)`)
    return { entryId: entry.id, kind: entry.kind, anchorsPresent: true, problems, text: null, bytes: null, note: entry.note }
  }
  return {
    entryId: entry.id,
    kind: entry.kind,
    anchorsPresent: true,
    problems,
    text: read.text,
    bytes: byteLength(read.text),
    note: entry.note,
  }
}

/**
 * patch 值型的值读取本体(T1.4 运行时读侧专用;不带对账锚点门):
 * 结构定位 + 标量/块标量反引。行号锚点是「注册表 ↔ 仓库事实源」的对账判据
 * (tests/registry.test.ts 钉住),与运行时「从 live 文件取当前值」是两件事——
 * 运行时读 live patch(t7 隔离档与 eterna-web 档文件布局不同,行号必然错位),
 * 按行号锚校验只会误报,故运行时走本函数(结构定位,不查行号)。
 * 读失败不抛:problems 记明细。
 */
export function readEntryText(
  entry: PromptRegistryEntry,
  readFile: RegistryFileReader,
): { text: string | undefined; problems: readonly string[] } {
  const problems: string[] = []
  if (entry.kind !== 'patch-value') {
    problems.push(`${entry.id}:非 patch 值型,无静态值可读(当前值=null+note 明示)`)
    return { text: undefined, problems }
  }
  try {
    if (entry.yaml === undefined) {
      // 整文件条目(persona.md):值=全文。
      const anchorFile = entry.anchors[0]?.file
      const whole = anchorFile !== undefined ? readFile(anchorFile) : undefined
      if (whole === undefined) problems.push(`${entry.id}:整文件条目无锚点文件`)
      return { text: whole, problems }
    }
    const located = locateYamlConfigKey(entry.yaml, readFile(entry.yaml.file).split('\n'))
    if (located === undefined) {
      problems.push(`${entry.yaml.file}:结构定位失败(rowId=${entry.yaml.rowId},key=${entry.yaml.configKey};live 组合内无该行/插件/键)`)
      return { text: undefined, problems }
    }
    return { text: readYamlValueAtLine(located.lines, located.keyIndex), problems }
  } catch (error) {
    problems.push(`${entry.id}:读值失败(${error instanceof Error ? error.message : String(error)})`)
    return { text: undefined, problems }
  }
}

// ---------- YAML 结构定位与块标量反引(T1.4 读侧/T1.6 写侧的地基) ----------

/** 顶层行(列 0 的 `- id: <rowId>`)span;找不到 → undefined。(T1.6 起导出:写侧定位共用) */
export function findTopLevelRow(lines: readonly string[], rowId: string): { start: number; end: number } | undefined {
  const start = lines.findIndex(line => new RegExp(`^- id: ${rowId}\\s*$`).test(line))
  if (start < 0) return undefined
  let end = lines.length
  for (let i = start + 1; i < lines.length; i += 1) {
    if (/^- id: \S/.test(lines[i] as string)) {
      end = i
      break
    }
  }
  return { start, end }
}

/** 行前导空白宽度(空行/缺行 → Infinity 之外的显式分支由调用方处理)。(T1.6 导出) */
export function indentOf(line: string): number {
  return /^(\s*)/.exec(line)?.[1]?.length ?? 0
}

/**
 * 列表项(`- id: <id>`,缩进 > minIndent)span:到下一处缩进 ≤ 项缩进的非空行。
 * (T1.6 导出:写侧定位共用。)
 */
export function findListItemSpan(
  lines: readonly string[],
  span: { start: number; end: number },
  id: string,
  minIndent: number,
): { start: number; end: number; indent: number } | undefined {
  for (let i = span.start; i < span.end; i += 1) {
    const match = /^(\s*)- id: (\S+)\s*$/.exec(lines[i] as string)
    if (match === null) continue
    const indent = (match[1] ?? '').length
    if (indent <= minIndent || match[2] !== id) continue
    // 同层同名取第一个(规范文件内唯一;0/≥2 的 fail-closed 由 configKey 唯一性兜底)。
    let end = span.end
    for (let j = i + 1; j < span.end; j += 1) {
      const line = lines[j] as string
      if (/^\s*$/.test(line)) continue
      if (indentOf(line) <= indent) {
        end = j
        break
      }
    }
    return { start: i, end, indent }
  }
  return undefined
}

/** 结构定位 config 键行(row→pluginPath→key);0/≥2 命中 → undefined(fail-closed)。 */
export function locateYamlConfigKey(
  locator: YamlLocator,
  lines: readonly string[],
): { keyIndex: number; lines: readonly string[] } | undefined {
  const row = findTopLevelRow(lines, locator.rowId)
  if (row === undefined) return undefined
  let span = row
  let minIndent = 0
  for (const pluginId of locator.pluginPath ?? []) {
    const item = findListItemSpan(lines, span, pluginId, minIndent)
    if (item === undefined) return undefined
    span = { start: item.start, end: item.end }
    minIndent = item.indent
  }
  const keyPattern = new RegExp(`^(\\s*)${locator.configKey}: (.*)$`)
  const matches: number[] = []
  for (let i = span.start; i < span.end; i += 1) {
    const line = lines[i] as string
    const match = keyPattern.exec(line)
    if (match !== null && (match[1] ?? '').length > minIndent) matches.push(i)
  }
  if (matches.length !== 1) return undefined
  return { keyIndex: matches[0] as number, lines }
}

/**
 * 读 YAML 键行的值:裸/单引号/双引号标量经 unquoteYamlScalar(既有语义不动);
 * 块标量(|/> 及 chomping/显式缩进指示符)经 readBlockScalarValue。键值在后续行
 * (嵌套映射)或不可解析 → undefined(fail-closed,不猜)。
 */
export function readYamlValueAtLine(lines: readonly string[], keyIndex: number): string | undefined {
  const line = lines[keyIndex]
  if (line === undefined) return undefined
  const match = /^(\s*)(?:[\w.-]+): (.*)$/.exec(line)
  if (match === null) return undefined
  const raw = (match[2] ?? '').trim()
  if (raw === '') return undefined // 值在后续行(映射/序列),本注册表面不消费
  if (BLOCK_INDICATOR_RE.test(raw)) return readBlockScalarValue(lines, keyIndex)
  return unquoteYamlScalar(raw)
}

/** 块标量头部形态(|/> + chomping/显式缩进指示符,两种顺序都合法)。(T1.6 导出) */
export const BLOCK_INDICATOR_RE = /^[|>](?:[-+]?[0-9]{0,2}|[0-9]{0,2}[-+]?)$/

/** 块标量指示符解析:样式(|字面/>折叠)+ chomping(clip 默认/strip-/keep+)+ 显式缩进。 */
export interface BlockHeader {
  readonly style: '|' | '>'
  readonly chomp: 'clip' | 'strip' | 'keep'
  readonly explicitIndent: number | null
  readonly keyIndent: number
}

/**
 * 解析键行的块标量头(`key: |`/`key: >-` 等;T1.6 写侧与 readBlockScalarValue 共用)。
 * 非块标量键行(标量值/嵌套映射)→ undefined。
 */
export function parseBlockHeader(lines: readonly string[], keyIndex: number): BlockHeader | undefined {
  const line = lines[keyIndex]
  if (line === undefined) return undefined
  const headerMatch = /^(\s*)[\w.-]+: ([|>](?:[-+]?[0-9]{0,2}|[0-9]{0,2}[-+]?))\s*$/.exec(line)
  if (headerMatch === null) return undefined
  const indicator = headerMatch[2] ?? ''
  const digits = /\d+/.exec(indicator)?.[0] ?? null
  return {
    style: indicator.startsWith('>') ? '>' : '|',
    chomp: indicator.includes('-') ? 'strip' : indicator.includes('+') ? 'keep' : 'clip',
    explicitIndent: digits !== null ? Number.parseInt(digits, 10) : null,
    keyIndent: (headerMatch[1] ?? '').length,
  }
}

/**
 * 块标量反引(独立函数,不动 unquoteYamlScalar 对块标量返回 undefined 的既有语义——
 * tests/persona-patch.test.ts:88-89 基线不破):
 * - 内容行 = 键行之后缩进 > 键缩进 的行(空行参与,尾部空行按 chomping 处理);
 * - 字面块 |:行按 \n 连接;折叠块 >:相邻非空行折叠为空格,k 个连续空行 → k 个换行
 *   (本仓数据无 more-indented 行,该分支未实现为显式限制);
 * - chomping:strip(-)去尾换行、clip(默认)保留单个尾换行、keep(+)全保留。
 */
export function readBlockScalarValue(lines: readonly string[], keyIndex: number): string | undefined {
  const header = parseBlockHeader(lines, keyIndex)
  if (header === undefined) return undefined
  // 收集内容行:空行暂收,遇缩进 ≤ 键缩进的非空行即止(其后空行不属本块)。
  const collected: string[] = []
  for (let i = keyIndex + 1; i < lines.length; i += 1) {
    const current = lines[i] as string
    if (/^\s*$/.test(current)) {
      collected.push('')
      continue
    }
    if (indentOf(current) <= header.keyIndent) break
    collected.push(current)
  }
  // 尾部空行剥离(chomping 再按需补回;keep 需要先数清尾部空行数)。
  let trailingBlanks = 0
  while (collected.length > 0 && collected[collected.length - 1] === '') {
    collected.pop()
    trailingBlanks += 1
  }
  if (collected.length === 0) return ''
  const contentIndent = header.explicitIndent !== null
    ? header.keyIndent + header.explicitIndent
    : indentOf(collected[0] ?? '')
  const stripped = collected.map(row => row.slice(Math.min(contentIndent, row.length)))
  const lastNonEmpty = stripped.reduce((acc, row, i) => (row === '' ? acc : i), 0)
  const body = stripped.slice(0, lastNonEmpty + 1)
  const content = header.style === '|'
    ? body.join('\n')
    : foldBlockLines(body)
  if (header.chomp === 'strip') return content
  if (header.chomp === 'keep') return `${content}\n${'\n'.repeat(trailingBlanks + 1)}`
  return `${content}\n`
}

/** 折叠块行:相邻非空行接空格;k 个连续空行 → k 个换行(首行前的空行忽略)。 */
function foldBlockLines(rows: readonly string[]): string {
  let out = ''
  let blanks = 0
  let started = false
  for (const row of rows) {
    if (row === '') {
      if (started) blanks += 1
      continue
    }
    if (!started) {
      out = row
      started = true
      continue
    }
    out += blanks > 0 ? '\n'.repeat(blanks) : ' '
    blanks = 0
    out += row
  }
  return out
}
