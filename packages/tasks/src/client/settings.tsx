/**
 * 设置弹窗分区「任务与超级智能体」(settings.section;2026-11-19 任务设置分区)。
 *
 * 形态照抄 memory/compaction 设置分区:只读写同源端点(/access/api/tasks/*),不改壳、
 * 不建独立页(AGENTS.md 铁律 1)。卡片面(全量设置):
 * 运行状态(健康/暂停/主会话入口/版本/计数)、评估、执行器、预算、门禁、
 * 评估规则、来源名单与准入、来源实例。
 *
 * 交互纪律:脏检查 + 单「保存更改」按钮;按块增量提交(每块只提交该块表单值,
 * 服务端 CAS 按块递增修订);409 冲突 → 提示 + 重新加载;400 校验错误就地展示;
 * 无变化不请求;保存中防重复点击;删除为即时行删除(不用原生 confirm)。
 */
import { useCallback, useEffect, useState, type ReactElement } from 'react'
import { Icon } from '@eterna/ui/icons'
import { fetchTasksSettings, saveTasksBlock, TasksApiError, type TasksSettingsView } from './api.ts'
import type { UiWorkspaceFace } from './client-types.ts'
import {
  ADMISSION_STRONG, ADMISSION_WEAK, cloneSettings, dirtyBlocks, optionalNumber, parseSourceConfig,
  validateSettings, withBlock, type AdmissionRowView, type AdmissionValue, type AllowedView, type BudgetCapsView,
  type RoleModelView, type RuleView, type TasksSettings, type ValidationIssue, type WeakAdmissionValue,
} from './settings-model.ts'

export const TASKS_SECTION_ID = 'eterna-tasks.settings'

export interface TasksSettingsSectionProps {
  readonly t: (key: string) => string
  /** 会话导航(「打开主会话」;宿主未注入时按钮不渲染)。 */
  readonly uiWorkspace?: UiWorkspaceFace
}

type Tone = 'ok' | 'warn' | 'error' | 'muted'
interface Feedback { readonly tone: Tone; readonly text: string }

type Patch = (producer: (previous: TasksSettings) => TasksSettings) => void

/** 已保存基线的来源 config 文本(JSON 缩进 2)。 */
function configTextsOf(settings: TasksSettings): Record<string, string> {
  const texts: Record<string, string> = {}
  for (const [name, instance] of Object.entries(settings.sources)) texts[name] = JSON.stringify(instance.config, null, 2)
  return texts
}

