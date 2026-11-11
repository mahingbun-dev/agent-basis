/**
 * 历史会话严格回放(T2.4,计划书 §6「`system-prompt/assemble` 监听按会话快照
 * 替换条目文本」;测试计划 §4 T2.4):全局未打标 assemble waterfall 监听,
 * 按 `context.agent.id`(sessionId,spike 实证=会话身份)查 T2.3 会话快照,
 * 逐段把 patch 值型条目文本替换回快照值——新会话读最新(快照=开启时现值)、
 * 旧会话全程沿用快照、快照缺席降级用当前值(不替换、不炸宿主)。
 *
 * 机制依据 spike 报告 docs/dev/ps-v2-spike.md(0.2.2-rc.1 真宿主 27/27):
 * - waterfall 文本权威:`AssembledSection.text` 可变,监听器改写原样生效;
 * - 会话身份是**未声明字段** `context.agent.id`(§四.1):防御式访问,缺席
 *   跳过替换并审计;dsh 0.2.2-rc.x 升级须回归本字段在场;
 * - `complete: true` 段在场时上游在 waterfall 后把 sections 恢复为该段独一
 *   (§四.2):替换会被静默丢弃——对 patch 配置可检测的来源(dsh-persona 行
 *   config.complete)做在场检测,在场则跳过并审计;代码注册来源(dsh-subagent
 *   子代理 persona)不可检测,替换被上游丢弃亦无害(fail-safe);
 * - 监听器必须**未打标**(插件全局 ctx 注册)才收得到全部会话的组装(§四.4);
 * - 只替换文本面,工具声明 provider-owned(§四.3)。
 *
 * 段落名真值(上游源码,勿凭记忆改):
 * - `deployment:persona-prefix` = dsh-system-prompt PERSONA_PREFIX_SECTION
 *   (lib/types/index.d.ts; preset 内 dsh-persona 行与部署/pack system-prompt
 *   行的 personaPrefix 都落在这一段名上,scoped shadow global);
 * - `plan:policy` = dsh-plan-mode 注册的段(lib/index.js PlanModeController,
 *   文本= config.section,plan 模式未激活时 provider 返回 '')。
 *
 * 身份判定(哪个条目治理当前段):比较「当前段文本」与各候选条目的
 * **live 值**(读 live patch)——**唯一**命中者即治理条目,替换为该条目的
 * **快照值**;live 无命中时回退比较各候选条目的**快照值**(旧会话的 scoped
 * 层持久持有旧实例时,段文本本就等于快照旧值,身份只能经快照解析,同样要求
 * 唯一命中)。任一路多候选同文(身份不可判定)或两路都不命中即跳过
 * (fail-safe:段文本来自未登记源/子代理自有 persona/两预设同段被改成同文,
 * 张冠李戴风险,绝不盲替)。比较按规范化(行尾/首尾空白归一)判等,替换值
 * 用快照原文逐字。
 */
import type { RegistryFileReader, PromptRegistryEntry } from './registry.ts'
import {
  PROMPT_REGISTRY_ENTRIES, findListItemSpan, findTopLevelRow, indentOf, locateYamlConfigKey, readEntryText,
} from './registry.ts'
import type { SessionSnapshotRecord } from './types.ts'

/** assemble waterfall 事件名(dsh-system-prompt Events 契约)。 */
export const ASSEMBLE_EVENT = 'system-prompt/assemble'

/** persona 前缀段名(上游 PERSONA_PREFIX_SECTION;preset 与部署/pack 同名 shadow)。 */
export const PERSONA_PREFIX_SECTION_NAME = 'deployment:persona-prefix'

/** plan 模式段名(上游 dsh-plan-mode 注册;文本=config.section,未激活时为空)。 */
export const PLAN_POLICY_SECTION_NAME = 'plan:policy'

/** 跳过原因常量(审计与测试共用;见各常量注)。 */

/** 会话身份缺席(context.agent 未声明字段缺失——spike §四.1 防御式访问)。 */
export const SKIP_NO_AGENT_ID = 'no-agent-id(组装上下文无会话身份 context.agent.id,spike 未声明字段缺席,跳过替换)'

/** 会话无快照(插件装载前创建/捕获失败)——降级用当前值。 */
export const SKIP_SNAPSHOT_ABSENT = 'snapshot-absent(会话无快照:可能在插件装载前创建或捕获失败;降级用当前值)'

/** 段不在本部署组装内(该条目未参与本次组装,如未装载 plan-mode)。 */
export const SKIP_SECTION_ABSENT = 'section-absent(段落不在本次组装内,该条目未参与)'

/** 快照条目无文本(捕获时读值失败)——不伪造,跳过。 */
export const SKIP_SNAPSHOT_TEXT_NULL = 'snapshot-text-null(快照捕获时该条目读值失败,无文本可回放)'

