#!/usr/bin/env node
/**
 * E1 · BOOT 套件（RC5-BOOT-001..011；012/013 见表尾说明，由浏览器脚本补证）。
 *
 * 环境：独立容器 rc5-e1suite（3118，镜像 eterna-agent:rc5-test）与独立数据根
 * $HOME/eterna-data/test-20261120；补充 boot 探针使用同库镜像 + 独立子根。
 */
import { chmodSync, cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { Case, STATUS, summaryOf, writeSummary, shape } from '../_lib/evidence.mjs'
import {
  LANE, REPO, composeArgs, run, docker, sleep, waitHealth, sessions, call,
  readDb, gitHead, shape as envShape,
} from '../_lib/env.mjs'

const suite = 'BOOT'
const startedAt = new Date().toISOString()
const rows = []

function record(c, status, title, expected, actual, notes = [], artifacts = []) {
  const row = c.finish({ status, title, expected, actual, notes, artifacts: [...artifacts, 'cmd.log'] })
  rows.push(row)
  return row
}

function dumpConfig(container, profile, extraArgs = []) {
  const outPath = `/tmp/dump-${profile}-${Date.now()}.yml`
  const result = docker(['exec', container, 'sh', '-c', `DSH_HOME=/data dsh --profile ${profile} --dump-config ${extraArgs.join(' ')} > ${outPath}; echo EXIT=$?; wc -c < ${outPath}`])
  const text = result.stdout
  const exit = /EXIT=(\d+)/.exec(text)?.[1] ?? '-1'
  const size = text.split('\n').pop() ?? '0'
  if (exit !== '0') return { exit: Number(exit), text: '', size: 0, display: result.display, stderr: result.stderr }
  const copied = docker(['cp', `${container}:${outPath}`, outPath])
  const local = readFileSync(outPath, 'utf8')
  return { exit: 0, text: local, size: local.length, display: `${result.display} && docker cp ${container}:${outPath}`, stderr: copied.stderr }
}

/** 解析 dump YAML 中的行 id（含嵌套）与 disabled 标记。 */
function parseRows(yaml) {
  const lines = yaml.split('\n')
  const rows = []
  let current
  for (const line of lines) {
    const match = /^(\s*)- id: (\S+)\s*$/.exec(line)
    if (match !== null) {
      current = { id: match[2], indent: match[1].length, disabled: false }
      rows.push(current)
      continue
    }
    if (current !== undefined && /^\s+disabled: true\s*$/.test(line)) current.disabled = true
  }
  return rows
}

function idSet(yaml) {
  return new Set([...yaml.matchAll(/^\s*- id: (\S+)\s*$/gm)].map(match => match[1]))
}

/* ------------------------------------------------------------ 容器启动探针 */

/**
 * 在独立子根上起一个临时容器（不发布端口），等 8080 可访问；返回证据。
 * 用 `docker run` 而非 compose：每例独立根/独立容器名，不碰主容器。
 */
async function bootProbe(name, root, { form = 'web', timeoutMs = 150_000 } = {}) {
  rmContainer(name)
  const runArgs = [
    'run', '-d', '--name', name,
    '-e', 'DSH_HOME=/data',
    '-e', 'DSH_AGENTS_HOME=/data/agents',
    '-e', `ETERNA_FORM=${form}`,
    '-e', 'MIMO_API_KEY=e1suite-placeholder-not-a-secret',
    '-v', `${root}:/data`,
    LANE.imageTag,
  ]
  const started = docker(runArgs)
  if (started.exit !== 0) return { started, health: 'start-failed', http: 0, logs: started.stderr }
  const began = Date.now()
  let http = 0
  let health = 'starting'
  while (Date.now() - began < timeoutMs) {
    health = docker(['inspect', name, '--format', '{{.State.Health.Status}}']).stdout || 'unknown'
    const probe = docker(['exec', name, 'sh', '-c', 'curl -s -o /dev/null -w "%{http_code}" "http://$(hostname -i | awk \'{print $1}\'):8080/"'])
    http = Number.parseInt(probe.stdout, 10) || 0
    if (health === 'healthy') break
    if (health === 'unhealthy') break
    await sleep(2000)
  }
  const logs = docker(['logs', name])
  return {
    started, health, http, logs: `${logs.stdout}\n${logs.stderr}`,
    elapsedMs: Date.now() - began,
  }
}

function rmContainer(name) {
  docker(['rm', '-f', name])
}

/* --------------------------------------------------------- BOOT-001 */

{
  const c = new Case(suite, 'RC5-BOOT-001')
  // 空根要求：重跑时先清空 fresh 实例（仅测试根内）。
  rmSync(LANE.freshRoot, { recursive: true, force: true })
  run('bash', [join(REPO, 'deploy', 'init-data-dirs.sh'), 'fresh'], { env: { ...process.env, ETERNA_DATA_ROOT: LANE.dataBase } })
  const pre = {
    profiles: existsSync(join(LANE.freshRoot, 'profiles')) ? readdirSync(join(LANE.freshRoot, 'profiles')).length : 0,
    usersDb: existsSync(join(LANE.freshRoot, 'access', 'users.db')),
    sessions: existsSync(join(LANE.freshRoot, 'sessions')) ? readdirSync(join(LANE.freshRoot, 'sessions')).length : 0,
  }
  c.note(`空根前置：profiles=${pre.profiles} usersDb=${pre.usersDb} sessions=${pre.sessions}`)
  const probe = await bootProbe('rc5-e1suite-fresh', LANE.freshRoot)
  c.cmd('docker run … rc5-e1suite-fresh（独立空根 $HOME/eterna-data/test-20261120/fresh）', probe.started.exit, probe.logs.slice(-3000))
  writeFileSync(join(c.dir, 'boot.log'), probe.logs)
  const bad = probe.logs.split('\n').filter(line => /\bERR_/.test(line) || /unhandled/i.test(line) || /unknown plugin row/.test(line))
  c.assert('health==healthy', probe.health === 'healthy', `health=${probe.health} http=${probe.http} elapsedMs=${probe.elapsedMs}`)
  c.assert('日志无 ERR_/unhandled/unknown plugin row', bad.length === 0, `命中=${bad.length}`)
  const emptyOk = pre.profiles === 0 && pre.usersDb === false && pre.sessions === 0
  record(c, probe.health === 'healthy' && bad.length === 0 && emptyOk ? STATUS.PASS : STATUS.FAIL,
    'E1 空数据根首启',
    '容器 healthy；日志无 ERR_/unhandled；空根无既有 profile/会话',
    `health=${probe.health} http=${probe.http} 日志错误行=${bad.length} 空根前置=${emptyOk}`,
    [`首启耗时约 ${Math.round(probe.elapsedMs / 1000)}s；空根=profiles:${pre.profiles} users.db:${pre.usersDb} sessions:${pre.sessions}`],
    ['boot.log'])
  rmContainer('rc5-e1suite-fresh')
}

/* --------------------------------------------------------- BOOT-002 */

{
  const c = new Case(suite, 'RC5-BOOT-002')
  // 独立 super 实例根：预置 access 状态（沿用同一组测试账号，不新建凭据）。
  mkdirSync(join(LANE.superRoot, 'access'), { recursive: true, mode: 0o700 })
  chmodSync(join(LANE.superRoot, 'access'), 0o700)
  if (!existsSync(join(LANE.superRoot, 'access', 'users.db'))) {
    const backup = run('sqlite3', [join(LANE.dataRoot, 'access', 'users.db'), `.backup '${join(LANE.superRoot, 'access', 'users.db')}'`])
    c.cmd('sqlite3 <e1-users.db> ".backup <super-root>/access/users.db"', backup.exit, backup.stderr)
  }
  if (!existsSync(join(LANE.superRoot, 'access', 'secret.key'))) {
    cpSync(join(LANE.dataRoot, 'access', 'secret.key'), join(LANE.superRoot, 'access', 'secret.key'))
  }
  rmContainer(LANE.superContainer)
  const started = docker(['run', '-d', '--name', LANE.superContainer,
    '-p', `127.0.0.1:${LANE.superPort}:8080`,
    '-e', 'DSH_HOME=/data', '-e', 'DSH_AGENTS_HOME=/data/agents',
    '-e', 'ETERNA_FORM=super', '-e', 'MIMO_API_KEY=e1suite-placeholder-not-a-secret',
    '-e', `ETERNA_TRUSTED_HOST=127.0.0.1:${LANE.superPort} localhost:${LANE.superPort}`,
    '-v', `${LANE.superRoot}:/data`, LANE.imageTag])
  c.cmd('docker run -d … rc5-e1suite-super（ETERNA_FORM=super，127.0.0.1:3117:8080）', started.exit, started.stdout, started.stderr)
  const health = await waitHealth(LANE.superContainer, 90)
  const logs = docker(['logs', LANE.superContainer])
  writeFileSync(join(c.dir, 'boot.log'), `${logs.stdout}\n${logs.stderr}`)
  const login = await run('curl', ['-s', '-o', '/dev/null', '-w', '%{http_code}', `http://127.0.0.1:${LANE.superPort}/login`])
  c.cmd(`curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:${LANE.superPort}/login`, login.exit, login.stdout)
  const form = /form=super profile=eterna-super/.test(`${logs.stdout}`)
  record(c, health === 'healthy' && login.stdout === '200' && form ? STATUS.PASS : STATUS.FAIL,
    'E3 super 形态启动',
    'super 容器 healthy；super 路由（/login）可访问；日志 form=super profile=eterna-super',
    `health=${health} login=${login.stdout} logForm=${form}`,
    ['super 实例独立根：$HOME/eterna-data/test-20261120/super；端口 3117（避开 3109 的另一 lane 容器）'],
    ['boot.log'])
}

/* --------------------------------------------------------- BOOT-003 */

{
  const c = new Case(suite, 'RC5-BOOT-003')
  const outJson = join(c.dir, 'acp-report.json')
  const result = run('node', [join(REPO, 'scripts', 'verify-acp-stdio.mjs'),
    '--project', LANE.project, '--env-file', LANE.composeEnv,
    '--timeout-ms', '60000', '--json', outJson], { timeout: 240_000 })
  c.cmd('node scripts/verify-acp-stdio.mjs --project rc5-e1suite --env-file …/.env.e1suite --timeout-ms 60000 --json <case>/acp-report.json', result.exit, result.stdout.slice(-4000), result.stderr)
  const report = existsSync(outJson) ? JSON.parse(readFileSync(outJson, 'utf8')) : undefined
  const init = report?.cases?.find(row => row.id === 'RC5-ACP-001')
  const pure = report?.cases?.find(row => row.id === 'RC5-ACP-003')
  const noPort = report?.cases?.find(row => row.id === 'RC5-ACP-004')
  record(c, init?.status === 'PASS' && pure?.status === 'PASS' && noPort?.status === 'PASS' ? STATUS.PASS : STATUS.FAIL,
    'E4 ACP 容器启动（进程存活、stdio 纯净）',
    'initialize 协议协商成功；stdout 仅 JSON-RPC；无监听端口',
    `ACP-001=${init?.status} ACP-003=${pure?.status} ACP-004=${noPort?.status}`,
    ['本用例借用 P4 lane 的 ACP 探针（scripts/verify-acp-stdio.mjs），但项目/数据根指向本 lane 的 rc5-e1suite'],
    ['acp-report.json'])
}

/* --------------------------------------------------------- BOOT-004/005/006/007 */

const dump = dumpConfig(LANE.container, 'eterna-web')
{
  const c = new Case(suite, 'RC5-BOOT-004')
  c.cmd(dump.display, dump.exit, `dump bytes=${dump.size}`)
  writeFileSync(join(c.dir, 'dump-config.yml'), dump.text)
  const logs = docker(['logs', LANE.container])
  const hits = (`${logs.stdout}\n${logs.stderr}`).split('\n').filter(line => /unknown plugin row/i.test(line))
  c.assert('unknown plugin row == 0', hits.length === 0, `hits=${hits.length}`)
  record(c, hits.length === 0 ? STATUS.PASS : STATUS.FAIL,
    '启动日志无未知 plugin 行',
    '`unknown plugin row` 计数 0',
    `计数=${hits.length}`,
    ['日志取自本 lane 容器自启动以来的全部 stdout/stderr'],
    ['dump-config.yml'])
}

{
  const c = new Case(suite, 'RC5-BOOT-005')
  c.cmd(dump.display, dump.exit, `dump bytes=${dump.size}`)
  const ids = idSet(dump.text)
  const removed = ['account-controller', 'office-to-pdf']
  const present = removed.filter(id => ids.has(id))
  c.assert('已删除行不存在', present.length === 0, `命中=${present.join(',') || 'none'}`)
  record(c, present.length === 0 ? STATUS.PASS : STATUS.FAIL,
    '已删除行不再出现',
    '`account-controller`、`office-to-pdf` 不在组合后的 profile 树',
    `命中=${present.length === 0 ? '无' : present.join(',')}`,
    ['判定面=`dsh --profile eterna-web --dump-config`（bundle 层 + 用户 patch 层全量合成）'],
    ['dump-config.yml'])
}

{
  const c = new Case(suite, 'RC5-BOOT-006')
  c.cmd(dump.display, dump.exit, `dump bytes=${dump.size}`)
  const parsed = parseRows(dump.text)
  const required = ['agent-team', 'tool-agent-team', 'ui-agent-team', 'ui-file-actions', 'ui-context-menu', 'mcp-manager', 'office-kit', 'skill-office', 'deepseek-chat-import']
  const findings = required.map(id => {
    const matches = parsed.filter(row => row.id === id)
    return { id, count: matches.length, enabled: matches.some(row => row.disabled === false) }
  })
  const missing = findings.filter(row => row.count === 0)
  const disabled = findings.filter(row => row.count > 0 && !row.enabled)
  writeFileSync(join(c.dir, 'rows.json'), `${JSON.stringify(findings, null, 2)}\n`)
  record(c, missing.length === 0 && disabled.length === 0 ? STATUS.PASS : STATUS.FAIL,
    'rc.5 新增行全部到位',
    required.join('、') + ' 全部在组合树中且启用',
    `missing=${missing.map(row => row.id).join(',') || 'none'} disabled=${disabled.map(row => row.id).join(',') || 'none'}`,
    ['`enabled` 判定=该 id 至少一处未标 `disabled: true`'],
    ['dump-config.yml', 'rows.json'])
}

{
  const c = new Case(suite, 'RC5-BOOT-007')
  const defaultDump = dumpConfig(LANE.container, 'eterna-web', ['--dump-default-config'])
  c.cmd(defaultDump.display, defaultDump.exit, `default dump bytes=${defaultDump.size}`)
  writeFileSync(join(c.dir, 'dump-default.yml'), defaultDump.text)
  const composed = idSet(dump.text)
  const defaults = idSet(defaultDump.text)
  const missing = [...defaults].filter(id => !composed.has(id))
  c.assert('默认行无丢失', missing.length === 0, `default=${defaults.size} composed=${composed.size} missing=${missing.length}`)
  record(c, missing.length === 0 ? STATUS.PASS : STATUS.FAIL,
    'preset 全量替换后 rc.5 默认行无丢失',
    '`--dump-default-config` 的每个行 id 仍出现在 `--dump-config` 中',
    `默认行=${defaults.size} 组合行=${composed.size} 丢失=${missing.length}${missing.length === 0 ? '' : `（${missing.slice(0, 10).join(',')}）`}`,
    ['两 dump 均在同一容器内生成（同一镜像/同一 profile 层）'],
    ['dump-default.yml', 'dump-config.yml'])
}

/* --------------------------------------------------------- BOOT-008/009/010 */

const boot8Root = join(LANE.dataBase, 'boot8')
const boot10Root = join(LANE.dataBase, 'boot10')
function initRoot(instance) {
  const result = run('bash', [join(REPO, 'deploy', 'init-data-dirs.sh'), instance], { env: { ...process.env, ETERNA_DATA_ROOT: LANE.dataBase } })
  return result
}
function bundlesOf(root) {
  const manifest = JSON.parse(readFileSync(join(root, 'profiles', 'eterna-web', 'package.json'), 'utf8'))
  return manifest?.dsh?.profile?.bundles ?? []
}
function writeBundles(root, bundles) {
  const path = join(root, 'profiles', 'eterna-web', 'package.json')
  const manifest = JSON.parse(readFileSync(path, 'utf8'))
  manifest.dsh = manifest.dsh ?? {}
  manifest.dsh.profile = manifest.dsh.profile ?? {}
  manifest.dsh.profile.bundles = bundles
  writeFileSync(path, `${JSON.stringify(manifest, null, 2)}\n`)
}

{
  const c = new Case(suite, 'RC5-BOOT-008')
  rmSync(boot8Root, { recursive: true, force: true })
  initRoot('boot8')
  const baseline = await bootProbe('rc5-e1suite-boot8', boot8Root)
  c.cmd('docker run -d … rc5-e1suite-boot8（基线启动，生成渲染 profile）', baseline.started.exit, `health=${baseline.health} http=${baseline.http}`)
  writeFileSync(join(c.dir, 'boot-baseline.log'), baseline.logs)
  const oldBundles = ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app']
  writeBundles(boot8Root, oldBundles)
  const markerPath = join(boot8Root, 'profiles', 'eterna-web', '.eterna-default-bundles.json')
  if (existsSync(markerPath)) rmSync(markerPath)
  const before = bundlesOf(boot8Root)
  const first = await bootProbe('rc5-e1suite-boot8', boot8Root)
  writeFileSync(join(c.dir, 'boot-first-migrate.log'), first.logs)
  const afterFirst = bundlesOf(boot8Root)
  const appended = afterFirst.filter(item => !before.includes(item))
  const marker1 = existsSync(markerPath) ? JSON.parse(readFileSync(markerPath, 'utf8')) : undefined
  const backups = readdirSync(join(boot8Root, 'profiles', 'eterna-web')).filter(name => name.startsWith('package.json.bak-'))
  const second = await bootProbe('rc5-e1suite-boot8', boot8Root)
  writeFileSync(join(c.dir, 'boot-second.log'), second.logs)
  const afterSecond = bundlesOf(boot8Root)
  const marker2 = JSON.parse(readFileSync(markerPath, 'utf8'))
  const idempotent = JSON.stringify(afterFirst) === JSON.stringify(afterSecond) && JSON.stringify(marker1) === JSON.stringify(marker2)
  c.cmd('docker run -d … rc5-e1suite-boot8（旧清单 → 首启迁移）', first.started.exit, `appended=${appended.length} health=${first.health}`)
  c.cmd('docker run -d … rc5-e1suite-boot8（二次启动，幂等核对）', second.started.exit, `after2=${afterSecond.length} health=${second.health}`)
  c.assert('首启追加 rc.5 默认 bundle', appended.length === 4, `appended=${appended.join(',')}`)
  c.assert('marker 记录默认集', Array.isArray(marker1?.defaultBundles) && marker1.defaultBundles.length >= 4, `marker=${marker1?.defaultBundles?.length ?? 'none'}`)
  c.assert('二次启动不重复追加', idempotent, `after1=${afterFirst.length} after2=${afterSecond.length}`)
  c.assert('写回前备份存在', backups.length > 0, `backups=${backups.join(',') || 'none'}`)
  record(c, appended.length === 4 && idempotent && backups.length > 0 ? STATUS.PASS : STATUS.FAIL,
    '旧 profile 默认 bundle 迁移（只追加一次）',
    '旧清单仅 base+web-app：首启追加 4 个 rc.5 默认；marker 落盘；二次启动零追加；备份 package.json.bak-* 存在',
    `追加=${appended.length}(${appended.map(item => item.split('/').pop()).join(',')}) 幂等=${idempotent} 备份=${backups.length} 首启健康=${first.health}`,
    ['旧卷模拟=已渲染 profile 的 package.json 回退为 rc.4 默认清单并移除 marker（模板哈希不变，入口走 keep 路径，迁移脚本据实追加）'],
    ['boot-baseline.log', 'boot-first-migrate.log', 'boot-second.log'])
}

{
  const c = new Case(suite, 'RC5-BOOT-009')
  const terminalBundle = '@deepseek-ai/dsh-experimental-terminal-bundle'
  const withOptOut = bundlesOf(boot8Root).filter(item => item !== terminalBundle)
  writeBundles(boot8Root, withOptOut)
  const before = bundlesOf(boot8Root)
  const probe = await bootProbe('rc5-e1suite-boot8', boot8Root)
  writeFileSync(join(c.dir, 'boot-optout.log'), probe.logs)
  const after = bundlesOf(boot8Root)
  const marker = JSON.parse(readFileSync(join(boot8Root, 'profiles', 'eterna-web', '.eterna-default-bundles.json'), 'utf8'))
  const notReadded = !after.includes(terminalBundle)
  const markerKnows = (marker.defaultBundles ?? []).includes(terminalBundle)
  c.cmd('docker run -d … rc5-e1suite-boot8（用户 opt-out 后再启）', probe.started.exit, `before=${before.length} after=${after.length} health=${probe.health}`)
  c.assert('opt-out 项未被回加', notReadded && JSON.stringify(before) === JSON.stringify(after), `terminalBundle=${notReadded}`)
  c.assert('marker 仍记录该默认项', markerKnows, `marker 含 terminal=${markerKnows}`)
  record(c, notReadded && markerKnows ? STATUS.PASS : STATUS.FAIL,
    '已 opt-out 的默认 bundle 不回加',
    '从清单删除 terminal bundle 后重启：不再追加；marker 仍记该项（用户关闭语义）',
    `清单漂移=${JSON.stringify(before) === JSON.stringify(after) ? '无' : '有'} marker含terminal=${markerKnows} health=${probe.health}`,
    [],
    ['boot-optout.log'])
}

{
  const c = new Case(suite, 'RC5-BOOT-010')
  rmSync(boot10Root, { recursive: true, force: true })
  cpSync(boot8Root, boot10Root, { recursive: true })
  const pkgPath = join(boot10Root, 'profiles', 'eterna-web', 'package.json')
  const corrupt = '{\n  "name": "eterna-web",\n  "dsh": { "profile": { "bundles": [ BROKEN\n'
  writeFileSync(pkgPath, corrupt)
  const probe = await bootProbe('rc5-e1suite-boot10', boot10Root, { timeoutMs: 90_000 })
  writeFileSync(join(c.dir, 'boot-corrupt.log'), probe.logs)
  const backupPath = join(boot10Root, 'profiles', 'eterna-web', '.upgrade-profile-bundles-backup.json')
  const backupExists = existsSync(backupPath)
  const backupMode = backupExists ? (statSync(backupPath).mode & 0o777).toString(8) : 'n/a'
  const preserved = readFileSync(pkgPath, 'utf8') === corrupt
  const warn = /WARNING profile 存量迁移有失败项/.test(probe.logs)
  const scriptError = /\[migrate-profile-bundles\]: ERROR/.test(probe.logs)
  c.cmd('docker run -d … rc5-e1suite-boot10（package.json 损坏副本）', probe.started.exit, `health=${probe.health} http=${probe.http} backup=${backupExists} mode=${backupMode}`)
  c.assert('损坏原文件保留', preserved, `preserved=${preserved}`)
  c.assert('迁移留痕 0600', backupExists && backupMode === '600', `backup=${backupExists} mode=${backupMode}`)
  c.assert('告警清晰', warn && scriptError, `entrypointWarning=${warn} scriptError=${scriptError}`)
  record(c, preserved && backupExists && backupMode === '600' && warn ? STATUS.PASS : STATUS.FAIL,
    '损坏 package.json 的 profile 副本启动',
    '旧文件保留；`.upgrade-profile-bundles-backup.json`（0600）留痕；日志明确告警；boot 不静默吞错',
    `原文件保留=${preserved} 留痕=${backupExists}(${backupMode}) 告警=${warn} 脚本错误=${scriptError} 容器健康=${probe.health} HTTP=${probe.http}`,
    ['字段级实证：损坏 manifest 无法被上游装载，容器最终健康状态如实记录；本用例判据=失败可见且旧文件/留痕不丢'],
    ['boot-corrupt.log'])
  rmContainer('rc5-e1suite-boot10')
}

/* --------------------------------------------------------- BOOT-011 */

{
  const c = new Case(suite, 'RC5-BOOT-011')
  const envProbe = docker(['exec', LANE.container, 'printenv', 'DSH_AGENTS_HOME'])
  c.cmd('docker exec rc5-e1suite printenv DSH_AGENTS_HOME', envProbe.exit, envProbe.stdout)
  const resolver = docker(['exec', LANE.container, 'node', '-e',
    'const m=require("/usr/local/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-home-paths");process.stdout.write(String(m.resolveAgentsHome(undefined, process.env)))'])
  c.cmd('docker exec … node -e "require(dsh-home-paths).resolveAgentsHome(undefined, process.env)"', resolver.exit, resolver.stdout)
  const skillDir = join(LANE.dataRoot, 'agents', 'skills', 'e1suite-probe')
  mkdirSync(skillDir, { recursive: true, mode: 0o700 })
  writeFileSync(join(skillDir, 'SKILL.md'), '# e1suite-probe\n\nE1 套件用户级技能探针（仅测试数据根）。\n')
  const visible = docker(['exec', LANE.container, 'sh', '-c', 'test -f /data/agents/skills/e1suite-probe/SKILL.md && echo present'])
  c.cmd('docker exec … test -f /data/agents/skills/e1suite-probe/SKILL.md', visible.exit, visible.stdout)
  const providerScan = docker(['exec', LANE.container, 'sh', '-c',
    'grep -rl "agentsHome\\|agents" /usr/local/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-skill-filesystem/lib/index.js | head -1'])
  c.cmd('docker exec … grep agentsHome dsh-skill-filesystem/lib/index.js', providerScan.exit, providerScan.stdout)
  const pass = envProbe.stdout === '/data/agents' && resolver.stdout === '/data/agents' && visible.stdout === 'present'
  record(c, pass ? STATUS.PASS : STATUS.FAIL,
    'DSH_AGENTS_HOME 落 /data/agents 且用户级技能可写',
    '容器内 `DSH_AGENTS_HOME=/data/agents`；`resolveAgentsHome` 同值；用户 skills 目录可写、文件对 dsh 进程可见',
    `env=${envProbe.stdout} resolver=${resolver.stdout} skillFile=${visible.stdout || 'missing'}`,
    ['技能“生效”的 agent 级消费（进入某会话的 skills 快照）需真实模型回合，E1 未执行；本用例覆盖路径解析 + 文件可见性 + 上游 provider 读取 agents home 的代码位'],
    [])
}

/* ------------------------------------------------------------ 汇总 */

const summary = summaryOf(rows, {
  suite, env: {
    commit: gitHead(), imageTag: LANE.imageTag, imageId: LANE.imageId, container: LANE.container,
    base: LANE.base, dataRoot: LANE.dataRoot, startedAt,
  },
})
writeSummary(suite, summary)
console.log(`[BOOT] PASS=${summary.pass} FAIL=${summary.fail} SKIP=${summary.skip} NOTRUN=${summary.notrun}`)
console.log(`[BOOT] summary → artifacts/rc5/E1/BOOT/summary.json`)
process.exit(summary.fail === 0 ? 0 : 1)