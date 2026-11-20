#!/usr/bin/env node
/**
 * E2 · RC5-MCPP-016：挂死 stdio 服务器 → 单条 8s 启动预算，不阻塞会话（P1）。
 *
 * 前提：管理员目录含 hung（command=/bin/sh, args=["-c","sleep 600"]），
 *       lane 数据根下 B 的 live 会话已经收尾（本用例自建新会话观察）。
 * 判定：
 *   1) B 从目录新建 hung 成功；
 *   2) 新建会话返回成功，耗时 ≈8s（≥7s 且 ≤15s），即 8s 预算到点放弃而不是无限等；
 *   3) 会话可用（session/state 可读、running=false）；
 *   4) 容器日志出现 `[mcp-personal] <serverName> 连接失败:MCP 启动超过 8000ms 预算`；
 *   5) 其它工具不受影响（会话仍能正常建立——由 2/3 覆盖）。
 * 收尾删除 hung 行。
 *
 * 用法：node artifacts/rc5/E2/MCPP/run-extra.mjs --only 016
 */
import { Case, STATUS, shape } from '../_lib/evidence.mjs'
import { LANE, call, docker, sessions, userIdOf, workspaceOf } from '../_lib/env.mjs'

export async function run(s) {
  const c = new Case('MCPP', 'RC5-MCPP-016')
  const cookie = s.userB.cookie
  const uid = userIdOf(s.userB.account)
  const cwd = workspaceOf(uid)?.path ?? `/data/workspaces/${s.userB.account}`

  const catalog = await call(cookie, 'mcp-personal/catalog')
  const items = catalog.value?.items ?? []
  const hasHung = items.some(item => item.name === 'hung' && item.transport === 'stdio')
  c.cmd('POST /api/mcp-personal/catalog（B）', catalog.status, `items=${JSON.stringify(items.map(item => item.name))}`)

  const before = await call(cookie, 'mcp-personal/list')
  for (const item of before.value?.items ?? []) {
    if (item.name === 'hung') {
      const cleaned = await call(cookie, 'mcp-personal/delete', { request: { id: item.id } })
      c.cmd('POST /api/mcp-personal/delete（清理同名 hung 残留）', cleaned.status, `ok=${cleaned.ok}`)
    }
  }

  const upsert = await call(cookie, 'mcp-personal/upsert', {
    request: { name: 'hung', transport: 'stdio', catalogId: 'hung' },
  })
  const serverName = upsert.value?.item?.serverName
  c.cmd('POST /api/mcp-personal/upsert {name:hung,stdio,catalogId:hung}（B）', upsert.status,
    `ok=${upsert.ok} serverName=${serverName ?? '-'} code=${upsert.error?.code ?? '-'} msg=${shape(upsert.error?.message, 160)}`)

  const since = new Date(Date.now() - 1_000).toISOString()
  const started = Date.now()
  const created = await call(cookie, 'session/create', { request: { cwd } }, { timeoutMs: 40_000 })
  const elapsed = Date.now() - started
  c.cmd('POST /api/session/create（B；期望 8s 预算到点后返回）', created.status,
    `ok=${created.ok} sessionId=${created.value?.sessionId ?? '-'} elapsedMs=${elapsed} code=${created.error?.code ?? '-'}`)
  const sessionId = created.value?.sessionId

  const state = sessionId === undefined ? undefined : await call(cookie, 'session/state', { sessionId }, { timeoutMs: 20_000 })
  c.cmd('POST /api/session/state（会话可用性）', state?.status ?? 0,
    `ok=${state?.ok} running=${state?.value?.running ?? '-'} cursor=${state?.value?.cursor ?? '-'}`)

  const logs = docker(['logs', '--since', since, LANE.container])
  const text = `${logs.stdout}\n${logs.stderr}`
  const failureLine = text.split('\n').find(line => line.includes('[mcp-personal]') && line.includes(String(serverName ?? 'hung')) && /连接失败/.test(line)) ?? ''
  const budgetLine = text.split('\n').find(line => line.includes(String(serverName ?? 'hung')) && /8000ms 预算/.test(line)) ?? ''
  c.cmd(`docker logs --since ${since} rc5-e2suite | grep mcp-personal（截取相关行）`, 0, shape([failureLine, budgetLine].filter(Boolean).join('\n'), 600))

  if (upsert.ok === true && upsert.value?.item?.id !== undefined) {
    const deleted = await call(cookie, 'mcp-personal/delete', { request: { id: upsert.value.item.id } })
    c.cmd('POST /api/mcp-personal/delete（清理 hung）', deleted.status, `ok=${deleted.ok}`)
  }

  c.assert('前置：目录含 hung（stdio）', hasHung, JSON.stringify(items.map(item => item.name)))
  c.assert('B 从目录新建 hung 成功', upsert.ok === true && serverName !== undefined, shape(upsert.error ?? upsert.value?.item))
  c.assert('会话创建成功（未被挂死服务器拖死）', created.ok === true && sessionId !== undefined)
  c.assert('8s 预算生效（耗时 7–15s）', elapsed >= 7_000 && elapsed <= 15_000, `elapsedMs=${elapsed}`)
  c.assert('会话可用（state 可读、running=false）', state?.ok === true && state?.value?.running === false,
    `ok=${state?.ok} running=${state?.value?.running}`)
  c.assert('日志出现「MCP 启动超过 8000ms 预算」', /8000ms 预算/.test(failureLine), shape(failureLine || text.slice(-300), 300))

  const pass = hasHung && upsert.ok === true && created.ok === true && elapsed >= 7_000 && elapsed <= 15_000
    && state?.ok === true && state?.value?.running === false && /8000ms 预算/.test(failureLine)
  const row = c.finish({
    status: pass ? STATUS.PASS : STATUS.FAIL,
    title: '挂死 stdio 8s 启动预算：放弃该条、会话仍可建',
    expected: '目录项 hung 启动挂死 → 8s 后放弃；session/create 不被阻塞；日志留预算超时；会话可用',
    actual: `upsert=${upsert.ok} session=${created.ok} elapsedMs=${elapsed} state=${state?.ok}/${state?.value?.running} log=${/8000ms 预算/.test(failureLine)}`,
    notes: [
      `lane=${LANE.container}（独立测试容器，未触碰生产）`,
      'hung 的 command/args 只存在于管理员目录 env（测试夹具），用户侧不能自填 stdio command（MCPP-005 覆盖）',
      `8s 预算常量为 MCP_PERSONAL_STARTUP_TIMEOUT_MS=8000；实测耗时含会话装配开销`,
    ],
    artifacts: ['cmd.log'],
  })
  return row
}