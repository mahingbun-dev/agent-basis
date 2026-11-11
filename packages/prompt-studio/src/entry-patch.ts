/**
 * 按条目 patch 定位重述写回(T1.6,测试计划 §3 T1.6 / §6 横切 1):
 *
 * 把 T7 persona-patch 的「纯文本重述」配方从单 persona 行泛化到注册表全部 patch 值型
 * 条目——定位(YamlLocator:顶层行 → 行内插件列表项 → config 键)→ 只替换目标值的
 * 行区域,其余字节原样。覆盖三类块标量写形态(测试计划 §9.5,任一缺形态即未完成):
 * - 形态 A|领域层折叠块 `>-`:packs/{event-planning,industrial-analysis} 的 personaPrefix;
 * - 形态 B|preset-cordis 折叠块 `>-`:profiles/eterna-web/cordis.patch.yml:149-150 的
 *   persona prefix——块头+续行必须整块替换,单行替换会残留续行产生脏 YAML;
 * - 形态 C|plan-mode 字面块 `|` 多段整段:两预设 planning→plan-mode 的 config.section;
 * - 形态 D|多行 plain 折叠标量(T3.2):官方 configEditor 把长单行值序列化为「键行+
 *   更深缩进续行」的折叠形态(t7 隔离档实测)——span 覆盖续行整段替换,读侧按
 *   plain 折叠语义反引(registry.readYamlValueAtLine)。
 * 另含:单行标量形态(preset-standard persona 裸标量/agent-instructions 数值,T7 既有
 * 配方等价)与整文件形态(persona.md 全文=值)。
 *
 * 纪律(全部继承 persona-patch.ts,spike §4):
 * - 纯文本变换,禁止 yaml 库 round-trip(`!!js` 表达式会被剥标签);
 * - fail-closed:定位 0/≥2 命中、值形态不可写回、反引 round-trip 不一致即抛,零落盘;
 * - TOCTOU 写前基线校验:审批时文件字节(baseline)与写前现值不一致 → 拒写零落盘,
 *   文件保持外部改写后的状态(不覆盖 profile 升级合并等他人改动);
 * - 原子写 + 备份 + verify(宿主 dump-config 干跑)失败自动还原;
 * - 单写者:按文件路径分链串行全部写(同一 patch 文件的多个条目共用一条链)。
 */
import { dirname, join } from 'node:path'
import { nodePersonaPatchIo } from './persona-patch.ts'
import type { PersonaPatchIo } from './persona-patch.ts'
import { yamlDoubleQuoted } from './persona-patch.ts'
import {
  BLOCK_INDICATOR_RE, findListItemSpan, findTopLevelRow, indentOf, parseBlockHeader, readYamlValueAtLine,
} from './registry.ts'
import type { PromptRegistryEntry } from './registry.ts'

/** 条目在文件中的写回落点 span(行数组下标,end 为排他界)。 */
export interface EntrySpan {
  /** 键行(块头行/标量行)下标。 */
  readonly keyIndex: number
  /** 替换区域排他界(块标量=块头+全部续行;标量=keyIndex+1;整文件=全文件)。 */
  readonly end: number
  /** 键行值是否块标量(|/>)。 */
  readonly isBlock: boolean
  /** 键行缩进(含 configKey 的行)。 */
  readonly keyIndent: number
  /** 原块内容缩进(空块/标量=键缩进+2 缺省)。 */
  readonly contentIndent: number
  /** 原始键行上的值文本(块标量=指示符)。 */
  readonly rawValue: string
}

/** 键行主名(定位错误信息用;条目 yaml 定位外的整文件条目无键行)。 */
function keyLabelOf(entry: PromptRegistryEntry): string {
  const yaml = entry.yaml
  if (yaml === undefined) return '(整文件条目)'
  return `${yaml.file} 内 ${yaml.rowId}${yaml.pluginPath === undefined ? '' : ` → ${yaml.pluginPath.join(' → ')}`} 的 ${yaml.configKey}:`
}

/**
 * 定位条目写回落点(fail-closed,错误明示成因):
 * - 行缺失(顶层行/插件项/键行)→ 「结构定位失败」;
 * - 键行 0 命中(形态漂移)或 ≥2 命中(重述歧义)→ 期望 1 实际 N;
 * - 值在后续行(嵌套映射,rawValue='')→ 本写回路径不支持。
 * 与 registry.locateYamlConfigKey 的关系:同一结构走位(共用 findTopLevelRow/
 * findListItemSpan),本函数面向写侧给出 span 与精确错误,不吞成因。
 */
