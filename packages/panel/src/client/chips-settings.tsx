/**
 * 设置分区「流程启动条」(settings.section 席位,2026-11-20):对话框触发条的
 * 每用户管理面——增删改排序、逐条启停、总开关、内置模板导入、清空。
 *
 * 交互纪律(v4):资料类字段**合并保存**(全部编辑暂存本地态,脏检查 + 单保存
 * 钮,CAS revision 防并发互踩);删除/清空**两击确认**(禁原生 confirm);
 * 行内展开编辑,无弹层无新增叠层。数据面经 access 守卫(/api/eternaPanel/chips
 * |chipsSave)按 cookie 身份落到本人用户根,保存成功调 refreshChips() 同步
 * composer 触发条。
 *
 * DOM 全部带 data-eterna-panel='chipcfg*' 结构化锚点(E2E 严断言定位);
 * 样式见 styles.ts CHIPS_SETTINGS_CSS(--et-* 令牌,无字面色值)。
 */
import { useEffect, useState, type ReactElement } from 'react'
import { Icon } from '@eterna/ui/icons'
import { CHIP_LIMITS, DEFAULT_CHIPS_CONFIG, parseChipsConfig, type ChipsConfig, type ChipsSaveOutcome } from '../chips.ts'
import { BUILTIN_CHIP_TEMPLATES } from '../prompts.ts'
import {
  chipsDirty, draftToChip, draftsFromConfig, firstDraftIssue, genChipId, type ChipDraft,
} from './chips-model.ts'
import type { ConnectionFace } from './client-types.ts'
import { CHIPS_ENDPOINT, CHIPS_SAVE_ENDPOINT } from './index.ts'

/** 设置分区 props(inject 面注入;宿主另传 close,本分区不消费)。 */
export interface ChipsSettingsSectionProps {
  readonly t: (key: string) => string
  readonly connection: ConnectionFace
  /** 保存成功后同步 composer 触发条(apply() 注入)。 */
  readonly refreshChips?: () => void
}

/** 开关(button role=switch;access plugins-manager 同式,触达 ≥36px)。 */
function ToggleSwitch(props: {
  readonly checked: boolean
  readonly label: string
  readonly onChange: (next: boolean) => void
}): ReactElement {
  const { checked, label, onChange } = props
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      data-eterna-panel="chipcfg-switch"
      data-checked={checked || undefined}
      onClick={() => { onChange(!checked) }}
    >
      <span data-eterna-panel="chipcfg-thumb" />
    </button>
  )
}

/**
 * 两击确认按钮(armed 4s 自动解除,失焦解除;删除/清空用;access
 * confirm-button 语义的本包自含版——客户端半边不跨包 import)。
 */
function TwoClickButton(props: {
  readonly label: string
  readonly confirmLabel: string
  readonly disabled?: boolean
  readonly onConfirm: () => void
}): ReactElement {
  const { label, confirmLabel, disabled, onConfirm } = props
  const [armed, setArmed] = useState(false)
  useEffect(() => {
    if (!armed) return
    const timer = setTimeout(() => { setArmed(false) }, 4000)
    return () => { clearTimeout(timer) }
  }, [armed])
  return (
    <button
      type="button"
      data-eterna-panel="chipcfg-danger"
      data-armed={armed || undefined}
      disabled={disabled === true}
      onBlur={() => { setArmed(false) }}
      onClick={() => {
        if (armed) { setArmed(false); onConfirm() } else { setArmed(true) }
      }}
    >
      {armed ? confirmLabel : label}
    </button>
  )
}

