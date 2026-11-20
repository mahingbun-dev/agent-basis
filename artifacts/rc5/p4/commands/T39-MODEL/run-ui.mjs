#!/usr/bin/env node
/**
 * T39 浏览器 E2E(local 临时 DSH_HOME;不动生产容器/生产配置):
 *  - 真 boot eterna-web profile(--port 0)+ 临时探针建一个空会话;
 *  - Chromium 登录(凭据仅进程内存,由本脚本随机生成并播种,不落盘/不回显);
 *  - 断言:① 输入 / 命令列表可见且 compact/model 各恰一行;
 *          ② /model 弹层可开,选中另一模型后 composer 触发钮回显新模型
 *             (access pages.ts 对 selectModel 响应改写 aria-label);
 *          ③ /compact 执行结果来自当前 compact 实现("No compactable history yet.");
 *          ④ /压缩 中文别名同样落到 /compact(定义身份修复后)。
 */
import { spawn } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { cpSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync, existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const repo = resolve(here, '../../../../..')
const sourceProfile = join(repo, '.eterna-home', 'profiles', 'eterna-web')
const home = join('/tmp', `t39-ui-${process.pid}`)
const ACCOUNT = 'cmdprobe'
const PASSWORD = randomBytes(18).toString('base64url')
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const evidence = {}
const failures = []

function check(name, ok, detail) {
  evidence[name] = { ok, detail }
  console.log(`[${ok ? 'PASS' : 'FAIL'}] ${name}${detail === undefined ? '' : ` — ${typeof detail === 'string' ? detail : JSON.stringify(detail)}`}`)
  if (!ok) failures.push(name)
}

if (!existsSync(sourceProfile)) { console.error('missing materialized profile'); process.exit(1) }
rmSync(home, { recursive: true, force: true })
mkdirSync(join(home, 'profiles'), { recursive: true })
cpSync(sourceProfile, join(home, 'profiles', 'eterna-web'), { recursive: true, verbatimSymlinks: true })
const profileModules = join(home, 'profiles', 'eterna-web', 'node_modules')
symlinkSync(join(here, 'session-probe'), join(profileModules, 't39-session-probe'), 'dir')
const overlay = join(here, 'overlay.yml')
// 临时 DSH_HOME 无 config-editor 模型路由:用本 patch 声明两个 keyless mimo 模型,
// 让 /model 目录可列出并可选(不联网、不需要凭据;生产配置不受影响)。
writeFileSync(overlay, `- insert:
    - id: t39-session-probe
      name: t39-session-probe
- id: llm-pi-ai
  config:
    providers:
      mimo:
        displayName: MiMo（测试直连）
        api: openai-completions
        baseURL: https://api.xiaomimimo.com/v1
        models:
          - id: mimo-v2.6-flash
            name: MiMo V2.6 Flash
            contextWindow: 300000
            input:
              - text
            reasoningEfforts:
              off: null
              low: low
              medium: medium
              high: high
          - id: mimo-v2.6-pro
            name: MiMo V2.6 Pro
            contextWindow: 300000
            input:
              - text
            reasoningEfforts:
              off: null
              low: low
              medium: medium
              high: high
`)

const host = spawn(process.execPath, [
  join(repo, 'node_modules/@deepseek-ai/dsh/lib/bin.js'),
  '--profile', 'eterna-web', '--patch', overlay, '--no-open', '--port', '0', '--host', '127.0.0.1',
], {
  cwd: repo,
  env: { ...process.env, DSH_HOME: home, ETERNA_ACCESS_ADMIN_USER: ACCOUNT, ETERNA_ACCESS_ADMIN_PASSWORD: PASSWORD, ETERNA_ACCESS_SECURE: '0' },
  stdio: ['ignore', 'pipe', 'pipe'],
})
let hostText = ''
host.stdout.setEncoding('utf8'); host.stderr.setEncoding('utf8')
host.stdout.on('data', (chunk) => { hostText += chunk })
host.stderr.on('data', (chunk) => { hostText += chunk })

async function waitFor(predicate, timeoutMs, label) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const value = await predicate()
    if (value !== undefined && value !== null && value !== false) return value
    await new Promise(r => setTimeout(r, 200))
  }
  throw new Error(`timeout waiting for ${label}`)
}

