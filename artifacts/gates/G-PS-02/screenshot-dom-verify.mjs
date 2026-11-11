#!/usr/bin/env node
/**
 * G-PS-02 截图帧内容机器核验：与 screenshot-capture.mjs 同流程起宿主进面板，
 * 在截图同款交互后（点首行会话→等详情→展开冻结文本），逐锚点记录「在场+可见+文本」。
 * 产物：outputs/screenshot-dom-verification.txt 的内容由此脚本打印，由调用方重定向。
 */
import { spawn, spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { existsSync, openSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..')
const home = resolve(repoRoot, '.eterna-home-t7')
const profile = resolve(home, 'profiles', 't7-studio')
const logsDir = resolve(home, 'logs')
const hostLog = resolve(logsDir, 'gate-domverify-host.log')
const port = 3108
const chromePath = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const requireFromRelay = createRequire(resolve(repoRoot, 'packages/browser-relay/package.json'))
const { chromium } = requireFromRelay('playwright-core')
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

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
    if (host.exitCode !== null) throw new Error(`host exited early code=${host.exitCode}`)
    const m = readFileSync(hostLog, 'utf8').match(/dsh web: .*token=([A-Za-z0-9_-]+)/)
    if (m) return m[1]
    await sleep(500)
  }
  throw new Error('host not ready')
}

const report = (ok, label, extra = '') => console.log(`[${ok ? 'PASS' : 'FAIL'}] ${label}${extra === '' ? '' : ` — ${extra}`}`)

try {
  if (!existsSync(chromePath)) throw new Error('系统 Chrome 不存在')
  startHost()
  const token = await waitForToken()
  const context = await chromium.launchPersistentContext(resolve(logsDir, 'shot-domverify'), {
    executablePath: chromePath, headless: true, colorScheme: 'light', viewport: { width: 1600, height: 1000 },
    args: ['--no-first-run', '--disable-pushstate-worker'],
  })
  try {
    const page = await context.newPage()
    await page.goto(`http://127.0.0.1:${port}/?token=${token}`, { waitUntil: 'domcontentloaded', timeout: 60000 })
    await sleep(12000)
    const dialog = page.locator('[role="dialog"], [aria-modal="true"]').first()
    if (await dialog.isVisible({ timeout: 8000 }).catch(() => false)) {
      await dialog.locator('button').last().click({ timeout: 10000 })
      await sleep(800)
    }
    await page.locator('button[aria-label="提示词工坊"]').first().click({ timeout: 30000 })
    await page.waitForSelector('[data-ps-session-snapshot]', { state: 'attached', timeout: 60000 })
    await sleep(1500)

    const facts = await page.evaluate(() => {
      const vis = (el) => {
        if (el === null) return null
        const r = el.getBoundingClientRect()
        return r.width > 0 && r.height > 0
      }
      const text = (sel) => document.querySelector(sel)?.textContent?.trim().slice(0, 120) ?? null
      return {
        rows: document.querySelectorAll('[data-ps-snapshot-session-row]').length,
        firstRowId: text('[data-ps-snapshot-session-row] [data-ps-snapshot-row-id]'),
        firstRowMeta: text('[data-ps-snapshot-session-row] [data-ps-snapshot-row-meta]'),
        sectionTitle: text('[data-ps-session-snapshot] [data-t7-section-title]'),
        selectHintVisible: vis(document.querySelector('[data-ps-snapshot-select-hint]')),
      }
    })
    report(facts.sectionTitle?.includes('会话快照') === true, '快照分区标题在场', JSON.stringify(facts.sectionTitle))
    report(facts.rows > 0, `会话行卡 ${facts.rows} 张`, `首行=${facts.firstRowId ?? '—'} meta=${facts.firstRowMeta ?? '—'}`)
    report(facts.selectHintVisible === true, '「选择会话查看快照」提示可见')

    await page.locator('[data-ps-snapshot-session-row]').first().click({ timeout: 15000 })
    await page.waitForSelector('[data-ps-snapshot-detail]', { state: 'attached', timeout: 30000 })
    await page.waitForSelector('[data-ps-snapshot-entry]', { state: 'attached', timeout: 30000 })
    await sleep(800)
    await page.evaluate(() => {
      const pre = document.querySelector('[data-ps-snapshot-entry-text]')
      const details = pre?.closest('details')
      if (details !== undefined && details !== null) details.open = true
    })
    await sleep(500)
    const detail = await page.evaluate(() => {
      const detailRoot = document.querySelector('[data-ps-snapshot-detail]')
      const entries = [...document.querySelectorAll('[data-ps-snapshot-entry]')]
      const pills = entries.map((el) => ({
        id: el.getAttribute('data-ps-snapshot-entry'),
        kind: el.getAttribute('data-ps-snapshot-kind'),
        unreplayable: el.querySelector('[data-ps-snapshot-unreplayable]') !== null,
        pointer: el.querySelector('[data-ps-snapshot-pointer]')?.textContent?.trim().slice(0, 60) ?? null,
        annotation: el.querySelector('[data-ps-snapshot-entry-note]')?.textContent?.trim().slice(0, 80) ?? null,
      }))
      const pre = document.querySelector('[data-ps-snapshot-entry-text]')
      const openDetails = pre !== null && pre.closest('details')?.open === true
      return {
        detailVisible: detailRoot !== null && detailRoot.getBoundingClientRect().height > 100,
        meta: detailRoot?.querySelector('[data-ps-snapshot-meta]')?.textContent?.trim().slice(0, 160) ?? null,
        entries: pills,
        openDetails,
        frozenTextHead: pre?.textContent?.trim().slice(0, 60) ?? null,
      }
    })
    report(detail.detailVisible, '快照详情卡在场', detail.meta ?? '')
    report(detail.entries.length > 0, `快照条目 ${detail.entries.length} 条（分型徽章）`, `采样=${JSON.stringify(detail.entries.slice(0, 3))}`)
    report(detail.entries.some((e) => e.unreplayable), '不可回放标注在场（只读型/运行时注入型条目）')
    report(detail.openDetails && detail.frozenTextHead !== null, '冻结提示词文本已展开可见', `首段=${detail.frozenTextHead ?? '—'}`)

    // 生效条件卡（time-context 只读条目）
    await page.locator('[data-ps-entry-row="preset.standard.time-context"]').first().click({ timeout: 15000 })
    await page.waitForSelector('[data-ps-entry-effect]', { state: 'attached', timeout: 30000 })
    await sleep(1000)
    const effect = await page.evaluate(() => ({
      radius: document.querySelector('[data-ps-entry-effect]')?.getAttribute('data-ps-effect-radius') ?? null,
      badge: document.querySelector('[data-ps-effect-badge]')?.textContent?.trim() ?? null,
      note: document.querySelector('[data-ps-entry-effect-note]')?.textContent?.trim().slice(0, 100) ?? null,
      readonlyCard: document.querySelector('[data-ps-entry-readonly]') !== null,
    }))
    report(effect.radius === 'readonly-upstream', '生效条件卡半径=readonly-upstream', JSON.stringify(effect))
    report(effect.readonlyCard, '只读条目卡在场（写链路拒写明示）')
  } finally {
    await context.close().catch(() => {})
    spawnSync('pkill', ['-f', 'shot-domverify'], { stdio: 'ignore' })
  }
  console.log('[done] DOM 核验完成')
} catch (error) {
  console.error(`[FATAL] ${String(error?.message ?? error)}`)
  process.exitCode = 1
} finally {
  await stopHost()
  console.log('[cleanup] 宿主已停')
}
