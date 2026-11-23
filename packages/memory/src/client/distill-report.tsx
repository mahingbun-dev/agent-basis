/**
 * 全局蒸馏报告页(plugins.tab「全局蒸馏」页签;M-M4,18 号 §8 + §10「admin
 * 全局蒸馏报告页挂 plugins.tab」):admin 专属内容,非 admin 经端点 403 反馈
 * 显示无权文案(settings.section 同款降级)。三块:
 * - 部署门(管理员授权链,Q4:开启两击确认 + 隐私声明常驻;关闭单击,随时可停);
 * - 运行状态(latest 报告计数 + 手动运行 + 刷新);
 * - 聚类报告(≥K 簇清单,全部掩码字段)+ 候选区(Phase B quarantine:门禁摘要、
 *   G2 降级如实标注、探针态、签发两击/拒绝)。
 *
 * 交互纪律(AGENTS.md §3):两击确认禁用原生 confirm/alert;反馈就地 aria-live;
 * 深浅主题走 --et-* 令牌(DSH 桥接别名随壳)。
 */
import { useCallback, useEffect, useState } from 'react'
import { Icon } from '@eterna/ui/icons'
import type { ConnectionRpc, MemoryDistillViewData } from './settings.tsx'
import { MEMORY_DISTILL_VIEW_ENDPOINT } from './settings.tsx'

export const MEMORY_DISTILL_TAB_ID = 'eterna-memory.distill'
export const MEMORY_DISTILL_REPORT_ENDPOINT = 'eternaMemory/distillReport'
export const MEMORY_DISTILL_ENABLE_ENDPOINT = 'eternaMemory/distillEnable'
export const MEMORY_DISTILL_RUN_ENDPOINT = 'eternaMemory/distillRun'
export const MEMORY_DISTILL_CANDIDATES_ENDPOINT = 'eternaMemory/distillCandidates'
export const MEMORY_DISTILL_RELEASE_ENDPOINT = 'eternaMemory/distillCandidateRelease'
export const MEMORY_DISTILL_REJECT_ENDPOINT = 'eternaMemory/distillCandidateReject'

/** 聚类行(报告 clusters 元素;与宿主 DistillCluster 同形,客户端自承载)。 */
export interface DistillClusterView {
  label: string
  sharedTokens: readonly string[]
  userCount: number
  accounts: readonly string[]
  entriesCount: number
  kindCounts: Readonly<Record<string, number>>
  domainCounts: Readonly<Record<string, number>>
  examples: readonly string[]
}

/** 报告视图(与宿主 DistillReport 同形;客户端自承载——bundle 不 import 宿主)。 */
export interface DistillReportView {
  schema: string
  generatedAt: number
  windowStart: number
  totals: { accounts: number; participating: number; optedOut: number; entities: number }
  minUsers: number
  sampleSufficient: boolean
  clusters: readonly DistillClusterView[]
  errors: readonly { account: string; message: string }[]
}

/** 候选门禁摘要(meta.gate;与宿主 DistillCandidateGateSummary 同形)。 */
export interface DistillCandidateGateView {
  verdict: 'pass' | 'fail'
  g0Pass: boolean
  g0Detail: string
  g1Pass: boolean
  g1Detail: string
  g2Detail: string
  g2Skipped: boolean
  probe: 'pass' | 'fail' | 'not-run'
  probeFindings: readonly { probeId: string; detail: string }[]
}

/** 候选 meta(与宿主 DistillCandidateMeta 同形)。 */
export interface DistillCandidateMetaView {
  id: string
  ledgerId: number
  createdAt: number
  mastLabel: string
  rationale: string
  draftSource: 'model' | 'template'
  cluster: { label: string; userCount: number; accounts: readonly string[]; sharedTokens: readonly string[]; examples: readonly string[] }
  body: string
  appliedOk: boolean
  applyError?: string
  gate: DistillCandidateGateView
  decision: { action: 'released' | 'rejected'; at: number; operator: string; artifact?: string } | null
}

interface MemoryStateErrorLike {
  ok: false
  code: 'forbidden' | 'unauthorized' | 'invalid' | 'unavailable'
  message: string
}

