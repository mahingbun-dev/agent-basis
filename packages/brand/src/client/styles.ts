/**
 * 首屏（hero）品牌浮层样式：`conversation.hero.frame` HOC 的装饰层
 * （54 §4.6 T33、50 §3.8 WP4-9、47 B19）。
 *
 * 硬约束（54:451、50 §5.6、47 §B19）：
 * - 只引用 `--et-*` 令牌（经 `@eterna/ui` 桥接层映射到宿主 `--dsw-alias-*`，
 *   深浅主题跟随产品壳），零字面色值——`scripts/lint-ui-tokens.mjs` 门禁；
 * - 断点只用 1100/760/640，只收缩形态、位置规则不变；<760 隐藏侧向装饰、
 *   gutter 收 16；
 * - `z-index:-1` 是宿主 hero 阶段 `isolation:isolate` 契约的唯一例外（与上游
 *   `PixelWhale` 同构：`.root[data-phase='hero']{isolation:isolate}`，装饰层
 *   落在宿主背景之上、内容之下），其余叠层仍只走 1/40/100/200/1000/1100/1500；
 * - 不接指针、不进 tab 序（`pointer-events:none` + `aria-hidden`）；
 * - `prefers-reduced-motion` 下无动画。
 */
import { injectDesignTokens } from '@eterna/ui'

/** hero 浮层 + 品牌层样式表（选择器全部挂在 data 属性上，零全局泄漏）。 */
export const HERO_CSS = `
/* HOC 外框只承担 display:contents：包裹滚动体但不新增真实盒子——宿主
   .root 是 flex column，多一层参与布局的 div 会改变滚动体的 flex 项身份。 */
[data-eterna-hero-frame] { display: contents; }

/* 装饰层：绝对定位 + 负 z-index 落在宿主背景与内容之间；不接指针、不进 tab 序。
   z-index:-1 仅因宿主 hero 阶段 isolation:isolate 成立而合法（47 §2.14）。 */
[data-eterna-hero-layer] {
  position: absolute;
  inset: 0;
  z-index: -1;
  pointer-events: none;
  display: block;
  overflow: hidden;
  --et-hero-gutter: var(--et-gutter);
  --et-hero-glow-opacity: 0.86;
  --et-hero-mark-opacity: 0.045;
}

/* 玉晕：三团极低透明度径向层（≤7% tint），呼吸动画只动 transform。 */
[data-eterna-hero-glow] {
  position: absolute;
  inset: 0;
  opacity: var(--et-hero-glow-opacity);
  transform-origin: 50% 40%;
  background:
    radial-gradient(58% 44% at 50% 2%, color-mix(in oklab, var(--et-accent) 7%, transparent) 0%, transparent 68%),
    radial-gradient(34% 28% at 86% 88%, color-mix(in oklab, var(--et-sand) 5%, transparent) 0%, transparent 70%),
    radial-gradient(30% 24% at 14% 82%, color-mix(in oklab, var(--et-jade) 4%, transparent) 0%, transparent 70%);
  animation: eterna-hero-breathe 18s var(--et-ease) infinite alternate;
}

/* 侧向玉环：只承担氛围，<760 隐藏。 */
[data-eterna-hero-ring] {
  position: absolute;
  width: clamp(180px, 24vw, 320px);
  aspect-ratio: 1 / 1;
  border: 1px solid color-mix(in oklab, var(--et-accent) 13%, transparent);
  border-radius: var(--et-radius-pill);
}

[data-eterna-hero-side='left'] {
  left: calc(var(--et-hero-gutter) * -4);
  top: 16%;
}

[data-eterna-hero-side='right'] {
  right: calc(var(--et-hero-gutter) * -4);
  bottom: 12%;
}

/* 恒灵标水印：装饰，不替代标题。 */
[data-eterna-hero-mark] {
  position: absolute;
  left: 50%;
  top: 50%;
  width: clamp(200px, 30vw, 380px);
  height: auto;
  transform: translate(-50%, -50%);
  color: var(--et-accent);
  opacity: var(--et-hero-mark-opacity);
}

/* 深色（墨玉底）降低装饰透明度，避免同样的 tint 显脏。 */
body[data-ds-dark-theme] [data-eterna-hero-layer] {
  --et-hero-glow-opacity: 0.7;
  --et-hero-mark-opacity: 0.03;
}

@keyframes eterna-hero-breathe {
  from { transform: scale(0.985); }
  to { transform: scale(1.015); }
}

/* 断点只收缩形态/透明度，位置规则不变（54:451）。 */
@media (max-width: 1100px) {
  [data-eterna-hero-ring] { width: clamp(140px, 20vw, 240px); }
  [data-eterna-hero-mark] { width: clamp(180px, 26vw, 300px); }
}

@media (max-width: 760px) {
  [data-eterna-hero-layer] { --et-hero-gutter: 16px; }
  [data-eterna-hero-ring] { display: none; }
  [data-eterna-hero-mark] { width: clamp(150px, 32vw, 220px); }
}

@media (max-width: 640px) {
  [data-eterna-hero-glow] { opacity: 0.62; }
  [data-eterna-hero-mark] { width: 140px; }
}

@media (prefers-reduced-motion: reduce) {
  [data-eterna-hero-glow] { animation: none; }
}
`

/** 造型标记（幂等:同文档重复装载复用既有节点）。 */
const STYLE_MARKER = 'data-eterna-hero-styles'

/**
 * 幂等注入 hero 样式。
 *
 * 令牌注入走 bridge 模式：`--et-*` 从宿主 `--dsw-alias-*` 派生，深浅主题跟随
 * 产品壳（与 access/panel/compaction 等客户端半边同款配方）。
 *
 * @param doc - 目标文档（测试可传桩；默认全局 document）。
 */
export function injectHeroStyles(doc: Document = document): void {
  injectDesignTokens({ bridge: true, doc })
  if (doc.querySelector(`style[${STYLE_MARKER}]`) !== null) return
  const style = doc.createElement('style')
  style.setAttribute(STYLE_MARKER, '')
  style.textContent = HERO_CSS
  doc.head.append(style)
}
