/**
 * 提问卡(2026-11-17):`ask_user_question` 在多租户 web 前端结构性不可达
 * (session-c9a74388:模型提问后 42 分钟假死,前端无卡片,手动停止才解)。
 * 上游前端有提问卡组件,但网关只把 waterfall 转发给 owner peer(dsh-api-gateway
 * lib:1042/1136),mux 换血后的浏览器是 eterna-user,永收不到——本卡是宿主提问桥
 * (../question-bridge.ts)的浏览器半边:轮询本人待答提问,逐题渲染选项/多选/自定义,
 * 提交即 POST questions/answer。
 *
 * 交互纪律(AGENTS.md 前端铁律):
 * - 资料类一次提交(整卡答案批一次 POST,脏检查后才启用提交);
 * - 变更请求防重复点击(busy 锁);
 * - 破坏性动作不用原生 confirm——跳过本轮是「模型继续」的软动作,用文字按钮不弹窗;
 * - 语义化标题、focus 光圈、prefers-reduced-motion、窄屏断点。
 *
 * v4 叠层契约(2026-11-19,42 号 §7a.2):与审批卡同席位——在
 * `conversation.input.overlay`(输入卡顶边零高度锚点)内渲染,不再自挂 body +
 * `fixed top:16px` + `z-index:10000`;卡片作用域=会话,只呈本 sessionId 的提问。
 */
import { useEffect, useMemo, useState } from 'react'

export interface QuestionOption {
  readonly label: string
  readonly description?: string
}

export interface QuestionItem {
  readonly id: string
  readonly question: string
  readonly header?: string
  readonly options?: readonly QuestionOption[]
  readonly multiSelect?: boolean
}

export interface PendingQuestion {
  readonly id: string
  readonly sessionId: string
  readonly callId: string | null
  readonly questions: readonly QuestionItem[]
  readonly requestedAt: number
  readonly expiresAt: number
}

const POLL_MS = 4_000

async function fetchPending(): Promise<PendingQuestion[]> {
  const res = await fetch('/access/api/questions/pending', { credentials: 'same-origin' })
  if (!res.ok) throw new Error(`status ${String(res.status)}`)
  const body = (await res.json()) as { items?: PendingQuestion[] }
  return Array.isArray(body.items) ? body.items : []
}

interface AnswerDraft {
  readonly selected: readonly string[]
  readonly custom: string
}

async function submit(id: string, payload: { answers?: unknown; skip?: boolean }): Promise<void> {
  const res = await fetch('/access/api/questions/answer', {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ id, ...payload }),
  })
  if (!res.ok) {
    const detail = await res.json().catch(() => undefined) as { error?: string } | undefined
    throw new Error(detail?.error ?? `status ${String(res.status)}`)
  }
}

/** 该题是否已作答(选项非空或自定义文本非空)。 */
function draftFilled(draft: AnswerDraft | undefined): boolean {
  return draft !== undefined && (draft.selected.length > 0 || draft.custom.trim() !== '')
}

function QuestionField(props: {
  readonly question: QuestionItem
  readonly draft: AnswerDraft | undefined
  readonly onChange: (next: AnswerDraft) => void
}): React.JSX.Element {
  const { question } = props
  const draft = props.draft ?? { selected: [], custom: '' }
  const multi = question.multiSelect === true
  const toggle = (label: string): void => {
    if (multi) {
      const has = draft.selected.includes(label)
      props.onChange({
        ...draft,
        selected: has ? draft.selected.filter(item => item !== label) : [...draft.selected, label],
      })
      return
    }
    // 单选=再点一次取消(用户可能想改用自定义文本)
    props.onChange({ ...draft, selected: draft.selected.includes(label) ? [] : [label] })
  }
  return (
    <fieldset className='eq-field'>
      <legend className='eq-question'>
        {question.header !== undefined ? <span className='eq-chip'>{question.header}</span> : null}
        {question.question}
      </legend>
      {question.options !== undefined && question.options.length > 0 ? (
        <div className='eq-options'>
          {question.options.map(option => {
            const checked = draft.selected.includes(option.label)
            return (
              <label key={option.label} className={checked ? 'eq-option eq-option-on' : 'eq-option'}>
                <input
                  type={multi ? 'checkbox' : 'radio'}
                  name={`q-${question.id}`}
                  checked={checked}
                  onChange={() => { toggle(option.label) }}
                />
                <span className='eq-option-label'>{option.label}</span>
                {option.description !== undefined ? <span className='eq-option-desc'>{option.description}</span> : null}
              </label>
            )
          })}
        </div>
      ) : null}
      <input
        className='eq-custom'
        type='text'
        value={draft.custom}
        placeholder={question.options !== undefined && question.options.length > 0 ? '其他(可补充说明)' : '填写你的回答'}
        onChange={event => { props.onChange({ ...draft, custom: event.target.value }) }}
      />
    </fieldset>
  )
}

