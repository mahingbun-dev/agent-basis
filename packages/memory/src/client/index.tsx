/**
 * @eterna/memory 浏览器半边(M-M3 T12 前端四件的 ①③④):
 * - ① 设置分区「记忆」(settings.section;settings.tsx);
 * - ③ 域识别 chip(conversation.input.right;domain-chip.tsx,含画像纠正预填入口);
 * - ④ Sources 行(conversation.chat.turnTail + 会话事件累计器;sources.tsx,
 *   勘察 S3 结论主路径)。
 *
 * 装载形态与 @eterna/compaction 同配方:package.json 声明 dsh.client(platform: web),
 * scripts/build-client.mjs 产出 lib/client.js(window.__ModuleLoader__ 闭包工厂工件),
 * profile 宿主载具行(eterna-memory-client)把本包组进浏览器花名册;数据面
 * (eternaMemory/* SRC 端点)由宿主 eterna-memory-admin 行提供(admin-plugin.ts)。
 *
 * UI 纪律(AGENTS.md §2/§3):--et-* 语义令牌经 DSH 桥接跟随产品深浅主题,零
 * 字面色值(lint-ui-tokens);图标走 @eterna/ui/icons;文案全中文;合并保存+
 * 脏检查;禁用原生 confirm/alert。
 */
import { injectDesignTokens } from '@eterna/ui'
import { CSS as SETTINGS_CSS, MEMORY_SECTION_ID, MemorySettingsSection, NS, SETTINGS_LOCALES } from './settings.tsx'
import { CSS as DISTILL_CSS, DISTILL_LOCALES, MEMORY_DISTILL_TAB_ID, DistillReportSection } from './distill-report.tsx'
import { DomainChip } from './domain-chip.tsx'
import { MemorySourcesTail, memorySourcesDefinition, type MemorySourcesTailProps } from './sources.tsx'
import type { MemoryClientContext, TurnLocationLike } from './client-types.ts'
import { createIdempotentSlotContribution } from './contribution.ts'

export { MEMORY_SECTION_ID, NS }
export {
  isMemoryPolicyDirty, isDistillDirty, MEMORY_STATE_ENDPOINT, MEMORY_UPDATE_ENDPOINT,
  MEMORY_DISTILL_VIEW_ENDPOINT, MEMORY_DISTILL_SET_PARTICIPATE_ENDPOINT,
  MEMORY_POLICY_TIERS, resolvePolicyTier, SETTINGS_LOCALES,
} from './settings.tsx'
export type { MemoryConfigView, MemoryPolicyFormState, MemoryStateView, MemoryDistillViewData } from './settings.tsx'
export {
  MEMORY_DISTILL_TAB_ID, MEMORY_DISTILL_REPORT_ENDPOINT, MEMORY_DISTILL_ENABLE_ENDPOINT,
  MEMORY_DISTILL_RUN_ENDPOINT, MEMORY_DISTILL_CANDIDATES_ENDPOINT,
  MEMORY_DISTILL_RELEASE_ENDPOINT, MEMORY_DISTILL_REJECT_ENDPOINT,
} from './distill-report.tsx'
export type {
  DistillCandidateGateView, DistillCandidateMetaView, DistillClusterView, DistillLocaleKey, DistillReportView,
} from './distill-report.tsx'
export { DomainChip, domainChipLabel, registeredDomainsOf } from './domain-chip.tsx'
export {
  memorySourcesBuildLocationData, memorySourcesDefinition, memorySourcesMatch,
  memorySourcesStart, memorySourcesUpdate, selectMemorySources, sourcesFromMeta,
  MEMORY_SOURCES_DATA_KEY, MEMORY_SOURCE_TOOLS,
} from './sources.tsx'
export type { MemorySourceEntry, MemorySourcesState, MemorySourcesTurnData } from './sources.tsx'
export {
  clearCorrectionPrefill, isMemoryCorrectionPrefill, MEMORY_CORRECTION_BRIDGE_KEY,
  MEMORY_CORRECTION_EVENT, setCorrectionPrefill, takeCorrectionPrefill,
} from './correction.ts'
export type { MemoryCorrectionPrefill } from './correction.ts'
export { MEMORY_DOMAINS_ENDPOINT, MEMORY_SELECT_DOMAIN_ENDPOINT, MEMORY_SESSION_DOMAIN_ENDPOINT } from './endpoints.ts'

/**
 * 运行时依赖服务表(DSH bundle loader 读取;与 package.json dsh.client.inject 同真值):
 * slots/locale/connection 三件套 + layout(Sources 行「跳转面板」)+
 * uiConversation(Conversation 事件累计器注册)。
 */
