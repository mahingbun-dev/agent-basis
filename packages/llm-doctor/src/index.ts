/**
 * @eterna/llm-doctor Host 半边:LLM 承载行(llm-pi-ai)的体检哨兵——
 * ①协议↔baseURL 自动适配:监听 `loader/volatile-update`,对每条 provider 路由
 *   做端点路径探测(GET,404=不存在/其余=存在,零凭据零模型调用,src/doctor.ts),
 *   当前路径 404 且候选路径存在时经官方 configEditor 改写 baseURL 并写回 patch
 *   (Loader 热生效,设置页经 settings/document-updated 推送自动刷新显示修正值);
 * ②逐模型连通性测试:SRC 端点 llmDoctor/probe 按协议真发一次极小补全(与 agent
 *   会话同 wire 路径),返回延迟与回复预览/错误原文。
 *
 * 触发时机:boot 后延迟首检(不拖启动)+ 每次 volatile-update 防抖复检;改写本身
 * 触发的后续 volatile-update 复检时当前路径已存在 → 无动作,天然幂等(另有
 * in-flight 守卫)。
 *
 * 装载形态:@eterna/panel 同款——package.json 声明 dsh.client(platform: web),
 * 同一 Loader 行两面(Host 半边 exports '.',浏览器半边 './client');挂载行
 * `- id: eterna-llm-doctor, name: '@eterna/llm-doctor'`(insert 语义)。
 *
 * 网关纪律(对齐 packages/prompt-studio/src/index.ts 文件头):TypertRemoteService
 * 基类构造即向 ctx 注册服务(SRC 扫描 reflect.props 里带 typertRemote 绑定的服务,
 * 无需显式 provide);SRC 参数绑定按运行时形参名,端点方法一律单参数 `input`;
 * 类状态全公开(#private 在网关 receiver shadow 上读取即抛)。
 */
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import {
  normalizeConfig, pingModel,
  type AutoFixRecord, type FetchLike, type PingResult, type ProviderRouteConfig, type RouteHealth,
} from './doctor.ts'

/** Typert 服务名(RPC namespace)。 */
export const LLM_DOCTOR_SERVICE_ID = 'llmDoctor'

/** 看护的承载行 id(pi-ai 命名空间,客户端 layoutOf 按 entry id 匹配)。 */
export const PI_AI_ENTRY_ID = 'llm-pi-ai'

/** 全部端点字符串(客户端照此调用)。 */
export const ENDPOINTS = {
  health: `${LLM_DOCTOR_SERVICE_ID}/health`,
  probe: `${LLM_DOCTOR_SERVICE_ID}/probe`,
} as const

/** configEditor 消费面(结构子集;测试注入同构假体)。 */
export interface ConfigEditorFace {
  entries(): { options: { id: string } }[]
  configuration(): unknown
  edit(
    entry: { options: { id: string } },
    change: (current: Record<string, unknown>, inherited: Record<string, unknown>) => Record<string, unknown>,
  ): Promise<void>
}

/** 插件上下文消费面(结构子集;服务经 cordis get 解析)。 */
export interface DoctorContextLike {
  get(name: string): unknown
  on(event: string, listener: () => void, options?: { global?: boolean }): () => void
}

/** 单路由快照(health 返回;含模型目录供 UI 渲染测试行)。 */
export interface DoctorRouteSnapshot {
  readonly provider: string
  readonly displayName: string | undefined
  readonly api: string | undefined
  readonly baseURL: string | undefined
  readonly models: readonly string[]
}

/** health 端点返回(全公开字段,网关 shadow 纪律)。 */
export interface DoctorHealthReport {
  readonly watchedEntryId: string
  readonly checkedAt: string
  readonly health: readonly RouteHealth[]
  /** 承载行路由快照(provider→模型目录),供 UI 渲染逐模型测试行。 */
  readonly routes: readonly DoctorRouteSnapshot[]
  /** 本进程内已发生的自动适配(最近一次写回)。 */
  readonly lastAutoFix: readonly AutoFixRecord[]
  /** 最近一次体检/写回的错误(如有)。 */
  readonly lastError: string | undefined
}

/** probe 端点入参。 */
export interface ProbeInput {
  /** provider 路由 key(config.providers 的键,如 litellm)。 */
  readonly provider?: string
  /** 模型 id(wire model id)。 */
  readonly model?: string
}

/** 手工施加 @Remote 装饰器(对齐 packages/prompt-studio/src/index.ts 同款函数)。 */
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

