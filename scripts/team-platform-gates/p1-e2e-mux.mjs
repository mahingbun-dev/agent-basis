// P1-T2 mux 流隔离 E2E:G-P1-08/09(双账号双上下文,浏览器内 WebSocket 帧协议)。
// 用法: node scripts/team-platform-gates/p1-e2e-mux.mjs [--base http://127.0.0.1:3211]
// 断言:
//   A(workspace/follow): baseline 含本人工作区;
//   B(workspace/follow): baseline 不含 A 的任何工作区(逐项 allows() 过滤生效);
//   B(session/follow A 的 sessionId): open 拒绝(remote-access/denied 或错误帧);
//   A(session/follow 本人): 正常开流;
//   B(HTTP session/list): A 的 sessionId 出现次数=0(T1 过滤的 E2E 佐证)。
import { createRequire } from 'node:module'
import { readdirSync, readFileSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { join, resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO = resolve(HERE, '../..')
const MAIN_REPO = '/Users/sunny/code/agent-basis'
const OUT = join(REPO, 'acceptance/team-platform/p1/evidence/mux-e2e')
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
if (!CHROME) throw new Error('找不到 CfT chromium')

const args = process.argv.slice(2)
const pick = (k) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : undefined }
const BASE = pick('--base') ?? 'http://127.0.0.1:3211'
const envText = readFileSync('/Users/sunny/code/agent-basis/.env', 'utf8')
const envVal = (k) => (envText.match(new RegExp('^' + k + '=(.*)$', 'm'))?.[1] ?? '').trim()
const ADMIN = { account: envVal('ETERNA_ACCESS_ADMIN_USER'), password: envVal('ETERNA_ACCESS_ADMIN_PASSWORD') }
const BOB = { account: 'tp-bob', password: 'tp-bob-pass-8' }

rmSync(join(OUT, 'profile-a'), { recursive: true, force: true })
rmSync(join(OUT, 'profile-b'), { recursive: true, force: true })
const ctxA = await chromium.launchPersistentContext(join(OUT, 'profile-a'), { executablePath: CHROME, headless: true, viewport: { width: 1280, height: 800 }, args: ['--no-sandbox'] })
const ctxB = await chromium.launchPersistentContext(join(OUT, 'profile-b'), { executablePath: CHROME, headless: true, viewport: { width: 1280, height: 800 }, args: ['--no-sandbox'] })

async function loginOnce(context, creds, tag) {
  const page = context.pages()[0] ?? await context.newPage()
  await page.goto(BASE + '/login', { waitUntil: 'networkidle' })
  if (await page.locator('#account').isVisible({ timeout: 3000 }).catch(() => false)) {
    await page.fill('#account', creds.account)
    await page.fill('#password', creds.password)
    await page.click('#go')
    await page.waitForTimeout(8000)
  }
  await page.waitForTimeout(2500)
  if (!String(page.url()).includes('/login')) return page
  throw new Error(`${tag} 登录未完成: url=${page.url()} body=${(await page.innerText('body').catch(() => '')).slice(0, 150)}`)
}

/** 登录(带一次重试——登录限速 5/min/ip+账号,统一 401 话术;失败退避 65s)。 */
async function login(context, creds, tag) {
  try {
    return await loginOnce(context, creds, tag)
  } catch {
    await new Promise(r => setTimeout(r, 65_000))
    return loginOnce(context, creds, tag)
  }
}

// 页面内同源 RPC(双 cookie 自动携带)
async function rpc(page, method, argsObj) {
  return page.evaluate(async ({ method, argsObj }) => {
    const rpcId = 'e2e-' + Math.random().toString(36).slice(2)
    const r = await fetch('/api/' + method, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ type: 'client-request', rpcId, method, payload: { args: argsObj } }),
    })
    return { status: r.status, body: await r.json().catch(() => null) }
  }, { method, argsObj })
}

