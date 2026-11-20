#!/usr/bin/env node
/**
 * 个人层 MCP 验证脚本（51 §3.6 / §4；54 §6.3；T47）。
 *
 * 覆盖（可自动化部分）：
 *   MCPP-001   A 的 list 只含 A 的条目
 *   MCPP-002   B 的 list 只含 B 的条目
 *   MCPP-003   B upsert A 的 id → 拒绝且 A 行不变
 *   MCPP-004   B delete A 的 id → 拒绝且 A 行仍在
 *   MCPP-005   catalog 只含管理员目录项；自填 stdio command 被拒
 *   MCPP-006   B 选目录项 echo 新建 → serverName=p<uid>_echo
 *   MCPP-007   本地 HTTP MCP（127.0.0.1:<port>/mcp）新建 + probe 成功
 *   MCPP-008   http://169.254.169.254/... 拒绝
 *   MCPP-009   http://[fd00:ec2::254]/ 拒绝
 *   MCPP-012   header secret 加密落库；DB/日志无明文
 *   MCPP-013   list 只回 hasSecret:true，不回值
 *   MCPP-014   8 条上限（--full）
 *   MCPP-015   256KB 配置上限（--full）
 *   MCPP-021   A/B 同名 server → serverName 不同、互不覆盖
 *   MCPP-023   重启容器后配置仍在（--restart）
 *
 * 明确不在此脚本（需要 live 会话/浏览器/子代理，标 SKIP 并写清原因）：
 *   MCPP-016/017/018（超时/重连时序）、MCPP-019（live 会话工具即时消失）、
 *   MCPP-020（跨用户/子代理工具调用）、MCPP-022（登出 dispose 作用域）、
 *   MCPP-024（UI 双主题截图）。
 *
 * 用法：
 *   node scripts/verify-mcp-personal.mjs \
 *     --base http://127.0.0.1:3108 \
 *     --accounts-file $HOME/eterna-data/test-rc5/.test-accounts.json \
 *     --data-root $HOME/eterna-data/test-rc5/e1 \
 *     --container eterna-rc5-e1 \
 *     --json artifacts/rc5/p5/testbed/mcp-personal/report.json
 *   --full       追加限额用例（会临时写 9 条，结束后清理）
 *   --restart    追加 MCPP-023（docker restart 测试容器）
 *
 * 只读接口优先；写操作只落在测试容器/E1 数据根，结束后清理本轮创建的条目。
 * 凭据只从 0600 账号文件读入内存，不打印；证据不含明文密钥。
 */
import { execFileSync, spawnSync } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import {
  DEFAULT_TEST_ROOT,
  bootTokenFromContainer,
  bootstrapDshSession,
  getJson,
  Report,
  STATUS,
  defaultPaths,
  errorCode,
  loadAccounts,
  login,
  parseArgs,
  redact,
  rpc,
  shape,
} from './rc5-test-client.mjs'

const args = parseArgs(process.argv.slice(2), { ...defaultPaths(), full: false, restart: false, keep: false })
const BASE = String(args.base)
const ACCOUNTS_FILE = String(args.accountsFile)
const DATA_ROOT = String(args.dataRoot)
const CONTAINER = String(args.container)
const HTTP_PORT = Number.parseInt(String(args['http-port'] ?? '8765'), 10)
const OUT = args.json === undefined ? undefined : String(args.json)

const report = new Report({ suite: 'MCPP', env: { base: BASE, container: CONTAINER, dataRoot: DATA_ROOT, full: Boolean(args.full), restart: Boolean(args.restart) }, out: OUT })

const accounts = loadAccounts(ACCOUNTS_FILE)
// /api/* 面需要上游 dsh-auth cookie（浏览器三步换票）；eterna_session 只解决租户身份。
const bootToken = typeof args['boot-token'] === 'string' ? args['boot-token'] : bootTokenFromContainer(CONTAINER)
const dshCookie = await bootstrapDshSession(BASE, bootToken)
const created = { a: [], b: [], c: [] }

function cleanupHint(detail) {
  return detail
}

function docker(argsList, options = {}) {
  return spawnSync('docker', argsList, { encoding: 'utf8', timeout: options.timeoutMs ?? 60_000, ...options })
}

const AUTH = { a: undefined, b: undefined, c: undefined }