/** 治理条目不可判定(段文本与全部候选的 live 值/快照值都不一致)。 */
export const SKIP_GOVERNING_UNKNOWN = 'governing-entry-unknown(段文本与候选条目 live 值/快照值均不匹配:来自未登记源或子代理自有 persona,盲替有张冠李戴风险,fail-safe 跳过)'

/** live 值多候选同文而快照值互异(身份不可判定——如两预设同段文本被先后改成同文)。 */
export const SKIP_GOVERNING_AMBIGUOUS = 'governing-entry-ambiguous(live 值多候选同文,无法判定会话用的是哪个条目,盲取首个可能替换成错误条目的快照旧文——fail-safe 跳过)'

/** 治理条目的插件 config 声明 complete: true(spike §四.2)。 */
export const SKIP_COMPLETE_OWNER = 'complete-section-owner(治理条目所属插件 config 声明 complete: true,上游在 waterfall 后恢复该段为唯一段,替换必被丢弃——跳过并审计)'

/** 段文本为空(如 plan 模式未激活):该条目本次未参与组装,无文本可回放。 */
export const SKIP_SECTION_EMPTY = 'section-empty(段文本为空——如 plan 模式未激活,该条目本次未参与组装,无文本可回放)'

/** 运行时注入型:装配时动态构建,跳过回放(T2.3 分型语义)。
 * (原 SKIP_READONLY_KIND(line-anchor-readonly)随 2026-11-11 用户裁定移除:
 * time-context 等纯运行时数据注入器不再登记,该型别无使用者,分支一并清除。) */
export const SKIP_RUNTIME_KIND = 'runtime-injection(文本装配时动态构建,跳过回放)'

/** patch 值型但无段落映射(数值配置条目/无运行时注入点的文件基准条目)。 */
export const SKIP_NO_SECTION_MAPPING = 'no-section-mapping(条目无对应系统提示段落:数值配置或无运行时注入点的文件基准,无可替换面)'

/** 段名 → 候选条目 id(注册表序即候选优先序)。 */
export interface ReplaySectionMapping {
  readonly sectionName: string
  readonly entryIds: readonly string[]
}

/**
 * 回放段落映射(preset persona 与部署/pack personaPrefix 同段名互为 shadow;
 * plan-mode 两预设同段名)。身份判定保证只替换「当前段文本恰好是某候选 live
 * 值(或快照值)」的会话段,跨预设/跨 pack 不会张冠李戴。
 */
export const REPLAY_SECTION_MAPPINGS: readonly ReplaySectionMapping[] = [
  {
    sectionName: PERSONA_PREFIX_SECTION_NAME,
    entryIds: [
      'preset.standard.persona',
      'preset.cordis.persona',
      'domain.event-planning.persona-prefix',
      'domain.industrial-analysis.persona-prefix',
    ],
  },
  {
    sectionName: PLAN_POLICY_SECTION_NAME,
    entryIds: [
      'preset.standard.plan-mode.section',
      'preset.cordis.plan-mode.section',
    ],
  },
]

/** 映射覆盖的条目 id 集(测试与跳过原因分派共用)。 */
export function replayMappedEntryIds(): Set<string> {
  const ids = new Set<string>()
  for (const mapping of REPLAY_SECTION_MAPPINGS) {
    for (const id of mapping.entryIds) ids.add(id)
  }
  return ids
}

/** 单段的回放结局(replaced=已替换 / governed=身份经快照解析且已在快照值 / skipped=跳过)。 */
export interface ReplaySectionOutcome {
  readonly sectionName: string
  readonly outcome: 'replaced' | 'governed' | 'skipped'
  /** replaced/governed 时的治理条目 id;skipped 时可缺席。 */
  readonly entryId?: string
  /** skipped 时的原因(常量,审计透传)。 */
  readonly reason?: string
}

/** 未映射条目的跳过记录(运行时型/无段落 patch 值型;T2.4「跳过并记录原因」)。 */
export interface ReplaySkippedEntry {
  readonly entryId: string
  readonly reason: string
}

/** 一次组装的回放解析结果(纯函数产出;网关按此审计)。 */
export interface AssemblyReplayResult {
  /** 会话身份(缺席 → null + degraded=SKIP_NO_AGENT_ID)。 */
  readonly sessionId: string | null
  /** 整体降级原因(no-agent-id / snapshot-absent;正常 null)。 */
  readonly degraded: string | null
  /** 映射段的逐段结局。 */
  readonly sections: readonly ReplaySectionOutcome[]
  /** 未映射条目的跳过记录(按注册表序)。 */
  readonly skippedEntries: readonly ReplaySkippedEntry[]
}

/** waterfall 组装段落的最小结构面(上游 AssembledSection 的 text 可变)。 */
export interface ReplayAssembledSection {
  name: string
  text: string
}

