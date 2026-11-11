# 可执行计划书：LLM Gateway 模型插件 与 用量统计插件

> 生成：2026-11-10 18:06 ｜ 状态：待执行 ｜ worktree：`../agent-basis-llm-gateway`（分支 `feat/llm-gateway-usage`，基于 `origin/main`）

## 1. 一句话目标

把模型插件升级为**进程内轻量 LLM Gateway**（去掉 LiteLLM 外部依赖，会话内可选所有已接入模型，定制适配 deepseek / mimo / glm 三家 + 通用配置兜底），并新增**用量统计插件**（main 面板仪表盘：7/30 天、按天/周/小时/模型的 token 用量、缓存命中率、热力图/趋势图/环图）。

成功标准：部署不再需要 LiteLLM 服务，三家模型在会话内可选可用（含思考、多模态、联网开关），统计面板真实反映会话日志中的 usage 数据（深浅两主题截图过审）。

## 2. 背景

- **现状**：模型接入经外部 LiteLLM 网关（NAS 上的 OpenAI 兼容归一服务），耦合面 = `LITELLM_API_KEY` / `ETERNA_LLM_BASE_URL` 两个 env + `llm-pi-ai` 配置的 provider key `litellm`（`docker-compose.yml:27-28`、`docker/profile/cordis.patch.yml.template:453-457`）。LiteLLM 归一了协议但也**抹掉了三家差异能力**（thinking 方言、reasoning_content、缓存 usage 拆分、原生联网、多模态细节）。
- **触发因素**：① 希望产品自带模型接入能力（轻量 LLM Gateway），对 deepseek/mimo/glm 做定制适配、其余供应商走通用配置；② 需要用户可见的用量统计（参考 zcode / claude code / codex 的成熟形态）。
- **数据基础**：每次回复的 `usage` 已随会话事件落盘 `$DSH_HOME/sessions/**/session.v4.jsonl.zstd`（`assistant/message` 事件 `data.usage`），统计插件只需聚合，无需新增采集（`packages/panel/src/session-logs.ts:88-120`、`packages/observe/src/metrics.ts` 为现成口径先例）。
- **参考实现**：`zai-org/ZCode`（Apache-2.0，本地只读参考 `/Users/sunny/code/zcode-ref`）已有三家适配的成熟 wire 级实现，**借鉴其逻辑、结合三家官方文档查漏补缺**，不从零开发。

## 3. 访谈结论（已确认决策）

| 维度 | 结论 |
| --- | --- |
| 目标 | 见 §1；两个插件均为 L1 通用插件（`packages/<name>`，`@eterna/*`） |
| 网关形态 | **进程内适配器插件**（`@eterna/llm-gateway`），走内核 `ctx.llm` seam（`registerConfigurableProviders` + `registerAdapter`），不起独立 HTTP 网关 |
| 配置面 | **pi-ai 的逻辑并入网关作为通用模型配置基座**（providers 节 schema：`displayName/apiKeyEnv/api/baseURL/models` + 三协议），三家定制基于该基座改造，不重复造轮子；配置 UI = 网关自带 `settings.section` 分区 |
| 适配参考 | **借鉴 zcode（zai-org/ZCode，Apache-2.0）三家适配逻辑**，对照官方文档查漏补缺（缺口清单见 §6 任务 T1.2–T1.4） |
| 联网搜索 | **供应商原生 web_search 可选（provider 级开关，默认关）+ 现有 tool-web 兜底**；三家属地计费差异写入 UI 提示 |
| 统计 UI 落点 | **`main` keyed 面板 + `sidebar.panellist` 入口**（packages/panel 先例同构，合规 dsh 原生扩展点） |
| 统计范围 | **本人为主 + 管理员全局**（普通用户只看自己工作区；admin 可切全局/按用户视图，端点在 access 守卫清单登记） |
| 统计口径 | **纯 token，不做费用估算**（总 token、缓存命中率、时长、天数等；无价目维护负担） |
| 图表库 | **ECharts**（热力图/折线/环图原生支持，入 pnpm catalog 钉版，`echarts/core` 按需引入控制体积） |
| 凭据来源 | 三家直连 key **从本地 LiteLLM 配置提取**（`/Users/sunny/code/litellm/proxy_server_config.yaml` 已配置），落 `.secrets/`（gitignored，绝不入 git/日志/argv） |
| 交付组织 | **单 worktree 分两里程碑**：M1 网关 → M2 统计，每里程碑独立可验收 |
| 开发位置 | 基于远程 main 建 worktree：`/Users/sunny/code/agent-basis-llm-gateway`，分支 `feat/llm-gateway-usage` |

