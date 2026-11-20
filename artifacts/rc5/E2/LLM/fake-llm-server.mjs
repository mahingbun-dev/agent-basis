#!/usr/bin/env node
/**
 * rc.5 验收 · 确定性假模型（OpenAI chat/completions 子集，SSE 流式）。
 *
 * 目的：P0 里 MCPS-003 / TERM-003 / MCPP-019 / MCPP-020 / MCPP-022 需要
 * 「真实模型回合」才能到工具管线；E1/E2 无 LLM 凭据，且真模型不可复现。
 * 本夹具在宿主起一个本地 OpenAI 兼容端点，由提示词里的 @@CALL 指令决定
 * 模型这一轮发哪个 tool_call——工具清单仍由 dsh 真实下发，工具执行、权限门、
 * 流式回传全部走产品代码，只有「模型选哪个工具」被确定性化。
 *
 * 协议约定（提示词内指令，一行一条）：
 *   @@CALL name=<tool 名> args=<JSON>
 * 第 n 次模型调用（n = 请求里 role=tool 的消息数）发第 n 条 @@CALL；
 * 指令用尽后返回收尾文本，让回合正常结束。
 * 若 @@CALL 指向的工具不在本轮 tools 清单里，仍然照发（用于 MCPP-020
 * 构造越权调用），并在日志里记 absent=true——这正好是产品侧该拒绝的输入。
 *
 * 诊断：每个请求摘要写 NDJSON 到 FAKE_LLM_LOG（只写工具名/消息数/发出内容，
 * 不写 prompt 正文、不写任何凭据）。stdout 只打印启动行。
 *
 * 用法：FAKE_LLM_LOG=/tmp/fake-llm.jsonl PORT=4599 node fake-llm-server.mjs
 */
import { createServer } from 'node:http'
import { appendFileSync } from 'node:fs'

const PORT = Number(process.env.PORT ?? 4599)
const LOG = process.env.FAKE_LLM_LOG ?? ''
const MODEL = process.env.FAKE_LLM_MODEL ?? 'fake-1'

let seq = 0

function logRecord(record) {
  if (LOG === '') return
  appendFileSync(LOG, `${JSON.stringify({ at: new Date().toISOString(), seq, ...record })}\n`)
}

function textOf(content) {
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    return content
      .map(part => (typeof part === 'string' ? part : typeof part?.text === 'string' ? part.text : ''))
      .join('\n')
  }
  return ''
}

/** 从提示词提取 @@CALL 指令（保持出现顺序）。 */
function scopedText(text) {
  // 多回合会话：历史里的旧指令不能参与本轮选择；@@SEQ <id> 之后的指令才有效。
  const lines = text.split(/\r?\n/)
  let start = 0
  for (let index = 0; index < lines.length; index += 1) {
    if (/^\s*@@SEQ\s+\d+\s*$/.test(lines[index])) start = index + 1
  }
  return lines.slice(start).join('\n')
}

/**
 * 取首个平衡的 JSON 对象：子代理提示词会被产品追加说明文字（可能黏在同一行），
 * 因此不能按「行尾即 args 结尾」解析；按花括号配对截断后再解析。
 */
function parseArgs(raw) {
  const trimmed = raw.trim()
  if (trimmed.startsWith('{')) {
    let depth = 0
    let inString = false
    let escaped = false
    for (let index = 0; index < trimmed.length; index += 1) {
      const char = trimmed[index]
      if (inString) {
        if (escaped) escaped = false
        else if (char === '\\') escaped = true
        else if (char === '"') inString = false
        continue
      }
      if (char === '"') inString = true
      else if (char === '{') depth += 1
      else if (char === '}') {
        depth -= 1
        if (depth === 0) {
          try {
            return JSON.parse(trimmed.slice(0, index + 1))
          } catch {
            break
          }
        }
      }
    }
  }
  try {
    return JSON.parse(trimmed)
  } catch {
    return { raw }
  }
}

