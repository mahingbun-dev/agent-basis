/** E2 套件公共环境：路径、docker 调用、三账号 cookie、DB 读取。 */
import { existsSync, readFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  bootTokenFromContainer,
  bootstrapDshSession,
  loadAccounts,
  login,
  rpc,
} from '../../../../scripts/rc5-test-client.mjs'
import { redact, shape } from './evidence.mjs'

const here = dirname(fileURLToPath(import.meta.url))
export const REPO = resolve(here, '..', '..', '..', '..')

export const LANE = {
  repoRoot: REPO,
  evidenceRoot: resolve(REPO, 'artifacts', 'rc5', 'E2'),
  dataBase: resolve(homedir(), 'eterna-data', 'test-20261120'),
  instance: 'e2',
  project: 'rc5-e2suite',
  container: 'rc5-e2suite',
  port: 3119,
  base: 'http://127.0.0.1:3119',
  imageTag: 'eterna-agent:rc5-test',
  imageId: 'sha256:99d8e85b509b6e3e1990481b2742a98cd550161621491cba16964d801d838f00',
  fixtures: resolve(REPO, 'tests', 'fixtures'),
  accountsFile: resolve(homedir(), 'eterna-data', 'test-rc5', '.test-accounts.json'),
  sourceTestRoot: resolve(homedir(), 'eterna-data', 'test-rc5', 'e1'),
  composeEnv: resolve(homedir(), 'eterna-data', 'test-20261120', '.env.e2suite'),
  override: resolve(REPO, 'artifacts', 'rc5', 'E2', '_setup', 'compose.e2suite.override.yml'),
}
LANE.dataRoot = join(LANE.dataBase, LANE.instance)

export function run(cmd, args, { env, timeout = 300_000, input } = {}) {
  const printable = [cmd, ...args].map(item => (/^[A-Za-z0-9_./:=@%{},-]+$/.test(item) ? item : `'${item.replace(/'/g, `'\\''`)}'`)).join(' ')
  const result = spawnSync(cmd, args, {
    encoding: 'utf8', timeout, env: env ?? process.env, input,
    maxBuffer: 64 * 1024 * 1024,
  })
  return {
    exit: result.status ?? -1,
    stdout: (result.stdout ?? '').trim(),
    stderr: (result.stderr ?? '').trim(),
    display: redact(printable),
  }
}

export function docker(args, options) {
  return run('docker', args, options)
}

export function sleep(ms) {
  return new Promise(done => setTimeout(done, ms))
}

export async function waitHealth(container, tries = 60) {
  let health = 'unknown'
  for (let attempt = 0; attempt < tries; attempt++) {
    const probe = docker(['inspect', container, '--format', '{{.State.Health.Status}}'])
    health = probe.stdout
    if (health === 'healthy' || health === 'unhealthy' || probe.stderr.includes('No such object')) break
    await sleep(2000)
  }
  return health
}

/* --------------------------------------------------------------- 账号 */

let cached = undefined

export async function sessions() {
  if (cached !== undefined) return cached
  const accounts = loadAccounts(LANE.accountsFile)
  const base = LANE.base
  const dsh = await bootstrapDshSession(base, bootTokenFromContainer(LANE.container))
  // 登录限速 5/min（ip+账号）：429 时等一个窗口再试一次，避免把限速误判成认证失败。
  const authOf = async (key) => {
    let auth = await login(base, accounts[key].account, accounts[key].password)
    if (auth.status === 429) {
      await sleep(65_000)
      auth = await login(base, accounts[key].account, accounts[key].password)
    }
    return auth
  }
  const authA = await authOf('admin')
  const authB = await authOf('user_b')
  const authC = await authOf('user_c')
  cached = {
    accounts,
    dsh,
    admin: { ...authA, cookie: `${dsh}; ${authA.cookie}`, account: accounts.admin.account },
    userB: { ...authB, cookie: `${dsh}; ${authB.cookie}`, account: accounts.user_b.account },
    userC: { ...authC, cookie: `${dsh}; ${authC.cookie}`, account: accounts.user_c.account },
  }
  return cached
}

export async function call(cookie, method, args = {}, options = {}) {
  return rpc(LANE.base, cookie, method, args, { timeoutMs: options.timeoutMs ?? 60_000 })
}

/* --------------------------------------------------------------- DB */

export function readDb(sql, params = [], dbPath = join(LANE.dataRoot, 'access', 'users.db')) {
  if (!existsSync(dbPath)) throw new Error(`DB 不存在: ${dbPath}`)
  const code = 'const {DatabaseSync}=require("node:sqlite");const db=new DatabaseSync(process.argv[1],{readOnly:true});db.exec("PRAGMA busy_timeout=5000");process.stdout.write(JSON.stringify(db.prepare(process.argv[2]).all(...JSON.parse(process.argv[3]))))'
  const result = spawnSync(process.execPath, ['-e', code, dbPath, sql, JSON.stringify(params)], { encoding: 'utf8', timeout: 20_000 })
  if (result.status !== 0) throw new Error(`sqlite 读取失败: ${(result.stderr ?? '').slice(0, 240)}`)
  return JSON.parse(result.stdout)
}

export function userIdOf(account) {
  return readDb('SELECT id FROM users WHERE account = ?', [account])[0]?.id
}

export function workspaceOf(userId) {
  return readDb('SELECT workspace_id, path FROM workspaces WHERE owner_id = ?', [userId])[0]
}

export function gitHead() {
  const result = run('git', ['-C', REPO, 'rev-parse', 'HEAD'])
  return result.stdout
}

export { shape, redact }

export function imageInfo() {
  const result = docker(['inspect', LANE.container, '--format', '{{.Image}} {{index .Config.Labels "org.opencontainers.image.revision"}}'])
  return result.stdout
}

export function readText(path) {
  return readFileSync(path, 'utf8')
}