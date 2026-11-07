/**
 * persona 写回落点(T7.0 spike §2 结论):Web 组合的会话 persona 由 agent-preset
 * 行 `preset-standard` 的 plugins[id=persona].config.prefix 提供(以同名段遮蔽宿主
 * system-prompt 行的 personaPrefix),故本模块只读写 profile patch 层文件里的
 * preset-standard 行,不碰宿主 system-prompt 行。
 *
 * 生成方式是纯文本变换(spike §4.1:禁止经 yaml 库 round-trip——`!!js` 表达式会被
 * 剥标签致行语义损坏),只替换唯一的 `prefix:` 行;新值用 YAML 双引号标量
 * (支持 \n \" \\ 转义,任意 persona 文本安全),不动其他任何字节。
 *
 * 持久化纪律(spike §4.2 + 计划书 §7 风险项):
 * - 原子写:同目录临时文件(wx)+ fsync + rename(对齐 dsh-storage-json writeAtomic);
 * - 单写者:实例级 Promise 链串行全部写;
 * - 写前自检 + 失败自动还原:rename 后跑 verify(宿主为 `dsh --dump-config` 干跑,
 *   无副作用),verify 抛错即从同目录备份原子还原并上抛。
 */
import { copyFile, mkdir, open, readFile, rename, rm, stat } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { byteLength } from './checksum.ts'
import type { PersonaState } from './types.ts'

/** preset-standard 行 id(spike 实证的 persona 落点行)。 */
export const PRESET_ROW_ID = 'preset-standard'

/** 读出的 prefix 行信息。 */
interface PrefixLine {
  readonly index: number
  readonly indent: string
  readonly value: string
}

/** patch 文件 IO 面(实现用真实 fs;测试可注入)。atomicWrite = 临时文件+fsync+rename。 */
export interface PersonaPatchIo {
  readFile(path: string): Promise<string>
  atomicWrite(path: string, data: string): Promise<void>
  copyFile(from: string, to: string): Promise<void>
  mkdir(path: string): Promise<void>
  rm(path: string): Promise<void>
  mtimeMs(path: string): Promise<number | null>
}

/** 真实 fs 实现(原子写对齐 dsh-storage-json lib/types/atomic.js writeAtomic)。 */
export const nodePersonaPatchIo: PersonaPatchIo = {
  readFile: path => readFile(path, 'utf8'),
  atomicWrite: async (path, data) => {
    const tmp = join(dirname(path), `.${Math.random().toString(36).slice(2, 10)}.tmp`)
    try {
      const handle = await open(tmp, 'wx', 0o600)
      try {
        await handle.writeFile(data, 'utf8')
        await handle.sync()
      } finally {
        await handle.close()
      }
      await rename(tmp, path)
    } catch (error) {
      await rm(tmp, { force: true })
      throw error
    }
  },
  copyFile: (from, to) => copyFile(from, to),
  mkdir: async (path) => { await mkdir(path, { recursive: true }) },
  rm: path => rm(path, { force: true }),
  mtimeMs: async (path) => {
    try {
      return (await stat(path)).mtimeMs
    } catch {
      return null
    }
  },
}

/** YAML 双引号标量转义(\n \r \t \" \\ 与 C0 控制字符)。 */
export function yamlDoubleQuoted(text: string): string {
  const escaped = text
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r')
    .replace(/\t/g, '\\t')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, char => `\\x${char.charCodeAt(0).toString(16).padStart(2, '0')}`)
  return `"${escaped}"`
}

