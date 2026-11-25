/**
 * 决策层叠层契约测试（v4 §7a.2，45 号 P2）。
 *
 * 背景：审批卡与提问卡此前都挂 `document.body` + `fixed top:16px` + `z-index:10000`，
 * 两张卡同屏必然重叠，且会压住宿主原生 toast（`top:40px / z-index:1100`）。
 * 现在改为在 `conversation.input.overlay` 席位内渲染——该席位落在宿主输入卡顶边的
 * 零高度锚点（`.overlayAnchor`）内，位置规则由布局决定，不靠视觉调参。
 *
 * 这些断言是"改造不许回退"的护栏：谁再把卡片挂回 body 或加回 fixed top，测试就红。
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const here = dirname(fileURLToPath(import.meta.url))
const read = (relative: string): string => readFileSync(join(here, '..', relative), 'utf8')

const approvalCard = read('src/client/approval-card.tsx')
const questionCard = read('src/client/question-card.tsx')
const indexSource = read('src/client/index.tsx')
const styles = read('src/client/styles.ts')

describe('决策层挂载位置', () => {
  it('两张卡都注册进 conversation.input.overlay（输入卡顶边锚点席位）', () => {
    expect(indexSource).toContain("ctx.slots.inject('conversation.input.overlay'")
    expect(indexSource).toContain('DecisionLayerSlot')
  })

  it('审批卡/提问卡不再自挂 document.body', () => {
    for (const [name, source] of [['approval-card', approvalCard], ['question-card', questionCard]] as const) {
      expect(source, `${name} 仍在 append 到 body，会脱离输入卡锚点`)
        .not.toMatch(/document\.body\.appendChild/u)
      expect(source, `${name} 仍用 install*(createRoot) 命令式挂载`).not.toContain('createRoot')
    }
  })

  it('卡片外壳改用共享决策卡类（.et-decision-card）', () => {
    expect(approvalCard).toContain("className='et-decision-card'")
    expect(questionCard).toContain("className='et-decision-card'")
    expect(approvalCard).toContain("data-kind='approval'")
    expect(questionCard).toContain("data-kind='question'")
  })

  it('倒计时是贴卡片顶边的 2px 条，不是独立一行', () => {
    expect(approvalCard).toContain('et-decision-track')
    expect(questionCard).toContain('et-decision-track')
  })

  it('卡片作用域=会话：按 sessionId 过滤', () => {
    expect(approvalCard).toContain('item.sessionId === props.sessionId')
    expect(questionCard).toContain('item.sessionId === props.sessionId')
  })
})

describe('提问卡 v2：题多可滚，不许顶穿视口', () => {
  it('卡片有固定头部 / 滚动题区 / 固定底部三段', () => {
    expect(questionCard).toContain("className='eq-head'")
    expect(questionCard).toContain("className='eq-body-wrap'")
    expect(questionCard).toContain("className='eq-body'")
    expect(questionCard).toContain("className='eq-foot'")
  })

  it('题区是唯一滚动轴（overflow-y:auto），外框不滚', () => {
    const start = styles.indexOf('.eq-body {')
    expect(start, '找不到 .eq-body 规则').toBeGreaterThan(-1)
    const rule = styles.slice(start, styles.indexOf('}', start))
    expect(rule, '题区缺 overflow-y:auto 就回退到「题多不可见」').toContain('overflow-y: auto')
    const wrapStart = styles.indexOf('.eq-body-wrap {')
    expect(wrapStart).toBeGreaterThan(-1)
    const wrapRule = styles.slice(wrapStart, styles.indexOf('}', wrapStart))
    expect(wrapRule).not.toContain('overflow')
  })

  it('多题时明示已答进度（已答 K/N），不靠用户猜还有几题没答', () => {
    expect(questionCard).toContain('已答 ')
  })

  it('一次只呈当前题，页脚用 ‹ 第 n/N 题 › 左右切换', () => {
    expect(questionCard).toContain('props.item.questions[index]')
    expect(questionCard.match(/<QuestionField/gu)?.length, '题区只能挂一个 QuestionField').toBe(1)
    expect(questionCard).toContain("aria-label='上一题'")
    expect(questionCard).toContain("aria-label='下一题'")
    expect(questionCard).toContain('第 ')
    expect(questionCard).toContain('题')
  })
})

describe('层级与旧样式清理', () => {
  it('样式表里不再有 fixed top:16px 的决策卡叠层', () => {
    // 旧形态：.eap-overlay / .eq-overlay { position: fixed; inset-block-start: 16px; z-index: 10000 }
    expect(styles).not.toContain('.eap-overlay')
    expect(styles).not.toContain('.eq-overlay')
    expect(styles).not.toMatch(/z-index:\s*10000/u)
  })

  it('z-index 收敛到层级表（锚定弹层 100 / 决策层 200 / 模态 1000）', () => {
    const values = [...styles.matchAll(/z-index:\s*([0-9]+)/gu)].map(m => Number(m[1]))
    const allowed = new Set([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 20, 30, 40, 100, 1000, 1100, 1500])
    expect(values.filter(v => !allowed.has(v))).toEqual([])
  })

  it('账户菜单不再用 2147483000 压过一切', () => {
    expect(styles).not.toContain('2147483000')
  })

  it('模型菜单不再是 1300（锚定弹层应为 100）', () => {
    expect(read('src/client/model-menu.tsx')).not.toMatch(/zIndex:\s*1300/u)
  })
})

describe('字重与语义色', () => {
  it('样式表不出现规范外字重（只允许 400/500/600）', () => {
    const weights = [...styles.matchAll(/font-weight:\s*([0-9]{3})/gu)].map(m => Number(m[1]))
    expect(weights.filter(w => ![400, 500, 600].includes(w))).toEqual([])
  })

  it('决策卡语义色只用边框（审批 warn / 提问 accent），不做整片底色', () => {
    // 类定义在 @eterna/ui 的 COMPONENT_CSS 里；这里守调用方不另加背景
    expect(approvalCard).not.toMatch(/background:\s*var\(--et-warn\)/u)
    expect(questionCard).not.toMatch(/background:\s*var\(--et-accent\)/u)
  })
})
