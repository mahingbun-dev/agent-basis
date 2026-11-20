#!/usr/bin/env node
/**
 * E2 · UI-006 双主题 × 三视口截图（MCP 设置 / terminal 面板 / hero / chat-import）。
 *
 * 方法学：
 *   - Playwright + 本机 Chrome（headless），cookie 由 scripts/rc5-test-client.mjs
 *     登录后注入（不在页面里打字、不截登录页、不落盘凭据）。
 *   - 主题：先用一个引导页在「偏好设置 → 外观」点 浅色/深色（该设置持久在服务端），
 *     随后新建 context 截图，页面内不再点主题（实测同页点主题后设置壳会失稳）。
 *     每张图读 documentElement 背景亮度复核主题确已生效。
 *   - 每张图记录 documentElement.scrollWidth/innerWidth 与面板 boundingBox，
 *     满足 scrollWidth ≤ innerWidth 且面板不出视口才算「无破面/溢出」。
 *   - terminal 面板用全局快捷键 ⌃` 打开（与「开始」页卡片同一入口）；当前上游
 *     create 缺陷会显示「终端错误：session.snapshotEvents is not a function」，
 *     截图如实保留该状态，不修图不伪造。
 *   - chat-import 入口由上游 `sidebar.session.action` 注入，但
 *     useRemoteAccess('deepseekChatImport/limits') 的 action 不在 mux 全局一元
 *     清单 → 实测按钮不渲染；本脚本记录该事实并截「入口缺失」现场。
 *
 * 用法：node artifacts/rc5/E2/UI/ui-shot.mjs [--only light:1440]
 */
import { createRequire } from 'node:module'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { LANE } from '../_lib/env.mjs'
import { bootTokenFromContainer, bootstrapDshSession, loadAccounts, login } from '../../../../scripts/rc5-test-client.mjs'

const req = createRequire(join(LANE.repoRoot, 'packages/browser-relay/package.json'))
const { chromium } = req('playwright-core')

const OUT = join(LANE.evidenceRoot, 'UI', 'RC5-UI-006')
mkdirSync(OUT, { recursive: true })

const only = (() => {
  const index = process.argv.indexOf('--only')
  return index === -1 ? undefined : process.argv[index + 1]
})()

const accounts = loadAccounts(LANE.accountsFile)
const dsh = await bootstrapDshSession(LANE.base, bootTokenFromContainer(LANE.container))
const auth = await login(LANE.base, accounts.admin.account, accounts.admin.password)
if (auth.status !== 200) throw new Error(`login=${auth.status}`)
const cookiePairs = `${dsh}; ${auth.cookie}`.split(';').map(part => part.trim()).filter(Boolean).map(part => {
  const index = part.indexOf('=')
  return { name: part.slice(0, index), value: part.slice(index + 1) }
})

const THEMES = ['light', 'dark']
const VIEWPORTS = [
  { width: 1440, height: 900 },
  { width: 900, height: 900 },
  { width: 390, height: 844 },
]

const browser = await chromium.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: true,
  args: ['--no-first-run', '--no-default-browser-check'],
})

const observations = []

