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

@media (max-width: 760px) {
  /* 形态收缩:标签上、控件下(位置规则不变),否则窄屏 label 列被控件挤成逐字换行。 */
  [data-eterna-eval-set='row'] { grid-template-columns: minmax(0, 1fr); }
  [data-eterna-eval-set='business-item'] { grid-template-columns: minmax(0, 1fr); }
  [data-eterna-eval-set='criterion'] { grid-template-columns: minmax(0, 1fr); }
  [data-eterna-eval-set='criterion'] input[type='number'] { width: 100%; }
  [data-eterna-eval-set='field'] { justify-content: flex-start; }
  [data-eterna-eval-set] select,
  [data-eterna-eval-set] input[type='text'] { width: 100%; min-width: 0; }
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
