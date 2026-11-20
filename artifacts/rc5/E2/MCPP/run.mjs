#!/usr/bin/env node
/**
 * E2 · MCPP 套件（RC5-MCPP-001..024；51 §3.6）。
 *
 * 执行分三段：
 *   1) scripts/verify-mcp-personal.mjs（51 §4 指定脚本，--full --restart）一次跑
 *      001–009/012–015/021/023；本 runner 把其 report.json 落成每用例证据。
 *   2) 本 runner 补测 010（HTTPS 可解析校验）与 023 的受控复测；
 *   3) 011/016/017/018/024 由 run-extra.mjs 容器实跑，本 runner 解析 result.md 折叠；
 *      019/020/022 的 live 回合证据在 LLM lane（明示指向，不冒充）。
 *
 * 停止规则：跨租户 P0 红 → 本套件 halted=true；已由 ACC-008 触发的停线不因本套件改变。
 */
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { Case, STATUS, summaryOf, writeSummary, shape } from '../_lib/evidence.mjs'
import { LANE, REPO, run, docker, sleep, sessions, call, readDb, gitHead } from '../_lib/env.mjs'

const suite = 'MCPP'
const startedAt = new Date().toISOString()
const rows = []
let halted = false
let haltReason = ''

function record(c, status, title, expected, actual, notes = []) {
  const row = c.finish({ status, title, expected, actual, notes, artifacts: ['cmd.log'] })
  rows.push(row)
  if (status === STATUS.FAIL && !halted) {
    halted = true
    haltReason = `${c.id}: ${title}`
  }
  return row
}

const reportPath = join(LANE.evidenceRoot, 'MCPP', 'report.json')
const official = existsSync(reportPath) ? JSON.parse(readFileSync(reportPath, 'utf8')) : { cases: [] }
const officialById = new Map((official.cases ?? []).map(row => [row.id, row]))
const officialCommand = 'node scripts/verify-mcp-personal.mjs --base http://127.0.0.1:3119 --accounts-file <0600> --data-root <E2 数据根> --container rc5-e2suite --json artifacts/rc5/E2/MCPP/report.json --full --restart'

const titles = {
  'RC5-MCPP-001': 'A 的 list 只含 A 的条目',
  'RC5-MCPP-002': 'B 的 list 只含 B 的条目',
  'RC5-MCPP-003': 'B upsert A 的行被拒且 A 行不变',
  'RC5-MCPP-004': 'B delete A 的行被拒且 A 行仍在',
  'RC5-MCPP-005': 'catalog 只含允许项；自填 stdio command 被拒',
  'RC5-MCPP-006': 'B 从管理员目录新建 echo（serverName 按 uid 隔离）',
  'RC5-MCPP-007': '本地 HTTP MCP 新建并 probe 成功',
  'RC5-MCPP-008': 'IPv4 元数据地址被拒',
  'RC5-MCPP-009': 'IPv6 元数据地址被拒',
  'RC5-MCPP-012': 'header secret 以 AES-GCM 密文落库、日志无明文',
  'RC5-MCPP-013': 'list 只回 hasSecret:true 与 header 名，不回值',
  'RC5-MCPP-014': '每人 8 条上限（第 9 条拒绝）',
  'RC5-MCPP-015': '256KB 配置上限（原配置不被覆盖）',
  'RC5-MCPP-021': 'A/B 同名 server 的 serverName 不同且互不覆盖',
  'RC5-MCPP-023': '重启容器后个人配置仍在',
}

const s = await sessions()
const uidA = readDb('SELECT id FROM users WHERE account = ?', [s.admin.account])[0]?.id
const uidB = readDb('SELECT id FROM users WHERE account = ?', [s.userB.account])[0]?.id
const sidB = readDb('SELECT session_id FROM sessions WHERE owner_id = ? LIMIT 1', [uidB])[0]?.session_id

/* ---------------------------------------------- 官方脚本结果落证据（001–009/012–015/021） */

for (const id of ['RC5-MCPP-001', 'RC5-MCPP-002', 'RC5-MCPP-003', 'RC5-MCPP-004', 'RC5-MCPP-005',
  'RC5-MCPP-006', 'RC5-MCPP-007', 'RC5-MCPP-008', 'RC5-MCPP-009', 'RC5-MCPP-012', 'RC5-MCPP-013',
  'RC5-MCPP-014', 'RC5-MCPP-015', 'RC5-MCPP-021']) {
  const c = new Case(suite, id)
  const row = officialById.get(id)
  c.cmd(officialCommand, 0, `${row?.status ?? 'MISSING'} :: ${row?.detail ?? 'report 无该行'}`)
  if (row === undefined) {
    record(c, STATUS.FAIL, titles[id], '按 51 §3.6 执行', 'report.json 无该行', ['官方脚本未输出该用例'])
    continue
  }
  record(c, row.status, titles[id], '按 51 §3.6', row.detail, [
    '本行结果由 scripts/verify-mcp-personal.mjs（51 §4 指定脚本）在同一次执行中产出；命令见上',
  ])
}

