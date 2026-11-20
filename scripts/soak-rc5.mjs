#!/usr/bin/env node
/**
 * rc.5 浸泡采样（51 TERM-013 / DATA-009；54 §6.3「P5 起跑、P6 收口」）。
 *
 * TERM-013（24h，P1）：长进程 + 多次 attach/close，判「无 fd 泄漏（采样曲线平稳）、
 *   内存无持续增长」。
 *   - 长进程：容器内 `bash /fixtures/long-process.sh <秒>`（夹具经 E1 override 只读挂载；
 *     不进镜像），每 tick 记录存活进程数。
 *   - fd/内存：扫 /proc 定位 dsh 主进程（cmdline 含 dsh 安装路径，取最小 PID），
 *     采样 fd 数、VmRSS、Threads。
 *   - attach/close：attach 走 WS mux（HTTP 不可达，本脚本不执行，记 NOTRUN 并在
 *     摘要 limitations 里写明）；close 经 `terminal/create` + `terminal/close` 反复
 *     创建/关闭做分配churn。**rc.5 实测 terminal/create 返回 `gateway/internal:
 *     session.snapshotEvents is not a function`**——churn 结果按 tick 原样记账，
 *     不当作通过；若窗口满仍失败，摘要标 FAIL 并把首个错误码带出。
 *
 * DATA-009（24h，P1）：读写会话 + 检查 SQLite，判「无 database is locked/WAL 异常、
 *   integrity_check ok」。
 *   - 写：每 db 周期并发 `session/create`（--writers 个），记录成功/失败与错误码。
 *   - 读：只读打开 access/users.db、.eterna/memory.sqlite3、knowledge-admin/access.sqlite3，
 *     跑 `PRAGMA integrity_check` + `PRAGMA journal_mode`，记录 WAL/SHM 体积与
 *     sessions 行数。
 *   - 锁面：每 db 周期扫 `docker logs --since`（仅统计匹配条数，原文不落盘）。
 *
 * 窗口纪律：--duration 默认 24h；窗口未满时摘要 verdict=NOTRUN 并写
 * `window.complete=false`，**绝不用短时采样冒充 24h**（W5 data 轨按真实 elapsed 记账）。
 *
 * 用法（后台起跑见 artifacts/rc5/p5/testbed/soak/run.sh 同款命令）：
 *   node scripts/soak-rc5.mjs --suite both --duration 24h \
 *     --container eterna-rc5-e1 --data-root $HOME/eterna-data/test-rc5/e1 \
 *     --out artifacts/rc5/p5/testbed/soak
 *   可选：--interval 60s --db-interval 5m --writers 2 --tag <名字>
 *
 * 只写测试数据根（session/create）与 --out 证据目录；凭据只从 0600 账号文件读入内存，
 * 不打印/不落盘；boot token 只从容器日志读入内存。
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { join, resolve } from 'node:path'
import { openMuxSocket } from '../artifacts/rc5/E1/_lib/ws.mjs'
import {
  STATUS,
  bootTokenFromContainer,
  bootstrapDshSession,
  defaultPaths,
  loadAccounts,
  login,
  parseArgs,
  redact,
  rpc,
  shape,
} from './rc5-test-client.mjs'

/* ---------------------------------------------------------------- 参数 */

const args = parseArgs(process.argv.slice(2), {
  ...defaultPaths(),
  suite: 'both',
  duration: '24h',
  interval: '60s',
  'db-interval': '5m',
  writers: '2',
  out: 'artifacts/rc5/p5/testbed/soak',
})

const SUITE = String(args.suite)
const CONTAINER = String(args.container)
const DATA_ROOT = String(args.dataRoot)
const BASE = String(args.base)
const ACCOUNTS_FILE = String(args.accountsFile)
const OUT_DIR = resolve(process.cwd(), String(args.out))
const INTERVAL_SECONDS = parseDuration(String(args.interval))
const DB_INTERVAL_SECONDS = parseDuration(String(args['db-interval']))
const DURATION_SECONDS = parseDuration(String(args.duration))
const WRITERS = Number.parseInt(String(args.writers), 10)

