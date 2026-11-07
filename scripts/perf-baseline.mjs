#!/usr/bin/env node
/**
 * T5 性能基线汇总:从最新 dsh-evals-out/ 产物生成 docs/perf-baseline-data.json。
 *
 * 数据源与口径(见 docs/perf-baseline.md):
 *   - dsh-evals-out/<产物>/events/<case>.jsonl  —— 每 case 的 session 事件流(runner.ts:117-127);
 *   - packages/observe/src/metrics.ts aggregateSessionMetrics —— token 四桶/成本估算/
 *     KV-cache 命中率/轮数聚合(与观测插件在线口径同一实现,离线/在线可对账);
 *   - packages/observe/src/drift.ts DEFAULT_DRIFT_THRESHOLDS —— 复测对比阈值。
 *
 * 行为:
 *   1. 选取 dsh-evals-out/ 下含 sessions.jsonl 的最新产物(按 report.md started_at);
 *   2. 无产物 → 现场跑 event-planning replay 生成(replay 只回放 fixture,
 *      不发起模型调用,**无模型凭据依赖**;需 node >=22 原生 type-stripping);
 *   3. 逐 case 喂 observe 聚合器,汇总为基线 JSON 写 docs/perf-baseline-data.json;
 *   4. stdout 打印摘要;exit 0=成功,1=失败(产物不可读/生成失败)。
 *
 * 口径诚实性:replay fixture 时间戳为合成且 stream=[] → TTFT 记 null(replay 产物
 * 不测 TTFT);无路由锚点 → 成本按 0 计、billed 全额计入 unpricedBilledTokens
 * (不猜价);无缓存桶 → cacheHitRate=null(不伪报 0)。
 *
 * 用法:node scripts/perf-baseline.mjs [--fresh] [--pack <目录>] [--out <文件>] [--artifact <目录>]
 *   --fresh   不复用已有产物,现场重跑 replay 再汇总
 *   --pack    生成产物用的 pack 目录(缺省 packs/event-planning)
 *   --out     基线数据输出路径(缺省 docs/perf-baseline-data.json)
 *   --artifact 指定产物目录名(缺省取 dsh-evals-out 下最新)
 */
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const OUT_ROOT = resolve(repoRoot, 'dsh-evals-out')
const DEFAULT_PACK = resolve(repoRoot, 'packs/event-planning')
const DEFAULT_OUT = resolve(repoRoot, 'docs/perf-baseline-data.json')
const EVALS_BIN = resolve(repoRoot, 'tools/evals/bin/dsh-evals.mjs')

/* ---------- 观测插件口径(单一权威;node>=22 原生 type-stripping 直接跑 TS 源) ---------- */
const observeUrl = pathToFileURL(resolve(repoRoot, 'packages/observe/src/metrics.ts')).href
const driftUrl = pathToFileURL(resolve(repoRoot, 'packages/observe/src/drift.ts')).href
const { aggregateSessionMetrics } = await import(observeUrl)
const { DEFAULT_DRIFT_THRESHOLDS } = await import(driftUrl)

/* ---------- 参数 ---------- */
function parseArgs(argv) {
  const flags = { fresh: false }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--fresh') flags.fresh = true
    else if (a === '--pack') flags.pack = resolve(argv[++i])
    else if (a === '--out') flags.out = resolve(argv[++i])
    else if (a === '--artifact') flags.artifact = argv[++i]
    else {
      process.stderr.write(`未知参数: ${a}\n${USAGE}\n`)
      process.exit(2)
    }
  }
  return flags
}
const USAGE = '用法: node scripts/perf-baseline.mjs [--fresh] [--pack <目录>] [--out <文件>] [--artifact <目录名>]'
const flags = parseArgs(process.argv.slice(2))

/* ---------- 产物定位 ---------- */
function artifactDirs() {
  if (!existsSync(OUT_ROOT)) return []
  return readdirSync(OUT_ROOT, { withFileTypes: true })
    .filter((e) => e.isDirectory() && existsSync(resolve(OUT_ROOT, e.name, 'sessions.jsonl')))
    .map((e) => e.name)
}

