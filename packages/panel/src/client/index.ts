/**
 * @basis/panel 浏览器半边:侧栏「基座面板」入口(sidebar.panellist)+ main keyed
 * slot 上的面板页(三区块)。快照数据经官方 Connection RPC 通道拉取宿主
 * basisPanel/snapshot 端点(Typert 网关 SRC 模式,由本包 Host 半边提供)。
 *
 * 面板是全局面板(root scope),不属于任何会话:注册经 ctx.slots.inject 等待
 * ui-sidebar / ui-layout 的既有 slot 声明,声明坍塌即随链路撤销(dsh 客户端
 * slot 纪律第 4 条)。可变事实只有快照一个,走 inject 面的保留 hooks 份额
 * (裸 observable 源,渲染器绑成 useSnapshot),不建 store、不写订阅机制。
 *
 * 类型采用本地结构面(client-types.ts):浏览器运行的 cordis(宿主壳的
 * 4.0.6-alpha.2)服务面比本仓库安装的 alpha.1 类型宽,跨包类型导入会引入
 * dsh 客户端包依赖;运行时鸭子类型一致,构建期零外部类型依赖。
 */
import { PanelIcon } from './PanelIcon.tsx'
import { PanelPage, type PanelSnapshotState } from './PanelPage.tsx'
import { ComposerChips } from './ComposerChips.tsx'
import { NS, en, zh } from './locales.ts'
import { injectPanelStyles } from './styles.ts'
import type { BasisPanelSnapshot } from '../types.ts'
import type { PanelClientContext } from './client-types.ts'

/** 侧栏入口与 main 面板共享的 id(MainPanelId 为品牌化字符串,自定值合法)。 */
export const PANEL_ID = 'basis-panel'

/** 宿主只读快照端点(basisPanel 命名空间,Host 半边 BasisPanelGateway)。 */
export const SNAPSHOT_ENDPOINT = 'basisPanel/snapshot'

/** 依赖服务:slot 注册表、语言、布局(main 面板选择)、连接(宿主 RPC 通道)。 */
export const inject = ['slots', 'locale', 'layout', 'connection']

/**
 * 面板插件体:注册字典与两个 slot 贡献,并经 Connection RPC 拉快照。
 * @param ctx - 浏览器插件上下文。
 * @returns 撤销字典注册的 disposer(slot 贡献随插件 fiber 自撤)。
 */
export function apply(ctx: PanelClientContext): () => void {
  injectPanelStyles()
  const disposeLocale = ctx.locale.register(NS, { zh, en })
  const t = ctx.locale.bind(NS)

  let state: PanelSnapshotState = { status: 'loading' }
  const listeners = new Set<() => void>()
  const source = {
    getSnapshot: (): PanelSnapshotState => state,
    subscribe: (listener: () => void): (() => void) => {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
  }
  const publish = (next: PanelSnapshotState): void => {
    state = next
    for (const listener of listeners) listener()
  }
  const refresh = (): void => {
    // 网关 unary 载荷形状:{ args: <命名参数对象> }(无参端点传空对象;数组形态会被
    // gateway/internal 拒绝——"exactly one plain-object args field")。
    ctx.connection.rpc.call('/api', SNAPSHOT_ENDPOINT, { args: {} }).then((result) => {
      if (result.ok && typeof result.value === 'object' && result.value !== null) {
        publish({ status: 'ready', snapshot: result.value as BasisPanelSnapshot })
      } else {
        const message = result.error?.message ?? result.error?.code ?? 'unknown'
        publish({ status: 'error', message })
      }
    }).catch((error: unknown) => {
      publish({ status: 'error', message: error instanceof Error ? error.message : String(error) })
    })
  }
  refresh()

  ctx.slots.inject('main', () => ctx.slots.register({
    name: 'main',
    key: PANEL_ID,
    locale: NS,
    inject: () => ({
      hooks: { snapshot: source },
      refresh,
      t,
    }),
  }, PanelPage))
  // 对话框一键触发条(官方席位 conversation.composer.dock:composer 卡下方
  // 常驻条目,session 作用域)。官方 SessionStandardProps 注入 inputActions
  // (setDraft/submit = 用户按 Enter 的同一条路径,R3 照常走审批)。
  ctx.slots.inject('conversation.composer.dock', () => ctx.slots.register({
    name: 'conversation.composer.dock',
    key: PANEL_ID,
    locale: NS,
  }, ComposerChips))
  ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({
    name: 'sidebar.panellist',
    id: PANEL_ID,
    order: 20,
    locale: NS,
    label: () => t('panel'),
  }, PanelIcon))
  return disposeLocale
}
