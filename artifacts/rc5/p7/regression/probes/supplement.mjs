#!/usr/bin/env node
/**
 * T52 补充回归面（54 §5.5 / 47 §6.3）：审计 jsonl、治理规则、companion 中继。
 * 只读：审计文件与规则文件只统计；companion API 只取状态与 hasToken 布尔，不打印令牌值。
 */
import { existsSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import {
  bootTokenFromContainer,
  bootstrapDshSession,
  loadAccounts,
  login,
  parseArgs,
} from '/Users/sunny/code/agent-basis-rc5/scripts/rc5-test-client.mjs'

const args = parseArgs(process.argv.slice(2), {})
const BASE = String(args.base ?? 'http://127.0.0.1:3119')
const CONTAINER = String(args.container ?? 'rc5-e2suite')
const DATA_ROOT = String(args['data-root'] ?? `${process.env.HOME}/eterna-data/test-20261120/e2`)
const SINCE = String(args.since ?? '2026-11-20T01:35:00')
const ACCOUNTS = `${process.env.HOME}/eterna-data/test-rc5/.test-accounts.json`
const out = []

const auditDir = join(DATA_ROOT, '.eterna')
const { readdirSync } = await import('node:fs')
const auditFiles = existsSync(auditDir) ? readdirSync(auditDir).filter(n => /^audit-\d{8}\.jsonl$/.test(n)).sort() : []
let rows = []
for (const file of auditFiles) {
  for (const line of readFileSync(join(auditDir, file), 'utf8').split('\n')) {
    if (line.trim() === '') continue
    try { rows.push(JSON.parse(line)) } catch {}
  }
}
const windowRows = rows.filter(row => String(row.at ?? '') >= SINCE)
const kinds = {}
for (const row of windowRows) {
  const kind = row?.detail?.kind ?? row?.kind ?? 'unknown'
  kinds[kind] = (kinds[kind] ?? 0) + 1
}
/* 凭据值扫描（不是字段名）：字段名含 password/token 不算泄露，值形态才算。
 * 夹具名（secret-b / cross-user-secret）不是凭据值，单独排除并计数。 */
const secretValuePatterns = [
  /eterna_session=[A-Za-z0-9._%+/-]{8,}/i,
  /dsh-auth=[A-Za-z0-9._%+/-]{8,}/i,
  /"password"\s*:\s*"[^"]{1,}"/i,
  /"token"\s*:\s*"[^"]{8,}"/i,
  /"authorization"\s*:\s*"[^"]{8,}"/i,
  /"api[_-]?key"\s*:\s*"[^"]{8,}"/i,
]
const fixturePattern = /secret-b|cross-user-secret/
const secretHits = windowRows.filter(row => secretValuePatterns.some(re => re.test(JSON.stringify(row)))).length
const fixtureNameRows = windowRows.filter(row => fixturePattern.test(JSON.stringify(row))).length

const rulePath = join(auditDir, 'governance.rules.yml')
const ruleText = existsSync(rulePath) ? readFileSync(rulePath, 'utf8') : ''
/* 规则 schema 是 effect:（不是 action:）；三种都计。 */
const ruleActions = { allow: 0, ask: 0, deny: 0 }
for (const match of ruleText.matchAll(/^\s*-?\s*(?:action|effect):\s*(\w+)/gm)) {
  if (ruleActions[match[1]] !== undefined) ruleActions[match[1]] += 1
}
const denyEvents = windowRows.filter(row => JSON.stringify(row).includes('"decision":"deny"') || row?.detail?.decision === 'deny').length

const accounts = loadAccounts(ACCOUNTS)
const dsh = await bootstrapDshSession(BASE, bootTokenFromContainer(CONTAINER))
const authA = await login(BASE, accounts.admin.account, accounts.admin.password)
const cookieA = `${dsh}; ${authA.cookie}`
const anon = await fetch(new URL('/access/api/companion', BASE))
const authed = await fetch(new URL('/access/api/companion', BASE), { headers: { cookie: cookieA } })
let body
try { body = await authed.json() } catch { body = undefined }
const tokenPresent = typeof body?.token === 'string' && body.token.length > 0

const report = {
  audit: {
    files: auditFiles,
    rowsTotal: rows.length,
    windowSince: SINCE,
    windowRows: windowRows.length,
    eventKinds: kinds,
    secretFieldHits: secretHits,
    fixtureNameRows,
    secretScanNote: '只扫凭据值形态（session/token/password/authorization/api-key 的值），字段名与夹具名不算；fixtureNameRows 单列',
  },
  governance: {
    rulesFile: rulePath,
    rulesFileBytes: existsSync(rulePath) ? statSync(rulePath).size : 0,
    actions: ruleActions,
    denyEventsInWindow: denyEvents,
    note: 'deny/ask 已由 E2/SEC/RC5-SEC-GOV 实跑（审计 decision=deny/ask + 会话 approval 事件）；ask 决策卡因产品 approval:never 口径不产生',
  },
  companion: {
    anonymousStatus: anon.status,
    adminStatus: authed.status,
    adminTokenPresent: tokenPresent,
    guideUrl: typeof body?.guideUrl === 'string' ? 'present' : 'absent',
    note: '协议级见 supplement/companion-relay.md（PASS：token/在线探测/断开回收）；真实扩展与 mcp__browser__* 实跑 NOTRUN（headless 无法加载未打包 MV3）',
  },
}
console.log(JSON.stringify(report, null, 1))