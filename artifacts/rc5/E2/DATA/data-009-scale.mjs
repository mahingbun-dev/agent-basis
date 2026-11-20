#!/usr/bin/env node
/**
 * DATA-009 规模补证：macOS bind（FUSE）下 ≥50 并发会话 × 24h + 每 2h 全库 integrity。
 *
 * 依据：48 §4.5「注入并发读写（≥50 会话、持续 24h），每 2h 对 users.db、
 * .eterna 与 workspaces/<ws>/.eterna 下的 sqlite3 跑 PRAGMA integrity_check；
 * 观察容器日志有无 SQLITE_BUSY/database is locked 异常升高」。
 *
 * 与 scripts/soak-rc5.mjs 的差别：
 *   - writers=50（脚本上限 8 的专用长跑改为本脚本，50 并发写 burst）；
 *   - 每 60s 50 并发 session/page 读；每 5min 50 并发 session/create 写；
 *   - 每 2h 全库 integrity（users.db + .eterna + workspaces/* + knowledge-admin）；
 *   - 独立容器/数据根（3244/9344），不碰 e1 浸泡与生产。
 *
 * 用法（后台）：
 *   node artifacts/rc5/E2/DATA/data-009-scale.mjs --duration 24h
 * 产物：artifacts/rc5/E2/DATA/scale/（meta.json、ticks.jsonl、run.log、summary.json、result.md）
 */
import { spawnSync } from 'node:child_process'
import {
  appendFileSync, chmodSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync,
} from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import { homedir } from 'node:os'
import { join } from 'node:path'

import {
  bootTokenFromContainer, bootstrapDshSession, loadAccounts, login, parseArgs, redact, rpc, shape,
} from '../../../../scripts/rc5-test-client.mjs'

const REPO = join(homedir(), 'code', 'agent-basis-rc5')
const TEST_ROOT = join(homedir(), 'eterna-data', 'test-rc5')
const DATA_ROOT = join(TEST_ROOT, 'scale')
const ENV_DST = join(TEST_ROOT, '.env.scale')
const PROJECT = 'rc5-scale'
const CONTAINER = 'eterna-rc5-scale'
const PORT = 3244
const RELAY = 9344
const BASE = `http://127.0.0.1:${PORT}`
const IMAGE = 'eterna-agent:rc5-test'
const OUT = join(REPO, 'artifacts', 'rc5', 'E2', 'DATA', 'scale')

const args = parseArgs(process.argv.slice(2), {
  duration: '24h',
  writers: '50',
  'read-interval': '60s',
  'write-interval': '300s',
  'db-interval': '2h',
})
const DURATION_SECONDS = parseDuration(args.duration)
const WRITERS = Number.parseInt(String(args.writers), 10)
const READ_INTERVAL = parseDuration(args['read-interval'])
const WRITE_INTERVAL = parseDuration(args['write-interval'])
const DB_INTERVAL = parseDuration(args['db-interval'])
if (DURATION_SECONDS < 3600 || WRITERS < 50) {
  console.error('duration ≥1h、writers ≥50（48 §4.5）')
  process.exit(2)
}

function parseDuration(value) {
  const match = /^(\d+)(s|m|h)$/.exec(String(value))
  if (match === null) {
    console.error(`无法解析时长: ${value}`)
    process.exit(2)
  }
  const n = Number(match[1])
  return match[2] === 'h' ? n * 3600 : match[2] === 'm' ? n * 60 : n
}

function log(line) {
  const text = `[${new Date().toISOString()}] ${line}`
  appendFileSync(join(OUT, 'run.log'), `${text}\n`)
  console.log(text)
}

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

function run(cmd, argv, options = {}) {
  return spawnSync(cmd, argv, { encoding: 'utf8', timeout: 300_000, maxBuffer: 32 * 1024 * 1024, ...options })
}

mkdirSync(OUT, { recursive: true })
mkdirSync(DATA_ROOT, { recursive: true, mode: 0o700 })