export function entrySpanOf(entry: PromptRegistryEntry, lines: readonly string[]): EntrySpan {
  const yaml = entry.yaml
  if (yaml === undefined) {
    // 整文件条目:span=全文件(end 越界值仅在 build 整文件分支使用,不走键行语义)。
    return { keyIndex: 0, end: lines.length, isBlock: false, keyIndent: 0, contentIndent: 0, rawValue: '' }
  }
  const row = findTopLevelRow(lines, yaml.rowId)
  if (row === undefined) {
    throw new Error(`写回定位失败(${entry.id}):${keyLabelOf(entry)} 所在行 '- id: ${yaml.rowId}' 不在文件中(结构漂移,fail-closed 拒写)`)
  }
  let span = row
  let minIndent = 0
  for (const pluginId of yaml.pluginPath ?? []) {
    const item = findListItemSpan(lines, span, pluginId, minIndent)
    if (item === undefined) {
      throw new Error(`写回定位失败(${entry.id}):${keyLabelOf(entry)} 插件项 '- id: ${pluginId}' 不在 ${yaml.rowId} 行内(结构漂移,fail-closed 拒写)`)
    }
    span = { start: item.start, end: item.end }
    minIndent = item.indent
  }
  const keyPattern = new RegExp(`^(\\s*)${yaml.configKey}: (.*)$`)
  const matches: Array<{ index: number; indent: string; value: string }> = []
  for (let i = span.start; i < span.end; i += 1) {
    const match = keyPattern.exec(lines[i] as string)
    if (match !== null && (match[1] ?? '').length > minIndent) {
      matches.push({ index: i, indent: match[1] ?? '', value: match[2] ?? '' })
    }
  }
  if (matches.length !== 1) {
    throw new Error(`写回定位失败(${entry.id}):${keyLabelOf(entry)} 行数期望 1,实际 ${matches.length}(fail-closed 拒写)`)
  }
  const located = matches[0] as { index: number; indent: string; value: string }
  const rawValue = located.value.trim()
  if (rawValue === '') {
    throw new Error(`写回定位失败(${entry.id}):${keyLabelOf(entry)} 值在后续行(嵌套映射/序列),本写回路径不支持`)
  }
  const keyIndent = located.indent.length
  if (!BLOCK_INDICATOR_RE.test(rawValue)) {
    // T3.2:官方 configEditor 会把长单行值序列化为多行 plain 折叠标量(键行 + 更深
    // 缩进续行;2026-11-11 t7 隔离档实测)——span 必须覆盖到最后一行续行,标量替换
    // 时整段换为单行(残留续行=脏 YAML,T1.6「整块替换」纪律对新增形态同样成立)。
    // 空行不推进 end(尾部空行是分隔符),其后仍是更深缩进的续行则继续收集(中间空行)。
    let scalarEnd = located.index + 1
    for (let i = located.index + 1; i < lines.length; i += 1) {
      const line = lines[i] as string
      if (/^\s*$/.test(line)) continue
      if (indentOf(line) <= keyIndent) break
      scalarEnd = i + 1
    }
    return { keyIndex: located.index, end: scalarEnd, isBlock: false, keyIndent, contentIndent: keyIndent + 2, rawValue }
  }
  // 块标量:块头行 + 全部续行(空行与缩进 > 键缩进的行);尾部空行是分隔符不属块,不替换。
  const header = parseBlockHeader(lines, located.index)
  if (header === undefined) {
    throw new Error(`写回定位失败(${entry.id}):${keyLabelOf(entry)} 块标量头不可解析(「${rawValue}」,fail-closed 拒写)`)
  }
  let end = located.index + 1
  let contentIndent = keyIndent + 2
  let sawContent = false
  for (let i = located.index + 1; i < lines.length; i += 1) {
    const line = lines[i] as string
    if (/^\s*$/.test(line)) continue // 尾部空行不推进 end(分隔符)
    if (indentOf(line) <= keyIndent) break
    end = i + 1
    if (!sawContent) {
      contentIndent = header.explicitIndent !== null ? keyIndent + header.explicitIndent : indentOf(line)
      sawContent = true
    }
  }
  return { keyIndex: located.index, end, isBlock: true, keyIndent, contentIndent, rawValue }
}

