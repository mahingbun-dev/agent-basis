// DOMSnapshot.captureSnapshot 解析与渲染（纯函数，E1-T3 感知通道）。
// 选型依据：chrome.debugger 下 Accessibility 域整棵子树 ignored（AX 激活不可控），
// DOMSnapshot 不依赖 AX 模式、自带 isClickable 与 backendNodeId——browser-use 同款主感知通道。
// ref = e<backendNodeId>，同一文档内稳定（E5 稳定 ref 的第一层）。
// 字段名以 chrome.debugger 实测为准：parentIndex（无 childIds）、inputValue、nodeType。

export interface CaptureSnapshotResult {
  strings: string[]
  documents: Array<{
    nodes: {
      attributes?: Array<Array<{ name: number; value: number }>>
      backendNodeId?: number[]
      inputChecked?: boolean[]
      inputValue?: number[]
      isClickable?: boolean[]
      nodeName?: number[]
      nodeType?: number[]
      nodeValue?: number[]
      parentIndex?: number[]
      textValue?: number[]
    }
  }>
}

interface ParsedNode {
  /** nodes 数组下标（parentIndex 的语义单位） */
  idx: number
  backendNodeId: number
  tag: string
  value: string
  text: string
  inputValue: string
  nodeType: number
  isClickable: boolean
  checked: boolean
  attrs: Record<string, string>
  parentIdx: number
}

export interface SnapshotLine {
  depth: number
  role: string
  name: string
  ref?: string | undefined
  value?: string | undefined
  url?: string | undefined
  level?: number | undefined
}

export interface RenderedSnapshot {
  text: string
  lines: SnapshotLine[]
  /** ref → CDP backendNodeId（click/fill 依据） */
  refs: Map<string, number>
}

const INTERACTIVE_ROLES = new Set([
  'link', 'button', 'textbox', 'searchbox', 'combobox', 'listbox', 'option',
  'checkbox', 'radio', 'menuitem', 'tab', 'switch', 'slider', 'spinbutton', 'treeitem',
])

/** DOMSnapshot 标量读取：idx=-1/undefined/越界 → '' */
function str(strings: string[], idx: number | undefined): string {
  if (idx === undefined || idx < 0 || idx >= strings.length) return ''
  return strings[idx] ?? ''
}

