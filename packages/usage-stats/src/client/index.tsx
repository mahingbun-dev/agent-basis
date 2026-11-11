/**
 * @eterna/usage-stats 浏览器半边:侧栏「用量统计」入口(sidebar.panellist)+
 * main keyed 面板(总览卡/按天趋势/按模型表)。数据经 Connection RPC 拉
 * eternaUsageStats/stats(admin=全局,普通用户=本人——Host 端按 principal 裁剪)。
 * UI 纪律:--dsw-alias-* 语义令牌/中文/空数据态/640px 断点。
 */
import { useState } from 'react'

export const PANEL_ID = 'eterna-usage-stats'
export const STATS_ENDPOINT = 'eternaUsageStats/stats'

export const inject = ['slots', 'locale', 'layout', 'connection']

const NS = 'eterna-usage-stats'
const zh = { panel: '用量统计' }
const en = { panel: 'Usage Stats' }

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

const styles: Record<string, React.CSSProperties> = {
  page: { padding: 20, overflowY: 'auto', height: '100%', color: 'var(--dsw-alias-foreground-primary)', display: 'flex', flexDirection: 'column', gap: 16 },
  title: { fontSize: 17, fontWeight: 600 },
  cards: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 12 },
  card: { padding: 14, borderRadius: 10, background: 'var(--dsw-alias-surface-primary, transparent)', border: '1px solid var(--dsw-alias-border-primary)' },
  cardLabel: { fontSize: 12, opacity: 0.65, marginBottom: 6 },
  cardValue: { fontSize: 20, fontWeight: 600, fontVariantNumeric: 'tabular-nums' },
  table: { width: '100%', borderCollapse: 'collapse', fontSize: 13 },
  th: { textAlign: 'left', padding: '6px 10px', borderBottom: '1px solid var(--dsw-alias-border-primary)', opacity: 0.65, fontWeight: 500 },
  td: { padding: '6px 10px', borderBottom: '1px solid var(--dsw-alias-border-secondary, transparent)', fontVariantNumeric: 'tabular-nums' },
  bar: { height: 8, borderRadius: 4, background: 'var(--dsw-alias-state-business-primary, #4c6ef5)', minWidth: 2 },
  empty: { padding: 40, textAlign: 'center', opacity: 0.6 },
  error: { color: 'var(--dsw-alias-state-error-foreground, #f56a6a)', padding: 20 },
}

function fmt(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`
  return String(n)
}

export interface UsageStatsPageProps {
  /** hooks 份额绑定(stats → useStats,渲染器 standardHookPropName 约定)。 */
  readonly useStats: <S>(selector: (state: StatsState) => S) => S
  readonly refresh: () => void
  readonly t: (key: string) => string
}

export function UsageStatsPage(props: UsageStatsPageProps): React.JSX.Element {
  const stats = props.useStats(s => s)
  if (stats.status === 'loading') return <div style={styles.page}><div style={styles.empty}>加载中…</div></div>
  if (stats.status === 'error') return <div style={styles.page}><div style={styles.error}>加载失败:{stats.message}</div></div>
  const a = stats.aggregates
  if (a === undefined || a.total.sessions === 0) {
    return <div style={styles.page} data-eterna-usage-stats><div style={styles.title}>{props.t('panel')}</div><div style={styles.empty}>还没有会话用量数据</div></div>
  }
  const billed = a.total.inputTokens + a.total.cacheReadTokens + a.total.cacheWriteTokens + a.total.outputTokens
  const hitRate = a.total.cacheReadTokens + a.total.inputTokens > 0
    ? `${((a.total.cacheReadTokens / (a.total.cacheReadTokens + a.total.inputTokens)) * 100).toFixed(1)}%` : '—'
  const days = Object.entries(a.byDay).sort(([d1], [d2]) => d1.localeCompare(d2)).slice(-14)
  const maxDay = Math.max(1, ...days.map(([, v]) => v.inputTokens + v.outputTokens))
  const models = Object.entries(a.byModel).sort(([, b1], [, b2]) => (b2.inputTokens + b2.outputTokens) - (b1.inputTokens + b1.outputTokens))
  return (
    <div style={styles.page} data-eterna-usage-stats>
      <div style={styles.title}>{props.t('panel')}{stats.scope === 'self' ? '(本人)' : '(全局)'}</div>
      <div style={styles.cards}>
        <div style={styles.card} data-eterna-stat="total"><div style={styles.cardLabel}>总 Token</div><div style={styles.cardValue}>{fmt(billed)}</div></div>
        <div style={styles.card}><div style={styles.cardLabel}>输入 / 输出</div><div style={styles.cardValue}>{fmt(a.total.inputTokens)} / {fmt(a.total.outputTokens)}</div></div>
        <div style={styles.card}><div style={styles.cardLabel}>缓存命中率</div><div style={styles.cardValue}>{hitRate}</div></div>
        <div style={styles.card}><div style={styles.cardLabel}>会话 / 轮次</div><div style={styles.cardValue}>{a.total.sessions} / {a.total.turns}</div></div>
      </div>
      <div>
        <div style={{ ...styles.cardLabel, marginBottom: 8 }}>近 14 天趋势(输入+输出)</div>
        <div style={{ display: 'flex', alignItems: 'flex-end', gap: 4, height: 80 }} data-eterna-trend>
          {days.map(([day, v]) => (
            <div key={day} title={`${day}: ${v.inputTokens + v.outputTokens}`} style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', height: '100%' }}>
              <div style={{ ...styles.bar, height: `${Math.max(4, ((v.inputTokens + v.outputTokens) / maxDay) * 100)}%` }} />
              <div style={{ fontSize: 9, opacity: 0.5, textAlign: 'center', marginTop: 4 }}>{day.slice(5)}</div>
            </div>
          ))}
        </div>
      </div>
      <div>
        <div style={{ ...styles.cardLabel, marginBottom: 8 }}>按模型</div>
        <table style={styles.table} data-eterna-model-table>
          <thead><tr><th style={styles.th}>模型</th><th style={styles.th}>输入</th><th style={styles.th}>输出</th><th style={styles.th}>缓存读</th><th style={styles.th}>轮次</th></tr></thead>
          <tbody>
            {models.map(([model, v]) => (
              <tr key={model}>
                <td style={styles.td}>{model}</td>
                <td style={styles.td}>{fmt(v.inputTokens)}</td>
                <td style={styles.td}>{fmt(v.outputTokens)}</td>
                <td style={styles.td}>{fmt(v.cacheReadTokens)}</td>
                <td style={styles.td}>{v.turns}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

interface ClientContext {
  readonly slots: { inject(slot: string, contribute: () => (() => void) | Generator<() => void>): () => void; register(options: Record<string, unknown>, component: unknown): () => void }
  readonly locale: { register(ns: string, dictionaries: Record<string, Record<string, string>>): () => void; bind(ns: string): (key: string) => string }
  readonly layout: { selectMainPanel(key: string): void }
  readonly connection: { rpc: { call(channel: string, endpoint: string, payload: unknown): Promise<{ ok: boolean; value?: unknown; error?: { code?: string; message?: string } }> } }
}

export function apply(ctx: ClientContext): () => void {
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
    name: 'sidebar.panellist', id: PANEL_ID, order: 22, locale: NS, label: () => t('panel'),
  }, function PanelIcon() {
    const [active] = useState(false)
    return <span style={{ fontSize: 16 }} role="img" aria-label={t('panel')}>📊{active ? '' : ''}</span>
  }))
  return disposeLocale
}
