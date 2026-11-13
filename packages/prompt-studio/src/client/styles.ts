/**
 * 提示词工坊/循环轨迹样式——对齐 panel v3 的 apple.com 设计语言(大标题/大留白/
 * hairline 分隔/胶囊按钮)。T1.5 全景改版新增 data-ps-* 面(分组导航/条目详情/
 * 胶囊徽标/风险警示区),组件形态对照 packages/access 插件页分组行卡先例。
 * 色彩只经 DSH 官方语义令牌(--dsw-alias-*),深/浅主题自动跟随,不写字面色值
 * (硬性规范第 6 条)。滚动职责:root 自身 overflow-y:auto;640px 断点收边距。
 * 2026-11-11:统一接入 @eterna/ui(Webflow 令牌 + DSH 桥接)。
 */
import { injectDesignTokens } from '@eterna/ui'

const CSS = `
[data-t7-studio-root], [data-t7-trace-root] {
  animation: et-fade-in var(--et-motion-base) var(--et-ease) both;
  width: 100%;
  height: 100%;
  /* border-box 必须落在根元素自身:width:100% + 横向 padding 48px×2 在 content-box
     下渲染宽 = 100%+96px,整面板被推出宿主主区右缘(AI 助手栏被裁切,2026-11-13
     用户实测);全局 box-sizing 规则只覆盖后代,不含根元素本身。 */
  box-sizing: border-box;
  overflow-y: auto;
  overflow-x: hidden;
  scrollbar-gutter: stable;
  display: block;
  padding: 40px 40px 80px;
  max-width: none;
  margin: 0 auto;
  font-family: var(--et-font-body);
  font-size: var(--et-text-body);
  line-height: var(--et-leading-body);
  min-width: 0;
  color: var(--et-fg);
}
[data-t7-studio-root] *, [data-t7-trace-root] * { min-width: 0; overflow-wrap: anywhere; box-sizing: border-box; }

/* —— 头部 —— */
[data-t7-heading] {
  margin: 0; font-size: var(--et-text-h1); line-height: 1.15; font-weight: var(--et-weight-display);
  letter-spacing: 0; color: var(--et-fg);
}
[data-t7-sub] { margin: 8px 0 0; font-size: var(--et-text-body); line-height: var(--et-leading-body); color: var(--et-muted); }
[data-t7-toolbar] { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-bottom: 8px; }
[data-t7-refresh] {
  padding: 5px 14px; font: inherit; font-size: var(--et-text-micro); cursor: pointer;
  color: var(--et-fg-2); background: transparent;
  border: 1px solid var(--et-border); border-radius: var(--et-radius-sm);
}
[data-t7-refresh]:hover { background: var(--et-surface-2); color: var(--et-fg); }

/* —— 大数字瓦片 —— */
[data-t7-stat-row] { display: flex; align-items: baseline; gap: 36px; margin: 20px 0 40px; flex-wrap: wrap; }
[data-t7-stat] { display: inline-flex; flex-direction: column; gap: 2px; }
[data-t7-stat-value] {
  font-size: var(--et-text-h2); line-height: 1.15; font-weight: var(--et-weight-display); font-variant-numeric: tabular-nums;
  letter-spacing: 0; color: var(--et-fg);
}
[data-t7-stat-label] { font-size: var(--et-text-micro); line-height: 16px; color: var(--et-muted); }

/* —— section 节奏 —— */
[data-t7-section] { margin: 0 0 48px; display: flex; flex-direction: column; gap: 12px; }
[data-t7-section-title] {
  margin: 0; font-size: var(--et-text-h3); line-height: var(--et-leading-snug); font-weight: var(--et-weight-display);
  letter-spacing: 0; color: var(--et-fg);
}
[data-t7-section-note] { margin: -6px 0 0; font-size: var(--et-text-caption); line-height: var(--et-leading-body); color: var(--et-muted); }
[data-t7-placeholder] { font-size: var(--et-text-caption); color: var(--et-muted); }
[data-t7-error] { font-size: var(--et-text-caption); color: var(--et-danger); overflow-wrap: anywhere; }

/* —— 组合只读区 —— */
[data-t7-composed] {
  border-radius: var(--et-radius-md); padding: 16px 20px;
  background: var(--et-surface);
  border: 1px solid var(--et-border);
}
[data-t7-composed-note] { margin: 0 0 12px; font-size: var(--et-text-micro); line-height: 18px; color: var(--et-muted); }
[data-t7-composed-text] {
  margin: 0; padding: 12px; max-height: 320px; overflow-y: auto;
  font-family: var(--et-font-mono);
  font-size: var(--et-text-micro); line-height: 19px; white-space: pre-wrap;
  color: var(--et-fg-2);
  background: var(--et-surface-2);
  border: 1px solid var(--et-border-soft); border-radius: var(--et-radius-md);
}
[data-t7-composed-error] { margin: 0; font-size: var(--et-text-caption); color: var(--et-danger); }
[data-t7-composed-meta] { margin: 10px 0 0; font-size: var(--et-text-micro); color: var(--et-muted); }
[data-t7-persona-path] { overflow-wrap: anywhere; }

/* —— 编辑器 —— */
[data-t7-editor] {
  width: 100%; resize: vertical; padding: 12px;
  font-family: var(--et-font-mono);
  font-size: var(--et-text-micro); line-height: 19px; color: var(--et-fg);
  background: var(--et-surface);
  border: 1px solid var(--et-border); border-radius: var(--et-radius-md);
}
[data-t7-editor]:focus-visible { outline: 2px solid var(--et-accent); outline-offset: 1px; }
[data-t7-editor]:disabled { opacity: 0.6; }
[data-t7-editor-meta] { display: flex; gap: 16px; align-items: baseline; font-size: var(--et-text-micro); color: var(--et-muted); }
[data-t7-editor-bytes] { font-variant-numeric: tabular-nums; }
[data-t7-editor-dirty][data-t7-editor-dirty-flag='true'] { color: var(--et-warn); font-weight: 600; }
[data-t7-save-summary] {
  padding: 8px 12px; font: inherit; font-size: var(--et-text-caption); color: var(--et-fg);
  background: var(--et-surface);
  border: 1px solid var(--et-border); border-radius: var(--et-radius-sm);
}
[data-t7-save-summary]:focus-visible { outline: 2px solid var(--et-accent); outline-offset: 1px; }
[data-t7-editor-actions] { display: flex; gap: 10px; }
[data-t7-save-btn] {
  padding: 10px 16px; min-height: 36px; font: inherit; font-size: var(--et-text-caption); font-weight: var(--et-weight-display); cursor: pointer;
  color: var(--et-accent-on);
  background: var(--et-accent-fill); border: 0; border-radius: var(--et-radius-sm);
}
[data-t7-save-btn]:hover:not(:disabled) { background: var(--et-accent-fill-hover); }
[data-t7-save-btn]:disabled { opacity: 0.45; cursor: default; }

/* —— 写结果(就地展示) —— */
[data-t7-write-outcome] {
  display: flex; flex-direction: column; gap: 6px;
  padding: 12px 16px; border-radius: var(--et-radius-md); font-size: var(--et-text-caption);
  background: var(--et-surface);
  border: 1px solid var(--et-border);
}
[data-t7-write-outcome][data-t7-write-status='committed'] { border-color: var(--et-success); }
[data-t7-write-outcome][data-t7-write-status='rejected'],
[data-t7-write-outcome][data-t7-write-status='error'],
[data-t7-write-outcome][data-t7-write-status='approval-mismatch'] { border-color: var(--et-danger); }
[data-t7-write-status-label] { font-weight: 600; color: var(--et-fg-2); }
[data-t7-write-message] { color: var(--et-danger); overflow-wrap: anywhere; }
[data-t7-save-error] { margin: 0; padding-left: 18px; color: var(--et-danger); }
[data-t7-issue] { overflow-wrap: anywhere; }
[data-t7-write-version] { font-variant-numeric: tabular-nums; color: var(--et-fg-2); }
[data-t7-effective-note] { margin: 0; font-size: var(--et-text-micro); line-height: 18px; color: var(--et-accent); }

/* —— R3 审批卡 —— */
[data-t7-approval] {
  margin: 0 0 48px; padding: 16px 20px; display: flex; flex-direction: column; gap: 12px;
  border-radius: var(--et-radius-md); border: 1px solid var(--et-warn);
  background: color-mix(in srgb, var(--et-warn) 6%, transparent);
}
[data-t7-approval-card] { display: flex; flex-direction: column; gap: 6px; }
[data-t7-approval-row] { display: grid; grid-template-columns: 72px minmax(0, 1fr); gap: 10px; font-size: var(--et-text-caption); }
[data-t7-approval-key] { color: var(--et-muted); }
[data-t7-approval-value] { color: var(--et-fg); overflow-wrap: anywhere; }
[data-t7-approval-grade] {
  font-weight: var(--et-weight-display); font-size: var(--et-text-micro); padding: 1px 8px; border-radius: var(--et-radius-sm);
  color: var(--et-danger);
  background: color-mix(in srgb, var(--et-danger) 12%, transparent);
}
[data-t7-approval-rule] { font-size: var(--et-text-micro); color: var(--et-muted); overflow-wrap: anywhere; }
[data-t7-approval-detail-box] > summary { cursor: pointer; font-size: var(--et-text-micro); color: var(--et-muted); }
[data-t7-approval-detail] {
  margin: 8px 0 0; padding: 12px; max-height: 260px; overflow-y: auto;
  font-family: var(--et-font-mono);
  font-size: var(--et-text-micro); line-height: 18px; white-space: pre-wrap;
  color: var(--et-fg-2);
  background: var(--et-surface-2);
  border: 1px solid var(--et-border-soft); border-radius: var(--et-radius-md);
}
[data-t7-approval-questions] { margin: 0; padding-left: 20px; display: flex; flex-direction: column; gap: 10px; }
[data-t7-approval-qheader] {
  display: inline-block; font-size: var(--et-text-micro); font-weight: 600; padding: 1px 10px; border-radius: var(--et-radius-sm);
  color: var(--et-danger);
  background: color-mix(in srgb, var(--et-danger) 10%, transparent);
}
[data-t7-approval-qtext] { margin: 4px 0 0; font-size: var(--et-text-caption); color: var(--et-fg); }
[data-t7-approval-options] { margin: 4px 0 0; padding-left: 18px; font-size: var(--et-text-micro); color: var(--et-muted); }
[data-t7-approval-actions] { display: flex; gap: 10px; }
[data-t7-approve-btn] {
  padding: 10px 16px; min-height: 36px; font: inherit; font-size: var(--et-text-caption); font-weight: var(--et-weight-display); cursor: pointer;
  color: var(--et-accent-on);
  background: var(--et-accent-fill); border: 0; border-radius: var(--et-radius-sm);
}
[data-t7-approve-btn]:hover:not(:disabled) { background: var(--et-accent-fill-hover); }
[data-t7-approve-btn]:disabled, [data-t7-reject-btn]:disabled { opacity: 0.45; cursor: default; }
[data-t7-reject-btn] {
  padding: 10px 16px; min-height: 36px; font: inherit; font-size: var(--et-text-caption); cursor: pointer;
  color: var(--et-fg-2); background: transparent;
  border: 1px solid var(--et-border); border-radius: var(--et-radius-sm);
}
[data-t7-reject-btn]:hover:not(:disabled) { background: var(--et-surface-2); }

/* —— 版本列表 —— */
[data-t7-version-list] {
  border-radius: var(--et-radius-md); padding: 4px 20px;
  background: var(--et-surface);
  border: 1px solid var(--et-border-soft);
}
[data-t7-version-item] { padding: 14px 0; border-bottom: 1px solid var(--et-border-soft); }
[data-t7-version-item]:last-child { border-bottom: 0; padding-bottom: 4px; }
[data-t7-version-head] { display: flex; align-items: baseline; gap: 10px; flex-wrap: wrap; }
[data-t7-version-seq] { font-size: var(--et-text-caption); font-weight: var(--et-weight-display); font-variant-numeric: tabular-nums; color: var(--et-fg); }
[data-t7-version-id] { font-size: var(--et-text-micro); color: var(--et-muted); overflow-wrap: anywhere; }
[data-t7-version-source-badge] {
  font-size: var(--et-text-micro); font-weight: 600; padding: 1px 10px; border-radius: var(--et-radius-sm);
  color: var(--et-fg-2); background: var(--et-surface-2);
}
[data-t7-version-item][data-t7-version-source='initial'] [data-t7-version-source-badge] { color: var(--et-accent); }
[data-t7-version-item][data-t7-version-source='rollback'] [data-t7-version-source-badge] { color: var(--et-warn); }
[data-t7-version-meta] { margin-left: auto; font-size: var(--et-text-micro); color: var(--et-muted); font-variant-numeric: tabular-nums; }
[data-t7-version-summary] { margin: 6px 0 0; font-size: var(--et-text-micro); color: var(--et-fg-2); }
[data-t7-version-actions] { display: flex; gap: 8px; margin-top: 8px; flex-wrap: wrap; }
[data-t7-version-toggle], [data-t7-load-btn], [data-t7-diff-btn], [data-t7-export-btn], [data-t7-rollback-btn] {
  padding: 3px 12px; font: inherit; font-size: var(--et-text-micro); cursor: pointer;
  color: var(--et-accent); background: transparent;
  border: 1px solid var(--et-border); border-radius: var(--et-radius-sm);
}
[data-t7-version-toggle]:hover, [data-t7-load-btn]:hover, [data-t7-diff-btn]:hover:not(:disabled),
[data-t7-export-btn]:hover:not(:disabled) { background: var(--et-surface-2); }
[data-t7-diff-btn]:disabled, [data-t7-export-btn]:disabled { opacity: 0.45; cursor: default; }
[data-t7-rollback-btn]:hover:not(:disabled) {
  color: var(--et-warn);
  background: color-mix(in srgb, var(--et-warn) 10%, transparent);
}
[data-t7-rollback-btn]:disabled { opacity: 0.45; cursor: default; }
[data-t7-version-content] {
  margin: 10px 0 0; padding: 12px; max-height: 260px; overflow-y: auto;
  font-family: var(--et-font-mono);
  font-size: var(--et-text-micro); line-height: 18px; white-space: pre-wrap;
  color: var(--et-fg-2);
  background: var(--et-surface-2);
  border: 1px solid var(--et-border-soft); border-radius: var(--et-radius-md);
}

/* —— 版本对比视图(T7.3 ②) —— */
[data-t7-diff] {
  margin-top: 16px; padding: 14px 18px; display: flex; flex-direction: column; gap: 8px;
  border-radius: var(--et-radius-md);
  background: var(--et-surface);
  border: 1px solid var(--et-border);
}
[data-t7-diff-head] { display: flex; align-items: baseline; gap: 14px; flex-wrap: wrap; }
[data-t7-diff-title] { font-size: var(--et-text-caption); font-weight: var(--et-weight-display); font-variant-numeric: tabular-nums; color: var(--et-fg); }
[data-t7-diff-stats] { font-size: var(--et-text-micro); font-variant-numeric: tabular-nums; color: var(--et-fg-2); }
[data-t7-diff-close] {
  margin-left: auto; padding: 3px 12px; font: inherit; font-size: var(--et-text-micro); cursor: pointer;
  color: var(--et-fg-2); background: transparent;
  border: 1px solid var(--et-border); border-radius: var(--et-radius-sm);
}
[data-t7-diff-close]:hover { background: var(--et-surface-2); color: var(--et-fg); }
[data-t7-diff-note] { margin: 0; font-size: var(--et-text-micro); color: var(--et-muted); }
[data-t7-diff-identical] { margin: 0; font-size: var(--et-text-micro); color: var(--et-muted); }
[data-t7-diff-body] {
  padding: 10px 12px; max-height: 320px; overflow-y: auto;
  font-family: var(--et-font-mono);
  font-size: var(--et-text-micro); line-height: 18px;
  background: var(--et-surface-2);
  border: 1px solid var(--et-border-soft); border-radius: var(--et-radius-md);
}
[data-t7-diff-op] { display: flex; gap: 8px; white-space: pre-wrap; overflow-wrap: anywhere; }
[data-t7-diff-sign] { flex: none; width: 12px; text-align: center; font-weight: var(--et-weight-display); }
[data-t7-diff-op='same'] { color: var(--et-muted); }
[data-t7-diff-op='add'] {
  color: var(--et-success);
  background: color-mix(in srgb, var(--et-success) 8%, transparent);
}
[data-t7-diff-op='del'] {
  color: var(--et-danger);
  background: color-mix(in srgb, var(--et-danger) 8%, transparent);
}
[data-t7-diff-truncated] { margin: 6px 0 0; font-size: var(--et-text-micro); color: var(--et-muted); }

/* —— 导出 / 导入(T7.3 ④⑤) —— */
[data-t7-export-row], [data-t7-import-row] {
  display: flex; align-items: center; gap: 12px; flex-wrap: wrap;
  padding: 10px 0; font-size: var(--et-text-micro);
  border-bottom: 1px solid var(--et-border-soft);
}
[data-t7-export-latest], [data-t7-import-btn] {
  padding: 5px 14px; font: inherit; font-size: var(--et-text-micro); cursor: pointer;
  color: var(--et-accent); background: transparent;
  border: 1px solid var(--et-border); border-radius: var(--et-radius-sm);
}
[data-t7-export-latest]:hover:not(:disabled), [data-t7-import-btn]:hover:not(:disabled) {
  background: var(--et-surface-2);
}
[data-t7-export-latest]:disabled, [data-t7-import-btn]:disabled { opacity: 0.45; cursor: default; }
[data-t7-export-status], [data-t7-import-meta] {
  font-size: var(--et-text-micro); font-variant-numeric: tabular-nums;
  color: var(--et-muted); overflow-wrap: anywhere;
}
[data-t7-import-input] { font: inherit; font-size: var(--et-text-micro); color: var(--et-fg-2); max-width: 100%; }

/* —— T1.5 全景分组导航(preset/领域/运行时;access 插件页分组行卡同构形态) —— */
[data-ps-group-nav] { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 20px; align-items: start; margin: 0 0 48px; }
[data-ps-layer-group] {
  border-radius: var(--et-radius-md); padding: 4px 20px 8px;
  background: var(--et-surface);
  border: 1px solid var(--et-border);
}
[data-ps-layer-group-head] { display: flex; align-items: baseline; gap: 12px; padding: 12px 0 2px; }
[data-ps-layer-group-title] {
  margin: 0; font-size: var(--et-text-caption); line-height: 20px; font-weight: 600;
  color: var(--et-fg-2);
}
[data-ps-layer-group-hint] { margin-left: auto; font-size: var(--et-text-micro); color: var(--et-muted); }
[data-ps-entry-list] { margin: 0; padding: 0; list-style: none; }
[data-ps-entry-row] {
  width: 100%; display: flex; flex-direction: column; gap: 5px; text-align: left;
  padding: 9px 10px; margin: 0 -10px; font: inherit; cursor: pointer; background: none;
  border: 0; border-bottom: 1px solid var(--et-border-soft); border-radius: var(--et-radius-md);
}
[data-ps-entry-list] > li:last-child [data-ps-entry-row] { border-bottom: 0; }
[data-ps-entry-row][data-ps-selected='true'] { background: var(--et-surface-2); }
[data-ps-entry-row]:hover [data-ps-entry-row-id],
[data-ps-entry-row][data-ps-selected='true'] [data-ps-entry-row-id] {
  color: var(--et-accent);
}
[data-ps-entry-row-id] {
  font-size: var(--et-text-caption); font-weight: 600; color: var(--et-fg); overflow-wrap: anywhere;
}
[data-ps-entry-row-pills] { display: inline-flex; gap: 6px; flex-wrap: wrap; }
[data-ps-entry-row-sub] { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; min-width: 0; }
[data-ps-entry-row-meta] {
  font-size: var(--et-text-micro); color: var(--et-muted); font-variant-numeric: tabular-nums;
  overflow-wrap: anywhere;
}
[data-ps-editor-reset][data-ps-reset-armed='true'] {
  color: var(--et-danger);
  border-color: color-mix(in srgb, var(--et-danger) 45%, transparent);
  background: color-mix(in srgb, var(--et-danger) 8%, transparent);
}
[data-ps-pill] {
  display: inline-flex; align-items: center; padding: 1px 10px; border-radius: var(--et-radius-sm);
  font-size: var(--et-text-micro); line-height: 17px; font-weight: 500; white-space: nowrap;
}
[data-ps-pill][data-ps-tone='neutral'] {
  color: var(--et-fg-2); background: var(--et-surface-2);
}
[data-ps-pill][data-ps-tone='business'] {
  color: var(--et-accent);
  background: color-mix(in srgb, var(--et-accent) 8%, transparent);
}
[data-ps-pill][data-ps-tone='warn'] {
  color: var(--et-warn);
  background: color-mix(in srgb, var(--et-warn) 10%, transparent);
}

/* —— T1.5 条目详情(元数据卡 + 风险标注警示区 + 分型值区;2026-11-13 起住进编辑 tab,不吃页级节奏) —— */
[data-ps-entry-detail] { margin: 0; display: flex; flex-direction: column; gap: 12px; }
[data-ps-entry-title] { overflow-wrap: anywhere; }
[data-ps-entry-badges] { display: inline-flex; gap: 6px; flex-wrap: wrap; margin-top: -6px; }
[data-ps-entry-note] { margin: 0; font-size: var(--et-text-caption); line-height: 20px; color: var(--et-fg-2); }
/* 2026-11-12 作用说明区(registry description,用户要求每个提示词有中文说明)。 */
[data-ps-entry-description] {
  display: flex; flex-direction: column; gap: 6px; padding: 12px 16px; border-radius: var(--et-radius-md);
  border: 1px solid var(--et-border);
  background: var(--et-surface-2);
}
[data-ps-entry-description-title] { font-size: var(--et-text-micro); font-weight: 600; color: var(--et-fg); }
[data-ps-entry-description-text] { margin: 0; font-size: var(--et-text-caption); line-height: 20px; color: var(--et-fg-2); overflow-wrap: anywhere; }
/* 2026-11-12 红线锚点预检查(编辑器内;missing=警示态,ok=业务态胶囊)。 */
[data-ps-redline] {
  display: flex; align-items: center; gap: 10px; flex-wrap: wrap;
  padding: 10px 16px; border-radius: var(--et-radius-md); margin-top: 8px;
  border: 1px solid var(--et-border);
}
[data-ps-redline][data-ps-redline-state='missing'] {
  border-color: var(--et-warn);
  background: color-mix(in srgb, var(--et-warn) 8%, transparent);
}
[data-ps-redline][data-ps-redline-state='ok'] {
  background: color-mix(in srgb, var(--et-accent) 5%, transparent);
}
[data-ps-redline-title] { font-size: var(--et-text-caption); font-weight: 600; color: var(--et-warn); }
[data-ps-redline-list] { margin: 0; padding: 0; display: flex; gap: 6px; flex-wrap: wrap; list-style: none; }
[data-ps-redline-missing-item] {
  font-size: var(--et-text-micro); color: var(--et-warn);
  border: 1px solid color-mix(in srgb, var(--et-warn) 45%, transparent);
  border-radius: var(--et-radius-sm); padding: 1px 8px;
}
[data-ps-redline-insert] {
  align-self: center; padding: 4px 12px; border-radius: var(--et-radius-sm);
  border: 1px solid var(--et-border); background: var(--et-surface);
  color: var(--et-fg); font-size: var(--et-text-caption); cursor: pointer;
}
/* T2.2 生效条件区(radius 胶囊 + 实测注记;matrix=docs/dev/ps-v2-hot-effect-matrix.md)。 */
[data-ps-entry-effect] {
  display: flex; flex-direction: column; gap: 6px; padding: 12px 16px; border-radius: var(--et-radius-md);
  border: 1px solid var(--et-border);
  background: color-mix(in srgb, var(--et-accent) 5%, transparent);
}
[data-ps-entry-effect-title] { font-size: var(--et-text-micro); font-weight: 600; color: var(--et-fg); }
[data-ps-entry-effect] [data-ps-pill] { align-self: flex-start; }
[data-ps-entry-effect-note] { margin: 0; font-size: var(--et-text-micro); line-height: 18px; color: var(--et-fg-2); overflow-wrap: anywhere; }
[data-ps-entry-risks] {
  display: flex; flex-direction: column; gap: 6px; padding: 12px 16px; border-radius: var(--et-radius-md);
  border: 1px solid var(--et-warn);
  background: color-mix(in srgb, var(--et-warn) 6%, transparent);
}
[data-ps-entry-risks-title] { font-size: var(--et-text-micro); font-weight: 600; color: var(--et-warn); }
[data-ps-entry-risks] ul { margin: 0; padding-left: 18px; display: flex; flex-direction: column; gap: 4px; }
[data-ps-risk-item] { font-size: var(--et-text-micro); line-height: 18px; color: var(--et-fg-2); overflow-wrap: anywhere; }
[data-ps-entry-meta] {
  display: flex; gap: 16px; flex-wrap: wrap; font-size: var(--et-text-micro);
  color: var(--et-muted);
}
[data-ps-entry-runtime] {
  display: flex; flex-direction: column; gap: 8px; padding: 16px 20px; border-radius: var(--et-radius-md);
  background: var(--et-surface);
  border: 1px solid var(--et-border);
}
[data-ps-entry-runtime-note] {
  margin: 0; font-size: var(--et-text-caption); line-height: 20px; color: var(--et-fg-2);
}
[data-ps-entry-value-note] { margin: 0; font-size: var(--et-text-micro); line-height: 18px; color: var(--et-muted); }
/* 读值失败警示区(patch 值型 value.text=null:不冒充空内容,problems 就地明示)。 */
[data-ps-entry-value-error] {
  display: flex; flex-direction: column; gap: 6px; padding: 14px 18px; border-radius: var(--et-radius-md);
  border: 1px solid var(--et-danger);
  background: color-mix(in srgb, var(--et-danger) 6%, transparent);
}
[data-ps-entry-value-error-note] { margin: 0; font-size: var(--et-text-micro); line-height: 18px; color: var(--et-fg-2); }
[data-ps-entry-problem-item] {
  margin: 0; font-size: var(--et-text-micro); line-height: 18px;
  color: var(--et-danger); overflow-wrap: anywhere;
}
/* 版本链拉取失败(RPC 通道错/超时):与「storage 未挂载」分态展示,不冒充缺席。 */
[data-ps-chain-error] {
  margin: 0; font-size: var(--et-text-caption); line-height: 20px;
  color: var(--et-danger); overflow-wrap: anywhere;
}
/* 详情内子区(editor/versions/只读说明)不吃顶层 section 的 48px 节奏,标题降一级(32/21/15 字号阶梯)。 */
[data-ps-entry-detail] [data-t7-section] { margin: 0; }
[data-ps-entry-detail] h3[data-t7-section-title] { font-size: var(--et-text-body); line-height: 22px; }

/* —— T2.3 会话快照查看(只读:会话行卡列表 + 冻结详情;2026-11-13 起住进快照 tab) —— */
[data-ps-session-snapshot] { display: flex; flex-direction: column; gap: 12px; margin: 0; }
[data-ps-snapshot-select-hint] { margin: 0; font-size: var(--et-text-micro); color: var(--et-muted); }
[data-ps-snapshot-session-list] { margin: 0; padding: 0; list-style: none; display: flex; flex-direction: column; }
[data-ps-snapshot-session-row] {
  width: 100%; display: flex; flex-direction: column; gap: 4px; text-align: left;
  padding: 10px 12px; margin: 0 -12px; font: inherit; cursor: pointer; background: none;
  border: 0; border-bottom: 1px solid var(--et-border-soft); border-radius: var(--et-radius-md);
}
[data-ps-snapshot-session-list] > li:last-child [data-ps-snapshot-session-row] { border-bottom: 0; }
[data-ps-snapshot-session-row][data-ps-selected='true'] { background: var(--et-surface-2); }
[data-ps-snapshot-row-id] { font-size: var(--et-text-caption); font-weight: 600; color: var(--et-fg); overflow-wrap: anywhere; }
[data-ps-snapshot-row-meta] {
  font-size: var(--et-text-micro); color: var(--et-muted);
  font-variant-numeric: tabular-nums; overflow-wrap: anywhere;
}
[data-ps-snapshot-detail] {
  display: flex; flex-direction: column; gap: 10px; padding: 16px 20px; border-radius: var(--et-radius-md);
  background: var(--et-surface);
  border: 1px solid var(--et-border);
}
[data-ps-snapshot-detail] h3[data-t7-section-title] { margin: 0; font-size: var(--et-text-body); line-height: 22px; }
[data-ps-snapshot-note] { margin: 0; font-size: var(--et-text-micro); line-height: 18px; color: var(--et-fg-2); }
[data-ps-snapshot-meta] {
  display: flex; gap: 16px; flex-wrap: wrap; font-size: var(--et-text-micro);
  color: var(--et-muted); font-variant-numeric: tabular-nums;
}
[data-ps-snapshot-checksum] { overflow-wrap: anywhere; }
[data-ps-snapshot-entry-list] { margin: 0; padding: 0; list-style: none; display: flex; flex-direction: column; }
[data-ps-snapshot-entry] {
  display: flex; flex-direction: column; gap: 6px; padding: 10px 0;
  border-bottom: 1px solid var(--et-border-soft);
}
[data-ps-snapshot-entry-list] > li:last-child { border-bottom: 0; }
[data-ps-snapshot-entry-head] { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
[data-ps-snapshot-entry-id] { font-size: var(--et-text-caption); font-weight: 600; color: var(--et-fg); overflow-wrap: anywhere; }
[data-ps-snapshot-pointer] {
  font-size: var(--et-text-micro); color: var(--et-fg-2);
  font-variant-numeric: tabular-nums; overflow-wrap: anywhere;
}
[data-ps-snapshot-entry-note] { margin: 0; font-size: var(--et-text-micro); line-height: 18px; color: var(--et-fg-2); }
[data-ps-snapshot-entry-problem] { font-size: var(--et-text-micro); line-height: 18px; color: var(--et-danger); }
[data-ps-snapshot-entry] details { font-size: var(--et-text-micro); color: var(--et-fg-2); }
[data-ps-snapshot-entry] summary { cursor: pointer; }
[data-ps-snapshot-entry-text] {
  margin: 8px 0 0; padding: 12px 14px; overflow: auto; white-space: pre-wrap; overflow-wrap: anywhere;
  font-size: var(--et-text-micro); line-height: 18px; border-radius: var(--et-radius-md);
  background: var(--et-surface-2);
  border: 1px solid var(--et-border-soft);
}
[data-ps-snapshot-error] {
  margin: 0; font-size: var(--et-text-caption); line-height: 20px;
  color: var(--et-danger); overflow-wrap: anywhere;
}
/* 快照主从视图:返回列表按钮(详情顶格,列表隐藏) */
[data-ps-snapshot-back] {
  align-self: flex-start;
  padding: 5px 14px; font: inherit; font-size: var(--et-text-micro); cursor: pointer;
  color: var(--et-fg-2); background: transparent;
  border: 1px solid var(--et-border); border-radius: var(--et-radius-sm);
}
[data-ps-snapshot-back]:hover { background: var(--et-surface-2); color: var(--et-fg); }
/* 导入区并入版本 tab:与导出行之间以虚线分隔 */
[data-ps-transfer-inline] { margin: 4px 0 0; padding: 10px 0 0; border-top: 1px dashed var(--et-border-soft); }

/* —— AI 润色区(T3.2:建议稿卡/diff 预览/提案提交;对照快照详情卡与版本对比形态) —— */
[data-ps-ai-status] { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
[data-ps-ai-status-label] { font-size: var(--et-text-micro); color: var(--et-muted); }
[data-ps-ai-status-value] { font-size: var(--et-text-micro); color: var(--et-fg-2); }
[data-ps-ai-unavailable-note] {
  margin: 0; font-size: var(--et-text-micro); line-height: 18px;
  color: var(--et-fg-2); overflow-wrap: anywhere;
}
[data-ps-ai-input-row] { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
[data-ps-ai-instruction] {
  flex: 1 1 240px; padding: 8px 12px; font: inherit; font-size: var(--et-text-caption);
  color: var(--et-fg);
  background: var(--et-surface);
  border: 1px solid var(--et-border); border-radius: var(--et-radius-sm);
}
[data-ps-ai-instruction]:focus-visible { outline: 2px solid var(--et-accent); outline-offset: 1px; }
[data-ps-ai-instruction]:disabled { opacity: 0.6; }
[data-ps-ai-polish-btn] {
  padding: 10px 16px; min-height: 36px; font: inherit; font-size: var(--et-text-caption); font-weight: 600; cursor: pointer;
  color: var(--et-fg);
  background: transparent; border: 1px solid var(--et-border); border-radius: var(--et-radius-sm);
}
[data-ps-ai-polish-btn]:hover:not(:disabled) { background: var(--et-surface-2); }
[data-ps-ai-polish-btn]:disabled { opacity: 0.45; cursor: default; }
[data-ps-ai-error] {
  margin: 0; font-size: var(--et-text-caption); line-height: 20px;
  color: var(--et-danger); overflow-wrap: anywhere;
}
[data-ps-ai-draft-card] {
  display: flex; flex-direction: column; gap: 12px; padding: 16px 20px; border-radius: var(--et-radius-md);
  background: var(--et-surface);
  border: 1px solid var(--et-border);
}
[data-ps-ai-draft-head] { display: flex; align-items: baseline; gap: 14px; flex-wrap: wrap; }
[data-ps-ai-draft-title] { font-size: var(--et-text-caption); font-weight: var(--et-weight-display); color: var(--et-fg); }
[data-ps-ai-draft-meta] {
  font-size: var(--et-text-micro); color: var(--et-muted);
  font-variant-numeric: tabular-nums; overflow-wrap: anywhere;
}
[data-ps-ai-draft-card] details { font-size: var(--et-text-micro); color: var(--et-fg-2); }
[data-ps-ai-draft-card] summary { cursor: pointer; }
[data-ps-ai-draft] {
  margin: 8px 0 0; padding: 12px 14px; max-height: 260px; overflow-y: auto;
  font-family: var(--et-font-mono);
  font-size: var(--et-text-micro); line-height: 18px; white-space: pre-wrap; overflow-wrap: anywhere;
  color: var(--et-fg-2);
  background: var(--et-surface-2);
  border: 1px solid var(--et-border-soft); border-radius: var(--et-radius-md);
}
[data-ps-ai-diff] {
  padding: 14px 18px; display: flex; flex-direction: column; gap: 8px; border-radius: var(--et-radius-md);
  background: var(--et-surface);
  border: 1px solid var(--et-border);
}
[data-ps-ai-draft-actions] { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
[data-ps-ai-propose-btn] {
  padding: 10px 16px; min-height: 36px; font: inherit; font-size: var(--et-text-caption); font-weight: 600; cursor: pointer;
  color: var(--et-accent-on);
  background: var(--et-accent-fill); border: 0; border-radius: var(--et-radius-sm);
}
[data-ps-ai-propose-btn]:hover:not(:disabled) { background: var(--et-accent-fill-hover); }
[data-ps-ai-propose-btn]:disabled { opacity: 0.45; cursor: default; }
[data-ps-ai-discard-btn] {
  padding: 10px 16px; min-height: 36px; font: inherit; font-size: var(--et-text-caption); cursor: pointer;
  color: var(--et-fg-2); background: transparent;
  border: 1px solid var(--et-border); border-radius: var(--et-radius-sm);
}
[data-ps-ai-discard-btn]:hover:not(:disabled) { background: var(--et-surface-2); color: var(--et-fg); }
[data-ps-ai-discard-btn]:disabled { opacity: 0.45; cursor: default; }

/* —— AI 审核报告卡(T3.3:问题清单+建议列表;仅展示不拦截,对照润色建议稿卡形态) —— */
[data-ps-ai-review-input-row] { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
[data-ps-ai-review-btn] {
  padding: 10px 16px; min-height: 36px; font: inherit; font-size: var(--et-text-caption); font-weight: 600; cursor: pointer;
  color: var(--et-fg);
  background: transparent; border: 1px solid var(--et-border); border-radius: var(--et-radius-sm);
}
[data-ps-ai-review-btn]:hover:not(:disabled) { background: var(--et-surface-2); }
[data-ps-ai-review-btn]:disabled { opacity: 0.45; cursor: default; }
[data-ps-ai-review-error] {
  margin: 0; font-size: var(--et-text-caption); line-height: 20px;
  color: var(--et-danger); overflow-wrap: anywhere;
}
[data-ps-ai-review-card] {
  display: flex; flex-direction: column; gap: 12px; padding: 16px 20px; border-radius: var(--et-radius-md);
  background: var(--et-surface);
  border: 1px solid var(--et-border);
}
[data-ps-ai-review-head] { display: flex; align-items: baseline; gap: 14px; flex-wrap: wrap; }
[data-ps-ai-review-title] { font-size: var(--et-text-caption); font-weight: var(--et-weight-display); color: var(--et-fg); }
[data-ps-ai-review-meta] {
  font-size: var(--et-text-micro); color: var(--et-muted);
  font-variant-numeric: tabular-nums; overflow-wrap: anywhere;
}
[data-ps-ai-review-close-btn] {
  margin-left: auto; padding: 4px 14px; font: inherit; font-size: var(--et-text-micro); cursor: pointer;
  color: var(--et-fg-2); background: transparent;
  border: 1px solid var(--et-border); border-radius: var(--et-radius-sm);
}
[data-ps-ai-review-close-btn]:hover:not(:disabled) { background: var(--et-surface-2); color: var(--et-fg); }
[data-ps-ai-review-close-btn]:disabled { opacity: 0.45; cursor: default; }
[data-ps-ai-review-summary] {
  font-size: var(--et-text-micro); color: var(--et-fg-2);
  font-variant-numeric: tabular-nums; overflow-wrap: anywhere;
}
[data-ps-ai-review-issues] { margin: 0; padding-left: 18px; display: flex; flex-direction: column; gap: 4px; }
[data-ps-ai-review-issue] { font-size: var(--et-text-micro); line-height: 18px; color: var(--et-fg-2); overflow-wrap: anywhere; }
/* 受审稿过期标识(T3.3 评审 low):结论对应审核时刻的稿,不冒充当前草稿结论。 */
[data-ps-ai-review-stale] {
  margin: 0; padding: 8px 14px; border-radius: var(--et-radius-md); font-size: var(--et-text-micro); line-height: 18px;
  color: var(--et-warn);
  background: color-mix(in srgb, var(--et-warn) 8%, transparent);
}
[data-ps-ai-review-rule-block], [data-ps-ai-review-ai-block] { display: flex; flex-direction: column; gap: 6px; }
[data-ps-ai-review-block-title] { font-size: var(--et-text-micro); font-weight: 600; color: var(--et-fg-2); }
[data-ps-ai-review-rule-block] ul, [data-ps-ai-review-ai-block] ul {
  margin: 0; padding-left: 18px; display: flex; flex-direction: column; gap: 8px;
}
[data-ps-ai-review-rulefinding] { font-size: var(--et-text-micro); line-height: 18px; color: var(--et-fg-2); overflow-wrap: anywhere; }
[data-ps-ai-review-finding] { display: flex; flex-direction: column; gap: 4px; }
[data-ps-ai-review-severity] {
  display: inline-flex; align-self: flex-start; padding: 1px 10px; border-radius: var(--et-radius-sm);
  font-size: var(--et-text-micro); line-height: 17px; font-weight: 500; white-space: nowrap;
}
[data-ps-ai-review-severity='error'] {
  color: var(--et-danger);
  background: color-mix(in srgb, var(--et-danger) 10%, transparent);
}
[data-ps-ai-review-severity='warning'] {
  color: var(--et-warn);
  background: color-mix(in srgb, var(--et-warn) 10%, transparent);
}
[data-ps-ai-review-severity='info'] {
  color: var(--et-fg-2); background: var(--et-surface-2);
}
[data-ps-ai-review-rule] {
  font-size: var(--et-text-micro); color: var(--et-muted);
  font-family: var(--et-font-mono); overflow-wrap: anywhere;
}
[data-ps-ai-review-message] { margin: 0; font-size: var(--et-text-caption); line-height: 20px; color: var(--et-fg); overflow-wrap: anywhere; }
[data-ps-ai-review-suggestion] { margin: 0; font-size: var(--et-text-micro); line-height: 18px; color: var(--et-fg-2); overflow-wrap: anywhere; }
[data-ps-ai-review-empty] { margin: 0; font-size: var(--et-text-micro); color: var(--et-muted); }
[data-ps-ai-review-note] { margin: 0; font-size: var(--et-text-micro); line-height: 17px; color: var(--et-muted); overflow-wrap: anywhere; }

/* —— 键盘可达与触控目标(AGENTS.md 前端铁律 4) —— */
[data-t7-studio-root] button,
[data-t7-trace-root] button,
[data-t7-studio-root] input,
[data-t7-studio-root] textarea,
[data-t7-studio-root] select {
  transition: background-color var(--et-motion-fast) var(--et-ease),
    border-color var(--et-motion-fast) var(--et-ease),
    color var(--et-motion-fast) var(--et-ease),
    box-shadow var(--et-motion-fast) var(--et-ease);
}
[data-t7-studio-root] button:focus-visible,
[data-t7-trace-root] button:focus-visible,
[data-t7-studio-root] input:focus-visible,
[data-t7-studio-root] textarea:focus-visible,
[data-t7-studio-root] select:focus-visible,
[data-t7-editor]:focus-visible,
[data-t7-save-summary]:focus-visible {
  outline: none; box-shadow: var(--et-focus-ring);
}
/* 紧凑胶囊按钮的视觉节奏保持不变,经 ::after 外扩命中区到 ≥36px 级(access 开关同款手法)。 */
[data-t7-version-actions] button, [data-t7-export-latest], [data-t7-import-btn],
[data-t7-diff-close], [data-t7-refresh], [data-ps-entry-row], [data-ps-snapshot-session-row],
[data-ps-ai-polish-btn], [data-ps-ai-propose-btn], [data-ps-ai-discard-btn],
[data-ps-ai-review-btn], [data-ps-ai-review-close-btn] { position: relative; }
[data-t7-version-actions] button::after, [data-t7-export-latest]::after, [data-t7-import-btn]::after,
[data-t7-diff-close]::after, [data-t7-refresh]::after, [data-ps-entry-row]::after, [data-ps-snapshot-session-row]::after,
[data-ps-ai-polish-btn]::after, [data-ps-ai-propose-btn]::after, [data-ps-ai-discard-btn]::after,
[data-ps-ai-review-btn]::after, [data-ps-ai-review-close-btn]::after {
  content: ""; position: absolute; inset: -6px;
}

/* —— 2026-11-13 原型改版:三栏工作台(库 / 编辑器 / AI 助手) —— */
.ps-page-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 24px; margin-bottom: 20px; }
.ps-page-head-text { min-width: 0; }
.ps-eyebrow {
  margin: 0 0 8px; font-size: var(--et-text-micro); font-weight: var(--et-weight-display);
  letter-spacing: 0.14em; color: var(--et-accent);
}
.ps-page-actions { flex: none; display: flex; gap: 10px; padding-top: 4px; }
.ps-page-actions [data-t7-refresh] {
  padding: 7px 16px; font-size: var(--et-text-caption);
  color: var(--et-fg-2); background: transparent;
  border: 1px solid var(--et-border); border-radius: var(--et-radius-sm);
}
.ps-page-actions [data-t7-refresh]:hover { background: var(--et-surface-2); color: var(--et-fg); }

[data-ps-workspace] {
  display: grid; grid-template-columns: 272px minmax(0, 1fr) 328px;
  gap: 12px; align-items: start;
}
.ps-panel {
  background: var(--et-surface);
  border: 1px solid var(--et-border-soft);
  border-radius: var(--et-radius-md);
  box-shadow: var(--et-shadow);
  min-width: 0;
}
.ps-panel-head { padding: 14px 16px 12px; min-width: 0; }
.ps-panel-body { padding: 12px 16px 16px; display: flex; flex-direction: column; gap: 12px; min-width: 0; }
.ps-head-row { display: flex; align-items: center; gap: 8px; margin-bottom: 10px; }
.ps-panel-title {
  margin: 0; font-size: var(--et-text-body); line-height: var(--et-leading-snug);
  font-weight: var(--et-weight-display); color: var(--et-fg); letter-spacing: 0;
}
.ps-count-pill {
  display: inline-flex; align-items: center; justify-content: center;
  min-width: 20px; height: 20px; padding: 0 7px; border-radius: var(--et-radius-pill);
  background: var(--et-surface-2); border: 1px solid var(--et-border-soft);
  font-size: var(--et-text-micro); font-weight: 600; color: var(--et-muted); font-variant-numeric: tabular-nums;
}
.ps-visually-hidden {
  position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px;
  overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; border: 0;
}

/* 左栏:搜索 + 层筛选 chips + 分组列表(内部滚动) */
.ps-list-panel { display: flex; flex-direction: column; overflow: hidden; }
[data-ps-search] {
  width: 100%; height: 34px; padding: 0 12px; font: inherit; font-size: var(--et-text-caption);
  color: var(--et-fg); background: var(--et-surface);
  border: 1px solid var(--et-border); border-radius: var(--et-radius-sm);
}
[data-ps-search]:hover { border-color: var(--et-fg-2); }
[data-ps-search]::placeholder { color: var(--et-muted); }
.ps-chips { display: flex; flex-wrap: wrap; gap: 5px; margin-top: 10px; }
.ps-chip {
  height: 26px; padding: 0 11px; border-radius: var(--et-radius-pill);
  background: transparent; border: 1px solid var(--et-border);
  color: var(--et-muted); font: inherit; font-size: var(--et-text-micro); font-weight: var(--et-weight-body);
  cursor: pointer;
}
.ps-chip:hover { border-color: var(--et-fg-2); color: var(--et-fg); }
.ps-chip[aria-pressed='true'] {
  background: var(--et-accent-soft); border-color: transparent; color: var(--et-accent-hover); font-weight: var(--et-weight-display);
}
.ps-library-list {
  padding: 4px 8px 10px;
  max-height: min(620px, 72vh);
  overflow-y: auto; overscroll-behavior: contain;
  border-top: 1px solid var(--et-border-soft);
  min-width: 0;
}
[data-ps-list-panel] [data-ps-group-nav] { grid-template-columns: 1fr; gap: 14px; margin: 0; }
.ps-empty-inline { margin: 8px 4px; font-size: var(--et-text-caption); line-height: var(--et-leading-body); color: var(--et-muted); }
/* 条目行:名称行(含未保存草稿圆点) */
[data-ps-entry-row-line] { display: flex; align-items: center; gap: 6px; min-width: 0; }
[data-ps-entry-dirty-dot] {
  display: none; flex: none; width: 6px; height: 6px; border-radius: var(--et-radius-pill);
  background: var(--et-warn);
}
[data-ps-entry-row][data-ps-entry-dirty='true'] [data-ps-entry-dirty-dot] { display: block; }

/* 中栏:编辑器(标题行 + 版本徽标 + 胶囊 + 三 tab) */
.ps-editor-panel { display: flex; flex-direction: column; }
.ps-editor-title-row { display: flex; align-items: center; gap: 8px; min-width: 0; flex-wrap: wrap; }
.ps-editor-title {
  margin: 0; font-size: var(--et-text-h3); line-height: var(--et-leading-snug); font-weight: var(--et-weight-display);
  letter-spacing: 0; color: var(--et-fg);
  min-width: 0; overflow: hidden; white-space: nowrap; text-overflow: ellipsis;
}
.ps-badge {
  display: inline-flex; align-items: center; flex: none;
  padding: 2px 7px; border-radius: var(--et-radius-sm);
  background: var(--et-accent-soft); color: var(--et-accent-hover);
  font-size: var(--et-text-micro); font-weight: var(--et-weight-display); font-variant-numeric: tabular-nums;
}
.ps-editor-pills { display: inline-flex; gap: 6px; flex-wrap: wrap; }
.ps-tabs {
  display: inline-flex; align-items: center; gap: 2px;
  margin-top: 12px; padding: 2px;
  background: var(--et-surface-2); border: 1px solid var(--et-border-soft); border-radius: var(--et-radius-sm);
  max-width: 100%; overflow-x: auto;
}
.ps-tab {
  display: inline-flex; align-items: center; gap: 5px;
  height: 27px; padding: 0 12px; border: 0; border-radius: var(--et-radius-sm);
  background: transparent; color: var(--et-muted);
  font: inherit; font-size: var(--et-text-caption); font-weight: var(--et-weight-body); white-space: nowrap;
  cursor: pointer;
}
.ps-tab:hover { color: var(--et-fg); }
.ps-tab[aria-selected='true'] { background: var(--et-surface); color: var(--et-fg); font-weight: var(--et-weight-display); border: 1px solid var(--et-border-soft); }
.ps-tab-count { font-size: var(--et-text-micro); color: var(--et-muted); font-variant-numeric: tabular-nums; }
.ps-tab[aria-selected='true'] .ps-tab-count { color: var(--et-accent); }
.ps-editor-body { padding: 14px 18px 16px; min-width: 0; display: flex; flex-direction: column; gap: 16px; }
.ps-editor-body [data-t7-section] { margin: 0; }
.ps-governance {
  border: 1px solid var(--et-border); border-radius: var(--et-radius-md);
  padding: 10px 16px; display: flex; flex-direction: column; gap: 12px;
  background: var(--et-surface-2);
}
.ps-governance > summary {
  cursor: pointer; font-size: var(--et-text-caption); font-weight: var(--et-weight-display); color: var(--et-fg-2);
}
/* 保存栏(原型 editor-foot:摘要 + 保存;随面板文档流——sticky 悬浮会遮挡
   textarea 并拦截点击,2026-11-13 实测后回退为 in-flow) */
.ps-editor-foot {
  display: flex; align-items: center; gap: 10px;
  padding: 12px 18px;
  background: var(--et-surface-2);
  border-top: 1px solid var(--et-border-soft);
  border-radius: 0 0 var(--et-radius-md) var(--et-radius-md);
}
.ps-foot-dirty {
  display: inline-flex; align-items: center; gap: 6px; flex: none;
  font-size: var(--et-text-micro); color: var(--et-warn); font-weight: var(--et-weight-display);
}
.ps-foot-dirty::before { content: ""; width: 6px; height: 6px; border-radius: var(--et-radius-pill); background: var(--et-warn); }
.ps-foot-dirty[hidden] { display: none; }
[data-ps-editor-reset] {
  padding: 10px 14px; min-height: 36px; font: inherit; font-size: var(--et-text-caption); cursor: pointer;
  color: var(--et-fg-2); background: transparent;
  border: 1px solid var(--et-border); border-radius: var(--et-radius-sm);
}
[data-ps-editor-reset]:hover:not(:disabled) { background: var(--et-surface); color: var(--et-fg); }
[data-ps-editor-reset]:disabled { opacity: 0.45; cursor: default; }
.ps-editor-foot [data-t7-save-summary] { flex: 1 1 160px; min-width: 0; }

/* 版本对比(原型 compare 形态:双下拉 + 交换/重置 + 左右版本卡 + 双栏行号 diff) */
.ps-compare { display: flex; flex-direction: column; gap: 10px; padding: 0; border: 0; background: transparent; margin: 0; }
.ps-compare-bar { display: flex; align-items: flex-end; gap: 8px; flex-wrap: wrap; }
.ps-compare-pick { display: grid; gap: 4px; flex: 1 1 150px; min-width: 0; max-width: 260px; }
.ps-compare-pick > span {
  font-size: var(--et-text-micro); font-weight: var(--et-weight-display);
  color: var(--et-muted); letter-spacing: 0.02em;
}
.ps-compare-pick select {
  height: 34px; padding: 0 10px; font: inherit; font-size: var(--et-text-micro);
  color: var(--et-fg); background: var(--et-surface);
  border: 1px solid var(--et-border); border-radius: var(--et-radius-sm);
  min-width: 0; text-overflow: ellipsis;
}
.ps-compare-swap, .ps-compare-reset {
  height: 34px; padding: 0 11px; flex: none;
  font: inherit; font-size: var(--et-text-caption); cursor: pointer;
  color: var(--et-fg-2); background: transparent;
  border: 1px solid var(--et-border); border-radius: var(--et-radius-sm);
}
.ps-compare-swap:hover, .ps-compare-reset:hover { background: var(--et-surface-2); color: var(--et-fg); }
.ps-compare-stat {
  margin-left: auto; display: inline-flex; align-items: center; gap: 8px; padding-bottom: 8px;
  font-size: var(--et-text-micro); color: var(--et-muted); white-space: nowrap;
  font-variant-numeric: tabular-nums;
}
.ps-compare-stat b { color: var(--et-fg-2); font-weight: var(--et-weight-display); }
.ps-compare-grid {
  display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
  column-gap: 1px; background: var(--et-border-soft);
  border: 1px solid var(--et-border-soft); border-radius: var(--et-radius-sm); overflow: hidden;
}
.ps-compare-grid > * { background: var(--et-surface); min-width: 0; }
.ps-compare-grid .ps-compare-side { padding: 12px; border-bottom: 0; }
.ps-compare-side { display: flex; flex-direction: column; gap: 6px; min-width: 0; }
.ps-compare-side-top { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
.ps-version-badge {
  display: inline-flex; align-items: center; height: 20px; padding: 0 7px; border-radius: var(--et-radius-sm);
  background: var(--et-accent-soft); color: var(--et-accent-hover);
  font-size: var(--et-text-micro); font-weight: var(--et-weight-display); font-variant-numeric: tabular-nums;
}
.ps-version-source-badge {
  display: inline-flex; align-items: center; padding: 1px 8px; border-radius: var(--et-radius-sm);
  background: var(--et-surface-2); color: var(--et-fg-2);
  font-size: var(--et-text-micro); font-weight: 600;
}
[data-t7-version-item][data-t7-version-source='initial'] .ps-version-source-badge { color: var(--et-accent); }
[data-t7-version-item][data-t7-version-source='rollback'] .ps-version-source-badge { color: var(--et-warn); }
.ps-tag-current {
  display: inline-flex; align-items: center; padding: 1px 6px; border-radius: var(--et-radius-sm);
  border: 1px solid color-mix(in srgb, var(--et-success) 35%, transparent);
  color: var(--et-success); font-size: var(--et-text-micro); font-weight: var(--et-weight-display);
}
.ps-compare-side-meta { margin: 0; font-size: var(--et-text-micro); color: var(--et-muted); font-variant-numeric: tabular-nums; }
.ps-compare-side-summary { margin: 0; font-size: var(--et-text-micro); line-height: 18px; color: var(--et-fg-2); overflow-wrap: anywhere; }
.ps-compare-side-actions { display: flex; gap: 6px; flex-wrap: wrap; margin-top: 2px; }
.ps-compare-side-actions button { padding: 3px 10px; font-size: var(--et-text-micro); }
.ps-compare-side-content { margin: 4px 0 0; }
.ps-compare-section {
  grid-column: 1 / -1;
  display: flex; align-items: center; justify-content: space-between; gap: 8px;
  padding: 6px 12px; background: var(--et-surface-2);
  border-top: 1px solid var(--et-border-soft);
  font-size: var(--et-text-micro); font-weight: var(--et-weight-display); color: var(--et-muted);
}
.ps-compare-section-meta { font-weight: var(--et-weight-body); color: var(--et-muted); font-variant-numeric: tabular-nums; }
.ps-compare-line {
  display: flex; align-items: flex-start; gap: 8px; padding: 1px 10px;
  font-family: var(--et-font-mono);
  font-size: var(--et-text-micro); line-height: 18px; color: var(--et-fg-2);
}
.ps-compare-ln {
  flex: none; width: 22px; text-align: right;
  color: var(--et-muted); opacity: 0.65; user-select: none; font-variant-numeric: tabular-nums;
}
.ps-compare-lc { min-width: 0; white-space: pre-wrap; overflow-wrap: anywhere; }
.ps-compare-line[data-ps-compare-kind='same'] { color: var(--et-muted); }
.ps-compare-line[data-ps-compare-column='a'][data-ps-compare-kind='mod'],
.ps-compare-line[data-ps-compare-column='a'][data-ps-compare-kind='del'] {
  background: color-mix(in srgb, var(--et-danger) 12%, transparent);
}
.ps-compare-line[data-ps-compare-column='b'][data-ps-compare-kind='mod'],
.ps-compare-line[data-ps-compare-column='b'][data-ps-compare-kind='add'] {
  background: color-mix(in srgb, var(--et-success) 15%, transparent);
}
/* 单边空列(仅删/仅增的另一侧):斜纹占位,不是内容 */
.ps-compare-line[data-ps-compare-kind='add'][data-ps-compare-column='a'],
.ps-compare-line[data-ps-compare-kind='del'][data-ps-compare-column='b'] {
  background-image: repeating-linear-gradient(135deg, transparent 0 5px, var(--et-surface-2) 5px 6px);
}
.ps-compare-truncated {
  grid-column: 1 / -1; margin: 0; padding: 8px 12px;
  font-size: var(--et-text-micro); color: var(--et-muted);
  background: var(--et-surface);
}
.ps-compare-note { margin: 0; font-size: var(--et-text-micro); color: var(--et-muted); }
/* 版本区条目信息块(所属插件/作用/生效条件;registry 单一事实源直读) */
.ps-version-entry-info {
  display: flex; flex-direction: column; gap: 8px;
  padding: 12px 16px; border-radius: var(--et-radius-md);
  background: var(--et-surface-2);
  border: 1px solid var(--et-border-soft);
}
.ps-entry-info-row { display: grid; grid-template-columns: 88px minmax(0, 1fr); gap: 10px; align-items: baseline; }
.ps-entry-info-label { font-size: var(--et-text-micro); color: var(--et-muted); white-space: nowrap; }
.ps-entry-info-value {
  min-width: 0; font-size: var(--et-text-caption); line-height: 20px; color: var(--et-fg-2);
  overflow-wrap: anywhere;
}
.ps-entry-info-value [data-ps-pill] { margin-right: 8px; }
.ps-entry-info-note { color: var(--et-muted); }
.ps-compare-single { display: flex; flex-direction: column; gap: 6px; padding: 14px 16px; border-radius: var(--et-radius-sm); background: var(--et-surface); border: 1px solid var(--et-border-soft); }
.ps-compare-single .ps-empty-inline { margin: 2px 0; }

/* 右栏:AI 助手(输入行纵向堆叠;无可编辑条目时 hint-box) */
.ps-ai-input-row { display: flex; flex-direction: column; align-items: stretch; gap: 8px; }
.ps-hint-box {
  display: grid; justify-items: center; gap: 8px; text-align: center;
  padding: 22px 16px; border: 1px dashed var(--et-border); border-radius: var(--et-radius-sm);
}
.ps-hint-box p { margin: 0; font-size: var(--et-text-caption); line-height: var(--et-leading-body); color: var(--et-muted); }
.ps-ai-panel [data-ps-ai-instruction] { flex: 1 1 auto; }
.ps-ai-panel [data-ps-ai-polish-btn],
.ps-ai-panel [data-ps-ai-review-btn] { align-self: stretch; }

/* R3 审批横幅(root 滚动容器顶部 sticky 常驻——position:fixed 会被宿主壳的
   transform 祖先劫持定位(2026-11-13 实测 top 跑飞),sticky 贴滚动容器顶边,
   任何滚动位置都可见可决) */
.ps-approval-layer {
  position: sticky; top: 12px; z-index: 40;
  max-width: 760px;
  margin: 0 0 12px;
}
.ps-approval-layer [data-t7-approval] {
  margin: 0; box-shadow: var(--et-shadow-raised);
  background: var(--et-surface); /* 不透明表面:sticky 悬浮层不得透出下层内容 */
}

/* —— 响应式(640px 断点单列自适应;布局本就单列,收边距与字号) —— */
@media (max-width: 640px) {
  [data-t7-studio-root], [data-t7-trace-root] { padding: 24px 16px 48px; }
  [data-t7-heading] { font-size: var(--et-text-h3); line-height: 1.15; }
  [data-t7-stat-row] { gap: 20px; }
  [data-ps-layer-group] { padding: 4px 14px 8px; }
  [data-ps-entry-row] { margin: 0 -6px; padding: 10px 6px; }
  [data-ps-layer-group-hint] { display: none; }
}

/* —— 循环轨迹:会话列表 —— */
[data-t7-trace-pipeline] { margin: 0 0 16px; font-size: var(--et-text-micro); color: var(--et-muted); }
[data-t7-trace-pipeline-name] { font-weight: 600; }
[data-t7-session-list] {
  display: grid; grid-template-columns: repeat(auto-fill, minmax(340px, 1fr)); gap: 12px;
  border: 0; padding: 0; background: none;
}
[data-t7-session-item] {
  width: 100%; display: flex; flex-direction: column; gap: 6px; text-align: left;
  padding: 16px; font: inherit; cursor: pointer; background: var(--et-surface); border: 1px solid var(--et-border-soft);
  border-radius: var(--et-radius-md);
  transition: border-color var(--et-motion-fast) var(--et-ease), background var(--et-motion-fast) var(--et-ease);
}
[data-t7-session-item]:last-child { border-bottom: 1px solid var(--et-border-soft); padding-bottom: 16px; }
[data-t7-session-item]:hover { border-color: var(--et-border); background: var(--et-surface-2); }
[data-t7-session-item]:hover [data-t7-session-id] { color: var(--et-accent); }
[data-t7-session-id] { font-size: var(--et-text-caption); font-weight: 600; color: var(--et-fg); overflow-wrap: anywhere; }
[data-t7-session-metrics] {
  display: flex; gap: 14px; flex-wrap: wrap; font-size: var(--et-text-micro);
  color: var(--et-muted); font-variant-numeric: tabular-nums;
}
[data-t7-session-last] { font-size: var(--et-text-micro); color: var(--et-muted); }

/* —— 循环轨迹:轮次树 —— */
[data-t7-trace-toolbar] { display: flex; align-items: center; gap: 14px; flex-wrap: wrap; margin-bottom: 16px; }
[data-t7-trace-back] {
  padding: 5px 14px; font: inherit; font-size: var(--et-text-micro); cursor: pointer;
  color: var(--et-fg-2); background: transparent;
  border: 1px solid var(--et-border); border-radius: var(--et-radius-sm);
}
[data-t7-trace-back]:hover { background: var(--et-surface-2); color: var(--et-fg); }
[data-t7-trace-session-id] { font-size: var(--et-text-caption); font-weight: 600; color: var(--et-fg); overflow-wrap: anywhere; }
[data-t7-trace-events] { font-size: var(--et-text-micro); color: var(--et-muted); }
[data-t7-trace-turns] { display: grid; grid-template-columns: repeat(auto-fill, minmax(440px, 1fr)); gap: 16px; align-items: start; }
[data-t7-trace-node] {
  border-radius: var(--et-radius-md); padding: 16px 18px;
  background: var(--et-surface);
  border: 1px solid var(--et-border-soft);
}
[data-t7-trace-node-head] { display: flex; align-items: baseline; gap: 16px; flex-wrap: wrap; }
[data-t7-trace-turn] { font-size: var(--et-text-caption); font-weight: var(--et-weight-display); color: var(--et-fg); }
[data-t7-trace-duration] { font-size: var(--et-text-caption); font-variant-numeric: tabular-nums; color: var(--et-fg-2); }
[data-t7-trace-tokens] { font-size: var(--et-text-micro); font-variant-numeric: tabular-nums; color: var(--et-muted); }
[data-t7-turn-reason-badge] {
  font-size: var(--et-text-micro); padding: 2px 8px; border-radius: var(--et-radius-sm);
  color: var(--et-muted); background: var(--et-surface-2);
}
[data-t7-trace-node][data-t7-turn-reason='end_turn'] [data-t7-turn-reason-badge],
[data-t7-trace-node][data-t7-turn-reason='complete'] [data-t7-turn-reason-badge] {
  color: var(--et-success); background: color-mix(in oklab, var(--et-success), transparent 88%);
}
[data-t7-trace-node][data-t7-turn-reason='tool_use'] [data-t7-turn-reason-badge] {
  color: var(--et-accent); background: var(--et-accent-soft);
}
[data-t7-trace-node][data-t7-turn-reason='error'] [data-t7-turn-reason-badge],
[data-t7-trace-node][data-t7-turn-reason='aborted'] [data-t7-turn-reason-badge] {
  color: var(--et-danger); background: var(--et-danger-soft);
}
[data-t7-trace-tools] { display: flex; flex-direction: column; margin-top: 10px; }
[data-t7-trace-tool] {
  display: flex; align-items: baseline; gap: 12px; flex-wrap: wrap;
  padding: 8px 0; font-size: var(--et-text-micro); border-bottom: 1px solid var(--et-border-soft);
}
[data-t7-trace-tool]:last-child { border-bottom: 0; }
[data-t7-tool-name] { font-weight: 600; color: var(--et-fg-2); }
[data-t7-tool-duration] { font-variant-numeric: tabular-nums; color: var(--et-muted); }
[data-t7-tool-args] { font-size: var(--et-text-micro); color: var(--et-muted); overflow-wrap: anywhere; }
[data-t7-trace-tool][data-t7-tool-error='true'] [data-t7-tool-name] { color: var(--et-danger); }
[data-t7-tool-error-name] {
  font-size: var(--et-text-micro); font-weight: 600; padding: 1px 8px; border-radius: var(--et-radius-sm);
  color: var(--et-danger);
  background: color-mix(in srgb, var(--et-danger) 12%, transparent);
}
[data-t7-trace-approvals] { display: flex; flex-direction: column; gap: 6px; margin-top: 10px; }
[data-t7-approval-point] {
  display: flex; align-items: baseline; gap: 12px; padding: 8px 12px; border-radius: var(--et-radius-md);
  font-size: var(--et-text-micro);
  color: var(--et-warn);
  background: color-mix(in srgb, var(--et-warn) 10%, transparent);
}
[data-t7-approval-point-name] { font-weight: var(--et-weight-display); }
[data-t7-approval-point-time] { font-size: var(--et-text-micro); color: var(--et-muted); }

@media (prefers-reduced-motion: reduce) {
  [data-t7-studio-root] button,
  [data-t7-trace-root] button,
  [data-t7-studio-root] input,
  [data-t7-studio-root] textarea,
  [data-t7-studio-root] select { transition: none; }
}
@media (max-width: 1100px) {
  [data-t7-studio-root], [data-t7-trace-root] { padding: 32px 24px 64px; }
  [data-ps-group-nav] { grid-template-columns: 1fr; }
  [data-t7-session-list] { grid-template-columns: 1fr; }
  [data-t7-trace-turns] { grid-template-columns: 1fr; }
  /* 三栏 → 两栏:库 + 编辑器同排,AI 助手整宽落底 */
  [data-ps-workspace] { grid-template-columns: 264px minmax(0, 1fr); }
  [data-ps-ai-panel] { grid-column: 1 / -1; }
  .ps-library-list { max-height: 420px; }
}
@media (max-width: 760px) {
  /* 两栏 → 单列:库/编辑器/AI 依次纵向堆叠 */
  [data-ps-workspace] { grid-template-columns: 1fr; }
  .ps-page-head { flex-direction: column; gap: 12px; }
  .ps-page-actions { padding-top: 0; }
  .ps-compare-grid { grid-template-columns: 1fr; row-gap: 1px; }
}
@media (max-width: 640px) {
  [data-t7-studio-root], [data-t7-trace-root] { padding: 24px 16px 48px; }
  [data-t7-heading] { font-size: var(--et-text-h3); line-height: 1.15; }
}
@keyframes et-fade-in { from { opacity: 0; transform: translateY(4px); } to { opacity: 1; transform: none; } }
@media (prefers-reduced-motion: reduce) { [data-eterna-panel='root'], [data-eterna-usage-stats], [data-t7-studio-root], [data-t7-trace-root] { animation: none; } }

`

/** 幂等注入样式表(同文档重复装载时复用既有节点);返回移除该节点的 disposer(卸载零残留)。 */
export function injectStudioStyles(doc: Document = document): () => void {
  injectDesignTokens({ bridge: true, doc })
  const marker = 'data-t7-styles'
  const existing = doc.querySelector(`style[${marker}]`)
  if (existing !== null) return () => { existing.remove() }
  const style = doc.createElement('style')
  style.textContent = CSS
  style.setAttribute(marker, 'true')
  doc.head.append(style)
  return () => { style.remove() }
}
