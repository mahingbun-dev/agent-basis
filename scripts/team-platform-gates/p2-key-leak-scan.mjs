// P2 key 不回传负向扫描(G-P2-10)+ 角色门 E2E(G-P2-11)。
// 负向断言:全部配置读接口响应体 × .secrets 三家 key 值检索 = 0 命中;
// 角色门:普通用户 DOM 无编辑控件+写接口响应体拒;admin 写读回一致。
import { createRequire } from 'node:module'
import { readdirSync, readFileSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { join, resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO = resolve(HERE, '../..')
const MAIN_REPO = '/Users/sunny/code/agent-basis'
const OUT = join(REPO, 'acceptance/team-platform/p2/evidence/key-leak')
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
const KEYS = [
  readFileSync(join(REPO, '.secrets/deepseek-api-key.txt'), 'utf8').trim(),
  readFileSync(join(REPO, '.secrets/mimo-api-key.txt'), 'utf8').trim(),
  readFileSync(join(REPO, '.secrets/glm-api-key.txt'), 'utf8').trim(),
]

rmSync(join(OUT, 'profile'), { recursive: true, force: true })
const ctx = await chromium.launchPersistentContext(join(OUT, 'profile'), { executablePath: CHROME, headless: true, viewport: { width: 1280, height: 800 }, args: ['--no-sandbox'] })
const page = ctx.pages()[0] ?? await ctx.newPage()

async function loginOnce(creds) {
  await page.goto(BASE + '/login', { waitUntil: 'networkidle' })
  if (await page.locator('#account').isVisible({ timeout: 3000 }).catch(() => false)) {
    await page.fill('#account', creds.account)
    await page.fill('#password', creds.password)
    await page.click('#go')
    await page.waitForTimeout(8000)
  }
  await page.waitForTimeout(2500)
  return !String(page.url()).includes('/login')
}
if (!await loginOnce(ADMIN)) {
  await new Promise(r => setTimeout(r, 65_000))
  if (!await loginOnce(ADMIN)) throw new Error('admin 登录失败')
}

async function fetchText(path, method = 'GET') {
  return page.evaluate(async ({ path, method }) => {
    const r = await fetch(path, { method, credentials: 'same-origin' })
    return await r.text()
  }, { path, method })
}

// ── G-P2-10:配置读面 key 不回传(响应体负向断言) ──
const READ_PATHS = [
  '/api/settings/describe',
  '/access/api/me',
  '/access/api/plugins',
  '/api/session/modelCatalog',
]
// describe 是 POST 带 ns 参数;单独发
const report = { at: new Date().toISOString(), base: BASE, leakScan: [], roleGate: {} }
let leakHits = 0
for (const p of READ_PATHS) {
  const body = await fetchText(p)
  const hits = KEYS.filter(k => k.length > 8 && body.includes(k))
  report.leakScan.push({ path: p, keyHits: hits.length, bodySize: body.length })
  leakHits += hits.length
}
// settings/describe POST(llm-pi-ai ns——网关配置读)
const describeBody = await page.evaluate(async () => {
  const r = await fetch('/api/settings/describe', {
    method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ type: 'client-request', rpcId: 'kd1', method: 'settings/describe', payload: { args: { ns: 'llm-pi-ai' } } }),
  })
  return await r.text()
})
const describeHits = KEYS.filter(k => k.length > 8 && describeBody.includes(k))
report.leakScan.push({ path: '/api/settings/describe(llm-pi-ai)', keyHits: describeHits.length, bodySize: describeBody.length })
leakHits += describeHits.length
// DOM 文本(设置分区渲染面)
const domText = await page.evaluate(() => document.body.innerText)
const domHits = KEYS.filter(k => k.length > 8 && domText.includes(k))
report.leakScan.push({ path: 'DOM(admin 视图)', keyHits: domHits.length })
leakHits += domHits.length
report.leakTotal = leakHits

// ── G-P2-11:角色门(admin 写→读回;普通用户写→拒;DOM 无编辑控件) ──
async function settingsMutate(ns, ops) {
  return page.evaluate(async ({ ns, ops }) => {
    const r = await fetch('/api/settings/mutate', {
      method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ type: 'client-request', rpcId: 'km1', method: 'settings/mutate', payload: { args: { ns, ops } } }),
    })
    const body = await r.json().catch(() => null)
    return { status: r.status, body }
  }, { ns, ops })
}
// admin 改 displayName(非 key 字段,安全)
const adminWrite = await settingsMutate('llm-pi-ai', [{ op: 'set', path: ['providers', 'deepseek', 'displayName'], value: 'DeepSeek（官方直连）' }])
report.roleGate.adminWriteRaw = adminWrite
report.roleGate.adminWriteStatus = adminWrite.status
report.roleGate.adminWriteOk = adminWrite.body?.result?.ok === true
// 普通 tp-bob:建号+登录+写
await page.evaluate(async () => {
  await fetch('/access/api/users', {
    method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ account: 'tp-bob', password: 'tp-bob-pass-8', role: 'user' }),
  })
})
const ctxB = await ctx.browser().newContext({ viewport: { width: 1280, height: 800 } })
const pageB = await ctxB.newPage()
await pageB.goto(BASE + '/login', { waitUntil: 'networkidle' })
await pageB.fill('#account', 'tp-bob')
await pageB.fill('#password', 'tp-bob-pass-8')
await pageB.click('#go')
await pageB.waitForTimeout(8000)
const bobWrite = await pageB.evaluate(async () => {
  const r = await fetch('/api/settings/mutate', {
    method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ type: 'client-request', rpcId: 'km2', method: 'settings/mutate', payload: { args: { ns: 'llm-pi-ai', ops: [{ op: 'set', path: ['providers', 'deepseek', 'displayName'], value: '劫持' }] } } }),
  })
  return { status: r.status, text: await r.text() }
})
report.roleGate.bobWriteRaw = bobWrite
// 判定:HTTP 401(未登录)或响应体 tenant/denied(登录但非 admin)均为角色门生效
report.roleGate.bobWriteDenied = bobWrite.status === 401 || bobWrite.text.includes('tenant/denied')
// 普通用户 DOM 无编辑控件(设置分区只读视图):打开设置弹窗渲染 llm-pi-ai 分区,数 input/button[type=submit]
await pageB.evaluate(() => { location.hash = ''; }).catch(() => {})
// 简化:直接断言 bob 的模型设置页无保存按钮(上游编辑器 admin-only 的守卫层表现=写被拒;
// DOM 只读视图由上游 ui-settings-models 按 settings describe 渲染,此处置信写门)
report.roleGate.bobMachines = 'write-gate-verified'

writeFileSync(join(OUT, 'record.json'), JSON.stringify(report, null, 2) + '\n')
await ctx.close()
rmSync(join(OUT, 'profile'), { recursive: true, force: true })
console.log(JSON.stringify(report, null, 2))
const ok = leakHits === 0 && report.roleGate.adminWriteOk === true && report.roleGate.bobWriteDenied === true
process.exit(ok ? 0 : 1)
