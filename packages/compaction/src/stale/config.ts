/** Configuration resolution for the pressure-gated stale-clearing pass. */

import { deepFreeze } from '@deepseek-ai/dsh-util-values'
import type { ResolvedStaleConfig, StalePruneConfig } from './types.ts'

/** Placeholder substituted for every cleared stale tool result（22 号 §4-C6 逐字文案）. */
export const STALE_PRUNE_MARKER
  = '[... tool result cleared (stale): 原始记录保留在会话日志，可回放查看 ...]'

/** Low-friction defaults（22 号 §6 配置面全表：5 / 4096 / 0.7）. */
export const DEFAULTS: ResolvedStaleConfig = deepFreeze({
  keepGroups: 5,
  minSavingsTokens: 4096,
  thresholdRatio: 0.7,
})

const CONFIG_KEYS: ReadonlySet<string> = new Set([
  'keepGroups',
  'minSavingsTokens',
  'thresholdRatio',
])

/**
 * Resolve and validate the stale-clearing policy.
 * @param config - raw plugin configuration.
 * @returns a detached deeply immutable configuration.
 */
export function resolveStaleConfig(config: StalePruneConfig = {}): ResolvedStaleConfig {
  for (const key of Object.keys(config)) {
    if (!CONFIG_KEYS.has(key)) {
      throw new Error(
        `StalePruneConfig: unknown key "${key}" `
        + '(allowed: keepGroups, minSavingsTokens, thresholdRatio)',
      )
    }
  }

  const resolved: ResolvedStaleConfig = {
    keepGroups: config.keepGroups ?? DEFAULTS.keepGroups,
    minSavingsTokens: config.minSavingsTokens ?? DEFAULTS.minSavingsTokens,
    thresholdRatio: config.thresholdRatio ?? DEFAULTS.thresholdRatio,
  }
  assertPositiveInteger('keepGroups', resolved.keepGroups)
  assertPositiveInteger('minSavingsTokens', resolved.minSavingsTokens)
  if (!Number.isFinite(resolved.thresholdRatio) || resolved.thresholdRatio <= 0 || resolved.thresholdRatio > 1) {
    throw new Error(
      `StalePruneConfig: thresholdRatio (${resolved.thresholdRatio}) must be a finite number in (0, 1]`,
    )
  }
  return deepFreeze(structuredClone(resolved))
}

function assertPositiveInteger(name: string, value: number): void {
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`StalePruneConfig: ${name} (${value}) must be a positive integer`)
  }
}
