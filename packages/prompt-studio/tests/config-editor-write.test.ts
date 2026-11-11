/**
 * T2.1 写穿 configEditor 热生效(测试计划 §4 T2.1):
 * - ① 注入假 ConfigEditorFace(接口照抄 packages/llm-doctor/src/index.ts:42-54):
 *   edit() 收到正确的行 entry id 与 change 返回的整行覆写(目标键已替换、未触动
 *   子树按引用共享——`!!js` 原节点 `{__jsExpr}` 保真,官方序列化往返的前提);
 * - ② configEditor 缺席(get 抛 / undefined)→ 自动落 persona-patch 纯文本重述
 *   兜底,审计 committed 记 channel='entry-patch' + channelNote(降级原因)——
 *   照抄 llm-doctor resolveConfigEditor 的 try/catch 防御(llm-doctor:118-125);
 * - ③ 写成功后热生效验证钩子(宿主内 dump-config 干跑)失败 → 回滚已写状态
 *   (对齐 persona-patch.test.ts:159-167 的 verify-fail 还原纪律):字节回到审批前
 *   基线、版本零追加、审计 write-failed 记通道字段;seam 还原不可用时退字节级还原;
 * - ④ runGoverned 通道壳:TOCTOU 写前基线不符 → EntryToctouError,edit 零调用。
 *
 * 网关基类是 cordis Service(构造内 ctx.provide 注册)——测试用真实 cordis
 * Context,configEditor 以 provide 桩注入(llm-doctor/tests/host-plugin.test.ts 同款)。
 */
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { rmRetry } from './rm-retry.ts'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { remoteErrorOf } from '@deepseek-ai/dsh-typert-protocol'
import type { KvUnit } from '@deepseek-ai/dsh-storage'
import { LoopPromptGateway } from '../src/index.ts'
import { EntryPatchFile, EntryToctouError } from '../src/entry-patch.ts'
import { applyEntryToRowConfig, resolveConfigEditor } from '../src/config-editor-write.ts'
import type { ConfigEditorFace } from '../src/config-editor-write.ts'
import { getPromptRegistryEntry } from '../src/registry.ts'
import type { StudioContextLike } from '../src/types.ts'

const PERSONA_V1 = 'You are the Eterna enterprise assistant. T2-STUDIO-V1 红线:预算超支>5%必须触发审批;对外付款不得代付;比选必须中立。'
const RED_LINES = '红线:预算超支>5%必须触发审批;对外付款不得代付;比选必须中立。'

/** 与宿主 patch 同构的 fixture(含 !!js 行与 persona/agent-instructions 键)。 */
function fixturePatch(persona: string): string {
  return [
    '# fixture profile patch(T2.1 configEditor 通道)',
    '- id: preset-standard',
    "  name: '@deepseek-ai/dsh-agent-preset'",
    '  config:',
    '    id: standard',
    '    order: 1',
    '    plugins:',
    '      - id: persona',
    "        name: '@deepseek-ai/dsh-persona'",
    '        config:',
    `          prefix: '${persona}'`,
    '      - id: agent-instructions',
    "        name: '@deepseek-ai/dsh-agent-instructions'",
    '        config:',
    '          maxBytes: 65536',
    '      - id: tool-bash',
    "        name: '@deepseek-ai/dsh-tool-bash'",
    "        disabled: !!js process.platform === 'win32'",
    '      - id: tool-pwsh',
    "        name: '@deepseek-ai/dsh-tool-pwsh'",
    "        disabled: !!js process.platform !== 'win32'",
    '',
  ].join('\n')
}

/** 预设行 config 的对象形态(edit 的 current;!!js 以 {__jsExpr} 原节点在场)。 */
function presetRowConfig(persona: string): Record<string, unknown> {
  return {
    id: 'standard',
    order: 1,
    plugins: [
      { id: 'persona', name: '@deepseek-ai/dsh-persona', config: { prefix: persona } },
      { id: 'agent-instructions', name: '@deepseek-ai/dsh-agent-instructions', config: { maxBytes: 65536 } },
      { id: 'tool-bash', name: '@deepseek-ai/dsh-tool-bash', disabled: { __jsExpr: "process.platform === 'win32'" } },
      { id: 'tool-pwsh', name: '@deepseek-ai/dsh-tool-pwsh', disabled: { __jsExpr: "process.platform !== 'win32'" } },
    ],
  }
}