/** 设置分区组件(setting.section occupant)。 */
export function TasksSettingsSection({ t, uiWorkspace }: TasksSettingsSectionProps): ReactElement {
  const [view, setView] = useState<TasksSettingsView | undefined>(undefined)
  const [form, setForm] = useState<TasksSettings | undefined>(undefined)
  const [configText, setConfigText] = useState<Record<string, string>>({})
  const [configErrors, setConfigErrors] = useState<Record<string, string>>({})
  const [phase, setPhase] = useState<'loading' | 'ready' | 'forbidden' | 'unavailable' | 'error'>('loading')
  const [errorText, setErrorText] = useState('')
  const [feedback, setFeedback] = useState<Feedback>({ tone: 'muted', text: '' })
  const [issues, setIssues] = useState<ValidationIssue[]>([])
  const [saving, setSaving] = useState(false)

  const applyView = useCallback((next: TasksSettingsView): void => {
    setView(next)
    setForm(cloneSettings(next.settings))
    setConfigText(configTextsOf(next.settings))
    setConfigErrors({})
    setIssues([])
    setPhase('ready')
  }, [])

  const load = useCallback(async (): Promise<void> => {
    setPhase('loading')
    setErrorText('')
    try {
      applyView(await fetchTasksSettings())
    } catch (error) {
      const status = error instanceof TasksApiError ? error.status : 0
      if (status === 403) setPhase('forbidden')
      else if (status === 503) setPhase('unavailable')
      else {
        setPhase('error')
        setErrorText(error instanceof Error ? error.message : String(error))
      }
    }
  }, [applyView])

  useEffect(() => { void load() }, [load])

  const patch: Patch = useCallback((producer) => {
    setForm(previous => previous === undefined ? previous : producer(previous))
  }, [])

  const onConfigChange = useCallback((name: string, text: string): void => {
    setConfigText(previous => ({ ...previous, [name]: text }))
    const parsed = parseSourceConfig(text)
    if (!parsed.ok) {
      setConfigErrors(previous => ({ ...previous, [name]: parsed.message }))
      return
    }
    setConfigErrors((previous) => {
      const next = { ...previous }
      delete next[name]
      return next
    })
    patch((previous) => {
      const instance = previous.sources[name]
      if (instance === undefined) return previous
      return { ...previous, sources: { ...previous.sources, [name]: { ...instance, config: parsed.value } } }
    })
  }, [patch])

  const blocks = view !== undefined && form !== undefined ? dirtyBlocks(view.settings, form) : []
  const dirty = blocks.length > 0
  const configBlocked = Object.keys(configErrors).length > 0

  const onSave = async (): Promise<void> => {
    if (view === undefined || form === undefined || saving || blocks.length === 0) return
    const invalid = validateSettings(form)
    setIssues(invalid)
    if (invalid.length > 0) {
      setFeedback({ tone: 'error', text: `${t('save.invalid')}：${invalid[0]?.message ?? ''}` })
      return
    }
    if (configBlocked) {
      setFeedback({ tone: 'error', text: t('save.invalid') })
      return
    }
    setSaving(true)
    setFeedback({ tone: 'muted', text: '' })
    let current = view.settings
    let revisions: Record<string, number> = { ...view.revisions }
    let policyVersion = view.policyVersion
    try {
      for (const block of blocks) {
        const result = await saveTasksBlock(block, withBlock(current, form, block), revisions[block] ?? 0)
        current = result.settings
        revisions = { ...revisions, [block]: result.revision }
        policyVersion = result.policyVersion
      }
      setView({ ...view, settings: current, revisions, policyVersion })
      setForm(cloneSettings(current))
      setConfigText(configTextsOf(current))
      setFeedback({ tone: 'ok', text: t('save.saved') })
    } catch (error) {
      if (error instanceof TasksApiError && error.status === 409) {
        setFeedback({ tone: 'warn', text: t('save.conflict') })
        await load()
      } else if (error instanceof TasksApiError && error.status === 400) {
        setFeedback({ tone: 'error', text: `${t('save.invalid')}：${error.message}` })
      } else {
        setFeedback({ tone: 'error', text: `${t('save.error')}：${error instanceof Error ? error.message : String(error)}` })
      }
    } finally {
      setSaving(false)
    }
  }

  if (phase === 'forbidden' || phase === 'unavailable') {
    return (
      <div data-eterna-tasks-settings>
        <div className="ett-locked">
          <strong>{t('section')}</strong>
          <p className="ett-note">{t(phase === 'forbidden' ? 'save.forbidden' : 'save.unavailable')}</p>
        </div>
      </div>
    )
  }
  if (phase === 'error') {
    return (
      <div data-eterna-tasks-settings>
        <div className="ett-locked">
          <strong>{t('section')}</strong>
          <p className="ett-note">{`${t('save.error')}：${errorText}`}</p>
          <button type="button" className="ett-btn" onClick={() => { void load() }}>{t('save.reload')}</button>
        </div>
      </div>
    )
  }
  if (form === undefined || view === undefined) {
    return <div data-eterna-tasks-settings><p className="ett-note">{t('save.loading')}</p></div>
  }

  const masterId = view.masterId
  const openMaster = uiWorkspace === undefined || masterId === undefined
    ? undefined
    : (): void => { uiWorkspace.openSession(masterId) }

  return (
    <div data-eterna-tasks-settings>
      <header className="ett-head">
        <h2 className="ett-title">{t('section')}</h2>
        <p className="ett-note">{t('status.hint')}</p>
      </header>
      <div className="ett-grid">
        <StatusCard t={t} view={view} paused={form.paused} onPause={(next) => { patch(previous => ({ ...previous, paused: next })) }} openMaster={openMaster} />
        <EvalCard t={t} value={form.eval} onChange={(next) => { patch(previous => ({ ...previous, eval: next })) }} />
        <ExecutorCard t={t} value={form.executor} onChange={(next) => { patch(previous => ({ ...previous, executor: next })) }} />
        <BudgetCard t={t} value={form.budget} onChange={(next) => { patch(previous => ({ ...previous, budget: next })) }} />
        <GatesCard t={t} value={form.gates.highRiskRules} ruleIds={form.policy.rules.map(rule => rule.id).filter(id => id !== '')}
          onChange={(next) => { patch(previous => ({ ...previous, gates: { highRiskRules: next } })) }} />
      </div>
      <RulesCard t={t} rules={form.policy.rules}
        onChange={(rules) => { patch(previous => ({ ...previous, policy: { ...previous.policy, rules } })) }} />
      <SourcesCard t={t} sources={form.policy.sources}
        onChange={(sources) => { patch(previous => ({ ...previous, policy: { ...previous.policy, sources } })) }} />
      <InstancesCard t={t} sources={form.sources} configText={configText} configErrors={configErrors}
        onConfigChange={onConfigChange}
        onChange={(sources) => { patch(previous => ({ ...previous, sources })) }} />
      <footer className="ett-footer">
        <div>
          <p className="ett-feedback" data-eterna-tasks-tone={feedback.tone === 'muted' ? undefined : feedback.tone} aria-live="polite">
            {feedback.text !== '' ? feedback.text : dirty ? t('save.dirty') : t('save.clean')}
          </p>
          {issues.length > 0 && (
            <p className="ett-feedback" data-eterna-tasks-tone="error">{issues.slice(0, 3).map(issue => issue.message).join('；')}</p>
          )}
        </div>
        <div className="ett-row">
          <button type="button" className="ett-btn" disabled={saving} onClick={() => { void load() }}>{t('save.reload')}</button>
          <button type="button" className="ett-btn ett-btn-primary" disabled={saving || !dirty || configBlocked}
            onClick={() => { void onSave() }}>
            {saving ? t('save.saving') : t('save.save')}
          </button>
        </div>
      </footer>
    </div>
  )
}

