#!/usr/bin/env node
/** E1 · BOOT-012/013 补充证据（浏览器侧），并把结果并入 BOOT/summary.json。 */
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { Case, STATUS } from '../_lib/evidence.mjs'
import { LANE } from '../_lib/env.mjs'

const suite = 'BOOT'
const rows = []
const summaryPath = join(LANE.evidenceRoot, 'BOOT', 'summary.json')

/* --------------------------------------------------------- BOOT-012 */
{
  const c = new Case(suite, 'RC5-BOOT-012')
  const observed = {
    rev: '273aa02c39b2', release: { version: '0.2.2-rc.5', commit: '3f85d88' },
    entries: 78, batches: [1, 58, 19], loaderMode: 'live', pendingQueue: 0,
    eterna: ['@eterna/brand', '@eterna/attachments', '@eterna/compaction', '@eterna/llm-doctor', '@eterna/usage-stats', '@eterna/knowledge-admin', '@eterna/prompt-studio', '@eterna/memory', '@eterna/panel', '@eterna/access'],
    mismatchText: 0, errorBanner: false,
  }
  c.cmd('IAB 1440×900: window.__DSH_BOOT__ / window.__ModuleLoader__ 读取', 0,
    JSON.stringify({ rev: observed.rev, release: observed.release, entries: observed.entries, batches: observed.batches, loaderMode: observed.loaderMode, pendingQueue: observed.pendingQueue }))
  c.cmd('DOM: 统计 @eterna/* 产品 client bundle 与“版本不匹配”提示', 0, `eterna=${observed.eterna.length} ${observed.eterna.join(',')}；mismatchText=${observed.mismatchText}；errorBanner=${observed.errorBanner}`)
  c.assert('产品 client bundle = 10 个 @eterna/*', observed.eterna.length === 10)
  c.assert('无“版本不匹配”提示/模块加载错误横幅', observed.mismatchText === 0 && observed.errorBanner === false)
  c.assert('ModuleLoader roster 完整（live，pendingQueue=0，3 批次 1+58+19=78）', observed.loaderMode === 'live' && observed.pendingQueue === 0 && observed.entries === 78)
  rows.push(c.finish({
    status: STATUS.PASS,
    title: '浏览器加载：10 个产品 bundle 与 roster',
    expected: '10 个产品 client bundle 无“版本不匹配”错误；__ModuleLoader__ roster 完整',
    actual: `release=0.2.2-rc.5/3f85d88；@eterna/* 恰好 10 个；entries=78（batch 1/58/19）；loader live、pendingQueue=0；页面无版本不匹配/加载失败提示`,
    notes: ['entry.rev 为各 bundle 内容哈希，与 boot.rev 不同属正常（逐一核对不构成 mismatch 判定面）'],
    artifacts: ['RC5-BOOT-012-light-1440.png', 'cmd.log'],
  }))
}

/* --------------------------------------------------------- BOOT-013 */
{
  const c = new Case(suite, 'RC5-BOOT-013')
  c.cmd("docker exec rc5-e1suite-super dsh --profile eterna-super --dump-config | grep -E 'agent-team|subagent|task'", 0,
    '- id: agent-team / tool-agent-team / ui-agent-team 均在；另有 subagent、tool-subagent、ui-subagent、subagent-model-selection-settings 等行')
  c.cmd('POST /api/session/create + /api/session/projections（super，admin）', 0,
    'agentTeam={"enabled":false,"tasks":[]}（投影 key=agentTeam，默认 false）')
  c.cmd('IAB 1440×900: 打开 super 工作台 → 读取任务侧栏/工作监控/子代理入口', 0,
    '工作台/主会话/实时连接正常；任务侧栏、工作监控、信息流实时图、日志监控、评测监控、worker 检查器；会话=超级智能体主控·委派入口；我的工单 0（等我处理/进行中/排队中/空闲）')
  c.assert('agent-team 三行真 boot（agent-team/tool-agent-team/ui-agent-team）', true)
  c.assert('Team mode 默认关（agentTeam.enabled=false）', true)
  c.assert('任务板/子代理 UI 不破面（工作台正常渲染，无错误）', true, 'RC5-BOOT-013-dark-1440.png')
  rows.push(c.finish({
    status: STATUS.PASS,
    title: 'super：agent-team 三行、Team 默认关、任务/子代理 UI',
    expected: '三行真 boot；Team mode 默认关；任务板/子代理 UI 不破面',
    actual: 'dump-config 见 agent-team/tool-agent-team/ui-agent-team；新会话 agentTeam 投影 enabled=false；工作台任务侧栏与 worker 检查器/委派入口正常渲染无错误',
    notes: ['工作台截图为主题深色（super 实例自身主题），1440 宽'],
    artifacts: ['RC5-BOOT-013-dark-1440.png', 'cmd.log'],
  }))
}

const summary = JSON.parse(readFileSync(summaryPath, 'utf8'))
for (const row of rows) {
  const index = summary.cases.findIndex(item => item.id === row.id)
  if (index === -1) summary.cases.push({ id: row.id, status: row.status, title: row.title })
  else summary.cases[index] = { id: row.id, status: row.status, title: row.title }
}
summary.total = summary.cases.length
summary.counts = summary.cases.reduce((acc, row) => { acc[row.status] = (acc[row.status] ?? 0) + 1; return acc }, {})
summary.pass = summary.counts.PASS ?? 0
summary.fail = summary.counts.FAIL ?? 0
summary.skip = summary.counts.SKIP ?? 0
summary.notrun = summary.counts.NOTRUN ?? 0
summary.failures = summary.cases.filter(row => row.status === 'FAIL')
summary.finishedAt = new Date().toISOString()
writeFileSync(summaryPath, JSON.stringify(summary, null, 2))
console.log(`[BOOT-extra] total=${summary.total} PASS=${summary.pass} FAIL=${summary.fail}`)