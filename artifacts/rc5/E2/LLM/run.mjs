#!/usr/bin/env node
/**
 * E2 · LLM 套件：确定性假模型回合验收（MCPS-003 / TERM-003 / MCPP-019/020/022）。
 *
 * 背景：这 5 条是 P0 里唯一需要「模型回合」才能触达工具管线的用例；E1/E2 无
 * LLM 凭据，真模型也不可复现。做法是用本地 OpenAI 兼容夹具（fake-llm-server.mjs）
 * 让「模型选哪个工具」确定性化，而工具清单下发、权限门、执行、流式回传全部走
 * 产品代码。证据：fake-llm.jsonl 的每次请求摘要（tools 清单 + 工具结果文本）
 * 与 session/wait 的回合记录。
 *
 * 运行前提：
 *   1) fake-llm-server.mjs 已在宿主 4599 端口运行（FAKE_LLM_LOG 指向本 suite tmp）；
 *   2) E2 lane 已带 FAKE_LLM_API_KEY 占位 env（compose override）；
 *   3) 本脚本会临时写 llm-pi-ai/fake 与 agent-default-model；收尾恢复 mimo 并删 fake。
 *
 * 用法：node artifacts/rc5/E2/LLM/run.mjs
 */
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { Case, STATUS, summaryOf, writeSummary, shape } from '../_lib/evidence.mjs'
import { gitHead } from '../_lib/env.mjs'
import { login, request } from '../../../../scripts/rc5-test-client.mjs'
import {
  LANE, MODEL_ID, PROVIDER_ID, call, cleanupFakeRoute, createSession, ensureFakeRoute,
  logMark, logSince, promptTurn, sessions, sleep, textOfRecords, toolCallsOf, userIdOf, waitQuiet,
} from './lib.mjs'

const suite = 'LLM'
const rows = []
const startedAt = new Date().toISOString()

function record(c, status, title, expected, actual, notes = [], artifacts = []) {
  const row = c.finish({ status, title, expected, actual, notes, artifacts: [...artifacts, 'cmd.log'] })
  rows.push(row)
  return row
}

const s = await sessions()
const admin = s.admin
const userB = s.userB
const uidB = userIdOf(userB.account)
const uidA = userIdOf(admin.account)
const cwd = {
  admin: `/data/workspaces/${admin.account}`,
  b: `/data/workspaces/${userB.account}`,
}

await ensureFakeRoute(admin.cookie)

function fakeRecords(mark) {
  return logSince(mark)
}

function personalUpsert(cookie, payload) {
  return call(cookie, 'mcp-personal/upsert', { request: payload }, { timeoutMs: 30_000 })
}
function personalList(cookie) {
  return call(cookie, 'mcp-personal/list', {}, { timeoutMs: 30_000 })
}
function personalDelete(cookie, id) {
  return call(cookie, 'mcp-personal/delete', { request: { id } }, { timeoutMs: 30_000 })
}

/**
 * 幂等 upsert：先按 name 清掉同名残留（上一轮崩溃/中断留下的行会让新建命中
 * 「服务器命名冲突」），再新建。只在用例起点调用：此刻该用户的 live 会话都
 * 不是本用例要观察的对象（删除会 disposeUser 摘掉其全部个人工具）。
 */
async function personalEnsure(cookie, payload) {
  const listed = await personalList(cookie)
  const items = listed.value?.items ?? []
  const same = items.find(item => item.name === payload.name)
  if (same !== undefined) await personalDelete(cookie, same.id)
  return personalUpsert(cookie, payload)
}

/* ------------------------------------------------------------ MCPS-003 */