// ── 运行状态卡 ─────────────────────────────────────────────────────────────

function StatusCard({ t, view, paused, onPause, openMaster }: {
  readonly t: (key: string) => string
  readonly view: TasksSettingsView
  readonly paused: boolean
  readonly onPause: (next: boolean) => void
  readonly openMaster: (() => void) | undefined
}): ReactElement {
  return (
    <section className="ett-card" aria-label={t('status.title')}>
      <div className="ett-card-h"><Icon name="gauge" size={16} /><h3>{t('status.title')}</h3></div>
      <dl className="ett-kv">
        <dt>{t('status.realm')}</dt><dd>{view.realm}</dd>
        <dt>{t('status.health')}</dt><dd>{`${t(`health.${view.health.state}`)} · ${view.health.detail}`}</dd>
        <dt>{t('status.version')}</dt><dd title={view.policyVersion}>{view.policyVersion.slice(0, 12)}</dd>
        <dt>{t('status.counts')}</dt><dd>{`${view.stats.tickets.open} / ${view.stats.tickets.active} / ${view.stats.tickets.total}`}</dd>
        <dt>{t('status.master')}</dt><dd>{view.masterId ?? '—'}</dd>
      </dl>
      <label className="ett-check">
        <input type="checkbox" checked={paused} onChange={event => { onPause(event.target.checked) }} />
        {t('status.paused')}
      </label>
      {openMaster !== undefined && (
        <button type="button" className="ett-btn" onClick={openMaster}>
          <Icon name="comment" size={16} />{t('status.openMaster')}
        </button>
      )}
    </section>
  )
}

// ── 角色模型字段 ───────────────────────────────────────────────────────────

function ModelFields({ t, value, onChange }: {
  readonly t: (key: string) => string
  readonly value: RoleModelView | null
  readonly onChange: (next: RoleModelView | null) => void
}): ReactElement {
  if (value === null) {
    return (
      <div className="ett-field">
        <div className="ett-row">
          <span className="ett-sub">{t('model.none')}</span>
          <button type="button" className="ett-btn" onClick={() => { onChange({ provider: '', model: '' }) }}>{t('model.set')}</button>
        </div>
      </div>
    )
  }
  return (
    <div className="ett-field">
      <span>{t('eval.model')}</span>
      <div className="ett-sub-grid">
        <label className="ett-field"><span>{t('model.provider')}</span>
          <input className="ett-input" value={value.provider}
            onChange={event => { onChange({ ...value, provider: event.target.value }) }} />
        </label>
        <label className="ett-field"><span>{t('model.model')}</span>
          <input className="ett-input" value={value.model}
            onChange={event => { onChange({ ...value, model: event.target.value }) }} />
        </label>
        <label className="ett-field"><span>{t('model.effort')}</span>
          <input className="ett-input" value={value.reasoningEffort ?? ''}
            onChange={(event) => {
              const effort = event.target.value
              const base: RoleModelView = { provider: value.provider, model: value.model }
              onChange(effort === '' ? base : { ...base, reasoningEffort: effort })
            }} />
        </label>
      </div>
      <div className="ett-row">
        <button type="button" className="ett-btn ett-btn-quiet" onClick={() => { onChange(null) }}>{t('model.clear')}</button>
      </div>
    </div>
  )
}

