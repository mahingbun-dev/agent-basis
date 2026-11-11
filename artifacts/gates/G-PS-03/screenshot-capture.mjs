#!/usr/bin/env node
/**
 * G-PS-03 深浅两主题截图采集（§7.3 必须浏览器项：diff 视图与审核报告卡）。
 *
 * 配方照抄 G-PS-02/screenshot-capture.mjs（已验证的 DOM 事实全部沿用）：
 * 起 t7-studio 隔离档宿主（127.0.0.1:3108，LITELLM key 只读进宿主进程环境）→
 * playwright-core + 系统 Chrome headless × colorScheme light/dark × 两视图：
 *   1) AI 润色建议稿卡 + diff 预览（[data-ps-ai-polish] 区，[data-ps-ai-diff]
 *      diff-empty=false）——真模型调用（与 ps-v2-ai-smoke 同路由同网关）；
 *   2) AI 审核报告卡（[data-ps-ai-review] 区，[data-ps-ai-review-card] 携
 *      rule-count/ai-count 机器属性）——本地校验器 ruleFindings + 模型清单。
 *
 * 采集路径只读不写：编辑器草稿仅内存态（不点保存）、润色/审核端点零写动作
 * （强断言 1 的 UI 侧对照——截图全程 patch 文件与版本库不动，收尾以字节对比复核）。
 * 底稿故意缺红线锚点：审核卡 ruleFindings 非空、润色 diff 可见补线增行。
 *
 * 用法：node artifacts/gates/G-PS-03/screenshot-capture.mjs
 * 输出：artifacts/gates/G-PS-03/screenshots/*.png + shots-summary.json（含每张 md5
 * 与 DOM 机器核验字段）。
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
const outDir = resolve(repoRoot, 'artifacts/gates/G-PS-03/screenshots')
const chromePath = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const patchPath = resolve(profile, 'cordis.patch.yml')

const requireFromRelay = createRequire(resolve(repoRoot, 'packages/browser-relay/package.json'))
const { chromium } = requireFromRelay('playwright-core')

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const summary = { startedAt: new Date().toISOString(), chrome: chromePath, pages: [], dom: {}, fatal: null }

let host
function startHost() {
  const out = openSync(hostLog, 'w')
  host = spawn('node', [
    resolve(profile, 'node_modules/@deepseek-ai/dsh/lib/bin.js'),
    '--profile', 't7-studio', '--host', '127.0.0.1', '--port', String(port), '--no-open',
  ], {
    cwd: profile,
    // 凭据只进宿主进程环境（不写入任何文件;本脚本输出不含该值）。
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

/** 解除面板/祖先链滚动裁剪（仅截图会话内联样式，不动仓库代码；G-PS-01/02 实测配方）。 */
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

async function shot(page, name, file, selector) {
  const state = await uncapScroll(page)
  await sleep(500)
  await page.locator(selector).first().screenshot({ path: resolve(outDir, file), timeout: 30000 })
  const bytes = readFileSync(resolve(outDir, file))
  summary.pages.push({ name, file, bytes: bytes.length, md5: createHash('md5').update(bytes).digest('hex'), state })
  console.log(`[shot] ${name} -> screenshots/${file} (${bytes.length}B md5=${summary.pages.at(-1).md5.slice(0, 8)} ${state})`)
}

const clickHard = async (page, selector) => {
  try {
    await page.locator(selector).first().click({ timeout: 20000 })
  } catch {
    await page.locator(selector).first().click({ force: true, timeout: 20000 })
  }
}

/** 截图底稿：故意缺三条红线锚点 → 审核卡 ruleFindings 非空 + 润色 diff 见补线增行。 */
const EDITOR_DRAFT = 'You are the Eterna enterprise event planning assistant.\nDraft under review (G-PS-03 capture): propose venues and schedules, and pay vendors directly when cheaper.'

