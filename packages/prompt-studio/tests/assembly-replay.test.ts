/**
 * T2.4 历史会话严格回放测试(测试计划 §4 T2.4):
 * - 纯函数 resolveAssemblyReplay:live 值身份判定替换 / 快照身份解析(scoped 持久
 *   世界)/ 治理不明跳过 / complete 段在场跳过 / plan 未激活空段跳过 / 快照缺席与
 *   会话身份缺席降级 / 未映射条目按型别记跳过原因(行锚点只读型、运行时注入型
 *   不得因无 versionId 而失败);
 * - 映射完整性:REPLAY_SECTION_MAPPINGS 的条目 id 全部在注册表且均为 patch 值型;
 * - 网关 + 真 cordis waterfall 集成:未打标监听收到组装、替换权威、next() 链保序、
 *   审计 applied/governed/degraded 去键、快照库未挂载/在途捕获竞态闭环。
 *
 * 机制口径依据 spike 报告 docs/dev/ps-v2-spike.md(0.2.2-rc.1 真宿主 27/27):
 * 监听器收到 (assembly, context, next),AssembledSection.text 原地替换即权威;
 * 本文件用裸 cordis Context 的同形 waterfall 驱动(上游 dsh-system-prompt 即经
 * ctx.waterfall 派发,spike Tier1 已对真实包验证)。
 */
import { createHash } from 'node:crypto'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { KvUnit } from '@deepseek-ai/dsh-storage'
import {
  ASSEMBLE_EVENT, PLAN_POLICY_SECTION_NAME, PERSONA_PREFIX_SECTION_NAME, PROMPT_REGISTRY_ENTRIES,
  REPLAY_SECTION_MAPPINGS, SKIP_COMPLETE_OWNER, SKIP_GOVERNING_AMBIGUOUS, SKIP_GOVERNING_UNKNOWN,
  SKIP_NO_AGENT_ID, SKIP_NO_SECTION_MAPPING, SKIP_READONLY_KIND, SKIP_RUNTIME_KIND, SKIP_SECTION_EMPTY,
  SKIP_SNAPSHOT_ABSENT, SKIP_SNAPSHOT_TEXT_NULL, LoopPromptGateway, agentIdOfAssembleContext,
  pluginSpanOwnsCompleteFlag, resolveAssemblyReplay, replayMappedEntryIds,
} from '../src/index.ts'
import type { StudioContextLike } from '../src/types.ts'
import type { SessionSnapshotEntry, SessionSnapshotRecord } from '../src/types.ts'
import { SNAPSHOTS_TABLE } from '../src/session-snapshot.ts'
import { VERSIONS_TABLE } from '../src/version-store.ts'

const sha256 = (text: string): string => createHash('sha256').update(text, 'utf8').digest('hex')

/** 内存 KvUnit(双表:versions + snapshots;与 host-plugin.test 同款最小面)。 */
class MemoryUnit {
  readonly tables = new Map<string, Map<string, unknown>>([
    [VERSIONS_TABLE, new Map()],
    [SNAPSHOTS_TABLE, new Map()],
  ])

  async loadAll(): Promise<{ tables: Record<string, Record<string, unknown>>; global: null }> {
    const tables: Record<string, Record<string, unknown>> = {}
    for (const [name, records] of this.tables) tables[name] = Object.fromEntries(records)
    return { tables, global: null }
  }

  async putRecord(table: string, key: string, value: unknown): Promise<void> {
    this.tables.get(table)?.set(key, value)
  }

  async close(): Promise<void> {}
}

const PERSONA_STD_OLD = 'You are the standard assistant. 旧红线:预算超支>5%必须触发审批;对外付款不得代付;比选必须中立。'
const PERSONA_STD_NEW = 'You are the standard assistant. 新红线:预算超支>5%必须触发审批;对外付款不得代付;比选必须中立。'
const PERSONA_CORDIS_OLD = 'You are the creative assistant. 旧创造模式前缀。'
const PERSONA_CORDIS_NEW = 'You are the creative assistant. 新创造模式前缀。'
const PLAN_OLD = 'You are in plan mode. T2.4 旧段落。'
const PLAN_NEW = 'You are in plan mode. T2.4 新段落。'

