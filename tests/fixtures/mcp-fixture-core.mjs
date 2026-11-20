/**
 * MCP 夹具共用协议核心（stdio / HTTP 两版共用；T47）。
 *
 * 只依赖 Node 标准库；纯函数：输入一条 JSON-RPC 消息，返回
 *   { result } → 成功响应
 *   { error: {code, message} } → 错误响应
 *   null → 通知/无需响应
 * 服务器负责序列化与传输。诊断信息不进返回值（由调用方写 stderr）。
 */

export const SERVER_INFO = { name: 'fixture-echo', version: '1.0.0' }
export const DEFAULT_PROTOCOL = '2025-06-18'

export const TOOL = {
  name: 'echo',
  description: '回显输入文本（测试夹具，无副作用）',
  inputSchema: {
    type: 'object',
    properties: { text: { type: 'string', description: '要回显的文本' } },
    required: ['text'],
    additionalProperties: false,
  },
}

/**
 * @param {unknown} message 解析后的 JSON-RPC 消息
 * @param {{tag?: string}} [options]
 * @returns {{result: unknown} | {error: {code: number, message: string}} | null}
 */
export function handleMessage(message, options = {}) {
  if (message === null || typeof message !== 'object' || Array.isArray(message)) return null
  const method = message.method
  if (typeof method !== 'string') return null
  // 通知（无 id）不产生响应；initialize 的 notifications/initialized 属此类。
  if (message.id === undefined || message.id === null) return null
  const tag = typeof options.tag === 'string' && options.tag !== '' ? options.tag : 'fixture'

  switch (method) {
    case 'initialize': {
      const requested = message.params?.protocolVersion
      return {
        result: {
          protocolVersion: typeof requested === 'string' && requested !== '' ? requested : DEFAULT_PROTOCOL,
          capabilities: { tools: { listChanged: false } },
          serverInfo: SERVER_INFO,
          instructions: `fixture echo server (${tag})`,
        },
      }
    }
    case 'ping':
      return { result: {} }
    case 'tools/list':
      return { result: { tools: [TOOL] } }
    case 'tools/call': {
      const name = message.params?.name
      if (name !== TOOL.name) {
        return { error: { code: -32602, message: `未知工具: ${String(name)}` } }
      }
      const text = message.params?.arguments?.text
      if (typeof text !== 'string') {
        return { result: { content: [{ type: 'text', text: 'error: 缺少 text 参数' }], isError: true } }
      }
      return {
        result: {
          content: [{ type: 'text', text: `echo:${text}` }],
          structuredContent: { echoed: text, tag },
          isError: false,
        },
      }
    }
    case 'resources/list':
      return { result: { resources: [] } }
    case 'resources/templates/list':
      return { result: { resourceTemplates: [] } }
    case 'prompts/list':
      return { result: { prompts: [] } }
    case 'completion/complete':
      return { result: { completion: { values: [], total: 0, hasMore: false } } }
    case 'logging/setLevel':
      return { result: {} }
    default:
      return { error: { code: -32601, message: `Method not found: ${method}` } }
  }
}

/** 把核心结果包成 JSON-RPC 帧；null → undefined（通知不回帧）。 */
export function toFrame(message, outcome) {
  if (outcome === null) return undefined
  if ('error' in outcome) {
    return JSON.stringify({ jsonrpc: '2.0', id: message.id, error: outcome.error })
  }
  return JSON.stringify({ jsonrpc: '2.0', id: message.id, result: outcome.result })
}