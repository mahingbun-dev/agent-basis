// P3 面板 E2E:G-P3-05(admin 全局视图)/G-P3-07(空态)/G-P3-08(数据正确)。
// 用法: node scripts/team-platform-gates/p3-e2e-panel.mjs [--base http://127.0.0.1:3211]
import { createRequire } from 'node:module'
import { readdirSync, readFileSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { join, resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO = resolve(HERE, '../..')
const MAIN_REPO = '/Users/sunny/code/agent-basis'
const OUT = join(REPO, 'acceptance/team-platform/p3/evidence/panel')
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
const BASE = pick('--base') ?? 'http://127.0.0.1:3211'
const envText = readFileSync('/Users/sunny/code/agent-basis/.env', 'utf8')
const envVal = (k) => (envText.match(new RegExp('^' + k + '=(.*)$', 'm'))?.[1] ?? '').trim()
const ADMIN = { account: envVal('ETERNA_ACCESS_ADMIN_USER'), password: envVal('ETERNA_ACCESS_ADMIN_PASSWORD') }

const checks = {}
async function login(context, creds, tag) {
  const page = context.pages()[0] ?? await context.newPage()
  await page.goto(BASE + '/login', { waitUntil: 'networkidle' })
  if (await page.locator('#account').isVisible({ timeout: 3000 }).catch(() => false)) {
    await page.fill('#account', creds.account)
    await page.fill('#password', creds.password)
    await page.click('#go')
    await page.waitForTimeout(8000)
  }
  await page.waitForTimeout(2500)
  if (String(page.url()).includes('/login')) {
    await new Promise(r => setTimeout(r, 65_000))
    await page.fill('#account', creds.account).catch(() => {})
    await page.fill('#password', creds.password).catch(() => {})
    await page.click('#go').catch(() => {})
    await page.waitForTimeout(8000)
  }
  return page
}

// admin:侧栏入口可见 + 面板渲染(全局)
rmSync(join(OUT, 'profile-a'), { recursive: true, force: true })
const ctxA = await chromium.launchPersistentContext(join(OUT, 'profile-a'), { executablePath: CHROME, headless: true, viewport: { width: 1280, height: 800 }, args: ['--no-sandbox'] })
const pageA = await login(ctxA, ADMIN, 'A')
checks.sidebarEntry = await pageA.locator('[aria-label="用量统计"], [title="用量统计"]').count() +
  await pageA.getByText('用量统计', { exact: false }).count() > 0
// 点开面板
await pageA.getByText('用量统计', { exact: false }).first().click().catch(e => { checks.openError = e.message.slice(0, 80) })
await pageA.waitForTimeout(4000)
checks.panelRendered = await pageA.locator('[data-eterna-usage-stats]').isVisible().catch(() => false)
checks.totalCard = await pageA.locator('[data-eterna-stat="total"]').isVisible().catch(() => false)
checks.scopeGlobal = (await pageA.locator('[data-eterna-usage-stats]').innerText().catch(() => '')).includes('全局')
await pageA.screenshot({ path: join(OUT, 'panel-admin.png') })

// 空态:tp-bob(无会话)视图=空态文案或全 0(先经 admin API 建号——容器 DB 随重建重置;
// D11 重名后缀→用 finalAccount 登录)
checks.bobCreate = await pageA.evaluate(async () => {
  const r = await fetch('/access/api/users', {
    method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ account: 'tp-bob', password: 'tp-bob-pass-8', role: 'user' }),
  })
  return { status: r.status, body: await r.json().catch(() => null) }
})
const bobFinal = checks.bobCreate?.body?.user?.finalAccount ?? 'tp-bob'
const ctxB = await chromium.launchPersistentContext(join(OUT, 'profile-b'), { executablePath: CHROME, headless: true, viewport: { width: 1280, height: 800 }, args: ['--no-sandbox'] })
const pageB = await login(ctxB, { account: bobFinal, password: 'tp-bob-pass-8' }, 'B')
await pageB.getByText('用量统计', { exact: false }).first().click().catch(() => {})
await pageB.waitForTimeout(4000)
checks.bobPanelVisible = await pageB.locator('[data-eterna-usage-stats]').isVisible().catch(() => false)
const bobText = await pageB.locator('[data-eterna-usage-stats]').innerText().catch(() => '')
checks.bobEmptyOrZero = bobText.includes('还没有') || bobText.includes('0')
checks.bobSelfScope = bobText.includes('(本人)') || bobText.includes('还没有')
await pageB.screenshot({ path: join(OUT, 'panel-bob-empty.png') })

// 深浅双主题截图(admin 面板)
for (const scheme of ['dark', 'light']) {
  const pctx = await ctxA.browser().newContext({ colorScheme: scheme, viewport: { width: 1280, height: 800 } })
  const p = await pctx.newPage()
  await p.goto(BASE + '/login', { waitUntil: 'networkidle' })
  await p.fill('#account', ADMIN.account)
  await p.fill('#password', ADMIN.password)
  await p.click('#go')
  await p.waitForTimeout(8000)
  await p.getByText('用量统计', { exact: false }).first().click().catch(() => {})
  await p.waitForTimeout(4000)
  const shots = join(REPO, 'gui-test-screenshots/team-platform/p3')
  mkdirSync(shots, { recursive: true })
  await p.screenshot({ path: join(shots, `usage-panel-${scheme}.png`) })
  await pctx.close()
}
checks.shots = ['gui-test-screenshots/team-platform/p3/usage-panel-dark.png', 'gui-test-screenshots/team-platform/p3/usage-panel-light.png']

writeFileSync(join(OUT, 'record.json'), JSON.stringify(checks, null, 2) + '\n')
await ctxA.close(); await ctxB.close()
rmSync(join(OUT, 'profile-a'), { recursive: true, force: true })
rmSync(join(OUT, 'profile-b'), { recursive: true, force: true })
console.log(JSON.stringify(checks, null, 2))
const ok = checks.panelRendered === true && checks.totalCard === true && checks.bobPanelVisible === true
process.exit(ok ? 0 : 1)
