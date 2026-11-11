#!/usr/bin/env node
/** G-PS-03 截图调试探针:对当前 t7-studio patch(不改写)直查 loopPrompt/ai-status。 */
import { spawn, spawnSync } from 'node:child_process'
import { existsSync, openSync, readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..')
const home = resolve(repoRoot, '.eterna-home-t7')
const profile = resolve(home, 'profiles', 't7-studio')
const logsDir = resolve(home, 'logs')
const hostLog = resolve(logsDir, 'probe-host.log')
const port = 3108
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

let host
const out = openSync(hostLog, 'w')
host = spawn('node', [
  resolve(profile, 'node_modules/@deepseek-ai/dsh/lib/bin.js'),
  '--profile', 't7-studio', '--host', '127.0.0.1', '--port', String(port), '--no-open',
], {
  cwd: profile,
  env: { ...process.env, DSH_HOME: home, LITELLM_API_KEY: readFileSync(resolve(repoRoot, '.secrets/litellm-master-key.txt'), 'utf8').trim() },
  stdio: ['ignore', out, out],
})
try {
  let token = ''
  for (let i = 0; i < 90; i++) {
    const m = readFileSync(hostLog, 'utf8').match(/dsh web: .*token=([A-Za-z0-9_-]+)/)
    if (m) { token = m[1]; break }
    await sleep(1000)
  }
  if (!token) throw new Error('no token')
  const res = await fetch(`http://127.0.0.1:${port}/connect?token=${token}&interactions=answer`, { redirect: 'manual' })
  const cookie = res.headers.get('set-cookie')?.split(';')[0]
  const call = async (endpoint, args = {}) => {
    const r = await fetch(`http://127.0.0.1:${port}/api/${endpoint}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ type: 'client-request', rpcId: `probe-${Math.random()}`, method: endpoint, payload: { args } }),
    })
    const body = await r.json()
    return body.result
  }
  console.log('ai-status (input {}):', JSON.stringify(await call('loopPrompt/ai-status', { input: {} })))
  console.log('ai-status ({}):', JSON.stringify(await call('loopPrompt/ai-status', {})))
} finally {
  if (host.exitCode === null) { host.kill('SIGTERM'); await sleep(3000) }
  spawnSync('pkill', ['-f', 'profile t7-studio'], { stdio: 'ignore' })
  await sleep(1500)
}
