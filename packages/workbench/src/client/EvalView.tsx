/**
 * 评测监控视图(视图四;38 号 T11/E-1~E-7,布局/状态/文案 = 原型 03 视图四
 * 逐字):四指标卡 + 金集通过率趋势 + 路由金集衰减两图(SVG,几何由
 * project/eval-view.ts 纯投影计算,mock 初始数据与原型静态稿逐值一致)。
 * 纯数据驱动组件(无本地状态)。
 */
import type { ReactElement } from 'react'
import { Ring } from '@eterna/ui'
import { decayChart, evalMetricCards, trendChart, type LineChartView, type MetricCard } from '../project/eval-view.ts'
import type { WorkbenchSnapshot } from '../types.ts'

export interface EvalViewProps {
  readonly snapshot: WorkbenchSnapshot
}

function MetricTile({ card }: { readonly card: MetricCard }): ReactElement {
  // v4 §8:指标卡 = 玉环 + 数字(比例一眼成形,不再靠读两位小数)
  return (
    <div data-eterna-workbench="metric-card" data-eterna-workbench-metric={card.label}>
      <div data-eterna-workbench="metric-face">
        {card.ratio === undefined
          ? null
          : <Ring ratio={card.ratio} tone={card.ratioTone ?? 'accent'} size={44} ariaLabel={card.label} label='' />}
        <div data-eterna-workbench="metric-body">
          <p data-eterna-workbench="metric-label">{card.label}</p>
          <p data-eterna-workbench="metric-value" data-eterna-workbench-num="true">{card.value}</p>
        </div>
      </div>
      <p data-eterna-workbench="metric-sub">
        {card.sub}
        {card.badge !== undefined && (
          <span data-eterna-workbench="badge" data-eterna-workbench-tone="success">{card.badge}</span>
        )}
      </p>
    </div>
  )
}

/** 折线图(原型 03 chart-svg 坐标系:viewBox 520×250,轴系 x∈[50,500])。 */
function LineChart({ chart, chartId }: { readonly chart: LineChartView; readonly chartId: string }): ReactElement {
  return (
    <div data-eterna-workbench="chart-card">
      <h3 data-eterna-workbench="chart-title">{chart.title}</h3>
      <svg
        data-eterna-workbench="chart-svg"
        data-eterna-workbench-chart={chartId}
        viewBox="0 0 520 250"
        role="img"
        aria-labelledby={`${chartId}-title ${chartId}-desc`}
      >
        <title id={`${chartId}-title`}>{chartId === 'trend' ? '金集通过率趋势折线图' : '路由金集衰减折线图'}</title>
        <desc id={`${chartId}-desc`}>{chart.desc}</desc>
        {chart.grid.map(line => (
          <g key={line.label}>
            <line data-eterna-workbench="chart-grid" x1={50} y1={line.y} x2={500} y2={line.y} />
            <text data-eterna-workbench="chart-lbl" x={44} y={line.y + 4} textAnchor="end">{line.label}</text>
          </g>
        ))}
        <line data-eterna-workbench="chart-axis" x1={50} y1={20} x2={50} y2={200} />
        <line data-eterna-workbench="chart-axis" x1={50} y1={200} x2={500} y2={200} />
        <line data-eterna-workbench="chart-gate" x1={50} y1={chart.gate.y} x2={500} y2={chart.gate.y} />
        <text data-eterna-workbench="chart-gate-lbl" x={496} y={chart.gate.y - 6} textAnchor="end">{chart.gate.label}</text>
        <polyline
          data-eterna-workbench="chart-series"
          points={chart.points.map(point => `${point.x},${point.y}`).join(' ')}
        />
        {chart.points.map(point => (
          <circle
            key={point.index}
            data-eterna-workbench="chart-pt"
            data-eterna-workbench-warn={point.warn ? 'true' : undefined}
            data-eterna-workbench-value={point.value}
            cx={point.x}
            cy={point.y}
            r={point.warn ? 3.5 : 3}
          />
        ))}
        <text data-eterna-workbench="chart-lbl" x={chart.points[0]?.x ?? 80} y={218} textAnchor="middle">{chart.xFirstLabel}</text>
        {chart.points.length > 1 && (
          <text data-eterna-workbench="chart-lbl" x={chart.points[chart.points.length - 1]!.x} y={218} textAnchor="middle">{chart.xLastLabel}</text>
        )}
        <text data-eterna-workbench="chart-lbl" x={470} y={238} textAnchor="end">{chart.yLabel}</text>
      </svg>
      <p data-eterna-workbench="chart-note">{chart.note}</p>
    </div>
  )
}

/** 评测监控 · 金集趋势与衰减(原型 03 视图四)。 */
export function EvalView({ snapshot }: EvalViewProps): ReactElement {
  return (
    <section data-eterna-workbench="view" data-eterna-workbench-view="eval" id="wb-v4" aria-labelledby="wb-h-v4">
      <div data-eterna-workbench="view-head">
        <h2 data-eterna-workbench="view-title" id="wb-h-v4">评测监控 · 金集趋势与衰减</h2>
      </div>
      <p data-eterna-workbench="view-desc">质量趋势一目了然：任务金集通过率、路由回归结果与行为漂移曲线。</p>

      <div data-eterna-workbench="metrics" data-eterna-workbench-metrics-count="4">
        {evalMetricCards(snapshot.eval).map(card => <MetricTile key={card.label} card={card} />)}
      </div>

      <div data-eterna-workbench="charts">
        <LineChart chart={trendChart(snapshot.eval)} chartId="trend" />
        <LineChart chart={decayChart(snapshot.eval)} chartId="decay" />
      </div>
    </section>
  )
}
