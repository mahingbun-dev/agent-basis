function hiddenReason(provenance) {
  if (provenance.status === "deprecated") return "status=deprecated(\u5E9F\u5F03\u9875\u7269\u7406\u7559\u6863,\u68C0\u7D22\u4E0D\u53EF\u89C1)";
  if (provenance.superseded_by !== void 0 && provenance.superseded_by.length > 0) {
    return `\u5DF2\u88AB ${provenance.superseded_by} \u53D6\u4EE3(superseded)`;
  }
  if (provenance.trust === "agent_drafted" && provenance.review !== "reviewed") {
    return "agent_drafted \u672A\u8FC7\u5BA1(\u6295\u6BD2\u9632\u7EBF:\u5FC5\u987B\u8FC7 governance \u95E8\u7981)";
  }
  return "";
}
function isVisibleInSearch(provenance, filters) {
  if (hiddenReason(provenance) !== "") return false;
  if (filters !== void 0) {
    if (filters.trust !== void 0 && !filters.trust.includes(provenance.trust)) return false;
    if (filters.exclude_stale === true && provenance.status === "stale") return false;
  }
  return true;
}
export {
  hiddenReason,
  isVisibleInSearch
};
