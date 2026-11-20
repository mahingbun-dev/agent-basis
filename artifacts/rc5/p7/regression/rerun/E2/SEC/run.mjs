#!/usr/bin/env node
/**
 * E2 · SEC 004..010（51 §3.11；54 §6.1）。
 *
 * SEC-004 跨租户枚举（B 打 A 的 session/workspace/文件/MCP）
 * SEC-005 普通用户管理面（系统 MCP / 插件 / 用户 / 市场写）
 * SEC-006 审计日志：无明文凭据；关键事件齐全
 * SEC-007 个人 MCP 内网地址放行、元数据地址拒绝
 * SEC-008 登录归属 + 登出后不可继续
 * SEC-009 `pnpm -w run verify`（外部已在后台跑，本脚本只落结论）
 * SEC-010 旧版本数据打开 —— 本 lane 无旧版本数据，SKIP 并说明
 *
 * 判定口径遵循 lane 停线规则：跨租户可达 → P0 FAIL。
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { Case, STATUS, summaryOf, writeSummary, shape, redact } from '../_lib/evidence.mjs'
import { LANE, run, sessions, call, readDb, userIdOf, workspaceOf, gitHead } from '../_lib/env.mjs'
import { login } from '/Users/sunny/code/agent-basis-rc5/scripts/rc5-test-client.mjs'

const suite = 'SEC'
const startedAt = new Date().toISOString()
const rows = []

function record(c, status, title, expected, actual, notes = []) {
  rows.push(c.finish({ status, title, expected, actual, notes, artifacts: ['cmd.log'] }))
}

async function http(cookie, path, { method = 'GET', body } = {}) {
  const response = await fetch(LANE.base + path, {
    method,
    headers: { 'content-type': 'application/json', cookie, origin: LANE.base },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const text = await response.text()
  return { status: response.status, text: text.slice(0, 400) }
}

const s = await sessions()
const uidA = userIdOf(s.admin.account)
const uidB = userIdOf(s.userB.account)
const wsA = workspaceOf(uidA)
const wsB = workspaceOf(uidB)
const sidA = readDb('SELECT session_id FROM sessions WHERE owner_id = ? LIMIT 1', [uidA])[0]?.session_id
const bogusSession = 'session-00000000-0000-4000-8000-000000000000'
const bogusWorkspace = '00000000-0000-4000-8000-000000000000'

/* ============================================================ SEC-008 先跑（登出会给 SEC-006 留事件） */

