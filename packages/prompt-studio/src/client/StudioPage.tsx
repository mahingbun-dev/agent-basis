/**
 * 侧栏「提示词工坊」主面板(2026-11-13 按前端交互原型改版:三栏工作台):
 *
 * - 页头 [data-t7-heading]:eyebrow + 大标题 + 导语 + 大数字统计(条目/最近会话/
 *   生效通道/在途审批)+ 页动作(刷新);
 * - 三栏工作台 [data-ps-workspace]:
 *   · 左栏 提示词库 [data-ps-library]:搜索框 [data-ps-search](id/说明/内容)+
 *     层筛选 chips [data-ps-filter-chip] + 分组条目列表 [data-ps-group-nav]
 *     (条目行卡含未保存草稿圆点 [data-ps-entry-dirty];点击切换选中条目);
 *   · 中栏 编辑器 [data-ps-editor-panel]:标题行(条目 id + 版本徽标 + 层/型别/
 *     红线胶囊)+ 三 tab [data-ps-tab](编辑 / 版本 N / 会话快照)+ tab 体 +
 *     粘底保存栏 [data-ps-editor-foot](变更摘要 + 保存…R3 审批);
 *     - 编辑 tab [data-ps-entry-detail]:作用说明 + 治理信息折叠区(描述/生效
 *       条件/风险/来源与上限;T2.2 生效锚点全家桶保留)+ 编辑器(textarea +
 *       字节/脏状态 + 红线预检查 [data-ps-redline]);运行时注入型=只读说明
 *       [data-ps-entry-runtime];值不可读=警示区,不冒充空内容;
 *     - 版本 tab [data-t7-section=versions]:导出最新版本 + 版本对比
 *       [data-t7-diff][data-ps-diff-view](基准/对比双下拉 + 交换 + 重置 +
 *       双栏行号逐行 diff;左右版本卡带 载入/对比上一版/导出/回滚 动作,
 *       版本只增不删);单版本=说明卡;
 *     - 会话快照 tab:SessionSnapshotsView 原样迁入(T2.3 锚点不变);
 *   · 右栏 AI 助手 [data-ps-ai-panel]:可用性徽标(零模型调用)+ 润色侧重点 →
 *     建议稿卡(diff 预览 → 作为提案提交,R3 同门禁)+ 审核报告卡(仅展示);
 *     无可编辑条目时 hint-box 明示;
 * - R3 审批卡(两段式第二段):视口底部固定横幅 [data-t7-approval-anchor]
 *   (access 工具审批横幅同款 idiom——任何 tab/滚动位置都可见可决);
 * - 导入(JSON 包)区 [data-t7-section=transfer] 保持工作台下方独立区。
 *
 * 原型中的「新建/删除提示词」与名称/分类/温度字段不做:注册表条目由代码固定
 * (写通道对未知条目 fail-closed),不造可建可删假象;原型的「运行记录」映射为
 * 真实存在的会话快照。快捷键(⌘K/⌘S/⌘↵)不做:宿主壳已占用全局键位,避免冲突。
 *
 * 数据经 inject 面到达(props.useStudio / props.refresh / props.call),不触 ctx。
 * 条目元数据与当前值来自 snapshot.entries[](T1.4 全景);按条目版本链经
 * prompt-versions {entryId} 惰性拉取并缓存(默认条目初始链复用共享源旧形态
 * 拉取)。DOM 全部带 data-t7- 与 data-ps- 结构化锚点,供 E2E 严断言定位;样式只经
 * 官方语义令牌(--et-* 与 --dsw-alias-*,styles.ts)。
 */
import { Fragment, useEffect, useMemo, useRef, useState, type ReactElement } from 'react'
import { diffLines, lineDiffOps } from '../diff.ts'
import type { LineDiffOp } from '../diff.ts'
import { missingRedLineRules, redLineInsertLinesOf } from '../red-lines.ts'
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
 * 基线外部模块,tests/client-bundle.test.ts 钉住)。初始选中条目 = 默认 persona。
 */
const DEFAULT_ENTRY_ID = 'preset.standard.persona'

/** 分组导航的层次序(注册表层枚举序;preset → 领域 → 运行时 → 元提示词)。 */
const LAYERS = ['preset', 'domain', 'runtime', 'meta'] as const

/** 库层筛选值(全部 + 四层)。 */
type LayerFilter = 'all' | (typeof LAYERS)[number]

/** 中栏 tab(编辑 / 版本 / 会话快照;原型「运行记录」映射为真实存在的会话快照)。 */
type EditorTab = 'edit' | 'versions' | 'snapshots'

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
 * 的 issues 就地明示)。**报告仅展示、不拦截**:done 态不触任何写通道,也不禁用
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

/**
 * 双栏对比的行模型(对齐原型 compare-grid:左右两列,同一变更行左右并置):
 * same=两列同文;mod=修改(左旧右新);del=仅左列;add=仅右列。
 */
interface CompareRow {
  readonly kind: 'same' | 'mod' | 'add' | 'del'
  readonly a: string | null
  readonly b: string | null
}

/** 带行号的展示行(行号只对非空列自增,空列显示占位)。 */
interface CompareLine extends CompareRow {
  readonly aNo: string
  readonly bNo: string
}

/**
 * lineDiffOps 逐行差异 → 双栏对齐行(同原型 diffLines 配对语义:相邻 del/add 游程
 * 逐行配对成 mod,余量单边落行)。复用同一 lineDiffOps 导出(同源不另造实现)。
 */
