// P6 GUI 截图(2026-11-18):我的插件装载徽标/扫描导入 + 共享工具分区,深浅两主题。
// 入口 = 侧栏「插件」→ 页签(2026-11-11 起「我的插件」自设置弹窗迁入 plugins.tab;
// 设置齿轮里已无本分区,旧脚本点齿轮只会截到首页)。
// 同时做一次真实点击链路断言:点「启用」→ 行徽标变「已装载」——纯截图不断言
// 会漏掉客户端信封缺陷(裸 body→400,分区永不渲染;2026-11-18 事故)。
// 前置:p6-e2e-personal-mount.mjs 已跑完(容器内已有个人行+共享行);独立测试容器,零生产接触。
// 用法:node scripts/team-platform-gates/p6-gui-shots.mjs [--base http://127.0.0.1:3213]
import { createRequire } from 'node:module'
import { readdirSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const MAIN_REPO = resolve(HERE, '../..')
const OUT = join(MAIN_REPO, 'gui-test-screenshots/tenant-plugins-1118')
mkdirSync(OUT, { recursive: true })

const req = createRequire(join(MAIN_REPO, 'packages/browser-relay/package.json'))
const { chromium } = req('playwright-core')
function findChromiumBinary(dir, d = 12) {
  if (d < 0) return null
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name)
    if (e.isDirectory()) { const r = findChromiumBinary(p, d - 1); if (r !== null) return r }
    else if (p.endsWith('/Chromium.app/Contents/MacOS/Chromium') || p.endsWith('/chrome')) return p
  }
  return null
}
const CHROME = findChromiumBinary(join(MAIN_REPO, 'packages/browser-relay/smoke/.browsers/chromium'))
const args = process.argv.slice(2)
const pick = (k) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : undefined }
const BASE = pick('--base') ?? 'http://127.0.0.1:3213'
const envText = readFileSync(join(MAIN_REPO, '.env'), 'utf8')
const envVal = (k) => (envText.match(new RegExp('^' + k + '=(.*)$', 'm'))?.[1] ?? '').trim()
const ADMIN = { account: envVal('ETERNA_ACCESS_ADMIN_USER'), password: envVal('ETERNA_ACCESS_ADMIN_PASSWORD') }
if (ADMIN.account === '' || ADMIN.password === '') throw new Error('.env 缺 ETERNA_ACCESS_ADMIN_USER/PASSWORD')

/** 登录并打开侧栏「插件」页。 */
async function openPluginsPage(page) {
  await page.goto(BASE + '/login', { waitUntil: 'networkidle' })
  await page.fill('#account', ADMIN.account)
  await page.fill('#password', ADMIN.password)
  await page.click('#go')
  await page.waitForTimeout(9000)
  await page.getByText('插件', { exact: true }).first().click()
  await page.waitForTimeout(2500)
}

const checks = {}
const browser = await chromium.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox'] })
try {
  for (const scheme of ['light', 'dark']) {
    const ctx = await browser.newContext({ colorScheme: scheme, viewport: { width: 1280, height: 900 } })
    const page = await ctx.newPage()
    const bad = []
    page.on('response', (r) => { if (r.url().includes('/api/my-plugins/') && r.status() !== 200) bad.push({ status: r.status(), url: r.url() }) })

    await openPluginsPage(page)
    // ── 我的插件页签 ──
    await page.getByRole('tab', { name: '我的插件' }).first().click()
    await page.waitForTimeout(4000)
    const mine = page.locator('[data-eterna-my-plugins]').first()
    if (!(await mine.isVisible().catch(() => false))) throw new Error(`${scheme}:我的插件分区未渲染`)
    checks[`${scheme}.rows`] = await page.locator('[data-eterna-plugin-row]').evaluateAll(els => els.map(e => ({
      id: e.getAttribute('data-eterna-plugin-row'),
      mount: e.querySelector('[data-eterna-plugin-mount]')?.getAttribute('data-eterna-plugin-mount'),
    })))
    await page.screenshot({ path: join(OUT, `my-plugins-${scheme}.png`) })

    // 真实点击链路:个人行「启用」→ 徽标变 mounted(证明浏览器 RPC 真通)
    const enableBtn = page.locator('[data-eterna-plugin-row] button', { hasText: '启用' }).first()
    if (await enableBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
      await enableBtn.click()
      await page.waitForTimeout(3500)
      const after = await page.locator('[data-eterna-plugin-row] [data-eterna-plugin-mount]').first().getAttribute('data-eterna-plugin-mount')
      checks[`${scheme}.enableClick`] = { afterMount: after }
      await page.screenshot({ path: join(OUT, `my-plugins-${scheme}-mounted.png`) })
      // 复位(停用),保证两主题起点一致
      const disableBtn = page.locator('[data-eterna-plugin-row] button', { hasText: '停用' }).first()
      if (await disableBtn.isVisible({ timeout: 2000 }).catch(() => false)) { await disableBtn.click(); await page.waitForTimeout(2500) }
    }
    // 扫描导入:点「扫描 plugins 目录」→ 空态或候选按钮
    const scanBtn = page.locator('[data-eterna-plugin-scan]').first()
    if (await scanBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
      await scanBtn.click()
      await page.waitForTimeout(2500)
      checks[`${scheme}.scanClick`] = (await mine.textContent() ?? '').replace(/\s+/gu, ' ').slice(0, 160)
    }

    // ── 恒灵插件页签 → 共享工具分区 ──
    await page.getByRole('tab', { name: '恒灵插件' }).first().click()
    await page.waitForTimeout(4000)
    const shared = page.locator('[data-eterna-shared-plugins]').first()
    if (!(await shared.isVisible().catch(() => false))) throw new Error(`${scheme}:共享工具分区未渲染`)
    checks[`${scheme}.shared`] = (await shared.textContent() ?? '').replace(/\s+/gu, ' ').slice(0, 200)
    await shared.scrollIntoViewIfNeeded().catch(() => {})
    await page.screenshot({ path: join(OUT, `shared-plugins-${scheme}.png`) })

    checks[`${scheme}.badRpc`] = bad
    await ctx.close()
  }
  const failed = Object.entries(checks).filter(([k, v]) => k.endsWith('.badRpc') ? Array.isArray(v) && v.length > 0 : false)
  if (failed.length > 0) throw new Error('存在非 200 的 my-plugins RPC:' + JSON.stringify(failed))
} finally {
  writeFileSync(join(OUT, 'gui-record.json'), JSON.stringify({ at: new Date().toISOString(), base: BASE, checks }, null, 2))
  await browser.close()
}
console.log('P6 GUI PASS —', JSON.stringify(checks, null, 2))
console.log('shots →', OUT)
