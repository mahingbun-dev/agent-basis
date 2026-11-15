import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { ToolDefinition, ToolRunContext } from '@deepseek-ai/dsh-tools'
import {
  assemblySessionIdOf, attachMemory, createMemory, createMemoryIndexSection, defineMemoryTools,
  estimateTokens, MEMORY_BEHAVIOR_HEADER, MEMORY_DEDUP_MERGE_OVERLAP, MEMORY_DEDUP_NOOP_OVERLAP,
  MEMORY_SEARCH_PREFIX_REGISTRY_ENTRY_ID, MEMORY_SEARCH_RESULT_PREFIX,
  MEMORY_SECTION_REGISTRY_ENTRY_ID, MEMORY_TOOL_NAMES,
  PROMPT_REGISTRY_SERVICE_ID, resolvePromptRegistry, tokenOverlapRatio,
} from '../src/index.ts'
import type { Memory, MemoryAssemblyContext, MemoryHost, MemorySessionContext, PromptRegistryFace } from '../src/index.ts'

let dir = ''
let memory: Memory

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'eterna-memory-tools-'))
  memory = createMemory({ workspaceDir: dir, dbPath: join(dir, 'memory.db') })
})

afterEach(async () => {
  memory.dispose()
  await rm(dir, { recursive: true, force: true })
})

/** 最小执行上下文(工具只依赖 name/signal 语义,其余字段不触达)。 */
const fakeExec = { name: 'test', signal: new AbortController().signal } as unknown as ToolRunContext

/**
 * 带会话出处的执行上下文(provenance 盖章用):agent 形状照 dsh-agent 运行时
 * 增广({session:{id}})或基础接口({id});callId 为 ToolRunContext 必在字段。
 */
function execOf(
  agent: { readonly session?: { readonly id: string }; readonly id?: string } | undefined,
  callId = 'call-t2',
): ToolRunContext {
  return { name: 'test', signal: new AbortController().signal, callId, agent } as unknown as ToolRunContext
}

function tool(name: string): ToolDefinition {
  const found = defineMemoryTools(memory).find(definition => definition.name === name)
  if (found === undefined) throw new Error(`工具不存在:${name}`)
  return found
}

/** 从给定定义清单中取工具(sessionContext 注入变体用)。 */
function toolIn(definitions: readonly ToolDefinition[], name: string): ToolDefinition {
  const found = definitions.find(definition => definition.name === name)
  if (found === undefined) throw new Error(`工具不存在:${name}`)
  return found
}

describe('defineMemoryTools:定义面', () => {
  it('恰好四个工具,名字与导出清单一致', () => {
    const definitions = defineMemoryTools(memory)
    expect(definitions.map(definition => definition.name)).toEqual([...MEMORY_TOOL_NAMES])
  })

  it('read/search 声明并发安全;write/forget 独占(未声明)', () => {
    // defineTool 对 isConcurrencySafe 做 args 校验包装:非法 args 视为 exclusive,
    // 故传各工具的合法最小 args 验证「有效调用可并行」
    const readDef = tool('memory_read') as { isConcurrencySafe?: (args: unknown) => boolean }
    const searchDef = tool('memory_search') as { isConcurrencySafe?: (args: unknown) => boolean }
    const writeDef = tool('memory_write') as { isConcurrencySafe?: (args: unknown) => boolean }
    const forgetDef = tool('memory_forget') as { isConcurrencySafe?: (args: unknown) => boolean }
    expect(readDef.isConcurrencySafe?.({ subject: 's', key: 'k' })).toBe(true)
    expect(searchDef.isConcurrencySafe?.({ query: 'q' })).toBe(true)
    expect(readDef.isConcurrencySafe?.({})).toBe(false)
    expect(writeDef.isConcurrencySafe).toBeUndefined()
    expect(forgetDef.isConcurrencySafe).toBeUndefined()
  })

  it('output.render 把规范值渲染为可读 JSON 文本块', () => {
    const value = { ok: true, key: 'k' }
    const blocks = tool('memory_read').output.render({ subject: 's', key: 'k' }, value)
    expect(blocks).toHaveLength(1)
    expect(blocks[0]).toMatchObject({ type: 'text' })
    expect(JSON.parse((blocks[0] as { text: string }).text)).toEqual(value)
  })
})