async function loginAll() {
  const a = await login(BASE, accounts.admin.account, accounts.admin.password)
  const b = await login(BASE, accounts.user_b.account, accounts.user_b.password)
  const c = accounts.user_c === undefined
    ? undefined
    : await login(BASE, accounts.user_c.account, accounts.user_c.password)
  AUTH.a = `${dshCookie}; ${a.cookie}`
  AUTH.b = `${dshCookie}; ${b.cookie}`
  AUTH.c = c === undefined ? undefined : `${dshCookie}; ${c.cookie}`
  return { a: a.status, b: b.status, c: c?.status }
}

async function me(cookie) {
  // access 面是 GET 路由，不是 RPC 信封。
  return getJson(BASE, '/access/api/me', { cookie })
}

function dbPath() {
  return join(DATA_ROOT, 'access', 'users.db')
}

function readDbRows(sql, params = []) {
  // 只读打开（run 时容器仍在写 WAL；readOnly 不阻塞写者）。
  const code = `const {DatabaseSync}=require('node:sqlite');const db=new DatabaseSync(${JSON.stringify(dbPath())},{readOnly:true});process.stdout.write(JSON.stringify(db.prepare(${JSON.stringify(sql)}).all(...${JSON.stringify(params)})))`
  const result = spawnSync(process.execPath, ['-e', code], { encoding: 'utf8', timeout: 20_000 })
  if (result.status !== 0) throw new Error(`sqlite 读取失败: ${(result.stderr ?? '').slice(0, 200)}`)
  return JSON.parse(result.stdout)
}

function upsert(cookie, request) {
  return rpc(BASE, cookie, 'mcp-personal/upsert', { request })
}

function list(cookie) {
  return rpc(BASE, cookie, 'mcp-personal/list')
}

function del(cookie, id) {
  return rpc(BASE, cookie, 'mcp-personal/delete', { request: { id } })
}

function probe(cookie, id) {
  return rpc(BASE, cookie, 'mcp-personal/probe', { request: { id } }, { timeoutMs: 30_000 })
}

async function expectDenied(cookie, request, label) {
  const result = await upsert(cookie, request)
  const code = errorCode(result)
  return {
    denied: result.ok === false && (code === 'tenant/denied' || code === 'mcp-personal/unavailable'),
    code,
    message: result?.error?.message,
    label,
  }
}

/* ------------------------------------------------------------------ 主流程 */

const logins = await loginAll()
report.add('SETUP-LOGIN', 'P0', logins.a === 200 && logins.b === 200 ? STATUS.PASS : STATUS.FAIL, 'admin/user_b 登录', `status a=${logins.a} b=${logins.b} c=${logins.c ?? 'n/a'}`)

const meB = await me(AUTH.b)
const meA = await me(AUTH.a)
const uidB = meB.json?.id
const uidA = meA.json?.id
const ready = typeof uidB === 'number' && typeof uidA === 'number'
if (!ready) {
  report.add('SETUP-IDENTITY', 'P0', STATUS.FAIL, '读取 A/B 用户 id', shape(meB.json))
}
const uidFor = { a: uidA, b: uidB }

// 个人层可用性前置：catalog 若回 unavailable（主密钥/配置缺失）→ 后续全部 NOTRUN。
const catalog = ready ? await rpc(BASE, AUTH.b, 'mcp-personal/catalog') : undefined
const unavailable = catalog !== undefined && catalog.ok === false && errorCode(catalog) === 'mcp-personal/unavailable'
report.add(
  'SETUP-MCP-AVAILABLE',
  'P0',
  catalog?.ok === true ? STATUS.PASS : unavailable ? STATUS.FAIL : STATUS.FAIL,
  '个人层可用（catalog 应答 ok）',
  catalog?.ok === true ? `items=${catalog.value?.items?.length ?? '?'}` : shape(catalog?.error),
)
if (unavailable) {
  for (const [id, priority, title] of [
    ['RC5-MCPP-001', 'P0', 'A list 只含 A 条目'],
    ['RC5-MCPP-002', 'P0', 'B list 只含 B 条目'],
    ['RC5-MCPP-003', 'P0', 'B upsert A 的 id 被拒'],
    ['RC5-MCPP-004', 'P0', 'B delete A 的 id 被拒'],
    ['RC5-MCPP-005', 'P0', 'catalog/自填 stdio 拒绝'],
    ['RC5-MCPP-006', 'P0', 'B 选 echo 新建'],
    ['RC5-MCPP-007', 'P0', 'HTTP MCP 新建+probe'],
    ['RC5-MCPP-008', 'P0', '元数据 IPv4 拒绝'],
    ['RC5-MCPP-009', 'P0', '元数据 IPv6 拒绝'],
    ['RC5-MCPP-012', 'P0', 'header secret 密文落库'],
    ['RC5-MCPP-013', 'P0', 'list 不回密钥值'],
    ['RC5-MCPP-021', 'P0', '同名 server 隔离'],
  ]) {
    report.add(id, priority, STATUS.NOTRUN, title, '个人层 unavailable（主密钥/目录未注入）；见 SETUP-MCP-AVAILABLE')
  }
  process.exit(report.finish())
}

