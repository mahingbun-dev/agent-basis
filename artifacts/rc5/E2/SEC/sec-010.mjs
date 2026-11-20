#!/usr/bin/env node
/**
 * E2 · RC5-SEC-010：旧版本数据（0.1.51 启动过的冷备副本）升级到 rc.5 终版镜像后，
 * 旧会话/旧记忆/旧提示词完整，且可继续对话。
 *
 * 数据源：`~/eterna-data/test-rc5/p6b-e5b`（DATA-010 记录的「冷备解包 + rsync 副本，
 * rc.5 从未启动过」；0.1.51 启动过，等价旧卷）。本脚本把它复制到独立根
 * `p6b-sec10`，用终版镜像起独立容器（3232/9332，项目 rc5-sec10），**不触碰**源副本、
 * E1/E2/E3、浸泡容器与生产。
 *
 * 断言：
 *   1) 升级前指纹：旧会话 22 事件（4 user / 1 assistant，首条用户文本「只回复两个字：收到」；
 *      该会话在旧卷 workspace.json 中未归档——已归档会话按 rc.5 语义拒绝起回合），
 *      users=2、access sessions=145、记忆实体 12/域 15、提示词工坊文件 155；
 *   2) 终版镜像启动 healthy，profile 迁移无 FATAL；
 *   3) 管理员（旧数据用户 Mr.Ma）登录后 `session/state` + `session/wait` 能打开旧会话，
 *      首条用户文本与助手回复逐字一致；
 *   4) 记忆库（实体/域计数 + 内容摘要哈希）与提示词工坊（文件清单哈希）升级后不变；
 *   5) 对旧会话 `session/selectModel` 切到确定性假模型后发新 prompt，回合完成并追加
 *      新的 assistant 消息（可继续对话），且不调用任何真实模型（假模型日志为证）。
 *
 * 用法：node artifacts/rc5/E2/SEC/sec-010.mjs
 */
import { createHash, randomBytes, scryptSync } from 'node:crypto'
import { spawn } from 'node:child_process'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { Case, STATUS, shape } from '../_lib/evidence.mjs'
import { docker, run, sleep } from '../_lib/env.mjs'
import {
  bootTokenFromContainer, bootstrapDshSession, login, rpc as rpcAt,
} from '../../../../scripts/rc5-test-client.mjs'

const REPO = join(homedir(), 'code', 'agent-basis-rc5')
const TEST_ROOT = join(homedir(), 'eterna-data', 'test-rc5')
const SOURCE = join(TEST_ROOT, 'p6b-e5b')
const TARGET = join(TEST_ROOT, 'p6b-sec10')
const ENV_SRC = join(TEST_ROOT, '.env.p6b-a')
const ENV_DST = join(TEST_ROOT, '.env.sec10')
const PROJECT = 'rc5-sec10'
const CONTAINER = 'eterna-rc5-sec10'
const PORT = 3232
const RELAY = 9332
const BASE = `http://127.0.0.1:${PORT}`
const IMAGE = 'eterna-agent:rc5-test'
const SESSION_ID = 'session-2ef15ce5-f5f5-48d8-83ae-2b22da492720'
const LEGACY_ADMIN = 'Mr.Ma'
const USER_TEXT = '只回复两个字：收到'
const FAKE_PORT = 4607

const OUT = join(REPO, 'artifacts/rc5/E2/SEC')
const OVERRIDE = join(OUT, 'compose.sec10.override.yml')
const LOG = join(OUT, 'tmp', 'fake-llm-sec010.jsonl')

function envMap(path) {
  const map = {}
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    const trimmed = line.trim()
    if (trimmed === '' || trimmed.startsWith('#')) continue
    const eq = trimmed.indexOf('=')
    if (eq === -1) continue
    let value = trimmed.slice(eq + 1)
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1)
    map[trimmed.slice(0, eq)] = value
  }
  return map
}

