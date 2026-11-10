/**
 * @eterna/prompt-studio 浏览器半边(T7.2):侧栏「提示词工坊」与「循环轨迹」两视图。
 *
 * 结构面(panel 同款配方):两个 main keyed 槽占位(key=面板 id)+ 两个
 * sidebar.panellist 条目(id=key,点击 layout.selectPanel(id) 切换)。数据经官方
 * Connection RPC 通道拉取宿主 loopPrompt/* 端点(Typert 网关 SRC 模式,由本包
 * Host 半边提供;载荷纪律见 rpc.ts)。可变事实只有 studio/trace 两个快照,走
 * inject 面的保留 hooks 份额(裸 observable 源,渲染器绑成 useStudio/useTrace),
 * 不建 store、不写订阅机制。视图组件持有两段式写链路的交互态(T7.2 UI 义务:
 * 渲染 R3 卡 + 双问 → 回显重发 → committed 后按 effectiveNote 提示)。
 *
 * 类型采用本地结构面(client-types.ts):浏览器运行的 cordis(宿主壳)服务面比
 * 本仓库安装的类型宽,跨包类型导入会引入 dsh 客户端包依赖;线载荷类型从
 * ../types.ts 以纯 type 导入引入(单一事实源,esbuild 全部擦除)。
 */
import { StudioIcon, TraceIcon } from './icons.tsx'
import { StudioPage } from './StudioPage.tsx'
import { TracePage, type TraceState } from './TracePage.tsx'
import { NS, en, zh } from './locales.ts'
import { injectStudioStyles } from './styles.ts'
import { callRpc, type RpcEnvelope } from './rpc.ts'
import type { LoopPromptSnapshot, TraceReport, VersionsResult } from '../types.ts'
import type { PromptStudioClientContext } from './client-types.ts'
import type { StudioState } from './studio-state.ts'

/** 「提示词工坊」面板 id(main keyed 槽 key 与 sidebar.panellist 条目 id 共用)。 */
export const STUDIO_PANEL_ID = 'eterna-prompt-studio'
/** 「循环轨迹」面板 id。 */
export const TRACE_PANEL_ID = 'eterna-loop-trace'

/** 依赖服务:槽位注册表、语言、连接(宿主 RPC 通道)。 */
export const inject: readonly string[] = ['slots', 'locale', 'connection']

/**
 * 插件体:注册字典、两个 main 面板与两个侧栏入口,并经 Connection RPC 拉数据。
 * @param ctx - 浏览器插件上下文。
 * @returns 总 disposer:移除注入样式表 + 撤销语言注册(slot 贡献随插件 fiber 自撤)。
 */
export function apply(ctx: PromptStudioClientContext): () => void {
  const disposeStyles = injectStudioStyles()
  const disposeLocale = ctx.locale.register(NS, { zh, en })
  const t = ctx.locale.bind(NS)

  // —— 工坊数据源(裸 observable 源;三个只读端点一次拉齐) ——
  let studioState: StudioState = { status: 'loading' }
  const studioListeners = new Set<() => void>()
  const studioSource = {
    getSnapshot: (): StudioState => studioState,
    subscribe: (listener: () => void): (() => void) => {
      studioListeners.add(listener)
      return () => { studioListeners.delete(listener) }
    },
  }
  const publishStudio = (next: StudioState): void => {
    studioState = next
    for (const listener of studioListeners) listener()
  }
  const refreshStudio = (): void => {
    void (async (): Promise<void> => {
      // 两个只读端点顺序拉取(失败即短路;类型面自然收窄)。T1.5 全景改版:
      // 条目元数据与当前值全部来自 snapshot.entries[];默认条目链用 versions;
      // 其余条目链由 StudioPage 按选择惰性拉取(prompt-versions {entryId})。
      const snapshot = await callRpc<LoopPromptSnapshot>(ctx.connection, 'loopPrompt/snapshot')
      if (!snapshot.ok) {
        publishStudio({ status: 'error', message: snapshot.message })
        return
      }
      const versions = await callRpc<VersionsResult>(ctx.connection, 'loopPrompt/prompt-versions', { input: {} })
      if (!versions.ok) {
        publishStudio({ status: 'error', message: versions.message })
        return
      }
      publishStudio({ status: 'ready', snapshot: snapshot.value, versions: versions.value })
    })().catch((error: unknown) => {
      publishStudio({ status: 'error', message: error instanceof Error ? error.message : String(error) })
    })
  }
  refreshStudio()

  // —— 轨迹数据源(列表/详情同端点;openSession 以带参调用切换形态) ——
  let traceState: TraceState = { status: 'loading' }
  const traceListeners = new Set<() => void>()
  const traceSource = {
    getSnapshot: (): TraceState => traceState,
    subscribe: (listener: () => void): (() => void) => {
      traceListeners.add(listener)
      return () => { traceListeners.delete(listener) }
    },
  }
  const publishTrace = (next: TraceState): void => {
    traceState = next
    for (const listener of traceListeners) listener()
  }
  const refreshTrace = (): void => {
    // trace 是带参端点(SRC 形参名 input):列表模式也须传 args.input={}(缺席时
    // 宿主绑定 undefined,读 input.sessionId 即 gateway/internal——ui-check 实证)。
    void callRpc<TraceReport>(ctx.connection, 'loopPrompt/trace', { input: {} }).then((report) => {
      if (report.ok) publishTrace({ status: 'ready', report: report.value })
      else publishTrace({ status: 'error', message: report.message })
    }).catch((error: unknown) => {
      publishTrace({ status: 'error', message: error instanceof Error ? error.message : String(error) })
    })
  }
  refreshTrace()

  /** 选中会话 → 详情形态(契约:带 sessionId 返回 selected 轮次树,sessions=[])。 */
  const openTraceSession = (sessionId: string): void => {
    void callRpc<TraceReport>(ctx.connection, 'loopPrompt/trace', { input: { sessionId } }).then((report) => {
      if (report.ok) publishTrace({ status: 'ready', report: report.value })
      else publishTrace({ status: 'error', message: report.message })
    }).catch((error: unknown) => {
      publishTrace({ status: 'error', message: error instanceof Error ? error.message : String(error) })
    })
  }

  /** 视图共用的 RPC 面(components 只见 envelope,不见 connection)。 */
  const call = <T>(endpoint: string, args: Record<string, unknown> = {}): Promise<RpcEnvelope<T>> =>
    callRpc<T>(ctx.connection, endpoint, args)

  // —— 两个 main keyed 面板 + 两个侧栏入口(声明坍塌即随链路撤销) ——
  ctx.slots.inject('main', () => ctx.slots.register({
    name: 'main',
    key: STUDIO_PANEL_ID,
    locale: NS,
    inject: () => ({
      hooks: { studio: studioSource },
      refresh: refreshStudio,
      call,
      t,
    }),
  }, StudioPage))
  ctx.slots.inject('main', () => ctx.slots.register({
    name: 'main',
    key: TRACE_PANEL_ID,
    locale: NS,
    inject: () => ({
      hooks: { trace: traceSource },
      refresh: refreshTrace,
      openSession: openTraceSession,
      t,
    }),
  }, TracePage))
  ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({
    name: 'sidebar.panellist',
    id: STUDIO_PANEL_ID,
    order: 21,
    locale: NS,
    label: () => t('studio'),
  }, StudioIcon))
  ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({
    name: 'sidebar.panellist',
    id: TRACE_PANEL_ID,
    order: 22,
    locale: NS,
    label: () => t('trace'),
  }, TraceIcon))
  return () => { disposeStyles(); disposeLocale() }
}
