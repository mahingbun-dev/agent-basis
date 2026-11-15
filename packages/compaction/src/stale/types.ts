/** Configuration and result contracts for the stale tool-result clearing pass. */

import type { SessionSeq } from '@deepseek-ai/dsh-session'

/** Pressure-gated stale-clearing policy（22 号 §4-C6 / §6 配置面全表）。 */
export interface StalePruneConfig {
  /** Newest turn-groups of tool results kept verbatim. Defaults to `5`. */
  keepGroups?: number
  /** Skip the whole pass when projected savings fall below this floor. Defaults to `4096`. */
  minSavingsTokens?: number
  /** Trigger only when measured pressure reaches `contextWindow × thresholdRatio`. Defaults to `0.7`. */
  thresholdRatio?: number
}

/** Validated, detached, deeply immutable stale-clearing configuration. */
export interface ResolvedStaleConfig {
  readonly keepGroups: number
  readonly minSavingsTokens: number
  readonly thresholdRatio: number
}

/** One landed stale replacement. */
export interface StalePrunedEntry {
  /** Full-fidelity tool-result event shadowed by the placeholder replacement. */
  readonly seq: SessionSeq
  /** Turn the shadowed tool result belonged to. */
  readonly turn: number
  /** Original message price recorded on the paired shadow-price event. */
  readonly shadowedTokenCount: number
}

/** Aggregate outcome of one stale-clearing pass. */
export interface StalePruneResult {
  /** Replacements in landing order（turn 组降序、组内 seq 升序）. */
  readonly pruned: readonly StalePrunedEntry[]
  /** Projected reclaimed tokens: Σ(estimateMessage(原文) − estimateMessage(占位)). */
  readonly savedTokens: number
}
