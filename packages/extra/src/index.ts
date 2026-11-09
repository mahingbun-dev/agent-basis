/**
 * @eterna/extra —— L1 收尾插件(T13;设计文档 08 §3 表 #10/#12/#13、12 §4.4、
 * 12 §10.3、14 排期 T13)。
 *
 * 三个模块(本包是策略纯函数层 + 配置产物层,不触碰 ctx 全局):
 * 1. egress 完整版(domain-whitelist.ts + egress-wrapper.ts + egress-defaults.ts):
 *    域名白名单判定器(通配域名+端口,fail-closed)+ 出网工具包装器——
 *    在 @eterna/governance egress-lite(工具级)之上叠加域名级判定与
 *    proxy 强注,包装 dsh ToolDefinition,未列名域名在底层执行前拒掉;
 *    内网默认白名单(egress-defaults.ts,T8:数据不出内网红线的缺省口径)+ 资产
 *    模板 assets/egress-whitelist.template.yml;
 * 2. reviewer preset(reviewer-preset.ts):只读审查 subagent 的 preset
 *    配置产物(agent-preset 行 + dsh-persona 行 + 工具门 read/grep/glob
 *    + tool-subagent 委派行),schema 校验 fail-closed;
 * 3. tenant realm(tenant-realm.ts + assets/tenant-realm.template.yml +
 *    docs/tenant-realm.md):行业→客户两级 Cordis isolate realm 约定、
 *    配置模板与加载校验(realm key 语法 / cordis:group 行树生成)。
 *
 * Cordis 纪律:注册面(reviewer 工具门)以宿主 seam(ToolGateHost =
 * ctx.tools.restrict 结构面)注入,返回原生 disposer(effect 配逆);
 * coeffect 无(纯策略层);接口可交换(ToolLevelEgress / ToolGateHost
 * 均为结构子集注入面)。seam 编译期钉住见 tests/types.seam-pin.ts。
 */
export { DomainWhitelist, normalizeRuleHost, parseDestination, parseDomainWhitelistYaml } from './domain-whitelist.ts'
export type { DomainDecision, DomainRule, DomainRuleYaml, Destination } from './domain-whitelist.ts'
export { DEFAULT_EGRESS_DOMAIN_RULES, defaultEgressWhitelist } from './egress-defaults.ts'
export { DEFAULT_URL_ARG_KEYS, EgressToolWrapper, createEgressWrapper, isEgressDeniedValue } from './egress-wrapper.ts'
export type { EgressDeniedValue, EgressPreflight, EgressWrapperOptions, ToolLevelEgress } from './egress-wrapper.ts'
export {
  DEFAULT_REVIEWER_ALLOW, READ_ONLY_TOOL_VOCABULARY, REVIEWER_DENY_GLOBS, applyReviewerToolGate,
  buildReviewerPreset, renderReviewerPresetYaml, reviewerPersonaPrefix, validateReviewerPresetArtifact,
} from './reviewer-preset.ts'
export type {
  AgentPresetRowConfig, BuildReviewerPresetOptions, PluginRow, ReviewerPresetArtifact, ReviewerPresetValidation,
  ToolGateHost, ToolSubagentRowConfig,
} from './reviewer-preset.ts'
export {
  CUSTOMER_PREFIX, INDUSTRY_PREFIX, ISOLATED_TENANT_SERVICES, SLUG_PATTERN, buildTenantGroupRows, formatRealm,
  loadTenantRealmConfig, parseRealm, renderTenantGroupYaml, tenantRealmLabel,
} from './tenant-realm.ts'
export type { CustomerRealm, IndustryRealm, TenantRealm, TenantRealmDocument } from './tenant-realm.ts'
export { dshToolGateHost } from './host.ts'
export { ExtraConfigError } from './errors.ts'
