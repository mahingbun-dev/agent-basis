/**
 * 校验器全集与行 diff 单测(T7.3):
 * 非空 / 非字符串拒绝 / UTF-8 合法(孤立代理项拒收)/ ≤65536 UTF-8 字节 /
 * 三条红线锚点必须存在(预算不超支/不代付/比选中立,对齐 packs/event-planning
 * persona.md 全局硬约束;真文件交叉钉住)/ diff 空与统计 / lineDiffOps 逐行投影。
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { diffLines, diffSummaryText, lineDiffOps, splitLines } from '../src/diff.ts'
import type { LineDiffOp } from '../src/diff.ts'
import {
  INDUSTRIAL_RED_LINE_RULES, MAX_PERSONA_BYTES, RED_LINE_RULES, RED_LINE_RULE_SETS, checkRedLines,
  checkRedLinesOfRuleSet, checkUtf8WellFormed, validateEntryText, validatePersonaText,
} from '../src/validator.ts'
import { missingRedLineRules, redLineInsertLinesOf, RED_LINE_INSERT_LINES } from '../src/red-lines.ts'

/** 带三条红线锚点的最小合法 persona(锚点措辞与 event-planning persona 同款)。 */
const RED_LINES = '红线:预算超支>5%必须触发审批;对外付款不得代付;比选必须中立。'
const BASE_OK = `You are the Eterna enterprise assistant.\n${RED_LINES}`

describe('validatePersonaText(骨架规则)', () => {
  it('合法文本通过', () => {
    const result = validatePersonaText(BASE_OK)
    expect(result.ok).toBe(true)
    expect(result.issues).toEqual([])
  })

  it('非字符串拒绝', () => {
    for (const bad of [undefined, null, 42, {}, ['x']]) {
      expect(validatePersonaText(bad).ok).toBe(false)
    }
    expect(validatePersonaText(42).issues[0]).toContain('字符串')
  })

  it('空文本与全空白拒绝', () => {
    expect(validatePersonaText('').ok).toBe(false)
    expect(validatePersonaText('   \n\t ').ok).toBe(false)
    expect(validatePersonaText('').issues[0]).toContain('不能为空')
  })

  it('恰好 65536 字节通过,65537 拒绝(UTF-8 口径,多字节字符按字节计)', () => {
    const pad = MAX_PERSONA_BYTES - Buffer.byteLength(BASE_OK, 'utf8')
    const boundary = `${BASE_OK}${'a'.repeat(pad)}`
    expect(validatePersonaText(boundary).ok).toBe(true)
    const overflow = `${boundary}a`
    expect(validatePersonaText(overflow).ok).toBe(false)
    expect(validatePersonaText(overflow).issues.join('\n')).toContain('65537 字节 > 65536')
    // 多字节:全 CJK 文本按字节计(红线锚点也在,唯一 issue 是超限)
    const cjk = `预算超支不得代付比选必须中立${'你'.repeat(65500)}` // >65536 字节
    const cjkResult = validatePersonaText(cjk)
    expect(cjkResult.ok).toBe(false)
    expect(cjkResult.issues.some(issue => issue.includes('字节 > 65536'))).toBe(true)
  })
})

describe('validatePersonaText(UTF-8 合法性,T7.3 新增)', () => {
  it('合法 UTF-16(含增补平面代理对/CJK/emoji)通过', () => {
    expect(checkUtf8WellFormed('你好 world')).toBeUndefined()
    expect(checkUtf8WellFormed('emoji 😀 与代理对 𝕏 混排')).toBeUndefined()
    expect(validatePersonaText(`${BASE_OK}\n😀 𝕏`).ok).toBe(true)
  })

  it('孤立高位代理拒收(编码到 UTF-8 会被替换成 U+FFFD,checksum 口径漂移)', () => {
    const lone = `${BASE_OK} broken \uD800 tail`
    expect(checkUtf8WellFormed(lone)).toContain('孤立代理项')
    const result = validatePersonaText(lone)
    expect(result.ok).toBe(false)
    expect(result.issues[0]).toContain('孤立代理项')
    expect(result.issues[0]).toContain('U+D800')
  })

  it('孤立低位代理 / 相邻两个高位代理拒收', () => {
    expect(checkUtf8WellFormed(`${BASE_OK} \uDFFF`)).toContain('孤立代理项')
    expect(checkUtf8WellFormed(`${BASE_OK} \uD800\uD801`)).toContain('孤立代理项')
    expect(checkUtf8WellFormed(`${BASE_OK} \uD800A\uDFFF`)).toContain('孤立代理项')
  })
})

