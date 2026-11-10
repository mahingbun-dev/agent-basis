#!/usr/bin/env node
// G-CORE 验收环境准备（实现者一次性准备，环境保持运行供独立验收代理使用）。
// 复刻 docker/entrypoint.sh 的本地等价物：
//   1. 物化 profile（docker/profile/cordis.patch.yml.template 渲染 litellm baseURL）
//   2. 追加 mcp-browser insert 块 + symlinks（@eterna/* + dsh-agent-preset + dsh-mcp-client）
//   3. 模型列表收敛为 mimo-v2.6-flash（用户指定的验收模型，置于首位=默认会话模型）
//   4. 启动 relay(9310) + dsh web(--host 127.0.0.1 --port 0)，admin 账号经 env seed
// 产物：系统临时目录下 gate-env.json（url/admin 凭据/进程 pid），供 gate-run.mjs（独立验收代理执行）消费。
// 本脚本只准备环境，不做任何门禁判定。

import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync, appendFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const REPO = resolve(new URL('../../..', import.meta.url).pathname)
const PKG = join(REPO, 'packages/browser-relay')
const HOME = join(REPO, '.eterna-gate-home')
const PROFILE = join(HOME, 'profiles/eterna-web')
const TEMPLATE = join(REPO, 'docker/profile/cordis.patch.yml.template')
const SECRET = (f) => readFileSync(join(REPO, '.secrets', f), 'utf8').trim()
const ENV_OUT = join(tmpdir(), 'gate-env.json')
const PORT_FILE = join(PKG, 'smoke/.gate-relay-port')

const log = (line) => console.log(`[gate-setup] ${line}`)
const appendBoot = (chunk) => appendFileSync(join(tmpdir(), 'gate-boot.log'), chunk)

// ── 0. key 与 relay base ──────────────────────────────────────────────
const LITELLM_API_KEY = process.env.LITELLM_API_KEY ?? SECRET('litellm-master-key.txt')
const LLM_BASE = process.env.ETERNA_LLM_BASE_URL ?? 'http://192.168.31.165:4000/v1'
const ADMIN_USER = process.env.ETERNA_ACCESS_ADMIN_USER ?? 'gate-admin'
const ADMIN_PASSWORD = process.env.ETERNA_ACCESS_ADMIN_PASSWORD ?? `gate-${Math.random().toString(36).slice(2, 12)}`
const ADMIN_SECRET = process.env.ETERNA_ACCESS_SECRET ?? `sec-${Math.random().toString(36).slice(2, 18)}`

// ── 1. 清理并物化 profile ────────────────────────────────────────────
rmSync(HOME, { recursive: true, force: true })
mkdirSync(join(PROFILE, 'node_modules/@eterna'), { recursive: true })
mkdirSync(join(PROFILE, 'node_modules/@deepseek-ai'), { recursive: true })

const rendered = readFileSync(TEMPLATE, 'utf8')
  .replaceAll('__ETERNA_LLM_BASE_URL__', LLM_BASE)
// 模型收敛：验收用 mimo-v2.6-flash（渲染后从 models 列表删除 deepseek-flash 块）
const noDeepseek = rendered.replace(
  /\n          - id: deepseek-flash\n(?:            .*\n)*/,
  '\n',
)
writeFileSync(join(PROFILE, 'cordis.patch.yml'), noDeepseek)
writeFileSync(join(PROFILE, 'cordis.yml'), '[]\n')
writeFileSync(join(PROFILE, 'package.json'), `${JSON.stringify({
  name: 'dsh-profile-eterna-web-gate',
  private: true,
  dsh: { profile: { bundles: ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app'] } },
}, null, 2)}\n`)
log(`profile 物化完成（LLM=${LLM_BASE}，模型=mimo-v2.6-flash）`)

// ── 2. 追加 mcp-browser insert 块（与仓库 patch 同款；模板无此块）────
appendFileSync(join(PROFILE, 'cordis.patch.yml'), `

# ── Companion 浏览器执行面挂载（E1 验收环境；同 packages/browser-relay 协议契约）──
- insert:
    - id: mcp-browser
      name: '@deepseek-ai/dsh-mcp-client'
      config:
        serverName: browser
        transport: stdio
        command: node
        args:
          - ${join(PKG, 'dist/mcp.mjs')}
        env:
          ETNA_RELAY_BASE: http://127.0.0.1:9310
        toolCallTimeoutMs: 120000
`)

