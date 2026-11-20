#!/usr/bin/env node
/**
 * E1 · RC5-TERM-012：两会话各开终端 → 互不可见/互不输入。
 *
 * 纯 unary API 即可判定（不需要模型回合）：
 *   1) 同账号建两个会话；
 *   2) 各 terminal/create 一个终端；
 *   3) 各自 terminal/list 只出现自己的终端 id；
 *   4) 用会话 1 的身份读会话 2 的终端 id → 必须失败（跨 session 的终端归属隔离）。
 *
 * 用法：node artifacts/rc5/E1/TERM/term-012.mjs
 */
import { Case, STATUS, shape } from '../_lib/evidence.mjs'
import { LANE, call, docker, sessions } from '../_lib/env.mjs'

const s = await sessions()
const admin = s.admin
const c = new Case('TERM', 'RC5-TERM-012')

const created = []
let row
try {
  for (const label of ['a', 'b']) {
    const session = await call(admin.cookie, 'session/create', { request: {} }, { timeoutMs: 30_000 })
    const sessionId = session.value?.sessionId
    c.cmd(`POST /api/session/create（会话 ${label}）`, session.status, `sessionId=${sessionId ?? 'none'}`)
    if (sessionId === undefined) throw new Error('session/create 未返回 sessionId')
    const terminal = await call(admin.cookie, 'terminal/create', {
      agentId: sessionId,
      request: { id: `t12-${label}`, cols: 80, rows: 24 },
    }, { timeoutMs: 60_000 })
    c.cmd(`POST /api/terminal/create（会话 ${label}）`, terminal.status, terminal.ok ? shape(terminal.value) : shape(terminal.error))
    created.push({ label, sessionId, terminalId: terminal.value?.id ?? terminal.value?.terminalId ?? `t12-${label}`, ok: terminal.ok })
  }

  const [first, second] = created
  const listA = await call(admin.cookie, 'terminal/list', { sessionId: first.sessionId }, { timeoutMs: 30_000 })
  const listB = await call(admin.cookie, 'terminal/list', { sessionId: second.sessionId }, { timeoutMs: 30_000 })
  const idsA = (listA.value ?? []).map(item => item.id)
  const idsB = (listB.value ?? []).map(item => item.id)
  c.cmd('POST /api/terminal/list（两个会话）', 200, `A=${JSON.stringify(idsA)} B=${JSON.stringify(idsB)}`)

  // 输入面 = terminal/attach（stream；TERM-005a 已测跨租户 attach 拒绝）。
  // 上游 close 是按会话 owner 作用域（terminal-controller close: owner(agent).terminals），
  // 用会话 A 关 B 的终端只会记进 A 自己的 closedIds、幂等返回 ok=true，不碰 B 的进程。
  // 因此判定「互不操作」不能看 close.ok，必须回看 B：终端仍在 running、标题未变、rename 被拒。
  const crossClose = await call(admin.cookie, 'terminal/close', {
    agentId: first.sessionId,
    id: idsB[0] ?? second.terminalId,
  }, { timeoutMs: 30_000 })
  c.cmd('POST /api/terminal/close（会话 A 关 B 的终端）', crossClose.status, `ok=${crossClose.ok} ${shape(crossClose.error ?? crossClose.value, 160)}`)

  const crossRename = await call(admin.cookie, 'terminal/rename', {
    agentId: first.sessionId,
    id: idsB[0] ?? second.terminalId,
    title: 'cross-renamed',
  }, { timeoutMs: 30_000 })
  c.cmd('POST /api/terminal/rename（会话 A 改名 B 的终端）', crossRename.status, `ok=${crossRename.ok} ${shape(crossRename.error ?? crossRename.value, 160)}`)

  // B 视角复验：A 的 cross close/rename 不得改动 B 的终端
  const listB2 = await call(admin.cookie, 'terminal/list', { sessionId: second.sessionId }, { timeoutMs: 30_000 })
  const bAfter = (listB2.value ?? []).find(item => item.id === idsB[0])
  c.cmd('POST /api/terminal/list（B 复验）', listB2.status,
    `state=${bAfter?.state ?? 'missing'} title=${bAfter?.title ?? 'none'}`)

  const bothCreated = created.every(item => item.ok === true)
  const isolated = idsA.length > 0 && idsB.length > 0
    && !idsA.includes(idsB[0]) && !idsB.includes(idsA[0])
  const crossCloseNoLeak = bAfter?.state === 'running' && bAfter?.title === 'bash'
  const crossRenameDenied = crossRename.ok !== true
  const crossDenied = crossCloseNoLeak && crossRenameDenied
  c.assert('两个会话各自建出终端', bothCreated, shape(created))
  c.assert('list 只见自己的终端（互不可见）', isolated, `A=${JSON.stringify(idsA)} B=${JSON.stringify(idsB)}`)
  c.assert('跨会话 close 不伤及对方终端（B 仍 running、标题未变）', crossCloseNoLeak,
    `close_ok=${crossClose.ok} B.state=${bAfter?.state ?? 'missing'} B.title=${bAfter?.title ?? 'none'}`)
  c.assert('跨会话 rename 被拒（terminal/unavailable）', crossRenameDenied, `rename_ok=${crossRename.ok} ${shape(crossRename.error, 120)}`)
  row = c.finish({
    status: bothCreated && isolated && crossDenied ? STATUS.PASS : STATUS.FAIL,
    title: '两会话各开终端：互不可见/互不输入',
    expected: '各自 list 只见自己的终端；A 的跨会话 close 不伤 B 的终端；跨会话 rename 被拒',
    actual: `created=${bothCreated} isolated=${isolated} cross_close_no_leak=${crossCloseNoLeak} cross_rename_denied=${crossRenameDenied}`,
    notes: [
      `lane=${LANE.container}（独立测试容器，未触碰生产）`,
      'terminal id 由 create 返回；跨会话探测使用对方真实 id',
      '上游 close 语义=会话 owner 作用域 + 幂等（owner.closedIds），ok=true 不代表关掉了对方终端；判定以 B 复验为准',
    ],
    artifacts: ['cmd.log'],
  })
} catch (error) {
  c.note(`执行异常：${String(error?.message ?? error).slice(0, 300)}`)
  row = c.finish({
    status: STATUS.FAIL,
    title: '两会话各开终端：互不可见/互不输入',
    expected: '各自 list 只见自己的终端；跨会话 read/write 失败',
    actual: `异常：${String(error?.message ?? error).slice(0, 200)}`,
    artifacts: ['cmd.log'],
  })
} finally {
  for (const item of created) {
    if (item.sessionId === undefined) continue
    await call(admin.cookie, 'terminal/close', { agentId: item.sessionId, id: item.terminalId }, { timeoutMs: 20_000 }).catch(() => undefined)
  }
}

console.log(`[TERM-012] ${row.status}`)