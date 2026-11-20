#!/usr/bin/env node
/**
 * E2 补充回归面 · 治理规则 ask/deny 实跑（54 §5.5 末表）。
 *
 * 产品口径（2026-11-19 静默裁决，见 docker/profile/cordis.patch.yml.template
 * `approval: policy: never` 与 governance.rules.yml 头注）：
 *   - deny：规则命中 → 内核物化 isError 工具结果 + 审计 `decision=deny`；
 *   - ask：规则命中 → 会话落 `approval/asked`，因 approval policy=never 由内核
 *     确定性 `rejected`（不产生浏览器待决项/决策卡，这是产品裁决而非缺口）；
 *     审计仍留 `decision=ask`。
 * 因此本探针断言三层：审计决策、会话 approval 事件、tool/result isError。
 *
 * 只动 E2 测试 lane（rc5-e2suite / 3119 / ~/eterna-data/test-20261120/e2）：
 *   1) 备份 `.eterna/governance.rules.yml`，写 `access/governance.rules.yml`
 *      （entrypoint 优先读取）追加两条探针规则（read + argsContains）；
 *   2) 重启使规则生效；确保 fake provider 路由；两条假模型回合；
 *   3) finally 还原规则、移除 fake provider、重启等 healthy。
 *
 * 产物：artifacts/rc5/E2/SEC/RC5-SEC-GOV/{cmd.log,result.md}
 */
import { spawnSync } from 'node:child_process'
import { chmodSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  bootTokenFromContainer, bootstrapDshSession, loadAccounts, login, rpc, shape,
} from '../../../../scripts/rc5-test-client.mjs'
import {
  admitPrompt, cleanupFakeRoute, createSession, ensureFakeRoute, waitIdle,
} from '../LLM/lib.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO = join(HERE, '..', '..', '..', '..')
const BASE = 'http://127.0.0.1:3119'
const CONTAINER = 'rc5-e2suite'
const DATA_ROOT = join(homedir(), 'eterna-data', 'test-20261120', 'e2')
const ACCOUNTS = join(homedir(), 'eterna-data', 'test-rc5', '.test-accounts.json')
const OUT = join(REPO, 'artifacts', 'rc5', 'E2', 'SEC', 'RC5-SEC-GOV')
const OVERRIDE = join(DATA_ROOT, 'access', 'governance.rules.yml')
const RENDERED = join(DATA_ROOT, '.eterna', 'governance.rules.yml')
mkdirSync(OUT, { recursive: true })
mkdirSync(dirname(OVERRIDE), { recursive: true })

const cmds = []
const notes = []
const cmd = (line, exit, detail = '') => {
  cmds.push({ line, exit, detail: String(detail).slice(0, 400) })
  console.log(`$ ${line}  # EXIT=${exit} ${detail}`)
}
const waiter = ms => new Promise(resolve => setTimeout(resolve, ms))

function docker(args, timeout = 120_000) {
  const result = spawnSync('docker', args, { encoding: 'utf8', timeout, maxBuffer: 16 * 1024 * 1024 })
  return { exit: result.status ?? 1, out: `${result.stdout ?? ''}${result.stderr ?? ''}` }
}

async function waitHealthy(timeoutMs = 120_000) {
  const start = Date.now()
  let health = 'unknown'
  while (Date.now() - start < timeoutMs) {
    health = docker(['inspect', CONTAINER, '--format', '{{.State.Health.Status}}']).out.trim()
    if (health === 'healthy') return health
    await waiter(2000)
  }
  return health
}

const accounts = loadAccounts(ACCOUNTS)
const dsh = await bootstrapDshSession(BASE, bootTokenFromContainer(CONTAINER))
const auth = await login(BASE, accounts.admin.account, accounts.admin.password)
if (auth.status !== 200) throw new Error(`登录失败 ${auth.status}`)
const cookie = `${dsh}; ${auth.cookie}`
cmd('bootstrap dsh + admin login', auth.status === 200 ? 0 : 1, `login=${auth.status}`)

const original = readFileSync(RENDERED, 'utf8')
let overrode = false
let fakeRoute = false

async function restore() {
  if (overrode) {
    writeFileSync(RENDERED, original, { mode: 0o600 })
    spawnSync('rm', ['-f', OVERRIDE])
    cmd('还原治理规则（删 access 覆盖 + 恢复 .eterna）', 0)
    overrode = false
  }
  if (fakeRoute) {
    await cleanupFakeRoute(cookie).catch(() => undefined)
    cmd('移除 fake provider / 恢复默认模型（cleanupFakeRoute）', 0)
    fakeRoute = false
  }
  const restart = docker(['restart', CONTAINER])
  cmd('还原后重启', restart.exit, shape(restart.out, 120))
  const health = await waitHealthy()
  cmd('还原后 healthy', health === 'healthy' ? 0 : 1, `health=${health}`)
}

