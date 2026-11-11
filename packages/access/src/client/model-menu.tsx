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
    background: 'var(--et-surface)',
    color: 'var(--et-fg)',
    border: '1px solid var(--et-border)',
    borderRadius: 'var(--et-radius-lg)', boxShadow: 'var(--et-shadow-raised)',
    padding: '6px 0', fontFamily: 'var(--et-font-body, system-ui, sans-serif)',
    boxSizing: 'border-box',
  } as React.CSSProperties,
  row: {
    width: '100%', display: 'flex', alignItems: 'center', gap: 8,
    padding: '8px 14px', border: 'none', background: 'transparent',
    color: 'inherit', cursor: 'pointer', fontSize: 14, textAlign: 'left',
    boxSizing: 'border-box', minHeight: 36,
  } as React.CSSProperties,
  section: {
    padding: '8px 14px 4px', fontSize: 12,
    color: 'var(--et-muted)',
  } as React.CSSProperties,
  divider: { height: 1, background: 'var(--et-border-soft)', margin: '5px 0' } as React.CSSProperties,
  logo: {
    width: 18, height: 18, borderRadius: 'var(--et-radius-sm)', flexShrink: 0,
    background: 'var(--et-accent-soft)',
    display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
    fontSize: 10, fontWeight: 600,
  } as React.CSSProperties,
  check: { color: 'var(--et-success)', marginLeft: 'auto' } as React.CSSProperties,
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
  /** 「管理模型」:打开设置弹窗「模型」分区(settings.section id='models')。
   *  返回 false=设置壳未就绪——不静默吞,面板留驻并提示。 */
  readonly openModelsSettings?: () => boolean
}

