/**
 * 验收门之二:三类坏包(缺锚点 / 缺 golden / 引用缺失)必须报错。
 * 基线 = 真实 pack init 产物,单点破坏后断言对应错误码与非零退出码。
 */
import { cpSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { checkPack } from '../src/check.ts'
import { lintPack } from '../src/lint.ts'
import { runPack } from '../src/cli.ts'
import { makePack, makeTmpRoot } from './helpers.ts'

const tmp = makeTmpRoot('packctl-bad-')
let base = ''
beforeAll(() => {
  base = makePack(tmp.root, 'bad')
})
afterAll(() => { tmp.cleanup() })

function cloneTo(name: string): string {
  const dir = join(tmp.root, name)
  cpSync(base, dir, { recursive: true })
  return dir
}

describe('坏包①:SKILL.md 条目锚点缺失/不配对 → lint 必须报错', () => {
  it('frontmatter 有 entry 但正文缺开锚点 → SKILL004 + lint 退出码 1', () => {
    const dir = cloneTo('packs/bad-anchor')
    const skillPath = join(dir, 'skills/core-workflow/SKILL.md')
    const text = readFileSync(skillPath, 'utf8')
    writeFileSync(skillPath, text.replace('<!-- E: S-core-workflow-001 -->', ''), 'utf8')
    const errors = lintPack(dir).findings.filter(f => f.severity === 'error')
    expect(errors.map(f => f.code)).toContain('SKILL004')
    const lines: string[] = []
    expect(runPack(['lint', dir], { cwd: tmp.root, writeLine: l => lines.push(l) })).toBe(1)
    expect(lines.some(l => l.includes('SKILL004'))).toBe(true)
  })

  it('开锚点缺闭合 <!-- /E --> → SKILL003', () => {
    const dir = cloneTo('packs/bad-anchor-close')
    const skillPath = join(dir, 'skills/core-workflow/SKILL.md')
    const text = readFileSync(skillPath, 'utf8')
    writeFileSync(skillPath, text.replace('<!-- /E -->', ''), 'utf8')
    const errors = lintPack(dir).findings.filter(f => f.severity === 'error')
    expect(errors.map(f => f.code)).toContain('SKILL003')
  })

  it('正文有锚点但 frontmatter 没登记 → SKILL005(配对是双向的)', () => {
    const dir = cloneTo('packs/bad-anchor-entry')
    const skillPath = join(dir, 'skills/core-workflow/SKILL.md')
    const text = readFileSync(skillPath, 'utf8')
    writeFileSync(skillPath, text.replace(/entries:\n\s+- \{ id: S-core-workflow-001[^}]*\}/, 'entries: []'), 'utf8')
    const errors = lintPack(dir).findings.filter(f => f.severity === 'error')
    expect(errors.map(f => f.code)).toContain('SKILL005')
  })
})

describe('坏包②:golden 缺失/为空/不可加载 → lint 必须报错', () => {
  it('evals/golden/ 目录整个缺失 → GOLD001', () => {
    const dir = cloneTo('packs/bad-golden-missing')
    rmSync(join(dir, 'evals/golden'), { recursive: true, force: true })
    const errors = lintPack(dir).findings.filter(f => f.severity === 'error')
    expect(errors.map(f => f.code)).toContain('GOLD001')
    const lines: string[] = []
    expect(runPack(['lint', dir], { cwd: tmp.root, writeLine: l => lines.push(l) })).toBe(1)
    expect(lines.some(l => l.includes('GOLD001'))).toBe(true)
  })

  it('evals/golden/ 目录为空(删唯一 case)→ GOLD001', () => {
    const dir = cloneTo('packs/bad-golden-empty')
    rmSync(join(dir, 'evals/golden/case-001.yaml'))
    expect(lintPack(dir).findings.filter(f => f.severity === 'error').map(f => f.code)).toContain('GOLD001')
  })

  it('golden case 缺 user_input → GOLD003', () => {
    const dir = cloneTo('packs/bad-golden-shape')
    writeFileSync(join(dir, 'evals/golden/case-001.yaml'), 'id: case-001\ntags: [x]\n', 'utf8')
    const codes = lintPack(dir).findings.filter(f => f.severity === 'error').map(f => f.code)
    expect(codes).toContain('GOLD003')
  })
})

describe('坏包③:bundle 声明引用缺失 → pack check 必须报错', () => {
  it('patch 引用的 customSkillDirs 目录不存在 → CHK002 + check 退出码 1', () => {
    const dir = cloneTo('packs/bad-ref-skilldir')
    const patchPath = join(dir, 'cordis.patch.yml')
    const text = readFileSync(patchPath, 'utf8')
    writeFileSync(patchPath, text.replace("customSkillDirs: ['./skills']", "customSkillDirs: ['./skills-gone']"), 'utf8')
    const errors = checkPack(dir).findings.filter(f => f.severity === 'error')
    expect(errors.map(f => f.code)).toContain('CHK002')
    const lines: string[] = []
    expect(runPack(['check', dir], { cwd: tmp.root, writeLine: l => lines.push(l) })).toBe(1)
    expect(lines.some(l => l.includes('CHK002'))).toBe(true)
  })

  it('dsh.bundle.patch 指向不存在的文件 → CHK001', () => {
    const dir = cloneTo('packs/bad-ref-patchfile')
    const pkgPath = join(dir, 'package.json')
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) as { dsh: { bundle: { patch: string } } }
    pkg.dsh.bundle.patch = './cordis.patch.gone.yml'
    writeFileSync(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`, 'utf8')
    expect(checkPack(dir).findings.filter(f => f.severity === 'error').map(f => f.code)).toContain('CHK001')
  })

  it('SKILL.md 正文链接指向不存在的 references 文件 → CHK004', () => {
    const dir = cloneTo('packs/bad-ref-skilllink')
    rmSync(join(dir, 'skills/core-workflow/references/checklist.md'))
    const errors = checkPack(dir).findings.filter(f => f.severity === 'error')
    expect(errors.map(f => f.code)).toContain('CHK004')
  })
})
