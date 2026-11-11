# LLM Gateway 设计对照文档（zcode × pi-ai × 三家官方口径）

> 任务：T0.3 交付物（计划书《2026-11-10-llm-gateway与用量统计插件计划》§6）。
> 目的：为 `@eterna/llm-gateway` 网关设计固化「zcode 已解决 vs 查漏补缺」与三家官方文档要点，作为 T1.1–T1.6 的实现依据与 wire 级测试断言来源。
> 来源约定（每条断言后括注其一）：
> - **zcode**：`/Users/sunny/code/zcode-ref` 内相对路径+行号（只读参考仓，Apache-2.0，已逐行核实；未标行号的为整文件级引用）；
> - **官方**：三家官方 API 文档 URL（仅用计划书 §10 既有三个，见文末「来源 URL」）；
> - **pi-ai**：`/Users/sunny/code/deepseek-harness` 内 file:line（含 node_modules 里 `@earendil-works/pi-ai@1.3.0` dist 产物）；
> - **实测**：2026-11-10 生产事故取证（本仓部署链路真实故障，见 §5）。
> - 找不到出处的断言一律标「未定位」，不编造行号。

阅读指引：

- §1 回答「三家差什么、zcode 怎么做」——每格给出官方口径 + zcode 实现出处；
- §2 回答「哪些直接借鉴」——T1.1 网关骨架按此对照实现，注明来源路径即可合规复用思路；
- §3 回答「zcode 还缺什么」——12 条缺口已映射到 T1.1–T1.6 任务号，实现时逐条销号；
- §4 是本仓真实生产事故的取证与对策，为 T1.1 目录 schema 的硬约束来源；
- §5 是 T1.1 wire 级快照测试的断言清单，A1 三点为事故回归、必须最先固化。

## 1. 五维度对照表 × 三家

