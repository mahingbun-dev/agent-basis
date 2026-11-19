/**
 * 任务设置分区与徽标样式(2026-11-19;AGENTS.md v4 纪律):
 * - 颜色/字号/间距/圆角只引用 --et-* 令牌(经 DSH 桥接跟随深浅主题,零字面色值);
 * - 圆角只走 var(--et-radius-*);正文不设 font-weight:500;断点只用 760px;
 * - 图标走 @eterna/ui/icons;原生 confirm/alert 不用(删除为即时行删除 + 保存生效)。
 */

export const CSS = `
[data-eterna-tasks='session-role'] {
  display: inline-flex; align-items: center; gap: var(--et-space-1);
  padding: 2px 8px; border-radius: var(--et-radius-pill);
  border: 1px solid transparent; background: var(--et-accent-soft); color: var(--et-accent);
  font-family: var(--et-font-body); font-size: var(--et-text-micro); font-weight: var(--et-weight-display);
  line-height: 1.4; white-space: nowrap;
}
[data-eterna-tasks='session-role'][data-eterna-tasks-role='worker'] {
  background: var(--et-surface-2); color: var(--et-fg-2);
}
[data-eterna-tasks='session-role'][data-eterna-tasks-compact='true'] {
  padding: 0 6px; gap: 2px;
}
[data-eterna-tasks='candidate'] {
  display: inline-flex; align-items: center; gap: var(--et-space-1);
  max-width: 100%; padding: 2px 8px; border-radius: var(--et-radius-pill);
  background: var(--et-accent-soft); color: var(--et-accent);
  font-family: var(--et-font-body); font-size: var(--et-text-micro);
  line-height: 1.4; white-space: nowrap; overflow: hidden;
}
[data-eterna-tasks='candidate'] [data-eterna-tasks-candidate-at] {
  color: var(--et-fg-2); font-variant-numeric: tabular-nums;
}
[data-eterna-tasks='candidate'] [data-eterna-tasks-candidate-from] { color: var(--et-fg-2); }
[data-eterna-tasks='candidate'] [data-eterna-tasks-candidate-hint] { color: var(--et-muted); }

[data-eterna-tasks-settings] {
  display: grid; gap: var(--et-space-4);
  font-family: var(--et-font-body); font-size: var(--et-text-caption); color: var(--et-fg);
  line-height: var(--et-leading-body);
}
[data-eterna-tasks-settings] .ett-head { display: grid; gap: var(--et-space-1); }
[data-eterna-tasks-settings] .ett-title { margin: 0; font-size: var(--et-text-body); font-weight: var(--et-weight-display); }
[data-eterna-tasks-settings] .ett-note { margin: 0; color: var(--et-muted); font-size: var(--et-text-micro); }
[data-eterna-tasks-settings] .ett-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); gap: var(--et-space-4); align-items: start; }
[data-eterna-tasks-settings] .ett-card {
  display: grid; gap: var(--et-space-3);
  padding: var(--et-space-4); border: 1px solid var(--et-border-soft);
  border-radius: var(--et-radius-lg); background: var(--et-surface);
}
[data-eterna-tasks-settings] .ett-card-h { display: flex; align-items: center; gap: var(--et-space-2); }
[data-eterna-tasks-settings] .ett-card-h h3 { margin: 0; font-size: var(--et-text-caption); font-weight: var(--et-weight-display); }
[data-eterna-tasks-settings] .ett-field { display: grid; gap: var(--et-space-1); }
[data-eterna-tasks-settings] .ett-field > label,
[data-eterna-tasks-settings] .ett-field > span { color: var(--et-muted); font-size: var(--et-text-micro); }
[data-eterna-tasks-settings] .ett-sub-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(120px, 1fr)); gap: var(--et-space-2); align-items: end; }
[data-eterna-tasks-settings] .ett-row { display: flex; align-items: center; gap: var(--et-space-2); flex-wrap: wrap; }
[data-eterna-tasks-settings] .ett-row .ett-input { flex: 1 1 140px; width: auto; }
[data-eterna-tasks-settings] .ett-input,
[data-eterna-tasks-settings] .ett-select,
[data-eterna-tasks-settings] .ett-textarea {
  width: 100%; box-sizing: border-box; padding: 8px 10px;
  border: 1px solid var(--et-border); border-radius: var(--et-radius-sm);
  background: var(--et-bg); color: var(--et-fg);
  font: inherit; font-size: var(--et-text-caption);
}
[data-eterna-tasks-settings] .ett-input:focus-visible,
[data-eterna-tasks-settings] .ett-select:focus-visible,
[data-eterna-tasks-settings] .ett-textarea:focus-visible,
[data-eterna-tasks-settings] .ett-btn:focus-visible {
  outline: 2px solid var(--et-accent); outline-offset: 1px;
}
[data-eterna-tasks-settings] .ett-textarea { min-height: 72px; resize: vertical; font-family: var(--et-font-mono); font-size: var(--et-text-micro); line-height: var(--et-leading-snug); }
[data-eterna-tasks-settings] .ett-input:disabled,
[data-eterna-tasks-settings] .ett-select:disabled,
[data-eterna-tasks-settings] .ett-textarea:disabled,
[data-eterna-tasks-settings] .ett-btn:disabled { opacity: 0.55; cursor: not-allowed; }
[data-eterna-tasks-settings] .ett-check { display: inline-flex; align-items: center; gap: var(--et-space-1); font-size: var(--et-text-caption); color: var(--et-fg-2); }
[data-eterna-tasks-settings] .ett-check input { accent-color: var(--et-accent); }
[data-eterna-tasks-settings] .ett-btn {
  display: inline-flex; align-items: center; gap: var(--et-space-1);
  padding: 6px 12px; border: 1px solid var(--et-border); border-radius: var(--et-radius-sm);
  background: var(--et-surface-2); color: var(--et-fg-2);
  font: inherit; font-size: var(--et-text-caption); cursor: pointer;
}
[data-eterna-tasks-settings] .ett-btn:hover:not(:disabled) { border-color: var(--et-fg-2); color: var(--et-fg); }
[data-eterna-tasks-settings] .ett-btn-primary { border-color: var(--et-accent-fill); background: var(--et-accent-fill); color: var(--et-accent-on); }
[data-eterna-tasks-settings] .ett-btn-primary:hover:not(:disabled) { background: var(--et-accent-fill-hover); border-color: var(--et-accent-fill-hover); color: var(--et-accent-on); }
[data-eterna-tasks-settings] .ett-btn-quiet { border-color: transparent; background: none; color: var(--et-muted); padding: 4px 6px; }
[data-eterna-tasks-settings] .ett-btn-quiet:hover:not(:disabled) { color: var(--et-danger); border-color: transparent; }
[data-eterna-tasks-settings] .ett-kv { display: grid; grid-template-columns: max-content 1fr; gap: var(--et-space-1) var(--et-space-3); font-size: var(--et-text-micro); }
[data-eterna-tasks-settings] .ett-kv dt { color: var(--et-muted); }
[data-eterna-tasks-settings] .ett-kv dd { margin: 0; color: var(--et-fg-2); overflow-wrap: anywhere; }
[data-eterna-tasks-settings] .ett-rule {
  display: grid; gap: var(--et-space-2);
  padding: var(--et-space-3); border: 1px solid var(--et-border-soft);
  border-radius: var(--et-radius-sm); background: var(--et-surface-2);
}
[data-eterna-tasks-settings] .ett-sub { color: var(--et-muted); font-size: var(--et-text-micro); margin: 0; }
[data-eterna-tasks-settings] .ett-chip { display: inline-flex; align-items: center; gap: var(--et-space-1); padding: 2px 8px; border-radius: var(--et-radius-pill); background: var(--et-surface-2); color: var(--et-fg-2); font-size: var(--et-text-micro); }
[data-eterna-tasks-settings] .ett-footer {
  position: sticky; bottom: 0; z-index: 2;
  display: flex; align-items: center; justify-content: space-between; gap: var(--et-space-3); flex-wrap: wrap;
  padding: var(--et-space-3) 0; border-top: 1px solid var(--et-border-soft); background: var(--et-surface);
}
[data-eterna-tasks-settings] .ett-feedback { margin: 0; font-size: var(--et-text-micro); color: var(--et-muted); }
[data-eterna-tasks-settings] .ett-feedback[data-eterna-tasks-tone='ok'] { color: var(--et-success); }
[data-eterna-tasks-settings] .ett-feedback[data-eterna-tasks-tone='error'] { color: var(--et-danger); }
[data-eterna-tasks-settings] .ett-feedback[data-eterna-tasks-tone='warn'] { color: var(--et-warn); }
[data-eterna-tasks-settings] .ett-locked { display: grid; gap: var(--et-space-2); padding: var(--et-space-4); border: 1px dashed var(--et-border); border-radius: var(--et-radius-lg); color: var(--et-muted); }
@media (max-width: 760px) {
  [data-eterna-tasks-settings] .ett-grid { grid-template-columns: 1fr; }
  [data-eterna-tasks-settings] .ett-footer { flex-direction: column; align-items: stretch; }
}
`
