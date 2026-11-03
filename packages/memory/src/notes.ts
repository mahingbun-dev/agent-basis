/**
 * M1 项目记忆:workspace NOTES 文件读写 + 检索接口。
 *
 * 设计依据(设计文档 08 §5.1 / 12 §2.2):「文件系统即记忆」(Manus/Anthropic
 * 双重验证模式)——项目目录下的 NOTES.md 与 notes/*.md 即项目记忆载体,
 * 生命周期跟随项目目录;压缩可逆(留引用丢正文)。
 *
 * 纪律:
 * - Cordis effect 配逆:write/append 返回 undo——精确恢复写入前状态
 *   (原文件恢复原内容;新建文件删除并尽量清掉为此创建的空目录);
 * - 一切写入先过 PII(构造时注入 PiiGuard,write/append 内强制 assertClean,
 *   fail-closed:命中即抛 PiiBlockedError,不落盘);
 * - 路径安全:只允许根目录内的 *.md 相对路径,拒绝绝对路径/~/../ 出根;
 * - coeffect 全声明:只依赖注入的 rootDir 与 guard,不碰任何全局。
 */
import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { dirname, isAbsolute, join, relative, resolve } from 'node:path'
import type { PiiGuard } from './pii.ts'

/** 一条 M1 检索命中(带出处:文件相对路径 + 行号)。 */
export interface NoteHit {
  /** 出处锚点,如 `notes/venue.md#L4`。 */
  readonly source: string
  /** 相对根目录的文件路径。 */
  readonly file: string
  /** 1 起行号。 */
  readonly line: number
  /** 命中行摘录(截断到 160 字符)。 */
  readonly excerpt: string
}

/** 一次 M1 写入的结果:携带应用逆闭包(Cordis effect 配逆)。 */
export interface NoteWriteResult {
  /** 相对根目录的文件路径。 */
  readonly file: string
  /** 写入前文件是否已存在。 */
  readonly existed: boolean
  /**
   * 应用逆闭包:恢复写入前状态。已存在 → 恢复原内容;新建 → 删除文件并
   * 尽量清掉为此创建的空目录(只删空目录,不碰他人内容)。幂等:重复调用无副作用。
   */
  undo(): Promise<void>
}

/** M1 检索选项。 */
export interface NoteSearchOptions {
  /** 最多返回条数(默认 20)。 */
  readonly limit?: number
}

const EXCERPT_MAX_CHARS = 160

/**
 * M1 项目记忆存储:根目录内的 markdown 文件即记忆。
 * 实例不可变字段;一个 workspace 一个实例。
 */
export class NotesStore {
  readonly #root: string
  readonly #guard: PiiGuard

  constructor(rootDir: string, guard: PiiGuard) {
    this.#root = resolve(rootDir)
    this.#guard = guard
  }

  /** 根目录(绝对路径)。 */
  get rootDir(): string {
    return this.#root
  }

  /** 读一个记忆文件;不存在返回 null。路径不合法/不在根内抛错。 */
  async read(file: string): Promise<string | null> {
    const abs = this.#resolveChecked(file)
    try {
      return await readFile(abs, { encoding: 'utf8' })
    } catch (error) {
      if (isNodeNoSuchFileError(error)) return null
      throw error
    }
  }

