/**
 * AgentAdapter 注册表:可交换适配器接口的 provide 形态
 * (注册表 + 唯一 id;新适配器注册即用,不改 runner)。
 */
import type { AgentAdapter } from '../types.ts'
import { AcpAdapter, type AcpAdapterOptions } from './acp.ts'
import { ReplayAdapter } from './replay.ts'

const registry = new Map<string, AgentAdapter>()

export function registerAdapter(adapter: AgentAdapter): void {
  if (registry.has(adapter.id)) {
    throw new Error(`适配器 id 重复注册: ${adapter.id}`)
  }
  registry.set(adapter.id, adapter)
}

export function getAdapter(id: string): AgentAdapter {
  const adapter = registry.get(id)
  if (adapter === undefined) {
    throw new Error(`未知适配器: ${id}(可用: ${[...registry.keys()].join(', ')})`)
  }
  return adapter
}

export function adapterIds(): string[] {
  return [...registry.keys()]
}

/** 安装内置适配器(幂等跳过已注册的 id,便于测试重复调用)。 */
export function ensureBuiltinAdapters(options?: { acp?: AcpAdapterOptions }): void {
  if (!registry.has('replay')) registerAdapter(new ReplayAdapter())
  if (!registry.has('acp')) registerAdapter(new AcpAdapter(options?.acp))
}
