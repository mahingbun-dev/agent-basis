/**
 * admin「全局」MCP 编辑器(上游 mcp-manager 命名空间)。
 *
 * 写面走官方 `configForms.get('mcp-manager')`(settings 域同一写队列与 revision
 * 栅栏),不碰部署文件:新增/编辑写整条 entry,启停只写 enabled,删除/恢复走
 * unset。部署层(base)条目不能删除,只能停用;存在用户覆盖时可「恢复部署配置」。
 * 密钥一律提示 `${credential:名称}` 模板,本界面不收集明文。
 */
import { useCallback, useEffect, useState } from 'react'
import { Icon } from '@eterna/ui/icons'
import { ArmedDelete } from './confirm-button.tsx'
import type { Translate } from './i18n.ts'
import { Switch } from './switch.tsx'
import {
  MCP_GLOBAL_NAME_PATTERN,
  draftOfGlobal,
  draftOfGlobalNew,
  globalDraftIssue,
  globalIssueMessageKey,
  globalSaveOps,
  globalToggleOps,
  globalUnsetOps,
  hasBaseServer,
  hasUserServer,
  transportLabelKey,
  type McpConfigForms,
  type McpGlobalDraft,
  type McpGlobalEntry,
  type McpGlobalForm,
  type McpGlobalOp,
  type McpGlobalSnapshot,
  type McpKeyValueDraft,
} from './mcp-servers-model.ts'

export interface GlobalPanelProps {
  readonly t: Translate
  readonly configForms?: McpConfigForms | undefined
}

interface Message {
  readonly ok: boolean
  readonly text: string
}

