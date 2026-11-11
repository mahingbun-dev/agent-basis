/**
 * 恒灵·EternaAgent 图标 React 组件。
 *
 * 统一 24 网格 / 1.75 描边 / currentColor;所有路径来自 icon-data.ts。
 * 功能图标默认 aria-hidden;需要独立可访问名称时传 label。
 */
import type { ReactElement } from 'react'
import { iconInner, type IconName } from './icon-data.ts'

export interface IconProps {
  readonly name: IconName
  readonly size?: number
  readonly className?: string
  readonly label?: string
}

function escapeXml(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
}

export function Icon({ name, size = 20, className, label }: IconProps): ReactElement {
  const title = label === undefined ? '' : `<title>${escapeXml(label)}</title>`
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      focusable="false"
      className={className}
      aria-hidden={label === undefined ? true : undefined}
      role={label === undefined ? undefined : 'img'}
      dangerouslySetInnerHTML={{ __html: title + iconInner(name) }}
    />
  )
}
