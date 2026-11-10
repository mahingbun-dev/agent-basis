#!/usr/bin/env node
/**
 * T7.2 客户端半边轻量自检(非门禁——完整门禁由编排脚本跑 t7-smoke.mjs)。
 *
 * 复用 t7-studio profile(隔离纪律:运行态全在 .eterna-home-t7,宿主 3108):
 *  1. 3108 启动 Web 宿主,启动日志无 skipping/incompatible;
 *  2. pluginInventory 含 @eterna/prompt-studio 行(enabled+active);
 *  3. 只读端点活:loopPrompt/snapshot、prompt-versions、trace(不写运行态);
 *  4. 浏览器半边装进花名册:index.html 的 __DSH_BOOT__ 含本包 client 条目,
 *     combo 脚本字节含视图锚点(data-t7-editor / data-t7-save-btn /
 *     data-t7-version-item / data-t7-trace-node)与两端面板 id;
 *  5. T1.2 花名册 id 交叉钉住(静态文件断言):TOGGLEABLE_PLUGINS 登记 ≡ 生产档
 *     patch insert 行 ≡ docker 部署模板行;embed 档维持无该行;
 *  6. SIGTERM 收尾,3108 释放。
 *
 * 用法:node scripts/t7-ui-check.mjs
 */
import { spawn, spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { existsSync, openSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const home = resolve(repoRoot, '.eterna-home-t7')
const profileName = 't7-studio'
const profile = resolve(home, 'profiles', profileName)
const logsDir = resolve(home, 'logs')
const hostLog = resolve(logsDir, 't7-ui-check-host.log')
const port = 3108
const pkgName = '@eterna/prompt-studio'

const failures = []
function check(name, ok, detail = '') {
  console.log(`[${ok ? 'PASS' : 'FAIL'}] ${name}${detail ? ` — ${detail}` : ''}`)
  if (!ok) failures.push(name)
  return ok
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const require_ = createRequire(import.meta.url)
const litellmKey = () => readFileSync(resolve(repoRoot, '.secrets/litellm-master-key.txt'), 'utf8').trim()

let host
let stopping = false
function startHost() {
  const out = openSync(hostLog, 'w')
  host = spawn('node', [
    resolve(profile, 'node_modules/@deepseek-ai/dsh/lib/bin.js'),
    '--profile', profileName, '--host', '127.0.0.1', '--port', String(port), '--no-open',
  ], {
    cwd: profile,
    env: { ...process.env, DSH_HOME: home, LITELLM_API_KEY: litellmKey() },
    stdio: ['ignore', out, out],
  })
  host.on('exit', (code) => { if (!stopping) console.log(`[host] exit code=${code}`) })
}
async function stopHost() {
  stopping = true
  if (host?.pid && host.exitCode === null) {
    host.kill('SIGTERM')
    await Promise.race([new Promise((r) => host.once('exit', r)), sleep(15000)])
    if (host.exitCode === null) host.kill('SIGKILL')
  }
  spawnSync('pkill', ['-f', `profile ${profileName}`], { stdio: 'ignore' })
  await sleep(1500)
}
async function waitForToken(timeoutMs = 90000) {
  const t0 = Date.now()
  while (Date.now() - t0 < timeoutMs) {
    if (host.exitCode !== null) throw new Error(`host exited early code=${host.exitCode}; log:\n${readFileSync(hostLog, 'utf8')}`)
    const m = readFileSync(hostLog, 'utf8').match(/dsh web: .*token=([A-Za-z0-9_-]+)/)
    if (m) return m[1]
    await sleep(500)
  }
  throw new Error(`host not ready in ${timeoutMs}ms; log:\n${readFileSync(hostLog, 'utf8').slice(0, 2000)}`)
}
async function portBusy() {
  const r = spawnSync('lsof', ['-nP', `-iTCP:${port}`, '-sTCP:LISTEN'], { encoding: 'utf8' })
  return (r.stdout ?? '').trim().length > 0
}

function rpcFactory(cookie) {
  let rpcId = 0
  return async (method, payload = { args: {} }) => {
    const res = await fetch(`http://127.0.0.1:${port}/api/${method}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ type: 'client-request', rpcId: `t7-ui-${++rpcId}`, method, payload }),
    })
    const body = await res.json()
    if (!body.result?.ok) throw new Error(`${method} failed: ${JSON.stringify(body.result?.error ?? body).slice(0, 300)}`)
    return body.result.value
  }
}

/** 浏览器会话三步换票:/connect(token→v2 cookie)→ /?token=(303+会话 cookie
 * 升级)→ /(最终 200 HTML)。fetch 不自动回写 set-cookie,手动串。 */
async function browserSession(token) {
  let cookie
  const step = async (url) => {
    const res = await fetch(url, { redirect: 'manual', headers: cookie === undefined ? {} : { cookie } })
    const set = res.headers.get('set-cookie')
    if (set !== null) cookie = set.split(';')[0]
    return { res, cookie }
  }
  const connect = await step(`http://127.0.0.1:${port}/connect?token=${token}&interactions=answer`)
  if (connect.cookie === undefined) throw new Error('/connect: no cookie')
  const upgrade = await step(`http://127.0.0.1:${port}/?token=${token}`)
  if (upgrade.res.status === 303) await step(`http://127.0.0.1:${port}/`)
  const pageRes = await fetch(`http://127.0.0.1:${port}/`, { headers: { cookie } })
  return { cookie, page: await pageRes.text(), status: pageRes.status }
}

let exitCode = 0
try {
  if (await portBusy()) throw new Error(`端口 ${port} 已被占用(绝不 pkill 其他实例)`)
  if (!existsSync(resolve(profile, 'node_modules/@deepseek-ai/dsh/lib/bin.js'))) throw new Error('t7-studio profile 缺失(先跑 scripts/t7-smoke.mjs 自举)')
  if (!existsSync(resolve(repoRoot, 'packages/prompt-studio/lib/client.js'))) throw new Error('lib/client.js 缺失(先跑 verify)')
  console.log(`[boot] home=${home}`)
  startHost()
  const token = await waitForToken()
  const session = await browserSession(token)
  const cookie = session.cookie
  console.log(`[host] ready pid=${host.pid} log=${hostLog}`)
  const call = rpcFactory(cookie)

  // 1) 启动日志洁净度
  const log = readFileSync(hostLog, 'utf8')
  check('启动日志无 skipping/incompatible', !/skipping|incompatible/i.test(log))

  // 2) pluginInventory
  const inventory = await call('pluginInventory/list')
  const entry = (inventory.entries ?? []).find((e) => e.moduleName === pkgName)
  check('pluginInventory: 含 @eterna/prompt-studio 行', entry !== undefined)
  check('pluginInventory: enabled=true 且 fiberPhase=active', entry?.enabled === true && entry?.fiberPhase === 'active')

  // 3) 只读端点(不写运行态)
  const snapshot = await call('loopPrompt/snapshot')
  check('snapshot: persona.available + 冒烟标记在文', snapshot.persona?.available === true && snapshot.persona?.text.includes('T7_SMOKE_PERSONA_MARKER'))
  check('snapshot: channel.kind=A-patch-hmr', snapshot.channel?.kind === 'A-patch-hmr')
  const versions = await call('loopPrompt/prompt-versions', { args: { input: {} } })
  check('prompt-versions: ready 且 total>=1', versions.ready === true && versions.total >= 1, `total=${versions.total}`)
  const trace = await call('loopPrompt/trace', { args: { input: {} } })
  check('trace: 列表模式返回数组(带参端点须 args.input={})', Array.isArray(trace.sessions), `sessions=${trace.sessions?.length}`)
  const firstSession = trace.sessions?.[0]
  if (firstSession !== undefined) {
    const detail = await call('loopPrompt/trace', { args: { input: { sessionId: firstSession.sessionId } } })
    check('trace: 指定会话返回轮次树(详情形态 selected 非空)',
      detail.selected?.sessionId === firstSession.sessionId && Array.isArray(detail.selected?.turns),
      `turns=${detail.selected?.turns?.length}`)
  }

  // 4) 浏览器半边花名册与 combo 脚本
  check('index.html 可取(三步换票后 200)', session.status === 200, `status=${session.status}`)
  check('index.html 注入 __DSH_BOOT__ 花名册', session.page.includes('__DSH_BOOT__'))
  const comboUrls = [...session.page.matchAll(/(plugins\/\?\?[^"']+client\.js[^"']*)/g)]
    .map(m => m[1].replaceAll('&amp;', '&'))
  check('index.html 引用 /plugins combo 脚本', comboUrls.length > 0, `urls=${comboUrls.length}`)
  const ours = comboUrls.find((url) => url.includes(`${pkgName}/client.js`))
  check('花名册 combo 含本包条目(@eterna/prompt-studio/client.js)', ours !== undefined)
  let comboBody = ''
  if (ours !== undefined) {
    const r = await fetch(`http://127.0.0.1:${port}/${ours.replace(/^\/+/, '')}`, { headers: { cookie } })
    check('本包 combo 脚本可取(200)', r.ok, `status=${r.status}`)
    if (r.ok) comboBody = await r.text()
  }
  check('combo 脚本含本包 factory 注册(id=@eterna/prompt-studio)', comboBody.includes('id: "@eterna/prompt-studio"'))
  for (const anchor of ['data-t7-editor', 'data-t7-save-btn', 'data-t7-version-item', 'data-t7-trace-node', 'data-t7-session-item', 'data-t7-approve-btn',
    // T1.5 全景改版锚点(ps-v2-test-plan §3 T1.5(b)②:分组导航/条目详情/diff/保存)。
    'data-ps-group-nav', 'data-ps-entry-detail', 'data-ps-diff-view', 'data-ps-entry-save']) {
    check(`combo 脚本含视图锚点 ${anchor}`, comboBody.includes(anchor))
  }

  // 5) T1.2 花名册 id 交叉钉住（ps-v2-test-plan §3 T1.2(b)）：同一插件 id 三处
  //    同源——TOGGLEABLE_PLUGINS 登记(access routes.ts)≡ 生产档 patch insert 行
  //    (profiles/eterna-web)≡ 本包 factory 注册 id（上面 combo 断言的源）——
  //    任一处改动即红，防「登记 id 错」。静态文件断言，不依赖宿主。
  const routesSrc = readFileSync(resolve(repoRoot, 'packages', 'access', 'src', 'routes.ts'), 'utf8')
  check('交叉钉住:access TOGGLEABLE_PLUGINS 登记行 id=eterna-prompt-studio',
    routesSrc.includes("id: 'eterna-prompt-studio'"))
  const prodPatch = readFileSync(resolve(repoRoot, 'profiles', 'eterna-web', 'cordis.patch.yml'), 'utf8')
  check('交叉钉住:生产档 patch 含 eterna-prompt-studio insert 行(id+name 同源)',
    /- id: eterna-prompt-studio\s*\n\s+name: '@eterna\/prompt-studio'/.test(prodPatch))
  check('交叉钉住:docker 部署模板 insert 块含 eterna-prompt-studio 行(生产容器挂载面)',
    /- id: eterna-prompt-studio\s*\n\s+name: '@eterna\/prompt-studio'/.test(
      readFileSync(resolve(repoRoot, 'docker', 'profile', 'cordis.patch.yml.template'), 'utf8')))
  check('交叉钉住:embed 档 patch 无 eterna-prompt-studio 行(维持不挂,docs/embed-profile.md)',
    !readFileSync(resolve(repoRoot, 'profiles', 'eterna-embed', 'cordis.patch.yml'), 'utf8').includes('eterna-prompt-studio'))
  check('combo 脚本含两个面板 id(main keyed + sidebar.panellist)',
    comboBody.includes('eterna-prompt-studio') && comboBody.includes('eterna-loop-trace'))
  check('combo 脚本只经官方语义令牌(color/background 无字面 #hex)',
    !/color:\s*#[0-9a-f]{3,8}/i.test(comboBody) && !/background:\s*#[0-9a-f]{3,8}/i.test(comboBody))
  console.log('\n[cleanup] SIGTERM 宿主…')
} catch (error) {
  failures.push(String(error?.message ?? error))
  console.error(`[FATAL] ${String(error?.message ?? error)}`)
} finally {
  await stopHost()
  const freed = !(await portBusy())
  check('清理:宿主已停、端口 3108 已释放', freed)
  console.log(`\n结论:${failures.length === 0 ? 'T7.2 客户端半边自检全部通过(exit 0)' : `存在失败项(exit 1):${failures.join(' | ')}`}`)
  exitCode = failures.length === 0 ? 0 : 1
}
process.exit(exitCode)