/** YAML 标量反引(单引号/双引号/裸标量;块标量不支持——返回 undefined 走 fail-closed)。 */
export function unquoteYamlScalar(raw: string): string | undefined {
  const trimmed = raw.trim()
  if (trimmed.startsWith('"') && trimmed.endsWith('"') && trimmed.length >= 2) {
    const body = trimmed.slice(1, -1)
    let out = ''
    for (let i = 0; i < body.length; i += 1) {
      const char = body[i] as string
      if (char !== '\\') {
        out += char
        continue
      }
      const next = body[i + 1]
      i += 1
      switch (next) {
        case 'n': out += '\n'; break
        case 'r': out += '\r'; break
        case 't': out += '\t'; break
        case '"': out += '"'; break
        case '\\': out += '\\'; break
        case 'x': {
          const hex = body.slice(i + 1, i + 3)
          if (hex.length !== 2) return undefined
          out += String.fromCharCode(Number.parseInt(hex, 16))
          i += 2
          break
        }
        case 'u': {
          const hex = body.slice(i + 1, i + 5)
          if (hex.length !== 4) return undefined
          out += String.fromCharCode(Number.parseInt(hex, 16))
          i += 4
          break
        }
        default: return undefined
      }
    }
    return out
  }
  if (trimmed.startsWith("'") && trimmed.endsWith("'") && trimmed.length >= 2) {
    return trimmed.slice(1, -1).replace(/''/g, "'")
  }
  if (/^[|>][-+]?[0-9]*$/.test(trimmed)) return undefined // 块标量:本模块不写也不猜
  return trimmed === '' ? '' : trimmed
}

/** 在 preset-standard 行 span 内找唯一的 prefix 行;0 或 ≥2 个即抛(fail-closed)。 */
export function locatePrefixLine(lines: readonly string[]): PrefixLine {
  const rowStart = lines.findIndex(line => /^- id: preset-standard\s*$/.test(line))
  if (rowStart < 0) {
    throw new Error(`patch 层无 ${PRESET_ROW_ID} 行(Web 组合 persona 落点缺失;SDK 档无此行,不适用本写回路径)`)
  }
  let rowEnd = lines.length
  for (let i = rowStart + 1; i < lines.length; i += 1) {
    if (/^- id: \S/.test(lines[i] as string)) {
      rowEnd = i
      break
    }
  }
  const matches: PrefixLine[] = []
  for (let i = rowStart; i < rowEnd; i += 1) {
    const line = lines[i] as string
    const match = /^(\s*)prefix: (.*)$/.exec(line)
    if (match !== null) {
      matches.push({ index: i, indent: match[1] ?? '', value: match[2] ?? '' })
    }
  }
  if (matches.length !== 1) {
    throw new Error(`preset-standard 行内 prefix: 行数期望 1,实际 ${matches.length}(fail-closed,拒绝改写)`)
  }
  return matches[0] as PrefixLine
}

/** 纯文本变换:仅替换 prefix 行为双引号标量,其余字节原样。 */
export function buildNextPatchText(original: string, persona: string): string {
  const lines = original.split('\n')
  const prefix = locatePrefixLine(lines)
  const next = [...lines]
  next[prefix.index] = `${prefix.indent}prefix: ${yamlDoubleQuoted(persona)}`
  return next.join('\n')
}

/**
 * 保存前 patch 文本 YAML 解析自检(T7.3 ⑦,零依赖;写盘前的最后一道闸):
 * 1. 下一版文本仍能定位唯一 prefix 行(行结构未被破坏);
 * 2. 新 prefix 行经本模块的 YAML 双引号标量反引(即一个最小 YAML 标量解析器)
 *    逐字还原出目标 persona(round-trip 自检——转义有损/被截断即抛);
 * 3. 纯文本变换纪律:行数不变、且只有 prefix 那一行不同(其余字节原样)。
 * 任何一条不满足即抛错——writeNext 在备份/写盘之前调用本函数,失败即什么都没写。
 * 全文档级解析由写盘后的宿主 dry-run(dsh --dump-config)兜底,失败自动还原。
 */
export function selfCheckNextPatchText(original: string, next: string, persona: string): void {
  const originalLines = original.split('\n')
  const nextLines = next.split('\n')
  if (nextLines.length !== originalLines.length) {
    throw new Error(`patch 自检失败:行数变了(期望 ${originalLines.length},实际 ${nextLines.length})`)
  }
  const prefix = locatePrefixLine(nextLines)
  const unquoted = unquoteYamlScalar(prefix.value)
  if (unquoted !== persona) {
    throw new Error('patch 自检失败:新 prefix 行反引结果与目标 persona 不一致(YAML 转义有损)')
  }
  const before = locatePrefixLine(originalLines)
  const changed: number[] = []
  for (let i = 0; i < nextLines.length; i += 1) {
    if (nextLines[i] !== originalLines[i]) changed.push(i)
  }
  if (changed.length !== 1 || changed[0] !== prefix.index || before.index !== prefix.index) {
    throw new Error(`patch 自检失败:变更行数期望 1(prefix 行),实际 ${changed.length}`)
  }
}