// ── 评估卡 ────────────────────────────────────────────────────────────────

function EvalCard({ t, value, onChange }: {
  readonly t: (key: string) => string
  readonly value: TasksSettings['eval']
  readonly onChange: (next: TasksSettings['eval']) => void
}): ReactElement {
  return (
    <section className="ett-card" aria-label={t('eval.title')}>
      <div className="ett-card-h"><Icon name="chart" size={16} /><h3>{t('eval.title')}</h3></div>
      <div className="ett-field">
        <label htmlFor="ett-eval-mode">{t('eval.mode')}</label>
        <select id="ett-eval-mode" className="ett-select" value={value.mode}
          onChange={(event) => {
            const mode = event.target.value
            if (mode === 'off' || mode === 'observe' || mode === 'auto') onChange({ ...value, mode })
          }}>
          <option value="off">{t('eval.off')}</option>
          <option value="observe">{t('eval.observe')}</option>
          <option value="auto">{t('eval.auto')}</option>
        </select>
      </div>
      <div className="ett-field">
        <label htmlFor="ett-eval-timeout">{t('eval.timeout')}</label>
        <input id="ett-eval-timeout" className="ett-input" type="number" min={30} max={600} step={1}
          value={value.timeoutSeconds}
          onChange={(event) => {
            const next = Number(event.target.value)
            onChange({ ...value, timeoutSeconds: Number.isFinite(next) ? next : Number.NaN })
          }} />
      </div>
      <ModelFields t={t} value={value.model} onChange={(model) => { onChange({ ...value, model }) }} />
    </section>
  )
}

// ── 执行器卡 ──────────────────────────────────────────────────────────────

function ExecutorCard({ t, value, onChange }: {
  readonly t: (key: string) => string
  readonly value: TasksSettings['executor']
  readonly onChange: (next: TasksSettings['executor']) => void
}): ReactElement {
  return (
    <section className="ett-card" aria-label={t('exec.title')}>
      <div className="ett-card-h"><Icon name="worker" size={16} /><h3>{t('exec.title')}</h3></div>
      <ModelFields t={t} value={value.model} onChange={(model) => { onChange({ ...value, model }) }} />
      <div className="ett-sub-grid">
        <label className="ett-field"><span>{t('exec.maxWorkers')}</span>
          <input className="ett-input" type="number" min={1} max={16} step={1} value={value.maxWorkers}
            onChange={(event) => {
              const next = Number(event.target.value)
              onChange({ ...value, maxWorkers: Number.isFinite(next) ? next : Number.NaN })
            }} />
        </label>
        <label className="ett-field"><span>{t('exec.directory')}</span>
          <input className="ett-input" value={value.directory} placeholder="/srv/work"
            onChange={event => { onChange({ ...value, directory: event.target.value }) }} />
        </label>
      </div>
      <label className="ett-field"><span>{t('exec.prepare')}</span>
        <textarea className="ett-textarea" value={value.prepare}
          onChange={event => { onChange({ ...value, prepare: event.target.value }) }} />
      </label>
      <label className="ett-field"><span>{t('exec.blocked')}</span>
        <textarea className="ett-textarea" value={value.blockedCommands.join('\n')}
          onChange={(event) => {
            const commands = event.target.value.split('\n').map(line => line.trim()).filter(line => line !== '')
            onChange({ ...value, blockedCommands: commands })
          }} />
      </label>
    </section>
  )
}

// ── 预算卡 ────────────────────────────────────────────────────────────────

