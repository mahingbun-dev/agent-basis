/**
 * 诊断区块组件 v2(jsx;样式走 styles.ts 语义令牌,按钮用官方 ui-primitives Button)。
 *
 * 交互(用户 2026-11-09 指定):默认折叠;「测试」按钮插在 provider 卡片头部的
 * 「编辑」按钮隔壁(克隆编辑按钮节点换文案=原生外观,插入相邻 DOM 由
 * MutationObserver 兜底重插),点击展开/收起诊断面板;模型区限高+滚动。
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { Button } from '@deepseek-ai/dsh-client-ui-primitives'
import type { DoctorClientContext, HealthReport, ModelState } from './state.ts'

/** 卡片属主共享 props(官方 ProviderCardExtrasOwnerProps 子集)。 */
export interface CardOwnerProps {
  readonly provider?: { readonly settingsNs?: string; readonly provider?: string }
  readonly configured?: boolean
}

/** 体检 chip 文案与色档。 */
function healthView(verdict: string | undefined): { label: string; tone: 'ok' | 'missing' | 'unreachable' | 'unsupported' } {
  if (verdict === undefined) return { label: '体检中…', tone: 'ok' }
  if (verdict === 'ok') return { label: '路径体检 · 正常', tone: 'ok' }
  if (verdict === 'unreachable') return { label: '路径体检 · 网关不可达', tone: 'unreachable' }
  if (verdict === 'path-missing') return { label: '路径体检 · 配置待修正', tone: 'missing' }
  return { label: '路径体检 · 协议不可探测', tone: 'unsupported' }
}

