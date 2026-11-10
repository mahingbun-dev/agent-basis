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
 *     挂载)、loopPrompt/prompt-get、loopPrompt/prompt-versions(initial 种子 +
 *     checksum 口径)、loopPrompt/trace(列表 + 指定会话轮次树);
 *  6. 保存链路端到端:prompt-save 两段式(一段=R3 审批卡 + doubleConfirm 第二问 +
 *     patch 未落盘;二段=patch 原子写 + 版本 +1 + 宿主内 dump-config 干跑自检通过);
 *  7. 回滚链路:prompt-rollback 两段式 → 新版本(source=rollback,parentId=被回滚
 *     版本),版本只增不删(total=3),patch 层回到目标内容;
 *  8. 磁盘证据:版本库单元落在 DSH storage 栈根(<home>/storages/eterna_prompt_studio/,
 *     per-record 一文档一记录);兜底审计 NDJSON 含 operator/versionId(G5)。
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

  // 0) 幂等:清本包运行态(版本库单元 + 兜底审计),使断言可从零复现。
  rmSync(resolve(home, 'storages', 'eterna_prompt_studio'), { recursive: true, force: true })
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
  {
    const r = spawnSync(process.execPath, [
      resolve(profile, 'node_modules/@deepseek-ai/dsh/lib/bin.js'),
      '--profile', profileName, '--dump-config',
    ], { cwd: profile, encoding: 'utf8', env: { ...process.env, DSH_HOME: home }, timeout: 180000 })
    const out = r.stdout ?? ''
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
  }

  // 8) 磁盘证据:storage 栈单元目录 + 兜底审计 NDJSON(G5:operator/versionId)
  {
    const unitDir = resolve(home, 'storages', 'eterna_prompt_studio', 'versions')
    const docs = existsSync(unitDir) ? readdirSync(unitDir).filter((f) => f.endsWith('.json')) : []
    check('版本库单元落在 DSH storage 栈(storages/eterna_prompt_studio/versions/ 一文档一记录)', docs.length === 3, `docs=${docs.length}`)
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
    }
  }

  console.log('[cleanup] SIGTERM 宿主(持久化层停机冲刷)…')
} catch (error) {
  failures.push(String(error?.message ?? error))
  console.error(`[FATAL] ${String(error?.message ?? error)}`)
} finally {
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
