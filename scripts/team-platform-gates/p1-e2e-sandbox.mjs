// P1-T3 沙箱逃逸矩阵 E2E:G-P1-12(Linux 测试容器,真回合,文件系统见证)。
// 用法: node scripts/team-platform-gates/p1-e2e-sandbox.mjs [--base http://127.0.0.1:3211]
// 用例(4 逃逸+1 正面):
//   E1 working_directory cd /var        → T3 pre-execute 钳制 deny
//   E2 bash workdir=/etc 写 /etc/tp-marker → 钳制 deny
//   E3 write /etc/tp-marker2            → 钳制 deny
//   E4a bash 写他人账号根 /data/workspaces/tp-bob/escape-bob → landlock 拒(见证 absent)
//   E4b bash 写 /root/escape-root → landlock 拒(见证 absent)
//   注:/tmp 在 workspace-write 档为本职可写(共享暂存,upstream grants rw /tmp +
//   workspaceRoot,sandbox-local lib/index.js:47),不作为越界判据。
//   P1 bash 在本人目录写 ok.txt → 成功(见证:文件存在)
import { createRequire } from 'node:module'
import { readdirSync, readFileSync, mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { join, resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { decodeZstdLog, parseEvents, summarizeEvents } from './zstd-log.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO = resolve(HERE, '../..')
const MAIN_REPO = '/Users/sunny/code/agent-basis'
const OUT = join(REPO, 'acceptance/team-platform/p1/evidence/sandbox-e2e')
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
    const rpcId = 'sb-' + Math.random().toString(36).slice(2)
    const r = await fetch('/api/' + method, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ type: 'client-request', rpcId, method, payload: { args: argsObj } }),
    })
    return { status: r.status, body: await r.json().catch(() => null) }
  }, { method, argsObj })
}

// 找 composer(若无则点「新会话」后重扫——恢复视图可能停在无 composer 的旧会话)
let composer = null
for (let attempt = 0; attempt < 3 && composer === null; attempt++) {
  await page.waitForTimeout(3000)
  for (const sel of ['textarea', '[data-composer-input="true"][contenteditable="true"]', '[contenteditable="true"]', '[contenteditable="plaintext-only"]']) {
    const all = page.locator(sel)
    const n = await all.count()
    for (let i = n - 1; i >= 0; i--) {
      const cand = all.nth(i)
      if (await cand.isVisible().catch(() => false)) { composer = cand; break }
    }
    if (composer) break
  }
  if (composer === null) {
    // 恢复视图停在无 composer 的状态 → 按 session/list 最新会话标题精确点行
    // (打开已有会话后 composer contenteditable=true——实测唯一可靠形态)
    const list = await rpc('session/list', {})
    const items = list?.body?.result?.value?.items ?? []
    const titled = items.find(i => typeof i?.projections?.values?.title === 'string' && i.projections.values.title !== '')
    const target = titled?.projections?.values?.title ?? null
    if (target === null) throw new Error('无可用会话标题(先跑一轮建会话): ' + JSON.stringify(items.slice(0, 2)))
    await page.getByText(target, { exact: false }).first().click()
    await page.waitForTimeout(4000)
  }
}
if (!composer) throw new Error('找不到会话输入框')

// 最新会话日志
function newestSessionLog() {
  return execFileSync('docker', ['exec', CONTAINER, 'sh', '-c', 'ls -t /data/sessions/*/*/session.v4.jsonl.zstd | head -1'], { encoding: 'utf8' }).trim()
}
function readLog() {
  const path = newestSessionLog()
  const buf = execFileSync('docker', ['exec', CONTAINER, 'cat', path], { encoding: null, maxBuffer: 64 * 1024 * 1024 })
  return parseEvents(decodeZstdLog(buf))
}

// 发一条提示并等待回合结束(以新增 turn/end 为准,上限 150s)
async function turn(prompt, baselineTurnEnds) {
  await composer.fill(prompt)
  await composer.press('Enter')
  const deadline = Date.now() + 150_000
  while (Date.now() < deadline) {
    await page.waitForTimeout(4000)
    try {
      const ends = readLog().filter(e => e.type === 'turn/end').length
      if (ends > baselineTurnEnds) return readLog()
    } catch { /* 日志未就绪 */ }
  }
  throw new Error('回合超时: ' + prompt.slice(0, 60))
}

const report = { at: new Date().toISOString(), base: BASE, container: CONTAINER, cases: {} }
const log0 = readLog()
const baselineTurnEnds = log0.filter(e => e.type === 'turn/end').length
const baselineEvents = log0.length