describe('validatePersonaText(红线段必须存在,T7.3 新增)', () => {
  it('三条红线锚点齐备 → 通过;逐条抽掉 → 对应 issue(指明缺哪条)', () => {
    for (const rule of RED_LINE_RULES) {
      const without = BASE_OK.replace(rule.pattern, '——')
      expect(checkRedLines(without)).toHaveLength(1)
      expect(checkRedLines(without)[0]).toContain(`「${rule.label}」`)
      expect(validatePersonaText(without).ok).toBe(false)
    }
  })

  it('全缺 → 三条 issue 按声明顺序', () => {
    const issues = checkRedLines('干干净净的文本,什么红线都没有')
    expect(issues).toHaveLength(3)
    expect(issues[0]).toContain('预算不超支')
    expect(issues[1]).toContain('不代付')
    expect(issues[2]).toContain('比选中立')
  })

  it('锚点宽容度:改写措辞不改语义仍通过(预算不得超支/不能代付/比选须保持中立)', () => {
    expect(validatePersonaText('红线:预算不得超支;付款不能代付;比选须保持中立。').ok).toBe(true)
    expect(validatePersonaText('红线:预算不超支,绝不代付,比选中立。').ok).toBe(true)
  })

  it('交叉钉住:packs/event-planning/persona.md 真文件通过校验(锚点对齐事实源)', () => {
    const personaPath = join(import.meta.dirname, '..', '..', '..', 'packs', 'event-planning', 'persona.md')
    const persona = readFileSync(personaPath, 'utf8')
    const result = validatePersonaText(persona)
    expect(result.issues).toEqual([])
    expect(result.ok).toBe(true)
  })
})

describe('diffLines(行级 diff)', () => {
  it('完全一致 = isEmpty(不可保存)', () => {
    expect(diffLines('a\nb\nc', 'a\nb\nc')).toEqual({ added: 0, removed: 0, isEmpty: true })
  })

  it('纯新增/纯删除计数', () => {
    expect(diffLines('a\nb', 'a\nb\nc\nd')).toEqual({ added: 2, removed: 0, isEmpty: false })
    expect(diffLines('a\nb\nc\nd', 'a\nb')).toEqual({ added: 0, removed: 2, isEmpty: false })
  })

  it('中段改写:公共前后缀被剔除后按 LCS 计数', () => {
    const result = diffLines('head\nold-1\nold-2\ntail', 'head\nnew-1\ntail')
    expect(result).toEqual({ added: 1, removed: 2, isEmpty: false })
  })

  it('CRLF 归一后比较(同内容不同行尾不算 diff)', () => {
    expect(diffLines('a\r\nb', 'a\nb').isEmpty).toBe(true)
    expect(splitLines('a\r\nb\rc')).toEqual(['a', 'b', 'c'])
  })

  it('全重写(无公共行)计数正确', () => {
    expect(diffLines('x\ny', 'p\nq\nr')).toEqual({ added: 3, removed: 2, isEmpty: false })
  })

  it('大文本性能口径:64KB 级(约 2k 行)毫秒级完成', () => {
    const before = Array.from({ length: 2000 }, (_, i) => `line ${i} ${'x'.repeat(30)}`).join('\n')
    const after = before.replace('line 1000', 'line 1000 CHANGED')
    const t0 = process.hrtime.bigint()
    const result = diffLines(before, after)
    const ms = Number(process.hrtime.bigint() - t0) / 1e6
    expect(result.isEmpty).toBe(false)
    expect(ms).toBeLessThan(2000)
  })

  it('diffSummaryText 人话文案', () => {
    expect(diffSummaryText({ added: 3, removed: 12, isEmpty: false })).toBe('+3/-12 行')
    expect(diffSummaryText({ added: 0, removed: 0, isEmpty: true })).toBe('无差异')
  })
})

