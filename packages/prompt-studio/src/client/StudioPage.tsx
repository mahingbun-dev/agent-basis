/**
 * 侧栏「提示词工坊」主面板(main keyed slot 占位;T1.5 从 persona 单条改注册表全景):
 *
 * - 分组导航 [data-ps-group-nav]:preset/领域/运行时 三层分组行卡(access 插件页
 *   同构形态)——条目 id + 型别/可编辑性胶囊 + 「升级可能覆盖」风险胶囊 + 版本数/
 *   字节;点击切换条目详情;
 * - 条目详情 [data-ps-entry-detail]:元数据卡(层/型别/来源/红线策略/字节上限/
 *   版本概览)+ 生效条件区 [data-ps-entry-effect](T2.2 实测矩阵:radius 胶囊 +
 *   逐条目生效条件注记,registry effect 字段单一来源;不热生效/不可写条目在此
 *   明示,不造「保存即全面生效」假象)+ 风险标注警示区(升级覆盖等,registry
 *   risks 全文展示)+ 分型值区:patch 值型 → 编辑器(保存两段式 R3;
 *   [data-t7-editor]/[data-t7-save-btn]/[data-ps-entry-save]);运行时注入型 →
 *   只读说明面板(「装配时构建,无 patch 写回落点」明示,不造可编辑假象)
 *   (2026-11-11 用户裁定后注册表无行锚点只读型,其面板与文案已移除);
 * - 版本/diff 复用(T7.3 组件按条目渲染):VersionItem(载入/对比/导出/回滚,
 *   无任何删除入口——版本只增不删)+ DiffView([data-ps-diff-view] 锚点叠加);
 * - AI 润色区(T3.2)[data-ps-ai-polish]:patch 值型条目 → 生成建议稿 → diff 预览
 *   ([data-ps-ai-diff],复用 lineDiffOps 与 DiffView 行渲染形态)→「作为提案提交」
 *   经 loopPrompt/ai-proposal 进与手工保存完全相同的 R3 两段式——**AI 产出永不
 *   直接生效**;不可用降级明示([data-ps-ai-unavailable] 文案锚点);
 * - AI 审核报告卡(T3.3)[data-ps-ai-review]:当前稿(编辑器草稿)→ 问题清单
 *   (ruleFindings=与保存门禁同一套本地校验器;aiFindings=模型按元提示词五维:
 *   红线冲突/长度/变量引用/一致性/清晰度)+ 建议列表([data-ps-ai-review-suggestion])。
 *   **报告仅展示、不拦截保存**([data-ps-ai-review-note] 纪律文案);AI 不可用时
 *   ruleFindings 仍可看(本地校验器不依赖模型),降级明示随结果 issues 呈现;
 * - 会话快照查看(T2.3)[data-ps-session-snapshot]:会话行卡 → 该会话开启时刻
 *   effective prompt 全文(条目版本指针+可展开文本);运行时注入型条目
 *   「不可回放(运行时构建)」降级标注明示,不造可回放假象;
 * - 导入(JSON 包;包内 entryId 指名落点条目)+ R3 审批卡 + 写结果就地展示。
 *
 * 数据经 inject 面到达(props.useStudio / props.refresh / props.call),不触 ctx。
 * 条目元数据与当前值来自 snapshot.entries[](T1.4 全景);按条目版本链经
 * prompt-versions {entryId} 惰性拉取并缓存(默认条目初始链复用共享源的旧形态
 * 拉取)。DOM 全部带 data-t7- 与 data-ps- 结构化锚点,供 E2E 严断言定位;样式只经
 * 官方语义令牌(--dsw-alias-*,styles.ts)。
 */
import { useEffect, useRef, useState, type ReactElement } from 'react'
import { diffLines, lineDiffOps } from '../diff.ts'
import type { LineDiffOp } from '../diff.ts'
import type {
  AiCallMeta, AiPolishResult, AiReviewResult, AiStatusResult, EntrySummaryView, PromptExportResult,
  PromptSaveResult, PromptVersionRecord,
  SessionSnapshotGetResult, SessionSnapshotListResult, SessionSnapshotNotFoundResult,
  SessionSnapshotUnavailableResult, VersionsResult,
  WriteApprovalView,
} from '../types.ts'

/** 指定会话查询的三态线形状(ok/not-found/unavailable;列表态另用 ListResult)。 */
type SnapshotGetEnvelope = SessionSnapshotGetResult | SessionSnapshotNotFoundResult | SessionSnapshotUnavailableResult
import { ENDPOINTS, type RpcEnvelope } from './rpc.ts'
import { formatTime, formatTokens, utf8Bytes } from './format.ts'
import {
  type AskUserQuestionItem, type PendingApproval, type StudioState, writeOutcomeFrom,
  type WriteEcho, type WriteOutcomeView,
} from './studio-state.ts'

/**
 * 默认条目 id(与服务端 registry.ts DEFAULT_ENTRY_ID 同源语义;客户端不 import
 * 服务端 registry——其传递依赖 persona-patch 的 node:fs 面,而客户端 bundle 只允许
 * 基线外部模块,tests/client-bundle.test.ts 钉住)。初始选中条目 = 默认 persona,
 * 保持 T7「打开即见 persona 编辑器」的落座体验。
 */
const DEFAULT_ENTRY_ID = 'preset.standard.persona'

/** 分组导航的层次序(注册表层枚举序;preset → 领域 → 运行时 → 元提示词)。 */
const LAYERS = ['preset', 'domain', 'runtime', 'meta'] as const

/**
 * 按条目版本链的拉取状态(与数据面 chains 分离):「拉取中 / 拉取失败(RPC 通道错、
 * 超时等)」与「版本库真未挂载(loaded 且 !ready)」三态分开展示——失败不得伪装成
 * storage 缺席,也不得静默吞掉(缺席降级必须如实标注)。
 */
type ChainFetchState =
  | { readonly status: 'loading' }
  | { readonly status: 'error'; readonly message: string }
  | { readonly status: 'loaded' }

/**
 * AI 可用性状态(T3.2;宿主全局、零模型调用,快照刷新时重检一次):loading /
 * loaded(含结论与不可用原因)/ error(RPC 通道错——不得冒充「AI 不可用」结论)。
 */
type AiStatusState =
  | { readonly status: 'loading' }
  | { readonly status: 'loaded'; readonly result: AiStatusResult }
  | { readonly status: 'error'; readonly message: string }

/**
 * AI 润色流状态(T3.2;选中条目归属,切条目/放弃/提交生效即重置):idle → loading →
 * ok(base=润色底稿,draft=建议稿,meta=生成信息)或 error(unavailable/failed/
 * rejected 的 issues 就地明示)。**建议稿永不直接生效**:ok 态只渲染预览,生效唯一
 * 通道是「作为提案提交」→ R3 两段式(与手工保存同门禁)。
 * ok 态携带 entryId(建议稿归属条目):渲染面与选中条目不符即按 idle 处理、提案
 * 提交按归属条目组载荷——防「在途响应跨条目落位」与「旧建议稿贴新条目」竞态
 * (评审 2026-11-11:done 态无条目标识会让旧稿结论冒充新条目,写路径同类)。
 */
type AiPolishState =
  | { readonly status: 'idle' }
  | { readonly status: 'loading' }
  | { readonly status: 'error'; readonly message: string }
  | { readonly status: 'ok'; readonly entryId: string; readonly base: string; readonly draft: string; readonly meta?: AiCallMeta }

/**
 * AI 审核流状态(T3.3;选中条目归属,切条目/关闭报告即重置):idle → loading →
 * done(端点返回整体入卡——ok/unavailable 均属「有报告」:unavailable 时
 * ruleFindings 仍在,本地校验器不依赖模型)或 error(RPC 通道错/rejected/failed
 * 的 issues 就地明示)。**报告仅展示不拦截**:done 态不触任何写通道,也不禁用
 * 保存按钮——审核结论与保存门禁解耦(本地规则同源,拦截发生在保存端点自身)。
 * done 态携带 entryId(受审条目)与 content(受审稿全文):前者作跨条目失配防护
 * (渲染面不匹配即不显示),后者作过期标识(当前草稿 ≠ 受审稿时卡片明示
 * 「结论对应审核时刻的稿」,不冒充当前稿结论——评审 2026-11-11 low)。
 */
type AiReviewState =
  | { readonly status: 'idle' }
  | { readonly status: 'loading' }
  | { readonly status: 'error'; readonly message: string }
  | { readonly status: 'done'; readonly entryId: string; readonly content: string; readonly result: AiReviewResult }

/** 工坊组件 props(hooks.studio 绑成 useStudio;其余为普通注入值)。 */
export interface StudioPageProps {
  /** hooks 份额绑定的选择器钩子(SnapshotSelectorHook 形态)。 */
  readonly useStudio: <S>(selector: (state: StudioState) => S) => S
  /** 重新拉取工坊数据(snapshot + 默认条目链)。 */
  readonly refresh: () => void
  /** 经官方通道调用宿主 loopPrompt 端点(载荷纪律见 rpc.ts)。 */
  readonly call: <T>(endpoint: string, args?: Record<string, unknown>) => Promise<RpcEnvelope<T>>
  /** 标准语言席位。 */
  readonly t: (key: string) => string
}

/** 对比视图渲染上限(防病态大 diff 撑爆 DOM;计数不受影响,只截渲染)。 */
const DIFF_RENDER_CAP = 400