async function newContext(viewport, colorScheme = 'light') {
  const context = await browser.newContext({ viewport, colorScheme, deviceScaleFactor: 1 })
  await context.addCookies(cookiePairs.map(cookie => ({ ...cookie, url: LANE.base })))
  const page = await context.newPage()
  page.setDefaultTimeout(20_000)
  await page.goto(LANE.base + '/', { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('[data-composer-input]', { timeout: 30_000 })
  await page.waitForTimeout(2500)
  return { context, page }
}

async function setTheme(theme) {
  const viewport = { width: 1440, height: 900 }
  const { context, page } = await newContext(viewport, theme)
  await page.getByRole('button', { name: '偏好设置' }).click()
  await page.waitForSelector('[role="dialog"]')
  await page.waitForTimeout(700)
  const label = theme === 'dark' ? '深色' : '浅色'
  await page.locator('[role="dialog"] button', { hasText: new RegExp(`^${label}$`) }).first().click()
  await page.waitForTimeout(800)
  const background = await page.evaluate(() => getComputedStyle(document.body).backgroundColor)
  await context.close()
  return background
}

function luminanceOf(rgb) {
  const match = String(rgb).match(/(\d+)[^\d]+(\d+)[^\d]+(\d+)/)
  if (match === null) return undefined
  const [r, g, b] = match.slice(1).map(Number)
  return Number((0.2126 * r + 0.7152 * g + 0.0722 * b).toFixed(1))
}

function themeOk(theme, luminance) {
  if (luminance === undefined) return false
  return theme === 'light' ? luminance > 180 : luminance < 80
}

async function measureLocator(locator, file, page) {
  const metrics = await locator.evaluate((el) => {
    const rect = el.getBoundingClientRect()
    return {
      innerWidth: window.innerWidth,
      innerHeight: window.innerHeight,
      scrollWidth: document.documentElement.scrollWidth,
      bodyBackground: getComputedStyle(document.body).backgroundColor,
      surface: { x: Math.round(rect.x), y: Math.round(rect.y), width: Math.round(rect.width), height: Math.round(rect.height), right: Math.round(rect.right), bottom: Math.round(rect.bottom) },
    }
  })
  const overflow = metrics.scrollWidth > metrics.innerWidth + 1
  const offscreen = metrics.surface.x < -1 || metrics.surface.right > metrics.innerWidth + 1
  await page.screenshot({ path: file, fullPage: false })
  return { file: file.split('/').slice(-1)[0], ...metrics, overflow, offscreen, luminance: luminanceOf(metrics.bodyBackground) }
}

function settingsDialog(page) {
  return page.locator('[role="dialog"]').filter({ hasText: /通用设置/ }).first()
}

async function measure(page, surfaceSelector, file) {
  return measureLocator(page.locator(surfaceSelector).first(), file, page)
}

async function ensureSidebar(page) {
  const settingsVisible = async () => page.locator('button[aria-label="偏好设置"]').evaluateAll(els => els.some(el => el.offsetWidth > 0)).catch(() => false)
  if (await settingsVisible()) return
  for (const selector of ['[data-sidebar-opener]', '[data-sidebar-toggle]']) {
    const locator = page.locator(selector).first()
    if (await locator.count() > 0) {
      await locator.click({ force: true }).catch(() => {})
      await page.waitForTimeout(1000)
      if (await settingsVisible()) return
    }
  }
}

async function domClick(page, selector) {
  return page.evaluate((sel) => {
    const el = document.querySelector(sel)
    if (el === null) return false
    el.click()
    return true
  }, selector)
}

async function hero(page, theme, width) {
  if (width >= 760) await ensureSidebar(page)
  const candidates = page.locator('button[aria-label="新建会话"]')
  let clicked = false
  for (let index = 0; index < await candidates.count(); index += 1) {
    const candidate = candidates.nth(index)
    if (await candidate.isVisible().catch(() => false)) {
      await candidate.click().catch(() => {})
      clicked = true
      break
    }
  }
  if (!clicked) clicked = await domClick(page, 'button[aria-label="新建会话"]')
  if (!clicked) await page.keyboard.press('Alt+Meta+N')
  await page.waitForTimeout(2500)
  const metrics = await measure(page, '[data-composer-seat]', join(OUT, `RC5-UI-006-${theme}-${width}-hero.png`))
  const text = await page.evaluate(() => (document.querySelector('[data-composer-seat]')?.innerText ?? '').replace(/\s+/g, ' ').slice(0, 160))
  return { ...metrics, text }
}

async function mcpSettings(page, theme, width) {
  if (width >= 760) await ensureSidebar(page)
  if (!(await domClick(page, 'button[aria-label="偏好设置"]'))) await page.getByRole('button', { name: '偏好设置' }).click()
  const dialog = settingsDialog(page)
  await dialog.waitFor({ timeout: 20_000 })
  await page.waitForTimeout(700)
  await dialog.locator('button', { hasText: /^MCP 服务器$/ }).first().click()
  await page.waitForTimeout(1200)
  const metrics = await measureLocator(dialog, join(OUT, `RC5-UI-006-${theme}-${width}-mcp-settings.png`), page)
  const text = (await dialog.innerText().catch(() => '')).replace(/\s+/g, ' ').slice(0, 240)
  const dialogOpen = await dialog.count() > 0
  await page.keyboard.press('Escape')
  await page.waitForTimeout(500)
  return { ...metrics, text, dialogOpen }
}

async function terminalPanel(page, theme, width) {
  // 右侧栏折叠时先展开：开始页有「新建终端」卡片；随后按全局快捷键 ⌃`
  if ((await page.evaluate(() => (document.querySelector('[data-sidebar-right-panel]')?.innerText ?? '').trim().length)) === 0) {
    const expand = page.locator('[data-sidebar-right-expand]').first()
    if (await expand.count() > 0) await expand.click({ force: true }).catch(() => {})
    await page.waitForTimeout(900)
  }
  const startText = await page.evaluate(() => (document.querySelector('[data-sidebar-right-panel]')?.innerText ?? '').replace(/\s+/g, ' ').slice(0, 160))
  const terminalTabOpen = async () => page.evaluate(() => [...document.querySelectorAll('[data-dockkit-tab],[role="tab"]')].some(el => /终端/.test(el.textContent ?? '')))
  for (let attempt = 0; attempt < 3; attempt += 1) {
    if (await terminalTabOpen()) break
    await page.locator('[data-composer-input]').click().catch(() => {})
    await page.keyboard.press('Control+Backquote')
    await page.waitForTimeout(2500)
    if (await terminalTabOpen()) break
    const card = page.locator('[data-sidebar-right-panel] button', { hasText: /新建终端/ }).first()
    if (await card.count() > 0) await card.click().catch(() => {})
    await page.waitForTimeout(2500)
  }
  const metrics = await measure(page, '[data-sidebar-right-panel]', join(OUT, `RC5-UI-006-${theme}-${width}-terminal.png`))
  const text = await page.evaluate(() => (document.querySelector('[data-sidebar-right-panel]')?.innerText ?? '').replace(/\s+/g, ' ').slice(0, 200))
  const tabs = await page.evaluate(() => [...document.querySelectorAll('[data-dockkit-tab],[role="tab"]')].map(el => (el.textContent ?? '').replace(/\s+/g, ' ').trim()).filter(Boolean))
  return { ...metrics, startText, text, tabs }
}

async function chatImport(page, theme, width) {
  if (width >= 760) await ensureSidebar(page)
  const row = page.locator('[data-row-key^="session:"]').first()
  if (await row.count() > 0) await row.hover().catch(() => {})
  await page.waitForTimeout(800)
  const entry = await page.evaluate(() => {
    const buttons = [...document.querySelectorAll('button')]
    const hits = buttons.filter(el => /导入 DeepSeek|DeepSeek 会话/.test(`${el.getAttribute('aria-label') ?? ''} ${el.textContent ?? ''}`))
    return { hits: hits.length, slotPresent: document.querySelector('[data-slot="sidebar.session.action"]') !== null, sample: hits.slice(0, 2).map(el => (el.getAttribute('aria-label') ?? el.textContent ?? '').slice(0, 40)) }
  })
  const metrics = await measure(page, '[data-sidebar-list-area]', join(OUT, `RC5-UI-006-${theme}-${width}-chat-import-${entry.hits > 0 ? 'entry' : 'entry-missing'}.png`))
  return { ...metrics, entry }
}

async function assertImportFlow(theme) {
  // 入口缺失的机理证据：mux 全局一元清单不含 deepseekChatImport/limits，
  // 且 UI 的 useRemoteAccess 对该 action 返回 false → 动作组件只渲染 children（无按钮）。
  const { context, page } = await newContext({ width: 1440, height: 900 }, theme)
  const rpc = async (method) => page.evaluate(async (method) => {
    const response = await fetch(`/api/${method}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ type: 'client-request', rpcId: `e2-${Date.now().toString(36)}`, method, payload: { args: {} } }),
    })
    const text = await response.text()
    return { status: response.status, body: text.slice(0, 200) }
  }, method)
  const limits = await rpc('deepseekChatImport/limits')
  await context.close()
  return limits
}

for (const theme of THEMES) {
  if (only !== undefined && only.split(':')[0] !== theme) continue
  const background = await setTheme(theme)
  for (const viewport of VIEWPORTS) {
    if (only !== undefined && only !== `${theme}:${viewport.width}`) continue
    process.stdout.write(`[UI-006] ${theme} ${viewport.width} … `)
    const { context, page } = await newContext(viewport, theme)
    const row = { theme, width: viewport.width, themeBackground: background }
    try {
      row.hero = await hero(page, theme, viewport.width)
      row.mcp = await mcpSettings(page, theme, viewport.width)
      row.terminal = await terminalPanel(page, theme, viewport.width)
      row.chatImport = await chatImport(page, theme, viewport.width)
    } catch (error) {
      row.error = String(error?.message ?? error).slice(0, 300)
    }
    observations.push(row)
    console.log(row.error === undefined ? 'ok' : `ERROR ${row.error}`)
    await context.close()
  }
  if (only === undefined || only.split(':')[0] === theme) {
    const probe = await assertImportFlow(theme)
    observations.push({ theme, importLimitsProbe: probe })
  }
}

await browser.close()
writeFileSync(join(OUT, 'observations.json'), JSON.stringify(observations, null, 2))
console.log(`[UI-006] observations → ${join(OUT, 'observations.json')}`)