#!/usr/bin/env node
/**
 * E1 · TERM 套件（本 lane 可执行面）。
 *
 * 51 §3.7 的 lane 归属（54 §5.1）：
 *   E1：001（bundle）、007（配置）、009（长进程切页）、010（close 后 attach）、
 *       012（两会话隔离）、013（24h 浸泡）、014（shell 缺失报错）
 *   E2：002/003/004/005/006/008/011（见 artifacts/rc5/E2/TERM/summary.json）
 *
 * 本 runner 现场执行 001/004/007（官方脚本 verify-terminal-guard.mjs）与
 * 009/010/012/014（本目录脚本），013 读取浸泡窗口证据（P6b 长跑轨）。
 * 004 虽归 E2，也在 E1 容器上复跑一份（同一镜像、独立 lane，双保险）。
 */
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Case, STATUS, summaryOf, writeSummary, shape } from '../_lib/evidence.mjs'
import { LANE, gitHead, run } from '../_lib/env.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const suite = 'TERM'
const startedAt = new Date().toISOString()
const rows = []

/* ---------------------------------------------- 官方守卫脚本（001/004/007） */

const reportPath = join(LANE.evidenceRoot, 'TERM', 'RC5-TERM-004', 'terminal-guard-report.json')
const guard = run('node', ['scripts/verify-terminal-guard.mjs',
  '--base', LANE.base,
  '--accounts-file', LANE.accountsFile,
  '--data-root', LANE.dataRoot,
  '--container', LANE.container,
  '--json', reportPath,
], { timeout: 300_000 })
const report = existsSync(reportPath) ? JSON.parse(readFileSync(reportPath, 'utf8')) : { cases: [] }
const byId = new Map((report.cases ?? []).map(row => [row.id, row]))

function reportRow(id) {
  return byId.get(id) ?? { status: STATUS.NOTRUN, detail: 'report 无该行' }
}

{
  const c = new Case(suite, 'RC5-TERM-001')
  const bundles = reportRow('RC5-TERM-007')
  const present = /bundles-terminal=true/.test(bundles.detail ?? '')
  c.cmd(guard.display, 0, `bundles-terminal=${present} :: ${shape(bundles.detail, 200)}`)
  c.assert('profile bundles 含 dsh-experimental-terminal-bundle', present)
  rows.push(c.finish({
    status: present ? STATUS.PASS : STATUS.FAIL,
    title: 'profile 含 terminal bundle',
    expected: '`dsh-experimental-terminal-bundle` 在 profile bundle 清单',
    actual: present ? 'bundles-terminal=true（渲染 profile package.json 实读）' : `未命中：${shape(bundles.detail, 180)}`,
    notes: ['bundles 行取自同一轮 verify-terminal-guard.mjs（脚本内先做 007/001 核对）'],
    artifacts: ['cmd.log'],
  }))
}

{
  const c = new Case(suite, 'RC5-TERM-004')
  const ids = ['RC5-TERM-004a', 'RC5-TERM-004b', 'RC5-TERM-004c', 'RC5-TERM-004d', 'RC5-TERM-004e', 'RC5-TERM-004f']
  const lines = ids.map(id => `${id}=${reportRow(id).status}: ${shape(reportRow(id).detail, 120)}`)
  c.cmd(guard.display, 0, lines.join('\n'))
  const allDenied = ids.every(id => reportRow(id).status === STATUS.PASS)
  c.assert('B 对 A 的 6 个 unary 动作全部被拒（remote-access/denied）', allDenied, lines.join('；'))
  rows.push(c.finish({
    status: allDenied ? STATUS.PASS : STATUS.FAIL,
    title: 'B 用 A 的 sessionId 调 terminal 6 个 unary 动作必须 403/deny',
    expected: 'list/environment/shells/create/close/rename 全部 403/deny，无数据泄漏',
    actual: allDenied ? '6/6 remote-access/denied（mux admit 换血 eterna-user principal + 服务入口租户守卫）' : lines.join('；'),
    notes: [
      '2026-11-20 复跑：W5 修复前本行为 FAIL（B 读到 A 的 cwd/shells）；修复后在 E1 容器实测 6/6 deny',
      '历史失败报告保留在 terminal-guard-report.pre-fix.json',
    ],
    artifacts: ['terminal-guard-report.json', 'terminal-guard-report.pre-fix.json', 'cmd.log'],
  }))
}