/* MCPP-005 catalog + 自填 stdio 拒绝 */
await report.run('RC5-MCPP-005', 'P0', 'catalog 只含允许项；自填 stdio command 被拒', async () => {
  const items = catalog.value?.items ?? []
  const names = items.map(item => item?.name)
  const catalogOk = names.includes('echo') && items.every(item => item?.transport === 'stdio')
  const selfFill = await expectDenied(AUTH.b, { name: 'selfcmd', transport: 'stdio', command: '/bin/sh', args: ['-c', 'id'] })
  const filler = await expectDenied(AUTH.b, { name: 'selfcmd2', transport: 'stdio', args: ['-c', 'id'] })
  const pass = catalogOk && selfFill.denied && filler.denied
  return {
    status: pass ? STATUS.PASS : STATUS.FAIL,
    detail: `catalog=${JSON.stringify(names)}; command denied=${selfFill.denied}/${selfFill.message ?? ''}; args denied=${filler.denied}/${filler.message ?? ''}`,
  }
})

/* MCPP-006 B 从目录建 echo */
let echoB
await report.run('RC5-MCPP-006', 'P0', 'B 从管理员目录新建 echo', async () => {
  const result = await upsert(AUTH.b, { name: 'echo-b', transport: 'stdio', catalogId: 'echo' })
  if (result.ok !== true) return { status: STATUS.FAIL, detail: shape(result.error) }
  echoB = result.value?.item
  created.b.push(echoB?.id)
  const expected = `p${uidB}_echo-b`
  return {
    status: echoB?.serverName === expected ? STATUS.PASS : STATUS.FAIL,
    detail: `serverName=${echoB?.serverName} expected=${expected} transport=${echoB?.transport}`,
  }
})

/* MCPP-001 A 自己的条目 */
let echoA
await report.run('RC5-MCPP-001', 'P0', 'A 的 list 只含 A 的条目', async () => {
  const result = await upsert(AUTH.a, { name: 'a-echo', transport: 'stdio', catalogId: 'echo' })
  if (result.ok !== true) return { status: STATUS.FAIL, detail: shape(result.error) }
  echoA = result.value?.item
  created.a.push(echoA?.id)
  const rows = await list(AUTH.a)
  const items = rows.value?.items ?? []
  const onlyA = items.every(item => String(item?.serverName ?? '').startsWith(`p${uidA}_`))
  const hasOwn = items.some(item => item?.id === echoA?.id)
  return {
    status: onlyA && hasOwn ? STATUS.PASS : STATUS.FAIL,
    detail: `count=${items.length} names=${JSON.stringify(items.map(item => item?.serverName))}`,
  }
})

/* MCPP-002 B 的 list 只含 B */
await report.run('RC5-MCPP-002', 'P0', 'B 的 list 只含 B 的条目', async () => {
  const rows = await list(AUTH.b)
  const items = rows.value?.items ?? []
  const onlyB = items.every(item => String(item?.serverName ?? '').startsWith(`p${uidB}_`))
  const hasOwn = items.some(item => item?.id === echoB?.id)
  const leaksA = items.some(item => item?.id === echoA?.id || String(item?.serverName ?? '').startsWith(`p${uidA}_`))
  return {
    status: onlyB && hasOwn && !leaksA ? STATUS.PASS : STATUS.FAIL,
    detail: `count=${items.length} names=${JSON.stringify(items.map(item => item?.serverName))}`,
  }
})

/* MCPP-003 B 改 A 的行 */
await report.run('RC5-MCPP-003', 'P0', 'B upsert A 的行被拒且 A 行不变', async () => {
  const before = (await list(AUTH.a)).value?.items?.find(item => item?.id === echoA?.id)
  const attempt = await upsert(AUTH.b, { id: echoA?.id, name: 'hijack', transport: 'stdio', catalogId: 'echo' })
  const after = (await list(AUTH.a)).value?.items?.find(item => item?.id === echoA?.id)
  const denied = attempt.ok === false && errorCode(attempt) === 'tenant/denied'
  const unchanged = JSON.stringify(before) === JSON.stringify(after)
  return {
    status: denied && unchanged ? STATUS.PASS : STATUS.FAIL,
    detail: `denied=${denied} code=${errorCode(attempt) ?? '-'} unchanged=${unchanged}`,
  }
})

