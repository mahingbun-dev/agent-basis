/** Connection facts and config schema for the Basis OpenAI-compatible route. */

import { isVolatile } from '@deepseek-ai/cosmokit'
import { LlmError } from '@deepseek-ai/dsh-llm'
import z from '@deepseek-ai/schemastery'

/** One selectable model on the gateway; ids pass through to the wire. */
export interface BasisCatalogModel {
  /** Wire model id sent as the request `model` field. */
  id: string
  /** Human-readable name for selectors. */
  name?: string
  /** Provider-owned context capacity. */
  contextWindow?: number
  /** Provider-owned per-request output cap. */
  maxTokens?: number
}

/** How assistant reasoning blocks replay onto the wire for the next request. */
export type ReasoningReplay = 'drop' | 'preserve'

/** Validated connection facts for one operation. */
export interface BasisConnectionOptions {
  /** Chat-completions root, e.g. `http://host:4000/v1`. */
  baseURL: string
  /** Environment variable carrying the gateway key. */
  apiKeyEnv: string
  /** Registered provider route id. */
  provider: string
  /** Selectable models; `undefined` selects the built-in `deepseek-flash` entry. */
  models: BasisCatalogModel[] | undefined
  /** Default context capacity when a catalog entry omits one. */
  defaultContextWindow: number
  /** Default per-request output cap. */
  maxTokens: number
  /** Idle-stream deadline. */
  streamIdleTimeoutMs: number
  /** Assistant reasoning replay policy; `drop` (default) keeps history clean. */
  replayReasoning: ReasoningReplay
}

/** Schema fields shared by the wire-facing config and its volatile updates. */
export const basisConfigFields = {
  /** Chat-completions root without credentials, query, or fragment. */
  baseURL: z.string().volatile(),
  /** Environment variable carrying the gateway key. */
  apiKeyEnv: z.string().default('DEEPSEEK_API_KEY'),
  /** Registered provider route id. */
  provider: z.string().default('deepseek-official'),
  /** Selectable models; defaults to the gateway's `deepseek-flash`. */
  models: z.array(z.object({
    id: z.string().required(),
    name: z.string(),
    contextWindow: z.number(),
    maxTokens: z.number(),
  })).volatile(),
  /** Default context capacity. */
  defaultContextWindow: z.number().step(1).min(1).default(128000).volatile(),
  /** Default per-request output cap. */
  maxTokens: z.number().step(1).min(1).default(8192).volatile(),
  /** Idle-stream deadline. */
  streamIdleTimeoutMs: z.number().step(1).min(1).default(300000).volatile(),
  /** Assistant reasoning replay policy; plain (non-volatile) so `apply` reads it directly. */
  replayReasoning: z.string().default('drop'),
}

/** Wire-facing plugin configuration (resolved shape passed to `apply`). */
export interface Config {
  /** Chat-completions root without credentials, query, or fragment. */
  baseURL: string
  /** Environment variable carrying the gateway key. */
  apiKeyEnv: string
  /** Registered provider route id. */
  provider: string
  /** Selectable models; `undefined` selects the built-in `deepseek-flash` entry. */
  models?: BasisCatalogModel[]
  /** Default context capacity when a catalog entry omits one. */
  defaultContextWindow: number
  /** Default per-request output cap. */
  maxTokens: number
  /** Idle-stream deadline. */
  streamIdleTimeoutMs: number
  /** Assistant reasoning replay policy. */
  replayReasoning: ReasoningReplay
}

/** Wire-facing plugin configuration schema. */
export const Config = z.object(basisConfigFields)

/** Read one config value, unwrapping the volatile reference the loader hands out. */
function unwrap<T>(value: T | { get(): unknown }): T | undefined {
  return (isVolatile(value) ? value.get() : value) as T | undefined
}

/** Normalize the loader's row config into connection facts, filling defaults. */
export function resolveBasisOptions(config: Partial<Config>): BasisConnectionOptions {
  const baseURL = unwrap(config.baseURL)
  if (baseURL === undefined || baseURL.length === 0) {
    throw new LlmError('basis-llm-openai: baseURL is required; set BASIS_LLM_BASE_URL in the bundle row or environment', 'INVALID_REQUEST')
  }
  // 运行时守卫:zod schema 对该字段产出 string(types.ts 接口把 Config.replayReasoning 钉成字面量
  // 联合会让 tsc 把下面的比较判成永假;显式放宽为 string 才能让守卫真的活着)。
  const replayRaw: string = config.replayReasoning ?? 'drop'
  if (replayRaw !== 'drop' && replayRaw !== 'preserve') {
    throw new LlmError(`basis-llm-openai: unsupported replayReasoning "${replayRaw}"; expected "drop" or "preserve"`, 'INVALID_REQUEST')
  }
  return {
    baseURL,
    apiKeyEnv: unwrap(config.apiKeyEnv) ?? 'DEEPSEEK_API_KEY',
    provider: unwrap(config.provider) ?? 'deepseek-official',
    models: unwrap(config.models),
    defaultContextWindow: unwrap(config.defaultContextWindow) ?? 128000,
    maxTokens: unwrap(config.maxTokens) ?? 8192,
    streamIdleTimeoutMs: unwrap(config.streamIdleTimeoutMs) ?? 300000,
    replayReasoning: replayRaw === 'preserve' ? 'preserve' : 'drop',
  }
}
