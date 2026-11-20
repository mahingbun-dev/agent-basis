#!/usr/bin/env node
/**
 * E2 · ACC 套件（RC5-ACC-001..010；51 §3.4）。
 *
 * 覆盖：
 *   ACC-001/002/003  packctl tenant-scan / prompt-scan / form-check（E0 静态）
 *   ACC-004/005      mux 漂移与 admin-only 不变式单测（E0）
 *   ACC-006          普通用户访问 mcp-manager 设置/管理动作
 *   ACC-007          B 用 A 的 sessionId 打 unary
 *   ACC-008          B 用 A 的 workspaceId/sessionId 打文件/检索
 *   ACC-009          chat-import 前缀经 access 门；未登录 401
 *   ACC-010          全局事件 allowlist 单测
 *
 * 停止规则：任一跨租户 P0 红 → 套件 halted=true、整体不绿；证据照常落盘。
 * 读写域：仅 rc5-e2suite（3119）与其数据根；写操作只在测试账号自己的资源上。
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { Case, STATUS, summaryOf, writeSummary, shape } from '../_lib/evidence.mjs'
import { LANE, REPO, run, sessions, call, readDb, readText, gitHead } from '../_lib/env.mjs'
import { openMuxSocket } from '../_lib/ws.mjs'

const suite = 'ACC'
const startedAt = new Date().toISOString()
const rows = []
let halted = false
let haltReason = ''

function denied(result) {
  const code = String(result?.error?.code ?? '')
  const message = String(result?.error?.message ?? '')
  // 网关对非 owner Peer 先按资源 decide，拒绝码=remote-access/denied（workspaceFiles
  // 的一元 HTTP 走此路，2026-11-20 ACC-008 修复后不再是 owner 直通）；守卫路由仍回
  // tenant/denied。两者都是显式拒绝。
  return result.status === 403
    || code.includes('tenant/denied')
    || code === 'remote-access/denied'
    || /不属于你|access denied/.test(message)
}

function record(c, status, title, expected, actual, notes = []) {
  const row = c.finish({ status, title, expected, actual, notes, artifacts: ['cmd.log'] })
  rows.push(row)
  if (status === STATUS.FAIL && !halted) {
    halted = true
    haltReason = `${c.id}: ${title}`
  }
  return row
}

function runHost(c, display, cmd, args) {
  const result = run(cmd, args, { timeout: 600_000 })
  c.cmd(display, result.exit, result.stdout, result.stderr)
  return result
}

function auditLines() {
  const dir = join(LANE.dataRoot, '.eterna')
  if (!existsSync(dir)) return []
  const files = readdirSync(dir).filter(name => name.startsWith('audit-') && name.endsWith('.jsonl')).sort()
  const lines = []
  for (const file of files.slice(-2)) {
    for (const line of readFileSync(join(dir, file), 'utf8').split('\n')) {
      if (line.trim() !== '') lines.push(line)
    }
  }
  return lines
}

const s = await sessions()
const uidA = readDb('SELECT id FROM users WHERE account = ?', [s.admin.account])[0]?.id
const uidB = readDb('SELECT id FROM users WHERE account = ?', [s.userB.account])[0]?.id
const uidC = readDb('SELECT id FROM users WHERE account = ?', [s.userC.account])[0]?.id
const wsA = readDb('SELECT workspace_id, path FROM workspaces WHERE owner_id = ?', [uidA])[0]
const wsB = readDb('SELECT workspace_id, path FROM workspaces WHERE owner_id = ?', [uidB])[0]
const aSession = readDb('SELECT session_id FROM sessions WHERE owner_id = ? LIMIT 1', [uidA])[0]?.session_id
const bSession = readDb('SELECT session_id FROM sessions WHERE owner_id = ? LIMIT 1', [uidB])[0]?.session_id
const cSession = readDb('SELECT session_id FROM sessions WHERE owner_id = ? LIMIT 1', [uidC])[0]?.session_id

/* --------------------------------------------------------- ACC-001 */

{
  const c = new Case(suite, 'RC5-ACC-001')
  const result = runHost(c, 'node tools/packctl/bin/packctl.mjs tenant-scan', 'node', ['tools/packctl/bin/packctl.mjs', 'tenant-scan'])
  const clean = /tenant-scan: 0 finding\(s\)/.test(result.stdout)
  c.assert('tenant-scan 0 违规', clean, result.stdout.split('\n')[0])
  record(c, clean ? STATUS.PASS : STATUS.FAIL,
    'packctl tenant-scan 0 违规',
    '0 违规（51 §3.4；WP5-2 清零后复跑）',
    clean ? 'tenant-scan: 0 finding(s)' : result.stdout.split('\n').slice(0, 6).join(' | '))
}

