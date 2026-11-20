#!/usr/bin/env node
/**
 * 补充回归面 · companion 中继协议实测（54 §5.5「浏览器执行面/companion 中继」）。
 *
 * 验的是产品代码面：access 令牌视图/reset + browser-relay 的 /extension 腿
 * 凭据校验、命名空间映射、hello 握手与 /api/status 在线探测。
 *
 * 边界：用协议级仿真客户端连 /extension（真实 Chrome 扩展需交互式加载未打包
 * 扩展，headless 环境不可无人值守完成）——REAL-EXT 记 NOTRUN 并在 result.md 注明。
 *
 * 只动 E2 测试 lane（rc5-e2suite / 3119 / relay 9322）。
 */
import { createRequire } from 'node:module'
import { mkdirSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  bootTokenFromContainer, bootstrapDshSession, loadAccounts, login, shape,
} from '../../../../../scripts/rc5-test-client.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO = join(HERE, '..', '..', '..', '..', '..')
const OUT = join(REPO, 'artifacts', 'rc5', 'p7', 'regression', 'supplement')
const BASE = 'http://127.0.0.1:3119'
const RELAY_HTTP = 'http://127.0.0.1:9322'
const RELAY_WS = 'ws://127.0.0.1:9322/extension'
const CONTAINER = 'rc5-e2suite'
const ACCOUNTS = join(homedir(), 'eterna-data', 'test-rc5', '.test-accounts.json')
mkdirSync(OUT, { recursive: true })

const req = createRequire(join(REPO, 'packages/browser-relay/package.json'))
const WebSocket = req('ws')
const cmds = []
const cmd = (line, ok, detail = '') => {
  cmds.push({ line, ok: ok === true, detail: String(detail).slice(0, 400) })
  console.log(`${ok === true ? 'PASS' : 'FAIL'}  ${line}  ${detail}`)
}
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))

const accounts = loadAccounts(ACCOUNTS)
const dsh = await bootstrapDshSession(BASE, bootTokenFromContainer(CONTAINER))
const auth = await login(BASE, accounts.admin.account, accounts.admin.password)
if (auth.status !== 200) throw new Error(`登录失败 ${auth.status}`)
const cookie = `${dsh}; ${auth.cookie}`

async function getJson(url, headers = {}) {
  const res = await fetch(url, { headers })
  return { status: res.status, body: await res.json().catch(() => undefined) }
}

/* 1) 匿名 401（令牌视图必须登录） */
{
  const anon = await getJson(`${BASE}/access/api/companion`)
  cmd('companion 视图：匿名 401', anon.status === 401, `status=${anon.status}`)
}

/* 2) reset 铸造用户令牌（测试 lane 的 admin；重置只影响本人令牌） */
let token
{
  const reset = await fetch(`${BASE}/access/api/companion/reset`, { method: 'POST', headers: { cookie } })
  const body = await reset.json().catch(() => undefined)
  token = typeof body?.token === 'string' ? body.token : undefined
  cmd('companion reset：签发本人令牌 + guideUrl', reset.status === 200 && token !== undefined && typeof body?.guideUrl === 'string',
    `status=${reset.status} token=${token === undefined ? 'none' : 'issued'} guide=${body?.guideUrl ?? '-'}`)
}

/* 3) 错误令牌：/extension 腿必须拒绝 */
if (token !== undefined) {
  const bad = await new Promise(resolve => {
    const ws = new WebSocket(`${RELAY_WS}?token=wrong-token`)
    const timer = setTimeout(() => { ws.close(); resolve({ closed: false, code: -1 }) }, 5000)
    ws.on('close', code => { clearTimeout(timer); resolve({ closed: true, code }) })
    ws.on('error', () => { /* close 随后到 */ })
  })
  cmd('relay /extension：错误令牌被拒（连接关闭）', bad.closed === true, `closed=${bad.closed} code=${bad.code}`)
}

/* 4) 正确令牌：hello → /api/status 在线 + tokenConnected */
let ws
if (token !== undefined) {
  ws = new WebSocket(`${RELAY_WS}?token=${encodeURIComponent(token)}`)
  const opened = await new Promise(resolve => {
    const timer = setTimeout(() => resolve(false), 8000)
    ws.on('open', () => { clearTimeout(timer); resolve(true) })
    ws.on('error', () => { clearTimeout(timer); resolve(false) })
  })
  cmd('relay /extension：正确令牌握手（WS open）', opened === true)
  if (opened) {
    ws.send(JSON.stringify({ t: 'hello', proto: 1, ext: 'rc5-sim', extVersion: '0.0.0-sim', chromeVersion: 'test' }))
    await sleep(500)
    const status = await getJson(`${RELAY_HTTP}/api/status?token=${encodeURIComponent(token)}`)
    cmd('relay /api/status：tokenConnected=true（命名空间=令牌）', status.body?.tokenConnected === true,
      shape(status.body, 240))
    cmd('relay /api/status：extensionConnected=true + browsers≥1', status.body?.extensionConnected === true && (status.body?.connectedBrowsers ?? 0) >= 1,
      `connectedBrowsers=${status.body?.connectedBrowsers ?? '-'}`)
    /* 5) 断开 → tokenConnected=false */
    ws.close()
    await sleep(800)
    const after = await getJson(`${RELAY_HTTP}/api/status?token=${encodeURIComponent(token)}`)
    cmd('relay /api/status：断开后 tokenConnected=false', after.body?.tokenConnected !== true,
      `tokenConnected=${after.body?.tokenConnected ?? '-'}`)
  }
}

const pass = cmds.every(item => item.ok)
writeFileSync(join(OUT, 'companion-relay.log'), cmds.map(item => `${item.ok ? 'PASS' : 'FAIL'}  ${item.line}\n${item.detail}\n`).join('\n') + `\nRESULT=${pass ? 'PASS' : 'FAIL'}\n`)
writeFileSync(join(OUT, 'companion-relay.md'), [
  '# RC5 补充回归面 · companion 中继协议实测（54 §5.5）',
  '',
  `- 环境：E2 lane \`${CONTAINER}\`（3119）+ relay \`${RELAY_WS}\``,
  '- 方法：access 令牌视图/reset → relay /extension 腿凭据校验 → hello 握手 → /api/status 在线探测 → 断开回收',
  '',
  '## 结论',
  '',
  `**${pass ? 'PASS' : 'FAIL'}**（协议级）。`,
  '',
  ...cmds.map(item => `- ${item.ok ? 'PASS' : 'FAIL'} · ${item.line}${item.detail === '' ? '' : `（${item.detail}）`}`),
  '',
  '## 边界',
  '',
  '- **REAL-EXT = NOTRUN**：真实 Chrome 扩展需交互式加载未打包扩展（developer mode / 持久 profile）；本验收为无人值守 headless 环境，不以仿真冒充实测。',
  '- 产品代码面已覆盖：令牌签发/视图归属、错误令牌拒绝、命名空间=令牌、在线探测与断开回收。',
].join('\n'))
process.exit(pass ? 0 : 1)