{
  const c = new Case(suite, 'RC5-TERM-007')
  const row = reportRow('RC5-TERM-007')
  const pass = /readUserTerminals=false:true/.test(row.detail ?? '') && /preferredShells=\[bash\]:true/.test(row.detail ?? '')
  c.cmd(guard.display, 0, `${row.status} :: ${shape(row.detail, 200)}`)
  c.assert('readUserTerminals=false', /readUserTerminals=false:true/.test(row.detail ?? ''))
  c.assert('preferredShells=[bash]', /preferredShells=\[bash\]:true/.test(row.detail ?? ''))
  rows.push(c.finish({
    status: pass ? STATUS.PASS : STATUS.FAIL,
    title: '容器终端配置',
    expected: 'readUserTerminals=false；preferredShells=[bash]',
    actual: pass ? '渲染 patch 的 optional-terminal-panel 配置读回一致' : shape(row.detail, 200),
    notes: ['官方脚本内 007 行（同轮执行）'],
    artifacts: ['cmd.log'],
  }))
}

/* ---------------------------------------------- 本 lane 脚本用例（009/010/012/014） */

const scripts = [
  ['RC5-TERM-009', 'term-009.mjs', '长进程切页再回：进程存活、输出连续'],
  ['RC5-TERM-010', 'term-010.mjs', 'close 后再 attach：状态正确、无幽灵终端'],
  ['RC5-TERM-012', 'term-012.mjs', '两会话各开终端：互不可见/互不输入'],
  ['RC5-TERM-014', 'term-014.mjs', 'shell 不存在时明确报错、容器不崩'],
]

function resultStatus(id) {
  const file = join(LANE.evidenceRoot, 'TERM', id, 'result.md')
  if (!existsSync(file)) return undefined
  const text = readFileSync(file, 'utf8')
  return /\*\*PASS\*\*/.test(text) ? STATUS.PASS : /\*\*FAIL\*\*/.test(text) ? STATUS.FAIL : undefined
}

for (const [id, script, title] of scripts) {
  const c = new Case(suite, id)
  const outcome = run('node', [join(here, script)], { timeout: 300_000 })
  const status = resultStatus(id)
  c.cmd(`node artifacts/rc5/E1/TERM/${script}`, outcome.exit, `${status ?? 'missing'} :: ${shape(outcome.stdout || outcome.stderr, 200)}`)
  if (status === undefined) {
    rows.push(c.finish({
      status: STATUS.NOTRUN,
      title,
      expected: '按 51 §3.7 用例定义执行',
      actual: `脚本未落 result.md（EXIT=${outcome.exit}）`,
      notes: [shape(outcome.stderr, 160)],
      artifacts: ['cmd.log'],
    }))
    continue
  }
  const file = join(LANE.evidenceRoot, 'TERM', id, 'result.md')
  const text = readFileSync(file, 'utf8')
  const expected = /\n## 预期\n\n([\s\S]*?)\n\n## 实际/.exec(text)?.[1] ?? '按 51 §3.7'
  const actual = /\n## 实际\n\n([\s\S]*?)\n\n(?:## |$)/.exec(text)?.[1] ?? ''
  rows.push(c.finish({
    status,
    title,
    expected,
    actual,
    notes: [`脚本：artifacts/rc5/E1/TERM/${script}（本 runner 现场执行）`],
    artifacts: ['cmd.log'],
  }))
}