// ---------- 新值重述 emission ----------

/**
 * 新文本的块指示符:样式(|字面/>折叠)沿用原块,chomping 按新文本尾换行数适配
 * (0=strip '-'、1=clip 缺省、≥2=keep '+')——保证任何新文本都能无损 round-trip
 * (如 `|` 块收到无尾换行文本时,硬保 clip 会读回多一个 \n,自检即炸;适配指示符
 * 是无损写回的正解,块语义不变,读回值与目标逐字一致)。
 */
function nextBlockIndicator(style: '|' | '>', text: string): string {
  const lines = text.split('\n')
  let trailing = 0
  while (trailing < lines.length && lines[lines.length - 1 - trailing] === '') trailing += 1
  const chomp = trailing === 0 ? '-' : trailing === 1 ? '' : '+'
  return `${style}${chomp}`
}

/** 字面块(|)内容行:行按原样缩进,空行输出空行。 */
function literalRows(body: readonly string[], indent: string): string[] {
  return body.map(line => (line === '' ? '' : `${indent}${line}`))
}

/**
 * 折叠块(>)内容行:相邻非空行折叠为空格,k 个连续空行→k 个换行(registry 读侧
 * foldBlockLines 语义)。写侧对偶:文本里每处「非空行→非空行」的换行 = 空行数+1
 * (即正文行间至少 1 个空行);正文首行前的空行无法经折叠块表示(读侧忽略首段
 * 空行)——该形态由 selfCheck 的 round-trip 拦下,fail-closed。
 */
function foldedRows(body: readonly string[], indent: string): string[] {
  const rows: string[] = []
  let blanks = 0
  for (const line of body) {
    if (line === '') {
      blanks += 1
      continue
    }
    if (rows.length > 0) {
      for (let b = 0; b <= blanks; b += 1) rows.push('')
    }
    blanks = 0
    rows.push(`${indent}${line}`)
  }
  return rows
}

/** 标量形态新值:原值为裸标量且新文本是纯整数 → 裸标量保持数值类型(如 maxBytes);其余双引号。 */
function nextScalarValue(text: string, oldRawWasPlain: boolean): string {
  if (oldRawWasPlain && /^\d+$/u.test(text)) return text
  return yamlDoubleQuoted(text)
}

/**
 * 构造写回后的整文件文本(纯函数,零 IO):
 * - 整文件条目(yaml 缺席):新文本即全文;
 * - 键值条目:定位 span → 标量形态替换单行 / 块标量形态整块替换(块头+续行一起)。
 * 任何定位/形态异常上抛(fail-closed),调用方零落盘。
 */
export function buildNextEntryFileText(entry: PromptRegistryEntry, original: string, nextText: string): string {
  if (entry.yaml === undefined) return nextText
  const lines = original.split('\n')
  const span = entrySpanOf(entry, lines)
  const indent = ' '.repeat(span.keyIndent)
  if (!span.isBlock) {
    const wasPlain = !(span.rawValue.startsWith('"') || span.rawValue.startsWith("'"))
    // 整段替换(span 可能覆盖多行 plain 折叠续行——T3.2 形态,残留续行=脏 YAML)。
    const next = [
      ...lines.slice(0, span.keyIndex),
      `${indent}${entry.yaml.configKey}: ${nextScalarValue(nextText, wasPlain)}`,
      ...lines.slice(span.end),
    ]
    return next.join('\n')
  }
  const header = parseBlockHeader(lines, span.keyIndex)
  if (header === undefined) {
    throw new Error(`写回定位失败(${entry.id}):块标量头不可解析(fail-closed 拒写)`)
  }
  const indicator = nextBlockIndicator(header.style, nextText)
  const bodyLines = nextText.split('\n')
  // 尾部空行交给 chomping 指示符表达,正文行不带尾部空行。
  while (bodyLines.length > 0 && bodyLines[bodyLines.length - 1] === '') bodyLines.pop()
  const contentIndent = ' '.repeat(span.contentIndent)
  const rows = header.style === '|' ? literalRows(bodyLines, contentIndent) : foldedRows(bodyLines, contentIndent)
  const next = [...lines.slice(0, span.keyIndex), `${indent}${entry.yaml.configKey}: ${indicator}`, ...rows, ...lines.slice(span.end)]
  return next.join('\n')
}

