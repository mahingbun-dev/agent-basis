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
 *     （terminal/unavailable，因上游 create 的 P1 无活终端）记 NOTRUN，不冒充通过。
 *   - B 若拿到 data/空流/订阅成功 → 跨租户流可达，P0 FAIL。
 *   - TERM-006 的 create/rename 失败是上游 `session.snapshotEvents is not a
 *     function`（E1 已报 P1），不是租户泄漏；本行按 51 预期如实记 FAIL。
 */
import { existsSync, readFileSync } from 'node:fs'
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
const official = existsSync(reportPath) ? JSON.parse(readFileSync(reportPath, 'utf8')) : { cases: [] }
const officialById = new Map((official.cases ?? []).map(row => [row.id, row]))
const officialCommand = 'node scripts/verify-terminal-guard.mjs --base http://127.0.0.1:3119 --accounts-file <0600> --data-root <E2 数据根> --container rc5-e2suite --json artifacts/rc5/E2/TERM/report.json'

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
{
  const c = new Case(suite, 'RC5-TERM-SETUP')
  const created = await call(s.admin.cookie, 'session/create', { request: {} })
  victimSession = created.value?.sessionId ?? created.value?.id
  c.cmd('POST /api/session/create（A 建立活会话）', created.status,
    `ok=${created.ok} sessionId=${shape(victimSession, 64)}`)
  c.assert('拿到 A 的 sessionId', typeof victimSession === 'string')
  record(c, typeof victimSession === 'string' ? STATUS.PASS : STATUS.FAIL,
    'A 建立活会话（TERM 流动作受害者）',
    'session/create 返回 sessionId',
    typeof victimSession === 'string' ? `sessionId=${victimSession}` : shape(created.error ?? created.text, 200),
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
    { id: 'RC5-TERM-005a', endpoint: 'terminal/attach', args: { agentId: victimSession, id: 'e2-hijack' } },
    { id: 'RC5-TERM-005b', endpoint: 'terminal/retain', args: { sessionId: victimSession, id: 'e2-hijack' } },
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
  const unary = ['list', 'environment', 'shells', 'create', 'close', 'rename']
  for (const method of unary) {
    const params = method === 'list' ? { sessionId: victimSession } : { agentId: victimSession }
    if (method === 'create') params.request = { id: 'e2-a-term', cols: 80, rows: 24 }
    if (method === 'close') params.id = 'e2-a-term'
    if (method === 'rename') { params.id = 'e2-a-term'; params.title = 'e2-renamed' }
    const result = await call(s.admin.cookie, `terminal/${method}`, params)
    results[method] = { ok: result.ok, code: result.error?.code ?? '', message: result.error?.message ?? '' }
    c.cmd(`POST /api/terminal/${method}（A）`, result.status,
      `ok=${result.ok} code=${result.error?.code ?? '-'} value=${shape(result.value, 160)} msg=${shape(result.error?.message, 120)}`)
  }
  for (const [method, args] of [
    ['retain', { sessionId: victimSession, id: 'e2-a-term' }],
    ['watch', { sessionId: victimSession }],
  ]) {
    const probe = await probeStream(s.admin.cookie, `terminal/${method}`, args)
    const outcome = classify(probe.frames)
    results[method] = { ok: outcome.kind === 'data' || outcome.kind === 'empty', code: outcome.code ?? '', message: outcome.message ?? '', stream: outcome.kind }
    c.cmd(`WS /api/remote.mux open terminal/${method}（A）`, 0, `frames=${shape(probe.frames, 300)}`)
  }
  const checks = ['list', 'environment', 'shells', 'create', 'close', 'rename', 'retain', 'watch']
  const failed = checks.filter(name => results[name].ok !== true)
  for (const name of checks) c.assert(`A ${name} ok`, results[name].ok === true, `${results[name].code || '-'} ${shape(results[name].message, 80)}`)
  c.note('terminal/attach 的 A 侧调用未被本 harness 覆盖：裸 WS open 帧报 `Terminal attachment requires a Remote invocation`（浏览器端以 Remote invocation 形态带 uplink 调用），故不计入断言；B 侧策略拒绝已由 TERM-005a 验证')
  record(c, failed.length === 0 ? STATUS.PASS : STATUS.FAIL,
    'A 对同 session 调 9 个 terminal 动作全部成功、语义正确（attach 除外，见备注，共 8 项断言）',
    '9/9 成功（attach 由浏览器 Remote invocation 形态承载）',
    failed.length === 0
      ? '8/8 已断言动作成功；attach 见备注'
      : `失败=${failed.join(',')}；create=${results.create.code}/${shape(results.create.message, 80)}；rename=${results.rename.code}/${shape(results.rename.message, 80)}`,
    [
      'create 失败码 gateway/internal `session.snapshotEvents is not a function`，与 E1 同根因（P1）；不是租户泄漏',
      'rename/retain 因 create 失败而报 terminal/unavailable（无终端可改名/保留）',
      '断言明细见 cmd.log（8 条 [ASSERT]）',
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
  const noHostList = asAdmin.ok === true && Array.isArray(asAdmin.value) && asAdmin.value.length === 0
  const bNoHostList = asB.ok === true && Array.isArray(asB.value) && asB.value.length === 0
  c.assert('伪造 sessionId 的 terminal/list 返回空（无宿主终端枚举）', noHostList && bNoHostList)
  c.assert('readUserTerminals=false', readUserTerminalsFalse)
  record(c, noHostList && bNoHostList && readUserTerminalsFalse ? STATUS.PASS : STATUS.FAIL,
    '读取“用户终端列表”类能力不可见/不可调（不暴露宿主终端）',
    '伪造 sessionId 得到空列表；readUserTerminals=false',
    `A=${shape(asAdmin.value, 80)} B=${shape(asB.value, 80)} readUserTerminals=false:${readUserTerminalsFalse}`,
    ['terminal/list 只按 sessionId 取该会话的 retained 终端，没有“枚举宿主用户终端”的入参面'])
}

/* ---------------------------------------------- 需要 UI / 模型回合 / 活终端 */

for (const [id, status, title, reason] of [
  ['RC5-TERM-002', STATUS.SKIP, '会话侧栏 terminal 面板首键人接管', '需要浏览器键盘实测；且上游 create P1 使活终端建不出来，UI 套件另测面板可达性'],
  ['RC5-TERM-003', STATUS.SKIP, '逐个调用 rc.5 的 6 个 terminal_* 工具', '需要模型回合触发工具调用（tools/list 可见 ≠ 可调用）'],
  ['RC5-TERM-011', STATUS.SKIP, 'rename/retain 后刷新名称/保留状态持久', '依赖 create 成功；被同一 P1（session.snapshotEvents）阻断'],
]) {
  const c = new Case(suite, id)
  c.note(reason)
  record(c, status, title, '按 51 §3.7', `未执行：${reason}`, [])
}

const summary = summaryOf(rows, {
  suite, env: {
    commit: gitHead(), imageTag: LANE.imageTag, imageId: LANE.imageId, container: LANE.container,
    base: LANE.base, dataRoot: LANE.dataRoot, startedAt,
    halted: rows.some(row => row.status === STATUS.FAIL && row.id.startsWith('RC5-TERM-004')),
    haltReason: 'RC5-TERM-004b/c：B 读到 A 的 cwd/shells（跨租户）',
  },
})
summary.officialReport = { path: 'artifacts/rc5/E2/TERM/report.json', counts: official.counts ?? {} }
writeSummary(suite, summary)
console.log(`[TERM] PASS=${summary.pass} FAIL=${summary.fail} SKIP=${summary.skip} NOTRUN=${summary.notrun} halted=${summary.halted}`)