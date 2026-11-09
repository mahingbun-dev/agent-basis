#!/usr/bin/env node
// 重放 docs/acp-real-6 的 6 条真实会话日志,验证修好的映射不再 turns=0(T17)。
//
// 数据源:acp-real-6 那轮评测在 DSH_HOME(~/.dsh-evals)留下的真实 session 日志
// sessions/--*-docs-acp-real-6-workspaces-<case>--/<case>/session.v4.jsonl.zstd
// —— 当轮 on_notification 流出的就是这些事件(session.event 载荷),旧映射全丢
// (sessions.jsonl 里 6 条 turns=0/event_count=0)。
//
// 链路(与真实评测完全同构):
//   zstd 日志 → 逐事件包回真实通知形态 {method:"session.event",payload:{sessionId,event}}
//   → python 修好的 EventMapper(tools/evals/python/dsh_eval_driver.py)规整
//   → TS 修好的 coerceEvents(tools/evals/src/adapters/acp.ts)
//   → summarize(tools/evals/src/events.ts)出 turns/steps/tool_calls/tokens/approvals
// 任一 case turns=0 → 退出码 1。
//
// 用法:node scripts/replay-acp-real-notifications.mjs
import { spawn } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import * as path from 'node:path'
import { fileURLToPath } from 'node:url'
import { coerceEvents } from '../tools/evals/src/adapters/acp.ts'
import { summarize } from '../tools/evals/src/events.ts'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const sessionsFile = path.join(repoRoot, 'docs/acp-real-6/sessions.jsonl')
const driverFile = path.join(repoRoot, 'tools/evals/python/dsh_eval_driver.py')
const dshSessionsDir = path.join(process.env.DSH_HOME ?? '/Users/sunny/.dsh-evals', 'sessions')

// python 侧:stdin 吃原始通知行,经修好的 EventMapper 规整,stdout 吐 {"kind":"event","event":...}
const MAPPER_SCRIPT = `
import json, sys
sys.path.insert(0, ${JSON.stringify(path.dirname(driverFile))})
from dsh_eval_driver import EventMapper

mapper = EventMapper()
for line in sys.stdin:
    line = line.strip()
    if not line:
        continue
    for event in mapper.map(json.loads(line)):
        sys.stdout.write(json.dumps({"kind": "event", "event": event}, ensure_ascii=False) + "\\n")
`

function sh(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ['pipe', 'pipe', 'inherit'] })
    const chunks = []
    child.stdout.on('data', chunk => chunks.push(chunk))
    child.on('error', reject)
    child.on('close', code => resolve({ code, stdout: Buffer.concat(chunks).toString('utf8') }))
  })
}

/** zstd 日志 → 原始通知行(只取带 seq/time 的事件行;日志首行 session 头与 lock 等非事件跳过)。 */
async function notificationsOf(caseId) {
  const dirPrefix = path.join(dshSessionsDir, `--Users-sunny-.zcode-workspace-draft-50d92869-2a8d-4d02-8c95-cccdab6eafca-agent-eterna-docs-acp-real-6-workspaces-${caseId}--`)
  const logFile = path.join(dirPrefix, caseId, 'session.v4.jsonl.zstd')
  if (!existsSync(logFile)) return undefined
  const { code, stdout } = await sh('zstdcat', [logFile])
  if (code !== 0) throw new Error(`zstdcat 退出码 ${code}:${logFile}`)
  const lines = []
  for (const line of stdout.split('\n')) {
    const trimmed = line.trim()
    if (trimmed === '') continue
    let parsed
    try {
      parsed = JSON.parse(trimmed)
    } catch {
      continue
    }
    if (typeof parsed?.type !== 'string' || typeof parsed.seq !== 'number' || typeof parsed.time !== 'number') continue
    lines.push(JSON.stringify({ method: 'session.event', payload: { sessionId: caseId, event: parsed } }))
  }
  return lines
}

/** 通知行 → python EventMapper → TS coerceEvents + summarize(评测同构链路)。 */
async function replayCase(caseId, notificationLines) {
  const py = spawn('python3', ['-c', MAPPER_SCRIPT], { stdio: ['pipe', 'pipe', 'inherit'] })
  let out = ''
  py.stdout.on('data', chunk => { out += chunk })
  const done = new Promise((resolve, reject) => {
    py.on('error', reject)
    py.on('close', code => resolve(code))
  })
  py.stdin.write(`${notificationLines.join('\n')}\n`)
  py.stdin.end()
  const code = await done
  if (code !== 0) throw new Error(`mapper python 退出码 ${code}`)
  const events = []
  for (const line of out.split('\n')) {
    const trimmed = line.trim()
    if (trimmed === '') continue
    const parsed = JSON.parse(trimmed)
    events.push(...coerceEvents(parsed.event))
  }
  return summarize(events)
}

const records = readFileSync(sessionsFile, 'utf8').split('\n').filter(line => line.trim() !== '').map(line => JSON.parse(line))
const rows = []
let failed = false
for (const record of records) {
  const caseId = record.case_id
  const lines = await notificationsOf(caseId)
  if (lines === undefined) {
    rows.push({ caseId, error: '真实会话日志不存在' })
    failed = true
    continue
  }
  const summary = await replayCase(caseId, lines)
  const turnsWasZero = record.metrics.turns === 0
  const ok = summary.turns > 0
  if (!ok) failed = true
  rows.push({
    caseId,
    notifications: lines.length,
    events: summary.eventCount,
    turns: summary.turns,
    steps: summary.steps,
    toolCalls: summary.toolCalls.map(call => call.name),
    tokens: summary.totalTokens,
    approvals: summary.approvalsAsked.map(ask => ask.toolName),
    decided: summary.approvalsDecided.map(decision => decision.outcome),
    recordedTurns: record.metrics.turns,
    turnsWasZero,
    ok,
  })
}
for (const row of rows) {
  if (row.error !== undefined) {
    console.log(`✗ ${row.caseId}:${row.error}`)
    continue
  }
  console.log(`${row.ok ? '✓' : '✗'} ${row.caseId}: 通知 ${row.notifications} → 事件 ${row.events} | turns ${row.recordedTurns}→${row.turns} | steps ${row.steps} | tools [${row.toolCalls.join(',')}] | tokens ${row.tokens} | approvals [${row.approvals.join(',')}]→[${row.decided.join(',')}]`)
}
const zeroTurns = rows.filter(row => row.ok === false)
console.log(zeroTurns.length === 0 && rows.length > 0
  ? `重放 ${rows.length} 条:turns=0 已清零(原 ${records.filter(r => r.metrics.turns === 0).length} 条)`
  : `仍有 turns=0:${zeroTurns.map(row => row.caseId).join(', ')}`)
process.exit(failed ? 1 : 0)