## 4. 待定项与默认假设

| 待定项 | 默认假设 | 再确认时机 / 负责人 |
| --- | --- | --- |
| zcode 借鉴的代码合规 | Apache-2.0 允许改写复用；**借鉴实现思路+自行改写，不整文件照抄**，关键算法注明来源 | T1.1 设计评审时 / 开发者自查 |
| 「按小时」统计形态 | 近 7/30 天按小时聚合的分布（柱状/折线），非 24h 平均 | M2 UI 评审 |
| 热力图形态 | 按截图做「Token 活动」年度日历热力图 + 每日/每周/累计切换 | M2 UI 评审 |
| MiMo 联网前置 | 文档化提示（需控制台开通插件 + 5 分钟生效延迟），不做代码层等待 | T1.3 验收时 |
| DeepSeek 联网协议 | chat/completions 无内置联网 → 原生 web_search 仅在 anthropic/responses 协议注入（仅 pro）；chat 场景走 tool-web | T1.2 验收时 |
| GLM `clear_thinking` 保留式思考 | 默认不开启（standard API 默认关），provider 配置可留高级开关 | T1.4 设计评审 |
| 「个人套餐」页签（截图中） | **不在范围**（无套餐概念，只做「应用用量」形态的统计面板） | 需求变更时 |
| LiteLLM 服务本体 | 产品侧全量退场（env/compose/docs/scripts 引用清理）；NAS 上的服务实例是否关停由用户自行决定 | M1 收尾时 / 用户 |

## 5. 范围

- **做**：
  - `@eterna/llm-gateway`：pi-ai 配置基座并入（通用 provider 配置 + 三协议 openai-completions/openai-responses/anthropic-messages）、deepseek/mimo/glm 三家定制 serializer/translator（thinking、reasoning_content、多模态、usage 归一）、通用供应商配置、供应商原生 web_search 可选开关、settings.section 配置分区 UI、会话模型目录贯通、llm-doctor 兼容、LiteLLM 引用全量退场。
  - `@eterna/usage-stats`：会话日志 usage 聚合服务 + main 面板仪表盘（ECharts：热力图/每日趋势/模型环图；7/30 天；按天/周/小时/模型；总 token、缓存命中率、连续天数等总览卡）+ 管理员全局视图。
- **不做**：费用/成本估算与价目表；「个人套餐」页签；独立 HTTP 对外网关；会话内模型选择器 UI 重做（复用上游 `dsh-client-ui-model-selection`）；DeepSeek Files API/文档输入（官方不支持 PDF）；音频输入链路（MiMo 有此能力但产品附件链不提供，留待后续）；历史数据回填工具（统计从上线日起算，历史会话日志一次性扫描即可覆盖）。

## 6. 任务分解

### M0：准备（半天）

