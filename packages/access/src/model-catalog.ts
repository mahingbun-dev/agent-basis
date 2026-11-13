/**
 * 模型目录能力标签富化(2026-11-13,模型能力 tag 对齐 ZCode 参考样式):
 * - 上游 sessionController.modelCatalog 的 serialized 模型本就带 badge
 *   {text: LocalizedText, tone}(dsh session-controller types.ts ModelCatalogModel),
 *   但只有官方 listing 适配器会打;本部署唯一承载 llm-pi-ai 从不打 badge——
 *   能力真值在其配置行:模型行 `input` / 路由级 `defaultInput`(modality 词表仅
 *   `text|image`,pi-ai catalog.ts MODALITY_GATE),设置页「输入类型〔视觉〕」即前者。
 * - 本模块从 configEditor 行清单提取「视觉」索引,再不可变富化 catalog 响应:
 *   只补缺(不动 provider 自带 badge)、不动 failures/default/routableProviders;
 *   索引缺席/配置缺席=纯透传退化,不炸宿主。
 * - 消费方:tenant.ts /api/session/modelCatalog 专路(守卫语义与通用循环一致);
 *   客户端渲染面 model-menu.tsx + 上游 ui-model-selection(触发器/菜单同 RPC 自动亮)。
 */

/** llm-pi-ai 承载行 id(llm-doctor PI_AI_ENTRY_ID 同值;access 不依赖该包,防漂移注释)。 */
const PI_AI_ENTRY_ID = 'llm-pi-ai'

/** 上游 LlmModelBadge 同构(text 键对齐内置 locale 'zh'|'en',locale-settings.ts LOCALE_IDS)。 */
export interface CatalogBadge {
  readonly text: string | { readonly en: string; readonly [locale: string]: string }
  readonly tone: 'neutral' | 'info' | 'success' | 'warning'
}

/** 视觉 badge 常量(neutral=ZCode 参考图的灰 chip 语义)。 */
export const VISION_BADGE: CatalogBadge = { text: { en: 'Vision', zh: '视觉' }, tone: 'neutral' }

/** catalog 值形状(tenant 富化面的结构子集;字段均 defensive 可选)。 */
export interface CatalogModelShape {
  readonly id?: unknown
  readonly badge?: unknown
}
export interface CatalogGroupShape {
  readonly id?: unknown
  readonly models?: unknown
}
export interface CatalogValueShape {
  readonly groups?: unknown
}

/** configEditor 行形状(readRows 同款防御:数组或 {entries},行={entry,override})。 */
interface ConfigEditorRowShape {
  readonly entry?: { readonly options?: { readonly id?: unknown } }
  readonly override?: unknown
}

/** pi-ai 路由配置能力面形状(结构子集)。 */
interface PiAiRouteShape {
  readonly models?: unknown
  readonly modelOverrides?: unknown
  readonly defaultInput?: unknown
}

/** 行清单防御展开(llm-doctor readRows 同款;只取本模块需要的字段)。 */
function readConfigurationRows(configuration: unknown): readonly ConfigEditorRowShape[] {
  const list = Array.isArray(configuration)
    ? configuration
    : (configuration as { entries?: unknown } | null | undefined)?.entries
  if (!Array.isArray(list)) return []
  return list as readonly unknown[] as readonly ConfigEditorRowShape[]
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * 单个 input 声明的视觉判定:`['…','image',…]` → true;非空数组无 image → false
 * (显式声明了能力,就是不能看);空数组/缺席/畸形 → undefined(未知=「继承目录」
 * 语义,access 读不到 pi-ai 内置目录,不打标不编造)。
 */
function modalityVision(input: unknown): boolean | undefined {
  if (!Array.isArray(input) || input.length === 0) return undefined
  return input.includes('image')
}

function visionIdsOfRoute(route: PiAiRouteShape): Set<string> {
  const defaultVision = modalityVision(route.defaultInput)
  const ids = new Set<string>()
  // modelOverrides 先、models 行后:同 id 双声明时 models 行(整目录替换面)胜出。
  if (isRecord(route.modelOverrides)) {
    for (const [id, override] of Object.entries(route.modelOverrides)) {
      if (modalityVision(isRecord(override) ? override.input : undefined) ?? defaultVision) ids.add(id)
    }
  }
  if (Array.isArray(route.models)) {
    for (const model of route.models) {
      if (!isRecord(model) || typeof model.id !== 'string') continue
      if (modalityVision(model.input) ?? defaultVision) ids.add(model.id)
    }
  }
  return ids
}

/**
 * 从 configEditor `configuration()` 行清单提取「视觉」模型索引。
 * @returns Map<pi-ai 路由 key, Set<视觉模型 id>>;无声明/无承载行时为空 Map。
 */
export function visionIndexFromConfigEditor(configuration: unknown): Map<string, Set<string>> {
  const index = new Map<string, Set<string>>()
  for (const row of readConfigurationRows(configuration)) {
    const options = row.entry?.options
    if (!isRecord(options) || options.id !== PI_AI_ENTRY_ID) continue
    const override = row.override
    if (!isRecord(override) || !isRecord(override.providers)) continue
    for (const [routeKey, route] of Object.entries(override.providers)) {
      if (!isRecord(route)) continue
      const ids = visionIdsOfRoute(route)
      if (ids.size > 0) index.set(routeKey, ids)
    }
  }
  return index
}

/**
 * 不可变富化:groups[].models[] 命中索引且原无 badge 才附加视觉 badge。
 * 只浅拷贝被触路径(failures/default/routableProviders 与未触组引用原样),
 * 输入对象永不变异;catalog 缺 groups(畸形/上游契约漂移)原引用返回=纯透传。
 * 「是否被触」用逐位引用比对判定(不用闭包写标志位:静态分析视 closure 内
 * 赋值不可达,oxlint no-unnecessary-condition 会误判恒 false)。
 */
export function enrichModelCatalog<T extends CatalogValueShape>(
  catalog: T,
  visionIndex: ReadonlyMap<string, ReadonlySet<string>>,
): T {
  if (!Array.isArray(catalog.groups) || visionIndex.size === 0) return catalog
  const sourceGroups = catalog.groups as readonly unknown[]
  const nextGroups = sourceGroups.map((group) => {
    if (!isRecord(group) || typeof group.id !== 'string' || !Array.isArray(group.models)) return group
    const ids = visionIndex.get(group.id)
    if (ids === undefined || ids.size === 0) return group
    const sourceModels = group.models as readonly unknown[]
    const nextModels = sourceModels.map((model) => {
      const hit = isRecord(model) && typeof model.id === 'string'
        && model.badge === undefined && ids.has(model.id)
      return hit ? { ...model, badge: VISION_BADGE } : model
    })
    const groupTouched = nextModels.some((model, at) => model !== sourceModels[at])
    return groupTouched ? { ...group, models: nextModels } : group
  })
  const touched = nextGroups.some((group, at) => group !== sourceGroups[at])
  return touched ? { ...catalog, groups: nextGroups } : catalog
}
