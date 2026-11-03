/**
 * pack lint 编排:结构完整(06 号模板)→ SKILL.md 条目锚点配对(ACE)→
 * Cordis 纪律静态检查 → golden set 完整性与可加载性。
 * G0 门禁的最小本地形态(10 号文档 §5:G0 lint = Cordis 纪律 / SKILL.md 结构 /
 * 条目锚点完整 / 引用文件存在 —— 引用存在性在 pack check)。
 */
import { join } from 'node:path'
import { lintProfile, lintStructure } from './structure.ts'
import { lintSkillFile, lintSkillLayout } from './skills.ts'
import { lintServiceIdRegistry, lintToolModule } from './cordis.ts'
import { loadGoldenDir } from './golden.ts'
import { listToolSources, scanSkills } from './pack.ts'
import { hasErrors } from './types.ts'
import type { Finding } from './types.ts'

export interface PackLintResult {
  readonly packRoot: string
  readonly findings: readonly Finding[]
}

/** 对单个 pack 根执行全部 lint;不抛异常,一切问题落 findings。 */
export function lintPack(packRoot: string): PackLintResult {
  const findings: Finding[] = []
  const { findings: structureFindings, context } = lintStructure(packRoot)
  findings.push(...structureFindings)

  const skillScan = scanSkills(packRoot)
  findings.push(...lintSkillLayout(skillScan))
  for (const skill of skillScan.skills) {
    findings.push(...lintSkillFile(skill))
  }

  const serviceIds = []
  for (const source of listToolSources(packRoot)) {
    const result = lintToolModule(source, context.scope)
    findings.push(...result.findings)
    serviceIds.push(...result.serviceIds)
  }
  findings.push(...lintServiceIdRegistry(serviceIds))

  findings.push(...loadGoldenDir(join(packRoot, 'evals/golden'), 'evals/golden').findings)

  if (context.manifest !== undefined) {
    findings.push(...lintProfile(packRoot, context.manifest))
  }

  findings.sort((a, b) => a.path.localeCompare(b.path) || a.code.localeCompare(b.code))
  return { packRoot, findings }
}

/** 多 pack 聚合(仓库根 packs/* 一把 lint,T14 总装用)。 */
export function lintPacks(packRoots: readonly string[]): readonly PackLintResult[] {
  return packRoots.map(root => lintPack(root))
}

export function anyLintErrors(results: readonly PackLintResult[]): boolean {
  return results.some(r => hasErrors(r.findings))
}
