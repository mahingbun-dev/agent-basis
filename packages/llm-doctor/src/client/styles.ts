/**
 * 诊断区块样式——对齐产品设计纪律(对齐 prompt-studio styles.ts):色彩只经
 * DSH 官方语义令牌(--dsw-alias-*),深/浅主题自动跟随,不写字面色值。
 * 注入一次(style#llm-doctor-styles),选择器全部挂 [data-bdoc] 命名空间。
 */
const CSS = `
[data-bdoc-root] {
  margin-top: 12px;
  padding: 10px 14px 8px;
  border: 1px solid var(--dsw-alias-border-l2);
  border-radius: 12px;
  background: var(--dsw-alias-bg-layer-1, transparent);
  font-size: 13px;
  line-height: 20px;
  color: var(--dsw-alias-label-primary);
}
[data-bdoc-head] {
  display: flex; align-items: center; justify-content: space-between;
  gap: 10px; margin-bottom: 6px;
}
[data-bdoc-title] {
  font-weight: 600; font-size: 12px; line-height: 18px;
  color: var(--dsw-alias-label-secondary); letter-spacing: 0.02em;
}
[data-bdoc-health] {
  font-size: 12px; line-height: 18px; padding: 0 8px; border-radius: 980px;
  white-space: nowrap;
}
[data-bdoc-health="ok"] {
  color: var(--dsw-alias-state-success-primary);
  background: var(--dsw-alias-state-success-tertiary);
}
[data-bdoc-health="missing"] {
  color: var(--dsw-alias-state-warn-label);
  background: var(--dsw-alias-state-warn-primary);
}
[data-bdoc-health="unreachable"], [data-bdoc-health="unsupported"] {
  color: var(--dsw-alias-state-error-primary);
  background: var(--dsw-alias-state-error-secondary);
}
[data-bdoc-autofix] {
  margin: 0 0 6px; padding: 4px 8px; border-radius: 8px;
  font-size: 12px; line-height: 18px;
  color: var(--dsw-alias-state-success-primary);
  background: var(--dsw-alias-state-success-tertiary);
  overflow-wrap: anywhere;
}
[data-bdoc-rows] {
  display: flex; flex-direction: column;
  max-height: 264px; overflow-y: auto; scrollbar-gutter: stable;
  padding-right: 4px; margin: 0 -2px;
}
[data-bdoc-row] {
  display: flex; align-items: center; gap: 10px;
  padding: 4px 0; min-height: 28px;
}
[data-bdoc-row] + [data-bdoc-row] {
  border-top: 1px solid var(--dsw-alias-border-l1, var(--dsw-alias-border-l2));
}
[data-bdoc-name] {
  flex: 0 0 auto; min-width: 150px; max-width: 260px;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  font-weight: 500; color: var(--dsw-alias-label-primary);
}
[data-bdoc-result] {
  flex: 1 1 auto; min-width: 0;
  font-size: 12px; line-height: 18px;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
[data-bdoc-result="idle"] { color: var(--dsw-alias-label-tertiary); }
[data-bdoc-result="ok"] { color: var(--dsw-alias-state-success-primary); }
[data-bdoc-result="fail"] { color: var(--dsw-alias-state-error-primary); }
[data-bdoc-btn] { flex: 0 0 auto; margin-left: auto; }
[data-bdoc-empty] {
  font-size: 12px; color: var(--dsw-alias-label-tertiary); margin-top: 4px;
}
`

/** 注入诊断区块样式(幂等;颜色全部走语义令牌,深浅主题自动跟随)。 */
export function installDoctorStyles(): void {
  if (document.getElementById('llm-doctor-styles') !== null) return
  const style = document.createElement('style')
  style.id = 'llm-doctor-styles'
  style.textContent = CSS
  document.head.append(style)
}
