#!/usr/bin/env node
/**
 * T52 复跑诊断探针：复现 chat-import 上传并打印 outcome（脱敏，无 cookie 值）。
 * 只读/单次写，目标为测试容器（默认 3118/rc5-e1suite）。
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
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
const dsh = await bootstrapDshSession(BASE, bootTokenFromContainer(CONTAINER))
const authB = await login(BASE, accounts.user_b.account, accounts.user_b.password)
const cookieB = `${dsh}; ${authB.cookie}`

const { execFileSync } = await import('node:child_process')
const uidB = JSON.parse(execFileSync(process.execPath, ['-e', `
const {DatabaseSync}=require('node:sqlite');
const db=new DatabaseSync(${JSON.stringify(join(DATA_ROOT,'access','users.db'))},{readOnly:true});
process.stdout.write(JSON.stringify(db.prepare('SELECT id FROM users WHERE account=?').all(${JSON.stringify(accounts.user_b.account)})))`], { encoding: 'utf8' }))[0]?.id
const ws = JSON.parse(execFileSync(process.execPath, ['-e', `
const {DatabaseSync}=require('node:sqlite');
const db=new DatabaseSync(${JSON.stringify(join(DATA_ROOT,'access','users.db'))},{readOnly:true});
process.stdout.write(JSON.stringify(db.prepare('SELECT workspace_id,path FROM workspaces WHERE owner_id=?').all(${uidB})))`], { encoding: 'utf8' }))

console.log('login status=', authB.status, 'uidB=', uidB, 'workspaces=', ws.map(row => row.workspace_id).join(','))

for (const target of ws) {
  const url = new URL(`/api/deepseek-chat-import/archive?workspaceId=${encodeURIComponent(target.workspace_id)}`, BASE)
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/octet-stream', accept: 'application/x-ndjson', cookie: cookieB },
    body: readFileSync(FIXTURE),
    signal: AbortSignal.timeout(180_000),
  })
  const text = await response.text()
  const lines = text.split('\n').filter(line => line.trim() !== '')
  let outcome
  for (const line of lines) {
    try {
      const parsed = JSON.parse(line)
      if (parsed?.type === 'outcome') outcome = parsed.outcome
    } catch {}
  }
  console.log(JSON.stringify({
    status: response.status,
    workspaceId: target.workspace_id,
    path: target.path,
    lines: lines.length,
    firstLine: lines[0]?.slice(0, 300),
    outcome: outcome === undefined ? undefined : {
      ok: outcome.ok,
      error: outcome.error?.code,
      message: outcome.error?.message?.slice(0, 200),
      sessionIds: Array.isArray(outcome.value?.sessionIds) ? outcome.value.sessionIds.length : undefined,
      skipped: outcome.value?.skipped,
      raw: JSON.stringify(outcome).slice(0, 400),
    },
  }, null, 1))
}