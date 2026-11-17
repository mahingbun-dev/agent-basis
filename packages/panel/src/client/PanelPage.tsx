/**
 * 基座面板主页面(main keyed slot 的 occupant):区块序 = 工作区记忆(待审
 * 队列/画像/功能域/指标/记忆分组)→ 服务清单 → 操作指南(三步上手并入)→
 * 可观测样例 → 上下文压缩。数据经 inject 面到达(props.useSnapshot /
 * props.refresh / props.review),不触 ctx。
 * DOM 全部带 data-eterna-panel* 结构化锚点,供 E2E 严断言定位(非全文匹配)。
 */
import { useCallback, useEffect, useRef, useState, type ComponentProps, type ReactElement, type ReactNode } from 'react'
import { Icon } from '@eterna/ui/icons'
import type { EternaPanelSnapshot, MemoryPendingView, ToolCard } from '../types.ts'
import { GUIDE_PROMPTS } from '../prompts.ts'
import { toolLocale } from './locales.ts'
import { correctionPrefillText, setCorrectionPrefill } from './correction-bridge.ts'
import type { ReviewFn, TrackCorrectionFn } from './index.ts'

/** 区块头图标名(@eterna/ui/icons 的 Icon name 联合类型)。 */
type SectionIcon = ComponentProps<typeof Icon>['name']

/** 快照加载状态(inject hooks 份额的快照值)。 */
export type PanelSnapshotState =
  | { readonly status: 'loading' }
  | { readonly status: 'ready', readonly snapshot: EternaPanelSnapshot }
  | { readonly status: 'error', readonly message: string }

/** 面板组件 props(inject 面注入:hooks.snapshot → useSnapshot 选择器钩子,加 refresh/review 回调)。 */
export interface PanelPageProps {
  /**
   * hooks 份额绑定的选择器钩子(SnapshotSelectorHook 形态:必传 selector,
   * dsh-client-store contract.ts:`<S>(sel: (s: T) => S) => S`)。
   */
  readonly useSnapshot: <S>(selector: (state: PanelSnapshotState) => S) => S
  /** 重新拉取快照。 */
  readonly refresh: () => void
  /**
   * 记忆裁决回调(M-M2 T9):批/拒待审记忆,经宿主 eternaPanel/review 端点
   * (Memory.review 软失效语义);成功后自动刷新快照。
   */
  readonly review: ReviewFn
  /** 画像纠正留痕回调(T13 指标埋点):fire-and-forget,失败静默不打断纠正。 */
  readonly trackCorrection?: TrackCorrectionFn
  /**
   * 最近压缩 checkpoint 拉取回调(M-C4 视图):走 eternaCompaction/
   * recentCheckpoints(管理员可见);缺席=宿主未提供该端点(老宿主),卡片不渲染。
   */
  readonly loadCheckpoints?: () => Promise<CheckpointsOutcome>
  /** 标准语言席位(locale 插件绑定)。 */
  readonly t: (key: string) => string
  /** 当前语言(工具名/说明本地化用)。 */
  readonly lang: 'zh' | 'en'
}

/** 区块头(统一骨架):图标 + 标题 + 可选计数徽标 + 右侧动作位。 */
function SectionHead({ icon, title, count, actions }: {
  readonly icon: SectionIcon
  readonly title: string
  readonly count?: string
  readonly actions?: ReactNode
}): ReactElement {
  return (
    <div data-eterna-panel="section-head">
      <span data-eterna-panel="section-icon" aria-hidden="true"><Icon name={icon} size={18} /></span>
      <h2 data-eterna-panel="section-title">{title}</h2>
      {count !== undefined && <span data-eterna-panel="section-count">{count}</span>}
      {actions !== undefined && <div data-eterna-panel="section-actions">{actions}</div>}
    </div>
  )
}

/** 记忆子卡头(待审/画像/功能域/指标共用骨架):图标 + 标题 + 右侧计数/版本。 */
function SubCardHead({ icon, title, tail }: {
  readonly icon: SectionIcon
  readonly title: string
  readonly tail?: ReactNode
}): ReactElement {
  return (
    <div data-eterna-panel="mem-pending-head">
      <span data-eterna-panel="mem-pending-title">
        <span data-eterna-panel="sub-icon" aria-hidden="true"><Icon name={icon} size={16} /></span>
        {title}
      </span>
      {tail}
    </div>
  )
}

function Metric({ label, value, muted = false }: {
  readonly label: string
  readonly value: ReactNode
  /** 无数据(「暂无」语义,不是 0):数值弱化为 muted。 */
  readonly muted?: boolean
}): ReactElement {
  return (
    <span data-eterna-panel="metric" {...(muted && { 'data-eterna-panel-muted': 'true' })}>
      <span data-eterna-panel="metric-value">{value}</span>
      <span data-eterna-panel="metric-label">{label}</span>
    </span>
  )
}

