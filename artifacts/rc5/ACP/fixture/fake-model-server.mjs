#!/usr/bin/env node
/**
 * E4 ACP 本地假模型（OpenAI chat-completions SSE 方言）。
 *
 * 目的：E4 测试 env 里只有无效的 MIMO 占位 key（上一轮实测 401），
 * ACP-002（prompt 正常返回）、ACP-006（工具审批）、ACP-007（取消）无法用真模型
 * 走通。本 fixture 在宿主机监听 127.0.0.1:18080（容器经 host.docker.internal 可达，
 * 2026-11-20 实测 REACHED），按 prompt 中的标记词回放剧本：
 *
 *   ACP-SLOW  → 每 350ms 一帧文本，持续约 5s（供 session/cancel 打断）
 *   ACP-TOOL  → 首次请求回 tool_call: bash {description,command: echo acp-permission-ok}
 *               （配合 E4 fixture 数据根的 governance 规则 effect=ask 触发
 *               session/request_permission）；收到 tool 结果后的第二次请求回最终文本
 *   其它      → 快速回“你好，ACP 协议验证通过。”
 *
 * 只记录请求摘要（角色/工具数/prompt 前 80 字符/是否含 tool 结果），
 * 不记录任何 header 或凭据。仅测试用，不入镜像。
 */
import { createServer } from 'node:http'
import { appendFileSync } from 'node:fs'

const PORT = Number.parseInt(process.env.ACP_FIXTURE_PORT ?? '18080', 10)
const LOG = process.env.ACP_FIXTURE_LOG ?? ''

function logEvent(event) {
  if (LOG === '') return
  try { appendFileSync(LOG, `${JSON.stringify({ at: new Date().toISOString(), ...event })}\n`) } catch { /* ignore */ }
}

const MODEL = 'mimo-v2.6-pro'
let sequence = 0

function textOf(content) {
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    return content.map(part => (typeof part === 'string' ? part : (part?.text ?? ''))).join('')
  }
  return ''
}

function summarize(body) {
  const messages = Array.isArray(body?.messages) ? body.messages : []
  const lastUser = [...messages].reverse().find(message => message?.role === 'user')
  const lastText = textOf(lastUser?.content)
  return {
    model: body?.model,
    stream: body?.stream,
    messageRoles: messages.map(message => message?.role),
    toolCount: Array.isArray(body?.tools) ? body.tools.length : 0,
    toolNames: Array.isArray(body?.tools) ? body.tools.map(tool => tool?.function?.name).filter(Boolean) : [],
    hasToolResult: messages.some(message => message?.role === 'tool'),
    promptExcerpt: lastText.slice(0, 80),
  }
}

function sse(res, frames, { delayMs = 0 } = {}) {
  res.writeHead(200, {
    'content-type': 'text/event-stream',
    'cache-control': 'no-cache',
    connection: 'keep-alive',
  })
  res.flushHeaders()
  let index = 0
  let timer
  const writeNext = () => {
    if (res.destroyed || res.writableEnded) return
    const frame = frames[index++]
    if (frame === undefined) {
      res.end()
      return
    }
    res.write(`data: ${typeof frame === 'string' ? frame : JSON.stringify(frame)}\n\n`)
    if (delayMs > 0) timer = setTimeout(writeNext, delayMs)
    else writeNext()
  }
  res.on('close', () => clearTimeout(timer))
  writeNext()
}

function chunk(delta, finish = null, usage) {
  return {
    choices: [{ index: 0, delta, finish_reason: finish }],
    ...(usage === undefined ? {} : { usage }),
  }
}

function textFrames(text) {
  const parts = text.match(/.{1,12}/gu) ?? [text]
  const frames = [chunk({ role: 'assistant', content: '' })]
  for (const part of parts) frames.push(chunk({ content: part }))
  frames.push(chunk({}, 'stop', { prompt_tokens: 11, completion_tokens: parts.length }))
  frames.push('[DONE]')
  return frames
}

function toolFrames() {
  const args = JSON.stringify({ description: 'ACP-006 fixture echo', command: 'echo acp-permission-ok' })
  return [
    chunk({
      role: 'assistant',
      content: '',
      tool_calls: [{ index: 0, id: 'call_acp_fixture_1', type: 'function', function: { name: 'bash', arguments: args } }],
    }),
    chunk({}, 'tool_calls', { prompt_tokens: 12, completion_tokens: 6 }),
    '[DONE]',
  ]
}

function slowFrames() {
  const frames = [chunk({ role: 'assistant', content: '处理中' })]
  for (let index = 0; index < 14; index++) frames.push(chunk({ content: `…${index + 1}` }))
  frames.push(chunk({}, 'stop', { prompt_tokens: 12, completion_tokens: 15 }))
  frames.push('[DONE]')
  return frames
}

const server = createServer((request, response) => {
  const id = ++sequence
  const url = request.url ?? '/'
  response.on('close', () => {
    logEvent({ id, path: url, event: 'response_closed', aborted: !response.writableEnded })
  })

  if (request.method === 'GET' && /\/models$/u.test(url)) {
    response.writeHead(200, { 'content-type': 'application/json' })
    response.end(JSON.stringify({ object: 'list', data: [{ id: MODEL, object: 'model', owned_by: 'acp-fixture' }] }))
    logEvent({ id, path: url, event: 'models' })
    return
  }

  if (request.method !== 'POST' || !/\/chat\/completions$/u.test(url)) {
    response.writeHead(404, { 'content-type': 'application/json' })
    response.end(JSON.stringify({ error: { message: `unhandled ${request.method} ${url}` } }))
    logEvent({ id, path: url, event: 'unhandled' })
    return
  }

  const chunks = []
  request.on('data', chunk => chunks.push(chunk))
  request.on('end', () => {
    let body
    try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')) } catch { body = undefined }
    const summary = summarize(body)
    logEvent({ id, path: url, event: 'chat_completions', ...summary })

    const messages = Array.isArray(body?.messages) ? body.messages : []
    const lastUser = [...messages].reverse().find(message => message?.role === 'user')
    const text = textOf(lastUser?.content)
    const hasToolResult = messages.some(message => message?.role === 'tool')

    if (text.includes('ACP-SLOW')) {
      sse(response, slowFrames(), { delayMs: 350 })
      return
    }
    if (text.includes('ACP-TOOL')) {
      if (hasToolResult) sse(response, textFrames('工具执行完成，审批已放行。'))
      else sse(response, toolFrames())
      return
    }
    sse(response, textFrames('你好，ACP 协议验证通过。'))
  })
})

server.listen(PORT, '127.0.0.1', () => {
  console.log(`[acp-fixture-model] listening on 127.0.0.1:${PORT}${LOG === '' ? '' : ` log=${LOG}`}`)
})

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    server.close(() => process.exit(0))
  })
}