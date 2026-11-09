# @eterna/llm-openai

The Basis platform's enterprise LLM route: an OpenAI-compatible chat-completions adapter over the dsh `ctx.llm` seam, so the Basis profile runs against the corporate liteLLM gateway (and any OpenAI-format provider) instead of a vendor API.

## Scope of the first cut

- Streaming text, `reasoning_content` passthrough, and streaming tool calls; token usage from `usage` (with `prompt_tokens_details.cached_tokens` mapped to cache reads).
- Messages map to the wire as: harness `system`/`developer` → `role:'system'` (merged in order), `user` → `role:'user'`, assistant `text`+`tool-call` blocks → `role:'assistant'` with `tool_calls`, durable `tool` results → `role:'tool'`.
- Not yet supported: images (user image blocks fail with `UNSUPPORTED_CONTENT`), native replay envelopes, adapter-owned image pricing.

## Configuration (the `llm` row of the Basis bundle)

- `baseURL` — chat-completions root, e.g. `http://<gateway>:4000/v1` (required; compose from `process.env.BASIS_LLM_BASE_URL` in the patch).
- `apiKeyEnv` — environment variable carrying the gateway key (default `DEEPSEEK_API_KEY`).
- `provider` — registered route id (default `deepseek-official`, matching the SDK's default agent route).
- `models` — wire model catalog (default `[{ id: 'deepseek-flash' }]`).
- `maxTokens`, `defaultContextWindow`, `streamIdleTimeoutMs` — operation defaults.

Key resolution reads the launching environment only; enterprise key rotation should move to a `ctx.credentials` lookup.
