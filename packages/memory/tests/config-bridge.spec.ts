/**
 * 配置文件桥(M-M3 T12-①)与写入策略档位映射单测:
 * - parseMemoryOverrides 防御解析(未知键忽略/类型不符拒绝);
 * - resolveEffectiveFlags 基线叠加;
 * - readMemoryOverridesFile 文件读 fail-open(缺席/损坏/坏值回空表);
 * - resolveWriteReviewState 三档映射(explicit-only / auto-review / full-auto;
 *   compaction 来源强制 pending 的投毒防线不随档位放宽)。
 */
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import {
  DEFAULT_MEMORY_WRITE_POLICY, MEMORY_OVERRIDES_FILENAME, memoryOverridesDir, memoryOverridesDirForDb,
  memoryOverridesPath, memoryOverridesPathForDb, parseMemoryOverrides, parsedOverridesOf, readMemoryOverridesFile,
  resolveEffectiveFlags,
} from '../src/config-bridge.ts'
import { resolveWriteReviewState } from '../src/memory.ts'

const dir = mkdtempSync(join(tmpdir(), 'eterna-memory-config-'))
afterAll(() => {
  rmSync(dir, { recursive: true, force: true })
})

describe('parseMemoryOverrides(防御解析)', () => {
  it('合法载荷全键解析;未知键忽略', () => {
    const parsed = parseMemoryOverrides({ portraitEnabled: false, domainEnabled: false, writePolicy: 'full-auto', unknown: 1 })
    expect(parsedOverridesOf(parsed)).toEqual({ portraitEnabled: false, domainEnabled: false, writePolicy: 'full-auto' })
  })

  it('部分键载荷只收出场键', () => {
    expect(parsedOverridesOf(parseMemoryOverrides({ writePolicy: 'explicit-only' }))).toEqual({ writePolicy: 'explicit-only' })
    expect(parsedOverridesOf(parseMemoryOverrides({}))).toEqual({})
  })

  it('非对象/类型不符 → error(中文 message)', () => {
    expect(parseMemoryOverrides(null)).toHaveProperty('error')
    expect(parseMemoryOverrides('text')).toHaveProperty('error')
    expect(parseMemoryOverrides({ portraitEnabled: 'yes' })).toHaveProperty('error')
    expect(parseMemoryOverrides({ domainEnabled: 1 })).toHaveProperty('error')
    const badPolicy = parseMemoryOverrides({ writePolicy: 'no-gate' })
    expect(badPolicy).toHaveProperty('error')
    if ('error' in badPolicy) expect(badPolicy.error).toContain('writePolicy')
  })
})

describe('resolveEffectiveFlags(基线叠加)', () => {
  it('空表回落全缺省(true/true/auto-review)', () => {
    expect(resolveEffectiveFlags({})).toEqual({ portraitEnabled: true, domainEnabled: true, writePolicy: 'auto-review' })
  })
  it('覆盖键生效', () => {
    expect(resolveEffectiveFlags({ portraitEnabled: false, writePolicy: 'explicit-only' })).toEqual({
      portraitEnabled: false, domainEnabled: true, writePolicy: 'explicit-only',
    })
  })
  it('缺省档位常量 = auto-review', () => {
    expect(DEFAULT_MEMORY_WRITE_POLICY).toBe('auto-review')
  })
})

describe('readMemoryOverridesFile(文件桥 fail-open)', () => {
  it('文件缺席 → 空表', () => {
    expect(readMemoryOverridesFile(join(dir, 'absent.json'))).toEqual({})
  })
  it('合法文件 → 解析', () => {
    const path = join(dir, 'ok.json')
    writeFileSync(path, JSON.stringify({ domainEnabled: false }))
    expect(readMemoryOverridesFile(path)).toEqual({ domainEnabled: false })
  })
  it('损坏 JSON/坏字段 → 空表(不炸热应用路径)', () => {
    const broken = join(dir, 'broken.json')
    writeFileSync(broken, '{not json')
    expect(readMemoryOverridesFile(broken)).toEqual({})
    const badField = join(dir, 'badfield.json')
    writeFileSync(badField, JSON.stringify({ writePolicy: 42 }))
    expect(readMemoryOverridesFile(badField)).toEqual({})
  })
  it('路径真值:与 workspace .eterna 同目录(memory.sqlite3 同目录纪律)', () => {
    expect(memoryOverridesDir('/ws')).toBe(join('/ws', '.eterna'))
    expect(memoryOverridesPath('/ws')).toBe(join('/ws', '.eterna', MEMORY_OVERRIDES_FILENAME))
    expect(MEMORY_OVERRIDES_FILENAME).toBe('memory.config.json')
  })
  it('缺省 dbPath 布局:dbPath 派生(glue 热读)与 workspace 根形态(admin 写入)恒等', () => {
    // 生产缺省布局 dbPath=<root>/.eterna/memory.sqlite3:两端必须落同一文件
    // (M-M3 评审回归:glue 曾误传 dirname(dbPath) 给根形态助手,双拼 .eterna)
    const dbPath = join('/ws', '.eterna', 'memory.sqlite3')
    expect(memoryOverridesDirForDb(dbPath)).toBe(join('/ws', '.eterna'))
    expect(memoryOverridesPathForDb(dbPath)).toBe(join('/ws', '.eterna', MEMORY_OVERRIDES_FILENAME))
    expect(memoryOverridesPathForDb(dbPath)).toBe(memoryOverridesPath('/ws'))
  })
})

