/**
 * 面板数字格式(纯函数,单测钉死):千分位、百分比、耗时、成本。
 * 一律用中文习惯与固定小数位,避免同一数字在不同屏上跳动。
 */

/** 千分位整数(负数保留符号). */
export function formatInt(value: number): string {
  const rounded = Math.round(value)
  return `${rounded < 0 ? '-' : ''}${Math.abs(rounded).toLocaleString('zh-CN')}`
}

/** 百分比一位小数(入参已是 0–100 的百分数). */
export function formatPercent(percentValue: number): string {
  return `${percentValue.toFixed(1)}%`
}

/** 毫秒 → 「1.2 秒」/「2 分 05 秒」(>=1 分钟换分秒). */
export function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return '—'
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)} 秒`
  const minutes = Math.floor(ms / 60_000)
  const seconds = Math.round((ms % 60_000) / 1000)
  return `${minutes} 分 ${String(seconds).padStart(2, '0')} 秒`
}

/** 美元成本(自适应小数位:>=1 两位,>=0.01 四位,其余六位). */
export function formatCost(usd: number): string {
  if (!Number.isFinite(usd) || usd < 0) return '—'
  if (usd >= 1) return `$${usd.toFixed(2)}`
  if (usd >= 0.01) return `$${usd.toFixed(4)}`
  return `$${usd.toFixed(6)}`
}

/** 快照生成时刻 → 「14:05:09」本地时间(只用于「更新于」一行). */
export function formatClock(epochMs: number): string {
  const date = new Date(epochMs)
  const pad = (value: number): string => String(value).padStart(2, '0')
  return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
}
