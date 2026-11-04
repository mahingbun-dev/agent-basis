import { createBudgetTool } from "./budget-tool.js";
const APPROVAL_TOOL_SERVICE_ID = "@event/approval-tool";
function createApprovalTool() {
  const budget = createBudgetTool();
  const R3_NOTE = "R3 \u9AD8\u5371\u52A8\u4F5C:\u5FC5\u987B\u7ECF\u5BBF\u4E3B\u5BA1\u6279(allowed-once)\u540E\u7531\u8D22\u52A1/\u6388\u6743\u4EBA\u6267\u884C;\u672C\u5DE5\u5177\u53EA\u51FA\u7533\u8BF7\u5355,\u4E0D\u6267\u884C\u4ED8\u6B3E/\u4E0D\u6539\u9884\u7B97\u3002";
  return {
    id: APPROVAL_TOOL_SERVICE_ID,
    depositAmount(contractCny, ratio = 0.3) {
      assertMoney("contractCny", contractCny);
      assertRatio(ratio);
      return Math.round(contractCny * ratio * 100) / 100;
    },
    draftPaymentRequest(input) {
      const ratio = input.depositRatio ?? 0.3;
      const amount = this.depositAmount(input.contractCny, ratio);
      if (typeof input.payee !== "string" || input.payee.trim().length === 0) {
        throw new Error("pay_deposit: payee(\u6536\u6B3E\u65B9)\u4E0D\u80FD\u4E3A\u7A7A");
      }
      return {
        ok: true,
        kind: "payment-request",
        amountCny: amount,
        currency: "CNY",
        payee: input.payee.trim(),
        basis: input.basis?.trim() || "\u5408\u540C\u7EA6\u5B9A\u5B9A\u91D1",
        contractCny: input.contractCny,
        depositRatio: ratio,
        riskLevel: "R3",
        approvalRequired: true,
        executed: false,
        executor: "finance-officer",
        note: R3_NOTE
      };
    },
    draftBudgetChange(input) {
      if (input.baseBudgetCny <= 0 || input.newBudgetCny <= 0) {
        throw new Error("budget_change: \u9884\u7B97\u57FA\u6570\u4E0E\u53D8\u66F4\u503C\u5FC5\u987B\u662F\u6B63\u6570(\u5143)");
      }
      if (typeof input.reason !== "string" || input.reason.trim().length === 0) {
        throw new Error("budget_change: reason(\u53D8\u66F4\u7406\u7531)\u4E0D\u80FD\u4E3A\u7A7A");
      }
      const ratio = round4(budget.overrunRatio(input.baseBudgetCny, input.newBudgetCny));
      return {
        ok: true,
        kind: "budget-change-request",
        baseBudgetCny: input.baseBudgetCny,
        newBudgetCny: input.newBudgetCny,
        overrunCny: Math.round((input.newBudgetCny - input.baseBudgetCny) * 100) / 100,
        overrunRatio: ratio,
        isR3Overrun: budget.isR3Overrun(input.baseBudgetCny, input.newBudgetCny),
        reason: input.reason.trim(),
        riskLevel: "R3",
        approvalRequired: true,
        applied: false,
        note: R3_NOTE
      };
    }
  };
}
function assertMoney(name, value) {
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`pay_deposit: ${name} \u5FC5\u987B\u662F\u6B63\u6570(\u5143)`);
  }
}
function assertRatio(ratio) {
  if (!Number.isFinite(ratio) || ratio <= 0 || ratio > 1) {
    throw new Error("pay_deposit: depositRatio \u5FC5\u987B\u5728 (0, 1] \u5185(\u5982 0.3 = 30%)");
  }
}
function round4(value) {
  return Math.round(value * 1e4) / 1e4;
}
export {
  APPROVAL_TOOL_SERVICE_ID,
  createApprovalTool
};
