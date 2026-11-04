/**
 * @basis/panel Host 半边:一个薄插件,把基座能力的只读快照经官方 Typert 网关
 * 暴露为 Remote 端点 basisPanel/snapshot(浏览器面板经 ctx.connection.rpc 调用)。
 *
 * 装载形态:profile bundle 的 cordis.patch.yml 插入行 `- id: basis-panel,
 * name: '@basis/panel'`(与 @basis/glue 同款 insert 语义);本包 package.json 声明
 * dsh.client(platform: web),宿主 client-modules 扫描把 lib/client.js 组进
 * window.__DSH_BOOT__ 浏览器花名册——同一行,两面(Host=本文件,Browser=src/client)。
 *
 * Remote 端点走网关 SRC 模式(无生成描述符的开发回退;api/gateway/src/index.ts
 * resolveSrcDescriptor 扫描 ctx.reflect.props 里带 typertRemote 绑定的服务)。
 * Node 24 type-stripping 不解析标准 decorator 语法,故经 Remote() 公开函数面
 * 手工施加装饰器(等价于 @Remote('snapshot') 糖)。
 */
import type { Context } from '@deepseek-ai/cordis'
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import { buildSnapshot } from './snapshot.ts'
import type { BasisPanelSnapshot } from './types.ts'

export const BASIS_PANEL_SERVICE_ID = 'basisPanel'
export const SNAPSHOT_ENDPOINT = `${BASIS_PANEL_SERVICE_ID}/snapshot`

/** 手工施加 @Remote 装饰器:以公开函数面调用(初始化器在接收者原型上落 marker)。 */
function applyRemoteMarker(prototype: object, method: string, name: string): void {
  const initializers: Array<() => void> = []
  const context = {
    kind: 'method',
    name: method,
    static: false,
    private: false,
    access: { has: () => true, get: (target: object) => Reflect.get(target, method) as unknown },
    addInitializer: (fn: () => void) => { initializers.push(fn) },
  }
  const decorator = Remote(name) as (method: unknown, context: unknown) => void
  decorator(Reflect.get(prototype, method) as unknown, context)
  const receiver = Object.create(prototype) as object
  for (const initialize of initializers) initialize.call(receiver)
}

/** 只读快照 Remote 服务(网关 SRC 端点 basisPanel/snapshot)。 */
export class BasisPanelGateway extends TypertRemoteService {
  constructor(ctx: Context) {
    super(ctx, BASIS_PANEL_SERVICE_ID)
  }

  /** 面板快照:见 types.ts BasisPanelSnapshot(纯 JSON,无参数端点)。 */
  snapshot(): Promise<BasisPanelSnapshot> {
    return Promise.resolve(buildSnapshot(this.ctx))
  }
}

applyRemoteMarker(BasisPanelGateway.prototype, 'snapshot', 'snapshot')

export type { BasisPanelSnapshot } from './types.ts'
export { buildSnapshot } from './snapshot.ts'
export { GUIDE_PROMPTS } from './prompts.ts'
export type { GuidePrompt } from './prompts.ts'

/** DSH bundle loader 取 default export 插件实例(对齐 glue 插件形态)。 */
export default {
  name: 'basis-panel',
  apply(ctx: Context): () => void {
    const gateway = new BasisPanelGateway(ctx)
    return () => {
      // Service 随 owning fiber 自动注销(cordis Service 语义);引用置空防误用。
      void gateway
    }
  },
}
