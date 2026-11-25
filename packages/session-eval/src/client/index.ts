/**
 * @eterna/session-eval 浏览器半边:右侧栏「评测」tab(P0 只读)。
 *
 * ## 两段注册(ui-sidebar-right 的 tab 契约)
 * 1. **tab 类型** —— `ctx.sidebarRightTabs.register({ id, kind, priority, title, guide })`
 *    静态声明。本插件不需要资源协议(不承载第二段会话),是**页面型** tab:
 *    从右栏导引卡片按 kind 打开,body 直接读主会话(`sessionId` 标准 prop),
 *    快照经 access 守卫路由取。
 * 2. **body** —— `ctx.slots.register({ name: 'sidebar.right.pane.tab', key: 类型 id }, EvalPanel)`。
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
import { injectSessionEvalStyles } from './styles.ts'
import type { SessionEvalClientContext } from './client-types.ts'

/** tab 类型的全系统身份(ui-sidebar-right 契约:id 唯一,kind 至多一 builtin 一 extension)。 */
const TAB_TYPE_ID = '@eterna/session-eval/panel'

/** tab kind(按 kind 打开页面;不与上游 kind 撞名)。 */
export const SESSION_EVAL_TAB_KIND = 'eval'

/** 依赖服务:slot 注册表、右侧栏 tab 类型注册表。 */
export const inject = ['slots', 'sidebarRightTabs']

/**
 * 评测面板插件体:注入样式、注册 tab 类型与其 body。
 * @param ctx - 浏览器插件上下文.
 * @returns disposer(注册随插件 fiber 自撤).
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
      description: () => '当前会话的确定性评分：工具成败、参数合法、重复调用、审批与用量（零模型成本）。',
    }],
  })

  const disposeBody = ctx.slots.inject('sidebar.right.pane.tab', () => ctx.slots.register({
    name: 'sidebar.right.pane.tab',
    key: TAB_TYPE_ID,
  }, EvalPanel as never))

  return () => {
    disposeBody()
    disposeType()
    disposeStyles()
  }
}
