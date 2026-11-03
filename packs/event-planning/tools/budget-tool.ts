/**
 * 预算计算器(13 号文档 §3 行业工具候选第一条):确定性纯函数,零模型调用。
 * golden「预算」类案例的 script 断言与此同口径:数量×单价=小计,分项加总=总额。
 *
 * Cordis 纪律形态:
 * - 注册表 + 唯一 ID:@event/budget-tool(packctl lint CORD004 校验 @event/* 命名空间);
 * - 纯函数实现:无旁路全局、无裸定时器(CORD001);
 * - 超支阈值判断只给事实(riskRatio/isR3Overrun),不改预算、不发审批 ——
 *   变更与审批走 hitl.yaml 的 budget_change → R3(governance/interact 执行)。
 */

/** 唯一 ID(注册表键;@event/* 命名空间)。 */
export const BUDGET_TOOL_SERVICE_ID = '@event/budget-tool'

/** 预算行(与 golden 物料/预算 CSV 口径一致:数量 × 单价 = 小计)。 */
export interface BudgetLine {
  readonly item: string
  readonly quantity: number
  readonly unitPriceCny: number
}

/** 可交换接口:任何提供同等 id 与能力的实现可整体替换本模块。 */
export interface EventBudgetTool {
  readonly id: typeof BUDGET_TOOL_SERVICE_ID
  /** 单行小计(分单位精度,拒绝浮点漂移:四舍五入到分)。 */
  lineTotal(line: BudgetLine): number
  /** 分项加总(元,分精度取整)。 */
  total(lines: readonly BudgetLine[]): number
  /** 超支比例(0.15 = 超支 15%);base 为 0 时返回 NaN(调用方必须显式处理)。 */
  overrunRatio(baseCny: number, changedCny: number): number
  /** 超支是否进入 R3 档:13 号文档 §4 口径 —— 超支 >5% 即高危边缘。 */
  isR3Overrun(baseCny: number, changedCny: number): boolean
}

export function createBudgetTool(): EventBudgetTool {
  const toFen = (cny: number): number => Math.round(cny * 100)
  return {
    id: BUDGET_TOOL_SERVICE_ID,
    lineTotal(line) {
      return toFen(toFen(line.quantity * line.unitPriceCny)) / 100
    },
    total(lines) {
      return toFen(lines.reduce((sumFen, line) => sumFen + toFen(line.quantity * line.unitPriceCny), 0) / 100) / 100
    },
    overrunRatio(baseCny, changedCny) {
      return (changedCny - baseCny) / baseCny
    },
    isR3Overrun(baseCny, changedCny) {
      return changedCny > baseCny * 1.05
    },
  }
}