/** admin「全局」:真实编辑器(列表 + 内联表单 + 启停 + 删除/恢复)。 */
export function GlobalPanel(props: GlobalPanelProps): React.JSX.Element {
  const { t, configForms } = props
  const [form, setForm] = useState<McpGlobalForm | undefined>(undefined)
  const [snapshot, setSnapshot] = useState<McpGlobalSnapshot | undefined>(undefined)
  const [draft, setDraft] = useState<McpGlobalDraft | null>(null)
  const [message, setMessage] = useState<Message | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (configForms === undefined) return
    let dispose: (() => void) | undefined
    try {
      const next = configForms.get('mcp-manager')
      setForm(next)
      setSnapshot(next.getSnapshot())
      dispose = next.subscribe(() => { setSnapshot(next.getSnapshot()) })
    } catch {
      setForm(undefined)
    }
    return () => { dispose?.() }
  }, [configForms])

  const write = useCallback(async (
    ops: readonly McpGlobalOp[],
    successKey: string,
    after?: () => void,
  ): Promise<boolean> => {
    if (form === undefined) return false
    const current = form.getSnapshot()
    setBusy(true)
    setMessage(null)
    try {
      const accepted = await form.mutate(ops, current.revision)
      if (accepted) {
        setMessage({ ok: true, text: t(successKey) })
        after?.()
      } else {
        setMessage({ ok: false, text: t('mcp.globalWriteRefused') })
      }
      return accepted
    } catch (error) {
      setMessage({ ok: false, text: error instanceof Error ? error.message : t('mcp.actionFailed') })
      return false
    } finally {
      setBusy(false)
    }
  }, [form, t])

  const servers: Readonly<Record<string, McpGlobalEntry>> = snapshot?.value?.servers ?? {}
  const names = Object.keys(servers)
  const writable = snapshot?.writable === true && busy === false

  const save = async (): Promise<void> => {
    if (draft === null) return
    const issue = globalDraftIssue(draft)
    if (issue !== undefined) {
      setMessage({ ok: false, text: t(globalIssueMessageKey(issue)) })
      return
    }
    const name = draft.name.trim()
    if (draft.existing === null && Object.prototype.hasOwnProperty.call(servers, name)) {
      setMessage({ ok: false, text: t('mcp.globalNameTaken') })
      return
    }
    const original = draft.existing === null ? undefined : servers[draft.existing]
    await write(globalSaveOps(draft, original), draft.existing === null ? 'mcp.globalAdded' : 'mcp.saved', () => { setDraft(null) })
  }

  const toggle = (name: string, entry: McpGlobalEntry): void => {
    void write(globalToggleOps(name, !entry.enabled), entry.enabled ? 'mcp.globalDisabled' : 'mcp.globalEnabled')
  }

  const remove = (name: string): void => {
    void write(globalUnsetOps(name), 'mcp.globalRemoved', () => { setDraft(null) })
  }

  if (configForms === undefined || snapshot === undefined || snapshot.status === 'loading') {
    return <div className="ea-card ea-card-wide"><p className="ea-hint">{t('mcp.loading')}</p></div>
  }
  if (snapshot.status === 'unavailable') {
    return <div className="ea-card ea-card-wide">
      <h4 className="ea-mcp-card-title">{t('mcp.globalTitle')}</h4>
      <p className="ea-hint">{t('mcp.globalUnavailable')}</p>
    </div>
  }

  return <div data-eterna-mcp-global>
    <section className="ea-group">
      <div className="ea-group-head">
        <h3 className="ea-group-title">{t('mcp.globalTitle')}</h3>
        <span className="ea-group-hint">{t('mcp.globalHint')}</span>
      </div>
      {!snapshot.writable && <p className="ea-hint" role="status">{t('mcp.globalReadonly')}</p>}
      {names.length === 0
        ? <p className="ea-hint">{t('mcp.globalEmpty')}</p>
        : <ul className="ea-cards">
          {names.map(name => {
            const entry = servers[name]
            if (entry === undefined) return null
            const fromDeploy = hasBaseServer(snapshot.base, name)
            const overridden = hasUserServer(snapshot.user, name)
            const source = fromDeploy
              ? (overridden ? t('mcp.globalOverridden') : t('mcp.globalFromDeploy'))
              : t('mcp.globalCustom')
            return <li className="ea-pcard ea-act" key={name} data-eterna-mcp-global-entry={name}>
              <div className="ea-phead">
                <span className="ea-picon" aria-hidden="true"><Icon name="flow" size={20} /></span>
                <div className="ea-pmain">
                  <div className="ea-ptitle-row">
                    <span className="ea-ptitle">{name}</span>
                    <span className="ea-pill neutral">{t(transportLabelKey(entry.transport))}</span>
                    <span className={entry.enabled ? 'ea-pill' : 'ea-pill neutral'}>
                      {entry.enabled ? t('mcp.enabled') : t('mcp.disabled')}
                    </span>
                    <span className="ea-pill neutral">{source}</span>
                  </div>
                  <span className="ea-pdesc">{globalEntrySummary(entry)}</span>
                </div>
                <div className="ea-pend">
                  <Switch checked={entry.enabled} disabled={!snapshot.writable || busy}
                    label={(entry.enabled ? t('mcp.disableAria') : t('mcp.enableAria')).replace('{name}', name)}
                    onToggle={() => { toggle(name, entry) }} />
                  <button type="button" className="ea-btn ghost" disabled={!snapshot.writable || busy}
                    onClick={() => { setMessage(null); setDraft(draftOfGlobal(name, entry)) }}>{t('mcp.edit')}</button>
                </div>
              </div>
            </li>
          })}
        </ul>}
      <div className="ea-row" style={{ marginTop: 'var(--et-space-3)' }}>
        <button type="button" className="ea-btn" disabled={!writable || draft !== null}
          onClick={() => { setMessage(null); setDraft(draftOfGlobalNew()) }}>
          <Icon name="plus" size={16} />{t('mcp.globalAdd')}
        </button>
      </div>
    </section>
    {message !== null && <p className={message.ok ? 'ea-ok' : 'ea-err'} role="alert">{message.text}</p>}
    {draft !== null && <GlobalForm draft={draft} original={draft.existing === null ? undefined : servers[draft.existing]}
      fromDeploy={draft.existing !== null && hasBaseServer(snapshot.base, draft.existing)}
      overridden={draft.existing !== null && hasUserServer(snapshot.user, draft.existing)}
      busy={busy} t={t} writable={snapshot.writable}
      onChange={setDraft} onCancel={() => { setDraft(null) }}
      onSave={() => { void save() }} onRemove={draft.existing === null ? undefined : () => { remove(draft.existing ?? '') }} />}
  </div>
}

