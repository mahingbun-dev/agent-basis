/**
 * dsh-evals 通过率差值工具(G2-A9;53 号 §4-P1;28 号 §5 验收口径)。
 *
 * 输入两份 dsh-evals 报告(一份压缩前基线、一份压缩态),输出两侧通过率与差值;
 * 差值(百分点,pp)> 阈值时退出码非零——路由金集 20 条的口径:通过率差 ≤2 个
 * 百分点视为无衰减,跑动节奏 nightly(tests/route-golden/README.md)。
 *
 * 报告格式(tools/evals/src/runner.ts 产物,实测):
 * - JSON 优先:`sessions.jsonl`(一行一 case 的 JSON,字段 case_id/status,
 *   见 tools/evals/src/sessions.ts);
 * - 兜底:`report.md` 的「## 用例明细」表格(tools/evals/src/report.ts 渲染)。
 * 输入可以是 run 产物目录(自动先找 sessions.jsonl、再 report.md)或直接给报告
 * 文件(.jsonl 按 JSONL 解析,其余按 markdown 解析)。
 *
 * 用法:
 *   node scripts/diff-pass-rate.mjs <baseline> <compacted> [--threshold <pp>] [--json]
 * 退出码:0 = 差值 ≤ 阈值(无衰减);1 = 差值 > 阈值(衰减超标);2 = 用法/解析错误。
 * 两侧 case 集合不一致时(如压缩态 run 丢 case)在明细里列出,通过率仍按各自
 * total 归一计算——不猜平,判断交给人(README 差值一行记入里程碑评审登记)。
 */
import { existsSync, readFileSync, statSync } from 'node:fs'
import { resolve } from 'node:path'

const DEFAULT_THRESHOLD = 2

/** 解析 sessions.jsonl(JSON 优先格式):一行一 case,取 case_id/status。 */
export function parseJsonlReport(text, label) {
  const cases = new Map()
  const lines = text.split('\n')
  for (const [index, line] of lines.entries()) {
    const trimmed = line.trim()
    if (trimmed.length === 0) continue
    let parsed
    try {
      parsed = JSON.parse(trimmed)
    } catch (cause) {
      throw new Error(`${label}:${index + 1}: 不是合法 JSON(${cause instanceof Error ? cause.message : String(cause)})`)
    }
    if (typeof parsed !== 'object' || parsed === null
      || typeof parsed.case_id !== 'string' || parsed.case_id.length === 0
      || (parsed.status !== 'pass' && parsed.status !== 'fail')) {
      throw new Error(`${label}:${index + 1}: 缺 case_id 或 status 非 pass|fail(应为 dsh-evals sessions.jsonl)`)
    }
    cases.set(parsed.case_id, parsed.status)
  }
  if (cases.size === 0) throw new Error(`${label}: 无任何 case 记录(应为 dsh-evals sessions.jsonl)`)
  return cases
}

/** 解析 report.md 兜底格式:「## 用例明细」表格的数据行(| id | adapter | status | …)。 */
export function parseMarkdownReport(text, label) {
  const cases = new Map()
  const lines = text.split('\n')
  let inTable = false
  for (const line of lines) {
    if (line.startsWith('## 用例明细')) {
      inTable = true
      continue
    }
    if (!inTable) continue
    if (line.startsWith('## ')) break
    if (!line.startsWith('|')) continue
    const cells = line.split('|')
    // | id | adapter | status | tags | 失败分类 | → split 后 [ '', id, adapter, status, … ]
    const id = cells[1]?.trim()
    const status = cells[3]?.trim()
    if (id === undefined || id === 'id') continue
    if (id === '' || id === '-' || /^-+$/.test(id)) continue // 分隔行 |---|
    if (status !== 'pass' && status !== 'fail') {
      throw new Error(`${label}: 用例明细行 status 非法(${JSON.stringify(status)}),应为 dsh-evals report.md`)
    }
    cases.set(id, status)
  }
  if (cases.size === 0) throw new Error(`${label}: 未解析到任何用例明细(应为 dsh-evals report.md)`)
  return cases
}

/** 输入(目录或报告文件)→ case_id → status 映射。JSON(sessions.jsonl)优先。 */
export function reportOf(target, repoRoot = '') {
  const path = resolve(repoRoot, target)
  if (!existsSync(path)) throw new Error(`报告不存在: ${path}`)
  if (statSync(path).isDirectory()) {
    const jsonl = resolve(path, 'sessions.jsonl')
    const md = resolve(path, 'report.md')
    if (existsSync(jsonl)) return parseJsonlReport(readFileSync(jsonl, 'utf8'), jsonl)
    if (existsSync(md)) return parseMarkdownReport(readFileSync(md, 'utf8'), md)
    throw new Error(`目录下无 sessions.jsonl / report.md: ${path}`)
  }
  if (path.endsWith('.jsonl')) return parseJsonlReport(readFileSync(path, 'utf8'), path)
  return parseMarkdownReport(readFileSync(path, 'utf8'), path)
}

/** 通过率(百分点):{ total, pass, rate }(rate = pass/total*100,全精度)。 */
export function passRateOf(cases) {
  const total = cases.size
  let pass = 0
  for (const status of cases.values()) {
    if (status === 'pass') pass += 1
  }
  return { total, pass, rate: (pass / total) * 100 }
}

