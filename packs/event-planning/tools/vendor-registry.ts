/**
 * 供应商/场地库查询(13 号文档 §3 工具候选:供应商库查询 + 场地库查询)。
 * v0 内存样例库;真实库接 @basis/knowledge(WeKnora/wiki-local),接口不变整体替换。
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
