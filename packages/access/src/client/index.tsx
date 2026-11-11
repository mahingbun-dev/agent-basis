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
import { MyPluginsTab, NotificationsSection, ApprovalQueueSection } from './my-plugins-section.tsx'
import { ManageTab } from './plugins-manager.tsx'
import { DirectoryTreeFlow } from './directory-tree.tsx'
import { ModelMenu } from './model-menu.tsx'
import { injectAccessStyles } from './styles.ts'

// 'sessions'=api-session-controller 的 ClientSessions(reflect.provide('sessions')):
// 模型抽屉回显的投影写面(projectionStore(sessionId).apply)。2026-11-11 曾连同
// 'remote' 一起加导致 entry 静默不激活——根因在 'remote' 键(未定位),单独 'sessions'
// 由本轮构建验证;若激活回归失败先撤此项。
export const inject = ['slots', 'locale', 'uiWorkspace', 'sessions']

const NS = 'eterna-access'
const LOCALES: Record<string, Record<string, string>> = {
  zh: {
    'section.account': '账号',
    'section.users': '用户管理',
    'tab.manage': '恒灵插件',
    'section.myPlugins': '我的插件',
    'section.notifications': '消息与审批',
    'section.approvalQueue': '审批队列',
    'account.loading': '加载中…',
    'account.passwordToggle': '切换密码可见性',
    'account.passwordToggleTitle': '显示/隐藏密码',
    'account.profile': '个人资料',
    'account.nickname': '昵称',
    'account.save': '保存更改',
    'account.saving': '保存中…',
    'account.unchanged': '资料未改动',
    'account.willUpdateBoth': '将更新昵称与头像',
    'account.willUpdateAvatar': '将更新头像',
    'account.willUpdateNick': '将更新昵称',
    'account.saved': '已保存',
    'account.saveFailed': '保存失败',
    'account.avatarReadFailed': '图片读取失败',
    'account.passwordCard': '修改密码',
    'account.passwordNote': '修改后本机保持登录，其他设备需重新登录。',
    'account.oldPassword': '旧密码',
    'account.newPassword': '新密码',
    'account.newPasswordPlaceholder': '至少 8 位',
    'account.confirmPassword': '确认新密码',
    'account.confirmPlaceholder': '再次输入新密码',
    'account.changePassword': '修改密码',
    'account.passwordMismatch': '两次输入的新密码不一致',
    'account.passwordChanged': '密码已修改，其他设备需重新登录',
    'account.passwordChangeFailed': '修改失败',
    'companion.title': '浏览器执行面',
    'companion.desc': '让你的浏览器成为 Agent 的执行面：安装扩展后，Agent 可在你登录过的页面上代你操作（数据与登录态都不离开你的浏览器）。每台浏览器用独立令牌接入。',
    'companion.loading': '读取中…',
    'companion.empty': '尚未生成接入令牌。',
    'companion.copied': '已复制',
    'companion.copy': '一键复制',
    'companion.reset': '重置令牌',
    'companion.resetConfirm': '再点一次确认重置',
    'companion.generate': '生成令牌',
    'companion.guide': '安装指引 ↗',
    'companion.readFailed': '读取失败',
    'companion.generated': '令牌已生成',
    'companion.generateFailed': '生成失败',
    'users.lead': '添加用户（重名自动追加数字后缀；默认昵称=账号、头像=昵称首字母）。',
    'users.account': '账号',
    'users.password': '密码（至少 8 位）',
    'users.roleUser': '普通用户',
    'users.roleAdmin': '管理员',
    'users.add': '添加',
    'users.nickname': '昵称',
    'users.role': '角色',
    'users.createdAt': '创建时间',
    'users.current': '当前登录',
    'users.delete': '删除',
    'users.deleteConfirm': '确认删除?',
    'users.created': '用户 {account} 已创建',
    'users.createdSuffix': '用户已创建，账号为 {account}（重名自动后缀）',
    'users.createFailed': '创建失败',
    'users.deleted': '用户已删除，其会话已失效',
    'users.deleteFailed': '删除失败',
    'plugins.title': '我的插件',
    'plugins.hint': '个人插件仅本人可见可用;好用的插件可发起「转内置」给全团队使用。',
    'plugins.empty': '还没有安装个人插件',
    'plugins.enabled': '已启用',
    'plugins.disabled': '已停用',
    'plugins.promoted': '已转内置',
    'plugins.disable': '停用',
    'plugins.enable': '启用',
    'plugins.promote': '转内置',
    'plugins.delete': '删除',
    'plugins.deleteConfirm': '确认删除?',
    'plugins.namePlaceholder': '插件名(如 hello)',
    'plugins.nameLabel': '插件名',
    'plugins.dirPlaceholder': 'plugins 下的目录名',
    'plugins.dirLabel': '插件目录名',
    'plugins.install': '安装',
    'plugins.actionFailed': '操作失败',
    'notifications.title': '消息与审批',
    'notifications.unread': '({count} 未读)',
    'notifications.empty': '暂无消息',
    'notifications.mine': '我的申请',
    'notifications.pending': '待审批',
    'notifications.approved': '已通过',
    'notifications.rejected': '已驳回',
    'notifications.readAll': '全部标为已读',
    'approval.title': '审批队列',
    'approval.empty': '暂无待审批请求',
    'approval.notePlaceholder': '意见(可选)',
    'approval.noteLabel': '审批意见',
    'approval.applicant': '申请人',
    'approval.approve': '通过',
    'approval.reject': '驳回',
  },
  en: {
    'section.account': 'Account',
    'section.users': 'Users',
    'tab.manage': 'Eterna Plugins',
    'section.myPlugins': 'My Plugins',
    'section.notifications': 'Notifications',
    'section.approvalQueue': 'Approvals',
    'account.loading': 'Loading…',
    'account.passwordToggle': 'Toggle password visibility',
    'account.passwordToggleTitle': 'Show or hide password',
    'account.profile': 'Profile',
    'account.nickname': 'Nickname',
    'account.save': 'Save changes',
    'account.saving': 'Saving…',
    'account.unchanged': 'No changes',
    'account.willUpdateBoth': 'Nickname and avatar will be updated',
    'account.willUpdateAvatar': 'Avatar will be updated',
    'account.willUpdateNick': 'Nickname will be updated',
    'account.saved': 'Saved',
    'account.saveFailed': 'Save failed',
    'account.avatarReadFailed': 'Could not read image',
    'account.passwordCard': 'Change password',
    'account.passwordNote': 'This device stays signed in; other devices will need to sign in again.',
    'account.oldPassword': 'Current password',
    'account.newPassword': 'New password',
    'account.newPasswordPlaceholder': 'At least 8 characters',
    'account.confirmPassword': 'Confirm new password',
    'account.confirmPlaceholder': 'Re-enter new password',
    'account.changePassword': 'Change password',
    'account.passwordMismatch': 'The new passwords do not match',
    'account.passwordChanged': 'Password changed; other devices must sign in again',
    'account.passwordChangeFailed': 'Could not change password',
    'companion.title': 'Browser executor',
    'companion.desc': 'Turn your browser into the Agent executor. After installing the extension, the Agent can act on pages where you are signed in without moving your data or session out of the browser. Each browser connects with its own token.',
    'companion.loading': 'Loading…',
    'companion.empty': 'No access token yet.',
    'companion.copied': 'Copied',
    'companion.copy': 'Copy',
    'companion.reset': 'Reset token',
    'companion.resetConfirm': 'Click again to reset',
    'companion.generate': 'Generate token',
    'companion.guide': 'Install guide ↗',
    'companion.readFailed': 'Could not load',
    'companion.generated': 'Token generated',
    'companion.generateFailed': 'Could not generate token',
    'users.lead': 'Add a user (duplicate accounts get a numeric suffix; nickname defaults to the account and avatar to its first letter).',
    'users.account': 'Account',
    'users.password': 'Password (at least 8 characters)',
    'users.roleUser': 'User',
    'users.roleAdmin': 'Admin',
    'users.add': 'Add',
    'users.nickname': 'Nickname',
    'users.role': 'Role',
    'users.createdAt': 'Created',
    'users.current': 'Current session',
    'users.delete': 'Delete',
    'users.deleteConfirm': 'Confirm delete?',
    'users.created': 'User {account} created',
    'users.createdSuffix': 'User created as {account} (suffix added for duplicate)',
    'users.createFailed': 'Could not create user',
    'users.deleted': 'User deleted; their sessions were revoked',
    'users.deleteFailed': 'Could not delete user',
    'plugins.title': 'My plugins',
    'plugins.hint': 'Personal plugins are visible only to you; useful ones can be promoted for the whole team.',
    'plugins.empty': 'No personal plugins installed',
    'plugins.enabled': 'Enabled',
    'plugins.disabled': 'Disabled',
    'plugins.promoted': 'Promoted',
    'plugins.disable': 'Disable',
    'plugins.enable': 'Enable',
    'plugins.promote': 'Promote',
    'plugins.delete': 'Delete',
    'plugins.deleteConfirm': 'Confirm delete?',
    'plugins.namePlaceholder': 'Plugin name (e.g. hello)',
    'plugins.nameLabel': 'Plugin name',
    'plugins.dirPlaceholder': 'Directory under plugins',
    'plugins.dirLabel': 'Plugin directory',
    'plugins.install': 'Install',
    'plugins.actionFailed': 'Action failed',
    'notifications.title': 'Notifications & approvals',
    'notifications.unread': ' ({count} unread)',
    'notifications.empty': 'No notifications',
    'notifications.mine': 'My requests',
    'notifications.pending': 'Pending',
    'notifications.approved': 'Approved',
    'notifications.rejected': 'Rejected',
    'notifications.readAll': 'Mark all as read',
    'approval.title': 'Approval queue',
    'approval.empty': 'No pending requests',
    'approval.notePlaceholder': 'Note (optional)',
    'approval.noteLabel': 'Approval note',
    'approval.applicant': 'Requester',
    'approval.approve': 'Approve',
    'approval.reject': 'Reject',
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
  /** P1-T5:目录数据面(listDirectory/createDirectory → /api/directoryPicker/*,守卫钳根)。 */
  readonly uiWorkspace?: {
    listDirectory(path: string | undefined, signal?: AbortSignal): Promise<unknown>
    createDirectory(path: string, name: string): Promise<string>
  }
  /** 模型抽屉回显写面(ClientSessions 结构子集;服务端投影 store 单键 apply)。 */
  readonly sessions?: {
    projectionStore?(sessionId: string): {
      apply?(key: string, value: unknown, seq: number): void
    } | undefined
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
      inject: () => ({ t }),
      label: () => t('section.account'),
    }, AccountSection))
    // P4-T6.4/T7A(2026-11-11):消息与审批(全员);审批队列(admin)。
    // 「我的插件」(2026-11-11 第三轮)移入侧栏插件页 plugins.tab——插件管理统一入口。
    ctx.slots.inject('settings.section', () => ctx.slots.register({
      name: 'settings.section',
      id: `${NS}.notifications`,
      order: 43,
      locale: NS,
      inject: () => ({ t }),
      label: () => t('section.notifications'),
    }, NotificationsSection))
    // 侧栏「插件」页:「我的插件」页签(全员——个人层发现/启停/安装/转内置)
    ctx.slots.inject('plugins.tab', () => ctx.slots.register({
      name: 'plugins.tab',
      id: `${NS}.my-plugins`,
      order: 30,
      locale: NS,
      inject: () => ({ t }),
      label: () => t('section.myPlugins'),
    }, MyPluginsTab))
    if (role === 'admin') {
      ctx.slots.inject('settings.section', () => ctx.slots.register({
        name: 'settings.section',
        id: `${NS}.users`,
        order: 41,
        locale: NS,
        inject: () => ({ t }),
        label: () => t('section.users'),
      }, UsersSection))
      ctx.slots.inject('settings.section', () => ctx.slots.register({
        name: 'settings.section',
        id: `${NS}.approval-queue`,
        order: 44,
        locale: NS,
        inject: () => ({ t }),
        label: () => t('section.approvalQueue'),
      }, ApprovalQueueSection))
      // 侧栏「插件」页:「恒灵插件」管理页签(admin;与已安装/我的插件同层)。
      // plugins.tab=upstream ui-plugin-manager 主面板声明的 list slot
      // (index.ts:140)。2026-11-11 第一轮曾误判 slot 名不匹配改注 settings.plugins.tab
      // ——实际当时整页被 pluginManager/listBundles 门控隐藏;mux 补授权后页面可达,
      // 本名即正确挂载。
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

  // P1-T5(2026-11-11):目录树工作区选择器——双洞 directoryFlow slot 同构注册
  // (沿上游 browse 注册形态:nested inject + generator;单洞无竞争——上游 browse
  // 客户端已由 patch 裁掉:禁 directory-picker auto 行 + insert host-browse 仅路由)。
  if (ctx.uiWorkspace !== undefined) {
    const uiWorkspace = ctx.uiWorkspace
    const injected = () => ({
      listDirectory: (path: string | undefined, signal?: AbortSignal) => uiWorkspace.listDirectory(path, signal),
      createDirectory: (path: string, name: string) => uiWorkspace.createDirectory(path, name),
    })
    ctx.slots.inject('conversation.hero.workspace.directoryFlow', () => ctx.slots.inject('sidebar.workspaces.directoryFlow', function* () {
      yield ctx.slots.register({
        name: 'conversation.hero.workspace.directoryFlow',
        inject: injected,
      }, DirectoryTreeFlow)
      yield ctx.slots.register({
        name: 'sidebar.workspaces.directoryFlow',
        inject: injected,
      }, DirectoryTreeFlow)
    }))
  }

  // 模型选择抽屉(2026-11-12 用户裁定:抽屉二级展开):
  // - 拦截模型触发按钮 click → 开自绘抽屉(供应商→模型二级;shift+click 保留上游菜单)
  // - 提交走同窗 RPC(信封同构上游 typert);回显=ctx.sessions 投影单键本地写
  //   (rename 先例;control 流投影帧在多用户 mux 环境不达=上游实时回显缺口根因)
  // - 「+ 新建会话」常驻可见(上游 hover-only CSS;access 全局样式强制)
  registerModelDrawer(ctx)

  return disposeLocale
}

