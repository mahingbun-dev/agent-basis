/**
 * 主会话提示词纪律的契约单测(P8)。
 *
 * 这里钉的是**产品承诺**,不是实现细节:
 *
 * 1. **三条纪律都在**:参谋是私人旁注 / 不得主动寻址 / 不得等待其输入。
 *    计划书 R1 的唯一缓解手段就是这三句——少任何一句，主会话都可能做出
 *    破坏体验的行为（主动去「问参谋」、或者等参谋回复而卡住）。
 * 2. **插值已关**:正文里将来若出现花括号，不会被当成 `{{variable}}` 替换。
 * 3. **序位钉在 tasks 之后**:`[active-tickets]`(9050) 与本段(9060) 同属
 *    「当前有哪些旁路对象」；偏离会在装配顺序里悄悄改变语义权重。
 * 4. **注册进提示词注册表**:prompt-scan 的 P3 面强制（未登记的
 *    `systemPrompt.section` 使用会被 CI 拦下）。
 */
import { describe, expect, it } from 'vitest'
import {
  ADVISER_DISCIPLINE_TEXT,
  ADVISER_SECTION_NAME,
  ADVISER_SECTION_ORDER,
  createAdviserSection,
} from '../src/section.ts'

describe('主会话纪律正文', () => {
  it('声明参谋是用户的私人旁注(定性质,不是团队工具)', () => {
    expect(ADVISER_DISCIPLINE_TEXT).toContain('私人旁注')
  })

  it('禁止主会话主动寻址参谋(spawn 出的参谋恒在 catalog 里,只能靠纪律约束)', () => {
    expect(ADVISER_DISCIPLINE_TEXT).toContain('不要主动给参谋发消息')
    expect(ADVISER_DISCIPLINE_TEXT).toContain('不要尝试创建、关闭或重命名参谋')
  })

  it('禁止等待参谋输入(它不参与主会话的回合,等待即卡死)', () => {
    expect(ADVISER_DISCIPLINE_TEXT).toContain('不要等待它返回结果')
    expect(ADVISER_DISCIPLINE_TEXT).toContain('不会参与你的回合')
  })

  it('说明用户可能把结论贴进来(给出正确处理方式,不只列禁止)', () => {
    expect(ADVISER_DISCIPLINE_TEXT).toContain('补充说明')
  })

  it('段首带 [adviser] 标记(便于排查装配产物)', () => {
    expect(ADVISER_DISCIPLINE_TEXT.startsWith('[adviser]')).toBe(true)
  })
})

describe('section 装配契约', () => {
  it('名字与注册表条目一致(dsh PromptSection.name 全局唯一)', () => {
    expect(ADVISER_SECTION_NAME).toBe('eterna-adviser:discipline')
    expect(createAdviserSection().name).toBe(ADVISER_SECTION_NAME)
  })

  it('序位紧跟 tasks 的 [active-tickets](9050),同属「当前旁路对象」段位', () => {
    expect(ADVISER_SECTION_ORDER).toBe(9060)
    expect(createAdviserSection().order).toBe(ADVISER_SECTION_ORDER)
  })

  it('显式关闭插值(fail-closed:正文里出现花括号也不被当变量)', () => {
    expect(createAdviserSection().interpolate).toBe(false)
  })

  it('文本是静态串(每次装配同一份,无运行时状态)', () => {
    const first = createAdviserSection().text
    const second = createAdviserSection().text
    expect(first).toBe(ADVISER_DISCIPLINE_TEXT)
    expect(first).toBe(second)
  })
})

describe('提示词注册表登记(prompt-scan P3 面)', () => {
  it('条目 runtime.adviser.discipline 已登记且 anchors 指本节文件', async () => {
    const { PROMPT_REGISTRY_ENTRIES } = await import('../../prompt-studio/src/registry.ts')
    const entry = PROMPT_REGISTRY_ENTRIES.find(item => item.id === 'runtime.adviser.discipline')
    expect(entry, '缺少 runtime.adviser.discipline 登记(prompt-scan 会拦下)').toBeDefined()
    expect(entry?.source).toBe('@eterna/adviser')
    expect(entry?.layer).toBe('runtime')
    const files = entry?.anchors.map(anchor => anchor.file) ?? []
    expect(files).toContain('packages/adviser/src/section.ts')
    expect(files).toContain('packages/adviser/src/index.ts')
  })
})
