// a11y 快照渲染（纯函数，E1-T3 感知最小版）：
// Accessibility.getFullAXTree 节点 → ego/BrowserOS 风格缩进文本（交互节点带 [ref=eN]）。
// ref 直接绑定 CDP backendDOMNodeId——同一文档内稳定，无需快照间注册表（E5 稳定 ref 的第一层）。

export interface AxNode {
  nodeId: string
  ignored?: boolean
  role?: { value: string }
  name?: { value: string | number }
  value?: { value: string | number }
  childIds?: string[]
  backendDOMNodeId?: number
  attributes?: Array<{ name: string; value: string | number }>
}

/** 交互角色集合（可被 ref 化并执行 Input 动作） */
const INTERACTIVE_ROLES = new Set([
  'link', 'button', 'textbox', 'searchbox', 'combobox', 'listbox', 'option',
  'checkbox', 'radio', 'menuitem', 'menuitemcheckbox', 'menuitemradio',
  'tab', 'switch', 'slider', 'spinbutton', 'treeitem',
])

/** 可输入文本的交互角色 */
const EDITABLE_ROLES = new Set(['textbox', 'searchbox', 'combobox', 'spinbutton'])

export interface SnapshotLine {
  depth: number
  role: string
  name: string
  ref?: string | undefined
  value?: string | undefined
  url?: string | undefined
  refBackendNodeId?: number | undefined
}

export interface RenderedSnapshot {
  text: string
  lines: SnapshotLine[]
  /** ref → CDP backendDOMNodeId（click/fill 依据） */
  refs: Map<string, number>
}

export function renderAxTree(nodes: AxNode[], maxLines = 400): RenderedSnapshot {
  const byId = new Map<string, AxNode>()
  const childIdsOf = new Set<string>()
  for (const n of nodes) {
    byId.set(n.nodeId, n)
    for (const c of n.childIds ?? []) childIdsOf.add(c)
  }
  const roots = nodes.filter((n2) => { return !childIdsOf.has(n2.nodeId) })
  const lines: SnapshotLine[] = []
  const refs = new Map<string, number>()

  const visit = (node: AxNode, depth: number): void => {
    if (lines.length >= maxLines) {
      if (lines.length === maxLines) lines.push({ depth: 0, role: 'text', name: '[快照超出上限，其余节点已截断]' })
      return
    }
    if (node.ignored === true) return
    const role = node.role?.value ?? ''
    if (role === 'Ignored') return
    if (role === 'none' || role === '') {
      // 透明包装节点（chrome 用 none 表无语义 div）：不输出自身，但子树照常渲染
      for (const childId of node.childIds ?? []) {
        const child = byId.get(childId)
        if (child !== undefined) visit(child, depth)
      }
      return
    }
    const name = node.name?.value === undefined ? '' : String(node.name.value)
    const isInteractive = INTERACTIVE_ROLES.has(role)
    let ref: string | undefined
    if (isInteractive && node.backendDOMNodeId !== undefined) {
      ref = `e${String(node.backendDOMNodeId)}`
      refs.set(ref, node.backendDOMNodeId)
    }
    const value = EDITABLE_ROLES.has(role) && node.value?.value !== undefined && `${node.value.value}` !== ''
      ? `${node.value.value}`
      : undefined
    let url: string | undefined
    if (role === 'link') {
      for (const attr of node.attributes ?? []) {
        if (attr.name === 'url') url = `${attr.value}`
      }
    }
    lines.push({ depth, role, name, ref, value, url, refBackendNodeId: ref !== undefined ? node.backendDOMNodeId : undefined })
    for (const childId of node.childIds ?? []) {
      const child = byId.get(childId)
      if (child !== undefined) visit(child, depth + 1)
    }
  }

  for (const root of roots) visit(root, 0)

  const text = lines
    .map((l) => {
      const indent = '  '.repeat(l.depth)
      const namePart = l.name !== '' ? ` "${l.name}"` : ''
      const refPart = l.ref !== undefined ? ` [ref=${l.ref}]` : ''
      const valuePart = l.value !== undefined ? ` (${l.value})` : ''
      const urlPart = l.url !== undefined ? ` url=${l.url}` : ''
      return `${indent}- ${l.role}${namePart}${refPart}${valuePart}${urlPart}`
    })
    .join('\n')
  return { text, lines, refs }
}

/** 解析 ref → backendDOMNodeId（不合法格式即 INVALID_REF） */
export function parseRef(ref: string, refs: Map<string, number>): { backendNodeId: number } | { error: string } {
  if (!/^e\d+$/.test(ref)) return { error: `ref 格式非法：${ref}（应为 e<数字>，来自最近一次 snapshot）` }
  const backendNodeId = refs.get(ref)
  if (backendNodeId === undefined) return { error: `ref ${ref} 不在最近一次快照中（页面已变化请重新 snapshot；stale ref 禁止重试）` }
  return { backendNodeId }
}
