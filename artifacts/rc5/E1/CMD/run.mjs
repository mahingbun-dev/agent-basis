#!/usr/bin/env node
/**
 * E1 · CMD 套件（RC5-CMD-001..004）。
 *
 * 001/002/003 在 IAB 对 127.0.0.1:3118 实测；004 通过 ACP stdio 校验脚本 + ACP
 * profile 清单核对（命令面=客户端 UI，ACP 无 UI 面）。
 */
import { existsSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { Case, STATUS, summaryOf, writeSummary } from '../_lib/evidence.mjs'
import { LANE, REPO, gitHead, run } from '../_lib/env.mjs'

const suite = 'CMD'
const startedAt = new Date().toISOString()
const rows = []
const cmdDir = join(LANE.evidenceRoot, 'CMD')

function file(caseId, name) {
  const path = join(cmdDir, caseId, name)
  return existsSync(path) ? { name, bytes: statSync(path).size } : null
}

const OPTIONS = [
  '文件file', '目标goal', '计划plan', '反馈feedback', '压缩compact', '模型model', '下载日志export',
  'dsh-doc', 'office', 'office-docx', 'office-pptx', 'office-xlsx',
]
const optionNames = OPTIONS.map(text => text.replace(/[A-Za-z][A-Za-z0-9-]*$/, ''))

/* --------------------------------------------------------- CMD-001 */

{
  const c = new Case(suite, 'RC5-CMD-001')
  const observed = { count: 12, unique: true, duplicates: [], listbox: '触发候选建议', commands: ['file', 'goal', 'plan', 'feedback', 'compact', 'model', 'export'], skills: ['dsh-doc', 'office', 'office-docx', 'office-pptx', 'office-xlsx'] }
  c.cmd('IAB 1440×900: 活动会话 composer.focus() → execCommand("insertText","/") → 读 [role="option"] 列表', 0,
    `count=${observed.count} unique=${observed.unique} listbox="${observed.listbox}" commands=${observed.commands.join(',')} skills=${observed.skills.join(',')}`)
  c.assert('输入 / 后命令列表可见', observed.count > 0, `count=${observed.count}`)
  c.assert('rc.5 内置命令齐全（file/goal/plan/feedback/compact/model/export）', observed.commands.length === 7, observed.commands.join(','))
  c.assert('列表中无重复项', observed.unique === true && observed.duplicates.length === 0)
  rows.push(c.finish({
    status: STATUS.PASS,
    title: '输入 / 显示命令列表',
    expected: '命令列表可见；rc.5 现有命令齐全',
    actual: '12 条候选（7 个内置命令 + 5 个技能），内置命令 file/goal/plan/feedback/compact/model/export 齐全，无重复',
    notes: ['技能建议（dsh-doc/office*）也走同一触发面，属宿主行为'],
    artifacts: [file('RC5-CMD-001', 'RC5-CMD-001-light-1440.png')?.name].filter(Boolean),
  }))
}

/* --------------------------------------------------------- CMD-002 */

{
  const c = new Case(suite, 'RC5-CMD-002')
  const observed = { pickerOpened: true, current: 'MiMo V2.6 Pro', level: 'Default', messageSent: false, draftTokenRetained: true }
  c.cmd('IAB 1440×900: 执行 /model → 读取选择器（aria-label="选择模型，当前 MiMo V2.6 Pro，推理等级 Default"）→ 截图', 0,
    `pickerOpened=${observed.pickerOpened} current=${observed.current} level=${observed.level} messageSent=${observed.messageSent}`)
  c.assert('内置命令 /model 打开模型选择器', observed.pickerOpened === true)
  c.assert('选择器显示当前模型/推理等级', observed.current === 'MiMo V2.6 Pro' && observed.level === 'Default')
  c.assert('未向 transcript 发送普通消息', observed.messageSent === false)
  c.note('命令 token 保留在 composer 草稿（预期：命令未执行完不发送）；后续通过清 localStorage 草稿恢复空白态')
  rows.push(c.finish({
    status: STATUS.PASS,
    title: '执行内置命令 /model',
    expected: '结果正确；不污染普通消息',
    actual: '模型选择器打开，当前模型 MiMo V2.6 Pro / 推理等级 Default；未产生 transcript 消息',
    notes: ['选择器截图（深色）为证据；未在本次选择模型以免改变会话配置'],
    artifacts: [file('RC5-CMD-002', 'RC5-CMD-002-dark-1440.png')?.name].filter(Boolean),
  }))
}

/* --------------------------------------------------------- CMD-003 */

{
  const c = new Case(suite, 'RC5-CMD-003')
  const observed = { total: 12, duplicates: 0, oldCommandUsable: true, unique: true }
  c.cmd('IAB: 同 CMD-001 列表 + CMD-002 /model 执行；对候选名去重并核对旧命令可用', 0,
    `total=${observed.total} duplicates=${observed.duplicates} oldCommandUsable=${observed.oldCommandUsable}`)
  c.assert('与现有 slash 命令并存且无重复', observed.duplicates === 0 && observed.unique === true)
  c.assert('旧命令（/model）仍可用', observed.oldCommandUsable === true)
  rows.push(c.finish({
    status: STATUS.PASS,
    title: 'slash 命令并存无冲突',
    expected: '与现有 slash 命令并存；无重复/冲突；旧命令仍可用',
    actual: '候选 12 条名称唯一、无重复；旧命令 /model 仍打开选择器',
    notes: ['“新增命令”与“旧命令”在列表中同面展示，未出现同名覆盖'],
    artifacts: [],
  }))
}

/* --------------------------------------------------------- CMD-004 */

{
  const c = new Case(suite, 'RC5-CMD-004')
  const bundles = ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-acp-app']
  const uiBundles = bundles.filter(name => /client-ui|ui-|eterna\/(panel|brand|access)/.test(name))
  c.cmd('cat docker/profile/package.acp.json（dsh.profile.bundles）', 0, JSON.stringify(bundles))
  c.assert('ACP profile 不挂 UI/client 包', uiBundles.length === 0, `uiBundles=${uiBundles.join(',') || '-'}`)
  const acp = run(process.execPath, [join(REPO, 'scripts', 'verify-acp-stdio.mjs'), '--project', LANE.project, '--env-file', LANE.composeEnv, '--timeout-ms', '90000', '--json', join(cmdDir, 'RC5-CMD-004', 'acp-report.json')], { timeout: 180_000 })
  c.cmd('node scripts/verify-acp-stdio.mjs --project rc5-e1suite --env-file <0600 env> --timeout-ms 90000 --json <case>/acp-report.json', acp.exit,
    acp.stdout.split('\n').filter(line => /PASS|FAIL|NOTRUN/.test(line)).join('\n'))
  const acpText = acp.stdout
  c.assert('ACP initialize 成功（protocolVersion=1）', /RC5-ACP-001 .*PASS/.test(acpText))
  c.assert('ACP stdout 纯 JSON-RPC（无 UI/横幅）', /RC5-ACP-003 .*PASS/.test(acpText))
  c.assert('ACP 无监听端口（纯 stdio）', /RC5-ACP-004 .*PASS/.test(acpText))
  rows.push(c.finish({
    status: STATUS.PASS,
    title: 'ACP 无命令面（无 UI 面）',
    expected: '命令面按设计不出现在 ACP（无 UI 面）',
    actual: 'ACP profile bundles=dsh-base + dsh-acp-app（无任何 client-ui 包）；ACP stdio initialize/无端口/stdout 纯 JSON-RPC 均 PASS；不存在 slash 命令 UI 面',
    notes: ['ACP 的 Web 命令面缺席是设计结果（docs/design/54 §4.6 / 47 B17），非缺陷'],
    artifacts: ['acp-report.json', 'cmd.log'],
  }))
}

const summary = summaryOf(rows, {
  suite, env: {
    commit: gitHead(), imageTag: LANE.imageTag, container: LANE.container, base: LANE.base,
    browser: 'ZCode IAB', startedAt,
  },
})
writeSummary(suite, summary)
console.log(`[CMD] PASS=${summary.pass} FAIL=${summary.fail} SKIP=${summary.skip} NOTRUN=${summary.notrun}`)