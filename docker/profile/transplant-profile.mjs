#!/usr/bin/env node
/**
 * profile patch 移植(2026-11-19,自 entrypoint 内联脚本抽出并补「用户新增 LLM provider」保留)。
 *
 * 背景:ensure_rendered 的哈希门控在模板变更(镜像升级)时重渲染 cordis.patch.yml。
 * 渲染产物同时承载两层语义:
 *   - 模板默认(产品随镜像发布的行与 config);
 *   - 用户层(设置页写回的行 config——dsh-config-editor 把整份 entry config 写进本文件)。
 * 重渲染必须把用户层里「只属于用户」的部分搬过去,否则升级即静默丢用户配置。
 * 2026-11-19 生产实证:用户在设置页新增的 baidu-token-plan 路由,在模板变更重渲染后
 * 消失;存量会话 modelSelection.lastUsed 仍指向它,dsh-llm 逐轮以 NO_ADAPTER
 * 「未为提供者注册适配器」失败(会话从此无法运行,页面只显示一句英文码)。
 *
 * 移植面(窄而可证,全部文本级、幂等):
 *   1. 顶层行的显式 disabled: 标记——插件启停跨升级持久(历史行为,逐字保留);
 *   2. 仅存在于旧文件的顶层行(简单标量形状的运维追加覆写行;含 !! 表达式/嵌套形状不搬,
 *      历史行为,逐字保留);
 *   3. llm-pi-ai 行 config.providers 下「模板没有、旧文件有」的路由(用户新增 provider)——
 *      整块(含 models/兼容项)搬进新模板 providers 末尾。模板已有的路由一律用模板值
 *      (产品目录升级照常落地;用户对模板路由的局部修改仍重置——既有口径:模型行 config
 *      升级重置,只是不再连用户自建路由一起丢)。局限:本脚本无「上一版模板」快照,
 *      若模板主动删除某路由、而旧渲染仍含该键,无法区分「用户新增」与「模板删除」,
 *      该键会被保留——模板删路由后首次重渲染需管理员在设置页手动删除。
 *   4. manifest 模式:dsh.profile 块整体保留旧文件值(bundles 选择跨升级持久,历史行为)。
 *
 * 纪律:Fail-closed——任何结构定位失败只跳过该项并记日志,不炸 boot(保模板默认);
 * 模板/旧文件不可读 exit 1,entrypoint 侧 `|| cp` 回落直拷模板(与历史行为一致)。
 *
 * 用法:node transplant-profile.mjs <模板路径> <旧渲染产物路径> <patch|manifest>
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const TAG = '[entrypoint] 移植'
/** Root-level LLM carrying row whose user-added providers must survive re-renders. */
const LLM_ROW_ID = 'llm-pi-ai'

const log = (msg) => console.log(`${TAG}: ${msg}`)

/** Split text lines into top-level patch blocks (col-0 `- ` starts a block). */
function splitBlocks(lines) {
  const out = []
  let start = -1
  for (let i = 0; i <= lines.length; i++) {
    const line = i < lines.length ? lines[i] : '- '
    if (/^- /.test(line) && start >= 0) {
      out.push({ lines: lines.slice(start, i), start, end: i })
      start = -1
    }
    if (i < lines.length && /^- /.test(line)) start = i
  }
  return out
}

/** Root block id (`- id: x` at col 0), or null for non-entry blocks. */
const blockId = (blockLines) => {
  const m = /^- id: (\S+)\s*$/.exec(blockLines[0])
  return m === null ? null : m[1]
}

/** Explicit `  disabled: true|false` inside one block; null when unset. */
function explicitDisabled(blockLines) {
  for (const line of blockLines.slice(1)) {
    const m = /^ {2}disabled: (true|false)\s*$/.exec(line)
    if (m !== null) return m[1]
  }
  return null
}

const isBlank = (line) => line.trim() === ''
const indentOf = (line) => /^( *)/.exec(line)[1].length

