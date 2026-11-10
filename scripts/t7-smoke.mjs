#!/usr/bin/env node
/**
 * T7.1 装载冒烟脚本(此后归脚本门禁专用,后续阶段不得破坏)。
 *
 * 断言(退出码 0/1,可重复执行——每次运行先清本包运行态:版本库单元目录与兜底审计):
 *  1. profile(.eterna-home-t7/profiles/t7-studio)以 PLUGIN-AUTHORING §4 的 symlink
 *     终态装载 packages/prompt-studio(node_modules/@eterna/prompt-studio → repo 源树;
 *     为什么不跑 §4 第一步的 pnpm add file::本包 workspace:/catalog: 协议在隔离
 *     profile 被 pnpm v11 拒载(见 ensurePluginInstalled 注),Loader+client-modules
 *     两个消费方都只按 node_modules 解析,不读 profile 依赖表,故 symlink 即终态);
 *  2. dump-config 组合预检:退出码 0、无 skipping/incompatible、persona 冒烟标记与
 *     @eterna/prompt-studio 行进树;
 *  3. 3108 启动 Web 宿主,启动日志无 skipping/incompatible;
 *  4. pluginInventory/list(官方 dsh-host-plugin-inventory)含 @eterna/prompt-studio
 *     行:enabled=true 且 fiberPhase=active——插件页「已安装」的机器证据;
 *  5. Host 半边端点活:loopPrompt/snapshot(通道 A 说明 + 版本库 ready=storage 栈
 *     挂载 + T1.4 起的注册表全景 entries[])、loopPrompt/prompt-get、
 *     loopPrompt/prompt-versions(initial 种子 + checksum 口径)、loopPrompt/trace
 *     (列表 + 指定会话轮次树);
 *  5.5 T1.4 读侧按条目:prompt-get/prompt-versions {entryId} 三型采样——块标量
 *     条目(plan-mode section:|,值与 dump-config 组合树一致)、领域 personaPrefix
 *     (>- 折叠反引,值与仓库 pack 文件逐字一致)、行锚点只读型(time-context:
 *     text=null+「上游运行时生成」标注);未知 entryId → not-found 明示;每条目
 *     版本链(初始种子)与 persona 缺省链旧口径互证;
 *  6. 保存链路端到端:prompt-save 两段式(一段=R3 审批卡 + doubleConfirm 第二问 +
 *     patch 未落盘;二段=patch 原子写 + 版本 +1 + 宿主内 dump-config 干跑自检通过);
 *  6.5 T1.6 写链路按条目:块标量条目(plan-mode section:|)save+rollback 两段式
 *     (ruleId=entry-write.<entryId>、写后读回==新文、宿主内 dump-config 干跑)、
 *     行锚点只读型(time-context)拒写明示、领域层形态 A(event-planning
 *     personaPrefix:>-)save+rollback(真 pack 文件,字节快照保护性还原);
 *  7. 回滚链路:prompt-rollback 两段式 → 新版本(source=rollback,parentId=被回滚
 *     版本),版本只增不删(total=3),patch 层回到目标内容;条目错配(entryId 与
 *     版本归属不符)fail-closed 拒回滚;
 *  8. 磁盘证据:版本库单元落在 DSH storage 栈根(<home>/storages/eterna_prompt_studio/,
 *     per-record 一文档一记录;T1.4 起按条目种子,文档记录带 entryId,链长与端点一致);
 *     兜底审计 NDJSON 含 operator/versionId(G5)。
 *  9. T2.3 会话快照:session/create 开新会话(HTTP 面真实 session/created 事件)→
 *     新会话开启即有快照(loopPrompt/session-snapshot 按会话可查,全景条目+
 *     版本指针+三型分语义);未知 sessionId not-found 明示;改提示词(保存)后
 *     已存快照逐字节不变(checksum 复核);快照单元目录落在 storage 栈根。
 *
 * 隔离纪律:运行态全在 .eterna-home-t7(DSH_HOME);Web 宿主一律 3108;进程清理只用
 * SIGTERM + pkill -f 'profile t7-studio' 精确模式(绝不 pkill 其他 dsh 实例);
 * LITELLM_API_KEY 只从 .secrets/litellm-master-key.txt 读进宿主进程环境,不写入
 * 任何被跟踪文件/日志/输出。
 *
 * 用法:node scripts/t7-smoke.mjs
 */

import { spawn, spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { existsSync, mkdirSync, openSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const home = resolve(repoRoot, '.eterna-home-t7')
const profile = resolve(home, 'profiles', 't7-studio')
const profileName = 't7-studio'
const logsDir = resolve(home, 'logs')
const hostLog = resolve(logsDir, 't7-smoke-host.log')
const port = 3108
const pkgDir = resolve(repoRoot, 'packages', 'prompt-studio')
const pkgName = '@eterna/prompt-studio'
const rowId = 'eterna-prompt-studio'

const MARKER = 'T7_SMOKE_PERSONA_MARKER base prompt studio smoke alpha'
// T7.3 校验器全集要求保存内容带三条红线锚点(预算不超支/不代付/比选中立,
// 对齐 packs/event-planning persona);回滚到无红线的 initial 基线不受影响
// (回滚=版本库存量逐字恢复,不过内容校验——初始版本永久保留的逃生门)。
const SAVE_TAIL = 'T7_SMOKE_STUDIO_V2 红线:预算超支>5%必须触发审批;对外付款不得代付;比选必须中立。'

const failures = []
function check(name, ok, detail = '') {
  const mark = ok ? 'PASS' : 'FAIL'
  console.log(`[${mark}] ${name}${detail ? ` — ${detail}` : ''}`)
  if (!ok) failures.push(name)
  return ok
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const require_ = createRequire(import.meta.url)

/* ---------- 秘钥(纪律 4:只读进宿主进程环境,不落盘/不进日志) ---------- */
function litellmKey() {
  return readFileSync(resolve(repoRoot, '.secrets/litellm-master-key.txt'), 'utf8').trim()
}
function litellmBaseUrl() {
  return readFileSync(resolve(repoRoot, '.secrets/litellm-base-url.txt'), 'utf8').trim()
}

/* ---------- profile 自举(幂等;与 t7-spike-verify.mjs 同配方) ---------- */
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
    // 2026-11-11 实测:pnpm 11.7 对带构建脚本的依赖严格化,传递依赖 @google/genai
    // 与 protobufjs 未显式裁定即 ERR_PNPM_IGNORED_BUILDS 致 install 非零。两者的
    // postinstall 均为可选产物生成,运行时不需要——显式 false(拒绝执行构建脚本)。
    "  '@google/genai': false",
    '  protobufjs: false',
    '',
  ].join('\n'))
  writeFileSync(resolve(profile, 'cordis.yml'), '[]\n')
  console.log('[boot] profile node_modules 缺失,执行 pnpm install(首次较慢)…')
  const r = spawnSync('pnpm', ['install'], { cwd: profile, stdio: 'inherit' })
  if ((r.status ?? 1) !== 0) throw new Error(`pnpm install failed in ${profile}`)
}

