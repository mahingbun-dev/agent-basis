#!/usr/bin/env node
/**
 * API-005 真模型前置（E3 测试车道，2026-11-20 用户授权「用已配置的模型验证」）。
 *
 * 做三件事，全部只动 test-rc5 测试区：
 *   1. 把生产容器里**已配置**的 MiMo/DeepSeek 凭据值注入 E3 的 0600 env 文件
 *      （凭据只从 docker inspect 读入内存、只落 0600 文件；日志只打印长度/指纹）；
 *   2. 在 E3 access 库建 `Mr.Ma`（模板 realm=Mr.Ma；口令随机生成，只落 0600
 *      测试账号文件——不打印、不入 argv）；
 *   3. 重建 E3 容器（compose project rc5-test-e3），等 healthy，核对归属桥
 *      「主会话 orchestrator-Mr.Ma 已登记归属账号 Mr.Ma」。
 *
 * 边界：不触碰生产容器（只 inspect 读凭据）、不写仓库跟踪文件、不输出凭据值。
 * 用法：node artifacts/rc5/e3-super/api005-prep.mjs [--no-recreate]
 */
import { spawnSync } from 'node:child_process'
import { chmodSync, copyFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs'
import { createHash, randomBytes } from 'node:crypto'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  bootTokenFromContainer, bootstrapDshSession, login, request,
} from '../../../scripts/rc5-test-client.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO = resolve(HERE, '../../..')
const TEST_ROOT = join(homedir(), 'eterna-data', 'test-rc5')
const ENV_FILE = join(TEST_ROOT, '.env.e3')
const ACCOUNTS_FILE = join(TEST_ROOT, '.test-accounts.json')
const COMPOSE = join(REPO, 'docker-compose.yml')
const CONTAINER = 'eterna-rc5-e3'
const PROJECT = 'rc5-test-e3'
const BASE = 'http://127.0.0.1:3109'
const REALM_ACCOUNT = 'Mr.Ma'
const WANTED = ['MIMO_API_KEY', 'DEEPSEEK_API_KEY']
const noRecreate = process.argv.includes('--no-recreate')
const steps = []
const step = (name, ok, detail = '') => {
  steps.push({ name, ok: ok === true, detail: String(detail).slice(0, 400) })
  console.log(`${ok === true ? 'PASS' : 'FAIL'}  ${name}  ${detail}`)
}
const sleep = ms => new Promise(r => setTimeout(r, ms))
const fingerprint = value => `${value.length}:${createHash('sha256').update(value).digest('hex').slice(0, 12)}`

/* 1) 生产已配置凭据（只读 inspect；值不进日志/argv） */
const inspect = spawnSync('docker', ['inspect', 'eterna-agent', '--format', '{{json .Config.Env}}'], {
  encoding: 'utf8', timeout: 30_000, maxBuffer: 4 * 1024 * 1024,
})
if (inspect.status !== 0) throw new Error(`docker inspect eterna-agent 失败: ${(inspect.stderr ?? '').slice(0, 160)}`)
const prodEnv = {}
for (const item of JSON.parse(inspect.stdout)) {
  const at = item.indexOf('=')
  if (at > 0) prodEnv[item.slice(0, at)] = item.slice(at + 1)
}
const injected = {}
for (const key of WANTED) {
  const value = prodEnv[key]
  if (typeof value !== 'string' || value === '') throw new Error(`生产容器 ${key} 未配置，无法复用已配置模型`)
  injected[key] = value
}
step('生产已配置模型凭据可读（inspect，仅内存）', true,
  WANTED.map(key => `${key}=${fingerprint(injected[key])}`).join(' '))

/* 2) 写 E3 0600 env（先备份） */
const envText = readFileSync(ENV_FILE, 'utf8')
if (/^MIMO_API_KEY=/m.test(envText) === false) throw new Error('.env.e3 缺少 MIMO_API_KEY 行')
const backup = `${ENV_FILE}.bak-${new Date().toISOString().replace(/[:.]/g, '-')}`
copyFileSync(ENV_FILE, backup)
chmodSync(backup, 0o600)
let nextEnv = envText
for (const [key, value] of Object.entries(injected)) {
  const line = `${key}=${value}`
  nextEnv = new RegExp(`^${key}=.*$`, 'm').test(nextEnv)
    ? nextEnv.replace(new RegExp(`^${key}=.*$`, 'm'), () => line)
    : `${nextEnv.replace(/\n?$/, '\n')}${line}\n`
}
writeFileSync(ENV_FILE, nextEnv, { mode: 0o600 })
chmodSync(ENV_FILE, 0o600)
step('E3 0600 env 已注入生产已配置凭据（备份同 0600）', (readFileSync(ENV_FILE, 'utf8').match(/^MIMO_API_KEY=/m) ?? [])[0] !== undefined,
  `backup=${backup.split('/').pop()}`)

