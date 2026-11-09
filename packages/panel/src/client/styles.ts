/**
 * 面板样式 v3 —— apple.com 设计语言(用户 2026-11-05 指定)。
 * 映射规则:排版/留白/层级按 Apple 公开设计语言(SF 风格大标题、#1d1d1f 深灰正文、
 * #86868b 辅助灰、18px 大圆角卡、hairline 分隔、胶囊按钮);色彩仍只经
 * DSH 官方语义令牌(--dsw-alias-*),深/浅主题自动跟随,不写字面色值。
 * 滚动职责:root 自身 overflow-y:auto。
 */
const CSS = `
[data-eterna-panel='root'] {
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
[data-eterna-panel='root'] * { min-width: 0; overflow-wrap: anywhere; }

/* —— 头部:Apple 产品页式大标题 —— */
[data-eterna-panel='heading'] {
  margin: 0; font-size: 32px; line-height: 38px; font-weight: 700;
  letter-spacing: -0.015em; color: var(--dsw-alias-label-primary);
}
[data-eterna-panel='sub'] { margin: 6px 0 0; font-size: 15px; line-height: 22px; color: var(--dsw-alias-label-tertiary); }
[data-eterna-panel='toolbar'] { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-bottom: 8px; }
[data-eterna-panel='refresh'] {
  padding: 5px 14px; font: inherit; font-size: 12px; cursor: pointer;
  color: var(--dsw-alias-label-secondary); background: transparent;
  border: 1px solid var(--dsw-alias-border-l2); border-radius: 980px;
}
[data-eterna-panel='refresh']:hover { background: var(--dsw-alias-interactive-bg-hover); color: var(--dsw-alias-label-primary); }

/* —— section 节奏:大留白 + 细分区隔(Apple section 间距) —— */
[data-eterna-panel='section'] { margin: 0 0 56px; display: flex; flex-direction: column; gap: 16px; }
[data-eterna-panel='section-title'] {
  margin: 0; font-size: 21px; line-height: 26px; font-weight: 600;
  letter-spacing: -0.01em; color: var(--dsw-alias-label-primary);
}
[data-eterna-panel='section-note'] { margin: -8px 0 0; font-size: 13px; line-height: 20px; color: var(--dsw-alias-label-tertiary); }

/* —— 三步上手:三列极简(大序号) —— */
[data-eterna-panel='steps'] {
  display: grid; grid-template-columns: repeat(3, 1fr); gap: 24px;
  margin: 0 0 56px; padding: 0; background: none; border: 0;
}
[data-eterna-panel='steps-title'] { display: none; }
[data-eterna-panel='step'] { display: flex; flex-direction: column; gap: 4px; }
[data-eterna-panel='step-no'] { font-size: 28px; line-height: 32px; font-weight: 700; color: var(--dsw-alias-label-tertiary); }
[data-eterna-panel='step-text'] { font-size: 13px; line-height: 18px; color: var(--dsw-alias-label-secondary); }

/* —— 服务状态:大数字瓦片(无壳,Apple 统计区) —— */
[data-eterna-panel='cards'] { display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: 20px; }
[data-eterna-panel='card'] { display: flex; flex-direction: column; gap: 6px; min-width: 0; }
[data-eterna-panel='card-kicker'] { font-size: 12px; line-height: 16px; font-weight: 500; color: var(--dsw-alias-label-tertiary); }
[data-eterna-panel='card-count'] { color: var(--dsw-alias-label-tertiary); font-weight: 400; }
[data-eterna-panel='tile-row'] { display: flex; align-items: baseline; gap: 28px; }
[data-eterna-panel='metric-value'] { font-size: 32px; line-height: 36px; font-weight: 600; font-variant-numeric: tabular-nums; letter-spacing: -0.02em; color: var(--dsw-alias-label-primary); }
[data-eterna-panel='metric-label'] { font-size: 12px; line-height: 16px; color: var(--dsw-alias-label-tertiary); }
[data-eterna-panel='kv'] { display: grid; grid-template-columns: auto minmax(0, 1fr); gap: 2px 12px; }
[data-eterna-panel='kv-key'] { font-size: 12px; line-height: 18px; color: var(--dsw-alias-label-tertiary); }
[data-eterna-panel='kv-value'] { font-size: 12px; line-height: 18px; color: var(--dsw-alias-label-secondary); overflow-wrap: anywhere; }

/* —— 记忆:Apple 备忘录式分组大卡(hairline 分隔,内容可读性优先) —— */
[data-eterna-panel='mem-group'] {
  border-radius: 18px; padding: 4px 20px;
  background: var(--dsw-alias-bg-layer-1, transparent);
  border: 0.5px solid var(--dsw-alias-border-l2);
}
[data-eterna-panel='mem-group'] + [data-eterna-panel='mem-group'] { margin-top: 24px; }
[data-eterna-panel='mem-subject'] {
  padding: 12px 0 8px; font-size: 13px; font-weight: 600;
  color: var(--dsw-alias-label-secondary);
  border-bottom: 0.5px solid var(--dsw-alias-border-l3);
}
[data-eterna-panel='mem-entity'] { padding: 14px 0; border-bottom: 0.5px solid var(--dsw-alias-border-l3); }
[data-eterna-panel='mem-entity']:last-child { border-bottom: 0; padding-bottom: 4px; }
[data-eterna-panel='mem-entity-head'] { display: flex; align-items: baseline; gap: 10px; margin-bottom: 6px; }
[data-eterna-panel='mem-entity-key'] { font-size: 12px; font-weight: 600; color: var(--dsw-alias-label-secondary); }
[data-eterna-panel='mem-entity-time'] { margin-left: auto; font-size: 11px; color: var(--dsw-alias-label-tertiary); }
[data-eterna-panel='mem-entity-content'] { font-size: 13px; line-height: 21px; color: var(--dsw-alias-label-primary); white-space: pre-wrap; }
[data-eterna-panel='mem-entity-content'][data-eterna-panel-clamped='true'] {
  display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden;
}
[data-eterna-panel='mem-expand'] {
  margin-top: 6px; padding: 0; font: inherit; font-size: 12px; cursor: pointer;
  color: var(--dsw-alias-state-business-primary); background: none; border: 0;
}
[data-eterna-panel='mem-expand']:hover { text-decoration: underline; }

/* —— 工具清单:Apple 列表行(hairline 分隔,主次两级文字) —— */
[data-eterna-panel='card'][data-eterna-panel-card='event-tools'] { grid-column: 1 / -1; }
[data-eterna-panel='tool-list'] { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; }
[data-eterna-panel='tool'] {
  display: flex; align-items: flex-start; gap: 16px;
  padding: 14px 4px; border-bottom: 0.5px solid var(--dsw-alias-border-l3);
}
[data-eterna-panel='tool']:last-child { border-bottom: 0; }
[data-eterna-panel='tool-head'] { display: flex; flex-direction: column; gap: 1px; flex: none; width: 200px; }
[data-eterna-panel='tool-label'] { font-size: 14px; line-height: 20px; font-weight: 600; color: var(--dsw-alias-label-primary); }
[data-eterna-panel='tool-id'] { font-size: 11px; color: var(--dsw-alias-label-tertiary); overflow-wrap: anywhere; }
[data-eterna-panel='tool-desc'] { flex: 1; font-size: 13px; line-height: 20px; color: var(--dsw-alias-label-secondary); }
[data-eterna-panel='risk'] {
  flex: none; align-self: center; margin-left: auto;
  font-size: 11px; font-weight: 600; line-height: 20px; padding: 1px 10px;
  border-radius: 980px;
}
[data-eterna-panel-risk='R3'] { color: var(--dsw-alias-state-error-primary); background: color-mix(in srgb, var(--dsw-alias-state-error-primary) 12%, transparent); }
[data-eterna-panel-risk='R2'] { color: var(--dsw-alias-state-warn-primary); background: color-mix(in srgb, var(--dsw-alias-state-warn-primary) 14%, transparent); }
[data-eterna-panel-risk='R1'] { color: var(--dsw-alias-label-tertiary); background: var(--dsw-alias-interactive-bg-hover); }

/* —— 操作指引:卡片化示例(胶囊复制钮,Apple 蓝) —— */
[data-eterna-panel='prompt'] {
  display: flex; flex-direction: column; gap: 6px; min-width: 0;
  padding: 14px 16px; border-radius: 18px;
  background: var(--dsw-alias-bg-layer-1, transparent);
  border: 0.5px solid var(--dsw-alias-border-l2);
}
[data-eterna-panel='prompt-head'] { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
[data-eterna-panel='prompt-title'] { font-size: 14px; font-weight: 600; color: var(--dsw-alias-label-primary); }
[data-eterna-panel='prompt-capability'] { font-size: 12px; color: var(--dsw-alias-label-tertiary); }
[data-eterna-panel='prompt-copy'] {
  margin-left: auto; padding: 4px 14px; font: inherit; font-size: 12px; cursor: pointer;
  color: var(--dsw-alias-state-business-primary); background: transparent; border: 0;
}
[data-eterna-panel='prompt-copy']:hover { text-decoration: underline; }
[data-eterna-panel='prompt-text'] { margin: 0; font-size: 13px; line-height: 20px; color: var(--dsw-alias-label-secondary); }
[data-eterna-panel='prompt-note'] { margin: 0; font-size: 11px; line-height: 16px; color: var(--dsw-alias-state-error-primary); }

/* —— 可观测:会话行(hairline) —— */
[data-eterna-panel='session'] { display: flex; flex-direction: column; gap: 2px; min-width: 0; padding: 12px 0; border-bottom: 0.5px solid var(--dsw-alias-border-l3); }
[data-eterna-panel='session-id'] { font-size: 12px; color: var(--dsw-alias-label-secondary); overflow-wrap: anywhere; }
[data-eterna-panel='session-metrics'] { display: flex; gap: 14px; flex-wrap: wrap; font-variant-numeric: tabular-nums; font-size: 12px; color: var(--dsw-alias-label-tertiary); }
[data-eterna-panel='session-last'] { font-size: 11px; color: var(--dsw-alias-label-tertiary); }

[data-eterna-panel='placeholder'] { font-size: 13px; color: var(--dsw-alias-label-tertiary); }
[data-eterna-panel='error'] { color: var(--dsw-alias-state-error-primary); overflow-wrap: anywhere; }

/* —— chips(composer dock):Apple 胶囊 —— */
[data-eterna-panel='chips'] { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; padding: 2px 4px 8px; }
[data-eterna-panel='chips-label'] { font-size: 12px; color: var(--dsw-alias-label-tertiary); }
[data-eterna-panel='chip'] {
  padding: 4px 14px; font: inherit; font-size: 12px; line-height: 18px; cursor: pointer;
  color: var(--dsw-alias-state-business-primary);
  background: color-mix(in srgb, var(--dsw-alias-state-business-primary) 10%, transparent);
  border: 0; border-radius: 980px;
}
[data-eterna-panel='chip']:hover:not(:disabled) { background: color-mix(in srgb, var(--dsw-alias-state-business-primary) 20%, transparent); }
[data-eterna-panel='chip']:disabled { opacity: 0.45; cursor: default; }
`

/** 幂等注入面板样式表(同文档重复装载时复用既有节点)。 */
export function injectPanelStyles(doc: Document = document): void {
  const marker = 'data-eterna-panel-styles'
  if (doc.querySelector(`style[${marker}]`) !== null) return
  const style = doc.createElement('style')
  style.textContent = CSS
  style.setAttribute(marker, 'true')
  doc.head.append(style)
}
