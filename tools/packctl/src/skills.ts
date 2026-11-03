/**
 * SKILL.md 检查:frontmatter 完整 + ACE 条目锚点配对(10 号文档 §4.1 / D2 决议)。
 *
 * 条目化约定(向 ACE 对齐,保持人可读):
 * - frontmatter `metadata.evo.entries[]`:每条 { id, helpful, harmful, updated, origin };
 * - 正文条目锚点:`<!-- E: S-xxx-001 -->` … `<!-- /E -->`(HTML 注释对人无扰,对 packctl 可解析);
 * - 配对完整 = 双向:frontmatter 每个 entry id 恰有一个开锚点,正文中每个开锚点恰在 entries 里;
 * - 计数器落 DSH 原生 `metadata` 自由字段,body 每次加载重读 → delta 下次会话即生效。
 */
import { isEntryId, isKebabCase, isRecord, parseEntryAnchors, parseYaml, splitFrontmatter } from './util.ts'
import { error, warning } from './types.ts'
import type { Finding } from './types.ts'
import type { SkillFile, SkillScanResult } from './pack.ts'

export interface EvoEntryMeta {
  readonly id: string
  readonly helpful?: number
  readonly harmful?: number
  readonly updated?: string
  readonly origin?: string
}

/** 单个 SKILL.md 的完整检查(frontmatter + 锚点配对)。 */
export function lintSkillFile(skill: SkillFile): readonly Finding[] {
  const issues: Finding[] = []
  const rel = skill.relPath
  const fm = splitFrontmatter(skill.text)
  if (!fm.ok || fm.frontmatter === undefined) {
    return [error('SKILL001', rel, `frontmatter 解析失败: ${fm.error ?? '无 frontmatter'}`)]
  }
  const parsed = parseYaml(fm.frontmatter ?? '')
  if (!parsed.ok || !isRecord(parsed.value)) {
    return [error('SKILL001', rel, `frontmatter YAML 解析失败: ${parsed.ok ? '顶层不是映射' : parsed.error ?? ''}`)]
  }
  const fmValue = parsed.value

  // 必需字段:name(kebab-case)+ description(dsh-skill-filesystem 的 catalog 要求)。
  const name = fmValue.name
  if (typeof name !== 'string' || !isKebabCase(name)) {
    issues.push(error('SKILL002', rel, 'frontmatter.name 必须是 kebab-case 字符串(dsh-skill-filesystem 的发现约定)'))
  } else if (skill.dirName !== undefined && name !== skill.dirName) {
    issues.push(error('SKILL002', rel, `frontmatter.name "${name}" 与目录名 "${skill.dirName}" 不一致`))
  }
  if (typeof fmValue.description !== 'string' || fmValue.description.trim().length === 0) {
    issues.push(error('SKILL001', rel, 'frontmatter.description 必填且非空(触发词维护重点)'))
  }

  // 条目锚点配对。
  const anchors = parseEntryAnchors(fm.body)
  const entries = readEvoEntries(fmValue.metadata, rel, issues)
  const anchorIds = anchors.map(a => a.id)
  const dupAnchor = firstDuplicate(anchorIds)
  if (dupAnchor !== undefined) {
    issues.push(error('SKILL006', rel, `锚点 id "${dupAnchor}" 在正文中出现多次`))
  }
  const dupEntry = firstDuplicate(entries.map(e => e.id))
  if (dupEntry !== undefined) {
    issues.push(error('SKILL006', rel, `metadata.evo.entries 中 id "${dupEntry}" 重复`))
  }
  for (const anchor of anchors) {
    if (!anchor.closed) {
      issues.push(error('SKILL003', rel, `锚点 <!-- E: ${anchor.id} --> 缺少闭合 <!-- /E -->`))
    }
    if (!entries.some(e => e.id === anchor.id)) {
      issues.push(error('SKILL005', rel, `正文锚点 "${anchor.id}" 在 metadata.evo.entries 中没有对应条目`))
    }
  }
  for (const entry of entries) {
    if (!anchors.some(a => a.id === entry.id)) {
      issues.push(error('SKILL004', rel, `metadata.evo.entries 条目 "${entry.id}" 在正文中没有 <!-- E: … --> 锚点`))
    }
  }
  return issues
}

function readEvoEntries(metadata: unknown, rel: string, issues: Finding[]): readonly EvoEntryMeta[] {
  if (metadata === undefined) return []
  if (!isRecord(metadata)) {
    issues.push(error('SKILL001', rel, 'metadata 必须是映射(DSH 原生自由字段)'))
    return []
  }
  const evo = metadata.evo
  if (evo === undefined) return []
  if (!isRecord(evo)) {
    issues.push(error('SKILL001', rel, 'metadata.evo 必须是映射'))
    return []
  }
  const rawEntries = evo.entries
  if (rawEntries === undefined) return []
  if (!Array.isArray(rawEntries)) {
    issues.push(error('SKILL001', rel, 'metadata.evo.entries 必须是数组'))
    return []
  }
  const out: EvoEntryMeta[] = []
  for (const item of rawEntries) {
    if (!isRecord(item) || typeof item.id !== 'string') {
      issues.push(error('SKILL001', rel, 'metadata.evo.entries 每条必须有字符串 id'))
      continue
    }
    if (!isEntryId(item.id)) {
      issues.push(warning('SKILL007', rel, `条目 id "${item.id}" 不符合 S-<kebab> 约定(如 S-contract-review-001)`))
    }
    for (const counter of ['helpful', 'harmful'] as const) {
      const v = item[counter]
      if (v !== undefined && (typeof v !== 'number' || v < 0)) {
        issues.push(error('SKILL001', rel, `条目 "${item.id}" 的 ${counter} 计数器必须是非负数`))
      }
    }
    const entry: EvoEntryMeta = {
      id: item.id,
      ...(typeof item.helpful === 'number' ? { helpful: item.helpful } : {}),
      ...(typeof item.harmful === 'number' ? { harmful: item.harmful } : {}),
      ...(typeof item.updated === 'string' ? { updated: item.updated } : {}),
      ...(typeof item.origin === 'string' ? { origin: item.origin } : {}),
    }
    out.push(entry)
  }
  return out
}

function firstDuplicate(values: readonly string[]): string | undefined {
  const seen = new Set<string>()
  for (const v of values) {
    if (seen.has(v)) return v
    seen.add(v)
  }
  return undefined
}

/** skills/ 目录级检查:至少一个 skill + 嵌套摆放禁止(10 号文档 §10.3,packctl lint 强制)。 */
export function lintSkillLayout(scan: SkillScanResult): readonly Finding[] {
  const issues: Finding[] = []
  if (scan.skills.length === 0) {
    issues.push(error('SKILL010', 'skills/', 'skills/ 下没有任何根级 skill(<name>/SKILL.md 或 <name>.md)——领域包的 SOP 编码载体不能为空'))
  }
  for (const nested of scan.nested) {
    issues.push(error(
      'SKILL011',
      nested,
      '嵌套 SKILL.md 不会被 dsh-skill-filesystem 发现(只发现根级 <name>/SKILL.md 或 <name>.md)——请移到 skills/ 根级',
    ))
  }
  return issues
}