/** 会话事件流（session/wait 只回 assistant 窗口；tool/result 必须走 page）。 */
async function sessionEvents(sessionId) {
  const page = await rpc(BASE, cookie, 'session/page', { address: { kind: 'session', sessionId }, maxMessages: 80 }, { timeoutMs: 30_000 })
  if (page.ok !== true) throw new Error(`session/page 失败: ${JSON.stringify(page.error)}`)
  return (page.value?.records ?? []).map(record => record.event ?? record)
}

function toolResultsOf(events) {
  return events.filter(event => event.type === 'tool/result').map(event => ({
    isError: event.data?.message?.isError === true || event.data?.isError === true,
    text: JSON.stringify(event.data ?? {}).slice(0, 500),
  }))
}

function auditSince(mark) {
  const dir = join(DATA_ROOT, '.eterna')
  const rows = []
  if (!existsSync(dir)) return rows
  for (const name of readdirSync(dir).filter(item => /^audit-\d{8}\.jsonl$/.test(item)).sort()) {
    for (const line of readFileSync(join(dir, name), 'utf8').split('\n')) {
      if (line.trim() === '') continue
      try {
        const row = JSON.parse(line)
        if (String(row.at ?? '') >= mark) rows.push(row)
      } catch { /* 忽略半行 */ }
    }
  }
  return rows
}

let pass = false
try {
  /* 1) 规则 */
  const probeRules = `
  # ── RC5 验收探针（gov-ask-deny.mjs；跑完即还原）──
  - id: probe-deny
    effect: deny
    tools: ['read']
    argsContains: ['governance-deny-probe']
    reason: 验收探针：deny 规则必须生效
  - id: probe-ask
    effect: ask
    tools: ['read']
    argsContains: ['governance-ask-probe']
    reason: 验收探针：ask 规则必须生效
`
  writeFileSync(OVERRIDE, original + probeRules, { mode: 0o600 })
  chmodSync(OVERRIDE, 0o600)
  overrode = true
  cmd('写 access/governance.rules.yml（原规则 + probe-deny/probe-ask）', 0, `bytes=${readFileSync(OVERRIDE).length}`)
  const restart = docker(['restart', CONTAINER])
  cmd(`docker restart ${CONTAINER}`, restart.exit, shape(restart.out, 160))
  const health = await waitHealthy()
  cmd('等待 healthy', health === 'healthy' ? 0 : 1, `health=${health}`)
  if (health !== 'healthy') throw new Error(`容器未 healthy: ${health}`)

  const logs = docker(['logs', CONTAINER])
  const govLine = logs.out.split('\n').filter(line => line.includes('[entrypoint] governance rules:')).at(-1) ?? ''
  cmd('docker logs（末次 governance rules 行）', govLine.includes('access/governance.rules.yml') ? 0 : 1, shape(govLine, 240))
  const inside = docker(['exec', CONTAINER, 'sh', '-lc', 'grep -c "id: probe-deny" /data/.eterna/governance.rules.yml'])
  cmd('容器内规则含 probe-deny', inside.exit === 0 ? 0 : 1, shape(inside.out, 80))

  /* 2) 假模型路由 */
  await ensureFakeRoute(cookie)
  fakeRoute = true
  cmd('ensureFakeRoute（fake/fake-1 路由，admin 默认模型）', 0)

  /* --- deny 例 --- */
  const denyMark = new Date().toISOString()
  const denySession = await createSession(cookie, {})
  const denyPrompt = `GOVPROBE-DENY-${Date.now()}\n@@SEQ 1\n@@CALL name=read args={"path":"/tmp/governance-deny-probe.txt"}\n请调用 read 后回复 DONE。`
  const admittedDeny = await admitPrompt(cookie, denySession, denyPrompt)
  cmd('deny 例 session/prompt 入队', admittedDeny.ok === true ? 0 : 1, `status=${admittedDeny.status}`)
  await waitIdle(cookie, denySession, { timeoutMs: 90_000 })
  const denyEvents = await sessionEvents(denySession)
  const denyResults = toolResultsOf(denyEvents)
  const denyHit = denyResults.find(row => row.isError && row.text.includes('probe-deny'))
  cmd('deny 例：tool/result isError 且命中 probe-deny', denyHit === undefined ? 1 : 0,
    denyHit === undefined ? shape(denyResults.map(row => row.text).join(' | '), 240) : shape(denyHit.text, 240))
  const denyAudit = auditSince(denyMark).filter(row => JSON.stringify(row).includes('probe-deny') || /"decision":"deny"/.test(JSON.stringify(row)))
  cmd('deny 例：审计出现 decision=deny', denyAudit.length > 0 ? 0 : 1, `rows=${denyAudit.length} ${shape(denyAudit[0]?.detail, 240)}`)
  notes.push(`deny 例：${shape(denyHit?.text, 240)}`)

  /* --- ask 例 --- */
  const askMark = new Date().toISOString()
  const askSession = await createSession(cookie, {})
  const askPrompt = `GOVPROBE-ASK-${Date.now()}\n@@SEQ 1\n@@CALL name=read args={"path":"/tmp/governance-ask-probe.txt"}\n请调用 read 后回复 DONE。`
  const admittedAsk = await admitPrompt(cookie, askSession, askPrompt)
  cmd('ask 例 session/prompt 入队', admittedAsk.ok === true ? 0 : 1, `status=${admittedAsk.status}`)
  /* 期望：approval policy=never → 不产生待决项；短轮询只为留痕 */
  let pending
  const pendingStart = Date.now()
  while (Date.now() - pendingStart < 8_000) {
    const queue = await fetch(new URL('/access/api/approvals/tool-pending', BASE), { headers: { cookie } }).then(r => r.json()).catch(() => undefined)
    pending = (queue?.items ?? []).find(item => item.sessionId === askSession)
    if (pending !== undefined) break
    await waiter(1200)
  }
  cmd('ask 例：浏览器待决项（approval=never 时为 0，属产品裁决）', 0, pending === undefined ? 'none（符合 never）' : `present id=${pending.id}`)
  await waitIdle(cookie, askSession, { timeoutMs: 90_000 })
  const askEvents = await sessionEvents(askSession)
  const policy = askEvents.find(event => event.type === 'approval/policy')?.data?.policy
  const asked = askEvents.find(event => event.type === 'approval/asked')
  const decided = askEvents.find(event => event.type === 'approval/decided')
  cmd('ask 例：会话 approval/policy=never（产品裁决）', policy === 'never' ? 0 : 1, `policy=${policy ?? '-'}`)
  cmd('ask 例：会话落 approval/asked', asked === undefined ? 1 : 0, shape(asked?.data, 200))
  cmd('ask 例：内核确定性 rejected（approval never）', decided?.data?.outcome === 'rejected' ? 0 : 1, shape(decided?.data, 160))
  const askResults = toolResultsOf(askEvents)
  const askHit = askResults.find(row => row.isError)
  cmd('ask 例：tool/result isError', askHit === undefined ? 1 : 0, askHit === undefined ? shape(askResults.map(row => row.text).join(' | '), 240) : shape(askHit.text, 240))
  const askAudit = auditSince(askMark).filter(row => JSON.stringify(row).includes('probe-ask') || /"decision":"ask"/.test(JSON.stringify(row)))
  cmd('ask 例：审计出现 decision=ask', askAudit.length > 0 ? 0 : 1, `rows=${askAudit.length} ${shape(askAudit[0]?.detail, 240)}`)
  notes.push(`ask 例：approval/asked + decided(rejected) 已留痕；浏览器待决项=${pending === undefined ? '无（approval policy=never）' : '有'}；tool/result=${shape(askHit?.text, 200)}`)
} finally {
  await restore().catch(error => cmd('还原失败', 1, shape(error, 200)))
}