{
  const c = new Case(suite, 'RC5-MCPS-003')
  c.note('确定性假模型只决定 tool_call；工具清单/执行/结果回传走产品代码')
  const mark = logMark()
  const sessionId = await createSession(admin.cookie, { cwd: cwd.admin })
  c.cmd('POST /api/session/create（管理员，系统 MCP 会话）', 200, `sessionId=${sessionId}`)
  const round = await promptTurn(admin.cookie, sessionId,
    '@@SEQ 1\nMCPS-003：请调用系统 MCP 工具\n@@CALL name=mcp__e2sys__echo args={"text":"rc5-mcps-003-ok"}',
    { timeoutMs: 120_000 })
  const logs = fakeRecords(mark)
  const first = logs.find(row => row.pending?.name === 'mcp__e2sys__echo')
  const follow = logs.find(row => (row.toolResultTexts ?? []).some(text => text.includes('rc5-mcps-003-ok')))
  const calls = toolCallsOf(round.records)
  const text = textOfRecords(round.records)
  c.cmd('POST /api/session/prompt（@@CALL name=mcp__e2sys__echo）', 200, `call=${shape(calls)}`)
  c.cmd('POST /api/session/wait（回合记录）', 200, `assistant_text=${shape(text, 160)}`)
  const ok = first !== undefined && first.absent === false && follow !== undefined && calls.some(call => call.name === 'mcp__e2sys__echo')
  c.assert('模型请求的 tools 含 mcp__e2sys__echo 且派发成功', first !== undefined && first.absent === false, shape(first ?? {}))
  c.assert('工具结果回传 echo:rc5-mcps-003-ok', follow !== undefined, shape(follow?.toolResultTexts ?? []))
  c.assert('会话记录出现该 tool-call', calls.some(call => call.name === 'mcp__e2sys__echo'), shape(calls))
  record(c, ok ? STATUS.PASS : STATUS.FAIL,
    '会话内调用系统 MCP 工具（确定性模型回合）',
    '工具在 tools 清单中、可调用、结果正确回传',
    `tools_has=${first?.absent === false} result_echo=${follow !== undefined} call=${calls.map(row => row.name).join(',')}`,
    [`模型=确定性假模型（${PROVIDER_ID}/${MODEL_ID}）——只替代「选工具」，不替代 MCP 客户端/权限/执行`],
    [])
}

/* ------------------------------------------------------------ TERM-003 */

{
  const c = new Case(suite, 'RC5-TERM-003')
  const mark = logMark()
  const sessionId = await createSession(admin.cookie, { cwd: cwd.admin })
  c.cmd('POST /api/session/create（终端工具会话）', 200, `sessionId=${sessionId}`)
  const prompt = [
    '@@SEQ 1',
    'TERM-003：请逐个调用 6 个终端工具',
    '@@CALL name=terminal_open args={"type":"shell"}',
    '@@CALL name=terminal_send args={"sessionId":"$LAST_ID","text":"printf rc5-term-ok"}',
    '@@CALL name=terminal_read args={"sessionId":"$LAST_ID"}',
    '@@CALL name=terminal_send args={"sessionId":"$LAST_ID","text":"sleep 60"}',
    '@@CALL name=terminal_signal args={"sessionId":"$LAST_ID","signal":"SIGINT"}',
    '@@CALL name=terminal_list args={}',
    '@@CALL name=terminal_close args={"sessionId":"$LAST_ID"}',
  ].join('\n')
  let round
  let error
  try {
    round = await promptTurn(admin.cookie, sessionId, prompt, { timeoutMs: 240_000 })
  } catch (failure) {
    error = failure
  }
  const logs = fakeRecords(mark)
  const requested = logs.map(row => row.pending?.name).filter(name => typeof name === 'string')
  const results = logs.flatMap(row => row.toolResultTexts ?? [])
  const all = results.join('\n')
  const calls = round === undefined ? [] : toolCallsOf(round.records)
  c.cmd('POST /api/session/prompt（@@CALL × 7 链式终端调用）', error === undefined ? 200 : 500,
    error === undefined ? `called=${requested.join(',')}` : String(error?.message ?? error))
  c.cmd('POST /api/session/wait（回合记录）', 200, `tool_calls=${calls.length}`)
  const ok = error === undefined
    && requested.length >= 6
    && results.some(text => /started terminal session/.test(text))
    && results.some(text => text.includes('rc5-term-ok'))
    && results.some(text => /delivered SIGINT/.test(text))
    && results.some(text => /pty-\d+/.test(text))
    && results.some(text => /closed|close/i.test(text))
  c.assert('6 个 terminal_* 工具均实际派发', ['terminal_open', 'terminal_send', 'terminal_read', 'terminal_signal', 'terminal_list', 'terminal_close']
    .every(name => requested.includes(name)), `requested=${requested.join(',')}`)
  c.assert('open 返回终端 id', results.some(text => /started terminal session/.test(text)), shape(results.slice(0, 2)))
  c.assert('send/read 返回真实输出 rc5-term-ok', results.some(text => text.includes('rc5-term-ok')), '')
  c.assert('signal 返回 delivered', results.some(text => /delivered SIGINT/.test(text)), '')
  c.assert('list 返回该终端', results.some(text => /pty-\d+/.test(text)), '')
  c.assert('close 成功', results.some(text => /closed|close/i.test(text)), '')
  record(c, ok ? STATUS.PASS : STATUS.FAIL,
    '逐个调用 rc.5 注册的 6 个 terminal_* 工具',
    '全部可调用；输出通过工具结果流式回传（命令输出可见）',
    `requested=${requested.join(',')}；输出片段=${shape(results.find(text => text.includes('rc5-term-ok')) ?? '', 200)}`,
    ['确定性假模型只决定 tool_call 的次序与参数；PTY 创建/写入/读取/信号/关闭均由 rc.5 产品实现执行'],
    [])
}