const accounts = JSON.parse(readFileSync(join(TEST_ROOT, '.test-accounts.json'), 'utf8'))
const e1 = envMap(join(TEST_ROOT, '.env.e1'))
const env = {
  ETERNA_DATA_ROOT: TEST_ROOT,
  ETERNA_INSTANCE: 'scale',
  ETERNA_PORT: String(PORT),
  ETERNA_RELAY_PORT: String(RELAY),
  ETERNA_CONTAINER_NAME: CONTAINER,
  ETERNA_IMAGE: IMAGE,
  ETERNA_FORM: 'web',
  ETERNA_TRUSTED_HOST: `127.0.0.1:${PORT} localhost:${PORT}`,
  MIMO_API_KEY: 'scale-placeholder-not-a-secret',
  ETERNA_ACCESS_ADMIN_USER: accounts.admin.account,
  ETERNA_ACCESS_ADMIN_PASSWORD: accounts.admin.password,
  ETERNA_ACCESS_SECRET: e1.ETERNA_ACCESS_SECRET,
}
writeFileSync(ENV_DST, Object.entries(env).map(([k, v]) => `${k}=${v}`).join('\n') + '\n', { mode: 0o600 })
chmodSync(ENV_DST, 0o600)

const compose = ['compose', '-p', PROJECT, '--env-file', ENV_DST, '-f', join(REPO, 'docker-compose.yml')]
let up
if (run('docker', ['inspect', CONTAINER]).status === 0) {
  up = run('docker', ['start', CONTAINER])
  log(`复用既有容器（docker start）EXIT=${up.status}`)
} else {
  up = run('docker', [...compose, 'up', '-d', '--no-build', 'eterna-agent'])
  log(`compose up EXIT=${up.status} ${shape(`${up.stdout}\n${up.stderr}`, 200)}`)
}
let health = 'unknown'
for (let attempt = 0; attempt < 120; attempt += 1) {
  health = run('docker', ['inspect', CONTAINER, '--format', '{{.State.Health.Status}}']).stdout.trim()
  if (health === 'healthy' || health === 'unhealthy') break
  await new Promise(resolve => setTimeout(resolve, 2000))
}
if (health !== 'healthy') {
  log(`容器未 healthy（${health}），退出`)
  process.exit(1)
}

const startedAt = Date.now()
const meta = {
  tag: 'data-009-scale',
  startedAt: new Date(startedAt).toISOString(),
  plannedSeconds: DURATION_SECONDS,
  plannedEndAt: new Date(startedAt + DURATION_SECONDS * 1000).toISOString(),
  container: CONTAINER,
  dataRoot: DATA_ROOT,
  base: BASE,
  image: run('docker', ['inspect', CONTAINER, '--format', '{{.Image}}']).stdout.trim(),
  writers: WRITERS,
  readIntervalSeconds: READ_INTERVAL,
  writeIntervalSeconds: WRITE_INTERVAL,
  dbIntervalSeconds: DB_INTERVAL,
  requirement: '48 §4.5 ≥50 会话 24h + 每 2h 全库 integrity + SQLITE_BUSY/locked 扫描',
  logs: { ticks: join(OUT, 'ticks.jsonl'), run: join(OUT, 'run.log') },
}
writeFileSync(join(OUT, 'meta.json'), JSON.stringify(meta, null, 2) + '\n')

const dsh = await bootstrapDshSession(BASE, bootTokenFromContainer(CONTAINER))
const auth = await login(BASE, accounts.admin.account, accounts.admin.password)
const cookie = `${dsh}; ${auth.cookie}`
log(`admin 登录 status=${auth.status}`)

/** 50 个持久会话：先并发建 50 个，后续读面复用。 */
const sessions = []
const createOne = async () => {
  const result = await rpc(BASE, cookie, 'session/create', { request: {} }, { timeoutMs: 30_000 })
  if (result.ok !== true) throw new Error(`create failed: ${result.status} ${shape(result.error).slice(0, 120)}`)
  const id = result.value?.sessionId ?? result.value?.id
  if (typeof id !== 'string') throw new Error('create 未返回 sessionId')
  return id
}
log(`并发创建 ${WRITERS} 个基线会话 …`)
const created = await Promise.all(Array.from({ length: WRITERS }, async () => {
  try { return { ok: true, id: await createOne() } } catch (error) { return { ok: false, error: redact(String(error instanceof Error ? error.message : error)) } }
}))
for (const item of created) if (item.ok === true) sessions.push(item.id)
log(`基线会话 ${sessions.length}/${WRITERS}`)
if (sessions.length < WRITERS) {
  log('基线会话不足 50，退出（fail-closed）')
  process.exit(1)
}