| 维度 | DeepSeek（deepseek-flash / deepseek-v4-pro） | MiMo（mimo-v2.6-pro/flash） | GLM（glm-5.3 / 5.3-flash / 5.2 等） |
|---|---|---|---|
| thinking 方言 | chat：`thinking:{type:enabled/disabled}` + `reasoning_effort`；anthropic：`thinking:{type}` + `output_config.effort`；responses：`reasoning:{effort}`，disabled→`none`（zcode `config/provider/zcode-builtin.json:3522-3543`、`:4549-4592`；官方 https://api-docs.deepseek.com/zh-cn/ ） | anthropic/chat：`thinking:{type:enabled/disabled}`；zcode 无 mimo-v2.6 chat 专属规则，落入通用 chat 规则（`thinking.type`+`enable_thinking`+`reasoning_effort`+`reasoning.effort` 四字段并发）（zcode `zcode-builtin.json:3424-3433`、`:2854-2867`；官方 https://mimo.mi.com/docs/zh-CN/quick-start/summary/welcome ） | anthropic：glm-5.3/5.3-flash **强制思考**（`thinking.type` 恒 `enabled`，不映射 disabled）、GLM-5.2 及以下按档位开关；chat 通用规则四字段并发（zcode `zcode-builtin.json:2940-2948`、`:2918-2927`、`:2854-2867`；官方 https://docs.bigmodel.cn/cn/guide/start/model-overview ） |
| usage 缓存拆分与四桶归一 | 响应字段 `prompt_cache_hit_tokens`/`prompt_cache_miss_tokens` + `prompt_tokens_details.cached_tokens` + `completion_tokens_details.reasoning_tokens`（官方 api-docs；计划书附录 A）。**zcode 无显式映射**（全仓 grep `prompt_cache_hit_tokens` 无结果，未定位），仅靠 AI SDK `inputTokenDetails` 归一（zcode `apps/zcode-cli/packages/adapters/src/model/runner-normalization.ts:16-40`） | `prompt_tokens_details.cached_tokens` + `reasoning_tokens` + `web_search_usage.{tool_usage,page_usage}`（官方 mimo.mi.com；计划书附录 A）；zcode 归一同上：cacheRead/cacheWrite/reasoning/serverToolUse 四桶 + `server_tool_use.web_search_requests`→webSearchRequests（zcode `runner-normalization.ts:16-40`） | `prompt_tokens_details.cached_tokens` + `completion_tokens_details.reasoning_tokens`（官方 docs.bigmodel.cn；计划书附录 A）；zcode 归一同上（zcode `runner-normalization.ts:16-40`） |
| 多模态块映射 | 仅 flash 图片（JPEG/PNG/GIF/WebP，base64/URL/file_id），无 PDF（官方 api-docs；计划书附录 A）；zcode 按 `modelMatch+baseUrlMatch` 门控 `inputFormat.supportsImage`（zcode `zcode-builtin.json:4594-4605`）；图片走 base64/URL data 块（zcode `apps/zcode-cli/packages/adapters/src/model/transform.ts:223-253,449-498`） | 图片 50MB / 音频 100MB / 视频 300MB（`video_url`+fps）；URL/base64 双通道，无 file_id（官方 mimo.mi.com；计划书附录 A）；zcode：video 统一转 `video_url`/video block，含 video 的 tool result 强制 textify 后置投影（zcode `transform.ts:474-498`、`:110-111,252-253`） | flash 支持图/视频/文件（file_id/URL/data ≤50MB，pdf/word/xlsx/pptx）；4.6V 三者不可混输（官方 docs.bigmodel.cn；计划书附录 A）；zcode 仅走 base64 data 通道，无 file_id/URL 文件三态（zcode `transform.ts:449-498`——即查漏补缺 #9 缺口的实锤） |
| 联网搜索协议 | chat 无内置联网；anthropic 有 `supportsNativeWebSearch`（zcode `zcode-builtin.json:4471-4481`）；Responses `web_search` 仅 pro；Search/Fetch API 计费 5 元/千次（官方 api-docs；计划书附录 A/T1.2） | 仅 chat 协议 tools 内置 `web_search`，需控制台开通 + 5 分钟生效延迟，16 元/千次（官方 mimo.mi.com；计划书附录 A/T1.3）；zcode 未接入该工具（未定位 zcode 有 MiMo web_search 规则） | anthropic 端 `supportsNativeWebSearch`（zcode `zcode-builtin.json:4505-4515`）；chat tools 内置 `web_search` 且 `search_engine` 必填，0.01~0.05 元/次；zcode 规避 BigModel 拒绝 named forced tool_choice 的 1210 错误（zcode `apps/zcode-cli/packages/core/src/tool/handlers/websearch.ts:77`、`docs/websearch-provider-domain-allowlist.md:9-12`） |
| 三协议端点与请求差异 | base_url `https://api.deepseek.com`（anthropic 走 `/anthropic`；responses 预设 baseUrl 门控 `api.deepseek.com`）；zcode deepseek 模板仅 anthropic 预设，chat/responses 由 baseUrl 规则装配（zcode `zcode-builtin.json:287-306`、`:4549-4605`）；`max_tokens` 字段为 DeepSeek 硬要求（pi-ai `openai-completions.js:1261-1278`） | base_url `https://api.xiaomimimo.com/v1`（anthropic 走 `/anthropic`）；Token Plan 另域 `token-plan-cn.xiaomimimo.com`，双模板分离（zcode `zcode-builtin.json:426-466`、`docs/provider-mimo-templates.md`） | base_url `https://open.bigmodel.cn/api/paas/v4`（chat）/ `/api/anthropic`（anthropic）/ `/api/v1/responses`（官方 docs.bigmodel.cn；计划书附录 A）；Coding Plan 与标准 API 双模板，Coding Plan 走 anthropic 端点（zcode `zcode-builtin.json:78-97`、`:100-144`） |

## 2. zcode 已解决清单（借鉴项逐条落 file:line）

