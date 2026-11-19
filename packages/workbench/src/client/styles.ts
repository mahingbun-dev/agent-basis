/**
 * 工作台样式 —— 原型 03(docs/prototypes/03-workbench-views.html)三视图
 * (工作监控看板/日志监控/评测监控)、原型 01(01-task-sidebar.html)会话侧
 * 任务侧栏与报告时间线、原型 02(02-attention-card.html)Attention 站内横幅
 * 的样式翻译:选择器由原型 class 词汇表换为 data-eterna-workbench* 结构锚点
 * (panel 先例),色值/字号/间距全部经 @eterna/ui --et-* 令牌(禁字面色值;
 * 深浅主题由令牌翻转),断点 1100/760/640(frontend-style §1-6),动效尊重
 * prefers-reduced-motion(§1-5)。
 */
import { injectDesignTokens } from '@eterna/ui'

const CSS = `
[data-eterna-workbench='root'] {
  animation: wb-fade-in var(--et-motion-base) var(--et-ease) both;
  box-sizing: border-box;
  width: 100%;
  height: 100%;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  max-width: var(--et-container-panel);
  margin: 0 auto;
  font-family: var(--et-font-body);
  font-size: var(--et-text-body);
  font-weight: var(--et-weight-body);
  line-height: var(--et-leading-body);
  color: var(--et-fg-2);
  min-width: 0;
}
/* 头部(标题/Attention 横幅/tab 条)固定不滚,正文独立滚动——滚动容器带
 * padding 会让 sticky 吸在 padding 下沿,内容从 tab 上方穿出(2026-11-19 线上
 * 实测;结构见 WorkbenchPage data-eterna-workbench=header/body)。 */
[data-eterna-workbench='header'] {
  flex: none;
  position: relative;
  z-index: 40;
  background: var(--et-bg);
  padding: var(--et-space-12) var(--et-gutter) 0;
}
[data-eterna-workbench='body'] {
  flex: 1 1 auto;
  min-height: 0;
  min-width: 0;
  overflow-y: auto;
  overflow-x: hidden;
  scrollbar-gutter: stable;
  padding: 0 var(--et-gutter) var(--et-space-24);
}
/* 盒模型:border-box 全作用域——此前 content-box 使 width:100%+gutter 内边距
 * 相加成 1208px,1440 视口下整页右切 48px(2026-11-18 视觉验收实测)。 */
[data-eterna-workbench='root'] *,
[data-eterna-workbench='root'] *::before,
[data-eterna-workbench='root'] *::after { box-sizing: border-box; }
[data-eterna-workbench='root'] * { min-width: 0; overflow-wrap: anywhere; }
[data-eterna-workbench='root'] h1, [data-eterna-workbench='root'] h2, [data-eterna-workbench='root'] h3 {
  color: var(--et-fg); font-family: var(--et-font-display); font-weight: var(--et-weight-display);
  line-height: var(--et-leading-snug); margin: 0;
}
[data-eterna-workbench='root'] h1 { font-size: var(--et-text-h2); }
[data-eterna-workbench='root'] h2 { font-size: var(--et-text-h3); }
[data-eterna-workbench='root'] h3 { font-size: var(--et-text-lead); }
[data-eterna-workbench='root'] p { margin: 0; }
[data-eterna-workbench='root'] code {
  font-family: var(--et-font-mono); font-size: 0.92em;
  background: var(--et-surface-2); padding: 0 var(--et-space-1); border-radius: var(--et-radius-sm);
}
[data-eterna-workbench-seg-mono='true'] { font-family: var(--et-font-mono); font-size: 0.92em; }
[data-eterna-workbench-num='true'] { font-variant-numeric: tabular-nums; }
[data-eterna-workbench='visually-hidden'] {
  position: absolute; width: 1px; height: 1px; margin: -1px; padding: 0;
  overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; border: 0;
}
/* focus 光圈:0 0 0 3px 强调色光环(frontend-style §1-4) */
[data-eterna-workbench='root'] a:focus-visible,
[data-eterna-workbench='root'] button:focus-visible,
[data-eterna-workbench='root'] summary:focus-visible,
[data-eterna-workbench='root'] input:focus-visible {
  outline: none;
  box-shadow: var(--et-focus-ring);
  border-radius: var(--et-radius-sm);
}

/* —— 头部与流状态 —— */
[data-eterna-workbench='toolbar'] {
  display: flex; align-items: center; justify-content: space-between;
  gap: var(--et-space-3); flex-wrap: wrap; margin-bottom: var(--et-space-5);
}
[data-eterna-workbench='toolbar-main'] {
  display: flex; align-items: center; gap: var(--et-space-3);
  flex-wrap: wrap; min-width: 0;
}
/* 「主会话」入口:标题旁的低权重点缀入口(pill;与 tab 条同词汇表,不再
 * 以浏览器原生按钮居中悬浮——2026-11-19 视觉反馈)。 */
[data-eterna-workbench='open-master'] {
  display: inline-flex; align-items: center; gap: 6px; flex: none;
  min-height: 32px; padding: 4px 12px;
  border: 1px solid var(--et-border); border-radius: var(--et-radius-pill);
  background: var(--et-surface); color: var(--et-fg-2);
  font: inherit; font-size: var(--et-text-caption); line-height: 1.4;
  white-space: nowrap; cursor: pointer;
  transition: border-color var(--et-motion-fast) var(--et-ease), color var(--et-motion-fast) var(--et-ease), background var(--et-motion-fast) var(--et-ease);
}
[data-eterna-workbench='open-master'] svg { color: var(--et-muted); flex: none; }
[data-eterna-workbench='open-master']:hover {
  border-color: var(--et-accent); color: var(--et-accent); background: var(--et-accent-soft);
}
[data-eterna-workbench='open-master']:hover svg { color: var(--et-accent); }
[data-eterna-workbench='sse-chip'] {
  display: inline-flex; align-items: center; gap: 6px;
  font-size: var(--et-text-micro); color: var(--et-success);
}
[data-eterna-workbench-sse='connecting'] { color: var(--et-muted); }
[data-eterna-workbench-sse='error'] { color: var(--et-danger); }
[data-eterna-workbench-sse='error'] [data-eterna-workbench='sse-error-message'] { font-family: var(--et-font-mono); }
[data-eterna-workbench='retry'] {
  margin-left: var(--et-space-2); padding: 0 var(--et-space-3); min-height: 28px;
  font: inherit; font-size: var(--et-text-meta); cursor: pointer;
  color: var(--et-fg-2); background: var(--et-surface);
  border: 1px solid var(--et-border); border-radius: var(--et-radius-sm);
}
[data-eterna-workbench='retry']:hover { border-color: var(--et-accent); color: var(--et-accent); }
[data-eterna-workbench='placeholder'] { color: var(--et-muted); font-size: var(--et-text-caption); padding: var(--et-space-4) 0; }

/* —— 视图骨架(view/view-head/kicker/view-desc/sub-h,原型 03)—— */
[data-eterna-workbench='view'] { scroll-margin-top: var(--et-space-12); padding-top: var(--et-space-8); }
[data-eterna-workbench='view'] + [data-eterna-workbench='view'] { margin-top: var(--et-space-8); border-top: 1px solid var(--et-border-soft); }
[data-eterna-workbench='view-head'] { display: flex; align-items: baseline; gap: var(--et-space-3); flex-wrap: wrap; }
[data-eterna-workbench='kicker'] { color: var(--et-accent); font-size: var(--et-text-meta); font-weight: var(--et-weight-emphasis); letter-spacing: var(--et-tracking-caps); }
[data-eterna-workbench='view-desc'] {
  color: var(--et-muted); font-size: var(--et-text-caption);
  max-width: 60ch; line-height: var(--et-leading-body);
  margin: var(--et-space-3) 0 var(--et-space-6);
}
[data-eterna-workbench='view-desc'] strong { color: var(--et-fg-2); }
/* v4:小节标题用 lead(17),与正文 15 拉开一档 */
[data-eterna-workbench='sub-h'] {
  font-size: var(--et-text-lead); color: var(--et-fg);
  margin: var(--et-space-7) 0 var(--et-space-4);
}
[data-eterna-workbench='view-nav'] {
  display: flex; gap: var(--et-space-2); overflow-x: auto; scrollbar-width: none;
  border-bottom: 1px solid var(--et-border-soft);
  margin: 0 calc(-1 * var(--et-gutter)); padding: var(--et-space-2) var(--et-gutter);
}
[data-eterna-workbench='view-nav']::-webkit-scrollbar { display: none; }
[data-eterna-workbench='view-nav'] a,
[data-eterna-workbench='view-nav'] [data-eterna-workbench='view-tab'] {
display: inline-flex; align-items: center; gap: 6px; white-space: nowrap; flex: none;
  min-height: 40px; padding: 0 var(--et-space-4); border-radius: var(--et-radius-pill);
  font-size: var(--et-text-body); color: var(--et-fg-2);
  background: transparent; border: none; cursor: pointer; font-family: inherit;
}
[data-eterna-workbench='view-nav'] a:hover,
[data-eterna-workbench='view-nav'] [data-eterna-workbench='view-tab']:hover { color: var(--et-accent); background: var(--et-accent-soft); text-decoration: none; }
[data-eterna-workbench='view-nav'] [data-eterna-workbench='view-tab']:focus-visible { outline: var(--et-focus-ring, 2px solid var(--et-accent)); outline-offset: 2px; }
[data-eterna-workbench='view-nav'] [data-eterna-workbench='view-tab'][data-eterna-workbench-view-active] {
  color: var(--et-accent); background: var(--et-accent-soft); font-weight: var(--et-weight-display);
}

/* —— 工具条与过滤 chip(原型 03 toolbar/chip;头部工具条见上,过滤工具条带 role=group)—— */
[data-eterna-workbench='root'] [data-eterna-workbench='toolbar'][role='group'] {
  display: flex; justify-content: flex-start; flex-wrap: wrap; align-items: center;
  gap: var(--et-space-2); margin: 0 0 var(--et-space-4);
}
[data-eterna-workbench='toolbar-label'] { font-size: var(--et-text-micro); color: var(--et-muted); margin-right: var(--et-space-1); }
[data-eterna-workbench='chip'] {
  display: inline-flex; align-items: center; gap: 5px; min-height: 40px;
  padding: 0 var(--et-space-4); border-radius: var(--et-radius-pill);
  border: 1px solid var(--et-border); background: var(--et-surface); color: var(--et-fg-2);
  font: inherit; font-size: var(--et-text-caption); cursor: pointer;
}
[data-eterna-workbench='chip']:hover { border-color: var(--et-accent); color: var(--et-accent); }
[data-eterna-workbench='chip'][data-eterna-workbench-on='true'] {
  border-color: var(--et-accent); color: var(--et-accent);
  background: var(--et-accent-soft); font-weight: var(--et-weight-display);
}
[data-eterna-workbench='log-search'] {
  /* v4 §6:输入 = surface-3 凹槽 + sm(12) + 40 高 */
  flex: none; width: 240px; margin-left: auto;
  padding: 0 var(--et-space-3); border: 1px solid var(--et-border); border-radius: var(--et-radius-sm);
  font: inherit; font-size: var(--et-text-body); background: var(--et-surface-3); color: var(--et-fg);
  height: 40px; min-height: 40px;
}
[data-eterna-workbench='log-search']:focus-visible { border-color: var(--et-accent); box-shadow: var(--et-focus-ring); }

/* —— 状态点(原型 03 全原型统一词汇表)—— */
[data-eterna-workbench='dot'] { flex: none; width: 8px; height: 8px; border-radius: 50%; display: inline-block; }
[data-eterna-workbench-dot='wait-person'] { background: var(--et-warn); }
[data-eterna-workbench-dot='working'] { background: var(--et-accent); }
[data-eterna-workbench-dot='queued'] { background: transparent; border: 2px solid var(--et-accent); }
[data-eterna-workbench-dot='idle'] { background: var(--et-meta); }
[data-eterna-workbench-dot='ready'] { background: var(--et-success); }
[data-eterna-workbench-dot='error'] { background: var(--et-danger); }
[data-eterna-workbench-dot][data-eterna-workbench-pulse='true'] { animation: wb-dot-pulse 2s var(--et-ease) infinite; }
@keyframes wb-dot-pulse {
  0% { box-shadow: 0 0 0 0 color-mix(in oklab, var(--et-warn), transparent 70%); }
  70% { box-shadow: 0 0 0 6px color-mix(in oklab, var(--et-warn), transparent 100%); }
  100% { box-shadow: 0 0 0 0 color-mix(in oklab, var(--et-warn), transparent 100%); }
}

/* —— 徽标(语义色配文字)—— */
[data-eterna-workbench='badge'] {
  display: inline-flex; align-items: center; gap: 5px; padding: 2px 10px;
  border-radius: var(--et-radius-pill); font-size: var(--et-text-meta); font-weight: var(--et-weight-emphasis);
  line-height: var(--et-leading-snug); white-space: nowrap;
}
[data-eterna-workbench-tone='accent'] { color: var(--et-accent); background: var(--et-accent-soft); }
[data-eterna-workbench-tone='success'] { color: var(--et-success); background: color-mix(in oklab, var(--et-success), transparent 90%); }
[data-eterna-workbench-tone='warn'] { color: var(--et-warn); background: color-mix(in oklab, var(--et-warn), transparent 88%); }
[data-eterna-workbench-tone='danger'] { color: var(--et-danger); background: var(--et-danger-soft); }
[data-eterna-workbench-tone='muted'] { color: var(--et-muted); background: var(--et-surface-2); border: 1px solid var(--et-border-soft); }

/* —— 看板(原型 03 kanban/kanban-col/kan-card)—— */
[data-eterna-workbench='kanban'] {
  display: grid; grid-auto-flow: column; grid-auto-columns: minmax(248px, 1fr);
  gap: var(--et-space-4); overflow-x: auto; padding-bottom: var(--et-space-2);
}
/* v4 §8:看板列 = 凹槽(无阴影),列内工单卡才是"面"(md + r1) */
[data-eterna-workbench='kanban-col'] {
  background: var(--et-surface-2); border: 1px solid var(--et-border-soft);
  border-radius: var(--et-radius-md); padding: var(--et-space-3); min-width: 0;
}
[data-eterna-workbench='kanban-col-h'] {
  display: flex; align-items: center; gap: var(--et-space-2);
  padding: var(--et-space-1) var(--et-space-1) var(--et-space-3);
  font-size: var(--et-text-caption); font-weight: var(--et-weight-display); color: var(--et-fg);
}
[data-eterna-workbench='stage-code'] { margin-left: auto; font-family: var(--et-font-mono); font-size: var(--et-text-micro); color: var(--et-meta); font-weight: var(--et-weight-body); }
/* v4 §6:计数徽标 = pill + meta(12) */
[data-eterna-workbench='count'] { flex: none; padding: 2px 10px; border-radius: var(--et-radius-pill); font-size: var(--et-text-meta); font-weight: var(--et-weight-emphasis); }
[data-eterna-workbench='count'][data-eterna-workbench-tone='warn'] { color: var(--et-warn); background: color-mix(in oklab, var(--et-warn), transparent 88%); }
[data-eterna-workbench='count'][data-eterna-workbench-tone='accent'] { color: var(--et-accent); background: var(--et-accent-soft); }
[data-eterna-workbench='count'][data-eterna-workbench-tone='muted'] { color: var(--et-muted); background: var(--et-surface); border: 1px solid var(--et-border-soft); }
[data-eterna-workbench='kan-cards'] { display: grid; gap: var(--et-space-2); }
[data-eterna-workbench='kan-card'] {
  display: grid; gap: 6px; padding: var(--et-space-4) var(--et-space-3);
  background: var(--et-surface); border: 1px solid var(--et-border-soft);
  border-radius: var(--et-radius-md); box-shadow: var(--et-shadow-r1); color: inherit;
}
[data-eterna-workbench='kan-card'][data-eterna-workbench-stuck='true'] {
  border-color: color-mix(in oklab, var(--et-warn), transparent 50%);
  box-shadow: 0 0 0 1px color-mix(in oklab, var(--et-warn), transparent 65%);
}
[data-eterna-workbench='kan-title'] { font-size: var(--et-text-body); font-weight: var(--et-weight-emphasis); line-height: var(--et-leading-snug); color: var(--et-fg); }
[data-eterna-workbench='kan-meta'] {
  font-size: var(--et-text-micro); color: var(--et-muted);
  display: flex; flex-wrap: wrap; gap: 4px 10px; align-items: center;
}

/* —— 指标卡(原型 03 metric-card/metrics)—— */
[data-eterna-workbench='metrics'] { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: var(--et-space-4); }
[data-eterna-workbench='metrics'][data-eterna-workbench-metrics-count='4'] { grid-template-columns: repeat(4, minmax(0, 1fr)); margin-bottom: var(--et-space-4); }
[data-eterna-workbench='metric-card'] {
  background: var(--et-surface); border: 1px solid var(--et-border-soft);
  border-radius: var(--et-radius-md); box-shadow: var(--et-shadow-r1); padding: var(--et-space-4);
  display: grid; gap: var(--et-space-1);
}
/* v4 §8:指标卡 = 左玉环 + 右(标签/数字);无环卡片退化为单列 */
[data-eterna-workbench='metric-face'] { display: flex; align-items: center; gap: var(--et-space-3); min-width: 0; }
[data-eterna-workbench='metric-body'] { display: grid; gap: 2px; min-width: 0; }
[data-eterna-workbench='metric-value'] {
  font-size: var(--et-text-h3); font-family: var(--et-font-display); color: var(--et-fg);
  font-variant-numeric: tabular-nums; line-height: var(--et-leading-tight);
}
[data-eterna-workbench='metric-label'] { font-size: var(--et-text-caption); color: var(--et-fg-2); font-weight: var(--et-weight-emphasis); }
[data-eterna-workbench='metric-sub'] { font-size: var(--et-text-micro); color: var(--et-muted); }
[data-eterna-workbench='metric-sub'] [data-eterna-workbench='badge'] { margin-left: var(--et-space-1); }

/* —— 日志(原型 03 log-entry/summary/log-full)—— */
[data-eterna-workbench='log-list'] { display: grid; gap: 2px; }
[data-eterna-workbench='log-entry'] {
  border: 1px solid var(--et-border-soft); border-radius: var(--et-radius-sm);
  background: var(--et-surface); overflow: hidden;
}
[data-eterna-workbench='log-entry'] > summary {
  display: flex; align-items: center; gap: var(--et-space-3);
  padding: 10px var(--et-space-4); min-height: 44px; cursor: pointer; list-style: none;
  font-size: var(--et-text-caption); color: var(--et-fg-2);
}
[data-eterna-workbench='log-entry'] > summary::-webkit-details-marker { display: none; }
[data-eterna-workbench='log-entry'] > summary:hover { background: var(--et-surface-2); }
[data-eterna-workbench='log-time'] { color: var(--et-meta); flex: none; }
[data-eterna-workbench='log-src'] { color: var(--et-fg); font-weight: var(--et-weight-display); flex: none; }
[data-eterna-workbench='log-sum'] { color: var(--et-fg-2); min-width: 0; }
[data-eterna-workbench='log-dur'] { color: var(--et-meta); margin-left: auto; flex: none; }
[data-eterna-workbench='log-entry'] .chev { color: var(--et-meta); flex: none; transition: transform var(--et-motion-fast) var(--et-ease); }
[data-eterna-workbench='log-entry'][open] .chev { transform: rotate(180deg); }
[data-eterna-workbench='log-full'] {
  border-top: 1px solid var(--et-border-soft); background: var(--et-surface-2);
  padding: var(--et-space-3) var(--et-space-4); display: grid; gap: var(--et-space-2);
  font-size: var(--et-text-caption); color: var(--et-fg-2);
}
[data-eterna-workbench='log-full'] p { color: var(--et-fg-2); }

/* —— 图表(原型 03 charts/chart-card/chart-svg)—— */
[data-eterna-workbench='charts'] { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: var(--et-space-4); }
[data-eterna-workbench='chart-card'] {
  background: var(--et-surface); border: 1px solid var(--et-border-soft);
  border-radius: var(--et-radius-md); box-shadow: var(--et-shadow-r1); padding: var(--et-space-4);
}
[data-eterna-workbench='chart-title'] {
  font-size: var(--et-text-caption); color: var(--et-fg);
  font-family: var(--et-font-display); font-weight: var(--et-weight-display); margin-bottom: var(--et-space-3);
}
[data-eterna-workbench='chart-svg'] { width: 100%; height: auto; display: block; }
[data-eterna-workbench='chart-svg'] text { font-family: var(--et-font-body); font-size: var(--et-text-micro); }
[data-eterna-workbench='chart-lbl'] { fill: var(--et-meta); }
[data-eterna-workbench='chart-grid'] { stroke: var(--et-border-soft); stroke-width: 1; }
[data-eterna-workbench='chart-axis'] { stroke: var(--et-border); stroke-width: 1; }
[data-eterna-workbench='chart-series'] { fill: none; stroke: var(--et-accent); stroke-width: 2; }
[data-eterna-workbench='chart-pt'] { fill: var(--et-accent); }
[data-eterna-workbench='chart-pt'][data-eterna-workbench-warn='true'] { fill: var(--et-warn); }
[data-eterna-workbench='chart-gate'] { stroke: var(--et-warn); stroke-width: 1.5; stroke-dasharray: 5 4; }
[data-eterna-workbench='chart-gate-lbl'] { fill: var(--et-warn); }
[data-eterna-workbench='chart-note'] { color: var(--et-muted); font-size: var(--et-text-micro); margin-top: var(--et-space-2); }

/* —— 响应式:1100/760/640(frontend-style §1-6;640 = 移动端可用性承接)—— */
@media (max-width: 1100px) {
  [data-eterna-workbench='header'] { padding-top: var(--et-space-6); }
  [data-eterna-workbench='root'] h1 { font-size: var(--et-text-h3); }
  [data-eterna-workbench='metrics'][data-eterna-workbench-metrics-count='4'] { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  [data-eterna-workbench='charts'] { grid-template-columns: 1fr; }
  [data-eterna-workbench='log-search'] { width: 180px; }
}
@media (max-width: 760px) {
  [data-eterna-workbench='header'] { padding-top: var(--et-space-5); }
  [data-eterna-workbench='root'] h1 { font-size: var(--et-text-lead); }
  [data-eterna-workbench='root'] h2 { font-size: var(--et-text-lead); }
  [data-eterna-workbench='metrics'], [data-eterna-workbench='metrics'][data-eterna-workbench-metrics-count='4'] { grid-template-columns: 1fr; }
  [data-eterna-workbench='log-search'] { margin-left: 0; width: 100%; }
  [data-eterna-workbench='log-entry'] > summary { flex-wrap: wrap; row-gap: 4px; }
  [data-eterna-workbench='log-dur'] { margin-left: 0; }
  [data-eterna-workbench='sse-chip'] { width: 100%; }
}
@media (max-width: 640px) {
  [data-eterna-workbench='header'] { padding: var(--et-space-5) var(--et-space-4) 0; }
  [data-eterna-workbench='body'] { padding: 0 var(--et-space-4) var(--et-space-8); }
  [data-eterna-workbench='view-nav'] { margin: 0 calc(-1 * var(--et-space-4)); padding-left: var(--et-space-4); padding-right: var(--et-space-4); }
  [data-eterna-workbench='view-desc'] { max-width: none; }
  [data-eterna-workbench='kanban'] { grid-auto-columns: minmax(232px, 82vw); }
  [data-eterna-workbench='toolbar'][role='group'] [data-eterna-workbench='chip'] { flex: 1 1 auto; justify-content: center; }
}

/* —— 动效尊重(frontend-style §1-5)—— */
@media (prefers-reduced-motion: reduce) {
  [data-eterna-workbench='root'], [data-eterna-workbench='root'] * {
    animation: none !important; transition: none !important; scroll-behavior: auto !important;
  }
}
@keyframes wb-fade-in { from { opacity: 0; transform: translateY(4px); } to { opacity: 1; transform: none; } }

/* —— 视图二 信息流实时图(原型 03 视图二 + 原型 04;a11y 旁挂列表 = 30 号 §7-1③)—— */
[data-eterna-workbench='btn-secondary'] {
  display: inline-flex; align-items: center; justify-content: center; gap: 6px;
  min-height: 36px; padding: 8px var(--et-space-4); border-radius: var(--et-radius-sm);
  border: 1px solid var(--et-border); background: var(--et-surface); color: var(--et-fg-2);
  font: inherit; font-size: var(--et-text-caption); cursor: pointer;
  transition: border-color var(--et-motion-fast) var(--et-ease), color var(--et-motion-fast) var(--et-ease);
}
[data-eterna-workbench='btn-secondary']:hover { border-color: var(--et-accent); color: var(--et-accent); }
[data-eterna-workbench='btn-secondary']:disabled { opacity: 0.5; cursor: not-allowed; }
[data-eterna-workbench='btn'] {
  display: inline-flex; align-items: center; justify-content: center; gap: 6px;
  min-height: 32px; padding: 4px 10px; border-radius: var(--et-radius-sm);
  border: 1px solid var(--et-border); background: var(--et-surface); color: var(--et-fg-2);
  font: inherit; font-size: var(--et-text-micro); cursor: pointer; white-space: nowrap;
}
[data-eterna-workbench='btn']:hover { border-color: var(--et-accent); color: var(--et-accent); }
[data-eterna-workbench='btn-ghost'] {
  display: inline-flex; align-items: center; gap: 6px; min-height: 32px; padding: 4px 10px;
  border-radius: var(--et-radius-sm); color: var(--et-muted); font: inherit;
  font-size: var(--et-text-micro); white-space: nowrap;
}
[data-eterna-workbench='btn-ghost']:hover { color: var(--et-accent); background: var(--et-accent-soft); text-decoration: none; }
[data-eterna-workbench='replay-label'] { font-size: var(--et-text-caption); color: var(--et-muted); margin-left: var(--et-space-3); }
/* 暂停/继续双态:按下 = 强调底 + 强调字(此前 aria-pressed 无任何视觉反馈,
 * 叠加空场景无流动边,线上表现为「暂停按钮没效果」)。 */
[data-eterna-workbench-flow='pause'][aria-pressed='true'] {
  border-color: var(--et-accent); color: var(--et-accent); background: var(--et-accent-soft);
}
/* 回放选择器(details 披露控件;替代原生 select 的系统灰底控件与系统弹层)。 */
[data-eterna-workbench='replay-picker'] { position: relative; display: inline-flex; }
[data-eterna-workbench='replay-select'] {
  display: inline-flex; align-items: center; justify-content: space-between; gap: var(--et-space-2);
  min-height: 36px; padding: 8px 12px; min-width: 220px; max-width: min(360px, 100%);
  border: 1px solid var(--et-border); border-radius: var(--et-radius-sm);
  background: var(--et-surface); color: var(--et-fg);
  font: inherit; font-size: var(--et-text-caption); line-height: 1.4;
  cursor: pointer; list-style: none; user-select: none;
  transition: border-color var(--et-motion-fast) var(--et-ease), color var(--et-motion-fast) var(--et-ease);
}
[data-eterna-workbench='replay-select']::-webkit-details-marker { display: none; }
[data-eterna-workbench='replay-select']:focus-visible {
  outline: none; box-shadow: var(--et-focus-ring); border-color: var(--et-accent);
}
[data-eterna-workbench='replay-select'] svg {
  color: var(--et-meta); flex: none;
  transition: transform var(--et-motion-fast) var(--et-ease);
}
[data-eterna-workbench='replay-picker'][open] > [data-eterna-workbench='replay-select'] {
  border-color: var(--et-accent); color: var(--et-accent);
}
[data-eterna-workbench='replay-picker'][open] > [data-eterna-workbench='replay-select'] svg {
  color: var(--et-accent); transform: rotate(180deg);
}
[data-eterna-workbench='replay-value'] { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
/* 空态(无可回放工单):不可展开的禁用占位,不再弹系统菜单。 */
[data-eterna-workbench='replay-select'][data-eterna-workbench-disabled='true'] {
  min-width: 220px; border-style: dashed;
  background: var(--et-surface-2); color: var(--et-muted); cursor: default;
}
[data-eterna-workbench='replay-backdrop'] { position: fixed; inset: 0; z-index: 39; display: block; }
[data-eterna-workbench='replay-picker']:not([open]) > [data-eterna-workbench='replay-backdrop'] { display: none; }
[data-eterna-workbench='replay-menu'] {
  position: absolute; top: calc(100% + 6px); left: 0; z-index: 40;
  min-width: 100%; width: max-content; max-width: min(420px, 92vw);
  margin: 0; padding: var(--et-space-1); list-style: none;
  background: var(--et-surface); border: 1px solid var(--et-border-soft);
  border-radius: var(--et-radius-md); box-shadow: var(--et-shadow-r2);
}
[data-eterna-workbench='replay-option'] {
  display: flex; align-items: center; gap: var(--et-space-2); width: 100%;
  padding: 8px 10px; border: none; border-radius: var(--et-radius-sm);
  background: none; color: var(--et-fg-2); font: inherit; font-size: var(--et-text-caption);
  text-align: left; cursor: pointer; white-space: nowrap;
}
[data-eterna-workbench='replay-option'] svg { color: var(--et-meta); flex: none; }
[data-eterna-workbench='replay-option']:hover,
[data-eterna-workbench='replay-option']:focus-visible {
  outline: none; background: var(--et-accent-soft); color: var(--et-accent);
}
[data-eterna-workbench='replay-option'][data-eterna-workbench-selected='true'] { color: var(--et-accent); font-weight: 600; }
[data-eterna-workbench='replay-option'][data-eterna-workbench-selected='true'] svg { color: var(--et-accent); }
[data-eterna-workbench='graph-wrap'] {
  border: 1px solid var(--et-border-soft); border-radius: var(--et-radius-sm);
  background: var(--et-surface); padding: var(--et-space-4); overflow-x: auto;
}
[data-eterna-workbench='flow-canvas'] { display: block; width: 100%; min-width: 640px; height: auto; }
[data-eterna-workbench='legend'] {
  list-style: none; display: grid;
  grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
  gap: var(--et-space-2) var(--et-space-4); font-size: var(--et-text-caption); color: var(--et-muted);
}
[data-eterna-workbench='legend-item'] { display: flex; align-items: center; gap: var(--et-space-2); }
[data-eterna-workbench='legend-swatch'] {
  flex: none; width: 18px; height: 12px; border-radius: var(--et-radius-sm);
  border: 1.5px solid var(--et-border); display: inline-block;
}
[data-eterna-workbench-swatch='active'] { border-color: var(--et-accent); background: color-mix(in oklab, var(--et-accent), transparent 92%); }
[data-eterna-workbench-swatch='stuck'] { border-color: var(--et-warn); background: color-mix(in oklab, var(--et-warn), transparent 88%); }
[data-eterna-workbench-swatch='error'] { border-color: var(--et-danger); background: var(--et-danger-soft); }
[data-eterna-workbench-swatch='edge'] { width: 18px; height: 0; border-top: 2px solid var(--et-meta); border-radius: 0; background: none; }
[data-eterna-workbench-swatch='edge-live'] {
  width: 18px; height: 0; border-radius: 0; background: none;
  border-top: 2px dashed var(--et-accent);
}
[data-eterna-workbench-swatch='replay'] { width: 18px; height: 0; border-radius: 0; background: none; border-top: 3px solid var(--et-accent); }

/* —— a11y 旁挂等价列表(原型 04;30 号 §7-1③ 键盘/读屏走列表不走画布)—— */
[data-eterna-workbench='announce'] {
  position: absolute; width: 1px; height: 1px; margin: -1px; padding: 0;
  overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; border: 0;
}
[data-eterna-workbench='a11y-section'] { margin-top: var(--et-space-8); padding-top: var(--et-space-6); border-top: 1px solid var(--et-border-soft); }
[data-eterna-workbench='a11y-head'] { display: flex; align-items: baseline; gap: var(--et-space-3); flex-wrap: wrap; }
[data-eterna-workbench='a11y-desc'] {
  color: var(--et-muted); font-size: var(--et-text-caption); max-width: 80ch;
  margin: var(--et-space-2) 0 var(--et-space-4);
}
[data-eterna-workbench='ticket-link'] {
  display: inline-flex; align-items: center; gap: var(--et-space-2); flex-wrap: wrap;
  color: var(--et-fg); font-weight: var(--et-weight-display);
}
[data-eterna-workbench='ticket-link']:hover { color: var(--et-accent); }
[data-eterna-workbench='ticket-link'] + [data-eterna-workbench='badge'] { margin-left: var(--et-space-2); }
tbody [data-eterna-workbench='ticket-row'][data-eterna-workbench-stuck='true'] {
  background: color-mix(in oklab, var(--et-warn), transparent 94%);
}
tbody [data-eterna-workbench='ticket-row'][data-eterna-workbench-stuck='true']:hover {
  background: color-mix(in oklab, var(--et-warn), transparent 90%);
}
[data-eterna-workbench='row-actions'] { display: flex; gap: var(--et-space-2); white-space: nowrap; }
[data-eterna-workbench='node-list'] { list-style: none; display: grid; gap: var(--et-space-2); }
[data-eterna-workbench='node-item'] {
  border: 1px solid var(--et-border-soft); border-radius: var(--et-radius-sm);
  background: var(--et-surface); padding: var(--et-space-3) var(--et-space-4);
}
[data-eterna-workbench='node-item'][data-eterna-workbench-stuck='true'] {
  border-color: color-mix(in oklab, var(--et-warn), transparent 50%);
  box-shadow: 0 0 0 1px color-mix(in oklab, var(--et-warn), transparent 65%);
}
[data-eterna-workbench='node-item-head'] { display: flex; align-items: center; gap: var(--et-space-3); flex-wrap: wrap; }
[data-eterna-workbench='node-order'] {
  width: 24px; height: 24px; border-radius: 50%; flex: none;
  border: 1px solid var(--et-border); display: grid; place-items: center;
  font-size: var(--et-text-micro); color: var(--et-muted);
}
[data-eterna-workbench='node-name'] { font-size: var(--et-text-caption); margin: 0; color: var(--et-fg); font-family: var(--et-font-display); font-weight: var(--et-weight-display); }
[data-eterna-workbench='node-stat'] { color: var(--et-muted); font-size: var(--et-text-caption); margin-left: auto; }
[data-eterna-workbench='node-item'] > details { margin-top: var(--et-space-2); }
[data-eterna-workbench='node-item'] > details > summary {
  display: inline-flex; align-items: center; gap: 6px; min-height: 36px; cursor: pointer;
  color: var(--et-muted); font-size: var(--et-text-caption); border-radius: var(--et-radius-sm);
  padding: 4px 8px; margin-left: -8px; list-style: none;
}
[data-eterna-workbench='node-item'] > details > summary::-webkit-details-marker { display: none; }
[data-eterna-workbench='node-item'] > details > summary:hover { color: var(--et-accent); background: var(--et-accent-soft); }
[data-eterna-workbench='event-list'] {
  list-style: none; margin-top: var(--et-space-1);
  border-left: 2px solid var(--et-border-soft); padding-left: var(--et-space-3);
  display: grid; gap: var(--et-space-1); font-size: var(--et-text-caption); color: var(--et-fg-2);
}

/* —— 视图五 worker 检查器(原型 03 #v5)—— */
[data-eterna-workbench='inspector-head'] {
  display: flex; align-items: center; gap: var(--et-space-4); flex-wrap: wrap; margin-bottom: var(--et-space-4);
  background: var(--et-surface); border: 1px solid var(--et-border-soft);
  border-radius: var(--et-radius-sm); padding: var(--et-space-4);
}
[data-eterna-workbench='inspector-title'] {
  display: flex; align-items: center; gap: var(--et-space-2); color: var(--et-fg);
  font-weight: var(--et-weight-display); font-size: var(--et-text-body);
}
[data-eterna-workbench='inspector-meta'] {
  list-style: none; display: flex; flex-wrap: wrap; gap: var(--et-space-1) var(--et-space-5);
  color: var(--et-muted); font-size: var(--et-text-caption); margin-left: auto;
}
[data-eterna-workbench='inspector'] {
  display: grid; grid-template-columns: minmax(280px, 5fr) minmax(320px, 7fr);
  gap: var(--et-space-5); align-items: start;
}
[data-eterna-workbench='inspector-col'] { display: grid; gap: 0; min-width: 0; }
[data-eterna-workbench='tree'], [data-eterna-workbench='tree'] ul { list-style: none; margin: 0; padding: 0; }
[data-eterna-workbench='tree'] ul { margin-left: 14px; padding-left: 20px; position: relative; }
[data-eterna-workbench='tree'] ul::before {
  content: ''; position: absolute; left: 0; top: -4px; bottom: 14px; border-left: 1px solid var(--et-border);
}
[data-eterna-workbench='tree'] li { position: relative; padding: 4px 0; }
[data-eterna-workbench='tree'] ul > li::before {
  content: ''; position: absolute; left: -20px; top: 18px; width: 16px; border-top: 1px solid var(--et-border);
}
[data-eterna-workbench='tree'] ul > li:last-child::after {
  content: ''; position: absolute; left: -21px; top: 19px; bottom: -4px; background: var(--et-bg); width: 3px;
}
[data-eterna-workbench='tree-node'] {
  display: inline-flex; align-items: center; gap: var(--et-space-2); flex-wrap: wrap;
  padding: 6px 10px; border: 1px solid var(--et-border-soft); border-radius: var(--et-radius-sm);
  background: var(--et-surface); font-size: var(--et-text-caption); color: var(--et-fg);
}
[data-eterna-workbench='tree-role'] { color: var(--et-muted); font-size: var(--et-text-micro); }
[data-eterna-workbench='tree-node'][data-eterna-workbench-current='true'] {
  border-color: var(--et-accent); background: var(--et-accent-soft);
}
[data-eterna-workbench='tree-note'] { color: var(--et-muted); font-size: var(--et-text-micro); margin-top: var(--et-space-3); }
[data-eterna-workbench='job-list'] { list-style: none; display: grid; gap: var(--et-space-2); }
[data-eterna-workbench='job-item'] {
  display: flex; gap: 10px; align-items: flex-start;
  border: 1px solid var(--et-border-soft); border-radius: var(--et-radius-sm);
  background: var(--et-surface); padding: 10px var(--et-space-3);
}
[data-eterna-workbench='job-item'] > [data-eterna-workbench='dot'] { margin-top: 6px; }
[data-eterna-workbench='job-body'] { display: grid; gap: 2px; }
[data-eterna-workbench='job-name'] { color: var(--et-fg); font-size: var(--et-text-caption); font-weight: var(--et-weight-display); }
[data-eterna-workbench='job-meta'] { color: var(--et-muted); font-size: var(--et-text-micro); }
[data-eterna-workbench='jobs-done'] { margin-top: var(--et-space-2); }
[data-eterna-workbench='jobs-done'] > summary {
  display: flex; align-items: center; gap: 6px; color: var(--et-muted);
  font-size: var(--et-text-caption); padding: 6px 0; min-height: 36px; cursor: pointer; list-style: none;
}
[data-eterna-workbench='jobs-done'] > summary::-webkit-details-marker { display: none; }
[data-eterna-workbench='jobs-done'] > summary:hover { color: var(--et-accent); }
[data-eterna-workbench='jobs-done'] [data-eterna-workbench='job-list'] { margin-top: var(--et-space-2); }
[data-eterna-workbench='stat-grid'] { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: var(--et-space-3); }
[data-eterna-workbench='stat-card'] {
  background: var(--et-surface); border: 1px solid var(--et-border-soft);
  border-radius: var(--et-radius-sm); padding: var(--et-space-4); display: grid; gap: var(--et-space-3);
}
[data-eterna-workbench='meter-wrap'] { position: relative; }
[data-eterna-workbench='meter'] {
  height: 8px; border-radius: var(--et-radius-pill); background: var(--et-surface-2);
  border: 1px solid var(--et-border-soft); overflow: hidden; position: relative; margin: 0;
}
[data-eterna-workbench='meter-fill'] { display: block; height: 100%; background: var(--et-accent); border-radius: var(--et-radius-pill); }
[data-eterna-workbench='meter-threshold'] {
  position: absolute; top: -3px; bottom: -3px; width: 2px; background: var(--et-danger);
}

/* —— 新增面响应式:1100/760/640(frontend-style §1-6)—— */
@media (max-width: 1100px) {
  [data-eterna-workbench='node-stat'] { margin-left: 0; width: 100%; }
  [data-eterna-workbench='inspector'] { grid-template-columns: 1fr; }
}
@media (max-width: 760px) {
  [data-eterna-workbench='row-actions'] { flex-direction: column; align-items: stretch; }
  [data-eterna-workbench='row-actions'] [data-eterna-workbench='btn'],
  [data-eterna-workbench='row-actions'] [data-eterna-workbench='btn-ghost'] { width: 100%; }
  [data-eterna-workbench='replay-label'] { margin-left: 0; width: 100%; }
  [data-eterna-workbench='replay-picker'] { flex: 1 1 220px; max-width: 100%; }
  [data-eterna-workbench='replay-select'] { width: 100%; max-width: none; }
  [data-eterna-workbench='inspector-meta'] { margin-left: 0; }
}
@media (max-width: 640px) {
  [data-eterna-workbench='node-item'] { padding: var(--et-space-3); }
  [data-eterna-workbench='node-item-head'] { gap: var(--et-space-2); }
  [data-eterna-workbench='stat-grid'] { grid-template-columns: 1fr; }
}

/* —— 会话侧任务侧栏(38 号 T6;原型 01 side-panel/task-group/task-item 逐字翻译)—— */
[data-eterna-workbench='chat-shell'] {
  display: grid; grid-template-columns: minmax(300px, 360px) minmax(0, 1fr);
  gap: var(--et-space-6); align-items: start;
}
[data-eterna-workbench='side-panel'] { position: sticky; top: var(--et-space-8); }
[data-eterna-workbench='side-panel'] {
  background: var(--et-surface); border: 1px solid var(--et-border-soft);
  border-radius: var(--et-radius-sm); overflow: hidden; display: block;
}
[data-eterna-workbench='side-section'] { padding: var(--et-space-4); display: block; }
[data-eterna-workbench='side-section'] + [data-eterna-workbench='side-section'] { border-top: 1px solid var(--et-border-soft); }
[data-eterna-workbench='side-h'] {
  display: flex; align-items: center; justify-content: space-between;
  margin-bottom: var(--et-space-3);
}
[data-eterna-workbench='side-h'] h2 { font-size: var(--et-text-caption); margin: 0; }
[data-eterna-workbench='session-list'] { list-style: none; margin: 0; padding: 0; display: grid; gap: 2px; }
[data-eterna-workbench='session-row'] {
  display: flex; gap: var(--et-space-2); align-items: center; width: 100%;
  padding: 8px 10px; border-radius: var(--et-radius-sm); border: none; background: none;
  color: var(--et-fg-2); font: inherit; font-size: var(--et-text-caption); text-align: left; cursor: pointer;
}
[data-eterna-workbench='session-row']:hover { background: var(--et-surface-2); color: var(--et-fg); }
[data-eterna-workbench='session-row'][data-eterna-workbench-active='true'] {
  background: var(--et-accent-soft); color: var(--et-accent); font-weight: var(--et-weight-display);
}
[data-eterna-workbench='task-group'] { margin-top: var(--et-space-5); }
[data-eterna-workbench='task-group']:first-of-type { margin-top: 0; }
[data-eterna-workbench='task-group-h'] {
  display: flex; align-items: center; gap: var(--et-space-2); margin: 0;
  font-size: var(--et-text-micro); color: var(--et-muted); font-weight: var(--et-weight-display);
  padding-bottom: var(--et-space-2);
}
[data-eterna-workbench='task-list'] { list-style: none; margin: 0; padding: 0; display: grid; gap: 2px; }
[data-eterna-workbench='task-item'] {
  display: flex; gap: 10px; align-items: flex-start; width: 100%;
  padding: 10px; border-radius: var(--et-radius-sm);
  border: 1px solid transparent; color: inherit; font: inherit; background: none;
  text-align: left; cursor: pointer;
}
[data-eterna-workbench='task-item']:hover { background: var(--et-surface-2); }
[data-eterna-workbench='task-item'][data-eterna-workbench-active='true'] {
  border-color: var(--et-accent); background: var(--et-accent-soft);
}
[data-eterna-workbench='task-item'] > [data-eterna-workbench='dot'] { margin-top: 6px; }
[data-eterna-workbench='task-item'] .chev, [data-eterna-workbench='task-item'] > svg:last-child { margin-left: auto; align-self: center; color: var(--et-meta); flex: none; }
[data-eterna-workbench='t-body'] { display: grid; gap: 2px; min-width: 0; flex: 1; }
[data-eterna-workbench='t-title'] { color: var(--et-fg); font-size: var(--et-text-caption); font-weight: var(--et-weight-display); }
[data-eterna-workbench='t-meta'] {
  color: var(--et-muted); font-size: var(--et-text-micro);
  display: flex; flex-wrap: wrap; gap: 2px 10px;
}

/* —— 报告时间线(38 号 T6/S-4;原型 01 chat-panel/msg/ask-card/result-card 逐字翻译)—— */
[data-eterna-workbench='ticket-timeline'] {
  background: var(--et-surface); border: 1px solid var(--et-border-soft);
  border-radius: var(--et-radius-sm); overflow: hidden; min-width: 0;
  min-height: 320px; display: flex; flex-direction: column;
}
[data-eterna-workbench='ticket-timeline'] [data-eterna-workbench='chat-body'] { flex: 1; }
[data-eterna-workbench='chat-head'] {
  display: flex; align-items: center; justify-content: space-between; gap: var(--et-space-4); flex-wrap: wrap;
  padding: var(--et-space-4); border-bottom: 1px solid var(--et-border-soft);
}
[data-eterna-workbench='chat-head'] h2 { font-size: var(--et-text-body); margin: 0; }
[data-eterna-workbench='chat-sub'] { color: var(--et-muted); font-size: var(--et-text-micro); margin-top: 2px; }
[data-eterna-workbench='chat-body'] { padding: var(--et-space-5); display: grid; gap: var(--et-space-5); }
[data-eterna-workbench='chat-body'] [data-eterna-workbench='btn'],
[data-eterna-workbench='chat-body'] [data-eterna-workbench='btn-secondary'] {
  min-height: 36px; padding: 8px var(--et-space-4); font-size: var(--et-text-caption);
}
[data-eterna-workbench='msg'] { display: grid; gap: 6px; max-width: 76ch; }
[data-eterna-workbench='who'] {
  font-size: var(--et-text-micro); color: var(--et-meta);
  display: flex; gap: 6px; align-items: center; margin: 0;
}
[data-eterna-workbench='who'] svg { color: var(--et-muted); flex: none; }
[data-eterna-workbench='bubble'] {
  border-radius: var(--et-radius-sm); padding: var(--et-space-3) var(--et-space-4);
  color: var(--et-fg-2); display: grid; gap: var(--et-space-2);
}
[data-eterna-workbench='msg'][data-eterna-workbench-side='user'] [data-eterna-workbench='bubble'] { background: var(--et-accent-soft); }
[data-eterna-workbench='msg'][data-eterna-workbench-side='agent'] [data-eterna-workbench='bubble'] { background: var(--et-surface-2); }
[data-eterna-workbench='sysline'] {
  display: flex; align-items: center; gap: var(--et-space-3);
  color: var(--et-meta); font-size: var(--et-text-micro); margin: 0;
}
[data-eterna-workbench='sysline']::before, [data-eterna-workbench='sysline']::after {
  content: ''; height: 1px; background: var(--et-border-soft); flex: 1;
}
[data-eterna-workbench='file-row'] { list-style: none; display: flex; flex-wrap: wrap; gap: var(--et-space-2); margin: 0; padding: 0; }
[data-eterna-workbench='file-chip'] {
  display: inline-flex; align-items: center; gap: var(--et-space-2);
  padding: 6px 10px; border: 1px solid var(--et-border-soft); border-radius: var(--et-radius-sm);
  background: var(--et-surface); font-size: var(--et-text-caption); color: var(--et-fg-2);
}
[data-eterna-workbench='file-meta'] { color: var(--et-meta); font-size: var(--et-text-micro); }
/* 会话内 Attention 单问卡(原型 01 ask-card;一次一问) */
[data-eterna-workbench='ask-card'] {
  border: 1px solid color-mix(in oklab, var(--et-warn), transparent 60%);
  border-left: 3px solid var(--et-warn);
  background: color-mix(in oklab, var(--et-warn), transparent 95%);
  border-radius: var(--et-radius-sm);
  padding: var(--et-space-4); display: grid; gap: var(--et-space-3);
}
[data-eterna-workbench='ask-title'] {
  display: flex; align-items: center; gap: var(--et-space-2);
  color: var(--et-warn); font-weight: var(--et-weight-display); font-size: var(--et-text-caption); margin: 0;
}
[data-eterna-workbench='ask-q'] { color: var(--et-fg); font-size: var(--et-text-body); font-weight: var(--et-weight-display); margin: 0; }
[data-eterna-workbench='reply-row'] { display: flex; gap: var(--et-space-2); }
[data-eterna-workbench='reply-input'], [data-eterna-workbench='reject-input'], [data-eterna-workbench='supplement-input'] {
  flex: 1; min-width: 0;
  padding: 8px 12px; border: 1px solid var(--et-border); border-radius: var(--et-radius-sm);
  font: inherit; font-size: var(--et-text-caption); background: var(--et-surface); color: var(--et-fg);
  min-height: 36px;
}
[data-eterna-workbench='reply-input']:focus-visible,
[data-eterna-workbench='reject-input']:focus-visible,
[data-eterna-workbench='supplement-input']:focus-visible { border-color: var(--et-accent); box-shadow: var(--et-focus-ring); }
/* 提交回答/验收通过 = .btn 实心主操作(原型一;共享 'btn' 锚点为 T9 描边样式,
 * 以作用域规则给实心令牌,不改共享块影响 FlowCanvas——theme-state-points.json
 * ask-card/result-actions anchorChecks 同款口径)。hover 提亮经块内自定义属性
 * 引用 --et-accent-fill-hover,仍为本块声明(非注释占位)。 */
[data-eterna-workbench='reply-row'] [data-eterna-workbench='btn'] {
  --wb-btn-hover: var(--et-accent-fill-hover);
  background: var(--et-accent-fill); color: var(--et-accent-on); border-color: transparent;
}
[data-eterna-workbench='reply-row'] [data-eterna-workbench='btn']:hover { background: var(--wb-btn-hover); }
[data-eterna-workbench='result-actions'] [data-eterna-workbench='btn'] {
  --wb-btn-hover: var(--et-accent-fill-hover);
  background: var(--et-accent-fill); color: var(--et-accent-on); border-color: transparent;
}
[data-eterna-workbench='result-actions'] [data-eterna-workbench='btn']:hover { background: var(--wb-btn-hover); }
[data-eterna-workbench='ask-foot'] {
  display: flex; align-items: center; gap: 6px;
  color: var(--et-muted); font-size: var(--et-text-micro); margin: 0;
}
[data-eterna-workbench='ask-foot'] svg { color: var(--et-warn); flex: none; }
/* 结果卡(原型 01 result-card;Outbox 发回原对话,验收/退回在卡上) */
[data-eterna-workbench='result-card'] {
  border: 1px solid var(--et-border); border-radius: var(--et-radius-sm);
  overflow: hidden; background: var(--et-surface);
}
[data-eterna-workbench='result-head'] {
  display: flex; align-items: center; gap: var(--et-space-2); margin: 0;
  padding: var(--et-space-3) var(--et-space-4); background: var(--et-surface-2);
  font-weight: var(--et-weight-display); color: var(--et-fg); font-size: var(--et-text-caption);
}
[data-eterna-workbench='result-head'] svg { color: var(--et-success); flex: none; }
[data-eterna-workbench='result-body'] { padding: var(--et-space-4); display: grid; gap: var(--et-space-3); }
[data-eterna-workbench='result-summary'] {
  list-style: none; display: grid; gap: var(--et-space-1); color: var(--et-fg-2);
  font-size: var(--et-text-caption); margin: 0; padding-left: var(--et-space-4);
}
[data-eterna-workbench='result-actions'] { display: flex; flex-wrap: wrap; gap: var(--et-space-3); }
[data-eterna-workbench='chat-foot'] {
  padding: var(--et-space-3) var(--et-space-4); border-top: 1px solid var(--et-border-soft);
  color: var(--et-meta); font-size: var(--et-text-micro);
}

/* —— Attention 站内横幅(38 号 T7;原型 02 attn-banner/countdown/actions 逐字翻译)—— */
[data-eterna-workbench='attn-banner'] {
  border: 1px solid color-mix(in oklab, var(--et-warn), transparent 55%);
  border-left: 3px solid var(--et-warn);
  border-radius: var(--et-radius-sm);
  background: var(--et-surface);
  padding: var(--et-space-5);
  display: grid; gap: var(--et-space-3);
  margin-bottom: var(--et-space-4);
}
[data-eterna-workbench='attn-banner'][data-eterna-workbench-stage='urgent'] {
  border-left-width: 4px;
  border-color: color-mix(in oklab, var(--et-warn), transparent 35%);
}
[data-eterna-workbench='attn-banner'][data-eterna-workbench-stage='escalated'] {
  border-left-color: var(--et-danger);
  border-color: color-mix(in oklab, var(--et-danger), transparent 55%);
}
[data-eterna-workbench='attn-top'] { display: flex; align-items: center; gap: var(--et-space-2); flex-wrap: wrap; }
[data-eterna-workbench='countdown'] {
  display: inline-flex; align-items: center; gap: 6px;
  font-variant-numeric: tabular-nums; font-weight: var(--et-weight-display);
  color: var(--et-warn); background: color-mix(in oklab, var(--et-warn), transparent 88%);
  border-radius: var(--et-radius-pill); padding: 2px 10px; font-size: var(--et-text-micro);
  margin-left: auto;
}
[data-eterna-workbench='countdown'][data-eterna-workbench-countdown='urgent'] { color: var(--et-surface); background: var(--et-warn); }
[data-eterna-workbench='countdown'][data-eterna-workbench-countdown='escalated'] { color: var(--et-surface); background: var(--et-danger); }
[data-eterna-workbench='attn-q'] {
  font-size: var(--et-text-lead); color: var(--et-fg); font-weight: var(--et-weight-display);
  font-family: var(--et-font-display); margin: 0;
}
[data-eterna-workbench='attn-meta'] {
  display: flex; flex-wrap: wrap; gap: 6px var(--et-space-4);
  color: var(--et-muted); font-size: var(--et-text-caption); margin: 0;
}
[data-eterna-workbench='attn-context'] { color: var(--et-fg-2); font-size: var(--et-text-caption); margin: 0; }
[data-eterna-workbench='attn-actions'] { display: flex; flex-wrap: wrap; gap: var(--et-space-3); align-items: center; }
[data-eterna-workbench='attn-btn'] {
  display: inline-flex; align-items: center; justify-content: center; gap: 6px;
  min-height: 36px; padding: 8px var(--et-space-4); border-radius: var(--et-radius-sm);
  border: 1px solid transparent; background: var(--et-accent-fill); color: var(--et-accent-on);
  font: inherit; font-size: var(--et-text-caption); cursor: pointer;
  transition: background var(--et-motion-fast) var(--et-ease), border-color var(--et-motion-fast) var(--et-ease), color var(--et-motion-fast) var(--et-ease);
}
[data-eterna-workbench='attn-btn']:hover { background: var(--et-accent-fill-hover); }
[data-eterna-workbench='attn-btn-secondary'] {
  display: inline-flex; align-items: center; gap: 6px;
  min-height: 36px; padding: 8px var(--et-space-4); border-radius: var(--et-radius-sm);
  border: 1px solid var(--et-border); background: var(--et-surface); color: var(--et-fg-2);
  font: inherit; font-size: var(--et-text-caption); cursor: pointer;
}
[data-eterna-workbench='attn-btn-secondary']:hover { border-color: var(--et-accent); color: var(--et-accent); }
[data-eterna-workbench='attn-btn-danger'] {
  display: inline-flex; align-items: center; gap: 6px;
  min-height: 36px; padding: 8px var(--et-space-4); border-radius: var(--et-radius-sm);
  border: none; background: transparent; color: var(--et-danger);
  font: inherit; font-size: var(--et-text-caption); cursor: pointer;
}
[data-eterna-workbench='attn-btn-danger']:hover { background: var(--et-danger-soft); }
[data-eterna-workbench='attn-btn-ghost'] {
  display: inline-flex; align-items: center; gap: 6px;
  min-height: 36px; padding: 8px var(--et-space-4); border-radius: var(--et-radius-sm);
  border: none; background: transparent; color: var(--et-muted);
  font: inherit; font-size: var(--et-text-caption); cursor: pointer;
}
[data-eterna-workbench='attn-btn-ghost']:hover { color: var(--et-accent); background: var(--et-accent-soft); }
/* 两击确认臂态(frontend-style §1-4:批准 R3 二次确认 warn 臂环、拒绝 danger 臂环) */
[data-eterna-workbench-armed='true'][data-eterna-workbench-attention-action='approve'] {
  box-shadow: 0 0 0 2px color-mix(in oklab, var(--et-warn), transparent 50%);
}
[data-eterna-workbench-armed='true'][data-eterna-workbench-attention-action='reject'] {
  box-shadow: 0 0 0 2px color-mix(in oklab, var(--et-danger), transparent 50%);
}
[data-eterna-workbench='reject-row'] { display: flex; gap: var(--et-space-2); }
[data-eterna-workbench='attn-escalate'] {
  display: flex; align-items: center; gap: var(--et-space-2);
  color: var(--et-warn); font-size: var(--et-text-caption);
  border-top: 1px dashed color-mix(in oklab, var(--et-warn), transparent 60%);
  padding-top: var(--et-space-3); margin: 0;
}
[data-eterna-workbench='attn-escalate'] svg { flex: none; }

/* —— T6/T7 响应式:1100/760/640(frontend-style §1-6;原型 01 标注一:≤760 侧栏置于会话上方)—— */
@media (max-width: 1100px) {
  [data-eterna-workbench='chat-shell'] { grid-template-columns: 300px minmax(0, 1fr); gap: var(--et-space-4); }
  [data-eterna-workbench='chat-body'] { padding: var(--et-space-4); }
}
@media (max-width: 760px) {
  [data-eterna-workbench='chat-shell'] { grid-template-columns: 1fr; }
  [data-eterna-workbench='task-item'] { padding: var(--et-space-3); }
  [data-eterna-workbench='side-panel'] { order: -1; }
}
@media (max-width: 640px) {
  [data-eterna-workbench='reply-row'] { flex-direction: column; }
  [data-eterna-workbench='reply-row'] [data-eterna-workbench='btn'],
  [data-eterna-workbench='reply-row'] [data-eterna-workbench='attn-btn'] { width: 100%; }
  [data-eterna-workbench='result-actions'] [data-eterna-workbench='btn'],
  [data-eterna-workbench='result-actions'] [data-eterna-workbench='btn-secondary'] { flex: 1; }
  [data-eterna-workbench='attn-actions'] [data-eterna-workbench='attn-btn'],
  [data-eterna-workbench='attn-actions'] [data-eterna-workbench='attn-btn-secondary'],
  [data-eterna-workbench='attn-actions'] [data-eterna-workbench='attn-btn-danger'],
  [data-eterna-workbench='attn-actions'] [data-eterna-workbench='attn-btn-ghost'] { flex: 1 1 100%; }
  [data-eterna-workbench='chat-head'] { padding: var(--et-space-3); }
  [data-eterna-workbench='attn-banner'] { padding: var(--et-space-4); }
}
`

/** 幂等注入工作台样式表(同文档重复装载时复用既有节点;无 DOM 环境为 no-op)。 */
export function injectWorkbenchStyles(doc?: Document): void {
  if (doc === undefined) doc = typeof document === 'undefined' ? undefined : document
  if (doc === undefined) return
  injectDesignTokens({ bridge: true, doc })
  const marker = 'data-eterna-workbench-styles'
  if (doc.querySelector(`style[${marker}]`) !== null) return
  const style = doc.createElement('style')
  style.textContent = CSS
  style.setAttribute(marker, 'true')
  doc.head.append(style)
}

/** 样式表原文(测试锚点:断点/令牌/禁字面色值由 G0-2 机器门禁覆盖)。 */
export const WORKBENCH_CSS = CSS
