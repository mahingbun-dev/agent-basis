/**
 * T1.3 提示词注册表单测(测试计划 §3 T1.3,四组判据):
 * 1. 对账断言(真值基准,真文件交叉钉住——手法对齐 validator-diff.test.ts:101-107):
 *    条目先分型,判据按型执行——patch 值型(锚点在场+反引值非空,块标量走独立反引)、
 *    运行时注入型(代码锚点在场)(2026-11-11 用户裁定:工作室只展示拥有提示词文本
 *    的插件,time-context 纯运行时时钟注入器不登记,原「行锚点只读型」describe 块
 *    与红线豁免清单中的 time-context 引用随之删除——断言净减系裁定正当结果);
 * 2. 条目模型完整性(id 唯一/层与型别枚举闭合/字段齐备/每型至少 1 条真文件钉住);
 * 3. 无遗漏对账清单:docs/dev/ps-v2-registry-ledger.md ↔ 注册表 (id,层,型别,红线)
 *    集合双向相等——删条目/改型别/漏登记都打破相等,清单与代码互相锁住;
 * 4. 红线豁免语义:persona 类=required,非 persona(plan-mode 等)=exempt,
 *    required⇒规则集绑定;event-planning persona.md 真文件过标准红线(交叉钉住)。
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  ENTRY_KIND_LABELS, LAYER_LABELS, PROMPT_REGISTRY_ENTRIES, checkEntryAnchors, ensureEntryWritable,
  getPromptRegistryEntry, listPromptRegistryEntries, locateYamlConfigKey, readEntryValue,
  registryInvariants,
} from '../src/registry.ts'
import type { PromptRegistryEntry, RegistryFileReader } from '../src/registry.ts'
import { MAX_PERSONA_BYTES, RED_LINE_RULES } from '../src/validator.ts'

/** 仓库根(packages/prompt-studio/tests → 上三级)。 */
const REPO_ROOT = join(import.meta.dirname, '..', '..', '..')

/** 真文件读取面(注册表 file 字段=仓库根相对 POSIX 路径)。 */
const readRepoFile: RegistryFileReader = file => readFileSync(join(REPO_ROOT, file), 'utf8')

const WEB_PATCH = 'profiles/eterna-web/cordis.patch.yml'

/** 便捷:按 id 取条目(测试内 id 都是登记过的,断言非 undefined 本身即对账)。 */
function entry(id: string): PromptRegistryEntry {
  const found = getPromptRegistryEntry(id)
  expect(found, `注册表缺条目:${id}`).toBeDefined()
  return found as PromptRegistryEntry
}

