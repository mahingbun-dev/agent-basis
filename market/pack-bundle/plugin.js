import { defineTool } from "@deepseek-ai/dsh-tools";
import {
  createBudgetTool,
  createVendorRegistry,
  searchVenueCatalog,
  createScheduleTool,
  createTemplateTool,
  createApprovalTool,
  createGuardTool
} from "./tools/index.js";
const EVENT_TOOLS_PLUGIN_NAME = "event-tools";
const OUTPUT = {
  schema: { type: "object", additionalProperties: true },
  render: (_args, value) => [{ type: "text", text: JSON.stringify(value, null, 2) }]
};
const ASK_REASONS = {
  budget_change: "R3 \u9884\u7B97\u53D8\u66F4:\u5FC5\u987B\u89E6\u53D1\u5BA1\u6279\u5E76\u7559\u75D5,\u9759\u9ED8\u901A\u8FC7\u5373\u5931\u8D25(\u8D85\u652F>5% \u9AD8\u5371\u8FB9\u7F18)\u3002",
  pay_deposit: "R3 \u5BF9\u5916\u4ED8\u6B3E:\u5FC5\u987B\u5347\u7EA7\u5BA1\u6279,\u5BA1\u6279\u901A\u8FC7\u540E\u7531\u8D22\u52A1\u6267\u884C;agent \u4E0D\u5F97\u4EE3\u4ED8\u3002",
  sign_contract: "R3 \u5408\u540C\u7B7E\u7F72:\u7528\u5370\u5F52\u6388\u6743\u7B7E\u5B57\u4EBA;agent \u4E0D\u5F97\u4EE3\u7B7E\u3002",
  transfer_money: "R3 \u8D44\u91D1\u5212\u8F6C:\u8D44\u91D1\u52A8\u4F5C\u4E00\u5F8B\u7531\u8D22\u52A1\u6267\u884C;agent \u4E0D\u5F97\u4EE3\u4ED8\u3002",
  vendor_award: "R3 \u4F9B\u5E94\u5546\u5B9A\u6807:\u5FC5\u987B\u4E09\u5BB6\u5168\u5217\u3001\u7EDF\u4E00\u53E3\u5F84\u5E76\u5BA1\u6279\u7559\u75D5\u3002",
  send_email: "R2 \u5BF9\u5916\u53D1\u9001:\u5148\u786E\u8BA4\u6536\u4EF6\u4EBA\u4E0E\u53E3\u5F84\u518D\u53D1;agent \u4E0D\u5F97\u64C5\u81EA\u5916\u53D1\u3002"
};
function defineEventTools() {
  const budget = createBudgetTool();
  const vendor = createVendorRegistry();
  const schedule = createScheduleTool();
  const template = createTemplateTool();
  const approval = createApprovalTool();
  const guard = createGuardTool();
  return [
    defineTool({
      name: "budget_calc",
      description: "\u9884\u7B97\u8BA1\u7B97\u5668(\u786E\u5B9A\u6027,\u96F6\u6A21\u578B\u8C03\u7528):\u5206\u9879 lines \u9010\u884C \u6570\u91CF\xD7\u5355\u4EF7=\u5C0F\u8BA1,\u52A0\u603B\u5F97\u603B\u989D;\u7ED9 baseBudgetCny \u65F6\u540C\u65F6\u7ED9\u8D85\u652F\u91D1\u989D/\u8D85\u652F\u767E\u5206\u6BD4/\u662F\u5426\u8D85 R3 \u7EBF(>5%)\u3002\u9884\u7B97\u7C7B\u4EA4\u4ED8(\u7B56\u5212\u6848\u5206\u9879\u9884\u7B97/\u7269\u6599\u6E05\u5355/\u6BD4\u9009\u6298\u7B97/\u53D8\u66F4\u6D4B\u7B97)\u5FC5\u987B\u7528\u5B83\u7B97,\u4E0D\u5F97\u5FC3\u7B97\u3002",
      parameters: {
        lines: {
          type: "array",
          description: "\u9884\u7B97\u5206\u9879(\u6570\u91CF \xD7 \u5355\u4EF7 = \u5C0F\u8BA1)",
          items: { type: "object", properties: { item: { type: "string", description: "\u5206\u9879\u540D" }, quantity: { type: "number", description: "\u6570\u91CF" }, unitPriceCny: { type: "number", description: "\u5355\u4EF7(\u5143)" } }, additionalProperties: false }
        },
        baseBudgetCny: { type: "number", description: "\u57FA\u51C6\u9884\u7B97(\u5143);\u63D0\u4F9B\u65F6\u8F93\u51FA\u8D85\u652F\u767E\u5206\u6BD4\u4E0E R3 \u5224\u5B9A" }
      },
      output: OUTPUT,
      isConcurrencySafe: () => true,
      async execute(argsRaw) {
        const args = argsRaw;
        if (!Array.isArray(args.lines) || args.lines.length === 0) throw new Error("budget_calc: lines \u5FC5\u987B\u662F\u975E\u7A7A\u6570\u7EC4");
        const lines = args.lines.map((line, index) => {
          if (typeof line.item !== "string" || line.item.trim().length === 0) throw new Error(`budget_calc: lines[${index}].item \u5FC5\u987B\u662F\u975E\u7A7A\u5B57\u7B26\u4E32`);
          if (!Number.isFinite(line.quantity) || line.quantity < 0) throw new Error(`budget_calc: lines[${index}].quantity \u5FC5\u987B\u662F\u975E\u8D1F\u6570\u5B57`);
          if (!Number.isFinite(line.unitPriceCny) || line.unitPriceCny < 0) throw new Error(`budget_calc: lines[${index}].unitPriceCny \u5FC5\u987B\u662F\u975E\u8D1F\u6570\u5B57`);
          return { item: line.item, quantity: line.quantity, unitPriceCny: line.unitPriceCny };
        });
        const base = args.baseBudgetCny;
        const total = budget.total(lines);
        const lineTotals = lines.map((line) => ({ item: line.item, quantity: line.quantity, unitPriceCny: line.unitPriceCny, subtotalCny: budget.lineTotal(line) }));
        if (base === void 0) return { ok: true, kind: "budget-breakdown", lineTotals, totalCny: total };
        if (!Number.isFinite(base) || base <= 0) throw new Error("budget_calc: baseBudgetCny \u5FC5\u987B\u662F\u6B63\u6570");
        const overrunRatio = Math.round(budget.overrunRatio(base, total) * 1e4) / 1e4;
        return {
          ok: true,
          kind: "budget-breakdown",
          lineTotals,
          totalCny: total,
          baseBudgetCny: base,
          overrunCny: Math.round((total - base) * 100) / 100,
          overrunRatio,
          isR3Overrun: budget.isR3Overrun(base, total),
          hint: "\u8D85\u652F>5% \u5C5E R3:\u4EFB\u4F55\u9884\u7B97\u53D8\u66F4\u5FC5\u987B\u8D70 budget_change \u89E6\u53D1\u5BA1\u6279,\u9759\u9ED8\u6539\u52A8=\u8FDD\u89C4\u3002"
        };
      }
    }),
    defineTool({
      name: "schedule_conflict_check",
      description: "\u6392\u671F\u51B2\u7A81\u68C0\u67E5(\u786E\u5B9A\u6027):\u5BF9\u5206\u949F\u6570\u65F6\u95F4\u7EBF(\u73AF\u8282,\u5F00\u59CB,\u7ED3\u675F)\u505A\u533A\u95F4\u5408\u6CD5\u6027\u3001\u91CD\u53E0\u68C0\u6D4B\u3001\u6D3B\u52A8\u65F6\u6BB5\u7A97\u53E3\u8D8A\u754C\u4E0E\u6392\u5E8F\u68C0\u67E5\u3002\u65F6\u95F4\u7EBF/runsheet \u4EA4\u4ED8\u524D\u5FC5\u987B\u7528\u5B83\u6821\u9A8C(\u73AF\u8282\u95F4\u4E0D\u5F97\u91CD\u53E0\u3001\u4E0D\u5F97\u8D85\u51FA\u65F6\u6BB5)\u3002",
      parameters: {
        segments: {
          type: "array",
          description: "\u73AF\u8282\u5217\u8868(\u5F53\u65E5\u5206\u949F\u6570,\u5982 14:00=840)",
          items: { type: "object", properties: { name: { type: "string", description: "\u73AF\u8282\u540D" }, startMinute: { type: "number", description: "\u5F00\u59CB(\u5F53\u65E5\u5206\u949F\u6570)" }, endMinute: { type: "number", description: "\u7ED3\u675F(\u5F53\u65E5\u5206\u949F\u6570)" }, owner: { type: "string", description: "\u8D1F\u8D23\u4EBA(\u53EF\u7F3A\u7701)" } }, additionalProperties: false }
        },
        windowStartMinute: { type: "number", description: "\u6D3B\u52A8\u65F6\u6BB5\u5F00\u59CB(\u5F53\u65E5\u5206\u949F\u6570;\u53EF\u7F3A\u7701)" },
        windowEndMinute: { type: "number", description: "\u6D3B\u52A8\u65F6\u6BB5\u7ED3\u675F(\u5F53\u65E5\u5206\u949F\u6570;\u53EF\u7F3A\u7701)" }
      },
      output: OUTPUT,
      isConcurrencySafe: () => true,
      async execute(argsRaw) {
        const args = argsRaw;
        if (!Array.isArray(args.segments) || args.segments.length === 0) throw new Error("schedule_conflict_check: segments \u5FC5\u987B\u662F\u975E\u7A7A\u6570\u7EC4");
        const segments = args.segments.map((seg, index) => {
          if (typeof seg.name !== "string" || seg.name.trim().length === 0) throw new Error(`schedule_conflict_check: segments[${index}].name \u5FC5\u987B\u662F\u975E\u7A7A\u5B57\u7B26\u4E32`);
          if (!Number.isInteger(seg.startMinute) || !Number.isInteger(seg.endMinute)) throw new Error(`schedule_conflict_check: segments[${index}] \u7684 startMinute/endMinute \u5FC5\u987B\u662F\u6574\u6570\u5206\u949F\u6570`);
          return typeof seg.owner === "string" && seg.owner.trim().length > 0 ? { name: seg.name, startMinute: seg.startMinute, endMinute: seg.endMinute, owner: seg.owner } : { name: seg.name, startMinute: seg.startMinute, endMinute: seg.endMinute };
        });
        const windowStart = args.windowStartMinute;
        const windowEnd = args.windowEndMinute;
        if (windowStart !== void 0 && !Number.isInteger(windowStart)) throw new Error("schedule_conflict_check: windowStartMinute \u5FC5\u987B\u662F\u6574\u6570");
        if (windowEnd !== void 0 && !Number.isInteger(windowEnd)) throw new Error("schedule_conflict_check: windowEndMinute \u5FC5\u987B\u662F\u6574\u6570");
        const result = schedule.check(segments, {
          ...windowStart !== void 0 ? { startMinute: windowStart } : {},
          ...windowEnd !== void 0 ? { endMinute: windowEnd } : {}
        });
        return {
          ok: result.ok,
          kind: "schedule-check",
          segmentCount: result.sortedSegments.length,
          sortedSegments: result.sortedSegments,
          invalid: result.invalid,
          overlaps: result.overlaps,
          outOfWindow: result.outOfWindow,
          hint: result.ok ? "\u65E0\u91CD\u53E0\u3001\u65E0\u8D8A\u754C:\u53EF\u6309 sortedSegments \u8F93\u51FA\u65F6\u95F4\u7EBF\u3002" : "\u5B58\u5728\u51B2\u7A81:\u5FC5\u987B\u5148\u6D88\u9664 invalid/overlaps/outOfWindow \u518D\u4EA4\u4ED8\u3002"
        };
      }
    }),
    defineTool({
      name: "template_search",
      description: "\u6A21\u677F\u5E93\u68C0\u7D22:\u6309\u5173\u952E\u8BCD\u67E5\u7B56\u5212\u6848/\u65F6\u95F4\u7EBF/\u7269\u6599/\u6BD4\u9009/\u53D8\u66F4\u7533\u8BF7\u7B49\u6A21\u677F\u9AA8\u67B6(title/category/keywords \u547D\u4E2D\u8BA1\u5206),\u8FD4\u56DE\u6A21\u677F\u7684\u4EA4\u4ED8\u7AE0\u8282(\u5982\u5A5A\u793C\u7B56\u5212\u6848\u56DB\u7AE0:\u5F53\u65E5\u6D41\u7A0B/\u5206\u9879\u9884\u7B97/\u5206\u5DE5/\u9884\u6848)\u3002\u51FA\u5B8C\u6574\u7B56\u5212\u6848\u524D\u5148\u68C0\u7D22\u6A21\u677F\u5BF9\u9F50\u7AE0\u8282\u7ED3\u6784\u3002",
      parameters: {
        query: { type: "string", required: true, description: '\u68C0\u7D22\u8BCD(\u7A7A\u683C\u5206\u8BCD,\u5982 "\u5A5A\u793C \u7B56\u5212\u6848")' },
        category: { type: "string", description: "\u7C7B\u76EE\u8FC7\u6EE4(\u5A5A\u793C/\u5E74\u4F1A/\u53D1\u5E03\u4F1A/\u4F1A\u8BAE/\u56E2\u5EFA/\u6BD4\u9009/\u5BA1\u6279)" },
        limit: { type: "number", description: "\u8FD4\u56DE\u6761\u6570\u4E0A\u9650(\u9ED8\u8BA4 5)" }
      },
      output: OUTPUT,
      isConcurrencySafe: () => true,
      async execute(argsRaw) {
        const args = argsRaw;
        if (typeof args.query !== "string" || args.query.trim().length === 0) throw new Error("template_search: query \u4E0D\u80FD\u4E3A\u7A7A");
        const limit = args.limit === void 0 ? void 0 : args.limit;
        if (limit !== void 0 && (!Number.isInteger(limit) || limit < 1)) throw new Error("template_search: limit \u5FC5\u987B\u662F\u6B63\u6574\u6570");
        const matches = template.search(args.query, {
          ...typeof args.category === "string" && args.category.length > 0 ? { category: args.category } : {},
          ...limit !== void 0 ? { limit } : {}
        });
        return {
          ok: true,
          kind: "template-search",
          count: matches.length,
          matches: matches.map((match) => ({ id: match.template.id, title: match.template.title, category: match.template.category, sections: match.template.sections, source: match.template.source, matchedKeywords: match.matchedKeywords, score: match.score }))
        };
      }
    }),
    defineTool({
      name: "venue_search",
      description: "\u573A\u5730\u5E93\u67E5\u8BE2(\u53EA\u8BFB):\u6309\u5173\u952E\u8BCD/\u5BB9\u91CF\u4E0B\u9650/\u533A\u4F4D\u67E5\u573A\u5730\u8BB0\u5F55,\u8FD4\u56DE\u5BB9\u91CF\u3001\u533A\u4F4D\u3001\u5730\u94C1\u3001\u62A5\u4EF7\u4E0E\u7EDF\u4E00\u53E3\u5F84(\u542B AV)\u53EF\u6BD4\u4EF7\u53CA\u62A5\u4EF7\u6765\u6E90\u3002\u573A\u5730\u6BD4\u9009\u5FC5\u987B\u4E09\u5BB6\u5168\u5217\u3001\u7EDF\u4E00\u6298\u7B97\u5230\u542B AV \u603B\u4EF7\u518D\u6BD4,\u5E76\u5F15\u7528\u6BCF\u5BB6\u62A5\u4EF7\u6765\u6E90\u3002",
      parameters: {
        keyword: { type: "string", description: "\u5173\u952E\u8BCD(\u547D\u4E2D\u573A\u5730\u540D/\u533A\u4F4D)" },
        capacityMin: { type: "number", description: "\u5BB9\u91CF\u4E0B\u9650(\u4EBA)" },
        district: { type: "string", description: "\u533A\u4F4D\u8FC7\u6EE4(\u5982 \u5E02\u4E2D\u5FC3/\u9AD8\u65B0\u533A)" }
      },
      output: OUTPUT,
      isConcurrencySafe: () => true,
      async execute(argsRaw) {
        const args = argsRaw;
        if (args.capacityMin !== void 0 && (!Number.isFinite(args.capacityMin) || args.capacityMin < 1)) throw new Error("venue_search: capacityMin \u5FC5\u987B\u662F\u6B63\u6570");
        const hits = searchVenueCatalog({
          ...typeof args.keyword === "string" && args.keyword.trim().length > 0 ? { keyword: args.keyword } : {},
          ...args.capacityMin !== void 0 ? { capacityMin: args.capacityMin } : {},
          ...typeof args.district === "string" && args.district.trim().length > 0 ? { district: args.district } : {}
        });
        return {
          ok: true,
          kind: "venue-search",
          count: hits.length,
          hits: hits.map((hit) => ({
            name: hit.venue.name,
            district: hit.venue.district,
            ...hit.venue.metro !== void 0 ? { metro: hit.venue.metro } : {},
            capacity: hit.venue.capacity,
            quoteCny: hit.venue.quoteCny,
            includesAv: hit.venue.includesAv,
            ...hit.venue.avExtraCny !== void 0 ? { avExtraCny: hit.venue.avExtraCny } : {},
            comparableTotalCny: hit.comparableTotalCny,
            source: hit.venue.source
          })),
          hint: "\u6BD4\u9009\u4E2D\u7ACB:\u7EDF\u4E00\u53E3\u5F84(\u542B AV)\u6298\u7B97\u540E\u5168\u5217\u5BF9\u6BD4,\u63A8\u8350\u5FC5\u987B\u7ED9\u7406\u7531\u5E76\u5F15\u7528\u6765\u6E90;\u5B9A\u6807\u8D70 vendor_award \u5BA1\u6279\u3002"
        };
      }
    }),
    defineTool({
      name: "budget_change",
      description: "\u9884\u7B97\u53D8\u66F4\u7533\u8BF7(R3 \u9AD8\u5371:\u8C03\u7528\u5373\u89E6\u53D1\u5BBF\u4E3B\u5BA1\u6279\u7559\u75D5,\u5BA1\u6279\u901A\u8FC7\u524D\u4E0D\u751F\u6548\u3001\u9759\u9ED8\u6539\u52A8=\u8FDD\u89C4)\u3002\u8F93\u5165\u57FA\u51C6\u9884\u7B97\u4E0E\u53D8\u66F4\u540E\u9884\u7B97,\u8FD4\u56DE\u53D8\u66F4\u7533\u8BF7\u5355:\u8D85\u652F\u91D1\u989D/\u8D85\u652F\u767E\u5206\u6BD4/R3 \u5224\u5B9A(>5%)\u3002\u8F93\u51FA applied=false\u2014\u2014\u672C\u5DE5\u5177\u53EA\u51FA\u7533\u8BF7\u5355,\u9884\u7B97\u8868\u7684\u6539\u52A8\u5728\u5BA1\u6279\u901A\u8FC7\u540E\u6309\u7533\u8BF7\u5355\u6267\u884C\u3002",
      parameters: {
        baseBudgetCny: { type: "number", required: true, description: "\u57FA\u51C6\u9884\u7B97(\u5143)" },
        newBudgetCny: { type: "number", required: true, description: "\u53D8\u66F4\u540E\u9884\u7B97(\u5143)" },
        reason: { type: "string", required: true, description: "\u53D8\u66F4\u7406\u7531(\u5199\u5165\u7533\u8BF7\u5355)" }
      },
      output: OUTPUT,
      async execute(argsRaw) {
        const args = argsRaw;
        if (!Number.isFinite(args.baseBudgetCny) || !Number.isFinite(args.newBudgetCny) || typeof args.reason !== "string") {
          throw new Error("budget_change: baseBudgetCny/newBudgetCny \u5FC5\u987B\u662F\u6570\u5B57,reason \u5FC5\u987B\u662F\u5B57\u7B26\u4E32");
        }
        const draft = approval.draftBudgetChange({
          baseBudgetCny: args.baseBudgetCny,
          newBudgetCny: args.newBudgetCny,
          reason: args.reason
        });
        return { ...draft, approvalOutcome: "allowed-once", appliedAfterApprovalBy: "\u6388\u6743\u4EBA\u6309\u7533\u8BF7\u5355\u6267\u884C\u9884\u7B97\u8868\u53D8\u66F4" };
      }
    }),
    defineTool({
      name: "pay_deposit",
      description: "\u4ED8\u6B3E\u7533\u8BF7(\u5B9A\u91D1,R3 \u9AD8\u5371:\u8C03\u7528\u5373\u89E6\u53D1\u5BBF\u4E3B\u5BA1\u6279\u7559\u75D5;agent \u4E0D\u5F97\u4EE3\u4ED8)\u3002\u6309\u5408\u540C\u989D\u4E0E\u5B9A\u91D1\u6BD4\u4F8B(\u9ED8\u8BA4 30%)\u8BA1\u7B97\u91D1\u989D\u5E76\u751F\u6210\u4ED8\u6B3E\u7533\u8BF7\u5355(\u91D1\u989D/\u6536\u6B3E\u65B9/\u4F9D\u636E)\u3002\u8F93\u51FA executed=false\u2014\u2014\u5BA1\u6279\u901A\u8FC7\u540E\u7531\u8D22\u52A1\u6267\u884C,\u672C\u5DE5\u5177\u4E0D\u53D1\u751F\u4EFB\u4F55\u8D44\u91D1\u52A8\u4F5C\u3002",
      parameters: {
        contractCny: { type: "number", required: true, description: "\u5408\u540C\u989D(\u5143)" },
        depositRatio: { type: "number", description: "\u5B9A\u91D1\u6BD4\u4F8B(0-1,\u9ED8\u8BA4 0.3)" },
        payee: { type: "string", required: true, description: "\u6536\u6B3E\u65B9(\u5168\u79F0)" },
        basis: { type: "string", description: "\u4ED8\u6B3E\u4F9D\u636E(\u5408\u540C/\u6BD4\u9009\u7ED3\u8BBA\u7B49)" }
      },
      output: OUTPUT,
      async execute(argsRaw) {
        const args = argsRaw;
        if (!Number.isFinite(args.contractCny) || typeof args.payee !== "string") {
          throw new Error("pay_deposit: contractCny \u5FC5\u987B\u662F\u6570\u5B57,payee \u5FC5\u987B\u662F\u5B57\u7B26\u4E32");
        }
        const draft = approval.draftPaymentRequest({
          contractCny: args.contractCny,
          ...Number.isFinite(args.depositRatio) ? { depositRatio: args.depositRatio } : {},
          payee: args.payee,
          ...typeof args.eterna === "string" ? { basis: args.eterna } : {}
        });
        return { ...draft, approvalOutcome: "allowed-once", paymentExecutedBy: "finance-officer(\u5BA1\u6279\u901A\u8FC7\u540E)" };
      }
    }),
    defineTool({
      name: "send_email",
      description: "\u5BF9\u5916\u53D1\u9001(R2:\u8C03\u7528\u5373\u89E6\u53D1\u5BBF\u4E3B\u786E\u8BA4;\u590D\u76D8/\u901A\u77E5\u7C7B\u4EA4\u4ED8\u901A\u5E38\u4E0D\u9700\u8981\u5B83\u2014\u2014\u6536\u4EF6\u4EBA/\u4E3B\u9898/\u53E3\u5F84\u786E\u8BA4\u540E\u7531\u6267\u884C\u4FA7\u53D1\u9001)\u3002\u6821\u9A8C\u6536\u4EF6\u4EBA\u4E0E\u4E3B\u9898,\u8FD4\u56DE\u53D1\u9001\u524D\u68C0\u67E5\u6E05\u5355\u4E0E\u4EBA\u5DE5\u79FB\u4EA4\u5355;agent \u4E0D\u76F4\u63A5\u5916\u53D1\u3002",
      parameters: {
        recipients: { type: "array", required: true, description: "\u6536\u4EF6\u4EBA\u5730\u5740\u5217\u8868", items: { type: "string" } },
        subject: { type: "string", required: true, description: "\u90AE\u4EF6\u4E3B\u9898" },
        channel: { type: "string", description: "\u53D1\u9001\u6E20\u9053(\u9ED8\u8BA4 email)" }
      },
      output: OUTPUT,
      async execute(argsRaw) {
        const args = argsRaw;
        if (!Array.isArray(args.recipients) || typeof args.subject !== "string") throw new Error("send_email: recipients \u5FC5\u987B\u662F\u6570\u7EC4,subject \u5FC5\u987B\u662F\u5B57\u7B26\u4E32");
        const summary = guard.checkExternalSend({
          recipients: args.recipients.filter((item) => typeof item === "string"),
          subject: args.subject,
          ...typeof args.channel === "string" ? { channel: args.channel } : {}
        });
        return { ...summary, approvalOutcome: "allowed-once" };
      }
    }),
    defineTool({
      name: "transfer_money",
      description: "\u8D44\u91D1\u5212\u8F6C(R3 \u9AD8\u5371:\u8C03\u7528\u5373\u89E6\u53D1\u5BBF\u4E3B\u5BA1\u6279\u7559\u75D5;\u8D44\u91D1\u52A8\u4F5C\u4E00\u5F8B\u7531\u8D22\u52A1\u6267\u884C,agent \u4E0D\u5F97\u4EE3\u4ED8)\u3002\u6821\u9A8C\u6536\u6B3E\u65B9\u4E0E\u91D1\u989D,\u8FD4\u56DE\u53CC\u4EBA\u6838\u5BF9\u6E05\u5355\u4E0E\u8D22\u52A1\u79FB\u4EA4\u5355;\u672C\u5DE5\u5177\u4E0D\u53D1\u751F\u4EFB\u4F55\u8D44\u91D1\u52A8\u4F5C\u3002",
      parameters: {
        payee: { type: "string", required: true, description: "\u6536\u6B3E\u65B9(\u5168\u79F0)" },
        amountCny: { type: "number", required: true, description: "\u91D1\u989D(\u5143)" },
        channel: { type: "string", description: "\u6E20\u9053(\u9ED8\u8BA4 corporate \u5BF9\u516C)" }
      },
      output: OUTPUT,
      async execute(argsRaw) {
        const args = argsRaw;
        if (typeof args.payee !== "string" || !Number.isFinite(args.amountCny)) throw new Error("transfer_money: payee \u5FC5\u987B\u662F\u5B57\u7B26\u4E32,amountCny \u5FC5\u987B\u662F\u6570\u5B57");
        const summary = guard.checkMoneyTransfer({
          payee: args.payee,
          amountCny: args.amountCny,
          ...typeof args.channel === "string" ? { channel: args.channel } : {}
        });
        return { ...summary, approvalOutcome: "allowed-once" };
      }
    }),
    defineTool({
      name: "sign_contract",
      description: "\u5408\u540C\u7B7E\u7F72(R3 \u9AD8\u5371:\u8C03\u7528\u5373\u89E6\u53D1\u5BBF\u4E3B\u5BA1\u6279\u7559\u75D5;\u7528\u5370\u5F52\u6388\u6743\u7B7E\u5B57\u4EBA,agent \u4E0D\u5F97\u4EE3\u7B7E)\u3002\u6821\u9A8C\u76F8\u5BF9\u65B9\u4E0E\u5408\u540C\u989D,\u8FD4\u56DE\u7B7E\u7F72\u524D\u68C0\u67E5\u6E05\u5355\u4E0E\u79FB\u4EA4\u5355;\u672C\u5DE5\u5177\u4E0D\u4EA7\u751F\u4EFB\u4F55\u7B7E\u7F72\u6548\u529B\u3002",
      parameters: {
        counterparty: { type: "string", required: true, description: "\u5408\u540C\u76F8\u5BF9\u65B9(\u5168\u79F0)" },
        amountCny: { type: "number", required: true, description: "\u5408\u540C\u989D(\u5143)" },
        summary: { type: "string", description: "\u5408\u540C\u8981\u70B9\u6458\u8981" }
      },
      output: OUTPUT,
      async execute(argsRaw) {
        const args = argsRaw;
        if (typeof args.counterparty !== "string" || !Number.isFinite(args.amountCny)) throw new Error("sign_contract: counterparty \u5FC5\u987B\u662F\u5B57\u7B26\u4E32,amountCny \u5FC5\u987B\u662F\u6570\u5B57");
        const summary = guard.checkContractSign({
          counterparty: args.counterparty,
          amountCny: args.amountCny,
          ...typeof args.summary === "string" ? { summary: args.summary } : {}
        });
        return { ...summary, approvalOutcome: "allowed-once" };
      }
    }),
    defineTool({
      name: "vendor_award",
      description: "\u4F9B\u5E94\u5546\u5B9A\u6807(R3 \u9AD8\u5371:\u8C03\u7528\u5373\u89E6\u53D1\u5BBF\u4E3B\u5BA1\u6279\u7559\u75D5;\u5B9A\u6807\u524D\u5FC5\u987B\u5B8C\u6210\u81F3\u5C11\u4E09\u5BB6\u7EDF\u4E00\u53E3\u5F84\u6BD4\u9009)\u3002\u6821\u9A8C\u5B9A\u6807\u8981\u7D20,\u8FD4\u56DE\u5B9A\u6807\u4E2D\u7ACB\u68C0\u67E5\u6E05\u5355(\u4E09\u5BB6\u5168\u5217/\u7EDF\u4E00\u53E3\u5F84/\u6765\u6E90\u53EF\u8FFD\u6EAF)\u4E0E\u91C7\u8D2D\u79FB\u4EA4\u5355;agent \u4FDD\u6301\u6BD4\u9009\u4E2D\u7ACB,\u6388\u6807\u7531\u91C7\u8D2D\u8D1F\u8D23\u4EBA\u5BA1\u6279\u540E\u6267\u884C\u3002",
      parameters: {
        vendor: { type: "string", required: true, description: "\u62DF\u4E2D\u6807\u4F9B\u5E94\u5546(\u5168\u79F0)" },
        category: { type: "string", required: true, description: "\u91C7\u8D2D\u7C7B\u76EE(\u5982 \u573A\u5730/\u642D\u5EFA/AV)" },
        quotesCompared: { type: "number", description: "\u5DF2\u6BD4\u9009\u62A5\u4EF7\u5BB6\u6570(\u5FC5\u987B \u22653)" }
      },
      output: OUTPUT,
      async execute(argsRaw) {
        const args = argsRaw;
        if (typeof args.vendor !== "string" || typeof args.category !== "string") throw new Error("vendor_award: vendor/category \u5FC5\u987B\u662F\u5B57\u7B26\u4E32");
        if (!Number.isFinite(args.quotesCompared)) throw new Error("vendor_award: quotesCompared(\u5DF2\u6BD4\u9009\u5BB6\u6570)\u5FC5\u987B\u63D0\u4F9B\u4E14\u4E3A\u6570\u5B57");
        const summary = guard.checkVendorAward({
          vendor: args.vendor,
          category: args.category,
          quotesCompared: args.quotesCompared
        });
        return { ...summary, approvalOutcome: "allowed-once" };
      }
    })
  ];
}
function defineEventToolsPlugin() {
  return {
    name: EVENT_TOOLS_PLUGIN_NAME,
    inject: { tools: true },
    apply(ctx) {
      const disposers = defineEventTools().map((def) => ctx.tools.register(def));
      const offGate = ctx.on("tools/pre-execute", async (exec, next) => {
        const reason = ASK_REASONS[exec.name];
        return reason === void 0 ? await next() : { kind: "ask", reason };
      });
      let disposed = false;
      return () => {
        if (disposed) return;
        disposed = true;
        for (const dispose of disposers.splice(0)) dispose();
        offGate();
      };
    }
  };
}
const vendorRegistryFactory = createVendorRegistry;
var plugin_default = defineEventToolsPlugin();
export {
  EVENT_TOOLS_PLUGIN_NAME,
  plugin_default as default,
  defineEventTools,
  defineEventToolsPlugin,
  vendorRegistryFactory
};
