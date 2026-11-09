/**
 * egress 插件(T8,§11.6 裁定:@basis/extra 的 egress 白名单首期挂载):
 * 把 @basis/extra 的 EgressToolWrapper(工具级 → 域名级 → 代理强注三层)挂上宿主
 * tools/pre-execute 瀑布,对出网型工具(web_search / web_fetch 等 web 检索五件套的
 * 模型面工具,governance DEFAULT_OUTBOUND_TOOL_GLOBS 识别)逐调用判定。
 *
 * 为什么挂在 pre-execute 而不是「以 wrap() 产物重注册包装后的 ToolDefinition」:
 * - dsh tools 注册表对同名重复注册 fail-loud(packages/core/tools/src/index.ts:69
 *   `tool "X" is already registered`),web_search/web_fetch 由宿主行(tool-web)持有,
 *   组合层无法覆盖注册 —— 瀑布是宿主工具唯一可插的执行前判定点;
 * - pre-execute 先于 approval(pipeline.ts:199-224:waterfall → serviceAsk → guards),
 *   域名级拒绝发生在人审之前,不让注定被拒的调用浪费一次审批;tools/execute 在审批
 *   之后,做不了这件事;
 * - 第 3 层(代理强注)的诚实边界:两个 seam 都不能改写已记录参数 —— pre-execute
 *   不能改写(governance/src/egress.ts:7-9 转述 dsh README:197),tools/execute 只许
 *   改 exec.signal(packages/core/tools/src/events.ts:23-25)——因此本插件在瀑布上只
 *   做「判定在前」:配置给出 proxyUrl 时包装器保留 EgressLite.withProxyEnv 载荷能力
 *   (供消费 env 参数的自有工具与 wrap() 场景),未配置时整层关闭;放行分支原样
 *   next(),不伪装已强注。
 *
 * 拒绝形态:preflight denied → `{ kind: 'deny', reason }` 交内核物化为 isError 工具
 * 结果(content `Error: ${reason}`,pipeline.ts:213-224),turn 不中断 —— 对齐
 * egress-wrapper「结构化失败不中断 turn」语义;结构化明细(EgressDeniedValue:layer
 * = tool/domain/no-destination)进 ctx.audit(src/audit-bridge.ts 组合层桥接)。
 *
 * fail-closed 口径(「数据不出内网」红线):
 * - 域名白名单缺省仅内网(192.168.31.0/24、localhost、MaNas/NAS 主机名,
 *   @basis/extra DEFAULT_EGRESS_DOMAIN_RULES);配置文件缺省 agent cwd 下
 *   .basis/egress-whitelist.yml(模板 packages/extra/assets/egress-whitelist.template.yml,
 *   留公网域扩展注释),文件存在但语法非法 = 抛错(fail-closed,同 governance 规则
 *   文件口径);文件不存在 = 内网默认,不抛;
 * - unknownDestination 缺省 'allow'(工具级白名单兜底,egress-wrapper.ts:53-57 的
 *   「结构化 MCP 工具」语义):web_search 这类目的地在服务端配置面、参数里没有
 *   URL 的工具若按 'deny' 会被误杀,与「web 检索是唯一显式出站」裁定直接冲突;
 *   携带目的地参数的调用无论如何都过域名级 fail-closed 判定(127.0.0.1 之类的
 *   非白名单目的地照拒),需要更严时可在配置显式收窄为 'deny';
 * - 工具级放行缺省含 'mcp__*':内网 MCP 家族(WeKnora 等)的服务器目的地是部署
 *   配置面而非调用参数,按工具名一刀切拒掉会打断企业知识能力;其 URL 形参数仍被
 *   域名级白名单管控,要求更严时经配置收窄。
 */
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
// 空类型导入 = dsh-tools 对 cordis Events('tools/pre-execute')增广触发器(governance-plugin.ts 同款)。
import type {} from '@deepseek-ai/dsh-tools'
import { DEFAULT_OUTBOUND_TOOL_GLOBS, EgressLite, matchAnyGlob } from '@basis/governance'
import type { EgressClassification } from '@basis/governance'
import {
  createEgressWrapper,
  defaultEgressWhitelist,
  parseDomainWhitelistYaml,
} from '@basis/extra'
import type { DomainWhitelist, ToolLevelEgress } from '@basis/extra'
import { reportToAudit } from '../audit-bridge.ts'
import type { EgressPluginConfig } from '../types.ts'

