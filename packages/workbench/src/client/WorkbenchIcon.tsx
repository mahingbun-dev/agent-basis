/**
 * 侧栏「工作台」入口图标(sidebar.panellist 席位):渲染侧栏请求的尺寸。
 * 图标 = 原型 03 落库提案的 kanban(工作台主入口 = 工单看台;与基座面板
 * gauge 入口区分)。路径已在 @eterna/ui/icon-data 落库(iconography §6)。
 */
import type { ReactElement } from 'react'
import { Icon } from '@eterna/ui/icons'

/** @param props.size - 侧栏请求的图标边长(px)。 */
export function WorkbenchIcon({ size }: { readonly size?: number }): ReactElement {
  return <Icon name="kanban" size={size ?? 20} />
}