describe('memory_write 工具执行', () => {
  it('成功写入:ok true 且落库可读(T2 起 subject 收敛为 user / domain:<域键>,kind 必填)', async () => {
    const result = await tool('memory_write').execute(
      { subject: 'user', key: 'prefers-email-summary', content: '周报偏好邮件摘要', summary: '邮件摘要', confidence: 0.9, kind: 'semantic' },
      fakeExec,
    )
    expect(result).toMatchObject({
      ok: true, decision: 'add', subject: 'user', key: 'prefers-email-summary',
      confidence: 0.9, reviewState: 'pending', // user + semantic → pending(非显式)
    })
    expect(memory.readEntity('user', 'prefers-email-summary')?.content).toBe('周报偏好邮件摘要')
  })

  it('PII 命中:结构化 blocked 载荷(不中断 turn),库无残留', async () => {
    const result = await tool('memory_write').execute(
      { subject: 'user', key: 'contact', content: '手机 13812345678', kind: 'semantic' },
      fakeExec,
    )
    expect(result).toMatchObject({ ok: false, blocked: 'pii' })
    expect(memory.entities.count()).toBe(0)
  })

  it('confidence 越界:结构化失败载荷带 message', async () => {
    const result = await tool('memory_write').execute(
      { subject: 'user', key: 'k', content: 'v', kind: 'semantic', confidence: 2 },
      fakeExec,
    )
    expect(result).toMatchObject({ ok: false })
    expect((result as { message: string }).message).toMatch(/confidence/)
  })

  it('subject 收敛:org 已禁用;legacy 前缀与空域键结构化拒绝', async () => {
    for (const [subject, pattern] of [
      ['org:acme', /org 作用域已禁用/u],
      ['user:alice', /subject 必须/u],
      ['project:demo', /subject 必须/u],
      ['domain:', /域键不能为空/u],
    ] as const) {
      const result = await tool('memory_write').execute(
        { subject, key: 'k', content: '正文', kind: 'semantic' },
        fakeExec,
      )
      expect(result).toMatchObject({ ok: false })
      expect((result as { message: string }).message).toMatch(pattern)
    }
    expect(memory.entities.count()).toBe(0)
  })

  // ---------- M-M3 T10:episodic 会话域归属盖章(18 §1.3) ----------

  it('T10 域归属:会话绑定域时 episodic(domain 层)写入以会话域为准,模型域键不信任', async () => {
    const definition = toolIn(defineMemoryTools(memory, undefined, undefined, sessionId => sessionId === 'session-a' ? 'deploy' : undefined), 'memory_write')
    const result = await definition.execute(
      { subject: 'domain:other', key: 'turn-fact', content: '本次会话做了蓝绿切换', kind: 'episodic' },
      execOf({ session: { id: 'session-a' } }),
    )
    expect(result).toMatchObject({ ok: true, decision: 'add', subject: 'domain:deploy', sessionDomain: 'deploy' })
    const row = memory.readEntity('domain:deploy', 'turn-fact')
    expect(row?.subject).toBe('domain:deploy')
    expect(row?.domainKey).toBe('deploy')
    expect(row?.originSessionId).toBe('session-a')
    expect(row?.reviewState).toBe('approved') // domain+episodic → approved(08 §5.4 静默档)
    expect(memory.readEntity('domain:other', 'turn-fact')).toBeNull()
  })

  it('T10 域归属:semantic/procedural 与 user 层不受干预;未绑定/未提供读取面时模型 subject 照旧', async () => {
    const definition = toolIn(defineMemoryTools(memory, undefined, undefined, sessionId => sessionId === 'session-a' ? 'deploy' : undefined), 'memory_write')
    // semantic:模型域键说了算
    await definition.execute(
      { subject: 'domain:other', key: 'fact', content: '稳定事实', kind: 'semantic' },
      execOf({ session: { id: 'session-a' } }),
    )
    expect(memory.readEntity('domain:other', 'fact')?.subject).toBe('domain:other')
    // user 层 episodic:无域归属,不落域
    await definition.execute(
      { subject: 'user', key: 'pref', content: '偏好', kind: 'episodic' },
      execOf({ session: { id: 'session-a' } }),
    )
    expect(memory.readEntity('user', 'pref')?.scope).toBe('user')
    // 未绑定会话:模型 subject 照旧
    await definition.execute(
      { subject: 'domain:other', key: 'unbound', content: '未绑定会话记录', kind: 'episodic' },
      execOf({ session: { id: 'session-z' } }),
    )
    expect(memory.readEntity('domain:other', 'unbound')?.subject).toBe('domain:other')
    // 读取面缺席:行为与 T10 之前一致
    const plain = tool('memory_write')
    const result = await plain.execute(
      { subject: 'domain:other', key: 'no-face', content: '无读取面记录', kind: 'episodic' },
      execOf({ session: { id: 'session-a' } }),
    )
    expect(result).toMatchObject({ ok: true, subject: 'domain:other' })
    expect(memory.readEntity('domain:other', 'no-face')).not.toBeNull()
  })

  it('T10 域归属读取面抛异常:写入不受影响(防御模式),模型 subject 照旧', async () => {
    const definition = toolIn(defineMemoryTools(memory, undefined, undefined, () => { throw new Error('读取面炸了') }), 'memory_write')
    const result = await definition.execute(
      { subject: 'domain:deploy', key: 'safe', content: '读取面异常也照写', kind: 'episodic' },
      execOf({ session: { id: 'session-a' } }),
    )
    expect(result).toMatchObject({ ok: true, decision: 'add', subject: 'domain:deploy' })
    expect(memory.readEntity('domain:deploy', 'safe')).not.toBeNull()
  })
})

describe('memory_read 工具执行', () => {
  it('命中返回完整正文;未命中 found:false', async () => {
    await tool('memory_write').execute({ subject: 'domain:acme', key: 'k', content: '正文内容', kind: 'episodic' }, fakeExec)
    const found = await tool('memory_read').execute({ subject: 'domain:acme', key: 'k' }, fakeExec)
    expect(found).toMatchObject({ ok: true, found: true })
    expect((found as { record: { content: string } }).record.content).toBe('正文内容')

    const missing = await tool('memory_read').execute({ subject: 'domain:acme', key: 'nope' }, fakeExec)
    expect(missing).toMatchObject({ ok: true, found: false })
  })
})

describe('memory_search 工具执行', () => {
  it('M1+M2 联合命中,返回带出处', async () => {
    await tool('memory_write').execute({ subject: 'domain:acme', key: 'venue', content: '科技园报告厅', kind: 'episodic' }, fakeExec)
    await memory.writeNote('NOTES.md', '备忘:科技园报告厅容量 200')
    const result = await tool('memory_search').execute({ query: '科技园' }, fakeExec)
    expect(result).toMatchObject({ ok: true, count: 2 })
    const hits = (result as { hits: Array<{ kind: string; source: string }> }).hits
    expect(hits[0]!.kind).toBe('entity')
    expect(hits[1]!.source).toBe('notes:NOTES.md#L1')
  })
})

