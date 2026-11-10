// PH 阶段浏览器 E2E:G-PH-02(完全权限回合零审批)+ G-PH-03(眼睛零位移)。
// 用法: node scripts/team-platform-gates/ph-e2e.mjs --case eye-shift|fullaccess-turn [--base http://127.0.0.1:3211]
// 浏览器:CfT chromium(主仓 browser-relay smoke/.browsers)+ playwright-core(browser-relay deps)。
import { createRequire } from 'node:module'
import { readdirSync, readFileSync, mkdirSync, writeFileSync, existsSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join, resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { decodeZstdLog, parseEvents, summarizeEvents } from './zstd-log.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO = resolve(HERE, '../..')
const MAIN_REPO = '/Users/sunny/code/agent-basis'
const OUT = join(REPO, 'acceptance/team-platform/ph/evidence')
mkdirSync(OUT, { recursive: true })

// 依赖与浏览器定位(复用主仓已装 playwright-core 与 CfT chromium,工作树不重复安装)
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
if (!CHROME) throw new Error('找不到 CfT chromium(主仓 smoke/.browsers)')

// 管理员凭据:主仓 .env(测试容器由同一 .env 播种),只入进程内存
const envText = readFileSync('/Users/sunny/code/agent-basis/.env', 'utf8')
const envVal = (k) => (envText.match(new RegExp('^' + k + '=(.*)$', 'm'))?.[1] ?? '').trim()
const ADMIN = { account: envVal('ETERNA_ACCESS_ADMIN_USER'), password: envVal('ETERNA_ACCESS_ADMIN_PASSWORD') }

const args = process.argv.slice(2)
const pick = (k) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : undefined }
const CASE = pick('--case') ?? 'eye-shift'
const BASE = pick('--base') ?? 'http://127.0.0.1:3211'
const OUTCASE = join(OUT, CASE)
mkdirSync(OUTCASE, { recursive: true })

const ctx = await chromium.launchPersistentContext(join(OUTCASE, `profile-${Date.now()}`), {
  executablePath: CHROME, headless: true, viewport: { width: 1440, height: 900 },
  args: ['--no-sandbox'],
})
const page = ctx.pages()[0] ?? await ctx.newPage()

// ── 登录 ──────────────────────────────────────────────────────────────
const loginResp = await page.goto(BASE + '/login', { waitUntil: 'networkidle' })
const headers = loginResp.headers()
if (await page.locator('#account').isVisible({ timeout: 3000 }).catch(() => false)) {
  await page.fill('#account', ADMIN.account)
  await page.fill('#password', ADMIN.password)
  await page.click('#go')
  await page.waitForURL(u => !String(u).includes('/login'), { timeout: 20000 })
}
await page.waitForTimeout(4000)

const result = { case: CASE, base: BASE, loginHeaders: headers, at: new Date().toISOString() }

if (CASE === 'eye-shift') {
  // ── G-PH-03:眼睛零位移(新开无缓存上下文;断言 no-store + 点击前后 boundingBox 不变) ──
  const ctx2 = await ctx.browser().newContext({ viewport: { width: 1440, height: 900 } })
  const p2 = await ctx2.newPage()
  const resp = await p2.goto(BASE + '/login', { waitUntil: 'networkidle' })
  result.freshCacheControl = resp.headers()['cache-control'] ?? null
  const before = {
    input: await p2.locator('#password').boundingBox(),
    field: await p2.locator('#password').locator('xpath=ancestor::div[contains(@class,"field")]').first().boundingBox(),
    body: { w: await p2.evaluate(() => document.body.scrollWidth), h: await p2.evaluate(() => document.body.scrollHeight) },
  }
  const eyeBtn = p2.locator('#password').locator('xpath=ancestor::div[contains(@class,"field")]//button').first()
  await eyeBtn.click()
  await p2.waitForTimeout(300)
  const after = {
    input: await p2.locator('#password').boundingBox(),
    field: await p2.locator('#password').locator('xpath=ancestor::div[contains(@class,"field")]').first().boundingBox(),
    body: { w: await p2.evaluate(() => document.body.scrollWidth), h: await p2.evaluate(() => document.body.scrollHeight) },
  }
  const d = (a, b) => a && b ? { dx: Math.round((b.x - a.x) * 10) / 10, dy: Math.round((b.y - a.y) * 10) / 10 } : null
  result.eyeShift = { input: d(before.input, after.input), field: d(before.field, after.field), body: { w: before.body.w - after.body.w, h: before.body.h - after.body.h } }
  result.eyeVisibleAfter = await p2.locator('#password').getAttribute('type')
  // 深/浅两主题截图(登录页眼睛区)
  for (const scheme of ['dark', 'light']) {
    const p3 = await ctx.browser().newContext({ colorScheme: scheme, viewport: { width: 1440, height: 900 } }).then(c => c.newPage())
    await p3.goto(BASE + '/login', { waitUntil: 'networkidle' })
    const shots = join(REPO, 'gui-test-screenshots/team-platform/ph')
    mkdirSync(shots, { recursive: true })
    await p3.screenshot({ path: join(shots, `login-eye-${scheme}.png`) })
    await p3.context().close()
  }
  result.screenshots = ['gui-test-screenshots/team-platform/ph/login-eye-dark.png', 'gui-test-screenshots/team-platform/ph/login-eye-light.png']
  await ctx2.close()
}

