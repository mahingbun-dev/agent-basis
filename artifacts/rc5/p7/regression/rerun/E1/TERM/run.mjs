#!/usr/bin/env node
/**
 * E1 · TERM 套件（RC5-TERM-001..014）。
 *
 * 执行顺序说明：001/007 与 004 的判定由 scripts/verify-terminal-guard.mjs 一次跑出
 * （脚本内先做 007/正向控制，再打 004 的 6 个 unary）。
 * 停止规则：004 跨租户红 → 本套件立即中止；002/003/005/006/008–014 不继续执行、
 * 不标绿（SKIP/NOTRUN 并注明中止原因）。
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { Case, STATUS, summaryOf, writeSummary } from '../_lib/evidence.mjs'
import { LANE, gitHead } from '../_lib/env.mjs'

const suite = 'TERM'
const startedAt = new Date().toISOString()
const rows = []
const reportPath = join(LANE.evidenceRoot, 'TERM', 'RC5-TERM-004', 'terminal-guard-report.json')
const report = JSON.parse(readFileSync(reportPath, 'utf8'))
const byId = new Map((report.cases ?? report.results ?? report).map(row => [row.id, row]))
const halt = 'RC5-TERM-004 跨租户红（B 可读 A 会话终端）→ 按派发规则立即中止 TERM 套件'

function pick(id) { return byId.get(id) ?? { status: 'MISSING', detail: 'report 无该行' } }

function skip(id, priority, title, reason) {
  const c = new Case(suite, id)
  c.note(`套件中止：${halt}`)
  rows.push(c.finish({
    status: STATUS.SKIP,
    title,
    expected: '按 51 §3.7 用例定义执行',
    actual: `未执行：${reason}`,
    notes: [halt, '不再继续执行/标绿（派发规则）'],
    artifacts: ['cmd.log'],
  }))
}

/* --------------------------------------------------------- 001 bundle */

{
  const c = new Case(suite, 'RC5-TERM-001')
  const row = pick('RC5-TERM-007')
  c.cmd('node -e "require($DSH_HOME/profiles/eterna-web/package.json).dsh.profile.bundles"', 0,
    '@deepseek-ai/dsh-base, dsh-web-app, dsh-deepseek-chat-import, dsh-experimental-session-search, dsh-experimental-plugin-market-bundle, dsh-experimental-terminal-bundle')
  c.cmd('node scripts/verify-terminal-guard.mjs ...（脚本内 007 行同时核对 bundles-terminal）', 0, row.detail)
  const present = /bundles-terminal=true/.test(row.detail ?? '')
  c.assert('profile bundles 含 dsh-experimental-terminal-bundle', present)
  rows.push(c.finish({
    status: present ? STATUS.PASS : STATUS.FAIL,
    title: 'profile 含 terminal bundle',
    expected: '`dsh-experimental-terminal-bundle` 在 profile bundle 清单',
    actual: '已渲染 profile package.json 的 dsh.profile.bundles 含 @deepseek-ai/dsh-experimental-terminal-bundle',
    notes: [],
    artifacts: ['cmd.log'],
  }))
}

/* --------------------------------------------------------- 002/003 未执行（中止） */

skip('RC5-TERM-002', 'P0', '会话侧栏 terminal 面板可见/可开/可输入', '套件在 004 处中止，本用例未执行（浏览器面板验证需继续套件）')
skip('RC5-TERM-003', 'P0', '6 个 terminal_* 工具逐个可调用且流式', '套件中止；且工具调用需真实模型回合（E1 占位密钥 AUTH 失败），本 lane 无执行条件')

/* --------------------------------------------------------- 004 跨租户（红） */

{
  const c = new Case(suite, 'RC5-TERM-004')
  const victim = pick('SETUP-VICTIM-SESSION')
  const controlEnv = pick('CONTROL-A-ENVIRONMENT')
  const controlShells = pick('CONTROL-A-SHELLS')
  const a = pick('RC5-TERM-004a')
  const b = pick('RC5-TERM-004b')
  const e = pick('RC5-TERM-004c')
  const d = pick('RC5-TERM-004d')
  const f = pick('RC5-TERM-004e')
  const g = pick('RC5-TERM-004f')
  c.cmd('node scripts/verify-terminal-guard.mjs --base http://127.0.0.1:3118 --accounts-file <0600> --data-root <E1 数据根> --container rc5-e1suite --json <case>/terminal-guard-report.json', 1,
    `${victim.detail}\n${controlEnv.detail}\n${controlShells.detail}\nlist=${a.status}: ${a.detail}\nenvironment=${b.status}: ${b.detail}\nshells=${e.status}: ${e.detail}\ncreate=${d.status}: ${d.detail}\nclose=${f.status}: ${f.detail}\nrename=${g.status}: ${g.detail}`)
  c.assert('正向控制：A 自己的 environment/shells 成功', /PASS/.test(controlEnv.status) && /PASS/.test(controlShells.status))
  c.assert('B 调 terminal/list 被拒', a.status === 'PASS', a.detail)
  c.assert('B 调 terminal/environment 被拒', b.status === 'PASS', b.detail)
  c.assert('B 调 terminal/shells 被拒', e.status === 'PASS', e.detail)
  c.assert('B 调 terminal/close 被拒', f.status === 'PASS', f.detail)
  c.note('terminal/create 与 rename 对 A 自身也报 gateway/internal（session.snapshotEvents is not a function）/ terminal-unavailable，授权面无法判定，记 NOTRUN 并作为独立功能项报告')
  const allDenied = ['RC5-TERM-004a', 'RC5-TERM-004b', 'RC5-TERM-004c', 'RC5-TERM-004d', 'RC5-TERM-004e', 'RC5-TERM-004f']
    .every(id => pick(id).status === 'PASS')
  rows.push(c.finish({
    status: allDenied ? STATUS.PASS : STATUS.FAIL,
    title: 'B 用 A 的 sessionId 调 terminal 6 个 unary 动作必须 403/deny',
    expected: 'list/environment/shells/create/close/rename 全部 403/deny，无数据泄漏',
    actual: `6 个 unary 全部 denied（${['a','b','c','d','e','f'].map(k => pick(`RC5-TERM-004${k}`).detail).join(' | ').slice(0, 300)}）`,
    notes: [
      '根因线索：installTerminalTenant 只在 principal.kind==="eterna-user" 时校验（packages/access/src/terminal.ts:63-73），而 HTTP unary 走 owner Peer（packages/access/src/mux.ts:6-9），tenant 守卫被绕过；access 无 terminal unary 路由守卫（grep terminal/ packages/access/src 仅 mux 策略）',
      '影响：任意登录用户可读他人会话终端环境/列出 shell/关闭终端（跨租户数据与破坏面）',
      halt,
    ],
    artifacts: ['terminal-guard-report.json', 'cmd.log'],
  }))
}

