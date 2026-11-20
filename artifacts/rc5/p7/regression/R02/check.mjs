#!/usr/bin/env node
/**
 * R02 行为项补证（54 §9 R02 / 49 §6-5）：六件逐项留痕。
 *
 * 口径：R02 是「rc.5 行为项不被误用」的静态契约面，证据 = 已安装 rc.5 声明源
 * 的精确签名 + 本仓消费位 + 全工作区 typecheck（verify EXIT=0 日志）。
 * LoggerLevel 已有运行时真行为（API-009），此处只引用不重复。
 *
 * 产物：artifacts/rc5/p7/regression/R02/{cmd.log,result.md}
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO = join(HERE, '..', '..', '..', '..', '..')
const OUT = join(REPO, 'artifacts', 'rc5', 'p7', 'regression', 'R02')
const STORE = join(REPO, 'node_modules', '.pnpm')
mkdirSync(OUT, { recursive: true })

const cmds = []
const cmd = (line, ok, detail = '') => {
  cmds.push({ line, ok: ok === true, detail: String(detail).slice(0, 500) })
  console.log(`${ok === true ? 'PASS' : 'FAIL'}  ${line}  ${detail}`)
}

/** pnpm store 中某 dsh 包的 src 根（rc.5 安装位；唯一版本）。 */
function pkgDir(name) {
  const entry = readdirSync(STORE).find(item => item.startsWith(`@deepseek-ai+${name}@0.2.2-rc.5`))
  if (entry === undefined) return undefined
  const dir = join(STORE, entry, 'node_modules', '@deepseek-ai', name)
  return existsSync(dir) ? dir : undefined
}

function grep(file, pattern) {
  const text = readFileSync(file, 'utf8')
  const match = pattern.exec(text)
  if (match === null) return undefined
  const line = text.slice(0, match.index).split('\n').length
  return { line, snippet: text.split('\n')[line - 1].trim() }
}

function repoFile(path) {
  const file = join(REPO, path)
  return existsSync(file) ? file : undefined
}

/* 1) LoggerLevel：运行时真行为已有 API-009（PASS），只核对证据档。 */
{
  const file = repoFile('artifacts/rc5/API/RC5-API-009/result.md')
  const text = file === undefined ? '' : readFileSync(file, 'utf8')
  cmd('LoggerLevel 数值语义 → API-009 证据档存在且 PASS', file !== undefined && /\*\*PASS|结论.*PASS/.test(text),
    file === undefined ? 'missing' : 'artifacts/rc5/API/RC5-API-009/result.md')
}

/* 2) 投影帧 {seq, changes[]}（ProjectionEventChangeListener 参数序）。 */
{
  const dir = pkgDir('dsh-session-projection')
  const file = dir === undefined ? undefined : join(dir, 'src', 'index.ts')
  const hit = file === undefined ? undefined : grep(file, /export type ProjectionEventChangeListener = \(\n\s*session: Session,\n\s*changes: readonly[^\n]*\n\s*seq: SessionSeq,\n\)/)
  cmd('投影帧：changes 数组 + seq 的参数序（rc.5 声明源）', hit !== undefined,
    file === undefined ? 'dsh-session-projection 未安装' : `${file.slice(REPO.length + 1)}:${hit?.line ?? '-'}`)
}

/* 3) GenerateOptions 泛型 <Purpose extends string>。 */
{
  const dir = pkgDir('dsh-llm')
  const file = dir === undefined ? undefined : join(dir, 'src', 'types.ts')
  const hit = file === undefined ? undefined : grep(file, /export interface GenerateOptions<Purpose extends string = LlmRequestPurpose>/)
  cmd('GenerateOptions 泛型 Purpose extends string（rc.5 声明源）', hit !== undefined,
    file === undefined ? 'dsh-llm 未安装' : `${file.slice(REPO.length + 1)}:${hit?.line ?? '-'}`)
  /* 本仓消费位：compaction evals 网关按 GenerateOptions 装配、测试捕获真实调用。 */
  const use = repoFile('packages/compaction/evals/gateway.ts')
  const useHit = use === undefined ? undefined : grep(use, /import type \{ GenerateOptions[^\n]*\} from '@deepseek-ai\/dsh-llm'/)
  cmd('本仓消费位按 rc.5 GenerateOptions 编译', useHit !== undefined, useHit === undefined ? 'missing' : `packages/compaction/evals/gateway.ts:${useHit.line}`)
}

