/**
 * 设置分区「业务指标」:当前账号私有 rubric 指标编辑器(56 号 §9)。
 *
 * 形态纪律:
 * - 仍是 `settings.section` 分区内的一个 fieldset(铁律 1:不自建页面/弹窗);
 * - 业务指标按**账号**存储(`workspaces/<账号>/.eterna/eval/metrics.yaml`),
 *   普通用户可自助编辑;裁判配置仍是管理员只读边界,两者互不影响;
 * - 校验器与序列化器是服务端同一份纯模块(business-metrics.ts),前端只做
 *   提前报错与 YAML 预览,服务端二次校验为准;
 * - 保存带文件版本(乐观锁):409 = 文件被改过,自动重读后让用户确认再存;
 * - 停用写 `enabled: false`(不删行,历史评分仍可追溯定义版本)。
 */
import { useCallback, useMemo, useState } from 'react'
import type { ReactElement } from 'react'
import { Icon } from '@eterna/ui/icons'
import {
  EMPTY_BUSINESS_FILE, businessKindOf, metricInputOf, serializeBusinessMetrics, validateBusinessMetric,
  type BusinessMetric,
} from '../business-metrics.ts'
import type { BusinessMetricsView } from '../judge-types.ts'
import { SessionEvalApiError, saveBusinessMetric } from './api.ts'

/** 单条细则的表单态(数字以字符串承载). */
interface CriterionDraft {
  readonly text: string
  readonly weight: string
  readonly critical: boolean
}

/** rubric 指标编辑器态(只覆盖 rubric 形态;规则型随后续批次). */
interface Draft {
  readonly key: string
  readonly name: string
  readonly description: string
  readonly category: 'outcome' | 'process'
  readonly scope: 'session' | 'turn'
  readonly gating: boolean
  readonly minScore: string
  readonly maxSteps: string
  readonly allowSkip: boolean
  readonly criteria: readonly CriterionDraft[]
}

const EMPTY_CRITERION: CriterionDraft = { text: '', weight: '1', critical: false }

const NEW_DRAFT: Draft = {
  key: '',
  name: '',
  description: '',
  category: 'outcome',
  scope: 'session',
  gating: false,
  minScore: '0.8',
  maxSteps: '12',
  allowSkip: true,
  criteria: [EMPTY_CRITERION],
}

/** 已保存条目 → 表单(仅 rubric 型调用). */
function draftOf(metric: BusinessMetric): Draft {
  const judge = metric.judge
  return {
    key: metric.key,
    name: metric.name,
    description: metric.description,
    category: metric.category,
    scope: metric.scope,
    gating: metric.gating,
    minScore: String(judge?.minScore ?? 0.8),
    maxSteps: String(judge?.window.maxSteps ?? 12),
    allowSkip: judge?.allowSkip ?? true,
    criteria: judge === undefined
      ? [EMPTY_CRITERION]
      : judge.criteria.map(criterion => ({ text: criterion.text, weight: String(criterion.weight), critical: criterion.critical })),
  }
}

/** 表单 → 校验器输入(外层 camelCase,嵌套 snake_case = metrics.yaml 同形). */
function draftInput(draft: Draft, enabled: boolean): Record<string, unknown> {
  const maxSteps = draft.maxSteps.trim()
  const minScore = draft.minScore.trim()
  return {
    key: draft.key.trim(),
    name: draft.name,
    description: draft.description,
    category: draft.category,
    scope: draft.scope,
    gating: draft.gating,
    enabled,
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

  const existing = editingKey === undefined
    ? undefined
    : view.metrics.find(metric => metric.key === editingKey)

  const preview = useMemo(() => {
    if (draft === undefined) return undefined
    const input = draftInput(draft, existing?.enabled ?? true)
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
    const input = draftInput(draft, existing?.enabled ?? true)
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
              <span data-eterna-eval-set="badge">{businessKindOf(metric) === 'judge' ? 'rubric' : '规则型'}</span>
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
                disabled={saving || businessKindOf(metric) !== 'judge'}
                title={businessKindOf(metric) === 'judge' ? undefined : '规则型指标的编辑器随后续批次提供'}
                onClick={() => { openEditor(metric) }}
              >
                编辑
              </button>
            </span>
          </li>
        ))}
      </ul>
      <p data-eterna-eval-set="hint">规则型（审批流 / 禁语 / 预算）指标的编辑器随后续批次提供；已有条目可在此启停。</p>

      <div data-eterna-eval-set="business-tools">
        <button
          type="button"
          className="et-eval-button"
          disabled={saving || business === undefined}
          onClick={openNew}
        >
          <Icon name="plus" size={14} />
          新建 rubric 指标
        </button>
        <span data-eterna-eval-set="unit">{draft === undefined ? '' : editingKey === undefined ? '新建指标' : `编辑「${editingKey}」`}</span>
      </div>

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
            <label htmlFor="et-eval-bm-scope">范围</label>
            <select
              id="et-eval-bm-scope"
              value={draft.scope}
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