/** 身份比较规范化:行尾统一 + 首尾空白归一(YAML 解析器间尾换行差异不算值变)。 */
function matchKey(text: string): string {
  return text.replace(/\r\n?/g, '\n').trim()
}

/**
 * 防御式提取会话身份(spike §四.1:context.agent 是上游未声明字段,缺席必须
 * 跳过而不是猜)。非字符串/空白 → undefined。
 */
export function agentIdOfAssembleContext(context: unknown): string | undefined {
  if (typeof context !== 'object' || context === null) return undefined
  const agent = (context as { readonly agent?: unknown }).agent
  if (typeof agent !== 'object' || agent === null) return undefined
  const id = (agent as { readonly id?: unknown }).id
  return typeof id === 'string' && id.trim() !== '' ? id : undefined
}

/**
 * 条目所属插件 config 是否声明 `complete: true`(spike §四.2 complete 段在场
 * 检测的 patch 可检测面):按条目 YAML 定位(rowId→pluginPath→configKey)找到
 * 条目自身 config 键行,再在**同缩进的兄弟键行**里找 `complete: true`——
 * 只认与 prefix/section 等键同级的行,块标量(|/>-)正文行(缩进更深)不参与,
 * 防止提示词文本里恰好出现字面 `complete: true` 行而误判。定位不可得 → false
 * (不可判定按无 flag 处理,替换被上游丢弃亦无害)。
 */
export function pluginSpanOwnsCompleteFlag(entry: PromptRegistryEntry, readFile: RegistryFileReader): boolean {
  const yaml = entry.yaml
  if (yaml === undefined || yaml.pluginPath === undefined || yaml.pluginPath.length === 0) return false
  try {
    const lines = readFile(yaml.file).split('\n')
    const located = locateYamlConfigKey(yaml, lines)
    if (located === undefined) return false
    const keyIndent = indentOf(lines[located.keyIndex] ?? '')
    // 扫描范围钉在最内层插件列表项 span 内(防其他行/其他插件同缩进的 complete 行)。
    let span = findTopLevelRow(lines, yaml.rowId)
    if (span === undefined) return false
    let minIndent = 0
    for (const pluginId of yaml.pluginPath) {
      const item = findListItemSpan(lines, span, pluginId, minIndent)
      if (item === undefined) return false
      span = { start: item.start, end: item.end }
      minIndent = item.indent
    }
    return lines.slice(span.start, span.end)
      .some(line => indentOf(line) === keyIndent && /^\s*complete:\s*true\s*$/.test(line))
  } catch {
    return false
  }
}

/** 一次解析的输入(纯函数;网关注入侧 readFile 带每次组装的 memoize,同一文件只读一次)。 */
export interface AssemblyReplayInput {
  /** 本次组装的段列表(text 原地替换)。 */
  readonly sections: readonly ReplayAssembledSection[]
  /** 上游 assemble 上下文(agent/scope/…;防御式访问)。 */
  readonly context: unknown
  /** 会话快照(缺席=降级)。 */
  readonly snapshot: SessionSnapshotRecord | undefined
  /** 注册表条目(缺省=全量登记)。 */
  readonly entries?: readonly PromptRegistryEntry[]
  /** live 值读取面(live patch / pack 文件)。 */
  readonly readFile: RegistryFileReader
  /** complete 标志预计算面(entryId → 是否 complete-owner;缺省=现场扫描落盘读取面)。 */
  readonly completeFlags?: ReadonlyMap<string, boolean>
}

/**
 * 回放解析本体(纯函数,不落盘不审计):逐映射段做身份判定与替换,未映射
 * 条目按型别记跳过原因。绝不清空/删除段,绝不动非映射段与工具声明。
 */