/** 读取 configuration() 的行清单(防御形状:数组或 {entries})。 */
function readRows(configEditor: ConfigEditorFace): { entry: { options: { id: string } }; override: Record<string, unknown> }[] {
  const raw: unknown = configEditor.configuration()
  const list = Array.isArray(raw) ? raw : (raw as { entries?: unknown[] } | null)?.entries ?? []
  const out: { entry: { options: { id: string } }; override: Record<string, unknown> }[] = []
  for (const item of list) {
    const row = item as { entry?: { options?: { id?: string } }; override?: Record<string, unknown> }
    const id = row.entry?.options?.id
    if (typeof id === 'string') out.push({ entry: { options: { id } }, override: row.override ?? {} })
  }
  return out
}

/** 安全解析 configEditor 服务(缺席/未就绪时 undefined,不炸宿主)。 */
function resolveConfigEditor(ctx: DoctorContextLike): ConfigEditorFace | undefined {
  try {
    const service = ctx.get('configEditor') as ConfigEditorFace | undefined
    if (service !== undefined && typeof service.edit === 'function') return service
    return undefined
  } catch {
    return undefined
  }
}

/** LlmDoctor 网关(SRC 端点宿主)。状态全公开:见文件头网关纪律。 */
export class LlmDoctorGateway extends TypertRemoteService {
  readonly watchedEntryId = PI_AI_ENTRY_ID
  checkedAt: string = ''
  health: readonly RouteHealth[] = []
  routes: readonly DoctorRouteSnapshot[] = []
  lastAutoFix: readonly AutoFixRecord[] = []
  lastError: string | undefined
  /** 测试注入口:生产为全局 fetch。 */
  fetchImpl: FetchLike = globalThis.fetch
  /** 测试注入口:apiKey 解析(生产按 apiKeyEnv 读 process.env)。 */
  resolveApiKey: (apiKeyEnv: string | undefined) => string | undefined = env =>
    (env === undefined || env === '' ? undefined : process.env[env])

  // SRC shadow 纪律(对齐 prompt-studio 头注):状态全公开——#private 在网关
  // receiver shadow 上读取即抛 "Cannot read private member"(probeModel 实测踩中)。
  readonly doctorCtx: DoctorContextLike
  checking: boolean = false
  debounceTimer: ReturnType<typeof setTimeout> | undefined

  constructor(ctx: DoctorContextLike) {
    super(ctx as never, LLM_DOCTOR_SERVICE_ID)
    this.doctorCtx = ctx
  }

  /** 体检 + 必要时自动适配写回。幂等:路径已存在时无动作。 */
  async checkNow(): Promise<DoctorHealthReport> {
    this.checkedAt = new Date().toISOString()
    const editor = resolveConfigEditor(this.doctorCtx)
    if (editor === undefined) {
      this.lastError = 'configEditor 服务缺席——只体检不写回'
      this.health = []
      return this.report()
    }
    try {
      const rows = readRows(editor)
      const row = rows.find(candidate => candidate.entry.options.id === this.watchedEntryId)
      if (row === undefined) {
        this.health = []
        this.routes = []
        this.lastError = undefined
        return this.report()
      }
      const providers = (row.override as { providers?: Record<string, ProviderRouteConfig> }).providers ?? {}
      this.routes = Object.entries(providers).map(([provider, route]) => ({
        provider,
        displayName: route.displayName,
        api: route.api,
        baseURL: route.baseURL,
        models: (route.models ?? []).map(entry => entry.id),
      }))
      const outcome = await normalizeConfig({ providers }, this.fetchImpl)
      this.health = outcome.health
      if (outcome.next !== null) {
        // edit 必须用 entries() 的活引用——configuration() 返回分离包装,直接传
        // 即抛 "Configuration entry is no longer available"(2026-11-09 实测)。
        const liveEntry = editor.entries().find(candidate => candidate.options.id === this.watchedEntryId)
        if (liveEntry === undefined) throw new Error(`承载行 ${this.watchedEntryId} 已不在活跃条目中,放弃写回`)
        const nextConfig = () => ({ ...row.override, providers: outcome.next?.providers })
        // HMR 事务退避:settings 保存的编辑事务未关时(edit 内部 hmr.runExclusive)
        // 立即写回会抛 "HMR transactions cannot be nested"(协议切换触发 pi-ai
        // 整行重载,事务超防抖窗)——600ms 退避重试,至多 3 次(2026-11-09 实测)。
        let lastWriteError: Error | undefined
        for (let attempt = 0; attempt < 3; attempt++) {
          try {
            await editor.edit(liveEntry, nextConfig)
            lastWriteError = undefined
            break
          } catch (error) {
            if (!(error instanceof Error)) throw error
            lastWriteError = error
            if (!error.message.includes('nested') && !error.message.includes('no longer available')) throw error
            await new Promise(resolve => setTimeout(resolve, 600))
          }
        }
        if (lastWriteError !== undefined) throw lastWriteError
        this.lastAutoFix = outcome.fixes
        for (const fix of outcome.fixes) {
          console.log(`llm-doctor: 自动适配 ${fix.provider}(${fix.api})baseURL ${fix.from} → ${fix.to}`)
        }
      }
      this.lastError = undefined
    } catch (error) {
      this.lastError = error instanceof Error ? error.message : String(error)
      console.error(`llm-doctor: 体检失败 — ${this.lastError}`)
    }
    return this.report()
  }