/**
 * 写盘前自检(零依赖最后一道闸;失败即什么都没写):
 * 1. round-trip:写后文本重新定位键行,经读侧(readYamlValueAtLine,与写侧 emission
 *    互为独立路径)反引,必须逐字==目标文本;
 * 2. 区域纪律:除目标区域(原 span / 新 span)外逐字节不变——写前区域之前的行与
 *    写后区域结束之后的行必须与原文件完全一致(!!js 行等其余内容保真)。
 */
export function selfCheckEntryWrite(entry: PromptRegistryEntry, original: string, next: string, nextText: string): void {
  if (entry.yaml === undefined) {
    if (next !== nextText) {
      throw new Error(`写回自检失败(${entry.id}):整文件条目写回文本与目标不一致`)
    }
    return
  }
  const originalLines = original.split('\n')
  const nextLines = next.split('\n')
  const before = entrySpanOf(entry, originalLines)
  const after = entrySpanOf(entry, nextLines)
  // 1) round-trip:读侧反引 == 目标。
  const readBack = readYamlValueAtLine(nextLines, after.keyIndex)
  if (readBack !== nextText) {
    throw new Error(`写回自检失败(${entry.id}):写后值反引与目标不一致(重述有损;折叠块不支持正文首行前空行的文本)`)
  }
  // 2) 区域纪律:目标区域之前/之后逐行一致。
  const beforeRegion = originalLines.slice(0, before.keyIndex)
  if (beforeRegion.join('\n') !== nextLines.slice(0, after.keyIndex).join('\n')) {
    throw new Error(`写回自检失败(${entry.id}):目标区域之前的内容被改动(纯文本变换纪律被破坏)`)
  }
  if (originalLines.slice(before.end).join('\n') !== nextLines.slice(after.end).join('\n')) {
    throw new Error(`写回自检失败(${entry.id}):目标区域之后的内容被改动(块标量必须整块替换,不得残留续行)`)
  }
}

// ---------- 受治理的文件写(单写者 + TOCTOU 基线 + 原子写 + verify 还原) ----------

/** 单次受治理写的输入(build 抛错=零落盘;baseline 不符=TOCTOU 拒写零落盘)。 */
export interface EntryWriteRequest {
  /** 目标文件绝对路径(同路径共用单写者链)。 */
  readonly path: string
  /** 纯文本变换:原文件文本 → 新文件文本(内含定位与自检,失败上抛)。 */
  readonly build: (original: string) => string
  /** TOCTOU 写前基线:审批发起时的文件全文;与写前现值不一致即拒写(不覆盖他人改动)。 */
  readonly baseline?: string | undefined
  /** 写盘后验证(如宿主 dump-config 干跑);抛错即自动还原原始字节。 */
  readonly verify?: () => Promise<void>
}

/** 按条目写回产物。 */
export interface EntryWriteResult {
  readonly replaced: true
  /** 是否真的改了盘(语义等价短路时 false:内容一致,未动字节、未跑 verify)。 */
  readonly changed: boolean
}

/**
 * 受治理通道执行请求(T2.1 configEditor 通道):与 writeNext 同文件同链单写者,但
 * 写动作由 `run` 自带(官方 seam 内部自管原子写与 Loader 重组合);本壳补齐直写通道
 * 同款的 TOCTOU 基线门与写后 verify 失败还原纪律(persona-patch.test.ts:159-167 口径)。
 */
export interface GovernedRunRequest {
  /** 目标文件绝对路径(同路径共用单写者链,与直写通道互斥串行)。 */
  readonly path: string
  /** TOCTOU 写前基线(审批时的文件全文);与写前现值不一致即拒写(零写入)。 */
  readonly baseline?: string | undefined
  /** 通道执行体(如 configEditor.edit);抛错=通道失败,上抛调用方。 */
  readonly run: () => Promise<void>
  /** 写后验证(同 writeNext.verify;抛错触发还原后上抛)。 */
  readonly verify?: () => Promise<void>
  /** verify 失败的通道级还原(如经同一 configEditor seam 写回审批前行 config,同步重组合)。 */
  readonly restore?: () => Promise<void>
}

/**
 * TOCTOU 拒写错误(写前基线不符):文件在审批后被外部改写。零磁盘操作——文件
 * 保持外部改写后的状态。写链路网关以「可刷新重试的 rejected」语义回给调用方
 * (区别于 I/O 型写失败的上抛),本类型即两者的判别面。
 */