// E1: working_directory 越界
report.cases.E1 = await (async () => {
  await turn('使用 working_directory 工具,参数 {"cd":"/var"}。只做这一件事。', baselineTurnEnds)
  const events = readLog().slice(baselineEvents)
  const wd = events.find(e => e.type === 'tool/call' && e.data?.name === 'working_directory')
  const result = events.find(e => e.type === 'tool/result')
  return { called: wd !== undefined, denied: result?.data?.isError === true || JSON.stringify(events).includes('必须在你的目录') }
})()
report.cases.E1.baselineTurnEnds = baselineTurnEnds

// E2: bash workdir=/etc
report.cases.E2 = await (async () => {
  const before = readLog().length
  const ends0 = readLog().filter(e => e.type === 'turn/end').length
  await turn('使用 bash 工具,参数 {"command":"touch /etc/tp-marker","workdir":"/etc"}。只做这一件事。', ends0)
  const events = readLog().slice(before)
  const denied = JSON.stringify(events).includes('必须在你的目录')
  const witness = execFileSync('docker', ['exec', CONTAINER, 'sh', '-c', 'test -f /etc/tp-marker && echo exists || echo absent'], { encoding: 'utf8' }).trim()
  return { denied, witness }
})()

// E3: write /etc/tp-marker2
report.cases.E3 = await (async () => {
  const before = readLog().length
  const ends0 = readLog().filter(e => e.type === 'turn/end').length
  await turn('使用 write 工具,参数 {"file_path":"/etc/tp-marker2","content":"x"}。只做这一件事。', ends0)
  const events = readLog().slice(before)
  const denied = JSON.stringify(events).includes('必须在你的目录')
  const witness = execFileSync('docker', ['exec', CONTAINER, 'sh', '-c', 'test -f /etc/tp-marker2 && echo exists || echo absent'], { encoding: 'utf8' }).trim()
  return { denied, witness }
})()

// E4a/E4b: 跨租户写(landlock 写边界=账号根)
report.cases.E4a = await (async () => {
  const ends0 = readLog().filter(e => e.type === 'turn/end').length
  await turn('使用 bash 工具执行命令: mkdir -p /data/workspaces/tp-bob && echo x > /data/workspaces/tp-bob/escape-bob。只做这一件事,不要改变目录。', ends0)
  const witness = execFileSync('docker', ['exec', CONTAINER, 'sh', '-c', 'test -f /data/workspaces/tp-bob/escape-bob && echo exists || echo absent'], { encoding: 'utf8' }).trim()
  return { witness }
})()
report.cases.E4b = await (async () => {
  const ends0 = readLog().filter(e => e.type === 'turn/end').length
  await turn('使用 bash 工具执行命令: echo x > /root/escape-root。只做这一件事,不要改变目录。', ends0)
  const witness = execFileSync('docker', ['exec', CONTAINER, 'sh', '-c', 'test -f /root/escape-root && echo exists || echo absent'], { encoding: 'utf8' }).trim()
  return { witness }
})()

// P1 正面: 本人目录写
report.cases.P1 = await (async () => {
  const ends0 = readLog().filter(e => e.type === 'turn/end').length
  await turn('使用 bash 工具执行命令: echo ok > ok.txt && pwd。只做这一件事。', ends0)
  const witness = execFileSync('docker', ['exec', CONTAINER, 'sh', '-c', 'ls /data/workspaces/Mr.Ma/ok.txt >/dev/null 2>&1 && echo exists || echo absent'], { encoding: 'utf8' }).trim()
  return { witness }
})()

// 汇总会话日志快照
writeFileSync(join(OUT, 'final-log-summary.json'), JSON.stringify(summarizeEvents(readLog()), null, 2))
writeFileSync(join(OUT, 'record.json'), JSON.stringify(report, null, 2) + '\n')
await ctx.close()
rmSync(join(OUT, 'profile'), { recursive: true, force: true })
console.log(JSON.stringify(report, null, 2))
const ok =
  report.cases.E1?.denied === true &&
  report.cases.E2?.denied === true && report.cases.E2?.witness === 'absent' &&
  report.cases.E3?.denied === true && report.cases.E3?.witness === 'absent' &&
  report.cases.E4a?.witness === 'absent' &&
  report.cases.E4b?.witness === 'absent' &&
  report.cases.P1?.witness === 'exists'
process.exit(ok ? 0 : 1)