function callsOf(text) {
  const calls = []
  for (const line of text.split(/\r?\n/)) {
    const match = /^\s*@@CALL\s+name=(\S+)\s+args=(.*)$/.exec(line)
    if (match === null) continue
    calls.push({ name: match[1], args: parseArgs(match[2]) })
  }
  return calls
}

function delayOf(text) {
  const match = /^\s*@@DELAY\s+(\d+)\s*$/m.exec(text)
  return match === null ? 0 : Math.min(120_000, Number(match[1]))
}

/** 工具结果里的终端 id（terminal_open 返回的文本/JSON 均可）。 */
function lastTerminalId(messages) {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index]?.role !== 'tool') continue
    const text = textOf(messages[index]?.content)
    // 实测输出：`started terminal session pty-1 [type: shell] …` / `pty-1 [shell] running pid=…`
    const patterns = [
      /started terminal session (\S+)/,
      /\b(pty-\d+)\b/,
      /"(?:id|terminalId)"\s*:\s*"([^"]+)"/,
      /terminal(?:\s+id)?[:\s]+([A-Za-z0-9_-]+)/i,
    ]
    for (const pattern of patterns) {
      const id = pattern.exec(text)?.[1]
      if (id !== undefined) return id
    }
  }
  return undefined
}

/** $LAST_ID 占位替换（链式工具调用：open → send/read 同一终端）。 */
function substitute(value, lastId) {
  if (typeof value === 'string') {
    if (value === '$LAST_ID') return lastId ?? value
    return value.replaceAll('$LAST_ID', lastId ?? value)
  }
  if (Array.isArray(value)) return value.map(item => substitute(item, lastId))
  if (typeof value === 'object' && value !== null) {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, substitute(item, lastId)]))
  }
  return value
}

function chunk(delta, finish = null) {
  return {
    id: `chatcmpl-fake-${seq}`,
    object: 'chat.completion.chunk',
    created: Math.floor(Date.now() / 1000),
    model: MODEL,
    choices: [{ index: 0, delta, finish_reason: finish }],
  }
}

function sse(res, frames, done = true) {
  res.writeHead(200, {
    'content-type': 'text/event-stream; charset=utf-8',
    'cache-control': 'no-cache',
    connection: 'keep-alive',
  })
  for (const frame of frames) res.write(`data: ${JSON.stringify(frame)}\n\n`)
  if (done) res.write('data: [DONE]\n\n')
  res.end()
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const parts = []
    req.on('data', part => parts.push(part))
    req.on('end', () => {
      try {
        resolve(JSON.parse(Buffer.concat(parts).toString('utf8')))
      } catch (error) {
        reject(error)
      }
    })
    req.on('error', reject)
  })
}

