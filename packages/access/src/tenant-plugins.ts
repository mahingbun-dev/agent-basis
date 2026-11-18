/**
 * T6 装载器(2026-11-18):个人/共享工具插件的进程内 mount——闭合 user-plugins.ts
 * 头注声明的「一期边界」(P4-T6 只做记账+清单下发,mount 面留后续任务,挂点即本文件)。
 *
 * 装载契约(个人层与共享层统一,仅工具型):
 * - 目录含 package.json,`main`(缺省 `index.js`)指向纯 JS 入口(.js/.mjs);
 * - 入口导出 `apply(ctx)`(命名导出或 default 导出对象上皆可)+ 可选 `inject`
 *   (只允许缺省或 `['tools']`,越权即拒载);
 * - manifest 带 `dsh.client`(UI 半边)或 `dsh.bundle.patch`(bundle)→ 拒载:
 *   个人层不承载 UI/服务型,报错指引 admin bundle 安装(P3b)。
 *
 * 受限 ctx(非沙箱——tenant-realm.md 既定口径「isolate 是服务作用域,不是沙箱」):
 * 插件代码拿到的合成对象只有 `tools.register` 包装面,注册时自动:
 * 1. 工具名命名空间 `user_<account>_<原名>`(共享层复用原作者账号段;非法字符转
 *    `_`;撞名拒载不静默——工具目录是全局层,同名注册宿主直接抛错);
 * 2. 附加 `when` 谓词做归属可见性(个人=仅 owner 会话;共享=恒可见;activation
 *    拿不到会话 id = 不可见,fail-closed;先例 packages/tasks/src/plugin.ts:696-708);
 * 3. disposer 收进装载器账本,unmount 全量回收——启停/移除即时生效,零重启。
 *
 * 生命周期:mount(读 manifest→校验→动态 import(带 ?t= 破 ESM 缓存)→apply)→
 * stateOf 供 list 路由下发 mounted/tools/error;bootScan 读 DB(个人 enabled 行+
 * 共享 enabled 行)重启后自动重挂——持久化在账本,不依赖 profile patch/hmr。
 * 单插件装载失败只记 state+审计,绝不炸 boot(宿主插件装载纪律的租户层对应)。
 */
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import type { AccessAuditEvent } from './audit.ts'
import type { UserStore } from './store.ts'

/** when 谓词的 activation 形态(上游 ToolActivationContext 的结构子集)。 */
export type TenantPluginActivation = {
  readonly agent?: { readonly id?: string; readonly session?: { readonly id?: string } }
}
/** 当步可见性谓词(注册选项;返回 false = 本步目录与派发都排除)。 */
export type TenantPluginWhen = (activation: TenantPluginActivation) => boolean

/** 宿主 tools.register 的结构面(注册/注销;当步可见性谓词)。 */
export interface TenantPluginToolsFace {
  register(
    definition: Record<string, unknown>,
    options?: { when?: TenantPluginWhen },
  ): () => void
}

/** 装载器依赖(结构面;store 取窄子集,测试可换假件)。 */
export interface TenantPluginLoaderDeps {
  readonly store: Pick<UserStore, 'allEnabledUserPlugins' | 'sharedPlugins' | 'getUserById'>
  sessionOwnerOf(sessionId: string): number | undefined
  /** 宿主 tools 服务惰性取用(apply 时点可能未就绪——companion wrap 同款时序;
   * 每次 mount 现取,bootScan 未就绪则跳过,由宿主侧补扫钩子重试)。 */
  readTools(): TenantPluginToolsFace | undefined
  audit(event: AccessAuditEvent): void
}

export interface TenantPluginMountResult {
  readonly ok: boolean
  readonly tools?: readonly string[]
  readonly error?: string
}

export interface TenantPluginState {
  readonly mounted: boolean
  readonly tools: readonly string[]
  readonly error?: string
}

interface MountRecord {
  readonly names: string[]
  readonly disposers: Array<() => void>
  state: TenantPluginState
}

/** 工具名合法字符(与宿主保留名检查同口径的宽松子集)。 */
const TOOL_NAME_PATTERN = /^[\w][\w.-]{0,63}$/u

/** 账号段 → 工具名命名空间段(白名单外字符一律转 `_`)。 */
function namespaceSegment(account: string): string {
  return account.replace(/[^\w]/gu, '_')
}

