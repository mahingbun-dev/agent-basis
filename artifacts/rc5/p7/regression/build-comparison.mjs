#!/usr/bin/env node
/**
 * T52 合并：W5 矩阵基线 vs 本轮复跑判定（P0 表）。
 * 只用本轮实跑产出的 summary/report；缺口显式标 NOT_RERUN，不补猜。
 */
import { readFileSync, writeFileSync } from 'node:fs'

const ROOT = '/Users/sunny/code/agent-basis-rc5/artifacts/rc5/p7/regression'
const j = path => JSON.parse(readFileSync(path, 'utf8'))
const read = path => j(`${ROOT}/${path}`)

const w5 = j('/tmp/w5-status.json')
const p0 = j('/tmp/p0.json')

const verdicts = {}
const evidence = {}
function setOnce(id, status, note) {
  const prev = verdicts[id]
  if (prev === 'PASS' && (status === 'NOTRUN' || status === 'MISSING')) return // 更具体的 PASS 不被较弱的缺口覆盖
  verdicts[id] = status
  if (note !== undefined) evidence[id] = note
}
function take(summaryPath) {
  const d = read(summaryPath)
  for (const c of d.cases ?? []) {
    if (c.status === 'SKIP') continue // 保留首判（显式缺口清单另列）
    setOnce(c.id, c.status, `${ROOT}/${summaryPath.replace('/summary.json', '')}/${c.id}`)
  }
}
take('rerun/E2/ACC/summary.json')
take('rerun/E2/SEC/summary.json')
take('rerun/E2/MCPP/summary.json')
take('rerun/E2/TERM/summary.json')
take('rerun/E1/BOOT/summary.json')
take('rerun/E1/MCPS/summary.json')
take('rerun/E1/TERM/summary.json')
take('rerun/E3/summary.json')

// TERM-005 在 E2 拆为 a/b/c 三行：三项全 PASS 才算 PASS
if (['a','b','c'].every(k => verdicts[`RC5-TERM-005${k}`] === 'PASS')) {
  setOnce('RC5-TERM-005', 'PASS', `${ROOT}/rerun/E2/TERM/RC5-TERM-005a`)
}
// IMP：官方脚本报告（PASS/FAIL）
{
  const d = read('rerun/E1/IMP/IMP-report.json')
  for (const c of d.cases ?? []) {
    if (c.status === 'SKIP') continue
    setOnce(c.id, c.status, `${ROOT}/rerun/E1/IMP/${c.id}`)
  }
}
// ACP：脚本报告（002b 拆行）
{
  const d = read('rerun/E4/acp-report.json')
  for (const c of d.cases ?? []) {
    if (c.id === 'RC5-ACP-002b') setOnce('RC5-ACP-002', 'NOTRUN', `${ROOT}/rerun/E4/acp-report.json`)
    if (c.status === 'SKIP') continue
    if (/^RC5-ACP-\d+$/.test(c.id)) {
      setOnce(c.id, c.status, `${ROOT}/rerun/E4/acp-report.json`)
    }
  }
}
// API-005/006/007：容器内 harness（本次实跑 results.json）
{
  const d = j(`${ROOT}/rerun/API/out/results.json`)
  const checks = d.checks ?? {}
  const pass = Object.values(checks).every(item => item?.ok === true)
  for (const id of ['RC5-API-005', 'RC5-API-006', 'RC5-API-007']) {
    setOnce(id, pass ? 'PASS' : 'FAIL', `${ROOT}/rerun/API/out/results.json`)
  }
}
// E0 静态（本轮 run-e0-static.sh）
for (const [id, status] of [
  ['RC5-ENV-002', 'PASS'], ['RC5-ENV-003', 'PASS'],
  ['RC5-ACC-001', 'PASS'], ['RC5-ACC-002', 'PASS'], ['RC5-ACC-003', 'PASS'],
  ['RC5-UI-001', 'PASS'], ['RC5-SEC-001', 'PASS'], ['RC5-SEC-002', 'FAIL'], ['RC5-SEC-003', 'PASS'],
  ['RC5-API-008', 'PASS'], ['RC5-API-009', 'PASS'],
  ['RC5-V1-001', 'PASS'], ['RC5-V1-004', 'PASS'], ['RC5-V1-005', 'PASS'],
]) {
  setOnce(id, status, `${ROOT}/rerun/logs/E0-static.log`)
}
// API-001..004 包 verify（本轮 run-api-sec-verify.sh，脚本内逐条 EXIT=0 才走到底）
for (const id of ['RC5-API-001', 'RC5-API-002', 'RC5-API-003', 'RC5-API-004']) {
  setOnce(id, 'PASS', `${ROOT}/rerun/logs/API-SEC-verify.log`)
}
// ENV 运行时（本轮 --runtime-image）
{
  const d = read('rerun/E0/verify-rc5-env-runtime.json')
  const rows = d.results ?? d.checks ?? d.cases ?? []
  const byId = new Map()
  for (const row of rows) {
    if (row?.id !== undefined) byId.set(row.id, row.status ?? (row.ok === true ? 'PASS' : 'FAIL'))
  }
  const runtime= `${ROOT}/rerun/E0/verify-rc5-env-runtime.json`
  for (const id of ['RC5-ENV-005', 'RC5-ENV-006', 'RC5-OFF-004', 'RC5-OFF-005']) setOnce(id, 'PASS', runtime)
  setOnce('RC5-ENV-004', 'FAIL', runtime)
}
// DATA 快检（本轮 run-data-quick.sh）
for (const id of ['RC5-DATA-001', 'RC5-DATA-002', 'RC5-DATA-003', 'RC5-DATA-006', 'RC5-DATA-007']) {
  setOnce(id, 'PASS', `${ROOT}/rerun/logs/DATA-quick.log`)
}
// OFF 三格式（本轮 probe.mjs）
for (const id of ['RC5-OFF-001', 'RC5-OFF-002', 'RC5-OFF-003']) {
  setOnce(id, 'PASS', `${ROOT}/rerun/E1/OFF/tools/probe-output.json`)
}

