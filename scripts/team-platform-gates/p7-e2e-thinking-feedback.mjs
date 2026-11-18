// P7 E2E(2026-11-18):思考强度判档 V2 全链——自动开启默认 / 寒暄落低档 /
// 代码排查落高档 / 显式反馈「想浅点·想深点」改变下一轮判档 / 偏置经反向抵消归零
// / 容器重启后偏置仍在(users.db 硬证据) / 深浅两主题动作条截图。
//
// 运行边界(脚本开头硬断言,先于任何 docker 调用):
//   - 只操作专用测试容器(默认 eterna-tp-think)与专用卷(默认 eterna-think-e2e-data);
//   - 拒绝生产容器 eterna-agent、生产端口 3210/9310、生产域名 eternity-electricity.cn;
//   - 拒绝挂载生产卷 eterna-home 的容器;docker restart 只针对测试容器。
//
// 被测代码口径:本脚本针对**指定 SHA 的干净 worktree**(--sha;缺省 HEAD),要求该 SHA
// 含判档 V2 的三分支 thinkingFeedback:只读(不带 direction)/ ±0.2(less|more)/
// 清零(reset)。偏置读取同时走容器内 users.db(node:sqlite)交叉验证;菜单偏置行
// (chip + 两击重置)也在验收内。若被测 SHA 仍是旧版(无 read/reset 支),相关判据
// 会明确 FAIL 并提示重建基线——不再静默跳过。
//
// 用法(凭据只从环境变量或专用 env-file 读,绝不打印):
//   ETERNA_ACCESS_ADMIN_USER=... ETERNA_ACCESS_ADMIN_PASSWORD=... \
//   THINK_E2E_BASE=http://127.0.0.1:3213 \
//   node scripts/team-platform-gates/p7-e2e-thinking-feedback.mjs --bootstrap
//
// 必需:ETERNA_ACCESS_ADMIN_USER / ETERNA_ACCESS_ADMIN_PASSWORD
//       (或 --env-file / THINK_E2E_ENV_FILE 指向的 chmod 600 测试 env-file)
// 可选:THINK_E2E_BASE(默认 http://127.0.0.1:3213)
//       THINK_E2E_CONTAINER(默认 eterna-tp-think)
//       THINK_E2E_MOCK_PORT(默认 8099)、THINK_E2E_VOLUME、THINK_E2E_SHA、
//       THINK_E2E_PROVIDER / THINK_E2E_MODEL(默认 mimo / mimo-v2.6-pro)
// 开关:--bootstrap(从干净 worktree 重建镜像并起专用容器)/ --keep(失败也不清理)
//       --skip-restart / --real-models / --rebuild / --base / --container /
//       --env-file / --sha / --image / --mock-port / --help
// 退出码:0=全过;1=断言或环境失败;2=用法/配置/安全边界错误。
import { createRequire } from 'node:module'
import {
  readdirSync, readFileSync, writeFileSync, mkdirSync, rmSync, existsSync, chmodSync, mkdtempSync,
} from 'node:fs'
import { execFileSync } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { tmpdir } from 'node:os'
import { join, resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO = resolve(HERE, '../..')
const OUT = join(REPO, 'acceptance/team-platform/p7/evidence/thinking-feedback')
const SHOTS = join(REPO, 'gui-test-screenshots/thinking-feedback-1118')
const BROWSER_REPO = process.env.THINK_E2E_BROWSER_REPO ?? REPO

// ── 参数与配置(先解析,再用错误码 2 挡住缺凭据/越界目标) ────────────────
const argv = process.argv.slice(2)
const pick = (k) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : undefined }
const flag = (k) => argv.includes(k)

function usage(reason, code = 2) {
  if (reason !== undefined && reason !== null) console.error('用法错误：' + reason)
  console.error(`
Eterna 思考强度判档 V2（p7）浏览器 E2E —— 只对专用测试容器，绝不碰生产。

必需环境变量（凭据只入进程内存，不打印、不落 argv）:
  ETERNA_ACCESS_ADMIN_USER       专用测试容器的首启播种账号（勿复用生产 Mr.Ma）
  ETERNA_ACCESS_ADMIN_PASSWORD   同上密码
  也可用 --env-file <path> 或 THINK_E2E_ENV_FILE=<path> 指向 chmod 600 的测试 env-file
  （文件内同样需要上述两个键；进程环境变量优先）

可选环境变量:
  THINK_E2E_BASE        默认 http://127.0.0.1:3213（只允许本机回环地址）
  THINK_E2E_CONTAINER   默认 eterna-tp-think
  THINK_E2E_MOCK_PORT   默认 8099（容器内 mock LLM 端口）
  THINK_E2E_VOLUME      默认 eterna-think-e2e-data（禁止 eterna-home）
  THINK_E2E_SHA         默认主仓 git HEAD（--bootstrap 时按此 sha 建干净 worktree）
  THINK_E2E_PROVIDER / THINK_E2E_MODEL  默认 mimo / mimo-v2.6-pro
  THINK_E2E_ACCESS_SECRET   可选：固定测试签名密钥（默认每次运行新生成，绝不继承生产值）
  THINK_E2E_MIMO_API_KEY / THINK_E2E_DEEPSEEK_API_KEY / THINK_E2E_BIGMODEL_API_KEY /
  THINK_E2E_OPENDESIGN_API_KEY / THINK_E2E_RELAY_TOKEN  可选：显式提供，默认留空

开关:
  --bootstrap       从干净 worktree 重建镜像并启动专用测试容器（需 Docker + registry）
  --keep            保留容器/卷/worktree 供复查（默认仅在 --bootstrap 自建时清理）
  --skip-restart    跳过「容器重启后偏置仍在」一段
  --real-models     不启用 mock，直接用 env-file 里的真实 MIMO key（少量真实调用）
  --rebuild         即使同 sha 镜像已存在也重建
  --base / --container / --env-file / --sha / --image / --mock-port / --help

示例:
  ETERNA_ACCESS_ADMIN_USER=e2e-admin ETERNA_ACCESS_ADMIN_PASSWORD=*** \\
    node scripts/team-platform-gates/p7-e2e-thinking-feedback.mjs --bootstrap

  node scripts/team-platform-gates/p7-e2e-thinking-feedback.mjs \\
    --base http://127.0.0.1:3213 --container eterna-tp-think

退出码:0=全过;1=断言/环境失败;2=用法/配置/安全边界错误。
`)
  process.exit(code)
}
if (flag('--help') || flag('-h')) usage(null, 0)

const BASE = (pick('--base') ?? process.env.THINK_E2E_BASE ?? 'http://127.0.0.1:3213').replace(/\/+$/u, '')
const CONTAINER = pick('--container') ?? process.env.THINK_E2E_CONTAINER ?? 'eterna-tp-think'
const VOLUME = pick('--volume') ?? process.env.THINK_E2E_VOLUME ?? 'eterna-think-e2e-data'
const ENV_FILE = pick('--env-file') ?? process.env.THINK_E2E_ENV_FILE ?? null
const MOCK_PORT = Number(pick('--mock-port') ?? process.env.THINK_E2E_MOCK_PORT ?? 8099)
const BOOTSTRAP = flag('--bootstrap')
const KEEP = flag('--keep')
const SKIP_RESTART = flag('--skip-restart')
const MOCK = !flag('--real-models')
const REBUILD = flag('--rebuild')
const PROVIDER = process.env.THINK_E2E_PROVIDER ?? 'mimo'
const MODEL = process.env.THINK_E2E_MODEL ?? 'mimo-v2.6-pro'
const SHA_ARG = pick('--sha') ?? process.env.THINK_E2E_SHA ?? null
const IMAGE_ARG = pick('--image') ?? process.env.THINK_E2E_IMAGE ?? null

// ── 安全边界(硬断言:先于一切 docker/浏览器动作) ────────────────────────
function configFail(message, hint) {
  console.error('安全/配置错误：' + message)
  if (hint !== undefined) console.error('提示：' + hint)
  process.exit(2)
}

if (CONTAINER === 'eterna-agent' || CONTAINER.includes('eterna-agent')) {
  configFail(`--container=${CONTAINER} 命中生产容器名，拒绝继续`, '请使用专用测试容器名（默认 eterna-tp-think）')
}
if (/eterna-home/u.test(VOLUME)) {
  configFail(`--volume=${VOLUME} 命中生产卷名，拒绝继续`, '生产数据全在 agent-basis_eterna-home；测试请用独立卷')
}
let parsedBase
try { parsedBase = new URL(BASE) } catch { usage(`THINK_E2E_BASE 不是合法 URL：${BASE}`) }
if (parsedBase.protocol !== 'http:' && parsedBase.protocol !== 'https:') {
  configFail('THINK_E2E_BASE 只支持 http/https')
}
if (parsedBase.username !== '' || parsedBase.password !== '') {
  configFail('THINK_E2E_BASE 不得内嵌账号密码')
}
const BASE_HOST = parsedBase.hostname
const LOOPBACK = new Set(['127.0.0.1', 'localhost', '::1', '[::1]'])
if (!LOOPBACK.has(BASE_HOST)) {
  configFail(`THINK_E2E_BASE 只允许本机回环地址，当前 host=${BASE_HOST}`,
    '本脚本只与本机专用测试容器通信，绝不连生产/远端')
}
const HOST_PORT = parsedBase.port === '' ? (parsedBase.protocol === 'https:' ? '443' : '80') : parsedBase.port
if (HOST_PORT === '3210' || HOST_PORT === '9310') {
  configFail(`--base 端口 ${HOST_PORT} 是生产端口（3210 web / 9310 companion relay），拒绝继续`,
    '专用测试容器请映射到空闲端口（本次方案用 3213）')
}
if (BASE_HOST.endsWith('eternity-electricity.cn')) {
  configFail('--base 命中生产域名 eternity-electricity.cn，拒绝继续')
}
if (!Number.isInteger(MOCK_PORT) || MOCK_PORT < 1 || MOCK_PORT > 65535) {
  usage(`THINK_E2E_MOCK_PORT 非法：${String(MOCK_PORT)}`)
}
if (MOCK_PORT === 3210 || MOCK_PORT === 9310) {
  configFail(`mock 端口 ${MOCK_PORT} 是生产端口，拒绝继续`)
}

