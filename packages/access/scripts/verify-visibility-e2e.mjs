#!/usr/bin/env node
/**
 * 37-M-4 M3 段:可见性三档真 boot E2E(33 号 G2-C3/G2-C5 的「+ E2E 脚本」;
 * 文件名与落点=37 号 §7 缺口 1 本批拍板:packages/access/scripts/ 下,
 * 模式对齐 scripts/verify-governance-e2e.mjs 的「真 boot + 真 HTTP + JSON
 * 特征字段断言 + 逐条 PASS/FAIL + 退出码」)。model-free(零模型调用、零凭据)。
 *
 * 断言七件事(eterna-web 物化档 + insert eterna-access 行):
 *  a) 登录门禁在:未认证 GET / → 302 /login(login-gate.ts:58 的 401 改写);
 *  b) 挂载健康:pluginInventory/list 断言 eterna-access present+enabled+active
 *     且 0 个 failed 条目;
 *  c) 三档角色 JSON 特征字段:root(role=admin)/alice(role=user)/bob(建号默认
 *     user)对 /access/api/me 的 role 字段逐档正确(禁全页文本子串断言,
 *     33 G2-C3 引 docs/USER-GUIDE.md:50-51);
 *  d) 既有两面三档本人-only(37 号 §7 缺口 2 fail-closed 现状):tool-pending /
 *     questions-pending 三角色响应体 items 均为数组;无主 id 的裁决/作答一律
 *     404(桥内归属校验与角色无关——approval-bridge.ts:119、question-bridge.ts:261);
 *  e) 分配→可见性变化闭环(G2-C5 后半):admin POST users/<id>/role bob→approver
 *     后,**同一 cookie 不重登**再查 me.role==='approver'(角色读取每请求现查,
 *     TS-37-1 已核实上游 bindingsOf 无缓存);审批人即失 admin 面(users/plugins
 *     列表与插件启停 403,审批人≠管理员);
 *  f) 收回→可见性变化闭环:role→user 后同一 cookie me.role 立即回 'user';
 *  g) 审计留痕断言不在本脚本:web 档不挂 eterna-audit,access 审计直投
 *     (audit.ts:24「缺席时无操作」)无落盘面——G2-C5 的审计三要素由
 *     tests/routes.spec.ts 的 fake-sink 用例覆盖(node 面实跑)。
 *
 * 口径说明(37 号 §7 缺口 1 如实登记):WS-D 工作台待人项数据端点今日不存在
 * (mux.ts:194 上游流方法表无 person/* 端点;routes.ts 无工作台数据面),「审批人
 * 视角待人项列表含他人 realm 条目、普通用户仅含本人、管理员全量」的工作台数据
 * 断言待 WS-D 落地后按本脚本 d) 段同款 JSON 特征字段写法扩入;本脚本先钉住
 * 可见性的角色/谓词/门禁半边与既有两面的 fail-closed 行为。三档谓词×账本的
 * node 面断言见 tests/gateway-role-gate.spec.ts「WS-C 待人项可见性三档」describe。
 *
 * patch 文件纪律(verify-governance-e2e 同款):只改「物化副本」
 * ($DSH_HOME/profiles/eterna-web/cordis.patch.yml,脚本自管 home,默认
 * <repo>/.eterna-home-vis-e2e,gitignored);还原=写回读取时的原始字节并断言
 * 逐字一致(try/finally 兜底);从不改工作区 profiles 源目录。
 *
 * 用法:node packages/access/scripts/verify-visibility-e2e.mjs   (exit 0 = 全部通过)
 *   VIS_E2E_PROFILE_HOME — DSH home(默认 <repo>/.eterna-home-vis-e2e)
 */

