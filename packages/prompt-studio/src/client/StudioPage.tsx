/**
 * 侧栏「提示词工坊」主面板(main keyed slot 占位):最终生效组合只读区 +
 * personaPrefix 编辑器(保存两段式 R3)+ 版本列表(回滚/对比/导出)+ 导入。
 * T7.3 版本管理:UI 义务=版本间 diff 对比视图、回滚(两段式 R3)、导出 JSON 包
 * (浏览器下载)、导入(上传→同一套校验在宿主→R3 审批→新增本);删除操作不存在
 * (版本只增不删,任何路径都没有删除入口,tests/client-bundle.test.ts 钉住)。
 *
 * 数据经 inject 面到达(props.useStudio / props.refresh / props.call),不触 ctx。
 * DOM 全部带 data-t7-* 结构化锚点,供 E2E 严断言定位(非全文匹配)。
 * 样式只经官方语义令牌(--dsw-alias-*,styles.ts)。
 */
import { useState, type ReactElement } from 'react'
import { lineDiffOps } from '../diff.ts'
import type { LineDiffOp } from '../diff.ts'
import type {
  PromptExportResult, PromptSaveResult, PromptVersionRecord, WriteApprovalView,
} from '../types.ts'
import { ENDPOINTS, type RpcEnvelope } from './rpc.ts'
import { formatTime, formatTokens, utf8Bytes } from './format.ts'
import {
  type AskUserQuestionItem, type PendingApproval, type StudioState, writeOutcomeFrom,
  type WriteEcho, type WriteOutcomeView,
} from './studio-state.ts'

