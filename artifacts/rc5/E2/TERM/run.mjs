#!/usr/bin/env node
/**
 * E2 · TERM 套件（51 §3.7；54 §6.3）。
 *
 * 数据来源两段：
 *   1) scripts/verify-terminal-guard.mjs（51 §4 指定脚本）产出 report.json：
 *      TERM-004 六个 unary 动作 + TERM-007 配置；本 runner 落成每用例证据。
 *   2) 本 runner 补 TERM-005（attach/retain/watch 三个流动作，走 /api/remote.mux
 *      WebSocket，HTTP unary 面不承载）、TERM-006（A 自己 9 动作）、TERM-008
 *      （宿主终端列表不可见）。
 *
 * 判定口径：
 *   - TERM-005 只有 B 拿到 tenant-denied **才算策略拒绝**；若 B 与 A 同错
 *     （terminal/unavailable，无活终端）记 NOTRUN，不冒充通过。
 *   - B 若拿到 data/空流/订阅成功 → 跨租户流可达，P0 FAIL。
 *   - TERM-006 的 8 项断言按「rename/retain 在 close 之前」的真实生命周期排序；
 *     create 走上游 terminal-bash（rc.5 已自带真实 session 的沙箱 argv）。
 */
import { existsSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { Case, STATUS, summaryOf, writeSummary, shape } from '../_lib/evidence.mjs'
import { LANE, run, sleep, sessions, call, gitHead } from '../_lib/env.mjs'
import { openMuxSocket } from '../_lib/ws.mjs'

const suite = 'TERM'
const startedAt = new Date().toISOString()
const rows = []

function record(c, status, title, expected, actual, notes = []) {
  const row = c.finish({ status, title, expected, actual, notes, artifacts: ['cmd.log'] })
  rows.push(row)
  return row
}

const reportPath = join(LANE.evidenceRoot, 'TERM', 'report.json')
// 官方脚本必须由本套件现场执行（旧版只读 report.json → 复跑拿到的是上一轮陈旧结论）。
// 先删旧报告：脚本崩溃/未落盘时行变 NOTRUN，绝不把上一轮结果当本轮。
rmSync(reportPath, { force: true })
const guard = run('node', ['scripts/verify-terminal-guard.mjs',
  '--base', LANE.base,
  '--accounts-file', LANE.accountsFile,
  '--data-root', LANE.dataRoot,
  '--container', LANE.container,
  '--json', reportPath,
], { timeout: 300_000 })
const official = existsSync(reportPath) ? JSON.parse(readFileSync(reportPath, 'utf8')) : { cases: [] }
const officialById = new Map((official.cases ?? []).map(row => [row.id, row]))
const officialCommand = guard.display

/* ---------------------------------------------- 官方脚本行落证据（004 / 007） */

const titles = {
  'RC5-TERM-004a': 'B 用 A 的 sessionId 调 terminal/list 必须被拒',
  'RC5-TERM-004b': 'B 用 A 的 sessionId 调 terminal/environment 必须被拒',
  'RC5-TERM-004c': 'B 用 A 的 sessionId 调 terminal/shells 必须被拒',
  'RC5-TERM-004d': 'B 用 A 的 sessionId 调 terminal/create 必须被拒',
  'RC5-TERM-004e': 'B 用 A 的 sessionId 调 terminal/close 必须被拒',
  'RC5-TERM-004f': 'B 用 A 的 sessionId 调 terminal/rename 必须被拒',
  'RC5-TERM-007': '配置 readUserTerminals=false / preferredShells=[bash] / terminal bundle 在',
}

for (const id of Object.keys(titles)) {
  const c = new Case(suite, id)
  const row = officialById.get(id)
  c.cmd(officialCommand, 0, `${row?.status ?? 'MISSING'} :: ${row?.detail ?? 'report 无该行'}`)
  if (row === undefined) {
    record(c, STATUS.NOTRUN, titles[id], '按 51 §3.7', 'report.json 无该行', ['官方脚本未输出该用例'])
    continue
  }
  record(c, row.status, titles[id], '按 51 §3.7', row.detail, [
    '本行由 scripts/verify-terminal-guard.mjs（51 §4 指定脚本）在同一次执行中产出；命令见上',
    ...(row.status === STATUS.FAIL ? ['跨租户可达 → 已按 lane 停线规则记 P0'] : []),
  ])
}

/* ---------------------------------------------- 活会话（供流动作/9 动作使用） */

const s = await sessions()

let victimSession
let victimTerm = 'e2-victim-term'
{
  const c = new Case(suite, 'RC5-TERM-SETUP')
  const created = await call(s.admin.cookie, 'session/create', { request: {} })
  victimSession = created.value?.sessionId ?? created.value?.id
  c.cmd('POST /api/session/create（A 建立活会话）', created.status,
    `ok=${created.ok} sessionId=${shape(victimSession, 64)}`)
  let termOk = false
  if (typeof victimSession === 'string') {
    const terminal = await call(s.admin.cookie, 'terminal/create', {
      agentId: victimSession, request: { id: victimTerm, cols: 80, rows: 24 },
    }, { timeoutMs: 60_000 })
    termOk = terminal.ok === true
    c.cmd('POST /api/terminal/create（A 建受害终端，供 005 用真实 id）', terminal.status,
      `ok=${terminal.ok} id=${terminal.value?.id ?? 'none'} state=${terminal.value?.state ?? 'none'} ${shape(terminal.error, 140)}`)
  }
  c.assert('拿到 A 的 sessionId', typeof victimSession === 'string')
  c.assert('A 建出受害终端（005 用真实 id，不用伪造 id）', termOk)
  record(c, typeof victimSession === 'string' && termOk ? STATUS.PASS : STATUS.FAIL,
    'A 建立活会话 + 受害终端（TERM 流动作受害者）',
    'session/create 返回 sessionId；terminal/create 建出 running 终端',
    `sessionId=${shape(victimSession, 64)} terminal=${termOk ? victimTerm : 'none'}`,
    ['辅助步骤，不计入 51 用例数'])
}

/* ---------------------------------------------- 流动作探针 */

async function probeStream(cookie, endpoint, args, waitMs = 12_000) {
  const streamId = `e2-term-${endpoint.replace(/\//g, '-')}-${Math.random().toString(36).slice(2, 8)}`
  const sock = await openMuxSocket({ host: '127.0.0.1', port: LANE.port, path: '/api/remote.mux', cookie })
  try {
    sock.send({ type: 'open', streamId, endpoint, payload: { args } })
    try {
      await sock.waitMessage(m => m.streamId === streamId && ['error', 'end', 'item'].includes(m.type), waitMs)
    } catch {
      // 超时也继续收集已有帧
    }
    await sleep(400)
    return { streamId, frames: sock.messages.filter(m => m.streamId === streamId) }
  } finally {
    sock.close()
  }
}

function classify(frames) {
  const error = frames.find(m => m.type === 'error')
  if (error !== undefined) return { kind: 'error', code: String(error.error?.code ?? ''), message: String(error.error?.message ?? ''), raw: error.error }
  const items = frames.filter(m => m.type === 'item')
  if (items.length > 0) return { kind: 'data', sample: items[0].value }
  const ended = frames.find(m => m.type === 'end')
  if (ended !== undefined) return { kind: 'empty' }
  return { kind: 'timeout' }
}

function denied(outcome) {
  const code = outcome.code ?? ''
  const message = outcome.message ?? ''
  return /tenant[-/]denied|forbidden|unauthori[sz]ed/i.test(code) || /不属于你的会话|tenant|denied|forbidden/i.test(message)
}

/* ---------------------------------------------- TERM-005 三个流动作 */

if (typeof victimSession === 'string') {
  const streamCases = [
    { id: 'RC5-TERM-005a', endpoint: 'terminal/attach', args: { agentId: victimSession, id: victimTerm } },
    { id: 'RC5-TERM-005b', endpoint: 'terminal/retain', args: { sessionId: victimSession, id: victimTerm } },
    { id: 'RC5-TERM-005c', endpoint: 'terminal/watch', args: { sessionId: victimSession } },
  ]
  for (const item of streamCases) {
    const c = new Case(suite, item.id)
    let asB
    let asA
    try {
      asB = await probeStream(s.userB.cookie, item.endpoint, item.args)
      c.cmd(`WS /api/remote.mux open ${item.endpoint} {agentId:A.sessionId}（B）`, 0, `frames=${shape(asB.frames, 400)}`)
    } catch (error) {
      c.cmd(`WS /api/remote.mux open ${item.endpoint}（B）`, 1, String(error?.message ?? error))
    }
    if (asB === undefined) {
      record(c, STATUS.NOTRUN, `B 用 A 的 session 开 ${item.endpoint} 流必须被拒`, '流被拒（tenant-denied）', 'WS 连接/握手失败，未取得流结论')
      continue
    }
    const b = classify(asB.frames)
    if (b.kind === 'data' || b.kind === 'empty') {
      // 订阅/数据面放行：再用 A 做对照，确认这是 A 的会话面而不是公共空流
      asA = await probeStream(s.admin.cookie, item.endpoint, item.args)
      c.cmd(`WS /api/remote.mux open ${item.endpoint}（A 对照）`, 0, `frames=${shape(asA.frames, 400)}`)
      record(c, STATUS.FAIL, `B 用 A 的 session 开 ${item.endpoint} 流必须被拒`,
        '流被拒绝；无数据泄漏',
        `B 未被拒（kind=${b.kind}）；B 帧=${shape(asB.frames, 300)}；A 帧=${shape(asA?.frames, 200)}`,
        ['流动作在 mux 面未按 session 绑定拒绝 → 跨租户流可达，P0'])
      continue
    }
    if (b.kind === 'error' && denied(b)) {
      record(c, STATUS.PASS, `B 用 A 的 session 开 ${item.endpoint} 流必须被拒`,
        '流被拒绝；无数据泄漏',
        `denied code=${b.code || '-'} message=${shape(b.message, 120)}`,
        ['由 /api/remote.mux 真实 WS 流打开帧验证（非静态清单核对）'])
      continue
    }
    // B 未拿到 deny：用 A 对照区分「策略缺失」与「资源不存在」
    asA = await probeStream(s.admin.cookie, item.endpoint, item.args)
    c.cmd(`WS /api/remote.mux open ${item.endpoint}（A 对照）`, 0, `frames=${shape(asA.frames, 400)}`)
    const a = classify(asA.frames)
    const sameError = b.kind === 'error' && a.kind === 'error' && b.code === a.code && b.message === a.message
    record(c, sameError ? STATUS.NOTRUN : STATUS.FAIL,
      `B 用 A 的 session 开 ${item.endpoint} 流必须被拒`,
      '流被拒绝（tenant-denied）；无数据泄漏',
      sameError
        ? `A/B 同错 ${b.code}/${shape(b.message, 100)}：资源不存在（create 的 P1）掩盖了授权判定，无法区分策略拒绝`
        : `B 未被显式拒绝：B=${b.kind}/${b.code ?? '-'}/${shape(b.message ?? b.sample, 120)}；A=${a.kind}/${a.code ?? '-'}`,
      sameError
        ? ['上游 terminal/create 因 `session.snapshotEvents is not a function`（P1）无法建活终端 → 无终端可 attach/retain/watch；P6 需在 create 修复后复跑']
        : ['B 未被拒且与 A 不同错 → 需人工复核 mux 流策略'])
  }
} else {
  for (const id of ['RC5-TERM-005a', 'RC5-TERM-005b', 'RC5-TERM-005c']) {
    const c = new Case(suite, id)
    c.note('缺少 A 的活会话，无法执行流探针')
    record(c, STATUS.NOTRUN, 'B 用 A 的 session 开终端流必须被拒', '流被拒', 'SETUP 失败：无 victimSession')
  }
}

/* ---------------------------------------------- TERM-006 A 自己 9 动作 */

if (typeof victimSession === 'string') {
  const c = new Case(suite, 'RC5-TERM-006')
  const results = {}
  // 生命周期顺序：create → rename → retain/watch → close。旧顺序 close 在
  // rename/retain 之前，终端已销毁 → 两条假红（TERM-006 复核 2026-11-20）。
  const unary = ['list', 'environment', 'shells', 'create', 'rename']
  for (const method of unary) {
    const params = method === 'list' ? { sessionId: victimSession } : { agentId: victimSession }
    if (method === 'create') params.request = { id: 'e2-a-term', cols: 80, rows: 24 }
    if (method === 'rename') { params.id = 'e2-a-term'; params.title = 'e2-renamed' }
    const result = await call(s.admin.cookie, `terminal/${method}`, params)
    results[method] = { ok: result.ok, code: result.error?.code ?? '', message: result.error?.message ?? '' }
    c.cmd(`POST /api/terminal/${method}（A）`, result.status,
      `ok=${result.ok} code=${result.error?.code ?? '-'} value=${shape(result.value, 160)} msg=${shape(result.error?.message, 120)}`)
  }
  for (const [method, args] of [
    ['attach', { agentId: victimSession, id: 'e2-a-term' }],
    ['retain', { sessionId: victimSession, id: 'e2-a-term' }],
    ['watch', { sessionId: victimSession }],
  ]) {
    const probe = await probeStream(s.admin.cookie, `terminal/${method}`, args)
    const outcome = classify(probe.frames)
    results[method] = { ok: outcome.kind === 'data' || outcome.kind === 'empty', code: outcome.code ?? '', message: outcome.message ?? '', stream: outcome.kind }
    c.cmd(`WS /api/remote.mux open terminal/${method}（A）`, 0, `frames=${shape(probe.frames, 300)}`)
  }
  {
    const closed = await call(s.admin.cookie, 'terminal/close', { agentId: victimSession, id: 'e2-a-term' })
    results.close = { ok: closed.ok, code: closed.error?.code ?? '', message: closed.error?.message ?? '' }
    c.cmd('POST /api/terminal/close（A，最后关闭）', closed.status,
      `ok=${closed.ok} code=${closed.error?.code ?? '-'} value=${shape(closed.value, 160)} msg=${shape(closed.error?.message, 120)}`)
  }
  const checks = ['list', 'environment', 'shells', 'create', 'close', 'rename', 'attach', 'retain', 'watch']
  const failed = checks.filter(name => results[name].ok !== true)
  for (const name of checks) c.assert(`A ${name} ok`, results[name].ok === true, `${results[name].code || '-'} ${shape(results[name].message, 80)}`)
  c.note('attach 用真实 mux WS open（payload.args={agentId,id}）执行；首个帧为 snapshot（屏幕/state/writable），与浏览器端同一条 Remote stream 路径')
  record(c, failed.length === 0 ? STATUS.PASS : STATUS.FAIL,
    'A 对同 session 调 9 个 terminal 动作全部成功、语义正确',
    '9/9 成功（environment/shells/list/create/close/rename + attach/retain/watch 三个流）',
    failed.length === 0
      ? '9/9 已断言动作成功'
      : `失败=${failed.join(',')}；${checks.filter(name => results[name].ok !== true).map(name => `${name}=${results[name].code}/${shape(results[name].message, 60)}`).join('；')}`,
    [
      'create 走 rc.5 terminal-bash 后端（spawn 内用真实 session 解析沙箱策略，PTY argv 已 confine）',
      '顺序=create → rename → attach/retain/watch → close（close 最后，避免「终端已销毁」假红）',
      '断言明细见 cmd.log（9 条 [ASSERT]）',
    ])
}

/* ---------------------------------------------- TERM-008 宿主终端列表不可见 */

{
  const c = new Case(suite, 'RC5-TERM-008')
  const bogus = 'session-00000000-0000-4000-8000-000000000000'
  const asAdmin = await call(s.admin.cookie, 'terminal/list', { sessionId: bogus })
  c.cmd('POST /api/terminal/list（A，伪造不存在的 sessionId）', asAdmin.status,
    `ok=${asAdmin.ok} value=${shape(asAdmin.value, 160)} code=${asAdmin.error?.code ?? '-'}`)
  const asB = await call(s.userB.cookie, 'terminal/list', { sessionId: bogus })
  c.cmd('POST /api/terminal/list（B，伪造不存在的 sessionId）', asB.status,
    `ok=${asB.ok} value=${shape(asB.value, 160)} code=${asB.error?.code ?? '-'}`)
  const patch = join(LANE.dataRoot, 'profiles', 'eterna-web', 'cordis.patch.yml')
  const patchText = existsSync(patch) ? readFileSync(patch, 'utf8') : ''
  const readUserTerminalsFalse = /readUserTerminals:\s*false/.test(patchText)
  c.note(`readUserTerminals=false:${readUserTerminalsFalse}`)
  // 伪造 sessionId 的资源 lookup 解析失败 → 网关直接 deny（A/B 同），不会落到
// 「列出宿主全部终端」的旧语义；拒绝与空数组都证明不可枚举宿主终端。
  const noHostList = asAdmin.ok !== true || (Array.isArray(asAdmin.value) && asAdmin.value.length === 0)
  const bNoHostList = asB.ok !== true || (Array.isArray(asB.value) && asB.value.length === 0)
  c.assert('伪造 sessionId 的 terminal/list 不返回宿主终端（拒绝或空数组均算）', noHostList && bNoHostList)
  c.assert('readUserTerminals=false', readUserTerminalsFalse)
  record(c, noHostList && bNoHostList && readUserTerminalsFalse ? STATUS.PASS : STATUS.FAIL,
    '读取“用户终端列表”类能力不可见/不可调（不暴露宿主终端）',
    '伪造 sessionId 不返回宿主终端（拒绝或空数组）；readUserTerminals=false',
    `A=${asAdmin.ok ? shape(asAdmin.value, 80) : asAdmin.error?.code ?? 'denied'} B=${asB.ok ? shape(asB.value, 80) : asB.error?.code ?? 'denied'} readUserTerminals=false:${readUserTerminalsFalse}`,
    ['terminal/list 只按 sessionId 取该会话的 retained 终端；伪造 id 的 lookup 解析失败即 deny，没有“枚举宿主用户终端”的入参面'])
}

/* ---------------------------------------------- 浏览器/模型回合轨（同一镜像的旁证） */

/** 读取旁证轨 status；文件缺失/格式不符时返回 undefined（记 NOTRUN，不冒充通过）。 */
function evidenceStatus(file, pick = value => value?.status) {
  if (!existsSync(file)) return undefined
  try {
    return pick(JSON.parse(readFileSync(file, 'utf8')))
  } catch {
    return undefined
  }
}

for (const [id, title, file, resolveStatus, lane] of [
  ['RC5-TERM-002', '会话侧栏 terminal 面板可见/可开/可输入；首次按键人接管后 Agent 只读',
    join(LANE.evidenceRoot, 'LLM', 'term-002-result.json'), value => value?.status, 'LLM/term-002.mjs（Playwright 真键盘）'],
  ['RC5-TERM-003', '逐个调用 rc.5 注册的 6 个 terminal_* 工具',
    join(LANE.evidenceRoot, 'LLM', 'summary.json'),
    value => (value?.cases ?? []).find(row => row.id === 'RC5-TERM-003')?.status, 'LLM/run.mjs（确定性模型回合）'],
  ['RC5-TERM-011', 'Agent 终端 rename 后重开页：名称与保留状态持久',
    join(LANE.evidenceRoot, 'TERM', 'term-011-result.json'), value => value?.status, 'TERM/term-011.mjs（同 context 重开页）'],
]) {
  const c = new Case(suite, id)
  const status = evidenceStatus(file, resolveStatus)
  c.cmd(`旁证轨 ${lane}`, status === STATUS.PASS ? 0 : 1, `status=${status ?? 'missing'} file=${file}`)
  if (status === STATUS.PASS) {
    record(c, STATUS.PASS, title, '按 51 §3.7',
      `同镜像旁证轨 PASS（${lane}）；证据=${file}`,
      ['本行由浏览器/模型回合轨产出；TERM 套件仅做汇总引用，不重跑等效流程'])
  } else {
    record(c, STATUS.NOTRUN, title, '按 51 §3.7',
      `旁证轨未给 PASS（status=${status ?? 'missing'}）；不冒充通过`,
      [`先跑 ${lane}，再汇总本套件`])
  }
}

if (typeof victimSession === 'string') {
  const cleanup = await call(s.admin.cookie, 'terminal/close', { agentId: victimSession, id: victimTerm })
  console.log(`[TERM] cleanup victim terminal ok=${cleanup.ok}`)
}

const summary = summaryOf(rows, {
  suite, env: {
    commit: gitHead(), imageTag: LANE.imageTag, imageId: LANE.imageId, container: LANE.container,
    base: LANE.base, dataRoot: LANE.dataRoot, startedAt,
    halted: rows.some(row => row.status === STATUS.FAIL),
    haltReason: rows.filter(row => row.status === STATUS.FAIL).map(row => row.id).join(', '),
  },
})
summary.officialReport = { path: 'artifacts/rc5/E2/TERM/report.json', counts: official.counts ?? {} }
writeSummary(suite, summary)
console.log(`[TERM] PASS=${summary.pass} FAIL=${summary.fail} SKIP=${summary.skip} NOTRUN=${summary.notrun} halted=${summary.halted}`)