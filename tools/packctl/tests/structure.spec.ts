/**
 * 结构完整检查单测(PACK0xx):package.json 声明、必需文件/目录、
 * profile.yml 叠加声明、hitl/threshold 可解析。
 */
import { readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { lintProfile, lintStructure } from '../src/structure.ts'
import { readPackPackageJson } from '../src/pack.ts'
import { makePack, makeTmpRoot } from './helpers.ts'

const tmp = makeTmpRoot('packctl-struct-')
afterAll(() => { tmp.cleanup() })

describe('package.json 声明', () => {
  it('init 产物零发现,scope 推导正确', () => {
    const packDir = makePack(tmp.root, 'struct-ok')
    const { findings, context } = lintStructure(packDir)
    expect(findings).toEqual([])
    expect(context.scope).toBe('struct-ok')
    expect(context.manifest?.name).toBe('@struct-ok/pack')
  })

  it('dsh.bundle.patch 偏离模板 → PACK002', () => {
    const packDir = makePack(tmp.root, 'struct-patchdecl')
    const pkgPath = join(packDir, 'package.json')
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) as { dsh: { bundle: { patch: string } } }
    pkg.dsh.bundle.patch = './other.patch.yml'
    writeFileSync(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`, 'utf8')
    expect(lintStructure(packDir).findings.map(f => f.code)).toContain('PACK002')
  })

  it('包名非 scoped → PACK003', () => {
    const packDir = makePack(tmp.root, 'struct-ns')
    const pkgPath = join(packDir, 'package.json')
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) as { name: string }
    pkg.name = 'plain-pack'
    writeFileSync(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`, 'utf8')
    const { findings, context } = lintStructure(packDir)
    expect(findings.map(f => f.code)).toContain('PACK003')
    expect(context.scope).toBeUndefined()
  })

  it('package.json 不可解析 → PACK001(fail loud,不静默)', () => {
    const packDir = makePack(tmp.root, 'struct-badjson')
    writeFileSync(join(packDir, 'package.json'), '{broken', 'utf8')
    expect(readPackPackageJson(packDir)).toBeUndefined()
    expect(lintStructure(packDir).findings.map(f => f.code)).toContain('PACK001')
  })
})

describe('必需文件/目录(06 号模板)', () => {
  it('缺 persona.md → PACK004;缺 policies/ → PACK005', () => {
    const packDir = makePack(tmp.root, 'struct-missing')
    rmSync(join(packDir, 'persona.md'))
    expect(lintStructure(packDir).findings.map(f => f.code)).toContain('PACK004')

    rmSync(join(packDir, 'policies'), { recursive: true })
    expect(lintStructure(packDir).findings.map(f => f.code)).toContain('PACK005')
  })

  it('hitl.yaml 非 YAML 映射 → PACK006;threshold 缺 release → PACK007', () => {
    const packDir = makePack(tmp.root, 'struct-yaml')
    writeFileSync(join(packDir, 'hitl.yaml'), 'rules: [unclosed\n', 'utf8')
    expect(lintStructure(packDir).findings.map(f => f.code)).toContain('PACK006')

    writeFileSync(join(packDir, 'evals/threshold.yml'), 'smoke: {}\n', 'utf8')
    expect(lintStructure(packDir).findings.map(f => f.code)).toContain('PACK007')
  })
})

describe('profile.yml 叠加声明', () => {
  it('extends 缺 dsh-base / bundles 缺本包 / name 空 → PACK010', () => {
    const packDir = makePack(tmp.root, 'struct-profile')
    const manifest = readPackPackageJson(packDir)
    expect(manifest?.name).toBe('@struct-profile/pack')

    writeFileSync(join(packDir, 'profile.yml'), 'name: struct-profile\nextends: [dsh-web]\nbundles: ["@struct-profile/pack"]\n', 'utf8')
    expect(lintProfile(packDir, manifest!).map(f => f.code)).toContain('PACK010')

    writeFileSync(join(packDir, 'profile.yml'), 'name: struct-profile\nextends: [dsh-base]\nbundles: ["@basis/governance"]\n', 'utf8')
    expect(lintProfile(packDir, manifest!).map(f => f.code)).toContain('PACK010')

    writeFileSync(join(packDir, 'profile.yml'), 'extends: [dsh-base]\nbundles: ["@struct-profile/pack"]\n', 'utf8')
    expect(lintProfile(packDir, manifest!).map(f => f.code)).toContain('PACK010')

    writeFileSync(join(packDir, 'profile.yml'), 'name: struct-profile\nextends: [dsh-base]\nbundles: ["@basis/governance", "@struct-profile/pack"]\n', 'utf8')
    expect(lintProfile(packDir, manifest!)).toEqual([])
  })
})
