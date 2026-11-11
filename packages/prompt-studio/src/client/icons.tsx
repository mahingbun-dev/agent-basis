/**
 * 侧栏入口图标:渲染侧栏请求的尺寸(panel 同款份额)。
 * 使用恒灵自绘图标集:工坊=列表+笔尖,轨迹=闭环+节点。
 */
import type { ReactElement } from 'react'
import { Icon } from '@eterna/ui/icons'

/** 「提示词工坊」入口图标。 */
export function StudioIcon({ size }: { readonly size?: number }): ReactElement {
  return <Icon name="prompt" size={size ?? 20} />
}

/** 「循环轨迹」入口图标。 */
export function TraceIcon({ size }: { readonly size?: number }): ReactElement {
  return <Icon name="trace" size={size ?? 20} />
}
