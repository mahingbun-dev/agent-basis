/**
 * 模型选择抽屉(2026-11-12 用户裁定:抽屉二级展开——点供应商展开具体模型):
 * - 挂 conversation.input.model.options slot(ui-model-selection slots.ts:26
 *   声明的 list slot,根菜单尾部追加)——入口项「按供应商选择…」
 * - 数据面:同窗 fetch RPC(信封与上游 typert client 逐字段同构,2026-11-12
 *   实测捕获)——modelCatalog 拉目录、selectModel 提交切换
 * - 回显写面:ctx.sessions.projectionStore(sessionId).apply('modelSelection',
 *   wire view {lastUsed,next})——rename 先例的本地 apply;control 流投影帧在
 *   多用户 mux 环境不达(2026-11-11/12 E2E),不写则模型按钮恒显旧模型
 * - 交互纪律:ESC/遮罩双关闭、焦点回触发器、两击无防抖需求(单次提交后即关)
 */
import { useEffect, useRef, useState } from 'react'

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

interface CatalogModel {
  readonly id: string
  readonly name?: string
  readonly contextWindow?: number
}
interface CatalogProvider {
  readonly id: string
  readonly name?: string
  readonly models?: readonly CatalogModel[]
}
interface CatalogValue {
  readonly groups?: readonly CatalogProvider[]
}
interface Selected {
  readonly provider: string
  readonly model: string
  readonly reasoningEffort?: string
}

export interface ModelDrawerOwner {
  /** 关闭根菜单并聚焦触发器(options slot owner 契约)。 */
  readonly dismiss: () => void
  /** 会话 id(当前 composer 绑定的会话)。 */
  readonly sessionId: string
  /** 回显写面(投影 store 单键 apply;缺席=仅切换不回显)。 */
  readonly applySelection?: (sessionId: string, selected: Selected) => void
}

/** 抽屉组件:供应商分组二级展开,点模型即提交并关闭。 */
export function ModelDrawer(props: ModelDrawerOwner): React.JSX.Element | null {
  const { dismiss, sessionId, applySelection } = props
  const [groups, setGroups] = useState<readonly CatalogProvider[] | null>(null)
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set())
  const [current, setCurrent] = useState<Selected | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const boxRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    let alive = true
    rpc<CatalogValue>('modelCatalog', {}).then(value => {
      if (!alive) return
      setGroups(value?.groups ?? [])
      // 默认展开第一个有模型的供应商
      const first = (value?.groups ?? []).find(g => (g.models?.length ?? 0) > 0)
      if (first !== undefined) setExpanded(new Set([first.id]))
    }).catch((e: unknown) => {
      if (!alive) return
      setError(e instanceof Error ? e.message : String(e))
    })
    return () => { alive = false }
  }, [])

  const submit = (provider: string, model: CatalogModel): void => {
    if (busy) return
    setBusy(true); setError(null)
    const selected: Selected = { provider, model: model.id }
    rpc<{ selected?: Selected }>('selectModel', { request: { sessionId, ...selected } })
      .then(value => {
        const confirmed = value?.selected ?? selected
        setCurrent(confirmed)
        applySelection?.(sessionId, confirmed)
        setBusy(false)
        dismiss()
      })
      .catch((e: unknown) => {
        setBusy(false)
        setError(e instanceof Error ? e.message : String(e))
      })
  }

  const toggle = (id: string): void => {
    setExpanded(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  return <div role="presentation" data-eterna-model-drawer
    onClick={e => { if (e.target === e.currentTarget) dismiss() }}
    style={{
      position: 'fixed', inset: 0, zIndex: 1200,
      background: 'var(--dsw-alias-bg-mask-1, rgba(0,0,0,0.5))',
      display: 'flex', justifyContent: 'flex-end',
      fontFamily: 'var(--et-font-body, system-ui, sans-serif)',
    }}>
    <div ref={boxRef} role="dialog" aria-label="选择模型"
      style={{
        width: 'min(400px, 92vw)', height: '100vh', overflowY: 'auto',
        background: 'var(--et-surface, var(--dsw-alias-bg-layer-1, #1c1c1f))',
        color: 'var(--et-fg, var(--dsw-alias-label-primary, #f3f4f6))',
        borderLeft: '1px solid var(--et-border, var(--dsw-alias-border-l2, #333))',
        padding: '20px 18px', boxSizing: 'border-box',
      }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
        <h2 style={{ margin: 0, fontSize: 17, fontWeight: 600 }}>选择模型</h2>
        <button type="button" onClick={dismiss} aria-label="关闭选择模型"
          style={{ background: 'none', border: '1px solid var(--et-border, #333)', borderRadius: 8, color: 'inherit', cursor: 'pointer', padding: '4px 10px', fontSize: 13 }}>关闭</button>
      </div>
      <p style={{ margin: '0 0 14px', fontSize: 12.5, color: 'var(--et-muted, var(--dsw-alias-label-tertiary, #9ca3af))', lineHeight: 1.5 }}>
        点供应商展开模型列表；当前项已标出。
      </p>
      {error !== null && <p role="alert" style={{ color: 'var(--et-danger, #f56a6a)', fontSize: 13 }}>{error}</p>}
      {groups === null && <p style={{ opacity: 0.6, fontSize: 13 }}>目录读取中…</p>}
      {groups !== null && groups.length === 0 && <p style={{ opacity: 0.6, fontSize: 13 }}>目录为空：先在设置→模型里配置供应商。</p>}
      {groups?.map(g => {
        const models = g.models ?? []
        const isOpen = expanded.has(g.id)
        return <div key={g.id} style={{ marginBottom: 8, border: '1px solid var(--et-border-soft, #2a2a2e)', borderRadius: 10, overflow: 'hidden' }}>
          <button type="button" aria-expanded={isOpen}
            onClick={() => { if (models.length > 0) toggle(g.id) }}
            style={{
              width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              padding: '10px 12px', background: 'var(--et-surface-2, var(--dsw-alias-bg-layer-2, #26262c))',
              border: 'none', color: 'inherit', cursor: models.length > 0 ? 'pointer' : 'default',
              fontSize: 14, fontWeight: 600, textAlign: 'left',
            }}>
            <span>{g.name ?? g.id}</span>
            <span aria-hidden="true" style={{ opacity: 0.6, fontSize: 11 }}>{models.length > 0 ? (isOpen ? '▾' : '▸') : ''}</span>
          </button>
          {isOpen && <div>
            {models.map(m => {
              const active = current?.provider === g.id && current?.model === m.id
              return <button key={m.id} type="button" role="menuitemradio" aria-checked={active}
                disabled={busy}
                onClick={() => { submit(g.id, m) }}
                style={{
                  width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                  padding: '9px 14px', background: active ? 'var(--et-accent-soft, rgba(99,102,241,.18))' : 'transparent',
                  border: 'none', borderTop: '1px solid var(--et-border-soft, #2a2a2e)',
                  color: 'inherit', cursor: 'pointer', fontSize: 13.5, textAlign: 'left',
                }}>
                <span>{m.name ?? m.id}</span>
                {active && <span style={{ fontSize: 11, color: 'var(--et-accent, #818cf8)' }}>当前</span>}
              </button>
            })}
          </div>}
        </div>
      })}
    </div>
  </div>
}
