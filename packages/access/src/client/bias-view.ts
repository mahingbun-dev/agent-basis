/**
 * 偏置显示口径(纯函数,零 React 零 I/O):
 * 与判档侧共用同一个死区阈值——服务端有效偏置低于 `BIAS_DEAD_ZONE`(0.01)才归零
 * (thinking-score.ts),所以界面必须**同样从 0.01 起显示**,且不四舍五入到 0.1:
 * 否则 0.01–0.04 的偏置仍在参与判档,界面却整行隐藏且无重置入口(复核 F2)。
 */

/** 可见阈值:与 thinking-score.BIAS_DEAD_ZONE 同值(改一处必须改另一处,单测钉住)。 */
export const BIAS_VISIBLE_MIN = 0.01

/** 是否有可见偏置(非有限值按 0)。 */
export function biasVisible(effectiveBias: number | null | undefined): boolean {
  if (effectiveBias === null || effectiveBias === undefined) return false
  if (!Number.isFinite(effectiveBias)) return false
  return Math.abs(effectiveBias) >= BIAS_VISIBLE_MIN
}

export interface BiasLabel {
  /** 显示文案,如「已调深 +0.20」「已调浅 0.20」。 */
  readonly text: string
  /** 方向:up=向深,bottom=向浅。 */
  readonly direction: 'up' | 'down'
}

/** 偏置文案(两位小数;0 与不可见值返回 down/0.00,调用方先用 biasVisible 过滤)。 */
export function biasLabel(effectiveBias: number | null | undefined): BiasLabel {
  const value = effectiveBias === null || effectiveBias === undefined || !Number.isFinite(effectiveBias)
    ? 0
    : effectiveBias
  if (value > 0) return { text: `已调深 +${value.toFixed(2)}`, direction: 'up' }
  return { text: `已调浅 ${Math.abs(value).toFixed(2)}`, direction: 'down' }
}