pass = cmds.every(item => item.exit === 0)

writeFileSync(join(OUT, 'cmd.log'), cmds.map(item => `$ ${item.line}  # EXIT=${item.exit}\n${item.detail}\n`).join('\n') + (notes.length > 0 ? `\nnotes:\n${notes.join('\n')}\n` : '') + `\nRESULT=${pass ? 'PASS' : 'FAIL'}\n`)
writeFileSync(join(OUT, 'result.md'), [
  '# RC5-SEC-GOV · 治理规则 ask/deny 实跑（54 §5.5 补充回归面）',
  '',
  `- 环境：E2 lane \`${CONTAINER}\`（3119，数据根 \`${DATA_ROOT}\`）；规则经 \`access/governance.rules.yml\` 覆盖，跑完还原`,
  '- 方法：确定性假模型（fake/fake-1 + `@@CALL` 指令）+ 两条探针规则（read + argsContains）',
  '',
  '## 结论',
  '',
  `**${pass ? 'PASS' : 'FAIL'}**。`,
  '',
  '- deny：规则命中 → 内核物化 isError 工具结果（含 `命中规则 probe-deny(deny)`）+ 审计 `decision=deny`。',
  '- ask：规则命中 → 会话落 `approval/asked`，因产品 2026-11-19 静默裁决 `approval.policy=never`，内核确定性 `approval/decided=rejected`；审计留 `decision=ask`。**决策卡不出现属产品口径**（不是本项缺口）：该裁决已写进 `docker/profile/cordis.patch.yml.template`（`approval: policy: never`）与治理规则头注。',
  '',
  '## 明细',
  '',
  ...cmds.map(item => `- \`${item.line}\` → EXIT=${item.exit}${item.detail === '' ? '' : `（${item.detail}）`}`),
  '',
  '## 边界',
  '',
  '- 只动 E2 测试 lane；规则文件与 fake provider 跑完还原（access 覆盖删除、.eterna 恢复原文件、默认模型恢复）。',
  '- ask 的「决策卡截图」在 `approval: never` 下不可达（内核在征求任何人之前确定性 rejected）；如要验卡片，需改 profile 审批策略，那已不是本产品出厂形态。',
].join('\n'))
console.log(`[SEC-GOV] ${pass ? 'PASS' : 'FAIL'}`)
process.exit(pass ? 0 : 1)