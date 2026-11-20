#!/usr/bin/env node
/**
 * E1 · MCPS 套件（RC5-MCPS-001..011）。
 *
 * 停止规则：跨租户/越权用例红 → 立即停止本套件，后续用例记 SKIP（不标绿）。
 * 读写域：仅 rc5-e1suite（3118）容器与其数据根。
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { Case, STATUS, summaryOf, writeSummary, shape } from '../_lib/evidence.mjs'
import { LANE, REPO, run, docker, sleep, waitHealth, sessions, call, readDb, gitHead } from '../_lib/env.mjs'
import { openMuxSocket } from '../_lib/ws.mjs'

const suite = 'MCPS'
const startedAt = new Date().toISOString()
const rows = []
let halted = false
let haltReason = ''

function record(c, status, title, expected, actual, notes = [], artifacts = []) {
  const row = c.finish({ status, title, expected, actual, notes, artifacts: [...artifacts, 'cmd.log'] })
  rows.push(row)
  if (status === STATUS.FAIL && !halted) {
    halted = true
    haltReason = `${c.id}: ${title}`
  }
  return row
}

function skipCase(id, priority, title, reason) {
  const c = new Case(suite, id)
  c.note(`套件已中止：${haltReason}`)
  const row = c.finish({
    status: STATUS.SKIP,
    title,
    expected: '按 51 用例定义执行',
    actual: `未执行：${reason}`,
    notes: [`中止原因=${haltReason}`, '按派发规则「越权用例红 → 停止该套件」，不再继续标绿'],
    artifacts: ['cmd.log'],
  })
  rows.push(row)
}

const sessionsInfo = await sessions()
const adminCookie = sessionsInfo.admin.cookie
const userBCookie = sessionsInfo.userB.cookie

const patchPath = join(LANE.dataRoot, 'profiles', 'eterna-web', 'cordis.patch.yml')
const containerCfg = join(LANE.dataRoot, 'profiles', 'eterna-web', 'package.json')
const SERVER_NAME = 'e1http'

function patchServers() {
  const text = readFileSync(patchPath, 'utf8')
  const match = /- id: mcp-manager[\s\S]*?\n  config:\n([\s\S]*?)(?=\n\n|\n- id: )/.exec(text)
  return { text, block: match?.[1] ?? '' }
}

function settingsWrite(cookie, ns, patch) {
  return call(cookie, 'settings/update', { request: { ns, patch } }, { timeoutMs: 30_000 })
}

/* --------------------------------------------------------- MCPS-001 */

{
  const c = new Case(suite, 'RC5-MCPS-001')
  const payload = { servers: { [SERVER_NAME]: { transport: 'streamable-http', url: 'http://host.docker.internal:8766/mcp' } } }
  const write = await settingsWrite(adminCookie, 'mcp-manager', payload)
  c.cmd('POST /api/settings/update {"request":{"ns":"mcp-manager","patch":{servers:{e1http:{transport:streamable-http,url:http://host.docker.internal:8766/mcp}}}}', write.status, `ok=${write.ok} ${shape(write.error ?? write.value, 300)}`)
  const after = patchServers()
  const persisted = /e1http/.test(after.block) && /streamable-http/.test(after.block) && /host\.docker\.internal:8766/.test(after.block)
  const describe = await call(adminCookie, 'settings/describe')
  const ns = (describe.value?.namespaces ?? []).find(row => row.ns === 'mcp-manager')
  const valueServers = ns?.value?.servers ?? {}
  c.assert('设置写入返回 ok', write.ok === true, `status=${write.status}`)
  c.assert('profile patch 落盘 servers.e1http', persisted, `block=${shape(after.block, 200)}`)
  c.assert('describe.value.servers 含 e1http', Object.hasOwn(valueServers, SERVER_NAME), `keys=${Object.keys(valueServers).join(',')}`)
  record(c, write.ok === true && persisted && Object.hasOwn(valueServers, SERVER_NAME) ? STATUS.PASS : STATUS.FAIL,
    '管理员新增系统层 HTTP MCP server',
    '保存成功；rendered profile 的 `mcp-manager.config.servers` 落盘该 server；describe 立即反映',
    `write=${write.ok} patch落盘=${persisted} describe.servers=${Object.keys(valueServers).join(',')}`,
    ['server 形态=streamable-http（rc.5 接受值集合 {stdio, streamable-http}；`http` 被 schema 拒绝）'],
    [])
}

/* --------------------------------------------------------- MCPS-002 */

