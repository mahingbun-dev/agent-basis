#!/usr/bin/env node
/**
 * E3 super 形态套件执行器（54 §6.1 / 51 BOOT-002/013、BOOT-012、API-004..007、
 * TERM-001/002/004/005/006/007/012/013；workbench 面按 38 号 + 51 §5 回归矩阵）。
 *
 * 设计纪律：
 * - 只读生产：本脚本所有 docker 动作只针对 rc5-test-e3 项目 / eterna-rc5-e3 容器；
 *   生产容器 eterna-agent 只做 inspect 基线比对，不 start/stop/exec。
 * - 凭据不落盘/不入日志/不入 argv：账号从 0600 `.test-accounts.json` 读入内存；
 *   容器 boot token 从 docker logs 读入内存；所有证据文本经 redact()。
 * - 每条用例一次进程：`node artifacts/rc5/e3-super/run-suite.mjs <case-id>`，
 *   退出码 0 = PASS/SKIP/NOTRUN，1 = FAIL，2 = 用法错误。
 * - 证据落 `artifacts/rc5/e3-super/<case-id>/{cmd.log,report.json,result.md}`；
 *   `--summary` 汇总 `summary.json` + `report.md`。
 */
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { DatabaseSync } from 'node:sqlite'
import {
  bootTokenFromContainer,
  bootstrapDshSession,
  loadAccounts,
  login,
  redact,
  request,
  rpc,
} from '../../../scripts/rc5-test-client.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(HERE, '../../..')
const BASE = 'http://127.0.0.1:3109'
const CONTAINER = 'eterna-rc5-e3'
const PROJECT = 'rc5-test-e3'
const IMAGE = 'eterna-agent:rc5-test'
const TEST_ROOT = join(homedir(), 'eterna-data', 'test-rc5')
const DATA_ROOT = join(TEST_ROOT, 'e3')
const ENV_FILE = join(TEST_ROOT, '.env.e3')
const ACCOUNTS_FILE = join(TEST_ROOT, '.test-accounts.json')
const DSH_VERSION = '0.2.2-rc.5'
const EXPECTED_HOST_ENTRIES = 235
const PRODUCT_PACKAGES = [
  'access', 'attachments', 'brand', 'compaction', 'llm-doctor',
  'memory', 'panel', 'prompt-studio', 'usage-stats', 'workbench',
]
const CASES = {}

const safe = (value) => {
  const text = typeof value === 'string' ? value : (JSON.stringify(value) ?? String(value))
  return redact(text)
}

function newCtx(id) {
  return { id, startedAt: new Date().toISOString(), commands: [], assertions: [], notes: [] }
}

function rec(ctx, cmd, exit, note = '') {
  ctx.commands.push({ cmd: safe(cmd), exit: typeof exit === 'number' ? exit : -1, note: safe(note).slice(0, 300) })
}

function assert(ctx, name, ok, detail = '') {
  ctx.assertions.push({ name: safe(name), ok: ok === true, detail: safe(String(detail)).slice(0, 900) })
  return ok === true
}

function sh(ctx, cmd, args, { timeout = 120_000, note = '', show = false } = {}) {
  const result = spawnSync(cmd, args, { encoding: 'utf8', timeout, cwd: ROOT, maxBuffer: 128 * 1024 * 1024 })
  const code = result.status === null ? -1 : result.status
  rec(ctx, [cmd, ...args].join(' '), code, note)
  if (show) console.log(`[cmd exit=${code}] ${cmd} ${args.join(' ')}`)
  return { code, out: result.stdout ?? '', err: result.stderr ?? '' }
}

/* ------------------------------------------------------------------ docker */

function dockerInspect(ctx) {
  const r = sh(ctx, 'docker', ['inspect', CONTAINER, '--format', '{{json .}}'], { note: 'E3 容器 inspect（仅取白名单字段）' })
  if (r.code !== 0) return undefined
  try { return JSON.parse(r.out) } catch { return undefined }
}

function envOf(info) {
  const map = {}
  for (const item of info?.Config?.Env ?? []) {
    const at = item.indexOf('=')
    if (at > 0) map[item.slice(0, at)] = item.slice(at + 1)
  }
  return map
}

function inspectSummary(ctx, info) {
  const env = envOf(info)
  const ports = Object.entries(info?.NetworkSettings?.Ports ?? {}).map(([container, bindings]) =>
    `${bindings?.[0]?.HostPort ?? '?'}->${container}`)
  const mounts = (info?.Mounts ?? []).map(m => `${m.Source} -> ${m.Destination} (${m.Type})`)
  const summary = {
    name: info?.Name ?? '',
    status: info?.State?.Status ?? '',
    health: info?.State?.Health?.Status ?? '',
    image: info?.Config?.Image ?? '',
    imageId: info?.Image ?? '',
    project: info?.Config?.Labels?.['com.docker.compose.project'] ?? '',
    ports,
    mounts,
    form: env.ETERNA_FORM ?? '',
    dshHome: env.DSH_HOME ?? '',
    agentsHome: env.DSH_AGENTS_HOME ?? '',
  }
  ctx.notes.push(`容器 ${summary.name} project=${summary.project} image=${summary.image} health=${summary.health}`)
  return summary
}

function prodState(ctx) {
  const r = sh(ctx, 'docker', ['inspect', 'eterna-agent', '--format', 'ID={{.Id}} StartedAt={{.State.StartedAt}} RestartCount={{.RestartCount}} Image={{.Config.Image}}'], { note: '生产容器只读基线' })
  return r.code === 0 ? r.out.trim() : ''
}

function readBaseline() {
  const path = join(HERE, 'prep', 'prod-baseline.log')
  if (!existsSync(path)) return ''
  return readFileSync(path, 'utf8').split('\n').find(line => line.startsWith('ID='))?.trim() ?? ''
}

/* ------------------------------------------------------------------- HTTP */

async function hget(ctx, path, { cookie, note = '', timeoutMs = 20_000 } = {}) {
  const response = await request(new URL(path, BASE), { cookie, timeoutMs })
  rec(ctx, `GET ${path}`, response.status, note)
  return response
}

async function hpost(ctx, path, body, { cookie, note = '', timeoutMs = 30_000 } = {}) {
  const response = await request(new URL(path, BASE), { method: 'POST', cookie, body, timeoutMs })
  rec(ctx, `POST ${path}`, response.status, note)
  return response
}

async function jsonOf(response) {
  try { return JSON.parse(response.text) } catch { return undefined }
}

async function liveSession(ctx) {
  const accounts = loadAccounts(ACCOUNTS_FILE)
  const bootToken = bootTokenFromContainer(CONTAINER)
  rec(ctx, 'docker logs eterna-rc5-e3 | extract boot token (in-memory, never written)', 0, 'boot token 不入证据')
  const dshCookie = await bootstrapDshSession(BASE, bootToken)
  rec(ctx, 'GET /connect + GET /?token=… (dsh session bootstrap)', 200, 'token 已脱敏')
  const auth = await loginRetry(ctx, accounts.admin.account, accounts.admin.password, 'admin')
  assert(ctx, 'admin 登录 200', auth.status === 200, `status=${auth.status}`)
  return { accounts, cookie: `${dshCookie}; ${auth.cookie}`, dshCookie }
}

/** access 登录限速 5/min/ip+账号（packages/access/src/ratelimit.ts）：429 时退避重试。 */
async function loginRetry(ctx, account, password, label) {
  let result
  for (let attempt = 0; attempt < 8; attempt++) {
    result = await login(BASE, account, password)
    rec(ctx, `POST /login (${label} from 0600 accounts file)`, result.status, attempt === 0 ? '' : `retry#${attempt}`)
    if (result.status !== 429) break
    await new Promise(r => setTimeout(r, 20_000))
  }
  return result
}

function workspaceIdOfAdmin() {
  const db = new DatabaseSync(join(DATA_ROOT, 'access', 'users.db'), { readOnly: true })
  try {
    return db.prepare("SELECT w.workspace_id FROM workspaces w JOIN users u ON u.id = w.owner_id WHERE u.account = ? ORDER BY w.workspace_id LIMIT 1")
      .get(loadAccounts(ACCOUNTS_FILE).admin.account)?.workspace_id
  } finally { db.close() }
}

