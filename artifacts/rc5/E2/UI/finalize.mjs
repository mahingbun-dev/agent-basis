#!/usr/bin/env node
/**
 * E2 · UI 收尾：把 UI-006（双主题 × 三视口截图）落成证据，并合并 7 条静态用例的 summary。
 *
 * UI-006 判定 = FAIL（P0 用例未满足全部面）：
 *   1) chat-import 面截不到：`sidebar.session.action` 槽位在，但动作组件被
 *      useRemoteAccess('deepseekChatImport/limits') 门控；该 action 不在 mux
 *      GLOBAL_UNARY_ACTIONS → 浏览器 peer 无授权快照 → 按钮不渲染（6/6 组合 0 个入口）。
 *      对照：同 cookie 直接 POST /api/deepseekChatImport/limits 返回 200（owner peer），
 *      说明「API 活着、Web 入口不渲染」。
 *   2) terminal 面 5/6 组合呈「终端错误：session.snapshotEvents is not a function」
 *      （上游 create 的 P1，非布局问题）。
 *   3) 390 视口浮层提示「第 1/2 项·点击切换」压住第 4 个流程 chip（视觉遮挡；
 *      文档无横向溢出：scrollWidth=innerWidth=390）。
 */
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { Case, STATUS, summaryOf, writeSummary } from '../_lib/evidence.mjs'
import { LANE, gitHead } from '../_lib/env.mjs'

const suite = 'UI'
const dir = join(LANE.evidenceRoot, 'UI')
const prior = JSON.parse(readFileSync(join(dir, 'summary.json'), 'utf8'))
const observations = JSON.parse(readFileSync(join(dir, 'RC5-UI-006', 'observations.json'), 'utf8'))
const combos = observations.filter(row => row.hero !== undefined)
const probes = observations.filter(row => row.importLimitsProbe !== undefined)

const c = new Case(suite, 'RC5-UI-006')
c.cmd('node artifacts/rc5/E2/UI/ui-shot.mjs', 0,
  combos.map(row => `${row.theme}/${row.width}: hero_ov=${row.hero.overflow} mcp_open=${row.mcp.dialogOpen} terminal_tab=${JSON.stringify(row.terminal.tabs)} import_hits=${row.chatImport.entry.hits} lum=${row.hero.luminance}`).join('\n'))
for (const probe of probes) {
  c.cmd(`POST /api/deepseekChatImport/limits（浏览器 cookie，${probe.theme}）`, probe.importLimitsProbe.status, probe.importLimitsProbe.body)
}

const themeOk = combos.every(row => row.theme === 'light' ? row.hero.luminance > 180 && row.mcp.luminance > 180 : row.hero.luminance < 80 && row.mcp.luminance < 80)
const noOverflow = combos.every(row => row.hero.overflow === false && row.mcp.overflow === false && row.terminal.overflow === false && row.chatImport.overflow === false)
const mcpOpen = combos.every(row => row.mcp.dialogOpen === true)
const terminalShots = combos.filter(row => row.terminal.tabs.includes('终端')).length
const importEntries = combos.reduce((total, row) => total + row.chatImport.entry.hits, 0)
const slots = combos.every(row => row.chatImport.entry.slotPresent === true)

c.assert('双主题生效（浅色亮度>180 / 深色<80）', themeOk, combos.map(row => `${row.theme}:${row.hero.luminance}`).join(' '))
c.assert('6 组合均无文档横向溢出', noOverflow)
c.assert('6 组合 MCP 设置分区可开', mcpOpen)
c.assert('terminal 面板截图 6 组合中 5 组为终端页（其余 1 组为开始页）', terminalShots === 5, `terminal_tab=${terminalShots}/6`)
c.assert('chat-import 入口按钮 0 个（6 组合）', importEntries === 0, `hits=${importEntries}`)
c.assert('chat-import 槽位存在（不是插槽缺失）', slots)

const screenshots = combos.flatMap(row => ['hero', 'mcp', 'terminal', 'chatImport'].map(key => `RC5-UI-006/${row[key].file}`))
c.note(`截图 24 张：${screenshots.join(', ')}`)
c.note('终端面错误文案来自上游 `session.snapshotEvents is not a function`（TERM-006 同根因 P1）')
c.note('chat-import：槽位在、按钮不渲染；同 cookie 直连 API 200 → 判定为 mux 授权快照缺 action 导致的 Web 入口缺失')

const row = c.finish({
  status: STATUS.FAIL,
  title: '双主题 × 三视口截图（MCP 设置 / terminal / hero / chat-import）',
  expected: '4 个面 × 深浅 2 主题 × 1440/900/390 三视口，每组合合格、无破面/溢出',
  actual: [
    `24 张截图产出；主题与横向溢出检查全绿（light 亮度 242 / dark 24.2；6/6 scrollWidth=innerWidth）`,
    `MCP 设置 6/6 可开；terminal 5/6 为终端页（均显示 P1 错误）；chat-import 6/6 无入口（hits=0）`,
    `390 hero：浮层提示「第 1/2 项·点击切换」压住第 4 个 chip（视觉遮挡，非横向溢出）`,
  ].join('；'),
  notes: [
    'chat-import 无法截图 = 该面缺入口（P1 Web 入口缺失），不是布局破面',
    'terminal 截图保留真实错误态，未修图',
  ],
  artifacts: ['observations.json', ...screenshots],
})

const rows = [...prior.cases, row]
const summary = summaryOf(rows, {
  suite, env: {
    commit: gitHead(), imageTag: LANE.imageTag, imageId: LANE.imageId, container: LANE.container,
    base: LANE.base, dataRoot: LANE.dataRoot, startedAt: prior.startedAt,
  },
})
summary.observations = 'artifacts/rc5/E2/UI/RC5-UI-006/observations.json'
summary.screenshots = screenshots.length
writeSummary(suite, summary)
console.log(`[UI] PASS=${summary.pass} FAIL=${summary.fail} SKIP=${summary.skip} NOTRUN=${summary.notrun}`)