/** 产物时间:report.md 的 started_at > 目录名时间戳 > 目录 mtime(三级回退,取不到则抛)。 */
function artifactTime(dir) {
  const report = resolve(OUT_ROOT, dir, 'report.md')
  try {
    const m = readFileSync(report, 'utf8').match(/^- started_at: (.+)$/m)
    if (m) return Date.parse(m[1])
  } catch { /* report 缺失,走目录名 */ }
  // 目录名形如 replay-2026-11-06T18-08-59-298Z(cli.ts:92-94 toISOString 把 : . 换成 -)
  const nameM = dir.match(/-((?:\d{4}-\d{2}-\d{2})T(?:\d{2}-\d{2}-\d{2})(?:-\d{3})?)Z?$/)
  if (nameM) {
    const [date, time] = nameM[1].split('T')
    const isoTime = time.replace(/-(\d{3})$/, '.$1').replace(/-/g, ':') // 18-08-59-298 → 18:08:59.298
    const parsed = Date.parse(`${date}T${isoTime}Z`)
    if (Number.isFinite(parsed)) return parsed
  }
  return 0 // 无法判定时排最后,不为它编造时间
}

/** 现场跑 event-planning replay(replay 适配器只回放 fixture,零凭据、零外网)。 */
function generateArtifact(packDir) {
  if (!existsSync(EVALS_BIN)) throw new Error(`evals CLI 缺失: ${EVALS_BIN}`)
  if (!existsSync(resolve(packDir, 'evals'))) throw new Error(`pack 目录缺少 evals/: ${packDir}`)
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const outDir = resolve(OUT_ROOT, `replay-${stamp}`)
  mkdirSync(OUT_ROOT, { recursive: true })
  process.stderr.write(`[generate] 无可用产物,现场跑 replay: pack=${packDir}\n`)
  const r = spawnSync(process.execPath, [EVALS_BIN, 'run', '--pack', packDir, '--adapter', 'replay', '--out', outDir], {
    cwd: repoRoot,
    encoding: 'utf8',
    timeout: 10 * 60 * 1000,
  })
  if (r.status !== 0) {
    throw new Error(`replay 生成失败(exit=${r.status}):\n${(r.stdout ?? '')}${(r.stderr ?? '')}`)
  }
  return outDir
}

/* ---------- 事件流解析与聚合 ---------- */
function readEventsFile(path) {
  const events = []
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    if (line.trim() === '') continue
    events.push(JSON.parse(line))
  }
  return events
}

/**
 * 首 token 延迟(真会话口径):逐 step 取 assistant/message.stream 首条记录时间
 * (time0/time,chunk 到达时 Date.now() 落戳)减去对应 step/start 事件时间。
 * replay(fixture 合成时间戳、stream=[])→ null,不测不编。
 */
