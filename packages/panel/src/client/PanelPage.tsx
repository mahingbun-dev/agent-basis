/**
 * 基座面板主页面(main keyed slot 的 occupant):三区块——服务清单 / 操作指南 /
 * 可观测样例。数据经 inject 面到达(props.useSnapshot / props.refresh),不触 ctx。
 * DOM 全部带 data-basis-panel* 结构化锚点,供 E2E 严断言定位(非全文匹配)。
 */
import { useCallback, useState, type ReactElement, type ReactNode } from 'react'
import type { BasisPanelSnapshot, ToolCard } from '../types.ts'
import { GUIDE_PROMPTS } from '../prompts.ts'
import { toolLocale } from './locales.ts'

/** 快照加载状态(inject hooks 份额的快照值)。 */
export type PanelSnapshotState =
  | { readonly status: 'loading' }
  | { readonly status: 'ready', readonly snapshot: BasisPanelSnapshot }
  | { readonly status: 'error', readonly message: string }

/** 面板组件 props(inject 面注入:hooks.snapshot → useSnapshot 选择器钩子,加 refresh 回调)。 */
export interface PanelPageProps {
  /**
   * hooks 份额绑定的选择器钩子(SnapshotSelectorHook 形态:必传 selector,
   * dsh-client-store contract.ts:`<S>(sel: (s: T) => S) => S`)。
   */
  readonly useSnapshot: <S>(selector: (state: PanelSnapshotState) => S) => S
  /** 重新拉取快照。 */
  readonly refresh: () => void
  /** 标准语言席位(locale 插件绑定)。 */
  readonly t: (key: string) => string
  /** 当前语言(工具名/说明本地化用)。 */
  readonly lang: 'zh' | 'en'
}

function Metric({ label, value }: { readonly label: string, readonly value: ReactNode }): ReactElement {
  return (
    <span data-basis-panel="metric">
      <span data-basis-panel="metric-value">{value}</span>
      <span data-basis-panel="metric-label">{label}</span>
    </span>
  )
}

function GovernanceCard({ snapshot, t }: { readonly snapshot: BasisPanelSnapshot, readonly t: (key: string) => string }): ReactElement {
  const governance = snapshot.governance
  return (
    <section data-basis-panel="card" data-basis-panel-card="governance" aria-label={t('services.governance')}>
      <div data-basis-panel="card-kicker">{t('services.governance')}</div>
      <div data-basis-panel="tile-row">
        <Metric label={t('services.rules')} value={<span data-basis-panel="rule-count">{governance.ruleCount}</span>} />
        <Metric label={t('services.audit')} value={<span data-basis-panel="audit-count">{governance.auditEntries}</span>} />
      </div>
      <div data-basis-panel="kv">
        <span data-basis-panel="kv-key">规则源</span>
        <span data-basis-panel="kv-value" data-basis-panel-detail="rule-source">{governance.ruleSource}</span>
      </div>
    </section>
  )
}

/** 单条记忆渲染(subject/key 头 + 全文内容 + 时间)。 */
function MemoryEntityRow({ entity }: { readonly entity: BasisPanelSnapshot['memory']['entities'][number] }): ReactElement {
  const date = new Date(entity.updatedAt)
  const time = Number.isNaN(date.getTime()) ? '' : date.toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })
  return (
    <div data-basis-panel="mem-entity" data-basis-panel-mem-entity={entity.subject + '/' + entity.key}>
      <div data-basis-panel="mem-entity-head">
        <span data-basis-panel="mem-entity-subject">{entity.subject}</span>
        <span data-basis-panel="mem-entity-key">{entity.key}</span>
        <span data-basis-panel="mem-entity-time">{time}</span>
      </div>
      <div data-basis-panel="mem-entity-content">{entity.content}</div>
    </div>
  )
}

/** 「记忆」独立区块:当前工作区全部有效记忆,按主体分组,美观渲染。 */
function MemorySection({ snapshot, t }: { readonly snapshot: BasisPanelSnapshot, readonly t: (key: string) => string }): ReactElement {
  const memory = snapshot.memory
  const entities = [...(memory.entities ?? [])]
  // 按 subject 分组,组内按 updatedAt 降序(快照端点已排序)
  type Entity = BasisPanelSnapshot['memory']['entities'][number]
  const groups = new Map<string, Entity[]>()
  for (const e of entities) {
    const list = groups.get(e.subject) ?? []
    list.push(e)
    groups.set(e.subject, list)
  }
  return (
    <section data-basis-panel="section" data-basis-panel-section="memory" aria-label={t('memory')}>
      <h2 data-basis-panel="section-title">{t('memory')}</h2>
      <p data-basis-panel="section-note">{t('memory.hint')}</p>
      {entities.length === 0 && <span data-basis-panel="placeholder">{t('state.empty')}</span>}
      {[...groups.entries()].map(([subject, items]) => (
        <div key={subject} data-basis-panel="mem-group" data-basis-panel-mem-subject={subject}>
          <div data-basis-panel="mem-subject">{subject}</div>
          {items.map(e => <MemoryEntityRow key={e.subject + '/' + e.key} entity={e} />)}
        </div>
      ))}
    </section>
  )
}

