/**
 * knowledge 插件:WikiLocalBackend(git 仓库即知识层)+ 四模型面工具。
 * 门禁:fail-closed——默认 reject(知识发布需人工评审);有 governance 规则时按规则裁决放行。
 */
import * as nodeFs from 'node:fs'
import { join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import { WikiLocalBackend, createKnowledgeService, createNodeFsAdapter, toDshTools } from '../vendor/knowledge/index.ts'
import type { KnowledgeProposal } from '../vendor/knowledge/index.ts'
import type { KnowledgePluginConfig } from '../types.ts'

export const BASIS_KNOWLEDGE_PLUGIN_NAME = 'basis-knowledge'

/** governance 服务在 glue 侧的最小结构子集(inject 可选,governance 缺席为常态)。 */
interface GovernanceLike {
  readonly rules?: { evaluate(tool: string, args?: unknown): { decision: string } }
}

export function defineKnowledgePlugin(config: KnowledgePluginConfig = {}) {
  return {
    name: BASIS_KNOWLEDGE_PLUGIN_NAME,
    inject: { tools: true, governance: false } as never,
    apply(ctx: Context): () => void {
      const cwd = process.cwd()
      const wikiDir = config.wikiDir ?? join(cwd, 'knowledge.wiki')
      const govRules = (ctx as unknown as { governance?: GovernanceLike }).governance?.rules
      const backend = new WikiLocalBackend({
        wikiDir,
        dbPath: config.dbPath ?? join(cwd, '.basis/knowledge.sqlite3'),
        fs: createNodeFsAdapter(nodeFs),
        // 提案门禁(fail-closed):governance 规则显式 allow 才放行;否则 reject 待人工评审
        gate: (proposal: KnowledgeProposal) => {
          const verdict = govRules?.evaluate('knowledge_propose', { proposal_id: proposal.id })
          if (verdict?.decision === 'allow') return { kind: 'approve' as const }
          return { kind: 'reject' as const, reason: 'glue: 知识发布需人工评审(工作台/对话式添加确认后调用 approve);governance 规则未放行' }
        },
      })
      const service = createKnowledgeService({ backends: [backend] })
      const disposers = toDshTools(service).map(def => ctx.tools.register(def))
      let disposed = false
      return (): void => {
        if (disposed) return
        disposed = true
        for (const dispose of disposers.splice(0)) dispose()
        backend.dispose()
      }
    },
  }
}

// DSH bundle loader 取 default export 插件实例(对齐 @event/pack plugin.ts 形态)
export default defineKnowledgePlugin()
