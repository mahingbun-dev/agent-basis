/**
 * @eterna/usage-stats 浏览器半边:侧栏「用量统计」入口(sidebar.panellist)+
 * main keyed 面板(总览卡/按天趋势/按模型表)。数据经 Connection RPC 拉
 * eternaUsageStats/stats(admin=全局,普通用户=本人——Host 端按 principal 裁剪)。
 *
 * 2026-11-11 统一设计语言:Webflow 令牌(@eterna/ui)、960 容器、32px 页面标题、
 * 4px 卡片、连续 14 天时间轴、表格滚动兜底;不再使用不存在的 DSH 令牌。
 */
import { IconDataOutlineRegular } from '@deepseek-ai/dsh-client-ui-primitives'
import { injectDesignTokens } from '@eterna/ui'

export const PANEL_ID = 'eterna-usage-stats'
export const STATS_ENDPOINT = 'eternaUsageStats/stats'

export const inject = ['slots', 'locale', 'layout', 'connection']

const NS = 'eterna-usage-stats'
const zh = { panel: '用量统计' }
const en = { panel: 'Usage Stats' }

const CSS = `
[data-eterna-usage-stats] {
  box-sizing: border-box;
  height: 100%;
  overflow-y: auto;
  overflow-x: hidden;
  scrollbar-gutter: stable;
  max-width: var(--et-container-panel);
  margin: 0 auto;
  padding: 48px 32px 96px;
  color: var(--et-fg);
  font-family: var(--et-font-body);
  font-size: var(--et-text-caption);
  font-weight: var(--et-weight-body);
  line-height: var(--et-leading-body);
}
[data-eterna-usage-stats] * { box-sizing: border-box; min-width: 0; }
[data-eterna-usage-stats] .us-head { display: flex; align-items: baseline; gap: 12px; flex-wrap: wrap; margin: 0 0 24px; }
[data-eterna-usage-stats] .us-title { margin: 0; font-size: var(--et-text-h2); line-height: 1.15; font-weight: var(--et-weight-display); letter-spacing: 0; }
[data-eterna-usage-stats] .us-scope { font-size: var(--et-text-caption); color: var(--et-muted); }
[data-eterna-usage-stats] .us-cards { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: var(--et-space-4); margin-bottom: var(--et-space-8); }
[data-eterna-usage-stats] .us-card { padding: var(--et-space-4); border: 1px solid var(--et-border-soft); border-radius: var(--et-radius-md); background: var(--et-surface); }
[data-eterna-usage-stats] .us-kicker { font-size: var(--et-text-micro); line-height: 1.3; color: var(--et-muted); margin-bottom: 6px; }
[data-eterna-usage-stats] .us-value { font-size: var(--et-text-h2); line-height: 1.15; font-weight: var(--et-weight-display); font-variant-numeric: tabular-nums; color: var(--et-fg); }
[data-eterna-usage-stats] .us-section { margin-top: var(--et-space-8); }
[data-eterna-usage-stats] .us-section-title { margin: 0 0 var(--et-space-3); font-size: var(--et-text-lead); line-height: 1.3; font-weight: var(--et-weight-display); color: var(--et-fg); }
[data-eterna-usage-stats] .us-chart { display: flex; align-items: flex-end; gap: 4px; height: 136px; padding: 12px 12px 0; border: 1px solid var(--et-border-soft); border-radius: var(--et-radius-md); background: var(--et-surface); }
[data-eterna-usage-stats] .us-day { flex: 1 1 0; display: flex; flex-direction: column; justify-content: flex-end; height: 100%; min-width: 0; }
[data-eterna-usage-stats] .us-bar { width: 100%; background: var(--et-accent); border-radius: var(--et-radius-sm) var(--et-radius-sm) 0 0; min-height: 2px; }
[data-eterna-usage-stats] .us-bar[data-empty='true'] { background: var(--et-border); }
[data-eterna-usage-stats] .us-chart-label { margin-top: 6px; font-size: 10px; line-height: 1.3; color: var(--et-meta); text-align: center; font-variant-numeric: tabular-nums; white-space: nowrap; }
[data-eterna-usage-stats] .us-table-wrap { width: 100%; overflow-x: auto; border: 1px solid var(--et-border-soft); border-radius: var(--et-radius-md); background: var(--et-surface); }
[data-eterna-usage-stats] table { width: 100%; border-collapse: collapse; font-size: var(--et-text-caption); }
[data-eterna-usage-stats] th { text-align: left; padding: 10px 14px; border-bottom: 1px solid var(--et-border); color: var(--et-muted); font-size: var(--et-text-micro); font-weight: var(--et-weight-display); white-space: nowrap; }
[data-eterna-usage-stats] td { padding: 10px 14px; border-bottom: 1px solid var(--et-border-soft); color: var(--et-fg-2); font-variant-numeric: tabular-nums; }
[data-eterna-usage-stats] tr:last-child td { border-bottom: 0; }
[data-eterna-usage-stats] .us-empty { padding: 64px 24px; text-align: center; color: var(--et-muted); }
[data-eterna-usage-stats] .us-error { padding: 24px 0; color: var(--et-danger); }
@media (max-width: 640px) {
  [data-eterna-usage-stats] { padding: 24px 16px 48px; }
  [data-eterna-usage-stats] .us-title { font-size: 28px; }
  [data-eterna-usage-stats] .us-cards { grid-template-columns: 1fr 1fr; gap: var(--et-space-3); }
  [data-eterna-usage-stats] .us-card { padding: 12px; }
  [data-eterna-usage-stats] .us-value { font-size: var(--et-text-h3); }
  [data-eterna-usage-stats] .us-chart { height: 112px; padding: 8px 8px 0; }
  [data-eterna-usage-stats] .us-day:not(:nth-child(3n+1)) .us-chart-label { visibility: hidden; }
}
`