function ttftOfEvents(events) {
  const stepStart = new Map() // `${turn}:${step}` -> time
  const samples = []
  for (const ev of events) {
    const d = ev?.data
    if (!d || typeof d !== 'object') continue
    if (ev.type === 'step/start' && typeof d.turn === 'number' && typeof d.step === 'number') {
      stepStart.set(`${d.turn}:${d.step}`, ev.time)
    } else if (ev.type === 'assistant/message' && Array.isArray(d.stream) && d.stream.length > 0) {
      const t0 = Math.min(...d.stream.map((r) => (typeof r?.time === 'number' ? r.time : (typeof r?.time0 === 'number' ? r.time0 : Infinity))))
      const base = stepStart.get(`${d.turn}:${d.step}`)
      if (Number.isFinite(t0) && typeof base === 'number') samples.push(t0 - base)
    }
  }
  if (samples.length === 0) return null
  const sorted = [...samples].sort((a, b) => a - b)
  const median = sorted.length % 2 === 1
    ? sorted[(sorted.length - 1) / 2]
    : (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2
  return { median_ms: median, max_ms: sorted[sorted.length - 1], samples: sorted }
}

/* ---------- 主流程 ---------- */
async function main() {
  const packDir = flags.pack ?? DEFAULT_PACK
  const outPath = flags.out ?? DEFAULT_OUT

  // 1) 选产物(--fresh 强制重跑;--artifact 指定;否则最新)
  let artifactDir
  if (flags.artifact !== undefined) {
    if (!artifactDirs().includes(flags.artifact)) throw new Error(`指定产物不存在或缺 sessions.jsonl: ${flags.artifact}`)
    artifactDir = flags.artifact
  } else if (flags.fresh) {
    process.stderr.write('[generate] --fresh:现场重跑 event-planning replay(replay 只回放 fixture,无凭据依赖)\n')
    artifactDir = basename(generateArtifact(packDir))
  } else {
    const dirs = artifactDirs().sort((a, b) => artifactTime(b) - artifactTime(a))
    if (dirs.length === 0) {
      process.stderr.write('[generate] dsh-evals-out/ 下无可用产物,现场跑 event-planning replay\n')
      artifactDir = basename(generateArtifact(packDir))
    } else {
      artifactDir = dirs[0]
    }
  }
  const artifactPath = resolve(OUT_ROOT, artifactDir)
  process.stderr.write(`[artifact] ${artifactPath}\n`)

  // 2) sessions.jsonl 一行一 case
  const sessionRows = readFileSync(resolve(artifactPath, 'sessions.jsonl'), 'utf8')
    .split('\n').filter((l) => l.trim() !== '').map((l) => JSON.parse(l))
  if (sessionRows.length === 0) throw new Error('sessions.jsonl 为空')

  // 3) pack 名(report.md)与 git head(可比性记录)
  const report = readFileSync(resolve(artifactPath, 'report.md'), 'utf8')
  const packLine = report.match(/^- pack: (.+)$/m)?.[1] ?? packDir
  const startedAt = report.match(/^- started_at: (.+)$/m)?.[1] ?? null
  const git = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: repoRoot, encoding: 'utf8' })
  const gitHead = (git.stdout ?? '').trim() || null

  // 4) 逐 case 喂 observe 聚合器
  const perCase = []
  for (const row of sessionRows) {
    const evFile = resolve(artifactPath, 'events', `${row.case_id}.jsonl`)
    if (!existsSync(evFile)) throw new Error(`事件流缺失: ${evFile}`)
    const events = readEventsFile(evFile)
    const metrics = aggregateSessionMetrics(events)
    const isReplay = row.adapter === 'replay'
    const ttft = isReplay ? null : ttftOfEvents(events)
    perCase.push({
      id: row.case_id,
      status: row.status,
      adapter: row.adapter,
      tags: row.tags ?? [],
      turns: metrics.turns,
      steps: metrics.steps,
      model_calls: metrics.modelCalls,
      tokens: { ...metrics.tokens },
      cache_hit_rate: metrics.cacheHitRate,
      cost_usd: metrics.costUsd,
      unpriced_billed_tokens: metrics.unpricedBilledTokens,
      turn_end: metrics.turnEnd,
      ttft,
      ttft_measured: ttft !== null,
      runner_total_tokens: row.metrics?.total_tokens ?? null, // dsh-evals 自身口径,交叉校验用
      duration_ms: row.duration_ms ?? null,
    })
  }

  // 5) 合计与逐轮归一(passed case 的指标为基线口径;失败 case 仍逐条入 per_case 供定位)
  const passed = perCase.filter((c) => c.status === 'pass')
  if (passed.length === 0) throw new Error('产物中无 pass case,不生成基线')
  const sum = (sel) => passed.reduce((acc, c) => acc + sel(c), 0)
  const totals = {
    turns: sum((c) => c.turns),
    steps: sum((c) => c.steps),
    model_calls: sum((c) => c.model_calls),
    tokens: passed.reduce((acc, c) => ({
      input: acc.input + c.tokens.input,
      output: acc.output + c.tokens.output,
      cacheRead: acc.cacheRead + c.tokens.cacheRead,
      cacheWrite: acc.cacheWrite + c.tokens.cacheWrite,
      reasoning: acc.reasoning + c.tokens.reasoning,
      billed: acc.billed + c.tokens.billed,
    }), { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, reasoning: 0, billed: 0 }),
    cost_usd: sum((c) => c.cost_usd),
    unpriced_billed_tokens: sum((c) => c.unpriced_billed_tokens),
  }
  const promptTotal = totals.tokens.input + totals.tokens.cacheRead + totals.tokens.cacheWrite
  const cacheReported = passed.some((c) => c.cache_hit_rate !== null)
  totals.cache_hit_rate = cacheReported && promptTotal > 0
    ? totals.tokens.cacheRead / promptTotal
    : null // 无缓存桶 → null(未知),不伪报 0
  const perTurn = totals.turns > 0
    ? {
      cost_per_turn: totals.cost_usd / totals.turns,
      billed_tokens_per_turn: totals.tokens.billed / totals.turns,
      error_turn_rate: sum((c) => (c.turn_end.error ?? 0)) / totals.turns,
    }
    : null

  // 6) 写基线数据文件
  const baseline = {
    generated_at: new Date().toISOString(),
    git_head: gitHead,
    artifact: artifactDir,
    artifact_started_at: startedAt,
    pack: packLine,
    adapter: sessionRows[0].adapter ?? 'unknown',
    cases: {
      total: perCase.length,
      pass: passed.length,
      pass_rate: passed.length / perCase.length,
    },
    totals,
    per_turn: perTurn,
    per_case: perCase,
    pricing: DEFAULT_PRICING_SNAPSHOT(),
    compare_rules: { ...DEFAULT_DRIFT_THRESHOLDS, pass_rate_must_not_regress: true },
    notes: [
      '口径:packages/observe/src/metrics.ts aggregateSessionMetrics(与观测插件在线口径同源)。',
      'replay 产物:事件时间戳为 fixture 合成且 stream=[] → TTFT 不测(null);无路由锚点 → 成本 0、billed 计入 unpriced_billed_tokens;无缓存桶 → cache_hit_rate=null(未知,非 0)。',
      'TTFT 定义:step/start 事件时间 → assistant/message.stream 首记录 time0/time(chunk 到达 Date.now()),仅真会话口径有效。',
      'runner_total_tokens = dsh-evals sessions.jsonl 的 total_tokens(totalTokens ?? input+output+cacheRead+cacheWrite),用于与 observe billed 交叉校验。',
      `对比阈值来源:packages/observe/src/drift.ts DEFAULT_DRIFT_THRESHOLDS;复测规则见 docs/perf-baseline.md §4。`,
    ],
  }
  mkdirSync(dirname(outPath), { recursive: true })
  writeFileSync(outPath, `${JSON.stringify(baseline, null, 2)}\n`, 'utf8')

  // 7) stdout 摘要
  const t = totals.tokens
  const fmtRate = (v) => (v === null ? 'null(未知)' : `${(v * 100).toFixed(1)}%`)
  process.stdout.write([
    `== 性能基线摘要 ==`,
    `artifact: dsh-evals-out/${artifactDir}${startedAt ? ` (started_at ${startedAt})` : ''}`,
    `pack: ${packLine} | adapter: ${baseline.adapter} | cases: ${baseline.cases.pass}/${baseline.cases.total} pass (${(baseline.cases.pass_rate * 100).toFixed(1)}%)`,
    `git_head: ${gitHead ?? 'unknown'}`,
    `tokens(billed 口径): input=${t.input} output=${t.output} cacheRead=${t.cacheRead} cacheWrite=${t.cacheWrite} billed=${t.billed}`,
    `cache_hit_rate: ${fmtRate(totals.cache_hit_rate)}`,
    `cost: $${totals.cost_usd.toFixed(6)}(估算) | unpriced_billed_tokens=${totals.unpriced_billed_tokens}`,
    `turns=${totals.turns} steps=${totals.steps} model_calls=${totals.model_calls}`,
    perTurn === null ? '' : `per_turn: cost=$${perTurn.cost_per_turn.toFixed(6)} billedTokens=${perTurn.billed_tokens_per_turn.toFixed(1)} errorRate=${(perTurn.error_turn_rate * 100).toFixed(1)}%`,
    `ttft: ${baseline.adapter === 'replay' ? '不测(replay 合成时间戳,stream=[])' : '逐 case 见数据文件'}`,
    `pricing: ${Object.keys(baseline.pricing).join(', ') || '(空)'} | 对比阈值: costPerTurn+25% billedTokensPerTurn+25% cacheHitRate±0.1 errorTurnRate+50% turns±40%`,
    `written: ${outPath}`,
    `== exit 0 ==`,
  ].filter((l) => l !== '').join('\n') + '\n')
}

/* ---------- 单价表快照(与 observe DEFAULT_PRICING 对齐;不猜价,未列路由=unpriced) ---------- */
function DEFAULT_PRICING_SNAPSHOT() {
  return {
    'deepseek/deepseek-chat': { input: 0.27, cacheRead: 0.07, output: 1.1, currency: 'USD/1M', source: 'observe/src/pricing.ts DEFAULT_PRICING(2026-11 官方价)' },
    'deepseek/deepseek-reasoner': { input: 0.55, cacheRead: 0.14, output: 2.19, currency: 'USD/1M', source: 'observe/src/pricing.ts DEFAULT_PRICING(2026-11 官方价)' },
  }
}

function basename(p) {
  return p.split('/').pop()
}

main().then(
  () => process.exit(0),
  (error) => {
    process.stderr.write(`[FATAL] ${String(error?.message ?? error)}\n`)
    process.exit(1)
  },
)
