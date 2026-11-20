/**
 * agent-loop 插件:provide ctx.agents 并登记 default agent("no privileged core" ——
 * loop 本身就是普通插件)。config 透传 LoopOptions。
 */
import type { Context } from '@core/cordis'
import { AgentRegistryImpl } from './registry.ts'
import { createAgentRunner } from './loop.ts'
import type { LoopOptions } from './loop.ts'

export const AGENT_LOOP_PLUGIN_NAME = 'basis-agent-loop'

export function defineAgentLoopPlugin(options: LoopOptions = {}) {
  return {
    name: AGENT_LOOP_PLUGIN_NAME,
    inject: { tools: true, llm: true, session: true, systemPrompt: true } as never,
    apply(ctx: Context): () => void {
      const registry = new AgentRegistryImpl()
      const disposeProvide = ctx.provide('agents', registry)
      const disposeAgent = registry.register('default', (inner) => {
        // runner 物化延迟到首次 resolve(此时全部 seam 必已就绪)
        return createAgentRunner(inner, options)
      })
      return () => {
        disposeAgent()
        disposeProvide()
      }
    },
  }
}

export default defineAgentLoopPlugin()
