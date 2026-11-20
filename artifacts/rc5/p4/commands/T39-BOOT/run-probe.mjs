#!/usr/bin/env node
/**
 * T39 活体命令面探针 runner(不改产品文件/不碰生产容器):
 *  1. 复制仓库内 .eterna-home/profiles/eterna-web(verify-eterna-web 物化的生产渲染
 *     profile;@eterna/* 行已 symlink 回仓库源树)到 /tmp 临时 DSH_HOME;
 *  2. 临时 profile node_modules 挂本目录 probe/;
 *  3. `--patch overlay.yml` 追加探针行,`--port 0` 真 boot(不监听固定端口);
 *  4. 收集 T39_COMMAND_PROBE 行,token 脱敏后落 runtime.log。
 */
import { spawn } from 'node:child_process'
import { cpSync, mkdirSync, rmSync, symlinkSync, writeFileSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const repo = resolve(here, '../../../../..')
const sourceProfile = join(repo, '.eterna-home', 'profiles', 'eterna-web')
const tmpHome = join('/tmp', `t39-command-probe-${process.pid}`)
rmSync(tmpHome, { recursive: true, force: true })
mkdirSync(join(tmpHome, 'profiles'), { recursive: true })
cpSync(sourceProfile, join(tmpHome, 'profiles', 'eterna-web'), { recursive: true, verbatimSymlinks: true })
const profileModules = join(tmpHome, 'profiles', 'eterna-web', 'node_modules')
symlinkSync(join(here, 'probe'), join(profileModules, 't39-command-probe'), 'dir')
const overlay = join(here, 'overlay.yml')
writeFileSync(overlay, '- insert:\n    - id: t39-command-probe\n      name: t39-command-probe\n')

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

const deadline = Date.now() + 120_000
while (Date.now() < deadline) {
  if (text.includes('T39_COMMAND_PROBE ') || text.includes('T39_COMMAND_PROBE_ERROR ')) break
  await new Promise((resolveWait) => setTimeout(resolveWait, 250))
}
await new Promise((resolveWait) => setTimeout(resolveWait, 500))
child.kill('SIGTERM')
const sanitized = text.replace(/token=[A-Za-z0-9_-]+/gu, 'token=<redacted>')
writeFileSync(join(here, 'runtime.log'), sanitized)
const line = sanitized.split('\n').find((entry) => entry.startsWith('T39_COMMAND_PROBE'))
console.log(line ?? 'NO_PROBE_LINE')
rmSync(tmpHome, { recursive: true, force: true })
process.exitCode = line === undefined ? 1 : 0
