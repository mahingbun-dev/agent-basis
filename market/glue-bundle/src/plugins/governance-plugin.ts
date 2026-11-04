/**
 * governance 插件:把 @basis/governance 规则引擎与 PII 过滤装配为 ctx.governance 服务。
 * 规则文件缺省取 agent cwd 下的 .basis/governance.rules.yml,不存在 = 空规则集(deny 优先语义不变)。
 */
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import { PiiFilter, RuleEngine } from '../vendor/governance/index.ts'
import type { RuleEvaluation } from '../vendor/governance/index.ts'

export const GOVERNANCE_SERVICE_ID = 'governance'

export interface GovernanceWorld {
  /** 规则评估(deny 优先,fail-closed)。 */
  readonly rules: RuleEngine
  /** PII 过滤(供 memory/knowledge 写入前调用)。 */
  readonly pii: PiiFilter
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

export function defineGovernancePlugin(config: { rulesPath?: string } = {}) {
  return {
    name: 'basis-governance',
    apply(ctx: Context): () => void {
      const rulesPath = config.rulesPath ?? join(process.cwd(), '.basis/governance.rules.yml')
      const rules = existsSync(rulesPath)
        ? RuleEngine.parse(readFileSync(rulesPath, 'utf8'), rulesPath)
        : emptyRules()
      const world: GovernanceWorld = { rules, pii: new PiiFilter() }
      // 官方 seam:ctx 属性必须经 provide 声明后才能赋值,裸赋值抛
      // "cannot set property \"governance\" without provide"(cordis Context set 陷阱),
      // 且不 provide 则 memory/knowledge 的 inject(governance) 永远 pending。
      const dispose = ctx.provide(GOVERNANCE_SERVICE_ID, world)
      return () => {
        dispose()
      }
    },
  }
}

export type { RuleEvaluation }

// DSH bundle loader 取 default export 插件实例(对齐 @event/pack plugin.ts 形态)
export default defineGovernancePlugin()
