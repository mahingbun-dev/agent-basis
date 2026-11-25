/**
 * 评测总览(main keyed 页,`sidebar.panellist` 入口):近 14 天本人会话的通过率、
 * 关键项未过、裁判耗时、今日用量、按天条带与按指标表。
 *
 * 形态纪律(56 号 §10 原型 + frontend-style v4):
 * - **不做独立页面入口**:入口是侧栏席位的图标,页面挂在宿主 `main` 槽;
 * - 只读展示,数据经 access 守卫路由(`overview`),服务端按登录身份过滤会话集;
 * - 数字口径写在页面上(「怎么读这些数」),没评完的会话不进分母;没有数就显示
 *   「—」与说明,不伪造 0。
 */
import { useCallback, useEffect, useState } from 'react'
import type { ReactElement } from 'react'
import { Icon } from '@eterna/ui/icons'
import type { OverviewView } from '../judge-types.ts'
import { SessionEvalApiError, fetchOverview } from './api.ts'
import { formatInt } from '../format.ts'

/** 自动刷新间隔(只读聚合,重复拉取无副作用)。 */
const REFRESH_MS = 60_000

/** 通过率百分比(无样本 → 破折号)。 */
function percentOf(rate: number | null): string {
  return rate === null ? '—' : `${Math.round(rate * 100)}%`
}

/** 耗时(毫秒 → 秒,一位小数)。 */
function secondsOf(ms: number | null): string {
  return ms === null ? '—' : `${(ms / 1000).toFixed(1)}`
}

/** 错误文案(与面板同口径:401/503/串门各有含义). */
function errorMessageOf(error: unknown): string {
  if (error instanceof SessionEvalApiError) {
    if (error.status === 401) return '登录状态已失效，请重新登录后刷新。'
    if (error.status === 503) return '评测内核未就绪（插件未装载或仍在启动）。'
    return `读取总览失败（HTTP ${error.status}）：${error.message}`
  }
  if (error instanceof Error && error.name === 'AbortError') return ''
  return '读取总览失败：无法连接服务端。'
}

/** 单天条带(高度按窗口最高通过率归一;无样本 = 只能看的最小柱)。 */
function DayStrip(props: { readonly view: OverviewView }): ReactElement {
  const { byDay } = props.view
  const rated = byDay.filter(day => day.passRate !== null)
  const max = rated.length === 0 ? 0 : Math.max(...rated.map(day => day.passRate as number))
  const minRate = rated.length === 0 ? null : Math.min(...rated.map(day => day.passRate as number))
  return (
    <div
      data-eterna-eval-ov="strip"
      role="img"
      aria-label={rated.length === 0
        ? '近 14 天综合通过率条带：暂无已终评会话'
        : `近 14 天综合通过率条带，最低 ${percentOf(minRate)}，最高 ${percentOf(max)}`}
    >
      {byDay.map((day) => {
        // 相对窗口最低–最高归一(30% 起步):趋势要看波动,绝对值由说明与 title 给。
        const height = day.passRate === null || max === 0 || minRate === null
          ? 0
          : max === minRate
            ? 60
            : 30 + Math.round(((day.passRate - minRate) / (max - minRate)) * 70)
        return (
          <span key={day.day} data-eterna-eval-ov="strip-day" data-empty={day.passRate === null}>
            <i
              style={{ height: `${height}%` }}
              title={`${day.day}：${percentOf(day.passRate)}（${day.passed}/${day.evaluated} 个已终评会话）`}
            />
            <em>{day.day.slice(5)}</em>
          </span>
        )
      })}
    </div>
  )
}

/**
 * 侧栏入口图标(sidebar.panellist 条目组件;图标统一走 @eterna/ui/icons).
 * 宿主按 `SidebarPanelIconOwnerProps.size` 给方形边长(选中态由 owner 着色,图标走 currentColor)。
 */
export function OverviewEntryIcon(props: { readonly size?: number }): ReactElement {
  return <Icon name="chart" size={props.size ?? 16} />
}

/**
 * 总览页正文。
 * @returns main 槽组件(无 props;数据自拉).
 */
