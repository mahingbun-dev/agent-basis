/**
 * 侧栏底部账户入口与账户菜单(原型:头像+昵称入口紧邻设置齿轮,菜单向上展开)。
 *
 * 席位:ui-settings-general 注册 `sidebar.settings` 时声明的 `settings.launcher`
 * 单洞(账号启动器;上游 ui-settings-account 在本仓库 profile 中裁切,席位空置)。
 * 注册后替代回落设置按钮,因此组件自带右侧齿轮(打开设置弹窗)。
 *
 * 数据:同源 /access/api/me(昵称/角色/头像);语言与主题读写官方 locale / theme
 * 服务;使用统计切到既有用量面板;断开连接保留弹层内二次确认后走 /logout。
 */
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import { Icon } from '@eterna/ui/icons'
import { api, type Me } from './api.ts'
import type { Translate } from './i18n.ts'

/** 设置壳传入的席位属主份额(只取本组件用到的字段)。 */
export interface AccountLauncherOwnerProps {
  readonly wide?: boolean
  readonly openSettings?: () => void
}

interface LocaleOption {
  readonly id: string
  readonly label: string
}

interface LocaleView {
  readonly active: string
  readonly locales: readonly LocaleOption[]
}

interface ThemeView {
  readonly preference: string
}

/** 注入份额:文案、语言/主题读写、用量面板入口。 */
export interface AccountLauncherInjected {
  readonly t: Translate
  readonly getLocale?: () => LocaleView
  readonly setLocale?: (id: string) => void
  readonly getTheme?: () => ThemeView
  readonly setTheme?: (id: string) => void
  readonly openUsage?: () => boolean
}

type Submenu = 'lang' | 'theme' | null

interface MenuPosition {
  readonly left: number
  readonly bottom: number
  readonly width: number
}

const THEME_OPTIONS = ['dark', 'light', 'system'] as const

function avatarLetter(name: string): string {
  return name.trim().slice(0, 1) || '?'
}

function AccountAvatar(props: { readonly me: Me | null; readonly size: number; readonly large?: boolean }): React.JSX.Element {
  const size = props.size
  const className = props.large === true ? 'ea-account-avatar ea-account-avatar--large' : 'ea-account-avatar'
  if (props.me?.avatarUrl != null) {
    return <span className={className} style={{ width: size, height: size }}><img src={props.me.avatarUrl} alt="" /></span>
  }
  const name = props.me === null ? '?' : props.me.nickname || props.me.account
  return <span className={className} style={{ width: size, height: size }}>{avatarLetter(name)}</span>
}

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    const area = document.createElement('textarea')
    area.value = text
    area.style.position = 'fixed'
    area.style.opacity = '0'
    document.body.appendChild(area)
    area.select()
    const ok = document.execCommand('copy')
    area.remove()
    return ok
  }
}

/**
 * 侧栏底部账户入口:头像+昵称(收起态仅头像)+ 设置齿轮;点击向上展开菜单。
 * @param props - 设置壳席位属性(wide/openSettings)与注入份额。
 * @returns 底部入口行与账户菜单。
 */