function CapsFields({ t, label, caps, onChange }: {
  readonly t: (key: string) => string
  readonly label: string
  readonly caps: BudgetCapsView
  readonly onChange: (next: BudgetCapsView) => void
}): ReactElement {
  const numberText = (value: number | undefined): string => value === undefined ? '' : String(value)
  /** 改一维、其余维度原样保留;清空 = 该维不设限(缺省键,不写 undefined)。 */
  const setCap = (field: 'maxTurns' | 'maxTokens' | 'maxCost', text: string): void => {
    const next: BudgetCapsView = {}
    if (field !== 'maxTurns' && caps.maxTurns !== undefined) next.maxTurns = caps.maxTurns
    if (field !== 'maxTokens' && caps.maxTokens !== undefined) next.maxTokens = caps.maxTokens
    if (field !== 'maxCost' && caps.maxCost !== undefined) next.maxCost = caps.maxCost
    const parsed = optionalNumber(text)
    if (parsed !== undefined) next[field] = parsed
    onChange(next)
  }
  return (
    <div className="ett-field">
      <span>{label}</span>
      <div className="ett-sub-grid">
        <label className="ett-field"><span>{t('budget.maxTurns')}</span>
          <input className="ett-input" type="number" min={1} value={numberText(caps.maxTurns)}
            onChange={event => { setCap('maxTurns', event.target.value) }} />
        </label>
        <label className="ett-field"><span>{t('budget.maxTokens')}</span>
          <input className="ett-input" type="number" min={1} value={numberText(caps.maxTokens)}
            onChange={event => { setCap('maxTokens', event.target.value) }} />
        </label>
        <label className="ett-field"><span>{t('budget.maxCost')}</span>
          <input className="ett-input" type="number" min={0} step="0.01" value={numberText(caps.maxCost)}
            onChange={event => { setCap('maxCost', event.target.value) }} />
        </label>
      </div>
    </div>
  )
}

function BudgetCard({ t, value, onChange }: {
  readonly t: (key: string) => string
  readonly value: TasksSettings['budget']
  readonly onChange: (next: TasksSettings['budget']) => void
}): ReactElement {
  const pricing = value.pricing
  return (
    <section className="ett-card" aria-label={t('budget.title')}>
      <div className="ett-card-h"><Icon name="chart" size={16} /><h3>{t('budget.title')}</h3></div>
      <CapsFields t={t} label={t('budget.simple')} caps={value.caps.simple}
        onChange={(caps) => { onChange({ ...value, caps: { ...value.caps, simple: caps } }) }} />
      <CapsFields t={t} label={t('budget.compare')} caps={value.caps.compare}
        onChange={(caps) => { onChange({ ...value, caps: { ...value.caps, compare: caps } }) }} />
      <CapsFields t={t} label={t('budget.complex')} caps={value.caps.complex}
        onChange={(caps) => { onChange({ ...value, caps: { ...value.caps, complex: caps } }) }} />
      {pricing === undefined ? (
        <button type="button" className="ett-btn" onClick={() => { onChange({ ...value, pricing: { inputPerMTokens: 0, outputPerMTokens: 0 } }) }}>
          {t('budget.pricing')}
        </button>
      ) : (
        <div className="ett-field">
          <span>{t('budget.pricing')}</span>
          <div className="ett-sub-grid">
            <label className="ett-field"><span>{t('budget.input')}</span>
              <input className="ett-input" type="number" min={0} step="0.01" value={pricing.inputPerMTokens}
                onChange={(event) => {
                  const input = Number(event.target.value)
                  onChange({ ...value, pricing: { inputPerMTokens: Number.isFinite(input) ? input : Number.NaN, outputPerMTokens: pricing.outputPerMTokens } })
                }} />
            </label>
            <label className="ett-field"><span>{t('budget.output')}</span>
              <input className="ett-input" type="number" min={0} step="0.01" value={pricing.outputPerMTokens}
                onChange={(event) => {
                  const output = Number(event.target.value)
                  onChange({ ...value, pricing: { inputPerMTokens: pricing.inputPerMTokens, outputPerMTokens: Number.isFinite(output) ? output : Number.NaN } })
                }} />
            </label>
          </div>
          <div className="ett-row">
            <button type="button" className="ett-btn ett-btn-quiet" onClick={() => {
              const next: TasksSettings['budget'] = { ...value }
              delete next.pricing
              onChange(next)
            }}>{t('model.clear')}</button>
          </div>
        </div>
      )}
      <label className="ett-field"><span>{t('budget.credits')}</span>
        <input className="ett-input" type="number" min={0} step="0.01"
          value={value.creditsPerMTokens === undefined ? '' : String(value.creditsPerMTokens)}
          onChange={(event) => {
            const credits = optionalNumber(event.target.value)
            if (credits === undefined) {
              const next: TasksSettings['budget'] = { ...value }
              delete next.creditsPerMTokens
              onChange(next)
            } else {
              onChange({ ...value, creditsPerMTokens: credits })
            }
          }} />
      </label>
    </section>
  )
}

// ── 门禁卡 ────────────────────────────────────────────────────────────────

