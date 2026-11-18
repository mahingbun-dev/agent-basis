// P6 E2E(2026-11-18):T6 个人插件装载器全链——安装→即刻装载→启停→转内置(真装载)
// →共享启停→重启持久化(bootScan)。独立测试容器(绝不触碰运行中的部署);
// 零模型调用:mount.ok 即宿主 ctx.tools.register 真实接受的进程内证据。
// 用法:node scripts/team-platform-gates/p6-e2e-personal-mount.mjs [--base http://127.0.0.1:3213] [--container eterna-tp-t6]
import { createRequire } from 'node:module'
import { readdirSync, mkdirSync, rmSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { join, resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const MAIN_REPO = '/Users/sunny/code/agent-basis'
const OUT = join(MAIN_REPO, 'acceptance/team-platform/p6/evidence/personal-mount')
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
const CONTAINER = pick('--container') ?? 'eterna-tp-t6'
const { readFileSync } = await import('node:fs')
const envText = readFileSync(join(MAIN_REPO, '.env'), 'utf8')
const envVal = (k) => (envText.match(new RegExp('^' + k + '=(.*)$', 'm'))?.[1] ?? '').trim()
const ADMIN = { account: envVal('ETERNA_ACCESS_ADMIN_USER'), password: envVal('ETERNA_ACCESS_ADMIN_PASSWORD') }
if (ADMIN.account === '' || ADMIN.password === '') throw new Error('.env 缺 ETERNA_ACCESS_ADMIN_USER/PASSWORD')

const docker = (cmd) => execFileSync('docker', cmd, { encoding: 'utf8' }).trim()

// ── 容器就绪等待 ──
const deadline = Date.now() + 180_000
let ready = false
while (Date.now() < deadline && !ready) {
  try { ready = docker(['exec', CONTAINER, 'sh', '-c', 'wget -qO- http://127.0.0.1:8080/login | head -c 32']).length > 0 } catch { await new Promise(r => setTimeout(r, 3000)) }
}
if (!ready) throw new Error('容器 /login 未就绪(180s)')
console.log('container ready:', CONTAINER, BASE)

// ── 夹具:admin 个人工具插件(最小契约,含 package.json+index.js) ──
const acc = ADMIN.account
docker(['exec', CONTAINER, 'sh', '-c', [
  `mkdir -p /data/workspaces/${acc}/plugins/hello`,
  `cat > /data/workspaces/${acc}/plugins/hello/package.json <<'EOF'`,
  '{"name":"fixture-hello","version":"0.0.0","type":"module","main":"index.js"}',
  'EOF',
  `cat > /data/workspaces/${acc}/plugins/hello/index.js <<'EOF'`,
  'export function apply(ctx) {',
  '  ctx.tools.register({ name: "greet", description: "fixture greet", parameters: {},',
  '    output: { schema: { type: "string" }, render: (_a, v) => [{ type: "text", text: String(v) }] },',
  '    execute() { return "hi" } })',
  '}',
  'EOF',
  `mkdir -p /data/workspaces/${acc}/plugins/stray`, // scan 夹具:未登记目录
].join(' && ')])

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
    const r = await fetch(path, {
      method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ type: 'client-request', rpcId: 'p6-' + Math.random().toString(36).slice(2), method: path.replace('/api/', ''), payload: { args: argsObj } }),
    })
    const body = await r.json().catch(() => null)
    return { status: r.status, ok: body?.result?.ok === true, value: body?.result?.value, error: body?.result?.error ?? null }
  }, { path, argsObj })
}

rmSync(join(OUT, 'profile-a'), { recursive: true, force: true })
const ctxA = await chromium.launchPersistentContext(join(OUT, 'profile-a'), { executablePath: CHROME, headless: true, viewport: { width: 1280, height: 800 }, args: ['--no-sandbox'] })
let pageA = await newLogin(ctxA, ADMIN, 'A').catch(() => null)
if (pageA === null) { await new Promise(r => setTimeout(r, 65_000)); ctxA.close(); throw new Error('admin 登录失败(含重试)') }

