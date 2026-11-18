/**
 * 工作台实时流桥(38 号 O-5/G2-C4 的 access 侧落位;33 号 G2-D6「新数据端点为 0——
 * 路由面独占」;铁律 T2 docs/PLUGIN-AUTHORING §1.1-2:workbench/tasks 不得自注册,
 * access 是唯一合法的路由注册方,tenant-scan tenant/route-escapes-gate CI 强制)。
 *
 * 口径(24a 裁决 dwfq-843ec077-1 同源):**数据面经 tasks 提供、路由经 access 登记**
 * ——载荷 = tasks 引擎 DomainEvents 经 eterna-workbench live hub 投影的 SSE 帧
 * (快照+增量,200ms 合批,Last-Event-ID 续传,30 号 §3);本桥零领域语义(不 import
 * 任何 Tier2 包,服务经反射键结构解析,panel/tenant 守卫 serviceOf 同款),只做:
 * 登录会话守卫(cookie→pwv→用户,与 routes.ts/tenant.ts 同一身份面)→ SSE 响应头
 * 装载(AGENTS.md 交互纪律:no-store)→ 首帧(续传或全量快照)→ 增量转发与保活。
 */
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { AccessAuditEvent } from './audit.ts'
import type { SessionService } from './session.ts'
import type { UserStore } from './store.ts'
import { WORKBENCH_STREAM_ENDPOINT } from './tenant.ts'

/** 服务反射面(tenant.ts AuditReflect 同款结构子集;缺席返回 undefined)。 */
export interface StreamReflect {
  get(name: string, strict?: boolean): unknown
}

/**
 * eterna-workbench live hub 的反射键(消费侧字面量对齐——panel 不引依赖同款纪律,
 * 唯一事实源 = packages/workbench/src/stream/live-hub.ts WORKBENCH_STREAM_SERVICE_ID)。
 */
export const WORKBENCH_STREAM_SERVICE_KEY = 'eternaWorkbenchStream'

/**
 * live hub 消费面(结构子集;真实实例由 eterna-workbench bundle provide):
 * 时序契约(先 subscribe 后 snapshotFrame/replayFrames,模块注)由调用方遵守。
 */
export interface PluginStreamHub {
  /** 数据源(tasks 服务)是否就绪;false 时端点 fail-closed 回 503。 */
  ready(): boolean
  /** 首帧:当前全量快照(SSE 帧文本,id=event seq)。 */
  snapshotFrame(): string
  /** 断线续传:有缺口 undefined(改推快照),否则补发 id 更大的帧(可为空数组)。 */
  replayFrames(lastEventId: number): readonly string[] | undefined
  /** 订阅后续增量帧(200ms 合批后逐帧回调);返回退订闭包。 */
  subscribe(onFrame: (frame: string) => void): () => void
}

export interface StreamBridgeDeps {
  readonly store: UserStore
  readonly session: SessionService
  readonly reflect: StreamReflect
  audit(event: AccessAuditEvent): void
}

/** 会话 → 用户(routes.ts currentUser 同一身份面:cookie→pwv 比对→用户)。 */
function currentUser(deps: StreamBridgeDeps, req: IncomingMessage): { readonly id: number; readonly account: string } | undefined {
  const claims = deps.session.resolveUser(req.headers.cookie)
  if (claims === undefined) return undefined
  const pwv = deps.store.getPasswordVersion(claims.userId)
  if (pwv === undefined || pwv !== claims.passwordVersion) return undefined
  const user = deps.store.getUserById(claims.userId)
  if (user === undefined) return undefined
  return { id: user.id, account: user.account }
}

/** JSON 错误应答(中文文案,AGENTS.md「UI 面向用户文字一律中文」)。 */
function errorJson(res: ServerResponse, status: number, message: string): void {
  res.statusCode = status
  res.setHeader('content-type', 'application/json; charset=utf-8')
  res.setHeader('cache-control', 'no-store')
  res.end(JSON.stringify({ error: message }))
}

/** 保活注释行间隔(30 号 §3;dev fixture 同量 15s;传输层卫生,非指标心跳——O-7 不发明)。 */
const KEEP_ALIVE_MS = 15_000

/**
 * 创建工作台实时流处理器(GET /workbench/api/stream;由 access 插件经
 * webServer.register 精确路径登记——本文件不直接持有注册面,登记点在 plugin.ts)。
 *
 * 守卫与降级:未登录/会话失效 401;hub 服务缺席或未就绪 503(fail-closed——
 * 装配竞态与插件停用下不给假流);非 GET 405。
 */
export function createStreamBridgeHandler(deps: StreamBridgeDeps): (req: IncomingMessage, res: ServerResponse) => void {
  return (req, res) => {
    try {
      const method = (req.method ?? 'GET').toUpperCase()
      if (method !== 'GET') {
        errorJson(res, 405, '仅支持 GET')
        return
      }
      const user = currentUser(deps, req)
      if (user === undefined) {
        errorJson(res, 401, '未登录')
        return
      }
      // 反射服务收敛(fail-closed):缺席/形态不符/未就绪一律 503,不给假流
      const raw = deps.reflect.get(WORKBENCH_STREAM_SERVICE_KEY, false)
      const hub = raw !== undefined && raw !== null && typeof (raw as Partial<PluginStreamHub>).ready === 'function'
        ? raw as PluginStreamHub
        : undefined
      if (hub === undefined || !hub.ready()) {
        errorJson(res, 503, '工作台实时流未就绪')
        return
      }

      // 断线续传:Last-Event-ID 请求头优先,查询参数兜底(dev fixture 同款;30 号 §3)
      const url = new URL(req.url ?? '/', 'http://local')
      const headerId = req.headers['last-event-id']
      const queryId = url.searchParams.get('lastEventId')
      const parsedId = queryId ?? (Array.isArray(headerId) ? headerId[0] : headerId)
      const lastEventId = parsedId !== undefined && parsedId !== '' && Number.isFinite(Number(parsedId))
        ? Number(parsedId)
        : undefined

      res.writeHead(200, {
        'content-type': 'text/event-stream; charset=utf-8',
        // no-store:AGENTS.md 交互纪律「HTML 响应 no-store」的流面同款——连接态响应不进任何缓存
        'cache-control': 'no-store, no-cache, no-transform',
        connection: 'keep-alive',
        'x-accel-buffering': 'no',
      })
      res.flushHeaders()

      // 时序契约(live-hub 模块注):先订阅(合批窗接住后续增量),再写首帧——
      // 两步之间无 await,事件不丢;快照 seq 晚于载荷时客户端按 seq 去重(F-14)。
      const unsubscribe = hub.subscribe((frame) => {
        if (!res.writableEnded) res.write(frame)
      })
      const replay = lastEventId !== undefined ? hub.replayFrames(lastEventId) : undefined
      const frames = replay ?? [hub.snapshotFrame()]
      for (const frame of frames) {
        if (res.writableEnded) break
        res.write(frame)
      }
      const keepAlive = setInterval(() => {
        if (!res.writableEnded) res.write(': keep-alive\n\n')
      }, KEEP_ALIVE_MS)
      req.on('close', () => {
        clearInterval(keepAlive)
        unsubscribe()
        if (!res.writableEnded) res.end()
      })
    } catch (error) {
      // 未预期异常显式落容器日志(R7 可观测性;access handler 同款纪律)
      console.error(`[eterna-access] ${WORKBENCH_STREAM_ENDPOINT} bridge error:`, error)
      if (!res.headersSent) {
        errorJson(res, 500, 'internal error')
        return
      }
      res.destroy()
    }
  }
}
