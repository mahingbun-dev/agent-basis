/**
 * @eterna/compaction 浏览器半边:设置弹窗分区「上下文压缩」(settings.section)。
 * 上游设计宣言:adding a setting never means editing the shell——本节只读写
 * eternaCompaction SRC 端点(Host 半边 admin-plugin.ts),不改壳、不加独立页。
 *
 * 2026-11-13 C9(22 号 §4)扩展:触发阈值收窄为三档单选(0.7/0.8/0.9)、原文保留
 * 比例改 8–24% 滑杆、新增摘要模型只读行(state 汇出)与运行观测行(L2 清理/
 * 摘要校验拒绝/熔断保护计数)。stale 开关按 22 号默认隐藏(stale 是插件级配置
 * 不在 overrides 白名单,21 号 Q2 未拍板前不暴露控件)。
 *
 * 交互纪律(AGENTS.md §3):配置项合并保存(脏检查+单按钮);保存防重复点击;
 * 校验错误就地 aria-live 反馈;禁用原生 confirm/alert。
 * 令牌纪律(§2):仅 --et-* 语义令牌(经 DSH 桥接跟随产品深浅主题),图标走
 * @eterna/ui/icons,零字面色值(lint-ui-tokens 门禁)。
 */
import { useEffect, useState, type ReactElement } from 'react'
import { Icon } from '@eterna/ui/icons'
import { injectDesignTokens } from '@eterna/ui'
import {
  CompactionAnnouncementTail,
  compactionAnnouncementDefinition,
} from './announcement.tsx'

export const SECTION_ID = 'eterna-compaction.settings'
export const STATE_ENDPOINT = 'eternaCompaction/state'
export const UPDATE_ENDPOINT = 'eternaCompaction/updateConfig'

export const inject = ['slots', 'locale', 'connection', 'layout', 'uiConversation']

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
  observeLine: '摘要校验拒绝 {invalid} 次 · 陈旧清理 {stale} 次（回收 ~{staleSaved} tokens）· 熔断保护 {refill} 次',
  policyTitle: '压缩策略',
  policyDesc: '改动立即生效并持久化，重启后保留。会话上下文达到触发阈值时，较早历史会被摘要替换，近期原文保留不压缩。',
  fieldAuto: '自动压缩',
  fieldAutoHint: '关闭后仍可手动执行 /compact 命令。',
  fieldThreshold: '触发阈值（上下文占窗口比例）',
  tier70: '70%（较早压缩）',
  tier80: '80%（默认）',
  tier90: '90%（较晚压缩）',
  pickTier: '请选择一档触发阈值',
  fieldRetain: '原文保留比例（近尾段不压缩）',
  retainCustom: '当前配置 {value}%，超出 {min}%–{max}% 可调范围，拖动滑杆即覆盖',
  fieldSummaryModel: '摘要模型',
  summaryModelFollow: '跟随会话模型（未配置专属摘要模型）',
  save: '保存策略',
  saving: '保存中…',
  saved: '已保存，立即生效',
  unchanged: '策略未改动',
  invalidRetain: '保留比例必须小于触发阈值',
  saveFailed: '保存失败',
  announcementLine: '上下文已压缩',
  announcementDetail: '查看详情',
}
const en: Record<string, string> = Object.fromEntries(Object.keys(zh).map(key => [key, key]))
export const LOCALES = { zh, en }

interface CompactionConfigView {
  auto: boolean
  thresholdRatio: number
  retainRatio: number
  /** 专属摘要模型(C8b 落值后由引擎写入 state 文件;缺省 null 对=跟随会话模型)。 */
  summarization?: { provider: string | null; model: string | null }
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
    invalidSummaryCount: number
    stalePruneCount: number
    staleSavedTokens: number
    rapidRefillCount: number
    lastRapidRefillAt: string | null
  }
}

interface ConnectionRpc {
  rpc: { call(channel: string, endpoint: string, payload: unknown): Promise<{ ok: boolean; value?: unknown; error?: { code?: string; message?: string } }> }
}

// ── C9 表单纯逻辑(导出供单测;渲染依赖 react-dom,由 dsh web 壳运行时提供) ──

/** 三档触发阈值(22 号 §4-C9:0.7/0.8/0.9 映射 thresholdRatio)。 */
export const THRESHOLD_TIERS = [0.7, 0.8, 0.9] as const

/** 原文保留比例滑杆边界(21 号 C3 表:8–24%)。 */
export const RETAIN_MIN_PERCENT = 8
export const RETAIN_MAX_PERCENT = 24

