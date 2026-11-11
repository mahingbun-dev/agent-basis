/**
 * @eterna/brand 浏览器半边 v2:把「DeepSeek Harness」品牌面全面替换为「恒灵·EternaAgent」。
 *
 * 五个替换面(零上游改动;实测依据见 docs/eterna-web-profile.md):
 * 1. 侧栏 logo:官方 slot `sidebar.brand.mark`(ui-sidebar children 声明,上游
 *    fallback=FishLogo 深海鲸)——slot 注入恒灵标(正式席位,非 DOM hack)。
 * 2. 残余鲸鱼置换:FishLogo 另有渲染点(版本拷贝按钮等)——DOM 观察器按 viewBox
 *    签名 "0 0 23.16 17.04"(FISH_LOGO_VIEWBOX,唯一)识别鲸鱼 svg,原位置换为
 *    恒灵单色标(currentColor,随主题深浅自适配)。
 * 3. 文案地图(文本节点观察器,防回环):
 *    DeepSeek Harness→恒灵·EternaAgent;DSH 本地构建→恒灵·EternaAgent · 本地构建;
 *    DSH Local Build→EternaAgent · Local Build;探索未至之境→方寸灵台，运筹万里(文化向标语,用户 2026-11-09 定:灵台出自《庄子》=心之神明,台=工作台双关,灵=品牌呼应)。
 * 4. tab 标题:ui-layout productTitle 硬编码,观察器拦截(含会话前缀形态)。
 * 5. favicon:SVG data-URI 换装。
 * 另:locale.register('common') 覆写 brand.localBuild 键(DOM 观察器兜底)。
 */
import { createElement } from 'react'
import { BRAND_BOLT_PATH } from '@eterna/ui/icon-data'
import { BRAND } from './state.ts'
import type { BrandClientContext } from './state.ts'

export const inject = ['slots', 'locale']

/** favicon(data-URI SVG;Webflow Blue 圆角底 + 白色闪电,16px 可辨)。 */
const FAVICON_SVG = "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'><rect width='24' height='24' rx='5.25' fill='#146ef5'/><path d='M13 2L4.5 13.5H11L9.5 22 19 10.5h-6.5L13 2Z' fill='#ffffff'/></svg>"
const FAVICON_URI = `data:image/svg+xml,${encodeURIComponent(FAVICON_SVG)}`

/** FishLogo 唯一 viewBox(上游 FISH_LOGO_VIEWBOX 23.16×17.04)——svg 身份签名。 */
const FISH_VIEWBOX = '0 0 23.16 17.04'

/** 文案替换地图(文本节点精确子串;模型名 deepseek-flash 不在图内,不受影响)。 */
const TEXT_MAP: readonly (readonly [string, string])[] = [
  ['DeepSeek Harness', BRAND.full],
  [BRAND.upstreamBadge[0], BRAND.badge.zh],
  [BRAND.upstreamBadge[1], BRAND.badge.en],
  ['探索未至之境', '方寸灵台，运筹万里'],
  ['DSH', 'EternaAgent'],
  // 预览版痕迹清除(用户 2026-11-09:不希望有);长短语在前防子串抢先。
  // 注意:「预览版」命中的文本节点由 hidePreviewChip 整元素隐藏(只清文字会
  // 留下看不见的空样式块——hero 右上角的可疑残影,2026-11-09 用户实测)。
  ['预览版说明', ''],
]

/** 恒灵标内观(currentColor,主题自适配;纯粗壮闪电,v2 修复 24px 圆+点退化)。 */
function markInner(): string {
  return `<path d="${BRAND_BOLT_PATH}" fill="currentColor"/>`
}

/** 恒灵标组件(sidebar.brand.mark slot;属主传 size)。必须返回 React 元素——
 * 返回 SVG 字符串会被 React 当纯文本渲染,页面直接显示标签源码(v2 实测教训)。 */
function BrandMark(props: { size?: number } = {}): ReturnType<typeof createElement> {
  const size = props.size ?? 24
  return createElement(
    'svg',
    { width: size, height: size, viewBox: '0 0 24 24', fill: 'none', 'aria-hidden': true },
    createElement('path', {
      d: BRAND_BOLT_PATH,
      fill: 'currentColor',
    }),
  )
}

