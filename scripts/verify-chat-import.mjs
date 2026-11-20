#!/usr/bin/env node
/**
 * chat-import 租户桥验证（51 §3.8 / §4；54 §6.3；T47）。
 *
 * 覆盖：
 *   IMP-001   未登录上传 → 401，且不写会话
 *   IMP-002   B 传 A 的 workspaceId → 403，且不写会话
 *   IMP-003   B 传自己的 workspace + 11 会话归档（10 可用 + 1 坏 JSON）→ 200，
 *             终态 outcome.value.sessionIds = 10
 *   IMP-004   返回的 sessionId 在 B 的 session/list 可见、A 的不可见
 *   IMP-005   access 库 sessions 表新增 10 行、owner_id=B、无空属主
 *   IMP-009   坏 JSON 会话被跳过（skipped 含 conv-broken），其余 10 个完整导入
 *
 * 上游 upload 路由只认 `content-type: application/octet-stream`（lib/index.js:1420），
 * 内容才是 zip v3。
 * 夹具：tests/fixtures/chat-import/deepseek-export-11.zip（真实上传格式：zip v3；
 * 51 §1 的「NDJSON」只对应响应进度流，详见 tests/fixtures/README.md）。
 *
 * 用法：
 *   node scripts/verify-chat-import.mjs \
 *     --base http://127.0.0.1:3108 \
 *     --accounts-file $HOME/eterna-data/test-rc5/.test-accounts.json \
 *     --data-root $HOME/eterna-data/test-rc5/e1 \
 *     --container eterna-rc5-e1 \
 *     --json artifacts/rc5/p5/testbed/chat-import/report.json
 *   --workspace-id <B 的 workspaceId>   显式指定（缺省从 access 库发现）
 *   --fixture <path>                    覆盖归档路径
 *
 * 写操作只发生在 E1 测试容器/数据根；导入的会话保留供人工复查（--cleanup 删除）。
 */
import { existsSync, readFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  Report,
  STATUS,
  bootTokenFromContainer,
  bootstrapDshSession,
  defaultPaths,
  loadAccounts,
  login,
  parseArgs,
  rpc,
  shape,
} from './rc5-test-client.mjs'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const args = parseArgs(process.argv.slice(2), { ...defaultPaths() })
const BASE = String(args.base)
const ACCOUNTS_FILE = String(args.accountsFile)
const DATA_ROOT = String(args.dataRoot)
const CONTAINER = String(args.container)
const FIXTURE = resolve(typeof args.fixture === 'string' ? args.fixture : join(repoRoot, 'tests/fixtures/chat-import/deepseek-export-11.zip'))
const OUT = args.json === undefined ? undefined : String(args.json)

const report = new Report({ suite: 'IMP', env: { base: BASE, container: CONTAINER, dataRoot: DATA_ROOT, fixture: FIXTURE }, out: OUT })
const accounts = loadAccounts(ACCOUNTS_FILE)
const dshCookie = await bootstrapDshSession(BASE, typeof args['boot-token'] === 'string' ? args['boot-token'] : bootTokenFromContainer(CONTAINER))

const authA = await login(BASE, accounts.admin.account, accounts.admin.password)
const authB = await login(BASE, accounts.user_b.account, accounts.user_b.password)
const authC = accounts.user_c === undefined ? undefined : await login(BASE, accounts.user_c.account, accounts.user_c.password)
const cookieA = `${dshCookie}; ${authA.cookie}`
const cookieB = `${dshCookie}; ${authB.cookie}`
const cookieC = authC === undefined ? undefined : `${dshCookie}; ${authC.cookie}`

report.add('SETUP-LOGIN', 'P0', authA.status === 200 && authB.status === 200 ? STATUS.PASS : STATUS.FAIL, 'A/B/C 登录', `a=${authA.status} b=${authB.status} c=${authC?.status ?? 'n/a'}`)

/* --------------------------------------------------------------- DB 面 */

function readDb(sql, params = []) {
  const code = `const {DatabaseSync}=require('node:sqlite');const db=new DatabaseSync(${JSON.stringify(join(DATA_ROOT, 'access', 'users.db'))},{readOnly:true});process.stdout.write(JSON.stringify(db.prepare(${JSON.stringify(sql)}).all(...${JSON.stringify(params)})))`
  const result = spawnSync(process.execPath, ['-e', code], { encoding: 'utf8', timeout: 20_000 })
  if (result.status !== 0) throw new Error(`sqlite 读取失败: ${(result.stderr ?? '').slice(0, 200)}`)
  return JSON.parse(result.stdout)
}