/* ------------------------------------------------------------ MCPP-019 */

let echoB
{
  const c = new Case(suite, 'RC5-MCPP-019')
  const upsert = await personalEnsure(userB.cookie, { name: 'llm19', transport: 'stdio', catalogId: 'echo' })
  echoB = upsert.value?.item
  c.cmd('POST /api/mcp-personal/upsert（B，stdio echo）', upsert.status, upsert.ok ? `serverName=${echoB?.serverName}` : shape(upsert.error))
  const toolName = `mcp__${echoB?.serverName}__echo`
  const mark = logMark()
  const sessionId = await createSession(userB.cookie, { cwd: cwd.b })
  const before = await promptTurn(userB.cookie, sessionId,
    `@@SEQ 1\nMCPP-019 删除前\n@@CALL name=${toolName} args={"text":"live-before-delete"}`,
    { timeoutMs: 120_000 })
  const beforeLogs = fakeRecords(mark)
  const beforeCall = beforeLogs.find(row => row.pending?.name === toolName)
  const deleteResult = await personalDelete(userB.cookie, echoB?.id)
  c.cmd('POST /api/mcp-personal/delete（B 删除自己的 server）', deleteResult.status, deleteResult.ok ? 'ok' : shape(deleteResult.error))
  const mark2 = logMark()
  const after = await promptTurn(userB.cookie, sessionId,
    `@@SEQ 2\nMCPP-019 删除后（同一 live 会话）\n@@CALL name=${toolName} args={"text":"live-after-delete"}`,
    { timeoutMs: 120_000 })
  const afterLogs = fakeRecords(mark2)
  const afterCall = afterLogs.find(row => row.pending?.name === toolName)
  const beforeResults = beforeLogs.flatMap(row => row.toolResultTexts ?? []).join('\n')
  const afterResults = afterLogs.flatMap(row => row.toolResultTexts ?? []).join('\n')
  const freshMark = logMark()
  const freshId = await createSession(userB.cookie, { cwd: cwd.b })
  await promptTurn(userB.cookie, freshId,
    `@@SEQ 1\nMCPP-019 新会话\n@@CALL name=${toolName} args={"text":"fresh-after-delete"}`,
    { timeoutMs: 120_000 })
  const freshLogs = fakeRecords(freshMark)
  const freshCall = freshLogs.find(row => row.pending?.name === toolName)
  c.cmd('POST /api/session/prompt（删除前/后/新会话，同一工具名）', 200,
    `before_present=${beforeCall?.absent === false} after_present=${afterCall?.absent === false} fresh_present=${freshCall?.absent === false}`)
  c.assert('删除前 live 会话可见且回显成功', beforeCall?.absent === false && beforeResults.includes('echo:live-before-delete'), shape(beforeResults, 160))
  c.assert('删除后同一 live 会话工具当场消失', afterCall !== undefined && afterCall.absent === true, shape(afterCall ?? {}))
  c.assert('删除后调用被拒（无 echo 内容）', !afterResults.includes('echo:live-after-delete'), shape(afterResults, 160))
  c.assert('新会话亦无该工具', freshCall !== undefined && freshCall.absent === true, shape(freshCall ?? {}))
  c.assert('会话记录确认删除前调用过该工具', toolCallsOf(before.records).some(call => call.name === toolName), '')
  const ok = beforeCall?.absent === false && beforeResults.includes('echo:live-before-delete')
    && afterCall?.absent === true && !afterResults.includes('echo:live-after-delete')
    && freshCall?.absent === true
  record(c, ok ? STATUS.PASS : STATUS.FAIL,
    '删除个人 server 后 live 会话工具当场消失',
    '同一 live 会话立即不可见/不可调；新会话亦无',
    `before=${beforeCall?.absent === false} after=${afterCall?.absent === true} fresh=${freshCall?.absent === true}`,
    [`工具名=${toolName}（uid=${uidB}）`, '删除经 mcp-personal/delete → disposeUser 摘除 scope（产品路径），非测试直接改注册表'],
    [])
}