1. **三协议批量装配 + thinking 方言声明式 map**：`(modelMatch, apiTypeMatch, baseUrlMatch)` 规则表驱动，`reasoningLevel` → 各协议请求字段的 map 以表达式内嵌于 `zcode-builtin.json`（zcode `zcode-builtin.json:2830-3598` 规则区、`:2840-2881` 三协议通用兜底规则；编译执行在 `apps/zcode-cli/packages/adapters/src/model/model-execution.ts:206-218` 与 `packages/model-option-map/src/`）。
2. **Option Map 作为请求字段唯一权威（fail-closed）**：fetch 包装层截获请求体、编译后 map 补丁 reasoning/max-output 字段；非文本 body 直接抛错防静默丢失（zcode `apps/zcode-cli/packages/adapters/src/model/model-option-map-fetch.ts:13-31,38-41`）。
3. **anthropic 端 thinking 签名回放/修复**：跨模型/跨 provider 签名兼容分组、签名拒绝（400 "signature in thinking block"）检测与无签名清理重试（zcode `apps/zcode-cli/packages/adapters/src/model/reasoning-history-normalization.ts:18-29,31-98,281-287`）。
4. **无签名 thinking 清理 + 历史结构归一**：只保留带签名/redacted 的 reasoning 块、孤儿 assistant 合并、尾部 reasoning 剥离、空 assistant 占位修复（zcode `reasoning-history-normalization.ts:48-68,151-231`）。
5. **anthropic SSE 兼容层**：请求体 system 串恢复（中段 system）+ 响应流 thinking 重写与 provider 内置工具 SSE 帧重写（zcode `apps/zcode-cli/packages/adapters/src/model/anthropic-stream-compat.ts:11-35`、`provider-builtin-tool-compat/`）。
6. **GLM-5.3 强制思考 map**：glm-5.3 系 `thinking.type` 恒 `enabled`，档位只进 `output_config.effort`（zcode `zcode-builtin.json:2940-2948`）。
7. **BigModel 业务码表**：1120/1230/1234/1261/1113/1302/1303/1305/3010 等显式分类 + retry-after 抖动策略，SSE message 前缀 `[1302][...]` 提取兜底（zcode `apps/zcode-cli/packages/adapters/src/model/failure-provider-business-codes.ts:20,137-209`；`docs/bigmodel-business-error-retry.md:9,33,44`）。
8. **web_search 1210 规避与流式兜底**：不设 named forced tool_choice，靠单工具请求 + prompt 触发；内部请求用 `generateText` 不做 streaming progress（zcode `apps/zcode-cli/packages/core/src/tool/handlers/websearch.ts:77`、`apps/zcode-cli/docs/design/v2/tool/13-websearch.md:75,187`）。
9. **联网按 baseURL hostname 白名单**：仅 providerKind=anthropic 且 host ∈ {bigmodel.cn, z.ai, deepseek.com} 及子域暴露原生 WebSearch，不看 provider id 或模型名（zcode `docs/websearch-provider-domain-allowlist.md:9-12`；门控字段 `supportsNativeWebSearch` 见 `websearch.ts:54` 与 `zcode-builtin.json:4471-4481,4505-4515`）。
10. **MiMo API / Token Plan 双模板**：`xiaomi-mimo`（api.xiaomimimo.com/anthropic，`sk-`）与 `xiaomi-mimo-token-plan`（token-plan-cn.xiaomimimo.com/anthropic，`tp-`/`ttp-`）分离，避免订阅 key 误填按量地址（zcode `zcode-builtin.json:426-466`、`docs/provider-mimo-templates.md`）。
11. **usage 统一四桶归一**：inputTokens/outputTokens/totalTokens + cacheReadTokens/cacheWriteTokens/reasoningTokens + serverToolUse{webFetchRequests,webSearchRequests}（zcode `apps/zcode-cli/packages/adapters/src/model/runner-normalization.ts:16-40`）。
12. **多模态 base64 链路**：image/video 块 → data URL/原始 data 投影，video 经 patch 后 SDK 转 `video_url`（zcode `apps/zcode-cli/packages/adapters/src/model/transform.ts:223-253,449-498`、`media-transform-policy.ts`）。
13. **按协议 max_tokens 预算收缩**：maxOutputTokens 按模型 spec 校验越界即拒（zcode `apps/zcode-cli/packages/adapters/src/model/model.ts:112-142`；spec 上限例 131072/65536 见 `zcode-builtin.json:2786-2788,2820-2826`），字段名按协议 map：anthropic=`max_tokens`、chat=`max_completion_tokens`、responses=`max_output_tokens`（zcode `zcode-builtin.json:2848-2878`）。
14. **wire 级测试范式**：真实 SDK 出请求、stub fetch 抓 body，断言 thinking/max_tokens/effort 字段逐协议逐档位（zcode `apps/zcode-cli/packages/adapters/tests/new-model-wire.test.ts:12-185`，含 deepseek-flash 三协议 × 4 档位矩阵 `:28-45`）。