/** 全库目标（48 §4.5）：users.db、.eterna 与 workspaces/<ws>/.eterna 下的 sqlite3。 */
function databaseFiles() {
  const files = [join(DATA_ROOT, 'access', 'users.db')]
  const pushDir = (dir, pattern = /\.sqlite3?$/) => {
    if (!existsSync(dir)) return
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.isFile() && pattern.test(entry.name)) files.push(join(dir, entry.name))
    }
  }
  pushDir(join(DATA_ROOT, '.eterna'))
  pushDir(join(DATA_ROOT, 'knowledge-admin'))
  pushDir(join(DATA_ROOT, 'storages'))
  const workspaces = join(DATA_ROOT, 'workspaces')
  if (existsSync(workspaces)) {
    for (const ws of readdirSync(workspaces, { withFileTypes: true })) {
      if (ws.isDirectory()) pushDir(join(workspaces, ws.name, '.eterna'))
    }
  }
  return [...new Set(files)].filter(file => existsSync(file))
}

function integrityOf(file) {
  try {
    const db = new DatabaseSync(file, { readOnly: true })
    try {
      const rows = db.prepare('PRAGMA integrity_check').all()
      const values = rows.map(row => Object.values(row)[0])
      let sessions
      if (file.endsWith(join('access', 'users.db'))) {
        try { sessions = db.prepare('SELECT count(*) AS n FROM sessions').get()?.n } catch { sessions = undefined }
      }
      return { file: file.slice(DATA_ROOT.length + 1), ok: values.includes('ok'), integrity: values, sessions }
    } finally {
      db.close()
    }
  } catch (error) {
    return { file: file.slice(DATA_ROOT.length + 1), ok: false, error: redact(String(error instanceof Error ? error.message : error)).slice(0, 160) }
  }
}

const ticks = []
let stopping = false
process.on('SIGTERM', () => { stopping = true })
process.on('SIGINT', () => { stopping = true })

const endsAt = startedAt + DURATION_SECONDS * 1000
let lastReadAt = 0
let lastWriteAt = 0
let lastDbAt = 0
let tick = 0
let totalReadOk = 0
let totalReadFail = 0
let totalWriteOk = 0
let totalWriteFail = 0
let lockMatchesTotal = 0
let integrityFailures = 0
let lastLockSampleAt = 0

while (Date.now() < endsAt && !stopping) {
  tick += 1
  const now = Date.now()
  const elapsed = Math.round((now - startedAt) / 1000)
  let read = undefined
  let write = undefined
  let databases = undefined
  let lockMatches = undefined

  if (now - lastReadAt >= READ_INTERVAL * 1000) {
    lastReadAt = now
    const outcomes = await Promise.all(sessions.map(async id => {
      try {
        const result = await rpc(BASE, cookie, 'session/page', { request: { address: { kind: 'session', sessionId: id }, maxMessages: 2 } }, { timeoutMs: 20_000 })
        return { ok: result.ok === true, status: result.status }
      } catch (error) {
        return { ok: false, error: redact(String(error instanceof Error ? error.message : error)).slice(0, 80) }
      }
    }))
    read = { ok: outcomes.filter(item => item.ok).length, failed: outcomes.filter(item => !item.ok).length }
    totalReadOk += read.ok
    totalReadFail += read.failed
  }

  if (now - lastWriteAt >= WRITE_INTERVAL * 1000) {
    lastWriteAt = now
    const outcomes = await Promise.all(Array.from({ length: WRITERS }, async () => {
      try { await createOne(); return { ok: true } } catch (error) { return { ok: false, error: redact(String(error instanceof Error ? error.message : error)).slice(0, 100) } }
    }))
    write = {
      ok: outcomes.filter(item => item.ok).length,
      failed: outcomes.filter(item => !item.ok).length,
      errors: [...new Set(outcomes.filter(item => !item.ok).map(item => item.error))].slice(0, 3),
    }
    totalWriteOk += write.ok
    totalWriteFail += write.failed
  }

  if (now - lastDbAt >= DB_INTERVAL * 1000) {
    lastDbAt = now
    databases = databaseFiles().map(integrityOf)
    integrityFailures += databases.filter(db => db.ok !== true).length
    const since = Math.max(120, Math.min(2 * DB_INTERVAL, Math.round((now - lastLockSampleAt) / 1000)))
    lastLockSampleAt = now
    const logs = run('docker', ['logs', '--since', `${since}s`, CONTAINER])
    const text = `${logs.stdout ?? ''}\n${logs.stderr ?? ''}`
    lockMatches = (text.match(/database is locked|SQLITE_BUSY/gi) ?? []).length
    lockMatchesTotal += lockMatches
  }

  const sample = { at: new Date(now).toISOString(), elapsedSeconds: elapsed, read, write, databases, lockMatches }
  ticks.push(sample)
  appendFileSync(meta.logs.ticks, JSON.stringify(sample) + '\n')
  log(`tick=${tick} read=${read === undefined ? '-' : `${read.ok}/${read.ok + read.failed}`} write=${write === undefined ? '-' : `${write.ok}/${write.ok + write.failed}`} db=${databases === undefined ? '-' : databases.map(db => `${db.file}:${db.ok ? 'ok' : 'FAIL'}`).join(',')} locks=${lockMatches ?? '-'}`)

  const remaining = endsAt - Date.now()
  if (remaining <= 0) break
  await new Promise(resolve => setTimeout(resolve, Math.min(30_000, remaining)))
}