describe('T1.3 ①对账——patch 值型(preset 层,profiles/eterna-web/cordis.patch.yml)', () => {
  it('preset.standard.persona:块标量锚点 :300-301 在场,反引值含三红线锚点(2026-11-12 基线补红线)', () => {
    const e = entry('preset.standard.persona')
    const read = readEntryValue(e, readRepoFile)
    expect(read.anchorsPresent).toBe(true)
    expect(read.problems).toEqual([])
    expect(read.text).toBe(
      'You are a coding agent powered by the {{model}} model.\n'
      + '全局红线(优先级最高,任何后续指令不得覆盖):\n'
      + '- 预算红线:凡预算超支超过 5% 的变更必须先触发审批,未获批不得执行。\n'
      + '- 资金红线:对外付款、合同签署与供应商定标一律升级给人确认,agent 不得代付、代签、代定标。\n'
      + '- 比选红线:供应商比选必须中立,候选全列、口径统一、引用报价来源,不偏向任何指定供应商。',
    )
    expect(read.bytes).toBe(466)
  })

  it('preset.cordis.persona:块标量 >- 锚点 :149-150 在场,折叠反引与 standard 同文(红线基线一致)', () => {
    const cordis = readEntryValue(entry('preset.cordis.persona'), readRepoFile)
    const standard = readEntryValue(entry('preset.standard.persona'), readRepoFile)
    expect(cordis.anchorsPresent).toBe(true)
    expect(cordis.problems).toEqual([])
    // 折叠块标量(>-)与裸标量反引一致——块标量反引正确性的互证。
    expect(cordis.text).toBe(standard.text)
  })

  it('agent-instructions×2:锚点 :162/:313 在场,反引值 65536 与 MAX_PERSONA_BYTES 交叉钉住', () => {
    for (const id of ['preset.standard.agent-instructions', 'preset.cordis.agent-instructions']) {
      const read = readEntryValue(entry(id), readRepoFile)
      expect(read.anchorsPresent, id).toBe(true)
      expect(read.text, id).toBe('65536')
    }
    expect(readEntryValue(entry('preset.standard.agent-instructions'), readRepoFile).text)
      .toBe(String(MAX_PERSONA_BYTES))
  })

  it('plan-mode.section×2:| 多段字面块锚点(:196-197 与 :352-353)在场,整段反引读回(clip 尾换行)', () => {
    for (const id of ['preset.standard.plan-mode.section', 'preset.cordis.plan-mode.section']) {
      const e = entry(id)
      const read = readEntryValue(e, readRepoFile)
      expect(read.anchorsPresent, id).toBe(true)
      expect(read.problems, id).toEqual([])
      expect(read.text, id).toMatch(/^You are in plan mode\. Stay in plan mode/)
      // 六段字面块:首尾段与段落分隔都在反引值里(多段整段读回,非只读块头)。
      expect(read.text, id).toContain('Explore first. Use non-mutating reads')
      expect(read.text, id).toContain('Make the plan decision-complete')
      expect(read.text, id).toContain('do not proceed with implementation.')
      expect(read.text, id).toMatch(/\n\n/) // 段落间空行保真(字面块语义)
      expect(read.text, id).toMatch(/\n$/u) // clip:非空字面块恰一个尾换行
      expect(read.bytes, id).toBeLessThanOrEqual(e.maxBytes)
    }
    // 两预设的 section 文本同源(装品同段,仅末段措辞有已知差异时也不影响各自读回)。
    const standard = readEntryValue(entry('preset.standard.plan-mode.section'), readRepoFile).text ?? ''
    const cordis = readEntryValue(entry('preset.cordis.plan-mode.section'), readRepoFile).text ?? ''
    expect(standard.slice(0, 200)).toBe(cordis.slice(0, 200))
  })

  it('结构定位:preset 行内经 pluginPath 嵌套(planning 组 → plan-mode)命中唯一键行', () => {
    const lines = readRepoFile(WEB_PATCH).split('\n')
    for (const [rowId, expectedLine] of [['preset-standard', 352], ['preset-cordis', 196]] as const) {
      const located = locateYamlConfigKey(
        { file: WEB_PATCH, rowId, pluginPath: ['planning', 'plan-mode'], configKey: 'section' },
        lines,
      )
      expect(located, rowId).toBeDefined()
      expect((located?.keyIndex ?? 0) + 1, rowId).toBe(expectedLine)
    }
  })
})

describe('T1.3 ①对账——patch 值型(领域层,packs/{event-planning,industrial-analysis})', () => {
  it('personaPrefix×2:锚点(:12 行 id / :14 块头)在场,>- 折叠反引非空且为领域身份句', () => {
    const event = readEntryValue(entry('domain.event-planning.persona-prefix'), readRepoFile)
    const industrial = readEntryValue(entry('domain.industrial-analysis.persona-prefix'), readRepoFile)
    expect(event.anchorsPresent).toBe(true)
    expect(event.problems).toEqual([])
    expect(event.text).toMatch(/^You are a senior event planning specialist: creative, execution-strong, budget-aware/)
    expect(event.text).toContain('stay neutral in vendor selection.')
    expect(industrial.anchorsPresent).toBe(true)
    expect(industrial.problems).toEqual([])
    expect(industrial.text).toMatch(/^You are a senior industrial data-intelligence analysis specialist/)
    expect(industrial.text).toContain('Deny-first, fail-closed.')
  })

  it('persona.md×2:整文件锚点(:1)在场,全文读回非空(领域 persona 全文基准)', () => {
    const event = readEntryValue(entry('domain.event-planning.persona-md'), readRepoFile)
    const industrial = readEntryValue(entry('domain.industrial-analysis.persona-md'), readRepoFile)
    expect(event.anchorsPresent).toBe(true)
    expect(event.text).toContain('# persona')
    expect(event.text).toContain('全局硬约束')
    expect((event.bytes ?? 0)).toBeGreaterThan(0)
    expect(industrial.anchorsPresent).toBe(true)
    expect(industrial.text).toContain('# persona')
    expect(industrial.text).toContain('全局硬约束')
    expect((industrial.bytes ?? 0)).toBeGreaterThan(0)
  })
})

