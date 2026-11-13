/**
 * @eterna/brand Host 半边:品牌面替换(服务端 + 模型侧两类,浏览器半边在 src/client)。
 *
 * 三类替换面(零上游改动):
 * 1. **服务端页面面**(本文件):`webServer.tapIndex` 在每次 index.html 渲染时
 *    改写 `<title>` 与 apple 短名;`/manifest.webmanifest` 由 fallback seat 的原
 *    静态服务返回上游原文,故以同路径 named route 接替(manifest 不经文档 DOM,
 *    客户端观察器永远看不到它)。
 * 2. **模型侧提示词面**(本文件):`system-prompt/assemble` 瀑布把上游固定身份句
 *    `You are an AI agent powered by DeepSeek Harness.`、运行时上下文
 *    `Current DSH file policy:` / `DeepSeek Harness implementation checkout` /
 *    `DeepSeek Harness Web GUI` 换成 EternaAgent。只替换文案,段名与顺序不动。
 * 3. **浏览器 DOM 面**(src/client):标题监听兜底、favicon 换装、侧栏 badge 覆写
 *    与残余鲸鱼置换。
 *
 * 装载 = 挂载集 insert 行 `- id: eterna-brand, name: '@eterna/brand'`(@eterna/panel
 * 同款双面配方;dsh.client 声明使 lib/client.js 进浏览器花名册)。
 *
 * 纪律(2026-11-13 用户要求「全局内容去 DeepSeek Harness」的执行边界):
 * 只改品牌文案。`$DSH_HOME`、`DSH_PROFILE_DIR`、`window.__DSH_BOOT__`、
 * `@deepseek-ai/dsh-*` 包名、`dsh` 命令名、`dsh web:` 就绪行都是运行时契约,
 * 改了就 boot 不起来/门禁正则失配——一律不动(index-html.ts 头注详述)。
 */
import { existsSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { rebrandIndexHtml, rebrandManifest, rebrandText } from './index-html.ts'

export { rebrandIndexHtml, rebrandManifest, rebrandText } from './index-html.ts'

export interface BrandPluginConfig {
  /** boot 后延迟(毫秒;默认 0,服务端注册无启动成本)。 */
  readonly initialDelayMs?: number
  /** 由上游静态前端在响应时接管的 manifest 路径(相对站点根)。 */
  readonly manifestPath?: string
}

/** 上游 assemble 瀑布事件名(dsh-system-prompt Events 契约)。 */
export const ASSEMBLE_EVENT = 'system-prompt/assemble'

/** 组装载荷里本插件改写的两个数组(段落/运行时上下文;工具声明不动)。 */
interface PromptPresentationLike {
  sections?: unknown[]
  contexts?: unknown[]
  variables?: unknown
}

/** 单段落/上下文的最小结构面(text 可变)。 */
interface TextEntryLike {
  name?: unknown
  text?: unknown
}

/** 本插件消费的 Web 载体 seam(webServer.register/tapIndex 的结构子集)。 */
export interface BrandWebServerFace {
  register(route: { kind: 'exact'; path: string; resource: (request: Request) => Promise<Response> }): () => void
  tapIndex(transform: (html: string) => string): () => void
}

/** 本插件消费的事件面(system-prompt/assemble waterfall)与服务注入面。 */
export interface BrandContextFace {
  /**
   * 官方 inject seam:子 fiber 等待 webServer 就绪(embed 档没有 Web 层,子 fiber
   * 永挂起而本插件本体照常活动——assemble 监听不受影响)。不能用静态 `inject`
   * 声明:inject 里非空配置一律计入就绪判定(cordis Fiber._refresh 遍历全部
   * inject 键),embed 档会把整个插件挂死在 pending。
   */
  inject(deps: readonly string[], callback: (ctx: BrandContextFace) => void): unknown
  /** 读宿主服务(供 inject 回调内取 webServer 引用)。 */
  get?(key: string): unknown
  /** 无 inject 要求的服务读取(cordis reflect 面;access 插件同款姿势)。 */
  readonly reflect?: { get(name: string, strict?: boolean): unknown }
  on(
    name: typeof ASSEMBLE_EVENT,
    listener: (assembly: unknown, context: unknown, next: () => Promise<unknown>) => Promise<unknown>,
  ): () => void
}

/**
 * 上游组装 -> 品牌文案的原地改写(assembled 段落/上下文两个数组)。
 *
 * 语义与 prompt-studio 的 assemble 监听同款:waterfall 串行,监听器改完再
 * 放行 `next()`;`AssembledSection.text` 可变,改写原样生效(spike 实证)。
 * 段名/顺序/工具声明一律不动(工具 provider 自治)。
 *
 * @param assembly - 上游 PromptPresentation(防御式结构访问)。
 * @returns 是否有段被改写(审计用)。
 */
export function rebrandAssembly(assembly: unknown): boolean {
  if (typeof assembly !== 'object' || assembly === null) return false
  const presentation = assembly as PromptPresentationLike
  let changed = false
  for (const group of [presentation.sections, presentation.contexts]) {
    if (!Array.isArray(group)) continue
    for (const entry of group) {
      if (typeof entry !== 'object' || entry === null) continue
      const item = entry as TextEntryLike
      if (typeof item.text !== 'string') continue
      const next = rebrandText(item.text)
      if (next === item.text) continue
      item.text = next
      changed = true
    }
  }
  return changed
}

/**
 * 解析 manifest 文件路径:优先算 dist 根下的 manifest。
 *
 * manifest 由 `@deepseek-ai/dsh-host-frontend-static` 以其 distRoot 直接服务
 * (非 index),故接替路由必须回同样字节 + 改写。dist 根经上游装配它的同一条
 * 解析链取得:`@deepseek-ai/dsh` → `@deepseek-ai/dsh-web-app` →
 * `@deepseek-ai/dsh-web-frontend`(web-app lib/index.js resolveDistIndex 就是这么
 * 解析的,故任何能 boot 起 web-app 的布局这条链都成立:仓库根 dev、profile 目录、
 * 容器 /repo 三处实证)。解析不到时该面自动缺席(manifest 保持上游原文,
 * 与现状等价,不阻断 boot)。
 *
 * @param manifestPath - 显式配置路径(测试/自定义部署用)。
 * @returns 绝对路径或 undefined。
 */
function resolveManifestFile(manifestPath: string | undefined): string | undefined {
  if (manifestPath !== undefined) return existsSync(manifestPath) ? manifestPath : undefined
  const roots = [process.cwd(), process.env.DSH_WEB_FRONTEND_ANCHOR, dirname(new URL(import.meta.url).pathname)]
  for (const root of roots) {
    if (root === undefined || root === '') continue
    try {
      const anchor = createRequire(join(root, 'package.json'))
      const dsh = anchor.resolve('@deepseek-ai/dsh/package.json')
      const webApp = createRequire(dsh).resolve('@deepseek-ai/dsh-web-app/package.json')
      const frontend = createRequire(webApp).resolve('@deepseek-ai/dsh-web-frontend/package.json')
      const candidate = join(dirname(frontend), 'dist', 'manifest.webmanifest')
      if (existsSync(candidate)) return candidate
    } catch {
      // 该根布局不适用:继续下一个
    }
  }
  return undefined
}

/** manifest named route:读原文 -> 品牌化 -> 回 JSON(带缓存头,与静态面口径一致)。 */
function createManifestResource(file: string): (request: Request) => Promise<Response> {
  // 路由契约要求返回 Promise(webServer resource 面签名),本实现纯同步读盘。
  return (request: Request): Promise<Response> => Promise.resolve(thenManifestResponse(file, request))
}

/** 同步响应构造(405/404/GET/HEAD 四态;与 createManifestResource 同契约)。 */
function thenManifestResponse(file: string, request: Request): Response {
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return new Response(null, { status: 405, headers: { allow: 'GET, HEAD' } })
  }
  let body: string
  try {
    body = readFileSync(file, 'utf8')
  } catch {
    return new Response(null, { status: 404 })
  }
  const rebranded = rebrandManifest(body)
  const headers = {
    'content-type': 'application/manifest+json',
    'cache-control': 'no-cache',
  }
  return request.method === 'HEAD'
    ? new Response(null, { status: 200, headers })
    : new Response(rebranded, { status: 200, headers })
}

