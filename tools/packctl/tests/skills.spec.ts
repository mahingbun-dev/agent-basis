/**
 * SKILL.md 检查单测:frontmatter 必需字段、条目锚点配对(双向)、
 * 计数器形态、嵌套摆放纪律(SKILL011)与空 skills(SKILL010)。
 */
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { lintSkillFile, lintSkillLayout } from '../src/skills.ts'
import { scanSkills } from '../src/pack.ts'
import { makePack, makeTmpRoot } from './helpers.ts'

const tmp = makeTmpRoot('packctl-skill-')
afterAll(() => { tmp.cleanup() })

function skillFile(text: string, relPath = 'skills/demo/SKILL.md') {
  return { relPath, absPath: join(tmp.root, relPath), text, dirName: 'demo' }
}

const GOOD = [
  '---',
  'name: demo',
  'description: 演示 skill。',
  'metadata:',
  '  evo:',
  '    entries:',
  '      - { id: S-demo-001, helpful: 3, harmful: 0, updated: 2026-11-03, origin: case-001 }',
  '---',
  '## 步骤',
  '<!-- E: S-demo-001 -->',
  '先做 A。',
  '<!-- /E -->',
  '',
].join('\n')

describe('SKILL.md frontmatter', () => {
  it('完整条目化 skill 零发现', () => {
    expect(lintSkillFile(skillFile(GOOD))).toEqual([])
  })

  it('缺 description → SKILL001;name 非 kebab-case → SKILL002;name 与目录不一致 → SKILL002', () => {
    const noDesc = GOOD.replace('description: 演示 skill。', '')
    expect(lintSkillFile(skillFile(noDesc)).map(f => f.code)).toContain('SKILL001')

    const badName = GOOD.replace('name: demo', 'name: Demo Skill')
    expect(lintSkillFile(skillFile(badName)).map(f => f.code)).toContain('SKILL002')

    const mismatch = GOOD.replace('name: demo', 'name: other')
    expect(lintSkillFile(skillFile(mismatch)).map(f => f.code)).toContain('SKILL002')
  })

  it('无 frontmatter 围栏 → SKILL001', () => {
    expect(lintSkillFile(skillFile('# 没有 frontmatter\n')).map(f => f.code)).toContain('SKILL001')
  })

  it('计数器为负数 → SKILL001', () => {
    const bad = GOOD.replace('helpful: 3', 'helpful: -1')
    expect(lintSkillFile(skillFile(bad)).map(f => f.code)).toContain('SKILL001')
  })

  it('条目 id 不符合 S-<kebab> → SKILL007(warning)', () => {
    const bad = GOOD.replaceAll('S-demo-001', 'demo_001')
    const findings = lintSkillFile(skillFile(bad))
    expect(findings.some(f => f.code === 'SKILL007' && f.severity === 'warning')).toBe(true)
  })
})

describe('条目锚点配对', () => {
  it('entry 无锚点 → SKILL004;锚点无 entry → SKILL005;重复 → SKILL006', () => {
    const noAnchor = GOOD.replace('<!-- E: S-demo-001 -->', '')
    expect(lintSkillFile(skillFile(noAnchor)).map(f => f.code)).toContain('SKILL004')

    const noEntry = GOOD.replace(/entries:\n\s+- \{ id: S-demo-001[^}]*\}/, 'entries: []')
    expect(lintSkillFile(skillFile(noEntry)).map(f => f.code)).toContain('SKILL005')

    const dupAnchor = GOOD.replace('<!-- /E -->', '<!-- /E -->\n<!-- E: S-demo-001 -->\n重复条目\n<!-- /E -->')
    expect(lintSkillFile(skillFile(dupAnchor)).map(f => f.code)).toContain('SKILL006')
  })
})

describe('skills/ 目录纪律(DSH 只发现根级)', () => {
  it('空 skills/ → SKILL010;嵌套 <name>/<sub>/SKILL.md → SKILL011', () => {
    const emptyRoot = join(tmp.root, 'empty-pack')
    mkdirSync(join(emptyRoot, 'skills'), { recursive: true })
    const scan = scanSkills(emptyRoot)
    expect(lintSkillLayout(scan).map(f => f.code)).toContain('SKILL010')

    const nestedRoot = join(tmp.root, 'nested-pack')
    mkdirSync(join(nestedRoot, 'skills', 'demo'), { recursive: true })
    writeFileSync(join(nestedRoot, 'skills', 'demo', 'SKILL.md'), GOOD, 'utf8')
    const nestedSkill = join(nestedRoot, 'skills', 'demo', 'sub', 'SKILL.md')
    mkdirSync(join(nestedSkill, '..'), { recursive: true })
    writeFileSync(nestedSkill, GOOD, 'utf8')
    const nestedScan = scanSkills(nestedRoot)
    expect(nestedScan.skills.length).toBe(1) // 根级 demo/SKILL.md 正常进 catalog
    const layout = lintSkillLayout(nestedScan)
    expect(layout.map(f => f.code)).toContain('SKILL011')
    expect(layout.find(f => f.code === 'SKILL011')?.path).toBe('skills/demo/sub/SKILL.md')
    rmSync(nestedRoot, { recursive: true, force: true })
    rmSync(emptyRoot, { recursive: true, force: true })
  })

  it('扁平 <name>.md 也在发现范围内(init 产物 + 新增扁平 skill 可被 lint)', () => {
    const packDir = makePack(tmp.root, 'flatdemo')
    writeFileSync(join(packDir, 'skills', 'quick-note.md'), GOOD.replace('name: demo', 'name: quick-note'), 'utf8')
    const scan = scanSkills(packDir)
    expect(scan.skills.some(s => s.relPath === 'skills/quick-note.md')).toBe(true)
    for (const skill of scan.skills) {
      expect(lintSkillFile(skill).filter(f => f.severity === 'error')).toEqual([])
    }
  })
})
