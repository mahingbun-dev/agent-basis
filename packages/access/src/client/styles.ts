/**
 * 设置分区样式 —— Webflow 设计语言(近黑/单蓝、4px 锐角、hairline 分隔)。
 * 令牌经 @eterna/ui 注入并桥接 DSH 语义主题;三个分区共用。
 */
import { injectDesignTokens } from '@eterna/ui'

const CSS = `
[data-eterna-access-root] { width: 100%; font-family: var(--et-font-body); font-size: var(--et-text-body); font-weight: var(--et-weight-body); line-height: var(--et-leading-body); color: var(--et-fg); max-width: none; }
[data-eterna-access-root], [data-eterna-access-root] *, [data-eterna-access-root] *::before, [data-eterna-access-root] *::after { box-sizing: border-box; }
[data-eterna-access-root] * { min-width: 0; overflow-wrap: anywhere; }
[data-eterna-access-root] .ea-lead { margin: 0 0 16px; color: var(--et-muted); font-size: var(--et-text-caption); }
[data-eterna-access-root] .ea-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap: var(--et-space-4); }
[data-eterna-access-root] .ea-card { border: 1px solid var(--et-border-soft); border-radius: var(--et-radius-md); padding: var(--et-space-4);
  background: var(--et-surface); }
[data-eterna-access-root] .ea-card.ea-card-wide { grid-column: 1 / -1; }

/* 设置弹窗:所有分区共用同一固定尺寸,切换页面不再伸缩;导航 200 固定,
   内容区保留单一纵向滚动轴(滚动条常驻槽位,避免切换时宽度抖动)。 */
@media (min-width: 768px) {
  [data-shortcut-modal="settings"] {
    --ea-settings-width: 880px;
    --ea-settings-height: 720px;
    --ea-settings-inset: 48px;
    width: min(var(--ea-settings-width), calc(100vw - var(--ea-settings-inset))) !important;
    max-width: min(var(--ea-settings-width), calc(100vw - var(--ea-settings-inset))) !important;
    height: min(var(--ea-settings-height), calc(100vh - 2 * max(24px, var(--dsh-frame-overlay-top, 24px)))) !important;
    height: min(var(--ea-settings-height), calc(100dvh - 2 * max(24px, var(--dsh-frame-overlay-top, 24px)))) !important;
    max-height: min(var(--ea-settings-height), calc(100vh - 2 * max(24px, var(--dsh-frame-overlay-top, 24px)))) !important;
    max-height: min(var(--ea-settings-height), calc(100dvh - 2 * max(24px, var(--dsh-frame-overlay-top, 24px)))) !important;
    grid-template-columns: 200px minmax(0, 1fr) !important;
  }
}

/* 内容区滚动条:细、圆角、随主题取 24% 前景色;轨道透明,稳定占位。 */
[data-shortcut-modal="settings"] > [class$="_options"] {
  scrollbar-gutter: stable;
  scrollbar-width: thin;
  scrollbar-color: color-mix(in oklab, var(--et-fg) 24%, transparent) transparent;
  overscroll-behavior: contain;
}
[data-shortcut-modal="settings"] > [class$="_options"]::-webkit-scrollbar {
  width: 12px;
  height: 12px;
}
[data-shortcut-modal="settings"] > [class$="_options"]::-webkit-scrollbar-track {
  background: transparent;
}
[data-shortcut-modal="settings"] > [class$="_options"]::-webkit-scrollbar-thumb {
  border: 3px solid transparent;
  border-radius: var(--et-radius-pill);
  background: color-mix(in oklab, var(--et-fg) 24%, transparent);
  background-clip: content-box;
}
[data-shortcut-modal="settings"] > [class$="_options"]::-webkit-scrollbar-thumb:hover {
  background: color-mix(in oklab, var(--et-fg) 40%, transparent);
  background-clip: content-box;
}
[data-eterna-access-root] .ea-card h3 { margin: 0 0 var(--et-space-2); font-size: var(--et-text-body); font-weight: var(--et-weight-display); letter-spacing: 0; }
[data-eterna-access-root] label.ea-label { display: block; font-size: var(--et-text-micro); color: var(--et-muted); margin: 12px 0 4px; }
[data-eterna-access-root] input.ea-input, [data-eterna-access-root] select.ea-input {
  width: 100%; min-height: 36px; padding: 10px 12px; border-radius: var(--et-radius-sm); font-size: var(--et-text-caption);
  border: 1px solid var(--et-border);
  background: var(--et-bg); color: var(--et-fg);
  transition: border-color var(--et-motion-fast) var(--et-ease), box-shadow var(--et-motion-fast) var(--et-ease);
}
[data-eterna-access-root] input.ea-input:hover, [data-eterna-access-root] select.ea-input:hover { border-color: var(--et-fg-2); }
[data-eterna-access-root] input.ea-input:focus-visible, [data-eterna-access-root] select.ea-input:focus-visible {
  outline: none; border-color: var(--et-accent); box-shadow: var(--et-focus-ring);
}
[data-eterna-access-root] input[type=file].ea-input { color: var(--et-muted); padding: 6px; }
[data-eterna-access-root] input[type=file].ea-input::file-selector-button {
  margin-right: 10px; padding: 6px 10px; border: 1px solid var(--et-border); border-radius: var(--et-radius-sm);
  background: var(--et-surface-2); color: var(--et-fg); font: inherit; font-size: var(--et-text-micro); cursor: pointer;
}
[data-eterna-access-root] input[type=file].ea-input::file-selector-button:hover { border-color: var(--et-fg-2); }
[data-eterna-access-root] .ea-btn { margin: 0; padding: 10px 16px; min-height: 36px; border: 1px solid transparent; border-radius: var(--et-radius-sm); font: inherit; font-size: var(--et-text-caption); font-weight: var(--et-weight-display); cursor: pointer;
  background: var(--et-accent-fill); color: var(--et-accent-on);
  transition: background-color var(--et-motion-fast) var(--et-ease), border-color var(--et-motion-fast) var(--et-ease), color var(--et-motion-fast) var(--et-ease);
}
[data-eterna-access-root] .ea-btn:hover:not(:disabled) { background: var(--et-accent-fill-hover); }
[data-eterna-access-root] .ea-btn:focus-visible { outline: none; box-shadow: var(--et-focus-ring); }
[data-eterna-access-root] .ea-btn:disabled { opacity: .5; cursor: not-allowed; }
[data-eterna-access-root] .ea-btn.ghost { background: transparent; color: var(--et-fg); border: 1px solid var(--et-border); }
[data-eterna-access-root] .ea-btn.ghost:hover:not(:disabled) { background: var(--et-surface-2); border-color: var(--et-fg-2); }
[data-eterna-access-root] .ea-btn-danger { background: transparent; color: var(--et-danger); border-color: color-mix(in oklab, var(--et-danger), transparent 70%); }
[data-eterna-access-root] .ea-btn-danger:hover:not(:disabled) { background: var(--et-danger-soft); }
[data-eterna-access-root] .ea-row { display: flex; gap: 10px; align-items: center; flex-wrap: wrap; }
[data-eterna-access-root] .ea-row.between { justify-content: space-between; }
[data-eterna-access-root] .ea-row .ea-input { flex: 1 1 160px; }
[data-eterna-access-root] .ea-row select.ea-input { flex: 0 0 110px; width: 110px; }
[data-eterna-access-root] .ea-ok { color: var(--et-success); font-size: var(--et-text-micro); min-height: 18px; margin: 8px 0 0; }
[data-eterna-access-root] .ea-err, [data-eterna-access-root] .ea-error { color: var(--et-danger); font-size: var(--et-text-micro); min-height: 18px; margin: 8px 0 0; white-space: pre-wrap; }
[data-eterna-access-root] .ea-hint { color: var(--et-muted); font-size: var(--et-text-micro); line-height: 1.5; }
[data-eterna-access-root] .ea-avatar { width: 40px; height: 40px; border-radius: 50%; background: var(--et-accent-fill); color: var(--et-accent-on);
  display: inline-flex; align-items: center; justify-content: center; font-size: var(--et-text-body); font-weight: var(--et-weight-display); overflow: hidden; flex: none; }
[data-eterna-access-root] .ea-avatar img { width: 100%; height: 100%; border-radius: 50%; object-fit: cover; }
[data-eterna-access-root] .ea-table-wrap { width: 100%; overflow-x: auto; }
[data-eterna-access-root] table.ea-table { width: 100%; border-collapse: collapse; font-size: var(--et-text-micro); margin-top: 8px; }
[data-eterna-access-root] .ea-table th, [data-eterna-access-root] .ea-table td { padding: 9px 10px; text-align: left; border-bottom: 1px solid var(--et-border-soft); vertical-align: middle; }
[data-eterna-access-root] .ea-table th { color: var(--et-muted); font-weight: var(--et-weight-display); white-space: nowrap; }
[data-eterna-access-root] .ea-tag { font-size: var(--et-text-micro); padding: 2px 8px; border-radius: var(--et-radius-sm); background: var(--et-surface-2); color: var(--et-muted); }
[data-eterna-access-root] .ea-tag.brand { color: var(--et-accent); background: var(--et-accent-soft); }
[data-eterna-access-root] .ea-tag.red { color: var(--et-danger); background: var(--et-danger-soft); }
[data-eterna-access-root] .ea-dangerclick { color: var(--et-danger); cursor: pointer; background: none; border: 0; padding: 4px 8px; margin-left: -8px; font-size: var(--et-text-micro); min-height: 36px; }
[data-eterna-access-root] .ea-dangerclick:hover { text-decoration: underline; text-underline-offset: 3px; }
[data-eterna-access-root] .ea-dangerclick:focus-visible { outline: none; box-shadow: var(--et-focus-ring); }

/* —— 设置分区列表(我的插件/消息与审批/审批队列) —— */
[data-eterna-access-root] .ea-section { display: flex; flex-direction: column; gap: 12px; }
[data-eterna-access-root] .ea-section h3 { margin: 0; font-size: var(--et-text-body); font-weight: var(--et-weight-display); }
[data-eterna-access-root] .ea-section h4 { margin: 8px 0 4px; font-size: var(--et-text-caption); font-weight: var(--et-weight-display); color: var(--et-fg-2); }
[data-eterna-access-root] .ea-list { display: flex; flex-direction: column; border-top: 1px solid var(--et-border-soft); }
[data-eterna-access-root] .ea-list .ea-row { padding: 12px 0; border-bottom: 1px solid var(--et-border-soft); align-items: center; }
[data-eterna-access-root] .ea-row-title { flex: 1 1 180px; font-size: var(--et-text-caption); font-weight: var(--et-weight-display); color: var(--et-fg); }
[data-eterna-access-root] .ea-row-meta { font-size: var(--et-text-micro); color: var(--et-muted); }
[data-eterna-access-root] .ea-row-actions { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; margin-left: auto; }

/* —— 插件页签(与原生插件页同构的卡片形态) —— */
[data-eterna-access-root] .ea-group { display: flex; flex-direction: column; gap: 8px; }
[data-eterna-access-root] .ea-group + .ea-group { margin-top: var(--et-space-8); }
[data-eterna-access-root] .ea-group-head { display: flex; align-items: center; gap: 8px; }
[data-eterna-access-root] .ea-group-title { flex: 1; margin: 0; font-size: var(--et-text-body); font-weight: var(--et-weight-display); line-height: 1.4; }
[data-eterna-access-root] .ea-group-hint { flex: none; font-size: var(--et-text-micro); color: var(--et-muted); }
[data-eterna-access-root] .ea-cards { display: flex; flex-direction: column; margin: 0; padding: 0; list-style: none; border-top: 1px solid var(--et-border-soft); }
[data-eterna-access-root] .ea-pcard { border-radius: var(--et-radius-md); margin: 0; min-width: 0; border-bottom: 1px solid var(--et-border-soft); }
[data-eterna-access-root] .ea-pcard:last-child { border-bottom: 0; }
@media (hover: hover) {
  [data-eterna-access-root] .ea-pcard.ea-act:hover { background: var(--et-surface-2); }
  [data-eterna-access-root] .ea-pcard.ea-act:active { background: color-mix(in oklab, var(--et-surface-2), var(--et-fg) 4%); }
}
[data-eterna-access-root] .ea-phead { display: flex; align-items: center; gap: 14px; padding: 12px 4px; }
[data-eterna-access-root] .ea-picon { display: inline-flex; align-items: center; justify-content: center; flex: none;
  width: 48px; height: 48px; border: 1px solid var(--et-border-soft); border-radius: var(--et-radius-md);
  color: var(--et-fg-2); background: var(--et-bg); }
[data-eterna-access-root] .ea-picon > span { display: inline-flex; line-height: 0; }
[data-eterna-access-root] .ea-pmain { display: flex; flex-direction: column; flex: 1; gap: 3px; min-width: 0; }
[data-eterna-access-root] .ea-ptitle-row { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; min-width: 0; }
[data-eterna-access-root] .ea-ptitle { font-size: var(--et-text-caption); font-weight: var(--et-weight-display); line-height: 1.5; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
[data-eterna-access-root] .ea-pdesc { color: var(--et-muted); font-size: var(--et-text-micro); line-height: 1.5;
  display: -webkit-box; -webkit-line-clamp: 1; -webkit-box-orient: vertical; overflow: hidden; }
[data-eterna-access-root] .ea-pend { display: inline-flex; align-items: center; gap: 12px; flex: none; position: relative; z-index: 1; }
[data-eterna-access-root] .ea-switch { box-sizing: border-box; position: relative; flex: 0 0 auto; width: 36px; height: 20px; padding: 2px;
  border: 0; border-radius: var(--et-radius-pill); background: var(--et-border); cursor: pointer; }
[data-eterna-access-root] .ea-switch[aria-checked="true"] { background: var(--et-accent-fill); }
[data-eterna-access-root] .ea-switch:disabled { cursor: default; opacity: .5; }
[data-eterna-access-root] .ea-switch::after { content: ""; position: absolute; inset: -8px; }
[data-eterna-access-root] .ea-switch .ea-thumb { display: block; width: 16px; height: 16px; border-radius: 50%;
  background: var(--et-accent-on); transition: transform var(--et-motion-fast) var(--et-ease); }
[data-eterna-access-root] .ea-switch[aria-checked="true"] .ea-thumb { transform: translate(16px); }
[data-eterna-access-root] .ea-switch:focus-visible, [data-eterna-access-root] .ea-del:focus-visible {
  outline: none; box-shadow: var(--et-focus-ring); border-radius: var(--et-radius-sm); }
[data-eterna-access-root] .ea-del { min-height: 36px; padding: 0 10px; border: 0; border-radius: var(--et-radius-sm);
  background: none; color: var(--et-muted); font-size: var(--et-text-micro); cursor: pointer; }
[data-eterna-access-root] .ea-del:hover { color: var(--et-danger); background: var(--et-danger-soft); }
[data-eterna-access-root] .ea-del.ea-armed { background: var(--et-danger-soft); color: var(--et-danger); font-weight: var(--et-weight-display); }
[data-eterna-access-root] .ea-pill { display: inline-flex; align-items: center; border-radius: var(--et-radius-sm); padding: 2px 8px;
  font-size: var(--et-text-micro); line-height: 1.4; font-weight: var(--et-weight-display); white-space: nowrap; }
[data-eterna-access-root] .ea-pill.danger { background: var(--et-danger-soft); color: var(--et-danger); }
[data-eterna-access-root] .ea-pill.warn { background: color-mix(in oklab, var(--et-warn), transparent 88%); color: var(--et-warn); }
[data-eterna-access-root] .ea-pill.neutral { background: var(--et-surface-2); color: var(--et-muted); }

@media (prefers-reduced-motion: reduce) {
  [data-eterna-access-root] .ea-switch .ea-thumb,
  [data-eterna-access-root] .ea-btn,
  [data-eterna-access-root] input.ea-input,
  [data-eterna-access-root] select.ea-input { transition: none; }
}
@media (max-width: 760px) {
  [data-eterna-access-root] .ea-grid { grid-template-columns: 1fr; }
  [data-eterna-access-root] .ea-phead { gap: 10px; padding: 12px 0; }
  [data-eterna-access-root] .ea-ptitle { white-space: normal; }
  [data-eterna-access-root] .ea-row-actions { width: 100%; margin-left: 0; }
  [data-eterna-access-root] .ea-table { min-width: 560px; }
}

/* 工作区行「+ 新建会话」常驻(2026-11-12 用户反馈:hover-only 发现性差=「不见了」;
   上游 Rows.tsx 的 rowActions 由 CSS hover 显隐,access 全局样式强制可见) */
[data-row-key^="workspace:"] button[aria-label*="新建会话"] {
  opacity: 1 !important;
  visibility: visible !important;
  pointer-events: auto !important;
}

/* 思考强度滑杆(2026-11-12,ZCode composer-thought-slider 同构):
   原生 range 透明叠加在可视轨道上——track/thumb 全透,确保首尾档位与
   点击/拖动坐标对齐;交互事件由组件层 stopPropagation。 */
.et-thought-slider {
  position: relative;
  height: 32px;
}
.et-thought-slider[data-disabled="true"] {
  opacity: 0.5;
}
.et-thought-slider:has(input:focus-visible) {
  outline: 2px solid var(--et-accent-soft);
  outline-offset: 2px;
}
.et-thought-range {
  position: absolute;
  inset: 0;
  margin: 0;
  width: 100%;
  height: 32px;
  cursor: pointer;
  appearance: none;
  -webkit-appearance: none;
  background: transparent;
  outline: none;
}
.et-thought-range[aria-disabled="true"] {
  cursor: default;
}
.et-thought-range::-webkit-slider-runnable-track {
  height: 32px;
  background: transparent;
}
.et-thought-range::-webkit-slider-thumb {
  appearance: none;
  -webkit-appearance: none;
  width: 28px;
  height: 28px;
  margin-top: 2px;
  border: 0;
  border-radius: 50%;
  background: transparent;
}
.et-thought-range::-moz-range-track {
  height: 32px;
  background: transparent;
}
.et-thought-range::-moz-range-thumb {
  width: 28px;
  height: 28px;
  border: 0;
  border-radius: 50%;
  background: transparent;
}
.et-thought-range::-moz-range-progress {
  background: transparent;
}

/* max 档气泡流动(ZCode composer-thought-bubbles 同构,白色小圆自右向左漂) */
.et-thought-bubble {
  opacity: 0;
  animation: et-thought-bubble-flow linear infinite;
}
@keyframes et-thought-bubble-flow {
  0% { transform: translateX(104%); opacity: 0; }
  15%, 80% { opacity: 0.4; }
  100% { transform: translateX(-4%); opacity: 0; }
}
@media (prefers-reduced-motion: reduce) {
  .et-thought-slider * {
    transition: none !important;
  }
  .et-thought-bubble {
    animation: none !important;
    opacity: 0 !important;
  }
}

/* ── 侧栏底部账户入口与账户菜单(原型:头像+昵称入口,菜单向上展开) ── */
[data-eterna-account-root] {
  flex: 1;
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 2px;
}
[data-eterna-account-root], [data-eterna-account-root] * { box-sizing: border-box; }
[data-eterna-account-root] .ea-account-trigger {
  flex: 1;
  min-width: 0;
  height: 36px;
  margin: 0;
  padding: 4px 8px 4px 4px;
  display: flex;
  align-items: center;
  gap: 8px;
  border: 1px solid transparent;
  border-radius: var(--et-radius-sm);
  background: transparent;
  color: var(--et-fg);
  font: inherit;
  font-size: var(--et-text-caption);
  font-weight: 500;
  line-height: 1.4;
  text-align: left;
  cursor: pointer;
  transition: background-color var(--et-motion-fast) var(--et-ease), border-color var(--et-motion-fast) var(--et-ease);
}
[data-eterna-account-root] .ea-account-trigger:hover { background: var(--et-surface-2); }
[data-eterna-account-root][data-wide="false"] { flex: none; justify-content: center; }
[data-eterna-account-root][data-wide="false"] .ea-account-trigger {
  flex: none;
  width: 36px;
  padding: 0;
  justify-content: center;
}
[data-eterna-account-root] .ea-account-trigger:focus-visible,
[data-eterna-account-root] .ea-account-gear:focus-visible {
  outline: none;
  border-color: var(--et-accent);
  box-shadow: var(--et-focus-ring);
}
[data-eterna-account-root] .ea-account-name {
  min-width: 0;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}
[data-eterna-account-root] .ea-account-gear {
  flex: none;
  width: 32px;
  height: 32px;
  margin: 0;
  padding: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: 1px solid transparent;
  border-radius: var(--et-radius-sm);
  background: transparent;
  color: var(--et-muted);
  cursor: pointer;
  transition: background-color var(--et-motion-fast) var(--et-ease), color var(--et-motion-fast) var(--et-ease);
}
[data-eterna-account-root] .ea-account-gear:hover { background: var(--et-surface-2); color: var(--et-fg); }
[data-eterna-account-root] .ea-account-avatar {
  flex: none;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
  border-radius: var(--et-radius-pill);
  background: var(--et-surface-2);
  color: var(--et-fg-2);
  font-size: var(--et-text-caption);
  font-weight: 600;
  line-height: 1;
}
[data-eterna-account-root] .ea-account-avatar img { width: 100%; height: 100%; object-fit: cover; display: block; }
[data-eterna-account-root] .ea-account-avatar--large { font-size: var(--et-text-body); }

.ea-account-menu {
  position: fixed;
  z-index: 2147483000;
  max-height: calc(100dvh - 24px);
  overflow-y: auto;
  padding: 6px;
  border: 1px solid var(--et-border);
  border-radius: var(--et-radius-lg);
  background: var(--et-surface);
  color: var(--et-fg);
  box-shadow: var(--et-shadow-raised);
  font-family: var(--et-font-body);
  font-size: var(--et-text-caption);
  font-weight: 400;
  line-height: 1.5;
  text-align: left;
  overscroll-behavior: contain;
}
.ea-account-menu, .ea-account-menu * { box-sizing: border-box; }
.ea-account-menu .ea-account-id {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 8px 10px;
}
.ea-account-menu .ea-account-id-block { min-width: 0; flex: 1; display: grid; gap: 2px; }
.ea-account-menu .ea-account-name-row { display: flex; align-items: center; gap: 8px; min-width: 0; }
.ea-account-menu .ea-account-full-name {
  min-width: 0;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
  font-size: var(--et-text-body);
  font-weight: 600;
  line-height: 1.35;
}
.ea-account-menu .ea-account-pill {
  flex: none;
  padding: 0 6px;
  border-radius: var(--et-radius-sm);
  background: var(--et-accent-soft);
  color: var(--et-accent);
  font-size: var(--et-text-micro);
  font-weight: 600;
  line-height: 18px;
}
.ea-account-menu .ea-account-id-row { display: flex; align-items: center; gap: 4px; min-width: 0; }
.ea-account-menu .ea-account-id-text {
  min-width: 0;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
  color: var(--et-muted);
  font-size: var(--et-text-micro);
  font-variant-numeric: tabular-nums;
}
.ea-account-menu .ea-account-copy {
  flex: none;
  width: 24px;
  height: 24px;
  margin: 0;
  padding: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: 0;
  border-radius: var(--et-radius-sm);
  background: transparent;
  color: var(--et-muted);
  cursor: pointer;
}
.ea-account-menu .ea-account-copy:hover { background: var(--et-surface-2); color: var(--et-fg); }
.ea-account-menu .ea-account-copy:focus-visible,
.ea-account-menu .ea-account-item:focus-visible,
.ea-account-menu .ea-account-subitem:focus-visible,
.ea-account-menu .ea-account-btn:focus-visible {
  outline: none;
  box-shadow: var(--et-focus-ring);
}
.ea-account-menu .ea-account-copy:disabled { opacity: 0.5; cursor: default; }
.ea-account-menu .ea-account-divider {
  height: 1px;
  margin: 4px 2px;
  background: var(--et-border-soft);
}
.ea-account-menu .ea-account-item {
  width: 100%;
  min-height: 38px;
  margin: 0;
  padding: 8px 10px;
  display: flex;
  align-items: center;
  gap: 10px;
  border: 0;
  border-radius: var(--et-radius-sm);
  background: transparent;
  color: var(--et-fg);
  font: inherit;
  font-size: var(--et-text-caption);
  font-weight: 400;
  line-height: 1.4;
  text-align: left;
  cursor: pointer;
  transition: background-color var(--et-motion-fast) var(--et-ease), color var(--et-motion-fast) var(--et-ease);
}
.ea-account-menu .ea-account-item:hover { background: var(--et-surface-2); }
.ea-account-menu .ea-account-item > svg { flex: none; color: var(--et-muted); }
.ea-account-menu .ea-account-item > span { min-width: 0; flex: 1; }
.ea-account-menu .ea-account-chev { margin-left: auto; transition: transform var(--et-motion-fast) var(--et-ease); }
.ea-account-menu .ea-account-item[aria-expanded="true"] .ea-account-chev { transform: rotate(90deg); }
.ea-account-menu .ea-account-item--danger { color: var(--et-danger); }
.ea-account-menu .ea-account-item--danger > svg { color: var(--et-danger); }
.ea-account-menu .ea-account-item--danger:hover { background: var(--et-danger-soft); color: var(--et-danger); }
.ea-account-menu .ea-account-sub { display: grid; gap: 2px; margin: 2px 0 4px 30px; }
.ea-account-menu .ea-account-subitem {
  min-height: 34px;
  margin: 0;
  padding: 6px 8px;
  display: flex;
  align-items: center;
  gap: 8px;
  border: 0;
  border-radius: var(--et-radius-sm);
  background: transparent;
  color: var(--et-fg-2);
  font: inherit;
  font-size: var(--et-text-caption);
  line-height: 1.4;
  text-align: left;
  cursor: pointer;
}
.ea-account-menu .ea-account-subitem:hover { background: var(--et-surface-2); }
.ea-account-menu .ea-account-subitem > span { min-width: 0; flex: 1; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
.ea-account-menu .ea-account-subitem > svg { flex: none; color: var(--et-accent); }
.ea-account-menu .ea-account-subitem[aria-checked="true"] { color: var(--et-fg); font-weight: 500; }
.ea-account-menu .ea-account-confirm { padding: 12px 12px 10px; }
.ea-account-menu .ea-account-confirm-title { margin: 0 0 6px; font-size: var(--et-text-body); font-weight: 600; }
.ea-account-menu .ea-account-confirm-text { margin: 0 0 16px; color: var(--et-muted); font-size: var(--et-text-caption); line-height: 1.6; }
.ea-account-menu .ea-account-confirm-actions { display: flex; justify-content: flex-end; gap: 8px; }
.ea-account-menu .ea-account-btn {
  min-height: 34px;
  margin: 0;
  padding: 6px 12px;
  border: 1px solid var(--et-border);
  border-radius: var(--et-radius-sm);
  background: var(--et-surface);
  color: var(--et-fg);
  font: inherit;
  font-size: var(--et-text-caption);
  font-weight: 500;
  cursor: pointer;
}
.ea-account-menu .ea-account-btn:hover { background: var(--et-surface-2); }
.ea-account-menu .ea-account-btn--danger {
  border-color: var(--et-danger);
  background: transparent;
  color: var(--et-danger);
}
.ea-account-menu .ea-account-btn--danger:hover { background: var(--et-danger-soft); }
.ea-account-menu .ea-account-btn:disabled { opacity: 0.6; cursor: default; }
@media (prefers-reduced-motion: reduce) {
  [data-eterna-account-root] .ea-account-trigger,
  [data-eterna-account-root] .ea-account-gear,
  .ea-account-menu .ea-account-item,
  .ea-account-menu .ea-account-chev {
    transition: none;
  }
}
`

export function injectAccessStyles(doc: Document = document): void {
  injectDesignTokens({ bridge: true, doc })
  if (doc.getElementById('eterna-access-styles') !== null) return
  const style = doc.createElement('style')
  style.id = 'eterna-access-styles'
  style.textContent = CSS
  doc.head.appendChild(style)
}
