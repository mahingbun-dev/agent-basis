/**
 * 侧栏「基座面板」入口图标:渲染侧栏请求的尺寸(ui-sidebar 的 panellist 图标份额)。
 * 使用恒灵自绘图标集,不再依赖上游 ui-primitives 的仪表盘图标。
 */
import type { ReactElement } from 'react'
import { Icon } from '@eterna/ui/icons'

/** @param props.size - 侧栏请求的图标边长(px)。 */
export function PanelIcon({ size }: { readonly size?: number }): ReactElement {
  return <Icon name="gauge" size={size ?? 20} />
}