/* --------------------------------------------------------- ACC-002 */

{
  const c = new Case(suite, 'RC5-ACC-002')
  const result = runHost(c, 'node tools/packctl/bin/packctl.mjs prompt-scan', 'node', ['tools/packctl/bin/packctl.mjs', 'prompt-scan'])
  const clean = /prompt-scan: 0 finding\(s\)/.test(result.stdout)
  c.assert('prompt-scan 0 违规', clean, result.stdout.split('\n')[0])
  record(c, clean ? STATUS.PASS : STATUS.FAIL,
    'packctl prompt-scan 0 违规',
    '0 违规（51 §3.4；B13 登记/豁免后复跑）',
    clean ? 'prompt-scan: 0 finding(s)' : result.stdout.split('\n').slice(0, 6).join(' | '))
}

/* --------------------------------------------------------- ACC-003 */

{
  const c = new Case(suite, 'RC5-ACC-003')
  const result = runHost(c, 'node tools/packctl/bin/packctl.mjs form-check --enforce-pair-drift', 'node', ['tools/packctl/bin/packctl.mjs', 'form-check', '--enforce-pair-drift'])
  const clean = result.exit === 0 && /0 finding\(s\)\(0 error\)/.test(result.stdout)
  c.assert('form-check 0 error', clean, result.stdout.split('\n')[0])
  record(c, clean ? STATUS.PASS : STATUS.FAIL,
    'packctl form-check 0 违规',
    '0 违规',
    clean ? 'form-check: 0 finding(s)(0 error)' : result.stdout.split('\n').slice(0, 6).join(' | '))
}

/* --------------------------------------------------------- ACC-004 */

{
  const c = new Case(suite, 'RC5-ACC-004')
  const result = runHost(c,
    'pnpm --filter @eterna/access exec vitest run tests/mux-drift.spec.ts tests/mux-peer-drift.spec.ts',
    'pnpm', ['--filter', '@eterna/access', 'exec', 'vitest', 'run', 'tests/mux-drift.spec.ts', 'tests/mux-peer-drift.spec.ts'])
  const pass = result.exit === 0 && /Test Files\s+2 passed/.test(result.stdout)
  c.assert('mux 漂移测试绿（含 terminal 9 动作）', pass, result.stdout.split('\n').slice(-6).join(' | '))
  record(c, pass ? STATUS.PASS : STATUS.FAIL,
    'mux 动作漂移测试（上游差集=0，含 terminal 9）',
    '`mux-drift` + `mux-peer-drift` 全绿',
    pass ? '2 test files passed' : result.stdout.split('\n').slice(-8).join(' | '))
}

/* --------------------------------------------------------- ACC-005 */

{
  const c = new Case(suite, 'RC5-ACC-005')
  const result = runHost(c,
    'pnpm --filter @eterna/access exec vitest run tests/mux-policy.spec.ts',
    'pnpm', ['--filter', '@eterna/access', 'exec', 'vitest', 'run', 'tests/mux-policy.spec.ts'])
  const pass = result.exit === 0 && /Test Files\s+1 passed/.test(result.stdout)
  c.assert('admin-only 不变式测试绿', pass, result.stdout.split('\n').slice(-6).join(' | '))
  record(c, pass ? STATUS.PASS : STATUS.FAIL,
    'admin-only 不变式（⊆ 全量；无资源动作误入）',
    '`mux-policy` 全绿',
    pass ? '1 test file passed' : result.stdout.split('\n').slice(-8).join(' | '))
}

/* --------------------------------------------------------- ACC-007（隔离核心，先于 006 执行） */

