/**
 * 「主会话」显式入口测试(2026-11-19):空主会话在侧栏只以工作区「新会话」
 * 占位行出现;工作台顶部给一个稳定入口,id 由 live 快照 masterSessionId
 * 供给。断言:缺 id / 缺导航面不渲染(无死按钮)、锚点带 id、点击即导航。
 */
import { describe, expect, it } from 'vitest'
import { MasterLink } from '../src/client/WorkbenchPage.tsx'
import { zh } from '../src/client/locales.ts'
import { find1, render, textOf } from './render-tree.tsx'

const t = (key: string): string => zh[key as keyof typeof zh] ?? key

describe('工作台「主会话」入口', () => {
  it('sessionId / onOpen 任一缺席不渲染(未引导装配与裸宿主没有死按钮)', () => {
    expect(MasterLink({ sessionId: undefined, onOpen: () => {}, t })).toBeNull()
    expect(MasterLink({ sessionId: 'orchestrator-Mr.Ma', onOpen: undefined, t })).toBeNull()
  })

  it('渲染:文案「主会话」+ 锚点携带主会话 id', () => {
    const tree = render(<MasterLink sessionId="orchestrator-Mr.Ma" onOpen={() => {}} t={t} />)
    const button = find1(tree, 'data-eterna-workbench', 'open-master')
    expect(button.attrs['data-eterna-workbench-master']).toBe('orchestrator-Mr.Ma')
    expect(textOf(button)).toBe('主会话')
  })

  it('点击 = onOpen(主会话 id)(render-tree 不保留函数属性,直接驱动组件产物)', () => {
    const opened: string[] = []
    const element = MasterLink({
      sessionId: 'orchestrator-Mr.Ma',
      onOpen: (sessionId) => { opened.push(sessionId) },
      t,
    })
    ;(element!.props as { onClick: () => void }).onClick()
    expect(opened).toEqual(['orchestrator-Mr.Ma'])
  })
})