export function createTenantPluginLoader(deps: TenantPluginLoaderDeps): {
  mount(pluginId: string, opts: { readonly dir: string; readonly ownerUserId?: number }): Promise<TenantPluginMountResult>
  unmount(pluginId: string): void
  bootScan(): Promise<void>
  stateOf(pluginId: string): TenantPluginState
  dispose(): void
} {
  const mounts = new Map<string, MountRecord>()
  const takenNames = new Set<string>()

  const stateOf = (pluginId: string): TenantPluginState => {
    return mounts.get(pluginId)?.state ?? { mounted: false, tools: [] }
  }

  const auditMount = (action: string, pluginId: string, detail: Record<string, unknown>): void => {
    deps.audit({ kind: 'access.tenant', detail: { action: `plugin.${action}`, pluginId, ...detail } })
  }

  const unmount = (pluginId: string): void => {
    const record = mounts.get(pluginId)
    if (record === undefined) return
    for (const name of record.names) takenNames.delete(name)
    for (const dispose of [...record.disposers].reverse()) {
      try {
        dispose()
      } catch {
        // 单个注销失败不阻断其余回收(宿主 disposer 纪律:卸载尽力而为)
      }
    }
    mounts.delete(pluginId)
    auditMount('unmount', pluginId, {})
  }

  /** 读 manifest 并校验装载契约(返回错误文案;通过时返回解析结果)。 */
  function readContract(dir: string): { readonly name: string; readonly entry: string } | string {
    const manifestPath = join(dir, 'package.json')
    if (!existsSync(manifestPath)) return `缺少 package.json:${dir}`
    let manifest: unknown
    try {
      manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
    } catch (error) {
      return `package.json 解析失败:${error instanceof Error ? error.message : String(error)}`
    }
    if (typeof manifest !== 'object' || manifest === null) return 'package.json 必须是对象'
    const record = manifest as Record<string, unknown>
    if (typeof record.name !== 'string' || record.name === '') return 'package.json 缺少 name'
    // fail-closed:UI 半边/bundle 不是个人层承载面(诚实边界,指引 P3b admin 路径)
    const dsh = typeof record.dsh === 'object' && record.dsh !== null ? (record.dsh as Record<string, unknown>) : undefined
    if (dsh?.client !== undefined) return 'manifest 带 dsh.client(UI 插件):个人层仅承载工具型插件;UI 插件请由管理员走 bundle 安装'
    if (dsh?.bundle !== undefined) return 'manifest 带 dsh.bundle(bundle 插件):个人层仅承载工具型插件;请由管理员走 bundle 安装'
    const mainField = typeof record.main === 'string' && record.main !== '' ? record.main : 'index.js'
    if (!/\.(js|mjs)$/u.test(mainField)) return `main 必须指向 .js/.mjs 纯 JS 入口(当前:${mainField};TS 请先编译)`
    const entry = join(dir, mainField)
    if (!existsSync(entry)) return `入口文件不存在:${entry}`
    return { name: record.name, entry }
  }

  /** 装载入口模块并展开 apply/inject(命名导出与 default 导出双兼容)。 */
  async function importHostHalf(entry: string): Promise<{ readonly apply: unknown; readonly inject: unknown } | string> {
    let mod: unknown
    try {
      mod = await import(`${pathToFileURL(entry).href}?t=${Date.now()}`)
    } catch (error) {
      return `入口加载失败:${error instanceof Error ? error.message : String(error)}`
    }
    const direct = mod as Record<string, unknown>
    const candidate = (typeof direct.apply === 'function' ? direct : direct.default) as Record<string, unknown> | undefined
    if (candidate === undefined || typeof candidate.apply !== 'function') {
      return '入口缺少 apply(ctx) 导出(Host 半边契约)'
    }
    return { apply: candidate.apply, inject: candidate.inject }
  }

  async function mount(pluginId: string, opts: { readonly dir: string; readonly ownerUserId?: number }): Promise<TenantPluginMountResult> {
    unmount(pluginId)
    const tools = deps.readTools()
    if (tools === undefined || typeof tools.register !== 'function') {
      const error = '宿主 tools 服务未就绪,装载器惰性'
      mounts.set(pluginId, { names: [], disposers: [], state: { mounted: false, tools: [], error } })
      return { ok: false, error }
    }
    const contract = readContract(opts.dir)
    if (typeof contract === 'string') {
      mounts.set(pluginId, { names: [], disposers: [], state: { mounted: false, tools: [], error: contract } })
      auditMount('mount.rejected', pluginId, { reason: contract, dir: opts.dir })
      return { ok: false, error: contract }
    }
    const half = await importHostHalf(contract.entry)
    if (typeof half === 'string') {
      mounts.set(pluginId, { names: [], disposers: [], state: { mounted: false, tools: [], error: half } })
      auditMount('mount.rejected', pluginId, { reason: half, dir: opts.dir })
      return { ok: false, error: half }
    }
    if (half.inject !== undefined && half.inject !== null) {
      const inject = half.inject as unknown
      const allowed = Array.isArray(inject) && inject.length <= 1 && (inject.length === 0 || inject[0] === 'tools')
      if (!allowed) {
        const error = `inject 越权:${JSON.stringify(inject)}(个人层仅允许 ['tools'])`
        mounts.set(pluginId, { names: [], disposers: [], state: { mounted: false, tools: [], error } })
        auditMount('mount.rejected', pluginId, { reason: error, dir: opts.dir })
        return { ok: false, error }
      }
    }
    // 命名空间段:共享层无 owner → 用原作者账号(plugin_id 中段);个人层用本人。
    const segment = opts.ownerUserId === undefined
      ? namespaceSegment(pluginId.split(':')[1] ?? pluginId)
      : namespaceSegment(deps.store.getUserById(opts.ownerUserId)?.account ?? pluginId)
    const names: string[] = []
    const disposers: Array<() => void> = []
    const register = (definition: Record<string, unknown>): () => void => {
      const original = definition.name
      if (typeof original !== 'string' || !TOOL_NAME_PATTERN.test(original)) {
        throw new Error(`工具名非法:${JSON.stringify(original)}(须匹配 ${TOOL_NAME_PATTERN.source})`)
      }
      const mounted = `user_${segment}_${original}`
      if (takenNames.has(mounted)) throw new Error(`工具名撞名:${mounted}(先卸载同名插件或改工具名)`)
      takenNames.add(mounted)
      names.push(mounted)
      // when 谓词:个人=仅 owner 会话;共享=恒可见。activation 拿不到会话 id 一律
      // 不可见(fail-closed,系统任务/无主步骤不继承个人工具);谓词异常按不可见。
      const owner = opts.ownerUserId
      let when: TenantPluginWhen | undefined
      if (owner !== undefined) {
        when = (activation) => {
          try {
            const agent = activation.agent
            const sessionId = agent?.session?.id ?? agent?.id
            return typeof sessionId === 'string' && deps.sessionOwnerOf(sessionId) === owner
          } catch {
            return false
          }
        }
      }
      const dispose = tools.register({ ...definition, name: mounted }, when === undefined ? {} : { when })
      disposers.push(() => {
        takenNames.delete(mounted)
        dispose()
      })
      return dispose
    }
    // 受限 ctx:只有 tools.register 包装面——插件拿不到 webServer/reflect/原始 ctx。
    const restrictedCtx = { tools: { register } }
    try {
      ;(half.apply as (ctx: unknown) => unknown)(restrictedCtx)
    } catch (error) {
      for (const dispose of disposers.splice(0).reverse()) dispose()
      for (const name of names) takenNames.delete(name)
      const reason = `apply 执行失败:${error instanceof Error ? error.message : String(error)}`
      mounts.set(pluginId, { names: [], disposers: [], state: { mounted: false, tools: [], error: reason } })
      auditMount('mount.rejected', pluginId, { reason, dir: opts.dir })
      return { ok: false, error: reason }
    }
    const record: MountRecord = { names, disposers, state: { mounted: true, tools: names } }
    mounts.set(pluginId, record)
    auditMount('mount', pluginId, { dir: opts.dir, tools: names, personal: opts.ownerUserId !== undefined })
    return { ok: true, tools: names }
  }

  /** 启动期扫描:个人 enabled 行按 owner mount;共享 enabled 行全局 mount。单插件失败只记状态+审计,不炸 boot;
   * tools 未就绪则整体跳过(宿主侧补扫钩子重试)。 */
  async function bootScan(): Promise<void> {
    if (deps.readTools() === undefined) return
    for (const row of deps.store.allEnabledUserPlugins()) {
      const result = await mount(row.pluginId, { dir: row.dir, ownerUserId: row.userId })
      if (!result.ok) {
        auditMount('bootscan.failed', row.pluginId, { reason: result.error ?? 'unknown', dir: row.dir })
      }
    }
    for (const row of deps.store.sharedPlugins()) {
      if (!row.enabled) continue
      const result = await mount(row.pluginId, { dir: row.dir })
      if (!result.ok) {
        auditMount('bootscan.failed', row.pluginId, { reason: result.error ?? 'unknown', dir: row.dir })
      }
    }
  }

  return {
    mount,
    unmount,
    bootScan,
    stateOf,
    dispose(): void {
      for (const pluginId of [...mounts.keys()]) unmount(pluginId)
    },
  }
}