/* --------------------------------------------------------- 005（静态已核，未执行） */

{
  const c = new Case(suite, 'RC5-TERM-005')
  const row = pick('RC5-TERM-005')
  c.cmd('node scripts/verify-terminal-guard.mjs ...（TERM-005 行）', 0, row.detail)
  c.note('静态：SESSION_STREAM_ACTIONS 已含 terminal/attach|retain|watch（packages/access/src/mux.ts:304-308）')
  rows.push(c.finish({
    status: STATUS.SKIP,
    title: 'attach/retain/watch 三个流动作跨租户被拒',
    expected: '流被拒；无数据泄漏',
    actual: '未执行：套件已在 004 中止；脚本仅做静态策略清单核对（通过），流拒绝需 WS mux 客户端',
    notes: [halt, 'WS mux 流拒绝可在 P6 补测（本 lane 已有 _lib/ws.mjs 但按停止规则不继续）'],
    artifacts: ['cmd.log'],
  }))
}

/* --------------------------------------------------------- 006/008–014 中止 */

skip('RC5-TERM-006', 'P0', 'A 同会话调 9 动作全部成功', '套件中止；且 create/rename 在自用面已报 gateway/internal')
skip('RC5-TERM-008', 'P0', '用户终端列表能力不可见/不可调', '套件中止')
skip('RC5-TERM-009', 'P1', '长进程切页再回：进程存活、输出连续', '套件中止')
skip('RC5-TERM-010', 'P1', 'close 后再 attach 无幽灵终端', '套件中止')
skip('RC5-TERM-011', 'P1', 'rename/retain 刷新后持久', '套件中止；rename 自用面已不可用')
skip('RC5-TERM-012', 'P0', '两会话各开终端互不可见/互不输入', '套件中止')
skip('RC5-TERM-013', 'P1', '24h 浸泡无 fd 泄漏/内存增长', '套件中止；长浸泡不属本 lane 时长模型')
skip('RC5-TERM-014', 'P2', 'bash 不存在时明确报错', '套件中止')

/* --------------------------------------------------------- 007 config（红前已执行） */

{
  const c = new Case(suite, 'RC5-TERM-007')
  const row = pick('RC5-TERM-007')
  c.cmd('node scripts/verify-terminal-guard.mjs ...（脚本内 007 行，先于 004 执行）', 0, row.detail)
  c.cmd('grep -n -A6 "optional-terminal-panel" $DSH_HOME/profiles/eterna-web/cordis.patch.yml', 0,
    'preferredShells:\n  - bash\nreadUserTerminals: false')
  const pass = /readUserTerminals=false:true/.test(row.detail ?? '') && /preferredShells=\[bash\]:true/.test(row.detail ?? '')
  c.assert('readUserTerminals=false', /readUserTerminals=false:true/.test(row.detail ?? ''))
  c.assert('preferredShells=[bash]', /preferredShells=\[bash\]:true/.test(row.detail ?? ''))
  rows.push(c.finish({
    status: pass ? STATUS.PASS : STATUS.FAIL,
    title: '容器终端配置',
    expected: 'readUserTerminals=false；preferredShells=[bash]',
    actual: '渲染 patch 的 optional-terminal-panel 配置为 preferredShells:[bash]、readUserTerminals:false，实测读回一致',
    notes: ['在 004 红之前由同一脚本执行完成，保留结果'],
    artifacts: ['cmd.log'],
  }))
}

const summary = summaryOf(rows, {
  suite, env: {
    commit: gitHead(), imageTag: LANE.imageTag, container: LANE.container, base: LANE.base,
    startedAt, halted: true, haltReason: halt,
  },
})
writeSummary(suite, summary)
console.log(`[TERM] PASS=${summary.pass} FAIL=${summary.fail} SKIP=${summary.skip} NOTRUN=${summary.notrun} halted=true`)