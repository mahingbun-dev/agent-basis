/**
 * 压缩完成公告行(M-C4,21 号 §3-C2「压缩可感知」):分层压缩 L3 摘要落地后,
 * 会话流在该 turn 的动作区显示「上下文已压缩 N 次」单行——消灭"静默压缩"
 * (Claude Code issue #21925 教训:看不见的状态=故障,对齐本产品「会话挂起=审批未决」
 * 既有结论)。
 *
 * ★ 2026-11-18 事故修复(生产「无法加载历史会话记录」):
 *   旧实现按 compactionId 建 Context、由每个 Context 各自发布 turn 相位的同名
 *   Location data。上游 location-index.ts:227 `replaceData` 的不变式是
 *   **同一 (turn, key) 只许一个 owner 发布**,第二个 owner 直接抛
 *   `conversation Location data "compaction-announcements" is already owned by …`。
 *   复现:session-77e8fdd9 的 turn 1 内发生 13 次压缩(2 turn/14 次压缩的长会话),
 *   重载历史时 13 个 Context 抢同一 turn 键 → 异常冒到 session-controller 的
 *   event feed subscriber → 订阅器整体失败 → 对话区空白、只剩「加载更早」。
 *   实时链路走 applyData(不抛)所以运行中不炸,只在回放/重载时炸——故此前未暴露。
 *
 *   修法=改走上游 deliverables 同款范式(turn-deliverables.ts:175「id = String(turn)」):
 *   Context 按 turn 键控,只匹配**自带 turn 的事件**(turn/start 建组,
 *   compaction/start、compaction/end 累计)。compaction/summary 载荷没有 turn
 *   (dsh-compaction-basic lib/index.js commitCompactionBody 只写 compactionId),
 *   引擎路由纯按 id,故 summary 无法投递到 turn 键控的 Context——公告行因此只展示
 *   「压缩次数」(释放量/摘要模型的累计仍可在设置分区「上下文压缩」读取,那里口径是
 *   会话级、由 Host 统计,不受本修复影响)。
 *
 * 数据面两步:
 * 第 1 步——ConversationNodeDefinition 累计器:turn/start 建组(role start),
 * compaction/start 计一次尝试、compaction/end 计一次完成(end.data.error 存在记失败)。
 * Session-log 回放天然复现公告(零 Host 改动)。
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
  /** 该 turn 内**完成**的压缩次数(compaction/end 且无 error)。 */
  readonly count: number
  /** 该 turn 内失败的压缩次数(compaction/end 携带 error)。 */
  readonly failed: number
}

/** Definition 状态:turn 号 + 公告累计。 */
export interface CompactionAnnouncementState {
  readonly turn: number
  readonly count: number
  readonly failed: number
}

/** 防御收窄:事件自带数值 turn(compaction/summary 无 turn,故不参与)。 */
function turnOf(event: { type: string; data?: Record<string, unknown> }): number | null {
  const turn = event.data?.turn
  return typeof turn === 'number' && Number.isSafeInteger(turn) && turn >= 0 ? turn : null
}

/**
 * match:turn/start 建组;compaction/start、compaction/end 累计(两者都自带 turn)。
 * 幂等纯函数——上游引擎会在分页前插时重放,故不得依赖任何外部状态。
 */
export function compactionAnnouncementMatch(event: { type: string; data?: Record<string, unknown> }):
{ id: string; role: 'start' | 'update' } | null {
  if (event.type === 'turn/start') {
    const turn = turnOf(event)
    return turn === null ? null : { id: String(turn), role: 'start' }
  }
  if (event.type === 'compaction/start' || event.type === 'compaction/end') {
    const turn = turnOf(event)
    return turn === null ? null : { id: String(turn), role: 'update' }
  }
  return null
}

/** start:turn/start 建初始状态(turn 号取自事件负载)。 */
export function compactionAnnouncementStart(
  _context: { readonly key: string; readonly kind: string; readonly id: string },
  match: { readonly event: { type: string; data?: Record<string, unknown> } },
): CompactionAnnouncementState {
  if (match.event.type !== 'turn/start') throw new Error('compaction-announcements start requires turn/start')
  const turn = turnOf(match.event)
  if (turn === null) throw new Error('compaction-announcements start requires turn')
  return { turn, count: 0, failed: 0 }
}

/** update:start 计尝试不计入;end 按是否携带 error 计完成/失败(不可变更新)。 */
export function compactionAnnouncementUpdate(
  context: { readonly state: CompactionAnnouncementState },
  match: { readonly event: { type: string; data?: Record<string, unknown> } },
): CompactionAnnouncementState {
  if (match.event.type !== 'compaction/end') return context.state
  const failed = match.event.data?.error !== undefined
  return {
    ...context.state,
    count: failed ? context.state.count : context.state.count + 1,
    failed: failed ? context.state.failed + 1 : context.state.failed,
  }
}

/** buildLocationData:turn 相位发布公告值(值身份不变时返回 previous)。 */
export function compactionAnnouncementBuildLocationData(
  context: { readonly state?: CompactionAnnouncementState },
  scope: 'turn' | 'step',
  previous: { kind: string; turn: number; key: string; value: unknown } | null,
): { kind: 'turn'; turn: number; key: string; value: CompactionAnnouncementTurnData } | null {
  if (scope !== 'turn') return null
  const state = context.state
  // 分页窗口若缺 turn/start,Context 只有 update 无 state:不发布,等前插补齐后重放。
  if (state === undefined) return null
  const value: CompactionAnnouncementTurnData = { count: state.count, failed: state.failed }
  if (previous?.kind === 'turn' && previous.turn === state.turn
    && previous.key === COMPACTION_ANNOUNCEMENT_DATA_KEY) {
    const previousValue = previous.value as CompactionAnnouncementTurnData
    if (previousValue.count === value.count && previousValue.failed === value.failed) {
      return previous as { kind: 'turn'; turn: number; key: string; value: CompactionAnnouncementTurnData }
    }
  }
  return { kind: 'turn', turn: state.turn, key: COMPACTION_ANNOUNCEMENT_DATA_KEY, value }
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
  return value !== undefined && (value.count > 0 || value.failed > 0) ? value : null
}

/** 压缩完成公告行(单行 + 展开看失败提示与统计入口)。 */
export function CompactionAnnouncementTail(props: CompactionAnnouncementTailProps): ReactElement | null {
  const { turn, t, openPanel } = props
  const [expanded, setExpanded] = useState(false)
  const announcement = selectCompactionAnnouncement(turn)
  if (announcement === null) return null
  const label = t?.('announcementLine') ?? '上下文已压缩'
  const detailLabel = t?.('announcementDetail') ?? '查看详情'
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
        <span data-eterna-compaction="announcement-count">
          {`${announcement.count} 次`}
        </span>
      </button>
      {expanded && (
        <ul data-eterna-compaction="announcement-list">
          <li>{`本次 turn 完成压缩 ${announcement.count} 次`}</li>
          {announcement.failed > 0 && (
            <li data-eterna-compaction="announcement-failed">
              {`失败 ${announcement.failed} 次（原文未替换，可重试）`}
            </li>
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