function GovernanceCard({ snapshot, t }: { readonly snapshot: EternaPanelSnapshot, readonly t: (key: string) => string }): ReactElement {
  const governance = snapshot.governance
  return (
    <section data-eterna-panel="card" data-eterna-panel-card="governance" aria-label={t('services.governance')}>
      <div data-eterna-panel="card-kicker">{t('services.governance')}</div>
      <div data-eterna-panel="tile-row">
        <Metric label={t('services.rules')} value={<span data-eterna-panel="rule-count">{governance.ruleCount}</span>} />
        <Metric label={t('services.audit')} value={<span data-eterna-panel="audit-count">{governance.auditEntries}</span>} />
      </div>
      <div data-eterna-panel="kv">
        <span data-eterna-panel="kv-key">规则源</span>
        <span data-eterna-panel="kv-value" data-eterna-panel-detail="rule-source">{governance.ruleSource}</span>
      </div>
    </section>
  )
}

/** 单条记忆渲染:key chip/时间 meta 行 + 内容(超 3 行截断,点击展开)。 */
function MemoryEntityRow({ entity }: { readonly entity: EternaPanelSnapshot['memory']['entities'][number] }): ReactElement {
  const [expanded, setExpanded] = useState(false)
  const date = new Date(entity.updatedAt)
  const time = Number.isNaN(date.getTime()) ? '' : date.toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })
  const long = entity.content.length > 120 || entity.content.includes('\n')
  return (
    <div data-eterna-panel="mem-entity" data-eterna-panel-mem-entity={entity.subject + '/' + entity.key}>
      <div data-eterna-panel="mem-entity-head">
        <span data-eterna-panel="mem-entity-key">{entity.key}</span>
        <span data-eterna-panel="mem-entity-time">{time}</span>
      </div>
      <div
        data-eterna-panel="mem-entity-content"
        data-eterna-panel-clamped={(!expanded && long) ? 'true' : undefined}
      >
        {entity.content}
      </div>
      {long && (
        <button
          type="button"
          data-eterna-panel="mem-expand"
          onClick={() => setExpanded(v => !v)}
        >
          {expanded ? '收起' : '显示全文'}
        </button>
      )}
    </div>
  )
}

/**
 * 两击确认按钮(access confirm-button.tsx TwoClickButton 同款语义,面板本地轻量版):
 * 首次点击进入待确认态,4s 无操作或移出/失焦自动解除;确认后执行并复位。
 * 破坏性操作统一走两击(禁用原生 confirm:内嵌 webview 卡死实测)。
 */
function ConfirmButton({ label, confirmLabel, className, anchor, disabled, onConfirm }: {
  readonly label: string
  readonly confirmLabel: string
  readonly className: string
  /** E2E 结构化锚点(data-eterna-panel 值;缺省不带)。 */
  readonly anchor?: string
  readonly disabled: boolean
  readonly onConfirm: () => void
}): ReactElement {
  const [armed, setArmed] = useState(false)
  const timer = useRef<number | undefined>(undefined)
  const disarm = useCallback((): void => {
    window.clearTimeout(timer.current)
    setArmed(false)
  }, [])
  useEffect(() => () => { window.clearTimeout(timer.current) }, [])
  const handleClick = (): void => {
    if (disabled) return
    if (!armed) {
      setArmed(true)
      window.clearTimeout(timer.current)
      timer.current = window.setTimeout(() => { setArmed(false) }, 4000)
      return
    }
    disarm()
    onConfirm()
  }
  return (
    <button
      type="button"
      className={armed ? `${className} is-armed` : className}
      disabled={disabled}
      {...(anchor !== undefined && { 'data-eterna-panel': anchor })}
      data-armed={armed ? 'true' : undefined}
      onMouseLeave={disarm}
      onBlur={disarm}
      onClick={handleClick}
    >{armed ? confirmLabel : label}</button>
  )
}

/**
 * 单条待审记忆(T9 审批队列):key chip + 来源徽标行 / 出处 meta 独立行
 * (自由换行,不再右对齐挤压)/ 内容 / 批·拒按钮右对齐;
 * 拒绝两击确认;防重复点击(裁决进行中禁用双按钮)。
 * C10(22 号 §5-C10):source=compaction 的条目来自压缩摘要(二手),带
 * 「来自压缩摘要」徽标且详情默认折叠——审批者主动展开才见正文。
 */
