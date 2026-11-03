#!/usr/bin/env node
// acp 适配器测试桩:与 python/dsh_eval_driver.py 说同一套 NDJSON 协议,
// 但不依赖 deepseek-harness-sdk —— 用于真跑 TS 侧 spawn/解析/断言管线。
// 行为由 stdin 配置驱动:
//   session_id=boom       → 输出 {"kind":"error"}(协议错误路径)
//   session_id=slow       → 睡 5s(超时路径,测试配 1s 超时)
//   其它                   → 输出一条完整会话(含审批事件)
import { setTimeout as sleep } from 'node:timers/promises'

async function readFirstLine() {
  const chunks = []
  for await (const chunk of process.stdin) {
    chunks.push(chunk)
    if (chunk.includes('\n')) break
  }
  return Buffer.concat(chunks).toString('utf8').split('\n')[0] ?? ''
}

const line = await readFirstLine()
const config = JSON.parse(line)
const emit = (payload) => {
  process.stdout.write(`${JSON.stringify(payload)}\n`)
}

if (config.session_id === 'boom') {
  emit({ kind: 'error', message: 'stub: 模拟驱动失败' })
  process.exit(3)
}
if (config.session_id === 'slow') {
  await sleep(5000)
  emit({ kind: 'done', finish_reason: 'completed', final_response: 'too late' })
  process.exit(0)
}

emit({ kind: 'session', session_id: `stub-session-${config.session_id}` })
emit({
  kind: 'event',
  event: {
    type: 'turn/start', seq: 1, time: 1762000000000, data: { turn: 1 },
  },
})
emit({
  kind: 'event',
  event: {
    type: 'step/start', seq: 2, time: 1762000000100, data: { turn: 1, step: 1 },
  },
})
emit({
  kind: 'event',
  event: {
    type: 'assistant/message',
    seq: 3,
    time: 1762000000200,
    data: {
      turn: 1, step: 1,
      message: { role: 'assistant', content: [{ type: 'text', text: '桩应答' }] },
      stream: [],
      usage: { inputTokens: 10, outputTokens: 5 },
    },
  },
})
emit({
  kind: 'event',
  event: {
    type: 'approval/asked',
    seq: 4,
    time: 1762000000300,
    data: { id: 'apr-stub', toolName: 'send_group_message' },
  },
})
emit({
  kind: 'event',
  event: {
    type: 'approval/decided',
    seq: 5,
    time: 1762000000400,
    data: { id: 'apr-stub', outcome: 'rejected' },
  },
})
emit({
  kind: 'event',
  event: { type: 'driver/notification', seq: 6, time: 1762000000500, data: { method: 'unknown/thing' }, ignorable: true },
})
emit({ kind: 'not-a-known-kind', foo: 1 })
emit({ kind: 'done', finish_reason: 'completed', final_response: 'stub:任务完成' })