export const BASIS_EGRESS_PLUGIN_NAME = 'basis-egress'

/**
 * 工具级白名单缺省(唯一显式出站 + 内网 MCP 家族;理由见头注 fail-closed 段)。
 * web 检索五件套的模型面工具 = web_search / web_fetch(deepseek-harness
 * packages/web/tool-web 注册,provider 见 web-search-deepseek)。
 */
export const DEFAULT_ALLOWED_OUTBOUND_TOOLS: readonly string[] = ['web_search', 'web_fetch', 'mcp__*']

/** 工具级判定:governance EgressLite(配了 proxyUrl)或其等价结构子集(无代理时,强注层关闭)。 */
function buildToolLevelEgress(config: EgressPluginConfig): ToolLevelEgress {
  const allowedOutboundTools = config.allowedOutboundTools ?? DEFAULT_ALLOWED_OUTBOUND_TOOLS
  if (config.proxyUrl !== undefined) {
    return new EgressLite({
      proxyUrl: config.proxyUrl,
      allowedOutboundTools,
      ...(config.outboundToolGlobs !== undefined ? { outboundToolGlobs: config.outboundToolGlobs } : {}),
      ...(config.noProxy !== undefined ? { noProxy: config.noProxy } : {}),
    })
  }
  // 无受控代理:第 3 层整层关闭;classify 以等价结构实现(egress-wrapper.ts:19-20 的
  // 等价注入面),withProxyEnv fail-loud —— injectProxyEnv 已关,正常路径不会触达。
  const globs = config.outboundToolGlobs ?? DEFAULT_OUTBOUND_TOOL_GLOBS
  return {
    classify: (tool: string): EgressClassification => {
      if (!matchAnyGlob(tool, globs)) return 'local'
      return matchAnyGlob(tool, allowedOutboundTools) ? 'outbound-allowed' : 'outbound-denied'
    },
    withProxyEnv: () => {
      throw new Error('[glue-egress] 未配置 proxyUrl,代理强注层不可用(injectProxyEnv 已关)')
    },
  }
}

function loadDomainWhitelist(config: EgressPluginConfig): DomainWhitelist {
  const whitelistPath = config.whitelistPath ?? join(process.cwd(), '.basis/egress-whitelist.yml')
  if (!existsSync(whitelistPath)) return defaultEgressWhitelist()
  // 语法/结构错误即抛(装载失败 = fail-closed),与 governance 规则文件同口径。
  return parseDomainWhitelistYaml(readFileSync(whitelistPath, 'utf8'))
}

/** 工具参数目的地收集面只认键值对象;模型给出的其它形态(字符串/缺省)按空参处理。 */
function asArgsRecord(arguments_: unknown): Record<string, unknown> {
  return typeof arguments_ === 'object' && arguments_ !== null && !Array.isArray(arguments_)
    ? arguments_ as Record<string, unknown>
    : {}
}

export function defineEgressPlugin(config: EgressPluginConfig = {}) {
  return {
    name: BASIS_EGRESS_PLUGIN_NAME,
    apply(ctx: Context): () => void {
      const wrapper = createEgressWrapper(buildToolLevelEgress(config), loadDomainWhitelist(config), {
        injectProxyEnv: config.proxyUrl !== undefined,
        // 插件层缺省 'allow'(头注 fail-closed 段;wrapper 自身缺省是 'deny',必须显式覆盖)。
        unknownDestination: config.unknownDestination ?? 'allow',
      })
      const actor = { pluginId: BASIS_EGRESS_PLUGIN_NAME, source: 'decision' } as const

      const offGate = ctx.on('tools/pre-execute', async (exec, next) => {
        const pre = wrapper.preflight(exec.name, asArgsRecord(exec.arguments))
        if (pre.kind !== 'denied') return next() // local(非出网)/allowed(命中白名单)原样放行
        const value = pre.value
        reportToAudit(ctx, {
          source: 'glue-egress',
          event: 'tools/pre-execute',
          tool: exec.name,
          decision: 'deny',
          reason: value.reason,
          denied: { egress: value.egress, tool: value.tool, layer: value.layer, reason: value.reason },
          actor,
        })
        return { kind: 'deny', reason: `[egress] ${value.reason}` }
      })

      return () => {
        offGate()
      }
    },
  }
}

// DSH bundle loader 取 default export 插件实例(对齐 @event/pack plugin.ts 形态)
export default defineEgressPlugin()