/** live patch 双预设(persona 裸标量/块标量各一 + planning>plan-mode | 块;可注入 complete 行/第二 plan 行)。 */
function livePatch(options: {
  standard?: string
  cordis?: string
  plan?: string
  cordisPlan?: string
  completeStandard?: boolean
} = {}): string {
  const standard = options.standard ?? PERSONA_STD_NEW
  const cordis = options.cordis ?? PERSONA_CORDIS_NEW
  const plan = options.plan ?? PLAN_NEW
  return [
    '# T2.4 fixture:preset-standard + preset-cordis',
    '- id: preset-standard',
    "  name: '@deepseek-ai/dsh-agent-preset'",
    '  config:',
    '    plugins:',
    '      - id: persona',
    "        name: '@deepseek-ai/dsh-persona'",
    '        config:',
    `          prefix: '${standard}'`,
    ...(options.completeStandard ? ['          complete: true'] : []),
    '      - id: planning',
    '        name: cordis:group',
    '        config:',
    '          - id: plan-mode',
    "            name: '@deepseek-ai/dsh-plan-mode'",
    '            config:',
    '              section: |',
    ...plan.split('\n').map(line => `                ${line}`),
    '- id: preset-cordis',
    "  name: '@deepseek-ai/dsh-agent-preset'",
    '  config:',
    '    plugins:',
    '      - id: persona',
    "        name: '@deepseek-ai/dsh-persona'",
    '        config:',
    '          prefix: >-',
    ...cordis.split('\n').map(line => `            ${line}`),
    ...(options.cordisPlan === undefined ? [] : [
      '      - id: planning',
      '        name: cordis:group',
      '        config:',
      '          - id: plan-mode',
      "            name: '@deepseek-ai/dsh-plan-mode'",
      '            config:',
      '              section: |',
      ...options.cordisPlan.split('\n').map(line => `                ${line}`),
    ]),
    '',
  ].join('\n')
}

/** 内存读取面:WEB_PATCH → fixture 文本;其余文件按需注入(未注入即抛 ENOENT)。 */
function readerOf(files: Map<string, string>): (file: string) => string {
  return (file: string) => {
    const text = files.get(file)
    if (text === undefined) throw new Error(`ENOENT ${file}`)
    return text
  }
}

/** 手工快照条目(最小面;text=null 模拟只读型/捕获读值失败)。 */
function snapEntry(entryId: string, text: string | null, kind: SessionSnapshotEntry['kind'] = 'patch-value'): SessionSnapshotEntry {
  return {
    entryId,
    layer: 'preset',
    kind,
    text,
    bytes: text === null ? null : Buffer.byteLength(text, 'utf8'),
    checksum: text === null ? null : sha256(text),
    versionId: null,
    annotation: null,
    problems: [],
  }
}

/** 手工快照记录(覆盖映射候选条目;只读/运行时条目按型别给 null 文本)。 */
function snapshotOf(sessionId: string, texts: Record<string, string | null>): SessionSnapshotRecord {
  const entries: SessionSnapshotEntry[] = []
  for (const entry of PROMPT_REGISTRY_ENTRIES) {
    if (Object.hasOwn(texts, entry.id)) {
      entries.push(snapEntry(entry.id, texts[entry.id] as string | null, entry.kind))
    }
  }
  return {
    id: `ss-${sessionId.slice(0, 8)}`,
    sessionId,
    createdAt: '2026-11-11T00:00:00.000Z',
    trigger: 'session/created',
    entries,
    checksum: 'fixture',
  }
}

describe('映射完整性与常量真值', () => {
  it('REPLAY_SECTION_MAPPINGS:条目 id 全部在注册表且均为 patch 值型;段名与上游契约一致', () => {
    expect(PERSONA_PREFIX_SECTION_NAME).toBe('deployment:persona-prefix')
    expect(PLAN_POLICY_SECTION_NAME).toBe('plan:policy')
    for (const mapping of REPLAY_SECTION_MAPPINGS) {
      for (const id of mapping.entryIds) {
        const entry = PROMPT_REGISTRY_ENTRIES.find(candidate => candidate.id === id)
        expect(entry, `映射条目 ${id} 须在注册表`).toBeDefined()
        expect(entry?.kind, `映射条目 ${id} 须为 patch 值型`).toBe('patch-value')
      }
    }
  })

  it('未映射集合恰含注册表其余条目(删条目/改映射都会打破)', () => {
    const mapped = replayMappedEntryIds()
    for (const entry of PROMPT_REGISTRY_ENTRIES) {
      if (REPLAY_SECTION_MAPPINGS.some(mapping => mapping.entryIds.includes(entry.id))) {
        expect(mapped.has(entry.id)).toBe(true)
      } else {
        expect(mapped.has(entry.id)).toBe(false)
      }
    }
  })
})

describe('agentIdOfAssembleContext(防御式会话身份提取,spike §四.1)', () => {
  it('在场 → 提取;缺席/非字符串/空白 → undefined', () => {
    expect(agentIdOfAssembleContext({ agent: { id: 'session-a' }, scope: {} })).toBe('session-a')
    expect(agentIdOfAssembleContext({})).toBeUndefined()
    expect(agentIdOfAssembleContext({ agent: undefined })).toBeUndefined()
    expect(agentIdOfAssembleContext({ agent: null })).toBeUndefined()
    expect(agentIdOfAssembleContext({ agent: {} })).toBeUndefined()
    expect(agentIdOfAssembleContext({ agent: { id: 42 } })).toBeUndefined()
    expect(agentIdOfAssembleContext({ agent: { id: '   ' } })).toBeUndefined()
    expect(agentIdOfAssembleContext(null)).toBeUndefined()
    expect(agentIdOfAssembleContext('str')).toBeUndefined()
  })
})

