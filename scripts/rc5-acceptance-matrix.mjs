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

const text = readFileSync(MATRIX, 'utf8')
const lines = text.split('\n')
const rowPattern = /^\| (.*?) \| (RC5-[A-Z0-9]+-[0-9]+) \| ([^|]+) \| (PASS|FAIL|MISSING) \| (.*?) \| (.*?) \|$/
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
  if (E3_AUTHORITATIVE.has(row.id) && e3.has(row.id)) {
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
    if (status === 'PASS' && row.evidence.includes('MISSING')) {
      const lane = source === 'E3' ? 'e3-super' : undefined
      row.evidence = `${evidenceFor(row.id, lane)} ［最终镜像车道 ${source}］`
    }
  }
}

const statusOf = (id) => rows.find(row => row.id === id)?.status

/* 总览/套件/阶段重算 */
const counts = { PASS: 0, FAIL: 0, MISSING: 0 }
for (const row of rows) counts[row.status] += 1
const suiteOrder = ['ENV', 'BOOT', 'API', 'ACC', 'MCPS', 'MCPP', 'TERM', 'IMP', 'ACP', 'OFF', 'HERO', 'CMD', 'V1', 'DATA', 'UI', 'SEC']
const suiteRows = suiteOrder.map(suite => {
  const items = rows.filter(row => row.suite === suite)
  return [suite, items.length, items.filter(row => row.status === 'PASS').length, items.filter(row => row.status === 'FAIL').length, items.filter(row => row.status === 'MISSING').length]
})
const phaseOrder = ['P1', 'P2', 'P3', 'P4', 'P5', 'P6a', 'P6b', ...new Set(rows.map(row => row.phase))]
const orderedPhases = [...new Set(phaseOrder.filter(phase => rows.some(row => row.phase === phase)))]
const phaseRows = orderedPhases.map(phase => {
  const items = rows.filter(row => row.phase === phase)
  return [phase, items.length, items.filter(row => row.status === 'PASS').length, items.filter(row => row.status === 'FAIL').length, items.filter(row => row.status === 'MISSING').length]
})

