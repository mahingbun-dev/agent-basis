#!/usr/bin/env node
/**
 * E2 · RC5-MCPP-018：断线重连上限 3 次后停止（P1）。
 *
 * 两腿：
 *   1) 配置腿（单测）：`personalMcpClientInput` 下传
 *      `reconnect:{enabled:true,maxAttempts:3}`（rc.5 默认 10 次过宽，50/54 T26/T27 要求 3）；
 *   2) 行为腿（容器实跑）：目录项 flaky = `node /fixtures/mcp-exit-stdio.mjs --exit-after 3000`
 *      （连上 3s 后主动退出；每次重连起新进程、3s 后再掉）。
 *      B 建 flaky → 新会话先跑 echo（基线）→ 掉线后仍能再调通（证明发生了重连并重新注册工具）
 *      → 到 20s 时刻工具已从 tools 清单消失（最多 3 次重连后 give-up，不是 10 次/无限）。
 *      最后删 flaky、改挂目录项 echo，新会话 echo 成功（恢复靠新会话重新挂载）。
 *
 * 说明：mcp-client 的尝试日志走宿主 logger，容器 stdout 不落（实测 0 行），故用
 * 「重连窗口内工具可用 → 20s 后工具消失」的行为差来判定 3 次上限；精确配置由单测腿锁定。
 *
 * 前提：lane catalog 含 echo+flaky；fake-llm-server 在 4599；镜像含 reconnect 修复。
 * 用法：node artifacts/rc5/E2/MCPP/run-extra.mjs --only=018
 */
import { Case, STATUS, shape } from '../_lib/evidence.mjs'
import { LANE, call, run as runCmd, sleep, userIdOf, workspaceOf } from '../_lib/env.mjs'
import {
  cleanupFakeRoute, createSession, ensureFakeRoute, logMark, logSince, promptTurn,
} from '../LLM/lib.mjs'

