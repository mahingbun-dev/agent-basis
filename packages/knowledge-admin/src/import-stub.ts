/**
 * stub 导入引擎(仓库 → markdown 占位页 → pending 提案)。
 *
 * 定位:DeepWiki/子进程引擎不可用时的**诚实兜底**——从仓库里的
 * `MEMORY_INDEX.md` / `README.md` / 文件树生成占位页,全部落 pending 提案供人审;
 * 结果**如实标注** `engine:'stub'` 并在 reason 里写明"真实生成需子进程引擎"。
 *
 * 纪律:
 * - 只读仓库文本(不执行仓库内任何代码/脚本;路径由调用方给出的**绝对目录**限定);
 * - 生成内容带显著占位标记(`> stub:...`),防止人被占位内容误导;
 * - 文件树页只列两级目录 + 主要源文件后缀(不递归全量,避免巨型仓库把提案表撑爆)。
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { basename, join, relative } from 'node:path'

/** 一条待导入片段(stub 或 spawn 提取出的 markdown 单元)。 */
export interface ImportFragment {
  readonly title: string
  readonly body: string
  readonly origin: string
  /** 仓库内的相对路径(诊断用;直接导入文本时为 undefined)。 */
  readonly source_path?: string | undefined
  readonly tags?: readonly string[] | undefined
}

/** stub 引擎结果(engine 字段固定 'stub',供调用方如实回显)。 */
export interface StubEngineResult {
  readonly engine: 'stub'
  readonly fragments: readonly ImportFragment[]
  readonly reason: string
}

/** 源文件后缀白名单(只列举"像代码/文档"的文件;二进制/产物不入树)。 */
const SOURCE_EXT = /\.(md|markdown|ts|tsx|js|mjs|cjs|jsx|py|go|rs|java|kt|rb|php|sql|yml|yaml|json|toml)$/i
/** 单片段正文上限(超长截断,提案表不被 PDF 式大文件撑爆)。 */
const BODY_MAX = 8_000

/**
 * 从仓库目录生成占位片段(纯读;不抛——目录不可读返回一条失败说明片段以外的空集,
 * 原因由调用方写进 reason)。
 */
export function collectStubFragments(repoPath: string, maxFiles: number): StubEngineResult {
  const rootName = basename(repoPath)
  const fragments: ImportFragment[] = []
  const push = (fragment: ImportFragment): void => {
    if (fragments.length >= maxFiles) return
    fragments.push(fragment)
  }

  // 1) MEMORY_INDEX.md(若在):最贴近"已知知识"的入口,单独成页
  for (const name of ['MEMORY_INDEX.md', 'memory_index.md', 'Memory.md'] as const) {
    const path = join(repoPath, name)
    if (!existsSync(path)) continue
    const text = readCapped(path)
    if (text === undefined) continue
    push({
      title: `${rootName} 记忆索引(${name})`,
      body: [
        `> stub 导入:本页由仓库内 ${name} 生成,内容未经 LLM wiki 生成引擎加工。`,
        '',
        text,
        '',
        '## Changelog',
        `- ${todayStamp()}: stub 导入生成占位页(待人工补全与评审)`,
      ].join('\n'),
      origin: relative(repoPath, path) || name,
      source_path: name,
      tags: ['stub-import', 'index'],
    })
  }

  // 2) README(若在):项目总览
  for (const name of ['README.md', 'Readme.md', 'readme.md'] as const) {
    const path = join(repoPath, name)
    if (!existsSync(path)) continue
    const text = readCapped(path, 6_000)
    if (text === undefined) continue
    push({
      title: `${rootName} 项目总览(${name})`,
      body: [
        `> stub 导入:本页摘自 ${name} 的前 6000 字,未经生成引擎加工。`,
        '',
        text,
        '',
        '## Changelog',
        `- ${todayStamp()}: stub 导入生成占位页(待人工补全与评审)`,
      ].join('\n'),
      origin: relative(repoPath, path) || name,
      source_path: name,
      tags: ['stub-import', 'overview'],
      break: true,
    } as ImportFragment & { break: true })
    break
  }

  // 3) 文件树(两级目录 + 源文件;一页)
  const tree = describeTree(repoPath)
  if (tree !== undefined) {
    push({
      title: `${rootName} 文件树`,
      body: [
        '> stub 导入:本页列出仓库两级目录与主要源文件,供人工评审时定位后续要生成的知识点。',
        '',
        tree,
        '',
        '## Changelog',
        `- ${todayStamp()}: stub 导入生成占位页(待人工补全与评审)`,
      ].join('\n'),
      origin: repoPath,
      tags: ['stub-import', 'tree'],
    })
  }

  // 4) 其余顶层 .md(每个一页,至多 maxFiles 条)
  for (const entry of listTopLevelMarkdown(repoPath)) {
    if (entry === 'README.md' || entry === 'MEMORY_INDEX.md') continue
    const path = join(repoPath, entry)
    const text = readCapped(path, 4_000)
    if (text === undefined) continue
    push({
      title: `${rootName}: ${entry.replace(/\.md$/i, '')}`,
      body: [
        `> stub 导入:本页摘自 ${entry} 的前 4000 字,未经生成引擎加工。`,
        '',
        text,
        '',
        '## Changelog',
        `- ${todayStamp()}: stub 导入生成占位页(待人工补全与评审)`,
      ].join('\n'),
      origin: entry,
      source_path: entry,
      tags: ['stub-import', 'doc'],
    })
  }

  return {
    engine: 'stub',
    fragments,
    reason: fragments.length === 0
      ? 'stub 引擎未在仓库内找到 MEMORY_INDEX.md / README.md / 顶层 markdown;真实生成需子进程引擎(engine=\'spawn\' + DeepWiki/LLM wiki 生成器)'
      : 'stub 引擎按 MEMORY_INDEX.md/README/文件树生成占位页(未调用 DeepWiki 生成器);真实生成需子进程引擎(engine=\'spawn\')',
  }
}

