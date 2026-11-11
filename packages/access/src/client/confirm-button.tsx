/**
 * 两击确认按钮 —— 破坏性操作统一入口(禁用原生 confirm:内嵌 webview 卡死实测)。
 * 首次点击进入待确认态,4s 无操作或失焦/移出即自动解除;确认后执行并复位。
 */
import { useEffect, useRef, useState } from 'react'

export interface TwoClickButtonProps {
  readonly label: string
  readonly confirmLabel: string
  readonly className?: string | undefined
  readonly armedClassName?: string | undefined
  readonly disabled?: boolean | undefined
  readonly onConfirm: () => void
}

export function TwoClickButton(props: TwoClickButtonProps): React.JSX.Element {
  const [armed, setArmed] = useState(false)
  const timer = useRef<number | undefined>(undefined)
  const disarm = (): void => {
    window.clearTimeout(timer.current)
    setArmed(false)
  }
  useEffect(() => () => { window.clearTimeout(timer.current) }, [])
  const handleClick = (): void => {
    if (props.disabled === true) return
    if (!armed) {
      setArmed(true)
      window.clearTimeout(timer.current)
      timer.current = window.setTimeout(() => { setArmed(false) }, 4000)
      return
    }
    disarm()
    props.onConfirm()
  }
  return <button
    type="button"
    className={armed ? (props.armedClassName ?? props.className) : props.className}
    disabled={props.disabled}
    onMouseLeave={disarm}
    onBlur={disarm}
    onClick={handleClick}
  >{armed ? props.confirmLabel : props.label}</button>
}

/** 设置分区内联删除按钮(轻量文字按钮形态)。 */
export function DeleteButton(props: {
  readonly onConfirm: () => void
  readonly disabled?: boolean | undefined
  readonly label?: string | undefined
  readonly confirmLabel?: string | undefined
}): React.JSX.Element {
  return <TwoClickButton
    label={props.label ?? '删除'}
    confirmLabel={props.confirmLabel ?? '确认删除?'}
    className="ea-dangerclick"
    disabled={props.disabled}
    onConfirm={props.onConfirm}
  />
}

/** 行卡/开关列表内的删除按钮(行内按钮形态)。 */
export function ArmedDelete(props: {
  readonly busy: boolean
  readonly onConfirm: () => void
  readonly label?: string | undefined
  readonly confirmLabel?: string | undefined
}): React.JSX.Element {
  return <TwoClickButton
    label={props.label ?? '删除'}
    confirmLabel={props.confirmLabel ?? '确认删除?'}
    className="ea-del"
    armedClassName="ea-del ea-armed"
    disabled={props.busy}
    onConfirm={props.onConfirm}
  />
}