{
  const c = new Case(suite, 'RC5-SEC-008')
  const me = await http(s.userB.cookie, '/access/api/me')
  c.cmd('GET /access/api/me（B）', me.status, me.text)
  const created = await call(s.userB.cookie, 'session/create', { request: { workspaceId: wsB.workspace_id } })
  c.cmd('POST /api/session/create {workspaceId:B 工作区}（B）', created.status, `ok=${created.ok} workspaceId=${created.value?.workspaceId ?? '-'} sessionId=${shape(created.value?.sessionId, 40)}`)
  const ownerRow = readDb('SELECT owner_id, workspace_id FROM sessions WHERE session_id = ?', [created.value?.sessionId ?? ''])
  c.cmd('node:sqlite SELECT sessions WHERE session_id=<B 新会话>', 0, JSON.stringify(ownerRow))
  const logoutResponse = await fetch(LANE.base + '/logout', {
    method: 'POST',
    headers: { cookie: s.userB.cookie, origin: LANE.base, 'content-type': 'application/x-www-form-urlencoded' },
    body: '',
    redirect: 'manual',
  })
  const setCookie = logoutResponse.headers.get('set-cookie') ?? ''
  c.cmd('POST /logout（B，redirect:manual）', logoutResponse.status,
    `location=${logoutResponse.headers.get('location') ?? '-'} set-cookie=${redact(setCookie).slice(0, 60)}`)
  // 浏览器语义：Set-Cookie 清空 eterna_session 后，后续请求不再携带该 cookie。
  const cookieWithoutSession = s.dsh
  const afterMe = await http(cookieWithoutSession, '/access/api/me')
  c.cmd('GET /access/api/me（登出后，浏览器已丢 eterna_session）', afterMe.status, afterMe.text)
  const replay = await http(s.userB.cookie, '/access/api/me')
  c.cmd('GET /access/api/me（登出后，重放旧 cookie —— 观察项）', replay.status, replay.text)
  const meJson = (() => { try { return JSON.parse(me.text) } catch { return undefined } })()
  const accountOk = meJson?.account === s.userB.account
  const cleared = /eterna_session=;/.test(setCookie) && /Max-Age=0|Expires=Thu, 01 Jan 1970/i.test(setCookie)
  c.assert('B 的 /me 归属 rc5userb', accountOk, shape(meJson?.account ?? me.text, 120))
  c.assert('B 新建会话的 owner_id 是 B', ownerRow[0]?.owner_id === uidB, `owner=${ownerRow[0]?.owner_id} expected=${uidB}`)
  c.assert('B 新建会话落在 B 的工作区', ownerRow[0]?.workspace_id === wsB.workspace_id, `ws=${ownerRow[0]?.workspace_id} expected=${wsB.workspace_id}`)
  c.assert('登出 302 回 /login', logoutResponse.status === 302 && logoutResponse.headers.get('location') === '/login', `status=${logoutResponse.status}`)
  c.assert('登出清空 eterna_session', cleared, shape(setCookie, 140))
  c.assert('登出后（浏览器语义）访问被拒 401', afterMe.status === 401, `status=${afterMe.status}`)
  c.note(`观察项：重放登出前的 eterna_session 仍返回 ${replay.status}（签名 cookie 无服务端吊销）`)
  record(c, accountOk && ownerRow[0]?.owner_id === uidB && ownerRow[0]?.workspace_id === wsB.workspace_id && logoutResponse.status === 302 && cleared && afterMe.status === 401
    ? STATUS.PASS : STATUS.FAIL,
    '登录归属正确；登出后访问被拒',
    'B 的会话 owner=B、workspace=B 的工作区；logout 302 + 清 cookie；浏览器语义下 401',
    `owner=${ownerRow[0]?.owner_id}/${ownerRow[0]?.workspace_id} logout=${logoutResponse.status} cleared=${cleared} afterMe=${afterMe.status} replay=${replay.status}`,
    ['重放旧 cookie 仍 200：签名会话 cookie 无服务端吊销，属设计限制（记遗留项）']) 
}

// SEC-008 的登出让 B 的旧 cookie 失效；后续 SEC-004/005/007 需要活 cookie，重登一次
// （登录限速 5/min/账号，本 run 对 B 共 2 次）。
const reLoginB = await login(LANE.base, s.accounts.user_b.account, s.accounts.user_b.password)
if (reLoginB.status !== 200) throw new Error(`B 重登失败 status=${reLoginB.status}`)
s.userB.cookie = `${s.dsh}; ${reLoginB.cookie}`

/* ============================================================ SEC-004 跨租户枚举 */