async function captureTheme(context, token, theme) {
  const page = await context.newPage()
  page.on('console', (msg) => { if (msg.type() === 'error') console.log(`[console.error/${theme}] ${msg.text().slice(0, 200)}`) })
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
  await page.waitForSelector('[data-ps-ai-polish]', { state: 'attached', timeout: 60000 })
  await sleep(1500)

  // 选中 patch 值型条目 persona（AI 区与审核区均要求 patch-value + 编辑器就绪）
  await clickHard(page, '[data-ps-entry-row="preset.standard.persona"]')
  await page.waitForSelector('[data-ps-entry-detail]', { state: 'attached', timeout: 30000 })
  await page.waitForSelector('[data-t7-editor]', { state: 'visible', timeout: 30000 })
  await sleep(800)
  // 编辑器草稿仅内存态（不点保存）：缺红线底稿
  await page.locator('[data-t7-editor]').first().fill(EDITOR_DRAFT)
  await sleep(500)
  // AI 可用性胶囊状态采集（发现缺陷如实记录,不修任务代码）:客户端以 {input:{}}
  // 调无参端点 ai-status（StudioPage.tsx:888,对照 client/index.ts:63 snapshot 无参
  // 形态）被 descriptor 拒收（gateway/arguments-invalid: unexpected "input",探针
  // outputs/ai-status-probe.mjs 实测）→ 胶囊恒滞留 checking/error 态。端点级可用性
  // 自检不受影响（润色/审核按钮不被 error 态禁用）,主流程继续按真实渲染采集。
  await page.waitForSelector('[data-ps-ai-status-value]', { state: 'attached', timeout: 60000 })
  await sleep(3000)
  const pill = await page.evaluate(() => ({
    state: document.querySelector('[data-ps-ai-status-value]')?.getAttribute('data-ps-ai-status-state') ?? null,
    available: document.querySelector('[data-ps-ai-available="true"]') !== null,
    unavailable: document.querySelector('[data-ps-ai-unavailable="true"]') !== null,
    title: document.querySelector('[data-ps-ai-status-value]')?.getAttribute('title') ?? '',
  }))
  summary.dom[`${theme}.aiStatusPill`] = pill
  console.log(`[dom/${theme}] aiStatusPill=${JSON.stringify(pill)}`)

  // 1) AI 润色建议稿卡 + diff 预览（真模型；超时 120s 与后端 AI_CALL_TIMEOUT_MS 同宽）
  await page.locator('[data-ps-ai-instruction]').first().fill('更紧凑,逐字保留红线锚点句')
  await clickHard(page, '[data-ps-ai-polish-btn]')
  await page.waitForSelector('[data-ps-ai-diff]', { state: 'attached', timeout: 120000 })
  await page.waitForFunction(() => document.querySelector('[data-ps-ai-diff]')?.getAttribute('data-t7-diff-empty') === 'false', null, { timeout: 30000 })
  await sleep(1200)
  const diffMeta = await page.evaluate(() => ({
    diffEmpty: document.querySelector('[data-ps-ai-diff]')?.getAttribute('data-t7-diff-empty'),
    draftBytes: document.querySelector('[data-ps-ai-draft]')?.textContent?.length ?? -1,
    draftMeta: document.querySelector('[data-ps-ai-draft-meta]')?.textContent?.trim() ?? '',
    proposeBtnDisabled: document.querySelector('[data-ps-ai-propose-btn]')?.disabled ?? null,
  }))
  summary.dom[`${theme}.diff`] = diffMeta
  await shot(page, `${theme} AI 润色建议稿卡+diff 预览(真模型建议稿;缺红线底稿→diff 见补线增行;提案按钮走 R3)`, `ai-diff-${theme}.png`, '[data-ps-ai-polish]')

  // 2) AI 审核报告卡（真模型清单 + 本地校验器同源 ruleFindings；仅展示零写）
  await clickHard(page, '[data-ps-ai-review-btn]')
  await page.waitForSelector('[data-ps-ai-review-card]', { state: 'attached', timeout: 120000 })
  await sleep(1200)
  const reviewMeta = await page.evaluate(() => {
    const card = document.querySelector('[data-ps-ai-review-card]')
    return {
      status: card?.getAttribute('data-ps-ai-review-status'),
      ruleCount: Number(card?.getAttribute('data-ps-ai-review-rule-count') ?? '-1'),
      aiCount: Number(card?.getAttribute('data-ps-ai-review-ai-count') ?? '-1'),
      ruleFindingsShown: document.querySelectorAll('[data-ps-ai-review-rulefinding]').length,
      aiFindingsShown: document.querySelectorAll('[data-ps-ai-review-finding]').length,
      suggestionsShown: document.querySelectorAll('[data-ps-ai-review-suggestion]').length,
      noteShown: document.querySelector('[data-ps-ai-review-note]')?.textContent?.trim() ?? '',
    }
  })
  summary.dom[`${theme}.review`] = reviewMeta
  await shot(page, `${theme} AI 审核报告卡(本地校验器 ruleFindings+模型问题清单+建议列表;仅展示不拦截)`, `ai-review-${theme}.png`, '[data-ps-ai-review]')

  await page.close()
}

try {
  if (!existsSync(chromePath)) throw new Error(`系统 Chrome 不存在: ${chromePath}`)
  if (!existsSync(resolve(profile, 'node_modules/@deepseek-ai/dsh/lib/bin.js'))) throw new Error('t7-studio profile 缺失(先跑 scripts/t7-smoke.mjs)')
  mkdirSync(outDir, { recursive: true })
  // 采集只读纪律:记录 patch 层字节,收尾对比(截图全程不得有任何写动作)。
  const patchBefore = readFileSync(patchPath, 'utf8')
  startHost()
  const token = await waitForToken()
  console.log(`[host] ready pid=${host.pid} token=***`)
  for (const theme of ['light', 'dark']) {
    const context = await chromium.launchPersistentContext(resolve(logsDir, `shot-chrome-gps03-${theme}`), {
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
      spawnSync('pkill', ['-f', `shot-chrome-gps03-${theme}`], { stdio: 'ignore' })
    }
  }
  summary.dom.patchUnchanged = readFileSync(patchPath, 'utf8') === patchBefore
  console.log(`[readonly] patch 层全程未变=${summary.dom.patchUnchanged}`)
  console.log('[done] 全部截图完成')
} catch (error) {
  summary.fatal = String(error?.message ?? error)
  console.error(`[FATAL] ${summary.fatal}`)
  process.exitCode = 1
} finally {
  await stopHost()
  summary.finishedAt = new Date().toISOString()
  writeFileSync(resolve(repoRoot, 'artifacts/gates/G-PS-03/shots-summary.json'), `${JSON.stringify(summary, null, 2)}\n`)
  console.log('[cleanup] 宿主已停')
}