// ── 凭据装载(进程环境变量优先;其次专用 env-file;缺任一键 ⇒ 中文用法 + exit 2) ──
function parseEnvText(text) {
  const map = new Map()
  for (const rawLine of text.split(/\r?\n/u)) {
    const line = rawLine.trim()
    if (line === '' || line.startsWith('#')) continue
    const m = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/u.exec(line)
    if (m === null) continue
    let value = m[2].trim()
    if (value.length >= 2
      && ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'")))) {
      value = value.slice(1, -1)
    }
    map.set(m[1], value)
  }
  return map
}

let fileEnv = new Map()
if (ENV_FILE !== null && existsSync(ENV_FILE)) {
  try { fileEnv = parseEnvText(readFileSync(ENV_FILE, 'utf8')) } catch (error) {
    configFail(`无法读取 --env-file：${ENV_FILE}`, String(error?.message ?? error))
  }
}
const CREDS = {
  user: process.env.ETERNA_ACCESS_ADMIN_USER ?? fileEnv.get('ETERNA_ACCESS_ADMIN_USER') ?? '',
  password: process.env.ETERNA_ACCESS_ADMIN_PASSWORD ?? fileEnv.get('ETERNA_ACCESS_ADMIN_PASSWORD') ?? '',
}
if (CREDS.user === '' || CREDS.password === '') {
  usage('缺少 ETERNA_ACCESS_ADMIN_USER / ETERNA_ACCESS_ADMIN_PASSWORD（进程环境或 --env-file 均未提供）')
}
if (/[\r\n]/u.test(CREDS.user) || /[\r\n]/u.test(CREDS.password)) {
  configFail('凭据中出现换行符，拒绝写入 env-file')
}
if (!MOCK && !fileEnv.get('MIMO_API_KEY') && !process.env.MIMO_API_KEY && !process.env.THINK_E2E_MIMO_API_KEY) {
  configFail('--real-models 需要 env-file/环境变量提供 MIMO_API_KEY（或 THINK_E2E_MIMO_API_KEY）')
}

mkdirSync(OUT, { recursive: true })
mkdirSync(SHOTS, { recursive: true })

// ── 运行时状态(失败时也要能落盘/诊断) ──────────────────────────────────
const checks = {}
let ctx = null
let page = null
let createdContainer = false
let createdWorktree = false
let image = IMAGE_ARG ?? '(未构建/外部镜像)'
let buildSha = SHA_ARG ?? '(未指定)'
let worktreeDir = null
let generatedEnvFile = null
let browserProfileDir = null
let containerImage = null
let failureShot = null
let failureLog = null
const audits = { feedback: [], auto: [], provisioned: false }
const dbSnapshots = {}
const screenshots = []
const badFeedbackResponses = []
let sessionId = null
let efforts = []
let effortsIds = []
let modelLabel = null

class CheckFailure extends Error {
  constructor(id, message, detail = {}) {
    super(message)
    this.id = id
    this.detail = detail
  }
}

/** 单条判据:记录后立即抛出(失败即停,保留此前证据)。 */
function check(id, ok, detail = {}) {
  checks[id] = {
    ok: Boolean(ok),
    ...(detail.expect !== undefined ? { expect: detail.expect } : {}),
    ...(detail.actual !== undefined ? { actual: detail.actual } : {}),
    ...(detail.hint !== undefined ? { hint: detail.hint } : {}),
  }
  if (!ok) {
    throw new CheckFailure(
      id,
      detail.message ?? `${id} 未通过（expect=${JSON.stringify(detail.expect ?? null)} actual=${JSON.stringify(detail.actual ?? null)}）`,
      detail,
    )
  }
}

/** 非阻断观测(截图/可选 UI 面):失败只记一条证据,不终止。 */
function softCheck(id, ok, detail = {}) {
  checks[id] = {
    ok: Boolean(ok),
    soft: true,
    ...(detail.expect !== undefined ? { expect: detail.expect } : {}),
    ...(detail.actual !== undefined ? { actual: detail.actual } : {}),
    ...(detail.hint !== undefined ? { hint: detail.hint } : {}),
  }
  return Boolean(ok)
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const near = (a, b, eps = 0.03) => typeof a === 'number' && Number.isFinite(a) && Math.abs(a - b) <= eps

// ── docker 薄封装(所有容器动作都带测试容器名;生产名已在前面硬拒) ─────────
function docker(argvList, opts = {}) {
  return execFileSync('docker', argvList, {
    encoding: 'utf8', maxBuffer: 128 * 1024 * 1024, ...opts,
  }).trim()
}
function shIn(script) {
  return docker(['exec', CONTAINER, 'sh', '-c', script])
}
function containerState(name) {
  try {
    return docker(['inspect', '-f', '{{.State.Running}}', name]) === 'true' ? 'running' : 'stopped'
  } catch (error) {
    const text = String(error?.stderr ?? error?.message ?? error)
    if (/no such object|no such container|not found/iu.test(text)) return 'missing'
    throw error
  }
}
function git(argsList, cwd = REPO) {
  return execFileSync('git', argsList, { cwd, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 }).trim()
}

/** 容器挂载面硬检查:任何 eterna-home 生产卷都拒绝。 */
function assertNoProductionMounts() {
  let mounts = ''
  try { mounts = docker(['inspect', '-f', '{{range .Mounts}}{{.Name}}\n{{end}}', CONTAINER]) } catch { return }
  if (/eterna-home/u.test(mounts)) {
    configFail(`容器 ${CONTAINER} 挂载了生产卷（${mounts.split('\n').filter(Boolean).join(', ')}），拒绝继续`,
      '请用独立测试卷重建容器（--bootstrap 默认 eterna-think-e2e-data）')
  }
}

// ── mock LLM(OpenAI-compatible SSE;零外部请求) ─────────────────────────
const MOCK_SOURCE = `import { createServer } from 'node:http'
const port = Number(process.env.MOCK_PORT ?? 8099)
const sendJson = (res, status, obj) => {
  res.writeHead(status, { 'content-type': 'application/json' })
  res.end(JSON.stringify(obj))
}
const server = createServer((req, res) => {
  let body = ''
  req.on('data', (chunk) => { body += chunk })
  req.on('end', () => {
    const url = req.url ?? ''
    if (url.startsWith('/v1/models')) {
      sendJson(res, 200, { object: 'list', data: [{ id: 'mimo-v2.6-pro', object: 'model' }] })
      return
    }
    if (!url.includes('/chat/completions')) {
      sendJson(res, 404, { error: { message: 'mock: unsupported path ' + url } })
      return
    }
    let parsed = {}
    try { parsed = JSON.parse(body) } catch { parsed = {} }
    const model = typeof parsed.model === 'string' ? parsed.model : 'mimo-v2.6-pro'
    const created = Math.floor(Date.now() / 1000)
    if (parsed.stream === false) {
      sendJson(res, 200, {
        id: 'chatcmpl-mock', object: 'chat.completion', created, model,
        choices: [{ index: 0, message: { role: 'assistant', content: '收到。', reasoning_content: '' }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
      })
      return
    }
    res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' })
    const base = { id: 'chatcmpl-mock', object: 'chat.completion.chunk', created, model }
    const emit = (delta, finish) => {
      res.write('data: ' + JSON.stringify({ ...base, choices: [{ index: 0, delta, finish_reason: finish }] }) + '\\n\\n')
    }
    emit({ role: 'assistant', content: '', reasoning_content: '' }, null)
    emit({ content: '收到。' }, null)
    emit({}, 'stop')
    // include_usage 形态:choices 为空的末块(部分 OpenAI-compatible 客户端要求)
    res.write('data: ' + JSON.stringify({
      ...base, choices: [], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
    }) + '\\n\\n')
    res.write('data: [DONE]\\n\\n')
    res.end()
  })
})
server.listen(port, '127.0.0.1')
`

const DB_SOURCE = `import { DatabaseSync } from 'node:sqlite'
const sessionId = process.argv[2] ?? ''
const db = new DatabaseSync('/data/access/users.db', { readOnly: true })
try {
  const row = db.prepare('SELECT thinking_auto, thinking_bias, thinking_bias_at FROM sessions WHERE session_id = ?').get(sessionId)
  process.stdout.write(JSON.stringify(row ?? null))
} finally {
  db.close()
}
`

function mockReady() {
  try {
    shIn(`curl -sf -m 2 http://127.0.0.1:${MOCK_PORT}/v1/models >/dev/null`)
    return true
  } catch { return false }
}

async function ensureMock(timeoutMs = 30_000) {
  if (!MOCK) return
  if (mockReady()) return
  const mockPath = join(OUT, 'mock-llm.mjs')
  writeFileSync(mockPath, MOCK_SOURCE)
  docker(['cp', mockPath, `${CONTAINER}:/tmp/mock-llm.mjs`])
  // 落 /tmp/mock.log:docker exec -d 的输出不进 docker logs,失败时要能取证。
  docker(['exec', '-d', '-e', `MOCK_PORT=${MOCK_PORT}`, CONTAINER, 'sh', '-c',
    'node /tmp/mock-llm.mjs >/tmp/mock.log 2>&1'])
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    await sleep(500)
    if (mockReady()) return
  }
  let mockLog = ''
  try { mockLog = shIn('cat /tmp/mock.log 2>/dev/null || true').slice(-1200) } catch { mockLog = '' }
  throw new CheckFailure('mock.start', `mock LLM 未在 ${timeoutMs}ms 内就绪（容器内 127.0.0.1:${MOCK_PORT}）`, {
    actual: mockLog,
    hint: '检查 /tmp/mock.log；--mock 模式要求容器以改版 profile 模板启动（mimo baseURL→127.0.0.1:8099）',
  })
}

// ── 审计读取(实际落盘形态:governance 包 access.tenant / access.thinking.auto) ──
function auditRecords() {
  let file = ''
  try {
    file = shIn("ls -t /data/.eterna/audit-*.jsonl 2>/dev/null | head -1")
  } catch { return [] }
  if (file === '') return []
  let text = ''
  try { text = shIn(`tail -n 2000 ${JSON.stringify(file)}`) } catch { return [] }
  const records = []
  for (const line of text.split('\n')) {
    if (line.trim() === '') continue
    try { records.push(JSON.parse(line)) } catch { /* 末行半写:跳过 */ }
  }
  return records
}
const isAutoRecord = (r) => r?.detail?.kind === 'access.thinking.auto' && r?.detail?.ok !== false
const isFeedbackRecord = (r) => r?.detail?.kind === 'access.tenant'
  && r?.detail?.detail?.action === 'thinking.feedback'
const autoOf = (sid) => auditRecords().filter(isAutoRecord)
  .filter((r) => sid === undefined || r.detail?.detail?.sessionId === sid)
