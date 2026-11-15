/**
 * memory 插件测试共享 harness:fake ctx + tools/systemPrompt/llm/sessions 属性镜像
 * + 挂载记录。自 memory-plugin.spec.ts 抽出(M-M2 T6 增挂载测试,T7 增 llm/sessions
 * 假体——插件 inject 硬依赖,两处共用同一装配形态)。
 * M-M3 T10:llm 假体按 system 提示词分路——冻结打标提示词(DOMAIN_TAGGING_PROMPT)
 * 走打标应答通道(setTagReply,缺省 '{}' 不打标),其余(提取/Gm1)走 setLlmReply;
 * tools.register 增定义捕获(toolDefs)供集成测直调 memory_write 验证域归属盖章。
 * M-M3 T11:重量 Dream 的冻结提示词(DREAM_CONSOLIDATION_PROMPT/DREAM_CONFLICT_PROMPT)
 * 走 dream/conflict 应答通道(缺省空动作 JSON,Dream 干跑不落提案,既有用例不被
 * Dream 直调干扰;需要提案时 setDreamReply/setConflictReply 覆写)。
 */
import { DREAM_CONFLICT_PROMPT, DREAM_CONSOLIDATION_PROMPT, DOMAIN_TAGGING_PROMPT } from '@eterna/memory'
import { makeFakeContext } from './fake-context.ts'

/** section 的最小消费面(name + text provider;PromptSection 结构子集)。 */
export interface SectionLike {
  readonly name: string
  readonly text: string | ((...args: unknown[]) => string)
}

export function makePluginHarness() {
  const harness = makeFakeContext()
  const tools: string[] = []
  const toolDefs = new Map<string, unknown>()
  const sections: SectionLike[] = []
  const mirror = harness.fake as unknown as Record<string, unknown>
  mirror.tools = {
    register: (definition: { name: string }): (() => void) => {
      tools.push(definition.name)
      toolDefs.set(definition.name, definition)
      return () => {
        const index = tools.indexOf(definition.name)
        if (index >= 0) tools.splice(index, 1)
        toolDefs.delete(definition.name)
      }
    },
  }
  mirror.systemPrompt = {
    section: (section: SectionLike): (() => void) => {
      sections.push(section)
      return () => {
        const index = sections.indexOf(section)
        if (index >= 0) sections.splice(index, 1)
      }
    },
  }
  // M-M2 T7:llm/sessions 假体(提取执行体消费)。默认回复 Nothing to save——
  // 门控/调度/游标语义的既有用例不被提取行为干扰;需要提案时 setLlmReply 覆写。
  // M-M3 T10:打标调用按 system 提示词分路(应答 setTagReply,缺省 '{}' = 不打标),
  // 打标调用与提取调用一样记入 llmPrepared(测试按 maxTokens/提示词自行分拣)。
  // M-M3 T11:Dream 整固/对账直调同样按 system 分路(缺省空动作 JSON = 干跑)。
  const llmPrepared: unknown[] = []
  const llmStreamed: unknown[] = []
  let llmReply = 'Nothing to save'
  let tagReply = '{}'
  let dreamReply = '{"promotions":[],"preferences":[],"retractions":[]}'
  let conflictReply = '{"conflicts":[]}'
  mirror.llm = {
    listProviders: () => [{ id: 'deepseek-official', name: 'DeepSeek 官方' }],
    listModels: async (provider: string) => [{ provider, id: 'deepseek-flash', name: 'Flash' }],
    prepareCall: async (config: unknown) => {
      llmPrepared.push(config)
      return {
        config: { ...(config as Record<string, unknown>) },
        stream: (options: unknown): AsyncIterable<unknown> => (async function* () {
          llmStreamed.push(options)
          const system = (options as { system?: unknown }).system
          const reply = system === DOMAIN_TAGGING_PROMPT
            ? tagReply
            : system === DREAM_CONSOLIDATION_PROMPT
              ? dreamReply
              : system === DREAM_CONFLICT_PROMPT ? conflictReply : llmReply
          yield { type: 'block-start', index: 0, blockType: 'text' }
          yield { type: 'text-delta', index: 0, text: reply }
          yield { type: 'block-end', index: 0, block: { type: 'text', text: reply } }
          yield { type: 'finish', reason: { kind: 'stop' } }
        })(),
      }
    },
  }
  mirror.sessions = {
    get: (_id: string) => undefined,
    flush: async () => true,
  }
  return {
    ...harness,
    tools,
    toolDefs,
    sections,
    llmPrepared,
    llmStreamed,
    setLlmReply: (text: string): void => {
      llmReply = text
    },
    setTagReply: (text: string): void => {
      tagReply = text
    },
    setDreamReply: (text: string): void => {
      dreamReply = text
    },
    setConflictReply: (text: string): void => {
      conflictReply = text
    },
  }
}