describe('T1.3 ①对账——运行时注入型(memory/glue 的 section 元数据)', () => {
  it('memory:代码锚点在场(section 名/排序/挂载点:tools.ts:41,47,64)', () => {
    const e = entry('runtime.memory.index-section')
    expect(e.kind).toBe('runtime-injection')
    const check = checkEntryAnchors(e, readRepoFile)
    expect(check.ok, check.problems.join(';')).toBe(true)
    const read = readEntryValue(e, readRepoFile)
    expect(read.text).toBeNull() // 无静态全文:文本装配时从 M2 记忆动态构建
    expect(read.note).toContain('memory:index')
  })

  it('glue:代码锚点在场(inject systemPrompt + attachMemory 装载点:memory-plugin.ts:15,27)', () => {
    const e = entry('runtime.glue.memory-plugin')
    const check = checkEntryAnchors(e, readRepoFile)
    expect(check.ok, check.problems.join(';')).toBe(true)
    expect(e.note).toContain('memory:index')
  })

  it('写守卫:运行时注入型拒写并明示无 patch 落点(自管改造归 T2.6)', () => {
    for (const id of ['runtime.memory.index-section', 'runtime.glue.memory-plugin']) {
      expect(() => { ensureEntryWritable(entry(id)) }, id).toThrow('运行时注入型')
    }
  })

  it('T2.6 交叉钉住:消费侧源码含本注册表的条目 id 与服务名,双侧字符串漂移即红(不引包,读源码文本)', () => {
    // memory 侧:条目 id 常量 + promptRegistry 服务名常量(登记制读取面的取值坐标)。
    const toolsSource = readRepoFile('packages/memory/src/tools.ts')
    expect(toolsSource, 'memory 源码缺条目 id 常量(注册表条目 id 漂移?)').toContain("'runtime.memory.index-section'")
    expect(toolsSource, 'memory 源码缺服务名常量(promptRegistry 漂移?)').toContain("'promptRegistry'")
    // glue 侧:装载点经同一服务名接读取面(livePromptSource)。
    const pluginSource = readRepoFile('packages/glue/src/plugins/memory-plugin.ts')
    expect(pluginSource, 'glue memory 插件未接 promptRegistry 读取面').toContain('resolvePromptRegistry')
    // 本包侧:提供的服务名与 memory 常量一致(src/index.ts PROMPT_REGISTRY_SERVICE_ID)。
    const studioSource = readRepoFile('packages/prompt-studio/src/index.ts')
    expect(studioSource).toContain("PROMPT_REGISTRY_SERVICE_ID = 'promptRegistry'")
  })
})

describe('T1.3 ②条目模型完整性(每条 {id,层,来源,定位,当前值,型别,风险},枚举闭合)', () => {
  it('registryInvariants 全过(id 唯一/层与型别与红线枚举闭合/锚点≥1/风险≥1/注记非空/规则集绑定)', () => {
    const result = registryInvariants()
    expect(result.problems).toEqual([])
    expect(result.ok).toBe(true)
  })

  it('description:14 条全部非空中文说明(2026-11-12 用户要求;随线下面进 UI 条目详情)', () => {
    for (const e of PROMPT_REGISTRY_ENTRIES) {
      expect(e.description.trim().length, e.id).toBeGreaterThan(0)
      expect(/[\u4e00-\u9fff]/u.test(e.description), `${e.id}: description 应为中文说明`).toBe(true)
    }
  })

  it('存量规模与分布:preset×6 / 领域×4 / 运行时×2 / 元提示词×2(T3.1);patch 值型×12 / 运行时注入型×2(2026-11-11 裁定后 14 条)', () => {
    expect(PROMPT_REGISTRY_ENTRIES).toHaveLength(14)
    const byLayer = countBy(PROMPT_REGISTRY_ENTRIES, e => LAYER_LABELS[e.layer])
    expect(byLayer).toEqual({ 'preset 层': 6, '领域层': 4, '运行时层': 2, '元提示词层': 2 })
    const byKind = countBy(PROMPT_REGISTRY_ENTRIES, e => ENTRY_KIND_LABELS[e.kind])
    expect(byKind).toEqual({ 'patch 值型': 12, '运行时注入型': 2 })
  })

  it('每型至少 1 条被真文件钉住:全部条目锚点对真文件核对通过(分型不缺判据)', () => {
    for (const kind of Object.keys(ENTRY_KIND_LABELS) as Array<keyof typeof ENTRY_KIND_LABELS>) {
      const ofKind = PROMPT_REGISTRY_ENTRIES.filter(e => e.kind === kind)
      expect(ofKind.length, `型别 ${kind} 无存量条目`).toBeGreaterThan(0)
      for (const e of ofKind) {
        const check = checkEntryAnchors(e, readRepoFile)
        expect(check.ok, `${e.id}:${check.problems.join(';')}`).toBe(true)
      }
    }
  })

  it('patch 值型逐条反引值非空(型别判据的全量执行,防「删掉麻烦条目换轻松」)', () => {
    for (const e of PROMPT_REGISTRY_ENTRIES.filter(item => item.kind === 'patch-value')) {
      const read = readEntryValue(e, readRepoFile)
      expect(read.problems, e.id).toEqual([])
      expect(read.text, e.id).not.toBeNull()
      expect((read.text ?? '').length, e.id).toBeGreaterThan(0)
    }
  })

  it('未知 id:getPromptRegistryEntry → undefined(读侧明示 not-found 的前置)', () => {
    expect(getPromptRegistryEntry('no.such.entry')).toBeUndefined()
    expect(listPromptRegistryEntries()).toHaveLength(PROMPT_REGISTRY_ENTRIES.length)
  })
})