/** 品牌名组件(sidebar.brand.name slot;只渲染英文产品名,无版本号)。 */
function BrandName(): ReturnType<typeof createElement> {
  return createElement('span', {
    style: { fontSize: 13, fontWeight: 600, letterSpacing: 0.2, whiteSpace: 'nowrap' },
  }, BRAND.display)
}

/** 鲸鱼 svg 置换:改 viewBox+内容,保留宽高。 */
function swapFish(svg: Element): void {
  const width = svg.getAttribute('width') ?? '24'
  const height = svg.getAttribute('height') ?? width
  svg.setAttribute('viewBox', '0 0 24 24')
  svg.setAttribute('width', width)
  svg.setAttribute('height', height)
  svg.innerHTML = markInner()
}

/** 替换字符串里的上游产品名(保会话标题前缀形态 `${title} — ${product}`)。 */
function rewriteTitle(raw: string): string {
  return raw.split(BRAND.upstream).join(BRAND.full)
}

/** favicon 换装:移除既有 icon 声明后注入 SVG data-URI。 */
function installFavicon(): void {
  for (const existing of document.querySelectorAll('link[rel~="icon"]')) {
    existing.remove()
  }
  const link = document.createElement('link')
  link.rel = 'icon'
  link.type = 'image/svg+xml'
  link.href = FAVICON_URI
  document.head.append(link)
}

/** tab 标题观察器:<title> 文本含上游名即替换(防回环:改写后不再含上游名)。 */
function watchTitle(): () => void {
  const apply = (): void => {
    if (document.title.includes(BRAND.upstream)) {
      document.title = rewriteTitle(document.title)
    }
  }
  apply()
  let titleEl = document.querySelector('title')
  if (titleEl === null) {
    titleEl = document.createElement('title')
    titleEl.textContent = BRAND.full
    document.head.append(titleEl)
  }
  const observer = new MutationObserver(() => { apply() })
  observer.observe(titleEl, { childList: true, characterData: true, subtree: true })
  // 兜底:会话切换路径可能整节点替换 title 元素
  const rootObserver = new MutationObserver(() => {
    if (!document.querySelector('title') || document.title.includes(BRAND.upstream)) apply()
  })
  rootObserver.observe(document.documentElement, { childList: true, subtree: true })
  return () => {
    observer.disconnect()
    rootObserver.disconnect()
  }
}

/** 已注入隐藏规则的类名(样式表规则对 React 重渲染免疫,inline 会被重置)。 */
const hiddenClasses = new Set<string>()
let hideStyleEl: HTMLStyleElement | undefined

/** 按类名注入 display:none!important 规则(预览版 chip 等 React 重渲染不可复活)。 */
function hideClass(className: string): void {
  for (const cls of className.split(/\s+/)) {
    if (cls === '' || hiddenClasses.has(cls)) continue
    hiddenClasses.add(cls)
    if (hideStyleEl === undefined) {
      hideStyleEl = document.createElement('style')
      hideStyleEl.id = 'eterna-brand-hide'
      document.head.append(hideStyleEl)
    }
    hideStyleEl.append(`.${CSS.escape(cls)}{display:none!important}\n`)
  }
}

/** 全量映射改写(所有 TEXT_MAP 条目依序替换)。 */
function mapReplace(text: string): string {
  for (const [from, to] of TEXT_MAP) {
    if (text.includes(from)) text = text.split(from).join(to)
  }
  return text
}

/** 品牌相关 ARIA/提示属性(工具描述会以无障碍属性渲染,textContent 扫描不可见——
 * v3 残留 4 处「DSH file policy」的根因)。 */
const ATTR_NAMES = ['aria-label', 'title', 'aria-description', 'placeholder', 'alt'] as const

/** 单文本节点替换(命中才改写,且值不变不回写——无条件回写会在 characterData
 * 变更上自激成观察器死循环,页面卡死 loading,2026-11-09 实测)。 */
function replaceTextNode(node: Text): void {
  const current = node.nodeValue ?? ''
  // 预览版 chip:按类名注规则整类隐藏(清文字残留空样式块;inline 隐藏会被
  // React 重渲染重置——boot 竞态实测)。
  if (current.includes('预览版')) {
    const chip = node.parentElement
    if (chip !== null) hideClass(chip.className)
  }
  const text = mapReplace(current)
  if (text !== current) node.nodeValue = text
}

