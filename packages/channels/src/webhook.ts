/**
 * webhook 入站网关(极简 http server 模块):验签 → 投递到绑定的 session 接口。
 *
 * 12 号文档 §7.4(acp/api 原生可编程触发,本模块是薄网关)+ §7.7(邮箱审批
 * 一次性令牌)。两条路由:
 *
 * - `POST {prefix}/webhook/:channelType`(IM/平台回调,如飞书/钉钉/企微):
 *   HMAC-SHA256(raw body, channel secret) 验签(timing-safe)→ 解析信封
 *   (message 投递到绑定会话 / approval_click 消费一次性令牌后回传审批应答)。
 * - `GET|POST {prefix}/approval/:token`(邮件链接点击):token 本身即凭证
 *   (32 字节 CSPRNG),单次有效; redeemed 后一律 410 Gone。
 *
 * Cordis 纪律:start() 返回 handle,handle.close() 为 start 的配逆闭包
 * (server.closeAllConnections + close),无逃逸副作用。
 */
import { createHmac, timingSafeEqual } from 'node:crypto'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import type { ChannelBindingStore } from './binding.ts'
import type { ApprovalTokenService } from './token.ts'
import type { SessionPort } from './types.ts'

/** 单渠道验签配置;header/scheme 缺省 `x-dsh-signature` / `sha256=`。 */
export interface WebhookChannelSecret {
  readonly secret: string
  readonly header?: string
  readonly scheme?: string
}

export type WebhookSecretTable = Readonly<Record<string, WebhookChannelSecret>>

export interface WebhookGatewayOptions {
  readonly bindings: ChannelBindingStore
  readonly sessionPort: SessionPort
  /** approval_click 信封与 /approval/:token 路由必需。 */
  readonly tokens?: ApprovalTokenService
  readonly secrets: WebhookSecretTable
  readonly host?: string
  readonly port?: number
  readonly pathPrefix?: string
  /** 默认 1 MiB;超出 413。 */
  readonly maxBodyBytes?: number
}

export interface WebhookGatewayHandle {
  readonly url: URL
  /** start() 的配逆:停 server 并断开所有连接。 */
  close(): Promise<void>
}

/** webhook 信封:普通消息或审批按钮回点(IM 卡片按钮经平台回调转发)。 */
export type WebhookEnvelope =
  | {
    readonly type: 'message'
    readonly channelUserId: string
    readonly text: string
    readonly messageId?: string
  }
  | {
    readonly type: 'approval_click'
    readonly token: string
    /** 点击者渠道身份(可选,审计归因用)。 */
    readonly channelUserId?: string
  }

export class WebhookGateway {
  private readonly options: WebhookGatewayOptions
  private readonly maxBodyBytes: number
  private readonly pathPrefix: string
  private server: Server | undefined

  constructor(options: WebhookGatewayOptions) {
    this.options = options
    this.maxBodyBytes = options.maxBodyBytes ?? 1024 * 1024
    const prefix = options.pathPrefix ?? ''
    this.pathPrefix = prefix.endsWith('/') ? prefix.slice(0, -1) : prefix
  }

  /** HMAC-SHA256 验签(timing-safe 比对;长度不等直接否决)。 */
  verifySignature(channelType: string, rawBody: Buffer, headerValue: string | undefined): boolean {
    const config = this.options.secrets[channelType]
    if (config === undefined || headerValue === undefined) return false
    if (headerValue.length === 0) return false
    const scheme = config.scheme ?? 'sha256='
    const providedHex = headerValue.toLowerCase().startsWith(scheme)
      ? headerValue.slice(scheme.length)
      : headerValue
    const expected = createHmac('sha256', config.secret).update(rawBody).digest()
    const provided = Buffer.from(providedHex, 'hex')
    if (provided.length !== expected.length || !/^[0-9a-f]+$/i.test(providedHex)) return false
    return timingSafeEqual(provided, expected)
  }

