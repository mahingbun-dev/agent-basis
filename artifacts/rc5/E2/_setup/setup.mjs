#!/usr/bin/env node
/**
 * E2 双账号租户隔离套件（MCPP/ACC/TERM/UI/SEC；54 §6.1；51 §3.4–3.7/3.15/3.16）
 * 测试环境准备。
 *
 * 隔离面（与 E1 同款，见 artifacts/rc5/E1/_setup/result.md）：
 *   - 54 §6.1 规定 3108。本 lane 运行期间 3108 由另一 lane 的 24h 浸泡容器
 *     `eterna-rc5-e1` 占用；故使用**独立 compose 项目/容器/数据根/端口 3119**，
 *     容器隔离强度与 3108 等价（同镜像 sha256:99d8e85b…d838f00）。
 *   - 数据根 `$HOME/eterna-data/test-20261120/e2`；生产容器 eterna-agent（3210）
 *     与其它 lane 容器全程不触碰。
 *   - 账号快照（users.db + secret.key）从既有 0600 测试根只读复制；口令不打印、
 *     不落盘、不进 argv。
 *   - 个人层 MCP 主密钥只落数据根 `.secrets/mcp-master-key`（0600，容器内
 *     `/data/.secrets/...`），经 ETERNA_MCP_MASTER_KEY_FILE 读取；不进 env 值。
 *
 * 子命令：
 *   init    数据根 + access 快照 + 主密钥 + env/override
 *   up      启动并等 healthy（幂等）
 *   down    停止/删除本 lane 容器（不动其它项目）
 *   status  打印容器/端口/健康
 *   provision 三账号登录并确保各自工作区（WA/WB/WC）已登记
 */
