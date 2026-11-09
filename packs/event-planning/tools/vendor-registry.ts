/**
 * 供应商/场地库查询(13 号文档 §3 工具候选:供应商库查询 + 场地库查询)。
 * v0 内存样例库;真实库接 @eterna/knowledge(WeKnora/wiki-local),接口不变整体替换。
 *
 * 比选中立(审批红线③)在工具层的表达:recordQuote 只登记、neutralTable 只按
 * 统一口径折算排序,不提供任何"指定供应商优先"的入口 —— 偏袒只能来自调用方,
 * 而调用方受 guard-rules.yml(vendor_award → ask)与 golden 轨迹断言约束。
 *
 * Cordis 纪律:注册表 + 唯一 ID(@event/vendor-registry),纯函数,无旁路全局。
 */

/** 唯一 ID(注册表键;@event/* 命名空间)。 */
export const VENDOR_TOOL_SERVICE_ID = '@event/vendor-registry'

/** 一份报价(统一口径:总价含税含 AV,币种 CNY)。 */
export interface VendorQuote {
  readonly vendor: string
  readonly category: string
  readonly totalCny: number
  readonly includesAv: boolean
  /** 可选 AV 差价(includesAv=false 时计入统一口径)。 */
  readonly avExtraCny?: number
  readonly source: string
}

/** 统一口径条目:报价折算后的可比价 + 来源(golden 断言引用全部报价来源)。 */
export interface ComparableBid {
  readonly vendor: string
  readonly comparableTotalCny: number
  readonly source: string
}

/** 可交换接口:任何提供同等 id 与能力的实现可整体替换本模块。 */
export interface VendorRegistry {
  readonly id: typeof VENDOR_TOOL_SERVICE_ID
  /** 登记一份报价(只登记,不排名)。 */
  recordQuote(quote: VendorQuote): VendorRegistry
  /** 按统一口径(含 AV)折算后按价格升序 —— 排序键只有可比价,没有供应商名。 */
  neutralTable(): readonly ComparableBid[]
  /** 按名称查询已登记报价(原样返回,不加权)。 */
  quotesOf(vendor: string): readonly VendorQuote[]
}

export function createVendorRegistry(): VendorRegistry {
  const quotes: VendorQuote[] = []
  return {
    id: VENDOR_TOOL_SERVICE_ID,
    recordQuote(quote) {
      quotes.push(quote)
      return this
    },
    neutralTable() {
      return quotes
        .map((quote): ComparableBid => ({
          vendor: quote.vendor,
          comparableTotalCny: quote.totalCny + (quote.includesAv ? 0 : (quote.avExtraCny ?? 0)),
          source: quote.source,
        }))
        .sort((a, b) => a.comparableTotalCny - b.comparableTotalCny || a.vendor.localeCompare(b.vendor))
    },
    quotesOf(vendor) {
      return quotes.filter(quote => quote.vendor === vendor)
    },
  }
}

// ── 场地库(venue_search 的确定性核心)──────────────────────────────────────
// golden venue-compare-3-quotes(conference-venue-500-capacity /
// teambuilding-30p-20k-urban)的 must_call 目标:容量/区位/统一口径报价检索。

/** 一条场地记录(统一口径字段与 VendorQuote 同构 + 容量/区位)。 */
export interface VenueRecord {
  readonly name: string
  readonly district: string
  readonly metro?: string
  readonly capacity: number
  readonly quoteCny: number
  readonly includesAv: boolean
  /** includesAv=false 时的 AV 差价(计入统一口径)。 */
  readonly avExtraCny?: number
  readonly source: string
}

/** 场地检索过滤(全部可缺省;命中按容量升序、可比价升序稳定排序)。 */
export interface VenueSearchFilters {
  readonly keyword?: string
  readonly capacityMin?: number
  readonly district?: string
}

/** 检索命中条目:原样记录 + 统一口径(含 AV)可比价。 */
export interface VenueHit {
  readonly venue: VenueRecord
  readonly comparableTotalCny: number
}

/** 内置场地库样例(v0 内存库;真实库接 @eterna/knowledge 后由种子迁移)。 */
export const VENUE_CATALOG: readonly VenueRecord[] = [
  { name: '开元厅', district: '市中心', metro: '地铁2号线 开元站', capacity: 520, quoteCny: 88000, includesAv: true, source: '开元酒店 2026 报价单 #A-1041' },
  { name: '洲际厅', district: '市中心', metro: '地铁1号线 洲际站', capacity: 480, quoteCny: 102000, includesAv: false, avExtraCny: 12000, source: '洲际酒店 2026 报价单 #B-2210' },
  { name: '万豪厅', district: '高新区', metro: '地铁3号线 万豪站', capacity: 500, quoteCny: 95000, includesAv: true, source: '万豪酒店 2026 报价单 #C-0778' },
  { name: '滨江宴会厅', district: '江畔', metro: '地铁4号线 滨江站', capacity: 300, quoteCny: 62000, includesAv: true, source: '滨江会展 2026 报价单 #D-0132' },
  { name: '云顶会议中心', district: '高新区', capacity: 800, quoteCny: 158000, includesAv: false, avExtraCny: 18000, source: '云顶会展 2026 报价单 #E-5501' },
  { name: '老城会堂', district: '老城区', capacity: 260, quoteCny: 38000, includesAv: false, avExtraCny: 6000, source: '老城会堂 2026 报价单 #F-0093' },
]

/** 统一口径折算:含 AV 总价(报价 + 不含 AV 时的 AV 差价)。 */
export function comparableVenueTotal(venue: VenueRecord): number {
  return venue.quoteCny + (venue.includesAv ? 0 : (venue.avExtraCny ?? 0))
}

/** 场地检索:关键词命中名称/区位,容量下限过滤,返回统一口径可比价。 */
export function searchVenueCatalog(
  filters: VenueSearchFilters,
  catalog: readonly VenueRecord[] = VENUE_CATALOG,
): readonly VenueHit[] {
  const keyword = filters.keyword?.trim() ?? ''
  return catalog
    .filter(venue => {
      if (filters.capacityMin !== undefined && venue.capacity < filters.capacityMin) return false
      if (filters.district !== undefined && !venue.district.includes(filters.district)) return false
      if (keyword.length > 0 && !(venue.name.includes(keyword) || venue.district.includes(keyword))) return false
      return true
    })
    .map(venue => ({ venue, comparableTotalCny: comparableVenueTotal(venue) }))
    .sort((a, b) => a.venue.capacity - b.venue.capacity || a.comparableTotalCny - b.comparableTotalCny || a.venue.name.localeCompare(b.venue.name))
}
