/**
 * 设置分区「MCP 服务器」(T28 / 50 §3.4.4)。
 *
 * - admin: 两个页签——「全局」(说明 + 跳转上游内置插件设置)与「管理员目录」
 *   (只读:stdio 目录项 + HTTP 白名单);
 * - 普通用户: 「我的服务器」——列表 / 新增 / 编辑 / 删除 / 连接测试。
 *
 * 纪律:
 * - 密钥 write-only:视图只有 hasSecret,表单留空 = 保持不变;保存后只显示「已设置」;
 * - 删除走 TwoClickButton(ArmedDelete),不调用原生 confirm();
 * - 全部样式走 ea-* / --et-* 令牌类,断点只用 1100/760/640(本分区用到 760/640);
 * - 每张卡正文 ≤3 行、标题 ≤12 字、动作 ≤2 个(42 号 §3)。
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { Icon } from '@eterna/ui/icons'
import { ArmedDelete } from './confirm-button.tsx'
import type { Translate } from './i18n.ts'
import { GlobalPanel } from './mcp-global-panel.tsx'
import { Switch } from './switch.tsx'
import {
  mcpPersonalApi, rpcFailureMessage,
  type McpCatalogEntry, type McpCatalogView, type McpPersonalItem, type McpTransportValue,
} from './mcp-personal-api.ts'
import {
  MCP_MAX_SERVERS, MCP_NAME_MAX,
  buildToggleRequest, buildUpsertRequest, draftIssue, draftIssueMessageKey, draftOfItem, draftOfNew,
  probeSummary, quotaLabel, tabsForRole, toggleIssueMessageKey, transportLabelKey, withCatalog,
  type McpConfigForms, type McpDraft, type McpHeaderDraft, type McpSectionRole, type McpTab, type McpTabId,
} from './mcp-servers-model.ts'
import { PasswordInput } from './sections.tsx'

export interface McpServersSectionProps {
  readonly role: McpSectionRole
  readonly t: Translate
  /** 设置域基础服务(admin 全局编辑器读 mcp-manager 命名空间)。 */
  readonly configForms?: McpConfigForms | undefined
}

interface Message {
  readonly ok: boolean
  readonly text: string
}

interface ProbeState {
  readonly busy: boolean
  readonly ok: boolean
  readonly text: string
  readonly toolNames: readonly string[]
  readonly truncated: boolean
}

/** 分区外壳:按角色出页签;普通用户只有一个「我的服务器」视图。 */
export function McpServersSection(props: McpServersSectionProps): React.JSX.Element {
  const { role, t, configForms } = props
  const tabs = tabsForRole(role)
  const fallbackTab = tabs[0]?.id ?? 'mine'
  const [selected, setSelected] = useState(fallbackTab)
  const active = tabs.some(tab => tab.id === selected) ? selected : fallbackTab

  return <section className="ea-section" data-eterna-access-root data-eterna-settings-section="mcp-servers">
    <h3>{t('mcp.title')}</h3>
    <p className="ea-hint">{role === 'admin' ? t('mcp.adminHint') : t('mcp.userHint')}</p>
    {tabs.length > 1 && <McpTabBar tabs={tabs} active={active} onSelect={setSelected} t={t} />}
    <div className="ea-mcp-panel" id={`ea-mcp-panel-${active}`} role="tabpanel"
      aria-labelledby={tabs.length > 1 ? `ea-mcp-tab-${active}` : undefined}>
      {active === 'global' && <GlobalPanel t={t} configForms={configForms} />}
      {active === 'catalog' && <CatalogPanel t={t} />}
      {active === 'mine' && <MyServersPanel t={t} />}
    </div>
  </section>
}

/** 页签条(左右方向键 + Home/End;选中项是唯一的 tab stop)。 */
function McpTabBar(props: {
  readonly tabs: readonly McpTab[]
  readonly active: McpTabId
  readonly onSelect: (id: McpTabId) => void
  readonly t: Translate
}): React.JSX.Element {
  const { tabs, active, onSelect, t } = props
  const buttons = useRef<Array<HTMLButtonElement | null>>([])
  const move = (index: number): void => {
    const row = tabs[(index + tabs.length) % tabs.length]
    if (row === undefined) return
    onSelect(row.id)
    buttons.current[(index + tabs.length) % tabs.length]?.focus()
  }
  return <div className="ea-mcp-tabs" role="tablist" aria-label={t('mcp.tabsLabel')}>
    {tabs.map((tab, index) => {
      const selected = tab.id === active
      return <button key={tab.id} ref={element => { buttons.current[index] = element }} id={`ea-mcp-tab-${tab.id}`} type="button" role="tab"
        className="ea-mcp-tab" aria-selected={selected} aria-controls={selected ? `ea-mcp-panel-${tab.id}` : undefined}
        tabIndex={selected ? 0 : -1} data-active={selected ? 'true' : undefined}
        onClick={() => { onSelect(tab.id) }}
        onKeyDown={(event) => {
          if (event.key === 'ArrowRight') { event.preventDefault(); move(index + 1) }
          else if (event.key === 'ArrowLeft') { event.preventDefault(); move(index - 1) }
          else if (event.key === 'Home') { event.preventDefault(); move(0) }
          else if (event.key === 'End') { event.preventDefault(); move(tabs.length - 1) }
        }}>{t(tab.labelKey)}</button>
    })}
  </div>
}

