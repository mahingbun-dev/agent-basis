/**
 * Sources 行(M-M3 T12-④,19 号 §5-T12.4 + 勘察 S3 结论主路径):
 *
 * 第 1 步——会话事件累计器(dsh-client-ui-conversation 的 ConversationNodeDefinition
 * 形态;deliverables 包 client.js 的 deliverablesDefinition 同构):match 抓
 * turn/start + memory_read/memory_search 的 tool/call、tool/result,按 turn 归并;
 * 命中条目**直读 tool/result 的 meta**(S3 结论 b 路径——memory 工具经
 * ToolOutputDefinition.presentationMeta 投影持久化,「Session log replay
 * reproduces the card with no Host change」;零 JSON 解析)。引擎的 Conversation
 * Location 索引先于定义运行,记录不会跨 turn 溢出(schedule 包同款注释)。
 *
 * 第 2 步——turnTail 槽位消费(conversation.chat.turnTail,list,session 作用域;
 * 只在 completed Turn 的动作行前渲染,语义=「本回合用到 N 条记忆」;历史会话
 * 回放天然复现):owner.turn.data.get('memory-sources') 取累计值,无数据返回
 * null 不挂载(deliverables selectProducedFiles 同款闸);点击展开条目
 * (title+summary)并可跳转基座面板(layout.selectMainPanel)。
 *
 * UI 纪律(AGENTS.md):--et-* 令牌、@eterna/ui/icons、文案中文、无字面色值。
 */
import { useState, type ReactElement } from 'react'
import { Icon } from '@eterna/ui/icons'
import type {
  ConversationLocationDataLike, ConversationMatchLike, ConversationNodeContextLike,
  SessionEventLike, TurnLocationLike,
} from './client-types.ts'

/** 本插件的 Location data 键(与 buildLocationData 的 key 一致;turnTail 读取同键)。 */
export const MEMORY_SOURCES_DATA_KEY = 'memory-sources'

/** 记忆工具名(与宿主面 MEMORY_TOOL_NAMES 的读取子集同真值;构建期各自内联)。 */
export const MEMORY_SOURCE_TOOLS: readonly string[] = ['memory_read', 'memory_search']

/** 单条记忆来源条目(与宿主面 MemorySourceEntry 同形;meta 直读的载荷)。 */
export interface MemorySourceEntry {
  readonly source: string
  readonly kind: 'entity' | 'note'
  readonly title: string
  readonly summary: string
}

/** 本回合记忆来源累计值(turnTail 的 Location data 值)。 */
export interface MemorySourcesTurnData {
  readonly reads: readonly MemorySourceEntry[]
}

/** Definition 状态:turn 号 + 按会话累计的命中条目 + 进行中的记忆工具调用。 */
export interface MemorySourcesState {
  readonly turn: number
  readonly reads: readonly MemorySourceEntry[]
  readonly calls: ReadonlyMap<string, string>
}

/** 防御收窄 tool/result 的 meta 载荷(与宿主面 MemorySourcesMeta 同形)。 */
export function sourcesFromMeta(meta: unknown): readonly MemorySourceEntry[] {
  if (typeof meta !== 'object' || meta === null) return []
  const record = meta as Record<string, unknown>
  if (!MEMORY_SOURCE_TOOLS.includes(String(record.tool))) return []
  if (!Array.isArray(record.reads)) return []
  const reads: MemorySourceEntry[] = []
  for (const raw of record.reads) {
    if (typeof raw !== 'object' || raw === null) continue
    const entry = raw as Record<string, unknown>
    if (typeof entry.source !== 'string' || typeof entry.title !== 'string') continue
    if (entry.kind !== 'entity' && entry.kind !== 'note') continue
    reads.push({
      source: entry.source,
      kind: entry.kind,
      title: entry.title,
      summary: typeof entry.summary === 'string' ? entry.summary : '',
    })
  }
  return reads
}

