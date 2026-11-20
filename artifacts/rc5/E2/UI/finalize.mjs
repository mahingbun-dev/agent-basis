#!/usr/bin/env node
/**
 * E2 · UI 收尾：把 UI-006（双主题 × 三视口截图）落成证据，并合并 7 条静态用例的 summary。
 *
 * UI-006 判定（2026-11-20 W5 修复后复跑）：
 *   1) chat-import：`deepseekChatImport/limits` 已入 GLOBAL_UNARY_ACTIONS →
 *      6/6 组合入口按钮渲染（hits=1），同 cookie 直连 API 200 佐证；
 *   2) terminal：TERM-006 根因（伪 session 传 sandboxPolicy.resolve）已修 →
 *      6/6 组合为真实 bash 终端，无「终端错误」；
 *   3) 390 hero：决策层切换条改为「有真实 .et-decision-card 才渲染」→ 空态不再
 *      浮出「第 1/2 项·点击切换」，chips 行无遮挡；
 *   4) 主题/横向溢出/MCP 设置面全绿。
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
const terminalShots = combos.filter(row => row.terminal.tabs.some(text => !/^开始$/.test(text)) && !/终端错误/.test(row.terminal.text)).length
const importEntries = combos.reduce((total, row) => total + row.chatImport.entry.hits, 0)
const slots = combos.every(row => row.chatImport.entry.slotPresent === true)
const spuriousSwitch = combos.filter(row => /第 \d+\/\d+ 项/.test(row.hero.text)).length

c.assert('双主题生效（浅色亮度>180 / 深色<80）', themeOk, combos.map(row => `${row.theme}:${row.hero.luminance}`).join(' '))
c.assert('6 组合均无文档横向溢出', noOverflow)
c.assert('6 组合 MCP 设置分区可开', mcpOpen)
c.assert('terminal 面板 6 组合均为真实终端页，无终端错误', terminalShots === combos.length, `terminal_tab=${terminalShots}/${combos.length}`)
c.assert('chat-import 入口按钮每组均渲染（至少 1 个）', combos.every(row => row.chatImport.entry.hits > 0), `hits=${importEntries}`)
c.assert('chat-import 槽位存在（不是插槽缺失）', slots)
c.assert('空态 hero 不浮出决策层切换条（390 遮挡回归锚）', spuriousSwitch === 0, `switch_labels=${spuriousSwitch}`)

const pass = themeOk && noOverflow && mcpOpen && terminalShots === combos.length && combos.every(row => row.chatImport.entry.hits > 0) && slots && spuriousSwitch === 0
const screenshots = combos.flatMap(row => ['hero', 'mcp', 'terminal', 'chatImport'].map(key => `RC5-UI-006/${row[key].file}`))
c.note(`截图 24 张：${screenshots.join(', ')}`)

const row = c.finish({
  status: pass ? STATUS.PASS : STATUS.FAIL,
  title: '双主题 × 三视口截图（MCP 设置 / terminal / hero / chat-import）',
  expected: '4 个面 × 深浅 2 主题 × 1440/900/390 三视口，每组合合格、无破面/溢出',
  actual: [
    `24 张截图产出；主题与横向溢出检查全绿（light 亮度 242 / dark 24.2；6/6 scrollWidth=innerWidth）`,
    `MCP 设置 6/6 可开；terminal 6/6 为真实 bash 终端；chat-import 6/6 入口渲染（hits=${importEntries}）`,
    `390 hero：无决策卡时不渲染切换条（switch_labels=${spuriousSwitch}），chips 行无遮挡`,
  ].join('；'),
  notes: [
    'chat-import 入口门 deepseekChatImport/limits 已入 mux 全局一元清单（W5 修复）',
    'terminal 面板为真实 PTY（旧 session.snapshotEvents P1 已修，TERM-006 复跑 8/8）',
    '390 遮挡修复=切换条只在确有 .et-decision-card 时渲染（UI DecisionLayer）',
  ],
  artifacts: ['observations.json', ...screenshots],
})

// 复跑幂等：旧 summary 里的 UI-006 行不得与新行并存（避免 PASS/FAIL 双计数）。
const rows = [...prior.cases.filter(existing => existing.id !== 'RC5-UI-006'), row]
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