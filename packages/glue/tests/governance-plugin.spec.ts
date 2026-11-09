/**
 * governance 插件 pre-execute 接线单测(T8 三测之一:waterfall veto)。
 *
 * 覆盖:deny 短路(后续监听者不执行)、allow 透传(不短路后续;后续 deny 不可回翻)、
 * ask 透传后回填(downstream deny 优先;downstream allow 时 ask 生效)、决策审计直投、
 * 卸载逆闭包。瀑布语义依据:vendor/cordis/src/events.ts:76-85(veto)、
 * packages/core/tools/src/pipeline.ts:199-224(ask/deny 内核处置)。
 */
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import { GOVERNANCE_SERVICE_ID, defineGovernancePlugin } from '../src/plugins/governance-plugin.ts'
import type { GovernanceWorld } from '../src/plugins/governance-plugin.ts'
import { makeFakeContext } from './fake-context.ts'
import type { PreToolDecisionLike } from './fake-context.ts'

const RULES_YAML = `
rules:
  - { id: deny-rm, effect: deny, tools: ['shell*'], argsContains: ['rm -rf'] }
  - { id: ask-money, effect: ask, tools: ['pay'], argsContains: ['payment'] }
  - { id: allow-read, effect: allow, tools: ['read_*'] }
default: ask
`

const tempDirs: string[] = []
const disposers: (() => void)[] = []

afterEach(async () => {
  for (const dispose of disposers.splice(0)) dispose()
  await Promise.all(tempDirs.map(dir => rm(dir, { recursive: true, force: true })))
  tempDirs.length = 0
})

async function mountGovernance(config: Parameters<typeof defineGovernancePlugin>[0] = {}, yaml: string = RULES_YAML) {
  const dir = await mkdtemp(join(tmpdir(), 'basis-glue-governance-'))
  tempDirs.push(dir)
  const rulesPath = join(dir, 'governance.rules.yml')
  await writeFile(rulesPath, yaml, 'utf8')
  const harness = makeFakeContext()
  const plugin = defineGovernancePlugin({ rulesPath, ...config })
  disposers.push(plugin.apply(harness.fake as unknown as Context))
  return { harness, world: harness.service(GOVERNANCE_SERVICE_ID) as GovernanceWorld | undefined }
}

/** 注册一个下游监听器(默认 veto 为 allow;可指定决策),返回调用间谍。 */
function addDownstream(harness: ReturnType<typeof makeFakeContext>, verdict: PreToolDecisionLike = { kind: 'allow' }) {
  const spy = vi.fn((_exec: unknown, _next: unknown): Promise<PreToolDecisionLike> => Promise.resolve(verdict))
  harness.fake.on('tools/pre-execute', spy)
  return spy
}

describe('governance 插件:ctx.governance 服务(扩 GovernanceWorld.gate)', () => {
  it('provide("governance") 带 rules/pii/gate 三面;gate.preExecute 直判', async () => {
    const { harness, world } = await mountGovernance()
    expect(harness.services()).toEqual([GOVERNANCE_SERVICE_ID])
    expect(world?.rules.policy.default).toBe('ask')
    expect(world?.pii).toBeDefined()
    expect(world?.gate.preExecute({ name: 'shell', arguments: { cmd: 'rm -rf /' } }).kind).toBe('deny')
    expect(world?.gate.preExecute({ name: 'pay', arguments: { action: 'payment' } }).kind).toBe('ask')
    expect(world?.gate.preExecute({ name: 'read_file' }).kind).toBe('allow')
  })
})

