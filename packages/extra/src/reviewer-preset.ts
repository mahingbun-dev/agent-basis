/**
 * reviewer preset:只读审查 subagent 的 preset 配置产物。
 *
 * 设计依据(设计文档 08 §3 表 #12):「只读审查 subagent preset(工具白名单:
 * Read/Grep/Glob),供领域包 "verify work" 步使用 | subagent preset、persona」。
 *
 * 产物 = 可直接粘进 DSH profile 的 Cordis 插件行组合(data,不是代码):
 * 1. `@deepseek-ai/dsh-agent-preset` 行:声明 preset id + 子插件列表
 *    (packages/preset/agent-preset/README.md「Use this package」);
 * 2. `@deepseek-ai/dsh-persona` 行(preset 内):persona prefix/suffix 模板,
 *    scope-only 行,给该 subagent 独立身份(挂全局会与 prompt registry 冲突);
 * 3. 工具门行(`@basis/extra` 模块 reviewer-tool-gate):preset 内挂载后调用
 *    `ctx.tools.restrict({ allow })`(packages/core/tools/README.md「Restrict
 *    tools per agent」)——allow 名单即 Read/Grep/Glob 的 DSH 工具名映射;
 * 4. `@deepseek-ai/dsh-tool-subagent` 委派行:provider=spawn + agentPreset
 *    指向本 preset(in-process spawn 支持独立 agentPreset;fork/外部后端
 *    拒绝该选项——packages/subagent/subagent/README.md「Child presets」)。
 *
 * Read/Grep/Glob → DSH 工具名映射(packages/fs/README.md 包表):
 * - Read  → `read`(tool-fs;read_image 为可选加列)
 * - Grep  → `grep`(tool-fs-search)
 * - Glob  → `glob`(tool-fs-search)
 *
 * schema 校验(validateReviewerPresetArtifact)fail-closed:任何结构/语义
 * 违规(空 allow、混入变更型工具、subagent 行 preset 脱钩等)整包拒收。
 */
import { stringify } from 'yaml'
import { ExtraConfigError } from './errors.ts'
import type { ToolRestriction } from '@deepseek-ai/dsh-tools'
import type { Config as PersonaConfig } from '@deepseek-ai/dsh-persona'

/** 只读工具词汇表:允许出现在 reviewer allow 名单里的全部 DSH 工具名。 */
export const READ_ONLY_TOOL_VOCABULARY: readonly string[] = ['read', 'read_image', 'grep', 'glob']

/** 默认 allow 名单:Read/Grep/Glob 语义的最小集(read_image 按需加列)。 */
export const DEFAULT_REVIEWER_ALLOW: readonly string[] = ['read', 'grep', 'glob']

/**
 * 变更/出网型工具的拒绝 glob(出现即校验失败;语义黑名单而非穷举白名单,
 * 与词汇表白名单双保险):write/edit/apply_patch 等文件变更、shell 执行、
 * 出网、MCP 全域。
 */
export const REVIEWER_DENY_GLOBS: readonly string[] = ['write', 'edit', 'apply_patch', 'str_replace_editor', 'bash', 'shell*', 'run_code', 'web_*', 'http_*', 'fetch_*', 'mcp__*', 'memory_write', 'memory_forget', 'knowledge_propose']

/** Cordis 插件行(装载器通用形态;本产物只产数据行)。 */
export interface PluginRow {
  /** 行 id(profile 内寻址;嵌套组以 `:` 连接)。 */
  readonly id?: string
  /** 插件包名(cordis:group 等内置前缀亦可)。 */
  readonly name: string
  /** 组标记(cordis:group 行专用)。 */
  readonly group?: boolean
  readonly config?: unknown
}

/** agent-preset 声明行(packages/preset/agent-preset Config=PresetDefinition 的最小结构面)。 */
export interface AgentPresetRowConfig {
  readonly id: string
  readonly name?: string
  readonly description?: string
  readonly plugins: readonly PluginRow[]
}

/** tool-subagent 委派行配置(packages/subagent/tool-subagent README 配置面)。 */
export interface ToolSubagentRowConfig {
  readonly provider: string
  readonly toolName: string
  readonly agentPreset?: string
}