if (!['term', 'data', 'both'].includes(SUITE)) {
  console.error('--suite 只接受 term|data|both')
  process.exit(2)
}
if ([INTERVAL_SECONDS, DB_INTERVAL_SECONDS, DURATION_SECONDS].some(value => !Number.isFinite(value) || value <= 0)) {
  console.error('--duration/--interval/--db-interval 需形如 30s / 5m / 24h')
  process.exit(2)
}
if (!Number.isFinite(WRITERS) || WRITERS < 1 || WRITERS > 8) {
  console.error('--writers ∈ 1..8')
  process.exit(2)
}

function parseDuration(text) {
  const match = String(text).match(/^(\d+)(s|m|h)$/)
  if (match === null) return Number.NaN
  const unit = { s: 1, m: 60, h: 3600 }[match[2]]
  return Number(match[1]) * unit
}

const STAMP = new Date().toISOString().replace(/[:.]/g, '-')
const TAG = typeof args.tag === 'string' ? args.tag : `${SUITE}-${STAMP}`
mkdirSync(OUT_DIR, { recursive: true })
const TERM_LOG = join(OUT_DIR, `term-013-${TAG}.jsonl`)
const DATA_LOG = join(OUT_DIR, `data-009-${TAG}.jsonl`)
const SOAK_LOG = join(OUT_DIR, `soak-${TAG}.log`)
const META_PATH = join(OUT_DIR, `meta-${TAG}.json`)
const SUMMARY_PATH = join(OUT_DIR, `summary-${TAG}.json`)

const startedAt = new Date()
const endsAt = new Date(startedAt.getTime() + DURATION_SECONDS * 1000)

function log(message) {
  const line = `[${new Date().toISOString()}] ${message}`
  console.log(line)
  appendFileSync(SOAK_LOG, `${line}\n`)
}

function appendJsonl(path, record) {
  appendFileSync(path, `${JSON.stringify(record)}\n`)
}

/* ---------------------------------------------------------------- 环境 */

const meta = {
  script: 'scripts/soak-rc5.mjs',
  tag: TAG,
  suite: SUITE,
  startedAt: startedAt.toISOString(),
  plannedEndAt: endsAt.toISOString(),
  plannedSeconds: DURATION_SECONDS,
  intervalSeconds: INTERVAL_SECONDS,
  dbIntervalSeconds: DB_INTERVAL_SECONDS,
  writers: WRITERS,
  container: CONTAINER,
  dataRoot: DATA_ROOT,
  base: BASE,
  out: OUT_DIR,
  logs: { term: TERM_LOG, data: DATA_LOG, soak: SOAK_LOG },
  limitations: [
    'attach churn 每 tick 走一次 WS mux（open→snapshot→断开）+ create/close；崩溃/拒绝按 fail 记账',
    '进程/内存采样为容器 /proc 只读采样（60s 级），非 profiler',
  ],
}
writeFileSync(META_PATH, `${JSON.stringify(meta, null, 2)}\n`)
log(`soak start suite=${SUITE} duration=${DURATION_SECONDS}s interval=${INTERVAL_SECONDS}s dbInterval=${DB_INTERVAL_SECONDS}s container=${CONTAINER}`)
log(`plannedEnd=${endsAt.toISOString()} logs=${OUT_DIR}`)

/* -------------------------------------------------------------- 容器探针 */

function dockerExec(script, timeout = 30_000) {
  const result = spawnSync('docker', ['exec', CONTAINER, 'sh', '-c', script], { encoding: 'utf8', timeout })
  return { status: result.status ?? -1, stdout: (result.stdout ?? '').trim(), stderr: (result.stderr ?? '').trim() }
}

function containerFixturePresent() {
  return dockerExec('test -f /fixtures/long-process.sh && echo yes || echo no').stdout === 'yes'
}