| # | 任务 | 依赖 | 产出 | 验收标准 |
| --- | --- | --- | --- | --- |
| T0.1 | 创建 worktree：`git fetch origin && git worktree add ../agent-basis-llm-gateway -b feat/llm-gateway-usage origin/main` | — | worktree 就绪 | `git -C ../agent-basis-llm-gateway log -1` == `origin/main` |
| T0.2 | 从 `/Users/sunny/code/litellm/proxy_server_config.yaml` 提取三家 API key，落 `.secrets/deepseek-api-key.txt`、`.secrets/mimo-api-key.txt`、`.secrets/glm-api-key.txt`（权限 0600） | — | 凭据文件 | 三家 key 各自 curl `/models` 或最小补全成功；`.secrets/` 在 gitignore 内；key 不出现在任何被跟踪文件/日志 |
| T0.3 | 固化 zcode 对照文档 `docs/dev/llm-gateway-zcode对照.md`：「zcode 已解决清单 vs 查漏补缺清单」（见 T1.2–T1.4 缺口）+ 三家官方文档要点表 | — | 设计对照文档 | 覆盖三家 thinking/usage/多模态/联网/协议差异五个维度，逐条标注来源 URL 或 zcode 文件路径 |

### M1：LLM Gateway 模型插件

| # | 任务 | 依赖 | 产出 | 验收标准 |
| --- | --- | --- | --- | --- |
| T1.1 | 网关骨架 + pi-ai 基座并入：`packages/llm-gateway`（`@eterna/llm-gateway`），实现 `LlmAdapter`（`providerInfo/listModels/resolveModel/prepareCall/stream`），配置 schema 承袭 pi-ai providers 节（`displayName/apiKeyEnv/api/baseURL/models[{id,name,contextWindow,maxTokens,inputModalities,reasoningEfforts}]`），api key 只按 `apiKeyEnv` 从启动环境读（`packages/llm-openai/src/index.ts:16-25` 模式）；三协议端点拼接参照 `packages/llm-doctor/src/doctor.ts:16-20` | T0.3 | 网关包 + schema | `pnpm -w run verify` 过；vitest：三协议序列化快照（wire 级，参照 zcode `new-model-wire.test.ts` 思路）；插件经 loader 冒烟装载 |
| T1.2 | DeepSeek 定制：`thinking:{type}` + `reasoning_effort`（chat）/`output_config.effort`（anthropic）/`reasoning.effort`（responses）；**reasoning_content 多轮回传策略按协议分支**（anthropic 走 thinking 块签名回放；chat 协议带 tools 多轮回传 reasoning_content——官方硬性要求，对照 zcode「不回传」做法修正）；usage 归一到内核四桶（`prompt_cache_hit_tokens`→cacheReadTokens、miss+hit→inputTokens、`reasoning_tokens`→reasoningTokens）；图片输入（仅 flash）；原生 web_search（仅 anthropic/responses+pro，Search/Fetch API 备选）；`max_tokens` 字段名核对 | T1.1 | DeepSeek provider 适配 + 测试 | 真连验收：多轮带工具不 400；流式 reasoning→content 顺序正确；usage 四桶与 DeepSeek 响应字段对账一致；flash 图片问答成功 |
| T1.3 | MiMo 定制：`thinking:{type}`（默认开语义——V2.6 默认开，网关目录默认 enabled）；reasoning_content 回传；多模态 image_url/video_url/input_audio 映射（URL/base64 双通道）；web_search（chat 协议 tools 内置工具，控制台开通前置+5min 延迟写入 UI 提示）；usage 归一（`cached_tokens`→cacheRead、`reasoning_tokens`→reasoning、`web_search_usage` 记账）；API/Token Plan 双 base_url 预设（zcode `provider-mimo-templates.md` 同构） | T1.1 | MiMo provider 适配 + 测试 | 真连验收：思考流+回答流顺序正确；图片/视频各一例成功；web_search 开关两态行为正确；多轮带工具不 400 |
| T1.4 | GLM 定制：`thinking:{type}` + `reasoning_effort` 档位映射（GLM-5.3/5.3-Flash **强制思考不可关**）；`clear_thinking` 保留式思考留高级开关（默认关）；web_search 工具（`search_engine` 必填参数补齐——zcode 缺口）；文件三态 file_id/file_url/file_data 映射（zcode 仅 base64，补齐 URL 与 file_id）；`prompt_tokens_details.cached_tokens` 归一；Codex Plan key 仅 chat 协议的限制写入配置 UI 提示 | T1.1 | GLM provider 适配 + 测试 | 真连验收：5.3 强制思考生效；web_search 返回 `web_search[]` 来源且 usage 正确；PDF 文件输入（file_data）一例成功 |
| T1.5 | 通用供应商配置：不在定制列表的供应商走通用 openai-compatible 配置（base_url/api_key_env/协议/模型目录手动维护 + `/models` 发现兜底）；能力字段（多模态/effort）手填 | T1.1 | 通用配置路径 | 配置一个非三家供应商（或 mock baseURL）能出会话可选模型并完成对话 |
| T1.6 | 联网能力接线：provider 级 `nativeWebSearch` 开关（默认关）+ 现有 tool-web 兜底；三家属地计费差异（5 元/千次、16 元/千次、0.01~0.05 元/次）在开关旁中文提示 | T1.2–T1.4 | 联网开关 | 开关两态真连验证；默认路径仍是 tool-web；UI 提示文案中文 |
| T1.7 | 网关 settings.section 配置分区 UI：三家预设卡（key/baseURL/协议/模型目录/联网开关/高级选项）+ 通用供应商增删改；资料合并保存（脏检查+单按钮）、防重复点击、`no-store`、语义令牌 `--dsw-alias-*` | T1.5 | 设置分区 UI | 深浅两主题截图；保存热生效（`loader/volatile-update` 链路）；改 key/baseURL 后 llm-doctor 复检通过 |
| T1.8 | 会话模型选择贯通 + 诊断：模型目录按 displayName 分组进上游模型选择器；`llm-doctor` 看护行适配（若承载行 ns 变化，处理 `llm-pi-ai` 看护映射，`docs/eterna-plugin-mapping.md:90-91`） | T1.2–T1.7 | — | 会话内三家模型全部可选可对话；llm-doctor 探测/ping 全绿 |
| T1.9 | LiteLLM 退场：替换 `docker-compose.yml`/`.env.example`/`deploy/env.production.example`/`docker/entrypoint.sh`/`docker/profile/cordis.patch.yml.template`/`profiles/eterna-embed/cordis.patch.yml` 的 litellm 引用为三家 `apiKeyEnv` 直连；scripts（`t7-*`/`perf-realsession`/`smoke-embed`/`verify-governance-e2e`/`sample-notifications`）与 `tools/evals` 凭据源改造；docs（README/USER-GUIDE/docker-deploy/embed-profile/eterna-web-profile）叙述更新 | T1.8 | 配置/脚本/文档全量更新 | 全仓 `rg -i litellm` 仅剩历史计划文档与本计划书；部署冒烟（embed 档 + web 档）不依赖 LiteLLM 服务跑通 |