export const inject = ['slots', 'locale', 'connection', 'layout', 'uiConversation']

/** en 界面降级口径(键名原样;compaction 设置分区同款,产品中文优先)。 */
const ALL_LOCALES = { ...SETTINGS_LOCALES, ...DISTILL_LOCALES }
const en = Object.fromEntries(Object.keys(ALL_LOCALES).map(key => [key, key])) as Record<string, string>

/** 会话内两件(域 chip / Sources 行)样式;设置分区样式随 SETTINGS_CSS 一并注入。 */
export const CHIP_CSS = `
[data-eterna-memory='domain-chip'] { position: relative; display: inline-flex; align-items: center; gap: 4px; max-width: 100%; font-family: var(--et-font-body); font-size: var(--et-text-meta); color: var(--et-fg-2); }
[data-eterna-memory='domain-chip'] button { display: inline-flex; align-items: center; gap: 4px; max-width: 100%; min-width: 0; padding: 3px 8px; border: 1px solid var(--et-border); border-radius: var(--et-radius-sm); background: var(--et-surface); color: var(--et-fg-2); font: inherit; cursor: pointer; }
[data-eterna-memory='domain-chip'] button:focus-visible { outline: 2px solid var(--et-accent); outline-offset: 1px; }
[data-eterna-memory='domain-chip'] button:disabled { opacity: 0.55; cursor: not-allowed; }
[data-eterna-memory='domain-chip'] button:hover:not(:disabled) { border-color: var(--et-fg-2); }
[data-eterna-memory='domain-label'],
[data-eterna-memory='correction-label'] { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
[data-eterna-memory='correction-chip'] { border-style: dashed; }
[data-eterna-memory='domain-menu'] { position: absolute; top: calc(100% + 4px); right: 0; z-index: 30; display: grid; min-width: 160px; padding: 4px; gap: 2px; border: 1px solid var(--et-border); border-radius: var(--et-radius-sm); background: var(--et-surface); box-shadow: var(--et-shadow-raised); }
[data-eterna-memory='domain-menu'] button { justify-content: flex-start; border: 0; background: none; }
[data-eterna-memory='domain-menu'] button:hover:not(:disabled) { background: var(--et-surface-2); }
[data-eterna-memory='sources-row'] { margin: var(--et-space-2) 0; font-family: var(--et-font-body); font-size: var(--et-text-meta); color: var(--et-muted); }
[data-eterna-memory='sources-toggle'] { display: inline-flex; align-items: center; gap: 4px; padding: 2px 6px; border: 0; background: none; color: var(--et-muted); font: inherit; cursor: pointer; }
[data-eterna-memory='sources-toggle']:focus-visible { outline: 2px solid var(--et-accent); outline-offset: 1px; }
[data-eterna-memory='sources-toggle']:hover { color: var(--et-fg-2); }
[data-eterna-memory='sources-count'] { font-weight: var(--et-weight-display); color: var(--et-fg-2); font-variant-numeric: tabular-nums; }
[data-eterna-memory='sources-list'] { margin: 4px 0 0; padding: 0 0 0 18px; display: grid; gap: 2px; list-style: none; }
[data-eterna-memory='sources-title'] { color: var(--et-fg-2); font-weight: var(--et-weight-display); margin-right: 6px; }
[data-eterna-memory='sources-jump'] { display: inline-flex; align-items: center; gap: 4px; padding: 2px 0; border: 0; background: none; color: var(--et-accent); font: inherit; cursor: pointer; }
[data-eterna-memory='sources-jump']:focus-visible { outline: 2px solid var(--et-accent); outline-offset: 1px; }
`

function injectMemoryStyles(doc: Document = document): void {
  injectDesignTokens({ bridge: true, doc })
  if (doc.getElementById('eterna-memory-styles') !== null) return
  const style = doc.createElement('style')
  style.id = 'eterna-memory-styles'
  style.textContent = `${SETTINGS_CSS}\n${DISTILL_CSS}\n${CHIP_CSS}`
  doc.head.append(style)
}

/** 基座面板 main 键(key 与 @eterna/panel 的 PANEL_ID 字面契约)。 */
const PANEL_MAIN_KEY = 'eterna-panel'