function startLongProcess(seconds) {
  // docker exec -d: 容器内长驻；夹具不进镜像，只从只读挂载取。
  const result = spawnSync('docker', ['exec', '-d', CONTAINER, 'sh', '-c', `exec bash /fixtures/long-process.sh ${seconds}`], { encoding: 'utf8', timeout: 30_000 })
  return { ok: result.status === 0, detail: result.status === 0 ? `spawned pid detached` : `exit=${result.status} ${(result.stderr ?? '').slice(0, 160)}` }
}

/** 一次 docker exec 采完：dsh 主进程 pid/fd/RSS/线程、长进程存活数。 */
function sampleContainer() {
  const script = `
SELF=$$
PID=""
for d in /proc/[0-9]*; do
  p=\${d#/proc/}
  [ "$p" = "$SELF" ] && continue
  [ -r "$d/cmdline" ] || continue
  c=$(tr '\\0' ' ' < "$d/cmdline" 2>/dev/null)
  case "$c" in
    "node /usr/local/bin/dsh"*|"/usr/local/bin/node /usr/local/bin/dsh"*)
      if [ -z "$PID" ] || [ "$p" -lt "$PID" ]; then PID=$p; fi
      ;;
  esac
done
LP=0
for d in /proc/[0-9]*; do
  p=\${d#/proc/}
  [ "$p" = "$SELF" ] && continue
  [ -r "$d/cmdline" ] || continue
  c=$(tr '\\0' ' ' < "$d/cmdline" 2>/dev/null)
  case "$c" in *long-process.sh*) LP=$((LP+1));; esac
done
echo "DSH_PID=$PID"
if [ -n "$PID" ]; then
  echo "FDS=$(ls /proc/$PID/fd 2>/dev/null | wc -l | tr -d ' ')"
  echo "RSS_KB=$(awk '/^VmRSS:/{print $2}' /proc/$PID/status 2>/dev/null)"
  echo "THREADS=$(awk '/^Threads:/{print $2}' /proc/$PID/status 2>/dev/null)"
else
  echo "FDS="
  echo "RSS_KB="
  echo "THREADS="
fi
echo "LONG_PROCS=$LP"
`
  const result = dockerExec(script)
  const values = {}
  for (const line of result.stdout.split('\n')) {
    const eq = line.indexOf('=')
    if (eq !== -1) values[line.slice(0, eq)] = line.slice(eq + 1)
  }
  return {
    status: result.status,
    pid: values.DSH_PID === '' || values.DSH_PID === undefined ? undefined : Number(values.DSH_PID),
    fds: values.FDS === '' || values.FDS === undefined ? undefined : Number(values.FDS),
    rssKb: values.RSS_KB === '' || values.RSS_KB === undefined ? undefined : Number(values.RSS_KB),
    threads: values.THREADS === '' || values.THREADS === undefined ? undefined : Number(values.THREADS),
    longProcs: Number(values.LONG_PROCS ?? 0),
    stderr: result.stderr,
  }
}

/* ------------------------------------------------------------ SQLite 探针 */

function sqliteProbe(file, withSessionCount = false) {
  const code = `
const {DatabaseSync}=require('node:sqlite');
const f=process.argv[1];
try {
  const db=new DatabaseSync(f,{readOnly:true});
  db.exec('PRAGMA busy_timeout=5000');
  const journal=db.prepare('PRAGMA journal_mode').get();
  const integrity=db.prepare('PRAGMA integrity_check').all().map(row=>Object.values(row)[0]);
  let sessions=undefined;
  if (process.argv[2]==='1') {
    try { sessions=db.prepare('SELECT COUNT(*) AS n FROM sessions').get().n } catch { sessions=undefined }
  }
  db.close();
  process.stdout.write(JSON.stringify({ok:true,journal:journal?.journal_mode,integrity,sessions}));
} catch (e) {
  process.stdout.write(JSON.stringify({ok:false,error:String((e&&e.message)||e)}));
}
`
  const result = spawnSync(process.execPath, ['-e', code, file, withSessionCount ? '1' : '0'], { encoding: 'utf8', timeout: 120_000 })
  let parsed
  try {
    parsed = JSON.parse(result.stdout)
  } catch {
    parsed = { ok: false, error: `sqlite probe 输出非 JSON（exit=${result.status}）` }
  }
  const wal = existsSync(`${file}-wal`) ? statSync(`${file}-wal`).size : 0
  const shm = existsSync(`${file}-shm`) ? statSync(`${file}-shm`).size : 0
  return { file: file.slice(DATA_ROOT.length + 1), walBytes: wal, shmBytes: shm, ...parsed }
}

