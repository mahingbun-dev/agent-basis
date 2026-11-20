#!/usr/bin/env node
/**
 * E2 · RC5-TERM-002：侧栏 terminal 面板「人接管」实测（全 UI 驱动）。
 *
 * 语义（dsh rc.5）：Agent 打开的终端 origin=agent、control=agent；用户在侧栏
 * 首次输入 → control 切到 user，Agent 之后的 send/signal 一律 `user-control`
 * （The user has taken over this terminal）。
 *
 * 步骤（脚本不替用户建会话，走真实聊天入口）：
 *   1) 聊天框发送 terminal_open 回合 → Agent 起源终端，侧栏自动开 tab；
 *   2) xterm 获焦键入 `printf rc5-user-typed`，断言屏幕可见回显（人可输入）；
 *   3) 聊天框发送 terminal_send（$LAST_ID 指向上一步终端）→ 断言 user-control
 *      拒绝、且 Agent 的文本没有落进终端。
 *
 * 依赖：fake-llm-server 在 4599（ensureFakeRoute 自行写入/收尾恢复）。
 * 用法：node artifacts/rc5/E2/LLM/term-002.mjs
 */
import { createRequire } from 'node:module'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { Case, STATUS, shape } from '../_lib/evidence.mjs'
import { LANE, call, sessions } from '../_lib/env.mjs'
import { ensureFakeRoute, logMark, logSince, sleep } from './lib.mjs'

const req = createRequire(join(LANE.repoRoot, 'packages/browser-relay/package.json'))
const { chromium } = req('playwright-core')

const s = await sessions()
const admin = s.admin
await ensureFakeRoute(admin.cookie)

const browser = await chromium.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: true,
  args: ['--no-first-run', '--no-default-browser-check'],
})
const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: 'light' })
await context.addCookies(`${s.dsh}; ${admin.cookie}`.split(';').map(part => part.trim()).filter(Boolean).map(part => {
  const index = part.indexOf('=')
  return { name: part.slice(0, index), value: part.slice(index + 1), url: LANE.base }
}))
const page = await context.newPage()
page.setDefaultTimeout(25_000)

const c = new Case('LLM', 'RC5-TERM-002')
let sessionId
let terminalId
let typedOk = false
let openOk = false
let takeoverText = ''
let agentLeaked = false

const panelText = async () =>
  page.evaluate(() => (document.querySelector('[data-sidebar-right-panel]')?.innerText ?? '').replace(/\s+/g, ' '))
const sidebarSession = async () =>
  page.evaluate(() => document.querySelector('[data-sidebar-right-session]')?.getAttribute('data-sidebar-right-session') ?? null)

/** 聊天框多行标记：Enter=发送，Shift+Enter=换行。 */
async function composerSend(text) {
  const input = page.locator('[data-composer-input]').first()
  await input.click()
  const lines = text.split('\n')
  for (let index = 0; index < lines.length; index += 1) {
    if (index > 0) await page.keyboard.press('Shift+Enter')
    await page.keyboard.type(lines[index], { delay: 5 })
  }
  await page.keyboard.press('Enter')
}

