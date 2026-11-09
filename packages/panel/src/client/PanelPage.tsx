/**
 * 基座面板主页面(main keyed slot 的 occupant):三区块——服务清单 / 操作指南 /
 * 可观测样例。数据经 inject 面到达(props.useSnapshot / props.refresh),不触 ctx。
 * DOM 全部带 data-eterna-panel* 结构化锚点,供 E2E 严断言定位(非全文匹配)。
 */
import { useCallback, useState, type ReactElement, type ReactNode } from 'react'
import type { EternaPanelSnapshot, ToolCard } from '../types.ts'
import { GUIDE_PROMPTS } from '../prompts.ts'
import { toolLocale } from './locales.ts'

/** 快照加载状态(inject hooks 份额的快照值)。 */
export type PanelSnapshotState =
  | { readonly status: 'loading' }
  | { readonly status: 'ready', readonly snapshot: EternaPanelSnapshot }
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
    <span data-eterna-panel="metric">
      <span data-eterna-panel="metric-value">{value}</span>
      <span data-eterna-panel="metric-label">{label}</span>
    </span>
  )
}

function GovernanceCard({ snapshot, t }: { readonly snapshot: EternaPanelSnapshot, readonly t: (key: string) => string }): ReactElement {
  const governance = snapshot.governance
  return (
    <section data-eterna-panel="card" data-eterna-panel-card="governance" aria-label={t('services.governance')}>
      <div data-eterna-panel="card-kicker">{t('services.governance')}</div>
      <div data-eterna-panel="tile-row">
        <Metric label={t('services.rules')} value={<span data-eterna-panel="rule-count">{governance.ruleCount}</span>} />
        <Metric label={t('services.audit')} value={<span data-eterna-panel="audit-count">{governance.auditEntries}</span>} />
      </div>
      <div data-eterna-panel="kv">
        <span data-eterna-panel="kv-key">规则源</span>
        <span data-eterna-panel="kv-value" data-eterna-panel-detail="rule-source">{governance.ruleSource}</span>
      </div>
    </section>
  )
}

/** 单条记忆渲染:key/时间 meta 行 + 内容(超 3 行截断,点击展开)。 */
function MemoryEntityRow({ entity }: { readonly entity: EternaPanelSnapshot['memory']['entities'][number] }): ReactElement {
  const [expanded, setExpanded] = useState(false)
  const date = new Date(entity.updatedAt)
  const time = Number.isNaN(date.getTime()) ? '' : date.toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })
  const long = entity.content.length > 120 || entity.content.includes('\n')
  return (
    <div data-eterna-panel="mem-entity" data-eterna-panel-mem-entity={entity.subject + '/' + entity.key}>
      <div data-eterna-panel="mem-entity-head">
        <span data-eterna-panel="mem-entity-key">{entity.key}</span>
        <span data-eterna-panel="mem-entity-time">{time}</span>
      </div>
      <div
        data-eterna-panel="mem-entity-content"
        data-eterna-panel-clamped={(!expanded && long) ? 'true' : undefined}
      >
        {entity.content}
      </div>
      {long && (
        <button
          type="button"
          data-eterna-panel="mem-expand"
          onClick={() => setExpanded(v => !v)}
        >
          {expanded ? '收起' : '显示全文'}
        </button>
      )}
    </div>
  )
}

/** 「记忆」独立区块:当前工作区全部有效记忆,按主体分组,美观渲染。 */
/** 主体(subject)→ 人话分类:标签 + 一句说明 + 排序权(小在前)。 */
const SUBJECT_KINDS: readonly { match: (s: string) => boolean, label: string, desc: string, order: number, tone: 'normal' | 'test' }[] = [
  { match: s => s.startsWith('user:'), label: '你的偏好与习惯', desc: 'Agent 从对话中沉淀的、关于你个人的记忆', order: 1, tone: 'normal' },
  { match: s => s.startsWith('project:'), label: '项目记忆', desc: '当前项目/工作区的事实、决定与结论', order: 2, tone: 'normal' },
  { match: s => s.startsWith('org:'), label: '团队约定', desc: '组织层面的约定与口径', order: 3, tone: 'normal' },
  { match: s => /^e2e:|^test:|^qa:/i.test(s), label: '测试数据', desc: '验收测试写入的记忆(可安全清理)', order: 99, tone: 'test' },
]

function subjectKind(subject: string): { label: string, desc: string, order: number, tone: 'normal' | 'test' } {
  const hit = SUBJECT_KINDS.find(k => k.match(subject))
  return hit ?? { label: subject, desc: '', order: 50, tone: 'normal' as const }
}

