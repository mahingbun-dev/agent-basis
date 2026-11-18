/**
 * channels 插件(39 号 §3-E8 装配形态):把 @eterna/channels 的绑定存储/一次性审批
 * 令牌/Source 统一接收面装配为 ctx.channels 服务,并把 webhook 入站网关挂上宿主
 * webServer —— `POST {prefix}/webhook/:channelType`(prefix 缺省 `/channels/api`,
 * 即 39 号 E8 钉死的端点 POST /channels/api/webhook/:channelType)与
 * `GET|POST {prefix}/approval/:token`(邮件一次性令牌点击,12 号 §7.7;
 * 出站卡的 approvalBaseUrl = 站点根 + 本 prefix)。
 *
 * 装配面(governance-plugin 先例,name/inject/apply + 返回配逆闭包):
 * - 服务:`ctx.provide('channels', world)` —— createChannelsService() 产物
 *   (bindings/tokens/adapters/sources + startWebhookGateway/close,channels 包
 *   「注册表 + 唯一 ID」对外形态,id 溯源 '@eterna/channels')+ cards 渲染器 + 网关;
 *   dbPath 遵循 DSH_HOME 语义下的 `.eterna/` 缺省约定(多租户铁律,AGENTS.md:17-21;
 *   memory/knowledge admin 先例 profiles/eterna-web/cordis.patch.yml:517-519 同款)。
 * - webhook 端点:`ctx.inject(['webServer'], …)` 子 fiber(brand 同款姿势——webServer
 *   由宿主延迟提供,静态 inject 在无 Web 层形态会把整个插件挂死 pending)注册
 *   prefix 路由,handler 原样委托 WebhookGateway.handle。HMAC 验签沿用 channels 包
 *   语义(WebhookSecretTable per-channel secret/header/scheme,WebhookGateway.
 *   verifySignature 的 HMAC-SHA256 timing-safe 比对),401/404/410/413/202 状态码
 *   契约全部留在 channels 包单一实现里,glue 不复制语义(39 §3-E3 契约不变)。
 *   gateway.close 无需进配逆:宿主挂载形态不 start() 自起 server,配逆只摘路由。
 * - 独立监听形态:无宿主 Web 层的部署经 world.startWebhookGateway()(channels 包
 *   既有服务面,自起 http server;39 §3-E8「startWebhookGateway 的 close 进配逆」
 *   由调用方处置)。
 *
 * 配逆(全量无残留):摘 webServer 路由 → 关 sqlite 库(service.close,显式收口
 * 存储面)→ 撤服务 provide —— 卸载后路由/服务/库三面归零(G2-E6 装卸无残留)。
 *
 * fail-closed 口径:secrets 缺省 {} = 任何渠道 type 都 404 unknown-channel
 * (gateway 既有语义);sessionPort 缺席 = 不装配网关、不注册路由、world.gateway
 * 如实 undefined(渠道出站令牌/绑定存储照常可用),并打一条观测日志。
 */
import { join } from 'node:path'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Context } from '@deepseek-ai/cordis'
import {
  WebhookGateway,
  buildApprovalCard,
  buildReplyCard,
  classifyDeliveryFailure,
  createChannelsService,
  renderDingTalkCard,
  renderFeishuCard,
  renderReportLines,
  validateOutboundCard,
} from '@eterna/channels'
import type {
  BuildApprovalCardInput,
  ChannelsService,
  DingTalkCardPayload,
  DeliveryFailureKind,
  FeishuCardPayload,
  OutboundCard,
  ReplyCardInput,
  ReportState,
} from '@eterna/channels'
import type { ChannelsPluginConfig } from '../types.ts'

export const ETERNA_CHANNELS_PLUGIN_NAME = 'eterna-channels'

/** 本插件 provide 用的服务名(ctx 属性名即 provide 名,39 号 E8「provide ctx.channels」)。 */
export const CHANNELS_PLUGIN_SERVICE_ID = 'channels'

/**
 * webhook 端点前缀(39 号 E8 原文:POST /channels/api/webhook/:channelType)。
 * 邮件令牌点击路由同挂该前缀下:/channels/api/approval/:token。
 */
export const CHANNELS_WEBHOOK_PATH_PREFIX = '/channels/api'

/**
 * 本插件消费的 Web 载体 seam(webServer.register 的结构子集;access 插件
 * AccessWebServer 同款,packages/access/src/plugin.ts:44-52 生产实证形态)。
 */
export interface ChannelsWebServerFace {
  register(route: {
    kind: 'exact' | 'prefix'
    path: string
    handler(req: IncomingMessage, res: ServerResponse): void | Promise<void>
  }): () => void
}

/** 出站卡片渲染器(39 号 E8「cards 渲染器」装配面):cards.ts 管线的单一服务出口。 */
export interface ChannelsCardsFace {
  /** 审批卡(双令牌载荷强制装配,channels buildApprovalCard 强校验)。 */
  buildApprovalCard(input: BuildApprovalCardInput): OutboundCard
  /** Outbox reply 组卡(attention→approval 载荷;result→六态渲染;working 类中间态不出站=undefined)。 */
  buildReplyCard(input: ReplyCardInput): OutboundCard | undefined
  /** 出站卡强校验(kind=approval 必携带 approve+reject 齐备的载荷)。 */
  validateOutboundCard(card: OutboundCard): void
  /** 飞书互动卡渲染(按钮 value 内嵌统一动作载荷)。 */
  renderFeishuCard(card: OutboundCard): FeishuCardPayload
  /** 钉钉 actionCard 渲染(审批按钮为 URL 型,走 /approval/:token 一次性令牌)。 */
  renderDingTalkCard(card: OutboundCard, options: { readonly approvalBaseUrl: string }): DingTalkCardPayload
  /** 报告六态 → 中文文案行(E7;进卡片 body)。 */
  renderReportLines(state: ReportState, summary: string): string
  /** 投递错误分类(channelIgnored/channelGone→dropped 记账在 tasks;其余 transient)。 */
  classifyDeliveryFailure(error: unknown): DeliveryFailureKind
}

