/**
 * 评测面板正文(P0/P1):右栏 tab body,只读展示当前会话的确定性评分与裁判评分。
 *
 * 三条纪律(56 号 §5.5-A):
 * 1. **没有分数就显示状态,不显示 0** —— not_applicable / error / 待评 / 未采样各有文案;
 * 2. **过程指标只诊断** —— 结论卡合并规则与结果类裁判;结果类未评时明写「结果类未评」;
 * 3. **每个数字带来源与版本** —— 规则项来源 = 规则(零模型成本),裁判项来源 = 模型
 *    (显示路由/耗时/tokens,换模型等于换榜单)。
 *
 * 刷新:手动按钮 + 可见时 20 秒自动一次(只读投影,重复拉取无副作用);切会话
 * 立即重拉并中止在途请求。「立即评测」触发裁判队列入队,受理后延时重拉一次。
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import type { ReactElement } from 'react'
import { Icon } from '@eterna/ui/icons'
import { ISSUE_LIMIT, ISSUE_OVERFLOW_NOTE } from '../types.ts'
import type { EvalIssue, EvalSnapshot, MetricScore } from '../types.ts'
import type { JudgeScoreView, JudgeSnapshot } from '../judge-types.ts'
import { SessionEvalApiError, evaluateSession, fetchSnapshot, saveJudgeLabel } from './api.ts'
import { formatClock, formatCost, formatDuration, formatInt, formatPercent } from '../format.ts'

/** 自动刷新间隔(可见时;只读投影,无副作用)。 */
const AUTO_REFRESH_MS = 20_000

/** 手动评测受理后的首轮重拉延迟(裁判调用通常数秒内完成)。 */
const EVALUATE_REFRESH_MS = 4_000

/** 面板渲染态。 */
type PanelState =
  | { readonly status: 'idle' }
  | { readonly status: 'loading'; readonly snapshot?: EvalSnapshot }
  | { readonly status: 'ready'; readonly snapshot: EvalSnapshot }
  | { readonly status: 'error'; readonly message: string; readonly snapshot?: EvalSnapshot }

/** tab body 收到的标准 props(结构子集:只用 sessionId)。 */
export interface EvalPanelProps {
  readonly sessionId?: string | undefined
}

/** 错误文案:按 HTTP 状态分流(401/404/409/429/503 各有含义,不混成一句「失败」). */
function errorMessageOf(error: unknown): string {
  if (error instanceof SessionEvalApiError) {
    if (error.status === 401) return '登录状态已失效，请重新登录后刷新。'
    if (error.status === 404) return '会话不存在或不属于当前账号。'
    if (error.status === 409) return error.message
    if (error.status === 429) return error.message
    if (error.status === 503) return '评测内核未就绪（插件未装载或仍在启动）。'
    return `评测请求失败（HTTP ${error.status}）：${error.message}`
  }
  if (error instanceof Error && error.name === 'AbortError') return ''
  return '评测请求失败：无法连接服务端。'
}

/** 指标行:来源徽标固定「规则」,判定三态用字色旗标(不实心填充). */
function MetricRow(props: { readonly metric: MetricScore }): ReactElement {
  const { metric } = props
  const flag = metric.pass === true
    ? <span data-eterna-eval="flag">通过</span>
    : metric.pass === false
      ? <span data-eterna-eval="flag" data-tone="danger">异常</span>
      : <span data-eterna-eval="flag">仅计量</span>
  return (
    <tr>
      <td>
        {metric.name}
        {metric.detail === undefined ? null : (
          <span data-eterna-eval="detail" title={metric.detail}> · 口径</span>
        )}
      </td>
      <td data-num="true">{metric.display}</td>
      <td>{flag}</td>
    </tr>
  )
}

/** 问题条目(轮次 + 标题 + 说明;轮次 0 = 未能归属,不臆测). */
function IssueItem(props: { readonly issue: EvalIssue }): ReactElement {
  const { issue } = props
  return (
    <li data-kind={issue.kind}>
      <span data-eterna-eval="issue-title">{issue.title}</span>
      <span data-eterna-eval="detail">{issue.detail}</span>
    </li>
  )
}

