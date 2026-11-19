/**
 * 文件库多连接前提:WAL + busy_timeout。
 *
 * 知识库管理面用一个池 + review 临时 backend + 只读计数同时打开同一个
 * knowledge.sqlite3;rollback journal 下第二个写连接会立刻 SQLITE_BUSY。
 * 这里钉住 WikiIndexer 的打开参数,防止后续重构把 pragma 丢掉。
 */
import * as nodeFs from 'node:fs'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { afterEach, describe, expect, it } from 'vitest'
import { WikiLocalBackend, createNodeFsAdapter } from '../src/index.ts'

let dir: string | undefined

afterEach(() => {
  if (dir !== undefined) rmSync(dir, { recursive: true, force: true })
  dir = undefined
})

describe('WikiIndexer 文件库打开参数', () => {
  it('journal_mode=wal(多连接共存前提;busy_timeout 为同连接参数)', () => {
    dir = mkdtempSync(join(tmpdir(), 'eterna-kb-wal-'))
    const dbPath = join(dir, 'knowledge.sqlite3')
    const backend = new WikiLocalBackend({
      wikiDir: join(dir, 'knowledge.wiki'),
      dbPath,
      fs: createNodeFsAdapter(nodeFs),
    })
    try {
      const db = new DatabaseSync(dbPath)
      try {
        const journal = db.prepare('PRAGMA journal_mode').get() as { journal_mode?: unknown }
        expect(journal.journal_mode).toBe('wal')
      } finally {
        db.close()
      }
    } finally {
      backend.dispose()
    }
  })

  it(':memory: 不尝试 WAL(仍可正常建表)', async () => {
    const backend = new WikiLocalBackend({
      wikiDir: join(tmpdir(), 'eterna-kb-memory-wiki'),
      fs: createNodeFsAdapter(nodeFs),
    })
    try {
      const health = await backend.health()
      expect(health.doc_count).toBe(0)
    } finally {
      backend.dispose()
    }
  })
})