const feedbackOf = (sid) => auditRecords().filter(isFeedbackRecord)
  .filter((r) => sid === undefined || r.detail?.detail?.sessionId === sid)

function autoPayload(record) {
  const d = record?.detail?.detail ?? {}
  return {
    at: record?.at ?? null,
    sessionId: d.sessionId ?? null,
    provider: d.provider ?? null,
    model: d.model ?? null,
    score: typeof d.score === 'number' ? d.score : null,
    effort: typeof d.effort === 'string' ? d.effort : null,
    efforts: typeof d.efforts === 'number' ? d.efforts : null,
    bias: typeof d.signals?.bias === 'number' ? d.signals.bias : null,
    previousEffortRank: typeof d.signals?.previousEffortRank === 'number' ? d.signals.previousEffortRank : null,
    signals: d.signals ?? null,
  }
}
function feedbackPayload(record) {
  const d = record?.detail?.detail ?? {}
  return {
    at: record?.at ?? null,
    account: record?.detail?.account ?? null,
    sessionId: d.sessionId ?? null,
    messageId: d.messageId ?? null,
    direction: d.direction ?? null,
    bias: typeof d.bias === 'number' ? d.bias : null,
    effectiveBias: typeof d.effectiveBias === 'number' ? d.effectiveBias : null,
  }
}

async function waitAutoSince(beforeCount, sid, timeoutMs = 20_000, accept = () => true) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const list = autoOf(sid).map(autoPayload)
    if (list.length > beforeCount) {
      for (let i = beforeCount; i < list.length; i++) {
        if (accept(list[i])) return list[i]
      }
    }
    await sleep(600)
  }
  return null
}
async function waitFeedbackSince(beforeCount, sid, direction, timeoutMs = 10_000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const list = feedbackOf(sid).map(feedbackPayload)
    for (let i = beforeCount; i < list.length; i++) {
      if (direction === undefined || list[i].direction === direction) return list[i]
    }
    await sleep(500)
  }
  return null
}

// ── users.db 读取(容器内 node:sqlite;无读 RPC,库是唯一硬证据) ─────────
async function readDb(sid) {
  const raw = docker(['exec', CONTAINER, 'node', '/tmp/p7-db.mjs', sid])
  return raw === '' ? null : JSON.parse(raw)
}
async function waitDbRow(sid, predicate, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs
  let last = null
  while (Date.now() < deadline) {
    try { last = await readDb(sid) } catch { last = null }
    if (predicate(last)) return last
    await sleep(700)
  }
  return last
}

// ── 浏览器工具(复用主仓 playwright-core + CfT chromium,不装依赖) ────────
function findChromiumBinary(dir, depth = 12) {
  if (depth < 0 || !existsSync(dir)) return null
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name)
    if (entry.isDirectory()) {
      const r = findChromiumBinary(p, depth - 1)
      if (r !== null) return r
    } else if (p.endsWith('/Chromium.app/Contents/MacOS/Chromium') || p.endsWith('/chrome')) {
      return p
    }
  }
  return null
}

function loadChromium() {
  const req = createRequire(join(BROWSER_REPO, 'packages/browser-relay/package.json'))
  let chromium
  try { ({ chromium } = req('playwright-core')) } catch (error) {
    throw new CheckFailure('browser.deps', '找不到 playwright-core（主仓 packages/browser-relay/node_modules）', {
      hint: String(error?.message ?? error),
    })
  }
  const chrome = findChromiumBinary(join(BROWSER_REPO, 'packages/browser-relay/smoke/.browsers/chromium'))
  if (chrome === null) {
    throw new CheckFailure('browser.chrome', '找不到 CfT chromium（主仓 packages/browser-relay/smoke/.browsers）', {
      hint: '本脚本不安装依赖；请复用主仓已装浏览器',
    })
  }
  return { chromium, chrome }
}

async function probeLogin(timeoutMs = 180_000) {
  const deadline = Date.now() + timeoutMs
  let lastError = null
  while (Date.now() < deadline) {
    try {
      const r = await fetch(BASE + '/login')
      if (r.ok) return true
      lastError = `HTTP ${r.status}`
    } catch (error) { lastError = String(error?.message ?? error) }
    await sleep(3000)
  }
  throw new CheckFailure('container.ready', `容器 /login 在 ${timeoutMs}ms 内未就绪`, {
    actual: lastError,
    hint: `检查 docker ps/logs；容器名=${CONTAINER}，base=${BASE}`,
  })
}

async function login(tag = 'login') {
  await page.goto(BASE + '/login', { waitUntil: 'networkidle' })
  if (await page.locator('#account').isVisible({ timeout: 3000 }).catch(() => false)) {
    await page.fill('#account', CREDS.user)
    await page.fill('#password', CREDS.password)
    await page.click('#go')
    const deadline = Date.now() + 20_000
    while (Date.now() < deadline && String(page.url()).includes('/login')) await sleep(500)
  }
  await sleep(2500)
  if (String(page.url()).includes('/login')) {
    const msg = (await page.locator('#msg').textContent().catch(() => '')) ?? ''
    throw new CheckFailure(tag, '登录失败或停留在 /login', {
      actual: { url: page.url(), message: msg.slice(0, 200) },
      hint: '凭据必须与目标容器首启播种值一致；专用容器勿复用生产凭据',
    })
  }
}

async function waitComposer(timeoutMs = 60_000) {
  const selectors = [
    'textarea',
    '[data-composer-input="true"][contenteditable="true"]',
    '[contenteditable="true"]',
    '[contenteditable="plaintext-only"]',
  ]
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    for (const sel of selectors) {
      const all = page.locator(sel)
      const n = await all.count()
      for (let i = n - 1; i >= 0; i--) {
        const cand = all.nth(i)
        if (await cand.isVisible().catch(() => false)) return cand
      }
    }
    await sleep(800)
  }
  await safeShot('failure-no-composer.png')
  throw new CheckFailure('ui.composer', `找不到会话输入框（${timeoutMs}ms）`, {
    actual: { url: page.url(), title: await page.title().catch(() => '') },
  })
}

async function sendMessage(text) {
  const composer = await waitComposer()
  await composer.click()
  await composer.fill(text)
  await composer.press('Enter')
  await sleep(300)
}

async function feedbackCount() {
  return page.locator('[data-eterna-think-feedback]').count()
}

async function waitAssistant(beforeCount, label, timeoutMs = 150_000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const n = await feedbackCount()
    if (n > beforeCount) { await sleep(300); return n }
    if (String(page.url()).includes('/login')) {
      throw new CheckFailure('ui.session', `${label}:会话被踢回登录页`, { actual: page.url() })
    }
    await sleep(1000)
  }
  await safeShot('failure-no-assistant.png')
  throw new CheckFailure('ui.assistant', `${label}:${timeoutMs}ms 内未出现 finalized assistant 消息动作条`, {
    actual: {
      url: page.url(),
      feedbackCount: await feedbackCount().catch(() => -1),
      turnTails: await page.locator('[data-turn-tail]').count().catch(() => -1),
      localStorageSession: await readSessionId(),
    },
    hint: 'mock 模式下确认容器 profile 的 mimo baseURL 指向容器内 mock（--bootstrap 自动处理）；也检查客户端 bundle 是否含 data-eterna-think-feedback。若 pi-ai 对 requiresReasoningContentOnAssistantMessages 的校验拒绝 mock 消息，可改用 --real-models',
  })
}

/** 发一条消息并等 assistant 动作条出现;返回发送前的审计/动作条计数。 */
async function sendTurn(text, label) {
  const beforeAssistant = await feedbackCount()
  const beforeAuto = autoOf(sessionId).length
  const beforeFeedback = feedbackOf(sessionId).length
  await sendMessage(text)
  await waitAssistant(beforeAssistant, label)
  return { beforeAuto, beforeFeedback }
}

async function readSessionId() {
  return page.evaluate(() => {
    try {
      const raw = localStorage.getItem('dsh.sessions.current')
      if (raw === null) return null
      const parsed = JSON.parse(raw)
      return typeof parsed?.sessionId === 'string' ? parsed.sessionId : null
    } catch { return null }
  }).catch(() => null)
}

async function ensureSession() {
  await waitComposer()
  let sid = await readSessionId()
  if (sid !== null) return sid
  // 登录后客户端未置位当前会话:先发一条消息让它落座,再读持久化键。
  const before = await feedbackCount()
  await sendMessage('你好')
  await waitAssistant(before, 'bootstrap-session')
  const deadline = Date.now() + 30_000
  while (Date.now() < deadline) {
    sid = await readSessionId()
    if (sid !== null) return sid
    await sleep(500)
  }
  throw new CheckFailure('ui.sessionId', '发送首条消息后 localStorage[dsh.sessions.current].sessionId 仍为空', {
    actual: { url: page.url() },
    hint: '客户端未落座会话；确认登录开通（workspace.provision）与客户端 bundle 正常',
  })
}

async function safeShot(name, target = page) {
  if (target === null) return null
  try {
    const path = join(OUT, name)
    await target.screenshot({ path, fullPage: true })
    return path
  } catch { return null }
}

/** typert 同构 RPC(与客户端 model-menu/thinking-feedback 同信封)。 */
async function rpc(method, argsObj) {
  return page.evaluate(async ({ method, argsObj }) => {
    const body = JSON.stringify({
      type: 'client-request',
      rpcId: 'p7-' + crypto.randomUUID(),
      method: 'session/' + method,
      payload: { args: argsObj },
    })
    const r = await fetch('/api/session/' + method, {
      method: 'POST', credentials: 'same-origin',
      headers: { 'content-type': 'application/json' }, body,
    })
    const d = await r.json().catch(() => null)
    return { status: r.status, ok: d?.result?.ok === true, value: d?.result?.value ?? null, error: d?.result?.error ?? null }
  }, { method, argsObj })
}