describe('memory_forget 工具执行', () => {
  it('应用逆闭包真删:forgotten 计数、正文不可再得', async () => {
    await tool('memory_write').execute({ subject: 'domain:acme', key: 'k', content: '待遗忘内容', kind: 'episodic' }, fakeExec)
    await tool('memory_write').execute({ subject: 'domain:acme', key: 'k', content: '顶替后的内容', kind: 'episodic' }, fakeExec)
    const result = await tool('memory_forget').execute({ subject: 'domain:acme', key: 'k' }, fakeExec)
    expect(result).toMatchObject({ ok: true, forgotten: 2 })
    expect(memory.readEntity('domain:acme', 'k')).toBeNull()
    expect(memory.entities.count()).toBe(0)
    const after = await tool('memory_search').execute({ query: '遗忘内容' }, fakeExec)
    expect((after as { count: number }).count).toBe(0)
  })

  it('遗忘不存在的键:forgotten 0 不报错', async () => {
    const result = await tool('memory_forget').execute({ subject: 'user', key: 'none' }, fakeExec)
    expect(result).toMatchObject({ ok: true, forgotten: 0 })
  })
})

describe('createMemoryIndexSection(systemPrompt 注入)', () => {
  it('PromptSection 形态:name/order/interpolate false;text 是预算内索引', () => {
    const section = createMemoryIndexSection(memory)
    const text = (section.text as () => string)()
    expect(section.name).toBe('memory:index')
    expect(section.order).toEqual(expect.any(Number))
    expect(section.interpolate).toBe(false)
    expect(estimateTokens(text)).toBeLessThanOrEqual(500)
  })

  it('text provider 动态:写入后内容变化(每次装配重建)', () => {
    const section = createMemoryIndexSection(memory)
    const render = section.text as () => string
    const before = render()
    // domain+episodic → approved:索引只收 approved 行(T2 检索纪律)
    memory.writeEntity({ subject: 'domain:deploy', key: 'new-fact', summary: '新事实', content: '新事实正文', kind: 'episodic' })
    const after = render()
    expect(before).not.toContain('new-fact')
    expect(after).toContain('new-fact')
  })

  it('text 含 {{字面}} 的记忆不炸插值(interpolate:false 保真)', () => {
    memory.writeEntity({ subject: 'domain:deploy', key: 'template-fact', content: '模板 {{var}} 字面保留', summary: '模板字面', kind: 'episodic' })
    const text = (createMemoryIndexSection(memory).text as () => string)()
    expect(text).toContain('模板字面')
  })

  // ---------- M-M3 T10:装配上下文 → 会话域索引区 ----------

  it('T10 装配上下文:解析器收 AssembleContext,按会话注入当前域索引区', () => {
    memory.writeEntity({ subject: 'domain:deploy', key: 'deploy-fact', content: '部署区事实', summary: '部署事实', kind: 'episodic' })
    memory.writeEntity({ subject: 'domain:other', key: 'other-fact', content: '其他域事实', summary: '其他事实', kind: 'episodic' })
    const section = createMemoryIndexSection(memory, (assembly) => {
      const sessionId = assemblySessionIdOf(assembly)
      return sessionId === 'session-a' ? { domainKey: 'deploy' } : {}
    })
    const render = section.text as (assembly: MemoryAssemblyContext) => string
    const bound = render({ agent: { session: { id: 'session-a' } } })
    expect(bound).toContain('## 当前域索引(deploy)')
    expect(bound).toContain('deploy-fact')
    // 跨域行进全局兜底区(不进当前域区),other-fact 仍在但不在域区行内
    expect(bound).toContain('other-fact')
    expect(bound.indexOf('## 当前域索引(deploy)')).toBeLessThan(bound.indexOf('other-fact'))
    // 未绑定会话:无域上下文 → 单区锚点形态(无域区头)
    const unbound = render({ agent: { session: { id: 'session-b' } } })
    expect(unbound).toContain('other-fact')
    expect(unbound).not.toContain('## 当前域索引')
  })

  it('T10 装配上下文:scope/agent 缺席或形状不符 → 无域上下文,装配不炸', () => {
    memory.writeEntity({ subject: 'domain:deploy', key: 'deploy-fact', content: '部署区事实', summary: '部署事实', kind: 'episodic' })
    const section = createMemoryIndexSection(memory, (assembly) => {
      const sessionId = assemblySessionIdOf(assembly)
      return sessionId === 'session-a' ? { domainKey: 'deploy' } : {}
    })
    const render = section.text as (assembly: MemoryAssemblyContext) => string
    expect(render({})).not.toContain('## 当前域索引')
    expect(render({ scope: {} })).not.toContain('## 当前域索引')
    expect(render({ agent: '不是对象' })).not.toContain('## 当前域索引')
    expect(render({ agent: { id: 'session-a' } })).toContain('## 当前域索引(deploy)') // 基础接口回落 id
  })

  it('T10 解析器抛异常:回落空选项(无域上下文),装配不炸(防御模式)', () => {
    const section = createMemoryIndexSection(memory, () => { throw new Error('解析面炸了') })
    expect((section.text as (assembly: MemoryAssemblyContext) => string)({ agent: { session: { id: 'session-a' } } }))
      .toBe((createMemoryIndexSection(memory).text as () => string)())
  })
})

