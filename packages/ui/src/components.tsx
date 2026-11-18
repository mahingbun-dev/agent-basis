/**
 * v4 共享基础件（React）。
 *
 * 与 `./components-css.ts` 的 `.et-*` class 一一对应；组件只是语义化包装，
 * 不新增任何视觉。各插件优先用组件，避免再手写一份样式。
 *
 * 刻意不导出 Toast 组件：规范 42 号 §7a.3 明确「不新建 toast 系统」，
 * 应用内一律走宿主 `@deepseek-ai/dsh-client-ui-primitives` 的 Toast 原子
 * 或 `workspace.toast` 席位（宿主自管位置/层级/停留时间）。
 */
import type { CSSProperties, ReactNode } from 'react'
import { Icon } from './icons.tsx'
import type { IconName } from './icon-data.ts'

/** 组件统一接受的样式逃生口：只允许布局类属性，不用于覆盖视觉。 */
type StyleEscape = CSSProperties

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger'
export type ButtonSize = 'sm' | 'md' | 'lg'

export interface ButtonProps {
  readonly children?: ReactNode
  readonly variant?: ButtonVariant
  readonly size?: ButtonSize
  /** 图标按钮（正方形，仅图标）。必须同时给 `aria-label`。 */
  readonly iconOnly?: boolean | undefined
  readonly block?: boolean | undefined
  readonly disabled?: boolean | undefined
  /** 破坏性操作的两击确认：由调用方维护 armed 状态，这里只负责呈现。 */
  readonly armed?: boolean | undefined
  readonly type?: 'button' | 'submit' | undefined
  readonly onClick?: (() => void) | undefined
  readonly ariaLabel?: string | undefined
  readonly title?: string | undefined
  readonly style?: StyleEscape | undefined
  readonly testId?: string | undefined
}

const BUTTON_CLASS: Record<ButtonVariant, string> = {
  primary: 'et-btn et-btn--primary',
  secondary: 'et-btn et-btn--secondary',
  ghost: 'et-btn et-btn--ghost',
  danger: 'et-btn et-btn--danger',
}
const BUTTON_SIZE_CLASS: Record<ButtonSize, string> = { sm: 'et-btn--sm', md: '', lg: 'et-btn--lg' }

export function Button(props: ButtonProps): ReactNode {
  const classes = [
    BUTTON_CLASS[props.variant ?? 'secondary'],
    BUTTON_SIZE_CLASS[props.size ?? 'md'],
    props.iconOnly === true ? 'et-btn--icon' : '',
    props.block === true ? 'et-btn--block' : '',
  ].filter(Boolean).join(' ')

  return (
    <button
      type={props.type ?? 'button'}
      className={classes}
      disabled={props.disabled === true}
      aria-label={props.ariaLabel}
      aria-disabled={props.disabled === true ? true : undefined}
      title={props.title}
      data-armed={props.armed === true ? 'true' : undefined}
      data-testid={props.testId}
      onClick={props.onClick === undefined ? undefined : () => { props.onClick?.() }}
      style={props.style}
    >{props.children}</button>
  )
}

export interface IconButtonProps {
  readonly icon: IconName
  readonly label: string
  readonly variant?: ButtonVariant
  readonly size?: ButtonSize
  readonly disabled?: boolean
  readonly onClick?: () => void
  readonly style?: StyleEscape
}

export function IconButton(props: IconButtonProps): ReactNode {
  const size = props.size ?? 'md'
  return (
    <Button
      variant={props.variant ?? 'ghost'}
      size={size}
      iconOnly
      disabled={props.disabled}
      ariaLabel={props.label}
      title={props.label}
      onClick={props.onClick}
      style={props.style}
    ><Icon name={props.icon} size={size === 'lg' ? 22 : 18} /></Button>
  )
}

