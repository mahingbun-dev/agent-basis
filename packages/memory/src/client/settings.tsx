/**
 * 设置弹窗分区「记忆」(settings.section;M-M3 T12-①,19 号 §5-T12.1):
 * 形态照抄 packages/compaction/src/client/index.tsx——只读写 eternaMemory SRC
 * 端点(Host 半边 admin-plugin.ts),不改壳、不加独立页(AGENTS.md 铁律)。
 *
 * 控件面(19 号 §5-T12.1 原文口径):
 * - 开关:画像 / 域识别(总开关=插件启停,在设置弹窗插件分区,本节不重复);
 * - 写入策略档位:仅显式 / 自动+审批(缺省)/ 全自动 → 映射 review 规则;
 * - 蒸馏 opt-out 占位禁用态(全局蒸馏未开放,Q4 决议默认关);
 * - 成本提示常驻文案(整固/域打标用轻量模型)。
 *
 * 交互纪律(AGENTS.md §3):合并保存(脏检查+单按钮);保存防重复点击;错误
 * 就地 aria-live 反馈;禁用原生 confirm/alert。
 */
import { useEffect, useState } from 'react'
import { Icon } from '@eterna/ui/icons'

export const MEMORY_SECTION_ID = 'eterna-memory.settings'
export const MEMORY_STATE_ENDPOINT = 'eternaMemory/state'
export const MEMORY_UPDATE_ENDPOINT = 'eternaMemory/updateConfig'

/** 写入策略档位(T12-① 三档;与 config-bridge MEMORY_WRITE_POLICIES 同真值)。 */
export const MEMORY_POLICY_TIERS = ['explicit-only', 'auto-review', 'full-auto'] as const
export type MemoryPolicyTier = (typeof MEMORY_POLICY_TIERS)[number]

/** 生效配置视图(state 端点 config 段)。 */
export interface MemoryConfigView {
  portraitEnabled: boolean
  domainEnabled: boolean
  writePolicy: string
}

export interface MemoryStateView {
  ok: boolean
  code?: 'forbidden' | 'unauthorized' | 'invalid' | 'unavailable'
  message?: string
  config?: MemoryConfigView
  stats?: { entityCount: number; pendingCount: number; domainCount: number }
}

export interface ConnectionRpc {
  rpc: { call(channel: string, endpoint: string, payload: unknown): Promise<{ ok: boolean; value?: unknown; error?: { code?: string; message?: string } }> }
}

/** 表单待存状态(档位三选;开关布尔)。 */
export interface MemoryPolicyFormState {
  portraitEnabled: boolean
  domainEnabled: boolean
  writePolicy: MemoryPolicyTier
}

/** 合并保存脏检查(AGENTS.md §3):三键逐项比对。 */
export function isMemoryPolicyDirty(loaded: MemoryConfigView, form: MemoryPolicyFormState): boolean {
  if (loaded.portraitEnabled !== form.portraitEnabled) return true
  if (loaded.domainEnabled !== form.domainEnabled) return true
  if (loaded.writePolicy !== form.writePolicy) return true
  return false
}

/** 存量档位防御回退(未知值回落缺省档,UI 不空转)。 */
export function resolvePolicyTier(value: string): MemoryPolicyTier {
  return (MEMORY_POLICY_TIERS as readonly string[]).includes(value)
    ? (value as MemoryPolicyTier)
    : 'auto-review'
}

export const NS = 'eterna-memory'

/** 设置分区文案(zh;en 走键名原样——面板/压缩同款降级口径)。 */
export const SETTINGS_LOCALES = {
  section: '记忆',
  loading: '读取中…',
  needAdmin: '记忆设置为管理员专用,当前账号无权查看。',
  needLogin: '登录已过期,请重新登录。',
  loadFailed: '读取失败',
  statusTitle: '运行状态',
  statEntities: '已生效记忆',
  statPending: '待你审批',
  statDomains: '注册域',
  policyTitle: '写入策略',
  policyDesc: '决定 Agent 学到的东西何时生效:改动立即生效并持久化;待审记忆在基座面板逐条批/拒。',
  fieldPortrait: '用户画像',
  fieldPortraitHint: '从对话中沉淀稳定偏好,注入会话开场(可在面板画像卡逐条纠正)。',
  fieldDomain: '域识别',
  fieldDomainHint: '按会话内容自动识别功能域,记忆按域归档;关闭后索引不再注入域分区。',
  fieldPolicy: '写入策略档位',
  tierExplicitOnly: '仅显式(最稳)',
  tierExplicitOnlyHint: '只有你明确说「记住…」的记忆立即生效,其余一律待你审批',
  tierAutoReview: '自动+审批(推荐)',
  tierAutoReviewHint: '会话记录自动生效;事实与做法先待你审批,批准后长期生效',
  tierFullAuto: '全自动',
  tierFullAutoHint: '不再产生待审;只有摘要压缩来源仍强制待审(安全底线)',
  fieldDistill: '参与全局蒸馏',
  distillDisabledHint: '全局蒸馏尚未开放;当前你的记忆不参与任何跨用户数据聚合(Q4 默认关)',
  costNote: '成本提示:记忆整固与域识别会在会话结束时调用轻量模型,每次约数百 token。',
  save: '保存策略',
  saving: '保存中…',
  saved: '已保存,立即生效',
  unchanged: '策略未改动',
  saveFailed: '保存失败',
} as const