let browser
let url
let sessionId
try {
  url = await waitFor(() => hostText.match(/dsh web:\s*(http\S+)/u)?.[1], 120_000, 'dsh web url')
  sessionId = await waitFor(() => hostText.match(/T39_SESSION_ID (\S+)/u)?.[1], 60_000, 'session id')
  const origin = new URL(url).origin

  const req = createRequire(join(repo, 'packages/browser-relay/package.json'))
  const { chromium } = req('playwright-core')
  browser = await chromium.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] })
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, ignoreHTTPSErrors: true })
  const page = await context.newPage()
  const consoleLines = []
  const clearComposer = async () => {
    await page.click('[data-composer-input]')
    await page.keyboard.press('Meta+A')
    await page.keyboard.press('Backspace')
    await page.waitForTimeout(150)
  }
  page.on('console', (msg) => { consoleLines.push(`${msg.type()}: ${msg.text()}`) })

  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45_000 }).catch(async () => {
    await page.goto(`${origin}/login`, { waitUntil: 'domcontentloaded', timeout: 45_000 })
  })
  await page.waitForTimeout(2500)
  if (await page.locator('#account').isVisible({ timeout: 3000 }).catch(() => false)) {
    await page.fill('#account', ACCOUNT)
    await page.fill('#password', PASSWORD)
    await page.click('#go')
    await page.waitForURL(u => !String(u).includes('/login'), { timeout: 30_000 })
  }
  await page.waitForTimeout(4000)

  // 侧栏展开(窄窗默认收起;1440 下通常已开)
  const expand = page.locator('[aria-label="打开侧边栏"]').first()
  if (await expand.isVisible().catch(() => false)) { await expand.click(); await page.waitForTimeout(800) }

  // 打开探针会话(空会话行;如首屏是选择工作区则程序化点行)
  const rowClicked = await (async () => {
    const row = page.locator('[role="treeitem"][class*="sessionRow"]').first()
    if (await row.isVisible().catch(() => false)) { await row.click().catch(() => {}); return true }
    return page.evaluate(() => {
      const el = document.querySelector('[role="treeitem"][class*="sessionRow"]')
      if (el === null) return false
      el.click()
      return true
    })
  })()
  check('open-session', rowClicked, { sessionId })
  await page.waitForTimeout(2000)

  // ① / 命令面板
  await page.waitForSelector('[data-composer-input]', { timeout: 20_000 })
  await clearComposer()
  await page.keyboard.type('/')
  await page.waitForSelector('[role="option"]', { timeout: 10_000 })
  const menuRows = await page.$$eval('[role="option"]', els => els.map(el => ({ id: el.id, text: (el.textContent ?? '').trim() })))
  await page.screenshot({ path: join(here, '01-slash-menu.png'), fullPage: false })
  const compactRows = menuRows.filter(row => /\bcompact\b/u.test(row.text))
  const modelRows = menuRows.filter(row => /\bmodel\b/u.test(row.text))
  check('slash-menu-visible', menuRows.length > 0, { count: menuRows.length })
  check('slash-menu-compact-single', compactRows.length === 1, { compactRows })
  check('slash-menu-model-single', modelRows.length === 1, { modelRows })
  const shortRows = menuRows.filter(row => row.text.length < 80)
  check('slash-menu-host-commands', ['goal', 'plan', 'feedback', 'compact', 'export'].every(name => shortRows.some(row => row.text.includes(name))), { shortRows: shortRows.map(r => r.text) })
  // access pages.ts 的 commands/list 重写按设计滤除 permission(客户端只为菜单滤除,主机仍在目录)。
  check('slash-menu-permission-filtered', !shortRows.some(row => row.text.includes('permission')), { shortRows: shortRows.map(r => r.text) })
  check('slash-menu-unique-ids', new Set(menuRows.map(row => row.id)).size === menuRows.length, { count: menuRows.length })
  await page.keyboard.press('Escape')
  await page.waitForTimeout(500)

  // ② /model 切换回显
  const trigger = page.locator('button[aria-label^="选择模型"]').first()
  const beforeLabel = await trigger.getAttribute('aria-label').catch(() => null)
  await clearComposer()
  await page.keyboard.type('/model')
  await page.waitForSelector('[role="option"]', { timeout: 10_000 })
  const modelMenuRow = page.locator('[role="option"]').filter({ hasText: /\bmodel\b/u }).first()
  check('model-menu-row', await modelMenuRow.isVisible().catch(() => false), await modelMenuRow.textContent().catch(() => null))
  await modelMenuRow.click()
  await page.waitForSelector('[role="listbox"] [role="option"]', { timeout: 15_000 })
  const modelOptions = await page.$$eval('[role="listbox"] [role="option"]', els => els.map(el => ({ text: (el.textContent ?? '').trim(), label: el.getAttribute('aria-label') })))
  await page.screenshot({ path: join(here, '02-model-popup.png'), fullPage: false })
  check('model-popup-options', modelOptions.length >= 2, { modelOptions })
  const target = modelOptions.find(option => /Flash/u.test(option.text))
    ?? modelOptions.find(option => !(beforeLabel ?? '').includes(option.text.trim()))
  const targetName = target === undefined ? undefined : target.text.trim()
  if (target !== undefined) {
    await page.locator('[role="listbox"] [role="option"]').filter({ hasText: targetName }).first().click()
  }
  await page.waitForTimeout(800)
  const echoed = await waitFor(async () => {
    const label = await page.locator('button[aria-label^="选择模型"]').first().getAttribute('aria-label').catch(() => null)
    return label !== null && targetName !== undefined && label.includes(targetName) ? label : undefined
  }, 20_000, 'model echo').catch(() => null)
  await page.screenshot({ path: join(here, '03-model-echo.png'), fullPage: false })
  check('model-switch-echo', echoed !== null && echoed !== undefined && echoed.includes(targetName ?? '<none>'), { beforeLabel, target: targetName, afterLabel: echoed })

  // ③ /compact 执行(空会话 → 当前 compact 实现)
  await clearComposer()
  await page.keyboard.type('/compact')
  await page.keyboard.press('Enter')
  const compactShown = await waitFor(async () => (await page.locator('body').innerText()).includes('No compactable history yet.'), 20_000, 'compact result').catch(() => false)
  await page.screenshot({ path: join(here, '04-compact-result.png'), fullPage: false })
  check('compact-executes', compactShown === true, { sessionId })

  // ④ 中文别名 /压缩
  await clearComposer()
  await page.keyboard.type('/压缩')
  await page.keyboard.press('Enter')
  await page.waitForTimeout(4000)
  const bodyText = await page.locator('body').innerText()
  const aliasCount = (bodyText.match(/No compactable history yet\./gu) ?? []).length
  await page.screenshot({ path: join(here, '05-compact-zh-alias.png'), fullPage: false })
  check('compact-zh-alias', aliasCount >= 2, { occurrences: aliasCount })

  writeFileSync(join(here, 'console.log'), consoleLines.map(line => line.replace(/token=[A-Za-z0-9_-]+/gu, 'token=<redacted>')).join('\n'))
  writeFileSync(join(here, 'ui-dump.html'), (await page.content()).replace(/token=[A-Za-z0-9_-]+/gu, 'token=<redacted>'))
} catch (error) {
  check('runner', false, String(error?.stack ?? error))
  if (browser !== undefined) {
    try {
      const pages = browser.contexts().flatMap(c => c.pages())
      if (pages[0] !== undefined) {
        writeFileSync(join(here, 'ui-dump.html'), (await pages[0].content()).replace(/token=[A-Za-z0-9_-]+/gu, 'token=<redacted>'))
      }
    } catch {}
  }
} finally {
  if (browser !== undefined) await browser.close().catch(() => {})
  host.kill('SIGTERM')
  await new Promise(r => setTimeout(r, 1500))
  writeFileSync(join(here, 'boot.log'), hostText.replace(/token=[A-Za-z0-9_-]+/gu, 'token=<redacted>').replace(new RegExp(PASSWORD.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&'), 'gu'), '<redacted-password>'))
  rmSync(home, { recursive: true, force: true })
}
writeFileSync(join(here, 'assertions.json'), JSON.stringify({ url: url?.replace(/token=[A-Za-z0-9_-]+/gu, 'token=<redacted>'), sessionId, account: ACCOUNT, evidence, failures }, null, 2))
console.log(`T39_UI_SUMMARY ${JSON.stringify({ ok: failures.length === 0, failures })}`)
process.exitCode = failures.length === 0 ? 0 : 1
