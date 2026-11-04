import { AuditProjector } from "./audit.ts";
import { BudgetGuard } from "./budget.ts";
import { EgressLite } from "./egress.ts";
import { RuleEngine } from "./rules.ts";
import { AuditProjector as AuditProjector2 } from "./audit.ts";
import { FileAuditSink, MemoryAuditSink } from "./sink.ts";
import { BudgetGuard as BudgetGuard2 } from "./budget.ts";
import { EgressLite as EgressLite2, DEFAULT_OUTBOUND_TOOL_GLOBS } from "./egress.ts";
import { PiiBlockedError, PiiFilter, defaultPiiPatterns } from "./pii.ts";
import { RuleEngine as RuleEngine2, serializeArgs } from "./rules.ts";
import { GovernanceConfigError, isRecord } from "./errors.ts";
import { globToRegExp, matchAnyGlob, matchGlob } from "./glob.ts";
import { stableStringify } from "./types.ts";
const GOVERNANCE_SERVICE_ID = "@basis/governance";
function createGovernance(options) {
  const id = GOVERNANCE_SERVICE_ID;
  return {
    id,
    rules: options.rules,
    ...options.budget !== void 0 && { budget: options.budget },
    ...options.egress !== void 0 && { egress: options.egress },
    ...options.pii !== void 0 && { pii: options.pii },
    ...options.audit !== void 0 && { audit: options.audit },
    preExecute(call) {
      if (options.budget?.exhausted() === true) return options.budget.preExecuteGuard(call);
      const egressDecision = options.egress?.preExecuteDecision(call);
      if (egressDecision !== void 0 && egressDecision.kind === "deny") return egressDecision;
      return options.rules.preExecuteDecision(call);
    }
  };
}
function createGovernanceFromYaml(policyYaml, extras = {}) {
  return createGovernance({
    rules: RuleEngine.parse(policyYaml),
    ...extras.budgetConfig !== void 0 && { budget: new BudgetGuard(extras.budgetConfig, extras.budgetHooks) },
    ...extras.egressConfig !== void 0 && { egress: new EgressLite(extras.egressConfig) },
    ...extras.pii !== void 0 && { pii: extras.pii },
    ...extras.audit !== void 0 && { audit: new AuditProjector(extras.audit) }
  });
}
export {
  AuditProjector2 as AuditProjector,
  BudgetGuard2 as BudgetGuard,
  DEFAULT_OUTBOUND_TOOL_GLOBS,
  EgressLite2 as EgressLite,
  FileAuditSink,
  GOVERNANCE_SERVICE_ID,
  GovernanceConfigError,
  MemoryAuditSink,
  PiiBlockedError,
  PiiFilter,
  RuleEngine2 as RuleEngine,
  createGovernance,
  createGovernanceFromYaml,
  defaultPiiPatterns,
  globToRegExp,
  isRecord,
  matchAnyGlob,
  matchGlob,
  serializeArgs,
  stableStringify
};