describe('attachMemory(宿主级 effect,配逆即卸载干净)', () => {
  function fakeHost(): { host: MemoryHost; tools: string[]; sections: string[] } {
    const tools: string[] = []
    const sections: string[] = []
    return {
      tools,
      sections,
      host: {
        registerTool: (definition) => {
          tools.push(definition.name)
          return () => {
            const index = tools.indexOf(definition.name)
            if (index >= 0) tools.splice(index, 1)
          }
        },
        registerPromptSection: (section) => {
          sections.push(section.name)
          return () => {
            const index = sections.indexOf(section.name)
            if (index >= 0) sections.splice(index, 1)
          }
        },
      },
    }
  }

  it('注册四工具 + 索引 section;disposer 全部卸载;幂等', () => {
    const { host, tools, sections } = fakeHost()
    const dispose = attachMemory(host, memory)
    expect(tools).toEqual([...MEMORY_TOOL_NAMES])
    expect(sections).toEqual(['memory:index'])

    dispose()
    expect(tools).toHaveLength(0)
    expect(sections).toHaveLength(0)
    dispose()
  })

  it('includeIndexSection:false 只注册工具', () => {
    const { host, tools, sections } = fakeHost()
    attachMemory(host, memory, { includeIndexSection: false })
    expect(tools).toHaveLength(4)
    expect(sections).toHaveLength(0)
  })

  it('T10 domainOf 穿线:attachMemory 选项接 memory_write 的 episodic 域归属盖章', async () => {
    const { host } = fakeHost()
    const captured: ToolDefinition[] = []
    const wiringHost: MemoryHost = {
      ...host,
      registerTool: (definition) => {
        captured.push(definition)
        return host.registerTool(definition)
      },
    }
    const dispose = attachMemory(wiringHost, memory, {
      domainOf: sessionId => sessionId === 'session-a' ? 'deploy' : undefined,
    })
    const write = captured.find(definition => definition.name === 'memory_write')
    expect(write).toBeDefined()
    const result = await write?.execute(
      { subject: 'domain:other', key: 'wired', content: '穿线验证', kind: 'episodic' },
      execOf({ session: { id: 'session-a' } }),
    )
    expect(result).toMatchObject({ ok: true, subject: 'domain:deploy', sessionDomain: 'deploy' })
    expect(memory.readEntity('domain:deploy', 'wired')).not.toBeNull()
    dispose()
  })
})

describe('T2.6 登记制读取面(section 行为头从提示词注册表读,缺席降级不炸宿主)', () => {
  /** 可变注册表假体:记录取值条目 id,文本可变(模拟注册表版本变化)。 */
  function fakeRegistry(initial: string): { face: PromptRegistryFace; asked: string[]; setText(text: string): void } {
    const state = { text: initial }
    const asked: string[] = []
    return {
      asked,
      setText: (text: string) => { state.text = text },
      face: {
        resolveRuntimePromptText: (entryId: string): string | undefined => {
          asked.push(entryId)
          return state.text
        },
      },
    }
  }

  it('注册表在场:section 文本取注册条目文本,且以注册表条目 id 取值(runtime.memory.index-section)', () => {
    const registry = fakeRegistry('## 长期记忆(注册表版 V1)')
    const text = (createMemoryIndexSection(memory, {}, registry.face).text as () => string)()
    expect(text).toContain('## 长期记忆(注册表版 V1)')
    expect(text).not.toContain(MEMORY_BEHAVIOR_HEADER)
    expect(registry.asked).toEqual([MEMORY_SECTION_REGISTRY_ENTRY_ID])
  })

  it('注册表值变化 → 重建 section 得新文(索引半边照常来自记忆库)', () => {
    const registry = fakeRegistry('## 长期记忆(注册表版 V1)')
    const v1 = (createMemoryIndexSection(memory, {}, registry.face).text as () => string)()
    expect(v1).toContain('注册表版 V1')
    registry.setText('## 长期记忆(注册表版 V2,经审批生效)')
    const v2 = (createMemoryIndexSection(memory, {}, registry.face).text as () => string)()
    expect(v2).toContain('注册表版 V2')
    expect(v2).not.toContain('注册表版 V1')
    expect(v2).toContain('暂无长期记忆') // 索引半边仍由 M2 记忆库构建,与注册表无关
  })

  it('注册表返回 undefined(条目无版本)→ 落内置兜底文本(原内联语义)', () => {
    const face: PromptRegistryFace = { resolveRuntimePromptText: () => undefined }
    const text = (createMemoryIndexSection(memory, {}, face).text as () => string)()
    expect(text).toContain(MEMORY_BEHAVIOR_HEADER)
  })

  it('读取面方法抛异常 → 装配不炸,落内置兜底文本(不炸宿主纪律)', () => {
    const face: PromptRegistryFace = {
      resolveRuntimePromptText: () => { throw new Error('注册表读取面故障') },
    }
    const render = createMemoryIndexSection(memory, {}, face).text as () => string
    expect(render).not.toThrow()
    expect(render()).toContain(MEMORY_BEHAVIOR_HEADER)
  })

  it('注册表缺席(不传读取面)→ 内置兜底,兜底文本非空', () => {
    const text = (createMemoryIndexSection(memory).text as () => string)()
    expect(text).toContain(MEMORY_BEHAVIOR_HEADER)
    expect(MEMORY_BEHAVIOR_HEADER.trim().length).toBeGreaterThan(0)
  })

  it('resolvePromptRegistry 防御解析:缺席/形状不符/读取抛异常 → undefined,绝不抛', () => {
    // 服务缺席(真实 cordis reflect.get 语义:未提供 → undefined)
    expect(resolvePromptRegistry({ get: () => undefined })).toBeUndefined()
    // 服务在场但形状不符(缺 resolveRuntimePromptText)
    expect(resolvePromptRegistry({ get: () => ({}) })).toBeUndefined()
    // get 本体抛异常(真实 cordis 对 inactive fiber 的 strict 读取会抛)
    expect(resolvePromptRegistry({
      get: () => { throw new Error('cannot get property') },
    })).toBeUndefined()
    // 形状相符 → 原样返回(服务名按 PROMPT_REGISTRY_SERVICE_ID 取)
    const face: PromptRegistryFace = { resolveRuntimePromptText: () => '文本' }
    const seen: string[] = []
    expect(resolvePromptRegistry({ get: (name: string) => { seen.push(name); return face } })).toBe(face)
    expect(seen).toEqual([PROMPT_REGISTRY_SERVICE_ID])
  })

  it('attachMemory 穿线 promptSource;disposer 语义不变(注册/卸载/幂等与改造前一致)', () => {
    const tools: string[] = []
    const sections: string[] = []
    const host: MemoryHost = {
      registerTool: (definition) => {
        tools.push(definition.name)
        return () => {
          const index = tools.indexOf(definition.name)
          if (index >= 0) tools.splice(index, 1)
        }
      },
      registerPromptSection: (section) => {
        sections.push(section.name)
        return () => {
          const index = sections.indexOf(section.name)
          if (index >= 0) sections.splice(index, 1)
        }
      },
    }
    const registry = fakeRegistry('## 长期记忆(经 attachMemory 注入读取面)')
    const dispose = attachMemory(host, memory, { promptSource: registry.face })
    expect(tools).toEqual([...MEMORY_TOOL_NAMES])
    expect(sections).toEqual(['memory:index'])
    dispose()
    expect(tools).toHaveLength(0)
    expect(sections).toHaveLength(0)
    dispose() // 幂等
  })

  it('attachMemory 挂载的 section 经读取面取文本(promptSource 生效到挂载物)', () => {
    const registry = fakeRegistry('## 长期记忆(挂载物读注册表 V1)')
    const captured: { text: string | ((context: never) => string) }[] = []
    const host: MemoryHost = {
      registerTool: () => () => undefined,
      registerPromptSection: (section) => {
        captured.push({ text: section.text })
        return () => undefined
      },
    }
    attachMemory(host, memory, { promptSource: registry.face })
    const render = captured[0]?.text as () => string
    expect(render()).toContain('挂载物读注册表 V1')
    registry.setText('## 长期记忆(挂载物读注册表 V2)')
    expect(render()).toContain('挂载物读注册表 V2') // 同一挂载物每轮装配现取(随注册表版本变化)
  })
})

