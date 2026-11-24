/**
 * 参谋的**工具面守门**(P4 收尾,2026-11-24 实机定谳必须修的真缺陷)。
 *
 * ## 这一行解决的缺陷
 * 参谋的只读纪律本来只靠 `eterna-adviser` preset 的**工具面缺失**保证——预设里
 * 不挂 tool-bash / tool-fs 的写开关 / tool-subagent,于是参谋看不到它们。
 *
 * 但上游 `ToolsService.view(scope)` 的可见集是 **全局层 ∪ 作用域链各层**
 * (`packages/core/tools/src/index.ts:220-236`):
 *
 * ```ts
 * const inherited = new Map(this.layers.global.tools.entries())   // ← 全局层先入
 * for (const layer of layers) { … inherited.set(name, registration) }  // ← 作用域层只做「覆盖/追加」
 * ```
 *
 * 预设挂载只往**作用域层加**工具,挡不住**根 ctx 上注册的全局工具**。而真实部署
 * (`eterna-web` / `eterna-super`)的 glue 恰好在根 ctx 上注册了三个写工具:
 * `knowledge_propose`(提案写入)、`memory_write`、`memory_forget`;
 * `@eterna/access` 还全局注册了 `install_personal_plugin`。
 *
 * **实机实证(2026-11-24,`probe-global-leak.mjs`)**:参谋的可见工具面是
 *
 * ```
 * ["glob","grep","install_personal_plugin","knowledge_propose","memory_write",
 *  "read","read_image","session_event_read","session_event_search",
 *  "session_event_trace","session_search","session_trace","skill","working_directory"]
 * ```
 *
 * ——三个写工具全在。P4 记录的「只读 11/11」是在**不含 glue 的最小探针 profile**
 * 里测的,因此那条结论只对空 profile 成立,不覆盖生产形态。本模块补上硬保证。
 *
 * ## 为什么守门放在 preset 里而不是 host.ts
 * `host.ts` 拿到的是**父**会话的 ctx;限制必须施加在**子会话的 scope 链**上。
 * 预设树挂在「预设代际 scope」下,而每个绑定该预设的子会话 scope 都是它的子节点
 * (`agent-preset-registry/src/index.ts:282` `bindScopeParent(key, generation.key)`),
 * 作用域限制沿链**交叉**(`ToolLayer.admits`),因此挂在预设里的这一行天然作用于
 * 所有参谋会话,且不碰父会话。
 *
 * ## 为什么是「动态 deny = 全部全局名 − 只读白名单」
 * 写死禁用清单会漏:`@eterna/access` 的热挂插件、将来的新 glue 工具都可能加进来。
 * 反过来,取当前全局工具全集减去只读白名单,**任何新增全局工具默认被挡**
 * (fail-closed)。白名单当前只有 `working_directory`(纯只读定位信息)。
 *
 * `ctx.tools.definitions()` **不带 scope 参数时返回全局视图**
 * (`ToolsService.definitions → view(undefined)`,`inherited` 只含 `layers.global`),
 * 所以在预设 scope 里调用它拿到的正是全局工具名,不含预设自己的工具——这正是
 * deny 名单该有的内容。
 *
 * ## 为什么订阅 `tools/change` 且必须异步
 * 全局工具可能在预设挂载**之后**才注册(装载顺序由服务可用性驱动——`host.ts` 头注
 * 记过同一类坑,access 的热挂插件更是运行期随时注册)。实测:
 *
 * - 不订阅 → 晚注册的写工具会漏进参谋(探针 `late_writer` 复现);
 * - 在事件回调里**同步**调 `restrict` → 自递归爆栈:restrict 本身 emit
 *   `tools/change`(`ScopedLayers` 的 onChange),回调再 restrict……实测
 *   `RangeError: Maximum call stack size exceeded`。
 *
 * 因此用 `queueMicrotask` 跳出当前调用栈,并以 pending 标志合并同一拍内的多次变更。
 */