/* ------------------------------------------------------------------ 登录 */

const accounts = loadAccounts(ACCOUNTS_FILE)
let cookie = ''
let lastLoginAt = 0

async function refreshAuth(force = false) {
  if (!force && Date.now() - lastLoginAt < 50 * 60_000) return
  const dsh = await bootstrapDshSession(BASE, typeof args['boot-token'] === 'string' ? args['boot-token'] : bootTokenFromContainer(CONTAINER))
  const auth = await login(BASE, accounts.admin.account, accounts.admin.password)
  if (auth.status !== 200) throw new Error(`登录失败 status=${auth.status}`)
  cookie = `${dsh}; ${auth.cookie}`
  lastLoginAt = Date.now()
  log('auth refreshed')
}

async function call(method, params) {
  const result = await rpc(BASE, cookie, method, params, { timeoutMs: 90_000 })
  if (result.status === 401) {
    await refreshAuth(true)
    return rpc(BASE, cookie, method, params, { timeoutMs: 90_000 })
  }
  return result
}

/* ---------------------------------------------------------------- 采样面 */

const termSamples = []
const dataSamples = []
let victimSession
let longProcess = { started: false, ok: false, detail: 'not-started' }
let lastDataAt = 0
let tick = 0
let stopping = false

function finalize(reason) {
  if (stopping) return
  stopping = true
  const endedAt = new Date()
  const elapsedSeconds = Math.round((endedAt.getTime() - startedAt.getTime()) / 1000)
  const complete = elapsedSeconds >= DURATION_SECONDS && reason === 'planned-end'

  const summary = {
    script: 'scripts/soak-rc5.mjs',
    tag: TAG,
    suite: SUITE,
    startedAt: startedAt.toISOString(),
    endedAt: endedAt.toISOString(),
    plannedSeconds: DURATION_SECONDS,
    elapsedSeconds,
    reason,
    window: {
      complete,
      requirement: '24h 窗口未满不得判定通过（54 §6.3）',
      note: complete ? '窗口已满' : `窗口未满（${elapsedSeconds}s/${DURATION_SECONDS}s），本摘要只作进度证据`,
    },
    container: CONTAINER,
    dataRoot: DATA_ROOT,
    counts: { termSamples: termSamples.length, dataSamples: dataSamples.length },
    logs: { term: TERM_LOG, data: DATA_LOG, soak: SOAK_LOG },
    term: undefined,
    data: undefined,
    limitations: meta.limitations,
  }

  if (termSamples.length > 0) {
    const valid = termSamples.filter(sample => Number.isFinite(sample.fds) && Number.isFinite(sample.rssKb))
    const fds = valid.map(sample => sample.fds)
    const rss = valid.map(sample => sample.rssKb)
    // 稳态判据（TERM-013 原意「无持续增长」）：启动 1h 为预热（profile/JIT/缓存/首轮
    // 测试流量），趋势只比较 [1h,2h) 的基线中位数与最后 30min 的中位数。短时窗口
    //（<2h，仅冒烟/调试）退化为「前 10% 样本基线 vs 最后 10 个样本」，绝不假称 24h。
    const warmupSeconds = DURATION_SECONDS >= 7200 ? 3600 : Math.max(1, Math.round(DURATION_SECONDS * 0.1))
    const warm = valid.filter(sample => sample.elapsedSeconds >= warmupSeconds)
    const median = values => {
      if (values.length === 0) return undefined
      const sorted = [...values].sort((a, b) => a - b)
      const middle = Math.floor(sorted.length / 2)
      return sorted.length % 2 === 1 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2
    }
    const baseWindow = warm.filter(sample => sample.elapsedSeconds < warmupSeconds * 2)
    const baselineSamples = baseWindow.length >= 3 ? baseWindow : (warm.length >= 3 ? warm.slice(0, Math.min(10, warm.length)) : valid.slice(0, Math.min(10, valid.length)))
    const steadySamples = warm.slice(-Math.max(10, Math.min(warm.length, 30)))
    const baseFd = median(baselineSamples.map(sample => sample.fds))
    const steadyFd = median(steadySamples.map(sample => sample.fds))
    const baseRss = median(baselineSamples.map(sample => sample.rssKb))
    const steadyRss = median(steadySamples.map(sample => sample.rssKb))
    const warmFds = warm.map(sample => sample.fds)
    const warmRss = warm.map(sample => sample.rssKb)
    const churnSamples = warm.length > 0 ? warm : valid
    const churnFailures = churnSamples.filter(sample => sample.churn !== 'ok')
    const churnErrors = [...new Set(churnFailures.map(sample => sample.churnError).filter(Boolean))]
    const fdGrowth = baseFd === undefined || steadyFd === undefined ? undefined : steadyFd - baseFd
    const rssGrowthMb = baseRss === undefined || steadyRss === undefined ? undefined : (steadyRss - baseRss) / 1024
    const fdSpread = warmFds.length === 0 ? undefined : Math.max(...warmFds) - Math.min(...warmFds)
    const rssLimitMb = baseRss === undefined ? undefined : Math.max(24, (baseRss / 1024) * 0.08)
    const fdOk = fdGrowth !== undefined && fdGrowth <= 4 && fdSpread !== undefined && fdSpread <= 8
    const rssOk = rssGrowthMb !== undefined && rssLimitMb !== undefined && rssGrowthMb <= rssLimitMb
    const churnOk = churnSamples.length > 0 && churnFailures.length === 0
    let verdict = 'NOTRUN'
    if (complete) verdict = fdOk && rssOk && churnOk ? 'PASS' : 'FAIL'
    summary.term = {
      verdict,
      samples: termSamples.length,
      basis: { warmupSeconds, baselineSamples: baselineSamples.length, steadySamples: steadySamples.length, method: '预热期后基线中位数 vs 末 30min 中位数' },
      fd: {
        first: fds[0], last: fds[fds.length - 1], min: fds.length === 0 ? undefined : Math.min(...fds), max: fds.length === 0 ? undefined : Math.max(...fds),
        baseline: baseFd, steady: steadyFd, growth: fdGrowth, spreadAfterWarmup: fdSpread, ok: fdOk,
      },
      rssKb: {
        first: rss[0], last: rss[rss.length - 1], min: rss.length === 0 ? undefined : Math.min(...rss), max: rss.length === 0 ? undefined : Math.max(...rss),
        baseline: baseRss, steady: steadyRss,
        growthMb: rssGrowthMb === undefined ? undefined : Number(rssGrowthMb.toFixed(2)),
        limitMb: rssLimitMb === undefined ? undefined : Number(rssLimitMb.toFixed(2)),
        ok: rssOk,
      },
      churn: { cycles: churnSamples.length, failures: churnFailures.length, firstError: churnErrors[0], ok: churnOk },
      longProcess,
    }
  }

  if (dataSamples.length > 0) {
    const integrityFailures = dataSamples.flatMap(sample => (sample.databases ?? []).filter(db => db.ok !== true || !(Array.isArray(db.integrity) && db.integrity.includes('ok'))).map(db => `${db.file}: ${db.error ?? JSON.stringify(db.integrity)}`))
    const writerFailures = dataSamples.reduce((sum, sample) => sum + (sample.write?.failed ?? 0), 0)
    const writerErrors = [...new Set(dataSamples.flatMap(sample => (sample.write?.errors ?? [])))]
    const lockHits = dataSamples.reduce((sum, sample) => sum + (sample.lockMatches ?? 0), 0)
    let verdict = 'NOTRUN'
    if (complete) verdict = integrityFailures.length === 0 && writerFailures === 0 && lockHits === 0 ? 'PASS' : 'FAIL'
    summary.data = {
      verdict,
      samples: dataSamples.length,
      cycles: dataSamples.reduce((sum, sample) => sum + (sample.write?.ok ?? 0), 0),
      writerFailures,
      writerErrors: writerErrors.slice(0, 5),
      integrityFailures: integrityFailures.slice(0, 5),
      lockMatches: lockHits,
      walBytesFirst: dataSamples[0]?.databases?.map(db => ({ file: db.file, walBytes: db.walBytes })) ?? [],
      walBytesLast: dataSamples[dataSamples.length - 1]?.databases?.map(db => ({ file: db.file, walBytes: db.walBytes })) ?? [],
      sessionRows: dataSamples[dataSamples.length - 1]?.databases?.find(db => db.file === 'access/users.db')?.sessions,
    }
  }

  writeFileSync(SUMMARY_PATH, `${JSON.stringify(summary, null, 2)}\n`)
  log(`soak stop reason=${reason} elapsed=${elapsedSeconds}s complete=${complete} term=${summary.term?.verdict ?? '-'} data=${summary.data?.verdict ?? '-'} summary=${SUMMARY_PATH}`)
  const failed = summary.term?.verdict === 'FAIL' || summary.data?.verdict === 'FAIL'
  process.exit(failed ? 1 : 0)
}

