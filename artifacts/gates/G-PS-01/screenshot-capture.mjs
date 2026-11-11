#!/usr/bin/env node
/**
 * G-PS-01 深浅两主题截图采集（尽力而为的人工步骤替代脚本，v2）。
 *
 * 配方：起 t7-studio 隔离档宿主（127.0.0.1:3108，t7-smoke/t7-ui-check 同款启动/
 * 清理纪律）→ playwright-core + 系统 Google Chrome headless（companion gate-run.mjs
 * 先例的 executablePath 方式）× colorScheme light/dark（dsh-client-ui-theme 默认跟随
 * prefers-color-scheme，lib/index.js:154-155）× 三页（全景列表/条目编辑/版本 diff）
 * + 640px 断点全景辅证。
 *
 * DOM 实测（2026-11-11，见 EVIDENCE.md「截图」节）：
 *  - 首跑有「预览版说明」aria-modal 把侧栏置 inert——先像真实用户关掉它；
 *  - 侧栏入口 = button[aria-label="提示词工坊"]；面板标题 span 是 inert 不可点；
 *  - 面板内容在应用壳内层滚动容器里，fullPage 截不全——截图前把祖先链
 *    overflow/height 解除（只影响截图会话，不改任何仓库代码），再对
 *    [data-t7-studio-root] 元素截图（元素全盒拼接）。
 *
 * 用法：node artifacts/gates/G-PS-01/screenshot-capture.mjs
 * 输出：artifacts/gates/G-PS-01/screenshots/*.png + shots-summary.json（含每张 md5）
 */