  /** 返回本网关对某 raw body 的期望签名(测试/运维对拍用)。 */
  sign(channelType: string, rawBody: Buffer): string {
    const config = this.options.secrets[channelType]
    if (config === undefined) throw new Error(`[channels] 未配置渠道密钥: ${channelType}`)
    const scheme = config.scheme ?? 'sha256='
    return scheme + createHmac('sha256', config.secret).update(rawBody).digest('hex')
  }

  /** 启动 http server;返回 url 与配逆 close。 */
  async start(): Promise<WebhookGatewayHandle> {
    const server = createServer((req, res) => {
      this.handle(req, res).catch((error: unknown) => {
        this.respond(res, 500, { error: 'internal' }, error instanceof Error ? error.message : String(error))
      })
    })
    this.server = server
    const host = this.options.host ?? '127.0.0.1'
    const port = this.options.port ?? 0
    await new Promise<void>((resolve, reject) => {
      const onError = (error: Error): void => {
        reject(error)
      }
      server.once('error', onError)
      server.listen(port, host, () => {
        server.off('error', onError)
        resolve()
      })
    })
    const address = server.address()
    if (address === null || typeof address === 'string') {
      throw new Error('[channels] 无法获取监听地址')
    }
    const url = new URL(`http://${host}:${address.port}${this.pathPrefix}`)
    return {
      url,
      close: async (): Promise<void> => {
        await new Promise<void>((resolve, reject) => {
          server.closeAllConnections()
          server.close((error: Error | undefined) => {
            if (error !== undefined && error.message !== 'Server is not running') reject(error)
            else resolve()
          })
        })
      },
    }
  }

  /** 供测试直连的当前 server(未启动时 false)。 */
  get listening(): boolean {
    return this.server?.listening ?? false
  }

