const GUARD_TOOL_SERVICE_ID = "@event/guard-tool";
function createGuardTool() {
  return {
    id: GUARD_TOOL_SERVICE_ID,
    checkExternalSend(input) {
      assertNonEmpty("send_email: recipients", input.recipients);
      assertNonEmptyStr("send_email: subject", input.subject);
      return summary("send_email", "R2", [
        "\u786E\u8BA4\u6536\u4EF6\u4EBA\u4E0E\u6284\u9001\u8303\u56F4(\u5BF9\u5916\u53E3\u5F84\u552F\u4E00)",
        "\u786E\u8BA4\u6B63\u6587\u4E0D\u542B\u672A\u5BA1\u6279\u7684\u4EF7\u683C/\u627F\u8BFA",
        "\u53D1\u9001\u540E\u5F52\u6863\u5230\u9879\u76EE\u8BB0\u5F55"
      ], "\u7ECF\u5BA1\u6279\u540E\u7531\u6267\u884C\u4FA7\u53D1\u9001;agent \u4E0D\u76F4\u63A5\u5916\u53D1\u90AE\u4EF6\u3002", { recipients: input.recipients, subject: input.subject, channel: input.channel ?? "email" });
    },
    checkMoneyTransfer(input) {
      assertNonEmptyStr("transfer_money: payee", input.payee);
      assertPositive("transfer_money: amountCny", input.amountCny);
      return summary("transfer_money", "R3", [
        "\u6536\u6B3E\u65B9\u8D26\u6237\u53CC\u4EBA\u6838\u5BF9(\u6237\u540D/\u8D26\u53F7/\u5F00\u6237\u884C)",
        "\u91D1\u989D\u4E0E\u5408\u540C/\u5BA1\u6279\u5355\u4E00\u81F4",
        "\u4ED8\u6B3E\u51ED\u8BC1\u5F52\u6863"
      ], "\u8D44\u91D1\u52A8\u4F5C\u4E00\u5F8B\u7531\u8D22\u52A1\u6267\u884C;agent \u4E0D\u5F97\u4EE3\u4ED8(\u5BA1\u6279\u7EA2\u7EBF\u2461)\u3002", { payee: input.payee, amountCny: input.amountCny, channel: input.channel ?? "corporate" });
    },
    checkContractSign(input) {
      assertNonEmptyStr("sign_contract: counterparty", input.counterparty);
      assertPositive("sign_contract: amountCny", input.amountCny);
      return summary("sign_contract", "R3", [
        "\u5408\u540C\u6761\u6B3E\u4E0E\u6BD4\u9009/\u5BA1\u6279\u7ED3\u8BBA\u4E00\u81F4",
        "\u7528\u5370\u6743\u9650\u4E0E\u6388\u6743\u59D4\u6258\u9F50\u5168",
        "\u7B7E\u7F72\u7248\u5F52\u6863\u5E76\u540C\u6B65\u53F0\u8D26"
      ], "\u5408\u540C\u7B7E\u7F72\u7531\u6388\u6743\u7B7E\u5B57\u4EBA\u6267\u884C;agent \u4E0D\u5F97\u4EE3\u7B7E(\u5BA1\u6279\u7EA2\u7EBF\u2461)\u3002", { counterparty: input.counterparty, amountCny: input.amountCny, summary: input.summary ?? "" });
    },
    checkVendorAward(input) {
      assertNonEmptyStr("vendor_award: vendor", input.vendor);
      assertNonEmptyStr("vendor_award: category", input.category);
      const quotes = input.quotesCompared ?? 0;
      if (quotes < 3) {
        throw new Error("vendor_award: \u5B9A\u6807\u524D\u5FC5\u987B\u5B8C\u6210\u81F3\u5C11\u4E09\u5BB6\u6BD4\u9009(quotesCompared \u2265 3,\u7EDF\u4E00\u53E3\u5F84\u6298\u7B97)");
      }
      return summary("vendor_award", "R3", [
        "\u4E09\u5BB6\u5168\u5217\u3001\u7EDF\u4E00\u53E3\u5F84\u6298\u7B97\u540E\u518D\u6BD4",
        "\u63A8\u8350\u7406\u7531\u4E0D\u542B\u5BF9\u672A\u4E2D\u6807\u65B9\u7684\u8D2C\u635F\u8868\u8FF0",
        "\u5168\u90E8\u62A5\u4EF7\u6765\u6E90\u53EF\u8FFD\u6EAF"
      ], "\u5B9A\u6807\u987B\u5BA1\u6279\u7559\u75D5\u540E\u7531\u91C7\u8D2D\u8D1F\u8D23\u4EBA\u6388\u6807;agent \u4FDD\u6301\u6BD4\u9009\u4E2D\u7ACB(\u5BA1\u6279\u7EA2\u7EBF\u2462)\u3002", { vendor: input.vendor, category: input.category, quotesCompared: quotes });
    }
  };
}
function summary(tool, riskLevel, checklist, handoff, inputsEcho) {
  return { ok: true, tool, riskLevel, agentMayExecute: false, requiresApproval: true, checklist, handoff, inputsEcho };
}
function assertNonEmptyStr(name, value) {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${name} \u4E0D\u80FD\u4E3A\u7A7A`);
  }
}
function assertNonEmpty(name, value) {
  if (!Array.isArray(value) || value.length === 0 || value.some((item) => typeof item !== "string" || item.trim().length === 0)) {
    throw new Error(`${name} \u5FC5\u987B\u662F\u975E\u7A7A\u5B57\u7B26\u4E32\u6570\u7EC4`);
  }
}
function assertPositive(name, value) {
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`${name} \u5FC5\u987B\u662F\u6B63\u6570`);
  }
}
export {
  GUARD_TOOL_SERVICE_ID,
  createGuardTool
};
