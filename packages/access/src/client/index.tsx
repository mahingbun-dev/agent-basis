/**
 * access 客户端半边:注册设置弹窗分区(settings.section slot)。
 * - 「账号」分区(所有人):资料合并保存+密码独立修改
 * - 「用户管理」「插件启停」分区(仅 admin):按 /access/api/me 的 role 条件注册
 * - 上游设计宣言:adding a setting never means editing the shell
 *   (dsh-client-ui-settings contract/slots.d.ts)——本插件即该机制的第一个
 *   第三方实践;功能入口=产品设置弹窗,禁止自建独立页面(AGENTS.md 前端铁律)
 * - API 走同源 /access/api/*(Host 半边提供,eterna_session cookie 自动携带)
 * - 依赖 slot 注册表与语言服务;排序在通用分区之后
 */
import { AccountSection, PluginsSection, UsersSection } from './sections.tsx'
import { injectAccessStyles } from './styles.ts'

export const inject = ['slots', 'locale']

const NS = 'eterna-access'
const LOCALES: Record<string, Record<string, string>> = {
  zh: {
    'section.account': '账号',
    'section.users': '用户管理',
    'section.plugins': '插件启停',
  },
  en: {
    'section.account': 'Account',
    'section.users': 'Users',
    'section.plugins': 'Plugins',
  },
}

interface AccessClientContext {
  readonly slots: {
    inject(slot: string, contribute: () => (() => void) | Generator<() => void>): () => void
    register(options: Record<string, unknown>, component: unknown): () => void
  }
  readonly locale: {
    register(ns: string, dictionaries: Record<string, Record<string, string>>): () => void
    bind(ns: string): (key: string) => string
  }
}

export function apply(ctx: AccessClientContext): () => void {
  injectAccessStyles()
  const disposeLocale = ctx.locale.register(NS, LOCALES)
  const t = ctx.locale.bind(NS)

  const registerSections = (role: 'admin' | 'user'): void => {
    ctx.slots.inject('settings.section', () => ctx.slots.register({
      name: 'settings.section',
      id: `${NS}.account`,
      order: 40,
      locale: NS,
      label: () => t('section.account'),
    }, AccountSection))
    if (role === 'admin') {
      ctx.slots.inject('settings.section', () => ctx.slots.register({
        name: 'settings.section',
        id: `${NS}.users`,
        order: 41,
        locale: NS,
        label: () => t('section.users'),
      }, UsersSection))
      ctx.slots.inject('settings.section', () => ctx.slots.register({
        name: 'settings.section',
        id: `${NS}.plugins`,
        order: 42,
        locale: NS,
        label: () => t('section.plugins'),
      }, PluginsSection))
    }
  }

  // 角色判定:未登录(401)不注册分区(登录页场景 client 不在应用壳内);admin 追加管理分区
  void fetch('/access/api/me', { credentials: 'same-origin' }).then(res => {
    if (!res.ok) return
    return res.json().then((me: { role?: string }) => {
      registerSections(me.role === 'admin' ? 'admin' : 'user')
    }).catch(() => {})
  }).catch(() => {})

  return disposeLocale
}