/* MCPP-004 B 删 A 的行 */
await report.run('RC5-MCPP-004', 'P0', 'B delete A 的行被拒且 A 行仍在', async () => {
  const attempt = await del(AUTH.b, echoA?.id)
  const rows = await list(AUTH.a)
  const still = (rows.value?.items ?? []).some(item => item?.id === echoA?.id)
  const denied = attempt.ok === false && errorCode(attempt) === 'tenant/denied'
  return {
    status: denied && still ? STATUS.PASS : STATUS.FAIL,
    detail: `denied=${denied} code=${errorCode(attempt) ?? '-'} still=${still}`,
  }
})

/* MCPP-007 HTTP MCP（容器内起夹具） */
await report.run('RC5-MCPP-007', 'P0', '本地 HTTP MCP 新建并 probe 成功', async () => {
  if (!existsSync(join(DATA_ROOT, 'access', 'users.db'))) {
    return { status: STATUS.SKIP, detail: 'data-root 不可见，无法确认容器内夹具；--data-root 必须指向 E1 实例根' }
  }
  const start = docker(['exec', '-d', CONTAINER, 'node', '/fixtures/mcp-http-server.mjs', '--port', String(HTTP_PORT)])
  if (start.status !== 0) {
    return { status: STATUS.SKIP, detail: `容器内 HTTP 夹具启动失败（/fixtures 未挂载？）: ${(start.stderr ?? '').slice(0, 160)}` }
  }
  // 等待监听（最多 3s）
  let up = false
  for (let i = 0; i < 15; i++) {
    const health = docker(['exec', CONTAINER, 'node', '-e', `fetch('http://127.0.0.1:${HTTP_PORT}/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))`])
    if (health.status === 0) { up = true; break }
    await new Promise(resolve => setTimeout(resolve, 200))
  }
  if (!up) return { status: STATUS.SKIP, detail: '容器内 HTTP 夹具未监听（检查 node 与 /fixtures）' }
  const result = await upsert(AUTH.b, { name: 'http-b', transport: 'streamable-http', url: `http://127.0.0.1:${HTTP_PORT}/mcp` })
  if (result.ok !== true) return { status: STATUS.FAIL, detail: `upsert: ${shape(result.error)}` }
  const row = result.value?.item
  created.b.push(row?.id)
  const probed = await probe(AUTH.b, row?.id)
  const pass = probed.ok === true && probed.value?.ok === true && Number(probed.value?.toolCount) >= 1
  return {
    status: pass ? STATUS.PASS : STATUS.FAIL,
    detail: `serverName=${row?.serverName} probe=${shape(probed.value ?? probed.error)}`,
  }
})

/* MCPP-008/009 元数据地址拒绝 */
for (const [id, url, label] of [
  ['RC5-MCPP-008', 'http://169.254.169.254/latest/meta-data', 'IPv4 元数据'],
  ['RC5-MCPP-009', 'http://[fd00:ec2::254]/', 'IPv6 元数据'],
]) {
  await report.run(id, 'P0', `${label}地址被拒`, async () => {
    const attempt = await expectDenied(AUTH.b, { name: `meta-${label}`, transport: 'streamable-http', url })
    const message = String(attempt.message ?? '')
    return {
      status: attempt.denied && message.includes('元数据') ? STATUS.PASS : STATUS.FAIL,
      detail: `denied=${attempt.denied} code=${attempt.code ?? '-'} message=${message.slice(0, 60)}`,
    }
  })
}

