# T23 B10 llm-openai 回归审计（rc.5 / WP3-4）

- 工作树：`/Users/sunny/code/agent-basis-rc5`，分支 `feat/dsh-rc5-merge`
- 来源：54 §4.5 T23（`adapter 类型/错误码回归；typecheck`）、50 §2 WP3-4（`packages/llm-openai`，typecheck 绿）、47 §B10（泛型/内置码表/接口新增字段/门禁补位）
- 改动范围：仅 `packages/llm-openai/src/adapter.ts`、`packages/llm-openai/tests/adapter.spec.ts`
- 凭据：测试仅用假值 `Bearer test`；未读取/写入任何真实 key，命令与日志不含凭据

## 1. LlmError 内置失败码 / HTTP 状态映射

rc.5 契约：
- `LlmError` 构造签名只收 `BuiltinLlmFailureCode`（`@deepseek-ai/dsh-llm/lib/types/index.d.ts:75`）。
- `BuiltinLlmFailureCode = keyof LLM_FAILURE_CODES | `HTTP_${number}``（`.../lib/types/error.d.ts:86`）。
- 默认重试码：`EMPTY_RESPONSE, RATE_LIMIT, SERVER, TIMEOUT, TRANSPORT`（`.../lib/types/retry-policy.js:21-26`）。

起点状态（worktree 未提交改动）：所有非 2xx 一律 `HTTP_<status>`；虽然类型合法，但 429/5xx 不在默认重试码表内，`llm-retry` 不会重试网关瞬时失败。P1 遗留的 `HTTP_${String(status)}` 会退化为 `HTTP_${string}`（TS2345）；worktree 起始已把它改为数值插值（本次复核保留并在注释说明）。

改动后（`src/adapter.ts:23-66`，分类器 `src/adapter.ts:57-66`），与上游 `packages/llm/llm-deepseek/src/transport.ts:22-35` 的 `providerError` 同序：

| 条件 | 失败码 |
|---|---|
| 401/403 或 `type=authentication_error|permission_error` | `AUTH` |
| 402 或 `isQuotaExceededError(detail)` | `QUOTA` |
| 429 或 `type=rate_limit_error` | `RATE_LIMIT` |
| `isContextWindowExceededError(detail)` | `CONTEXT_WINDOW_EXCEEDED` |
| 400/413 或 `type=invalid_request_error` | `INVALID_REQUEST` |
| >=500 或 `type=api_error|overloaded_error` | `SERVER` |
| 其余状态 | `HTTP_<status>`（数值模板，`src/adapter.ts:66`） |

- 错误体按 OpenAI error envelope 提取 `type/code/message`（`src/adapter.ts:30-45`）；非 JSON 体回退原文做措辞匹配。
- `status` 同时写入 `LlmErrorOptions`，保留在 `failure.status`（`src/adapter.ts:152-156`）；message 仍截断 400 字符，`cause` 保留完整 body。
- 空 body（200 且 `response.body === null`）→ `EMPTY_RESPONSE`（`src/adapter.ts:158`）。
- 影响面（源码实读）：`packages/compaction/src/basic/index.ts:410` 仅在 `CONTEXT_WINDOW_EXCEEDED` 时进入溢出自动压缩（此前 400 上下文超限落 `HTTP_400` 不会触发）；`llm-retry` 默认码表见上，429/5xx 此前落在码表外。
- 流内/鉴权处抛出的 `LlmError` 原样透传；其余异常 → `TRANSPORT`（`src/adapter.ts:121-125`）。
- SSE `data:` 帧 JSON 解析失败 → `MALFORMED_RESPONSE`（`src/adapter.ts:180-184`），与 `translate` 的帧级错误码一致；此前会落入 `TRANSPORT`。

## 2. GenerateOptions 泛型

- `stream`/`generate` 均为 `GenerateOptions<string>`（`src/adapter.ts:105`、`:109`），`serialize` 同签名（`src/serialize.ts:99`）。
- rc.5 契约：`GenerateOptions<Purpose extends string = LlmRequestPurpose>`，注释明确 “forwarding adapters may accept `string`”（`@deepseek-ai/dsh-llm/lib/types/types.d.ts:536-538`）；基类 `abstract stream(options: GenerateOptions)`（`.../lib/types/index.d.ts:207`），`LlmRequestPurposeMap` 由 compaction-basic/session-title-llm 等包做模块增强（`.../dsh-compaction-basic/lib/types/types.d.ts:7-10`）。
- 回归测试 `tests/adapter.spec.ts:217-220` 用 `Parameters<BasisOpenAIAdapter['stream']>[0]['purpose']` 赋任意字符串，编译期锁定“转发适配器接受 string purpose”。
- `prepareCall` 返回的 `stream` 闭包接收基类 `GenerateOptions` 并交给 `generate`（`src/adapter.ts:99-102`），typecheck 通过。
- rc.5 接口新增字段核查：`LlmAdapter` 仅 `stream` 为 abstract，`listModels/resolveModel/prepareCall/providerInfo` 均有基类默认实现（`.../lib/types/index.d.ts:141-207`）；本适配器覆盖的 4 个方法签名匹配，无必填新增字段缺失。

## 3. 超时

- `idleWatchdog(signal, connection.streamIdleTimeoutMs, 'BASIS_OPENAI_IDLE')`（`src/adapter.ts:113`），与上游 `dsh-llm-deepseek` 的 `MESSAGES_IDLE` 用法同构（`node_modules/.pnpm/@deepseek-ai+dsh-llm-deepseek@0.2.2-rc.5.../lib/index.js:2219-2234`）。
- 超时判定 `timeoutOf(watchdog.signal, 'BASIS_OPENAI_IDLE')` → `TIMEOUT`（`src/adapter.ts:122`）；调用方 signal 已中止 → `ABORTED`（`:123`）；`finally` 中止 consumer 并不等待 `iterator.return`（`:126-129`），避免悬挂。
- 回归测试：`tests/adapter.spec.ts:177-187`（25ms 空闲流 → `TIMEOUT`，cause.code=`BASIS_OPENAI_IDLE`，耗时 ≥20ms）、`:171-175`（预中止 → `ABORTED`）。

## 4. 断言结果

- `pnpm --filter @eterna/llm-openai typecheck` → EXIT 0（`typecheck.log`）。
- `pnpm --filter @eterna/llm-openai test` → 3 文件 / 37 测试全过，EXIT 0（`test.log`）。
- `./node_modules/.bin/vitest run --reporter=verbose` → 37 个 ✓（`test-verbose.log`），其中 `tests/adapter.spec.ts` 23 条覆盖 10 个状态码映射、type 优先分类、quota/context 措辞、EMPTY_RESPONSE、TRANSPORT、MALFORMED_RESPONSE（SSE JSON）、LlmError 透传×2、ABORTED、TIMEOUT、成功流与请求头/请求体。
- `pnpm exec oxlint packages/llm-openai/src packages/llm-openai/tests` → 0 warnings / 0 errors，EXIT 0（`lint.log`，附加检查）。
- 未跑：真网关真模型一轮（47 §B10 第 5 项；需外部凭据/网关，属部署期门禁）；`smoke-embed.mjs`。