function MemoryPendingRow({ item, review, t }: {
  readonly item: MemoryPendingView
  readonly review: ReviewFn
  readonly t: (key: string) => string
}): ReactElement {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const fromCompaction = item.source === 'compaction'
  const [expanded, setExpanded] = useState(false)
  const date = new Date(item.updatedAt)
  const time = Number.isNaN(date.getTime()) ? '' : date.toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })
  const decide = (decision: 'approved' | 'rejected'): void => {
    setBusy(true)
    setError(null)
    void review(item.id, decision).then((outcome) => {
      if (!outcome.ok) {
        setError(outcome.message ?? t('state.error'))
        setBusy(false)
        return
      }
      // 成功:快照已由注入面自动刷新,本行随队列出队卸载;busy 复位兜底
      setBusy(false)
    })
  }
  return (
    <div data-eterna-panel="mem-pending-row" data-eterna-panel-pending={String(item.id)}
      data-eterna-panel-pending-compaction={fromCompaction ? 'true' : undefined}>
      <div data-eterna-panel="mem-pending-top">
        <span data-eterna-panel="mem-entity-key">{item.key}</span>
        {fromCompaction && <span data-eterna-panel="mem-pending-compaction">{t('memory.pendingCompaction')}</span>}
      </div>
      <div data-eterna-panel="mem-pending-meta">
        <span>{item.subject}</span>
        {item.originSessionId !== null && (
          <span data-eterna-panel="mem-pending-session" title={item.originSessionId}>{item.originSessionId.slice(0, 13)}</span>
        )}
        <span>{time}</span>
      </div>
      {(!fromCompaction || expanded) && <div data-eterna-panel="mem-entity-content">{item.content}</div>}
      {fromCompaction && (
        <button
          type="button"
          data-eterna-panel="mem-pending-detail-toggle"
          data-eterna-panel-expanded={expanded ? 'true' : undefined}
          onClick={() => setExpanded(v => !v)}
        >{expanded ? t('memory.pendingCollapse') : t('memory.pendingExpand')}</button>
      )}
      {error !== null && <span data-eterna-panel="mem-pending-error">{error}</span>}
      <div data-eterna-panel="mem-pending-actions">
        <button
          type="button"
          data-eterna-panel="mem-approve"
          disabled={busy}
          onClick={() => { decide('approved') }}
        >{busy ? t('memory.deciding') : (<><Icon name="check" size={14} />{t('memory.approve')}</>)}</button>
        <ConfirmButton
          label={t('memory.reject')}
          confirmLabel={t('memory.rejectConfirm')}
          className="eterna-panel-danger"
          anchor="mem-reject"
          disabled={busy}
          onConfirm={() => { decide('rejected') }}
        />
      </div>
    </div>
  )
}

/** 待审记忆队列(M-M2 T9):批/拒,拒绝两击确认;完整体验交 M-M3。 */
function MemoryPendingSection({ snapshot, review, t }: {
  readonly snapshot: EternaPanelSnapshot
  readonly review: ReviewFn
  readonly t: (key: string) => string
}): ReactElement {
  const memory = snapshot.memory
  const pending = memory.pending ?? []
  if (memory.pendingCount === 0 && pending.length === 0) return <></>
  return (
    <div data-eterna-panel="mem-pending" aria-label={t('memory.pendingTitle')}>
      <SubCardHead icon="memory" title={t('memory.pendingTitle')}
        tail={<span data-eterna-panel="mem-pending-count">{t('memory.pendingCountLabel').replace('{count}', String(memory.pendingCount))}</span>} />
      <p data-eterna-panel="mem-pending-hint">{t('memory.pendingHint')}</p>
      {pending.map(item => <MemoryPendingRow key={item.id} item={item} review={review} t={t} />)}
    </div>
  )
}

/**
 * 画像卡(M-M3 T12-②,19 号 §5-T12.2 + 18 §10):分节 2 列栅格展示画像摘要 +
 * 逐节「纠正此项」——写入纠正预填桥(memory 域 chip 消费,显式通道闭环);纠正必须
 * 落到事实源(只改视图会在下次再生时回弹,17 §3.3-6),故面板**不直接改画像**。
 */
function PortraitSection({ snapshot, trackCorrection, t }: {
  readonly snapshot: EternaPanelSnapshot
  readonly trackCorrection?: TrackCorrectionFn
  readonly t: (key: string) => string
}): ReactElement {
  const portrait = snapshot.memory.portrait
  const [corrected, setCorrected] = useState<string | null>(null)
  const correct = (section: string): void => {
    setCorrectionPrefill({ section, text: correctionPrefillText(section) })
    // T13 指标埋点:纠正动作留痕(纠正率分子;fire-and-forget,失败静默)。
    trackCorrection?.(section)
    setCorrected(section)
  }
  return (
    <div data-eterna-panel="portrait" aria-label={t('memory.portraitTitle')}>
      <SubCardHead icon="bookmark" title={t('memory.portraitTitle')}
        tail={portrait.version !== null ? <span data-eterna-panel="portrait-version">v{portrait.version}</span> : undefined} />
      <p data-eterna-panel="mem-pending-hint">{portrait.available ? t('memory.portraitHint') : t('memory.portraitEmpty')}</p>
      {portrait.available && (
        <div data-eterna-panel="portrait-grid">
          {portrait.sections.map(section => (
            <div key={section.title} data-eterna-panel="portrait-section" data-eterna-panel-portrait-section={section.title}>
              <div data-eterna-panel="portrait-section-head">
                <span data-eterna-panel="portrait-section-title">{section.title}</span>
                <button
                  type="button"
                  data-eterna-panel="portrait-correct"
                  data-eterna-panel-correct={section.title}
                  onClick={() => { correct(section.title) }}
                >{t('memory.portraitCorrect')}</button>
              </div>
              {section.lines.length === 0 && (
                <span data-eterna-panel="portrait-line" data-eterna-panel-portrait-empty="true">{t('memory.portraitSectionEmpty')}</span>
              )}
              {section.lines.map((line, index) => (
                <span key={index} data-eterna-panel="portrait-line">{line}</span>
              ))}
            </div>
          ))}
        </div>
      )}
      {corrected !== null && (
        <span data-eterna-panel="portrait-corrected" role="status" aria-live="polite">
          {t('memory.portraitCorrectReady').replace('{section}', corrected)}
        </span>
      )}
    </div>
  )
}