for (const signal of ['SIGTERM', 'SIGINT']) {
  process.on(signal, () => {
    log(`signal ${signal}`)
    finalize('signal')
  })
}

/* ---------------------------------------------------------------- 主循环 */

await refreshAuth(true)

if (SUITE !== 'data') {
  const created = await call('session/create', { request: {} })
  victimSession = created.value?.sessionId ?? created.value?.id
  if (typeof victimSession !== 'string') {
    log(`session/create 失败，term 面改用数据面会话缺失记账：${shape(created.error ?? created.text).slice(0, 160)}`)
  } else {
    log(`victim session=${victimSession}`)
  }
  const fixture = containerFixturePresent()
  if (fixture) {
    longProcess = { started: true, ...startLongProcess(DURATION_SECONDS + 600) }
  } else {
    longProcess = { started: false, ok: false, detail: '/fixtures/long-process.sh 未挂载（E1 override 的 RC5_FIXTURES）' }
  }
  log(`long process: ${longProcess.detail}`)
}

/** attach churn：带 cookie 开 mux 流 → 等首个 snapshot → 断开；失败只记账。 */
async function attachCycle(terminalId) {
  const port = Number(new URL(BASE).port || 80)
  const socket = await openMuxSocket({ port, cookie }).catch(error => ({ error }))
  if (socket.error !== undefined) return { ok: false, detail: `ws: ${socket.error.message}` }
  const streamId = `soak-attach-${terminalId}`
  try {
    socket.send({ type: 'open', streamId, endpoint: 'terminal/attach', payload: { args: { agentId: victimSession, id: terminalId } } })
    const frame = await socket.waitMessage(row => row.streamId === streamId && ['item', 'error', 'end'].includes(row.type), 10_000)
      .catch(error => ({ timeout: error.message }))
    if (frame.timeout !== undefined) return { ok: false, detail: 'attach-timeout' }
    if (frame.type === 'error') return { ok: false, detail: `${frame.error?.code ?? 'error'}` }
    if (frame.type === 'end') return { ok: false, detail: 'attach-ended' }
    return { ok: frame.value?.type === 'snapshot', detail: frame.value?.type ?? 'item' }
  } finally {
    socket.close()
  }
}

