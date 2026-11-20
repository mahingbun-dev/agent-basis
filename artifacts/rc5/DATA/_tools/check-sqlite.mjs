#!/usr/bin/env node
// 全库 SQLite 一致性检查（容器内运行；48 §7.5 口径）。
// 用法: node check-sqlite.mjs <root> [--json <path>] [--copy]
//   --copy  先把 DB(+ -wal/-shm) 复制到 /tmp 再检查（源目录可只读挂载）
// 输出 JSON: {root, checked, ok, fail[], dbs:[{path,bytes,wal,shm,journal,integrity,mode,copyOk}]}
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync, rmSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

const args = process.argv.slice(2)
const root = resolve(args[0] ?? '/data')
const jsonIdx = args.indexOf('--json')
const jsonPath = jsonIdx >= 0 ? args[jsonIdx + 1] : null
const useCopy = args.includes('--copy')

const MAGIC = 'SQLite format 3\u0000'

function walk(dir, out = [], depth = 0) {
  let entries
  try { entries = readdirSync(dir, { withFileTypes: true }) } catch { return out }
  if (depth > 12) return out
  for (const e of entries) {
    const p = join(dir, e.name)
    if (e.isDirectory()) walk(p, out, depth + 1)
    else if (e.isSymbolicLink()) {
      // 不跟随软链（迁移副本里大量链接指向容器内 /repo，跟过去无意义且可能越界）
      continue
    } else out.push(p)
  }
  return out
}

function isSqlite(file) {
  try {
    const fd = readFileSync(file, { flag: 'r' })
    return fd.subarray(0, 16).toString('latin1') === MAGIC
  } catch { return false }
}

const files = walk(root).filter(isSqlite)
const dbs = []
let ok = 0
const fail = []
const tmpRoot = '/tmp/p6b-sqlite-check'

for (const [i, file] of files.entries()) {
  const rel = relative(root, file)
  const rec = { path: rel, bytes: statSync(file).size, wal: 0, shm: 0 }
  try {
    const wal = `${file}-wal`; const shm = `${file}-shm`
    rec.wal = existsSync(wal) ? statSync(wal).size : 0
    rec.shm = existsSync(shm) ? statSync(shm).size : 0
    let target = file
    let dir = null
    if (useCopy) {
      dir = join(tmpRoot, String(i))
      mkdirSync(dir, { recursive: true })
      target = join(dir, 'db.sqlite')
      copyFileSync(file, target)
      if (existsSync(wal)) copyFileSync(wal, `${target}-wal`)
      if (existsSync(shm)) copyFileSync(shm, `${target}-shm`)
    }
    const db = new DatabaseSync(target)
    rec.journal = db.prepare('PRAGMA journal_mode').get()?.journal_mode ?? 'unknown'
    const rows = db.prepare('PRAGMA integrity_check').all()
    // integrity_check 多行返回；全部 "ok" 才算通过
    const vals = rows.map(r => Object.values(r)[0])
    rec.integrity = vals.every(v => v === 'ok') ? 'ok' : vals.join(';')
    db.close()
    if (dir) rmSync(dir, { recursive: true, force: true })
    dbs.push(rec)
    if (rec.integrity === 'ok') ok++
    else fail.push(rec)
  } catch (error) {
    rec.integrity = `error: ${error.message}`
    dbs.push(rec)
    fail.push(rec)
  }
}

const report = { root, checked: files.length, ok, fail: fail.length, failures: fail, dbs }
const text = JSON.stringify(report, null, 2)
process.stdout.write(text + '\n')
if (jsonPath) writeFileSync(jsonPath, text + '\n')
process.exit(fail.length === 0 && files.length > 0 ? 0 : 1)