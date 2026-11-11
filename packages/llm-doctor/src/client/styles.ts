/**
 * 诊断区块样式 —— 对齐 @eterna/ui(Webflow 令牌 + DSH 主题桥接)。
 * 注入一次(style#llm-doctor-styles),选择器全部挂 [data-bdoc] 命名空间。
 */
import { injectDesignTokens } from '@eterna/ui'

const CSS = `
[data-bdoc-root] {
  margin-top: 12px;
  padding: 12px 14px 10px;
  border: 1px solid var(--et-border-soft);
  border-radius: var(--et-radius-md);
  background: var(--et-surface);
  font-family: var(--et-font-body);
  font-size: var(--et-text-caption);
  font-weight: var(--et-weight-body);
  line-height: var(--et-leading-body);
  color: var(--et-fg);
}
[data-bdoc-head] {
  display: flex; align-items: center; justify-content: space-between;
  gap: 10px; margin-bottom: 8px;
}
[data-bdoc-title] {
  font-weight: var(--et-weight-display); font-size: var(--et-text-micro); line-height: 1.4;
  color: var(--et-fg-2); letter-spacing: 0;
}
[data-bdoc-health] {
  font-size: var(--et-text-micro); line-height: 1.4; padding: 2px 8px; border-radius: var(--et-radius-sm);
  white-space: nowrap;
}
[data-bdoc-health="ok"] {
  color: var(--et-success);
  background: color-mix(in oklab, var(--et-success), transparent 88%);
}
[data-bdoc-health="missing"] {
  color: var(--et-warn);
  background: color-mix(in oklab, var(--et-warn), transparent 88%);
}
[data-bdoc-health="unreachable"], [data-bdoc-health="unsupported"] {
  color: var(--et-danger);
  background: var(--et-danger-soft);
}
[data-bdoc-autofix] {
  margin: 0 0 8px; padding: 6px 10px; border-radius: var(--et-radius-sm);
  font-size: var(--et-text-micro); line-height: 1.5;
  color: var(--et-success);
  background: color-mix(in oklab, var(--et-success), transparent 90%);
  overflow-wrap: anywhere;
}
[data-bdoc-rows] {
  display: flex; flex-direction: column;
  max-height: 264px; overflow-y: auto; scrollbar-gutter: stable;
  padding-right: 4px; margin: 0 -2px;
}
[data-bdoc-row] {
  display: flex; align-items: center; gap: 10px;
  padding: 6px 0; min-height: 32px;
}
[data-bdoc-row] + [data-bdoc-row] {
  border-top: 1px solid var(--et-border-soft);
}
[data-bdoc-name] {
  flex: 0 0 auto; min-width: 150px; max-width: 260px;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  font-weight: var(--et-weight-display); color: var(--et-fg);
}
[data-bdoc-result] {
  flex: 1 1 auto; min-width: 0;
  font-size: var(--et-text-micro); line-height: 1.5;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
[data-bdoc-result="idle"] { color: var(--et-muted); }
[data-bdoc-result="ok"] { color: var(--et-success); }
[data-bdoc-result="fail"] { color: var(--et-danger); }
[data-bdoc-btn] { flex: 0 0 auto; margin-left: auto; }
[data-bdoc-empty] {
  font-size: var(--et-text-micro); color: var(--et-muted); margin-top: 4px;
}
`

/** 注入诊断区块样式(幂等;颜色全部走语义令牌,深浅主题自动跟随)。 */
export function installDoctorStyles(): void {
  injectDesignTokens({ bridge: true })
  if (document.getElementById('llm-doctor-styles') !== null) return
  const style = document.createElement('style')
  style.id = 'llm-doctor-styles'
  style.textContent = CSS
  document.head.append(style)
}