function writeEnv(path, map) {
  const text = Object.entries(map).map(([key, value]) => `${key}=${value}`).join('\n') + '\n'
  writeFileSync(path, text, { mode: 0o600 })
}

function sessionFile(root, id) {
  return join(root, 'sessions', '--data-workspaces-Mr.Ma--', id, 'session.v4.jsonl.zstd')
}

function readSessionText(root, id) {
  const out = execFileSync('zstd', ['-dc', sessionFile(root, id)], { maxBuffer: 64 * 1024 * 1024 }).toString('utf8')
  return out.split('\n').filter(Boolean)
}

function textOfMessage(event) {
  const blocks = event?.data?.message?.content ?? event?.data?.content ?? event?.message?.content ?? []
  return blocks.filter(block => block?.type === 'text').map(block => block.text).join('\n')
}

function sessionFacts(lines) {
  const events = lines.map(line => { try { return JSON.parse(line) } catch { return { type: 'bad' } } })
  const counts = {}
  for (const event of events) counts[event.type] = (counts[event.type] ?? 0) + 1
  const firstUser = events.find(event => event.type === 'user/message' && (event.data?.source?.kind ?? 'user') === 'user')
  const firstAssistant = events.find(event => event.type === 'assistant/message')
  return {
    events: events.length,
    counts,
    userText: firstUser === undefined ? '' : textOfMessage(firstUser),
    assistantText: firstAssistant === undefined ? '' : textOfMessage(firstAssistant),
  }
}

function memoryFacts(file) {
  const db = new DatabaseSync(file, { readOnly: true })
  const entities = db.prepare('SELECT id, subject, key, content, summary, kind, scope, domain_key FROM memory_entity ORDER BY id').all()
  const domains = db.prepare('SELECT COUNT(*) n FROM domain_registry').get().n
  const digest = createHash('sha256')
  for (const row of entities) digest.update([row.id, row.subject, row.key, row.content, row.summary, row.kind, row.scope, row.domain_key].join('\u0001'))
  return { entities: entities.length, domains, digest: digest.digest('hex'), sample: entities[0]?.content ?? '' }
}

function promptFacts(root) {
  const base = join(root, 'storages')
  const files = []
  const walk = (dir) => {
    for (const name of readdirSync(dir)) {
      const path = join(dir, name)
      if (statSync(path).isDirectory()) walk(path)
      else if (path.includes('eterna_prompt')) files.push(path)
    }
  }
  if (existsSync(base)) walk(base)
  const digest = createHash('sha256')
  for (const path of files.sort()) digest.update(path.slice(root.length)).update(readFileSync(path))
  return { files: files.length, digest: digest.digest('hex') }
}

function accessFacts(root) {
  const db = new DatabaseSync(join(root, 'access', 'users.db'), { readOnly: true })
  return {
    users: db.prepare('SELECT COUNT(*) n FROM users').get().n,
    sessions: db.prepare('SELECT COUNT(*) n FROM sessions').get().n,
    workspaces: db.prepare('SELECT COUNT(*) n FROM workspaces').get().n,
  }
}

/** 升级前在副本内重置旧管理员口令（旧卷口令无档可查；仅改 password_hash/version）。 */
function resetLegacyAdminPassword(root, account, password) {
  const salt = randomBytes(16)
  const hash = scryptSync(password, salt, 32, { N: 16384, r: 8, p: 1 })
  const stored = `s1$${salt.toString('base64')}$${hash.toString('base64')}`
  const db = new DatabaseSync(join(root, 'access', 'users.db'))
  const info = db.prepare('UPDATE users SET password_hash = ?, password_version = password_version + 1 WHERE account = ?')
    .run(stored, account)
  db.close()
  return Number(info.changes ?? 0)
}