function MemorySection({ snapshot, t }: { readonly snapshot: EternaPanelSnapshot, readonly t: (key: string) => string }): ReactElement {
  const memory = snapshot.memory
  const entities = [...(memory.entities ?? [])]
  type Entity = EternaPanelSnapshot['memory']['entities'][number]
  // 按人话分类分组(不再是裸 subject 编码),组内按 updatedAt 降序
  type MemGroup = { label: string, desc: string, order: number, tone: 'normal' | 'test', items: Entity[] }
  const groups = new Map<string, MemGroup>()
  for (const e of entities) {
    const kind = subjectKind(e.subject)
    const g = groups.get(kind.label) ?? { label: kind.label, desc: kind.desc, order: kind.order, tone: kind.tone, items: [] as Entity[] }
    g.items.push(e)
    groups.set(kind.label, g)
  }
  const ordered = [...groups.values()].sort((a, b) => a.order - b.order)
  return (
    <section data-eterna-panel="section" data-eterna-panel-section="memory" aria-label={t('memory')}>
      <h2 data-eterna-panel="section-title">{t('memory')}</h2>
      <p data-eterna-panel="section-note">{t('memory.hint')}</p>
      {entities.length === 0 && <span data-eterna-panel="placeholder">{t('state.empty')}</span>}
      {ordered.map(g => (
        <div key={g.label} data-eterna-panel="mem-group" data-eterna-panel-mem-subject={g.label} data-eterna-panel-mem-tone={g.tone}>
          <div data-eterna-panel="mem-subject">
            {g.label}
            <span data-eterna-panel="mem-count">{g.items.length} 条</span>
          </div>
          <p data-eterna-panel="mem-group-desc">{g.desc}</p>
          {g.items.map(e => <MemoryEntityRow key={e.subject + '/' + e.key} entity={e} />)}
        </div>
      ))}
    </section>
  )
}

function KnowledgeCard({ snapshot, t }: { readonly snapshot: EternaPanelSnapshot, readonly t: (key: string) => string }): ReactElement {
  const knowledge = snapshot.knowledge
  return (
    <section data-eterna-panel="card" data-eterna-panel-card="knowledge" aria-label={t('services.knowledge')}>
      <div data-eterna-panel="card-kicker">{t('services.knowledge')}</div>
      <div data-eterna-panel="tile-row">
        <Metric label={t('services.wikiDocs')} value={<span data-eterna-panel="wiki-doc-count">{knowledge.wikiDocCount}</span>} />
        <Metric label={t('services.proposals')} value={<span data-eterna-panel="proposal-count">{knowledge.proposalCount}</span>} />
      </div>
      <div data-eterna-panel="kv">
        <span data-eterna-panel="kv-key">{t('services.weknora')}</span>
        <span data-eterna-panel="kv-value" data-eterna-panel-detail="weknora-status">{knowledge.weknora.status}</span>
      </div>
    </section>
  )
}

function ToolRow({ tool, lang }: { readonly tool: ToolCard, readonly lang: 'zh' | 'en' }): ReactElement {
  const loc = toolLocale(lang, tool.name)
  const risk = tool.r3 ? 'R3' : tool.risk
  return (
    <li data-eterna-panel="tool" data-eterna-panel-tool={tool.name} data-eterna-panel-risk={risk}>
      <span data-eterna-panel="tool-head">
        <span data-eterna-panel="tool-label">{loc.label}</span>
        <span data-eterna-panel="tool-id">{tool.name}</span>
      </span>
      <span data-eterna-panel="tool-desc">{loc.desc}</span>
      {risk !== 'R0' && <span data-eterna-panel="risk" data-eterna-panel-risk={risk}>{risk}</span>}
    </li>
  )
}

