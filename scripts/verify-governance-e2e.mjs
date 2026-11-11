#!/usr/bin/env node
/**
 * T9:治理面挂载真 boot E2E(T8 的 T4 验收遗留;风格对齐 scripts/verify-eterna-web.mjs
 * 的「真 boot + pluginInventory 断言」与 scripts/smoke-embed.mjs 的「headless 真会话 +
 * NDJSON 事件流」)。断言四件事:
 *
 *  a) deny 路径:web_fetch 指向 http://127.0.0.1:<port>/deny-me —— 127.0.0.1 不在
 *     egress 内网默认白名单(DEFAULT_EGRESS_DOMAIN_RULES:'192.168.31.*'、localhost、
 *     manas,fail-closed 字面口径);governance 规则显式 allow web_fetch → allow 透传给下游
 *     eterna-egress → 域名级 deny。断言 tool_result 为结构化拒绝(NDJSON status=error,
 *     文本含 '[egress]' 与 '不在出网域名白名单'),且「底层 execute 未被调用」由网络级
 *     证据闭环:本地见证服务器对 /deny-me 命中数必须为 0(拒绝发生在 pre-execute,
 *     连接根本不建立;web-fetch-http 明确支持 loopback,provider.ts:37)。
 *  b) allow 路径:web_fetch 指向 http://localhost:<port>/allow-me —— localhost 在默认
 *     白名单(规则不带 ports = 任意端口放行,domain-whitelist.ts:21);断言 tool_result
 *     status=completed 且含 presenter 头 'Fetched http://…/allow-me (HTTP 200)'
 *     (tool-web fetch.ts:329),见证服务器 /allow* 命中 ≥1(底层真执行)。
 *  c) 审计留痕:会话后 <ws>/.eterna/audit-YYYYMMDD.jsonl(DailyFileAuditSink 产物,
 *     defaultAuditDir = dsh 进程 cwd)存在,且含 kind=tool-call(被拒调用 isError=true
 *     + 放行调用 isError=false)、kind=governance(detail.source='glue-egress' 直投)、
 *     kind=turn-end 记录。
 *  d) 装卸无残留(T4 验收「新插件在两档 profile 均可装卸,effect 逆闭包卸载无残留」):
 *     - web 档(model-free):物化 eterna-web → patch 备份后追加 insert 行
 *       (eterna-governance/eterna-audit/eterna-egress)→ boot → pluginInventory/list 断言
 *       三行 present+enabled+active 且 0 failed → 还原 patch(字节级)→ 再 boot →
 *       断言无 'eterna-' 前缀条目。
 *     - embed 档(真会话行为对比):挂载跑 = a/b/c 会话(行为证据 = 拒绝标记 + 审计
 *       落盘);还原 patch 后同任务再跑:任何 tool_result 无 '[egress]' 标记、/deny-me
 *       被真抓取(见证服务器命中 ≥1,治理已不在)、.eterna 下无审计文件。
 *
 * patch 文件纪律:本脚本只改「物化副本」($DSH_HOME/profiles/<name>/cordis.patch.yml,
 * 脚本自管 home,默认 .eterna-home-gov-e2e),从不改工作区 profiles 源目录的 patch 文件
 * ——还原 = 写回读取时的原始字节并断言逐字一致(try/finally 兜底);git checkout 无
 * 需要也禁用(工作区有未提交改动)。mount 载体 = profile 用户层 insert 行(与
 * packages/glue/cordis.patch.yml 同款行;裸 id 行会被 applyPatches 丢弃——2026-11-04
 * E2E 教训,故一律 insert)。
 *
 * 凭据纪律(参照 scripts/perf-realsession.mjs):MIMO_API_KEY / MIMO_BASE_URL(可空,默认固化直连)
 * env 优先,.secrets 兜底自查;只进子进程环境,不进被跟踪文件/日志/argv。
 * 确定性纪律:见证服务器(本机回环)让 deny/allow 两路径不经外网、不经内网依赖;
 * 出网代理变量在 spawn 前剥除,防本机代理把 localhost 抓取导走。
 *
 * 用法:node scripts/verify-governance-e2e.mjs   (exit 0 = 全部断言通过)
 *   GOV_E2E_PROFILE_HOME — DSH home(默认 <repo>/.eterna-home-gov-e2e)
 */

