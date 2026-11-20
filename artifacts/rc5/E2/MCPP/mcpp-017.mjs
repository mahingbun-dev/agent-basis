#!/usr/bin/env node
/**
 * E2 · RC5-MCPP-017：慢 HTTP 工具 60s 调用超时（P1）。
 *
 * 做法：宿主起 tests/fixtures/mcp-slow-http-server.mjs（slow 工具默认等 90s），
 * 容器内经 host.docker.internal 连；B 建个人 HTTP server → 新会话 → 假模型回合
 * 调 `mcp__p<uid>_slow__slow {delayMs:90000}`。产品侧 DEFAULT_TOOL_CALL_TIMEOUT_MS=60s
 * 必须先到点（错误回传），而不是等到夹具 90s 响应。
 *
 * 判定：工具在 tools 清单（absent=false）；工具结果含超时语义；回合耗时 55–95s。
 *
 * 前提：lane 白名单含 host.docker.internal；fake-llm-server 在 4599 运行。
 * 用法：node artifacts/rc5/E2/MCPP/run-extra.mjs --only 017
 */
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { Case, STATUS, shape } from '../_lib/evidence.mjs'
import { LANE, REPO, call, docker, sessions, sleep, userIdOf, workspaceOf } from '../_lib/env.mjs'
import { cleanupFakeRoute, createSession, ensureFakeRoute, logMark, logSince, promptTurn } from '../LLM/lib.mjs'

const PORT = 18000 + (process.pid % 400)
const FIXTURE = join(REPO, 'tests', 'fixtures', 'mcp-slow-http-server.mjs')

async function healthy() {
  try {
    const response = await fetch(`http://127.0.0.1:${PORT}/health`, { signal: AbortSignal.timeout(1_500) })
    const body = await response.json().catch(() => ({}))
    return response.ok && body?.tag === 'slow-http-fixture'
  } catch {
    return false
  }
}

