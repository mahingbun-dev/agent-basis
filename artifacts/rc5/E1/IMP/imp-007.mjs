#!/usr/bin/env node
/**
 * E1 · RC5-IMP-007：512MiB 边界归档经真实反代上传（P0）。
 *
 * 链路：本机 Node 流式 POST → 临时 nginx（client_max_body_size 512m、
 * proxy_request_buffering off、Host/ Cookie 透传）→ E1 容器 3118。
 *
 * 断言：
 *   1) 夹具精确 512MiB（536870912 bytes = 上游 maxUploadBytes 上限）；
 *   2) 反代鉴权通（坏包先探一次：400 而非 401/403）；
 *   3) 512MiB 上传返回 200，NDJSON outcome.ok=true，无 413；
 *   4) nginx 访问日志记 200、请求长度≈512MiB，错误日志无 too large；
 *   5) 容器未 OOMKilled、无重启、health=healthy，cgroup memory.peak 记录上传峰值，
 *      上传后仍可服务（/login 200）。
 *
 * 说明：临时反代把 Host 置为 127.0.0.1:3118（与会话令牌绑定 authority 一致）；
 * 生产反代终结在真实域名，Host 天然一致，此处置换只为在 3129 端口复现同源语义。
 *
 * 用法：node artifacts/rc5/E1/IMP/imp-007.mjs
 */
import { createReadStream, existsSync, rmSync, statSync, writeFileSync } from 'node:fs'
import http from 'node:http'
import { join } from 'node:path'
import { Case, STATUS, shape } from '../_lib/evidence.mjs'
import { LANE, docker, readDb, run, sleep, userIdOf } from '../_lib/env.mjs'
import { bootTokenFromContainer, bootstrapDshSession, loadAccounts, login } from '../../../../scripts/rc5-test-client.mjs'

const TARGET = 512 * 1024 * 1024
const ZIP = '/tmp/imp-007-512m.zip'
const CONF = '/tmp/rc5-imp-nginx.conf'
const PROXY = 'rc5-imp-nginx'
const PORT = 3129
const NGINX_CONF = `# RC5-IMP-007 临时反代：与 deploy/README.md 的 512m/长读超时口径一致。
events {}
http {
  log_format rc5 '$request_method $request_uri status=$status req_len=$request_length body=$body_bytes_sent time=$request_time';
  access_log /dev/stdout rc5;
  client_max_body_size 512m;
  client_body_timeout 1800s;
  proxy_read_timeout 1800s;
  proxy_send_timeout 1800s;
  server {
    listen 80;
    location / {
      proxy_pass http://host.docker.internal:${LANE.port};
      proxy_http_version 1.1;
      proxy_request_buffering off;
      # 会话令牌绑定 authority；临时反代在 3129 上复现生产同源语义（Host 透传应用口径）。
      proxy_set_header Host 127.0.0.1:${LANE.port};
      proxy_set_header Cookie $http_cookie;
    }
  }
}
`

function peakBytes() {
  const result = docker(['exec', LANE.container, 'sh', '-c', 'cat /sys/fs/cgroup/memory.peak'])
  const value = Number.parseInt(result.stdout, 10)
  return Number.isFinite(value) ? value : -1
}

function memMiB(bytes) {
  return bytes < 0 ? '-' : (bytes / 1024 / 1024).toFixed(1)
}

function stateOf() {
  const result = docker(['inspect', LANE.container, '--format',
    '{{.State.OOMKilled}}|{{.State.Health.Status}}|{{.RestartCount}}'])
  const [oom, health, restarts] = result.stdout.split('|')
  return { oom: oom === 'true', health, restarts: Number.parseInt(restarts ?? '', 10) }
}

function request(url, { method = 'GET', headers = {}, body } = {}) {
  return new Promise((resolvePromise) => {
    const payload = body === undefined ? undefined : Buffer.from(body)
    const started = Date.now()
    const req = http.request(url, {
      method,
      headers: payload === undefined ? headers : { ...headers, 'content-length': String(payload.length) },
    }, (res) => {
      const chunks = []
      let bytes = 0
      res.on('data', (chunk) => { bytes += chunk.length; chunks.push(chunk) })
      res.on('end', () => resolvePromise({
        status: res.statusCode, headers: res.headers, bytes,
        text: Buffer.concat(chunks).toString('utf8'), elapsedMs: Date.now() - started,
      }))
    })
    req.setTimeout(600_000, () => req.destroy(new Error('client timeout 600s')))
    req.on('error', (error) => resolvePromise({ status: 0, error: error.message, elapsedMs: Date.now() - started }))
    if (payload !== undefined) req.end(payload)
    else req.end()
  })
}