import { chmodSync, copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(here, '..', '..', '..', '..')

export const LANE = {
  repoRoot,
  evidenceRoot: resolve(repoRoot, 'artifacts', 'rc5', 'E2'),
  dataBase: resolve(homedir(), 'eterna-data', 'test-20261120'),
  instance: 'e2',
  project: 'rc5-e2suite',
  container: 'rc5-e2suite',
  port: 3119,
  relayPort: 9322,
  imageTag: 'eterna-agent:rc5-test',
  expectedImageId: 'sha256:22fe8acb436f2ce24ea7a6b790b08462b9b769e10b98acb096590352b739bcfb',
}
LANE.dataRoot = join(LANE.dataBase, LANE.instance)
LANE.envFile = join(LANE.dataBase, '.env.e2suite')
LANE.override = join(here, 'compose.e2suite.override.yml')
LANE.fixtures = join(repoRoot, 'tests', 'fixtures')
LANE.sourceTestRoot = resolve(homedir(), 'eterna-data', 'test-rc5', 'e1')
LANE.accountsFile = resolve(homedir(), 'eterna-data', 'test-rc5', '.test-accounts.json')
LANE.masterKeyFile = join(LANE.dataRoot, '.secrets', 'mcp-master-key')
LANE.logFile = join(here, 'cmd.log')

const command = process.argv[2] ?? 'init'

function log(line) {
  const text = `[setup] ${line}`
  console.log(text)
  writeFileSync(LANE.logFile, `${new Date().toISOString()} ${text}\n`, { flag: 'a' })
}
function cmdLine(items) {
  return items.map(item => (/^[A-Za-z0-9_./:=@%{}$,-]+$/.test(item) ? item : `'${item.replace(/'/g, `'\\''`)}'`)).join(' ')
}
function run(cmd, args, { env, timeout = 600_000, display } = {}) {
  const printable = display ?? cmdLine([cmd, ...args])
  const result = spawnSync(cmd, args, { encoding: 'utf8', timeout, env: env ?? process.env, maxBuffer: 64 * 1024 * 1024 })
  const exit = result.status ?? -1
  writeFileSync(LANE.logFile, `$ ${printable}\nEXIT=${exit}\n${(result.stdout ?? '').trim()}\n${(result.stderr ?? '').trim()}\n---\n`, { flag: 'a' })
  return { exit, stdout: (result.stdout ?? '').trim(), stderr: (result.stderr ?? '').trim(), printable }
}
const sleep = ms => new Promise(done => setTimeout(done, ms))

/**
 * 只读查询必须用 node:sqlite readOnly。
 * 宿主 `sqlite3` CLI 对 virtiofs 上的 WAL 库会在关闭时 checkpoint/删除 -wal，
 * 容器内进程仍持有已被 unlink 的 WAL inode → 应用写入全部丢失（本 lane 实测）。
 * 因此容器启动后**禁止**用宿主 sqlite3 CLI 触碰 users.db。
 */
function queryDb(sql) {
  const code = 'const {DatabaseSync}=require("node:sqlite");const db=new DatabaseSync(process.argv[1],{readOnly:true});db.exec("PRAGMA busy_timeout=5000");process.stdout.write(JSON.stringify(db.prepare(process.argv[2]).all()))'
  const result = spawnSync(process.execPath, ['-e', code, join(LANE.dataRoot, 'access', 'users.db'), sql], { encoding: 'utf8', timeout: 20_000 })
  if (result.status !== 0) throw new Error(`sqlite 只读查询失败: ${(result.stderr ?? '').slice(0, 200)}`)
  return JSON.parse(result.stdout)
}

function ensureMode(path, mode) {
  if (existsSync(path)) chmodSync(path, mode)
}

/* -------------------------------------------------------------- 数据根 */

function initDirs() {
  const result = run('bash', [join(repoRoot, 'deploy', 'init-data-dirs.sh'), LANE.instance], {
    env: { ...process.env, ETERNA_DATA_ROOT: LANE.dataBase },
  })
  if (result.exit !== 0) throw new Error(`init-data-dirs exit=${result.exit}`)
  for (const dir of [LANE.dataBase, LANE.dataRoot]) {
    const mode = (statSync(dir).mode & 0o777).toString(8)
    log(`data dir ${dir} mode=${mode}`)
    if (mode !== '700') throw new Error(`${dir} mode=${mode}（期望 700）`)
  }
  const secretsDir = join(LANE.dataRoot, '.secrets')
  mkdirSync(secretsDir, { recursive: true, mode: 0o700 })
  chmodSync(secretsDir, 0o700)
}

/** 主实例 access 状态从既有 0600 测试根只读复制（口令/密钥不入证据）。 */
function seedAccess() {
  const accessDir = join(LANE.dataRoot, 'access')
  mkdirSync(accessDir, { recursive: true, mode: 0o700 })
  chmodSync(accessDir, 0o700)
  const sourceDb = join(LANE.sourceTestRoot, 'access', 'users.db')
  const targetDb = join(accessDir, 'users.db')
  if (!existsSync(sourceDb)) throw new Error(`源 users.db 不存在: ${sourceDb}`)
  if (!existsSync(targetDb)) {
    const backup = run('sqlite3', [sourceDb, `.backup '${targetDb}'`])
    if (backup.exit !== 0) throw new Error(`sqlite backup exit=${backup.exit}`)
    log(`users.db 快照完成（${targetDb}）`)
  } else {
    log('users.db 已存在，跳过复制（幂等）')
  }
  const sourceSecret = join(LANE.sourceTestRoot, 'access', 'secret.key')
  const targetSecret = join(accessDir, 'secret.key')
  if (!existsSync(targetSecret) && existsSync(sourceSecret)) {
    copyFileSync(sourceSecret, targetSecret)
    chmodSync(targetSecret, 0o600)
    log('secret.key 已复制（0600，不入证据）')
  }
  ensureMode(targetDb, 0o600)
  // 夹具只保留账号：E1 快照里的 workspace/session/个人 MCP 行属于 E1 租户状态，
  // 带进 E2 会与 E2 上游 workspace.json 脱节（且触发 boot 的 orphan 划归 admin）。
  // 这些表在 E2 首启前清空，由登录开通与用例本身重新记账。
  const clean = run('sqlite3', [targetDb,
    'DELETE FROM workspaces; DELETE FROM sessions; DELETE FROM mcp_personal_server; DELETE FROM mcp_personal_secret;'])
  if (clean.exit !== 0) throw new Error(`清理 E1 租户快照失败 exit=${clean.exit}`)
  const count = run('sqlite3', [targetDb, 'SELECT COUNT(*) FROM users'])
  log(`users.db 账号行数=${count.stdout}（workspace/session/个人 MCP 行已清空）`)
  const roles = run('sqlite3', [targetDb, "SELECT role || ':' || COUNT(*) FROM users GROUP BY role"])
  log(`users.db 角色分布=${roles.stdout.replace(/\n/g, ',')}`)
}

/** 32B 主密钥：只落 .secrets（0600），hex 值不回显、不进 env/argv。 */
function seedMasterKey() {
  if (!existsSync(LANE.masterKeyFile)) {
    const key = randomBytes(32).toString('hex')
    writeFileSync(LANE.masterKeyFile, `${key}\n`, { mode: 0o600 })
    chmodSync(LANE.masterKeyFile, 0o600)
    log('个人层 MCP 主密钥已生成（0600，.secrets）')
  } else {
    log('主密钥已存在（幂等）')
  }
}

/* -------------------------------------------------------------- env/override */

function writeEnvFiles() {
  const lines = [
    '# E2 双账号套件测试实例（lane 生成；0600；不含任何口令/密钥值）',
    `ETERNA_DATA_ROOT=${LANE.dataBase}`,
    `ETERNA_INSTANCE=${LANE.instance}`,
    `ETERNA_PORT=${LANE.port}`,
    `ETERNA_RELAY_PORT=${LANE.relayPort}`,
    `ETERNA_CONTAINER_NAME=${LANE.container}`,
    `ETERNA_IMAGE=${LANE.imageTag}`,
    'ETERNA_FORM=web',
    `ETERNA_TRUSTED_HOST=127.0.0.1:${LANE.port} localhost:${LANE.port}`,
    // 占位值：入口脚本仅要求非空；不用于任何 LLM 调用，不构成凭据。
    'MIMO_API_KEY=e2suite-placeholder-not-a-secret',
    `RC5_FIXTURES=${LANE.fixtures}`,
    // 个人层 MCP：主密钥文件（容器内路径；值不在 env/argv）
    'ETERNA_MCP_MASTER_KEY_FILE=/data/.secrets/mcp-master-key',
    `ETERNA_MCP_PERSONAL_ENABLED=true`,
    // 管理员 stdio 目录：echo 夹具只读挂载在 /fixtures（夹具不进镜像）
    `ETERNA_MCP_PERSONAL_CATALOG=${JSON.stringify([
      { name: 'echo', label: 'Echo 夹具', command: 'node', args: ['/fixtures/mcp-echo-server.mjs'] },
    ])}`,
    '',
  ]
  writeFileSync(LANE.envFile, lines.join('\n'), { mode: 0o600 })
  chmodSync(LANE.envFile, 0o600)

  const override = [
    '# E2 套件 override：夹具只读挂载 + 个人层 MCP 环境（测试环境专用）',
    'services:',
    '  eterna-agent:',
    '    volumes:',
    '      - ${RC5_FIXTURES:?set RC5_FIXTURES}:/fixtures:ro',
    '    environment:',
    '      ETERNA_MCP_PERSONAL_ENABLED: ${ETERNA_MCP_PERSONAL_ENABLED:-true}',
    '      ETERNA_MCP_PERSONAL_CATALOG: ${ETERNA_MCP_PERSONAL_CATALOG:?set ETERNA_MCP_PERSONAL_CATALOG}',
    '      ETERNA_MCP_MASTER_KEY_FILE: ${ETERNA_MCP_MASTER_KEY_FILE:?set ETERNA_MCP_MASTER_KEY_FILE}',
    '      ETERNA_TENANT_ROOT: /data/workspaces',
    '',
  ].join('\n')
  writeFileSync(LANE.override, override, { mode: 0o644 })
  log(`env 文件: ${LANE.envFile}（0600）; override: ${LANE.override}`)
}

/* -------------------------------------------------------------- compose */

function composeArgs() {
  return ['compose', '-p', LANE.project, '--env-file', LANE.envFile,
    '-f', join(repoRoot, 'docker-compose.yml'), '-f', LANE.override]
}

function currentImageId() {
  const result = run('docker', ['image', 'inspect', LANE.imageTag, '--format', '{{.Id}}'])
  return result.exit === 0 ? result.stdout : ''
}

async function waitHealthy(container, tries = 120) {
  let health = 'unknown'
  for (let attempt = 0; attempt < tries; attempt++) {
    const probe = spawnSync('docker', ['inspect', container, '--format', '{{.State.Health.Status}}'], { encoding: 'utf8' })
    health = (probe.stdout ?? '').trim()
    if (health === 'healthy') break
    if ((probe.stderr ?? '').includes('No such object')) break
    await sleep(2000)
  }
  log(`container=${container} health=${health}`)
  return health
}

async function up() {
  const imageId = currentImageId()
  log(`镜像 tag=${LANE.imageTag} id=${imageId}`)
  if (imageId === '') throw new Error('镜像 tag 不存在')
  if (LANE.expectedImageId !== '' && imageId !== LANE.expectedImageId) {
    throw new Error(`镜像 ID 漂移：${imageId} ≠ 期望 ${LANE.expectedImageId}`)
  }
  const cfg = run('docker', [...composeArgs(), 'config', '--quiet'])
  if (cfg.exit !== 0) throw new Error(`compose config exit=${cfg.exit}`)
  log('compose config OK')
  const upResult = run('docker', [...composeArgs(), 'up', '-d', 'eterna-agent'])
  if (upResult.exit !== 0) throw new Error(`compose up exit=${upResult.exit}`)
  const health = await waitHealthy(LANE.container)
  if (health !== 'healthy') throw new Error(`${LANE.container} health=${health}`)
  return { imageId, health }
}

/* -------------------------------------------------------------- provision */

async function provision() {
  const { loadAccounts, login, bootstrapDshSession, bootTokenFromContainer, rpc } =
    await import(join(repoRoot, 'scripts', 'rc5-test-client.mjs'))
  const base = `http://127.0.0.1:${LANE.port}`
  const accounts = loadAccounts(LANE.accountsFile)
  const dsh = await bootstrapDshSession(base, bootTokenFromContainer(LANE.container))
  const out = {}
  for (const key of ['admin', 'user_b', 'user_c']) {
    const auth = await login(base, accounts[key].account, accounts[key].password)
    const cookie = `${dsh}; ${auth.cookie}`
    const created = await rpc(base, cookie, 'workspace/initializeDefault', {})
    const ws = created.value?.workspace
    const list = await rpc(base, cookie, 'workspace/list', {})
    out[key] = {
      login: auth.status,
      initializeDefault: created.ok === true,
      workspaceId: ws?.workspaceId ?? null,
      workspacePath: ws?.path ?? null,
      workspaceList: Array.isArray(list.value?.workspaces) ? list.value.workspaces.length : null,
    }
  }
  writeFileSync(join(here, 'provision.json'), JSON.stringify(out, null, 2))
  log(`provision: ${JSON.stringify(Object.fromEntries(Object.entries(out).map(([k, v]) => [k, `login=${v.login} ws=${v.workspacePath}`])))}`)
}

/* -------------------------------------------------------------- 输出 */

function writeResult(fields) {
  const lines = [
    '# E2 套件测试环境',
    '',
    `- 生成：${new Date().toISOString()}`,
    `- 镜像：\`${LANE.imageTag}\` → \`${fields.imageId}\``,
    `- 容器：\`${LANE.container}\`（项目 \`${LANE.project}\`），宿主端口 **${LANE.port}** → 8080；relay ${LANE.relayPort} → 9310`,
    `- 数据根：\`${LANE.dataRoot}\``,
    `- 夹具：\`${LANE.fixtures}\` → \`/fixtures:ro\``,
    `- 个人层 MCP：catalog=echo（stdio，/fixtures/mcp-echo-server.mjs）；主密钥=\`/data/.secrets/mcp-master-key\`（0600）`,
    `- 健康：${fields.health}`,
    `- 账号快照：users 行数 ${fields.userRows}（口令不落证据）`,
    '',
    '## 环境偏差（必须知悉）',
    '',
    '- 54 §6.1 规定 E2 使用 3108 容器。本 lane 运行期间 3108 由另一 lane 的 24h 浸泡容器',
    '  `eterna-rc5-e1` 占用；该浸泡以容器连续性为判据，重启/改写会破坏其 P0 证据。',
    '  故本 lane 用同一镜像在**独立项目/容器/数据根/端口 3119** 上执行，',
    '  容器隔离强度与 3108 等价；生产容器 `eterna-agent`（3210）全程未触碰。',
    '',
    '## 夹具纪律（实测踩坑，必须遵守）',
    '',
    '- 宿主 `sqlite3` CLI 对 virtiofs 上的 WAL 库（`/data/access/users.db`）会在关闭时',
    '  执行 checkpoint 并删除 `-wal`；容器内进程仍持有已 unlink 的 WAL inode，此后',
    '  所有记账（workspace/session 归属）写入都落在已删除 inode，外部读取为空。',
    '  本 lane 实测一次（工作区账本 0 行）后重建数据根；之后所有宿主侧读取一律用',
    '  `node:sqlite` `{readOnly:true}`，写操作只在容器停止时执行。',
    '- 快照只保留 users 三账号；E1 的 workspace/session/个人 MCP 行在首启前清空，',
    '  否则会与 E2 上游 `workspace.json` 脱节并被 boot 的 orphan 划归 admin。',
    '',
    '## 复现',
    '',
    '```bash',
    'node artifacts/rc5/E2/_setup/setup.mjs init',
    'node artifacts/rc5/E2/_setup/setup.mjs up',
    'node artifacts/rc5/E2/_setup/setup.mjs provision',
    '```',
    '',
  ]
  writeFileSync(join(here, 'result.md'), lines.join('\n'))
}

async function main() {
  if (command === 'init') {
    initDirs()
    seedAccess()
    seedMasterKey()
    writeEnvFiles()
    const imageId = currentImageId()
    const count = run('sqlite3', [join(LANE.dataRoot, 'access', 'users.db'), 'SELECT COUNT(*) FROM users'])
    writeResult({ imageId, health: 'not-started', userRows: count.stdout })
    log('init 完成')
    return
  }
  if (command === 'up') {
    const { imageId, health } = await up()
    const count = queryDb('SELECT COUNT(*) AS n FROM users')
    writeResult({ imageId, health, userRows: count[0]?.n ?? '?' })
    log('up 完成')
    return
  }
  if (command === 'down') {
    const result = run('docker', [...composeArgs(), 'down', '--remove-orphans'])
    log(`down exit=${result.exit}`)
    return
  }
  if (command === 'status') {
    const result = run('docker', ['ps', '-a', '--filter', `name=${LANE.container}`, '--format', '{{.Names}} {{.Image}} {{.Status}} {{.Ports}}'])
    console.log(result.stdout)
    return
  }
  if (command === 'provision') {
    await provision()
    return
  }
  if (command === 'reset') {
    const down = run('docker', [...composeArgs(), 'down', '--remove-orphans'])
    log(`down exit=${down.exit}`)
    rmSync(LANE.dataRoot, { recursive: true, force: true })
    log(`数据根已删除（仅本 lane）: ${LANE.dataRoot}`)
    return
  }
  throw new Error(`未知子命令: ${command}`)
}

main().catch(error => {
  console.error(`[setup] FAIL: ${error.message}`)
  writeFileSync(LANE.logFile, `${new Date().toISOString()} FAIL ${error.message}\n`, { flag: 'a' })
  process.exit(1)
})