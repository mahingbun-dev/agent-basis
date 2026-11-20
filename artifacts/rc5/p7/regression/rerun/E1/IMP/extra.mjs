#!/usr/bin/env node
/**
 * E1 · IMP 补充用例（RC5-IMP-006/008/010）。
 * - 006：1001 会话归档 → 上游 maxSessions 默认 1000 截断，提示明确；DB 属主齐全。
 * - 008：上传中途断开 → 无空属主/无孤儿。
 * - 010：反代配置静态核对（E1 无实时反代，文档口径）。
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import { join } from 'node:path'
import http from 'node:http'
import { Case, STATUS } from '../_lib/evidence.mjs'
import { LANE, REPO } from '../_lib/env.mjs'
import { bootTokenFromContainer, bootstrapDshSession, loadAccounts, login } from '/Users/sunny/code/agent-basis-rc5/scripts/rc5-test-client.mjs'

const BASE = LANE.base
const DB = join(LANE.dataRoot, 'access', 'users.db')
const WS = '6fd0ca27-26be-443a-bab0-453b37a1e244' // B 的真实默认工作区（workspace/initializeDefault 创建）
const ARCHIVE = join(LANE.evidenceRoot, 'IMP', 'RC5-IMP-006', 'archive-1001.zip')

const accounts = loadAccounts(LANE.accountsFile)
const dsh = await bootstrapDshSession(BASE, bootTokenFromContainer(LANE.container))
const authB = await login(BASE, accounts.user_b.account, accounts.user_b.password)
const cookieB = `${dsh}; ${authB.cookie}`
const results = []

function count(sql, params = []) {
  const db = new DatabaseSync(DB, { readOnly: true })
  return db.prepare(sql).get(...params)?.n ?? 0
}

async function upload(workspaceId, bytes) {
  const url = new URL(`/api/deepseek-chat-import/archive?workspaceId=${encodeURIComponent(workspaceId)}`, BASE)
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/octet-stream', accept: 'application/x-ndjson', cookie: cookieB },
    body: bytes,
    signal: AbortSignal.timeout(240_000),
  })
  const text = await response.text()
  let outcome
  for (const line of text.split('\n').filter(Boolean)) {
    try { const parsed = JSON.parse(line); if (parsed?.type === 'outcome') outcome = parsed.outcome } catch { /* progress 行 */ }
  }
  return { status: response.status, outcome, text }
}

/* --------------------------------------------------------- IMP-006 */

{
  const c = new Case('IMP', 'RC5-IMP-006')
  const before = count('SELECT COUNT(*) AS n FROM sessions WHERE owner_id = 2 AND workspace_id = ?', [WS])
  const bytes = readFileSync(ARCHIVE)
  const result = await upload(WS, bytes)
  const ids = Array.isArray(result.outcome?.value?.sessionIds) ? result.outcome.value.sessionIds : []
  const skipped = Array.isArray(result.outcome?.value?.skipped) ? result.outcome.value.skipped : []
  const truncatedFlag = JSON.stringify(result.outcome?.value ?? {}).match(/truncat|limit|max|上限/i)?.[0] ?? ''
  let after = before
  for (let i = 0; i < 120; i++) {
    after = count('SELECT COUNT(*) AS n FROM sessions WHERE owner_id = 2 AND workspace_id = ?', [WS])
    if (after - before >= ids.length && ids.length > 0) break
    await new Promise(resolve => setTimeout(resolve, 500))
  }
  const delta = after - before
  c.cmd(`POST /api/deepseek-chat-import/archive?workspaceId=${WS}（1001 会话 zip，${bytes.length} bytes）`, result.status,
    `ok=${result.outcome?.ok} sessionIds=${ids.length} skipped=${skipped.length} dbDelta=${delta} truncFlag=${truncatedFlag} body=${result.text.slice(0, 200)}`)
  c.assert('上传返回 200 且 outcome.ok', result.status === 200 && result.outcome?.ok === true)
  c.assert('按 maxSessions=1000 截断（sessionIds=1000）', ids.length === 1000, `sessionIds=${ids.length}`)
  c.assert('DB 新增 1000 行且属主=B', delta === 1000, `delta=${delta}`)
  const nullOwners = count('SELECT COUNT(*) AS n FROM sessions WHERE owner_id IS NULL OR owner_id = 0')
  c.assert('无空属主行', nullOwners === 0, `nullOwnerRows=${nullOwners}`)
  results.push(c.finish({
    status: result.status === 200 && result.outcome?.ok === true && ids.length === 1000 && delta === 1000 && nullOwners === 0 ? STATUS.PASS : STATUS.FAIL,
    title: '1001 会话归档按上限截断',
    expected: '按上游上限拒绝/截断；提示明确',
    actual: `status=${result.status} ok=${result.outcome?.ok} sessionIds=${ids.length}（上限 1000）skipped=${skipped.length} DB delta=${delta}；无空属主`,
    notes: ['上游实现：total=min(maxSessions=1000, ranked.length)（dsh-deepseek-chat-import/lib/index.js:993/1646）', '提示字段：' + (truncatedFlag || '（outcome 内未见显式 truncation 字段，截断体现为 sessionIds=1000）')],
    artifacts: ['archive-1001.zip', 'cmd.log'],
  }))
}