function KnowledgeCard({ snapshot, t }: { readonly snapshot: BasisPanelSnapshot, readonly t: (key: string) => string }): ReactElement {
  const knowledge = snapshot.knowledge
  return (
    <section data-basis-panel="card" data-basis-panel-card="knowledge" aria-label={t('services.knowledge')}>
      <div data-basis-panel="card-kicker">{t('services.knowledge')}</div>
      <div data-basis-panel="tile-row">
        <Metric label={t('services.wikiDocs')} value={<span data-basis-panel="wiki-doc-count">{knowledge.wikiDocCount}</span>} />
        <Metric label={t('services.proposals')} value={<span data-basis-panel="proposal-count">{knowledge.proposalCount}</span>} />
      </div>
      <div data-basis-panel="kv">
        <span data-basis-panel="kv-key">{t('services.weknora')}</span>
        <span data-basis-panel="kv-value" data-basis-panel-detail="weknora-status">{knowledge.weknora.status}</span>
      </div>
    </section>
  )
}

function ToolRow({ tool, lang }: { readonly tool: ToolCard, readonly lang: 'zh' | 'en' }): ReactElement {
  const loc = toolLocale(lang, tool.name)
  const risk = tool.r3 ? 'R3' : tool.risk
  return (
    <li data-basis-panel="tool" data-basis-panel-tool={tool.name} data-basis-panel-risk={risk}>
      <span data-basis-panel="tool-head">
        <span data-basis-panel="tool-label">{loc.label}</span>
        <span data-basis-panel="tool-id">{tool.name}</span>
      </span>
      <span data-basis-panel="tool-desc">{loc.desc}</span>
      {risk !== 'R0' && <span data-basis-panel="risk" data-basis-panel-risk={risk}>{risk}</span>}
    </li>
  )
}

function ToolsCard({ snapshot, t, lang }: { readonly snapshot: BasisPanelSnapshot, readonly t: (key: string) => string, readonly lang: 'zh' | 'en' }): ReactElement {
  const tools = snapshot.tools
  return (
    <section data-basis-panel="card" data-basis-panel-card="event-tools" aria-label={t('services.tools')}>
      <div data-basis-panel="card-kicker">{t('services.tools')} <span data-basis-panel="card-count">· {tools.length}</span></div>
      {tools.length === 0
        ? <span data-basis-panel="placeholder">{t('state.empty')}</span>
        : (
          <ul data-basis-panel="tool-list">
            {tools.map(tool => <ToolRow key={tool.name} tool={tool} lang={lang} />)}
          </ul>
        )}
    </section>
  )
}

function PromptRow({ id, capability, title, prompt, note, t }: {
  readonly id: string
  readonly capability: string
  readonly title: string
  readonly prompt: string
  readonly note: string | undefined
  readonly t: (key: string) => string
}): ReactElement {
  const [copied, setCopied] = useState(false)
  const onCopy = useCallback(() => {
    // 剪贴板双路径:clipboard API(需 user activation,真实点击路径)+
    // execCommand 文本域回退(合成点击/受限环境);两条路径都不可达时至少给出反馈态。
    const markCopied = (): void => {
      setCopied(true)
      window.setTimeout(() => { setCopied(false) }, 2000)
    }
    const fallbackCopy = (): boolean => {
      const area = document.createElement("textarea")
      area.value = prompt
      area.setAttribute("readonly", "true")
      area.style.position = "fixed"
      area.style.opacity = "0"
      document.body.append(area)
      area.select()
      let ok = false
      try { ok = document.execCommand("copy") } catch { ok = false }
      area.remove()
      return ok
    }
    const clipboard: Clipboard | undefined = navigator.clipboard
    if (clipboard !== undefined && typeof clipboard.writeText === "function") {
      clipboard.writeText(prompt).then(markCopied, () => { fallbackCopy(); markCopied() })
    } else {
      fallbackCopy()
      markCopied()
    }
  }, [prompt])
  return (
    <div data-basis-panel="prompt" data-basis-panel-prompt={id}>
      <div data-basis-panel="prompt-head">
        <span data-basis-panel="prompt-title">{title}</span>
        <span data-basis-panel="prompt-capability">{capability}</span>
        <button type="button" data-basis-panel="prompt-copy" data-basis-panel-copy={id} onClick={onCopy}>
          {copied ? t('guide.copied') : t('guide.copy')}
        </button>
      </div>
      <p data-basis-panel="prompt-text">{prompt}</p>
      {note !== undefined && <p data-basis-panel="prompt-note">{note}</p>}
    </div>
  )
}

