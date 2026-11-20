#!/usr/bin/env node
/**
 * MCP stdio 夹具服务器（51 §1；54 §6.2；T47）。
 *
 * 用途：个人层 MCP 的管理员 stdio 目录项 `echo`（MCPP-005/006 等）与
 * `verify-mcp-personal.mjs` 的 probe 目标。
 *
 * 协议：MCP JSON-RPC over stdio，一行一条 JSON（NDJSON）；stdout 只放协议帧，
 * 诊断信息一律走 stderr（stdout 被客户端独占解析）。
 *
 * 用法：
 *   node tests/fixtures/mcp-echo-server.mjs
 *   MCP_ECHO_TAG=foo node tests/fixtures/mcp-echo-server.mjs
 *
 * 夹具只读：不读文件、不联网、不写盘；不打印任何环境变量。
 */
import { createInterface } from 'node:readline'
import { handleMessage, toFrame } from './mcp-fixture-core.mjs'

const TAG = process.env.MCP_ECHO_TAG ?? 'fixture'

const rl = createInterface({ input: process.stdin, crlfDelay: Number.POSITIVE_INFINITY })
rl.on('line', line => {
  const trimmed = line.trim()
  if (trimmed === '') return
  let parsed
  try {
    parsed = JSON.parse(trimmed)
  } catch {
    process.stderr.write(`[mcp-echo] 非法 JSON 行（已忽略）: ${trimmed.slice(0, 120)}\n`)
    return
  }
  try {
    const frame = toFrame(parsed, handleMessage(parsed, { tag: TAG }))
    if (frame !== undefined) process.stdout.write(frame + '\n')
  } catch (error) {
    process.stderr.write(`[mcp-echo] handler error: ${error instanceof Error ? error.message : String(error)}\n`)
  }
})
rl.on('close', () => process.exit(0))
process.on('SIGTERM', () => process.exit(0))
process.on('SIGINT', () => process.exit(0))

process.stderr.write('[mcp-echo] ready\n')