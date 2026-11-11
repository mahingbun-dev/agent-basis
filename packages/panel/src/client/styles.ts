/**
 * 基座面板样式 —— Webflow 设计语言(近黑/单蓝、4px 锐角、hairline 分隔、
 * 16px 标准正文)。色值/字号/间距全部经 @eterna/ui 令牌;深浅主题由 DSH
 * 桥接层跟随产品壳。滚动职责:root 自身 overflow-y:auto。
 */
import { injectDesignTokens } from '@eterna/ui'

const CSS = `
[data-eterna-panel='root'] {
  width: 100%;
  height: 100%;
  overflow-y: auto;
  overflow-x: hidden;
  scrollbar-gutter: stable;
  display: block;
  padding: 48px 32px 96px;
  max-width: var(--et-container-panel);
  margin: 0 auto;
  font-family: var(--et-font-body);
  font-size: var(--et-text-caption);
  font-weight: var(--et-weight-body);
  line-height: var(--et-leading-body);
  color: var(--et-fg);
  min-width: 0;
}
[data-eterna-panel='root'] * { min-width: 0; overflow-wrap: anywhere; }

/* —— 头部 —— */
[data-eterna-panel='heading'] {
  margin: 0; font-size: var(--et-text-h2); line-height: 1.15; font-weight: var(--et-weight-display);
  letter-spacing: 0; color: var(--et-fg);
}
[data-eterna-panel='sub'] { margin: 8px 0 0; font-size: var(--et-text-body); line-height: var(--et-leading-body); color: var(--et-muted); }
[data-eterna-panel='toolbar'] { display: flex; align-items: center; justify-content: space-between; gap: var(--et-space-3); margin-bottom: var(--et-space-2); }
[data-eterna-panel='refresh'] {
  padding: 8px 14px; font: inherit; font-size: var(--et-text-caption); cursor: pointer;
  color: var(--et-fg); background: var(--et-bg);
  border: 1px solid var(--et-border); border-radius: var(--et-radius-sm);
  transition: border-color var(--et-motion-fast) var(--et-ease), background var(--et-motion-fast) var(--et-ease);
}
[data-eterna-panel='refresh']:hover { border-color: var(--et-fg-2); }
[data-eterna-panel='refresh']:focus-visible,
[data-eterna-panel='prompt-copy']:focus-visible,
[data-eterna-panel='mem-expand']:focus-visible,
[data-eterna-panel='chip']:focus-visible { outline: none; box-shadow: var(--et-focus-ring); }

/* —— section 节奏 —— */
[data-eterna-panel='section'] { margin: 0 0 var(--et-space-12); display: flex; flex-direction: column; gap: var(--et-space-4); }
[data-eterna-panel='section-title'] {
  margin: 0; font-size: var(--et-text-h3); line-height: var(--et-leading-snug); font-weight: var(--et-weight-display);
  letter-spacing: 0; color: var(--et-fg);
}
[data-eterna-panel='section-note'] { margin: -8px 0 0; font-size: var(--et-text-caption); line-height: var(--et-leading-body); color: var(--et-muted); }

/* —— 三步上手 —— */
[data-eterna-panel='steps'] {
  display: grid; grid-template-columns: repeat(3, 1fr); gap: var(--et-space-6);
  margin: 0 0 var(--et-space-12); padding: 0; background: none; border: 0;
}
[data-eterna-panel='steps-title'] { display: none; }
[data-eterna-panel='step'] { display: flex; flex-direction: column; gap: var(--et-space-1); }
[data-eterna-panel='step-no'] { font-size: var(--et-text-h2); line-height: 1.15; font-weight: var(--et-weight-display); color: var(--et-meta); font-variant-numeric: tabular-nums; }
[data-eterna-panel='step-text'] { font-size: var(--et-text-caption); line-height: var(--et-leading-body); color: var(--et-fg-2); }

/* —— 服务状态 —— */
[data-eterna-panel='cards'] { display: grid; grid-template-columns: repeat(auto-fill, minmax(240px, 1fr)); gap: var(--et-space-6); }
[data-eterna-panel='card'] {
  display: flex; flex-direction: column; gap: var(--et-space-2); min-width: 0;
  padding: var(--et-space-5); border: 1px solid var(--et-border-soft); border-radius: var(--et-radius-md);
  background: var(--et-surface);
}
[data-eterna-panel='card-kicker'] { font-size: var(--et-text-caption); line-height: 1.4; font-weight: var(--et-weight-display); color: var(--et-fg-2); }
[data-eterna-panel='card-count'] { color: var(--et-meta); font-weight: var(--et-weight-body); }
[data-eterna-panel='tile-row'] { display: flex; align-items: flex-start; gap: var(--et-space-8); flex-wrap: wrap; }
[data-eterna-panel='metric'] { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
[data-eterna-panel='metric-value'] { display: block; font-size: var(--et-text-h2); line-height: 1.15; font-weight: var(--et-weight-display); font-variant-numeric: tabular-nums; letter-spacing: 0; color: var(--et-fg); }
[data-eterna-panel='metric-label'] { display: block; font-size: var(--et-text-micro); line-height: 1.3; color: var(--et-muted); }
[data-eterna-panel='kv'] { display: grid; grid-template-columns: auto minmax(0, 1fr); gap: 4px 12px; }
[data-eterna-panel='kv-key'] { font-size: var(--et-text-micro); line-height: 1.5; color: var(--et-muted); }
[data-eterna-panel='kv-value'] { font-size: var(--et-text-micro); line-height: 1.5; color: var(--et-fg-2); overflow-wrap: anywhere; }

/* —— 记忆 —— */
[data-eterna-panel='mem-group'] {
  border-radius: var(--et-radius-md); padding: 4px 20px;
  background: var(--et-surface);
  border: 1px solid var(--et-border-soft);
}
[data-eterna-panel='mem-group'] + [data-eterna-panel='mem-group'] { margin-top: var(--et-space-6); }
[data-eterna-panel='mem-subject'] {
  display: flex; align-items: baseline; gap: var(--et-space-2);
  padding: 12px 0 8px; font-size: var(--et-text-caption); font-weight: var(--et-weight-display);
  color: var(--et-fg-2);
  border-bottom: 1px solid var(--et-border-soft);
}
[data-eterna-panel='mem-count'] { margin-left: auto; font-size: var(--et-text-micro); font-weight: var(--et-weight-body); color: var(--et-meta); font-variant-numeric: tabular-nums; }
[data-eterna-panel='mem-group-desc'] { margin: 8px 0 0; font-size: var(--et-text-micro); line-height: 1.5; color: var(--et-muted); }
[data-eterna-panel='mem-entity'] { padding: 14px 0; border-bottom: 1px solid var(--et-border-soft); }
[data-eterna-panel='mem-entity']:last-child { border-bottom: 0; padding-bottom: 4px; }
[data-eterna-panel='mem-entity-head'] { display: flex; align-items: baseline; gap: var(--et-space-2); margin-bottom: 6px; }
[data-eterna-panel='mem-entity-key'] { font-size: var(--et-text-micro); font-weight: var(--et-weight-display); color: var(--et-fg-2); }
[data-eterna-panel='mem-entity-time'] { margin-left: auto; font-size: var(--et-text-micro); color: var(--et-meta); font-variant-numeric: tabular-nums; }
[data-eterna-panel='mem-entity-content'] { font-size: var(--et-text-caption); line-height: 1.6; color: var(--et-fg); white-space: pre-wrap; }
[data-eterna-panel='mem-entity-content'][data-eterna-panel-clamped='true'] {
  display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden;
}
[data-eterna-panel='mem-expand'] {
  margin-top: 6px; padding: 0; font: inherit; font-size: var(--et-text-micro); cursor: pointer;
  color: var(--et-accent); background: none; border: 0;
}
[data-eterna-panel='mem-expand']:hover { text-decoration: underline; text-underline-offset: 3px; }

/* —— 工具清单 —— */
[data-eterna-panel='card'][data-eterna-panel-card='event-tools'] { grid-column: 1 / -1; }
[data-eterna-panel='tool-list'] { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; }
[data-eterna-panel='tool'] {
  display: flex; align-items: flex-start; gap: var(--et-space-4);
  padding: 14px 0; border-bottom: 1px solid var(--et-border-soft);
}
[data-eterna-panel='tool']:last-child { border-bottom: 0; }
[data-eterna-panel='tool-head'] { display: flex; flex-direction: column; gap: 1px; flex: none; width: 220px; }
[data-eterna-panel='tool-label'] { font-size: var(--et-text-caption); line-height: 1.5; font-weight: var(--et-weight-display); color: var(--et-fg); }
[data-eterna-panel='tool-id'] { font-size: var(--et-text-micro); color: var(--et-meta); overflow-wrap: anywhere; font-family: var(--et-font-mono); }
[data-eterna-panel='tool-desc'] { flex: 1; font-size: var(--et-text-caption); line-height: 1.6; color: var(--et-fg-2); }
[data-eterna-panel='risk'] {
  flex: none; align-self: center; margin-left: auto;
  font-size: var(--et-text-micro); font-weight: var(--et-weight-display); line-height: 1.4; padding: 2px 8px;
  border-radius: var(--et-radius-sm);
}
[data-eterna-panel-risk='R3'] { color: var(--et-danger); background: var(--et-danger-soft); }
[data-eterna-panel-risk='R2'] { color: var(--et-warn); background: color-mix(in oklab, var(--et-warn), transparent 88%); }
[data-eterna-panel-risk='R1'] { color: var(--et-muted); background: var(--et-surface-2); }

/* —— 操作指引 —— */
[data-eterna-panel='prompt'] {
  display: flex; flex-direction: column; gap: 6px; min-width: 0;
  padding: var(--et-space-4); border-radius: var(--et-radius-md);
  background: var(--et-surface);
  border: 1px solid var(--et-border-soft);
}
[data-eterna-panel='prompt-head'] { display: flex; align-items: center; gap: var(--et-space-2); flex-wrap: wrap; }
[data-eterna-panel='prompt-title'] { font-size: var(--et-text-caption); font-weight: var(--et-weight-display); color: var(--et-fg); }
[data-eterna-panel='prompt-capability'] { font-size: var(--et-text-micro); color: var(--et-muted); }
[data-eterna-panel='prompt-copy'] {
  margin-left: auto; padding: 4px 1px; font: inherit; font-size: var(--et-text-micro); cursor: pointer;
  color: var(--et-accent); background: transparent; border: 0;
}
[data-eterna-panel='prompt-copy']:hover { text-decoration: underline; text-underline-offset: 3px; }
[data-eterna-panel='prompt-text'] { margin: 0; font-size: var(--et-text-caption); line-height: 1.6; color: var(--et-fg-2); }
[data-eterna-panel='prompt-note'] { margin: 0; font-size: var(--et-text-micro); line-height: 1.5; color: var(--et-danger); }

/* —— 可观测 —— */
[data-eterna-panel='session'] { display: flex; flex-direction: column; gap: 2px; min-width: 0; padding: 12px 0; border-bottom: 1px solid var(--et-border-soft); }
[data-eterna-panel='session-id'] { font-size: var(--et-text-micro); color: var(--et-fg-2); overflow-wrap: anywhere; font-family: var(--et-font-mono); }
[data-eterna-panel='session-metrics'] { display: flex; gap: 14px; flex-wrap: wrap; font-variant-numeric: tabular-nums; font-size: var(--et-text-micro); color: var(--et-muted); }
[data-eterna-panel='session-last'] { font-size: var(--et-text-micro); color: var(--et-meta); }

[data-eterna-panel='placeholder'] { font-size: var(--et-text-caption); color: var(--et-muted); }
[data-eterna-panel='error'] { color: var(--et-danger); overflow-wrap: anywhere; }

/* —— chips(composer dock) —— */
[data-eterna-panel='chips'] { display: flex; flex-wrap: wrap; align-items: center; gap: var(--et-space-2); padding: 2px 4px 8px; }
[data-eterna-panel='chips-label'] { font-size: var(--et-text-micro); color: var(--et-muted); }
[data-eterna-panel='chip'] {
  padding: 5px 12px; font: inherit; font-size: var(--et-text-micro); line-height: 1.4; cursor: pointer;
  color: var(--et-accent);
  background: var(--et-accent-soft);
  border: 0; border-radius: var(--et-radius-sm);
  transition: background var(--et-motion-fast) var(--et-ease);
}
[data-eterna-panel='chip']:hover:not(:disabled) { background: color-mix(in oklab, var(--et-accent), transparent 82%); }
[data-eterna-panel='chip']:disabled { opacity: 0.45; cursor: default; }

@media (max-width: 900px) {
  [data-eterna-panel='root'] { padding: 32px 20px 64px; }
  [data-eterna-panel='tool'] { flex-direction: column; gap: 6px; }
  [data-eterna-panel='tool-head'] { width: auto; }
  [data-eterna-panel='risk'] { align-self: flex-start; margin-left: 0; }
}
@media (max-width: 640px) {
  [data-eterna-panel='root'] { padding: 24px 16px 48px; }
  [data-eterna-panel='heading'] { font-size: 28px; }
  [data-eterna-panel='steps'] { grid-template-columns: 1fr; gap: var(--et-space-4); }
  [data-eterna-panel='cards'] { grid-template-columns: 1fr; }
  [data-eterna-panel='card'] { padding: var(--et-space-4); }
  [data-eterna-panel='tile-row'] { gap: var(--et-space-6); }
}
@media (prefers-reduced-motion: reduce) {
  [data-eterna-panel='refresh'], [data-eterna-panel='chip'] { transition: none; }
}
`

/** 幂等注入面板样式表(同文档重复装载时复用既有节点)。 */
export function injectPanelStyles(doc: Document = document): void {
  injectDesignTokens({ bridge: true, doc })
  const marker = 'data-eterna-panel-styles'
  if (doc.querySelector(`style[${marker}]`) !== null) return
  const style = doc.createElement('style')
  style.textContent = CSS
  style.setAttribute(marker, 'true')
  doc.head.append(style)
}
