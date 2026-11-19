/**
 * 流程启动条客户端纯逻辑测试(2026-11-20):解析/可见性谓词、草稿模型(脏检查/
 * 问题检查/id 生成)、内置模板派生、设置分区 CSS 令牌纪律、双语文案键齐备。
 * 本仓客户端测试不做组件渲染(react-dom 由宿主壳提供),纯函数直测
 * (memory client-sources/client-settings 同款拆法)。
 */
import { describe, expect, it } from 'vitest'
import {
  BUILTIN_CHIP_TEMPLATES, GUIDE_PROMPTS,
} from '../src/prompts.ts'
import {
  CHIP_LIMITS, chipsBarEntries, DEFAULT_CHIPS_CONFIG, parseChipsConfig,
} from '../src/chips.ts'
import {
  chipsDirty, draftToChip, draftsFromConfig, firstDraftIssue, genChipId,
} from '../src/client/chips-model.ts'
import { CHIPS_SETTINGS_CSS } from '../src/client/styles.ts'
import { en, zh, type EternaPanelLocaleKey } from '../src/client/locales.ts'

const chipA = { id: 'c-a', title: '知识检索', kickoff: '启动「知识检索」流程。', enabled: true }
const chipB = { id: 'c-b', title: '预算计算', kickoff: '启动「预算计算」流程。', note: '复盘用', enabled: false }
const config = { revision: 3, visible: true, chips: [chipA, chipB] }

describe('parseChipsConfig(防御性解析)', () => {
  it('合法配置透传(含 note 省略归一)', () => {
    expect(parseChipsConfig(config)).toEqual(config)
  })
  it('坏结构逐项拒收', () => {
    expect(parseChipsConfig(null)).toBeUndefined()
    expect(parseChipsConfig([])).toBeUndefined()
    expect(parseChipsConfig({ ...config, revision: -1 })).toBeUndefined()
    expect(parseChipsConfig({ ...config, revision: 1.5 })).toBeUndefined()
    expect(parseChipsConfig({ ...config, visible: 'yes' })).toBeUndefined()
    expect(parseChipsConfig({ ...config, chips: 'no' })).toBeUndefined()
    expect(parseChipsConfig({ ...config, chips: [{ ...chipA, id: '坏 id' }] })).toBeUndefined()
    expect(parseChipsConfig({ ...config, chips: [{ ...chipA, title: '' }] })).toBeUndefined()
    expect(parseChipsConfig({ ...config, chips: [{ ...chipA, enabled: 1 }] })).toBeUndefined()
    expect(parseChipsConfig({ ...config, chips: [{ ...chipA, note: 'x'.repeat(CHIP_LIMITS.note + 1) }] })).toBeUndefined()
    expect(parseChipsConfig({ ...config, chips: [chipA, chipA] })).toBeUndefined()
    expect(parseChipsConfig({ ...config, chips: Array.from({ length: 13 }, (_, i) => ({ ...chipA, id: `c-${i}` })) })).toBeUndefined()
  })
})

describe('chipsBarEntries(触发条可见性谓词)', () => {
  it('总开关关 → 空数组;enabled 过滤;数组序即展示序', () => {
    expect(chipsBarEntries({ ...config, visible: false })).toEqual([])
    expect(chipsBarEntries(config).map(chip => chip.id)).toEqual(['c-a'])
    expect(chipsBarEntries({ ...config, chips: [chipB, chipA] }).map(chip => chip.id)).toEqual(['c-a'])
  })
  it('空配置 → 空数组(初始为空,整条隐藏)', () => {
    expect(chipsBarEntries(DEFAULT_CHIPS_CONFIG)).toEqual([])
  })
})

