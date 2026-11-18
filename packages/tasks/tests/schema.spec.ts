/**
 * schema 守卫(35 号 A11 验收门禁;34 号 §4-C migration 行 → 本仓 schema.spec)。
 *
 * 目标判据:旧库拒开(tooOld)、新库拒开(前向守卫)、★本仓 v1 建库幂等。
 * 本仓首版直接建 v1、不搬 SA 的 schema 10→11 迁移史(34 号 §2.3 schema 行),
 * 故「旧库」以低于 OLDEST_SCHEMA 的版本号模拟(schema=0),机制面与 SA 一致。
 */
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { afterEach, beforeEach, expect, it } from 'vitest'
import { KV, OLDEST_SCHEMA, SCHEMA_VERSION, Store } from '../src/index.ts'

const REALM = 'alice'
let directory: string
beforeEach(() => { directory = mkdtempSync(join(tmpdir(), 'tasks-schema-')) })
afterEach(() => { rmSync(directory, { recursive: true, force: true }) })
/** 直接改库里的 schema 版本号(模拟他版本写下的库)。 */
const rewrite = (version: number): void => {
  const db = new DatabaseSync(join(directory, REALM, '.eterna', 'tasks.sqlite3'))
  db.prepare("UPDATE kv SET value=? WHERE key='schema'").run(JSON.stringify(version))
  db.close()
}

it('拒绝早于 OLDEST_SCHEMA 的旧库,并请求换新状态目录(tooOld)', () => {
  new Store(REALM, { tenantRoot: directory }).close()
  rewrite(OLDEST_SCHEMA - 1)
  expect(() => new Store(REALM, { tenantRoot: directory })).toThrow(new RegExp(`schema ${OLDEST_SCHEMA - 1} 早于本版本可迁移的 schema ${OLDEST_SCHEMA}`))
})

it('拒绝新于本版本的库(前向守卫:未来版本写的库不误读)', () => {
  new Store(REALM, { tenantRoot: directory }).close()
  rewrite(SCHEMA_VERSION + 1)
  expect(() => new Store(REALM, { tenantRoot: directory })).toThrow(new RegExp(`不支持的 tasks 数据库版本 ${SCHEMA_VERSION + 1}`))
})

it('★本仓 v1 建库幂等:重开不改建、不丢数据、版本号稳定', () => {
  const first = new Store(REALM, { tenantRoot: directory })
  first.triggers.save({ id: 't1', source: 'chat', threads: [{ source: 'chat', id: 'c1' }], actor: { source: 'chat', id: 'u' }, human: true, at: '1', text: 'hi', meta: {} })
  first.saveSettings({ paused: true }, { source: 'panel', block: 'pause', policyVersion: 'v', policyChanged: false, notified: [] })
  first.close()
  const again = new Store(REALM, { tenantRoot: directory })
  expect(again.get(KV.store.schema)).toBe(SCHEMA_VERSION)
  expect(again.read.threadTriggers('chat:c1').map(trigger => trigger.id)).toEqual(['t1'])
  expect(again.settings()).toMatchObject({ paused: true })
  expect(again.blockRevision('pause')).toBe(1)
  again.close()
  // 第三次开库仍幂等(版本号不被重写抬升)。
  const third = new Store(REALM, { tenantRoot: directory })
  expect(third.get(KV.store.schema)).toBe(SCHEMA_VERSION)
  third.close()
})