// ---------- M-M1 T2(19 号 §3-T2):provenance / review_state / 四操作 / 检索过滤 ----------

describe('M-M1 T2:provenance 运行时盖章(模型传参一律忽略)', () => {
  it('exec.agent.session.id 盖章且覆盖模型伪造传参;turnRef 存 callId', async () => {
    const result = await tool('memory_write').execute(
      {
        subject: 'user', key: 'prov-stamp', content: '盖章测试正文', kind: 'semantic',
        // 模型伪造的 provenance 传参:工具参数本无此字段,伪造也不透传
        originSessionId: 'model-forged-session', originTurnRef: 'model-forged-turn',
      },
      execOf({ session: { id: 'sess-42' } }, 'call-7'),
    )
    expect(result).toMatchObject({ ok: true, decision: 'add' })
    const record = memory.readEntity('user', 'prov-stamp')
    expect(record?.originSessionId).toBe('sess-42')
    expect(record?.originTurnRef).toBe('call-7')
  })

  it('agent 基础形态(仅 id,无运行时增广 session)→ agent.id 即会话出处', async () => {
    await tool('memory_write').execute(
      { subject: 'user', key: 'prov-agent-id', content: '基础 Agent 形态', kind: 'semantic' },
      execOf({ id: 'agent-id-9' }, 'call-8'),
    )
    const record = memory.readEntity('user', 'prov-agent-id')
    expect(record?.originSessionId).toBe('agent-id-9')
    expect(record?.originTurnRef).toBe('call-8')
  })

  it('agent 缺席且无宿主注入(agent-less 派发降级路径)→ sessionId 盖 null,写入不受影响;turnRef 仍存 callId', async () => {
    const result = await tool('memory_write').execute(
      { subject: 'user', key: 'prov-null', content: '降级路径正文', kind: 'semantic' },
      execOf(undefined, 'call-9'),
    )
    expect(result).toMatchObject({ ok: true, decision: 'add' })
    const record = memory.readEntity('user', 'prov-null')
    expect(record?.originSessionId).toBeNull()
    expect(record?.originTurnRef).toBe('call-9')
  })

  it('宿主 sessionContext 回落:agent 缺席时取注入值;注入 turnRef 优先于 callId', async () => {
    const definitions = defineMemoryTools(memory, () => ({ sessionId: 'glue-sess', turnRef: 'turn-3' }))
    await toolIn(definitions, 'memory_write').execute(
      { subject: 'user', key: 'prov-glue', content: '宿主注入正文', kind: 'semantic' },
      execOf(undefined, 'call-10'),
    )
    const record = memory.readEntity('user', 'prov-glue')
    expect(record?.originSessionId).toBe('glue-sess')
    expect(record?.originTurnRef).toBe('turn-3')
  })

  it('注入 getter 抛异常不阻断写入(防御调用);attachMemory 穿线 host.sessionContext 到工具', async () => {
    const broken: ToolDefinition[] = []
    attachMemory({
      registerTool: (definition) => { broken.push(definition); return () => undefined },
      registerPromptSection: () => () => undefined,
      sessionContext: () => { throw new Error('glue 侧故障') },
    }, memory, { includeIndexSection: false })
    const result = await toolIn(broken, 'memory_write').execute(
      { subject: 'user', key: 'prov-glue-throw', content: '注入面故障正文', kind: 'semantic' },
      execOf(undefined, 'call-11'),
    )
    expect(result).toMatchObject({ ok: true, decision: 'add' })
    expect(memory.readEntity('user', 'prov-glue-throw')?.originSessionId).toBeNull()

    const threaded: ToolDefinition[] = []
    attachMemory({
      registerTool: (definition) => { threaded.push(definition); return () => undefined },
      registerPromptSection: () => () => undefined,
      sessionContext: (): MemorySessionContext => ({ sessionId: 'host-sess' }),
    }, memory, { includeIndexSection: false })
    await toolIn(threaded, 'memory_write').execute(
      { subject: 'user', key: 'prov-host-thread', content: '穿线正文', kind: 'semantic' },
      execOf(undefined, 'call-12'),
    )
    expect(memory.readEntity('user', 'prov-host-thread')?.originSessionId).toBe('host-sess')
  })
})