export const DISTILL_LOCALES = {
  distillTab: '全局蒸馏',
  distillNeedAdmin: '全局蒸馏为管理员专用,当前账号无权查看。',
  distillNeedLogin: '登录已过期,请重新登录。',
  distillGateTitle: '部署开关',
  distillGateOn: '已开启',
  distillGateOff: '未开启(默认关,Q4)',
  distillGateEnable: '开启全局蒸馏',
  distillGateConfirm: '确认开启(再次点击)',
  distillGateDisable: '关闭全局蒸馏',
  distillPrivacy: '隐私声明:开启后,蒸馏任务以只读方式聚合各参与账号的已批准记忆,产出跨用户共性计数报告与候选行为指令;报告不含记忆原文(样例经脱敏),中间产物不进入任何 agent 上下文;每个账号可在「设置 → 记忆」退出参与。',
  distillRunTitle: '运行状态',
  distillRunNow: '立即运行一次',
  distillRunning: '运行中…',
  distillRefresh: '刷新',
  distillNeverRun: '尚未运行(每个会话尾按间隔自动触发,或点「立即运行一次」)。',
  distillSampleShort: '样本不足:参与账号数低于阈值,不产出候选(冷启动如实标注)。',
  distillAccounts: '参与账号',
  distillOptedOut: '已退出',
  distillEntities: '纳入条目',
  distillClusters: '≥K 簇',
  distillClustersTitle: '跨用户共性簇',
  distillNoClusters: '暂无达标簇(同一模式需 ≥K 个独立账号命中)。',
  distillCandidatesTitle: '候选(Phase B quarantine)',
  distillNoCandidates: '暂无候选(有达标簇的下一次运行自动起草)。',
  distillCandidateRelease: '签发(生成人工合入产物)',
  distillCandidateConfirm: '确认签发(再次点击)',
  distillCandidateReject: '拒绝',
  cancel: '取消',
  distillReleased: '已签发',
  distillRejected: '已拒绝',
  distillStatusProposed: '待验证',
  distillStatusVerified: '待签发',
  distillGateG0: 'G0 lint',
  distillGateG1: 'G1 replay',
  distillGateG2: 'G2 ai-evo',
  distillGateG2Skipped: 'G2 降级跳过(ai-evo 未接入,账本明示)',
  distillProbe: '探针',
  distillProbePass: '通过',
  distillProbeFail: '未过(签发禁用)',
  distillViewBody: '查看候选正文',
  distillLoadFailed: '读取失败',
  distillActionFailed: '操作失败',
  distillActionDone: '已完成',
  pass: '过',
  fail: '未过',
} as const

export type DistillLocaleKey = keyof typeof DISTILL_LOCALES