interface Aggregates {
  total: { inputTokens: number; outputTokens: number; cacheReadTokens: number; cacheWriteTokens: number; turns: number; sessions: number }
  byDay: Record<string, { inputTokens: number; outputTokens: number; turns: number }>
  byModel: Record<string, { inputTokens: number; outputTokens: number; cacheReadTokens: number; turns: number }>
  byAccount?: Record<string, { inputTokens: number; outputTokens: number; turns: number; sessions: number }>
}

interface StatsState {
  status: 'loading' | 'ready' | 'error'
  scope?: 'global' | 'self'
  aggregates?: Aggregates
  message?: string
}

function fmt(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`
  return String(n)
}

/** 连续 14 天轴:以数据中最后一天(无数据则今天)为终点,缺失日补 0。 */
function lastDays(byDay: Aggregates['byDay'], count = 14): Array<{ day: string; value: number }> {
  const keys = Object.keys(byDay).sort()
  const endKey = keys.length > 0 ? keys[keys.length - 1] as string : new Date().toISOString().slice(0, 10)
  const end = new Date(`${endKey}T00:00:00Z`)
  const out: Array<{ day: string; value: number }> = []
  for (let offset = count - 1; offset >= 0; offset -= 1) {
    const date = new Date(end)
    date.setUTCDate(end.getUTCDate() - offset)
    const day = date.toISOString().slice(0, 10)
    const bucket = byDay[day]
    out.push({ day, value: bucket === undefined ? 0 : bucket.inputTokens + bucket.outputTokens })
  }
  return out
}

export interface UsageStatsPageProps {
  /** hooks 份额绑定(stats → useStats,渲染器 standardHookPropName 约定)。 */
  readonly useStats: <S>(selector: (state: StatsState) => S) => S
  readonly refresh: () => void
  readonly t: (key: string) => string
}

export function UsageStatsPage(props: UsageStatsPageProps): React.JSX.Element {
  const stats = props.useStats(s => s)
  if (stats.status === 'loading') return <div data-eterna-usage-stats><div className="us-empty">加载中…</div></div>
  if (stats.status === 'error') return <div data-eterna-usage-stats><div className="us-error">加载失败:{stats.message}</div></div>
  const a = stats.aggregates
  if (a === undefined || a.total.sessions === 0) {
    return (
      <div data-eterna-usage-stats>
        <div className="us-head"><h1 className="us-title">{props.t('panel')}</h1></div>
        <div className="us-empty">还没有会话用量数据</div>
      </div>
    )
  }
  const billed = a.total.inputTokens + a.total.cacheReadTokens + a.total.cacheWriteTokens + a.total.outputTokens
  const hitRate = a.total.cacheReadTokens + a.total.inputTokens > 0
    ? `${((a.total.cacheReadTokens / (a.total.cacheReadTokens + a.total.inputTokens)) * 100).toFixed(1)}%` : '—'
  const days = lastDays(a.byDay)
  const maxDay = Math.max(1, ...days.map(day => day.value))
  const models = Object.entries(a.byModel).sort(([, b1], [, b2]) => (b2.inputTokens + b2.outputTokens) - (b1.inputTokens + b1.outputTokens))
  return (
    <div data-eterna-usage-stats>
      <div className="us-head">
        <h1 className="us-title">{props.t('panel')}</h1>
        <span className="us-scope">{stats.scope === 'self' ? '(本人)' : '(全局)'}</span>
      </div>
      <div className="us-cards">
        <div className="us-card" data-eterna-stat="total">
          <div className="us-kicker">总 Token</div>
          <div className="us-value">{fmt(billed)}</div>
        </div>
        <div className="us-card">
          <div className="us-kicker">输入 / 输出</div>
          <div className="us-value">{fmt(a.total.inputTokens)} / {fmt(a.total.outputTokens)}</div>
        </div>
        <div className="us-card">
          <div className="us-kicker">缓存命中率</div>
          <div className="us-value">{hitRate}</div>
        </div>
        <div className="us-card">
          <div className="us-kicker">会话 / 轮次</div>
          <div className="us-value">{a.total.sessions} / {a.total.turns}</div>
        </div>
      </div>
      <section className="us-section" aria-label="近 14 天趋势">
        <h2 className="us-section-title">近 14 天趋势(输入+输出)</h2>
        <div className="us-chart" data-eterna-trend>
          {days.map(day => (
            <div key={day.day} className="us-day" title={`${day.day}: ${day.value}`}>
              <div
                className="us-bar"
                data-empty={day.value === 0 ? 'true' : undefined}
                style={{ height: day.value === 0 ? 2 : `${Math.max(4, (day.value / maxDay) * 100)}%` }}
              />
              <div className="us-chart-label">{day.day.slice(5)}</div>
            </div>
          ))}
        </div>
      </section>
      <section className="us-section" aria-label="按模型">
        <h2 className="us-section-title">按模型</h2>
        <div className="us-table-wrap">
          <table data-eterna-model-table>
            <thead><tr><th>模型</th><th>输入</th><th>输出</th><th>缓存读</th><th>轮次</th></tr></thead>
            <tbody>
              {models.map(([model, v]) => (
                <tr key={model}>
                  <td>{model}</td>
                  <td>{fmt(v.inputTokens)}</td>
                  <td>{fmt(v.outputTokens)}</td>
                  <td>{fmt(v.cacheReadTokens)}</td>
                  <td>{v.turns}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  )
}

interface ClientContext {
  readonly slots: { inject(slot: string, contribute: () => (() => void) | Generator<() => void>): () => void; register(options: Record<string, unknown>, component: unknown): () => void }
  readonly locale: { register(ns: string, dictionaries: Record<string, Record<string, string>>): () => void; bind(ns: string): (key: string) => string }
  readonly layout: { selectMainPanel(key: string): void }
  readonly connection: { rpc: { call(channel: string, endpoint: string, payload: unknown): Promise<{ ok: boolean; value?: unknown; error?: { code?: string; message?: string } }> } }
}

function injectUsageStyles(doc: Document = document): void {
  injectDesignTokens({ bridge: true, doc })
  if (doc.getElementById('eterna-usage-styles') !== null) return
  const style = doc.createElement('style')
  style.id = 'eterna-usage-styles'
  style.textContent = CSS
  doc.head.append(style)
}

export function apply(ctx: ClientContext): () => void {
  injectUsageStyles()
  const disposeLocale = ctx.locale.register(NS, { zh, en })
  const t = ctx.locale.bind(NS)
  let state: StatsState = { status: 'loading' }
  const listeners = new Set<() => void>()
  const source = {
    getSnapshot: (): StatsState => state,
    subscribe: (listener: () => void): (() => void) => { listeners.add(listener); return () => { listeners.delete(listener) } },
  }
  const publish = (next: StatsState): void => { state = next; for (const listener of listeners) listener() }
  const refresh = (): void => {
    ctx.connection.rpc.call('/api', STATS_ENDPOINT, { args: {} }).then(result => {
      if (result.ok && typeof result.value === 'object' && result.value !== null) {
        const value = result.value as { scope?: 'global' | 'self'; aggregates?: Aggregates }
        publish({ status: 'ready', scope: value.scope ?? 'global', aggregates: value.aggregates ?? { total: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, turns: 0, sessions: 0 }, byDay: {}, byModel: {} } })
      } else {
        publish({ status: 'error', message: result.error?.message ?? result.error?.code ?? 'unknown' })
      }
    }).catch((error: unknown) => {
      publish({ status: 'error', message: error instanceof Error ? error.message : String(error) })
    })
  }
  refresh()
  ctx.slots.inject('main', () => ctx.slots.register({
    name: 'main', key: PANEL_ID, locale: NS,
    inject: () => ({ hooks: { stats: source }, refresh, t }),
  }, UsageStatsPage))
  ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({
    name: 'sidebar.panellist', id: PANEL_ID, order: 23, locale: NS, label: () => t('panel'),
  }, function PanelIcon() {
    return <IconDataOutlineRegular size={16} />
  }))
  return disposeLocale
}