function alignCompareRows(ops: readonly LineDiffOp[]): CompareRow[] {
  const rows: CompareRow[] = []
  let index = 0
  while (index < ops.length) {
    const op = ops[index]
    if (op === undefined) break
    if (op.type === 'same') {
      rows.push({ kind: 'same', a: op.text, b: op.text })
      index += 1
      continue
    }
    const dels: string[] = []
    const adds: string[] = []
    while (index < ops.length && ops[index]?.type === 'del') {
      dels.push(ops[index]!.text)
      index += 1
    }
    while (index < ops.length && ops[index]?.type === 'add') {
      adds.push(ops[index]!.text)
      index += 1
    }
    const count = Math.max(dels.length, adds.length)
    for (let k = 0; k < count; k += 1) {
      const a = k < dels.length ? dels[k]! : null
      const b = k < adds.length ? adds[k]! : null
      rows.push({ kind: a !== null && b !== null ? 'mod' : a !== null ? 'del' : 'add', a, b })
    }
  }
  return rows
}

/** 顶部大数字瓦片(原型 stats:数字+标签,竖分隔线经样式)。 */
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

/** 库列表条目行(两行紧凑:名称+未保存草稿圆点 / 型别胶囊+概览;原型 prompt-item 同构)。 */
function EntryNavRow({ entry, selected, dirty, onSelect, t }: {
  readonly entry: EntrySummaryView
  readonly selected: boolean
  /** 该条目在 sessionStorage 有未提交草稿(含当前选中条目的脏草稿)。 */
  readonly dirty: boolean
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
        data-ps-entry-dirty={dirty ? 'true' : 'false'}
        aria-current={selected ? 'true' : undefined}
        title={entry.description}
        onClick={() => { onSelect(entry.id) }}
      >
        <span data-ps-entry-row-line>
          <span data-ps-entry-row-id>{entry.id}</span>
          <span data-ps-entry-dirty-dot title={t('studio.editor.dirty')} aria-hidden="true" />
        </span>
        <span data-ps-entry-row-sub>
          <span data-ps-pill data-ps-tone="neutral">{t(`studio.kind.${entry.kind}`)}</span>
          {entry.kind === 'patch-value'
            ? <span data-ps-pill data-ps-tone="business">{t('studio.entry.editable')}</span>
            : <span data-ps-pill data-ps-tone="neutral">{t('studio.entry.readonly')}</span>}
          {upgradeOverwrite && <span data-ps-pill data-ps-tone="warn">{t('studio.entry.upgradeRisk')}</span>}
          <span data-ps-entry-row-meta>
            {entry.versioned
              ? `${formatTokens(entry.versions.count)} ${t('studio.versions.countLabel')}`
              : t('studio.entry.noVersions')}
            {entry.value.bytes !== null && ` · ${formatTokens(entry.value.bytes)} ${t('studio.editor.bytes')}`}
          </span>
        </span>
      </button>
    </li>
  )
}

