/**
 * 提问卡(2026-11-17 / v2 2026-11-25):`ask_user_question` 在多租户 web 前端结构性
 * 不可达(session-c9a74388:模型提问后 42 分钟假死,前端无卡片,手动停止才解)。
 * 上游前端有提问卡组件,但网关只把 waterfall 转发给 owner peer(dsh-api-gateway
 * lib:1042/1136),mux 换血后的浏览器是 eterna-user,永收不到——本卡是宿主提问桥
 * (../question-bridge.ts)的浏览器半边:轮询本人待答提问,逐题渲染选项/多选/自定义,
 * 提交即 POST questions/answer。
 *
 * v2 改造(2026-11-25,用户实测「题太多,直接看不见」):
 * 旧卡没有高度上限,题一多就从输入卡顶边往上顶穿视口——顶部题目被裁掉,且卡片
 * 自身不可滚动,用户根本看不到。现在照 ZCode 提问卡形态重做:
 * - 卡片定高:`max-height` 取决策层量测的 `--decision-avail`;
 * - 头部/底部固定,题区 `.eq-body` 是唯一滚动轴;边缘渐隐 + 已答进度
 *   明示还有多少题没答;
 * - 选项整行卡片化(圆环 + 标题 + 说明),选中只染边框与浅底。
 *
 * v3(2026-11-25,用户要求「一次只显示一题,左右切换」):
 * - 题区一次只挂当前题(`questions[index]`),答案草稿按题 id 保留,切换不丢;
 * - 页脚步进器 `‹ 第 n/N 题 ›` 左右切换,首/末题对应按钮禁用;
 * - 键盘 ←/→ 在卡内切换(输入框/原生选项内不劫持,保留原生键盘行为);
 * - 切题时题区回到顶部并更新边缘渐隐;`aria-live` 播报当前题。
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
import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from 'react'
import { Icon } from '@eterna/ui/icons'

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
    // 面板文字一律中文（AGENTS.md）；裸 status 是英文，只在服务端没给原因时兜底
    throw new Error(detail?.error ?? `提交失败（HTTP ${String(res.status)}）`)
  }
}

/** 该题是否已作答(选项非空或自定义文本非空)。 */
function draftFilled(draft: AnswerDraft | undefined): boolean {
  return draft !== undefined && (draft.selected.length > 0 || draft.custom.trim() !== '')
}

/** 把模型给的题 id 收敛成可安全用于 aria-labelledby 的锚点 id。 */
function anchorId(prefix: string, id: string): string {
  return `${prefix}-${id.replace(/[^\w-]/gu, '-')}`
}

/** 题区边缘是否还有被遮住的内容（决定渐隐层）。 */
function readEdges(el: HTMLDivElement | null): string {
  if (el === null) return ''
  const edges: string[] = []
  if (el.scrollTop > 2) edges.push('top')
  if (el.scrollTop + el.clientHeight < el.scrollHeight - 2) edges.push('bottom')
  return edges.join(' ')
}

function QuestionField(props: {
  readonly question: QuestionItem
  readonly draft: AnswerDraft | undefined
  readonly onChange: (next: AnswerDraft) => void
}): React.JSX.Element {
  const { question } = props
  const draft = props.draft ?? { selected: [], custom: '' }
  const multi = question.multiSelect === true
  const labelId = anchorId('eq-q', question.id)
  const hasOptions = question.options !== undefined && question.options.length > 0
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
    <div className='eq-field' role='group' aria-labelledby={labelId}>
      <div className='eq-qhead' id={labelId}>
        {question.header !== undefined ? <span className='eq-tag'>{question.header}</span> : null}
        <span className='eq-question'>{question.question}</span>
        {multi ? <span className='eq-multi'>可多选</span> : null}
      </div>
      {hasOptions ? (
        <div className='eq-options'>
          {question.options?.map(option => {
            const checked = draft.selected.includes(option.label)
            return (
              <label key={option.label} className={checked ? 'eq-option eq-option-on' : 'eq-option'}>
                <input
                  type={multi ? 'checkbox' : 'radio'}
                  name={`q-${question.id}`}
                  checked={checked}
                  onChange={() => { toggle(option.label) }}
                />
                {/* 自绘圆环:原生 radio/checkbox 在深色 UA 下会反色成「白实心」,
                    看起来像全部选中(2026-11-25 harness 深色实测);这里用
                    accent-fill 实心 + accent-on 勾/点,深浅主题都由令牌决定。 */}
                <span className='eq-mark' aria-hidden='true'>
                  {checked
                    ? (multi ? <Icon name='check' size={12} /> : <span className='eq-radio-dot' />)
                    : null}
                </span>
                <span className='eq-option-text'>
                  <span className='eq-option-label'>{option.label}</span>
                  {option.description !== undefined ? <span className='eq-option-desc'>{option.description}</span> : null}
                </span>
              </label>
            )
          })}
        </div>
      ) : null}
      <input
        className='et-input eq-custom'
        type='text'
        value={draft.custom}
        aria-label={hasOptions ? '其他，可补充说明' : '填写你的回答'}
        placeholder={hasOptions ? '其他（可补充说明）' : '填写你的回答'}
        onChange={event => { props.onChange({ ...draft, custom: event.target.value }) }}
      />
    </div>
  )
}