const CSS_DISTILL = `
[data-eterna-memory-distill] { color: var(--et-fg); font-family: var(--et-font-body); font-size: var(--et-text-body); line-height: var(--et-leading-body); max-width: 860px; }
[data-eterna-memory-distill] * { box-sizing: border-box; min-width: 0; }
[data-eterna-memory-distill] .em-card { padding: var(--et-space-4); border: 1px solid var(--et-border-soft); border-radius: var(--et-radius-md); background: var(--et-surface); margin: 0 0 var(--et-space-3); }
[data-eterna-memory-distill] .em-head { display: flex; align-items: center; gap: 8px; margin: 0 0 var(--et-space-2); }
[data-eterna-memory-distill] .em-head h3 { margin: 0; font-size: var(--et-text-lead); font-weight: var(--et-weight-display); }
[data-eterna-memory-distill] .em-kicker { font-size: var(--et-text-meta); letter-spacing: var(--et-tracking-caps); color: var(--et-muted); margin: 0 0 var(--et-space-1); }
[data-eterna-memory-distill] .em-stats { display: flex; gap: var(--et-space-4); flex-wrap: wrap; font-variant-numeric: tabular-nums; }
[data-eterna-memory-distill] .em-stat b { font-size: var(--et-text-lead); font-weight: var(--et-weight-display); }
[data-eterna-memory-distill] .em-privacy { padding: var(--et-space-3); border: 1px dashed var(--et-border); border-radius: var(--et-radius-md); font-size: var(--et-text-caption); color: var(--et-muted); margin: 0 0 var(--et-space-3); }
[data-eterna-memory-distill] .em-btn { display: inline-flex; align-items: center; gap: 6px; padding: 7px 12px; border: 1px solid var(--et-accent); border-radius: var(--et-radius-sm); background: var(--et-accent); color: var(--et-fg); font: inherit; font-weight: var(--et-weight-display); cursor: pointer; }
[data-eterna-memory-distill] .em-btn.ghost { background: none; color: var(--et-fg-2); border-color: var(--et-border); }
[data-eterna-memory-distill] .em-btn.danger { background: none; color: var(--et-danger); border-color: var(--et-danger); }
[data-eterna-memory-distill] .em-btn:focus-visible { outline: 2px solid var(--et-accent); outline-offset: 2px; }
[data-eterna-memory-distill] .em-btn:disabled { opacity: 0.55; cursor: not-allowed; }
[data-eterna-memory-distill] .em-row { display: flex; align-items: center; gap: var(--et-space-3); flex-wrap: wrap; }
[data-eterna-memory-distill] .em-note { font-size: var(--et-text-caption); color: var(--et-muted); }
[data-eterna-memory-distill] .em-note[data-ok='false'] { color: var(--et-danger); }
[data-eterna-memory-distill] .em-note[data-ok='true'] { color: var(--et-fg-2); }
[data-eterna-memory-distill] table { width: 100%; border-collapse: collapse; font-size: var(--et-text-caption); }
[data-eterna-memory-distill] th { text-align: left; color: var(--et-muted); font-weight: var(--et-weight-display); padding: 4px 8px; border-bottom: 1px solid var(--et-border-soft); }
[data-eterna-memory-distill] td { padding: 6px 8px; border-bottom: 1px solid var(--et-border-soft); vertical-align: top; }
[data-eterna-memory-distill] td.num { font-variant-numeric: tabular-nums; white-space: nowrap; }
[data-eterna-memory-distill] .em-chip { display: inline-block; padding: 1px 10px; border: 1px solid var(--et-border); border-radius: var(--et-radius-pill); font-size: var(--et-text-meta); color: var(--et-fg-2); white-space: nowrap; }
[data-eterna-memory-distill] .em-chip[data-tone='ok'] { color: var(--et-fg-2); border-color: var(--et-fg-2); }
[data-eterna-memory-distill] .em-chip[data-tone='warn'] { color: var(--et-muted); }
[data-eterna-memory-distill] .em-chip[data-tone='bad'] { color: var(--et-danger); border-color: var(--et-danger); }
[data-eterna-memory-distill] details.em-body { margin: 4px 0; }
[data-eterna-memory-distill] details.em-body summary { cursor: pointer; color: var(--et-accent); font-size: var(--et-text-caption); }
[data-eterna-memory-distill] details.em-body pre { margin: 6px 0 0; padding: var(--et-space-3); border: 1px solid var(--et-border-soft); border-radius: var(--et-radius-sm); background: var(--et-surface-2); white-space: pre-wrap; word-break: break-word; font-size: var(--et-text-caption); }
[data-eterna-memory-distill] .em-empty { padding: var(--et-space-5) 0; color: var(--et-muted); }
@media (max-width: 760px) { [data-eterna-memory-distill] .em-row { align-items: flex-start; flex-direction: column; } }
@media (prefers-reduced-motion: reduce) { [data-eterna-memory-distill] * { animation: none !important; transition: none !important; } }
`
export { CSS_DISTILL as CSS }

function fmtInt(n: number): string {
  return n.toLocaleString('zh-CN')
}

function fmtTime(ms: number): string {
  return new Date(ms).toLocaleString('zh-CN', { hour12: false })
}

export interface DistillReportSectionProps {
  readonly t: (key: string) => string
  readonly connection: ConnectionRpc
}

