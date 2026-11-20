#!/usr/bin/env node
/**
 * E1–E5 测试环境准备（51 §0.4；54 §4.7/§6.3；T46/T48）。
 *
 * 目标：在**独立容器/独立数据根**上把 P6 要用的五套环境一次备齐，幂等可重跑；
 * 生产容器/生产数据根不在任何子命令的写路径上。
 *
 *   e1  E1 隔离 web 容器（3108 / relay 9311 / 实例 e1 / 项目 rc5-test-e1）
 *       + 夹具只读挂载（RC5_FIXTURES）+ MCP personal 环境变量
 *       + 首次启动健康等待 + 账号播种（admin 来自 env；user_b/user_c 自动建）
 *   e2  E2 三账号矩阵：复用 e1，校验 admin/user_b/user_c 均可登录且各有工作区，
 *       打印 user→workspace 归属（只读 access/users.db，不打印口令）
 *   e3  E3 super 形态：独立端口 3109 / 实例 e3 / 项目 rc5-test-e3，ETERNA_FORM=super
 *   e4  E4 ACP：实例 e4 / 项目 rc5-test-e4；只建数据根 + `--profile acp config`
 *       校验（ACP 由 `compose run --rm -T` 按需启，不常驻）
 *   e5  E5 迁移副本：`rsync -aH` 把**冷备副本**拷到实例 e5，绝不读生产库在线文件；
 *       必须显式 --source，本脚本拒绝把生产根当源
 *
 * 凭据纪律：账号/API key 只从 0600 env 文件读入内存；本脚本不打印、不落证据；
 * 新建用户的随机口令只写 $ROOT/.test-accounts.json（0600）。
 *
 * 用法：
 *   node scripts/prepare-rc5-envs.mjs e1
 *   node scripts/prepare-rc5-envs.mjs all --source "$HOME/eterna-data/backups/<冷备目录>"
 *   可选：--root <测试根，默认 $HOME/eterna-data/test-rc5>
 *         --image <tag，默认 eterna-agent:rc5-test>
 *         --keys-from <env 文件，默认 $ROOT/.env.e1（存在时）；用于生成新实例 env>
 *         --fresh  重建 e1 数据根/容器（仅测试根；需二次确认 --yes）
 *         --yes    与 --fresh 搭配
 *
 * 幂等：已存在的 env/override/账号文件不覆盖；容器已健康则跳过 up。
 */
import { chmodSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { login, request } from './rc5-test-client.mjs'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')

/* ------------------------------------------------------------------ CLI */

function parseArgs(argv) {
  const args = { _: [] }
  for (let index = 0; index < argv.length; index++) {
    const token = argv[index]
    if (!token.startsWith('--')) { args._.push(token); continue }
    const eq = token.indexOf('=')
    if (eq !== -1) { args[token.slice(2, eq)] = token.slice(eq + 1); continue }
    const name = token.slice(2)
    const next = argv[index + 1]
    if (next !== undefined && !next.startsWith('--')) { args[name] = next; index += 1 }
    else args[name] = true
  }
  return args
}

const args = parseArgs(process.argv.slice(2))
const COMMAND = args._[0]
const TEST_ROOT = resolve(typeof args.root === 'string' ? args.root : join(homedir(), 'eterna-data', 'test-rc5'))
const IMAGE = typeof args.image === 'string' ? args.image : 'eterna-agent:rc5-test'
const KEYS_FROM = typeof args['keys-from'] === 'string' ? resolve(args['keys-from']) : undefined
const FRESH = args.fresh === true
const CONFIRMED = args.yes === true

if (COMMAND === undefined || !['e1', 'e2', 'e3', 'e4', 'e5', 'all'].includes(COMMAND)) {
  console.error('用法: node scripts/prepare-rc5-envs.mjs <e1|e2|e3|e4|e5|all> [--root …] [--image …] [--keys-from …] [--source …]')
  process.exit(2)
}
if (FRESH && !CONFIRMED) {
  console.error('--fresh 会删测试根实例（不碰生产）；确认请加 --yes')
  process.exit(2)
}

const INSTANCES = {
  e1: { instance: 'e1', port: 3108, relay: 9311, form: 'web', project: 'rc5-test-e1', container: 'eterna-rc5-e1' },
  e3: { instance: 'e3', port: 3109, relay: 9312, form: 'super', project: 'rc5-test-e3', container: 'eterna-rc5-e3' },
  e4: { instance: 'e4', port: 3107, relay: 9313, form: 'acp', project: 'rc5-test-e4', container: 'eterna-rc5-e4' },
}

/* ---------------------------------------------------------------- 输出面 */

const results = []
function report(id, ok, detail) {
  results.push({ id, ok, detail })
  console.log(`[${ok ? 'PASS' : 'FAIL'}] ${id} :: ${detail}`)
}

function run(cmd, cmdArgs, { env, timeout = 300_000 } = {}) {
  const printable = [cmd, ...cmdArgs].join(' ')
  const result = spawnSync(cmd, cmdArgs, { encoding: 'utf8', timeout, env: env ?? process.env, maxBuffer: 64 * 1024 * 1024 })
  if (result.status !== 0) {
    console.error(`[cmd] ${printable}`)
    console.error(`[exit] ${result.status}`)
    if ((result.stderr ?? '').trim() !== '') console.error(result.stderr.trim().slice(0, 800))
  }
  return { status: result.status ?? -1, stdout: (result.stdout ?? '').trim(), stderr: (result.stderr ?? '').trim(), printable }
}

/* -------------------------------------------------------------- env 文件 */

const SECRET_KEYS = [
  'MIMO_API_KEY', 'DEEPSEEK_API_KEY', 'BIGMODEL_API_KEY', 'OPENDESIGN_API_KEY',
  'ETERNA_ACCESS_ADMIN_USER', 'ETERNA_ACCESS_ADMIN_PASSWORD', 'ETERNA_ACCESS_SECRET',
  'ETERNA_ACCESS_SECURE', 'ETERNA_MCP_MASTER_KEY', 'ETERNA_MCP_PERSONAL_ENABLED',
  'ETERNA_MCP_PERSONAL_CATALOG', 'ETERNA_MCP_PERSONAL_HTTP_HOSTS',
  'ETERNA_PUBLIC_URL', 'ETERNA_TRUSTED_HOST', 'ETERNA_RELAY_TOKEN',
]

function parseEnvFile(path) {
  const map = {}
  if (!existsSync(path)) return map
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    const match = line.match(/^([A-Z0-9_]+)=(.*)$/)
    if (match !== null) map[match[1]] = match[2]
  }
  return map
}

function envPath(instance) {
  return join(TEST_ROOT, `.env.${instance}`)
}

function ensureEnvFile(instance) {
  const spec = INSTANCES[instance] ?? { instance, port: 0, relay: 0, form: 'web' }
  const path = envPath(instance)
  if (existsSync(path)) {
    const mode = (statSync(path).mode & 0o777).toString(8)
    if (mode !== '600') chmodSync(path, 0o600)
    report(`ENV-${instance}`, mode === '600', `${path} 已存在（mode ${mode}）`)
    return path
  }

  const sourceCandidates = [KEYS_FROM, join(TEST_ROOT, '.env.e1')].filter(item => typeof item === 'string')
  const source = sourceCandidates.find(item => existsSync(item))
  const inherited = source === undefined ? {} : parseEnvFile(source)
  const lines = [
    `# E${instance.toUpperCase()} rc.5 测试实例（prepare-rc5-envs.mjs 生成；0600，勿入仓）`,
    `ETERNA_DATA_ROOT=${TEST_ROOT}`,
    `ETERNA_INSTANCE=${spec.instance}`,
    `ETERNA_PORT=${spec.port}`,
    `ETERNA_RELAY_PORT=${spec.relay}`,
    `ETERNA_CONTAINER_NAME=${INSTANCES[instance]?.container ?? `eterna-rc5-${instance}`}`,
    `ETERNA_IMAGE=${IMAGE}`,
    `ETERNA_FORM=${spec.form}`,
    ...(instance === 'e1' ? [`RC5_FIXTURES=${join(repoRoot, 'tests', 'fixtures')}`] : []),
    ...SECRET_KEYS.filter(key => typeof inherited[key] === 'string' && inherited[key] !== '').map(key => `${key}=${inherited[key]}`),
  ]
  mkdirSync(TEST_ROOT, { recursive: true, mode: 0o700 })
  writeFileSync(path, `${lines.join('\n')}\n`, { mode: 0o600 })
  chmodSync(path, 0o600)
  report(`ENV-${instance}`, true, `${path} 新建（密钥来源 ${source ?? '无'}，0600）`)
  return path
}

