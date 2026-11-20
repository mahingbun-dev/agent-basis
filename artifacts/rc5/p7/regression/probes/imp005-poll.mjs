#!/usr/bin/env node
/**
 * T52 复跑：RC5-IMP-005（P0）入库属主核对，带轮询等待（官方脚本上传后立即读，
 * 记账异步导致假红；W5 已登记 P2 记账延迟）。本探针不改产品代码，只把「等 10s」
 * 补上，并逐条核对本轮返回的 sessionId 是否落库为 B 属主。
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import {
  bootTokenFromContainer,
  bootstrapDshSession,
  loadAccounts,
  login,
  parseArgs,
} from '/Users/sunny/code/agent-basis-rc5/scripts/rc5-test-client.mjs'

const args = parseArgs(process.argv.slice(2), {})
const BASE = String(args.base ?? 'http://127.0.0.1:3118')
const CONTAINER = String(args.container ?? 'rc5-e1suite')
const ACCOUNTS = String(args['accounts-file'] ?? `${process.env.HOME}/eterna-data/test-rc5/.test-accounts.json`)
const DATA_ROOT = String(args['data-root'] ?? `${process.env.HOME}/eterna-data/test-20261120/e1`)
const FIXTURE = '/Users/sunny/code/agent-basis-rc5/tests/fixtures/chat-import/deepseek-export-11.zip'

const accounts = loadAccounts(ACCOUNTS)
const db = new DatabaseSync(join(DATA_ROOT, 'access', 'users.db'), { readOnly: true })
const uidB = db.prepare('SELECT id FROM users WHERE account = ?').get(accounts.user_b.account)?.id
const wsB = db.prepare('SELECT workspace_id FROM workspaces WHERE owner_id = ?').all(uidB).map(row => row.workspace_id)
const target = wsB.find(id => id === '6fd0ca27-26be-443a-bab0-453b37a1e244') ?? wsB[0]

const dsh = await bootstrapDshSession(BASE, bootTokenFromContainer(CONTAINER))
const authB = await login(BASE, accounts.user_b.account, accounts.user_b.password)
const cookieB = `${dsh}; ${authB.cookie}`

const before = db.prepare('SELECT COUNT(*) AS n FROM sessions').get().n
const response = await fetch(new URL(`/api/deepseek-chat-import/archive?workspaceId=${encodeURIComponent(target)}`, BASE), {
  method: 'POST',
  headers: { 'content-type': 'application/octet-stream', accept: 'application/x-ndjson', cookie: cookieB },
  body: readFileSync(FIXTURE),
  signal: AbortSignal.timeout(180_000),
})
const text = await response.text()
let outcome
for (const line of text.split('\n').filter(line => line.trim() !== '')) {
  try {
    const parsed = JSON.parse(line)
    if (parsed?.type === 'outcome') outcome = parsed.outcome
  } catch {}
}
const ids = Array.isArray(outcome?.value?.sessionIds) ? outcome.value.sessionIds : []

let rows = []
for (let attempt = 0; attempt < 20; attempt++) {
  rows = []
  for (const id of ids) {
    const row = db.prepare('SELECT session_id, owner_id, workspace_id FROM sessions WHERE session_id = ?').get(id)
    if (row !== undefined) rows.push(row)
  }
  if (rows.length === ids.length) break
  await new Promise(done => setTimeout(done, 500))
}
const after = db.prepare('SELECT COUNT(*) AS n FROM sessions').get().n
const emptyOwner = rows.filter(row => typeof row.owner_id !== 'number' || row.owner_id <= 0)
const allB = rows.every(row => row.owner_id === uidB)

console.log(JSON.stringify({
  upload: { status: response.status, ok: outcome?.ok, sessionIds: ids.length, skipped: outcome?.value?.skipped?.length ?? 0 },
  targetWorkspace: target,
  polled: `${rows.length}/${ids.length}`,
  sessionRows: after - before,
  allOwnerB: allB,
  emptyOwner: emptyOwner.length,
  pass: ids.length === 10 && rows.length === 10 && allB && emptyOwner.length === 0,
}, null, 1))