export function resolveAssemblyReplay(input: AssemblyReplayInput): AssemblyReplayResult {
  const sessionId = agentIdOfAssembleContext(input.context)
  if (sessionId === undefined) {
    return { sessionId: null, degraded: SKIP_NO_AGENT_ID, sections: [], skippedEntries: [] }
  }
  if (input.snapshot === undefined) {
    return { sessionId, degraded: SKIP_SNAPSHOT_ABSENT, sections: [], skippedEntries: [] }
  }
  const entries = input.entries ?? PROMPT_REGISTRY_ENTRIES
  const byId = new Map(entries.map(entry => [entry.id, entry]))
  const snapshotEntryOf = (entryId: string) => input.snapshot?.entries.find(candidate => candidate.entryId === entryId)
  // live 值缓存(条目 → 文本);一次组装内同文件只读一次(调用方 readFile 亦可再 memoize)。
  const liveTextCache = new Map<string, string | undefined>()
  const liveTextOf = (entry: PromptRegistryEntry): string | undefined => {
    if (liveTextCache.has(entry.id)) return liveTextCache.get(entry.id)
    const text = readEntryText(entry, input.readFile).text
    liveTextCache.set(entry.id, text)
    return text
  }
  const sections: ReplaySectionOutcome[] = []
  for (const mapping of REPLAY_SECTION_MAPPINGS) {
    const section = input.sections.find(candidate => candidate.name === mapping.sectionName)
    if (section === undefined) {
      sections.push({ sectionName: mapping.sectionName, outcome: 'skipped', reason: SKIP_SECTION_ABSENT })
      continue
    }
    const candidates = mapping.entryIds.map(id => byId.get(id)).filter((entry): entry is PromptRegistryEntry => entry !== undefined)
    // complete 段在场检测(spike §四.2):候选中任一条目 complete-owner → 整段跳过
    // (标志走调用方预计算面——网关侧 TTL 缓存;缺省现场扫描)。
    const ownsComplete = (entry: PromptRegistryEntry): boolean =>
      input.completeFlags?.get(entry.id) ?? pluginSpanOwnsCompleteFlag(entry, input.readFile)
    if (candidates.some(entry => ownsComplete(entry))) {
      sections.push({ sectionName: mapping.sectionName, outcome: 'skipped', reason: SKIP_COMPLETE_OWNER })
      continue
    }
    const sectionKey = matchKey(section.text)
    if (sectionKey === '') {
      // 空段(如 plan 模式未激活):无文本可回放,也无可比对身份。
      sections.push({ sectionName: mapping.sectionName, outcome: 'skipped', reason: SKIP_SECTION_EMPTY })
      continue
    }
    // ① live 值命中(标准情形:段文本=当前 live 配置,快照持有开启时旧值)。
    // 与②对称的**唯一性**要求:同段名多候选(preset×2/领域 personaPrefix 同段名
    // shadow)可能 live 同文(如两预设 plan 段基线今日逐字相同)——多候选命中而
    // 快照值互异时无法判定会话用的是哪个条目,盲取首个会把旧会话替换成**错误
    // 条目**的快照旧文,故歧义即跳过(fail-safe)。
    const liveMatches = candidates.filter((entry) => {
      const live = liveTextOf(entry)
      return live !== undefined && live !== '' && matchKey(live) === sectionKey
    })
    if (liveMatches.length > 1) {
      sections.push({ sectionName: mapping.sectionName, outcome: 'skipped', reason: SKIP_GOVERNING_AMBIGUOUS })
      continue
    }
    const liveMatch = liveMatches[0]
    if (liveMatch !== undefined) {
      const snapshotText = snapshotEntryOf(liveMatch.id)?.text
      if (snapshotText === null || snapshotText === undefined) {
        sections.push({ sectionName: mapping.sectionName, outcome: 'skipped', entryId: liveMatch.id, reason: SKIP_SNAPSHOT_TEXT_NULL })
        continue
      }
      if (matchKey(snapshotText) === sectionKey) {
        // 已在快照值(live 未变,或仅解析器空白差异):身份已定,无需替换。
        sections.push({ sectionName: mapping.sectionName, outcome: 'governed', entryId: liveMatch.id })
        continue
      }
      section.text = snapshotText
      sections.push({ sectionName: mapping.sectionName, outcome: 'replaced', entryId: liveMatch.id })
      continue
    }
    // ② 快照值命中(scoped 层持久持有旧实例的旧会话:段文本=快照旧值,身份经快照解析)。
    const snapshotMatches = candidates.filter((entry) => {
      const text = snapshotEntryOf(entry.id)?.text
      return text !== null && text !== undefined && matchKey(text) === sectionKey
    })
    if (snapshotMatches.length === 1) {
      const governedEntryId = snapshotMatches[0]?.id
      if (governedEntryId !== undefined) {
        sections.push({ sectionName: mapping.sectionName, outcome: 'governed', entryId: governedEntryId })
        continue
      }
    }
    sections.push({ sectionName: mapping.sectionName, outcome: 'skipped', reason: SKIP_GOVERNING_UNKNOWN })
  }
  // 未映射条目按型别记跳过原因(T2.4:运行时型跳过并记录原因;2026-11-11 裁定后
  // 注册表无行锚点只读型,该分支已清除)。
  const mapped = replayMappedEntryIds()
  const skippedEntries: ReplaySkippedEntry[] = []
  for (const entry of entries) {
    if (mapped.has(entry.id)) continue
    if (entry.kind === 'runtime-injection') skippedEntries.push({ entryId: entry.id, reason: SKIP_RUNTIME_KIND })
    else skippedEntries.push({ entryId: entry.id, reason: SKIP_NO_SECTION_MAPPING })
  }
  return { sessionId, degraded: null, sections, skippedEntries }
}