/** 裁判状态徽标:通过=中性、未过=红、出错/待评=灰(没有分数就显示状态). */
function JudgeFlag(props: { readonly score: JudgeScoreView }): ReactElement {
  const { score } = props
  const tone = score.pass === false ? 'danger' : score.status === 'error' ? 'warn' : undefined
  return <span data-eterna-eval="flag" data-tone={tone}>{score.display}</span>
}

/** 单条裁判评分行(指标 + 判定 + 耗时;理由与用量默认折叠;模型判定可人工复核). */
function JudgeScoreRow(props: {
  readonly score: JudgeScoreView
  readonly onLabel: (score: JudgeScoreView, agrees: boolean) => void
  readonly labeling: boolean
}): ReactElement {
  const { score, onLabel, labeling } = props
  const hasDetail = score.rationale !== undefined || score.route !== null || score.tokens !== undefined
    || score.labelable === true
  return (
    <>
      <tr>
        <td>
          {score.name}
          {score.turn === undefined ? null : <span data-eterna-eval="detail">{` · 第 ${score.turn} 轮`}</span>}
        </td>
        <td><JudgeFlag score={score} /></td>
        <td data-num="true">{score.latencyMs === undefined ? '—' : formatDuration(score.latencyMs)}</td>
      </tr>
      {!hasDetail ? null : (
        <tr data-eterna-eval="judge-detail-row">
          <td colSpan={3}>
            <details>
              <summary>{score.labelable === true ? '理由与用量 · 判得对 / 判错了' : '理由与用量'}</summary>
              {score.rationale === undefined ? null : <p data-eterna-eval="rationale">{score.rationale}</p>}
              <p data-eterna-eval="detail">
                {`来源：裁判 · ${score.route === null ? '路由未配置' : `${score.route.provider} / ${score.route.model}`}`}
                {score.tokens === undefined ? '' : ` · ${formatInt(score.tokens)} tokens`}
                {score.latencyMs === undefined ? '' : ` · ${formatDuration(score.latencyMs)}`}
              </p>
              {score.labelable !== true ? null : (
                <div data-eterna-eval="label-group" role="group" aria-label={`${score.name} 的裁判判定是否正确`}>
                  <button
                    type="button"
                    className="et-eval-button"
                    aria-pressed={score.label === 'agrees'}
                    disabled={labeling}
                    onClick={() => { onLabel(score, true) }}
                  >
                    <Icon name="check" size={14} />
                    判得对
                  </button>
                  <button
                    type="button"
                    className="et-eval-button"
                    aria-pressed={score.label === 'disagrees'}
                    disabled={labeling}
                    onClick={() => { onLabel(score, false) }}
                  >
                    <Icon name="close" size={14} />
                    判错了
                  </button>
                  <span data-eterna-eval="detail">标注会计入 设置 → 评测 → 校准。</span>
                </div>
              )}
            </details>
          </td>
        </tr>
      )}
    </>
  )
}

/** 裁判卡片:结果类综合结论 + 六项评分 + 预算 + 立即评测. */
function JudgeCard(props: {
  readonly judge: JudgeSnapshot
  readonly onEvaluate: () => void
  readonly evaluating: boolean
  readonly feedback: string
  readonly onLabel: (score: JudgeScoreView, agrees: boolean) => void
  readonly labeling: boolean
}): ReactElement {
  const { judge, onEvaluate, evaluating, feedback, onLabel, labeling } = props
  const unconfigured = judge.state === 'unconfigured'
  return (
    <section data-eterna-eval="card" data-role="judge" aria-labelledby="et-eval-judge-heading">
      <h3 id="et-eval-judge-heading">裁判评分（模型 · 异步）</h3>
      <div data-eterna-eval="judge-head">
        <div data-eterna-eval="judge-meta">
          <span data-eterna-eval="verdict-title" data-level={judge.overall.level}>{judge.overall.label}</span>
          <span>
            {`${judge.pending > 0 ? `排队 ${judge.pending}` : '空闲'} · 预算 ${formatInt(judge.budget.usedTokens)} / ${formatInt(judge.budget.maxTokensPerDay)} tokens（当日）`}
          </span>
        </div>
        <button
          type="button"
          className="et-eval-button"
          onClick={onEvaluate}
          disabled={unconfigured || evaluating}
          title={unconfigured ? '先在 设置 → 评测 里选择裁判模型' : '整条会话结果类 + 末轮过程类裁判'}
        >
          <Icon name="play" size={14} />
          {evaluating ? '排队中…' : '立即评测'}
        </button>
      </div>
      {feedback === '' ? null : <p data-eterna-eval="hint" role="status">{feedback}</p>}
      <table data-eterna-eval="table">
        <caption>通过 / 未过来自模型判定；出错、待评、未采样、已停用都不是分数。</caption>
        <thead>
          <tr><th scope="col">指标</th><th scope="col">判定</th><th scope="col">耗时</th></tr>
        </thead>
        <tbody>
          {judge.scores.map(score => (
            <JudgeScoreRow key={score.key} score={score} onLabel={onLabel} labeling={labeling} />
          ))}
        </tbody>
      </table>
      {judge.overall.reasons.length === 0 ? null : (
        <ul data-eterna-eval="reasons">
          {judge.overall.reasons.map(reason => <li key={reason}>{reason}</li>)}
        </ul>
      )}
      {judge.note === undefined ? null : <p data-eterna-eval="hint">{judge.note}</p>}
    </section>
  )
}

