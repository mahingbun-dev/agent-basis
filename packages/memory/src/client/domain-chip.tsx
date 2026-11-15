/**
 * 域识别 chip(M-M3 T12-③,19 号 §5-T12.3 + 18 §10/Q6 决议「进会话 UI」):
 * 官方席位 conversation.input.right(list,session 作用域;eterna-panel 触发条同位)。
 * - 展示当前会话识别域(「域:部署」/「域:未识别」;人工切换中加「已切换」标记);
 * - 点击展开已注册域列表可切换(切换=写 domain_registry last_used + 当前索引域
 *   更新,经宿主 eternaMemory/selectDomain 端点转发 glue 会话域面);选「无域」
 *   =清除切换回自动解析;
 * - 画像纠正入口(T12-② 显式通道闭环):面板画像卡写入的待预填纠正经
 *   correction 桥读取,点击经官方 inputActions.setDraft 预填输入框(用户回车
 *   发送 → source=explicit → approved)。
 */
import { useEffect, useRef, useState, type ReactElement } from 'react'
import { Icon } from '@eterna/ui/icons'
import type { ConnectionRpc } from './settings.tsx'
import {
  MEMORY_DOMAINS_ENDPOINT, MEMORY_SELECT_DOMAIN_ENDPOINT, MEMORY_SESSION_DOMAIN_ENDPOINT,
} from './endpoints.ts'
import { clearCorrectionPrefill, MEMORY_CORRECTION_EVENT, takeCorrectionPrefill } from './correction.ts'
import type { MemoryCorrectionPrefill } from './correction.ts'
import type { SessionSlotProps } from './client-types.ts'

/** 会话域视图(sessionDomain 端点载荷)。 */
export interface SessionDomainView {
  ok: boolean
  domainKey: string | null
  overridden: boolean
}

/** 域清单条目(domains 端点载荷;chip 列表只收已转正域)。 */
export interface DomainChipItem {
  domainKey: string
  label: string
  registered: number | null
}

export interface DomainChipProps extends SessionSlotProps {
  readonly connection?: ConnectionRpc
  /** 画像纠正待预填的节名展示(桥态;内部直读 window 桥,此处仅测试注入口)。 */
  readonly initialCorrection?: MemoryCorrectionPrefill | null
}

/** chip 主标签(人工切换加「已切换」标记,自动识别不加)。 */
export function domainChipLabel(domainKey: string | null, overridden: boolean): string {
  if (domainKey === null) return '域:未识别'
  return overridden ? `域:${domainKey}(已切换)` : `域:${domainKey}`
}

/**
 * 域列表收窄(chip 菜单只列**已转正**注册域;候选域 registered=null 不进列表,
 * 与 T10 打标归并候选集同口径)。
 */
export function registeredDomainsOf(domains: readonly DomainChipItem[]): readonly DomainChipItem[] {
  return domains.filter(item => item.registered !== null)
}

/** 域 chip(conversation.input.right 的 occupant)。 */
export function DomainChip(props: DomainChipProps): ReactElement | null {
  const { sessionId, locked, inputActions, t, connection } = props
  const [view, setView] = useState<SessionDomainView | null>(null)
  const [domains, setDomains] = useState<readonly DomainChipItem[]>([])
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [correction, setCorrection] = useState<MemoryCorrectionPrefill | null>(
    props.initialCorrection ?? null,
  )
  const rootRef = useRef<HTMLDivElement | null>(null)

  // 当前会话域 + 注册域清单(sessionId 就绪后拉一次;切换后重拉)
  useEffect(() => {
    if (typeof sessionId !== 'string' || connection === undefined) return
    let alive = true
    connection.rpc.call('/api', MEMORY_SESSION_DOMAIN_ENDPOINT, { args: { sessionId } }).then(result => {
      if (alive && result.ok && typeof result.value === 'object' && result.value !== null) {
        setView(result.value as SessionDomainView)
      }
    }).catch(() => { /* 域识别未挂载:chip 保持未识别态,不炸输入行 */ })
    connection.rpc.call('/api', MEMORY_DOMAINS_ENDPOINT, { args: {} }).then(result => {
      if (alive && result.ok && typeof result.value === 'object' && result.value !== null) {
        const value = result.value as { domains?: readonly DomainChipItem[] }
        setDomains(value.domains ?? [])
      }
    }).catch(() => { /* 同上:清单缺席只少列表项 */ })
    return () => { alive = false }
  }, [sessionId, connection])

  // 画像纠正待预填(面板写入桥 + 同 tab 实时事件)
  useEffect(() => {
    const sync = (): void => { setCorrection(takeCorrectionPrefill()) }
    sync()
    window.addEventListener(MEMORY_CORRECTION_EVENT, sync)
    return () => { window.removeEventListener(MEMORY_CORRECTION_EVENT, sync) }
  }, [])

  // 菜单外点击收起(无 modal,轻量交互)
  useEffect(() => {
    if (!open) return
    const onOutside = (event: MouseEvent): void => {
      if (rootRef.current !== null && !rootRef.current.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onOutside)
    return () => { document.removeEventListener('mousedown', onOutside) }
  }, [open])

  if (typeof sessionId !== 'string') return null

  const applyDomain = (domainKey: string | null): void => {
    if (connection === undefined || busy) return
    setBusy(true)
    connection.rpc.call('/api', MEMORY_SELECT_DOMAIN_ENDPOINT, { args: { sessionId, domainKey } })
      .then(result => {
        if (result.ok && typeof result.value === 'object' && result.value !== null) {
          setView(result.value as SessionDomainView)
        }
      })
      .catch(() => { /* 切换失败保持现状 */ })
      .finally(() => { setBusy(false); setOpen(false) })
  }

  const prefillCorrection = (): void => {
    if (inputActions === undefined || correction === null) return
    inputActions.setDraft(correction.text)
    clearCorrectionPrefill()
    setCorrection(null)
  }

  const label = t?.('domain.chip') ?? '域'
  const noneLabel = t?.('domain.none') ?? '无域(自动识别)'
  const disabled = locked === true || busy
  return (
    <div data-eterna-memory="domain-chip" ref={rootRef}>
      {correction !== null && (
        <button
          type="button"
          data-eterna-memory="correction-chip"
          title={correction.text}
          disabled={disabled || inputActions === undefined}
          onClick={prefillCorrection}
        >
          <Icon name="bookmark" size={12} />
          {t?.('domain.correctReady') ?? '画像纠正'}:{correction.section}
        </button>
      )}
      <button
        type="button"
        data-eterna-memory="domain-toggle"
        aria-expanded={open}
        aria-haspopup="menu"
        disabled={disabled}
        onClick={() => { setOpen(value => !value) }}
      >
        <Icon name="domain" size={12} />
        <span data-eterna-memory="domain-label">{domainChipLabel(view?.ok === true ? view.domainKey : null, view?.overridden === true)}</span>
        <Icon name={open ? 'chevron-down' : 'chevron-right'} size={10} />
      </button>
      {open && (
        <div data-eterna-memory="domain-menu" role="menu" aria-label={label}>
          <button type="button" role="menuitem" data-eterna-memory="domain-none"
            disabled={busy} onClick={() => { applyDomain(null) }}>
            {noneLabel}
          </button>
          {registeredDomainsOf(domains).map(item => (
            <button type="button" role="menuitem" key={item.domainKey}
              data-eterna-memory="domain-item" data-eterna-memory-domain={item.domainKey}
              disabled={busy} onClick={() => { applyDomain(item.domainKey) }}>
              {item.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