/** match:抓 turn/start 与记忆工具的 call/result(其余事件不相关)。 */
export function memorySourcesMatch(event: SessionEventLike): { id: string; role: 'start' | 'update' } | null {
  const data = event.data
  // 2026-11-16 诊断(定位 sources-row 未渲染;定位后移除):记录事件类型与关键载荷。
  if (event.type === 'tool/call' || event.type === 'tool/result' || event.type === 'turn/start') {
    const meta = (data as Record<string, unknown> | undefined)?.meta
    console.info('[memory-sources:match]', event.type,
      'turn=', (data as Record<string, unknown> | undefined)?.turn,
      'name=', (data as Record<string, unknown> | undefined)?.name,
      'meta=', typeof meta === 'object' ? JSON.stringify(meta)?.slice(0, 200) : meta)
  }
  if (event.type === 'turn/start') {
    const turn = data?.turn
    return typeof turn === 'number' ? { id: String(turn), role: 'start' } : null
  }
  if (event.type === 'tool/call') {
    const turn = data?.turn
    return typeof turn === 'number' && MEMORY_SOURCE_TOOLS.includes(String(data?.name))
      ? { id: String(turn), role: 'update' }
      : null
  }
  if (event.type === 'tool/result') {
    const turn = data?.turn
    return typeof turn === 'number' && sourcesFromMeta(data?.meta).length > 0
      ? { id: String(turn), role: 'update' }
      : null
  }
  return null
}

/** start:turn/start 建初始状态(空累计;非 turn/start 起源属契约违例,抛错)。 */
export function memorySourcesStart(_context: ConversationNodeContextLike, match: ConversationMatchLike): MemorySourcesState {
  if (match.event.type !== 'turn/start') throw new Error('memory-sources start requires turn/start')
  const turn = match.event.data?.turn
  if (typeof turn !== 'number') throw new Error('memory-sources start requires turn/start payload turn')
  return { turn, reads: [], calls: new Map() }
}

/**
 * update:tool/call 记调用身份(name ∈ 记忆工具),tool/result 按 callId 配对后
 * 追加 meta 条目(source 去重,首见序;不可变更新,deliverables 同款)。
 */
export function memorySourcesUpdate(
  context: ConversationNodeContextLike & { readonly state: MemorySourcesState },
  match: ConversationMatchLike,
): MemorySourcesState {
  const event = match.event
  const data = event.data
  if (event.type === 'tool/call') {
    const callId = data?.callId
    const name = data?.name
    if (typeof callId !== 'string' || typeof name !== 'string' || !MEMORY_SOURCE_TOOLS.includes(name)) {
      return context.state
    }
    const calls = new Map(context.state.calls)
    calls.set(callId, name)
    return { ...context.state, calls }
  }
  if (event.type !== 'tool/result') return context.state
  const message = data?.message
  const callId = typeof message === 'object' && message !== null
    ? (message as Record<string, unknown>).source
    : undefined
  const pairedCallId = typeof callId === 'object' && callId !== null
    ? String((callId as Record<string, unknown>).callId)
    : undefined
  const toolName = pairedCallId !== undefined ? context.state.calls.get(pairedCallId) : undefined
  const incoming = sourcesFromMeta(data?.meta)
  if (incoming.length === 0) return context.state
  if (toolName === undefined) return context.state // 无配对调用(页载旧结果):不归属本回合累计
  const seen = new Set(context.state.reads.map(entry => entry.source))
  const merged = [...context.state.reads]
  for (const entry of incoming) {
    if (seen.has(entry.source)) continue
    seen.add(entry.source)
    merged.push(entry)
  }
  return { ...context.state, reads: merged }
}