/** 域浏览行(域名/条数/最近使用/待审;候选域标记,19 号 §5-T12.2 原文口径)。 */
function DomainBrowseRow({ domain, t }: {
  readonly domain: EternaPanelSnapshot['memory']['domains'][number]
  readonly t: (key: string) => string
}): ReactElement {
  const date = domain.lastUsedAt === null ? null : new Date(domain.lastUsedAt)
  const lastUsed = date === null || Number.isNaN(date.getTime())
    ? '—'
    : date.toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })
  return (
    <div data-eterna-panel="domain-row" data-eterna-panel-domain={domain.domainKey}
      data-eterna-panel-domain-candidate={domain.registered === null ? 'true' : undefined}>
      <span data-eterna-panel="domain-label">
        <span data-eterna-panel="domain-name">{domain.label}</span>
        {domain.registered === null && <span data-eterna-panel="domain-candidate-flag">{t('memory.domainCandidate')}</span>}
      </span>
      <span data-eterna-panel="domain-meta">
        <span data-eterna-panel="domain-stat">{t('memory.domainMemories').replace('{count}', String(domain.memoryCount))}</span>
        <span data-eterna-panel="domain-stat">{t('memory.domainSessions').replace('{count}', String(domain.sessionCount))}</span>
        <span data-eterna-panel="domain-stat">{t('memory.domainLastUsed').replace('{value}', lastUsed)}</span>
        {domain.pendingCount > 0 && <span data-eterna-panel="domain-pending">{t('memory.domainPending').replace('{count}', String(domain.pendingCount))}</span>}
      </span>
    </div>
  )
}

/** 域浏览区块(M-M3 T12-②):按域分组的记忆分布(候选域一并列出)。 */
function DomainBrowseSection({ snapshot, t }: {
  readonly snapshot: EternaPanelSnapshot
  readonly t: (key: string) => string
}): ReactElement {
  const domains = snapshot.memory.domains
  return (
    <div data-eterna-panel="domain-browse" aria-label={t('memory.domainTitle')}>
      <SubCardHead icon="domain" title={t('memory.domainTitle')}
        tail={<span data-eterna-panel="mem-pending-count">{domains.length} {t('memory.domainUnit')}</span>} />
      {domains.length === 0 && <p data-eterna-panel="mem-pending-hint">{t('memory.domainEmpty')}</p>}
      {domains.map(domain => <DomainBrowseRow key={domain.domainKey} domain={domain} t={t} />)}
    </div>
  )
}

/** 「记忆」独立区块:当前工作区全部有效记忆,按主体分组,美观渲染。 */
/** 主体(subject)→ 人话分类:标签 + 一句说明 + 排序权(小在前)。 */
const SUBJECT_KINDS: readonly { match: (s: string) => boolean, label: string, desc: string, order: number, tone: 'normal' | 'test' }[] = [
  { match: s => s.startsWith('user:'), label: '你的偏好与习惯', desc: 'Agent 从对话中沉淀的、关于你个人的记忆', order: 1, tone: 'normal' },
  { match: s => s.startsWith('project:'), label: '项目记忆', desc: '当前项目/工作区的事实、决定与结论', order: 2, tone: 'normal' },
  { match: s => s.startsWith('org:'), label: '团队约定', desc: '组织层面的约定与口径', order: 3, tone: 'normal' },
  { match: s => /^e2e:|^test:|^qa:/i.test(s), label: '测试数据', desc: '验收测试写入的记忆(可安全清理)', order: 99, tone: 'test' },
]

function subjectKind(subject: string): { label: string, desc: string, order: number, tone: 'normal' | 'test' } {
  const hit = SUBJECT_KINDS.find(k => k.match(subject))
  return hit ?? { label: subject, desc: '', order: 50, tone: 'normal' as const }
}

/**
 * T13 指标区(19 号 §5-T13/§9-6):五项验收指标的面板投影——审批采纳率/
 * 响应中位/纠正率/域绑定分布/索引分区占用;「暂无」= 尚无数据(率 null 语义,
 * 不是 0,数值弱化为 muted)。数据源:审计账本聚合 + 现算注入(见 snapshot.ts readMetrics)。
 */
