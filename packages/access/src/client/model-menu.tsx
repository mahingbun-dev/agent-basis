/**
 * 模型选择单主面板+供应商子面板(2026-11-12 二轮:对齐 ZCode ComposerModelMenu 设计):
 * - 主面板:当前供应商行(点击右飞供应商子面板)+「模型」区块(当前组列表 max-h-60
 *   滚动,当前项 ✓)+「思考强度」区块(档位名+渐变滑杆,非当前组禁用)+「管理模型」
 * - 供应商子面板:RadioGroup 列表(✓=当前,N 模型计数)——顶对齐主面板、
 *   右侧飞出(溢出翻左),高度自适应视口(修复一轮版 B 继承 bottom 定位的破碎)
 * - 锚定:主面板 above 触发按钮优先;子面板定位=主面板渲染后实测 rect(方案对齐
 *   ZCode ComposerProviderMenu 的 offset 补偿:side=menu.right-row.right+4)
 * - 数据面:同窗 RPC(信封与上游 typert 同构);提交=selectModel;
 *   回显=ctx.sessions 投影单键本地写(rename 先例)
 */
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'

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

const S = {
  panel: {
    position: 'fixed', zIndex: 1300, width: 264,
    background: 'var(--dsw-alias-bg-layer-1, #1e1e23)',
    color: 'var(--dsw-alias-label-primary, #f3f4f6)',
    border: '1px solid var(--dsw-alias-border-l2, #333338)',
    borderRadius: 12, boxShadow: '0 12px 40px rgba(0,0,0,.45)',
    padding: '6px 0', fontFamily: 'var(--et-font-body, system-ui, sans-serif)',
    boxSizing: 'border-box',
  } as React.CSSProperties,
  row: {
    width: '100%', display: 'flex', alignItems: 'center', gap: 8,
    padding: '8px 14px', border: 'none', background: 'transparent',
    color: 'inherit', cursor: 'pointer', fontSize: 13.5, textAlign: 'left',
    boxSizing: 'border-box', minHeight: 36,
  } as React.CSSProperties,
  section: {
    padding: '8px 14px 4px', fontSize: 11.5,
    color: 'var(--dsw-alias-label-tertiary, #9ca3af)',
  } as React.CSSProperties,
  divider: { height: 1, background: 'var(--dsw-alias-border-l1, #2a2a2e)', margin: '5px 0' } as React.CSSProperties,
  logo: {
    width: 18, height: 18, borderRadius: 5, flexShrink: 0,
    background: 'var(--et-accent-soft, rgba(99,102,241,.2))',
    display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
    fontSize: 10, fontWeight: 600,
  } as React.CSSProperties,
  check: { color: 'var(--dsw-alias-state-success-primary, #34d399)', marginLeft: 'auto' } as React.CSSProperties,
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
  const [subOpen, setSubOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const rootRef = useRef<HTMLDivElement | null>(null)
  const mainRef = useRef<HTMLDivElement | null>(null)
  const [mainRect, setMainRect] = useState<{ left: number; top: number; right: number } | null>(null)

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

  // 全局点击/ESC 关闭(子面板点行不关——面板内导航)
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

  // 主面板实测 rect(子面板定位基准;above=bottom 定位时 top 由渲染结果给出)
  useLayoutEffect(() => {
    if (mainRef.current === null) return
    const r = mainRef.current.getBoundingClientRect()
    setMainRect({ left: r.left, top: r.top, right: r.right })
  }, [subOpen])

  const curProvider = useMemo(() => groups?.find(g => g.id === current?.provider) ?? null, [groups, current])
  const curModels = curProvider?.models ?? []
  const curModel = useMemo(() => curModels.find(m => m.id === current?.model) ?? null, [curModels, current])
  const curEfforts = curModel?.reasoning?.efforts ?? []
  // 档位语义:未显式选档=跟随 defaultEffort;两者都缺显示「默认」不误标第一档
  const explicitEffort = current?.reasoningEffort
  const curEffortId = explicitEffort ?? curModel?.reasoning?.defaultEffort
  const curEffortIdx = curEffortId === undefined ? -1 : curEfforts.findIndex(e => e.id === curEffortId)
  const curEffortName = curEffortId === undefined ? '默认'
    : (curEfforts[curEffortIdx >= 0 ? curEffortIdx : 0]?.name ?? curEffortId)

  const submit = (selected: Selected): void => {
    if (busy) return
    setBusy(true); setError(null)
    rpc<{ selected?: Selected }>('selectModel', { request: { sessionId: props.sessionId, ...selected } })
      .then(value => {
        const confirmed = value?.selected ?? selected
        setCurrent(confirmed)
        props.applySelection?.(props.sessionId, confirmed)
        setBusy(false)
        setSubOpen(false)
        props.dismiss()
      })
      .catch((e: unknown) => {
        setBusy(false)
        setError(e instanceof Error ? e.message : String(e))
      })
  }

  // —— 锚定:主面板 above/below 自适应 ——
  // 先按空间预估,渲染后实测高度越界即翻转(2026-11-12 用户实测:固定阈值 460
  // 在按钮 y≈443 的 composer 下误判 below,面板朝下盖输入框)。
  const [place, setPlace] = useState<'above' | 'below'>(anchor.top > 400 ? 'above' : 'below')
  useLayoutEffect(() => {
    if (subOpen) return // 子面板开着时锁位,避免收起时跳动
    if (mainRef.current === null) return
    const r = mainRef.current.getBoundingClientRect()
    if (place === 'below' && r.bottom > window.innerHeight - 8) setPlace('above')
    else if (place === 'above' && r.top < 8) setPlace('below')
  })
  const mainStyle: React.CSSProperties = (() => {
    const left = Math.max(8, Math.min(anchor.x - 40, window.innerWidth - 272))
    return {
      ...S.panel, left,
      ...(place === 'above' ? { bottom: window.innerHeight - anchor.top + 8 } : { top: anchor.top + 44 }),
    }
  })()
  // —— 子面板:顶对齐主面板、右侧飞出(溢出翻左);高度自适应 ——
  const subStyle: React.CSSProperties = (() => {
    if (mainRect === null) return { ...S.panel, visibility: 'hidden', left: mainStyle.left as number + 268, top: mainStyle.top ?? 40 }
    const subLeft = mainRect.right + 6
    const flip = subLeft + 264 > window.innerWidth - 8
    const availAbove = mainRect.top - 8
    const availBelow = window.innerHeight - mainRect.top - 8
    const maxH = Math.max(200, Math.max(availAbove, availBelow) - 4)
    return {
      ...S.panel, width: 240,
      left: flip ? mainRect.left - 240 - 6 : subLeft,
      top: availBelow >= availAbove ? mainRect.top : undefined,
      bottom: availBelow >= availAbove ? undefined : window.innerHeight - mainRect.top + 0,
      maxHeight: maxH, overflowY: 'auto',
    }
  })()

  return <div ref={rootRef} role="presentation" data-eterna-model-menu>
    {/* —— 主面板 —— */}
    <div ref={mainRef} role="menu" aria-label="模型与思考强度" style={mainStyle}>
      {/* 当前供应商行 → 右飞供应商子面板 */}
      <button type="button" role="menuitem" aria-expanded={subOpen}
        style={{ ...S.row, justifyContent: 'space-between', fontWeight: 600 }}
        onClick={() => { setSubOpen(v => !v) }}>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
          <span aria-hidden="true" style={S.logo}>{(curProvider?.name ?? '?').slice(0, 1)}</span>
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{curProvider?.name ?? '选择供应商'}</span>
        </span>
        <span aria-hidden="true" style={{ opacity: 0.55, flexShrink: 0 }}>›</span>
      </button>
      <div style={S.divider} />
      <div style={S.section}>模型</div>
      <div style={{ maxHeight: 240, overflowY: 'auto' }}>
        {curModels.map(m => {
          const active = m.id === current?.model
          return <button key={m.id} type="button" role="menuitemradio" aria-checked={active} disabled={busy}
            style={{ ...S.row, justifyContent: 'space-between' }}
            onClick={() => { if (current !== null) submit({ provider: current.provider, model: m.id }) }}>
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{m.name}</span>
            {active && <span aria-hidden="true" style={S.check}>✓</span>}
          </button>
        })}
        {curModels.length === 0 && <div style={{ ...S.row, opacity: 0.5, cursor: 'default' }}>目录读取中…</div>}
      </div>
      {curEfforts.length > 0 && <>
        <div style={S.divider} />
        <div style={S.section}>思考强度</div>
        <div style={{ ...S.row, cursor: 'default', display: 'block' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, marginBottom: 6 }}>
            <span>{curEffortName}</span>
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
      <div style={S.divider} />
      <button type="button" role="menuitem" style={{ ...S.row, fontWeight: 500 }}
        onClick={() => { props.dismiss() }}>
        管理模型
      </button>
    </div>

    {/* —— 供应商子面板(右飞;顶对齐主面板) —— */}
    {subOpen && <div role="menu" aria-label="选择供应商" style={subStyle}>
      {(groups ?? []).map(g => {
        const active = g.id === current?.provider
        const modelCount = g.models?.length ?? 0
        return <button key={g.id} type="button" role="menuitemradio" aria-checked={active}
          style={{ ...S.row, justifyContent: 'space-between' }}
          onClick={() => {
            // 选供应商=切到该供应商(沿用其当前/首个模型),子面板收起——对齐 ZCode
            // ProviderMenu「供应商页只负责导航」+ 上游 onSelect 立即落选择语义。
            if (current === null || g.id !== current.provider) {
              const model = g.models?.[0]
              if (model !== undefined) submit({ provider: g.id, model: model.id })
              else { setSubOpen(false) }
            } else { setSubOpen(false) }
          }}>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
            <span aria-hidden="true" style={S.logo}>{(g.name ?? g.id).slice(0, 1)}</span>
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{g.name ?? g.id}</span>
          </span>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 11, opacity: 0.7, flexShrink: 0 }}>
            {modelCount > 0 ? `${modelCount} 模型` : ''}
            {active && <span aria-hidden="true" style={S.check}>✓</span>}
          </span>
        </button>
      })}
    </div>}
  </div>
}