export type MemorySettingsLocaleKey = keyof typeof SETTINGS_LOCALES

const CSS_SETTINGS = `
[data-eterna-memory-settings] { color: var(--et-fg); font-family: var(--et-font-body); font-size: var(--et-text-body); line-height: var(--et-leading-body); }
[data-eterna-memory-settings] * { box-sizing: border-box; min-width: 0; }
[data-eterna-memory-settings] .em-cards { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: var(--et-space-3); margin: 0 0 var(--et-space-3); }
[data-eterna-memory-settings] .em-card { padding: var(--et-space-4); border: 1px solid var(--et-border-soft); border-radius: var(--et-radius-md); background: var(--et-surface); }
[data-eterna-memory-settings] .em-kicker { font-size: var(--et-text-micro); color: var(--et-muted); margin: 0 0 6px; }
[data-eterna-memory-settings] .em-value { font-size: var(--et-text-lead); line-height: 1.2; font-weight: var(--et-weight-display); font-variant-numeric: tabular-nums; white-space: nowrap; }
[data-eterna-memory-settings] .em-form { display: grid; gap: var(--et-space-4); padding: var(--et-space-4); border: 1px solid var(--et-border-soft); border-radius: var(--et-radius-md); background: var(--et-surface); max-width: 560px; }
[data-eterna-memory-settings] .em-field { display: grid; gap: 6px; }
[data-eterna-memory-settings] .em-label { font-size: var(--et-text-caption); font-weight: var(--et-weight-display); color: var(--et-fg-2); }
[data-eterna-memory-settings] .em-hint { font-size: var(--et-text-micro); color: var(--et-muted); }
[data-eterna-memory-settings] .em-radio { display: flex; align-items: baseline; gap: 8px; font-size: var(--et-text-caption); color: var(--et-fg-2); cursor: pointer; }
[data-eterna-memory-settings] .em-radio input[type='radio'] { width: 16px; height: 16px; margin: 0; flex: none; align-self: center; accent-color: var(--et-accent); }
[data-eterna-memory-settings] .em-radio input[type='radio']:focus-visible { outline: 2px solid var(--et-accent); outline-offset: 2px; }
[data-eterna-memory-settings] .em-check { display: flex; align-items: center; gap: 8px; }
[data-eterna-memory-settings] .em-check input[type='checkbox'] { width: 16px; height: 16px; accent-color: var(--et-accent); }
[data-eterna-memory-settings] .em-check input[type='checkbox']:focus-visible { outline: 2px solid var(--et-accent); outline-offset: 2px; }
[data-eterna-memory-settings] .em-check-disabled { display: flex; align-items: center; gap: 8px; opacity: 0.55; }
[data-eterna-memory-settings] .em-actions { display: flex; align-items: center; gap: var(--et-space-3); flex-wrap: wrap; }
[data-eterna-memory-settings] .em-save { display: inline-flex; align-items: center; gap: 6px; padding: 8px 14px; border: 1px solid var(--et-accent); border-radius: var(--et-radius-sm); background: var(--et-accent); color: var(--et-fg); font: inherit; font-weight: var(--et-weight-display); cursor: pointer; }
[data-eterna-memory-settings] .em-save:focus-visible { outline: 2px solid var(--et-accent); outline-offset: 2px; }
[data-eterna-memory-settings] .em-save:disabled { opacity: 0.55; cursor: not-allowed; }
[data-eterna-memory-settings] .em-note { font-size: var(--et-text-caption); color: var(--et-muted); }
[data-eterna-memory-settings] .em-note[data-ok='true'] { color: var(--et-fg-2); }
[data-eterna-memory-settings] .em-note[data-ok='false'] { color: var(--et-danger); }
[data-eterna-memory-settings] .em-cost { display: flex; align-items: center; gap: 6px; padding-top: var(--et-space-3); border-top: 1px dashed var(--et-border-soft); font-size: var(--et-text-micro); color: var(--et-muted); }
[data-eterna-memory-settings] .em-empty { padding: var(--et-space-5) 0; color: var(--et-muted); }
[data-eterna-memory-settings] .em-head { display: flex; align-items: center; gap: 8px; margin: 0 0 var(--et-space-3); }
[data-eterna-memory-settings] .em-head h3 { margin: 0; font-size: var(--et-text-lead); font-weight: var(--et-weight-display); }
@media (max-width: 760px) { [data-eterna-memory-settings] .em-cards { grid-template-columns: 1fr 1fr; } }
@media (max-width: 640px) { [data-eterna-memory-settings] .em-cards { grid-template-columns: 1fr; } }
@media (prefers-reduced-motion: reduce) { [data-eterna-memory-settings] * { animation: none !important; transition: none !important; } }
`
export { CSS_SETTINGS as CSS }