/** buildLocationData:turn 相位发布累计值(值身份不变时返回 previous,交付量同款)。 */
export function memorySourcesBuildLocationData(
  context: ConversationNodeContextLike & { readonly state: MemorySourcesState },
  scope: 'turn' | 'step',
  previous: ConversationLocationDataLike | null,
): ConversationLocationDataLike | null {
  if (scope !== 'turn') return null
  const reads = context.state.reads
  // 2026-11-16 诊断(定位 sources-row 未渲染;定位后移除)。
  console.info('[memory-sources:locdata]', 'turn=', context.state.turn, 'reads=', reads.length)
  if (previous?.kind === 'turn' && previous.turn === context.state.turn
    && previous.key === MEMORY_SOURCES_DATA_KEY
    && (previous.value as MemorySourcesTurnData).reads === reads) {
    return previous
  }
  return {
    kind: 'turn',
    turn: context.state.turn,
    key: MEMORY_SOURCES_DATA_KEY,
    value: { reads } satisfies MemorySourcesTurnData,
  }
}

/** 会话事件累计器(apply 里 uiConversation.events.register 的入参)。 */
export const memorySourcesDefinition = {
  kind: MEMORY_SOURCES_DATA_KEY,
  match: memorySourcesMatch,
  start: memorySourcesStart,
  update: memorySourcesUpdate,
  buildLocationData: memorySourcesBuildLocationData,
}

// ---------- turnTail 消费(第 2 步) ----------

/** turnTail 条目 props(官方 owner + 本插件 inject 面翻译函数与跳转回调)。 */
export interface MemorySourcesTailProps {
  readonly turn: TurnLocationLike
  readonly t?: (key: string) => string
  /** 跳转基座面板(apply 注入 layout.selectMainPanel);缺席=仅展开不跳转。 */
  readonly openPanel?: () => void
}

/**
 * Sources 行数据闸(2026-11-16 修复,S-6 同轮取证):turnTail 条目收到的
 * `turn` prop **就是 TurnLocation 本身**(宿主 ContextualEntry 把 ownerProps
 * 摊平进条目 props——生产 fiber 反查 keys=turn/start/end/status/steps/data
 * 实证),读 Location 的 data store 应直接 `.data.get(key)`;此前实现误再解
 * 一层 `.turn`(number→`.data`=undefined)导致行恒不挂载。无数据返回 null
 * 不挂载(deliverables 同款闸)。
 */
export function selectMemorySources(turn: TurnLocationLike): readonly MemorySourceEntry[] | null {
  const value = turn.data?.get(MEMORY_SOURCES_DATA_KEY) as MemorySourcesTurnData | undefined
  const reads = value?.reads
  return reads !== undefined && reads.length > 0 ? reads : null
}

/** 「本回合用到 N 条记忆」行(点击展开条目;可跳转面板)。 */
export function MemorySourcesTail(props: MemorySourcesTailProps): ReactElement | null {
  const { turn, t, openPanel } = props
  const [expanded, setExpanded] = useState(false)
  const reads = selectMemorySources(turn)
  if (reads === null) return null
  const label = t?.('sources.line') ?? '本回合用到记忆'
  const jumpLabel = t?.('sources.jump') ?? '查看记忆'
  return (
    <div data-eterna-memory="sources-row" data-eterna-memory-sources={String(turn.turn)}>
      <button
        type="button"
        data-eterna-memory="sources-toggle"
        aria-expanded={expanded}
        onClick={() => { setExpanded(value => !value) }}
      >
        <Icon name={expanded ? 'chevron-down' : 'chevron-right'} size={12} />
        <span data-eterna-memory="sources-count">{reads.length}</span>
        <span>{label}</span>
      </button>
      {expanded && (
        <ul data-eterna-memory="sources-list">
          {reads.map(entry => (
            <li key={entry.source} data-eterna-memory="sources-item" data-eterna-memory-source={entry.source}>
              <span data-eterna-memory="sources-title">{entry.title}</span>
              {entry.summary !== '' && <span data-eterna-memory="sources-summary">{entry.summary}</span>}
            </li>
          ))}
          {openPanel !== undefined && (
            <li>
              <button type="button" data-eterna-memory="sources-jump" onClick={openPanel}>
                <Icon name="arrow-right" size={12} />{jumpLabel}
              </button>
            </li>
          )}
        </ul>
      )}
    </div>
  )
}