/**
 * 插件工厂(bundle loader 取 default export 实例;apply 返回总 disposer)。
 *
 * @param config - 见 {@link BrandPluginConfig}。
 * @returns Cordis 插件对象。
 */
export function defineBrandPlugin(config: BrandPluginConfig = {}) {
  return {
    name: 'eterna-brand',
    apply(ctx: BrandContextFace): () => void {
      const disposers: Array<() => void> = []

      // ①+② 服务端页面面:index.html 经 tapIndex;manifest 由 fallback 的静态面
      //    原样返回,须以同路径 named route 接替(manifest 不进文档 DOM)。
      //    webServer 由宿主延迟提供,故走 inject 子 fiber——子 fiber 挂在无 Web 层的
      //    embed 档时本插件本体仍活动(assemble 面不受影响)。
      ctx.inject(['webServer'], (inner) => {
        const webServer = (inner.get?.('webServer') ?? inner.reflect?.get('webServer', false)) as BrandWebServerFace | undefined
        if (webServer === undefined) return
        disposers.push(webServer.tapIndex(html => rebrandIndexHtml(html)))
        const manifestFile = resolveManifestFile(config.manifestPath)
        if (manifestFile !== undefined) {
          disposers.push(webServer.register({
            kind: 'exact',
            path: '/manifest.webmanifest',
            resource: createManifestResource(manifestFile),
          }))
        }
      })

      // ③ 模型侧:固定身份句 + 运行时上下文三句(段名与顺序不动)。
      const offAssemble = ctx.on(ASSEMBLE_EVENT, async (assembly, _context, next) => {
        try {
          rebrandAssembly(assembly)
        } catch {
          // 改写失败绝不让组装失败(上游 assemble 抛错 = 该步模型调用直接失败)。
        }
        return next()
      })
      disposers.push(offAssemble)

      return () => {
        for (const dispose of disposers.reverse()) dispose()
      }
    },
  }
}

/** DSH bundle loader 取 default export 插件实例(对齐 panel/glue 插件形态)。 */
export default defineBrandPlugin()