function MemoryMetricsSection({ snapshot, t }: { readonly snapshot: EternaPanelSnapshot, readonly t: (key: string) => string }): ReactElement {
  const metrics = snapshot.memory.metrics
  const percent = (rate: number | null): string => (rate === null ? t('memory.metricsNoData') : `${Math.round(rate * 100)}%`)
  const duration = (ms: number | null): string => {
    if (ms === null) return t('memory.metricsNoData')
    if (ms < 60_000) return `${Math.max(1, Math.round(ms / 1000))} 秒`
    if (ms < 3_600_000) return `${Math.round(ms / 60_000)} 分钟`
    return `${Math.round(ms / 3_600_000)} 小时`
  }
  const zones = metrics.indexZones
  const decided = metrics.reviews.approved + metrics.reviews.rejected
  return (
    <div data-eterna-panel="mem-metrics" aria-label={t('memory.metricsTitle')}>
      <SubCardHead icon="chart" title={t('memory.metricsTitle')} />
      <p data-eterna-panel="mem-pending-hint">{t('memory.metricsHint')}</p>
      <div data-eterna-panel="mem-metrics-grid">
        <Metric muted={metrics.reviews.acceptanceRate === null} label={t('memory.metricsAcceptance')} value={`${percent(metrics.reviews.acceptanceRate)} · ${metrics.reviews.approved}/${decided}`} />
        <Metric muted={metrics.reviewLatencyMs.medianMs === null} label={t('memory.metricsLatency')} value={duration(metrics.reviewLatencyMs.medianMs)} />
        <Metric muted={metrics.corrections.correctionRate === null} label={t('memory.metricsCorrections')} value={`${percent(metrics.corrections.correctionRate)} · ${metrics.corrections.count}/${metrics.corrections.portraitEntries}`} />
        <Metric label={t('memory.metricsDomains')} value={`${metrics.domainResolves.bound}/${metrics.domainResolves.total}`} />
        <Metric muted={zones === null} label={t('memory.metricsIndexZonePortrait')} value={zones === null ? t('memory.metricsNoData') : String(zones.portrait)} />
        <Metric muted={zones === null} label={t('memory.metricsIndexZoneDomain')} value={zones === null ? t('memory.metricsNoData') : String(zones.domain)} />
        <Metric muted={zones === null} label={t('memory.metricsIndexZoneFallback')} value={zones === null ? t('memory.metricsNoData') : String(zones.fallback)} />
      </div>
    </div>
  )
}

function MemorySection({ snapshot, review, trackCorrection, t }: { readonly snapshot: EternaPanelSnapshot, readonly review: ReviewFn, readonly trackCorrection?: TrackCorrectionFn, readonly t: (key: string) => string }): ReactElement {
  const memory = snapshot.memory
  const entities = [...(memory.entities ?? [])]
  type Entity = EternaPanelSnapshot['memory']['entities'][number]
  // 按人话分类分组(不再是裸 subject 编码),组内按 updatedAt 降序
  type MemGroup = { label: string, desc: string, order: number, tone: 'normal' | 'test', items: Entity[] }
  const groups = new Map<string, MemGroup>()
  for (const e of entities) {
    const kind = subjectKind(e.subject)
    const g = groups.get(kind.label) ?? { label: kind.label, desc: kind.desc, order: kind.order, tone: kind.tone, items: [] as Entity[] }
    g.items.push(e)
    groups.set(kind.label, g)
  }
  const ordered = [...groups.values()].sort((a, b) => a.order - b.order)
  return (
    <section data-eterna-panel="section" data-eterna-panel-section="memory" aria-label={t('memory')}>
      <SectionHead icon="memory" title={t('memory')} />
      <p data-eterna-panel="section-note">{t('memory.hint')}</p>
      <MemoryPendingSection snapshot={snapshot} review={review} t={t} />
      <PortraitSection snapshot={snapshot} {...(trackCorrection !== undefined && { trackCorrection })} t={t} />
      <DomainBrowseSection snapshot={snapshot} t={t} />
      <MemoryMetricsSection snapshot={snapshot} t={t} />
      {entities.length === 0 && <span data-eterna-panel="placeholder">{t('state.empty')}</span>}
      {ordered.map(g => (
        <div key={g.label} data-eterna-panel="mem-group" data-eterna-panel-mem-subject={g.label} data-eterna-panel-mem-tone={g.tone}>
          <div data-eterna-panel="mem-subject">
            {g.label}
            <span data-eterna-panel="mem-count">{t('memory.countLabel').replace('{count}', String(g.items.length))}</span>
          </div>
          <p data-eterna-panel="mem-group-desc">{g.desc}</p>
          {g.items.map(e => <MemoryEntityRow key={e.subject + '/' + e.key} entity={e} />)}
        </div>
      ))}
    </section>
  )
}

