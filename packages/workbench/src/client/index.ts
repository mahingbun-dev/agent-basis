/**
 * @eterna/workbench 浏览器半边:侧栏「工作台」入口(sidebar.panellist)+
 * main keyed slot 上的工作台面板页(Attention 横幅 + 会话侧区 + 五视图一
 * 检查器单页)。装载照 @eterna/panel keyed main panel 先例(38 号 B1/G-2:
 * 不建独立页面)。
 *
 * 数据面(M4 实接,G2-D11):真源 SSE 流 = access 路由面登记的同源端点
 * (DEFAULT_LIVE_STREAM_PATH,38 号 O-5/G2-C4;载荷 = tasks 引擎 DomainEvents
 * 经 live hub 投影的快照+增量)——控制器为裸 observable 源,经 inject 面保留
 * hooks 份额(渲染器绑成 useSnapshot),不建 store、不写订阅机制(panel apply
 * 同款纪律)。mock 流(mock-stream.ts)已降为测试 fixture,无切换开关。
 *
 * T6 会话侧组件(TaskSidebar/TicketTimeline)随本工件分发并从导出面暴露:
 * 32 号 §3「工作台与会话内表面统一做」——M3 落工作台页会话侧区,M4 实接
 * Engine DomainEvents 并换挂会话内表面。宿主 ui-sidebar/ui-conversation 现无
 * 会话侧栏体 slot(ui-sidebar contract:sidebar.workspaces 为 single 且归
 * ui-workspace;26 号 §3 无 seam 先上游 PR,38 号 O-10),故本包不预设 slot 名。
 */
import { WorkbenchIcon } from './WorkbenchIcon.tsx'
import { WorkbenchPage, type WorkbenchPageProps } from './WorkbenchPage.tsx'
import { NS, en, zh } from './locales.ts'
import { injectWorkbenchStyles } from './styles.ts'
import { createLiveStreamController, type WorkbenchStreamController } from './live-stream.ts'
import type { WorkbenchClientContext } from './client-types.ts'

export { TaskSidebar, TicketTimeline, type TaskSidebarProps, type TicketTimelineProps } from './TaskSidebar.tsx'
export { AttentionBanner, type AttentionBannerProps } from './AttentionBanner.tsx'

/** 侧栏入口与 main 面板共享的 id(keyed main panel:sidebar 条目 id = 面板 key)。 */
export const PANEL_ID = 'eterna-workbench'

/** 依赖服务:槽位注册表 + 语言(数据走同源真源 SSE 流,不消费宿主 RPC)+
 * 会话导航(「主会话」显式入口,2026-11-19;ui-workspace 的 uiWorkspace)。 */
export const inject = ['slots', 'locale', 'uiWorkspace']

export type { WorkbenchPageProps, WorkbenchStreamController }

/**
 * 工作台插件体:注册字典与两个 slot 贡献;真源流控制器随插件体创建,
 * 卸载时 stop(连接释放)。
 * @param ctx - 浏览器插件上下文。
 * @returns 撤销字典注册的 disposer(slot 贡献随插件 fiber 自撤)。
 */
export function apply(ctx: WorkbenchClientContext): () => void {
  injectWorkbenchStyles()
  const disposeLocale = ctx.locale.register(NS, { zh, en })
  const t = ctx.locale.bind(NS)

  const stream = createLiveStreamController()
  const uiWorkspace = ctx.uiWorkspace

  ctx.slots.inject('main', () => ctx.slots.register({
    name: 'main',
    key: PANEL_ID,
    locale: NS,
    inject: () => ({
      hooks: { snapshot: stream },
      retry: () => { stream.retry() },
      t,
      // 「主会话」显式入口(2026-11-19):id 由快照 masterSessionId 供给,动作走
      // 宿主 ui-workspace 导航(未注入的服务面缺席 → 入口不渲染)。
      ...(uiWorkspace === undefined ? {} : {
        openMaster: (sessionId: string) => { uiWorkspace.openSession(sessionId) },
        // 会话行点击导航(2026-11-19):派生主控/执行行与普通行同一动作面。
        openSession: (sessionId: string) => { uiWorkspace.openSession(sessionId) },
      }),
    }),
  }, WorkbenchPage))
  ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({
    name: 'sidebar.panellist',
    id: PANEL_ID,
    order: 21,
    locale: NS,
    label: () => t('panel'),
  }, WorkbenchIcon))
  return () => {
    stream.stop()
    disposeLocale()
  }
}
