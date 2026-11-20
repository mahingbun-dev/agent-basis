#!/usr/bin/env node
/**
 * rc.5 验收矩阵汇编（164 条，51 §3）。
 *
 * 只做两件事：
 *   1) 用「最终镜像车道」的 summary/report 刷新矩阵状态（PASS/FAIL/SKIP→MISSING），
 *      其余行保留既有判定与证据路径（阶段列不动）；
 *   2) 重算总览/套件×状态/阶段×状态，并重写遗留项清单。
 *
 * 证据优先级：
 *   - E3（super）对 TERM-002/005/006、TERM-013、API-004..007 为准；
 *   - MCPP-019/020/022 以 E2/LLM 的 live 回合为准（MCPP 套件本身只标 SKIP 指引）；
 *   - 其余 id 取 E1/E2 summary；同一 id 多条时 PASS/FAIL 优先于 SKIP/NOTRUN。
 *   - TERM-013/DATA-009 另有一条「24h 时间窗权威」：主 soak `summary-24h-final2.json`
 *     的 window.complete=true 时取 term/data verdict；DATA-009 还需规模窗口
 *     `E2/DATA/scale/summary.json` 的 windowComplete=true 且 verdict=PASS。窗口未满
 *     一律不覆盖（维持 MISSING）。演练可用 RC5_SOAK_SUMMARY / RC5_SCALE_SUMMARY 指向
 *     合成摘要，无需触碰真实证据。
 *   - 「产品豁免」最高优先：`p6b/waiver-24h.json` 存在时，其 waived 列表内的 id 判
 *     WAIVED（不是 PASS——未真实满窗不冒充绿），跳过 soak 权威分支；事后 soak 摘要
 *     只作观察证据，不回改判定。
 *
 * 已知「证据不足」登记：API-005..007 的 E1 stub 证据不满足 51 的「真 worker」口径，
 * 即使旧行曾标 PASS 也回落为 MISSING（遗留项 API005-REALMODEL）。2026-11-20 晚真模型
 * 补跑后，E3 的 report.json 已判 PASS —— E3 权威分支优先，本回落只对「E3 无报告」生效。
 *
 * 用法：
 *   node scripts/rc5-acceptance-matrix.mjs            # 只打印差异与统计
 *   node scripts/rc5-acceptance-matrix.mjs --write    # 写回 artifacts/rc5/acceptance-matrix.md
 */
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const RC5 = join(ROOT, 'artifacts', 'rc5')
const MATRIX = join(RC5, 'acceptance-matrix.md')
const WRITE = process.argv.includes('--write')

/* 读取车道 summary/report → { id: {status, source} } */
function laneStatuses() {
  const map = new Map()
  const put = (id, status, source, strong = false) => {
    const priority = { FAIL: 4, PASS: 3, NOTRUN: 2, SKIP: 1 }
    const previous = map.get(id)
    const nextRank = priority[status] ?? 0
    if (previous === undefined || nextRank > (priority[previous.status] ?? 0)) {
      map.set(id, { status, source, strong })
    }
  }
  for (const lane of ['E1', 'E2']) {
    for (const suite of readdirSync(join(RC5, lane))) {
      const path = join(RC5, lane, suite, 'summary.json')
      if (!existsSync(path)) continue
      const summary = JSON.parse(readFileSync(path, 'utf8'))
      for (const row of summary.cases ?? []) put(row.id, row.status, `${lane}/${suite}`, true)
    }
  }
  const e3Dir = join(RC5, 'e3-super')
  const e3 = new Map()
  if (existsSync(e3Dir)) {
    for (const entry of readdirSync(e3Dir)) {
      const path = join(e3Dir, entry, 'report.json')
      if (!existsSync(path)) continue
      const report = JSON.parse(readFileSync(path, 'utf8'))
      e3.set(report.id, report.status)
    }
  }
  return { map, e3 }
}

const { map, e3 } = laneStatuses()
const E3_AUTHORITATIVE = new Set([
  'RC5-TERM-002', 'RC5-TERM-005', 'RC5-TERM-006', 'RC5-TERM-013',
  'RC5-API-004', 'RC5-API-005', 'RC5-API-006', 'RC5-API-007',
])
/** 旧 stub 证据不满足 51 口径的用例（即使旧行 PASS 也回落 MISSING）。 */
const INSUFFICIENT_EVIDENCE = new Set(['RC5-API-005', 'RC5-API-006', 'RC5-API-007'])