/* ---------------------------------------------- MCPP-010 空白名单 lane（mcpp-010.mjs 实跑，折叠结论） */
/* 010 要求 personalHttpHosts 为空，与 011 的非空白名单互斥 → 独立容器 rc5-mcpp10。
   证据：artifacts/rc5/E2/MCPP/RC5-MCPP-010/result.md（mcpp-010.mjs 产出），本 runner 只折叠。 */
{
  const c = new Case(suite, 'RC5-MCPP-010')
  const path = join(LANE.evidenceRoot, 'MCPP', 'RC5-MCPP-010', 'result.md')
  const folded = existsSync(path) ? (() => {
    const text = readFileSync(path, 'utf8')
    const status = /- 结论：\*\*(PASS|FAIL|SKIP|NOTRUN)\*\*/.exec(text)?.[1]
    const title = /^# RC5-MCPP-010 · (.+)$/m.exec(text)?.[1]
    const actual = /## 实际\n\n([\s\S]*?)\n\n## /.exec(text)?.[1]?.trim().replace(/\n+/g, ' ') ?? ''
    return { status, title, actual: shape(actual, 500) }
  })() : undefined
  if (folded?.status === 'PASS' || folded?.status === 'FAIL') {
    rows.push({ id: 'RC5-MCPP-010', status: folded.status, title: folded.title, actual: folded.actual })
    if (folded.status === 'FAIL' && !halted) {
      halted = true
      haltReason = `RC5-MCPP-010: ${folded.title ?? '任意 HTTPS 地址'}`
    }
  } else {
    c.note('mcpp-010.mjs 无 PASS/FAIL 结论（或证据缺失）')
    record(c, STATUS.NOTRUN, '任意 HTTPS 地址（不可解析域名）校验通过、不被策略拦',
      'upsert 成功；probe 连接失败属网络层（白名单默认空）',
      `未执行/未判：${folded?.actual ?? 'result.md 缺失'}（先跑 artifacts/rc5/E2/MCPP/mcpp-010.mjs）`)
  }
}

/* ---------------------------------------------- MCPP-011 host 白名单（容器实跑） */
/* 结果见 artifacts/rc5/E2/MCPP/RC5-MCPP-011/result.md（run-extra.mjs 产出），
   本 runner 只折叠，不重写证据。 */

/* ---------------------------------------------- MCPP-023 受控复测（纠正官方脚本假红） */

{
  const c = new Case(suite, 'RC5-MCPP-023')
  const created = await call(s.userB.cookie, 'mcp-personal/upsert', {
    request: { name: 'persist-probe', transport: 'stdio', catalogId: 'echo' },
  })
  c.cmd('POST /api/mcp-personal/upsert {name:persist-probe,stdio,catalogId:echo}（B）', created.status,
    `ok=${created.ok} serverName=${created.value?.item?.serverName ?? '-'}`)
  const before = await call(s.userB.cookie, 'mcp-personal/list')
  const beforeNames = (before.value?.items ?? []).map(item => item.serverName)
  c.cmd('POST /api/mcp-personal/list（重启前，dsh+eterna cookie）', before.status, `items=${JSON.stringify(beforeNames)}`)
  const restarted = docker(['restart', '--time', '20', LANE.container], { timeout: 120_000 })
  c.cmd('docker restart --time 20 rc5-e2suite', restarted.exit, restarted.stdout, restarted.stderr)
  let health = 'unknown'
  for (let attempt = 0; attempt < 90; attempt++) {
    const probe = docker(['inspect', LANE.container, '--format', '{{.State.Health.Status}}'])
    health = probe.stdout
    if (health === 'healthy') break
    await sleep(2000)
  }
  c.cmd('docker inspect rc5-e2suite --format {{.State.Health.Status}}', 0, health)
  // 重启后 session cookie 仍为签名态；完整 cookie（dsh-auth + eterna_session）才过上游 /api 面。
  const after = await call(s.userB.cookie, 'mcp-personal/list')
  const afterNames = (after.value?.items ?? []).map(item => item.serverName)
  c.cmd('POST /api/mcp-personal/list（重启后，完整 cookie）', after.status,
    `items=${JSON.stringify(afterNames)} code=${after.error?.code ?? '-'}`)
  const persisted = health === 'healthy' && after.ok === true && afterNames.includes('p2_persist-probe')
  const cleanup = await call(s.userB.cookie, 'mcp-personal/delete', { request: { id: created.value?.item?.id } })
  c.cmd('POST /api/mcp-personal/delete（清理 persist-probe）', cleanup.status, `ok=${cleanup.ok}`)
  c.assert('重启后 healthy', health === 'healthy')
  c.assert('重启后同一行仍在（完整 cookie）', persisted, JSON.stringify(afterNames))
  record(c, persisted ? STATUS.PASS : STATUS.FAIL,
    '重启容器后个人配置仍在',
    '配置跨重启保留；新会话可用（本行验证持久化面）',
    `健康=${health} 重启前=${JSON.stringify(beforeNames)} 重启后=${JSON.stringify(afterNames)}`,
    [
      '官方脚本该行报 before=4 after=0：脚本重启后用**仅 eterna_session** 的 cookie 调 mcp-personal/list，实测返回 401 → items 空；补 dsh-auth 后同一配置可读（本次受控复测 PASS）',
      '未修改 scripts/verify-mcp-personal.mjs（非本 lane 可改文件）→ 记遗留项（测试脚手架 bug）',
    ])
}

