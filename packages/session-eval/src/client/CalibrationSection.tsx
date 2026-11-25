/**
 * 设置分区子块「校准」:人工复核与裁判判定的一致率 / 混淆矩阵 / 偏松偏紧结论。
 *
 * 数据口径(engine):标注 = 人工是否认可该条裁判判定,人工判定由「裁判值 + 是否认可」
 * 反推;同一指标同一条重标只算最新一次。阈值 20 条样本 + 85% 一致率。
 * 形态纪律:只读展示(标注在会话内评测面板完成),不新增独立页面、无自定义叠层。
 */
import { useEffect, useMemo, useState } from 'react'
import type { ReactElement } from 'react'
import type {
  CalibrationMatrix, CalibrationMetricView, CalibrationView,
} from '../judge-types.ts'

type Status = CalibrationMetricView['status']

/** 状态徽标文案. */
const STATUS_LABEL: Readonly<Record<Status, string>> = {
  not_started: '还没开始',
  insufficient: '样本不足',
  uncalibrated: '未校准',
  calibrated: '已校准',
}

/** 徽标色调(accent=已校准 / warn=样本够了但一致率未到 / 其余中性). */
function toneOf(status: Status): 'accent' | 'warn' | undefined {
  if (status === 'calibrated') return 'accent'
  if (status === 'uncalibrated') return 'warn'
  return undefined
}

/** 一致率百分比文案(0 样本给破折号,不伪造 0%). */
function percentOf(agreement: number | null): string {
  return agreement === null ? '—' : `${Math.round(agreement * 100)}%`
}

/** 状态解释(为什么是这个状态、下一步做什么). */
function statusNote(status: Status, labeled: number, thresholds: CalibrationView['thresholds']): string {
  const minPct = Math.round(thresholds.minAgreement * 100)
  if (status === 'calibrated') return `标注与一致率都达标（一致率 ≥${minPct}%），裁判判定可以采信。`
  if (status === 'uncalibrated') {
    return labeled >= thresholds.minSamples
      ? `标注够了，一致率还没到 ${minPct}%：继续复核分歧样本，或换裁判模型。`
      : '一致率还没到阈值。'
  }
  if (status === 'insufficient') return `已标注 ${labeled} 条，满 ${thresholds.minSamples} 条后才判定校准。`
  return `还没有人工标注。在评测面板点「判得对 / 判错了」会记入这里。`
}

/** 偏松/偏紧的一句话结论(方向 + 由哪些样本得出). */
function biasSentence(metric: CalibrationMetricView): string {
  const { matrix } = metric
  if (metric.bias === 'balanced') return '两个方向没有明显偏向（或无反向样本）。'
  if (metric.bias === 'lenient') {
    const failTotal = matrix.humanFailJudgePass + matrix.humanFailJudgeFail
    return `裁判偏松：人工判未过的 ${failTotal} 条里，有 ${matrix.humanFailJudgePass} 条被它放过了。`
  }
  const passTotal = matrix.humanPassJudgePass + matrix.humanPassJudgeFail
  return `裁判偏紧：人工判通过的 ${passTotal} 条里，有 ${matrix.humanPassJudgeFail} 条被它否掉了。`
}

/** 混淆矩阵(行=人工,列=裁判;语义与原型一致). */
function MatrixTable(props: { readonly matrix: CalibrationMatrix }): ReactElement {
  const { matrix } = props
  return (
    <div data-eterna-eval-cal="matrix" role="table" aria-label="人工判定与裁判判定的混淆矩阵">
      <span role="rowheader" aria-label="判定来源" />
      <span role="columnheader">裁判通过</span>
      <span role="columnheader">裁判未过</span>
      <span role="rowheader">人工通过</span>
      <span role="cell">{matrix.humanPassJudgePass}</span>
      <span role="cell">{matrix.humanPassJudgeFail}</span>
      <span role="rowheader">人工未过</span>
      <span role="cell">{matrix.humanFailJudgePass}</span>
      <span role="cell">{matrix.humanFailJudgeFail}</span>
    </div>
  )
}

