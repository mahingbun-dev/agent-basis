/**
 * interact 插件装配单测(39 号 §3-E8;形态照抄 governance-plugin.spec 的 fake ctx 模式)。
 *
 * 覆盖:ctx.interact 服务 provide(HitlPolicy 分档 + TurnQuestionMerger 实例 +
 * 负信号总线 + 预设产物)、hitl.yaml 三级来源(显式全文 > 文件 > 内置缺省;非法
 * 文件装载即抛 fail-closed)、负信号总线挂接(rejected 发布/unavailable 不发布
 * 的诚实边界,observe 经 subscribe/recent 消费)、卸载逆闭包(disposeInteract:
 * flush 未发提问卡 + 清空信号快照 + 撤服务)。
 */
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import { ApprovalSignalBus, InteractConfigError, TurnQuestionMerger } from '@eterna/interact'
import type { Interact } from '@eterna/interact'
import {
  DEFAULT_HITL_YAML, INTERACT_PLUGIN_SERVICE_ID, defineInteractPlugin,
} from '../src/plugins/interact-plugin.ts'
import { makeFakeContext } from './fake-context.ts'

const HITL_YAML = `
rules:
  - id: deploy-prod
    grade: R3
    tools: ['deploy_prod']
    reason: '生产部署属高危动作'
    escalate_to: ['oncall-feishu']
    cooling_period_sec: 30
    double_confirm: true
    on_no_answer: escalate
  - id: write-doc
    grade: R2
    tools: ['write_doc']
    reason: '可逆写需确认'
default_grade: R3
`

const tempDirs: string[] = []
const disposers: (() => void)[] = []

afterEach(async () => {
  for (const dispose of disposers.splice(0)) dispose()
  await Promise.all(tempDirs.map(dir => rm(dir, { recursive: true, force: true })))
  tempDirs.length = 0
})

/** 以显式 hitlYaml 全文挂载(不落盘)。 */
function mountWithYaml(hitlYaml: string, config: Parameters<typeof defineInteractPlugin>[0] = {}) {
  const harness = makeFakeContext()
  const plugin = defineInteractPlugin({ hitlYaml, ...config })
  disposers.push(plugin.apply(harness.fake as unknown as Context))
  return { harness, world: harness.service(INTERACT_PLUGIN_SERVICE_ID) as Interact }
}

/** 以 hitl.yaml 文件挂载(临时目录先写盘,apply 时读盘)。 */
async function mountWithFile(yaml: string = HITL_YAML, config: Parameters<typeof defineInteractPlugin>[0] = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'eterna-glue-interact-'))
  tempDirs.push(dir)
  const hitlPath = join(dir, 'hitl.yaml')
  await writeFile(hitlPath, yaml, 'utf8')
  const harness = makeFakeContext()
  const plugin = defineInteractPlugin({ hitlPath, ...config })
  disposers.push(plugin.apply(harness.fake as unknown as Context))
  return { harness, world: harness.service(INTERACT_PLUGIN_SERVICE_ID) as Interact }
}

describe('interact 插件:ctx.interact 服务 provide', () => {
  it('provide("interact") 带 hitl/ask/signals/presetArtifact 面;R3 规则分档命中', async () => {
    const { harness, world } = await mountWithFile()
    expect(harness.services()).toContain(INTERACT_PLUGIN_SERVICE_ID)
    expect(world.id).toBe('@eterna/interact')
    expect(world.hitl.gradeFor({ name: 'deploy_prod' })).toMatchObject({ grade: 'R3' })
    expect(world.hitl.gradeFor({ name: 'deploy_prod' }).rule?.escalateTo).toEqual(['oncall-feishu'])
    // 未命中 → default_grade R3(fail-closed 缺省档)
    expect(world.hitl.gradeFor({ name: 'unlisted_tool' }).grade).toBe('R3')
    expect(world.hitl.gradeFor({ name: 'write_doc' }).grade).toBe('R2')
  })

  it('ask = TurnQuestionMerger 实例;signals = ApprovalSignalBus 实例;预设产物以 eterna 前缀生成', async () => {
    const { world } = await mountWithFile()
    expect(world.ask).toBeInstanceOf(TurnQuestionMerger)
    expect(world.signals).toBeInstanceOf(ApprovalSignalBus)
    expect(Object.values(world.presetArtifact.gradeToPreset).join(',')).toContain('eterna')
    expect('buildApprovalCard' in world).toBe(true)
    expect('cardToQuestionItems' in world).toBe(true)
  })

  it('hitlYaml 显式全文优先于 hitlPath 文件(来源只影响数据,校验器唯一权威)', async () => {
    const { world } = await mountWithYaml('default_grade: R2\nrules: []\n')
    expect(world.hitl.gradeFor({ name: 'deploy_prod' })).toMatchObject({
      grade: 'R2',
      reason: '未命中任何 hitl.yaml 规则,回落 default_grade(fail-closed)',
    })
  })
})