function fmtInt(n: number): string {
  return n.toLocaleString('zh-CN')
}

function formStateOf(config: MemoryConfigView): MemoryPolicyFormState {
  return {
    portraitEnabled: config.portraitEnabled,
    domainEnabled: config.domainEnabled,
    writePolicy: resolvePolicyTier(config.writePolicy),
  }
}

export interface MemorySettingsSectionProps {
  readonly t: (key: string) => string
  readonly connection: ConnectionRpc
}

/** 设置分区「记忆」(settings.section 的 occupant)。 */
export function MemorySettingsSection(props: MemorySettingsSectionProps): React.JSX.Element {
  const { t, connection } = props
  const [state, setState] = useState<MemoryStateView | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [portraitEnabled, setPortraitEnabled] = useState(true)
  const [domainEnabled, setDomainEnabled] = useState(true)
  const [writePolicy, setWritePolicy] = useState<MemoryPolicyTier>('auto-review')
  const [saving, setSaving] = useState(false)
  const [feedback, setFeedback] = useState<{ ok: boolean | null; text: string }>({ ok: null, text: '' })

  useEffect(() => {
    let alive = true
    connection.rpc.call('/api', MEMORY_STATE_ENDPOINT, { args: {} }).then(result => {
      if (!alive) return
      if (result.ok && typeof result.value === 'object' && result.value !== null) {
        const value = result.value as MemoryStateView
        setState(value)
        if (value.ok && value.config !== undefined) {
          const form = formStateOf(value.config)
          setPortraitEnabled(form.portraitEnabled)
          setDomainEnabled(form.domainEnabled)
          setWritePolicy(form.writePolicy)
        }
      } else {
        setLoadError(result.error?.message ?? t('loadFailed'))
      }
    }).catch((error: unknown) => {
      if (alive) setLoadError(error instanceof Error ? error.message : t('loadFailed'))
    })
    return () => { alive = false }
  }, [connection, t])

  const loaded = state?.ok === true && state.config !== undefined ? state.config : null
  const dirty = loaded !== null && isMemoryPolicyDirty(loaded, { portraitEnabled, domainEnabled, writePolicy })

  const save = async (): Promise<void> => {
    if (!dirty || saving) return
    setSaving(true)
    setFeedback({ ok: null, text: '' })
    try {
      const result = await connection.rpc.call('/api', MEMORY_UPDATE_ENDPOINT, {
        args: { payload: { portraitEnabled, domainEnabled, writePolicy } },
      })
      if (result.ok && typeof result.value === 'object' && result.value !== null) {
        const value = result.value as MemoryStateView
        if (value.ok && value.config !== undefined) {
          setState(value)
          const form = formStateOf(value.config)
          setPortraitEnabled(form.portraitEnabled)
          setDomainEnabled(form.domainEnabled)
          setWritePolicy(form.writePolicy)
          setFeedback({ ok: true, text: t('saved') })
        } else {
          setFeedback({ ok: false, text: value.message ?? t('saveFailed') })
        }
      } else {
        setFeedback({ ok: false, text: result.error?.message ?? t('saveFailed') })
      }
    } catch (error: unknown) {
      setFeedback({ ok: false, text: error instanceof Error ? error.message : t('saveFailed') })
    } finally {
      setSaving(false)
    }
  }

  if (loadError !== null) {
    return <div data-eterna-memory-settings><div className="em-empty">{t('loadFailed')}:{loadError}</div></div>
  }
  if (state === null) {
    return <div data-eterna-memory-settings><div className="em-empty">{t('loading')}</div></div>
  }
  if (!state.ok) {
    const text = state.code === 'unauthorized'
      ? t('needLogin')
      : state.code === 'forbidden' ? t('needAdmin') : `${t('loadFailed')}:${state.message ?? ''}`
    return <div data-eterna-memory-settings><div className="em-empty">{text}</div></div>
  }
  const stats = state.stats
  const tierHintKey = `tier${writePolicy === 'explicit-only' ? 'ExplicitOnly' : writePolicy === 'full-auto' ? 'FullAuto' : 'AutoReview'}Hint`
  return (
    <div data-eterna-memory-settings>
      <div className="em-head"><Icon name="memory" size={16} /><h3>{t('statusTitle')}</h3></div>
      <div className="em-cards">
        <div className="em-card" data-eterna-memory-stat="entities">
          <div className="em-kicker">{t('statEntities')}</div>
          <div className="em-value">{stats === undefined ? '—' : fmtInt(stats.entityCount)}</div>
        </div>
        <div className="em-card" data-eterna-memory-stat="pending">
          <div className="em-kicker">{t('statPending')}</div>
          <div className="em-value">{stats === undefined ? '—' : fmtInt(stats.pendingCount)}</div>
        </div>
        <div className="em-card" data-eterna-memory-stat="domains">
          <div className="em-kicker">{t('statDomains')}</div>
          <div className="em-value">{stats === undefined ? '—' : fmtInt(stats.domainCount)}</div>
        </div>
      </div>
      <div className="em-head"><h3>{t('policyTitle')}</h3></div>
      <p className="em-note" style={{ margin: '0 0 var(--et-space-3)' }}>{t('policyDesc')}</p>
      <form className="em-form" onSubmit={event => { event.preventDefault() }}>
        <div className="em-field">
          <span className="em-check">
            <input id="em-portrait" type="checkbox" checked={portraitEnabled}
              onChange={event => { setPortraitEnabled(event.target.checked) }} />
            <label className="em-label" htmlFor="em-portrait">{t('fieldPortrait')}</label>
          </span>
          <span className="em-hint">{t('fieldPortraitHint')}</span>
        </div>
        <div className="em-field">
          <span className="em-check">
            <input id="em-domain" type="checkbox" checked={domainEnabled}
              onChange={event => { setDomainEnabled(event.target.checked) }} />
            <label className="em-label" htmlFor="em-domain">{t('fieldDomain')}</label>
          </span>
          <span className="em-hint">{t('fieldDomainHint')}</span>
        </div>
        <div className="em-field" role="radiogroup" aria-labelledby="em-policy-label">
          <span className="em-label" id="em-policy-label">{t('fieldPolicy')}</span>
          {MEMORY_POLICY_TIERS.map(tier => (
            <label className="em-radio" key={tier} htmlFor={`em-policy-${tier}`}>
              <input id={`em-policy-${tier}`} type="radio" name="em-policy"
                checked={writePolicy === tier} onChange={() => { setWritePolicy(tier) }} />
              <span>{t(`tier${tier === 'explicit-only' ? 'ExplicitOnly' : tier === 'full-auto' ? 'FullAuto' : 'AutoReview'}`)}</span>
            </label>
          ))}
          <span className="em-hint">{t(tierHintKey)}</span>
        </div>
        <div className="em-field">
          <span className="em-check-disabled">
            <input id="em-distill" type="checkbox" disabled checked={false} readOnly />
            <label className="em-label" htmlFor="em-distill">{t('fieldDistill')}</label>
          </span>
          <span className="em-hint">{t('distillDisabledHint')}</span>
        </div>
        <div className="em-cost">
          <Icon name="settings" size={12} />
          <span>{t('costNote')}</span>
        </div>
        <div className="em-actions">
          <button type="button" className="em-save" disabled={!dirty || saving}
            onClick={() => { void save() }}>
            <Icon name="check" size={14} />{saving ? t('saving') : t('save')}
          </button>
          <span className="em-note" data-ok={feedback.ok === null ? undefined : String(feedback.ok)} role="status" aria-live="polite">{
            feedback.text !== '' ? feedback.text : !dirty && loaded !== null ? t('unchanged') : ''
          }</span>
        </div>
      </form>
    </div>
  )
}
