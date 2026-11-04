/**
 * pack check —— 静态冒烟(降级形态,10 号文档 §5 G0 的「引用文件存在」+ SOP S2
 * 安装冒烟的静态替代):
 *
 * 1. CHK001 package.json `dsh.bundle.patch` 声明的每个 patch 文件存在;
 * 2. CHK002 patch 文档可解析,且其中全部 patch 相对路径引用(`./`/`../`,loader 会
 *    转成 file URL 的那类:insert.name / customSkillDirs / persona 文件等)都真实存在;
 * 3. CHK003 profile.yml bundles 里的路径式引用存在(包名式引用需要安装环境,跳过并计数);
 * 4. CHK004 SKILL.md 正文里的相对 markdown 链接(scripts/references 资源)存在;
 * 5. CHK900(warning)真实安装/卸载冒烟未执行 —— 需要 DSH 运行时(`dsh plugin` 装卸
 *    + profile 启动 + 卸载无残留验证),按 14 号文档 §4 留 blockers,不伪造结果。
 */
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, resolve, sep } from 'node:path'
import { isRecord, parseYaml, splitFrontmatter } from './util.ts'
import { readPackPackageJson, readYamlFile, scanSkills } from './pack.ts'
import { error, warning } from './types.ts'
import type { Finding } from './types.ts'

export interface PackCheckResult {
  readonly packRoot: string
  readonly findings: readonly Finding[]
  /** 跳过的包名式引用数(需要安装环境才能核验)。 */
  readonly skippedSpecifiers: number
}

export function checkPack(packRoot: string): PackCheckResult {
  const findings: Finding[] = []
  let skippedSpecifiers = 0
  const manifest = readPackPackageJson(packRoot)

  // 1. bundle 声明的 patch 文件存在。
  const patchDecl = manifest?.dsh?.bundle.patch
  const patchFiles = typeof patchDecl === 'string' ? [patchDecl] : patchDecl
  if (patchDecl === undefined) {
    findings.push(error('CHK001', 'package.json', '缺少 dsh.bundle.patch 声明,无从核对 bundle 引用'))
  } else if (patchFiles !== undefined) {
    for (const rel of patchFiles) {
      if (!existsSync(join(packRoot, rel))) {
        findings.push(error('CHK001', rel, 'dsh.bundle.patch 声明的文件不存在'))
      }
    }
  }

  // 2. patch 文档可解析 + 相对路径引用存在。
  if (patchFiles !== undefined) {
    for (const rel of patchFiles) {
      const abs = join(packRoot, rel)
      if (!existsSync(abs)) continue
      const parsed = parseYaml(readTextOr(abs))
      if (!parsed.ok || !Array.isArray(parsed.value)) {
        findings.push(error('CHK002', rel, `cordis patch 解析失败或顶层不是操作列表: ${parsed.ok ? '顶层应为 - insert/… 列表' : parsed.error ?? ''}`))
        continue
      }
      for (const ref of collectRelativePaths(parsed.value, rel)) {
        if (!existsSync(join(packRoot, ref.value))) {
          findings.push(error('CHK002', rel, `patch 引用的相对路径 ${ref.value} 不存在(出处 ${ref.where})`))
        }
      }
    }
  }

  // 3. profile.yml bundles 的路径式引用。
  const profileAbs = join(packRoot, 'profile.yml')
  if (existsSync(profileAbs)) {
    const profile = readYamlFile(packRoot, 'profile.yml')
    const bundles = profile.parsed.ok && isRecord(profile.parsed.value) ? profile.parsed.value.bundles : undefined
    if (Array.isArray(bundles)) {
      for (const item of bundles) {
        if (typeof item !== 'string') continue
        const entry: string = item
        if (entry.startsWith('./') || entry.startsWith('../')) {
          if (!existsSync(join(packRoot, entry))) {
            findings.push(error('CHK003', 'profile.yml', `bundles 路径式引用 ${entry} 不存在`))
          }
        } else {
          skippedSpecifiers++
        }
      }
    }
  }

  // 4. SKILL.md 相对 markdown 链接存在(条目引用的 scripts/references 资源)。
  for (const skill of scanSkills(packRoot).skills) {
    const fm = splitFrontmatter(skill.text)
    for (const target of collectMarkdownLinks(fm.body)) {
      const cleaned = target.split('#')[0] ?? target
      if (cleaned.length === 0) continue
      const abs = join(dirname(skill.absPath), cleaned)
      // DEF-2:显式报"路径越界",与"文件不存在"区分(根因不同:前者是链接写错层级,后者是文件缺失)。
      const packAbs = resolve(packRoot)
      if (!resolve(abs).startsWith(packAbs + sep)) {
        findings.push(error('CHK004', skill.relPath, `正文链接 ${target} 越出领域包根目录(相对路径写错层级,如多了 ../;应位于 ${packAbs} 之内)`))
        continue
      }
      if (!existsSync(abs)) {
        findings.push(error('CHK004', skill.relPath, `正文链接引用的文件 ${target} 不存在(相对 ${dirname(skill.relPath)}/)`))
      }
    }
  }

  // 5. 运行时冒烟缺口显式留痕(不静默降级)。
  findings.push(warning(
    'CHK900',
    '<pack>',
    '真实安装/卸载冒烟未执行(需 DSH 运行时:dsh plugin 装卸 + profile 启动 + 卸载无残留验证)——列入 blockers',
  ))

  findings.sort((a, b) => a.path.localeCompare(b.path) || a.code.localeCompare(b.code))
  return { packRoot, findings, skippedSpecifiers }
}

// ── 引用收集 ────────────────────────────────────────────────────────────────

interface PathRef {
  readonly value: string
  /** 出处描述(操作索引/字段路径),便于人定位。 */
  readonly where: string
}

/** 递归收集 YAML 树里全部 `./` / `../` 开头的字符串值(patch-relative 引用)。 */
function collectRelativePaths(node: unknown, where: string): readonly PathRef[] {
  const out: PathRef[] = []
  const walk = (value: unknown, at: string): void => {
    if (typeof value === 'string') {
      if (value.startsWith('./') || value.startsWith('../')) {
        out.push({ value, where: `${where}${at}` })
      }
      return
    }
    if (Array.isArray(value)) {
      value.forEach((item, i) => {
        walk(item, `${at}[${String(i)}]`)
      })
      return
    }
    if (isRecord(value)) {
      for (const key of Object.keys(value)) {
        walk(value[key], `${at}.${key}`)
      }
    }
  }
  walk(node, '')
  return out
}

const MD_LINK_RE = /\[[^\]]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g

/** 正文 markdown 链接目标,过滤外链/锚点/绝对 URL,只留相对引用。 */
function collectMarkdownLinks(body: string): readonly string[] {
  const out: string[] = []
  for (const match of body.matchAll(MD_LINK_RE)) {
    const target = match[1] ?? ''
    if (/^[a-z][a-z0-9+.-]*:/i.test(target)) continue // http: / mailto: / data: 等外链
    if (target.startsWith('/')) continue // 站点绝对路径,不在 pack 内判定
    out.push(target)
  }
  return out
}

function readTextOr(path: string): string {
  try {
    return readFileSync(path, 'utf8')
  } catch {
    return ''
  }
}
