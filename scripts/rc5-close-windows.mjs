#!/usr/bin/env node
/**
 * 24h 窗口收口（TERM-013 / DATA-009）——把「明早要做的核对」压成一条命令。
 *
 * 只做三件事：
 *   1) 读两份摘要，校验窗口是否已满、verdict 是否 PASS/FAIL；
 *   2) 窗口已满时调用 `scripts/rc5-acceptance-matrix.mjs --write`，并要求
 *      rows=164、PASS=164、FAIL=0、MISSING=0（否则 EXIT=1，不写结果文件）；
 *   3) 通过后写 `artifacts/rc5/p6b/window-close.json`（判定快照，供 PR/签字引用）。
 *
 * 纪律：窗口未满一律 EXIT=0 并打印 NOTRUN，不改矩阵、不写结果文件——
 * 时间不能压缩，24h 判据必须等真实 elapsed（51 TERM-013/DATA-009、54 §3.5）。
 *
 * 用法：
 *   node scripts/rc5-close-windows.mjs            # 真实摘要
 *   node scripts/rc5-close-windows.mjs --dry      # 只打印，不跑矩阵写回
 *   演练：RC5_SOAK_SUMMARY / RC5_SCALE_SUMMARY 指向 /tmp 合成摘要 + --dry
 */
import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const RC5 = join(ROOT, 'artifacts', 'rc5')
const SOAK_SUMMARY = process.env.RC5_SOAK_SUMMARY ?? join(RC5, 'p6b', 'soak', 'final-image2', 'summary-24h-final2.json')
const SCALE_SUMMARY = process.env.RC5_SCALE_SUMMARY ?? join(RC5, 'E2', 'DATA', 'scale', 'summary.json')
const OUT = join(RC5, 'p6b', 'window-close.json')
const DRY = process.argv.includes('--dry')
const OVERRIDDEN = process.env.RC5_SOAK_SUMMARY !== undefined || process.env.RC5_SCALE_SUMMARY !== undefined
if (OVERRIDDEN && !DRY) {
  console.log('REFUSE=环境覆盖摘要只允许演练（必须配 --dry），避免把合成 verdict 写进真实矩阵')
  process.exit(2)
}

const readJson = path => (existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : undefined)
const soak = readJson(SOAK_SUMMARY)
const scale = readJson(SCALE_SUMMARY)

const report = {
  checkedAt: new Date().toISOString(),
  soak: { path: SOAK_SUMMARY, exists: soak !== undefined, complete: soak?.window?.complete === true, elapsedSeconds: soak?.elapsedSeconds, term: soak?.term?.verdict, data: soak?.data?.verdict },
  scale: { path: SCALE_SUMMARY, exists: scale !== undefined, complete: scale?.windowComplete === true, elapsedSeconds: scale?.elapsedSeconds, verdict: scale?.verdict },
}

const raw = JSON.stringify(report, null, 2)
console.log(raw)

if (report.soak.complete !== true || report.scale.complete !== true) {
  console.log('STATUS=NOTRUN（窗口未满：不得判绿、不改矩阵、不写结果文件）')
  process.exit(0)
}

const failed = ['FAIL'].includes(report.soak.term) || ['FAIL'].includes(report.soak.data) || ['FAIL'].includes(report.scale.verdict)
if (failed) {
  console.log('STATUS=FAIL（摘要 verdict 含 FAIL：保留 MISSING/FAIL，按 runbook §3 处置）')
  process.exit(1)
}

if (DRY) {
  console.log('STATUS=READY（--dry：未调用矩阵写回）')
  process.exit(0)
}

const matrix = spawnSync(process.execPath, [join(ROOT, 'scripts', 'rc5-acceptance-matrix.mjs'), '--write'], { cwd: ROOT, encoding: 'utf8' })
const output = `${matrix.stdout ?? ''}${matrix.stderr ?? ''}`
console.log(output.trim().split('\n').slice(-4).join('\n'))
const counts = /rows=(\d+) PASS=(\d+) FAIL=(\d+) MISSING=(\d+)/.exec(output)
if (matrix.status !== 0 || counts === null) {
  console.log(`STATUS=ERROR（矩阵脚本 EXIT=${matrix.status}）`)
  process.exit(1)
}
const [, rows, pass, fail, missing] = counts.map(Number)
report.matrix = { rows, pass, fail, missing }
if (!(rows === 164 && pass === 164 && fail === 0 && missing === 0)) {
  console.log(`STATUS=BLOCKED（矩阵 ${rows} 行：PASS=${pass} FAIL=${fail} MISSING=${missing}，非 164/0/0）`)
  process.exit(1)
}
report.status = 'READY'
report.head = spawnSync('git', ['-C', ROOT, 'rev-parse', '--short', 'HEAD'], { encoding: 'utf8' }).stdout.trim()
writeFileSync(OUT, `${JSON.stringify(report, null, 2)}\n`)
console.log(`STATUS=READY（164/164，P0 全绿；判定快照 ${OUT}）`)
console.log('NEXT=P7 push/PR/合并/部署（需用户显式确认）')