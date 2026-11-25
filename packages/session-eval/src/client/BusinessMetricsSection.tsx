/**
 * 设置分区「业务指标」:当前账号私有指标编辑器(56 号 §9)。
 *
 * 形态纪律:
 * - 仍是 `settings.section` 分区内的一个 fieldset(铁律 1:不自建页面/弹窗);
 * - 业务指标按**账号**存储(`workspaces/<账号>/.eterna/eval/metrics.yaml`),
 *   普通用户可自助编辑;裁判配置仍是管理员只读边界,两者互不影响;
 * - 四种判定形态:rubric(模型裁判)与 approval / answer / budget(确定性规则,
 *   与 dsh-evals 金集同一套断言语义,零模型成本);
 * - 校验器与序列化器是服务端同一份纯模块(business-metrics.ts),前端只做
 *   提前报错与 YAML 预览,服务端二次校验为准;
 * - 保存带文件版本(乐观锁):409 = 文件被改过,自动重读后让用户确认再存;
 * - 停用写 `enabled: false`(不删行,历史评分仍可追溯定义版本);
 * - YAML 导入:服务端解析(`metrics/parse`,不落盘) → 选条目载入编辑器 →
 *   用户确认保存;解析错误带行号,绝不直接改写文件。
 */
import { useCallback, useMemo, useState } from 'react'
import type { ReactElement } from 'react'
import { Icon } from '@eterna/ui/icons'
import {
  EMPTY_BUSINESS_FILE, businessFormOf, metricInputOf, serializeBusinessMetrics, validateBusinessMetric,
  type BusinessMetric,
} from '../business-metrics.ts'
import type { BusinessMetricsView } from '../judge-types.ts'
import {
  SessionEvalApiError, parseMetricsYaml, saveBusinessMetric, type BusinessParsedReply,
} from './api.ts'

/** 判定形态(与业务指标文件的四选一一致). */
type DraftMode = 'judge' | 'approval' | 'answer' | 'budget'

/** 单条细则的表单态(数字以字符串承载). */
interface CriterionDraft {
  readonly text: string
  readonly weight: string
  readonly critical: boolean
}

/** 业务指标编辑器态(四种形态共用基本信息;各形态字段按 mode 条件渲染). */
interface Draft {
  readonly key: string
  readonly name: string
  readonly description: string
  readonly category: 'outcome' | 'process'
  readonly scope: 'session' | 'turn'
  readonly gating: boolean
  readonly enabled: boolean
  readonly mode: DraftMode
  readonly minScore: string
  readonly maxSteps: string
  readonly allowSkip: boolean
  readonly criteria: readonly CriterionDraft[]
  readonly tool: string
  readonly minCount: string
  readonly notContains: string
  readonly maxTurns: string
  readonly maxTokens: string
}

const EMPTY_CRITERION: CriterionDraft = { text: '', weight: '1', critical: false }

const NEW_DRAFT: Draft = {
  key: '',
  name: '',
  description: '',
  category: 'outcome',
  scope: 'session',
  gating: false,
  enabled: true,
  mode: 'judge',
  minScore: '0.8',
  maxSteps: '12',
  allowSkip: true,
  criteria: [EMPTY_CRITERION],
  tool: '',
  minCount: '1',
  notContains: '',
  maxTurns: '30',
  maxTokens: '200000',
}

/** 已保存条目 → 表单(四种形态都支持;形态缺失按 rubric 兜底并交给校验器报错). */
function draftOf(metric: BusinessMetric): Draft {
  const judge = metric.judge
  const form = businessFormOf(metric)
  return {
    key: metric.key,
    name: metric.name,
    description: metric.description,
    category: metric.category,
    scope: metric.scope,
    gating: metric.gating,
    enabled: metric.enabled,
    mode: form === 'unknown' ? 'judge' : form,
    minScore: String(judge?.minScore ?? 0.8),
    maxSteps: String(judge?.window.maxSteps ?? 12),
    allowSkip: judge?.allowSkip ?? true,
    criteria: judge === undefined
      ? [EMPTY_CRITERION]
      : judge.criteria.map(criterion => ({ text: criterion.text, weight: String(criterion.weight), critical: criterion.critical })),
    tool: metric.trajectory?.approvalFlow?.tool ?? '',
    minCount: String(metric.trajectory?.approvalFlow?.minCount ?? 1),
    notContains: metric.answer?.notContains.join(', ') ?? '',
    maxTurns: String(metric.budget?.maxTurns ?? 30),
    maxTokens: String(metric.budget?.maxTokens ?? 200_000),
  }
}