describe('M-M1 T2:review_state 写入口判定(非模型参数,统一在 writeEntity)', () => {
  it('explicit=true → approved(source=explicit)', async () => {
    await tool('memory_write').execute(
      { subject: 'user', key: 'explicit-approve', content: '用户显式要求记住这条', kind: 'semantic', explicit: true },
      fakeExec,
    )
    expect(memory.readEntity('user', 'explicit-approve')?.reviewState).toBe('approved')
  })

  it('user+semantic(非显式)→ pending;批准后才可检索', async () => {
    await tool('memory_write').execute(
      { subject: 'user', key: 'user-semantic', content: '用户层语义记忆待审', kind: 'semantic' },
      fakeExec,
    )
    const record = memory.readEntity('user', 'user-semantic')
    expect(record?.reviewState).toBe('pending')
    expect((await memory.search('待审', { includeNotes: false })).filter(hit => hit.kind === 'entity')).toHaveLength(0)
    memory.review(record!.id, 'approved')
    expect((await memory.search('待审', { includeNotes: false })).filter(hit => hit.kind === 'entity')).toHaveLength(1)
  })

  it('domain+episodic → approved(静默档);domain+semantic → pending', async () => {
    await tool('memory_write').execute(
      { subject: 'domain:deploy', key: 'epi', content: '本次会话完成蓝绿发布演练', kind: 'episodic' }, fakeExec,
    )
    expect(memory.readEntity('domain:deploy', 'epi')?.reviewState).toBe('approved')
    await tool('memory_write').execute(
      { subject: 'domain:deploy', key: 'sem', content: '部署窗口固定在周四凌晨两点', kind: 'semantic' }, fakeExec,
    )
    expect(memory.readEntity('domain:deploy', 'sem')?.reviewState).toBe('pending')
  })

  it('source=compaction 强制 pending(即使携带 reviewState=approved 也不生效)', () => {
    const { record } = memory.writeEntity({
      subject: 'domain:deploy', key: 'compaction-summary', content: '摘要来源提案正文', kind: 'semantic',
      source: 'compaction', reviewState: 'approved',
    })
    expect(record.reviewState).toBe('pending')
  })
})

describe('M-M1 T2:四操作决策(add / update / noop,重叠阈值 0.6 / 0.9)', () => {
  it('重叠口径锚定:合并窗口样本对落在 [0.6, 0.9),几乎一致样本对 ≥0.9', () => {
    const base = '部署走蓝绿发布流程四步'
    const extendsIt = '部署走蓝绿发布流程四步与回滚'
    const nearIdentical = `${base}哦`
    expect(tokenOverlapRatio(base, extendsIt)).toBeGreaterThanOrEqual(MEMORY_DEDUP_MERGE_OVERLAP)
    expect(tokenOverlapRatio(base, extendsIt)).toBeLessThan(MEMORY_DEDUP_NOOP_OVERLAP)
    expect(tokenOverlapRatio(base, nearIdentical)).toBeGreaterThanOrEqual(MEMORY_DEDUP_NOOP_OVERLAP)
  })

  it('add:无同键 live 行且无近似行 → decision add', async () => {
    const result = await tool('memory_write').execute(
      { subject: 'domain:deploy', key: 'fresh-fact', content: '全新独立事实内容', kind: 'semantic' },
      fakeExec,
    )
    expect(result).toMatchObject({ ok: true, decision: 'add' })
  })

  it('update(同键顶替,既有语义):同 (subject,key) 内容有实质变化', async () => {
    await tool('memory_write').execute(
      { subject: 'domain:deploy', key: 'release-flow', content: '部署走蓝绿发布流程四步', kind: 'semantic' }, fakeExec,
    )
    const result = await tool('memory_write').execute(
      { subject: 'domain:deploy', key: 'release-flow', content: '部署改为金丝雀发布流程', kind: 'semantic' }, fakeExec,
    )
    expect(result).toMatchObject({ ok: true, decision: 'update', supersededCount: 1 })
  })

  it('update(跨键强制合并):重叠 ∈ [0.6,0.9) → 内容合并写入既有 key,返回被更新的 key', async () => {
    await tool('memory_write').execute(
      { subject: 'domain:deploy', key: 'release-flow', content: '部署走蓝绿发布流程四步', kind: 'semantic' }, fakeExec,
    )
    const result = await tool('memory_write').execute(
      { subject: 'domain:deploy', key: 'release-steps', content: '部署走蓝绿发布流程四步与回滚', kind: 'semantic' }, fakeExec,
    )
    expect(result).toMatchObject({
      ok: true, decision: 'update',
      key: 'release-flow',            // 写入的是既有 key(即被更新的 key)
      mergedFromKey: 'release-steps', // 模型请求的 key 未新建
    })
    const merged = memory.readEntity('domain:deploy', 'release-flow')
    expect(merged?.content).toContain('部署走蓝绿发布流程四步')
    expect(merged?.content).toContain('回滚')
    expect(memory.readEntity('domain:deploy', 'release-steps')).toBeNull()
  })

  it('noop(同键):内容几乎一致(≥0.9)→ 拒绝写入,返回既有 key,行数不变', async () => {
    await tool('memory_write').execute(
      { subject: 'domain:deploy', key: 'noop-key', content: '部署走蓝绿发布流程四步', kind: 'semantic' }, fakeExec,
    )
    const before = memory.entities.count()
    const result = await tool('memory_write').execute(
      { subject: 'domain:deploy', key: 'noop-key', content: '部署走蓝绿发布流程四步哦', kind: 'semantic' }, fakeExec,
    )
    expect(result).toMatchObject({ ok: true, decision: 'noop', existingKey: 'noop-key' })
    expect(memory.entities.count()).toBe(before)
  })

  it('noop(跨键):与既有近似行几乎一致 → 拒绝写入并指回既有 key', async () => {
    await tool('memory_write').execute(
      { subject: 'domain:deploy', key: 'noop-base', content: '部署走蓝绿发布流程四步', kind: 'semantic' }, fakeExec,
    )
    const result = await tool('memory_write').execute(
      { subject: 'domain:deploy', key: 'noop-dup', content: '部署走蓝绿发布流程四步哦', kind: 'semantic' }, fakeExec,
    )
    expect(result).toMatchObject({ ok: true, decision: 'noop', existingKey: 'noop-base' })
    expect(memory.readEntity('domain:deploy', 'noop-dup')).toBeNull()
  })
})

