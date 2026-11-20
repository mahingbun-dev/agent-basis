#!/usr/bin/env node
/**
 * E1 容器能力套件（BOOT/MCPS/TERM/IMP/OFF/CMD/HERO）测试环境准备。
 *
 * 隔离面：
 *   - 独立 compose 项目 `rc5-e1suite`、独立容器 `rc5-e1suite`、独立数据根
 *     `$HOME/eterna-data/test-20261120/{e1,fresh}`；
 *   - 独立宿主端口 3118（3108 被另一 lane 的 24h 浸泡容器占用；重启会破坏其证据，
 *     见 artifacts/rc5/E1/_setup/result.md §环境偏差）；
 *   - 镜像 tag `eterna-agent:rc5-test`，启动前校验解析到的 image ID 并记录。
 *
 * 凭据纪律：本脚本不生成、不打印、不落盘任何口令。主实例的 access 状态（users.db
 * 快照 + secret.key）从既有 0600 测试根只读复制，登录口令从既有 0600 账号文件读入
 * 内存（`--accounts-file`），证据只记录状态码。
 *
 * 子命令：
 *   init   建数据根 + 复制 access 状态 + 写 env/override（不启动）
 *   up     确保容器启动并 healthy（幂等）
 *   down   停止/删除本 lane 容器（不动其它项目）
 *   status 打印容器健康/镜像/端口
 */
