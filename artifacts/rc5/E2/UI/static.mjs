#!/usr/bin/env node
/**
 * E2 · UI 静态用例（51 §3.10：UI-001..005/007/008）。
 *
 * UI-001 跑仓库门禁 `node scripts/lint-ui-tokens.mjs`（全 packages/* 扫描面）。
 * UI-002/003/004/005/007/008 跑本目录 _suite/ui-scan.mjs（与 E0 静态 lane 同源
 * 扫描器，scope = feat/dsh-rc5-merge 新增/改动的 17 个 UI 文件），逐条落证据。
 * UI-006（双主题 × 三视口截图）由 ui-shot.mjs 另行执行。
 */
import { Case, STATUS, summaryOf, writeSummary } from '../_lib/evidence.mjs'
import { LANE, run, gitHead } from '../_lib/env.mjs'
import { join } from 'node:path'

const suite = 'UI'
const startedAt = new Date().toISOString()
const rows = []

function record(c, status, title, expected, actual, notes = []) {
  rows.push(c.finish({ status, title, expected, actual, notes, artifacts: ['cmd.log'] }))
}

/* ---------------------------------------------------------------- UI-001 */

{
  const c = new Case(suite, 'RC5-UI-001')
  const result = run('node', ['scripts/lint-ui-tokens.mjs'], { timeout: 300_000 })
  c.cmd('node scripts/lint-ui-tokens.mjs', result.exit, result.stdout, result.stderr)
  const pass = result.exit === 0 && /UI 令牌检查通过/.test(result.stdout)
  c.assert('lint-ui-tokens 退出 0 且输出“UI 令牌检查通过”', pass)
  record(c, pass ? STATUS.PASS : STATUS.FAIL,
    'UI 令牌门禁 0 违规（新包全覆盖）',
    'node scripts/lint-ui-tokens.mjs 退出 0',
    result.stdout.split('\n').slice(-1)[0] ?? `EXIT=${result.exit}`)
}

/* ------------------------------------------------ UI-002/003/004/005/007/008 */

const staticCases = [
  ['RC5-UI-002', '圆角只用 8/12/16/22/28/36/pill；嵌套同心', '新增 UI 无阶梯外圆角字面值'],
  ['RC5-UI-003', 'font-weight 只有 400/500/600；正文无 500', '新增 UI 无规范外字重'],
  ['RC5-UI-004', '图标走 @eterna/ui/icons 或 icon-data，无 emoji/手写 SVG', '0 emoji / 0 上游图标 / 有 @eterna/ui 图标引用'],
  ['RC5-UI-005', '断点只有 1100/760/640', '0 处断点越界'],
  ['RC5-UI-007', 'MCP 作为 settings.section；无独立页面入口', '注册 settings.section；routes.ts 无 MCP 页面路由'],
  ['RC5-UI-008', 'z-index 只允许 1/40/100/200/1000/1100/1500（hero -1 例外）', '0 处越界；决策/toast/通知不同区'],
]

for (const [id, title, expected] of staticCases) {
  const c = new Case(suite, id)
  const caseId = id.replace('RC5-', '')
  const result = run('node', [join(LANE.evidenceRoot, 'UI', '_suite', 'ui-scan.mjs'), caseId], { timeout: 120_000 })
  c.cmd(`node artifacts/rc5/E2/UI/_suite/ui-scan.mjs ${caseId}`, result.exit, result.stdout, result.stderr)
  c.assert(`${caseId} 扫描退出 0`, result.exit === 0)
  const summaryLine = result.stdout.split('\n').find(line => line.startsWith('SUMMARY')) ?? `EXIT=${result.exit}`
  record(c, result.exit === 0 ? STATUS.PASS : STATUS.FAIL, title, expected, summaryLine.replace(/^SUMMARY\s*/, ''), [
    '扫描器与 E0 静态 lane 同源（复制进本 lane），scope=feat/dsh-rc5-merge 新增/改动的 17 个 UI 文件',
  ])
}

const summary = summaryOf(rows, {
  suite, env: {
    commit: gitHead(), imageTag: LANE.imageTag, imageId: LANE.imageId, container: LANE.container,
    base: LANE.base, dataRoot: LANE.dataRoot, startedAt,
  },
})
writeSummary(suite, summary)
console.log(`[UI-static] PASS=${summary.pass} FAIL=${summary.fail} SKIP=${summary.skip} NOTRUN=${summary.notrun}`)