/**
 * B14 个人层 MCP 客户端 API(T28)：/api/mcp-personal/* 五个端点的同源封装。
 *
 * 服务端契约见 `mcp-personal.ts`(T26)：全部 POST + RPC 信封(由 rpc.ts 统一构造,
 * 裸 body 会 400 `invalid client-request message`);返回视图**不含密钥值**,
 * 只有 `hasSecret` 布尔(50 §3.4.2)。本模块只做类型与调用,不持有任何明文:
 * 密钥只在 upsert 的 `secrets`/`env` 参数里从表单直达网络,不落 state 之外。
 */
import { postRpc, type RpcResult } from './rpc.ts'

/** 传输方式(与服务端 McpTransport 同值域;`http` 是 `streamable-http` 的输入别名)。 */
export type McpTransportValue = 'stdio' | 'streamable-http'

/** 个人条目视图(密钥值/占位永不回传,只有 hasSecret)。 */
export interface McpPersonalItem {
  readonly id: string
  readonly name: string
  readonly serverName: string
  readonly transport: McpTransportValue
  readonly catalogId: string | null
  readonly url: string | null
  readonly headerNames: readonly string[]
  readonly hasSecret: boolean
  readonly enabled: boolean
  readonly createdAt: string
  readonly updatedAt: string
}

/** 管理员 stdio 目录项(只下发名字,不下发 command/args/env 值)。 */
export interface McpCatalogEntry {
  readonly name: string
  readonly label: string
  readonly transport: 'stdio'
  readonly envNames: readonly string[]
}

export interface McpCatalogView {
  readonly items: readonly McpCatalogEntry[]
  /** 空数组 = 未收紧(仍拒云元数据);非空 = 管理员 host 白名单。 */
  readonly hostWhitelist: readonly string[]
}

export interface McpListView {
  readonly items: readonly McpPersonalItem[]
  /** 每用户条目上限(服务端 MCP_PERSONAL_MAX_SERVERS,当前 8)。 */
  readonly limit: number
}

export interface McpProbeView {
  readonly ok: boolean
  readonly toolCount: number
  readonly error?: string
}

/**
 * upsert 请求体。密钥语义(与服务端一致):
 * - HTTP: `headers` 值必须是 `${secret:REF}` 占位,`secrets` 提供本次要写入的明文;
 * - stdio: `env` 值即明文(服务端按目录 envSchema 收口后加密为 env:<NAME> ref);
 * - 编辑时留空的密钥字段不发送 → 服务端保留旧密文(视图只回 hasSecret)。
 */
export interface McpUpsertRequest {
  readonly id?: string
  readonly name: string
  readonly transport: McpTransportValue
  readonly catalogId?: string
  readonly url?: string
  readonly headers?: Readonly<Record<string, string>>
  readonly secrets?: Readonly<Record<string, string>>
  readonly env?: Readonly<Record<string, string>>
  readonly enabled?: boolean
}

/** 五端点(信封由 postRpc 构造;method 由路径去 /api/ 前缀得出)。 */
export const mcpPersonalApi = {
  catalog: (): Promise<RpcResult<McpCatalogView>> => postRpc<McpCatalogView>('/api/mcp-personal/catalog'),
  list: (): Promise<RpcResult<McpListView>> => postRpc<McpListView>('/api/mcp-personal/list'),
  upsert: (request: McpUpsertRequest): Promise<RpcResult<{ readonly item: McpPersonalItem }>> =>
    postRpc<{ readonly item: McpPersonalItem }>('/api/mcp-personal/upsert', { request }),
  remove: (id: string): Promise<RpcResult<{ readonly ok: boolean }>> =>
    postRpc<{ readonly ok: boolean }>('/api/mcp-personal/delete', { request: { id } }),
  probe: (id: string): Promise<RpcResult<McpProbeView>> =>
    postRpc<McpProbeView>('/api/mcp-personal/probe', { request: { id } }),
}

/** 失败帧的展示文案(服务端 message 优先,其次调用方给的兜底)。 */
export function rpcFailureMessage(result: { readonly error?: { readonly message?: string } | undefined }, fallback: string): string {
  const message = result.error?.message
  return message === undefined || message === '' ? fallback : message
}