describe('pluginSpanOwnsCompleteFlag(complete 段在场检测,spike §四.2)', () => {
  it('persona 插件 span 声明 complete: true → true;未声明/定位失败 → false', () => {
    const entry = PROMPT_REGISTRY_ENTRIES.find(candidate => candidate.id === 'preset.standard.persona')!
    expect(pluginSpanOwnsCompleteFlag(entry, readerOf(new Map([['profiles/eterna-web/cordis.patch.yml', livePatch({ completeStandard: true })]]))))
      .toBe(true)
    expect(pluginSpanOwnsCompleteFlag(entry, readerOf(new Map([['profiles/eterna-web/cordis.patch.yml', livePatch()]]))))
      .toBe(false)
    expect(pluginSpanOwnsCompleteFlag(entry, readerOf(new Map()))).toBe(false)
  })
  it('plan-mode 条目(pluginPath 两级)定位同样可达', () => {
    const entry = PROMPT_REGISTRY_ENTRIES.find(candidate => candidate.id === 'preset.standard.plan-mode.section')!
    expect(pluginSpanOwnsCompleteFlag(entry, readerOf(new Map([['profiles/eterna-web/cordis.patch.yml', livePatch()]]))))
      .toBe(false)
  })
  it('只认 configKey 同缩进兄弟键行:块标量正文字面 `complete: true` 行不误判(评审 #6)', () => {
    const entry = PROMPT_REGISTRY_ENTRIES.find(candidate => candidate.id === 'preset.standard.plan-mode.section')!
    const patch = livePatch({ plan: 'You are in plan mode.\ncomplete: true\nMore plan guidance.' })
    // plan 块正文行缩进(16)深于 section: 键行(14) → 不是兄弟键,不判 complete-owner。
    expect(pluginSpanOwnsCompleteFlag(entry, readerOf(new Map([['profiles/eterna-web/cordis.patch.yml', patch]]))))
      .toBe(false)
    // 对照:真兄弟键(preset-standard persona 的 complete: true)仍命中。
    const personaEntry = PROMPT_REGISTRY_ENTRIES.find(candidate => candidate.id === 'preset.standard.persona')!
    expect(pluginSpanOwnsCompleteFlag(personaEntry, readerOf(new Map([['profiles/eterna-web/cordis.patch.yml', livePatch({ completeStandard: true })]]))))
      .toBe(true)
  })
})

