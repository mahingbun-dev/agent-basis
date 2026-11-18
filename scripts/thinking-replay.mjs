#!/usr/bin/env node
/**
 * 思考强度判档回放与门禁(2026-11-18 V2,本地工具):
 * 同一份带 targetEffort 的语料上,对比 V1(仅单条消息)与 V2(叠加会话上下文信号)
 * 的取档结果,输出相邻档命中率 / 一致率 / 极端误配数 / 混淆矩阵。
 *
 * 用法:
 *   node scripts/thinking-replay.mjs --corpus corpus/thinking.jsonl [--efforts minimal,low,medium,high,xhigh] [--gate]
 *
 * 门禁(用户拍板):
 *   相邻档命中率 ≥ 0.90 且 一致率 ≥ 0.60 且 极端误配 = 0(V2 对人工目标档)
 *   `--gate` 时未达标退出码 1;默认只报告不判。
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { pickEffort, scoreMessage } from '../packages/access/src/thinking-score.ts'

const GATE = { adjacent: 0.9, exact: 0.6, extreme: 0 }

function parseArgs(argv) {
  const args = { corpus: undefined, efforts: 'minimal,low,medium,high,xhigh', gate: false }
  for (let i = 0; i < argv.length; i++) {
    const key = argv[i]
    if (key === '--corpus') { args.corpus = argv[i + 1]; i++ }
    else if (key === '--efforts') { args.efforts = argv[i + 1]; i++ }
    else if (key === '--gate') args.gate = true
    else if (key === '--help' || key === '-h') args.help = true
  }
  return args
}

function loadCorpus(path) {
  const items = []
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    if (line.trim() === '') continue
    items.push(JSON.parse(line))
  }
  return items
}

function summarize(preds, targets, efforts) {
  const index = new Map(efforts.map((id, i) => [id, i]))
  let exact = 0
  let adjacent = 0
  let extreme = 0
  const confusion = new Map()
  for (let i = 0; i < preds.length; i++) {
    const p = index.get(preds[i])
    const t = index.get(targets[i])
    const key = `${targets[i]}→${preds[i]}`
    confusion.set(key, (confusion.get(key) ?? 0) + 1)
    if (p === undefined || t === undefined) continue
    if (p === t) exact += 1
    if (Math.abs(p - t) <= 1) adjacent += 1
    if (Math.abs(p - t) >= efforts.length - 1) extreme += 1
  }
  const n = preds.length === 0 ? 1 : preds.length
  return { n: preds.length, exact: exact / n, adjacent: adjacent / n, extreme, confusion }
}

function main() {
  const args = parseArgs(process.argv.slice(2))
  if (args.help || args.corpus === undefined) {
    console.log('用法: node scripts/thinking-replay.mjs --corpus <corpus.jsonl> [--efforts a,b,c] [--gate]')
    process.exit(args.help ? 0 : 2)
  }
  const efforts = args.efforts.split(',').map(s => s.trim()).filter(s => s !== '')
  const items = loadCorpus(resolve(args.corpus))
  const labeled = items.filter(item => typeof item.targetEffort === 'string' && item.targetEffort !== '')
  if (labeled.length === 0) {
    console.error('语料中没有任何 targetEffort 标注;先按 docs/dev/thinking-auto.md 标注再回放')
    process.exit(2)
  }
  const missing = labeled.filter(item => !efforts.includes(item.targetEffort))
  if (missing.length > 0) {
    console.error(`有 ${missing.length} 条 targetEffort 不在 --efforts(${efforts.join(',')}) 内,例: ${missing[0].id}`)
    process.exit(2)
  }

  const targets = labeled.map(item => item.targetEffort)
  // 语料来自 JSON:Infinity 已序列化为 null/缺失 ⇒ 统一按「无间隔」处理(不触发追问信号)
  const signalsOf = item => {
    const signals = item.signals
    if (signals === undefined || signals === null) return undefined
    const gap = signals.followUpGapMinutes
    return {
      ...signals,
      bias: Number.isFinite(signals.bias) ? signals.bias : 0,
      followUpGapMinutes: typeof gap === 'number' && Number.isFinite(gap) ? gap : Number.POSITIVE_INFINITY,
    }
  }
  const v1 = labeled.map(item => pickEffort(scoreMessage({ text: item.text, hasAttachment: false }), efforts.map(id => ({ id })))?.id)
  const v2 = labeled.map(item => pickEffort(
    scoreMessage({ text: item.text, hasAttachment: false, signals: signalsOf(item) }),
    efforts.map(id => ({ id })),
  )?.id)

  const resultV1 = summarize(v1, targets, efforts)
  const resultV2 = summarize(v2, targets, efforts)
  const pct = value => `${(value * 100).toFixed(1)}%`

  console.log(`语料 ${labeled.length} 条,档位集 ${efforts.join('/')}`)
  console.log('')
  console.log('           相邻档   一致率   极端误配')
  console.log(`V1         ${pct(resultV1.adjacent).padStart(6)}  ${pct(resultV1.exact).padStart(6)}  ${String(resultV1.extreme).padStart(8)}`)
  console.log(`V2         ${pct(resultV2.adjacent).padStart(6)}  ${pct(resultV2.exact).padStart(6)}  ${String(resultV2.extreme).padStart(8)}`)
  console.log('')
  console.log('V2 混淆(目标→预测,仅非对角):')
  for (const [key, count] of [...resultV2.confusion.entries()].sort((a, b) => b[1] - a[1])) {
    const [target, pred] = key.split('→')
    if (target !== pred) console.log(`  ${key}  ×${count}`)
  }

  if (args.gate) {
    const failed = resultV2.adjacent < GATE.adjacent || resultV2.exact < GATE.exact || resultV2.extreme > GATE.extreme
    console.log('')
    console.log(failed
      ? `门禁 FAIL(要求 相邻≥${pct(GATE.adjacent)}、一致≥${pct(GATE.exact)}、极端=0)`
      : '门禁 PASS')
    process.exit(failed ? 1 : 0)
  }
}

main()