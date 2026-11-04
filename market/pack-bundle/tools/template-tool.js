const TEMPLATE_TOOL_SERVICE_ID = "@event/template-tool";
const TEMPLATE_LIBRARY = [
  {
    id: "wedding-plan-standard",
    title: "\u5A5A\u793C\u7B56\u5212\u6848(\u6807\u51C6\u5168\u6848)",
    category: "\u5A5A\u793C",
    keywords: ["\u5A5A\u793C", "\u5A5A\u5BB4", "\u7B56\u5212\u6848", "\u4EEA\u5F0F", "\u5BB4\u4F1A\u5385", "\u767E\u65E5\u5BB4"],
    sections: ["\u5F53\u65E5\u6D41\u7A0B", "\u5206\u9879\u9884\u7B97", "\u5206\u5DE5", "\u9884\u6848"],
    source: "packs/event-planning/skills/budget-sourcing-approval"
  },
  {
    id: "annual-gala-halfday",
    title: "\u5E74\u4F1A\u534A\u5929\u6D41\u7A0B\u4E0E\u9884\u7B97",
    category: "\u5E74\u4F1A",
    keywords: ["\u5E74\u4F1A", "\u5E86\u5178", "\u5468\u5E74\u5E86", "\u534A\u5929", "\u9881\u5956", "\u665A\u5BB4"],
    sections: ["\u65F6\u95F4\u7EBF", "\u5206\u9879\u9884\u7B97", "\u5206\u5DE5", "\u8282\u76EE\u9884\u6848"],
    source: "packs/event-planning/skills/event-delivery-workflow"
  },
  {
    id: "product-launch-150p",
    title: "\u4EA7\u54C1\u53D1\u5E03\u4F1A\u6267\u884C\u6846\u67B6",
    category: "\u53D1\u5E03\u4F1A",
    keywords: ["\u53D1\u5E03\u4F1A", "\u4E0A\u5E02", "\u5A92\u4F53", "\u6F14\u793A", "\u53E3\u5F84", "\u76F4\u64AD"],
    sections: ["\u5A92\u4F53\u53E3\u5F84", "\u6F14\u793A\u6D41\u7A0B", "\u5206\u9879\u9884\u7B97", "\u98CE\u9669\u9884\u6848"],
    source: "packs/event-planning/skills/event-delivery-workflow"
  },
  {
    id: "conference-runsheet",
    title: "\u4F1A\u8BAE\u6267\u884C\u624B\u518C(30 \u5206\u949F\u7C92\u5EA6)",
    category: "\u4F1A\u8BAE",
    keywords: ["\u4F1A\u8BAE", "\u8BBA\u575B", "\u624B\u518C", "runsheet", "\u7B7E\u5230", "\u8336\u6B47"],
    sections: ["\u5206\u949F\u7EA7\u6D41\u7A0B", "\u7269\u6599\u6E05\u5355", "\u5206\u5DE5", "\u5E94\u6025\u9884\u6848"],
    source: "packs/event-planning/skills/event-delivery-workflow"
  },
  {
    id: "teambuilding-urban",
    title: "\u56E2\u5EFA\u6D3B\u52A8\u65B9\u6848(\u5E02\u533A\u4E00\u65E5)",
    category: "\u56E2\u5EFA",
    keywords: ["\u56E2\u5EFA", "\u62D3\u5C55", "\u4E00\u65E5", "\u5E02\u533A", "\u7834\u51B0"],
    sections: ["\u884C\u7A0B", "\u9884\u7B97", "\u5206\u7EC4", "\u5929\u6C14\u9884\u6848"],
    source: "packs/event-planning/skills/event-delivery-workflow"
  },
  {
    id: "outdoor-planb",
    title: "\u6237\u5916\u6D3B\u52A8\u96E8\u5907 Plan B",
    category: "\u5A5A\u793C",
    keywords: ["\u6237\u5916", "\u5A5A\u793C", "\u96E8\u5907", "\u5907\u7528\u573A\u5730", "\u5207\u6362"],
    sections: ["\u96E8\u5907\u89E6\u53D1\u6761\u4EF6", "\u5907\u7528\u573A\u5730", "\u5207\u6362\u6D41\u7A0B", "\u901A\u77E5\u53E3\u5F84"],
    source: "packs/event-planning/skills/event-delivery-workflow"
  },
  {
    id: "venue-comparison-matrix",
    title: "\u573A\u5730\u6BD4\u9009\u5BF9\u7167\u8868",
    category: "\u6BD4\u9009",
    keywords: ["\u573A\u5730", "\u6BD4\u9009", "\u62A5\u4EF7", "\u5BF9\u6BD4", "\u5B9A\u6807"],
    sections: ["\u7EDF\u4E00\u53E3\u5F84\u6298\u7B97", "\u5BF9\u7167\u8868", "\u63A8\u8350\u7406\u7531", "\u62A5\u4EF7\u6765\u6E90"],
    source: "packs/event-planning/skills/budget-sourcing-approval"
  },
  {
    id: "budget-change-request",
    title: "\u9884\u7B97\u53D8\u66F4\u7533\u8BF7\u5355(R3)",
    category: "\u5BA1\u6279",
    keywords: ["\u9884\u7B97", "\u53D8\u66F4", "\u8D85\u652F", "\u5BA1\u6279", "R3"],
    sections: ["\u53D8\u66F4\u5185\u5BB9", "\u8D85\u652F\u6D4B\u7B97", "\u5F71\u54CD\u4E0E\u7406\u7531", "\u5BA1\u6279\u7559\u75D5"],
    source: "packs/event-planning/skills/budget-sourcing-approval"
  }
];
function createTemplateTool(library = TEMPLATE_LIBRARY) {
  return {
    id: TEMPLATE_TOOL_SERVICE_ID,
    byId(id) {
      return library.find((template) => template.id === id);
    },
    search(query, options) {
      const limit = options?.limit ?? 5;
      const terms = query.split(/\s+/).map((term) => term.trim()).filter((term) => term.length > 0);
      const matches = [];
      for (const template of library) {
        if (options?.category !== void 0 && template.category !== options.category) continue;
        const matched = collectMatches(template, terms);
        if (matched.length === 0) continue;
        matches.push({ template, matchedKeywords: matched, score: matched.length });
      }
      matches.sort((a, b) => b.score - a.score || a.template.id.localeCompare(b.template.id));
      return matches.slice(0, Math.max(0, limit));
    }
  };
}
function collectMatches(template, terms) {
  const hit = /* @__PURE__ */ new Set();
  for (const term of terms) {
    if (template.title.includes(term)) hit.add(term);
    else if (template.category.includes(term) || template.keywords.some((keyword) => keyword.includes(term))) hit.add(term);
  }
  return [...hit];
}
export {
  TEMPLATE_LIBRARY,
  TEMPLATE_TOOL_SERVICE_ID,
  createTemplateTool
};
