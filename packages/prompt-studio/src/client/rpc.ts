/**
 * 宿主 RPC 调用助手:统一 unwrapping 官方 Connection RpcResult 封套。
 *
 * 载荷纪律(T7.1 契约,docs/dev/t7-prompt-studio.md §1):SRC 参数绑定按宿主方法
 * 形参名——带参端点 wire 载荷 `payload.args = { input: { … } }`,无参端点
 * `payload.args = {}`。数组形态会被 gateway/internal 拒绝("exactly one
 * plain-object args field",panel 实证)。
 */
import type { ConnectionFace } from './client-types.ts'

/** 失败封套(RemoteError 的 message/code 面板同款 unwrap)。 */
export interface RpcFailure {
  readonly ok: false
  readonly message: string
  readonly code?: string | undefined
}

export type RpcEnvelope<T> = { readonly ok: true; readonly value: T } | RpcFailure

/** 宿主 loopPrompt 端点(RPC namespace = loopPrompt;T7.1 SRC 端点)。 */
export const ENDPOINTS = {
  snapshot: 'loopPrompt/snapshot',
  trace: 'loopPrompt/trace',
  promptGet: 'loopPrompt/prompt-get',
  promptSave: 'loopPrompt/prompt-save',
  promptVersions: 'loopPrompt/prompt-versions',
  promptRollback: 'loopPrompt/prompt-rollback',
  promptExport: 'loopPrompt/prompt-export',
  promptImport: 'loopPrompt/prompt-import',
  sessionSnapshot: 'loopPrompt/session-snapshot',
} as const

/**
 * 调用宿主端点并 unwrap 封套。
 * @param args - 命名参数对象(无参端点传 `{}`;带参端点传 `{ input: { … } }`)。
 */
export async function callRpc<T>(
  connection: ConnectionFace,
  endpoint: string,
  args: Record<string, unknown> = {},
): Promise<RpcEnvelope<T>> {
  const result = await connection.rpc.call('/api', endpoint, { args })
  if (result.ok && typeof result.value === 'object' && result.value !== null) {
    return { ok: true, value: result.value as T }
  }
  if (result.ok) {
    return { ok: false, message: '端点返回了意外形状(非对象)' }
  }
  const code = result.error?.code
  return {
    ok: false,
    message: result.error?.message ?? code ?? 'unknown',
    ...(code !== undefined && { code }),
  }
}
