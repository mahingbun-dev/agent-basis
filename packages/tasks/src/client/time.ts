/**
 * 业务时刻展示（2026-11-19 用户反馈「我需要北京时间」）：一律按北京时间
 * （Asia/Shanghai，恒 UTC+8、无夏令时）格式化，不随浏览器/宿主机时区漂移。
 *
 * 输入是引擎落库的 ISO 串（`new Date().toISOString()`，恒 UTC Z 结尾）；非法值返回
 * undefined，调用方回落为「不显示时间」，不伪造时刻。
 */

/** 北京时间相对 UTC 的固定偏移（毫秒）。 */
const BEIJING_OFFSET_MS = 8 * 60 * 60 * 1000

/** 两位数字（00–59 / 01–12 等）。 */
const pad = (value: number): string => String(value).padStart(2, '0')

/** ISO 时刻 → 北京时间分量；非法/空值返回 undefined。 */
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

/** ISO 时刻 → 「MM-DD HH:mm」（排队/正文候选 chip 的紧凑时间）。 */
export function beijingMinute(iso: string | undefined): string | undefined {
  const parts = beijingParts(iso)
  return parts === undefined ? undefined : `${parts.month}-${parts.day} ${parts.hour}:${parts.minute}`
}

/** ISO 时刻 → 「YYYY-MM-DD HH:mm」（title 等完整展示）。 */
export function beijingFull(iso: string | undefined): string | undefined {
  const parts = beijingParts(iso)
  return parts === undefined ? undefined : `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}`
}