import { spawn } from 'node:child_process'
import { createServer } from 'node:http'
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const dshBin = join(repoRoot, 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js')
const gluePkg = join(repoRoot, 'packages', 'glue')
const home = resolve(process.env.GOV_E2E_PROFILE_HOME ?? join(repoRoot, '.eterna-home-gov-e2e'))

const BOOT_TIMEOUT_MS = 120_000
const RUN_TIMEOUT_MS = 240_000
const PROBE_TIMEOUT_MS = 10_000

const CLEAN_STOP_KINDS = new Set(['completed', 'stop'])
/** 挂载行(与 packages/glue/cordis.patch.yml 同款;E2E 只挂治理面三插件,不挂
 *  memory/knowledge——它们带 cwd 侧效应(sqlite/wiki),不在本 E2E 断言面)。 */
const MOUNT_ROWS = [
  { id: 'eterna-governance', name: '@eterna/glue/governance-plugin' },
  { id: 'eterna-audit', name: '@eterna/glue/audit-plugin' },
  { id: 'eterna-egress', name: '@eterna/glue/egress-plugin' },
]

const failures = []
const pass = (name, ok, detail = '') => {
  console.log(`[${ok ? 'PASS' : 'FAIL'}] ${name}${detail ? ` — ${detail}` : ''}`)
  if (!ok) failures.push(name)
}

// ---------------------------------------------------------------------------
// 0. 前置:bin、glue 包、凭据(env 优先,.secrets 兜底;值永不打印)。

if (!existsSync(dshBin)) {
  console.error(`verify-governance-e2e: dsh CLI not found at ${dshBin}; run pnpm install first`)
  process.exit(1)
}
if (!existsSync(join(gluePkg, 'src', 'plugins', 'governance-plugin.ts'))) {
  console.error(`verify-governance-e2e: @eterna/glue sources missing at ${gluePkg}`)
  process.exit(1)
}
const readSecret = (file) => {
  try { return readFileSync(join(repoRoot, '.secrets', file), 'utf8').trim() } catch { return '' }
}
const apiKey = process.env.MIMO_API_KEY || readSecret('mimo-api-key.txt')
const baseURL = (process.env.MIMO_BASE_URL(可空,默认固化直连) || 'https://api.xiaomimimo.com/v1').replace(/\/$/, '')
if (!apiKey || !baseURL) {
  console.error('verify-governance-e2e: 缺少 MIMO_API_KEY / MIMO_BASE_URL(可空,默认固化直连)(且 .secrets 兜底不可读)——embed 真会话无法执行,如实失败,不伪造')
  process.exit(1)
}
console.log(`verify-governance-e2e: gateway ${baseURL} (key source: ${process.env.MIMO_API_KEY ? 'env MIMO_API_KEY' : '.secrets/mimo-api-key.txt'})`)

// ---------------------------------------------------------------------------
// 1. 本地见证服务器:OS 随机端口;按路径计数,是 a/b/d 的「底层是否真执行」证据。
//    不绑 host(双栈:node 在 IPv6 可用时绑 '::' 并接受 IPv4 映射)——allow URL 的
//    host 是 localhost,可能解析为 ::1 或 127.0.0.1,两种回环形态都必须可达;
//    只绑 127.0.0.1 时 ::1 首选的环境会连接被拒,allow 路径假失败。

const hits = new Map()
const server = createServer((req, res) => {
  const pathname = req.url?.split('?')[0] ?? '/'
  hits.set(pathname, (hits.get(pathname) ?? 0) + 1)
  res.writeHead(200, { 'content-type': 'text/plain' })
  res.end(`eterna-e2e-ok ${pathname}`)
})
await new Promise((resolveListen) => { server.listen(0, resolveListen) })
server.unref() // 不让残留 keep-alive 连接吊住进程退出(最终 close 前再 closeAllConnections 兜底)
const port = server.address().port
const DENY_URL = `http://127.0.0.1:${port}/deny-me`
const ALLOW_URL = `http://localhost:${port}/allow-me`
console.log(`verify-governance-e2e: witness server on 127.0.0.1:${port} (deny=${DENY_URL} allow=${ALLOW_URL})`)
const hitSummary = () => JSON.stringify([...hits.entries()])

// 不带代理变量的 spawn 环境(本机代理可能劫持 localhost 抓取,破坏见证证据)。
const directEnv = { ...process.env }
for (const key of Object.keys(directEnv)) {
  if (/^(https?_proxy|all_proxy)$/i.test(key)) delete directEnv[key]
}

// ---------------------------------------------------------------------------
// 2. 物化基建:profile 目录 + @eterna/glue symlink(Loader 只按 profile 根
//    node_modules 解析 row name——smoke-embed/t7 实证)+ patch 读写备份器。

const profileDir = (name) => join(home, 'profiles', name)
const homePatch = join(home, 'cordis.patch.yml')
if (existsSync(homePatch)) {
  console.error(`verify-governance-e2e: ${homePatch} exists; a home-level user patch would compose over the profile layer and break determinism — remove it or point GOV_E2E_PROFILE_HOME at a clean home`)
  process.exit(1)
}

/**
 * 物化一档 profile:bundles 元组 + cordis.yml + 源 patch 逐字拷贝 + @eterna symlink 集。
 * glue 恒挂(挂载行用);extraLinks 供 profile 自身 patch 引用的 @eterna 包——
 * eterna-embed 的网关路由行引用 '@eterna/llm-openai'(patch:74),缺 symlink 时该行
 * 装不上 → 模型路由无凭据 → 会话 LlmFailure(2026-11-09 门禁实证:挂载/卸载两跑同败)。
 * row-name 解析只看 profile 根 node_modules(smoke-embed 实证),symlink 终态同款。
 */
function materializeProfile(name, bundles, extraLinks = []) {
  const dir = profileDir(name)
  rmSync(dir, { recursive: true, force: true })
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'package.json'), `${JSON.stringify({ name: `dsh-profile-${name}`, private: true, dsh: { profile: { bundles } } }, null, 2)}\n`)
  writeFileSync(join(dir, 'cordis.yml'), '[]\n')
  copyFileSync(join(repoRoot, 'profiles', name, 'cordis.patch.yml'), join(dir, 'cordis.patch.yml'))
  const nmEterna = join(dir, 'node_modules', '@eterna')
  mkdirSync(nmEterna, { recursive: true })
  const links = [['glue', gluePkg], ...extraLinks]
  for (const [name_, target] of links) {
    if (!existsSync(join(target, 'package.json'))) {
      console.error(`verify-governance-e2e: @eterna/${name_} missing at ${target}`)
      process.exit(1)
    }
    const linkPath = join(nmEterna, name_)
    try { rmSync(linkPath, { recursive: true, force: true }) } catch { /* not a symlink */ }
    symlinkSync(target, linkPath, 'dir')
  }
  return join(dir, 'cordis.patch.yml')
}

