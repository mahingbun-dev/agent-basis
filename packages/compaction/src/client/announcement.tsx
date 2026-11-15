/**
 * 压缩完成公告行(M-C4,21 号 §3-C2「压缩可感知」):分层压缩 L3 摘要落地后,
 * 会话流在该 turn 的动作区显示「上下文已压缩 N 次 · 释放约 X tokens」单行,
 * 可展开查看摘要模型与次数——消灭"静默压缩"(Claude Code issue #21925 教训:
 * 看不见的状态=故障,对齐本产品「会话挂起=审批未决」既有结论)。
 *
 * 数据面照 memory sources.tsx 先例(S3 结论主路径)两步:
 * 第 1 步——ConversationNodeDefinition 累计器:match 抓 compaction/start(自带
 * turn,作归组锚;turn=null 的 idle 手动压缩保守跳过)与 compaction/summary
 * (shadowedTokenCount/provider/model 累计;summary 事件落盘≈提交成功——
 * region.ts 事务里 summary 与 checkpoint 同步 commit,失败在 summarize 阶段
 * 则无 summary 事件)。Session-log 回放天然复现公告(零 Host 改动)。
 * 第 2 步——turnTail 槽位消费(conversation.chat.turnTail):owner.turn.data
 * 无数据返回 null 不挂载(deliverables/memory-sources 同款闸)。
 *
 * UI 纪律(AGENTS.md):--et-* 令牌、@eterna/ui/icons、文案中文、无字面色值。
 */
import { useState, type ReactElement } from 'react'
import { Icon } from '@eterna/ui/icons'

/** 本插件的 Location data 键(与 buildLocationData 的 key 一致;turnTail 读取同键)。 */
export const COMPACTION_ANNOUNCEMENT_DATA_KEY = 'compaction-announcements'

/** 单 turn 压缩公告累计值(turnTail 的 Location data 值)。 */
export interface CompactionAnnouncementTurnData {
  /** 该 turn 内压缩次数(compaction/summary 事件数)。 */
  readonly count: number
  /** 释放量合计(各次 shadowedTokenCount 求和)。 */
  readonly savedTokens: number
  /** 参与摘要的模型(provider/model 去重,首见序)。 */
  readonly models: readonly string[]
}

/** Definition 状态:turn 号 + 公告累计。 */
export interface CompactionAnnouncementState {
  readonly turn: number
  readonly count: number
  readonly savedTokens: number
  readonly models: readonly string[]
}

/** 防御收窄 compaction/summary 载荷(事件 schema 见 dsh-compaction types)。 */
function summaryPayloadOf(data: Record<string, unknown> | undefined): {
  savedTokens: number
  model: string
} | null {
  const savedTokens = data?.shadowedTokenCount
  if (typeof savedTokens !== 'number' || savedTokens <= 0) return null
  const provider = typeof data?.provider === 'string' ? data.provider : ''
  const model = typeof data?.model === 'string' ? data.model : ''
  return { savedTokens, model: provider.length > 0 ? `${provider}/${model}` : model }
}

/** match:compaction/start 建组(带 turn 才收),compaction/summary 累计。 */
export function compactionAnnouncementMatch(event: { type: string; data?: Record<string, unknown> }):
{ id: string; role: 'start' | 'update' } | null {
  if (event.type === 'compaction/start') {
    const compactionId = event.data?.compactionId
    const turn = event.data?.turn
    return typeof compactionId === 'string' && typeof turn === 'number'
      ? { id: compactionId, role: 'start' }
      : null
  }
  if (event.type === 'compaction/summary') {
    const compactionId = event.data?.compactionId
    return typeof compactionId === 'string' && summaryPayloadOf(event.data) !== null
      ? { id: compactionId, role: 'update' }
      : null
  }
  return null
}

/** start:compaction/start 建初始状态(turn 号取自事件负载)。 */
export function compactionAnnouncementStart(
  _context: { readonly key: string; readonly kind: string; readonly id: string },
  match: { readonly event: { type: string; data?: Record<string, unknown> } },
): CompactionAnnouncementState {
  if (match.event.type !== 'compaction/start') throw new Error('compaction-announcements start requires compaction/start')
  const turn = match.event.data?.turn
  if (typeof turn !== 'number') throw new Error('compaction-announcements start requires turn')
  return { turn, count: 0, savedTokens: 0, models: [] }
}