function KnowledgeCard({ snapshot, t }: { readonly snapshot: EternaPanelSnapshot, readonly t: (key: string) => string }): ReactElement {
  const knowledge = snapshot.knowledge
  const weknora = knowledge.weknora
  const weknoraLabel = weknora.status === 'ok'
    ? t('services.weknora.ok')
    : weknora.status === 'error' ? t('services.weknora.error') : t('services.weknora.off')
  return (
    <section data-eterna-panel="card" data-eterna-panel-card="knowledge" aria-label={t('services.knowledge')}>
      <div data-eterna-panel="card-kicker">{t('services.knowledge')}</div>
      <div data-eterna-panel="tile-row">
        <Metric label={t('services.wikiDocs')} value={<span data-eterna-panel="wiki-doc-count">{knowledge.wikiDocCount}</span>} />
        <Metric label={t('services.proposals')} value={<span data-eterna-panel="proposal-count">{knowledge.proposalCount}</span>} />
      </div>
      <div data-eterna-panel="kv">
        <span data-eterna-panel="kv-key">{t('services.weknora')}</span>
        <span data-eterna-panel="kv-value" data-eterna-panel-detail="weknora-status">
          <span data-eterna-panel="status-pill" data-eterna-panel-status={weknora.status} title={weknora.detail}>{weknoraLabel}</span>
        </span>
      </div>
    </section>
  )
}

function ToolRow({ tool, lang }: { readonly tool: ToolCard, readonly lang: 'zh' | 'en' }): ReactElement {
  const loc = toolLocale(lang, tool.name)
  const risk = tool.r3 ? 'R3' : tool.risk
  return (
    <li data-eterna-panel="tool" data-eterna-panel-tool={tool.name} data-eterna-panel-risk={risk}>
      <span data-eterna-panel="tool-head">
        <span data-eterna-panel="tool-label">{loc.label}</span>
        <span data-eterna-panel="tool-id">{tool.name}</span>
      </span>
      <span data-eterna-panel="tool-desc">{loc.desc}</span>
      {risk !== 'R0' && <span data-eterna-panel="risk" data-eterna-panel-risk={risk}>{risk}</span>}
    </li>
  )
}

function ToolsCard({ snapshot, t, lang }: { readonly snapshot: EternaPanelSnapshot, readonly t: (key: string) => string, readonly lang: 'zh' | 'en' }): ReactElement {
  const tools = snapshot.tools
  return (
    <section data-eterna-panel="card" data-eterna-panel-card="event-tools" aria-label={t('services.tools')}>
      <div data-eterna-panel="card-kicker">{t('services.tools')} <span data-eterna-panel="card-count">· {tools.length}</span></div>
      {tools.length === 0
        ? <span data-eterna-panel="placeholder">{t('state.empty')}</span>
        : (
          <ul data-eterna-panel="tool-list">
            {tools.map(tool => <ToolRow key={tool.name} tool={tool} lang={lang} />)}
          </ul>
        )}
    </section>
  )
}

function PromptRow({ id, capability, title, prompt, note, t }: {
  readonly id: string
  readonly capability: string
  readonly title: string
  readonly prompt: string
  readonly note: string | undefined
  readonly t: (key: string) => string
}): ReactElement {
  const [copied, setCopied] = useState(false)
  const onCopy = useCallback(() => {
    // 剪贴板双路径:clipboard API(需 user activation,真实点击路径)+
    // execCommand 文本域回退(合成点击/受限环境);两条路径都不可达时至少给出反馈态。
    const markCopied = (): void => {
      setCopied(true)
      window.setTimeout(() => { setCopied(false) }, 2000)
    }
    const fallbackCopy = (): boolean => {
      const area = document.createElement("textarea")
      area.value = prompt
      area.setAttribute("readonly", "true")
      area.style.position = "fixed"
      area.style.opacity = "0"
      document.body.append(area)
      area.select()
      let ok = false
      try { ok = document.execCommand("copy") } catch { ok = false }
      area.remove()
      return ok
    }
    const clipboard: Clipboard | undefined = navigator.clipboard
    if (clipboard !== undefined && typeof clipboard.writeText === "function") {
      clipboard.writeText(prompt).then(markCopied, () => { fallbackCopy(); markCopied() })
    } else {
      fallbackCopy()
      markCopied()
    }
  }, [prompt])
  return (
    <div data-eterna-panel="prompt" data-eterna-panel-prompt={id}>
      <div data-eterna-panel="prompt-head">
        <span data-eterna-panel="prompt-title">{title}</span>
        <span data-eterna-panel="prompt-capability">{capability}</span>
        <button type="button" data-eterna-panel="prompt-copy" data-eterna-panel-copy={id} onClick={onCopy}>
          <Icon name={copied ? 'check' : 'copy'} size={14} />
          {copied ? t('guide.copied') : t('guide.copy')}
        </button>
      </div>
      <p data-eterna-panel="prompt-text">{prompt}</p>
      {note !== undefined && <p data-eterna-panel="prompt-note">{note}</p>}
    </div>
  )
}

