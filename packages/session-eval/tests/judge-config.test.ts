/**
 * 裁判配置读写:严格校验(未知字段/越界拒绝)、缺省值、原子写与损坏回退。
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  judgeConfigPath, judgeStateRoot, judgeStorePath, parseJudgeConfig, readJudgeConfig, writeJudgeConfig,
} from '../src/judge-config.ts'
import { DEFAULT_JUDGE_CONFIG } from '../src/judge-types.ts'

const VALID = {
  enabled: true,
  route: { provider: 'deepseek', model: 'deepseek-chat' },
  sampling: 0.2,
  budgetTokensPerDay: 200_000,
  idleTimeoutMs: 120_000,
  metrics: { 'judge.answer_support': false },
}

describe('parseJudgeConfig', () => {
  it('合法配置原样通过(含 route=null 与缺省 idleTimeout)', () => {
    const parsed = parseJudgeConfig(VALID)
    expect(parsed.ok).toBe(true)
    if (parsed.ok) expect(parsed.config).toEqual(VALID)
    const noRoute = parseJudgeConfig({ ...VALID, route: null })
    expect(noRoute.ok).toBe(true)
    if (noRoute.ok) expect(noRoute.config.route).toBeNull()
    const withoutIdle = parseJudgeConfig({ ...VALID, idleTimeoutMs: undefined })
    expect(withoutIdle.ok).toBe(true)
    if (withoutIdle.ok) expect(withoutIdle.config.idleTimeoutMs).toBe(DEFAULT_JUDGE_CONFIG.idleTimeoutMs)
  })

  it('未知顶层字段/未知指标键拒绝(不吞手改错键)', () => {
    expect(parseJudgeConfig({ ...VALID, unknown: 1 })).toMatchObject({ ok: false })
    expect(parseJudgeConfig({ ...VALID, metrics: { 'judge.nope': true } })).toMatchObject({ ok: false })
  })

  it('越界值逐字段拒绝并给中文原因', () => {
    const cases: Array<[unknown, string]> = [
      [{ ...VALID, sampling: 2 }, 'sampling'],
      [{ ...VALID, sampling: -0.1 }, 'sampling'],
      [{ ...VALID, budgetTokensPerDay: 500 }, 'budgetTokensPerDay'],
      [{ ...VALID, budgetTokensPerDay: 1.5 }, 'budgetTokensPerDay'],
      [{ ...VALID, idleTimeoutMs: 10_000 }, 'idleTimeoutMs'],
      [{ ...VALID, route: { provider: 'deepseek' } }, 'route'],
      [{ ...VALID, enabled: 'yes' }, 'enabled'],
      [{ ...VALID, metrics: { 'judge.task_completion': 'yes' } }, 'metrics'],
      ['not-an-object', 'JSON 对象'],
    ]
    for (const [input, needle] of cases) {
      const parsed = parseJudgeConfig(input)
      expect(parsed.ok).toBe(false)
      if (!parsed.ok) expect(parsed.error).toContain(needle)
    }
  })
})

describe('readJudgeConfig / writeJudgeConfig', () => {
  let dir: string
  let path: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'eterna-judge-config-'))
    path = join(dir, '.eterna', 'session-eval', 'config.json')
  })
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('文件缺席 → 默认配置(不算错误)', () => {
    expect(readJudgeConfig(path)).toEqual({ config: DEFAULT_JUDGE_CONFIG })
  })

  it('写入后可原样读回(父目录懒建 + 原子写)', () => {
    writeJudgeConfig(path, VALID)
    expect(readJudgeConfig(path)).toEqual({ config: VALID })
  })

  it('文件损坏/不合法 → 回默认值 + 中文 warning(不炸面板)', () => {
    mkdirSync(join(dir, '.eterna', 'session-eval'), { recursive: true })
    writeFileSync(path, '{not json', 'utf8')
    const broken = readJudgeConfig(path)
    expect(broken.config).toEqual(DEFAULT_JUDGE_CONFIG)
    expect(broken.warning).toContain('无法解析')

    writeFileSync(path, JSON.stringify({ ...VALID, sampling: 9 }), 'utf8')
    const invalid = readJudgeConfig(path)
    expect(invalid.config).toEqual(DEFAULT_JUDGE_CONFIG)
    expect(invalid.warning).toContain('不合法')
  })

  it('路径函数统一落在 $DSH_HOME/.eterna/session-eval/', () => {
    expect(judgeStateRoot('/home/x')).toBe('/home/x/.eterna/session-eval')
    expect(judgeConfigPath('/home/x')).toBe('/home/x/.eterna/session-eval/config.json')
    expect(judgeStorePath('/home/x')).toBe('/home/x/.eterna/session-eval/scores.db')
  })
})