export function OverviewPage(): ReactElement {
  const [view, setView] = useState<OverviewView | undefined>(undefined)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)

  const load = useCallback((signal?: AbortSignal): void => {
    setLoading(true)
    fetchOverview(signal)
      .then((next) => {
        setView(next)
        setError('')
      })
      .catch((cause: unknown) => { setError(errorMessageOf(cause)) })
      .finally(() => { setLoading(false) })
  }, [])

  useEffect(() => {
    const controller = new AbortController()
    load(controller.signal)
    const timer = window.setInterval(() => { load() }, REFRESH_MS)
    return () => { controller.abort(); window.clearInterval(timer) }
  }, [load])

  const totals = view?.totals
  const peak = view === undefined
    ? null
    : view.byDay.reduce<number | null>((best, day) => {
      if (day.passRate === null) return best
      return best === null || day.passRate > best ? day.passRate : best
    }, null)
  return (
    <div data-eterna-eval-ov="page">
      <header data-eterna-eval-ov="head">
        <h1>评测总览</h1>
        <span data-eterna-eval-ov="scope">近 14 天 · 本人会话</span>
        <button type="button" className="et-eval-button" onClick={() => { load() }} disabled={loading}>
          <Icon name="replay" size={14} />
          {loading ? '刷新中…' : '刷新'}
        </button>
      </header>
      {error === '' ? null : <p data-eterna-eval-ov="error" role="alert">{error}</p>}
      {view === undefined || totals === undefined ? (
        <p data-eterna-eval-ov="hint" aria-busy={loading}>{loading ? '正在读取总览…' : '总览尚未加载。'}</p>
      ) : (
        <>
          <section data-eterna-eval-ov="kpis" aria-label="总览指标">
            <div data-eterna-eval-ov="kpi">
              <p data-eterna-eval-ov="kicker">综合通过率</p>
              <p data-eterna-eval-ov="value">{percentOf(totals.passRate)}</p>
              <p data-eterna-eval-ov="note">{`${totals.passedSessions} / ${totals.evaluatedSessions} 个已终评会话`}</p>
            </div>
            <div data-eterna-eval-ov="kpi">
              <p data-eterna-eval-ov="kicker">关键项未过</p>
              <p data-eterna-eval-ov="value">{totals.gatingFailedSessions}</p>
              <p data-eterna-eval-ov="note">会话 · 可在会话内评测面板定位</p>
            </div>
            <div data-eterna-eval-ov="kpi">
              <p data-eterna-eval-ov="kicker">平均裁判耗时</p>
              <p data-eterna-eval-ov="value">{secondsOf(totals.averageLatencyMs)}</p>
              <p data-eterna-eval-ov="note">秒 · 近 14 天有耗时的裁判调用</p>
            </div>
            <div data-eterna-eval-ov="kpi">
              <p data-eterna-eval-ov="kicker">今日评测用量</p>
              <p data-eterna-eval-ov="value">{formatInt(totals.usageToday)}</p>
              <p data-eterna-eval-ov="note">{`token · 上限 ${formatInt(totals.budgetPerDay)}`}</p>
            </div>
          </section>

          {totals.evaluatedSessions === 0 ? (
            <p data-eterna-eval-ov="hint">
              还没有已终评的会话：在会话右栏「评测」点「立即评测」，或在 设置 → 评测 里开启自动评测。
              通过率只算已终评的会话，没评完的不进分母。
            </p>
          ) : null}

          <div data-eterna-eval-ov="grid">
            <section data-eterna-eval-ov="card">
              <h2>综合通过率趋势</h2>
              <p data-eterna-eval-ov="note">
                {`按天 · 峰值 ${percentOf(peak)} · 柱高按窗口最低–最高归一`}
              </p>
              <DayStrip view={view} />
            </section>
            <section data-eterna-eval-ov="card">
              <h2>怎么读这些数</h2>
              <ul data-eterna-eval-ov="reading">
                <li>通过率只算已终评的会话，没评完的不进分母。</li>
                <li>关键项未过的会话，都能在会话内的评测面板里定位到对话。</li>
                <li>裁判类指标在校准前只看趋势，不横向比较。</li>
              </ul>
            </section>
          </div>

          <section data-eterna-eval-ov="card">
            <h2>按指标</h2>
            <p data-eterna-eval-ov="note">
              整条会话口径的最新一次评分；逐轮指标不聚合（在会话面板逐轮看）。不适用不计入分母。
            </p>
            {view.metrics.length === 0 ? (
              <p data-eterna-eval-ov="hint">还没有整条会话口径的评分。</p>
            ) : (
              <div data-eterna-eval-ov="table-wrap">
                <table data-eterna-eval-ov="table">
                  <thead>
                    <tr>
                      <th scope="col">指标</th>
                      <th scope="col">类别</th>
                      <th scope="col">通过</th>
                      <th scope="col">未过</th>
                      <th scope="col">不适用</th>
                      <th scope="col">通过率</th>
                    </tr>
                  </thead>
                  <tbody>
                    {view.metrics.map(metric => (
                      <tr key={metric.key}>
                        <th scope="row">
                          {metric.name}
                          {metric.source === 'business' ? <span data-eterna-eval-ov="badge">业务</span> : null}
                        </th>
                        <td>{metric.category === 'outcome' ? '结果类' : '过程类'}</td>
                        <td data-num="true">{metric.pass}</td>
                        <td data-num="true">{metric.fail}</td>
                        <td data-num="true">{metric.notApplicable}</td>
                        <td data-num="true">
                          <span data-eterna-eval-ov="bar" data-low={metric.passRate !== null && metric.passRate < 0.8}>
                            <i style={{ width: metric.passRate === null ? '0%' : `${Math.round(metric.passRate * 100)}%` }} />
                          </span>
                          {percentOf(metric.passRate)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </>
      )}
    </div>
  )
}