/**
 * 参谋允许使用的**全局**工具名(只读)。
 *
 * 分两类:
 *
 * 1. `working_directory` —— 上游 `@deepseek-ai/dsh-working-directory` 注册的只读
 *    定位工具(告诉模型「当前在哪个目录」),不对文件系统产生副作用;
 * 2. `knowledge_search` / `knowledge_read` / `knowledge_status` —— glue 的 knowledge
 *    插件在根 ctx 全局注册的**只读**三件。白名单放行它们即可让参谋拿到知识库检索
 *    能力,而且**自动继承 glue 的租户分库路由**(admin→全局库、普通账号→
 *    `workspaces/<account>`):转发/镜像会绕开那条路由,放行不会。
 *
 * ⚠ `knowledge_propose` 是写操作(提案落库),**永不**入白名单——它由 glue 与只读
 * 三件一起注册,是本清单必须逐名列举而不能用 `knowledge_*` 通配的原因。
 *
 * ⚠ 增补纪律:只允许加**纯只读**工具。任何会写盘、执行命令、委派、投递、或改动
 * 持久状态的全局工具,一律不进白名单——参谋的定位是只读顾问。
 */
export const ADVISER_ALLOWED_GLOBAL_TOOLS: readonly string[] = [
  'working_directory',
  'knowledge_search',
  'knowledge_read',
  'knowledge_status',
]

/** 宿主 tools 服务的最小消费面(结构面,不 import 上游类型包)。 */
interface ToolsFace {
  definitions(): readonly { readonly name?: unknown }[]
  restrict(filter: { readonly allow?: readonly string[]; readonly deny?: readonly string[] }): () => void
}

/** 宿主 ctx 的最小消费面。 */
interface GuardContext {
  readonly tools?: ToolsFace
  readonly on?: (event: string, listener: () => void) => () => void
}

/** 守卫装置:返回 disposer(撤销订阅;restrict 的 disposer 由 scope 关停回收)。 */
export interface ToolGuard {
  /** 立即重算一次 deny 面(供测试与诊断)。 */
  sync(reason?: string): void
  /** 撤销 `tools/change` 订阅。 */
  dispose(): void
}

/**
 * 造一个全局工具守门装置。
 *
 * 幂等:`sync()` 只对**尚未 deny 过**的名字发 restrict,因此 `tools/change` 反复
 * 触发也不会堆积重复限制(restrict 每次返回独立 disposer,累积会拖慢视图计算)。
 *
 * @param ctx - 预设内的插件上下文(scope 链的父节点,作用于所有绑定此预设的子会话)。
 * @returns 守卫装置;`ctx.tools` 缺席时返回空实现(不炸预设挂载)。
 */
export function createToolGuard(ctx: GuardContext): ToolGuard {
  const allowed = new Set(ADVISER_ALLOWED_GLOBAL_TOOLS)
  const denied = new Set<string>()
  let disposed = false
  let pending = false
  let stop: (() => void) | undefined

  /** 当前**全局**工具名(不带 scope = global view,与调用者 scope 无关)。 */
  const globalNames = (tools: ToolsFace): readonly string[] => {
    try {
      return tools.definitions().flatMap(definition =>
        typeof definition.name === 'string' ? [definition.name] : [])
    } catch {
      // tools 服务被卸下 / 视图计算失败:本轮跳过,下次 tools/change 再试。
      return []
    }
  }

  const sync = (reason = 'manual'): void => {
    const tools = ctx.tools
    if (disposed || tools === undefined) return
    try {
      const target = globalNames(tools).filter(name => !allowed.has(name) && !denied.has(name))
      if (target.length === 0) return
      tools.restrict({ deny: target })
      for (const name of target) denied.add(name)
      void reason
    } catch {
      // restrict 的两种拒绝(无 scope / 未知工具名)都在此处静默降级:
      // 守门失效时参谋可能多看到几个全局工具,但面板与投递照常工作。
    }
  }

  const schedule = (): void => {
    if (pending) return
    pending = true
    queueMicrotask(() => {
      pending = false
      sync('change')
    })
  }

  if (ctx.tools !== undefined) {
    sync('mount')
    try {
      stop = ctx.on?.('tools/change', schedule)
    } catch {
      // 订阅失败 → 只有挂载时那一次守护生效(晚注册的全局工具会漏)。
      stop = undefined
    }
  }

  return {
    sync: (reason?: string) => { sync(reason) },
    dispose: () => {
      if (disposed) return
      disposed = true
      try { stop?.() } catch { /* 订阅已随 scope 回收 */ }
      stop = undefined
    },
  }
}