// mux 流采集:open endpoint → 收集 frames.collectMs
async function muxFollow(page, endpoint, argsObj, collectMs = 5000) {
  return page.evaluate(async ({ endpoint, argsObj, collectMs }) => {
    const streamId = 'st-' + Math.random().toString(36).slice(2)
    const frames = []
    const errors = []
    const wsUrl = (location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + '/api/remote.mux'
    const ws = new WebSocket(wsUrl)
    const done = new Promise((resolve) => {
      const timer = setTimeout(() => { ws.close(); resolve() }, collectMs)
      ws.onmessage = (ev) => {
        let msg; try { msg = JSON.parse(String(ev.data)) } catch { return }
        if (msg.type === 'item' && msg.streamId === streamId) frames.push(msg.value)
        if (msg.type === 'error' || (msg.value && msg.value.error)) errors.push(msg.value ?? msg)
      }
      ws.onerror = () => { errors.push({ wsError: true }) }
      ws.onclose = () => { clearTimeout(timer); resolve() }
    })
    await new Promise((resolve) => { ws.onopen = () => resolve(); ws.onerror = () => resolve() })
    ws.send(JSON.stringify({ type: 'open', streamId, endpoint, payload: { args: argsObj } }))
    await done
    return { frames: frames.slice(0, 20), errors: errors.slice(0, 5) }
  }, { endpoint, argsObj, collectMs })
}

const report = { at: new Date().toISOString(), base: BASE, checks: {} }

// ── A 登录 + 自建一个会话 ──
const pageA = await login(ctxA, ADMIN, 'A')
const created = await rpc(pageA, 'session/create', { request: {} })
report.checks.aCreate = created
const aSessionId = created?.body?.result?.value?.sessionId ?? created?.body?.result?.value?.id ?? null
if (aSessionId === null) throw new Error('A 建会话失败:' + JSON.stringify(created).slice(0, 200))

// ── admin 建 tp-bob(幂等;重名走后缀;路由=/access/api/users POST,access 通道)──
const bobCreated = await pageA.evaluate(async ({ account, password }) => {
  const r = await fetch('/access/api/users', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ account, password, role: 'user' }),
  })
  return { status: r.status, body: await r.json().catch(() => null) }
}, BOB)
report.checks.bobCreate = bobCreated
report.checks.bobCreateOk = bobCreated.status === 200 || JSON.stringify(bobCreated.body).includes('已存在')

// ── B 登录 ──
const pageB = await login(ctxB, BOB, 'B')
const bSession = await rpc(pageB, 'session/list', {})
report.checks.bListHttp = bSession
const bListItems = bSession?.body?.result?.value?.items?.map(i => i.sessionId) ?? []
report.checks.bListHasA = bListItems.includes(aSessionId)

// ── mux:A 的 workspace/follow ──
const aFollow = await muxFollow(pageA, 'workspace/follow', {})
const aWsIds = (aFollow.frames.flatMap(f => f.value?.items ?? []).map(i => i.workspaceId)).filter(Boolean)
report.checks.aMuxWorkspaces = aWsIds
report.checks.aMuxDenied = JSON.stringify(aFollow.errors).includes('remote-access/denied')

// ── mux:B 的 workspace/follow(核心断言:B 不可见 A)──
const bFollow = await muxFollow(pageB, 'workspace/follow', {})
const bWsIds = (bFollow.frames.flatMap(f => f.value?.items ?? []).map(i => i.workspaceId)).filter(Boolean)
report.checks.bMuxWorkspaces = bWsIds
report.checks.bMuxSeesA = aWsIds.some(id => bWsIds.includes(id))

// ── mux:B follow A 的 sessionId(应拒) ──
const bSteal = await muxFollow(pageB, 'session/follow', { request: { address: { kind: 'session', sessionId: aSessionId }, lastSeq: 0 } }, 4000)
report.checks.bStealErrors = bSteal.errors
report.checks.bStealDenied = JSON.stringify(bSteal).includes('remote-access/denied') || (bSteal.frames.length === 0 && bSteal.errors.length > 0)

// ── mux:A follow 本人(应成功) ──
const aSelf = await muxFollow(pageA, 'session/follow', { request: { address: { kind: 'session', sessionId: aSessionId }, lastSeq: 0 } }, 4000)
report.checks.aSelfFollowWorks = aSelf.frames.length > 0 && !JSON.stringify(aSelf.errors).includes('remote-access/denied')

writeFileSync(join(OUT, 'record.json'), JSON.stringify(report, null, 2) + '\n')
await ctxA.close(); await ctxB.close()
rmSync(join(OUT, 'profile-a'), { recursive: true, force: true })
rmSync(join(OUT, 'profile-b'), { recursive: true, force: true })
console.log(JSON.stringify(report, null, 2))
const ok =
  report.checks.bListHasA === false &&
  report.checks.bMuxSeesA === false &&
  report.checks.bStealDenied === true &&
  report.checks.aSelfFollowWorks === true &&
  Array.isArray(report.checks.aMuxWorkspaces) && report.checks.aMuxWorkspaces.length >= 1
process.exit(ok ? 0 : 1)