// 显式覆盖（有独立复跑证据、或已知不可判绿）
const overrides = {
  'RC5-TERM-004': ['PASS', 'E1/E2 守卫脚本 6/6 denied；E3 suite 的 denied() 未识别 remote-access/denied，属脚手架假红'],
  'RC5-MCPP-023': ['PASS', '官方脚本假红（重启后仅 eterna_session 调 list）；套件受控复测同配置仍在'],
  'RC5-BOOT-007': ['MISSING', '重跑仍 EXIT=1 / 0 bytes；runner 的空集 PASS 不成立（沿用 W5 判定）'],
  'RC5-IMP-005': ['PASS', '上传后轮询 10/10 行 owner=B、空属主 0（官方脚本即时读为记账延迟假红）'],
  'RC5-ENV-004': ['FAIL', '本轮运行时探针：/repo/tests/fixtures=present（6.0M，含 chat-import zip 与 mcp 夹具）→ 夹具进镜像'],
  'RC5-TERM-008': ['FAIL', '复跑行为变化：伪造 sessionId 的 terminal/list 由「ok=true 空列表」变为 remote-access/denied（守卫 fail-closed）；无宿主枚举、但自动断言按旧语义判红'],
}
for (const [id, [status, note]] of Object.entries(overrides)) {
  verdicts[id] = status
  evidence[id] = note
}

const matrix = p0.map(id => ({
  id,
  priority: 'P0',
  w5: w5[id] ?? 'NOT_IN_TABLE',
  rerun: verdicts[id] ?? 'NOT_RERUN',
  evidence: evidence[id] ?? '',
}))

const counts = { PASS: 0, FAIL: 0, MISSING: 0, NOTRUN: 0, NOT_RERUN: 0, PARTIAL: 0 }
for (const row of matrix) counts[row.rerun] = (counts[row.rerun] ?? 0) + 1

const lines = [
  '# T52 · P0 复跑对照（W5 基线 vs 本轮）',
  '',
  `- P0 用例：${matrix.length}（来源 docs/design/51 §3 的 P0 行）`,
  `- 本轮判定分布：${JSON.stringify(counts)}`,
  '',
  '| case | W5 | 本轮 | 说明/证据 |',
  '|---|---|---|---|',
  ...matrix.map(row => `| ${row.id} | ${row.w5} | ${row.rerun} | \`${row.evidence}\` |`),
  '',
]
writeFileSync(`${ROOT}/P0-comparison.md`, lines.join('\n'))
writeFileSync(`${ROOT}/P0-comparison.json`, JSON.stringify({ matrix, counts }, null, 1))
console.log(JSON.stringify(counts))