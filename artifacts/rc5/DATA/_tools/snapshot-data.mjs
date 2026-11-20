#!/usr/bin/env node
// 数据面快照（DATA-007 重启前后比对）：文件计数/字节、关键 DB 行数、令牌/配置指纹。
// 用法: node snapshot-data.mjs <root> [--json out]
// 只读：DB(+wal/shm) 复制到 /tmp 后查询，绝不写源目录。
import { createHash } from 'node:crypto'
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

const root = resolve(process.argv[2] ?? '/data')
const jsonIdx = process.argv.indexOf('--json')
const jsonOut = jsonIdx >= 0 ? process.argv[jsonIdx + 1] : null
const tmpRoot = '/tmp/p6b-snapshot'
rmSync(tmpRoot, { recursive: true, force: true })
mkdirSync(tmpRoot, { recursive: true })

function walk(dir, out = [], depth = 0) {
  let entries
  try { entries = readdirSync(dir, { withFileTypes: true }) } catch { return out }
  if (depth > 14) return out
  for (const e of entries) {
    const p = join(dir, e.name)
    if (e.isDirectory()) walk(p, out, depth + 1)
    else if (!e.isSymbolicLink()) out.push(p)
  }
  return out
}
const files = walk(root)
let bytes = 0
for (const f of files) { try { bytes += statSync(f).size } catch {} }
const under = (prefix) => files.filter((f) => relative(root, f).startsWith(prefix))

const sha = (p) => { try { return createHash('sha256').update(readFileSync(p)).digest('hex') } catch { return null } }

function dbCopy(rel) {
  const src = join(root, rel)
  if (!existsSync(src)) return null
  const dir = join(tmpRoot, rel.replace(/[^a-zA-Z0-9_.-]/g, '_'))
  mkdirSync(dir, { recursive: true })
  const dst = join(dir, 'db.sqlite')
  copyFileSync(src, dst)
  for (const s of ['-wal', '-shm']) if (existsSync(src + s)) copyFileSync(src + s, dst + s)
  const db = new DatabaseSync(dst)
  try { return db } catch { return null }
}
const count = (rel, sql) => {
  const db = dbCopy(rel)
  if (!db) return null
  try { return db.prepare(sql).get().c } catch { return null } finally { db.close() }
}

const profilesDir = join(root, 'profiles')
const profiles = existsSync(profilesDir) ? readdirSync(profilesDir).sort() : []
const profileInfo = {}
for (const p of profiles) {
  const pkg = join(profilesDir, p, 'package.json')
  const patch = join(profilesDir, p, 'cordis.patch.yml')
  let bundles = null
  try { bundles = JSON.parse(readFileSync(pkg, 'utf8'))?.dsh?.profile?.bundles?.length ?? null } catch {}
  profileInfo[p] = {
    packageJson: existsSync(pkg) ? { bytes: statSync(pkg).size, sha256: sha(pkg) } : null,
    patch: existsSync(patch) ? { bytes: statSync(patch).size, sha256: sha(patch) } : null,
    bundles,
  }
}

const sessionsFiles = under('sessions/')
const storageFiles = under('storages/')
const agentsFiles = under('agents/')

const report = {
  root,
  files: files.length,
  bytes,
  sessions: { files: sessionsFiles.length, bytes: sessionsFiles.reduce((a, f) => a + (statSync(f).size), 0) },
  storages: { files: storageFiles.length },
  agents: { files: agentsFiles.length },
  db: {
    users: count('access/users.db', 'SELECT COUNT(*) AS c FROM users'),
    accessSessions: count('access/users.db', 'SELECT COUNT(*) AS c FROM sessions'),
    workspaces: count('access/users.db', 'SELECT COUNT(*) AS c FROM workspaces'),
    approvals: count('access/users.db', 'SELECT COUNT(*) AS c FROM approvals'),
    notifications: count('access/users.db', 'SELECT COUNT(*) AS c FROM notifications'),
    userPlugins: count('access/users.db', 'SELECT COUNT(*) AS c FROM user_plugins'),
    memoryEntities: count('.eterna/memory.sqlite3', 'SELECT COUNT(*) AS c FROM memory_entity'),
    memoryDomains: count('.eterna/memory.sqlite3', 'SELECT COUNT(*) AS c FROM domain_registry'),
    knowledgePermissions: count('knowledge-admin/access.sqlite3', 'SELECT COUNT(*) AS c FROM knowledge_permissions'),
    workspaceMemoryEntities: count('workspaces/Mr.Ma/.eterna/memory.sqlite3', 'SELECT COUNT(*) AS c FROM memory_entity'),
    tasksTickets: count('workspaces/Mr.Ma/.eterna/tasks.sqlite3', 'SELECT COUNT(*) AS c FROM ticket'),
    tasksThreads: count('workspaces/Mr.Ma/.eterna/tasks.sqlite3', 'SELECT COUNT(*) AS c FROM thread'),
  },
  secretFiles: {
    credentials: existsSync(join(root, '.credentials.yaml')) ? { mode: (statSync(join(root, '.credentials.yaml')).mode & 0o777).toString(8) } : null,
    relayToken: existsSync(join(root, 'relay-token')) ? { sha256: sha(join(root, 'relay-token')), bytes: statSync(join(root, 'relay-token')).size } : null,
  },
  profiles: profileInfo,
  topLevel: readdirSync(root).sort(),
}
const text = JSON.stringify(report, null, 2)
process.stdout.write(text + '\n')
if (jsonOut) writeFileSync(jsonOut, text + '\n')