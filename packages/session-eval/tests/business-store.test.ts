/**
 * 业务指标覆盖层存取:账号路径安全、原子写、版本乐观锁、损坏文件拒绝覆盖、
 * upsert 保序(56 号 §9.2/§9.4)。
 */
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { EMPTY_BUSINESS_FILE, type BusinessMetric } from '../src/business-metrics.ts'
import { businessMetricsPath, readBusinessFile, saveBusinessMetric } from '../src/business-store.ts'

const NOW = Date.UTC(2026, 10, 25, 2, 0, 0)

function inputOf(key: string, patch: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    key,
    name: `指标 ${key}`,
    category: 'outcome',
    scope: 'session',
    answer: { not_contains: ['稍等'] },
    ...patch,
  }
}

let dir: string
let path: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'eterna-business-metrics-'))
  path = join(dir, 'workspaces', 'alice', '.eterna', 'eval', 'metrics.yaml')
})
afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

describe('businessMetricsPath', () => {
  it('按 DSH_HOME 语义拼账号覆盖层路径', () => {
    expect(businessMetricsPath('/srv/home', 'alice')).toBe('/srv/home/workspaces/alice/.eterna/eval/metrics.yaml')
  })

  it('拒绝穿越/分隔符/非法账号(不把原始输入拼进路径)', () => {
    for (const bad of ['..', '.', '../alice', 'a/b', 'a\\b', 'a', 'b'.repeat(33), 'alice!']) {
      expect(() => businessMetricsPath('/srv/home', bad)).toThrow('账号不合法')
    }
  })
})

describe('readBusinessFile', () => {
  it('缺失文件 → 空文件(version 0,无 warning)', () => {
    expect(readBusinessFile(path)).toEqual({ file: EMPTY_BUSINESS_FILE })
  })

  it('损坏文件 → 空文件 + warning + 原文(供设置页提示与原始内容回显)', () => {
    mkdirSync(join(dir, 'workspaces', 'alice', '.eterna', 'eval'), { recursive: true })
    writeFileSync(path, 'version: [\n', 'utf8')
    const read = readBusinessFile(path)
    expect(read.file).toEqual(EMPTY_BUSINESS_FILE)
    expect(read.warning).toContain('YAML 解析失败')
    expect(read.raw).toBe('version: [\n')
  })
})

describe('saveBusinessMetric', () => {
  it('首次保存 → 建目录/写文件/version 1;条目 version 1;头部带更新者与时刻', () => {
    const reply = saveBusinessMetric(path, inputOf('no-hedge'), { baseVersion: 0, updatedBy: 'alice', now: NOW })
    expect(reply.ok).toBe(true)
    if (!reply.ok) return
    expect(reply.version).toBe(1)
    expect(reply.metric).toMatchObject({ key: 'no-hedge', version: 1, enabled: true })
    const text = readFileSync(path, 'utf8')
    expect(text).toBe(reply.yaml)
    expect(text).toContain('# 版本：v1 · 更新于 2026-11-25T02:00:00.000Z · 更新者 alice')
    expect(text).toContain('  - key: no-hedge')
  })

  it('再次保存同一 key → 版本递增、位置不变;新增条目追加在尾部', () => {
    const first = saveBusinessMetric(path, inputOf('no-hedge'), { baseVersion: 0, updatedBy: 'alice', now: NOW })
    expect(first.ok).toBe(true)
    const second = saveBusinessMetric(path, inputOf('lean-budget', { answer: undefined, budget: { max_turns: 6, max_tokens: 9_000 } }), {
      baseVersion: 1, updatedBy: 'alice', now: NOW,
    })
    expect(second.ok).toBe(true)
    const third = saveBusinessMetric(path, inputOf('no-hedge', { name: '回复禁语 v2' }), {
      baseVersion: 2, updatedBy: 'alice', now: NOW,
    })
    expect(third.ok).toBe(true)
    if (!third.ok) return
    expect(third.version).toBe(3)
    expect(third.metric.version).toBe(2)
    expect(third.metric.name).toBe('回复禁语 v2')
    expect(third.file.metrics.map(metric => metric.key)).toEqual(['no-hedge', 'lean-budget'])
    expect(third.file.metrics[0]?.version).toBe(2)
    expect(third.file.metrics[1]?.version).toBe(1)
  })

  it('版本冲突 → conflict,文件不动', () => {
    saveBusinessMetric(path, inputOf('no-hedge'), { baseVersion: 0, updatedBy: 'alice', now: NOW })
    const before = readFileSync(path, 'utf8')
    const reply = saveBusinessMetric(path, inputOf('no-hedge'), { baseVersion: 0, updatedBy: 'bob', now: NOW })
    expect(reply).toMatchObject({ ok: false, code: 'conflict' })
    if (!reply.ok) expect(reply.error).toContain('当前 v1')
    expect(readFileSync(path, 'utf8')).toBe(before)
  })

  it('条目校验失败 → invalid,文件不动', () => {
    saveBusinessMetric(path, inputOf('no-hedge'), { baseVersion: 0, updatedBy: 'alice', now: NOW })
    const before = readFileSync(path, 'utf8')
    const reply = saveBusinessMetric(path, inputOf('Bad-Key'), { baseVersion: 1, updatedBy: 'alice', now: NOW })
    expect(reply).toMatchObject({ ok: false, code: 'invalid' })
    if (!reply.ok) expect(reply.error).toContain('标识必须匹配')
    expect(readFileSync(path, 'utf8')).toBe(before)
  })

  it('现有文件损坏 → 拒绝覆盖(不拿空文件顶掉人工内容)', () => {
    mkdirSync(join(dir, 'workspaces', 'alice', '.eterna', 'eval'), { recursive: true })
    writeFileSync(path, 'version: [\n', 'utf8')
    const reply = saveBusinessMetric(path, inputOf('no-hedge'), { baseVersion: 0, updatedBy: 'alice', now: NOW })
    expect(reply).toMatchObject({ ok: false, code: 'invalid' })
    if (!reply.ok) expect(reply.error).toContain('无法解析')
    expect(readFileSync(path, 'utf8')).toBe('version: [\n')
  })

  it('写失败(目标是目录)→ io,不泄漏系统错误', () => {
    mkdirSync(path, { recursive: true })
    const reply = saveBusinessMetric(path, inputOf('no-hedge'), { baseVersion: 0, updatedBy: 'alice', now: NOW })
    expect(reply).toMatchObject({ ok: false, code: 'io' })
    if (!reply.ok) expect(reply.error).toBe('写入失败：评测数据目录不可写。')
  })

  it('原子写:成功后目录里没有临时文件残留', () => {
    saveBusinessMetric(path, inputOf('no-hedge'), { baseVersion: 0, updatedBy: 'alice', now: NOW })
    const entries = readdirSync(join(dir, 'workspaces', 'alice', '.eterna', 'eval'))
    expect(entries).toEqual(['metrics.yaml'])
  })

  it('停用以 enabled:false 落盘(不删行)', () => {
    saveBusinessMetric(path, inputOf('no-hedge'), { baseVersion: 0, updatedBy: 'alice', now: NOW })
    const reply = saveBusinessMetric(path, inputOf('no-hedge', { enabled: false }), {
      baseVersion: 1, updatedBy: 'alice', now: NOW,
    })
    expect(reply.ok).toBe(true)
    if (!reply.ok) return
    const stored = reply.file.metrics[0] as BusinessMetric
    expect(stored.enabled).toBe(false)
    expect(readFileSync(path, 'utf8')).toContain('    enabled: false')
  })
})