function uploadStream(url, cookie) {
  return new Promise((resolvePromise) => {
    const started = Date.now()
    const req = http.request(url, { method: 'POST', headers: {
      'content-type': 'application/octet-stream',
      accept: 'application/x-ndjson',
      cookie,
      'content-length': String(statSync(ZIP).size),
    } }, (res) => {
      let text = ''
      let bytes = 0
      res.on('data', (chunk) => { bytes += chunk.length; text += chunk.toString('utf8') })
      res.on('end', () => resolvePromise({
        status: res.statusCode, headers: res.headers, bytes, text, elapsedMs: Date.now() - started,
      }))
    })
    req.setTimeout(600_000, () => req.destroy(new Error('client timeout 600s')))
    req.on('error', (error) => resolvePromise({ status: 0, error: error.message, elapsedMs: Date.now() - started }))
    const stream = createReadStream(ZIP)
    stream.on('error', (error) => req.destroy(error))
    stream.pipe(req)
  })
}

function outcomeOf(text) {
  for (const line of text.split('\n').filter(Boolean)) {
    try {
      const parsed = JSON.parse(line)
      if (parsed?.type === 'outcome') return parsed.outcome
    } catch { /* progress 行 */ }
  }
  return undefined
}

const c = new Case('IMP', 'RC5-IMP-007')
let proxyUp = false
try {
  /* 1) 夹具：精确 512MiB */
  if (!existsSync(ZIP) || statSync(ZIP).size !== TARGET) {
    const gen = run('python3', [join(LANE.evidenceRoot, 'IMP', 'make-512m-export.py'), ZIP], { timeout: 600_000 })
    c.cmd(`python3 artifacts/rc5/E1/IMP/make-512m-export.py ${ZIP}`, gen.exit, shape(`${gen.stdout}\n${gen.stderr}`, 300))
  }
  const size = statSync(ZIP).size
  c.cmd('node -e statSync(/tmp/imp-007-512m.zip).size', size === TARGET ? 0 : 1, `bytes=${size} target=${TARGET}`)

  /* 2) 账号 / 工作区 */
  const accounts = loadAccounts(LANE.accountsFile)
  const dsh = await bootstrapDshSession(LANE.base, bootTokenFromContainer(LANE.container))
  const authB = await login(LANE.base, accounts.user_b.account, accounts.user_b.password)
  const cookie = `${dsh}; ${authB.cookie}`
  const userId = userIdOf(accounts.user_b.account)
  /* 同一账号在 access 侧可能留有历史镜像行（如 initializeDefault 重建后的旧 id）。
     用坏包探针逐个尝试，取应用登记册认识的那一个；全部失败则明确报错。 */
  const candidates = readDb('SELECT workspace_id FROM workspaces WHERE owner_id = ?', [userId])
    .map(row => row.workspace_id)
  const probes = []
  let workspaceId
  let probe
  for (const candidate of candidates) {
    const attempt = await request(
      `http://127.0.0.1:${LANE.port}/api/deepseek-chat-import/archive?workspaceId=${encodeURIComponent(candidate)}`,
      { method: 'POST', headers: { cookie, 'content-type': 'application/octet-stream', accept: 'application/x-ndjson' }, body: 'not-a-zip' },
    )
    const reason = outcomeOf(attempt.text ?? '')?.error?.reason
    probes.push({ workspaceId: candidate, status: attempt.status, reason })
    if (reason !== 'workspace-not-found') { workspaceId = candidate; probe = attempt; break }
  }
  c.cmd('POST /api/deepseek-chat-import/archive（坏包探针，逐个候选 workspaceId，直连容器）',
    probe !== undefined ? 0 : 1,
    `candidates=${JSON.stringify(candidates)} probes=${JSON.stringify(probes)} chosen=${workspaceId ?? '-'}`)
  c.cmd(`会话：B(${accounts.user_b.account}) 登录 + dsh 会话`, 200,
    `userId=${userId} workspace=${workspaceId ?? '-'}`)

  /* 3) 临时反代 */
  writeFileSync(CONF, NGINX_CONF)
  const rm = docker(['rm', '-f', PROXY], { timeout: 60_000 })
  c.cmd(`docker rm -f ${PROXY}`, rm.exit, shape(`${rm.stdout} ${rm.stderr}`, 200))
  const up = docker(['run', '-d', '--name', PROXY, '-p', `${PORT}:80`,
    '--add-host', 'host.docker.internal:host-gateway',
    '-v', `${CONF}:/etc/nginx/nginx.conf:ro`, 'nginx:alpine'], { timeout: 240_000 })
  proxyUp = up.exit === 0
  c.cmd(`docker run -d --name ${PROXY} -p ${PORT}:80 --add-host host.docker.internal:host-gateway -v ${CONF}:/etc/nginx/nginx.conf:ro nginx:alpine`,
    up.exit, shape(up.stdout, 120))
  const confTest = docker(['exec', PROXY, 'nginx', '-t'])
  c.cmd(`docker exec ${PROXY} nginx -t`, confTest.exit, shape(confTest.stderr, 300))

  for (let attempt = 0; attempt < 40; attempt += 1) {
    const ping = await request(`http://127.0.0.1:${PORT}/login`)
    if (ping.status === 200) break
    await sleep(250)
  }
  const ping = await request(`http://127.0.0.1:${PORT}/login`)
  c.cmd(`GET http://127.0.0.1:${PORT}/login（反代连通）`, ping.status, `status=${ping.status} elapsedMs=${ping.elapsedMs} bytes=${ping.bytes}`)

  /* 4) 前置鉴权探针（经反代）：坏包应让应用读到 body 并回 unreadable-archive，
        证明 Cookie/Host/会话都被反代送达（若鉴权失败会是 401/403 或 workspace-not-found） */
  const probeProxy = await request(
    `http://127.0.0.1:${PORT}/api/deepseek-chat-import/archive?workspaceId=${encodeURIComponent(workspaceId)}`,
    { method: 'POST', headers: { cookie, 'content-type': 'application/octet-stream', accept: 'application/x-ndjson' }, body: 'not-a-zip' },
  )
  const probeReason = outcomeOf(probeProxy.text ?? '')?.error?.reason
  c.cmd('POST /api/deepseek-chat-import/archive（坏包 10B 经反代，前置鉴权探针）', probeProxy.status,
    `status=${probeProxy.status} reason=${probeReason ?? '-'} body=${shape(probeProxy.text, 160)} elapsedMs=${probeProxy.elapsedMs}`)

  /* 5) 512MiB 上传（流式，测试进程不整包进内存） */
  const beforePeak = peakBytes()
  const beforeState = stateOf()
  c.cmd(`docker exec ${LANE.container} cat /sys/fs/cgroup/memory.peak（上传前）`, beforePeak >= 0 ? 0 : 1,
    `peak=${beforePeak} (${memMiB(beforePeak)}MiB) state=${JSON.stringify(beforeState)}`)

  const upload = await uploadStream(
    `http://127.0.0.1:${PORT}/api/deepseek-chat-import/archive?workspaceId=${encodeURIComponent(workspaceId)}`,
    cookie,
  )
  const outcome = outcomeOf(upload.text ?? '')
  const afterPeak = peakBytes()
  await sleep(1_500)
  const afterState = stateOf()
  c.cmd(`POST http://127.0.0.1:${PORT}/api/deepseek-chat-import/archive?workspaceId=${workspaceId}（${size} bytes 流式）`,
    upload.status === 200 ? 0 : 1,
    `status=${upload.status} elapsedMs=${upload.elapsedMs} respBytes=${upload.bytes} ${shape(upload.text, 400)}`)
  c.cmd(`docker exec ${LANE.container} cat /sys/fs/cgroup/memory.peak（上传后）`, afterPeak >= 0 ? 0 : 1,
    `peak=${afterPeak} (${memMiB(afterPeak)}MiB) delta=${afterPeak - beforePeak} state=${JSON.stringify(afterState)}`)

  const logs = docker(['logs', PROXY])
  const rawLog = `${logs.stdout}\n${logs.stderr}`
  const accessLines = rawLog.split('\n').filter(line => /status=\d+/.test(line)).slice(-6)
  c.cmd(`docker logs ${PROXY}（过滤访问日志）`, logs.exit, shape(accessLines.join('\n'), 800))
  const logTooLarge = /too large/i.test(rawLog)
  const bigLog = accessLines.map(line => ({
    line,
    status: Number.parseInt(line.match(/status=(\d+)/)?.[1] ?? '', 10),
    requestLen: Number.parseInt(line.match(/req_len=(\d+)/)?.[1] ?? '', 10),
  })).find(row => row.status === 200 && row.requestLen >= TARGET)
  const log200 = bigLog !== undefined
  const requestLen = bigLog?.requestLen ?? -1

  const after = await request(`http://127.0.0.1:${PORT}/login`)
  c.cmd(`GET http://127.0.0.1:${PORT}/login（上传后仍可服务）`, after.status, `status=${after.status}`)

  /* 6) 断言 */
  c.assert('夹具精确 512MiB（= maxUploadBytes 上限）', size === TARGET, `${size} vs ${TARGET}`)
  c.assert('反代连通（/login 200）', ping.status === 200, `status=${ping.status}`)
  c.assert('反代鉴权通：坏包经反代回 unreadable-archive（非 401/403/workspace-not-found）',
    probeProxy.status === 200 && probeReason === 'unreadable-archive',
    `status=${probeProxy.status} reason=${probeReason}`)
  c.assert('512MiB 上传 200 且 outcome.ok=true', upload.status === 200 && outcome?.ok === true,
    `status=${upload.status} ok=${outcome?.ok} bytes=${upload.bytes}`)
  c.assert('非 413（反代/应用均接受边界体积）', upload.status !== 413, `status=${upload.status}`)
  c.assert('nginx 访问日志 200 且请求长度≈512MiB', log200 && requestLen >= TARGET && !logTooLarge,
    `log200=${log200} req_len=${requestLen} tooLarge=${logTooLarge}`)
  c.assert('容器未 OOMKilled、无重启、health=healthy', afterState.oom === false
    && afterState.restarts === beforeState.restarts && afterState.health === 'healthy', JSON.stringify(afterState))
  c.assert('cgroup 记录到上传内存峰值（memory.peak 上升）', afterPeak > beforePeak,
    `before=${memMiB(beforePeak)}MiB after=${memMiB(afterPeak)}MiB`)
  c.assert('上传后容器仍可服务（/login 200）', after.status === 200, `status=${after.status}`)

  const skipped = Array.isArray(outcome?.value?.skipped) ? outcome.value.skipped : []
  const sessionIds = Array.isArray(outcome?.value?.sessionIds) ? outcome.value.sessionIds : []
  const pass = size === TARGET && ping.status === 200 && probeProxy.status === 200
    && probeReason === 'unreadable-archive'
    && upload.status === 200 && outcome?.ok === true && log200 && requestLen >= TARGET && !logTooLarge
    && afterState.oom === false && afterState.restarts === beforeState.restarts
    && afterState.health === 'healthy' && afterPeak > beforePeak && after.status === 200
  const result = c.finish({
    status: pass ? STATUS.PASS : STATUS.FAIL,
    title: '512MiB 边界归档经真实反代上传（不 OOM）',
    expected: '精确 512MiB 经 client_max_body_size 512m 的反代上传；200 + outcome.ok；无 413/OOM；容器健康',
    actual: `bytes=${size} upload=${upload.status} ok=${outcome?.ok} elapsed=${upload.elapsedMs}ms respBytes=${upload.bytes} `
      + `sessionIds=${sessionIds.length} skipped=${skipped.length} oom=${afterState.oom} restarts=${beforeState.restarts}→${afterState.restarts} `
      + `health=${afterState.health} peak=${memMiB(beforePeak)}MiB→${memMiB(afterPeak)}MiB`,
    notes: [
      `lane=${LANE.container}（独立测试容器，未触碰生产）；临时反代 ${PROXY} @${PORT} → ${LANE.base}`,
      '夹具内的会话故意无消息：本用例隔离「体积边界」变量，outcome 里以 skipped（conversation has no messages）呈现，不是导入失败',
      '临时反代把 Host 置为应用 authority（127.0.0.1:3118）：会话令牌绑定 authority，生产反代在真实域名下天然一致',
      '上传为 Node 流式（createReadStream → http.request，content-length 精确），测试进程不整包进内存',
      '内存判据用容器 cgroup memory.peak（单调峰值）：上传前/后对比，并核 OOMKilled/重启/health',
    ],
    artifacts: ['cmd.log'],
  })
  writeFileSync(join(LANE.evidenceRoot, 'IMP', 'extra-007.json'), JSON.stringify([result], null, 1))
  console.log(`[IMP-007] ${result.status}`)
} finally {
  if (proxyUp) {
    const down = docker(['rm', '-f', PROXY], { timeout: 60_000 })
    c.note(`清理：docker rm -f ${PROXY} → EXIT=${down.exit}`)
  }
  for (const path of [ZIP, CONF]) {
    if (existsSync(path)) rmSync(path, { force: true })
  }
}