/** 设置分区「流程启动条」(每用户各自一套;初始为空)。 */
export function ChipsSettingsSection(props: ChipsSettingsSectionProps): ReactElement {
  const { t, connection, refreshChips } = props
  const [saved, setSaved] = useState<ChipsConfig | null>(null)
  const [visible, setVisible] = useState(true)
  const [drafts, setDrafts] = useState<readonly ChipDraft[]>([])
  const [loadError, setLoadError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [feedback, setFeedback] = useState<{ ok: boolean | null; text: string }>({ ok: null, text: '' })

  // 载入本人配置(守卫端点;坏值防御性回落默认——与服务端 fail-closed 双保险)。
  useEffect(() => {
    let alive = true
    connection.rpc.call('/api', CHIPS_ENDPOINT, { args: {} }).then(result => {
      if (!alive) return
      if (result.ok && typeof result.value === 'object' && result.value !== null) {
        const config = parseChipsConfig(result.value) ?? DEFAULT_CHIPS_CONFIG
        setSaved(config)
        setVisible(config.visible)
        setDrafts(draftsFromConfig(config))
      } else {
        setLoadError(result.error?.message ?? t('chips.loadError'))
      }
    }).catch((error: unknown) => {
      if (alive) setLoadError(error instanceof Error ? error.message : t('chips.loadError'))
    })
    return () => { alive = false }
  }, [connection, t])

  const dirty = chipsDirty(saved, visible, drafts)
  const issue = firstDraftIssue(drafts)

  const updateDraft = (id: string, patch: Partial<ChipDraft>): void => {
    setDrafts(prev => prev.map(draft => draft.id === id ? { ...draft, ...patch } : draft))
  }
  const moveDraft = (id: string, delta: -1 | 1): void => {
    setDrafts(prev => {
      const index = prev.findIndex(draft => draft.id === id)
      const target = index + delta
      if (index < 0 || target < 0 || target >= prev.length) return prev
      const next = [...prev]
      const row = next[index]
      if (row === undefined) return prev
      next.splice(index, 1)
      next.splice(target, 0, row)
      return next
    })
  }
  const addDraft = (): void => {
    setFeedback({ ok: null, text: '' })
    setDrafts(prev => [...prev, {
      id: genChipId(), title: '', kickoff: '', note: '', enabled: true, editing: true,
    }])
  }
  const importTemplates = (): void => {
    setFeedback({ ok: null, text: '' })
    setDrafts(prev => [...prev, ...BUILTIN_CHIP_TEMPLATES.map(template => ({
      id: genChipId(),
      title: template.title,
      kickoff: template.kickoff,
      note: template.note ?? '',
      enabled: true,
      editing: false,
    }))])
  }

  const save = async (): Promise<void> => {
    if (!dirty || saving || issue !== null) return
    setSaving(true)
    setFeedback({ ok: null, text: '' })
    try {
      const input = {
        revision: saved?.revision ?? 0,
        visible,
        chips: drafts.map(draftToChip),
      }
      const result = await connection.rpc.call('/api', CHIPS_SAVE_ENDPOINT, { args: { input } })
      const value = result.ok && typeof result.value === 'object' && result.value !== null
        ? result.value as ChipsSaveOutcome
        : undefined
      if (result.ok && value?.ok === true && typeof value.config === 'object' && value.config !== null) {
        const config = parseChipsConfig(value.config) ?? DEFAULT_CHIPS_CONFIG
        setSaved(config)
        setVisible(config.visible)
        setDrafts(draftsFromConfig(config))
        setFeedback({ ok: true, text: t('chips.saved') })
        refreshChips?.()
      } else if (result.ok && value?.ok === false && value.code === 'conflict' && typeof value.config === 'object' && value.config !== null) {
        // 并发互踩:载入最新 revision(保存钮随即恢复可用,再按即以本人草稿覆盖
        // 最新版——last-writer-wins,文案如实告知)。
        const config = parseChipsConfig(value.config) ?? DEFAULT_CHIPS_CONFIG
        setSaved(config)
        setFeedback({ ok: false, text: t('chips.conflict') })
      } else {
        const message = value?.ok === false ? value.message : result.error?.message ?? 'unknown'
        setFeedback({ ok: false, text: `${t('chips.error')}:${message}` })
      }
    } catch (error) {
      setFeedback({ ok: false, text: `${t('chips.error')}:${error instanceof Error ? error.message : String(error)}` })
    } finally {
      setSaving(false)
    }
  }

  return (
    <div data-eterna-panel="chipcfg" aria-label={t('chips.section')}>
      <div data-eterna-panel="chipcfg-head">
        <div data-eterna-panel="chipcfg-title-row"><Icon name="settings" size={16} /><h3>{t('chips.section')}</h3></div>
        <p data-eterna-panel="chipcfg-hint">{t('chips.hint')}</p>
      </div>
      {loadError !== null
        ? <p data-eterna-panel="chipcfg-loaderr">{loadError}</p>
        : (
          <>
            <div data-eterna-panel="chipcfg-bar">
              <span data-eterna-panel="chipcfg-visible">
                <ToggleSwitch checked={visible} label={t('chips.visible')} onChange={setVisible} />
                <span data-eterna-panel="chipcfg-vislabel">{t('chips.visible')}</span>
              </span>
              <span data-eterna-panel="chipcfg-gap" />
              <button type="button" data-eterna-panel="chipcfg-btn" onClick={addDraft}>{t('chips.add')}</button>
              <button type="button" data-eterna-panel="chipcfg-btn" onClick={importTemplates}>{t('chips.importTemplates')}</button>
              <TwoClickButton
                label={t('chips.clearAll')}
                confirmLabel={t('chips.clearConfirm')}
                disabled={drafts.length === 0}
                onConfirm={() => { setDrafts([]); setFeedback({ ok: null, text: '' }) }}
              />
            </div>
            {drafts.length === 0
              ? <p data-eterna-panel="chipcfg-empty">{t('chips.empty')}</p>
              : (
                <ol data-eterna-panel="chipcfg-list">
                  {drafts.map((draft, index) => (
                    draft.editing
                      ? (
                        <li key={draft.id} data-eterna-panel="chipcfg-row" data-editing="true">
                          <div data-eterna-panel="chipcfg-edit">
                            <label data-eterna-panel="chipcfg-field">
                              <span data-eterna-panel="chipcfg-flabel">{t('chips.fieldTitle')}</span>
                              <input
                                data-eterna-panel="chipcfg-input"
                                type="text"
                                value={draft.title}
                                maxLength={CHIP_LIMITS.title}
                                placeholder={t('chips.titlePlaceholder')}
                                onChange={event => { updateDraft(draft.id, { title: event.target.value }) }}
                              />
                            </label>
                            <label data-eterna-panel="chipcfg-field">
                              <span data-eterna-panel="chipcfg-flabel">{t('chips.fieldKickoff')}</span>
                              <textarea
                                data-eterna-panel="chipcfg-textarea"
                                rows={3}
                                value={draft.kickoff}
                                maxLength={CHIP_LIMITS.kickoff}
                                placeholder={t('chips.kickoffPlaceholder')}
                                onChange={event => { updateDraft(draft.id, { kickoff: event.target.value }) }}
                              />
                            </label>
                            <label data-eterna-panel="chipcfg-field">
                              <span data-eterna-panel="chipcfg-flabel">{t('chips.fieldNote')}</span>
                              <input
                                data-eterna-panel="chipcfg-input"
                                type="text"
                                value={draft.note}
                                maxLength={CHIP_LIMITS.note}
                                onChange={event => { updateDraft(draft.id, { note: event.target.value }) }}
                              />
                            </label>
                            <div data-eterna-panel="chipcfg-editdone">
                              <button
                                type="button"
                                data-eterna-panel="chipcfg-btn"
                                onClick={() => { updateDraft(draft.id, { editing: false }) }}
                              >
                                {t('chips.done')}
                              </button>
                            </div>
                          </div>
                        </li>
                      )
                      : (
                        <li key={draft.id} data-eterna-panel="chipcfg-row" data-enabled={draft.enabled ? undefined : 'false'}>
                          <ToggleSwitch
                            checked={draft.enabled}
                            label={t('chips.enabled')}
                            onChange={next => { updateDraft(draft.id, { enabled: next }) }}
                          />
                          <div data-eterna-panel="chipcfg-main">
                            <span data-eterna-panel="chipcfg-name">{draft.title.trim() === '' ? t('chips.untitled') : draft.title}</span>
                            <span data-eterna-panel="chipcfg-kickoff">{draft.kickoff}</span>
                            {draft.note.trim() !== '' && <span data-eterna-panel="chipcfg-notetext">{draft.note}</span>}
                          </div>
                          <div data-eterna-panel="chipcfg-ops">
                            <button
                              type="button"
                              data-eterna-panel="chipcfg-op"
                              aria-label={t('chips.up')}
                              disabled={index === 0}
                              onClick={() => { moveDraft(draft.id, -1) }}
                            >
                              {t('chips.up')}
                            </button>
                            <button
                              type="button"
                              data-eterna-panel="chipcfg-op"
                              aria-label={t('chips.down')}
                              disabled={index === drafts.length - 1}
                              onClick={() => { moveDraft(draft.id, 1) }}
                            >
                              {t('chips.down')}
                            </button>
                            <button
                              type="button"
                              data-eterna-panel="chipcfg-op"
                              onClick={() => { updateDraft(draft.id, { editing: true }); setFeedback({ ok: null, text: '' }) }}
                            >
                              {t('chips.edit')}
                            </button>
                            <TwoClickButton
                              label={t('chips.delete')}
                              confirmLabel={t('chips.deleteConfirm')}
                              onConfirm={() => { setDrafts(prev => prev.filter(row => row.id !== draft.id)) }}
                            />
                          </div>
                        </li>
                      )
                  ))}
                </ol>
              )}
            <div data-eterna-panel="chipcfg-actions">
              <button type="button" data-eterna-panel="chipcfg-save" disabled={!dirty || saving || issue !== null} onClick={() => { void save() }}>
                {saving ? t('chips.saving') : t('chips.save')}
              </button>
              {issue !== null && <span data-eterna-panel="chipcfg-issue">{issue}</span>}
              <span
                data-eterna-panel="chipcfg-note"
                role="status"
                aria-live="polite"
                data-ok={feedback.ok === null ? undefined : String(feedback.ok)}
              >{feedback.text}</span>
            </div>
          </>
        )}
    </div>
  )
}