function ToolsCard({ snapshot, t, lang }: { readonly snapshot: EternaPanelSnapshot, readonly t: (key: string) => string, readonly lang: 'zh' | 'en' }): ReactElement {
  const tools = snapshot.tools
  return (
    <section data-eterna-panel="card" data-eterna-panel-card="event-tools" aria-label={t('services.tools')}>
      <div data-eterna-panel="card-kicker">{t('services.tools')} <span data-eterna-panel="card-count">· {tools.length}</span></div>
      {tools.length === 0
        ? <span data-eterna-panel="placeholder">{t('state.empty')}</span>
        : (
          <ul data-eterna-panel="tool-list">
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
    <div data-eterna-panel="prompt" data-eterna-panel-prompt={id}>
      <div data-eterna-panel="prompt-head">
        <span data-eterna-panel="prompt-title">{title}</span>
        <span data-eterna-panel="prompt-capability">{capability}</span>
        <button type="button" data-eterna-panel="prompt-copy" data-eterna-panel-copy={id} onClick={onCopy}>
          {copied ? t('guide.copied') : t('guide.copy')}
        </button>
      </div>
      <p data-eterna-panel="prompt-text">{prompt}</p>
      {note !== undefined && <p data-eterna-panel="prompt-note">{note}</p>}
    </div>
  )
}

function SessionRow({ session, t }: {
  readonly session: EternaPanelSnapshot['observability']['sessions'][number]
  readonly t: (key: string) => string
}): ReactElement {
  return (
    <div data-eterna-panel="session" data-eterna-panel-session={session.id}>
      <span data-eterna-panel="session-id">{session.id}</span>
      <span data-eterna-panel="session-metrics">
        <span>{t('observability.turns')} {session.turns}</span>
        <span>{t('observability.input')} {session.inputTokens}</span>
        <span>{t('observability.output')} {session.outputTokens}</span>
        <span>{t('observability.cacheRead')} {session.cacheReadTokens}</span>
        <span data-eterna-panel="cache-hit-rate">
          {t('observability.cacheHit')} {session.cacheHitRate === null ? '—' : `${(session.cacheHitRate * 100).toFixed(1)}%`}
        </span>
      </span>
      <span data-eterna-panel="session-last">{session.lastAt}</span>
    </div>
  )
}

/** 面板根组件。 */
export function PanelPage({ useSnapshot, refresh, t, lang }: Omit<PanelPageProps, never> & { lang?: 'zh' | 'en' }): ReactElement {
  const state = useSnapshot(snapshot => snapshot)
  // 语言跟随 DSH 系统(官方把当前语言写在 <html lang>;切换即时生效,字典更新触发重渲染)
  const uiLang: 'zh' | 'en' = lang ?? ((document.documentElement.lang || '').toLowerCase().startsWith('zh') ? 'zh' : 'en')
  return (
    <div data-eterna-panel="root" aria-label={t('panel')}>
      <div data-eterna-panel="toolbar">
        <h1 data-eterna-panel="heading">{t('panel')}</h1>
        <button type="button" data-eterna-panel="refresh" onClick={refresh}>{t('refresh')}</button>
      </div>
      <p data-eterna-panel="sub">{t('subtitle')}</p>

      <div data-eterna-panel="steps" data-eterna-panel-steps="true">
        <div data-eterna-panel="step"><span data-eterna-panel="step-no">1</span><span data-eterna-panel="step-text">{t('steps.one')}</span></div>
        <div data-eterna-panel="step"><span data-eterna-panel="step-no">2</span><span data-eterna-panel="step-text">{t('steps.two')}</span></div>
        <div data-eterna-panel="step"><span data-eterna-panel="step-no">3</span><span data-eterna-panel="step-text">{t('steps.three')}</span></div>
      </div>

      <section data-eterna-panel="section" data-eterna-panel-section="services" aria-label={t('services')}>
        <h2 data-eterna-panel="section-title">{t('services')}</h2>
        {state.status === 'loading' && <span data-eterna-panel="placeholder">{t('state.loading')}</span>}
        {state.status === 'error' && <span data-eterna-panel="placeholder" data-eterna-panel-error="true">{t('state.error')}: {state.message}</span>}
        {state.status === 'ready' && (
          <div data-eterna-panel="cards">
            <GovernanceCard snapshot={state.snapshot} t={t} />
            <KnowledgeCard snapshot={state.snapshot} t={t} />
            <ToolsCard snapshot={state.snapshot} t={t} lang={uiLang} />
          </div>
        )}
      </section>

      <section data-eterna-panel="section" data-eterna-panel-section="guide" aria-label={t('guide')}>
        <h2 data-eterna-panel="section-title">{t('guide')}</h2>
        <p data-eterna-panel="section-note">{t('guide.hint')}</p>
        <div data-eterna-panel="cards">
          {GUIDE_PROMPTS.map(entry => (
            <PromptRow key={entry.id} id={entry.id} capability={entry.capability} title={entry.title} prompt={entry.prompt} note={entry.note} t={t} />
          ))}
        </div>
      </section>

      {state.status === 'ready' && <MemorySection snapshot={state.snapshot} t={t} />}
      {state.status !== 'ready' && (
        <section data-eterna-panel="section" data-eterna-panel-section="memory" aria-label={t('memory')}>
          <span data-eterna-panel="placeholder">{t('state.loading')}</span>
        </section>
      )}

      <section data-eterna-panel="section" data-eterna-panel-section="observability" aria-label={t('observability')}>
        <h2 data-eterna-panel="section-title">{t('observability')}</h2>
        {state.status === 'ready' && state.snapshot.observability.note !== undefined && (
          <p data-eterna-panel="section-note" data-eterna-panel-observability-note="true">{state.snapshot.observability.note}</p>
        )}
        {state.status === 'ready' && state.snapshot.observability.sessions.length > 0 && (
          <div data-eterna-panel="cards">
            {state.snapshot.observability.sessions.map(session => <SessionRow key={session.id} session={session} t={t} />)}
          </div>
        )}
        {state.status !== 'ready' && <span data-eterna-panel="placeholder">{t('state.loading')}</span>}
      </section>
    </div>
  )
}