  /**
   * 写一个记忆文件(整文件覆盖)。写入前强制 PII assertClean(fail-closed)。
   * 返回携带应用逆闭包的结果。
   */
  async write(file: string, content: string): Promise<NoteWriteResult> {
    const abs = this.#resolveChecked(file)
    this.#guard.assertClean(content, file)
    const prior = await this.read(file)
    const createdDirs = await ensureDir(dirname(abs), this.#root)
    await writeFile(abs, content, { encoding: 'utf8' })
    let undone = false
    return {
      file: toRelative(file),
      existed: prior !== null,
      async undo(): Promise<void> {
        if (undone) return
        undone = true
        if (prior === null) {
          await rm(abs, { force: true })
          await pruneEmptyDirs(createdDirs)
        } else {
          await writeFile(abs, prior, { encoding: 'utf8' })
        }
      },
    }
  }

  /**
   * 追加到记忆文件(文件不存在则创建;以单个换行衔接,结尾补换行)。
   * 写入前强制 PII assertClean(fail-closed)。undo 恢复写入前全文/删除新建文件。
   */
  async append(file: string, content: string): Promise<NoteWriteResult> {
    const base = await this.read(file) ?? ''
    const glue = base.length === 0 || base.endsWith('\n') ? '' : '\n'
    return this.write(file, `${base}${glue}${content}\n`)
  }

  /**
   * 全文检索:多词 AND(大小写不敏感),按行命中,返回带出处(file#Lline)。
   * 遍历根目录下全部 *.md(含 NOTES.md 与 notes/ 子树),词项为空返回 []。
   */
  async search(query: string, options: NoteSearchOptions = {}): Promise<readonly NoteHit[]> {
    const terms = tokenize(query)
    if (terms.length === 0) return []
    const limit = options.limit ?? 20
    const files = await this.list()
    const hits: NoteHit[] = []
    for (const file of files) {
      if (hits.length >= limit) break
      const text = await this.read(file)
      if (text === null) continue
      const lines = text.split('\n')
      for (let index = 0; index < lines.length; index += 1) {
        if (hits.length >= limit) break
        const line = lines[index]
        if (line === undefined) continue
        const lower = line.toLowerCase()
        if (terms.every(term => lower.includes(term))) {
          hits.push({
            source: `${file}#L${index + 1}`,
            file,
            line: index + 1,
            excerpt: excerptOf(line),
          })
        }
      }
    }
    return hits
  }

  /** 列出根目录内全部记忆文件(相对路径,按路径排序;仅 *.md)。 */
  async list(): Promise<readonly string[]> {
    const out: string[] = []
    await collectMarkdown(this.#root, this.#root, out)
    out.sort()
    return out
  }

  /**
   * 校验并解析相对路径:拒绝绝对路径/~、出根路径、非 .md 后缀;
   * 返回绝对路径。允许 `./` 前缀与 `notes/` 子目录。
   */
  #resolveChecked(file: string): string {
    if (file.length === 0) throw new RangeError('[memory] 记忆文件路径不能为空')
    if (isAbsolute(file) || file.startsWith('~')) {
      throw new RangeError(`[memory] 记忆文件路径必须是相对路径:${file}`)
    }
    if (!file.endsWith('.md')) throw new RangeError(`[memory] 记忆文件必须是 .md:${file}`)
    const abs = resolve(this.#root, file)
    const rel = relative(this.#root, abs)
    if (rel.startsWith('..') || isAbsolute(rel) || rel.length === 0) {
      throw new RangeError(`[memory] 记忆文件路径越出工作区根目录:${file}`)
    }
    return abs
  }
}

/** 把查询拆成小写词项(空白分隔,丢弃空串)。 */
export function tokenize(query: string): readonly string[] {
  return query.trim().toLowerCase().split(/\s+/u).filter(term => term.length > 0)
}

function toRelative(file: string): string {
  return file.replace(/^\.\//u, '')
}

async function collectMarkdown(root: string, dir: string, out: string[]): Promise<void> {
  let entries
  try {
    entries = await readdir(dir, { withFileTypes: true })
  } catch {
    return // 根目录尚未创建:视为无记忆文件
  }
  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue
    const abs = join(dir, entry.name)
    if (entry.isDirectory()) {
      await collectMarkdown(root, abs, out)
    } else if (entry.isFile() && entry.name.endsWith('.md')) {
      out.push(relative(root, abs))
    }
  }
}

/** 逐级创建目录到 root 为止,返回新建的目录绝对路径(深→浅);已存在的不记。 */
async function ensureDir(dir: string, root: string): Promise<readonly string[]> {
  const created: string[] = []
  const chain: string[] = []
  let cursor = dir
  while (cursor.length >= root.length && cursor !== root) {
    chain.unshift(cursor)
    const parent = dirname(cursor)
    if (parent === cursor) break
    cursor = parent
  }
  for (const current of chain) {
    try {
      await mkdir(current)
      created.push(current)
    } catch (error) {
      if (!isNodeNoSuchFileError(error) && !isNodeExistsError(error)) throw error
    }
  }
  return created
}

/** 只删空目录,按深→浅尝试;非空或已消失则保留(best-effort,不影响内容逆)。 */
async function pruneEmptyDirs(dirs: readonly string[]): Promise<void> {
  for (const dir of dirs) {
    try {
      const entries = await readdir(dir)
      if (entries.length > 0) continue
      await rm(dir, { recursive: true, force: true })
    } catch {
      // 目录已消失等:best-effort 清理
    }
  }
}

function excerptOf(line: string): string {
  const trimmed = line.trim()
  const chars = Array.from(trimmed)
  return chars.length <= EXCERPT_MAX_CHARS ? trimmed : `${chars.slice(0, EXCERPT_MAX_CHARS).join('')}…`
}

function isNodeNoSuchFileError(error: unknown): boolean {
  return isNodeErrorWithCode(error, 'ENOENT')
}

function isNodeExistsError(error: unknown): boolean {
  return isNodeErrorWithCode(error, 'EEXIST')
}

function isNodeErrorWithCode(error: unknown, code: string): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === code
}
