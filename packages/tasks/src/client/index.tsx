/**
 * @eterna/tasks 浏览器半边(2026-11-19 会话级 super 标记 + 任务设置分区):
 * - 设置分区「任务与超级智能体」(settings.section;settings.tsx,八卡全量设置);
 * - 会话头角色徽标(conversation.session.header.utilities;session-role.tsx,
 *   主控/执行,普通会话不渲染)。
 *
 * 装载形态与 @eterna/memory/@eterna/workbench 同配方:package.json 声明 dsh.client
 * (platform: web),scripts/build-client.mjs 产出 lib/client.js;宿主行 eterna-tasks
 * 是双面包(host + client)。数据面由 access 路由面提供(/access/api/tasks/*):
 * - session-roles 登录即可(徽标);settings GET/POST 仅 admin(设置分区)。
 *
 * UI 纪律(AGENTS.md §2/§3/§4):--et-* 语义令牌经 DSH 桥接跟随产品深浅主题、
 * 零字面色值;图标走 @eterna/ui/icons;文案全中文;合并保存 + 脏检查 + 单按钮;
 * 不用原生 confirm/alert。
 */
import { injectDesignTokens } from '@eterna/ui'
import { CSS } from './styles.ts'
import { NS, SETTINGS_LOCALES, en } from './locales.ts'
import { TASKS_SECTION_ID, TasksSettingsSection } from './settings.tsx'
import { SessionRoleBadgeEntry, SessionRoleRowEntry } from './session-role.tsx'
import { CANDIDATE_NODE_ID, CandidateCard, candidateCardRule } from './candidate-card.tsx'
import type { TasksClientContext } from './client-types.ts'

export { TASKS_SECTION_ID, TasksSettingsSection } from './settings.tsx'
export { NS, SETTINGS_LOCALES, en } from './locales.ts'
export { CSS } from './styles.ts'
export {
  dirtyBlocks, formBlocks, parseSourceConfig, optionalNumber, withBlock, cloneSettings, validateSettings,
} from './settings-model.ts'
export type {
  AdmissionRowView, AllowedView, BudgetCapsView, BudgetView, EvalView, ExecutorView, PolicyView, RoleModelView,
  RuleView, SourceInstanceView, SourcePolicyView, TasksSettings, ValidationIssue,
} from './settings-model.ts'
export {
  SessionRoleBadge, SessionRoleBadgeEntry, SessionRoleRowEntry, fetchSessionRolesCached, resetSessionRolesCache, sessionRoleOf,
} from './session-role.tsx'
export type { SessionRole } from './session-role.tsx'
export { CANDIDATE_NODE_ID, CandidateCard, candidateCardRule, parseCandidateCard } from './candidate-card.tsx'
export type { CandidateCardData } from './candidate-card.tsx'
export { fetchTasksSessionRoles, fetchTasksSettings, saveTasksBlock, TasksApiError } from './api.ts'
export type { TasksSaveOk, TasksSessionRoles, TasksSettingsView } from './api.ts'

/** 会话徽标席位 id(profile 侧槽位条目登记用)。 */
export const SESSION_BADGE_ID = 'eterna-tasks.session-badge'
/** 侧边栏会话行角色席位 id。 */
export const SESSION_ROW_BADGE_ID = 'eterna-tasks.session-row-badge'

/**
 * 运行时依赖服务表(DSH bundle loader 读取;与 package.json dsh.client.inject 同真值):
 * slots/locale + uiWorkspace(设置卡「打开主会话」)+ uiConversation(候选卡文本规则)。
 */
export const inject = ['slots', 'locale', 'uiWorkspace', 'uiConversation']

function injectTasksStyles(doc: Document = document): void {
  injectDesignTokens({ bridge: true, doc })
  if (doc.getElementById('eterna-tasks-styles') !== null) return
  const style = doc.createElement('style')
  style.id = 'eterna-tasks-styles'
  style.textContent = CSS
  doc.head.append(style)
}

/**
 * 浏览器插件体:注册字典、设置分区、角色徽标(会话头 + 侧边栏行)与候选卡渲染。
 * @param ctx - 浏览器插件上下文。
 * @returns 撤销字典与候选规则的 disposer(slot 贡献随插件 fiber 自撤)。
 */
export function apply(ctx: TasksClientContext): () => void {
  injectTasksStyles()
  const disposeLocale = ctx.locale.register(NS, { zh: { ...SETTINGS_LOCALES }, en })
  const t = ctx.locale.bind(NS)
  const uiWorkspace = ctx.uiWorkspace
  // ① 设置分区「任务与超级智能体」(admin 文案由端点 403 反馈;非 admin 见权限说明)。
  ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section',
    id: TASKS_SECTION_ID,
    order: 47,
    locale: NS,
    inject: () => ({ t, ...(uiWorkspace === undefined ? {} : { uiWorkspace }) }),
    label: () => t('section'),
  }, TasksSettingsSection))
  // ② 会话头角色徽标(右对齐状态位;普通会话取不到角色时不渲染)。
  ctx.slots.inject('conversation.session.header.utilities', () => ctx.slots.register({
    name: 'conversation.session.header.utilities',
    id: SESSION_BADGE_ID,
    locale: NS,
    inject: () => ({ t }),
  }, SessionRoleBadgeEntry))
  // ③ 侧边栏会话行角色 chip(「主控/执行」与普通会话同列区分;运行时也常驻)。
  ctx.slots.inject('sidebar.session.row.trailing', () => ctx.slots.register({
    name: 'sidebar.session.row.trailing',
    id: SESSION_ROW_BADGE_ID,
    locale: NS,
    inject: () => ({ t }),
  }, SessionRoleRowEntry))
  // ④ 候选卡可读化:规则注册在宿主 userText 面;node 渲染器挂在 keyed 子席位。
  const uiConversation = ctx.uiConversation
  let disposeRule: (() => void) | undefined
  if (uiConversation !== undefined) {
    disposeRule = uiConversation.userText.register(candidateCardRule)
    ctx.slots.inject('conversation.user.text.node', () => ctx.slots.register({
      name: 'conversation.user.text.node',
      key: CANDIDATE_NODE_ID,
      priority: 100,
      locale: NS,
      inject: () => ({ t }),
    }, CandidateCard))
  }
  return () => {
    disposeRule?.()
    disposeLocale()
  }
}