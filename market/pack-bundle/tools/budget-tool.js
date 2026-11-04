const BUDGET_TOOL_SERVICE_ID = "@event/budget-tool";
function createBudgetTool() {
  const toFen = (cny) => Math.round(cny * 100);
  return {
    id: BUDGET_TOOL_SERVICE_ID,
    lineTotal(line) {
      return toFen(line.quantity * line.unitPriceCny) / 100;
    },
    total(lines) {
      return toFen(lines.reduce((sumFen, line) => sumFen + toFen(line.quantity * line.unitPriceCny), 0) / 100) / 100;
    },
    overrunRatio(baseCny, changedCny) {
      return (changedCny - baseCny) / baseCny;
    },
    isR3Overrun(baseCny, changedCny) {
      return changedCny > baseCny * 1.05;
    }
  };
}
export {
  BUDGET_TOOL_SERVICE_ID,
  createBudgetTool
};