/**
 * 记录型 configEditor 假体(llm-doctor/tests/host-plugin.test.ts:26-41 同款升级):
 * - entries() 返回**可变数组**(swapEntries 模拟 Loader 重组合替换条目对象);
 * - edit 先校验 entries().includes(entry)(对齐官方 seam lib/index.js:73 的
 *   "Configuration entry is no longer available" 防线——陈旧引用直接拒);
 * - onEdit 行为钩子注入瞬态错误(HMR nested 等);不写文件(persist 钩子可选)。
 */
function fakeEditor(rows: { id: string; override: Record<string, unknown> }[], options: {
  readonly documentPath?: string
  readonly onEdit?: (attempt: number, entryId: string) => void
  readonly persist?: (entryId: string, next: Record<string, unknown>) => void
} = {}): {
  face: ConfigEditorFace
  edits: { id: string; next: Record<string, unknown>; current: Record<string, unknown>; entry: { options: { id: string } } }[]
  attempts: number
  swapEntries(next: { options: { id: string } }[]): void
} {
  let entries = rows.map(row => ({ options: { id: row.id } }))
  const edits: { id: string; next: Record<string, unknown>; current: Record<string, unknown>; entry: { options: { id: string } } }[] = []
  let attempts = 0
  const face: ConfigEditorFace = {
    entries: () => entries,
    configuration: () => rows.map((row, index) => ({ entry: entries[index], inherited: {}, override: row.override })),
    ...(options.documentPath !== undefined ? { documentPath: options.documentPath } : {}),
    edit: async (entry, change) => {
      attempts += 1
      // 官方防线:传入条目必须仍在活跃 entries()(陈旧引用=重组合已替换 → 拒)
      if (!entries.includes(entry)) throw new Error('Configuration entry is no longer available')
      options.onEdit?.(attempts, entry.options.id)
      const index = rows.findIndex(candidate => candidate.id === entry.options.id)
      if (index < 0) throw new Error(`未知行 ${entry.options.id}`)
      const current = structuredClone(rows[index]?.override ?? {})
      const next = change(current, {})
      rows[index]!.override = next
      options.persist?.(entry.options.id, next)
      edits.push({ id: entry.options.id, next, current, entry })
    },
  }
  return {
    face,
    edits,
    get attempts() { return attempts },
    swapEntries(next) { entries = next },
  }
}

/** 内存 KvUnit(host-plugin.test 同款最小面)。 */
class MemoryUnit {
  readonly tables = new Map<string, Map<string, unknown>>()
  async loadAll() {
    const tables: Record<string, Record<string, unknown>> = {}
    for (const [name, records] of this.tables) tables[name] = Object.fromEntries(records)
    return { tables, global: null }
  }
  async putRecord(table: string, key: string, value: unknown): Promise<void> {
    if (!this.tables.has(table)) this.tables.set(table, new Map())
    this.tables.get(table)?.set(key, value)
  }
  async close(): Promise<void> {}
}

function asStudio(ctx: Context): StudioContextLike {
  return ctx as unknown as StudioContextLike
}

/** 审计明细读取(兜底 NDJSON;先 flush 屏障——FileAuditSink 异步落账)。 */
async function auditDetails(gateway: LoopPromptGateway, path: string): Promise<Record<string, unknown>[]> {
  await gateway.audit.flush()
  return readFileSync(path, 'utf8').split('\n').filter(line => line.trim().length > 0)
    .map(line => JSON.parse(line) as { detail?: Record<string, unknown> })
    .map(record => record.detail ?? {})
}

