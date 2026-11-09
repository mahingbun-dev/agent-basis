/**
 * governance 插件(T8 接线版):把 @basis/governance 规则引擎与 PII 过滤装配为
 * ctx.governance 服务,并把 governance.preExecute 的 allow/ask/deny 组合决策挂上
 * 宿主 tools/pre-execute 瀑布 —— 缺口表 P1 项「宿主执行点」的落地
 * (docs/design/enterprise-plugins.md §1.3:glue 只 provide 未挂 pre-execute,
 * 企业档卸掉领域包后 deny 判定无处执行)。
 *
 * veto 语义(waterfall:不透传即短路后续全部监听者,vendor/cordis/src/events.ts:76-85;
 * deny 一经产生由内核保证不可回翻,packages/core/tools/src/pipeline.ts:199-224):
 * - allow 一律 `await next()` 透传:直接返回 allow 会短路后续监听者(含 @event/pack
 *   的 R2/R3 ask 门),把「该走人」的动作静默放行(设计 §3.4 缺口 1 钉死的透传规则);
 * - deny 短路返回:内核把 deny 物化为 isError 工具结果(content `Error: ${reason}`,
 *   pipeline.ts:213-224),turn 不中断 —— 对齐 egress-wrapper「结构化失败不中断 turn」
 *   语义(拒绝是决策结果值,不是异常);
 * - ask 先 `await next()` 让后续监听者过一遍再定:downstream 非 allow(deny/cancel/ask)
 *   原样上抛(deny 优先,不让一次注定被拒的调用浪费人审);downstream allow 时本 ask
 *   生效。T8 之前「ask 短路」成立的前提是下游只有领域包 ask 门;egress 域名级判定
 *   (basis-egress 行,下游)加入后 ask 短路会让人审绕过域名白名单 —— 故 ask 改为
 *   「透传后回填」,egress deny 因此恒先于人审生效。
 *
 * ask 档语义的实现依据(governance/interact 现有语义,不新造口径):
 * - governance 规则引擎的 fail-closed 默认裁决是 ask 而非 deny(packages/governance/
 *   src/rules.ts:8「deny 优先、fail-closed 默认 ask」,解析期拒绝 default: allow);
 *   interact 风险分档同理(default_grade 只允许 R2/R3,packages/interact/src/hitl.ts:104-106
 *   「未命中规则的动作必须走人」);
 * - 因此 ask 原样返回 `{ kind: 'ask', reason }` 交内核处置(packs/event-planning/plugin.ts:355-357
 *   同款形态):宿主有 approval 服务时走人审批;无 approval 时内核把 ask 转成 deny
 *   (pipeline.ts serviceAsk:approval === undefined → deny,fail-closed 由内核保证,
 *   组合层不二次改写)。
 *
 * 审计接线(governance 不 import audit,组合层桥接,src/audit-bridge.ts):
 * deny/ask 终局决策经 ctx.audit.report() 直投(kind 'governance' 记录,含 actor 插件
 * 粒度归属);allow 不投(事件流的 tool/call+tool/result 配对已由 audit 插件全覆盖,
 * 设计 §2.2-4:tool/call 先于 pre-execute 落账,被拒调用也有 call+result 对)。
 */
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
// 空类型导入 = dsh-tools 对 cordis Events('tools/pre-execute')增广的触发器:不导入则
// 该声明文件不进本包 tsc 程序,ctx.on('tools/pre-execute') 的监听签名无法解析
// (packages/audit/src/plugin.ts:7-10 同款写法)。
import type {} from '@deepseek-ai/dsh-tools'
import { PiiFilter, RuleEngine, createGovernance } from '@basis/governance'
import type { Governance, RuleEvaluation } from '@basis/governance'
import { reportToAudit } from '../audit-bridge.ts'
import type { GovernancePluginConfig } from '../types.ts'

export const GOVERNANCE_SERVICE_ID = 'governance'

export interface GovernanceWorld {
  /** 规则评估(deny 优先,fail-closed)。 */
  readonly rules: RuleEngine
  /** PII 过滤(供 memory/knowledge 写入前调用)。 */
  readonly pii: PiiFilter
  /** 组合治理门(preExecute:预算 → egress → 规则,deny 优先;本插件的 pre-execute 判定源)。 */
  readonly gate: Governance
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    governance?: GovernanceWorld
  }
}

/** 空规则集工厂(规则文件不存在时的确定性缺省)。 */
export function emptyRules(): RuleEngine {
  return RuleEngine.parse('rules: []', 'glue:empty')
}

export function defineGovernancePlugin(config: GovernancePluginConfig = {}) {
  return {
    name: 'basis-governance',
    apply(ctx: Context): () => void {
      const rulesPath = config.rulesPath ?? join(process.cwd(), '.basis/governance.rules.yml')
      const rules = existsSync(rulesPath)
        ? RuleEngine.parse(readFileSync(rulesPath, 'utf8'), rulesPath)
        : emptyRules()
      const pii = new PiiFilter()
      const gate = createGovernance({ rules, pii })
      const world: GovernanceWorld = { rules, pii, gate }
      // 官方 seam:ctx 属性必须经 provide 声明后才能赋值,裸赋值抛
      // "cannot set property \"governance\" without provide"(cordis Context set 陷阱),
      // 且不 provide 则 memory/knowledge 的 inject(governance) 永远 pending。
      const dispose = ctx.provide(GOVERNANCE_SERVICE_ID, world)
      const actor = { pluginId: config.actorId ?? 'basis-governance', source: 'decision' } as const

      const offGate = ctx.on('tools/pre-execute', async (exec, next) => {
        const decision = gate.preExecute(exec)
        if (decision.kind === 'deny') {
          reportToAudit(ctx, {
            source: 'glue-governance',
            event: 'tools/pre-execute',
            tool: exec.name,
            decision: decision.kind,
            reason: decision.reason,
            actor,
          })
          return decision
        }
        if (decision.kind === 'ask') {
          const downstream = await next()
          if (downstream.kind !== 'allow') return downstream // 后续 deny/cancel/ask 优先,本 ask 不成立(终局由其来源留痕)
          reportToAudit(ctx, {
            source: 'glue-governance',
            event: 'tools/pre-execute',
            tool: exec.name,
            decision: decision.kind,
            ...(decision.reason !== undefined ? { reason: decision.reason } : {}),
            actor,
          })
          return decision
        }
        return next() // allow 一律透传,不短路后续监听者(§3.4 缺口 1)
      })

      return () => {
        offGate()
        dispose()
      }
    },
  }
}

export type { RuleEvaluation }

// DSH bundle loader 取 default export 插件实例(对齐 @event/pack plugin.ts 形态)
export default defineGovernancePlugin()