### M2：用量统计插件

| # | 任务 | 依赖 | 产出 | 验收标准 |
| --- | --- | --- | --- | --- |
| T2.1 | 聚合服务：`packages/usage-stats`（`@eterna/usage-stats`），Host 半边 Typert 网关 SRC 端点（panel 先例，`README.md:20-33`）；读 `$DSH_HOME/sessions/**/session.v4.jsonl.zstd`（zstd 多帧解码沿用 `session-logs.ts:1-77`），口径复用 `observe/aggregateSessionMetrics`（互斥四桶/缓存命中率/轮数）；派生数据持久化在 `$DSH_HOME` 语义下（T1 铁律，`join(process.cwd(), '.eterna')` 先例）；增量聚合（会话日志 mtime 增量扫描，避免每次全量解压） | — | 聚合服务 + 端点 | vitest：对固定日志样本的聚合快照（总览/按天/周/小时/模型五视图）；租户归属过滤（只返回本人工作区数据）；冷启动对存量日志一次性扫描完成 |
| T2.2 | ECharts 引入：入 `pnpm-workspace.yaml` catalog 钉版；`echarts/core` + 按需图表（heatmap/line/pie）控制 client bundle 体积；esbuild 外置清单核对（`packages/access/scripts/build-client.mjs` 模式） | — | 图表依赖就绪 | client bundle 体积报告（对比引入前后）；深浅主题各出一张单图 demo |
| T2.3 | 仪表盘 UI：注册 `main` keyed 面板 + `sidebar.panellist` 入口（`packages/panel/src/client/index.ts:71-97` 模式，面板 id `eterna-usage-stats`）；区块 = 总览卡（累计/峰值 Token、最长会话时长、当前/最长连续天数、缓存命中率）+ Token 活动热力图（每日/每周/累计切换）+ 时间范围（近 7 日/近 30 日）+ 每日 Token 趋势图（按模型多系列）+ 模型用量环图（占比%）；颗粒度切换：按天/按周/按小时/按模型；全部文字中文、`--dsw-alias-*` 令牌、640/760px 断点、`prefers-reduced-motion`、focus 光圈 | T2.1, T2.2 | 面板 UI | 深浅两主题截图（PR 附件，AGENTS.md 要求）；空数据态（无会话）不破版；7/30 天切换数据正确 |
| T2.4 | 管理员全局视图：admin 可切「全局/按用户」视图（`/access/api/me` 角色判定，`packages/access/src/client/index.ts:75-80` 模式）；数据端点在 `packages/access/src/tenant.ts` 守卫清单登记（归属校验+直调+记账）；普通用户越权请求被拒 | T2.3 | admin 视图 | admin/普通用户两角色 e2e：admin 见全局聚合与按用户明细，普通用户只见自己；越权 403/空数据 |
| T2.5 | 收尾：`packctl tenant-scan` 过（T1/T2/T3 铁律）；`TOGGLEABLE_PLUGINS` 登记（`packages/access/src/routes.ts:47-53`）；`pnpm -w run verify` 过；docs（PLUGIN-AUTHORING 插件清单、USER-GUIDE 使用说明）更新 | T2.4 | 登记 + 文档 | tenant-scan 无告警；admin 停用插件后重启可缺席；README/docs 数字全部实测可追溯 |

