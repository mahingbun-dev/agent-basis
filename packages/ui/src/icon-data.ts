/**
 * 恒灵·EternaAgent 图标数据(界面线性家族 v1)。
 *
 * 单一事实源:React 组件(@eterna/ui/icons)与独立页字符串(iconSvg)都从
 * 这里取路径,避免登录页/插件页再各自手写 SVG。图形统一 24 网格、20 视觉区、
 * 1.75 描边、圆头圆角;只使用 currentColor,不写死色值。
 */
export interface IconPrimitive {
  readonly tag: 'path' | 'circle' | 'rect' | 'line'
  readonly attrs: Readonly<Record<string, string | number>>
}

export type IconName =
  | 'gauge'
  | 'chart'
  | 'prompt'
  | 'trace'
  | 'folder'
  | 'chevron-right'
  | 'chevron-down'
  | 'eye'
  | 'eye-off'
  | 'search'
  | 'plus'
  | 'check'
  | 'close'
  | 'copy'
  | 'trash'
  | 'arrow-right'
  | 'globe'
  | 'palette'
  | 'logout'
  | 'settings'
  | 'paperclip'

export const ICONS: Readonly<Record<IconName, readonly IconPrimitive[]>> = {
  /* 基座面板:半环仪表 + 指针,表达「观测/控制台」而非通用齿轮。 */
  gauge: [
    { tag: 'path', attrs: { d: 'M3.5 17.5a8.5 8.5 0 0 1 17 0' } },
    { tag: 'path', attrs: { d: 'M12 17.5l4.2-5.4' } },
    { tag: 'circle', attrs: { cx: 12, cy: 17.5, r: 1.4, fill: 'currentColor', stroke: 'none' } },
  ],

  /* 用量统计:三根圆头柱 + 基线。 */
  chart: [
    { tag: 'path', attrs: { d: 'M4 20h16M7.5 20v-5.5M12 20v-10M16.5 20V5.5' } },
  ],

  /* 提示词工坊:列表 + 笔尖,强调「可编辑的文本资产」。 */
  prompt: [
    { tag: 'path', attrs: { d: 'M4.5 6.5h9.5M4.5 12h9.5M4.5 17.5h5.5' } },
    { tag: 'path', attrs: { d: 'M14.5 17.2l4.2-4.2 2.2 2.2-4.2 4.2-2.9.7.7-2.9z' } },
    { tag: 'path', attrs: { d: 'M17.2 14.5l2.2 2.2' } },
  ],

  /* 循环轨迹:闭环 + 中心节点,替代含义偏移的目录树。 */
  trace: [
    { tag: 'path', attrs: { d: 'M7.5 7.5a4.5 4.5 0 0 0 0 9c4.5 0 4.5-9 9-9a4.5 4.5 0 0 1 0 9c-4.5 0-4.5-9-9-9z' } },
    { tag: 'circle', attrs: { cx: 12, cy: 12, r: 1.3, fill: 'currentColor', stroke: 'none' } },
  ],

  folder: [
    { tag: 'path', attrs: { d: 'M3.5 7.5A1.5 1.5 0 0 1 5 6h4l1.8 2H19a1.5 1.5 0 0 1 1.5 1.5v8A1.5 1.5 0 0 1 19 19H5a1.5 1.5 0 0 1-1.5-1.5z' } },
  ],

  'chevron-right': [
    { tag: 'path', attrs: { d: 'M9.5 6.5l5.5 5.5-5.5 5.5' } },
  ],

  'chevron-down': [
    { tag: 'path', attrs: { d: 'M6.5 9.5L12 15l5.5-5.5' } },
  ],

  eye: [
    { tag: 'path', attrs: { d: 'M2.8 12S6.4 5.5 12 5.5 21.2 12 21.2 12 17.6 18.5 12 18.5 2.8 12 2.8 12z' } },
    { tag: 'circle', attrs: { cx: 12, cy: 12, r: 2.8 } },
  ],

  'eye-off': [
    { tag: 'path', attrs: { d: 'M4 4l16 16' } },
    { tag: 'path', attrs: { d: 'M9.9 5.8A9.9 9.9 0 0 1 12 5.5c5.6 0 9.2 6.5 9.2 6.5a17.4 17.4 0 0 1-3.5 4.3' } },
    { tag: 'path', attrs: { d: 'M6 7.9A17.2 17.2 0 0 0 2.8 12S6.4 18.5 12 18.5c1.5 0 2.9-.4 4.1-1' } },
    { tag: 'path', attrs: { d: 'M9.8 9.8a3.1 3.1 0 0 0 4.4 4.4' } },
  ],

  search: [
    { tag: 'circle', attrs: { cx: 10.8, cy: 10.8, r: 6.3 } },
    { tag: 'path', attrs: { d: 'M15.4 15.4L20.5 20.5' } },
  ],

  plus: [
    { tag: 'path', attrs: { d: 'M12 5v14M5 12h14' } },
  ],

  check: [
    { tag: 'path', attrs: { d: 'M5 12.5l4.5 4.5L19 7' } },
  ],

  close: [
    { tag: 'path', attrs: { d: 'M6 6l12 12M18 6L6 18' } },
  ],

  copy: [
    { tag: 'path', attrs: { d: 'M8.5 8.5h9.5A1.5 1.5 0 0 1 19.5 10v9.5a1.5 1.5 0 0 1-1.5 1.5H8.5A1.5 1.5 0 0 1 7 19.5V10a1.5 1.5 0 0 1 1.5-1.5z' } },
    { tag: 'path', attrs: { d: 'M15.5 8.5V5.5A2 2 0 0 0 13.5 3.5H5.5a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2' } },
  ],

  trash: [
    { tag: 'path', attrs: { d: 'M4.5 7h15M9.5 7V4.5h5V7' } },
    { tag: 'path', attrs: { d: 'M6.8 7l.8 12.4a1.6 1.6 0 0 0 1.6 1.5h5.6a1.6 1.6 0 0 0 1.6-1.5L17.2 7' } },
    { tag: 'path', attrs: { d: 'M10.2 11v5.8M13.8 11v5.8' } },
  ],

  'arrow-right': [
    { tag: 'path', attrs: { d: 'M4 12h15M13.5 6.5L19 12l-5.5 5.5' } },
  ],

  /* 账户菜单:界面语言。 */
  globe: [
    { tag: 'circle', attrs: { cx: 12, cy: 12, r: 8.5 } },
    { tag: 'path', attrs: { d: 'M3.5 12h17' } },
    { tag: 'path', attrs: { d: 'M12 3.5c2.3 2.4 3.5 5.3 3.5 8.5s-1.2 6.1-3.5 8.5c-2.3-2.4-3.5-5.3-3.5-8.5s1.2-6.1 3.5-8.5z' } },
  ],

  /* 账户菜单:界面主题。 */
  palette: [
    { tag: 'path', attrs: { d: 'M12 3.5a8.5 8.5 0 0 0 0 17c1.4 0 2.2-.9 2.2-2.1 0-1.4 1-2.4 2.4-2.4h1.3a2.6 2.6 0 0 0 2.6-2.6A8.5 8.5 0 0 0 12 3.5z' } },
    { tag: 'circle', attrs: { cx: 8, cy: 9.2, r: 1.15, fill: 'currentColor', stroke: 'none' } },
    { tag: 'circle', attrs: { cx: 7.2, cy: 13.6, r: 1.15, fill: 'currentColor', stroke: 'none' } },
    { tag: 'circle', attrs: { cx: 10.8, cy: 16.8, r: 1.15, fill: 'currentColor', stroke: 'none' } },
  ],

  /* 账户菜单:断开连接。 */
  logout: [
    { tag: 'path', attrs: { d: 'M15.5 4.5H6.8a2.3 2.3 0 0 0-2.3 2.3v10.4a2.3 2.3 0 0 0 2.3 2.3h8.7' } },
    { tag: 'path', attrs: { d: 'M12.5 12h8' } },
    { tag: 'path', attrs: { d: 'M17.5 8.5L21 12l-3.5 3.5' } },
  ],

  /* 账户菜单:偏好设置(齿轮)。 */
  settings: [
    { tag: 'circle', attrs: { cx: 12, cy: 12, r: 3.1 } },
    { tag: 'path', attrs: { d: 'M19.2 13.4l1.6 1.2-1.6 2.8-1.9-.6a7.6 7.6 0 0 1-2 1.2l-.3 2h-3.2l-.3-2a7.6 7.6 0 0 1-2-1.2l-1.9.6-1.6-2.8 1.5-1.2a7.7 7.7 0 0 1 0-2.4L4.1 9.2l1.6-2.8 1.9.6a7.6 7.6 0 0 1 2-1.2l.3-2h3.2l.3 2a7.6 7.6 0 0 1 2 1.2l1.9-.6 1.6 2.8-1.5 1.2a7.7 7.7 0 0 1 0 2.4z' } },
  ],

  /* 附件入口:竖直回形针一笔画(外线-底弯-左线-内顶弯-内线,开口在右上)。 */
  paperclip: [
    { tag: 'path', attrs: { d: 'M16.5 5.5v9.5a4.5 4.5 0 0 1-9 0V7a2.5 2.5 0 0 1 5 0v8' } },
  ],
}

