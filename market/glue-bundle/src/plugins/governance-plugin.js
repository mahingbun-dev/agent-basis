import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { PiiFilter, RuleEngine, createGovernance } from "../vendor/governance/index.js";
import { reportToAudit } from "../audit-bridge.js";
const GOVERNANCE_SERVICE_ID = "governance";
function emptyRules() {
  return RuleEngine.parse("rules: []", "glue:empty");
}
function defineGovernancePlugin(config = {}) {
  return {
    name: "eterna-governance",
    apply(ctx) {
      const rulesPath = config.rulesPath ?? join(process.cwd(), ".eterna/governance.rules.yml");
      const rules = existsSync(rulesPath) ? RuleEngine.parse(readFileSync(rulesPath, "utf8"), rulesPath) : emptyRules();
      const pii = new PiiFilter();
      const gate = createGovernance({ rules, pii });
      const world = { rules, pii, gate };
      const dispose = ctx.provide(GOVERNANCE_SERVICE_ID, world);
      const actor = { pluginId: config.actorId ?? "eterna-governance", source: "decision" };
      const offGate = ctx.on("tools/pre-execute", async (exec, next) => {
        const decision = gate.preExecute(exec);
        if (decision.kind === "deny") {
          reportToAudit(ctx, {
            source: "glue-governance",
            event: "tools/pre-execute",
            tool: exec.name,
            decision: decision.kind,
            reason: decision.reason,
            actor
          });
          return decision;
        }
        if (decision.kind === "ask") {
          const downstream = await next();
          if (downstream.kind !== "allow") return downstream;
          reportToAudit(ctx, {
            source: "glue-governance",
            event: "tools/pre-execute",
            tool: exec.name,
            decision: decision.kind,
            ...decision.reason !== void 0 ? { reason: decision.reason } : {},
            actor
          });
          return decision;
        }
        return next();
      });
      return () => {
        offGate();
        dispose();
      };
    }
  };
}
var governance_plugin_default = defineGovernancePlugin();
export {
  GOVERNANCE_SERVICE_ID,
  governance_plugin_default as default,
  defineGovernancePlugin,
  emptyRules
};