import { spawn, spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, openSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..')
const home = resolve(repoRoot, '.eterna-home-t7')
const profile = resolve(home, 'profiles', 't7-studio')
const logsDir = resolve(home, 'logs')
const hostLog = resolve(logsDir, 'gate-shot-host.log')
const port = 3108
const outDir = resolve(repoRoot, 'artifacts/gates/G-PS-01/screenshots')
const chromePath = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'

const requireFromRelay = createRequire(resolve(repoRoot, 'packages/browser-relay/package.json'))
const { chromium } = requireFromRelay('playwright-core')

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const summary = { startedAt: new Date().toISOString(), chrome: chromePath, pages: [], fatal: null }

let host
let stopping = false
function startHost() {
  const out = openSync(hostLog, 'w')
  host = spawn('node', [
    resolve(profile, 'node_modules/@deepseek-ai/dsh/lib/bin.js'),
    '--profile', 't7-studio', '--host', '127.0.0.1', '--port', String(port), '--no-open',
  ], {
    cwd: profile,
    env: { ...process.env, DSH_HOME: home, LITELLM_API_KEY: readFileSync(resolve(repoRoot, '.secrets/litellm-master-key.txt'), 'utf8').trim() },
    stdio: ['ignore', out, out],
  })
}
async function stopHost() {
  stopping = true
  if (host?.pid && host.exitCode === null) {
    host.kill('SIGTERM')
    await Promise.race([new Promise((r) => host.once('exit', r)), sleep(15000)])
    if (host.exitCode === null) host.kill('SIGKILL')
  }
  spawnSync('pkill', ['-f', 'profile t7-studio'], { stdio: 'ignore' })
  await sleep(1500)
}
async function waitForToken(timeoutMs = 90000) {
  const t0 = Date.now()
  while (Date.now() - t0 < timeoutMs) {
    if (host.exitCode !== null) throw new Error(`host exited early code=${host.exitCode}; log tail:\n${readFileSync(hostLog, 'utf8').slice(-1500)}`)
    const m = readFileSync(hostLog, 'utf8').match(/dsh web: .*token=([A-Za-z0-9_-]+)/)
    if (m) return m[1]
    await sleep(500)
  }
  throw new Error(`host not ready in ${timeoutMs}ms; log tail:\n${readFileSync(hostLog, 'utf8').slice(-1500)}`)
}

/** 解除面板自身/祖先链/面板内子滚动容器的滚动裁剪（仅截图会话内联样式，不动仓库代码）。
 *  DOM 实测（/tmp 诊断,2026-11-11）:滚动容器正是 [data-t7-studio-root] 本身
 *  (border-box 被外层布局钳到视口高 1000,scrollHeight=3362,detail 在 y≈1813)——
 *  只解祖先不解自身时元素截图只截到顶部 1000px(全景与条目编辑同帧的根因)。 */
const uncapScroll = (page) => page.evaluate(() => {
  const root = document.querySelector('[data-t7-studio-root]')
  if (root === null) return 'no-root'
  const uncap = (el) => {
    el.style.overflow = 'visible'
    el.style.height = 'auto'
    el.style.maxHeight = 'none'
    el.style.minHeight = '0'
    el.style.flex = 'none'
    el.style.position = el.style.position === 'fixed' ? 'static' : el.style.position
  }
  uncap(root)
  for (let p = root.parentElement; p !== null && p !== document.body; p = p.parentElement) {
    const s = getComputedStyle(p)
    if (s.overflow !== 'visible' || s.height !== 'auto' || p.scrollHeight > p.clientHeight + 8) uncap(p)
  }
  for (const el of root.querySelectorAll('*')) {
    if (el.scrollHeight > el.clientHeight + 8 || el.scrollWidth > el.clientWidth + 8) uncap(el)
  }
  return `uncapped(root h=${Math.round(root.getBoundingClientRect().height)}/scroll=${root.scrollHeight})`
})

async function shot(page, name, file) {
  const state = await uncapScroll(page)
  await sleep(500)
  await page.locator('[data-t7-studio-root]').screenshot({ path: resolve(outDir, file) })
  const bytes = readFileSync(resolve(outDir, file))
  summary.pages.push({ name, file, bytes: bytes.length, md5: createHash('md5').update(bytes).digest('hex'), state })
  console.log(`[shot] ${name} -> screenshots/${file} (${bytes.length}B md5=${summary.pages.at(-1).md5.slice(0, 8)} ${state})`)
}

const clickHard = async (page, selector) => {
  try {
    await page.locator(selector).first().click({ timeout: 15000 })
  } catch {
    await page.locator(selector).first().click({ force: true, timeout: 15000 })
  }
}

async function captureTheme(context, token, theme) {
  const page = await context.newPage()
  await page.goto(`http://127.0.0.1:${port}/?token=${token}`, { waitUntil: 'domcontentloaded', timeout: 60000 })
  await sleep(12000)
  // 关掉首跑「预览版说明」模态（aria-modal 把侧栏置 inert，DOM 实测）
  const dialog = page.locator('[role="dialog"], [aria-modal="true"]').first()
  if (await dialog.isVisible({ timeout: 8000 }).catch(() => false)) {
    await dialog.locator('button').last().click({ timeout: 10000 })
    await sleep(800)
  }
  // 侧栏入口进 studio 面板
  await page.locator('button[aria-label="提示词工坊"]').first().click({ timeout: 30000 })
  await page.waitForSelector('[data-ps-group-nav]', { state: 'attached', timeout: 60000 })
  await sleep(1500)

  // 1) 全景列表
  await shot(page, `${theme} 全景列表(分组导航+统计条)`, `studio-panorama-${theme}.png`)

  // 2) 条目编辑(领域层 event-planning.personaPrefix:折叠块标量/红线必检/3 版本链)。
  //    刻意选非默认条目:默认 persona 在加载时即选中,若仍截它则与全景帧字节相同,
  //    换领域条目才是一次真实的「切换条目→渲染详情」交互证据。
  await clickHard(page, '[data-ps-entry-row="domain.event-planning.persona-prefix"]')
  await page.waitForSelector('[data-ps-entry-detail]', { state: 'attached', timeout: 30000 })
  await page.waitForFunction(() => {
    const detail = document.querySelector('[data-ps-entry-detail]')
    const editor = document.querySelector('[data-t7-editor]')
    return detail !== null && editor !== null && detail.getBoundingClientRect().height > 300
  }, null, { timeout: 30000 })
  await sleep(1200)
  await shot(page, `${theme} 条目编辑(领域条目:元数据卡+编辑器+版本链)`, `studio-entry-edit-${theme}.png`)

  // 3) 版本 diff(seq2 对 seq1)
  await page.waitForSelector('[data-t7-diff-btn]', { state: 'attached', timeout: 30000 })
  await clickHard(page, '[data-t7-diff-btn]')
  await page.waitForSelector('[data-ps-diff-view]', { state: 'attached', timeout: 30000 })
  await sleep(800)
  await shot(page, `${theme} 版本 diff(行级对比)`, `studio-diff-${theme}.png`)

  // 4) 640px 断点全景(响应式走查辅证)
  await page.setViewportSize({ width: 640, height: 1000 })
  await sleep(1000)
  await shot(page, `${theme} 全景列表@640px(单列断点辅证)`, `studio-panorama-640-${theme}.png`)
  await page.close()
}

try {
  if (!existsSync(chromePath)) throw new Error(`系统 Chrome 不存在: ${chromePath}`)
  if (!existsSync(resolve(profile, 'node_modules/@deepseek-ai/dsh/lib/bin.js'))) throw new Error('t7-studio profile 缺失(先跑 scripts/t7-smoke.mjs)')
  mkdirSync(outDir, { recursive: true })
  startHost()
  const token = await waitForToken()
  console.log(`[host] ready pid=${host.pid} token=***`)
  for (const theme of ['light', 'dark']) {
    const context = await chromium.launchPersistentContext(resolve(logsDir, `shot-chrome-${theme}`), {
      executablePath: chromePath,
      headless: true,
      colorScheme: theme,
      viewport: { width: 1600, height: 1000 },
      args: ['--no-first-run', '--disable-pushstate-worker'],
    })
    try {
      await captureTheme(context, token, theme)
    } finally {
      await context.close().catch(() => {})
      spawnSync('pkill', ['-f', `shot-chrome-${theme}`], { stdio: 'ignore' })
    }
  }
  console.log('[done] 全部截图完成')
} catch (error) {
  summary.fatal = String(error?.message ?? error)
  console.error(`[FATAL] ${summary.fatal}`)
  process.exitCode = 1
} finally {
  await stopHost()
  summary.finishedAt = new Date().toISOString()
  writeFileSync(resolve(repoRoot, 'artifacts/gates/G-PS-01/shots-summary.json'), `${JSON.stringify(summary, null, 2)}\n`)
  console.log('[cleanup] 宿主已停')
}
