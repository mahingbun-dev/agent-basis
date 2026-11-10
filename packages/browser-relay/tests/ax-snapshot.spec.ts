import { describe, expect, it } from 'vitest'
import { parseRef, renderAxTree, type AxNode } from '../src/ax-snapshot.ts'

function fixtureNodes(): AxNode[] {
  return [
    { nodeId: '1', role: { value: 'RootWebArea' }, name: { value: 'E1 Fixture 工作台' }, childIds: ['2', '3', '4', '5', '6', '7'], backendDOMNodeId: 10 },
    { nodeId: '2', role: { value: 'heading' }, name: { value: 'E1 Fixture 工作台' }, childIds: [], backendDOMNodeId: 11 },
    { nodeId: '3', role: { value: 'paragraph' }, name: { value: '这是一个用于 E1 门禁冒烟的本地受控页面' }, childIds: [], backendDOMNodeId: 12 },
    { nodeId: '4', role: { value: 'textbox' }, name: { value: '搜索关键词' }, value: { value: '' }, childIds: [], backendDOMNodeId: 13 },
    { nodeId: '5', role: { value: 'button' }, name: { value: '提交' }, childIds: [], backendDOMNodeId: 14 },
    { nodeId: '6', role: { value: 'link' }, name: { value: '直接访问' }, childIds: [], backendDOMNodeId: 15, attributes: [{ name: 'url', value: 'http://127.0.0.1:9310/fixture/result?text=直接访问' }] },
    { nodeId: '7', role: { value: 'Ignored' }, name: { value: '隐藏节点' }, childIds: [], backendDOMNodeId: 16 },
  ]
}

describe('renderAxTree（E1-T3 感知）', () => {
  it('交互节点获得 e<backendNodeId> ref', () => {
    const r = renderAxTree(fixtureNodes())
    expect(r.refs.get('e13')).toBe(13)
    expect(r.refs.get('e14')).toBe(14)
    expect(r.refs.get('e15')).toBe(15)
    // 非交互节点（heading/paragraph）不得获得 ref
    expect(r.refs.has('e11')).toBe(false)
    expect(r.refs.has('e12')).toBe(false)
  })

  it('文本为缩进树且含 role/name/ref/value/url', () => {
    const r = renderAxTree(fixtureNodes())
    expect(r.text).toContain('- heading "E1 Fixture 工作台"')
    expect(r.text).toContain('  - textbox "搜索关键词" [ref=e13]')
    expect(r.text).toContain('[ref=e14]')
    expect(r.text).toContain('url=http://127.0.0.1:9310/fixture/result?text=直接访问')
  })

  it('Ignored 节点被跳过', () => {
    const r = renderAxTree(fixtureNodes())
    expect(r.text).not.toContain('隐藏节点')
    expect(r.refs.has('e16')).toBe(false)
  })

  it('超 maxLines 截断并留提示', () => {
    const many: AxNode[] = [
      { nodeId: 'root', role: { value: 'RootWebArea' }, name: { value: 'x' }, childIds: Array.from({ length: 30 }, (_, i) => `n${String(i)}`), backendDOMNodeId: 1 },
      ...Array.from({ length: 30 }, (_, i): AxNode => ({ nodeId: `n${String(i)}`, role: { value: 'paragraph' }, name: { value: `p${String(i)}` }, childIds: [], backendDOMNodeId: 100 + i })),
    ]
    const r = renderAxTree(many, 10)
    expect(r.lines.length).toBe(11)
    expect(r.lines[10]?.name).toBe('[快照超出上限，其余节点已截断]')
    expect(r.text).toContain('[快照超出上限')
  })
})

describe('parseRef', () => {
  const refs = new Map([['e13', 13]])
  it('合法 ref 解析为 backendNodeId', () => {
    expect(parseRef('e13', refs)).toEqual({ backendNodeId: 13 })
  })
  it('格式非法报 INVALID_REF 语义错误', () => {
    expect('error' in parseRef('button', refs)).toBe(true)
  })
  it('不在最近快照中报 stale 提示', () => {
    const r = parseRef('e99', refs)
    expect('error' in r).toBe(true)
    if ('error' in r) expect(r.error).toContain('重新 snapshot')
  })
})
