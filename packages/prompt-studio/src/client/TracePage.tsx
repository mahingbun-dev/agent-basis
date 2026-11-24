/**
 * 侧栏「循环轨迹」主面板(main keyed slot 占位)。
 *
 * 两种形态(同一端点 loopPrompt/trace:无 sessionId → 列表;有 → 该会话分析面):
 * 1. 会话列表:最近 N 条会话卡(轮次/token/时间),点击进入分析视图;
 * 2. 分析视图:三层并列的分析面 —— 性能诊断 / 成本与上下文 / 行为复盘。
 *
 * 分析口径(贯穿全部三层,与 Host 侧 trace.ts 契约一致):
 * - **只用日志里可确定的量**,不做根因推断、不调用模型、不猜实现常量(例如压缩阈值);
 * - 每条结论都附「判据」(触发它的具体阈值与计数),可逐项复核;
 * - 占比的分母显式区分「墙钟」与「已观测分量之和」——未收尾轮次(turn/end 缺失)
 *   没有墙钟,一律标注「已观测」,绝不把分量之和冒充完整墙钟。
 *
 * 渲染纪律:每层包一层错误边界。静默空白会被误读成「这个会话没有可分析内容」,
 * 所以任何一层渲染失败都必须显示成一条显式的「渲染失败」结论卡(而不是白屏)。
 */
import { type ReactElement } from 'react'
import type {
  SessionTrace, TraceApprovalPoint, TraceAttempt, TraceReport, TraceRepeatGroup,
  TraceSessionCard, TraceStep, TraceTokenBuckets, TraceToolCall, TraceToolStat,
  TraceTurn, TraceTurnTime,
} from '../types.ts'
import {
  formatDuration, formatLongDuration, formatPercent, formatTime, formatTokens, previewText,
} from './format.ts'

/** 轨迹数据态(裸 observable 源的快照值;hooks 份额 → useTrace)。 */
export type TraceState =
  | { readonly status: 'loading' }
  | { readonly status: 'error'; readonly message: string }
  | { readonly status: 'ready'; readonly report: TraceReport }

/** 轨迹组件 props(hooks.trace 绑成 useTrace;其余为普通注入值)。 */
export interface TracePageProps {
  /** hooks 份额绑定的选择器钩子(SnapshotSelectorHook 形态)。 */
  readonly useTrace: <S>(selector: (state: TraceState) => S) => S
  /** 回到会话列表(重新拉默认列表)。 */
  readonly refresh: () => void
  /** 选中会话 → 详情形态(宿主带参调用并发布到数据源)。 */
  readonly openSession: (sessionId: string) => void
  /** 标准语言席位。 */
  readonly t: (key: string) => string
}

/** 时间归因的四个分量(顺序即堆叠顺序与图例顺序)。 */
const PHASES = [
  { key: 'ttft', label: '等首字', hint: '每个 step 从发出请求到拿到首个 token' },
  { key: 'gen', label: '生成', hint: '首个 token 到该步输出流结束' },
  { key: 'tool', label: '工具', hint: 'tool/call → 同 callId 的 tool/result' },
  { key: 'other', label: '其他', hint: 'step 内部的调度与写盘,加上轮内 step 之间的空隙' },
] as const

type PhaseKey = (typeof PHASES)[number]['key']

/** 一轮的分量取值(与 PHASES 同键)。 */
function phaseMs(time: TraceTurnTime, key: PhaseKey): number {
  switch (key) {
    case 'ttft': return time.ttftMs
    case 'gen': return time.genMs
    case 'tool': return time.toolMs
    case 'other': return time.otherMs
  }
}

/**
 * 展示分母:有墙钟用墙钟;未收尾轮次用「已观测分量之和」并标记为部分。
 * 返回 null 表示这一轮还没有任何可归因的时间(全新轮次)。
 */
function denominator(time: TraceTurnTime): { ms: number; closed: boolean } | null {
  if (time.wallMs !== null) return time.wallMs > 0 ? { ms: time.wallMs, closed: true } : null
  const observed = time.ttftMs + time.genMs + time.toolMs + time.otherMs
  return observed > 0 ? { ms: observed, closed: false } : null
}

/** 会话级同款分母(任一轮未收尾 → closed=false)。 */
function sessionDenominator(time: TraceTurnTime): { ms: number; closed: boolean } | null {
  return denominator(time)
}

/** 四桶合计(用于逐轮 token 条)。 */
function billedOf(buckets: TraceTokenBuckets): number {
  return buckets.billed
}

/** 缓存命中率(逐轮:cacheRead / (input+cacheRead+cacheWrite))。 */
function cacheHitOf(buckets: TraceTokenBuckets): number | null {
  const prompt = buckets.input + buckets.cacheRead + buckets.cacheWrite
  return prompt > 0 && (buckets.cacheRead > 0 || buckets.cacheWrite > 0) ? buckets.cacheRead / prompt : null
}

/** 结论卡的严重度(只影响配色与排序,不改变事实陈述)。 */
type Severity = 'high' | 'medium' | 'low'

/** 一条结论 = 标题 + 一句话说清看到什么 + 判据(触发它的阈值/原始计数)。 */
interface Finding {
  readonly tag: string
  readonly severity: Severity
  readonly title: string
  readonly text: string
  readonly evidence: string
}

// ---------- 会话列表 ----------

/** 会话列表卡。 */
function SessionCard({ session, onOpen }: {
  readonly session: TraceSessionCard
  readonly onOpen: (sessionId: string) => void
}): ReactElement {
  const title = session.title.trim()
  return (
    <button
      type="button"
      data-t7-session-item={session.sessionId}
      data-t7-session-area={session.area}
      onClick={() => onOpen(session.sessionId)}
    >
      <span data-t7-session-title>{title === '' ? session.sessionId : title}</span>
      <span data-t7-session-id>{session.sessionId}</span>
      <span data-t7-session-metrics>
        <span data-t7-session-turns>{formatTokens(session.turns)} 轮</span>
        <span data-t7-session-input>{formatTokens(session.inputTokens)} 入</span>
        <span data-t7-session-output>{formatTokens(session.outputTokens)} 出</span>
        <span data-t7-session-cache>{formatTokens(session.cacheReadTokens)} 缓存</span>
      </span>
      <span data-t7-session-last>{formatTime(session.lastAt)}</span>
    </button>
  )
}