async function chatComplete(req, res) {
  let body
  try {
    body = await readBody(req)
  } catch {
    res.writeHead(400, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ error: { message: 'invalid json' } }))
    return
  }
  seq += 1
  const tools = (Array.isArray(body.tools) ? body.tools : [])
    .map(tool => tool?.function?.name ?? tool?.name)
    .filter(name => typeof name === 'string')
  const messages = Array.isArray(body.messages) ? body.messages : []
  // 同一会话多回合：tool 消息是历史累积的；只数「本回合 SEQ 指令之后」的 tool 结果，
  // 否则第二回合会按历史下标取不到指令（直接回终止文本，测不出强制调用）。
  let turnStart = 0
  for (let index = 0; index < messages.length; index += 1) {
    if (messages[index]?.role !== 'user') continue
    if (/@@SEQ\s+\d+/.test(textOf(messages[index]?.content))) turnStart = index
  }
  const toolResults = messages.slice(turnStart).filter(message => message?.role === 'tool').length
  // 指令可能不在最后一条 user 里：dsh 会在用户输入后追加环境/技能等 user 块。
  const userText = messages
    .filter(message => message?.role === 'user')
    .map(message => textOf(message?.content))
    .join('\n')
  const scoped = scopedText(userText)
  const calls = callsOf(scoped)
  const pending = calls[toolResults]
  const absent = pending !== undefined && !tools.includes(pending.name)
  const finalText = pending === undefined ? `回合结束：共执行 ${toolResults} 次工具调用。` : ''
  const lastId = lastTerminalId(messages)
  const effective = pending === undefined ? undefined : { name: pending.name, args: substitute(pending.args, lastId) }
  const delayMs = pending === undefined ? 0 : delayOf(scoped)

  logRecord({
    stream: body.stream === true,
    model: body.model,
    toolCount: tools.length,
    toolNames: tools,
    messageRoles: messages.map(message => message?.role),
    toolResults,
    toolResultsTurn: toolResults,
    toolResultTexts: messages
      .filter(message => message?.role === 'tool')
      .map(message => textOf(message?.content).replace(/\s+/g, ' ').slice(0, 400)),
    pending: effective ?? null,
    absent,
    calledTools: calls.map(call => call.name),
    lastIdPresent: lastId !== undefined,
    delayMs,
  })

  const callFrame = effective === undefined
    ? undefined
    : {
        index: 0,
        id: `call_fake_${seq}_${toolResults}`,
        type: 'function',
        function: { name: effective.name, arguments: JSON.stringify(effective.args) },
      }
  if (delayMs > 0) await new Promise(done => setTimeout(done, delayMs))

  if (body.stream !== true) {
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(JSON.stringify({
      id: `chatcmpl-fake-${seq}`,
      object: 'chat.completion',
      created: Math.floor(Date.now() / 1000),
      model: MODEL,
      choices: [{
        index: 0,
        message: effective === undefined
          ? { role: 'assistant', content: finalText }
          : { role: 'assistant', content: null, tool_calls: [callFrame] },
        finish_reason: effective === undefined ? 'stop' : 'tool_calls',
      }],
      usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
    }))
    return
  }

  if (effective === undefined) {
    sse(res, [
      chunk({ role: 'assistant', content: '' }),
      chunk({ content: finalText }),
      chunk({}, 'stop'),
    ])
    return
  }
  const args = JSON.stringify(effective.args)
  const split = Math.max(1, Math.ceil(args.length / 2))
  sse(res, [
    chunk({ role: 'assistant', content: '' }),
    chunk({ tool_calls: [{ index: 0, id: callFrame.id, type: 'function', function: { name: pending.name, arguments: '' } }] }),
    chunk({ tool_calls: [{ index: 0, function: { arguments: args.slice(0, split) } }] }),
    chunk({ tool_calls: [{ index: 0, function: { arguments: args.slice(split) } }] }),
    chunk({}, 'tool_calls'),
  ])
}

const server = createServer((req, res) => {
  const url = req.url ?? '/'
  if (req.method === 'GET' && /\/models(?:\?.*)?$/.test(url)) {
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ object: 'list', data: [{ id: MODEL, object: 'model', owned_by: 'rc5-harness' }] }))
    return
  }
  if (req.method === 'POST' && /\/chat\/completions(?:\?.*)?$/.test(url)) {
    chatComplete(req, res).catch((error) => {
      res.writeHead(500, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ error: { message: String(error?.message ?? error) } }))
    })
    return
  }
  if (req.method === 'GET' && url === '/healthz') {
    res.writeHead(200, { 'content-type': 'text/plain' })
    res.end('ok')
    return
  }
  res.writeHead(404, { 'content-type': 'application/json' })
  res.end(JSON.stringify({ error: { message: `not found: ${req.method} ${url}` } }))
})

server.listen(PORT, '0.0.0.0', () => {
  console.log(`[fake-llm] listening 0.0.0.0:${PORT} model=${MODEL} log=${LOG || '(off)'}`)
})