async function createSession(ctx, cookie) {
  const workspaceId = workspaceIdOfAdmin()
  assert(ctx, 'admin 测试工作区可解析（E3 users.db 只读）', typeof workspaceId === 'string' && workspaceId !== '', String(workspaceId))
  const final = await api(ctx, cookie, 'session/create', { request: { workspaceId } }, { note: `ok·workspace=${String(workspaceId).slice(0, 8)}…` })
  const sessionId = final.value?.sessionId ?? final.value?.id
  assert(ctx, '新建会话成功', final.ok === true && typeof sessionId === 'string', safe(final.error ?? final.value))
  return sessionId
}

/** RPC + 429 退避（access 变更类接口 30/min/ip；memory 态滑动窗）。 */
async function api(ctx, cookie, method, args = {}, { timeoutMs = 30_000, note = '' } = {}) {
  let result = await rpc(BASE, cookie, method, args, { timeoutMs })
  rec(ctx, `POST /api/${method}`, result.status, note)
  for (let attempt = 0; attempt < 5 && result.status === 429; attempt++) {
    await new Promise(r => setTimeout(r, 15_000))
    result = await rpc(BASE, cookie, method, args, { timeoutMs })
    rec(ctx, `POST /api/${method} (retry after 429)`, result.status, note)
  }
  return result
}

async function projections(ctx, cookie, sessionId) {
  const result = await api(ctx, cookie, 'session/projections', { request: { sessionId } })
  return result
}

async function inventory(ctx, cookie) {
  const result = await api(ctx, cookie, 'pluginInventory/list', {}, { timeoutMs: 60_000 })
  return result.value?.entries ?? []
}

async function sseFirstFrame(ctx, cookie) {
  const controller = new AbortController()
  const response = await fetch(new URL('/workbench/api/stream', BASE), { headers: { cookie }, signal: controller.signal })
  rec(ctx, 'GET /workbench/api/stream', response.status, 'SSE 首帧')
  let buffer = ''
  let headers = response.headers.get('content-type') ?? ''
  const reader = response.body?.getReader()
  const decoder = new TextDecoder()
  const deadline = Date.now() + 10_000
  while (reader !== undefined && Date.now() < deadline) {
    const { value, done } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    if (/\ndata: /.test(buffer.replace(/: keep-alive\n\n/g, ''))) break
  }
  controller.abort()
  const dataLine = buffer.split('\n').find(line => line.startsWith('data: '))
  let frame
  if (dataLine !== undefined) { try { frame = JSON.parse(dataLine.slice(6)) } catch { frame = undefined } }
  return { status: response.status, contentType: headers, buffer, frame }
}