describe('resolveAssemblyReplay(纯函数:身份判定与替换)', () => {
  const WEB_PATCH_FILE = 'profiles/eterna-web/cordis.patch.yml'

  function resolve(options: {
    sections: Array<{ name: string; text: string }>
    context?: unknown
    snapshot?: SessionSnapshotRecord | undefined
    patch?: string
  }) {
    const files = new Map<string, string>([[WEB_PATCH_FILE, options.patch ?? livePatch()]])
    return resolveAssemblyReplay({
      sections: options.sections,
      context: options.context ?? { agent: { id: 'session-x' } },
      snapshot: options.snapshot,
      readFile: readerOf(files),
    })
  }

  it('① live 值命中且快照为旧值 → 替换为快照旧文(旧会话沿用快照)', () => {
    const sections = [{ name: PERSONA_PREFIX_SECTION_NAME, text: PERSONA_STD_NEW }]
    const result = resolve({
      sections,
      snapshot: snapshotOf('session-x', {
        'preset.standard.persona': PERSONA_STD_OLD,
        'preset.cordis.persona': PERSONA_CORDIS_OLD,
        'preset.standard.plan-mode.section': PLAN_OLD,
        'preset.cordis.plan-mode.section': PLAN_OLD,
      }),
    })
    expect(sections[0]?.text).toBe(PERSONA_STD_OLD)
    expect(result.degraded).toBeNull()
    expect(result.sessionId).toBe('session-x')
    const persona = result.sections.find(section => section.sectionName === PERSONA_PREFIX_SECTION_NAME)
    expect(persona?.outcome).toBe('replaced')
    expect(persona?.entryId).toBe('preset.standard.persona')
  })

  it('① 尾换行差异(YAML 解析器间)不改变身份判定,规范化等价即 governed 不盲替', () => {
    const sections = [{ name: PERSONA_PREFIX_SECTION_NAME, text: `${PERSONA_STD_NEW}\n` }]
    const result = resolve({
      sections,
      snapshot: snapshotOf('session-x', { 'preset.standard.persona': PERSONA_STD_NEW }),
    })
    expect(sections[0]?.text).toBe(`${PERSONA_STD_NEW}\n`)
    expect(result.sections.find(section => section.sectionName === PERSONA_PREFIX_SECTION_NAME)?.outcome).toBe('governed')
  })

  it('① 快照条目 text=null(捕获时读值失败)→ 跳过并明示,不伪造回放', () => {
    const sections = [{ name: PERSONA_PREFIX_SECTION_NAME, text: PERSONA_STD_NEW }]
    const result = resolve({ sections, snapshot: snapshotOf('session-x', { 'preset.standard.persona': null }) })
    expect(sections[0]?.text).toBe(PERSONA_STD_NEW)
    const persona = result.sections.find(section => section.sectionName === PERSONA_PREFIX_SECTION_NAME)
    expect(persona?.outcome).toBe('skipped')
    expect(persona?.reason).toBe(SKIP_SNAPSHOT_TEXT_NULL)
  })

  it('① 新会话(快照=现值)→ governed:新会话读最新,零替换', () => {
    const sections = [{ name: PERSONA_PREFIX_SECTION_NAME, text: PERSONA_STD_NEW }]
    const result = resolve({
      sections,
      snapshot: snapshotOf('session-x', {
        'preset.standard.persona': PERSONA_STD_NEW,
        'preset.cordis.persona': PERSONA_CORDIS_NEW,
      }),
    })
    expect(sections[0]?.text).toBe(PERSONA_STD_NEW)
    expect(result.sections.find(section => section.sectionName === PERSONA_PREFIX_SECTION_NAME)?.outcome).toBe('governed')
  })

  it('② 段文本=快照旧值(scoped 层持久持有旧实例的旧会话)→ 身份经快照解析为 governed', () => {
    const sections = [{ name: PERSONA_PREFIX_SECTION_NAME, text: PERSONA_STD_OLD }]
    const result = resolve({
      sections,
      snapshot: snapshotOf('session-x', {
        'preset.standard.persona': PERSONA_STD_OLD,
        'preset.cordis.persona': PERSONA_CORDIS_OLD,
      }),
    })
    expect(sections[0]?.text).toBe(PERSONA_STD_OLD)
    const persona = result.sections.find(section => section.sectionName === PERSONA_PREFIX_SECTION_NAME)
    expect(persona?.outcome).toBe('governed')
    expect(persona?.entryId).toBe('preset.standard.persona')
  })

  it('② 快照值命中歧义(两预设快照同文)→ fail-safe 跳过,不盲替', () => {
    const both = 'You are shared prefix. 红线:预算超支>5%必须触发审批;对外付款不得代付;比选必须中立。'
    const sections = [{ name: PERSONA_PREFIX_SECTION_NAME, text: both }]
    const result = resolve({
      sections,
      patch: livePatch({ standard: PERSONA_STD_NEW, cordis: PERSONA_CORDIS_NEW }),
      snapshot: snapshotOf('session-x', { 'preset.standard.persona': both, 'preset.cordis.persona': both }),
    })
    expect(sections[0]?.text).toBe(both)
    expect(result.sections.find(section => section.sectionName === PERSONA_PREFIX_SECTION_NAME)?.reason).toBe(SKIP_GOVERNING_UNKNOWN)
  })

  it('① live 值命中歧义(两候选 live 同文、快照异文)→ fail-safe 跳过,绝不取首个盲替(评审 #1 触发面)', () => {
    // 两预设 plan 段被改成同一新文;旧会话快照里两段旧文互异 → 无法判定会话用哪个条目,
    // 盲取首个会把 cordis 会话替换成 standard 的快照旧文(张冠李戴)。
    const sections = [{ name: PLAN_POLICY_SECTION_NAME, text: PLAN_NEW }]
    const result = resolve({
      sections,
      patch: livePatch({ plan: PLAN_NEW, cordisPlan: PLAN_NEW }),
      snapshot: snapshotOf('session-x', {
        'preset.standard.plan-mode.section': PLAN_OLD,
        'preset.cordis.plan-mode.section': 'You are in plan mode. 旧创造模式 plan 段。',
      }),
    })
    expect(sections[0]?.text).toBe(PLAN_NEW)
    expect(result.sections.find(section => section.sectionName === PLAN_POLICY_SECTION_NAME)?.reason).toBe(SKIP_GOVERNING_AMBIGUOUS)
  })

  it('① live 值命中歧义(快照同文)→ 同样跳过(两路身份判定都要求唯一,对称)', () => {
    const sections = [{ name: PLAN_POLICY_SECTION_NAME, text: PLAN_NEW }]
    const result = resolve({
      sections,
      patch: livePatch({ plan: PLAN_NEW, cordisPlan: PLAN_NEW }),
      snapshot: snapshotOf('session-x', {
        'preset.standard.plan-mode.section': PLAN_OLD,
        'preset.cordis.plan-mode.section': PLAN_OLD,
      }),
    })
    expect(sections[0]?.text).toBe(PLAN_NEW)
    expect(result.sections.find(section => section.sectionName === PLAN_POLICY_SECTION_NAME)?.reason).toBe(SKIP_GOVERNING_AMBIGUOUS)
  })

  it('③ 治理不明(段文本来自未登记源/子代理自有 persona)→ 跳过不盲替', () => {
    const sections = [{ name: PERSONA_PREFIX_SECTION_NAME, text: 'UNKNOWN_SUBAGENT_PERSONA' }]
    const result = resolve({ sections, snapshot: snapshotOf('session-x', { 'preset.standard.persona': PERSONA_STD_OLD }) })
    expect(sections[0]?.text).toBe('UNKNOWN_SUBAGENT_PERSONA')
    expect(result.sections.find(section => section.sectionName === PERSONA_PREFIX_SECTION_NAME)?.reason).toBe(SKIP_GOVERNING_UNKNOWN)
  })

  it('④ complete 段在场(prest persona config complete: true)→ 跳过并明示(spike §四.2)', () => {
    const sections = [{ name: PERSONA_PREFIX_SECTION_NAME, text: PERSONA_STD_NEW }]
    const result = resolve({
      sections,
      patch: livePatch({ completeStandard: true }),
      snapshot: snapshotOf('session-x', { 'preset.standard.persona': PERSONA_STD_OLD }),
    })
    expect(sections[0]?.text).toBe(PERSONA_STD_NEW)
    expect(result.sections.find(section => section.sectionName === PERSONA_PREFIX_SECTION_NAME)?.reason).toBe(SKIP_COMPLETE_OWNER)
  })

  it('⑤ plan:policy 激活且已改 → 替换(非 persona 条目同样回放)', () => {
    const sections = [{ name: PLAN_POLICY_SECTION_NAME, text: PLAN_NEW }]
    const result = resolve({
      sections,
      snapshot: snapshotOf('session-x', {
        'preset.standard.plan-mode.section': PLAN_OLD,
        'preset.cordis.plan-mode.section': PLAN_OLD,
      }),
    })
    expect(sections[0]?.text).toBe(PLAN_OLD)
    const plan = result.sections.find(section => section.sectionName === PLAN_POLICY_SECTION_NAME)
    expect(plan?.outcome).toBe('replaced')
    expect(plan?.entryId).toBe('preset.standard.plan-mode.section')
  })

  it('⑤ plan:policy 未激活(空段)→ 跳过(section-empty),不改文本', () => {
    const sections = [{ name: PLAN_POLICY_SECTION_NAME, text: '' }]
    const result = resolve({ sections, snapshot: snapshotOf('session-x', { 'preset.standard.plan-mode.section': PLAN_OLD }) })
    expect(sections[0]?.text).toBe('')
    expect(result.sections.find(section => section.sectionName === PLAN_POLICY_SECTION_NAME)?.reason).toBe(SKIP_SECTION_EMPTY)
  })

  it('段缺席(部署未装载该插件)→ 跳过(section-absent)', () => {
    const result = resolve({ sections: [], snapshot: snapshotOf('session-x', {}) })
    expect(result.sections.map(section => section.reason)).toEqual([expect.any(String), expect.any(String)])
    expect(result.sections.every(section => section.outcome === 'skipped')).toBe(true)
  })

  it('未映射条目按型别记跳过原因:只读型/运行时注入型不因无 versionId 失败,数值配置与文件基准明示无段落', () => {
    const result = resolve({ sections: [], snapshot: snapshotOf('session-x', {}) })
    const reasons = new Map(result.skippedEntries.map(item => [item.entryId, item.reason]))
    expect(reasons.get('preset.standard.time-context')).toBe(SKIP_READONLY_KIND)
    expect(reasons.get('preset.cordis.time-context')).toBe(SKIP_READONLY_KIND)
    expect(reasons.get('runtime.memory.index-section')).toBe(SKIP_RUNTIME_KIND)
    expect(reasons.get('runtime.glue.memory-plugin')).toBe(SKIP_RUNTIME_KIND)
    expect(reasons.get('preset.standard.agent-instructions')).toBe(SKIP_NO_SECTION_MAPPING)
    expect(reasons.get('domain.event-planning.persona-md')).toBe(SKIP_NO_SECTION_MAPPING)
    // 全注册表条目都被覆盖(映射段或跳过原因,无静默遗漏)。
    const covered = new Set([...replayMappedEntryIds(), ...reasons.keys()])
    expect(covered.size).toBe(PROMPT_REGISTRY_ENTRIES.length)
  })

  it('降级:会话身份缺席 → degraded=no-agent-id,零替换', () => {
    const sections = [{ name: PERSONA_PREFIX_SECTION_NAME, text: PERSONA_STD_NEW }]
    const result = resolve({ sections, context: { scope: {} }, snapshot: snapshotOf('session-x', {}) })
    expect(result.sessionId).toBeNull()
    expect(result.degraded).toBe(SKIP_NO_AGENT_ID)
    expect(sections[0]?.text).toBe(PERSONA_STD_NEW)
  })

  it('降级:快照缺席 → degraded=snapshot-absent(降级用当前值),零替换', () => {
    const sections = [{ name: PERSONA_PREFIX_SECTION_NAME, text: PERSONA_STD_NEW }]
    const result = resolve({ sections, snapshot: undefined })
    expect(result.sessionId).toBe('session-x')
    expect(result.degraded).toBe(SKIP_SNAPSHOT_ABSENT)
    expect(sections[0]?.text).toBe(PERSONA_STD_NEW)
  })

  it('跨预设不张冠李戴:cordis 会话段(cordis live 值)→ 替换为 cordis 快照,不碰 standard', () => {
    const sections = [{ name: PERSONA_PREFIX_SECTION_NAME, text: PERSONA_CORDIS_NEW }]
    const result = resolve({
      sections,
      snapshot: snapshotOf('session-x', {
        'preset.standard.persona': PERSONA_STD_OLD,
        'preset.cordis.persona': PERSONA_CORDIS_OLD,
      }),
    })
    expect(sections[0]?.text).toBe(PERSONA_CORDIS_OLD)
    const persona = result.sections.find(section => section.sectionName === PERSONA_PREFIX_SECTION_NAME)
    expect(persona?.outcome).toBe('replaced')
    expect(persona?.entryId).toBe('preset.cordis.persona')
  })
})

