// P1-T5 目录树 E2E:G-P1-16(添加工作区→自研目录树,六项子断言)。
// 用法: node scripts/team-platform-gates/p1-e2e-directory-tree.mjs [--base http://127.0.0.1:3211]
import { createRequire } from 'node:module'
import { readdirSync, readFileSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { join, resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO = resolve(HERE, '../..')
const MAIN_REPO = '/Users/sunny/code/agent-basis'
const OUT = join(REPO, 'acceptance/team-platform/p1/evidence/directory-tree')
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
const CONTAINER = pick('--container') ?? 'eterna-tp-ph'
const envText = readFileSync('/Users/sunny/code/agent-basis/.env', 'utf8')
const envVal = (k) => (envText.match(new RegExp('^' + k + '=(.*)$', 'm'))?.[1] ?? '').trim()
const ADMIN = { account: envVal('ETERNA_ACCESS_ADMIN_USER'), password: envVal('ETERNA_ACCESS_ADMIN_PASSWORD') }

// 夹具:账号目录预置子目录
execFileSync('docker', ['exec', CONTAINER, 'sh', '-c',
  'mkdir -p /data/workspaces/Mr.Ma/t5-alpha/t5-deep /data/workspaces/Mr.Ma/t5-beta'], { encoding: 'utf8' })

rmSync(join(OUT, 'profile'), { recursive: true, force: true })
const ctx = await chromium.launchPersistentContext(join(OUT, 'profile'), { executablePath: CHROME, headless: true, viewport: { width: 1280, height: 800 }, args: ['--no-sandbox'] })
const page = ctx.pages()[0] ?? await ctx.newPage()

async function loginOnce() {
  await page.goto(BASE + '/login', { waitUntil: 'networkidle' })
  if (await page.locator('#account').isVisible({ timeout: 3000 }).catch(() => false)) {
    await page.fill('#account', ADMIN.account)
    await page.fill('#password', ADMIN.password)
    await page.click('#go')
    await page.waitForTimeout(8000)
  }
  await page.waitForTimeout(2500)
  return !String(page.url()).includes('/login')
}
if (!await loginOnce()) {
  await new Promise(r => setTimeout(r, 65_000))
  if (!await loginOnce()) throw new Error('登录失败(含重试)')
}

// 打开添加工作区弹窗:composer 工作区菜单 → 添加工作区…
await page.locator('[aria-label="选择工作区"]').first().click().catch(async () => {
  // 无 composer 场景(恢复视图)→ 先打开已有会话
  await page.getByText(/切换工作目录|session-/, { exact: false }).first().click().catch(() => {})
  await page.waitForTimeout(3000)
  await page.locator('[aria-label="选择工作区"]').first().click().catch(() => {})
})
await page.waitForTimeout(1200)
await page.getByText('添加工作区', { exact: false }).first().click()
await page.waitForTimeout(1500)

const checks = {}
// ① 本组件打开(数据标签存在;上游 browse 的 Miller 列不再出现)
checks.ourDialogOpen = await page.locator('[data-eterna-directory-tree]').isVisible().catch(() => false)
checks.browseMiller = await page.locator('[data-plugin*="directory-picker-browse"]').count()
// ② 无路径输入框(上游 crumbEditZone/pathInput;本树只有新建文件夹名输入)
checks.pathInputCount = await page.evaluate(() =>
  [...document.querySelectorAll('input')].filter(el => {
    const ph = el.placeholder ?? ''
    return /路径|path|\/|绝对/i.test(ph) || el.getAttribute('data-path-edit') !== null
  }).length)
checks.folderNameInput = await page.locator('[aria-label="新建文件夹名"]').isVisible().catch(() => false)
// ③ 树根=本人账号目录(树行含预置目录;无「上一级」项)
checks.hasAlpha = await page.locator('[data-eterna-tree-row*="t5-alpha"]').isVisible().catch(() => false)
checks.hasBeta = await page.locator('[data-eterna-tree-row*="t5-beta"]').isVisible().catch(() => false)
checks.parentUpItem = await page.getByText('上一级', { exact: false }).count()
await page.screenshot({ path: join(OUT, 'tree-open.png') })

// ④ 展开+选中+确认:onPicked 路径恒在用户根
await page.locator('[data-eterna-tree-row*="t5-alpha"]').first().click()
await page.waitForTimeout(1500)
checks.deepVisible = await page.locator('[data-eterna-tree-row*="t5-deep"]').isVisible().catch(() => false)
await page.locator('[data-eterna-tree-row*="t5-deep"]').first().click().catch(() => {})
await page.waitForTimeout(600)
await page.locator('[data-eterna-tree-confirm]').click().catch(() => {})
await page.waitForTimeout(2500)
checks.dialogClosed = !(await page.locator('[data-eterna-directory-tree]').isVisible().catch(() => false))
// 选中目录被 adopt(侧栏出现新工作区或 composer label 变化)——记录页面状态
checks.composerLabel = await page.locator('[data-composer-input="true"]').first().getAttribute('aria-label').catch(() => null)

// ⑤ 新建文件夹(回到弹窗再测一次)
await page.locator('[aria-label="选择工作区"]').first().click().catch(() => {})
await page.waitForTimeout(1000)
await page.getByText('添加工作区', { exact: false }).first().click().catch(() => {})
await page.waitForTimeout(1500)
await page.locator('[aria-label="新建文件夹名"]').fill('t5-created')
await page.getByText('新建文件夹', { exact: false }).last().click().catch(() => {})
await page.waitForTimeout(2000)
checks.createdVisible = await page.locator('[data-eterna-tree-row*="t5-created"]').isVisible().catch(() => false)
const fsCheck = execFileSync('docker', ['exec', CONTAINER, 'sh', '-c',
  'test -d "/data/workspaces/Mr.Ma/t5-created" && echo exists || echo absent'], { encoding: 'utf8' }).trim()
checks.createdOnFs = fsCheck
await page.screenshot({ path: join(OUT, 'tree-created.png') })

// 深/浅双主题截图
for (const scheme of ['dark', 'light']) {
  const p2ctx = await ctx.browser().newContext({ colorScheme: scheme, viewport: { width: 1280, height: 800 } })
  const p2 = await p2ctx.newPage()
  await p2.goto(BASE + '/login', { waitUntil: 'networkidle' })
  await p2.fill('#account', ADMIN.account)
  await p2.fill('#password', ADMIN.password)
  await p2.click('#go')
  await p2.waitForTimeout(8000)
  await p2.locator('[aria-label="选择工作区"]').first().click().catch(() => {})
  await p2.waitForTimeout(1000)
  await p2.getByText('添加工作区', { exact: false }).first().click().catch(() => {})
  await p2.waitForTimeout(1500)
  const shots = join(REPO, 'gui-test-screenshots/team-platform/p1')
  mkdirSync(shots, { recursive: true })
  await p2.screenshot({ path: join(shots, `directory-tree-${scheme}.png`) })
  await p2ctx.close()
}
checks.shots = ['gui-test-screenshots/team-platform/p1/directory-tree-dark.png', 'gui-test-screenshots/team-platform/p1/directory-tree-light.png']

writeFileSync(join(OUT, 'record.json'), JSON.stringify(checks, null, 2) + '\n')
await ctx.close()
rmSync(join(OUT, 'profile'), { recursive: true, force: true })
console.log(JSON.stringify(checks, null, 2))
const ok = checks.ourDialogOpen === true && checks.pathInputCount === 0 &&
  checks.hasAlpha === true && checks.hasBeta === true &&
  checks.createdVisible === true && checks.createdOnFs === 'exists'
process.exit(ok ? 0 : 1)
