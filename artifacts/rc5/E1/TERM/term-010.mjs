#!/usr/bin/env node
/**
 * E1 · RC5-TERM-010：close 后再 attach —— 状态正确、无幽灵终端。
 *
 * rc.5 语义（terminal-controller）：
 *   - close 把 id 记入 owner.closedIds 并从 owner.terminals 删除；
 *   - attach/retain 走 terminal(agent,id) → 找不到即 terminal/unavailable；
 *   - create 同 id 走 requireOpen → "Terminal was closed in this Session"（不可复活）；
 *   - list 不再返回该 id。
 *
 * 用法：node artifacts/rc5/E1/TERM/term-010.mjs
 */
import { Case, STATUS, shape } from '../_lib/evidence.mjs'
import { LANE, call, sessions } from '../_lib/env.mjs'
import { openMuxSocket } from '../_lib/ws.mjs'

const s = await sessions()
const A = s.admin.cookie
const c = new Case('TERM', 'RC5-TERM-010')
const token = Date.now().toString(36)
const terminalId = `t10-${token}`

async function probeStream(endpoint, args) {
  const socket = await openMuxSocket({ port: LANE.port, cookie: A }).catch(error => ({ error }))
  if (socket.error !== undefined) return { kind: 'connect-failed', message: socket.error.message }
  const streamId = `t10-${Date.now().toString(36)}`
  socket.send({ type: 'open', streamId, endpoint, payload: { args } })
  const frame = await socket.waitMessage(row => row.streamId === streamId && ['item', 'error', 'end'].includes(row.type), 10_000)
    .catch(error => ({ timeout: error.message }))
  socket.close()
  if (frame.timeout !== undefined) return { kind: 'timeout' }
  if (frame.type === 'error') return { kind: 'error', code: frame.error?.code ?? '', message: frame.error?.message ?? '' }
  if (frame.type === 'end') return { kind: 'end' }
  return { kind: 'data', sample: frame.value }
}

let row
try {
  const session = await call(A, 'session/create', { request: {} }, { timeoutMs: 30_000 })
  const sessionId = session.value?.sessionId
  if (sessionId === undefined) throw new Error('session/create 未返回 sessionId')

  const created = await call(A, 'terminal/create', {
    agentId: sessionId, request: { id: terminalId, cols: 80, rows: 24 },
  }, { timeoutMs: 60_000 })
  c.cmd('POST /api/terminal/create', created.status, `id=${created.value?.id ?? 'none'} state=${created.value?.state ?? 'none'}`)
  if (created.ok !== true) throw new Error(`create 失败: ${shape(created.error, 160)}`)

  const closed = await call(A, 'terminal/close', { agentId: sessionId, id: terminalId }, { timeoutMs: 30_000 })
  c.cmd('POST /api/terminal/close', closed.status, `ok=${closed.ok} code=${closed.error?.code ?? '-'}`)

  const attach = await probeStream('terminal/attach', { agentId: sessionId, id: terminalId })
  c.cmd('WS terminal/attach（close 后）', 0, shape(attach, 240))
  const retain = await probeStream('terminal/retain', { sessionId, id: terminalId })
  c.cmd('WS terminal/retain（close 后）', 0, shape(retain, 240))

  const listed = await call(A, 'terminal/list', { sessionId }, { timeoutMs: 20_000 })
  const ids = (listed.value ?? []).map(item => item.id)
  c.cmd('POST /api/terminal/list（close 后）', listed.status, `ids=${JSON.stringify(ids)}`)
  const absent = !ids.includes(terminalId)

  const recreate = await call(A, 'terminal/create', {
    agentId: sessionId, request: { id: terminalId, cols: 80, rows: 24 },
  }, { timeoutMs: 30_000 })
  c.cmd('POST /api/terminal/create（同 id 复活尝试）', recreate.status,
    `ok=${recreate.ok} code=${recreate.error?.code ?? '-'} msg=${shape(recreate.error?.message, 140)}`)
  const noResurrect = recreate.ok !== true && /closed in this Session/i.test(String(recreate.error?.message ?? ''))

  const attachDenied = attach.kind === 'error' && String(attach.code).includes('terminal/unavailable')
  const retainDenied = retain.kind === 'error' && String(retain.code).includes('terminal/unavailable')
  c.assert('close 后 attach 被 terminal/unavailable 拒绝', attachDenied, shape(attach, 160))
  c.assert('close 后 retain 被 terminal/unavailable 拒绝', retainDenied, shape(retain, 160))
  c.assert('close 后 list 不再返回该终端（无幽灵）', absent, `ids=${JSON.stringify(ids)}`)
  c.assert('同 id 不可复活（closed in this Session）', noResurrect, shape(recreate.error?.message, 140))

  const ok = attachDenied && retainDenied && absent && noResurrect
  row = c.finish({
    status: ok ? STATUS.PASS : STATUS.FAIL,
    title: 'close 后再 attach：状态正确、无幽灵终端',
    expected: 'attach/retain 拒绝、list 不含该 id、同 id 不能复活（closedIds 生效）',
    actual: `attach=${attach.kind}/${attach.code ?? '-'} retain=${retain.kind}/${retain.code ?? '-'} absent=${absent} resurrect=${recreate.ok}`,
    notes: [
      `lane=${LANE.container}（独立测试容器，未触碰生产）`,
      'rc.5 close 语义：从 owner.terminals 删除并记 closedIds；本用例核对四条外部可见面',
    ],
    artifacts: ['cmd.log'],
  })
} catch (error) {
  c.note(`执行异常：${String(error?.message ?? error).slice(0, 300)}`)
  row = c.finish({
    status: STATUS.FAIL,
    title: 'close 后再 attach：状态正确、无幽灵终端',
    expected: 'attach/retain 拒绝、list 不含该 id、同 id 不能复活',
    actual: `异常：${String(error?.message ?? error).slice(0, 200)}`,
    artifacts: ['cmd.log'],
  })
}
console.log(`[TERM-010] ${row.status}`)