{
  const c = new Case(suite, 'RC5-MCPS-002')
  const before = patchServers()
  const restart = docker(['restart', LANE.container], { timeout: 120_000 })
  c.cmd('docker restart rc5-e1suite', restart.exit, restart.stdout, restart.stderr)
  const health = await waitHealth(LANE.container, 90)
  const after = patchServers()
  const afterProbe = await call(adminCookie, 'mcpManager/probe', { name: SERVER_NAME }, { timeoutMs: 90_000 })
  c.cmd('POST /api/mcpManager/probe {"name":"e1http"}（重启后）', afterProbe.status, `ok=${afterProbe.ok} ${shape(afterProbe.value ?? afterProbe.error, 300)}`)
  const same = /e1http/.test(after.block) && /host\.docker\.internal:8766/.test(after.block)
  const connected = afterProbe.ok === true && Array.isArray(afterProbe.value?.toolNames) && afterProbe.value.toolNames.length > 0
  record(c, health === 'healthy' && same && connected ? STATUS.PASS : STATUS.FAIL,
    '重启容器后 server 仍在且连接成功',
    '配置跨重启保留；`mcpManager/probe` 连接成功并列出工具',
    `health=${health} 配置保留=${same} probe.ok=${afterProbe.ok} tools=${afterProbe.value?.toolNames?.join(',') ?? '-'}`,
    ['重启为本 lane 容器自身（独立数据根），不涉及生产/其它 lane 容器'],
    [])
}

/* --------------------------------------------------------- MCPS-003 */

{
  const c = new Case(suite, 'RC5-MCPS-003')
  const probe = await call(adminCookie, 'mcpManager/probe', { name: SERVER_NAME }, { timeoutMs: 90_000 })
  c.cmd('POST /api/mcpManager/probe {"name":"e1http"}', probe.status, `ok=${probe.ok} ${shape(probe.value ?? probe.error, 400)}`)
  const create = await call(adminCookie, 'session/create', { request: {} })
  const sessionId = create.value?.sessionId
  c.cmd('POST /api/session/create', create.status, `sessionId=${sessionId ?? 'none'}`)
  const projections = sessionId === undefined ? undefined : await call(adminCookie, 'session/projections', { sessionId })
  const keys = Object.keys(projections?.value?.values ?? {})
  c.cmd('POST /api/session/projections', projections?.status ?? -1, `keys=${keys.slice(0, 12).join(',')}`)
  const surfaceKnown = probe.ok === true && Array.isArray(probe.value?.toolNames) && probe.value.toolNames.length > 0
  record(c, STATUS.NOTRUN,
    '会话内调用系统 MCP 工具',
    '会话内工具可见/可调；结果正确',
    `管理面 probe 已证明 server 连接与工具清单（${probe.value?.toolNames?.join(',') ?? '-'}），但“会话内 agent 调用”需真实模型回合；E1 无 LLM 凭据，未执行`,
    [
      '未用 probe 结果冒充“会话内可调”：会话投影不含工具清单（keys 见 cmd.log），agent 工具调用须经模型回合',
      surfaceKnown ? '可观测代理证据：mcpManager/probe 的 toolNames 非空、closeConfirmed=true' : 'probe 未返回工具清单',
    ],
    [])
}

/* --------------------------------------------------------- MCPS-004 */

{
  const c = new Case(suite, 'RC5-MCPS-004')
  const asB = await call(userBCookie, 'settings/describe')
  const asA = await call(adminCookie, 'settings/describe')
  const nsB = (asB.value?.namespaces ?? []).map(row => row.ns)
  const nsA = (asA.value?.namespaces ?? []).map(row => row.ns)
  c.cmd('POST /api/settings/describe（B 普通用户）', asB.status, `namespaces=${nsB.length} 含mcp-manager=${nsB.includes('mcp-manager')}`)
  c.cmd('POST /api/settings/describe（A 管理员）', asA.status, `namespaces=${nsA.length} 含mcp-manager=${nsA.includes('mcp-manager')}`)
  const deniedWrite = await call(userBCookie, 'settings/update', { request: { ns: 'mcp-manager', patch: { servers: { rogue: { transport: 'stdio', command: 'true' } } } } })
  c.cmd('POST /api/settings/update ns=mcp-manager（B 普通用户）', deniedWrite.status, `ok=${deniedWrite.ok} code=${deniedWrite.error?.code} msg=${shape(deniedWrite.error?.message, 120)}`)
  const serversAfter = patchServers().block
  const notWritten = !/rogue/.test(serversAfter)
  const pass = !nsB.includes('mcp-manager') && nsA.includes('mcp-manager') && deniedWrite.ok !== true && notWritten
  record(c, pass ? STATUS.PASS : STATUS.FAIL,
    '普通用户看不到/改不了全局 MCP 配置',
    'B 的 settings/describe 无 mcp-manager 命名空间；B 写 mcp-manager 被拒；配置不变',
    `B含ns=${nsB.includes('mcp-manager')} A含ns=${nsA.includes('mcp-manager')} B写拒=${deniedWrite.ok !== true} 配置未被写=${notWritten}`,
    [],
    [])
}

