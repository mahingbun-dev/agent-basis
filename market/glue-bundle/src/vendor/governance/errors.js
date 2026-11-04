class GovernanceConfigError extends Error {
  /** 逐条列出的问题描述(供审批卡片/日志展示)。 */
  issues;
  constructor(message, issues = []) {
    super(issues.length > 0 ? `${message}(${issues.length} \u5904\u95EE\u9898:${issues.join("; ")})` : message);
    this.name = "GovernanceConfigError";
    this.issues = issues;
  }
}
function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
export {
  GovernanceConfigError,
  isRecord
};
