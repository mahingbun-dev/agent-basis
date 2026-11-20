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
const secretPattern = /(eterna_session=|dsh-auth=|password|secret|authorization|api[_-]?key|token=)/i
const secretHits = windowRows.filter(row => secretPattern.test(JSON.stringify(row))).length

const rulePath = join(auditDir, 'governance.rules.yml')
const ruleText = existsSync(rulePath) ? readFileSync(rulePath, 'utf8') : ''
const ruleActions = { allow: 0, ask: 0, deny: 0 }
for (const match of ruleText.matchAll(/^\s*-?\s*action:\s*(\w+)/gm)) {
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
  },
  governance: {
    rulesFile: rulePath,
    rulesFileBytes: existsSync(rulePath) ? statSync(rulePath).size : 0,
    actions: ruleActions,
    denyEventsInWindow: denyEvents,
    note: 'ask/allow 决策卡需要模型回合与浏览器，未在本轮执行；deny 面以租户拒绝审计为证',
  },
  companion: {
    anonymousStatus: anon.status,
    adminStatus: authed.status,
    adminTokenPresent: tokenPresent,
    guideUrl: typeof body?.guideUrl === 'string' ? 'present' : 'absent',
    note: '扩展连接 + mcp__browser__* 工具调用需要真实浏览器/模型回合，未执行（NOTRUN）',
  },
}
console.log(JSON.stringify(report, null, 1))