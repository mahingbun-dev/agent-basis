/**
 * 侧栏「提示词工坊」主面板(main keyed slot 占位;T1.5 从 persona 单条改注册表全景):
 *
 * - 分组导航 [data-ps-group-nav]:preset/领域/运行时 三层分组行卡(access 插件页
 *   同构形态)——条目 id + 型别/可编辑性胶囊 + 「升级可能覆盖」风险胶囊 + 版本数/
 *   字节;点击切换条目详情;
 * - 条目详情 [data-ps-entry-detail]:元数据卡(层/型别/来源/红线策略/字节上限/
 *   版本概览)+ 风险标注警示区(升级覆盖等,registry risks 全文展示)+ 分型值区:
 *   patch 值型 → 编辑器(保存两段式 R3;[data-t7-editor]/[data-t7-save-btn]/
 *   [data-ps-entry-save]);行锚点只读型/运行时注入型 → 只读说明面板(「上游
 *   运行时生成,无 patch 写回落点」明示,不造可编辑假象);
 * - 版本/diff 复用(T7.3 组件按条目渲染):VersionItem(载入/对比/导出/回滚,
 *   无任何删除入口——版本只增不删)+ DiffView([data-ps-diff-view] 锚点叠加);
 * - 导入(JSON 包;包内 entryId 指名落点条目)+ R3 审批卡 + 写结果就地展示。
 *
 * 数据经 inject 面到达(props.useStudio / props.refresh / props.call),不触 ctx。
 * 条目元数据与当前值来自 snapshot.entries[](T1.4 全景);按条目版本链经
 * prompt-versions {entryId} 惰性拉取并缓存(默认条目初始链复用共享源的旧形态
 * 拉取)。DOM 全部带 data-t7- 与 data-ps- 结构化锚点,供 E2E 严断言定位;样式只经
 * 官方语义令牌(--dsw-alias-*,styles.ts)。
 */
import { useEffect, useState, type ReactElement } from 'react'
import { lineDiffOps } from '../diff.ts'
import type { LineDiffOp } from '../diff.ts'
import type {
  EntrySummaryView, PromptExportResult, PromptSaveResult, PromptVersionRecord, VersionsResult,
  WriteApprovalView,
} from '../types.ts'
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

/** 分组导航的层次序(注册表层枚举序;preset → 领域 → 运行时)。 */
const LAYERS = ['preset', 'domain', 'runtime'] as const

/**
 * 按条目版本链的拉取状态(与数据面 chains 分离):「拉取中 / 拉取失败(RPC 通道错、
 * 超时等)」与「版本库真未挂载(loaded 且 !ready)」三态分开展示——失败不得伪装成
 * storage 缺席,也不得静默吞掉(缺席降级必须如实标注)。
 */
type ChainFetchState =
  | { readonly status: 'loading' }
  | { readonly status: 'error'; readonly message: string }
  | { readonly status: 'loaded' }

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

/** 触发浏览器下载(导出 JSON 包;Blob + 临时 <a download>)。 */
function downloadJson(filename: string, data: unknown): void {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  anchor.click()
  window.setTimeout(() => { URL.revokeObjectURL(url) }, 1000)
}

/** 提示词工坊根组件(注册表全景)。 */
export function StudioPage({ useStudio, refresh, call, t }: StudioPageProps): ReactElement {
  const state = useStudio(s => s)
  const ready = state.status === 'ready'
  const entries: readonly EntrySummaryView[] = ready ? state.snapshot.entries : []
  const [selectedId, setSelectedId] = useState<string>(DEFAULT_ENTRY_ID)
  const selected = entries.find(entry => entry.id === selectedId)

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

  /** 选中条目的当前文本(patch 值型=反引文本;只读型/运行时型=空串,无编辑器)。 */
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
  // 重拉;只读型/运行时注入型无版本链概念(versioned=false),不拉。失败不静默:
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

  /** 切换选中条目(编辑上下文整体重置:对比/导出回执/变更摘要/写入结果;草稿由
   * render 期派生逻辑按新条目重置)。摘要会进保存载荷、结果无条目标识,均不得
   * 从上一条目串入下一条目。 */
  const selectEntry = (entryId: string): void => {
    setSelectedId(entryId)
    setDiffPair(null)
    setExportNote(null)
    setSummary('')
    setOutcome(null)
  }

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
          {valueUnreadable && (
            <div data-ps-entry-value-error data-t7-section="unreadable" aria-label={t('studio.entry.valueUnreadable.title')}>
              <h3 data-t7-section-title>{t('studio.entry.valueUnreadable.title')}</h3>
              <p data-ps-entry-value-error-note>{t('studio.entry.valueUnreadable.note')}</p>
              {(selected.value.problems.length > 0 ? selected.value.problems : [t('studio.entry.valueUnreadable.fallback')])
                .map((problem, index) => <p key={index} data-ps-entry-problem-item>{problem}</p>)}
            </div>
          )}
          {selected.kind === 'line-anchor-readonly' && (
            <div data-ps-entry-readonly data-t7-section="readonly" aria-label={t('studio.entry.readonly.title')}>
              <h3 data-t7-section-title>{t('studio.entry.readonly.title')}</h3>
              <p data-ps-entry-readonly-note>{t('studio.entry.readonly.note')}</p>
              <p data-ps-entry-value-note>{t('studio.entry.readonly.value')}</p>
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