/** reviewer preset 产物(schema v1)。 */
export interface ReviewerPresetArtifact {
  readonly schemaVersion: 1
  /** agent-preset 声明行(preset.id 即 subagent 委派引用的 agentPreset)。 */
  readonly preset: AgentPresetRowConfig
  /** persona 行(preset.plugins 成员的规范形态快照,校验基准)。 */
  readonly persona: { readonly plugin: '@deepseek-ai/dsh-persona'; readonly config: PersonaConfig }
  /** 工具门行(preset.plugins 成员的规范形态快照,allow 即 restrict 名单)。 */
  readonly toolGate: { readonly plugin: '@basis/extra'; readonly config: { readonly module: 'reviewer-tool-gate'; readonly allow: readonly string[] } }
  /** subagent 委派行(宿主 profile 侧挂载,不在 preset.plugins 内)。 */
  readonly subagent: { readonly plugin: '@deepseek-ai/dsh-tool-subagent'; readonly config: ToolSubagentRowConfig }
}

export interface BuildReviewerPresetOptions {
  /** preset 身份 id(会话快照保存该 id);默认 'basis-reviewer'。 */
  readonly presetId?: string
  /** 委派工具名;默认 'reviewer'。 */
  readonly toolName?: string
  /** allow 名单;缺省 DEFAULT_REVIEWER_ALLOW。必须 ⊆ READ_ONLY_TOOL_VOCABULARY。 */
  readonly allow?: readonly string[]
  /** persona 前缀覆写(缺省用 reviewerPersonaPrefix 模板)。 */
  readonly personaPrefix?: string
  /** persona 后缀覆写;缺省空串(persona 行语义:空串 = 遮蔽全局 suffix)。 */
  readonly personaSuffix?: string
}

/**
 * reviewer persona 前缀模板(纯文本,无 `{{…}}` 占位——dsh persona 模板对
 * 未注册变量是严格插值,未知占位符会让 assembly 失败,故模板不放变量)。
 * focus 段落按需拼接(调用方自由组合,不经过插值)。
 */
export function reviewerPersonaPrefix(focus?: string): string {
  const base = [
    '你是一名只读审查员(reviewer):只阅读、检索、核对,不修改任何文件,不执行任何命令,不访问任何网络。',
    '你的职责是对指定的工作产物做独立核查:按任务要求用 read/grep/glob 收集证据,给出「通过 / 不通过 + 证据引用(文件路径与行号或匹配片段)」的结论。',
    '你没有写入工具,也不得建议以你的名义执行写入;发现问题时,把问题、位置、建议修法写进审查报告,由主 agent 决定是否修改。',
    '审查报告必须可追溯:每条结论附至少一处证据引用;无法取证时如实写「未能核实」,不得猜测。',
  ].join('\n')
  return focus === undefined || focus.trim() === '' ? base : `${base}\n本次审查重点:${focus.trim()}`
}

/** 生成 reviewer preset 产物(构造期校验选项,fail-closed 抛 ExtraConfigError)。 */
export function buildReviewerPreset(options: BuildReviewerPresetOptions = {}): ReviewerPresetArtifact {
  const presetId = options.presetId ?? 'basis-reviewer'
  if (!/^[a-z][a-z0-9-]*$/u.test(presetId)) {
    throw new ExtraConfigError(`presetId 必须是小写 kebab-case(会话快照保存该 id):${presetId}`)
  }
  const toolName = options.toolName ?? 'reviewer'
  if (!/^[a-z][a-z0-9_]*$/u.test(toolName)) throw new ExtraConfigError(`toolName 必须是小写工具名:${toolName}`)
  const allow = [...new Set(options.allow ?? DEFAULT_REVIEWER_ALLOW)]
  const vocabularyError = validateAllowAgainstVocabulary(allow)
  if (vocabularyError !== undefined) throw new ExtraConfigError(vocabularyError)
  const prefix = options.personaPrefix ?? reviewerPersonaPrefix()
  if (prefix.trim() === '') throw new ExtraConfigError('persona prefix 不能为空(reviewer 的身份声明)')
  const personaConfig: PersonaConfig = { prefix, suffix: options.personaSuffix ?? '', includeRuntimeContext: false }
  const toolGateConfig = { module: 'reviewer-tool-gate' as const, allow }
  const preset: AgentPresetRowConfig = {
    id: presetId,
    name: 'Basis 只读审查员',
    description: '只读审查 subagent:read/grep/glob 白名单 + 独立 persona,供领域包 verify work 步委派。',
    plugins: [
      { id: 'reviewer-persona', name: '@deepseek-ai/dsh-persona', config: personaConfig },
      { id: 'reviewer-tool-gate', name: '@basis/extra', config: toolGateConfig },
    ],
  }
  return {
    schemaVersion: 1,
    preset,
    persona: { plugin: '@deepseek-ai/dsh-persona', config: personaConfig },
    toolGate: { plugin: '@basis/extra', config: toolGateConfig },
    subagent: {
      plugin: '@deepseek-ai/dsh-tool-subagent',
      config: { provider: 'spawn', toolName, agentPreset: presetId },
    },
  }
}