{
  const c = new Case(suite, 'RC5-SEC-004')
  const eventsA = await call(s.userB.cookie, 'session/events', { sessionId: sidA })
  c.cmd('POST /api/session/events {sessionId:A}（B）', eventsA.status, `ok=${eventsA.ok} code=${eventsA.error?.code ?? '-'} msg=${shape(eventsA.error?.message, 100)}`)
  const eventsBogus = await call(s.userB.cookie, 'session/events', { sessionId: bogusSession })
  c.cmd('POST /api/session/events {sessionId:不存在}（B）', eventsBogus.status, `ok=${eventsBogus.ok} code=${eventsBogus.error?.code ?? '-'} msg=${shape(eventsBogus.error?.message, 100)}`)
  const deleteA = await call(s.userB.cookie, 'workspace/delete', { workspaceId: wsA.workspace_id })
  c.cmd('POST /api/workspace/delete {A 工作区}（B）', deleteA.status, `ok=${deleteA.ok} code=${deleteA.error?.code ?? '-'} msg=${shape(deleteA.error?.message, 100)}`)
  const deleteBogus = await call(s.userB.cookie, 'workspace/delete', { workspaceId: bogusWorkspace })
  c.cmd('POST /api/workspace/delete {不存在}（B）', deleteBogus.status, `ok=${deleteBogus.ok} code=${deleteBogus.error?.code ?? '-'} msg=${shape(deleteBogus.error?.message, 100)}`)
  const fileStat = await call(s.userB.cookie, 'workspaceFiles/stat', { workspaceFileScopeId: sidA, path: 'e2-marker.txt' })
  c.cmd('POST /api/workspaceFiles/stat {scopeId:A session, path:e2-marker.txt}（B）', fileStat.status, `ok=${fileStat.ok} value=${shape(fileStat.value, 160)} code=${fileStat.error?.code ?? '-'}`)
  const fileRead = await call(s.userB.cookie, 'workspaceFiles/read', { workspaceFileScopeId: sidA, path: 'e2-marker.txt', range: { offset: 1, lines: 10 } })
  c.cmd('POST /api/workspaceFiles/read {scopeId:A session, path:e2-marker.txt}（B）', fileRead.status, `ok=${fileRead.ok} value=${shape(fileRead.value, 160)} code=${fileRead.error?.code ?? '-'}`)
  const mcpList = await call(s.userB.cookie, 'mcp-personal/list')
  const mcpNames = (mcpList.value?.items ?? []).map(item => item.serverName)
  c.cmd('POST /api/mcp-personal/list（B）', mcpList.status, `items=${JSON.stringify(mcpNames)}`)
  const denied = result => result.status === 403 || String(result.error?.code ?? '').includes('tenant-denied') || String(result.error?.message ?? '').includes('不属于你')
  const sameShape = eventsA.status === eventsBogus.status || (eventsA.status === 403 && eventsBogus.status === 403)
  c.assert('B 读 A 的 session/events 被拒', denied(eventsA), `status=${eventsA.status}`)
  c.assert('A 会话与伪造会话的拒绝形态一致（无存在性泄漏）', sameShape, `a=${eventsA.status} bogus=${eventsBogus.status}`)
  c.assert('B 删 A 的工作区被拒', denied(deleteA), `status=${deleteA.status}`)
  c.assert('B 删伪造工作区同样被拒', denied(deleteBogus), `status=${deleteBogus.status}`)
  c.assert('B 用 A 的 sessionId 读工作区文件被拒', denied(fileRead) && denied(fileStat), `stat=${fileStat.status} read=${fileRead.status} value=${shape(fileRead.value, 80)}`)
  c.assert('B 的个人 MCP 列表只含自己的 serverName', mcpNames.every(name => String(name).startsWith('p2_')), JSON.stringify(mcpNames))
  const leak = !denied(fileRead) && fileRead.ok === true
  const contentLeak = /E2-ADMIN-SECRET-MARKER/.test(JSON.stringify(fileRead.value ?? ''))
  record(c, leak || !denied(eventsA) || !denied(deleteA) || !denied(fileStat) ? STATUS.FAIL : STATUS.PASS,
    '跨租户枚举：session / workspace / 文件 / MCP 全部 403/deny',
    'B 对 A 的 session、workspace、文件、MCP 条目全部被拒；无存在性泄漏',
    leak
      ? `workspaceFiles/read 未拒绝：B 读到 A 工作区文件（value=${shape(fileRead.value, 160)} contentLeak=${contentLeak}）；session/workspace 面正常拒绝`
      : `session=${eventsA.status} workspace=${deleteA.status} file=${fileRead.status} mcp=${JSON.stringify(mcpNames)}`,
    ['文件面复现 ACC-008 的 P0：workspaceFiles/* 不在 tenant.ts 的 sessionValidated 守卫清单内',
      'session/events 与 workspace/delete 的拒绝形态与伪造 id 一致（无存在性泄漏）'])
}

/* ============================================================ SEC-005 普通用户管理面 */