/* ---------------------------------------------- 013 24h 浸泡（P6b 长跑轨） */

{
  const c = new Case(suite, 'RC5-TERM-013')
  const soakDir = join(LANE.repoRoot, 'artifacts', 'rc5', 'p6b', 'soak', 'final-image')
  const metaFile = join(soakDir, 'meta-24h-final.json')
  const summaryFile = join(soakDir, 'summary-24h-final.json')
  const soakFile = join(soakDir, 'term-013-24h-final.jsonl')
  const meta = existsSync(metaFile) ? JSON.parse(readFileSync(metaFile, 'utf8')) : undefined
  const final = existsSync(summaryFile) ? JSON.parse(readFileSync(summaryFile, 'utf8')) : undefined
  const samples = existsSync(soakFile)
    ? readFileSync(soakFile, 'utf8').split('\n').filter(Boolean).map(line => JSON.parse(line))
    : []
  const last = samples[samples.length - 1]
  const churnOk = samples.length > 0 && samples.every(row => row.churn === 'ok')
  const complete = final?.window?.complete === true
  const verdict = final?.term?.verdict
  const pass = complete && verdict === 'PASS'
  c.cmd('cat artifacts/rc5/p6b/soak/final-image/{meta,summary,term-013}-24h-final.*', pass ? 0 : 1,
    `windowComplete=${complete} plannedEnd=${meta?.plannedEndAt ?? '-'} samples=${samples.length} churnAllOk=${churnOk} verdict=${verdict ?? 'window-open'} last=${shape(last, 220)}`)
  c.note('churn 每 tick = create → WS attach(snapshot) → close；窗口未满时 summary 不落盘，本行只记 NOTRUN（54 §6.3）')
  rows.push(c.finish({
    status: pass ? STATUS.PASS : (complete ? STATUS.FAIL : STATUS.NOTRUN),
    title: '24h 浸泡：长进程 + 多次 attach/close，无 fd 泄漏/内存增长',
    expected: '24h 窗口完成；fd/内存采样平稳；churn（create→attach→close 循环）全成功',
    actual: complete
      ? `窗口完成 verdict=${verdict ?? '-'}（churnAllOk=${churnOk}）`
      : `窗口未满：plannedEnd=${meta?.plannedEndAt ?? '-'} samples=${samples.length} churnAllOk=${churnOk}（当前进度证据）`,
    notes: [
      '24h 属 P6b 长跑轨（54 §3.5），不在套件运行期内等待；套件只读窗口证据',
      '本窗口在终版镜像（ae5ce8cb）上起跑；legacy 老镜像窗口证据在 p6b/soak/legacy-old-image（churn=fail，仅存档）',
    ],
    artifacts: ['cmd.log'],
  }))
}

/* ---------------------------------------------- 汇总 */

const summary = summaryOf(rows, {
  suite,
  env: {
    commit: gitHead(),
    imageTag: LANE.imageTag,
    imageId: LANE.imageId,
    container: LANE.container,
    base: LANE.base,
    dataRoot: LANE.dataRoot,
    startedAt,
    halted: false,
    haltReason: '',
  },
})
summary.laneScope = {
  e1Cases: ['RC5-TERM-001', 'RC5-TERM-004', 'RC5-TERM-007', 'RC5-TERM-009', 'RC5-TERM-010', 'RC5-TERM-012', 'RC5-TERM-013', 'RC5-TERM-014'],
  e2Cases: ['RC5-TERM-002', 'RC5-TERM-003', 'RC5-TERM-005', 'RC5-TERM-006', 'RC5-TERM-008', 'RC5-TERM-011'],
  note: 'E2 lane 的行见 artifacts/rc5/E2/TERM/summary.json；验收矩阵按两 lane 并集计 14 条',
}
writeSummary(suite, summary)
console.log(`[TERM] PASS=${summary.pass} FAIL=${summary.fail} SKIP=${summary.skip} NOTRUN=${summary.notrun}`)