/** 版本对比对(a=旧(基线),b=新(对照)。 */
interface DiffPair {
  readonly a: PromptVersionRecord
  readonly b: PromptVersionRecord
}

/** 顶部大数字瓦片。 */
function Stat({ label, value, anchor }: {
  readonly label: string
  readonly value: string
  readonly anchor: string
}): ReactElement {
  return (
    <span data-t7-stat={anchor}>
      <span data-t7-stat-value>{value}</span>
      <span data-t7-stat-label>{label}</span>
    </span>
  )
}

/** 分组导航条目行(按钮;型别/可编辑性/升级覆盖风险胶囊 + 版本数/字节概览)。 */
function EntryNavRow({ entry, selected, onSelect, t }: {
  readonly entry: EntrySummaryView
  readonly selected: boolean
  readonly onSelect: (entryId: string) => void
  readonly t: (key: string) => string
}): ReactElement {
  // 「升级可能覆盖」胶囊:registry 风险文案含「覆盖」即标(展示层启发;全文在详情)。
  const upgradeOverwrite = entry.risks.some(risk => risk.includes('覆盖'))
  return (
    <li>
      <button
        type="button"
        data-ps-entry-row={entry.id}
        data-ps-selected={selected ? 'true' : 'false'}
        aria-current={selected ? 'true' : undefined}
        onClick={() => { onSelect(entry.id) }}
      >
        <span data-ps-entry-row-id>{entry.id}</span>
        <span data-ps-entry-row-pills>
          <span data-ps-pill data-ps-tone="neutral">{t(`studio.kind.${entry.kind}`)}</span>
          {entry.kind === 'patch-value'
            ? <span data-ps-pill data-ps-tone="business">{t('studio.entry.editable')}</span>
            : <span data-ps-pill data-ps-tone="neutral">{t('studio.entry.readonly')}</span>}
          {upgradeOverwrite && <span data-ps-pill data-ps-tone="warn">{t('studio.entry.upgradeRisk')}</span>}
        </span>
        <span data-ps-entry-row-meta>
          {entry.versioned
            ? `${formatTokens(entry.versions.count)} ${t('studio.versions.countLabel')}`
            : t('studio.entry.noVersions')}
          {entry.value.bytes !== null && ` · ${formatTokens(entry.value.bytes)} ${t('studio.editor.bytes')}`}
        </span>
      </button>
    </li>
  )
}

/** 分组导航:preset/领域/运行时 三层分组(access 插件页分组行卡同构形态)。 */
function GroupNav({ entries, selectedId, onSelect, t }: {
  readonly entries: readonly EntrySummaryView[]
  readonly selectedId: string
  readonly onSelect: (entryId: string) => void
  readonly t: (key: string) => string
}): ReactElement {
  return (
    <nav data-ps-group-nav aria-label={t('studio.panorama')}>
      {LAYERS.map(layer => (
        <section key={layer} data-ps-layer-group={layer} aria-label={t(`studio.layer.${layer}`)}>
          <div data-ps-layer-group-head>
            <h2 data-ps-layer-group-title>{t(`studio.layer.${layer}`)}</h2>
            <span data-ps-layer-group-hint>{t(`studio.layer.${layer}.hint`)}</span>
          </div>
          <ul data-ps-entry-list>
            {entries.filter(entry => entry.layer === layer).map(entry => (
              <EntryNavRow key={entry.id} entry={entry} selected={entry.id === selectedId} onSelect={onSelect} t={t} />
            ))}
          </ul>
        </section>
      ))}
    </nav>
  )
}

/** 审批卡区块(R3 双问;approve/reject 回发第二段)。 */
function ApprovalSection({ pending, busy, onAnswer, t }: {
  readonly pending: PendingApproval
  readonly busy: boolean
  readonly onAnswer: (approved: boolean) => void
  readonly t: (key: string) => string
}): ReactElement {
  const card = pending.card
  return (
    <section data-t7-approval data-t7-approval-kind={pending.kind} aria-label={t('studio.approval')}>
      <h2 data-t7-section-title>{t('studio.approval')}</h2>
      <p data-t7-section-note>{t('studio.approval.note')}</p>
      <div data-t7-approval-card>
        <div data-t7-approval-row><span data-t7-approval-key>动作</span><span data-t7-approval-value>{card.whatWillHappen.summary}</span></div>
        <div data-t7-approval-row><span data-t7-approval-key>为什么</span><span data-t7-approval-value>{card.why.summary}</span></div>
        <div data-t7-approval-row><span data-t7-approval-key>影响面</span><span data-t7-approval-value>{card.impact.summary}</span></div>
        <div data-t7-approval-row><span data-t7-approval-key>回滚性</span><span data-t7-approval-value>{card.rollback.statement}</span></div>
        <div data-t7-approval-row>
          <span data-t7-approval-key>命中规则</span>
          <span data-t7-approval-value>
            <span data-t7-approval-grade>{card.matchedRule.grade}</span> · <span data-t7-approval-rule>{card.matchedRule.ruleId}</span>
          </span>
        </div>
      </div>
      <details data-t7-approval-detail-box>
        <summary>{t('studio.approval.detail')}</summary>
        <pre data-t7-approval-detail>{card.renderedDetail}</pre>
      </details>
      <ol data-t7-approval-questions>
        {pending.questionItems.map((item: AskUserQuestionItem) => (
          <li key={item.id} data-t7-approval-question={item.id}>
            {item.header !== undefined && <span data-t7-approval-qheader>{item.header}</span>}
            <p data-t7-approval-qtext>{item.question}</p>
            {item.options !== undefined && (
              <ul data-t7-approval-options>
                {item.options.map(option => (
                  <li key={option.label} data-t7-approval-option={option.label}>
                    {option.label}{option.description === undefined ? '' : ` — ${option.description}`}
                  </li>
                ))}
              </ul>
            )}
          </li>
        ))}
      </ol>
      <div data-t7-approval-actions>
        <button type="button" data-t7-approve-btn disabled={busy} onClick={() => onAnswer(true)}>
          {busy ? t('studio.approval.working') : t('studio.approval.approve')}
        </button>
        <button type="button" data-t7-reject-btn disabled={busy} onClick={() => onAnswer(false)}>
          {t('studio.approval.reject')}
        </button>
      </div>
    </section>
  )
}

/** 版本行(展开内容 + 载入编辑器 + 与上一版对比 + 导出 + 回滚;无任何删除入口)。 */
function VersionItem({ version, previous, busy, onLoad, onCompare, onRollback, onExport, t }: {
  readonly version: PromptVersionRecord
  /** 列表中的上一版(更旧);null=本行已是最初版本,对比不可用(初始版本永存,无更早)。 */
  readonly previous: PromptVersionRecord | null
  readonly busy: boolean
  readonly onLoad: (content: string) => void
  readonly onCompare: (version: PromptVersionRecord, previous: PromptVersionRecord | null) => void
  readonly onRollback: (version: PromptVersionRecord) => void
  readonly onExport: (version: PromptVersionRecord) => void
  readonly t: (key: string) => string
}): ReactElement {
  const [expanded, setExpanded] = useState(false)
  return (
    <div data-t7-version-item={version.id} data-t7-version-source={version.source}>
      <div data-t7-version-head>
        <span data-t7-version-seq>#{version.seq}</span>
        <span data-t7-version-id>{version.id}</span>
        <span data-t7-version-source-badge>{version.source}</span>
        <span data-t7-version-meta>
          {formatTime(version.createdAt)} · {version.author} · {formatTokens(version.bytes)} {t('studio.version.bytes')}
        </span>
      </div>
      <p data-t7-version-summary>{t('studio.version.summary')}: {version.summary}</p>
      <div data-t7-version-actions>
        <button type="button" data-t7-version-toggle onClick={() => setExpanded(v => !v)}>
          {expanded ? t('studio.version.hide') : t('studio.version.show')}
        </button>
        <button type="button" data-t7-load-btn onClick={() => onLoad(version.content)}>
          {t('studio.version.load')}
        </button>
        <button
          type="button"
          data-t7-diff-btn
          disabled={previous === null || busy}
          title={previous === null ? undefined : `#${previous.seq} → #${version.seq}`}
          onClick={() => onCompare(version, previous)}
        >
          {t('studio.version.compare')}
        </button>
        <button type="button" data-t7-export-btn disabled={busy} onClick={() => onExport(version)}>
          {t('studio.version.export')}
        </button>
        <button type="button" data-t7-rollback-btn disabled={busy} onClick={() => onRollback(version)}>
          {t('studio.version.rollback')}
        </button>
      </div>
      {expanded && <pre data-t7-version-content>{version.content}</pre>}
    </div>
  )
}