/* ------------------------------------------------------------ MCPP-020 */

{
  const c = new Case(suite, 'RC5-MCPP-020')
  // A 的个人 server（作为越权目标）；B 自己的 server（子代理放行目标）
  const aUpsert = await personalEnsure(admin.cookie, { name: 'llm20a', transport: 'stdio', catalogId: 'echo' })
  const bUpsert = await personalEnsure(userB.cookie, { name: 'llm20b', transport: 'stdio', catalogId: 'echo' })
  const aItem = aUpsert.value?.item
  const bItem = bUpsert.value?.item
  c.cmd('POST /api/mcp-personal/upsert（A/B 各一条 echo）', aUpsert.status,
    `a=${aItem?.serverName} b=${bItem?.serverName} a_ok=${aUpsert.ok} b_ok=${bUpsert.ok}`)
  const aTool = `mcp__${aItem?.serverName}__echo`
  const bTool = `mcp__${bItem?.serverName}__echo`

  // 1) B 直接构造 A 的工具名
  const mark = logMark()
  const sessionId = await createSession(userB.cookie, { cwd: cwd.b })
  await promptTurn(userB.cookie, sessionId,
    `@@SEQ 1\nMCPP-020 跨用户构造调用\n@@CALL name=${aTool} args={"text":"cross-user-secret"}`,
    { timeoutMs: 120_000 })
  const crossLogs = fakeRecords(mark)
  const crossCall = crossLogs.find(row => row.pending?.name === aTool)
  const crossResults = crossLogs.flatMap(row => row.toolResultTexts ?? []).join('\n')
  c.cmd('POST /api/session/prompt（B 构造 mcp__p<A>_*）', 200, `absent=${crossCall?.absent} results=${shape(crossResults, 160)}`)
  c.assert('跨用户构造的 A 工具不在 B 的 tools 清单', crossCall !== undefined && crossCall.absent === true, shape(crossCall ?? {}))
  c.assert('跨用户调用被拒且无 A 的回显内容', !crossResults.includes('echo:cross-user-secret'), shape(crossResults, 160))

  // 2) B 的子代理调用 B 自己的工具（账本归属相同 → 允许）
  const mark2 = logMark()
  const subPrompt = `子任务：请调用工具 ${bTool}，参数 {"text":"subagent-own-ok"}\n@@CALL name=${bTool} args={"text":"subagent-own-ok"}`
  const subArgs = {
    description: '调用个人 MCP 工具',
    prompt: subPrompt,
    provider: PROVIDER_ID,
    model: MODEL_ID,
  }
  const sessionId2 = await createSession(userB.cookie, { cwd: cwd.b })
  await promptTurn(userB.cookie, sessionId2,
    `@@SEQ 1\nMCPP-020 子代理调用自己的工具\n@@CALL name=subagent args=${JSON.stringify(subArgs)}`,
    { timeoutMs: 240_000 })
  // 父会话 waitIdle ≠ 子代理收尾：子代理是异步派发，删除类写操作会摘掉仍在
  // mid-turn 的子代理 scope（实测假阴性）。等日志安静后再断言/清理。
  await waitQuiet(mark2, { minRows: 2 })
  const subLogs = fakeRecords(mark2)
  const childCalls = subLogs.filter(row => (row.toolNames ?? []).includes(bTool))
  const subResults = subLogs.flatMap(row => row.toolResultTexts ?? []).join('\n')
  c.cmd('POST /api/session/prompt（B 的子代理调用 mcp__p<B>_*）', 200,
    `child_requests_with_tool=${childCalls.length} echo=${subResults.includes('echo:subagent-own-ok')}`)
  c.assert('子代理请求的 tools 含 B 自己的个人工具', childCalls.length > 0, `requests=${subLogs.length}`)
  c.assert('子代理调用成功回显', subResults.includes('echo:subagent-own-ok'), shape(subResults, 200))

  const ok = crossCall?.absent === true && !crossResults.includes('echo:cross-user-secret')
    && childCalls.length > 0 && subResults.includes('echo:subagent-own-ok')
  record(c, ok ? STATUS.PASS : STATUS.FAIL,
    'B 构造 mcp__p<A_uid>_* 调用：同用户子代理放行、跨用户 deny',
    '跨用户不可见/被拒且无内容；同用户子代理可调用自己的工具',
    `cross_absent=${crossCall?.absent} child_sees=${childCalls.length > 0}`,
    [`A uid=${uidA} / B uid=${uidB}`, '跨用户判定以请求 tools 清单缺席 + 强制调用被拒双重取证'],
    [])
  await personalDelete(admin.cookie, aItem?.id)
  await personalDelete(userB.cookie, bItem?.id)
}