import { spawn } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { randomBytes } from 'node:crypto'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..')
const dshBin = join(repoRoot, 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js')
const accessPkg = join(repoRoot, 'packages', 'access')
const home = resolve(process.env.VIS_E2E_PROFILE_HOME ?? join(repoRoot, '.eterna-home-vis-e2e'))

const BOOT_TIMEOUT_MS = 120_000
const PROBE_TIMEOUT_MS = 10_000

/** insert 挂载行(packages/access/cordis.patch.yml 同款;物化副本追加,结束还原)。 */
const MOUNT_ROW = { id: 'eterna-access', name: '@eterna/access' }

const failures = []
const pass = (name, ok, detail = '') => {
  console.log(`[${ok ? 'PASS' : 'FAIL'}] ${name}${detail ? ` — ${detail}` : ''}`)
  if (!ok) failures.push(name)
}

// ---------------------------------------------------------------------------
// 0. 前置:bin 与包源在(model-free:不读凭据)。

if (!existsSync(dshBin)) {
  console.error(`verify-visibility-e2e: dsh CLI not found at ${dshBin}; run pnpm install first`)
  process.exit(1)
}
if (!existsSync(join(accessPkg, 'src', 'plugin.ts'))) {
  console.error(`verify-visibility-e2e: @eterna/access sources missing at ${accessPkg}`)
  process.exit(1)
}
// admin 播种凭据:每次运行随机生成,只进子进程环境(plugin.ts:156 读 env),不进
// 被跟踪文件/日志/argv(AGENTS.md 凭据纪律;密码策略=长度 8+,password.ts:30)。
const adminPassword = `vis-e2e-${randomBytes(9).toString('base64url')}`

// ---------------------------------------------------------------------------
// 1. 物化基建:eterna-web profile + @eterna/access symlink + patch 读写备份器
//    (verify-governance-e2e.mjs materializeProfile/patchToggler 同构)。

const profileDir = join(home, 'profiles', 'eterna-web')
const homePatch = join(home, 'cordis.patch.yml')
if (existsSync(homePatch)) {
  console.error(`verify-visibility-e2e: ${homePatch} exists; a home-level user patch would compose over the profile layer and break determinism — remove it or point VIS_E2E_PROFILE_HOME at a clean home`)
  process.exit(1)
}
// 全新 home:users.db 属脚本自管卷,残留会把「播种凭据」变成跨运行状态
// (上轮随机密码 vs 本轮 env——表非空则 seedAdmin 幂等跳过,登录必 401)。
rmSync(home, { recursive: true, force: true })
const sourcePatch = join(repoRoot, 'profiles', 'eterna-web', 'cordis.patch.yml')

mkdirSync(profileDir, { recursive: true })
writeFileSync(join(profileDir, 'package.json'), `${JSON.stringify({
  name: 'dsh-profile-eterna-web', private: true,
  dsh: { profile: { bundles: ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app'] } },
}, null, 2)}\n`)
writeFileSync(join(profileDir, 'cordis.yml'), '[]\n')
copyFileSync(sourcePatch, join(profileDir, 'cordis.patch.yml'))
const nmEterna = join(profileDir, 'node_modules', '@eterna')
mkdirSync(nmEterna, { recursive: true })
try { rmSync(join(nmEterna, 'access'), { recursive: true, force: true }) } catch { /* not a symlink */ }
symlinkSync(accessPkg, join(nmEterna, 'access'), 'dir')
console.log(`verify-visibility-e2e: materialized eterna-web at ${profileDir} (@eterna/access → ${accessPkg})`)

const patchPath = join(profileDir, 'cordis.patch.yml')
const originalPatch = readFileSync(patchPath, 'utf8')
const mountBlock = [
  '',
  '# ── 37-M-4 M3 E2E 临时挂载(packages/access/scripts/verify-visibility-e2e.mjs;结束还原原字节)──',
  '- insert:',
  `    - id: ${MOUNT_ROW.id}\n      name: '${MOUNT_ROW.name}'`,
  '',
].join('\n')
writeFileSync(patchPath, `${originalPatch}${mountBlock}`, 'utf8')

// ---------------------------------------------------------------------------
// 2. 真 boot(verify-eterna-web 同款就绪信号:dsh web: <url> 行 = Loader 落定)。

const child = spawn(process.execPath, [dshBin, '--profile', 'eterna-web', '--no-open', '--port', '0'], {
  cwd: repoRoot,
  env: {
    ...process.env,
    DSH_HOME: home,
    ETERNA_ACCESS_ADMIN_USER: 'root',
    ETERNA_ACCESS_ADMIN_PASSWORD: adminPassword,
  },
  stdio: ['ignore', 'pipe', 'pipe'],
})
const output = []
const collect = (stream) => {
  stream.setEncoding('utf8')
  stream.on('data', (chunk) => output.push(chunk))
}
collect(child.stdout)
collect(child.stderr)
const ready = new Promise((resolveReady) => {
  const timer = setTimeout(() => resolveReady({ url: null, timedOut: true }), BOOT_TIMEOUT_MS)
  const check = () => {
    const match = output.join('').match(/^dsh web: (\S+)$/m)
    if (match) { clearTimeout(timer); resolveReady({ url: match[1], timedOut: false }) }
  }
  child.stdout.on('data', check)
  child.stderr.on('data', check)
  child.on('exit', (code) => { clearTimeout(timer); resolveReady({ url: null, exitCode: code }) })
  check()
})

async function stop() {
  if (child.exitCode !== null) return
  child.kill('SIGTERM')
  await new Promise((resolveStop) => {
    const timer = setTimeout(() => { child.kill('SIGKILL'); resolveStop() }, 5000)
    child.once('exit', () => { clearTimeout(timer); resolveStop() })
  })
}

// ---------------------------------------------------------------------------
// 3. HTTP 探针面。

const jsonFetch = async (url, { method = 'GET', cookie, body } = {}) => {
  const response = await fetch(url, {
    method,
    redirect: 'manual', // 门禁/兑换的 302/303 必须裸见(fetch 默认 follow 会吞掉门禁证据)
    headers: {
      ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
      ...(cookie !== undefined && cookie !== '' ? { cookie } : {}),
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
  })
  const text = await response.text()
  let json = null
  try { json = JSON.parse(text) } catch { /* HTML/空体:调用方按 status 断言 */ }
  return { status: response.status, location: response.headers.get('location'), setCookie: response.headers.get('set-cookie'), json, text }
}

const cookieOf = (reply) => reply.setCookie?.split(';')[0] ?? ''

/** pluginInventory/list 一次性探测(verify-governance-e2e probeInventory 同款信封)。 */
async function probeInventory(baseUrl, cookie) {
  const response = await fetch(new URL('/api/pluginInventory/list', baseUrl), {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) },
    body: JSON.stringify({ type: 'client-request', rpcId: 'verify-visibility-e2e', method: 'pluginInventory/list', payload: { args: {} } }),
    signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
  })
  const body = await response.json().catch((error) => ({ parseError: String(error) }))
  if (response.status !== 200 || body.type !== 'server-response' || body.result === undefined) {
    return { ok: false, error: `transport: POST pluginInventory/list -> ${response.status}` }
  }
  const envelope = body.result
  if (envelope.ok !== true) return { ok: false, error: `handler: ${JSON.stringify(envelope.error ?? envelope).slice(0, 400)}` }
  const snapshot = envelope.value
  if (snapshot === null || typeof snapshot !== 'object' || !Array.isArray(snapshot.entries)) {
    return { ok: false, error: `shape: ${JSON.stringify(snapshot).slice(0, 400)}` }
  }
  return { ok: true, value: snapshot }
}

