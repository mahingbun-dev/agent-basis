/**
 * 原生开关(button[role=switch] + 圆点)。插件页/技能/MCP 三处共用,
 * 形态由 `.ea-switch` / `.ea-thumb` 承担,不重复手写 role/aria。
 */
export interface SwitchProps {
  readonly checked: boolean
  readonly disabled?: boolean | undefined
  readonly label: string
  readonly title?: string | undefined
  readonly onToggle: () => void
}

export function Switch(props: SwitchProps): React.JSX.Element {
  return <button type="button" role="switch" aria-checked={props.checked} aria-label={props.label}
    title={props.title} disabled={props.disabled === true} className="ea-switch"
    onClick={() => { props.onToggle() }}>
    <span className="ea-thumb" />
  </button>
}