function validateAllowAgainstVocabulary(allow: readonly string[]): string | undefined {
  if (allow.length === 0) return 'allow 名单不能为空(空名单 = 无工具,subagent 无法工作)'
  for (const tool of allow) {
    if (!READ_ONLY_TOOL_VOCABULARY.includes(tool)) {
      return `allow 名单含非只读工具 "${tool}"(词汇表:${READ_ONLY_TOOL_VOCABULARY.join('/')})`
    }
  }
  return undefined
}

/** schema 校验结果。 */
export type ReviewerPresetValidation =
  | { readonly ok: true }
  | { readonly ok: false; readonly errors: readonly string[] }

/**
 * 产物 schema 校验(fail-closed):结构 + 语义全检,返回全部错误(不首发即停)。
 * 校验通过的产物才允许写进 profile / 交给组合层。
 */
export function validateReviewerPresetArtifact(artifact: unknown): ReviewerPresetValidation {
  const errors: string[] = []
  if (!isRecord(artifact)) return { ok: false, errors: ['产物必须是对象'] }
  if (artifact['schemaVersion'] !== 1) errors.push(`schemaVersion 必须是 1,得到:${JSON.stringify(artifact['schemaVersion'])}`)
  // preset 行
  const preset = artifact['preset']
  let presetId: string | undefined
  if (isRecord(preset) && typeof preset['id'] === 'string' && Array.isArray(preset['plugins'])) {
    presetId = preset['id']
    if (!/^[a-z][a-z0-9-]*$/u.test(presetId)) errors.push(`preset.id 必须是小写 kebab-case:${JSON.stringify(presetId)}`)
    for (const row of preset['plugins']) {
      if (!isRecord(row) || typeof row['name'] !== 'string') errors.push(`preset.plugins 行缺 name:${JSON.stringify(row)}`)
    }
  } else {
    errors.push('preset 必须是 { id: string, plugins: PluginRow[] }')
  }
  // persona 行
  const persona = artifact['persona']
  if (!isRecord(persona) || persona['plugin'] !== '@deepseek-ai/dsh-persona') {
    errors.push('persona.plugin 必须是 @deepseek-ai/dsh-persona')
  }
  const personaConfig = isRecord(persona) ? persona['config'] : undefined
  if (!isRecord(personaConfig)) {
    errors.push('persona.config 必须是对象')
  } else {
    if (typeof personaConfig['prefix'] !== 'string' || personaConfig['prefix'].trim() === '') errors.push('persona.config.prefix 必须是非空字符串')
    if (personaConfig['suffix'] !== undefined && typeof personaConfig['suffix'] !== 'string') errors.push('persona.config.suffix 若提供必须是字符串')
    if (personaConfig['includeRuntimeContext'] !== false) errors.push('persona.config.includeRuntimeContext 必须显式 false(只读审查不需要动态运行时上下文)')
  }
  // 工具门行
  const toolGate = artifact['toolGate']
  if (!isRecord(toolGate)) {
    errors.push('toolGate 必须是对象')
  } else {
    if (toolGate['plugin'] !== '@basis/extra') errors.push(`toolGate.plugin 必须是 @basis/extra,得到:${JSON.stringify(toolGate['plugin'])}`)
    const gateConfig = toolGate['config']
    if (!isRecord(gateConfig)) {
      errors.push('toolGate.config 必须是对象')
    } else {
      if (gateConfig['module'] !== 'reviewer-tool-gate') errors.push(`toolGate.config.module 必须是 reviewer-tool-gate,得到:${JSON.stringify(gateConfig['module'])}`)
      const allow = gateConfig['allow']
      if (!Array.isArray(allow) || allow.length === 0 || !allow.every(t => typeof t === 'string')) {
        errors.push('toolGate.config.allow 必须是非空字符串数组')
      } else {
        errors.push(...checkAllowSemantics(allow))
      }
    }
  }
  // subagent 委派行
  const subagent = artifact['subagent']
  if (!isRecord(subagent)) {
    errors.push('subagent 必须是对象')
  } else {
    if (subagent['plugin'] !== '@deepseek-ai/dsh-tool-subagent') errors.push(`subagent.plugin 必须是 @deepseek-ai/dsh-tool-subagent,得到:${JSON.stringify(subagent['plugin'])}`)
    const subConfig = subagent['config']
    if (!isRecord(subConfig)) {
      errors.push('subagent.config 必须是对象')
    } else {
      if (subConfig['provider'] !== 'spawn') errors.push(`subagent.config.provider 必须是 spawn(独立 agentPreset 仅 in-process spawn 支持;fork/外部后端拒绝该选项),得到:${JSON.stringify(subConfig['provider'])}`)
      if (typeof subConfig['toolName'] !== 'string' || subConfig['toolName'] === '') errors.push('subagent.config.toolName 必须是非空字符串')
      if (subConfig['agentPreset'] !== presetId) errors.push(`subagent.config.agentPreset(${JSON.stringify(subConfig['agentPreset'])})必须等于 preset.id(${JSON.stringify(presetId)})`)
    }
  }
  return errors.length === 0 ? { ok: true } : { ok: false, errors }
}

