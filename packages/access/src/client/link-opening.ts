/**
 * 「网页链接默认打开方式」联动（2026-11-13）：上游 chat 设置 linkOpening 的
 * 出厂默认是 sidebar（应用内侧边栏，dsh-client-ui-chat DEFAULT_LINK_OPENING）。
 * 当用户自己的浏览器扩展（companion 执行面）在线时，对话里的网页链接应默认
 * 用系统默认浏览器开新页签——链接与浏览器任务的执行面保持同一台浏览器。
 *
 * 纪律：只翻「出厂默认」——用户在设置里显式选过（存储值非空）一律尊重，绝不
 * 覆盖；扩展离线/令牌未生成/探测失败全部静默跳过（本模块零 UI、零报错面）。
 * 写入走上游公开服务 configForms.get('ui-chat')（与设置行同一写面），零 shell 改动。
 */

/** companion 视图结构子集（api.ts CompanionView 复用面）。 */
export interface CompanionViewLike {
  readonly token: string | null
  readonly guideUrl: string
}

/** 上游 chat 设置结构子集（configForms.get('ui-chat') 的消费面）。 */
export interface ChatSettingsLike {
  getSnapshot(): { readonly value?: { readonly linkOpening?: unknown } | undefined } | undefined
  set(field: string, value: unknown): Promise<boolean>
}

/**
 * 联动判定（纯函数）：已生成令牌 + 自己的扩展在线 + 用户从未显式选择 → 翻默认浏览器。
 * stored 非 undefined（含用户选回 sidebar）= 显式选择，尊重之。
 */
export function shouldDefaultLinkToBrowser(input: {
  readonly stored: unknown
  readonly token: string | null
  readonly tokenConnected: boolean | undefined
}): boolean {
  if (input.token === null || input.token === '') return false
  if (input.tokenConnected !== true) return false
  return input.stored === undefined || input.stored === null
}

/** 指引页地址 → relay 基址（companionGuideUrl 恒以 /companion/guide 结尾；剥离即基址）。 */
export function relayBaseFromGuideUrl(guideUrl: string): string {
  return guideUrl.replace(/\/companion\/guide\/?$/, '')
}

/** relay /api/status 响应结构子集（tokenConnected 由 ?token= 探测返回）。 */
interface StatusLike {
  readonly tokenConnected?: boolean
}

export interface LinkOpeningDeps {
  readonly companion: () => Promise<CompanionViewLike>
  /** 按令牌探测扩展在线（GET <relay>/api/status?token=，CORS * 已开）。 */
  readonly status: (relayBase: string, token: string) => Promise<StatusLike>
  readonly chatSettings: ChatSettingsLike | undefined
}

/** 装载联动（fire-and-forget；任何一步失败静默——体验增强不构成错误面）。 */
export async function installLinkOpeningDefault(deps: LinkOpeningDeps): Promise<void> {
  try {
    if (deps.chatSettings === undefined) return
    const stored = deps.chatSettings.getSnapshot()?.value?.linkOpening
    const view = await deps.companion()
    if (view.token === null || view.token === '') return
    if (stored !== undefined && stored !== null) return // 显式选择过,尊重之(探测都省了)
    const relayBase = relayBaseFromGuideUrl(view.guideUrl)
    if (relayBase === '' || relayBase === view.guideUrl) return
    const status = await deps.status(relayBase, view.token)
    // 复读最新存储值:等待探测期间用户显式选择则以最新为准
    const latest = deps.chatSettings.getSnapshot()?.value?.linkOpening
    const ok = shouldDefaultLinkToBrowser({ stored: latest, token: view.token, tokenConnected: status.tokenConnected })
    if (!ok) return
    await deps.chatSettings.set('linkOpening', 'new-tab')
  } catch {
    /* 静默：联动失败不影响任何主流程 */
  }
}