function envMap(path) {
  return parseEnvFile(path)
}

/* ------------------------------------------------------------- 数据根 */

function initDataRoot(instance) {
  const root = join(TEST_ROOT, instance)
  const result = run('bash', [join(repoRoot, 'deploy', 'init-data-dirs.sh'), instance], {
    env: { ...process.env, ETERNA_DATA_ROOT: TEST_ROOT },
  })
  report(`DATA-${instance}`, result.status === 0 && existsSync(root), `${root}（init-data-dirs exit=${result.status}）`)
  return root
}

/* ------------------------------------------------------------- compose */

function composeBase(instance) {
  return ['compose', '-p', INSTANCES[instance].project, '--env-file', envPath(instance), '-f', join(repoRoot, 'docker-compose.yml')]
}

function ensureE1Override() {
  const path = join(TEST_ROOT, '.compose.e1.override.yml')
  const content = [
    '# E1 专用 override（prepare-rc5-envs.mjs）：夹具只读挂载 + MCP personal 变量。',
    'services:',
    '  eterna-agent:',
    '    environment:',
    '      ETERNA_MCP_MASTER_KEY: ${ETERNA_MCP_MASTER_KEY:-}',
    '      ETERNA_MCP_PERSONAL_ENABLED: ${ETERNA_MCP_PERSONAL_ENABLED:-true}',
    '      ETERNA_MCP_PERSONAL_CATALOG: ${ETERNA_MCP_PERSONAL_CATALOG:-}',
    '      ETERNA_MCP_PERSONAL_HTTP_HOSTS: ${ETERNA_MCP_PERSONAL_HTTP_HOSTS:-}',
    '    volumes:',
    '      - ${RC5_FIXTURES:?set RC5_FIXTURES to tests/fixtures absolute path}:/fixtures:ro',
    '',
  ].join('\n')
  if (!existsSync(path) || readFileSync(path, 'utf8') !== content) writeFileSync(path, content, { mode: 0o600 })
  return path
}

async function composeUp(instance) {
  const extra = instance === 'e1' ? ['-f', ensureE1Override()] : []
  const argsUp = [...composeBase(instance), ...extra, 'up', '-d', 'eterna-agent']
  const result = run('docker', argsUp, { timeout: 600_000 })
  if (result.status !== 0) {
    report(`BOOT-${instance}`, false, `compose up 失败 exit=${result.status}`)
    return false
  }
  const container = INSTANCES[instance].container
  let health = 'unknown'
  for (let attempt = 0; attempt < 60; attempt++) {
    const probe = spawnSync('docker', ['inspect', container, '--format', '{{.State.Health.Status}}'], { encoding: 'utf8', timeout: 10_000 })
    health = (probe.stdout ?? '').trim()
    if (health === 'healthy') break
    if ((probe.stderr ?? '').includes('No such object')) break
    await sleep(2000)
  }
  report(`BOOT-${instance}`, health === 'healthy',
    `container=${container} health=${health} image=${envMap(envPath(instance)).ETERNA_IMAGE ?? '?'}`)
  return health === 'healthy'
}

async function sleep(ms) { await new Promise(resolvePromise => setTimeout(resolvePromise, ms)) }

/* -------------------------------------------------------------- 账号 */