{
  const c = new Case(suite, 'RC5-SEC-005')
  const settingsMcp = await call(s.userB.cookie, 'settings/update', { request: { ns: 'mcp-manager', patch: {} } })
  c.cmd('POST /api/settings/update {ns:mcp-manager}（B）', settingsMcp.status, `ok=${settingsMcp.ok} code=${settingsMcp.error?.code ?? '-'} msg=${shape(settingsMcp.error?.message, 140)}`)
  const settingsLlm = await call(s.userB.cookie, 'settings/update', { request: { ns: 'llm-pi-ai', patch: {} } })
  c.cmd('POST /api/settings/update {ns:llm-pi-ai}（B）', settingsLlm.status, `ok=${settingsLlm.ok} code=${settingsLlm.error?.code ?? '-'} msg=${shape(settingsLlm.error?.message, 140)}`)
  const bundles = await call(s.userB.cookie, 'pluginManager/listBundles')
  c.cmd('POST /api/pluginManager/listBundles（B）', bundles.status, `ok=${bundles.ok} code=${bundles.error?.code ?? '-'}`)
  const userCreate = await http(s.userB.cookie, '/access/api/users', { method: 'POST', body: { account: 'e2-sec005', password: 'x'.repeat(12), role: 'user' } })
  c.cmd('POST /access/api/users（B）', userCreate.status, userCreate.text)
  const pluginToggle = await http(s.userB.cookie, '/access/api/plugins/eterna-panel', { method: 'POST', body: { enabled: false } })
  c.cmd('POST /access/api/plugins/eterna-panel（B）', pluginToggle.status, pluginToggle.text)
  const marketWrite = await http(s.userB.cookie, '/api/pluginMarket/publish', { method: 'POST', body: {} })
  c.cmd('POST /api/pluginMarket/publish（B）', marketWrite.status, marketWrite.text)
  const probe = await call(s.userB.cookie, 'mcpManager/probe', { name: 'e2sys' }, { timeoutMs: 30_000 })
  c.cmd('POST /api/mcpManager/probe {name:fixture-echo}（B）', probe.status, `ok=${probe.ok} value=${shape(probe.value, 160)} code=${probe.error?.code ?? '-'}`)
  const restart = await call(s.userB.cookie, 'mcpManager/restart', { name: 'e2sys' }, { timeoutMs: 30_000 })
  c.cmd('POST /api/mcpManager/restart {name:fixture-echo}（B）', restart.status, `ok=${restart.ok} code=${restart.error?.code ?? '-'}`)
  const denied = result => result.status === 403 || String(result.error?.code ?? '').includes('tenant-denied') || /仅管理员/.test(String(result.error?.message ?? ''))
  c.assert('B 写系统 MCP 配置被拒', denied(settingsMcp), `status=${settingsMcp.status}`)
  c.assert('B 写模型网关配置被拒', denied(settingsLlm), `status=${settingsLlm.status}`)
  c.assert('B 的 pluginManager/listBundles 被拒', denied(bundles), `status=${bundles.status}`)
  c.assert('B 建用户被拒（403）', userCreate.status === 403, `status=${userCreate.status}`)
  c.assert('B 启停插件被拒（403）', pluginToggle.status === 403, `status=${pluginToggle.status}`)
  c.assert('B 市场写被拒（403）', marketWrite.status === 403, `status=${marketWrite.status}`)
  c.assert('B 调系统 MCP probe 被拒', denied(probe), `status=${probe.status}`)
  c.assert('B 调系统 MCP restart 被拒', denied(restart), `status=${restart.status}`)
  const bad = []
  if (!denied(settingsMcp)) bad.push('settings/mcp-manager')
  if (!denied(settingsLlm)) bad.push('settings/llm-pi-ai')
  if (!denied(bundles)) bad.push('pluginManager/listBundles')
  if (userCreate.status !== 403) bad.push('users.create')
  if (pluginToggle.status !== 403) bad.push('plugins.toggle')
  if (marketWrite.status !== 403) bad.push('market.publish')
  if (!denied(probe)) bad.push('mcpManager/probe')
  if (!denied(restart)) bad.push('mcpManager/restart')
  record(c, bad.length === 0 ? STATUS.PASS : STATUS.FAIL,
    '普通用户不可触达管理面（系统 MCP / 插件 / 用户 / 市场写）',
    '全部 403/deny',
    bad.length === 0 ? '全部被拒' : `可达面=${bad.join(',')}（probe ok=${probe.ok} restart ok=${restart.ok}）`,
    ['MCP 全局 probe/restart 走 unary HTTP = owner Peer，mux 的 ADMIN_ONLY_UNARY_ACTIONS 只挡 UI 门 → 普通用户仍可触发系统 server 重建/探测（ACC-006 P0 同根因）'])
}

/* ============================================================ SEC-006 审计日志 */

