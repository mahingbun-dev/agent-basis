/**
 * 「技能」页(侧栏入口 + main keyed 页):个人 / 共享两个页签。
 *
 * - 个人技能仅本人可见可写;共享技能全员可见,admin 可写、普通用户只读;
 * - 新建/编辑统一为「SKILL.md 原文」单个 textarea(含 frontmatter),服务端解析;
 * - 安装支持单个 .md 与 zip 技能包(zip 先做客户端大小检查,再 base64 上传);
 * - 删除在编辑器内两击确认(ArmedDelete),卡片动作只有开关 + 编辑(≤2);
 * - 视觉复用插件页卡片语言(ea-group/ea-cards/ea-pcard/ea-phead/ea-pmain/
 *   ea-ptitle-row/ea-pill/ea-pend)与通用 ea-tabs,不引入字面色值。
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { Icon } from '@eterna/ui/icons'
import { ArmedDelete } from './confirm-button.tsx'
import type { Translate } from './i18n.ts'
import { Switch } from './switch.tsx'
import {
  skillFailureMessage, skillsApi,
  type SkillItemView, type SkillListView, type SkillScopeValue,
} from './skills-api.ts'
import {
  SKILL_MARKDOWN_CLIENT_MAX, SKILL_TABS, SKILL_ZIP_CLIENT_MAX,
  base64FromBytes, bytesLabel, countLabel, frontmatterPreview, installTargetsFor, isScopeTab, itemsOfScope,
  markdownIssue, markdownIssueMessageKey, newSkillTemplate, originLabelKey, quotaLabel,
  scopeOfTab, uploadIssue, uploadIssueMessageKey, writableFor,
  type SkillMarkdownIssue, type SkillSectionRole, type SkillTab, type SkillTabId, type SkillUploadIssue, type SkillUploadKind,
} from './skills-model.ts'
import { marketApi, type MarketEntryView, type MarketSourceView } from './market-api.ts'
import {
  MARKET_QUERY_MAX, installedMessage, installLabelKey, installsLabel, marketFailureMessage,
  marketQueryIssue, marketSummary, sourceOptionLabel, versionLabel,
} from './market-model.ts'

export interface SkillsPageProps {
  readonly role: SkillSectionRole
  readonly t: Translate
}

interface Message {
  readonly ok: boolean
  readonly text: string
}

interface EditorState {
  readonly scope: SkillScopeValue
  /** null = 新建;非空 = 编辑既有技能(名称不可改)。 */
  readonly name: string | null
  readonly markdown: string
  readonly loading: boolean
}

/** 页面外壳:大标题 + 三个页签(我的/共享/技能市场);写权限按角色在面板内收口。 */
export function SkillsPage(props: SkillsPageProps): React.JSX.Element {
  const { role, t } = props
  const [active, setActive] = useState<SkillTabId>('mine')

  return <div className="ea-section ea-page" data-eterna-access-root data-eterna-skills-page>
    <header className="ea-page-head">
      <h1 className="ea-page-title">{t('skills.title')}</h1>
      <p className="ea-page-desc">{role === 'admin' ? t('skills.adminHint') : t('skills.userHint')}</p>
    </header>
    <SkillTabBar active={active} onSelect={(id) => { setActive(id) }} t={t} />
    <div className="ea-skill-panel" id={`ea-skill-panel-${active}`} role="tabpanel"
      aria-labelledby={`ea-skill-tab-${active}`}>
      {isScopeTab(active)
        ? <SkillsPanel role={role} scope={scopeOfTab(active)} t={t} />
        : <MarketPanel role={role} t={t} />}
    </div>
  </div>
}

/** 侧栏入口图标(图标统一走 @eterna/ui/icons)。 */
export function SkillsNavIcon(): React.JSX.Element {
  return <Icon name="knowledge" size={16} />
}

