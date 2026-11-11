/**
 * T1.6 按条目 patch 定位重述写回单测(测试计划 §3 T1.6(b) 形态 A/B/C 专项 +
 * §6 横切 1 TOCTOU):
 * - 形态 A|领域层折叠块 `>-`:personaPrefix(整块替换:块头+续行);
 * - 形态 B|preset-cordis 折叠块 `>-`:persona prefix(单行替换残留续行=脏 YAML,
 *   必须整块替换——本测试钉住「续行零残留」);
 * - 形态 C|plan-mode 字面块 `|` 多段整段写回(三类最难,专项断言);
 * - 形态 D|多行 plain 折叠标量(T3.2:官方 configEditor 长值序列化形态)——读侧
 *   折叠反引 + 写侧整段替换(续行零残留);
 * - 单行标量形态(裸标量双引号化/纯整数保持裸标量)与整文件形态(persona.md)。
 *
 * 每形态断言:①定位 0/≥2 命中 fail-closed;②写后 round-trip(读侧反引==目标)
 * 且除目标块外逐字节不变(!!js 行保真);③TOCTOU:定位后写前文件被外部改写
 * → 基线校验失败拒写、零落盘、文件保持外部改写后的状态。
 * 另钉:verify 失败自动还原;同文件多条目单写者串行;折叠块不支持正文首行前
 * 空行的文本(fail-closed 自检拦截)。
 *
 * 纯函数面用真实注册表条目(定位元数据=登记事实)+ 同构 fixture 文本;
 * EntryPatchFile 走真实 fs 临时目录。
 */
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { EntryPatchFile, buildNextEntryFileText, entrySpanOf, selfCheckEntryWrite } from '../src/entry-patch.ts'
import { getPromptRegistryEntry, readYamlValueAtLine } from '../src/registry.ts'
import type { PromptRegistryEntry } from '../src/registry.ts'

/** 便捷:真实注册表条目(定位元数据=T1.3 登记事实,测试借用其 yaml 定位)。 */
function entry(id: string): PromptRegistryEntry {
  const found = getPromptRegistryEntry(id)
  expect(found, `注册表缺条目:${id}`).toBeDefined()
  return found as PromptRegistryEntry
}

/** 领域包 fixture(形态 A:packs/event-planning/cordis.patch.yml 同构)。 */
const PACK_PATCH = [
  '# fixture pack patch(形态 A 同构)',
  '- id: skill-filesystem',
  '  config:',
  "    customSkillDirs: ['./skills']",
  '',
  '- id: system-prompt',
  '  config:',
  '    personaPrefix: >-',
  '      You are a senior event planning specialist: creative, execution-strong,',
  '      budget-aware and compliance-aware. Never silently exceed budgets, never',
  '      make or promise external payments, stay neutral in vendor selection.',
  '',
  '- insert:',
  '    - id: event-tools',
  "      name: '@event/pack/plugin'",
  '',
].join('\n')

/** 领域 persona 原文(>- 折叠读回:三行折成一行,空格连接)。 */
const PACK_PREFIX_TEXT = 'You are a senior event planning specialist: creative, execution-strong, budget-aware and compliance-aware. Never silently exceed budgets, never make or promise external payments, stay neutral in vendor selection.'