describe('lineDiffOps(逐行 diff 投影,T7.3 ②:版本对比视图)', () => {
  const opsOf = (before: string, after: string): readonly LineDiffOp[] => lineDiffOps(before, after)
  const render = (ops: readonly LineDiffOp[]): string => ops.map(op => op.text).join('\n')

  it('完全一致:全 same', () => {
    const ops = opsOf('a\nb', 'a\nb')
    expect(ops.map(op => op.type)).toEqual(['same', 'same'])
  })

  it('中段改写:same/del/add 交错且按行序,拼接回原文本', () => {
    const before = 'head\nold-1\nold-2\ntail'
    const after = 'head\nnew-1\ntail'
    const ops = opsOf(before, after)
    expect(ops.map(op => op.type)).toEqual(['same', 'del', 'del', 'add', 'same'])
    // 删行+原文行重组 = before;删行以外 = after
    expect(render(ops)).toBe(['head', 'old-1', 'old-2', 'new-1', 'tail'].join('\n'))
    const delTexts = ops.filter(op => op.type === 'del').map(op => op.text)
    expect(delTexts).toEqual(['old-1', 'old-2'])
  })

  it('纯增/纯删/首尾编辑,统计口径与 diffLines 一致', () => {
    const count = (ops: readonly LineDiffOp[]): { added: number; removed: number } => ({
      added: ops.filter(op => op.type === 'add').length,
      removed: ops.filter(op => op.type === 'del').length,
    })
    for (const [before, after] of [
      ['a\nb', 'a\nb\nc\nd'],
      ['a\nb\nc\nd', 'a\nb'],
      ['x\ny', 'p\nq\nr'],
      ['head\nold\ntail', 'head\nnew\ntail'],
      ['a\r\nb', 'a\nb\nc'],
    ] as const) {
      const ops = opsOf(before, after)
      expect(count(ops)).toEqual({ added: diffLines(before, after).added, removed: diffLines(before, after).removed })
    }
  })

  it('CRLF 归一后投影(与 diffLines 同口径)', () => {
    expect(opsOf('a\r\nb', 'a\nb').every(op => op.type === 'same')).toBe(true)
  })

  it('病态全重写(超过 MAX_OPS_CELLS)降级为整块 del+add,计数不丢', () => {
    const before = Array.from({ length: 1200 }, (_, i) => `old ${i}`).join('\n')
    const after = Array.from({ length: 1200 }, (_, i) => `new ${i}`).join('\n')
    const ops = opsOf(before, after)
    const added = ops.filter(op => op.type === 'add').length
    const removed = ops.filter(op => op.type === 'del').length
    expect(removed).toBe(1200)
    expect(added).toBe(1200)
    expect(diffLines(before, after)).toEqual({ added: 1200, removed: 1200, isEmpty: false })
  })
})

/**
 * T1.6 按条目校验器与规则集(测试计划 §3 T1.6(b)③④ + §6 横切 3):
 * - validateEntryText:骨架规则按条目参数化(maxBytes),红线按条目策略/规则集;
 * - 规则集登记面(标准双语/工业四条/未知 fail-closed);
 * - 交叉钉住:industrial-analysis persona.md 与 personaPrefix 真文件过工业规则集
 *   (§6 横切 3 的「补 industrial-analysis/persona.md 钉住」);
 *   event-planning personaPrefix 英文句过标准集(双语锚点与真事实源对齐)。
 */
