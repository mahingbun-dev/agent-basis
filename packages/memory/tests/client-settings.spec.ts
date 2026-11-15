/**
 * 客户端纯逻辑单测(M-M3 T12-①③;组件渲染需 react-dom,由 dsh web 壳运行时
 * 提供,本包依赖图不可达——渲染级验收见 deviations):
 * - 设置分区:isMemoryPolicyDirty 合并保存脏检查 / resolvePolicyTier 防御回退 /
 *   端点常量 / CSS 令牌合规(零字面色值,AGENTS.md §2)/ 中文文案键面;
 * - 域 chip:domainChipLabel 主标签 / registeredDomainsOf 只列已转正域;
 * - 纠正预填桥:写入/读取/清除契约(window 桥;jsdom 级 window 存在)。
 */
import { describe, expect, it } from 'vitest'
import {
  CSS, isMemoryPolicyDirty, MEMORY_SECTION_ID, MEMORY_STATE_ENDPOINT, MEMORY_UPDATE_ENDPOINT,
  MEMORY_POLICY_TIERS, resolvePolicyTier, SETTINGS_LOCALES,
} from '../src/client/settings.tsx'
import { domainChipLabel, registeredDomainsOf } from '../src/client/domain-chip.tsx'
import {
  clearCorrectionPrefill, isMemoryCorrectionPrefill, MEMORY_CORRECTION_BRIDGE_KEY,
  MEMORY_CORRECTION_EVENT, setCorrectionPrefill, takeCorrectionPrefill,
} from '../src/client/correction.ts'
import { CHIP_CSS } from '../src/client/index.tsx'

describe('写入策略档位(T12-① 三档映射 review 规则)', () => {
  it('档位全集与缺省档(explicit-only / auto-review / full-auto)', () => {
    expect([...MEMORY_POLICY_TIERS]).toEqual(['explicit-only', 'auto-review', 'full-auto'])
  })

  it('resolvePolicyTier:合法档位原样,未知值回退 auto-review', () => {
    expect(resolvePolicyTier('explicit-only')).toBe('explicit-only')
    expect(resolvePolicyTier('full-auto')).toBe('full-auto')
    expect(resolvePolicyTier('auto-review')).toBe('auto-review')
    expect(resolvePolicyTier('everything')).toBe('auto-review')
    expect(resolvePolicyTier('')).toBe('auto-review')
  })
})

describe('合并保存脏检查(AGENTS.md §3)', () => {
  const loaded = { portraitEnabled: true, domainEnabled: true, writePolicy: 'auto-review' }

  it('三键全同 → 不脏', () => {
    expect(isMemoryPolicyDirty(loaded, { portraitEnabled: true, domainEnabled: true, writePolicy: 'auto-review' })).toBe(false)
  })

  it('任一键变化 → 脏', () => {
    expect(isMemoryPolicyDirty(loaded, { portraitEnabled: false, domainEnabled: true, writePolicy: 'auto-review' })).toBe(true)
    expect(isMemoryPolicyDirty(loaded, { portraitEnabled: true, domainEnabled: false, writePolicy: 'auto-review' })).toBe(true)
    expect(isMemoryPolicyDirty(loaded, { portraitEnabled: true, domainEnabled: true, writePolicy: 'full-auto' })).toBe(true)
  })
})