describe('M-M1 T2:memory_search scope/domain_key 过滤(先过滤后排序)', () => {
  it('scope=user 取不到高置信 domain 行;domain_key 限定单域', async () => {
    await memory.writeEntity({
      subject: 'domain:deploy', key: 'notify-blue-green', content: '部署通知走蓝绿灰度', kind: 'episodic', confidence: 0.99,
    })
    await memory.writeEntity({
      subject: 'user', scope: 'user', source: 'explicit', key: 'notify-chinese', content: '通知统一用中文格式', confidence: 0.5,
    })
    const titles = (value: unknown): string[] =>
      (value as { hits: Array<{ title: string }> }).hits.map(hit => hit.title)
    const all = await tool('memory_search').execute({ query: '通知' }, fakeExec)
    expect(titles(all)).toEqual(['domain:deploy/notify-blue-green', 'user/notify-chinese']) // 未过滤:高置信在前
    const scoped = await tool('memory_search').execute({ query: '通知', scope: 'user' }, fakeExec)
    expect(titles(scoped)).toEqual(['user/notify-chinese']) // 高置信 domain 行被过滤,不进排序
    const byDomain = await tool('memory_search').execute({ query: '通知', domain_key: 'deploy' }, fakeExec)
    expect(titles(byDomain)).toEqual(['domain:deploy/notify-blue-green'])
  })

  it('domain_key 过滤限定单域:另一域的同词行不出现(域间不串检索)', async () => {
    await memory.writeEntity({ subject: 'domain:deploy', key: 'notify-deploy', content: '部署通知走蓝绿', kind: 'episodic' })
    await memory.writeEntity({ subject: 'domain:writing', key: 'notify-writing', content: '周报通知附带摘要', kind: 'episodic' })
    const result = await tool('memory_search').execute({ query: '通知', domain_key: 'writing' }, fakeExec)
    const hits = (result as { hits: Array<{ title: string }> }).hits
    expect(hits.map(hit => hit.title)).toEqual(['domain:writing/notify-writing'])
  })
})

describe('M-M1 T2:Memory 管理面(review / listForReview / touch / supersede)', () => {
  it('listForReview 列 pending;review 落定出队;touch 计数;supersede 软失效留档', async () => {
    await tool('memory_write').execute(
      { subject: 'user', key: 'review-flow', content: '待审记忆正文', kind: 'semantic' }, fakeExec,
    )
    const record = memory.readEntity('user', 'review-flow')
    expect(memory.listForReview('pending').map(row => row.id)).toEqual([record!.id])

    expect(memory.touch([record!.id, record!.id])).toBe(1) // 同批重复 id 去重
    expect(memory.readEntity('user', 'review-flow')?.useCount).toBe(1)

    expect(memory.review(record!.id, 'approved')?.reviewState).toBe('approved')
    expect(memory.listForReview('pending')).toHaveLength(0)

    const superseded = memory.supersede(record!.id)
    expect(superseded?.invalidAt).not.toBeNull()
    expect(superseded?.reviewState).toBe('approved') // Gm1 软失效不动 review_state
    expect(memory.readEntity('user', 'review-flow')).toBeNull() // live 读取不可见
    expect(memory.entities.readAll('user', 'review-flow')).toHaveLength(1) // 物理行留档可审计
    expect(memory.supersede(record!.id)).toBeNull() // 非 live 行再调返回 null
  })

  it('M-M2 T9:withReviewAudit 包装——review 落定记一行审计;行不存在不记;其余成员透传', async () => {
    const { MemoryAuditLedger, withReviewAudit } = await import('../src/index.ts')
    const ledger = new MemoryAuditLedger({ path: join(dir, 'memory-audit.jsonl') })
    const audited = withReviewAudit(memory, ledger)

    await tool('memory_write').execute(
      { subject: 'user', key: 'audit-review-flow', content: '待审记忆正文', kind: 'semantic' }, fakeExec,
    )
    const record = memory.readEntity('user', 'audit-review-flow')
    // 命中:返回值透传 + 一行 review 事件(账本键位:kind/time/id/decision/subject/key)
    expect(audited.review(record!.id, 'rejected')?.reviewState).toBe('rejected')
    const events = ledger.readAll()
    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({
      kind: 'review', id: record!.id, decision: 'rejected', subject: 'user', key: 'audit-review-flow',
    })
    expect(typeof events[0]?.time).toBe('string')

    // 未命中(越界 id):没有裁决发生,不记行
    expect(audited.review(999_999, 'approved')).toBeNull()
    expect(ledger.readAll()).toHaveLength(1)

    // 其余成员透传(包装对象仍是完整 Memory 面)
    expect(audited.listForReview('pending')).toHaveLength(0)
    expect(audited.id).toBe(memory.id)
    expect(audited.writeEntity({ subject: 'user', key: 'passthrough', content: '透传写入', kind: 'episodic' }).decision).toBe('add')
  })
})

// ---------- M-M1 T3(19 号 §3-T3):召回前缀 + 索引选项解析器 ----------

