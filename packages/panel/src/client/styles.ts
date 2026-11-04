/**
 * 面板样式:一次性注入的插件自有 <style>(工厂执行期,对齐 dsh 客户端包
 * x.css?inline 的生命周期语义)。颜色只经 --dsw-* 语义令牌,不写字面色值;
 * 令牌缺席时回退到继承色/边框,保证任何主题下可用。
 */
const CSS = `
[data-basis-panel='root'] { display: flex; flex-direction: column; gap: 20px; padding: 24px 28px 48px; max-width: 920px; margin: 0 auto; font-size: 13px; line-height: 1.55; }
[data-basis-panel='heading'] { margin: 0; font-size: 20px; font-weight: 600; }
[data-basis-panel='sub'] { margin: 2px 0 0; color: var(--dsw-fg-muted, inherit); opacity: var(--dsw-fg-muted-opacity, 0.7); }
[data-basis-panel='refresh'] { align-self: flex-start; margin-left: auto; }
[data-basis-panel='toolbar'] { display: flex; align-items: baseline; gap: 12px; }
[data-basis-panel='section'] { display: flex; flex-direction: column; gap: 10px; }
[data-basis-panel='section-title'] { margin: 0; font-size: 15px; font-weight: 600; }
[data-basis-panel='section-note'] { margin: 0; color: var(--dsw-fg-muted, inherit); opacity: var(--dsw-fg-muted-opacity, 0.7); font-size: 12px; }
[data-basis-panel='cards'] { display: grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap: 12px; }
[data-basis-panel='card'] { display: flex; flex-direction: column; gap: 6px; border: 1px solid var(--dsw-border, currentColor); border-radius: 10px; padding: 12px 14px; }
[data-basis-panel='card-title'] { font-weight: 600; }
[data-basis-panel='metric'] { display: flex; gap: 6px; flex-wrap: wrap; }
[data-basis-panel='metric-value'] { font-weight: 600; font-variant-numeric: tabular-nums; }
[data-basis-panel='metric-label'] { color: var(--dsw-fg-muted, inherit); opacity: var(--dsw-fg-muted-opacity, 0.7); }
[data-basis-panel='kv'] { display: grid; grid-template-columns: auto 1fr; gap: 2px 10px; font-variant-numeric: tabular-nums; }
[data-basis-panel='kv-key'] { color: var(--dsh-fg-muted, var(--dsw-fg-muted, inherit)); opacity: var(--dsw-fg-muted-opacity, 0.7); }
[data-basis-panel='tool-list'] { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 4px; }
[data-basis-panel='tool'] { display: flex; align-items: center; gap: 8px; font-family: var(--dsw-font-mono, ui-monospace, monospace); font-size: 12px; }
[data-basis-panel='risk'] { font-family: inherit; font-size: 10px; font-weight: 600; border-radius: 4px; padding: 1px 5px; border: 1px solid var(--dsw-border, currentColor); letter-spacing: 0.02em; }
[data-basis-panel-risk='R3'] { color: inherit; font-weight: 700; text-decoration: underline; }
[data-basis-panel='prompt'] { display: flex; flex-direction: column; gap: 4px; border: 1px solid var(--dsw-border, currentColor); border-radius: 8px; padding: 10px 12px; }
[data-basis-panel='prompt-head'] { display: flex; align-items: center; gap: 8px; }
[data-basis-panel='prompt-title'] { font-weight: 600; }
[data-basis-panel='prompt-capability'] { font-size: 11px; color: var(--dsw-fg-muted, inherit); opacity: var(--dsw-fg-muted-opacity, 0.7); }
[data-basis-panel='prompt-copy'] { margin-left: auto; font-size: 12px; }
[data-basis-panel='prompt-text'] { margin: 0; font-size: 12px; color: var(--dsw-fg-muted, inherit); opacity: var(--dsw-fg-muted-opacity, 0.85); }
[data-basis-panel='prompt-note'] { margin: 0; font-size: 11px; color: var(--dsw-fg-muted, inherit); opacity: var(--dsw-fg-muted-opacity, 0.7); }
[data-basis-panel='session'] { display: grid; grid-template-columns: 1fr auto; gap: 4px 12px; border: 1px solid var(--dsw-border, currentColor); border-radius: 8px; padding: 10px 12px; }
[data-basis-panel='session-id'] { font-family: var(--dsw-font-mono, ui-monospace, monospace); font-size: 11px; overflow-wrap: anywhere; }
[data-basis-panel='session-metrics'] { display: flex; gap: 14px; flex-wrap: wrap; font-variant-numeric: tabular-nums; font-size: 12px; }
[data-basis-panel='session-last'] { grid-column: 1 / -1; color: var(--dsw-fg-muted, inherit); opacity: var(--dsw-fg-muted-opacity, 0.7); font-size: 11px; }
[data-basis-panel='placeholder'] { color: var(--dsw-fg-muted, inherit); opacity: var(--dsw-fg-muted-opacity, 0.7); font-size: 12px; }
`

/** 幂等注入面板样式表(同文档重复装载时复用既有节点)。 */
export function injectPanelStyles(doc: Document = document): void {
  const marker = 'data-basis-panel-styles'
  if (doc.querySelector(`style[${marker}]`) !== null) return
  const style = doc.createElement('style')
  style.textContent = CSS
  style.setAttribute(marker, 'true')
  doc.head.append(style)
}