/** 数字输入 → 数值(空串给 0,交给校验器报「必须是正整数」,不静默取默认). */
function integerOf(text: string): number {
  const trimmed = text.trim()
  return trimmed === '' ? 0 : Number(trimmed)
}

/** 禁语文本 → 词条(英文/中文逗号、换行分隔;空白词丢弃). */
function splitWords(text: string): readonly string[] {
  return text.split(/[,，\n]/u).map(word => word.trim()).filter(word => word !== '')
}

/** 表单 → 校验器输入(外层 camelCase,嵌套 snake_case = metrics.yaml 同形). */
function draftInput(draft: Draft, enabled: boolean): Record<string, unknown> {
  const base = {
    key: draft.key.trim(),
    name: draft.name,
    description: draft.description,
    category: draft.category,
    // budget 只有整条会话口径;其余形态用表单范围。
    scope: draft.mode === 'budget' ? 'session' : draft.scope,
    gating: draft.gating,
    enabled,
  }
  if (draft.mode === 'approval') {
    return {
      ...base,
      trajectory: { approval_flow: { tool: draft.tool.trim(), min_count: integerOf(draft.minCount) } },
    }
  }
  if (draft.mode === 'answer') {
    return { ...base, answer: { not_contains: [...splitWords(draft.notContains)] } }
  }
  if (draft.mode === 'budget') {
    return { ...base, budget: { max_turns: integerOf(draft.maxTurns), max_tokens: integerOf(draft.maxTokens) } }
  }
  const maxSteps = draft.maxSteps.trim()
  const minScore = draft.minScore.trim()
  return {
    ...base,
    judge: {
      // 空串给 NaN/0,交给校验器逐字段报错(不静默取默认值)。
      window: { max_steps: maxSteps === '' ? 0 : Number(maxSteps) },
      allow_skip: draft.allowSkip,
      pass: { min_score: minScore === '' ? Number.NaN : Number(minScore) },
      criteria: draft.criteria.map(row => ({
        text: row.text,
        weight: row.weight.trim() === '' ? 0 : Number(row.weight),
        critical: row.critical,
      })),
    },
  }
}

/** 按 key upsert(保持顺序). */
function upsertMetric(metrics: readonly BusinessMetric[], metric: BusinessMetric): readonly BusinessMetric[] {
  return metrics.some(item => item.key === metric.key)
    ? metrics.map(item => (item.key === metric.key ? metric : item))
    : [...metrics, metric]
}

/** 列表徽标:形态细分(rubric / 审批流 / 禁语 / 预算). */
function formLabel(metric: BusinessMetric): string {
  const form = businessFormOf(metric)
  if (form === 'judge') return 'rubric'
  if (form === 'approval') return '审批流'
  if (form === 'answer') return '禁语'
  if (form === 'budget') return '预算'
  return '规则型'
}

/** 保存/启停失败的统一文案. */
function saveError(error: unknown): string {
  return error instanceof SessionEvalApiError ? error.message : '保存失败：无法连接服务端。'
}

