/**
 * 设置分区样式:DSH 官方语义令牌(--dsw-alias-*),深浅主题自动跟随产品,
 * 零字面色(品牌渐变头像唯一豁免)。注入一次,三个分区共用。
 */
const CSS = `
[data-eterna-access-root] { font-family: var(--dsw-font-family, inherit); font-size: 14px; line-height: 22px; color: var(--dsw-alias-label-primary); max-width: 720px; }
[data-eterna-access-root], [data-eterna-access-root] *, [data-eterna-access-root] *::before, [data-eterna-access-root] *::after { box-sizing: border-box; }
[data-eterna-access-root] * { min-width: 0; overflow-wrap: anywhere; }
[data-eterna-access-root] .ea-lead { margin: 0 0 18px; color: var(--dsw-alias-label-tertiary); font-size: 13px; }
[data-eterna-access-root] .ea-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 24px; }
[data-eterna-access-root] .ea-card { border: 1px solid color-mix(in srgb, var(--dsw-alias-label-primary) 10%, transparent); border-radius: 14px; padding: 18px;
  background: var(--dsw-alias-settings-card-fill, transparent); }
[data-eterna-access-root] .ea-card h3 { margin: 0 0 12px; font-size: 14px; font-weight: 600; }
[data-eterna-access-root] label.ea-label { display: block; font-size: 12px; color: var(--dsw-alias-label-tertiary); margin: 10px 0 4px; }
[data-eterna-access-root] input.ea-input, [data-eterna-access-root] select.ea-input {
  width: 100%; padding: 8px 10px; border-radius: 8px; font-size: 13.5px;
  border: 1px solid color-mix(in srgb, var(--dsw-alias-label-primary) 12%, transparent);
  background: color-mix(in srgb, var(--dsw-alias-label-primary) 5%, transparent); color: var(--dsw-alias-label-primary); }
[data-eterna-access-root] input.ea-input:focus { outline: none; border-color: var(--dsw-alias-state-business-primary, currentColor); box-shadow: 0 0 0 3px color-mix(in srgb, var(--dsw-alias-state-business-primary, currentColor) 22%, transparent); }
[data-eterna-access-root] input[type=file].ea-input { color: var(--dsw-alias-label-tertiary); }
[data-eterna-access-root] .ea-btn { margin: 0; padding: 8px 18px; border: 0; border-radius: 8px; font-size: 13.5px; font-weight: 500; cursor: pointer;
  background: var(--dsw-alias-button-primary-fill, currentColor); color: var(--dsw-alias-label-primary-foreground, #0f1115); }
[data-eterna-access-root] .ea-btn:hover { background: var(--dsw-alias-button-primary-hover, inherit); filter: none; }
[data-eterna-access-root] .ea-btn:disabled { opacity: .5; cursor: not-allowed; }
[data-eterna-access-root] .ea-btn.ghost { background: transparent; color: var(--dsw-alias-label-primary); border: 1px solid color-mix(in srgb, var(--dsw-alias-label-primary) 14%, transparent); }
[data-eterna-access-root] .ea-row { display: flex; gap: 10px; align-items: center; }
[data-eterna-access-root] .ea-row.between { justify-content: space-between; }
[data-eterna-access-root] .ea-ok { color: var(--dsw-alias-state-success-primary, #22c55e); font-size: 12.5px; min-height: 16px; margin: 8px 0 0; }
[data-eterna-access-root] .ea-err { color: var(--dsw-alias-state-error-primary, #f25a5a); font-size: 12.5px; min-height: 16px; margin: 8px 0 0; white-space: pre-wrap; }
[data-eterna-access-root] .ea-hint { color: var(--dsw-alias-label-tertiary); font-size: 12px; }
[data-eterna-access-root] .ea-avatar { width: 40px; height: 40px; border-radius: 50%; background: linear-gradient(135deg,#6366f1,#8b5cf6); color: #fff;
  display: inline-flex; align-items: center; justify-content: center; font-size: 19px; overflow: hidden; flex: none; }
[data-eterna-access-root] .ea-avatar img { width: 100%; height: 100%; border-radius: 50%; object-fit: cover; }
[data-eterna-access-root] table.ea-table { width: 100%; border-collapse: collapse; font-size: 13px; margin-top: 8px; }
[data-eterna-access-root] .ea-table th, [data-eterna-access-root] .ea-table td { padding: 7px 8px; text-align: left; border-bottom: 1px solid color-mix(in srgb, var(--dsw-alias-label-primary) 8%, transparent); }
[data-eterna-access-root] .ea-table th { color: var(--dsw-alias-label-tertiary); font-weight: 600; }
[data-eterna-access-root] .ea-tag { font-size: 11px; padding: 2px 7px; border-radius: 6px; background: var(--dsw-alias-fill-primary, transparent); color: var(--dsw-alias-label-tertiary); }
[data-eterna-access-root] .ea-tag.brand { color: var(--dsw-alias-state-business-primary, currentColor); }
[data-eterna-access-root] .ea-tag.red { color: var(--dsw-alias-state-error-primary, #f25a5a); }
[data-eterna-access-root] .ea-dangerclick { color: var(--dsw-alias-state-error-primary, #f25a5a); cursor: pointer; background: none; border: 0; padding: 0; font-size: 13px; }
[data-eterna-access-root] .ea-dangerclick:hover { text-decoration: underline; }
[data-eterna-access-root] .ea-plug { padding: 10px 0; border-bottom: 1px solid color-mix(in srgb, var(--dsw-alias-label-primary) 8%, transparent); display: flex; flex-direction: column; gap: 3px; }
[data-eterna-access-root] .ea-plug:last-child { border-bottom: 0; }
[data-eterna-access-root] .ea-plug .name { font-weight: 600; font-size: 13.5px; }
[data-eterna-access-root] .ea-plug .pid { color: var(--dsw-alias-label-tertiary); font-size: 12px; }

/* —— 「恒灵插件」页签:与原生插件页(dsh-client-ui-plugin-manager)同构的卡片形态 ——
   分组头/行卡/48px 图标块/开关/胶囊徽标,全部走令牌;插画渐变在 plugin-meta.tsx(品牌插画豁免)。 */
[data-eterna-access-root] .ea-group { display: flex; flex-direction: column; gap: 8px; }
[data-eterna-access-root] .ea-group + .ea-group { margin-top: 32px; }
[data-eterna-access-root] .ea-group-head { display: flex; align-items: center; gap: 8px; }
[data-eterna-access-root] .ea-group-title { flex: 1; margin: 0; font-size: 14px; font-weight: 500; line-height: 22px; }
[data-eterna-access-root] .ea-group-hint { flex: none; font-size: 12px; color: var(--dsw-alias-label-tertiary); }
[data-eterna-access-root] .ea-cards { display: flex; flex-direction: column; gap: 2px; margin: 0; padding: 0; list-style: none; }
[data-eterna-access-root] .ea-pcard { border-radius: var(--dsw-radius-xl, 20px); margin: 0 -8px; min-width: 0; }
@media (hover: hover) {
  [data-eterna-access-root] .ea-pcard.ea-act:hover { background: var(--dsw-alias-interactive-bg-hover); }
  [data-eterna-access-root] .ea-pcard.ea-act:active { background: var(--dsw-alias-interactive-bg-active); }
}
[data-eterna-access-root] .ea-phead { display: flex; align-items: center; gap: 14px; padding: 8px; }
[data-eterna-access-root] .ea-picon { display: inline-flex; align-items: center; justify-content: center; flex: none;
  width: 48px; height: 48px; border: .5px solid var(--dsw-alias-border-l3, transparent); border-radius: var(--dsw-radius-lg, 16px);
  color: var(--dsw-alias-label-secondary); }
[data-eterna-access-root] .ea-pmain { display: flex; flex-direction: column; flex: 1; gap: 4px; min-width: 0; }
[data-eterna-access-root] .ea-ptitle-row { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; min-width: 0; }
[data-eterna-access-root] .ea-ptitle { font-size: 14px; font-weight: 500; line-height: 20px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
[data-eterna-access-root] .ea-pdesc { color: var(--dsw-alias-label-tertiary); font-size: 13px; line-height: 18px;
  display: -webkit-box; -webkit-line-clamp: 1; -webkit-box-orient: vertical; overflow: hidden; }
[data-eterna-access-root] .ea-pend { display: inline-flex; align-items: center; gap: 8px; flex: none; position: relative; z-index: 1; }
[data-eterna-access-root] .ea-switch { box-sizing: border-box; position: relative; flex: 0 0 auto; width: 36px; height: 20px; padding: 2px;
  border: 0; border-radius: 999px; background: var(--dsw-alias-border-l3); cursor: pointer; }
[data-eterna-access-root] .ea-switch[aria-checked="true"] { background: var(--dsw-alias-brand-primary); }
[data-eterna-access-root] .ea-switch:disabled { cursor: default; opacity: .5; }
[data-eterna-access-root] .ea-switch::after { content: ""; position: absolute; inset: -8px; }
[data-eterna-access-root] .ea-switch .ea-thumb { display: block; width: 16px; height: 16px; border-radius: 50%;
  background: var(--dsw-alias-switch-thumb, var(--dsw-alias-label-primary-foreground)); transition: transform .12s ease; }
[data-eterna-access-root] .ea-switch[aria-checked="true"] .ea-thumb { transform: translate(16px); }
[data-eterna-access-root] .ea-switch:focus-visible, [data-eterna-access-root] .ea-del:focus-visible {
  outline: var(--dsw-focus-ring-width, 2px) solid var(--dsw-focus-ring-color, var(--dsw-alias-state-business-primary)); outline-offset: 2px; }
[data-eterna-access-root] .ea-del { min-height: 36px; padding: 0 10px; border: 0; border-radius: var(--dsw-radius-md, 12px);
  background: none; color: var(--dsw-alias-state-error-primary); font-size: 13px; cursor: pointer; }
[data-eterna-access-root] .ea-del:hover { background: var(--dsw-alias-interactive-bg-hover-danger, var(--dsw-alias-interactive-bg-hover)); }
[data-eterna-access-root] .ea-del.ea-armed { background: color-mix(in srgb, var(--dsw-alias-state-error-primary) 12%, transparent); font-weight: 500; }
[data-eterna-access-root] .ea-pill { display: inline-flex; align-items: center; border-radius: 999px; padding: 1px 8px;
  font-size: 11px; line-height: 17px; font-weight: 500; white-space: nowrap; }
[data-eterna-access-root] .ea-pill.danger { background: color-mix(in srgb, var(--dsw-alias-state-error-primary) 10%, transparent);
  color: var(--dsw-alias-state-error-primary); }
[data-eterna-access-root] .ea-pill.warn { background: color-mix(in srgb, var(--dsw-alias-state-warn-primary) 10%, transparent);
  color: var(--dsw-alias-state-warn-label, var(--dsw-alias-state-warn-primary)); }
[data-eterna-access-root] .ea-pill.neutral { background: var(--dsw-alias-bg-module-platform, color-mix(in srgb, var(--dsw-alias-label-primary) 8%, transparent));
  color: var(--dsw-alias-label-secondary); }

@media (prefers-reduced-motion: reduce) {
  [data-eterna-access-root] .ea-switch .ea-thumb { transition: none; }
}
@media (max-width: 760px) {
  [data-eterna-access-root] .ea-grid { grid-template-columns: 1fr; }
  [data-eterna-access-root] .ea-phead { gap: 10px; }
  [data-eterna-access-root] .ea-pcard { margin: 0 -4px; }
}
`

export function injectAccessStyles(): void {
  if (document.getElementById('eterna-access-styles') !== null) return
  const style = document.createElement('style')
  style.id = 'eterna-access-styles'
  style.textContent = CSS
  document.head.appendChild(style)
}
