/**
 * 浏览器半边的本地结构类型:只声明本插件消费的服务面(slots / sidebarRightTabs)。
 * 与 dsh 客户端壳的运行时形状鸭子一致,构建期不依赖跨包类型
 * (@eterna/panel / @eterna/adviser 同款纪律)。
 */
import type { ReactNode } from 'react'

/** 导引页入口卡片(右栏导引里「评测」的入口)。 */
export interface TabGuideEntry {
  readonly id: string
  readonly order: number
  readonly title: () => string
  readonly description?: () => string
  readonly icon?: unknown
}

/** tab 类型注册选项(sidebarRightTabs.register 的消费面). */
export interface TabTypeDefinition {
  /** 本实现在 tab 系统中的身份,全局唯一(包名为自然值). */
  readonly id: string
  /** tab 种类(本类型打开的页面 kind). */
  readonly kind: string
  /** 地址 glob(页面型可省略,按 kind 打开). */
  readonly patterns?: readonly string[]
  readonly priority?: 'extension' | 'builtin' | 'fallback'
  readonly canOpen?: (address: string) => boolean
  readonly title: (address: string) => string
  readonly keepMounted?: boolean
  readonly multiple?: boolean
  readonly guide?: readonly TabGuideEntry[]
}

/** tab 类型注册表消费面(ctx.sidebarRightTabs). */
export interface SidebarRightTabsFace {
  register(definition: TabTypeDefinition): () => void
}

/** 槽位注册选项(keyed 槽条目 / 设置分区条目公用). */
export interface SlotRegisterOptions {
  readonly name: string
  readonly key?: string
  readonly id?: string
  readonly order?: number
  readonly locale?: string
  /** 设置分区的左侧导航标题(settings.section 契约). */
  readonly label?: () => string
  readonly children?: Record<string, { readonly kind: 'single' | 'list' | 'keyed' | 'chain' | 'hoc'; readonly scope: 'root' | 'session-maybe' | 'session' }>
  readonly inject?: () => Record<string, unknown>
}

/** React 组件(结构面:可调用、接收 props). */
export type SlotComponent<P = never> = (props: P) => ReactNode

/** 槽位贡献 API(ctx.slots 的消费面). */
export interface SlotsFace {
  inject(name: string, contribute: () => (() => void) | Generator<() => void>): () => void
  register(options: SlotRegisterOptions, component: SlotComponent): () => void
}

/** 浏览器插件上下文(本插件消费的服务子集). */
export interface SessionEvalClientContext {
  readonly slots: SlotsFace
  readonly sidebarRightTabs: SidebarRightTabsFace
}