/**
 * 校准子块正文。
 * @param props.calibration - 服务端聚合结果;缺省 = 内核未装载,给如实空态.
 */
export function CalibrationSection(props: { readonly calibration?: CalibrationView }): ReactElement | null {
  const { calibration } = props
  const [selected, setSelected] = useState<string | undefined>(undefined)

  // 默认展示「有标注的第一项」;数据刷新后若选中项消失则回落到默认。
  const defaultKey = useMemo(() => {
    if (calibration === undefined) return undefined
    return calibration.metrics.find(metric => metric.labeled > 0)?.key ?? calibration.metrics[0]?.key
  }, [calibration])
  const activeKey = selected !== undefined && calibration?.metrics.some(metric => metric.key === selected) === true
    ? selected
    : defaultKey
  const active = calibration?.metrics.find(metric => metric.key === activeKey)

  useEffect(() => {
    if (selected !== undefined && calibration?.metrics.some(metric => metric.key === selected) !== true) {
      setSelected(undefined)
    }
  }, [calibration, selected])

  if (calibration === undefined) return null

  const { totals, thresholds } = calibration
  const minPct = Math.round(thresholds.minAgreement * 100)
  return (
    <fieldset data-eterna-eval-set="group">
      <legend>校准</legend>
      <div data-eterna-eval-cal="kpis">
        <div data-eterna-eval-cal="kpi">
          <p data-eterna-eval-cal="kpi-title">与人工一致</p>
          <p data-eterna-eval-cal="kpi-value">{percentOf(totals.agreement)}</p>
          <p data-eterna-eval-cal="note">{`${totals.agrees} / ${totals.labeled} 条`}</p>
        </div>
        <div data-eterna-eval-cal="kpi">
          <p data-eterna-eval-cal="kpi-title">状态</p>
          <p data-eterna-eval-cal="kpi-badge">
            <span data-eterna-eval-set="badge" data-tone={toneOf(totals.status)}>{STATUS_LABEL[totals.status]}</span>
          </p>
          <p data-eterna-eval-cal="note">{statusNote(totals.status, totals.labeled, thresholds)}</p>
        </div>
      </div>

      {calibration.metrics.length === 0 ? (
        <p data-eterna-eval-set="hint">指标目录为空，暂无可校准的指标。</p>
      ) : (
        <div data-eterna-eval-cal="table-wrap">
          <table data-eterna-eval-cal="table">
            <thead>
              <tr>
                <th scope="col">指标</th>
                <th scope="col">已标注</th>
                <th scope="col">一致率</th>
                <th scope="col">状态</th>
              </tr>
            </thead>
            <tbody>
              {calibration.metrics.map(metric => (
                <tr key={metric.key} data-active={metric.key === activeKey}>
                  <th scope="row">
                    <button
                      type="button"
                      data-eterna-eval-cal="metric-btn"
                      aria-pressed={metric.key === activeKey}
                      onClick={() => { setSelected(metric.key) }}
                    >
                      {metric.name}
                    </button>
                  </th>
                  <td>{metric.labeled}</td>
                  <td>{percentOf(metric.agreement)}</td>
                  <td>
                    <span data-eterna-eval-set="badge" data-tone={toneOf(metric.status)}>{STATUS_LABEL[metric.status]}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {active === undefined ? null : (
        <div data-eterna-eval-cal="detail-card">
          <h3 data-eterna-eval-cal="detail-title">{`混淆矩阵 · ${active.name}`}</h3>
          <MatrixTable matrix={active.matrix} />
          <p data-eterna-eval-cal="note">{biasSentence(active)}</p>
        </div>
      )}

      <p data-eterna-eval-set="hint">
        {`校准阈值：单项满 ${thresholds.minSamples} 条人工标注且一致率 ≥${minPct}%。在评测面板点「判得对 / 判错了」会记入这里；同一会话同一条重标只算最新一次。`}
      </p>
    </fieldset>
  )
}