function SessionRow({ session, t }: {
  readonly session: EternaPanelSnapshot['observability']['sessions'][number]
  readonly t: (key: string) => string
}): ReactElement {
  return (
    <div data-eterna-panel="session" data-eterna-panel-session={session.id}>
      <span data-eterna-panel="session-id" title={session.id}>{session.id}</span>
      <span data-eterna-panel="session-metrics">
        <span>{t('observability.turns')} {session.turns}</span>
        <span>{t('observability.input')} {session.inputTokens}</span>
        <span>{t('observability.output')} {session.outputTokens}</span>
        <span>{t('observability.cacheRead')} {session.cacheReadTokens}</span>
        <span data-eterna-panel="cache-hit-rate">
          {t('observability.cacheHit')} {session.cacheHitRate === null ? '—' : `${(session.cacheHitRate * 100).toFixed(1)}%`}
        </span>
      </span>
      <span data-eterna-panel="session-last">{session.lastAt}</span>
    </div>
  )
}

/** 面板根组件。 */
export function PanelPage({ useSnapshot, refresh, review, trackCorrection, loadCheckpoints, t, lang }: Omit<PanelPageProps, never> & { lang?: 'zh' | 'en' }): ReactElement {
  const state = useSnapshot(snapshot => snapshot)
  // 语言跟随 DSH 系统(官方把当前语言写在 <html lang>;切换即时生效,字典更新触发重渲染)
  const uiLang: 'zh' | 'en' = lang ?? ((document.documentElement.lang || '').toLowerCase().startsWith('zh') ? 'zh' : 'en')
  return (
    <div data-eterna-panel="root" aria-label={t('panel')}>
      <div data-eterna-panel="toolbar">
        <h1 data-eterna-panel="heading">{t('panel')}</h1>
        <button type="button" data-eterna-panel="refresh" onClick={refresh}>{t('refresh')}</button>
      </div>
      <p data-eterna-panel="sub">{t('subtitle')}</p>

      {state.status === 'ready'
        ? <MemorySection snapshot={state.snapshot} review={review} {...(trackCorrection !== undefined && { trackCorrection })} t={t} />
        : (
          <section data-eterna-panel="section" data-eterna-panel-section="memory" aria-label={t('memory')}>
            <SectionHead icon="memory" title={t('memory')} />
            <span data-eterna-panel="placeholder">{state.status === 'error' ? `${t('state.error')}: ${state.message}` : t('state.loading')}</span>
          </section>
        )}

      <section data-eterna-panel="section" data-eterna-panel-section="services" aria-label={t('services')}>
        <SectionHead icon="gauge" title={t('services')} />
        {state.status === 'loading' && <span data-eterna-panel="placeholder">{t('state.loading')}</span>}
        {state.status === 'error' && <span data-eterna-panel="placeholder" data-eterna-panel-error="true">{t('state.error')}: {state.message}</span>}
        {state.status === 'ready' && (
          <div data-eterna-panel="cards">
            <GovernanceCard snapshot={state.snapshot} t={t} />
            <KnowledgeCard snapshot={state.snapshot} t={t} />
            <ToolsCard snapshot={state.snapshot} t={t} lang={uiLang} />
          </div>
        )}
      </section>

      <section data-eterna-panel="section" data-eterna-panel-section="guide" aria-label={t('guide')}>
        <SectionHead icon="prompt" title={t('guide')} />
        <p data-eterna-panel="section-note">{t('guide.hint')}</p>
        <div data-eterna-panel="steps" data-eterna-panel-steps="true">
          <div data-eterna-panel="step"><span data-eterna-panel="step-no">1</span><span data-eterna-panel="step-text">{t('steps.one')}</span></div>
          <div data-eterna-panel="step"><span data-eterna-panel="step-no">2</span><span data-eterna-panel="step-text">{t('steps.two')}</span></div>
          <div data-eterna-panel="step"><span data-eterna-panel="step-no">3</span><span data-eterna-panel="step-text">{t('steps.three')}</span></div>
        </div>
        <div data-eterna-panel="cards">
          {GUIDE_PROMPTS.map(entry => (
            <PromptRow key={entry.id} id={entry.id} capability={entry.capability} title={entry.title} prompt={entry.prompt} note={entry.note} t={t} />
          ))}
        </div>
      </section>

      <section data-eterna-panel="section" data-eterna-panel-section="observability" aria-label={t('observability')}>
        <SectionHead icon="chart" title={t('observability')} />
        {state.status === 'ready' && state.snapshot.observability.note !== undefined && (
          <p data-eterna-panel="section-note" data-eterna-panel-observability-note="true">{state.snapshot.observability.note}</p>
        )}
        {state.status === 'ready' && state.snapshot.observability.sessions.length > 0 && (
          <div data-eterna-panel="session-list">
            {state.snapshot.observability.sessions.map(session => <SessionRow key={session.id} session={session} t={t} />)}
          </div>
        )}
        {state.status !== 'ready' && <span data-eterna-panel="placeholder">{t('state.loading')}</span>}
      </section>

      {loadCheckpoints !== undefined && <CompactionCard loadCheckpoints={loadCheckpoints} />}
    </div>
  )
}

