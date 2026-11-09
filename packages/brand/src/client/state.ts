/**
 * 浏览器半边本地结构类型(零跨包类型依赖;对齐 panel client-types 纪律)。
 */

/** 语言服务消费面(locale.register 同 NS 字典;覆写语义见 locales 注册时序)。 */
export interface LocaleFace {
  register(ns: string, dictionaries: Record<string, Record<string, string>>): () => void
  bind(ns: string): (key: string) => string
}

/** 槽位贡献 API(ctx.slots 消费面;panel 同款)。 */
export interface SlotsFace {
  inject(name: string, contribute: () => (() => void) | Generator<() => void>): () => void
  register(options: { name: string; inject?: () => Record<string, unknown> }, component: (props: never) => unknown): () => void
}

/** 浏览器插件上下文(本包消费面)。 */
export interface BrandClientContext {
  readonly locale?: LocaleFace
  readonly slots?: SlotsFace
}

/** 左上角组合显示名(格式=中文·英文,用户 2026-11-09 指定)。 */
export const BRAND_DISPLAY = '恒灵·EternaAgent'

/** 品牌常量(替换 DeepSeek Harness 的全部 UI 面;中文名恒灵,英文名 EternaAgent,用户 2026-11-09 定名——
 * 突出企业永恒基因(恒)与 Agent 智能体特质(灵);两轮侵权检索:EternaAgent 铸词全网零冲突,
 * 恒灵字号数家小公司无知名产品/无电力业重叠/无第 9 类在先商标)。 */
export const BRAND = {
  /** 中文名。 */
  zh: '恒灵',
  /** 英文名(tab 标题/about 用)。 */
  en: 'EternaAgent',
  /** 显示名(tab 标题/about 用)。 */
  full: 'EternaAgent',
  /** 左上角组合名(格式=中文·英文,用户 2026-11-09 指定)。 */
  display: '恒灵·EternaAgent',
  /** 被替换的上游产品名(document.title 硬编码来源:ui-layout productTitle)。 */
  upstream: 'DeepSeek Harness',
  /** 侧栏 badge 上游文案(locale 键 brand.localBuild 的内置值)。 */
  upstreamBadge: ['DSH 本地构建', 'DSH Local Build'],
  /** badge 替换文案。 */
  badge: { zh: '恒灵·EternaAgent', en: '恒灵·EternaAgent' },
} as const
