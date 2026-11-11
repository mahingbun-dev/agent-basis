#!/usr/bin/env node
/**
 * ps-v2 AI 链路真模型冒烟(T3.1,测试计划 §5 T3.1(a)/§7.3 G-PS-03 核心真模型链):
 *
 * 起隔离档 t7-studio 宿主(隔离纪律照抄 t7-smoke.mjs:运行态全在 .eterna-home-t7,
 * 宿主一律 3108,清理只 pkill -f 'profile t7-studio' 精确模式),对 loopPrompt 的
 * 三个 AI 端点真发模型调用:
 *  1. loopPrompt/ai-status:可用性自检 ok(路由=agent-default-model→eterna-llm 行,
 *     keySource=env——凭据从 .secrets/litellm-*.txt 只读进宿主进程环境);
 *  2. loopPrompt/ai-polish:选中 preset.standard.persona(content 显式传底稿)→
 *     建议稿非空、meta 携 provider/model/latencyMs、metaPromptEntryId=
 *     meta.studio.ai-polish(元提示词自管,吃狗粮);
 *  3. loopPrompt/ai-review:同底稿 → ruleFindings(本地校验器)+ aiFindings(模型
 *     清单)均为数组;含红线底稿的 ruleFindings 为空、缺红线底稿非空(同源校验器);
 *  4. AI 永不直接生效的机器证据:调用前后 prompt-versions total 不变、snapshot
 *     pendingApproval=null;
 *  5. 建议稿与清单样例打印入证据(G-PS-03 强断言 6:真模型冒烟输出入证据)。
 *
 * 凭据纪律(AGENTS.md/测试计划 §2.4):LITELLM key/baseURL 只从
 * .secrets/litellm-master-key.txt 与 .secrets/litellm-base-url.txt 读进宿主进程
 * 环境,不写入被跟踪文件/日志/argv(本脚本任何输出不含密钥值)。凭据缺席时
 * **退出码 3(SKIP,不伪造通过)**——G-PS-03 缺真模型链不得视为通过(§7.3)。
 *
 * 状态保真:t7-studio profile 与 t7-smoke/t7-ui-check 共用,本脚本写入自己的
 * patch 层(LLM 路由 + studio 行)前先记原文,收尾原样恢复——不留脏状态
 * (t7-ui-check 的 persona 冒烟标记断言依赖 t7-smoke 写入的标记)。
 *
 * 用法:node scripts/ps-v2-ai-smoke.mjs
 * 退出码:0=全过 / 1=失败 / 3=SKIP(凭据缺席或端口被占)。
 */