describe('T1.6 validateEntryText(按条目校验器)', () => {
  const STANDARD_REQUIRED = { redLine: 'required' as const, redLineRuleSet: 'eterna.red-lines.standard' }
  const INDUSTRIAL_REQUIRED = { redLine: 'required' as const, redLineRuleSet: 'eterna.red-lines.industrial-analysis' }
  const EXEMPT = { redLine: 'exempt' as const }

  it('exempt 条目不做红线检查(T1.3 豁免标记生效)', () => {
    const result = validateEntryText(EXEMPT, '没有任何红线的普通提示词')
    expect(result.ok).toBe(true)
    expect(result.issues).toEqual([])
  })

  it('required+标准集:与 validatePersonaText 同判(CJK 锚点)', () => {
    expect(validateEntryText(STANDARD_REQUIRED, BASE_OK).ok).toBe(true)
    const without = BASE_OK.replace(RED_LINE_RULES[0]?.pattern ?? /x/, '——')
    expect(validateEntryText(STANDARD_REQUIRED, without).ok).toBe(false)
    expect(validateEntryText(STANDARD_REQUIRED, without).issues.join('\n')).toContain('「预算不超支」')
  })

  it('maxBytes 逐条目参数化:条目自定义上限生效(默认 65536)', () => {
    const small = { ...EXEMPT, maxBytes: 100 }
    expect(validateEntryText(small, 'a'.repeat(100)).ok).toBe(true)
    const over = validateEntryText(small, 'a'.repeat(101))
    expect(over.ok).toBe(false)
    expect(over.issues.join('\n')).toContain('101 字节 > 100')
    // 缺省上限=MAX_PERSONA_BYTES。
    expect(validateEntryText(EXEMPT, 'a'.repeat(MAX_PERSONA_BYTES)).ok).toBe(true)
  })

  it('required+工业集:缺任一锚点逐条指明;四锚点齐备通过', () => {
    const full = '达梦业务库只读;数据与知识层只经 MCP 访问;对外发送必须确认(R2);deny 优先、fail-closed。'
    expect(validateEntryText(INDUSTRIAL_REQUIRED, full).ok).toBe(true)
    const missing = '达梦业务库只读;数据与知识层只经 MCP 访问;对外发送必须确认(R2)。'
    const result = validateEntryText(INDUSTRIAL_REQUIRED, missing)
    expect(result.ok).toBe(false)
    expect(result.issues.join('\n')).toContain('「deny 优先 fail-closed」')
    expect(result.issues).toHaveLength(1)
  })

  it('未知规则集 id → fail-closed 明示(不静默跳过)', () => {
    const result = validateEntryText({ redLine: 'required', redLineRuleSet: 'eterna.red-lines.no-such' }, BASE_OK)
    expect(result.ok).toBe(false)
    expect(result.issues.join('\n')).toContain('未知红线规则集')
  })
})

