/**
 * 模型选择锚定双面板(2026-11-12 用户裁定:Zhipu 桌面版同款):
 * - 面板 A(主菜单):当前供应商(> 开二级)+「模型」区块(当前值 ✓)+「思考强度」
 *   区块(档位名+渐变滑杆,efforts 来自 catalog reasoning 元数据)
 * - 面板 B(二级飞出):供应商列表(✓=当前) → 点供应商就地切换为该供应商模型列表
 *   (返回按钮) → 点模型提交;底部「管理模型」
 * - 锚定:触发按钮 rect,above 优先;B 在 A 右侧,溢出翻左侧
 * - 数据面:同窗 RPC(信封与上游 typert 同构,2026-11-12 实测捕获);
 *   提交=selectModel;回显=ctx.sessions 投影单键本地写(rename 先例)
 * - 初始 current:解析触发按钮 aria(上游/BADGE 写「当前 X」)+catalog 匹配 id/name
 */
import { useEffect, useMemo, useRef, useState } from 'react'

/** typert RPC 同构信封(POST /api/session/<method>)。 */
async function rpc<T>(method: string, args: Record<string, unknown>): Promise<T> {
  const body = JSON.stringify({
    type: 'client-request',
    rpcId: crypto.randomUUID(),
    method,
    payload: { args },
  })
  const r = await fetch(`/api/session/${method}`, {
    method: 'POST', credentials: 'same-origin',
    headers: { 'content-type': 'application/json' }, body,
  })
  const d = await r.json() as { result?: { ok?: boolean; value?: T; error?: { message?: string } } }
  if (d?.result?.ok !== true) throw new Error(d?.result?.error?.message ?? `RPC ${method} 失败`)
  return d.result.value as T
}

interface ReasoningEffort { readonly id: string; readonly name: string; readonly description?: string }
interface CatalogModel { readonly id: string; readonly name: string; readonly reasoning?: { readonly efforts: readonly ReasoningEffort[]; readonly defaultEffort?: string } }
interface CatalogProvider { readonly id: string; readonly name?: string; readonly models?: readonly CatalogModel[] }
interface CatalogValue { readonly groups?: readonly CatalogProvider[] }
interface Selected { readonly provider: string; readonly model: string; readonly reasoningEffort?: string }

const PANEL_STYLES = {
  panel: {
    position: 'fixed', zIndex: 1300, width: 280,
    background: 'var(--dsw-alias-bg-layer-1, #1e1e23)',
    color: 'var(--dsw-alias-label-primary, #f3f4f6)',
    border: '1px solid var(--dsw-alias-border-l2, #333338)',
    borderRadius: 12, boxShadow: '0 12px 40px rgba(0,0,0,.45)',
    padding: '8px 0', fontFamily: 'var(--et-font-body, system-ui, sans-serif)',
    boxSizing: 'border-box', overflowY: 'auto', maxHeight: '72vh',
  } as React.CSSProperties,
  row: {
    width: '100%', display: 'flex', alignItems: 'center', gap: 8,
    padding: '9px 14px', border: 'none', background: 'transparent',
    color: 'inherit', cursor: 'pointer', fontSize: 13.5, textAlign: 'left',
    boxSizing: 'border-box',
  } as React.CSSProperties,
  section: {
    padding: '8px 14px 4px', fontSize: 11.5,
    color: 'var(--dsw-alias-label-tertiary, #9ca3af)',
  } as React.CSSProperties,
  divider: { height: 1, background: 'var(--dsw-alias-border-l1, #2a2a2e)', margin: '6px 0' } as React.CSSProperties,
}

export interface ModelMenuOwner {
  /** 会话 id(当前 composer 绑定)。 */
  readonly sessionId: string
  /** 触发按钮 rect(锚定)。 */
  readonly anchor: { x: number; y: number; width: number; top: number }
  /** 关闭并聚焦回触发器。 */
  readonly dismiss: () => void
  /** 回显写面(投影 store 单键 apply;缺席=仅切换不回显)。 */
  readonly applySelection?: (sessionId: string, selected: Selected) => void
}

