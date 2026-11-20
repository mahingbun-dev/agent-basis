/**
 * 基座面板样式 —— Webflow 设计语言(近黑/单蓝、4px 锐角、hairline 分隔、
 * 16px 标准正文)。色值/字号/间距全部经 @eterna/ui 令牌;深浅主题由 DSH
 * 桥接层跟随产品壳。滚动职责:root 自身 overflow-y:auto。
 *
 * 2026-11 重排版要点:
 * - box-sizing 复位:宿主容器缺 border-box 时 width:100% + 横向 padding
 *   会整体溢出 ~96px、被 overflow-x:hidden 静默裁掉(右缘「纠正此」/
 *   待审元数据截断的根因),必须在面板作用域内自行复位;
 * - container query 断点:面板嵌在宿主宽窗口的窄列里时视口断点不触发,
 *   降级按容器宽度计算(视口 MQ 保留兜底);
 * - 按钮体系统一(实心 accent / ghost 描边 / danger 两击),一律
 *   flex:none + white-space:nowrap,禁止被 flex 挤压变形;
 * - meta/时间戳单行省略,长文只在正文块内 anywhere 断行。
 */
import { injectDesignTokens } from '@eterna/ui'

/**
 * 设置分区「流程启动条」样式(2026-11-20;导出供客户端测试做令牌纪律断言:
 * 无字面色值、只引用 --et-* 令牌)。行卡/开关/输入按 v4 交互纪律:输入触达
 * ≥36px、focus 光圈、断点只用 760/640、prefers-reduced-motion 全覆盖、无新增
 * 叠层(行内展开编辑,无 z-index)。
 */