async function loadCatalogAndEfforts() {
  const catalog = await rpc('modelCatalog', {})
  if (!catalog.ok) {
    throw new CheckFailure('catalog.read', '读取 /api/session/modelCatalog 失败', { actual: catalog })
  }
  const groups = catalog.value?.groups ?? []
  const aria = await page.locator('button[aria-label^="选择模型"]').first().getAttribute('aria-label').catch(() => null)
  const currentName = /当前 ([^，]+)/u.exec(aria ?? '')?.[1]?.trim() ?? null
  let model = null
  // 优先 THINK_E2E_PROVIDER/MODEL 指定的默认路由(同名模型可能出现在多个供应商组,
  // 但只有默认 mimo 路由对应 agent-default-model;档位顺序以实际路由为准)。
  for (const group of groups) {
    if (group.id !== PROVIDER) continue
    for (const candidate of group.models ?? []) {
      if (candidate.id === MODEL && (currentName === null || candidate.id === currentName || candidate.name === currentName)) {
        model = { group, model: candidate }
        break
      }
    }
    if (model !== null) break
  }
  if (model === null && currentName !== null) {
    for (const group of groups) {
      for (const candidate of group.models ?? []) {
        if (candidate.id === currentName || candidate.name === currentName) { model = { group, model: candidate }; break }
      }
      if (model !== null) break
    }
  }
  if (model === null) {
    for (const group of groups) {
      for (const candidate of group.models ?? []) {
        if (group.id === PROVIDER && candidate.id === MODEL) { model = { group, model: candidate }; break }
      }
      if (model !== null) break
    }
  }
  if (model === null) {
    throw new CheckFailure('catalog.model', `目录中找不到当前模型（trigger aria=${String(aria)}）`, {
      actual: { providers: groups.map((g) => ({ id: g.id, models: (g.models ?? []).map((m) => m.id) })) },
      hint: `检查 profile 默认模型；可用 THINK_E2E_PROVIDER/THINK_E2E_MODEL 覆盖（当前 ${PROVIDER}/${MODEL}）`,
    })
  }
  const items = model.model.reasoning?.efforts ?? []
  const ids = items.map((e) => e.id)
  if (ids.length < 2) {
    throw new CheckFailure('catalog.efforts', '当前模型没有可用档位表（自动判档会直接跳过）', {
      actual: { model: model.model.id, efforts: ids },
    })
  }
  return { model: model.model, provider: model.group.id, ids, names: items.map((e) => e.name ?? e.id), aria }
}

function rankOf(effort) {
  return effortsIds.indexOf(effort)
}

/** 自动开关 UI chip:数据库是主证据,这里只做可选可见面佐证。 */
async function checkAutoChip() {
  const trigger = page.locator('button[aria-label^="选择模型"]').first()
  if (!(await trigger.isVisible({ timeout: 5000 }).catch(() => false))) {
    return { ok: false, reason: 'model-trigger-not-visible' }
  }
  await trigger.click()
  try {
    await page.waitForSelector('[data-eterna-model-menu-root]', { timeout: 5000 })
    const chip = page.locator('[data-eterna-model-menu-root] button[aria-pressed]', { hasText: '自动' }).first()
    await chip.waitFor({ state: 'visible', timeout: 5000 })
    const pressed = await chip.getAttribute('aria-pressed')
    const text = ((await chip.textContent()) ?? '').trim()
    return { ok: pressed === 'true', pressed, text }
  } finally {
    // 菜单是 body 级 fixed 覆盖层:读取失败也必须收起,否则后续输入被挡。
    await page.keyboard.press('Escape').catch(() => {})
    await sleep(300)
  }
}

/** 点最新 assistant 动作条上的两枚按钮之一,捕获 RPC 响应。 */
async function clickFeedback(direction) {
  const span = page.locator('[data-eterna-think-feedback]').last()
  if (!(await span.isVisible({ timeout: 5000 }).catch(() => false))) {
    throw new CheckFailure('feedback.span', '最新回合没有 [data-eterna-think-feedback] 动作条', {
      actual: { count: await feedbackCount(), url: page.url() },
      hint: 'assistant-actions 只对 finalized assistant message 注入;确认模型回复成功',
    })
  }
  const label = direction === 'more' ? '想深点' : '想浅点'
  // 用位置(less=0, more=1)而不是 hasText:成功后文案会变成「已调浅/已调深」,
  // 按文案定位会在 done 态失配,读不到 data-done。
  const buttons = span.locator('button')
  const btn = buttons.nth(direction === 'more' ? 1 : 0)
  if (await buttons.count() < 2 || !(await btn.isVisible({ timeout: 3000 }).catch(() => false))) {
    throw new CheckFailure('feedback.button', `动作条里找不到「${label}」`, {
      actual: (await span.textContent().catch(() => ''))?.slice(0, 200),
    })
  }
  await span.scrollIntoViewIfNeeded().catch(() => {})
  const responsePromise = page.waitForResponse(
    (r) => r.url().includes('/api/session/thinkingFeedback') && r.request().method() === 'POST',
    { timeout: 15_000 },
  )
  await btn.click()
  const response = await responsePromise
  const status = response.status()
  const body = await response.json().catch(() => null)
  // 成功态「已调浅/已调深」只短暂停留 1.8s:立刻轮询 data-done。
  let done = false
  const deadline = Date.now() + 2000
  while (Date.now() < deadline) {
    if (await btn.getAttribute('data-done').catch(() => null) === 'true') { done = true; break }
    await sleep(100)
  }
  const buttonText = ((await btn.textContent().catch(() => '')) ?? '').trim()
  return { status, body, done, buttonText, label }
}

// ── 容器/镜像准备 ──────────────────────────────────────────────────────
function ensureDocker() {
  try { docker(['version', '--format', '{{.Server.Version}}']) } catch (error) {
    throw new CheckFailure('docker', 'Docker daemon 不可用', {
      actual: String(error?.stderr ?? error?.message ?? error).slice(0, 400),
      hint: '启动 Docker 后重试；本脚本不安装依赖',
    })
  }
}

function resolveBuildSha() {
  if (SHA_ARG !== null) return git(['rev-parse', '--verify', `${SHA_ARG}^{commit}`])
  return git(['rev-parse', 'HEAD'])
}

function prepareWorktree(sha) {
  const dir = join('/tmp', `think-e2e-${sha.slice(0, 12)}`)
  worktreeDir = dir
  if (existsSync(dir)) {
    let head = null
    try { head = git(['rev-parse', 'HEAD'], dir) } catch { head = null }
    if (head !== sha) {
      throw new CheckFailure('bootstrap.worktree', `临时 worktree ${dir} 已存在但 HEAD=${String(head)} ≠ ${sha}`, {
        hint: `删除 ${dir} 或用 --sha 指定匹配提交`,
      })
    }
  } else {
    git(['worktree', 'add', '--detach', dir, sha])
    createdWorktree = true
  }
  // 构建上下文必须干净(主仓并行未提交改动不应进入镜像)。
  const worktreeDirty = git(['status', '--porcelain'], dir)
  if (worktreeDirty !== '') {
    throw new CheckFailure('bootstrap.dirtyWorktree', `构建 worktree ${dir} 不是干净状态`, {
      actual: worktreeDirty.split('\n').slice(0, 10),
      hint: `清理该 worktree（git -C ${dir} status）后重跑，或换 --sha`,
    })
  }
  // 预检:干净 worktree 的 HEAD 必须已含 V2 客户端/路由/模板三件。
  const musts = [
    ['packages/access/src/client/thinking-feedback.tsx', 'data-eterna-think-feedback'],
    ['packages/access/src/thinking-auto.ts', 'installThinkingAuto'],
    ['packages/access/src/tenant.ts', 'thinkingFeedback'],
    ['docker/profile/cordis.patch.yml.template', 'baseURL: https://api.xiaomimimo.com/v1'],
  ]
  for (const [file, needle] of musts) {
    const full = join(dir, file)
    if (!existsSync(full) || !readFileSync(full, 'utf8').includes(needle)) {
      throw new CheckFailure('bootstrap.preflight', `提交 ${sha} 不含 V2 要素：${file} 缺 ${needle}`, {
        hint: '确认 --sha 指向含 7e34038/3dafc39 的提交',
      })
    }
  }
  return dir
}

function writeEnvFileForContainer(sourceEnv) {
  const map = new Map()
  map.set('ETERNA_ACCESS_ADMIN_USER', CREDS.user)
  map.set('ETERNA_ACCESS_ADMIN_PASSWORD', CREDS.password)
  // 签名密钥每次运行新生成(或显式 THINK_E2E_ACCESS_SECRET):绝不继承生产值。
  map.set('ETERNA_ACCESS_SECRET', process.env.THINK_E2E_ACCESS_SECRET
    ?? `think-e2e-${randomBytes(16).toString('hex')}`)
  map.set('ETERNA_PUBLIC_URL', BASE)
  // 容器同源信任根只按本次 E2E 的 loopback base 推导:不继承源 env-file 里的生产域名。
  const trustedHosts = new Set([`${BASE_HOST}:${HOST_PORT}`])
  if (BASE_HOST === '127.0.0.1' || BASE_HOST === '[::1]') trustedHosts.add(`localhost:${HOST_PORT}`)
  if (BASE_HOST === 'localhost') trustedHosts.add(`127.0.0.1:${HOST_PORT}`)
  map.set('ETERNA_TRUSTED_HOST', [...trustedHosts].join(' '))
  // 直连 http 必须留空(Secure cookie 会在 http 下不落);https 才置 1。
  map.set('ETERNA_ACCESS_SECURE', parsedBase.protocol === 'https:' ? '1' : '')
  // 本 E2E 只覆盖 base 形态(profile 目录/profiles/eterna-web 与模板口径固定)。
  map.set('ETERNA_FORM', 'base')
  if (MOCK) {
    // mock 模式强制 dummy:即使源 env-file 带真实 key,也不让它随容器环境泄漏/误用。
    map.set('MIMO_API_KEY', 'dummy-e2e')
  } else {
    const key = process.env.THINK_E2E_MIMO_API_KEY ?? process.env.MIMO_API_KEY ?? sourceEnv.get('MIMO_API_KEY') ?? ''
    if (key === '') configFail('--real-models 需要 MIMO_API_KEY')
    map.set('MIMO_API_KEY', key)
  }
  // 其余供应商 key 与 relay token 默认留空:不继承生产 .env 的凭据;需要时用 THINK_E2E_* 显式提供。
  map.set('DEEPSEEK_API_KEY', process.env.THINK_E2E_DEEPSEEK_API_KEY ?? '')
  map.set('BIGMODEL_API_KEY', process.env.THINK_E2E_BIGMODEL_API_KEY ?? '')
  map.set('OPENDESIGN_API_KEY', process.env.THINK_E2E_OPENDESIGN_API_KEY ?? '')
  map.set('ETERNA_RELAY_TOKEN', process.env.THINK_E2E_RELAY_TOKEN ?? '')
  const lines = []
  for (const [key, value] of map) {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/u.test(key)) configFail(`env-file 键名非法：${key}`)
    if (String(value).includes('\n')) configFail(`env-file 值含换行：${key}`)
    lines.push(`${key}=${value}`)
  }
  // 凭据只落 OS 临时目录(700/600),绝不写进仓库工作区;finally 无条件删除。
  const dir = mkdtempSync(join(tmpdir(), 'think-e2e-env-'))
  generatedEnvFile = join(dir, 'e2e.env')
  writeFileSync(generatedEnvFile, lines.join('\n') + '\n', { mode: 0o600 })
  chmodSync(generatedEnvFile, 0o600)
  return generatedEnvFile
}

