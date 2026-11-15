/**
 * 画像纠正预填桥与文案键面单测(M-M3 T12-②;组件渲染需 react-dom,由 dsh web
 * 壳运行时提供——这里钉纯逻辑面):
 * - correction-bridge:字面契约与 @eterna/memory 半边一致(memory 包
 *   client-settings.spec 钉同一字面值;双侧内联契约);写入语义与文案模板;
 * - locales:新增画像卡/域浏览键 zh/en 双语齐备。
 */
import { describe, expect, it, afterEach } from 'vitest'
import {
  correctionPrefillText, MEMORY_CORRECTION_BRIDGE_KEY, MEMORY_CORRECTION_EVENT, setCorrectionPrefill,
} from '../src/client/correction-bridge.ts'
import { en, zh } from '../src/client/locales.ts'

describe('画像纠正预填桥(T12-② 显式通道交接)', () => {
  const previousWindow = (globalThis as { window?: unknown }).window

  afterEach(() => {
    if (previousWindow === undefined) delete (globalThis as { window?: unknown }).window
    else (globalThis as { window?: unknown }).window = previousWindow
  })

  it('写入待预填(window 桥;面板为写入半边,消费在 memory 域 chip)', () => {
    const stub: Record<string, unknown> = { dispatchEvent: (): boolean => true }
    ;(globalThis as { window?: unknown }).window = stub
    setCorrectionPrefill({ section: '工作习惯', text: correctionPrefillText('工作习惯') })
    expect(stub[MEMORY_CORRECTION_BRIDGE_KEY]).toEqual({
      section: '工作习惯',
      text: '请记住:纠正 工作习惯:',
    })
  })

  it('预填文案模板 = 19 号 §5-T12.2 原文口径', () => {
    expect(correctionPrefillText('风格偏好')).toBe('请记住:纠正 风格偏好:')
  })

  it('桥键与事件名为字面契约(与 @eterna/memory 半边一致,改动须双侧同步)', () => {
    expect(MEMORY_CORRECTION_BRIDGE_KEY).toBe('__eternaMemoryCorrectionPrefill')
    expect(MEMORY_CORRECTION_EVENT).toBe('eterna-memory:correction')
  })
})

describe('画像卡/域浏览文案键面(M-M3 T12-②)', () => {
  const newKeys = [
    'memory.portraitTitle', 'memory.portraitHint', 'memory.portraitEmpty', 'memory.portraitCorrect',
    'memory.portraitCorrectReady', 'memory.domainTitle', 'memory.domainUnit', 'memory.domainEmpty',
    'memory.domainCandidate', 'memory.domainMemories', 'memory.domainSessions', 'memory.domainLastUsed',
    'memory.domainPending',
  ] as const

  it('zh 新键齐备且为中文', () => {
    for (const key of newKeys) {
      expect(zh[key], `zh.${key} 缺失`).toBeTruthy()
      expect(zh[key], `zh.${key} 应为中文`).toMatch(/\p{Script=Han}/u)
    }
  })

  it('en 新键齐备(英文界面可用)', () => {
    for (const key of newKeys) {
      expect(en[key], `en.${key} 缺失`).toBeTruthy()
    }
  })

  it('占位符与组件插值对齐({count}/{value}/{section})', () => {
    expect(zh['memory.domainMemories']).toContain('{count}')
    expect(zh['memory.domainSessions']).toContain('{count}')
    expect(zh['memory.domainLastUsed']).toContain('{value}')
    expect(zh['memory.domainPending']).toContain('{count}')
    expect(zh['memory.portraitCorrectReady']).toContain('{section}')
  })
})

describe('T9 审批队列 C10 徽标/折叠文案键(M-C3,22 号 §5-C10)', () => {
  const c10Keys = [
    'memory.pendingCompaction',
    'memory.pendingExpand',
    'memory.pendingCollapse',
  ] as const

  it('zh 新键齐备且「来自压缩摘要」徽标为中文', () => {
    for (const key of c10Keys) {
      expect(zh[key], `zh.${key} 缺失`).toBeTruthy()
    }
    expect(zh['memory.pendingCompaction']).toBe('来自压缩摘要')
    expect(zh['memory.pendingCompaction']).toMatch(/\p{Script=Han}/u)
  })

  it('en 新键齐备(英文界面可用)', () => {
    for (const key of c10Keys) {
      expect(en[key], `en.${key} 缺失`).toBeTruthy()
    }
    expect(en['memory.pendingCompaction']).toBe('From compaction summary')
  })
})
