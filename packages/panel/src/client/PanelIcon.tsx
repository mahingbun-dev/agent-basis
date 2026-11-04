/**
 * 侧栏「基座面板」入口图标:渲染侧栏请求的尺寸(ui-sidebar 的 panellist 图标份额)。
 */
import type { ReactElement } from 'react'
import { IconGaugeOutlineRegular } from '@deepseek-ai/dsh-client-ui-primitives'

/** @param props.size - 侧栏请求的图标边长(px)。 */
export function PanelIcon({ size }: { readonly size?: number }): ReactElement {
  const edge = size as number | undefined
  return <IconGaugeOutlineRegular size={edge} />
}
