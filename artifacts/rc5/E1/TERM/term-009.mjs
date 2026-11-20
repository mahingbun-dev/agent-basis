#!/usr/bin/env node
/**
 * E1 · RC5-TERM-009：长进程「切页再回」——进程存活、输出连续。
 *
 * 判定面（rc.5 语义：attach 是唯一输入/输出通道，断开 attach 等价用户离开该页，
 * PTY 进程仍归 Session owner 持有）：
 *   1) create 终端 → attach（拿到 snapshot）；
 *   2) 上行 write 启动 120 次 tick 循环（每 0.25s 一行）；
 *   3) 断开 attach（模拟切页离开），等 3s；
 *   4) 重新 attach：首个帧应是 snapshot 且 state=running；屏幕里的 tick 序号
 *      必须比断开前更靠后（离开期间输出仍在累积）；
 *   5) Ctrl-C 收尾 + close。
 *
 * 用法：node artifacts/rc5/E1/TERM/term-009.mjs
 */
import { Case, STATUS, shape } from '../_lib/evidence.mjs'
import { LANE, call, sessions, sleep } from '../_lib/env.mjs'
import { openMuxSocket } from '../_lib/ws.mjs'

const s = await sessions()
const A = s.admin.cookie
const c = new Case('TERM', 'RC5-TERM-009')
const token = Date.now().toString(36)
const terminalId = `t09-${token}`

let sessionId
let maxBefore = -1
let maxAfter = -1
let aliveAfter = false
let stateAfter = ''
let reattachSnapshot = false

function ticksOf(text) {
  let max = -1
  for (const match of String(text).matchAll(/tick-(\d+)/g)) max = Math.max(max, Number(match[1]))
  return max
}

async function openAttach() {
  const socket = await openMuxSocket({ port: LANE.port, cookie: A })
  const streamId = `t09-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`
  socket.send({ type: 'open', streamId, endpoint: 'terminal/attach', payload: { args: { agentId: sessionId, id: terminalId } } })
  const first = await socket.waitMessage(row => row.streamId === streamId && row.type === 'item', 15_000)
  return { socket, streamId, first }
}

function collectText(frames) {
  return frames.map(frame => JSON.stringify(frame.value ?? frame.error ?? '')).join('\n')
}

let row
try {
  const session = await call(A, 'session/create', { request: {} }, { timeoutMs: 30_000 })
  sessionId = session.value?.sessionId
  if (sessionId === undefined) throw new Error('session/create 未返回 sessionId')
  const created = await call(A, 'terminal/create', {
    agentId: sessionId, request: { id: terminalId, cols: 80, rows: 24 },
  }, { timeoutMs: 60_000 })
  c.cmd('POST /api/terminal/create', created.status, `id=${created.value?.id ?? 'none'} state=${created.value?.state ?? 'none'}`)
  if (created.ok !== true) throw new Error(`create 失败: ${shape(created.error, 160)}`)

  const first = await openAttach()
  const firstText = collectText(first.socket.messages.filter(row => row.streamId === first.streamId))
  maxBefore = ticksOf(firstText)
  c.cmd('WS terminal/attach（首次）', 0, `${shape(first.first.value, 240)}`)

  first.socket.send({
    type: 'item',
    streamId: first.streamId,
    value: { type: 'write', sequence: 1, data: 'for i in $(seq 1 120); do echo tick-$i; sleep 0.25; done\n' },
  })
  // 等循环起跑并确认至少推进到 tick-3
  const started = await first.socket.waitMessage(row => row.streamId === first.streamId
    && JSON.stringify(row).includes('tick-3'), 15_000).catch(() => undefined)
  maxBefore = Math.max(maxBefore, ticksOf(JSON.stringify(started ?? first.socket.messages)))
  c.cmd('WS 上行 item write（启动 tick 循环）', started === undefined ? 1 : 0,
    `saw_tick3=${started !== undefined} max_before=${maxBefore}`)

  // 切页：断开 attach（PTY 不随 attach 生命周期结束）
  first.socket.close()
  await sleep(3_000)

  const second = await openAttach()
  const snapshot = second.first.value?.type === 'snapshot' ? second.first.value : undefined
  reattachSnapshot = snapshot !== undefined
  stateAfter = snapshot?.info?.state ?? ''
  aliveAfter = stateAfter === 'running'
  maxAfter = ticksOf(JSON.stringify(snapshot?.screen ?? ''))
  // snapshot 屏幕只含可见区；不够判连续性时再等一帧 output
  if (maxAfter < 0) {
    const output = await second.socket.waitMessage(row => row.streamId === second.streamId
      && row.type === 'item' && row.value?.type === 'output', 8_000).catch(() => undefined)
    maxAfter = ticksOf(JSON.stringify(output?.value ?? ''))
  }
  c.cmd('WS terminal/attach（切页再回）', aliveAfter ? 0 : 1,
    `snapshot=${reattachSnapshot} state=${stateAfter || 'none'} max_after=${maxAfter} screen=${shape(snapshot?.screen ?? '', 200)}`)

  // Ctrl-C 终止循环（新 attach 的 sequence 从 1 起）
  second.socket.send({ type: 'item', streamId: second.streamId, value: { type: 'write', sequence: 1, data: '\u0003' } })
  await sleep(500)
  second.socket.close()

  const continued = maxBefore >= 0 && maxAfter > maxBefore + 2
  c.assert('断开 attach 后终端仍 running（进程未被回收）', aliveAfter, `state=${stateAfter || 'none'}`)
  c.assert('重新 attach 首帧是 snapshot（屏幕恢复）', reattachSnapshot, shape(snapshot?.screen ?? '', 100))
  c.assert('离开期间输出连续（tick 序号推进 > 2）', continued, `before=${maxBefore} after=${maxAfter}`)
  const ok = aliveAfter && reattachSnapshot && continued
  row = c.finish({
    status: ok ? STATUS.PASS : STATUS.FAIL,
    title: '长进程切页再回：进程存活、输出连续',
    expected: '断开/重连 attach 后 PTY 仍 running；screen 恢复且 tick 序号在离开期间继续推进',
    actual: `alive=${aliveAfter} snapshot=${reattachSnapshot} before=${maxBefore} after=${maxAfter}`,
    notes: [
      `lane=${LANE.container}（独立测试容器，未触碰生产）`,
      '「切页」在进程面的等价操作=断开 attach 再重连（rc.5 的 attach/retain 就是页签生命周期）；不改容器、不重启',
      '循环 120 次 × 0.25s ≈ 30s，断开 3s 足以区分「输出继续」与「重连重放旧屏」',
    ],
    artifacts: ['cmd.log'],
  })
} catch (error) {
  c.note(`执行异常：${String(error?.message ?? error).slice(0, 300)}`)
  row = c.finish({
    status: STATUS.FAIL,
    title: '长进程切页再回：进程存活、输出连续',
    expected: '断开/重连 attach 后 PTY 仍 running；screen 恢复且输出连续',
    actual: `异常：${String(error?.message ?? error).slice(0, 200)}`,
    artifacts: ['cmd.log'],
  })
} finally {
  if (sessionId !== undefined) {
    await call(A, 'terminal/close', { agentId: sessionId, id: terminalId }, { timeoutMs: 20_000 }).catch(() => undefined)
  }
}
console.log(`[TERM-009] ${row?.status ?? 'FAIL'}`)