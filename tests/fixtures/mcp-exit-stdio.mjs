#!/usr/bin/env node
/**
 * 会自退出的 MCP stdio 夹具（RC5-MCPP-018：连接丢失 → 重连上限）。
 *
 * 与 mcp-echo-server.mjs 同协议（NDJSON over stdio），多一个 `--exit-after <ms>`
 * （默认 8000）：到点主动退出，模拟已连接服务器掉线，触发 mcp-client 的
 * `connection lost; reconnecting` 路径。
 *
 * 用法：node tests/fixtures/mcp-exit-stdio.mjs --exit-after 8000
 */
import { createInterface } from 'node:readline'
import { handleMessage, toFrame } from './mcp-fixture-core.mjs'

function argOf(name, fallback) {
  const index = process.argv.indexOf(name)
  if (index === -1) return fallback
  const value = process.argv[index + 1]
  const parsed = Number.parseInt(value ?? '', 10)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
}

const TAG = process.env.MCP_EXIT_TAG ?? 'exit-fixture'
const EXIT_AFTER = argOf('--exit-after', 8_000)

const rl = createInterface({ input: process.stdin, crlfDelay: Number.POSITIVE_INFINITY })
rl.on('line', (line) => {
  const trimmed = line.trim()
  if (trimmed === '') return
  let parsed
  try {
    parsed = JSON.parse(trimmed)
  } catch {
    process.stderr.write(`[mcp-exit] 非法 JSON 行（已忽略）: ${trimmed.slice(0, 120)}\n`)
    return
  }
  try {
    const frame = toFrame(parsed, handleMessage(parsed, { tag: TAG }))
    if (frame !== undefined) process.stdout.write(frame + '\n')
  } catch (error) {
    process.stderr.write(`[mcp-exit] handler error: ${error instanceof Error ? error.message : String(error)}\n`)
  }
})

const timer = setTimeout(() => {
  process.stderr.write(`[mcp-exit] 主动退出（${EXIT_AFTER}ms 掉线模拟）\n`)
  process.exit(0)
}, EXIT_AFTER)
timer.unref()

rl.on('close', () => process.exit(0))
process.on('SIGTERM', () => process.exit(0))
process.on('SIGINT', () => process.exit(0))

process.stderr.write(`[mcp-exit] ready (exit-after=${EXIT_AFTER}ms)\n`)