while (Date.now() < endsAt.getTime() && !stopping) {
  tick += 1
  const now = Date.now()
  const elapsed = Math.round((now - startedAt.getTime()) / 1000)

  try {
    if (SUITE !== 'data') {
      const container = sampleContainer()
      let churn = 'skipped'
      let churnError
      if (typeof victimSession === 'string') {
        const terminalId = `soak-${TAG.slice(0, 12)}-${tick}`
        const created = await call('terminal/create', { agentId: victimSession, request: { id: terminalId, cols: 80, rows: 24 } })
        let attached = { ok: false, detail: 'create-failed' }
        let closed = { ok: false, detail: 'not-closed' }
        if (created.ok === true) {
          attached = await attachCycle(terminalId)
          closed = await call('terminal/close', { agentId: victimSession, id: terminalId })
        }
        churn = created.ok && attached.ok && closed.ok ? 'ok' : 'fail'
        churnError = churn === 'ok' ? undefined : `create=${created.ok ? 'ok' : shape(created.error).slice(0, 60)} attach=${attached.ok ? 'ok' : shape(attached.detail, 60)} close=${closed.ok ? 'ok' : shape(closed.error ?? closed.detail, 60)}`
      }
      const sample = {
        at: new Date().toISOString(),
        elapsedSeconds: elapsed,
        dshPid: container.pid,
        fds: container.fds,
        rssKb: container.rssKb,
        threads: container.threads,
        longProcs: container.longProcs,
        churn,
        churnError,
        probeExit: container.status,
      }
      termSamples.push(sample)
      appendJsonl(TERM_LOG, sample)
      if (tick === 1 || tick % 30 === 0) {
        log(`term tick=${tick} fds=${sample.fds ?? '-'} rssKb=${sample.rssKb ?? '-'} threads=${sample.threads ?? '-'} longProcs=${sample.longProcs} churn=${churn}`)
      }
    }
  } catch (error) {
    log(`term tick=${tick} 采样异常：${redact(String(error instanceof Error ? error.message : error)).slice(0, 200)}`)
  }

  if (SUITE !== 'term' && now - lastDataAt >= DB_INTERVAL_SECONDS * 1000) {
    lastDataAt = now
    try {
      const databases = [
        sqliteProbe(join(DATA_ROOT, 'access', 'users.db'), true),
        sqliteProbe(join(DATA_ROOT, '.eterna', 'memory.sqlite3')),
        sqliteProbe(join(DATA_ROOT, 'knowledge-admin', 'access.sqlite3')),
      ]

      const outcomes = await Promise.all(Array.from({ length: WRITERS }, async () => {
        try {
          const result = await call('session/create', { request: {} })
          return result.ok === true ? { ok: true } : { ok: false, error: `${result.status} ${shape(result.error).slice(0, 100)}` }
        } catch (error) {
          return { ok: false, error: redact(String(error instanceof Error ? error.message : error)).slice(0, 100) }
        }
      }))
      const write = {
        ok: outcomes.filter(item => item.ok).length,
        failed: outcomes.filter(item => !item.ok).length,
        errors: [...new Set(outcomes.filter(item => !item.ok).map(item => item.error))],
      }

      const logs = spawnSync('docker', ['logs', '--since', `${Math.max(DB_INTERVAL_SECONDS * 2, 120)}s`, CONTAINER], { encoding: 'utf8', timeout: 60_000, maxBuffer: 16 * 1024 * 1024 })
      const logText = `${logs.stdout ?? ''}\n${logs.stderr ?? ''}`
      const lockMatches = (logText.match(/database is locked|SQLITE_BUSY/gi) ?? []).length
      const walMatches = (logText.match(/wal|WAL/g) ?? []).length

      const sample = {
        at: new Date().toISOString(),
        elapsedSeconds: elapsed,
        databases,
        write,
        lockMatches,
        walLogMatches: walMatches,
      }
      dataSamples.push(sample)
      appendJsonl(DATA_LOG, sample)
      log(`data tick=${tick} integrity=${databases.map(db => `${db.file}:${db.ok ? 'ok' : 'FAIL'}`).join(',')} writeOk=${write.ok}/${write.ok + write.failed} lockMatches=${lockMatches} sessions=${databases[0]?.sessions ?? '-'}`)
    } catch (error) {
      log(`data tick=${tick} 采样异常：${redact(String(error instanceof Error ? error.message : error)).slice(0, 200)}`)
    }
  }

  const remaining = endsAt.getTime() - Date.now()
  if (remaining <= 0) break
  await new Promise(resolvePromise => setTimeout(resolvePromise, Math.min(INTERVAL_SECONDS * 1000, remaining)))
}

finalize('planned-end')