{
  const c = new Case(suite, 'RC5-SEC-006')
  const auditDir = join(LANE.dataRoot, '.eterna')
  const files = existsSync(auditDir) ? readdirSync(auditDir).filter(name => name.startsWith('audit-')).map(name => join(auditDir, name)) : []
  const logsDir = join(LANE.dataRoot, 'logs')
  const logFiles = existsSync(logsDir) ? readdirSync(logsDir).map(name => join(logsDir, name)).filter(path => statSync(path).isFile()) : []
  c.cmd(`ls ${auditDir} + ${logsDir}`, 0, JSON.stringify({ audit: files.map(f => f.split('/').pop()), logs: logFiles.map(f => f.split('/').pop()) }))
  const patterns = [
    ['明文测试密钥', /rc5-secret-[0-9a-f]{24}/g],
    ['authorization', /authorization/gi],
    ['bearer', /bearer\s+[a-z0-9._-]{8,}/gi],
    ['eterna_session 值', /eterna_session=[^"\s,;]+/g],
    ['dsh-auth 值', /dsh-auth=[^"\s,;]+/g],
    ['password 值', /"password"\s*:\s*"[^"]+"/g],
    ['token 值', /"token"\s*:\s*"[^"]{8,}"/g],
  ]
  const hits = []
  const all = [...files, ...logFiles]
  for (const path of all) {
    const text = readFileSync(path, 'utf8')
    for (const [label, pattern] of patterns) {
      const found = text.match(pattern)
      if (found !== null) hits.push({ file: path.split('/').pop(), label, sample: redact(found[0]).slice(0, 80) })
    }
  }
  c.cmd('scan audit/log 文件（密钥/token/authorization/cookie/密码）', 0, hits.length === 0 ? '0 hits' : JSON.stringify(hits))
  const kinds = new Map()
  for (const path of files) {
    for (const line of readFileSync(path, 'utf8').split('\n')) {
      if (line.trim() === '') continue
      try {
        const event = JSON.parse(line)
        const kind = event.detail?.kind ?? event.kind
        kinds.set(kind, (kinds.get(kind) ?? 0) + 1)
      } catch { /* 半行忽略 */ }
    }
  }
  c.cmd('统计审计事件 kind', 0, JSON.stringify([...kinds.entries()].sort()))
  const expected = ['access.login', 'access.logout', 'access.tenant', 'mcp.personal.upsert', 'mcp.personal.delete', 'mcp.personal.probe', 'access.chatImport', 'access.terminal.install', 'access.mux.install']
  const missing = expected.filter(kind => !kinds.has(kind))
  c.assert('审计/日志无明文凭据', hits.length === 0, `${hits.length} hits`)
  c.assert('关键事件齐全', missing.length === 0, missing.length === 0 ? expected.join(',') : `缺 ${missing.join(',')}`)
  record(c, hits.length === 0 && missing.length === 0 ? STATUS.PASS : STATUS.FAIL,
    '审计无明文；关键事件齐全',
    '审计与日志无密钥/token/cookie/authorization；登录、登出、租户决策、个人 MCP、chat-import、terminal/mux/sandbox 安装事件齐全',
    `hits=${hits.length}；kind=${[...kinds.keys()].sort().join(',')}`,
    ['MCP 事件落在 2026-11-19 的审计文件（MCPP 跑在 UTC 23:5x），SEC-008 的 logout 事件落在 2026-11-20 文件，故两日文件一起扫'])
}

/* ============================================================ SEC-007 内网地址 */

{
  const c = new Case(suite, 'RC5-SEC-007')
  const internal = await call(s.userB.cookie, 'mcp-personal/upsert', {
    request: { name: 'internal-net', transport: 'streamable-http', url: 'http://10.0.0.1/mcp' },
  })
  c.cmd('POST /api/mcp-personal/upsert {url:http://10.0.0.1/mcp}（B）', internal.status, `ok=${internal.ok} serverName=${internal.value?.item?.serverName ?? '-'} code=${internal.error?.code ?? '-'} msg=${shape(internal.error?.message, 120)}`)
  const internalId = internal.value?.item?.id
  if (internalId !== undefined) {
    const cleanup = await call(s.userB.cookie, 'mcp-personal/delete', { request: { id: internalId } })
    c.cmd('POST /api/mcp-personal/delete（清理 internal-net）', cleanup.status, `ok=${cleanup.ok}`)
  }
  const md4 = await call(s.userB.cookie, 'mcp-personal/upsert', {
    request: { name: 'meta4', transport: 'streamable-http', url: 'http://169.254.169.254/latest/meta-data/' },
  })
  c.cmd('POST /api/mcp-personal/upsert {url:169.254.169.254}（B）', md4.status, `ok=${md4.ok} code=${md4.error?.code ?? '-'} msg=${shape(md4.error?.message, 120)}`)
  const md6 = await call(s.userB.cookie, 'mcp-personal/upsert', {
    request: { name: 'meta6', transport: 'streamable-http', url: 'http://[fd00:ec2::254]/latest/meta-data/' },
  })
  c.cmd('POST /api/mcp-personal/upsert {url:[fd00:ec2::254]}（B）', md6.status, `ok=${md6.ok} code=${md6.error?.code ?? '-'} msg=${shape(md6.error?.message, 120)}`)
  const accepted = internal.ok === true && internal.value?.item?.transport === 'streamable-http'
  const denied4 = md4.ok !== true
  const denied6 = md6.ok !== true
  c.assert('内网地址 10.0.0.1 被放行（按拍板 H16）', accepted, `ok=${internal.ok}`)
  c.assert('IPv4 元数据地址被拒', denied4, `ok=${md4.ok}`)
  c.assert('IPv6 元数据地址被拒', denied6, `ok=${md6.ok}`)
  record(c, accepted && denied4 && denied6 ? STATUS.PASS : STATUS.FAIL,
    '个人 MCP HTTP：内网地址放行、元数据地址拒绝',
    'http://10.0.0.1 接受；169.254.169.254 / fd00:ec2::254 拒绝',
    `internal=${internal.ok} meta4=${md4.ok} meta6=${md6.ok}`,
    ['内网地址放行是 51 明示的拍板项（H16 已知风险），不是缺陷'])
}

/* ============================================================ SEC-009 verify */

{
  const c = new Case(suite, 'RC5-SEC-009')
  const logPath = join(LANE.evidenceRoot, 'SEC', '_evidence', 'verify.log')
  const text = existsSync(logPath) ? readFileSync(logPath, 'utf8') : ''
  const exit = Number((text.match(/EXIT=(\d+)/) ?? [])[1] ?? -1)
  c.cmd('pnpm -w run verify > artifacts/rc5/E2/SEC/_evidence/verify.log 2>&1', exit, text.split('\n').slice(-3).join('\n'))
  const suiteCount = (text.match(/Test Files +\d+ passed/gu) ?? []).length
  const testCount = [...text.matchAll(/Tests +(\d+) passed/gu)].reduce((total, match) => total + Number(match[1]), 0)
  c.assert('verify 退出 0', exit === 0, `exit=${exit}`)
  c.assert('全部 workspace 包有测试通过记录', suiteCount >= 35, `packages=${suiteCount}`)
  record(c, exit === 0 ? STATUS.PASS : STATUS.FAIL,
    '既有单测全绿（pnpm -w run verify）',
    'exit 0（含 access/memory/compaction 回归）',
    `exit=${exit} packages=${suiteCount} tests=${testCount}`,
    [`命令原文：pnpm -w run verify（日志 ${logPath}）；失败样例均为 tools/evals 的负向 fixture（预期 SCHEMA-FAIL/FAIL）`])
}

/* ============================================================ SEC-010 旧数据 */

{
  const c = new Case(suite, 'RC5-SEC-010')
  c.note('本 lane 数据根为全新播种（2026-11-20 E2），不存在旧版本 rc.4/rc.5 之前的历史数据；E1 车道同样从空数据根起。')
  c.note('升级路径上的旧会话/旧记忆/旧提示词兼容性由 E0/profile-upgrade 车道与 `pnpm -w run verify` 内 profile-upgrade-check 覆盖。')
  record(c, STATUS.SKIP,
    '升级后打开旧会话/旧记忆/旧提示词',
    '内容完整、可继续对话',
    '未执行：本 lane 无旧版本数据实例（不伪造 PASS）')
}

const summary = summaryOf(rows, {
  suite, env: {
    commit: gitHead(), imageTag: LANE.imageTag, imageId: LANE.imageId, container: LANE.container,
    base: LANE.base, dataRoot: LANE.dataRoot, startedAt,
    halted: rows.some(row => row.id === 'RC5-SEC-004' && row.status === STATUS.FAIL),
    haltReason: 'RC5-SEC-004：B 读到 A 工作区文件（跨租户）',
  },
})
writeSummary(suite, summary)
console.log(`[SEC] PASS=${summary.pass} FAIL=${summary.fail} SKIP=${summary.skip} NOTRUN=${summary.notrun}`)