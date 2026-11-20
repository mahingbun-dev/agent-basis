/**
 * channels webhook 公共面契约钉住(T24/B12 收口;54 §4.6、50 §9.1、51 ACC-001)。
 *
 * 收口前 glue 的 channels-plugin 自注册 prefix 路由,webhook 与审批令牌两条端点族
 * 都由插件持有(tenant-scan 基线记 2 条 `/channels/api`);收口后两条端点族统一由
 * access 的**单条** prefix 登记接住(数据面仍是 WebhookGateway.handle,
 * 见 channels-webhook.ts:46-77)。
 *
 * channels-webhook.spec.ts 已钉住登记契约/转发/503/500 四态;本 spec 补四件它覆盖
 * 不到、且会静默漂移的事:
 * 1. 只登记一条路由——收口后任何一侧再补第二条自注册即红;
 * 2. webhook(`/webhook/:channelType`)与 approval(`/approval/:token`)两个端点族
 *    都被这条 prefix 命中并原样转发给同一网关(收口不能只收一半);
 * 3. access 前缀字面量与 glue channels-plugin 缺省值同源——两处字面量漂移即宿主
 *    路由 404(契约见 channels-webhook.ts:8-11 头注:「字面量漂移即 404」);
 * 4. glue 侧零 `webServer.register(` 且 access plugin.ts 的接线调用恰好一次——
 *    收口是「路由面登记在 access、数据面在 glue」,任何一侧回潮(插件重新自注册,
 *    或 access 忘了接线只留孤立模块)都红。
 */
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { CHANNELS_WEBHOOK_PATH_PREFIX, registerChannelsWebhook } from '../src/channels-webhook.ts'

interface RegisteredRoute {
  readonly kind: 'exact' | 'prefix'
  readonly path: string
  readonly handler: (req: unknown, res: unknown) => void | Promise<void>
}

class FakeWebServer {
  readonly routes: RegisteredRoute[] = []
  register(route: RegisteredRoute): () => void {
    this.routes.push(route)
    return () => {
      const index = this.routes.indexOf(route)
      if (index >= 0) this.routes.splice(index, 1)
    }
  }
}

/**
 * 宿主 webServer 的 prefix 匹配语义镜像(pathname 以 route.path 开头即命中,
 * 先登记先匹配——见 glue tests channels-plugin.spec.ts listenRoutes 同款镜像)。
 */
function dispatch(webServer: FakeWebServer, pathname: string, req: unknown, res: unknown): boolean {
  const route = webServer.routes.find(candidate => candidate.kind === 'prefix' && pathname.startsWith(candidate.path))
  if (route === undefined) return false
  void route.handler(req, res)
  return true
}

/** glue channels-plugin 源文件(前缀字面量的另一侧;包目录不在场时跳过漂移核验)。 */
const GLUE_CHANNELS_PLUGIN = join(import.meta.dirname, '..', '..', 'glue', 'src', 'plugins', 'channels-plugin.ts')
/** access 装配位(登记接线点;不在场时跳过接线核验)。 */
const ACCESS_PLUGIN = join(import.meta.dirname, '..', 'src', 'plugin.ts')

/** 剥注释(行注释 + 块注释,含 JSDoc):静态断言只看代码,注释里的字样不参与。 */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')
}

describe('channels webhook 公共面收口(T24/B12):两条端点族并一条 access 登记', () => {
  it('单条 prefix 登记同时接住 webhook 与 approval,且只作用于 /channels/api 命名空间', async () => {
    const webServer = new FakeWebServer()
    const handle = vi.fn().mockResolvedValue(undefined)
    registerChannelsWebhook(webServer, { get: () => ({ gateway: { handle } }) })

    // 收口 = 两条端点族由同一登记接住,而不是各登记一次
    expect(webServer.routes).toHaveLength(1)

    const paths = [
      '/channels/api/webhook/feishu',
      '/channels/api/webhook/dingtalk',
      '/channels/api/approval/token_AbC-123',
    ]
    for (const [index, pathname] of paths.entries()) {
      const req = { method: 'POST', url: pathname }
      const res = {}
      expect(dispatch(webServer, pathname, req, res)).toBe(true)
      expect(handle).toHaveBeenCalledTimes(index + 1)
      expect(handle).toHaveBeenLastCalledWith(req, res)
    }

    // 不在前缀命名空间内的请求不由本登记接住(不是 catch-all)
    expect(dispatch(webServer, '/access/api/webhook/feishu', {}, {})).toBe(false)
    expect(handle).toHaveBeenCalledTimes(paths.length)
  })

  it.skipIf(!existsSync(GLUE_CHANNELS_PLUGIN))(
    'access 前缀字面量与 glue channels-plugin 缺省值同源(漂移即宿主 404)',
    () => {
      const source = readFileSync(GLUE_CHANNELS_PLUGIN, 'utf8')
      const match = /export const CHANNELS_WEBHOOK_PATH_PREFIX = '([^']*)'/.exec(source)
      expect(match, 'glue channels-plugin 必须保留 CHANNELS_WEBHOOK_PATH_PREFIX 字面量导出').not.toBeNull()
      expect(match?.[1]).toBe(CHANNELS_WEBHOOK_PATH_PREFIX)
    },
  )

  it.skipIf(!existsSync(GLUE_CHANNELS_PLUGIN) || !existsSync(ACCESS_PLUGIN))(
    'T2 回潮门:glue 侧零自注册;access 侧接线恰好一次(插件改回自注册或漏接线即红)',
    () => {
      // 数据面经插件 provide、路由面经 access 登记(24a 裁决口径)才是收口形态:
      // glue 侧任何 webServer.register( 调用 = 回潮
      const glueSource = stripComments(readFileSync(GLUE_CHANNELS_PLUGIN, 'utf8'))
      expect(glueSource, 'glue channels-plugin 不得再持有任何 webServer.register 调用').not.toContain('webServer.register(')

      // access 侧必须真的接线(孤立模块不算收口):恰好一次调用,且入参是宿主 webServer + reflect
      const accessSource = stripComments(readFileSync(ACCESS_PLUGIN, 'utf8'))
      const wiring = accessSource.match(/registerChannelsWebhook\s*\(/g) ?? []
      expect(wiring, 'access plugin.ts 必须恰好接线一次 registerChannelsWebhook(...)').toHaveLength(1)
      expect(accessSource).toContain('registerChannelsWebhook(ctx.webServer, ctx.reflect)')
    },
  )
})