describe('T1.6 红线规则集登记面与真文件交叉钉住', () => {
  const readRepoFile = (file: string) => readFileSync(join(import.meta.dirname, '..', '..', '..', file), 'utf8')

  it('RED_LINE_RULE_SETS:两套规则集登记在场', () => {
    expect(RED_LINE_RULE_SETS['eterna.red-lines.standard']).toBe(RED_LINE_RULES)
    expect(RED_LINE_RULE_SETS['eterna.red-lines.industrial-analysis']).toBe(INDUSTRIAL_RED_LINE_RULES)
  })

  it('双语锚点:industrial persona.md 真文件过工业集(四条全中)', () => {
    const persona = readRepoFile('packs/industrial-analysis/persona.md')
    for (const rule of INDUSTRIAL_RED_LINE_RULES) {
      expect(rule.pattern.test(persona), `industrial persona.md 缺锚点 ${rule.id}`).toBe(true)
    }
    expect(validateEntryText({ redLine: 'required', redLineRuleSet: 'eterna.red-lines.industrial-analysis' }, persona).ok).toBe(true)
  })

  it('双语锚点:industrial personaPrefix(>- 折叠读回的英文句)过工业集', () => {
    // 折叠读回:>- 块行间以空格连接(与 registry.readEntryValue 同口径的独立实现)。
    const lines = readRepoFile('packs/industrial-analysis/cordis.patch.yml').split('\n')
    const header = lines.findIndex(line => /^(\s*)personaPrefix: >-\s*$/.test(line))
    expect(header).toBeGreaterThan(-1)
    const indent = (lines[header] ?? '').length - (lines[header] ?? '').trimStart().length
    const rows: string[] = []
    for (let i = header + 1; i < lines.length; i += 1) {
      const line = lines[i] as string
      if (line.trim() === '') continue
      const lineIndent = line.length - line.trimStart().length
      if (lineIndent <= indent) break
      rows.push(line.trim())
    }
    const folded = rows.join(' ')
    for (const rule of INDUSTRIAL_RED_LINE_RULES) {
      expect(rule.pattern.test(folded), `industrial personaPrefix 缺英文锚点 ${rule.id}`).toBe(true)
    }
  })

  it('双语锚点:event-planning personaPrefix 英文句过标准集(三条全中,锚点与真事实源对齐)', () => {
    const lines = readRepoFile('packs/event-planning/cordis.patch.yml').split('\n')
    const header = lines.findIndex(line => /^(\s*)personaPrefix: >-\s*$/.test(line))
    expect(header).toBeGreaterThan(-1)
    const indent = (lines[header] ?? '').length - (lines[header] ?? '').trimStart().length
    const rows: string[] = []
    for (let i = header + 1; i < lines.length; i += 1) {
      const line = lines[i] as string
      if (line.trim() === '') continue
      const lineIndent = line.length - line.trimStart().length
      if (lineIndent <= indent) break
      rows.push(line.trim())
    }
    const folded = rows.join(' ')
    expect(folded).toContain('Never silently exceed budgets')
    expect(validateEntryText({ redLine: 'required', redLineRuleSet: 'eterna.red-lines.standard' }, folded).ok).toBe(true)
    // 抽掉英文预算锚点 → 拒收且指明(双语锚点的负样本)。
    const withoutBudget = folded.replace(/exceed budgets/, 'overspend budgets')
    const result = validateEntryText({ redLine: 'required', redLineRuleSet: 'eterna.red-lines.standard' }, withoutBudget)
    expect(result.ok).toBe(false)
    expect(result.issues.join('\n')).toContain('「预算不超支」')
  })

  it('checkRedLinesOfRuleSet:按集逐条检查;未知集明示', () => {
    expect(checkRedLinesOfRuleSet('eterna.red-lines.standard', RED_LINES)).toEqual([])
    expect(checkRedLinesOfRuleSet('eterna.red-lines.industrial-analysis', '什么都没有').length).toBe(4)
    expect(checkRedLinesOfRuleSet('eterna.red-lines.unknown', RED_LINES).length).toBe(1)
  })
})

describe('红线预检查纯面(red-lines.ts,2026-11-12 编辑器预提示共用)', () => {
  it('missingRedLineRules:带锚文本零缺失;空文本全缺失(standard 3 条)', () => {
    expect(missingRedLineRules('eterna.red-lines.standard', RED_LINES)).toEqual([])
    expect(missingRedLineRules('eterna.red-lines.standard', '').map(r => r.id))
      .toEqual(['budget-overrun', 'no-payment', 'neutral-comparison'])
    expect(missingRedLineRules(undefined, '')).toEqual([])
    expect(missingRedLineRules('eterna.red-lines.unknown', '')).toEqual([])
  })
  it('插入文案逐条命中对应锚点正则(按钮插入后预检查必转绿)', () => {
    const missing = missingRedLineRules('eterna.red-lines.standard', 'You are a coding agent.')
    const lines = redLineInsertLinesOf(missing)
    expect(lines).toHaveLength(3)
    const healed = 'You are a coding agent.\n' + lines.join('\n')
    expect(missingRedLineRules('eterna.red-lines.standard', healed)).toEqual([])
  })
  it('插入文案映射覆盖全部规则 id(两个规则集;新增规则缺文案即红)', () => {
    for (const set of Object.values(RED_LINE_RULE_SETS)) {
      for (const rule of set) {
        expect(RED_LINE_INSERT_LINES[rule.id], rule.id).toBeTruthy()
      }
    }
  })
  it('工业四条的插入文案同样自洽(插入后缺失清零)', () => {
    const missing = missingRedLineRules('eterna.red-lines.industrial-analysis', '')
    const healed = redLineInsertLinesOf(missing).join('\n')
    expect(missingRedLineRules('eterna.red-lines.industrial-analysis', healed)).toEqual([])
  })
})