function GatesCard({ t, value, ruleIds, onChange }: {
  readonly t: (key: string) => string
  readonly value: readonly string[]
  readonly ruleIds: readonly string[]
  readonly onChange: (next: string[]) => void
}): ReactElement {
  const ids = [...new Set([...ruleIds, ...value])]
  return (
    <section className="ett-card" aria-label={t('gates.title')}>
      <div className="ett-card-h"><Icon name="bookmark" size={16} /><h3>{t('gates.title')}</h3></div>
      <p className="ett-sub">{t('gates.hint')}</p>
      {ids.length === 0 && <p className="ett-sub">—</p>}
      {ids.map(id => (
        <label key={id} className="ett-check">
          <input type="checkbox" checked={value.includes(id)}
            onChange={(event) => {
              const checked = event.target.checked
              onChange(checked ? [...value, id] : value.filter(item => item !== id))
            }} />
          {id}
        </label>
      ))}
    </section>
  )
}

// ── 规则卡 ────────────────────────────────────────────────────────────────

function RulesCard({ t, rules, onChange }: {
  readonly t: (key: string) => string
  readonly rules: readonly RuleView[]
  readonly onChange: (next: RuleView[]) => void
}): ReactElement {
  const update = (index: number, patch: Partial<RuleView>): void => {
    onChange(rules.map((rule, at) => at === index ? { ...rule, ...patch } : rule))
  }
  return (
    <section className="ett-card" aria-label={t('rules.title')}>
      <div className="ett-card-h"><Icon name="prompt" size={16} /><h3>{t('rules.title')}</h3></div>
      {rules.length === 0 && <p className="ett-sub">{t('rules.empty')}</p>}
      {rules.map((rule, index) => (
        <div key={`${index}-${rule.id}`} className="ett-rule">
          <div className="ett-sub-grid">
            <label className="ett-field"><span>{t('rules.id')}</span>
              <input className="ett-input" value={rule.id} onChange={event => { update(index, { id: event.target.value }) }} />
            </label>
            <label className="ett-field"><span>{t('rules.name')}</span>
              <input className="ett-input" value={rule.name} onChange={event => { update(index, { name: event.target.value }) }} />
            </label>
            <label className="ett-check">
              <input type="checkbox" checked={rule.enabled} onChange={event => { update(index, { enabled: event.target.checked }) }} />
              {t('rules.enabled')}
            </label>
          </div>
          <label className="ett-field"><span>{t('rules.instruction')}</span>
            <textarea className="ett-textarea" value={rule.instruction}
              onChange={event => { update(index, { instruction: event.target.value }) }} />
          </label>
          <div className="ett-row">
            <button type="button" className="ett-btn ett-btn-quiet" onClick={() => { onChange(rules.filter((_, at) => at !== index)) }}>
              {t('rules.remove')}
            </button>
          </div>
        </div>
      ))}
      <div className="ett-row">
        <button type="button" className="ett-btn" onClick={() => { onChange([...rules, { id: '', name: '', enabled: true, instruction: '' }]) }}>
          <Icon name="plus" size={16} />{t('rules.add')}
        </button>
      </div>
    </section>
  )
}

// ── 来源名单与准入卡 ──────────────────────────────────────────────────────

function SourceAllowedEditor({ t, part, onChange }: {
  readonly t: (key: string) => string
  readonly part: TasksSettings['policy']['sources'][string]
  readonly onChange: (next: TasksSettings['policy']['sources'][string]) => void
}): ReactElement {
  const allowed = part.allowed
  const replace = (index: number, next: AllowedView): void => {
    onChange({ ...part, allowed: allowed.map((entry, at) => at === index ? next : entry) })
  }
  const replaceName = (index: number, entry: AllowedView, name: string): void => {
    const next: AllowedView = { id: entry.id }
    if (name !== '') next.name = name
    replace(index, next)
  }
  return (
    <div className="ett-field">
      <span>{t('sources.allowed')}</span>
      {allowed.map((entry, index) => (
        <div key={`member-${index}`} className="ett-sub-grid">
          <label className="ett-field"><span>{t('sources.memberId')}</span>
            <input className="ett-input" value={entry.id}
              onChange={event => { replace(index, { ...entry, id: event.target.value }) }} />
          </label>
          <label className="ett-field"><span>{t('sources.memberName')}</span>
            <input className="ett-input" value={entry.name ?? ''}
              onChange={event => { replaceName(index, entry, event.target.value) }} />
          </label>
          <button type="button" className="ett-btn ett-btn-quiet"
            aria-label={t('sources.remove')}
            onClick={() => { onChange({ ...part, allowed: allowed.filter((_, at) => at !== index) }) }}>
            <Icon name="trash" size={16} />
          </button>
        </div>
      ))}
      <div className="ett-row">
        <button type="button" className="ett-btn" onClick={() => { onChange({ ...part, allowed: [...allowed, { id: '' }] }) }}>
          <Icon name="plus" size={16} />{t('sources.addMember')}
        </button>
      </div>
    </div>
  )
}