export function renderDomSnapshot(capture: CaptureSnapshotResult, maxLines = 400): RenderedSnapshot {
  const doc = capture.documents[0]
  const strings = capture.strings
  const lines: SnapshotLine[] = []
  const refs = new Map<string, number>()
  if (doc === undefined) return { text: '', lines, refs }
  const n = doc.nodes
  const ids = n.backendNodeId ?? []
  const parentIdx = n.parentIndex ?? []
  const names = n.nodeName ?? []
  const nodeValues = n.nodeValue ?? []
  const textValues = n.textValue ?? []
  const inputValues = n.inputValue ?? []
  const nodeTypes = n.nodeType ?? []
  const clickables = n.isClickable ?? []
  const checkeds = n.inputChecked ?? []
  const attributes = n.attributes ?? []

  const nodes: ParsedNode[] = []
  const childrenOf = new Map<number, number[]>()
  for (let i = 0; i < ids.length; i++) {
    const attrs: Record<string, string> = {}
    for (const pair of attributes[i] ?? []) {
      attrs[strings[pair.name] ?? ''] = strings[pair.value] ?? ''
    }
    const parent = parentIdx[i] ?? -1
    nodes.push({
      idx: i,
      backendNodeId: ids[i] ?? -1,
      tag: str(strings, names[i]),
      value: str(strings, nodeValues[i]),
      text: str(strings, textValues[i]),
      inputValue: str(strings, inputValues[i]),
      nodeType: nodeTypes[i] ?? 0,
      isClickable: clickables[i] === true,
      checked: checkeds[i] === true,
      attrs,
      parentIdx: parent,
    })
    if (parent >= 0) {
      const list = childrenOf.get(parent) ?? []
      list.push(i)
      childrenOf.set(parent, list)
    }
  }
  const children = (idx: number): number[] => childrenOf.get(idx) ?? []

  /** label[for] → label 文本（表单控件 accname 关联） */
  const labelFor = new Map<string, string>()
  for (const node of nodes) {
    if (node.tag.toLowerCase() !== 'label') continue
    const forId = node.attrs['for'] ?? ''
    if (forId === '') continue
    const text = subtreeText(node).replace(/\s+/g, ' ').trim().slice(0, 120)
    if (text !== '') labelFor.set(forId, text)
  }

  /** 聚合子树文本，用于元素 name */
  function subtreeText(node: ParsedNode): string {
    const tag = node.tag.toLowerCase()
    if (tag === 'script' || tag === 'style' || tag === 'noscript') return ''
    if (node.nodeType === 3) return node.value !== '' ? node.value : node.text
    let out = ''
    for (const c of children(node.idx)) {
      const child = nodes[c]
      if (child !== undefined) out += subtreeText(child)
    }
    return out
  }

  function semanticRole(node: ParsedNode): { role: string; level?: number } {
    const tag = node.tag.toLowerCase()
    const aria = node.attrs['role'] ?? ''
    if (aria !== '') return { role: aria }
    if (tag === 'a') return { role: 'link' }
    if (tag === 'button') return { role: 'button' }
    if (tag === 'textarea') return { role: 'textbox' }
    if (tag === 'select') return { role: 'combobox' }
    if (tag === 'option') return { role: 'option' }
    if (tag === 'input') {
      const type = (node.attrs['type'] ?? 'text').toLowerCase()
      if (type === 'checkbox') return { role: 'checkbox' }
      if (type === 'radio') return { role: 'radio' }
      if (type === 'button' || type === 'submit') return { role: 'button' }
      if (type === 'search') return { role: 'searchbox' }
      return { role: 'textbox' }
    }
    const heading = /^h([1-6])$/.exec(tag)
    if (heading !== null) return { role: 'heading', level: Number(heading[1]) }
    if (tag === 'p') return { role: 'paragraph' }
    if (tag === 'li') return { role: 'listitem' }
    if (tag === 'label') return { role: 'label' }
    return { role: 'generic' }
  }

  /** 透明容器：不输出自身（子树照常渲染） */
  function isTransparent(node: ParsedNode, role: string): boolean {
    const tag = node.tag.toLowerCase()
    if (tag === 'script' || tag === 'style' || tag === 'noscript') return true
    // generic/label 是纯语义包装：文本由具体语义节点（heading/paragraph/textbox…）承载
    if (role === 'generic' || role === 'label') return true
    return ['section', 'nav', 'header', 'footer', 'main', 'form', 'ul', 'ol', 'table', 'tbody', 'tr', 'fieldset'].includes(tag)
  }

  const visited = new Set<number>()
  const maxReached = (): boolean => {
    if (lines.length >= maxLines) {
      if (lines.length === maxLines) lines.push({ depth: 0, role: 'text', name: '[快照超出上限，其余节点已截断]' })
      return true
    }
    return false
  }

  const visit = (idx: number, depth: number): void => {
    if (idx < 0 || idx >= nodes.length) return
    const node = nodes[idx] as ParsedNode
    if (visited.has(idx)) return
    visited.add(idx)
    const preTag = node.tag.toLowerCase()
    if (preTag === 'script' || preTag === 'style' || preTag === 'noscript') return
    if (node.nodeType === 3 || node.tag.startsWith('#')) {
      // 文本节点聚进父元素 name；顶层散文本单独输出
      if (depth === 0 && !maxReached()) {
        const text = (node.value !== '' ? node.value : node.text).trim()
        if (text !== '') lines.push({ depth, role: 'text', name: text })
      }
      for (const c of children(idx)) visit(c, depth)
      return
    }
    const { role, level } = semanticRole(node)
    if (isTransparent(node, role)) {
      for (const c of children(idx)) visit(c, depth)
      return
    }
    if (maxReached()) return
    let name = node.attrs['aria-label'] ?? ''
    if (name === '') name = subtreeText(node).replace(/\s+/g, ' ').trim().slice(0, 120)
    if (name === '') {
      // 表单控件 accname：① 上溯祖先 label ② label[for=id] 关联
      let cursor = node.parentIdx
      for (let hop = 0; hop < 6 && cursor >= 0 && cursor < nodes.length; hop++) {
        const ancestor = nodes[cursor] as ParsedNode
        if (ancestor.tag.toLowerCase() === 'label') {
          name = subtreeText(ancestor).replace(/\s+/g, ' ').trim().slice(0, 120)
          break
        }
        cursor = ancestor.parentIdx
      }
    }
    if (name === '') {
      const idAttr = node.attrs['id'] ?? ''
      if (idAttr !== '') name = labelFor.get(idAttr) ?? ''
    }
    if (name === '') name = node.attrs['placeholder'] ?? ''
    const interactive = node.isClickable || INTERACTIVE_ROLES.has(role)
    let ref: string | undefined
    if (interactive && node.backendNodeId > 0) {
      ref = `e${String(node.backendNodeId)}`
      refs.set(ref, node.backendNodeId)
    }
    const isEditable = role === 'textbox' || role === 'searchbox'
    const value = isEditable ? (node.inputValue !== '' ? node.inputValue : node.attrs['value'] ?? '') : ''
    const checked = node.checked
    const url = role === 'link' ? (node.attrs['href'] ?? '') : ''
    const statePart = checked ? ' [checked]' : ''
    lines.push({ depth, role, name: (statePart !== '' ? '✓ ' : '') + name, ref, value, url, level })
    for (const c of children(idx)) visit(c, depth + 1)
  }

  const renderLine = (l: SnapshotLine): string => {
    const indent = '  '.repeat(l.depth)
    const namePart = l.name !== '' ? ` "${l.name}"` : ''
    const refPart = l.ref !== undefined ? ` [ref=${l.ref}]` : ''
    const valuePart = l.value !== undefined && l.value !== '' ? ` (${l.value})` : ''
    const levelPart = l.level !== undefined ? ` [level=${String(l.level)}]` : ''
    const urlPart = l.url !== undefined && l.url !== '' ? ` url=${l.url}` : ''
    return `${indent}- ${l.role}${namePart}${refPart}${valuePart}${levelPart}${urlPart}`
  }

  // roots = 无父或父越界的节点（parentIndex 是 nodes 数组下标）
  for (let i = 0; i < nodes.length; i++) {
    const parent = nodes[i] as ParsedNode
    if (parent.parentIdx === -1 || parent.parentIdx >= nodes.length) visit(i, 0)
  }
  // 兜底：parentIndex 缺失导致的孤立子树
  for (let i = 0; i < nodes.length; i++) {
    if (!visited.has(i)) visit(i, 0)
  }
  return { text: lines.map(renderLine).join('\n'), lines, refs }
}
