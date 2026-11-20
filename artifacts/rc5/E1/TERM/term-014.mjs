#!/usr/bin/env node
/**
 * E1 · RC5-TERM-014：请求的 shell 不存在 —— 明确报错、容器不崩。
 *
 * 51 §3.7 原始判定是「bash 不存在时明确报错；容器不崩（镜像应保证 bash 存在）」。
 * 运行镜像本身保证 bash 存在，无法在不破坏镜像的前提下制造「bash 缺失」；因此本用例
 * 走同一条错误分支（spawn 前 resolveShell 找不到请求的 shellPath），并核对：
 *   1) shellPath=/bin/<不存在> 的 create → 明确错误（not available），不是静默成功；
 *   2) 该失败不影响容器（health 仍 healthy）；
 *   3) 随后正常 create（默认 bash）仍成功（服务未被打坏）。
 *
 * 用法：node artifacts/rc5/E1/TERM/term-014.mjs
 */
import { Case, STATUS, shape } from '../_lib/evidence.mjs'
import { LANE, call, docker, sessions } from '../_lib/env.mjs'

const s = await sessions()
const A = s.admin.cookie
const c = new Case('TERM', 'RC5-TERM-014')
const token = Date.now().toString(36)
const missingId = `t14-missing-${token}`
const normalId = `t14-bash-${token}`
const missingShell = `/bin/rc5-no-such-shell-${token}`

let row
try {
  const session = await call(A, 'session/create', { request: {} }, { timeoutMs: 30_000 })
  const sessionId = session.value?.sessionId
  if (sessionId === undefined) throw new Error('session/create 未返回 sessionId')

  const denied = await call(A, 'terminal/create', {
    agentId: sessionId,
    request: { id: missingId, cols: 80, rows: 24, shellPath: missingShell },
  }, { timeoutMs: 60_000 })
  const message = String(denied.error?.message ?? denied.value?.error ?? '')
  c.cmd('POST /api/terminal/create（shellPath 不存在）', denied.status,
    `ok=${denied.ok} code=${denied.error?.code ?? '-'} msg=${shape(message, 200)}`)

  const health = docker(['inspect', LANE.container, '--format', '{{.State.Health.Status}}'])
  c.cmd('docker inspect（健康状态）', health.exit, health.stdout)

  const normal = await call(A, 'terminal/create', {
    agentId: sessionId, request: { id: normalId, cols: 80, rows: 24 },
  }, { timeoutMs: 60_000 })
  c.cmd('POST /api/terminal/create（默认 bash 回归）', normal.status,
    `ok=${normal.ok} id=${normal.value?.id ?? 'none'} shell=${normal.value?.shell?.path ?? 'none'}`)

  const explicit = denied.ok !== true && /not available|unavailable|不存在|not found/i.test(message)
  const healthy = health.stdout === 'healthy'
  const recovered = normal.ok === true && normal.value?.shell?.path !== undefined
  c.assert('请求不存在的 shell 明确报错（非静默成功）', explicit, shape(message, 180))
  c.assert('失败后容器仍 healthy（不崩）', healthy, health.stdout)
  c.assert('随后默认 bash create 成功（服务未被损坏）', recovered, `id=${normal.value?.id ?? 'none'}`)

  const ok = explicit && healthy && recovered
  row = c.finish({
    status: ok ? STATUS.PASS : STATUS.FAIL,
    title: 'shell 不存在时明确报错、容器不崩',
    expected: '不存在的 shellPath → 明确错误；容器 healthy；默认 bash 仍可建终端',
    actual: `explicit=${explicit} healthy=${healthy} recovered=${recovered}`,
    notes: [
      `lane=${LANE.container}（独立测试容器，未触碰生产）`,
      '运行镜像保证 bash 存在，无法制造“bash 缺失”；本用例走同一 resolveShell 错误分支（请求不存在的 shellPath），并核对容器/服务不受影响',
      'rc.5 上游错误原文：Selected shell is not available in this execution environment',
    ],
    artifacts: ['cmd.log'],
  })
} catch (error) {
  c.note(`执行异常：${String(error?.message ?? error).slice(0, 300)}`)
  row = c.finish({
    status: STATUS.FAIL,
    title: 'shell 不存在时明确报错、容器不崩',
    expected: '不存在的 shellPath → 明确错误；容器 healthy；默认 bash 仍可建终端',
    actual: `异常：${String(error?.message ?? error).slice(0, 200)}`,
    artifacts: ['cmd.log'],
  })
}
console.log(`[TERM-014] ${row.status}`)