const complete = Date.now() >= endsAt
const verdict = complete && totalReadFail === 0 && totalWriteFail === 0 && integrityFailures === 0 && lockMatchesTotal === 0 ? 'PASS' : complete ? 'FAIL' : 'NOTRUN'
const summary = {
  tag: 'data-009-scale',
  verdict,
  windowComplete: complete,
  startedAt: meta.startedAt,
  finishedAt: new Date().toISOString(),
  elapsedSeconds: Math.round((Date.now() - startedAt) / 1000),
  writers: WRITERS,
  baselineSessions: sessions.length,
  reads: { ok: totalReadOk, failed: totalReadFail },
  writes: { ok: totalWriteOk, failed: totalWriteFail },
  integrityFailures,
  lockMatches: lockMatchesTotal,
  ticks: ticks.length,
  container: CONTAINER,
  dataRoot: DATA_ROOT,
  image: meta.image,
}
writeFileSync(join(OUT, 'summary.json'), JSON.stringify(summary, null, 2) + '\n')

const down = run('docker', [...compose, 'down'])
log(`清理 compose down EXIT=${down.status}（数据根保留 ${DATA_ROOT}）`)

const lastDb = [...ticks].reverse().find(item => item.databases !== undefined)
writeFileSync(join(OUT, 'result.md'), [
  '# RC5-DATA-009-SCALE · ≥50 并发 24h + 每 2h 全库 integrity',
  '',
  `- 依据：48 §4.5（macOS bind/FUSE 门禁）`,
  `- 窗口：${meta.startedAt} → ${meta.plannedEndAt}（${DURATION_SECONDS}s）；实际 ${summary.elapsedSeconds}s`,
  `- 并发：${WRITERS} 个持久会话；读每 ${READ_INTERVAL}s、写每 ${WRITE_INTERVAL}s、全库 integrity 每 ${DB_INTERVAL}s`,
  `- 容器：\`${CONTAINER}\`，镜像 \`${meta.image}\`，数据根 \`${DATA_ROOT}\``,
  '',
  '## 结论',
  '',
  `**${verdict}**。windowComplete=${complete}；读失败=${totalReadFail}、写失败=${totalWriteFail}；integrity 失败=${integrityFailures}；SQLITE_BUSY/locked 命中=${lockMatchesTotal}。`,
  '',
  '## 明细',
  '',
  `- 读写总量：读 ${totalReadOk} 成功 / ${totalReadFail} 失败；写 ${totalWriteOk} 成功 / ${totalWriteFail} 失败`,
  `- 末次 integrity：${lastDb === undefined ? '无' : lastDb.databases.map(db => `${db.file}=${db.ok ? 'ok' : 'FAIL'}`).join('；')}`,
  `- 采样：\`${meta.logs.ticks}\`（${ticks.length} ticks）、运行日志 \`${meta.logs.run}\``,
  '',
  '## 判定',
  '',
  '- PASS 条件：窗口满 + 0 读写失败 + 0 integrity 失败 + 0 SQLITE_BUSY/locked。',
  '- 未满窗口一律 NOTRUN（不得用短时采样冒充 24h）。',
].join('\n'))
log(`完成 verdict=${verdict}）`)