## 3. 查漏补缺清单（官方口径 vs zcode 行为，12 条落任务号）

| # | 缺口 | 官方口径 | zcode 行为 | 任务 |
|---|---|---|---|---|
| 1 | DeepSeek chat 协议 `reasoning_content` 多轮回传 | 多轮带 tools 必须回传，否则 400（官方 api-docs；计划书 §7 风险已核实） | chat 路线不回传 reasoning_content（未定位 zcode 有回传逻辑；`reasoning-history-normalization.ts` 仅 anthropic 签名回放） | T1.2 |
| 2 | DeepSeek `prompt_cache_hit/miss_tokens` 显式映射四桶 | 响应含 hit/miss 两字段（官方 api-docs） | 全仓 grep `prompt_cache_hit_tokens` 无结果（未定位），仅依赖 AI SDK `inputTokenDetails`（zcode `runner-normalization.ts:28-29`） | T1.2 |
| 3 | DeepSeek Search/Fetch API 与 Responses `web_search`（仅 pro） | chat 无内置联网；Responses web_search 仅 pro，5 元/千次（官方 api-docs） | 仅 anthropic 端开 `supportsNativeWebSearch`（zcode `zcode-builtin.json:4471-4481`），Search/Fetch API 未接（未定位） | T1.6 |
| 4 | MiMo `web_search`（chat tools 内置） | chat 协议 tools 内置，16 元/千次，需控制台开通+5min 延迟（官方 mimo.mi.com） | 未定位 zcode 有 MiMo web_search 接入 | T1.3/T1.6 |
| 5 | MiMo 音频/URL 直传 | 音频 100MB（`input_audio`）、URL 通道（官方 mimo.mi.com） | zcode 仅 base64 data 通道（zcode `transform.ts:449-498`）；音频未接（未定位） | T1.3 |
| 6 | MiMo thinking 默认开语义 | V2.6 默认开（官方 mimo.mi.com） | zcode mimo-v2.6 档位仅 disabled/enabled 两态，无「默认开」声明（zcode `zcode-builtin.json:3424-3433`） | T1.3 |
| 7 | GLM `clear_thinking` 保留式思考 | `clear_thinking:false` 时思考原样回传（官方 docs.bigmodel.cn） | 未定位 zcode 有 clear_thinking 映射 | T1.4 |
| 8 | GLM `web_search.search_engine` 参数 | tools 内置 web_search 且 `search_engine` 必填（官方 docs.bigmodel.cn） | 未定位 zcode 传该参数（`websearch.ts` 走 anthropic `web_search_20260209` 原型） | T1.4 |
| 9 | GLM 文件三态 file_id/file_url/file_data | flash 文件输入支持三种传法 ≤50MB（官方 docs.bigmodel.cn） | zcode 仅 base64 data 通道（zcode `transform.ts:449-498`） | T1.4 |
| 10 | `max_tokens` vs `max_completion_tokens` 字段名 | DeepSeek 读 `max_tokens`（官方 api-docs；pi-ai `openai-completions.js:1261-1278`） | zcode chat 通用规则恒发 `max_completion_tokens`（zcode `zcode-builtin.json:2862-2864`），对 DeepSeek 直连 chat 是错配 | T1.1 |
| 11 | 定价字段 | 三家属地计费不同（官方三站） | — | **不做**（纯 token 口径，范围外；仅 UI 计费提示，T1.6） |
| 12 | reasoning 档位取值逐字核对 | 各家取值集不同（none/low/high/max vs disabled/enabled，官方三站） | zcode 各模型 `values` 声明分散在规则表（如 `zcode-builtin.json:2820-2822`、`:2888`） | T1.1 |