/* MCPP-012/013 header secret 密文落库 + list 不回值 */
await report.run('RC5-MCPP-012', 'P0', 'header secret 以 AES-GCM 密文落库、日志无明文', async () => {
  const secretValue = `rc5-secret-${randomBytes(12).toString('hex')}`
  const result = await upsert(AUTH.b, {
    name: 'secret-b',
    transport: 'streamable-http',
    url: `http://127.0.0.1:${HTTP_PORT}/mcp`,
    headers: { authorization: '${secret:h1}' },
    secrets: { h1: secretValue },
  })
  if (result.ok !== true) return { status: STATUS.FAIL, detail: `upsert: ${shape(result.error)}` }
  const row = result.value?.item
  created.b.push(row?.id)
  const rows = readDbRows('SELECT hex(ciphertext) AS cipherhex FROM mcp_personal_secret WHERE user_id = ? AND ref = ?', [uidB, 'h1'])
  const cipherHex = rows[0]?.cipherhex
  const plaintextInDb = (() => {
    if (cipherHex === undefined) return 'no-row'
    const buffer = Buffer.from(String(cipherHex), 'hex')
    return buffer.includes(Buffer.from(secretValue, 'utf8')) ? 'plaintext-present' : 'ciphertext-only'
  })()
  // 文件级 grep（含 WAL/SHM）
  let plaintextInFiles = 0
  const dir = join(DATA_ROOT, 'access')
  for (const name of readdirSync(dir)) {
    const path = join(dir, name)
    try {
      const bytes = readFileSync(path)
      if (bytes.includes(Buffer.from(secretValue, 'utf8'))) plaintextInFiles += 1
    } catch {
      // 目录或不可读文件忽略
    }
  }
  const logs = docker(['logs', CONTAINER], { timeoutMs: 120_000 })
  const plaintextInLogs = (logs.stdout ?? '').includes(secretValue) || (logs.stderr ?? '').includes(secretValue)
  const pass = plaintextInDb === 'ciphertext-only' && plaintextInFiles === 0 && !plaintextInLogs
  return {
    status: pass ? STATUS.PASS : STATUS.FAIL,
    detail: `db=${plaintextInDb} filesWithPlaintext=${plaintextInFiles} logPlaintext=${plaintextInLogs}`,
  }
})

await report.run('RC5-MCPP-013', 'P0', 'list 只回 hasSecret:true 与 header 名，不回值', async () => {
  const rows = (await list(AUTH.b)).value?.items ?? []
  const row = rows.find(item => item?.name === 'secret-b')
  const text = JSON.stringify(rows)
  const leaked = /rc5-secret-[0-9a-f]{24}/.test(text)
  return {
    status: row?.hasSecret === true && !leaked ? STATUS.PASS : STATUS.FAIL,
    detail: `hasSecret=${row?.hasSecret} headerNames=${JSON.stringify(row?.headerNames)} leaked=${leaked}`,
  }
})

/* MCPP-021 同名隔离 */
await report.run('RC5-MCPP-021', 'P0', 'A/B 同名 server 的 serverName 不同且互不覆盖', async () => {
  const a = await upsert(AUTH.a, { name: 'same', transport: 'stdio', catalogId: 'echo' })
  const b = await upsert(AUTH.b, { name: 'same', transport: 'stdio', catalogId: 'echo' })
  if (a.ok !== true || b.ok !== true) return { status: STATUS.FAIL, detail: `a=${shape(a.error)} b=${shape(b.error)}` }
  created.a.push(a.value?.item?.id)
  created.b.push(b.value?.item?.id)
  const aName = a.value?.item?.serverName
  const bName = b.value?.item?.serverName
  const aList = (await list(AUTH.a)).value?.items ?? []
  const bList = (await list(AUTH.b)).value?.items ?? []
  const aOnlyOwn = aList.every(item => String(item?.serverName ?? '').startsWith(`p${uidA}_`))
  const bOnlyOwn = bList.every(item => String(item?.serverName ?? '').startsWith(`p${uidB}_`))
  return {
    status: aName !== bName && aOnlyOwn && bOnlyOwn ? STATUS.PASS : STATUS.FAIL,
    detail: `a=${aName} b=${bName} aOnlyOwn=${aOnlyOwn} bOnlyOwn=${bOnlyOwn}`,
  }
})