function SessionRow({ session, t }: {
  readonly session: BasisPanelSnapshot['observability']['sessions'][number]
  readonly t: (key: string) => string
}): ReactElement {
  return (
    <div data-basis-panel="session" data-basis-panel-session={session.id}>
      <span data-basis-panel="session-id">{session.id}</span>
      <span data-basis-panel="session-metrics">
        <span>{t('observability.turns')} {session.turns}</span>
        <span>{t('observability.input')} {session.inputTokens}</span>
        <span>{t('observability.output')} {session.outputTokens}</span>
        <span>{t('observability.cacheRead')} {session.cacheReadTokens}</span>
        <span data-basis-panel="cache-hit-rate">
          {t('observability.cacheHit')} {session.cacheHitRate === null ? '—' : `${(session.cacheHitRate * 100).toFixed(1)}%`}
        </span>
      </span>
      <span data-basis-panel="session-last">{session.lastAt}</span>
    </div>
  )
}

/** 面板根组件。 */
export function PanelPage({ useSnapshot, refresh, t, lang }: Omit<PanelPageProps, never> & { lang?: 'zh' | 'en' }): ReactElement {
  const state = useSnapshot(snapshot => snapshot)
  // 语言跟随 DSH 系统(官方把当前语言写在 <html lang>;切换即时生效,字典更新触发重渲染)
  const uiLang: 'zh' | 'en' = lang ?? ((document.documentElement.lang || '').toLowerCase().startsWith('zh') ? 'zh' : 'en')
  return (
    <div data-basis-panel="root" aria-label={t('panel')}>
      <div data-basis-panel="toolbar">
        <h1 data-basis-panel="heading">{t('panel')}</h1>
        <button type="button" data-basis-panel="refresh" onClick={refresh}>{t('refresh')}</button>
      </div>
      <p data-basis-panel="sub">{t('subtitle')}</p>

      <div data-basis-panel="steps" data-basis-panel-steps="true">
        <div data-basis-panel="step"><span data-basis-panel="step-no">1</span><span data-basis-panel="step-text">{t('steps.one')}</span></div>
        <div data-basis-panel="step"><span data-basis-panel="step-no">2</span><span data-basis-panel="step-text">{t('steps.two')}</span></div>
        <div data-basis-panel="step"><span data-basis-panel="step-no">3</span><span data-basis-panel="step-text">{t('steps.three')}</span></div>
      </div>

      <section data-basis-panel="section" data-basis-panel-section="services" aria-label={t('services')}>
        <h2 data-basis-panel="section-title">{t('services')}</h2>
        {state.status === 'loading' && <span data-basis-panel="placeholder">{t('state.loading')}</span>}
        {state.status === 'error' && <span data-basis-panel="placeholder" data-basis-panel-error="true">{t('state.error')}: {state.message}</span>}
        {state.status === 'ready' && (
          <div data-basis-panel="cards">
            <GovernanceCard snapshot={state.snapshot} t={t} />
            <KnowledgeCard snapshot={state.snapshot} t={t} />
            <ToolsCard snapshot={state.snapshot} t={t} lang={uiLang} />
          </div>
        )}
      </section>

      <section data-basis-panel="section" data-basis-panel-section="guide" aria-label={t('guide')}>
        <h2 data-basis-panel="section-title">{t('guide')}</h2>
        <p data-basis-panel="section-note">{t('guide.hint')}</p>
        <div data-basis-panel="cards">
          {GUIDE_PROMPTS.map(entry => (
            <PromptRow key={entry.id} id={entry.id} capability={entry.capability} title={entry.title} prompt={entry.prompt} note={entry.note} t={t} />
          ))}
        </div>
      </section>

      {state.status === 'ready' && <MemorySection snapshot={state.snapshot} t={t} />}
      {state.status !== 'ready' && (
        <section data-basis-panel="section" data-basis-panel-section="memory" aria-label={t('memory')}>
          <span data-basis-panel="placeholder">{t('state.loading')}</span>
        </section>
      )}

      <section data-basis-panel="section" data-basis-panel-section="observability" aria-label={t('observability')}>
        <h2 data-basis-panel="section-title">{t('observability')}</h2>
        {state.status === 'ready' && state.snapshot.observability.note !== undefined && (
          <p data-basis-panel="section-note" data-basis-panel-observability-note="true">{state.snapshot.observability.note}</p>
        )}
        {state.status === 'ready' && state.snapshot.observability.sessions.length > 0 && (
          <div data-basis-panel="cards">
            {state.snapshot.observability.sessions.map(session => <SessionRow key={session.id} session={session} t={t} />)}
          </div>
        )}
        {state.status !== 'ready' && <span data-basis-panel="placeholder">{t('state.loading')}</span>}
      </section>
    </div>
  )
}
