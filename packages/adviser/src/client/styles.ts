/**
 * 参谋面板样式 —— 右栏 tab body(选择面板 + 参谋对话承载层)。
 *
 * 色值/圆角/动效全部经 @eterna/ui 令牌;应用内深浅主题由 DSH 桥接层
 * (--dsw-alias-*)跟随产品壳。禁止字面色值(AGENTS.md 铁律 2)。
 *
 * 对话本体不在这里写样式:它是 `conversation.content` Factory 的 embedded 变体,
 * 外观归上游。本文件只管选择面板,以及对话承载层必须的**尺寸撑满**
 * (右栏 pane 是 flex 容器,承载层不撑满时长对话会塌成零高)。
 */

import { injectDesignTokens } from '@eterna/ui'

/** 需要撑满的对话承载层(高度/宽度两个轴都要给,单一 height:100% 在 flex 链里不够)。 */
const CSS = `
[data-eterna-adviser='chat'] {
  display: flex;
  flex-direction: column;
  width: 100%;
  height: 100%;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
}
[data-eterna-adviser='chat'] > * {
  min-width: 0;
  min-height: 0;
}
/* 对话区吃掉剩余高度,回写条按内容占位(参谋 tab 的固定布局)。 */
[data-eterna-adviser='conversation'] {
  flex: 1 1 auto;
  min-height: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}
[data-eterna-adviser='conversation'] > * {
  min-width: 0;
  min-height: 0;
}

[data-eterna-adviser='panel'] {
  display: flex;
  flex-direction: column;
  gap: var(--et-space-4);
  padding: var(--et-space-5);
  color: var(--et-fg);
  font-size: var(--et-text-caption);
  line-height: var(--et-leading-body);
  overflow-y: auto;
}
[data-eterna-adviser='panel'] h2 {
  display: flex;
  align-items: center;
  gap: var(--et-space-2);
  margin: 0;
  font-size: var(--et-text-lead);
  font-weight: var(--et-weight-display);
  line-height: var(--et-leading-snug);
  color: var(--et-fg);
}
[data-eterna-adviser='panel'] .et-adviser-subtitle {
  margin: 0;
  color: var(--et-fg-2);
}
[data-eterna-adviser='panel'] .et-adviser-hint {
  margin: 0;
  color: var(--et-muted);
}
[data-eterna-adviser='panel'] .et-adviser-error {
  margin: 0;
  color: var(--et-danger);
}

[data-eterna-adviser='card'] {
  display: flex;
  flex-direction: column;
  gap: var(--et-space-3);
  padding: var(--et-space-4);
  border: 1px solid var(--et-border);
  border-radius: var(--et-radius-lg);
  background: var(--et-surface-2);
}

/* ── 参谋列表 ────────────────────────────────────────────────────────────── */
.et-adviser-list {
  display: flex;
  flex-direction: column;
  gap: var(--et-space-2);
  margin: 0;
  padding: 0;
  list-style: none;
}
.et-adviser-row {
  display: flex;
  align-items: center;
  gap: var(--et-space-3);
  width: 100%;
  padding: var(--et-space-3);
  border: 1px solid var(--et-border);
  border-radius: var(--et-radius-md);
  background: var(--et-surface);
  color: var(--et-fg);
  font: inherit;
  text-align: left;
  cursor: pointer;
  transition: background var(--et-motion-fast) var(--et-ease);
}
.et-adviser-row:hover {
  background: var(--et-surface-2);
  border-color: var(--et-accent);
}
.et-adviser-row:focus-visible {
  outline: none;
  box-shadow: var(--et-focus-ring);
}
.et-adviser-row .et-adviser-row-title {
  flex: 1 1 auto;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.et-adviser-row .et-adviser-row-state {
  flex: 0 0 auto;
  padding: 0 var(--et-space-2);
  border-radius: var(--et-radius-pill);
  background: var(--et-accent-soft);
  color: var(--et-accent);
  font-size: var(--et-text-micro);
}
.et-adviser-row .et-adviser-row-state--inactive {
  background: var(--et-surface-2);
  color: var(--et-muted);
}

/* ── 回写条 ──────────────────────────────────────────────────────────────── */
[data-eterna-adviser='feedback'] {
  flex: 0 0 auto;
  display: flex;
  flex-direction: column;
  gap: var(--et-space-2);
  padding: var(--et-space-3) var(--et-space-4);
  border-top: 1px solid var(--et-border);
  background: var(--et-surface-2);
  color: var(--et-fg);
  font-size: var(--et-text-caption);
}
[data-eterna-adviser='feedback'] .et-adviser-feedback-title {
  display: flex;
  align-items: center;
  gap: var(--et-space-2);
  margin: 0;
  font-size: var(--et-text-caption);
  font-weight: var(--et-weight-display);
  color: var(--et-fg);
}
[data-eterna-adviser='feedback'] .et-adviser-feedback-label {
  position: absolute;
  width: 1px;
  height: 1px;
  margin: -1px;
  padding: 0;
  overflow: hidden;
  clip-path: inset(50%);
  white-space: nowrap;
  border: 0;
}
[data-eterna-adviser='feedback'] .et-adviser-feedback-input {
  width: 100%;
  min-height: 64px;
  padding: var(--et-space-2) var(--et-space-3);
  border: 1px solid var(--et-border);
  border-radius: var(--et-radius-md);
  background: var(--et-surface);
  color: var(--et-fg);
  font: inherit;
  line-height: var(--et-leading-body);
  resize: vertical;
}
[data-eterna-adviser='feedback'] .et-adviser-feedback-input:focus-visible {
  outline: none;
  box-shadow: var(--et-focus-ring);
}
[data-eterna-adviser='feedback'] .et-adviser-feedback-actions {
  display: flex;
  justify-content: flex-end;
  gap: var(--et-space-2);
}
[data-eterna-adviser='feedback'] .et-adviser-feedback-hint,
[data-eterna-adviser='feedback'] .et-adviser-feedback-receipt {
  margin: 0;
  font-size: var(--et-text-micro);
  color: var(--et-muted);
}
[data-eterna-adviser='feedback'] .et-adviser-feedback-error {
  margin: 0;
  font-size: var(--et-text-micro);
  color: var(--et-danger);
}
/* 武装态(等待第二次点击)要让按钮看起来"待确认",否则用户不知道自己在确认什么。 */
[data-eterna-adviser='feedback'] .et-adviser-button[data-eterna-adviser-armed] {
  background: var(--et-danger);
  border-color: transparent;
  color: var(--et-accent-on);
}

/* ── 选中文字浮层动作(P7)───────────────────────────────────────────────────
 * 上游把它渲染在对话区上方的绝对定位层里,已算好可见范围;本按钮只需排好自己
 * 的观感(尺寸、圆角、可点区域),不要自己写 position: 上游负责定位。 */
.et-adviser-selection-action {
  display: inline-flex;
  align-items: center;
  gap: var(--et-space-1);
  padding: var(--et-space-1) var(--et-space-3);
  border: 1px solid var(--et-border);
  border-radius: var(--et-radius-pill);
  background: var(--et-surface);
  color: var(--et-fg);
  font: inherit;
  font-size: var(--et-text-micro);
  font-weight: var(--et-weight-display);
  white-space: nowrap;
  cursor: pointer;
  box-shadow: var(--et-shadow-raised);
  transition: background var(--et-motion-fast) var(--et-ease);
}
.et-adviser-selection-action:hover {
  background: var(--et-surface-2);
  border-color: var(--et-accent);
  color: var(--et-accent);
}
.et-adviser-selection-action:focus-visible {
  outline: none;
  box-shadow: var(--et-focus-ring);
}

/* ── 按钮 ────────────────────────────────────────────────────────────────── */
[data-eterna-adviser='actions'] {
  display: flex;
  gap: var(--et-space-2);
}
.et-adviser-button {
  padding: var(--et-space-2) var(--et-space-4);
  border: 1px solid var(--et-border);
  border-radius: var(--et-radius-md);
  background: var(--et-surface);
  color: var(--et-fg);
  font: inherit;
  font-weight: var(--et-weight-display);
  cursor: pointer;
  transition: background var(--et-motion-fast) var(--et-ease);
}
.et-adviser-button:hover:not(:disabled) {
  background: var(--et-surface-2);
  border-color: var(--et-accent);
}
.et-adviser-button:focus-visible {
  outline: none;
  box-shadow: var(--et-focus-ring);
}
.et-adviser-button:disabled {
  cursor: progress;
  opacity: 0.6;
}
.et-adviser-button--primary {
  border-color: transparent;
  background: var(--et-accent-fill);
  color: var(--et-accent-on);
}
.et-adviser-button--primary:hover:not(:disabled) {
  background: var(--et-accent-fill-hover);
}

@media (max-width: 640px) {
  [data-eterna-adviser='panel'] { padding: var(--et-space-4); }
}

@media (prefers-reduced-motion: reduce) {
  [data-eterna-adviser] * { transition: none !important; animation: none !important; }
}
`

/** 注入参谋面板样式;返回撤销函数。 */
export function injectAdviserStyles(): () => void {
  const disposeTokens = injectDesignTokens()
  const style = document.createElement('style')
  style.dataset.eternaAdviser = ''
  style.textContent = CSS
  document.head.appendChild(style)
  return () => {
    style.remove()
    disposeTokens()
  }
}
