/**
 * 设置弹窗分区「评测」:裁判模型 / 自动抽样 / 每日预算 / 空闲终评 / 指标启停。
 *
 * 形态纪律(56 号 §5.5-C + frontend-style §7 + AGENTS.md 铁律 1/2/4):
 * - 原生扩展点 = `settings.section` 分区,**不自建独立页面**;
 * - 资料类字段**合并保存**(脏检查 + 单按钮);无详情页/无弹窗;
 * - 变更请求防重复点击(saving 即禁用);破坏性操作没有(无 confirm/alert);
 * - 配置是部署级(全局一份):非管理员**只读**,保存端 403 二次兜底;
 * - 文案全中文;数值输入带显式单位与区间(超出由服务端逐字段拒绝)。
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import type { ReactElement } from 'react'
import { Icon } from '@eterna/ui/icons'
import type { JudgeConfig, JudgeSettingsView } from '../judge-types.ts'
import { SessionEvalApiError, fetchJudgeSettings, saveJudgeConfig } from './api.ts'
import { BusinessMetricsSection } from './BusinessMetricsSection.tsx'
import { CalibrationSection } from './CalibrationSection.tsx'

/** 表单态(数字输入以字符串承载;提交时统一校验). */
interface FormState {
  readonly enabled: boolean
  readonly provider: string
  readonly model: string
  readonly sampling: string
  readonly budget: string
  readonly idleSec: string
  readonly metrics: Readonly<Record<string, boolean>>
}

/** 已保存配置 → 表单. */
function formOf(config: JudgeConfig): FormState {
  return {
    enabled: config.enabled,
    provider: config.route?.provider ?? '',
    model: config.route?.model ?? '',
    sampling: String(config.sampling),
    budget: String(config.budgetTokensPerDay),
    idleSec: String(Math.round(config.idleTimeoutMs / 1000)),
    metrics: { ...config.metrics },
  }
}

/** 表单 → 配置(逐字段校验;首个错误即返回中文原因). */
function configOf(form: FormState, providers: JudgeSettingsView['providers']): { readonly ok: true; readonly config: JudgeConfig } | { readonly ok: false; readonly error: string } {
  const sampling = Number(form.sampling)
  if (!Number.isFinite(sampling) || sampling < 0 || sampling > 1) {
    return { ok: false, error: '采样率必须是 0 到 1 之间的数字。' }
  }
  const budget = Number(form.budget)
  if (!Number.isInteger(budget) || budget < 1_000 || budget > 10_000_000) {
    return { ok: false, error: '每日预算必须是 1000 到 10000000 之间的整数（tokens）。' }
  }
  const idleSec = Number(form.idleSec)
  if (!Number.isInteger(idleSec) || idleSec < 30 || idleSec > 1_800) {
    return { ok: false, error: '空闲终评延迟必须是 30 到 1800 之间的整数（秒）。' }
  }
  let route: JudgeConfig['route'] = null
  if (form.provider !== '' || form.model !== '') {
    if (form.provider === '' || form.model === '') {
      return { ok: false, error: '选择裁判模型时 provider 与 model 必须同时给出。' }
    }
    const provider = providers.find(entry => entry.id === form.provider)
    if (provider !== undefined && provider.models.length > 0 && !provider.models.includes(form.model)) {
      return { ok: false, error: `模型「${form.model}」不在 provider「${form.provider}」的目录中。` }
    }
    route = { provider: form.provider, model: form.model }
  }
  return {
    ok: true,
    config: {
      enabled: form.enabled,
      route,
      sampling,
      budgetTokensPerDay: budget,
      idleTimeoutMs: idleSec * 1000,
      metrics: { ...form.metrics },
    },
  }
}

/** 同一路由的 provider 模型列表. */
function modelsOf(providers: JudgeSettingsView['providers'], provider: string): readonly string[] {
  return providers.find(entry => entry.id === provider)?.models ?? []
}

