/**
 * 参谋 tab 的资源地址:把一个参谋会话 id 编码进 `dsh-resource://` 地址。
 *
 * ## 为什么必须走资源地址(而不是导航参数)
 * 右栏布局持久化(`ui-sidebar-right/src/client/persistence.ts`)对每个 tab 只存
 * `{ id, kind, contentId, title }` —— `connection.params` **不落盘**。若参谋的
 * 会话 id 只经开放参数传入,刷新后 tab 还在但不知道自己是哪个会话,面板必然空白。
 * 上游 `ui-subagent` 的 sidebar-chat 正是为此把整条 subagent 地址编码进 contentId;
 * 本插件同构:contentId 就是地址,恢复时由地址重新解析出会话 id 与父会话 id。
 *
 * ## 为什么不带 `mode`
 * 上游带 `mode`(one-shot/continuable)是因为它同时服务模型工具建的一次性会话;
 * 参谋**恒为 continuable**(spawn + prepareContinuable + reserved childId),该字段
 * 只会成为又一个可能写错的地方。少一个字段 = 少一类恢复失败。
 */

/** 协议名(资源地址的 host 段;与 ui-subagent 的 'subagentchat' 并列,不抢占)。 */
export const ADVISER_PROTOCOL = 'adviserchat'

/** 地址前缀。 */
export const ADVISER_CHAT_ADDRESS = `dsh-resource://${ADVISER_PROTOCOL}/session/`

/** 一条参谋会话的地址解析结果。 */
export interface AdviserChatTarget {
  /** 参谋会话 id(child)。 */
  readonly childSessionId: string
  /** 父(主)会话 id:列表/创建/投递三条端点的 parent 参数。 */
  readonly parentSessionId: string
}

/**
 * 组装一条参谋会话的资源地址。
 * @param parentSessionId - 主会话 id。
 * @param childSessionId - 参谋会话 id。
 * @returns 规范地址。
 */
export function adviserChatAddress(parentSessionId: string, childSessionId: string): string {
  const query = new URLSearchParams({ parent: parentSessionId })
  return `${ADVISER_CHAT_ADDRESS}${encodeURIComponent(childSessionId)}?${query}`
}

/**
 * 解析一条参谋资源地址。
 * @param value - 候选地址。
 * @returns 解析结果;不是本协议或结构不合规时为 undefined(不抛,路由判定每帧都跑)。
 */
export function parseAdviserChatAddress(value: string): AdviserChatTarget | undefined {
  let url: URL
  try {
    url = new URL(value)
  } catch {
    return undefined
  }
  // 非特殊 scheme 的 host 由 URL 解析器按原样保留大小写(见 client-resources protocolOf)。
  if (url.protocol !== 'dsh-resource:' || url.hostname.toLowerCase() !== ADVISER_PROTOCOL) return undefined
  const parts = url.pathname.split('/').filter(Boolean)
  if (parts.length !== 2 || parts[0] !== 'session') return undefined
  const parentSessionId = url.searchParams.get('parent')
  if (parentSessionId === null || parentSessionId === '') return undefined
  try {
    const childSessionId = decodeURIComponent(parts[1] as string)
    if (childSessionId === '') return undefined
    return { childSessionId, parentSessionId }
  } catch {
    return undefined
  }
}