export function AccountLauncher(props: AccountLauncherOwnerProps & AccountLauncherInjected): React.JSX.Element {
  const { t, wide = true, openSettings, getLocale, setLocale, getTheme, setTheme, openUsage } = props
  const [me, setMe] = useState<Me | null>(null)
  const [open, setOpen] = useState(false)
  const [submenu, setSubmenu] = useState<Submenu>(null)
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)
  const [copied, setCopied] = useState(false)
  const [localeView, setLocaleView] = useState<LocaleView | null>(null)
  const [themeView, setThemeView] = useState<ThemeView | null>(null)
  const [position, setPosition] = useState<MenuPosition | null>(null)

  const triggerRef = useRef<HTMLButtonElement>(null)
  const gearRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)

  const displayName = me === null ? t('menu.account') : me.nickname || me.account

  useEffect(() => {
    let alive = true
    api.me().then(
      (value) => { if (alive) setMe(value) },
      () => { /* 角标 401 已由 api 层跳转;其余错误静默降级 */ },
    )
    return () => { alive = false }
  }, [])

  const place = useCallback((): void => {
    const trigger = triggerRef.current
    if (trigger === null) return
    const rect = trigger.getBoundingClientRect()
    const width = Math.min(280, window.innerWidth - 16)
    const left = Math.max(8, Math.min(rect.left, window.innerWidth - width - 8))
    setPosition({ left, bottom: window.innerHeight - rect.top + 8, width })
  }, [])

  const close = useCallback((restoreFocus = true): void => {
    setOpen(false)
    setSubmenu(null)
    setConfirming(false)
    setCopied(false)
    if (restoreFocus) triggerRef.current?.focus()
  }, [])

  const openMenu = useCallback((): void => {
    const locale = getLocale?.() ?? null
    const theme = getTheme?.() ?? null
    setLocaleView(locale)
    setThemeView(theme)
    setSubmenu(null)
    setConfirming(false)
    setOpen(true)
    api.me().then((value) => { setMe(value) }, () => {})
  }, [getLocale, getTheme])

  useLayoutEffect(() => {
    if (!open) { setPosition(null); return }
    place()
  }, [open, place])

  useEffect(() => {
    if (!open) return
    const reposition = (): void => { place() }
    window.addEventListener('resize', reposition)
    window.addEventListener('scroll', reposition, true)
    return () => {
      window.removeEventListener('resize', reposition)
      window.removeEventListener('scroll', reposition, true)
    }
  }, [open, place])

  useEffect(() => {
    if (!open) return
    const onPointerDown = (event: MouseEvent): void => {
      const target = event.target as Node | null
      if (target === null) return
      if (menuRef.current?.contains(target) === true) return
      if (triggerRef.current?.contains(target) === true) return
      if (gearRef.current?.contains(target) === true) return
      close(false)
    }
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.preventDefault()
        if (confirming) { setConfirming(false); return }
        if (submenu !== null) { setSubmenu(null); return }
        close()
      }
    }
    document.addEventListener('mousedown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('mousedown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open, confirming, submenu, close])

  useEffect(() => {
    if (!open || position === null) return
    const first = menuRef.current?.querySelector<HTMLElement>('[role="menuitem"],[role="menuitemradio"]')
    first?.focus()
  }, [open, position])

  const onMenuKeyDown = (event: React.KeyboardEvent<HTMLDivElement>): void => {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp' && event.key !== 'Home' && event.key !== 'End') return
    const nodes = menuRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"],[role="menuitemradio"]')
    if (nodes === undefined || nodes.length === 0) return
    event.preventDefault()
    const list = [...nodes]
    const index = list.indexOf(document.activeElement as HTMLElement)
    let next: HTMLElement | undefined
    if (event.key === 'Home') next = list[0]
    else if (event.key === 'End') next = list[list.length - 1]
    else {
      const step = event.key === 'ArrowDown' ? 1 : -1
      const from = index === -1 ? (step > 0 ? -1 : 0) : index
      next = list[(from + step + list.length) % list.length]
    }
    next?.focus()
  }

  const selectLocale = (id: string): void => {
    setLocale?.(id)
    close()
  }

  const selectTheme = (id: string): void => {
    setTheme?.(id)
    close()
  }

  const onCopy = async (): Promise<void> => {
    if (me === null) return
    const ok = await copyText(String(me.id))
    if (!ok) return
    setCopied(true)
    window.setTimeout(() => { setCopied(false) }, 1600)
  }

  const signOut = async (): Promise<void> => {
    setBusy(true)
    try {
      await api.logout()
    } finally {
      window.location.href = '/login'
    }
  }

  const triggerLabel = t('menu.open')
  const menuStyle: CSSProperties | undefined = position === null ? undefined : {
    left: position.left,
    bottom: position.bottom,
    width: position.width,
  }

  return <div data-eterna-account-root="" data-wide={wide}>
    <button
      ref={triggerRef}
      type="button"
      className="ea-account-trigger"
      aria-haspopup="menu"
      aria-expanded={open}
      aria-label={triggerLabel}
      title={displayName}
      onClick={() => { if (open) close(false); else openMenu() }}
    >
      <AccountAvatar me={me} size={24} />
      {wide && <span className="ea-account-name">{displayName}</span>}
    </button>
    {openSettings !== undefined && wide && <button
      ref={gearRef}
      type="button"
      className="ea-account-gear"
      aria-label={t('menu.settings')}
      title={t('menu.settings')}
      onClick={() => { close(false); openSettings() }}
    >
      <Icon name="settings" size={18} />
    </button>}

    {open && position !== null && <div
      ref={menuRef}
      className="ea-account-menu"
      style={menuStyle}
      role="menu"
      aria-label={t('menu.label')}
      onKeyDown={onMenuKeyDown}
    >
      {confirming
        ? <div className="ea-account-confirm">
          <p className="ea-account-confirm-title">{t('menu.confirmTitle')}</p>
          <p className="ea-account-confirm-text">{t('menu.confirmText')}</p>
          <div className="ea-account-confirm-actions">
            <button type="button" className="ea-account-btn" disabled={busy} onClick={() => { setConfirming(false) }}>{t('menu.cancel')}</button>
            <button type="button" className="ea-account-btn ea-account-btn--danger" disabled={busy} onClick={() => { void signOut() }}>{busy ? t('menu.signingOut') : t('menu.signOut')}</button>
          </div>
        </div>
        : <>
          <div className="ea-account-id">
            <AccountAvatar me={me} size={40} large />
            <div className="ea-account-id-block">
              <div className="ea-account-name-row">
                <span className="ea-account-full-name">{displayName}</span>
                {me?.role === 'admin' && <span className="ea-account-pill">{t('menu.admin')}</span>}
              </div>
              <div className="ea-account-id-row">
                <span className="ea-account-id-text">{me === null ? 'ID: —' : `ID: ${me.id}`}</span>
                <button
                  type="button"
                  className="ea-account-copy"
                  aria-label={copied ? t('menu.copied') : t('menu.copyId')}
                  title={copied ? t('menu.copied') : t('menu.copyId')}
                  disabled={me === null}
                  onClick={() => { void onCopy() }}
                >
                  <Icon name={copied ? 'check' : 'copy'} size={15} />
                </button>
              </div>
            </div>
          </div>

          <div className="ea-account-divider" role="presentation" />

          {localeView !== null && <button
            type="button"
            className="ea-account-item"
            role="menuitem"
            aria-haspopup="menu"
            aria-expanded={submenu === 'lang'}
            onClick={() => { setSubmenu(submenu === 'lang' ? null : 'lang') }}
          >
            <Icon name="globe" size={18} />
            <span>{t('menu.language')}</span>
            <Icon name="chevron-right" size={14} className="ea-account-chev" />
          </button>}
          {submenu === 'lang' && localeView !== null && <div className="ea-account-sub" role="group" aria-label={t('menu.language')}>
            {localeView.locales.map(option => <button
              key={option.id}
              type="button"
              role="menuitemradio"
              aria-checked={localeView.active === option.id}
              className="ea-account-subitem"
              onClick={() => { selectLocale(option.id) }}
            >
              <span>{option.label}</span>
              {localeView.active === option.id && <Icon name="check" size={14} />}
            </button>)}
          </div>}

          {themeView !== null && <button
            type="button"
            className="ea-account-item"
            role="menuitem"
            aria-haspopup="menu"
            aria-expanded={submenu === 'theme'}
            onClick={() => { setSubmenu(submenu === 'theme' ? null : 'theme') }}
          >
            <Icon name="palette" size={18} />
            <span>{t('menu.theme')}</span>
            <Icon name="chevron-right" size={14} className="ea-account-chev" />
          </button>}
          {submenu === 'theme' && themeView !== null && <div className="ea-account-sub" role="group" aria-label={t('menu.theme')}>
            {THEME_OPTIONS.map(option => <button
              key={option}
              type="button"
              role="menuitemradio"
              aria-checked={themeView.preference === option}
              className="ea-account-subitem"
              onClick={() => { selectTheme(option) }}
            >
              <span>{t(`menu.theme.${option}`)}</span>
              {themeView.preference === option && <Icon name="check" size={14} />}
            </button>)}
          </div>}

          {!wide && openSettings !== undefined && <>
            <div className="ea-account-divider" role="presentation" />
            <button
              type="button"
              className="ea-account-item"
              role="menuitem"
              onClick={() => { close(false); openSettings() }}
            >
              <Icon name="settings" size={18} />
              <span>{t('menu.settings')}</span>
            </button>
          </>}

          {openUsage !== undefined && <>
            <div className="ea-account-divider" role="presentation" />
            <button
              type="button"
              className="ea-account-item"
              role="menuitem"
              onClick={() => { close(false); openUsage() }}
            >
              <Icon name="chart" size={18} />
              <span>{t('menu.usage')}</span>
            </button>
          </>}

          <div className="ea-account-divider" role="presentation" />

          <button
            type="button"
            className="ea-account-item ea-account-item--danger"
            role="menuitem"
            onClick={() => { setSubmenu(null); setConfirming(true) }}
          >
            <Icon name="logout" size={18} />
            <span>{t('menu.signOut')}</span>
          </button>
        </>}
    </div>}
  </div>
}
