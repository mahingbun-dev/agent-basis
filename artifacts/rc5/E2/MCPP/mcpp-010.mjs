#!/usr/bin/env node
/**
 * E2 · RC5-MCPP-010：任意 HTTPS 地址（不可解析域名）不被策略拦，probe 失败属网络层。
 *
 * 为什么单独起 lane：010 要求 `personalHttpHosts` **为空**（默认部署形态：放行任意 host，
 * 51 §3.6 + 47 D22「http/任意 host，白名单暂关」），而 MCPP-011 要求同一 lane 配非空白名单
 * 验证收紧能力。两者互斥，因此 010 用独立容器/数据根（3233/9333，项目 rc5-mcpp10）实跑，
 * 不触碰 E2 主 lane、E1/E3、浸泡容器与生产。
 *
 * 断言：
 *   1) `mcp-personal/catalog.hostWhitelist` 为空（白名单关闭的默认形态）；
 *   2) upsert `https://unresolvable.invalid/mcp` 成功（策略不预检 DNS/连通性）；
 *   3) probe 返回 ok=false 且 error 非空（失败属网络层，不是策略拒绝）；
 *   4) 清理该行并拆除临时容器。
 *
 * 用法：node artifacts/rc5/E2/MCPP/mcpp-010.mjs
 */
import { existsSync, mkdirSync, rmSync, writeFileSync, chmodSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { Case, STATUS, shape } from '../_lib/evidence.mjs'
import { docker, run, sleep } from '../_lib/env.mjs'
import { bootTokenFromContainer, bootstrapDshSession, login, rpc } from '../../../../scripts/rc5-test-client.mjs'

const REPO = join(homedir(), 'code', 'agent-basis-rc5')
const TEST_ROOT = join(homedir(), 'eterna-data', 'test-rc5')
const TARGET = join(TEST_ROOT, 'mcpp10')
const ENV_DST = join(TEST_ROOT, '.env.mcpp10')
const PROJECT = 'rc5-mcpp10'
const CONTAINER = 'eterna-rc5-mcpp10'
const PORT = 3233
const RELAY = 9333
const BASE = `http://127.0.0.1:${PORT}`
const IMAGE = 'eterna-agent:rc5-test'
const URL = 'https://unresolvable.invalid/mcp'

function envMap(path) {
  const map = {}
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    const trimmed = line.trim()
    if (trimmed === '' || trimmed.startsWith('#')) continue
    const eq = trimmed.indexOf('=')
    if (eq === -1) continue
    let value = trimmed.slice(eq + 1)
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1)
    map[trimmed.slice(0, eq)] = value
  }
  return map
}