function makeMockTemplate(wt) {
  const sourcePath = join(wt, 'docker/profile/cordis.patch.yml.template')
  const source = readFileSync(sourcePath, 'utf8')
  const needle = 'baseURL: https://api.xiaomimimo.com/v1'
  const occurrences = source.split(needle).length - 1
  if (occurrences !== 1) {
    throw new CheckFailure('bootstrap.template', `profile 模板中 mimo baseURL 出现 ${occurrences} 次（预期 1）`, {
      hint: '模板已演进；请人工确认唯一替换点后再更新脚本',
    })
  }
  const out = join(OUT, 'bootstrap', 'cordis.patch.yml.template')
  mkdirSync(dirname(out), { recursive: true })
  writeFileSync(out, source.replace(needle, `baseURL: http://127.0.0.1:${MOCK_PORT}/v1`))
  return out
}

async function bootstrapContainer() {
  ensureDocker()
  const sha = resolveBuildSha()
  buildSha = sha
  const wt = prepareWorktree(sha)
  image = IMAGE_ARG ?? `eterna-think-e2e:${sha.slice(0, 12)}`

  let imageExists = false
  try { docker(['image', 'inspect', '--format', '{{.Id}}', image]); imageExists = true } catch { imageExists = false }
  if (!imageExists || REBUILD) {
    console.log(`[bootstrap] docker build ${image} ← ${wt}`)
    try {
      execFileSync('docker', ['build', '-t', image, wt], {
        encoding: 'utf8', maxBuffer: 256 * 1024 * 1024,
      })
    } catch (error) {
      const output = String(error?.stdout ?? '') + String(error?.stderr ?? '')
      throw new CheckFailure('bootstrap.build', 'docker build 失败', {
        actual: output.split('\n').slice(-40).join('\n'),
        hint: '检查 registry 网络与 Dockerfile；构建需数分钟',
      })
    }
  } else {
    console.log(`[bootstrap] 复用已有镜像 ${image}（--rebuild 可强制重建）`)
  }

  // 构建期 build-client 产出的客户端 bundle 必须含 V2 动作条标记。
  const bundleHits = docker([
    'run', '--rm', '--entrypoint', 'sh', image,
    '-c', 'grep -c data-eterna-think-feedback /repo/packages/access/lib/client.js 2>/dev/null || true',
  ])
  if (bundleHits === '' || bundleHits === '0') {
    throw new CheckFailure('bootstrap.bundle', '镜像内客户端 bundle 不含 data-eterna-think-feedback', {
      actual: bundleHits,
      hint: '构建期 build-client 未产出 V2 客户端；确认提交与 Dockerfile:37 步骤',
    })
  }

  const envPath = writeEnvFileForContainer(fileEnv)
  const templatePath = MOCK ? makeMockTemplate(wt) : null
  const state = containerState(CONTAINER)
  if (state === 'running' || state === 'stopped') {
    // 已存在(可能是上次 --keep 的测试容器):先确认镜像一致,避免拿旧代码跑出假绿。
    let existingImageId = ''
    let builtImageId = ''
    try { existingImageId = docker(['inspect', '-f', '{{.Image}}', CONTAINER]) } catch { existingImageId = '' }
    try { builtImageId = docker(['image', 'inspect', '-f', '{{.Id}}', image]) } catch { builtImageId = '' }
    if (existingImageId !== builtImageId) {
      throw new CheckFailure('bootstrap.staleContainer', `已有容器 ${CONTAINER} 的镜像与本次构建不一致`, {
        actual: { existingImageId, builtImageId, image },
        hint: `docker rm -f ${CONTAINER} 后重跑，或换一个 --container 名`,
      })
    }
    // 只启动,不删除,也不把它算作本次自建。
    if (state === 'stopped') docker(['start', CONTAINER])
    createdContainer = false
    console.log(`[bootstrap] 复用已存在的测试容器 ${CONTAINER}（不会自动删除）`)
  } else {
    const runArgs = [
      'run', '-d', '--name', CONTAINER, '-w', '/data',
      '-p', `127.0.0.1:${HOST_PORT}:8080`,
      '-v', `${VOLUME}:/data`,
      ...(templatePath === null
        ? []
        : ['-v', `${templatePath}:/repo/docker/profile/cordis.patch.yml.template:ro`]),
      '--env-file', envPath,
      image,
    ]
    docker(runArgs)
    createdContainer = true
    console.log(`[bootstrap] 已启动专用容器 ${CONTAINER}（卷 ${VOLUME}，仅本机 ${HOST_PORT}→8080）`)
  }
  await probeLogin()
  assertNoProductionMounts()
}

async function prepareExistingContainer() {
  ensureDocker()
  const state = containerState(CONTAINER)
  if (state === 'missing') {
    throw new CheckFailure('container.missing', `目标容器 ${CONTAINER} 不存在`, {
      hint: '先手工启动专用测试容器，或加 --bootstrap 由脚本从干净 worktree 重建',
    })
  }
  if (state === 'stopped') {
    throw new CheckFailure('container.stopped', `目标容器 ${CONTAINER} 未运行`, {
      hint: `先 docker start ${CONTAINER}，或加 --bootstrap（脚本不会自行启动外部容器）`,
    })
  }
  assertNoProductionMounts()
  await probeLogin()
}

async function verifyMockProfile() {
  if (!MOCK) return
  const hits = shIn(`grep -c 'baseURL: http://127.0.0.1:${MOCK_PORT}/v1' /data/profiles/eterna-web/cordis.patch.yml 2>/dev/null || true`)
  if (hits === '' || hits === '0') {
    throw new CheckFailure('mock.profile', '容器 profile 的 mimo baseURL 未指向 mock', {
      actual: hits,
      hint: '用 --bootstrap 启动（脚本会把模板 baseURL 改为 127.0.0.1:8099 并挂载）；或加 --real-models 走真实模型',
    })
  }
}

async function prepareDbHelper() {
  const path = join(OUT, 'p7-db.mjs')
  writeFileSync(path, DB_SOURCE)
  docker(['cp', path, `${CONTAINER}:/tmp/p7-db.mjs`])
}

