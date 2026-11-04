import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { PiiFilter, RuleEngine } from "../vendor/governance/index.js";
const GOVERNANCE_SERVICE_ID = "governance";
function emptyRules() {
  return RuleEngine.parse("rules: []", "glue:empty");
}
function defineGovernancePlugin(config = {}) {
  return {
    name: "basis-governance",
    apply(ctx) {
      const rulesPath = config.rulesPath ?? join(process.cwd(), ".basis/governance.rules.yml");
      const rules = existsSync(rulesPath) ? RuleEngine.parse(readFileSync(rulesPath, "utf8"), rulesPath) : emptyRules();
      const world = { rules, pii: new PiiFilter() };
      const dispose = ctx.provide(GOVERNANCE_SERVICE_ID, world);
      return () => {
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
