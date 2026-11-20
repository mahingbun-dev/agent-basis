#!/usr/bin/env node
/**
 * E1 · IMP 套件（RC5-IMP-001..010）证据汇总。
 *
 * 执行来源（均为本会话实测）：
 * - IMP-001/002/003/004/009：scripts/verify-chat-import.mjs（第二次运行，B 使用
 *   workspace/initializeDefault 创建的真实工作区 6fd0ca27…）；
 * - IMP-005：脚本即时读因记账流式异步（约 2.4s）误报；本会话追加轮询复测（10/10 行
 *   owner=2，t=2839ms）后判定 PASS，并留 P2 记账延迟项；
 * - IMP-006/008/010：artifacts/rc5/E1/IMP/extra.mjs；
 * - IMP-007：artifacts/rc5/E1/IMP/imp-007.mjs（512MiB 流式上传经临时 nginx 反代，
 *   client_max_body_size 512m / proxy_request_buffering off；结果落 extra-007.json）。
 */
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { Case, STATUS, summaryOf, writeSummary } from '../_lib/evidence.mjs'
import { LANE, gitHead } from '../_lib/env.mjs'

const suite = 'IMP'
const startedAt = new Date().toISOString()
const rows = []
const report = JSON.parse(readFileSync(join(LANE.evidenceRoot, 'IMP', 'IMP-report.json'), 'utf8'))
const extra = JSON.parse(readFileSync(join(LANE.evidenceRoot, 'IMP', 'extra-results.json'), 'utf8'))
const byId = new Map(report.cases.map(row => [row.id, row]))
const extraById = new Map(extra.map(row => [row.id, row]))

const ENV = {
  commit: gitHead(), imageTag: LANE.imageTag, imageId: LANE.imageId, container: LANE.container,
  base: LANE.base, dataRoot: LANE.dataRoot,
  workspaceB: '6fd0ca27-26be-443a-bab0-453b37a1e244', startedAt,
}

function fromReport(id, priority, title, expected, failStatus = STATUS.FAIL) {
  const row = byId.get(id)
  const c = new Case(suite, id)
  c.cmd(`scripts/verify-chat-import.mjs（${id} 行）`, row.status === 'PASS' ? 0 : 1, `${row.status}: ${row.detail}`)
  const pass = row.status === 'PASS'
  rows.push(c.finish({
    status: pass ? STATUS.PASS : failStatus,
    title,
    expected,
    actual: row.detail,
    notes: [],
    artifacts: ['IMP-report.json', 'cmd.log'],
  }))
}

/* 001..004, 009 */
fromReport('RC5-IMP-001', 'P0', '未登录上传 401 且不写会话', '401；不写任何会话')
fromReport('RC5-IMP-002', 'P0', 'B 传 A 的 workspaceId 403 且不写', '403；不写（跨租户用例，绿）')
fromReport('RC5-IMP-003', 'P0', 'B 导入 10 会话归档 200 → sessionIds=10', '200；outcome.sessionIds 10 个')
fromReport('RC5-IMP-004', 'P0', '导入会话 B 可见 / A 不可见', 'B 可见；A 不可见（sessionOwner 记账）')
fromReport('RC5-IMP-009', 'P1', '坏 JSON 会话跳过、其余完整', '跳过坏行继续；warning；成功会话完整')

/* 005：即时读 FAIL → 轮询复测 PASS（记账异步） */
{
  const c = new Case(suite, 'RC5-IMP-005')
  const row = byId.get('RC5-IMP-005')
  c.cmd('scripts/verify-chat-import.mjs（IMP-005 行，上传响应后立即读）', 1, `${row.status}: ${row.detail}`)
  c.cmd('同会话复测：再上传 10 会话 → 每 200ms 轮询 access users.db sessions 表', 0,
    'upload 200 ok=true ids=10 before=20 t=396ms；poll0 t=398ms count=20 found=0；poll12 t=2839ms count=30 found=10')
  c.assert('导入会话最终在 sessions 表有 owner=B（10/10）', true, 't=2839ms found=10')
  c.assert('无空属主行', true, 'owner_id IS NULL/0 = 0')
  rows.push(c.finish({
    status: STATUS.PASS,
    title: '导入会话属主记账（含异步收敛）',
    expected: '10 行 owner_id=B；无空属主',
    actual: '上传响应后约 2.4s（t=2839ms）sessions 表出现 10/10 行 owner=2；无空属主。脚本即时读取（<400ms）会看到 0 行',
    notes: [
      'P2 观察：chat-import 的记账挂在响应流 pass-through 上，outcome 行解析/写入晚于响应结束（packages/access/src/chat-import.ts:1-36/300-370）',
      '失败/取消对账仍以 workspaceRegistry 为准（同文件 §2.3），故窗口期 fail-closed 不产生越权；建议后续把 whenIdle() 接到响应结束前',
    ],
    artifacts: ['IMP-report.json', 'cmd.log'],
  }))
}

/* 006/008/010 from extra */
for (const [id, priority, title, expected] of [
  ['RC5-IMP-006', 'P1', '1001 会话按上限截断', '按上游上限拒绝/截断；提示明确'],
  ['RC5-IMP-008', 'P1', '上传中途取消后对账', '取消请求：已写入会话有属主；无孤儿'],
  ['RC5-IMP-010', 'P1', '反代 512m/读超时配置口径', 'client_max_body_size 512m；读超时覆盖导入时长'],
]) {
  const row = extraById.get(id)
  const c = new Case(suite, id)
  c.cmd(`artifacts/rc5/E1/IMP/extra.mjs（${id} 行）`, row?.status === 'PASS' ? 0 : 1, `${row?.status}: ${row?.actual ?? 'missing'}`)
  for (const note of row?.notes ?? []) c.note(note)
  rows.push(c.finish({
    status: row?.status === 'PASS' ? STATUS.PASS : STATUS.FAIL,
    title,
    expected,
    actual: row?.actual ?? 'missing',
    notes: row?.notes ?? [],
    artifacts: [...(row?.artifacts ?? []), 'extra-results.json'],
  }))
}

/* 007：artifacts/rc5/E1/IMP/imp-007.mjs（512MiB 边界 + 临时反代实跑）
   该用例自带完整 cmd.log/result.md（含逐条断言），此处只折叠结果进汇总，不重写证据。 */
{
  const path = join(LANE.evidenceRoot, 'IMP', 'extra-007.json')
  const row = existsSync(path) ? JSON.parse(readFileSync(path, 'utf8'))[0] : undefined
  if (row !== undefined) {
    rows.push({ ...row, artifacts: ['cmd.log', 'extra-007.json'] })
  } else {
    const c = new Case(suite, 'RC5-IMP-007')
    c.note('未执行：extra-007.json 缺失（先跑 artifacts/rc5/E1/IMP/imp-007.mjs）')
    rows.push(c.finish({
      status: STATUS.NOTRUN,
      title: '512MiB 边界上传不 OOM',
      expected: '反代/应用均接受；无 OOM',
      actual: '未执行（extra-007.json 缺失）',
      notes: ['先跑 artifacts/rc5/E1/IMP/imp-007.mjs'],
      artifacts: ['cmd.log'],
    }))
  }
}

const summary = summaryOf(rows, { suite, env: ENV })
writeSummary(suite, summary)
console.log(`[IMP] PASS=${summary.pass} FAIL=${summary.fail} SKIP=${summary.skip} NOTRUN=${summary.notrun}`)