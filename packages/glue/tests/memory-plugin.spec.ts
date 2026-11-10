/**
 * T2.6 运行时层自管改造(memory 插件经提示词注册表读 section 行为头):
 * - 注册表在场:挂载的 memory:index section 文本取注册表条目当前生效文本,
 *   注册表值变化后同一 section 再装配即新文(读取面每轮活取,装载顺序无关);
 * - 注册表缺席:apply 不抛,section 落 @eterna/memory 内置兜底文本(非空),宿主照常起;
 * - disposer 语义不变:卸载全部工具与 section,幂等。
 * ctx 形态 = makeFakeContext(服务经 services 表 + ctx.get 机会读取,对齐真实 cordis
 * reflect mixin;tools/systemPrompt 两个 inject 面以属性镜像注入)。
 */
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import { MEMORY_BEHAVIOR_HEADER, MEMORY_SECTION_REGISTRY_ENTRY_ID, PROMPT_REGISTRY_SERVICE_ID } from '@eterna/memory'
import type { PromptRegistryFace } from '@eterna/memory'
import { defineMemoryPlugin, ETERNA_MEMORY_PLUGIN_NAME } from '../src/plugins/memory-plugin.ts'
import { makeFakeContext } from './fake-context.ts'

/** section 的最小消费面(name + text provider;PromptSection 结构子集)。 */
interface SectionLike {
  readonly name: string
  readonly text: string | (() => string)
}

/** 插件测试 harness:fake ctx + tools/systemPrompt 属性镜像 + 挂载记录。 */
function makePluginHarness() {
  const harness = makeFakeContext()
  const tools: string[] = []
  const sections: SectionLike[] = []
  const mirror = harness.fake as unknown as Record<string, unknown>
  mirror.tools = {
    register: (definition: { name: string }): (() => void) => {
      tools.push(definition.name)
      return () => {
        const index = tools.indexOf(definition.name)
        if (index >= 0) tools.splice(index, 1)
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
  return { ...harness, tools, sections }
}

/** 可变注册表假体(记录取值条目 id;文本可变模拟注册表版本变化)。 */
function fakeRegistry(initial: string): { face: PromptRegistryFace; asked: string[]; setText(text: string): void } {
  const state = { text: initial }
  const asked: string[] = []
  return {
    asked,
    setText: (text: string) => { state.text = text },
    face: {
      resolveRuntimePromptText: (entryId: string): string => {
        asked.push(entryId)
        return state.text
      },
    },
  }
}

describe('memory 插件 T2.6 登记制(section 行为头从提示词注册表读)', () => {
  let dir = ''

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'eterna-glue-memory-plugin-'))
  })

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  function applyPlugin(harness: ReturnType<typeof makePluginHarness>): () => void {
    const plugin = defineMemoryPlugin({ notesDir: join(dir, 'NOTES'), dbPath: join(dir, 'memory.sqlite3') })
    expect(plugin.name).toBe(ETERNA_MEMORY_PLUGIN_NAME)
    return plugin.apply(harness.fake as unknown as Context)
  }

  function indexSectionOf(harness: ReturnType<typeof makePluginHarness>): SectionLike {
    const section = harness.sections.find(item => item.name === 'memory:index')
    expect(section, 'memory:index section 未挂载').toBeDefined()
    return section as SectionLike
  }

  it('注册表在场:section 文本取注册表条目文本(以注册表条目 id 取值),四工具照常挂载', () => {
    const harness = makePluginHarness()
    const registry = fakeRegistry('## 长期记忆(注册表版 V1)')
    harness.provide(PROMPT_REGISTRY_SERVICE_ID, registry.face)
    applyPlugin(harness)
    expect(harness.tools).toHaveLength(4)
    const render = indexSectionOf(harness).text as () => string
    expect(render()).toContain('## 长期记忆(注册表版 V1)')
    expect(render()).not.toContain(MEMORY_BEHAVIOR_HEADER)
    // 每次装配都以注册表条目 id 取值(render 调了两次,asked 记两条,条目 id 恒一)。
    expect(registry.asked.length).toBeGreaterThan(0)
    expect([...new Set(registry.asked)]).toEqual([MEMORY_SECTION_REGISTRY_ENTRY_ID])
  })

  it('注册表缺席:apply 不抛,section 落内置兜底文本(非空),宿主照常起', () => {
    const harness = makePluginHarness()
    expect(() => { applyPlugin(harness) }).not.toThrow()
    expect(harness.tools).toHaveLength(4)
    const text = (indexSectionOf(harness).text as () => string)()
    expect(text).toContain(MEMORY_BEHAVIOR_HEADER)
    expect(MEMORY_BEHAVIOR_HEADER.trim().length).toBeGreaterThan(0)
  })

  it('活绑定:插件装载时注册表未挂 → 先落兜底;随后注册表上桌,同一 section 再装配即新文(装载顺序无关)', () => {
    const harness = makePluginHarness()
    applyPlugin(harness)
    const render = indexSectionOf(harness).text as () => string
    expect(render()).toContain(MEMORY_BEHAVIOR_HEADER)
    const registry = fakeRegistry('## 长期记忆(晚装载注册表 V2)')
    const disposeService = harness.provide(PROMPT_REGISTRY_SERVICE_ID, registry.face)
    expect(render()).toContain('晚装载注册表 V2') // 读取面每轮装配现取服务,不缓存于 apply 时刻
    registry.setText('## 长期记忆(晚装载注册表 V3)')
    expect(render()).toContain('晚装载注册表 V3')
    disposeService()
    expect(render()).toContain(MEMORY_BEHAVIOR_HEADER) // 服务下桌 → 回落兜底
  })

  it('读取面方法抛异常:装配不炸,落内置兜底文本', () => {
    const harness = makePluginHarness()
    harness.provide(PROMPT_REGISTRY_SERVICE_ID, {
      resolveRuntimePromptText: () => { throw new Error('注册表读取面故障') },
    })
    applyPlugin(harness)
    const render = indexSectionOf(harness).text as () => string
    expect(render).not.toThrow()
    expect(render()).toContain(MEMORY_BEHAVIOR_HEADER)
  })

  it('disposer 语义不变:卸载全部工具与 section,幂等', () => {
    const harness = makePluginHarness()
    harness.provide(PROMPT_REGISTRY_SERVICE_ID, fakeRegistry('## 长期记忆(注册表版 V1)').face)
    const dispose = applyPlugin(harness)
    expect(harness.tools).toHaveLength(4)
    expect(harness.sections).toHaveLength(1)
    dispose()
    expect(harness.tools).toHaveLength(0)
    expect(harness.sections).toHaveLength(0)
    dispose() // 幂等
  })
})
