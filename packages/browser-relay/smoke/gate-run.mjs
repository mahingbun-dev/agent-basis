#!/usr/bin/env node
// G-CORE-01/02/03 验收执行 harness（供独立验收代理运行；本脚本只采集观察数据，
// PASS/FAIL 判定由验收代理依据门禁文本独立作出——判定依据见
// plans/2026-11-10-companion扩展开发计划与测试门禁.md §3.1）。
// 前置：gate-setup.mjs 已完成（系统临时目录 gate-env.json 存在，relay + eterna web 存活）。
// 场景（真实用户浏览器 = CfT chromium + Eterna Companion 扩展 + eterna Web UI 登录会话）。

import { chromium } from 'playwright-core'
import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const PKG = process.cwd()
const REPO = resolve(PKG, '../..')
const ENV = JSON.parse(readFileSync(join(tmpdir(), 'gate-env.json'), 'utf8'))
const EXT = ENV.extensionDist
const CHROME_DIR = join(PKG, 'smoke/.browsers')
const OUT = join(PKG, 'smoke/gate-evidence')
mkdirSync(OUT, { recursive: true })

function findChromiumBinary(dir, d = 12) {
  if (d < 0) return null
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name)
    if (e.isDirectory()) { const r = findChromiumBinary(p, d - 1); if (r !== null) return r }
    else if (p.endsWith('/Chromium.app/Contents/MacOS/Chromium') || p.endsWith('/chrome')) return p
  }
  return null
}

// ── 门禁话术与判据辅助（摘自门禁文档 §3.1，判定由代理复核）──────────────
const CASES = [
  {
    id: 'G-CORE-01',
    prompt: '打开 example.com 并读出页面标题',
    expectHints: { urlContains: 'example.com', titleContains: 'Example Domain', snapshotTool: 'browser_snapshot' },
    settle: 60_000,
  },
  {
    id: 'G-CORE-02',
    prompt: '在 Hacker News 搜索 playwright，告诉我第一条结果的标题和链接',
    expectHints: { urlContains: 'news.ycombinator', titleContains: 'Search', snapshotTool: 'browser_snapshot', fillTool: 'browser_fill', clickTool: 'browser_click' },
    settle: 120_000,
  },
  {
    id: 'G-CORE-03',
    prompt: '打开人民网首页（www.people.com.cn），取快照后点开头条新闻，读出正文第一段',
    expectHints: { urlContains: 'people.com.cn', snapshotTool: 'browser_snapshot', clickTool: 'browser_click' },
    settle: 120_000,
  },
]

const findChrome = () => {
  const envPath = process.env.SMOKE_CHROME
  if (envPath !== undefined && existsSync(envPath)) return envPath
  const hit = findChromiumBinary(CHROME_DIR)
  if (hit === null) throw new Error('找不到 CfT Chromium（先跑 gate-setup/smoke 下载）')
  return hit
}