/* MCPP-014/015 限额（--full） */
if (args.full === true || args.full === 'true') {
  await report.run('RC5-MCPP-014', 'P1', '每人 8 条上限（第 9 条拒绝）', async () => {
    const extra = []
    for (let n = 1; n <= 8; n++) {
      const result = await upsert(AUTH.c, { name: `limit-${n}`, transport: 'stdio', catalogId: 'echo' })
      if (result.ok !== true) return { status: STATUS.FAIL, detail: `第 ${n} 条失败: ${shape(result.error)}` }
      extra.push(result.value?.item?.id)
    }
    created.c.push(...extra)
    const ninth = await upsert(AUTH.c, { name: 'limit-9', transport: 'stdio', catalogId: 'echo' })
    const denied = ninth.ok === false && String(ninth.error?.message ?? '').includes('最多 8')
    return { status: denied ? STATUS.PASS : STATUS.FAIL, detail: `ninth denied=${denied} message=${(ninth.error?.message ?? '').slice(0, 40)}` }
  })

  await report.run('RC5-MCPP-015', 'P1', '256KB 配置上限（原配置不被覆盖）', async () => {
    const big = {}
    for (let n = 1; n <= 40; n++) big[`s${n}`] = 'x'.repeat(7900)
    const before = (await list(AUTH.b)).value?.items?.find(item => item?.id === echoB?.id)
    const attempt = await upsert(AUTH.b, {
      id: echoB?.id,
      name: 'echo-b',
      transport: 'streamable-http',
      url: `http://127.0.0.1:${HTTP_PORT}/mcp`,
      secrets: big,
    })
    const after = (await list(AUTH.b)).value?.items?.find(item => item?.id === echoB?.id)
    const denied = attempt.ok === false && String(attempt.error?.message ?? '').includes('KB')
    return {
      status: denied && JSON.stringify(before) === JSON.stringify(after) ? STATUS.PASS : STATUS.FAIL,
      detail: `denied=${denied} unchanged=${JSON.stringify(before) === JSON.stringify(after)}`,
    }
  })
}

/* MCPP-023 重启持久化（--restart） */
if (args.restart === true || args.restart === 'true') {
  await report.run('RC5-MCPP-023', 'P0', '重启容器后个人配置仍在', async () => {
    const before = (await list(AUTH.b)).value?.items?.map(item => item?.id) ?? []
    const restarted = docker(['restart', '--time', '20', CONTAINER], { timeoutMs: 120_000 })
    if (restarted.status !== 0) return { status: STATUS.FAIL, detail: `restart 失败: ${(restarted.stderr ?? '').slice(0, 120)}` }
    let ready = false
    for (let i = 0; i < 120; i++) {
      const probe = await fetch(new URL('/login', BASE)).catch(() => undefined)
      if (probe?.status === 200) { ready = true; break }
      await new Promise(resolve => setTimeout(resolve, 1000))
    }
    if (!ready) return { status: STATUS.FAIL, detail: '重启后 120s 内 /login 未就绪' }
    const relogin = await login(BASE, accounts.user_b.account, accounts.user_b.password)
    const after = (await list(relogin.cookie)).value?.items?.map(item => item?.id) ?? []
    const same = JSON.stringify(before) === JSON.stringify(after)
    return { status: same ? STATUS.PASS : STATUS.FAIL, detail: `before=${before.length} after=${after.length} same=${same}` }
  })
}

/* 明确不自动化的用例 */
for (const [id, priority, title, reason] of [
  ['RC5-MCPP-016', 'P1', '挂死 stdio 8s 放弃', '需要 live 会话建立挂死子进程；API 层无 8s 时序面'],
  ['RC5-MCPP-017', 'P1', '慢 HTTP 工具 60s 超时', '需要真实工具调用与 60s 等待（P6 E2E）'],
  ['RC5-MCPP-018', 'P1', '断线重连 3 次', '需要长时断连/恢复时序（P6 E2E）'],
  ['RC5-MCPP-019', 'P0', '删除后 live 会话工具当场消失', '需要 live 会话 + tools/list 观察（P6 E2E）'],
  ['RC5-MCPP-020', 'P0', '跨用户 mcp__p<uid>_* 调用 deny', '需要子代理/跨用户会话工具调用（P6 E2E）'],
  ['RC5-MCPP-022', 'P0', '登出后个人工具不可用', '需要 live 会话作用域观察（P6 E2E）'],
  ['RC5-MCPP-024', 'P1', 'MCP UI 双主题三视口', '浏览器人工/截图（P6 UI）'],
]) {
  report.add(id, priority, STATUS.SKIP, title, reason)
}

/* 清理本轮创建的条目（--keep 保留用于人工接管） */
if (args.keep !== true && args.keep !== 'true') {
  let removed = 0
  for (const [key, ids] of Object.entries(created)) {
    for (const id of ids) {
      if (typeof id !== 'string') continue
      const cookie = key === 'a' ? AUTH.a : key === 'b' ? AUTH.b : AUTH.c
      if (cookie === undefined) continue
      const result = await del(cookie, id)
      if (result.ok === true) removed += 1
    }
  }
  report.add('CLEANUP', 'INFO', STATUS.PASS, '清理本轮创建的测试条目', `removed=${removed}`)
}

process.exit(report.finish())