## 4. 实测差异（2026-11-10 生产事故取证）

**全链还原（developer 角色 422 事故）**：

1. 本仓 `llm-pi-ai` 经 LiteLLM 内网 baseUrl 中转 DeepSeek，模型 `deepseek-flash`。pi-ai 的供应商识别是字符串门控：`isDeepSeek = provider === "deepseek" || baseUrl.toLowerCase().includes("deepseek.com")`（pi-ai `dist/api/openai-completions.js:1246`）——内网网关域名不含 `deepseek.com`，识别失效，`isDeepSeek=false`。
2. 失效连锁一：`isNonStandard=false` → `supportsDeveloperRole` 走默认 true（pi-ai `openai-completions.js:1274`）；模型被配成 reasoning 后，`instructionRole = model.reasoning && compat.supportsDeveloperRole ? "developer" : "system"`（pi-ai `openai-completions.js:905`）→ **系统提示词以 `developer` 角色发出**。
3. 该请求上游由 NAS 网关把 deepseek-flash 临时路由到 `xiaomi_mimo/mimo-v2.6-flash`；mimo serde 只认 system/user/assistant/tool/latest_reminder 角色，收到 `developer` 直接 **422**。
4. 失效连锁二：`useMaxTokens` 同为 isDeepSeek 门控（pi-ai `openai-completions.js:1261-1268`）→ `maxTokensField` 判成 `max_completion_tokens` 而非 DeepSeek 要求的 `max_tokens`（`:1278`）。
5. 失效连锁三：`requiresReasoningContentOnAssistantMessages: isDeepSeek`（`:1282`）判成 false → 多轮带工具不回传 reasoning_content，与 DeepSeek 官方硬性要求相悖（官方 api-docs）。

**网关设计对策（T1.1 落地约束）**：

- **供应商识别不得依赖 baseUrl 字符串**。网关模型目录对每个模型**显式声明 compat 三件套**：
  1. `systemRoleEnforced`——chat 协议系统提示词恒用 `system` 角色，禁止 `developer`（除非目录显式允许）；
  2. `maxTokensField`——按模型声明（DeepSeek=`max_tokens`），不按 baseUrl 推导；
  3. `reasoningContentPassback`——多轮带 tools 的回传策略按模型显式声明（DeepSeek/MiMo=必须回传）。
- 换言之：pi-ai 的「探测 + compat 覆盖」双轨收敛为「目录即真相」单轨，探测逻辑只允许作为目录缺省时的告警而非静默回退；这与 zcode 的 Option Map fail-closed 哲学一致（zcode `model-option-map-fetch.ts:38-41`：字段权威缺失宁可抛错不可静默丢字段）。

## 5. wire 测试断言清单（P2 快照必须固化，≥15 条）

**A1 三点（本事故回归，最高优先）**：