/** 卡片渲染器装配:纯函数管线原样转发(不包状态,不发明语义)。 */
function createChannelsCardsFace(): ChannelsCardsFace {
  return {
    buildApprovalCard,
    buildReplyCard,
    validateOutboundCard,
    renderFeishuCard,
    renderDingTalkCard,
    renderReportLines,
    classifyDeliveryFailure,
  }
}

/** ctx.channels 服务面:createChannelsService 产物 + cards 渲染器 + 宿主挂载网关。 */
export type ChannelsWorld = ChannelsService & {
  /** 出站卡片渲染器(E8 装配面;E4 出站/E7 Outbox 组卡的消费入口)。 */
  readonly cards: ChannelsCardsFace
  /**
   * 宿主 webServer 挂载形态装配的网关(config.sessionPort 缺席时 undefined——
   * 不装配不挂路由;独立监听形态走 ChannelsService.startWebhookGateway)。
   */
  readonly gateway: WebhookGateway | undefined
}

export function defineChannelsPlugin(config: ChannelsPluginConfig = {}) {
  return {
    name: ETERNA_CHANNELS_PLUGIN_NAME,
    apply(ctx: Context): () => void {
      const dbPath = config.dbPath ?? join(process.cwd(), '.eterna/channels.sqlite3')
      const service = createChannelsService({
        dbPath,
        ...(config.adapters !== undefined && { adapters: config.adapters }),
        ...(config.tokenOptions !== undefined && { tokenOptions: config.tokenOptions }),
      })
      const pathPrefix = config.webhookPathPrefix ?? CHANNELS_WEBHOOK_PATH_PREFIX
      // WebhookGateway 装配(sessionPort 必填,channels 包网关契约):sessionPort 由
      // 组合层桥接 DSH acp seam(channels types.ts 头注);缺席 = 网关整体缺席。
      const gateway = config.sessionPort === undefined
        ? undefined
        : new WebhookGateway({
          bindings: service.bindings,
          tokens: service.tokens,
          sessionPort: config.sessionPort,
          // secrets 缺省 {} = 全渠道 404 unknown-channel(fail-closed,不发明第三种姿态)
          secrets: config.secrets ?? {},
          // tasks 侧统一接收端口(E3:thread 优先、无 thread 绑定回退 session 投递)
          ...(config.sink !== undefined && { sources: { registry: service.sources, sink: config.sink } }),
          pathPrefix,
        })
      const world: ChannelsWorld = {
        ...service,
        cards: createChannelsCardsFace(),
        gateway,
      }
      // 官方 seam:ctx 属性必须经 provide 声明后才能赋值(governance-plugin 同款注释)
      const disposeService = ctx.provide(CHANNELS_PLUGIN_SERVICE_ID, world)
      const disposers: Array<() => void> = []
      const logger = (ctx as unknown as { readonly logger?: { info?: (...args: unknown[]) => void } }).logger
      if (gateway !== undefined) {
        // webServer 由宿主延迟提供,走 inject 子 fiber(brand 插件同款:无 Web 层形态
        // 子 fiber 永挂起而本插件本体照常活动,服务面不受影响)。
        ctx.inject(['webServer'], (inner) => {
          const webServer = inner.reflect.get('webServer', false) as ChannelsWebServerFace | undefined
          if (webServer === undefined) return
          disposers.push(webServer.register({
            kind: 'prefix',
            path: pathPrefix,
            handler: (req, res) => {
              // 500 兜底与 start() 自起 server 同款(webhook.ts createServer 回调):
              // 管线内异常物化为 JSON 错误应答,不让宿主进程裸抛
              gateway.handle(req, res).catch((error: unknown) => {
                if (!res.headersSent) {
                  res.writeHead(500, { 'content-type': 'application/json; charset=utf-8' })
                  res.end(JSON.stringify({ error: 'internal', detail: error instanceof Error ? error.message : String(error) }))
                } else {
                  res.destroy()
                }
              })
            },
          }))
          logger?.info?.(`[channels] webhook 网关已挂载:${pathPrefix}/webhook/:channelType(渠道密钥 ${Object.keys(config.secrets ?? {}).length} 个)`)
        })
      } else {
        logger?.info?.('[channels] sessionPort 未配置,webhook 网关未装配(绑定存储/令牌/卡片渲染照常可用)')
      }

      return () => {
        for (const dispose of disposers.reverse()) dispose()
        service.close()
        disposeService()
      }
    },
  }
}

// DSH bundle loader 取 default export 插件实例(对齐 governance-plugin.ts:164 形态;
// super 模板挂载行 name '@eterna/glue/channels-plugin' 即解析到本模块)
export default defineChannelsPlugin()