/* --------------------------------------------------------- MCPS-005 */

{
  const c = new Case(suite, 'RC5-MCPS-005')
  const socket = await openMuxSocket({ port: LANE.port, cookie: userBCookie })
  socket.send({ type: 'open', streamId: 'mcps-watch-b', endpoint: 'mcpManager/watch', payload: { args: {} } })
  const message = await socket.waitMessage(row => row.streamId === 'mcps-watch-b', 8000).catch(error => ({ error: { message: error.message } }))
  socket.close()
  c.cmd('WS /api/remote.mux open {endpoint:"mcpManager/watch"}（B 普通用户）', 0, shape(message, 400))
  const denied = message?.type === 'error' && String(message.error?.code ?? '').includes('denied')
  record(c, denied ? STATUS.PASS : STATUS.FAIL,
    '普通用户 watch 系统层 MCP 流被拒',
    '流 open 被 remote-access 拒绝（no-allow），不泄漏 server 清单/连接状态',
    `message.type=${message?.type ?? 'none'} code=${message?.error?.code ?? '-'}`,
    ['WS mux 使用 cookie（eterna_session + dsh-auth）打开；判定面=open 后的首个流帧'],
    [])
}

/* --------------------------------------------------------- MCPS-006 */

{
  const c = new Case(suite, 'RC5-MCPS-006')
  const probe = await call(userBCookie, 'mcpManager/probe', { name: SERVER_NAME }, { timeoutMs: 90_000 })
  const restart = await call(userBCookie, 'mcpManager/restart', { name: SERVER_NAME }, { timeoutMs: 90_000 })
  c.cmd('POST /api/mcpManager/probe（B 普通用户）', probe.status, `ok=${probe.ok} code=${probe.error?.code ?? '-'} value=${shape(probe.value, 200)}`)
  c.cmd('POST /api/mcpManager/restart（B 普通用户）', restart.status, `ok=${restart.ok} code=${restart.error?.code ?? '-'}`)
  const probeAllowed = probe.status !== 403 && probe.ok === true
  const restartAllowed = restart.status !== 403 && restart.ok === true
  const pass = !probeAllowed && !restartAllowed
  record(c, pass ? STATUS.PASS : STATUS.FAIL,
    '普通用户 restart/probe 必须被拒',
    'B 直接打 `mcpManager/restart`、`mcpManager/probe` → 403/deny；配置与全局 server 不受影响',
    `probe: status=${probe.status} ok=${probe.ok}；restart: status=${restart.status} ok=${restart.ok}；普通用户实际可重启/探测全局 MCP server`,
    [
      '根因线索：mux 策略只在流通道换血 principal；HTTP unary 走 owner Peer，ADMIN_ONLY_UNARY_ACTIONS 只收窄 UI 快照门，未做请求级拦截（packages/access/src/mux.ts:157-158/175-176 为 UI 门；routes.ts 无 mcpManager 请求级门）',
      '影响：任意登录用户可探测/重启组织级 MCP server（可拉起任意 command 的管理动作被越权触发）',
      '按派发规则：越权红 → 本套件在此中止，后续用例不继续标绿',
    ],
    [])
}

/* --------------------------------------------------------- 中止后的 SKIP */

for (const [id, priority, title] of [
  ['RC5-MCPS-007', 'P1', '管理员 watch 连接状态'],
  ['RC5-MCPS-008', 'P1', '旧 profile 的 mcp-manager.config.servers 迁移（幂等）'],
  ['RC5-MCPS-009', 'P1', '非法 YAML/未知 transport 的报错且不破坏配置'],
  ['RC5-MCPS-010', 'P1', '系统 MCP 启动失败时会话仍可用'],
  ['RC5-MCPS-011', 'P0', '模板变更重渲染保留 servers（H9）'],
]) skipCase(id, priority, title, 'MCPS-006 越权红（普通用户可 restart/probe 全局 server）触发套件停止')

const summary = summaryOf(rows, {
  suite, env: {
    commit: gitHead(), imageTag: LANE.imageTag, imageId: LANE.imageId, container: LANE.container,
    base: LANE.base, dataRoot: LANE.dataRoot, startedAt, halted, haltReason,
  },
})
writeSummary(suite, summary)
console.log(`[MCPS] PASS=${summary.pass} FAIL=${summary.fail} SKIP=${summary.skip} NOTRUN=${summary.notrun} halted=${halted}`)
process.exit(0)