describe('resolveWriteReviewState 写入策略档位映射(19 号 §3-T2.5 + T12-①)', () => {
  const userSemantic = { subject: 'user', key: 'k', content: 'c', scope: 'user' as const, kind: 'semantic' as const, source: 'agent' as const }
  const domainEpisodic = { subject: 'domain:deploy', key: 'k', content: 'c', scope: 'domain' as const, kind: 'episodic' as const, source: 'agent' as const }
  const domainSemantic = { subject: 'domain:deploy', key: 'k', content: 'c', scope: 'domain' as const, kind: 'semantic' as const, source: 'agent' as const }
  const explicit = { subject: 'user', key: 'k', content: 'c', scope: 'user' as const, kind: 'semantic' as const, source: 'explicit' as const }
  const compaction = { subject: 'user', key: 'k', content: 'c', scope: 'user' as const, kind: 'semantic' as const, source: 'compaction' as const }

  it('仅显式档:explicit → approved,其余(含 domain+episodic)一律 pending', () => {
    expect(resolveWriteReviewState(explicit, 'explicit-only')).toBe('approved')
    expect(resolveWriteReviewState(userSemantic, 'explicit-only')).toBe('pending')
    expect(resolveWriteReviewState(domainEpisodic, 'explicit-only')).toBe('pending')
    expect(resolveWriteReviewState(compaction, 'explicit-only')).toBe('pending')
  })

  it('自动+审批档(缺省/undefined):现行分级规则不变', () => {
    expect(resolveWriteReviewState(userSemantic, 'auto-review')).toBe('pending')
    expect(resolveWriteReviewState(domainEpisodic, 'auto-review')).toBe('approved')
    expect(resolveWriteReviewState(domainSemantic, 'auto-review')).toBe('pending')
    expect(resolveWriteReviewState(explicit, 'auto-review')).toBe('approved')
    expect(resolveWriteReviewState(compaction, 'auto-review')).toBe('pending')
    // 缺席档位 = 现行规则(既有调用面零改动)
    expect(resolveWriteReviewState(userSemantic)).toBe('pending')
    expect(resolveWriteReviewState(domainEpisodic)).toBe('approved')
  })

  it('全自动档:pending 不再产生;compaction 来源仍强制 pending(投毒防线)', () => {
    expect(resolveWriteReviewState(userSemantic, 'full-auto')).toBe('approved')
    expect(resolveWriteReviewState(domainEpisodic, 'full-auto')).toBe('approved')
    expect(resolveWriteReviewState(domainSemantic, 'full-auto')).toBe('approved')
    expect(resolveWriteReviewState(explicit, 'full-auto')).toBe('approved')
    expect(resolveWriteReviewState(compaction, 'full-auto')).toBe('pending')
  })
})

describe('M-M4 蒸馏热改键(parseMemoryOverrides;两键同 schema 分文件归属)', () => {
  it('distillEnabled / distillParticipate 布尔解析进载荷', () => {
    expect(parsedOverridesOf(parseMemoryOverrides({ distillEnabled: true }))).toEqual({ distillEnabled: true })
    expect(parsedOverridesOf(parseMemoryOverrides({ distillParticipate: false }))).toEqual({ distillParticipate: false })
    expect(parsedOverridesOf(parseMemoryOverrides({ distillEnabled: true, distillParticipate: true }))).toEqual({
      distillEnabled: true,
      distillParticipate: true,
    })
  })

  it('类型不符拒绝(中文 message);文件读 fail-open 回落基线不变', () => {
    expect(parseMemoryOverrides({ distillEnabled: 'yes' })).toHaveProperty('error')
    expect(parseMemoryOverrides({ distillParticipate: 1 })).toHaveProperty('error')
    const path = join(dir, 'distill-overrides.json')
    writeFileSync(path, JSON.stringify({ distillEnabled: true, distillParticipate: false }))
    expect(readMemoryOverridesFile(path)).toEqual({ distillEnabled: true, distillParticipate: false })
    writeFileSync(path, '{broken')
    expect(readMemoryOverridesFile(path)).toEqual({})
  })

  it('resolveEffectiveFlags 不受蒸馏两键影响(蒸馏有独立门控面)', () => {
    expect(resolveEffectiveFlags({ distillEnabled: true, distillParticipate: false })).toEqual({
      portraitEnabled: true,
      domainEnabled: true,
      writePolicy: DEFAULT_MEMORY_WRITE_POLICY,
    })
  })
})