describe('M-M1 T3:召回前缀(memory_search 命中组装进上下文时附一行)', () => {
  it('有命中:render 文本首行为召回前缀,其后是完整规范 JSON(可解析回原值)', async () => {
    await tool('memory_write').execute({ subject: 'domain:acme', key: 'venue', content: '科技园报告厅', kind: 'episodic' }, fakeExec)
    const result = await tool('memory_search').execute({ query: '科技园' }, fakeExec)
    const blocks = tool('memory_search').output.render({ query: '科技园' }, result as Record<string, never>)
    const text = (blocks[0] as { text: string }).text
    expect(text.startsWith(`${MEMORY_SEARCH_RESULT_PREFIX}\n`)).toBe(true)
    expect(JSON.parse(text.slice(MEMORY_SEARCH_RESULT_PREFIX.length + 1))).toEqual(result)
  })

  it('零命中:不附前缀(没有召回正文要组装)', async () => {
    const result = await tool('memory_search').execute({ query: '不存在的检索词' }, fakeExec)
    const blocks = tool('memory_search').output.render({ query: '不存在的检索词' }, result as Record<string, never>)
    const text = (blocks[0] as { text: string }).text
    expect(text.startsWith(MEMORY_SEARCH_RESULT_PREFIX)).toBe(false)
    expect(JSON.parse(text)).toEqual(result)
  })
})

// ---------- M-M1 T5(19 号 §3-T5):召回前缀登记读取面(runtime.memory.search-prefix) ----------

describe('M-M1 T5:召回前缀登记读取面(runtime.memory.search-prefix)', () => {
  /** 以给定读取面组工具组,取 memory_search 的 render 文本(count=1 有命中)。 */
  function searchRender(promptSource?: PromptRegistryFace, value: Record<string, never> = { ok: true, count: 1 } as never): string {
    const search = toolIn(defineMemoryTools(memory, undefined, promptSource), 'memory_search')
    const blocks = search.output.render({ query: 'q' }, value)
    return (blocks[0] as { text: string }).text
  }

  it('注册表在场:前缀取条目当前文本,且以 MEMORY_SEARCH_PREFIX_REGISTRY_ENTRY_ID 取值', () => {
    const asked: string[] = []
    const face: PromptRegistryFace = {
      resolveRuntimePromptText: (entryId) => {
        asked.push(entryId)
        return '召回前缀(注册表版 V1)'
      },
    }
    expect(searchRender(face).startsWith('召回前缀(注册表版 V1)\n')).toBe(true)
    expect(asked).toEqual([MEMORY_SEARCH_PREFIX_REGISTRY_ENTRY_ID])
  })

  it('注册表缺席/无版本/读取抛 → 内置兜底 MEMORY_SEARCH_RESULT_PREFIX(不炸宿主纪律)', () => {
    expect(searchRender().startsWith(`${MEMORY_SEARCH_RESULT_PREFIX}\n`)).toBe(true)
    expect(searchRender({ resolveRuntimePromptText: () => undefined }).startsWith(`${MEMORY_SEARCH_RESULT_PREFIX}\n`)).toBe(true)
    expect(searchRender({ resolveRuntimePromptText: () => { throw new Error('注册表读取面故障') } }).startsWith(`${MEMORY_SEARCH_RESULT_PREFIX}\n`)).toBe(true)
  })

  it('attachMemory 穿线 promptSource 到 search render:前缀随注册表版本变化;零命中仍不加前缀', () => {
    let current = '召回前缀(挂载物读注册表 V1)'
    const face: PromptRegistryFace = { resolveRuntimePromptText: () => current }
    const captured: ToolDefinition[] = []
    const host: MemoryHost = {
      registerTool: (definition) => {
        captured.push(definition)
        return () => undefined
      },
      registerPromptSection: () => () => undefined,
    }
    attachMemory(host, memory, { promptSource: face })
    const search = toolIn(captured, 'memory_search')
    const renderOf = (value: Record<string, never>): string =>
      ((search.output.render({ query: 'q' }, value)) as { text: string }[])[0]!.text
    expect(renderOf({ ok: true, count: 1 } as never).startsWith('召回前缀(挂载物读注册表 V1)\n')).toBe(true)
    current = '召回前缀(挂载物读注册表 V2)'
    expect(renderOf({ ok: true, count: 1 } as never).startsWith('召回前缀(挂载物读注册表 V2)\n')).toBe(true)
    expect(renderOf({ ok: true, count: 0 } as never).startsWith('召回前缀')).toBe(false)
  })
})

describe('M-M1 T3:createMemoryIndexSection 选项解析器(portrait/domainKey 每轮装配现取)', () => {
  it('options 为函数:每轮装配现取——portrait 上桌即进画像区,下桌即省略', () => {
    let portrait: string | undefined = undefined
    const section = createMemoryIndexSection(memory, () => ({ ...(portrait !== undefined && { portrait }) }))
    const render = section.text as () => string
    expect(render()).not.toContain('## 用户画像')
    portrait = '偏好中文沟通'
    expect(render()).toContain('## 用户画像')
    expect(render()).toContain('偏好中文沟通')
    portrait = undefined
    expect(render()).not.toContain('## 用户画像')
  })

  it('解析器抛异常:装配不炸,回落空选项(内置行为头照常)', () => {
    let boom = false
    const section = createMemoryIndexSection(memory, () => {
      if (boom) throw new Error('glue 侧故障')
      return {}
    })
    const render = section.text as () => string
    boom = true
    expect(render).not.toThrow()
    expect(render()).toContain(MEMORY_BEHAVIOR_HEADER)
  })

  it('attachMemory 穿线解析器形态的 index(静态对象形态不受影响)', () => {
    const captured: { text: string | ((context: never) => string) }[] = []
    attachMemory({
      registerTool: () => () => undefined,
      registerPromptSection: (section) => { captured.push({ text: section.text }); return () => undefined },
    }, memory, { index: () => ({ portrait: '画像注入正文' }) })
    const render = captured[0]?.text as () => string
    expect(render()).toContain('## 用户画像')
    expect(render()).toContain('画像注入正文')
  })
})