/* 3) 建 Mr.Ma（或复用测试账号文件里的口令；无法复用时删重建） */
const readAccounts = () => JSON.parse(readFileSync(ACCOUNTS_FILE, 'utf8'))
const writeAccounts = accounts => {
  writeFileSync(ACCOUNTS_FILE, JSON.stringify(accounts, null, 2) + '\n', { mode: 0o600 })
  chmodSync(ACCOUNTS_FILE, 0o600)
}
const accounts = readAccounts()
const adminPassword = accounts?.admin?.password
if (typeof adminPassword !== 'string') throw new Error('测试账号文件缺少 admin.password')
const dsh = await bootstrapDshSession(BASE, bootTokenFromContainer(CONTAINER))
const auth = await login(BASE, accounts.admin.account, adminPassword)
if (auth.status !== 200) throw new Error(`E3 admin 登录失败 ${auth.status}`)
const adminCookie = `${dsh}; ${auth.cookie}`
const headers = { cookie: adminCookie, 'content-type': 'application/json', origin: BASE }
const list = async () => {
  const res = await request(`${BASE}/access/api/users`, { cookie: adminCookie })
  if (res.status !== 200) throw new Error(`用户清单 ${res.status}`)
  return JSON.parse(res.text).users ?? []
}
let users = await list()
let realmPassword = typeof accounts?.realm?.password === 'string' ? accounts.realm.password : undefined
const existing = users.find(user => user.account === REALM_ACCOUNT)
if (existing !== undefined && realmPassword === undefined) {
  const del = await fetch(`${BASE}/access/api/users/${existing.id}`, { method: 'DELETE', headers })
  step('无法复用口令时删除旧 Mr.Ma（重建账号）', del.status === 200 || del.status === 204, `status=${del.status}`)
  users = users.filter(user => user.account !== REALM_ACCOUNT)
}
if (realmPassword === undefined) realmPassword = randomBytes(18).toString('base64url')
if (users.some(user => user.account === REALM_ACCOUNT) === false) {
  const created = await fetch(`${BASE}/access/api/users`, {
    method: 'POST', headers, body: JSON.stringify({ account: REALM_ACCOUNT, password: realmPassword, role: 'user' }),
  })
  const body = await created.json().catch(() => undefined)
  step('E3 access 建 realm 账号 Mr.Ma（口令只入 0600 文件）',
    created.status === 201 && body?.finalAccount === REALM_ACCOUNT, `status=${created.status} user=${body?.finalAccount ?? '-'}`)
} else {
  step('E3 realm 账号 Mr.Ma 已存在（复用测试账号口令）', true)
}
accounts.realm = { account: REALM_ACCOUNT, password: realmPassword }
writeAccounts(accounts)
const authRealm = await login(BASE, REALM_ACCOUNT, realmPassword)
step('Mr.Ma 登录 200（realm 与 access 账号对齐）', authRealm.status === 200, `status=${authRealm.status}`)

/* 4) 重建 E3（仅 test 项目），等 healthy，核对 bridge 登记 */
if (noRecreate) {
  step('重建 E3 容器（--no-recreate 跳过）', true, 'skip')
} else {
  const up = spawnSync('docker', [
    'compose', '-p', PROJECT, '--env-file', ENV_FILE, '-f', COMPOSE, 'up', '-d', '--force-recreate', 'eterna-agent',
  ], { encoding: 'utf8', cwd: REPO, timeout: 300_000, maxBuffer: 32 * 1024 * 1024 })
  step('E3 容器重建（compose rc5-test-e3）', up.status === 0, (up.stderr ?? '').trim().split('\n').slice(-1)[0] ?? '')
  if (up.status !== 0) throw new Error(`compose up 失败: ${(up.stderr ?? '').slice(0, 300)}`)
}
let health = ''
for (let i = 0; i < 60; i++) {
  await sleep(2000)
  const r = spawnSync('docker', ['inspect', CONTAINER, '--format', '{{.State.Health.Status}}'], { encoding: 'utf8', timeout: 20_000 })
  health = (r.stdout ?? '').trim()
  if (health === 'healthy') break
}
step('E3 healthy', health === 'healthy', `health=${health}`)

const logs = spawnSync('docker', ['logs', CONTAINER], { encoding: 'utf8', timeout: 60_000, maxBuffer: 32 * 1024 * 1024 })
const text = `${logs.stdout ?? ''}\n${logs.stderr ?? ''}`
const bridge = text.split('\n').filter(line => line.includes('[eterna-tasks-access-bridge]')).at(-1) ?? ''
step('归属桥登记主会话到 Mr.Ma', /已登记归属|已归属/.test(bridge), bridge)

const envNow = spawnSync('docker', ['inspect', CONTAINER, '--format', '{{json .Config.Env}}'], { encoding: 'utf8', timeout: 20_000 })
const nowEnv = {}
for (const item of JSON.parse(envNow.stdout ?? '[]')) {
  const at = item.indexOf('=')
  if (at > 0) nowEnv[item.slice(0, at)] = item.slice(at + 1)
}
step('容器内 MIMO_API_KEY 与生产同指纹', nowEnv.MIMO_API_KEY !== undefined && fingerprint(nowEnv.MIMO_API_KEY) === fingerprint(injected.MIMO_API_KEY),
  nowEnv.MIMO_API_KEY === undefined ? 'missing' : fingerprint(nowEnv.MIMO_API_KEY))

const pass = steps.every(item => item.ok)
writeFileSync(join(HERE, 'api005-prep.log'), steps.map(item => `${item.ok ? 'PASS' : 'FAIL'}  ${item.name}\n${item.detail}\n`).join('\n') + `\nRESULT=${pass ? 'PASS' : 'FAIL'}\n`)
process.exit(pass ? 0 : 1)