/** 卡片内诊断区块(slot 组件;ctx 经 slot inject 份额传入)。 */
export function DoctorStrip(props: CardOwnerProps & { slotCtx?: DoctorClientContext }) {
  const { slotCtx: ctx } = props
  const ownerProvider = props.provider?.provider ?? ''
  const [expanded, setExpanded] = useState(false)
  const [health, setHealth] = useState<HealthReport>()
  const [failed, setFailed] = useState<string | undefined>()
  const [states, setStates] = useState<Record<string, ModelState>>({})
  const hostRef = useRef<HTMLDivElement | null>(null)
  /** 折叠态下 host 不渲染内容,但切换引用必须存活——经 ref 中转。 */
  const toggleRef = useRef<() => void>(() => {})
  toggleRef.current = () => { setExpanded(value => !value) }

  useEffect(() => {
    if (ctx === undefined) return
    let alive = true
    void ctx.callDoctor('llmDoctor/health').then((result) => {
      if (!alive) return
      if (result.ok && typeof result.value === 'object' && result.value !== null) {
        setHealth(result.value as HealthReport)
        setFailed(undefined)
      } else {
        setFailed(result.message ?? '诊断服务不可达')
      }
    })
    return () => { alive = false }
  }, [ctx])

  const test = useCallback((model: string) => {
    if (ctx === undefined) return
    setStates((prev) => ({ ...prev, [model]: { status: 'testing' } }))
    void ctx.callDoctor('llmDoctor/probe', { provider: ownerProvider, model }).then((result) => {
      if (result.ok && typeof result.value === 'object' && result.value !== null) {
        const ping = result.value as { ok?: boolean; latencyMs?: number; preview?: string; error?: string }
        if (ping.ok === true) {
          const okState: ModelState = { status: 'ok', ...(ping.latencyMs !== undefined ? { latencyMs: ping.latencyMs } : {}), ...(ping.preview !== undefined && ping.preview !== '' ? { preview: ping.preview } : {}) }
          setStates((prev) => ({ ...prev, [model]: okState }))
        } else {
          setStates((prev) => ({ ...prev, [model]: { status: 'fail', error: ping.error ?? '失败' } }))
        }
      } else {
        setStates((prev) => ({ ...prev, [model]: { status: 'fail', error: result.message ?? 'RPC 失败' } }))
      }
    })
  }, [ctx, ownerProvider])

  // 「测试」按钮插入卡片头部「编辑」隔壁:克隆编辑按钮节点(继承原生样式)换
  // 文案,点击经 toggleRef 切换面板。React 重渲染可能丢弃插入节点——每次渲染
  // 重插(以 data 标记防重复),另加 600ms 兜底一次(首渲染竞态)。
  useEffect(() => {
    const insert = (): void => {
      let el: HTMLElement | null = hostRef.current
      for (let depth = 0; depth < 8 && el !== null; depth++) {
        const container = el
        const editButton = container.querySelector<HTMLButtonElement>('button[class*="secondaryButton"]')
          ?? Array.from(container.querySelectorAll('button'))
            .find(button => (button.textContent ?? '').trim() === '编辑')
        if (editButton !== undefined && editButton.parentElement !== null) {
          const parent = editButton.parentElement
          if (parent.querySelector('[data-bdoc-toggle]') === null) {
            const toggle = editButton.cloneNode(true) as HTMLButtonElement
            toggle.setAttribute('data-bdoc-toggle', '')
            toggle.removeAttribute('disabled')
            toggle.textContent = '测试'
            toggle.setAttribute('aria-label', '测试')
            toggle.addEventListener('click', (event) => {
              event.preventDefault()
              event.stopPropagation()
              toggleRef.current()
            })
            parent.insertBefore(toggle, editButton as Node)
          }
          return
        }
        el = el.parentElement
      }
    }
    insert()
    const retry = setTimeout(insert, 600)
    return () => { clearTimeout(retry) }
  })

  if (ctx === undefined) return null
  const route = health?.routes?.find((entry) => entry.provider === ownerProvider)
  const routeHealth = health?.health?.find((entry) => entry.provider === ownerProvider)
  const chip = healthView(routeHealth?.verdict)
  const fixes = health?.lastAutoFix?.filter((fix) => fix.provider === ownerProvider) ?? []
  const models = route?.models ?? []

  if (!expanded) {
    // 折叠态:占位锚点(保持卡片内挂载与「测试」按钮插入锚),不渲染面板。
    return <div ref={hostRef} data-bdoc-host="" />
  }
  return (
    <div ref={hostRef} data-bdoc-root="">
      <div data-bdoc-head="">
        <span data-bdoc-title="">连通性诊断</span>
        <span data-bdoc-health={chip.tone}>{chip.label}</span>
      </div>
      {fixes.length > 0 && (
        <div data-bdoc-autofix="">
          已自动适配 baseURL（协议 {fixes[0]?.api ?? ''}）: {fixes[0]?.from} → {fixes[0]?.to}
        </div>
      )}
      {failed !== undefined && <div data-bdoc-result="fail">诊断服务不可达:{failed}</div>}
      <div data-bdoc-rows="">
        {models.map((model) => {
          const state = states[model] ?? { status: 'idle' as const }
          return (
            <div key={model} data-bdoc-row="">
              <span data-bdoc-name="" title={model}>{model}</span>
              {state.status === 'idle' && <span data-bdoc-result="idle">未测试</span>}
              {state.status === 'testing' && <span data-bdoc-result="idle">测试中…</span>}
              {state.status === 'ok' && (
                <span data-bdoc-result="ok" title={state.preview ?? ''}>
                  ✓ {state.latencyMs}ms{state.preview !== undefined && state.preview !== '' ? ` · ${state.preview}` : ''}
                </span>
              )}
              {state.status === 'fail' && (
                <span data-bdoc-result="fail" title={state.error ?? ''}>✗ {state.error ?? '失败'}</span>
              )}
              <span data-bdoc-btn="">
                <Button variant="outline" size="sm" disabled={state.status === 'testing'} onClick={() => test(model)}>
                  {state.status === 'testing' ? '测试中' : '测试'}
                </Button>
              </span>
            </div>
          )
        })}
      </div>
      {models.length === 0 && health !== undefined && (
        <div data-bdoc-empty="">路由目录为空——在上方编辑器保存模型清单后即可逐模型测试。</div>
      )}
    </div>
  )
}
