/**
 * 评测面板样式 —— 右栏 tab body(只读结果面)。
 *
 * 色值/圆角/间距/字号全部经 @eterna/ui 令牌(AGENTS.md 铁律 2):
 * 应用内深浅主题由 DSH 桥接层(--dsw-alias-*)跟随产品壳,本文件不出现字面色值。
 * 叠层纪律:本面板不是决策层、不是 toast —— 只有面板内的普通卡片与徽标。
 * 圆角只用阶梯值(8/12/16/22/28/36/pill),嵌套满足同心弧(子 = 父 − 内距)。
 */
import { injectDesignTokens } from '@eterna/ui'

const CSS = `
[data-eterna-eval='panel'] {
  display: flex;
  flex-direction: column;
  gap: var(--et-space-4);
  padding: var(--et-space-5);
  color: var(--et-fg);
  font-size: var(--et-text-caption);
  line-height: var(--et-leading-body);
  overflow-y: auto;
  height: 100%;
  min-height: 0;
  box-sizing: border-box;
}
[data-eterna-eval='panel'] h2 {
  display: flex;
  align-items: center;
  gap: var(--et-space-2);
  margin: 0;
  font-size: var(--et-text-lead);
  font-weight: var(--et-weight-display);
  line-height: var(--et-leading-snug);
  color: var(--et-fg);
}
[data-eterna-eval='panel'] h3 {
  margin: 0 0 var(--et-space-2);
  font-size: var(--et-text-caption);
  font-weight: var(--et-weight-display);
  line-height: var(--et-leading-snug);
  color: var(--et-fg-2);
}
[data-eterna-eval='head'] {
  display: flex;
  flex-direction: column;
  gap: var(--et-space-1);
}
[data-eterna-eval='meta'] {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--et-space-2);
  color: var(--et-muted);
  font-size: var(--et-text-micro);
}
[data-eterna-eval='actions'] {
  display: flex;
  align-items: center;
  gap: var(--et-space-2);
  margin-top: var(--et-space-2);
}
.et-eval-button {
  display: inline-flex;
  align-items: center;
  gap: var(--et-space-1);
  min-height: 36px; /* 触控热区下限(frontend-style §7) */
  padding: var(--et-space-1) var(--et-space-3);
  border: 1px solid var(--et-border);
  border-radius: var(--et-radius-sm);
  background: var(--et-surface);
  color: var(--et-fg-2);
  font: inherit;
  font-size: var(--et-text-micro);
  cursor: pointer;
}
.et-eval-button:hover:not(:disabled) {
  background: var(--et-surface-2);
  color: var(--et-fg);
}
.et-eval-button:focus-visible {
  outline: none;
  box-shadow: var(--et-focus-ring);
}
.et-eval-button:disabled {
  cursor: not-allowed;
  opacity: 0.6;
}
[data-eterna-eval='card'] {
  display: flex;
  flex-direction: column;
  gap: var(--et-space-2);
  padding: var(--et-space-4);
  border: 1px solid var(--et-border-soft);
  border-radius: var(--et-radius-md);
  background: var(--et-surface);
}
[data-eterna-eval='card'][data-role='verdict'] {
  gap: var(--et-space-1);
}
[data-eterna-eval='card'][data-role='verdict'][data-level='warn'] {
  border-color: var(--et-warn);
}
[data-eterna-eval='verdict-title'] {
  font-size: var(--et-text-body);
  font-weight: var(--et-weight-display);
  color: var(--et-fg);
}
/* 警示态标题用正文墨色(--et-warn 作 16px 字色对比度不足 4.5:1,警示靠左边框与旗标表达)。 */
[data-eterna-eval='card'][data-role='verdict'][data-level='warn'] {
  border-left: 3px solid var(--et-warn);
}
[data-eterna-eval='card'][data-role='verdict'][data-level='unrated'] [data-eterna-eval='verdict-title'] {
  color: var(--et-muted);
}
[data-eterna-eval='reasons'] {
  margin: 0;
  padding-left: var(--et-space-4);
  color: var(--et-fg-2);
}
[data-eterna-eval='reasons'] li {
  margin: 0;
}
[data-eterna-eval='table'] {
  width: 100%;
  border-collapse: collapse;
  font-size: var(--et-text-micro);
}
[data-eterna-eval='table'] caption {
  text-align: left;
  padding-bottom: var(--et-space-1);
  color: var(--et-muted);
}
[data-eterna-eval='table'] th,
[data-eterna-eval='table'] td {
  padding: var(--et-space-1) var(--et-space-2);
  border-bottom: 1px solid var(--et-border-soft);
  text-align: left;
  vertical-align: baseline;
}
/* 首末列不留边(贴卡片安全区),中间列横距把「值」与判定旗标隔开——
   零横距时「2 轮」与「仅计量」会粘成一段文字(harness 截图实测)。 */
[data-eterna-eval='table'] th:first-child,
[data-eterna-eval='table'] td:first-child {
  padding-left: 0;
}
[data-eterna-eval='table'] th:last-child,
[data-eterna-eval='table'] td:last-child {
  padding-right: 0;
}
[data-eterna-eval='table'] th {
  font-weight: var(--et-weight-display);
  color: var(--et-muted);
}
[data-eterna-eval='table'] td[data-num='true'] {
  text-align: right;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}
[data-eterna-eval='table'] tr:last-child td {
  border-bottom: none;
}
[data-eterna-eval='flag'] {
  display: inline-block;
  padding: 0 var(--et-space-1);
  border-radius: var(--et-radius-xs);
  font-size: var(--et-text-micro);
  color: var(--et-fg-2);
  background: var(--et-surface-2);
}
[data-eterna-eval='flag'][data-tone='danger'] {
  color: var(--et-danger);
}
[data-eterna-eval='flag'][data-tone='warn'] {
  color: var(--et-warn);
}
[data-eterna-eval='detail'] {
  color: var(--et-muted);
  font-size: var(--et-text-micro);
}
[data-eterna-eval='issues'] {
  display: flex;
  flex-direction: column;
  gap: var(--et-space-2);
  margin: 0;
  padding: 0;
  list-style: none;
}
[data-eterna-eval='issues'] li {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding-left: var(--et-space-3);
  border-left: 2px solid var(--et-warn);
}
[data-eterna-eval='issues'] li[data-kind='tool_error'],
[data-eterna-eval='issues'] li[data-kind='approval_denied'],
[data-eterna-eval='issues'] li[data-kind='turn_error'] {
  border-left-color: var(--et-danger);
}
[data-eterna-eval='issue-title'] {
  color: var(--et-fg-2);
}
[data-eterna-eval='usage'] {
  display: grid;
  grid-template-columns: max-content minmax(0, 1fr);
  gap: var(--et-space-1) var(--et-space-3);
  margin: 0;
  font-size: var(--et-text-micro);
}
[data-eterna-eval='usage'] dt {
  color: var(--et-muted);
}
[data-eterna-eval='usage'] dd {
  margin: 0;
  color: var(--et-fg-2);
  font-variant-numeric: tabular-nums;
}
[data-eterna-eval='hint'] {
  margin: 0;
  color: var(--et-muted);
}
[data-eterna-eval='error'] {
  margin: 0;
  padding: var(--et-space-3);
  border: 1px solid var(--et-danger);
  border-radius: var(--et-radius-sm);
  color: var(--et-danger);
  background: var(--et-danger-soft);
}
[data-eterna-eval='pending'] {
  margin: 0;
  padding-left: var(--et-space-4);
  color: var(--et-muted);
  font-size: var(--et-text-micro);
}
[data-eterna-eval='judge-head'] {
  display: flex;
  align-items: flex-start;
  gap: var(--et-space-2);
}
[data-eterna-eval='judge-meta'] {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 2px;
  color: var(--et-muted);
  font-size: var(--et-text-micro);
}
[data-eterna-eval='judge-meta'] [data-eterna-eval='verdict-title'] {
  color: var(--et-fg);
  font-size: var(--et-text-caption);
}
/* 结论级 warn/未评:靠墨色与文案表达(--et-warn 作字色对比度不足,不实心填充)。 */
[data-eterna-eval='judge-meta'] [data-eterna-eval='verdict-title'][data-level='unrated'] {
  color: var(--et-muted);
}
[data-eterna-eval='judge-head'] .et-eval-button {
  margin-left: auto;
  flex: none;
  white-space: nowrap;
}
[data-eterna-eval='judge-detail-row'] td {
  padding-top: 0;
}
[data-eterna-eval='judge-detail-row'] details summary {
  cursor: pointer;
  color: var(--et-muted);
  font-size: var(--et-text-micro);
}
[data-eterna-eval='rationale'] {
  margin: var(--et-space-1) 0;
  color: var(--et-fg-2);
}

/* ── 设置分区「评测」(settings.section) ─────────────────────────────── */
[data-eterna-eval-set='section'] {
  display: flex;
  flex-direction: column;
  gap: var(--et-space-4);
  color: var(--et-fg);
  font-size: var(--et-text-caption);
  line-height: var(--et-leading-body);
}
[data-eterna-eval-set='group'] {
  display: flex;
  flex-direction: column;
  gap: var(--et-space-2);
  margin: 0;
  padding: var(--et-space-4);
  border: 1px solid var(--et-border-soft);
  border-radius: var(--et-radius-md);
  background: var(--et-surface);
}
[data-eterna-eval-set='group'] legend {
  padding: 0 var(--et-space-1);
  color: var(--et-fg-2);
  font-weight: var(--et-weight-display);
}
[data-eterna-eval-set='row'] {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: center;
  gap: var(--et-space-3);
  min-height: 36px; /* 触控热区下限(frontend-style §7) */
}
[data-eterna-eval-set='row'] label {
  display: flex;
  align-items: center;
  min-height: 36px;
  color: var(--et-fg-2);
}
[data-eterna-eval-set='field'] {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: flex-end;
  gap: var(--et-space-2);
}
[data-eterna-eval-set] select,
[data-eterna-eval-set] input[type='number'],
[data-eterna-eval-set] input[type='text'] {
  box-sizing: border-box; /* 窄屏 width:100% 时内边距不再撑出网格(390 实测水平溢出 449px) */
  min-height: 36px; /* 触控热区下限(frontend-style §7) */
  padding: 0 var(--et-space-2);
  border: 1px solid var(--et-border);
  border-radius: var(--et-radius-sm); /* 同心弧:父卡片 md = 16,内距 4 → 子 12 */
  background: var(--et-surface);
  color: var(--et-fg);
  font: inherit;
  font-size: var(--et-text-micro);
}
[data-eterna-eval-set] select {
  min-width: 200px;
}
[data-eterna-eval-set] input[type='number'] {
  width: 120px;
  font-variant-numeric: tabular-nums;
}
[data-eterna-eval-set] input[type='text'] {
  min-width: 220px;
}
[data-eterna-eval-set] select:focus-visible,
[data-eterna-eval-set] input:focus-visible {
  outline: none;
  box-shadow: var(--et-focus-ring);
}
[data-eterna-eval-set] select:disabled,
[data-eterna-eval-set] input:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}
[data-eterna-eval-set] input[type='checkbox'] {
  width: 18px;
  height: 18px;
  accent-color: var(--et-accent);
}
[data-eterna-eval-set='unit'],
[data-eterna-eval-set='hint'] {
  margin: 0;
  color: var(--et-muted);
  font-size: var(--et-text-micro);
}
[data-eterna-eval-set='metrics'] {
  display: flex;
  flex-direction: column;
  gap: 0; /* 每行已按 36px 触控热区撑高，行间不再叠加间距(设置弹窗总高可控) */
  margin: 0;
  padding: 0;
  list-style: none;
}
[data-eterna-eval-set='metric'] {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: var(--et-space-2);
  min-height: 36px; /* 触控热区下限(frontend-style §7) */
}
[data-eterna-eval-set='metric'] label {
  display: inline-flex;
  align-items: center;
  gap: var(--et-space-2);
  min-height: 36px;
  color: var(--et-fg-2);
}
[data-eterna-eval-set='badges'] {
  display: inline-flex;
  gap: var(--et-space-1);
}
[data-eterna-eval-set='badge'] {
  padding: 0 var(--et-space-1);
  border-radius: var(--et-radius-xs);
  background: var(--et-surface-2);
  color: var(--et-muted);
  font-size: var(--et-text-micro);
}
[data-eterna-eval-set='badge'][data-tone='accent'] {
  color: var(--et-accent);
  background: var(--et-accent-soft);
}
[data-eterna-eval-set='badge'][data-tone='warn'] {
  color: var(--et-warn);
  background: var(--et-warn-soft);
}
[data-eterna-eval-set='actions'] {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--et-space-2);
}
[data-eterna-eval-set='business-list'] {
  display: flex;
  flex-direction: column;
  gap: 0;
  margin: 0;
  padding: 0;
  list-style: none;
}
[data-eterna-eval-set='business-item'] {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto auto;
  align-items: center;
  gap: var(--et-space-2);
  min-height: 44px; /* 行内 checkbox 热区 36px + 上下留白 */
  padding: var(--et-space-1) 0;
  border-top: 1px solid var(--et-border-soft);
}
[data-eterna-eval-set='business-list'] > li:first-child {
  border-top: none;
}
[data-eterna-eval-set='business-main'] {
  display: flex;
  flex-direction: column;
  gap: 0;
  min-width: 0;
}
[data-eterna-eval-set='business-name'] {
  color: var(--et-fg);
  overflow-wrap: anywhere;
}
[data-eterna-eval-set='business-actions'] {
  display: inline-flex;
  align-items: center;
  gap: var(--et-space-2);
}
[data-eterna-eval-set='switch'] {
  display: inline-flex;
  align-items: center;
  gap: var(--et-space-1);
  min-height: 36px; /* 触控热区下限(frontend-style §7) */
  color: var(--et-fg-2);
  font-size: var(--et-text-micro);
}
[data-eterna-eval-set='business-tools'] {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--et-space-2);
}
[data-eterna-eval-set='editor'] {
  display: flex;
  flex-direction: column;
  gap: var(--et-space-2);
  padding: var(--et-space-3);
  border: 1px solid var(--et-border-soft);
  border-radius: var(--et-radius-sm); /* 阶梯值;内嵌子块与 tasks 设置内嵌块同值 */
  background: var(--et-surface-2);
}
[data-eterna-eval-set='criteria'] {
  display: flex;
  flex-direction: column;
  gap: var(--et-space-2);
}
[data-eterna-eval-set='criterion'] {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 88px auto auto;
  align-items: center;
  gap: var(--et-space-2);
}
[data-eterna-eval-set='criterion'] input[type='text'] {
  min-width: 0;
}
[data-eterna-eval-set='criterion'] input[type='number'] {
  width: 100%;
}
[data-eterna-eval-set='yaml-box'] summary,
[data-eterna-eval-set='import-box'] summary {
  display: flex;
  align-items: center;
  min-height: 36px; /* 触控热区下限(frontend-style §7) */
  color: var(--et-fg-2);
  font-size: var(--et-text-micro);
  cursor: pointer;
}
[data-eterna-eval-set='import-text'] {
  box-sizing: border-box; /* 窄屏 width:100% 不叠内边距 */
  width: 100%;
  min-height: 120px; /* 6 行可读;resize 纵向可放大 */
  padding: var(--et-space-2);
  border: 1px solid var(--et-border);
  border-radius: var(--et-radius-sm);
  background: var(--et-surface);
  color: var(--et-fg);
  font-family: var(--et-font-mono);
  font-size: var(--et-text-micro);
  line-height: var(--et-leading-snug);
  resize: vertical;
}
[data-eterna-eval-set='import-result'] {
  display: flex;
  flex-direction: column;
  gap: var(--et-space-2);
}
[data-eterna-eval-set='yaml'] {
  margin: var(--et-space-2) 0 0;
  padding: var(--et-space-3);
  border: 1px solid var(--et-border-soft);
  border-radius: var(--et-radius-xs);
  background: var(--et-surface);
  color: var(--et-fg-2);
  font-family: var(--et-font-mono);
  font-size: var(--et-text-micro);
  line-height: var(--et-leading-snug);
  max-height: 220px;
  overflow: auto;
  /* 软换行:white-space:pre 会让最长 YAML 行成为整卡最小宽度,390 下把设置卡片撑出视口。 */
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
[data-eterna-eval-set='feedback'] {
  color: var(--et-fg-2);
  font-size: var(--et-text-micro);
}
[data-eterna-eval-set='error'] {
  margin: 0;
  padding: var(--et-space-3);
  border: 1px solid var(--et-danger);
  border-radius: var(--et-radius-sm);
  color: var(--et-danger);
  background: var(--et-danger-soft);
}

/* ── 校准(设置分区子块):KPI 双卡 + 指标表 + 混淆矩阵 ── */
[data-eterna-eval-cal='kpis'] {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: var(--et-space-3);
}
[data-eterna-eval-cal='kpi'] {
  display: flex;
  flex-direction: column;
  gap: var(--et-space-1);
  padding: var(--et-space-3);
  border: 1px solid var(--et-border-soft);
  border-radius: var(--et-radius-sm);
  background: var(--et-surface-2);
  min-width: 0;
}
[data-eterna-eval-cal='kpi-title'] {
  margin: 0;
  color: var(--et-fg-2);
  font-size: var(--et-text-caption);
  font-weight: var(--et-weight-display);
}
[data-eterna-eval-cal='kpi-value'] {
  margin: 0;
  color: var(--et-fg);
  font-size: var(--et-text-h3);
  font-weight: var(--et-weight-display);
  line-height: var(--et-leading-snug);
  /* 数字用等宽数字位,百分比跳动不抖动布局 */
  font-variant-numeric: tabular-nums;
}
[data-eterna-eval-cal='kpi-badge'] {
  margin: 0;
  display: flex;
  align-items: center;
  min-height: 36px;
}
[data-eterna-eval-cal='note'] {
  margin: 0;
  color: var(--et-muted);
  font-size: var(--et-text-micro);
  line-height: var(--et-leading-body);
  overflow-wrap: anywhere;
}
[data-eterna-eval-cal='table-wrap'] {
  overflow-x: auto;
  min-width: 0;
}
[data-eterna-eval-cal='table'] {
  width: 100%;
  border-collapse: collapse;
  font-size: var(--et-text-caption);
}
[data-eterna-eval-cal='table'] th,
[data-eterna-eval-cal='table'] td {
  padding: var(--et-space-1) var(--et-space-2);
  border-bottom: 1px solid var(--et-border-soft);
  text-align: left;
  white-space: nowrap;
}
[data-eterna-eval-cal='table'] th:not(:first-child),
[data-eterna-eval-cal='table'] td:nth-child(n+2) {
  text-align: right;
  font-variant-numeric: tabular-nums;
}
[data-eterna-eval-cal='table'] thead th {
  color: var(--et-muted);
  font-size: var(--et-text-micro);
  font-weight: var(--et-weight-display);
}
[data-eterna-eval-cal='table'] tr:last-child td,
[data-eterna-eval-cal='table'] tr:last-child th {
  border-bottom: none;
}
[data-eterna-eval-cal='table'] tr[data-active='true'] {
  background: var(--et-accent-soft);
}
[data-eterna-eval-cal='metric-btn'] {
  padding: 0;
  border: none;
  background: none;
  color: var(--et-fg);
  font: inherit;
  font-weight: var(--et-weight-body);
  text-align: left;
  cursor: pointer;
}
[data-eterna-eval-cal='metric-btn']:hover {
  color: var(--et-accent);
}
[data-eterna-eval-cal='metric-btn']:focus-visible {
  outline: none;
  box-shadow: var(--et-focus-ring);
  border-radius: var(--et-radius-xs);
}
[data-eterna-eval-cal='metric-btn'][aria-pressed='true'] {
  color: var(--et-accent);
}
[data-eterna-eval-cal='detail-card'] {
  display: flex;
  flex-direction: column;
  gap: var(--et-space-2);
  padding: var(--et-space-3);
  border: 1px solid var(--et-border-soft);
  border-radius: var(--et-radius-sm);
  background: var(--et-surface);
  min-width: 0;
}
[data-eterna-eval-cal='detail-title'] {
  margin: 0;
  color: var(--et-fg);
  font-size: var(--et-text-caption);
  font-weight: var(--et-weight-display);
  overflow-wrap: anywhere;
}
[data-eterna-eval-cal='matrix'] {
  display: grid;
  grid-template-columns: minmax(0, auto) repeat(2, minmax(0, 1fr));
  gap: 1px;
  border: 1px solid var(--et-border-soft);
  border-radius: var(--et-radius-xs);
  overflow: hidden;
  background: var(--et-border-soft);
  font-size: var(--et-text-caption);
}
[data-eterna-eval-cal='matrix'] > * {
  padding: var(--et-space-2);
  background: var(--et-surface);
  color: var(--et-fg-2);
}
[data-eterna-eval-cal='matrix'] [role='columnheader'],
[data-eterna-eval-cal='matrix'] [role='cell'] {
  text-align: center;
  font-variant-numeric: tabular-nums;
}
[data-eterna-eval-cal='matrix'] [role='columnheader'] {
  color: var(--et-muted);
  font-size: var(--et-text-micro);
}
[data-eterna-eval-cal='matrix'] [role='rowheader'] {
  color: var(--et-fg-2);
}
[data-eterna-eval='label-group'] {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--et-space-2);
}
/* ── 试跑(单指标 · 真实模型):折叠入口 + 控件行 + 原始输出 ── */
[data-eterna-eval='trial-box'] summary,
[data-eterna-eval='trial-raw-box'] summary {
  display: flex;
  align-items: center;
  min-height: 36px; /* 触控热区下限(frontend-style §7) */
  color: var(--et-fg-2);
  font-size: var(--et-text-micro);
  cursor: pointer;
}
[data-eterna-eval='trial-controls'] {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--et-space-2);
  margin: var(--et-space-2) 0;
}
[data-eterna-eval='trial-controls'] label {
  color: var(--et-fg-2);
  font-size: var(--et-text-micro);
}
[data-eterna-eval='trial-controls'] select,
[data-eterna-eval='trial-controls'] input[type='number'] {
  box-sizing: border-box; /* 窄屏不叠内边距 */
  min-height: 36px;
  padding: 0 var(--et-space-2);
  border: 1px solid var(--et-border);
  border-radius: var(--et-radius-sm);
  background: var(--et-surface);
  color: var(--et-fg);
  font: inherit;
  font-size: var(--et-text-micro);
}
[data-eterna-eval='trial-controls'] select { max-width: 100%; }
[data-eterna-eval='trial-controls'] input[type='number'] { width: 96px; }
[data-eterna-eval='trial-controls'] select:focus-visible,
[data-eterna-eval='trial-controls'] input[type='number']:focus-visible {
  outline: none;
  box-shadow: var(--et-focus-ring);
}
[data-eterna-eval='trial-result'] {
  display: flex;
  flex-direction: column;
  gap: var(--et-space-2);
  padding: var(--et-space-3);
  border: 1px solid var(--et-border-soft);
  border-radius: var(--et-radius-sm);
  background: var(--et-surface-2);
  min-width: 0;
}
[data-eterna-eval='trial-head'] {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--et-space-2);
  margin: 0;
}
[data-eterna-eval='trial-raw'] {
  margin: 0;
  padding: var(--et-space-2);
  border-radius: var(--et-radius-xs);
  background: var(--et-surface);
  font-family: var(--et-font-mono);
  font-size: var(--et-text-micro);
  line-height: var(--et-leading-snug);
  max-height: 220px;
  overflow: auto;
  /* 软换行:pre 会把最长原始输出撑成整卡最小宽度(390 撑破视口)。 */
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
/* 已复核 = 软底 + 强调字(不实心填充压白字;深浅主题都跟随)。 */
[data-eterna-eval='label-group'] .et-eval-button[aria-pressed='true'] {
  border-color: var(--et-accent);
  color: var(--et-accent);
  background: var(--et-accent-soft);
}

/* ── 评测总览(main keyed 页;访问方式 = 侧栏图标,不新增独立页面路由) ── */
[data-eterna-eval-ov='page'] {
  box-sizing: border-box;
  width: 100%;
  height: 100%;
  overflow-y: auto;
  overflow-x: hidden;
  padding: var(--et-space-8) var(--et-space-8) var(--et-space-12);
  color: var(--et-fg);
  font-size: var(--et-text-body);
  line-height: var(--et-leading-body);
}
[data-eterna-eval-ov='page'] * { box-sizing: border-box; min-width: 0; }
[data-eterna-eval-ov='head'] {
  display: flex;
  align-items: baseline;
  flex-wrap: wrap;
  gap: var(--et-space-3);
  margin: 0 0 var(--et-space-6);
}
[data-eterna-eval-ov='head'] h1 {
  margin: 0;
  font-family: var(--et-font-display);
  font-size: var(--et-text-h2);
  font-weight: var(--et-weight-display);
  line-height: var(--et-leading-tight);
  letter-spacing: var(--et-tracking-display);
}
[data-eterna-eval-ov='scope'] {
  color: var(--et-muted);
  font-size: var(--et-text-caption);
}
[data-eterna-eval-ov='scope'] + .et-eval-button { margin-left: auto; }
[data-eterna-eval-ov='kpis'] {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: var(--et-space-4);
  margin-bottom: var(--et-space-8);
}
[data-eterna-eval-ov='kpi'],
[data-eterna-eval-ov='card'] {
  padding: var(--et-space-5);
  border: 1px solid var(--et-border-soft);
  border-radius: var(--et-radius-md);
  box-shadow: var(--et-shadow-r1);
  background: var(--et-surface);
}
[data-eterna-eval-ov='kicker'] {
  margin: 0 0 var(--et-space-1);
  color: var(--et-muted);
  font-size: var(--et-text-meta);
  letter-spacing: var(--et-tracking-caps);
}
[data-eterna-eval-ov='value'] {
  margin: 0;
  color: var(--et-fg);
  font-family: var(--et-font-display);
  font-size: var(--et-text-h1);
  font-weight: var(--et-weight-display);
  line-height: var(--et-leading-tight);
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}
[data-eterna-eval-ov='note'] {
  margin: var(--et-space-1) 0 0;
  color: var(--et-muted);
  font-size: var(--et-text-micro);
  line-height: var(--et-leading-body);
  overflow-wrap: anywhere;
}
[data-eterna-eval-ov='grid'] {
  display: grid;
  grid-template-columns: minmax(0, 1.7fr) minmax(0, 1fr);
  gap: var(--et-space-6);
  align-items: start;
  margin-bottom: var(--et-space-6);
}
[data-eterna-eval-ov='card'] h2 {
  margin: 0 0 var(--et-space-2);
  color: var(--et-fg);
  font-size: var(--et-text-lead);
  font-weight: var(--et-weight-display);
  line-height: var(--et-leading-snug);
}
[data-eterna-eval-ov='strip'] {
  display: flex;
  align-items: flex-end;
  gap: 6px;
  height: 168px;
  margin-top: var(--et-space-3);
  padding: var(--et-space-3) var(--et-space-3) 0;
  border: 1px solid var(--et-border-soft);
  border-radius: var(--et-radius-sm);
  background: var(--et-surface-2);
}
[data-eterna-eval-ov='strip-day'] {
  flex: 1 1 0;
  display: flex;
  flex-direction: column;
  justify-content: flex-end;
  align-items: center;
  height: 100%;
  min-width: 0;
}
[data-eterna-eval-ov='strip-day'] i {
  display: block;
  width: 100%;
  min-height: 2px;
  border-radius: var(--et-radius-xs) var(--et-radius-xs) 0 0;
  background: var(--et-accent);
}
[data-eterna-eval-ov='strip-day'][data-empty='true'] i { background: var(--et-border); }
[data-eterna-eval-ov='strip-day'] em {
  margin-top: var(--et-space-1);
  color: var(--et-meta);
  font-size: var(--et-text-micro);
  font-style: normal;
  line-height: var(--et-leading-snug);
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}
[data-eterna-eval-ov='reading'] {
  display: flex;
  flex-direction: column;
  gap: var(--et-space-2);
  margin: 0;
  padding-left: var(--et-space-4);
  color: var(--et-fg-2);
  font-size: var(--et-text-caption);
  line-height: var(--et-leading-body);
}
[data-eterna-eval-ov='table-wrap'] {
  margin-top: var(--et-space-3);
  overflow-x: auto;
  border: 1px solid var(--et-border-soft);
  border-radius: var(--et-radius-sm);
}
[data-eterna-eval-ov='table'] {
  width: 100%;
  border-collapse: collapse;
  font-size: var(--et-text-caption);
}
[data-eterna-eval-ov='table'] th,
[data-eterna-eval-ov='table'] td {
  padding: var(--et-space-2) var(--et-space-3);
  border-bottom: 1px solid var(--et-border-soft);
  text-align: left;
  white-space: nowrap;
}
[data-eterna-eval-ov='table'] thead th {
  color: var(--et-muted);
  font-size: var(--et-text-meta);
  font-weight: var(--et-weight-emphasis);
}
[data-eterna-eval-ov='table'] tbody th {
  color: var(--et-fg-2);
  font-weight: var(--et-weight-body);
}
[data-eterna-eval-ov='table'] td[data-num='true'] {
  text-align: right;
  font-variant-numeric: tabular-nums;
}
[data-eterna-eval-ov='table'] tr:last-child th,
[data-eterna-eval-ov='table'] tr:last-child td { border-bottom: 0; }
[data-eterna-eval-ov='bar'] {
  display: inline-block;
  width: 64px;
  height: 6px;
  margin-right: var(--et-space-2);
  border-radius: var(--et-radius-pill);
  background: var(--et-surface-2);
  overflow: hidden;
  vertical-align: middle;
}
[data-eterna-eval-ov='bar'] i {
  display: block;
  height: 100%;
  border-radius: var(--et-radius-pill);
  background: var(--et-accent);
}
[data-eterna-eval-ov='bar'][data-low='true'] i { background: var(--et-warn); }
[data-eterna-eval-ov='badge'] {
  margin-left: var(--et-space-1);
  padding: 0 var(--et-space-1);
  border-radius: var(--et-radius-xs);
  background: var(--et-accent-soft);
  color: var(--et-accent);
  font-size: var(--et-text-micro);
}
[data-eterna-eval-ov='hint'] {
  margin: var(--et-space-2) 0;
  color: var(--et-muted);
  font-size: var(--et-text-caption);
  line-height: var(--et-leading-body);
}
[data-eterna-eval-ov='error'] {
  margin: var(--et-space-2) 0;
  color: var(--et-danger);
  font-size: var(--et-text-caption);
}

@media (max-width: 1100px) {
  [data-eterna-eval-ov='page'] { padding: var(--et-space-6) var(--et-space-5) var(--et-space-12); }
  [data-eterna-eval-ov='kpis'] { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  [data-eterna-eval-ov='grid'] { grid-template-columns: minmax(0, 1fr); }
}
@media (max-width: 640px) {
  [data-eterna-eval-ov='page'] { padding: var(--et-space-5) var(--et-space-4) var(--et-space-12); }
  [data-eterna-eval-ov='head'] h1 { font-size: var(--et-text-h3); }
  [data-eterna-eval-ov='kpis'] { gap: var(--et-space-3); }
  [data-eterna-eval-ov='kpi'],
  [data-eterna-eval-ov='card'] { padding: var(--et-space-3); }
  [data-eterna-eval-ov='value'] { font-size: var(--et-text-lead); }
  [data-eterna-eval-ov='strip'] { height: 112px; gap: 4px; padding: var(--et-space-2) var(--et-space-2) 0; }
  /* 14 个日标签在 390 下必然拥挤:每 3 天留一个,其余隐藏(仍可 title 查看)。 */
  [data-eterna-eval-ov='strip-day']:not(:nth-child(3n+1)) em { visibility: hidden; }
}

@media (max-width: 760px) {
  /* 形态收缩:标签上、控件下(位置规则不变),否则窄屏 label 列被控件挤成逐字换行。 */
  [data-eterna-eval-set='row'] { grid-template-columns: minmax(0, 1fr); }
  [data-eterna-eval-set='business-item'] { grid-template-columns: minmax(0, 1fr); }
  [data-eterna-eval-set='criterion'] { grid-template-columns: minmax(0, 1fr); }
  [data-eterna-eval-set='criterion'] input[type='number'] { width: 100%; }
  [data-eterna-eval-set='field'] { justify-content: flex-start; }
  [data-eterna-eval-set] select,
  [data-eterna-eval-set] input[type='text'] { width: 100%; min-width: 0; }
  /* 校准 KPI 在 760 断点下仍两列(数字短),只收缩内边距;表保持横向滚动。 */
  [data-eterna-eval-cal='kpi'] { padding: var(--et-space-2); }
  [data-eterna-eval-cal='kpi-value'] { font-size: var(--et-text-lead); }
}
@media (max-width: 640px) {
  [data-eterna-eval='panel'] { padding: var(--et-space-4); }
}

@media (prefers-reduced-motion: reduce) {
  [data-eterna-eval] * { transition: none !important; animation: none !important; }
}
`

/** 注入评测面板样式;返回撤销函数。 */
export function injectSessionEvalStyles(): () => void {
  // 应用内必须走桥接层(bridge:true)：--et-* 由宿主 --dsw-alias-* 派生，深浅主题
  // 跟随产品壳；不传则落到独立页令牌块(恒浅色)，右栏在深色主题下整块发白
  // (2026-11-25 harness 截图实测)。
  const disposeTokens = injectDesignTokens({ bridge: true })
  const style = document.createElement('style')
  style.dataset.eternaSessionEval = ''
  style.textContent = CSS
  document.head.appendChild(style)
  return () => {
    style.remove()
    disposeTokens()
  }
}
