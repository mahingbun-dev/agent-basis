/**
 * 回写条(P6):把参谋的结论送回主会话。
 *
 * ## 为什么放在参谋面板自己的 chrome 里,不占上游 slot
 * 回写是**参谋 tab 专属**的动作。上游 `conversation.composer.dock` 之类是按
 * **会话**作用域广播的槽位——从本插件注册进去,主会话的输入框下也会长出这条栏。
 * 因此本组件作为参谋面板的一段 chrome 渲染(对话区下方),与上游 slot 面无关。
 *
 * ## 双通道语义(计划书 §4 用户拍板)
 * - **附言**(`inject`):不唤醒主会话,主会话下次发言时才看到。代价低,用于补充背景。
 * - **立即发送**(`followup`):自成一轮,主会话立刻开始处理。会消耗一轮 token。
 *
 * 两者的产品语义差别很大,所以 UI 上必须**看起来不一样**:附言是次要按钮,
 * 立即发送是主按钮,且**两击确认**(AGENTS.md 铁律 3:破坏性/高代价操作两击确认,
 * 禁原生 confirm)。「立即发送」的第一次点击把文案换成「确认发送?」,
 * 3 秒无操作自动回落——既防误触,也不留下一个永久武装的按钮。
 *
 * ## 交互纪律
 * - 投递中禁用两个按钮并置 `aria-busy`(防重复点击);
 * - 成功/失败都在原位给回执,不弹窗;失败保留正文,不让人白写;
 * - 空白正文不发(fail-fast,不打服务端)。
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import type { ReactElement } from 'react'
import { Icon } from '@eterna/ui/icons'
import { deliverToParent } from './api.ts'
import type { AdviserDelivery } from './api.ts'
import { describeDeliveryError, nextConfirmState } from './feedback-machine.ts'
import type { ConfirmState } from './feedback-machine.ts'

/** 二次确认状态的自动回落时间(毫秒)。 */
const CONFIRM_TIMEOUT_MS = 3000

export interface AdviserFeedbackBarProps {
  readonly t: (key: string, params?: Record<string, unknown>) => string
  /** 主会话 id(投递目标)。 */
  readonly parent: string
}

/** 回执状态(原位展示,不弹窗)。 */
type Receipt =
  | { readonly kind: 'idle' }
  | { readonly kind: 'sending' }
  | { readonly kind: 'sent'; readonly delivery: AdviserDelivery }
  | { readonly kind: 'failed'; readonly message: string }

/** 参谋结论回写条。 */
export function AdviserFeedbackBar({ t, parent }: AdviserFeedbackBarProps): ReactElement {
  const [text, setText] = useState('')
  const [receipt, setReceipt] = useState<Receipt>({ kind: 'idle' })
  /** 「立即发送」的确认态(idle → armed → sending;语义见 feedback-machine)。 */
  const [confirmState, setConfirmState] = useState<ConfirmState>('idle')
  const confirmTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  /** 卸载后不再 setState(投递是异步的,tab 可能先被关掉)。 */
  const alive = useRef(true)

  useEffect(() => {
    alive.current = true
    return () => {
      alive.current = false
      if (confirmTimer.current !== undefined) clearTimeout(confirmTimer.current)
    }
  }, [])

  /** 撤下二次确认的武装态(超时/改正文/投递时都走这里)。 */
  const disarm = useCallback((): void => {
    if (confirmTimer.current !== undefined) {
      clearTimeout(confirmTimer.current)
      confirmTimer.current = undefined
    }
    setConfirmState('idle')
  }, [])

  const send = useCallback((delivery: AdviserDelivery): void => {
    const body = text.trim()
    if (body === '') return
    setReceipt({ kind: 'sending' })
    disarm()
    deliverToParent(parent, body, delivery)
      .then((result) => {
        if (!alive.current) return
        setReceipt({ kind: 'sent', delivery: result.delivery })
        // 成功才清空:失败时保留正文,不让人白写一遍。
        setText('')
      })
      .catch((error: unknown) => {
        if (!alive.current) return
        setReceipt({ kind: 'failed', message: describeDeliveryError(error, t) })
      })
  }, [disarm, parent, t, text])

  const sending = receipt.kind === 'sending'
  const empty = text.trim() === ''

  /** 「附言」直接发(inject 不唤醒,代价低)。 */
  const onInject = useCallback((): void => { send('inject') }, [send])

  /** 「立即发送」第一击武装、第二击真发(followup 会唤醒主会话)。 */
  const onFollowup = useCallback((): void => {
    if (sending || empty) return
    const step = nextConfirmState(confirmState)
    setConfirmState(step.next)
    if (step.action === 'arm') {
      confirmTimer.current = setTimeout(() => {
        if (alive.current) setConfirmState('idle')
        confirmTimer.current = undefined
      }, CONFIRM_TIMEOUT_MS)
      return
    }
    if (step.action === 'send') send('followup')
  }, [confirmState, empty, send, sending])

  return (
    <section data-eterna-adviser="feedback" aria-labelledby="et-adviser-feedback-heading">
      <h3 id="et-adviser-feedback-heading" className="et-adviser-feedback-title">
        <Icon name="comment" size={16} />
        {` ${t('feedback.title')}`}
      </h3>
      <label className="et-adviser-feedback-label" htmlFor="et-adviser-feedback-input">
        {t('feedback.label')}
      </label>
      <textarea
        id="et-adviser-feedback-input"
        className="et-adviser-feedback-input"
        rows={3}
        value={text}
        placeholder={t('feedback.placeholder')}
        disabled={sending}
        onChange={(event) => {
          setText(event.target.value)
          if (confirmState === 'armed') disarm()
          if (receipt.kind === 'sent' || receipt.kind === 'failed') setReceipt({ kind: 'idle' })
        }}
      />
      <div className="et-adviser-feedback-actions">
        <button
          type="button"
          className="et-adviser-button"
          onClick={onInject}
          disabled={sending || empty}
          aria-busy={sending}
          title={t('feedback.injectHint')}
        >
          {t('feedback.inject')}
        </button>
        <button
          type="button"
          className="et-adviser-button et-adviser-button--primary"
          onClick={onFollowup}
          disabled={sending || empty}
          aria-busy={sending}
          title={t('feedback.followupHint')}
          data-eterna-adviser-armed={confirmState === 'armed' ? '' : undefined}
        >
          {confirmState === 'armed' ? t('feedback.confirmFollowup') : t('feedback.followup')}
        </button>
      </div>
      <p className="et-adviser-feedback-hint">
        {t(confirmState === 'armed' ? 'feedback.confirmHint' : 'feedback.injectHint')}
      </p>
      {receipt.kind === 'sent' && (
        <p className="et-adviser-feedback-receipt" role="status">
          {receipt.delivery === 'inject' ? t('feedback.sent.inject') : t('feedback.sent.followup')}
        </p>
      )}
      {receipt.kind === 'failed' && (
        <p className="et-adviser-feedback-error" role="alert">{receipt.message}</p>
      )}
    </section>
  )
}