describe('applyEntryToRowConfig(纯变换:条目定位 → 行 config 派生)', () => {
  it('persona 条目:目标键替换,其余子树按引用共享({__jsExpr} 原节点保真),入参不可变', () => {
    const entry = getPromptRegistryEntry('preset.standard.persona')
    expect(entry).toBeDefined()
    const row = presetRowConfig(PERSONA_V1)
    const snapshot = structuredClone(row)
    const next = applyEntryToRowConfig(entry!, row, '新 persona 前缀')
    expect(row).toEqual(snapshot) // 入参未被改动(纯变换)
    const plugins = next.plugins as Array<{ id?: string; config?: { prefix?: string } }>
    expect(plugins.find(item => item.id === 'persona')?.config?.prefix).toBe('新 persona 前缀')
    // 未触动子树引用共享:!!js 原节点同一对象(官方序列化往返不eval 的前提)
    const oldTool = (row.plugins as Array<{ id?: string; disabled?: unknown }>).find(item => item.id === 'tool-bash')?.disabled
    const newTool = (next.plugins as Array<{ id?: string; disabled?: unknown }>).find(item => item.id === 'tool-bash')?.disabled
    expect(newTool).toBe(oldTool)
    expect((newTool as { __jsExpr?: string }).__jsExpr).toBe("process.platform === 'win32'")
    expect(next.id).toBe('standard')
    expect(next.order).toBe(1)
  })

  it('plan-mode 嵌套条目:组行 config(序列)内逐级导航,整段 section 替换', () => {
    const entry = getPromptRegistryEntry('preset.standard.plan-mode.section')
    expect(entry).toBeDefined()
    const row = {
      plugins: [
        { id: 'persona', config: { prefix: 'x' } },
        { id: 'planning', name: 'cordis:group', group: true, config: [
          { id: 'plan-mode', name: '@deepseek-ai/dsh-plan-mode', config: { section: '旧 plan 段落。\n\n第二段。' } },
        ] },
      ],
    }
    const next = applyEntryToRowConfig(entry!, row, '新 plan 段落。')
    const planning = (next.plugins as Array<{ id?: string; config?: unknown }>).find(item => item.id === 'planning')
    const planMode = (planning?.config as Array<{ id?: string; config?: { section?: string } }>)[0]
    expect(planMode?.config?.section).toBe('新 plan 段落。')
    expect((next.plugins as Array<{ id?: string }>)[0]?.id).toBe('persona')
  })

  it('maxBytes 数值条目:纯整数文本保持数值类型(写回字符串会改 config 值类型)', () => {
    const entry = getPromptRegistryEntry('preset.standard.agent-instructions')
    expect(entry).toBeDefined()
    const row = presetRowConfig(PERSONA_V1)
    const next = applyEntryToRowConfig(entry!, row, '65537')
    const plugins = next.plugins as Array<{ id?: string; config?: { maxBytes?: unknown } }>
    expect(plugins.find(item => item.id === 'agent-instructions')?.config?.maxBytes).toBe(65537)
  })

  it('fail-closed:0/≥2 命中、plugins 缺席、末级 config 非对象、组行无嵌套列表 → 抛(零写入)', () => {
    const persona = getPromptRegistryEntry('preset.standard.persona')!
    expect(() => applyEntryToRowConfig(persona, { plugins: [] }, 'x')).toThrow(/命中 0 项/)
    expect(() => applyEntryToRowConfig(persona, { plugins: [
      { id: 'persona', config: {} }, { id: 'persona', config: {} },
    ] }, 'x')).toThrow(/命中 2 项/)
    expect(() => applyEntryToRowConfig(persona, {}, 'x')).toThrow(/config\.plugins 非插件列表/)
    expect(() => applyEntryToRowConfig(persona, { plugins: [{ id: 'persona' }] }, 'x')).toThrow(/config 非对象/)
    const planMode = getPromptRegistryEntry('preset.standard.plan-mode.section')!
    expect(() => applyEntryToRowConfig(planMode, { plugins: [{ id: 'planning', config: { order: 1 } }] }, 'x'))
      .toThrow(/无嵌套插件列表/)
    const wholeFile = getPromptRegistryEntry('domain.event-planning.persona-md')!
    expect(() => applyEntryToRowConfig(wholeFile, {}, 'x')).toThrow(/无 YAML 定位/)
  })

  it('无 pluginPath 条目(行级键):直接置 configKey(数值类型同样对齐)', () => {
    const row = { personaPrefix: '旧前缀', order: 3 }
    const domain = getPromptRegistryEntry('domain.event-planning.persona-prefix')!
    const next = applyEntryToRowConfig(domain, row, '新前缀')
    expect(next.personaPrefix).toBe('新前缀')
    expect(next.order).toBe(3)
  })
})