import { spawn, spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { existsSync, lstatSync, mkdirSync, openSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const home = resolve(repoRoot, '.eterna-home-t7')
const profile = resolve(home, 'profiles', 't7-studio')
const profileName = 't7-studio'
const logsDir = resolve(home, 'logs')
const hostLog = resolve(logsDir, 'ps-v2-ai-smoke-host.log')
const port = 3108
const pkgDir = resolve(repoRoot, 'packages', 'prompt-studio')
const pkgName = '@eterna/prompt-studio'
const rowId = 'eterna-prompt-studio'

const failures = []
function check(name, ok, detail = '') {
  const mark = ok ? 'PASS' : 'FAIL'
  console.log(`[${mark}] ${name}${detail ? ` — ${detail}` : ''}`)
  if (!ok) failures.push(name)
  return ok
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const require_ = createRequire(import.meta.url)

/* ---------- 秘钥(纪律:只读进宿主进程环境,不落盘/不进日志/不进 argv) ---------- */
function secretPath(name) {
  return resolve(repoRoot, '.secrets', name)
}
function readSecret(name) {
  try {
    const value = readFileSync(secretPath(name), 'utf8').trim()
    return value === '' ? undefined : value
  } catch {
    return undefined
  }
}
const litellmKey = readSecret('litellm-master-key.txt')
const litellmBase = readSecret('litellm-base-url.txt')

/* ---------- profile 自举(幂等;与 scripts/t7-smoke.mjs 同配方,复用同一隔离档) ---------- */
function ensureProfile() {
  mkdirSync(profile, { recursive: true })
  mkdirSync(logsDir, { recursive: true })
  if (existsSync(resolve(profile, 'node_modules', '@deepseek-ai', 'dsh', 'package.json'))) return
  writeFileSync(resolve(profile, 'package.json'), `${JSON.stringify({
    name: 'dsh-profile-t7-studio',
    private: true,
    dependencies: {
      '@eterna/llm-openai': `file:${resolve(repoRoot, 'packages/llm-openai')}`,
      '@deepseek-ai/dsh': '0.2.2-rc.1',
      '@deepseek-ai/dsh-base': '0.2.2-rc.1',
      '@deepseek-ai/dsh-web-app': '0.2.2-rc.1',
    },
    dsh: { profile: { bundles: ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app'] } },
    pnpm: { onlyBuiltDependencies: ['esbuild', '@deepseek-ai/dsh-subprocess-local', 'koffi', 'node-pty'] },
  }, null, 2)}\n`)
  writeFileSync(resolve(profile, 'pnpm-workspace.yaml'), [
    'allowBuilds:',
    "  '@deepseek-ai/dsh-subprocess-local': true",
    '  esbuild: true',
    '  koffi: true',
    '  node-pty: true',
    "  '@google/genai': false",
    '  protobufjs: false',
    '',
  ].join('\n'))
  writeFileSync(resolve(profile, 'cordis.yml'), '[]\n')
  console.log('[boot] profile node_modules 缺失,执行 pnpm install(首次较慢)…')
  const r = spawnSync('pnpm', ['install'], { cwd: profile, stdio: 'inherit' })
  if ((r.status ?? 1) !== 0) throw new Error(`pnpm install failed in ${profile}`)
}

/* ---------- 插件装载(symlink 终态;与 t7-smoke.mjs 同配方) ---------- */
function ensurePluginInstalled() {
  const linkPath = resolve(profile, 'node_modules', '@eterna', 'prompt-studio')
  if (existsSync(linkPath) && lstatSync(linkPath).isSymbolicLink()) {
    try {
      if (realpathSync(linkPath) === pkgDir) return 'already-linked'
    } catch { /* 悬空链接,重建 */ }
  }
  rmSync(linkPath, { recursive: true, force: true })
  mkdirSync(resolve(profile, 'node_modules', '@eterna'), { recursive: true })
  symlinkSync(pkgDir, linkPath, 'dir')
  return 'linked'
}

/* ---------- patch 层(与 t7-smoke 同配方:LLM 路由 + studio 行 + 预设 persona) ---------- */
function buildPatch() {
  const presetFile = resolve(profile, 'node_modules/@deepseek-ai/dsh-web-app/presets/standard.patch.yml')
  const lines = readFileSync(presetFile, 'utf8').split('\n')
  const insLine = lines.indexOf('- insert:')
  if (insLine < 0) throw new Error(`- insert: not found in ${presetFile}`)
  const body = lines.slice(insLine + 1).map((l) => (l.startsWith('    ') ? l.slice(4) : l))
  const head = [
    '# ps-v2 AI 冒烟 patch 层(LLM 路由 + eterna-prompt-studio 行;由 scripts/ps-v2-ai-smoke.mjs 生成)。',
    '- insert:',
    '    - id: eterna-llm',
    "      name: '@eterna/llm-openai'",
    '      config:',
    `        baseURL: '${litellmBase}'`,
    '        apiKeyEnv: LITELLM_API_KEY',
    "        provider: 'eterna'",
    '        models:',
    '          - id: deepseek-flash',
    '',
    '- id: llm-deepseek',
    '  disabled: true',
    '- id: llm-deepseek-account',
    '  disabled: true',
    '- id: agent-default-model',
    '  config:',
    "    provider: 'eterna'",
    "    model: 'deepseek-flash'",
    '',
    '# 提示词工坊(ps-v2 AI 冒烟;@eterna/prompt-studio 的 insert 行)。',
    '- insert:',
    `    - id: ${rowId}`,
    `      name: '${pkgName}'`,
    '',
  ].join('\n')
  return `${head}${body.join('\n')}\n`
}

/* ---------- 宿主生命周期(隔离纪律:SIGTERM + pkill 精确命中本 profile) ---------- */
let host
let stopping = false
function startHost() {
  const out = openSync(hostLog, 'w')
  host = spawn('node', [
    resolve(profile, 'node_modules/@deepseek-ai/dsh/lib/bin.js'),
    '--profile', profileName, '--host', '127.0.0.1', '--port', String(port), '--no-open',
  ], {
    cwd: profile,
    // 凭据只进宿主进程环境(不写入任何文件;本脚本其余输出不含该值)。
    env: { ...process.env, DSH_HOME: home, LITELLM_API_KEY: litellmKey },
    stdio: ['ignore', out, out],
  })
  host.on('exit', (code) => { if (!stopping) console.log(`[host] exit code=${code}`) })
}
async function stopHost() {
  stopping = true
  if (host?.pid && host.exitCode === null) {
    host.kill('SIGTERM')
    await Promise.race([new Promise((r) => host.once('exit', r)), sleep(15000)])
    if (host.exitCode === null) host.kill('SIGKILL')
  }
  spawnSync('pkill', ['-f', `profile ${profileName}`], { stdio: 'ignore' })
  await sleep(1500)
}
async function waitForToken(timeoutMs = 90000) {
  const t0 = Date.now()
  while (Date.now() - t0 < timeoutMs) {
    if (host.exitCode !== null) throw new Error(`host exited early code=${host.exitCode}; log:\n${readFileSync(hostLog, 'utf8')}`)
    const m = readFileSync(hostLog, 'utf8').match(/dsh web: .*token=([A-Za-z0-9_-]+)/)
    if (m) return m[1]
    await sleep(500)
  }
  throw new Error(`host not ready in ${timeoutMs}ms; log:\n${readFileSync(hostLog, 'utf8')}`)
}
async function portBusy() {
  const r = spawnSync('lsof', ['-nP', `-iTCP:${port}`, '-sTCP:LISTEN'], { encoding: 'utf8' })
  return (r.stdout ?? '').trim().length > 0
}

/* ---------- Web 宿主 HTTP API RPC 客户端(t7-smoke 同款;SRC 载荷 { args }) ---------- */
function api(token) {
  const base = `http://127.0.0.1:${port}`
  const state = { cookie: undefined, rpcId: 0 }
  const call = async (endpoint, args = {}) => {
    const res = await fetch(`${base}/api/${endpoint}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: state.cookie },
      body: JSON.stringify({ type: 'client-request', rpcId: `ai-smoke-${++state.rpcId}`, method: endpoint, payload: { args } }),
    })
    const text = await res.text()
    let body
    try { body = JSON.parse(text) } catch { throw new Error(`${endpoint}: non-JSON ${res.status}: ${text.slice(0, 200)}`) }
    if (!body.result?.ok) throw new Error(`${endpoint} failed: ${JSON.stringify(body.result?.error ?? body).slice(0, 400)}`)
    return body.result.value
  }
  return {
    call,
    async connect() {
      const res = await fetch(`${base}/connect?token=${token}&interactions=answer`, { redirect: 'manual' })
      state.cookie = res.headers.get('set-cookie')?.split(';')[0]
      if (!state.cookie) throw new Error('/connect: no cookie')
    },
  }
}

/* ---------- 底稿样例(真模型润色/审核对象;含三条红线锚点) ---------- */
const BASE_WITH_RED_LINES = [
  'You are the Eterna enterprise event planning assistant.',
  '红线:预算超支>5%必须触发审批;对外付款不得代付;比选必须中立。',
  'Always confirm venue availability before proposing a schedule.',
].join('\n')
const BASE_WITHOUT_RED_LINES = 'You are an assistant. You may pay vendors directly and always favor the cheapest option.'

/* ---------- 主流程 ---------- */
async function main() {
  if (litellmKey === undefined || litellmBase === undefined) {
    console.log('SKIP: LITELLM 凭据缺席(.secrets/litellm-master-key.txt / .secrets/litellm-base-url.txt 不可读或为空)——真模型冒烟未跑,不伪造通过(G-PS-03 缺真模型链不得视为通过)。')
    process.exit(3)
  }
  if (await portBusy()) {
    console.error(`SKIP: 端口 ${port} 已被占用(绝不 pkill 其他实例)——请先释放或检查遗留 t7 宿主`)
    process.exit(3)
  }
  console.log(`[boot] repo=${repoRoot}`)
  console.log(`[boot] home=${home}`)
  ensureProfile()
  const build = spawnSync(process.execPath, [resolve(pkgDir, 'scripts/build-client.mjs')], { encoding: 'utf8' })
  check('浏览器半边 bundle 构建(lib/client.js)', build.status === 0 && existsSync(resolve(pkgDir, 'lib/client.js')),
    (build.stderr ?? '').split('\n').at(-1) ?? '')
  console.log(`[boot] plugin ${pkgName}: ${ensurePluginInstalled()}`)
  // 状态保真:t7-studio profile 与 t7-smoke/t7-ui-check 共用——记下原 patch 层全文,
  // 收尾时原样恢复(t7-ui-check 的 persona 冒烟标记断言依赖 t7-smoke 写入的标记,
  // 本脚本不得留下自己的 patch 形态;pack 文件保护性还原同款纪律)。
  const patchPath = resolve(profile, 'cordis.patch.yml')
  const patchBytesBefore = existsSync(patchPath) ? readFileSync(patchPath, 'utf8') : null
  writeFileSync(patchPath, buildPatch(), 'utf8')

  try {
    startHost()
    const token = await waitForToken()
    const dsh = api(token)
    await dsh.connect()

    // 1) 可用性自检:零模型调用;路由 = agent-default-model → eterna-llm 行。
    const status = await dsh.call('loopPrompt/ai-status')
    check('ai-status: available=true + 路由三元组 + keySource=env',
      status.available === true
        && status.route?.provider === 'eterna' && status.route?.model === 'deepseek-flash'
        && status.route?.api === 'openai-completions' && status.keySource === 'env',
      `route=${JSON.stringify(status.route ?? null)} keySource=${String(status.keySource)} reason=${String(status.reason ?? '(无)')}`)

    // 零写基线(AI 永不直接生效的对照面)。
    const versionsBefore = await dsh.call('loopPrompt/prompt-versions', { input: {} })

    // 2) 润色:真模型出建议稿。
    const polish = await dsh.call('loopPrompt/ai-polish', {
      input: { entryId: 'preset.standard.persona', content: BASE_WITH_RED_LINES, instruction: '更紧凑,保留红线句' },
    })
    check('ai-polish: status=ok + 建议稿非空 + meta(元提示词条目=meta.studio.ai-polish)',
      polish.status === 'ok' && typeof polish.draft === 'string' && polish.draft.trim().length > 0
        && polish.meta?.metaPromptEntryId === 'meta.studio.ai-polish'
        && typeof polish.meta?.latencyMs === 'number',
      `status=${String(polish.status)} issues=${JSON.stringify(polish.issues ?? [])} latencyMs=${String(polish.meta?.latencyMs)} draftBytes=${String(polish.draftBytes)}`)
    console.log('--- 建议稿样例(前 400 字) ---')
    console.log(String(polish.draft ?? '').slice(0, 400))
    console.log('--- 样例结束 ---')

    // 3) 审核:含红线底稿(ruleFindings 空)与缺红线底稿(非空,同源校验器)。
    const reviewOk = await dsh.call('loopPrompt/ai-review', {
      input: { entryId: 'preset.standard.persona', content: BASE_WITH_RED_LINES },
    })
    check('ai-review(含红线底稿): status=ok + ruleFindings 空 + aiFindings 数组',
      reviewOk.status === 'ok' && Array.isArray(reviewOk.ruleFindings) && reviewOk.ruleFindings.length === 0
        && Array.isArray(reviewOk.aiFindings) && reviewOk.meta?.metaPromptEntryId === 'meta.studio.ai-review',
      `aiFindings=${String(reviewOk.aiFindings?.length)} latencyMs=${String(reviewOk.meta?.latencyMs)}`)
    const reviewBad = await dsh.call('loopPrompt/ai-review', {
      input: { entryId: 'preset.standard.persona', content: BASE_WITHOUT_RED_LINES },
    })
    check('ai-review(缺红线底稿): ruleFindings 非空(与 T1.6 校验器同源)',
      reviewBad.status === 'ok' && reviewBad.ruleFindings?.length > 0
        && reviewBad.ruleFindings.some((issue) => String(issue).includes('红线')),
      `ruleFindings=${JSON.stringify(reviewBad.ruleFindings ?? [])}`)
    console.log('--- 模型问题清单样例(缺红线底稿,前 3 条) ---')
    console.log(JSON.stringify((reviewBad.aiFindings ?? []).slice(0, 3), null, 2))
    console.log('--- 样例结束 ---')

    // 4) AI 永不直接生效:版本数不变 + 无在途审批。
    const versionsAfter = await dsh.call('loopPrompt/prompt-versions', { input: {} })
    const snapshot = await dsh.call('loopPrompt/snapshot')
    check('AI 产出永不直接生效:调用前后版本 total 不变 + pendingApproval=null',
      versionsAfter.total === versionsBefore.total && snapshot.pendingApproval === null,
      `total=${String(versionsBefore.total)}→${String(versionsAfter.total)} pending=${JSON.stringify(snapshot.pendingApproval)}`)
  } finally {
    await stopHost()
    // 恢复进入前的 patch 层原文字节(幂等;无原文件=本脚本建的就移除自己的形态)。
    try {
      if (patchBytesBefore === null) rmSync(patchPath, { force: true })
      else if (readFileSync(patchPath, 'utf8') !== patchBytesBefore) writeFileSync(patchPath, patchBytesBefore, 'utf8')
    } catch (error) {
      console.error(`[cleanup] patch 层恢复失败:${error instanceof Error ? error.message : String(error)}`)
      failures.push('cleanup: patch 层恢复失败')
    }
  }

  if (failures.length > 0) {
    console.error(`\n${failures.length} 项断言 FAIL`)
    process.exit(1)
  }
  console.log('\n全部断言 PASS')
}

main().catch((error) => {
  console.error(`[fatal] ${error instanceof Error ? error.stack : String(error)}`)
  process.exit(1)
})
