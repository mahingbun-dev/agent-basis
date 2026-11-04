/**
 * CLI 行为单测:退出码约定(0 通过 / 1 有 error / 2 用法错误)、
 * packs/ 聚合、--json 输出、help。
 */
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { runPack } from '../src/cli.ts'
import { makePack, makeTmpRoot } from './helpers.ts'

const tmp = makeTmpRoot('packctl-cli-')
afterAll(() => { tmp.cleanup() })

function io() {
  const lines: string[] = []
  return { lines, cliIo: { cwd: tmp.root, writeLine: (l: string) => lines.push(l) } }
}

describe('用法错误(退出码 2)', () => {
  it('无命令 / 未知命令', () => {
    expect(runPack([], io().cliIo)).toBe(2)
    expect(runPack(['frobnicate'], io().cliIo)).toBe(2)
  })

  it('init 缺行业参数', () => {
    expect(runPack(['init'], io().cliIo)).toBe(2)
  })

  it('lint 给出的路径不是 pack 根', () => {
    const { lines, cliIo } = io()
    expect(runPack(['lint', join(tmp.root, 'definitely-not-here')], cliIo)).toBe(2)
    expect(lines.some(l => l.includes('不是领域包根'))).toBe(true)
  })
})

describe('init → lint → check 全链路(真实文件)', () => {
  it('init 退出码 0 并列出产物;lint 全绿退出码 0', () => {
    const { lines, cliIo } = io()
    expect(runPack(['init', 'legal', '--root', tmp.root], cliIo)).toBe(0)
    expect(lines.some(l => l.includes('已生成'))).toBe(true)

    const packDir = join(tmp.root, 'packs', 'legal')
    const lintIo = io()
    expect(runPack(['lint', packDir], lintIo.cliIo)).toBe(0)
    expect(lintIo.lines.some(l => l.includes('lint 通过'))).toBe(true)

    const checkIo = io()
    expect(runPack(['check', packDir], checkIo.cliIo)).toBe(0)
    expect(checkIo.lines.some(l => l.includes('CHK900'))).toBe(true)
  })

  it('cwd 在包内(不给路径)自动向上找 pack 根', () => {
    const packDir = makePack(tmp.root, 'deep')
    const nested = join(packDir, 'skills', 'core-workflow')
    const { cliIo } = io()
    expect(runPack(['lint'], { ...cliIo, cwd: nested })).toBe(0)
  })

  it('cwd 在仓库根 → 聚合 lint packs/ 下全部领域包', () => {
    makePack(tmp.root, 'agg-a')
    makePack(tmp.root, 'agg-b')
    const { lines, cliIo } = io()
    expect(runPack(['lint'], cliIo)).toBe(0)
    const packLines = lines.filter(l => l.startsWith('pack: '))
    expect(packLines.length).toBeGreaterThanOrEqual(2)
    expect(lines.some(l => l.includes('lint 通过'))).toBe(true)
  })

  it('--json 输出可解析的机读结果', () => {
    const { lines, cliIo } = io()
    const packDir = join(tmp.root, 'packs', 'agg-a')
    expect(runPack(['lint', packDir, '--json'], cliIo)).toBe(0)
    const parsed = JSON.parse(lines.join('\n')) as Array<{ packRoot: string; findings: unknown[] }>
    expect(parsed.length).toBe(1)
    // GOLD008(红线分布)对无红线 fixture 是预期警告,只断言无 error 级 finding
    const errs = (parsed[0]?.findings as Array<{ severity: string }>).filter(f => f.severity === 'error')
    expect(errs).toEqual([])
  })
})

describe('help', () => {
  it('help/--help/-h 退出码 0 并打印用法', () => {
    for (const cmd of ['help', '--help', '-h']) {
      const { lines, cliIo } = io()
      expect(runPack([cmd], cliIo)).toBe(0)
      expect(lines.join('\n')).toContain('packctl init')
    }
  })
})