  /** 防抖复检(volatile-update 监听入口)。 */
  scheduleCheck(): void {
    if (this.checking) return
    console.log('llm-doctor: volatile-update → 防抖复检')
    if (this.debounceTimer !== undefined) clearTimeout(this.debounceTimer)
    this.debounceTimer = setTimeout(() => {
      this.debounceTimer = undefined
      void this.runChecked(this.checkNow())
    }, 400)
  }

  /** in-flight 守卫的执行壳(公开:shadow 纪律)。 */
  async runChecked(run: Promise<unknown>): Promise<void> {
    this.checking = true
    try { await run } finally { this.checking = false }
  }

  /** SRC 端点:llmDoctor/health——逐路由体检报告(不写回)。 */
  report(): DoctorHealthReport {
    return {
      watchedEntryId: this.watchedEntryId,
      checkedAt: this.checkedAt,
      health: this.health,
      routes: this.routes,
      lastAutoFix: this.lastAutoFix,
      lastError: this.lastError,
    }
  }

  /** SRC 端点:llmDoctor/probe——逐模型连通性测试(真发极小补全)。 */
  async probeModel(input?: ProbeInput): Promise<PingResult> {
    const provider = typeof input?.provider === 'string' ? input.provider : ''
    const model = typeof input?.model === 'string' ? input.model : ''
    if (provider === '' || model === '') {
      return { ok: false, latencyMs: 0, error: 'probe 需要 input.provider 与 input.model' }
    }
    const editor = resolveConfigEditor(this.doctorCtx)
    if (editor === undefined) return { ok: false, latencyMs: 0, error: 'configEditor 服务缺席' }
    const rows = readRows(editor)
    const row = rows.find(candidate => candidate.entry.options.id === this.watchedEntryId)
    if (row === undefined) return { ok: false, latencyMs: 0, error: `未找到承载行 ${this.watchedEntryId}` }
    const providers = (row.override['providers'] as Record<string, ProviderRouteConfig> | undefined) ?? {}
    const route = providers[provider]
    if (route === undefined) return { ok: false, latencyMs: 0, error: `未找到路由 ${provider}` }
    if (route.models !== undefined && !route.models.some(entry => entry.id === model)) {
      return { ok: false, latencyMs: 0, error: `模型 ${model} 不在路由 ${provider} 目录内` }
    }
    return pingModel(route, model, this.resolveApiKey(route.apiKeyEnv), this.fetchImpl)
  }
}

// 手工施加 @Remote(端点名 = kebab-case;方法名保持驼峰)
applyRemoteMarker(LlmDoctorGateway.prototype, 'report', 'health')
applyRemoteMarker(LlmDoctorGateway.prototype, 'probeModel', 'probe')

export interface LlmDoctorPluginConfig {
  /** boot 后首检延迟(毫秒;默认 2000,不拖启动)。 */
  readonly initialCheckDelayMs?: number
}

/**
 * 插件工厂(bundle loader 取 default export 实例;apply 返回总 disposer)。
 * configEditor 经 cordis get 解析(缺席不炸宿主,只体检不写回)。
 */
export function defineLlmDoctorPlugin(config: LlmDoctorPluginConfig = {}) {
  return {
    name: 'eterna-llm-doctor',
    apply(ctx: DoctorContextLike): () => void {
      const gateway = new LlmDoctorGateway(ctx)
      // global 监听:volatile-update 由 loader 定向 emit 在「被改条目自己的 fiber
      // ctx」上(装品 loader lib/index.js:553 fiber.ctx.emit(self,...)),cordis
      // 分发按发射方 scope 过滤非 global 监听——兄弟插件(本插件)必须 global 才
      // 能收到别人条目的变更(2026-11-09 实测:非 global 注册静默收不到)。
      const disposeListener = ctx.on('loader/volatile-update', () => { gateway.scheduleCheck() }, { global: true })
      const initial = setTimeout(() => { void gateway.checkNow() }, config.initialCheckDelayMs ?? 2000)
      return () => {
        clearTimeout(initial)
        disposeListener()
      }
    },
  }
}

/** DSH bundle loader 取 default export 插件实例(对齐 panel/glue 插件形态)。 */
export default defineLlmDoctorPlugin()