// ---------------------------------------------------------------------------
// 4. 主断言序列。

try {
  const readiness = await ready
  if (!readiness.url) {
    await stop()
    console.error(`verify-visibility-e2e: boot failed (${readiness.timedOut ? `no readiness line within ${BOOT_TIMEOUT_MS}ms` : `dsh exited code ${readiness.exitCode}`})`)
    console.error(output.join('').slice(-3000))
    pass('boot 就绪', false, 'see stderr above')
  } else {
    const base = readiness.url
    console.log(`verify-visibility-e2e: booted ${base}`)
    const origin = new URL(base).origin

    // a) 登录门禁:未认证(无 token 无 cookie)索引请求 302 → /login(login-gate.ts:58;
    //    探针剥掉就绪行携带的 launch token,打匿名形态)。
    const anon = await jsonFetch(origin, { })
    pass('a) 登录门禁在:未认证 GET / → 302 /login', anon.status === 302 && anon.location === '/login',
      `status=${anon.status} location=${anon.location ?? '-'}`)

    // dsh 自己的会话 cookie:就绪行 URL 带 launch token,先兑换(303 + set-cookie;
    // login-gate.ts:16「token 兑换 303 原样放行」)。/api/* 上游 RPC(pluginInventory)
    // 认 dsh cookie;/access/api/* 认 eterna_session——两套 cookie 各走各面。
    const exchange = await jsonFetch(base, { })
    const dshCookie = cookieOf(exchange)
    pass('b) launch token 兑换:303 + dsh 会话 cookie', exchange.status === 303 && dshCookie !== '',
      `status=${exchange.status} cookie=${dshCookie === '' ? '-' : dshCookie.split('=')[0]}`)

    // admin 播种登录(env 凭据;JSON 提交 → 200 + set-cookie,routes.ts:307)。
    const adminLogin = await jsonFetch(new URL('/login', base), { method: 'POST', body: { account: 'root', password: adminPassword } })
    const adminCookie = cookieOf(adminLogin)
    pass('a) admin 播种登录:200 + eterna_session cookie', adminLogin.status === 200 && adminCookie.startsWith('eterna_session='),
      `status=${adminLogin.status}${adminLogin.json?.error !== undefined ? ` error=${adminLogin.json.error}` : ''}`)

    // b) 挂载健康:eterna-access enabled+active,0 failed(探测用 dsh cookie)。
    const inventory = await probeInventory(base, dshCookie)
    if (!inventory.ok) {
      pass('b) pluginInventory/list 探测', false, inventory.error)
    } else {
      const snapshot = inventory.value
      const hostByEntry = new Map(snapshot.entries.map((entry) => [entry.entryId.replace(/^include:/, ''), entry]))
      const accessEntry = hostByEntry.get(MOUNT_ROW.id)
      pass('b) eterna-access present+enabled+active(挂载行生效)',
        accessEntry !== undefined && accessEntry.enabled === true && accessEntry.fiberPhase === 'active',
        accessEntry === undefined ? 'absent — symlink 或 insert 行缺失' : `${MOUNT_ROW.id}=${accessEntry.enabled ? 'enabled' : 'disabled'}/${accessEntry.fiberPhase ?? 'no-fiber'}`)
      const failed = snapshot.entries.filter((entry) => entry.fiberPhase === 'failed')
      pass('b) 0 个 failed 条目', failed.length === 0,
        failed.map((entry) => `${entry.entryId}: ${entry.diagnostic ?? 'failed'}`).join(' | ') || `${snapshot.entries.length} entries settled`)
    }

    // c) 三档角色 JSON 特征字段:建号 alice(user 档默认)/bob(user 档,后续角色翻转)。
    const createAlice = await jsonFetch(new URL('/access/api/users', base), { method: 'POST', cookie: adminCookie, body: { account: 'alice', password: 'password8' } })
    const createBob = await jsonFetch(new URL('/access/api/users', base), { method: 'POST', cookie: adminCookie, body: { account: 'bob', password: 'password8' } })
    pass('c) admin 建号:alice/bob 201 + 响应体 user.role=JSON 特征字段(默认 user 档)',
      createAlice.status === 201 && createAlice.json?.user?.role === 'user' && createBob.status === 201 && createBob.json?.user?.role === 'user',
      `alice=${createAlice.status}/${createAlice.json?.user?.role ?? '-'} bob=${createBob.status}/${createBob.json?.user?.role ?? '-'}`)
    const bobId = createBob.json?.user?.id
    const aliceId = createAlice.json?.user?.id

    const meOf = async (cookie) => (await jsonFetch(new URL('/access/api/me', base), { cookie })).json
    const rootMe = await meOf(adminCookie)
    pass('c) 三档角色 role 字段:root=admin(播种档)', rootMe?.role === 'admin', `role=${rootMe?.role ?? '-'}`)

    const aliceCookie = cookieOf(await jsonFetch(new URL('/login', base), { method: 'POST', body: { account: 'alice', password: 'password8' } }))
    const bobCookie = cookieOf(await jsonFetch(new URL('/login', base), { method: 'POST', body: { account: 'bob', password: 'password8' } }))
    const aliceMe = await meOf(aliceCookie)
    const bobMe = await meOf(bobCookie)
    pass('c) 三档角色 role 字段:alice=user / bob=user(建号默认档)',
      aliceMe?.role === 'user' && bobMe?.role === 'user' && aliceMe?.account === 'alice' && bobMe?.account === 'bob',
      `alice=${aliceMe?.role ?? '-'}/${aliceMe?.account ?? '-'} bob=${bobMe?.role ?? '-'}/${bobMe?.account ?? '-'}`)

    // d) 既有两面三档本人-only:items 数组形态 + 无主 id 一律 404(缺口 2 fail-closed)。
    const pendingFaces = []
    for (const [label, cookie] of [['root(admin 档)', adminCookie], ['alice(user 档)', aliceCookie], ['bob(user 档)', bobCookie]]) {
      const toolPending = await jsonFetch(new URL('/access/api/approvals/tool-pending', base), { cookie })
      const questionPending = await jsonFetch(new URL('/access/api/questions/pending', base), { cookie })
      pendingFaces.push([label, toolPending.status === 200 && Array.isArray(toolPending.json?.items), questionPending.status === 200 && Array.isArray(questionPending.json?.items)])
    }
    pass('d) tool-pending/questions-pending 三角色 200 + items 数组(JSON 特征字段)',
      pendingFaces.every(([, toolOk, questionOk]) => toolOk && questionOk),
      pendingFaces.map(([label, toolOk, questionOk]) => `${label}:${toolOk ? 'ok' : 'bad'}/${questionOk ? 'ok' : 'bad'}`).join(' '))
    const crossDecide = await jsonFetch(new URL('/access/api/approvals/tool-decide', base), { method: 'POST', cookie: aliceCookie, body: { id: 'vis-e2e-no-such-approval', allow: true } })
    const crossAnswer = await jsonFetch(new URL('/access/api/questions/answer', base), { method: 'POST', cookie: bobCookie, body: { id: 'vis-e2e-no-such-question', skip: true } })
    pass('d) 归属校验与角色无关:无主 id 裁决/作答一律 404(缺口 2 fail-closed)',
      crossDecide.status === 404 && crossAnswer.status === 404,
      `decide=${crossDecide.status} answer=${crossAnswer.status}`)

    // e) 分配→可见性变化闭环(G2-C5 后半):bob 同一 cookie 不重登即见 approver 档。
    const assign = await jsonFetch(new URL(`/access/api/users/${bobId}/role`, base), { method: 'POST', cookie: adminCookie, body: { role: 'approver' } })
    pass('e) 分配审批人:200 + 响应体 user.role=approver', assign.status === 200 && assign.json?.user?.role === 'approver',
      `status=${assign.status} role=${assign.json?.user?.role ?? '-'}`)
    const bobMeAfter = await meOf(bobCookie)
    pass('e) 分配→可见性即时变化:同一 cookie me.role=approver(零重登,角色每请求现查)',
      bobMeAfter?.role === 'approver', `role=${bobMeAfter?.role ?? '-'}`)
    const approverUsers = await jsonFetch(new URL('/access/api/users', base), { cookie: bobCookie })
    const approverPlugins = await jsonFetch(new URL('/access/api/plugins', base), { cookie: bobCookie })
    const approverToggle = await jsonFetch(new URL('/access/api/plugins/eterna-memory/disable', base), { method: 'POST', cookie: bobCookie })
    const approverAssign = await jsonFetch(new URL(`/access/api/users/${aliceId}/role`, base), { method: 'POST', cookie: bobCookie, body: { role: 'user' } })
    pass('e) 审批人≠管理员:用户列表/插件清单/插件启停/角色变更四路 403',
      approverUsers.status === 403 && approverPlugins.status === 403 && approverToggle.status === 403 && approverAssign.status === 403,
      `users=${approverUsers.status} plugins=${approverPlugins.status} toggle=${approverToggle.status} assign=${approverAssign.status}`)

    // f) 收回→可见性变化闭环:同一 cookie 立即回 user 档。
    const revoke = await jsonFetch(new URL(`/access/api/users/${bobId}/role`, base), { method: 'POST', cookie: adminCookie, body: { role: 'user' } })
    const bobMeReverted = await meOf(bobCookie)
    pass('f) 收回→可见性即时变化:同一 cookie me.role 回 user',
      revoke.status === 200 && bobMeReverted?.role === 'user',
      `assign status=${revoke.status} role=${bobMeReverted?.role ?? '-'}`)
    const revertedUsers = await jsonFetch(new URL('/access/api/users', base), { cookie: bobCookie })
    pass('f) 收回后 bob 仍无 admin 面(403)', revertedUsers.status === 403, `users=${revertedUsers.status}`)
  }
} finally {
  // patch 还原兜底:物化副本回原始字节(卸载语义;字节级一致断言)。
  writeFileSync(patchPath, originalPatch, 'utf8')
  pass('patch restored byte-identical', readFileSync(patchPath, 'utf8') === originalPatch)
  await stop()
}

console.log(failures.length === 0
  ? 'verify-visibility-e2e: OK — 门禁/挂载/三档角色字段/两面 fail-closed/分配与收回闭环 全部通过'
  : `verify-visibility-e2e: FAILED — ${failures.join('; ')}`)
process.exitCode = failures.length === 0 ? 0 : 1