/** 工坊组件 props(hooks.studio 绑成 useStudio;其余为普通注入值)。 */
export interface StudioPageProps {
  /** hooks 份额绑定的选择器钩子(SnapshotSelectorHook 形态)。 */
  readonly useStudio: <S>(selector: (state: StudioState) => S) => S
  /** 重新拉取工坊三数据(snapshot/prompt-get/versions)。 */
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

/** 只读组合区(当前生效 persona 全文)。 */
function ComposedView({ state, t }: { readonly state: StudioState, readonly t: (key: string) => string }): ReactElement {
  if (state.status !== 'ready') {
    return <p data-t7-placeholder>{t('state.loading')}</p>
  }
  const persona = state.snapshot.persona
  if (!persona.available) {
    return (
      <div data-t7-composed data-t7-composed-state="unavailable">
        <p data-t7-composed-note>{state.promptGet.composedNote}</p>
        <p data-t7-composed-error>{t('studio.persona.unavailable')}{persona.error === null ? '' : `:${persona.error}`}</p>
      </div>
    )
  }
  return (
    <div data-t7-composed data-t7-composed-state="ready">
      <p data-t7-composed-note>{state.promptGet.composedNote}</p>
      <pre data-t7-composed-text>{persona.text}</pre>
      <p data-t7-composed-meta>
        {t('studio.persona.meta')} <span data-t7-persona-path>{persona.patchPath ?? '—'}</span>
        {' · '}{formatTokens(persona.bytes)} {t('studio.editor.bytes')}
        {' · '}{formatTime(persona.updatedAt)}
      </p>
    </div>
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

/** 版本对比视图(行级 diff 投影;a=旧基线,b=新对照)。 */
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

/** 提示词工坊根组件。 */
export function StudioPage({ useStudio, refresh, call, t }: StudioPageProps): ReactElement {
  const state = useStudio(s => s)
  // 编辑器草稿(view-local):null=尚未初始化;baseline=草稿所据的生效文本,
  // 用户未分叉(draft===baseline)时跟随宿主刷新(React 官方"render 期调整派生状态"模式)。
  const [draft, setDraft] = useState<string | null>(null)
  const [baseline, setBaseline] = useState<string | null>(null)
  const [summary, setSummary] = useState('')
  const [pending, setPending] = useState<PendingApproval | null>(null)
  const [outcome, setOutcome] = useState<WriteOutcomeView | null>(null)
  const [busy, setBusy] = useState(false)
  // T7.3:版本对比对 / 导出回执 / 导入所选文件与其预检 meta。
  const [diffPair, setDiffPair] = useState<DiffPair | null>(null)
  const [exportNote, setExportNote] = useState<string | null>(null)
  const [importFile, setImportFile] = useState<File | null>(null)
  const [importMeta, setImportMeta] = useState<string | null>(null)

  const ready = state.status === 'ready'
  const personaText = ready ? state.snapshot.persona.text : ''
  if (ready && personaText !== baseline) {
    if (draft === null || draft === baseline) {
      setDraft(personaText)
      setBaseline(personaText)
    } else {
      // 用户已分叉:只推进基线记忆,草稿保持不动。
      setBaseline(personaText)
    }
  }
  const dirty = ready && draft !== null && draft !== personaText
  const bytes = draft === null ? 0 : utf8Bytes(draft)
  const baseVersionId = ready ? state.versions.versions[0]?.id : undefined
  const hasVersions = ready && state.versions.ready && state.versions.versions.length > 0

  /** 保存(第一段):校验/乐观锁在宿主;拒绝 issues 就地展示,批准则弹卡。 */
  const startSave = async (): Promise<void> => {
    if (draft === null || busy) return
    setBusy(true)
    setOutcome(null)
    const echo: WriteEcho = {
      content: draft,
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

  /** 回滚(两段式;产生新版本指向目标内容,parentId=被回滚版本)。 */
  const startRollback = async (version: PromptVersionRecord): Promise<void> => {
    if (busy) return
    setBusy(true)
    setOutcome(null)
    const echo: WriteEcho = {
      versionId: version.id,
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

  /** 导出(只读,不走审批):宿主产包 → 浏览器下载;versionId 缺省=最新。 */
  const exportVersion = async (version: PromptVersionRecord | null): Promise<void> => {
    if (busy || !hasVersions) return
    setBusy(true)
    setOutcome(null)
    try {
      const input = version === null ? {} : { versionId: version.id }
      const result = await call<PromptExportResult>(ENDPOINTS.promptExport, { input })
      if (!result.ok) {
        setExportNote(`${t('studio.export.failed')}: ${result.message}`)
        return
      }
      const filename = `persona-v${result.value.version.seq}-${result.value.version.id}.json`
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
      const probe = pack as { sourceVersionId?: unknown; exportedBy?: unknown; persona: string }
      setImportMeta(
        `${t('studio.import.selected')} ${importFile.name} · ${String(probe.sourceVersionId ?? '—')} · ${String(probe.exportedBy ?? '—')} · ${formatTokens(utf8Bytes(probe.persona))}B`,
      )
      const echo: WriteEcho = {
        pack,
        summary: `导入 ${importFile.name}`,
        ...(baseVersionId !== undefined && { baseVersionId }),
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

  return (
    <div data-t7-studio-root aria-label={t('studio')}>
      <div data-t7-toolbar>
        <h1 data-t7-heading>{t('studio')}</h1>
        <button type="button" data-t7-refresh onClick={refresh}>{t('refresh')}</button>
      </div>
      <p data-t7-sub>{t('studio.subtitle')}</p>

      {ready && (
        <div data-t7-stat-row>
          <Stat anchor="versions" label={t('studio.stats.versions')} value={String(state.snapshot.versions.count)} />
          <Stat anchor="sessions" label={t('studio.stats.sessions')} value={String(state.snapshot.trace.sessions)} />
          <Stat anchor="channel" label={t('studio.stats.channel')} value={state.snapshot.channel.kind} />
          <Stat anchor="pending" label={t('studio.stats.pending')} value={state.snapshot.pendingApproval === null ? '0' : '1'} />
        </div>
      )}

      {state.status === 'loading' && <p data-t7-placeholder>{t('state.loading')}</p>}
      {state.status === 'error' && <p data-t7-error>{t('state.error')}: {state.message}</p>}

      <section data-t7-section="composed" aria-label={t('studio.composed')}>
        <h2 data-t7-section-title>{t('studio.composed')}</h2>
        <ComposedView state={state} t={t} />
      </section>

      <section data-t7-section="editor" aria-label={t('studio.editor')}>
        <h2 data-t7-section-title>{t('studio.editor')}</h2>
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
          <span data-t7-editor-bytes>{formatTokens(bytes)} {t('studio.editor.bytes')}</span>
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
          <button type="button" data-t7-save-btn disabled={!ready || busy || draft === null} onClick={() => { void startSave() }}>
            {busy ? t('studio.saving') : t('studio.save')}
          </button>
        </div>
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

      {pending !== null && (
        <ApprovalSection pending={pending} busy={busy} onAnswer={approved => { void answerApproval(approved) }} t={t} />
      )}

      <section data-t7-section="versions" aria-label={t('studio.versions')}>
        <h2 data-t7-section-title>{t('studio.versions')}</h2>
        <p data-t7-section-note>{t('studio.versions.note')}</p>
        {hasVersions && (
          <div data-t7-version-list>
            {state.status === 'ready' && state.versions.versions.map((version, index) => (
              <VersionItem
                key={version.id}
                version={version}
                previous={state.versions.versions[index + 1] ?? null}
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
        {ready && state.versions.ready && state.versions.versions.length === 0 && (
          <p data-t7-placeholder>{t('state.empty')}</p>
        )}
        {ready && !state.versions.ready && (
          <p data-t7-placeholder data-t7-versions-unavailable="true">{t('state.empty')}(storage 未挂载)</p>
        )}
        {!ready && <p data-t7-placeholder>{t('state.loading')}</p>}
        {diffPair !== null && (
          <DiffView pair={diffPair} onClose={() => { setDiffPair(null) }} t={t} />
        )}
      </section>

      <section data-t7-section="transfer" aria-label={t('studio.transfer')}>
        <h2 data-t7-section-title>{t('studio.transfer')}</h2>
        <p data-t7-section-note>{t('studio.transfer.note')}</p>
        <div data-t7-export-row>
          <button
            type="button"
            data-t7-export-latest
            disabled={!hasVersions || busy}
            onClick={() => { void exportVersion(null) }}
          >
            {t('studio.export.latest')}
          </button>
          {exportNote !== null && <span data-t7-export-status>{exportNote}</span>}
        </div>
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