// ── 3. symlinks（entrypoint 同款 + 本轮两个）────────────────────────
const pnpmDir = join(REPO, 'node_modules/.pnpm')
const firstPnpm = (prefix) => {
  const hit = readdirSync(pnpmDir).filter((d) => d.startsWith(prefix))
  if (hit.length === 0) throw new Error(`pnpm 内找不到 ${prefix}`)
  return join(pnpmDir, hit[0], 'node_modules/@deepseek-ai', prefix.split('@')[2].split('@')[0] === '' ? prefix.split('@')[2] : prefix.slice('@deepseek-ai+'.length).split('@')[0])
}
for (const pkg of ['glue', 'llm-doctor', 'brand', 'panel', 'prompt-studio', 'llm-openai', 'access']) {
  symlinkSync(join(REPO, `packages/${pkg}`), join(PROFILE, 'node_modules/@eterna', pkg), 'dir')
}
symlinkSync(join(REPO, 'packages/brand'), join(PROFILE, 'node_modules/@eterna/creation-skills'), 'dir')
symlinkSync(firstPnpm('@deepseek-ai+dsh-agent-preset@'), join(PROFILE, 'node_modules/@deepseek-ai/dsh-agent-preset'), 'dir')
symlinkSync(firstPnpm('@deepseek-ai+dsh-mcp-client@'), join(PROFILE, 'node_modules/@deepseek-ai/dsh-mcp-client'), 'dir')
log('symlinks 完成（@eterna 七项 + dsh-agent-preset + dsh-mcp-client）')

// ── 4. relay（先起；mcp 工具调用依赖它）─────────────────────────────
const relay = spawn('node', [join(PKG, 'dist/cli.mjs'), 'start', '--port', '9310'], {
  cwd: PKG,
  stdio: ['ignore', 'ignore', 'inherit'],
  detached: true,
})
relay.unref()
writeFileSync(PORT_FILE, String(relay.pid))
log('relay 已启动 pid=' + String(relay.pid))

// ── 5. dsh web boot ─────────────────────────────────────────────────
const dshBin = join(REPO, 'node_modules/@deepseek-ai/dsh/lib/bin.js')
const child = spawn(process.execPath, [dshBin, '--profile', 'eterna-web', '--host', '127.0.0.1', '--port', '50454', '--public-url', 'http://127.0.0.1:50454', '--no-open'], {
  cwd: REPO,
  env: {
    ...process.env,
    DSH_HOME: HOME,
    LITELLM_API_KEY,
    ETERNA_PUBLIC_URL: 'http://127.0.0.1:50454',
    ETERNA_ACCESS_ADMIN_USER: ADMIN_USER,
    ETERNA_ACCESS_ADMIN_PASSWORD: ADMIN_PASSWORD,
    ETERNA_ACCESS_SECRET: ADMIN_SECRET,
  },
  stdio: ['ignore', 'pipe', 'pipe'],
})
child.stdout.on('data', appendBoot)
child.stderr.on('data', appendBoot)

const bootLog = () => { try { return readFileSync(join(tmpdir(), 'gate-boot.log'), 'utf8') } catch { return '' } }
let url = null
const t0 = Date.now()
for (;;) {
  const m = bootLog().match(/^dsh web: (\S+)$/m)
  if (m !== undefined && m !== null) {
    url = m[1]
    break
  }
  if (Date.now() - t0 > 180_000) throw new Error('boot 180s 未就绪（系统临时目录 gate-boot.log）')
  await new Promise((r) => setTimeout(r, 800))
}
log(`eterna web 就绪：${url}`)

writeFileSync(ENV_OUT, `${JSON.stringify({
  url,
  adminUser: ADMIN_USER,
  adminPassword: ADMIN_PASSWORD,
  relayPid: relay.pid,
  dshPid: child.pid,
  chrome: 'smoke/.browsers 下 CfT（gate-run 自取）',
  extensionDist: join(REPO, 'packages/extension-companion/dist'),
}, null, 2)}\n`)
log(`环境就绪，凭据与进程已写 ${ENV_OUT}（本脚本可退出，进程 detached 存活）`)
