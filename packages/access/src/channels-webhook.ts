/**
 * channels webhook 公共面(39 号 §3-E8;铁律 T2 路由面独占,24a 裁决口径:
 * 数据面经 channels 插件 provide、路由面经 access 登记——本模块是 access 侧登记点)。
 *
 * 这是**服务器到服务器**的公共面:外部渠道(飞书/钉钉/邮件/微信)入站 webhook 与
 * 邮件审批令牌一次性兑换没有浏览器 cookie,access 的租户守卫(favicon 会话面)
 * 不适用;鉴权由 channels 网关自带 fail-closed 语义(HMAC-SHA256 timing-safe 验签 /
 * 单次令牌,401/404/410/413/202 状态码契约留在 channels 包单一实现)。本模块只做:
 * 1. prefix 路由登记(`​/channels/api`,与 glue channels-plugin 的
 *    CHANNELS_WEBHOOK_PATH_PREFIX 缺省值同源;webhookPathPrefix 配置覆写须同步此
 *    处——字面量漂移即 404,特此显式钉住);
 * 2. 逐请求 reflect 机会读取 `channels` 服务面取 world.gateway 转发——channels
 *    晚于/早于 access 挂载都成立,卸载即网关消失;
 * 3. fail-closed 兜底:网关缺席 503(明示,不静默 404 冒充未配置渠道)、管线异常
 *    500 JSON(与 channels 包 start() 自起 server 的 createServer 回调同款)。
 * 本插件卸载时路由随 disposer 摘除。
 */
import type { IncomingMessage, ServerResponse } from 'node:http'

/** channels 入站 webhook 前缀(与 glue channels-plugin CHANNELS_WEBHOOK_PATH_PREFIX 缺省值同源)。 */
export const CHANNELS_WEBHOOK_PATH_PREFIX = '/channels/api'

/** webServer seam 的结构子集(register;与 plugin.ts AccessWebServer 同源)。 */
export interface ChannelsWebhookWebServer {
  register(route: {
    kind: 'exact' | 'prefix'
    path: string
    handler(req: IncomingMessage, res: ServerResponse): void | Promise<void>
  }): () => void
}

/** reflect 机会读取面(audit-bridge 同款:strict=false,缺席 undefined)。 */
export interface ChannelsWebhookReflect {
  get(key: string, strict?: boolean): unknown
}

/** channels 网关转发面(world.gateway 的结构子集;handle 自写应答)。 */
export interface ChannelsGatewayFace {
  handle(req: IncomingMessage, res: ServerResponse): Promise<void>
}

/**
 * 登记 channels webhook 公共面;返回 disposer(access 配逆收口)。
 * 逐请求解析网关:挂载顺序无关,卸载 channels 后即 503。
 */
export function registerChannelsWebhook(
  webServer: ChannelsWebhookWebServer,
  reflect: ChannelsWebhookReflect,
): () => void {
  return webServer.register({
    kind: 'prefix',
    path: CHANNELS_WEBHOOK_PATH_PREFIX,
    handler: (req, res) => {
      const world = reflect.get('channels', false) as
        | { readonly gateway?: ChannelsGatewayFace | undefined }
        | undefined
      const gateway = world?.gateway
      if (gateway === undefined) {
        if (!res.headersSent) {
          res.writeHead(503, { 'content-type': 'application/json; charset=utf-8' })
          res.end(JSON.stringify({ error: 'unavailable', detail: 'channels webhook 网关未挂载(eterna-channels 插件未启用或 sessionPort 未配置)' }))
        }
        return
      }
      gateway.handle(req, res).catch((error: unknown) => {
        // 500 兜底与 channels 包 start() 自起 server 同款(createServer 回调):
        // 管线内异常物化为 JSON 错误应答,不让宿主进程裸抛
        if (!res.headersSent) {
          res.writeHead(500, { 'content-type': 'application/json; charset=utf-8' })
          res.end(JSON.stringify({ error: 'internal', detail: error instanceof Error ? error.message : String(error) }))
        } else {
          res.destroy()
        }
      })
    },
  })
}