/** max 档气泡种子(ZCode EFFORT_BUBBLES 同构):固定种子避免重渲染错峰跳动。 */
const EFFORT_BUBBLES = [
  { top: 4, size: 2, duration: 2.6, delay: -0.4 },
  { top: 14, size: 3, duration: 3.2, delay: -2.1 },
  { top: 8, size: 4, duration: 2.8, delay: -1.1 },
  { top: 18, size: 2, duration: 3.6, delay: -0.8 },
  { top: 3, size: 3, duration: 3, delay: -2.5 },
  { top: 12, size: 2, duration: 3.4, delay: -1.7 },
  { top: 6, size: 3, duration: 3.1, delay: -0.9 },
  { top: 17, size: 4, duration: 2.9, delay: -2.3 },
  { top: 10, size: 2, duration: 3.5, delay: -0.2 },
  { top: 2, size: 2, duration: 2.7, delay: -1.8 },
  { top: 15, size: 3, duration: 3.3, delay: -1.2 },
  { top: 7, size: 4, duration: 3.6, delay: -3.1 },
]

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

  // 滑杆(ZCode ComposerModelMenu 同构):拖动只更新视觉 draft,手势完成
  // (onPointerUp/onKeyUp)才提交;提交后清 draft 回归投影值。
  const sliderRef = useRef<HTMLInputElement | null>(null)
  const [draftIdx, setDraftIdx] = useState<number | null>(null)
  const visualIdx = draftIdx ?? (curEffortIdx >= 0 ? curEffortIdx : 0)
  const visualProgress = curEfforts.length > 1 ? (visualIdx / (curEfforts.length - 1)) * 100 : 0
  const visualEffortName = (curEfforts[visualIdx]?.name ?? curEffortName)
  const commitSlider = (index: number): void => {
    setDraftIdx(null)
    const effort = curEfforts[index]
    if (effort === undefined || current === null || busy) return
    if (effort.id === curEffortId) return
    submit({ provider: current.provider, model: current.model, reasoningEffort: effort.id }, { closeAfter: false })
  }

  const submit = (selected: Selected, options: { readonly closeAfter: boolean }): void => {
    if (busy) return
    setBusy(true); setError(null)
    rpc<{ selected?: Selected }>('selectModel', { request: { sessionId: props.sessionId, ...selected } })
      .then(value => {
        const confirmed = value?.selected ?? selected
        setCurrent(confirmed)
        props.applySelection?.(props.sessionId, confirmed)
        setBusy(false)
        setSubOpen(false)
        // 关闭语义(2026-11-12 用户裁定):切供应商面板保留(继续选模型/调档);
        // 选模型/调档完成即收。
        if (options.closeAfter) props.dismiss()
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
  // 挂载时一次定位(2026-11-12:每渲染跑的翻转会在 catalog 回来重渲染时挪位——
  // 用户点击瞬间面板移走=点到空处 onDown 关闭且无操作,即「点任意位置消失」根因)
  useLayoutEffect(() => {
    if (mainRef.current === null) return
    const r = mainRef.current.getBoundingClientRect()
    if (place === 'below' && r.bottom > window.innerHeight - 8) setPlace('above')
    else if (place === 'above' && r.top < 8) setPlace('below')
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 仅挂载时定一次位
  }, [])
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
            onClick={() => { if (current !== null) submit({ provider: current.provider, model: m.id }, { closeAfter: true }) }}>
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{m.name}</span>
            {active && <span aria-hidden="true" style={S.check}>✓</span>}
          </button>
        })}
        {curModels.length === 0 && <div style={{ ...S.row, opacity: 0.5, cursor: 'default' }}>目录读取中…</div>}
      </div>
      {curEfforts.length > 0 && <>
        <div style={S.divider} />
        <div style={S.section}>思考强度</div>
        {/* 滑杆=ZCode ComposerModelMenu 同构(2026-11-12):
            可视轨道(填充+档位圆点+白 thumb)+透明原生 range 叠加;
            提交只在手势完成时(onPointerUp/onKeyUp),onChange 仅视觉——
            拖动不提交、不关面板;事件全部 stopPropagation 防冒泡关闭链。 */}
        <div style={{ padding: '4px 14px 12px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 14, marginBottom: 4 }}>
            <span>{visualEffortName}</span>
          </div>
          <div className="et-thought-slider" data-disabled={busy}>
            {/* 可视轨道 */}
            <div aria-hidden="true" style={{ position: 'absolute', inset: 0 }}>
              <div style={{ position: 'absolute', left: 0, right: 0, top: 4, height: 24, borderRadius: 'var(--et-radius-pill)',
                background: 'var(--et-surface-2)',
                border: '1px solid var(--et-border)', overflow: 'hidden' }}>
                {/* 填充(低档绿→高档蓝渐变,贴 ZCode 参考图;thumb 半径 14px 补偿公式) */}
                <div style={{ position: 'absolute', top: 0, bottom: 0, left: 0,
                  width: `calc(14px + (100% - 28px) * ${visualProgress / 100})`,
                  background: 'linear-gradient(90deg, var(--et-success), var(--et-accent))',
                  transition: 'width var(--et-motion-fast) var(--et-ease)' }} />
                {/* max 档气泡流动(ZCode composer-thought-bubbles 质感) */}
                {visualIdx >= curEfforts.length - 1 && curEfforts.length > 1 && (
                  <div aria-hidden="true" className="et-thought-bubbles" style={{ position: 'absolute', inset: 0 }}>
                    {EFFORT_BUBBLES.map((bubble, index) => (
                      <span key={index} className="et-thought-bubble"
                        style={{ top: bubble.top, animationDuration: `${bubble.duration}s`, animationDelay: `${bubble.delay}s`, position: 'absolute', left: 0, right: 0, pointerEvents: 'none' }}>
                        <span style={{ display: 'block', width: bubble.size, height: bubble.size, borderRadius: '50%', background: 'var(--et-accent-on)' }} />
                      </span>
                    ))}
                  </div>
                )}
                {/* 档位圆点(均布;已过档白色半透) */}
                <div style={{ position: 'absolute', left: 14, right: 14, top: 0, bottom: 0, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  {curEfforts.map((level, index) => (
                    <span key={level.id} className="et-thought-stop"
                      data-filled={index <= visualIdx}
                      style={{ width: 4, height: 4, borderRadius: '50%', flexShrink: 0,
                        background: index <= visualIdx ? 'color-mix(in oklab, var(--et-accent-on), transparent 45%)' : 'var(--et-muted)',
                        transition: 'scale var(--et-motion-fast) var(--et-ease), opacity var(--et-motion-fast) var(--et-ease)' }} />
                  ))}
                </div>
              </div>
              {/* 白色 thumb */}
              <div aria-hidden="true" style={{ position: 'absolute', top: 2, width: 28, height: 28, borderRadius: '50%',
                left: `calc((100% - 28px) * ${visualProgress / 100})`,
                background: 'var(--et-accent-on)', border: '1px solid var(--et-border)',
                boxShadow: '0 1px 2px var(--et-border)',
                transition: 'left var(--et-motion-fast) var(--et-ease)' }} />
            </div>
            {/* 透明原生 range(交互层) */}
            <input ref={sliderRef} type="range" min={0} max={Math.max(0, curEfforts.length - 1)} step={1}
              value={visualIdx}
              aria-label="思考强度" aria-valuetext={visualEffortName} aria-disabled={busy || undefined}
              className="et-thought-range"
              onClick={e => { e.stopPropagation() }}
              onKeyDown={e => { if (e.key !== 'Escape') e.stopPropagation() }}
              onChange={e => { e.stopPropagation(); setDraftIdx(Number(e.target.value)) }}
              onPointerUp={e => { commitSlider(Number(e.currentTarget.value)) }}
              onKeyUp={e => {
                if (['Home', 'End', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'PageUp', 'PageDown'].includes(e.key)) {
                  commitSlider(Number(e.currentTarget.value))
                }
              }} />
          </div>
        </div>
      </>}
      {error !== null && <div role="alert" style={{ padding: '6px 14px', color: 'var(--et-danger)', fontSize: 12 }}>{error}</div>}
      <div style={S.divider} />
      <button type="button" role="menuitem" style={{ ...S.row, fontWeight: 500 }}
        onClick={() => {
          // 2026-11-12 用户反馈:该按钮此前只 dismiss(),点下去面板消失而无任何操作
          // =空按钮。ZCode 同一入口切设置页「模型」分区(SettingsPage.tsx:704
          // handleOpenModelProviderSettings),此处同构走 settings.section id='models'。
          const opened = props.openModelsSettings?.() ?? false
          if (opened) props.dismiss()
          else setError('设置弹窗尚未就绪，请稍后重试')
        }}>
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
              if (model !== undefined) submit({ provider: g.id, model: model.id }, { closeAfter: false })
              else { setSubOpen(false) }
            } else { setSubOpen(false) }
          }}>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
            <span aria-hidden="true" style={S.logo}>{(g.name ?? g.id).slice(0, 1)}</span>
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{g.name ?? g.id}</span>
          </span>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, opacity: 0.7, flexShrink: 0 }}>
            {modelCount > 0 ? `${modelCount} 模型` : ''}
            {active && <span aria-hidden="true" style={S.check}>✓</span>}
          </span>
        </button>
      })}
    </div>}
  </div>
}