function readDb(file, sql, params = []) {
  const code = `const {DatabaseSync}=require('node:sqlite');const db=new DatabaseSync(process.argv[1],{readOnly:true});db.exec('PRAGMA busy_timeout=5000');process.stdout.write(JSON.stringify(db.prepare(process.argv[2]).all(...JSON.parse(process.argv[3]))))`
  const result = spawnSync(process.execPath, ['-e', code, file, sql, JSON.stringify(params)], { encoding: 'utf8', timeout: 30_000 })
  if (result.status !== 0) throw new Error(`sqlite 读取失败: ${(result.stderr ?? '').slice(0, 200)}`)
  return JSON.parse(result.stdout)
}

const ACCOUNTS_PATH = join(TEST_ROOT, '.test-accounts.json')

function loadOrCreateAccounts(env) {
  const existing = existsSync(ACCOUNTS_PATH) ? JSON.parse(readFileSync(ACCOUNTS_PATH, 'utf8')) : undefined
  const admin = {
    account: env.ETERNA_ACCESS_ADMIN_USER ?? '',
    password: env.ETERNA_ACCESS_ADMIN_PASSWORD ?? '',
  }
  if (admin.account === '' || admin.password === '') {
    throw new Error(`env 缺 ETERNA_ACCESS_ADMIN_USER/PASSWORD（来源 ${envPath('e1')}）`)
  }
  const accounts = {
    admin: typeof existing?.admin?.password === 'string' && existing.admin.password !== '' ? existing.admin : admin,
    user_b: typeof existing?.user_b?.password === 'string' && existing.user_b.password !== ''
      ? existing.user_b : { account: existing?.user_b?.account ?? 'rc5user_b', password: newPassword() },
    user_c: typeof existing?.user_c?.password === 'string' && existing.user_c.password !== ''
      ? existing.user_c : { account: existing?.user_c?.account ?? 'rc5user_c', password: newPassword() },
  }
  if (typeof env.ETERNA_MCP_MASTER_KEY === 'string' && env.ETERNA_MCP_MASTER_KEY !== '') {
    accounts.mcpMasterKey = env.ETERNA_MCP_MASTER_KEY
  } else if (typeof existing?.mcpMasterKey === 'string') {
    accounts.mcpMasterKey = existing.mcpMasterKey
  }
  writeFileSync(ACCOUNTS_PATH, `${JSON.stringify(accounts, null, 2)}\n`, { mode: 0o600 })
  chmodSync(ACCOUNTS_PATH, 0o600)
  return accounts
}

function newPassword() {
  return randomBytes(18).toString('base64url')
}

async function ensureAccounts(instance) {
  const env = envMap(envPath(instance))
  const base = `http://127.0.0.1:${env.ETERNA_PORT ?? INSTANCES[instance].port}`
  const accounts = loadOrCreateAccounts(env)

  const adminLogin = await login(base, accounts.admin.account, accounts.admin.password)
  if (adminLogin.status !== 200) {
    report('ACC-admin', false, `admin 登录失败 status=${adminLogin.status}（env 中 ETERNA_ACCESS_ADMIN_* 与数据根是否一致？）`)
    return { accounts, base, adminCookie: '' }
  }
  report('ACC-admin', true, `admin=${accounts.admin.account} login=200`)

  const list = await request(new URL('/access/api/users', base), { cookie: adminLogin.cookie })
  const existingUsers = (() => { try { return JSON.parse(list.text).users ?? [] } catch { return [] } })()

  for (const key of ['user_b', 'user_c']) {
    const target = accounts[key]
    const present = existingUsers.some(user => user.account === target.account)
    if (!present) {
      const created = await request(new URL('/access/api/users', base), {
        method: 'POST',
        cookie: adminLogin.cookie,
        body: { account: target.account, password: target.password, role: 'user' },
      })
      const finalAccount = (() => { try { return JSON.parse(created.text).finalAccount } catch { return undefined } })()
      if (finalAccount !== undefined && finalAccount !== target.account) {
        target.account = finalAccount
        writeFileSync(ACCOUNTS_PATH, `${JSON.stringify(accounts, null, 2)}\n`, { mode: 0o600 })
      }
      report(`ACC-${key}`, created.status === 201, `created status=${created.status} account=${target.account}`)
    } else {
      report(`ACC-${key}`, true, `account=${target.account} 已存在`)
    }
    const userLogin = await login(base, target.account, target.password)
    report(`ACC-${key}-login`, userLogin.status === 200, `login=${userLogin.status}`)
    // 登录即开通工作区（异步）：等库内出现归属行，最多 20s。
    const db = join(TEST_ROOT, instance, 'access', 'users.db')
    let workspaces = []
    for (let attempt = 0; attempt < 20; attempt++) {
      try {
        workspaces = readDb(db, 'SELECT w.workspace_id, w.path FROM workspaces w JOIN users u ON u.id = w.owner_id WHERE u.account = ?', [target.account])
      } catch { workspaces = [] }
      if (workspaces.length > 0) break
      await sleep(1000)
    }
    report(`ACC-${key}-workspace`, workspaces.length > 0,
      workspaces.length > 0 ? workspaces.map(row => row.workspace_id).join(',') : '20s 内未出现工作区行')
  }
  return { accounts, base, adminCookie: adminLogin.cookie }
}