// ---------- 通用小件 ----------

/** 指标瓦片(`note` 允许显式 undefined:project 开了 exactOptionalPropertyTypes)。 */
function Tile({ label, value, note, tone, anchor }: {
  readonly label: string
  readonly value: string
  readonly note?: string | undefined
  readonly tone?: 'warn' | 'success' | 'accent' | undefined
  readonly anchor?: string | undefined
}): ReactElement {
  return (
    <div data-t7-tile={anchor ?? label} data-tone={tone ?? ''}>
      <span data-t7-tile-label>{label}</span>
      <span data-t7-tile-value>{value}</span>
      {note !== undefined && <span data-t7-tile-note>{note}</span>}
    </div>
  )
}

/** 结论卡(标题 + 正文 + 判据;判据用等宽块保留原始计数)。 */
function FindingCard({ finding }: { readonly finding: Finding }): ReactElement {
  return (
    <div data-t7-finding={finding.tag} data-severity={finding.severity}>
      <div data-t7-finding-head>
        <span data-t7-finding-tag>{finding.tag}</span>
        <span data-t7-finding-title>{finding.title}</span>
      </div>
      <p data-t7-finding-text>{finding.text}</p>
      <pre data-t7-finding-evidence>{finding.evidence}</pre>
    </div>
  )
}

/** 分节标题 + 说明。 */
function Section({ title, note, children, anchor }: {
  readonly title: string
  readonly note?: string
  readonly children: ReactElement | ReactElement[]
  readonly anchor?: string
}): ReactElement {
  return (
    <section data-t7-section={anchor ?? title}>
      <div data-t7-section-head>
        <h2 data-t7-section-title>{title}</h2>
      </div>
      {note !== undefined && <p data-t7-section-note>{note}</p>}
      {children}
    </section>
  )
}

/** 占位(空态/加载态)。 */
function Placeholder({ text, anchor }: { readonly text: string; readonly anchor?: string }): ReactElement {
  return <p data-t7-placeholder {...(anchor === undefined ? {} : { [`data-${anchor}`]: 'true' })}>{text}</p>
}

/**
 * 每层独立错误边界。
 *
 * 为什么必须是「可见的失败」而不是空白:页面有四个大区块,任何一块抛错都会让整层
 * 变空;用户看到的空白与「这个会话确实没有可分析内容」无法区分,会直接误导判断。
 * 这里把异常渲染成一条 high 严重度的结论卡,并在判据里给出原始错误信息。
 */
function Layer({ name, render }: { readonly name: string; readonly render: () => ReactElement }): ReactElement {
  try {
    return render()
  } catch (error: unknown) {
    const message = error instanceof Error ? `${error.name}: ${error.message}` : String(error)
    return (
      <FindingCard finding={{
        tag: '渲染失败',
        severity: 'high',
        title: `「${name}」这一层的内容未能渲染`,
        text: '这是前端渲染错误,不是该会话缺少数据。请把下面的错误信息一起反馈,以便定位。',
        evidence: message,
      }} />
    )
  }
}

// ---------- 第一层:性能诊断 ----------

/** 逐轮时间归因条(堆叠条 + 图例;分母口径显式标注)。 */
function TurnTimeBar({ turn, maxWall }: {
  readonly turn: TraceTurn
  readonly maxWall: number
}): ReactElement {
  const denom = denominator(turn.time)
  const reason = turn.endReason
  const reasonTone = reason === null ? 'info' : reason === 'completed' ? 'ok' : 'warn'
  const segments = denom === null
    ? []
    : PHASES
      .map(phase => ({ ...phase, ms: phaseMs(turn.time, phase.key) }))
      .filter(phase => phase.ms > 0)
      .map(phase => ({ ...phase, share: phase.ms / denom.ms }))

  return (
    <div
      data-t7-trace-node={String(turn.turn)}
      data-t7-turn-reason={reason ?? 'unknown'}
      data-t7-turn-closed={denom === null ? 'untimed' : denom.closed ? 'true' : 'false'}
    >
      <div data-t7-trace-node-head>
        <span data-t7-trace-turn>轮次 {turn.turn}</span>
        <span data-t7-trace-duration>
          {denom === null ? '—' : denom.closed ? formatLongDuration(denom.ms) : `${formatLongDuration(denom.ms)} 已观测`}
        </span>
        <span data-t7-trace-tokens>
          {turn.steps.length} 步 · {formatTokens(turn.tokens.input + turn.tokens.cacheRead)} 输入 · {formatTokens(turn.tokens.output)} 输出
        </span>
        <span data-t7-turn-reason-badge data-tone={reasonTone}>
          {reason ?? '未收尾'}
        </span>
      </div>
      {denom !== null && (
        <div
          data-t7-turn-bar
          data-t7-turn-bar-width={maxWall > 0 ? String(Math.round((denom.ms / maxWall) * 100)) : '100'}
          role="img"
          aria-label={`轮次 ${turn.turn} 时间归因,分母${denom.closed ? '为墙钟' : '为已观测分量之和'}:${segments.map(s => `${s.label} ${formatPercent(s.share)}`).join(',')}`}
        >
          {segments.map(phase => (
            <span
              key={phase.key}
              data-t7-turn-seg={phase.key}
              data-share={String(Math.round(phase.share * 1000) / 10)}
              style={{ flexGrow: String(phase.ms) }}
              title={`${phase.label} ${formatLongDuration(phase.ms)}（${formatPercent(phase.share)}）`}
            />
          ))}
        </div>
      )}
      <div data-t7-turn-legend>
        {PHASES.map(phase => {
          const ms = phaseMs(turn.time, phase.key)
          if (ms <= 0) return null
          return (
            <span key={phase.key} data-t7-turn-legend-item={phase.key}>
              <span data-t7-swatch={phase.key} aria-hidden="true" />
              {phase.label} <b>{formatLongDuration(ms)}</b>
              {denom !== null && `（${formatPercent(ms / denom.ms)}）`}
            </span>
          )
        })}
        {denom !== null && !denom.closed && (
          <span data-t7-turn-legend-note>无 turn/end,分母为已观测分量之和</span>
        )}
      </div>
    </div>
  )
}

