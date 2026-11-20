#!/usr/bin/env node
/**
 * terminal 租户守卫验证（51 §3.7 / §4；54 §6.3；T47）。
 *
 * 覆盖：
 *   TERM-004   B 用 A 的 sessionId 调 6 个 unary 动作（close/create/environment/
 *              list/rename/shells）→ 必须 403/deny
 *   TERM-005   attach/retain/watch 三个流动作 → 流被拒（WS mux 面，HTTP 不可达；
 *              本脚本做静态策略清单核对 + 标 NOTRUN 说明原因，不冒充通过）
 *   TERM-007   容器配置 readUserTerminals=false / preferredShells=['bash'] /
 *              profile bundles 含 terminal bundle
 *
 * 方法学：
 *   - A（admin）先 `session/create` 拿一个**活会话**作为受害者；
 *   - 正向控制：A 调 `terminal/environment`/`terminal/shells` 必须成功（证明方法可用、
 *     参数形状正确）；
 *   - 负向：B 用同一 agentId/sessionId 调，必须在服务入口被拒（terminal/tenant-denied
 *     或 403）。若 B 拿到与 A 相同的值 → P0 跨租户泄漏，脚本 FAIL 并记录脱敏后的
 *     形状（cwd 属于测试账号目录，非凭据）。
 *
 * 需要 dsh-auth + eterna_session 两枚 cookie（与浏览器同构）；boot token 只从容器
 * 日志读入内存，不打印。
 *
 * 用法：
 *   node scripts/verify-terminal-guard.mjs \
 *     --base http://127.0.0.1:3108 \
 *     --accounts-file $HOME/eterna-data/test-rc5/.test-accounts.json \
 *     --data-root $HOME/eterna-data/test-rc5/e1 \
 *     --container eterna-rc5-e1 \
 *     --json artifacts/rc5/p5/testbed/terminal-guard/report.json
 */
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  Report,
  STATUS,
  bootTokenFromContainer,
  bootstrapDshSession,
  defaultPaths,
  loadAccounts,
  login,
  parseArgs,
  rpc,
  shape,
} from './rc5-test-client.mjs'

const args = parseArgs(process.argv.slice(2), { ...defaultPaths() })
const BASE = String(args.base)
const ACCOUNTS_FILE = String(args.accountsFile)
const DATA_ROOT = String(args.dataRoot)
const CONTAINER = String(args.container)
const OUT = args.json === undefined ? undefined : String(args.json)

const report = new Report({ suite: 'TERM', env: { base: BASE, container: CONTAINER, dataRoot: DATA_ROOT }, out: OUT })
const accounts = loadAccounts(ACCOUNTS_FILE)
const dshCookie = await bootstrapDshSession(BASE, typeof args['boot-token'] === 'string' ? args['boot-token'] : bootTokenFromContainer(CONTAINER))

const authA = await login(BASE, accounts.admin.account, accounts.admin.password)
const authB = await login(BASE, accounts.user_b.account, accounts.user_b.password)
const cookieA = `${dshCookie}; ${authA.cookie}`
const cookieB = `${dshCookie}; ${authB.cookie}`
report.add('SETUP-LOGIN', 'P0', authA.status === 200 && authB.status === 200 ? STATUS.PASS : STATUS.FAIL, 'A/B 登录', `a=${authA.status} b=${authB.status}`)

async function call(cookie, method, params) {
  return rpc(BASE, cookie, `terminal/${method}`, params, { timeoutMs: 60_000 })
}

/**
 * 判定“被拒”：错误码含 tenant-denied / tenant/denied / remote-access/denied；或 HTTP 403。
 *
 * remote-access/denied(2026-11-20 W5 修复后新增)：rc.5 网关对非 owner Peer 的
 * terminal 一元调用先按会话资源 decide，拒绝即抛 remote-access/denied
 * (dsh-api-gateway lib/index.js prepareInvocation；dsh-api-remote-access
 * lib/index.js decide)。它是上游唯一的一元跨租户拒绝码——服务入口的
 * terminal/tenant-denied 只在 decide 放行后才会执行（第二道）。两者都算显式拒绝；
 * 拿到数据（ok=true）的路径本函数一律判非拒绝。
 */