function checkAllowSemantics(allow: string[]): string[] {
  const errors: string[] = []
  for (const tool of allow) {
    if (!READ_ONLY_TOOL_VOCABULARY.includes(tool)) errors.push(`allow 名单含词汇表外工具 "${tool}"(仅 ${READ_ONLY_TOOL_VOCABULARY.join('/')})`)
    for (const glob of REVIEWER_DENY_GLOBS) {
      if (matchGlobSimple(tool, glob)) errors.push(`allow 名单命中变更/出网拒绝项 "${tool}"(deny glob:${glob})`)
    }
  }
  if (new Set(allow).size !== allow.length) errors.push('allow 名单存在重复项')
  return errors
}

/** 极简 glob:`*` 任意串,整串锚定(与 @basis/governance glob 语义同源)。 */
function matchGlobSimple(name: string, glob: string): boolean {
  const source = glob.split('*').map(segment => segment.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')).join('.*')
  return new RegExp(`^${source}$`, 'u').test(name)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** 把产物渲染为可直接粘进 profile 的插件行 YAML(先校验,后渲染)。 */
export function renderReviewerPresetYaml(artifact: ReviewerPresetArtifact): string {
  const validation = validateReviewerPresetArtifact(artifact)
  if (!validation.ok) throw new ExtraConfigError(`产物未过 schema 校验,拒绝渲染:${validation.errors.join(';')}`)
  const rows: PluginRow[] = [
    {
      id: `preset-${artifact.preset.id}`,
      name: '@deepseek-ai/dsh-agent-preset',
      config: artifact.preset,
    },
    {
      id: 'tool-reviewer',
      name: '@deepseek-ai/dsh-tool-subagent',
      config: artifact.subagent.config,
    },
  ]
  return stringify(rows)
}

/** 工具门宿主 seam:`ctx.tools.restrict` 的结构面(effect 配逆:返回解除器)。 */
export interface ToolGateHost {
  restrict(filter: ToolRestriction): () => void
}

/**
 * 挂载 reviewer 工具门:在 agent 作用域内把可见工具遮罩为 allow 名单。
 * 返回解除器(= ctx.tools.restrict 的原生 disposer,配逆闭包直通)。
 * 只允许在 agent 作用域调用(全局遮罩会波及所有 agent——dsh 自身会拒绝
 * 无 scope 的 restrict,这里前置防御)。
 */
export function applyReviewerToolGate(host: ToolGateHost, allow: readonly string[], scopeName = 'reviewer'): () => void {
  if (allow.length === 0) throw new ExtraConfigError(`[${scopeName}] 工具门 allow 名单为空`)
  const semanticError = validateAllowAgainstVocabulary([...allow])
  if (semanticError !== undefined) throw new ExtraConfigError(`[${scopeName}] ${semanticError}`)
  return host.restrict({ allow: [...allow] })
}
