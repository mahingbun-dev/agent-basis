/**
 * @eterna/panel Host 半边:一个薄插件,把基座能力的只读快照经官方 Typert 网关
 * 暴露为 Remote 端点 eternaPanel/snapshot(浏览器面板经 ctx.connection.rpc 调用);
 * M-M2 T9 增裁决端点 eternaPanel/review(待审记忆批/拒,走 glue 注册的
 * @eterna/memory 服务——Memory.review 的软失效语义,本包不经 sqlite 写路径)。
 *
 * 装载形态:profile bundle 的 cordis.patch.yml 插入行 `- id: eterna-panel,
 * name: '@eterna/panel'`(与 @eterna/glue 同款 insert 语义);本包 package.json 声明
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
import type { EternaPanelSnapshot, MemoryReviewRecordView } from './types.ts'

export const ETERNA_PANEL_SERVICE_ID = 'eternaPanel'
export const SNAPSHOT_ENDPOINT = `${ETERNA_PANEL_SERVICE_ID}/snapshot`
export const REVIEW_ENDPOINT = `${ETERNA_PANEL_SERVICE_ID}/review`
export const CORRECTION_ENDPOINT = `${ETERNA_PANEL_SERVICE_ID}/trackCorrection`

/**
 * Memory 服务的注册 id(glue memory-plugin 经 ctx.provide 注册 '@eterna/memory',
 * 见 packages/memory/src/memory.ts MEMORY_SERVICE_ID;字面量对齐,panel 不引依赖)。
 */
const MEMORY_SERVICE_ID = '@eterna/memory'

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

/** Memory 服务的裁决消费面(结构子集;真实实例由 glue memory-plugin 提供)。 */
interface MemoryServiceLike {
  review(id: number, decision: 'approved' | 'rejected'): ReviewRecordLike | null
  /** T13 指标埋点:画像「纠正此项」留痕(账本 fail-open,不炸纠正动作)。 */
  recordCorrection?(entry: { readonly section: string; readonly keyHint: string }): void
}

/** EntityRecord 的裁决返回投影(结构子集;字段与 memory EntityRecord 对齐)。 */
interface ReviewRecordLike {
  readonly id: number
  readonly subject: string
  readonly key: string
  readonly reviewState: string
  readonly invalidAt: number | null
}

/** Access store 的角色读取面(compaction admin-plugin 同款结构子集)。 */
interface AccessStoreView {
  getUserById(id: number): { role?: string } | undefined
}

/** 裁决端点结果(纯 JSON;ok=false 时 code + 中文 message)。 */
export type MemoryReviewResult =
  | { readonly ok: true; readonly record: MemoryReviewRecordView | null }
  | { readonly ok: false; readonly code: 'forbidden' | 'unauthorized' | 'invalid' | 'unavailable'; readonly message: string }

/** 纠正留痕端点结果(纯 JSON;成功无载荷——客户端 fire-and-forget)。 */
export type MemoryCorrectionResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly code: 'invalid' | 'unavailable'; readonly message: string }

/** 只读快照 + 记忆裁决 Remote 服务(网关 SRC 端点 eternaPanel/*)。 */
export class EternaPanelGateway extends TypertRemoteService {
  constructor(ctx: Context) {
    super(ctx, ETERNA_PANEL_SERVICE_ID)
  }

  /** 面板快照:见 types.ts EternaPanelSnapshot(纯 JSON,无参数端点)。 */
  snapshot(): Promise<EternaPanelSnapshot> {
    return Promise.resolve(buildSnapshot(this.ctx))
  }

  /**
   * 记忆裁决(T9 审批闭环):payload { id, decision } → Memory.review。
   * - 鉴权(compaction admin-plugin 同款口径):SRC 端点走 unary 持 owner
   *   Peer——mux 换血的 eterna-user principal 只存在于流通道,unary 能达本端点
   *   必已过 access 守卫;eterna-user principal(流通道)则查 access store
   *   必须是 admin。审批决定 Agent 记什么,与压缩配置同级的租户敏感面。
   * - 服务缺席(eterna-memory 停用/未挂)= unavailable;行不存在(已处理/
   *   越界 id)返回 record: null——裁决语义(幂等,不猜行状态)。
   */
  review(payload: unknown): Promise<MemoryReviewResult> {
    return Promise.resolve(this.reviewSync(payload))
  }

