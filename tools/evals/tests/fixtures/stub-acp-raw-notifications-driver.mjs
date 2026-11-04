#!/usr/bin/env node
// acp 适配器测试桩(真实通知透传形态):读 stdin 配置后,把 STUB_SAMPLE_FILE
// (scripts/sample-notifications.mjs 采的原始通知 jsonl)逐行以
//   {"kind":"event","event":<原始通知 {method,payload}>}
// 吐出 —— 模拟 python driver 把未规整的 SDK 原始通知透传给 TS 侧的路径,
// 用于钉住 coerceEvents 对真实包裹层级的容忍(acp.ts)。
import { readFileSync } from 'node:fs'

async function readFirstLine() {
  const chunks = []
  for await (const chunk of process.stdin) {
    chunks.push(chunk)
    if (chunk.includes('\n')) break
  }
  return Buffer.concat(chunks).toString('utf8').split('\n')[0] ?? ''
}

await readFirstLine() // 配置行(桩不消费,只对齐协议握手)
const sampleFile = process.env.STUB_SAMPLE_FILE
if (sampleFile === undefined || sampleFile === '') {
  process.stdout.write(`${JSON.stringify({ kind: 'error', message: 'stub: 缺 STUB_SAMPLE_FILE' })}\n`)
  process.exit(3)
}
const emit = (payload) => {
  process.stdout.write(`${JSON.stringify(payload)}\n`)
}
for (const line of readFileSync(sampleFile, 'utf8').split('\n')) {
  const trimmed = line.trim()
  if (trimmed === '') continue
  emit({ kind: 'event', event: JSON.parse(trimmed) })
}
emit({ kind: 'session', session_id: 'stub-raw-notifications' })
emit({ kind: 'done', finish_reason: 'completed', final_response: 'stub:样本回放完成' })
