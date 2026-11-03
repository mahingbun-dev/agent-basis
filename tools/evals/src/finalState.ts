/**
 * 终态断言:file_assert(工作区文件)/ http_assert(本地 mock 服务重放)/ script(exit 0)。
 *
 * http 断言语义(设计要求「replay 回放 …… http 用 mock」):
 * 1. 从会话 tool/call 事件里找证据——agent 确实发出过该 http 请求(方法/path/body 断言);
 * 2. 起本地 mock(127.0.0.1 随机端口)按 respond 配置应答,把记录到的请求
 *    重定向到 mock 真实发出(node:http 全链路),断言响应 status/body。
 * 全程不出外网:请求地址的 host:port 被改写为本地 mock。
 */
import { spawn } from 'node:child_process'
import * as http from 'node:http'
import * as path from 'node:path'
import type { SessionSummary, ToolCallView } from './events.ts'
import type { FailureDetail, FileAssert, FinalStateAssert, HttpAssert } from './types.ts'

interface RecordedRequest {
  readonly method: string
  readonly url: string
  readonly body?: string
}

/** 从 tool/call 的 arguments JSON 里解析 http 请求(url/method/body 字段名宽松兼容)。 */
function recordedRequestOf(call: ToolCallView): RecordedRequest | undefined {
  let parsed: unknown
  try {
    parsed = JSON.parse(call.arguments)
  } catch {
    return undefined
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return undefined
  const record = parsed as Record<string, unknown>
  const url = typeof record.url === 'string' ? record.url : typeof record.href === 'string' ? record.href : undefined
  if (url === undefined) return undefined
  const method = typeof record.method === 'string' ? record.method : 'GET'
  const body = typeof record.body === 'string' ? record.body : undefined
  return { method: method.toUpperCase(), url, ...(body === undefined ? {} : { body }) }
}

async function runFileAssert(spec: FileAssert, workspaceDir: string): Promise<string[]> {
  const problems: string[] = []
  const target = safeJoin(workspaceDir, spec.path)
  if (target === undefined) return [`file_assert: 非法路径 ${spec.path}`]
  let content: string | undefined
  try {
    content = await readFile(target)
  } catch {
    content = undefined
  }
  const shouldExist = spec.exists ?? true
  if (content === undefined) {
    if (shouldExist) problems.push(`file_assert: 文件不存在 ${spec.path}`)
    return problems
  }
  if (!shouldExist) {
    problems.push(`file_assert: 文件不应存在 ${spec.path}`)
    return problems
  }
  if (spec.contains !== undefined && !content.includes(spec.contains)) {
    problems.push(`file_assert: ${spec.path} 未包含期望文本 ${JSON.stringify(spec.contains)}`)
  }
  if (spec.not_contains !== undefined && content.includes(spec.not_contains)) {
    problems.push(`file_assert: ${spec.path} 不应包含文本 ${JSON.stringify(spec.not_contains)}`)
  }
  return problems
}

function safeJoin(workspaceDir: string, relative: string): string | undefined {
  const resolved = path.resolve(workspaceDir, relative)
  const root = path.resolve(workspaceDir)
  if (resolved !== root && !resolved.startsWith(`${root}${path.sep}`)) return undefined
  return resolved
}

/** 本地 mock 服务:记录收到的请求,按配置应答。 */
interface MockServer {
  readonly origin: string
  close(): Promise<void>
}

async function startMock(respond: { status: number; body: string }): Promise<MockServer> {
  const server = http.createServer((req, res) => {
    const chunks: Buffer[] = []
    req.on('data', (chunk: Buffer) => chunks.push(chunk))
    req.on('end', () => {
      res.writeHead(respond.status, { 'content-type': 'text/plain; charset=utf-8' })
      res.end(respond.body)
    })
  })
  await listen(server, '127.0.0.1', 0)
  const address = server.address()
  if (address === null || typeof address === 'string') {
    throw new Error('mock 服务器未拿到端口')
  }
  return {
    origin: `http://127.0.0.1:${address.port}`,
    close: () => closeServer(server),
  }
}

function listen(server: http.Server, host: string, port: number): Promise<void> {
  return new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(port, host, () => {
      resolve()
    })
  })
}

function closeServer(server: http.Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((error) => {
      if (error === undefined) resolve()
      else reject(error)
    })
  })
}

/** 把记录到的请求 URL 的 origin 改写为本地 mock,保留 path+query。 */
function rewriteToLocal(url: string, origin: string): string {
  const queryIndex = url.indexOf('?')
  const rawPath = queryIndex === -1 ? url : url.slice(0, queryIndex)
  const query = queryIndex === -1 ? '' : url.slice(queryIndex)
  const pathOnly = rawPath.includes('://') ? `/${rawPath.split('/').slice(3).join('/')}` : rawPath
  return `${origin}${pathOnly === '' ? '/' : pathOnly}${query}`
}

