/**
 * aievo-cli 包装单测:命令构造纯函数 / 退出码 0-1-2 语义(mock runner)/
 * 未接入降级跳过 / CLI 执行失败归类。
 */
import { describe, expect, it } from 'vitest'
import { buildAievoCommand, runAievoGates } from '../src/index.ts'
import type { AievoGateConfig, AievoRunner } from '../src/index.ts'

const baseConfig: AievoGateConfig = {
  baseUrl: 'https://aievo.example',
  credentialsRef: 'aievo-ci-key',
  tasks: {
    release: { name: 'task-release-gate' },
    admission: { name: 'task-admission-gate' },
    heldout: { name: 'task-heldout-gate' },
  },
  timeoutMin: 60,
}

function runnerOf(exitByTask: Record<string, number>, log?: { file: string; args: readonly string[] }[]): AievoRunner {
  return async (file, args) => {
    log?.push({ file, args: [...args] })
    const task = args[2] ?? '' // run task <name> --wait …
    const code = exitByTask[task] ?? 0
    return { code, stdout: `task ${task} done`, stderr: code === 0 ? '' : 'threshold not met' }
  }
}

describe('buildAievoCommand', () => {
  it('构造 aievo run task <task> --wait [--base-url …] [--timeout-min …];不携带 secret', () => {
    expect(buildAievoCommand(baseConfig, 'release')).toEqual([
      'run', 'task', 'task-release-gate', '--wait', '--base-url', 'https://aievo.example', '--timeout-min', '60',
    ])
    expect(buildAievoCommand(baseConfig, 'heldout')[2]).toBe('task-heldout-gate')
    const { baseUrl: _baseUrl, timeoutMin: _timeoutMin, ...rest } = baseConfig
    void _baseUrl
    void _timeoutMin
    const noUrl: AievoGateConfig = rest
    expect(buildAievoCommand(noUrl, 'admission')).toEqual([
      'run', 'task', 'task-admission-gate', '--wait', '--timeout-min', '120',
    ])
    expect(buildAievoCommand(baseConfig, 'release').join(' ')).not.toContain('aievo-ci-key')
  })
})

describe('runAievoGates:退出码语义', () => {
  it('全 0 → pass;三条命令逐一执行', async () => {
    const calls: { file: string; args: readonly string[] }[] = []
    const result = await runAievoGates({ ...baseConfig, runner: runnerOf({}, calls) })
    expect(result.verdict).toBe('pass')
    expect(result.tasks.map(t => t.status)).toEqual(['pass', 'pass', 'pass'])
    expect(calls).toHaveLength(3)
    expect(calls[0]?.file).toBe('aievo')
    expect(calls.map(c => c.args[2])).toEqual(['task-release-gate', 'task-admission-gate', 'task-heldout-gate'])
  })

  it('exit 1 = fail-threshold(不达标);exit 2 = error;其余码也归平台错误(fail-closed)', async () => {
    const result = await runAievoGates({
      ...baseConfig,
      runner: runnerOf({ 'task-release-gate': 1, 'task-admission-gate': 2, 'task-heldout-gate': 137 }),
    })
    expect(result.verdict).toBe('fail')
    expect(result.tasks.map(t => t.status)).toEqual(['fail-threshold', 'error', 'error'])
    expect(result.tasks[0]?.exitCode).toBe(1)
    expect(result.tasks[0]?.detail).toContain('threshold not met')
  })

  it('未接入(baseUrl 空)→ 三任务 skipped,整体 degraded(真实执行可降级跳过)', async () => {
    const result = await runAievoGates({ ...baseConfig, baseUrl: '', runner: runnerOf({}) })
    expect(result.verdict).toBe('degraded')
    expect(result.tasks.every(t => t.status === 'skipped')).toBe(true)
    expect(result.tasks[0]?.detail).toContain('未配置 baseUrl')
  })

  it('单任务禁用 → 该任务 skipped,整体仍 pass(其余过)', async () => {
    const result = await runAievoGates({
      ...baseConfig,
      tasks: { release: { name: 'task-release-gate' }, admission: { name: 'task-admission-gate', disabled: true }, heldout: { name: 'task-heldout-gate' } },
      runner: runnerOf({}),
    })
    expect(result.tasks.map(t => t.status)).toEqual(['pass', 'skipped', 'pass'])
    expect(result.verdict).toBe('pass') // disabled ≠ 未接入:有 2 过 1 跳,不算 degraded
  })

  it('CLI 抛错(ENOENT 等)→ error 归类,整体 fail', async () => {
    const throwing: AievoRunner = async () => {
      throw new Error('spawn aievo ENOENT')
    }
    const result = await runAievoGates({ ...baseConfig, runner: throwing })
    expect(result.verdict).toBe('fail')
    expect(result.tasks.every(t => t.status === 'error')).toBe(true)
    expect(result.tasks[0]?.detail).toContain('ENOENT')
  })
})
