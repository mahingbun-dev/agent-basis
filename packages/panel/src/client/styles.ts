/**
 * 面板样式:一次性注入的插件自有 <style>。
 * 全部走 DSH 官方语义令牌(--dsw-alias-* / --dsw-radius-* / --dsw-font-family,
 * 与 ui-plugin-market 等官方面板同源,浅/深主题自动跟随);不写字面色值。
 * 滚动职责:root 自身 overflow-y:auto(main 插槽不提供滚动,用户反馈已修)。
 * 防溢出:所有容器 min-width:0,长文本 overflow-wrap:anywhere(用户反馈已修)。
 */
const CSS = `
[data-basis-panel='root'] {
  height: 100%;
  overflow-y: auto;
  overflow-x: hidden;
  scrollbar-gutter: stable;
  display: flex;
  flex-direction: column;
  gap: 28px;
  padding: 20px 28px 56px;
  max-width: 860px;
  margin: 0 auto;
  font-family: var(--dsw-font-family, inherit);
  font-size: 13px;
  line-height: 20px;
  min-width: 0;
}
[data-basis-panel='root'] * { min-width: 0; overflow-wrap: anywhere; }

[data-basis-panel='heading'] { margin: 0; font-size: 20px; line-height: 28px; font-weight: 600; color: var(--dsw-alias-label-primary); }
[data-basis-panel='sub'] { margin: 2px 0 0; font-size: 13px; color: var(--dsw-alias-label-tertiary); }
[data-basis-panel='toolbar'] { display: flex; align-items: center; gap: 12px; }
[data-basis-panel='refresh'] {
  margin-left: auto; padding: 4px 12px; font: inherit; font-size: 12px;
  color: var(--dsw-alias-label-secondary); background: transparent;
  border: 0.5px solid var(--dsw-alias-border-l2); border-radius: var(--dsw-radius-md, 8px); cursor: pointer;
}
[data-basis-panel='refresh']:hover { background: var(--dsw-alias-interactive-bg-hover); color: var(--dsw-alias-label-primary); }

[data-basis-panel='steps'] {
  display: flex; flex-wrap: wrap; align-items: center; gap: 8px 18px;
  padding: 10px 14px; border-radius: var(--dsw-radius-lg, 12px);
  background: var(--dsw-alias-state-warn-tertiary, var(--dsw-alias-bg-layer-2));
  color: var(--dsw-alias-label-secondary); font-size: 12px; line-height: 18px;
}
[data-basis-panel='steps-title'] { flex: none; font-weight: 600; color: var(--dsw-alias-label-primary); }

[data-basis-panel='section'] { display: flex; flex-direction: column; gap: 10px; }
[data-basis-panel='section-title'] { margin: 0; font-size: 15px; line-height: 22px; font-weight: 600; color: var(--dsw-alias-label-primary); }
[data-basis-panel='section-note'] { margin: 0; font-size: 12px; line-height: 18px; color: var(--dsw-alias-label-tertiary); overflow-wrap: anywhere; }

[data-basis-panel='cards'] { display: grid; grid-template-columns: repeat(auto-fill, minmax(240px, 1fr)); gap: 8px; }
[data-basis-panel='card'] {
  display: flex; flex-direction: column; gap: 6px; min-width: 0;
  padding: 12px 14px; border-radius: var(--dsw-radius-xl, 14px);
  background: var(--dsw-alias-bg-layer-1, transparent);
  border: 0.5px solid var(--dsw-alias-border-l2);
}
[data-basis-panel='card']:hover { background: var(--dsw-alias-interactive-bg-hover); }
[data-basis-panel='card-title'] { display: flex; align-items: center; gap: 8px; font-size: 14px; line-height: 20px; font-weight: 500; color: var(--dsw-alias-label-primary); }
[data-basis-panel='card-count'] { color: var(--dsw-alias-label-tertiary); font-weight: 400; }
[data-basis-panel='metric'] { display: inline-flex; align-items: baseline; gap: 6px; }
[data-basis-panel='metric-value'] { font-size: 16px; font-weight: 600; font-variant-numeric: tabular-nums; color: var(--dsw-alias-label-primary); }
[data-basis-panel='metric-label'] { font-size: 12px; color: var(--dsw-alias-label-tertiary); }
[data-basis-panel='kv'] { display: grid; grid-template-columns: auto minmax(0, 1fr); gap: 2px 12px; font-variant-numeric: tabular-nums; }
[data-basis-panel='kv-key'] { font-size: 12px; color: var(--dsw-alias-label-tertiary); }
[data-basis-panel='kv-value'] { font-size: 12px; color: var(--dsw-alias-label-secondary); overflow-wrap: anywhere; }

[data-basis-panel='tool-list'] { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 2px; }
[data-basis-panel='tool'] { display: flex; flex-direction: column; gap: 1px; padding: 6px 8px; border-radius: var(--dsw-radius-md, 8px); }
[data-basis-panel='tool']:hover { background: var(--dsw-alias-interactive-bg-hover); }
[data-basis-panel='tool-head'] { display: flex; align-items: center; gap: 8px; min-width: 0; }
[data-basis-panel='tool-label'] { font-size: 13px; font-weight: 500; color: var(--dsw-alias-label-primary); }
[data-basis-panel='tool-id'] { font-size: 11px; color: var(--dsw-alias-label-tertiary); }
[data-basis-panel='tool-desc'] { font-size: 12px; line-height: 18px; color: var(--dsw-alias-label-tertiary); overflow-wrap: anywhere; }
[data-basis-panel='risk'] {
  flex: none; font-size: 10px; font-weight: 600; line-height: 16px;
  padding: 0 6px; border-radius: 999px; letter-spacing: 0.02em;
}
[data-basis-panel-risk='R3'] { color: var(--dsw-alias-state-error-primary); background: color-mix(in srgb, var(--dsw-alias-state-error-primary) 12%, transparent); }
[data-basis-panel-risk='R2'] { color: var(--dsw-alias-state-warn-primary); background: color-mix(in srgb, var(--dsw-alias-state-warn-primary) 12%, transparent); }
[data-basis-panel-risk='R1'] { color: var(--dsw-alias-label-secondary); background: var(--dsw-alias-interactive-bg-hover); }

[data-basis-panel='prompt'] { display: flex; flex-direction: column; gap: 4px; min-width: 0; padding: 10px 12px; border-radius: var(--dsw-radius-lg, 12px); background: var(--dsw-alias-bg-layer-1, transparent); border: 0.5px solid var(--dsw-alias-border-l2); }
[data-basis-panel='prompt']:hover { background: var(--dsw-alias-interactive-bg-hover); }
[data-basis-panel='prompt-head'] { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
[data-basis-panel='prompt-title'] { font-size: 13px; font-weight: 500; color: var(--dsw-alias-label-primary); }
[data-basis-panel='prompt-capability'] { font-size: 11px; color: var(--dsw-alias-label-tertiary); }
[data-basis-panel='prompt-copy'] {
  margin-left: auto; padding: 2px 10px; font: inherit; font-size: 12px; cursor: pointer;
  color: var(--dsw-alias-label-secondary); background: transparent;
  border: 0.5px solid var(--dsw-alias-border-l2); border-radius: var(--dsw-radius-md, 8px);
}
[data-basis-panel='prompt-copy']:hover { background: var(--dsw-alias-interactive-bg-hover); color: var(--dsw-alias-label-primary); }
[data-basis-panel='prompt-text'] { margin: 0; font-size: 12px; line-height: 18px; color: var(--dsw-alias-label-secondary); }
[data-basis-panel='prompt-note'] { margin: 0; font-size: 11px; line-height: 16px; color: var(--dsw-alias-state-error-primary); }

[data-basis-panel='session'] { display: flex; flex-direction: column; gap: 2px; min-width: 0; padding: 10px 12px; border-radius: var(--dsw-radius-lg, 12px); background: var(--dsw-alias-bg-layer-1, transparent); border: 0.5px solid var(--dsw-alias-border-l2); }
[data-basis-panel='session-id'] { font-size: 12px; color: var(--dsw-alias-label-secondary); overflow-wrap: anywhere; }
[data-basis-panel='session-metrics'] { display: flex; gap: 14px; flex-wrap: wrap; font-variant-numeric: tabular-nums; font-size: 12px; color: var(--dsw-alias-label-tertiary); }
[data-basis-panel='session-last'] { font-size: 11px; color: var(--dsw-alias-label-tertiary); }

[data-basis-panel='placeholder'] { font-size: 12px; color: var(--dsw-alias-label-tertiary); }
[data-basis-panel='error'] { color: var(--dsw-alias-state-error-primary); overflow-wrap: anywhere; }
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