describe('interact 插件:hitl.yaml 文件来源与 fail-closed', () => {
  it('文件缺席 = 内置缺省策略(default_grade R2 + on_no_answer suspend,boot 不炸)', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'eterna-glue-interact-'))
    tempDirs.push(dir)
    const harness = makeFakeContext()
    disposers.push(defineInteractPlugin({ hitlPath: join(dir, 'hitl.yaml') }).apply(harness.fake as unknown as Context))
    const world = harness.service(INTERACT_PLUGIN_SERVICE_ID) as Interact
    expect(world.hitl.document.defaultGrade).toBe('R2')
    expect(world.hitl.document.onNoAnswer).toBe('suspend')
    expect(world.hitl.document.rules).toEqual([])
    // 内置缺省全文的语义锚(default_grade R2 = 未命中动作必须走人,hitl.ts:104-106)
    expect(DEFAULT_HITL_YAML).toContain('default_grade: R2')
    expect(DEFAULT_HITL_YAML).toContain('on_no_answer: suspend')
  })

  it('文件存在但非法 = 装载即抛 InteractConfigError(fail-closed,boot 失败响亮)', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'eterna-glue-interact-'))
    tempDirs.push(dir)
    const hitlPath = join(dir, 'hitl.yaml')
    await writeFile(hitlPath, 'default_grade: R0\n', 'utf8')
    expect(() => defineInteractPlugin({ hitlPath }).apply(makeFakeContext().fake as unknown as Context))
      .toThrow(InteractConfigError)
  })
})

describe('interact 插件:负信号总线挂接', () => {
  it('rejected 发布进总线、unavailable 不发布(诚实边界);订阅/退订/快照可用', async () => {
    const { world } = await mountWithYaml('default_grade: R2\nrules: []\n')
    const signals = world.signals
    const seen: string[] = []
    const off = signals.subscribe(signal => seen.push(signal.kind))
    const rejected = signals.recordOutcome('rejected', { toolName: 'deploy_prod', grade: 'R3', ruleId: 'deploy-prod' })
    expect(rejected?.kind).toBe('rejected')
    // 'unavailable'=无应答者 fail-closed,不是用户否定 → 不发布(negative.ts:107-110)
    expect(signals.recordOutcome('unavailable', { toolName: 'deploy_prod', grade: 'R3' })).toBeUndefined()
    expect(signals.count).toBe(1)
    expect(signals.recent()[0]).toMatchObject({ kind: 'rejected', toolName: 'deploy_prod', ruleId: 'deploy-prod' })
    off()
    signals.recordModification({ toolName: 'deploy_prod', grade: 'R3' })
    expect(seen).toEqual(['rejected'])
  })
})

describe('interact 插件:卸载逆闭包(disposeInteract 语义)', () => {
  it('卸载 flush 未发提问卡(经 onFlush 正常发出)+ 清空信号快照 + 撤服务', async () => {
    const onFlush = vi.fn()
    const harness = makeFakeContext()
    const plugin = defineInteractPlugin({
      hitlYaml: 'default_grade: R2\nrules: []\n',
      ask: { onFlush },
    })
    const disposer = plugin.apply(harness.fake as unknown as Context)
    const world = harness.service(INTERACT_PLUGIN_SERVICE_ID) as Interact
    world.ask.add(1, [{ id: 'q1', question: '要把目录建在哪里?' }])
    world.signals.publish('rejected', { toolName: 'x', grade: 'R2' })
    expect(world.signals.count).toBe(1)
    expect(harness.services()).toContain(INTERACT_PLUGIN_SERVICE_ID)

    disposer()
    // flush 走 onFlush(不静默丢弃)+ 信号快照清空 + 服务撤除
    expect(onFlush).toHaveBeenCalledTimes(1)
    expect(onFlush.mock.calls[0]?.[0]).toMatchObject({ turnId: 1, questionCount: 1 })
    expect(world.signals.count).toBe(0)
    expect(harness.services()).not.toContain(INTERACT_PLUGIN_SERVICE_ID)
  })
})