/** 版本对比视图(行级 diff 投影;a=旧基线,b=新对照;T1.5 叠加 data-ps-diff-view 锚点)。 */
function DiffView({ pair, onClose, t }: {
  readonly pair: DiffPair
  readonly onClose: () => void
  readonly t: (key: string) => string
}): ReactElement {
  const ops: readonly LineDiffOp[] = lineDiffOps(pair.a.content, pair.b.content)
  const added = ops.filter(op => op.type === 'add').length
  const removed = ops.filter(op => op.type === 'del').length
  const visible = ops.slice(0, DIFF_RENDER_CAP)
  const unchanged = added === 0 && removed === 0
  return (
    <div
      data-t7-diff
      data-ps-diff-view
      data-t7-diff-a={pair.a.id}
      data-t7-diff-b={pair.b.id}
      data-t7-diff-empty={unchanged ? 'true' : 'false'}
    >
      <div data-t7-diff-head>
        <span data-t7-diff-title>#{pair.a.seq} → #{pair.b.seq}</span>
        <span data-t7-diff-stats>
          +{added} {t('studio.diff.added')} · −{removed} {t('studio.diff.removed')}
        </span>
        <button type="button" data-t7-diff-close onClick={onClose}>{t('studio.diff.close')}</button>
      </div>
      <p data-t7-diff-note>{t('studio.diff.note')}</p>
      {unchanged && <p data-t7-diff-identical>{t('studio.diff.identical')}</p>}
      {!unchanged && (
        <div data-t7-diff-body>
          {visible.map((op, index) => (
            <div key={index} data-t7-diff-op={op.type}>
              <span data-t7-diff-sign>{op.type === 'add' ? '+' : op.type === 'del' ? '−' : ' '}</span>
              <span data-t7-diff-text>{op.text}</span>
            </div>
          ))}
          {ops.length > visible.length && <p data-t7-diff-truncated>{t('studio.diff.truncated')}</p>}
        </div>
      )}
    </div>
  )
}

/**
 * AI 建议稿 diff 预览(T3.2):当前稿(润色底稿)→ AI 建议稿的逐行对比。复用
 * diff.ts lineDiffOps 与 DiffView 的行渲染形态(data-t7-diff-* 子结构,样式同源),
 * 只换头部文案与容器锚点(data-ps-ai-diff)——对照既有组件形态,不发明孤立样式。
 */
function AiDraftDiff({ base, draft, t }: {
  readonly base: string
  readonly draft: string
  readonly t: (key: string) => string
}): ReactElement {
  const ops: readonly LineDiffOp[] = lineDiffOps(base, draft)
  const added = ops.filter(op => op.type === 'add').length
  const removed = ops.filter(op => op.type === 'del').length
  const visible = ops.slice(0, DIFF_RENDER_CAP)
  const unchanged = added === 0 && removed === 0
  return (
    <div data-ps-ai-diff data-t7-diff-empty={unchanged ? 'true' : 'false'}>
      <div data-t7-diff-head>
        <span data-t7-diff-title>{t('studio.ai.diff')}</span>
        <span data-t7-diff-stats>
          +{added} {t('studio.ai.diff.added')} · −{removed} {t('studio.ai.diff.removed')}
        </span>
      </div>
      <p data-t7-diff-note>{t('studio.ai.diff.note')}</p>
      {unchanged && <p data-t7-diff-identical>{t('studio.ai.diff.identical')}</p>}
      {!unchanged && (
        <div data-t7-diff-body>
          {visible.map((op, index) => (
            <div key={index} data-t7-diff-op={op.type}>
              <span data-t7-diff-sign>{op.type === 'add' ? '+' : op.type === 'del' ? '−' : ' '}</span>
              <span data-t7-diff-text>{op.text}</span>
            </div>
          ))}
          {ops.length > visible.length && <p data-t7-diff-truncated>{t('studio.ai.diff.truncated')}</p>}
        </div>
      )}
    </div>
  )
}

/** 触发浏览器下载(导出 JSON 包;Blob + 临时 <a download>)。 */
function downloadJson(filename: string, data: unknown): void {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.download = filename
  anchor.href = url
  anchor.click()
  window.setTimeout(() => { URL.revokeObjectURL(url) }, 1000)
}

/**
 * 会话快照查看视图(T2.3):会话行卡列表(点击查全文)→ 快照详情(冻结时刻/
 * checksum/捕获事件 + 逐条目指针或分型标注 + 可展开的当时文本)。只读视图——
 * 快照不可变,无任何写操作;运行时注入型条目明示「不可回放(运行时构建)」
 * 降级标注(服务端 note/annotation 透传 + 本地分型徽标双保险,t7-ui-check 文案锚点)。
 */