/* ---------- 插件装载(PLUGIN-AUTHORING §4 的 symlink 终态,幂等) ----------
 * 为什么不是先 pnpm add file: 再换 symlink(§4 原文两步):本包 dependencies 携带
 * @eterna/governance|interact 的 workspace: 协议、peerDependencies 携带 catalog: 协议,
 * pnpm v11 在隔离 profile(自带 pnpm-workspace.yaml,即自己的 workspace 根)拒绝装载
 * 外部包的这两类协议——实测 ERR_PNPM_WORKSPACE_PKG_NOT_FOUND / "external package
 * outside of the pnpm workspace declared a dependency using the catalog protocol"。
 * 而把 repo 包声明为 profile workspace 成员会让 pnpm 反向接管 packages/ 下其他包的
 * node_modules(纪律 2 禁止)。装载消费方只有两个,都不读 profile 依赖表:
 * Loader 按组合行名 '@eterna/prompt-studio' 经 node_modules 解析 + realpath 落 repo
 * 源树(运行时依赖走 repo 工作区);dsh-client-modules 扫 Loader 条目的包清单。
 * 故直接落 §4 的 symlink 终态,等价且零 pnpm 副作用。 */
function ensurePluginInstalled() {
  const linkPath = resolve(profile, 'node_modules', '@eterna', 'prompt-studio')
  const { lstatSync, realpathSync, mkdirSync: mkDir, symlinkSync } = require_('node:fs')
  if (existsSync(linkPath) && lstatSync(linkPath).isSymbolicLink()) {
    try {
      if (realpathSync(linkPath) === pkgDir) return 'already-linked'
    } catch { /* 悬空链接,重建 */ }
  }
  rmSync(linkPath, { recursive: true, force: true })
  mkDir(resolve(profile, 'node_modules', '@eterna'), { recursive: true })
  symlinkSync(pkgDir, linkPath, 'dir')
  return 'linked'
}

/* ---------- patch 层生成:spike 同款纯文本变换 + eterna-prompt-studio insert 行 ---------- */
function buildPatch(marker) {
  const presetFile = resolve(profile, 'node_modules/@deepseek-ai/dsh-web-app/presets/standard.patch.yml')
  const lines = readFileSync(presetFile, 'utf8').split('\n')
  const insLine = lines.indexOf('- insert:')
  if (insLine < 0) throw new Error(`- insert: not found in ${presetFile}`)
  const body = lines.slice(insLine + 1).map((l) => (l.startsWith('    ') ? l.slice(4) : l))
  const out = []
  let prefixSeen = 0
  for (const line of body) {
    if (/^(\s*)prefix: /.test(line)) {
      prefixSeen += 1
      out.push(line.replace(/^(\s*)prefix: .*$/, (_m, indent) => `${indent}prefix: '${marker}'`))
    } else out.push(line)
  }
  if (prefixSeen !== 1) throw new Error(`expected exactly one prefix: line, got ${prefixSeen}`)
  const head = [
    '# T7.1 smoke patch layer(LLM 路由 + persona 冒烟标记 + eterna-prompt-studio 行;由 scripts/t7-smoke.mjs 生成)。',
    '- insert:',
    '    - id: eterna-llm',
    "      name: '@eterna/llm-openai'",
    '      config:',
    `        baseURL: '${litellmBaseUrl()}'`,
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
    '# 提示词工坊+循环轨迹(T7.1;@eterna/prompt-studio 的 insert 行,与 @eterna/panel 同款)。',
    '- insert:',
    `    - id: ${rowId}`,
    `      name: '${pkgName}'`,
    '',
  ].join('\n')
  return `${head}${out.join('\n')}\n`
}