/** 浮点同档判定:overrides/profile 落值可能带 1e-15 级漂移。 */
export function resolveThresholdTier(ratio: number): number | null {
  for (const tier of THRESHOLD_TIERS) {
    if (Math.abs(ratio - tier) < 1e-9) return tier
  }
  return null
}

/** ratio → 整数百分位(四舍五入;超范围存量值保留真值供脏检查,渲染层钳制显示)。 */
export function toRetainPercent(ratio: number): number {
  return Math.round(ratio * 100)
}

/** 表单已加载基准(设置分区读到的生效策略)。 */
export interface LoadedPolicy {
  auto: boolean
  thresholdRatio: number
  retainRatio: number
}

/** 表单待存状态;thresholdTier 为 null 表示未选档(=阈值无待存变更)。 */
export interface PolicyFormState {
  auto: boolean
  thresholdTier: number | null
  retainPercent: number
}

/** 合并保存脏检查(AGENTS.md §3):三键逐项比对,未选档不视为阈值变更。 */
export function isPolicyDirty(loaded: LoadedPolicy, form: PolicyFormState): boolean {
  if (loaded.auto !== form.auto) return true
  if (form.thresholdTier !== null && Math.abs(loaded.thresholdRatio - form.thresholdTier) >= 1e-9) return true
  if (toRetainPercent(loaded.retainRatio) !== form.retainPercent) return true
  return false
}

/** `{key}` 占位符填充(观测行/超范围提示的变量插值)。 */
export function fill(template: string, vars: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (whole, key: string) => vars[key] ?? whole)
}

const CSS = `
[data-eterna-compaction] { color: var(--et-fg); font-family: var(--et-font-body); font-size: var(--et-text-body); line-height: var(--et-leading-body); }
[data-eterna-compaction] * { box-sizing: border-box; min-width: 0; }
[data-eterna-compaction] .ec-cards { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: var(--et-space-3); margin: 0 0 var(--et-space-3); }
[data-eterna-compaction] .ec-card { padding: var(--et-space-4); border: 1px solid var(--et-border-soft); border-radius: var(--et-radius-md); background: var(--et-surface); }
[data-eterna-compaction] .ec-kicker { font-size: var(--et-text-micro); color: var(--et-muted); margin: 0 0 6px; }
[data-eterna-compaction] .ec-value { font-size: var(--et-text-lead); line-height: 1.2; font-weight: var(--et-weight-display); font-variant-numeric: tabular-nums; white-space: nowrap; }
[data-eterna-compaction] .ec-observe { font-size: var(--et-text-micro); color: var(--et-muted); margin: 0 0 var(--et-space-5); }
[data-eterna-compaction] .ec-form { display: grid; gap: var(--et-space-4); padding: var(--et-space-4); border: 1px solid var(--et-border-soft); border-radius: var(--et-radius-md); background: var(--et-surface); max-width: 560px; }
[data-eterna-compaction] .ec-field { display: grid; gap: 6px; }
[data-eterna-compaction] .ec-label { font-size: var(--et-text-caption); font-weight: var(--et-weight-display); color: var(--et-fg-2); }
[data-eterna-compaction] .ec-hint { font-size: var(--et-text-micro); color: var(--et-muted); }
[data-eterna-compaction] .ec-radio { display: flex; align-items: center; gap: 8px; font-size: var(--et-text-caption); color: var(--et-fg-2); cursor: pointer; }
[data-eterna-compaction] .ec-radio input[type='radio'] { width: 16px; height: 16px; margin: 0; accent-color: var(--et-accent); }
[data-eterna-compaction] .ec-radio input[type='radio']:focus-visible { outline: 2px solid var(--et-accent); outline-offset: 2px; }
[data-eterna-compaction] .ec-slider-row { display: flex; align-items: center; gap: var(--et-space-3); }
[data-eterna-compaction] .ec-slider { flex: 1; max-width: 280px; margin: 0; accent-color: var(--et-accent); }
[data-eterna-compaction] .ec-slider:focus-visible { outline: 2px solid var(--et-accent); outline-offset: 2px; }
[data-eterna-compaction] .ec-slider-output { font-size: var(--et-text-caption); color: var(--et-fg-2); font-variant-numeric: tabular-nums; }
[data-eterna-compaction] .ec-readonly { padding-top: var(--et-space-3); border-top: 1px dashed var(--et-border-soft); }
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
/* M-C4 公告行(照 memory sources-row 形态;--et-* 令牌跟随深浅主题) */
[data-eterna-compaction='announcement-row'] { margin: var(--et-space-2) 0; font-family: var(--et-font-body); font-size: var(--et-text-micro); color: var(--et-muted); }
[data-eterna-compaction='announcement-toggle'] { display: inline-flex; align-items: center; gap: 4px; padding: 2px 6px; border: 0; background: none; color: var(--et-muted); font: inherit; cursor: pointer; }
[data-eterna-compaction='announcement-toggle']:focus-visible { outline: 2px solid var(--et-accent); outline-offset: 1px; }
[data-eterna-compaction='announcement-toggle']:hover { color: var(--et-fg-2); }
[data-eterna-compaction='announcement-saved'] { font-weight: var(--et-weight-display); color: var(--et-fg-2); font-variant-numeric: tabular-nums; }
[data-eterna-compaction='announcement-list'] { margin: 4px 0 0; padding: 0 0 0 18px; display: grid; gap: 2px; list-style: none; }
[data-eterna-compaction='announcement-jump'] { display: inline-flex; align-items: center; gap: 4px; padding: 2px 0; border: 0; background: none; color: var(--et-accent); font: inherit; cursor: pointer; }
[data-eterna-compaction='announcement-jump']:focus-visible { outline: 2px solid var(--et-accent); outline-offset: 1px; }
`
export { CSS }

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