function fakeProvider() {
  return {
    displayName: 'RC5 Fake SEC-010（确定性验收夹具）',
    apiKeyEnv: 'FAKE_LLM_API_KEY',
    api: 'openai-completions',
    baseURL: `http://host.docker.internal:${FAKE_PORT}/v1`,
    models: [{
      id: 'fake-1', name: 'Fake 1', contextWindow: 128000, maxTokens: 4096, input: ['text', 'image'],
      compat: { supportsDeveloperRole: true, requiresReasoningContentOnAssistantMessages: false, maxTokensField: 'max_tokens' },
    }],
  }
}

function rpc(cookie, method, args = {}, options = {}) {
  return rpcAt(BASE, cookie, method, args, { timeoutMs: options.timeoutMs ?? 60_000 })
}

async function waitIdle(cookie, sessionId, { timeoutMs = 180_000, sinceCursor = 0 } = {}) {
  const t0 = Date.now()
  for (;;) {
    const state = await rpc(cookie, 'session/state', { sessionId })
    const value = state.value ?? {}
    const advanced = typeof value.cursor === 'number' && value.cursor > sinceCursor
    if (advanced && value.running === false && (value.queue ?? []).length === 0) return value
    if (Date.now() - t0 > timeoutMs) throw new Error(`回合超时：${JSON.stringify(value).slice(0, 300)}`)
    await sleep(1_000)
  }
}

