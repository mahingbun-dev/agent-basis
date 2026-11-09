/**
 * @eterna/access —— 账号门禁插件(计划书 2026-11-09 v2,Phase 1)。
 * 登录/登出+管理员用户管理(env 播种 admin,不开放注册)+用户自助配置
 * (昵称/头像/密码)+'/' 登录桥接(authenticatedUrl)+tapIndex 账号角标+审计+限速。
 */
export { defineAccessPlugin, ACCESS_PLUGIN_NAME, injectBadge } from './plugin.ts'
export type { AccessContext, AccessPluginConfig } from './plugin.ts'
export { handleAccessRequest } from './routes.ts'
export type { AccessDeps } from './routes.ts'
export { SessionService, loadOrCreateSecret } from './session.ts'
export type { SessionClaims } from './session.ts'
export { UserStore, accountCandidates } from './store.ts'
export {
  AccountExistsError, LastAdminError, NicknamePolicyError, OldPasswordMismatchError,
  SelfDeleteError, SuffixExhaustedError, UserNotFoundError,
} from './store.ts'
export { SlidingWindow } from './ratelimit.ts'
export { BADGE_SCRIPT, renderAccountPage, renderAdminPage, renderForbiddenPage, renderLoginPage } from './pages.ts'
export { reportAccessAudit } from './audit.ts'
export type { AccessAuditEvent } from './audit.ts'
export { isSameOrigin, parseAvatarDataUrl, clientIp } from './http.ts'
export {
  ACCOUNT_PATTERN, PasswordPolicyError, hashPassword, validateAccount, validatePassword, verifyPassword,
} from './password.ts'

// DSH bundle loader 取 default export 插件实例(漏写 = 静默不装载,硬性规范 1)
import { defineAccessPlugin } from './plugin.ts'
export default defineAccessPlugin()