export interface InputProps {
  readonly id?: string
  readonly value: string
  readonly onChange?: (value: string) => void
  readonly type?: 'text' | 'password' | 'email' | 'search' | 'url'
  readonly placeholder?: string
  readonly autoComplete?: string
  readonly disabled?: boolean
  readonly invalid?: boolean
  readonly ariaLabel?: string
  readonly style?: StyleEscape
}

export function Input(props: InputProps): ReactNode {
  return (
    <input
      id={props.id}
      className='et-input'
      type={props.type ?? 'text'}
      value={props.value}
      placeholder={props.placeholder}
      autoComplete={props.autoComplete}
      disabled={props.disabled === true}
      aria-label={props.ariaLabel}
      aria-invalid={props.invalid === true ? true : undefined}
      onChange={(event) => { props.onChange?.(event.target.value) }}
      style={props.style}
    />
  )
}

export interface TextareaProps {
  readonly id?: string
  readonly value: string
  readonly onChange?: (value: string) => void
  readonly placeholder?: string
  readonly rows?: number
  readonly disabled?: boolean
  readonly invalid?: boolean
  readonly ariaLabel?: string
  readonly style?: StyleEscape
}

export function Textarea(props: TextareaProps): ReactNode {
  return (
    <textarea
      id={props.id}
      className='et-textarea'
      value={props.value}
      placeholder={props.placeholder}
      rows={props.rows ?? 3}
      disabled={props.disabled === true}
      aria-label={props.ariaLabel}
      aria-invalid={props.invalid === true ? true : undefined}
      onChange={(event) => { props.onChange?.(event.target.value) }}
      style={props.style}
    />
  )
}

export interface FieldProps {
  readonly label: string
  readonly htmlFor?: string
  readonly hint?: string
  readonly error?: string
  readonly children: ReactNode
}

/** 字段容器：标签 + 控件 + 提示/错误（错误只染文字色，不染整片底）。 */
export function Field(props: FieldProps): ReactNode {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <label htmlFor={props.htmlFor} style={{
        font: `var(--et-weight-emphasis) var(--et-text-caption)/1.4 var(--et-font-body)`,
        color: 'var(--et-fg-2)',
      }}>{props.label}</label>
      {props.children}
      {props.hint !== undefined && props.error === undefined
        ? <p className='et-field-msg'>{props.hint}</p>
        : null}
      {props.error !== undefined ? <p className='et-field-msg' data-tone='error'>{props.error}</p> : null}
    </div>
  )
}

export type CardTier = 'default' | 'emphasis' | 'inset'

export interface CardProps {
  readonly tier?: CardTier
  readonly title?: string
  readonly desc?: string
  readonly actions?: ReactNode
  readonly children?: ReactNode
  readonly style?: StyleEscape
}

const CARD_CLASS: Record<CardTier, string> = {
  default: 'et-card',
  emphasis: 'et-card et-card--emphasis',
  inset: 'et-card et-card--inset',
}

/**
 * 卡片。文字预算（标题 ≤12 字、说明 ≤40 字、操作 ≤2）由调用方保证，
 * 这里只做说明行的三行截断兜底。
 */
export function Card(props: CardProps): ReactNode {
  return (
    <div className={CARD_CLASS[props.tier ?? 'default']} style={props.style}>
      {props.title !== undefined ? <h4 className='et-card-title'>{props.title}</h4> : null}
      {props.desc !== undefined ? <p className='et-card-desc'>{props.desc}</p> : null}
      {props.children}
      {props.actions !== undefined ? <div className='et-card-actions'>{props.actions}</div> : null}
    </div>
  )
}

export type StatusState = 'idle' | 'running' | 'waiting' | 'failed' | 'done'

export interface StatusDotProps {
  readonly state: StatusState
  /** 珠径 10–14；默认 10。 */
  readonly size?: number
}

/** 状态珠：色 + 形。语义必须再由旁边的文字或形状补齐（式五）。 */
export function StatusDot(props: StatusDotProps): ReactNode {
  return <span className='et-dot' data-state={props.state}
    style={props.size === undefined ? undefined : { ['--dot-size' as string]: `${props.size}px` }} />
}