import { chmodSync, copyFileSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(here, '..', '..', '..', '..')
export const LANE = {
  repoRoot,
  evidenceRoot: resolve(repoRoot, 'artifacts', 'rc5', 'E1'),
  dataBase: resolve(homedir(), 'eterna-data', 'test-20261120'),
  instance: 'e1',
  freshInstance: 'fresh',
  project: 'rc5-e1suite',
  container: 'rc5-e1suite',
  port: 3118,
  relayPort: 9321,
  imageTag: 'eterna-agent:rc5-test',
  expectedImageId: 'sha256:99d8e85b509b6e3e1990481b2742a98cd550161621491cba16964d801d838f00',
}
LANE.dataRoot = join(LANE.dataBase, LANE.instance)
LANE.freshRoot = join(LANE.dataBase, LANE.freshInstance)
LANE.envFile = join(LANE.dataBase, '.env.e1suite')
LANE.freshEnvFile = join(LANE.dataBase, '.env.fresh')
LANE.override = join(here, 'compose.e1suite.override.yml')
LANE.fixtures = join(repoRoot, 'tests', 'fixtures')
LANE.sourceTestRoot = resolve(homedir(), 'eterna-data', 'test-rc5', 'e1')
LANE.accountsFile = resolve(homedir(), 'eterna-data', 'test-rc5', '.test-accounts.json')
LANE.logFile = join(here, 'cmd.log')

const command = process.argv[2] ?? 'init'

function log(line) {
  const text = `[setup] ${line}`
  console.log(text)
  appendFile(text)
}
function appendFile(line) {
  const stamp = new Date().toISOString()
  writeFileSync(LANE.logFile, `${stamp} ${line}\n`, { flag: 'a' })
}
function cmdLine(cmd, args) {
  return [cmd, ...args].map(item => (/^[A-Za-z0-9_./:=@-]+$/.test(item) ? item : `'${item.replace(/'/g, `'\\''`)}'`)).join(' ')
}
function run(cmd, args, { env, timeout = 600_000 } = {}) {
  const printable = cmdLine(cmd, args)
  const result = spawnSync(cmd, args, { encoding: 'utf8', timeout, env: env ?? process.env, maxBuffer: 64 * 1024 * 1024 })
  const exit = result.status ?? -1
  writeFileSync(LANE.logFile, `$ ${printable}\nEXIT=${exit}\n${(result.stdout ?? '').trim()}\n${(result.stderr ?? '').trim()}\n---\n`, { flag: 'a' })
  return { exit, stdout: (result.stdout ?? '').trim(), stderr: (result.stderr ?? '').trim(), printable }
}
async function sleep(ms) { await new Promise(resolvePromise => setTimeout(resolvePromise, ms)) }

function ensureMode(path, mode) {
  if (existsSync(path)) chmodSync(path, mode)
}

/* -------------------------------------------------------------- 数据根 */

function initDirs() {
  const result = run('bash', [join(repoRoot, 'deploy', 'init-data-dirs.sh'), LANE.instance, LANE.freshInstance], {
    env: { ...process.env, ETERNA_DATA_ROOT: LANE.dataBase },
  })
  if (result.exit !== 0) throw new Error(`init-data-dirs exit=${result.exit}`)
  for (const dir of [LANE.dataBase, LANE.dataRoot, LANE.freshRoot]) {
    const mode = (statSync(dir).mode & 0o777).toString(8)
    log(`data dir ${dir} mode=${mode}`)
    if (mode !== '700') throw new Error(`${dir} mode=${mode}（期望 700）`)
  }
}

/** 主实例 access 状态从既有测试根只读复制：users.db（sqlite 快照）+ secret.key。 */
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
  // 账号行数只打印计数，不打印账号口令。
  const count = run('sqlite3', [targetDb, 'SELECT COUNT(*) FROM users'])
  log(`users.db 账号行数=${count.stdout}`)
  ensureMode(targetDb, 0o600)
}

/* -------------------------------------------------------------- env 文件 */

function writeEnvFiles() {
  const base = (instance, port, extra) => [
    `# E1 套件测试实例（lane 生成；0600；不含任何凭据）`,
    `ETERNA_DATA_ROOT=${LANE.dataBase}`,
    `ETERNA_INSTANCE=${instance}`,
    `ETERNA_PORT=${port}`,
    `ETERNA_RELAY_PORT=${LANE.relayPort}`,
    `ETERNA_CONTAINER_NAME=${LANE.container}`,
    `ETERNA_IMAGE=${LANE.imageTag}`,
    `ETERNA_FORM=web`,
    `ETERNA_TRUSTED_HOST=127.0.0.1:${port} localhost:${port}`,
    `MIMO_API_KEY=${extra.mimo}`,
    `RC5_FIXTURES=${LANE.fixtures}`,
    '',
  ].join('\n')

  writeFileSync(LANE.envFile, base(LANE.instance, LANE.port, {
    // 占位值：入口脚本仅要求非空；不用于任何 LLM 调用，不构成凭据。
    mimo: 'e1suite-placeholder-not-a-secret',
  }), { mode: 0o600 })
  chmodSync(LANE.envFile, 0o600)

  writeFileSync(LANE.freshEnvFile, base(LANE.freshInstance, LANE.port, {
    mimo: 'e1suite-placeholder-not-a-secret',
  }).replace(`ETERNA_CONTAINER_NAME=${LANE.container}`, `ETERNA_CONTAINER_NAME=${LANE.container}-fresh`), { mode: 0o600 })
  chmodSync(LANE.freshEnvFile, 0o600)

  const override = [
    '# E1 套件 override：夹具只读挂载（夹具不进镜像；测试环境专用）',
    'services:',
    '  eterna-agent:',
    '    volumes:',
    '      - ${RC5_FIXTURES:?set RC5_FIXTURES}:/fixtures:ro',
    '',
  ].join('\n')
  writeFileSync(LANE.override, override, { mode: 0o644 })

  // 支持脚本存在性与可见性：可执行探针落在数据根，不进仓库。
  const probeDir = join(LANE.dataRoot, 'probes')
  mkdirSync(probeDir, { recursive: true, mode: 0o700 })
  writeFileSync(join(probeDir, 'hello.txt'), 'e1suite-probe\n', { mode: 0o600 })
  log(`env 文件: ${LANE.envFile}（0600）; override: ${LANE.override}`)
}

/* -------------------------------------------------------------- compose */

function composeArgs(envFile = LANE.envFile) {
  return ['compose', '-p', LANE.project, '--env-file', envFile,
    '-f', join(repoRoot, 'docker-compose.yml'), '-f', LANE.override]
}

function currentImageId() {
  const result = run('docker', ['image', 'inspect', LANE.imageTag, '--format', '{{.Id}}'])
  return result.exit === 0 ? result.stdout : ''
}

async function up() {
  const imageId = currentImageId()
  log(`镜像 tag=${LANE.imageTag} id=${imageId}`)
  if (imageId === '' ) throw new Error('镜像 tag 不存在')
  if (LANE.expectedImageId !== '' && imageId !== LANE.expectedImageId) {
    throw new Error(`镜像 ID 漂移：${imageId} ≠ 期望 ${LANE.expectedImageId}（期间有其它 lane 重建，需重定基线）`)
  }
  const cfg = run('docker', [...composeArgs(), 'config', '--quiet'])
  if (cfg.exit !== 0) throw new Error(`compose config exit=${cfg.exit}`)
  log('compose config OK')
  const upResult = run('docker', [...composeArgs(), 'up', '-d', 'eterna-agent'])
  if (upResult.exit !== 0) throw new Error(`compose up exit=${upResult.exit}`)
  await waitHealthy(LANE.container)
}

async function waitHealthy(container, tries = 90) {
  let health = 'unknown'
  for (let attempt = 0; attempt < tries; attempt++) {
    const probe = spawnSync('docker', ['inspect', container, '--format', '{{.State.Health.Status}}'], { encoding: 'utf8' })
    health = (probe.stdout ?? '').trim()
    if (health === 'healthy') break
    if ((probe.stderr ?? '').includes('No such object')) break
    await sleep(2000)
  }
  log(`container=${container} health=${health}`)
  if (health !== 'healthy') throw new Error(`${container} health=${health}`)
  return health
}

/* -------------------------------------------------------------- 输出 */

function writeResult(fields) {
  const lines = [
    '# E1 套件测试环境',
    '',
    `- 生成：${new Date().toISOString()}`,
    `- 镜像：\`${LANE.imageTag}\` → \`${fields.imageId}\``,
    `- 容器：\`${LANE.container}\`（项目 \`${LANE.project}\`），宿主端口 **${LANE.port}** → 8080`,
    `- 数据根：\`${LANE.dataRoot}\`（fresh 根：\`${LANE.freshRoot}\`）`,
    `- 夹具：\`${LANE.fixtures}\` → \`/fixtures:ro\``,
    `- 健康：${fields.health}`,
    `- 账号快照：users 行数 ${fields.userRows}（口令不落证据）`,
    '',
    '## 环境偏差（必须知悉）',
    '',
    `- 54 §6.1 规定 E1 用 **3108**。本 lane 运行期间 3108 由另一 lane 的 24h 浸泡容器`,
    `  \`eterna-rc5-e1\` 占用（PID 记录 \`artifacts/rc5/p5/testbed/soak/soak.pid\`）；该浸泡`,
    `  以容器连续性为判据，重启/改写会破坏其 P0 证据。故本 lane 使用同一镜像（当前`,
    `  worktree 构建）在**独立项目/独立容器/独立数据根/独立端口 3118** 上执行，`,
    `  容器隔离强度与 3108 等价；生产容器 \`eterna-agent\`（3210）全程未触碰。`,
    '',
    '## 复现',
    '',
    '```bash',
    `node artifacts/rc5/E1/_setup/setup.mjs init`,
    `node artifacts/rc5/E1/_setup/setup.mjs up`,
    '```',
    '',
  ]
  writeFileSync(join(here, 'result.md'), lines.join('\n'))
}

async function main() {
  if (command === 'init') {
    initDirs()
    seedAccess()
    writeEnvFiles()
    const imageId = currentImageId()
    const count = run('sqlite3', [join(LANE.dataRoot, 'access', 'users.db'), 'SELECT COUNT(*) FROM users'])
    writeResult({ imageId, health: 'not-started', userRows: count.stdout })
    log('init 完成')
    return
  }
  if (command === 'up') {
    await up()
    const inspect = run('docker', ['inspect', LANE.container, '--format',
      '{{.Image}} {{.State.Health.Status}} {{json .NetworkSettings.Ports}}'])
    log(`inspect: ${inspect.stdout}`)
    const count = run('sqlite3', [join(LANE.dataRoot, 'access', 'users.db'), 'SELECT COUNT(*) FROM users'])
    writeResult({ imageId: inspect.stdout.split(' ')[0] ?? '', health: 'healthy', userRows: count.stdout })
    log('up 完成')
    return
  }
  if (command === 'down') {
    const result = run('docker', ['compose', '-p', LANE.project, '--env-file', LANE.envFile,
      '-f', join(repoRoot, 'docker-compose.yml'), '-f', LANE.override, 'down', '--remove-orphans'])
    log(`down exit=${result.exit}`)
    return
  }
  if (command === 'status') {
    const result = run('docker', ['ps', '-a', '--filter', `name=${LANE.container}`, '--format', '{{.Names}} {{.Image}} {{.Status}} {{.Ports}}'])
    console.log(result.stdout)
    return
  }
  throw new Error(`未知子命令: ${command}`)
}

main().catch(error => {
  console.error(`[setup] FAIL: ${error.message}`)
  appendFile(`FAIL ${error.message}`)
  process.exit(1)
})