/** 表单初值:按生效策略求档位与保留百分位。 */
function formStateOf(config: CompactionConfigView): { auto: boolean; thresholdTier: number | null; retainPercent: number } {
  return {
    auto: config.auto,
    thresholdTier: resolveThresholdTier(config.thresholdRatio),
    retainPercent: toRetainPercent(config.retainRatio),
  }
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
  const [thresholdTier, setThresholdTier] = useState<number | null>(null)
  const [retainPercent, setRetainPercent] = useState(16)
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
          const form = formStateOf(value.config)
          setAuto(form.auto)
          setThresholdTier(form.thresholdTier)
          setRetainPercent(form.retainPercent)
        }
      } else {
        setLoadError(result.error?.message ?? t('loadFailed'))
      }
    }).catch((error: unknown) => {
      if (alive) setLoadError(error instanceof Error ? error.message : t('loadFailed'))
    })
    return () => { alive = false }
  }, [connection, t])

  const loaded = state?.ok === true && state.config !== undefined
    ? {
        auto: state.config.auto,
        thresholdRatio: state.config.thresholdRatio,
        retainRatio: state.config.retainRatio,
      }
    : null
  const loadedTier = loaded === null ? null : resolveThresholdTier(loaded.thresholdRatio)
  const loadedRetainPercent = loaded === null ? null : toRetainPercent(loaded.retainRatio)
  const dirty = loaded !== null
    && isPolicyDirty(loaded, { auto, thresholdTier, retainPercent })
  const localError = thresholdTier === null
    ? t('pickTier')
    : retainPercent / 100 >= thresholdTier ? t('invalidRetain') : ''

  const thresholdHint = thresholdTier === null
    ? loaded !== null && loadedTier === null
      ? `当前 ${Math.round(loaded.thresholdRatio * 100)}% 为非预设档位，选择任一档位即覆盖`
      : t('pickTier')
    : loadedTier === thresholdTier
      ? `当前 ${Math.round(thresholdTier * 100)}%`
      : `将改为 ${Math.round(thresholdTier * 100)}%`
  const retainHint = retainPercent !== loadedRetainPercent
    ? `将改为 ${retainPercent}%`
    : loadedRetainPercent !== null && (loadedRetainPercent < RETAIN_MIN_PERCENT || loadedRetainPercent > RETAIN_MAX_PERCENT)
      ? fill(t('retainCustom'), {
          value: String(loadedRetainPercent),
          min: String(RETAIN_MIN_PERCENT),
          max: String(RETAIN_MAX_PERCENT),
        })
      : `当前 ${retainPercent}%`

  const summarization = state?.config?.summarization
  const summarizationText = summarization !== undefined
    && summarization.provider !== null && summarization.model !== null
    ? `${summarization.provider}/${summarization.model}`
    : t('summaryModelFollow')

  const save = async (): Promise<void> => {
    if (!dirty || saving || localError !== '' || thresholdTier === null) return
    setSaving(true)
    setFeedback({ ok: null, text: '' })
    try {
      const result = await connection.rpc.call('/api', UPDATE_ENDPOINT, {
        args: { payload: { auto, thresholdRatio: thresholdTier, retainRatio: retainPercent / 100 } },
      })
      if (result.ok && typeof result.value === 'object' && result.value !== null) {
        const value = result.value as CompactionState
        if (value.ok && value.config !== undefined) {
          setState(value)
          const form = formStateOf(value.config)
          setAuto(form.auto)
          setThresholdTier(form.thresholdTier)
          setRetainPercent(form.retainPercent)
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
  const thresholdInputValue = (tier: number): string => `ec-threshold-${Math.round(tier * 100)}`
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
      {stats !== undefined && (
        <p className="ec-observe">{fill(t('observeLine'), {
          invalid: fmtInt(stats.invalidSummaryCount),
          stale: fmtInt(stats.stalePruneCount),
          staleSaved: fmtTokens(stats.staleSavedTokens),
          refill: fmtInt(stats.rapidRefillCount),
        })}</p>
      )}
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
        <div className="ec-field" role="radiogroup" aria-labelledby="ec-threshold-label" aria-describedby="ec-threshold-hint">
          <span className="ec-label" id="ec-threshold-label">{t('fieldThreshold')}</span>
          {THRESHOLD_TIERS.map(tier => (
            <label className="ec-radio" key={tier} htmlFor={thresholdInputValue(tier)}>
              <input id={thresholdInputValue(tier)} type="radio" name="ec-threshold"
                checked={thresholdTier === tier} onChange={() => { setThresholdTier(tier) }} />
              <span>{t(`tier${Math.round(tier * 100)}`)}</span>
            </label>
          ))}
          <span className="ec-hint" id="ec-threshold-hint">{thresholdHint}</span>
        </div>
        <div className="ec-field">
          <label className="ec-label" htmlFor="ec-retain">{t('fieldRetain')}</label>
          <div className="ec-slider-row">
            <input id="ec-retain" className="ec-slider" type="range"
              min={RETAIN_MIN_PERCENT} max={RETAIN_MAX_PERCENT} step={1}
              value={Math.min(RETAIN_MAX_PERCENT, Math.max(RETAIN_MIN_PERCENT, retainPercent))}
              onChange={event => { setRetainPercent(Number(event.target.value)) }}
              aria-describedby="ec-retain-hint" aria-valuetext={`${retainPercent}%`} />
            <output className="ec-slider-output" htmlFor="ec-retain">{retainPercent}%</output>
          </div>
          <span className="ec-hint" id="ec-retain-hint">{retainHint}</span>
        </div>
        <div className="ec-field ec-readonly">
          <span className="ec-label">{t('fieldSummaryModel')}</span>
          <span className="ec-note" data-ok="true">{summarizationText}</span>
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
  /** M-C4 公告行:Conversation 事件累计器注册(memory sources 同款结构子集)。 */
  readonly uiConversation?: { readonly events: { register(definition: unknown): () => void } }
  /** M-C4 公告行「查看详情」跳转(memory sources 同款结构子集)。 */
  readonly layout?: { readonly selectMainPanel: (key: string) => void }
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
  // M-C4 公告行(21 号 §3-C2「压缩可感知」):数据面=会话事件累计器(compaction/
  // start+summary 按 compactionId 归组),呈现面=turnTail 槽位(无数据不挂载)。
  // uiConversation/layout 缺席时静默降级为仅设置分区(老宿主兼容,鸭子结构)。
  if (ctx.uiConversation !== undefined) {
    ctx.uiConversation.events.register(compactionAnnouncementDefinition)
    ctx.slots.inject('conversation.chat.turnTail', () => ctx.slots.register({
      name: 'conversation.chat.turnTail',
      id: 'eterna-compaction.announcement',
      locale: NS,
      inject: () => ({
        t,
        ...(ctx.layout !== undefined ? { openPanel: (): void => { ctx.layout!.selectMainPanel(PANEL_MAIN_KEY) } } : {}),
      }),
    }, CompactionAnnouncementTailEntry))
  }
  return disposeLocale
}

/** 基座面板 main 键(与 @eterna/panel 的 PANEL_ID 字面契约;P3 视图落地前跳空面)。 */
const PANEL_MAIN_KEY = 'eterna-panel'

/** turnTail 条目组件:官方 owner 摊平成 announcement.tsx 的 props 形状。 */
function CompactionAnnouncementTailEntry(props: {
  readonly turn: { readonly turn: number; readonly data: { get(key: string): unknown } }
  readonly t?: (key: string) => string
  readonly openPanel?: () => void
}): ReactElement | null {
  return CompactionAnnouncementTail(props)
}