export function ModelMenu(props: ModelMenuOwner): React.JSX.Element {
  const { anchor, dismiss } = props
  const [groups, setGroups] = useState<readonly CatalogProvider[] | null>(null)
  const [current, setCurrent] = useState<Selected | null>(null)
  const [panelB, setPanelB] = useState<'providers' | 'models'>('providers')
  const [bProvider, setBProvider] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const rootRef = useRef<HTMLDivElement | null>(null)

  // 初始 current:触发按钮 aria「…当前 X，推理等级 Y」+catalog 匹配 id/name
  useEffect(() => {
    let alive = true
    rpc<CatalogValue>('modelCatalog', {}).then(value => {
      if (!alive) return
      const gs = value?.groups ?? []
      setGroups(gs)
      const btn = [...document.querySelectorAll('button')].find(b => (b.getAttribute('aria-label') || '').startsWith('选择模型'))
      const aria = btn?.getAttribute('aria-label') ?? ''
      const modelMatch = /当前 ([^，]+)/.exec(aria)?.[1]?.trim() ?? ''
      const effortMatch = /推理等级 ([^，\s]+)/.exec(aria)?.[1]?.trim() ?? ''
      for (const g of gs) {
        for (const m of g.models ?? []) {
          if (m.id === modelMatch || m.name === modelMatch) {
            const effort = m.reasoning?.efforts.find(e => e.id === effortMatch || e.name === effortMatch)?.id
            setCurrent({ provider: g.id, model: m.id, ...(effort === undefined ? {} : { reasoningEffort: effort }) })
            return
          }
        }
      }
    }).catch((e: unknown) => { if (alive) setError(e instanceof Error ? e.message : String(e)) })
    return () => { alive = false }
  }, [])

  // 全局点击/ESC 关闭
  useEffect(() => {
    const onDown = (e: MouseEvent): void => {
      if (rootRef.current !== null && e.target instanceof Node && rootRef.current.contains(e.target)) return
      dismiss()
    }
    const onKey = (e: KeyboardEvent): void => { if (e.key === 'Escape') { e.preventDefault(); dismiss() } }
    document.addEventListener('mousedown', onDown, true)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown, true)
      document.removeEventListener('keydown', onKey)
    }
  }, [dismiss])

  const curProvider = useMemo(() => groups?.find(g => g.id === current?.provider) ?? null, [groups, current])
  const curModel = useMemo(() => curProvider?.models?.find(m => m.id === current?.model) ?? null, [curProvider, current])
  const curEfforts = curModel?.reasoning?.efforts ?? []
  const curEffortId = current?.reasoningEffort ?? curModel?.reasoning?.defaultEffort ?? (curEfforts[0]?.id)
  const curEffortIdx = curEfforts.findIndex(e => e.id === curEffortId)

  const submit = (selected: Selected): void => {
    if (busy) return
    setBusy(true); setError(null)
    rpc<{ selected?: Selected }>('selectModel', { request: { sessionId: props.sessionId, ...selected } })
      .then(value => {
        const confirmed = value?.selected ?? selected
        setCurrent(confirmed)
        props.applySelection?.(props.sessionId, confirmed)
        setBusy(false)
        props.dismiss()
      })
      .catch((e: unknown) => {
        setBusy(false)
        setError(e instanceof Error ? e.message : String(e))
      })
  }

  // —— 锚定定位 ——
  const panelAStyle: React.CSSProperties = (() => {
    const above = anchor.top > 420
    const left = Math.max(8, Math.min(anchor.x, window.innerWidth - 296))
    return {
      ...PANEL_STYLES.panel,
      left,
      ...(above
        ? { bottom: window.innerHeight - anchor.top + 8 }
        : { top: anchor.top + 44 }),
    }
  })()
  const panelBStyle: React.CSSProperties = (() => {
    const left = panelAStyle.left as number
    const toRight = left + 288 + 288 <= window.innerWidth - 8
    return {
      ...PANEL_STYLES.panel,
      ...(toRight ? { left: left + 288 } : { left: Math.max(8, left - 288) }),
      ...(panelAStyle.bottom !== undefined
        ? { bottom: panelAStyle.bottom }
        : { top: panelAStyle.top }),
    }
  })()

  const bGroup = groups?.find(g => g.id === bProvider) ?? null

  return <div ref={rootRef} role="presentation" data-eterna-model-menu>
    {/* —— 面板 A:主菜单 —— */}
    <div role="menu" aria-label="模型与思考强度" style={panelAStyle}>
      {/* 当前供应商 → 开二级 */}
      <button type="button" role="menuitem" style={{ ...PANEL_STYLES.row, justifyContent: 'space-between', fontWeight: 600 }}
        onClick={() => { setBProvider(current?.provider ?? groups?.[0]?.id ?? null); setPanelB('providers') }}>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
          <span aria-hidden="true" style={{ width: 18, height: 18, borderRadius: 5, background: 'var(--et-accent-soft, rgba(99,102,241,.2))', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 10 }}>{(curProvider?.name ?? '?').slice(0, 1)}</span>
          {curProvider?.name ?? '选择供应商'}
        </span>
        <span aria-hidden="true" style={{ opacity: 0.55 }}>›</span>
      </button>
      <div style={PANEL_STYLES.divider} />
      <div style={PANEL_STYLES.section}>模型</div>
      <div style={{ ...PANEL_STYLES.row, cursor: 'default', fontWeight: 500, justifyContent: 'space-between' }}>
        <span>{curModel?.name ?? current?.model ?? '—'}</span>
        {curModel !== null && <span aria-hidden="true" style={{ color: 'var(--dsw-alias-state-success-primary, #34d399)' }}>✓</span>}
      </div>
      {curEfforts.length > 0 && <>
        <div style={PANEL_STYLES.section}>思考强度</div>
        <div style={{ ...PANEL_STYLES.row, cursor: 'default', display: 'block' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, marginBottom: 6 }}>
            <span>{curEfforts[curEffortIdx >= 0 ? curEffortIdx : 0]?.name ?? '默认'}</span>
          </div>
          <input type="range" min={0} max={Math.max(0, curEfforts.length - 1)} step={1}
            value={curEffortIdx >= 0 ? curEffortIdx : 0}
            aria-label="思考强度"
            onChange={e => {
              const idx = Number(e.target.value)
              const effort = curEfforts[idx]
              if (effort === undefined || current === null || busy) return
              submit({ provider: current.provider, model: current.model, reasoningEffort: effort.id })
            }}
            style={{
              width: '100%', accentColor: 'var(--et-accent, #818cf8)',
              background: 'linear-gradient(90deg,#34d399,#60a5fa,#818cf8)',
              height: 6, borderRadius: 3, appearance: 'none', cursor: 'pointer',
            }} />
        </div>
      </>}
      {error !== null && <div role="alert" style={{ padding: '6px 14px', color: 'var(--et-danger, #f56a6a)', fontSize: 12.5 }}>{error}</div>}
    </div>

    {/* —— 面板 B:二级飞出 —— */}
    <div role="menu" aria-label={panelB === 'providers' ? '选择供应商' : '选择模型'} style={panelBStyle}>
      {panelB === 'models' && <button type="button" role="menuitem" style={{ ...PANEL_STYLES.row, opacity: 0.75 }}
        onClick={() => { setPanelB('providers') }}>
        <span aria-hidden="true">‹</span> {bGroup?.name ?? '返回'}
      </button>}
      {panelB === 'providers' && groups?.map(g => {
        const active = g.id === current?.provider
        const modelCount = g.models?.length ?? 0
        return <button key={g.id} type="button" role="menuitem"
          style={{ ...PANEL_STYLES.row, justifyContent: 'space-between' }}
          onClick={() => { setBProvider(g.id); setPanelB(modelCount > 0 ? 'models' : 'providers') }}>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
            <span aria-hidden="true" style={{ width: 18, height: 18, borderRadius: 5, background: 'var(--et-accent-soft, rgba(99,102,241,.2))', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 10 }}>{(g.name ?? g.id).slice(0, 1)}</span>
            {g.name ?? g.id}
          </span>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 11, opacity: 0.7 }}>
            {modelCount > 0 ? `${modelCount} 模型` : ''}
            {active && <span style={{ color: 'var(--dsw-alias-state-success-primary, #34d399)' }}>✓</span>}
          </span>
        </button>
      })}
      {panelB === 'models' && bGroup?.models?.map(m => {
        const active = current?.provider === bGroup.id && current?.model === m.id
        return <button key={m.id} type="button" role="menuitemradio" aria-checked={active} disabled={busy}
          style={{ ...PANEL_STYLES.row, justifyContent: 'space-between' }}
          onClick={() => { submit({ provider: bGroup.id, model: m.id }) }}>
          <span>{m.name}</span>
          {active && <span style={{ color: 'var(--dsw-alias-state-success-primary, #34d399)' }}>✓</span>}
        </button>
      })}
      <div style={PANEL_STYLES.divider} />
      <button type="button" role="menuitem" style={{ ...PANEL_STYLES.row, fontWeight: 500 }}
        onClick={() => { props.dismiss() }}>
        管理模型
      </button>
    </div>
  </div>
}