type AdmissionField = 'listedUnaddressed' | 'unlistedAddressed' | 'unlistedUnaddressed'

/** 只拷贝三格已知键(丢弃 undefined;`exactOptionalPropertyTypes` 下不写显式 undefined)。 */
function copyAdmissionRow(row: AdmissionRowView): AdmissionRowView {
  const next: AdmissionRowView = {}
  if (row.listedUnaddressed !== undefined) next.listedUnaddressed = row.listedUnaddressed
  if (row.unlistedAddressed !== undefined) next.unlistedAddressed = row.unlistedAddressed
  if (row.unlistedUnaddressed !== undefined) next.unlistedUnaddressed = row.unlistedUnaddressed
  return next
}

/** 改一档:空选择 = 删除该键(继承来源默认);其余档位由 select 的选项域限定。 */
function withAdmissionField(row: AdmissionRowView, field: AdmissionField, picked: string): AdmissionRowView {
  const next = copyAdmissionRow(row)
  if (field === 'listedUnaddressed') {
    delete next.listedUnaddressed
    if (picked !== '') next.listedUnaddressed = picked as WeakAdmissionValue
  } else if (field === 'unlistedAddressed') {
    delete next.unlistedAddressed
    if (picked !== '') next.unlistedAddressed = picked as AdmissionValue
  } else {
    delete next.unlistedUnaddressed
    if (picked !== '') next.unlistedUnaddressed = picked as WeakAdmissionValue
  }
  return next
}

function SourceAdmissionEditor({ t, part, onChange }: {
  readonly t: (key: string) => string
  readonly part: TasksSettings['policy']['sources'][string]
  readonly onChange: (next: TasksSettings['policy']['sources'][string]) => void
}): ReactElement {
  const rows = Object.entries(part.admission)
  const setField = (key: string, field: AdmissionField, picked: string): void => {
    const row = part.admission[key]
    if (row === undefined) return
    onChange({ ...part, admission: { ...part.admission, [key]: withAdmissionField(row, field, picked) } })
  }
  const renameRow = (from: string, to: string): void => {
    const next: Record<string, AdmissionRowView> = {}
    for (const [key, row] of rows) next[key === from ? to : key] = row
    onChange({ ...part, admission: next })
  }
  return (
    <div className="ett-field">
      <span>{t('sources.admission')}</span>
      {rows.map(([key, row]) => (
        <div key={`admission-${key}`} className="ett-rule">
          <div className="ett-sub-grid">
            <label className="ett-field"><span>{t('sources.rowKey')}</span>
              <input className="ett-input" value={key} onChange={event => { renameRow(key, event.target.value) }} />
            </label>
            <label className="ett-field"><span>{t('sources.listedUnaddressed')}</span>
              <select className="ett-select" value={row.listedUnaddressed ?? ''}
                onChange={event => { setField(key, 'listedUnaddressed', event.target.value) }}>
                <option value="">{t('sources.inherit')}</option>
                {ADMISSION_WEAK.map(item => <option key={item} value={item}>{t(`sources.${item}`)}</option>)}
              </select>
            </label>
            <label className="ett-field"><span>{t('sources.unlistedAddressed')}</span>
              <select className="ett-select" value={row.unlistedAddressed ?? ''}
                onChange={event => { setField(key, 'unlistedAddressed', event.target.value) }}>
                <option value="">{t('sources.inherit')}</option>
                {ADMISSION_STRONG.map(item => <option key={item} value={item}>{t(`sources.${item}`)}</option>)}
              </select>
            </label>
            <label className="ett-field"><span>{t('sources.unlistedUnaddressed')}</span>
              <select className="ett-select" value={row.unlistedUnaddressed ?? ''}
                onChange={event => { setField(key, 'unlistedUnaddressed', event.target.value) }}>
                <option value="">{t('sources.inherit')}</option>
                {ADMISSION_WEAK.map(item => <option key={item} value={item}>{t(`sources.${item}`)}</option>)}
              </select>
            </label>
          </div>
          <div className="ett-row">
            <button type="button" className="ett-btn ett-btn-quiet" aria-label={t('common.delete')}
              onClick={() => {
                const next: Record<string, AdmissionRowView> = {}
                for (const [at, value] of rows) if (at !== key) next[at] = value
                onChange({ ...part, admission: next })
              }}>
              {t('common.delete')}
            </button>
          </div>
        </div>
      ))}
      <div className="ett-row">
        <button type="button" className="ett-btn"
          onClick={() => { onChange({ ...part, admission: { ...part.admission, ['']: {} } }) }}>
          <Icon name="plus" size={16} />{t('sources.addRow')}
        </button>
      </div>
    </div>
  )
}

