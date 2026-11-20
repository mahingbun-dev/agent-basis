// 探针：抓一次导入的 outcome.sessionIds，并回查 access 库（只读）。
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { bootTokenFromContainer, bootstrapDshSession, defaultPaths, loadAccounts, login, request } from '../../../../scripts/rc5-test-client.mjs'

const args = defaultPaths()
const accounts = loadAccounts(args.accountsFile)
const dshCookie = await bootstrapDshSession(args.base, bootTokenFromContainer(args.container))
const authB = await login(args.base, accounts.user_b.account, accounts.user_b.password)
const cookieB = `${dshCookie}; ${authB.cookie}`

function readDb(sql, params = []) {
  const code = `const {DatabaseSync}=require('node:sqlite');const db=new DatabaseSync(${JSON.stringify(join(args.dataRoot, 'access', 'users.db'))},{readOnly:true});process.stdout.write(JSON.stringify(db.prepare(${JSON.stringify(sql)}).all(...${JSON.stringify(params)})))`
  const r = spawnSync(process.execPath, ['-e', code], { encoding: 'utf8' })
  if (r.status !== 0) throw new Error(r.stderr)
  return JSON.parse(r.stdout)
}
const ws = readDb('SELECT workspace_id, owner_id FROM workspaces').find(row => row.owner_id === 2).workspace_id
const archive = readFileSync('tests/fixtures/chat-import/deepseek-export-11.zip')
const url = new URL(`/api/deepseek-chat-import/archive?workspaceId=${encodeURIComponent(ws)}`, args.base)
const res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/octet-stream', accept: 'application/x-ndjson', cookie: cookieB }, body: archive })
const text = await res.text()
let outcome
for (const line of text.split('\n')) { try { const p = JSON.parse(line); if (p?.type === 'outcome') outcome = p.outcome } catch {} }
console.log('status', res.status, 'ok', outcome?.ok, 'ids', (outcome?.value?.sessionIds ?? []).length)
const ids = outcome?.value?.sessionIds ?? []
console.log('ids-sample', ids.slice(0, 3).join(','), '...')
await new Promise(r => setTimeout(r, 1500))
const found = ids.map(id => ({ id, row: readDb('SELECT session_id, owner_id, workspace_id FROM sessions WHERE session_id = ?', [id])[0] ?? null }))
console.log('in-db', found.filter(f => f.row !== null).length, '/', ids.length)
for (const f of found.slice(0, 4)) console.log(f.id, '=>', JSON.stringify(f.row))
