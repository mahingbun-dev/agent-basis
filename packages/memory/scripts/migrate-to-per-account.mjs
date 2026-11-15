#!/usr/bin/env node
/**
 * 全局记忆库 → per-account 分库迁移(23 号 M-T3,一次性):
 * 读全局库(/data/.eterna/memory.sqlite3)的 live 行,按 origin_session_id →
 * access users.db(sessions.session_id→owner_id→users.account)归属账号,写入
 * `<tenantRoot>/<account>/.eterna/memory.sqlite3`;无法归属的行留在全局库只读
 * 归档(不进任何账号路由)。domain_registry/portrait 不迁移(域随账号重生长、
 * 画像由 Dream 再生成)。
 *
 * 用法:
 *   node scripts/migrate-to-per-account.mjs [--apply] \
 *     [--global-db <路径>] [--access-db <路径>] [--tenant-root <目录>]
 * 缺省:<cwd>/.eterna/memory.sqlite3、<cwd>/access/users.db、<cwd>/workspaces。
 * dry-run(缺省)只打印归属统计;`--apply` 才写入。迁移前先对卷做快照
 * (23 §Q4:一次性切换,不双写;卷快照可回滚)。
 */
import { existsSync, mkdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

const args = process.argv.slice(2)
const apply = args.includes('--apply')
const argOf = (name) => {
  const index = args.indexOf(name)
  return index >= 0 ? args[index + 1] : undefined
}

const cwd = process.cwd()
const globalDbPath = argOf('--global-db') ?? join(cwd, '.eterna', 'memory.sqlite3')
const accessDbPath = argOf('--access-db') ?? join(cwd, 'access', 'users.db')
const tenantRoot = argOf('--tenant-root') ?? join(cwd, 'workspaces')

if (!existsSync(globalDbPath)) {
  console.error(`[memory] 全局库不存在:${globalDbPath}`)
  process.exit(1)
}
if (!existsSync(accessDbPath)) {
  console.error(`[memory] access 库不存在:${accessDbPath}(账号归属的唯一事实源)`)
  process.exit(1)
}

const access = new DatabaseSync(accessDbPath, { readOnly: true })
const sessionAccount = new Map()
for (const row of access.prepare(
  'SELECT s.session_id AS sid, u.account AS account FROM sessions s JOIN users u ON u.id = s.owner_id',
).all()) {
  sessionAccount.set(row.sid, row.account)
}
access.close()

const global = new DatabaseSync(globalDbPath, { readOnly: true })
let rows
try {
  rows = global.prepare(
    'SELECT id, subject, key, content, summary, valid_at, invalid_at, confidence, created_at, updated_at,'
    + " kind, scope, domain_key, review_state, origin_session_id, origin_turn_ref, source, last_used_at, use_count"
    + ' FROM memory_entity WHERE invalid_at IS NULL',
  ).all()
} catch {
  console.error('[memory] 全局库缺 M-M1 增列(kind/scope/review_state 等)——先以 0.1.1 镜像开一次库完成迁移再跑本脚本')
  process.exit(1)
}
global.close()

// 归属:origin_session_id → 账号;无法归属 → archive(留在全局库)
const byAccount = new Map()
let archived = 0
for (const row of rows) {
  const account = sessionAccount.get(row.origin_session_id ?? '')
  if (account === undefined) {
    archived += 1
    continue
  }
  if (!byAccount.has(account)) byAccount.set(account, [])
  byAccount.get(account).push(row)
}

if (!apply) {
  console.log(`[memory] dry-run:live 行 ${rows.length},可归属账号 ${byAccount.size} 个,归档(无法归属)${archived}`)
  for (const [account, list] of byAccount) console.log(`  ${account}: ${list.length} 行 → ${join(tenantRoot, account, '.eterna', 'memory.sqlite3')}`)
  console.log('[memory] 确认无误后加 --apply 执行写入;迁移前请先对数据卷做快照(23 §Q4)。')
  process.exit(0)
}

if (!byAccount.has('') && byAccount.size === 0) {
  console.log('[memory] 无可迁移行,结束')
  process.exit(0)
}

const { EntityMemoryStore } = await import('/repo/packages/memory/src/entity-store.ts').catch(
  () => import('../src/entity-store.ts'),
)

let migrated = 0
for (const [account, list] of byAccount) {
  const dir = join(tenantRoot, account, '.eterna')
  mkdirSync(dir, { recursive: true })
  const dbFile = join(dir, 'memory.sqlite3')
  const store = new EntityMemoryStore(dbFile)
  try {
    for (const row of list) {
      // 审批语义保持:approved→approved;pending 仍待审(面板队列继续可见)
      store.write({
        subject: row.subject,
        key: row.key,
        content: row.content,
        ...(row.summary !== null ? { summary: row.summary } : {}),
        validAt: row.valid_at,
        confidence: row.confidence,
        kind: row.kind,
        scope: row.scope === 'legacy-org' ? 'domain' : row.scope,
        ...(row.domain_key !== null ? { domainKey: row.domain_key } : {}),
        reviewState: row.review_state,
        ...(row.origin_session_id !== null ? { originSessionId: row.origin_session_id } : {}),
        ...(row.origin_turn_ref !== null ? { originTurnRef: row.origin_turn_ref } : {}),
        source: row.source,
      })
      migrated += 1
    }
  } finally {
    store.close()
  }
  console.log(`[memory] ${account}:写入 ${list.length} 行 → ${dbFile}`)
}

// 迁移完成后把全局库改名归档(路由面不再读它;物理留档可审计)。
// 2026-11-16 修复:WAL 模式下数据可能仍在 -wal 未 checkpoint——**三件一起 rename**
// (主文件+-wal+-shm),只 rename 主文件会把 WAL 留在原位导致归档库缺数据表
// (生产 0.1.2 首次迁移实测:归档库 sqlite_master 为空)。
const archivePath = `${globalDbPath}.migrated-${Date.now()}`
try {
  readFileSync(globalDbPath) // 触发存在性检查
  const { renameSync } = await import('node:fs')
  renameSync(globalDbPath, archivePath)
  for (const suffix of ['-wal', '-shm']) {
    if (existsSync(globalDbPath + suffix)) renameSync(globalDbPath + suffix, archivePath + suffix)
  }
  console.log(`[memory] 全局库已归档:${archivePath}(含 -wal/-shm;归档行 ${archived} 无法归属,只读留档)`)
} catch (error) {
  console.log(`[memory] 全局库归档改名失败,保留原名(路由面不再读取):${error instanceof Error ? error.message : String(error)}`)
}
console.log(`[memory] 迁移完成:共 ${migrated} 行 → ${byAccount.size} 个账号库`)