/* ---------- 宿主生命周期(纪律 3:清理只精确命中本 profile) ---------- */
let host
let stopping = false
function startHost() {
  const out = openSync(hostLog, 'w')
  host = spawn('node', [
    resolve(profile, 'node_modules/@deepseek-ai/dsh/lib/bin.js'),
    '--profile', profileName, '--host', '127.0.0.1', '--port', String(port), '--no-open',
  ], {
    cwd: profile,
    env: { ...process.env, DSH_HOME: home, LITELLM_API_KEY: litellmKey() },
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
  // 兜底清场:精确命中本 smoke 宿主(纪律 3;绝不 pkill 其他 dsh 实例)。
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

/* ---------- Web 宿主 HTTP API RPC 客户端(spike 同款;SRC 载荷 { args } 按形参名) ---------- */
function api(token) {
  const base = `http://127.0.0.1:${port}`
  const state = { cookie: undefined, rpcId: 0 }
  const call = async (endpoint, args = {}) => {
    const res = await fetch(`${base}/api/${endpoint}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: state.cookie },
      body: JSON.stringify({ type: 'client-request', rpcId: `t7-smoke-${++state.rpcId}`, method: endpoint, payload: { args } }),
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

/* ---------- dump-config 干跑取文本(T1.6 按条目写后组合树断言用;无副作用) ---------- */
async function dumpConfigText() {
  const r = spawnSync(process.execPath, [
    resolve(profile, 'node_modules/@deepseek-ai/dsh/lib/bin.js'),
    '--profile', profileName, '--dump-config',
  ], { cwd: profile, encoding: 'utf8', env: { ...process.env, DSH_HOME: home }, timeout: 180000 })
  if ((r.status ?? 1) !== 0) throw new Error(`dump-config failed: status=${r.status}`)
  return r.stdout ?? ''
}

/* ---------- T1.6 领域 pack 文件字节快照(写链路动真 worktree 文件的保护性还原) ---------- */
const packPatchPath = resolve(repoRoot, 'packs/event-planning/cordis.patch.yml')
let packBytesBefore = null
function restorePackFile() {
  if (packBytesBefore === null) return 'skipped'
  try {
    if (readFileSync(packPatchPath, 'utf8') !== packBytesBefore) {
      writeFileSync(packPatchPath, packBytesBefore, 'utf8')
      return 'restored'
    }
    return 'unchanged'
  } catch {
    return 'restore-failed'
  }
}

/* ---------- 主流程 ---------- */
let exitCode = 0
try {
  if (await portBusy()) {
    console.error(`端口 ${port} 已被占用(绝不 pkill 其他实例)——请先释放或检查遗留 t7 宿主`)
    process.exit(1)
  }
  if (!existsSync(resolve(repoRoot, '.secrets/litellm-master-key.txt'))) {
    throw new Error('凭据缺失:.secrets/litellm-master-key.txt 不存在(纪律 8:不伪造)')
  }
  console.log(`[boot] repo=${repoRoot}`)
  console.log(`[boot] home=${home}`)
  ensureProfile()

  // 0) 幂等:清本包运行态(版本库单元 + 快照单元 + 兜底审计),使断言可从零复现。
  rmSync(resolve(home, 'storages', 'eterna_prompt_studio'), { recursive: true, force: true })
  rmSync(resolve(home, 'storages', 'eterna_prompt_snapshots'), { recursive: true, force: true })
  rmSync(resolve(home, 'eterna-prompt-studio'), { recursive: true, force: true })

  // 1) 浏览器半边 bundle 先构建(client-modules 扫 exports["./client"] 要求存在)。
  const build = spawnSync(process.execPath, [resolve(pkgDir, 'scripts/build-client.mjs')], { encoding: 'utf8' })
  check('浏览器半边 bundle 构建(lib/client.js)', build.status === 0 && existsSync(resolve(pkgDir, 'lib/client.js')),
    (build.stderr ?? '').split('\n').at(-1) ?? '')

  const installState = ensurePluginInstalled()
  console.log(`[boot] plugin ${pkgName}: ${installState}`)

  // 2) 写 patch 层(标记 + studio 行)+ dump-config 组合预检
  const patchPath = resolve(profile, 'cordis.patch.yml')
  writeFileSync(patchPath, buildPatch(MARKER))
  let dumpOut = ''
  {
    const r = spawnSync(process.execPath, [
      resolve(profile, 'node_modules/@deepseek-ai/dsh/lib/bin.js'),
      '--profile', profileName, '--dump-config',
    ], { cwd: profile, encoding: 'utf8', env: { ...process.env, DSH_HOME: home }, timeout: 180000 })
    const out = r.stdout ?? ''
    dumpOut = out
    check('preflight: dump-config 退出码 0', r.status === 0, `status=${r.status}`)
    check('preflight: 组合树 persona 前缀=冒烟标记', out.includes(MARKER))
    check('preflight: 组合树含 eterna-prompt-studio 行', out.includes(pkgName))
    check('preflight: 无 skipping/incompatible', r.status === 0 && !/skipping|incompatible/i.test(out))
    if (r.status !== 0 || !out.includes(pkgName)) throw new Error('组合预检失败,中止(见上方输出)')
  }

  // 3) 启动宿主(3108)
  startHost()
  const token = await waitForToken()
  const dsh = api(token)
  await dsh.connect()
  console.log(`[host] ready pid=${host.pid} log=${hostLog}`)

  // 4) pluginInventory + 启动日志洁净度
  {
    const inventory = await dsh.call('pluginInventory/list')
    const entry = (inventory.entries ?? []).find((e) => e.moduleName === pkgName)
    check('pluginInventory: 含 @eterna/prompt-studio 行', entry !== undefined,
      entry === undefined ? `entries=${(inventory.entries ?? []).length}` : `entryId=${entry.entryId}`)
    check('pluginInventory: 行 enabled=true', entry?.enabled === true)
    check('pluginInventory: 行 fiberPhase=active', entry?.fiberPhase === 'active')
    const log = readFileSync(hostLog, 'utf8')
    check('宿主启动日志无 skipping/incompatible', !/skipping|incompatible/i.test(log))
  }

  // 5) snapshot / prompt-get / prompt-versions / trace(版本库=storage 栈挂载证据)
  const snapshot = await dsh.call('loopPrompt/snapshot')
  check('snapshot: channel.kind=A-patch-hmr(通道 A 结论)', snapshot.channel?.kind === 'A-patch-hmr')
  check('snapshot: persona.available 且含冒烟标记', snapshot.persona?.available === true && snapshot.persona.text.includes(MARKER))
  check('snapshot: versions.ready=true(DSH storage 栈挂载)', snapshot.versions?.ready === true)
  check('snapshot: 无在途审批', snapshot.pendingApproval === null)
  {
    const got = await dsh.call('loopPrompt/prompt-get')
    check('prompt-get: persona 文本含标记', got.persona?.available === true && got.persona.text.includes(MARKER))
    check('prompt-get: effectiveNote 提示新会话生效', typeof got.effectiveNote === 'string' && got.effectiveNote.includes('新会话生效'))
    const versions = await dsh.call('loopPrompt/prompt-versions', { input: {} })
    check('prompt-versions: initial 种子存在(total>=1)', versions.ready === true && versions.total >= 1, `total=${versions.total}`)
    const v1 = versions.versions?.at(-1)
    const { createHash } = await import('node:crypto')
    check('prompt-versions: checksum=sha256(content)', v1 !== undefined && v1.checksum === createHash('sha256').update(v1.content, 'utf8').digest('hex'))
    check('prompt-versions: 记录字段齐全(id/seq/author/createdAt/source/parentId/bytes)',
      v1 !== undefined && typeof v1.id === 'string' && typeof v1.seq === 'number' && typeof v1.author === 'string'
      && typeof v1.createdAt === 'string' && typeof v1.source === 'string' && ('parentId' in v1) && typeof v1.bytes === 'number')
  }
  {
    const report = await dsh.call('loopPrompt/trace', { input: {} })
    check('trace: 列表模式返回 sessions 数组', Array.isArray(report.sessions), `sessions=${report.sessions?.length}`)
    const first = report.sessions?.[0]
    if (first !== undefined) {
      const detail = await dsh.call('loopPrompt/trace', { input: { sessionId: first.sessionId } })
      check('trace: 指定会话返回轮次树(selected 非空)', detail.selected?.sessionId === first.sessionId && Array.isArray(detail.selected?.turns))
    }
  }

  // 5.5) T1.4 读侧按条目:三型采样(prompt-get/prompt-versions {entryId})+ not-found + 旧口径互证
  {
    const snap = await dsh.call('loopPrompt/snapshot')
    check('snapshot(T1.4): entries[] 注册表全景 16 条(四层全量,T3.1 起含元提示词层)', Array.isArray(snap.entries) && snap.entries.length === 16, `entries=${snap.entries?.length}`)
    const ids = new Set((snap.entries ?? []).map((e) => e.id))
    check('snapshot(T1.4): entries[] 含三型采样条目(块标量 plan-mode/领域 personaPrefix/只读型 time-context)',
      ids.has('preset.standard.plan-mode.section') && ids.has('domain.event-planning.persona-prefix') && ids.has('preset.standard.time-context'))

    // a) 块标量条目(最难写形态 | 多段字面块):当前值反引正确 + 与 dump-config 组合树一致
    const planMode = await dsh.call('loopPrompt/prompt-get', { input: { entryId: 'preset.standard.plan-mode.section' } })
    const planText = planMode.value?.text
    check('prompt-get{plan-mode.section}: 字面块(|)整段反引(首段/末段/段落空行/clip 尾换行)',
      planMode.entry?.id === 'preset.standard.plan-mode.section' && planMode.entry?.kind === 'patch-value'
        && typeof planText === 'string' && planText.startsWith('You are in plan mode. Stay in plan mode until the user approves your plan')
        && planText.includes('Make the plan decision-complete') && planText.includes('do not proceed with implementation.')
        && planText.includes('\n\n') && planText.endsWith('\n'),
      `bytes=${planMode.value?.bytes}`)
    check('prompt-get{plan-mode.section}: 值与 dump-config 组合树一致(section 首段在场于组合树)',
      dumpOut.includes('You are in plan mode. Stay in plan mode until the user approves your plan'))
    const planVersions = await dsh.call('loopPrompt/prompt-versions', { input: { entryId: 'preset.standard.plan-mode.section' } })
    check('prompt-versions{plan-mode.section}: 条目链已种子(initial)且 entryId 回显',
      planVersions.entryId === 'preset.standard.plan-mode.section' && planVersions.total === 1
        && planVersions.versions?.[0]?.source === 'initial' && planVersions.versions?.[0]?.content === planText)

    // b) 领域层条目(>- 折叠块标量):值与仓库 pack 文件逐字一致(脚本内独立折叠实现互证)
    const packPath = resolve(repoRoot, 'packs', 'event-planning', 'cordis.patch.yml')
    const packLines = readFileSync(packPath, 'utf8').split('\n')
    const headerIndex = packLines.findIndex((l) => /^(\s*)personaPrefix: >-\s*$/.test(l))
    const headerIndent = /^(\s*)/.exec(packLines[headerIndex] ?? '')?.[1]?.length ?? 0
    const rawBlock = []
    for (let i = headerIndex + 1; i < packLines.length; i += 1) {
      const line = packLines[i]
      if (line.trim() === '') { rawBlock.push(''); continue }
      if ((/^(\s*)/.exec(line)?.[1]?.length ?? 0) <= headerIndent) break
      rawBlock.push(line)
    }
    while (rawBlock.length > 0 && rawBlock.at(-1).trim() === '') rawBlock.pop()
    const contentIndent = /^(\s*)/.exec(rawBlock[0] ?? '')?.[1]?.length ?? 0
    const folded = rawBlock.map((line) => (line.trim() === '' ? '' : line.slice(contentIndent)))
    const domain = await dsh.call('loopPrompt/prompt-get', { input: { entryId: 'domain.event-planning.persona-prefix' } })
    check('prompt-get{event-planning.personaPrefix}: 折叠块(>-)反引与 pack 文件逐字一致',
      domain.entry?.layer === 'domain' && domain.value?.text === folded.join(' '),
      `bytes=${domain.value?.bytes}`)
    check('prompt-get{event-planning.personaPrefix}: 领域身份句+三条红线句在场',
      typeof domain.value?.text === 'string' && domain.value.text.startsWith('You are a senior event planning specialist')
        && domain.value.text.includes('stay neutral in vendor selection.'))
    const domainVersions = await dsh.call('loopPrompt/prompt-versions', { input: { entryId: 'domain.event-planning.persona-prefix' } })
    check('prompt-versions{event-planning.personaPrefix}: 条目链已种子(initial)',
      domainVersions.total === 1 && domainVersions.versions?.[0]?.source === 'initial'
        && domainVersions.versions?.[0]?.content === domain.value?.text)

    // c) 行锚点只读型:返回「上游运行时生成」标注而非文本;无版本链不种子
    const tc = await dsh.call('loopPrompt/prompt-get', { input: { entryId: 'preset.standard.time-context' } })
    check('prompt-get{time-context}: 只读型 text=null +「上游插件运行时生成」标注(不伪造文本)',
      tc.entry?.kind === 'line-anchor-readonly' && tc.entry?.versioned === false
        && tc.value?.text == null && typeof tc.value?.note === 'string' && tc.value.note.includes('上游插件运行时生成'))
    const tcVersions = await dsh.call('loopPrompt/prompt-versions', { input: { entryId: 'preset.standard.time-context' } })
    check('prompt-versions{time-context}: 无版本链(total=0,未种子不造假)',
      tcVersions.entryId === 'preset.standard.time-context' && tcVersions.total === 0 && (tcVersions.versions ?? []).length === 0)

    // d) persona 条目:per-entry 与旧口径互证(同刻同值同链长)
    const personaEntry = await dsh.call('loopPrompt/prompt-get', { input: { entryId: 'preset.standard.persona' } })
    const legacyGet = await dsh.call('loopPrompt/prompt-get')
    const personaPerEntry = await dsh.call('loopPrompt/prompt-versions', { input: { entryId: 'preset.standard.persona' } })
    const legacyVersions = await dsh.call('loopPrompt/prompt-versions', { input: {} })
    check('prompt-get{preset.standard.persona}: per-entry 当前值=live patch 标记,与旧形态同值',
      personaEntry.value?.text === MARKER && personaEntry.value?.text === legacyGet.persona?.text)
    check('prompt-versions{preset.standard.persona}: per-entry 链与旧口径同长同链首(缺省=persona 链)',
      personaPerEntry.entryId === 'preset.standard.persona' && personaPerEntry.total === legacyVersions.total
        && personaPerEntry.versions?.[0]?.id === legacyVersions.versions?.[0]?.id, `total=${personaPerEntry.total}`)

    // e) 未知 entryId:not-found 明示(不抛裸异常,RPC 正常返回)
    const nfGet = await dsh.call('loopPrompt/prompt-get', { input: { entryId: 'no.such.entry' } })
    check('prompt-get{未知 entryId}: status=not-found 明示', nfGet.status === 'not-found' && String(nfGet.issues?.[0]).includes('未知条目'))
    const nfVersions = await dsh.call('loopPrompt/prompt-versions', { input: { entryId: 'no.such.entry' } })
    check('prompt-versions{未知 entryId}: status=not-found 明示', nfVersions.status === 'not-found' && String(nfVersions.issues?.[0]).includes('未知条目'))
  }

  // 6) 保存链路端到端:R3 审批卡 → 确认 → patch 原子写 + 版本 +1 + 宿主内干跑自检
  const v2 = `${MARKER}\n${SAVE_TAIL}`
  {
    const phase1 = await dsh.call('loopPrompt/prompt-save', { input: { content: v2, author: 't7-smoke', summary: '冒烟:追加红线行' } })
    check('prompt-save(一段): status=approval-required', phase1.status === 'approval-required')
    check('prompt-save(一段): R3 审批卡', phase1.approval?.card?.matchedRule?.grade === 'R3')
    check('prompt-save(一段): doubleConfirm 第二问', (phase1.approval?.questionItems?.length ?? 0) === 2)
    check('prompt-save(一段): patch 未写(v2 未落盘,等审批)', !readFileSync(patchPath, 'utf8').includes(SAVE_TAIL))
    const approvalId = phase1.approval?.approvalId
    const phase2 = await dsh.call('loopPrompt/prompt-save', { input: { content: v2, author: 't7-smoke', approvalId, approved: true } })
    check('prompt-save(二段): status=committed', phase2.status === 'committed')
    check('prompt-save(二段): 版本 +1(source=save, seq=2)', phase2.version?.source === 'save' && phase2.version?.seq === 2,
      `seq=${phase2.version?.seq}`)
    check('prompt-save(二段): patch 层已原子更新(含 v2 文本)', readFileSync(patchPath, 'utf8').includes(SAVE_TAIL))
    const snapAfter = await dsh.call('loopPrompt/snapshot')
    check('prompt-save(二段): 在途审批已清(pendingApproval=null)', snapAfter.pendingApproval === null)
    // HMR 重组合时序(awaitWriteFinish≈2s;UI 按 8s 级等待)后,宿主日志仍洁净
    await sleep(8000)
    check('保存后宿主日志无 skipping/incompatible(HMR 重组合洁净)', !/skipping|incompatible/i.test(readFileSync(hostLog, 'utf8')))
  }

  // 6.5) T1.6 写链路按条目(测试计划 §3 T1.6:一/二段式 + dump-config 干跑;
  //      块标量条目采样 + 只读型拒写 + 领域层形态 A)
  packBytesBefore = readFileSync(packPatchPath, 'utf8')
  {
    // a) 块标量条目(plan-mode section:|,live patch 在场):save 两段式 + 回滚。
    const planBefore = await dsh.call('loopPrompt/prompt-get', { input: { entryId: 'preset.standard.plan-mode.section' } })
    const planText = planBefore.value?.text
    check('T1.6 prompt-get{plan-mode}: 前置读回非空', typeof planText === 'string' && planText.length > 0, `bytes=${planBefore.value?.bytes}`)
    const planV2 = `${planText}T7_SMOKE_PLANMODE_MARKER appended line.\n`
    const p1 = await dsh.call('loopPrompt/prompt-save', { input: { entryId: 'preset.standard.plan-mode.section', content: planV2, author: 't7-smoke', summary: 'T1.6:plan-mode 块标量写回' } })
    check('T1.6 prompt-save{plan-mode}(一段): approval-required + ruleId=entry-write.<entryId>',
      p1.status === 'approval-required'
        && p1.approval?.card?.matchedRule?.ruleId === 'eterna.prompt-studio.entry-write.preset.standard.plan-mode.section'
        && p1.approval?.card?.matchedRule?.grade === 'R3',
      `ruleId=${p1.approval?.card?.matchedRule?.ruleId}`)
    const p2 = await dsh.call('loopPrompt/prompt-save', {
      input: { entryId: 'preset.standard.plan-mode.section', content: planV2, author: 't7-smoke', approvalId: p1.approval?.approvalId, approved: true },
    })
    check('T1.6 prompt-save{plan-mode}(二段): committed(entryId/seq 链内)', p2.status === 'committed'
      && p2.version?.entryId === 'preset.standard.plan-mode.section' && p2.version?.seq === 2,
      `seq=${p2.version?.seq}`)
    const afterSave = await dsh.call('loopPrompt/prompt-get', { input: { entryId: 'preset.standard.plan-mode.section' } })
    check('T1.6 plan-mode 写后读回==新文(字面块整段写回,dump-config 干跑已过)', afterSave.value?.text === planV2)
    check('T1.6 plan-mode 写后 dump-config 组合树含新文(HMR 重组合采纳)', await dumpConfigText().then(out => out.includes('T7_SMOKE_PLANMODE_MARKER appended line.')))
    const planChain = await dsh.call('loopPrompt/prompt-versions', { input: { entryId: 'preset.standard.plan-mode.section' } })
    const planInitial = planChain.versions?.at(-1)
    const r1 = await dsh.call('loopPrompt/prompt-rollback', { input: { versionId: planInitial.id, author: 't7-smoke' } })
    check('T1.6 prompt-rollback{plan-mode}(一段): approval-required(按条目回滚)', r1.status === 'approval-required')
    const r2 = await dsh.call('loopPrompt/prompt-rollback', {
      input: { versionId: planInitial.id, author: 't7-smoke', approvalId: r1.approval?.approvalId, approved: true },
    })
    check('T1.6 prompt-rollback{plan-mode}(二段): committed 且 patch 层反引==被回滚文本',
      r2.status === 'committed' && r2.version?.source === 'rollback' && r2.version?.parentId === planInitial.id
        && (await dsh.call('loopPrompt/prompt-get', { input: { entryId: 'preset.standard.plan-mode.section' } })).value?.text === planText,
      `total=${(await dsh.call('loopPrompt/prompt-versions', { input: { entryId: 'preset.standard.plan-mode.section' } })).total}`)

    // b) 行锚点只读型(time-context):写链路 fail-closed 拒写明示。
    const tc = await dsh.call('loopPrompt/prompt-save', { input: { entryId: 'preset.standard.time-context', content: 'x', author: 't7-smoke' } })
    check('T1.6 prompt-save{time-context}: 只读型拒写明示(无 patch 写回落点)',
      tc.status === 'rejected' && String(tc.issues?.[0]).includes('该条目由上游插件生成,无 patch 写回落点'))

    // c) 领域层形态 A(event-planning personaPrefix:>- ,真 pack 文件,字节快照保护)。
    const domBefore = await dsh.call('loopPrompt/prompt-get', { input: { entryId: 'domain.event-planning.persona-prefix' } })
    const domText = domBefore.value?.text
    check('T1.6 prompt-get{event.personaPrefix}: 前置读回非空', typeof domText === 'string' && domText.length > 0)
    const domV2 = `${domText} T7_SMOKE_DOMAIN_MARKER appended.`
    const d1 = await dsh.call('loopPrompt/prompt-save', { input: { entryId: 'domain.event-planning.persona-prefix', content: domV2, author: 't7-smoke', summary: 'T1.6:领域 >- 块写回' } })
    check('T1.6 prompt-save{event.personaPrefix}(一段): approval-required(标准红线双语锚点过)',
      d1.status === 'approval-required', `status=${d1.status} issues=${JSON.stringify(d1.issues)?.slice(0, 160)}`)
    const d2 = await dsh.call('loopPrompt/prompt-save', {
      input: { entryId: 'domain.event-planning.persona-prefix', content: domV2, author: 't7-smoke', approvalId: d1.approval?.approvalId, approved: true },
    })
    check('T1.6 prompt-save{event.personaPrefix}(二段): committed 且 pack 文件写后读回==新文',
      d2.status === 'committed'
        && (await dsh.call('loopPrompt/prompt-get', { input: { entryId: 'domain.event-planning.persona-prefix' } })).value?.text === domV2)
    const domChain = await dsh.call('loopPrompt/prompt-versions', { input: { entryId: 'domain.event-planning.persona-prefix' } })
    const domInitial = domChain.versions?.at(-1)
    const dr1 = await dsh.call('loopPrompt/prompt-rollback', { input: { versionId: domInitial.id, author: 't7-smoke' } })
    const dr2 = await dsh.call('loopPrompt/prompt-rollback', {
      input: { versionId: domInitial.id, author: 't7-smoke', approvalId: dr1.approval?.approvalId, approved: true },
    })
    check('T1.6 prompt-rollback{event.personaPrefix}: 值恢复==原文(形态 A 回滚)',
      dr2.status === 'committed'
        && (await dsh.call('loopPrompt/prompt-get', { input: { entryId: 'domain.event-planning.persona-prefix' } })).value?.text === domText)
    // 审计:按条目写链路事件带 entryId(既有 operator/versionId/at 之外只增字段)。
    {
      const auditFile = resolve(home, 'eterna-prompt-studio', 'audit.jsonl')
      const lines = readFileSync(auditFile, 'utf8').split('\n').filter(Boolean)
      const details = lines.map((l) => JSON.parse(l)).map((r) => (r.detail ?? r))
      const committed = details.filter((r) => r.action === 'prompt-save.committed' && r.entryId === 'domain.event-planning.persona-prefix')
      check('T1.6 审计:prompt-save.committed 带 entryId=domain.event-planning.persona-prefix',
        committed.length >= 1 && typeof committed[0]?.versionId === 'string' && committed[0]?.operator === 't7-smoke')
    }
  }

  // 7) 回滚链路:产生新版本而非删旧版本
  {
    const versions = await dsh.call('loopPrompt/prompt-versions', { input: {} })
    const v1 = versions.versions?.at(-1)
    const phase1 = await dsh.call('loopPrompt/prompt-rollback', { input: { versionId: v1.id, author: 't7-smoke' } })
    check('prompt-rollback(一段): status=approval-required', phase1.status === 'approval-required')
    const phase2 = await dsh.call('loopPrompt/prompt-rollback', {
      input: { versionId: v1.id, author: 't7-smoke', approvalId: phase1.approval?.approvalId, approved: true },
    })
    check('prompt-rollback(二段): committed 且 source=rollback', phase2.status === 'committed' && phase2.version?.source === 'rollback')
    check('prompt-rollback(二段): parentId 指向被回滚版本', phase2.version?.parentId === v1.id)
    const after = await dsh.call('loopPrompt/prompt-versions', { input: {} })
    check('版本只增不删:total=3 且 initial 版本仍在', after.total === 3 && after.versions.some((v) => v.id === v1.id), `total=${after.total}`)
    check('回滚后 patch 层回到目标内容(无 v2 文本)', !readFileSync(patchPath, 'utf8').includes(SAVE_TAIL))
    // T1.6 泛化后守卫(原 T1.4「仅支持默认条目」过渡守卫的收编):按条目回滚已放行
    // (见 6.5 节 plan-mode/领域条目),守卫语义收窄为「条目错配」——entryId 与版本
    // 归属不符 fail-closed 拒回滚,persona 落点零污染。
    const planChain = await dsh.call('loopPrompt/prompt-versions', { input: { entryId: 'preset.standard.plan-mode.section' } })
    const crossEntry = await dsh.call('loopPrompt/prompt-rollback', {
      input: { versionId: planChain.versions?.[0]?.id, entryId: 'preset.standard.persona', author: 't7-smoke' },
    })
    const prefixLine = readFileSync(patchPath, 'utf8').split('\n').find((l) => /^(\s*)prefix: /.test(l)) ?? ''
    check('prompt-rollback{条目错配}: fail-closed rejected(版本归属与请求条目不符;T1.6 守卫)',
      crossEntry.status === 'rejected' && String(crossEntry.issues?.[0]).includes('属于条目 preset.standard.plan-mode.section')
        && String(crossEntry.issues?.[0]).includes('preset.standard.persona')
        && prefixLine.includes(MARKER)
        && (await dsh.call('loopPrompt/prompt-versions', { input: {} })).total === 3)
  }

  // 8) 磁盘证据:storage 栈单元目录 + 兜底审计 NDJSON(G5:operator/versionId)
  //    T1.4 装载种子按条目 + T1.6 按条目写链路:persona 链 3(initial+save+rollback)
  //    + plan-mode 链 3 + event.personaPrefix 链 3(T1.6 写回/回滚各 +1)+ 其余六条
  //    patch 值型条目链首各 1(agent-instructions/两包 persona.md/industrial 前缀 +
  //    T3.1 元提示词×2;live patch 无 preset-cordis 行,该预设条目定位失败不种子)
  //    = 3+3+3+6=15 文档。
  {
    const unitDir = resolve(home, 'storages', 'eterna_prompt_studio', 'versions')
    const docs = existsSync(unitDir) ? readdirSync(unitDir).filter((f) => f.endsWith('.json')) : []
    check('版本库单元落在 DSH storage 栈(storages/eterna_prompt_studio/versions/ 一文档一记录;T1.6 后 persona/plan-mode/领域前缀各 3 + 六条目链首(T3.1 起含元提示词×2))',
      docs.length === 15, `docs=${docs.length}`)
    {
      const records = docs.map((f) => JSON.parse(readFileSync(resolve(unitDir, f), 'utf8')).record)
      const byEntry = new Map()
      for (const record of records) byEntry.set(record.entryId, (byEntry.get(record.entryId) ?? 0) + 1)
      check('磁盘证据(T1.6): 每文档记录带 entryId;persona/plan-mode/领域前缀链各 3、六条目链首各 1(与端点链长一致)',
        records.every((r) => typeof r.entryId === 'string' && r.entryId !== '')
          && byEntry.get('preset.standard.persona') === 3
          && byEntry.get('preset.standard.plan-mode.section') === 3
          && byEntry.get('domain.event-planning.persona-prefix') === 3
          && ['preset.standard.agent-instructions',
            'domain.event-planning.persona-md',
            'domain.industrial-analysis.persona-prefix', 'domain.industrial-analysis.persona-md',
            'meta.studio.ai-polish', 'meta.studio.ai-review']
            .every((id) => byEntry.get(id) === 1),
        [...byEntry.entries()].map(([id, n]) => `${id}:${n}`).join(' '))
    }
    const auditFile = resolve(home, 'eterna-prompt-studio', 'audit.jsonl')
    if (check('兜底审计 NDJSON 存在(无 glue governance 场景)', existsSync(auditFile))) {
      const lines = readFileSync(auditFile, 'utf8').split('\n').filter(Boolean)
      // FileAuditSink 包络形态 {kind:'governance', at, detail:{system/action/…}};detail 即本包载荷。
      const committed = lines.map((l) => JSON.parse(l))
        .map((r) => (r.detail ?? r))
        .filter((r) => r.action === 'prompt-save.committed' || r.action === 'prompt-rollback.committed')
      check('审计记录含 action/system/at/operator/versionId(G5)', lines.length >= 4
        && committed.length >= 2
        && committed.every((r) => r.system === 'eterna-prompt-studio' && r.operator === 't7-smoke'
          && typeof r.versionId === 'string' && typeof r.at === 'string'), `lines=${lines.length} committed=${committed.length}`)
      check('审计记录(T1.6): 写链路 committed 事件带 entryId',
        committed.length >= 4 && committed.every((r) => typeof r.entryId === 'string' && r.entryId !== ''),
        `entryIds=${[...new Set(committed.map((r) => r.entryId))].join(',')}`)
    }
  }

  // 9) T2.3 会话快照:session/create 真开会话(HTTP 面 session/created 事件)→
  //    新会话开启即有快照;按会话可查;改提示词后已存快照不变(不可变核心断言)。
  {
    const { createHash } = await import('node:crypto')
    // 9a) 开新会话(真实 session/created;spike 同款重试,agents 服务起复竞态容错)。
    const wsDir = `/tmp/t7-smoke-ws-${process.pid}`
    mkdirSync(wsDir, { recursive: true })
    let sessionId = ''
    for (let i = 0; i < 20; i++) {
      try {
        const created = await dsh.call('session/create', { request: { cwd: wsDir } })
        sessionId = created.sessionId ?? ''
        if (sessionId !== '') break
      } catch (error) {
        if (i === 19) throw error
        await sleep(1000)
      }
    }
    check('T2.3 session/create: 新会话开启(sessionId=session-<uuid>)', /^session-[A-Za-z0-9-]+$/.test(sessionId), `sessionId=${sessionId}`)

    // 9b) 新会话开启即有快照:按会话查询(捕获异步,轮询至在场;10s 上限)。
    let snapshot = null
    for (let i = 0; i < 50; i++) {
      const result = await dsh.call('loopPrompt/session-snapshot', { input: { sessionId } })
      if (result.status === 'ok') { snapshot = result.snapshot; break }
      await sleep(200)
    }
    check('T2.3 session-snapshot{sessionId}: 新会话开启即有快照(轮询≤10s 在场)', snapshot !== null)
    if (snapshot !== null) {
      const byId = new Map((snapshot.entries ?? []).map((e) => [e.entryId, e]))
      check('T2.3 快照全景: entries=注册表 16 条(四层全量,含三型;T3.1 起含元提示词层)',
        snapshot.entries.length === 16 && byId.has('preset.standard.persona')
          && byId.has('preset.standard.time-context') && byId.has('runtime.memory.index-section'),
        `entries=${snapshot.entries.length}`)
      // patch 值型:当时文本 + 版本指针(=当时 persona 链最新版本)。
      const persona = byId.get('preset.standard.persona')
      const versionsThen = await dsh.call('loopPrompt/prompt-versions', { input: {} })
      check('T2.3 快照指针: persona 当时文本在文 + versionId=当时链最新版本',
        persona?.text === MARKER && persona?.versionId === versionsThen.versions?.[0]?.id
          && persona?.checksum === createHash('sha256').update(persona?.text ?? '', 'utf8').digest('hex'),
        `versionId=${persona?.versionId}`)
      // 三型条目结构化结果:只读型/运行时注入型标注在场,不炸不空段冒充。
      check('T2.3 快照分型: 行锚点只读型=在场标记+「上游运行时生成」标注(不伪造 versionId)',
        byId.get('preset.standard.time-context')?.versionId == null
          && String(byId.get('preset.standard.time-context')?.annotation).includes('上游运行时生成'))
      check('T2.3 快照分型: 运行时注入型=在场标记标注(不炸不空段)',
        String(byId.get('runtime.memory.index-section')?.annotation).includes('在场标记'))
      // 快照整体 checksum 复核(规范化载荷 {entries,sessionId,trigger} 逐字节重算)。
      const recomputed = createHash('sha256')
        .update(JSON.stringify({ entries: snapshot.entries, sessionId: snapshot.sessionId, trigger: snapshot.trigger }), 'utf8')
        .digest('hex')
      check('T2.3 快照 checksum: 与规范化载荷 sha256 复核一致', snapshot.checksum === recomputed, `checksum=${snapshot.checksum.slice(0, 12)}…`)
      // 列表模式含该会话。
      const list = await dsh.call('loopPrompt/session-snapshot', { input: {} })
      check('T2.3 session-snapshot(列表): ready 且含本会话',
        list.ready === true && (list.snapshots ?? []).some((s) => s.sessionId === sessionId), `total=${list.total}`)
      // 不可变核心断言:改提示词(保存两段式)后,已存快照逐字节不变。
      const beforeJson = JSON.stringify(snapshot)
      const personaV2 = `${MARKER}\n${SAVE_TAIL}`
      const p1 = await dsh.call('loopPrompt/prompt-save', { input: { content: personaV2, author: 't7-smoke', summary: 'T2.3:改提示词验证快照不可变' } })
      const p2 = await dsh.call('loopPrompt/prompt-save', { input: { content: personaV2, author: 't7-smoke', approvalId: p1.approval?.approvalId, approved: true } })
      check('T2.3 前置: 保存新文 committed(快照不可变的对照写操作)', p2.status === 'committed')
      const after = await dsh.call('loopPrompt/session-snapshot', { input: { sessionId } })
      check('T2.3 快照不可变: 改提示词后已存快照逐字节不变(仍=开启时 persona 文)',
        after.status === 'ok' && JSON.stringify(after.snapshot) === beforeJson
          && after.snapshot.entries.find((e) => e.entryId === 'preset.standard.persona')?.text === MARKER)
      // 9c) 收场还原:多行 persona 会让 T7 旧口径单行 reader unavailable——回滚到
      //     initial 单行基线,保持后续 t7-ui-check 的首态假设(断言数只增,既有
      //     检查零改动)。
      const allVersions = await dsh.call('loopPrompt/prompt-versions', { input: {} })
      const initialVersion = allVersions.versions?.at(-1)
      const rb1 = await dsh.call('loopPrompt/prompt-rollback', { input: { versionId: initialVersion?.id, author: 't7-smoke' } })
      const rb2 = await dsh.call('loopPrompt/prompt-rollback', {
        input: { versionId: initialVersion?.id, author: 't7-smoke', approvalId: rb1.approval?.approvalId, approved: true },
      })
      check('T2.3 收场: persona 回滚到单行基线 MARKER(保持 ui-check 首态假设)',
        rb2.status === 'committed' && (await dsh.call('loopPrompt/prompt-get')).persona?.text === MARKER)
    }
    // 未知 sessionId → not-found 明示(不炸)。
    const missing = await dsh.call('loopPrompt/session-snapshot', { input: { sessionId: 'session-nonexistent-0000' } })
    check('T2.3 session-snapshot{未知 sessionId}: status=not-found 明示不炸',
      missing.status === 'not-found' && String(missing.issues?.[0]).includes('无快照'))
    // 磁盘证据:快照单元落在 storage 栈根(per-record 一文档一记录)。
    const snapDir = resolve(home, 'storages', 'eterna_prompt_snapshots', 'snapshots')
    const snapDocs = existsSync(snapDir) ? readdirSync(snapDir).filter((f) => f.endsWith('.json')) : []
    check('T2.3 磁盘证据: 快照单元落在 storage 栈根(storages/eterna_prompt_snapshots/snapshots/ 一文档一快照)',
      snapDocs.length >= 1, `docs=${snapDocs.length}`)
    if (snapDocs.length >= 1) {
      const doc = JSON.parse(readFileSync(resolve(snapDir, snapDocs[0]), 'utf8'))
      check('T2.3 磁盘证据: 文档记录带 sessionId/checksum/entries(与端点同源;T3.1 起 16 条)',
        typeof doc.record?.sessionId === 'string' && typeof doc.record?.checksum === 'string'
          && Array.isArray(doc.record?.entries) && doc.record.entries.length === 16)
    }
    rmSync(wsDir, { recursive: true, force: true })
  }

  console.log('[cleanup] SIGTERM 宿主(持久化层停机冲刷)…')
} catch (error) {
  failures.push(String(error?.message ?? error))
  console.error(`[FATAL] ${String(error?.message ?? error)}`)
} finally {
  // T1.6 形态 A 写的是真 worktree 的 pack 文件:无论断言成败,字节级还原后再收场。
  console.log(`[cleanup] 领域 pack 文件字节还原:${restorePackFile()}`)
  await stopHost()
  const freed = !(await portBusy())
  check('清理:宿主进程已停止、端口 3108 已释放', freed)
  if (!freed) {
    spawnSync('pkill', ['-9', '-f', `profile ${profileName}`], { stdio: 'ignore' })
    await sleep(1000)
  }
  console.log(`\n结论:${failures.length === 0 ? 'T7.1 装载冒烟全部通过(exit 0)' : `存在失败项(exit 1):${failures.join(' | ')}`}`)
  exitCode = failures.length === 0 ? 0 : 1
}
process.exit(exitCode)