/** 业务指标分区(嵌在「评测」section 内). */
export function BusinessMetricsSection(props: {
  readonly business: BusinessMetricsView | undefined
  readonly onChanged: () => void
}): ReactElement {
  const { business, onChanged } = props
  const view = business ?? {
    version: EMPTY_BUSINESS_FILE.version,
    updatedAt: EMPTY_BUSINESS_FILE.updatedAt,
    updatedBy: EMPTY_BUSINESS_FILE.updatedBy,
    metrics: EMPTY_BUSINESS_FILE.metrics,
    yaml: '',
  }
  const [draft, setDraft] = useState<Draft | undefined>(undefined)
  const [editingKey, setEditingKey] = useState<string | undefined>(undefined)
  const [saving, setSaving] = useState(false)
  const [feedback, setFeedback] = useState('')
  const [importText, setImportText] = useState('')
  const [importing, setImporting] = useState(false)
  const [importError, setImportError] = useState('')
  const [parsed, setParsed] = useState<BusinessParsedReply | undefined>(undefined)

  const existing = editingKey === undefined
    ? undefined
    : view.metrics.find(metric => metric.key === editingKey)

  const preview = useMemo(() => {
    if (draft === undefined) return undefined
    const input = draftInput(draft, existing?.enabled ?? draft.enabled)
    const validated = existing === undefined
      ? validateBusinessMetric(input, { version: 1 })
      : validateBusinessMetric(input, { existing })
    if (!validated.ok) return { ok: false as const, error: validated.error }
    return {
      ok: true as const,
      text: serializeBusinessMetrics({
        version: view.version + 1,
        updatedAt: '',
        updatedBy: '',
        metrics: upsertMetric(view.metrics, validated.metric),
      }),
    }
  }, [draft, existing, view])

  const openNew = useCallback((): void => {
    setEditingKey(undefined)
    setDraft(NEW_DRAFT)
    setFeedback('')
  }, [])

  const openEditor = useCallback((metric: BusinessMetric): void => {
    setEditingKey(metric.key)
    setDraft(draftOf(metric))
    setFeedback('')
  }, [])

  const closeEditor = useCallback((): void => {
    setDraft(undefined)
    setEditingKey(undefined)
    setFeedback('')
  }, [])

  const patchDraft = useCallback((patch: Partial<Draft>): void => {
    setDraft(previous => (previous === undefined ? previous : { ...previous, ...patch }))
    setFeedback('')
  }, [])

  const setMode = useCallback((mode: DraftMode): void => {
    // budget 只有整条会话口径:切到该形态即锁定范围,避免出现校验必拒的组合。
    setDraft(previous => previous === undefined
      ? previous
      : { ...previous, mode, ...mode === 'budget' ? { scope: 'session' as const } : {} })
    setFeedback('')
  }, [])

  const patchCriterion = useCallback((index: number, patch: Partial<CriterionDraft>): void => {
    setDraft(previous => previous === undefined
      ? previous
      : {
        ...previous,
        criteria: previous.criteria.map((row, offset) => (offset === index ? { ...row, ...patch } : row)),
      })
    setFeedback('')
  }, [])

  const addCriterion = useCallback((): void => {
    setDraft(previous => previous === undefined
      ? previous
      : { ...previous, criteria: [...previous.criteria, EMPTY_CRITERION] })
  }, [])

  const removeCriterion = useCallback((index: number): void => {
    setDraft(previous => previous === undefined
      ? previous
      : { ...previous, criteria: previous.criteria.filter((_row, offset) => offset !== index) })
  }, [])

  const saveDraft = useCallback((): void => {
    if (draft === undefined || saving) return
    const input = draftInput(draft, existing?.enabled ?? draft.enabled)
    const validated = existing === undefined
      ? validateBusinessMetric(input, { version: 1 })
      : validateBusinessMetric(input, { existing })
    if (!validated.ok) {
      setFeedback(validated.error)
      return
    }
    setSaving(true)
    setFeedback('')
    saveBusinessMetric(input, view.version)
      .then(() => {
        setDraft(undefined)
        setEditingKey(undefined)
        onChanged()
        setFeedback(`已保存「${validated.metric.name}」：从下次「立即评测」起按新定义评分。`)
      })
      .catch((error: unknown) => {
        if (error instanceof SessionEvalApiError && error.status === 409) {
          onChanged()
          setFeedback('保存冲突：覆盖层文件已被修改，已重新读取，请确认后重试。')
          return
        }
        setFeedback(saveError(error))
      })
      .finally(() => { setSaving(false) })
  }, [draft, existing, onChanged, saving, view.version])

  const toggleMetric = useCallback((metric: BusinessMetric, enabled: boolean): void => {
    if (saving) return
    setSaving(true)
    setFeedback('')
    saveBusinessMetric({ ...metricInputOf(metric), enabled }, view.version)
      .then(() => {
        onChanged()
        setFeedback(enabled
          ? `已启用「${metric.name}」。`
          : `已停用「${metric.name}」（不删行，历史评分保留）。`)
      })
      .catch((error: unknown) => {
        if (error instanceof SessionEvalApiError && error.status === 409) {
          onChanged()
          setFeedback('保存冲突：覆盖层文件已被修改，已重新读取，请重试。')
          return
        }
        setFeedback(saveError(error))
      })
      .finally(() => { setSaving(false) })
  }, [onChanged, saving, view.version])

  const parseImport = useCallback((): void => {
    if (importing || importText.trim() === '') return
    setImporting(true)
    setImportError('')
    setParsed(undefined)
    parseMetricsYaml(importText)
      .then(result => { setParsed(result) })
      .catch((error: unknown) => {
        setImportError(error instanceof SessionEvalApiError
          ? error.message
          : '解析失败：无法连接服务端。')
      })
      .finally(() => { setImporting(false) })
  }, [importText, importing])

  const loadParsed = useCallback((metric: BusinessMetric): void => {
    const current = view.metrics.find(item => item.key === metric.key)
    setEditingKey(current === undefined ? undefined : current.key)
    setDraft(draftOf(metric))
    setImportError('')
    setFeedback(current === undefined
      ? `已载入「${metric.name}」到编辑器（新条目）：确认内容后点保存，保存才写入当前账号的文件。`
      : `已载入「${metric.name}」到编辑器（同 key 条目将被覆盖）：确认内容后点保存。`)
  }, [view.metrics])

  return (
    <fieldset data-eterna-eval-set="group">
      <legend>业务指标（当前账号）</legend>
      <p data-eterna-eval-set="hint">
        业务指标属于当前登录账号，写入本人工作区的 .eterna/eval/metrics.yaml；只在「立即评测」时执行（自动抽样只跑内置六项）。
        {view.version === 0 ? '' : ` 当前文件 v${view.version}${view.updatedBy === '' ? '' : `，上次由 ${view.updatedBy} 保存`}。`}
      </p>
      {business === undefined ? (
        <p data-eterna-eval-set="hint">业务指标层未接线：宿主未提供账号覆盖层路径，保存与执行均不可用。</p>
      ) : null}
      {business === undefined || business.warning === undefined ? null : (
        <p data-eterna-eval-set="error" role="alert">
          {`覆盖层文件无法解析（按空文件展示，保存会被拒绝）：${business.warning}`}
        </p>
      )}
      <ul data-eterna-eval-set="business-list">
        {view.metrics.length === 0 ? <li data-eterna-eval-set="hint">还没有业务指标。</li> : null}
        {view.metrics.map(metric => (
          <li key={metric.key} data-eterna-eval-set="business-item">
            <span data-eterna-eval-set="business-main">
              <span data-eterna-eval-set="business-name">{metric.name}</span>
              <span data-eterna-eval-set="unit">{`${metric.key} · v${metric.version}`}</span>
            </span>
            <span data-eterna-eval-set="badges">
              <span data-eterna-eval-set="badge">{metric.category === 'outcome' ? '结果类' : '过程类'}</span>
              <span data-eterna-eval-set="badge">{metric.scope === 'session' ? '整条会话' : '逐轮'}</span>
              <span data-eterna-eval-set="badge">{formLabel(metric)}</span>
              {metric.gating ? <span data-eterna-eval-set="badge" data-tone="accent">关键项</span> : null}
              {metric.enabled ? null : <span data-eterna-eval-set="badge">已停用</span>}
            </span>
            <span data-eterna-eval-set="business-actions">
              <label data-eterna-eval-set="switch">
                <input
                  type="checkbox"
                  checked={metric.enabled}
                  disabled={saving}
                  onChange={event => { toggleMetric(metric, event.target.checked) }}
                />
                启用
              </label>
              <button
                type="button"
                className="et-eval-button"
                disabled={saving}
                onClick={() => { openEditor(metric) }}
              >
                编辑
              </button>
            </span>
          </li>
        ))}
      </ul>
      <p data-eterna-eval-set="hint">
        规则型（审批流 / 禁语 / 预算）是确定性断言，与 dsh-evals 金集同一套语义：不调用模型、不占裁判预算，无裁判路由也可执行。
      </p>

      <div data-eterna-eval-set="business-tools">
        <button
          type="button"
          className="et-eval-button"
          disabled={saving || business === undefined}
          onClick={openNew}
        >
          <Icon name="plus" size={14} />
          新建业务指标
        </button>
        <span data-eterna-eval-set="unit">{draft === undefined ? '' : editingKey === undefined ? '新建指标' : `编辑「${editingKey}」`}</span>
      </div>

      <details data-eterna-eval-set="import-box">
        <summary>从 YAML 导入</summary>
        <p data-eterna-eval-set="hint">
          粘贴 metrics.yaml 原文 → 解析（服务端校验，错误带行号）→ 选一条载入编辑器 → 确认后保存。解析不会直接改写文件。
        </p>
        <textarea
          data-eterna-eval-set="import-text"
          rows={6}
          value={importText}
          spellCheck={false}
          aria-label="粘贴 metrics.yaml 内容"
          placeholder={'version: 0\nmetrics:\n  - key: reply-forbidden-words\n    name: 回复禁语\n    category: process\n    scope: session\n    answer:\n      not_contains:\n        - 保证搞定'}
          onChange={event => { setImportText(event.target.value) }}
        />
        <div data-eterna-eval-set="business-tools">
          <button
            type="button"
            className="et-eval-button"
            disabled={importing || importText.trim() === ''}
            onClick={parseImport}
          >
            <Icon name="check" size={14} />
            {importing ? '解析中…' : '解析'}
          </button>
          <span data-eterna-eval-set="unit">{parsed === undefined ? '' : `文件 v${parsed.version}，${parsed.metrics.length} 条可导入`}</span>
        </div>
        {importError === '' ? null : <p data-eterna-eval-set="error" role="alert">{importError}</p>}
        {parsed === undefined ? null : (
          <div data-eterna-eval-set="import-result">
            <p data-eterna-eval-set="unit">
              {`解析成功：文件 v${parsed.version}${parsed.updatedBy === '' ? '' : `（${parsed.updatedBy} 保存）`}。`}
            </p>
            <ul data-eterna-eval-set="business-list">
              {parsed.metrics.length === 0 ? <li data-eterna-eval-set="hint">文件里没有指标条目。</li> : null}
              {parsed.metrics.map(metric => (
                <li key={metric.key} data-eterna-eval-set="business-item">
                  <span data-eterna-eval-set="business-main">
                    <span data-eterna-eval-set="business-name">{metric.name}</span>
                    <span data-eterna-eval-set="unit">{`${metric.key} · v${metric.version}`}</span>
                  </span>
                  <span data-eterna-eval-set="badges">
                    <span data-eterna-eval-set="badge">{metric.category === 'outcome' ? '结果类' : '过程类'}</span>
                    <span data-eterna-eval-set="badge">{metric.scope === 'session' ? '整条会话' : '逐轮'}</span>
                    <span data-eterna-eval-set="badge">{formLabel(metric)}</span>
                  </span>
                  <span data-eterna-eval-set="business-actions">
                    <button
                      type="button"
                      className="et-eval-button"
                      disabled={saving || business === undefined}
                      onClick={() => { loadParsed(metric) }}
                    >
                      载入编辑器
                    </button>
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </details>

      {draft === undefined ? null : (
        <div data-eterna-eval-set="editor">
          <div data-eterna-eval-set="row">
            <label htmlFor="et-eval-bm-key">标识</label>
            <input
              id="et-eval-bm-key"
              type="text"
              value={draft.key}
              disabled={editingKey !== undefined}
              placeholder="reply-no-promise"
              onChange={event => { patchDraft({ key: event.target.value }) }}
            />
          </div>
          <div data-eterna-eval-set="row">
            <label htmlFor="et-eval-bm-name">名称</label>
            <input
              id="et-eval-bm-name"
              type="text"
              value={draft.name}
              placeholder="不超过 20 字"
              onChange={event => { patchDraft({ name: event.target.value }) }}
            />
          </div>
          <div data-eterna-eval-set="row">
            <label htmlFor="et-eval-bm-desc">说明</label>
            <input
              id="et-eval-bm-desc"
              type="text"
              value={draft.description}
              placeholder="给裁判看的指标说明（可空）"
              onChange={event => { patchDraft({ description: event.target.value }) }}
            />
          </div>
          <div data-eterna-eval-set="row">
            <label htmlFor="et-eval-bm-category">类别</label>
            <select
              id="et-eval-bm-category"
              value={draft.category}
              onChange={event => { patchDraft({ category: event.target.value === 'process' ? 'process' : 'outcome' }) }}
            >
              <option value="outcome">结果类</option>
              <option value="process">过程类</option>
            </select>
          </div>
          <div data-eterna-eval-set="row">
            <label htmlFor="et-eval-bm-mode">判定方式</label>
            <select
              id="et-eval-bm-mode"
              value={draft.mode}
              onChange={event => {
                const value = event.target.value
                setMode(value === 'approval' || value === 'answer' || value === 'budget' ? value : 'judge')
              }}
            >
              <option value="judge">rubric（模型裁判）</option>
              <option value="approval">审批流（approval_flow）</option>
              <option value="answer">禁语（not_contains）</option>
              <option value="budget">预算（budget）</option>
            </select>
          </div>
          <div data-eterna-eval-set="row">
            <label htmlFor="et-eval-bm-scope">范围</label>
            <select
              id="et-eval-bm-scope"
              value={draft.mode === 'budget' ? 'session' : draft.scope}
              disabled={draft.mode === 'budget'}
              onChange={event => { patchDraft({ scope: event.target.value === 'turn' ? 'turn' : 'session' }) }}
            >
              <option value="session">整条会话</option>
              <option value="turn">逐轮</option>
            </select>
          </div>
          <div data-eterna-eval-set="row">
            <label htmlFor="et-eval-bm-gating">关键项</label>
            <input
              id="et-eval-bm-gating"
              type="checkbox"
              checked={draft.gating}
              onChange={event => { patchDraft({ gating: event.target.checked }) }}
            />
          </div>

          {draft.mode !== 'judge' ? null : (
            <>
              <div data-eterna-eval-set="row">
                <label htmlFor="et-eval-bm-pass">通过线</label>
                <span data-eterna-eval-set="field">
                  <input
                    id="et-eval-bm-pass"
                    type="number"
                    min={0}
                    max={1}
                    step={0.05}
                    value={draft.minScore}
                    onChange={event => { patchDraft({ minScore: event.target.value }) }}
                  />
                  <span data-eterna-eval-set="unit">0 到 1（得分 = 命中正权重 / 正权重总和）</span>
                </span>
              </div>
              <div data-eterna-eval-set="row">
                <label htmlFor="et-eval-bm-steps">窗口</label>
                <span data-eterna-eval-set="field">
                  <input
                    id="et-eval-bm-steps"
                    type="number"
                    min={1}
                    max={50}
                    step={1}
                    value={draft.maxSteps}
                    onChange={event => { patchDraft({ maxSteps: event.target.value }) }}
                  />
                  <span data-eterna-eval-set="unit">轮（裁判最多看最近多少步）</span>
                </span>
              </div>
              <div data-eterna-eval-set="row">
                <label htmlFor="et-eval-bm-skip">无法判断时</label>
                <span data-eterna-eval-set="field">
                  <label data-eterna-eval-set="switch">
                    <input
                      id="et-eval-bm-skip"
                      type="checkbox"
                      checked={draft.allowSkip}
                      onChange={event => { patchDraft({ allowSkip: event.target.checked }) }}
                    />
                    记不适用（不记 0 分）
                  </label>
                </span>
              </div>
              <div data-eterna-eval-set="criteria">
                <span data-eterna-eval-set="unit">
                  评分细则：权重为正 = 要求项，为负 = 红线问题（命中即扣分）；「关键」不成立直接未过，得分由引擎按权重计算。
                </span>
                {draft.criteria.map((row, index) => (
                  <div key={index} data-eterna-eval-set="criterion">
                    <input
                      type="text"
                      value={row.text}
                      placeholder={`第 ${index + 1} 条细则`}
                      aria-label={`第 ${index + 1} 条细则`}
                      onChange={event => { patchCriterion(index, { text: event.target.value }) }}
                    />
                    <input
                      type="number"
                      min={-5}
                      max={5}
                      step={1}
                      value={row.weight}
                      aria-label={`第 ${index + 1} 条权重`}
                      onChange={event => { patchCriterion(index, { weight: event.target.value }) }}
                    />
                    <label data-eterna-eval-set="switch">
                      <input
                        type="checkbox"
                        checked={row.critical}
                        onChange={event => { patchCriterion(index, { critical: event.target.checked }) }}
                      />
                      关键
                    </label>
                    <button
                      type="button"
                      className="et-eval-button"
                      aria-label={`删除第 ${index + 1} 条细则`}
                      disabled={saving || draft.criteria.length <= 1}
                      onClick={() => { removeCriterion(index) }}
                    >
                      <Icon name="trash" size={14} />
                    </button>
                  </div>
                ))}
                <div data-eterna-eval-set="business-tools">
                  <button type="button" className="et-eval-button" disabled={saving} onClick={addCriterion}>
                    <Icon name="plus" size={14} />
                    添加条件
                  </button>
                </div>
              </div>
            </>
          )}

          {draft.mode !== 'approval' ? null : (
            <>
              <div data-eterna-eval-set="row">
                <label htmlFor="et-eval-bm-tool">工具</label>
                <input
                  id="et-eval-bm-tool"
                  type="text"
                  value={draft.tool}
                  placeholder="budget_change"
                  onChange={event => { patchDraft({ tool: event.target.value }) }}
                />
              </div>
              <div data-eterna-eval-set="row">
                <label htmlFor="et-eval-bm-min">最少问询次数</label>
                <span data-eterna-eval-set="field">
                  <input
                    id="et-eval-bm-min"
                    type="number"
                    min={1}
                    step={1}
                    value={draft.minCount}
                    onChange={event => { patchDraft({ minCount: event.target.value }) }}
                  />
                  <span data-eterna-eval-set="unit">审批问询（approval/asked）计数下限，不是工具调用次数</span>
                </span>
              </div>
            </>
          )}

          {draft.mode !== 'answer' ? null : (
            <div data-eterna-eval-set="row">
              <label htmlFor="et-eval-bm-words">禁止词</label>
              <input
                id="et-eval-bm-words"
                type="text"
                value={draft.notContains}
                placeholder="保证搞定, 内部关系"
                onChange={event => { patchDraft({ notContains: event.target.value }) }}
              />
            </div>
          )}

          {draft.mode !== 'budget' ? null : (
            <>
              <div data-eterna-eval-set="row">
                <label htmlFor="et-eval-bm-turns">最大轮数</label>
                <span data-eterna-eval-set="field">
                  <input
                    id="et-eval-bm-turns"
                    type="number"
                    min={1}
                    step={1}
                    value={draft.maxTurns}
                    onChange={event => { patchDraft({ maxTurns: event.target.value }) }}
                  />
                  <span data-eterna-eval-set="unit">turn/start 去重</span>
                </span>
              </div>
              <div data-eterna-eval-set="row">
                <label htmlFor="et-eval-bm-tokens">最大 tokens</label>
                <span data-eterna-eval-set="field">
                  <input
                    id="et-eval-bm-tokens"
                    type="number"
                    min={1}
                    step={1}
                    value={draft.maxTokens}
                    onChange={event => { patchDraft({ maxTokens: event.target.value }) }}
                  />
                  <span data-eterna-eval-set="unit">计费口径合计（与 dsh-evals budget 同式）</span>
                </span>
              </div>
            </>
          )}

          <details data-eterna-eval-set="yaml-box">
            <summary>YAML 预览（updated_at / updated_by 由服务端在保存时写入）</summary>
            {preview === undefined ? null : preview.ok
              ? <pre data-eterna-eval-set="yaml">{preview.text}</pre>
              : <p data-eterna-eval-set="error" role="alert">{preview.error}</p>}
          </details>

          <div data-eterna-eval-set="actions">
            <button type="button" className="et-eval-button" disabled={saving} onClick={saveDraft}>
              <Icon name="check" size={14} />
              {saving ? '保存中…' : '保存指标'}
            </button>
            <button type="button" className="et-eval-button" disabled={saving} onClick={closeEditor}>取消</button>
          </div>
        </div>
      )}

      {feedback === '' ? null : <p data-eterna-eval-set="feedback" role="status">{feedback}</p>}
    </fieldset>
  )
}