## 7. 风险与对策

| 风险 | 影响 | 对策 |
| --- | --- | --- |
| zcode 代码借鉴的许可合规 | 法务/审查风险 | Apache-2.0 允许复用但需保留声明；**自行改写实现、不整文件照抄**，对照文档标注来源路径；必要时在 NOTICE 标注参考 |
| 三家文档与实际行为不一致（如 GLM 缓存折扣文档自相矛盾、MiMo `stream_options` 未列） | 适配返工 | 真连验收以实测为准；差异记入 `docs/dev/llm-gateway-zcode对照.md`「实测差异」节；发现即修 |
| DeepSeek reasoning_content 回传策略与 zcode 相反（官方要求带 tools 多轮回传，zcode chat 路线不回传） | 多轮带工具 400 | T1.2 以官方文档为准（已核实：不回传会 400），wire 级测试固化该行为 |
| 上游设置页模型编辑器只认 `llm-pi-ai`/`llm-deepseek` ns（`ProviderEditor.tsx` layoutOf） | 网关配置 UI 不可用或双配置面 | 网关自写 settings.section 分区（T1.7），承载行 ns 映射在 T1.8 处理；不做双配置面 |
| LiteLLM 退场后脚本/评测断链 | CI/评测失败 | T1.9 列全脚本清单逐一改造（调研已列 8 处 scripts + tools/evals）；`.secrets/litellm-*` 保留至 M1 验收后清理 |
| ECharts 体积拖累 client bundle | 面板加载慢 | `echarts/core` 按需引入 + catalog 钉版；T2.2 出体积报告，超预期则砍交互特性 |
| MiMo web_search 开通前置（控制台+5min 延迟）/DeepSeek 联网仅 pro | 联网验收卡壳 | UI 提示前置条件；验收协议里注明「联网用例允许跳过+标注原因」 |
| 会话日志增长导致统计扫描慢 | 面板卡顿 | T2.1 增量聚合 + 派生缓存（DSH_HOME 语义下）；冷启动一次性扫描放后台 |