/* 优先级来自 51 §3 用例表（矩阵行本身不带优先级列）。 */
const priority = new Map()
for (const line of readFileSync(join(ROOT, 'docs', 'design', '51-上游rc.5合并测试用例与回归.md'), 'utf8').split('\n')) {
  const match = /^\| (RC5-[A-Z0-9]+-[0-9]+) \| (P[0-3]) \|/.exec(line)
  if (match !== null) priority.set(match[1], match[2])
}
const missingP0 = rows.filter(row => row.status !== 'PASS' && priority.get(row.id) === 'P0').map(row => row.id)
const missing = rows.filter(row => row.status !== 'PASS').map(row => row.id)
console.log(`rows=${rows.length} PASS=${counts.PASS} FAIL=${counts.FAIL} MISSING=${counts.MISSING}`)
console.log(`missing=${missing.join(',')}`)
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
const overview = [
  '## 总览', '',
  '| 状态 | 条数 |', '|---|---:|',
  `| PASS | ${counts.PASS} |`,
  `| FAIL | ${counts.FAIL} |`,
  `| MISSING | ${counts.MISSING} |`,
  `| **合计** | **${rows.length}** |`, '',
  `> **当前不可判绿**：FAIL ${counts.FAIL} 条；MISSING ${counts.MISSING} 条，其中 P0 ${missingP0.length} 条（${missingP0.join('、') || '无'}）。P6 未收口，P7 不得启动。`, '',
  '### 套件 × 状态', '',
  '| 套件 | 总数 | PASS | FAIL | MISSING |', '|---|---:|---:|---:|---:|',
  ...suiteRows.map(row => `| ${row[0]} | ${row[1]} | ${row[2]} | ${row[3]} | ${row[4]} |`),
  `| **合计** | **${rows.length}** | **${counts.PASS}** | **${counts.FAIL}** | **${counts.MISSING}** |`, '',
  '### 阶段 × 状态', '',
  '| 阶段 | 总数 | PASS | FAIL | MISSING |', '|---|---:|---:|---:|---:|',
  ...phaseRows.map(row => `| ${row[0]} | ${row[1]} | ${row[2]} | ${row[3]} | ${row[4]} |`),
  `| **合计** | **${rows.length}** | **${counts.PASS}** | **${counts.FAIL}** | **${counts.MISSING}** |`,
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
  const soakSection = [
    '## 24h 浸泡窗口（DATA-009 / TERM-013）', '',
    `- soak 启动：\`${meta.startedAt}\`；计划结束：\`${meta.plannedEndAt}\`（${meta.plannedSeconds}s）`,
    `- 窗口：tag=\`${meta.tag}\`，容器=\`${meta.container}\`，镜像=final-image2（\`sha256:22fe8acb436f…\`）`,
    `- 最新采样：已观测 **${elapsedH} h / ${plannedH} h**（${pct}%），\`windowComplete=false\``,
    '- 结论：**未满窗口，不得判绿**；DATA-009 = MISSING，TERM-013 = MISSING',
    `- 最新 TERM tick：${lastTerm === undefined ? '尚无' : `\`${lastTerm.slice(0, 220)}\``}`,
    `- 最新 DATA tick：${lastData === undefined ? '尚无' : `\`${lastData.slice(0, 220)}\``}`,
    '- leftover：`SOAK-24H`、`TERM013-DATA009`', '',
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
const soak = existsSync(soakFile) ? JSON.parse(readFileSync(soakFile, 'utf8')) : undefined
leftover.push(`| SOAK-24H | 24h 浸泡窗口未满（final-image2；${soak?.plannedEndAt === undefined ? '见 artifacts/rc5/p6b/soak/final-image2/window.json' : `plannedEnd=${soak.plannedEndAt}`}） | P1 | 满窗后复核 window.complete=true 与 verdict；未满不得判绿 |`)
leftover.push(`| NOTPASS-P0 | ${missingP0.length === 0 ? '无' : missingP0.join('、')} | P0 | ${missingP0.length === 0 ? 'P0 全绿' : 'P0 未全绿：按 51 补跑后方可进 P7'} |`)
const notPassP1 = missing.filter(id => !missingP0.includes(id))
leftover.push(`| NOTPASS-P1+ | ${notPassP1.length === 0 ? '无' : notPassP1.join('、')} | P1 | 按 51 步骤逐条补跑或取得用户签字豁免 |`)
leftover.push(`| TERM013-DATA009 | TERM-013/DATA-009 依赖 24h 浸泡满窗（同一窗口 final-image2）；满窗前记 MISSING | P1 | ${soak?.plannedEndAt ?? '见 meta-24h-final2.json'} 后复核 |`)
leftover.push('| DATA-009-SCALE | 现行 soak 为 2 writers、每 5min 检 3 库，未达 48 §4.5 ≥50 并发 + 2h 全库 integrity | P1 | 满窗前补压或登记豁免 |')
leftover.push('| R22-TASKS-PROMPT | 任务主会话按标准 preset 创建，角色 prompt/preset 未接线；可能自行派 subagent 与 tasks 路由重复（产品遗留，不影响 API-005/006/007 判据） | P1 | 下一次镜像变更窗口：bundles 加 `@eterna/tasks` + 注入 presets + `agent.ctx.systemPrompt.section` 角色 prompt（见 `p7/doc54-delivery-audit.md` §2.1） |')
leftover.push('| EVID-ACP | ACP-001..010 以 assert.json 作为结果记录（无 result.md） | P3 | 补 result.md 或登记等价证据规范 |')
leftover.push('| EVID-ENV-V1 | ENV-004/005、V1-008 的运行时断言由 P5 镜像探针补证（非逐字 docker run） | P3 | 保留探针索引；按需逐字复跑 |')
leftover.push('| P7-NOTRUN | P7 全量复跑/PR/合并/生产部署/上线后 24h 未执行 | P0 | P6 清零后按 51 §6.1/§6.2、54 §3.2 执行 |')
const leftoverText = leftover.join('\n')
next = next.replace(/## 遗留项（leftovers）\n\n([\s\S]*)$/, `${leftoverText}\n`)

writeFileSync(MATRIX, next)
console.log(`wrote ${MATRIX}`)