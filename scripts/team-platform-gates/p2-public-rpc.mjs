// P2 公网 RPC 矩阵:三家直连经公网入口 session/create+selectModel+prompt 全链。
// 与浏览器同通路(HTTP /api + eterna_session+dsh cookie),无 UI 落座噪音。
import { createRequire } from 'node:module'
import { readdirSync, readFileSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { join, resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { decodeZstdLog, parseEvents, summarizeEvents } from './zstd-log.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO = resolve(HERE, '../..')
const MAIN_REPO = '/Users/sunny/code/agent-basis'
const OUT = join(REPO, 'acceptance/team-platform/p2/evidence/public-rpc')
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
const BASE = pick('--base') ?? 'https://eternity-electricity.cn:3210'
const CONTAINER = pick('--container') ?? 'eterna-agent'
const envText = readFileSync('/Users/sunny/code/agent-basis/.env', 'utf8')
const envVal = (k) => (envText.match(new RegExp('^' + k + '=(.*)$', 'm'))?.[1] ?? '').trim()
const ADMIN = { account: envVal('ETERNA_ACCESS_ADMIN_USER'), password: envVal('ETERNA_ACCESS_ADMIN_PASSWORD') }

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

async function rpc(method, argsObj) {
  return page.evaluate(async ({ method, argsObj }) => {
    const r = await fetch('/api/' + method, {
      method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ type: 'client-request', rpcId: 'pr-' + Math.random().toString(36).slice(2), method, payload: { args: argsObj } }),
    })
    const body = await r.json().catch(() => null)
    return { status: r.status, ok: body?.result?.ok === true, value: body?.result?.value, error: body?.result?.error ?? null }
  }, { method, argsObj })
}

function readLog() {
  const path = execFileSync('docker', ['exec', CONTAINER, 'sh', '-c', 'ls -t /data/sessions/*/*/session.v4.jsonl.zstd | head -1'], { encoding: 'utf8' }).trim()
  return parseEvents(decodeZstdLog(execFileSync('docker', ['exec', CONTAINER, 'cat', path], { encoding: null, maxBuffer: 64 * 1024 * 1024 })))
}

// 建新会话(守卫钳制 cwd=本人根;fresh selection 无 litellm 残留)
const created = await rpc('session/create', { request: {} })
const sessionId = created?.value?.sessionId ?? created?.value?.id ?? null
if (sessionId === null) throw new Error('建会话失败: ' + JSON.stringify(created).slice(0, 150))
console.log('fresh session:', sessionId)

const report = { at: new Date().toISOString(), base: BASE, sessionId, models: {} }
const MATRIX = [
  { provider: 'deepseek', model: 'deepseek-flash', prompt: '用一句话回答:1+1等于几?' },
  { provider: 'mimo', model: 'mimo-v2.6-pro', prompt: '用一句话回答:中国的首都是哪里?' },
  { provider: 'glm', model: 'glm-5.3-flash', prompt: '用一句话回答:天空为什么是蓝色的?' },
]
for (const m of MATRIX) {
  const sel = await rpc('session/selectModel', { request: { sessionId, provider: m.provider, model: m.model } })
  const baselineSeq = Math.max(...readLog().map(e => e.seq ?? 0), 0)
  const promptSent = await rpc('session/prompt', { request: {
    requestId: 'pub-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8),
    sessionId, mode: 'queue', clientTimeZone: 'Asia/Shanghai',
    content: [{ type: 'text', text: m.prompt }],
  } })
  const deadline = Date.now() + 150_000
  let delta = []
  while (Date.now() < deadline) {
    await page.waitForTimeout(4000)
    try {
      delta = readLog().filter(e => (e.seq ?? 0) > baselineSeq)
      if (delta.some(e => e.type === 'turn/end')) break
    } catch { /* 轮询 */ }
  }
  const errTurn = delta.find(e => e.type === 'turn/end' && e.data?.reason?.kind === 'error')
  const usage = delta.some(e => e.type === 'usage' || (e.type === 'assistant/message' && e.data?.usage))
  report.models[`${m.provider}/${m.model}`] = {
    selectStatus: sel.status, selectOk: sel.ok,
    promptOk: promptSent.ok,
    promptError: promptSent.error,
    turnEnd: delta.find(e => e.type === 'turn/end')?.data?.reason?.kind ?? null,
    error: errTurn ? JSON.stringify(errTurn.data?.reason).slice(0, 260) : null,
    usagePresent: usage,
    usageValue: delta.find(e => e.type === 'usage')?.data?.usage ?? delta.filter(e => e.type === 'assistant/message' && e.data?.usage).at(-1)?.data?.usage ?? null,
  }
}

writeFileSync(join(OUT, 'record.json'), JSON.stringify(report, null, 2) + '\n')
await ctx.close()
rmSync(join(OUT, 'profile'), { recursive: true, force: true })
console.log(JSON.stringify(report.models, null, 2))
const ok = Object.values(report.models).every(m => m.turnEnd === 'completed' && m.error === null && m.usagePresent)
process.exit(ok ? 0 : 1)