## 8. 验证方式

1. **wire 级单测**（vitest）：三家序列化/翻译快照（thinking 字段、reasoning_content 回传、多模态块、usage 归一），参照 zcode `new-model-wire.test.ts` 思路但用本仓断言。
2. **真连冒烟**（key 来自 T0.2）：三家各跑「纯文本 / 思考流 / 多轮带工具 / 多模态 / 联网开关」用例；llm-doctor 全绿；用量统计与响应 usage 字段对账。
3. **E2E**：会话内选三家模型对话；统计面板 7/30 天、四颗粒度、admin/普通用户两视角。
4. **工程门**：`pnpm -w run verify`、`packctl tenant-scan`、深浅两主题截图（PR 附件）、`rg -i litellm` 残留检查。
5. **部署冒烟**：embed 档 + web 档各一次无 LiteLLM 启动（`docker/entrypoint.sh` 渲染链路改造后）。

## 9. 下一步（第一个动作）

- 动作：T0.1 创建 worktree（`git fetch origin && git worktree add ../agent-basis-llm-gateway -b feat/llm-gateway-usage origin/main`），随后 T0.2 提取三家 key。
- 时间 / 负责人：2026-11-10 起，本会话执行 M0；M1 预计 2–3 个工作日、M2 预计 1–2 个工作日（不含真连排队时间）。

## 10. 信息来源

- **本地调研**（file:line 已核实）：`packages/llm-openai/src/*`（适配器/配置 schema/API key 机制）、`packages/llm-doctor/src/doctor.ts`（三协议端点表）、`packages/panel/src/session-logs.ts`（日志解码与 usage 折叠）、`packages/observe/src/metrics.ts`（聚合口径）、`packages/access/src/client/index.ts` 与 `docs/design/frontend-style.md`（前端规范）、`docs/PLUGIN-AUTHORING.md`（插件规范/多租户铁律）、`docker/profile/cordis.patch.yml.template`（pi-ai 承载行配置）。
- **官方 API 文档**（2026-11-10 逐页核实，报告存本会话）：DeepSeek https://api-docs.deepseek.com/zh-cn/ ｜ MiMo https://mimo.mi.com/docs/zh-CN/quick-start/summary/welcome ｜ GLM https://docs.bigmodel.cn/cn/guide/start/model-overview
- **zcode 参考**（只读）：https://github.com/zai-org/ZCode （Apache-2.0），本地 `/Users/sunny/code/zcode-ref`；关键路径 `config/provider/zcode-builtin.json`（三协议预设/thinking 方言 map）、`apps/zcode-cli/packages/adapters/src/model/`（transform/runner-normalization/anthropic-stream-compat/model-option-map-fetch）、`packages/model-option-map/`、`docs/websearch-provider-domain-allowlist.md`。
- **LiteLLM 凭据源**：`/Users/sunny/code/litellm/proxy_server_config.yaml`（provider api_key 所在）。

---

## 附录 A：三家能力速查（开发对照用，来源同 §10）