const c = new Case('MCPP', 'RC5-MCPP-010')
let containerUp = false
try {
  const accounts = JSON.parse(readFileSync(join(TEST_ROOT, '.test-accounts.json'), 'utf8'))
  const e1 = envMap(join(TEST_ROOT, '.env.e1'))
  if (existsSync(TARGET)) rmSync(TARGET, { recursive: true, force: true })
  mkdirSync(join(TARGET, '.secrets'), { recursive: true, mode: 0o700 })
  const keyFile = join(TARGET, '.secrets', 'mcp-master-key')
  writeFileSync(keyFile, `${accounts.mcpMasterKey}\n`, { mode: 0o600 })
  chmodSync(keyFile, 0o600)

  const env = {
    ETERNA_DATA_ROOT: TEST_ROOT,
    ETERNA_INSTANCE: 'mcpp10',
    ETERNA_PORT: String(PORT),
    ETERNA_RELAY_PORT: String(RELAY),
    ETERNA_CONTAINER_NAME: CONTAINER,
    ETERNA_IMAGE: IMAGE,
    ETERNA_FORM: 'web',
    ETERNA_TRUSTED_HOST: `127.0.0.1:${PORT} localhost:${PORT}`,
    MIMO_API_KEY: 'mcpp10-placeholder-not-a-secret',
    ETERNA_MCP_MASTER_KEY_FILE: '/data/.secrets/mcp-master-key',
    ETERNA_MCP_PERSONAL_ENABLED: 'true',
    ETERNA_MCP_PERSONAL_HTTP_HOSTS: '',
    ETERNA_ACCESS_ADMIN_USER: accounts.admin.account,
    ETERNA_ACCESS_ADMIN_PASSWORD: accounts.admin.password,
    ETERNA_ACCESS_SECRET: e1.ETERNA_ACCESS_SECRET,
  }
  writeFileSync(ENV_DST, Object.entries(env).map(([k, v]) => `${k}=${v}`).join('\n') + '\n', { mode: 0o600 })
  chmodSync(ENV_DST, 0o600)
  c.cmd(`写 ${ENV_DST}（0600；独立数据根 ${TARGET}；host 白名单为空）`, 0, `keys=${Object.keys(env).length} port=${PORT}`)

  const compose = ['compose', '-p', PROJECT, '--env-file', ENV_DST, '-f', join(REPO, 'docker-compose.yml'), 'up', '-d', '--no-build', 'eterna-agent']
  const up = run('docker', compose, { timeout: 600_000 })
  containerUp = up.exit === 0
  c.cmd(`docker ${compose.join(' ')}`, up.exit, shape(`${up.stdout}\n${up.stderr}`, 400))
  let health = 'unknown'
  for (let attempt = 0; attempt < 90; attempt += 1) {
    health = docker(['inspect', CONTAINER, '--format', '{{.State.Health.Status}}']).stdout
    if (health === 'healthy' || health === 'unhealthy') break
    await sleep(2_000)
  }
  const imageId = docker(['inspect', CONTAINER, '--format', '{{.Image}}']).stdout
  c.cmd('docker inspect health/image', 0, `health=${health} image=${imageId.slice(0, 20)}`)

  const dsh = await bootstrapDshSession(BASE, bootTokenFromContainer(CONTAINER))
  const auth = await login(BASE, accounts.admin.account, accounts.admin.password)
  const cookie = `${dsh}; ${auth.cookie}`
  c.cmd(`管理员登录（${accounts.admin.account}）`, auth.status, `status=${auth.status} cookie=${auth.cookie === '' ? 'none' : 'ok'}`)

  const catalog = await rpc(BASE, cookie, 'mcp-personal/catalog')
  const hosts = catalog.value?.hostWhitelist ?? []
  c.cmd('POST /api/mcp-personal/catalog（空白名单）', catalog.status, `ok=${catalog.ok} hostWhitelist=${JSON.stringify(hosts)}`)

  const upsert = await rpc(BASE, cookie, 'mcp-personal/upsert', {
    request: { name: 'https-unresolvable', transport: 'streamable-http', url: URL },
  })
  c.cmd(`POST /api/mcp-personal/upsert {url:${URL}}`, upsert.status,
    `ok=${upsert.ok} transport=${upsert.value?.item?.transport ?? '-'} code=${upsert.error?.code ?? '-'} msg=${shape(upsert.error?.message, 140)}`)
  const id = upsert.value?.item?.id
  let probe
  if (id !== undefined) {
    probe = await rpc(BASE, cookie, 'mcp-personal/probe', { request: { id } }, { timeoutMs: 40_000 })
    c.cmd('POST /api/mcp-personal/probe（同一条目）', probe.status,
      `ok=${probe.ok} probe=${shape(probe.value, 240)} code=${probe.error?.code ?? '-'}`)
    const cleanup = await rpc(BASE, cookie, 'mcp-personal/delete', { request: { id } })
    c.cmd('POST /api/mcp-personal/delete（清理）', cleanup.status, `ok=${cleanup.ok}`)
  }

  const accepted = catalog.ok === true && hosts.length === 0 && upsert.ok === true && upsert.value?.item?.transport === 'streamable-http'
  const probeNetworkFailure = probe !== undefined && probe.value?.ok === false && String(probe.value?.error ?? '').length > 0
  c.assert('lane 白名单为空（默认形态：任意 host 放行）', catalog.ok === true && hosts.length === 0, JSON.stringify(hosts))
  c.assert('https 任意 host（不可解析域名）upsert 被接受', upsert.ok === true && upsert.value?.item?.transport === 'streamable-http',
    `ok=${upsert.ok} transport=${upsert.value?.item?.transport ?? '-'}`)
  c.assert('probe 失败属网络层（返回 error，非策略拒绝）', probeNetworkFailure,
    `ok=${probe?.value?.ok} error=${shape(probe?.value?.error, 120)}`)

  const pass = accepted && probeNetworkFailure
  c.finish({
    status: pass ? STATUS.PASS : STATUS.FAIL,
    title: '任意 HTTPS 地址（不可解析域名）校验通过、不被策略拦',
    expected: 'upsert 成功；probe 连接失败属网络层（白名单默认空）',
    actual: `hostWhitelist=${JSON.stringify(hosts)} upsert=${upsert.ok}/${upsert.value?.item?.transport ?? '-'} probe=${shape(probe?.value, 160)}`,
    notes: [
      `独立 lane：项目 ${PROJECT} / 容器 ${CONTAINER} / 端口 ${PORT}（未触碰 E2 主 lane、E1/E3、浸泡容器与生产）`,
      '010 要求白名单为空（H16 已接受风险：任意 host/内网可达）；MCPP-011 在同一 E2 lane 用非空白名单验证收紧能力，两者互斥故分 lane',
      '不可解析域名（.invalid）用于证明策略不做 DNS/连通性预检，不依赖外网',
      `镜像=${IMAGE}（${imageId.slice(0, 19)}…）`,
    ],
    artifacts: ['cmd.log'],
  })
  console.log(`[MCPP-010] ${pass ? 'PASS' : 'FAIL'}`)
} finally {
  if (containerUp) {
    const down = run('docker', ['compose', '-p', PROJECT, '--env-file', ENV_DST, '-f', join(REPO, 'docker-compose.yml'), 'down'], { timeout: 300_000 })
    c.note(`清理：compose -p ${PROJECT} down → EXIT=${down.exit}（数据根保留 ${TARGET}）`)
  }
}