function SourcesCard({ t, sources, onChange }: {
  readonly t: (key: string) => string
  readonly sources: TasksSettings['policy']['sources']
  readonly onChange: (next: TasksSettings['policy']['sources']) => void
}): ReactElement {
  const [newName, setNewName] = useState('')
  const entries = Object.entries(sources).sort(([left], [right]) => left.localeCompare(right))
  return (
    <section className="ett-card" aria-label={t('sources.title')}>
      <div className="ett-card-h"><Icon name="globe" size={16} /><h3>{t('sources.title')}</h3></div>
      {entries.map(([name, part]) => (
        <div key={name} className="ett-rule">
          <div className="ett-card-h"><span className="ett-chip">{name}</span></div>
          <SourceAllowedEditor t={t} part={part}
            onChange={(next) => { onChange({ ...sources, [name]: next }) }} />
          <SourceAdmissionEditor t={t} part={part}
            onChange={(next) => { onChange({ ...sources, [name]: next }) }} />
          <div className="ett-row">
            <button type="button" className="ett-btn ett-btn-quiet" onClick={() => {
              const next = { ...sources }
              delete next[name]
              onChange(next)
            }}>{t('common.delete')}</button>
          </div>
        </div>
      ))}
      <div className="ett-row">
        <input className="ett-input" value={newName} placeholder={t('sources.name')}
          onChange={event => { setNewName(event.target.value) }} />
        <button type="button" className="ett-btn" onClick={() => {
          const name = newName.trim()
          if (name === '') return
          onChange({ ...sources, [name]: { allowed: [], admission: {} } })
          setNewName('')
        }}>{t('sources.addSource')}</button>
      </div>
    </section>
  )
}

// ── 来源实例卡 ────────────────────────────────────────────────────────────

function InstancesCard({ t, sources, configText, configErrors, onConfigChange, onChange }: {
  readonly t: (key: string) => string
  readonly sources: TasksSettings['sources']
  readonly configText: Record<string, string>
  readonly configErrors: Record<string, string>
  readonly onConfigChange: (name: string, text: string) => void
  readonly onChange: (next: TasksSettings['sources']) => void
}): ReactElement {
  const [newName, setNewName] = useState('')
  const entries = Object.entries(sources).sort(([left], [right]) => left.localeCompare(right))
  return (
    <section className="ett-card" aria-label={t('instances.title')}>
      <div className="ett-card-h"><Icon name="flow" size={16} /><h3>{t('instances.title')}</h3></div>
      {entries.length === 0 && <p className="ett-sub">{t('instances.empty')}</p>}
      {entries.map(([name, instance]) => (
        <div key={name} className="ett-rule">
          <div className="ett-card-h">
            <span className="ett-chip">{name}</span>
            <label className="ett-check">
              <input type="checkbox" checked={instance.enabled}
                onChange={event => { onChange({ ...sources, [name]: { ...instance, enabled: event.target.checked } }) }} />
              {t('instances.enabled')}
            </label>
          </div>
          <label className="ett-field"><span>{t('instances.config')}</span>
            <textarea className="ett-textarea" value={configText[name] ?? '{}'}
              data-eterna-tasks-config-error={configErrors[name] !== undefined ? 'true' : undefined}
              onChange={event => { onConfigChange(name, event.target.value) }} />
          </label>
          {configErrors[name] !== undefined && <p className="ett-feedback" data-eterna-tasks-tone="error">{configErrors[name]}</p>}
          <div className="ett-row">
            <button type="button" className="ett-btn ett-btn-quiet" onClick={() => {
              const next = { ...sources }
              delete next[name]
              onChange(next)
            }}>{t('instances.remove')}</button>
          </div>
        </div>
      ))}
      <div className="ett-row">
        <input className="ett-input" value={newName} placeholder={t('instances.name')}
          onChange={event => { setNewName(event.target.value) }} />
        <button type="button" className="ett-btn" onClick={() => {
          const name = newName.trim()
          if (name === '') return
          onChange({ ...sources, [name]: { enabled: true, config: {} } })
          onConfigChange(name, '{}')
          setNewName('')
        }}>{t('instances.add')}</button>
      </div>
    </section>
  )
}