function denied(result) {
  const code = String(result?.error?.code ?? '')
  const message = String(result?.error?.message ?? '')
  return result.status === 403
    || code.includes('tenant-denied')
    || code.includes('tenant/denied')
    || code === 'remote-access/denied'
    || /不属于你的会话/.test(message)
}

/* ── TERM-007 静态配置 ─────────────────────────────────────────────── */

await report.run('RC5-TERM-007', 'P0', 'readUserTerminals=false / preferredShells=[bash] / terminal bundle 在', async () => {
  const findings = []
  const profilePkg = join(DATA_ROOT, 'profiles', 'eterna-web', 'package.json')
  const patch = join(DATA_ROOT, 'profiles', 'eterna-web', 'cordis.patch.yml')
  if (!existsSync(profilePkg)) return { status: STATUS.SKIP, detail: `渲染 profile 不存在: ${profilePkg}（容器未启动或 --data-root 不对）` }
  const manifest = JSON.parse(readFileSync(profilePkg, 'utf8'))
  const bundles = manifest?.dsh?.profile?.bundles ?? []
  const hasTerminalBundle = bundles.some(name => String(name).includes('terminal'))
  findings.push(`bundles-terminal=${hasTerminalBundle}`)
  const text = existsSync(patch) ? readFileSync(patch, 'utf8') : ''
  const readUserTerminalsFalse = /readUserTerminals:\s*false/.test(text)
  const preferredBash = /preferredShells:\s*\n\s*-\s*bash/.test(text) || /preferredShells:\s*\[\s*['"]?bash['"]?\s*\]/.test(text)
  findings.push(`readUserTerminals=false:${readUserTerminalsFalse}`, `preferredShells=[bash]:${preferredBash}`)
  const pass = hasTerminalBundle && readUserTerminalsFalse && preferredBash
  return { status: pass ? STATUS.PASS : STATUS.FAIL, detail: findings.join(' ') }
})

/* ── 受害者会话：A 建活会话 ───────────────────────────────────────── */

let victimSession
await report.run('SETUP-VICTIM-SESSION', 'P0', 'A 建立活会话（terminal 方法的受害者）', async () => {
  const created = await rpc(BASE, cookieA, 'session/create', { request: {} })
  victimSession = created.value?.sessionId ?? created.value?.id
  return {
    status: typeof victimSession === 'string' ? STATUS.PASS : STATUS.FAIL,
    detail: typeof victimSession === 'string' ? `sessionId=${victimSession}` : shape(created.error ?? created.text?.slice(0, 160)),
  }
})

/* 正向控制：A 自己必须能用（否则负向结果无意义） */
let positive = { environment: false, shells: false }
if (typeof victimSession === 'string') {
  await report.run('CONTROL-A-ENVIRONMENT', 'P0', 'A 自己的 terminal/environment 成功（正向控制）', async () => {
    const result = await call(cookieA, 'environment', { agentId: victimSession })
    positive.environment = result.ok === true
    return { status: positive.environment ? STATUS.PASS : STATUS.FAIL, detail: positive.environment ? `cwd=${result.value?.cwd ?? '?'}` : shape(result.error ?? result.text?.slice(0, 160)) }
  })
  await report.run('CONTROL-A-SHELLS', 'P0', 'A 自己的 terminal/shells 成功（正向控制）', async () => {
    const result = await call(cookieA, 'shells', { agentId: victimSession })
    positive.shells = result.ok === true
    return { status: positive.shells ? STATUS.PASS : STATUS.FAIL, detail: positive.shells ? `shells=${(result.value ?? []).length}` : shape(result.error ?? result.text?.slice(0, 160)) }
  })
}

/* ── TERM-004 六个 unary 动作跨租户 ───────────────────────────────── */

const unary = [
  {
    id: 'TERM-004a',
    label: 'terminal/list',
    params: { sessionId: victimSession },
    // list 对未知/他人会话的上游语义是空数组；拒绝应显式 deny，不能只是空。
    passWhen: result => denied(result),
  },
  {
    id: 'TERM-004b',
    label: 'terminal/environment',
    params: { agentId: victimSession },
    passWhen: result => denied(result),
  },
  {
    id: 'TERM-004c',
    label: 'terminal/shells',
    params: { agentId: victimSession },
    passWhen: result => denied(result),
  },
  {
    id: 'TERM-004d',
    label: 'terminal/create',
    params: { agentId: victimSession, request: { id: 'b-hijack', cols: 80, rows: 24 } },
    passWhen: result => denied(result),
  },
  {
    id: 'TERM-004e',
    label: 'terminal/close',
    params: { agentId: victimSession, id: 'b-hijack' },
    passWhen: result => denied(result),
  },
  {
    id: 'TERM-004f',
    label: 'terminal/rename',
    params: { agentId: victimSession, id: 'b-hijack', title: 'hijacked' },
    passWhen: result => denied(result),
  },
]

if (typeof victimSession === 'string') {
  for (const item of unary) {
    await report.run(`RC5-${item.id}`, 'P0', `B 用 A 的 session 调 ${item.label} 必须被拒`, async () => {
      const method = item.label.slice('terminal/'.length)
      const asB = await call(cookieB, method, item.params)
      if (item.passWhen(asB)) return { status: STATUS.PASS, detail: `denied code=${asB.error?.code ?? '-'}` }
      // 未拒绝：用 A 的同一调用做对照，区分「跨租户泄漏」与「方法本身不可用」。
      const asA = await call(cookieA, method, item.params)
      const bShape = asB.ok === true ? shape(asB.value) : shape(asB.error)
      if (asA.ok === true && asB.ok === true) {
        const identical = JSON.stringify(asA.value) === JSON.stringify(asB.value)
        return {
          status: STATUS.FAIL,
          detail: `跨租户未拒绝：B 与 A 结果相同=${identical}；B=${bShape.slice(0, 160)}`,
        }
      }
      if (asA.ok !== true && asB.ok !== true) {
        return {
          status: STATUS.NOTRUN,
          detail: `A/B 同错（方法不可用，无法判定授权）：A=${shape(asA.error).slice(0, 100)} B=${bShape.slice(0, 100)}`,
        }
      }
      return {
        status: STATUS.FAIL,
        detail: `B 未被显式拒绝（A.ok=${asA.ok} B.ok=${asB.ok}）：${bShape.slice(0, 160)}`,
      }
    })
  }
} else {
  for (const item of unary) report.add(`RC5-${item.id}`, 'P0', STATUS.NOTRUN, `B 用 A 的 session 调 ${item.label}`, '缺少受害者会话（SETUP-VICTIM-SESSION 失败）')
}

/* ── TERM-005 三个流动作 ──────────────────────────────────────────── */

await report.run('RC5-TERM-005', 'P0', 'attach/retain/watch 流动作被拒（WS mux 面）', async () => {
  // 流动作走 `/api/remote.mux` WebSocket（open frame），HTTP unary 面不承载。
  // 这里只做静态策略清单核对；真实跨租户流拒绝必须在 P6 WS 客户端执行。
  const muxSource = readFileSync(new URL('../packages/access/src/mux.ts', import.meta.url), 'utf8')
  const listed = ['terminal/attach', 'terminal/retain', 'terminal/watch'].every(action => muxSource.includes(`'${action}'`))
  return {
    status: STATUS.NOTRUN,
    detail: listed
      ? '策略清单已含 attach/retain/watch（静态核对通过），但流拒绝需 WS mux 客户端，本脚本未执行；P6 必跑'
      : 'mux.ts 的 SESSION_STREAM_ACTIONS 未包含全部三个流动作（静态失败）',
  }
})

process.exit(report.finish())