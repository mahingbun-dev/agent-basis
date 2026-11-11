#!/usr/bin/env node
/**
 * G-PS-02 深浅两主题截图采集（尽力而为的人工步骤替代脚本）。
 *
 * 配方照抄 G-PS-01/screenshot-capture.mjs（已验证的 DOM 事实全部沿用）：
 * 起 t7-studio 隔离档宿主（127.0.0.1:3108）→ playwright-core + 系统 Chrome headless
 * × colorScheme light/dark × 两视图：
 *   1) 会话快照查看视图（§7.2 必须浏览器项）：会话行卡列表 → 点击行 → 快照详情
 *      （条目分型徽章 + 不可回放标注 + 版本指针 + 冻结文本 <details> 展开）；
 *   2) 条目「生效条件」卡（断言 2 的人工辅证）：选行锚点只读型条目
 *      preset.standard.time-context，展示 effect 半径胶囊 + 只读说明。
 *
 * 快照数据来源：t7-e2e 运行落盘的 storages/eterna_prompt_snapshots/（宿主重启后
 * 仍可查——快照持久化本身即 T2.3 断言面）。
 *
 * 用法：node artifacts/gates/G-PS-02/screenshot-capture.mjs
 * 输出：artifacts/gates/G-PS-02/screenshots/*.png + shots-summary.json（含每张 md5）
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
const outDir = resolve(repoRoot, 'artifacts/gates/G-PS-02/screenshots')
const chromePath = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'

const requireFromRelay = createRequire(resolve(repoRoot, 'packages/browser-relay/package.json'))
const { chromium } = requireFromRelay('playwright-core')

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const summary = { startedAt: new Date().toISOString(), chrome: chromePath, pages: [], fatal: null }

let host
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

/** 解除面板/祖先链/子滚动容器滚动裁剪（仅截图会话内联样式，不动仓库代码；G-PS-01 实测配方）。 */
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
  // 关掉首跑「预览版说明」模态（aria-modal 把侧栏置 inert，G-PS-01 DOM 实测）
  const dialog = page.locator('[role="dialog"], [aria-modal="true"]').first()
  if (await dialog.isVisible({ timeout: 8000 }).catch(() => false)) {
    await dialog.locator('button').last().click({ timeout: 10000 })
    await sleep(800)
  }
  // 侧栏入口进 studio 面板
  await page.locator('button[aria-label="提示词工坊"]').first().click({ timeout: 30000 })
  await page.waitForSelector('[data-ps-group-nav]', { state: 'attached', timeout: 60000 })
  await page.waitForSelector('[data-ps-session-snapshot]', { state: 'attached', timeout: 60000 })
  await sleep(1500)

  // 1) 会话快照查看视图：等会话行卡 → 点首行 → 等快照详情 → 展开首条冻结文本
  await page.waitForSelector('[data-ps-snapshot-session-row]', { state: 'attached', timeout: 30000 })
  await sleep(800)
  await clickHard(page, '[data-ps-snapshot-session-row]')
  await page.waitForSelector('[data-ps-snapshot-detail]', { state: 'attached', timeout: 30000 })
  await page.waitForSelector('[data-ps-snapshot-entry]', { state: 'attached', timeout: 30000 })
  await sleep(800)
  // 展开首个含冻结文本的 <details>（patch 值型条目文本）
  const expanded = await page.evaluate(() => {
    const pre = document.querySelector('[data-ps-snapshot-entry-text]')
    if (pre === null) return false
    const details = pre.closest('details')
    if (details !== null) details.open = true
    return true
  })
  if (expanded) await sleep(500)
  await shot(page, `${theme} 会话快照查看(行卡列表+详情:分型徽章/不可回放标注/版本指针/冻结文本)`, `studio-snapshot-${theme}.png`)

  // 2) 条目「生效条件」卡（T2.2 断言 2 的人工辅证）：选行锚点只读型条目
  await clickHard(page, '[data-ps-entry-row="preset.standard.time-context"]')
  await page.waitForSelector('[data-ps-entry-detail]', { state: 'attached', timeout: 30000 })
  await page.waitForFunction(() => {
    const detail = document.querySelector('[data-ps-entry-detail]')
    const effect = document.querySelector('[data-ps-entry-effect]')
    return detail !== null && effect !== null && detail.getBoundingClientRect().height > 300
  }, null, { timeout: 30000 })
  await sleep(1200)
  await shot(page, `${theme} 条目详情·生效条件卡(行锚点只读型:readonly-upstream 半径+拒写说明)`, `studio-entry-effect-${theme}.png`)

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
    const context = await chromium.launchPersistentContext(resolve(logsDir, `shot-chrome-gps02-${theme}`), {
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
      spawnSync('pkill', ['-f', `shot-chrome-gps02-${theme}`], { stdio: 'ignore' })
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
  writeFileSync(resolve(repoRoot, 'artifacts/gates/G-PS-02/shots-summary.json'), `${JSON.stringify(summary, null, 2)}\n`)
  console.log('[cleanup] 宿主已停')
}