describe('草稿模型(设置分区纯逻辑)', () => {
  it('draftsFromConfig/draftToChip 往返:note 归一、editing 收起', () => {
    const drafts = draftsFromConfig(config)
    expect(drafts).toHaveLength(2)
    expect(drafts[0]).toMatchObject({ id: 'c-a', note: '', editing: false })
    expect(drafts[1]).toMatchObject({ id: 'c-b', note: '复盘用', enabled: false })
    expect(draftToChip(drafts[1] ?? { id: '', title: '', kickoff: '', note: '', enabled: false, editing: false })).toEqual(chipB)
  })

  it('chipsDirty:内容/顺序/启停/条数/总开关任一变化即脏;trim 归一不算脏', () => {
    const drafts = draftsFromConfig(config)
    expect(chipsDirty(config, true, drafts)).toBe(false)
    // 仅首尾空白差异(trim 归一后一致)→ 不脏
    expect(chipsDirty(config, true, [{ ...drafts[0]!, title: ' 知识检索 ', editing: false }, drafts[1]!])).toBe(false)
    expect(chipsDirty(config, false, drafts)).toBe(true)
    expect(chipsDirty(config, true, [{ ...drafts[0]!, title: '改', editing: false }, drafts[1]!])).toBe(true)
    expect(chipsDirty(config, true, [drafts[1]!, drafts[0]!])).toBe(true)
    expect(chipsDirty(config, true, [])).toBe(true)
    expect(chipsDirty(null, true, drafts)).toBe(false)
  })

  it('firstDraftIssue:缺标题/缺启动语/超限 → 中文问题;齐备 → null', () => {
    const good = draftsFromConfig(config)
    expect(firstDraftIssue(good)).toBeNull()
    expect(firstDraftIssue([{ ...good[0]!, title: '' }])).toContain('缺少标题')
    expect(firstDraftIssue([{ ...good[0]!, kickoff: ' ' }])).toContain('缺少标题')
    expect(firstDraftIssue([{ ...good[0]!, title: '长'.repeat(CHIP_LIMITS.title + 1) }])).toContain('标题超过')
    expect(firstDraftIssue([{ ...good[0]!, kickoff: '长'.repeat(CHIP_LIMITS.kickoff + 1) }])).toContain('启动语超过')
    expect(firstDraftIssue([{ ...good[0]!, note: '长'.repeat(CHIP_LIMITS.note + 1) }])).toContain('备注超过')
  })

  it('genChipId:格式合法(id 集安全字符)且多次生成互不相同', () => {
    const ids = new Set(Array.from({ length: 64 }, () => genChipId()))
    expect(ids.size).toBe(64)
    for (const id of ids) expect(id).toMatch(/^c-[A-Za-z0-9_-]+$/)
  })
})

describe('BUILTIN_CHIP_TEMPLATES(内置模板派生)', () => {
  it('非 memory 域四条,与 GUIDE_PROMPTS 标题一致,kickoff 非空', () => {
    const expected = GUIDE_PROMPTS.filter(entry => entry.capability !== 'memory').map(entry => entry.title)
    expect(BUILTIN_CHIP_TEMPLATES.map(template => template.title)).toEqual(expected)
    expect(BUILTIN_CHIP_TEMPLATES).toHaveLength(4)
    for (const template of BUILTIN_CHIP_TEMPLATES) {
      expect(template.kickoff.trim().length).toBeGreaterThan(0)
      expect(template.kickoff.trim().length).toBeLessThanOrEqual(CHIP_LIMITS.kickoff)
    }
  })
})

describe('CHIPS_SETTINGS_CSS(令牌纪律断言)', () => {
  const css = CHIPS_SETTINGS_CSS
  it('无字面色值(无 #hex / rgb( / hsl()', () => {
    expect(css).not.toMatch(/#[0-9a-fA-F]{3,8}\b/)
    expect(css).not.toMatch(/rgba?\(/)
    expect(css).not.toMatch(/hsla?\(/)
  })
  it('只引用 --et-* 令牌,无 --dsw-alias-* 手写', () => {
    expect(css).toContain('var(--et-')
    expect(css).not.toContain('--dsw-alias-')
  })
  it('圆角只走阶梯令牌或 9999px(pill)', () => {
    const declarations = css.match(/border-radius:[^;]+;/g) ?? []
    expect(declarations.length).toBeGreaterThan(0)
    for (const declaration of declarations) {
      expect(declaration).toMatch(/var\(--et-radius-(sm|md|lg|pill)\)|9999px/)
    }
  })
  it('无新增叠层(无 z-index);reduced-motion 全覆盖', () => {
    expect(css).not.toContain('z-index')
    expect(css).toContain('prefers-reduced-motion')
  })
})

describe('locales(chips.* 双语键齐备)', () => {
  const keys: EternaPanelLocaleKey[] = [
    'chips.section', 'chips.hint', 'chips.visible', 'chips.add', 'chips.importTemplates',
    'chips.clearAll', 'chips.clearConfirm', 'chips.empty', 'chips.fieldTitle', 'chips.fieldKickoff',
    'chips.fieldNote', 'chips.titlePlaceholder', 'chips.kickoffPlaceholder', 'chips.untitled',
    'chips.edit', 'chips.done', 'chips.delete', 'chips.deleteConfirm', 'chips.up', 'chips.down',
    'chips.enabled', 'chips.save', 'chips.saving', 'chips.saved', 'chips.conflict', 'chips.error',
    'chips.loadError',
  ]
  it('zh/en 每个键都非空字符串', () => {
    for (const key of keys) {
      expect((zh[key] ?? '').length, `zh:${key}`).toBeGreaterThan(0)
      expect((en[key] ?? '').length, `en:${key}`).toBeGreaterThan(0)
    }
  })
})