export type BadgeTone = 'neutral' | 'accent' | 'success' | 'warn' | 'danger' | 'jade'

export interface BadgeProps {
  readonly children: ReactNode
  readonly tone?: BadgeTone
}

export function Badge(props: BadgeProps): ReactNode {
  return <span className='et-badge' data-tone={props.tone ?? 'neutral'}>{props.children}</span>
}

export interface BeadProps {
  readonly label: string
  readonly state?: StatusState
  readonly value?: string
}

/** 珠链（式二）：过程不再写成 N 行日志，而是珠 + 名称 + 一个数字。 */
export function Beads(props: { readonly items: readonly BeadProps[] }): ReactNode {
  return (
    <ul className='et-beads'>
      {props.items.map((item, index) => (
        <li className='et-bead' key={`${item.label}-${index}`}>
          <StatusDot state={item.state ?? 'idle'} />
          <span className='et-bead-label'>{item.label}</span>
          {item.value !== undefined ? <span className='et-bead-value'>{item.value}</span> : null}
        </li>
      ))}
    </ul>
  )
}

export interface RingProps {
  /** 0–1 的比值（不是百分数）。 */
  readonly ratio: number
  readonly size?: number
  readonly stroke?: number
  readonly tone?: 'accent' | 'success' | 'warn' | 'danger' | 'jade'
  /** 环心文字；省略时显示四舍五入的百分比。 */
  readonly label?: string
  readonly ariaLabel?: string
}

/**
 * 玉环（式三）：比例的主要表达形态。横向进度条只在表格行内的小空间使用。
 * 直径 44–72，线帽圆头，轨道 12–20%。
 */
export function Ring(props: RingProps): ReactNode {
  const size = props.size ?? 56
  const stroke = props.stroke ?? Math.max(4, Math.round(size * 0.14))
  const radius = (size - stroke) / 2
  const circumference = 2 * Math.PI * radius
  const ratio = Number.isFinite(props.ratio) ? Math.min(1, Math.max(0, props.ratio)) : 0
  const dash = circumference * ratio
  const percent = Math.round(ratio * 100)

  return (
    <span className='et-ring' style={{ width: size, height: size }}
      role='img' aria-label={props.ariaLabel ?? `${percent}%`}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden='true'>
        <circle className='et-ring-track' cx={size / 2} cy={size / 2} r={radius} strokeWidth={stroke} />
        <circle className='et-ring-arc' data-tone={props.tone ?? 'accent'}
          cx={size / 2} cy={size / 2} r={radius} strokeWidth={stroke}
          strokeDasharray={`${dash} ${circumference - dash}`} />
      </svg>
      <span className='et-ring-value'>{props.label ?? `${percent}%`}</span>
    </span>
  )
}

export interface StripProps {
  readonly values: readonly number[]
  readonly tone?: 'accent' | 'jade' | 'sand'
  /** 高亮点下标；默认最后一个（"最新"）。 */
  readonly peakIndex?: number
  readonly height?: number
  readonly ariaLabel?: string
}

/** 条带（式四）：无坐标轴、无网格，只标 1 个高亮点。 */
export function Strip(props: StripProps): ReactNode {
  const max = Math.max(...props.values.map(v => Math.abs(v)), 1)
  const peak = props.peakIndex ?? props.values.length - 1
  return (
    <div className='et-strip' style={props.height === undefined ? undefined : { height: props.height }}
      role='img' aria-label={props.ariaLabel ?? '趋势条带'}>
      {props.values.map((value, index) => (
        <i key={index} className='et-strip-bar' data-tone={props.tone ?? 'accent'}
          data-peak={index === peak ? 'true' : undefined}
          style={{ height: `${Math.max(6, Math.abs(value) / max * 100)}%` }} />
      ))}
    </div>
  )
}