{
  const c = new Case(suite, 'RC5-ACC-007')
  const probes = [
    ['session/state', { sessionId: aSession }],
    ['session/projections', { sessionId: aSession }],
    ['session/rename', { request: { sessionId: aSession, name: 'b-hijack' } }],
    ['session/search', { request: { sessionId: aSession, query: 'marker' } }],
    ['session/title', { request: { sessionId: aSession } }],
    ['session/events', { address: { sessionId: aSession }, maxMessages: 1 }],
  ]
  const results = []
  for (const [method, args] of probes) {
    const result = await call(s.userB.cookie, method, args, { timeoutMs: 20_000 })
    // 404 = 上游无该端点（session/title 是事件名而非 RPC），不计为可达。
    const absent = result.status === 404
    results.push({ method, denied: denied(result), absent, status: result.status, ok: result.ok, code: result.error?.code, value: result.value })
    c.cmd(`POST /api/${method}（B → A 的 sessionId）`, result.status,
      `denied=${denied(result)} absent=${absent} ok=${result.ok} code=${result.error?.code ?? '-'} value=${shape(result.value, 160)}`)
  }
  const leaks = results.filter(row => !row.denied && !row.absent)
  const auditHit = auditLines().some(line => /session\.(events|thinking\.[a-z]+)\.denied|tenant\.denied/.test(line))
  c.assert('存在的 unary 全部被拒', leaks.length === 0, leaks.map(row => `${row.method}:${row.code ?? 'allowed'}`).join(','))
  c.assert('审计有拒绝记录', auditHit)
  record(c, leaks.length === 0 ? STATUS.PASS : STATUS.FAIL,
    'B 用 A 的 sessionId 打 unary 必须 403/deny',
    'state/projections/rename/search/events 全部 tenant/denied；session/title 非 RPC（404）；审计有记录',
    `拒绝=${results.filter(row => row.denied).length}/${results.length}；不存在=${results.filter(row => row.absent).map(row => row.method).join(',') || '无'}；未拒=${leaks.map(row => row.method).join(',') || '无'}；审计命中=${auditHit}`,
    ['session/title 不在 tenant.ts sessionValidated 清单（packages/access/src/tenant.ts:387-392）；实测 404（事件名而非 RPC），不构成可达面'])
}

/* --------------------------------------------------------- ACC-008（隔离核心，先于 006 执行） */

{
  const c = new Case(suite, 'RC5-ACC-008')
  // 夹具：A 工作区放一枚标记文件（内容非凭据）
  const marker = join(LANE.dataRoot, 'workspaces', s.admin.account, 'e2-marker.txt')
  try {
    if (!existsSync(marker)) {
      const dir = join(LANE.dataRoot, 'workspaces', s.admin.account)
      run('mkdir', ['-p', dir])
      run('bash', ['-c', `printf 'E2-ADMIN-SECRET-MARKER-7f3a\\n' > '${marker}'`])
    }
  } catch { /* 夹具已存在 */ }
  const probes = [
    ['session/create（A 的 workspaceId）', 'session/create', { request: { workspaceId: wsA?.workspace_id } }],
    ['workspace/delete（A 的 workspaceId）', 'workspace/delete', { request: { workspaceId: wsA?.workspace_id } }],
    ['directoryPicker/list（A 的根路径）', 'directoryPicker/list', { path: wsA?.path }],
    ['session/search（A 的 sessionId）', 'session/search', { request: { sessionId: aSession, query: 'marker' } }],
    ['workspaceFiles/list（A 的 sessionId）', 'workspaceFiles/list', { workspaceFileScopeId: aSession, path: wsA?.path }],
    ['workspaceFiles/stat（A 的 sessionId）', 'workspaceFiles/stat', { workspaceFileScopeId: aSession, path: 'e2-marker.txt' }],
    ['workspaceFiles/read（A 的 sessionId）', 'workspaceFiles/read', { workspaceFileScopeId: aSession, path: 'e2-marker.txt', range: { offset: 1, lines: 10 } }],
  ]
  const results = []
  for (const [label, method, args] of probes) {
    const result = await call(s.userB.cookie, method, args, { timeoutMs: 20_000 })
    results.push({ label, method, denied: denied(result), ok: result.ok, code: result.error?.code, value: result.value })
    c.cmd(`POST /api/${method}（B 使用 A 的 workspace/session）`, result.status,
      `${label} denied=${denied(result)} ok=${result.ok} code=${result.error?.code ?? '-'} value=${shape(result.value, 220)}`)
  }
  const control = await call(s.userB.cookie, 'session/create', { request: { workspaceId: wsB?.workspace_id } })
  c.cmd('POST /api/session/create（B 自己的 workspaceId，正向控制）', control.status, `ok=${control.ok} sessionId=${control.value?.sessionId ?? '-'}`)
  const leaks = results.filter(row => !row.denied)
  const contentLeak = results.some(row => row.method === 'workspaceFiles/read' && row.ok === true && /E2-ADMIN-SECRET-MARKER/.test(JSON.stringify(row.value)))
  c.assert('跨租户文件/检索全部被拒', leaks.length === 0, leaks.map(row => row.method).join(','))
  c.assert('未读到 A 的文件内容', !contentLeak)
  c.assert('正向控制：B 自己的 workspace 可建会话', control.ok === true)
  record(c, leaks.length === 0 ? STATUS.PASS : STATUS.FAIL,
    'B 用 A 的 workspaceId/sessionId 打文件/检索必须 403/deny',
    'workspace 系与文件/检索全部 403/deny；读不到 A 的文件内容',
    `拒绝=${results.filter(row => row.denied).length}/${results.length}；未拒=${leaks.map(row => row.method).join(',') || '无'}；A 文件内容泄漏=${contentLeak}`,
    ['workspaceFiles/* unary 不在 tenant.ts 守卫清单（grep 无 workspaceFiles），走 owner Peer，与 TERM-004 同根因'])
}