// ---------------------------------------------------------------------------
// M-C4 上下文压缩 checkpoint 视图(21 号 §3-C4「压缩可回溯」):
// 最近压缩列表(时间/会话/释放量/模型)+ 摘要正文展开。数据走
// eternaCompaction/recentCheckpoints(管理员可见;非 admin 由端点返回
// forbidden,卡片降级为提示行)。文案内聚中文常量(卡片组件自包含,
// 不进 panel locale 联合类型)。
// ---------------------------------------------------------------------------

/** 单条最近压缩(checkpoint 视图行;与 admin RecentCheckpoint 同形)。 */
export interface CompactionCheckpointRow {
  readonly at: number | null
  readonly session: string
  readonly shadowedTokenCount: number
  readonly provider: string
  readonly model: string
  readonly summary: string
}

/** loadCheckpoints 回调结果(端点封套的客户端消费面)。 */
export type CheckpointsOutcome =
  | { ok: true; checkpoints: readonly CompactionCheckpointRow[] }
  | { ok: false; message: string }

interface CompactionCardState {
  readonly status: 'loading' | 'ready' | 'error'
  readonly rows: readonly CompactionCheckpointRow[]
  readonly message: string
}

/** 最近压缩卡片:懒加载一次 + 手动刷新;空列表给"尚未发生"占位。 */
function CompactionCard({ loadCheckpoints }: { readonly loadCheckpoints: () => Promise<CheckpointsOutcome> }): ReactElement {
  const [state, setState] = useState<CompactionCardState>({ status: 'loading', rows: [], message: '' })
  const [expanded, setExpanded] = useState<number | null>(null)
  const load = (): void => {
    setState({ status: 'loading', rows: [], message: '' })
    loadCheckpoints().then((outcome) => {
      if (outcome.ok) setState({ status: 'ready', rows: outcome.checkpoints, message: '' })
      else setState({ status: 'error', rows: [], message: outcome.message })
    }).catch((error: unknown) => {
      setState({ status: 'error', rows: [], message: error instanceof Error ? error.message : String(error) })
    })
  }
  useEffect(load, [loadCheckpoints])
  return (
    <section data-eterna-panel="section" data-eterna-panel-section="compaction" aria-label="上下文压缩">
      <SectionHead
        icon="trace"
        title="上下文压缩"
        actions={(
          <button type="button" data-eterna-panel="refresh" data-eterna-panel-refresh="checkpoints" onClick={load}>刷新</button>
        )}
      />
      <p data-eterna-panel="section-note">最近压缩的 checkpoint:释放量、摘要模型与 8 段摘要正文;原始记录完整保留在会话日志,可回放查看。</p>
      {state.status === 'loading' && <span data-eterna-panel="placeholder">读取中…</span>}
      {state.status === 'error' && (
        <span data-eterna-panel="placeholder" data-eterna-panel-error="true">
          {state.message.includes('管理员') ? '上下文压缩记录为管理员专用视图,当前账号无权查看。' : `读取失败:${state.message}`}
        </span>
      )}
      {state.status === 'ready' && state.rows.length === 0 && (
        <span data-eterna-panel="placeholder">尚未发生压缩(会话上下文达到触发阈值时自动执行,或用 /compact 手动执行)。</span>
      )}
      {state.status === 'ready' && state.rows.length > 0 && (
        <div data-eterna-panel="cards" data-eterna-panel-checkpoints="true">
          {state.rows.map((row, index) => (
            <section key={`${row.session}-${row.at ?? index}`} data-eterna-panel="card" data-eterna-panel-card="checkpoint">
              <div data-eterna-panel="card-kicker">
                {row.at === null ? '时间未知' : new Date(row.at).toLocaleString('zh-CN', { hour12: false })}
              </div>
              <div data-eterna-panel="kv">
                <span>{`会话 ${row.session}`}</span>
                <span>{`释放 ${row.shadowedTokenCount.toLocaleString('zh-CN')} tokens`}</span>
                <span>{row.model === '' ? '摘要模型:—' : `摘要模型 ${row.model}`}</span>
              </div>
              <button
                type="button"
                data-eterna-panel="checkpoint-toggle"
                aria-expanded={expanded === index}
                onClick={() => { setExpanded(previous => previous === index ? null : index) }}
              >
                {expanded === index ? '收起摘要' : '查看摘要'}
              </button>
              {expanded === index && (
                <pre data-eterna-panel="checkpoint-summary">{row.summary}</pre>
              )}
            </section>
          ))}
        </div>
      )}
    </section>
  )
}