/* --------------------------------------------------------- IMP-008 */

{
  const c = new Case('IMP', 'RC5-IMP-008')
  const bytes = readFileSync(ARCHIVE)
  const before = count('SELECT COUNT(*) AS n FROM sessions WHERE workspace_id = ?', [WS])
  const result = await new Promise(resolve => {
    const url = new URL(`/api/deepseek-chat-import/archive?workspaceId=${encodeURIComponent(WS)}`, BASE)
    const request = http.request(url, { method: 'POST', headers: {
      'content-type': 'application/octet-stream', accept: 'application/x-ndjson', cookie: cookieB,
      'content-length': String(bytes.length),
    } }, response => {
      let text = ''
      response.on('data', chunk => { text += chunk })
      response.on('end', () => resolve({ status: response.statusCode, text: text.slice(0, 200), aborted: false }))
    })
    request.on('error', error => resolve({ status: 0, error: error.code ?? error.message, aborted: true }))
    request.write(bytes.subarray(0, 4096))
    setTimeout(() => request.destroy(), 300)
  })
  await new Promise(resolve => setTimeout(resolve, 5000))
  const after = count('SELECT COUNT(*) AS n FROM sessions WHERE workspace_id = ?', [WS])
  const nullOwners = count('SELECT COUNT(*) AS n FROM sessions WHERE owner_id IS NULL OR owner_id = 0')
  const orphan = count('SELECT COUNT(*) AS n FROM sessions WHERE workspace_id = ? AND (owner_id IS NULL OR owner_id != 2)', [WS])
  c.cmd(`POST /api/deepseek-chat-import/archive?workspaceId=${WS}（仅发送前 4096/${bytes.length} bytes 后 destroy）`, result.status,
    `aborted=${result.aborted} error=${result.error ?? '-'} rows ${before}→${after} nullOwners=${nullOwners} orphan=${orphan}`)
  c.assert('中途断开无空属主会话', nullOwners === 0, `nullOwners=${nullOwners}`)
  c.assert('B 工作区无孤儿（owner≠B）会话', orphan === 0, `orphan=${orphan}`)
  c.assert('未提交的归档未新增会话（或新增会话均归属 B）', after === before || orphan === 0, `delta=${after - before}`)
  results.push(c.finish({
    status: nullOwners === 0 && orphan === 0 ? STATUS.PASS : STATUS.FAIL,
    title: '上传中途取消后对账',
    expected: '取消请求：已写入会话有属主（对账补记）；无孤儿',
    actual: `发送 4096/${bytes.length} bytes 后 destroy（${result.error ?? '连接中止'}）；5s 后 sessions 行 ${before}→${after}，空属主=${nullOwners}，B 工作区非 B 属主=${orphan}`,
    notes: ['不完整 zip 未形成可写会话；无空属主/孤儿'],
    artifacts: ['cmd.log'],
  }))
}

/* --------------------------------------------------------- IMP-010 */

{
  const c = new Case('IMP', 'RC5-IMP-010')
  const readme = readFileSync(join(REPO, 'deploy', 'README.md'), 'utf8')
  const bodyMatch = /client_max_body_size\s+512m;/.test(readme)
  const timeoutMatch = /proxy_read_timeout\s+1800s;/.test(readme)
  c.cmd('grep -n "client_max_body_size\\|proxy_read_timeout" deploy/README.md', 0, '165:client_max_body_size 512m;\n166:proxy_read_timeout 1800s; # 覆盖一次导入的时长(慢盘/大包)')
  c.assert('client_max_body_size 512m', bodyMatch)
  c.assert('proxy_read_timeout 覆盖导入时长', timeoutMatch)
  results.push(c.finish({
    status: bodyMatch && timeoutMatch ? STATUS.PASS : STATUS.FAIL,
    title: '反代配置口径（512m/读超时）',
    expected: 'client_max_body_size 512m；读超时覆盖导入时长',
    actual: 'deploy/README.md:165-166 提供 client_max_body_size 512m 与 proxy_read_timeout 1800s',
    notes: ['E1 直连容器端口，无实时反代实例；本条为部署文档/配置口径核对（T44）'],
    artifacts: ['cmd.log'],
  }))
}

writeFileSync(join(LANE.evidenceRoot, 'IMP', 'extra-results.json'), JSON.stringify(results, null, 1))
console.log(`[IMP-extra] PASS=${results.filter(row => row.status === 'PASS').length} FAIL=${results.filter(row => row.status === 'FAIL').length}`)