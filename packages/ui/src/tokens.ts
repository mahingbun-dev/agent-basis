/**
 * Eterna 统一设计令牌(Webflow 设计语言产品化版本)。
 *
 * 两层结构:
 * 1. Webflow 品牌层(`--et-*`):白/近黑画布、单一 Webflow Blue、4/8px 锐角、
 *    五层级联阴影、16px 标准正文。独立页(登录/扩展设置)直接使用。
 * 2. DSH 桥接层:应用内插件面把 `--et-*` 映射到 DSH 官方语义令牌,深浅主题
 *    跟随产品壳。桥接只引用上游真实存在的 `--dsw-alias-*`。
 *
 * 所有十六进制色值只允许出现在本文件;组件样式一律引用变量。
 */

const LIGHT = `
  color-scheme: light;
  --et-bg: #ffffff;
  --et-surface: #ffffff;
  --et-surface-2: #f7f7f7;
  --et-fg: #080808;
  --et-fg-2: #363636;
  --et-muted: #5a5a5a;
  --et-meta: #ababab;
  --et-border: #d8d8d8;
  --et-border-soft: #ebebeb;
  --et-accent: #146ef5;
  --et-accent-hover: #0055d4;
  --et-accent-active: #0b4fc0;
  --et-accent-fill: #146ef5;
  --et-accent-fill-hover: #0055d4;
  --et-accent-on: #ffffff;
  --et-accent-soft: color-mix(in oklab, var(--et-accent), transparent 90%);
  --et-success: #00a81a;
  --et-warn: #b87300;
  --et-danger: #d3122b;
  --et-danger-soft: color-mix(in oklab, var(--et-danger), transparent 90%);
  --et-shadow: 0 1px 2px rgba(0, 0, 0, 0.06), 0 24px 64px rgba(0, 0, 0, 0.08);
  --et-shadow-raised:
    0px 84px 24px rgba(0, 0, 0, 0),
    0px 54px 22px rgba(0, 0, 0, 0.01),
    0px 30px 18px rgba(0, 0, 0, 0.04),
    0px 13px 13px rgba(0, 0, 0, 0.08),
    0px 3px 7px rgba(0, 0, 0, 0.09);
  --et-focus-ring: 0 0 0 3px color-mix(in oklab, var(--et-accent), transparent 70%);
  --et-selection: color-mix(in oklab, var(--et-accent), transparent 78%);
`

const DARK = `
  color-scheme: dark;
  --et-bg: #080808;
  --et-surface: #101010;
  --et-surface-2: #161616;
  --et-fg: #f5f5f5;
  --et-fg-2: #d4d4d4;
  --et-muted: #a3a3a3;
  --et-meta: #737373;
  --et-border: #2a2a2a;
  --et-border-soft: #1e1e1e;
  --et-accent: #3b89ff;
  --et-accent-hover: #6aa6ff;
  --et-accent-active: #146ef5;
  --et-accent-fill: #2a6fd0;
  --et-accent-fill-hover: #1f5bb0;
  --et-accent-on: #ffffff;
  --et-accent-soft: color-mix(in oklab, var(--et-accent), transparent 88%);
  --et-success: #35e35f;
  --et-warn: #ffb020;
  --et-danger: #ff4d5f;
  --et-danger-soft: color-mix(in oklab, var(--et-danger), transparent 88%);
  --et-shadow: 0 1px 2px rgba(0, 0, 0, 0.6), 0 24px 64px rgba(0, 0, 0, 0.45);
  --et-shadow-raised: 0 1px 2px rgba(0, 0, 0, 0.6), 0 24px 64px rgba(0, 0, 0, 0.45);
  --et-focus-ring: 0 0 0 3px color-mix(in oklab, var(--et-accent), transparent 65%);
  --et-selection: color-mix(in oklab, var(--et-accent), transparent 70%);
`

const SHARED = `
  --et-font-display: "WF Visual Sans Variable", "Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", "Noto Sans CJK SC", sans-serif;
  --et-font-body: "WF Visual Sans Variable", "Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", "Noto Sans CJK SC", sans-serif;
  --et-font-mono: "Inconsolata", ui-monospace, "SF Mono", Menlo, Monaco, Consolas, monospace;

  --et-text-micro: 12px;
  --et-text-caption: 14px;
  --et-text-body: 16px;
  --et-text-lead: 20px;
  --et-text-h3: 24px;
  --et-text-h2: 32px;
  --et-text-h1: 56px;
  --et-leading-body: 1.6;
  --et-leading-tight: 1.04;
  --et-leading-snug: 1.3;
  --et-tracking-display: -0.01em;
  --et-weight-body: 500;
  --et-weight-display: 600;

  --et-space-1: 4px;
  --et-space-2: 8px;
  --et-space-3: 12px;
  --et-space-4: 16px;
  --et-space-5: 20px;
  --et-space-6: 24px;
  --et-space-8: 32px;
  --et-space-12: 48px;
  --et-space-24: 96px;

  --et-radius-sm: 4px;
  --et-radius-md: 4px;
  --et-radius-lg: 8px;
  --et-radius-pill: 9999px;

  --et-motion-fast: 150ms;
  --et-motion-base: 200ms;
  --et-ease: cubic-bezier(0.2, 0, 0, 1);

  --et-container: 1200px;
  /* 主面板与设置弹窗默认全宽；保留一个可选阅读上限，避免未来页面重新缩回窄列。 */
  --et-container-panel: 1600px;
  --et-gutter: 24px;
`