/** 页签条(左右方向键/Home/End;选中项是唯一 tab stop)。 */
function SkillTabBar(props: {
  readonly active: SkillTabId
  readonly onSelect: (id: SkillTabId) => void
  readonly t: Translate
}): React.JSX.Element {
  const { active, onSelect, t } = props
  const buttons = useRef<Array<HTMLButtonElement | null>>([])
  const tabs: readonly SkillTab[] = SKILL_TABS
  const move = (index: number): void => {
    const row = tabs[(index + tabs.length) % tabs.length]
    if (row === undefined) return
    onSelect(row.id)
    buttons.current[(index + tabs.length) % tabs.length]?.focus()
  }
  return <div className="ea-tabs" role="tablist" aria-label={t('skills.tabsLabel')}>
    {tabs.map((tab, index) => {
      const selected = tab.id === active
      return <button key={tab.id} ref={element => { buttons.current[index] = element }} id={`ea-skill-tab-${tab.id}`}
        type="button" role="tab" className="ea-tab" aria-selected={selected}
        aria-controls={selected ? `ea-skill-panel-${tab.id}` : undefined}
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

/** 单作用域面板(个人或共享):列表 + 安装 + 编辑器。 */
function SkillsPanel(props: {
  readonly role: SkillSectionRole
  readonly scope: SkillScopeValue
  readonly t: Translate
}): React.JSX.Element {
  const { role, scope, t } = props
  const writable = writableFor(role, scope)
  const [list, setList] = useState<SkillListView | null>(null)
  const [items, setItems] = useState<readonly SkillItemView[]>([])
  const [editor, setEditor] = useState<EditorState | null>(null)
  const [message, setMessage] = useState<Message | null>(null)
  const [busy, setBusy] = useState(false)
  const [uploading, setUploading] = useState<SkillUploadKind | null>(null)
  const mdInput = useRef<HTMLInputElement>(null)
  const zipInput = useRef<HTMLInputElement>(null)

  const refresh = useCallback(async (): Promise<void> => {
    try {
      const result = await skillsApi.list()
      if (result.ok && result.value !== undefined) {
        setList(result.value)
        setItems([...result.value.items])
      } else {
        setMessage({ ok: false, text: skillFailureMessage(result, t('skills.loadFailed')) })
      }
    } catch (error) {
      setMessage({ ok: false, text: error instanceof Error ? error.message : t('skills.loadFailed') })
    }
  }, [t])

  useEffect(() => { void refresh() }, [refresh])
  useEffect(() => { setMessage(null) }, [scope])

  const fail = (error: unknown, fallback: string): void => {
    setMessage({ ok: false, text: error instanceof Error ? error.message : fallback })
  }

  const openNew = (): void => {
    setMessage(null)
    setEditor({ scope, name: null, markdown: newSkillTemplate(), loading: false })
  }

  const openItem = async (item: SkillItemView): Promise<void> => {
    setMessage(null)
    setEditor({ scope, name: item.name, markdown: '', loading: true })
    try {
      const result = await skillsApi.read(scope, item.name)
      if (result.ok && result.value !== undefined) {
        const markdown = result.value.markdown
        setEditor(previous => previous !== null && previous.scope === scope && previous.name === item.name
          ? { ...previous, markdown, loading: false }
          : previous)
      } else {
        setEditor(previous => previous !== null && previous.scope === scope && previous.name === item.name ? null : previous)
        setMessage({ ok: false, text: skillFailureMessage(result, t('skills.readFailed')) })
      }
    } catch (error) {
      setEditor(previous => previous !== null && previous.scope === scope && previous.name === item.name ? null : previous)
      fail(error, t('skills.readFailed'))
    }
  }

  const save = async (): Promise<void> => {
    const current = editor
    if (current === null || current.loading || !writableFor(role, current.scope)) return
    const issue: SkillMarkdownIssue | undefined = markdownIssue(current.markdown)
    if (issue !== undefined) {
      setMessage({ ok: false, text: t(markdownIssueMessageKey(issue)) })
      return
    }
    setBusy(true)
    setMessage(null)
    try {
      const result = await skillsApi.save(current.scope, current.markdown, current.name ?? undefined)
      if (result.ok && result.value !== undefined) {
        setEditor(null)
        setMessage({ ok: true, text: t('skills.saved') })
        await refresh()
      } else {
        setMessage({ ok: false, text: skillFailureMessage(result, t('skills.saveFailed')) })
      }
    } catch (error) {
      fail(error, t('skills.saveFailed'))
    } finally {
      setBusy(false)
    }
  }

  const remove = async (name: string): Promise<void> => {
    setBusy(true)
    setMessage(null)
    try {
      const result = await skillsApi.remove(scope, name)
      if (result.ok) {
        setEditor(null)
        setMessage({ ok: true, text: t('skills.deleted') })
        await refresh()
      } else {
        setMessage({ ok: false, text: skillFailureMessage(result, t('skills.deleteFailed')) })
      }
    } catch (error) {
      fail(error, t('skills.deleteFailed'))
    } finally {
      setBusy(false)
    }
  }

  const toggle = async (item: SkillItemView): Promise<void> => {
    setBusy(true)
    setMessage(null)
    try {
      const result = await skillsApi.toggle(scope, item.name, !item.enabled)
      if (result.ok && result.value !== undefined) {
        const next = result.value.item
        setItems(previous => previous.map(row => row.scope === next.scope && row.name === next.name ? next : row))
      } else {
        setMessage({ ok: false, text: skillFailureMessage(result, t('skills.toggleFailed')) })
      }
    } catch (error) {
      fail(error, t('skills.toggleFailed'))
    } finally {
      setBusy(false)
    }
  }

  const upload = async (kind: SkillUploadKind, file: File): Promise<void> => {
    const issue: SkillUploadIssue | undefined = uploadIssue(kind, file)
    if (issue !== undefined) {
      setMessage({ ok: false, text: t(uploadIssueMessageKey(kind, issue)) })
      return
    }
    setUploading(kind)
    setMessage(null)
    try {
      const result = kind === 'md'
        ? await uploadMarkdown(file)
        : await uploadZip(file)
      if (result === undefined) return
      if (result.ok && result.value !== undefined) {
        setMessage({ ok: true, text: t('skills.installOk').replace('{name}', result.value.item.name) })
        await refresh()
      } else {
        setMessage({ ok: false, text: skillFailureMessage(result, t('skills.installFailed')) })
      }
    } catch (error) {
      fail(error, t('skills.installFailed'))
    } finally {
      setUploading(null)
    }
  }

  /** 读文本并安装;空内容直接提示,不把「未发请求」伪装成成功/失败帧。 */
  const uploadMarkdown = async (file: File): Promise<Awaited<ReturnType<typeof skillsApi.installMd>> | undefined> => {
    const content = await file.text()
    if (content.trim() === '') {
      setMessage({ ok: false, text: t('skills.fileEmpty') })
      return undefined
    }
    return skillsApi.installMd(scope, content)
  }

  const uploadZip = async (file: File): Promise<Awaited<ReturnType<typeof skillsApi.installZip>> | undefined> => {
    const bytes = new Uint8Array(await file.arrayBuffer())
    if (bytes.length > SKILL_ZIP_CLIENT_MAX) {
      setMessage({ ok: false, text: t('skills.zipTooLarge') })
      return undefined
    }
    return skillsApi.installZip(scope, base64FromBytes(bytes))
  }

  const pickFile = (kind: SkillUploadKind, event: React.ChangeEvent<HTMLInputElement>): void => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (file !== undefined) void upload(kind, file)
  }

  const visible = itemsOfScope(items, scope)
  const limit = scope === 'personal' ? list?.personalLimit : list?.sharedLimit
  const atLimit = writable && limit !== undefined && visible.length >= limit
  const disabled = busy || uploading !== null
  const editing = editor !== null && editor.scope === scope ? editor : null
  const editingName = editing?.name ?? null
  const editorVisible = editing !== null
  const readOnlyEditor = editing !== null && !writable
  const preview = editing === null ? {} : frontmatterPreview(editing.markdown)

  return <div className="ea-skill-panel" data-eterna-skills={scope}>
    <div className="ea-row between ea-skill-toolbar">
      <span className="ea-row-meta">
        {scope === 'personal' && limit !== undefined
          ? quotaLabel(t('skills.quota'), visible.length, limit)
          : countLabel(t('skills.sharedCount'), visible.length)}
      </span>
      <div className="ea-skill-actions">
        {writable && <button type="button" className="ea-btn" disabled={disabled || !list || atLimit}
          data-eterna-skill-add onClick={openNew}>
          <Icon name="plus" size={16} />{t('skills.add')}
        </button>}
        <button type="button" className="ea-btn ghost" disabled={disabled}
          onClick={() => { void refresh() }}>
          <Icon name="replay" size={16} />{t('skills.refresh')}
        </button>
      </div>
    </div>
    {!writable && <p className="ea-hint" style={{ margin: 0 }}>{t('skills.readOnlyHint')}</p>}
    {atLimit && limit !== undefined && <p className="ea-hint" style={{ margin: 0 }}>
      {quotaLabel(t('skills.limitHint'), visible.length, limit)}
    </p>}
    <p className="ea-hint" style={{ margin: 0 }}>{t('skills.useHint')}</p>
    {message !== null && <p className={message.ok ? 'ea-ok' : 'ea-err'} role={message.ok ? 'status' : 'alert'}>{message.text}</p>}

    {list === null
      ? message === null && <p className="ea-hint">{t('skills.loading')}</p>
      : <>
        {writable && !editorVisible && <div className="ea-skill-install" data-eterna-skill-install>
          <div className="ea-skill-install-main">
            <h4 className="ea-skill-card-title">{t('skills.installTitle')}</h4>
            <p className="ea-hint" style={{ margin: 0 }}>{t('skills.installHint')}</p>
          </div>
          <div className="ea-skill-actions">
            <input ref={mdInput} type="file" accept=".md,text/markdown" hidden
              onChange={(event) => { pickFile('md', event) }} />
            <input ref={zipInput} type="file" accept=".zip,application/zip" hidden
              onChange={(event) => { pickFile('zip', event) }} />
            <button type="button" className="ea-btn ghost" disabled={disabled}
              data-eterna-skill-upload="md" onClick={() => { mdInput.current?.click() }}>
              <Icon name="paperclip" size={16} />{uploading === 'md' ? t('skills.installing') : t('skills.uploadMd')}
            </button>
            <button type="button" className="ea-btn ghost" disabled={disabled}
              data-eterna-skill-upload="zip" onClick={() => { zipInput.current?.click() }}>
              <Icon name="folder" size={16} />{uploading === 'zip' ? t('skills.installing') : t('skills.uploadZip')}
            </button>
          </div>
        </div>}

        {editing !== null && <form className="ea-skill-form" data-eterna-skill-editor
          onSubmit={(event) => { event.preventDefault(); void save() }}>
          <h4 className="ea-skill-card-title">
            {editing.name === null
              ? t('skills.editorNew')
              : readOnlyEditor ? t('skills.editorView') : t('skills.editorEdit')}
          </h4>
          {readOnlyEditor && <p className="ea-hint" style={{ margin: 0 }}>{t('skills.readOnlyHint')}</p>}
          {editing.loading
            ? <p className="ea-hint">{t('skills.loading')}</p>
            : <>
              <div className="ea-skill-preview" data-eterna-skill-preview>
                <span><strong>{t('skills.previewName')}</strong> {preview.name ?? t('skills.previewUnknown')}</span>
                <span><strong>{t('skills.previewDescription')}</strong> {preview.description ?? t('skills.previewUnknown')}</span>
                {preview.whenToUse !== undefined && <span><strong>{t('skills.previewWhen')}</strong> {preview.whenToUse}</span>}
              </div>
              {(!preview.name || !preview.description) && <p className="ea-hint" style={{ margin: 0 }}>{t('skills.previewInvalid')}</p>}
            </>}
          <div className="ea-skill-field">
            <label className="ea-label" htmlFor="ea-skill-markdown">{t('skills.markdownLabel')}</label>
            <textarea id="ea-skill-markdown" key={`${editing.scope}:${editing.name ?? 'new'}:${String(editing.loading)}`}
              className="ea-input ea-skill-editor" data-eterna-skill-markdown
              aria-describedby="ea-skill-markdown-hint" spellCheck={false}
              autoFocus={!editing.loading} readOnly={readOnlyEditor} disabled={editing.loading}
              maxLength={SKILL_MARKDOWN_CLIENT_MAX} placeholder={t('skills.markdownPlaceholder')}
              value={editing.markdown}
              onChange={(event) => {
                const markdown = event.target.value
                setEditor(previous => previous === null ? previous : { ...previous, markdown })
              }} />
            <p className="ea-hint" id="ea-skill-markdown-hint" style={{ margin: 0 }}>{t('skills.markdownHint')}</p>
          </div>
          <div className="ea-skill-form-actions">
            {!readOnlyEditor && <button type="submit" className="ea-btn" disabled={disabled || editing.loading}>
              {busy ? t('skills.saving') : t('skills.save')}
            </button>}
            <button type="button" className="ea-btn ghost" disabled={busy}
              onClick={() => { setEditor(null) }}>
              {readOnlyEditor ? t('skills.close') : t('skills.cancel')}
            </button>
            {!readOnlyEditor && editingName !== null && <ArmedDelete busy={disabled}
              label={t('skills.delete')} confirmLabel={t('skills.deleteConfirm')}
              onConfirm={() => { void remove(editingName) }} />}
          </div>
        </form>}

        {visible.length === 0
          ? <p className="ea-hint">
            {scope === 'personal'
              ? t('skills.mineEmpty')
              : writable ? t('skills.adminEmptyHint') : t('skills.sharedEmpty')}
          </p>
          : <ul className="ea-cards">
            {visible.map(item => <li key={`${item.scope}/${item.name}`} className="ea-pcard ea-act"
              data-eterna-skill={item.name} data-eterna-skill-scope={item.scope}>
              <div className="ea-phead">
                <span className="ea-picon" aria-hidden="true"><Icon name="knowledge" size={20} /></span>
                <div className="ea-pmain">
                  <div className="ea-ptitle-row">
                    <span className="ea-ptitle">{item.name}</span>
                    <span className="ea-pill neutral">{t(originLabelKey(item.origin))}</span>
                    {!item.enabled && <span className="ea-pill neutral">{t('skills.disabled')}</span>}
                  </div>
                  <span className="ea-pdesc">{item.description}</span>
                  <span className="ea-skill-meta">
                    <code>/{item.name}</code>
                    <span>·</span>
                    <span>{countLabel(t('skills.filesLabel'), item.files)}</span>
                    <span>·</span>
                    <span>{bytesLabel(item.bytes)}</span>
                  </span>
                </div>
                <div className="ea-pend">
                  {writable && <Switch checked={item.enabled} disabled={disabled}
                    label={(item.enabled ? t('skills.disableAria') : t('skills.enableAria')).replace('{name}', item.name)}
                    onToggle={() => { void toggle(item) }} />}
                  <button type="button" className="ea-btn ghost" disabled={disabled}
                    data-eterna-skill-edit onClick={() => { void openItem(item) }}>
                    {writable ? t('skills.edit') : t('skills.view')}
                  </button>
                </div>
              </div>
            </li>)}
          </ul>}
      </>}
  </div>
}
/**
 * 技能市场面板(2026-11-26):来源下拉 + 搜索 + 结果卡片 + 管理员来源维护。
 *
 * 来源由管理员维护(内置 SkillHub 恒在);浏览/搜索全员;安装默认个人,
 * 管理员可另选共享。安装成功只提示,切换回「我的技能」时列表自动重取。
 */
function MarketPanel(props: {
  readonly role: SkillSectionRole
  readonly t: Translate
}): React.JSX.Element {
  const { role, t } = props
  const [sources, setSources] = useState<readonly MarketSourceView[] | null>(null)
  const [sourceId, setSourceId] = useState('skillhub')
  const [query, setQuery] = useState('')
  const [entries, setEntries] = useState<readonly MarketEntryView[] | null>(null)
  // 结果列表整块换 key:宿主对 slot 子树的既有 DOM 偶发不随替换清理(实测残留首屏卡片),
  // 显式 remount 比依赖同名 key 的 diff 更可靠。
  const [listSeq, setListSeq] = useState(0)
  const [busy, setBusy] = useState(false)
  const [installing, setInstalling] = useState<string | null>(null)
  const [message, setMessage] = useState<Message | null>(null)
  const [managing, setManaging] = useState(false)
  const [sourcesBusy, setSourcesBusy] = useState(false)
  const [newName, setNewName] = useState('')
  const [newUrl, setNewUrl] = useState('')

  const runSearch = useCallback(async (id: string, text: string): Promise<void> => {
    const issue = marketQueryIssue(text)
    if (issue !== undefined) {
      setMessage({ ok: false, text: t(issue) })
      return
    }
    setBusy(true)
    setMessage(null)
    try {
      const result = await marketApi.search(id, text)
      if (result.ok && result.value !== undefined) {
        setEntries(result.value.entries)
        setListSeq(previous => previous + 1)
      } else {
        setEntries([])
        setMessage({ ok: false, text: marketFailureMessage(result, t('skills.market.searchFailed')) })
      }
    } catch (error) {
      setEntries([])
      setMessage({ ok: false, text: error instanceof Error ? error.message : t('skills.market.searchFailed') })
    } finally {
      setBusy(false)
    }
  }, [t])

  const loadSources = useCallback(async (): Promise<void> => {
    try {
      const result = await marketApi.sources()
      if (result.ok && result.value !== undefined) {
        const list = result.value.sources
        setSources(list)
        const next = list.some(source => source.id === 'skillhub') ? 'skillhub' : (list[0]?.id ?? '')
        setSourceId(next)
        if (next !== '') void runSearch(next, '')
      } else {
        setSources([])
        setMessage({ ok: false, text: marketFailureMessage(result, t('skills.market.sourcesFailed')) })
      }
    } catch (error) {
      setSources([])
      setMessage({ ok: false, text: error instanceof Error ? error.message : t('skills.market.sourcesFailed') })
    }
  }, [runSearch, t])

  // 只拉一次来源并加载默认列表:依赖 t 的回调在宿主重渲染时可能换身份,用 ref 闸住循环。
  const started = useRef(false)
  useEffect(() => {
    if (started.current) return
    started.current = true
    void loadSources()
  }, [loadSources])

  const install = async (entry: MarketEntryView, scope: SkillScopeValue): Promise<void> => {
    const key = `${entry.slug}:${scope}`
    setInstalling(key)
    setMessage(null)
    try {
      const result = await marketApi.install({
        scope,
        sourceId: entry.sourceId,
        slug: entry.slug,
        ...(entry.namespace === undefined ? {} : { namespace: entry.namespace }),
        ...(entry.version === '' ? {} : { version: entry.version }),
      })
      if (result.ok && result.value !== undefined) {
        setMessage({ ok: true, text: installedMessage(t('skills.market.installOk'), result.value.item.name) })
      } else {
        setMessage({ ok: false, text: marketFailureMessage(result, t('skills.market.installFailed')) })
      }
    } catch (error) {
      setMessage({ ok: false, text: error instanceof Error ? error.message : t('skills.market.installFailed') })
    } finally {
      setInstalling(null)
    }
  }

  const addSource = async (): Promise<void> => {
    if (newName.trim() === '' || newUrl.trim() === '') {
      setMessage({ ok: false, text: t('skills.market.sourceFieldsRequired') })
      return
    }
    setSourcesBusy(true)
    setMessage(null)
    try {
      const result = await marketApi.addSource(newName.trim(), newUrl.trim())
      if (result.ok) {
        setNewName('')
        setNewUrl('')
        setMessage({ ok: true, text: t('skills.market.sourceAdded') })
        await loadSources()
      } else {
        setMessage({ ok: false, text: marketFailureMessage(result, t('skills.market.sourceAddFailed')) })
      }
    } catch (error) {
      setMessage({ ok: false, text: error instanceof Error ? error.message : t('skills.market.sourceAddFailed') })
    } finally {
      setSourcesBusy(false)
    }
  }

  const removeSource = async (id: string): Promise<void> => {
    setSourcesBusy(true)
    setMessage(null)
    try {
      const result = await marketApi.removeSource(id)
      if (result.ok) {
        setMessage({ ok: true, text: t('skills.market.sourceRemoved') })
        await loadSources()
      } else {
        setMessage({ ok: false, text: marketFailureMessage(result, t('skills.market.sourceRemoveFailed')) })
      }
    } catch (error) {
      setMessage({ ok: false, text: error instanceof Error ? error.message : t('skills.market.sourceRemoveFailed') })
    } finally {
      setSourcesBusy(false)
    }
  }

  const targets = installTargetsFor(role)
  const sourceName = (id: string): string => sources?.find(source => source.id === id)?.name ?? id

  return <div className="ea-market" data-eterna-market>
    <div className="ea-row between ea-skill-toolbar">
      <div className="ea-market-controls">
        <select id="ea-market-source" className="ea-input ea-market-source" data-eterna-market-source
          value={sourceId} disabled={busy || sources === null}
          aria-label={t('skills.market.sourceLabel')}
          onChange={(event) => {
            const next = event.target.value
            setSourceId(next)
            void runSearch(next, '')
          }}>
          {(sources ?? []).map(source =>
            <option key={source.id} value={source.id}>{sourceOptionLabel(source, t('skills.market.builtinSuffix'))}</option>)}
        </select>
        <form className="ea-market-search" onSubmit={(event) => { event.preventDefault(); void runSearch(sourceId, query) }}>
          <input className="ea-input" value={query} maxLength={MARKET_QUERY_MAX} data-eterna-market-query
            placeholder={t('skills.market.searchPlaceholder')} aria-label={t('skills.market.searchPlaceholder')}
            onChange={(event) => { setQuery(event.target.value) }} />
          <button type="submit" className="ea-btn" disabled={busy || sources === null} data-eterna-market-search>
            <Icon name="search" size={16} />{busy ? t('skills.market.searching') : t('skills.market.search')}
          </button>
        </form>
      </div>
      <div className="ea-skill-actions">
        <button type="button" className="ea-btn ghost" disabled={busy}
          onClick={() => { setQuery(''); void runSearch(sourceId, '') }}>
          <Icon name="replay" size={16} />{t('skills.market.refresh')}
        </button>
        {role === 'admin' && <button type="button" className="ea-btn ghost" data-eterna-market-manage
          aria-expanded={managing}
          onClick={() => { setManaging(previous => !previous) }}>
          <Icon name="settings" size={16} />{t('skills.market.manage')}
        </button>}
      </div>
    </div>
    <p className="ea-hint" style={{ margin: 0 }}>{t('skills.market.hint')}</p>
    {message !== null && <p className={message.ok ? 'ea-ok' : 'ea-err'} role={message.ok ? 'status' : 'alert'}>{message.text}</p>}

    {managing && role === 'admin' && <div className="ea-skill-install ea-market-sources" data-eterna-market-sources>
      <div className="ea-skill-install-main">
        <h4 className="ea-skill-card-title">{t('skills.market.sourcesTitle')}</h4>
        <p className="ea-hint" style={{ margin: 0 }}>{t('skills.market.sourcesHint')}</p>
        <ul className="ea-market-source-list">
          {(sources ?? []).map(source => <li key={source.id} data-eterna-market-source-item={source.id}>
            <span className="ea-ptitle">{source.name}</span>
            <span className="ea-pill neutral">{source.builtin ? t('skills.market.builtin') : t('skills.market.custom')}</span>
            <code className="ea-market-url">{source.url}</code>
            {!source.builtin && <ArmedDelete busy={sourcesBusy}
              label={t('skills.market.removeSource')} confirmLabel={t('skills.market.removeSourceConfirm')}
              onConfirm={() => { void removeSource(source.id) }} />}
          </li>)}
        </ul>
        <form className="ea-market-add" onSubmit={(event) => { event.preventDefault(); void addSource() }}>
          <input className="ea-input" value={newName} maxLength={40} data-eterna-market-new-name
            placeholder={t('skills.market.namePlaceholder')} aria-label={t('skills.market.namePlaceholder')}
            onChange={(event) => { setNewName(event.target.value) }} />
          <input className="ea-input" value={newUrl} data-eterna-market-new-url
            placeholder={t('skills.market.urlPlaceholder')} aria-label={t('skills.market.urlPlaceholder')}
            onChange={(event) => { setNewUrl(event.target.value) }} />
          <button type="submit" className="ea-btn" disabled={sourcesBusy} data-eterna-market-add>
            {t('skills.market.addSource')}
          </button>
        </form>
      </div>
    </div>}

    {entries === null
      ? <p className="ea-hint">{busy ? t('skills.market.loading') : t('skills.market.loading')}</p>
      : entries.length === 0
        ? <p className="ea-hint">{t('skills.market.empty')}</p>
        : <ul className="ea-cards" key={`market-${listSeq}`} data-eterna-market-list>
          {entries.map(entry => <li key={`${entry.sourceId}/${entry.slug}`} className="ea-pcard ea-act"
            data-eterna-market-entry={entry.slug}>
            <div className="ea-phead">
              <span className="ea-picon" aria-hidden="true"><Icon name="knowledge" size={20} /></span>
              <div className="ea-pmain">
                <div className="ea-ptitle-row">
                  <span className="ea-ptitle">{entry.name}</span>
                  <span className="ea-pill neutral">{sourceName(entry.sourceId)}</span>
                  {entry.version !== '' && <span className="ea-pill neutral">v{versionLabel(entry.version)}</span>}
                </div>
                <span className="ea-pdesc ea-market-summary">{marketSummary(entry.summary)}</span>
                <span className="ea-skill-meta">
                  <code>/{entry.slug}</code>
                  {installsLabel(entry.installs, t('skills.market.installs')) !== '' && <>
                    <span>·</span>
                    <span>{installsLabel(entry.installs, t('skills.market.installs'))}</span>
                  </>}
                </span>
              </div>
              <div className="ea-pend">
                {targets.map(scope => <button key={scope} type="button"
                  className="ea-btn ghost"
                  disabled={busy || installing !== null}
                  data-eterna-market-install={scope}
                  onClick={() => { void install(entry, scope) }}>
                  {installing === `${entry.slug}:${scope}` ? t('skills.market.installing') : t(installLabelKey(scope))}
                </button>)}
              </div>
            </div>
          </li>)}
        </ul>}
  </div>
}