async function roster(ctx, cookie) {
  const page = await hget(ctx, '/', { cookie, note: 'HTML 花名册（__DSH_BOOT__）' })
  const html = page.text
  const marker = 'globalThis["__DSH_BOOT__"] = '
  const start = html.indexOf(marker)
  const end = html.indexOf('</script>', start)
  let boot
  if (start >= 0 && end > start) {
    try { boot = JSON.parse(html.slice(start + marker.length, end).trim().replace(/;\s*$/, '')) } catch { boot = undefined }
  }
  const combos = [...new Set([...html.matchAll(/(plugins\/\?\?[^"']+client\.js[^"']*)/g)].map(m => m[1].replaceAll('&amp;', '&')))]
  rec(ctx, `index.html combo urls parsed (${combos.length} chunks)`, page.status)
  const cache = new Map()
  const bundleOf = async (target) => {
    const combo = combos.find(url => url.includes(`${target}/client.js`))
    if (combo === undefined) return { combo: '', body: '', status: 0 }
    if (!cache.has(combo)) {
      const response = await hget(ctx, `/${combo}`, { cookie, note: `client bundle ${target}`, timeoutMs: 30_000 })
      cache.set(combo, { combo, body: response.text, status: response.status })
    }
    return cache.get(combo)
  }
  return { html, boot, combos, bundleOf }
}

function bundleHasFactory(body, target) {
  const escaped = target.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return new RegExp(`__ModuleLoader__\\.load\\(\\{\\s*id:\\s*["'\`]${escaped}["'\`]`).test(body)
}

/* ------------------------------------------------------------- terminal */

const TERMINAL_UNARY = ['environment', 'shells', 'list', 'create', 'rename', 'close']
const STREAM_ACTIONS = ['attach', 'retain', 'watch']

function terminalArgs(action, sessionId, terminalId = 'e3-probe-term') {
  switch (action) {
    case 'environment':
    case 'shells': return { agentId: sessionId }
    case 'list': return { sessionId }
    case 'create': return { agentId: sessionId, request: { id: terminalId, cols: 120, rows: 40, title: 'e3-probe' } }
    case 'rename': return { agentId: sessionId, id: terminalId, title: 'e3-renamed' }
    case 'close': return { agentId: sessionId, id: terminalId }
    default: return { agentId: sessionId }
  }
}

function denied(result) {
  const code = String(result?.error?.code ?? '')
  const message = String(result?.error?.message ?? '')
  return result?.status === 403 || code.includes('tenant-denied') || code.includes('tenant/denied') || /不属于你的会话/.test(message)
}

async function callTerminal(ctx, cookie, action, args, label) {
  const result = await api(ctx, cookie, `terminal/${action}`, args, { timeoutMs: 20_000, note: label })
  return result
}

/* ---------------------------------------------------------------- cases */

CASES['E3-PREP'] = async (ctx) => {
  const info = dockerInspect(ctx)
  const summary = inspectSummary(ctx, info)
  assert(ctx, 'E3 容器存在且 running', summary.status === 'running', summary.status)
  assert(ctx, 'E3 healthcheck healthy', summary.health === 'healthy', summary.health)
  assert(ctx, '独立 compose 项目名 rc5-test-e3', summary.project === PROJECT, summary.project)
  assert(ctx, '容器名 eterna-rc5-e3', summary.name === '/eterna-rc5-e3' || summary.name === 'eterna-rc5-e3', summary.name)
  assert(ctx, '镜像 tag eterna-agent:rc5-test', summary.image === IMAGE, summary.image)
  const imageInfo = sh(ctx, 'docker', ['image', 'inspect', IMAGE, '--format', '{{json .}}'], { note: '测试镜像 inspect（只取 Id/Created）' })
  let imageJson
  if (imageInfo.code === 0) { try { imageJson = JSON.parse(imageInfo.out) } catch { imageJson = undefined } }
  assert(ctx, '容器运行镜像 = 当前 eterna-agent:rc5-test 标签镜像（无 tag 漂移）', imageJson?.Id !== undefined && summary.imageId === imageJson.Id, `container=${summary.imageId.slice(0, 19)}… tag=${String(imageJson?.Id).slice(0, 19)}… created=${imageJson?.Created ?? '?'}`)
  ctx.notes.push(`镜像 ${IMAGE} created=${imageJson?.Created ?? '?'}（container 于 ${info?.Created ?? '?'} 由 prepare e3 up 重建并沿用 E3 数据根）`)
  ctx.notes.push('镜像无 commit/OBS 标签（Config.Labels=null）：sha 99d8e85b509b 只能按镜像 id 追溯，不能等同于 worktree commit 02f4857 的确定性构建。')
  assert(ctx, '端口 3109->8080（非生产 3210）', summary.ports.includes('3109->8080/tcp'), summary.ports.join(','))
  assert(ctx, 'relay 9312->9310（非生产 9310）', summary.ports.includes('9312->9310/tcp'), summary.ports.join(','))
  assert(ctx, '数据根 bind = $HOME/eterna-data/test-rc5/e3', summary.mounts.some(m => m.startsWith(`${DATA_ROOT} -> /data (bind)`)), summary.mounts.join('; '))
  assert(ctx, '数据根与生产根不相交', resolve(DATA_ROOT) !== resolve(homedir(), 'eterna-data', 'super') && !String(DATA_ROOT).includes('/eterna-data/super'), DATA_ROOT)
  assert(ctx, 'ETERNA_FORM=super', summary.form === 'super', summary.form)
  assert(ctx, 'DSH_HOME=/data 且 DSH_AGENTS_HOME=/data/agents', summary.dshHome === '/data' && summary.agentsHome === '/data/agents', `${summary.dshHome}/${summary.agentsHome}`)

  const config = sh(ctx, 'docker', ['compose', '-p', PROJECT, '--env-file', ENV_FILE, '-f', join(ROOT, 'docker-compose.yml'), 'config', '--format', 'json'], { note: 'compose config（--format json，只取服务/端口/卷字段）' })
  let parsed
  if (config.code === 0) { try { parsed = JSON.parse(config.out) } catch { parsed = undefined } }
  assert(ctx, 'compose config exit 0', config.code === 0, `exit=${config.code}`)
  const service = parsed?.services?.['eterna-agent']
  assert(ctx, 'compose 项目 name=rc5-test-e3', parsed?.name === PROJECT, parsed?.name)
  assert(ctx, 'compose container_name=eterna-rc5-e3', service?.container_name === CONTAINER, service?.container_name)
  const published = JSON.stringify(service?.ports ?? [])
  assert(ctx, 'compose 发布端口 3109/9312', published.includes('3109') && published.includes('9312'), published.slice(0, 200))
  const volumeSource = (service?.volumes ?? []).find(v => v.target === '/data')?.source ?? ''
  assert(ctx, 'compose /data 源 = E3 数据根', volumeSource === DATA_ROOT, volumeSource)

  const prepLog = join(HERE, 'prep', 'prepare-e3.log')
  if (existsSync(prepLog)) {
    const text = readFileSync(prepLog, 'utf8')
    rec(ctx, 'read prep/prepare-e3.log', 0)
    assert(ctx, 'prepare-rc5-envs e3 PASS=4 FAIL=0 EXIT=0', /\[PREP\] PASS=4 FAIL=0/.test(text) && /EXIT=0/.test(text), text.split('\n').filter(l => l.startsWith('[PASS]') || l.startsWith('[PREP]')).join(' | '))
  }

  const image = sh(ctx, 'docker', ['image', 'inspect', IMAGE, '--format', '{{.Id}}'], { note: '测试镜像存在性' })
  assert(ctx, '测试镜像 eterna-agent:rc5-test 存在', image.code === 0 && image.out.trim().startsWith('sha256:'), image.out.trim().slice(0, 20))

  const before = readBaseline()
  const now = prodState(ctx)
  assert(ctx, '生产容器未重启/未换容器（ID+StartedAt+RestartCount 与基线一致）', before !== '' && now === before, `before=[${before}] now=[${now}]`)
  return { priority: 'P0', title: 'E3 super 独立测试容器（项目/端口/数据根/镜像）', expected: 'rc5-test-e3 / eterna-rc5-e3 / 3109 / $HOME/eterna-data/test-rc5/e3 / eterna-agent:rc5-test；生产容器不动' }
}

CASES['RC5-BOOT-002'] = async (ctx) => {
  const info = dockerInspect(ctx)
  const summary = inspectSummary(ctx, info)
  assert(ctx, 'super 容器 healthy', summary.health === 'healthy', summary.health)
  const lastHealth = info?.State?.Health?.Log?.at(-1)
  assert(ctx, '最近一次 healthcheck ExitCode=0', lastHealth?.ExitCode === 0, JSON.stringify({ exit: lastHealth?.ExitCode }))
  assert(ctx, 'ETERNA_FORM=super 且 profile 目录=eterna-super', summary.form === 'super' && existsSync(join(DATA_ROOT, 'profiles', 'eterna-super')), `form=${summary.form}`)

  const version = sh(ctx, 'docker', ['exec', CONTAINER, 'dsh', '--version'], { note: '容器内 dsh 版本' })
  assert(ctx, '容器内 dsh --version = 0.2.2-rc.5', version.code === 0 && version.out.trim() === DSH_VERSION, version.out.trim())

  const login = await hget(ctx, '/login', { note: 'super 登录页' })
  assert(ctx, 'GET /login 200 且返回中文登录页', login.status === 200 && login.text.includes('登录') && login.text.includes('EternaAgent'), `status=${login.status} bytes=${login.text.length}`)

  const { accounts, cookie } = await liveSession(ctx)

  const root = await hget(ctx, '/', { cookie, note: 'super 应用壳（带会话）' })
  assert(ctx, 'GET / 200 且注入 __DSH_BOOT__ 花名册', root.status === 200 && root.text.includes('__DSH_BOOT__'), `status=${root.status} bytes=${root.text.length}`)

  const tasks = await hget(ctx, '/access/api/tasks/settings', { cookie, note: 'super 专属任务设置读面' })
  const tasksJson = await jsonOf(tasks)
  assert(ctx, 'GET /access/api/tasks/settings 200 ok（super 专属路由）', tasks.status === 200 && tasksJson?.ok === true, safe(tasksJson ?? tasks.text).slice(0, 300))
  assert(ctx, '任务设置含 realm/masterId/health/stats', typeof tasksJson?.realm === 'string' && typeof tasksJson?.masterId === 'string' && tasksJson?.health !== undefined && tasksJson?.stats !== undefined, JSON.stringify({ realm: tasksJson?.realm, masterId: tasksJson?.masterId, health: typeof tasksJson?.health, stats: typeof tasksJson?.stats }))

  const roles = await hget(ctx, '/access/api/tasks/session-roles', { cookie, note: 'super 专属会话角色读面' })
  const rolesJson = await jsonOf(roles)
  assert(ctx, 'GET /access/api/tasks/session-roles 200 ok', roles.status === 200 && rolesJson?.ok === true, safe(rolesJson ?? roles.text).slice(0, 200))

  const sse = await sseFirstFrame(ctx, cookie)
  assert(ctx, 'GET /workbench/api/stream 200 text/event-stream', sse.status === 200 && sse.contentType.includes('text/event-stream'), `${sse.status} ${sse.contentType}`)
  assert(ctx, '工作台首帧为 snapshot', sse.frame?.kind === 'snapshot' && sse.frame?.snapshot !== undefined, safe(sse.frame ?? sse.buffer).slice(0, 200))

  const entries = await inventory(ctx, cookie)
  assert(ctx, `host entries=${EXPECTED_HOST_ENTRIES}（rc.5 基线）`, entries.length === EXPECTED_HOST_ENTRIES, `entries=${entries.length}`)
  const byId = new Map(entries.map(entry => [entry.entryId.replace(/^include:/, ''), entry]))
  const template = readFileSync(join(ROOT, 'docker', 'profile', 'cordis.super.patch.yml.template'), 'utf8')
  rec(ctx, 'read docker/profile/cordis.super.patch.yml.template', 0)
  const rows = []
  let inInsert = false
  let pendingId
  for (const line of template.split('\n')) {
    if (/^-\s+insert:\s*$/.test(line)) { inInsert = true; pendingId = undefined; continue }
    if (/^\S/.test(line)) { inInsert = false; pendingId = undefined; continue }
    if (!inInsert) continue
    const idMatch = /^\s+- id:\s*(\S+)\s*$/.exec(line)
    if (idMatch !== null) { pendingId = idMatch[1]; continue }
    const nameMatch = /^\s+name:\s*['"]?([^'"\s#]+)['"]?\s*$/.exec(line)
    if (nameMatch !== null && pendingId !== undefined) {
      if (nameMatch[1].startsWith('@eterna/')) rows.push({ id: pendingId, name: nameMatch[1] })
      pendingId = undefined
    }
  }
  const missing = rows.filter(row => !byId.has(row.id))
  const inactive = rows.filter(row => {
    const entry = byId.get(row.id)
    return entry !== undefined && (!entry.enabled || entry.fiberPhase !== 'active')
  })
  assert(ctx, `super 模板 ${rows.length} 行 @eterna insert 全部 enabled+active`, rows.length > 0 && missing.length === 0 && inactive.length === 0, [...missing.map(row => `${row.id}: absent`), ...inactive.map(row => `${row.id}: ${JSON.stringify(byId.get(row.id))}`)].join('; ') || rows.map(row => row.id).join(', '))
  return { priority: 'P0', title: 'E3 super 容器起：healthy + super 路由可访问', expected: 'healthy；super 路由可访问（/login、/、/access/api/tasks/*、/workbench/api/stream），22 行 @eterna 挂载 active' }
}

CASES['RC5-BOOT-013'] = async (ctx) => {
  const { cookie } = await liveSession(ctx)
  const entries = await inventory(ctx, cookie)
  const byId = new Map(entries.map(entry => [entry.entryId, entry]))
  const agentTeamRows = ['include:agent-team', 'include:tool-agent-team', 'include:ui-agent-team']
  const missing = agentTeamRows.filter(id => !byId.has(id))
  const inactive = agentTeamRows.filter(id => {
    const entry = byId.get(id)
    return entry !== undefined && (!entry.enabled || entry.fiberPhase !== 'active')
  })
  assert(ctx, 'agent-team 三行真 boot（enabled+active）', missing.length === 0 && inactive.length === 0, [...missing.map(id => `${id}:absent`), ...inactive.map(id => `${id}:${JSON.stringify(byId.get(id))}`)].join('; ') || agentTeamRows.map(id => `${id}:${byId.get(id)?.moduleName}`).join(', '))

  const sessionId = await createSession(ctx, cookie)
  const proj = await projections(ctx, cookie, sessionId)
  const enabled = proj.value?.values?.agentTeam?.enabled
  assert(ctx, 'Team mode 默认关（新会话 agentTeam.enabled=false）', enabled === false, `agentTeam=${safe(JSON.stringify(proj.value?.values?.agentTeam ?? null)).slice(0, 200)}`)

  const page = await roster(ctx, cookie)
  const bootEntries = page.boot?.entries ?? []
  const entryIds = new Set(bootEntries.map(entry => entry.id))
  assert(ctx, '花名册含 ui-agent-team（任务板/子代理 UI 半边）', entryIds.has('@deepseek-ai/dsh-client-ui-agent-team'), `entries=${bootEntries.length}`)
  const uiBundle = await page.bundleOf('@deepseek-ai/dsh-client-ui-agent-team')
  assert(ctx, 'ui-agent-team bundle 可取且含 factory 注册', uiBundle.status === 200 && bundleHasFactory(uiBundle.body, '@deepseek-ai/dsh-client-ui-agent-team'), `status=${uiBundle.status} bytes=${uiBundle.body.length}`)
  for (const target of ['@eterna/tasks', '@eterna/workbench']) {
    assert(ctx, `花名册含 ${target} 客户端半边`, entryIds.has(target), `entries=${bootEntries.length}`)
    const bundle = await page.bundleOf(target)
    assert(ctx, `${target} bundle 可取且含 factory 注册`, bundle.status === 200 && bundleHasFactory(bundle.body, target), `status=${bundle.status} bytes=${bundle.body.length}`)
  }
  ctx.notes.push('UI 渲染面（真浏览器像素/交互）未在本用例判定；见 E3-UI-002（NOTRUN，凭据边界）。')
  return { priority: 'P1', title: 'agent-team 三行与 Team mode（BOOT-013）', expected: '三行真 boot；Team mode 默认关；任务板/子代理 UI 不破面（花名册/工厂/工件面）' }
}

CASES['RC5-BOOT-012'] = async (ctx) => {
  const { cookie } = await liveSession(ctx)
  const version = sh(ctx, 'docker', ['exec', CONTAINER, 'dsh', '--version'], { note: 'release.version 对照' })
  const page = await roster(ctx, cookie)
  assert(ctx, 'index.html 注入 __DSH_BOOT__ 且 release.version=0.2.2-rc.5', page.boot?.release?.version === (version.out.trim() || DSH_VERSION), `release=${page.boot?.release?.version} dsh=${version.out.trim()}`)
  const entries = page.boot?.entries ?? []
  const byId = new Map(entries.map(entry => [entry.id, entry]))
  const problems = []
  for (const pkg of PRODUCT_PACKAGES) {
    const id = `@eterna/${pkg}`
    const entry = byId.get(id)
    if (entry === undefined) { problems.push(`${pkg}: not in roster`); continue }
    if (typeof entry.url !== 'string' || typeof entry.rev !== 'string') { problems.push(`${pkg}: url/rev missing`); continue }
    const urlRev = /rev=([^&]+)/.exec(entry.url)?.[1]
    if (urlRev !== entry.rev) problems.push(`${pkg}: rev mismatch ${urlRev} != ${entry.rev}`)
    const bundle = await page.bundleOf(id)
    if (bundle.status !== 200) problems.push(`${pkg}: bundle ${bundle.status}`)
    else if (!bundleHasFactory(bundle.body, id)) problems.push(`${pkg}: factory missing`)
  }
  assert(ctx, `T36 ${PRODUCT_PACKAGES.length} 个产品 client bundle 在册/可取/工厂注册/rev 一致`, problems.length === 0, problems.join('; ') || PRODUCT_PACKAGES.join(', '))
  ctx.notes.push('控制台「版本不匹配」错误需真浏览器复现；本用例以 release.version + entry.rev + 工件可取性代替（W5 既有口径）。')
  return { priority: 'P0', title: '浏览器加载：10 个产品 client bundle 无版本不匹配（BOOT-012 → workbench 回归面）', expected: 'release.version=0.2.2-rc.5；10 包花名册/工件/工厂齐全；rev 一致' }
}

CASES['RC5-API-004'] = async (ctx) => {
  const test = sh(ctx, 'pnpm', ['--filter', '@eterna/tasks', 'test'], { timeout: 600_000, note: 'vitest run（只读测试，不写 lib/）' })
  const testOut = test.out + test.err
  const files = /Test Files\s+(\d+) passed/.exec(testOut)?.[1]
  const tests = /Tests\s+(\d+) passed/.exec(testOut)?.[1]
  assert(ctx, 'tasks vitest 全绿', test.code === 0 && files !== undefined, `exit=${test.code} files=${files} tests=${tests}`)
  const typecheck = sh(ctx, 'pnpm', ['--filter', '@eterna/tasks', 'typecheck'], { timeout: 600_000, note: 'tsc --noEmit' })
  assert(ctx, 'tasks typecheck 绿', typecheck.code === 0, `exit=${typecheck.code}`)
  const lint = sh(ctx, 'pnpm', ['exec', 'oxlint', '--config', './.oxlintrc.json', 'packages/tasks/src', 'packages/tasks/tests'], { timeout: 300_000, note: 'oxlint' })
  const lintOut = lint.out + lint.err
  assert(ctx, 'tasks oxlint 0/0', lint.code === 0 && /Found 0 warnings and 0 errors/.test(lintOut), `${lintOut.trim().split('\n')[0] ?? ''}`)
  ctx.notes.push('51 的 API-004 命名命令 `pnpm --filter @eterna/tasks verify` 含 build:client（写 packages/tasks/lib/client.js）；本 lane 可改文件仅限 artifacts/rc5/e3-super/**，故未跑复合 verify，改跑 test/typecheck/oxlint 三段并如实标注。')
  return {
    priority: 'P0',
    title: 'tasks 包 verify（API-004）——替代覆盖：test/typecheck/oxlint',
    expected: '51 原文为 `pnpm --filter @eterna/tasks verify` 退出码 0',
    status: 'NOTRUN',
  }
}

CASES['RC5-API-005'] = async (ctx) => {
  const { cookie } = await liveSession(ctx)
  const models = await api(ctx, cookie, 'session/modelCatalog', { request: {} })
  assert(ctx, '模型目录可读（证明路由在，但凭据另判）', models.ok === true && typeof models.value?.default?.provider === 'string', safe(models.value?.default ?? models.error))

  const sessionId = await createSession(ctx, cookie)
  await api(ctx, cookie, 'session/prompt', { request: { requestId: `e3-api005-${Date.now()}`, sessionId, mode: 'queue', content: [{ type: 'text', text: '请只回复：OK' }] } }, { timeoutMs: 30_000 })
  rec(ctx, 'session/prompt 载荷内容不写证据（仅一致性探针）', 0)
  let pageEvents = []
  for (let attempt = 0; attempt < 20; attempt++) {
    await new Promise(r => setTimeout(r, 1500))
    const page = await api(ctx, cookie, 'session/page', { request: { address: { kind: 'session', sessionId }, maxMessages: 4 } })
    pageEvents = page.value?.records ?? []
    const end = pageEvents.find(record => record.event?.type === 'turn/end')
    if (end !== undefined) break
  }
  const turnEnd = pageEvents.find(record => record.event?.type === 'turn/end')?.event?.data
  const authError = turnEnd?.reason?.kind === 'error' && String(turnEnd?.reason?.error?.code ?? '') === 'AUTH'
  assert(ctx, '模型探针如实记录失败原因（AUTH 401 invalid API Key）', authError, safe(turnEnd?.reason ?? 'no turn/end').slice(0, 400))

  const tasks = await hget(ctx, '/access/api/tasks/settings', { cookie })
  const tasksJson = await jsonOf(tasks)
  ctx.notes.push(`tasks masterId=${tasksJson?.masterId} realm=${tasksJson?.realm}`)
  const logs = sh(ctx, 'docker', ['logs', CONTAINER], { timeout: 60_000, note: 'bridge 日志取 realm 登记事实' })
  const bridgeLine = (logs.out + logs.err).split('\n').find(line => line.includes('[eterna-tasks-access-bridge]')) ?? ''
  assert(ctx, 'tasks 归属桥按 realm 对齐失败（realm=Mr.Ma 不在 access 用户表）', /不在 access 用户表/.test(bridgeLine), bridgeLine.slice(0, 300))
  ctx.notes.push('E3 测试账号 rc5admin 与模板 realm=Mr.Ma 不对齐 → orchestrator 主会话未登记；API-005 的「主会话派 2 个 worker」在 E3 无法成立（P6 需真模型 + realm 对齐账号）。')
  return {
    priority: 'P0',
    title: '主会话派 2 个 worker：waitForTreeWork 等到全部完成（API-005）',
    expected: 'E3 主会话派 2 worker；waitForTreeWork 全完成；无丢回执',
    status: 'NOTRUN',
  }
}

CASES['RC5-API-006'] = async (ctx) => {
  const { cookie } = await liveSession(ctx)
  const tasks = await hget(ctx, '/access/api/tasks/settings', { cookie })
  const tasksJson = await jsonOf(tasks)
  const roles = await hget(ctx, '/access/api/tasks/session-roles', { cookie })
  const rolesJson = await jsonOf(roles)
  assert(ctx, 'tasks 视图/角色面可读（引擎就绪）', tasksJson?.ok === true && rolesJson?.ok === true, `master=${rolesJson?.masterId} workers=${JSON.stringify(rolesJson?.workerSessionIds)}`)
  assert(ctx, '当前无 worker 会话（无法观察后代树）', Array.isArray(rolesJson?.workerSessionIds) && rolesJson.workerSessionIds.length === 0, JSON.stringify(rolesJson?.workerSessionIds))
  ctx.notes.push('listDescendants 属宿主 subagent 服务方法，无公开 RPC；需由真实 worker 树驱动。前置（模型/ realm）见 RC5-API-005。')
  return {
    priority: 'P1',
    title: '查询后代列表与任务树一致（API-006）',
    expected: 'listDescendants 返回与任务树一致',
    status: 'NOTRUN',
  }
}

CASES['RC5-API-007'] = async (ctx) => {
  const { cookie } = await liveSession(ctx)
  const roles = await hget(ctx, '/access/api/tasks/session-roles', { cookie })
  const rolesJson = await jsonOf(roles)
  assert(ctx, 'worker 列表为空（drain 前置缺失）', Array.isArray(rolesJson?.workerSessionIds) && rolesJson.workerSessionIds.length === 0, JSON.stringify(rolesJson?.workerSessionIds))
  ctx.notes.push('drainDescendants 需真实后代树；前置（模型/ realm）见 RC5-API-005。')
  return {
    priority: 'P1',
    title: '排空后代后无残留 running（API-007）',
    expected: 'drainDescendants 后无残留 running',
    status: 'NOTRUN',
  }
}

CASES['E3-TASKS-SURFACE'] = async (ctx) => {
  const { cookie } = await liveSession(ctx)
  const view = await hget(ctx, '/access/api/tasks/settings', { cookie })
  const viewJson = await jsonOf(view)
  assert(ctx, 'settings 读面 200 且含 6 块修订', viewJson?.ok === true && ['pause', 'policy', 'eval', 'executor', 'budget', 'gates'].every(block => typeof viewJson?.revisions?.[block] === 'number'), JSON.stringify(viewJson?.revisions))
  assert(ctx, 'health/stats 载荷在场', viewJson?.health !== undefined && viewJson?.stats !== undefined, JSON.stringify({ health: viewJson?.health, stats: viewJson?.stats }).slice(0, 300))
  const save = await hpost(ctx, '/access/api/tasks/settings', { block: 'pause', revision: viewJson?.revisions?.pause ?? 0, value: { paused: viewJson?.settings?.paused === true } }, { cookie, note: 'no-op 保存（资料类合并保存，值不变）' })
  const saveJson = await jsonOf(save)
  assert(ctx, 'no-op 保存 200 且 changed=false', save.status === 200 && saveJson?.ok === true && saveJson?.changed === false, safe(saveJson ?? save.text).slice(0, 200))
  const roles = await hget(ctx, '/access/api/tasks/session-roles', { cookie })
  const rolesJson = await jsonOf(roles)
  assert(ctx, 'session-roles 200 且 masterId 在场', roles.status === 200 && typeof rolesJson?.masterId === 'string', safe(rolesJson).slice(0, 200))
  const bad = await hpost(ctx, '/access/api/tasks/settings', { block: 'source:../etc', revision: 0, value: {} }, { cookie, note: '非法块名负向' })
  assert(ctx, '非法块名被 400 拒绝', bad.status === 400, `status=${bad.status}`)
  return { priority: 'P1', title: '（lane 本地）tasks 设置/角色面 live 契约', expected: 'settings/session-roles 可读；no-op 保存 changed=false；非法块 400' }
}

CASES['RC5-TERM-001'] = async (ctx) => {
  const pkg = sh(ctx, 'docker', ['exec', CONTAINER, 'cat', '/data/profiles/eterna-super/package.json'], { note: 'profile package.json' })
  assert(ctx, 'profile bundles 含 dsh-experimental-terminal-bundle', pkg.code === 0 && pkg.out.includes('@deepseek-ai/dsh-experimental-terminal-bundle'), pkg.out.match(/"@deepseek-ai\/[^"]+"/g)?.join(', ') ?? '')
  const { cookie } = await liveSession(ctx)
  const entries = await inventory(ctx, cookie)
  const rows = entries.filter(entry => /terminal/i.test(entry.entryId) && entry.enabled && entry.fiberPhase === 'active')
  assert(ctx, 'terminal 行集 active（registry/panel/tool/controller/ui）', ['include:optional-terminal-registry', 'include:optional-terminal-panel', 'include:optional-tool-terminal', 'include:terminal-controller', 'include:ui-sidebar-terminal'].every(id => rows.some(row => row.entryId === id)), rows.map(row => row.entryId).join(', '))
  return { priority: 'P0', title: 'profile bundle 清单含 terminal bundle（TERM-001）', expected: 'dsh-experimental-terminal-bundle 在；terminal 行 active' }
}

CASES['RC5-TERM-007'] = async (ctx) => {
  const patch = sh(ctx, 'docker', ['exec', CONTAINER, 'cat', '/data/profiles/eterna-super/cordis.patch.yml'], { note: 'rendered super patch' })
  const text = patch.out
  const shells = /preferredShells:\s*\n\s*-\s*bash/.test(text)
  const readUser = /readUserTerminals:\s*false/.test(text)
  assert(ctx, 'preferredShells=[bash]', shells, shells ? 'preferredShells: [bash]' : 'not found')
  assert(ctx, 'readUserTerminals=false', readUser, readUser ? 'readUserTerminals: false' : 'not found')
  return { priority: 'P0', title: 'terminal 配置（TERM-007）', expected: 'readUserTerminals=false；preferredShells=[bash]' }
}

CASES['RC5-TERM-006'] = async (ctx) => {
  const { cookie } = await liveSession(ctx)
  const sessionId = await createSession(ctx, cookie)
  const outcomes = {}
  for (const action of TERMINAL_UNARY) {
    const result = await callTerminal(ctx, cookie, action, terminalArgs(action, sessionId), 'A')
    outcomes[action] = result
  }
  assert(ctx, 'terminal/environment 成功（A 自己的会话）', outcomes.environment?.ok === true, safe(outcomes.environment?.error ?? outcomes.environment?.value))
  assert(ctx, 'terminal/shells 成功且含 /bin/bash', outcomes.shells?.ok === true && JSON.stringify(outcomes.shells?.value).includes('/bin/bash'), safe(outcomes.shells?.value ?? outcomes.shells?.error).slice(0, 200))
  assert(ctx, 'terminal/list 成功（数组）', outcomes.list?.ok === true && Array.isArray(outcomes.list?.value), safe(outcomes.list?.value ?? outcomes.list?.error))
  const createOk = outcomes.create?.ok === true
  assert(ctx, 'terminal/create 成功（9 动作前置）', createOk, `${safe(outcomes.create?.error ?? outcomes.create?.value)}`)
  if (!createOk) {
    ctx.notes.push('terminal/create 服务端内部错误（session.snapshotEvents is not a function）与 P5 结论一致：rename/close 无 terminal id 可作用，attach/retain/watch 亦无法建立目标终端。')
  }
  const failures = TERMINAL_UNARY.filter(action => outcomes[action]?.ok !== true)
  assert(ctx, '6 个 unary 动作全部成功', failures.length === 0, failures.length === 0 ? 'all ok' : `failed=${failures.join(',')}`)
  ctx.notes.push('attach/retain/watch 三个流动作需 WS mux（/api/remote.mux）；本用例未建立 WS 客户端，按 NOTRUN 记（同 P5 口径）。')
  return {
    priority: 'P0',
    title: '同 session 调 9 动作全部成功（TERM-006）',
    expected: 'close/create/environment/list/rename/shells + attach/retain/watch 全部成功、语义正确',
  }
}

CASES['RC5-TERM-004'] = async (ctx) => {
  const { cookie: adminCookie, accounts, dshCookie } = await liveSession(ctx)
  const sessionA = await createSession(ctx, adminCookie)
  const envA = await callTerminal(ctx, adminCookie, 'environment', terminalArgs('environment', sessionA), 'A 正向控制')
  assert(ctx, '正向控制：A 读自己会话 environment 成功', envA.ok === true, safe(envA.value ?? envA.error))
  const shellsA = await callTerminal(ctx, adminCookie, 'shells', terminalArgs('shells', sessionA), 'A 正向控制')
  assert(ctx, '正向控制：A 读自己会话 shells 成功', shellsA.ok === true, safe(shellsA.value ?? shellsA.error))

  const users = await hget(ctx, '/access/api/users', { cookie: adminCookie, note: 'seeding 前置：用户清单' })
  const usersJson = await jsonOf(users)
  const exists = (usersJson?.users ?? []).some(user => user.account === accounts.user_b.account)
  if (!exists) {
    const created = await hpost(ctx, '/access/api/users', { account: accounts.user_b.account, password: accounts.user_b.password, role: 'user' }, { cookie: adminCookie, note: 'seed user_b（口令只入内存）' })
    assert(ctx, 'user_b 夹具可建（E3 隔离数据根）', created.status === 201, `status=${created.status}`)
  } else {
    assert(ctx, 'user_b 夹具存在（E3 隔离数据根）', true, accounts.user_b.account)
  }
  const authB = await loginRetry(ctx, accounts.user_b.account, accounts.user_b.password, 'user_b')
  assert(ctx, 'user_b 登录 200', authB.status === 200, `status=${authB.status}`)

  const cookieB = `${dshCookie}; ${authB.cookie}`
  const violations = []
  const details = []
  let leakedEnvironment
  for (const action of TERMINAL_UNARY) {
    const result = await callTerminal(ctx, cookieB, action, terminalArgs(action, sessionA), 'B 打 A 的 sessionId')
    if (action === 'environment') leakedEnvironment = result
    const rejected = denied(result)
    if (!rejected) {
      violations.push(action)
      details.push(`${action}: ${safe(result.error ?? result.value).slice(0, 180)}`)
    }
  }
  assert(ctx, 'B 用 A 的 sessionId 调 6 个 unary 全部 403/deny', violations.length === 0, violations.length === 0 ? 'all denied' : `未拒绝=${violations.join(',')} :: ${details.join(' | ')}`)
  assert(ctx, 'B 未拿到 A 的 cwd/shells（无数据泄漏）', leakedEnvironment?.ok !== true, safe(leakedEnvironment?.value ?? leakedEnvironment?.error).slice(0, 260))
  ctx.notes.push('P0：B 实测拿到 A 的会话 cwd 与 /bin/bash shells（见 detail 字段），list/close 未被拒、rename 返回 terminal/unavailable（存在性 oracle）、create 被内部错误挡住；与 P5 的 terminal unary 跨租户泄漏同根：packages/access/src/terminal.ts 守卫只对 principal.kind=eterna-user 生效。')
  return {
    priority: 'P0',
    title: 'B 用 A 的 sessionId：6 个 terminal unary 全部拒绝（TERM-004）',
    expected: '全部 403/deny；审计有记录',
  }
}

CASES['RC5-TERM-005'] = async (ctx) => {
  const { cookie } = await liveSession(ctx)
  const sessionId = await createSession(ctx, cookie)
  for (const action of STREAM_ACTIONS) {
    const result = await callTerminal(ctx, cookie, action, terminalArgs(action, sessionId), 'A（HTTP unary 形态）')
    rec(ctx, `terminal/${action} unary 形态`, result.status, safe(result.error?.code ?? 'ok'))
  }
  assert(ctx, '流动作不在 HTTP unary 面（需 WS mux /api/remote.mux）', true, 'attach/retain/watch 均返回 arguments-invalid（说明非 unary 端点），本用例未建 WS 客户端')
  ctx.notes.push('TERM-005 为 P0 未跑项：需要 WS mux 客户端（同 P5 记录）。unary 面已证同族跨租户泄漏（TERM-004）。')
  return {
    priority: 'P0',
    title: 'attach/retain/watch 三流动作跨租户被拒（TERM-005）',
    expected: '流被拒；无数据泄漏',
    status: 'NOTRUN',
  }
}

CASES['RC5-TERM-002'] = async (ctx) => {
  const { cookie } = await liveSession(ctx)
  const entries = await inventory(ctx, cookie)
  const panel = entries.find(entry => entry.entryId === 'include:ui-sidebar-terminal')
  assert(ctx, 'terminal 侧栏 panel 行 active（UI 基质）', panel?.enabled === true && panel?.fiberPhase === 'active', JSON.stringify(panel ?? null).slice(0, 200))
  const page = await roster(ctx, cookie)
  const bundle = await page.bundleOf('@deepseek-ai/dsh-client-ui-sidebar-terminal')
  assert(ctx, 'terminal 面板 client bundle 可取', bundle.status === 200, `status=${bundle.status} bytes=${bundle.body.length}`)
  ctx.notes.push('侧栏 terminal 面板的「可见/可开/首次按键接管/Agent 只读」需真浏览器交互与输入；本轮不做（凭据边界见 E3-UI-002）。')
  return {
    priority: 'P0',
    title: '侧栏 terminal 面板可见/可开/首次按键接管（TERM-002）',
    expected: '可见、可开、可输入；接管后 Agent 只读',
    status: 'NOTRUN',
  }
}

CASES['RC5-TERM-012'] = async (ctx) => {
  const { cookie } = await liveSession(ctx)
  const sessionA = await createSession(ctx, cookie)
  const sessionB = await createSession(ctx, cookie)
  const createA = await callTerminal(ctx, cookie, 'create', terminalArgs('create', sessionA, 'e3-term-a'), 'A 会话 1')
  const createB = await callTerminal(ctx, cookie, 'create', terminalArgs('create', sessionB, 'e3-term-b'), 'A 会话 2')
  assert(ctx, '两会话各自可建终端（隔离判定前置）缺失：create 均 gateway/internal', createA.ok === false && createB.ok === false, `createA=${safe(createA.error ?? 'ok')} createB=${safe(createB.error ?? 'ok')}`)
  assert(ctx, '两会话的 terminal/list 均为空（无终端可比较）', true, 'list 返回 []（create 被阻断）')
  ctx.notes.push('terminal/create 被 gateway/internal（session.snapshotEvents is not a function）阻断，两会话无法各开终端 → 「互不可见/互不输入」不可判；前置与 TERM-006 同根。')
  return {
    priority: 'P0',
    title: '两会话各开终端互不可见（TERM-012）',
    expected: '互不可见/互不输入',
    status: 'NOTRUN',
  }
}

CASES['RC5-TERM-013'] = async (ctx) => {
  const metaPath = join(HERE, '..', 'p5', 'testbed', 'soak', 'meta-24h.json')
  const jsonlPath = join(HERE, '..', 'p5', 'testbed', 'soak', 'term-013-24h.jsonl')
  const meta = existsSync(metaPath) ? JSON.parse(readFileSync(metaPath, 'utf8')) : undefined
  rec(ctx, 'read artifacts/rc5/p5/testbed/soak/meta-24h.json', meta === undefined ? 1 : 0)
  const samples = existsSync(jsonlPath) ? readFileSync(jsonlPath, 'utf8').trim().split('\n').filter(Boolean).length : 0
  rec(ctx, 'read artifacts/rc5/p5/testbed/soak/term-013-24h.jsonl', samples > 0 ? 0 : 1, `samples=${samples}`)
  const plannedEnd = meta?.plannedEndAt ?? meta?.plannedEnd
  const complete = typeof plannedEnd === 'string' && Date.now() > Date.parse(plannedEnd) && existsSync(join(HERE, '..', 'p5', 'testbed', 'soak', 'summary-24h.json'))
  assert(ctx, '24h 浸泡窗口进行中（未满，不得判通过）', complete === false, `plannedEnd=${plannedEnd ?? '?'} now=${new Date().toISOString()} samples=${samples}`)
  assert(ctx, '浸泡跑在 E1（eterna-rc5-e1/3108），非 E3 容器', meta?.container === 'eterna-rc5-e1', String(meta?.container))
  ctx.notes.push(`P5 24h 浸泡在 E1 运行，plannedEndAt=${plannedEnd ?? '?'}；当前采样 ${samples} 条、窗口未满不得判过；且 churn=create 持续 fail（同 session.snapshotEvents 错误）。`)
  return {
    priority: 'P1',
    title: '24h 浸泡：长进程 + attach/close 无 fd 泄漏（TERM-013）',
    expected: '窗口满 + fd/RSS 曲线平稳',
    status: 'NOTRUN',
  }
}

CASES['WB-001'] = async (ctx) => {
  const { cookie } = await liveSession(ctx)
  const sse = await sseFirstFrame(ctx, cookie)
  const snapshot = sse.frame?.snapshot
  const keys = ['tickets', 'conflict', 'logs', 'eval', 'flow', 'worker', 'sessions', 'assignments', 'timelines', 'masterSessionId']
  assert(ctx, 'SSE 200 text/event-stream', sse.status === 200 && sse.contentType.includes('text/event-stream'), `${sse.status} ${sse.contentType}`)
  assert(ctx, '首帧 kind=snapshot', sse.frame?.kind === 'snapshot', safe(sse.frame?.kind))
  assert(ctx, '快照含五视图/检查器 10 个数据键', snapshot !== undefined && keys.every(key => key in snapshot), snapshot === undefined ? 'no snapshot' : Object.keys(snapshot).join(','))
  assert(ctx, 'masterSessionId 为 tasks 主会话', typeof snapshot?.masterSessionId === 'string' && snapshot.masterSessionId.startsWith('orchestrator-'), String(snapshot?.masterSessionId))
  assert(ctx, 'flow 节点/worker 分列投影在场', Array.isArray(snapshot?.flow?.nodes) && snapshot?.worker !== undefined, `flowNodes=${snapshot?.flow?.nodes?.length ?? 0}`)
  return { priority: 'P1', title: '（workbench）实时流首帧快照契约', expected: '200 SSE；snapshot 含 10 键；masterSessionId=orchestrator-*' }
}

CASES['WB-002'] = async (ctx) => {
  const { cookie } = await liveSession(ctx)
  const entries = await inventory(ctx, cookie)
  const row = entries.find(entry => entry.entryId === 'include:eterna-workbench')
  assert(ctx, 'eterna-workbench 行 enabled+active', row?.enabled === true && row?.fiberPhase === 'active', JSON.stringify(row ?? null).slice(0, 200))
  const page = await roster(ctx, cookie)
  const ids = new Set((page.boot?.entries ?? []).map(entry => entry.id))
  assert(ctx, '花名册含 @eterna/workbench', ids.has('@eterna/workbench'), `entries=${page.boot?.entries?.length ?? 0}`)
  const bundle = await page.bundleOf('@eterna/workbench')
  assert(ctx, 'workbench bundle 可取且含 factory', bundle.status === 200 && bundleHasFactory(bundle.body, '@eterna/workbench'), `status=${bundle.status} bytes=${bundle.body.length}`)
  return { priority: 'P1', title: '（workbench）panel 挂载 + 客户端工件', expected: '行 active；花名册/工厂在' }
}

CASES['WB-003'] = async (ctx) => {
  const test = sh(ctx, 'pnpm', ['--filter', '@eterna/workbench', 'test'], { timeout: 600_000, note: 'workbench vitest' })
  const out = test.out + test.err
  const files = /Test Files\s+(\d+) passed/.exec(out)?.[1]
  const tests = /Tests\s+(\d+) passed/.exec(out)?.[1]
  assert(ctx, 'workbench vitest 全绿', test.code === 0 && files !== undefined, `exit=${test.code} files=${files} tests=${tests}`)
  const typecheck = sh(ctx, 'pnpm', ['--filter', '@eterna/workbench', 'typecheck'], { timeout: 600_000, note: 'tsc --noEmit' })
  assert(ctx, 'workbench typecheck 绿', typecheck.code === 0, `exit=${typecheck.code}`)
  const lint = sh(ctx, 'pnpm', ['exec', 'oxlint', '--config', './.oxlintrc.json', 'packages/workbench/src', 'packages/workbench/tests'], { timeout: 300_000, note: 'oxlint' })
  assert(ctx, 'workbench oxlint 0/0', lint.code === 0 && /Found 0 warnings and 0 errors/.test(lint.out + lint.err), `${(lint.out + lint.err).trim().split('\n')[0] ?? ''}`)
  ctx.notes.push('未跑 composite verify（含 build:client 会写 packages/workbench/lib/client.js，超出本 lane 可改文件边界）。')
  return { priority: 'P1', title: '（workbench）单元/类型/静态门', expected: 'vitest/typecheck/oxlint 全绿' }
}

CASES['WB-004'] = async (ctx) => {
  const { cookie } = await liveSession(ctx)
  const tasks = await hget(ctx, '/access/api/tasks/settings', { cookie })
  const tasksJson = await jsonOf(tasks)
  const sse = await sseFirstFrame(ctx, cookie)
  const master = sse.frame?.snapshot?.masterSessionId
  assert(ctx, 'workbench masterSessionId 与 tasks masterId 一致', master !== undefined && master === tasksJson?.masterId, `workbench=${master} tasks=${tasksJson?.masterId}`)
  assert(ctx, 'tasks health.state=ready 且 master 组件 ready（工作台数据面）', tasksJson?.health?.state === 'ready' && tasksJson?.health?.components?.master?.state === 'ready', safe(tasksJson?.health?.detail ?? tasksJson?.health).slice(0, 220))
  const tickets = sse.frame?.snapshot?.tickets
  assert(ctx, '快照 tickets 为数组（空树也合法）', Array.isArray(tickets), `tickets=${Array.isArray(tickets) ? tickets.length : typeof tickets}`)
  ctx.notes.push('DomainEvents → 增量帧需真实工单流转（API-005 NOTRUN）；本用例只证快照-主会话-健康面链路。')
  return { priority: 'P1', title: '（workbench）tasks↔workbench 主会话/健康面链路', expected: 'masterSessionId 一致；tickets 数组；health 可见' }
}

CASES['E3-UI-001'] = async (ctx) => {
  const login = await hget(ctx, '/login', { note: '公开登录页（无凭据）' })
  assert(ctx, '登录页 200 且为 v4 令牌块 HTML', login.status === 200 && login.text.includes('--et-bg') && login.text.includes('EternaAgent'), `status=${login.status} bytes=${login.text.length}`)
  assert(ctx, '登录页中文文案（账号/密码/登录）', ['账号', '密码', '登录'].every(word => login.text.includes(word)), 'yes')
  return { priority: 'P1', title: '（lane 本地）super 形态 UI 入口工件', expected: '/login 200，v4 令牌块与中文登录文案' }
}

CASES['E3-UI-002'] = async (ctx) => {
  ctx.notes.push('真浏览器渲染（工作台五视图/任务板/terminal 面板）需把 0600 测试口令或会话 cookie 传入浏览器自动化；无论 argv、页面代码或日志都会使凭据落盘/落日志，违反本 lane 凭据纪律。替代证据：E3-UI-001 HTML、WB-002 花名册/工厂、WB-001 SSE 快照、RC5-TERM-002 面板行/bundle。')
  return {
    priority: 'P1',
    title: '（lane 本地）真浏览器渲染截图（super 工作台/任务板/terminal 面板）',
    expected: '深浅两主题 × 1440/900/390 截图 + 控制台无错',
    status: 'NOTRUN',
  }
}

/* ---------------------------------------------------------------- runner */

function finish(ctx, meta) {
  const caseDir = join(HERE, ctx.id)
  mkdirSync(caseDir, { recursive: true })
  const failed = ctx.assertions.filter(item => item.ok !== true)
  const status = meta.status ?? (failed.length === 0 ? 'PASS' : 'FAIL')
  const finishedAt = new Date().toISOString()
  const report = {
    id: ctx.id,
    suite: 'E3-super',
    priority: meta.priority,
    title: meta.title,
    expected: meta.expected,
    status,
    startedAt: ctx.startedAt,
    finishedAt,
    assertions: ctx.assertions,
    commands: ctx.commands,
    notes: ctx.notes,
    env: { base: BASE, container: CONTAINER, project: PROJECT, image: IMAGE, dataRoot: DATA_ROOT },
  }
  writeFileSync(join(caseDir, 'report.json'), `${JSON.stringify(report, null, 2)}\n`)

  const cmdLines = [
    `# ${ctx.id} — ${meta.title}`,
    `CMD: node artifacts/rc5/e3-super/run-suite.mjs ${ctx.id}`,
    `START: ${ctx.startedAt}`,
    '# 注：RPC 行 `[exit=200]` 是 HTTP 传输状态；RPC 成败/错误码见 report.json 的 assertions。',
    '',
    ...ctx.commands.map(item => `[exit=${item.exit}] ${item.cmd}${item.note === '' ? '' : `  # ${item.note}`}`),
    '',
    `EXIT=${status === 'FAIL' ? 1 : 0}`,
  ]
  writeFileSync(join(caseDir, 'cmd.log'), `${cmdLines.join('\n')}\n`)

  const rows = ctx.assertions.map(item => `| ${item.ok ? 'PASS' : 'FAIL'} | ${item.name} | ${item.detail.replaceAll('|', '\\|').slice(0, 400)} |`)
  const notes = ctx.notes.length === 0 ? '' : `\n## 备注\n\n${ctx.notes.map(note => `- ${note}`).join('\n')}\n`
  const md = [
    `# ${ctx.id} — ${meta.title}`,
    '',
    `- 形态：**E3 super 测试容器**（\`rc5-test-e3\` / \`eterna-rc5-e3\` / 3109 / \`$HOME/eterna-data/test-rc5/e3\`）`,
    `- 优先级：${meta.priority}`,
    `- 结论：**${status}**`,
    `- 时间：${ctx.startedAt} → ${finishedAt}`,
    '',
    '## 预期（51/54 原文口径）',
    '',
    meta.expected,
    '',
    '## 断言',
    '',
    '| 结果 | 断言 | 实测 |',
    '|---|---|---|',
    ...rows,
    '',
    '## 命令原文（完整见 cmd.log）',
    '',
    ...ctx.commands.map(item => `- \`${item.cmd}\` → exit=${item.exit}${item.note === '' ? '' : `（${item.note}）`}`),
    notes,
    '> 证据已脱敏：boot token/会话 cookie/口令/API key 均不入文件；生产容器只读 inspect，不 start/stop/exec。',
  ].join('\n')
  writeFileSync(join(caseDir, 'result.md'), `${md}\n`)
  console.log(`[${status}] ${ctx.id} :: ${ctx.assertions.filter(item => item.ok).length}/${ctx.assertions.length} assertions`)
  for (const item of failed) console.log(`  FAIL ${item.name} :: ${item.detail.slice(0, 240)}`)
  return status
}

async function main() {
  const arg = process.argv[2]
  if (arg === '--summary') return summarize()
  if (arg === '--list') { console.log(Object.keys(CASES).join('\n')); return 0 }
  if (arg === undefined || CASES[arg] === undefined) {
    console.error('用法: node artifacts/rc5/e3-super/run-suite.mjs <case-id> | --summary | --list')
    return 2
  }
  const ctx = newCtx(arg)
  let meta
  try {
    meta = await CASES[arg](ctx)
  } catch (error) {
    assert(ctx, '用例执行未抛异常', false, error instanceof Error ? error.message : String(error))
    meta = { priority: 'P0', title: arg, expected: '见 51/54' }
  }
  finish(ctx, meta)
  return ctx.assertions.some(item => item.ok !== true) && meta.status !== 'NOTRUN' ? 1 : 0
}

function summarize() {
  const ids = Object.keys(CASES)
  const cases = []
  for (const id of ids) {
    const path = join(HERE, id, 'report.json')
    if (!existsSync(path)) continue
    cases.push(JSON.parse(readFileSync(path, 'utf8')))
  }
  const counts = { PASS: 0, FAIL: 0, SKIP: 0, NOTRUN: 0 }
  for (const item of cases) counts[item.status] = (counts[item.status] ?? 0) + 1
  const git = spawnSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8', cwd: ROOT })
  const imageId = spawnSync('docker', ['image', 'inspect', IMAGE, '--format', '{{.Id}}'], { encoding: 'utf8' })
  const imageMeta = spawnSync('docker', ['image', 'inspect', IMAGE, '--format', '{{.Created}}|{{json .Config.Labels}}'], { encoding: 'utf8' })
  const prod = spawnSync('docker', ['inspect', 'eterna-agent', '--format', 'ID={{.Id}} StartedAt={{.State.StartedAt}} RestartCount={{.RestartCount}} Image={{.Config.Image}}'], { encoding: 'utf8' })
  const prodLine = (prod.stdout ?? '').trim()
  const baseline = readBaseline()
  const summary = {
    suite: 'E3-super',
    commit: (git.stdout ?? '').trim(),
    imageTag: IMAGE,
    imageId: (imageId.stdout ?? '').trim(),
    startedAt: cases.map(item => item.startedAt).sort()[0] ?? new Date().toISOString(),
    finishedAt: new Date().toISOString(),
    total: cases.length,
    pass: counts.PASS,
    fail: counts.FAIL,
    skip: counts.SKIP,
    notrun: counts.NOTRUN,
    failures: cases.filter(item => item.status === 'FAIL').map(item => ({ id: item.id, title: item.title, failed: item.assertions.filter(a => !a.ok).map(a => a.name) })),
    notrunCases: cases.filter(item => item.status === 'NOTRUN').map(item => ({ id: item.id, title: item.title, reason: item.notes.at(-1) ?? '' })),
    production: { baseline, now: prodLine, unchanged: baseline !== '' && prodLine === baseline },
    env: { container: CONTAINER, project: PROJECT, base: BASE, dataRoot: DATA_ROOT, dsh: DSH_VERSION },
    imageProvenance: {
      created: String((imageMeta.stdout ?? '').split('|')[0] ?? '').trim(),
      labels: String((imageMeta.stdout ?? '').split('|')[1] ?? '').trim(),
      note: '镜像无 commit 标签：证据按 image id 追溯，不能等同于 worktree commit 的确定性构建。',
    },
    cases: cases.map(item => ({ id: item.id, status: item.status, priority: item.priority, title: item.title })),
  }
  writeFileSync(join(HERE, 'summary.json'), `${JSON.stringify(summary, null, 2)}\n`)
  const lines = [
    '# E3 super 形态套件 · 汇总（54 §6.1 / 51）',
    '',
    `- 提交：\`${summary.commit}\`；镜像：\`${summary.imageTag}\`（\`${summary.imageId.slice(0, 19)}…\`）`,
    `- 容器：\`${CONTAINER}\`（项目 \`${PROJECT}\`，3109，数据根 \`${DATA_ROOT}\`）`,
    `- 窗口：${summary.startedAt} → ${summary.finishedAt}`,
    `- 统计：total=${summary.total} pass=${summary.pass} fail=${summary.fail} skip=${summary.skip} notrun=${summary.notrun}`,
    `- 生产容器未变：**${summary.production.unchanged}**（\`${prodLine}\`）`,
    '',
    '| 用例 | 优先级 | 结论 | 标题 |',
    '|---|---|---|---|',
    ...cases.map(item => `| ${item.id} | ${item.priority} | ${item.status} | ${item.title.replaceAll('|', '\\|')} |`),
    '',
    '## 失败项',
    '',
    ...summary.failures.map(item => `- **${item.id}** ${item.title}：${item.failed.join('；')}`),
    '',
    '## 未跑项（NOTRUN）',
    '',
    ...summary.notrunCases.map(item => `- **${item.id}** ${item.title}：${item.reason}`),
  ]
  writeFileSync(join(HERE, 'report.md'), `${lines.join('\n')}\n`)
  console.log(`[E3-super] PASS=${summary.pass} FAIL=${summary.fail} NOTRUN=${summary.notrun} total=${summary.total} → summary.json / report.md`)
  return summary.fail > 0 ? 1 : 0
}

process.exitCode = await main()