// ── 主流程 ────────────────────────────────────────────────────────────
async function main() {
  const mainHead = git(['rev-parse', 'HEAD'])
  const mainDirty = git(['status', '--porcelain']).split('\n').filter(Boolean).length

  if (BOOTSTRAP) await bootstrapContainer()
  else await prepareExistingContainer()

  await verifyMockProfile()
  await ensureMock()
  await prepareDbHelper()
  try { containerImage = docker(['inspect', '-f', '{{.Config.Image}} {{.Image}}', CONTAINER]) } catch { containerImage = null }

  const { chromium, chrome } = loadChromium()
  // 浏览器 profile 含会话 cookie:落 OS 临时目录(700),收尾删除,不进仓库工作区。
  browserProfileDir = mkdtempSync(join(tmpdir(), 'think-e2e-profile-'))
  ctx = await chromium.launchPersistentContext(browserProfileDir, {
    executablePath: chrome, headless: true, viewport: { width: 1440, height: 900 },
    args: ['--no-sandbox'],
  })
  page = ctx.pages()[0] ?? await ctx.newPage()
  page.on('response', (r) => {
    if (r.url().includes('/api/session/thinkingFeedback') && r.status() !== 200) {
      badFeedbackResponses.push({ status: r.status(), url: r.url() })
    }
  })

  await login()
  sessionId = await ensureSession()
  check('ui.session', typeof sessionId === 'string' && sessionId.length > 0, {
    expect: 'localStorage[dsh.sessions.current].sessionId 非空',
    actual: { sessionId },
    hint: '登录开通异步建会话；若为空请检查 workspace.provision 审计',
  })

  // 1) 自动开启默认:users.db 的 thinking_auto=1(新卷 bias 初始为 0)。
  const row0 = await waitDbRow(sessionId, (row) => row !== null)
  check('db.row', row0 !== null, {
    expect: 'users.db sessions 行存在（登录开通/首发消息后记账）',
    actual: row0,
    hint: '检查 access 插件 users.db 落盘路径与 workspace.provision 审计',
  })
  check('auto.defaultOn', row0.thinking_auto === 1, {
    expect: 'sessions.thinking_auto = 1（默认开启）',
    actual: { thinking_auto: row0.thinking_auto },
  })
  check('bias.freshVolume', row0.thinking_bias === 0 && row0.thinking_bias_at === 0, {
    expect: '新卷：thinking_bias=0 且 thinking_bias_at=0',
    actual: { thinking_bias: row0.thinking_bias, thinking_bias_at: row0.thinking_bias_at },
    hint: '目标卷非全新（上次运行残留偏置）。请重建测试卷/容器，或用 --bootstrap 的独立卷',
  })
  dbSnapshots.initial = row0

  const catalog = await loadCatalogAndEfforts()
  modelLabel = `${catalog.provider}/${catalog.model.id}`
  efforts = catalog.names
  effortsIds = catalog.ids
  check('catalog.efforts', effortsIds.length >= 2, {
    expect: '当前模型声明 ≥2 个思考档位',
    actual: { model: catalog.model.id, efforts: effortsIds },
  })
  const chip = await checkAutoChip().catch((error) => ({ ok: false, reason: String(error?.message ?? error) }))
  softCheck('auto.chip', chip.ok, {
    expect: '模型菜单「自动」chip aria-pressed=true',
    actual: chip,
    hint: 'chip 为可见面佐证；主证据是 sessions.thinking_auto=1',
  })

  // 2) 寒暄落低档:先显式拉高档(确保档位变化可观测,绕开「同档 no-op 不审计」)。
  //    自动选档有两条静默路径(档位表未热 / 与当前档位相同),故先预热再断言。
  const HIGH_TEXTS = ['请深入思考这道题', '请仔细思考一下', 'think deeply about this']
  let warmupEvent = null
  let greetingEvent = null
  for (let attempt = 0; attempt < 3 && greetingEvent === null; attempt++) {
    const highText = HIGH_TEXTS[attempt % HIGH_TEXTS.length]
    const highTurn = await sendTurn(highText, `warmup-${attempt}`)
    warmupEvent = await waitAutoSince(highTurn.beforeAuto, sessionId, 10_000)
    const before = autoOf(sessionId).length
    const turn = await sendTurn('你好', `greeting-${attempt}`)
    // 只认寒暄口径(≤0.35):即使上一轮审计写盘滞后,也不会把 warmup 的高分事件当成寒暄。
    greetingEvent = await waitAutoSince(Math.max(before, turn.beforeAuto), sessionId, 20_000,
      (e) => e.score !== null && e.score <= 0.35)
    if (greetingEvent === null) {
      // 当前档位可能本来就是最低(预热消息未触发变更):再来一轮,拿到可观测的档位翻转。
      continue
    }
  }
  check('greeting.audit', greetingEvent !== null, {
    expect: '寒暄消息产生 access.thinking.auto 审计',
    actual: {
      warmup: warmupEvent,
      autoTail: autoOf(sessionId).slice(-5).map(autoPayload),
      modelTriggerAria: await page.locator('button[aria-label^="选择模型"]').first()
        .getAttribute('aria-label').catch(() => null),
    },
    hint: '档位表未热(首轮 fail-neutral)或与当前档位相同(同档 no-op)都会静默;检查 llm.resolveModelInfo 与模型档位声明',
  })
  const greetingRank = rankOf(greetingEvent.effort)
  check('greeting.reasoningRank', greetingRank >= 0 && greetingRank <= 1, {
    expect: '寒暄落低档：rank ∈ [0,1]（off/low）',
    actual: { effort: greetingEvent.effort, rank: greetingRank, score: greetingEvent.score, efforts: effortsIds },
  })
  check('greeting.scoreCap', greetingEvent.score <= 0.22, {
    expect: '寒暄 score ≤ 0.22（TRIVIAL_CAP=0.15 + 上轮档位弱先验 ≤0.05 + 容差）',
    actual: { score: greetingEvent.score, signals: greetingEvent.signals },
  })
  check('greeting.auditBias', near(greetingEvent.bias, 0, 0.02), {
    expect: '寒暄轮偏置≈0（新会话尚未反馈）',
    actual: { bias: greetingEvent.bias },
  })

  // 3) 代码排查落高档:围栏代码块 + 2 问号 + 编号列表 + 深度词,score 直达高档。
  const CODE_TASK = [
    '这段代码的调用栈怎么排查？能顺便分析一下根因吗？',
    '```ts',
    'const user = await loadUser(id)',
    'user.profile.name',
    '```',
    '1. 先看用户是否为空',
    '2. 再看数据库查询',
  ].join('\n')
  const codeTurn = await sendTurn(CODE_TASK, 'code-task')
  const codeEvent = await waitAutoSince(codeTurn.beforeAuto, sessionId, 20_000,
    (e) => e.score !== null && e.score >= 0.6)
  check('code.audit', codeEvent !== null, {
    expect: '代码排查消息产生 access.thinking.auto 审计',
    actual: { autoTail: autoOf(sessionId).slice(-5).map(autoPayload) },
  })
  const codeRank = rankOf(codeEvent.effort)
  check('code.highRank', codeRank === effortsIds.length - 1, {
    expect: `代码排查落最高档：rank=${effortsIds.length - 1}`,
    actual: { effort: codeEvent.effort, rank: codeRank, score: codeEvent.score, efforts: effortsIds },
  })
  check('code.score', codeEvent.score >= 0.6, {
    expect: '代码排查 score ≥ 0.6（base+代码+多问+列表+深度词）',
    actual: { score: codeEvent.score, signals: codeEvent.signals },
  })
  check('code.rankInvariant', codeRank === Math.round(codeEvent.score * (effortsIds.length - 1)), {
    expect: '审计 effort 排名 == round(score*(n-1))（与 pickEffort 同口径，提前发现目录/路由档位表漂移）',
    actual: { rank: codeRank, score: codeEvent.score, n: effortsIds.length },
  })

  // 4) 低档基线(非寒暄短消息):从高档落回最低档,给后续反馈升降一个干净起点。
  const baselineTurn = await sendTurn('帮我看看这段逻辑怎么改', 'baseline-low')
  const baselineEvent = await waitAutoSince(baselineTurn.beforeAuto, sessionId, 20_000,
    (e) => e.score !== null && e.score <= 0.25 && Math.abs(e.bias ?? 1) < 0.05)
  check('baseline.audit', baselineEvent !== null, {
    expect: '非寒暄短消息产生 access.thinking.auto 审计',
    actual: { autoTail: autoOf(sessionId).slice(-5).map(autoPayload) },
  })
  const baselineRank = rankOf(baselineEvent.effort)
  check('baseline.lowRank', baselineRank === 0, {
    expect: '低档基线 rank=0',
    actual: { effort: baselineEvent.effort, rank: baselineRank, score: baselineEvent.score },
  })
  check('baseline.bias', near(baselineEvent.bias, 0, 0.02), {
    expect: '反馈前偏置≈0',
    actual: { bias: baselineEvent.bias },
  })

  // 5) 点「想深点」→ 下一轮升档:bias=+0.2 写库并进下一轮判档。
  const feedbackBeforeMore = feedbackOf(sessionId).length
  const more1 = await clickFeedback('more')
  check('feedback.more.response', more1.status === 200 && more1.body?.result?.ok === true, {
    expect: 'POST /api/session/thinkingFeedback 200 且 result.ok=true',
    actual: { status: more1.status, result: more1.body?.result ?? null },
    hint: '客户端信封/会话归属守卫失败时会被拒（tenant/denied）',
  })
  check('feedback.more.bias', near(more1.body?.result?.value?.bias, 0.2), {
    expect: '响应 bias≈0.2（会话级偏置写入）',
    actual: more1.body?.result?.value ?? null,
  })
  softCheck('feedback.more.done', more1.done, {
    expect: '按钮短暂显示 data-done=true / 已调深',
    actual: { done: more1.done, text: more1.buttonText },
  })
  const moreAudit1 = await waitFeedbackSince(feedbackBeforeMore, sessionId, 'more')
  check('feedback.more.audit', moreAudit1 !== null, {
    expect: '审计出现 thinking.feedback direction=more',
    actual: { feedbackTail: feedbackOf(sessionId).slice(-5).map(feedbackPayload) },
    hint: '审计形态是 governance.detail.kind=access.tenant + detail.detail.action=thinking.feedback',
  })

  const continueTurn = await sendTurn('继续吧', 'after-more')
  const continueEvent = await waitAutoSince(continueTurn.beforeAuto, sessionId, 20_000,
    (e) => (e.bias ?? 0) >= 0.1)
  check('more.nextTurnAudit', continueEvent !== null, {
    expect: '「想深点」后下一轮产生 access.thinking.auto 审计',
    actual: { autoTail: autoOf(sessionId).slice(-5).map(autoPayload) },
  })
  check('more.biasIntoScoring', near(continueEvent.bias, 0.2, 0.03), {
    expect: '下一轮 signals.bias≈+0.2（偏置进入判档）',
    actual: { bias: continueEvent.bias, signals: continueEvent.signals },
  })
  const continueRank = rankOf(continueEvent.effort)
  const counterfactualRank = Math.round((continueEvent.score - continueEvent.bias) * (effortsIds.length - 1))
  check('more.rankUplift', continueRank === 1 && continueRank > counterfactualRank, {
    expect: '下一轮档位升到 rank=1（无偏置时 counterfactual rank=0）',
    actual: {
      effort: continueEvent.effort, rank: continueRank, counterfactualRank,
      score: continueEvent.score, bias: continueEvent.bias,
      previousBaselineRank: baselineRank,
    },
    hint: '若 rank 未升：检查 thinking-auto 是否真正读 thinkingBiasOf（store.ts:479-506）',
  })
  check('more.rankInvariant', continueRank === Math.round(continueEvent.score * (effortsIds.length - 1)), {
    expect: 'rank == round(score*(n-1))',
    actual: { rank: continueRank, score: continueEvent.score, n: effortsIds.length },
  })

  // 6) 点「想浅点」→ 下一轮降档 + 偏置反向抵消归零。
  const feedbackBeforeLess = feedbackOf(sessionId).length
  const less = await clickFeedback('less')
  check('feedback.less.response', less.status === 200 && less.body?.result?.ok === true, {
    expect: 'POST thinkingFeedback(less) 200 且 result.ok=true',
    actual: { status: less.status, result: less.body?.result ?? null },
  })
  check('feedback.less.resetZero', near(less.body?.result?.value?.bias, 0, 0.01), {
    expect: '|bias|<0.01（0.2-0.2 反向抵消归零）',
    actual: less.body?.result?.value ?? null,
  })
  softCheck('feedback.less.done', less.done, {
    expect: '按钮短暂显示 data-done=true / 已调浅',
    actual: { done: less.done, text: less.buttonText },
  })
  const lessAudit = await waitFeedbackSince(feedbackBeforeLess, sessionId, 'less')
  check('feedback.less.audit', lessAudit !== null, {
    expect: '审计出现 thinking.feedback direction=less',
    actual: { feedbackTail: feedbackOf(sessionId).slice(-5).map(feedbackPayload) },
  })

  const goodTurn = await sendTurn('好的呢', 'after-less')
  const goodEvent = await waitAutoSince(goodTurn.beforeAuto, sessionId, 20_000,
    (e) => Math.abs(e.bias ?? 1) < 0.05)
  check('less.nextTurnAudit', goodEvent !== null, {
    expect: '「想浅点」后下一轮产生 access.thinking.auto 审计',
    actual: { autoTail: autoOf(sessionId).slice(-5).map(autoPayload) },
  })
  check('less.biasZero', Math.abs(goodEvent.bias) < 0.02, {
    expect: '下一轮 signals.bias≈0（抵消后不参与判档）',
    actual: { bias: goodEvent.bias, signals: goodEvent.signals },
  })
  const goodRank = rankOf(goodEvent.effort)
  check('less.rankDown', goodRank < continueRank, {
    expect: `下一轮档位降档（${continueRank} → ${goodRank}）`,
    actual: { effort: goodEvent.effort, rank: goodRank, score: goodEvent.score, previousRank: continueRank },
  })

  // 7) 再点「想深点」把偏置写回 +0.2,读 users.db 做持久化硬证据。
  const feedbackBeforeMore2 = feedbackOf(sessionId).length
  const more2 = await clickFeedback('more')
  check('feedback.more2.response', more2.status === 200 && more2.body?.result?.ok === true
    && near(more2.body?.result?.value?.bias, 0.2), {
    expect: '第二次「想深点」写入 bias≈0.2',
    actual: { status: more2.status, result: more2.body?.result ?? null },
  })
  const moreAudit2 = await waitFeedbackSince(feedbackBeforeMore2, sessionId, 'more')
  check('feedback.more2.audit', moreAudit2 !== null, {
    expect: '审计出现第三条 thinking.feedback direction=more',
    actual: { feedbackTail: feedbackOf(sessionId).slice(-5).map(feedbackPayload) },
  })

  let dbBeforeRestart = await readDb(sessionId).catch(() => null)
  check('db.morePersisted', dbBeforeRestart !== null
    && dbBeforeRestart.thinking_auto === 1
    && near(dbBeforeRestart.thinking_bias, 0.2, 0.03)
    && dbBeforeRestart.thinking_bias_at > 0, {
    expect: 'users.db: thinking_auto=1 / thinking_bias≈0.2 / thinking_bias_at>0',
    actual: dbBeforeRestart,
  })
  dbSnapshots.beforeRestart = dbBeforeRestart

  // 8) 审计形态校验(嵌套 detail.detail.action;不得按字面 access.thinking.feedback 过滤)。
  const feedbackRows = feedbackOf(sessionId).map(feedbackPayload)
  audits.feedback = feedbackRows
  audits.auto = autoOf(sessionId).map(autoPayload)
  const directions = feedbackRows.map((r) => r.direction)
  check('audit.feedbackShape', feedbackRows.length >= 3
    && directions[0] === 'more' && directions[1] === 'less' && directions[2] === 'more', {
    expect: '审计顺序 more/less/more（governance.detail.kind=access.tenant → detail.detail.action=thinking.feedback）',
    actual: directions,
    hint: '真实审计行是嵌套形态；按字面 kind=access.thinking.feedback grep 会拿到空集',
  })
  check('audit.feedbackBias', near(feedbackRows[0].bias, 0.2, 0.03)
    && Math.abs(feedbackRows[1].bias) < 0.01
    && near(feedbackRows[2].bias, 0.2, 0.03), {
    expect: '三条审计 bias = 0.2 / 0 / 0.2',
    actual: feedbackRows.slice(0, 3).map((r) => r.bias),
  })
  check('audit.autoShape', audits.auto.length >= 4, {
    expect: 'access.thinking.auto 审计覆盖寒暄/代码/升档/降档至少 4 条',
    actual: { count: audits.auto.length, efforts: audits.auto.map((r) => r.effort) },
  })
  audits.provisioned = auditRecords().some((r) => r?.detail?.kind === 'access.tenant'
    && r?.detail?.detail?.action === 'workspace.provision')

  // 8b) 读支(无 direction)⇒ {bias,effectiveBias},且读不记审计。
  const readBefore = feedbackOf(sessionId).length
  const read = await rpc('thinkingFeedback', { request: { sessionId } })
  check('feedback.read.branch', read.ok === true
    && typeof read.value?.bias === 'number'
    && typeof read.value?.effectiveBias === 'number', {
    expect: 'POST thinkingFeedback 无 direction ⇒ ok + {bias,effectiveBias}',
    actual: read,
    hint: '读支是 V2 收尾新增;被测 SHA 若为旧版会返回 direction 无效',
  })
  check('feedback.read.consistent', near(read.value?.bias, 0.2, 0.03)
    && Math.abs((read.value?.effectiveBias ?? 0) - (read.value?.bias ?? 0)) < 0.02, {
    expect: '读回 bias≈0.2 且 effectiveBias≈bias(刚写入,衰减可忽略)',
    actual: read.value ?? null,
  })
  check('feedback.read.noAudit', feedbackOf(sessionId).length === readBefore, {
    expect: '读支不产生 thinking.feedback 审计(菜单每次打开都读)',
    actual: { before: readBefore, after: feedbackOf(sessionId).length },
  })

  // 8c) reset 支:当前偏置 0.2(第 7 步写入)⇒ RPC 清零 ⇒ bias=0;审计 direction=reset。
  const beforeReset = feedbackOf(sessionId).length
  const reset = await rpc('thinkingFeedback', { request: { sessionId, direction: 'reset' } })
  check('feedback.reset.zero', reset.ok === true && near(reset.value?.bias, 0, 0.001)
    && near(reset.value?.effectiveBias, 0, 0.001), {
    expect: 'POST thinkingFeedback(reset) ⇒ {bias:0,effectiveBias:0}',
    actual: reset,
    hint: '被测 SHA 需含 reset 支路;旧版会 denied direction 无效',
  })
  const resetAudit = await waitFeedbackSince(beforeReset, sessionId, 'reset')
  check('feedback.reset.audit', resetAudit !== null, {
    expect: '审计出现 thinking.feedback direction=reset',
    actual: { tail: feedbackOf(sessionId).slice(-5).map(feedbackPayload) },
  })
  const resetRead = await rpc('thinkingFeedback', { request: { sessionId } })
  check('feedback.reset.readback', resetRead.ok === true && near(resetRead.value?.bias, 0, 0.001), {
    expect: 'reset 后读支读回 bias=0',
    actual: resetRead,
  })

  // 8d) 菜单偏置行:置 +0.2 ⇒ 行可见(深浅截图)⇒ 两击重置 ⇒ 行消失且读回 0。
  await rpc('thinkingFeedback', { request: { sessionId, direction: 'more' } })
  const menuTrigger = page.locator('button[aria-label^="选择模型"]').first()
  await menuTrigger.click()
  await page.waitForSelector('[data-eterna-model-menu-root]', { timeout: 5000 })
  const biasResetBtn = page.locator('[data-eterna-model-menu-root] .ea-bias-reset').first()
  check('ui.biasRow.visible', await biasResetBtn.isVisible({ timeout: 5000 }).catch(() => false), {
    expect: '菜单出现偏置行(重置按钮可见)',
    actual: { menu: await page.locator('[data-eterna-model-menu-root]').count(), text: (await page.locator('[data-eterna-model-menu-root]').first().textContent().catch(() => ''))?.slice(0, 200) },
    hint: '偏置行只在 |effectiveBias|≥0.01 时渲染;确认读支返回 0.2',
  })
  for (const scheme of ['light', 'dark']) {
    await page.emulateMedia({ colorScheme: scheme })
    await sleep(400)
    const path = join(SHOTS, `bias-row-${scheme}.png`)
    let shotOk = true
    try {
      await page.locator('[data-eterna-model-menu-root]').first().screenshot({ path })
    } catch { shotOk = false }
    check(`shots.biasRow.${scheme}`, shotOk, {
      expect: `菜单偏置行截图（${scheme}）`,
      actual: { path },
    })
    screenshots.push(path)
  }
  await page.emulateMedia({ colorScheme: null }).catch(() => {})
  const beforeUiReset = feedbackOf(sessionId).length
  const uiResetResponse = page.waitForResponse(
    (r) => r.url().includes('/api/session/thinkingFeedback') && r.request().method() === 'POST',
    { timeout: 15_000 },
  )
  await biasResetBtn.click()
  await biasResetBtn.click()
  const uiReset = await uiResetResponse
  const uiResetBody = await uiReset.json().catch(() => null)
  check('ui.reset.response', uiReset.status() === 200 && uiResetBody?.result?.ok === true, {
    expect: '菜单两击重置 ⇒ 200 且 result.ok=true',
    actual: { status: uiReset.status(), result: uiResetBody?.result ?? null },
  })
  await sleep(500)
  check('ui.biasRow.gone', await page.locator('[data-eterna-model-menu-root] .ea-bias-reset').count() === 0, {
    expect: '重置成功后偏置行消失(本地归零)',
    actual: { remaining: await page.locator('[data-eterna-model-menu-root] .ea-bias-reset').count() },
  })
  // 键盘可达:ESC 收起菜单,不阻断后续输入。
  await page.keyboard.press('Escape').catch(() => {})
  await sleep(300)
  const uiResetAudit = await waitFeedbackSince(beforeUiReset, sessionId, 'reset')
  check('ui.reset.audit', uiResetAudit !== null, {
    expect: '菜单重置同样产生 direction=reset 审计',
    actual: { tail: feedbackOf(sessionId).slice(-5).map(feedbackPayload) },
  })

  // 8e) 恢复到 +0.2 并重新取库快照,让第 10 步的重启一致性断言对得上。
  await rpc('thinkingFeedback', { request: { sessionId, direction: 'more' } })
  dbBeforeRestart = await readDb(sessionId).catch(() => null)

  // 9) 深浅两主题截图:最新 assistant 动作条(两枚按钮)。
  const latestSpan = page.locator('[data-eterna-think-feedback]').last()
  await latestSpan.scrollIntoViewIfNeeded().catch(() => {})
  for (const scheme of ['light', 'dark']) {
    await page.emulateMedia({ colorScheme: scheme })
    await sleep(500)
    const matches = await page.evaluate(() => window.matchMedia('(prefers-color-scheme: dark)').matches)
    const path = join(SHOTS, `feedback-${scheme}.png`)
    let shotOk = true
    try {
      await latestSpan.screenshot({ path })
    } catch {
      try { await latestSpan.locator('xpath=..').first().screenshot({ path }) } catch { shotOk = false }
    }
    check(`shots.${scheme}`, shotOk, {
      expect: `最新 assistant 动作条截图（${scheme}）`,
      actual: { path, prefersDark: matches },
      hint: 'playwright-core 与 CfT chromium 来自主仓 browser-relay；不装依赖',
    })
    screenshots.push(path)
  }
  await page.emulateMedia({ colorScheme: null }).catch(() => {})

  // 10) 容器重启后偏置仍在:db 行级硬证据(bias_at 原值不变)。
  if (!SKIP_RESTART) {
    docker(['restart', CONTAINER])
    await probeLogin()
    await ensureMock()
    await prepareDbHelper()
    await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' }).catch(() => {})
    await sleep(6000)
    if (String(page.url()).includes('/login')) await login('relogin')
    const sidAfter = await readSessionId()

    // UI 恢复判定:localStorage 可能是陈旧值,必须同时看到历史动作条才算真恢复。
    let sameUi = sidAfter === sessionId
    if (sameUi) {
      const historyDeadline = Date.now() + 15_000
      while (Date.now() < historyDeadline && await feedbackCount() === 0) await sleep(500)
      sameUi = (await feedbackCount()) > 0 && (await readSessionId()) === sessionId
    }

    const dbAfterRestart = await waitDbRow(sessionId, (row) => row !== null, 30_000)
    dbSnapshots.afterRestart = dbAfterRestart
    check('restart.biasPersisted', dbAfterRestart !== null
      && dbAfterRestart.thinking_auto === 1
      && near(dbAfterRestart.thinking_bias, dbBeforeRestart.thinking_bias, 0.001)
      && dbAfterRestart.thinking_bias_at === dbBeforeRestart.thinking_bias_at, {
      expect: '重启后同一 session 的 thinking_bias≈0.2 且 thinking_bias_at 与重启前完全一致',
      actual: { before: dbBeforeRestart, after: dbAfterRestart },
      hint: '偏置持久化在 users.db（卷内）；读时 24h 半衰只影响内存有效值，不改列',
    })

    // 11) 重启后生效(尽力断言):优先在同一会话发消息,证明库值被重新读入判档。
    let uiDrift = false
    if (sameUi) {
      // 先显式低档(可选;若同档则静默),再长代码消息拿高档 —— 至少一次档位变化可观测。
      let effectiveEvent = null
      for (let attempt = 0; attempt < 2 && effectiveEvent === null; attempt++) {
        await sendTurn(attempt === 0 ? '请简短回答' : '请直接说', `post-restart-low-${attempt}`)
        // 发送后 localStorage 若漂到新会话 ⇒ 停止 UI 断言,改走直调分支。
        if (await readSessionId() !== sessionId) { uiDrift = true; break }
        const turn = await sendTurn(CODE_TASK, `post-restart-code-${attempt}`)
        if (await readSessionId() !== sessionId) { uiDrift = true; break }
        const candidate = await waitAutoSince(turn.beforeAuto, sessionId, 20_000,
          (e) => e.bias !== null && rankOf(e.effort) === effortsIds.length - 1)
        if (candidate !== null) effectiveEvent = candidate
      }
      if (!uiDrift) {
        check('restart.effectiveAudit', effectiveEvent !== null, {
          expect: '重启后同一会话发代码排查消息产生 auto 审计',
          actual: { sidAfter, autoTail: autoOf(sessionId).slice(-5).map(autoPayload) },
          hint: '档位表未热/同档 no-op 可能静默；本段为尽力断言，库级持久化已由 restart.biasPersisted 证明',
        })
        const postRank = rankOf(effectiveEvent.effort)
        check('restart.biasReadBack', near(effectiveEvent.bias, 0.2, 0.04), {
          expect: '重启后下一轮 signals.bias≈0.2（从 users.db 重新读入）',
          actual: { bias: effectiveEvent.bias, signals: effectiveEvent.signals },
        })
        check('restart.highAgain', postRank === effortsIds.length - 1, {
          expect: `重启后代码排查仍落最高档 rank=${effortsIds.length - 1}`,
          actual: { effort: effectiveEvent.effort, rank: postRank, score: effectiveEvent.score },
        })
      }
    }
    if (!sameUi || uiDrift) {
      // UI 会话 id 变了(加分项失败):用旧 sessionId 直调 RPC,证明库值被读:
      // 0.2 + 0.2 ⇒ 0.4,再 less 复原 ⇒ 0.2。
      const up = await rpc('thinkingFeedback', { request: { sessionId, direction: 'more' } })
      check('restart.directMore', up.ok && near(up.value?.bias, 0.4, 0.04), {
        expect: '旧 sessionId 直调 more: bias≈0.4（证明重启后库内 0.2 被读入）',
        actual: up,
        hint: 'localStorage 会话未恢复时走此分支；库级持久化已由 restart.biasPersisted 证明',
      })
      const down = await rpc('thinkingFeedback', { request: { sessionId, direction: 'less' } })
      check('restart.directLess', down.ok && near(down.value?.bias, 0.2, 0.04), {
        expect: '再直调 less 复原 bias≈0.2',
        actual: down,
      })
      softCheck('restart.uiSession', false, {
        expect: '重启后 localStorage 仍指向同一会话（加分项）',
        actual: { before: sessionId, after: await readSessionId(), uiDrift },
      })
    }
  }

  check('feedback.noBadResponses', badFeedbackResponses.length === 0, {
    expect: '全程无 /api/session/thinkingFeedback 非 200 响应',
    actual: badFeedbackResponses,
  })

  // 收尾快照(含重启后直调分支可能新增的审计行)。
  audits.feedback = feedbackOf(sessionId).map(feedbackPayload)
  audits.auto = autoOf(sessionId).map(autoPayload)

  return { mainHead, mainDirty }
}