describe('网关 + 真 cordis waterfall 集成(未打标监听,替换权威)', () => {
  let dir: string
  let patchPath: string
  let auditPath: string
  let unit: MemoryUnit
  let gateway: LoopPromptGateway
  let ctx: Context

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'eterna-ps-replay-'))
    patchPath = join(dir, 'cordis.patch.yml')
    auditPath = join(dir, 'audit.jsonl')
    writeFileSync(patchPath, livePatch(), 'utf8')
    unit = new MemoryUnit()
    ctx = new Context()
    gateway = new LoopPromptGateway(asStudio(ctx), {
      patchPath,
      sessionsRoot: join(dir, 'sessions'),
      auditFilePath: auditPath,
      dryRunVerify: false,
      repoRoot: dir,
    })
  })

  afterEach(async () => {
    disposeReplay()
    await gateway.dispose()
    rmSync(dir, { recursive: true, force: true })
  })

  let disposeReplay = (): void => {}
  function register(): void {
    disposeReplay()
    disposeReplay = gateway.registerAssembleReplay(asStudio(ctx))
  }

  async function attach(): Promise<void> {
    const backend = { kv: { open: async () => unit as unknown as KvUnit }, close: async () => undefined }
    await gateway.attachBackend(backend)
  }

  /** 裸 cordis waterfall 驱动面(绕开宿主侧模块增强的强类型 scoped 形参;运行时同形)。 */
  type UntypedWaterfall = (target: object, name: string, ...args: unknown[]) => Promise<{ sections: Array<{ name: string; text: string }> }>

  /** 以 dsh-system-prompt 同形 waterfall 驱动一次组装(监听替换权威)。 */
  async function assemble(
    sections: Array<{ name: string; text: string }>,
    context: unknown,
  ): Promise<Array<{ name: string; text: string }>> {
    const assembly = { sections, contexts: [], variables: {} }
    const waterfall = (ctx as unknown as { waterfall: UntypedWaterfall }).waterfall.bind(ctx)
    const result = await waterfall({}, ASSEMBLE_EVENT, assembly, context, () => Promise.resolve(assembly))
    return result.sections
  }

  /** 追加下游监听(观察替换后文本;类型面同 StudioContextLike.on 的宽松签名)。 */
  function onAssemble(
    listener: (assembly: { sections: Array<{ name: string; text: string }> }, next: () => Promise<unknown>) => Promise<unknown>,
  ): void {
    ;(ctx as unknown as { on: (name: string, listener: (...args: never[]) => unknown) => unknown })
      .on(ASSEMBLE_EVENT, (assembly: unknown, _context: unknown, next: () => Promise<unknown>) =>
        listener(assembly as { sections: Array<{ name: string; text: string }> }, next))
  }

  async function auditDetails(): Promise<Array<Record<string, unknown>>> {
    await gateway.audit.flush()
    return readFileSync(auditPath, 'utf8').split('\n').filter(line => line.trim().length > 0)
      .map(line => JSON.parse(line) as { detail?: Record<string, unknown> })
      .map(record => record.detail ?? {})
  }

  it('① 旧会话:live 新值 → 替换为快照旧文;审计 assembly-replay.applied(带条目/快照 id);后续重复组装不刷审计', async () => {
    await attach()
    register()
    await gateway.snapshotStore!.append({
      sessionId: 'session-old',
      trigger: 'session/created',
      entries: [
        snapEntry('preset.standard.persona', PERSONA_STD_OLD),
        snapEntry('preset.cordis.persona', PERSONA_CORDIS_OLD),
        snapEntry('preset.standard.plan-mode.section', PLAN_OLD),
        snapEntry('preset.cordis.plan-mode.section', PLAN_OLD),
      ],
    })
    const first = await assemble(
      [{ name: PERSONA_PREFIX_SECTION_NAME, text: PERSONA_STD_NEW }, { name: PLAN_POLICY_SECTION_NAME, text: PLAN_NEW }],
      { agent: { id: 'session-old' }, scope: { id: 'session-old' } },
    )
    expect(first.find(section => section.name === PERSONA_PREFIX_SECTION_NAME)?.text).toBe(PERSONA_STD_OLD)
    expect(first.find(section => section.name === PLAN_POLICY_SECTION_NAME)?.text).toBe(PLAN_OLD)
    const applied = (await auditDetails()).filter(record => record.action === 'assembly-replay.applied')
    expect(applied).toHaveLength(1)
    const replaced = applied[0]?.replaced as Array<{ sectionName: string; entryId: string }>
    expect([...replaced.map(item => item.entryId)].sort()).toEqual(['preset.standard.persona', 'preset.standard.plan-mode.section'])
    expect(applied[0]?.sessionId).toBe('session-old')
    // 去键:同会话同段重复组装不重复刷审计。
    await assemble([{ name: PERSONA_PREFIX_SECTION_NAME, text: PERSONA_STD_NEW }], { agent: { id: 'session-old' } })
    expect((await auditDetails()).filter(record => record.action === 'assembly-replay.applied')).toHaveLength(1)
  })

  it('② waterfall 链保序:后注册的监听器读到替换后的文本;next() 结果透传', async () => {
    await attach()
    register()
    await gateway.snapshotStore!.append({
      sessionId: 'session-chain',
      trigger: 'session/created',
      entries: [snapEntry('preset.standard.persona', PERSONA_STD_OLD)],
    })
    let downstreamSeen: string | undefined
    onAssemble(async (assembly, next) => {
      downstreamSeen = assembly.sections.find(section => section.name === PERSONA_PREFIX_SECTION_NAME)?.text
      return next()
    })
    const result = await assemble([{ name: PERSONA_PREFIX_SECTION_NAME, text: PERSONA_STD_NEW }], { agent: { id: 'session-chain' } })
    expect(downstreamSeen).toBe(PERSONA_STD_OLD)
    expect(result.find(section => section.name === PERSONA_PREFIX_SECTION_NAME)?.text).toBe(PERSONA_STD_OLD)
  })

  it('③ governed:scoped 持久世界(段文本=快照旧值)→ 审计 assembly-replay.governed,零替换', async () => {
    await attach()
    register()
    await gateway.snapshotStore!.append({
      sessionId: 'session-gov',
      trigger: 'session/created',
      entries: [
        snapEntry('preset.standard.persona', PERSONA_STD_OLD),
        snapEntry('preset.cordis.persona', PERSONA_CORDIS_OLD),
      ],
    })
    const sections = await assemble([{ name: PERSONA_PREFIX_SECTION_NAME, text: PERSONA_STD_OLD }], { agent: { id: 'session-gov' } })
    expect(sections.find(section => section.name === PERSONA_PREFIX_SECTION_NAME)?.text).toBe(PERSONA_STD_OLD)
    const governed = (await auditDetails()).filter(record => record.action === 'assembly-replay.governed')
    expect(governed).toHaveLength(1)
    expect((governed[0]?.governed as Array<{ entryId: string }>)[0]?.entryId).toBe('preset.standard.persona')
  })

  it('④ 快照缺席 → 降级用当前值 + 审计 degraded(每会话一次),零替换不炸', async () => {
    await attach()
    register()
    const sections = await assemble([{ name: PERSONA_PREFIX_SECTION_NAME, text: PERSONA_STD_NEW }], { agent: { id: 'session-noSnap' } })
    expect(sections.find(section => section.name === PERSONA_PREFIX_SECTION_NAME)?.text).toBe(PERSONA_STD_NEW)
    const degraded = (await auditDetails()).filter(record => record.action === 'assembly-replay.degraded')
    expect(degraded).toHaveLength(1)
    expect(String(degraded[0]?.reason)).toContain('snapshot-absent')
    await assemble([{ name: PERSONA_PREFIX_SECTION_NAME, text: PERSONA_STD_NEW }], { agent: { id: 'session-noSnap' } })
    expect((await auditDetails()).filter(record => record.action === 'assembly-replay.degraded')).toHaveLength(1)
  })

  it('⑤ 组装上下文无会话身份(context.agent 缺席,spike 未声明字段)→ 降级一次不替换', async () => {
    await attach()
    register()
    const sections = await assemble([{ name: PERSONA_PREFIX_SECTION_NAME, text: PERSONA_STD_NEW }], { scope: {} })
    expect(sections.find(section => section.name === PERSONA_PREFIX_SECTION_NAME)?.text).toBe(PERSONA_STD_NEW)
    const degraded = (await auditDetails()).filter(record => record.action === 'assembly-replay.degraded')
    expect(degraded).toHaveLength(1)
    expect(String(degraded[0]?.reason)).toContain('no-agent-id')
  })

  it('⑥ 快照库未挂载(attach 前)→ 监听在册但降级,组装照常返回', async () => {
    register()
    const sections = await assemble([{ name: PERSONA_PREFIX_SECTION_NAME, text: PERSONA_STD_NEW }], { agent: { id: 'session-early' } })
    expect(sections.find(section => section.name === PERSONA_PREFIX_SECTION_NAME)?.text).toBe(PERSONA_STD_NEW)
    const degraded = (await auditDetails()).filter(record => record.action === 'assembly-replay.degraded')
    expect(degraded).toHaveLength(1)
    expect(String(degraded[0]?.reason)).toContain('snapshot-store-unavailable')
  })

  it('⑦ 在途捕获竞态:会话在待捕队列 → 监听等捕获排空后用新落快照回放(闭环创建→首轮组装竞态)', async () => {
    await attach()
    register()
    // 模拟「session/created 已入队、快照尚未落库」即开始首轮组装。
    gateway.handleSessionCreated({ id: 'session-race' })
    const sections = await assemble([{ name: PERSONA_PREFIX_SECTION_NAME, text: PERSONA_STD_NEW }], { agent: { id: 'session-race' } })
    // 捕获完成后回放的是「捕获时刻」的 live 文本(=PERSONA_STD_NEW,严格语义:
    // 快照在会话开启事件后捕获,其值即当时的 effective prompt)。
    expect(sections.find(section => section.name === PERSONA_PREFIX_SECTION_NAME)?.text).toBe(PERSONA_STD_NEW)
    await expect(gateway.snapshotStore!.getBySessionId('session-race')).resolves.toBeDefined()
  })

  it('⑧ 监听器异常面:组装载荷非法(sections 非数组)→ bad-shape 审计一次,waterfall 链不断', async () => {
    await attach()
    register()
    const assembly = { notSections: true }
    const waterfall = (ctx as unknown as { waterfall: UntypedWaterfall }).waterfall.bind(ctx)
    const result = await waterfall({}, ASSEMBLE_EVENT, assembly, { agent: { id: 'session-bad' } }, () => Promise.resolve({ sections: [] }))
    expect(result).toEqual({ sections: [] })
    const skipped = (await auditDetails()).filter(record => record.action === 'assembly-replay.skipped')
    expect(skipped).toHaveLength(1)
    expect(String(skipped[0]?.reason)).toContain('sections 非法')
  })

  it('⑨ 卸载:disposer 撤销监听后组装不再替换', async () => {
    await attach()
    register()
    await gateway.snapshotStore!.append({
      sessionId: 'session-off',
      trigger: 'session/created',
      entries: [snapEntry('preset.standard.persona', PERSONA_STD_OLD)],
    })
    disposeReplay()
    const sections = await assemble([{ name: PERSONA_PREFIX_SECTION_NAME, text: PERSONA_STD_NEW }], { agent: { id: 'session-off' } })
    expect(sections.find(section => section.name === PERSONA_PREFIX_SECTION_NAME)?.text).toBe(PERSONA_STD_NEW)
  })

  it('⑩ complete-owner:patch 声明 complete: true → 不替换,且审计 assembly-replay.skipped 留痕(每会话|段一次,评审 #4)', async () => {
    writeFileSync(patchPath, livePatch({ completeStandard: true }), 'utf8')
    await attach()
    register()
    await gateway.snapshotStore!.append({
      sessionId: 'session-complete',
      trigger: 'session/created',
      entries: [
        snapEntry('preset.standard.persona', PERSONA_STD_OLD),
        snapEntry('preset.cordis.persona', PERSONA_CORDIS_OLD),
      ],
    })
    const sections = await assemble([{ name: PERSONA_PREFIX_SECTION_NAME, text: PERSONA_STD_NEW }], { agent: { id: 'session-complete' } })
    expect(sections.find(section => section.name === PERSONA_PREFIX_SECTION_NAME)?.text).toBe(PERSONA_STD_NEW)
    const skipped = (await auditDetails()).filter(record => record.action === 'assembly-replay.skipped')
    expect(skipped).toHaveLength(1)
    expect(String(skipped[0]?.reason)).toBe(SKIP_COMPLETE_OWNER)
    expect(skipped[0]?.sectionName).toBe(PERSONA_PREFIX_SECTION_NAME)
    // 去键:重复组装不重复刷审计。
    await assemble([{ name: PERSONA_PREFIX_SECTION_NAME, text: PERSONA_STD_NEW }], { agent: { id: 'session-complete' } })
    expect((await auditDetails()).filter(record => record.action === 'assembly-replay.skipped')).toHaveLength(1)
  })
})

/** 测试边界:真实 cordis Context → 本包结构面(同 host-plugin.test 手法)。 */
function asStudio(ctx: Context): StudioContextLike {
  return ctx as unknown as StudioContextLike
}