const c = new Case('SEC', 'RC5-SEC-010')
let child
let containerUp = false
try {
  mkdirSync(join(OUT, 'tmp'), { recursive: true })
  rmSync(LOG, { force: true })

  /* 0) 源/目标 */
  if (!existsSync(SOURCE)) throw new Error(`旧卷副本不存在: ${SOURCE}`)
  if (existsSync(TARGET)) throw new Error(`目标根已存在（避免覆盖既有证据）: ${TARGET}`)
  const copy = run('rsync', ['-aH', `${SOURCE}/`, `${TARGET}/`], { timeout: 600_000 })
  c.cmd(`rsync -aH ${SOURCE}/ ${TARGET}/（旧卷副本 → 独立 sec10 根）`, copy.exit, shape(copy.stderr, 200))

  /* 0b) 旧管理员口令无档可查：仅在副本内重置口令（账号/角色/归属/会话内容不动） */
  const laneAdmin = JSON.parse(readFileSync(join(TEST_ROOT, '.test-accounts.json'), 'utf8')).admin
  const reset = resetLegacyAdminPassword(TARGET, LEGACY_ADMIN, laneAdmin.password)
  c.cmd(`sqlite: UPDATE users SET password_hash（${LEGACY_ADMIN}，仅口令）`, reset === 1 ? 0 : 1,
    `changed=${reset}（旧卷口令不在任何存量配置中；重置仅用于登录，其余数据不动）`)

  /* 1) 升级前指纹 */
  const preSession = sessionFacts(readSessionText(TARGET, SESSION_ID))
  const preAccess = accessFacts(TARGET)
  const preMemory = memoryFacts(join(TARGET, '.eterna', 'memory.sqlite3'))
  const prePrompt = promptFacts(TARGET)
  c.cmd(`zstd -dc …/${SESSION_ID}/session.v4.jsonl.zstd | wc -l`, 0,
    `events=${preSession.events} counts=${JSON.stringify(preSession.counts)} userText=${shape(preSession.userText, 60)}`)
  c.cmd('sqlite: access users/sessions/workspaces', 0, JSON.stringify(preAccess))
  c.cmd('sqlite: memory_entity/domain_registry + content sha256', 0,
    `entities=${preMemory.entities} domains=${preMemory.domains} digest=${preMemory.digest.slice(0, 16)}…`)
  c.cmd('storages/eterna_prompt* 文件数 + 清单 sha256', 0,
    `files=${prePrompt.files} digest=${prePrompt.digest.slice(0, 16)}…`)

  /* 2) env / compose（凭据沿用 0600 的 p6b-a env，本文件只改实例/端口/数据根） */
  const env = envMap(ENV_SRC)
  env.ETERNA_DATA_ROOT = TEST_ROOT
  env.ETERNA_INSTANCE = 'p6b-sec10'
  env.ETERNA_FORM = 'web'
  env.ETERNA_CONTAINER_NAME = CONTAINER
  env.ETERNA_PORT = String(PORT)
  env.ETERNA_RELAY_PORT = String(RELAY)
  env.ETERNA_PUBLIC_URL = BASE
  env.ETERNA_TRUSTED_HOST = `127.0.0.1:${PORT}`
  env.ETERNA_IMAGE = IMAGE
  env.ETERNA_MCP_PERSONAL_ENABLED = 'false'
  env.ETERNA_ACCESS_ADMIN_USER = LEGACY_ADMIN
  env.ETERNA_ACCESS_ADMIN_PASSWORD = laneAdmin.password
  env.FAKE_LLM_API_KEY = 'rc5-fake-local-placeholder'
  writeEnv(ENV_DST, env)
  c.cmd(`写 ${ENV_DST}（0600；沿用 p6b-a 凭据，仅改实例/端口/数据根）`, 0,
    `keys=${Object.keys(env).length} instance=p6b-sec10 form=web port=${PORT} root=${TARGET}`)

  const composeFiles = ['-f', join(REPO, 'docker-compose.yml'), '-f', OVERRIDE]
  const compose = ['compose', '-p', PROJECT, '--env-file', ENV_DST, ...composeFiles, 'up', '-d', '--no-build', 'eterna-agent']
  const up = run('docker', compose, { timeout: 600_000 })
  containerUp = up.exit === 0
  c.cmd(`docker ${compose.join(' ')}`, up.exit, shape(`${up.stdout}\n${up.stderr}`, 400))
  let health = 'unknown'
  for (let attempt = 0; attempt < 90; attempt += 1) {
    health = docker(['inspect', CONTAINER, '--format', '{{.State.Health.Status}}']).stdout
    if (health === 'healthy' || health === 'unhealthy') break
    await sleep(2_000)
  }
  const imageId = docker(['inspect', CONTAINER, '--format', '{{.Image}}']).stdout
  const fatal = docker(['logs', CONTAINER])
  const bootLog = `${fatal.stdout}\n${fatal.stderr}`
  const fatalLines = bootLog.split('\n').filter(line => /FATAL|不可恢复/.test(line))
  c.cmd('docker inspect health/image', 0, `health=${health} image=${imageId}`)
  c.cmd('docker logs（扫描 FATAL）', fatal.exit, `fatalLines=${fatalLines.length}`)

  /* 3) 登录旧管理员并打开旧会话 */
  const dsh = await bootstrapDshSession(BASE, bootTokenFromContainer(CONTAINER))
  const auth = await login(BASE, LEGACY_ADMIN, laneAdmin.password)
  const cookie = `${dsh}; ${auth.cookie}`
  c.cmd(`管理员登录（旧数据用户 ${LEGACY_ADMIN}）`, auth.status, `status=${auth.status} cookie=${auth.cookie === '' ? 'none' : 'ok'}`)
  const state = await rpc(cookie, 'session/state', { sessionId: SESSION_ID })
  const wait = await rpc(cookie, 'session/wait', { request: { sessionId: SESSION_ID, cursor: 0, timeoutMs: 5_000 } })
  const waitRecords = wait.value?.output?.records ?? []
  /* session/wait 只回 assistant 窗口；用户文本走 session/page（只读，不改会话）。 */
  const page = await rpc(cookie, 'session/page', { address: { kind: 'session', sessionId: SESSION_ID }, maxMessages: 50 })
  const pageRecords = (page.value?.records ?? []).map(record => record.event ?? record)
  const apiUser = pageRecords.find(event => event.type === 'user/message' && (event.data?.source?.kind ?? 'user') === 'user')
  const apiAssistant = pageRecords.find(event => event.type === 'assistant/message')
  const apiUserText = apiUser === undefined ? '' : textOfMessage(apiUser)
  const apiAssistantText = apiAssistant === undefined ? '' : textOfMessage(apiAssistant)
  c.cmd('POST /api/session/state（旧会话）', state.status, `ok=${state.ok} cursor=${state.value?.cursor ?? '-'} running=${state.value?.running}`)
  c.cmd('POST /api/session/wait {cursor:0}', wait.status, `ok=${wait.ok} assistantRecords=${waitRecords.length}`)
  c.cmd('POST /api/session/page（旧会话历史）', page.status,
    `ok=${page.ok} records=${pageRecords.length} userText=${shape(apiUserText, 60)} assistantText=${shape(apiAssistantText, 60)}`)

  /* 4) 记忆/提示词升级后 */
  const postMemory = memoryFacts(join(TARGET, '.eterna', 'memory.sqlite3'))
  const postPrompt = promptFacts(TARGET)
  const postAccess = accessFacts(TARGET)
  c.cmd('升级后 sqlite: access 计数', 0, JSON.stringify(postAccess))
  c.cmd('升级后 memory 计数/摘要哈希', 0,
    `entities=${postMemory.entities} domains=${postMemory.domains} digest=${postMemory.digest.slice(0, 16)}…`)
  c.cmd('升级后 storages 提示词文件数/哈希', 0,
    `files=${postPrompt.files} digest=${postPrompt.digest.slice(0, 16)}…`)

  /* 5) 续聊：假模型（防真实模型出网） */
  child = spawn(process.execPath, [join(REPO, 'artifacts/rc5/E2/LLM/fake-llm-server.mjs')], {
    env: { ...process.env, PORT: String(FAKE_PORT), FAKE_LLM_LOG: LOG },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  child.stderr.on('data', () => undefined)
  let fakeUp = false
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      const response = await fetch(`http://127.0.0.1:${FAKE_PORT}/healthz`, { signal: AbortSignal.timeout(800) })
      if (response.ok) { fakeUp = true; break }
    } catch { /* not ready */ }
    await sleep(200)
  }
  c.cmd(`PORT=${FAKE_PORT} FAKE_LLM_LOG=… node fake-llm-server.mjs`, fakeUp ? 0 : 1, `healthz=${fakeUp}`)
  const route = await rpc(cookie, 'settings/update', { request: { ns: 'llm-pi-ai', patch: { providers: { fake: fakeProvider() } } } })
  const defaultModel = await rpc(cookie, 'settings/update', { request: { ns: 'agent-default-model', patch: { provider: 'fake', model: 'fake-1' } } })
  const selected = await rpc(cookie, 'session/selectModel', { request: { sessionId: SESSION_ID, provider: 'fake', model: 'fake-1' } })
  c.cmd('settings fake provider + agent-default-model + session/selectModel', selected.ok ? 200 : 500,
    `provider=${route.ok} default=${defaultModel.ok} selected=${JSON.stringify(selected.value?.selected ?? selected.error)}`)

  const before = await rpc(cookie, 'session/state', { sessionId: SESSION_ID })
  const mark = existsSync(LOG) ? readFileSync(LOG, 'utf8').split('\n').filter(Boolean).length : 0
  const prompt = await rpc(cookie, 'session/prompt', {
    request: {
      requestId: `sec010-${Date.now().toString(36)}`,
      sessionId: SESSION_ID,
      mode: 'queue',
      clientTimeZone: 'Asia/Shanghai',
      content: [{ type: 'text', text: `@@SEQ 1\nSEC-010 升级续聊：请用一句话确认你能继续这个会话。` }],
    },
  })
  c.cmd('POST /api/session/prompt（旧会话续聊，假模型）', prompt.ok ? 200 : 500,
    `ok=${prompt.ok} code=${prompt.error?.code ?? '-'} msg=${shape(prompt.error?.message, 140)}`)
  const afterState = await waitIdle(cookie, SESSION_ID, { sinceCursor: before.value?.cursor ?? 0 })
  const afterWait = await rpc(cookie, 'session/wait', { request: { sessionId: SESSION_ID, cursor: 0, timeoutMs: 5_000 } })
  const afterRecords = (afterWait.value?.output?.records ?? []).map(record => record.event ?? record)
  const fakeRows = existsSync(LOG) ? readFileSync(LOG, 'utf8').split('\n').filter(Boolean).slice(mark).map(line => JSON.parse(line)) : []
  const newAssistant = afterRecords.filter(event => event.type === 'assistant/message')
    .map(event => textOfMessage(event)).filter(text => /回合结束/.test(text))
  c.cmd('续聊收尾（session/state）', 200, `cursor=${afterState.cursor} running=${afterState.running}`)
  c.cmd('假模型日志（续聊请求数/模型）', fakeUp ? 0 : 1,
    `requests=${fakeRows.length} model=${fakeRows[0]?.model ?? '-'} calledTools=${JSON.stringify(fakeRows[0]?.calledTools ?? [])}`)

  c.assert('旧卷副本复制成功（独立根，不碰源）', copy.exit === 0 && existsSync(sessionFile(TARGET, SESSION_ID)))
  c.assert('升级前旧会话内容可读（4 user / 1 assistant，首条用户文本一致）',
    preSession.counts['user/message'] === 4 && preSession.counts['assistant/message'] === 1 && preSession.userText === USER_TEXT,
    `counts=${JSON.stringify(preSession.counts)} userText=${shape(preSession.userText, 40)}`)
  c.assert('升级前数据面计数（users=2 / sessions=145 / 记忆 12 / 域 15 / 提示词文件 155）',
    preAccess.users === 2 && preAccess.sessions === 145 && preMemory.entities === 12
    && preMemory.domains === 15 && prePrompt.files === 155,
    `access=${JSON.stringify(preAccess)} memory=${preMemory.entities}/${preMemory.domains} prompt=${prePrompt.files}`)
  c.assert('终版镜像起容器 healthy 且无 FATAL', health === 'healthy' && imageId.length > 0 && fatalLines.length === 0,
    `health=${health} image=${imageId.slice(0, 20)} fatal=${fatalLines.length}`)
  c.assert('管理员登录后可打开旧会话（state ok / wait 返回记录）',
    state.ok === true && wait.ok === true && page.ok === true && waitRecords.length > 0 && pageRecords.length > 0,
    `state=${state.ok} wait=${wait.ok} page=${page.ok} waitRecords=${waitRecords.length} pageRecords=${pageRecords.length}`)
  c.assert('旧会话内容完整（首条用户文本 + 助手回复逐字一致）',
    apiUserText === preSession.userText && apiAssistantText === preSession.assistantText && apiUserText !== '' && apiAssistantText !== '',
    `user=${shape(apiUserText, 40)} assistant=${shape(apiAssistantText, 40)}`)
  c.assert('旧记忆完整（实体/域计数与内容摘要哈希不变）',
    postMemory.entities === preMemory.entities && postMemory.domains === preMemory.domains
    && postMemory.digest === preMemory.digest,
    `pre=${preMemory.entities}/${preMemory.domains}/${preMemory.digest.slice(0, 12)} post=${postMemory.entities}/${postMemory.domains}/${postMemory.digest.slice(0, 12)}`)
  c.assert('旧提示词工坊完整（文件数/清单哈希不变）',
    postPrompt.files === prePrompt.files && postPrompt.digest === prePrompt.digest,
    `pre=${prePrompt.files}/${prePrompt.digest.slice(0, 12)} post=${postPrompt.files}/${postPrompt.digest.slice(0, 12)}`)
  c.assert('旧会话可继续对话（新回合完成并追加 assistant 回复）',
    selected.ok === true && prompt.ok === true && newAssistant.length > 0 && afterState.running === false,
    `selected=${selected.ok} prompt=${prompt.ok} newAssistant=${newAssistant.length}`)
  c.assert('续聊只调用假模型（无真实模型出网）',
    fakeRows.length > 0 && fakeRows.every(row => row.model === 'fake-1'), `requests=${fakeRows.length}`)
  c.assert('升级前后 access 计数不变', postAccess.users === preAccess.users && postAccess.sessions === preAccess.sessions
    && postAccess.workspaces === preAccess.workspaces, `pre=${JSON.stringify(preAccess)} post=${JSON.stringify(postAccess)}`)

  const pass = copy.exit === 0 && preSession.userText === USER_TEXT
    && preSession.counts['user/message'] === 4 && preSession.counts['assistant/message'] === 1
    && preAccess.users === 2 && preAccess.sessions === 145 && preMemory.entities === 12 && preMemory.domains === 15
    && prePrompt.files === 155 && health === 'healthy' && fatalLines.length === 0
    && state.ok === true && wait.ok === true && page.ok === true && apiUserText === preSession.userText
    && apiAssistantText === preSession.assistantText
    && postMemory.entities === preMemory.entities && postMemory.domains === preMemory.domains
    && postMemory.digest === preMemory.digest && postPrompt.files === prePrompt.files
    && postPrompt.digest === prePrompt.digest && selected.ok === true && prompt.ok === true
    && newAssistant.length > 0 && fakeRows.length > 0 && fakeRows.every(row => row.model === 'fake-1')
    && postAccess.users === preAccess.users && postAccess.sessions === preAccess.sessions
  c.finish({
    status: pass ? STATUS.PASS : STATUS.FAIL,
    title: '旧会话/记忆/提示词升级后可用且可继续对话',
    expected: '旧数据（0.1.51 卷副本）升级到 rc.5 终版后：内容完整、可继续对话',
    actual: `events=${preSession.events} userText=「${preSession.userText}」 assistant=「${shape(preSession.assistantText, 40)}」 `
      + `access=${JSON.stringify(preAccess)} memory=${preMemory.entities}/${preMemory.domains} prompt=${prePrompt.files} `
      + `health=${health} fatal=${fatalLines.length} open=${state.ok && wait.ok} continue=${newAssistant.length > 0} fakeOnly=${fakeRows.every(row => row.model === 'fake-1')}`,
    notes: [
      `独立 lane：项目 ${PROJECT} / 容器 ${CONTAINER} / 端口 ${PORT}（未触碰生产、E1/E2/E3、浸泡容器）`,
      `数据源=${SOURCE}（DATA-010 旧卷副本，0.1.51 启动过，rc.5 从未启动）；复制到 ${TARGET} 后升级，源副本不动`,
      `镜像=${IMAGE}（终版 ${imageId.slice(0, 19)}…）；登录用户=旧数据管理员 ${LEGACY_ADMIN}`,
      `旧卷 ${LEGACY_ADMIN} 口令不在任何存量配置中：升级前仅在副本内重置 password_hash（账号/角色/归属/会话/记忆/提示词不动）`,
      '续聊前把会话模型切到本机确定性假模型（session/selectModel），证明不依赖真实模型/不出网',
      `假模型日志 ${LOG}（只记工具名/模型/消息数，不记 prompt 正文与凭据）；FAKE_LLM_API_KEY 为本地占位（compose.sec10.override.yml）`,
    ],
    artifacts: ['cmd.log'],
  })
  console.log(`[SEC-010] ${pass ? 'PASS' : 'FAIL'}`)
} finally {
  if (child !== undefined) {
    child.kill('SIGTERM')
    await sleep(300)
    if (child.exitCode === null) child.kill('SIGKILL')
  }
  if (containerUp) {
    const down = run('docker', ['compose', '-p', PROJECT, '--env-file', ENV_DST, '-f', join(REPO, 'docker-compose.yml'), '-f', OVERRIDE, 'down'], { timeout: 300_000 })
    c.note(`清理：compose -p ${PROJECT} down → EXIT=${down.exit}（bind 数据根保留 ${TARGET}）`)
  }
}