try {
  // 1. 安装即装载
  const install = await rpc(pageA, '/api/my-plugins/install', { request: { name: 'hello', dir: 'hello' } })
  checks.install = { ok: install.ok, pluginId: install.value?.pluginId, mount: install.value?.mount ?? null }
  if (!install.ok) throw new Error('install 失败:' + JSON.stringify(install.error))
  if (install.value?.mount?.ok !== true) throw new Error('mount 未即时生效:' + JSON.stringify(install.value))
  const nsTool = install.value.mount.tools?.[0]
  if (nsTool !== `user_${acc}_greet`) throw new Error('工具名命名空间不符:' + String(nsTool))

  // 2. list 下发装载态
  const list1 = await rpc(pageA, '/api/my-plugins/list', {})
  const item1 = list1.value?.items?.find(i => i.pluginId === `user:${acc}:hello`)
  checks.listMounted = { mounted: item1?.mounted === true, tools: item1?.tools ?? [] }

  // 3. scan 发现未登记目录
  const scan = await rpc(pageA, '/api/my-plugins/scan', {})
  checks.scan = { items: scan.value?.items?.map(i => i.dirName) ?? [] }

  // 4. disable 即时卸载 → enable 即时重挂
  await rpc(pageA, '/api/my-plugins/disable', { request: { pluginId: `user:${acc}:hello` } })
  const list2 = await rpc(pageA, '/api/my-plugins/list', {})
  checks.disableUnmounts = list2.value?.items?.find(i => i.pluginId === `user:${acc}:hello`)?.mounted === false
  await rpc(pageA, '/api/my-plugins/enable', { request: { pluginId: `user:${acc}:hello` } })
  const list3 = await rpc(pageA, '/api/my-plugins/list', {})
  checks.enableRemounts = list3.value?.items?.find(i => i.pluginId === `user:${acc}:hello`)?.mounted === true

  // 5. 截图:我的插件分区(装载徽标)
  const shot = join(OUT, 'my-plugins.png')
  await pageA.evaluate(() => { document.querySelector('[data-eterna-my-plugins]')?.scrollIntoView({ block: 'center' }) }).catch(() => {})
  const section = pageA.locator('[data-eterna-my-plugins]')
  if (await section.isVisible({ timeout: 3000 }).catch(() => false)) await section.screenshot({ path: shot }).catch(() => {})
  checks.screenshot = shot

  // 6. 转内置(admin 直转)= 共享行记账 + 全局装载
  const promote = await rpc(pageA, '/api/my-plugins/promote-direct', { request: { pluginId: `user:${acc}:hello` } })
  checks.promote = { ok: promote.ok, promoted: promote.value?.promoted, mount: promote.value?.mount ?? null, error: promote.error?.message ?? null }
  const sharedList = await rpc(pageA, '/api/my-plugins/shared/list', {})
  checks.sharedList = { mounted: sharedList.value?.items?.[0]?.mounted === true, enabled: sharedList.value?.items?.[0]?.enabled, tools: sharedList.value?.items?.[0]?.tools ?? [] }

  // 7. 共享停用 = 即时卸载
  await rpc(pageA, '/api/my-plugins/shared/disable', { request: { pluginId: `user:${acc}:hello` } })
  const sharedList2 = await rpc(pageA, '/api/my-plugins/shared/list', {})
  checks.sharedDisable = { enabled: sharedList2.value?.items?.[0]?.enabled === false, mounted: sharedList2.value?.items?.[0]?.mounted === false }

  // 8. 重启容器:bootScan 按账本重挂——停用的共享不复活,重启后重新启用即恢复
  //    (重启持久化 = 用户「重启也不丢」的兜底;免重启是主路径,本步验证账本真源)
  docker(['restart', CONTAINER])
  const deadline2 = Date.now() + 180_000
  let ready2 = false
  while (Date.now() < deadline2 && !ready2) {
    try { ready2 = docker(['exec', CONTAINER, 'sh', '-c', 'wget -qO- http://127.0.0.1:8080/login | head -c 32']).length > 0 } catch { await new Promise(r => setTimeout(r, 3000)) }
  }
  if (!ready2) throw new Error('重启后 /login 未就绪')
  await pageA.goto(BASE + '/', { waitUntil: 'domcontentloaded' }).catch(() => {})
  await pageA.waitForTimeout(8000)
  if (String(pageA.url()).includes('/login')) await newLogin(ctxA, ADMIN, 'A2')
  const list4 = await rpc(pageA, '/api/my-plugins/list', {})
  // 转内置后个人原件 enabled=0 → 重启后个人行不装载;shared disabled 也不装载
  checks.afterRestart = {
    personalRow: list4.value?.items?.find(i => i.pluginId === `user:${acc}:hello`) ?? null,
    sharedListMounted: (await rpc(pageA, '/api/my-plugins/shared/list', {})).value?.items?.[0]?.mounted === false,
  }
  await rpc(pageA, '/api/my-plugins/shared/enable', { request: { pluginId: `user:${acc}:hello` } })
  const sharedList3 = await rpc(pageA, '/api/my-plugins/shared/list', {})
  checks.sharedReenable = sharedList3.value?.items?.[0]?.mounted === true
} finally {
  writeFileSync(join(OUT, 'record.json'), JSON.stringify({ at: new Date().toISOString(), base: BASE, container: CONTAINER, checks }, null, 2))
  await ctxA.close()
}
const failed = Object.entries(checks).filter(([, v]) => {
  if (typeof v === 'boolean') return !v
  if (v && typeof v === 'object') return Object.values(v).some(x => x === false)
  return false
})
if (failed.length > 0) {
  console.error('FAILED checks:', JSON.stringify(failed, null, 2))
  process.exit(1)
}
console.log('P6 E2E PASS —', JSON.stringify(checks, null, 2))
