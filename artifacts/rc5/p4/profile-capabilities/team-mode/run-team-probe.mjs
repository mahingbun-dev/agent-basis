#!/usr/bin/env node
/**
 * T35 Team mode 默认关：真 boot eterna-web profile + 临时探针插件。
 *
 * 步骤（不改产品文件）：
 *  1. 从 <repo>/.eterna-home/profiles/eterna-web（verify-eterna-web.mjs 物化的生产
 *     渲染 profile：模板直拷 + rc.5 六 bundle manifest）复制到临时 DSH_HOME；
 *  2. 在临时 profile 的 node_modules 挂本目录 probe/（team-default-probe 包）；
 *  3. 以 `--patch overlay.yml` 追加探针行，真 boot（web 宿主照常启动）；
 *  4. 探针在服务就绪后 ctx.agentLoop.create() 新建会话，读 ctx.agentTeams.isEnabled():
 *     期望 false（上游 defaultEnabled 缺省 false），且新会话无 team/mode 事件。
 *
 * 产物：team-mode-runtime.log（token 脱敏）。退出码 = 探针行是否存在。
 */
import { spawn, execFileSync } from 'node:child_process'
import { mkdirSync, rmSync, writeFileSync, cpSync, symlinkSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const repo = resolve(here, '../../../../..')
const sourceProfile = join(repo, '.eterna-home', 'profiles', 'eterna-web')
const tmpHome = join('/tmp', `team-mode-probe-${process.pid}`)
rmSync(tmpHome, { recursive: true, force: true })
mkdirSync(join(tmpHome, 'profiles'), { recursive: true })
cpSync(sourceProfile, join(tmpHome, 'profiles', 'eterna-web'), { recursive: true, verbatimSymlinks: true })
const profileModules = join(tmpHome, 'profiles', 'eterna-web', 'node_modules')
symlinkSync(join(here, 'probe'), join(profileModules, 'team-default-probe'), 'dir')
const overlay = join(here, 'overlay.yml')
writeFileSync(overlay, `- insert:\n    - id: team-default-probe\n      name: team-default-probe\n`)

const child = spawn(process.execPath, [
  join(repo, 'node_modules/@deepseek-ai/dsh/lib/bin.js'),
  '--profile', 'eterna-web',
  '--patch', overlay,
  '--no-open', '--port', '0',
], {
  cwd: repo,
  env: { ...process.env, DSH_HOME: tmpHome },
  stdio: ['ignore', 'pipe', 'pipe'],
})
let text = ''
child.stdout.setEncoding('utf8'); child.stderr.setEncoding('utf8')
child.stdout.on('data', (chunk) => { text += chunk })
child.stderr.on('data', (chunk) => { text += chunk })

const deadline = Date.now() + 90_000
while (Date.now() < deadline) {
  if (text.includes('TEAM_DEFAULT_PROBE ') || text.includes('TEAM_DEFAULT_PROBE_ERROR ')) break
  await new Promise((resolveWait) => setTimeout(resolveWait, 250))
}
await new Promise((resolveWait) => setTimeout(resolveWait, 500))
child.kill('SIGTERM')
const sanitized = text.replace(/token=[A-Za-z0-9_-]+/g, 'token=<redacted>')
writeFileSync(join(here, 'team-mode-runtime.log'), sanitized)
const line = sanitized.split('\n').find((entry) => entry.startsWith('TEAM_DEFAULT_PROBE'))
console.log(line ?? 'NO_PROBE_LINE')
process.exitCode = line === undefined ? 1 : 0