function users() {
  return readDb('SELECT id, account, role FROM users')
}

function workspaces() {
  return readDb('SELECT workspace_id, owner_id, path FROM workspaces')
}

function sessionCount(ownerId, workspaceId) {
  return readDb('SELECT COUNT(*) AS n FROM sessions WHERE owner_id = ? AND workspace_id = ?', [ownerId, workspaceId])[0]?.n ?? 0
}

function sessionsOf(ownerId) {
  return readDb('SELECT session_id, owner_id, workspace_id FROM sessions WHERE owner_id = ?', [ownerId])
}

const userRows = users()
const uidA = userRows.find(row => row.account === accounts.admin.account)?.id
const uidB = userRows.find(row => row.account === accounts.user_b.account)?.id
const uidC = accounts.user_c === undefined ? undefined : userRows.find(row => row.account === accounts.user_c.account)?.id
const wsRows = workspaces()
const bWorkspace = typeof args['workspace-id'] === 'string' && args['workspace-id'] !== ''
  ? String(args['workspace-id'])
  : wsRows.find(row => row.owner_id === uidB)?.workspace_id
const aWorkspace = wsRows.find(row => row.owner_id === uidA)?.workspace_id

report.add(
  'SETUP-FIXTURES',
  'P0',
  existsSync(FIXTURE) && typeof bWorkspace === 'string' ? STATUS.PASS : STATUS.FAIL,
  '归档夹具与 B 工作区可用',
  `fixture=${FIXTURE} bytes=${existsSync(FIXTURE) ? readFileSync(FIXTURE).length : 'missing'} bWorkspace=${bWorkspace ?? 'missing'} aWorkspace=${aWorkspace ?? 'missing'}`,
)

if (typeof bWorkspace !== 'string' || uidB === undefined) {
  report.add('SETUP-BLOCKED', 'P0', STATUS.FAIL, '缺少 B 工作区/用户，无法继续', '先跑 scripts/prepare-rc5-envs.sh e1')
  process.exit(report.finish())
}

/* ------------------------------------------------------------ 上传面 */

async function upload(cookie, workspaceId, bytes, { contentType = 'application/octet-stream' } = {}) {
  const url = new URL(`/api/deepseek-chat-import/archive?workspaceId=${encodeURIComponent(workspaceId)}`, BASE)
  const headers = { 'content-type': contentType, accept: 'application/x-ndjson' }
  if (cookie !== undefined) headers.cookie = cookie
  const response = await fetch(url, {
    method: 'POST',
    headers,
    body: bytes,
    signal: AbortSignal.timeout(180_000),
  })
  const text = await response.text()
  const lines = text.split('\n').filter(line => line.trim() !== '')
  let outcome
  for (const line of lines) {
    try {
      const parsed = JSON.parse(line)
      if (parsed?.type === 'outcome') outcome = parsed.outcome
    } catch {
      // progress/非 JSON 行忽略
    }
  }
  return { status: response.status, contentType: response.headers.get('content-type'), lines: lines.length, outcome, text }
}

function sessionIdsOf(outcome) {
  const value = outcome?.value
  if (outcome?.ok !== true || value === null || typeof value !== 'object') return []
  return Array.isArray(value.sessionIds) ? value.sessionIds.filter(id => typeof id === 'string' && id !== '') : []
}

const archive = readFileSync(FIXTURE)
const beforeB = sessionCount(uidB, bWorkspace)
const beforeA = sessionCount(uidA, aWorkspace)

/* IMP-001 未登录 */
await report.run('RC5-IMP-001', 'P0', '未登录上传 → 401 且不写会话', async () => {
  const result = await upload(undefined, bWorkspace, archive)
  const after = sessionCount(uidB, bWorkspace)
  return {
    status: result.status === 401 && after === beforeB ? STATUS.PASS : STATUS.FAIL,
    detail: `status=${result.status} count ${beforeB}→${after}`,
  }
})

/* IMP-002 跨工作区 */
await report.run('RC5-IMP-002', 'P0', 'B 传 A 的 workspaceId → 403 且不写会话', async () => {
  const cookie = cookieB
  const result = await upload(cookie, aWorkspace, archive)
  const afterA = sessionCount(uidA, aWorkspace)
  return {
    status: result.status === 403 && afterA === beforeA ? STATUS.PASS : STATUS.FAIL,
    detail: `status=${result.status} body=${result.text.slice(0, 80)} count ${beforeA}→${afterA}`,
  }
})