  /**
   * 画像纠正留痕(T13 纠正率分子):payload { section, keyHint? } →
   * Memory.recordCorrection(审计一行,账本 fail-open)。用户级动作(纠正自己的
   * 画像),非 admin 面——SRC unary 持 owner peer,能达本端点必已过 access 守卫;
   * 客户端 fire-and-forget,埋点失败不打断纠正预填主流程。
   */
  trackCorrection(payload: unknown): Promise<MemoryCorrectionResult> {
    if (typeof payload !== 'object' || payload === null) {
      return Promise.resolve({ ok: false, code: 'invalid', message: '请求体必须是对象' })
    }
    const input = payload as Record<string, unknown>
    const { section, keyHint } = input
    if (typeof section !== 'string' || section.trim().length === 0 || section.trim().length > 64) {
      return Promise.resolve({ ok: false, code: 'invalid', message: 'section 必填(非空,≤64 字符)' })
    }
    if (keyHint !== undefined && typeof keyHint !== 'string') {
      return Promise.resolve({ ok: false, code: 'invalid', message: 'keyHint 只允许字符串' })
    }
    const memory = this.ctx.get(MEMORY_SERVICE_ID) as MemoryServiceLike | undefined
    if (memory?.recordCorrection === undefined) {
      return Promise.resolve({ ok: false, code: 'unavailable', message: '记忆服务未挂载(eterna-memory 插件未启用)' })
    }
    try {
      memory.recordCorrection({ section: section.trim(), keyHint: typeof keyHint === 'string' ? keyHint.slice(0, 128) : '' })
      return Promise.resolve({ ok: true })
    } catch (error) {
      return Promise.resolve({
        ok: false,
        code: 'unavailable',
        message: `留痕失败:${error instanceof Error ? error.message : String(error)}`,
      })
    }
  }

  /** 同步裁决体(测试可绕 Promise 直接消费;私有 TS 方法,# 品牌检查会挡 Object.create 假体)。 */
  private reviewSync(payload: unknown): MemoryReviewResult {
    if (!this.adminAllowed()) {
      return { ok: false, code: 'forbidden', message: '需要管理员权限' }
    }
    if (typeof payload !== 'object' || payload === null) {
      return { ok: false, code: 'invalid', message: '请求体必须是对象' }
    }
    const input = payload as Record<string, unknown>
    const { id, decision } = input
    if (typeof id !== 'number' || !Number.isSafeInteger(id) || id < 0) {
      return { ok: false, code: 'invalid', message: 'id 必须是非负安全整数' }
    }
    if (decision !== 'approved' && decision !== 'rejected') {
      return { ok: false, code: 'invalid', message: "decision 只允许 'approved' | 'rejected'" }
    }
    const memory = this.ctx.get(MEMORY_SERVICE_ID) as MemoryServiceLike | undefined
    if (memory?.review === undefined) {
      return { ok: false, code: 'unavailable', message: '记忆服务未挂载(eterna-memory 插件未启用)' }
    }
    try {
      const record = memory.review(id, decision)
      return {
        ok: true,
        record: record === null ? null : {
          id: record.id,
          subject: record.subject,
          key: record.key,
          reviewState: record.reviewState,
          invalidAt: record.invalidAt,
        },
      }
    } catch (error) {
      return {
        ok: false,
        code: 'unavailable',
        message: `裁决执行失败:${error instanceof Error ? error.message : String(error)}`,
      }
    }
  }

  /** 管理面放行判定(compaction admin-plugin adminAllowed 同款;eterna-user 流通道须 admin)。 */
  private adminAllowed(): boolean {
    const invocation = (this.ctx as { invocation?: { principal?: { kind?: string; userId?: number } } } | undefined)?.invocation
    const principal = invocation?.principal
    if (principal === undefined || principal.kind !== 'eterna-user' || typeof principal.userId !== 'number') return true
    const reflect = this.ctx as unknown as { reflect?: { get(name: string, strict?: boolean): unknown } }
    const store = reflect.reflect?.get('eternaAccessStore', false) as AccessStoreView | undefined
    return store?.getUserById(principal.userId)?.role === 'admin'
  }
}

applyRemoteMarker(EternaPanelGateway.prototype, 'snapshot', 'snapshot')
applyRemoteMarker(EternaPanelGateway.prototype, 'review', 'review')
applyRemoteMarker(EternaPanelGateway.prototype, 'trackCorrection', 'trackCorrection')

export type { EternaPanelSnapshot, MemoryReviewRecordView } from './types.ts'
export { buildSnapshot } from './snapshot.ts'
export { GUIDE_PROMPTS } from './prompts.ts'
export type { GuidePrompt } from './prompts.ts'

/** DSH bundle loader 取 default export 插件实例(对齐 glue 插件形态)。 */
export default {
  name: 'eterna-panel',
  apply(ctx: Context): () => void {
    const gateway = new EternaPanelGateway(ctx)
    return () => {
      // Service 随 owning fiber 自动注销(cordis Service 语义);引用置空防误用。
      void gateway
    }
  },
}
