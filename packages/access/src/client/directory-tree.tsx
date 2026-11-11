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
import { useEffect, useRef, useState } from 'react'
import { Icon } from '@eterna/ui/icons'

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
    background: 'var(--dsw-alias-bg-mask-1, var(--et-overlay))',
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
  caret: { width: 14, flexShrink: 0, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', color: 'var(--et-muted)' },
  folderIcon: { flexShrink: 0, display: 'inline-flex', color: 'var(--et-muted)' },
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
    background: 'var(--et-accent-fill)',
    borderColor: 'transparent', color: 'var(--et-accent-on)',
  },
  error: { color: 'var(--et-danger)', fontSize: 12, lineHeight: 1.5 },
  empty: { padding: '24px 16px', textAlign: 'center', opacity: 0.6, fontSize: 14 },
  hint: { fontSize: 12, color: 'var(--et-muted)', fontWeight: 400 },
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
      <span style={styles.caret}><Icon name={expanded ? 'chevron-down' : 'chevron-right'} size={14} /></span>
      <span style={styles.folderIcon}><Icon name="folder" size={14} /></span>
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
  }, [open, state.listing, state.creating])
  // 根节点显示名(2026-11-12 用户反馈:顶层应显示用户目录如 Mr.Ma,否则用户不知所措):
  // 拉当前账号名做根行;失败降级「我的目录」。
  const [rootName, setRootName] = useState<string | null>(null)
  useEffect(() => {
    if (!open || rootName !== null) return
    fetch('/access/api/me', { credentials: 'same-origin' }).then(r => r.ok ? r.json() : null).then((me: { account?: string; nickname?: string } | null) => {
      if (me !== null) setRootName(me.nickname || me.account || '我的目录')
    }).catch(() => { setRootName('我的目录') })
    // eslint-disable-next-line react-hooks/exhaustive-deps -- open 触发一次
  }, [open])
  const dialogRef = useRef<HTMLDivElement | null>(null)
  const cancelRef = useRef(onCancel)
  cancelRef.current = onCancel
  useEffect(() => {
    if (!open) return
    const previous = document.activeElement as HTMLElement | null
    const timer = window.setTimeout(() => {
      const dialog = dialogRef.current
      if (dialog === null) return
      const first = dialog.querySelector<HTMLElement>('button:not(:disabled), input:not(:disabled)')
      ;(first ?? dialog).focus()
    }, 0)
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.preventDefault()
        cancelRef.current()
        return
      }
      if (event.key !== 'Tab') return
      const dialog = dialogRef.current
      if (dialog === null) return
      const focusables = Array.from(dialog.querySelectorAll<HTMLElement>(
        'button:not(:disabled), input:not(:disabled), [href], [tabindex]:not([tabindex="-1"])',
      )).filter(element => element.offsetParent !== null)
      if (focusables.length === 0) return
      const first = focusables[0] as HTMLElement
      const last = focusables[focusables.length - 1] as HTMLElement
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault(); last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault(); first.focus()
      }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => {
      window.clearTimeout(timer)
      document.removeEventListener('keydown', onKeyDown)
      previous?.focus()
    }
  }, [open])
  if (!open) return null
  const rootEntries = state.listing?.entries ?? []
  const rootPath = state.listing?.path ?? null
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
      <div ref={dialogRef} style={styles.dialog} tabIndex={-1} aria-labelledby="eterna-directory-title">
        <div id="eterna-directory-title" style={styles.header}>选择工作区目录</div>
        <div style={styles.body} data-eterna-directory-tree>
          {/* 根节点行(用户家目录):顶层定位——用户知道自己在哪层(2026-11-12 反馈)。
              常显+点击选中家目录;子目录列表缩进挂其下。 */}
          {rootPath !== null && rootName !== null && (
            <button
              type="button"
              style={{ ...styles.row, ...(state.selected === rootPath ? styles.rowSelected : {}), fontWeight: 600 }}
              onClick={() => setState(s => ({ ...s, selected: rootPath }))}
              data-eterna-tree-root-row
            >
              <span style={{ ...styles.caret, visibility: 'hidden' }}><Icon name="chevron-right" size={14} /></span>
              <span style={styles.folderIcon}><Icon name="folder" size={14} /></span>
              <span>{rootName}</span>
              <span style={{ ...styles.hint, marginLeft: 6 }}>(家目录)</span>
            </button>
          )}
          {rootEntries.map(entry => (
            <TreeRow key={entry.path} entry={entry} depth={1} state={state} onToggle={toggle}
              onSelect={(e) => setState(s => ({ ...s, selected: e.path }))} />
          ))}
          {rootEntries.length === 0 && state.creating === false && rootPath !== null
            ? <div style={styles.empty}>家目录下还没有子目录——可选中上方家目录，或新建文件夹</div>
            : null}
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
