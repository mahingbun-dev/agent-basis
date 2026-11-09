/**
 * 验收门之一:pack init 产物必须原样通过 pack lint(结构 + Cordis + 锚点 + golden),
 * 且 pack check 静态部分零 error —— 模板漂移在单测层就被钉死。
 */
import { cpSync, existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { checkPack } from '../src/check.ts'
import { initPack } from '../src/init.ts'
import { lintPack } from '../src/lint.ts'
import { makePack, makeTmpRoot } from './helpers.ts'

const tmp = makeTmpRoot('packctl-init-')
afterAll(() => { tmp.cleanup() })

describe('pack init <industry>', () => {
  it('生成 06 号模板全骨架(必需文件/目录齐全)', () => {
    const packDir = makePack(tmp.root, 'event-a')
    const expected = [
      'package.json',
      'cordis.patch.yml',
      'profile.yml',
      'persona.md',
      'hitl.yaml',
      'skills/core-workflow/SKILL.md',
      'skills/core-workflow/references/checklist.md',
      'tools/index.ts',
      'tools/sample-tool.ts',
      'knowledge/README.md',
      'policies/guard-rules.yml',
      'evals/golden/case-001.yaml',
      'evals/threshold.yml',
      'evals/validators/README.md',
      'evals/trajectories/README.md',
    ]
    for (const rel of expected) {
      expect(existsSync(join(packDir, rel)), rel).toBe(true)
    }
  })

  it('package.json:dsh.bundle.patch 指向 ./cordis.patch.yml,包名 @<industry>/pack', () => {
    const packDir = makePack(tmp.root, 'event-b')
    const pkg = JSON.parse(readFileSync(join(packDir, 'package.json'), 'utf8')) as {
      name: string
      dsh: { bundle: { patch: string } }
    }
    expect(pkg.name).toBe('@event-b/pack')
    expect(pkg.dsh.bundle.patch).toBe('./cordis.patch.yml')
  })

  it('init 产物通过 pack lint(零 error)', () => {
    const packDir = makePack(tmp.root, 'event-c')
    const result = lintPack(packDir)
    expect(result.findings.filter(f => f.severity === 'error')).toEqual([])
  })

  it('init 产物通过 pack check 静态冒烟(仅 CHK900 运行时冒烟告警)', () => {
    const packDir = makePack(tmp.root, 'event-d')
    const result = checkPack(packDir)
    expect(result.findings.filter(f => f.severity === 'error')).toEqual([])
    expect(result.findings.map(f => f.code)).toEqual(['CHK900'])
    // profile.yml 里两个包名式 bundle 引用(@eterna/governance + 本包)需要安装环境,静态跳过。
    expect(result.skippedSpecifiers).toBe(2)
  })

  it('行业标识不合法报 INIT001(kebab-case 约束)', () => {
    for (const bad of ['Event_Planning', 'A', '中文行业', 'demo/x']) {
      const { result, findings } = initPack(bad, { rootDir: tmp.root })
      expect(result, bad).toBeUndefined()
      expect(findings.map(f => f.code), bad).toEqual(['INIT001'])
    }
  })

  it('不覆盖已有包(INIT002),原文件内容不变', () => {
    const packDir = makePack(tmp.root, 'legal')
    const marker = '# marker\n'
    writeFileSync(join(packDir, 'persona.md'), marker, 'utf8')
    const { result, findings } = initPack('legal', { rootDir: tmp.root })
    expect(result).toBeUndefined()
    expect(findings.map(f => f.code)).toEqual(['INIT002'])
    expect(readFileSync(join(packDir, 'persona.md'), 'utf8')).toBe(marker)
  })

  it('SKILL.md 样例带成对条目锚点与 metadata.evo.entries(ACE 条目化)', () => {
    const packDir = makePack(tmp.root, 'event-e')
    const text = readFileSync(join(packDir, 'skills/core-workflow/SKILL.md'), 'utf8')
    expect(text).toContain('<!-- E: S-core-workflow-001 -->')
    expect(text).toContain('<!-- /E -->')
    expect(text).toContain('entries:')
  })
})

describe('pack 目录聚合发现', () => {
  it('packs/ 下多个领域包一次 lint(向上查找 + 聚合)', async () => {
    const { discoverPackRoots } = await import('../src/pack.ts')
    makePack(tmp.root, 'aggr-a')
    makePack(tmp.root, 'aggr-b')
    const nested = join(tmp.root, 'packages', 'somewhere', 'deep')
    const roots = discoverPackRoots(nested)
    expect(roots.length).toBeGreaterThanOrEqual(2)
    expect(roots.some(r => r.endsWith('packs/aggr-a'))).toBe(true)
    expect(roots.some(r => r.endsWith('packs/aggr-b'))).toBe(true)
  })
})

describe('copy 辅助(供坏包用例复制的真实基线)', () => {
  it('cpSync 复制的 pack 依旧 lint 全绿(排除基线损坏)', () => {
    const base = makePack(tmp.root, 'copybase')
    const copy = join(tmp.root, 'packs', 'copybase-clone')
    cpSync(base, copy, { recursive: true })
    const result = lintPack(copy)
    expect(result.findings.filter(f => f.severity === 'error')).toEqual([])
    rmSync(copy, { recursive: true, force: true })
  })
})