/** Web 组合 fixture(形态 B:preset-cordis persona `>-`;形态 C:两预设 plan-mode `|`;!!js 行保真锚点)。 */
const WEB_PATCH = [
  '# fixture web patch(形态 B/C 同构)',
  '- id: preset-standard',
  '  config:',
  '    plugins:',
  '      - id: persona',
  "        name: '@deepseek-ai/dsh-persona'",
  '        config:',
  '          prefix: You are a coding agent powered by the {{model}} model.',
  '      - id: planning',
  '        name: cordis:group',
  '        group: true',
  '        config:',
  '          - id: plan-mode',
  "            name: '@deepseek-ai/dsh-plan-mode'",
  '            config:',
  '              section: |',
  '                You are in plan mode. Stay in plan mode.',
  '                ',
  '                Explore first. Use non-mutating reads.',
  '',
  '                Make the plan decision-complete.',
  '      - id: tool-bash',
  "        name: '@deepseek-ai/dsh-tool-bash'",
  "        disabled: !!js process.platform === 'win32'",
  '',
  '- id: preset-cordis',
  '  config:',
  '    id: cordis',
  '    order: 4',
  '    plugins:',
  '      - id: persona',
  "        name: '@deepseek-ai/dsh-persona'",
  '        config:',
  '          prefix: >-',
  '            You are a coding agent powered by the {{model}} model.',
  '      - id: planning',
  '        name: cordis:group',
  '        group: true',
  '        config:',
  '          - id: plan-mode',
  "            name: '@deepseek-ai/dsh-plan-mode'",
  '            config:',
  '              section: |',
  '                Cordis plan mode block.',
  '      - id: tool-plugin-manager',
  "        name: '@deepseek-ai/dsh-plugin-manager/tools'",
  "        disabled: !!js \"!ctx.get('profileContext')\"",
  '',
].join('\n')

/** 除 [start,end) 外逐字节不变(区域纪律的独立复核,不走 selfCheck 自身实现)。 */
function outsideRegionIdentical(original: string, next: string, originalSpan: { keyIndex: number; end: number }, nextEnd: number): boolean {
  const a = original.split('\n')
  const b = next.split('\n')
  return a.slice(0, originalSpan.keyIndex).join('\n') === b.slice(0, originalSpan.keyIndex).join('\n')
    && a.slice(originalSpan.end).join('\n') === b.slice(nextEnd).join('\n')
}

/** 写回并三重复核(round-trip + 区域纪律 + selfCheck 通过)。 */
function writeAndVerify(id: string, original: string, nextText: string): { next: string; spanEnd: number } {
  const e = entry(id)
  const next = buildNextEntryFileText(e, original, nextText)
  expect(() => { selfCheckEntryWrite(e, original, next, nextText) }).not.toThrow()
  const before = entrySpanOf(e, original.split('\n'))
  const after = entrySpanOf(e, next.split('\n'))
  expect(readYamlValueAtLine(next.split('\n'), after.keyIndex)).toBe(nextText)
  expect(outsideRegionIdentical(original, next, before, after.end)).toBe(true)
  return { next, spanEnd: after.end }
}