describe('端点与 CSS 令牌合规', () => {
  it('端点与分区 id 常量不变(读写契约)', () => {
    expect(MEMORY_SECTION_ID).toBe('eterna-memory.settings')
    expect(MEMORY_STATE_ENDPOINT).toBe('eternaMemory/state')
    expect(MEMORY_UPDATE_ENDPOINT).toBe('eternaMemory/updateConfig')
  })

  it('CSS 零字面色值:无 #hex、无 rgb()/hsl() 字面量(AGENTS.md §2)', () => {
    for (const css of [CSS, CHIP_CSS]) {
      expect(css).not.toMatch(/#[0-9a-fA-F]{3,8}\b/)
      expect(css).not.toMatch(/\b(?:rgba?|hsla?)\(/)
      expect(css).toContain('var(--et-')
    }
  })
})

describe('中文文案键面', () => {
  it('分区与控件键齐备且为中文', () => {
    for (const key of [
      'section', 'statusTitle', 'policyTitle', 'policyDesc',
      'fieldPortrait', 'fieldPortraitHint', 'fieldDomain', 'fieldDomainHint',
      'fieldPolicy', 'tierExplicitOnly', 'tierExplicitOnlyHint', 'tierAutoReview',
      'tierAutoReviewHint', 'tierFullAuto', 'tierFullAutoHint',
      'fieldDistill', 'distillDisabledHint', 'costNote',
      'save', 'saving', 'saved', 'unchanged', 'saveFailed',
    ] as const) {
      expect(SETTINGS_LOCALES[key], `zh.${key} 缺失`).toBeTruthy()
      expect(SETTINGS_LOCALES[key], `zh.${key} 应为中文`).toMatch(/\p{Script=Han}/u)
    }
  })
})

describe('域 chip 纯逻辑(T12-③)', () => {
  it('domainChipLabel:未识别 / 自动识别 / 人工切换三态', () => {
    expect(domainChipLabel(null, false)).toBe('域:未识别')
    expect(domainChipLabel('deploy', false)).toBe('域:deploy')
    expect(domainChipLabel('deploy', true)).toBe('域:deploy(已切换)')
  })

  it('registeredDomainsOf:候选域(registered=null)不进 chip 列表', () => {
    const domains = [
      { domainKey: 'deploy', label: '部署', registered: 100 },
      { domainKey: 'review', label: '合同审查', registered: null },
    ]
    expect(registeredDomainsOf(domains).map(item => item.domainKey)).toEqual(['deploy'])
  })
})

describe('画像纠正预填桥(T12-② 显式通道交接)', () => {
  /** node 环境无 window:装最小 stub(dispatchEvent 事件路径本测试不依赖;CustomEvent 缺席由 try/catch 兜住)。 */
  function withWindowStub(run: () => void): void {
    const store: Record<string, unknown> = {}
    const previous = (globalThis as { window?: unknown }).window
    ;(globalThis as { window?: unknown }).window = {
      dispatchEvent: (): boolean => true,
      ...store,
    }
    try {
      run()
    } finally {
      if (previous === undefined) delete (globalThis as { window?: unknown }).window
      else (globalThis as { window?: unknown }).window = previous
    }
  }

  it('isMemoryCorrectionPrefill 防御收窄', () => {
    expect(isMemoryCorrectionPrefill({ section: '工作习惯', text: '请记住:纠正 工作习惯:…' })).toBe(true)
    expect(isMemoryCorrectionPrefill({ section: '', text: 'x' })).toBe(false)
    expect(isMemoryCorrectionPrefill({ section: 'a' })).toBe(false)
    expect(isMemoryCorrectionPrefill(null)).toBe(false)
    expect(isMemoryCorrectionPrefill('text')).toBe(false)
  })

  it('写入→读取→清除(消费即焚)', () => {
    withWindowStub(() => {
      setCorrectionPrefill({ section: '风格偏好', text: '请记住:纠正 风格偏好:示例' })
      expect(takeCorrectionPrefill()).toEqual({ section: '风格偏好', text: '请记住:纠正 风格偏好:示例' })
      clearCorrectionPrefill()
      expect(takeCorrectionPrefill()).toBeNull()
    })
  })

  it('桥键与事件名为字面契约(与 @eterna/panel 各自内联,改动须双侧同步)', () => {
    expect(MEMORY_CORRECTION_BRIDGE_KEY).toBe('__eternaMemoryCorrectionPrefill')
    expect(MEMORY_CORRECTION_EVENT).toBe('eterna-memory:correction')
  })
})