/** 模型双面板菜单装配。React 渲染走壳注入的 react-dom/client(CJS external)。 */
function registerModelDrawer(ctx: AccessClientContext): void {
  // CJS 闭包 require(esbuild external 运行时由浏览器壳 PLATFORM_MODULES 供给);
  // 类型侧 react-dom/client 不在包 devDeps,局部面声明。
  const requireShim = require as unknown as (id: 'react-dom/client') => { createRoot(container: Element): { render(node: React.ReactElement): void; unmount(): void } }
  const { createRoot } = requireShim('react-dom/client')
  let menuHost: HTMLDivElement | null = null
  const closeMenu = (): void => { menuHost?.remove(); menuHost = null }

  const openMenu = (sessionId: string, anchor: { x: number; y: number; width: number; top: number }): void => {
    closeMenu()
    menuHost = document.createElement('div')
    menuHost.setAttribute('data-eterna-model-menu-root', '')
    document.body.appendChild(menuHost)
    createRoot(menuHost).render(<ModelMenu
      sessionId={sessionId}
      anchor={anchor}
      dismiss={closeMenu}
      applySelection={(sid, selected) => {
        try {
          const store = ctx.sessions?.projectionStore?.(sid)
          store?.apply?.('modelSelection', { lastUsed: selected, next: selected }, 2 ** 40)
        } catch { /* 回显尽力而为:服务端切换本身不受影响 */ }
      }}
    />)
  }

  const readCurrentSession = (): string | null => {
    try {
      const raw = localStorage.getItem('dsh.sessions.current')
      const parsed = raw === null ? null : JSON.parse(raw) as { sessionId?: string }
      return typeof parsed?.sessionId === 'string' ? parsed.sessionId : null
    } catch { return null }
  }

  const attach = (): void => {
    const btn = [...document.querySelectorAll('button')].find(b => (b.getAttribute('aria-label') || '').startsWith('选择模型'))
    if (btn === undefined || btn.getAttribute('data-eterna-drawer-bound') === '1') return
    btn.setAttribute('data-eterna-drawer-bound', '1')
    btn.addEventListener('click', (e: MouseEvent) => {
      if (e.shiftKey) return // shift+click 保留上游菜单
      const sessionId = readCurrentSession()
      if (sessionId === null) return
      e.stopImmediatePropagation()
      e.preventDefault()
      const r = btn.getBoundingClientRect()
      openMenu(sessionId, { x: r.x, y: r.y, width: r.width, top: r.y })
    }, true) // capture:先于上游 menu-open 处理器
  }
  attach()
  new MutationObserver(() => { attach() }).observe(document.body, { childList: true, subtree: true })
}
