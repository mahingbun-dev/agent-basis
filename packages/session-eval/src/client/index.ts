/**
 * @eterna/session-eval 浏览器半边:右侧栏「评测」tab + 设置弹窗「评测」分区。
 *
 * ## 注册面(两处原生扩展点,无独立页面入口)
 * 1. **右栏 tab 类型** —— `ctx.sidebarRightTabs.register({ id, kind, priority, title, guide })`
 *    静态声明;页面型 tab(不承载第二段会话),body 直接读主会话(`sessionId` 标准 prop),
 *    快照经 access 守卫路由取。
 * 2. **右栏 tab body** —— `ctx.slots.register({ name: 'sidebar.right.pane.tab', key }, EvalPanel)`。
 * 3. **设置分区** —— `ctx.slots.register({ name: 'settings.section', id, order, label }, EvalSettingsSection)`:
 *    裁判模型 / 抽样 / 预算 / 指标启停(资料类字段合并保存;非管理员只读)。
 *
 * ## 为什么不声明 patterns / 资源提供者
 * 评测面板没有「每个 tab 一份独立内容」的语义(同一会话只有一份评测),因此
 * `multiple` 省略、不注册 `resources`;打开一次即显示当前会话的快照,会话切换
 * 由标准 props 驱动重拉。
 *
 * 类型采用本地结构面(client-types.ts):浏览器运行的 cordis 服务面比本仓库安装
 * 类型宽,跨包类型导入会引入 dsh 客户端包依赖;运行时鸭子一致,构建期零外部类型
 * 依赖(adviser / panel / attachments 同款纪律)。
 */
import { EvalPanel } from './EvalPanel.tsx'
import { EvalSettingsSection } from './EvalSettings.tsx'
import { injectSessionEvalStyles } from './styles.ts'
import type { SessionEvalClientContext } from './client-types.ts'

/** tab 类型的全系统身份(ui-sidebar-right 契约:id 唯一,kind 至多一 builtin 一 extension)。 */
const TAB_TYPE_ID = '@eterna/session-eval/panel'

/** 设置分区的全系统身份(settings.section 契约:id 唯一)。 */
export const SESSION_EVAL_SECTION_ID = '@eterna/session-eval/settings'

/** tab kind(按 kind 打开页面;不与上游 kind 撞名)。 */
export const SESSION_EVAL_TAB_KIND = 'eval'

/** 依赖服务:slot 注册表、右侧栏 tab 类型注册表。 */
export const inject = ['slots', 'sidebarRightTabs']

/**
 * 评测面板插件体:注入样式、注册 tab 类型/body 与设置分区。
 * @param ctx - 浏览器插件上下文.
 * @returns disposer(注册随插件 fiber 自撤)。
 */
export function apply(ctx: SessionEvalClientContext): () => void {
  const disposeStyles = injectSessionEvalStyles()

  const disposeType = ctx.sidebarRightTabs.register({
    id: TAB_TYPE_ID,
    kind: SESSION_EVAL_TAB_KIND,
    // 外部插件类型压过内置同地址查看器(VS Code 同款扩展带语义)。
    priority: 'extension',
    title: () => '评测',
    // 切 tab / 折叠不丢面板状态(快照已在内存,重挂只会多一次拉取)。
    keepMounted: true,
    // 页面型类型没有任何地址路由,导引卡是唯一入口(没有它就无从打开)。
    guide: [{
      id: 'open',
      order: 41,
      title: () => '评测',
      description: () => '当前会话的确定性评分与模型裁判：工具成败、参数合法、重复调用、审批与用量；任务完成与约束遵循由裁判异步出分。',
    }],
  })

  const disposeBody = ctx.slots.inject('sidebar.right.pane.tab', () => ctx.slots.register({
    name: 'sidebar.right.pane.tab',
    key: TAB_TYPE_ID,
  }, EvalPanel as never))

  // 设置分区:裁判模型 / 抽样 / 预算 / 指标启停(order 48:40–47 已被账号、MCP、
  // 通知、压缩、更新记录、记忆、基座、任务占用;不挪别人的序)。
  const disposeSection = ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section',
    id: SESSION_EVAL_SECTION_ID,
    order: 48,
    label: () => '评测',
  }, EvalSettingsSection as never))

  return () => {
    disposeSection()
    disposeBody()
    disposeType()
    disposeStyles()
  }
}