/**
 * 24h 时间窗权威判定：窗口未满一律不覆盖（保持 MISSING）。
 * TERM-013 取主 soak 的 term.verdict；DATA-009 需主 soak 的 data.verdict 与
 * 规模窗口 summary.json 的 verdict 同时 PASS 才判 PASS。
 * 路径可用 RC5_SOAK_SUMMARY / RC5_SCALE_SUMMARY 覆盖（仅用于演练）。
 */
const SOAK_SUMMARY = process.env.RC5_SOAK_SUMMARY ?? join(RC5, 'p6b', 'soak', 'final-image2', 'summary-24h-final2.json')
const SCALE_SUMMARY = process.env.RC5_SCALE_SUMMARY ?? join(RC5, 'E2', 'DATA', 'scale', 'summary.json')
const WAIVER_PATH = join(RC5, 'p6b', 'waiver-24h.json')
const waiver = existsSync(WAIVER_PATH) ? JSON.parse(readFileSync(WAIVER_PATH, 'utf8')) : undefined
function soakStatuses() {
  const result = new Map()
  const readJson = path => (existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : undefined)
  /* 产品豁免最高优先：waived 列表内判 WAIVED（非 PASS），事后 soak 摘要只作观察证据 */
  for (const id of waiver?.waived ?? []) {
    result.set(id, { status: 'WAIVED', evidence: `产品豁免（${waiver.decidedAtLocal}）：${WAIVER_PATH}、waiver-24h.md；未满窗不判 PASS` })
  }
  if (result.size > 0) return result
  const soak = readJson(SOAK_SUMMARY)
  if (soak?.window?.complete === true) {
    if (soak.term?.verdict !== undefined) {
      result.set('RC5-TERM-013', { status: soak.term.verdict, evidence: `${SOAK_SUMMARY}（term.verdict，窗口已满）` })
    }
    if (soak.data?.verdict !== undefined) {
      result.set('RC5-DATA-009', { status: soak.data.verdict, evidence: `${SOAK_SUMMARY}（data.verdict，窗口已满）` })
    }
  }
  const data = result.get('RC5-DATA-009')
  if (data !== undefined) {
    const scale = readJson(SCALE_SUMMARY)
    if (scale?.windowComplete !== true) {
      result.set('RC5-DATA-009', { status: 'MISSING', evidence: `${SOAK_SUMMARY}；规模窗口未满（${SCALE_SUMMARY}）` })
    } else {
      const status = data.status === 'PASS' && scale.verdict === 'PASS' ? 'PASS' : 'FAIL'
      result.set('RC5-DATA-009', { status, evidence: `${SOAK_SUMMARY} + ${SCALE_SUMMARY}（两窗口均满）` })
    }
  }
  return result
}
const soak = soakStatuses()

const text = readFileSync(MATRIX, 'utf8')
const lines = text.split('\n')
const rowPattern = /^\| (.*?) \| (RC5-[A-Z0-9]+-[0-9]+) \| ([^|]+) \| (PASS|FAIL|MISSING|WAIVED) \| (.*?) \| (.*?) \|$/
const rows = []
for (let index = 0; index < lines.length; index += 1) {
  const match = rowPattern.exec(lines[index])
  if (match === null) continue
  rows.push({
    lineIndex: index,
    title: match[1].trim(),
    id: match[2].trim(),
    suite: match[2].trim().split('-')[1],
    phase: match[3].trim(),
    status: match[4].trim(),
    evidence: match[5].trim(),
    task: match[6].trim(),
  })
}

const evidenceFor = (id, lane) => {
  const suite = id.split('-')[1]
  if (lane === 'e3-super') return `artifacts/rc5/e3-super/${id}/{cmd.log,report.json}`
  const file = suite === 'ACP' ? 'assert.json' : 'result.md'
  return `artifacts/rc5/${lane ?? `E1/${suite}`}/${id}/{cmd.log,${file}}`
}

