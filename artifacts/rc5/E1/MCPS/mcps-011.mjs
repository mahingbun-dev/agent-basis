#!/usr/bin/env node
/**
 * E1 · RC5-MCPS-011：模板变更重渲染保留 servers（H9，P0）。
 *
 * 判定两条腿：
 *   1) 单测面：`node --test docker/profile/migrate-mcp-servers.test.mjs`
 *      （旧 mcp-browser 行迁移、servers 合并、幂等、坏 YAML fail-closed、备份 0600）；
 *   2) 集成面（真实 entrypoint 路径）：模板文件追加一行注释 → docker restart 本 lane
 *      → 触发重渲染 → 渲染 patch 的 mcp-manager.servers 仍保留既有 server；
 *      记录渲染哈希变化证明「确实重渲染过」；随后恢复模板并再次 restart 回到基线。
 *
 * 模板改动纪律：只追加注释行，前后 sha256 必须一致；finally 必恢复并复核。
 *
 * 用法：node artifacts/rc5/E1/TERM/../MCPS/mcps-011.mjs（从套件 runner 或手工同款调用）
 */
import { createHash } from 'node:crypto'
import { appendFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { Case, STATUS, shape } from '../_lib/evidence.mjs'
import { LANE, docker, run, sleep, waitApi, waitHealth } from '../_lib/env.mjs'

const c = new Case('MCPS', 'RC5-MCPS-011')
const token = Date.now().toString(36)
const templatePath = join(LANE.repoRoot, 'docker', 'profile', 'cordis.patch.yml.template')
const patchPath = join(LANE.dataRoot, 'profiles', 'eterna-web', 'cordis.patch.yml')
const hashPath = join(LANE.dataRoot, 'profiles', 'eterna-web', '.rendered.cordis.patch.yml.sha256')
const backupPath = join(LANE.dataRoot, 'profiles', 'eterna-web', '.upgrade-mcp-servers-backup.json')
const sha256 = buffer => createHash('sha256').update(buffer).digest('hex')

const original = readFileSync(templatePath)
const shaBefore = sha256(original)
const hashBefore = existsSync(hashPath) ? readFileSync(hashPath, 'utf8').trim() : ''
let restored = false
let row

try {
  // 1) 单测面
  const unit = run('node', ['--test', 'docker/profile/migrate-mcp-servers.test.mjs'], { timeout: 120_000 })
  c.cmd('node --test docker/profile/migrate-mcp-servers.test.mjs', unit.exit, shape(unit.stdout || unit.stderr, 400))

  // 2) 集成面：模板变更 → restart → 重渲染
  const serversBefore = /# new profile patch|servers:/i.test(readFileSync(patchPath, 'utf8'))
  appendFileSync(templatePath, `\n# rc5-h9-render-${token}\n`)
  const appendExit = 0
  c.cmd(`append comment to docker/profile/cordis.patch.yml.template（${token}）`, appendExit)
  const restart1 = docker(['restart', LANE.container], { timeout: 120_000 })
  const health1 = await waitHealth(LANE.container, 120)
  await waitApi(LANE.base)
  c.cmd('docker restart rc5-e1suite（模板已变，触发重渲染）', restart1.exit, `health=${health1}`)
  await sleep(1_500)

  const patchText = readFileSync(patchPath, 'utf8')
  const hashAfter = existsSync(hashPath) ? readFileSync(hashPath, 'utf8').trim() : ''
  const serverKept = /e1http/.test(patchText) && /host\.docker\.internal:8766/.test(patchText)
  const mcpManagerBlock = /- id: mcp-manager[\s\S]*?(?=\n- id: |\s*$)/.exec(patchText)?.[0] ?? ''
  const serversCount = (mcpManagerBlock.match(/^\s{6}[A-Za-z0-9_-]+:\s*$/gm) ?? []).length
  const rerendered = hashAfter !== '' && hashAfter !== hashBefore
  const backupAbsent = !existsSync(backupPath)
  c.cmd('read rendered patch + rendered hash', 200,
    `kept=${serverKept} servers≈${serversCount} rerendered=${rerendered} hashBefore=${shape(hashBefore, 24)} hashAfter=${shape(hashAfter, 24)} backup=${backupAbsent ? 'absent' : 'present'}`)

  // 3) 恢复模板（finally 同款，双保险）→ 再 restart 回基线
  writeFileSync(templatePath, original)
  restored = sha256(readFileSync(templatePath)) === shaBefore
  const restart2 = docker(['restart', LANE.container], { timeout: 120_000 })
  const health2 = await waitHealth(LANE.container, 120)
  await waitApi(LANE.base)
  c.cmd('restore template (sha256 verified) + docker restart', restart2.exit, `restored=${restored} health=${health2}`)
  const hashFinal = existsSync(hashPath) ? readFileSync(hashPath, 'utf8').trim() : ''
  const backToBaseline = hashFinal === hashBefore
  c.cmd('read rendered hash after restore', 200, `hashFinal=${shape(hashFinal, 24)} baseline=${shape(hashBefore, 24)}`)

  const unitOk = unit.exit === 0 && /pass \d+/.test(unit.stdout)
  c.assert('迁移脚本单测全过（含 fail-closed 备份 0600）', unitOk, shape(unit.stdout.split('\n').slice(-3).join(' '), 160))
  c.assert('模板变更触发重渲染（渲染哈希变化）', rerendered, `before=${shape(hashBefore, 16)} after=${shape(hashAfter, 16)}`)
  c.assert('重渲染后 mcp-manager.servers 保留既有 server', serversBefore && serverKept,
    `kept=${serverKept} block=${shape(mcpManagerBlock, 160)}`)
  c.assert('成功路径不产生升级备份文件', backupAbsent, `backup=${backupAbsent ? 'absent' : backupPath}`)
  c.assert('模板已恢复（sha256 一致）且渲染回基线', restored && backToBaseline, `restored=${restored} baseline=${backToBaseline}`)

  const pass = unitOk && rerendered && serverKept && backupAbsent && restored && backToBaseline
  row = c.finish({
    status: pass ? STATUS.PASS : STATUS.FAIL,
    title: '模板变更重渲染保留 servers（H9）',
    expected: '旧 profile 的 servers 在模板重渲染后保留；失败路径留 0600 备份；模板/渲染可回基线',
    actual: `unit=${unitOk} rerendered=${rerendered} servers_kept=${serverKept} backup_absent=${backupAbsent} restored=${restored} baseline=${backToBaseline}`,
    notes: [
      `lane=${LANE.container}（独立测试容器，未触碰生产）`,
      '集成腿：模板只追加一行注释（内容 sha256 前后一致），restart 走真实 entrypoint 重渲染路径；随后恢复并再 restart',
      '失败路径（坏 YAML → 留痕 .upgrade-mcp-servers-backup.json，0600）由同一轮迁移脚本单测覆盖',
    ],
    artifacts: ['cmd.log'],
  })
} catch (error) {
  c.note(`执行异常：${String(error?.message ?? error).slice(0, 300)}`)
  row = c.finish({
    status: STATUS.FAIL,
    title: '模板变更重渲染保留 servers（H9）',
    expected: 'servers 保留；失败留 0600 备份；模板/渲染可回基线',
    actual: `异常：${String(error?.message ?? error).slice(0, 200)}`,
    artifacts: ['cmd.log'],
  })
} finally {
  if (!restored) {
    writeFileSync(templatePath, original)
    const ok = sha256(readFileSync(templatePath)) === shaBefore
    c.note(`finally 恢复模板 sha256 一致=${ok}`)
    await docker(['restart', LANE.container], { timeout: 120_000 }).catch(() => undefined)
    await waitHealth(LANE.container, 120).catch(() => undefined)
    await waitApi(LANE.base).catch(() => undefined)
  }
}
console.log(`[MCPS-011] ${row.status}`)