describe('governance 插件:tools/pre-execute 瀑布 veto', () => {
  it('deny 短路:返回 veto,后续监听者不执行,理由保留', async () => {
    const { harness } = await mountGovernance()
    const downstream = addDownstream(harness)
    const decision = await harness.dispatchPreExecute({ name: 'shell', arguments: { cmd: 'rm -rf /' } })
    expect(decision.kind).toBe('deny')
    if (decision.kind === 'deny') expect(decision.reason).toContain('deny-rm')
    expect(downstream).not.toHaveBeenCalled()
  })

  it('allow 透传:后续监听者被执行(不短路,§3.4 缺口 1)', async () => {
    const { harness } = await mountGovernance()
    const downstream = addDownstream(harness)
    expect((await harness.dispatchPreExecute({ name: 'read_file' })).kind).toBe('allow')
    expect(downstream).toHaveBeenCalledTimes(1)
  })

  it('后续 deny 不会被 governance 的 allow 回翻', async () => {
    const { harness } = await mountGovernance()
    const downstream = addDownstream(harness, { kind: 'deny', reason: '领域包说不行' })
    const decision = await harness.dispatchPreExecute({ name: 'read_file' })
    expect(decision.kind).toBe('deny')
    if (decision.kind === 'deny') expect(decision.reason).toBe('领域包说不行')
    expect(downstream).toHaveBeenCalledTimes(1)
  })

  it('ask 透传后回填:downstream deny 优先,不让人审白跑', async () => {
    const { harness } = await mountGovernance()
    const downstream = addDownstream(harness, { kind: 'deny', reason: '[egress] 目的地被拒' })
    const denied = await harness.dispatchPreExecute({ name: 'pay', arguments: { action: 'payment' } })
    expect(denied.kind).toBe('deny')
    if (denied.kind === 'deny') expect(denied.reason).toBe('[egress] 目的地被拒')
    expect(downstream).toHaveBeenCalledTimes(1)
  })

  it('ask 回填:downstream allow 时本 ask 生效', async () => {
    const { harness } = await mountGovernance()
    const downstream = addDownstream(harness)
    const askStands = await harness.dispatchPreExecute({ name: 'pay', arguments: { action: 'payment' } })
    expect(askStands.kind).toBe('ask')
    if (askStands.kind === 'ask') expect(askStands.reason).toContain('ask-money')
    expect(downstream).toHaveBeenCalledTimes(1)
  })

  it('空规则集 fail-closed:未命中走 default ask(规则文件不存在 = 空规则集)', async () => {
    const harness = makeFakeContext()
    disposers.push(defineGovernancePlugin({ rulesPath: join(tmpdir(), 'basis-glue-nonexistent', 'rules.yml') }).apply(harness.fake as unknown as Context))
    addDownstream(harness)
    expect((await harness.dispatchPreExecute({ name: 'anything' })).kind).toBe('ask')
  })
})

describe('governance 插件:决策审计直投(组合层桥接)', () => {
  it('deny/ask 经 ctx.audit.report 落痕(含 actor);allow 不投', async () => {
    const { harness } = await mountGovernance()
    const report = vi.fn<(detail: Record<string, unknown>) => void>()
    harness.provide('audit', { report })
    addDownstream(harness)

    await harness.dispatchPreExecute({ name: 'shell', arguments: { cmd: 'rm -rf /' } })
    expect(report).toHaveBeenCalledTimes(1)
    expect(report.mock.calls[0]?.[0]).toMatchObject({
      source: 'glue-governance',
      event: 'tools/pre-execute',
      tool: 'shell',
      decision: 'deny',
      actor: { pluginId: 'basis-governance', source: 'decision' },
    })

    await harness.dispatchPreExecute({ name: 'read_file' })
    expect(report).toHaveBeenCalledTimes(1) // allow 不直投(事件流 tool-call 记录兜底)

    await harness.dispatchPreExecute({ name: 'pay', arguments: { action: 'payment' } })
    expect(report).toHaveBeenCalledTimes(2)
    expect(report.mock.calls[1]?.[0]).toMatchObject({ decision: 'ask', tool: 'pay' })
  })

  it('ctx.audit 缺席时静默跳过,决策不受影响', async () => {
    const { harness } = await mountGovernance()
    addDownstream(harness)
    const decision = await harness.dispatchPreExecute({ name: 'shell', arguments: { cmd: 'rm -rf /' } })
    expect(decision.kind).toBe('deny')
  })
})

describe('governance 插件:卸载逆闭包', () => {
  it('卸载摘除 pre-execute 监听并撤销服务', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'basis-glue-governance-'))
    tempDirs.push(dir)
    await writeFile(join(dir, 'governance.rules.yml'), RULES_YAML, 'utf8')
    const harness = makeFakeContext()
    const plugin = defineGovernancePlugin({ rulesPath: join(dir, 'governance.rules.yml') })
    const disposer = plugin.apply(harness.fake as unknown as Context)
    expect(harness.listenersOf('tools/pre-execute')).toHaveLength(1)

    disposer()
    await Promise.resolve() // provide disposer(async)落地窗口
    expect(harness.listenersOf('tools/pre-execute')).toHaveLength(0)
    expect(harness.services()).toEqual([])
  })
})