export async function run(s) {
  const c = new Case('MCPP', 'RC5-MCPP-018')
  const cookie = s.userB.cookie
  const uid = userIdOf(s.userB.account)
  const cwd = workspaceOf(uid)?.path ?? `/data/workspaces/${s.userB.account}`
  const created = []
  let seq = 0
  try {
    const unit = runCmd('pnpm', ['--filter', '@eterna/access', 'exec', 'vitest', 'run',
      'tests/mcp-personal-runtime.spec.ts', '-t', 'personalMcpClientInput'], { timeout: 300_000 })
    c.cmd('pnpm --filter @eterna/access exec vitest run tests/mcp-personal-runtime.spec.ts -t personalMcpClientInput', unit.exit,
      shape(unit.stdout.split('\n').slice(-6).join('\n'), 500), unit.stderr)
    const unitOk = unit.exit === 0 && /1 passed/.test(unit.stdout)

    const catalog = await call(cookie, 'mcp-personal/catalog')
    const catalogItems = catalog.value?.items ?? []
    const hasFlaky = catalogItems.some(item => item.name === 'flaky')
    const hasEcho = catalogItems.some(item => item.name === 'echo')
    c.cmd('POST /api/mcp-personal/catalog（B）', catalog.status,
      `items=${JSON.stringify(catalogItems.map(item => item.name))}`)

    const before = await call(cookie, 'mcp-personal/list')
    for (const item of before.value?.items ?? []) {
      if (item.name === 'flaky' || item.name === 'recovered') {
        await call(cookie, 'mcp-personal/delete', { request: { id: item.id } })
      }
    }

    const upsert = await call(cookie, 'mcp-personal/upsert', {
      request: { name: 'flaky', transport: 'stdio', catalogId: 'flaky' },
    })
    if (upsert.value?.item?.id !== undefined) created.push(upsert.value.item.id)
    const serverName = upsert.value?.item?.serverName
    c.cmd('POST /api/mcp-personal/upsert {name:flaky,stdio,catalogId:flaky}（B）', upsert.status,
      `ok=${upsert.ok} serverName=${serverName ?? '-'} code=${upsert.error?.code ?? '-'} msg=${shape(upsert.error?.message, 160)}`)

    await ensureFakeRoute(s.admin.cookie)
    const mark = logMark()
    const sessionId = await createSession(cookie, { cwd })
    const t0 = Date.now()
    const toolName = `mcp__${serverName}__echo`

    async function round(text) {
      seq += 1
      const roundMark = logMark()
      let failure
      try {
        await promptTurn(cookie, sessionId,
          `@@SEQ ${seq}\nRC5-MCPP-018：${text}\n@@CALL name=${toolName} args={"text":"${text}"}`,
          { timeoutMs: 60_000 })
      } catch (error) {
        failure = error
      }
      const logs = logSince(roundMark)
      const pending = logs.find(row => row.pending?.name === toolName)
      const echoed = logs.some(row => (row.toolResultTexts ?? []).some(entry => entry.includes(`echo:${text}`)))
      return { absent: pending?.absent, dispatched: pending !== undefined, echoed, failure: failure?.message }
    }

    const baseline = await round('baseline')
    c.cmd('POST /api/session/prompt（基线 echo，假模型）', baseline.failure === undefined ? 200 : 500,
      `absent=${baseline.absent ?? '-'} echoed=${baseline.echoed} failure=${shape(baseline.failure, 120)}`)

    // 等首个进程退出（3s 后），重连窗口内再调：成功 = 重连确实重新注册了工具。
    while (Date.now() - t0 < 3_400) await sleep(200)
    const afterLoss = []
    for (let attempt = 0; attempt < 4; attempt += 1) {
      const row = await round(`after-loss-${attempt + 1}`)
      afterLoss.push(row)
      if (row.echoed) break
      await sleep(400)
    }
    const reconnected = afterLoss.some(row => row.echoed === true)
    c.cmd('POST /api/session/prompt（掉线后重连窗口内再调）', 200,
      `elapsedMs=${Date.now() - t0} rows=${JSON.stringify(afterLoss.map(row => ({ absent: row.absent, echoed: row.echoed })))}`)

    // 3 次重连（每次 3s）后 give-up：20s 时刻工具应已注销（absent=true）。
    while (Date.now() - t0 < 20_000) await sleep(500)
    const afterGiveUp = await round('after-giveup')
    c.cmd('POST /api/session/prompt（20s 后检查工具是否注销）', 200,
      `elapsedMs=${Date.now() - t0} absent=${afterGiveUp.absent ?? '-'} echoed=${afterGiveUp.echoed} failure=${shape(afterGiveUp.failure, 120)}`)

    // 恢复：删 flaky，改挂 echo，新会话 echo 成功。
    for (const id of created) {
      const deleted = await call(cookie, 'mcp-personal/delete', { request: { id } })
      c.cmd('POST /api/mcp-personal/delete（清理 flaky）', deleted.status, `ok=${deleted.ok}`)
    }
    created.length = 0
    const recovery = await call(cookie, 'mcp-personal/upsert', {
      request: { name: 'recovered', transport: 'stdio', catalogId: 'echo' },
    })
    const recoveryName = recovery.value?.item?.serverName
    if (recovery.value?.item?.id !== undefined) created.push(recovery.value.item.id)
    c.cmd('POST /api/mcp-personal/upsert {name:recovered,catalogId:echo}（恢复用）', recovery.status,
      `ok=${recovery.ok} serverName=${recoveryName ?? '-'}`)
    const recoveryMark = logMark()
    const recoverySession = await createSession(cookie, { cwd })
    const recoveryTool = `mcp__${recoveryName}__echo`
    seq += 1
    const recoveryRound = await promptTurn(cookie, recoverySession,
      `@@SEQ ${seq}\nRC5-MCPP-018：恢复后 echo\n@@CALL name=${recoveryTool} args={"text":"after-giveup"}`,
      { timeoutMs: 120_000 })
    const recoveryLogs = logSince(recoveryMark)
    const recovered = recoveryLogs.some(row => row.pending?.name === recoveryTool && row.absent === false)
      && recoveryLogs.some(row => (row.toolResultTexts ?? []).some(text => text.includes('echo:after-giveup')))
    c.cmd('新会话 + 假模型 echo（恢复验证）', 200, `recovered=${recovered} records=${recoveryRound.records.length}`)

    c.assert('配置腿：personalMcpClientInput 下传 reconnect{enabled,maxAttempts:3}', unitOk, shape(unit.stdout.split('\n').slice(-3).join(' '), 200))
    c.assert('前置：目录含 flaky（自退出 stdio）与 echo', hasFlaky && hasEcho, JSON.stringify(catalogItems.map(item => item.name)))
    c.assert('基线：断线前 echo 工具可用', baseline.echoed === true && baseline.absent === false)
    c.assert('掉线后工具重新可用（重连并重新注册工具）', reconnected === true,
      JSON.stringify(afterLoss.map(row => ({ absent: row.absent, echoed: row.echoed }))))
    c.assert('20s 时工具已注销（3 次上限后 give-up，非 10 次/无限）', afterGiveUp.absent === true && afterGiveUp.echoed === false,
      `absent=${afterGiveUp.absent} echoed=${afterGiveUp.echoed}`)
    c.assert('give-up 后新会话挂载 echo 即恢复', recovered === true)

    const pass = unitOk && hasFlaky && hasEcho && baseline.echoed === true && baseline.absent === false
      && reconnected && afterGiveUp.absent === true && afterGiveUp.echoed === false && recovered
    return c.finish({
      status: pass ? STATUS.PASS : STATUS.FAIL,
      title: '断线重连 3 次后停止；新会话恢复',
      expected: '配置下传 maxAttempts=3；掉线后重连窗口内工具重新可用；20s 后已 give-up（工具注销）；新会话恢复',
      actual: `unit=${unitOk} baseline=${baseline.echoed} reconnected=${reconnected} absentAt20s=${afterGiveUp.absent} recovered=${recovered}`,
      notes: [
        `lane=${LANE.container}（独立测试容器，未触碰生产）`,
        '掉线由目录项 flaky（已连接 3s 后主动退出的 stdio 夹具）制造；每次重连起新进程、3s 后再掉',
        'mcp-client 的 reconnect 日志走宿主 logger、不落容器 stdout（实测 0 行），故行为腿用「重连窗口可用 → 20s 后消失」判定；精确 3 次由单测腿锁定',
        'give-up 是终态：恢复靠新会话重新挂载（不是无限重连自愈）',
      ],
      artifacts: ['cmd.log'],
    })
  } finally {
    for (const id of created) {
      await call(s.userB.cookie, 'mcp-personal/delete', { request: { id } }).catch(() => undefined)
    }
    await cleanupFakeRoute(s.admin.cookie).catch(() => undefined)
  }
}