/* --------------------------------------------------------------- E2 矩阵 */

async function prepareE2() {
  const { accounts, base } = await ensureAccounts('e1')
  const db = join(TEST_ROOT, 'e1', 'access', 'users.db')
  const rows = readDb(db, 'SELECT u.account, w.workspace_id FROM users u LEFT JOIN workspaces w ON w.owner_id = u.id ORDER BY u.id')
  for (const account of [accounts.admin.account, accounts.user_b.account, accounts.user_c.account]) {
    const owned = rows.filter(row => row.account === account)
    report(`E2-${account}`, owned.length > 0 && owned.every(row => typeof row.workspace_id === 'string'),
      `workspaces=${owned.map(row => row.workspace_id).join(',') || 'none'}`)
  }
  console.log(`[E2] 浏览器矩阵入口：${base}/login（A=${accounts.admin.account}，B=${accounts.user_b.account}，C=${accounts.user_c.account}）；口令在 ${ACCOUNTS_PATH}（0600），不打印`)
}

/* --------------------------------------------------------------- E5 迁移 */

function prepareE5(sourceArg) {
  const given = typeof sourceArg === 'string' ? resolve(sourceArg) : undefined
  if (given === undefined) {
    report('E5', false, '缺 --source（冷备目录或 .tgz 快照；本脚本拒绝直接读生产在线数据根）')
    return
  }
  const productionRoots = [join(homedir(), 'eterna-data'), join(homedir(), 'eterna-data', 'super')].map(item => resolve(item))
  if (productionRoots.includes(given)) {
    report('E5', false, `拒绝把生产根当源：${given}；请传冷备副本（48 runbook）`)
    return
  }
  if (!existsSync(given)) {
    report('E5', false, `源不存在：${given}`)
    return
  }

  // 冷备是 .tgz 时先解到测试根 staging（不执行任何归档内容；拒绝绝对路径/.. 逃逸）。
  let source = given
  if (/\.tgz$|\.tar\.gz$/.test(given)) {
    const listing = run('tar', ['-tzf', given], { timeout: 120_000 })
    const entries = listing.stdout.split('\n').filter(Boolean)
    const unsafe = entries.filter(entry => entry.startsWith('/') || entry.split('/').includes('..'))
    if (listing.status !== 0 || entries.length === 0 || unsafe.length > 0) {
      report('E5', false, `归档清单不可信（exit=${listing.status} entries=${entries.length} unsafe=${unsafe.length}）`)
      return
    }
    const staging = join(TEST_ROOT, '.e5-cold', given.split('/').pop().replace(/\.t?gz$/, ''))
    mkdirSync(staging, { recursive: true, mode: 0o700 })
    const extracted = run('tar', ['-xzf', given, '-C', staging], { timeout: 600_000 })
    report('E5-EXTRACT', extracted.status === 0, `${given} → ${staging} entries=${entries.length}（0600/0700 测试根内）`)
    if (extracted.status !== 0) return
    source = staging
  }

  const dest = join(TEST_ROOT, 'e5')
  mkdirSync(dest, { recursive: true, mode: 0o700 })
  const dry = run('rsync', ['-aH', '--dry-run', '--stats', `${source}/`, `${dest}/`], { timeout: 300_000 })
  const copy = dry.status === 0 ? run('rsync', ['-aH', '--stats', `${source}/`, `${dest}/`], { timeout: 600_000 }) : { status: -1, stdout: '' }
  report('E5', copy.status === 0, `rsync -aH ${source} → ${dest}（dry=${dry.status}）`)
  if (copy.status === 0) {
    console.log('[E5] 复核命令：bash scripts/verify-data-root.sh --migration-source ' + source + ' --migration-dest ' + dest)
  }
}

