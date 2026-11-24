/**
 * 回写条的纯逻辑(从组件里抽出来,便于单测)。
 *
 * 组件(`AdviserFeedbackBar.tsx`)只做渲染与事件接线,所有「该不该发」的判定都在
 * 这里。分开的理由:确认态机的语义是产品承诺(哪些操作要二次确认、投递中能否
 * 再点),用 React 渲染函数测它代价高且易碎;纯函数一次就能钉死。
 */
import { AdviserApiError } from './api.ts'

/** 「立即发送」的确认态。 */
export type ConfirmState = 'idle' | 'armed' | 'sending'

/** 一次点击的判定结果:`action` 是要做的事,`next` 是新的确认态。 */
export interface ConfirmStep {
  readonly action: 'arm' | 'send' | 'none'
  readonly next: ConfirmState
}

/**
 * 推进「立即发送」的确认态机。
 * @param state - 当前态。
 * @param event - `disarm` 表示超时/正文变动导致的撤回;省略表示一次点击。
 * @returns 要做的事与新态。
 */
export function nextConfirmState(state: ConfirmState, event?: 'disarm'): ConfirmStep {
  if (event === 'disarm') return { action: 'none', next: 'idle' }
  if (state === 'sending') return { action: 'none', next: 'sending' }
  return state === 'armed'
    ? { action: 'send', next: 'idle' }
    : { action: 'arm', next: 'armed' }
}

/**
 * 把投递失败翻译成面向用户的中文。
 *
 * 401/404/503/429 用本命名空间的专句(它们要求用户做不同的事:重新登录 /
 * 换个会话 / 等一下 / 稍后重试);其余沿用服务端消息(服务端已是中文)。
 * @param error - 捕获到的异常。
 * @param t - 命名空间翻译函数。
 * @returns 展示给用户的文本。
 */
export function describeDeliveryError(error: unknown, t: (key: string) => string): string {
  if (error instanceof AdviserApiError) {
    if (error.status === 401) return t('feedback.error.unauthorized')
    if (error.status === 404) return t('feedback.error.parentMissing')
    if (error.status === 503) return t('feedback.error.unavailable')
    if (error.status === 429) return t('feedback.error.rateLimited')
    return error.message
  }
  return error instanceof Error ? error.message : String(error)
}
