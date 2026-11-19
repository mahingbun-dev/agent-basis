#!/usr/bin/env node
/**
 * 思考强度回放语料抽样(2026-11-18 V2,本地工具):
 * 从会话耐久日志(JSONL,`session-persistence-jsonl` 产物或脱敏副本)抽出真人
 * 消息样本,预先算好会话上下文信号,产出可人工标注的 corpus.jsonl。
 *
 * 用法:
 *   node scripts/thinking-sample.mjs --src <会话日志目录> --out corpus/thinking.jsonl [--limit 300]
 *
 * 输出每行(JSONL):
 *   { id, at, text, signals, targetEffort: null }
 * - `signals` 已按「该消息入箱前」的窗口(≤200 事件)算好,回放时直接喂 scoreMessage;
 * - `text` 经轻量 PII 脱敏(邮箱/手机号/身份证号),语料默认落在未跟踪目录
 *   (corpus/ 已 gitignore;数据不出内网,不入库/不入镜像)。
 * - 标注只改 `targetEffort`(模型声明的档位 id),其余字段不要动。
 */
import { readdirSync, statSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { deriveSessionSignals } from '../packages/access/src/thinking-context.ts'

const WINDOW_EVENTS = 200

function parseArgs(argv) {
  const args = { src: undefined, out: undefined, limit: 300 }
  for (let i = 0; i < argv.length; i++) {
    const key = argv[i]
    const value = argv[i + 1]
    if (key === '--src') { args.src = value; i++ }
    else if (key === '--out') { args.out = value; i++ }
    else if (key === '--limit') { args.limit = Number(value); i++ }
    else if (key === '--help' || key === '-h') { args.help = true }
  }
  return args
}

function collectJsonl(root) {
  const files = []
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name)
      if (entry.isDirectory()) walk(path)
      else if (entry.isFile() && entry.name.endsWith('.jsonl')) files.push(path)
    }
  }
  walk(root)
  return files
}

function redact(text) {
  return text
    .replaceAll(/[\w.+-]+@[\w-]+\.[\w.-]+/gu, '<email>')
    .replaceAll(/\b1[3-9]\d{9}\b/gu, '<phone>')
    .replaceAll(/\b\d{17}[\dXx]\b/gu, '<id>')
}

function textOf(message) {
  if (typeof message?.content === 'string') return message.content
  if (!Array.isArray(message?.content)) return ''
  return message.content
    .filter(block => block?.type === 'text' && typeof block?.text === 'string')
    .map(block => block.text)
    .join('\n')
}

function bucketOf(item) {
  if (/```/u.test(item.text)) return 'code'
  if (item.text.length < 40) return 'short'
  if (item.text.length > 500) return 'long'
  return 'medium'
}

function main() {
  const args = parseArgs(process.argv.slice(2))
  if (args.help || args.src === undefined || args.out === undefined) {
    console.log('用法: node scripts/thinking-sample.mjs --src <会话日志目录> --out <corpus.jsonl> [--limit 300]')
    process.exit(args.help ? 0 : 2)
  }
  const src = resolve(args.src)
  const files = collectJsonl(src)
  if (files.length === 0) {
    console.error(`未在 ${src} 找到 *.jsonl（会话日志目录需先确认: 见 plans/2026-11-18-会话思考强度判档迭代计划.md §4）`)
    process.exit(2)
  }

  const items = []
  for (const file of files) {
    const lines = readFileSync(file, 'utf8').split('\n').filter(line => line.trim() !== '')
    const events = []
    for (const line of lines) {
      try {
        const parsed = JSON.parse(line)
        if (typeof parsed?.type === 'string') events.push(parsed)
      } catch { /* 非事件行(头/尾)跳过 */ }
    }
    for (let i = 0; i < events.length; i++) {
      const event = events[i]
      if (event.type !== 'user/message') continue
      if (event.data?.source?.kind !== 'user') continue
      const text = textOf(event.data)
      if (text.trim() === '') continue
      const atMs = Date.parse(event.at ?? '') || Date.now()
      const window = events.slice(Math.max(0, i - WINDOW_EVENTS), i)
      const signals = deriveSessionSignals(window, atMs, text)
      items.push({
        id: `${file.split('/').pop()}:${i}`,
        at: event.at ?? new Date(atMs).toISOString(),
        text: redact(text),
        // Infinity 无法 JSON 序列化(会变 null,回放侧误当 0 分钟):压成有限大值
        signals: {
          ...signals,
          bias: 0,
          followUpGapMinutes: Number.isFinite(signals.followUpGapMinutes)
            ? signals.followUpGapMinutes
            : 1e9,
        },
        targetEffort: null,
      })
    }
  }

  // 分层配额:code 25% / short 20% / medium 40% / long 15%(不足时由其余层补齐)
  const ratio = { code: 0.25, short: 0.2, medium: 0.4, long: 0.15 }
  const buckets = { code: [], short: [], medium: [], long: [] }
  for (const item of items) buckets[bucketOf(item)].push(item)
  const picked = []
  for (const [name, share] of Object.entries(ratio)) {
    picked.push(...buckets[name].slice(0, Math.ceil(args.limit * share)))
  }
  if (picked.length < args.limit) {
    const taken = new Set(picked.map(item => item.id))
    for (const item of items) {
      if (picked.length >= args.limit) break
      if (!taken.has(item.id)) { picked.push(item); taken.add(item.id) }
    }
  }

  mkdirSync(dirname(resolve(args.out)), { recursive: true })
  writeFileSync(resolve(args.out), `${picked.map(item => JSON.stringify(item)).join('\n')}\n`, 'utf8')
  const counts = Object.fromEntries(Object.entries(buckets).map(([k, v]) => [k, v.length]))
  console.log(`扫描 ${files.length} 个会话文件,真人消息 ${items.length} 条(${JSON.stringify(counts)})`)
  console.log(`抽样 ${picked.length} 条 → ${resolve(args.out)}`)
  console.log('下一步:逐行填 targetEffort(模型声明档位 id),再跑 scripts/thinking-replay.mjs --gate')
}

main()