export async function run(s) {
  const c = new Case('MCPP', 'RC5-MCPP-017')
  const cookie = s.userB.cookie
  const uid = userIdOf(s.userB.account)
  const cwd = workspaceOf(uid)?.path ?? `/data/workspaces/${s.userB.account}`
  let child
  let itemId
  try {
    const catalog = await call(cookie, 'mcp-personal/catalog')
    const hosts = catalog.value?.hostWhitelist ?? []
    c.cmd('POST /api/mcp-personal/catalog（读取白名单）', catalog.status, `hostWhitelist=${JSON.stringify(hosts)}`)

    let reused = await healthy()
    if (!reused) {
      if (!existsSync(FIXTURE)) throw new Error(`夹具不存在: ${FIXTURE}`)
      child = spawn(process.execPath, [FIXTURE, '--port', String(PORT), '--host', '0.0.0.0'], {
        stdio: ['ignore', 'pipe', 'pipe'],
      })
      child.stderr.on('data', () => undefined)
      for (let attempt = 0; attempt < 40; attempt += 1) {
        if (await healthy()) { reused = true; break }
        await sleep(250)
      }
    }
    c.cmd(`node tests/fixtures/mcp-slow-http-server.mjs --port ${PORT} --host 0.0.0.0`, reused ? 0 : 1,
      `healthy=${reused} reused=${child === undefined}`)

    const containerProbe = docker(['exec', LANE.container, 'node', '-e',
      `fetch('http://host.docker.internal:${PORT}/health').then(r=>r.text()).then(t=>console.log(t)).catch(e=>{console.error(String(e));process.exit(1)})`])
    c.cmd(`docker exec rc5-e2suite node -e fetch(http://host.docker.internal:${PORT}/health)`, containerProbe.exit,
      shape(containerProbe.stdout || containerProbe.stderr, 300))

    const before = await call(cookie, 'mcp-personal/list')
    for (const item of before.value?.items ?? []) {
      if (item.name === 'slow') {
        await call(cookie, 'mcp-personal/delete', { request: { id: item.id } })
        c.note('清理同名 slow 残留')
      }
    }

    const upsert = await call(cookie, 'mcp-personal/upsert', {
      request: { name: 'slow', transport: 'streamable-http', url: `http://host.docker.internal:${PORT}/mcp` },
    })
    itemId = upsert.value?.item?.id
    const serverName = upsert.value?.item?.serverName
    c.cmd(`POST /api/mcp-personal/upsert {name:slow,url:http://host.docker.internal:${PORT}/mcp}（B）`, upsert.status,
      `ok=${upsert.ok} serverName=${serverName ?? '-'} code=${upsert.error?.code ?? '-'} msg=${shape(upsert.error?.message, 160)}`)

    await ensureFakeRoute(s.admin.cookie)
    const mark = logMark()
    const sessionId = await createSession(cookie, { cwd })
    c.cmd('POST /api/session/create（B，慢工具会话）', 200, `sessionId=${sessionId}`)
    const toolName = `mcp__${serverName}__slow`
    const started = Date.now()
    let round
    let failure
    try {
      round = await promptTurn(cookie, sessionId,
        `@@SEQ 1\nRC5-MCPP-017：请调用慢工具\n@@CALL name=${toolName} args={"delayMs":90000}`,
        { timeoutMs: 180_000 })
    } catch (error) {
      failure = error
    }
    const elapsed = Date.now() - started
    const logs = logSince(mark)
    const pending = logs.find(row => row.pending?.name === toolName)
    const toolTexts = logs.flatMap(row => row.toolResultTexts ?? [])
    const timeoutText = toolTexts.find(text => /timed out|timeout|超时/i.test(text)) ?? ''
    const dispatched = pending !== undefined && pending.absent === false
    c.cmd('POST /api/session/prompt（假模型 @@CALL 慢工具）', failure === undefined ? 200 : 500,
      failure === undefined ? `elapsedMs=${elapsed} tool=${toolName}` : shape(failure?.message, 200))
    c.cmd('读取 fake-llm.jsonl（tools 清单/工具结果）', 0,
      `dispatched=${dispatched} absent=${pending?.absent ?? '-'} texts=${shape(toolTexts.join(' | '), 500)}`)
    c.cmd('POST /api/session/wait（回合记录）', 200, `records=${round?.records?.length ?? 0}`)

    c.assert('前置：白名单含 host.docker.internal', hosts.includes('host.docker.internal'), JSON.stringify(hosts))
    c.assert('慢工具已在 tools 清单并在本回合派发', dispatched, shape(pending ?? {}))
    c.assert('工具调用在 ~60s 超时（55–95s）', elapsed >= 55_000 && elapsed <= 95_000, `elapsedMs=${elapsed}`)
    c.assert('工具结果回传超时错误（非 90s 成功响应）', timeoutText !== '' && !/slow:90000/.test(toolTexts.join('\n')),
      shape(toolTexts.join(' | '), 400))
    c.assert('回合正常结束（超时是工具级错误，不炸会话）', failure === undefined && round !== undefined,
      failure === undefined ? `records=${round?.records?.length ?? 0}` : shape(failure?.message, 200))

    const pass = hosts.includes('host.docker.internal') && dispatched
      && elapsed >= 55_000 && elapsed <= 95_000 && timeoutText !== ''
      && failure === undefined && round !== undefined
    return c.finish({
      status: pass ? STATUS.PASS : STATUS.FAIL,
      title: '慢 HTTP 工具 60s 调用超时（工具级错误，不炸会话）',
      expected: '工具在清单中；调用约 60s 返回超时错误；回合正常收尾；夹具 90s 响应不抵达',
      actual: `dispatched=${dispatched} elapsedMs=${elapsed} timeoutText=${shape(timeoutText, 160) || '(none)'} turn=${failure === undefined ? 'ok' : 'error'}`,
      notes: [
        `lane=${LANE.container}（独立测试容器，未触碰生产）`,
        '默认 toolCallTimeoutMs=60000（dsh-mcp-client DEFAULT_TOOL_CALL_TIMEOUT_MS）；夹具故意等 90s',
        '确定性假模型只决定 tool_call；工具执行/超时/结果回传全部走产品代码',
      ],
      artifacts: ['cmd.log'],
    })
  } finally {
    if (itemId !== undefined) {
      await call(s.userB.cookie, 'mcp-personal/delete', { request: { id: itemId } }).catch(() => undefined)
    }
    await cleanupFakeRoute(s.admin.cookie).catch(() => undefined)
    if (child !== undefined) {
      child.kill('SIGTERM')
      await sleep(300)
      if (child.exitCode === null) child.kill('SIGKILL')
    }
  }
}