export const CHIPS_SETTINGS_CSS = `
[data-eterna-panel='chipcfg'] {
  box-sizing: border-box;
  display: flex; flex-direction: column; gap: var(--et-space-4); min-width: 0;
  font-family: var(--et-font-body); font-size: var(--et-text-body); font-weight: 400;
  line-height: var(--et-leading-body); color: var(--et-fg);
}
[data-eterna-panel='chipcfg'] *, [data-eterna-panel='chipcfg'] *::before, [data-eterna-panel='chipcfg'] *::after { box-sizing: border-box; min-width: 0; }
[data-eterna-panel='chipcfg-head'] { display: flex; flex-direction: column; gap: var(--et-space-2); }
[data-eterna-panel='chipcfg-title-row'] { display: flex; align-items: center; gap: var(--et-space-2); color: var(--et-fg); }
[data-eterna-panel='chipcfg-title-row'] h3 { margin: 0; font-size: var(--et-text-lead); font-weight: 600; line-height: 1.3; }
[data-eterna-panel='chipcfg-hint'] { margin: 0; font-size: var(--et-text-caption); color: var(--et-muted); }
[data-eterna-panel='chipcfg-loaderr'] { margin: 0; font-size: var(--et-text-caption); color: var(--et-danger); overflow-wrap: anywhere; }
[data-eterna-panel='chipcfg-bar'] { display: flex; flex-wrap: wrap; align-items: center; gap: var(--et-space-2); }
[data-eterna-panel='chipcfg-visible'] { display: inline-flex; align-items: center; gap: var(--et-space-2); min-height: 36px; }
[data-eterna-panel='chipcfg-vislabel'] { font-size: var(--et-text-caption); color: var(--et-fg); }
[data-eterna-panel='chipcfg-gap'] { flex: 1 1 auto; }
[data-eterna-panel='chipcfg-switch'] {
  position: relative; flex: none; width: 36px; height: 20px; padding: 0; cursor: pointer;
  background: var(--et-surface-2); border: 1px solid var(--et-border); border-radius: 9999px;
  transition: background var(--et-motion-fast) var(--et-ease), border-color var(--et-motion-fast) var(--et-ease);
}
[data-eterna-panel='chipcfg-switch'][data-checked] { background: var(--et-accent); border-color: var(--et-accent); }
[data-eterna-panel='chipcfg-thumb'] {
  position: absolute; top: 2px; left: 2px; width: 14px; height: 14px; border-radius: 9999px;
  background: var(--et-fg); transition: transform var(--et-motion-fast) var(--et-ease);
}
[data-eterna-panel='chipcfg-switch'][data-checked] [data-eterna-panel='chipcfg-thumb'] { background: var(--et-accent-on); transform: translateX(16px); }
[data-eterna-panel='chipcfg-btn'], [data-eterna-panel='chipcfg-op'], [data-eterna-panel='chipcfg-save'], [data-eterna-panel='chipcfg-danger'] {
  flex: none; padding: 6px 12px; min-height: 36px; font: inherit; font-size: var(--et-text-caption);
  cursor: pointer; white-space: nowrap; color: var(--et-fg);
  background: transparent; border: 1px solid var(--et-border); border-radius: var(--et-radius-sm);
  transition: background var(--et-motion-fast) var(--et-ease), border-color var(--et-motion-fast) var(--et-ease), color var(--et-motion-fast) var(--et-ease);
}
[data-eterna-panel='chipcfg-btn']:hover:not(:disabled), [data-eterna-panel='chipcfg-op']:hover:not(:disabled) { background: var(--et-surface-2); }
[data-eterna-panel='chipcfg-save'] { color: var(--et-accent-on); background: var(--et-accent-fill); border-color: var(--et-accent-fill); }
[data-eterna-panel='chipcfg-save']:hover:not(:disabled) { background: var(--et-accent-fill-hover); }
[data-eterna-panel='chipcfg-save']:disabled { opacity: 0.45; cursor: default; }
[data-eterna-panel='chipcfg-danger'][data-armed] { color: var(--et-danger); border-color: var(--et-danger); }
[data-eterna-panel='chipcfg-danger']:disabled { opacity: 0.45; cursor: default; }
[data-eterna-panel='chipcfg-btn']:focus-visible, [data-eterna-panel='chipcfg-op']:focus-visible,
[data-eterna-panel='chipcfg-save']:focus-visible, [data-eterna-panel='chipcfg-danger']:focus-visible,
[data-eterna-panel='chipcfg-switch']:focus-visible {
  outline: none; box-shadow: var(--et-focus-ring); border-color: var(--et-accent);
}
[data-eterna-panel='chipcfg-empty'] { margin: 0; font-size: var(--et-text-caption); color: var(--et-muted); }
[data-eterna-panel='chipcfg-list'] { margin: 0; padding: 0; list-style: none; display: flex; flex-direction: column; gap: var(--et-space-2); }
[data-eterna-panel='chipcfg-row'] {
  display: flex; flex-wrap: wrap; align-items: flex-start; gap: var(--et-space-3);
  padding: var(--et-space-3); border: 1px solid var(--et-border-soft); border-radius: var(--et-radius-md);
  background: var(--et-surface);
}
[data-eterna-panel='chipcfg-row'][data-enabled='false'] [data-eterna-panel='chipcfg-name'],
[data-eterna-panel='chipcfg-row'][data-enabled='false'] [data-eterna-panel='chipcfg-kickoff'] { color: var(--et-muted); }
[data-eterna-panel='chipcfg-main'] { flex: 1 1 240px; display: flex; flex-direction: column; gap: 2px; min-width: 0; }
[data-eterna-panel='chipcfg-name'] { font-weight: 500; color: var(--et-fg); }
[data-eterna-panel='chipcfg-kickoff'] {
  overflow: hidden; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical;
  font-size: var(--et-text-caption); color: var(--et-fg-2); word-break: break-word;
}
[data-eterna-panel='chipcfg-notetext'] { font-size: var(--et-text-micro); color: var(--et-muted); }
[data-eterna-panel='chipcfg-ops'] { display: flex; flex-wrap: wrap; align-items: center; gap: var(--et-space-2); }
[data-eterna-panel='chipcfg-edit'] { flex: 1 1 100%; display: flex; flex-direction: column; gap: var(--et-space-3); }
[data-eterna-panel='chipcfg-field'] { display: flex; flex-direction: column; gap: var(--et-space-1); }
[data-eterna-panel='chipcfg-flabel'] { font-size: var(--et-text-micro); color: var(--et-muted); }
[data-eterna-panel='chipcfg-input'], [data-eterna-panel='chipcfg-textarea'] {
  min-height: 36px; padding: 6px 10px; font: inherit; font-size: var(--et-text-caption); color: var(--et-fg);
  background: var(--et-surface-2); border: 1px solid var(--et-border); border-radius: var(--et-radius-sm);
  transition: border-color var(--et-motion-fast) var(--et-ease), box-shadow var(--et-motion-fast) var(--et-ease);
}
[data-eterna-panel='chipcfg-textarea'] { min-height: 72px; resize: vertical; line-height: 1.5; }
[data-eterna-panel='chipcfg-input']:focus-visible, [data-eterna-panel='chipcfg-textarea']:focus-visible {
  outline: none; border-color: var(--et-accent); box-shadow: var(--et-focus-ring);
}
[data-eterna-panel='chipcfg-input']::placeholder, [data-eterna-panel='chipcfg-textarea']::placeholder { color: var(--et-muted); }
[data-eterna-panel='chipcfg-editdone'] { display: flex; justify-content: flex-end; }
[data-eterna-panel='chipcfg-actions'] { display: flex; flex-wrap: wrap; align-items: center; gap: var(--et-space-3); }
[data-eterna-panel='chipcfg-issue'] { font-size: var(--et-text-caption); color: var(--et-danger); }
[data-eterna-panel='chipcfg-note'] { font-size: var(--et-text-caption); color: var(--et-success); overflow-wrap: anywhere; }
[data-eterna-panel='chipcfg-note'][data-ok='false'] { color: var(--et-danger); }
@media (max-width: 640px) {
  [data-eterna-panel='chipcfg-row'] { flex-direction: column; }
  /* 行卡转纵排后 main 不得保留 flex-grow(240px basis 在 column 方向变纵向拉伸,
     kicker 与操作行之间会撑出整段空白——390 视口实测) */
  [data-eterna-panel='chipcfg-main'] { flex: 0 0 auto; }
  [data-eterna-panel='chipcfg-ops'] { width: 100%; justify-content: flex-end; }
}
@media (prefers-reduced-motion: reduce) {
  [data-eterna-panel='chipcfg-switch'], [data-eterna-panel='chipcfg-thumb'], [data-eterna-panel='chipcfg-btn'],
  [data-eterna-panel='chipcfg-op'], [data-eterna-panel='chipcfg-save'], [data-eterna-panel='chipcfg-danger'],
  [data-eterna-panel='chipcfg-input'], [data-eterna-panel='chipcfg-textarea'] { transition: none; }
}
`