function SessionSnapshotsView({ call, t, ready, generatedAt }: {
  readonly call: <T>(endpoint: string, args?: Record<string, unknown>) => Promise<RpcEnvelope<T>>
  readonly t: (key: string) => string
  readonly ready: boolean
  /** 快照生成的递增时刻(宿主 refresh 换值 → 重拉列表,与版本链 effect 同款)。 */
  readonly generatedAt: string
}): ReactElement {
  type ListState =
    | { readonly status: 'loading' }
    | { readonly status: 'error'; readonly message: string }
    | { readonly status: 'loaded'; readonly list: SessionSnapshotListResult }
  const [listState, setListState] = useState<ListState>({ status: 'loading' })
  const [detail, setDetail] = useState<SessionSnapshotGetResult | null>(null)
  const [detailIssues, setDetailIssues] = useState<string | null>(null)
  const [selectedSession, setSelectedSession] = useState<string | null>(null)
  const [detailBusy, setDetailBusy] = useState(false)

  useEffect(() => {
    if (!ready) return
    let cancelled = false
    setListState(previous => (previous.status === 'loaded' ? previous : { status: 'loading' }))
    void (async (): Promise<void> => {
      const result = await call<SessionSnapshotListResult>(ENDPOINTS.sessionSnapshot, { input: {} })
      if (cancelled) return
      if (result.ok) setListState({ status: 'loaded', list: result.value })
      else setListState({ status: 'error', message: result.message })
    })()
    return () => { cancelled = true }
  }, [ready, generatedAt, call])

  /** 点击会话行 → 拉该会话快照全文。 */
  const openSnapshot = (sessionId: string): void => {
    if (detailBusy) return
    setDetailBusy(true)
    setSelectedSession(sessionId)
    setDetailIssues(null)
    void (async (): Promise<void> => {
      const result = await call<SnapshotGetEnvelope>(ENDPOINTS.sessionSnapshot, { input: { sessionId } })
      if (result.ok) {
        if (result.value.status === 'ok') {
          setDetail(result.value)
        } else {
          // not-found/unavailable 分态明示(不冒充空详情)。
          setDetail(null)
          setDetailIssues(result.value.issues.join(';'))
        }
      } else {
        setDetail(null)
        setDetailIssues(result.message)
      }
    })().finally(() => { setDetailBusy(false) })
  }

  return (
    <section data-t7-section="snapshots" data-ps-session-snapshot aria-label={t('studio.snapshots')}>
      <h2 data-t7-section-title>{t('studio.snapshots')}</h2>
      <p data-t7-section-note>{t('studio.snapshots.note')}</p>
      {listState.status === 'loading' && <p data-t7-placeholder data-ps-snapshot-loading="true">{t('studio.snapshots.loading')}</p>}
      {listState.status === 'error' && (
        <p data-ps-snapshot-error>{t('studio.snapshots.loadFailed')}{listState.message === '' ? '' : `:${listState.message}`}</p>
      )}
      {listState.status === 'loaded' && !listState.list.ready && (
        <p data-t7-placeholder data-ps-snapshot-unavailable="true">{t('studio.snapshots.storeUnavailable')}</p>
      )}
      {listState.status === 'loaded' && listState.list.ready && listState.list.snapshots.length === 0 && (
        <p data-t7-placeholder>{t('studio.snapshots.empty')}</p>
      )}
      {listState.status === 'loaded' && listState.list.ready && listState.list.snapshots.length > 0 && (
        <div>
          <p data-ps-snapshot-select-hint>{t('studio.snapshots.selectSession')}</p>
          <ul data-ps-snapshot-session-list>
            {listState.list.snapshots.map(item => (
              <li key={item.id}>
                <button
                  type="button"
                  data-ps-snapshot-session-row={item.sessionId}
                  data-ps-selected={selectedSession === item.sessionId ? 'true' : 'false'}
                  aria-current={selectedSession === item.sessionId ? 'true' : undefined}
                  onClick={() => { openSnapshot(item.sessionId) }}
                >
                  <span data-ps-snapshot-row-id>{item.sessionId}</span>
                  <span data-ps-snapshot-row-meta>
                    {formatTime(item.createdAt)} · {item.entries} {t('studio.snapshots.entriesCount')} · {item.checksum.slice(0, 12)}…
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
      {detailIssues !== null && <p data-ps-snapshot-error>{detailIssues}</p>}
      {detail !== null && (
        <div data-ps-snapshot-detail>
          <h3 data-t7-section-title>{t('studio.snapshots.detail')}</h3>
          <p data-ps-snapshot-note>{detail.note}</p>
          <div data-ps-snapshot-meta>
            <span data-ps-meta-item>{t('studio.snapshots.createdAt')}: {formatTime(detail.snapshot.createdAt)}</span>
            <span data-ps-meta-item>{t('studio.snapshots.trigger')}: {detail.snapshot.trigger}</span>
            <span data-ps-meta-item>{t('studio.snapshots.entriesCount')}: {detail.snapshot.entries.length}</span>
            <span data-ps-meta-item data-ps-snapshot-checksum>
              {t('studio.snapshots.checksum')}: {detail.snapshot.checksum.slice(0, 16)}…
            </span>
          </div>
          <ul data-ps-snapshot-entry-list>
            {detail.snapshot.entries.map(entry => (
              <li key={entry.entryId} data-ps-snapshot-entry={entry.entryId} data-ps-snapshot-kind={entry.kind}>
                <div data-ps-snapshot-entry-head>
                  <span data-ps-snapshot-entry-id>{entry.entryId}</span>
                  <span data-ps-pill data-ps-tone="neutral">{t(`studio.kind.${entry.kind}`)}</span>
                  {entry.kind !== 'patch-value' && (
                    <span data-ps-pill data-ps-tone="neutral" data-ps-snapshot-unreplayable="true">
                      {t('studio.snapshots.entry.unreplayable')}
                    </span>
                  )}
                  {entry.versionId !== null && (
                    <span data-ps-snapshot-pointer>{t('studio.snapshots.versionPointer')}: {entry.versionId}</span>
                  )}
                  {entry.versionId === null && entry.kind === 'patch-value' && (
                    <span data-ps-snapshot-pointer data-ps-snapshot-no-pointer="true">{t('studio.snapshots.noPointer')}</span>
                  )}
                </div>
                {entry.annotation !== null && <p data-ps-snapshot-entry-note>{entry.annotation}</p>}
                {entry.problems.length > 0 && (
                  <ul>
                    {entry.problems.map((problem, index) => <li key={index} data-ps-snapshot-entry-problem>{problem}</li>)}
                  </ul>
                )}
                {entry.text !== null && (
                  <details>
                    <summary>{t('studio.snapshots.entry.text')}({entry.bytes ?? 0} {t('studio.editor.bytes')})</summary>
                    <pre data-ps-snapshot-entry-text>{entry.text}</pre>
                  </details>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  )
}

/**
 * AI 润色区(T3.2):可用性胶囊(零模型调用)→ 润色侧重点 + 生成按钮 → 建议稿卡
 * (生成信息 + 建议稿全文(折叠)+ diff 预览 + 「作为提案提交」/「放弃建议稿」)。
 * 建议稿仅预览(永不直接生效);「作为提案提交」经 loopPrompt/ai-proposal 进与
 * 手工保存完全相同的 R3 两段式。运行时注入型条目不渲染本区(无写回落点,
 * 提案必然 fail-closed,不造可提交假象)。
 */
function AiPolishSection({ status, polish, instruction, aiBusy, busy, canPolish, diffEmpty, onInstructionChange, onPolish, onDiscard, onPropose, t }: {
  readonly status: AiStatusState
  readonly polish: AiPolishState
  readonly instruction: string
  /** 润色调用在途(与提案提交的 busy 分开,防交叉禁用)。 */
  readonly aiBusy: boolean
  /** 提案提交/审批应答在途。 */
  readonly busy: boolean
  /** 可润色(选中条目为 patch 值型且当前值可读、编辑器就绪)。 */
  readonly canPolish: boolean
  /** 建议稿与底稿无差异(提交必被拒,就地禁用 + 预览明示)。 */
  readonly diffEmpty: boolean
  readonly onInstructionChange: (value: string) => void
  readonly onPolish: () => void
  readonly onDiscard: () => void
  readonly onPropose: () => void
  readonly t: (key: string) => string
}): ReactElement {
  const available = status.status === 'loaded' && status.result.available
  // 可用性未知(检测中/RPC 失败)不禁用按钮——润色端点自身还有一道可用性自检,
  // 结论以端点返回为准;此处胶囊只是前置提示,失败不冒充结论。
  const blockPolish = !canPolish || aiBusy || busy || (status.status === 'loaded' && !available)
  return (
    <section data-ps-ai-polish data-t7-section="ai" aria-label={t('studio.ai')}>
      <h3 data-t7-section-title>{t('studio.ai')}</h3>
      <p data-t7-section-note>{t('studio.ai.note')}</p>
      <div data-ps-ai-status>
        <span data-ps-ai-status-label>{t('studio.ai.status')}</span>
        {status.status === 'loading' && <span data-ps-ai-status-value data-ps-ai-status-state="checking">{t('studio.ai.status.checking')}</span>}
        {status.status === 'error' && (
          <span data-ps-ai-status-value data-ps-ai-status-state="error" title={status.message}>{t('studio.ai.status.checking')}</span>
        )}
        {status.status === 'loaded' && (available
          ? <span data-ps-pill data-ps-tone="business" data-ps-ai-status-value data-ps-ai-available="true">{t('studio.ai.status.available')}</span>
          : <span data-ps-pill data-ps-tone="warn" data-ps-ai-status-value data-ps-ai-unavailable="true">{t('studio.ai.status.unavailable')}</span>)}
      </div>
      {status.status === 'loaded' && !available && (
        <p data-ps-ai-unavailable-note data-ps-ai-unavailable="true">
          {t('studio.ai.unavailable.note')}{status.result.reason === undefined ? '' : `(${status.result.reason})`}
        </p>
      )}
      <div data-ps-ai-input-row>
        <input
          data-ps-ai-instruction
          type="text"
          value={instruction}
          placeholder={t('studio.ai.instructionPlaceholder')}
          aria-label={t('studio.ai.instruction')}
          disabled={aiBusy}
          onChange={event => { onInstructionChange(event.target.value) }}
        />
        <button type="button" data-ps-ai-polish-btn disabled={blockPolish} onClick={onPolish}>
          {aiBusy ? t('studio.ai.polishing') : t('studio.ai.polish')}
        </button>
      </div>
      {polish.status === 'loading' && <p data-t7-placeholder data-ps-ai-loading="true">{t('studio.ai.polishing')}</p>}
      {polish.status === 'error' && <p data-ps-ai-error>{t('studio.ai.error')}:{polish.message}</p>}
      {polish.status === 'ok' && (
        <div data-ps-ai-draft-card>
          <div data-ps-ai-draft-head>
            <span data-ps-ai-draft-title>{t('studio.ai.draft.title')}</span>
            {polish.meta !== undefined && (
              <span data-ps-ai-draft-meta>
                {t('studio.ai.draft.meta')}: {polish.meta.provider} · {polish.meta.model} · {polish.meta.latencyMs}ms
              </span>
            )}
          </div>
          <details>
            <summary>{t('studio.ai.draft.text')}</summary>
            <pre data-ps-ai-draft>{polish.draft}</pre>
          </details>
          <AiDraftDiff base={polish.base} draft={polish.draft} t={t} />
          <div data-ps-ai-draft-actions>
            <button type="button" data-ps-ai-propose-btn disabled={busy || aiBusy || diffEmpty} onClick={onPropose}>
              {busy ? t('studio.ai.proposing') : t('studio.ai.propose')}
            </button>
            <button type="button" data-ps-ai-discard-btn disabled={busy || aiBusy} onClick={onDiscard}>
              {t('studio.ai.discard')}
            </button>
          </div>
        </div>
      )}
    </section>
  )
}

/**
 * AI 审核报告卡(T3.3):当前稿 → 问题清单 + 建议列表,对照润色建议稿卡
 * ([data-ps-ai-draft-card])同构形态(卡层级/字号阶梯/间距节奏),不发明孤立样式。
 * 报告分两栏来源:**本地校验器问题**(ruleFindings,与保存门禁同一套规则——展示
 * 层不另造实现)+ **模型问题清单**(aiFindings,元提示词五维:红线冲突/长度/
 * 变量引用/一致性/清晰度,逐条带 severity 徽标与建议)。**仅展示、不拦截**:
 * done 态不触任何写通道、不禁用保存;AI 不可用时本地校验器结果照常可看
 * (故按钮不因 AI 不可用而禁用,与润色按钮的可用性前置不同——降级随结果明示)。
 * 受审稿 ≠ 当前草稿时 [data-ps-ai-review-stale] 明示过期(结论对应审核时刻的稿,
 * 不冒充当前稿);报告归属条目由 AiReviewState.done.entryId 携带,渲染面
 * (visibleReview)与选中条目失配即整体不显示。
 */
function AiReviewSection({ review, stale, aiBusy, reviewing, busy, canReview, onReview, onClose, t }: {
  readonly review: AiReviewState
  /** 受审稿已改(报告对应审核时刻的稿,非当前草稿)——卡片明示,不冒充当前稿结论。 */
  readonly stale: boolean
  /** 任一 AI 调用在途(润色/审核共用 wire,互斥防并发)。 */
  readonly aiBusy: boolean
  /** 本区审核调用在途(按钮文案用;与 aiBusy 分开,防润色在途时误显「审核中」)。 */
  readonly reviewing: boolean
  readonly busy: boolean
  /** 可审核(选中条目为 patch 值型且编辑器草稿就绪)。 */
  readonly canReview: boolean
  readonly onReview: () => void
  readonly onClose: () => void
  readonly t: (key: string) => string
}): ReactElement {
  const blockReview = !canReview || aiBusy || busy
  const report = review.status === 'done' ? review.result : null
  const severityCounts = { error: 0, warning: 0, info: 0 }
  if (report !== null) {
    for (const finding of report.aiFindings) severityCounts[finding.severity] += 1
  }
  return (
    <section data-ps-ai-review data-t7-section="ai-review" aria-label={t('studio.ai.review')}>
      <h3 data-t7-section-title>{t('studio.ai.review')}</h3>
      <p data-t7-section-note>{t('studio.ai.review.note')}</p>
      <div data-ps-ai-review-input-row>
        <button type="button" data-ps-ai-review-btn disabled={blockReview} onClick={onReview}>
          {reviewing ? t('studio.ai.review.running') : t('studio.ai.review.run')}
        </button>
      </div>
      {review.status === 'loading' && <p data-t7-placeholder data-ps-ai-review-loading="true">{t('studio.ai.review.running')}</p>}
      {review.status === 'error' && <p data-ps-ai-review-error>{t('studio.ai.review.error')}:{review.message}</p>}
      {report !== null && (
        <div data-ps-ai-review-card
          data-ps-ai-review-status={report.status}
          data-ps-ai-review-rule-count={String(report.ruleFindings.length)}
          data-ps-ai-review-ai-count={String(report.aiFindings.length)}
        >
          <div data-ps-ai-review-head>
            <span data-ps-ai-review-title>{t('studio.ai.review.card')}</span>
            {report.meta !== undefined && (
              <span data-ps-ai-review-meta>
                {t('studio.ai.review.meta')}: {report.meta.provider} · {report.meta.model} · {report.meta.latencyMs}ms
              </span>
            )}
            <button type="button" data-ps-ai-review-close-btn disabled={aiBusy} onClick={onClose}>
              {t('studio.ai.review.close')}
            </button>
          </div>
          <span data-ps-ai-review-summary>
            {t('studio.ai.review.ruleFindings')} {report.ruleFindings.length} · {t('studio.ai.review.aiFindings')} {report.aiFindings.length}
            {report.aiFindings.length > 0
              && ` · ${t('studio.ai.review.severity.error')} ${severityCounts.error} · ${t('studio.ai.review.severity.warning')} ${severityCounts.warning} · ${t('studio.ai.review.severity.info')} ${severityCounts.info}`}
          </span>
          {report.issues !== undefined && report.issues.length > 0 && (
            <ul data-ps-ai-review-issues>
              {report.issues.map((issue, index) => <li key={index} data-ps-ai-review-issue>{issue}</li>)}
            </ul>
          )}
          {stale && <p data-ps-ai-review-stale="true">{t('studio.ai.review.stale')}</p>}
          <div data-ps-ai-review-rule-block>
            <span data-ps-ai-review-block-title>{t('studio.ai.review.ruleFindings')}</span>
            {report.ruleFindings.length === 0
              ? <p data-ps-ai-review-empty>{t('studio.ai.review.empty')}</p>
              : (
                <ul>
                  {report.ruleFindings.map((finding, index) => (
                    <li key={index} data-ps-ai-review-rulefinding>{finding}</li>
                  ))}
                </ul>
              )}
          </div>
          <div data-ps-ai-review-ai-block>
            <span data-ps-ai-review-block-title>{t('studio.ai.review.aiFindings')}</span>
            {report.aiFindings.length === 0
              ? <p data-ps-ai-review-empty>{t('studio.ai.review.empty.ai')}</p>
              : (
                <ul>
                  {report.aiFindings.map((finding, index) => (
                    <li key={index} data-ps-ai-review-finding>
                      <span data-ps-ai-review-severity={finding.severity}>{t(`studio.ai.review.severity.${finding.severity}`)}</span>
                      {finding.rule !== undefined && <span data-ps-ai-review-rule>{finding.rule}</span>}
                      <p data-ps-ai-review-message>{finding.message}</p>
                      {finding.suggestion !== undefined && (
                        <p data-ps-ai-review-suggestion>{t('studio.ai.review.suggestion')}: {finding.suggestion}</p>
                      )}
                    </li>
                  ))}
                </ul>
              )}
          </div>
          <p data-ps-ai-review-note data-ps-ai-review-note-text={report.note}>{report.note}</p>
        </div>
      )}
    </section>
  )
}

/** 提示词工坊根组件(注册表全景)。 */
export function StudioPage({ useStudio, refresh, call, t }: StudioPageProps): ReactElement {
  const state = useStudio(s => s)
  const ready = state.status === 'ready'
  const entries: readonly EntrySummaryView[] = ready ? state.snapshot.entries : []
  const [selectedId, setSelectedId] = useState<string>(DEFAULT_ENTRY_ID)
  const selected = entries.find(entry => entry.id === selectedId)
  /**
   * 选中条目的最新引用(切条目即时更新;异步延续读最新值):AI 润色/审核的在途
   * 响应返回时若条目已切换,按它丢弃响应——防「旧条目状态写入新选中条目」竞态
   * (评审 2026-11-11 medium:setState 无条件落位会覆盖 selectEntry 的 idle 重置)。
   */
  const selectedIdRef = useRef<string>(selectedId)

  // 编辑器草稿(view-local,按条目归属):draftEntry 记草稿归属条目,切条目即重置
  // (防上一条目的脏草稿串进下一条目);baseline=草稿所据的生效文本,用户未分叉
  // (draft===baseline)时跟随宿主刷新(React 官方「render 期调整派生状态」模式)。
  const [draft, setDraft] = useState<string | null>(null)
  const [baseline, setBaseline] = useState<string | null>(null)
  const [draftEntry, setDraftEntry] = useState<string | null>(null)
  const [summary, setSummary] = useState('')
  const [pending, setPending] = useState<PendingApproval | null>(null)
  const [outcome, setOutcome] = useState<WriteOutcomeView | null>(null)
  const [busy, setBusy] = useState(false)
  // 版本对比对 / 导出回执 / 导入所选文件与其预检 meta。
  const [diffPair, setDiffPair] = useState<DiffPair | null>(null)
  const [exportNote, setExportNote] = useState<string | null>(null)
  const [importFile, setImportFile] = useState<File | null>(null)
  const [importMeta, setImportMeta] = useState<string | null>(null)
  // 按条目版本链缓存(T1.5:选中/刷新时经 prompt-versions {entryId} 惰性拉取)。
  const [chains, setChains] = useState<Record<string, VersionsResult>>({})
  // 拉取状态分面(见 ChainFetchState):失败明示、可重试,不冒充 storage 缺席。
  const [chainFetches, setChainFetches] = useState<Record<string, ChainFetchState>>({})
  // T3.2 AI 润色流状态(选中条目归属;AI 可用性为宿主全局,快照刷新重检一次)。
  const [aiStatus, setAiStatus] = useState<AiStatusState>({ status: 'loading' })
  const [aiPolish, setAiPolish] = useState<AiPolishState>({ status: 'idle' })
  const [aiInstruction, setAiInstruction] = useState('')
  // 在途 AI 操作(润色/审核共用 wire,互斥防并发单飞;null=空闲)。T3.3 起从单一
  // 布尔改为操作标记:两区按钮互斥禁用但各自显示自己的在途文案。
  const [aiBusyOp, setAiBusyOp] = useState<'polish' | 'review' | null>(null)
  // T3.3 AI 审核报告状态(选中条目归属;报告仅展示不拦截)。
  const [aiReview, setAiReview] = useState<AiReviewState>({ status: 'idle' })
  const aiBusy = aiBusyOp !== null

  /** 选中条目的当前文本(patch 值型=反引文本;运行时注入型=空串,无编辑器)。 */
  const selectedText = selected !== undefined && selected.kind === 'patch-value' ? selected.value.text ?? '' : ''
  /**
   * patch 值型条目读值失败(value.text=null、problems 非空;如 profile 升级后锚点
   * 漂移)时不渲染编辑器——「不可读」不得冒充「合法的空内容」,problems 就地明示
   * (保存通道在宿主 locate 阶段同样 fail-closed 拒写,双保险)。
   */
  const valueUnreadable = selected !== undefined && selected.kind === 'patch-value' && selected.value.text === null
  if (ready && selected !== undefined && (draftEntry !== selected.id || selectedText !== baseline)) {
    if (draftEntry !== selected.id || draft === null || draft === baseline) {
      setDraftEntry(selected.id)
      setDraft(selectedText)
      setBaseline(selectedText)
    } else {
      // 用户已分叉:只推进基线记忆,草稿保持不动。
      setBaseline(selectedText)
    }
  }
  const dirty = ready && selected !== undefined && selected.kind === 'patch-value' && !valueUnreadable
    && draft !== null && draft !== selectedText
  const bytes = draft === null ? 0 : utf8Bytes(draft)

  /** 选中条目的版本链(默认条目初始链复用共享源旧形态拉取;其余按需缓存)。 */
  const chain: VersionsResult | undefined = ready && selected !== undefined
    ? (selected.id === DEFAULT_ENTRY_ID && chains[DEFAULT_ENTRY_ID] === undefined
        ? state.versions
        : chains[selected.id])
    : undefined
  /** 拉取状态(默认条目在显式拉取完成前以共享源链兜底,视为 loaded)。 */
  const chainFetch: ChainFetchState | undefined = selected !== undefined
    ? (selected.id === DEFAULT_ENTRY_ID && chains[DEFAULT_ENTRY_ID] === undefined
        ? { status: 'loaded' }
        : chainFetches[selected.id])
    : undefined
  const hasChain = chain !== undefined && chain.ready && chain.versions.length > 0
  const baseVersionId = chain !== undefined && chain.versions.length > 0 ? chain.versions[0]?.id : undefined

  // 按条目版本链惰性拉取:选中条目变化 / 快照刷新(写后 refresh 会换 generatedAt)时
  // 重拉;运行时注入型无版本链概念(versioned=false),不拉。失败不静默:
  // 状态面记 error 就地展示,换条目或刷新即重试;已有可展示链(默认条目初始链/
  // 上次缓存)时静默后台刷新,不闪「拉取中」。
  const generatedAt = state.status === 'ready' ? state.snapshot.generatedAt : ''
  useEffect(() => {
    if (!ready || selected === undefined || !selected.versioned) return
    const entryId = selected.id
    // chains 只读不进依赖(进依赖会因 setChains 改引用而重触发成环);本闭包取
    //「依赖变化那一轮渲染」的 chains,对「是否已有可展示链」的判断已足够新鲜。
    const hasDisplayableChain = entryId === DEFAULT_ENTRY_ID || chains[entryId] !== undefined
    let cancelled = false
    setChainFetches(previous => {
      if (hasDisplayableChain && previous[entryId] === undefined) return previous
      if (previous[entryId]?.status === 'loaded') return previous
      return { ...previous, [entryId]: { status: 'loading' } }
    })
    void (async (): Promise<void> => {
      const result = await call<VersionsResult>(ENDPOINTS.promptVersions, { input: { entryId } })
      if (cancelled) return
      if (result.ok) {
        setChains(previous => ({ ...previous, [entryId]: result.value }))
        setChainFetches(previous => ({ ...previous, [entryId]: { status: 'loaded' } }))
      } else {
        setChainFetches(previous => ({ ...previous, [entryId]: { status: 'error', message: result.message } }))
      }
    })()
    return () => { cancelled = true }
  }, [ready, selected, generatedAt, call])

  // AI 可用性(宿主全局;零模型调用):就绪后拉一次,快照刷新(写后 refresh)重检;
  // RPC 通道失败与「AI 不可用」结论分态(AiStatusState 注),不互相冒充。
  useEffect(() => {
    if (!ready) return
    let cancelled = false
    setAiStatus(previous => (previous.status === 'loaded' ? previous : { status: 'loading' }))
    void (async (): Promise<void> => {
      const result = await call<AiStatusResult>(ENDPOINTS.aiStatus, { input: {} })
      if (cancelled) return
      if (result.ok) setAiStatus({ status: 'loaded', result: result.value })
      else setAiStatus({ status: 'error', message: result.message })
    })()
    return () => { cancelled = true }
  }, [ready, generatedAt, call])

  /**
   * 生成建议稿(T3.2):以编辑器当前草稿为底稿(用户先手改再润色的诉求自然覆盖);
   * 端点零写动作,失败/不可用 issues 就地明示。ok 态只入预览,不触任何写通道。
   */
  const runAiPolish = async (): Promise<void> => {
    if (!ready || selected === undefined || selected.kind !== 'patch-value' || valueUnreadable || aiBusy || busy) return
    const entryIdAtStart = selected.id
    const base = draft ?? selectedText
    setAiBusyOp('polish')
    setAiPolish({ status: 'loading' })
    try {
      const result = await call<AiPolishResult>(ENDPOINTS.aiPolish, {
        input: {
          entryId: entryIdAtStart,
          content: base,
          ...(aiInstruction.trim() !== '' && { instruction: aiInstruction.trim() }),
        },
      })
      // 竞态守卫:在途期间已切换条目 → 丢弃响应(不得把旧条目状态写入新选中条目;
      // busy 仍照常在 finally 清除——单飞互斥是全局的,不随条目切换滞留)。
      if (selectedIdRef.current !== entryIdAtStart) return
      if (!result.ok) {
        setAiPolish({ status: 'error', message: result.message })
        return
      }
      if (result.value.status === 'ok' && result.value.draft !== undefined) {
        setAiPolish({
          status: 'ok',
          entryId: entryIdAtStart,
          base,
          draft: result.value.draft,
          ...(result.value.meta !== undefined && { meta: result.value.meta }),
        })
        return
      }
      const detail = result.value.issues !== undefined && result.value.issues.length > 0
        ? result.value.issues.join(';')
        : result.value.note
      setAiPolish({ status: 'error', message: `${result.value.status} — ${detail}` })
    } finally {
      setAiBusyOp(null)
    }
  }

  /**
   * 审核当前稿(T3.3):以编辑器当前草稿为受审文本(与润色同底稿口径);
   * ok/unavailable 均入报告卡——unavailable 时本地校验器结果(ruleFindings)
   * 仍在,不依赖模型;其余分态(rejected/failed)按错误就地明示。**零写动作**:
   * 报告仅展示,不触任何写通道、不产生在途审批。done 态记录受审条目与受审稿全文
   * (entryId/content):在途切条目即丢弃响应;受审稿 ≠ 当前草稿时卡片明示过期
   * (不冒充当前稿结论)。
   */
  const runAiReview = async (): Promise<void> => {
    if (!ready || selected === undefined || selected.kind !== 'patch-value' || valueUnreadable || aiBusy || busy) return
    const entryIdAtStart = selected.id
    const content = draft ?? selectedText
    setAiBusyOp('review')
    setAiReview({ status: 'loading' })
    try {
      const result = await call<AiReviewResult>(ENDPOINTS.aiReview, {
        input: { entryId: entryIdAtStart, content },
      })
      // 竞态守卫:同 runAiReview 头注/评审 2026-11-11 medium。
      if (selectedIdRef.current !== entryIdAtStart) return
      if (!result.ok) {
        setAiReview({ status: 'error', message: result.message })
        return
      }
      if (result.value.status === 'ok' || result.value.status === 'unavailable') {
        setAiReview({ status: 'done', entryId: entryIdAtStart, content, result: result.value })
        return
      }
      const detail = result.value.issues !== undefined && result.value.issues.length > 0
        ? result.value.issues.join(';')
        : result.value.note
      setAiReview({ status: 'error', message: `${result.value.status} — ${detail}` })
    } finally {
      setAiBusyOp(null)
    }
  }

  /**
   * 作为提案提交(T3.2):建议稿经 loopPrompt/ai-proposal 进与手工保存完全相同的
   * R3 两段式(第一段 approval-required → 共享 ApprovalSection;第二段 answerApproval
   * 回显同载荷)。携带润色结果的生成信息作 AI 来源标注(宿主进审计 aiSource)。
   * 竞态守卫(评审 2026-11-11 medium):载荷 entryId/乐观锁取**建议稿归属条目**
   * (aiPolish.entryId)且须与当前选中条目一致——旧条目建议稿贴新选中条目发起
   * 写请求的路径在此 fail-closed(渲染面 visiblePolish 已按条目失配隐藏卡片,此处
   * 是同一纪律的载荷级双保险)。
   */
  const submitAiProposal = async (): Promise<void> => {
    if (busy || aiBusy || selected === undefined || selected.kind !== 'patch-value' || aiPolish.status !== 'ok'
      || aiPolish.entryId !== selected.id) return
    setBusy(true)
    setOutcome(null)
    const echo: WriteEcho = {
      content: aiPolish.draft,
      entryId: aiPolish.entryId,
      ...(baseVersionId !== undefined && { baseVersionId }),
      author: 'web',
      ...(aiPolish.meta !== undefined && {
        aiMeta: {
          provider: aiPolish.meta.provider,
          model: aiPolish.meta.model,
          metaPromptEntryId: aiPolish.meta.metaPromptEntryId,
        },
      }),
    }
    try {
      const result = await call<PromptSaveResult>(ENDPOINTS.aiProposal, { input: echo })
      if (!result.ok) {
        setOutcome({ kind: 'ai-proposal', status: 'error', message: result.message })
        return
      }
      if (result.value.status === 'approval-required' && result.value.approval !== undefined) {
        const approval: WriteApprovalView = result.value.approval
        setPending({
          endpoint: ENDPOINTS.aiProposal,
          approvalId: approval.approvalId,
          kind: approval.kind,
          card: approval.card,
          questionItems: approval.questionItems,
          echo,
        })
        return
      }
      setOutcome(writeOutcomeFrom('ai-proposal', result.value))
      if (result.value.status === 'committed') {
        // 建议稿已生效为当前值,预览使命结束(残留只会显示「无差异」)。
        setAiPolish({ status: 'idle' })
        window.setTimeout(refresh, 8000)
      }
    } finally {
      setBusy(false)
    }
  }

  /** 保存(第一段):校验/乐观锁在宿主;拒绝 issues 就地展示,批准则弹卡。 */
  const startSave = async (): Promise<void> => {
    if (draft === null || busy || selected === undefined || selected.kind !== 'patch-value') return
    setBusy(true)
    setOutcome(null)
    const echo: WriteEcho = {
      content: draft,
      entryId: selected.id,
      ...(baseVersionId !== undefined && { baseVersionId }),
      ...(summary.trim() !== '' && { summary: summary.trim() }),
      author: 'web',
    }
    try {
      const result = await call<PromptSaveResult>(ENDPOINTS.promptSave, { input: echo })
      if (!result.ok) {
        setOutcome({ kind: 'save', status: 'error', message: result.message })
        return
      }
      if (result.value.status === 'approval-required' && result.value.approval !== undefined) {
        const approval: WriteApprovalView = result.value.approval
        setPending({
          endpoint: ENDPOINTS.promptSave,
          approvalId: approval.approvalId,
          kind: approval.kind,
          card: approval.card,
          questionItems: approval.questionItems,
          echo,
        })
        return
      }
      setOutcome(writeOutcomeFrom('save', result.value))
      if (result.value.status === 'committed') refresh()
    } finally {
      setBusy(false)
    }
  }

  /** 第二段:回显同载荷 + approvalId + approved(TOCTOU 由宿主复验)。 */
  const answerApproval = async (approved: boolean): Promise<void> => {
    if (pending === null || busy) return
    setBusy(true)
    try {
      const result = await call<PromptSaveResult>(pending.endpoint, {
        input: { ...pending.echo, approvalId: pending.approvalId, approved },
      })
      if (!result.ok) {
        setOutcome({ kind: pending.kind, status: 'error', message: result.message })
      } else {
        setOutcome(writeOutcomeFrom(pending.kind, result.value))
        if (result.value.status === 'committed') {
          setPending(null)
          // 通道 A:写盘触发 HMR 重组合(awaitWriteFinish≈2s);按 8s 级轮询刷新生效态。
          window.setTimeout(refresh, 8000)
        }
      }
    } finally {
      setBusy(false)
    }
  }

  /** 回滚(两段式;产生新版本指向目标内容,parentId=被回滚版本;按版本归属条目落点)。 */
  const startRollback = async (version: PromptVersionRecord): Promise<void> => {
    if (busy) return
    setBusy(true)
    setOutcome(null)
    const echo: WriteEcho = {
      versionId: version.id,
      entryId: version.entryId,
      ...(baseVersionId !== undefined && { baseVersionId }),
      summary: `${t('studio.rollbackTo')} #${version.seq}(${version.id})`,
      author: 'web',
    }
    try {
      const result = await call<PromptSaveResult>(ENDPOINTS.promptRollback, { input: echo })
      if (!result.ok) {
        setOutcome({ kind: 'rollback', status: 'error', message: result.message })
        return
      }
      if (result.value.status === 'approval-required' && result.value.approval !== undefined) {
        const approval = result.value.approval
        setPending({
          endpoint: ENDPOINTS.promptRollback,
          approvalId: approval.approvalId,
          kind: approval.kind,
          card: approval.card,
          questionItems: approval.questionItems,
          echo,
        })
        return
      }
      setOutcome(writeOutcomeFrom('rollback', result.value))
      if (result.value.status === 'committed') refresh()
    } finally {
      setBusy(false)
    }
  }

  /** 导出(只读,不走审批):宿主产包 → 浏览器下载;versionId 缺省=该条目最新。 */
  const exportVersion = async (version: PromptVersionRecord | null): Promise<void> => {
    if (busy || selected === undefined || !selected.versioned || !hasChain) return
    setBusy(true)
    setOutcome(null)
    try {
      const input = {
        ...(version === null ? {} : { versionId: version.id }),
        // 默认条目缺省 entryId(与 T7 包形状零差异);其余条目指名。
        ...(selected.id !== DEFAULT_ENTRY_ID && { entryId: selected.id }),
      }
      const result = await call<PromptExportResult>(ENDPOINTS.promptExport, { input })
      if (!result.ok) {
        setExportNote(`${t('studio.export.failed')}: ${result.message}`)
        return
      }
      const prefix = selected.id === DEFAULT_ENTRY_ID ? 'persona' : selected.id
      const filename = `${prefix}-v${result.value.version.seq}-${result.value.version.id}.json`
      downloadJson(filename, result.value.pack)
      setExportNote(
        `${t('studio.export.done')} ${filename} · #${result.value.version.seq} · ${result.value.pack.checksum.slice(0, 12)}…`,
      )
    } finally {
      setBusy(false)
    }
  }

  /** 导入(第一段):本地 JSON 预检(形状)→ 宿主强校验(checksum/内容)→ R3 审批。 */
  const startImport = async (): Promise<void> => {
    if (importFile === null || busy) return
    setBusy(true)
    setOutcome(null)
    try {
      let pack: unknown
      try {
        pack = JSON.parse(await importFile.text()) as unknown
      } catch {
        setOutcome({ kind: 'import', status: 'error', message: t('studio.import.invalid') })
        return
      }
      // 本地只做形状预检(即时反馈);schemaVersion/checksum/内容三道强校验都在宿主。
      const shapeOk = typeof pack === 'object' && pack !== null && !Array.isArray(pack)
        && (pack as Record<string, unknown>)['schemaVersion'] === 1
        && typeof (pack as Record<string, unknown>)['persona'] === 'string'
        && typeof (pack as Record<string, unknown>)['checksum'] === 'string'
      if (!shapeOk) {
        setOutcome({ kind: 'import', status: 'error', message: t('studio.import.invalid') })
        return
      }
      const probe = pack as { entryId?: unknown; sourceVersionId?: unknown; exportedBy?: unknown; persona: string }
      const packEntryId = typeof probe.entryId === 'string' ? probe.entryId : DEFAULT_ENTRY_ID
      setImportMeta(
        `${t('studio.import.selected')} ${importFile.name} · ${t('studio.entry.detail')}: ${packEntryId} · ${String(probe.sourceVersionId ?? '—')} · ${String(probe.exportedBy ?? '—')} · ${formatTokens(utf8Bytes(probe.persona))}B`,
      )
      // 乐观锁只在与包内目标条目一致时随行(跨条目导入不带本视图选中链的锁,
      // 免误拒;宿主仍有 TOCTOU 基线与包校验兜底)。
      const echo: WriteEcho = {
        pack,
        summary: `导入 ${importFile.name}`,
        ...(selected !== undefined && packEntryId === selected.id && baseVersionId !== undefined
          && { baseVersionId }),
        author: 'web',
      }
      const result = await call<PromptSaveResult>(ENDPOINTS.promptImport, { input: echo })
      if (!result.ok) {
        setOutcome({ kind: 'import', status: 'error', message: result.message })
        return
      }
      if (result.value.status === 'approval-required' && result.value.approval !== undefined) {
        const approval = result.value.approval
        setPending({
          endpoint: ENDPOINTS.promptImport,
          approvalId: approval.approvalId,
          kind: approval.kind,
          card: approval.card,
          questionItems: approval.questionItems,
          echo,
        })
        return
      }
      setOutcome(writeOutcomeFrom('import', result.value))
      if (result.value.status === 'committed') refresh()
    } finally {
      setBusy(false)
    }
  }

  /** 切换选中条目(编辑上下文整体重置:对比/导出回执/变更摘要/写入结果/AI 建议稿/
   * AI 审核报告;草稿由 render 期派生逻辑按新条目重置)。摘要会进保存载荷、结果无
   * 条目标识,均不得从上一条目串入下一条目;建议稿与审核报告同理(受审文本与条目
   * 强绑定)。 */
  const selectEntry = (entryId: string): void => {
    selectedIdRef.current = entryId
    setSelectedId(entryId)
    setDiffPair(null)
    setExportNote(null)
    setSummary('')
    setOutcome(null)
    setAiPolish({ status: 'idle' })
    setAiInstruction('')
    setAiReview({ status: 'idle' })
  }

  // AI 区条目归属过滤(评审 2026-11-11 medium 的渲染面防线):ok/done 态携带的
  // entryId 与选中条目不符即按 idle 处理——旧条目的建议稿/审核报告绝不贴在新选中
  // 条目下方(在途响应丢弃见 runAiPolish/runAiReview 的 selectedIdRef 守卫)。
  const visiblePolish: AiPolishState = aiPolish.status === 'ok' && aiPolish.entryId !== selected?.id
    ? { status: 'idle' }
    : aiPolish
  const visibleReview: AiReviewState = aiReview.status === 'done' && aiReview.entryId !== selected?.id
    ? { status: 'idle' }
    : aiReview
  // 受审稿过期标识:done 态记录的受审全文 ≠ 当前编辑器草稿时,卡片明示「结论对应
  // 审核时刻的稿」(评审 2026-11-11 low:无版本线索的旧报告会冒充当前稿结论)。
  const reviewStale = visibleReview.status === 'done' && draft !== null && draft !== visibleReview.content

  return (
    <div data-t7-studio-root aria-label={t('studio')}>
      <div data-t7-toolbar>
        <h1 data-t7-heading>{t('studio')}</h1>
        <button type="button" data-t7-refresh onClick={refresh}>{t('refresh')}</button>
      </div>
      <p data-t7-sub>{t('studio.subtitle')}</p>

      {ready && (
        <div data-t7-stat-row>
          <Stat anchor="entries" label={t('studio.stats.entries')} value={String(entries.length)} />
          <Stat anchor="sessions" label={t('studio.stats.sessions')} value={String(state.snapshot.trace.sessions)} />
          <Stat anchor="channel" label={t('studio.stats.channel')} value={state.snapshot.channel.kind} />
          <Stat anchor="pending" label={t('studio.stats.pending')} value={state.snapshot.pendingApproval === null ? '0' : '1'} />
        </div>
      )}

      {state.status === 'loading' && <p data-t7-placeholder>{t('state.loading')}</p>}
      {state.status === 'error' && <p data-t7-error>{t('state.error')}: {state.message}</p>}

      {ready && (
        <GroupNav entries={entries} selectedId={selectedId} onSelect={selectEntry} t={t} />
      )}

      {ready && (
        <SessionSnapshotsView call={call} t={t} ready={ready} generatedAt={generatedAt} />
      )}

      {ready && selected !== undefined && (
        <section data-ps-entry-detail data-t7-section="detail" aria-label={t('studio.entry.detail')}>
          <h2 data-t7-section-title data-ps-entry-title>{selected.id}</h2>
          <div data-ps-entry-badges>
            <span data-ps-pill data-ps-tone="neutral">{t(`studio.layer.${selected.layer}`)}</span>
            <span data-ps-pill data-ps-tone="neutral">{t(`studio.kind.${selected.kind}`)}</span>
            {selected.redLine === 'required'
              ? <span data-ps-pill data-ps-tone="warn">{t('studio.entry.redline.required')}</span>
              : <span data-ps-pill data-ps-tone="neutral">{t('studio.entry.redline.exempt')}</span>}
          </div>
          <p data-ps-entry-note>{selected.note}</p>
          <div data-ps-entry-effect data-ps-effect-radius={selected.effect.radius}>
            <span data-ps-entry-effect-title>{t('studio.entry.effect')}</span>
            <span
              data-ps-pill
              data-ps-tone={selected.effect.radius === 'immediate-new-session' ? 'business' : selected.effect.radius === 'not-composed-anywhere' ? 'warn' : 'neutral'}
              data-ps-effect-badge
            >
              {t(`studio.effect.${selected.effect.radius}`)}
            </span>
            <p data-ps-entry-effect-note>{selected.effect.note}</p>
          </div>
          <div data-ps-entry-risks>
            <span data-ps-entry-risks-title>{t('studio.entry.risks')}</span>
            <ul>
              {selected.risks.map((risk, index) => <li key={index} data-ps-risk-item>{risk}</li>)}
            </ul>
          </div>
          <div data-ps-entry-meta>
            <span data-ps-meta-item>{t('studio.entry.source')}: {selected.source}</span>
            <span data-ps-meta-item>
              {t('studio.entry.maxBytes')}: {formatTokens(selected.maxBytes)} {t('studio.editor.bytes')}
            </span>
            {selected.redLineRuleSet !== undefined && (
              <span data-ps-meta-item>{t('studio.entry.ruleSet')}: {selected.redLineRuleSet}</span>
            )}
            <span data-ps-meta-item>
              {t('studio.entry.versionsCount')}:
              {' '}{selected.versions.ready ? formatTokens(selected.versions.count) : t('studio.entry.storeUnavailable')}
            </span>
            {selected.id === DEFAULT_ENTRY_ID && (
              <span data-ps-meta-item>
                {t('studio.persona.meta')}: <span data-t7-persona-path>{state.snapshot.persona.patchPath ?? '—'}</span>
              </span>
            )}
          </div>

          {selected.kind === 'patch-value' && !valueUnreadable && (
            <section data-t7-section="editor" aria-label={t('studio.editor')}>
              <h3 data-t7-section-title>{t('studio.editor')}</h3>
              <p data-t7-section-note>{t('studio.editor.note')}</p>
              <textarea
                data-t7-editor
                value={draft ?? ''}
                disabled={!ready}
                onChange={event => { setDraft(event.target.value) }}
                rows={12}
                spellCheck={false}
              />
              <div data-t7-editor-meta>
                <span data-t7-editor-bytes>
                  {formatTokens(bytes)} / {formatTokens(selected.maxBytes)} {t('studio.editor.bytes')}
                </span>
                <span data-t7-editor-dirty data-t7-editor-dirty-flag={dirty ? 'true' : 'false'}>
                  {dirty ? t('studio.editor.dirty') : t('studio.editor.pristine')}
                </span>
              </div>
              <input
                data-t7-save-summary
                type="text"
                value={summary}
                placeholder={t('studio.editor.summaryPlaceholder')}
                onChange={event => { setSummary(event.target.value) }}
              />
              <div data-t7-editor-actions>
                <button
                  type="button"
                  data-t7-save-btn
                  data-ps-entry-save
                  disabled={!ready || busy || draft === null}
                  onClick={() => { void startSave() }}
                >
                  {busy ? t('studio.saving') : t('studio.save')}
                </button>
              </div>
            </section>
          )}
          {selected.kind === 'patch-value' && !valueUnreadable && (
            <AiPolishSection
              status={aiStatus}
              polish={visiblePolish}
              instruction={aiInstruction}
              aiBusy={aiBusy}
              busy={busy}
              canPolish={ready && draft !== null}
              diffEmpty={visiblePolish.status !== 'ok' || diffLines(visiblePolish.base, visiblePolish.draft).isEmpty}
              onInstructionChange={setAiInstruction}
              onPolish={() => { void runAiPolish() }}
              onDiscard={() => { setAiPolish({ status: 'idle' }) }}
              onPropose={() => { void submitAiProposal() }}
              t={t}
            />
          )}
          {selected.kind === 'patch-value' && !valueUnreadable && (
            <AiReviewSection
              review={visibleReview}
              stale={reviewStale}
              aiBusy={aiBusy}
              reviewing={aiBusyOp === 'review'}
              busy={busy}
              canReview={ready && draft !== null}
              onReview={() => { void runAiReview() }}
              onClose={() => { setAiReview({ status: 'idle' }) }}
              t={t}
            />
          )}
          {valueUnreadable && (
            <div data-ps-entry-value-error data-t7-section="unreadable" aria-label={t('studio.entry.valueUnreadable.title')}>
              <h3 data-t7-section-title>{t('studio.entry.valueUnreadable.title')}</h3>
              <p data-ps-entry-value-error-note>{t('studio.entry.valueUnreadable.note')}</p>
              {(selected.value.problems.length > 0 ? selected.value.problems : [t('studio.entry.valueUnreadable.fallback')])
                .map((problem, index) => <p key={index} data-ps-entry-problem-item>{problem}</p>)}
            </div>
          )}
          {selected.kind === 'runtime-injection' && (
            <div data-ps-entry-runtime data-t7-section="runtime" aria-label={t('studio.entry.runtime.title')}>
              <h3 data-t7-section-title>{t('studio.entry.runtime.title')}</h3>
              <p data-ps-entry-runtime-note>{t('studio.entry.runtime.note')}</p>
              <p data-ps-entry-value-note>{t('studio.entry.runtime.value')}</p>
            </div>
          )}

          {selected.versioned && (
            <section data-t7-section="versions" aria-label={t('studio.versions')}>
              <h3 data-t7-section-title>{t('studio.versions')}</h3>
              <p data-t7-section-note>{t('studio.versions.note')}</p>
              <div data-t7-export-row>
                <button
                  type="button"
                  data-t7-export-latest
                  disabled={!hasChain || busy}
                  onClick={() => { void exportVersion(null) }}
                >
                  {t('studio.export.latest')}
                </button>
                {exportNote !== null && <span data-t7-export-status>{exportNote}</span>}
              </div>
              {hasChain && chain !== undefined && (
                <div data-t7-version-list>
                  {chain.versions.map((version, index) => (
                    <VersionItem
                      key={version.id}
                      version={version}
                      previous={chain.versions[index + 1] ?? null}
                      busy={busy}
                      onLoad={content => { setDraft(content) }}
                      onCompare={(target, previous) => {
                        if (previous !== null) setDiffPair({ a: previous, b: target })
                      }}
                      onRollback={target => { void startRollback(target) }}
                      onExport={target => { void exportVersion(target) }}
                      t={t}
                    />
                  ))}
                </div>
              )}
              {ready && chain !== undefined && chain.ready && chain.versions.length === 0 && (
                <p data-t7-placeholder>{t('state.empty')}</p>
              )}
              {ready && chain !== undefined && !chain.ready && (
                <p data-t7-placeholder data-t7-versions-unavailable="true">{t('state.empty')}(storage 未挂载)</p>
              )}
              {/* 三态分离:拉取中(RPC 在途,含 effect 尚未落 loading 态的首帧)与
                  拉取失败(RPC 通道错/超时)不得冒充 storage 缺席——unavailable 锚点
                  只在拿到 loaded 数据且 !ready 时点亮。 */}
              {chain === undefined && (chainFetch === undefined || chainFetch.status === 'loading') && (
                <p data-t7-placeholder data-ps-chain-loading="true">{t('studio.versions.loading')}</p>
              )}
              {chainFetch !== undefined && chainFetch.status === 'error' && (
                <p data-ps-chain-error>
                  {t('studio.versions.loadFailed')}{chainFetch.message === '' ? '' : `:${chainFetch.message}`}
                </p>
              )}
              {diffPair !== null && (
                <DiffView pair={diffPair} onClose={() => { setDiffPair(null) }} t={t} />
              )}
            </section>
          )}

          {outcome !== null && (
            <div data-t7-write-outcome data-t7-write-status={outcome.status}>
              <span data-t7-write-status-label>{t('studio.write.status')}: {outcome.kind} · {outcome.status}</span>
              {outcome.message !== undefined && <span data-t7-write-message>{outcome.message}</span>}
              {outcome.issues !== undefined && (
                <ul data-t7-save-error>
                  {outcome.issues.map(issue => <li key={issue} data-t7-issue>{issue}</li>)}
                </ul>
              )}
              {outcome.version !== undefined && (
                <span data-t7-write-version>
                  #{outcome.version.seq} {outcome.version.id}({outcome.version.source})
                </span>
              )}
              {outcome.effectiveNote !== undefined && (
                <p data-t7-effective-note>{outcome.effectiveNote}</p>
              )}
            </div>
          )}
        </section>
      )}

      {pending !== null && (
        <ApprovalSection pending={pending} busy={busy} onAnswer={approved => { void answerApproval(approved) }} t={t} />
      )}

      <section data-t7-section="transfer" aria-label={t('studio.transfer')}>
        <h2 data-t7-section-title>{t('studio.transfer')}</h2>
        <p data-t7-section-note>{t('studio.transfer.note')}</p>
        <div data-t7-import-row>
          <input
            type="file"
            data-t7-import-input
            accept=".json,application/json"
            aria-label={t('studio.import.pick')}
            onChange={event => {
              setImportFile(event.target.files?.[0] ?? null)
              setImportMeta(null)
            }}
          />
          <button
            type="button"
            data-t7-import-btn
            disabled={!ready || importFile === null || busy}
            onClick={() => { void startImport() }}
          >
            {t('studio.import.do')}
          </button>
          {importMeta !== null && <span data-t7-import-meta>{importMeta}</span>}
        </div>
      </section>
    </div>
  )
}
