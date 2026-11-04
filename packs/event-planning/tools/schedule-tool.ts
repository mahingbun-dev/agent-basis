/**
 * 排期冲突检查器(13 号文档 §3 工具候选;golden annual-gala-timeline-8seg /
 * wedding-day-ceremony-flow / conference-runsheet-30min 的 must_call 目标)。
 *
 * 语义与 golden 的 script 断言同口径(分钟数时间线):
 * - 环节区间 [start, end) 用当日分钟数表示,要求 start < end;
 * - 任意两环节不得重叠(按开始时间排序后,前一环节的结束不得超过后一环节的开始);
 * - 给定活动时段窗口 [windowStart, windowEnd) 时,不得越出窗口。
 *
 * Cordis 纪律:注册表 + 唯一 ID(@event/schedule-tool),纯函数,零模型调用。
 */

/** 唯一 ID(注册表键;@event/* 命名空间)。 */
export const SCHEDULE_TOOL_SERVICE_ID = '@event/schedule-tool'

/** 一个环节(分钟数区间;owner 供分工表联动,可缺省)。 */
export interface ScheduleSegment {
  readonly name: string
  readonly startMinute: number
  readonly endMinute: number
  readonly owner?: string
}

/** 活动时段窗口(当日分钟数;缺省不检查越界)。 */
export interface ScheduleWindow {
  readonly startMinute?: number
  readonly endMinute?: number
}

/** 一对重叠环节(a 先开始;overlapMinutes > 0)。 */
export interface ScheduleOverlap {
  readonly a: string
  readonly b: string
  readonly overlapMinutes: number
}

/** 排期检查结果(ok = 无非法区间、无重叠、无越界)。 */
export interface ScheduleCheckResult {
  readonly ok: boolean
  /** 按开始时间排序(并列按结束时间)后的环节快照。 */
  readonly sortedSegments: readonly ScheduleSegment[]
  /** 非法区间(start >= end 或分钟数越出 0-1440)。 */
  readonly invalid: readonly string[]
  /** 重叠对(含重叠分钟数)。 */
  readonly overlaps: readonly ScheduleOverlap[]
  /** 越出活动时段窗口的环节名。 */
  readonly outOfWindow: readonly string[]
}

/** 可交换接口:任何提供同等 id 与能力的实现可整体替换本模块。 */
export interface EventScheduleTool {
  readonly id: typeof SCHEDULE_TOOL_SERVICE_ID
  /** 全量检查:排序 + 区间合法性 + 重叠 + 窗口越界。 */
  check(segments: readonly ScheduleSegment[], window?: ScheduleWindow): ScheduleCheckResult
  /** 仅重叠检测(golden script 的 awk 口径:按开始排序,后一个开始 < 此前最大结束即重叠)。 */
  findOverlaps(segments: readonly ScheduleSegment[]): readonly ScheduleOverlap[]
}

export function createScheduleTool(): EventScheduleTool {
  const overlapsOf = (sorted: readonly ScheduleSegment[]): ScheduleOverlap[] => {
    const out: ScheduleOverlap[] = []
    let runningEnd = -1
    let runningName = ''
    for (const seg of sorted) {
      if (runningEnd > seg.startMinute) {
        out.push({
          a: runningName,
          b: seg.name,
          overlapMinutes: runningEnd - seg.startMinute,
        })
      }
      if (seg.endMinute > runningEnd) {
        runningEnd = seg.endMinute
        runningName = seg.name
      }
    }
    return out
  }
  return {
    id: SCHEDULE_TOOL_SERVICE_ID,
    findOverlaps(segments) {
      return overlapsOf(byStart(segments))
    },
    check(segments, window) {
      const sorted = byStart(segments)
      const invalid: string[] = []
      for (const seg of sorted) {
        if (!(seg.startMinute < seg.endMinute) || seg.startMinute < 0 || seg.endMinute > 1440) {
          invalid.push(seg.name)
        }
      }
      const overlaps = overlapsOf(sorted)
      const outOfWindow: string[] = []
      for (const seg of sorted) {
        if (window?.startMinute !== undefined && seg.startMinute < window.startMinute) outOfWindow.push(seg.name)
        if (window?.endMinute !== undefined && seg.endMinute > window.endMinute) outOfWindow.push(seg.name)
      }
      return {
        ok: invalid.length === 0 && overlaps.length === 0 && outOfWindow.length === 0,
        sortedSegments: sorted,
        invalid,
        overlaps,
        outOfWindow,
      }
    },
  }
}

/** 按开始时间排序(并列按结束时间,再按名称稳定化)。 */
function byStart(segments: readonly ScheduleSegment[]): ScheduleSegment[] {
  return [...segments].sort(
    (a, b) => a.startMinute - b.startMinute || a.endMinute - b.endMinute || a.name.localeCompare(b.name),
  )
}