describe('T1.6 形态 A|领域层折叠块 >-(personaPrefix)——packs patch 定位重述写回', () => {
  const ID = 'domain.event-planning.persona-prefix'

  it('定位:唯一键行 + 块 span(块头+全部续行;尾部空行是分隔符不属块)', () => {
    const lines = PACK_PATCH.split('\n')
    const span = entrySpanOf(entry(ID), lines)
    expect(span.isBlock).toBe(true)
    expect(lines[span.keyIndex]).toBe('    personaPrefix: >-')
    const lastContinuation = lines.findIndex(line => line.includes('stay neutral in vendor selection.'))
    expect(span.end).toBe(lastContinuation + 1)
    // 尾部空行(块与 - insert: 行之间的分隔空行)不在替换区域内,替换不动它。
    expect(lines[span.end]).toBe('')
    expect(lines[span.end + 1]).toBe('- insert:')
  })

  it('定位 0/≥2 命中 → fail-closed 精确错误(期望 1 实际 N)', () => {
    const missingRow = PACK_PATCH.replace('- id: system-prompt', '- id: other-row')
    expect(() => { entrySpanOf(entry(ID), missingRow.split('\n')) }).toThrow(/system-prompt.*不在文件中|行数期望 1,实际 0/)
    const duplicated = PACK_PATCH.replace(
      '- insert:',
      '    personaPrefix: extra\n\n- insert:',
    )
    expect(() => { entrySpanOf(entry(ID), duplicated.split('\n')) }).toThrow(/行数期望 1,实际 2/)
  })

  it('写回:整块替换(块头+续行),round-trip 一致,其余字节不变(含后续 insert 行)', () => {
    const nextText = `${PACK_PREFIX_TEXT} T1.6 形态 A 追加句。\n第二行(原三行折一行,新文两行)。`
    const { next } = writeAndVerify(ID, PACK_PATCH, nextText)
    // 旧续行零残留(单行替换会残留续行产生脏 YAML——按原行样式断言零残留)。
    expect(next.split('\n')).not.toContain('      budget-aware and compliance-aware. Never silently exceed budgets, never')
    expect(next.split('\n')).not.toContain('      make or promise external payments, stay neutral in vendor selection.')
    // 新块:块头仍为折叠式(样式沿用);事件工具行原样保留。
    expect(next).toContain('personaPrefix: >')
    expect(next).toContain('- id: event-tools')
    expect(next).toContain("      name: '@event/pack/plugin'")
  })

  it('写回同文(回滚场景):round-trip 后文本可再写回原值,块区域恢复读侧语义', () => {
    // 先写新文,再「回滚」写回原值:最终文本的键值读回==原值,结构完好。
    const v2 = `${PACK_PREFIX_TEXT} append.`
    const mid = buildNextEntryFileText(entry(ID), PACK_PATCH, v2)
    const restored = buildNextEntryFileText(entry(ID), mid, PACK_PREFIX_TEXT)
    expect(() => { selfCheckEntryWrite(entry(ID), mid, restored, PACK_PREFIX_TEXT) }).not.toThrow()
  })

  it('TOCTOU:定位后写前文件被外部改写 → 基线不符拒写、零落盘、文件保持外部状态', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'eterna-entry-patch-a-'))
    const path = join(dir, 'cordis.patch.yml')
    writeFileSync(path, PACK_PATCH, 'utf8')
    try {
      const writer = new EntryPatchFile()
      const baseline = PACK_PATCH
      // 外部改写(profile 升级合并模拟):在审批基线之后、写回之前动文件。
      const externallyRewritten = PACK_PATCH.replace('# fixture pack patch(形态 A 同构)', '# 外部升级合并后的文件')
      writeFileSync(path, externallyRewritten, 'utf8')
      const nextText = `${PACK_PREFIX_TEXT} TOCTOU.`
      await expect(writer.writeNext({
        path,
        baseline,
        build: (original) => {
          const next = buildNextEntryFileText(entry(ID), original, nextText)
          selfCheckEntryWrite(entry(ID), original, next, nextText)
          return next
        },
      })).rejects.toThrow(/TOCTOU 拒写/)
      // 零落盘:文件保持外部改写后的状态(未被覆盖),无 .tmp/.bak 残留。
      expect(readFileSync(path, 'utf8')).toBe(externallyRewritten)
      expect(readdirSync(dir).filter(name => name.startsWith('.prompt-studio.'))).toEqual([])
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

describe('T1.6 形态 B|preset-cordis 折叠块 >-(persona prefix)——块头+续行整块替换', () => {
  const ID = 'preset.cordis.persona'

  it('定位:preset-cordis 行内 persona 插件项的 prefix 块(不与 preset-standard 裸标量混)', () => {
    const lines = WEB_PATCH.split('\n')
    const span = entrySpanOf(entry(ID), lines)
    expect(span.isBlock).toBe(true)
    expect(lines[span.keyIndex]).toBe('          prefix: >-')
    expect(lines[span.end - 1]).toContain('You are a coding agent powered by the {{model}} model.')
  })

  it('定位 0/≥2 命中 → fail-closed(行缺失/键行重复)', () => {
    const zero = WEB_PATCH.replace('          prefix: >-', '          otherKey: >-')
    expect(() => { entrySpanOf(entry(ID), zero.split('\n')) }).toThrow(/行数期望 1,实际 0/)
    // 在 preset-cordis 的 persona 插件项 span 内(块后续行之后、planning 项之前)
    // 注入第二条 prefix 行 → 2 命中。
    const two = WEB_PATCH.replace(
      '            You are a coding agent powered by the {{model}} model.',
      '            You are a coding agent powered by the {{model}} model.\n          prefix: "extra"',
    )
    expect(() => { entrySpanOf(entry(ID), two.split('\n')) }).toThrow(/行数期望 1,实际 2/)
  })

  it('写回:整块替换无续行残留,round-trip 一致,后续插件项(planning/!!js)逐字节保真', () => {
    const nextText = 'You are the Cordis creative companion. 红线:预算超支>5%必须触发审批;对外付款不得代付;比选必须中立。'
    const { next } = writeAndVerify(ID, WEB_PATCH, nextText)
    // 旧续行零残留(块标量单行替换会产生脏 YAML 的正是这条断言防的)。
    expect(next).not.toMatch(/prefix: >.*\n\s*You are a coding agent powered by the \{\{model\}\} model\./)
    expect(next).toContain("disabled: !!js \"!ctx.get('profileContext')\"")
    expect(next).toContain('      - id: planning')
  })

  it('TOCTOU(形态 B):审批后 patch 被外部改写 → 拒写零落盘、外部状态保持', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'eterna-entry-patch-b-'))
    const path = join(dir, 'cordis.patch.yml')
    writeFileSync(path, WEB_PATCH, 'utf8')
    try {
      const writer = new EntryPatchFile()
      const external = WEB_PATCH.replace('- id: preset-cordis', '- id: preset-cordis # upgraded')
      writeFileSync(path, external, 'utf8')
      const nextText = 'You are the Cordis creative companion v2.'
      await expect(writer.writeNext({
        path,
        baseline: WEB_PATCH,
        build: original => buildNextEntryFileText(entry(ID), original, nextText),
      })).rejects.toThrow(/TOCTOU 拒写/)
      expect(readFileSync(path, 'utf8')).toBe(external)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

describe('T1.6 形态 C|plan-mode 字面块 |(多段整段写回,三类最难)——planning 组嵌套定位', () => {
  const ID = 'preset.standard.plan-mode.section'

  it('定位:planning 组 → plan-mode 插件项 → section 块(嵌套 pluginPath 两级)', () => {
    const lines = WEB_PATCH.split('\n')
    const span = entrySpanOf(entry(ID), lines)
    expect(span.isBlock).toBe(true)
    expect(lines[span.keyIndex]).toBe('              section: |')
    expect(lines[span.keyIndex + 1]).toContain('You are in plan mode. Stay in plan mode.')
    // 块止于最后一段;下一插件项紧随其后(本 fixture 无分隔空行,如有也不属替换区域)。
    const lastParagraph = lines.findIndex(line => line === '                Make the plan decision-complete.')
    expect(span.end).toBe(lastParagraph + 1)
    expect(lines[span.end]).toBe('      - id: tool-bash')
  })

  it('定位 0/≥2 命中 → fail-closed(组缺行/section 键行重复)', () => {
    const missingGroup = WEB_PATCH.replace('      - id: planning', '      - id: other-group')
    expect(() => { entrySpanOf(entry(ID), missingGroup.split('\n')) }).toThrow(/插件项.*planning.*不在/)
    // 在 planning 组 span 内注入第二条 section 键行 → 2 命中。
    const duplicated = WEB_PATCH.replace(
      '      - id: tool-bash',
      '              section: |dup\n      - id: tool-bash',
    )
    expect(() => { entrySpanOf(entry(ID), duplicated.split('\n')) }).toThrow(/行数期望 1,实际 2/)
  })

  it('写回:多段整段替换(round-trip 含段落空行/clip 尾换行),!!js 行逐字节保真', () => {
    const nextText = 'You are in plan mode v2.\n\n段落二:explore first.\n\n段落三:decision-complete.\n'
    const { next } = writeAndVerify(ID, WEB_PATCH, nextText)
    // 旧段零残留;新块以字面式写回(样式沿用 |),chomping 按文本尾换行适配(clip)。
    expect(next).not.toContain('Explore first. Use non-mutating reads.')
    expect(next).toContain('section: |')
    expect(next).toContain('段落三:decision-complete.')
    expect(next).toContain("disabled: !!js process.platform === 'win32'")
  })

  it('写回无尾换行文本 → chomping 适配为 strip(-),round-trip 仍逐字一致', () => {
    const noTrailingNewline = 'You are in plan mode.\n\nNo trailing newline.'
    const { next } = writeAndVerify(ID, WEB_PATCH, noTrailingNewline)
    expect(next).toContain('section: |-')
  })

  it('TOCTOU(形态 C)+ verify 失败自动还原(双防线各自独立生效)', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'eterna-entry-patch-c-'))
    const path = join(dir, 'cordis.patch.yml')
    writeFileSync(path, WEB_PATCH, 'utf8')
    try {
      const writer = new EntryPatchFile()
      // ① TOCTOU:外部改写后基线不符 → 拒写零落盘。
      const external = WEB_PATCH.replace('# fixture web patch(形态 B/C 同构)', '# externally merged')
      writeFileSync(path, external, 'utf8')
      await expect(writer.writeNext({
        path, baseline: WEB_PATCH,
        build: original => buildNextEntryFileText(entry(ID), original, 'new plan text.\n'),
      })).rejects.toThrow(/TOCTOU 拒写/)
      expect(readFileSync(path, 'utf8')).toBe(external)
      // ② verify 失败(dry-run 干跑不过)→ 自动还原原始字节 + 无残留。
      writeFileSync(path, WEB_PATCH, 'utf8')
      await expect(writer.writeNext({
        path,
        build: original => buildNextEntryFileText(entry(ID), original, 'verify will fail.\n'),
        verify: async () => { throw new Error('dump-config 干跑未通过') },
      })).rejects.toThrow('dump-config 干跑未通过')
      expect(readFileSync(path, 'utf8')).toBe(WEB_PATCH)
      expect(readdirSync(dir).filter(name => name.startsWith('.prompt-studio.'))).toEqual([])
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

describe('T1.6 标量与整文件形态', () => {
  it('单行标量(裸标量 persona):双引号重述,round-trip 一致(任意文本安全)', () => {
    const ID = 'preset.standard.persona'
    const nextText = 'You are the standard agent.\n红线:预算超支>5%必须触发审批;对外付款不得代付;比选必须中立。'
    const { next } = writeAndVerify(ID, WEB_PATCH, nextText)
    expect(next).toContain('prefix: "You are the standard agent.\\n红线:预算超支>5%必须触发审批;对外付款不得代付;比选必须中立。"')
  })

  it('数值标量(agent-instructions maxBytes):纯整数保持裸标量(YAML 数值类型不漂移)', () => {
    const ID = 'preset.standard.agent-instructions'
    const withKey = WEB_PATCH.replace(
      '          prefix: You are a coding agent powered by the {{model}} model.',
      '          prefix: You are a coding agent powered by the {{model}} model.\n      - id: agent-instructions\n        config:\n          maxBytes: 65536',
    )
    const { next } = writeAndVerify(ID, withKey, '131072')
    expect(next).toContain('maxBytes: 131072')
    expect(next).not.toContain('maxBytes: "131072"')
  })

  it('整文件条目(persona.md):写回=全文替换,selfCheck 通过', () => {
    const ID = 'domain.event-planning.persona-md'
    const original = '# persona\n\nYou are the event planner.\n红线:预算超支>5%必须触发审批;对外付款不得代付;比选必须中立。\n'
    const nextText = '# persona\n\nYou are the event planner v2.\n红线:预算超支>5%必须触发审批;对外付款不得代付;比选必须中立。\n'
    const next = buildNextEntryFileText(entry(ID), original, nextText)
    expect(next).toBe(nextText)
    expect(() => { selfCheckEntryWrite(entry(ID), original, next, nextText) }).not.toThrow()
  })

  it('嵌套映射值(值在后续行)→ fail-closed 明示不支持', () => {
    const nested = WEB_PATCH.replace(
      '          prefix: You are a coding agent powered by the {{model}} model.',
      '          prefix:  \n            nested: true',
    )
    expect(() => { entrySpanOf(entry('preset.standard.persona'), nested.split('\n')) }).toThrow(/值在后续行/)
  })
})

describe('T3.2 形态 D|多行 plain 折叠标量(configEditor 长值序列化形态)——读侧折叠反引 + 整段替换', () => {
  const ID = 'preset.standard.persona'
  /**
   * 2026-11-11 t7 隔离档实测形态(t32-repro):官方 configEditor edit() 把长单行值
   * 序列化为「键行首段 + 更深缩进续行」的 plain 折叠标量(dump-config 语义正确);
   * 读侧只取键行会截断(69/157 字节),写侧单行替换会残留续行成脏 YAML。
   */
  const FOLDED_PATCH = [
    '# fixture web patch(形态 D:configEditor 折叠输出同构)',
    '- id: preset-standard',
    '  config:',
    '    plugins:',
    '      - id: persona',
    "        name: '@deepseek-ai/dsh-persona'",
    '        config:',
    '          prefix: T7_SMOKE_PERSONA_MARKER base prompt studio smoke alpha AI_PROPOSAL_V2',
    '            红线:预算超支>5%必须触发审批;对外付款不得代付;比选必须中立。',
    '      - id: agent-instructions',
    "        name: '@deepseek-ai/dsh-agent-instructions'",
    '        config:',
    '          maxBytes: 65536',
    '',
  ].join('\n')
  const FOLDED_TEXT = 'T7_SMOKE_PERSONA_MARKER base prompt studio smoke alpha AI_PROPOSAL_V2 红线:预算超支>5%必须触发审批;对外付款不得代付;比选必须中立。'

  it('读侧:续行按 plain 折叠语义反引(相邻行并空格)——键行+续行==全文,不截断', () => {
    const lines = FOLDED_PATCH.split('\n')
    const keyIndex = lines.findIndex(line => line.includes('prefix: T7_SMOKE'))
    expect(keyIndex).toBeGreaterThanOrEqual(0)
    expect(readYamlValueAtLine(lines, keyIndex)).toBe(FOLDED_TEXT)
    // 中间空行折叠语义:k 个连续空行 → k 个换行(与块折叠同口径)。
    const withBlank = [
      '          prefix: alpha',
      '            beta',
      '',
      '',
      '            gamma',
      '      - next',
    ]
    expect(readYamlValueAtLine(withBlank, 0)).toBe('alpha beta\n\ngamma')
  })

  it('读侧:单行引号标量语义不变;多行引号标量 → fail-closed undefined(本面不解析不猜)', () => {
    expect(readYamlValueAtLine(['          prefix: "plain single"', '      - next'], 0)).toBe('plain single')
    expect(readYamlValueAtLine(["          prefix: 'x'", '            continued'], 0)).toBeUndefined()
  })

  it('写侧:span 覆盖键行+全部续行,标量整段替换(续行零残留),round-trip 一致', () => {
    const nextText = 'AI 建议稿(T3.2):更紧凑的 persona 重述。红线:预算超支>5%必须触发审批;对外付款不得代付;比选必须中立。'
    const { next } = writeAndVerify(ID, FOLDED_PATCH, nextText)
    // 新文本单行双引号;原续行(红线句)不残留。
    expect(next).toContain('prefix: "AI 建议稿(T3.2):更紧凑的 persona 重述。红线:预算超支>5%必须触发审批;对外付款不得代付;比选必须中立。"')
    expect(next).not.toContain('\n            红线:预算超支')
    // 后续插件项逐字节保真。
    expect(next).toContain('maxBytes: 65536')
  })

  it('写侧:折叠形态上再写回同文(语义等价)→ 读回==目标,span 收敛为单行', () => {
    const { next } = writeAndVerify(ID, FOLDED_PATCH, FOLDED_TEXT)
    const again = buildNextEntryFileText(entry(ID), next, FOLDED_TEXT)
    expect(() => { selfCheckEntryWrite(entry(ID), next, again, FOLDED_TEXT) }).not.toThrow()
  })
})

describe('T1.6 EntryPatchFile 写纪律(同文件多条目单写者/语义等价短路/折叠块边界)', () => {
  let dir: string
  let path: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'eterna-entry-patch-io-'))
    path = join(dir, 'cordis.patch.yml')
    writeFileSync(path, WEB_PATCH, 'utf8')
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('同一 patch 文件的两个条目并发写(preset persona + plan-mode)→ 单写者串行,双双生效互不覆盖', async () => {
    const writer = new EntryPatchFile()
    const personaText = 'Standard persona after concurrent write.'
    const planText = 'Plan mode after concurrent write.\n'
    await Promise.all([
      writer.writeNext({ path, build: original => buildNextEntryFileText(entry('preset.standard.persona'), original, personaText) }),
      writer.writeNext({ path, build: original => buildNextEntryFileText(entry('preset.standard.plan-mode.section'), original, planText) }),
    ])
    const lines = readFileSync(path, 'utf8').split('\n')
    const personaSpan = entrySpanOf(entry('preset.standard.persona'), lines)
    const planSpan = entrySpanOf(entry('preset.standard.plan-mode.section'), lines)
    expect(readYamlValueAtLine(lines, personaSpan.keyIndex)).toBe(personaText)
    expect(readYamlValueAtLine(lines, planSpan.keyIndex)).toBe(planText)
    expect(readdirSync(dir).filter(name => name.startsWith('.prompt-studio.'))).toEqual([])
  })

  it('语义等价短路:build 产物与现值一致 → 不写盘、不跑 verify', async () => {
    const writer = new EntryPatchFile()
    let verifyCalls = 0
    const result = await writer.writeNext({
      path,
      build: original => buildNextEntryFileText(entry('preset.cordis.persona'), original, 'You are a coding agent powered by the {{model}} model.'),
      verify: async () => { verifyCalls += 1 },
    })
    expect(result.changed).toBe(false)
    expect(verifyCalls).toBe(0)
    expect(readFileSync(path, 'utf8')).toBe(WEB_PATCH)
  })

  it('折叠块(>)收到正文首行前空行的文本 → round-trip 自检 fail-closed 拦截,零落盘', async () => {
    const packPath = join(dir, 'pack.patch.yml')
    writeFileSync(packPath, PACK_PATCH, 'utf8')
    const writer = new EntryPatchFile()
    const badText = '\nstarts with a newline.'
    await expect(writer.writeNext({
      path: packPath,
      build: (original) => {
        const next = buildNextEntryFileText(entry('domain.event-planning.persona-prefix'), original, badText)
        selfCheckEntryWrite(entry('domain.event-planning.persona-prefix'), original, next, badText)
        return next
      },
    })).rejects.toThrow(/反引与目标不一致/)
    expect(readFileSync(packPath, 'utf8')).toBe(PACK_PATCH)
  })

  it('build 抛错(定位失败)→ 零落盘,文件原样', async () => {
    const writer = new EntryPatchFile()
    const broken = WEB_PATCH.replace('- id: preset-cordis', '- id: preset-gone')
    writeFileSync(path, broken, 'utf8')
    await expect(writer.writeNext({
      path,
      build: original => buildNextEntryFileText(entry('preset.cordis.persona'), original, 'x'),
    })).rejects.toThrow(/写回定位失败/)
    expect(readFileSync(path, 'utf8')).toBe(broken)
    expect(readdirSync(dir).filter(name => name.startsWith('.prompt-studio.'))).toEqual([])
  })
})