/**
 * patch 读写备份器:mount 在原始内容后追加 insert 块;restore 写回原始字节并断言
 * 逐字一致。只作用于物化副本,工作区 profiles 源目录的 patch 文件恒不被触碰。
 */
function patchToggler(patchPath) {
  const original = readFileSync(patchPath, 'utf8')
  const mountBlock = [
    '',
    '# ── T9 E2E 临时挂载(scripts/verify-governance-e2e.mjs;结束还原原字节)──',
    '- insert:',
    ...MOUNT_ROWS.map((row) => `    - id: ${row.id}\n      name: '${row.name}'`),
    '',
  ].join('\n')
  return {
    mount() {
      writeFileSync(patchPath, `${original}${mountBlock}`, 'utf8')
    },
    restore() {
      writeFileSync(patchPath, original, 'utf8')
      pass(`patch restored byte-identical (${patchPath})`, readFileSync(patchPath, 'utf8') === original)
    },
  }
}

// ---------------------------------------------------------------------------
// 3. 真会话 / 真 boot 执行器。

/**
 * headless 一次性任务 → NDJSON 行数组(smoke-embed 同款:单一 exit 监听同时裁决
 * 超时与退出码;两个 exit 监听会悬挂)。
 */
function runHeadless(task, ws) {
  return new Promise((resolveRun) => {
    const child = spawn(process.execPath, [dshBin, '--profile', 'eterna-embed', '--json', '--approval-policy', 'never', task], {
      cwd: ws,
      env: { ...directEnv, DSH_HOME: home, MIMO_API_KEY: apiKey, MIMO_BASE_URL(可空,默认固化直连): baseURL },
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    const lines = []
    let stderrTail = ''
    child.stdout.setEncoding('utf8')
    child.stdout.on('data', (chunk) => { for (const line of chunk.split('\n')) if (line.trim().length > 0) lines.push(line) })
    child.stderr.setEncoding('utf8')
    child.stderr.on('data', (chunk) => { stderrTail += chunk })
    const timer = setTimeout(() => {
      child.kill('SIGTERM')
      setTimeout(() => { if (child.exitCode === null) child.kill('SIGKILL') }, 5000).unref()
      resolveRun({ timedOut: true, code: null, stderrTail, lines })
    }, RUN_TIMEOUT_MS)
    child.on('exit', (code) => { clearTimeout(timer); resolveRun({ timedOut: false, code, stderrTail, lines }) })
  })
}

/** web 档 boot:就绪行 'dsh web: <url>' 即 Loader 落定(verify-eterna-web 同款信号)。
 *  cwd 对齐参考脚本 = repoRoot(其已实证 boot 形态);零会话 boot 不产生任何
 *  audit/治理写入(DailyFileAuditSink 惰性建目录,daily-sink.ts:41-42),无仓库污染。 */
function bootWeb() {
  const child = spawn(process.execPath, [dshBin, '--profile', 'eterna-web', '--no-open', '--port', '0'], {
    cwd: repoRoot,
    env: { ...directEnv, DSH_HOME: home },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  const output = []
  const collect = (stream) => {
    stream.setEncoding('utf8')
    stream.on('data', (chunk) => output.push(chunk))
  }
  collect(child.stdout)
  collect(child.stderr)
  const ready = new Promise((resolveReady) => {
    const timer = setTimeout(() => resolveReady({ url: null, timedOut: true }), BOOT_TIMEOUT_MS)
    const check = () => {
      const match = output.join('').match(/^dsh web: (\S+)$/m)
      if (match) { clearTimeout(timer); resolveReady({ url: match[1], timedOut: false }) }
    }
    child.stdout.on('data', check)
    child.stderr.on('data', check)
    child.on('exit', (code) => { clearTimeout(timer); resolveReady({ url: null, exitCode: code }) })
    check()
  })
  return { child, output, ready }
}

async function stop(childProcess) {
  if (childProcess.exitCode !== null) return
  childProcess.kill('SIGTERM')
  await new Promise((resolveStop) => {
    const timer = setTimeout(() => { childProcess.kill('SIGKILL'); resolveStop() }, 5000)
    childProcess.once('exit', () => { clearTimeout(timer); resolveStop() })
  })
}

/**
 * pluginInventory/list 一次性探测(verify-eterna-web 同款:launch token 换 cookie + POST)。
 * RPC 信封两层:body.result = { ok, value | error }(verify-eterna-web.mjs:189-193 调用侧
 * 解包 result.value)——value 才是快照({entries,...});envelope.ok=false 是 handler 级
 * 失败(如条目 fiber failed 拒绝投影),如实带出 error。
 */
async function probeInventory(url) {
  const index = new URL(url)
  const auth = await fetch(url, { redirect: 'manual', signal: AbortSignal.timeout(PROBE_TIMEOUT_MS) })
  const cookie = auth.headers.get('set-cookie')?.split(';')[0]
  if (!auth.ok && auth.status !== 303) return { ok: false, error: { code: 'auth', message: `index returned ${auth.status}` } }
  const response = await fetch(new URL('/api/pluginInventory/list', index.origin), {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) },
    body: JSON.stringify({ type: 'client-request', rpcId: 'verify-governance-e2e', method: 'pluginInventory/list', payload: { args: {} } }),
    signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
  })
  const body = await response.json().catch((error) => ({ parseError: String(error) }))
  if (response.status !== 200 || body.type !== 'server-response' || body.result === undefined) {
    return { ok: false, error: { code: 'transport', message: `POST pluginInventory/list -> ${response.status}`, body } }
  }
  const envelope = body.result
  if (envelope.ok !== true) {
    return { ok: false, error: { code: 'handler', message: `pluginInventory/list handler failed: ${JSON.stringify(envelope.error ?? envelope).slice(0, 600)}` } }
  }
  const snapshot = envelope.value
  if (snapshot === null || typeof snapshot !== 'object' || !Array.isArray(snapshot.entries)) {
    return { ok: false, error: { code: 'shape', message: `unexpected snapshot shape (no entries array): ${JSON.stringify(snapshot).slice(0, 600)}` } }
  }
  return { ok: true, value: snapshot }
}

function parseNdjson(lines) {
  const events = []
  const bad = []
  for (const [index, line] of lines.entries()) {
    try { events.push(JSON.parse(line)) } catch { bad.push(index) }
  }
  return { events, bad }
}

const toolResultsOf = (events) => events.filter((event) => event.type === 'tool_result')
const textOf = (result) => typeof result?.result === 'string' ? result.result : ''

// ---------------------------------------------------------------------------
// 4. embed 档:挂载跑(a/b/c + 插件在的行为证据)→ 还原 → 卸载跑(无残留对比)。

const embedPatch = materializeProfile('eterna-embed', ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-headless'], [
  ['llm-openai', join(repoRoot, 'packages', 'llm-openai')],
])
const embedToggle = patchToggler(embedPatch)
const ws1 = mkdtempSync(join(tmpdir(), 'gov-e2e-embed-mounted-'))
// 治理规则:显式 allow web_fetch(任务面),其余一律 fail-closed deny(default 只允许
// ask/deny;选 deny 让无关调用结构化拒绝、turn 不中断,且不触发 headless 无活审批通道)。
mkdirSync(join(ws1, '.eterna'), { recursive: true })
writeFileSync(join(ws1, '.eterna', 'governance.rules.yml'), [
  'rules:',
  "  - { id: allow-web-fetch, effect: allow, tools: ['web_fetch'] }",
  'default: deny',
  '',
].join('\n'), 'utf8')
// egress 白名单配置文件【故意不写】:文件缺席 = 内网默认白名单(T8 交付的缺省
// fail-closed 行为;127.0.0.1 不在名单 → deny 路径;localhost 在名单 → allow 路径)。

const TASK = [
  '依次完成两次网页抓取,除 web_fetch 外不要调用任何其它工具,两次都要执行:',
  `1) 用 web_fetch 抓取 ${DENY_URL}`,
  '2) 不论第 1 步结果如何,再用 web_fetch 抓取 ' + ALLOW_URL,
  '完成后只回复一行:done',
].join('\n')

try {
  embedToggle.mount()
  console.log(`verify-governance-e2e: [embed mounted] task session (cwd=${ws1})`)
  const mounted = await runHeadless(TASK, ws1)
  if (mounted.timedOut) {
    pass('a/b/c 挂载会话完成', false, `exceeded ${RUN_TIMEOUT_MS}ms`)
    console.error('--- dsh stderr tail ---')
    console.error(mounted.stderrTail.slice(-4000))
  } else {
    const { events, bad } = parseNdjson(mounted.lines)
    const calls = events.filter((event) => event.type === 'tool_call' && event.tool === 'web_fetch')
    const results = toolResultsOf(events)
    const resultOfCall = (call) => results.find((result) => result.callId === call.callId)

    pass('a) 挂载 boot:web_fetch 调用发生(治理面插件在册且被触达)', calls.length > 0,
      `${calls.length} web_fetch call(s)${bad.length > 0 ? `; ${bad.length} 行非 NDJSON` : ''}`)
    const denied = calls.map(resultOfCall).find((result) => result !== undefined && textOf(result).includes('[egress]'))
    pass('a) deny 结构化拒绝:tool_result 为 egress 拒绝文本(isError 物化,turn 不中断)',
      denied !== undefined && denied.status === 'error' && textOf(denied).includes('不在出网域名白名单'),
      denied === undefined ? 'no denied web_fetch result' : `status=${denied.status} text=${JSON.stringify(textOf(denied).slice(0, 160))}`)
    pass('a) 底层 execute 未被调用:见证服务器 /deny-me 命中数为 0(拒绝在 pre-execute,连接未建立)',
      (hits.get('/deny-me') ?? 0) === 0, `hits=${hitSummary()}`)

    const allowed = calls.map(resultOfCall).find((result) => result !== undefined && result.status === 'completed')
    // 断言锚:presenter 头 `Fetched <url> (HTTP <status>)`(tool-web fetch.ts:329)。
    // host 形态不作字面断言(localhost 可能被规范化为 [::1]),用路径 /allow-me 绑定见证服务器。
    pass('b) allow 放行:白名单内 localhost 目的地底层正常执行(HTTP 200)',
      allowed !== undefined && textOf(allowed).includes('Fetched http://') && textOf(allowed).includes('/allow-me') && textOf(allowed).includes('HTTP 200'),
      allowed === undefined ? 'no completed web_fetch result' : JSON.stringify(textOf(allowed).slice(0, 120)))
    pass('b) 底层真执行:见证服务器 /allow 路径命中 ≥1', [...hits.keys()].some((pathname) => pathname.startsWith('/allow')),
      `hits=${hitSummary()}`)

    const finalEvent = events.findLast((event) => event.type === 'final')
    const reasonKind = typeof finalEvent?.reason?.kind === 'string' ? finalEvent.reason.kind : null
    if (reasonKind !== null && !CLEAN_STOP_KINDS.has(reasonKind)) {
      // 失败诊断:turn 级错误明细(final.reason:LlmFailure 事实)+ dsh stderr 尾部,
      // 让门禁输出无需重跑即可定位(如网关路由/凭据/挂载装载失败)。
      console.error(`[diag] mounted final.reason = ${JSON.stringify(finalEvent?.reason)}`)
      console.error('--- dsh stderr tail (mounted) ---')
      console.error(mounted.stderrTail.slice(-4000))
    }
    pass('挂载会话清洁收尾(治理拒绝未中断 turn)', finalEvent?.type === 'final' && reasonKind !== null && CLEAN_STOP_KINDS.has(reasonKind),
      `finishReason=${reasonKind ?? 'null'} exit=${mounted.code}`)
    pass('挂载会话无 runner 级 error 事件', events.filter((event) => event.type === 'error').length === 0,
      events.filter((event) => event.type === 'error').map((event) => event.message).join(' | ') || 'clean')

    // c) 审计留痕:DailyFileAuditSink 按日文件 + 三类记录。
    const auditDir = join(ws1, '.eterna')
    const auditFiles = existsSync(auditDir) ? readdirSync(auditDir).filter((name) => /^audit-\d{8}\.jsonl$/u.test(name)) : []
    pass('c) 审计按日文件存在(audit-YYYYMMDD.jsonl)', auditFiles.length > 0, auditFiles.join(', ') || 'no audit file')
    const records = auditFiles.flatMap((name) => readFileSync(join(auditDir, name), 'utf8').split('\n').filter((line) => line.length > 0).map((line) => JSON.parse(line)))
    const governanceRecords = records.filter((record) => record.kind === 'governance')
    pass('c) 治理决策直投记录(kind=governance,detail.source=glue-egress,tool=web_fetch,decision=deny)',
      governanceRecords.some((record) => record.detail?.source === 'glue-egress' && record.detail?.tool === 'web_fetch' && record.detail?.decision === 'deny'),
      `${governanceRecords.length} governance record(s)`)
    const toolCallRecords = records.filter((record) => record.kind === 'tool-call' && record.tool === 'web_fetch')
    pass('c) 被拒调用留痕(tool-call isError=true,argsPreview 含 deny-me)',
      toolCallRecords.some((record) => record.isError === true && String(record.argsPreview ?? '').includes('deny-me')),
      `${toolCallRecords.length} web_fetch tool-call record(s)`)
    pass('c) 放行调用留痕(tool-call isError=false)', toolCallRecords.some((record) => record.isError === false))
    pass('c) turn-end 留痕', records.some((record) => record.kind === 'turn-end'), `${records.length} record(s) total`)
  }
} finally {
  embedToggle.restore() // 读写备份还原兜底:无论成败,materialized patch 回到原始字节
}

// d) embed 卸载跑:patch 已还原(无 insert 行)→ 同任务 → 治理行为与审计痕迹全部消失。
{
  const ws2 = mkdtempSync(join(tmpdir(), 'gov-e2e-embed-unmounted-'))
  console.log(`verify-governance-e2e: [embed unmounted] contrast session (cwd=${ws2})`)
  const unmounted = await runHeadless(TASK, ws2)
  const un = parseNdjson(unmounted.lines).events
  const unFinal = un.findLast((event) => event.type === 'final')
  const unReasonKind = typeof unFinal?.reason?.kind === 'string' ? unFinal.reason.kind : null
  if (unmounted.timedOut || (unReasonKind !== null && !CLEAN_STOP_KINDS.has(unReasonKind))) {
    console.error(`[diag] unmounted final.reason = ${JSON.stringify(unFinal?.reason)}`)
    console.error('--- dsh stderr tail (unmounted) ---')
    console.error(unmounted.stderrTail.slice(-4000))
  }
  const unResults = toolResultsOf(un)
  pass('d) embed 卸载跑:任何 tool_result 无 egress 拒绝标记(治理监听器已不在)',
    unResults.every((result) => !textOf(result).includes('[egress]') && !textOf(result).includes('不在出网域名白名单')),
    `${unResults.length} result(s) checked`)
  pass('d) embed 卸载跑:/deny-me 被真抓取(治理不在 → 同一 URL 直达底层)', (hits.get('/deny-me') ?? 0) >= 1,
    `hits=${hitSummary()}`)
  const ws2Eterna = join(ws2, '.eterna')
  const ws2Audit = existsSync(ws2Eterna) ? readdirSync(ws2Eterna).filter((name) => /^audit-\d{8}\.jsonl$/u.test(name)) : []
  pass('d) embed 卸载跑:无审计落盘(audit 插件已卸,ctx.audit 缺席)', ws2Audit.length === 0,
    ws2Audit.length === 0 ? 'no audit file' : ws2Audit.join(', '))
  pass('d) embed 卸载跑正常退出(exit 0 = 任务完成)', unmounted.code === 0, `exit=${unmounted.code}`)
}

// ---------------------------------------------------------------------------
// 5. web 档(model-free):挂载 boot → inventory 三行 active → 还原 → 无 eterna-* 残留。

const webPatch = materializeProfile('eterna-web', ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app'])
const webToggle = patchToggler(webPatch)

try {
  webToggle.mount()
  console.log('verify-governance-e2e: [web mounted] boot + pluginInventory/list probe')
  const { child, output, ready } = bootWeb()
  const readiness = await ready
  if (!readiness.url) {
    await stop(child)
    pass('d) web 档挂载 boot 就绪', false, readiness.timedOut ? `no readiness line within ${BOOT_TIMEOUT_MS}ms` : `dsh exited early (code ${readiness.exitCode}): ${output.join('').slice(-600)}`)
  } else {
    const probe = await probeInventory(readiness.url)
    await stop(child)
    if (!probe.ok) {
      pass('d) web 档挂载 inventory 探测', false, JSON.stringify(probe.error))
    } else {
      const snapshot = probe.value
      const hostByEntry = new Map(snapshot.entries.map((entry) => [entry.entryId.replace(/^include:/, ''), entry]))
      const failed = snapshot.entries.filter((entry) => entry.fiberPhase === 'failed')
      pass('d) web 档挂载 boot:0 个 failed 条目(挂载未引入注入断链)', failed.length === 0,
        failed.map((entry) => `${entry.entryId}: ${entry.diagnostic ?? 'failed'}`).join(' | ') || `${snapshot.entries.length} entries settled`)
      const mountedRows = MOUNT_ROWS.map((row) => {
        const entry = hostByEntry.get(row.id)
        return `${row.id}=${entry === undefined ? 'absent' : `${entry.enabled ? 'enabled' : 'disabled'}/${entry.fiberPhase ?? 'no-fiber'}`}`
      }).join(' ')
      pass('d) web 档挂载 boot:eterna-governance/eterna-audit/eterna-egress 全部 present+enabled+active',
        MOUNT_ROWS.every((row) => {
          const entry = hostByEntry.get(row.id)
          return entry !== undefined && entry.enabled === true && entry.fiberPhase === 'active'
        }),
        mountedRows)
    }
  }
} finally {
  webToggle.restore() // 卸载跑之前必须回到原始字节(= 移除 insert 行)
}

{
  console.log('verify-governance-e2e: [web unmounted] boot + pluginInventory/list probe')
  const { child, output, ready } = bootWeb()
  const readiness = await ready
  if (!readiness.url) {
    await stop(child)
    pass('d) web 档卸载 boot 就绪', false, readiness.timedOut ? `no readiness line within ${BOOT_TIMEOUT_MS}ms` : `dsh exited early (code ${readiness.exitCode}): ${output.join('').slice(-600)}`)
  } else {
    const probe = await probeInventory(readiness.url)
    await stop(child)
    if (!probe.ok) {
      pass('d) web 档卸载 inventory 探测', false, JSON.stringify(probe.error))
    } else {
      const snapshot = probe.value
      const hostByEntry = new Map(snapshot.entries.map((entry) => [entry.entryId.replace(/^include:/, ''), entry]))
      const residue = [...hostByEntry.keys()].filter((id) => id.startsWith('eterna-'))
      pass('d) web 档卸载 boot:无任何 eterna-* 条目(effect 逆闭包,无 @eterna 残留)', residue.length === 0,
        residue.length === 0 ? `${snapshot.entries.length} entries, none eterna-*` : residue.join(', '))
      const failed = snapshot.entries.filter((entry) => entry.fiberPhase === 'failed')
      pass('d) web 档卸载 boot:0 个 failed 条目', failed.length === 0,
        failed.map((entry) => `${entry.entryId}: ${entry.diagnostic ?? 'failed'}`).join(' | ') || `${snapshot.entries.length} entries settled`)
    }
  }
}

// ---------------------------------------------------------------------------

server.closeAllConnections()
server.close()
console.log(failures.length === 0
  ? 'verify-governance-e2e: OK — deny/allow/审计落痕/两档装卸无残留 全部通过'
  : `verify-governance-e2e: FAILED — ${failures.join('; ')}`)
process.exitCode = failures.length === 0 ? 0 : 1