export interface PersonaPatchOptions {
  readonly io?: PersonaPatchIo
}

export interface PersonaWriteResult {
  /** patch 文件被原子替换(或内容本就一致,等效达成)。 */
  readonly replaced: true
  /** 写后 persona 字节数。 */
  readonly bytes: number
}

/** persona patch 文件句柄:读当前态 + 受治理的原子写(单写者 + 失败自动还原)。 */
export class PersonaPatchFile {
  readonly #path: string
  readonly #io: PersonaPatchIo
  /** 单写者链(patch 是整文件语义,并发写必须串行)。 */
  #chain: Promise<unknown> = Promise.resolve()

  constructor(path: string, options: PersonaPatchOptions = {}) {
    this.#path = path
    this.#io = options.io ?? nodePersonaPatchIo
  }

  /** patch 文件绝对路径。 */
  get path(): string {
    return this.#path
  }

  /** 读当前 persona 态(容错:任何失败都变成 available=false + error,不抛)。 */
  async read(): Promise<PersonaState> {
    const mtime = await this.#io.mtimeMs(this.#path)
    const updatedAt = mtime !== null ? new Date(mtime).toISOString() : null
    let original: string
    try {
      original = await this.#io.readFile(this.#path)
    } catch (error) {
      return {
        available: false, text: '', bytes: 0, patchPath: this.#path, updatedAt,
        error: `patch 层不可读:${error instanceof Error ? error.message : String(error)}`,
      }
    }
    try {
      const prefix = locatePrefixLine(original.split('\n'))
      const text = unquoteYamlScalar(prefix.value)
      if (text === undefined) {
        return {
          available: false, text: '', bytes: 0, patchPath: this.#path, updatedAt,
          error: 'prefix: 行是块标量或不可解析标量(本写回路径不支持)',
        }
      }
      return { available: true, text, bytes: byteLength(text), patchPath: this.#path, updatedAt, error: null }
    } catch (error) {
      return {
        available: false, text: '', bytes: 0, patchPath: this.#path, updatedAt,
        error: error instanceof Error ? error.message : String(error),
      }
    }
  }

  /**
   * 原子替换 persona:备份 → 临时文件+rename → verify → 失败自动还原。
   * verify(如宿主 dump-config 干跑)在 rename 之后跑;抛错即还原原始字节并上抛,
   * 调用方不需要(也不应该)自己清理。写后无任何 .tmp/.bak 残留(单测钉住)。
   */
  writeNext(
    persona: string,
    options: { verify?: () => Promise<void> } = {},
  ): Promise<PersonaWriteResult> {
    const run = this.#chain.then(async () => {
      const original = await this.#io.readFile(this.#path)
      // 语义等价短路:当前 persona 已等于目标(引号风格差异不算变更)→ 不写盘、不 verify。
      const prefix = locatePrefixLine(original.split('\n'))
      const current = unquoteYamlScalar(prefix.value)
      if (current === persona) {
        return { replaced: true as const, bytes: byteLength(persona) }
      }
      const next = buildNextPatchText(original, persona)
      if (next === original) {
        return { replaced: true as const, bytes: byteLength(persona) }
      }
      // 保存前 YAML 解析自检(T7.3 ⑦):失败即抛,此时什么都还没写。
      selfCheckNextPatchText(original, next, persona)
      const dir = dirname(this.#path)
      const stamp = new Date().toISOString().replace(/[-:.TZ]/g, '')
      const backupPath = join(dir, `.prompt-studio.${stamp}.${Math.random().toString(36).slice(2, 6)}.bak`)
      await this.#io.mkdir(dir)
      await this.#io.copyFile(this.#path, backupPath)
      try {
        await this.#io.atomicWrite(this.#path, next)
        try {
          await options.verify?.()
        } catch (error) {
          // 失败自动还原:备份字节原子写回。
          await this.#io.atomicWrite(this.#path, original)
          throw error
        }
        return { replaced: true as const, bytes: byteLength(persona) }
      } finally {
        await this.#io.rm(backupPath).catch(() => undefined)
      }
    })
    this.#chain = run.catch(() => undefined)
    return run
  }
}