/** 单行技术摘要(截断由卡片 CSS 兜底,这里只控长度)。 */
function globalEntrySummary(entry: McpGlobalEntry): string {
  const endpoint = entry.transport === 'stdio'
    ? [entry.command, ...entry.args].filter(part => part !== '').join(' ')
    : entry.url
  const extras: string[] = []
  const envCount = Object.keys(entry.env).length
  const headerCount = Object.keys(entry.headers).length
  if (envCount > 0) extras.push(`env ×${envCount}`)
  if (headerCount > 0) extras.push(`header ×${headerCount}`)
  const text = `${endpoint}${extras.length === 0 ? '' : ` · ${extras.join(' · ')}`}`
  return text.length > 160 ? `${text.slice(0, 157)}…` : text
}

interface GlobalFormProps {
  readonly draft: McpGlobalDraft
  readonly original: McpGlobalEntry | undefined
  readonly fromDeploy: boolean
  readonly overridden: boolean
  readonly busy: boolean
  readonly writable: boolean
  readonly t: Translate
  readonly onChange: (draft: McpGlobalDraft) => void
  readonly onCancel: () => void
  readonly onSave: () => void
  readonly onRemove: (() => void) | undefined
}

function GlobalForm(props: GlobalFormProps): React.JSX.Element {
  const { draft, original, fromDeploy, overridden, busy, writable, t, onChange, onCancel, onSave, onRemove } = props
  const patch = (value: Partial<McpGlobalDraft>): void => { onChange({ ...draft, ...value }) }
  const patchRow = (field: 'env' | 'headers', index: number, value: Partial<McpKeyValueDraft>): void => {
    const rows = draft[field].map((row, rowIndex) => rowIndex === index ? { ...row, ...value } : row)
    if (field === 'env') onChange({ ...draft, env: rows })
    else onChange({ ...draft, headers: rows })
  }
  const addRow = (field: 'env' | 'headers'): void => {
    const rows = [...draft[field], { name: '', value: '' }]
    if (field === 'env') onChange({ ...draft, env: rows })
    else onChange({ ...draft, headers: rows })
  }
  const removeRow = (field: 'env' | 'headers', index: number): void => {
    const rows = draft[field].filter((_, rowIndex) => rowIndex !== index)
    if (field === 'env') onChange({ ...draft, env: rows })
    else onChange({ ...draft, headers: rows })
  }
  const stdio = draft.transport === 'stdio'
  return <form className="ea-mcp-form" data-eterna-mcp-global-form onSubmit={(event) => { event.preventDefault(); onSave() }}>
    <h4 className="ea-mcp-card-title">{draft.existing === null ? t('mcp.globalAddTitle') : t('mcp.globalEditTitle')}</h4>
    <div className="ea-mcp-fields">
      <div className="ea-mcp-field">
        <label className="ea-label" htmlFor="ea-mcp-global-name">{t('mcp.globalName')}</label>
        <input id="ea-mcp-global-name" className="ea-input" value={draft.name} disabled={draft.existing !== null}
          maxLength={32} placeholder={t('mcp.globalNamePlaceholder')}
          onChange={(event) => { patch({ name: event.target.value }) }} />
        <span className="ea-hint">{t('mcp.globalNameHint')}</span>
      </div>
      <div className="ea-mcp-field">
        <label className="ea-label" htmlFor="ea-mcp-global-transport">{t('mcp.transport')}</label>
        <select id="ea-mcp-global-transport" className="ea-input" value={draft.transport}
          onChange={(event) => { patch({ transport: event.target.value as McpGlobalDraft['transport'] }) }}>
          <option value="stdio">{t('mcp.transportStdio')}</option>
          <option value="streamable-http">{t('mcp.transportHttp')}</option>
        </select>
      </div>
    </div>
    {stdio ? <>
      <div className="ea-mcp-field">
        <label className="ea-label" htmlFor="ea-mcp-global-command">{t('mcp.globalCommand')}</label>
        <input id="ea-mcp-global-command" className="ea-input" value={draft.command}
          placeholder="npx" onChange={(event) => { patch({ command: event.target.value }) }} />
      </div>
      <div className="ea-mcp-field">
        <label className="ea-label" htmlFor="ea-mcp-global-args">{t('mcp.globalArgs')}</label>
        <textarea id="ea-mcp-global-args" className="ea-input ea-mcp-args" rows={3} value={draft.args}
          placeholder={t('mcp.globalArgsPlaceholder')} onChange={(event) => { patch({ args: event.target.value }) }} />
      </div>
      <div className="ea-mcp-field">
        <label className="ea-label" htmlFor="ea-mcp-global-cwd">{t('mcp.globalCwd')}</label>
        <input id="ea-mcp-global-cwd" className="ea-input" value={draft.cwd}
          placeholder={t('mcp.globalCwdPlaceholder')} onChange={(event) => { patch({ cwd: event.target.value }) }} />
      </div>
      <fieldset className="ea-mcp-fieldset">
        <legend className="ea-label">{t('mcp.globalEnv')}</legend>
        <p className="ea-hint" style={{ margin: '0 0 var(--et-space-2)' }}>{t('mcp.globalValueHint')}</p>
        {draft.env.map((row, index) => <div className="ea-mcp-header-row" key={index}>
          <input className="ea-input" aria-label={t('mcp.globalEnvName')} placeholder={t('mcp.globalEnvName')}
            value={row.name} onChange={(event) => { patchRow('env', index, { name: event.target.value }) }} />
          <input className="ea-input" aria-label={t('mcp.globalEnvValue')} placeholder={t('mcp.globalEnvValue')}
            value={row.value} onChange={(event) => { patchRow('env', index, { value: event.target.value }) }} />
          <button type="button" className="ea-btn ghost" aria-label={`${t('mcp.globalRowRemove')} ${row.name}`}
            onClick={() => { removeRow('env', index) }}>
            <Icon name="trash" size={16} />{t('mcp.globalRowRemove')}
          </button>
        </div>)}
        <button type="button" className="ea-btn ghost" onClick={() => { addRow('env') }}>
          <Icon name="plus" size={16} />{t('mcp.globalEnvAdd')}
        </button>
      </fieldset>
    </> : <>
      <div className="ea-mcp-field">
        <label className="ea-label" htmlFor="ea-mcp-global-url">{t('mcp.url')}</label>
        <input id="ea-mcp-global-url" className="ea-input" inputMode="url" value={draft.url}
          placeholder={t('mcp.urlPlaceholder')} onChange={(event) => { patch({ url: event.target.value }) }} />
      </div>
      <fieldset className="ea-mcp-fieldset">
        <legend className="ea-label">{t('mcp.headers')}</legend>
        <p className="ea-hint" style={{ margin: '0 0 var(--et-space-2)' }}>{t('mcp.globalValueHint')}</p>
        {draft.headers.map((row, index) => <div className="ea-mcp-header-row" key={index}>
          <input className="ea-input" aria-label={t('mcp.headerName')} placeholder={t('mcp.headerName')}
            value={row.name} onChange={(event) => { patchRow('headers', index, { name: event.target.value }) }} />
          <input className="ea-input" aria-label={t('mcp.globalHeaderValue')} placeholder={t('mcp.globalHeaderValue')}
            value={row.value} onChange={(event) => { patchRow('headers', index, { value: event.target.value }) }} />
          <button type="button" className="ea-btn ghost" aria-label={`${t('mcp.globalRowRemove')} ${row.name}`}
            onClick={() => { removeRow('headers', index) }}>
            <Icon name="trash" size={16} />{t('mcp.globalRowRemove')}
          </button>
        </div>)}
        <button type="button" className="ea-btn ghost" onClick={() => { addRow('headers') }}>
          <Icon name="plus" size={16} />{t('mcp.headerAdd')}
        </button>
      </fieldset>
    </>}
    {original !== undefined && <p className="ea-hint">{t('mcp.globalAdvancedKept')}</p>}
    {fromDeploy && !overridden && <p className="ea-hint">{t('mcp.globalDeployOnly')}</p>}
    <div className="ea-mcp-form-actions">
      <button type="submit" className="ea-btn" disabled={busy || !writable}>{busy ? t('mcp.saving') : t('mcp.save')}</button>
      <button type="button" className="ea-btn ghost" disabled={busy} onClick={onCancel}>{t('mcp.cancel')}</button>
      {onRemove !== undefined && !(fromDeploy && !overridden) && <ArmedDelete busy={busy}
        label={fromDeploy ? t('mcp.globalRestore') : t('mcp.delete')}
        confirmLabel={fromDeploy ? t('mcp.globalRestoreConfirm') : t('mcp.deleteConfirm')}
        onConfirm={onRemove} />}
    </div>
  </form>
}

/** 测试/类型面:名称校验必须与上游 mcp-client 一致。 */
export const GLOBAL_NAME_PATTERN = MCP_GLOBAL_NAME_PATTERN