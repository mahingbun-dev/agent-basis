import { matchAnyGlob } from "./glob.ts";
const DEFAULT_OUTBOUND_TOOL_GLOBS = ["web_*", "http_*", "fetch_*", "mcp__*"];
class EgressLite {
  #config;
  constructor(config) {
    if (typeof config.proxyUrl !== "string" || !/^[a-z][a-z0-9+.-]*:\/\//iu.test(config.proxyUrl)) {
      throw new RangeError(`[governance] EgressLiteConfig.proxyUrl \u5FC5\u987B\u662F\u5E26\u534F\u8BAE\u7684 URL,\u5F97\u5230:${config.proxyUrl}`);
    }
    this.#config = config;
  }
  get config() {
    return this.#config;
  }
  /** 工具三态判定:非出网工具(local)不受 egress 约束;出网工具按白名单二分。 */
  classify(tool) {
    const outboundGlobs = this.#config.outboundToolGlobs ?? DEFAULT_OUTBOUND_TOOL_GLOBS;
    if (!matchAnyGlob(tool, outboundGlobs)) return "local";
    return matchAnyGlob(tool, this.#config.allowedOutboundTools) ? "outbound-allowed" : "outbound-denied";
  }
  /** tools/pre-execute 决策形态:仅拦截 outbound-denied(local 与白名单内的放行给规则引擎继续判)。 */
  preExecuteDecision(call) {
    const classification = this.classify(call.name);
    if (classification !== "outbound-denied") return { kind: "allow" };
    return {
      kind: "deny",
      reason: `[governance] \u51FA\u7F51\u5DE5\u5177 ${call.name} \u4E0D\u5728 egress \u767D\u540D\u5355(\u4EC5\u653E\u884C:${this.#config.allowedOutboundTools.join(",") || "\u65E0"})`
    };
  }
  /**
   * proxy 环境变量注入载荷:大写 + 小写双形态(部分工具只认其一),
   * noProxy 非空时附 NO_PROXY/no_proxy。
   */
  proxyEnvPayload() {
    const noProxy = this.#config.noProxy !== void 0 && this.#config.noProxy.length > 0 ? this.#config.noProxy.join(",") : void 0;
    return {
      HTTP_PROXY: this.#config.proxyUrl,
      HTTPS_PROXY: this.#config.proxyUrl,
      http_proxy: this.#config.proxyUrl,
      https_proxy: this.#config.proxyUrl,
      ...noProxy !== void 0 && { NO_PROXY: noProxy, no_proxy: noProxy }
    };
  }
  /**
   * 把注入载荷合并进一个接受 env 参数的工具参数(强注:proxy 键覆盖既有同名键;
   * 其余既有 env 键保留)。返回新对象,不改动原参数。
   */
  withProxyEnv(args) {
    const existingEnv = isStringRecord(args["env"]) ? args["env"] : {};
    return { ...args, env: { ...existingEnv, ...this.proxyEnvPayload() } };
  }
}
function isStringRecord(value) {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  return Object.values(value).every((v) => typeof v === "string");
}
export {
  DEFAULT_OUTBOUND_TOOL_GLOBS,
  EgressLite
};
