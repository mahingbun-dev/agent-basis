/**
 * @eterna/compaction 浏览器半边:设置弹窗分区「上下文压缩」(settings.section)。
 * 上游设计宣言:adding a setting never means editing the shell——本节只读写
 * eternaCompaction SRC 端点(Host 半边 admin-plugin.ts),不改壳、不加独立页。
 *
 * 交互纪律(AGENTS.md §3):配置项合并保存(脏检查+单按钮);保存防重复点击;
 * 校验错误就地 aria-live 反馈;禁用原生 confirm/alert。
 * 令牌纪律(§2):仅 --et-* 语义令牌(经 DSH 桥接跟随产品深浅主题),图标走
 * @eterna/ui/icons,零字面色值(lint-ui-tokens 门禁)。
 */
import { useEffect, useMemo, useState } from 'react'
import { Icon } from '@eterna/ui/icons'
import { injectDesignTokens } from '@eterna/ui'

export const SECTION_ID = 'eterna-compaction.settings'
export const STATE_ENDPOINT = 'eternaCompaction/state'
export const UPDATE_ENDPOINT = 'eternaCompaction/updateConfig'

export const inject = ['slots', 'locale', 'connection']

const NS = 'eterna-compaction'
const zh = {
  section: '上下文压缩',
  loading: '读取中…',
  needAdmin: '上下文压缩设置为管理员专用，当前账号无权查看。',
  needLogin: '登录已过期，请重新登录。',
  loadFailed: '读取失败',
  statusTitle: '运行状态',
  autoOn: '已开启',
  autoOff: '已关闭',
  statCompactions: '自动压缩次数',
  statTokens: '累计压缩上下文',
  statLast: '最近一次压缩',
  never: '从未',
  policyTitle: '压缩策略',
  policyDesc: '改动立即生效并持久化，重启后保留。会话上下文达到触发阈值时，较早历史会被摘要替换，近期原文保留不压缩。',
  fieldAuto: '自动压缩',
  fieldAutoHint: '关闭后仍可手动执行 /compact 命令。',
  fieldThreshold: '触发阈值（上下文占窗口比例）',
  fieldRetain: '原文保留比例（近尾段不压缩）',
  save: '保存策略',
  saving: '保存中…',
  saved: '已保存，立即生效',
  unchanged: '策略未改动',
  invalidRetain: '保留比例必须小于触发阈值',
  invalidRange: '比例需在 1%–95% 之间',
  saveFailed: '保存失败',
}
const en: Record<string, string> = Object.fromEntries(Object.keys(zh).map(key => [key, key]))
const LOCALES = { zh, en }

interface CompactionConfigView {
  auto: boolean
  thresholdRatio: number
  retainRatio: number
}

interface CompactionState {
  ok: boolean
  code?: 'forbidden' | 'unauthorized' | 'invalid'
  message?: string
  config?: CompactionConfigView
  stats?: {
    summaryCount: number
    pruneCount: number
    shadowedTokenCount: number
    lastCompactedAt: string | null
  }
}

interface ConnectionRpc {
  rpc: { call(channel: string, endpoint: string, payload: unknown): Promise<{ ok: boolean; value?: unknown; error?: { code?: string; message?: string } }> }
}