/** admin「管理员目录」:只读 stdio 目录 + HTTP host 白名单(部署配置下发)。 */
function CatalogPanel(props: { readonly t: Translate }): React.JSX.Element {
  const { t } = props
  const [catalog, setCatalog] = useState<McpCatalogView | null>(null)
  const [message, setMessage] = useState<Message | null>(null)
  const [busy, setBusy] = useState(false)

  const load = useCallback((): void => {
    setBusy(true)
    setMessage(null)
    mcpPersonalApi.catalog().then((result) => {
      if (result.ok && result.value !== undefined) setCatalog(result.value)
      else setMessage({ ok: false, text: rpcFailureMessage(result, t('mcp.loadFailed')) })
      setBusy(false)
    }).catch((error: unknown) => {
      setMessage({ ok: false, text: error instanceof Error ? error.message : t('mcp.readFailed') })
      setBusy(false)
    })
  }, [t])
  useEffect(() => { load() }, [load])

  const items: readonly McpCatalogEntry[] = catalog?.items ?? []
  return <div className="ea-card ea-card-wide" data-eterna-mcp-catalog>
    <h4 className="ea-mcp-card-title">{t('mcp.catalogTitle')}</h4>
    <p className="ea-hint" style={{ margin: 'var(--et-space-2) 0 0' }}>{t('mcp.catalogDesc')}</p>
    {message !== null && <p className={message.ok ? 'ea-ok' : 'ea-err'} role="alert">{message.text}</p>}
    {catalog === null && busy && <p className="ea-hint">{t('mcp.loading')}</p>}
    {catalog !== null && items.length === 0 && <p className="ea-hint">{t('mcp.catalogEmpty')}</p>}
    {items.length > 0 && <div className="ea-list">
      {items.map(entry => <div key={entry.name} className="ea-row" data-eterna-mcp-catalog-entry={entry.name}>
        <span className="ea-row-title">{entry.label}</span>
        <code className="ea-mcp-mono">{entry.name} · stdio</code>
        <span className="ea-row-meta">{t('mcp.catalogEnv')}</span>
        <span className="ea-mcp-tags">
          {entry.envNames.length === 0
            ? <span className="ea-row-meta">{t('mcp.catalogNone')}</span>
            : entry.envNames.map(name => <span key={name} className="ea-tag">{name}</span>)}
        </span>
      </div>)}
    </div>}
    {catalog !== null && <div className="ea-row" style={{ marginTop: 'var(--et-space-3)' }}>
      <span className="ea-row-title">{t('mcp.hostWhitelist')}</span>
      <code className="ea-mcp-mono">{catalog.hostWhitelist.length === 0 ? t('mcp.hostAny') : catalog.hostWhitelist.join(' · ')}</code>
      <button type="button" className="ea-btn ghost" disabled={busy} onClick={load}>
        <Icon name="replay" size={16} />{t('mcp.refresh')}
      </button>
    </div>}
    <p className="ea-hint" style={{ margin: 'var(--et-space-3) 0 0' }}>{t('mcp.catalogReadonly')}</p>
  </div>
}

