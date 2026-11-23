/**
 * 插件页只读守卫(T6.2,2026-11-24 用户裁定「全员可进插件页、看到全部页签,
 * 只有『我的插件』页签可操作,其余只读」)。
 *
 * 分工:
 * - **真正的边界在服务端**:非 admin 对 `/api/pluginManager/*` 只放行读白名单,
 *   写方法一律 403(`packages/access/src/mux.ts` MARKET_MEMBER_METHODS)。绕过前端
 *   也改不了任何东西。
 * - 本文件只负责**体验层**:把非 admin 看到的上游写控件置灰并拦掉点击/键盘触发,
 *   避免「点了才报错」。
 *
 * 为什么靠 DOM 选择器而不是改上游组件:上游 `ui-plugin-manager` 的写控件来自
 * ui-primitives 的 `Switch`/`Button`,没有可依赖的稳定 class(哈希随构建变);
 * 可依赖的只有语义面——`button[role=switch]` 与固定 `aria-label` 文案
 * (zh 字典:`添加插件`/`选择添加插件方式`/`卸载 {name}`/`更新 {name}`/
 * `启用 {name}`),以及页面根 `[data-plugin-panel]`。样式同口径见 styles.ts。
 *
 * 只读白名单要放过的:「刷新」(纯读,aria-label=`刷新`);「我的插件」页签是
 * 我方自绘内容,不在 `[data-plugin-panel]` 内,天然不受影响。
 */

/** 角色标记属性(写在 `<html>` 上;样式表按它分流)。 */
export const ROLE_ATTRIBUTE = 'data-eterna-access-role'

/** 写控件选择器(非 admin 一律拦截)。`[data-plugin-panel]` 限定在插件页主面板内,
 *  不误伤 sidebar/settings 里的其它 role=switch(例如记忆/任务设置的自绘开关)。 */
const WRITE_CONTROLS: readonly string[] = [
  '[data-plugin-panel] button[role="switch"]',
  '[data-plugin-panel] button[aria-label^="添加插件"]',
  '[data-plugin-panel] button[aria-label^="选择添加插件方式"]',
  '[data-plugin-panel] button[aria-label^="卸载 "]',
  '[data-plugin-panel] button[aria-label^="更新 "]',
]

/** 一次点击/按键的目标是否落在写控件上。 */
export function isWriteControl(target: EventTarget | null): boolean {
  if (target === null || typeof (target as Element).closest !== 'function') return false
  return WRITE_CONTROLS.some(selector => (target as Element).closest(selector) !== null)
}

/** 安装只读守卫;返回卸载函数(幂等:重复安装只在最后 dispose 时摘除)。
 *
 *  捕获阶段 `stopImmediatePropagation`:上游 React 的 onClick 在冒泡阶段绑定,
 *  捕获阶段拦下即不会触发它的 setBundleEnabled/install/remove 调用;再做
 *  `preventDefault` 让 Enter/Space 的默认激活一并失效。 */
export function installReadOnlyGuard(doc: Document = document): () => void {
  const onClick = (event: MouseEvent): void => {
    if (!isWriteControl(event.target)) return
    event.preventDefault()
    event.stopImmediatePropagation()
  }
  // 键盘:原生 button 的 Enter/Space 会合成 click,但部分壳层直接监听 keydown,
  // 故同时挡一道(仅挡这两个激活键,不干扰 Tab 焦点遍历与读屏浏览)。
  const onKeyDown = (event: KeyboardEvent): void => {
    if (event.key !== 'Enter' && event.key !== ' ' && event.key !== 'Spacebar') return
    if (!isWriteControl(event.target)) return
    event.preventDefault()
    event.stopImmediatePropagation()
  }
  doc.addEventListener('click', onClick, true)
  doc.addEventListener('keydown', onKeyDown, true)
  return () => {
    doc.removeEventListener('click', onClick, true)
    doc.removeEventListener('keydown', onKeyDown, true)
  }
}

/** 按角色装配:admin 只写标记(供样式分流,不装拦截);非 admin 双管齐下。
 *
 *  返回卸载函数——插件卸载时摘除监听并清掉标记(不留全局残留,AGENTS.md
 *  「apply 的 disposer 收全全部逆」)。 */
export function applyPluginPageRole(role: 'admin' | 'user', doc: Document = document): () => void {
  const html = doc.documentElement
  html.setAttribute(ROLE_ATTRIBUTE, role === 'admin' ? 'admin' : 'member')
  if (role === 'admin') {
    return (): void => { html.removeAttribute(ROLE_ATTRIBUTE) }
  }
  const disposeGuard = installReadOnlyGuard(doc)
  return (): void => {
    disposeGuard()
    html.removeAttribute(ROLE_ATTRIBUTE)
  }
}
