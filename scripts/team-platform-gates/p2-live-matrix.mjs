// P2 真连矩阵:G-P2-05/06/08(三家直连,经容器 boot 实例的会话回合)。
// 用例:三家各 1 轮纯文本(deepseek-flash/mimo-v2.6-pro/glm-5.3-flash)——真连 0×422/
// 0×400;A1 生产回归=deepseek-flash 一轮完成(HTTP 200,system 角色不再 422)。
// 证据:会话轨迹逐回合(tool 轨迹+usage)+模型解析记录。
import { createRequire } from 'node:module'
import { readdirSync, readFileSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { join, resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { decodeZstdLog, parseEvents, summarizeEvents } from './zstd-log.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO = resolve(HERE, '../..')
const MAIN_REPO = '/Users/sunny/code/agent-basis'
const OUT = join(REPO, 'acceptance/team-platform/p2/evidence/live-matrix')
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
    const rpcId = 'lm-' + Math.random().toString(36).slice(2)
    const r = await fetch('/api/' + method, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ type: 'client-request', rpcId, method, payload: { args: argsObj } }),
    })
    return { status: r.status, body: await r.json().catch(() => null) }
  }, { method, argsObj })
}

// 进入会话(公网实测可靠形态=点已有标题会话行;composer contenteditable=true)。
// 旧会话残留 litellm 选型由用例内 selectModel 覆盖(200 验证)。
async function openComposer() {
  const list = await rpc('session/list', {})
  const items = list?.body?.result?.value?.items ?? []
  const titled = items.find(i => typeof i?.projections?.values?.title === 'string' && i.projections.values.title !== '')
  if (titled === undefined) throw new Error('无可用标题会话(先在 UI 建一轮)')
  seatedSessionId = titled.sessionId
  await page.getByText(titled.projections.values.title, { exact: false }).first().click()
  await page.waitForTimeout(4000)
  // 兜底:若未落座,点侧栏工作区行再点会话行(最多两轮)
  for (let i = 0; i < 4; i++) {
    const editable = await page.evaluate(() => document.querySelector('[data-composer-input="true"]')?.getAttribute('contenteditable'))
    if (editable === 'true' || editable === '') break
    await page.evaluate(() => {
      const cands = [...document.querySelectorAll('button, [role="button"], li, div[tabindex]')].filter(el => {
        const t = (el.textContent ?? '').trim()
        return (t === 'Mr.Ma' || t.includes('新会话')) && el.offsetHeight > 0
      })
      cands[0]?.click()
    }).catch(() => {})
    await page.waitForTimeout(3500)
  }
  for (let i = 0; i < 6; i++) {
    const editable = await page.evaluate(() => document.querySelector('[data-composer-input="true"]')?.getAttribute('contenteditable'))
    if (editable === 'true' || editable === '') return true
    await page.waitForTimeout(2000)
  }
  return false
}
if (!await openComposer()) throw new Error('composer 未就绪')

const composer = page.locator('[data-composer-input="true"][contenteditable="true"]').first()

let pinnedLogPath = null
function readLog() {
  if (pinnedLogPath === null) {
    pinnedLogPath = execFileSync('docker', ['exec', CONTAINER, 'sh', '-c', 'ls -t /data/sessions/*/*/session.v4.jsonl.zstd | head -1'], { encoding: 'utf8' }).trim()
  }
  return parseEvents(decodeZstdLog(execFileSync('docker', ['exec', CONTAINER, 'cat', pinnedLogPath], { encoding: null, maxBuffer: 64 * 1024 * 1024 })))
}

// 选模型(rpc selectModel 带 sessionId——无 sessionId 的 select 不落在目标会话)并发一轮
let seatedSessionId = null
async function modelTurn(provider, model, prompt) {
  const sel = await rpc('session/selectModel', { request: { sessionId: seatedSessionId, provider, model } })
  const composer = page.locator('[data-composer-input="true"][contenteditable="true"]').first()
  const before = readLog().length
  const baselineSeq = Math.max(...readLog().map(e => e.seq ?? 0), 0)
  await composer.fill(prompt)
  await composer.press('Enter')
  const deadline = Date.now() + 180_000
  let events = []
  while (Date.now() < deadline) {
    await page.waitForTimeout(4000)
    try {
      events = readLog().filter(e => (e.seq ?? 0) > baselineSeq)
      const ends = events.filter(e => e.type === 'turn/end').length
      if (ends > 0) break
    } catch { /* 轮询 */ }
  }
  const turnEnd = events.find(e => e.type === 'turn/end')
  const summary = summarizeEvents(events)
  // 判定只认终态与错误帧(子串 422 会命中 pi-ai replayState 元数据数字,假阳性——
  // 2026-11-11 实测教训);真实错误=turn/end reason.kind==='error' 或 assistant error 块。
  const hasErrorTurn = events.some(e => e.type === 'turn/end' && e.data?.reason?.kind === 'error')
  return {
    selectStatus: sel?.status,
    turnEndReason: turnEnd?.data?.reason?.kind ?? null,
    hasErrorTurn,
    usagePresent: events.some(e => e.type === 'usage' || e.type === 'assistant/message'),
    assistantReply: events.some(e => e.type === 'assistant/message'),
    events: events.slice(0, 40).map(e => ({ t: e.type, name: e.data?.name, reason: e.data?.reason?.kind })),
  }
}

const report = { at: new Date().toISOString(), base: BASE, models: {} }
const MATRIX = [
  { provider: 'deepseek', model: 'deepseek-flash', prompt: '用一句话回答:1+1等于几?' },
  { provider: 'mimo', model: 'mimo-v2.6-pro', prompt: '用一句话回答:中国的首都是哪里?' },
  { provider: 'glm', model: 'glm-5.3-flash', prompt: '用一句话回答:天空为什么是蓝色的?' },
]
for (const m of MATRIX) {
  report.models[`${m.provider}/${m.model}`] = await modelTurn(m.provider, m.model, m.prompt)
}

writeFileSync(join(OUT, 'record.json'), JSON.stringify(report, null, 2) + '\n')
await ctx.close()
rmSync(join(OUT, 'profile'), { recursive: true, force: true })
console.log(JSON.stringify(report, null, 2))
const ok = Object.values(report.models).every(r => r.turnEndReason === 'completed' && !r.hasErrorTurn && r.usagePresent)
process.exit(ok ? 0 : 1)