/** 分组导航:按层分组的条目列表(搜索/筛选命中为空的层整组隐藏)。 */
function GroupNav({ entries, selectedId, dirtyIds, onSelect, t }: {
  readonly entries: readonly EntrySummaryView[]
  readonly selectedId: string
  readonly dirtyIds: ReadonlySet<string>
  readonly onSelect: (entryId: string) => void
  readonly t: (key: string) => string
}): ReactElement {
  return (
    <nav data-ps-group-nav aria-label={t('studio.panorama')}>
      {LAYERS.map(layer => {
        const layerEntries = entries.filter(entry => entry.layer === layer)
        if (layerEntries.length === 0) return null
        return (
          <section key={layer} data-ps-layer-group={layer} aria-label={t(`studio.layer.${layer}`)}>
            <div data-ps-layer-group-head>
              <h2 data-ps-layer-group-title>{t(`studio.layer.${layer}`)}</h2>
              <span data-ps-layer-group-hint>{t(`studio.layer.${layer}.hint`)}</span>
            </div>
            <ul data-ps-entry-list>
              {layerEntries.map(entry => (
                <EntryNavRow
                  key={entry.id}
                  entry={entry}
                  selected={entry.id === selectedId}
                  dirty={dirtyIds.has(entry.id)}
                  onSelect={onSelect}
                  t={t}
                />
              ))}
            </ul>
          </section>
        )
      })}
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

/**
 * 版本卡(对比栅格两侧;载入/对比上一版/导出/回滚动作 + 可展开全文)。
 * 无任何删除入口——版本只增不删。展开态为卡片局部状态(切换对比对象即重挂)。
 */
function VersionSide({ version, isLatest, side, busy, onLoad, onQuickCompare, onExport, onRollback, t }: {
  readonly version: PromptVersionRecord
  /** 是否当前生效版本(链首):当前生效不可回滚(无意义且必被 diff 空拒收)。 */
  readonly isLatest: boolean
  readonly side: 'a' | 'b'
  readonly busy: boolean
  readonly onLoad: (content: string) => void
  readonly onQuickCompare: (version: PromptVersionRecord) => void
  readonly onExport: (version: PromptVersionRecord) => void
  readonly onRollback: (version: PromptVersionRecord) => void
  readonly t: (key: string) => string
}): ReactElement {
  const [expanded, setExpanded] = useState(false)
  return (
    <div
      className="ps-compare-side"
      data-t7-version-item={version.id}
      data-t7-version-source={version.source}
      data-ps-compare-side={side}
    >
      <div className="ps-compare-side-top" data-t7-version-head>
        <span className="ps-version-badge" data-t7-version-seq>#{version.seq}</span>
        <span className="ps-version-source-badge" data-t7-version-source-badge>{version.source}</span>
        {isLatest && <span className="ps-tag-current" data-ps-compare-current>{t('studio.compare.current')}</span>}
      </div>
      <p className="ps-compare-side-meta" data-t7-version-meta>
        {formatTime(version.createdAt)} · {version.author} · {formatTokens(version.bytes)} {t('studio.version.bytes')}
      </p>
      <p className="ps-compare-side-summary" data-t7-version-summary>{t('studio.version.summary')}: {version.summary}</p>
      <div className="ps-compare-side-actions" data-t7-version-actions>
        <button type="button" data-t7-version-toggle onClick={() => setExpanded(v => !v)}>
          {expanded ? t('studio.version.hide') : t('studio.version.show')}
        </button>
        <button type="button" data-t7-load-btn onClick={() => onLoad(version.content)}>
          {t('studio.version.load')}
        </button>
        <button type="button" data-t7-compare-btn onClick={() => onQuickCompare(version)}>
          {t('studio.version.compare')}
        </button>
        <button type="button" data-t7-export-btn disabled={busy} onClick={() => onExport(version)}>
          {t('studio.version.export')}
        </button>
        <button
          type="button"
          data-t7-rollback-btn
          disabled={busy || isLatest}
          title={isLatest ? undefined : `${t('studio.rollbackTo')} #${version.seq}(${version.id})`}
          onClick={() => onRollback(version)}
        >
          {t('studio.version.rollback')}
        </button>
      </div>
      {expanded && <pre className="ps-compare-side-content" data-t7-version-content>{version.content}</pre>}
    </div>
  )
}

/**
 * 版本对比视图(原型 compare 形态):基准/对比双下拉 + 交换/重置 + 左右版本卡 +
 * 双栏行号逐行 diff。行渲染上限与计数同旧 DiffView(内容完整参与计算,仅截渲染)。
 */
function CompareView({ pair, versions, busy, onPick, onSwap, onReset, onLoad, onQuickCompare, onExport, onRollback, t }: {
  readonly pair: DiffPair
  /** 该条目完整版本链(新→旧;下拉选项与「对比上一版」定位用)。 */
  readonly versions: readonly PromptVersionRecord[]
  readonly busy: boolean
  readonly onPick: (side: 'a' | 'b', versionId: string) => void
  readonly onSwap: () => void
  readonly onReset: () => void
  readonly onLoad: (content: string) => void
  readonly onQuickCompare: (version: PromptVersionRecord) => void
  readonly onExport: (version: PromptVersionRecord) => void
  readonly onRollback: (version: PromptVersionRecord) => void
  readonly t: (key: string) => string
}): ReactElement {
  const ops: readonly LineDiffOp[] = lineDiffOps(pair.a.content, pair.b.content)
  const added = ops.filter(op => op.type === 'add').length
  const removed = ops.filter(op => op.type === 'del').length
  const rows = alignCompareRows(ops)
  let leftNo = 0
  let rightNo = 0
  const lines: CompareLine[] = rows.map(row => ({
    ...row,
    aNo: row.a !== null ? String(++leftNo) : '',
    bNo: row.b !== null ? String(++rightNo) : '',
  }))
  const visible = lines.slice(0, DIFF_RENDER_CAP)
  const unchanged = added === 0 && removed === 0
  const latestId = versions[0]?.id ?? null
  const optionLabel = (version: PromptVersionRecord): string => `#${version.seq} · ${version.source} · ${version.summary}`
  return (
    <div
      data-t7-diff
      data-ps-diff-view
      data-t7-diff-a={pair.a.id}
      data-t7-diff-b={pair.b.id}
      data-t7-diff-empty={unchanged ? 'true' : 'false'}
      className="ps-compare"
    >
      <div className="ps-compare-bar">
        <label className="ps-compare-pick">
          <span>{t('studio.compare.base')}</span>
          <select
            data-ps-compare-pick="a"
            aria-label={t('studio.compare.base')}
            value={pair.a.id}
            onChange={event => { onPick('a', event.target.value) }}
          >
            {versions.map(version => (
              <option key={version.id} value={version.id}>{optionLabel(version)}</option>
            ))}
          </select>
        </label>
        <button
          type="button"
          className="ps-compare-swap"
          data-ps-compare-swap
          aria-label={t('studio.compare.swap')}
          title={t('studio.compare.swap')}
          onClick={onSwap}
        >⇄</button>
        <label className="ps-compare-pick">
          <span>{t('studio.compare.target')}</span>
          <select
            data-ps-compare-pick="b"
            aria-label={t('studio.compare.target')}
            value={pair.b.id}
            onChange={event => { onPick('b', event.target.value) }}
          >
            {versions.map(version => (
              <option key={version.id} value={version.id}>{optionLabel(version)}</option>
            ))}
          </select>
        </label>
        <button type="button" className="ps-compare-reset" data-t7-diff-close onClick={onReset}>
          {t('studio.compare.reset')}
        </button>
        <span className="ps-compare-stat" data-t7-diff-stats>
          {unchanged
            ? t('studio.diff.identical')
            : <><b>{added + removed}</b> {t('studio.compare.statChanged')} · +{added} {t('studio.diff.added')} · −{removed} {t('studio.diff.removed')}</>}
        </span>
      </div>
      <div className="ps-compare-grid" data-t7-diff-body>
        <VersionSide version={pair.a} isLatest={pair.a.id === latestId} side="a" busy={busy}
          onLoad={onLoad} onQuickCompare={onQuickCompare} onExport={onExport} onRollback={onRollback} t={t} />
        <VersionSide version={pair.b} isLatest={pair.b.id === latestId} side="b" busy={busy}
          onLoad={onLoad} onQuickCompare={onQuickCompare} onExport={onExport} onRollback={onRollback} t={t} />
        <div className="ps-compare-section" data-t7-diff-head>
          <span>{t('studio.diff')}</span>
          <span className="ps-compare-section-meta">{unchanged ? t('studio.diff.identical') : `+${added} −${removed}`}</span>
        </div>
        {visible.map((line, index) => (
          <Fragment key={index}>
            <div
              className="ps-compare-line"
              data-ps-compare-kind={line.kind}
              data-ps-compare-column="a"
            >
              <span className="ps-compare-ln">{line.aNo}</span>
              <span className="ps-compare-lc">{line.a ?? ''}</span>
            </div>
            <div
              className="ps-compare-line"
              data-ps-compare-kind={line.kind}
              data-ps-compare-column="b"
            >
              <span className="ps-compare-ln">{line.bNo}</span>
              <span className="ps-compare-lc">{line.b ?? ''}</span>
            </div>
          </Fragment>
        ))}
        {lines.length > visible.length && (
          <p className="ps-compare-truncated" data-t7-diff-truncated>{t('studio.diff.truncated')}</p>
        )}
      </div>
      <p className="ps-compare-note" data-t7-diff-note>{t('studio.diff.note')}</p>
    </div>
  )
}

/**
 * AI 草稿 diff 预览(T3.2:base↔draft 行级对比;单栏 +/− 行,行数封顶防大稿刷屏)。
 * data-ps-ai-diff 是 bundle 契约锚点(client-bundle.test.ts T3.2 断言在场);卡片
 * 样式复用 styles.ts 既有 [data-ps-ai-diff] 块,行内不引入新样式面。
 */
function AiDraftDiff({ base, draft, t }: {
  readonly base: string
  readonly draft: string
  readonly t: (key: string) => string
}): ReactElement {
  const ops: readonly LineDiffOp[] = lineDiffOps(base, draft)
  const added = ops.filter(op => op.type === 'add').length
  const removed = ops.filter(op => op.type === 'del').length
  const unchanged = added === 0 && removed === 0
  return (
    <details data-ps-ai-diff>
      <summary>{unchanged ? t('studio.diff.identical') : `+${added} −${removed}`}</summary>
      {ops.slice(0, DIFF_RENDER_CAP).map((op, index) => (
        <div key={index} data-ps-ai-diff-line={op.type}>
          {op.type === 'add' ? '+' : op.type === 'del' ? '−' : ' '} {op.text}
        </div>
      ))}
      {ops.length > DIFF_RENDER_CAP && (
        <div>{t('studio.diff.truncated')}</div>
      )}
    </details>
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
 * 降级标注明示,不造可回放假象。
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

  /** 返回列表(清所选会话与详情;快照只读,无任何服务端状态)。 */
  const closeSnapshot = (): void => {
    setDetail(null)
    setDetailIssues(null)
    setSelectedSession(null)
  }

  // 主从视图:未选中=列表;选中(含查不到的错误态)=详情顶格+返回按钮,列表隐藏——
  // 此前详情渲染在 20 行列表之后(视口外 ~1830px),点了看不到任何变化(2026-11-13
  // 用户反馈「选择会话不能查看快照」;数据链路本就正常,纯摆放问题)。
  const viewing = detail !== null || detailIssues !== null
  return (
    <section data-t7-section="snapshots" data-ps-session-snapshot aria-label={t('studio.snapshots')}>
      <p data-t7-section-note>{t('studio.snapshots.note')}</p>
      {viewing && (
        <button type="button" data-ps-snapshot-back onClick={closeSnapshot}>{t('back')}</button>
      )}
      {viewing ? (
        <>
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
        </>
      ) : (
        <>
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
        </>
      )}
    </section>
  )
}

/**
 * 红线锚点预检查(2026-11-12 修复「persona 编辑保存必被拒且无预提示」):required
 * 条目编辑时对草稿实时跑与服务端校验同一套锚点正则(规则本体 red-lines.ts 单一
 * 事实源),缺哪条就地亮出;「插入缺失红线段」把缺失项的规范措辞整行追加到草稿尾。
 * 服务端 fail-closed 校验不变——本区只是把「保存必被拒」提前到敲字时可见。
 */
function RedLineCheck({ ruleSet, text, onInsert, t }: {
  readonly ruleSet: string | undefined
  readonly text: string
  readonly onInsert: () => void
  readonly t: (key: string) => string
}) {
  const missing = useMemo(() => missingRedLineRules(ruleSet, text), [ruleSet, text])
  return (
    <div
      data-ps-redline
      data-ps-redline-state={missing.length === 0 ? 'ok' : 'missing'}
      aria-live="polite"
    >
      {missing.length === 0 ? (
        <span data-ps-pill data-ps-tone="business" data-ps-redline-ok>{t('studio.redline.ok')}</span>
      ) : (
        <>
          <span data-ps-redline-title>{t('studio.redline.missing')}</span>
          <ul data-ps-redline-list>
            {missing.map(rule => (
              <li key={rule.id} data-ps-redline-missing-item>{rule.label}</li>
            ))}
          </ul>
          <button type="button" data-ps-redline-insert onClick={onInsert}>
            {t('studio.redline.insert')}
          </button>
        </>
      )}
    </div>
  )
}

/**
 * AI 润色区(T3.2,右栏):润色侧重点 + 生成按钮 → 建议稿卡(生成信息 + 建议稿
 * 全文(折叠)+ diff 预览 + 「作为提案提交」/「放弃建议稿」)。建议稿仅预览
 * (永不直接生效);「作为提案提交」经 loopPrompt/ai-proposal 进与手工保存完全
 * 相同的 R3 两段式。运行时注入型条目不渲染本区(无写回落点,提案必然
 * fail-closed,不造可提交假象)。
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
      <p data-t7-section-note>{t('studio.ai.note')}</p>
      {status.status === 'loaded' && !available && (
        <p data-ps-ai-unavailable-note data-ps-ai-unavailable="true">
          {t('studio.ai.unavailable.note')}{status.result.reason === undefined ? '' : `(${status.result.reason})`}
        </p>
      )}
      <div data-ps-ai-input-row className="ps-ai-input-row">
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
      <p data-t7-section-note>{t('studio.ai.review.note')}</p>
      <div data-ps-ai-review-input-row className="ps-ai-input-row">
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

/** 提示词工坊根组件(三栏工作台:提示词库 / 编辑器 / AI 助手)。 */
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

  // —— 原型改版新增:库搜索/层筛选/中栏 tab/版本对比选择 ——
  const [query, setQuery] = useState('')
  const [layerFilter, setLayerFilter] = useState<LayerFilter>('all')
  const [tab, setTab] = useState<EditorTab>('edit')
  /** 版本对比选择(版本 id 对;null=默认对:链首 vs 链次;切条目重置)。 */
  const [compareIds, setCompareIds] = useState<{ aId: string; bId: string } | null>(null)

  // 编辑器草稿(view-local,按条目归属):draftEntry 记草稿归属条目,切条目即重置
  // (防上一条目的脏草稿串进下一条目);baseline=草稿所据的生效文本,用户未分叉
  // (draft===baseline)时跟随宿主刷新(React 官方「render 期调整派生状态」模式)。
  const [draft, setDraft] = useState<string | null>(null)
  const [baseline, setBaseline] = useState<string | null>(null)
  const [draftEntry, setDraftEntry] = useState<string | null>(null)
  const draftKeyOf = (entryId: string): string => `eterna.prompt-studio.draft.${entryId}`
  const readDraft = (entryId: string): string | null => {
    try { return sessionStorage.getItem(draftKeyOf(entryId)) } catch { return null }
  }
  const persistDraft = (entryId: string, value: string, pristine: string): void => {
    try {
      if (value === pristine) sessionStorage.removeItem(draftKeyOf(entryId))
      else sessionStorage.setItem(draftKeyOf(entryId), value)
    } catch { /* 隐私模式/配额不足时退化为仅内存草稿 */ }
  }
  const [summary, setSummary] = useState('')
  const [pending, setPending] = useState<PendingApproval | null>(null)
  const [outcome, setOutcome] = useState<WriteOutcomeView | null>(null)
  const [busy, setBusy] = useState(false)
  // 导出回执 / 导入所选文件与其预检 meta。
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

  /**
   * 条目编辑面板引用(2026-11-13「只能查看,打不开编辑」修复):窄视口(单列/
   * 双列)下点击库条目时把编辑器面板滚入视口;三栏宽布局下编辑器本就在视口内,
   * 滚动是无害的 no-op。prefers-reduced-motion 时退化为瞬时跳转。
   */
  const editorPanelRef = useRef<HTMLElement | null>(null)
  /** R3 审批卡锚点(固定横幅,滚动无需;保留 ref 以兼容旧调用面)。 */
  const approvalRef = useRef<HTMLDivElement | null>(null)

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
      setDraft(readDraft(selected.id) ?? selectedText)
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

  // 库列表:搜索(id/说明/内容)+ 层筛选;未保存草稿圆点(选中条目看内存草稿,
  // 其余条目看 sessionStorage 持久草稿——跨刷新仍亮,如实反映未提交状态)。
  const queryLower = query.trim().toLowerCase()
  const visibleEntries = useMemo(() => entries.filter(entry => {
    if (layerFilter !== 'all' && entry.layer !== layerFilter) return false
    if (queryLower === '') return true
    const haystack = [entry.id, entry.description, entry.note, entry.value.text ?? ''].join(' ').toLowerCase()
    return haystack.includes(queryLower)
  }), [entries, layerFilter, queryLower])
  const dirtyIds = useMemo(() => {
    const set = new Set<string>()
    for (const entry of entries) {
      if (entry.kind !== 'patch-value') continue
      if (entry.id === selectedId) {
        if (draft !== null && draft !== selectedText) set.add(entry.id)
        continue
      }
      if (readDraft(entry.id) !== null) set.add(entry.id)
    }
    return set
  }, [entries, selectedId, draft, selectedText])

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
      // ai-status 宿主签名无参(2026-11-12 修复:多传 {input:{}} 被 typert 网关按
      // arguments-invalid 拒收,AI 可用性胶囊永远停在「检查中」)——无参端点传 {}。
      const result = await call<AiStatusResult>(ENDPOINTS.aiStatus, {})
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
      if (result.value.status === 'committed') {
        try { sessionStorage.removeItem(draftKeyOf(selected.id)) } catch { /* 忽略 */ }
        refresh()
      }
    } finally {
      setBusy(false)
    }
  }

  /** 重置草稿(原型「重置」;真实语义=丢弃未提交草稿,回到当前生效文本)。 */
  const resetDraft = (): void => {
    if (!ready || selected === undefined || selected.kind !== 'patch-value' || valueUnreadable) return
    setDraft(selectedText)
    setBaseline(selectedText)
    try { sessionStorage.removeItem(draftKeyOf(selected.id)) } catch { /* 忽略 */ }
    setSummary('')
    setResetArmed(false)
  }

  /**
   * 重置两击确认(AGENTS.md 交互纪律:破坏性操作两击确认,禁用原生 confirm):
   * 第一击武装(按钮文案切换,3s 不击自动解除),第二击才真丢弃草稿。
   */
  const [resetArmed, setResetArmed] = useState(false)
  const handleResetClick = (): void => {
    if (!resetArmed) {
      setResetArmed(true)
      window.setTimeout(() => { setResetArmed(false) }, 3000)
      return
    }
    resetDraft()
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
          if (pending.echo.entryId !== undefined) {
            try { sessionStorage.removeItem(draftKeyOf(pending.echo.entryId)) } catch { /* 忽略 */ }
          }
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

  /**
   * 编辑器面板滚入视口:仅当它可见高度不足(≈被视口裁得只剩边角)时才滚,且用
   * block:'nearest' 最小滚动。阈值 200px:宽三栏布局编辑器本就整栏在视口内(哪怕
   * 高出视口、底边被裁)→零滚动——任何非零滚动都是用户没要的页面跳动(2026-11-13
   * 用户反馈「点条目页面往上滚」;nearest 的底边对齐仍会造成 ~百 px 漂移,已实测
   * 修掉);窄单列布局点库条目时编辑器几乎不可见 → 仍能可见地滚到它。
   */
  const scrollDetailIntoView = (): void => {
    const panel = editorPanelRef.current
    if (panel === null) return
    const rect = panel.getBoundingClientRect()
    const visibleHeight = Math.min(rect.bottom, window.innerHeight) - Math.max(rect.top, 0)
    if (visibleHeight >= 200) return
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    panel.scrollIntoView({ behavior: reduced ? 'auto' : 'smooth', block: 'nearest' })
  }

  /**
   * 切换选中条目(编辑上下文整体重置:对比/变更摘要/写入结果/AI 建议稿/AI 审核
   * 报告/tab 回编辑;草稿由 render 期派生逻辑按新条目重置)。摘要会进保存载荷、
   * 结果无条件目标识,均不得从上一条目串入下一条目;建议稿与审核报告同理。
   */
  const selectEntry = (entryId: string): void => {
    selectedIdRef.current = entryId
    setSelectedId(entryId)
    setCompareIds(null)
    setExportNote(null)
    setSummary('')
    setOutcome(null)
    setAiPolish({ status: 'idle' })
    setAiInstruction('')
    setAiReview({ status: 'idle' })
    setResetArmed(false)
    setTab('edit')
    window.requestAnimationFrame(scrollDetailIntoView)
  }

  /** 对比选择:单侧切换(null=默认对兜底)。 */
  const handleComparePick = (side: 'a' | 'b', versionId: string): void => {
    setCompareIds(previous => {
      const fallback = hasChain && chain !== undefined && chain.versions.length >= 2
        ? { aId: chain.versions[1]!.id, bId: chain.versions[0]!.id }
        : null
      const base = previous ?? fallback
      if (base === null) return null
      return { aId: side === 'a' ? versionId : base.aId, bId: side === 'b' ? versionId : base.bId }
    })
  }

  // 版本对比对解析(versions 新→旧):null 选择=链次 vs 链首;缺失 id 同样回默认。
  const versions: readonly PromptVersionRecord[] = hasChain && chain !== undefined ? chain.versions : []
  const pair: DiffPair | null = (() => {
    if (versions.length < 2) return null
    const a = compareIds === null ? undefined : versions.find(version => version.id === compareIds.aId)
    const b = compareIds === null ? undefined : versions.find(version => version.id === compareIds.bId)
    return {
      a: a ?? versions[1]!,
      b: b ?? versions[0]!,
    }
  })()

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

  /** 右栏 AI 面板可用面(选中条目为可编辑 patch 值型且当前值可读)。 */
  const aiPanelUsable = ready && selected !== undefined && selected.kind === 'patch-value' && !valueUnreadable
  const aiAvailable = aiStatus.status === 'loaded' && aiStatus.result.available

  return (
    <div data-t7-studio-root aria-label={t('studio')}>
      {/* —— R3 审批卡:root 滚动容器顶部 sticky 常驻(首个子元素=天然可见位;任何
          tab/滚动位置可决;fixed 会被宿主壳 transform 祖先劫持,见 styles 注) —— */}
      {pending !== null && (
        <div ref={approvalRef} data-t7-approval-anchor className="ps-approval-layer">
          <ApprovalSection pending={pending} busy={busy} onAnswer={approved => { void answerApproval(approved) }} t={t} />
        </div>
      )}

      {/* —— 页头:eyebrow + 标题 + 导语 + 统计 + 页动作 —— */}
      <header className="ps-page-head">
        <div className="ps-page-head-text">
          <p className="ps-eyebrow">{t('studio.eyebrow')}</p>
          <h1 data-t7-heading>{t('studio')}</h1>
          <p data-t7-sub>{t('studio.subtitle')}</p>
          <div data-t7-stat-row>
            {ready && (
              <>
                <Stat anchor="entries" label={t('studio.stats.entries')} value={String(entries.length)} />
                <Stat anchor="sessions" label={t('studio.stats.sessions')} value={String(state.snapshot.trace.sessions)} />
                <Stat anchor="channel" label={t('studio.stats.channel')} value={state.snapshot.channel.kind} />
                <Stat anchor="pending" label={t('studio.stats.pending')} value={state.snapshot.pendingApproval === null ? '0' : '1'} />
              </>
            )}
          </div>
        </div>
        <div className="ps-page-actions">
          <button type="button" data-t7-refresh onClick={refresh}>{t('refresh')}</button>
        </div>
      </header>

      {state.status === 'loading' && <p data-t7-placeholder>{t('state.loading')}</p>}
      {state.status === 'error' && <p data-t7-error>{t('state.error')}: {state.message}</p>}

      {ready && (
        <div className="ps-workspace" data-ps-workspace>
          {/* —— 左栏:提示词库(搜索 + 层筛选 + 分组列表) —— */}
          <aside className="ps-panel ps-list-panel" data-ps-list-panel aria-label={t('studio.library')}>
            <div className="ps-panel-head">
              <div className="ps-head-row">
                <h2 className="ps-panel-title">{t('studio.library')}</h2>
                <span className="ps-count-pill" data-ps-library-count>{visibleEntries.length}</span>
              </div>
              <div className="ps-search-field">
                <input
                  data-ps-search
                  type="search"
                  value={query}
                  placeholder={t('studio.search.placeholder')}
                  aria-label={t('studio.search')}
                  onChange={event => { setQuery(event.target.value) }}
                />
              </div>
              <div className="ps-chips" role="group" aria-label={t('studio.panorama')}>
                <button
                  type="button"
                  className="ps-chip"
                  data-ps-filter-chip="all"
                  aria-pressed={layerFilter === 'all' ? 'true' : 'false'}
                  onClick={() => { setLayerFilter('all') }}
                >{t('studio.filter.all')}</button>
                {LAYERS.map(layer => (
                  <button
                    key={layer}
                    type="button"
                    className="ps-chip"
                    data-ps-filter-chip={layer}
                    aria-pressed={layerFilter === layer ? 'true' : 'false'}
                    onClick={() => { setLayerFilter(layer) }}
                  >{t(`studio.layer.${layer}`)}</button>
                ))}
              </div>
            </div>
            <div className="ps-library-list">
              <GroupNav
                entries={visibleEntries}
                selectedId={selectedId}
                dirtyIds={dirtyIds}
                onSelect={selectEntry}
                t={t}
              />
              {visibleEntries.length === 0 && <p className="ps-empty-inline">{t('state.empty')}</p>}
            </div>
          </aside>

          {/* —— 中栏:编辑器(标题行 + 三 tab + tab 体 + 粘底保存栏) —— */}
          <section className="ps-panel ps-editor-panel" ref={editorPanelRef} data-ps-editor-panel aria-label={t('studio.entry.detail')}>
            <div className="ps-panel-head ps-editor-head">
              <div className="ps-editor-title-row">
                <h2 className="ps-editor-title" data-ps-entry-title>{selected !== undefined ? selected.id : t('studio.entry.detail')}</h2>
                {hasChain && chain !== undefined && chain.versions.length > 0 && (
                  <span className="ps-badge" data-ps-version-badge>#{chain.versions[0]!.seq}</span>
                )}
                {selected !== undefined && (
                  <span data-ps-entry-badges className="ps-editor-pills">
                    <span data-ps-pill data-ps-tone="neutral">{t(`studio.layer.${selected.layer}`)}</span>
                    <span data-ps-pill data-ps-tone="neutral">{t(`studio.kind.${selected.kind}`)}</span>
                    {selected.redLine === 'required'
                      ? <span data-ps-pill data-ps-tone="warn">{t('studio.entry.redline.required')}</span>
                      : <span data-ps-pill data-ps-tone="neutral">{t('studio.entry.redline.exempt')}</span>}
                  </span>
                )}
              </div>
              <div className="ps-tabs" role="tablist" aria-label={t('studio.entry.detail')}>
                <button type="button" className="ps-tab" data-ps-tab="edit" role="tab"
                  aria-selected={tab === 'edit' ? 'true' : 'false'}
                  onClick={() => { setTab('edit') }}>{t('studio.tab.edit')}</button>
                <button type="button" className="ps-tab" data-ps-tab="versions" role="tab"
                  aria-selected={tab === 'versions' ? 'true' : 'false'}
                  onClick={() => { setTab('versions') }}>
                  {t('studio.tab.versions')}
                  <span className="ps-tab-count">{selected?.versions.ready ? selected.versions.count : '—'}</span>
                </button>
                <button type="button" className="ps-tab" data-ps-tab="snapshots" role="tab"
                  aria-selected={tab === 'snapshots' ? 'true' : 'false'}
                  onClick={() => { setTab('snapshots') }}>{t('studio.tab.snapshots')}</button>
              </div>
            </div>

            <div className="ps-editor-body">
              {!ready && <p data-t7-placeholder>{t('state.loading')}</p>}

              {ready && selected !== undefined && tab === 'edit' && (
                <section data-ps-entry-detail data-t7-section="detail" aria-label={t('studio.entry.detail')}>
                  <p data-ps-entry-note>{selected.note}</p>
                  <details className="ps-governance" data-ps-entry-governance>
                    <summary>{t('studio.entry.governance')}</summary>
                    <div data-ps-entry-description>
                      <span data-ps-entry-description-title>{t('studio.entry.description')}</span>
                      <p data-ps-entry-description-text>{selected.description}</p>
                    </div>
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
                  </details>

                  {selected.kind === 'runtime-injection' && (
                    <div data-ps-entry-runtime data-t7-section="runtime" aria-label={t('studio.entry.runtime.title')}>
                      <h3 data-t7-section-title>{t('studio.entry.runtime.title')}</h3>
                      <p data-ps-entry-runtime-note>{t('studio.entry.runtime.note')}</p>
                      <p data-ps-entry-value-note>{t('studio.entry.runtime.value')}</p>
                    </div>
                  )}

                  {valueUnreadable && (
                    <div data-ps-entry-value-error data-t7-section="unreadable" aria-label={t('studio.entry.valueUnreadable.title')}>
                      <h3 data-t7-section-title>{t('studio.entry.valueUnreadable.title')}</h3>
                      <p data-ps-entry-value-error-note>{t('studio.entry.valueUnreadable.note')}</p>
                      {(selected.value.problems.length > 0 ? selected.value.problems : [t('studio.entry.valueUnreadable.fallback')])
                        .map((problem, index) => <p key={index} data-ps-entry-problem-item>{problem}</p>)}
                    </div>
                  )}

                  {selected.kind === 'patch-value' && !valueUnreadable && (
                    <section data-t7-section="editor" aria-label={t('studio.editor')}>
                      <h3 data-t7-section-title>{t('studio.editor')}</h3>
                      <p data-t7-section-note>{t('studio.editor.note')}</p>
                      <textarea
                        data-t7-editor
                        value={draft ?? ''}
                        disabled={!ready}
                        onChange={event => {
                          const value = event.target.value
                          setDraft(value)
                          persistDraft(selected.id, value, selectedText)
                        }}
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
                      {selected.redLine === 'required' && (
                        <RedLineCheck
                          ruleSet={selected.redLineRuleSet}
                          text={draft ?? ''}
                          t={t}
                          onInsert={() => {
                            const missing = missingRedLineRules(selected.redLineRuleSet, draft ?? '')
                            const lines = redLineInsertLinesOf(missing)
                            if (lines.length === 0) return
                            const base = draft ?? ''
                            const joined = lines.join('\n') + '\n'
                            const next = base.length > 0 && !base.endsWith('\n') ? base + '\n' + joined : base + joined
                            setDraft(next)
                            persistDraft(selected.id, next, selectedText)
                          }}
                        />
                      )}
                    </section>
                  )}
                </section>
              )}

              {ready && selected !== undefined && tab === 'versions' && (
                <section data-t7-section="versions" aria-label={t('studio.versions')}>
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
                  {/* 导入与导出同区(2026-11-13 用户反馈:导入按条目落库,不该孤悬页尾) */}
                  <section data-t7-section="transfer" data-ps-transfer-inline aria-label={t('studio.transfer')}>
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
                  {hasChain && chain !== undefined && pair !== null && (
                    <CompareView
                      pair={pair}
                      versions={versions}
                      busy={busy}
                      onPick={handleComparePick}
                      onSwap={() => { setCompareIds({ aId: pair.b.id, bId: pair.a.id }) }}
                      onReset={() => { setCompareIds(null) }}
                      onLoad={content => {
                        setDraft(content)
                        if (selected !== undefined) persistDraft(selected.id, content, selectedText)
                      }}
                      onQuickCompare={version => {
                        const index = versions.findIndex(candidate => candidate.id === version.id)
                        const older = index >= 0 ? versions[index + 1] : undefined
                        if (older !== undefined) setCompareIds({ aId: older.id, bId: version.id })
                      }}
                      onExport={target => { void exportVersion(target) }}
                      onRollback={target => { void startRollback(target) }}
                      t={t}
                    />
                  )}
                  {hasChain && chain !== undefined && chain.versions.length === 1 && chain.versions[0] !== undefined && (
                    <div className="ps-compare-single" data-t7-version-item={chain.versions[0].id} data-t7-version-source={chain.versions[0].source}>
                      <div className="ps-compare-side-top" data-t7-version-head>
                        <span className="ps-version-badge" data-t7-version-seq>#{chain.versions[0].seq}</span>
                        <span className="ps-version-source-badge" data-t7-version-source-badge>{chain.versions[0].source}</span>
                        <span className="ps-tag-current" data-ps-compare-current>{t('studio.compare.current')}</span>
                      </div>
                      <p className="ps-compare-side-meta" data-t7-version-meta>
                        {formatTime(chain.versions[0].createdAt)} · {chain.versions[0].author} · {formatTokens(chain.versions[0].bytes)} {t('studio.version.bytes')}
                      </p>
                      <p className="ps-compare-side-summary" data-t7-version-summary>{t('studio.version.summary')}: {chain.versions[0].summary}</p>
                      <p className="ps-empty-inline">{t('studio.versions.single')}</p>
                      <div className="ps-compare-side-actions" data-t7-version-actions>
                        <button type="button" data-t7-load-btn onClick={() => {
                          setDraft(chain.versions[0]!.content)
                          if (selected !== undefined) persistDraft(selected.id, chain.versions[0]!.content, selectedText)
                        }}>{t('studio.version.load')}</button>
                        <button type="button" data-t7-export-btn disabled={busy} onClick={() => { void exportVersion(chain.versions[0]!) }}>{t('studio.version.export')}</button>
                      </div>
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
                </section>
              )}

              {ready && selected !== undefined && tab === 'snapshots' && (
                <SessionSnapshotsView call={call} t={t} ready={ready} generatedAt={generatedAt} />
              )}

              {/* 写结果(就地展示;所有写动作共用,跨 tab 可见) */}
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
            </div>

            {ready && selected !== undefined && selected.kind === 'patch-value' && !valueUnreadable && tab === 'edit' && (
              <footer className="ps-editor-foot" data-ps-editor-foot>
                <span className="ps-foot-dirty" data-ps-foot-dirty={dirty ? 'true' : 'false'} hidden={!dirty}>
                  {t('studio.editor.dirty')}
                </span>
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
                    data-ps-editor-reset
                    data-ps-reset-armed={resetArmed ? 'true' : 'false'}
                    disabled={!dirty || busy}
                    onClick={handleResetClick}
                  >
                    {resetArmed ? t('studio.editor.resetConfirm') : t('studio.editor.reset')}
                  </button>
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
              </footer>
            )}
          </section>

          {/* —— 右栏:AI 助手(可用性 + 润色/审核) —— */}
          <aside className="ps-panel ps-ai-panel" data-ps-ai-panel aria-label={t('studio.ai.assistant')}>
            <div className="ps-panel-head">
              <div className="ps-head-row">
                <h2 className="ps-panel-title">{t('studio.ai.assistant')}</h2>
                <span data-ps-ai-status>
                  <span data-ps-ai-status-label className="ps-visually-hidden">{t('studio.ai.status')}</span>
                  {aiStatus.status === 'loading' && <span data-ps-ai-status-value data-ps-ai-status-state="checking">{t('studio.ai.status.checking')}</span>}
                  {aiStatus.status === 'error' && (
                    <span data-ps-ai-status-value data-ps-ai-status-state="error" title={aiStatus.message}>{t('studio.ai.status.checking')}</span>
                  )}
                  {aiStatus.status === 'loaded' && (aiAvailable
                    ? <span data-ps-pill data-ps-tone="business" data-ps-ai-status-value data-ps-ai-available="true">{t('studio.ai.status.available')}</span>
                    : <span data-ps-pill data-ps-tone="warn" data-ps-ai-status-value data-ps-ai-unavailable="true">{t('studio.ai.status.unavailable')}</span>)}
                </span>
              </div>
            </div>
            <div className="ps-panel-body">
              {aiPanelUsable ? (
                <>
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
                </>
              ) : (
                <div className="ps-hint-box" data-ps-ai-hint>
                  <p>{t('studio.ai.hint.noSelection')}</p>
                </div>
              )}
            </div>
          </aside>
        </div>
      )}

      {/* R3 审批卡说明见根首;导入区已并入版本 tab(与导出同区) */}
    </div>
  )
}