/* 4) ToolGuardDenial（内核 guard 结果形状；本仓走 pre-execute，不直用该类型）。 */
{
  const dir = pkgDir('dsh-tools')
  const file = dir === undefined ? undefined : join(dir, 'src', 'contracts.ts')
  const guard = file === undefined ? undefined : grep(file, /export type ToolGuard = \(execution: Readonly<ToolExecution>\) => string \| ToolGuardDenial \| undefined/)
  const denial = file === undefined ? undefined : grep(file, /export interface ToolGuardDenial \{/)
  cmd('ToolGuardDenial 类型 + ToolGuard 返回位（rc.5 声明源）', guard !== undefined && denial !== undefined,
    file === undefined ? 'dsh-tools 未安装' : `${file.slice(REPO.length + 1)}:${denial?.line ?? '-'}`)
  const gov = repoFile('packages/glue/src/plugins/governance-plugin.ts')
  const govHit = gov === undefined ? undefined : grep(gov, /ctx\.on\('tools\/pre-execute'/)
  cmd('本仓治理走 tools/pre-execute（deny 不可回翻由内核保证）', govHit !== undefined, govHit === undefined ? 'missing' : `packages/glue/src/plugins/governance-plugin.ts:${govHit.line}`)
}

/* 5) plugin-manager 类型：PluginTabProps.update 必填 + PluginTabUpdate。 */
{
  const dir = pkgDir('dsh-client-ui-plugin-manager')
  const file = dir === undefined ? undefined : join(dir, 'src', 'client', 'slot-contract.ts')
  const props = file === undefined ? undefined : grep(file, /readonly update: \(target: PluginTabUpdate\) => void/)
  const update = file === undefined ? undefined : grep(file, /export interface PluginTabUpdate \{/)
  cmd('PluginTabProps.update 必填 + PluginTabUpdate（rc.5 声明源）', props !== undefined && update !== undefined,
    file === undefined ? 'dsh-client-ui-plugin-manager 未安装' : `${file.slice(REPO.length + 1)}:${props?.line ?? '-'}`)
  const mirror = repoFile('packages/access/src/client/plugin-manager-contract.d.ts')
  const mirrorHit = mirror === undefined ? undefined : grep(mirror, /readonly update: \(target: PluginTabUpdate\) => void/)
  const consumer = repoFile('packages/access/src/client/plugins-manager.tsx')
  const consumerHit = consumer === undefined ? undefined : grep(consumer, /import type \{ PluginTabProps, PluginTabUpdate \}/)
  cmd('本仓镜面契约 + 插件页消费位', mirrorHit !== undefined && consumerHit !== undefined,
    `contract=${mirrorHit?.line ?? '-'} consumer=${consumerHit?.line ?? '-'}`)
}

/* 6) 全工作区 typecheck：verify EXIT=0（合并 main 后一次）。 */
{
  const log = repoFile('artifacts/rc5/p7/verify-postmerge.log')
  const text = log === undefined ? '' : readFileSync(log, 'utf8').trimEnd().split('\n').slice(-1)[0]
  cmd('pnpm -w run verify 全工作区 EXIT=0（post-merge 日志）', text === 'EXIT=0', log === undefined ? 'missing' : text)
}

const pass = cmds.every(item => item.ok)
writeFileSync(join(OUT, 'cmd.log'), cmds.map(item => `${item.ok ? 'PASS' : 'FAIL'}  ${item.line}\n${item.detail}\n`).join('\n') + `\nRESULT=${pass ? 'PASS' : 'FAIL'}\n`)
writeFileSync(join(OUT, 'result.md'), [
  '# RC5 R02 · 上游行为项六件逐项补证（54 §9 R02）',
  '',
  `- 环境：worktree \`${REPO}\`；依赖 = pnpm store 内 \`@deepseek-ai/*@0.2.2-rc.5\` 安装源（与镜像同版本）`,
  '- 口径：静态契约面（已安装声明源 + 本仓消费位 + 全工作区 typecheck）；LoggerLevel 另有 API-009 运行时真行为',
  '',
  '## 逐项',
  '',
  ...cmds.map(item => `- ${item.ok ? 'PASS' : 'FAIL'} · ${item.line}${item.detail === '' ? '' : `（${item.detail}）`}`),
  '',
  '## 结论',
  '',
  `**${pass ? 'PASS' : 'FAIL'}**。六件：LoggerLevel（API-009 运行时）、投影帧参数序、\`GenerateOptions\` 泛型、\`ToolGuardDenial\`、plugin-manager \`PluginTabProps.update\`、全工作区编译门禁。`,
  '',
  '## 边界',
  '',
  '- 投影帧监听器本仓不直接订阅（客户端/宿主消费）；本项钉的是 rc.5 声明源的参数序不被误接。',
  '- \`ToolGuardDenial\` 本仓不直用（治理走 \`tools/pre-execute\`，内核单调 guard 保证 deny 不可回翻）；本项钉类型形状与消费路线。',
].join('\n'))
process.exit(pass ? 0 : 1)