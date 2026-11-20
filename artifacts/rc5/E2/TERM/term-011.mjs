#!/usr/bin/env node
/**
 * E2 · RC5-TERM-011：rename/retain 后刷新 —— 名称与保留状态持久。
 *
 * rc.5 实测边界：刷新（重开页）时客户端只恢复 origin=agent 且 state=running
 * 的终端；用户自建终端的 TerminalRecovery 在上游 dsh rc.5 被注释掉（无恢复）。
 * 所以判定点落在 Agent 起源终端（TERM-002 同款真实回合路径）：
 *   1) 页面读「当前显示会话」→ 确定性假模型跑一回合 terminal_open，建出 Agent 终端；
 *   2) terminal/rename 改名（产品 unary API）；
 *   3) 同 context 重开页 = 刷新语义：Agent 终端 tab 自动重开，名称应为新名，
 *      xterm 挂载、terminal/list 的 title 一致；
 *   4) 二次重开复验，排除一次性内存态。
 *
 * 依赖：fake-llm-server 在 4599（ensureFakeRoute 自行写入/收尾恢复）。
 * 用法：node artifacts/rc5/E2/TERM/term-011.mjs
 */
import { createRequire } from 'node:module'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { Case, STATUS, shape } from '../_lib/evidence.mjs'
import { LANE, call, sessions, sleep } from '../_lib/env.mjs'
import { cleanupFakeRoute, ensureFakeRoute, promptTurn } from '../LLM/lib.mjs'

const req = createRequire(join(LANE.repoRoot, 'packages/browser-relay/package.json'))
const { chromium } = req('playwright-core')

const s = await sessions()
const admin = s.admin
const token = Date.now().toString(36)
const renamed = `rc5-renamed-${token}`

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
let page = await context.newPage()
page.setDefaultTimeout(25_000)

