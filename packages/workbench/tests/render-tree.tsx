/**
 * 渲染树测试辅助:仓库无 react-dom(依赖图不可达,panel/memory 客户端测试
 * 头注同款事实)——三视图为受控纯组件(无 hook),直接调用组件函数取
 * ReactElement 树,递归展开为可查询的结构(等价于对 DOM 树的断言:标签/
 * 属性/文案),渲染语义不引入自研渲染器。
 */
import { isValidElement, type ReactNode } from 'react'

export interface RenderedNode {
  readonly tag: string
  readonly attrs: Record<string, string>
  /** 子树文档序全文本(相邻部分以单空格衔接,内部空白折叠)。 */
  readonly text: string
  readonly children: readonly RenderedNode[]
}

const FRAGMENT = Symbol.for('react.fragment')
const SEP = ' '

function attrValue(value: unknown): string | undefined {
  if (typeof value === 'string' || typeof value === 'number') return String(value)
  if (typeof value === 'boolean') return value ? 'true' : 'false'
  return undefined
}

interface Walked {
  parts: string[]
  nodes: RenderedNode[]
}

/** 展开一段 children:字符串与子元素文本按文档序入 parts;元素递归为子节点。
 * 函数组件直接调用取其返回树(受控纯组件,无 hook——react-dom 不可达下的
 * 渲染语义);Fragment 透明展开。 */
function walk(children: ReactNode): Walked {
  const parts: string[] = []
  const nodes: RenderedNode[] = []
  const visit = (child: ReactNode): void => {
    if (child === null || child === undefined || typeof child === 'boolean') return
    if (typeof child === 'string' || typeof child === 'number') {
      parts.push(String(child))
      return
    }
    if (Array.isArray(child)) {
      for (const item of child) visit(item)
      return
    }
    if (!isValidElement(child)) return
    const type = child.type
    if (typeof type === 'function') {
      // 组件节点:调用取返回树,节点本身透明(其 props 非DOM属性,不产出锚点)
      const output = (type as (props: unknown) => ReactNode)(child.props)
      const inner = walk(output)
      parts.push(...inner.parts)
      nodes.push(...inner.nodes)
      return
    }
    if ((type as unknown) === FRAGMENT) {
      const inner = walk(child.props.children)
      parts.push(...inner.parts)
      nodes.push(...inner.nodes)
      return
    }
    const tag = typeof type === 'string' ? type : String(type)
    const attrs: Record<string, string> = {}
    for (const [key, value] of Object.entries(child.props as Record<string, unknown>)) {
      if (key === 'children') continue
      const attr = attrValue(value)
      if (attr !== undefined) attrs[key] = attr
    }
    const inner = walk(child.props.children)
    const text = [...inner.parts, ...inner.nodes.map(node => node.text)]
      .join(SEP)
      .replace(/\s+/g, ' ')
      .trim()
    nodes.push({ tag, attrs, text, children: inner.nodes })
  }
  visit(children)
  return { parts, nodes }
}

/** 渲染一个组件函数(props 直调,无 hook 的受控纯组件)。 */
export function render(component: ReactNode): RenderedNode {
  const result = walk(component)
  if (result.nodes.length === 1) return result.nodes[0]!
  return { tag: '#roots', attrs: {}, text: result.parts.join(SEP).replace(/\s+/g, ' ').trim(), children: result.nodes }
}

export function all(root: RenderedNode, pred: (node: RenderedNode) => boolean): RenderedNode[] {
  const hit: RenderedNode[] = []
  const visit = (node: RenderedNode): void => {
    if (pred(node)) hit.push(node)
    for (const child of node.children) visit(child)
  }
  visit(root)
  return hit
}

/** data-eterna-workbench* 结构锚点查询(panel E2E 严断言同款锚点);value 缺省 = 存在即可。 */
export function byAttr(root: RenderedNode, name: string, value?: string): RenderedNode[] {
  return all(root, node => name in node.attrs && (value === undefined || node.attrs[name] === value))
}

export function find1(root: RenderedNode, name: string, value?: string): RenderedNode {
  const hit = byAttr(root, name, value)
  if (hit.length === 0) {
    const seen = all(root, () => true).map(node => `${node.tag}${node.attrs['data-eterna-workbench'] === undefined ? '' : `[${node.attrs['data-eterna-workbench']}]`}`).join(',')
    throw new Error(`未找到节点 ${name}=${String(value)}(已见:${seen})`)
  }
  return hit[0]!
}

/** 子树全文本(节点.text 已折叠空白)。 */
export function textOf(node: RenderedNode): string {
  return node.text
}

/** 树内全部文本无分隔拼接(用于「不出现」负向断言)。 */
export function rawText(node: RenderedNode): string {
  return node.text.replace(/ /g, '') + node.children.map(rawText).join('')
}