describe('T1.3 ③无遗漏对账清单(docs/dev/ps-v2-registry-ledger.md 互锁)', () => {
  /** ledger 主表行(列:id/层/型别/来源/定位/红线)。 */
  interface LedgerRow {
    readonly id: string
    readonly layer: string
    readonly kind: string
    readonly source: string
    readonly location: string
    readonly redLine: string
  }

  /** 解析 ledger 主表行:| id | 层 | 型别 | 来源 | 定位 | 红线 |。 */
  function parseLedger(): LedgerRow[] {
    const ledgerPath = join(REPO_ROOT, 'docs', 'dev', 'ps-v2-registry-ledger.md')
    // 型别枚举 2026-11-11 裁定后闭合为二分:ledger 中 time-context 两行的型别列
    // 已改为「不登记(…)」保留注记,不再命中本行模式(不计入对账行,审计可追溯)。
    const pattern = /^\|\s*([a-z0-9.-]+)\s*\|\s*(preset 层|领域层|运行时层|元提示词层)\s*\|\s*(patch 值型|运行时注入型)\s*\|\s*([^|]+?)\s*\|\s*([^|]+?)\s*\|\s*([^|]+?)\s*\|/
    const rows: LedgerRow[] = []
    for (const line of readFileSync(ledgerPath, 'utf8').split('\n')) {
      const match = pattern.exec(line)
      if (match !== null) {
        rows.push({
          id: match[1] as string,
          layer: match[2] as string,
          kind: match[3] as string,
          source: match[4] as string,
          location: match[5] as string,
          redLine: match[6] as string,
        })
      }
    }
    return rows
  }

  it('ledger ↔ 注册表 (id,层,型别,红线) 集合双向相等(删条目/改型别/漏登记即红)', () => {
    const rows = parseLedger()
    expect(rows).toHaveLength(PROMPT_REGISTRY_ENTRIES.length)
    const ledgerById = new Map(rows.map(row => [row.id, row]))
    const registryIds = new Set(PROMPT_REGISTRY_ENTRIES.map(e => e.id))
    // 方向一:注册表每条在 ledger 有行,且层/型别/红线一致。
    for (const e of PROMPT_REGISTRY_ENTRIES) {
      const row = ledgerById.get(e.id)
      expect(row, `ledger 缺条目:${e.id}`).toBeDefined()
      expect(row?.layer, e.id).toBe(LAYER_LABELS[e.layer])
      expect(row?.kind, e.id).toBe(ENTRY_KIND_LABELS[e.kind])
      if (e.redLine === 'exempt') {
        expect(row?.redLine, e.id).toBe('exempt')
      } else {
        expect(row?.redLine, e.id).toMatch(new RegExp(`^required\\(${e.redLineRuleSet}\\)$`))
      }
      expect((row?.location ?? ''), e.id).toMatch(/:\d+/u) // 定位列必须是 文件:行号 形态
    }
    // 方向二:ledger 每行都对应注册表条目(无登记外幽灵行)。
    for (const row of rows) {
      expect(registryIds.has(row.id), `ledger 有注册表外条目:${row.id}`).toBe(true)
    }
  })

  it('ledger 定位列与条目锚点文件一致(清单里的 文件:行号 即对账锚点)', () => {
    const rows = parseLedger()
    for (const row of rows) {
      const e = entry(row.id)
      const anchorFiles = new Set(e.anchors.map(a => a.file))
      // 定位列形如「path:41,47,64」或「path:12-17 path2:1-31」:按文件扩展名+行号锚提取文件路径。
      const ledgerFiles = [...row.location.matchAll(/\S+?\.(?:yml|md|ts)(?=:\d)/gu)].map(m => m[0])
      expect(ledgerFiles.length, `${e.id}:ledger 定位列未解析出文件`).toBeGreaterThan(0)
      for (const file of ledgerFiles) {
        expect(anchorFiles.has(file), `${e.id}:ledger 定位文件 ${file} 不在锚点集`).toBe(true)
      }
      // 反向:条目每个锚点文件都在 ledger 定位列出现(清单覆盖全部对账文件)。
      for (const file of anchorFiles) {
        expect(ledgerFiles.includes(file), `${e.id}:锚点文件 ${file} 未入 ledger 定位列`).toBe(true)
      }
    }
  })
})