/* --------------------------------------------------------- ACC-006 */

{
  const c = new Case(suite, 'RC5-ACC-006')
  // 管理面夹具：admin 先登记一个系统层 stdio server（echo 夹具），让 probe/restart
  // 的“允许”形态可观测（否则未知名字的 200 失败会被误读为门已生效）。
  const addSys = await call(s.admin.cookie, 'settings/update', {
    request: { ns: 'mcp-manager', patch: { servers: { e2sys: { transport: 'stdio', command: 'node', args: ['/fixtures/mcp-echo-server.mjs'] } } } },
  })
  c.cmd('POST /api/settings/update ns=mcp-manager（A 登记系统 server e2sys）', addSys.status, `ok=${addSys.ok} code=${addSys.error?.code ?? '-'}`)
  const asB = await call(s.userB.cookie, 'settings/describe')
  const asA = await call(s.admin.cookie, 'settings/describe')
  const nsB = (asB.value?.namespaces ?? []).map(row => row.ns)
  const nsA = (asA.value?.namespaces ?? []).map(row => row.ns)
  c.cmd('POST /api/settings/describe（B）', asB.status, `namespaces=${nsB.length} 含mcp-manager=${nsB.includes('mcp-manager')}`)
  c.cmd('POST /api/settings/describe（A）', asA.status, `namespaces=${nsA.length} 含mcp-manager=${nsA.includes('mcp-manager')}`)
  const write = await call(s.userB.cookie, 'settings/update', { request: { ns: 'mcp-manager', patch: { servers: { rogue: { transport: 'stdio', command: 'true' } } } } })
  c.cmd('POST /api/settings/update ns=mcp-manager（B）', write.status, `ok=${write.ok} code=${write.error?.code ?? '-'}`)
  const socket = await openMuxSocket({ port: LANE.port, cookie: s.userB.cookie })
  socket.send({ type: 'open', streamId: 'acc6-watch', endpoint: 'mcpManager/watch', payload: { args: {} } })
  const message = await socket.waitMessage(row => row.streamId === 'acc6-watch', 8000).catch(error => ({ error: { message: error.message } }))
  socket.close()
  c.cmd('WS /api/remote.mux open {endpoint:"mcpManager/watch"}（B）', 0, shape(message, 300))
  const watchDenied = message?.type === 'error' && String(message.error?.code ?? '').includes('denied')
  const probe = await call(s.userB.cookie, 'mcpManager/probe', { name: 'e2sys' }, { timeoutMs: 30_000 })
  const restart = await call(s.userB.cookie, 'mcpManager/restart', { name: 'e2sys' }, { timeoutMs: 30_000 })
  c.cmd('POST /api/mcpManager/probe（B）', probe.status, `ok=${probe.ok} code=${probe.error?.code ?? '-'} value=${shape(probe.value, 160)}`)
  c.cmd('POST /api/mcpManager/restart（B）', restart.status, `ok=${restart.ok} code=${restart.error?.code ?? '-'}`)
  const hidden = !nsB.includes('mcp-manager') && nsA.includes('mcp-manager')
  const writeDenied = write.ok !== true
  const unaryDenied = probe.status === 403 && restart.status === 403
  const pass = hidden && writeDenied && watchDenied && unaryDenied
  c.assert('B 的 describe 无 mcp-manager', hidden, `B含=${nsB.includes('mcp-manager')} A含=${nsA.includes('mcp-manager')}`)
  c.assert('B 写 mcp-manager 被拒', writeDenied)
  c.assert('B watch 被拒', watchDenied)
  c.assert('B probe/restart 均 403', unaryDenied, `probe=${probe.status}/${probe.ok} restart=${restart.status}/${restart.ok}`)
  record(c, pass ? STATUS.PASS : STATUS.FAIL,
    '普通用户访问 mcp-manager 设置/管理动作不可见且被拒',
    'settings/describe 无 mcp-manager；watch/restart/probe 全 403/deny',
    `设置隐藏=${hidden} 写拒=${writeDenied} watch拒=${watchDenied} unary拒=${unaryDenied}（probe=${probe.status}/${probe.ok} restart=${restart.status}/${restart.ok}）`,
    ['与 E1 RC5-MCPS-006 同根因：HTTP unary 走 owner Peer，ADMIN_ONLY_UNARY_ACTIONS 只收窄 UI 快照门（packages/access/src/mux.ts:171-177）'])
}

