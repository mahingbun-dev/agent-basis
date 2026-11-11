/**
 * P1-T5(2026-11-11):目录树工作区选择器——双洞 slot(sidebar.workspaces /
 * conversation.hero.workspace 的 directoryFlow)同构注册。
 *
 * 契约(ui-workspace slots.d.ts:69-80 实核):{kind:'single',scope:'root'} 五字段
 * {open,busy,onPicked,onCancel,onError};无壳(Modal 自渲);initialPath=listDirectory
 * (undefined)=守卫钳制的用户根。无路径输入框(树即边界——上游 browse 有可键入路径
 * 编辑区,本组件刻意省略,守卫双兜底)。
 * 数据面:ctx.uiWorkspace.listDirectory/createDirectory → /api/directoryPicker/*
 * (T1 守卫钳根)。上游 browse 客户端由 patch 禁 auto 行+insert host-browse(仅路由)
 * 裁掉,slot 单洞无竞争。
 */
import { useEffect, useState } from 'react'

export interface DirectoryEntry {
  readonly name: string
  readonly path: string
  readonly kind?: string
}

export interface DirectoryListing {
  readonly path: string
  readonly crumbs?: readonly string[]
  readonly entries?: readonly DirectoryEntry[]
  readonly truncated?: boolean
}

export interface DirectoryTreeProps {
  readonly open: boolean
  readonly busy: boolean
  readonly onPicked: (path: string) => void
  readonly onCancel: () => void
  readonly onError?: (message: string) => void
  readonly listDirectory: (path: string | undefined, signal?: AbortSignal) => Promise<DirectoryListing>
  readonly createDirectory: (path: string, name: string) => Promise<string>
}

interface TreeState {
  readonly listing: DirectoryListing | null
  readonly expanded: ReadonlySet<string>
  readonly children: Readonly<Record<string, readonly DirectoryListing[]>>
  readonly selected: string | null
  readonly creating: boolean
  readonly newFolderName: string
  readonly error: string | null
}

const styles: Record<string, React.CSSProperties> = {
  overlay: {
    position: 'fixed', inset: 0, zIndex: 1000,
    background: 'var(--dsw-alias-bg-mask-1, rgba(0,0,0,0.5))',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
  },
  dialog: {
    width: 'min(480px, calc(100vw - 32px))', maxHeight: 'min(560px, calc(100vh - 64px))',
    display: 'flex', flexDirection: 'column',
    background: 'var(--et-surface)',
    color: 'var(--et-fg)',
    fontFamily: 'var(--et-font-body)',
    borderRadius: 'var(--et-radius-lg)', border: '1px solid var(--et-border)',
    boxShadow: 'var(--et-shadow-raised)',
    overflow: 'hidden',
  },
  header: { padding: '18px 20px 8px', fontSize: 16, fontWeight: 600, lineHeight: 1.4 },
  body: { flex: 1, overflowY: 'auto', padding: '4px 10px', minHeight: 200 },
  row: {
    display: 'flex', alignItems: 'center', gap: 6, width: '100%',
    padding: '8px 8px', border: 'none', background: 'transparent',
    color: 'inherit', textAlign: 'left', cursor: 'pointer', borderRadius: 'var(--et-radius-sm)',
    fontSize: 14, lineHeight: 1.5,
  },
  rowSelected: {
    background: 'var(--et-surface-2)',
  },
  caret: { width: 14, flexShrink: 0, opacity: 0.55 },
  folderIcon: { flexShrink: 0, opacity: 0.8, display: 'inline-flex' },
  footer: { padding: '12px 20px 20px', display: 'flex', flexDirection: 'column', gap: 12 },
  newFolderRow: { display: 'flex', gap: 8 },
  input: {
    flex: 1, padding: '10px 12px', fontSize: 14,
    background: 'var(--et-bg)',
    border: '1px solid var(--et-border)', borderRadius: 'var(--et-radius-sm)', color: 'inherit',
    outline: 'none',
  },
  buttonRow: { display: 'flex', justifyContent: 'flex-end', gap: 8 },
  button: {
    padding: '10px 14px', fontSize: 14, borderRadius: 'var(--et-radius-sm)', cursor: 'pointer',
    border: '1px solid var(--et-border)',
    background: 'transparent', color: 'inherit',
  },
  primary: {
    background: 'var(--et-accent)',
    borderColor: 'transparent', color: 'var(--et-accent-on)',
  },
  error: { color: 'var(--et-danger)', fontSize: 13, lineHeight: 1.5 },
  empty: { padding: '24px 16px', textAlign: 'center', opacity: 0.6, fontSize: 14 },
}

/** 文件夹线性图标(不使用 emoji 作为功能图标)。 */
function FolderIcon(): React.JSX.Element {
  return (
    <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7Z" />
    </svg>
  )
}