/**
 * 对比两侧:{ baseline, compacted, delta, missing }(delta 为百分点差,取绝对值;
 * missing 列出仅一侧存在的 case id——运行不对等的警示面)。
 */
export function diffPassRate(baseline, compacted) {
  const missingInBaseline = [...compacted.keys()].filter(id => !baseline.has(id)).sort()
  const missingInCompacted = [...baseline.keys()].filter(id => !compacted.has(id)).sort()
  const rateA = passRateOf(baseline)
  const rateB = passRateOf(compacted)
  return {
    baseline: rateA,
    compacted: rateB,
    delta: Math.abs(rateA.rate - rateB.rate),
    missing: { baseline: missingInBaseline, compacted: missingInCompacted },
  }
}

/** 对齐 CLI 语义(供单测复用):返回退出码;summaryText/json 为输出产物。 */
export function runDiff(baselineInput, compactedInput, { threshold = DEFAULT_THRESHOLD, repoRoot = '' } = {}) {
  if (!Number.isFinite(threshold) || threshold < 0) {
    throw new Error(`--threshold 应为 ≥0 的数(pp),实际: ${threshold}`)
  }
  const result = diffPassRate(
    reportOf(baselineInput, repoRoot),
    reportOf(compactedInput, repoRoot),
  )
  const verdict = result.delta <= threshold
  const f1 = result.baseline.rate.toFixed(1)
  const f2 = result.compacted.rate.toFixed(1)
  const summaryText = [
    `baseline : ${result.baseline.pass}/${result.baseline.total} pass (${f1}%)  ${baselineInput}`,
    `compacted: ${result.compacted.pass}/${result.compacted.total} pass (${f2}%)  ${compactedInput}`,
    `delta    : ${result.delta.toFixed(1)} pp (阈值 ${threshold} pp)`,
    `判定     : ${verdict ? '无衰减(≤阈值)' : '衰减超标(>阈值)——处置见 route-golden/README.md(调摘要档位或保留策略,不允许靠改 prompt 硬扛)'}`,
  ]
  if (result.missing.baseline.length > 0) {
    summaryText.push(`仅 compacted 有: ${result.missing.baseline.join(', ')}`)
  }
  if (result.missing.compacted.length > 0) {
    summaryText.push(`仅 baseline 有: ${result.missing.compacted.join(', ')}`)
  }
  const json = {
    baseline: { input: baselineInput, ...result.baseline, rate: Number(f1) },
    compacted: { input: compactedInput, ...result.compacted, rate: Number(f2) },
    delta: Number(result.delta.toFixed(1)),
    threshold,
    verdict: verdict ? 'no-decay' : 'decay',
    missing: result.missing,
  }
  return { code: verdict ? 0 : 1, summaryText, json }
}

// ---- CLI ----

export function main(argv) {
  const positional = []
  let threshold = DEFAULT_THRESHOLD
  let json = false
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index]
    if (token === '--threshold') {
      const value = argv[index + 1]
      threshold = value === undefined ? Number.NaN : Number(value)
      if (value !== undefined) index += 1
    } else if (token?.startsWith('--threshold=')) {
      threshold = Number(token.slice('--threshold='.length))
    } else if (token === '--json') {
      json = true
    } else if (token === '--help' || token === '-h') {
      usage()
      return 2
    } else if (token?.startsWith('--')) {
      process.stderr.write(`未知参数: ${token}\n`)
      usage()
      return 2
    } else {
      positional.push(token)
    }
  }
  if (positional.length !== 2) {
    process.stderr.write('需要恰好两个位置参数:<baseline 报告/目录> <compacted 报告/目录>\n')
    usage()
    return 2
  }
  if (!Number.isFinite(threshold) || threshold < 0) {
    process.stderr.write(`--threshold 应为 ≥0 的数(pp),实际: ${argv.find((token, index) => token === '--threshold' ? argv[index + 1] : token.startsWith('--threshold=') ? token.slice(12) : undefined) ?? '(未提供)'}\n`)
    usage()
    return 2
  }
  let outcome
  try {
    outcome = runDiff(positional[0], positional[1], { threshold })
  } catch (cause) {
    process.stderr.write(`解析失败: ${cause instanceof Error ? cause.message : String(cause)}\n`)
    return 2
  }
  for (const line of json ? [JSON.stringify(outcome.json, null, 2)] : outcome.summaryText) {
    process.stdout.write(`${line}\n`)
  }
  return outcome.code
}

function usage() {
  process.stderr.write([
    '用法: node scripts/diff-pass-rate.mjs <baseline> <compacted> [--threshold <pp>] [--json]',
    '',
    '输入:dsh-evals run 产物目录(优先读 sessions.jsonl,兜底 report.md)或报告文件。',
    '口径:通过率差 ≤ 阈值(默认 2 pp)视为无衰减,退出码 0;超标退出码 1。',
    '',
  ].join('\n'))
}

const isMain = process.argv[1] !== undefined
  && import.meta.url === (await import('node:url')).pathToFileURL(resolve(process.argv[1])).href
if (isMain) {
  process.exit(main(process.argv.slice(2)))
}