/** 分区正文。 */
export function EvalSettingsSection(): ReactElement {
  const [settings, setSettings] = useState<JudgeSettingsView | undefined>(undefined)
  const [admin, setAdmin] = useState(false)
  const [phase, setPhase] = useState<'loading' | 'ready' | 'error'>('loading')
  const [errorText, setErrorText] = useState('')
  const [form, setForm] = useState<FormState | undefined>(undefined)
  const [baseline, setBaseline] = useState<FormState | undefined>(undefined)
  const [feedback, setFeedback] = useState('')
  const [saving, setSaving] = useState(false)

  /** 业务指标保存后只重读设置面(不碰下方配置表单,避免抹掉未保存的修改). */
  const refreshBusiness = useCallback((): void => {
    fetchJudgeSettings()
      .then((reply) => {
        setSettings(previous => previous === undefined
          ? previous
          : {
            config: previous.config,
            metrics: previous.metrics,
            providers: previous.providers,
            ...previous.note === undefined ? {} : { note: previous.note },
            ...previous.calibration === undefined ? {} : { calibration: previous.calibration },
            ...reply.settings.business === undefined ? {} : { business: reply.settings.business },
          })
      })
      .catch(() => {
        // 冲突/失败提示由业务指标子区给出;下次打开设置会整份重读。
      })
  }, [])

  const load = useCallback((signal?: AbortSignal): void => {
    fetchJudgeSettings(signal)
      .then((reply) => {
        setSettings(reply.settings)
        setAdmin(reply.admin)
        const next = formOf(reply.settings.config)
        setForm(next)
        setBaseline(next)
        setPhase('ready')
        setErrorText('')
      })
      .catch((error: unknown) => {
        if (error instanceof Error && error.name === 'AbortError') return
        setPhase('error')
        setErrorText(error instanceof SessionEvalApiError && error.status === 503
          ? '评测内核未就绪（插件未装载或仍在启动）。'
          : error instanceof SessionEvalApiError && error.status === 401
            ? '登录状态已失效，请重新登录。'
            : '读取评测设置失败：无法连接服务端。')
      })
  }, [])

  useEffect(() => {
    const controller = new AbortController()
    load(controller.signal)
    return () => { controller.abort() }
  }, [load])

  const dirty = useMemo(() => {
    if (form === undefined || baseline === undefined) return false
    return JSON.stringify(form) !== JSON.stringify(baseline)
  }, [form, baseline])

  const update = useCallback((patch: Partial<FormState>): void => {
    setForm(previous => previous === undefined ? previous : { ...previous, ...patch })
    setFeedback('')
  }, [])

  const onProviderChange = useCallback((provider: string): void => {
    if (form === undefined || settings === undefined) return
    const models = modelsOf(settings.providers, provider)
    // provider 变更时模型默认取目录首项(空 provider = 未配置路由)。
    update({ provider, model: provider === '' ? '' : models[0] ?? '' })
  }, [form, settings, update])

  const save = useCallback((): void => {
    if (form === undefined || settings === undefined || saving) return
    const built = configOf(form, settings.providers)
    if (!built.ok) {
      setFeedback(built.error)
      return
    }
    setSaving(true)
    setFeedback('')
    saveJudgeConfig(built.config)
      .then((saved) => {
        setSettings(previous => previous === undefined ? previous : { ...previous, config: saved })
        const next = formOf(saved)
        setForm(next)
        setBaseline(next)
        setFeedback('已保存：自动评测按新配置生效。')
      })
      .catch((error: unknown) => {
        setFeedback(error instanceof SessionEvalApiError
          ? (error.status === 403 ? '仅管理员可修改评测配置。' : error.message)
          : '保存失败：无法连接服务端。')
      })
      .finally(() => { setSaving(false) })
  }, [form, settings, saving])

  if (phase === 'loading') {
    return <p data-eterna-eval-set="hint" aria-busy="true">正在读取评测设置…</p>
  }
  if (phase === 'error' || settings === undefined || form === undefined) {
    return (
      <div data-eterna-eval-set="section">
        <p data-eterna-eval-set="error" role="alert">{errorText}</p>
        <button type="button" className="et-eval-button" onClick={() => { setPhase('loading'); load() }}>
          <Icon name="replay" size={14} />
          重试
        </button>
      </div>
    )
  }

  const readonly = !admin
  const providers = settings.providers
  const models = modelsOf(providers, form.provider)
  const estimated = (Number(form.sampling) * 3).toFixed(2)
  return (
    <div data-eterna-eval-set="section">
      <p data-eterna-eval-set="hint">
        评测 = 确定性规则（零成本，随事件即时）+ 模型裁判（异步，按下方配置抽样/终评）。评分只在当前会话右栏「评测」显示。
        {readonly ? '当前账号只读（评测配置仅管理员可修改）。' : ''}
      </p>
      {settings.note === undefined ? null : <p data-eterna-eval-set="hint">{settings.note}</p>}

      <fieldset data-eterna-eval-set="group" disabled={readonly}>
        <legend>裁判模型</legend>
        <div data-eterna-eval-set="row">
          <label htmlFor="et-eval-provider">Provider</label>
          <select
            id="et-eval-provider"
            value={form.provider}
            onChange={event => { onProviderChange(event.target.value) }}
          >
            <option value="">未配置（不产生裁判调用）</option>
            {providers.map(entry => <option key={entry.id} value={entry.id}>{entry.id}</option>)}
          </select>
        </div>
        <div data-eterna-eval-set="row">
          <label htmlFor="et-eval-model">模型</label>
          <select
            id="et-eval-model"
            value={form.model}
            disabled={form.provider === '' || models.length === 0}
            onChange={event => { update({ model: event.target.value }) }}
          >
            {models.length === 0 && form.provider !== '' ? <option value="">（目录未枚举，请直接填写）</option> : null}
            {models.map(model => <option key={model} value={model}>{model}</option>)}
          </select>
        </div>
        {form.provider !== '' && models.length === 0 ? (
          <div data-eterna-eval-set="row">
            <label htmlFor="et-eval-model-text">模型（手填）</label>
            <input
              id="et-eval-model-text"
              type="text"
              value={form.model}
              placeholder="模型 id"
              onChange={event => { update({ model: event.target.value.trim() }) }}
            />
          </div>
        ) : null}
      </fieldset>

      <fieldset data-eterna-eval-set="group" disabled={readonly}>
        <legend>触发与预算</legend>
        <div data-eterna-eval-set="row">
          <label htmlFor="et-eval-enabled">自动评测</label>
          <input
            id="et-eval-enabled"
            type="checkbox"
            checked={form.enabled}
            onChange={event => { update({ enabled: event.target.checked }) }}
          />
        </div>
        <div data-eterna-eval-set="row">
          <label htmlFor="et-eval-sampling">轮末抽样率</label>
          <span data-eterna-eval-set="field">
            <input
              id="et-eval-sampling"
              type="number"
              min={0}
              max={1}
              step={0.05}
              value={form.sampling}
              onChange={event => { update({ sampling: event.target.value }) }}
            />
            <span data-eterna-eval-set="unit">{`每轮预计 ${estimated} 次裁判调用（3 项过程指标）`}</span>
          </span>
        </div>
        <div data-eterna-eval-set="row">
          <label htmlFor="et-eval-budget">每日预算</label>
          <span data-eterna-eval-set="field">
            <input
              id="et-eval-budget"
              type="number"
              min={1_000}
              max={10_000_000}
              step={1_000}
              value={form.budget}
              onChange={event => { update({ budget: event.target.value }) }}
            />
            <span data-eterna-eval-set="unit">tokens（裁判自身用量，单列、不混入会话成本）</span>
          </span>
        </div>
        <div data-eterna-eval-set="row">
          <label htmlFor="et-eval-idle">空闲终评</label>
          <span data-eterna-eval-set="field">
            <input
              id="et-eval-idle"
              type="number"
              min={30}
              max={1_800}
              step={10}
              value={form.idleSec}
              onChange={event => { update({ idleSec: event.target.value }) }}
            />
            <span data-eterna-eval-set="unit">秒（轮结束后多久无新输入，整条会话跑结果类裁判）</span>
          </span>
        </div>
        <p data-eterna-eval-set="hint">
          手动「立即评测」不受自动评测开关影响；每日预算对自动与手动调用同时生效。
        </p>
      </fieldset>

      <fieldset data-eterna-eval-set="group" disabled={readonly}>
        <legend>指标启停</legend>
        <ul data-eterna-eval-set="metrics">
          {settings.metrics.map((metric) => {
            const enabled = form.metrics[metric.key] !== false
            return (
              <li key={metric.key} data-eterna-eval-set="metric">
                <label>
                  <input
                    type="checkbox"
                    checked={enabled}
                    onChange={(event) => {
                      update({ metrics: { ...form.metrics, [metric.key]: event.target.checked } })
                    }}
                  />
                  <span>{metric.name}</span>
                </label>
                <span data-eterna-eval-set="badges">
                  <span data-eterna-eval-set="badge">{metric.category === 'outcome' ? '结果类' : '过程类'}</span>
                  <span data-eterna-eval-set="badge">{metric.scope === 'session' ? '整条会话' : '逐轮'}</span>
                  {metric.gating ? <span data-eterna-eval-set="badge" data-tone="accent">关键项</span> : null}
                </span>
              </li>
            )
          })}
        </ul>
      </fieldset>

      <BusinessMetricsSection business={settings.business} onChanged={refreshBusiness} />

      <CalibrationSection {...settings.calibration === undefined ? {} : { calibration: settings.calibration }} />

      <div data-eterna-eval-set="actions">
        <button
          type="button"
          className="et-eval-button"
          onClick={save}
          disabled={readonly || saving || !dirty}
        >
          <Icon name="check" size={14} />
          {saving ? '保存中…' : '保存'}
        </button>
        <button
          type="button"
          className="et-eval-button"
          onClick={() => { if (baseline !== undefined) { setForm(baseline); setFeedback('') } }}
          disabled={saving || !dirty}
        >
          撤销修改
        </button>
        {feedback === '' ? null : <span data-eterna-eval-set="feedback" role="status">{feedback}</span>}
        {dirty && feedback === '' ? <span data-eterna-eval-set="hint">有未保存的修改</span> : null}
      </div>
    </div>
  )
}
