/**
 * 侧栏入口图标:渲染侧栏请求的尺寸(ui-sidebar 的 panellist 图标份额,panel
 * 同款)。图标组件来自官方 ui-primitives(运行时由 web 壳模块表注入,构建期
 * external;类型面见 primitives-shim.d.ts)。
 */
import type { ReactElement } from 'react'
import { IconListPenOutlineRegular, IconWorkspaceTreeOutlineRegular } from '@deepseek-ai/dsh-client-ui-primitives'

/** 「提示词工坊」入口图标。 */
export function StudioIcon({ size }: { readonly size?: number }): ReactElement {
  const edge = size as number | undefined
  return <IconListPenOutlineRegular size={edge} />
}

/** 「循环轨迹」入口图标。 */
export function TraceIcon({ size }: { readonly size?: number }): ReactElement {
  const edge = size as number | undefined
  return <IconWorkspaceTreeOutlineRegular size={edge} />
}