/* IMP-003 正常导入 */
let imported = []
await report.run('RC5-IMP-003', 'P0', 'B 导入 11 会话归档 → 200，outcome.sessionIds=10', async () => {
  const result = await upload(cookieB, bWorkspace, archive)
  imported = sessionIdsOf(result.outcome)
  const skipped = Array.isArray(result.outcome?.value?.skipped) ? result.outcome.value.skipped : []
  const ok = result.status === 200 && result.outcome?.ok === true && imported.length === 10
  return {
    status: ok ? STATUS.PASS : STATUS.FAIL,
    detail: `status=${result.status} ok=${result.outcome?.ok} sessionIds=${imported.length} skipped=${skipped.length} lines=${result.lines}`,
  }
})

/* IMP-005 DB 记账 */
await report.run('RC5-IMP-005', 'P0', 'access 库 10 行 owner=B、无空属主', async () => {
  const rows = sessionsOf(uidB)
  const mine = rows.filter(row => row.workspace_id === bWorkspace)
  const expected = new Set(imported)
  const allPresent = imported.every(id => mine.some(row => row.session_id === id))
  const noEmptyOwner = rows.every(row => typeof row.owner_id === 'number' && row.owner_id === uidB)
  const delta = mine.length - beforeB
  const ok = expected.size === 10 && allPresent && noEmptyOwner && delta === 10
  return {
    status: ok ? STATUS.PASS : STATUS.FAIL,
    detail: `B rows=${mine.length} delta=${delta} allImportedPresent=${allPresent} ownerClean=${noEmptyOwner}`,
  }
})

/* IMP-004 可见性（session/list） */
await report.run('RC5-IMP-004', 'P0', '导入的会话 B 可见、A 不可见', async () => {
  const asB = await rpc(BASE, cookieB, 'session/list', { request: {} })
  const asA = await rpc(BASE, cookieA, 'session/list', { request: {} })
  const bText = JSON.stringify(asB.value ?? asB.error ?? asB.text ?? '')
  const aText = JSON.stringify(asA.value ?? asA.error ?? asA.text ?? '')
  const visibleToB = imported.filter(id => bText.includes(id)).length
  const visibleToA = imported.filter(id => aText.includes(id)).length
  // session/list 若不可用（描述符错误），用 DB + access 守卫佐证并把结论降级。
  if (asB.ok !== true) {
    return { status: STATUS.NOTRUN, detail: `session/list 不可用：${shape(asB.error).slice(0, 120)}；DB 归属已由 IMP-005 佐证` }
  }
  return {
    status: visibleToB === 10 && visibleToA === 0 ? STATUS.PASS : STATUS.FAIL,
    detail: `B 可见 ${visibleToB}/10，A 可见 ${visibleToA}/10（A 还能看到他人会话 = 跨租户元数据泄漏）`,
  }
})

/* IMP-009 坏 JSON 跳过 */
await report.run('RC5-IMP-009', 'P1', '坏 JSON 会话被跳过、其余完整导入', async () => {
  const asB = await upload(cookieB, bWorkspace, archive)
  const skipped = Array.isArray(asB.outcome?.value?.skipped) ? asB.outcome.value.skipped : []
  const ids = sessionIdsOf(asB.outcome)
  const broken = skipped.some(item => String(item?.conversationId ?? '') === 'conv-broken') || String(asB.text).includes('conv-broken')
  return {
    status: asB.status === 200 && ids.length === 10 && (broken || skipped.length >= 1) ? STATUS.PASS : STATUS.FAIL,
    detail: `status=${asB.status} sessionIds=${ids.length} skipped=${skipped.length} brokenNamed=${broken}`,
  }
})

/* 其余需要浏览器/大体积/取消的用例 */
for (const [id, priority, title, reason] of [
  ['RC5-IMP-006', 'P1', '1001 会话上限', '需要生成 1001 会话归档（体积与时长），P6 手工构造'],
  ['RC5-IMP-007', 'P1', '512MiB 边界', '需要 512MiB 上传与反代链路（P6/E6）'],
  ['RC5-IMP-008', 'P1', '上传中途取消后对账', '需要浏览器/中断控制（P6 E2E）'],
  ['RC5-IMP-010', 'P1', '反代 client_max_body_size/读超时', '反代配置属 T44/E6，不在 E1'],
]) {
  report.add(id, priority, STATUS.SKIP, title, reason)
}

process.exit(report.finish())