/** 快照正文(ready 态;裁判卡紧跟结论卡——需要模型算力的结果优先于逐项规则明细). */
function SnapshotBody(props: {
  readonly snapshot: EvalSnapshot
  readonly onEvaluate: () => void
  readonly evaluating: boolean
  readonly feedback: string
  readonly onLabel: (score: JudgeScoreView, agrees: boolean) => void
  readonly labeling: boolean
}): ReactElement {
  const { snapshot, onEvaluate, evaluating, feedback, onLabel, labeling } = props
  const failing = snapshot.metrics.filter(metric => metric.pass === false)
  const overLimit = snapshot.issues.length >= ISSUE_LIMIT
  return (
    <>
      <section data-eterna-eval="card" data-role="verdict" data-level={snapshot.verdict.level}
        aria-live="polite">
        <div data-eterna-eval="verdict-title">{snapshot.verdict.label}</div>
        <ul data-eterna-eval="reasons">
          {snapshot.verdict.reasons.map(reason => <li key={reason}>{reason}</li>)}
        </ul>
      </section>

      {snapshot.judge === undefined ? null : (
        <JudgeCard
          judge={snapshot.judge}
          onEvaluate={onEvaluate}
          evaluating={evaluating}
          feedback={feedback}
          onLabel={onLabel}
          labeling={labeling}
        />
      )}

      <section data-eterna-eval="card" aria-labelledby="et-eval-process-heading">
        <h3 id="et-eval-process-heading">过程指标（规则 · 零模型成本）</h3>
        <table data-eterna-eval="table">
          <caption>判定只有两种含义：异常 = 硬规则未过；仅计量 = 无公认门槛，只报数。</caption>
          <thead>
            <tr><th scope="col">指标</th><th scope="col">值</th><th scope="col">判定</th></tr>
          </thead>
          <tbody>
            {snapshot.metrics.map(metric => <MetricRow key={metric.key} metric={metric} />)}
          </tbody>
        </table>
      </section>

      <section data-eterna-eval="card" aria-labelledby="et-eval-issue-heading">
        <h3 id="et-eval-issue-heading">{`问题定位（${snapshot.issues.length}${overLimit ? '+' : ''}）`}</h3>
        {snapshot.issues.length === 0
          ? <p data-eterna-eval="hint">未发现工具失败、非法参数、重复调用或审批拒绝。</p>
          : (
            <ul data-eterna-eval="issues">
              {snapshot.issues.map((issue, index) => (
                <IssueItem key={`${issue.kind}-${issue.turn}-${index}`} issue={issue} />
              ))}
            </ul>
          )}
        {overLimit ? <p data-eterna-eval="hint">{ISSUE_OVERFLOW_NOTE}</p> : null}
      </section>

      <section data-eterna-eval="card" aria-labelledby="et-eval-usage-heading">
        <h3 id="et-eval-usage-heading">用量与成本</h3>
        <dl data-eterna-eval="usage">
          <dt>轮 / 步</dt><dd>{`${snapshot.turns} / ${snapshot.steps}`}</dd>
          <dt>计费 token</dt><dd>{`${formatInt(snapshot.usage.billed)} tokens`}</dd>
          <dt>四桶</dt>
          <dd>{`入 ${formatInt(snapshot.usage.input)} · 缓存读 ${formatInt(snapshot.usage.cacheRead)} · 缓存写 ${formatInt(snapshot.usage.cacheWrite)} · 出 ${formatInt(snapshot.usage.output)}`}</dd>
          <dt>缓存命中率</dt>
          <dd>{snapshot.cacheHitRate === null ? '不适用（未报告缓存桶）' : formatPercent(snapshot.cacheHitRate * 100)}</dd>
          <dt>成本估算</dt><dd>{snapshot.costUsd === null ? '不适用（价格表未命中）' : formatCost(snapshot.costUsd)}</dd>
          <dt>会话时长</dt><dd>{snapshot.durationMs === null ? '不适用（无时间戳）' : formatDuration(snapshot.durationMs)}</dd>
          <dt>路由</dt>
          <dd>{snapshot.route === null ? '未知' : `${snapshot.route.provider} / ${snapshot.route.model}`}</dd>
        </dl>
      </section>

      <section data-eterna-eval="card" aria-labelledby="et-eval-pending-heading">
        <h3 id="et-eval-pending-heading">未评与待办</h3>
        <ul data-eterna-eval="pending">
          {snapshot.pending.map(item => <li key={item}>{item}</li>)}
        </ul>
      </section>

      <p data-eterna-eval="hint">
        {snapshot.judge === undefined
          ? '裁判层未装载；当前只有确定性规则评分。'
          : failing.length === 0
            ? '裁判分数在上方卡片异步产出；结果类关键项通过才进结论门控。'
            : `有 ${failing.length} 项硬规则异常；过程异常不等于任务失败，需结合结果类判定看。`}
      </p>
    </>
  )
}

