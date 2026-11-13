/**
 * 附件入口样式 —— 输入框工具行紧凑控件(权限/计划按钮旁的常驻按钮)。
 * 色值/圆角/动效全部经 @eterna/ui 令牌;应用内深浅主题由 DSH 桥接层
 * (--dsw-alias-*)跟随产品壳。tooltip 自绘(data-tip + ::after),无上游依赖。
 */
import { injectDesignTokens } from '@eterna/ui'

const CSS = `
[data-eterna-attach='button'] {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 36px;
  height: 36px;
  padding: 0;
  border: none;
  border-radius: var(--et-radius-pill);
  background: transparent;
  color: var(--et-muted);
  cursor: pointer;
  transition: color var(--et-motion-fast) var(--et-ease), background var(--et-motion-fast) var(--et-ease);
}
[data-eterna-attach='button']:hover:not(:disabled) { color: var(--et-fg-2); background: var(--et-surface-2); }
[data-eterna-attach='button']:disabled { color: var(--et-muted); opacity: 0.5; cursor: default; }
[data-eterna-attach='button']:focus-visible {
  outline: none;
  box-shadow: var(--et-focus-ring);
  color: var(--et-fg);
}

/* 自绘 tooltip:按钮上方浮出,hover/focus 可见;纯 CSS 无脚本。 */
[data-eterna-attach='tooltip'] {
  position: relative;
}
[data-eterna-attach='tooltip']::after {
  content: attr(data-tip);
  position: absolute;
  bottom: calc(100% + var(--et-space-1));
  left: 50%;
  transform: translateX(-50%);
  white-space: nowrap;
  padding: var(--et-space-1) var(--et-space-2);
  border-radius: var(--et-radius-sm);
  background: var(--et-fg);
  color: var(--et-bg);
  font-size: var(--et-text-caption);
  line-height: 1.4;
  opacity: 0;
  pointer-events: none;
  transition: opacity var(--et-motion-fast) var(--et-ease);
  z-index: 1;
}
[data-eterna-attach='tooltip']:hover::after,
[data-eterna-attach='tooltip']:focus-within::after { opacity: 1; }

@media (prefers-reduced-motion: reduce) {
  [data-eterna-attach='button'] { transition: none; }
  [data-eterna-attach='tooltip']::after { transition: none; }
}
`

/** 幂等注入样式表(同文档重复装载时复用既有节点)。 */
export function injectAttachStyles(doc: Document = document): void {
  injectDesignTokens({ bridge: true, doc })
  const marker = 'data-eterna-attach-styles'
  if (doc.querySelector(`style[${marker}]`) !== null) return
  const style = doc.createElement('style')
  style.textContent = CSS
  style.setAttribute(marker, 'true')
  doc.head.append(style)
}