describe('resolveConfigEditor(缺席防御,llm-doctor 同款)', () => {
  it('bare Context(未 provide)→ undefined 不抛', () => {
    expect(resolveConfigEditor(asStudio(new Context()))).toBeUndefined()
  })

  it('get 抛错 → undefined 不炸', () => {
    const throwing = { get(name: string): unknown { throw new Error(`解析失败 ${name}`) } }
    expect(resolveConfigEditor(throwing)).toBeUndefined()
  })

  it('provide 桩 → 解析到假体', () => {
    const ctx = new Context()
    const { face } = fakeEditor([{ id: 'preset-standard', override: {} }])
    ctx.provide('configEditor', face)
    expect(resolveConfigEditor(asStudio(ctx))).toBe(face)
  })
})

describe('写链路 configEditor 通道(真实 cordis 根 Context + 桩注入)', () => {
  let dir: string
  let patchPath: string
  let auditPath: string
  let unit: MemoryUnit

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'eterna-prompt-studio-cfgedit-'))
    patchPath = join(dir, 'cordis.patch.yml')
    auditPath = join(dir, 'audit.jsonl')
    writeFileSync(patchPath, fixturePatch(PERSONA_V1), 'utf8')
    unit = new MemoryUnit()
  })

  afterEach(async () => {
    await rmRetry(dir)
  })

  async function makeGateway(ctx: StudioContextLike): Promise<LoopPromptGateway> {
    const gateway = new LoopPromptGateway(ctx, { patchPath, sessionsRoot: join(dir, 'sessions'), auditFilePath: auditPath, dryRunVerify: false })
    const backend = { kv: { open: async () => unit as unknown as KvUnit }, close: async () => undefined }
    await gateway.attachBackend(backend)
    return gateway
  }

  async function twoPhaseSave(gateway: LoopPromptGateway, content: string): Promise<void> {
    const phase1 = await gateway.promptSave({ content, author: 'alice' })
    expect(phase1.status).toBe('approval-required')
    const phase2 = await gateway.promptSave({ content, author: 'alice', approvalId: phase1.approval?.approvalId ?? '', approved: true })
    expect(phase2.status).toBe('committed')
  }

  it('① configEditor 在场:edit 收到正确行 id 与整行覆写;审计 channel=config-editor;不双写', async () => {
    const ctx = new Context()
    const { face, edits } = fakeEditor([{ id: 'preset-standard', override: presetRowConfig(PERSONA_V1) }])
    ctx.provide('configEditor', face)
    const gateway = await makeGateway(asStudio(ctx))
    const next = `${PERSONA_V1}\n${RED_LINES} T2 新增`
    await twoPhaseSave(gateway, next)
    expect(edits).toHaveLength(1)
    expect(edits[0]?.id).toBe('preset-standard')
    const returned = edits[0]!.next
    // change 返回的覆写:目标键=新文;其余子树(含 __jsExpr 原节点)原样
    const plugins = returned.plugins as Array<{ id?: string; config?: Record<string, unknown>; disabled?: unknown }>
    expect(plugins.find(item => item.id === 'persona')?.config?.prefix).toBe(next)
    expect(plugins.find(item => item.id === 'agent-instructions')?.config?.maxBytes).toBe(65536)
    expect(plugins.find(item => item.id === 'tool-bash')?.disabled).toEqual({ __jsExpr: "process.platform === 'win32'" })
    // seam 拥有写盘权:本通道不得再直写 patch(记录型假体不写文件 → 文件保持原值)
    expect(readFileSync(patchPath, 'utf8')).toBe(fixturePatch(PERSONA_V1))
    // 审计 committed 记通道字段
    const committed = (await auditDetails(gateway, auditPath)).find(record => record.action === 'prompt-save.committed')
    expect(committed?.channel).toBe('config-editor')
    await gateway.dispose()
  })

  it('② configEditor 缺席(未 provide)→ persona-patch 直写兜底 + 审计 channel=entry-patch(服务缺席)', async () => {
    const gateway = await makeGateway(asStudio(new Context()))
    const next = `${PERSONA_V1}\n${RED_LINES} 兜底直写`
    await twoPhaseSave(gateway, next)
    // 直写兜底:patch 被纯文本重述更新
    expect(readFileSync(patchPath, 'utf8')).toContain('兜底直写')
    const committed = (await auditDetails(gateway, auditPath)).find(record => record.action === 'prompt-save.committed')
    expect(committed?.channel).toBe('entry-patch')
    expect(String(committed?.channelNote)).toContain('configEditor 服务缺席')
    await gateway.dispose()
  })

  it('② ctx.get(非 configEditor) 解析正常但 get(configEditor) 抛 → 同样兜底不炸', async () => {
    const real = new Context()
    const throwing = new Proxy(real, {
      get(target: Context, prop: string | symbol): unknown {
        if (prop === 'get') {
          return (name: string): unknown => {
            if (name === 'configEditor') throw new Error('service resolution boom')
            return real.get(name)
          }
        }
        const value = Reflect.get(target, prop, target) as unknown
        return typeof value === 'function' ? (value as (...args: unknown[]) => unknown).bind(target) : value
      },
    })
    const gateway = await makeGateway(asStudio(throwing))
    const next = `${PERSONA_V1}\n${RED_LINES} 抛错兜底`
    await twoPhaseSave(gateway, next)
    expect(readFileSync(patchPath, 'utf8')).toContain('抛错兜底')
    const committed = (await auditDetails(gateway, auditPath)).find(record => record.action === 'prompt-save.committed')
    expect(committed?.channel).toBe('entry-patch')
    await gateway.dispose()
  })

  it('② 行不在活跃条目(预设行缺席)→ 兜底直写 + channelNote 明示行缺失', async () => {
    const ctx = new Context()
    const { face } = fakeEditor([{ id: 'llm-pi-ai', override: { providers: {} } }])
    ctx.provide('configEditor', face)
    const gateway = await makeGateway(asStudio(ctx))
    const next = `${PERSONA_V1}\n${RED_LINES} 行缺失兜底`
    await twoPhaseSave(gateway, next)
    expect(readFileSync(patchPath, 'utf8')).toContain('行缺失兜底')
    const committed = (await auditDetails(gateway, auditPath)).find(record => record.action === 'prompt-save.committed')
    expect(committed?.channel).toBe('entry-patch')
    expect(String(committed?.channelNote)).toContain('preset-standard')
    await gateway.dispose()
  })

  it('③ verify(dump-config 干跑)失败 → seam 还原回审批前行 config,字节=基线,版本零追加,审计 write-failed 记通道', async () => {
    const ctx = new Context()
    const baseline = fixturePatch(PERSONA_V1)
    // 有状态假体:edit 把行 config 渲染回 fixture 同构文本(模拟官方 seam 的持久化)
    const holder = { current: presetRowConfig(PERSONA_V1) }
    const liveEntry = { options: { id: 'preset-standard' } }
    const edits: { id: string; next: Record<string, unknown> }[] = []
    const face: ConfigEditorFace = {
      entries: () => [liveEntry],
      configuration: () => [{ entry: liveEntry, inherited: {}, override: structuredClone(holder.current) }],
      edit: async (entry, change) => {
        // 官方防线(同 seam lib/index.js:73):传入条目必须在活跃 entries() 内
        if (entry !== liveEntry) throw new Error('Configuration entry is no longer available')
        const next = change(structuredClone(holder.current), {})
        holder.current = next
        const persona = (next.plugins as Array<{ id?: string; config?: { prefix?: string } }>).find(item => item.id === 'persona')?.config?.prefix ?? ''
        writeFileSync(patchPath, fixturePatch(persona), 'utf8')
        edits.push({ id: entry.options.id, next })
      },
    }
    ctx.provide('configEditor', face)
    const gateway = await makeGateway(asStudio(ctx))
    gateway.dryRunVerify = async () => { throw new Error('dump-config 干跑未通过') }
    const next = `${PERSONA_V1}\n${RED_LINES} 会被还原`
    const phase1 = await gateway.promptSave({ content: next, author: 'alice' })
    const failed = await gateway.promptSave({ content: next, author: 'alice', approvalId: phase1.approval?.approvalId ?? '', approved: true })
      .catch((cause: unknown) => cause)
    expect(remoteErrorOf(failed)?.code).toBe('gateway/bad-request')
    // 已写状态回滚:文件字节回到审批前基线;写与还原两次 edit(还原=整行旧行 config)
    expect(readFileSync(patchPath, 'utf8')).toBe(baseline)
    expect(edits).toHaveLength(2)
    expect(edits[1]?.next).toEqual(presetRowConfig(PERSONA_V1))
    // 版本零追加(写失败不入版本库)+ 审计 write-failed 记通道
    const versions = await gateway.promptVersions({})
    expect(versions.total).toBe(1)
    const writeFailed = (await auditDetails(gateway, auditPath)).find(record => record.action === 'prompt-save.write-failed')
    expect(writeFailed?.channel).toBe('config-editor')
    await gateway.dispose()
  })

  it('①b 瞬态错误退避重试:首次 edit 抛「HMR transactions cannot be nested」→ 重试成功(llm-doctor:186-202 先例)', async () => {
    const ctx = new Context()
    const editor = fakeEditor([{ id: 'preset-standard', override: presetRowConfig(PERSONA_V1) }], {
      onEdit: (attempt) => {
        if (attempt === 1) throw new Error('HMR transactions cannot be nested')
      },
    })
    ctx.provide('configEditor', editor.face)
    const gateway = await makeGateway(asStudio(ctx))
    gateway.configEditorRetryBackoffMs = 1
    const next = `${PERSONA_V1}\n${RED_LINES} 瞬态重试`
    await twoPhaseSave(gateway, next)
    // 第 1 次尝试瞬态失败 → 退避后第 2 次重取活引用成功落账(唯一一次生效写)
    expect(editor.attempts).toBe(2)
    expect(editor.edits).toHaveLength(1)
    const committed = (await auditDetails(gateway, auditPath)).find(record => record.action === 'prompt-save.committed')
    expect(committed?.channel).toBe('config-editor')
    await gateway.dispose()
  })

  it('①c 活引用竞态:run 阶段 entries() 已被重组合整体替换 → 每次尝试前重取,不用陈旧引用', async () => {
    const ctx = new Context()
    const editor = fakeEditor([{ id: 'preset-standard', override: presetRowConfig(PERSONA_V1) }])
    ctx.provide('configEditor', editor.face)
    const gateway = await makeGateway(asStudio(ctx))
    gateway.configEditorRetryBackoffMs = 1
    // 模拟:通道解析(链外)之后、单写者链轮到 run 之前,Loader 重组合替换了条目对象——
    // 旧引用对官方 includes 防线已失效(seam 对陈旧引用抛 no longer available)。
    const freshEntries = [{ options: { id: 'preset-standard' } }]
    editor.swapEntries(freshEntries)
    await gateway.editViaConfigEditor(editor.face, 'preset-standard', current => current)
    // edit 收到的必须是当前活跃 entries() 里的新对象(identity),而非链外缓存引用
    expect(editor.edits).toHaveLength(1)
    expect(editor.edits[0]!.entry).toBe(freshEntries[0])
    await gateway.dispose()
  })

  it('② 落点守卫 A:插件 config.patchPath 覆盖偏离宿主 profileContext.patchPath → 兜底直写(防三处落点错位)', async () => {
    const ctx = new Context()
    const editor = fakeEditor([{ id: 'preset-standard', override: presetRowConfig(PERSONA_V1) }])
    ctx.provide('configEditor', editor.face)
    ctx.provide('profileContext', { name: 'test-profile', dir, patchPath: join(dir, 'host-profile.patch.yml'), home: dir })
    const gateway = await makeGateway(asStudio(ctx))
    const next = `${PERSONA_V1}\n${RED_LINES} 落点守卫A`
    await twoPhaseSave(gateway, next)
    expect(readFileSync(patchPath, 'utf8')).toContain('落点守卫A')
    expect(editor.edits).toHaveLength(0) // seam 未被使用
    const committed = (await auditDetails(gateway, auditPath)).find(record => record.action === 'prompt-save.committed')
    expect(committed?.channel).toBe('entry-patch')
    expect(String(committed?.channelNote)).toContain('偏离宿主 profile patch')
    await gateway.dispose()
  })

  it('② 落点守卫 B:seam documentPath ≠ 本地 patch 落点 → 兜底直写(源码内直接验证 seam 持久化落点)', async () => {
    const ctx = new Context()
    const editor = fakeEditor([{ id: 'preset-standard', override: presetRowConfig(PERSONA_V1) }], {
      documentPath: join(dir, 'elsewhere.patch.yml'),
    })
    ctx.provide('configEditor', editor.face)
    const gateway = await makeGateway(asStudio(ctx))
    const next = `${PERSONA_V1}\n${RED_LINES} 落点守卫B`
    await twoPhaseSave(gateway, next)
    expect(readFileSync(patchPath, 'utf8')).toContain('落点守卫B')
    expect(editor.edits).toHaveLength(0)
    const committed = (await auditDetails(gateway, auditPath)).find(record => record.action === 'prompt-save.committed')
    expect(committed?.channel).toBe('entry-patch')
    expect(String(committed?.channelNote)).toContain('documentPath')
    await gateway.dispose()
  })

  it('③ seam 还原不可用(行被重组合移除)→ 退字节级还原,基线字节仍恢复', async () => {
    const ctx = new Context()
    const holder = { current: presetRowConfig(PERSONA_V1), entriesVisible: true }
    const liveEntry = { options: { id: 'preset-standard' } }
    const face: ConfigEditorFace = {
      entries: () => (holder.entriesVisible ? [liveEntry] : []),
      configuration: () => [{ entry: liveEntry, inherited: {}, override: structuredClone(holder.current) }],
      edit: async (_entry, change) => {
        const next = change(structuredClone(holder.current), {})
        holder.current = next
        // 首次 edit 后行被移除(模拟重组合后活引用失效)→ restore 无法再经 seam
        holder.entriesVisible = false
        const persona = (next.plugins as Array<{ id?: string; config?: { prefix?: string } }>).find(item => item.id === 'persona')?.config?.prefix ?? ''
        writeFileSync(patchPath, fixturePatch(persona), 'utf8')
      },
    }
    ctx.provide('configEditor', face)
    const gateway = await makeGateway(asStudio(ctx))
    gateway.configEditorRetryBackoffMs = 1 // 3 轮重取退避(1ms)耗尽后上抛,不拖慢测试
    gateway.dryRunVerify = async () => { throw new Error('dump-config 干跑未通过') }
    const next = `${PERSONA_V1}\n${RED_LINES} 字节级还原`
    const phase1 = await gateway.promptSave({ content: next, author: 'alice' })
    const failed = await gateway.promptSave({ content: next, author: 'alice', approvalId: phase1.approval?.approvalId ?? '', approved: true })
      .catch((cause: unknown) => cause)
    expect(remoteErrorOf(failed)?.code).toBe('gateway/bad-request')
    expect(readFileSync(patchPath, 'utf8')).toBe(fixturePatch(PERSONA_V1))
    await gateway.dispose()
  })
})