const CSS = `
/* —— 底盘 —— */
[data-eterna-panel='root'],
[data-eterna-panel='root'] *,
[data-eterna-panel='root'] *::before,
[data-eterna-panel='root'] *::after { box-sizing: border-box; }
[data-eterna-panel='root'] {
  animation: et-fade-in var(--et-motion-base) var(--et-ease) both;
  width: 100%;
  height: 100%;
  overflow-y: auto;
  overflow-x: hidden;
  scrollbar-gutter: stable;
  container-type: inline-size;
  container-name: eterna-panel;
  display: block;
  padding: 48px 48px 96px;
  font-family: var(--et-font-body);
  font-size: var(--et-text-body);
  font-weight: var(--et-weight-body);
  line-height: var(--et-leading-body);
  color: var(--et-fg);
  min-width: 0;
}
[data-eterna-panel='root'] * { min-width: 0; }

/* —— 页头 —— */
[data-eterna-panel='toolbar'] {
  display: flex; align-items: center; justify-content: space-between; gap: var(--et-space-3);
  padding-bottom: var(--et-space-4); border-bottom: 1px solid var(--et-border-soft);
}
[data-eterna-panel='heading'] {
  margin: 0; font-size: var(--et-text-h2); line-height: 1.15; font-weight: var(--et-weight-display);
  letter-spacing: var(--et-tracking-display); color: var(--et-fg);
}
[data-eterna-panel='sub'] { margin: var(--et-space-3) 0 0; font-size: var(--et-text-caption); line-height: var(--et-leading-body); color: var(--et-muted); }

/* —— 区块骨架 —— */
[data-eterna-panel='section'] { margin: var(--et-space-8) 0 0; display: flex; flex-direction: column; gap: var(--et-space-4); min-width: 0; }
[data-eterna-panel='section-head'] {
  display: flex; align-items: center; gap: var(--et-space-2); min-width: 0;
  padding-bottom: var(--et-space-3); border-bottom: 1px solid var(--et-border-soft);
}
[data-eterna-panel='section-icon'] { display: inline-flex; flex: none; color: var(--et-fg-2); }
[data-eterna-panel='section-title'] {
  margin: 0; font-size: var(--et-text-h3); line-height: var(--et-leading-snug); font-weight: var(--et-weight-display);
  letter-spacing: var(--et-tracking-display); color: var(--et-fg);
}
[data-eterna-panel='section-count'] {
  flex: none; padding: 2px 10px; border-radius: var(--et-radius-pill);
  font-size: var(--et-text-meta); font-weight: var(--et-weight-body); color: var(--et-fg-2);
  background: var(--et-surface-2); font-variant-numeric: tabular-nums;
}
[data-eterna-panel='section-actions'] { margin-left: auto; display: flex; align-items: center; gap: var(--et-space-2); flex: none; }
[data-eterna-panel='section-note'] { margin: calc(var(--et-space-3) * -1) 0 0; font-size: var(--et-text-caption); line-height: var(--et-leading-body); color: var(--et-muted); }

/* —— 按钮体系:ghost 描边(刷新/纠正/查看摘要/展开详情) —— */
[data-eterna-panel='refresh'],
[data-eterna-panel='portrait-correct'],
[data-eterna-panel='checkpoint-toggle'],
[data-eterna-panel='mem-pending-detail-toggle'] {
  flex: none; display: inline-flex; align-items: center; justify-content: center; gap: 4px;
  padding: 5px 12px; min-height: 32px; font: inherit; font-size: var(--et-text-caption); font-weight: var(--et-weight-body);
  white-space: nowrap; cursor: pointer;
  color: var(--et-fg-2); background: transparent;
  border: 1px solid var(--et-border); border-radius: var(--et-radius-sm);
  transition: border-color var(--et-motion-fast) var(--et-ease), color var(--et-motion-fast) var(--et-ease), background var(--et-motion-fast) var(--et-ease);
}
/* 纵向 flex(待审行卡)里的 ghost 钮不被 stretch 成整行宽 */
[data-eterna-panel='mem-pending-row'] > [data-eterna-panel='mem-pending-detail-toggle'] { align-self: flex-start; }
[data-eterna-panel='refresh']:hover:not(:disabled),
[data-eterna-panel='portrait-correct']:hover:not(:disabled),
[data-eterna-panel='checkpoint-toggle']:hover:not(:disabled),
[data-eterna-panel='mem-pending-detail-toggle']:hover:not(:disabled) { border-color: var(--et-fg-2); color: var(--et-fg); }
[data-eterna-panel='refresh']:disabled,
[data-eterna-panel='checkpoint-toggle']:disabled { opacity: 0.6; cursor: default; }

/* —— 实心 accent 钮(待审「记住」) —— */
[data-eterna-panel='mem-approve'] {
  flex: none; display: inline-flex; align-items: center; justify-content: center; gap: 6px;
  padding: 5px 14px; min-height: 32px; font: inherit; font-size: var(--et-text-caption); font-weight: var(--et-weight-display);
  white-space: nowrap; cursor: pointer;
  color: var(--et-accent-on); background: var(--et-accent-fill);
  border: 0; border-radius: var(--et-radius-sm);
  transition: background var(--et-motion-fast) var(--et-ease);
}
[data-eterna-panel='mem-approve']:hover:not(:disabled) { background: var(--et-accent-fill-hover); }
[data-eterna-panel='mem-approve']:disabled { opacity: 0.6; cursor: default; }

/* —— 文字链钮(显示全文;::after 扩大命中区) —— */
[data-eterna-panel='mem-expand'] {
  position: relative; margin-top: 6px; padding: 0; font: inherit; font-size: var(--et-text-meta); cursor: pointer;
  color: var(--et-accent); background: none; border: 0;
}
[data-eterna-panel='mem-expand']::after { content: ""; position: absolute; inset: -10px -8px; }
[data-eterna-panel='mem-expand']:hover { text-decoration: underline; text-underline-offset: 3px; }

/* —— 统一 focus 光圈 —— */
[data-eterna-panel='refresh']:focus-visible,
[data-eterna-panel='portrait-correct']:focus-visible,
[data-eterna-panel='checkpoint-toggle']:focus-visible,
[data-eterna-panel='mem-pending-detail-toggle']:focus-visible,
[data-eterna-panel='mem-approve']:focus-visible,
[data-eterna-panel='mem-expand']:focus-visible,
[data-eterna-panel='prompt-copy']:focus-visible,
[data-eterna-panel='chip']:focus-visible,
[data-eterna-panel='mem-pending-actions'] button:focus-visible { outline: none; box-shadow: var(--et-focus-ring); }

/* —— 服务状态卡片 —— */
[data-eterna-panel='cards'] { display: grid; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); gap: var(--et-space-4); }
[data-eterna-panel='card'] {
  display: flex; flex-direction: column; gap: var(--et-space-3); min-width: 0;
  padding: var(--et-space-5); border: 1px solid var(--et-border-soft); border-radius: var(--et-radius-md);
  background: var(--et-surface);
}
[data-eterna-panel='card-kicker'] { font-size: var(--et-text-body); line-height: var(--et-leading-snug); font-weight: var(--et-weight-display); color: var(--et-fg); }
[data-eterna-panel='card-count'] { color: var(--et-meta); font-weight: var(--et-weight-body); }
[data-eterna-panel='tile-row'] { display: flex; align-items: flex-start; gap: var(--et-space-8); flex-wrap: wrap; }
[data-eterna-panel='metric'] { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
[data-eterna-panel='metric-value'] { display: block; font-size: var(--et-text-h2); line-height: 1.15; font-weight: var(--et-weight-display); font-variant-numeric: tabular-nums; letter-spacing: 0; color: var(--et-fg); }
[data-eterna-panel='metric-label'] { display: block; font-size: var(--et-text-meta); line-height: var(--et-leading-snug); color: var(--et-muted); }
[data-eterna-panel='kv'] { display: grid; grid-template-columns: auto minmax(0, 1fr); gap: 4px 12px; align-items: center; }
[data-eterna-panel='kv-key'] { font-size: var(--et-text-caption); line-height: var(--et-leading-snug); color: var(--et-muted); }
[data-eterna-panel='kv-value'] { font-size: var(--et-text-caption); line-height: var(--et-leading-snug); color: var(--et-fg-2); overflow-wrap: anywhere; }
[data-eterna-panel='status-pill'] {
  display: inline-flex; align-items: center; padding: 2px 10px; border-radius: var(--et-radius-pill);
  font-size: var(--et-text-meta); font-weight: var(--et-weight-body); white-space: nowrap;
}
[data-eterna-panel-status='ok'] { color: var(--et-success); background: color-mix(in oklab, var(--et-success), transparent 88%); }
[data-eterna-panel-status='error'] { color: var(--et-danger); background: var(--et-danger-soft); }
[data-eterna-panel-status='not-mounted'] { color: var(--et-muted); background: var(--et-surface-2); }

/* —— 记忆子卡共享骨架(待审/画像/功能域/指标) —— */
[data-eterna-panel='mem-pending'],
[data-eterna-panel='portrait'],
[data-eterna-panel='domain-browse'],
[data-eterna-panel='mem-metrics'] {
  display: flex; flex-direction: column; gap: var(--et-space-3); min-width: 0;
  padding: var(--et-space-5); border: 1px solid var(--et-border-soft); border-radius: var(--et-radius-md);
  background: var(--et-surface);
}
[data-eterna-panel='mem-pending-head'] {
  display: flex; align-items: center; gap: var(--et-space-2); min-width: 0;
  padding-bottom: var(--et-space-3); border-bottom: 1px solid var(--et-border-soft);
}
[data-eterna-panel='mem-pending-title'] { display: inline-flex; align-items: center; gap: var(--et-space-2); min-width: 0; font-size: var(--et-text-caption); font-weight: var(--et-weight-display); color: var(--et-fg); }
[data-eterna-panel='sub-icon'] { display: inline-flex; flex: none; color: var(--et-fg-2); }
[data-eterna-panel='mem-pending-count'],
[data-eterna-panel='portrait-version'] {
  flex: none; margin-left: auto; padding: 2px 10px; border-radius: var(--et-radius-pill);
  font-size: var(--et-text-meta); font-weight: var(--et-weight-body); color: var(--et-fg-2);
  background: var(--et-surface-2); font-variant-numeric: tabular-nums;
}
[data-eterna-panel='mem-pending-hint'] { margin: 0; font-size: var(--et-text-caption); line-height: var(--et-leading-snug); color: var(--et-muted); }

/* —— 待审记忆队列(危险色调卡 + surface 行卡;审批闭环) —— */
[data-eterna-panel='mem-pending'] {
  background: var(--et-danger-soft);
  border-color: color-mix(in oklab, var(--et-danger), transparent 75%);
}
[data-eterna-panel='mem-pending'] [data-eterna-panel='mem-pending-head'] { border-bottom-color: color-mix(in oklab, var(--et-danger), transparent 80%); }
[data-eterna-panel='mem-pending'] [data-eterna-panel='mem-pending-count'] { color: var(--et-danger); background: color-mix(in oklab, var(--et-danger), transparent 86%); }
[data-eterna-panel='mem-pending-row'] {
  display: flex; flex-direction: column; gap: var(--et-space-2); min-width: 0;
  padding: var(--et-space-3) var(--et-space-4);
  background: var(--et-surface);
  border: 1px solid var(--et-border-soft); border-radius: var(--et-radius-md);
}
[data-eterna-panel='mem-pending-top'] { display: flex; align-items: center; gap: var(--et-space-2); flex-wrap: wrap; }
[data-eterna-panel='mem-entity-key'] {
  display: inline-block; max-width: 100%; padding: 2px 8px; border-radius: var(--et-radius-sm);
  background: var(--et-surface-2); font-family: var(--et-font-mono); font-size: var(--et-text-meta);
  font-weight: var(--et-weight-display); color: var(--et-fg-2); overflow-wrap: anywhere;
}
[data-eterna-panel='mem-pending-compaction'] {
  flex: none; padding: 2px 10px; border-radius: var(--et-radius-pill);
  font-size: var(--et-text-meta); color: var(--et-accent); background: var(--et-accent-soft);
}
[data-eterna-panel='mem-pending-meta'] {
  display: flex; flex-wrap: wrap; row-gap: 2px; min-width: 0;
  font-size: var(--et-text-meta); color: var(--et-meta); font-variant-numeric: tabular-nums;
}
[data-eterna-panel='mem-pending-meta'] > * + *::before { content: '·'; margin: 0 var(--et-space-2); }
[data-eterna-panel='mem-pending-error'] { font-size: var(--et-text-caption); color: var(--et-danger); overflow-wrap: anywhere; }
[data-eterna-panel='mem-pending-actions'] { display: flex; align-items: center; justify-content: flex-end; gap: var(--et-space-2); margin-top: var(--et-space-1); }
[data-eterna-panel='mem-pending-actions'] button.eterna-panel-danger {
  color: var(--et-fg-2); background: transparent;
  border: 1px solid var(--et-border); border-radius: var(--et-radius-sm);
  transition: border-color var(--et-motion-fast) var(--et-ease), background var(--et-motion-fast) var(--et-ease), color var(--et-motion-fast) var(--et-ease);
}
[data-eterna-panel='mem-pending-actions'] button.eterna-panel-danger:hover:not(:disabled) { border-color: var(--et-danger); color: var(--et-danger); }
[data-eterna-panel='mem-pending-actions'] button.eterna-panel-danger.is-armed {
  border-color: var(--et-danger); color: var(--et-accent-on); background: var(--et-danger);
}
[data-eterna-panel='mem-pending-actions'] button:disabled { opacity: 0.6; cursor: default; }

/* —— 记忆条目(分组列表) —— */
[data-eterna-panel='mem-group'] {
  border-radius: var(--et-radius-md); padding: var(--et-space-2) var(--et-space-5) var(--et-space-3);
  background: var(--et-surface); border: 1px solid var(--et-border-soft);
}
[data-eterna-panel='mem-group'] + [data-eterna-panel='mem-group'] { margin-top: var(--et-space-4); }
[data-eterna-panel='mem-subject'] {
  display: flex; align-items: center; gap: var(--et-space-2); min-width: 0;
  padding: var(--et-space-3) 0 var(--et-space-2); font-size: var(--et-text-caption); font-weight: var(--et-weight-display);
  color: var(--et-fg); border-bottom: 1px solid var(--et-border-soft);
}
[data-eterna-panel='mem-count'] { margin-left: auto; flex: none; font-size: var(--et-text-meta); font-weight: var(--et-weight-body); color: var(--et-meta); font-variant-numeric: tabular-nums; }
[data-eterna-panel='mem-group-desc'] { margin: var(--et-space-2) 0 0; font-size: var(--et-text-caption); line-height: var(--et-leading-snug); color: var(--et-muted); }
[data-eterna-panel='mem-entity'] { padding: var(--et-space-3) 0; border-bottom: 1px solid var(--et-border-soft); }
[data-eterna-panel='mem-entity']:last-child { border-bottom: 0; padding-bottom: var(--et-space-1); }
[data-eterna-panel='mem-entity-head'] { display: flex; align-items: center; gap: var(--et-space-2); min-width: 0; margin-bottom: var(--et-space-2); }
[data-eterna-panel='mem-entity-time'] { margin-left: auto; flex: none; font-size: var(--et-text-meta); color: var(--et-meta); font-variant-numeric: tabular-nums; white-space: nowrap; }
[data-eterna-panel='mem-entity-content'] { font-size: var(--et-text-caption); line-height: var(--et-leading-snug); color: var(--et-fg); white-space: pre-wrap; overflow-wrap: anywhere; }
[data-eterna-panel='mem-entity-content'][data-eterna-panel-clamped='true'] {
  display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden;
}

/* —— 你的画像(2 列分节栅格;窄容器降 1 列) —— */
[data-eterna-panel='portrait-grid'] { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: var(--et-space-4) var(--et-space-8); }
[data-eterna-panel='portrait-section'] { display: flex; flex-direction: column; gap: var(--et-space-2); min-width: 0; padding-top: var(--et-space-2); border-top: 1px dashed var(--et-border-soft); }
[data-eterna-panel='portrait-section-head'] { display: flex; align-items: center; gap: var(--et-space-3); min-width: 0; }
[data-eterna-panel='portrait-section-title'] { font-size: var(--et-text-caption); font-weight: var(--et-weight-display); color: var(--et-fg-2); }
[data-eterna-panel='portrait-correct'] { margin-left: auto; }
[data-eterna-panel='portrait-line'] { font-size: var(--et-text-caption); line-height: var(--et-leading-snug); color: var(--et-fg-2); overflow-wrap: anywhere; }
[data-eterna-panel='portrait-line'][data-eterna-panel-portrait-empty='true'] { color: var(--et-meta); }
[data-eterna-panel='portrait-corrected'] { font-size: var(--et-text-meta); color: var(--et-success); }

/* —— 功能域(行卡:label + 状态 pill + 计数 chips) —— */
[data-eterna-panel='domain-row'] {
  display: flex; align-items: center; gap: var(--et-space-2); flex-wrap: wrap; min-width: 0;
  padding: var(--et-space-2) 0; border-bottom: 1px solid var(--et-border-soft);
}
[data-eterna-panel='domain-row']:last-child { border-bottom: 0; }
[data-eterna-panel='domain-label'] { display: inline-flex; align-items: center; gap: var(--et-space-2); min-width: 0; max-width: 100%; font-size: var(--et-text-caption); font-weight: var(--et-weight-display); color: var(--et-fg); }
[data-eterna-panel='domain-name'] { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
[data-eterna-panel='domain-candidate-flag'] {
  flex: none; padding: 1px 8px; border-radius: var(--et-radius-pill);
  font-size: var(--et-text-meta); font-weight: var(--et-weight-body);
  color: var(--et-muted); background: var(--et-surface-2);
}
[data-eterna-panel='domain-meta'] {
  margin-left: auto; display: flex; align-items: center; gap: var(--et-space-1); flex-wrap: wrap;
  font-size: var(--et-text-meta); color: var(--et-muted); font-variant-numeric: tabular-nums;
}
[data-eterna-panel='domain-stat'] { padding: 2px 8px; border-radius: var(--et-radius-sm); background: var(--et-surface-2); color: var(--et-fg-2); }
[data-eterna-panel='domain-pending'] { padding: 2px 8px; border-radius: var(--et-radius-sm); color: var(--et-warn); background: color-mix(in oklab, var(--et-warn), transparent 88%); }

/* —— 记忆指标(stat tile 栅格) —— */
[data-eterna-panel='mem-metrics-grid'] { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: var(--et-space-2); font-variant-numeric: tabular-nums; }
[data-eterna-panel='mem-metrics-grid'] [data-eterna-panel='metric'] { padding: var(--et-space-3); background: var(--et-surface-2); border-radius: var(--et-radius-sm); }
[data-eterna-panel='mem-metrics-grid'] [data-eterna-panel='metric-value'] { font-size: var(--et-text-lead); line-height: 1.2; }
[data-eterna-panel='mem-metrics-grid'] [data-eterna-panel='metric'][data-eterna-panel-muted='true'] [data-eterna-panel='metric-value'] { color: var(--et-meta); font-weight: var(--et-weight-body); }
[data-eterna-panel='mem-metrics-grid'] [data-eterna-panel='metric-label'] { font-size: var(--et-text-meta); line-height: var(--et-leading-snug); color: var(--et-muted); }

/* —— 工具清单 —— */
[data-eterna-panel='card'][data-eterna-panel-card='event-tools'] { grid-column: 1 / -1; }
[data-eterna-panel='tool-list'] { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; }
[data-eterna-panel='tool'] {
  display: flex; align-items: flex-start; gap: var(--et-space-4);
  padding: var(--et-space-3) 0; border-bottom: 1px solid var(--et-border-soft);
}
[data-eterna-panel='tool']:last-child { border-bottom: 0; }
[data-eterna-panel='tool-head'] { display: flex; flex-direction: column; gap: 1px; flex: none; width: 220px; }
[data-eterna-panel='tool-label'] { font-size: var(--et-text-caption); line-height: var(--et-leading-snug); font-weight: var(--et-weight-display); color: var(--et-fg); }
[data-eterna-panel='tool-id'] { font-size: var(--et-text-caption); color: var(--et-meta); overflow-wrap: anywhere; font-family: var(--et-font-mono); }
[data-eterna-panel='tool-desc'] { flex: 1; font-size: var(--et-text-caption); line-height: var(--et-leading-snug); color: var(--et-fg-2); }
[data-eterna-panel='risk'] {
  flex: none; align-self: center; margin-left: auto;
  font-size: var(--et-text-caption); font-weight: var(--et-weight-display); line-height: var(--et-leading-snug); padding: 2px 8px;
  border-radius: var(--et-radius-sm);
}
[data-eterna-panel-risk='R3'] { color: var(--et-danger); background: var(--et-danger-soft); }
[data-eterna-panel-risk='R2'] { color: var(--et-warn); background: color-mix(in oklab, var(--et-warn), transparent 88%); }
[data-eterna-panel-risk='R1'] { color: var(--et-muted); background: var(--et-surface-2); }

/* —— 三步上手(并入指南区;数字方块步骤条) —— */
[data-eterna-panel='steps'] {
  display: grid; grid-template-columns: repeat(3, 1fr); gap: var(--et-space-4);
  margin: 0; padding: var(--et-space-4); background: var(--et-surface-2); border: 0; border-radius: var(--et-radius-md);
}
[data-eterna-panel='step'] { display: flex; align-items: flex-start; gap: var(--et-space-2); min-width: 0; }
[data-eterna-panel='step-no'] {
  flex: none; width: 26px; height: 26px; display: grid; place-items: center;
  border: 1px solid var(--et-border); border-radius: var(--et-radius-sm); background: var(--et-surface);
  font-size: var(--et-text-caption); font-weight: var(--et-weight-display); color: var(--et-fg-2); font-variant-numeric: tabular-nums;
}
[data-eterna-panel='step-text'] { font-size: var(--et-text-caption); line-height: var(--et-leading-snug); color: var(--et-fg-2); padding-top: 3px; }

/* —— 操作指引(示例卡;320px 下限避免宽屏出现过多窄列) —— */
[data-eterna-panel-section='guide'] [data-eterna-panel='cards'] { grid-template-columns: repeat(auto-fit, minmax(320px, 1fr)); }
[data-eterna-panel='prompt'] {
  display: flex; flex-direction: column; gap: 6px; min-width: 0;
  padding: var(--et-space-4); border-radius: var(--et-radius-md);
  background: var(--et-surface); border: 1px solid var(--et-border-soft);
}
[data-eterna-panel='prompt-head'] { display: flex; align-items: center; gap: var(--et-space-2); flex-wrap: wrap; min-width: 0; }
[data-eterna-panel='prompt-title'] { font-size: var(--et-text-caption); font-weight: var(--et-weight-display); color: var(--et-fg); }
[data-eterna-panel='prompt-capability'] { font-size: var(--et-text-meta); color: var(--et-muted); }
[data-eterna-panel='prompt-copy'] {
  position: relative; margin-left: auto; flex: none; display: inline-flex; align-items: center; gap: 4px;
  padding: 4px 10px; font: inherit; font-size: var(--et-text-meta); font-weight: var(--et-weight-body); cursor: pointer;
  white-space: nowrap; color: var(--et-accent); background: var(--et-accent-soft);
  border: 0; border-radius: var(--et-radius-sm);
  transition: background var(--et-motion-fast) var(--et-ease);
}
[data-eterna-panel='prompt-copy']:hover { background: color-mix(in oklab, var(--et-accent), transparent 82%); }
[data-eterna-panel='prompt-text'] { margin: 0; font-size: var(--et-text-caption); line-height: var(--et-leading-snug); color: var(--et-fg-2); overflow-wrap: anywhere; }
[data-eterna-panel='prompt-note'] { margin: 0; font-size: var(--et-text-caption); line-height: var(--et-leading-snug); color: var(--et-danger); }

/* —— 用量观测(单卡行列表;id 单行省略) —— */
[data-eterna-panel='session-list'] {
  display: flex; flex-direction: column; min-width: 0;
  padding: var(--et-space-1) var(--et-space-5);
  background: var(--et-surface); border: 1px solid var(--et-border-soft); border-radius: var(--et-radius-md);
}
[data-eterna-panel='session'] { display: flex; flex-direction: column; gap: var(--et-space-2); min-width: 0; padding: var(--et-space-3) 0; border-bottom: 1px solid var(--et-border-soft); }
[data-eterna-panel='session']:last-child { border-bottom: 0; }
[data-eterna-panel='session-id'] {
  max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  font-family: var(--et-font-mono); font-size: var(--et-text-meta); color: var(--et-fg-2);
}
[data-eterna-panel='session-metrics'] { display: flex; gap: var(--et-space-1); flex-wrap: wrap; }
[data-eterna-panel='session-metrics'] > span {
  padding: 2px 8px; border-radius: var(--et-radius-sm); background: var(--et-surface-2);
  font-size: var(--et-text-meta); color: var(--et-muted); font-variant-numeric: tabular-nums;
}
[data-eterna-panel='session-metrics'] > [data-eterna-panel='cache-hit-rate'] { color: var(--et-accent); background: var(--et-accent-soft); }
[data-eterna-panel='session-last'] { font-size: var(--et-text-meta); color: var(--et-meta); font-variant-numeric: tabular-nums; }

/* —— 上下文压缩 checkpoint —— */
[data-eterna-panel-card='checkpoint'] [data-eterna-panel='kv'] { grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); align-items: first baseline; }
[data-eterna-panel='checkpoint-summary'] { margin: var(--et-space-2) 0 0; padding: var(--et-space-3); border: 1px solid var(--et-border-soft); border-radius: var(--et-radius-sm); background: var(--et-surface-2); font-family: var(--et-font-mono, var(--et-font-body)); font-size: var(--et-text-caption); line-height: var(--et-leading-snug); white-space: pre-wrap; word-break: break-word; max-height: 320px; overflow: auto; }

/* —— 占位/错误 —— */
[data-eterna-panel='placeholder'] { font-size: var(--et-text-caption); color: var(--et-muted); }
[data-eterna-panel='placeholder'][data-eterna-panel-error='true'] { color: var(--et-danger); overflow-wrap: anywhere; }

/* —— chips(conversation.input.dock:composer 卡上方整宽常驻条) ——
   几何与官方 GoalBar/TodoPanel 同式:两侧让出 side-clearance,dock 内缩 4 个
   dock-inset,上限跟随 composer 卡宽;宿主变量缺席时按同值兜底(独立宿主仍可用,
   不给宿主留像素依赖)。容器查询按条自身宽度降级:窄条先省略再隐藏 label,
   chips 自动换行,任何宽度都不越出卡片/视口(2026-11-17 溢出修复)。 */
[data-eterna-panel='chips'] {
  box-sizing: border-box;
  flex: none;
  width: calc(100% - 2 * var(--dsh-composer-side-clearance, 16px) - 4 * var(--dsh-composer-dock-inset, 8px));
  max-width: calc(var(--dsh-composer-card-max-width, 952px) - 4 * var(--dsh-composer-dock-inset, 8px));
  margin: 0 auto;
  display: flex; flex-wrap: wrap; align-items: center; gap: var(--et-space-2);
  padding: 6px var(--et-space-3);
  border: 1px solid var(--et-border-soft); border-radius: var(--et-radius-md);
  background: var(--et-surface);
  container-type: inline-size;
}
[data-eterna-panel='chips-label'] {
  flex: 0 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  font-size: var(--et-text-meta); color: var(--et-muted);
}
[data-eterna-panel='chip'] {
  position: relative; flex: 0 0 auto; padding: 5px 12px; font: inherit; font-size: var(--et-text-meta);
  line-height: var(--et-leading-snug); cursor: pointer; white-space: nowrap;
  color: var(--et-accent);
  background: var(--et-accent-soft);
  border: 0; border-radius: var(--et-radius-sm);
  transition: background var(--et-motion-fast) var(--et-ease);
}
[data-eterna-panel='chip']::after { content: ""; position: absolute; inset: -5px -4px; }
[data-eterna-panel='chip']:hover:not(:disabled) { background: color-mix(in oklab, var(--et-accent), transparent 82%); }
[data-eterna-panel='chip']:disabled { opacity: 0.45; cursor: default; }
@container (max-width: 680px) {
  /* 条内容宽 < 680px 时 label(约 217px)+ 4 chips(约 470px)+ 间距(约 40px)
     放不下一行:先牺牲说明文字换单行,chips 保持一眼可点(1080 窗条内容宽
     实测 634px → 隐藏;1440 窗 716px → 显示且单行)。label 的完整语义仍在
     toolbar 的 aria-label 里。 */
  [data-eterna-panel='chips-label'] { display: none; }
}

/* —— 容器断点(面板嵌在宿主窄列时按容器宽度降级;不依赖视口) —— */
@container eterna-panel (max-width: 900px) {
  [data-eterna-panel='portrait-grid'] { grid-template-columns: 1fr; }
  [data-eterna-panel='domain-meta'] { margin-left: 0; }
}
@container eterna-panel (max-width: 760px) {
  [data-eterna-panel='root'] { padding: 32px 20px 64px; }
  [data-eterna-panel='steps'] { grid-template-columns: 1fr; gap: var(--et-space-4); }
  [data-eterna-panel='tool'] { flex-direction: column; gap: 6px; }
  [data-eterna-panel='tool-head'] { width: auto; }
  [data-eterna-panel='risk'] { align-self: flex-start; margin-left: 0; }
}
@container eterna-panel (max-width: 640px) {
  [data-eterna-panel='root'] { padding: 24px 16px 48px; }
  [data-eterna-panel='heading'] { font-size: var(--et-text-h3); }
  [data-eterna-panel='steps'] { grid-template-columns: 1fr; gap: var(--et-space-4); }
  [data-eterna-panel='cards'] { grid-template-columns: 1fr; }
  [data-eterna-panel='card'] { padding: var(--et-space-4); }
  [data-eterna-panel='tile-row'] { gap: var(--et-space-6); }
}

/* —— 视口断点(容器查询不可用时的兜底) —— */
@media (max-width: 760px) {
  [data-eterna-panel='root'] { padding: 32px 20px 64px; }
  [data-eterna-panel='steps'] { grid-template-columns: 1fr; gap: var(--et-space-4); }
  [data-eterna-panel='tool'] { flex-direction: column; gap: 6px; }
  [data-eterna-panel='tool-head'] { width: auto; }
  [data-eterna-panel='risk'] { align-self: flex-start; margin-left: 0; }
}
@media (max-width: 640px) {
  [data-eterna-panel='root'] { padding: 24px 16px 48px; }
  [data-eterna-panel='heading'] { font-size: var(--et-text-h3); }
  [data-eterna-panel='steps'] { grid-template-columns: 1fr; gap: var(--et-space-4); }
  [data-eterna-panel='cards'] { grid-template-columns: 1fr; }
  [data-eterna-panel='card'] { padding: var(--et-space-4); }
  [data-eterna-panel='tile-row'] { gap: var(--et-space-6); }
}
@media (prefers-reduced-motion: reduce) {
  [data-eterna-panel='refresh'], [data-eterna-panel='chip'],
  [data-eterna-panel='portrait-correct'], [data-eterna-panel='checkpoint-toggle'],
  [data-eterna-panel='mem-pending-detail-toggle'], [data-eterna-panel='mem-approve'],
  [data-eterna-panel='prompt-copy'] { transition: none; }
}
@keyframes et-fade-in { from { opacity: 0; transform: translateY(4px); } to { opacity: 1; transform: none; } }
@media (prefers-reduced-motion: reduce) { [data-eterna-panel='root'], [data-eterna-usage-stats], [data-t7-studio-root], [data-t7-trace-root] { animation: none; } }

${CHIPS_SETTINGS_CSS}
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