/** 两级目录摘要(目录不存在/不可读 → undefined)。 */
export function describeTree(repoPath: string): string | undefined {
  try {
    const lines: string[] = [`- ${basename(repoPath)}/`]
    const top = readdirSync(repoPath, { withFileTypes: true })
      .filter(entry => !entry.name.startsWith('.') && entry.name !== 'node_modules')
      .sort((a, b) => a.name.localeCompare(b.name))
    for (const entry of top.slice(0, 40)) {
      if (entry.isDirectory()) {
        lines.push(`  - ${entry.name}/`)
        const second = readdirSync(join(repoPath, entry.name), { withFileTypes: true })
          .filter(child => !child.name.startsWith('.'))
          .sort((a, b) => a.name.localeCompare(b.name))
        for (const child of second.slice(0, 12)) {
          if (child.isDirectory()) lines.push(`    - ${child.name}/`)
          else if (SOURCE_EXT.test(child.name)) lines.push(`    - ${child.name}`)
        }
      } else if (SOURCE_EXT.test(entry.name)) {
        lines.push(`  - ${entry.name}`)
      }
    }
    if (lines.length <= 1) return undefined
    return lines.join('\n')
  } catch {
    return undefined
  }
}

function listTopLevelMarkdown(repoPath: string): readonly string[] {
  try {
    return readdirSync(repoPath, { withFileTypes: true })
      .filter(entry => entry.isFile() && /\.(md|markdown)$/i.test(entry.name))
      .map(entry => entry.name)
      .sort((a, b) => a.localeCompare(b))
      .slice(0, 30)
  } catch {
    return []
  }
}

/** 读文本并截断(文件不可读/过大 → undefined)。 */
function readCapped(path: string, max = BODY_MAX): string | undefined {
  try {
    if (!statSync(path).isFile()) return undefined
    const raw = readFileSync(path, 'utf8')
    const text = raw.trim()
    if (text.length === 0) return undefined
    return text.length > max ? `${text.slice(0, max)}\n\n…(截断:原文 ${raw.length} 字符)` : text
  } catch {
    return undefined
  }
}

function todayStamp(): string {
  const now = new Date()
  const yyyy = now.getUTCFullYear()
  const mm = String(now.getUTCMonth() + 1).padStart(2, '0')
  const dd = String(now.getUTCDate()).padStart(2, '0')
  return `${yyyy}-${mm}-${dd}`
}
