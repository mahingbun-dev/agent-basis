/**
 * 面板样式 v3 —— apple.com 设计语言(用户 2026-11-05 指定)。
 * 映射规则:排版/留白/层级按 Apple 公开设计语言(SF 风格大标题、#1d1d1f 深灰正文、
 * #86868b 辅助灰、18px 大圆角卡、hairline 分隔、胶囊按钮);色彩仍只经
 * DSH 官方语义令牌(--dsw-alias-*),深/浅主题自动跟随,不写字面色值。
 * 滚动职责:root 自身 overflow-y:auto。
 */
const CSS = `
[data-basis-panel='root'] {
  height: 100%;
  overflow-y: auto;
  overflow-x: hidden;
  scrollbar-gutter: stable;
  display: block;
  padding: 56px 40px 96px;
  max-width: 760px;
  margin: 0 auto;
  font-family: var(--dsw-font-family, inherit);
  font-size: 14px;
  line-height: 22px;
  min-width: 0;
}
[data-basis-panel='root'] * { min-width: 0; overflow-wrap: anywhere; }

/* —— 头部:Apple 产品页式大标题 —— */
[data-basis-panel='heading'] {
  margin: 0; font-size: 32px; line-height: 38px; font-weight: 700;
  letter-spacing: -0.015em; color: var(--dsw-alias-label-primary);
}
[data-basis-panel='sub'] { margin: 6px 0 0; font-size: 15px; line-height: 22px; color: var(--dsw-alias-label-tertiary); }
[data-basis-panel='toolbar'] { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-bottom: 8px; }
[data-basis-panel='refresh'] {
  padding: 5px 14px; font: inherit; font-size: 12px; cursor: pointer;
  color: var(--dsw-alias-label-secondary); background: transparent;
  border: 1px solid var(--dsw-alias-border-l2); border-radius: 980px;
}
[data-basis-panel='refresh']:hover { background: var(--dsw-alias-interactive-bg-hover); color: var(--dsw-alias-label-primary); }

/* —— section 节奏:大留白 + 细分区隔(Apple section 间距) —— */
[data-basis-panel='section'] { margin: 0 0 56px; display: flex; flex-direction: column; gap: 16px; }
[data-basis-panel='section-title'] {
  margin: 0; font-size: 21px; line-height: 26px; font-weight: 600;
  letter-spacing: -0.01em; color: var(--dsw-alias-label-primary);
}
[data-basis-panel='section-note'] { margin: -8px 0 0; font-size: 13px; line-height: 20px; color: var(--dsw-alias-label-tertiary); }

/* —— 三步上手:三列极简(大序号) —— */
[data-basis-panel='steps'] {
  display: grid; grid-template-columns: repeat(3, 1fr); gap: 24px;
  margin: 0 0 56px; padding: 0; background: none; border: 0;
}
[data-basis-panel='steps-title'] { display: none; }
[data-basis-panel='step'] { display: flex; flex-direction: column; gap: 4px; }
[data-basis-panel='step-no'] { font-size: 28px; line-height: 32px; font-weight: 700; color: var(--dsw-alias-label-tertiary); }
[data-basis-panel='step-text'] { font-size: 13px; line-height: 18px; color: var(--dsw-alias-label-secondary); }

/* —— 服务状态:大数字瓦片(无壳,Apple 统计区) —— */
[data-basis-panel='cards'] { display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: 20px; }
[data-basis-panel='card'] { display: flex; flex-direction: column; gap: 6px; min-width: 0; }
[data-basis-panel='card-kicker'] { font-size: 12px; line-height: 16px; font-weight: 500; color: var(--dsw-alias-label-tertiary); }
[data-basis-panel='card-count'] { color: var(--dsw-alias-label-tertiary); font-weight: 400; }
[data-basis-panel='tile-row'] { display: flex; align-items: baseline; gap: 28px; }
[data-basis-panel='metric-value'] { font-size: 32px; line-height: 36px; font-weight: 600; font-variant-numeric: tabular-nums; letter-spacing: -0.02em; color: var(--dsw-alias-label-primary); }
[data-basis-panel='metric-label'] { font-size: 12px; line-height: 16px; color: var(--dsw-alias-label-tertiary); }
[data-basis-panel='kv'] { display: grid; grid-template-columns: auto minmax(0, 1fr); gap: 2px 12px; }
[data-basis-panel='kv-key'] { font-size: 12px; line-height: 18px; color: var(--dsw-alias-label-tertiary); }
[data-basis-panel='kv-value'] { font-size: 12px; line-height: 18px; color: var(--dsw-alias-label-secondary); overflow-wrap: anywhere; }

/* —— 记忆:Apple 备忘录式分组大卡(hairline 分隔,内容可读性优先) —— */
[data-basis-panel='mem-group'] {
  border-radius: 18px; padding: 4px 20px;
  background: var(--dsw-alias-bg-layer-1, transparent);
  border: 0.5px solid var(--dsw-alias-border-l2);
}
[data-basis-panel='mem-group'] + [data-basis-panel='mem-group'] { margin-top: 12px; }
[data-basis-panel='mem-subject'] {
  padding: 12px 0 8px; font-size: 13px; font-weight: 600;
  color: var(--dsw-alias-label-secondary);
  border-bottom: 0.5px solid var(--dsw-alias-border-l3);
}
[data-basis-panel='mem-entity'] { padding: 12px 0; border-bottom: 0.5px solid var(--dsw-alias-border-l3); }
[data-basis-panel='mem-entity']:last-child { border-bottom: 0; }
[data-basis-panel='mem-entity-head'] { display: flex; align-items: baseline; gap: 8px; margin-bottom: 4px; }
[data-basis-panel='mem-entity-key'] { font-size: 12px; font-weight: 600; color: var(--dsw-alias-label-secondary); }
[data-basis-panel='mem-entity-time'] { margin-left: auto; font-size: 11px; color: var(--dsw-alias-label-tertiary); }
[data-basis-panel='mem-entity-content'] { font-size: 13px; line-height: 20px; color: var(--dsw-alias-label-primary); white-space: pre-wrap; }

/* —— 工具清单:Apple 列表行(hairline 分隔,主次两级文字) —— */
[data-basis-panel='card'][data-basis-panel-card='event-tools'] { grid-column: 1 / -1; }
[data-basis-panel='tool-list'] { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; }
[data-basis-panel='tool'] {
  display: flex; align-items: flex-start; gap: 16px;
  padding: 14px 4px; border-bottom: 0.5px solid var(--dsw-alias-border-l3);
}
[data-basis-panel='tool']:last-child { border-bottom: 0; }
[data-basis-panel='tool-head'] { display: flex; flex-direction: column; gap: 1px; flex: none; width: 200px; }
[data-basis-panel='tool-label'] { font-size: 14px; line-height: 20px; font-weight: 600; color: var(--dsw-alias-label-primary); }
[data-basis-panel='tool-id'] { font-size: 11px; color: var(--dsw-alias-label-tertiary); overflow-wrap: anywhere; }
[data-basis-panel='tool-desc'] { flex: 1; font-size: 13px; line-height: 20px; color: var(--dsw-alias-label-secondary); }
[data-basis-panel='risk'] {
  flex: none; align-self: center; margin-left: auto;
  font-size: 11px; font-weight: 600; line-height: 20px; padding: 1px 10px;
  border-radius: 980px;
}
[data-basis-panel-risk='R3'] { color: var(--dsw-alias-state-error-primary); background: color-mix(in srgb, var(--dsw-alias-state-error-primary) 12%, transparent); }
[data-basis-panel-risk='R2'] { color: var(--dsw-alias-state-warn-primary); background: color-mix(in srgb, var(--dsw-alias-state-warn-primary) 14%, transparent); }
[data-basis-panel-risk='R1'] { color: var(--dsw-alias-label-tertiary); background: var(--dsw-alias-interactive-bg-hover); }

/* —— 操作指引:卡片化示例(胶囊复制钮,Apple 蓝) —— */
[data-basis-panel='prompt'] {
  display: flex; flex-direction: column; gap: 6px; min-width: 0;
  padding: 14px 16px; border-radius: 18px;
  background: var(--dsw-alias-bg-layer-1, transparent);
  border: 0.5px solid var(--dsw-alias-border-l2);
}
[data-basis-panel='prompt-head'] { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
[data-basis-panel='prompt-title'] { font-size: 14px; font-weight: 600; color: var(--dsw-alias-label-primary); }
[data-basis-panel='prompt-capability'] { font-size: 12px; color: var(--dsw-alias-label-tertiary); }
[data-basis-panel='prompt-copy'] {
  margin-left: auto; padding: 4px 14px; font: inherit; font-size: 12px; cursor: pointer;
  color: var(--dsw-alias-state-business-primary); background: transparent; border: 0;
}
[data-basis-panel='prompt-copy']:hover { text-decoration: underline; }
[data-basis-panel='prompt-text'] { margin: 0; font-size: 13px; line-height: 20px; color: var(--dsw-alias-label-secondary); }
[data-basis-panel='prompt-note'] { margin: 0; font-size: 11px; line-height: 16px; color: var(--dsw-alias-state-error-primary); }

/* —— 可观测:会话行(hairline) —— */
[data-basis-panel='session'] { display: flex; flex-direction: column; gap: 2px; min-width: 0; padding: 12px 0; border-bottom: 0.5px solid var(--dsw-alias-border-l3); }
[data-basis-panel='session-id'] { font-size: 12px; color: var(--dsw-alias-label-secondary); overflow-wrap: anywhere; }
[data-basis-panel='session-metrics'] { display: flex; gap: 14px; flex-wrap: wrap; font-variant-numeric: tabular-nums; font-size: 12px; color: var(--dsw-alias-label-tertiary); }
[data-basis-panel='session-last'] { font-size: 11px; color: var(--dsw-alias-label-tertiary); }

[data-basis-panel='placeholder'] { font-size: 13px; color: var(--dsw-alias-label-tertiary); }
[data-basis-panel='error'] { color: var(--dsw-alias-state-error-primary); overflow-wrap: anywhere; }

/* —— chips(composer dock):Apple 胶囊 —— */
[data-basis-panel='chips'] { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; padding: 2px 4px 8px; }
[data-basis-panel='chips-label'] { font-size: 12px; color: var(--dsw-alias-label-tertiary); }
[data-basis-panel='chip'] {
  padding: 4px 14px; font: inherit; font-size: 12px; line-height: 18px; cursor: pointer;
  color: var(--dsw-alias-state-business-primary);
  background: color-mix(in srgb, var(--dsw-alias-state-business-primary) 10%, transparent);
  border: 0; border-radius: 980px;
}
[data-basis-panel='chip']:hover:not(:disabled) { background: color-mix(in srgb, var(--dsw-alias-state-business-primary) 20%, transparent); }
[data-basis-panel='chip']:disabled { opacity: 0.45; cursor: default; }
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