| 维度 | DeepSeek（deepseek-flash / deepseek-v4-pro） | MiMo（mimo-v2.6-pro/flash/pro-ultraspeed） | GLM（glm-5.3/5.3-flash/5.2 等） |
|---|---|---|---|
| base_url | `https://api.deepseek.com`（+/anthropic、/beta） | `https://api.xiaomimimo.com/v1`（+/anthropic；Token Plan 另域） | `https://open.bigmodel.cn/api/paas/v4`（+/api/v1/responses、/api/anthropic） |
| 协议 | chat / responses / anthropic | chat / responses / anthropic | chat / responses / anthropic（Coding Plan 仅 chat） |
| thinking | `thinking:{type}` + `reasoning_effort`（none/low/high/max）；默认开 | `thinking:{type}`（默认开）；思考时温度锁定 | `thinking:{type}` + `reasoning_effort`；**5.3/5.3-Flash 强制开**；`clear_thinking` 保留式 |
| reasoning_content | 多轮带 tools **必须回传**否则 400；流式 delta 前置于 content | 同 DeepSeek（400 错误码明示） | 同族（`clear_thinking:false` 时原样回传） |
| 多模态 | 仅 flash 图片（JPEG/PNG/GIF/WebP，base64/URL/file_id 三传法）；**无 PDF** | 图（50MB）/音频（100MB）/视频（300MB，`video_url`+fps）；URL/base64，无 file_id | flash：图/视频/文件（file_id/URL/data ≤50MB，pdf/word/xlsx/pptx）；4.6V 三者不可混输 |
| 联网 | Search/Fetch API（5 元/千次）；Responses `web_search` 仅 pro；chat 无 | tools 内置 `web_search`（仅 chat 协议；16 元/千次；需控制台开通+5min） | tools 内置 `web_search`（`search_engine` 必填；0.01~0.05 元/次；`search_intent` 增强） |
| usage 缓存 | `prompt_cache_hit_tokens`/`miss_tokens` + `prompt_tokens_details.cached_tokens` | `prompt_tokens_details.cached_tokens` | `prompt_tokens_details.cached_tokens` |
| usage 其他 | `completion_tokens_details.reasoning_tokens` | + `web_search_usage.{tool_usage,page_usage}`、`image/audio/video_tokens` | `completion_tokens_details.reasoning_tokens` |
| 结构化输出 | chat 仅 `json_object`；`json_schema` 仅 responses | 仅 `json_object` | 仅 `json_object`（无 json_schema） |
| 上下文/最大输出 | 1M / 384K | 1M / 128K | 1M / 128K（5.3 系） |

## 附录 B：zcode 借鉴与查漏补缺清单（T0.3 文档目录，来源：zcode 调研报告）

**借鉴（zcode 已有成熟实现+测试）**：三协议批量装配与 thinking 方言声明式 map（`(model, apiType, baseUrl)` 三层规则）；anthropic 端点 thinking 签名回放/修复、裸 tool_result 抑制、无签名 thinking 清理；GLM-5.3 强制思考 map、BigModel 业务码表、web_search 1210 规避与流式兜底；MiMo API/Token Plan 双模板；usage 统一桶（cacheRead/cacheWrite/reasoning/serverToolUse）；多模态 base64 链路；按协议 max_tokens 预算收缩。

**查漏补缺（官方文档对照缺口，落入 T1.2–T1.4）**：
1. DeepSeek chat 协议 reasoning_content 多轮回传（zcode 不回传，官方要求回传）→ T1.2 修正；
2. DeepSeek `prompt_cache_hit/miss_tokens` 显式映射四桶 → T1.2；
3. DeepSeek Search/Fetch API 与 Responses `web_search`（仅 pro）→ T1.6；
4. MiMo `web_search`（chat tools 内置）接入 → T1.3/T1.6；
5. MiMo 音频/URL 直传（URL 通道补齐；音频留待后续）→ T1.3；
6. MiMo thinking 默认开语义 → T1.3；
7. GLM `clear_thinking` 保留式思考 → T1.4（高级开关，默认关）；
8. GLM `web_search.search_engine` 参数 → T1.4；
9. GLM 文件三态 file_id/URL/data → T1.4；
10. `max_tokens` vs `max_completion_tokens` 字段名按协议核对 → T1.1 测试固化；
11. 定价字段 → **不做**（纯 token 口径，范围外）；
12. reasoning 档位取值逐字核对 → T1.1 测试固化。