export const ICON_NAMES = Object.keys(ICONS) as IconName[]

const KEBAB: Readonly<Record<string, string>> = {
  strokeWidth: 'stroke-width',
  strokeLinecap: 'stroke-linecap',
  strokeLinejoin: 'stroke-linejoin',
  fillOpacity: 'fill-opacity',
  strokeOpacity: 'stroke-opacity',
}

function escapeAttr(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;')
}

/** 把图元序列化为 SVG 内联标记(静态可信内容)。 */
export function renderPrimitives(primitives: readonly IconPrimitive[]): string {
  return primitives.map((primitive) => {
    const attrs = Object.entries(primitive.attrs)
      .map(([name, value]) => `${KEBAB[name] ?? name}="${escapeAttr(String(value))}"`)
      .join(' ')
    return `<${primitive.tag} ${attrs}/>`
  }).join('')
}

/** 单个界面图标的内联标记(不含 <svg> 外层)。 */
export function iconInner(name: IconName): string {
  return renderPrimitives(ICONS[name])
}

/** 独立页/服务端字符串出口;与 React <Icon> 共用同一份路径数据。 */
export function iconSvg(name: IconName, size = 20, className?: string): string {
  const cls = className === undefined ? '' : ` class="${escapeAttr(className)}"`
  return `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"${cls}>${iconInner(name)}</svg>`
}

/** 品牌闪电(24 网格,竖版比例,16px 仍可辨)。 */
export const BRAND_BOLT_PATH = 'M13 2L4.5 13.5H11L9.5 22 19 10.5h-6.5L13 2Z'

/** 品牌标字符串出口(currentColor,跟随文字色)。 */
export function brandMarkSvg(size = 24, className?: string): string {
  const cls = className === undefined ? '' : ` class="${escapeAttr(className)}"`
  return `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="currentColor" aria-hidden="true"${cls}><path d="${BRAND_BOLT_PATH}"/></svg>`
}