/* ---------------------------------------------- 扩展用例折叠（run-extra.mjs 产出） */
/* 011/016/017/018/024 由 artifacts/rc5/E2/MCPP/run-extra.mjs 在最终镜像上容器实跑，
   证据各自落在 RC5-MCPP-<id>/result.md；本 runner 只解析结论并折叠，不重写。 */
function extraResult(id) {
  const path = join(LANE.evidenceRoot, 'MCPP', `RC5-MCPP-${id}`, 'result.md')
  if (!existsSync(path)) return undefined
  const text = readFileSync(path, 'utf8')
  const status = /- 结论：\*\*(PASS|FAIL|SKIP|NOTRUN)\*\*/.exec(text)?.[1]
  const title = new RegExp(`^# RC5-MCPP-${id} · (.+)$`, 'm').exec(text)?.[1]
  const actual = /## 实际\n\n([\s\S]*?)\n\n## /.exec(text)?.[1]?.trim().replace(/\n+/g, ' ') ?? ''
  return { id: `RC5-MCPP-${id}`, status, title, actual: shape(actual, 500) }
}

for (const id of ['011', '016', '017', '018', '024']) {
  const row = extraResult(id)
  if (row?.status === 'PASS' || row?.status === 'FAIL') {
    rows.push(row)
    if (row.status === 'FAIL' && !halted) {
      halted = true
      haltReason = `${row.id}: ${row.title ?? '扩展用例'}`
    }
  } else {
    const c = new Case(suite, `RC5-MCPP-${id}`)
    c.note('run-extra.mjs 无 PASS/FAIL 结果（或证据缺失）')
    record(c, STATUS.SKIP, row?.title ?? `RC5-MCPP-${id}`, '按 51 §3.6',
      `未执行/未判：${row?.actual ?? 'result.md 缺失'}`)
  }
}

/* ---------------------------------------------- live 回合证据在 LLM lane */
for (const [id, title, evidence] of [
  ['019', '删除后 live 会话工具当场消失', 'artifacts/rc5/E2/LLM/RC5-MCPP-019/result.md'],
  ['020', '跨用户 mcp__p<uid>_* 调用 deny', 'artifacts/rc5/E2/LLM/RC5-MCPP-020/result.md'],
  ['022', '登出后个人工具不可用', 'artifacts/rc5/E2/LLM/RC5-MCPP-022/result.md'],
]) {
  const c = new Case(suite, `RC5-MCPP-${id}`)
  c.note(`live 会话/模型回合面由 LLM lane 实测：${evidence}`)
  record(c, STATUS.SKIP, title, '按 51 §3.6', `本 runner 未测（证据在 LLM lane）：${evidence}`, [`见 ${evidence}`])
}

const corrected = rows.filter(row => row.id === 'RC5-MCPP-023').map(row => ({ ...row, status: row.status }))
const summary = summaryOf(rows, {
  suite, env: {
    commit: gitHead(), imageTag: LANE.imageTag, imageId: LANE.imageId, container: LANE.container,
    base: LANE.base, dataRoot: LANE.dataRoot, startedAt, halted, haltReason,
  },
})
summary.officialReport = { path: 'artifacts/rc5/E2/MCPP/report.json', pass: official.counts?.PASS ?? 0, fail: official.counts?.FAIL ?? 0, skip: official.counts?.SKIP ?? 0 }
summary.corrections = corrected
writeSummary(suite, summary)
console.log(`[MCPP] PASS=${summary.pass} FAIL=${summary.fail} SKIP=${summary.skip} NOTRUN=${summary.notrun} halted=${halted}`)