/**
 * 结构完整性检查(06 号 SOP §2 领域包模板逐项落成错误码):
 * package.json(dsh.bundle 指向 cordis.patch.yml)/ 必需文件 / 必需目录 /
 * profile.yml(继承 dsh-base、bundles 含本包)/ hitl.yaml 与 threshold.yml 可解析。
 */
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { asStringArray, isRecord } from './util.ts'
import { readPackPackageJson, readYamlFile } from './pack.ts'
import { error } from './types.ts'
import type { Finding, PackPackageJson } from './types.ts'

/** 06 号模板的必需文件(相对 pack 根)。 */
export const REQUIRED_FILES: readonly string[] = [
  'cordis.patch.yml',
  'profile.yml',
  'persona.md',
  'hitl.yaml',
  'evals/threshold.yml',
]

/** 06 号模板的必需目录(evals/golden 由 golden 检查单独覆盖)。 */
export const REQUIRED_DIRS: readonly string[] = [
  'skills',
  'tools',
  'knowledge',
  'policies',
  'evals/validators',
  'evals/trajectories',
]

export interface StructureContext {
  readonly manifest?: PackPackageJson
  readonly scope?: string
}

/** package.json + 必需文件/目录 + hitl/threshold 可解析。 */
export function lintStructure(packRoot: string): { findings: readonly Finding[]; context: StructureContext } {
  const findings: Finding[] = []
  const manifest = readPackPackageJson(packRoot)
  if (manifest === undefined) {
    findings.push(error('PACK001', '<pack>', 'package.json 缺失、不可解析或缺少字符串 name'))
    return { findings, context: {} }
  }
  const patch = manifest.dsh?.bundle.patch
  if (patch === undefined) {
    findings.push(error('PACK002', 'package.json', '缺少 dsh.bundle.patch 声明(须指向 cordis.patch.yml)'))
  } else {
    const patches = Array.isArray(patch) ? patch : [patch]
    if (patches.length !== 1 || patches[0] !== './cordis.patch.yml') {
      findings.push(error('PACK002', 'package.json', `dsh.bundle.patch 应为 './cordis.patch.yml'(06 号模板单 patch 约定),实际: ${JSON.stringify(patch)}`))
    }
  }
  const scopeMatch = /^@([a-z0-9][a-z0-9-.]*)\//.exec(manifest.name)
  if (scopeMatch === null) {
    findings.push(error('PACK003', 'package.json', `包名 "${manifest.name}" 必须是 @<industry>/pack 形态的 scoped 名(Cordis 纪律:@<industry>/* 命名空间)`))
  }

  for (const rel of REQUIRED_FILES) {
    if (!existsSync(join(packRoot, rel))) {
      findings.push(error('PACK004', rel, '必需文件缺失(06 号 SOP 领域包模板)'))
    }
  }
  for (const rel of REQUIRED_DIRS) {
    if (!existsSync(join(packRoot, rel))) {
      findings.push(error('PACK005', `${rel}/`, '必需目录缺失(06 号 SOP 领域包模板)'))
    }
  }

  // hitl.yaml:存在性由 REQUIRED_FILES 覆盖;此处只钉「是 YAML 映射」。
  const hitlPath = join(packRoot, 'hitl.yaml')
  if (existsSync(hitlPath)) {
    const hitl = readYamlFile(packRoot, 'hitl.yaml')
    if (!hitl.parsed.ok || !isRecord(hitl.parsed.value)) {
      findings.push(error('PACK006', 'hitl.yaml', `YAML 解析失败或顶层不是映射: ${hitl.parsed.ok ? '顶层不是映射' : hitl.parsed.error ?? ''}`))
    }
  }

  // threshold.yml:门禁阈值与 ai-evo 同源,release 段必填(07 号文档 §3/S4)。
  const thresholdPath = join(packRoot, 'evals/threshold.yml')
  if (existsSync(thresholdPath)) {
    const threshold = readYamlFile(packRoot, 'evals/threshold.yml')
    if (!threshold.parsed.ok || !isRecord(threshold.parsed.value)) {
      findings.push(error('PACK006', 'evals/threshold.yml', `YAML 解析失败或顶层不是映射: ${threshold.parsed.ok ? '顶层不是映射' : threshold.parsed.error ?? ''}`))
    } else if (!isRecord(threshold.parsed.value.release)) {
      findings.push(error('PACK007', 'evals/threshold.yml', '缺少 release 门禁阈值映射(S4 全量门禁的最小阈值集)'))
    }
  }

  return {
    findings,
    context: { manifest, ...(scopeMatch?.[1] !== undefined ? { scope: scopeMatch[1] } : {}) },
  }
}

/** profile.yml:继承 dsh-base、bundles 叠加本包(06 号模板注释行)。 */
export function lintProfile(packRoot: string, manifest: PackPackageJson): readonly Finding[] {
  const findings: Finding[] = []
  const profile = readYamlFile(packRoot, 'profile.yml')
  if (!profile.parsed.ok || !isRecord(profile.parsed.value)) {
    return [error('PACK010', 'profile.yml', `YAML 解析失败或顶层不是映射: ${profile.parsed.ok ? '顶层不是映射' : profile.parsed.error ?? ''}`)]
  }
  const value = profile.parsed.value
  const extendsList = asStringArray(value.extends)
  if (extendsList === undefined || !extendsList.includes('dsh-base')) {
    findings.push(error('PACK010', 'profile.yml', 'extends 必须是数组且包含 dsh-base(L0 内核基座)'))
  }
  const bundles = asStringArray(value.bundles)
  if (bundles === undefined || !bundles.includes(manifest.name)) {
    findings.push(error('PACK010', 'profile.yml', `bundles 必须是数组且包含本包 "${manifest.name}"(profile 叠加 bundle)`))
  }
  if (typeof value.name !== 'string' || value.name.length === 0) {
    findings.push(error('PACK010', 'profile.yml', 'name 必须是非空字符串'))
  }
  return findings
}
