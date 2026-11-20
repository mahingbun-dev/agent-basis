/**
 * 决策层容器（§7a.2）：贴输入卡顶边向上浮出的审批/提问卡。
 *
 * 为什么需要它：
 * - 审批卡与提问卡此前都挂 `document.body` + `fixed top:16px` + `z-index:10000`，
 *   两张卡同时挂起必然重叠，且会压住宿主原生 toast（`top:40px / z-index:1100`）。
 * - 宿主在输入卡顶边留了零高度锚点（`.overlayAnchor{height:0;position:absolute;
 *   inset:0 0 auto}`，`conversation.input.overlay` 席位）。把卡片挂进该席位，
 *   「贴输入卡」就是布局结果，不靠视觉调参。
 *
 * 两个职责：
 * 1. 队列：宽屏最多 2 张，其余折叠为「另有 N 项」；窄屏只呈 1 张 + 切换条。
 * 2. 补偿：实测高度写进信息流下内距（ResizeObserver），并滚到底——
 *    否则决策卡压住的正是用户需要回看的证据。
 *
 * 注意：本组件不自带 `position:relative`，定位完全交给宿主锚点。
 */
import { useEffect, useRef, useState, type ReactNode } from 'react'

/** 窄屏判定（与 frontend-style §5 断点一致：<760 一次只呈 1 张）。 */
const NARROW_QUERY = '(max-width: 760px)'

/** 决策卡在信息流里要补偿的容器属性；宿主的滚动容器由调用方指定。 */
export interface DecisionLayerProps {
  /** 每张卡的内容；顺序 = 到达顺序。 */
  readonly items: readonly (ReactNode | null)[]
  /** 「另有 N 项」文案模板（{n} 为剩余数）。 */
  readonly moreLabel: (n: number) => string
  /** 切换条文案模板（{n} 为第 n 项，{total} 为总数）。 */
  readonly switchLabel?: (index: number, total: number) => string
  /**
   * 需要补偿下内距的滚动容器（通常是会话信息流）。
   * 缺省时只做层内布局，不写 padding。
   */
  readonly feed?: HTMLElement | null
}

/** 决策层实测高度的 CSS 自定义属性名（信息流消费）。 */
export const DECISION_INSET_VAR = '--decision-inset'

export function DecisionLayer(props: DecisionLayerProps): ReactNode {
  const layerRef = useRef<HTMLDivElement | null>(null)
  const [narrow, setNarrow] = useState(false)
  /** 窄屏下当前呈第几张（其余排队）。 */
  const [focus, setFocus] = useState(0)
  /** 是否真的有决策卡挂出（UI-006：审批/提问组件本身可能是空壳，元素非 null 不代表有卡）。 */
  const [hasCard, setHasCard] = useState(false)

  // 卡片存在性探测：items 是常驻的组件元素（审批/提问各自内部按队列渲染），
  // 无待拍板项时二者都渲染空。若按 items.length 出切换条，首屏空会话会浮出
  // 「第 1/2 项 · 点击切换」并压住 chips 行（390 实测）。以 DOM 中真实
  // `.et-decision-card` 为准，MutationObserver 跟随增删。
  useEffect(() => {
    const layer = layerRef.current
    if (layer === null || typeof MutationObserver === 'undefined') return
    const sync = (): void => { setHasCard(layer.querySelector('.et-decision-card') !== null) }
    sync()
    const observer = new MutationObserver(sync)
    observer.observe(layer, { childList: true, subtree: true })
    return () => { observer.disconnect() }
  }, [])

  // 窄屏判定：只在跨断点时重渲染，避免 resize 抖动
  useEffect(() => {
    if (typeof window === 'undefined') return
    const query = window.matchMedia(NARROW_QUERY)
    const sync = (): void => { setNarrow(query.matches) }
    sync()
    query.addEventListener('change', sync)
    return () => { query.removeEventListener('change', sync) }
  }, [])

  // 补偿：把决策层实测高度写进信息流下内距，并滚到底（卡片压住的正是要回看的证据）
  useEffect(() => {
    const layer = layerRef.current
    const feed = props.feed
    if (layer === null || feed === null || feed === undefined) return
    if (typeof ResizeObserver === 'undefined') return
    const write = (): void => {
      const inset = Math.ceil(layer.getBoundingClientRect().height)
      feed.style.paddingBottom = inset === 0 ? '' : `${String(inset)}px`
      feed.style.setProperty(DECISION_INSET_VAR, `${String(inset)}px`)
      if (inset > 0) feed.scrollTop = feed.scrollHeight
    }
    write()
    const observer = new ResizeObserver(write)
    observer.observe(layer)
    return () => {
      observer.disconnect()
      feed.style.paddingBottom = ''
      feed.style.removeProperty(DECISION_INSET_VAR)
    }
  }, [props.feed, props.items.length, narrow, focus])

  const visible = props.items.filter((item): item is ReactNode => item !== null)
  if (visible.length === 0) return <div ref={layerRef} className='et-decision-layer' style={{ display: 'none' }} />

  // 窄屏：一次只呈 1 张 + 切换条；宽屏：最多 2 张 + 「另有 N 项」
  const cap = narrow ? 1 : 2
  const focusIndex = Math.min(focus, visible.length - 1)
  const shown = narrow
    ? [visible[focusIndex]]
    : visible.slice(0, cap)
  // 切换/折叠条只在确有卡片时出现（空壳组件不算；见 hasCard 注释）
  const rest = hasCard ? visible.length - cap : 0

  return (
    <div ref={layerRef} className='et-decision-layer'>
      {shown.map((node, index) => (
        <div key={index} style={{ display: 'contents' }}>{node}</div>
      ))}
      {narrow && hasCard && visible.length > 1
        ? (
          <button
            type='button'
            className='et-decision-more'
            onClick={() => { setFocus((focus + 1) % visible.length) }}
            aria-label={props.switchLabel === undefined
              ? undefined
              : props.switchLabel(focusIndex + 1, visible.length)}
          >
            {props.switchLabel === undefined
              ? props.moreLabel(visible.length - 1)
              : props.switchLabel(focusIndex + 1, visible.length)}
          </button>
        )
        : null}
      {!narrow && rest > 0
        ? <button type='button' className='et-decision-more'>{props.moreLabel(rest)}</button>
        : null}
    </div>
  )
}