try {
  await page.goto(LANE.base + '/', { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('[data-composer-input]', { timeout: 30_000 })
  await page.waitForTimeout(2500)

  // 1) 聊天入口发 terminal_open 回合（会话由客户端按首条消息建立/复用）
  const mark = logMark()
  await composerSend('@@SEQ 1\nTERM-002：请先打开一个终端\n@@CALL name=terminal_open args={"type":"shell"}')
  // 右侧栏展开：Agent 起源终端的 tab 落在这里
  for (let attempt = 0; attempt < 15; attempt += 1) {
    if ((await page.locator('.xterm-helper-textarea').count()) > 0) break
    await page.locator('[data-sidebar-right-expand]').first().click({ force: true }).catch(() => {})
    await page.waitForTimeout(1000)
  }
  const openLogs = logSince(mark)
  openOk = openLogs.some(row => (row.toolResultTexts ?? []).some(text => /started terminal session/.test(text)))
  sessionId = await sidebarSession()
  const listed = sessionId === null ? { value: [] } : await call(admin.cookie, 'terminal/list', { sessionId }, { timeoutMs: 20_000 })
  terminalId = (listed.value ?? [])[0]?.id
  c.cmd('UI：聊天框发送 terminal_open 回合', openOk ? 200 : 500,
    `session=${sessionId ?? 'none'} terminal=${terminalId ?? 'none'}`)

  // 2) xterm 获焦键入（第一次输入即人接管）
  const textarea = page.locator('.xterm-helper-textarea').first()
  if ((await textarea.count()) === 0) throw new Error('侧栏未出现 xterm（Agent 终端 tab 未挂载）')
  await textarea.click({ force: true }).catch(() => {})
  await textarea.evaluate(element => element.focus())
  await page.waitForTimeout(300)
  await page.keyboard.type('printf rc5-user-typed', { delay: 25 })
  await page.keyboard.press('Enter')
  await page.waitForTimeout(2500)
  const screenAfterTyping = await panelText()
  typedOk = screenAfterTyping.includes('rc5-user-typed')
  c.cmd('UI：xterm 键入 printf rc5-user-typed', typedOk ? 200 : 500, shape(screenAfterTyping.slice(-300), 300))

  // 3) 接管后 Agent terminal_send → user-control 拒绝，输入不得落进终端
  if (typedOk) {
    const mark2 = logMark()
    await composerSend('@@SEQ 2\nTERM-002：用户已接管，Agent 只读\n'
      + '@@CALL name=terminal_send args={"sessionId":"$LAST_ID","text":"printf rc5-agent-typed"}')
    for (let i = 0; i < 120; i += 1) {
      await sleep(500)
      const rows = logSince(mark2)
      if (rows.some(row => (row.toolResultTexts ?? []).some(text => /taken over|user-control/i.test(text)))) break
    }
    takeoverText = logSince(mark2).flatMap(row => row.toolResultTexts ?? []).join('\n')
    await page.waitForTimeout(1500)
    agentLeaked = (await panelText()).includes('rc5-agent-typed')
    c.cmd('UI：聊天框发送 terminal_send（已接管）', /taken over|user-control/i.test(takeoverText) ? 200 : 500,
      `result=${shape(takeoverText, 220)} leaked=${agentLeaked}`)
  }
} catch (error) {
  c.note(`执行异常：${String(error?.message ?? error).slice(0, 300)}`)
}

// 清理：关掉测试终端（用户接管后 Agent 侧 close 可能被拒；失败不掩盖结论）
if (sessionId !== null && sessionId !== undefined) {
  const listed = await call(admin.cookie, 'terminal/list', { sessionId }, { timeoutMs: 20_000 }).catch(() => ({ value: [] }))
  for (const item of listed.value ?? []) {
    await call(admin.cookie, 'terminal/close', { agentId: sessionId, id: item.id }, { timeoutMs: 20_000 }).catch(() => undefined)
  }
}
await context.close()
await browser.close()
try {
  const { cleanupFakeRoute } = await import('./lib.mjs')
  await cleanupFakeRoute(admin.cookie)
} catch {
  // 收尾失败只影响下一轮起点；证据已落盘
}

const readOnlyDenied = /taken over|user-control/i.test(takeoverText)
const pass = openOk && typedOk && readOnlyDenied && !agentLeaked
c.assert('Agent terminal_open 建出终端且侧栏自动开 tab', openOk, `terminalId=${terminalId ?? 'none'}`)
c.assert('人能键入并在屏幕看到输出（首次输入即接管）', typedOk, '')
c.assert('接管后 Agent terminal_send 被 user-control 拒绝', readOnlyDenied, shape(takeoverText, 200))
c.assert('Agent 输入未写进用户终端', !agentLeaked, '')
const row = c.finish({
  status: pass ? STATUS.PASS : STATUS.FAIL,
  title: '侧栏 terminal 面板可见/可开/可输入；首次按键人接管后 Agent 只读',
  expected: 'Agent 开终端 → 用户在侧栏键入即接管；之后 Agent send 被 user-control 拒绝且输入不入终端',
  actual: `open=${openOk} typed=${typedOk} takeover=${readOnlyDenied} agent_leaked=${agentLeaked}`,
  notes: [
    '浏览器为 Playwright + 本机 Chrome（headless），cookie 注入不走登录页',
    '两回合均由聊天框真实发送；确定性假模型只决定 terminal_open / terminal_send 调什么，PTY/xterm/接管判定全走产品代码',
  ],
  artifacts: ['cmd.log'],
})
writeFileSync(join(LANE.evidenceRoot, 'LLM', 'term-002-result.json'), JSON.stringify(row, null, 2))
console.log(`[TERM-002] ${row.status}`)