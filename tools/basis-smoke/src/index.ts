/**
 * @basis/smoke —— 工程地基约定载体包的源码。
 *
 * 它的唯一职责:用最小、无依赖的纯函数证明根 toolchain 在子包内完整可用——
 * strict tsconfig 编译通过、oxlint(含 typeAware 桥接)通过、vitest 真实断言通过。
 * 新包请以此为骨架(src/index.ts + tests/*.spec.ts + vitest.config.ts + tsconfig.json)。
 */

/** Cordis 纪律样例:effect 配逆闭包。返回 undo,执行后即恢复原状。 */
export interface PairedEffect {
  readonly applied: boolean
  readonly undo: () => void
}

const registry = new Map<string, PairedEffect>()

/**
 * 注册一个可逆 effect 到进程内注册表(注册表 + 唯一 ID 形态的接口样例)。
 * 同名 ID 重复注册时,先配逆旧 effect 再落新 effect,保证可交换。
 */
export function provideEffect(id: string, effect: PairedEffect): void {
  const existing = registry.get(id)
  if (existing?.applied === true) existing.undo()
  registry.set(id, effect)
}

/** 按 ID 取回 effect;不存在返回 undefined(exactOptionalPropertyTypes 下的显式约定)。 */
export function lookupEffect(id: string): PairedEffect | undefined {
  return registry.get(id)
}

/** 清空注册表并配逆所有仍处 applied 态的 effect(测试隔离用)。 */
export function resetRegistry(): void {
  for (const effect of registry.values()) {
    if (effect.applied) effect.undo()
  }
  registry.clear()
}

/** 供测试断言的确定性纯函数:求和。 */
export function sum(values: readonly number[]): number {
  let total = 0
  for (const value of values) {
    total += value
  }
  return total
}
