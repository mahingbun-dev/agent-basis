/**
 * 首屏（hero）品牌浮层：`conversation.hero.frame`（hoc）的占用方。
 *
 * 契约（上游 `ui-conversation/src/client/contract/slots.ts:294`，
 * 来源 47 §2.14 / 50 §5.6 / 54 §4.6 T33）：
 * - owner props = `{ hero: boolean }`：`hero=true` 仅表示「独立 Conversation 的
 *   空白首页」；外层由 `display:contents` 的 HOC 包裹滚动体；
 * - `hero=false` **直接返回 children**：不新增任何包裹元素、不挂监听；
 * - `hero=true`：外层 div 只承担 `display:contents`，内部品牌层
 *   `position:absolute; inset:0; z-index:-1; pointer-events:none`，再原样渲染
 *   children（禁止 position:fixed 全屏遮罩、禁止改变滚动体 display/flex）；
 * - 不接点击、不夺焦点、不监听键盘——命中面穿透到输入卡（H13）。
 *
 * 品牌标走 `conversation.hero.brand.mark`（index.ts 复用 `BrandMark`）。
 * 样式见 `styles.ts`（只用 `--et-*` 令牌、断点 1100/760/640）。
 */
import { createElement, type ReactNode } from 'react'
import { BRAND_BOLT_PATH } from '@eterna/ui/icon-data'

/** 宿主 `HeroFrameOwnerProps` + 被包裹的滚动体。 */
export interface HeroFrameProps {
  /** 是否独立 Conversation 的空白首页（宿主判定，含 embedded 排除）。 */
  readonly hero: boolean
  /** 宿主滚动体（Views + composerSeat），必须原样渲染一次。 */
  readonly children?: ReactNode
}

/**
 * 装饰品牌层：玉晕 + 侧向玉环 + 恒灵标水印。
 * 全部 `aria-hidden`；交互由 `pointer-events:none` 整层穿透。
 * @returns 绝对定位的负 z-index 装饰容器。
 */
function HeroLayer(): ReturnType<typeof createElement> {
  return createElement(
    'div',
    { 'data-eterna-hero-layer': '', 'aria-hidden': 'true' },
    createElement('div', { 'data-eterna-hero-glow': '' }),
    createElement('div', { 'data-eterna-hero-ring': '', 'data-eterna-hero-side': 'left' }),
    createElement('div', { 'data-eterna-hero-ring': '', 'data-eterna-hero-side': 'right' }),
    createElement(
      'svg',
      { 'data-eterna-hero-mark': '', viewBox: '0 0 24 24', width: 24, height: 24, 'aria-hidden': 'true', focusable: 'false' },
      createElement('path', { d: BRAND_BOLT_PATH, fill: 'currentColor' }),
    ),
  )
}

/**
 * 首屏 HOC：非首屏零 DOM 增量，首屏只加一层布局中性（display:contents）外框
 * 与一层装饰品牌层，children 始终原样返回且只渲染一次。
 * @param props - 宿主 owner props（`hero`）与被包裹内容。
 * @returns 非首屏 = children 本体；首屏 = 外框 + 装饰层 + children。
 */
export function HeroFrame(props: HeroFrameProps): ReactNode {
  if (!props.hero) return props.children
  return createElement(
    'div',
    // 内联 display:contents 是布局安全的关键：样式表尚未注入时外框也必须是
    // 布局中性的，否则滚动体不再是 .root 的直接 flex 项。
    { 'data-eterna-hero-frame': '', style: { display: 'contents' } },
    HeroLayer(),
    props.children,
  )
}