/** update:compaction/summary 累计释放量与模型(不可变更新)。 */
export function compactionAnnouncementUpdate(
  context: { readonly state: CompactionAnnouncementState },
  match: { readonly event: { type: string; data?: Record<string, unknown> } },
): CompactionAnnouncementState {
  if (match.event.type !== 'compaction/summary') return context.state
  const payload = summaryPayloadOf(match.event.data)
  if (payload === null) return context.state
  const models = context.state.models.includes(payload.model) || payload.model === ''
    ? context.state.models
    : [...context.state.models, payload.model]
  return {
    ...context.state,
    count: context.state.count + 1,
    savedTokens: context.state.savedTokens + payload.savedTokens,
    models,
  }
}

/** buildLocationData:turn 相位发布公告值(值身份不变时返回 previous)。 */
export function compactionAnnouncementBuildLocationData(
  context: { readonly state: CompactionAnnouncementState },
  scope: 'turn' | 'step',
  previous: { kind: string; turn: number; key: string; value: unknown } | null,
): { kind: 'turn'; turn: number; key: string; value: CompactionAnnouncementTurnData } | null {
  if (scope !== 'turn') return null
  const value: CompactionAnnouncementTurnData = {
    count: context.state.count,
    savedTokens: context.state.savedTokens,
    models: context.state.models,
  }
  if (previous?.kind === 'turn' && previous.turn === context.state.turn
    && previous.key === COMPACTION_ANNOUNCEMENT_DATA_KEY) {
    const previousValue = previous.value as CompactionAnnouncementTurnData
    if (previousValue.count === value.count && previousValue.savedTokens === value.savedTokens
      && previousValue.models === value.models) {
      return previous as { kind: 'turn'; turn: number; key: string; value: CompactionAnnouncementTurnData }
    }
  }
  return { kind: 'turn', turn: context.state.turn, key: COMPACTION_ANNOUNCEMENT_DATA_KEY, value }
}

/** 累计器 Definition(apply 里 uiConversation.events.register 的入参)。 */
export const compactionAnnouncementDefinition = {
  kind: COMPACTION_ANNOUNCEMENT_DATA_KEY,
  match: compactionAnnouncementMatch,
  start: compactionAnnouncementStart,
  update: compactionAnnouncementUpdate,
  buildLocationData: compactionAnnouncementBuildLocationData,
}

/** turnTail 条目 props(官方 owner 结构子集 + 可选翻译/跳转)。 */
export interface CompactionAnnouncementTailProps {
  readonly turn: {
    readonly turn: number
    readonly data: { get(key: string): unknown }
  }
  readonly t?: (key: string) => string
  /** 跳转基座面板(apply 注入 layout.selectMainPanel);缺席=仅展开。 */
  readonly openPanel?: () => void
}

/** owner.turn.data 无公告数据返回 null 不挂载(deliverables/memory-sources 同款闸)。 */
export function selectCompactionAnnouncement(
  owner: CompactionAnnouncementTailProps['turn'],
): CompactionAnnouncementTurnData | null {
  const value = owner.data?.get(COMPACTION_ANNOUNCEMENT_DATA_KEY) as CompactionAnnouncementTurnData | undefined
  return value !== undefined && value.count > 0 ? value : null
}

/** 压缩完成公告行(单行 + 展开看模型与次数)。 */
export function CompactionAnnouncementTail(props: CompactionAnnouncementTailProps): ReactElement | null {
  const { turn, t, openPanel } = props
  const [expanded, setExpanded] = useState(false)
  const announcement = selectCompactionAnnouncement(turn)
  if (announcement === null) return null
  const label = t?.('announcement.line') ?? '上下文已压缩'
  const detailLabel = t?.('announcement.detail') ?? '查看详情'
  return (
    <div data-eterna-compaction="announcement-row" data-eterna-compaction-turn={String(turn.turn)}>
      <button
        type="button"
        data-eterna-compaction="announcement-toggle"
        aria-expanded={expanded}
        onClick={() => { setExpanded(value => !value) }}
      >
        <Icon name={expanded ? 'chevron-down' : 'chevron-right'} size={12} />
        <span>{label}</span>
        <span data-eterna-compaction="announcement-saved">
          {`释放约 ${announcement.savedTokens} tokens`}
        </span>
      </button>
      {expanded && (
        <ul data-eterna-compaction="announcement-list">
          <li>{`本次 turn 压缩 ${announcement.count} 次`}</li>
          {announcement.models.length > 0 && (
            <li>{`摘要模型:${announcement.models.join('、')}`}</li>
          )}
          {openPanel !== undefined && (
            <li>
              <button type="button" data-eterna-compaction="announcement-jump" onClick={openPanel}>
                <Icon name="arrow-right" size={12} />{detailLabel}
              </button>
            </li>
          )}
        </ul>
      )}
    </div>
  )
}
