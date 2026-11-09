import { join } from "node:path";
import { attachMemory, createMemory, dshHost } from "../vendor/memory/index.js";
const ETERNA_MEMORY_PLUGIN_NAME = "eterna-memory";
function defineMemoryPlugin(config = {}) {
  return {
    name: ETERNA_MEMORY_PLUGIN_NAME,
    inject: { tools: true, systemPrompt: true, governance: false },
    apply(ctx) {
      const cwd = process.cwd();
      const gov = ctx.governance;
      const memory = createMemory({
        workspaceDir: config.notesDir ?? join(cwd, "NOTES"),
        dbPath: config.dbPath ?? join(cwd, ".eterna/memory.sqlite3"),
        ...gov?.pii !== void 0 ? { pii: gov.pii } : {}
      });
      const indexOptions = {
        ...config.indexBudgetTokens !== void 0 ? { index: { budgetTokens: config.indexBudgetTokens } } : {}
      };
      return attachMemory(dshHost(ctx), memory, indexOptions);
    }
  };
}
var memory_plugin_default = defineMemoryPlugin();
export {
  ETERNA_MEMORY_PLUGIN_NAME,
  memory_plugin_default as default,
  defineMemoryPlugin
};