/** Span of a root block by id, in the given line array. */
function rowSpanOf(lines, id) {
  for (const block of splitBlocks(lines)) {
    if (blockId(block.lines) === id) return { start: block.start, end: block.end }
  }
  return null
}

/** Span of the `providers:` key inside one root block (first match), plus its key indent. */
function providersSpanOf(lines, row) {
  for (let i = row.start; i < row.end; i++) {
    const m = /^( *)providers:[ \t]*$/.exec(lines[i])
    if (m !== null && m[1].length >= 2) return { start: i, keyIndent: m[1].length + 2, end: row.end }
  }
  return null
}

/**
 * Map of provider entries: key -> line span. An entry owns blank lines and all lines
 * indented deeper than the key, and ends before the next line at the key indent or shallower.
 */
function providerEntriesOf(lines, providers) {
  const entries = new Map()
  let i = providers.start + 1
  while (i < providers.end) {
    const m = /^( *)([A-Za-z0-9][\w.-]*):[ \t]*$/.exec(lines[i])
    if (m === null || m[1].length !== providers.keyIndent) {
      i++
      continue
    }
    const key = m[2]
    let j = i + 1
    while (j < providers.end) {
      const line = lines[j]
      if (!isBlank(line) && indentOf(line) <= providers.keyIndent) break
      j++
    }
    let last = j
    while (last > i + 1 && isBlank(lines[last - 1])) last--
    entries.set(key, { start: i, end: last })
    i = j
  }
  return entries
}

/** Shift a copied provider block from one key indent to another (blank lines untouched). */
function reindent(lines, delta) {
  if (delta === 0) return lines
  return lines.map((line) => {
    if (isBlank(line)) return line
    const indent = indentOf(line)
    return `${' '.repeat(Math.max(0, indent + delta))}${line.slice(indent)}`
  })
}

/**
 * Append every provider the template lacks from the old render into the template's
 * llm-pi-ai providers map. Template-owned routes are never overwritten.
 */
function preserveUserProviders(templateLines, oldLines) {
  const templateRow = rowSpanOf(templateLines, LLM_ROW_ID)
  const oldRow = rowSpanOf(oldLines, LLM_ROW_ID)
  if (templateRow === null || oldRow === null) {
    if (oldRow !== null) log(`WARNING 新模板无 ${LLM_ROW_ID} 行,用户新增 provider 无法移植`)
    return []
  }
  const templateProviders = providersSpanOf(templateLines, templateRow)
  const oldProviders = providersSpanOf(oldLines, oldRow)
  if (templateProviders === null || oldProviders === null) {
    if (oldProviders !== null) log(`WARNING 新模板 ${LLM_ROW_ID} 行无 providers 键,用户新增 provider 无法移植`)
    return []
  }
  const templateEntries = providerEntriesOf(templateLines, templateProviders)
  const oldEntries = providerEntriesOf(oldLines, oldProviders)
  const missing = [...oldEntries.keys()].filter((key) => !templateEntries.has(key))
  if (missing.length === 0) return []

  const lastTemplate = [...templateEntries.values()].at(-1)
  const insertAt = lastTemplate === undefined ? templateProviders.start + 1 : lastTemplate.end
  const block = []
  for (const key of missing) {
    const entry = oldEntries.get(key)
    const copied = reindent(oldLines.slice(entry.start, entry.end), templateProviders.keyIndent - oldProviders.keyIndent)
    block.push('', ...copied)
  }
  templateLines.splice(insertAt, 0, ...block)
  return missing
}

