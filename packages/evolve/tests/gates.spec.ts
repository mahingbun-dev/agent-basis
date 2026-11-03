/**
 * G0/G1/G2 门禁编排器单测:
 * - G0 真调 @basis/packctl lintPack 库函数(demo pack 过 / 弄坏 SKILL.md 挂);
 * - G1 真调 @basis/evals runPack replay 库函数(smoke case 过 / 坏 fixture 挂 /
 *   threshold.yml 模板缝隙显式豁免);
 * - G2 mock runner 注入;G0 短路;verification 报告落账形态。
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import { runGate0, runGate1, runGates } from '../src/index.ts'
import type { AievoGateConfig } from '../src/index.ts'
import { lintPack } from '@basis/packctl'
import { makeDemoPack, rmPack, SKILL_REL } from './helpers.ts'
import type { DemoPack } from './helpers.ts'

let demo: DemoPack
let outRoot: string

const aievoPass: AievoGateConfig = {
  baseUrl: 'https://aievo.example',
  tasks: { release: { name: 'task-release-gate' }, admission: { name: 'task-admission-gate' }, heldout: { name: 'task-heldout-gate' } },
  runner: async (_file, args) => ({ code: 0, stdout: `ok ${args[2]}`, stderr: '' }),
}

beforeAll(async () => {
  demo = await makeDemoPack()
  outRoot = await fs.mkdtemp(path.join(path.dirname(demo.rootDir), 'basis-evolve-gates-'))
  // mkdtemp 与 demo.rootDir 同 tmp 根但不同目录;此处 dirname(demo.rootDir) 是 tmp 根。
})

afterAll(async () => {
  await rmPack(demo)
  await fs.rm(outRoot, { recursive: true, force: true })
})

describe('G0:packctl lint 库函数', () => {
  it('demo pack(init 产物 + 双条目 SKILL.md)零 error', () => {
    const g0 = runGate0(demo.packDir)
    expect(g0.pass, g0.detail).toBe(true)
    // 与 @basis/packctl 直接调用一致性
    const direct = lintPack(demo.packDir)
    expect(direct.findings.filter(f => f.severity === 'error')).toHaveLength(0)
  })

  it('弄坏 SKILL.md(锚点不配对)→ fail 且带 findings 定位', async () => {
    const broken = path.join(demo.packDir, SKILL_REL)
    const original = await fs.readFile(broken, 'utf8')
    await fs.writeFile(broken, original.replace('<!-- /E -->', '<!-- /E2 -->'), 'utf8')
    const g0 = runGate0(demo.packDir)
    expect(g0.pass).toBe(false)
    expect(g0.errors.length).toBeGreaterThan(0)
    expect(g0.errors[0]?.code).toMatch(/^SKILL/)
    await fs.writeFile(broken, original, 'utf8')
    expect(runGate0(demo.packDir).pass).toBe(true)
  })
})

describe('G1:evals replay 库函数', () => {
  it('smoke 子集全过(replay adapter + 终态快照断言)', async () => {
    const g1 = await runGate1(demo.packDir, 'smoke', path.join(outRoot, 'g1-ok'))
    expect(g1.pass, g1.detail).toBe(true)
    expect(g1.total).toBe(1)
    expect(g1.loadErrors).toEqual([])
    const report = await fs.readFile(path.join(outRoot, 'g1-ok', 'report.md'), 'utf8')
    expect(report).toContain('smoke-evolution')
  })

  it('终态断言失败(fixture 缺终态文件)→ fail', async () => {
    const fixture = path.join(demo.packDir, 'fixtures/smoke-evolution.jsonl')
    const original = await fs.readFile(fixture, 'utf8')
    // JSON.stringify 产物无空格:直接替换键名,让快照物化到别的文件
    const tampered = original.replace('"out/result.md"', '"out/other.md"')
    expect(tampered).not.toBe(original)
    await fs.writeFile(fixture, tampered, 'utf8')
    const g1 = await runGate1(demo.packDir, 'smoke', path.join(outRoot, 'g1-fail'))
    expect(g1.pass).toBe(false)
    expect(g1.failed.length).toBe(1)
    expect(g1.failed[0]?.message).toContain('file_assert')
    await fs.writeFile(fixture, original, 'utf8')
  })

  it('子集为空 → fail(至少 1 条)', async () => {
    const g1 = await runGate1(demo.packDir, 'nonexistent-subset', path.join(outRoot, 'g1-empty'))
    expect(g1.pass).toBe(false)
    expect(g1.total).toBe(0)
  })
})

describe('runGates 编排', () => {
  it('G0+G1 过 + G2 mock 全 0 → pass;verification 报告完整', async () => {
    const result = await runGates({ packDir: demo.packDir, outDir: path.join(outRoot, 'gates-pass'), aievo: aievoPass })
    expect(result.verdict).toBe('pass')
    expect(result.g0.pass).toBe(true)
    expect(result.g1.pass).toBe(true)
    expect(result.g2.verdict).toBe('pass')
    expect(result.verification.g0.pass).toBe(true)
    expect(result.verification.g1.pass).toBe(true)
    expect(result.verification.g2.pass).toBe(true)
    expect(result.verification.probe).toBe('not-run') // 探针集未接入,如实记录
  })

  it('G0 短路:lint 挂 → verdict fail,G1/G2 不跑;恢复后回绿', async () => {
    const persona = path.join(demo.packDir, 'persona.md')
    const original = await fs.readFile(persona, 'utf8')
    await fs.rm(persona)
    const result = await runGates({ packDir: demo.packDir, outDir: path.join(outRoot, 'gates-g0'), aievo: aievoPass })
    expect(result.verdict).toBe('fail')
    expect(result.g0.pass).toBe(false)
    expect(result.g1.total).toBe(0)
    expect(result.g1.detail).toContain('短路')
    expect(result.verification.g1.detail).toContain('短路')
    await fs.writeFile(persona, original, 'utf8')
    expect(runGate0(demo.packDir).pass).toBe(true)
  })

  it('G2 未接入 → 降级不阻塞(pass);verification 记 skipped', async () => {
    const result = await runGates({ packDir: demo.packDir, outDir: path.join(outRoot, 'gates-degraded') })
    expect(result.verdict).toBe('pass')
    expect(result.g2.verdict).toBe('degraded')
    expect(result.g2.tasks.every(t => t.status === 'skipped')).toBe(true)
    expect(result.verification.g2.skipped).toBe(true)
    expect(result.verification.g2.detail).toContain('降级跳过')
  })

  it('G2 exit 1 → verdict fail(fail-closed)', async () => {
    const result = await runGates({
      packDir: demo.packDir,
      outDir: path.join(outRoot, 'gates-g2fail'),
      aievo: { ...aievoPass, runner: async (_f, args) => ({ code: args[2] === 'task-heldout-gate' ? 1 : 0, stdout: '', stderr: 'held-out 不达标' }) },
    })
    expect(result.verdict).toBe('fail')
    expect(result.g2.tasks[2]?.status).toBe('fail-threshold')
    expect(result.verification.g2.pass).toBe(false)
  })
})