/** 普通用户「我的服务器」:列表 + 内联表单(新增/编辑复用同一草稿)。 */
function MyServersPanel(props: { readonly t: Translate }): React.JSX.Element {
  const { t } = props
  const [items, setItems] = useState<readonly McpPersonalItem[]>([])
  const [limit, setLimit] = useState(MCP_MAX_SERVERS)
  const [catalog, setCatalog] = useState<readonly McpCatalogEntry[]>([])
  const [draft, setDraft] = useState<McpDraft | null>(null)
  const [message, setMessage] = useState<Message | null>(null)
  const [busy, setBusy] = useState(false)
  const [probes, setProbes] = useState<Readonly<Record<string, ProbeState>>>({})

  const refresh = useCallback(async (): Promise<void> => {
    const result = await mcpPersonalApi.list()
    if (result.ok && result.value !== undefined) {
      setItems([...result.value.items])
      setLimit(result.value.limit)
    } else {
      setMessage({ ok: false, text: rpcFailureMessage(result, t('mcp.loadFailed')) })
    }
  }, [t])

  useEffect(() => {
    void (async (): Promise<void> => {
      const category = await mcpPersonalApi.catalog()
      if (category.ok && category.value !== undefined) setCatalog(category.value.items)
      await refresh()
    })()
  }, [refresh])

  const fail = (error: unknown, fallback: string): void => {
    setMessage({ ok: false, text: error instanceof Error ? error.message : fallback })
  }

  const save = async (): Promise<void> => {
    if (draft === null) return
    const issue = draftIssue(draft, catalog)
    if (issue !== undefined) {
      setMessage({ ok: false, text: t(draftIssueMessageKey(issue)) })
      return
    }
    const request = buildUpsertRequest(draft, catalog)
    if (request === undefined) return
    setBusy(true)
    setMessage(null)
    try {
      const result = await mcpPersonalApi.upsert(request)
      if (result.ok && result.value !== undefined) {
        setDraft(null)
        setMessage({ ok: true, text: t('mcp.saved') })
        await refresh()
      } else {
        setMessage({ ok: false, text: rpcFailureMessage(result, t('mcp.saveFailed')) })
      }
    } catch (error) {
      fail(error, t('mcp.saveFailed'))
    } finally {
      setBusy(false)
    }
  }

  const remove = async (item: McpPersonalItem): Promise<void> => {
    setBusy(true)
    setMessage(null)
    try {
      const result = await mcpPersonalApi.remove(item.id)
      if (result.ok) {
        setMessage({ ok: true, text: t('mcp.deleted') })
        setDraft(null)
        await refresh()
      } else {
        setMessage({ ok: false, text: rpcFailureMessage(result, t('mcp.deleteFailed')) })
      }
    } catch (error) {
      fail(error, t('mcp.deleteFailed'))
    } finally {
      setBusy(false)
    }
  }

  const toggle = async (item: McpPersonalItem): Promise<void> => {
    const built = buildToggleRequest(item)
    if (!built.ok) {
      setMessage({ ok: false, text: t(toggleIssueMessageKey(built.issue)) })
      return
    }
    setBusy(true)
    setMessage(null)
    try {
      const result = await mcpPersonalApi.upsert(built.request)
      const value = result.value
      if (result.ok && value !== undefined) {
        setItems(previous => previous.map(row => row.id === item.id ? value.item : row))
      } else {
        setMessage({ ok: false, text: rpcFailureMessage(result, t('mcp.toggleFailed')) })
      }
    } catch (error) {
      fail(error, t('mcp.toggleFailed'))
    } finally {
      setBusy(false)
    }
  }

  const probe = async (item: McpPersonalItem): Promise<void> => {
    setProbes(previous => ({
      ...previous,
      [item.id]: { busy: true, ok: true, text: t('mcp.testing'), toolNames: [], truncated: false },
    }))
    try {
      const result = await mcpPersonalApi.probe(item.id)
      const summary = result.ok && result.value !== undefined
        ? probeSummary(result.value, t)
        : { ok: false, text: rpcFailureMessage(result, t('mcp.actionFailed')) }
      const value = result.value
      setProbes(previous => ({
        ...previous,
        [item.id]: {
          busy: false,
          ok: summary.ok,
          text: summary.text,
          toolNames: value?.toolNames ?? [],
          truncated: value?.truncated === true,
        },
      }))
    } catch (error) {
      setProbes(previous => ({
        ...previous,
        [item.id]: {
          busy: false, ok: false, text: error instanceof Error ? error.message : t('mcp.actionFailed'),
          toolNames: [], truncated: false,
        },
      }))
    }
  }

  const patch = (value: Partial<McpDraft>): void => {
    setDraft(previous => previous === null ? previous : { ...previous, ...value })
  }
  const patchHeader = (index: number, value: Partial<McpHeaderDraft>): void => {
    setDraft(previous => previous === null ? previous : {
      ...previous,
      headers: previous.headers.map((row, rowIndex) => rowIndex === index ? { ...row, ...value } : row),
    })
  }
  const patchEnv = (index: number, value: string): void => {
    setDraft(previous => previous === null ? previous : {
      ...previous,
      env: previous.env.map((row, rowIndex) => rowIndex === index ? { ...row, value } : row),
    })
  }
  const changeTransport = (transport: McpTransportValue): void => {
    setDraft(previous => {
      if (previous === null) return previous
      if (transport === 'stdio') return withCatalog({ ...previous, transport }, catalog[0])
      return { ...previous, transport }
    })
  }
  const changeCatalog = (name: string): void => {
    const entry = catalog.find(row => row.name === name)
    setDraft(previous => previous === null ? previous : withCatalog(previous, entry))
  }

  const spent = items.length
  const atLimit = spent >= limit
  const editingItem = draft === null || draft.id === null ? undefined : items.find(row => row.id === draft.id)
  const editingProbe = editingItem === undefined ? undefined : probes[editingItem.id]
  const form = draft === null ? null : <form className="ea-mcp-form" onSubmit={(event) => { event.preventDefault(); void save() }}>
    <h4 className="ea-mcp-card-title">{draft.id === null ? t('mcp.formAddTitle') : t('mcp.formEditTitle')}</h4>
    <div className="ea-mcp-fields">
      <div className="ea-mcp-field">
        <label className="ea-label" htmlFor="ea-mcp-name">{t('mcp.name')}</label>
        <input id="ea-mcp-name" className="ea-input" maxLength={MCP_NAME_MAX} value={draft.name}
          placeholder={t('mcp.namePlaceholder')} onChange={(event) => { patch({ name: event.target.value }) }} />
      </div>
      <div className="ea-mcp-field">
        <label className="ea-label" htmlFor="ea-mcp-transport">{t('mcp.transport')}</label>
        <select id="ea-mcp-transport" className="ea-input" value={draft.transport}
          onChange={(event) => { changeTransport(event.target.value as McpTransportValue) }}>
          <option value="stdio">{t('mcp.transportStdio')}</option>
          <option value="streamable-http">{t('mcp.transportHttp')}</option>
        </select>
      </div>
    </div>
    {draft.transport === 'stdio' ? <div className="ea-mcp-field">
      <label className="ea-label" htmlFor="ea-mcp-catalog">{t('mcp.catalogPick')}</label>
      {catalog.length === 0
        ? <p className="ea-hint">{t('mcp.catalogPickEmpty')}</p>
        : <select id="ea-mcp-catalog" className="ea-input" value={draft.catalogId}
            onChange={(event) => { changeCatalog(event.target.value) }}>
            {catalog.map(entry => <option key={entry.name} value={entry.name}>{entry.label}</option>)}
          </select>}
      {draft.env.length > 0 && <>
        <p className="ea-hint" style={{ margin: 'var(--et-space-3) 0 var(--et-space-1)' }}>{t('mcp.env')} · {t('mcp.envHint')}</p>
        {draft.env.map((row, index) => <div className="ea-mcp-field" key={row.name}>
          <label className="ea-label" htmlFor={`ea-mcp-env-${index}`}>{row.name}</label>
          <PasswordInput id={`ea-mcp-env-${index}`} autoComplete="off" value={row.value}
            placeholder={draft.hasSecret ? t('mcp.secretKeep') : t('mcp.secretPlaceholder')}
            onChange={(value) => { patchEnv(index, value) }} t={t} />
        </div>)}
      </>}
    </div> : <>
      <div className="ea-mcp-field">
        <label className="ea-label" htmlFor="ea-mcp-url">{t('mcp.url')}</label>
        <input id="ea-mcp-url" className="ea-input" inputMode="url" value={draft.url}
          placeholder={t('mcp.urlPlaceholder')} onChange={(event) => { patch({ url: event.target.value }) }} />
      </div>
      <fieldset className="ea-mcp-fieldset">
        <legend className="ea-label">{t('mcp.headers')}</legend>
        <p className="ea-hint" style={{ margin: '0 0 var(--et-space-2)' }}>{t('mcp.headersHint')}</p>
        {draft.headers.map((row, index) => <div className="ea-mcp-header-row" key={index}>
          <input className="ea-input" aria-label={t('mcp.headerName')} placeholder={t('mcp.headerName')}
            value={row.name} onChange={(event) => { patchHeader(index, { name: event.target.value }) }} />
          <PasswordInput id={`ea-mcp-header-${index}`} autoComplete="off" value={row.value}
            ariaLabel={t('mcp.headerValue')}
            placeholder={draft.hasSecret ? t('mcp.secretKeep') : t('mcp.secretPlaceholder')}
            onChange={(value) => { patchHeader(index, { value }) }} t={t} />
          <button type="button" className="ea-btn ghost" aria-label={`${t('mcp.headerRemove')} ${row.name}`}
            onClick={() => {
              patch({ headers: draft.headers.filter((_, rowIndex) => rowIndex !== index) })
            }}>
            <Icon name="trash" size={16} />{t('mcp.headerRemove')}
          </button>
        </div>)}
        <button type="button" className="ea-btn ghost"
          onClick={() => { patch({ headers: [...draft.headers, { name: '', value: '' }] }) }}>
          <Icon name="plus" size={16} />{t('mcp.headerAdd')}
        </button>
      </fieldset>
    </>}
    {editingItem !== undefined && <div className="ea-mcp-probe">
      <div className="ea-row between">
        <button type="button" className="ea-btn ghost" disabled={busy || editingProbe?.busy === true}
          onClick={() => { void probe(editingItem) }}>
          <Icon name="replay" size={16} />{editingProbe?.busy === true ? t('mcp.testing') : t('mcp.test')}
        </button>
        {editingProbe !== undefined && <span className={editingProbe.ok ? 'ea-ok' : 'ea-err'} role="status">{editingProbe.text}</span>}
      </div>
      {editingProbe !== undefined && editingProbe.toolNames.length > 0 && <div className="ea-chips" data-eterna-mcp-tools>
        {editingProbe.toolNames.map(name => <span key={name} className="ea-tag">{name}</span>)}
        {editingProbe.truncated && <span className="ea-tag neutral">{t('mcp.toolsTruncated')}</span>}
      </div>}
    </div>}
    <div className="ea-mcp-form-actions">
      <button type="submit" className="ea-btn" disabled={busy}>{busy ? t('mcp.saving') : t('mcp.save')}</button>
      <button type="button" className="ea-btn ghost" disabled={busy} onClick={() => { setDraft(null) }}>{t('mcp.cancel')}</button>
      {editingItem !== undefined && <ArmedDelete busy={busy} label={t('mcp.delete')} confirmLabel={t('mcp.deleteConfirm')}
        onConfirm={() => { void remove(editingItem) }} />}
    </div>
  </form>

  return <div className="ea-mcp-panel" data-eterna-mcp-servers>
    <h4 className="ea-mcp-card-title">{t('mcp.mineTitle')}</h4>
    <div className="ea-row between">
      <span className="ea-row-meta">{quotaLabel(t('mcp.quota'), spent, limit)}</span>
      <button type="button" className="ea-btn" disabled={busy || atLimit || draft !== null}
        onClick={() => { setMessage(null); setDraft(draftOfNew(catalog)) }}>
        <Icon name="plus" size={16} />{t('mcp.add')}
      </button>
    </div>
    {atLimit && <p className="ea-hint" style={{ margin: 0 }}>{quotaLabel(t('mcp.limitHint'), spent, limit)}</p>}
    {message !== null && <p className={message.ok ? 'ea-ok' : 'ea-err'} role="alert">{message.text}</p>}
    {form}
    {items.length === 0
      ? <p className="ea-hint">{t('mcp.mineEmpty')}</p>
      : <ul className="ea-cards">
        {items.map(item => <li key={item.id} className="ea-pcard ea-act" data-eterna-mcp-server={item.id}>
          <div className="ea-phead">
            <span className="ea-picon" aria-hidden="true"><Icon name="flow" size={20} /></span>
            <div className="ea-pmain">
              <div className="ea-ptitle-row">
                <span className="ea-ptitle">{item.name}</span>
                <span className="ea-pill neutral">{t(transportLabelKey(item.transport))}</span>
                <span className={item.enabled ? 'ea-pill' : 'ea-pill neutral'}>
                  {item.enabled ? t('mcp.enabled') : t('mcp.disabled')}
                </span>
                {item.hasSecret && <span className="ea-pill neutral">{t('mcp.secretSet')}</span>}
              </div>
              <span className="ea-pdesc">{item.serverName}</span>
            </div>
            <div className="ea-pend">
              <Switch checked={item.enabled} disabled={busy}
                label={(item.enabled ? t('mcp.disableAria') : t('mcp.enableAria')).replace('{name}', item.name)}
                onToggle={() => { void toggle(item) }} />
              <button type="button" className="ea-btn ghost" disabled={busy}
                onClick={() => { setMessage(null); setDraft(draftOfItem(item, catalog)) }}>{t('mcp.edit')}</button>
            </div>
          </div>
        </li>)}
      </ul>}
  </div>
}