/** turnTail 条目组件:官方 owner(inject 面)摊平成 sources.tsx 的 props 形状。 */
function MemorySourcesTailEntry(props: MemorySourcesTailEntryProps): React.JSX.Element | null {
  const tailProps: MemorySourcesTailProps = {
    turn: props.turn,
    ...(props.t !== undefined ? { t: props.t } : {}),
    ...(props.openPanel !== undefined ? { openPanel: props.openPanel } : {}),
  }
  return MemorySourcesTail(tailProps)
}

interface MemorySourcesTailEntryProps {
  /** 官方 owner:TurnTailOwnerProps(turn/seq/openFile;本地结构面)。 */
  readonly turn: TurnLocationLike
  readonly t?: (key: string) => string
  readonly openPanel?: () => void
}

/**
 * 浏览器插件体:注册字典与三个 slot 贡献,并注册会话事件累计器。
 * @param ctx - 浏览器插件上下文。
 * @returns 撤销字典注册的 disposer(slot 贡献随插件 fiber 自撤)。
 */
export function apply(ctx: MemoryClientContext): () => void {
  injectMemoryStyles()
  const disposeLocale = ctx.locale.register(NS, { zh: { ...ALL_LOCALES }, en })
  const t = ctx.locale.bind(NS)
  // ① 设置分区「记忆」(管理员专用文案由 state 端点鉴权视图反馈;蒸馏参与
  // 字段登录即可——Q4 opt-out 全员可见,见 settings.tsx)。
  ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section',
    id: MEMORY_SECTION_ID,
    order: 45,
    locale: NS,
    inject: () => ({ t, connection: ctx.connection }),
    label: () => t('section'),
  }, MemorySettingsSection))
  // ⑤ 全局蒸馏报告页(plugins.tab,18 §10「admin 报告页」;非 admin 由端点
  // 403 反馈显示无权文案,settings.section 同款降级)。
  ctx.slots.inject('plugins.tab', () => ctx.slots.register({
    name: 'plugins.tab',
    id: MEMORY_DISTILL_TAB_ID,
    order: 46,
    locale: NS,
    inject: () => ({ t, connection: ctx.connection }),
    label: () => t('distillTab'),
  }, DistillReportSection))
  // ③ 域识别 chip(会话输入行右侧;session 作用域,声明坍塌即随链路撤销)。
  ctx.slots.inject('conversation.input.right', () => ctx.slots.register({
    name: 'conversation.input.right',
    id: 'eterna-memory.domain-chip',
    locale: NS,
    inject: () => ({ t, connection: ctx.connection }),
  }, DomainChip))
  // ④ Sources 行数据面:会话事件累计器(turn 归并 memory_read/memory_search 命中)。
  ctx.uiConversation.events.register(memorySourcesDefinition)
  // ④ Sources 行呈现:turnTail 槽位(completed Turn 动作行前;无数据不挂载)。
  // 2026-11-16 取证(隔离容器,localStorage 硬探针 + React fiber 反查):Definition
  // 数据面全链路通——match/累计/Location 发布正常,owner.turn.data.get('memory-sources')
  // 返回命中条目;但 slots 条目注册对会话作用域 slot 未生效(turnTail 锚内只有
  // compaction 同形注册的条目,M-C4;我方缺席且延时重挂无效)。属宿主 slots 会话
  // 作用域条目合并的版本行为(chat rc.1),非本包可修;升版后本注册零改动生效。
  // 双挂载(立即+延时一拍)保留:对 slot 声明面晚就绪的宿主形态是真实兼容;
  // 2026-11-18:两条路径各跑一次 contribute → 第二次登记抛重复 id 的未捕获异常
  // (每次加载一条 pageerror),改用幂等贡献工厂,只登记一次。
  const contributeSourcesEntry = createIdempotentSlotContribution(
    ctx.slots.register.bind(ctx.slots),
    {
      name: 'conversation.chat.turnTail',
      id: 'eterna-memory.sources',
      locale: NS,
      inject: () => ({
        t,
        openPanel: (): void => { ctx.layout.selectMainPanel(PANEL_MAIN_KEY) },
      }),
    },
    MemorySourcesTailEntry,
  )
  const registerSourcesEntry = (): void => {
    ctx.slots.inject('conversation.chat.turnTail', contributeSourcesEntry)
  }
  registerSourcesEntry()
  // 延时一拍(微任务链排空后的宏任务边界):vm 沙箱无 setTimeout,走 window 保证
  // 浏览器/vm 两态都有定义;不可用(极端环境)静默跳过——双挂载是兼容面不是硬依赖。
  if (typeof window !== 'undefined' && typeof window.setTimeout === 'function') {
    window.setTimeout(registerSourcesEntry, 0)
  }
  return disposeLocale
}
