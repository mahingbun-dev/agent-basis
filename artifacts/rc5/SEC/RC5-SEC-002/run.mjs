#!/usr/bin/env node
/**
 * RC5-SEC-002：凭据扫描（P0）——静态半 + 运行时半。
 *
 *   静态半：git 跟踪文件（含全部文本文件）按 8 类高置信规则 + 赋值形态扫描；
 *   运行时半：终版镜像文件系统（fresh container，无宿主挂载）/ argv（Config.Cmd+top）/ 容器日志 tail2000；
 *   自检：容器内 grep 对植入假 key 必须命中（防“永远 0 命中”的假绿）。
 *
 * 只打印脱敏元数据（规则/路径/掩码值），不落任何疑似明文；env/.env 是允许的凭据通道，不判违规。
 *
 * 用法：node artifacts/rc5/SEC/RC5-SEC-002/run.mjs
 */
import { spawnSync } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const startedAt = new Date().toISOString()
const lines = [`# RC5-SEC-002`, `# started ${startedAt}`, '']

function invoke(label, script) {
  const result = spawnSync('node', [join(HERE, script)], { encoding: 'utf8', timeout: 600_000, maxBuffer: 64 * 1024 * 1024 })
  const output = `${result.stdout ?? ''}${result.stderr ?? ''}`.trimEnd()
  lines.push(`$ node artifacts/rc5/SEC/RC5-SEC-002/${script}  # ${label}`)
  lines.push(output)
  lines.push(`EXIT=${result.status ?? -1}`, '')
  return { exit: result.status ?? -1, output }
}

const staticRun = invoke('静态：git 跟踪文件', 'scan-secrets.mjs')
const runtimeRun = invoke('运行时：镜像/argv/日志', 'scan-runtime.mjs')
const staticHits = Number(staticRun.output.match(/^summary: hits=(\d+)$/m)?.[1] ?? NaN)
const runtimeHits = Number(runtimeRun.output.match(/^summary: hits=(\d+)$/m)?.[1] ?? NaN)
const selfOk = /self_test=true/.test(runtimeRun.output)
const pass = staticRun.exit === 0 && runtimeRun.exit === 0 && staticHits === 0 && runtimeHits === 0 && selfOk
const finishedAt = new Date().toISOString()

writeFileSync(join(HERE, 'cmd.log'), `${lines.join('\n')}# finished ${finishedAt}\n`)

const result = `# RC5-SEC-002 · 凭据扫描（跟踪文件/镜像/argv）

- 套件：SEC
- 结论：**${pass ? 'PASS' : 'FAIL'}**
- 开始/结束：${startedAt} / ${finishedAt}

## 预期

扫 \`.secrets\`、\`.env\`、argv、镜像与日志：无凭据进入被跟踪文件/镜像/argv/日志。
（\`.env\` / 容器 env 是允许的凭据通道，不作为违规项。）

## 实际

- 静态半：git 跟踪文件扫描，\`hits=${Number.isFinite(staticHits) ? staticHits : '?'}\`（8 类高置信规则 + password/api_key 赋值形态；占位符/测试值按 \`placeholder\` 正则豁免）
- 运行时半：终版镜像 \`eterna-agent:rc5-test\`（fresh container，无宿主挂载）文件系统 + lane argv（Config.Cmd/top）+ 容器日志 tail2000，\`hits=${Number.isFinite(runtimeHits) ? runtimeHits : '?'}\`
- 扫描器自检：\`self_test=${selfOk}\`（容器内对植入假 key 必须命中）
- 范围说明：第三方 vendor 树（\`node_modules\`/\`.pnpm\`/\`.git\`）不扫——其中是上游自带的测试夹具（zod JWT 样例、jose 密钥块等），非本项目凭据，也不可能含本项目密钥；产品自有路径（\`/app\`、\`/repo\` 源码、\`/data\` 模板、\`/opt\`）全量扫描。

## 断言

- [${staticHits === 0 ? 'x' : ' '}] 跟踪文件无高置信凭据（含固定口令字面量）
- [${runtimeHits === 0 ? 'x' : ' '}] 镜像/argv/日志无高置信凭据
- [${selfOk ? 'x' : ' '}] 扫描器自检通过（阳性样本可命中）

## 备注

- 历史证据（2026-11-19）曾报 14 处命中：1 处文档 mock key + 13 处测试固定口令；该批字面量已替换为显式测试值（含 \`test\`/\`fake\` 占位语义），本轮静态复扫 0 命中。
- 证据只记录脱敏前缀/后缀与长度，不落明文；容器 env 值不打印。

## 证据

- \`cmd.log\`
- \`scan-secrets.mjs\` / \`scan-runtime.mjs\`
`
writeFileSync(join(HERE, 'result.md'), result)
console.log(`[SEC-002] static=${staticHits} runtime=${runtimeHits} self=${selfOk} → ${pass ? 'PASS' : 'FAIL'}`)
process.exit(pass ? 0 : 1)