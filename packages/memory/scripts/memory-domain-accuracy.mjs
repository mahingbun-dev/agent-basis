#!/usr/bin/env node
/**
 * 域打标准确率离线比对(T13,19 号 §5-T13/§9-6;五项指标中唯一需要人工环节的
 * 一项):人工标注样本 × 审计账本 domain-resolve 行 → 准确率。
 *
 * 口径:标注的期望域(expected)与该会话解析定格的 domainKey 完全一致记命中;
 * 期望「无域」记 null。每会话取最后一条 domain-resolve 行(定格后不复发,取末位
 * 属防御)。账本有解析行但无标注的会话计入「未标注」,不计入分母。
 *
 * 用法:node scripts/memory-domain-accuracy.mjs [账本路径] [标注文件]
 * - 账本缺省 <cwd>/.eterna/memory-audit.jsonl(与 memory.sqlite3 同目录约定);
 * - 标注缺省 <cwd>/.eterna/domain-labels.jsonl,每行
 *   {"sessionId":"sess_...","expected":"deploy"}(期望无域用 null);
 * - 标注文件人工维护(19 号 §5-T10:≥30 会话样本,归并+注册准确率 ≥80% 为
 *   M-M3 验收线);样本未齐时脚本照常输出并提示,exit 0(度量不设门禁位)。
 */
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const auditPath = process.argv[2] ?? join(process.cwd(), '.eterna', 'memory-audit.jsonl')
const labelsPath = process.argv[3] ?? join(process.cwd(), '.eterna', 'domain-labels.jsonl')

if (!existsSync(auditPath)) {
  console.error(`[memory] 审计账本不存在:${auditPath}(请在 workspace 目录内运行,或显式传入路径)`)
  process.exit(1)
}
if (!existsSync(labelsPath)) {
  console.error(`[memory] 标注文件不存在:${labelsPath}\n每行 {"sessionId":"...","expected":"deploy"}(期望无域用 null);人工标注 ≥30 会话后重跑(19 号 §5-T10 验收线)。`)
  process.exit(1)
}

// 账本侧:每会话最后一条 domain-resolve(坏行忽略,与账本 readAll 同口径)
const resolves = new Map()
for (const line of readFileSync(auditPath, 'utf8').split('\n')) {
  if (line.trim() === '') continue
  try {
    const row = JSON.parse(line)
    if (row.kind === 'domain-resolve' && typeof row.sessionId === 'string') {
      resolves.set(row.sessionId, row.domainKey ?? null)
    }
  } catch {
    // 坏行(半写/篡改)忽略不炸
  }
}

// 标注侧:sessionId → expected(string | null)
const labels = new Map()
for (const line of readFileSync(labelsPath, 'utf8').split('\n')) {
  if (line.trim() === '') continue
  try {
    const row = JSON.parse(line)
    if (row !== null && typeof row === 'object' && typeof row.sessionId === 'string' && 'expected' in row) {
      labels.set(row.sessionId, row.expected === null ? null : String(row.expected))
    }
  } catch {
    console.warn(`[memory] 标注坏行忽略:${line.slice(0, 80)}`)
  }
}

let matched = 0
let total = 0
let missing = 0
for (const [sessionId, expected] of labels) {
  const actual = resolves.get(sessionId)
  if (actual === undefined) {
    missing += 1
    continue
  }
  total += 1
  if (actual === expected) matched += 1
}
const unlabeled = [...resolves.keys()].filter(id => !labels.has(id)).length
const rate = total > 0 ? matched / total : null

console.log(`域打标准确率:${rate === null ? '暂无(无可比对样本)' : `${(rate * 100).toFixed(1)}%(${matched}/${total})`}`)
console.log(`标注了但账本无解析行:${missing};账本有解析行但未标注:${unlabeled}(不计分母)`)
console.log(`验收参考:19 号 §5-T10——人工标注 ≥30 会话,归并+注册准确率 ≥80%。`)