/** Webflow 品牌层(独立页直接使用;深色跟随系统,或由 data-eterna-theme 强制)。 */
export const WEBFLOW_TOKENS_CSS = `
:root, [data-eterna-theme='light'] {${LIGHT}${SHARED}}
@media (prefers-color-scheme: dark) {
  :root:not([data-eterna-theme='light']) {${DARK}}
}
[data-eterna-theme='dark'] {${DARK}}
`

/** 应用内插件面:把品牌令牌桥接到 DSH 官方语义令牌,主题完全跟随产品壳。 */
export const DSH_BRIDGE_CSS = `
/* DSH 把 --dsw-alias-* 定义在 body 上(而非 :root);桥接必须同层声明,
   否则 var() 在 :root 处取不到深色值、退回 Webflow 浅色兜底。 */
body, [data-eterna-ui] {
  --et-bg: var(--dsw-alias-bg-base, #ffffff);
  --et-surface: var(--dsw-alias-bg-layer-1, #ffffff);
  --et-surface-2: var(--dsw-alias-bg-layer-2, #f7f7f7);
  --et-fg: var(--dsw-alias-label-primary, #080808);
  --et-fg-2: var(--dsw-alias-label-secondary, #363636);
  --et-muted: var(--dsw-alias-label-tertiary, #5a5a5a);
  --et-meta: var(--dsw-alias-label-dimmed, #ababab);
  --et-border: var(--dsw-alias-border-l2, #d8d8d8);
  --et-border-soft: var(--dsw-alias-border-l1, #ebebeb);
  --et-accent: var(--dsw-alias-state-business-primary, #146ef5);
  --et-accent-hover: color-mix(in oklab, var(--et-accent), black 14%);
  --et-accent-active: color-mix(in oklab, var(--et-accent), black 24%);
  /* 实心按钮用更深的填充色:DSH business-primary 是浅色强调字色,直接当白字
     按钮底会低于 4.5:1;混黑 35% 后白字对比度约 5:1。 */
  --et-accent-fill: color-mix(in oklab, var(--et-accent), black 35%);
  --et-accent-fill-hover: color-mix(in oklab, var(--et-accent), black 45%);
  --et-accent-on: #ffffff;
  --et-accent-soft: color-mix(in oklab, var(--et-accent), transparent 90%);
  --et-success: var(--dsw-alias-state-success-primary, #00a81a);
  --et-warn: var(--dsw-alias-state-warn-primary, #b87300);
  --et-danger: var(--dsw-alias-state-error-primary, #d3122b);
  --et-danger-soft: color-mix(in oklab, var(--et-danger), transparent 90%);
  --et-focus-ring: 0 0 0 3px color-mix(in oklab, var(--et-accent), transparent 70%);
  --et-selection: color-mix(in oklab, var(--et-accent), transparent 78%);
}
`

const STYLE_ID = 'eterna-ui-tokens'

/**
 * 幂等注入设计令牌。应用内传 bridge=true 以跟随 DSH 主题;独立页保持默认
 * Webflow 浅色 + 系统深色。
 * @returns 移除注入节点的 disposer(插件卸载零残留)。
 */
export function injectDesignTokens(options: { readonly bridge?: boolean; readonly doc?: Document } = {}): () => void {
  const doc = options.doc ?? document
  // 应用内只注入非颜色令牌 + DSH 桥接:不设置 color-scheme,避免覆盖产品壳
  // 自身的主题选择;独立页才使用完整 Webflow 浅/深色令牌。
  const css = options.bridge === true ? `:root {${SHARED}}\n${DSH_BRIDGE_CSS}` : WEBFLOW_TOKENS_CSS
  const existing = doc.querySelector(`#${STYLE_ID}`)
  if (existing !== null) {
    if (existing.textContent !== css) existing.textContent = css
    return () => { existing.remove() }
  }
  const style = doc.createElement('style')
  style.id = STYLE_ID
  style.textContent = css
  doc.head.append(style)
  return () => { style.remove() }
}