/** 单层目录行(懒展开:展开时拉取子层)。 */
function TreeRow(props: {
  entry: DirectoryEntry
  depth: number
  state: TreeState
  onToggle: (entry: DirectoryEntry) => void
  onSelect: (entry: DirectoryEntry) => void
}) {
  const { entry, depth, state, onToggle, onSelect } = props
  const expanded = state.expanded.has(entry.path)
  const selected = state.selected === entry.path
  const childList = state.children[entry.path]
  return <>
    <button
      type="button"
      style={{ ...styles.row, ...(selected ? styles.rowSelected : {}), paddingLeft: 8 + depth * 18 }}
      onClick={() => { onSelect(entry); if (!expanded) onToggle(entry) }}
      data-eterna-tree-row={entry.path}
    >
      <span style={styles.caret}>{expanded ? '▾' : '▸'}</span>
      <span style={styles.folderIcon}><FolderIcon /></span>
      <span>{entry.name}</span>
    </button>
    {expanded && (childList !== undefined
      ? childList[0]?.entries?.map(child => (
        <TreeRow key={child.path} entry={child} depth={depth + 1} state={state} onToggle={onToggle} onSelect={onSelect} />
      ))
      : null)}
  </>
}

export function DirectoryTreeFlow(props: DirectoryTreeProps): React.JSX.Element | null {
  const { open, busy, onPicked, onCancel, onError, listDirectory, createDirectory } = props
  const [state, setState] = useState<TreeState>({
    listing: null, expanded: new Set(), children: {}, selected: null,
    creating: false, newFolderName: '', error: null,
  })
  // open 置位时拉根层(守卫钳制的用户根)。副作用入 useEffect——render-phase setState
  // 在 StrictMode 双渲染下会双拉,且属 React 反模式(2026-11-11 E2E 卫生项)。
  useEffect(() => {
    if (!open || state.listing !== null || state.creating) return
    setState(s => ({ ...s, creating: true }))
    listDirectory(undefined).then(listing => {
      setState(s => ({ ...s, listing, creating: false, error: null }))
    }).catch((e: unknown) => {
      const message = e instanceof Error ? e.message : String(e)
      setState(s => ({ ...s, creating: false, error: message }))
      onError?.(message)
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps -- listing/creating 变化由守卫条件短路
  }, [open, state.listing, state.creating])
  if (!open) return null
  const rootEntries = state.listing?.entries ?? []
  const toggle = (entry: DirectoryEntry): void => {
    setState(s => {
      if (s.expanded.has(entry.path)) {
        const next = new Set(s.expanded); next.delete(entry.path)
        return { ...s, expanded: next }
      }
      const next = new Set(s.expanded); next.add(entry.path)
      if (s.children[entry.path] !== undefined) return { ...s, expanded: next }
      listDirectory(entry.path).then(listing => {
        setState(cur => ({ ...cur, children: { ...cur.children, [entry.path]: [listing] } }))
      }).catch((e: unknown) => {
        const message = e instanceof Error ? e.message : String(e)
        setState(cur => ({ ...cur, error: message }))
        onError?.(message)
      })
      return { ...s, expanded: next }
    })
  }
  const submitNewFolder = (): void => {
    const name = state.newFolderName.trim()
    // 单段名守卫(含 / 或 .. 拒——服务端守卫双兜底)
    if (name === '' || name.includes('/') || name === '.' || name === '..') {
      setState(s => ({ ...s, error: '文件夹名需为单个名称(不含 / 与 ..)' }))
      return
    }
    const parent = state.selected ?? state.listing?.path
    if (parent === null || parent === undefined) return
    createDirectory(parent, name).then(created => {
      setState(s => ({ ...s, newFolderName: '', error: null }))
      // 刷新父层:根层写回 listing(根渲染读 listing.entries),子层写 children 缓存
      listDirectory(parent).then(listing => {
        setState(cur => {
          if (cur.listing?.path === parent) return { ...cur, listing }
          return { ...cur, children: { ...cur.children, [parent]: [listing] } }
        })
        void created
      }).catch(() => {})
    }).catch((e: unknown) => {
      const message = e instanceof Error ? e.message : String(e)
      setState(s => ({ ...s, error: message }))
      onError?.(message)
    })
  }
  return (
    <div style={styles.overlay} role="dialog" aria-modal="true" aria-label="选择工作区目录">
      <div style={styles.dialog}>
        <div style={styles.header}>选择工作区目录</div>
        <div style={styles.body} data-eterna-directory-tree>
          {rootEntries.length === 0 && state.creating === false
            ? <div style={styles.empty}>你的目录还是空的</div>
            : rootEntries.map(entry => (
              <TreeRow key={entry.path} entry={entry} depth={0} state={state} onToggle={toggle}
                onSelect={(e) => setState(s => ({ ...s, selected: e.path }))} />
            ))}
        </div>
        <div style={styles.footer}>
          {state.error !== null && <div style={styles.error} role="alert">{state.error}</div>}
          <div style={styles.newFolderRow}>
            <input
              style={styles.input}
              value={state.newFolderName}
              placeholder="新建文件夹名(可选)"
              aria-label="新建文件夹名"
              onChange={e => setState(s => ({ ...s, newFolderName: e.target.value }))}
              onKeyDown={e => { if (e.key === 'Enter') submitNewFolder() }}
            />
            <button type="button" style={styles.button} disabled={busy} onClick={submitNewFolder}>新建文件夹</button>
          </div>
          <div style={styles.buttonRow}>
            <button type="button" style={styles.button} onClick={onCancel}>取消</button>
            <button
              type="button"
              style={{ ...styles.button, ...styles.primary }}
              disabled={busy || state.selected === null}
              data-eterna-tree-confirm
              onClick={() => { if (state.selected !== null) onPicked(state.selected) }}
            >选择此目录</button>
          </div>
        </div>
      </div>
    </div>
  )
}