  private async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? '/', 'http://gateway.local')
    const path = url.pathname

    const approvalMatch = /^\/approval\/([A-Za-z0-9_-]+)$/.exec(path.slice(this.pathPrefix.length))
    if (approvalMatch !== null) {
      if (req.method !== 'GET' && req.method !== 'POST') {
        this.respond(res, 405, { error: 'method-not-allowed' })
        return
      }
      const token = approvalMatch[1] ?? ''
      await this.handleApprovalToken(token, res)
      return
    }

    const webhookMatch = /^\/webhook\/([a-z0-9_-]+)$/.exec(path.slice(this.pathPrefix.length))
    if (webhookMatch !== null) {
      const channelType = webhookMatch[1] ?? ''
      if (req.method !== 'POST') {
        this.respond(res, 405, { error: 'method-not-allowed' })
        return
      }
      await this.handleWebhook(channelType, req, res)
      return
    }

    this.respond(res, 404, { error: 'not-found' })
  }

  private async handleWebhook(channelType: string, req: IncomingMessage, res: ServerResponse): Promise<void> {
    if (this.options.secrets[channelType] === undefined) {
      this.respond(res, 404, { error: 'unknown-channel' })
      return
    }
    const raw = await this.readBody(req, res)
    if (raw === undefined) return // readBody 已应答(413/400)

    const headerName = this.options.secrets[channelType].header ?? 'x-dsh-signature'
    const headerValue = req.headers[headerName]
    const signature = Array.isArray(headerValue) ? headerValue[0] : headerValue
    if (!this.verifySignature(channelType, raw, signature)) {
      this.respond(res, 401, { error: 'invalid-signature' })
      return
    }

    let envelope: WebhookEnvelope
    try {
      envelope = this.parseEnvelope(raw)
    } catch (error: unknown) {
      this.respond(res, 400, { error: 'bad-envelope' }, error instanceof Error ? error.message : undefined)
      return
    }

    if (envelope.type === 'approval_click') {
      const redemption = this.redeemToken(envelope.token)
      if (!redemption.ok) {
        this.respond(res, 410, { error: redemption.reason })
        return
      }
      await this.options.sessionPort.answerApproval({
        approvalRequestId: redemption.approvalRequestId,
        sessionId: redemption.sessionId,
        decision: redemption.decision,
        via: this.channelTypeOf(channelType),
      })
      this.respond(res, 202, { accepted: true, approvalRequestId: redemption.approvalRequestId })
      return
    }

    const sessionId = this.options.bindings.resolveSession(channelType, envelope.channelUserId)
    if (sessionId === undefined) {
      this.respond(res, 404, { error: 'unknown-binding' })
      return
    }
    await this.options.sessionPort.deliverInbound({
      channelType: this.channelTypeOf(channelType),
      channelUserId: envelope.channelUserId,
      sessionId,
      text: envelope.text,
      ...(envelope.messageId !== undefined && { messageId: envelope.messageId }),
      occurredAt: new Date().toISOString(),
    })
    this.respond(res, 202, { accepted: true, sessionId })
  }

  private async handleApprovalToken(token: string, res: ServerResponse): Promise<void> {
    const redemption = this.redeemToken(token)
    if (!redemption.ok) {
      const status = redemption.reason === 'unknown-token' ? 404 : 410
      this.respond(res, status, { error: redemption.reason })
      return
    }
    await this.options.sessionPort.answerApproval({
      approvalRequestId: redemption.approvalRequestId,
      sessionId: redemption.sessionId,
      decision: redemption.decision,
      via: 'email',
    })
    this.respond(res, 202, { accepted: true, approvalRequestId: redemption.approvalRequestId })
  }

  private redeemToken(token: string):
    | { ok: true; approvalRequestId: string; sessionId: string; decision: 'approve' | 'reject' }
    | { ok: false; reason: 'unknown-token' | 'expired' | 'already-used' | 'no-token-service' } {
    const tokens = this.options.tokens
    if (tokens === undefined) return { ok: false, reason: 'no-token-service' }
    return tokens.redeem(token)
  }

  private channelTypeOf(channelType: string): 'email' | 'wechat' | 'wecom' | 'feishu' | 'dingtalk' | 'webhook' {
    switch (channelType) {
      case 'email': case 'wechat': case 'wecom': case 'feishu': case 'dingtalk': return channelType
      default: return 'webhook'
    }
  }

  private parseEnvelope(raw: Buffer): WebhookEnvelope {
    let parsed: unknown
    try {
      parsed = JSON.parse(raw.toString('utf8')) as unknown
    } catch {
      throw new Error('body 不是合法 JSON')
    }
    if (typeof parsed !== 'object' || parsed === null) throw new Error('信封必须是对象')
    const envelope = parsed as Record<string, unknown>
    if (envelope.type === 'message') {
      if (typeof envelope.channelUserId !== 'string' || envelope.channelUserId.length === 0) {
        throw new Error('message 信封缺 channelUserId')
      }
      if (typeof envelope.text !== 'string') throw new Error('message 信封缺 text')
      const messageId = envelope.messageId
      return {
        type: 'message',
        channelUserId: envelope.channelUserId,
        text: envelope.text,
        ...(typeof messageId === 'string' && messageId.length > 0 && { messageId }),
      }
    }
    if (envelope.type === 'approval_click') {
      if (typeof envelope.token !== 'string' || envelope.token.length === 0) {
        throw new Error('approval_click 信封缺 token')
      }
      return { type: 'approval_click', token: envelope.token }
    }
    throw new Error('未知信封 type')
  }

  private async readBody(req: IncomingMessage, res: ServerResponse): Promise<Buffer | undefined> {
    const chunks: Buffer[] = []
    let total = 0
    for await (const chunk of req) {
      const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Buffer)
      total += buf.length
      if (total > this.maxBodyBytes) {
        this.respond(res, 413, { error: 'payload-too-large' })
        return undefined
      }
      chunks.push(buf)
    }
    return Buffer.concat(chunks)
  }

  private respond(res: ServerResponse, status: number, body: Record<string, unknown>, detail?: string): void {
    const payload = detail === undefined ? body : { ...body, detail }
    res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' })
    res.end(JSON.stringify(payload))
  }
}
