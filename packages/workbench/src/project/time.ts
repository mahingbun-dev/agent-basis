/**
 * 业务时刻展示（2026-11-19 用户要求北京时间）：工作台服务端投影出的日志、工单轨迹与
 * 事件环时间一律按北京时间（Asia/Shanghai，恒 UTC+8、无夏令时）格式化，不随宿主机
 * TZ 漂移。
 *
 * 输入为引擎/审计落库的 ISO 串（`toISOString()`，恒 UTC Z 结尾）；非法值返回 undefined，
 * 调用方回落为「— / --:--」，不伪造时刻。排序键仍用原始 ISO（见 trace-files.sortKey）。
 */

/** 北京时间相对 UTC 的固定偏移（毫秒）。 */
const BEIJING_OFFSET_MS = 8 * 60 * 60 * 1000

const pad = (value: number): string => String(value).padStart(2, '0')

/** ISO 时刻的北京时间分量。 */
export interface BeijingParts {
  readonly year: string
  readonly month: string
  readonly day: string
  readonly hour: string
  readonly minute: string
  readonly second: string
}

/** 把 ISO 时刻拆成北京时间分量（固定 UTC+8，不依赖 Intl/宿主时区）。 */
export function beijingParts(iso: string | undefined): BeijingParts | undefined {
  if (iso === undefined) return undefined
  const ms = Date.parse(iso)
  if (Number.isNaN(ms)) return undefined
  const date = new Date(ms + BEIJING_OFFSET_MS)
  return {
    year: String(date.getUTCFullYear()),
    month: pad(date.getUTCMonth() + 1),
    day: pad(date.getUTCDate()),
    hour: pad(date.getUTCHours()),
    minute: pad(date.getUTCMinutes()),
    second: pad(date.getUTCSeconds()),
  }
}
