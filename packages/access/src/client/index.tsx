/**
 * access 客户端半边:产品内功能走原生扩展点。
 * - 设置弹窗分区(settings.section):「账号」(所有人:资料合并保存+密码独立)、
 *   「用户管理」(仅 admin)
 * - 右侧「插件」页(plugins.tab slot,仅 admin):「恒灵插件」页签——@eterna
 *   插件的停用/删除管理(不与上游 Installed/内置插件配置重合)
 * - 上游设计宣言:adding a setting never means editing the shell
 *   (dsh-client-ui-settings contract/slots.d.ts);AGENTS.md 前端与产品形态铁律
 * - 数据走同源 /access/api/*(Host 半边提供,eterna_session cookie 自动携带)
 */
import { AccountSection, UsersSection } from './sections.tsx'
import { ManageTab } from './plugins-manager.tsx'
import { injectAccessStyles } from './styles.ts'

export const inject = ['slots', 'locale']

const NS = 'eterna-access'
const LOCALES: Record<string, Record<string, string>> = {
  zh: {
    'section.account': '账号',
    'section.users': '用户管理',
    'tab.manage': '恒灵插件',
  },
  en: {
    'section.account': 'Account',
    'section.users': 'Users',
    'tab.manage': 'Eterna Plugins',
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
      // 右侧插件页:「恒灵插件」管理页签
      ctx.slots.inject('plugins.tab', () => ctx.slots.register({
        name: 'plugins.tab',
        id: `${NS}.manage`,
        order: 20,
        locale: NS,
        label: () => t('tab.manage'),
      }, ManageTab))
    }
  }

  // 角色判定:未登录(401)不注册分区(登录页场景 client 不在应用壳内);admin 追加管理面
  void fetch('/access/api/me', { credentials: 'same-origin' }).then(res => {
    if (!res.ok) return
    return res.json().then((me: { role?: string }) => {
      registerSections(me.role === 'admin' ? 'admin' : 'user')
    }).catch(() => {})
  }).catch(() => {})

  return disposeLocale
}
