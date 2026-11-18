// P6 GUI 截图(2026-11-18):我的插件装载徽标/扫描导入 + 恒灵插件共享分区,深浅两主题。
// 前置:p6-e2e-personal-mount.mjs 已跑完(容器内已有已装载插件);独立测试容器,零生产接触。
// 用法:node scripts/team-platform-gates/p6-gui-shots.mjs [--base http://127.0.0.1:3213]
import { createRequire } from 'node:module'
import { readdirSync, mkdirSync, rmSync } from 'node:fs'
import { readFileSync } from 'node:fs'
import { join, resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const MAIN_REPO = '/Users/sunny/code/agent-basis'
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

async function setTheme(page, theme) {
  await page.evaluate((t) => {
    for (const key of Object.keys(localStorage)) { if (key.includes('theme') || key.includes('Theme')) localStorage.removeItem(key) }
    localStorage.setItem('theme', t)
    localStorage.setItem('dsh-theme', t)
  }, theme).catch(() => {})
}

const themeOf = async (page) => page.evaluate(() => document.documentElement.className + '|' + getComputedStyle(document.documentElement).getPropertyValue('color-scheme'))

rmSync(join(OUT, 'profile'), { recursive: true, force: true })
const ctx = await chromium.launchPersistentContext(join(OUT, 'profile'), { executablePath: CHROME, headless: true, viewport: { width: 1280, height: 900 }, args: ['--no-sandbox'] })
const page = ctx.pages()[0] ?? await ctx.newPage()
await page.goto(BASE + '/login', { waitUntil: 'networkidle' })
await page.fill('#account', ADMIN.account)
await page.fill('#password', ADMIN.password)
await page.click('#go')
await page.waitForTimeout(9000)

// 打开设置弹窗,定位「我的插件」分区
const openSettings = async () => {
  await page.keyboard.press('Escape').catch(() => {})
  // 角标菜单 → 偏好设置(设置弹窗);按钮文案回退:依次尝试常见入口
  const badge = page.locator('[data-eterna-badge], #eterna-badge').first()
  if (await badge.isVisible({ timeout: 3000 }).catch(() => false)) {
    await badge.click()
    await page.waitForTimeout(600)
    const item = page.getByText('偏好设置', { exact: false }).first()
    if (await item.isVisible({ timeout: 2000 }).catch(() => false)) { await item.click(); await page.waitForTimeout(1200); return true }
    await page.keyboard.press('Escape')
  }
  return false
}
const dialog = page.locator('[role="dialog"], .dsh-modal, [data-eterna-access-root]').first()
let opened = await openSettings()
if (!opened) {
  // 直接调 DOM:设置弹窗由宿主 settings 服务承载,回退=直接对页面整页截图兜底
  console.warn('settings entry not found; fallback to full-page shots')
}

for (const theme of ['light', 'dark']) {
  await setTheme(page, theme)
  await page.waitForTimeout(800)
  await page.screenshot({ path: join(OUT, `settings-${theme}-full.png`) })
  const myPlugins = page.locator('[data-eterna-my-plugins]').first()
  if (await myPlugins.isVisible({ timeout: 2000 }).catch(() => false)) {
    await myPlugins.screenshot({ path: join(OUT, `my-plugins-${theme}.png`) })
  }
  const shared = page.locator('[data-eterna-shared-plugins]').first()
  if (await shared.isVisible({ timeout: 2000 }).catch(() => false)) {
    await shared.screenshot({ path: join(OUT, `shared-plugins-${theme}.png`) })
  }
  console.log(theme, 'scheme:', await themeOf(page))
}
await ctx.close()
console.log('shots →', OUT)
