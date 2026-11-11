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
const LLM_BASE = process.env.ETERNA_LLM_BASE_URL ?? 'http://manas:4000/v1'
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

// ── egress 白名单（验收环境）：门禁文本指定的被测公网站点 ─────────────
// 产品默认白名单（内网 fail-closed，DEFAULT_EGRESS_DOMAIN_RULES）不动；
// 验收场景 G-CORE-01/02/03 指定 example.com / news.ycombinator.com /
// www.people.com.cn 为被测目标，按模板口径写验收专用白名单并经
// whitelistPath 指入（等价于部署时「内网扩展按部署实际增删」的运维动作）。
const gateWhitelistDir = join(tmpdir(), 'gate-cwd', '.eterna')
mkdirSync(gateWhitelistDir, { recursive: true })
writeFileSync(join(gateWhitelistDir, 'egress-whitelist.yml'), `whitelist:
  - '192.168.31.*'
  - localhost
  - manas
  - '127.0.0.1'
  - example.com
  - 'www.example.com'
  - news.ycombinator.com
  - hn.algolia.com
  - people.com.cn
  - '*.people.com.cn'
  - thepaper.cn
  - '*.thepaper.cn'
  - ithome.com
  - '*.ithome.com'
`)
log(`egress 验收白名单已写 ${gateWhitelistDir}`)
const withEgress = noDeepseek.replace(
  "- id: eterna-egress\n      name: '@eterna/glue/egress-plugin'",
  "- id: eterna-egress\n      name: '@eterna/glue/egress-plugin'\n      config:\n        whitelistPath: " + join(gateWhitelistDir, 'egress-whitelist.yml'),
)
// 验收模型：用户指定 mimo2.6flash（模板默认 mimo-v2.6-pro）
const withModel = withEgress.replace(
  "- id: agent-default-model\n  config:\n    provider: litellm\n    model: mimo-v2.6-pro",
  "- id: agent-default-model\n  config:\n    provider: litellm\n    model: mimo-v2.6-flash",
)
writeFileSync(join(PROFILE, 'cordis.patch.yml'), withModel)
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
// pkgName 形如 '@deepseek-ai+dsh-agent-preset@' → 目标 @deepseek-ai/<包名>（目录名取 + 后 @ 前段）
const firstPnpm = (prefix) => {
  const hit = readdirSync(pnpmDir).filter((d) => d.startsWith(prefix))
  if (hit.length === 0) throw new Error(`pnpm 内找不到 ${prefix}`)
  const dirName = prefix.slice('@deepseek-ai+'.length).replace(/@.*$/, '')
  return join(pnpmDir, hit[0], 'node_modules/@deepseek-ai', dirName)
}
for (const pkg of ['glue', 'llm-doctor', 'brand', 'panel', 'prompt-studio', 'llm-openai', 'access']) {
  symlinkSync(join(REPO, `packages/${pkg}`), join(PROFILE, 'node_modules/@eterna', pkg), 'dir')
}
symlinkSync(join(REPO, 'packages/brand'), join(PROFILE, 'node_modules/@eterna/creation-skills'), 'dir')
const presetTarget = firstPnpm('@deepseek-ai+dsh-agent-preset@0.2.2-rc.1')
const mcpTarget = firstPnpm('@deepseek-ai+dsh-mcp-client@0.2.2-rc.1')
if (!existsSync(presetTarget) || !existsSync(mcpTarget)) throw new Error(`symlink 目标不存在：${String(presetTarget)} / ${String(mcpTarget)}`)
symlinkSync(presetTarget, join(PROFILE, 'node_modules/@deepseek-ai/dsh-agent-preset'), 'dir')
symlinkSync(mcpTarget, join(PROFILE, 'node_modules/@deepseek-ai/dsh-mcp-client'), 'dir')
log('symlinks 完成（@eterna 七项 + dsh-agent-preset + dsh-mcp-client）')

// ── 4. relay（先起；mcp 工具调用依赖它）─────────────────────────────
// --zip：/companion/download.zip 下发的扩展包（前端引导下载链）
const COMPANION_ZIP = join(REPO, 'packages/extension-companion/eterna-companion.zip')
const relay = spawn('node', [join(PKG, 'dist/cli.mjs'), 'start', '--port', '9310', '--zip', COMPANION_ZIP], {
  cwd: PKG,
  stdio: ['ignore', 'ignore', 'inherit'],
  detached: true,
})
relay.unref()
writeFileSync(PORT_FILE, String(relay.pid))
log('relay 已启动 pid=' + String(relay.pid))

// ── 5. dsh web boot ─────────────────────────────────────────────────
// cwd=scratch（gate-cwd）：egress-plugin 的 DomainWhitelist 默认读
// process.cwd()/.eterna/egress-whitelist.yml（插件默认导出是无 config 实例，
// patch 里的 whitelistPath 不被消费——2026-11-10 实测），白名单文件就位于此。
const dshBin = join(REPO, 'node_modules/@deepseek-ai/dsh/lib/bin.js')
const child = spawn(process.execPath, [dshBin, '--profile', 'eterna-web', '--host', '127.0.0.1', '--port', '50454', '--public-url', 'http://127.0.0.1:50454', '--no-open'], {
  cwd: join(tmpdir(), 'gate-cwd'),
  env: {
    ...process.env,
    DSH_HOME: HOME,
    LITELLM_API_KEY,
    ETERNA_PUBLIC_URL: 'http://127.0.0.1:50454',
    // HOME 隔离：skill-filesystem 会扫描用户 HOME 下的技能目录（~/.agents/skills 等），
    // 本机全局技能（如 ego-browser）会泄入验收会话诱导模型走 CLI 而非 mcp__browser 工具。
    HOME: '/tmp/gate-home-min',
    ETERNA_ACCESS_ADMIN_USER: ADMIN_USER,
    ETERNA_ACCESS_ADMIN_PASSWORD: ADMIN_PASSWORD,
    ETERNA_ACCESS_SECRET: ADMIN_SECRET,
  },
  stdio: ['ignore', 'pipe', 'pipe'],
})
child.stdout.on('data', appendBoot)
child.stderr.on('data', appendBoot)
// unref：dsh 子进程与管道不应持有本脚本事件循环——否则脚本永不退出、
// `setup && run` 链卡死在 setup 之后（2026-11-10 实测根因）
child.unref()
child.stdout?.unref()
child.stderr?.unref()

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