/** 单元素属性替换(命中才回写)。 */
function replaceAttrs(el: Element): void {
  for (const name of ATTR_NAMES) {
    const value = el.getAttribute(name)
    if (value === null) continue
    const replaced = mapReplace(value)
    if (replaced !== value) el.setAttribute(name, replaced)
  }
}

/** 文本节点命中判定:TEXT_MAP 之外的触发器(预览版 chip 隐藏)必须单独计入——
 * 否则节点被过滤、永远到不了 replaceTextNode 的隐藏分支(v5 首版实测漏检)。 */
function textHit(text: string): boolean {
  return text.includes('预览版') || TEXT_MAP.some(([from]) => text.includes(from))
}

/** 文本+鲸鱼观察器:全树扫描文案命中与鲸鱼 svg,原位替换。 */
function watchDom(): () => void {
  const scanText = (root: Node): void => {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
    let node = walker.nextNode()
    while (node !== null) {
      const text = node.nodeValue ?? ''
      if (textHit(text)) replaceTextNode(node as Text)
      node = walker.nextNode()
    }
  }
  const scanFish = (root: Element): void => {
    for (const svg of root.querySelectorAll(`svg[viewBox="${FISH_VIEWBOX}"]`)) swapFish(svg)
  }
  const scanAll = (root: Node): void => {
    if (root.nodeType === Node.TEXT_NODE) {
      replaceTextNode(root as Text)
      return
    }
    const el = root as Element
    scanText(el)
    if (el instanceof Element) {
      scanFish(el)
      if (el !== document.body) replaceAttrs(el)
      const walker = document.createTreeWalker(el, NodeFilter.SHOW_ELEMENT)
      let node = walker.nextNode()
      while (node !== null) {
        replaceAttrs(node as Element)
        node = walker.nextNode()
      }
    }
  }
  const observer = new MutationObserver((mutations) => {
    const roots = new Set<Node>()
    for (const mutation of mutations) {
      if (mutation.type === 'characterData') roots.add(mutation.target)
      for (const added of mutation.addedNodes) roots.add(added)
    }
    for (const root of roots) scanAll(root)
  })
  observer.observe(document.body, { childList: true, characterData: true, subtree: true })
  scanAll(document.body)
  return () => {
    observer.disconnect()
  }
}

/**
 * 浏览器插件体:安装全部品牌替换面。
 * @param ctx - 浏览器插件上下文(locale/slots 可选:缺省面走 DOM 兜底)。
 * @returns 撤销函数(观察器断开 + slot 贡献随插件 fiber 自撤)。
 */
export function apply(ctx: BrandClientContext): () => void {
  // a) locale 字典覆写:brand.localBuild 键(DOM 观察器兜底)。
  let disposeLocale: (() => void) | undefined
  try {
    disposeLocale = ctx.locale?.register('common', {
      zh: { 'brand.localBuild': BRAND.badge.zh },
      en: { 'brand.localBuild': BRAND.badge.en },
    })
  } catch {
    // locale 面不可用 → 纯 DOM 兜底
  }
  installFavicon()
  const disposeTitle = watchTitle()
  const disposeDom = watchDom()
  // b) 侧栏 logo 官方席位(sidebar.brand.mark,ui-sidebar children 声明)。
  let disposeMark: (() => void) | undefined
  let disposeName: (() => void) | undefined
  try {
    const slots = ctx.slots
    if (slots === undefined) throw new Error('slots 面缺席')
    disposeMark = slots.inject('sidebar.brand.mark', () => slots.register(
      { name: 'sidebar.brand.mark' },
      BrandMark,
    ))
    // 品牌名区(上游显示 buildVersion「DSH 本地构建 + 版本号」)→ 只渲染英文
    // 产品名(用户 2026-11-09:本地构建与版本号去掉)。
    disposeName = slots.inject('sidebar.brand.name', () => slots.register(
      { name: 'sidebar.brand.name' },
      BrandName,
    ))
  } catch {
    // slot 声明缺席(上游重排)→ DOM 置换兜底仍在
  }
  return () => {
    disposeTitle()
    disposeDom()
    disposeMark?.()
    disposeName?.()
    disposeLocale?.()
  }
}
