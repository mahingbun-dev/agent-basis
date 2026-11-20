#!/usr/bin/env node
// FUSE 声明检查：在给定目录上验证 SQLite WAL/回滚日志、flock、并发写与崩溃恢复语义。
// 用法（容器内）: node fuse-sqlite-stress.mjs <dir> [--writers 8] [--ops 200] [--json out]
//   或 worker 模式（内部）: node fuse-sqlite-stress.mjs <dir> --worker <id> --ops <n>
// 输出 JSON：journalMode / writers 成功失败 / busytimeout 命中 / integrity / 崩溃恢复 / mmap。
import { spawn, spawnSync } from 'node:child_process'
import { mkdirSync, writeFileSync, existsSync, statSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

const dir = process.argv[2]
const workerIdx = process.argv.indexOf('--worker')
const isWorker = workerIdx >= 0
const getArg = (name, fallback) => {
  const i = process.argv.indexOf(name)
  return i >= 0 ? process.argv[i + 1] : fallback
}
const WRITERS = Number(getArg('--writers', '8'))
const OPS = Number(getArg('--ops', '200'))
const JSON_OUT = getArg('--json', null)
const BUSY_TIMEOUT = 5000

mkdirSync(dir, { recursive: true })

if (isWorker) {
  const id = Number(process.argv[workerIdx + 1])
  const db = new DatabaseSync(join(dir, 'wal.db'))
  db.exec(`PRAGMA busy_timeout=${BUSY_TIMEOUT}`)
  db.exec('PRAGMA journal_mode=WAL')
  db.exec('PRAGMA synchronous=NORMAL')
  let ok = 0, busy = 0, other = 0
  const errors = {}
  for (let i = 0; i < OPS; i++) {
    try {
      db.exec('BEGIN IMMEDIATE')
      db.prepare('INSERT INTO w(worker, seq, payload, at) VALUES (?,?,?,?)')
        .run(id, i, `w${id}-${i}-` + 'x'.repeat(64), Date.now())
      db.exec('COMMIT')
      ok++
    } catch (error) {
      try { db.exec('ROLLBACK') } catch {}
      if (/SQLITE_BUSY|database is locked/i.test(String(error.message))) busy++
      else other++
      errors[error.code ?? error.message.slice(0, 40)] = (errors[error.code ?? error.message.slice(0, 40)] ?? 0) + 1
    }
  }
  // 崩溃场景：在事务里写一半后直接 _exit（不 COMMIT/不 ROLLBACK），模拟进程被杀
  if (process.env.P6B_CRASH_AFTER_COMMIT === '1') {
    db.exec('BEGIN IMMEDIATE')
    db.prepare('INSERT INTO w(worker, seq, payload, at) VALUES (?,?,?,?)').run(999, 1, 'crash-row', Date.now())
    process.exit(97) // 未提交事务，进程退出 = 崩溃
  }
  db.close()
  process.stdout.write(JSON.stringify({ worker: id, ok, busy, other, errors }) + '\n')
  process.exit(0)
}

function newDb(path) {
  const db = new DatabaseSync(path)
  db.exec(`PRAGMA busy_timeout=${BUSY_TIMEOUT}`)
  db.exec('PRAGMA journal_mode=WAL')
  db.exec('PRAGMA synchronous=NORMAL')
  db.exec('CREATE TABLE IF NOT EXISTS w(id INTEGER PRIMARY KEY, worker INTEGER, seq INTEGER, payload TEXT, at INTEGER)')
  return db
}

const dbFile = join(dir, 'wal.db')
if (existsSync(dbFile)) rmSync(dbFile)
for (const suffix of ['-wal', '-shm']) { try { rmSync(dbFile + suffix) } catch {} }
const db = newDb(dbFile)
db.close()

const t0 = Date.now()
const children = []
for (let i = 0; i < WRITERS; i++) {
  children.push(new Promise((resolve) => {
    const child = spawn(process.execPath, [new URL(import.meta.url).pathname, dir, '--worker', String(i), '--ops', String(OPS)], { stdio: ['ignore', 'pipe', 'pipe'] })
    let out = ''
    child.stdout.on('data', (d) => { out += d })
    child.stderr.on('data', (d) => { out += d })
    child.on('exit', (code) => resolve({ code, out }))
  }))
}
const results = await Promise.all(children)
const elapsedMs = Date.now() - t0
const parsed = results.map((r) => { try { return JSON.parse(r.out.trim().split('\n').pop()) } catch { return { parseError: true, code: r.code, raw: r.out.slice(0, 200) } } })
const ok = parsed.reduce((a, r) => a + (r.ok ?? 0), 0)
const busy = parsed.reduce((a, r) => a + (r.busy ?? 0), 0)
const other = parsed.reduce((a, r) => a + (r.other ?? 0), 0)
const expected = WRITERS * OPS
const count = new DatabaseSync(dbFile).prepare('SELECT COUNT(*) AS c FROM w').get().c

// integrity + mmap + journal mode
const check = new DatabaseSync(dbFile)
const integrity = check.prepare('PRAGMA integrity_check').all().map((r) => Object.values(r)[0]).every((v) => v === 'ok') ? 'ok' : 'fail'
const journal = check.prepare('PRAGMA journal_mode').get().journal_mode
let mmap = -1
try { mmap = check.prepare('PRAGMA mmap_size=268435456').get().mmap_size ?? -1 } catch {}
const quick = check.prepare('PRAGMA quick_check').all().map((r) => Object.values(r)[0]).every((v) => v === 'ok') ? 'ok' : 'fail'
check.close()

// 崩溃恢复：worker 在未提交事务中退出
const crashFile = join(dir, 'crash.db')
for (const p of [crashFile, `${crashFile}-wal`, `${crashFile}-shm`]) { try { rmSync(p) } catch {} }
const cdb = new DatabaseSync(crashFile)
cdb.exec('PRAGMA journal_mode=WAL')
cdb.exec('CREATE TABLE IF NOT EXISTS w(id INTEGER PRIMARY KEY, v TEXT)')
cdb.close()
const crash = spawnSyncWorker(crashFile, dir)
const cdb2 = new DatabaseSync(crashFile)
const crashIntegrity = cdb2.prepare('PRAGMA integrity_check').all().map((r) => Object.values(r)[0]).every((v) => v === 'ok') ? 'ok' : 'fail'
const crashRows = cdb2.prepare('SELECT COUNT(*) AS c FROM w').get().c
cdb2.close()

function spawnSyncWorker(file, wdir) {
  return spawnSync(process.execPath, [new URL(import.meta.url).pathname, wdir, '--worker', '999', '--ops', '1'], { env: { ...process.env, P6B_CRASH_AFTER_COMMIT: '1' } })
}

const report = {
  dir,
  writers: WRITERS,
  opsPerWriter: OPS,
  expected,
  ok,
  busy,
  other,
  rows: count,
  elapsedMs,
  integrity,
  quickCheck: quick,
  journalMode: journal,
  mmapSize: mmap,
  walBytes: existsSync(`${dbFile}-wal`) ? statSync(`${dbFile}-wal`).size : 0,
  shmBytes: existsSync(`${dbFile}-shm`) ? statSync(`${dbFile}-shm`).size : 0,
  crash: { exit: crash.status, integrity: crashIntegrity, rows: crashRows },
  workerResults: parsed,
}
const text = JSON.stringify(report, null, 2)
process.stdout.write(text + '\n')
if (JSON_OUT) writeFileSync(JSON_OUT, text + '\n')
process.exit(integrity === 'ok' && quick === 'ok' && crashIntegrity === 'ok' && ok === expected && busy === 0 && other === 0 ? 0 : 1)