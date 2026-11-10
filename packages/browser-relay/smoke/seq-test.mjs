// 临时诊断脚本：模拟 playwright 初始化序列，定位 /cdp 腿卡点（完成后可删）
import { spawn } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { mkdirSync, readdirSync } from 'node:fs'
import WebSocket from 'ws'

const PKG = process.cwd()
const REPO = resolve(PKG, '../..')
const EXT = join(REPO, 'packages/extension-companion/dist')
const bdir = join(PKG, 'smoke/.browsers')
function find(dir, d = 12) {
  if (d < 0) return null
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name)
    if (e.isDirectory()) { const r = find(p, d - 1); if (r) return r }
    else if (p.endsWith('/Chromium.app/Contents/MacOS/Chromium') || p.endsWith('/chrome')) return p
  }
  return null
}
const CH = find(bdir)

const relay = spawn('node', [join(PKG, 'dist/cli.mjs'), 'start', '--port', '9310'], { stdio: ['ignore', 'ignore', 'inherit'] })
await new Promise(r => setTimeout(r, 1200))
const profile = join(tmpdir(), 'eterna-seq-' + Date.now())
mkdirSync(profile, { recursive: true })
const chrome = spawn(CH, ['--user-data-dir=' + profile, '--no-first-run', '--force-renderer-accessibility', '--headless=new', `--load-extension=${EXT}`, 'about:blank'], { stdio: 'ignore' })
const t0 = Date.now()
for (;;) {
  const st = await fetch('http://127.0.0.1:9310/api/status').then(r => r.json())
  if (st.extensionConnected) { console.log('扩展已连接 chrome=' + st.chromeVersion); break }
  if (Date.now() - t0 > 30000) { console.log('扩展连接超时'); process.exit(1) }
  await new Promise(r => setTimeout(r, 500))
}

const ws = new WebSocket('ws://127.0.0.1:9310/cdp')
let seq = 0
const pending = new Map()
ws.on('message', d => {
  const m = JSON.parse(d.toString())
  if (m.id !== undefined && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id) }
  else if (m.method !== undefined) console.log('EVENT:', m.method, m.sessionId ?? '')
})
function send(method, params = {}, ms = 8000) {
  const id = ++seq
  return new Promise(resolve => {
    pending.set(id, resolve)
    ws.send(JSON.stringify({ id, method, params }))
    setTimeout(() => { if (pending.has(id)) { pending.delete(id); resolve({ TIMEOUT: true }) } }, ms)
  })
}
ws.on('open', async () => {
  const steps = [
    ['Browser.getVersion', {}],
    ['Target.getBrowserContexts', {}],
    ['Target.getTargets', {}],
    ['Target.setAutoAttach', { autoAttach: true, waitForDebuggerOnStart: false, flatten: true }],
    ['Target.setDiscoverTargets', { discover: true }],
  ]
  for (const [m, p] of steps) {
    const r = await send(m, p)
    console.log(m, '→', JSON.stringify(r).slice(0, 240))
    if (r.TIMEOUT) { console.log('★ 卡在这条:', m); break }
  }
  // 逐步工具调用（拿完整错误）
  const call = async (name, args) => {
    const r = await fetch('http://127.0.0.1:9310/api/tools', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name, args }),
      signal: AbortSignal.timeout(60_000),
    })
    return await r.json()
  }
  const snap1 = await call('browser_snapshot', { url: 'http://127.0.0.1:9310/fixture' })
  console.log('SNAP1:', JSON.stringify(snap1).slice(0, 500))
  const inputRef = /textbox "搜索关键词"[^\n]*\[ref=([^\]]+)\]/.exec(String(snap1.result?.snapshot ?? ''))?.[1]
  const btnRef = /button "提交"[^\n]*\[ref=([^\]]+)\]/.exec(String(snap1.result?.snapshot ?? ''))?.[1]
  console.log('inputRef=', inputRef, 'btnRef=', btnRef)
  const tabId = snap1.result?.tabId
  const fillRes = await call('browser_fill', { tabId, ref: inputRef, value: 'playwright' })
  console.log('FILL:', JSON.stringify(fillRes))
  const clickRes = await call('browser_click', { tabId, ref: btnRef })
  console.log('CLICK:', JSON.stringify(clickRes))
  const snap2 = await call('browser_snapshot', { tabId })
  console.log('SNAP2:', JSON.stringify(snap2).slice(0, 400))
  process.exit(0)
})