/** Marker transplant (disabled flags, user-only top-level rows, manifests) on template lines. */
function transplantMarkers(templateLines, oldLines) {
  const template = splitBlocks(templateLines)
  const old = splitBlocks(oldLines)
  const templateById = new Map()
  for (const block of template) {
    const id = blockId(block.lines)
    if (id !== null && !templateById.has(id)) templateById.set(id, block)
  }
  const edits = []
  for (const block of old) {
    const id = blockId(block.lines)
    const oldDisabled = explicitDisabled(block.lines)
    if (id === null || oldDisabled === null) continue
    const templateBlock = templateById.get(id)
    if (templateBlock !== undefined) {
      if (explicitDisabled(templateBlock.lines) === oldDisabled) continue
      let replaced = false
      for (let k = 1; k < templateBlock.lines.length; k++) {
        if (/^ {2}disabled: /.test(templateBlock.lines[k])) {
          edits.push({ at: templateBlock.start + k, kind: 'replace', text: `  disabled: ${oldDisabled}` })
          replaced = true
          break
        }
      }
      if (!replaced) edits.push({ at: templateBlock.start + 1, kind: 'insertBefore', text: `  disabled: ${oldDisabled}` })
    } else {
      const appended = [...block.lines]
      while (appended.length > 0 && appended[appended.length - 1].trim() === '') appended.pop()
      // 只搬简单标量形状的运维追加行:含 !! 表达式/嵌套 map/序列的行(模型 config 等)不搬,
      // 避免把半截结构搬进新模板(模型面由 preserveUserProviders 窄移植)。
      if (appended.every((line, k) => k === 0 || line.trim() === '' || /^#/.test(line) || /^ {2}[A-Za-z][\w-]*: (?!!!)\S/.test(line))) {
        edits.push({ at: -1, kind: 'append', text: appended.join('\n') })
      }
    }
  }
  for (const edit of edits.sort((a, b) => b.at - a.at)) {
    if (edit.kind === 'replace') templateLines[edit.at] = edit.text
    else if (edit.kind === 'insertBefore') templateLines.splice(edit.at, 0, edit.text)
    else {
      templateLines.push('')
      for (const line of edit.text.split('\n')) templateLines.push(line)
    }
  }
  return edits.length
}

/** Pure patch-mode transplant; returns the rendered text plus what was preserved. */
export function transplantPatch(tplText, oldText) {
  const templateLines = tplText.split('\n')
  while (templateLines.length > 0 && templateLines[templateLines.length - 1] === '') templateLines.pop()
  const oldLines = oldText.split('\n')
  const edits = transplantMarkers(templateLines, oldLines)
  const preserved = preserveUserProviders(templateLines, oldLines)
  templateLines.push('')
  return { text: templateLines.join('\n'), edits, preserved }
}

/** Manifest-mode transplant: keep the old `dsh` block (bundle choices survive upgrades). */
export function transplantManifest(tplText, oldText) {
  const tpl = JSON.parse(tplText)
  let old = null
  try {
    old = JSON.parse(oldText)
  } catch { /* 旧文件坏:弃移植 */ }
  if (old !== null && old.dsh !== null && typeof old.dsh === 'object') tpl.dsh = old.dsh
  return `${JSON.stringify(tpl, null, 2)}\n`
}

function main() {
  const [tplPath, dstPath, mode] = process.argv.slice(2)
  if (tplPath === undefined || dstPath === undefined || mode === undefined) {
    console.error(`${TAG}: 用法: transplant-profile.mjs <模板路径> <旧渲染产物路径> <patch|manifest>`)
    process.exit(1)
  }
  let tplText
  try {
    tplText = readFileSync(tplPath, 'utf8')
  } catch (err) {
    console.error(`${TAG}: 模板不可读(${tplPath}):${err?.message ?? err}`)
    process.exit(1)
  }
  const oldText = readFileSync(dstPath, 'utf8') // 调用点已确认存在;不可读即 exit 1 走直拷回落
  if (mode === 'manifest') {
    writeFileSync(dstPath, transplantManifest(tplText, oldText))
    return
  }
  if (mode !== 'patch') {
    console.error(`${TAG}: 未知模式 ${mode}(仅 patch|manifest)`)
    process.exit(1)
  }
  const { text, edits, preserved } = transplantPatch(tplText, oldText)
  writeFileSync(dstPath, text)
  log(`标记 ${edits} 处${preserved.length > 0 ? ` | 保留用户新增 LLM provider: ${preserved.join(',')}` : ''}`)
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main()