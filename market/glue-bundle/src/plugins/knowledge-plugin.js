import * as nodeFs from "node:fs";
import { join } from "node:path";
import { WikiLocalBackend, createKnowledgeService, createNodeFsAdapter, toDshTools } from "../vendor/knowledge/index.js";
const BASIS_KNOWLEDGE_PLUGIN_NAME = "basis-knowledge";
function defineKnowledgePlugin(config = {}) {
  return {
    name: BASIS_KNOWLEDGE_PLUGIN_NAME,
    inject: { tools: true, governance: false },
    apply(ctx) {
      const cwd = process.cwd();
      const wikiDir = config.wikiDir ?? join(cwd, "knowledge.wiki");
      const govRules = ctx.governance?.rules;
      const backend = new WikiLocalBackend({
        wikiDir,
        dbPath: config.dbPath ?? join(cwd, ".basis/knowledge.sqlite3"),
        fs: createNodeFsAdapter(nodeFs),
        // 提案门禁(fail-closed):governance 规则显式 allow 才放行;否则 reject 待人工评审
        gate: (proposal) => {
          const verdict = govRules?.evaluate("knowledge_propose", { proposal_id: proposal.id });
          if (verdict?.decision === "allow") return { kind: "approve" };
          return { kind: "reject", reason: "glue: \u77E5\u8BC6\u53D1\u5E03\u9700\u4EBA\u5DE5\u8BC4\u5BA1(\u5DE5\u4F5C\u53F0/\u5BF9\u8BDD\u5F0F\u6DFB\u52A0\u786E\u8BA4\u540E\u8C03\u7528 approve);governance \u89C4\u5219\u672A\u653E\u884C" };
        }
      });
      const service = createKnowledgeService({ backends: [backend] });
      const disposers = toDshTools(service).map((def) => ctx.tools.register(def));
      let disposed = false;
      return () => {
        if (disposed) return;
        disposed = true;
        for (const dispose of disposers.splice(0)) dispose();
        backend.dispose();
      };
    }
  };
}
var knowledge_plugin_default = defineKnowledgePlugin();
export {
  BASIS_KNOWLEDGE_PLUGIN_NAME,
  knowledge_plugin_default as default,
  defineKnowledgePlugin
};