export class EntryToctouError extends Error {
  constructor(path: string) {
    super(`TOCTOU 拒写:文件在审批后被外部改写(${path}),请刷新后重新发起(现值保持外部改写后的状态,未覆盖)`)
    this.name = 'EntryToctouError'
  }
}

/**
 * 按条目受治理写回器(T1.6):按文件路径分链的单写者(同一 patch 文件的多个条目
 * 并发写自然串行),每次写 = TOCTOU 基线校验 → build(定位+重述+自检)→ 备份 →
 * 原子写 → verify(失败自动还原)。与 PersonaPatchFile 的差异:面向任意条目/任意
 * 文件(领域包文件各自成链),新增 baseline TOCTOU 门;写盘纪律(原子写/备份/还原/
 * 无残留)与 persona-patch 同款。T2.1 起 runGoverned 把 configEditor 官方 seam 写回
 * 纳入同一条单写者链(与直写通道互斥串行)。
 */
export class EntryPatchFile {
  readonly #io: PersonaPatchIo
  /** 按路径分链的单写者(整文件语义,同文件并发写必须串行)。 */
  readonly #chains = new Map<string, Promise<unknown>>()

  constructor(io: PersonaPatchIo = nodePersonaPatchIo) {
    this.#io = io
  }

  writeNext(request: EntryWriteRequest): Promise<EntryWriteResult> {
    const path = request.path
    const run = (this.#chains.get(path) ?? Promise.resolve()).then(async () => {
      const original = await this.#io.readFile(path)
      // TOCTOU 写前基线:审批后文件被外部改写(profile 升级合并/他方编辑)→ 拒写,
      // 保持外部改写后的状态,不覆盖他人改动(零磁盘操作)。
      if (request.baseline !== undefined && request.baseline !== original) {
        throw new EntryToctouError(path)
      }
      const next = request.build(original)
      if (next === original) {
        return { replaced: true as const, changed: false }
      }
      const dir = dirname(path)
      const stamp = new Date().toISOString().replace(/[-:.TZ]/g, '')
      const backupPath = join(dir, `.prompt-studio.${stamp}.${Math.random().toString(36).slice(2, 6)}.bak`)
      await this.#io.mkdir(dir)
      await this.#io.copyFile(path, backupPath)
      try {
        await this.#io.atomicWrite(path, next)
        try {
          await request.verify?.()
        } catch (error) {
          // 失败自动还原:备份字节原子写回。
          await this.#io.atomicWrite(path, original)
          throw error
        }
        return { replaced: true as const, changed: true }
      } finally {
        await this.#io.rm(backupPath).catch(() => undefined)
      }
    })
    this.#chains.set(path, run.catch(() => undefined))
    return run
  }

  /**
   * 受治理通道执行(T2.1 configEditor 通道):TOCTOU 基线校验 → run(官方 seam 写回)
   * → verify(失败还原)。还原优先级:通道级 restore(同一 seam 写回基线行 config,
   * 同步重组合)→ 其后兜底字节级还原(基线全文原子写回,对齐直写通道的 verify-fail
   * 还原纪律);restore 成功后复核文件字节,未回基线同样强制字节还原——保证
   * 「verify 失败 ⇒ 已写状态被回滚」在两条通道上都字节级成立。
   */
  runGoverned(request: GovernedRunRequest): Promise<void> {
    const path = request.path
    const run = (this.#chains.get(path) ?? Promise.resolve()).then(async () => {
      const original = await this.#io.readFile(path)
      if (request.baseline !== undefined && request.baseline !== original) {
        throw new EntryToctouError(path)
      }
      await request.run()
      try {
        await request.verify?.()
      } catch (error) {
        let restored = false
        try {
          await request.restore?.()
          restored = true
        } catch (restoreError) {
          console.error(`prompt-studio: 写后验证失败且通道还原失败(退字节级还原):${restoreError instanceof Error ? restoreError.message : String(restoreError)}`)
        }
        if (request.baseline !== undefined) {
          const afterRestore = await this.#io.readFile(path)
          if (!restored || afterRestore !== request.baseline) {
            await this.#io.atomicWrite(path, request.baseline)
          }
        }
        throw error
      }
    })
    this.#chains.set(path, run.catch(() => undefined))
    return run
  }
}
