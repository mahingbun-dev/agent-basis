/**
 * 工具注册表实现:register(唯一名)/get/list/schemas(模型面白名单)/restrict(遮罩)。
 * restrict 语义:多条并存;allow 名单取并集(存在任一 allow 即白名单模式),deny 匹配任一即遮蔽;
 * 尾部 `*` 为前缀通配(如 `web_*`)。遮罩同时作用于 schemas() 与 execute(执行门)。
 */
import { randomUUID } from 'node:crypto'
import type { ToolDefinition, ToolRegistry, ToolRestriction, ToolSchema } from '@core/contracts'

/** 尾部 `*` 前缀通配;其余精确匹配。 */
export function matchesPattern(name: string, pattern: string): boolean {
  return pattern.endsWith('*') ? name.startsWith(pattern.slice(0, -1)) : name === pattern
}

function isRestricted(name: string, restrictions: readonly ToolRestriction[]): boolean {
  const allows = restrictions.map(restriction => restriction.allow).filter(list => list !== undefined)
  if (allows.length > 0) {
    const allowed = allows.some(list => list.some(pattern => matchesPattern(name, pattern)))
    if (!allowed) return true
  }
  return restrictions.some(restriction => (restriction.deny ?? []).some(pattern => matchesPattern(name, pattern)))
}

export interface ExecInput {
  readonly name: string
  readonly args: unknown
  readonly turn?: number
  readonly step?: number
  /** 外部取消信号(缺省自建;timeoutMs 存在时叠加超时)。 */
  readonly signal?: AbortSignal
  /** ask 决策送审批时的风险档(缺省 R2)。 */
  readonly riskTier?: 'R0' | 'R1' | 'R2' | 'R3'
}

/** 工具执行器(pre-execute → approval → execute → post-execute 的编排面)。 */
export interface ToolExecutor {
  exec(input: ExecInput): Promise<import('@core/contracts').ToolResult>
}

export class ToolRegistryImpl implements ToolRegistry {
  private readonly definitions = new Map<string, ToolDefinition>()
  private readonly restrictions: ToolRestriction[] = []

  /** 注册工具,返回 the exact disposer;同名重复抛错。 */
  register(definition: ToolDefinition): () => void {
    if (this.definitions.has(definition.name)) {
      throw new Error(`tool "${definition.name}" 已注册(唯一名纪律)`)
    }
    this.definitions.set(definition.name, definition)
    return () => { this.definitions.delete(definition.name) }
  }

  /** 取可见工具(遮罩后的;不可见等同不存在)。 */
  get(name: string): ToolDefinition | undefined {
    const definition = this.definitions.get(name)
    if (definition === undefined) return undefined
    return isRestricted(name, this.restrictions) ? undefined : definition
  }

  /** 全量注册表(不含遮罩;管理面用)。 */
  list(): readonly ToolDefinition[] {
    return [...this.definitions.values()]
  }

  /** 模型面 schema 白名单(仅 name/description/parameters,应用遮罩)。 */
  schemas(): readonly ToolSchema[] {
    return this.list()
      .filter(definition => !isRestricted(definition.name, this.restrictions))
      .map(({ name, description, parameters }) => ({ name, description, parameters }))
  }

  /** 叠加一条遮罩,返回解除器。 */
  restrict(filter: ToolRestriction): () => void {
    this.restrictions.push(filter)
    return () => {
      const index = this.restrictions.indexOf(filter)
      if (index >= 0) this.restrictions.splice(index, 1)
    }
  }

  /** 执行门:遮罩判定(pre-execute 前置)。 */
  restricted(name: string): boolean {
    return isRestricted(name, this.restrictions)
  }

  /** 生成调用 id(executor 用;独立暴露便于测试断言)。 */
  newCallId(): string {
    return randomUUID()
  }
}