describe('EntryPatchFile.runGoverned(通道壳:TOCTOU + verify-fail 还原)', () => {
  let dir: string
  let path: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'eterna-prompt-studio-govrun-'))
    path = join(dir, 'cordis.patch.yml')
    writeFileSync(path, fixturePatch(PERSONA_V1), 'utf8')
  })

  afterEach(async () => {
    await rmRetry(dir)
  })

  it('TOCTOU 基线不符 → EntryToctouError,run 零调用,文件保持外部改写后状态', async () => {
    const writer = new EntryPatchFile()
    writeFileSync(path, `${fixturePatch(PERSONA_V1)}\n# 外部合并追加\n`, 'utf8')
    let runCalls = 0
    await expect(writer.runGoverned({
      path,
      baseline: fixturePatch(PERSONA_V1),
      run: async () => { runCalls += 1 },
    })).rejects.toBeInstanceOf(EntryToctouError)
    expect(runCalls).toBe(0)
    expect(readFileSync(path, 'utf8')).toContain('# 外部合并追加')
  })

  it('run+verify 成功 → restore 不被调用', async () => {
    const writer = new EntryPatchFile()
    let restoreCalls = 0
    await writer.runGoverned({
      path,
      baseline: fixturePatch(PERSONA_V1),
      run: async () => { writeFileSync(path, fixturePatch('新值'), 'utf8') },
      verify: async () => undefined,
      restore: async () => { restoreCalls += 1 },
    })
    expect(restoreCalls).toBe(0)
    expect(readFileSync(path, 'utf8')).toBe(fixturePatch('新值'))
  })
})