1. chat 协议：系统提示词恒以 `system` 角色发出，任何模型/任何 baseUrl 下请求体不出现 `"role":"developer"`（实测）。
2. chat 协议：DeepSeek 请求体字段名为 `max_tokens`，不含 `max_completion_tokens`（pi-ai `openai-completions.js:1261-1278` 反例；zcode `zcode-builtin.json:2862-2864` 反例）。
3. chat 协议：多轮带 tools 时 assistant 消息回传 `reasoning_content`（官方 api-docs；计划书 §7 已核实不回传 400）。

**thinking 方言（4–8）**：

4. anthropic：`reasoningLevel=disabled` → `{"thinking":{"type":"disabled"}}`，其余 → `enabled`/`adaptive` 按模型规则（zcode `new-model-wire.test.ts:154-170` 同型断言；`zcode-builtin.json:2840-2852`）。
5. anthropic：非 disabled 档位输出 `output_config.effort`，`enabled`→`high`（zcode `zcode-builtin.json:2846`）。
6. chat：`reasoning_effort` 档位直传，`disabled`→`none` 或省略（zcode `zcode-builtin.json:2860`）。
7. responses：`reasoning.effort`，`disabled`→`none`（zcode `zcode-builtin.json:2874,4559`）。
8. glm-5.3/5.3-flash：`thinking.type` 恒 `enabled`，disabled 档不产出 `{"thinking":{"type":"disabled"}}`（zcode `zcode-builtin.json:2940-2948`）。

**usage 归一（9–11）**：

9. 四桶对账：`prompt_cache_hit_tokens`→cacheReadTokens、hit+miss 合计入 inputTokens、`completion_tokens_details.reasoning_tokens`→reasoningTokens、`prompt_tokens_details.cached_tokens`→cacheReadTokens（官方 api-docs/mimo.mi.com/docs.bigmodel.cn；归一目标参照 zcode `runner-normalization.ts:16-40`）。
10. `server_tool_use.web_search_requests` → serverToolUse.webSearchRequests（zcode `runner-normalization.ts:21-38`）。
11. MiMo `web_search_usage.{tool_usage,page_usage}` 入账不丢（官方 mimo.mi.com；T1.3 验收口径）。

**多模态与联网（12–14）**：

12. 图片请求体：URL 与 base64 两通道各一快照（DeepSeek 仅 flash 可图片，zcode `zcode-builtin.json:4594-4605`；官方 mimo.mi.com 视频走 `video_url`）。
13. 联网注入：`web_search` 工具在 tools 数组且 tool_choice 非 named forced（1210 规避，zcode `websearch.ts:77`）。
14. 非 anthropic 白名单域不开原生 WebSearch（zcode `docs/websearch-provider-domain-allowlist.md:9-12` 同型门控）。

**流式与历史（15–17）**：

15. 流式顺序：reasoning delta 全部先于 content delta（官方 api-docs「delta 前置于 content」；计划书 T1.2 验收标准）。
16. anthropic 签名拒绝修复：400 "signature in thinking block" 触发无签名 thinking 清理后重试（zcode `reasoning-history-normalization.ts:82-98`）。
17. 跨模型切换清理无签名 reasoning 块（zcode `reasoning-history-normalization.ts:100-116` 同型行为）。

**结构化输出与预算（18–19）**：

18. responses 协议：DeepSeek 三模型 `json_schema` 输出开关仅对 `api.deepseek.com` 域生效，chat 协议不产出 json_schema（官方 api-docs「json_schema 仅 responses」；zcode `zcode-builtin.json:4549-4592`）。
19. `maxOutputTokens` 超模型 spec 上限（如 mimo 131072 / mimo-v2-flash 65536）直接拒绝请求而非静默截断（zcode `model.ts:112-142` fail-fast 同型行为；spec 见 `zcode-builtin.json:2786-2788,2819-2826`）。

## 6. 来源 URL（仅计划书 §10 既有三个）

- DeepSeek：https://api-docs.deepseek.com/zh-cn/
- MiMo：https://mimo.mi.com/docs/zh-CN/quick-start/summary/welcome
- GLM：https://docs.bigmodel.cn/cn/guide/start/model-overview