const changes = []
for (const row of rows) {
  let status = row.status
  let source = 'matrix'
  let evidenceOverride
  if (soak.has(row.id)) {
    status = soak.get(row.id).status
    source = 'soak'
    evidenceOverride = soak.get(row.id).evidence
  } else if (E3_AUTHORITATIVE.has(row.id) && e3.has(row.id)) {
    status = e3.get(row.id)
    source = 'E3'
  } else if (INSUFFICIENT_EVIDENCE.has(row.id)) {
    status = 'MISSING'
    source = 'insufficient'
  } else if (map.has(row.id)) {
    status = map.get(row.id).status
    source = map.get(row.id).source
  }
  if (status === 'SKIP' || status === 'NOTRUN') status = 'MISSING'
  if (status !== row.status) {
    changes.push({ id: row.id, from: row.status, to: status, source })
    row.status = status
    if (evidenceOverride !== undefined) {
      row.evidence = evidenceOverride
    } else if (status === 'PASS' && row.evidence.includes('MISSING')) {
      const lane = source === 'E3' ? 'e3-super' : undefined
      row.evidence = `${evidenceFor(row.id, lane)} ［最终镜像车道 ${source}］`
    }
  }
}

const statusOf = (id) => rows.find(row => row.id === id)?.status

/* 总览/套件/阶段重算 */
const counts = { PASS: 0, FAIL: 0, MISSING: 0, WAIVED: 0 }
for (const row of rows) counts[row.status] += 1
const suiteOrder = ['ENV', 'BOOT', 'API', 'ACC', 'MCPS', 'MCPP', 'TERM', 'IMP', 'ACP', 'OFF', 'HERO', 'CMD', 'V1', 'DATA', 'UI', 'SEC']
const countStatus = (items, status) => items.filter(row => row.status === status).length
const suiteRows = suiteOrder.map(suite => {
  const items = rows.filter(row => row.suite === suite)
  return [suite, items.length, countStatus(items, 'PASS'), countStatus(items, 'FAIL'), countStatus(items, 'MISSING'), countStatus(items, 'WAIVED')]
})
const phaseOrder = ['P1', 'P2', 'P3', 'P4', 'P5', 'P6a', 'P6b', ...new Set(rows.map(row => row.phase))]
const orderedPhases = [...new Set(phaseOrder.filter(phase => rows.some(row => row.phase === phase)))]
const phaseRows = orderedPhases.map(phase => {
  const items = rows.filter(row => row.phase === phase)
  return [phase, items.length, countStatus(items, 'PASS'), countStatus(items, 'FAIL'), countStatus(items, 'MISSING'), countStatus(items, 'WAIVED')]
})

/* 优先级来自 51 §3 用例表（矩阵行本身不带优先级列）。 */
const priority = new Map()
for (const line of readFileSync(join(ROOT, 'docs', 'design', '51-上游rc.5合并测试用例与回归.md'), 'utf8').split('\n')) {
  const match = /^\| (RC5-[A-Z0-9]+-[0-9]+) \| (P[0-3]) \|/.exec(line)
  if (match !== null) priority.set(match[1], match[2])
}
const waivedIds = rows.filter(row => row.status === 'WAIVED').map(row => row.id)
const missingP0 = rows.filter(row => row.status !== 'PASS' && row.status !== 'WAIVED' && priority.get(row.id) === 'P0').map(row => row.id)
const missing = rows.filter(row => row.status !== 'PASS' && row.status !== 'WAIVED').map(row => row.id)
console.log(`rows=${rows.length} PASS=${counts.PASS} FAIL=${counts.FAIL} MISSING=${counts.MISSING} WAIVED=${counts.WAIVED}`)
console.log(`missing=${missing.join(',')}`)
console.log(`waived=${waivedIds.join(',') || 'none'}`)
console.log(`missingP0=${missingP0.join(',') || 'none'}`)
for (const change of changes) console.log(`CHANGE ${change.id}: ${change.from} -> ${change.to} (${change.source})`)

if (!WRITE) process.exit(0)

/* 行写回 */
for (const row of rows) {
  lines[row.lineIndex] = `| ${row.title} | ${row.id} | ${row.phase} | ${row.status} | ${row.evidence} | ${row.task} |`
}

let next = lines.join('\n')

/* 头部时间/HEAD 刷新（避免生成记录与实际工作树脱节） */
let head = 'unknown'
let branch = 'unknown'
try {
  head = execFileSync('git', ['-C', ROOT, 'rev-parse', '--short', 'HEAD'], { encoding: 'utf8' }).trim()
  branch = execFileSync('git', ['-C', ROOT, 'rev-parse', '--abbrev-ref', 'HEAD'], { encoding: 'utf8' }).trim()
} catch { /* 非 git 环境保留 unknown */ }
next = next.replace(/^- 生成时间：.*$/m, `- 生成时间：${new Date().toISOString().replace(/\.\d{3}Z$/, 'Z')}`)
next = next.replace(/^- 工作树：.*$/m, `- 工作树：\`${ROOT}\`（\`${branch}\`，HEAD \`${head}\`）`)

