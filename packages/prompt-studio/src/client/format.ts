/** 视图共用的小格式化助手(纯函数,无 React 依赖)。 */

const encoder = new TextEncoder()

/** UTF-8 字节数(与 Host 校验器 byteLength 同口径)。 */
export function utf8Bytes(text: string): number {
  return encoder.encode(text).length
}

/** ISO 时刻 → 人话短串(非法值回退原文)。 */
export function formatTime(iso: string | null | undefined): string {
  if (iso === undefined || iso === null || iso === '') return '—'
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return iso
  return date.toLocaleString('zh-CN', {
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

/** 毫秒时长 → 人话(≥1s 显示秒,否则毫秒;null → —)。 */
export function formatDuration(ms: number | null | undefined): string {
  if (ms === undefined || ms === null) return '—'
  if (ms >= 1000) return `${(ms / 1000).toFixed(1)}s`
  return `${Math.round(ms)}ms`
}

/**
 * 毫秒时长 → 长跨度人话(秒/分/小时三档;null → —)。
 *
 * 与 formatDuration 的分工:单个工具调用通常是毫秒到秒级(formatDuration 够用);
 * 而会话/轮次的总时长会到分钟甚至小时级,「1326.4s」这种读数无法一眼读懂。
 */
export function formatLongDuration(ms: number | null | undefined): string {
  if (ms === undefined || ms === null) return '—'
  if (ms >= 3_600_000) {
    const hours = ms / 3_600_000
    return `${hours >= 10 ? hours.toFixed(0) : hours.toFixed(1)} 小时`
  }
  if (ms >= 60_000) {
    const minutes = ms / 60_000
    return `${minutes >= 10 ? minutes.toFixed(0) : minutes.toFixed(1)} 分`
  }
  return formatDuration(ms)
}

/** 比例(0..1)→ 百分比串(一位小数;非法值回退 —)。 */
export function formatPercent(ratio: number | null | undefined): string {
  if (ratio === undefined || ratio === null || !Number.isFinite(ratio)) return '—'
  return `${(ratio * 100).toFixed(1)}%`
}

/** token 数 → 千分位串。 */
export function formatTokens(n: number | null | undefined): string {
  if (n === undefined || n === null) return '—'
  return n.toLocaleString('en-US')
}

/** 未知运行时值的单行人话预览(工具参数/错误兜底渲染用)。 */
export function previewText(value: unknown, limit = 160): string {
  const raw = typeof value === 'string'
    ? value
    : (JSON.stringify(value) as string | undefined) ?? String(value)
  return raw.length > limit ? `${raw.slice(0, limit)}…` : raw
}