/** 最慢步骤表(按等首字降序;上下文 token 同时给出,便于判断相关性)。 */
function SlowestSteps({ turns }: { readonly turns: readonly TraceTurn[] }): ReactElement | null {
  const rows: { turn: number; step: TraceStep }[] = []
  for (const turn of turns) {
    for (const step of turn.steps) {
      if (step.ttftMs === null) continue
      rows.push({ turn: turn.turn, step })
    }
  }
  if (rows.length === 0) return null
  rows.sort((a, b) => (b.step.ttftMs ?? 0) - (a.step.ttftMs ?? 0))
  const top = rows.slice(0, 10)
  const max = top[0]?.step.ttftMs ?? 1
  return (
    <div data-t7-tbl-wrap>
      <table data-t7-table="slow-steps">
        <thead>
          <tr>
            <th scope="col">轮·步</th>
            <th scope="col">等首字</th>
            <th scope="col">上下文 token</th>
            <th scope="col">该步工具</th>
          </tr>
        </thead>
        <tbody>
          {top.map(({ turn, step }) => {
            const ttft = step.ttftMs ?? 0
            return (
              <tr key={`${turn}.${step.step}`} data-t7-step-row={`${turn}.${step.step}`}>
                <td data-t7-mono>{turn}.{step.step}</td>
                <td>
                  <span data-t7-cellbar>
                    <span data-t7-cellbar-track>
                      <span
                        data-t7-cellbar-fill
                        style={{ width: max > 0 ? `${Math.round((ttft / max) * 100)}%` : '0%' }}
                      />
                    </span>
                    <span data-t7-cellbar-value>{formatDuration(ttft)}</span>
                  </span>
                </td>
                <td data-t7-mono>{formatTokens(step.promptTokens)}</td>
                <td data-t7-mono data-t7-muted>
                  {step.toolNames.length === 0 ? '—' : step.toolNames.slice(0, 2).join('、')}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

/** 工具耗时排行表。 */
function ToolTable({ tools }: { readonly tools: readonly TraceToolStat[] }): ReactElement {
  const max = tools[0]?.totalMs ?? 1
  return (
    <div data-t7-tbl-wrap>
      <table data-t7-table="tools">
        <thead>
          <tr>
            <th scope="col">工具</th>
            <th scope="col">总耗时</th>
            <th scope="col">调用</th>
            <th scope="col">平均</th>
            <th scope="col">P95</th>
            <th scope="col">最长</th>
            <th scope="col">失败</th>
          </tr>
        </thead>
        <tbody>
          {tools.map(tool => (
            <tr key={tool.name} data-t7-tool-row={tool.name}>
              <td data-t7-mono>{tool.name}</td>
              <td>
                <span data-t7-cellbar>
                  <span data-t7-cellbar-track>
                    <span
                      data-t7-cellbar-fill
                      style={{ width: max > 0 ? `${Math.max(1, Math.round((tool.totalMs / max) * 100))}%` : '0%' }}
                    />
                  </span>
                  <span data-t7-cellbar-value>{formatLongDuration(tool.totalMs)}</span>
                </span>
              </td>
              <td data-t7-mono>{tool.calls}</td>
              <td data-t7-mono>{formatDuration(tool.avgMs)}</td>
              <td data-t7-mono>{formatDuration(tool.p95Ms)}</td>
              <td data-t7-mono>{formatDuration(tool.maxMs)}</td>
              <td data-t7-mono data-t7-tone={tool.errors > 0 ? 'danger' : undefined}>{tool.errors === 0 ? '—' : tool.errors}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

/** 第一层:性能诊断(时间去哪了 + 最慢步骤 + 工具排行 + 确定性结论)。 */
function DiagnosticLayer({ trace }: { readonly trace: SessionTrace }): ReactElement {
  const analysis = trace.analysis
  const time = analysis.time
  const denom = sessionDenominator(time)
  const findings: Finding[] = []

  // 结论 1:全局时间去向(按实测分量排序,不预设哪一项最大)。
  if (denom !== null) {
    const ordered = PHASES
      .map(phase => ({ ...phase, ms: phaseMs(time, phase.key) }))
      .filter(phase => phase.ms > 0)
      .sort((a, b) => b.ms - a.ms)
    findings.push({
      tag: '时间去向',
      severity: 'low',
      title: `会话共 ${formatLongDuration(denom.ms)}，最大一项是「${ordered[0]?.label ?? '—'}」`,
      text: ordered.map(phase => `${phase.label} ${formatLongDuration(phase.ms)}（${formatPercent(phase.ms / denom.ms)}）`).join('、')
        + (denom.closed ? '。' : '。该会话含未收尾轮次，分母为已观测分量之和。'),
      evidence: `分母 ${formatLongDuration(denom.ms)}（${denom.closed ? '各轮墙钟之和' : '已观测分量之和，非完整墙钟'}）\n`
        + PHASES.map(phase => `  ${phase.label} = ${phaseMs(time, phase.key)}ms`).join('\n')
        + `\n判据：逐 step 用「官方首 token 时刻 − step 起点」归集等首字，tool/call→tool/result 归集工具，余量为其他。`,
    })
  }

  // 结论 2:最慢一轮,点名它自己的最大项(不是假定等首字最大)。
  const closedTurns = trace.turns.filter(turn => turn.time.wallMs !== null)
  const worst = [...closedTurns].sort((a, b) => (b.time.wallMs ?? 0) - (a.time.wallMs ?? 0))[0]
  if (worst !== undefined && worst.time.wallMs !== null && worst.time.wallMs > 0) {
    const own = PHASES
      .map(phase => ({ ...phase, ms: phaseMs(worst.time, phase.key) }))
      .sort((a, b) => b.ms - a.ms)[0]
    const share = own === undefined ? 0 : own.ms / worst.time.wallMs
    if (own !== undefined && share >= 0.4) {
      findings.push({
        tag: '最慢一轮',
        severity: 'high',
        title: `轮次 ${worst.turn} 的 ${formatPercent(share)} 花在「${own.label}」`,
        text: `这一轮是已完成轮次里最长的（${formatLongDuration(worst.time.wallMs)}，${worst.steps.length} 步），其中「${own.label}」占最大头。`,
        evidence: `轮次 ${worst.turn}：墙钟 ${worst.time.wallMs}ms\n`
          + `  = 等首字 ${worst.time.ttftMs} + 生成 ${worst.time.genMs} + 工具 ${worst.time.toolMs} + 其他 ${worst.time.otherMs}\n`
          + `该轮 ${worst.steps.length} 步 → 平均每步等首字 ${Math.round(worst.time.ttftMs / Math.max(1, worst.steps.length))}ms\n`
          + `判据：占比 ≥ 40% 才列为「主要项」。`,
      })
    }
  }

  // 结论 3:等首字的全局占比(超过 35% 才提)。
  if (denom !== null && time.ttftMs / denom.ms >= 0.35) {
    const steps = analysis.counts.steps
    findings.push({
      tag: '等首字',
      severity: 'high',
      title: `等首字占全部时间的 ${formatPercent(time.ttftMs / denom.ms)}`,
      text: `共 ${steps} 步，每步都要等一次首个 token，累计 ${formatLongDuration(time.ttftMs)}。`,
      evidence: `聚合：等首字 ${time.ttftMs} / 生成 ${time.genMs} / 工具 ${time.toolMs} / 其他 ${time.otherMs}\n`
        + `总步数 ${steps} × 平均首字 ${Math.round(time.ttftMs / Math.max(1, analysis.time.observedSteps))}ms ≈ ${time.ttftMs}ms\n`
        + `判据：等首字占比 ≥ 35% 才提。`,
    })
  }

  // 结论 4:单工具集中(占工具总耗时 ≥ 50% 且绝对值 > 5s)。
  const topTool = analysis.tools[0]
  if (topTool !== undefined && time.toolMs > 0 && topTool.totalMs / time.toolMs >= 0.5 && topTool.totalMs > 5000) {
    findings.push({
      tag: '工具集中',
      severity: 'medium',
      title: `${topTool.name} 占掉工具耗时的 ${formatPercent(topTool.totalMs / time.toolMs)}`,
      text: `它被调用 ${topTool.calls} 次，平均 ${formatDuration(topTool.avgMs)}、最长 ${formatDuration(topTool.maxMs)}。工具耗时高度集中在这一个工具上。`,
      evidence: `${topTool.name}：calls=${topTool.calls} total=${topTool.totalMs}ms avg=${topTool.avgMs}ms p95=${topTool.p95Ms}ms max=${topTool.maxMs}ms\n`
        + `工具合计 ${time.toolMs}ms，该工具占 ${formatPercent(topTool.totalMs / time.toolMs)}\n`
        + `判据：单工具占工具总耗时 ≥ 50% 且 ≥ 5s。`,
    })
  }

  // 结论 5:失败调用(有错误才提)。
  const errTools = analysis.tools.filter(tool => tool.errors > 0)
  if (errTools.length > 0) {
    const total = errTools.reduce((sum, tool) => sum + tool.errors, 0)
    findings.push({
      tag: '失败调用',
      severity: 'low',
      title: `${total} 次工具调用返回错误`,
      text: `分布在 ${errTools.map(tool => `${tool.name}×${tool.errors}`).join('、')}。`,
      evidence: errTools.map(tool => `${tool.name}：errors=${tool.errors} / calls=${tool.calls}`).join('\n')
        + '\n判据：tool/result.message.isError === true 计数。',
    })
  }

  const maxWall = Math.max(1, ...trace.turns.map(turn => denominator(turn.time)?.ms ?? 0))

  return (
    <>
      <div data-t7-tiles>
        <Tile label="总时长" anchor="wall" value={denom === null ? '—' : formatLongDuration(denom.ms)}
          note={`${analysis.counts.turns} 轮 · ${analysis.counts.steps} 步`} />
        <Tile label="等首字" anchor="ttft" tone="warn" value={formatLongDuration(time.ttftMs)}
          note={denom === null ? undefined : `占 ${formatPercent(time.ttftMs / denom.ms)}`} />
        <Tile label="生成" anchor="gen" value={formatLongDuration(time.genMs)}
          note={denom === null ? undefined : `占 ${formatPercent(time.genMs / denom.ms)}`} />
        <Tile label="工具执行" anchor="tool" tone="accent" value={formatLongDuration(time.toolMs)}
          note={denom === null ? undefined : `占 ${formatPercent(time.toolMs / denom.ms)}`} />
      </div>

      {findings.length > 0 && (
        <Section title="诊断结论" anchor="diag-findings"
          note="每条都附判据与原始计数。规则只看日志事实，不解释根因。">
          <div data-t7-findings>
            {findings.map(finding => <FindingCard key={finding.tag} finding={finding} />)}
          </div>
        </Section>
      )}

      <Section title="逐轮时间归因" anchor="turn-time"
        note="等首字 = 每步从发出请求到首个 token，逐 step 累加；生成 = 首个 token 到该步流结束；工具 = 同 callId 的 call→result 区间；其他 = 剩余部分（含轮内 step 之间的空隙）。">
        <div data-t7-trace-turns>
          {trace.turns.map(turn => <TurnTimeBar key={turn.turn} turn={turn} maxWall={maxWall} />)}
        </div>
      </Section>

      <Layer name="最慢步骤" render={() => {
        const slow = SlowestSteps({ turns: trace.turns })
        if (slow === null) {
          return <Section title="最慢步骤" anchor="slow-steps"><Placeholder text="该会话没有可计时的 step（缺少 step/start 或计时流）。" anchor="t7-slow-empty" /></Section>
        }
        return (
          <Section title="最慢的 10 个步骤（按等首字）" anchor="slow-steps"
            note="上下文 token = 该步送去模型的 input + cacheRead + cacheWrite；与等首字的线性关系见「相关性」结论（若有）。">
            {slow}
          </Section>
        )
      }} />

      <Section title="工具耗时排行" anchor="tool-rank"
        note="区间 = tool/call 到同 callId 的 tool/result（严格配对，未配对不计入）。">
        {analysis.tools.length === 0
          ? <Placeholder text="该会话没有成功配对的工具调用。" anchor="t7-tools-empty" />
          : <ToolTable tools={analysis.tools} />}
      </Section>
    </>
  )
}

// ---------- 第二层:成本与上下文 ----------

/** 逐轮 token 构成条(未缓存输入/缓存读/输出三段)。 */
function TurnTokenBar({ turn, max }: { readonly turn: TraceTurn; readonly max: number }): ReactElement {
  const hit = cacheHitOf(turn.tokens)
  const total = billedOf(turn.tokens)
  const segment = (key: string, label: string, value: number): ReactElement | null => value <= 0
    ? null
    : (
      <span
        key={key}
        data-t7-cost-seg={key}
        data-share={max > 0 ? String(Math.round((value / max) * 1000) / 10) : '0'}
        style={{ flexGrow: String(value) }}
        title={`${label} ${formatTokens(value)} token`}
      />
    )
  return (
    <div data-t7-cost-row data-t7-turn-token={String(turn.turn)}>
      <span data-t7-cost-name>轮次 {turn.turn} · {turn.steps.length} 步</span>
      <span data-t7-cost-track>
        {segment('input', '未缓存输入', turn.tokens.input)}
        {segment('cache', '缓存读', turn.tokens.cacheRead)}
        {segment('output', '输出', turn.tokens.output)}
      </span>
      <span data-t7-cost-value>
        {formatTokens(total)} · 命中 {hit === null ? '—' : formatPercent(hit)}
      </span>
    </div>
  )
}

/**
 * 上下文水位柱状图。
 *
 * 参考线只标本会话实算的点数分位(最高 10%),不标「压缩阈值」这类实现常量——
 * 不同压缩策略阈值不同,写死一个数就是编造。
 */
function PressureChart({ trace }: { readonly trace: SessionTrace }): ReactElement | null {
  const pressure = trace.analysis.pressure
  if (pressure.length === 0) return null
  const peak = trace.analysis.pressurePeak ?? 0
  const window = trace.analysis.contextWindow
  const sorted = pressure.map(row => row.promptTokens).sort((a, b) => a - b)
  const p90 = sorted.length === 0 ? 0 : sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.9))] ?? 0
  return (
    <div data-t7-chart>
      <div data-t7-chart-head>
        <span data-t7-chart-title>上下文水位（每步 prompt token）</span>
        <span data-t7-chart-sub>
          峰值 {formatTokens(peak)}{window !== null && ` / 窗口 ${formatTokens(window)}（${formatPercent(peak / window)}）`} · {pressure.length} 个采样点
        </span>
      </div>
      <div data-t7-chart-bars role="img" aria-label={`上下文水位柱状图，峰值 ${peak} token${window === null ? '' : `，窗口 ${window}`}`}>
        {pressure.map(row => (
          <span
            key={`${row.turn}.${row.step}`}
            data-t7-chart-bar={String(row.promptTokens)}
            data-hot={row.promptTokens >= p90 ? 'true' : 'false'}
            style={{ height: peak > 0 ? `${Math.max(2, Math.round((row.promptTokens / peak) * 100))}%` : '2%' }}
            title={`轮次 ${row.turn} 步 ${row.step}：${formatTokens(row.promptTokens)} prompt token`}
          />
        ))}
      </div>
      <div data-t7-chart-axis>
        <span>会话开始</span>
        <span>{pressure.length} 步</span>
        <span>会话结束</span>
      </div>
      <div data-t7-chart-legend>
        <span data-t7-chart-legend-item>最高 10% 采样点（≥ {formatTokens(p90)}）</span>
        <span data-t7-chart-legend-item>其余采样点</span>
      </div>
    </div>
  )
}

/** 第二层:成本与上下文。 */
function CostLayer({ trace }: { readonly trace: SessionTrace }): ReactElement {
  const analysis = trace.analysis
  const tokens = analysis.tokens
  const hit = analysis.cacheHitRate
  const peak = analysis.pressurePeak
  const window = analysis.contextWindow
  const utilization = peak !== null && window !== null && window > 0 ? peak / window : null
  const findings: Finding[] = []

  // 结论 1:缓存命中率。
  if (hit !== null) {
    findings.push({
      tag: '缓存',
      severity: hit < 0.5 ? 'medium' : 'low',
      title: `缓存命中率 ${formatPercent(hit)}`,
      text: hit >= 0.5
        ? `大部分 prompt 走了缓存读，实际按未缓存价计费的输入只有 ${formatTokens(tokens.input)} token。`
        : `命中率偏低，多数 prompt 按未缓存输入计费（${formatTokens(tokens.input)} token）。`,
      evidence: `cacheRead=${tokens.cacheRead} / (input ${tokens.input} + cacheRead ${tokens.cacheRead} + cacheWrite ${tokens.cacheWrite}) = ${formatPercent(hit)}\n`
        + `判据：缓存桶从未上报时为「未知」，不伪报 0。`,
    })
  }

  // 结论 2:上下文峰值占用。
  if (peak !== null && window !== null && utilization !== null) {
    findings.push({
      tag: '上下文',
      severity: utilization > 0.8 ? 'high' : utilization > 0.5 ? 'medium' : 'low',
      title: `峰值占用 ${formatPercent(utilization)}（${formatTokens(peak)} / ${formatTokens(window)}）`,
      text: utilization > 0.8
        ? `已用窗口的 ${formatPercent(utilization)}，剩余 ${formatTokens(window - peak)} token。`
        : `离窗口上限还有 ${formatTokens(window - peak)} token 余量（占用 ${formatPercent(utilization)}）。`,
      evidence: `采样 ${analysis.pressure.length} 次，峰值 ${peak}，窗口 ${window}\n`
        + `判据：窗口取自 request/context.contextWindow；峰值取自各步 input+cacheRead+cacheWrite 的最大值。`,
    })
  }

  // 结论 3:压缩。只陈述事实,不推断对缓存的影响(需要跨会话对比)。
  if (analysis.compaction.events > 0 || analysis.compaction.prunedTokens > 0) {
    findings.push({
      tag: '压缩',
      severity: analysis.compaction.failures > 0 ? 'medium' : 'low',
      title: `发生 ${analysis.compaction.events} 次压缩，累计剪除 ${formatTokens(analysis.compaction.prunedTokens)} token`,
      text: analysis.compaction.failures > 0
        ? `其中 ${analysis.compaction.failures} 次压缩本身报了错误（见判据）。`
        : '压缩会改变 prompt 前缀结构；它对缓存命中率的影响需跨会话对比才能判断，单会话内不下结论。',
      evidence: `compaction/start ×${analysis.compaction.events}；compaction/prune 累计 shadowedTokenCount=${analysis.compaction.prunedTokens}；`
        + `compaction/end 带 error 的有 ${analysis.compaction.failures} 次`,
    })
  }

  // 结论 4:失败尝试(通常意味着重试,直接影响计费)。
  if (analysis.attempts.length > 0) {
    findings.push({
      tag: '重试',
      severity: analysis.attempts.length > 3 ? 'medium' : 'low',
      title: `${analysis.attempts.length} 次模型尝试未产出可见消息`,
      text: '这些尝试没有提交 assistant 消息（assistant/attempt），但其 prompt token 已计入成本；其等待时间同样计入对应 step 的等首字。',
      evidence: analysis.attempts.slice(0, 10).map((attempt: TraceAttempt) =>
        `轮次 ${attempt.turn} 步 ${attempt.step}：等首字 ${attempt.ttftMs === null ? '—' : `${attempt.ttftMs}ms`}，流时长 ${attempt.streamMs === null ? '—' : `${attempt.streamMs}ms`}`).join('\n'),
    })
  }

  const maxTurn = Math.max(1, ...trace.turns.map(turn => billedOf(turn.tokens)))

  return (
    <>
      <div data-t7-tiles>
        <Tile label="计费 token" anchor="billed" value={formatTokens(tokens.billed)}
          note={`输入 ${formatTokens(tokens.input)} · 缓存读 ${formatTokens(tokens.cacheRead)} · 输出 ${formatTokens(tokens.output)}`} />
        <Tile label="缓存命中率" anchor="cache-hit" tone="success"
          value={hit === null ? '—' : formatPercent(hit)}
          note={hit === null ? '日志未上报缓存桶' : '缓存读 / 全部 prompt token'} />
        <Tile label="上下文峰值" anchor="pressure" value={peak === null ? '—' : formatTokens(peak)}
          note={utilization === null ? '窗口未知' : `窗口 ${formatTokens(window)} · 占用 ${formatPercent(utilization)}`} />
        <Tile label="压缩" anchor="compaction" value={String(analysis.compaction.events)}
          note={`剪除 ${formatTokens(analysis.compaction.prunedTokens)} token`} />
      </div>

      {findings.length > 0 && (
        <Section title="成本结论" anchor="cost-findings"
          note="token 口径与 DSH TokenUsage 一致：input = 未缓存输入，cacheRead/cacheWrite 单列，output 含推理 token。">
          <div data-t7-findings>
            {findings.map(finding => <FindingCard key={finding.tag} finding={finding} />)}
          </div>
        </Section>
      )}

      <Section title="逐轮 token 构成" anchor="turn-tokens"
        note="三段互斥：未缓存输入按输入价计费，缓存读按缓存价，输出按输出价。">
        {trace.turns.length === 0
          ? <Placeholder text="该会话暂无轮次数据。" anchor="t7-tokens-empty" />
          : (
            <div data-t7-cost-bars>
              {trace.turns.map(turn => <TurnTokenBar key={turn.turn} turn={turn} max={maxTurn} />)}
            </div>
          )}
      </Section>

      <Layer name="上下文水位" render={() => {
        const chart = PressureChart({ trace })
        if (chart === null) {
          return (
            <Section title="上下文水位" anchor="pressure">
              <Placeholder text="该会话没有可用的 token usage 采样点。" anchor="t7-pressure-empty" />
            </Section>
          )
        }
        return <Section title="上下文水位" anchor="pressure">{chart}</Section>
      }} />
    </>
  )
}

// ---------- 第三层:行为复盘 ----------

/** 重复调用行。 */
function RepeatRow({ group }: { readonly group: TraceRepeatGroup }): ReactElement {
  return (
    <div data-t7-repeat-row={group.name}>
      <span data-t7-repeat-name>{group.name}</span>
      <span data-t7-repeat-times>×{group.times}</span>
      <span data-t7-repeat-at>{group.at.join(' / ')}</span>
      <span data-t7-repeat-cost>{formatLongDuration(group.totalMs)}</span>
      <span data-t7-repeat-args>{previewText(group.argsPreview, 120)}</span>
    </div>
  )
}

/** 工具调用行(错误高亮;耗时/参数预览)。 */
function ToolCallRow({ tool }: { readonly tool: TraceToolCall }): ReactElement {
  return (
    <div
      data-t7-trace-tool={tool.name}
      data-t7-tool-error={tool.isError ? 'true' : 'false'}
    >
      <span data-t7-tool-name>{tool.name}</span>
      <span data-t7-tool-duration>{formatDuration(tool.durationMs)}</span>
      {tool.isError && <span data-t7-tool-error-name>{tool.errorName ?? 'error'}</span>}
      <span data-t7-tool-args>{tool.argsPreview}</span>
    </div>
  )
}

/** 审批点行。 */
function ApprovalPointRow({ point }: { readonly point: TraceApprovalPoint }): ReactElement {
  return (
    <div data-t7-approval-point={point.name} data-t7-approval-at={point.at ?? ''}>
      <span data-t7-approval-point-name>{point.name}</span>
      <span data-t7-approval-point-outcome>{point.outcome ?? '未决'}</span>
      <span data-t7-approval-point-time>{formatTime(point.at)}</span>
    </div>
  )
}

/** 单步复核行(步号/等首字/工具/首条工具参数)。 */
function StepRow({ step }: { readonly step: TraceStep }): ReactElement {
  return (
    <div data-t7-replay-step={String(step.step)} data-t7-step-tools={String(step.toolCalls)}>
      <span data-t7-replay-step-no>{step.step}</span>
      <span data-t7-replay-step-ttft>{step.ttftMs === null ? '—' : formatDuration(step.ttftMs)}</span>
      <span data-t7-replay-step-gen>{step.genMs === null ? '—' : formatDuration(step.genMs)}</span>
      <span data-t7-replay-step-tool>{step.toolMs === 0 ? '—' : formatDuration(step.toolMs)}</span>
      <span data-t7-replay-step-names data-t7-muted>
        {step.toolNames.length === 0 ? '（无工具）' : step.toolNames.join('、')}
        {step.toolErrors > 0 && ` · 失败 ${step.toolErrors}`}
      </span>
    </div>
  )
}

/** 第三层:行为复盘(逐轮展开:步骤、工具、审批、推理摘要)。 */
function ReplayLayer({ trace }: { readonly trace: SessionTrace }): ReactElement {
  const analysis = trace.analysis
  const findings: Finding[] = []

  // 结论 1:重复调用(净多出多少次)。
  const extra = analysis.repeats.reduce((sum, group) => sum + (group.times - 1), 0)
  if (extra > 0) {
    const top = analysis.repeats[0]
    findings.push({
      tag: '重复调用',
      severity: 'medium',
      title: `${analysis.repeats.length} 组调用的参数逐字节相同，净多出 ${extra} 次`,
      text: `${top === undefined ? '' : `最多的是 ${top.name}，重复 ${top.times} 次。`}判据为「工具名 + 完整参数字符串逐字节相等」，这些是同一动作的重复发起，不是改参数重试。`,
      evidence: analysis.repeats.slice(0, 5).map(group =>
        `${group.name} ×${group.times}（步骤 ${group.at.join('/')}）累计 ${group.totalMs}ms`).join('\n'),
    })
  }

  // 结论 2:审批点。
  if (analysis.approvals.asked > 0) {
    findings.push({
      tag: '审批',
      severity: 'low',
      title: `本会话提出 ${analysis.approvals.asked} 次审批请求`,
      text: analysis.approvals.decided === analysis.approvals.asked
        ? '全部审批都已有决定结果。'
        : `其中 ${analysis.approvals.asked - analysis.approvals.decided} 次的决定结果不在读取窗口内。`,
      evidence: `approval/asked=${analysis.approvals.asked}，approval/decided(配对成功)=${analysis.approvals.decided}`,
    })
  }

  // 结论 3:未收尾轮次(诚实标注,不猜原因)。
  const openTurns = trace.turns.filter(turn => turn.time.wallMs === null)
  if (openTurns.length > 0) {
    findings.push({
      tag: '未收尾',
      severity: 'low',
      title: `${openTurns.length} 个轮次没有 turn/end`,
      text: '缺少结束事件的轮次没有墙钟，时间归因只能按已观测分量给出（页面已如此标注）。常见于会话被中断或日志尚未落盘。',
      evidence: openTurns.map(turn => `轮次 ${turn.turn}：${turn.steps.length} 步，已观测等首字 ${turn.time.ttftMs}ms / 生成 ${turn.time.genMs}ms / 工具 ${turn.time.toolMs}ms`).join('\n'),
    })
  }

  return (
    <>
      {findings.length > 0 && (
        <Section title="复盘结论" anchor="replay-findings"
          note="这里只复述日志里发生过什么，不对行为好坏做判断。">
          <div data-t7-findings>
            {findings.map(finding => <FindingCard key={finding.tag} finding={finding} />)}
          </div>
        </Section>
      )}

      <Section title="重复调用" anchor="repeats"
        note="判定 = 工具名 + 完整 arguments 字符串逐字节相等（不做 JSON 规范化，键序不同视为不同调用）。">
        {analysis.repeats.length === 0
          ? <Placeholder text="未发现参数完全相同的重复调用。" anchor="t7-repeat-empty" />
          : <div data-t7-repeats>{analysis.repeats.map(group => <RepeatRow key={`${group.name}\u0000${group.argsPreview}`} group={group} />)}</div>}
      </Section>

      <Section title="逐轮执行明细" anchor="replay"
        note="每轮按 step 展开：步级计时、该步工具、审批点与推理摘要。">
        {trace.turns.length === 0
          ? <Placeholder text="该会话暂无轮次数据。" anchor="t7-trace-empty" />
          : (
            <div data-t7-replay-turns>
              {trace.turns.map(turn => (
                <details key={turn.turn} data-t7-replay-turn={String(turn.turn)}>
                  <summary data-t7-replay-summary>
                    <span>轮次 {turn.turn}</span>
                    <span data-t7-muted>{turn.steps.length} 步</span>
                    <span data-t7-muted>{turn.endReason ?? '未收尾'}</span>
                    <span data-t7-mono data-t7-muted>
                      {turn.time.wallMs === null ? '—' : formatLongDuration(turn.time.wallMs)}
                    </span>
                  </summary>
                  <div data-t7-replay-body>
                    <div data-t7-replay-steps>
                      {turn.steps.length === 0
                        ? <span data-t7-muted>（该轮没有 step 级别事件）</span>
                        : turn.steps.map(step => <StepRow key={step.step} step={step} />)}
                    </div>
                    {turn.tools.length > 0 && (
                      <div data-t7-trace-tools>
                        {turn.tools.map(tool => <ToolCallRow key={tool.callId} tool={tool} />)}
                      </div>
                    )}
                    {turn.approvalPoints.length > 0 && (
                      <div data-t7-trace-approvals>
                        {turn.approvalPoints.map(point => (
                          <ApprovalPointRow key={`${point.callId}-${point.at ?? ''}`} point={point} />
                        ))}
                      </div>
                    )}
                    {turn.reasoningPreview !== null && (
                      <div data-t7-reasoning>
                        <span data-t7-reasoning-label>本轮推理摘要（截断）</span>
                        <pre data-t7-reasoning-text>{turn.reasoningPreview}</pre>
                      </div>
                    )}
                  </div>
                </details>
              ))}
            </div>
          )}
      </Section>
    </>
  )
}

// ---------- 详情容器 ----------

/** 选中会话的分析视图(三层并列)。 */
function TraceDetail({ selected, onBack, t }: {
  readonly selected: SessionTrace
  readonly onBack: () => void
  readonly t: (key: string) => string
}): ReactElement {
  const analysis = selected.analysis
  const title = analysis.title.trim()
  return (
    <div data-t7-trace-detail data-t7-trace-session={selected.sessionId}>
      <div data-t7-trace-toolbar>
        <button type="button" data-t7-trace-back onClick={onBack}>{t('back')}</button>
        <span data-t7-trace-session-title>{title === '' ? selected.sessionId : title}</span>
        <span data-t7-trace-session-id>{selected.sessionId}</span>
      </div>
      <div data-t7-trace-meta>
        <span data-t7-trace-meta-item="route">{analysis.route ?? '路由未知'}</span>
        <span data-t7-trace-meta-item="created">{formatTime(analysis.session.createdAt)}</span>
        {analysis.session.preset !== null && <span data-t7-trace-meta-item="preset">{analysis.session.preset}</span>}
        {analysis.session.cwd !== null && <span data-t7-trace-meta-item="cwd" data-t7-mono>{previewText(analysis.session.cwd, 60)}</span>}
        <span data-t7-trace-events>
          {t('trace.events')} {selected.events.total} · 投影 {selected.events.projected} · 跳过 {selected.events.skipped}
        </span>
      </div>

      {selected.turns.length === 0
        ? <p data-t7-placeholder data-t7-trace-empty="true">{t('trace.detail.empty')}</p>
        : (
          <div data-t7-layers>
            <section data-t7-layer="diag">
              <h2 data-t7-layer-title>性能诊断</h2>
              <p data-t7-layer-note>时间花在哪里、哪一步最慢、哪个工具最贵。全部由日志时刻直接算出。</p>
              <Layer name="性能诊断" render={() => <DiagnosticLayer trace={selected} />} />
            </section>
            <section data-t7-layer="cost">
              <h2 data-t7-layer-title>成本与上下文</h2>
              <p data-t7-layer-note>token 怎么花、上下文窗口吃紧到什么程度、压缩与重试发生过几次。</p>
              <Layer name="成本与上下文" render={() => <CostLayer trace={selected} />} />
            </section>
            <section data-t7-layer="replay">
              <h2 data-t7-layer-title>行为复盘</h2>
              <p data-t7-layer-note>逐轮逐 step 回放：调了什么、重复了什么、哪些轮次没有收尾。</p>
              <Layer name="行为复盘" render={() => <ReplayLayer trace={selected} />} />
            </section>
          </div>
        )}
    </div>
  )
}

/** 循环轨迹根组件。 */
export function TracePage({ useTrace, refresh, openSession, t }: TracePageProps): ReactElement {
  const state = useTrace(s => s)

  return (
    <div data-t7-trace-root aria-label={t('trace')}>
      <div data-t7-toolbar>
        <h1 data-t7-heading>{t('trace')}</h1>
        <button type="button" data-t7-refresh onClick={refresh}>{t('refresh')}</button>
      </div>
      <p data-t7-sub>{t('trace.subtitle')}</p>

      {state.status === 'loading' && <p data-t7-placeholder>{t('state.loading')}</p>}
      {state.status === 'error' && <p data-t7-error>{t('state.error')}: {state.message}</p>}

      {state.status === 'ready' && (
        <>
          <p data-t7-trace-pipeline>
            {t('trace.pipeline')}: <span data-t7-trace-pipeline-name>{state.report.pipeline}</span>
            {' · '}{previewText(state.report.sessionsRoot, 80)}
          </p>
          {state.report.selected !== null
            ? (
              <TraceDetail
                selected={state.report.selected}
                onBack={refresh}
                t={t}
              />
            )
            : (
              <div data-t7-session-list>
                {state.report.sessions.length === 0
                  ? <p data-t7-placeholder data-t7-sessions-empty="true">{t('state.empty')}</p>
                  : state.report.sessions.map(session => (
                    <SessionCard key={session.sessionId} session={session} onOpen={openSession} />
                  ))}
              </div>
            )}
        </>
      )}
    </div>
  )
}