describe('T1.3 ④红线豁免语义(persona 类必检,非 persona 豁免)', () => {
  /** persona 类条目(6 条):两预设 persona + 两包 personaPrefix/persona.md。 */
  const PERSONA_IDS = [
    'preset.standard.persona',
    'preset.cordis.persona',
    'domain.event-planning.persona-prefix',
    'domain.event-planning.persona-md',
    'domain.industrial-analysis.persona-prefix',
    'domain.industrial-analysis.persona-md',
  ]

  it('required 集合 = persona 类 6 条;其余 8 条全部 exempt(防 T1.6 把红线错配到全部条目)', () => {
    const required = PROMPT_REGISTRY_ENTRIES.filter(e => e.redLine === 'required').map(e => e.id).sort()
    expect(required).toEqual([...PERSONA_IDS].sort())
    const exempt = PROMPT_REGISTRY_ENTRIES.filter(e => e.redLine === 'exempt').map(e => e.id)
    expect(exempt).toHaveLength(PROMPT_REGISTRY_ENTRIES.length - PERSONA_IDS.length)
    // 非 persona 条目确实不含 persona 类 id(plan 模式/指令上限/运行时 section)。
    // (原清单含 preset.standard.time-context,随 2026-11-11 不登记裁定移除引用。)
    for (const id of ['preset.cordis.plan-mode.section', 'preset.standard.agent-instructions', 'runtime.memory.index-section']) {
      expect(entry(id).redLine, id).toBe('exempt')
    }
  })

  it('required⇒规则集 id 在场且闭合为两个已知集;exempt⇒不带规则集', () => {
    const knownRuleSets = new Set(['eterna.red-lines.standard', 'eterna.red-lines.industrial-analysis'])
    for (const e of PROMPT_REGISTRY_ENTRIES) {
      if (e.redLine === 'required') {
        expect(e.redLineRuleSet, e.id).toBeDefined()
        expect(knownRuleSets.has(e.redLineRuleSet ?? ''), e.id).toBe(true)
      } else {
        expect(e.redLineRuleSet, e.id).toBeUndefined()
      }
    }
  })

  it('交叉钉住:event-planning persona.md 真文件过标准三条红线;industrial 不含标准锚点(绑独立规则集)', () => {
    const eventPersona = readRepoFile('packs/event-planning/persona.md')
    for (const rule of RED_LINE_RULES) {
      expect(rule.pattern.test(eventPersona), `event-planning persona.md 缺红线锚点 ${rule.id}`).toBe(true)
    }
    // 如实钉住事实:industrial persona.md 自有四条红线,不含标准三条 CJK 锚点,
    // 故绑 eterna.red-lines.industrial-analysis(规则本体 T1.6 落地)——不许静默套用标准集。
    const industrialPersona = readRepoFile('packs/industrial-analysis/persona.md')
    for (const rule of RED_LINE_RULES) {
      expect(rule.pattern.test(industrialPersona), `industrial persona.md 不应含标准锚点 ${rule.id}`).toBe(false)
    }
    expect(industrialPersona).toContain('达梦业务库只读')
    expect(industrialPersona).toContain('deny 优先、fail-closed')
    expect(entry('domain.industrial-analysis.persona-md').redLineRuleSet).toBe('eterna.red-lines.industrial-analysis')
  })
})

/** 计数小工具(保持断言可读)。 */
function countBy<T>(items: readonly T[], key: (item: T) => string): Record<string, number> {
  const out: Record<string, number> = {}
  for (const item of items) {
    const k = key(item)
    out[k] = (out[k] ?? 0) + 1
  }
  return out
}