/* ------------------------------------------------------------------ 主流程 */

async function prepareInstance(instance) {
  const env = ensureEnvFile(instance)
  const root = initDataRoot(instance)
  if (args['dry-run'] === true) {
    const extra = instance === 'e1' ? ['-f', ensureE1Override()] : []
    const config = run('docker', [...composeBase(instance), ...extra, 'config'], { timeout: 60_000 })
    report(`CONFIG-${instance}`, config.status === 0, `compose config exit=${config.status}（--dry-run，不启动/重建容器）`)
    return { env, root, ok: config.status === 0 }
  }
  const ok = await composeUp(instance)
  return { env, root, ok }
}

if (COMMAND === 'e1' || COMMAND === 'all') {
  if (FRESH) {
    console.log(`[E1] --fresh：删除测试实例 ${join(TEST_ROOT, 'e1')} 与容器 ${INSTANCES.e1.container}`)
    spawnSync('docker', ['rm', '-f', INSTANCES.e1.container], { encoding: 'utf8' })
    spawnSync('rm', ['-rf', join(TEST_ROOT, 'e1')], { encoding: 'utf8' })
  }
  const state = await prepareInstance('e1')
  if (state.ok && args['dry-run'] !== true) await ensureAccounts('e1')
}

if (COMMAND === 'e2' || COMMAND === 'all') await prepareE2()

if (COMMAND === 'e3' || COMMAND === 'all') {
  const state = await prepareInstance('e3')
  if (state.ok) {
    const env = envMap(envPath('e3'))
    const inspect = spawnSync('docker', ['inspect', INSTANCES.e3.container, '--format', '{{range .Config.Env}}{{println .}}{{end}}'], { encoding: 'utf8', timeout: 15_000 })
    report('E3-FORM', (inspect.stdout ?? '').includes('ETERNA_FORM=super'), `ETERNA_FORM=${env.ETERNA_FORM ?? '?'}`)
  }
}

if (COMMAND === 'e4' || COMMAND === 'all') {
  ensureEnvFile('e4')
  initDataRoot('e4')
  const config = run('docker', [...composeBase('e4'), '--profile', 'acp', 'config'], { timeout: 60_000 })
  report('E4-ACP-CONFIG', config.status === 0 && config.stdout.includes('eterna-agent-acp'), `compose --profile acp config exit=${config.status}`)
}

if (COMMAND === 'e5' || (COMMAND === 'all' && typeof args.source === 'string')) {
  prepareE5(args.source)
} else if (COMMAND === 'all') {
  console.log('[E5] 未提供 --source，跳过迁移副本（需冷备目录）')
}

const failed = results.filter(item => !item.ok)
console.log(`\n[PREP] PASS=${results.length - failed.length} FAIL=${failed.length}`)
if (failed.length > 0) {
  console.log(failed.map(item => `  - ${item.id}: ${item.detail}`).join('\n'))
}
process.exit(failed.length === 0 ? 0 : 1)