/**
 * 插件卡片图标:36px 双色线稿 v1。
 *
 * 与界面图标同一「恒环·节点」语言:36 网格、4 边距、2.25 描边、圆头圆角;
 * 前景线条用 currentColor,焦点元素用品牌强调色(accent / accent-soft),
 * 深浅主题自动适配。禁止渐变与字面色值。
 */
import { renderPrimitives, type IconPrimitive } from '@eterna/ui/icon-data'

export type PluginArtName =
  | 'governance'
  | 'audit'
  | 'egress'
  | 'access'
  | 'memory'
  | 'knowledge'
  | 'doctor'
  | 'brand'
  | 'panel'
  | 'prompt'

const ART: Readonly<Record<PluginArtName, readonly IconPrimitive[]>> = {
  governance: [
    { tag: 'path', attrs: { d: 'M18 4.5l9.5 4v7.2c0 6.1-3.9 10.8-9.5 13.3-5.6-2.5-9.5-7.2-9.5-13.3V8.5z', fill: 'var(--et-accent-soft)', stroke: 'var(--et-accent)' } },
    { tag: 'path', attrs: { d: 'M13.6 17.8l3.1 3.1 5.8-6.2', stroke: 'currentColor' } },
  ],

  audit: [
    { tag: 'path', attrs: { d: 'M9 5.5h11l7 7v18H9z' } },
    { tag: 'path', attrs: { d: 'M20 5.5V12.5h7M13 17h9M13 21.5h6' } },
    { tag: 'circle', attrs: { cx: 24, cy: 25.5, r: 3.4, fill: 'var(--et-accent)', stroke: 'none' } },
    { tag: 'path', attrs: { d: 'M22.4 25.6l1.1 1.1 2-2.1', stroke: 'var(--et-bg)' } },
  ],

  egress: [
    { tag: 'circle', attrs: { cx: 17, cy: 19, r: 10.5 } },
    { tag: 'path', attrs: { d: 'M17 8.5c-2.8 2.9-4.2 6.4-4.2 10.5s1.4 7.6 4.2 10.5', opacity: 0.55 } },
    { tag: 'path', attrs: { d: 'M6.5 19h21', opacity: 0.55 } },
    { tag: 'path', attrs: { d: 'M21.5 14.5l6-6M22.5 8.5h5M27.5 8.5v5', stroke: 'var(--et-accent)' } },
  ],

  access: [
    { tag: 'path', attrs: { d: 'M12.5 16v-3.5a5.5 5.5 0 0 1 11 0V16' } },
    { tag: 'rect', attrs: { x: 9.5, y: 16, width: 17, height: 13, rx: 3.5, fill: 'var(--et-accent-soft)', stroke: 'var(--et-accent)' } },
    { tag: 'circle', attrs: { cx: 18, cy: 21.5, r: 1.8, fill: 'var(--et-accent)', stroke: 'none' } },
    { tag: 'path', attrs: { d: 'M18 23.3v3', stroke: 'var(--et-accent)' } },
  ],

  memory: [
    { tag: 'rect', attrs: { x: 8, y: 7, width: 20, height: 6, rx: 3 } },
    { tag: 'rect', attrs: { x: 8, y: 15, width: 20, height: 6, rx: 3, fill: 'var(--et-accent-soft)', stroke: 'var(--et-accent)' } },
    { tag: 'rect', attrs: { x: 8, y: 23, width: 20, height: 6, rx: 3 } },
  ],

  knowledge: [
    { tag: 'path', attrs: { d: 'M18 11c-2.6-2.4-7-2.9-10-1.4v18c3-1.5 7.4-1 10 1.4 2.6-2.4 7-2.9 10-1.4v-18c-3-1.5-7.4-1-10 1.4z' } },
    { tag: 'path', attrs: { d: 'M18 11.5v17.5', opacity: 0.55 } },
    { tag: 'path', attrs: { d: 'M23 9.5v6.5l2.5-1.7 2.5 1.7V9.5z', fill: 'var(--et-accent)', stroke: 'none' } },
  ],

  doctor: [
    { tag: 'path', attrs: { d: 'M5 19h6.5l2.8-7.5 4.5 15 3.2-9.5 1.8 2H31' } },
    { tag: 'circle', attrs: { cx: 17.8, cy: 11.5, r: 2.2, fill: 'var(--et-accent)', stroke: 'none' } },
  ],

  brand: [
    { tag: 'circle', attrs: { cx: 18, cy: 18, r: 11, opacity: 0.3 } },
    { tag: 'path', attrs: { d: 'M19.5 3L6.75 20.25H16.5L14.25 33 28.5 15.75h-9.75L19.5 3z', fill: 'var(--et-accent)', stroke: 'none' } },
  ],

  panel: [
    { tag: 'rect', attrs: { x: 7, y: 7, width: 9, height: 9, rx: 3.3 } },
    { tag: 'rect', attrs: { x: 20, y: 7, width: 9, height: 9, rx: 3.3, fill: 'var(--et-accent-soft)', stroke: 'var(--et-accent)' } },
    { tag: 'rect', attrs: { x: 7, y: 20, width: 9, height: 9, rx: 3.3 } },
    { tag: 'rect', attrs: { x: 20, y: 20, width: 9, height: 9, rx: 3.3 } },
  ],

  prompt: [
    { tag: 'path', attrs: { d: 'M6.5 9h11M6.5 15h11M6.5 21h6' } },
    { tag: 'path', attrs: { d: 'M20 26.5l7-7 3 3-7 7-4 .9.9-3.9z', fill: 'var(--et-accent-soft)', stroke: 'var(--et-accent)' } },
  ],
}

function escapeAttr(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;')
}

export function pluginArtSvg(name: PluginArtName, size = 36, className?: string): string {
  const cls = className === undefined ? '' : ` class="${escapeAttr(className)}"`
  return `<svg viewBox="0 0 36 36" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="2.25" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"${cls}>${renderPrimitives(ART[name])}</svg>`
}
