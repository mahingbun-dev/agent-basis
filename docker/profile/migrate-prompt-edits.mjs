#!/usr/bin/env node
/**
 * 工坊托管值移植(2026-11-18,修复「升级重渲染后提示词回默认」):
 *
 * entrypoint ensure_rendered 的哈希门控在模板变更时重渲染 cordis.patch.yml,但其
 * 窄移植只搬 disabled: 标记/追加块/manifest 块——提示词工坊写进 preset-standard /
 * preset-cordis 行的 persona.prefix / plan-mode.section / agent-instructions.maxBytes
 * 一律被模板默认值覆盖(0.1.13→0.1.14 升级实证丢编辑,即 registry UPGRADE_OVERWRITE_
 * RISK)。本脚本在重渲染后由 entrypoint 调用,把「用户真正改过的」托管值搬到新渲染。
 *
 * 「用户改过」的判定靠基线快照(≠ 模板值即编辑;= 模板值则让新模板基线落地,
 * 保住基线升级传播——如三红线锚点入基线这类模板侧变更不被旧值钉死):
 *   - 基线文件(每渲染后由本脚本从新模板重写,存模板默认值)在场 → 旧文件值 ≠ 基线值
 *     才移植;
 *   - 基线缺席(本机制上线前存量卷首启)→ 一次性回退「旧文件值 ≠ 新模板值」对比,
 *     宁可误搬一次旧基线也要保住用户编辑;
 *   - prev 传 '--'(无旧文件)→ 仅回填基线。
 *
 * 定位/替换/自检直接 import 提示词工坊的 TS 源(entry-patch 的 entrySpanOf /
 * buildNextEntryFileText / selfCheckEntryWrite 与 registry 的 readYamlValueAtLine)——
 * 与工坊写链路同一套变换(块标量 >-/| 整块替换、数值标量保型),托管键清单由注册表
 * 过滤(kind=patch-value 且 yaml.file=WEB_PATCH)导出,零漂移。镜像 node:24 原生
 * strip-only 运行 .ts;依赖链仅 node 内建 + 相对 .ts(import type 的 @eterna/* 被擦除)。
 *
 * 纪律:逐条 fail-closed(单条定位/自检失败只跳过该条保模板默认,记日志,不炸 boot);
 * 致命错误(参数/读文件)exit 1,entrypoint 侧 || 吞掉仅告警。基线永远从「模板」提取
 * (不是渲染产物)——否则移植进来的用户编辑会被误记为基线,下下次升级再丢。
 *
 * 用法:node migrate-prompt-edits.mjs <新模板路径> <旧文件路径|--> <渲染产物路径> <基线 json 路径>
 */
import { readFileSync, writeFileSync, renameSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { PROMPT_REGISTRY_ENTRIES, WEB_PATCH, readYamlValueAtLine } from '../../packages/prompt-studio/src/registry.ts'
import { entrySpanOf, buildNextEntryFileText, selfCheckEntryWrite } from '../../packages/prompt-studio/src/entry-patch.ts'

const TAG = '[entrypoint] 工坊值移植'

/** 托管键清单(注册表单一事实源;恰好 6 条 preset 条目,base/super 模板同构)。 */
const MANAGED = PROMPT_REGISTRY_ENTRIES.filter(
  (entry) => entry.kind === 'patch-value' && entry.yaml !== undefined && entry.yaml.file === WEB_PATCH,
)

const log = (msg) => console.log(`${TAG}: ${msg}`)

/** 逐条提取文件中托管值(canonical 文本,块标量含 chomping;结构漂移/缺失=null)。 */
function extractAll(text) {
  const lines = text.split('\n')
  const values = {}
  for (const entry of MANAGED) {
    try {
      const span = entrySpanOf(entry, lines)
      values[entry.id] = readYamlValueAtLine(lines, span.keyIndex) ?? null
    } catch {
      values[entry.id] = null
    }
  }
  return values
}

/** 原子写(tmp + rename,同 persona-patch io 纪律;boot 期防半写)。 */
function atomicWrite(path, data) {
  const tmp = join(dirname(path), `.${Math.random().toString(36).slice(2, 10)}.tmp`)
  writeFileSync(tmp, data)
  renameSync(tmp, path)
}

// ---------- 参数 ----------
const [tplPath, prevArg, dstPath, baselinePath] = process.argv.slice(2)
if (tplPath === undefined || prevArg === undefined || dstPath === undefined || baselinePath === undefined) {
  console.error(`${TAG}: 用法: migrate-prompt-edits.mjs <新模板> <旧文件|--(仅回填基线)> <渲染产物> <基线json>`)
  process.exit(1)
}

let tplText
try {
  tplText = readFileSync(tplPath, 'utf8')
} catch (err) {
  console.error(`${TAG}: 模板不可读(${tplPath}):${err?.message ?? err}`)
  process.exit(1)
}

let dstText
try {
  dstText = readFileSync(dstPath, 'utf8')
} catch (err) {
  console.error(`${TAG}: 渲染产物不可读(${dstPath}):${err?.message ?? err}`)
  process.exit(1)
}

// ---------- 三方值:模板 / 旧文件 / 基线 ----------
const tplValues = extractAll(tplText)

let prevValues = null
if (prevArg !== '--') {
  try {
    prevValues = extractAll(readFileSync(prevArg, 'utf8'))
  } catch {
    log(`旧文件不可读(${prevArg}),按仅回填基线处理`)
  }
}

let baselineValues = null
try {
  const parsed = JSON.parse(readFileSync(baselinePath, 'utf8'))
  if (parsed !== null && typeof parsed === 'object' && parsed.schemaVersion === 1
    && parsed.values !== null && typeof parsed.values === 'object') {
    baselineValues = parsed.values
  }
} catch { /* 缺席/坏 json=回退对比(注释头部的一次性 caveat) */ }

// ---------- 逐条判定 + 移植 ----------
const applied = []
const skipped = []
if (prevValues !== null) {
  for (const entry of MANAGED) {
    const id = entry.id
    const tplValue = tplValues[id] ?? null
    const oldValue = prevValues[id] ?? null
    if (tplValue === null || oldValue === null || oldValue === tplValue) continue
    const baseValue = baselineValues?.[id]
    const edited = baseValue !== undefined && baseValue !== null ? oldValue !== baseValue : true
    if (!edited) continue // =旧基线(用户未改):让新模板基线落地
    try {
      const next = buildNextEntryFileText(entry, dstText, oldValue)
      selfCheckEntryWrite(entry, dstText, next, oldValue)
      if (next !== dstText) applied.push(id)
      dstText = next
    } catch (err) {
      skipped.push(`${id}(${err?.message ?? err})`)
    }
  }
}

if (applied.length > 0) atomicWrite(dstPath, dstText)

// ---------- 基线重写:永远取自新模板 ----------
atomicWrite(baselinePath, `${JSON.stringify({ schemaVersion: 1, savedAt: new Date().toISOString(), values: tplValues }, null, 2)}\n`)

const missing = MANAGED.filter((entry) => tplValues[entry.id] === null).map((entry) => entry.id)
log(
  `模板 ${MANAGED.length} 条托管键${missing.length > 0 ? `(模板缺键:${missing.join(',')})` : ''}`
  + ` | 移植 ${applied.length} 处${applied.length > 0 ? `:${applied.join(',')}` : ''}`
  + `${skipped.length > 0 ? ` | fail-closed 跳过 ${skipped.length} 条:${skipped.join(';')}` : ''}`
  + ` | 基线已按新模板重写 → ${baselinePath}`,
)