const CSS = `
[data-eterna-compaction] { color: var(--et-fg); font-family: var(--et-font-body); font-size: var(--et-text-body); line-height: var(--et-leading-body); }
[data-eterna-compaction] * { box-sizing: border-box; min-width: 0; }
[data-eterna-compaction] .ec-cards { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: var(--et-space-3); margin: 0 0 var(--et-space-5); }
[data-eterna-compaction] .ec-card { padding: var(--et-space-4); border: 1px solid var(--et-border-soft); border-radius: var(--et-radius-md); background: var(--et-surface); }
[data-eterna-compaction] .ec-kicker { font-size: var(--et-text-micro); color: var(--et-muted); margin: 0 0 6px; }
[data-eterna-compaction] .ec-value { font-size: var(--et-text-lead); line-height: 1.2; font-weight: var(--et-weight-display); font-variant-numeric: tabular-nums; white-space: nowrap; }
[data-eterna-compaction] .ec-form { display: grid; gap: var(--et-space-4); padding: var(--et-space-4); border: 1px solid var(--et-border-soft); border-radius: var(--et-radius-md); background: var(--et-surface); max-width: 560px; }
[data-eterna-compaction] .ec-field { display: grid; gap: 6px; }
[data-eterna-compaction] .ec-label { font-size: var(--et-text-caption); font-weight: var(--et-weight-display); color: var(--et-fg-2); }
[data-eterna-compaction] .ec-hint { font-size: var(--et-text-micro); color: var(--et-muted); }
[data-eterna-compaction] .ec-input { width: 100%; max-width: 180px; padding: 8px 10px; border: 1px solid var(--et-border); border-radius: var(--et-radius-sm); background: var(--et-surface); color: var(--et-fg); font: inherit; font-variant-numeric: tabular-nums; }
[data-eterna-compaction] .ec-input:focus-visible { outline: 2px solid var(--et-accent); outline-offset: 1px; border-color: var(--et-accent); }
[data-eterna-compaction] .ec-check { display: flex; align-items: center; gap: 8px; }
[data-eterna-compaction] .ec-check input[type='checkbox'] { width: 16px; height: 16px; accent-color: var(--et-accent); }
[data-eterna-compaction] .ec-check input[type='checkbox']:focus-visible { outline: 2px solid var(--et-accent); outline-offset: 2px; }
[data-eterna-compaction] .ec-actions { display: flex; align-items: center; gap: var(--et-space-3); flex-wrap: wrap; }
[data-eterna-compaction] .ec-save { display: inline-flex; align-items: center; gap: 6px; padding: 8px 14px; border: 1px solid var(--et-accent); border-radius: var(--et-radius-sm); background: var(--et-accent); color: var(--et-fg); font: inherit; font-weight: var(--et-weight-display); cursor: pointer; }
[data-eterna-compaction] .ec-save:focus-visible { outline: 2px solid var(--et-accent); outline-offset: 2px; }
[data-eterna-compaction] .ec-save:disabled { opacity: 0.55; cursor: not-allowed; }
[data-eterna-compaction] .ec-note { font-size: var(--et-text-caption); color: var(--et-muted); }
[data-eterna-compaction] .ec-note[data-ok='true'] { color: var(--et-fg-2); }
[data-eterna-compaction] .ec-note[data-ok='false'] { color: var(--et-danger); }
[data-eterna-compaction] .ec-empty { padding: var(--et-space-5) 0; color: var(--et-muted); }
[data-eterna-compaction] .ec-head { display: flex; align-items: center; gap: 8px; margin: 0 0 var(--et-space-3); }
[data-eterna-compaction] .ec-head h3 { margin: 0; font-size: var(--et-text-lead); font-weight: var(--et-weight-display); }
@media (max-width: 760px) { [data-eterna-compaction] .ec-cards { grid-template-columns: 1fr 1fr; } }
@media (max-width: 640px) { [data-eterna-compaction] .ec-cards { grid-template-columns: 1fr; } }
@media (prefers-reduced-motion: reduce) { [data-eterna-compaction] * { animation: none !important; transition: none !important; } }
`

function fmtInt(n: number): string {
  return n.toLocaleString('zh-CN')
}

function fmtTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`
  return String(n)
}

function fmtTime(iso: string | null | undefined): string {
  if (iso === null || iso === undefined) return '从未'
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return '从未'
  return date.toLocaleString('zh-CN', { hour12: false })
}

/** percent 输入 ↔ ratio;非法输入返回 null 由调用方就地报错。 */
function toRatio(percent: string): number | null {
  const value = Number(percent)
  if (!Number.isFinite(value) || !Number.isInteger(value) || value < 1 || value > 95) return null
  return value / 100
}

export interface CompactionSectionProps {
  readonly t: (key: string) => string
  /** slot inject 注入(见 apply):与 usage-stats 的 refresh 同款闭包传递。 */
  readonly connection: ConnectionRpc
}

export function CompactionSection(props: CompactionSectionProps): React.JSX.Element {
  const { t, connection } = props
  const [state, setState] = useState<CompactionState | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [auto, setAuto] = useState(false)
  const [threshold, setThreshold] = useState('80')
  const [retain, setRetain] = useState('16')
  const [saving, setSaving] = useState(false)
  const [feedback, setFeedback] = useState<{ ok: boolean | null; text: string }>({ ok: null, text: '' })

  useEffect(() => {
    let alive = true
    connection.rpc.call('/api', STATE_ENDPOINT, { args: {} }).then(result => {
      if (!alive) return
      if (result.ok && typeof result.value === 'object' && result.value !== null) {
        const value = result.value as CompactionState
        setState(value)
        if (value.ok && value.config !== undefined) {
          setAuto(value.config.auto)
          setThreshold(String(Math.round(value.config.thresholdRatio * 100)))
          setRetain(String(Math.round(value.config.retainRatio * 100)))
        }
      } else {
        setLoadError(result.error?.message ?? t('loadFailed'))
      }
    }).catch((error: unknown) => {
      if (alive) setLoadError(error instanceof Error ? error.message : t('loadFailed'))
    })
    return () => { alive = false }
  }, [connection, t])

  const thresholdRatio = useMemo(() => toRatio(threshold), [threshold])
  const retainRatio = useMemo(() => toRatio(retain), [retain])
  const loaded = state?.ok === true && state.config !== undefined
    ? { auto: state.config.auto, thresholdRatio: state.config.thresholdRatio, retainRatio: state.config.retainRatio }
    : null
  const dirty = loaded !== null
    && (loaded.auto !== auto || loaded.thresholdRatio !== thresholdRatio || loaded.retainRatio !== retainRatio)
  const localError = thresholdRatio === null || retainRatio === null
    ? t('invalidRange')
    : retainRatio >= thresholdRatio ? t('invalidRetain') : ''

  const save = async (): Promise<void> => {
    if (!dirty || saving || localError !== '' || thresholdRatio === null || retainRatio === null) return
    setSaving(true)
    setFeedback({ ok: null, text: '' })
    try {
      const result = await connection.rpc.call('/api', UPDATE_ENDPOINT, {
        args: { payload: { auto, thresholdRatio, retainRatio } },
      })
      if (result.ok && typeof result.value === 'object' && result.value !== null) {
        const value = result.value as CompactionState
        if (value.ok && value.config !== undefined) {
          setState(value)
          setAuto(value.config.auto)
          setThreshold(String(Math.round(value.config.thresholdRatio * 100)))
          setRetain(String(Math.round(value.config.retainRatio * 100)))
          setFeedback({ ok: true, text: t('saved') })
        } else {
          setFeedback({ ok: false, text: value.message ?? t('saveFailed') })
        }
      } else {
        setFeedback({ ok: false, text: result.error?.message ?? t('saveFailed') })
      }
    } catch (error: unknown) {
      setFeedback({ ok: false, text: error instanceof Error ? error.message : t('saveFailed') })
    } finally {
      setSaving(false)
    }
  }

  if (loadError !== null) {
    return <div data-eterna-compaction><div className="ec-empty">{t('loadFailed')}：{loadError}</div></div>
  }
  if (state === null) {
    return <div data-eterna-compaction><div className="ec-empty">{t('loading')}</div></div>
  }
  if (!state.ok) {
    const text = state.code === 'unauthorized'
      ? t('needLogin')
      : state.code === 'forbidden' ? t('needAdmin') : `${t('loadFailed')}：${state.message ?? ''}`
    return <div data-eterna-compaction><div className="ec-empty">{text}</div></div>
  }
  const stats = state.stats
  return (
    <div data-eterna-compaction>
      <div className="ec-head"><Icon name="gauge" size={16} /><h3>{t('statusTitle')}</h3></div>
      <div className="ec-cards">
        <div className="ec-card" data-eterna-stat="auto">
          <div className="ec-kicker">{t('fieldAuto')}</div>
          <div className="ec-value">{state.config?.auto === true ? t('autoOn') : t('autoOff')}</div>
        </div>
        <div className="ec-card">
          <div className="ec-kicker">{t('statCompactions')}</div>
          <div className="ec-value">{stats === undefined ? '—' : fmtInt(stats.summaryCount)}</div>
        </div>
        <div className="ec-card">
          <div className="ec-kicker">{t('statTokens')}</div>
          <div className="ec-value">{stats === undefined ? '—' : fmtTokens(stats.shadowedTokenCount)}</div>
        </div>
        <div className="ec-card">
          <div className="ec-kicker">{t('statLast')}</div>
          <div className="ec-value">{stats === undefined ? '—' : fmtTime(stats.lastCompactedAt)}</div>
        </div>
      </div>
      <div className="ec-head"><h3>{t('policyTitle')}</h3></div>
      <p className="ec-note" style={{ margin: '0 0 var(--et-space-3)' }}>{t('policyDesc')}</p>
      <form className="ec-form" onSubmit={event => { event.preventDefault() }}>
        <div className="ec-field">
          <span className="ec-check">
            <input id="ec-auto" type="checkbox" checked={auto} onChange={event => { setAuto(event.target.checked) }} />
            <label className="ec-label" htmlFor="ec-auto">{t('fieldAuto')}</label>
          </span>
          <span className="ec-hint">{t('fieldAutoHint')}</span>
        </div>
        <div className="ec-field">
          <label className="ec-label" htmlFor="ec-threshold">{t('fieldThreshold')}</label>
          <input id="ec-threshold" className="ec-input" type="number" min={1} max={95} step={1}
            value={threshold} onChange={event => { setThreshold(event.target.value) }} aria-describedby="ec-threshold-hint" />
          <span className="ec-hint" id="ec-threshold-hint">{
            thresholdRatio === null ? t('invalidRange') : `当前 ${Math.round(thresholdRatio * 100)}%`
          }</span>
        </div>
        <div className="ec-field">
          <label className="ec-label" htmlFor="ec-retain">{t('fieldRetain')}</label>
          <input id="ec-retain" className="ec-input" type="number" min={1} max={95} step={1}
            value={retain} onChange={event => { setRetain(event.target.value) }} aria-describedby="ec-retain-hint" />
          <span className="ec-hint" id="ec-retain-hint">{
            retainRatio === null ? t('invalidRange') : `当前 ${Math.round(retainRatio * 100)}%`
          }</span>
        </div>
        <div className="ec-actions">
          <button type="button" className="ec-save" disabled={!dirty || saving || localError !== ''}
            onClick={() => { void save() }}>
            <Icon name="check" size={14} />{saving ? t('saving') : t('save')}
          </button>
          <span className="ec-note" data-ok={feedback.ok === null ? undefined : String(feedback.ok)} role="status" aria-live="polite">{
            localError !== '' ? localError : feedback.text !== '' ? feedback.text : !dirty && loaded !== null ? t('unchanged') : ''
          }</span>
        </div>
      </form>
    </div>
  )
}

interface ClientContext {
  readonly slots: { inject(slot: string, contribute: () => (() => void) | Generator<() => void>): () => void; register(options: Record<string, unknown>, component: unknown): () => void }
  readonly locale: { register(ns: string, dictionaries: Record<string, Record<string, string>>): () => void; bind(ns: string): (key: string) => string }
  readonly connection: ConnectionRpc
}

function injectCompactionStyles(doc: Document = document): void {
  injectDesignTokens({ bridge: true, doc })
  if (doc.getElementById('eterna-compaction-styles') !== null) return
  const style = doc.createElement('style')
  style.id = 'eterna-compaction-styles'
  style.textContent = CSS
  doc.head.append(style)
}

export function apply(ctx: ClientContext): () => void {
  injectCompactionStyles()
  const disposeLocale = ctx.locale.register(NS, LOCALES)
  const t = ctx.locale.bind(NS)
  ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section',
    id: SECTION_ID,
    order: 44,
    locale: NS,
    inject: () => ({ t, connection: ctx.connection }),
    label: () => t('section'),
  }, CompactionSection))
  return disposeLocale
}
