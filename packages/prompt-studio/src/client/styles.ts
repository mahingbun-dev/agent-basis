/**
 * 提示词工坊/循环轨迹样式——对齐 panel v3 的 apple.com 设计语言(大标题/大留白/
 * hairline 分隔/胶囊按钮)。色彩只经 DSH 官方语义令牌(--dsw-alias-*),深/浅主题
 * 自动跟随,不写字面色值(硬性规范第 6 条)。滚动职责:root 自身 overflow-y:auto。
 */
const CSS = `
[data-t7-studio-root], [data-t7-trace-root] {
  height: 100%;
  overflow-y: auto;
  overflow-x: hidden;
  scrollbar-gutter: stable;
  display: block;
  padding: 56px 40px 96px;
  max-width: 860px;
  margin: 0 auto;
  font-family: var(--dsw-font-family, inherit);
  font-size: 14px;
  line-height: 22px;
  min-width: 0;
  color: var(--dsw-alias-label-primary);
}
[data-t7-studio-root] *, [data-t7-trace-root] * { min-width: 0; overflow-wrap: anywhere; box-sizing: border-box; }

/* —— 头部 —— */
[data-t7-heading] {
  margin: 0; font-size: 32px; line-height: 38px; font-weight: 700;
  letter-spacing: -0.015em; color: var(--dsw-alias-label-primary);
}
[data-t7-sub] { margin: 6px 0 0; font-size: 15px; line-height: 22px; color: var(--dsw-alias-label-tertiary); }
[data-t7-toolbar] { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-bottom: 8px; }
[data-t7-refresh] {
  padding: 5px 14px; font: inherit; font-size: 12px; cursor: pointer;
  color: var(--dsw-alias-label-secondary); background: transparent;
  border: 1px solid var(--dsw-alias-border-l2); border-radius: 980px;
}
[data-t7-refresh]:hover { background: var(--dsw-alias-interactive-bg-hover); color: var(--dsw-alias-label-primary); }

/* —— 大数字瓦片 —— */
[data-t7-stat-row] { display: flex; align-items: baseline; gap: 36px; margin: 20px 0 40px; flex-wrap: wrap; }
[data-t7-stat] { display: inline-flex; flex-direction: column; gap: 2px; }
[data-t7-stat-value] {
  font-size: 28px; line-height: 32px; font-weight: 600; font-variant-numeric: tabular-nums;
  letter-spacing: -0.02em; color: var(--dsw-alias-label-primary);
}
[data-t7-stat-label] { font-size: 12px; line-height: 16px; color: var(--dsw-alias-label-tertiary); }

/* —— section 节奏 —— */
[data-t7-section] { margin: 0 0 48px; display: flex; flex-direction: column; gap: 12px; }
[data-t7-section-title] {
  margin: 0; font-size: 21px; line-height: 26px; font-weight: 600;
  letter-spacing: -0.01em; color: var(--dsw-alias-label-primary);
}
[data-t7-section-note] { margin: -6px 0 0; font-size: 13px; line-height: 20px; color: var(--dsw-alias-label-tertiary); }
[data-t7-placeholder] { font-size: 13px; color: var(--dsw-alias-label-tertiary); }
[data-t7-error] { font-size: 13px; color: var(--dsw-alias-state-error-primary); overflow-wrap: anywhere; }

/* —— 组合只读区 —— */
[data-t7-composed] {
  border-radius: 18px; padding: 16px 20px;
  background: var(--dsw-alias-bg-layer-1, transparent);
  border: 0.5px solid var(--dsw-alias-border-l2);
}
[data-t7-composed-note] { margin: 0 0 12px; font-size: 12px; line-height: 18px; color: var(--dsw-alias-label-tertiary); }
[data-t7-composed-text] {
  margin: 0; padding: 12px; max-height: 320px; overflow-y: auto;
  font-family: ui-monospace, SFMono-Regular, monospace;
  font-size: 12px; line-height: 19px; white-space: pre-wrap;
  color: var(--dsw-alias-label-secondary);
  background: var(--dsw-alias-bg-layer-2, transparent);
  border: 0.5px solid var(--dsw-alias-border-l3); border-radius: 12px;
}
[data-t7-composed-error] { margin: 0; font-size: 13px; color: var(--dsw-alias-state-error-primary); }
[data-t7-composed-meta] { margin: 10px 0 0; font-size: 11px; color: var(--dsw-alias-label-tertiary); }
[data-t7-persona-path] { overflow-wrap: anywhere; }

/* —— 编辑器 —— */
[data-t7-editor] {
  width: 100%; resize: vertical; padding: 12px;
  font-family: ui-monospace, SFMono-Regular, monospace;
  font-size: 12px; line-height: 19px; color: var(--dsw-alias-label-primary);
  background: var(--dsw-alias-bg-layer-1, transparent);
  border: 1px solid var(--dsw-alias-border-l2); border-radius: 12px;
}
[data-t7-editor]:focus-visible { outline: 2px solid var(--dsw-alias-state-business-primary); outline-offset: 1px; }
[data-t7-editor]:disabled { opacity: 0.6; }
[data-t7-editor-meta] { display: flex; gap: 16px; align-items: baseline; font-size: 12px; color: var(--dsw-alias-label-tertiary); }
[data-t7-editor-bytes] { font-variant-numeric: tabular-nums; }
[data-t7-editor-dirty][data-t7-editor-dirty-flag='true'] { color: var(--dsw-alias-state-warn-primary); font-weight: 600; }
[data-t7-save-summary] {
  padding: 8px 12px; font: inherit; font-size: 13px; color: var(--dsw-alias-label-primary);
  background: var(--dsw-alias-bg-layer-1, transparent);
  border: 1px solid var(--dsw-alias-border-l2); border-radius: 980px;
}
[data-t7-save-summary]:focus-visible { outline: 2px solid var(--dsw-alias-state-business-primary); outline-offset: 1px; }
[data-t7-editor-actions] { display: flex; gap: 10px; }
[data-t7-save-btn] {
  padding: 8px 20px; font: inherit; font-size: 13px; font-weight: 600; cursor: pointer;
  color: var(--dsw-alias-label-primary-foreground);
  background: var(--dsw-alias-state-error-primary); border: 0; border-radius: 980px;
}
[data-t7-save-btn]:hover:not(:disabled) { filter: brightness(1.08); }
[data-t7-save-btn]:disabled { opacity: 0.45; cursor: default; }

/* —— 写结果(就地展示) —— */
[data-t7-write-outcome] {
  display: flex; flex-direction: column; gap: 6px;
  padding: 12px 16px; border-radius: 12px; font-size: 13px;
  background: var(--dsw-alias-bg-layer-1, transparent);
  border: 0.5px solid var(--dsw-alias-border-l2);
}
[data-t7-write-outcome][data-t7-write-status='committed'] { border-color: var(--dsw-alias-state-success-primary); }
[data-t7-write-outcome][data-t7-write-status='rejected'],
[data-t7-write-outcome][data-t7-write-status='error'],
[data-t7-write-outcome][data-t7-write-status='approval-mismatch'] { border-color: var(--dsw-alias-state-error-primary); }
[data-t7-write-status-label] { font-weight: 600; color: var(--dsw-alias-label-secondary); }
[data-t7-write-message] { color: var(--dsw-alias-state-error-primary); overflow-wrap: anywhere; }
[data-t7-save-error] { margin: 0; padding-left: 18px; color: var(--dsw-alias-state-error-primary); }
[data-t7-issue] { overflow-wrap: anywhere; }
[data-t7-write-version] { font-variant-numeric: tabular-nums; color: var(--dsw-alias-label-secondary); }
[data-t7-effective-note] { margin: 0; font-size: 12px; line-height: 18px; color: var(--dsw-alias-state-business-primary); }

/* —— R3 审批卡 —— */
[data-t7-approval] {
  margin: 0 0 48px; padding: 16px 20px; display: flex; flex-direction: column; gap: 12px;
  border-radius: 18px; border: 1px solid var(--dsw-alias-state-warn-primary);
  background: color-mix(in srgb, var(--dsw-alias-state-warn-primary) 6%, transparent);
}
[data-t7-approval-card] { display: flex; flex-direction: column; gap: 6px; }
[data-t7-approval-row] { display: grid; grid-template-columns: 72px minmax(0, 1fr); gap: 10px; font-size: 13px; }
[data-t7-approval-key] { color: var(--dsw-alias-label-tertiary); }
[data-t7-approval-value] { color: var(--dsw-alias-label-primary); overflow-wrap: anywhere; }
[data-t7-approval-grade] {
  font-weight: 700; font-size: 11px; padding: 1px 8px; border-radius: 980px;
  color: var(--dsw-alias-state-error-primary);
  background: color-mix(in srgb, var(--dsw-alias-state-error-primary) 12%, transparent);
}
[data-t7-approval-rule] { font-size: 11px; color: var(--dsw-alias-label-tertiary); overflow-wrap: anywhere; }
[data-t7-approval-detail-box] > summary { cursor: pointer; font-size: 12px; color: var(--dsw-alias-label-tertiary); }
[data-t7-approval-detail] {
  margin: 8px 0 0; padding: 12px; max-height: 260px; overflow-y: auto;
  font-family: ui-monospace, SFMono-Regular, monospace;
  font-size: 11px; line-height: 18px; white-space: pre-wrap;
  color: var(--dsw-alias-label-secondary);
  background: var(--dsw-alias-bg-layer-2, transparent);
  border: 0.5px solid var(--dsw-alias-border-l3); border-radius: 12px;
}
[data-t7-approval-questions] { margin: 0; padding-left: 20px; display: flex; flex-direction: column; gap: 10px; }
[data-t7-approval-qheader] {
  display: inline-block; font-size: 11px; font-weight: 600; padding: 1px 10px; border-radius: 980px;
  color: var(--dsw-alias-state-error-primary);
  background: color-mix(in srgb, var(--dsw-alias-state-error-primary) 10%, transparent);
}
[data-t7-approval-qtext] { margin: 4px 0 0; font-size: 13px; color: var(--dsw-alias-label-primary); }
[data-t7-approval-options] { margin: 4px 0 0; padding-left: 18px; font-size: 12px; color: var(--dsw-alias-label-tertiary); }
[data-t7-approval-actions] { display: flex; gap: 10px; }
[data-t7-approve-btn] {
  padding: 8px 20px; font: inherit; font-size: 13px; font-weight: 600; cursor: pointer;
  color: var(--dsw-alias-label-primary-foreground);
  background: var(--dsw-alias-state-error-primary); border: 0; border-radius: 980px;
}
[data-t7-approve-btn]:hover:not(:disabled) { filter: brightness(1.08); }
[data-t7-approve-btn]:disabled, [data-t7-reject-btn]:disabled { opacity: 0.45; cursor: default; }
[data-t7-reject-btn] {
  padding: 8px 20px; font: inherit; font-size: 13px; cursor: pointer;
  color: var(--dsw-alias-label-secondary); background: transparent;
  border: 1px solid var(--dsw-alias-border-l2); border-radius: 980px;
}
[data-t7-reject-btn]:hover:not(:disabled) { background: var(--dsw-alias-interactive-bg-hover); }

/* —— 版本列表 —— */
[data-t7-version-list] {
  border-radius: 18px; padding: 4px 20px;
  background: var(--dsw-alias-bg-layer-1, transparent);
  border: 0.5px solid var(--dsw-alias-border-l2);
}
[data-t7-version-item] { padding: 14px 0; border-bottom: 0.5px solid var(--dsw-alias-border-l3); }
[data-t7-version-item]:last-child { border-bottom: 0; padding-bottom: 4px; }
[data-t7-version-head] { display: flex; align-items: baseline; gap: 10px; flex-wrap: wrap; }
[data-t7-version-seq] { font-size: 14px; font-weight: 700; font-variant-numeric: tabular-nums; color: var(--dsw-alias-label-primary); }
[data-t7-version-id] { font-size: 11px; color: var(--dsw-alias-label-tertiary); overflow-wrap: anywhere; }
[data-t7-version-source-badge] {
  font-size: 11px; font-weight: 600; padding: 1px 10px; border-radius: 980px;
  color: var(--dsw-alias-label-secondary); background: var(--dsw-alias-interactive-bg-hover);
}
[data-t7-version-item][data-t7-version-source='initial'] [data-t7-version-source-badge] { color: var(--dsw-alias-state-business-primary); }
[data-t7-version-item][data-t7-version-source='rollback'] [data-t7-version-source-badge] { color: var(--dsw-alias-state-warn-primary); }
[data-t7-version-meta] { margin-left: auto; font-size: 11px; color: var(--dsw-alias-label-tertiary); font-variant-numeric: tabular-nums; }
[data-t7-version-summary] { margin: 6px 0 0; font-size: 12px; color: var(--dsw-alias-label-secondary); }
[data-t7-version-actions] { display: flex; gap: 8px; margin-top: 8px; flex-wrap: wrap; }
[data-t7-version-toggle], [data-t7-load-btn], [data-t7-diff-btn], [data-t7-export-btn], [data-t7-rollback-btn] {
  padding: 3px 12px; font: inherit; font-size: 12px; cursor: pointer;
  color: var(--dsw-alias-state-business-primary); background: transparent;
  border: 1px solid var(--dsw-alias-border-l2); border-radius: 980px;
}
[data-t7-version-toggle]:hover, [data-t7-load-btn]:hover, [data-t7-diff-btn]:hover:not(:disabled),
[data-t7-export-btn]:hover:not(:disabled) { background: var(--dsw-alias-interactive-bg-hover); }
[data-t7-diff-btn]:disabled, [data-t7-export-btn]:disabled { opacity: 0.45; cursor: default; }
[data-t7-rollback-btn]:hover:not(:disabled) {
  color: var(--dsw-alias-state-warn-primary);
  background: color-mix(in srgb, var(--dsw-alias-state-warn-primary) 10%, transparent);
}
[data-t7-rollback-btn]:disabled { opacity: 0.45; cursor: default; }
[data-t7-version-content] {
  margin: 10px 0 0; padding: 12px; max-height: 260px; overflow-y: auto;
  font-family: ui-monospace, SFMono-Regular, monospace;
  font-size: 11px; line-height: 18px; white-space: pre-wrap;
  color: var(--dsw-alias-label-secondary);
  background: var(--dsw-alias-bg-layer-2, transparent);
  border: 0.5px solid var(--dsw-alias-border-l3); border-radius: 12px;
}

/* —— 版本对比视图(T7.3 ②) —— */
[data-t7-diff] {
  margin-top: 16px; padding: 14px 18px; display: flex; flex-direction: column; gap: 8px;
  border-radius: 18px;
  background: var(--dsw-alias-bg-layer-1, transparent);
  border: 0.5px solid var(--dsw-alias-border-l2);
}
[data-t7-diff-head] { display: flex; align-items: baseline; gap: 14px; flex-wrap: wrap; }
[data-t7-diff-title] { font-size: 13px; font-weight: 700; font-variant-numeric: tabular-nums; color: var(--dsw-alias-label-primary); }
[data-t7-diff-stats] { font-size: 12px; font-variant-numeric: tabular-nums; color: var(--dsw-alias-label-secondary); }
[data-t7-diff-close] {
  margin-left: auto; padding: 3px 12px; font: inherit; font-size: 12px; cursor: pointer;
  color: var(--dsw-alias-label-secondary); background: transparent;
  border: 1px solid var(--dsw-alias-border-l2); border-radius: 980px;
}
[data-t7-diff-close]:hover { background: var(--dsw-alias-interactive-bg-hover); color: var(--dsw-alias-label-primary); }
[data-t7-diff-note] { margin: 0; font-size: 11px; color: var(--dsw-alias-label-tertiary); }
[data-t7-diff-identical] { margin: 0; font-size: 12px; color: var(--dsw-alias-label-tertiary); }
[data-t7-diff-body] {
  padding: 10px 12px; max-height: 320px; overflow-y: auto;
  font-family: ui-monospace, SFMono-Regular, monospace;
  font-size: 11px; line-height: 18px;
  background: var(--dsw-alias-bg-layer-2, transparent);
  border: 0.5px solid var(--dsw-alias-border-l3); border-radius: 12px;
}
[data-t7-diff-op] { display: flex; gap: 8px; white-space: pre-wrap; overflow-wrap: anywhere; }
[data-t7-diff-sign] { flex: none; width: 12px; text-align: center; font-weight: 700; }
[data-t7-diff-op='same'] { color: var(--dsw-alias-label-tertiary); }
[data-t7-diff-op='add'] {
  color: var(--dsw-alias-state-success-primary);
  background: color-mix(in srgb, var(--dsw-alias-state-success-primary) 8%, transparent);
}
[data-t7-diff-op='del'] {
  color: var(--dsw-alias-state-error-primary);
  background: color-mix(in srgb, var(--dsw-alias-state-error-primary) 8%, transparent);
}
[data-t7-diff-truncated] { margin: 6px 0 0; font-size: 11px; color: var(--dsw-alias-label-tertiary); }

/* —— 导出 / 导入(T7.3 ④⑤) —— */
[data-t7-export-row], [data-t7-import-row] {
  display: flex; align-items: center; gap: 12px; flex-wrap: wrap;
  padding: 10px 0; font-size: 12px;
  border-bottom: 0.5px solid var(--dsw-alias-border-l3);
}
[data-t7-export-latest], [data-t7-import-btn] {
  padding: 5px 14px; font: inherit; font-size: 12px; cursor: pointer;
  color: var(--dsw-alias-state-business-primary); background: transparent;
  border: 1px solid var(--dsw-alias-border-l2); border-radius: 980px;
}
[data-t7-export-latest]:hover:not(:disabled), [data-t7-import-btn]:hover:not(:disabled) {
  background: var(--dsw-alias-interactive-bg-hover);
}
[data-t7-export-latest]:disabled, [data-t7-import-btn]:disabled { opacity: 0.45; cursor: default; }
[data-t7-export-status], [data-t7-import-meta] {
  font-size: 11px; font-variant-numeric: tabular-nums;
  color: var(--dsw-alias-label-tertiary); overflow-wrap: anywhere;
}
[data-t7-import-input] { font: inherit; font-size: 12px; color: var(--dsw-alias-label-secondary); max-width: 100%; }

/* —— 循环轨迹:会话列表 —— */
[data-t7-trace-pipeline] { margin: 0 0 16px; font-size: 12px; color: var(--dsw-alias-label-tertiary); }
[data-t7-trace-pipeline-name] { font-weight: 600; }
[data-t7-session-list] {
  border-radius: 18px; padding: 4px 20px;
  background: var(--dsw-alias-bg-layer-1, transparent);
  border: 0.5px solid var(--dsw-alias-border-l2);
}
[data-t7-session-item] {
  width: 100%; display: flex; flex-direction: column; gap: 4px; text-align: left;
  padding: 14px 0; font: inherit; cursor: pointer; background: none; border: 0;
  border-bottom: 0.5px solid var(--dsw-alias-border-l3);
}
[data-t7-session-item]:last-child { border-bottom: 0; padding-bottom: 4px; }
[data-t7-session-item]:hover [data-t7-session-id] { color: var(--dsw-alias-state-business-primary); }
[data-t7-session-id] { font-size: 13px; font-weight: 600; color: var(--dsw-alias-label-primary); overflow-wrap: anywhere; }
[data-t7-session-metrics] {
  display: flex; gap: 14px; flex-wrap: wrap; font-size: 12px;
  color: var(--dsw-alias-label-tertiary); font-variant-numeric: tabular-nums;
}
[data-t7-session-last] { font-size: 11px; color: var(--dsw-alias-label-tertiary); }

/* —— 循环轨迹:轮次树 —— */
[data-t7-trace-toolbar] { display: flex; align-items: center; gap: 14px; flex-wrap: wrap; margin-bottom: 16px; }
[data-t7-trace-back] {
  padding: 5px 14px; font: inherit; font-size: 12px; cursor: pointer;
  color: var(--dsw-alias-label-secondary); background: transparent;
  border: 1px solid var(--dsw-alias-border-l2); border-radius: 980px;
}
[data-t7-trace-back]:hover { background: var(--dsw-alias-interactive-bg-hover); color: var(--dsw-alias-label-primary); }
[data-t7-trace-session-id] { font-size: 13px; font-weight: 600; color: var(--dsw-alias-label-primary); overflow-wrap: anywhere; }
[data-t7-trace-events] { font-size: 12px; color: var(--dsw-alias-label-tertiary); }
[data-t7-trace-turns] { display: flex; flex-direction: column; gap: 16px; }
[data-t7-trace-node] {
  border-radius: 18px; padding: 14px 18px;
  background: var(--dsw-alias-bg-layer-1, transparent);
  border: 0.5px solid var(--dsw-alias-border-l2);
  border-left: 3px solid var(--dsw-alias-border-l3);
}
[data-t7-trace-node][data-t7-turn-reason='end_turn'], [data-t7-trace-node][data-t7-turn-reason='complete'] {
  border-left-color: var(--dsw-alias-state-success-primary);
}
[data-t7-trace-node][data-t7-turn-reason='tool_use'] { border-left-color: var(--dsw-alias-state-business-primary); }
[data-t7-trace-node][data-t7-turn-reason='error'], [data-t7-trace-node][data-t7-turn-reason='aborted'] {
  border-left-color: var(--dsw-alias-state-error-primary);
}
[data-t7-trace-node-head] { display: flex; align-items: baseline; gap: 16px; flex-wrap: wrap; }
[data-t7-trace-turn] { font-size: 14px; font-weight: 700; color: var(--dsw-alias-label-primary); }
[data-t7-trace-duration] { font-size: 13px; font-variant-numeric: tabular-nums; color: var(--dsw-alias-label-secondary); }
[data-t7-trace-tokens] { font-size: 12px; font-variant-numeric: tabular-nums; color: var(--dsw-alias-label-tertiary); }
[data-t7-turn-reason-badge] {
  font-size: 11px; padding: 1px 10px; border-radius: 980px;
  color: var(--dsw-alias-label-tertiary); background: var(--dsw-alias-interactive-bg-hover);
}
[data-t7-trace-tools] { display: flex; flex-direction: column; margin-top: 10px; }
[data-t7-trace-tool] {
  display: flex; align-items: baseline; gap: 12px; flex-wrap: wrap;
  padding: 8px 0; font-size: 12px; border-bottom: 0.5px solid var(--dsw-alias-border-l3);
}
[data-t7-trace-tool]:last-child { border-bottom: 0; }
[data-t7-tool-name] { font-weight: 600; color: var(--dsw-alias-label-secondary); }
[data-t7-tool-duration] { font-variant-numeric: tabular-nums; color: var(--dsw-alias-label-tertiary); }
[data-t7-tool-args] { font-size: 11px; color: var(--dsw-alias-label-tertiary); overflow-wrap: anywhere; }
[data-t7-trace-tool][data-t7-tool-error='true'] [data-t7-tool-name] { color: var(--dsw-alias-state-error-primary); }
[data-t7-tool-error-name] {
  font-size: 11px; font-weight: 600; padding: 1px 8px; border-radius: 980px;
  color: var(--dsw-alias-state-error-primary);
  background: color-mix(in srgb, var(--dsw-alias-state-error-primary) 12%, transparent);
}
[data-t7-trace-approvals] { display: flex; flex-direction: column; gap: 6px; margin-top: 10px; }
[data-t7-approval-point] {
  display: flex; align-items: baseline; gap: 12px; padding: 8px 12px; border-radius: 12px;
  font-size: 12px;
  color: var(--dsw-alias-state-warn-primary);
  background: color-mix(in srgb, var(--dsw-alias-state-warn-primary) 10%, transparent);
}
[data-t7-approval-point-name] { font-weight: 700; }
[data-t7-approval-point-time] { font-size: 11px; color: var(--dsw-alias-label-tertiary); }
`

/** 幂等注入样式表(同文档重复装载时复用既有节点);返回移除该节点的 disposer(卸载零残留)。 */
export function injectStudioStyles(doc: Document = document): () => void {
  const marker = 'data-t7-styles'
  const existing = doc.querySelector(`style[${marker}]`)
  if (existing !== null) return () => { existing.remove() }
  const style = doc.createElement('style')
  style.textContent = CSS
  style.setAttribute(marker, 'true')
  doc.head.append(style)
  return () => { style.remove() }
}