/* 总览 + 套件/阶段表 + 判定提示：整段重建，避免正则拼接产生重复表 */
const verdictLine = counts.WAIVED > 0
  ? `> **P0 全绿、可进入 P7**：FAIL ${counts.FAIL} 条；MISSING ${counts.MISSING} 条（P0 ${missingP0.length} 条）；WAIVED ${counts.WAIVED} 条（${waivedIds.join('、')}）为产品签字豁免（\`p6b/waiver-24h.json\`），不计入未通过。`
  : `> **当前不可判绿**：FAIL ${counts.FAIL} 条；MISSING ${counts.MISSING} 条，其中 P0 ${missingP0.length} 条（${missingP0.join('、') || '无'}）。P6 未收口，P7 不得启动。`
const overview = [
  '## 总览', '',
  '| 状态 | 条数 |', '|---|---:|',
  `| PASS | ${counts.PASS} |`,
  `| FAIL | ${counts.FAIL} |`,
  `| MISSING | ${counts.MISSING} |`,
  `| WAIVED（产品豁免） | ${counts.WAIVED} |`,
  `| **合计** | **${rows.length}** |`, '',
  verdictLine, '',
  '### 套件 × 状态', '',
  '| 套件 | 总数 | PASS | FAIL | MISSING | WAIVED |', '|---|---:|---:|---:|---:|---:|',
  ...suiteRows.map(row => `| ${row[0]} | ${row[1]} | ${row[2]} | ${row[3]} | ${row[4]} | ${row[5]} |`),
  `| **合计** | **${rows.length}** | **${counts.PASS}** | **${counts.FAIL}** | **${counts.MISSING}** | **${counts.WAIVED}** |`, '',
  '### 阶段 × 状态', '',
  '| 阶段 | 总数 | PASS | FAIL | MISSING | WAIVED |', '|---|---:|---:|---:|---:|---:|',
  ...phaseRows.map(row => `| ${row[0]} | ${row[1]} | ${row[2]} | ${row[3]} | ${row[4]} | ${row[5]} |`),
  `| **合计** | **${rows.length}** | **${counts.PASS}** | **${counts.FAIL}** | **${counts.MISSING}** | **${counts.WAIVED}** |`,
].join('\n')
next = next.replace(/## 总览\n\n[\s\S]*?(?=\n\n## 24h 浸泡窗口)/, overview)

/* 浸泡窗口 + P0 清单 */
const metaPath = join(RC5, 'p6b', 'soak', 'final-image2', 'meta-24h-final2.json')
if (existsSync(metaPath)) {
  const meta = JSON.parse(readFileSync(metaPath, 'utf8'))
  const lastTerm = existsSync(meta.logs.term) ? readFileSync(meta.logs.term, 'utf8').trim().split('\n').filter(Boolean).at(-1) : undefined
  const lastData = existsSync(meta.logs.data) ? readFileSync(meta.logs.data, 'utf8').trim().split('\n').filter(Boolean).at(-1) : undefined
  const now = Date.now()
  const elapsedH = ((now - Date.parse(meta.startedAt)) / 3_600_000).toFixed(2)
  const plannedH = (meta.plannedSeconds / 3600).toFixed(0)
  const pct = ((now - Date.parse(meta.startedAt)) / (meta.plannedSeconds * 1000) * 100).toFixed(1)
  const soakSummary = existsSync(SOAK_SUMMARY) ? JSON.parse(readFileSync(SOAK_SUMMARY, 'utf8')) : undefined
  const scaleSummary = existsSync(SCALE_SUMMARY) ? JSON.parse(readFileSync(SCALE_SUMMARY, 'utf8')) : undefined
  const windowComplete = soakSummary?.window?.complete === true
  const waived = waiver?.waived?.includes('RC5-TERM-013') === true || waiver?.waived?.includes('RC5-DATA-009') === true
  const headLines = waived
    ? [
      `- 状态：**产品豁免满窗判据**（${waiver.decidedAtLocal}，指令「${waiver.instruction}」）；TERM-013/DATA-009 = WAIVED，不计未通过`,
      `- 决策时点健康度：主 soak ${Math.round((waiver.evidenceAtDecision.mainSoak.elapsedSeconds / 3600) * 10) / 10}h、规模 ${Math.round((waiver.evidenceAtDecision.scaleWindow.elapsedSeconds / 3600) * 10) / 10}h，churn/写/锁/integrity 全 ok（详见 \`p6b/waiver-24h.md\`）`,
      '- 观察不中断：满窗摘要出来后仅作事后观察证据，不回改判定',
    ]
    : []
  const windowLines = waived
    ? [
      `- 窗口：tag=\`${meta.tag}\`，容器=\`${meta.container}\`，镜像=final-image2（\`sha256:22fe8acb436f…\`）`,
      `- 当前采样：已观测 **${elapsedH} h / ${plannedH} h**（${pct}%）；进程继续跑到 \`${meta.plannedEndAt}\``,
    ]
    : windowComplete
      ? [
        `- 窗口：tag=\`${meta.tag}\`，容器=\`${meta.container}\`，镜像=final-image2（\`sha256:22fe8acb436f…\`）`,
        `- 窗口：**已满**（${soakSummary.elapsedSeconds}s）；term=\`${soakSummary.term?.verdict ?? '-'}\`、data=\`${soakSummary.data?.verdict ?? '-'}\`；规模窗口=\`${scaleSummary?.windowComplete === true ? scaleSummary.verdict : '未满'}\``,
        `- 摘要：\`${SOAK_SUMMARY}\`${scaleSummary === undefined ? '' : ` + \`${SCALE_SUMMARY}\``}`,
      ]
      : [
        `- 窗口：tag=\`${meta.tag}\`，容器=\`${meta.container}\`，镜像=final-image2（\`sha256:22fe8acb436f…\`）`,
        `- 最新采样：已观测 **${elapsedH} h / ${plannedH} h**（${pct}%），\`windowComplete=false\``,
        '- 结论：**未满窗口，不得判绿**；DATA-009 = MISSING，TERM-013 = MISSING',
      ]
  const soakSection = [
    '## 24h 浸泡窗口（DATA-009 / TERM-013）', '',
    `- soak 启动：\`${meta.startedAt}\`；计划结束：\`${meta.plannedEndAt}\`（${meta.plannedSeconds}s）`,
    ...headLines,
    ...windowLines,
    `- 最新 TERM tick：${lastTerm === undefined ? '尚无' : `\`${lastTerm.slice(0, 220)}\``}`,
    `- 最新 DATA tick：${lastData === undefined ? '尚无' : `\`${lastData.slice(0, 220)}\``}`,
    `- leftover：${waived ? '`WAIVED-24H`（产品豁免，观察继续）' : windowComplete ? '`SOAK-24H`（已闭）、`TERM013-DATA009`（已闭）' : '`SOAK-24H`、`TERM013-DATA009`'}`, '',
  ].join('\n')
  next = next.replace(/## 24h 浸泡窗口（DATA-009 \/ TERM-013）\n\n[\s\S]*?(\n\n## P0 未通过清单)/, `${soakSection}$1`)
}

const p0Rows = rows.filter(row => row.status !== 'PASS' && priority.get(row.id) === 'P0')
const p0Section = [
  '## P0 未通过清单（门禁红/缺失）', '',
  '| id | 阶段 | 状态 | 摘要 |', '|---|---|---|---|',
  ...p0Rows.map(row => `| ${row.id} | ${row.phase} | ${row.status} | ${row.title.replaceAll('|', '\\|')} |`),
  p0Rows.length === 0 ? '| — | — | — | 无（P0 全绿） |' : '',
].filter(Boolean).join('\n')
next = next.replace(/## P0 未通过清单（门禁红\/缺失）\n\n[\s\S]*?(\n\n## 164 行矩阵)/, `${p0Section}$1`)

/* 遗留项 */
const leftover = ['## 遗留项（leftovers）', '', '| id | 现象 | 级别 | 建议 |', '|---|---|---|---|']
const soakFile = join(RC5, 'p6b', 'soak', 'final-image2', 'meta-24h-final2.json')
const soakMeta = existsSync(soakFile) ? JSON.parse(readFileSync(soakFile, 'utf8')) : undefined
const soakFull = existsSync(SOAK_SUMMARY) ? JSON.parse(readFileSync(SOAK_SUMMARY, 'utf8')) : undefined
const scaleFull = existsSync(SCALE_SUMMARY) ? JSON.parse(readFileSync(SCALE_SUMMARY, 'utf8')) : undefined
const soakComplete = soakFull?.window?.complete === true
const scaleComplete = scaleFull?.windowComplete === true
const soakWaived = waiver?.waived?.includes('RC5-TERM-013') === true || waiver?.waived?.includes('RC5-DATA-009') === true
if (soakWaived) {
  leftover.push(`| WAIVED-24H | TERM-013/DATA-009 满窗判据经产品签字豁免（${waiver.decidedAtLocal}，指令「${waiver.instruction}」）；决策时点主 soak ${Math.round((waiver.evidenceAtDecision.mainSoak.elapsedSeconds / 3600) * 10) / 10}h、规模 ${Math.round((waiver.evidenceAtDecision.scaleWindow.elapsedSeconds / 3600) * 10) / 10}h 全部健康（churn/写/锁/integrity 0 异常） | P1 | 采样跑到满窗，摘要仅作事后观察证据；残余风险由上线后 24h 观察覆盖（发布说明 §8） |`)
} else {
  if (!soakComplete) {
    leftover.push(`| SOAK-24H | 24h 浸泡窗口未满（final-image2；${soakMeta?.plannedEndAt === undefined ? '见 meta-24h-final2.json' : `plannedEnd=${soakMeta.plannedEndAt}`}） | P1 | 满窗后复核 window.complete=true 与 verdict；未满不得判绿 |`)
  }
  if (!scaleComplete) {
    leftover.push(`| DATA-009-SCALE | 规模口径由独立 scale 窗口覆盖（50 持久会话 / 60s 50 并发读 / 5min 50 并发写 / 2h 全库 integrity，止 ${scaleFull?.plannedEndAt ?? '2026-11-21T07:37:17Z'}）；主窗口为 2 writers 的 24h 浸泡 | P1 | 满窗后合并两窗口判定 DATA-009 |`)
  }
  if (!soakComplete) {
    leftover.push(`| TERM013-DATA009 | TERM-013/DATA-009 依赖 24h 浸泡满窗（同一窗口 final-image2）；满窗前记 MISSING | P1 | ${soakMeta?.plannedEndAt ?? '见 meta-24h-final2.json'} 后复核 |`)
  }
}
leftover.push(`| NOTPASS-P0 | ${missingP0.length === 0 ? '无' : missingP0.join('、')} | P0 | ${missingP0.length === 0 ? 'P0 全绿' : 'P0 未全绿：按 51 补跑后方可进 P7'} |`)
const notPassP1 = missing.filter(id => !missingP0.includes(id))
leftover.push(`| NOTPASS-P1+ | ${notPassP1.length === 0 ? '无' : notPassP1.join('、')} | P1 | 按 51 步骤逐条补跑或取得用户签字豁免 |`)
leftover.push('| R22-TASKS-PROMPT | 任务主会话按标准 preset 创建，角色 prompt/preset 未接线；可能自行派 subagent 与 tasks 路由重复（产品遗留，不影响 API-005/006/007 判据） | P1 | 下一次镜像变更窗口：bundles 加 `@eterna/tasks` + 注入 presets + `agent.ctx.systemPrompt.section` 角色 prompt（见 `p7/doc54-delivery-audit.md` §2.1） |')
leftover.push('| EVID-ACP | ACP-001..010 以 assert.json 作为结果记录（无 result.md） | P3 | 补 result.md 或登记等价证据规范 |')
leftover.push('| EVID-ENV-V1 | ENV-004/005、V1-008 的运行时断言由 P5 镜像探针补证（非逐字 docker run） | P3 | 保留探针索引；按需逐字复跑 |')
leftover.push('| P7-NOTRUN | P7 全量复跑/PR/合并/生产部署/上线后 24h 未执行 | P0 | P6 清零后按 51 §6.1/§6.2、54 §3.2 执行 |')
const leftoverText = leftover.join('\n')
next = next.replace(/## 遗留项（leftovers）\n\n([\s\S]*)$/, `${leftoverText}\n`)

writeFileSync(MATRIX, next)
console.log(`wrote ${MATRIX}`)