function QuestionCard(props: {
  readonly item: PendingQuestion
  readonly onDone: (id: string) => void
}): React.JSX.Element {
  const [drafts, setDrafts] = useState<Record<string, AnswerDraft>>({})
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | undefined>(undefined)
  const remaining = Math.max(0, Math.round((props.item.expiresAt - Date.now()) / 1000))
  const allFilled = useMemo(
    () => props.item.questions.every(question => draftFilled(drafts[question.id])),
    [props.item.questions, drafts],
  )
  const send = (payload: { answers?: unknown; skip?: boolean }): void => {
    if (busy) return
    setBusy(true)
    setError(undefined)
    void submit(props.item.id, payload)
      .then(() => { props.onDone(props.item.id) })
      .catch((cause: unknown) => { setError(cause instanceof Error ? cause.message : '提交失败') })
      .finally(() => { setBusy(false) })
  }
  const submitAnswers = (): void => {
    const answers = props.item.questions.map(question => {
      const draft = drafts[question.id] ?? { selected: [], custom: '' }
      const custom = draft.custom.trim()
      return {
        id: question.id,
        selected: [...draft.selected],
        ...(custom === '' ? {} : { custom }),
      }
    })
    send({ answers })
  }
  return (
    <section className='et-decision-card' data-kind='question' role='dialog' aria-modal='false'
      aria-labelledby={`eq-title-${props.item.id}`}>
      <div className='et-decision-track' aria-hidden='true'>
        <i style={{ width: `${String(Math.min(100, Math.max(0, (props.item.expiresAt - Date.now()) / Math.max(1, props.item.expiresAt - props.item.requestedAt) * 100)))}%` }} />
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <span className='et-badge' data-tone='accent'>待回答</span>
        <h2 className='eq-title' id={`eq-title-${props.item.id}`}
          style={{ margin: 0, font: '600 var(--et-text-body)/1.35 var(--et-font-body)' }}>
          需要你的回答才能继续
        </h2>
      </div>
      <div className='eq-body'>
        {props.item.questions.map(question => (
          <QuestionField
            key={question.id}
            question={question}
            draft={drafts[question.id]}
            onChange={(next) => { setDrafts(prev => ({ ...prev, [question.id]: next })) }}
          />
        ))}
        {error !== undefined ? <p className='eq-error' role='alert'>{error}</p> : null}
        <p className='eq-meta'>{String(remaining)} 秒后自动放行(模型会说明未获回答继续)</p>
      </div>
      <div className='et-card-actions' style={{ justifyContent: 'flex-end' }}>
        <button type='button' className='et-btn et-btn--ghost et-btn--sm' disabled={busy}
          onClick={() => { send({ skip: true }) }}>跳过本轮</button>
        <button type='button' className='et-btn et-btn--primary et-btn--sm'
          disabled={busy || !allFilled} onClick={submitAnswers}>提交回答</button>
      </div>
    </section>
  )
}

/**
 * 提问卡槽位组件：在 `conversation.input.overlay` 席位内渲染。
 * 只呈属于本会话（`sessionId`）的提问——提问与审批同为会话作用域。
 */
export function QuestionCards(props: { readonly sessionId?: string | undefined }): React.JSX.Element {
  const [items, setItems] = useState<PendingQuestion[]>([])
  useEffect(() => {
    let alive = true
    let timer: ReturnType<typeof setTimeout> | undefined
    const tick = async (): Promise<void> => {
      try {
        const next = await fetchPending()
        if (alive) setItems(next)
      } catch { /* 静默:未登录/网络抖动下一轮再试 */ }
      if (alive) timer = setTimeout(() => { void tick() }, POLL_MS)
    }
    void tick()
    return () => {
      alive = false
      if (timer !== undefined) clearTimeout(timer)
    }
  }, [])
  const onDone = (id: string): void => { setItems(prev => prev.filter(item => item.id !== id)) }
  // 会话作用域:没有 sessionId 时保守显示全部(宿主可能在首帧未下发)
  const mine = props.sessionId === undefined
    ? items
    : items.filter(item => item.sessionId === props.sessionId)
  if (mine.length === 0) return <></>
  return <>{mine.map(item => <QuestionCard key={item.id} item={item} onDone={onDone} />)}</>
}

