/** Basis enterprise LLM route: OpenAI-compatible gateways over the dsh llm seam. */
import type { Context } from '@deepseek-ai/cordis'
import { LlmError } from '@deepseek-ai/dsh-llm'
import type {} from '@deepseek-ai/cordis-plugin-loader'
import { Config, resolveBasisOptions } from './types.ts'
import type { BasisConnectionOptions } from './types.ts'
import { BasisOpenAIAdapter } from './adapter.ts'

export { Config } from './types.ts'
export const name = 'basis-llm-openai'
export const inject = ['llm']

/** API key resolution for the first cut: the launching environment only.
 * Enterprise deployments that rotate keys through the credentials service
 * should replace this with a `ctx.credentials` lookup. */
function resolveApiKey(connection: BasisConnectionOptions): Record<string, string> {
  const key = process.env[connection.apiKeyEnv]
  if (key === undefined || key.length === 0) {
    throw new LlmError(
      `basis-llm-openai: no API key for provider route "${connection.provider}"; export ${connection.apiKeyEnv} in the launching environment`,
      'MISSING_CREDENTIAL',
    )
  }
  return { authorization: `Bearer ${key}` }
}

export function apply(ctx: Context, config: Config): void {
  // The loader hands the row config with volatile fields as accessor objects
  // (see cosmokit's Volatile): resolveBasisOptions unwraps them and fills the
  // defaults. Never run this through the schema — validating the raw row
  // would reject the accessors and fail the whole row.
  const options = (): BasisConnectionOptions => resolveBasisOptions(config)
  ctx.llm.registerConfigurableProviders([
    {
      provider: options().provider,
      displayName: 'Basis LLM (OpenAI-compatible)',
      settingsNs: ctx.fiber.entry?.options.id ?? name,
      settingsPath: [],
    },
  ])
  const providerRoute = options().provider
  ctx.llm.registerAdapter([providerRoute], new BasisOpenAIAdapter({
    options,
    resolveAuth: connectionFacts => Promise.resolve({ headers: resolveApiKey(connectionFacts) }),
  }))
}
