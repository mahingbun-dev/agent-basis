/**
 * 领域包发现与装载:pack 根定位(package.json 带 dsh.bundle 声明)、
 * skills 扁平扫描(DSH skill-filesystem 只发现根级,10 号文档 §10.3)、
 * tools 源码枚举。文件系统访问集中在本模块,检查器只消费结果。
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import { isRecord, parseYaml } from './util.ts'
import type { DshManifest, PackPackageJson } from './types.ts'

/** pack 根 = 含 package.json 且带 `dsh.bundle` 声明的目录(dsh-package-manifest 公共形态)。 */
export function isPackDir(dir: string): boolean {
  const pkgPath = join(dir, 'package.json')
  if (!existsSync(pkgPath)) return false
  const parsed = readPackPackageJson(dir)
  return parsed !== undefined && parsed.dsh?.bundle !== undefined
}

/** 读取并解析领域包 package.json;不可解析或形态错误时返回 undefined。 */
export function readPackPackageJson(dir: string): PackPackageJson | undefined {
  let text: string
  try {
    text = readFileSync(join(dir, 'package.json'), 'utf8')
  } catch {
    return undefined
  }
  let json: unknown
  try {
    json = JSON.parse(text)
  } catch {
    return undefined
  }
  if (!isRecord(json) || typeof json.name !== 'string') return undefined
  const dshRaw = json.dsh
  let dsh: DshManifest | undefined
  if (isRecord(dshRaw) && isRecord(dshRaw.bundle)) {
    const patch = dshRaw.bundle.patch
    if (typeof patch === 'string' || Array.isArray(patch)) {
      const manifestVersion
        = typeof dshRaw.manifestVersion === 'number' ? { manifestVersion: dshRaw.manifestVersion } : {}
      dsh = { ...manifestVersion, bundle: { patch: patch as string | readonly string[] } }
    }
  }
  const version = typeof json.version === 'string' ? { version: json.version } : {}
  const dshField = dsh !== undefined ? { dsh } : {}
  return { name: json.name, ...version, ...dshField }
}

/**
 * 从 start 向上找 pack 根;start 本身不是 pack 时,先检查它的 packs/ 子目录
 * (仓库根聚合形态,一次 lint 全部领域包,T14 总装用),再逐级向上。
 */
export function discoverPackRoots(start: string): readonly string[] {
  const abs = resolve(start)
  if (isPackDir(abs)) return [abs]
  const packsDir = join(abs, 'packs')
  if (existsSync(packsDir)) {
    const roots = readdirSync(packsDir)
      .map(entry => join(packsDir, entry))
      .filter(entry => isPackDir(entry))
      .sort()
    if (roots.length > 0) return roots
  }
  const parent = join(abs, '..')
  if (parent === abs) return []
  return discoverPackRoots(parent)
}

// ── skills 扫描(扁平:根级 <name>/SKILL.md 或 <name>.md)────────────────────

export interface SkillFile {
  /** 相对 pack 根的路径,如 `skills/core-workflow/SKILL.md`。 */
  readonly relPath: string
  readonly absPath: string
  readonly text: string
  /** 目录包形态下的 skill 名(= 目录名);扁平形态为 undefined。 */
  readonly dirName?: string
}

export interface SkillScanResult {
  /** 根级合法形态的 skill 文件(可参与 frontmatter/锚点检查)。 */
  readonly skills: readonly SkillFile[]
  /** 嵌套摆放、DSH 不会发现的 SKILL.md(相对 pack 根路径)。 */
  readonly nested: readonly string[]
}

/** 在目录包内递归收集非根级 SKILL.md(它们不会进入 catalog,必须报错)。 */
function collectNestedSkillMd(dirBundleRoot: string, packRoot: string, out: string[]): void {
  for (const entry of readdirSync(dirBundleRoot, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name.startsWith('.') || entry.name === 'node_modules') continue
    const abs = join(dirBundleRoot, entry.name)
    if (existsSync(join(abs, 'SKILL.md'))) {
      out.push(relative(packRoot, join(abs, 'SKILL.md')))
    }
    collectNestedSkillMd(abs, packRoot, out)
  }
}

export function scanSkills(packRoot: string): SkillScanResult {
  const skillsDir = join(packRoot, 'skills')
  const skills: SkillFile[] = []
  const nested: string[] = []
  if (!existsSync(skillsDir)) return { skills, nested }
  for (const entry of readdirSync(skillsDir, { withFileTypes: true })) {
    if (entry.name.startsWith('.') || entry.name === 'node_modules') continue
    if (entry.isFile() && entry.name.endsWith('.md')) {
      const absPath = join(skillsDir, entry.name)
      skills.push({
        relPath: relative(packRoot, absPath),
        absPath,
        text: readFileSync(absPath, 'utf8'),
      })
    } else if (entry.isDirectory()) {
      const skillMd = join(skillsDir, entry.name, 'SKILL.md')
      if (existsSync(skillMd)) {
        skills.push({
          relPath: relative(packRoot, skillMd),
          absPath: skillMd,
          text: readFileSync(skillMd, 'utf8'),
          dirName: entry.name,
        })
      }
      // 嵌套发现纪律:目录包内部任何深度的 SKILL.md 都不会被 skill-filesystem 发现。
      collectNestedSkillMd(join(skillsDir, entry.name), packRoot, nested)
    }
  }
  skills.sort((a, b) => a.relPath.localeCompare(b.relPath))
  nested.sort()
  return { skills, nested }
}

/** 枚举 pack tools/ 下全部 .ts 源码(相对 pack 根路径 + 绝对路径 + 文本),递归。 */
export function listToolSources(packRoot: string): readonly SkillFile[] {
  const toolsDir = join(packRoot, 'tools')
  if (!existsSync(toolsDir)) return []
  const out: SkillFile[] = []
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const abs = join(dir, entry.name)
      if (entry.isDirectory()) {
        walk(abs)
      } else if (entry.isFile() && entry.name.endsWith('.ts')) {
        out.push({ relPath: relative(packRoot, abs), absPath: abs, text: readFileSync(abs, 'utf8') })
      }
    }
  }
  walk(toolsDir)
  return out
}

// ── YAML 文件读取 ────────────────────────────────────────────────────────────

export interface LoadedYamlFile {
  readonly relPath: string
  readonly text: string
  readonly parsed: ReturnType<typeof parseYaml>
}

export function readYamlFile(packRoot: string, relPath: string): LoadedYamlFile {
  const absPath = join(packRoot, relPath)
  const text = readFileSync(absPath, 'utf8')
  return { relPath, text, parsed: parseYaml(text) }
}