async function runHttpAssert(spec: HttpAssert, summary: SessionSummary): Promise<string[]> {
  const problems: string[] = []
  const toolName = spec.request.tool ?? 'http_request'
  const expectMethod = spec.request.method === undefined ? undefined : spec.request.method.toUpperCase()
  const candidates = summary.toolCalls
    .filter(call => call.name === toolName)
    .map(call => ({ call, request: recordedRequestOf(call) }))
    .filter((item): item is { call: ToolCallView; request: RecordedRequest } => item.request !== undefined)
  const matched = candidates.filter(({ request }) => {
    if (expectMethod !== undefined && request.method !== expectMethod) return false
    if (spec.request.path !== undefined && !request.url.includes(spec.request.path)) return false
    if (spec.request.body_contains !== undefined && !(request.body ?? '').includes(spec.request.body_contains)) return false
    return true
  })
  if (matched.length === 0) {
    const seen = candidates.map(({ request }) => `${request.method} ${request.url}`).join('; ') || '无'
    problems.push(`http_assert: 会话中找不到匹配的 ${toolName} 调用(${expectMethod ?? '任意方法'}${spec.request.path === undefined ? '' : ` 含 ${spec.request.path}`}),已见: ${seen}`)
    return problems
  }
  const respond = { status: spec.respond?.status ?? 200, body: spec.respond?.body ?? '' }
  const mock = await startMock(respond)
  try {
    const record = matched[0]
    if (record === undefined) return ['http_assert: 内部错误——匹配列表为空']
    const localUrl = rewriteToLocal(record.request.url, mock.origin)
    const response = await fetch(localUrl, {
      method: record.request.method,
      ...(record.request.body === undefined ? {} : { body: record.request.body }),
    })
    const text = await response.text()
    const expectStatus = spec.assert?.status ?? respond.status
    if (response.status !== expectStatus) {
      problems.push(`http_assert: mock 响应 status ${response.status} != 期望 ${expectStatus}`)
    }
    const expectBody = spec.assert?.body_contains
    if (expectBody !== undefined && !text.includes(expectBody)) {
      problems.push(`http_assert: mock 响应体未包含 ${JSON.stringify(expectBody)},实际: ${text.slice(0, 120)}`)
    }
  } finally {
    await mock.close()
  }
  return problems
}

function runScriptAssert(spec: { command: string; stdout_contains?: string }, workspaceDir: string, timeoutMs: number): Promise<string[]> {
  return new Promise((resolve) => {
    const child = spawn('/bin/sh', ['-c', spec.command], { cwd: workspaceDir })
    let stdout = ''
    let settled = false
    const timer = setTimeout(() => {
      if (!settled) {
        child.kill('SIGKILL')
        settled = true
        resolve([`script: 命令超时(>${timeoutMs}ms): ${spec.command}`])
      }
    }, timeoutMs)
    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString('utf8')
    })
    child.on('error', (error) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve([`script: 无法执行(${String(error)}): ${spec.command}`])
    })
    child.on('close', (code) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      const problems: string[] = []
      if (code !== 0) problems.push(`script: 退出码 ${code} != 0: ${spec.command}`)
      if (spec.stdout_contains !== undefined && !stdout.includes(spec.stdout_contains)) {
        problems.push(`script: stdout 未包含 ${JSON.stringify(spec.stdout_contains)}`)
      }
      resolve(problems)
    })
  })
}

const SCRIPT_TIMEOUT_MS = 30_000

/** 终态断言入口:顺序执行所有项,全部通过才通过。 */
export async function assertFinalState(
  spec: readonly FinalStateAssert[],
  summary: SessionSummary,
  workspaceDir: string,
): Promise<FailureDetail[]> {
  const problems: string[] = []
  for (const item of spec) {
    if ('file_assert' in item) {
      problems.push(...await runFileAssert(item.file_assert, workspaceDir))
    } else if ('http_assert' in item) {
      problems.push(...await runHttpAssert(item.http_assert, summary))
    } else {
      problems.push(...await runScriptAssert(item.script, workspaceDir, SCRIPT_TIMEOUT_MS))
    }
  }
  return problems.map(message => ({ category: 'final_state' as const, message }))
}

async function readFile(target: string): Promise<string> {
  const { readFile } = await import('node:fs/promises')
  return readFile(target, 'utf8')
}
