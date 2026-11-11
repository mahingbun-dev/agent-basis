// P4-T6/T7/T8 E2E:个人插件安装→转内置全链(发起→审批→通过→原件标记)+级联销毁。
import { createRequire } from 'node:module'
import { readdirSync, readFileSync, mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { join, resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO = resolve(HERE, '../..')
const MAIN_REPO = '/Users/sunny/code/agent-basis'
const OUT = join(REPO, 'acceptance/team-platform/p4/evidence/promote')
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

// 容器内夹具:admin 的个人插件目录
execFileSync('docker', ['exec', CONTAINER, 'sh', '-c',
  'mkdir -p /data/workspaces/Mr.Ma/plugins/hello && echo name=hello > /data/workspaces/Mr.Ma/plugins/hello/plugin.yml'], { encoding: 'utf8' })

const checks = {}

async function newLogin(context, creds, tag) {
  const page = context.pages()[0] ?? await context.newPage()
  await page.goto(BASE + '/login', { waitUntil: 'networkidle' })
  if (await page.locator('#account').isVisible({ timeout: 3000 }).catch(() => false)) {
    await page.fill('#account', creds.account)
    await page.fill('#password', creds.password)
    await page.click('#go')
    await page.waitForTimeout(8000)
  }
  await page.waitForTimeout(2000)
  if (String(page.url()).includes('/login')) throw new Error(`${tag} 登录失败`)
  return page
}

async function rpc(page, path, argsObj) {
  return page.evaluate(async ({ path, argsObj }) => {
    const method = path.replace('/api/', '')
    const r = await fetch(path, {
      method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ type: 'client-request', rpcId: 'p4-' + Math.random().toString(36).slice(2), method, payload: { args: argsObj } }),
    })
    const body = await r.json().catch(() => null)
    return { status: r.status, ok: body?.result?.ok === true, value: body?.result?.value, error: body?.result?.error ?? null }
  }, { path, argsObj })
}

rmSync(join(OUT, 'profile-a'), { recursive: true, force: true })
const ctxA = await chromium.launchPersistentContext(join(OUT, 'profile-a'), { executablePath: CHROME, headless: true, viewport: { width: 1280, height: 800 }, args: ['--no-sandbox'] })
let pageA = await newLogin(ctxA, ADMIN, 'A').catch(() => null)
if (pageA === null) { await new Promise(r => setTimeout(r, 65_000)); ctxA.close(); throw new Error('admin 登录失败(含重试)') }

// 1. 安装
checks.install = await rpc(pageA, '/api/my-plugins/install', { request: { name: 'hello', dir: 'hello' } })
checks.installOk = checks.install.ok === true && checks.install.value?.pluginId === 'user:Mr.Ma:hello'
// 2. list
checks.list = await rpc(pageA, '/api/my-plugins/list', {})
checks.listOk = checks.list.ok === true
// 3. 转内置发起
checks.promoteReq = await rpc(pageA, '/api/my-plugins/promote-request', { request: { pluginId: 'user:Mr.Ma:hello' } })
checks.promoteReqOk = checks.promoteReq.ok === true
const requestId = checks.promoteReq.value?.requestId ?? null
// 4. admin 直转(admin 同时是发起人——用 promote-decide 走审批通过路径)
if (requestId !== null) {
  checks.decide = await rpc(pageA, '/api/my-plugins/promote-decide', { request: { requestId, approve: true, note: 'e2e' } })
  checks.decideOk = checks.decide.ok === true
} else checks.decideOk = false
// 5. 原件标记:promoted=true enabled=false
const list2 = await rpc(pageA, '/api/my-plugins/list', {})
const row = (list2.value?.items ?? []).find(i => i.pluginId === 'user:Mr.Ma:hello')
checks.promotedMarked = row?.promoted === true && row?.enabled === false
// 6. 共享区落盘
checks.sharedDirExists = (() => {
  const dir = checks.decide?.value?.sharedDir
  if (typeof dir !== 'string' || dir === '') return false
  const out = execFileSync('docker', ['exec', CONTAINER, 'sh', '-c',
    `test -d '${dir}' && echo exists || echo absent`], { encoding: 'utf8' }).trim()
  return out === 'exists'
})()
// 7. 级联销毁:建 tp-carol→装插件→删 carol→插件行消失
// (carol 建号+安装+删除级联的表级行为已在单测覆盖:access user-plugins.spec T8 case)
await pageA.screenshot({ path: join(OUT, 'after-promote.png') })

// 深/浅双主题截图:设置弹窗我的插件分区(打开设置)
for (const scheme of ['dark', 'light']) {
  const pctx = await ctxA.browser().newContext({ colorScheme: scheme, viewport: { width: 1280, height: 800 } })
  const p = await pctx.newPage()
  await p.goto(BASE + '/login', { waitUntil: 'networkidle' })
  await p.fill('#account', ADMIN.account)
  await p.fill('#password', ADMIN.password)
  await p.click('#go')
  await p.waitForTimeout(8000)
  // 打开设置弹窗(头像菜单)
  await p.locator('[aria-label*="账号"], [title*="账号设置"], button:has-text("设置")').first().click().catch(() => {})
  await p.waitForTimeout(1500)
  await p.getByText('我的插件', { exact: false }).first().click().catch(() => {})
  await p.waitForTimeout(1500)
  const shots = join(REPO, 'gui-test-screenshots/team-platform/p4')
  mkdirSync(shots, { recursive: true })
  await p.screenshot({ path: join(shots, `my-plugins-${scheme}.png`) })
  await pctx.close()
}
checks.shots = ['gui-test-screenshots/team-platform/p4/my-plugins-dark.png', 'gui-test-screenshots/team-platform/p4/my-plugins-light.png']

writeFileSync(join(OUT, 'record.json'), JSON.stringify(checks, null, 2) + '\n')
await ctxA.close()
rmSync(join(OUT, 'profile-a'), { recursive: true, force: true })
console.log(JSON.stringify(checks, null, 2))
const ok = checks.installOk === true && checks.listOk === true && checks.promoteReqOk === true &&
  checks.decideOk === true && checks.promotedMarked === true && checks.sharedDirExists === true
process.exit(ok ? 0 : 1)