/* ------------------------------------------------------------ MCPP-022 */

{
  const c = new Case(suite, 'RC5-MCPP-022')
  const upsert = await personalEnsure(userB.cookie, { name: 'llm22', transport: 'stdio', catalogId: 'echo' })
  const item = upsert.value?.item
  c.cmd('POST /api/mcp-personal/upsert（B，登出前）', upsert.status,
    upsert.ok ? `serverName=${item?.serverName}` : `err=${shape(upsert.error)}`)
  if (upsert.ok !== true || item?.serverName === undefined) {
    record(c, STATUS.FAIL,
      'B 登出后 live 会话个人工具立即不可用（scope dispose）',
      '登出触发 disposeUser；排队中的下一回合 tools 清单已无个人工具，调用被拒',
      `upsert 失败，未进入登出时序：${shape(upsert.error)}`,
      ['上一轮会话残留被 personalEnsure 先行清理；仍失败则需查 mcp-personal 路由'],
      [])
  } else {
    const toolName = `mcp__${item.serverName}__echo`
    const sessionId = await createSession(userB.cookie, { cwd: cwd.b })
    const mark = logMark()
    // 第一回合：登出前在 live 会话调用个人工具（取证可用）。
    const first = await promptTurn(userB.cookie, sessionId,
      `@@SEQ 1\nMCPP-022 登出前\n@@CALL name=${toolName} args={"text":"before-logout"}`,
      { timeoutMs: 120_000 })
    const firstLogs = fakeRecords(mark)
    const round1 = firstLogs.find(row => (row.toolResultTexts ?? []).some(text => text.includes('echo:before-logout')))
    c.cmd('POST /api/session/prompt（第一回合：登出前调用）', 200, `tool_calls=${toolCallsOf(first.records).length}`)
    c.cmd('假模型日志：登出前 echo 回显', round1 === undefined ? 500 : 200, shape(round1?.toolResultTexts ?? [], 160))

    // 登出：disposeUser 同步触发、异步摘 scope（onLogout 不 await）；留 2s 收敛。
    const logout = await request(new URL('/logout', LANE.base), { method: 'POST', cookie: userB.cookie, timeoutMs: 20_000 })
    const cleared = logout.setCookies.some(value => /eterna_session=;/.test(value) && /Max-Age=0/i.test(value))
    c.cmd('POST /logout（B 登出）', logout.status,
      `redirect=${logout.headers.get('location') ?? '-'} clear_cookie=${cleared}`)
    await sleep(2_000)

    // 第二回合：同一 live 会话（cookie 是无状态 bearer，登出只清浏览器侧）。
    // 判定点是「产品是否已在该 live 会话摘掉个人工具」，不是 cookie 是否吊销。
    const mark2 = logMark()
    await promptTurn(userB.cookie, sessionId,
      `@@SEQ 2\nMCPP-022 登出后\n@@CALL name=${toolName} args={"text":"after-logout"}`,
      { timeoutMs: 120_000 })
    const logs = fakeRecords(mark2)
    const round2 = logs.find(row => row.pending?.name === toolName && row.absent === true)
    const round2Result = round2 === undefined ? undefined
      : logs.slice(logs.indexOf(round2) + 1).find(row => (row.toolResultTexts ?? []).some(text => /unknown|denied|不存在|unavailable/i.test(text)))
    const round2Tools = round2?.toolNames ?? []
    c.cmd('假模型请求日志（登出后同一会话回合）', 200,
      `round1_echo=${round1 !== undefined} round2_absent=${round2?.absent ?? '-'} round2_tools_has=${round2Tools.includes(toolName)}`)
    c.assert('登出前 live 会话可调用个人工具并回显', round1 !== undefined, shape(round1?.toolResultTexts ?? []))
    c.assert('登出返回 302 且清除浏览器会话 cookie（Max-Age=0）', logout.status === 302 && cleared,
      `status=${logout.status} clear=${cleared}`)
    c.assert('登出后同一 live 会话 tools 清单不再含个人工具', round2 !== undefined && !round2Tools.includes(toolName),
      `tools=${round2Tools.length} present=${round2Tools.includes(toolName)}`)
    c.assert('登出后调用被拒且无 echo 内容', round2Result !== undefined
      && !(round2Result.toolResultTexts ?? []).join('\n').includes('echo:after-logout'),
      shape(round2Result?.toolResultTexts ?? [], 160))
    const ok = round1 !== undefined && logout.status === 302 && cleared
      && round2 !== undefined && !round2Tools.includes(toolName)
      && round2Result !== undefined && !(round2Result.toolResultTexts ?? []).join('\n').includes('echo:after-logout')
    record(c, ok ? STATUS.PASS : STATUS.FAIL,
      'B 登出后 live 会话个人工具立即不可用（scope dispose）',
      '登出触发 disposeUser；同一 live 会话的下一回合 tools 清单已无个人工具，调用被拒',
      `round1=${round1 !== undefined} logout=${logout.status} round2_absent=${round2?.absent}`,
      ['会话 cookie 是无状态 bearer：登出=302+浏览器侧 Max-Age=0 清除，服务端不吊销 token；判定只走 live 会话工具面'],
      [])
    // 重新登录一次，仅用于删掉本用例的个人层条目（登录限速 5/min 内）。
    const relogin = await login(LANE.base, s.accounts.user_b.account, s.accounts.user_b.password)
    if (relogin.status === 200) {
      const freshCookie = `${s.dsh}; ${relogin.cookie}`
      await personalDelete(freshCookie, item.id).catch(() => undefined)
    }
  }
}

await cleanupFakeRoute(admin.cookie)

const summary = summaryOf(rows, {
  suite,
  env: {
    commit: gitHead(), imageTag: LANE.imageTag, imageId: LANE.imageId, container: LANE.container,
    base: LANE.base, dataRoot: LANE.dataRoot, startedAt,
  },
})
summary.observations = 'artifacts/rc5/E2/LLM/tmp/fake-llm.jsonl'
writeSummary(suite, summary)
console.log(`[LLM] PASS=${summary.pass} FAIL=${summary.fail} SKIP=${summary.skip} NOTRUN=${summary.notrun}`)
writeFileSync(join(LANE.evidenceRoot, 'LLM', 'summary-notes.txt'),
  `确定性假模型（${PROVIDER_ID}/${MODEL_ID}）回合；只决定 tool_call，不替代工具管线。\n`)