/** 侧栏「插件」页「全局蒸馏」页签(admin 内容;403 → 无权文案)。 */
export function DistillReportSection(props: DistillReportSectionProps): React.JSX.Element {
  const { t, connection } = props
  const [view, setView] = useState<MemoryDistillViewData | null>(null)
  const [report, setReport] = useState<DistillReportView | null | undefined>(undefined)
  const [candidates, setCandidates] = useState<readonly { meta: DistillCandidateMetaView; ledgerStatus: string }[] | undefined>(undefined)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [armEnable, setArmEnable] = useState(false)
  const [armRelease, setArmRelease] = useState<string | null>(null)
  const [feedback, setFeedback] = useState<{ ok: boolean | null; text: string }>({ ok: null, text: '' })
  /** 非 admin 命中 admin 端点 forbidden(T6.2 插件页全员可见后):渲染只读无权文案,
   *  而不是把 forbidden 静默吞成空表(前者是「看到空 admin 界面」的既有缺陷)。 */
  const [denied, setDenied] = useState(false)

  const call = useCallback(async (endpoint: string, payload: unknown): Promise<unknown> => {
    const result = await connection.rpc.call('/api', endpoint, { args: payload })
    if (!result.ok) throw new Error(result.error?.message ?? t('distillActionFailed'))
    return result.value
  }, [connection, t])

  const load = useCallback(async (): Promise<void> => {
    try {
      const [viewValue, reportValue, candidatesValue] = await Promise.all([
        call(MEMORY_DISTILL_VIEW_ENDPOINT, {}) as Promise<MemoryDistillViewData>,
        call(MEMORY_DISTILL_REPORT_ENDPOINT, {}) as Promise<{ ok: true; report: DistillReportView | null } | MemoryStateErrorLike>,
        call(MEMORY_DISTILL_CANDIDATES_ENDPOINT, {}) as Promise<{ ok: true; candidates: readonly { meta: DistillCandidateMetaView; ledgerStatus: string }[] } | MemoryStateErrorLike>,
      ])
      setView(viewValue)
      setReport(reportValue.ok === true ? reportValue.report : null)
      setCandidates(candidatesValue.ok === true ? candidatesValue.candidates : [])
      // T6.2:admin 端点对非 admin 返回**值** `{ok:false,code:'forbidden'}`
      // (不是异常)——此前被 `ok===true ? … : null/[]` 静默吞成空表,非 admin 看到
      // 一个空的 admin 界面。改为置 denied 渲染无权文案。
      const forbidden = [reportValue, candidatesValue].find(v => v.ok === false && v.code === 'forbidden')
      setDenied(forbidden !== undefined)
      setError(null)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('distillLoadFailed'))
    }
  }, [call, t])

  useEffect(() => {
    let alive = true
    void (async () => {
      if (!alive) return
      await load()
    })()
    return () => { alive = false }
  }, [load])

  const act = async (endpoint: string, payload: unknown, doneText: string): Promise<void> => {
    if (busy) return
    setBusy(true)
    setFeedback({ ok: null, text: '' })
    try {
      await call(endpoint, payload)
      setFeedback({ ok: true, text: doneText })
      await load()
    } catch (cause) {
      setFeedback({ ok: false, text: `${t('distillActionFailed')}:${cause instanceof Error ? cause.message : String(cause)}` })
    } finally {
      setBusy(false)
      setArmEnable(false)
      setArmRelease(null)
    }
  }

  if (error !== null && view === null) {
    return <div data-eterna-memory-distill><div className="em-empty">{t('distillLoadFailed')}:{error}</div></div>
  }
  if (denied) {
    return <div data-eterna-memory-distill data-eterna-distill-denied><div className="em-empty">{t('distillNeedAdmin')}</div></div>
  }
  if (view === null) {
    return <div data-eterna-memory-distill><div className="em-empty">{t('loading')}</div></div>
  }
  if (view.ok !== true) {
    const text = view.code === 'unauthorized' ? t('distillNeedLogin')
      : view.code === 'forbidden' ? t('distillNeedAdmin') : `${t('distillLoadFailed')}:${view.message ?? ''}`
    return <div data-eterna-memory-distill><div className="em-empty">{text}</div></div>
  }
  const enabled = view.deploymentEnabled === true
  const tr = (key: string): string => t(key)
  return (
    <div data-eterna-memory-distill>
      <div className="em-card">
        <div className="em-head"><Icon name="settings" size={16} /><h3>{tr('distillGateTitle')}</h3></div>
        <p className="em-privacy">{tr('distillPrivacy')}</p>
        <div className="em-row">
          <span className="em-chip" data-tone={enabled ? 'ok' : 'warn'}>{enabled ? tr('distillGateOn') : tr('distillGateOff')}</span>
          {enabled ? (
            <button type="button" className="em-btn ghost" disabled={busy}
              onClick={() => { void act(MEMORY_DISTILL_ENABLE_ENDPOINT, { enabled: false }, tr('distillActionDone')) }}>
              <Icon name="settings" size={12} />{tr('distillGateDisable')}
            </button>
          ) : (
            <button type="button" className="em-btn" disabled={busy}
              onClick={() => {
                // 两击确认(AGENTS.md §3,禁原生 confirm):第一击亮确认文案,第二击执行。
                if (!armEnable) { setArmEnable(true); return }
                void act(MEMORY_DISTILL_ENABLE_ENDPOINT, { enabled: true }, tr('distillActionDone'))
              }}>
              <Icon name="check" size={12} />{armEnable ? tr('distillGateConfirm') : tr('distillGateEnable')}
            </button>
          )}
          {armEnable && (
            <button type="button" className="em-btn ghost" disabled={busy}
              onClick={() => { setArmEnable(false) }}>{tr('cancel')}</button>
          )}
        </div>
        <span className="em-note" data-ok={feedback.ok === null ? undefined : String(feedback.ok)} role="status" aria-live="polite">{
          feedback.text !== '' ? feedback.text : ''
        }</span>
      </div>
      <div className="em-card">
        <div className="em-head"><Icon name="memory" size={16} /><h3>{tr('distillRunTitle')}</h3></div>
        {report === undefined || report === null
          ? <p className="em-note">{tr('distillNeverRun')}</p>
          : (
            <>
              <div className="em-stats">
                <span className="em-kicker">{new Date(report.generatedAt).toLocaleString('zh-CN', { hour12: false })}</span>
                <span className="em-stat">{tr('distillAccounts')} <b>{fmtInt(report.totals.participating)}</b></span>
                <span className="em-stat">{tr('distillOptedOut')} <b>{fmtInt(report.totals.optedOut)}</b></span>
                <span className="em-stat">{tr('distillEntities')} <b>{fmtInt(report.totals.entities)}</b></span>
                <span className="em-stat">{tr('distillClusters')} <b>{fmtInt(report.clusters.length)}</b></span>
              </div>
              {!report.sampleSufficient && <p className="em-note" style={{ color: 'var(--et-muted)' }}>{tr('distillSampleShort')}</p>}
            </>
          )}
        <div className="em-row" style={{ marginTop: 'var(--et-space-3)' }}>
          <button type="button" className="em-btn" disabled={busy}
            onClick={() => { void act(MEMORY_DISTILL_RUN_ENDPOINT, {}, tr('distillActionDone')) }}>
            <Icon name="check" size={12} />{busy ? tr('distillRunning') : tr('distillRunNow')}
          </button>
          <button type="button" className="em-btn ghost" disabled={busy} onClick={() => { void load() }}>
            {tr('distillRefresh')}
          </button>
        </div>
      </div>
      <div className="em-card">
        <div className="em-head"><Icon name="memory" size={16} /><h3>{tr('distillClustersTitle')}</h3></div>
        {report !== null && report !== undefined && report.clusters.length > 0
          ? (
            <table>
              <thead>
                <tr><th>{tr('distillClustersTitle')}</th><th className="num">K(账号)</th><th className="num">{tr('distillEntities')}</th><th>共享词</th></tr>
              </thead>
              <tbody>
                {report.clusters.map((cluster, index) => (
                  <tr key={`${cluster.label}-${index}`}>
                    <td style={{ maxWidth: 320 }}>{cluster.label}</td>
                    <td className="num">{fmtInt(cluster.userCount)}</td>
                    <td className="num">{fmtInt(cluster.entriesCount)}</td>
                    <td>{cluster.sharedTokens.join('、') || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )
          : <div className="em-empty">{tr('distillNoClusters')}</div>}
      </div>
      <div className="em-card">
        <div className="em-head"><Icon name="memory" size={16} /><h3>{tr('distillCandidatesTitle')}</h3></div>
        {candidates === undefined || candidates.length === 0
          ? <div className="em-empty">{tr('distillNoCandidates')}</div>
          : (
            <div style={{ display: 'grid', gap: 'var(--et-space-3)' }}>
              {candidates.map(({ meta, ledgerStatus }) => {
                const releasable = ledgerStatus === 'verified' && meta.decision === null && meta.gate.probe === 'pass'
                return (
                  <div key={meta.id} style={{ borderTop: '1px solid var(--et-border-soft)', paddingTop: 'var(--et-space-3)' }}>
                    <div className="em-row">
                      <span className="em-chip" data-tone={meta.decision !== null ? 'warn' : ledgerStatus === 'verified' ? 'ok' : 'bad'}>
                        {meta.decision?.action === 'released' ? tr('distillReleased')
                          : meta.decision?.action === 'rejected' ? tr('distillRejected')
                            : ledgerStatus === 'verified' ? tr('distillStatusVerified') : tr('distillStatusProposed')}
                      </span>
                      <span className="em-note">{meta.id} · {fmtTime(meta.createdAt)} · {meta.draftSource === 'model' ? 'curator' : '模板'}</span>
                    </div>
                    <p className="em-note" style={{ margin: '4px 0' }}>{meta.rationale}(簇:{meta.cluster.userCount} 账号)</p>
                    <div className="em-row">
                      <span className="em-chip" data-tone={meta.gate.g0Pass ? 'ok' : 'bad'}>{tr('distillGateG0')} {meta.gate.g0Pass ? tr('pass') : tr('fail')}</span>
                      <span className="em-chip" data-tone={meta.gate.g1Pass ? 'ok' : 'bad'}>{tr('distillGateG1')} {meta.gate.g1Pass ? tr('pass') : tr('fail')}</span>
                      <span className="em-chip" data-tone={meta.gate.g2Skipped ? 'warn' : meta.gate.verdict === 'pass' ? 'ok' : 'bad'} title={meta.gate.g2Detail}>
                        {meta.gate.g2Skipped ? tr('distillGateG2Skipped') : `${tr('distillGateG2')} ${meta.gate.verdict === 'pass' ? tr('pass') : tr('fail')}`}
                      </span>
                      <span className="em-chip" data-tone={meta.gate.probe === 'pass' ? 'ok' : 'bad'}>
                        {tr('distillProbe')} {meta.gate.probe === 'pass' ? tr('distillProbePass') : tr('distillProbeFail')}
                      </span>
                    </div>
                    {meta.gate.probeFindings.length > 0 && (
                      <p className="em-note" data-ok="false" style={{ margin: '4px 0' }}>
                        {meta.gate.probeFindings.map(finding => `${finding.probeId}:${finding.detail}`).join(' | ')}
                      </p>
                    )}
                    <details className="em-body">
                      <summary>{tr('distillViewBody')}</summary>
                      <pre>{meta.body}</pre>
                    </details>
                    {meta.decision?.action === 'released' && meta.decision.artifact !== undefined && (
                      <p className="em-note" data-ok="true" style={{ margin: '4px 0' }}>{tr('distillReleased')} → {meta.decision.artifact}({meta.decision.operator})</p>
                    )}
                    {meta.decision === null && (
                      <div className="em-row" style={{ marginTop: 'var(--et-space-2)' }}>
                        <button type="button" className="em-btn" disabled={busy || !releasable}
                          title={releasable ? undefined : tr('distillProbeFail')}
                          onClick={() => {
                            // 两击确认:SME 签发是显式人审动作(账本 released 不可逆)。
                            if (armRelease !== meta.id) { setArmRelease(meta.id); return }
                            void act(MEMORY_DISTILL_RELEASE_ENDPOINT, { id: meta.id }, tr('distillActionDone'))
                          }}>
                          <Icon name="check" size={12} />{armRelease === meta.id ? tr('distillCandidateConfirm') : tr('distillCandidateRelease')}
                        </button>
                        <button type="button" className="em-btn ghost" disabled={busy}
                          onClick={() => { void act(MEMORY_DISTILL_REJECT_ENDPOINT, { id: meta.id }, tr('distillActionDone')) }}>
                          {tr('distillCandidateReject')}
                        </button>
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )}
      </div>
    </div>
  )
}