async function main() {
  const chromePath = findChrome()
  const userDataDir = join(tmpdir(), `gate-chrome-profile-${Date.now()}`)
  const context = await chromium.launchPersistentContext(userDataDir, {
    executablePath: chromePath,
    headless: process.env.SMOKE_HEADLESS !== '0',
    args: ['--disable-pushstate-worker', `--load-extension=${EXT}`, '--no-first-run'],
    viewport: { width: 1600, height: 1000 },
  })
  console.log(`[gate-run] chromium 已启动（扩展已加载）`)

  // 1. eterna 登录（bootstrap token URL 直接消费）
  const page = context.pages()[0] ?? await context.newPage()
  const origin = new URL(ENV.url).origin
  // 登录入口直接走 /login（bootstrap token 一次性，重跑必失效——账号密码登录不依赖 token）
  await page.goto(origin + '/login', { waitUntil: 'domcontentloaded', timeout: 60_000 })
  console.log('[gate-run] access 门禁登录（gate-admin）')
  await page.locator('#account').fill(ENV.adminUser)
  await page.locator('#password').fill(ENV.adminPassword)
  await page.locator('#go').click()
  await page.waitForURL((u) => !String(u).includes('/login'), { timeout: 30_000 }).catch(() => {})
  await page.waitForLoadState('load', { timeout: 60_000 }).catch(() => {})
  // 等 UI 就绪（composer 或消息区出现）
  await page.waitForTimeout(4000)
  const composerCandidates = [
    'textarea',
    '[contenteditable="true"]',
    '[placeholder*="输入"]',
    '[placeholder*="询问"]',
    '[placeholder*="消息"]',
  ]
  let composer = null
  for (const sel of composerCandidates) {
    const all = page.locator(sel)
    const n = await all.count()
    for (let i = n - 1; i >= 0; i--) {
      const cand = all.nth(i)
      if (await cand.isVisible().catch(() => false)) { composer = cand; break }
    }
    if (composer !== null) break
  }
  if (composer === null) {
    await page.screenshot({ path: join(OUT, 'debug-no-composer.png'), fullPage: true })
    writeFileSync(join(OUT, 'debug-page-text.txt'), await page.innerText('body').catch(() => ''))
    throw new Error('找不到会话输入框（截图与页面文本已存 OUT）')
  }
  console.log('[gate-run] eterna UI 就绪，composer 已定位')

  const tabsSnapshot = async () => ({
    capturedAt: new Date().toISOString(),
    pages: context.pages().map((p) => ({ url: p.url(), title: '' })),
  })
  const withTitles = async (snap) => {
    for (const p of snap.pages) {
      const match = context.pages().find((pp) => pp.url() === p.url)
      if (match !== undefined) p.title = await match.title().catch(() => '')
    }
    return snap
  }
  const bodyTextOf = async () => (await page.innerText('body').catch(() => '')).slice(-6000)

  const runCase = async (kase) => {
    const dir = join(OUT, kase.id)
    mkdirSync(dir, { recursive: true })
    const record = { id: kase.id, prompt: kase.prompt, startedAt: new Date().toISOString(), observations: [] }
    const beforeTabs = await withTitles(await tabsSnapshot())
    record.observations.push({ at: new Date().toISOString(), kind: 'tabs-before', data: beforeTabs })

    // 发送话术
    await composer.click()
    await composer.fill('')
    await composer.fill(kase.prompt)
    const usedEnter = true
    await composer.press('Enter')
    record.observations.push({ at: new Date().toISOString(), kind: 'prompt-sent', data: { usedEnter } })

    // 轮询：会话尾部文本稳定（连续 2 次 5s 采样一致）或硬超时
    const t0 = Date.now()
    let stableSince = null
    let lastText = ''
    let intermediate = []
    while (Date.now() - t0 < kase.settle) {
      await page.waitForTimeout(5000)
      const text = await bodyTextOf()
      if (text !== lastText) {
        stableSince = null
        lastText = text
      } else if (stableSince === null) {
        stableSince = Date.now()
      } else if (Date.now() - stableSince >= 10_000) {
        break
      }
      const toolCalls = [...text.matchAll(/mcp__browser__(browser_[a-z]+)/g)].map((m) => m[1])
      if (toolCalls.length !== intermediate.length) intermediate = toolCalls
    }
    const settledText = await bodyTextOf()
    record.observations.push({ at: new Date().toISOString(), kind: 'session-tail-text', data: settledText })
    record.observations.push({
      at: new Date().toISOString(),
      kind: 'browser-tool-calls-observed-in-ui',
      data: [...new Set([...settledText.matchAll(/mcp__browser__(browser_[a-z]+)/g)].map((m) => m[1]))],
    })

    const afterTabs = await withTitles(await tabsSnapshot())
    record.observations.push({ at: new Date().toISOString(), kind: 'tabs-after', data: afterTabs })

    // 截图：eterna 会话 + agent 打开的每个非 eterna tab
    await page.screenshot({ path: join(dir, 'session.png'), fullPage: false })
    const shotDir = join(dir, 'tabs')
    mkdirSync(shotDir, { recursive: true })
    for (const p of context.pages()) {
      const url = p.url()
      if (!/^https?:/i.test(url) || url.includes('127.0.0.1') && url.includes(':50') === false && url.includes(ENV.url.split('//')[1].split('/')[0]) === false) {
        // eterna 自身页面跳过（url 含 eterna host）
      }
      if (/^https?:/i.test(url) && !url.includes(new URL(ENV.url).host)) {
        await p.screenshot({ path: join(shotDir, `tab-${String(Math.abs(hash(url)))}.png`), timeout: 10_000 }).catch(() => {})
      }
    }
    writeFileSync(join(dir, 'record.json'), `${JSON.stringify(record, null, 2)}\n`)
    console.log(`[gate-run] ${kase.id} 采集完成（观察 ${String(record.observations.length)} 条）`)
    return record
  }

  function hash(s) {
    let h = 0
    for (let i = 0; i < s.length; i++) h = ((h << 5) - h + s.charCodeAt(i)) | 0
    return h
  }

  const records = []
  for (const kase of CASES) records.push(await runCase(kase))
  writeFileSync(join(OUT, 'gate-run-summary.json'), `${JSON.stringify({ finishedAt: new Date().toISOString(), records }, null, 2)}\n`)
  console.log(`[gate-run] 全部采集完成 → ${OUT}（判定：由独立验收代理依据门禁文本复核）`)
  await context.close()
}

await main().catch((err) => {
  console.error('[gate-run] 失败：', err instanceof Error ? err.message : String(err))
  process.exit(1)
})
