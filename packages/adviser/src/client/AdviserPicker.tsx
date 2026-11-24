/**
 * 参谋选择/新建面板(页面地址 tab 的正文)。
 *
 * 职责:列出主会话下已有的参谋(多开时是一个列表),并允许新建。选中/新建后由
 * 上层把本 tab 换成对应的资源 tab(见 AdviserPanel 的 openTarget)。
 *
 * ## 数据面
 * 全部走 eterna-access 的守卫路由(`/access/api/adviser/*`)——铁律 T2:插件
 * 不自注册 Web 路由,也不直连内核服务。身份靠同源 cookie,本组件不碰凭据。
 *
 * ## 交互纪律(AGENTS.md 铁律 3)
 * 变更请求防重复点击:创建期间按钮置忙且禁用;失败原位报错不弹窗。
 * 破坏性操作这里没有(关闭参谋走 tab 的关闭按钮)。
 */
import { useCallback, useEffect, useState } from 'react'
import type { ReactElement } from 'react'
import { Icon } from '@eterna/ui/icons'
import { AdviserApiError, createAdviser, listAdvisers } from './api.ts'
import type { AdviserRowView } from './api.ts'
import { takePendingSelection } from './entries.ts'

export interface AdviserPickerProps {
  readonly t: (key: string, params?: Record<string, unknown>) => string
  /** 主会话 id(路由的 parent 参数)。 */
  readonly parent: string
  /** 选/建成功后回传参谋会话 id。 */
  readonly onPick: (childSessionId: string, parent: string) => void
}

type LoadPhase =
  | { readonly kind: 'loading' }
  | { readonly kind: 'ready'; readonly rows: readonly AdviserRowView[] }
  | { readonly kind: 'failed'; readonly message: string }

/** 默认首条消息:让参谋一开局就知道自己是参谋、该做什么。 */
function defaultSeed(): string {
  return '你现在担任这次会话的参谋:只做调研、梳理与建议,不改文件、不执行命令。请先读主会话最近的内容,再用一两句话说明你看到的主线是什么。'
}

/**
 * 带选区的新建首条消息(P7「选中文字」入口)。
 *
 * 用户划选一段文字后点「问参谋」,得到的参谋应当**从这段文字出发**——否则
 * 他还得再解释一遍自己指的是哪段。选区原样引用(加引号块),再由参谋自己
 * 决定读多少上下文。
 * @param selection - 用户选中的原文。
 * @returns 首条消息文本。
 */
function seedWithSelection(selection: string): string {
  return `你现在担任这次会话的参谋:只做调研、梳理与建议,不改文件、不执行命令。\n\n用户从主会话里选中了下面这段文字,请从它出发理解用户想问什么:\n\n> ${selection.split('\n').join('\n> ')}`
}

/** 服务端错误转中文提示(401/503 要能被用户看懂)。 */
function describeError(error: unknown, t: AdviserPickerProps['t']): string {
  if (error instanceof AdviserApiError) {
    if (error.status === 401) return t('picker.error.unauthorized')
    if (error.status === 503) return t('picker.error.unavailable')
    if (error.status === 429) return t('picker.error.rateLimited')
    return error.message
  }
  return error instanceof Error ? error.message : String(error)
}

/** 参谋选择/新建面板。 */
export function AdviserPicker({ t, parent, onPick }: AdviserPickerProps): ReactElement {
  const [phase, setPhase] = useState<LoadPhase>({ kind: 'loading' })
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<string | undefined>(undefined)

  const reload = useCallback((signal?: AbortSignal): void => {
    listAdvisers(parent)
      .then((rows) => { if (signal?.aborted !== true) setPhase({ kind: 'ready', rows }) })
      .catch((error: unknown) => {
        if (signal?.aborted !== true) setPhase({ kind: 'failed', message: describeError(error, t) })
      })
  }, [parent, t])

  useEffect(() => {
    const controller = new AbortController()
    reload(controller.signal)
    return () => { controller.abort() }
  }, [reload])

  const create = useCallback((): void => {
    if (busy) return
    setBusy(true)
    setNotice(undefined)
    // 选区入口带来的首条上下文(一次性;取后即清,免得下次开参谋还带着旧选区)。
    const selection = takePendingSelection()
    const seed = selection === undefined ? defaultSeed() : seedWithSelection(selection)
    createAdviser(parent, seed)
      .then(result => onPick(result.sessionId, parent))
      .catch((error: unknown) => { setNotice(describeError(error, t)) })
      .finally(() => { setBusy(false) })
  }, [busy, onPick, parent, t])

  const rows = phase.kind === 'ready' ? phase.rows : []

  return (
    <section data-eterna-adviser="panel" aria-labelledby="et-adviser-heading">
      <h2 id="et-adviser-heading">
        <Icon name="comment" size={18} label={t('panel.title')} />
        {` ${t('panel.title')}`}
      </h2>
      <p className="et-adviser-subtitle">{t('panel.subtitle')}</p>

      {phase.kind === 'loading' && <p className="et-adviser-hint" aria-busy="true">{t('picker.loading')}</p>}
      {phase.kind === 'failed' && (
        <div data-eterna-adviser="card">
          <p className="et-adviser-error" role="alert">{phase.message}</p>
          <button type="button" className="et-adviser-button" onClick={() => { setPhase({ kind: 'loading' }); reload() }}>
            {t('picker.retry')}
          </button>
        </div>
      )}
      {phase.kind === 'ready' && rows.length > 0 && (
        <ul className="et-adviser-list" aria-label={t('picker.listLabel')}>
          {rows.map((row, index) => (
            <li key={row.sessionId}>
              <button
                type="button"
                className="et-adviser-row"
                onClick={() => { onPick(row.sessionId, parent) }}
              >
                <Icon name="comment" size={16} />
                <span className="et-adviser-row-title">{t('picker.rowLabel', { n: index + 1 })}</span>
                <span className={`et-adviser-row-state et-adviser-row-state--${row.activity}`}>
                  {row.activity === 'running' ? t('picker.state.running') : t('picker.state.inactive')}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {phase.kind === 'ready' && rows.length === 0 && (
        <p className="et-adviser-hint">{t('picker.empty')}</p>
      )}

      <div data-eterna-adviser="actions">
        <button
          type="button"
          className="et-adviser-button et-adviser-button--primary"
          onClick={create}
          disabled={busy}
          aria-busy={busy}
        >
          {busy ? t('picker.creating') : t('picker.create')}
        </button>
      </div>
      {notice !== undefined && <p className="et-adviser-error" role="alert">{notice}</p>}
    </section>
  )
}