/* --------------------------------------------------------- ACC-009 */

{
  const c = new Case(suite, 'RC5-ACC-009')
  const unauth = await fetch(new URL('/api/deepseek-chat-import/archive', LANE.base), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ workspaceId: wsB?.workspace_id, archive: [] }),
  }).catch(error => ({ status: -1, text: async () => error.message }))
  const status = unauth.status
  const body = await unauth.text()
  c.cmd('POST /api/deepseek-chat-import/archive（无 cookie）', status, String(body).slice(0, 160))
  const login = await fetch(new URL('/api/deepseek-chat-import/archive', LANE.base), {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie: s.userB.cookie },
    body: JSON.stringify({ workspaceId: wsB?.workspace_id, archive: [] }),
  }).catch(error => ({ status: -1, text: async () => error.message }))
  const loginStatus = login.status
  const loginBody = await login.text()
  c.cmd('POST /api/deepseek-chat-import/archive（B 登录 + 自己的 workspaceId + 空归档）', loginStatus, String(loginBody).slice(0, 160))
  const pass = status === 401 && loginStatus !== 401 && loginStatus !== 403
  c.assert('未登录 401', status === 401, `status=${status}`)
  c.assert('登录用户经 access 门（非 401/403）', loginStatus !== 401 && loginStatus !== 403, `status=${loginStatus}`)
  record(c, pass ? STATUS.PASS : STATUS.FAIL,
    'chat-import 路由经 access 门；未登录 401',
    '无 cookie → 401；登录用户不被 access 门拦截',
    `未登录=${status}；登录=${loginStatus}`,
    ['空归档用于验证门而非导入语义；写操作仅测试账号自己的 workspace'])
}

/* --------------------------------------------------------- ACC-010 */

{
  const c = new Case(suite, 'RC5-ACC-010')
  const result = runHost(c,
    'pnpm --filter @eterna/access exec vitest run tests/mux-policy.spec.ts tests/mux-drift.spec.ts',
    'pnpm', ['--filter', '@eterna/access', 'exec', 'vitest', 'run', 'tests/mux-policy.spec.ts', 'tests/mux-drift.spec.ts'])
  const pass = result.exit === 0 && /Test Files\s+2 passed/.test(result.stdout)
  c.assert('全局事件 allowlist 单测绿（五个失效信号仍授 global）', pass, result.stdout.split('\n').slice(-6).join(' | '))
  record(c, pass ? STATUS.PASS : STATUS.FAIL,
    '全局事件 allowlist 单测',
    '五个失效信号仍授 global；无回归',
    pass ? '2 test files passed' : result.stdout.split('\n').slice(-8).join(' | '),
    ['mux-drift 断言 GLOBAL_EVENT_ACTIONS 五项均在上游转发清单且不带 resources（packages/access/tests/mux-drift.spec.ts:294-318）'])
}

const summary = summaryOf(rows, {
  suite, env: {
    commit: gitHead(), imageTag: LANE.imageTag, imageId: LANE.imageId, container: LANE.container,
    base: LANE.base, dataRoot: LANE.dataRoot, startedAt, halted, haltReason,
  },
})
writeSummary(suite, summary)
console.log(`[ACC] PASS=${summary.pass} FAIL=${summary.fail} SKIP=${summary.skip} NOTRUN=${summary.notrun} halted=${halted}`)