/** 刷新语义 = 同 context 新开一页重进应用（避免 beforeunload 对话框卡住 reload）。 */
async function bootFreshPage() {
  await page.close().catch(() => undefined)
  page = await context.newPage()
  page.setDefaultTimeout(25_000)
  await page.goto(LANE.base + '/', { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('[data-composer-input]', { timeout: 30_000 })
  await page.waitForTimeout(2500)
}

const c = new Case('TERM', 'RC5-TERM-011')
let sessionId
let terminalId
let agentOrigin = false
let created = false
let renamedOk = false
let firstTitle = false
let secondTitle = false
let firstXterm = false
let secondXterm = false
let listTitle = false

const sidebarSession = async () =>
  page.evaluate(() => document.querySelector('[data-sidebar-right-session]')?.getAttribute('data-sidebar-right-session') ?? null)
const sidebarText = async () =>
  page.evaluate(() => (document.querySelector('[data-sidebar-right-panel]')?.innerText ?? '').replace(/\s+/g, ' '))
const xtermCount = async () => page.locator('.xterm-helper-textarea').count()

async function expandSidebar() {
  for (const selector of ['[data-sidebar-right-expand]', '[data-sidebar-right-toggle]']) {
    const button = page.locator(selector).first()
    if ((await button.count()) > 0) {
      await button.click({ force: true }).catch(() => {})
      await page.waitForTimeout(700)
      return
    }
  }
  await page.waitForTimeout(300)
}

/** 展开侧栏并等 tab 名称出现（Agent 终端自动开 tab 有异步段）。 */
async function waitTabTitle(timeoutMs = 30_000) {
  const t0 = Date.now()
  for (;;) {
    if ((await sidebarText()).includes(renamed)) return true
    await expandSidebar()
    if (Date.now() - t0 > timeoutMs) return (await sidebarText()).includes(renamed)
    await sleep(800)
  }
}

async function listTerminals() {
  const listed = await call(admin.cookie, 'terminal/list', { sessionId }, { timeoutMs: 20_000 })
  return { ok: listed.ok === true, items: listed.value ?? [] }
}

try {
  await page.goto(LANE.base + '/', { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('[data-composer-input]', { timeout: 30_000 })
  await page.waitForTimeout(2500)
  if ((await sidebarSession()) === null) await expandSidebar()
  sessionId = await sidebarSession()
  if (sessionId === null) throw new Error('页面未显示会话（缺 [data-sidebar-right-session]）')
  const beforeIds = (await listTerminals()).items.map(item => item.id)

  // 1) 真实模型回合（确定性假模型）→ Agent 起源终端
  await ensureFakeRoute(admin.cookie)
  await promptTurn(admin.cookie, sessionId,
    '@@SEQ 1\nTERM-011：请打开一个终端用于刷新恢复验证\n@@CALL name=terminal_open args={"type":"shell"}')
  let createdItem
  const deadline = Date.now() + 90_000
  for (;;) {
    const listed = await listTerminals()
    createdItem = listed.items.find(item => !beforeIds.includes(item.id) && item.state === 'running')
    if (createdItem !== undefined) break
    if (Date.now() > deadline) break
    await sleep(1_000)
  }
  terminalId = createdItem?.id
  agentOrigin = createdItem?.origin === 'agent'
  created = terminalId !== undefined && createdItem.state === 'running'
  c.cmd('回合 terminal_open 建出 Agent 终端', created ? 200 : 500,
    `session=${sessionId} terminal=${terminalId ?? 'none'} origin=${createdItem?.origin ?? 'none'} state=${createdItem?.state ?? 'none'}`)
  if (!created) throw new Error('回合未建出 running 终端（假模型路由或 terminal 工具不可用）')

  // 2) rename（unary API；Agent 起源终端可改名）
  const rename = await call(admin.cookie, 'terminal/rename', {
    agentId: sessionId, id: terminalId, title: renamed,
  }, { timeoutMs: 20_000 })
  renamedOk = rename.ok === true
  c.cmd('POST /api/terminal/rename', renamedOk ? 200 : 500,
    `terminal=${terminalId} title=${renamed} error=${renamedOk ? 'none' : JSON.stringify(rename.error)}`)

  // 3) 首次重开页：Agent 终端 tab 自动重开，名称应为新名且 xterm 挂载
  await bootFreshPage()
  firstTitle = await waitTabTitle()
  firstXterm = (await xtermCount()) > 0
  if (!firstXterm && firstTitle) {
    // tab 打开了但面板未展开：再展开一轮
    await expandSidebar()
    firstXterm = (await xtermCount()) > 0
  }
  const listedAfterFirst = await listTerminals()
  listTitle = listedAfterFirst.items.some(item => item.id === terminalId && item.title === renamed)
  c.cmd('重开页：tab 名称 / xterm / terminal-list title', firstTitle && firstXterm && listTitle ? 200 : 500,
    `same_session=${(await sidebarSession()) === sessionId} tab_title=${firstTitle} xterm=${firstXterm} list_title=${listTitle}`)

  // 4) 二次重开复验（排除一次性内存态）
  await bootFreshPage()
  secondTitle = await waitTabTitle()
  secondXterm = (await xtermCount()) > 0
  if (!secondXterm && secondTitle) {
    await expandSidebar()
    secondXterm = (await xtermCount()) > 0
  }
  const screen = await sidebarText()
  c.cmd('二次重开页：tab 名称 / xterm', secondTitle && secondXterm ? 200 : 500,
    `tab_title=${secondTitle} xterm=${secondXterm} screen=${shape(screen.slice(-120), 120)}`)

  c.assert('回合建出 Agent 起源 running 终端', created && agentOrigin,
    `origin=${createdItem?.origin ?? 'none'} state=${createdItem?.state ?? 'none'}`)
  c.assert('terminal/rename 成功', renamedOk, `title=${renamed}`)
  c.assert('重开页后 tab 名称保持 rename 值', firstTitle && secondTitle, `first=${firstTitle} second=${secondTitle}`)
  c.assert('重开页后 Agent 终端仍存活（xterm 挂载、Host 保留）', firstXterm && secondXterm, `first=${firstXterm} second=${secondXterm}`)
  c.assert('terminal/list 的 title 与 rename 一致', listTitle, `items=${listedAfterFirst.items.map(item => `${item.id}:${item.title}`).join(',')}`)

  const ok = created && agentOrigin && renamedOk && firstTitle && secondTitle && firstXterm && secondXterm && listTitle
  const result = c.finish({
    status: ok ? STATUS.PASS : STATUS.FAIL,
    title: 'Agent 终端 rename 后重开页：名称与保留状态持久',
    expected: 'terminal/rename 之后重开页，Agent 终端 tab 自动重开且名称是新名、xterm 可交互、terminal/list 一致',
    actual: `created=${created} origin=${agentOrigin} rename=${renamedOk} first=${firstTitle}/${firstXterm} second=${secondTitle}/${secondXterm} list_title=${listTitle}`,
    notes: [
      '刷新 = 同 context 重开页（等价 F5 重进应用；reload 会被 beforeunload 卡住）',
      'rc.5 上游 TerminalRecovery 被注释：用户自建终端不回开，归属 TERM-010 的缺口记录；本用例判定 Agent 终端 retained 恢复',
      '终端由真实模型回合建出（假模型只决定工具名，PTY/xterm/recovery 全走产品代码）',
    ],
    artifacts: ['cmd.log'],
  })
  writeFileSync(join(LANE.evidenceRoot, 'TERM', 'term-011-result.json'), JSON.stringify(result, null, 2))
  console.log(`[TERM-011] ${result.status}`)
} catch (error) {
  c.note(`执行异常：${String(error?.message ?? error).slice(0, 300)}`)
  const result = c.finish({
    status: STATUS.FAIL,
    title: 'Agent 终端 rename 后重开页：名称与保留状态持久',
    expected: 'rename 后重开页，Agent 终端 tab 自动重开且名称/存活状态保持',
    actual: `异常：${String(error?.message ?? error).slice(0, 200)}`,
    artifacts: ['cmd.log'],
  })
  writeFileSync(join(LANE.evidenceRoot, 'TERM', 'term-011-result.json'), JSON.stringify(result, null, 2))
  console.log(`[TERM-011] ${result.status}`)
} finally {
  if (terminalId !== undefined && sessionId !== null) {
    await call(admin.cookie, 'terminal/close', { agentId: sessionId, id: terminalId }, { timeoutMs: 20_000 }).catch(() => undefined)
  }
  await context.close()
  await browser.close()
  await cleanupFakeRoute(admin.cookie).catch(() => undefined)
}