function QuestionCard(props: {
  readonly item: PendingQuestion
  readonly onDone: (id: string) => void
}): React.JSX.Element {
  const [drafts, setDrafts] = useState<Record<string, AnswerDraft>>({})
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | undefined>(undefined)
  const [edges, setEdges] = useState('')
  /** 当前呈第几题（0 基）。答案草稿按题 id 存在 drafts 里，切题不丢。 */
  const [step, setStep] = useState(0)
  const bodyRef = useRef<HTMLDivElement | null>(null)
  const total = props.item.questions.length
  const index = Math.min(step, Math.max(0, total - 1))
  const current = props.item.questions[index]
  const answered = useMemo(
    () => props.item.questions.filter(question => draftFilled(drafts[question.id])).length,
    [props.item.questions, drafts],
  )
  const allFilled = total > 0 && answered === total
  const go = (next: number): void => {
    if (total < 2) return
    setStep(Math.max(0, Math.min(next, total - 1)))
  }
  const remaining = Math.max(0, Math.round((props.item.expiresAt - Date.now()) / 1000))
  const windowMs = Math.max(1, props.item.expiresAt - props.item.requestedAt)
  const remainingRatio = Math.min(1, Math.max(0, (props.item.expiresAt - Date.now()) / windowMs))
  const titleId = anchorId('eq-title', props.item.id)

  // 题区是唯一滚动轴；边缘渐隐跟随滚动位置/内容高度变化（有遮住的内容才出现）。
  const syncEdges = (): void => { setEdges(readEdges(bodyRef.current)) }
  useEffect(() => {
    const body = bodyRef.current
    if (body === null) return
    body.addEventListener('scroll', syncEdges, { passive: true })
    window.addEventListener('resize', syncEdges)
    syncEdges()
    return () => {
      body.removeEventListener('scroll', syncEdges)
      window.removeEventListener('resize', syncEdges)
    }
  }, [])
  useEffect(() => { syncEdges() }, [drafts, error])
  // 切题时题区回到顶部，渐隐态在绘制前重算（否则会闪一帧上一题的滚动态）。
  useLayoutEffect(() => {
    const body = bodyRef.current
    if (body === null) return
    body.scrollTop = 0
    setEdges(readEdges(body))
  }, [index])

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
  // ←/→ 切题；焦点落在输入框/原生选项上时让位给原生键盘行为（方向键改选项/移光标）。
  const onKeyDown = (event: KeyboardEvent<HTMLElement>): void => {
    if (total < 2) return
    const target = event.target
    if (target instanceof Element
      && target.closest('input, textarea, select, [contenteditable="true"]') !== null) return
    if (event.key === 'ArrowLeft') {
      event.preventDefault()
      go(index - 1)
    } else if (event.key === 'ArrowRight') {
      event.preventDefault()
      go(index + 1)
    }
  }
  return (
    <section className='et-decision-card' data-kind='question' role='dialog' aria-modal='false'
      aria-labelledby={titleId} onKeyDown={onKeyDown}>
      {/* 倒计时是贴卡片顶边的 2px 条，不是独立一行（否则卡内出现一条横线切断内容） */}
      <div className='et-decision-track' aria-hidden='true'>
        <i style={{ width: `${String(remainingRatio * 100)}%` }} />
      </div>
      <header className='eq-head'>
        <div className='eq-head-main'>
          <span className='et-badge' data-tone='accent'>待回答</span>
          <h2 className='eq-title' id={titleId}>需要你的回答才能继续</h2>
        </div>
        {total > 1 ? <p className='eq-count'>已答 {String(answered)}/{String(total)}</p> : null}
      </header>
      {/* 切题时给读屏软件播报题号与题干；视觉上不可见 */}
      <p className='eq-sr' aria-live='polite' aria-atomic='true'>
        {current === undefined
          ? ''
          : `第 ${String(index + 1)} 题，共 ${String(total)} 题：${current.question}`}
      </p>
      <div className='eq-body-wrap' data-edge={edges}>
        <div className='eq-body' ref={bodyRef}>
          {current === undefined ? null : (
            <QuestionField
              key={current.id}
              question={current}
              draft={drafts[current.id]}
              onChange={(next) => { setDrafts(prev => ({ ...prev, [current.id]: next })) }}
            />
          )}
        </div>
      </div>
      {error !== undefined ? <p className='eq-error' role='alert'>{error}</p> : null}
      <footer className='eq-foot'>
        <p className='eq-meta'>{String(remaining)} 秒后自动放行（模型会说明未获回答继续）</p>
        <div className='et-card-actions eq-actions'>
          <button type='button' className='et-btn et-btn--ghost et-btn--sm' disabled={busy}
            onClick={() => { send({ skip: true }) }}>跳过本轮</button>
          {total > 1 ? (
            <div className='eq-stepper' role='group' aria-label='题目切换'>
              <button type='button' className='et-btn et-btn--ghost et-btn--sm eq-nav'
                aria-label='上一题' title='上一题' disabled={busy || index === 0}
                onClick={() => { go(index - 1) }}>
                <Icon name='chevron-right' size={16} className='eq-nav-flip' />
              </button>
              <span className='eq-step'>第 {String(index + 1)}/{String(total)} 题</span>
              <button type='button' className='et-btn et-btn--ghost et-btn--sm eq-nav'
                aria-label='下一题' title='下一题' disabled={busy || index === total - 1}
                onClick={() => { go(index + 1) }}>
                <Icon name='chevron-right' size={16} />
              </button>
            </div>
          ) : null}
          <button type='button' className='et-btn et-btn--primary et-btn--sm'
            disabled={busy || !allFilled} onClick={submitAnswers}>提交回答</button>
        </div>
      </footer>
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