/** 空态(未加载 / 尚无内容):只解释,不给假数字. */
function EmptyBody(props: { readonly snapshot: EvalSnapshot }): ReactElement {
  const { snapshot } = props
  return (
    <section data-eterna-eval="card" data-role="verdict" data-level="unrated">
      <h3 data-eterna-eval="verdict-title">{snapshot.verdict.label}</h3>
      <p data-eterna-eval="hint">{snapshot.verdict.reasons.join(' ')}</p>
    </section>
  )
}

/** 评测 tab 正文。 */
export function EvalPanel(props: EvalPanelProps): ReactElement {
  const { sessionId } = props
  const [state, setState] = useState<PanelState>({ status: 'idle' })
  const [nonce, setNonce] = useState(0)
  const [evaluating, setEvaluating] = useState(false)
  const [labelingKey, setLabelingKey] = useState<string | undefined>(undefined)
  const [judgeFeedback, setJudgeFeedback] = useState('')
  /** 已渲染的快照保留在 loading 态里:刷新时页面不闪空。 */
  const latest = useRef<EvalSnapshot | undefined>(undefined)

  const refresh = useCallback((): void => { setNonce(value => value + 1) }, [])

  /** 立即评测:入队成功后延时重拉(裁判数秒级完成);失败按状态給中文原因。 */
  const handleEvaluate = useCallback((): void => {
    if (sessionId === undefined || sessionId === '' || evaluating) return
    setEvaluating(true)
    setJudgeFeedback('')
    evaluateSession(sessionId, { scope: 'all' })
      .then((reply) => {
        setJudgeFeedback(reply.skipped.length === 0
          ? `已受理 ${reply.accepted} 项裁判（排队 ${reply.pending}）；结果稍后自动刷新。`
          : `已受理 ${reply.accepted} 项裁判；跳过：${reply.skipped.join('；')}`)
        window.setTimeout(refresh, EVALUATE_REFRESH_MS)
      })
      .catch((error: unknown) => {
        setJudgeFeedback(errorMessageOf(error) || '评测请求被中止。')
      })
      .finally(() => { setEvaluating(false) })
  }, [sessionId, evaluating, refresh])

  /** 人工复核:成功后重拉快照回显标注;失败给中文原因。 */
  const handleLabel = useCallback((score: JudgeScoreView, agrees: boolean): void => {
    if (sessionId === undefined || sessionId === '' || labelingKey !== undefined) return
    setLabelingKey(score.key)
    setJudgeFeedback('')
    saveJudgeLabel(sessionId, score.key, score.turn, agrees)
      .then(() => {
        setJudgeFeedback(agrees
          ? `已记录「${score.name}」判得对（计入校准）。`
          : `已记录「${score.name}」判错了，会计入校准。`)
        refresh()
      })
      .catch((error: unknown) => {
        setJudgeFeedback(errorMessageOf(error) || '标注失败。')
      })
      .finally(() => { setLabelingKey(undefined) })
  }, [sessionId, labelingKey, refresh])

  useEffect(() => {
    if (sessionId === undefined || sessionId === '') {
      setState({ status: 'idle' })
      return
    }
    const controller = new AbortController()
    // 切会话:清掉上一个会话的快照,避免 loading 期间显示别人的数字。
    if (latest.current !== undefined && latest.current.sessionId !== sessionId) latest.current = undefined
    setState(current => ({
      status: 'loading',
      ...latest.current === undefined ? {} : { snapshot: latest.current },
      ...current.status === 'loading' && current.snapshot !== undefined && current.snapshot.sessionId === sessionId ? { snapshot: current.snapshot } : {},
    }))
    fetchSnapshot(sessionId, controller.signal)
      .then((snapshot) => {
        latest.current = snapshot
        setState({ status: 'ready', snapshot })
      })
      .catch((error: unknown) => {
        const message = errorMessageOf(error)
        if (message === '') return // 主动中止:切会话/卸载,不落错误态
        setState({ status: 'error', message, ...latest.current === undefined ? {} : { snapshot: latest.current } })
      })
    return () => { controller.abort() }
  }, [sessionId, nonce])

  useEffect(() => {
    if (sessionId === undefined || sessionId === '') return
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') refresh()
    }, AUTO_REFRESH_MS)
    return () => { clearInterval(timer) }
  }, [sessionId, refresh])

  const snapshot = state.status === 'ready' ? state.snapshot
    : state.status === 'loading' ? state.snapshot
      : state.status === 'error' ? state.snapshot
        : undefined
  const busy = state.status === 'loading'

  return (
    <section data-eterna-eval="panel" aria-labelledby="et-eval-heading" aria-busy={busy}>
      <header data-eterna-eval="head">
        <h2 id="et-eval-heading">
          <Icon name="gauge" size={18} label="评测" />
          {' 评测'}
        </h2>
        <div data-eterna-eval="meta">
          <span>确定性评分</span>
          <span aria-hidden="true">·</span>
          <span>{snapshot === undefined || snapshot.turns === 0 ? '尚无轮次' : `截至第 ${snapshot.lastTurn} 轮`}</span>
          {snapshot === undefined ? null : (
            <>
              <span aria-hidden="true">·</span>
              <span>{`更新于 ${formatClock(snapshot.generatedAt)}`}</span>
            </>
          )}
        </div>
        <div data-eterna-eval="actions">
          <button type="button" className="et-eval-button" onClick={refresh} disabled={busy || sessionId === undefined}>
            <Icon name="replay" size={14} />
            刷新
          </button>
        </div>
      </header>

      {sessionId === undefined || sessionId === '' ? (
        <p data-eterna-eval="hint">当前没有打开的会话。打开一个会话后，这里显示它的确定性评分。</p>
      ) : state.status === 'error' ? (
        <>
          <p data-eterna-eval="error" role="alert">{state.message}</p>
          {snapshot === undefined ? null : (
            <SnapshotBody
              snapshot={snapshot}
              onEvaluate={handleEvaluate}
              evaluating={evaluating}
              feedback={judgeFeedback}
              onLabel={handleLabel}
              labeling={labelingKey !== undefined}
            />
          )}
        </>
      ) : snapshot === undefined ? (
        <p data-eterna-eval="hint" aria-busy="true">正在读取会话轨迹…</p>
      ) : snapshot.state === 'ok' ? (
        <SnapshotBody
          snapshot={snapshot}
          onEvaluate={handleEvaluate}
          evaluating={evaluating}
          feedback={judgeFeedback}
          onLabel={handleLabel}
          labeling={labelingKey !== undefined}
        />
      ) : (
        <EmptyBody snapshot={snapshot} />
      )}
    </section>
  )
}