if (CASE === 'fullaccess-turn') {
  // ── G-PH-02:完全权限模式下 bash 回合零审批(轨迹级断言) ──
  // 等 composer
  let composer = null
  for (const sel of ['textarea', '[contenteditable="true"]']) {
    const all = page.locator(sel)
    const n = await all.count()
    for (let i = n - 1; i >= 0; i--) {
      const cand = all.nth(i)
      if (await cand.isVisible().catch(() => false)) { composer = cand; break }
    }
    if (composer) break
  }
  if (!composer) {
    await page.screenshot({ path: join(OUTCASE, 'debug-no-composer.png'), fullPage: true })
    throw new Error('找不到会话输入框')
  }
  // 切完全权限:访问模式按钮 → 完全权限 → 确认(若已是完全权限则无确认框,幂等跳过)
  const modeBtn = page.locator('[aria-label*="访问模式"]').first()
  await modeBtn.click()
  await page.waitForTimeout(600)
  await page.getByText('完全权限', { exact: false }).first().click()
  await page.waitForTimeout(600)
  // 确认对话框(两击):先勾选风险知悉复选框(勾前确认按钮 disabled),再点启用
  const checkbox = page.getByRole('checkbox').first()
  if (await checkbox.isVisible().catch(() => false)) { await checkbox.click(); await page.waitForTimeout(300) }
  const confirmBtn = page.getByRole('button', { name: /启用|确认/ }).first()
  await confirmBtn.click({ timeout: 5000 }).catch(async () => {
    // 无确认框=当前已是完全权限(幂等);或兜底勾 checkbox 重试
    const cb2 = page.locator('input[type="checkbox"]').first()
    if (await cb2.isVisible().catch(() => false)) { await cb2.click({ force: true }); await confirmBtn.click({ timeout: 5000 }) }
  })
  await page.waitForTimeout(600)
  await page.screenshot({ path: join(OUTCASE, 'mode-switched.png') })
  result.modeSwitch = 'clicked'
  // 发提示
  await composer.fill('请用 bash 工具执行 pwd,并把输出原样告诉我。不要做其他任何事。')
  await composer.press('Enter')
  // 轮询容器内最新会话日志直至本回合 turn/end(上限 180s)
  const deadline = Date.now() + 180_000
  let summary = null
  while (Date.now() < deadline) {
    await page.waitForTimeout(5000)
    try {
      const newest = execFileSync('docker', ['exec', 'eterna-tp-ph', 'sh', '-c',
        'ls -t /data/sessions/*/*/session.v4.jsonl.zstd | head -1'], { encoding: 'utf8' }).trim()
      const buf = execFileSync('docker', ['exec', 'eterna-tp-ph', 'cat', newest], { encoding: null, maxBuffer: 64 * 1024 * 1024 })
      const events = parseEvents(decodeZstdLog(buf))
      const ends = events.filter(e => e.type === 'turn/end')
      const userMsgs = events.filter(e => e.type === 'user/message')
      if (ends.length > 0 && userMsgs.length >= 2) { summary = summarizeEvents(events); break }
    } catch { /* boot 中,继续轮询 */ }
  }
  if (!summary) throw new Error('180s 内回合未完成(无 turn/end)')
  result.turn = summary
  result.verdictFacts = {
    zeroApprovalAsked: summary.askedCount === 0,
    noAutoReject: summary.autoRejectCount === 0,
    bashRan: summary.toolCalls.some(c => c.name === 'bash'),
    bashOk: summary.toolResults.length > 0 && summary.toolResults.every(r => !r.isError),
  }
  await page.screenshot({ path: join(OUTCASE, 'turn-done.png') })
}

writeFileSync(join(OUTCASE, 'record.json'), JSON.stringify(result, null, 2) + '\n')
await ctx.close()
console.log(JSON.stringify(result, null, 2))
const ok = CASE === 'eye-shift'
  ? (result.freshCacheControl === 'no-store' && Object.values(result.eyeShift).every(v => v === null || (v.dx === 0 && v.dy === 0) || (v.w === 0 && v.h === 0)))
  : Object.values(result.verdictFacts ?? {}).every(Boolean)
process.exit(ok ? 0 : 1)