// ── 执行/收尾/证据落盘 ─────────────────────────────────────────────────
let gitInfo = { head: null, dirty: null }
let fatal = null
try {
  gitInfo = await main()
  console.log('P7 E2E PASS — 思考强度判档 V2 全链（自动默认/寒暄低/代码高/反馈升降/读支/reset/菜单偏置行/重启持久化/双主题截图）')
  const softFails = Object.entries(checks).filter(([, v]) => v.ok === false && v.soft === true).map(([k]) => k)
  if (softFails.length > 0) console.log('可选观测未通过（不影响判定，详见 record.json）:', softFails.join(', '))
  console.log('screenshots →', SHOTS)
  console.log('record →', join(OUT, 'record.json'))
} catch (error) {
  fatal = error
  if (page !== null) failureShot = await safeShot('failure.png')
  try {
    const log = execFileSync('docker', ['logs', '--tail', '120', CONTAINER], { encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 })
    const diagDir = mkdtempSync(join(tmpdir(), 'think-e2e-diag-'))
    failureLog = join(diagDir, 'container.log')
    writeFileSync(failureLog, log)
  } catch { failureLog = null }
  if (error instanceof CheckFailure) {
    console.error(`\n[FAIL] ${error.id}: ${error.message}`)
    const d = error.detail ?? {}
    if (d.expect !== undefined) console.error('  期望:', JSON.stringify(d.expect))
    if (d.actual !== undefined) console.error('  实际:', JSON.stringify(d.actual))
    if (d.hint !== undefined) console.error('  提示:', d.hint)
  } else {
    console.error('\n[FAIL] 未预期异常:')
    console.error(error?.stack ?? String(error))
  }
  if (page !== null) console.error('  页面:', page.url())
  if (failureShot !== null) console.error('  失败截图:', failureShot)
  if (failureLog !== null) console.error('  容器日志:', failureLog)
} finally {
  // 证据先落盘(失败也保留所有已通过判据与数据库/审计快照)。
  if (gitInfo.head === null) {
    try {
      gitInfo = {
        head: git(['rev-parse', 'HEAD']),
        dirty: git(['status', '--porcelain']).split('\n').filter(Boolean).length,
      }
    } catch { /* 非 git 工作区:留 null */ }
  }
  try {
    const record = {
      at: new Date().toISOString(),
      base: BASE,
      container: CONTAINER,
      volumeHint: BOOTSTRAP ? VOLUME : '(外部容器)',
      mock: MOCK ? { port: MOCK_PORT } : false,
      image,
      buildSha,
      containerImage,
      worktree: worktreeDir,
      mainGit: gitInfo,
      sessionId,
      model: modelLabel,
      efforts: effortsIds,
      effortNames: efforts,
      checks,
      audits: {
        provisioned: audits.provisioned,
        feedback: audits.feedback.length > 0 ? audits.feedback : feedbackOf(undefined).map(feedbackPayload).slice(-20),
        auto: audits.auto.length > 0 ? audits.auto : autoOf(undefined).map(autoPayload).slice(-20),
      },
      db: dbSnapshots,
      screenshots,
      error: fatal === null ? null : {
        id: fatal instanceof CheckFailure ? fatal.id : null,
        message: fatal?.message ?? String(fatal),
        detail: fatal instanceof CheckFailure ? fatal.detail : null,
        pageUrl: page?.url?.() ?? null,
        failureShot,
        containerLog: failureLog,
      },
    }
    writeFileSync(join(OUT, 'record.json'), JSON.stringify(record, null, 2) + '\n')
    // 阶段摘要(p7/gate-summary.json):与 ph/p0–p6 同构,便于 release-gate 口径检索;
    // 一份 record + 一份 summarized verdict,失败也落盘(verdict=no-go)。
    const failed = Object.entries(checks).filter(([, v]) => v.ok === false && v.soft !== true)
    const softFailed = Object.entries(checks).filter(([, v]) => v.ok === false && v.soft === true)
    writeFileSync(join(OUT, '../../gate-summary.json'), JSON.stringify({
      at: record.at,
      phase: 'p7',
      verdict: fatal === null && failed.length === 0 ? 'go' : 'no-go',
      summary: {
        checks: Object.keys(checks).length,
        failed: failed.map(([k]) => k),
        softFailed: softFailed.map(([k]) => k),
      },
      base: BASE,
      image,
      buildSha,
      sessionId,
      screenshots,
      error: record.error,
    }, null, 2) + '\n')
  } catch (error) {
    console.error('证据落盘失败:', String(error?.message ?? error))
  }

  try { if (ctx !== null) await ctx.close() } catch { /* 忽略 */ }

  // 临时 env-file 含凭据:无条件删除(即使 --keep 也不留)。
  if (generatedEnvFile !== null) {
    try { rmSync(dirname(generatedEnvFile), { recursive: true, force: true }) } catch { /* 忽略 */ }
  }
  // 浏览器 profile 含会话 cookie:同样无条件删除。
  if (browserProfileDir !== null) {
    try { rmSync(browserProfileDir, { recursive: true, force: true }) } catch { /* 忽略 */ }
  }

  if (BOOTSTRAP && createdContainer && !KEEP) {
    try { docker(['rm', '-f', CONTAINER]) } catch (error) { console.error('清理容器失败:', String(error?.message ?? error)) }
    try { docker(['volume', 'rm', VOLUME]) } catch (error) { console.error('清理卷失败（可能仍被占用）:', String(error?.message ?? error)) }
  } else if (BOOTSTRAP && createdContainer && KEEP) {
    console.log(`[keep] 容器 ${CONTAINER} 与卷 ${VOLUME} 保留供复查`)
  }
  if (createdWorktree && !KEEP && worktreeDir !== null) {
    try {
      git(['worktree', 'remove', '--force', worktreeDir])
      git(['worktree', 'prune'])
    } catch (error) { console.error('清理 worktree 失败:', String(error?.message ?? error)) }
  }
}

const failedChecks = Object.entries(checks).filter(([, v]) => v.ok === false && v.soft !== true)
if (fatal !== null || failedChecks.length > 0) process.exit(1)
process.exit(0)