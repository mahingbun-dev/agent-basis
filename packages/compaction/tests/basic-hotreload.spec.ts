/**
 * basic 引擎热更新单测(_applyOverridesFromFile):overrides 文件三键应用、
 * 白名单外键忽略、非法值回退基线 + warn、mtime 未变不重读(读文件零调用)。
 *
 * mtime 门控经 vi.mock('node:fs') 冻结 statSync 的 mtime 实现:内容被改写但
 * mtime 不变时,第二次 apply 必须 early-return(readFileSync 零调用)。
 */
import { mkdirSync, readFileSync as realReadFileSync, statSync, writeFileSync } from 'node:fs'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// node:fs 的 mtime/readFileSync 统计面(仅冻结本 spec 内的引擎读路径;写路径走 actual)。
const fsProbe = vi.hoisted(() => ({
  frozenMtimeMs: null as number | null,
  engineReadCalls: 0,
}))

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>()
  return {
    ...actual,
    statSync: ((path: Parameters<typeof actual.statSync>[0]) => {
      if (fsProbe.frozenMtimeMs !== null) {
        return { mtimeMs: fsProbe.frozenMtimeMs } as unknown as ReturnType<typeof actual.statSync>
      }
      return actual.statSync(path)
    }) as typeof actual.statSync,
    readFileSync: ((path: Parameters<typeof actual.readFileSync>[0], options: Parameters<typeof actual.readFileSync>[1]) => {
      fsProbe.engineReadCalls += 1
      return actual.readFileSync(path, options)
    }) as typeof actual.readFileSync,
  }
})

import {
  applyOverridesFromFile,
  makeEngine,
  makeFakeEngineContext,
} from './helpers/fakes.ts'

let homeDir = ''

beforeEach(async () => {
  homeDir = await mkdtemp(join(tmpdir(), 'eterna-compaction-hotreload-'))
  process.env.DSH_HOME = homeDir
  fsProbe.frozenMtimeMs = null
  fsProbe.engineReadCalls = 0
})

afterEach(async () => {
  delete process.env.DSH_HOME
  await rm(homeDir, { recursive: true, force: true })
})

/** overrides 文件路径(与引擎 BasicCompactionEngine.overridesPath 同构)。 */
function overridesPath(): string {
  return join(homeDir, '.eterna', 'compaction.config.json')
}

function writeOverrides(content: string): void {
  mkdirSync(join(homeDir, '.eterna'), { recursive: true })
  writeFileSync(overridesPath(), content)
}

/** 干净引擎(不触发构造器副作用,由 makeEngine 铺字段)。 */
function makeHotEngine() {
  const harness = makeFakeEngineContext()
  const engine = makeEngine(harness.ctx, { thresholdRatio: 0.8, retainRatio: 0.16 })
  return { harness, engine }
}

describe('overrides 文件热更新', () => {
  it('三键(auto/thresholdRatio/retainRatio)应用生效', () => {
    const { harness, engine } = makeHotEngine()
    writeOverrides(JSON.stringify({ auto: false, thresholdRatio: 0.9, retainRatio: 0.2 }))
    applyOverridesFromFile(engine)

    expect(engine.config.auto).toBe(false)
    expect(engine.config.thresholdRatio).toBe(0.9)
    expect(engine.config.retainRatio).toBe(0.2)
    expect(harness.warns.length).toBe(0)
    // 状态文件同步刷新(宿主 admin 端点的读取源)。
    const state = JSON.parse(realReadFileSync(join(homeDir, '.eterna', 'compaction.state.json'), 'utf8')) as {
      auto: boolean
      thresholdRatio: number
    }
    expect(state.auto).toBe(false)
    expect(state.thresholdRatio).toBe(0.9)
  })

  it('白名单外键被忽略:merge 后仍是基线的策略表', () => {
    const { engine } = makeHotEngine()
    writeOverrides(JSON.stringify({
      auto: true,
      thresholdRatio: 0.85,
      modelPolicies: [{ provider: 'x', model: 'y', thresholdRatio: 0.1 }],
      retainTokens: 999,
      bogus: 'ignored',
    }))
    applyOverridesFromFile(engine)

    // 只有 auto/thresholdRatio 进入覆盖合并;modelPolicies/retainTokens/bogus 不在
    // 白名单读取面(基线 modelPolicies 未被 overrides 污染)。
    expect(engine.config.auto).toBe(true)
    expect(engine.config.thresholdRatio).toBe(0.85)
    expect(engine.config.modelPolicies).toEqual([])
    expect(engine.config.retainTokens).toBeUndefined()
    expect(engine.config.retainRatio).toBe(0.16)
  })

  it('非法组合回退基线并 warn,绝不落半生效状态', () => {
    const { harness, engine } = makeHotEngine()
    writeOverrides(JSON.stringify({ thresholdRatio: 1.5 }))
    applyOverridesFromFile(engine)

    expect(engine.config.thresholdRatio).toBe(0.8)
    expect(engine.config.retainRatio).toBe(0.16)
    expect(harness.warns.length).toBe(1)
    expect(harness.warns[0]).toContain('compaction overrides invalid')
  })

  it('overrides 文件为非法 JSON 时静默忽略(不改变基线)', () => {
    const { harness, engine } = makeHotEngine()
    writeOverrides('{not json')
    applyOverridesFromFile(engine)

    expect(engine.config.thresholdRatio).toBe(0.8)
    expect(harness.warns.length).toBe(0)
  })

  it('mtime 未变不重读:文件内容已被改写但读取次数为零', async () => {
    const { engine } = makeHotEngine()
    writeOverrides(JSON.stringify({ thresholdRatio: 0.9 }))
    applyOverridesFromFile(engine)
    expect(engine.config.thresholdRatio).toBe(0.9)
    const readsAfterFirst = fsProbe.engineReadCalls
    expect(readsAfterFirst).toBe(1)

    // 冻结 mtime,再把文件改写成另一个值:引擎必须因 mtime 相同而 early-return。
    fsProbe.frozenMtimeMs = statSync(overridesPath()).mtimeMs
    writeOverrides(JSON.stringify({ thresholdRatio: 0.7 }))
    applyOverridesFromFile(engine)
    fsProbe.frozenMtimeMs = null
    expect(engine.config.thresholdRatio).toBe(0.9)
    expect(fsProbe.engineReadCalls).toBe(readsAfterFirst)
    // 磁盘内容确实已是 0.7:证明跳过来自 mtime 门控,而非内容未变。
    const onDisk = JSON.parse(await readFile(overridesPath(), 'utf8')) as { thresholdRatio: number }
    expect(onDisk.thresholdRatio).toBe(0.7)
  })

  it('mtime 变化后恢复重读(冻结解除即拿新值)', () => {
    const { engine } = makeHotEngine()
    writeOverrides(JSON.stringify({ thresholdRatio: 0.9 }))
    applyOverridesFromFile(engine)
    writeOverrides(JSON.stringify({ thresholdRatio: 0.7 }))
    applyOverridesFromFile(engine)
    expect(engine.config.thresholdRatio).toBe(0.7)
  })

  it('updateConfig 进程内热更新写状态文件(同 realm 消费面)', () => {
    const { engine } = makeHotEngine()
    const next = engine.updateConfig({ thresholdRatio: 0.85, retainRatio: 0.17 })
    expect(next.thresholdRatio).toBe(0.85)
    expect(engine.config.thresholdRatio).toBe(0.85)
    const state = JSON.parse(realReadFileSync(join(homeDir, '.eterna', 'compaction.state.json'), 'utf8')) as {
      thresholdRatio: number
    }
    expect(state.thresholdRatio).toBe(0.85)
  })
})
