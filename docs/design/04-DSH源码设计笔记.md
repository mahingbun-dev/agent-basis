# 04 - DSH(DeepSeek Harness)源码设计笔记

> 研读时间:2026-11-03。对象:官方仓库浅克隆 `master@ce7073d5`(版本 `0.2.2-alpha.2`,20,233 个文件)。本地路径:`~/.zcode/workspace/draft-50d92869-2a8d-4d02-8c95-cccdab6eafca/deepseek-harness`。所有结论附仓库内文件路径证据。关联:[[05-Cordis论文研读笔记]] [[03-DSH评估]]

## 1. Monorepo 结构

- 根包 `@deepseek-ai/dsh-root`,workspaces = `packages/*/* + vendor/* + apps/* + native/* + website`;Cordis 以 vendored 形式内嵌于 `vendor/cordis`。
- `AGENTS.md` 明确分组规范 `packages/<group>/<pkg>`,60+ 个域组:`core/`(agent、agent-loop、session、system-prompt、tools、scope、tool-executor-native/ptc)、`llm/`、`shell/`、`sandbox/`、`session/`(持久化/迁移/投影)、`skill/`、`subagent/`、`interaction/`(审批/权限)、`bundle/`、`boot/`、`sdk/`、`experimental/` 等。命名规律 `@deepseek-ai/dsh-<pkg>`。
- SDK 三包(`packages/sdk/README.md`):`protocol` = 纯库(JSON-RPC 2.0 over newline-delimited stream 线协议与类型);`server` = stdio JSON-RPC 服务插件(每 sessionId 一个 session,回放全部 session 事件);`client` = TS 客户端(启动同版本 `dsh --profile sdk` 子进程)。另有 Python SDK(`python/`)——**做评测 runner 可直接用它驱动 session**。

## 2. Cordis 使用方式

- `docs/architecture.md`:产品每个部分都是插件(模型适配器、工具注册表、session log、**agent loop 本身**),"no privileged core";**注册即 effect,卸载即回卷**。
- `docs/cordis-primer.md`:插件 = 函数(可带 `inject` 依赖声明 + `apply(ctx)`)或 `Service` 子类;`inject` 表达服务依赖代替手工启动顺序;一切注册是 revertible effect。
- 教程 `docs/cordis-tutorial/` 七篇:01-first-plugin(apply/ctx)、02-lifecycle-and-effects(`ctx.effect()` + disposer)、03-services(declare module 合并、`ctx.plugin(Service)`、provide/consume)、04-events(typed Events 声明/emit/on)、05-config(Schemastery schema 校验后才 apply)、06-composition-and-hmr(`cordis.yml` 的 id/disabled/group/isolate;HMR 热替换 = unload+load)、07-into-the-harness(`defineTool` 注册进 `ctx.tools`,走真实工具管线)。
- 生命周期/HMR:配置编辑、热重载、显式 dispose、依赖服务消失均可触发卸载;`dsh-hmr` 插件监听文件保存并替换运行中插件。

## 3. Agent Loop

- 实现:`packages/core/agent-loop`(具体驱动 `ReactLoopAgent`,`src/agent.ts`),注册为 `ctx.agents` 的 `AgentFactory`。
- 循环结构(docs/architecture.md Turn flow + agent-loop README):turn → 多个 step;每 step = 一次模型请求 + 其工具调用。流程:claim 输入 → 快照 model selection → 组装 prompt sections + step 级工具 schema → `agent/pre-step` waterfall(可改写/拒绝)→ `prepareCall()` 绑定适配器 → freeze 请求 → 流式(`agent/assistant-stream`)→ `tool/call` → `tools/pre-execute → execute → post-execute → tool/result` → 有工具欠账则继续 step → `agent/turn-stopping`(串行,可终止)→ `turn/end`。
- **无内置最大轮数**("No built-in turn budget"),需用 `agent/turn-stopping` 自建策略(agent-loop README Known Limitations)——**行业基座必须补一个轮数/预算守卫插件**。
- 事件词汇:`packages/core/session/src/known-event-types.ts` 全量 **66 种**(turn/*、step/*、消息、tool/call|result|ptc-dispatch、request/header|context、compaction/*、approval/*、subagent/*、team/*、todo/write 等);`assistant/attempt` 保留失败尝试不入模型历史。
- Compaction(`packages/compaction/compaction/README.md`):契约三操作 `compactIfNeeded`(pressure/context-overflow 自动触发)、`compactNow`、`compactRegion`;`compaction/start+end` 事件作锁;summary 以 `user/message` replace 落一次表面变更,**旧日志不删**;后端 `dsh-compaction-basic` + image-offload、tool-result-pruner 子包。

## 4. 工具系统

- 定义(`packages/core/tools/README.md`):`defineTool({name, description, parameters, output:{schema,render}, execute})`,统一 schema DSL,原生 JSON Schema 作线级互换格式;`register(definition,{when})` 条件工具按 step 评估。
- 执行管线:`tools/pre-execute`(allow/deny/ask waterfall)→ 单调 guard → `tools/execute` → `tools/post-execute` → `tools/result`。
- 内置工具(docs/tool-catalog.md):bash/pwsh(+persistent PTY)、fs 组(read/write/edit/apply_patch/read_image)、glob/grep(打包 ripgrep)、web_search/web_fetch、skill、subagent(+control)、jobs、todo_write、terminal_*、lsp、ask_user_question、exit_plan_mode、session_query、schedule、goal、present、plugin_manager、run_code(PTC)、browser-use/computer-use(experimental)等。
- 截断(`packages/spill/spill/README.md`):超大结果存 `ctx.spillStore` 得 locator;`spill-policy` 共享 token 预算,模型收 head/tail + 完整文件路径。
- 错误回灌:失败 step 对未答工具调用记合成结果 `TOOL_OUTCOME_UNKNOWN` / `TOOL_NOT_STARTED` / `ABORTED_BEFORE_DISPATCH`,提示模型只对只读/幂等操作盲重试。

## 5. Skills 机制

- `packages/skill/skill-filesystem/README.md`:目录包 `<name>/SKILL.md` 或扁平 `<name>.md`;frontmatter 必填 `name`(kebab-case)+`description`,可选 `whenToUse`、`metadata`、`disable-model-invocation`、`user-invocable`;不递归发现。
- 加载:发现只解析 frontmatter 入 catalog(Chokidar 热刷新);**body 按需读取不缓存**;模型经 `dsh-tool-skill` 的 `skill` 工具访问,catalog 以 `user/message`(经 `agent.inject()`)注入。
- 与 agentskills.io 标准:全仓库 grep 无 "agentskills" 字样——仅 frontmatter 形状兼容,**非显式实现该标准**。
- 边界:skill = 指令文本(无代码执行面),tool = 可执行能力;`ctx.skills` 支持多 provider 合并、model/user invocable 四象限策略;插件可 `ctx.skills.register()` 内嵌 skill。

## 6. 沙箱

- `packages/sandbox/sandbox/README.md`:per-call 文件策略三模式 `read-only / workspace-write / danger-full-access`;**fail-closed**(无后端 → `SANDBOX_UNAVAILABLE`);拒绝后模型可带 `sandbox_permissions`+`justification` 一次性升级需审批。
- 后端(`packages/sandbox/sandbox-local/README.md`):linux = bubblewrap→Landlock(私有 PID namespace);darwin = Seatbelt(sandbox-exec SBPL);win32 = ACL restricted-token(partial)。
- **缺口:网络出口不在沙箱词汇内**(`docs/subsystems/sandbox.md`:"Network and process visibility are outside this vocabulary")——行业基座需自建出口管控层。
- 三层结构:权限预设(permission-presets 选 sandbox mode+approval 捆绑)→ 审批(user-approval)→ 文件隔离(后端)。

## 7. 权限/审批

- `docs/subsystems/approval.md`:`ctx.approval` 服务,per-session `ApprovalPolicy = 'ask' | 'never'`(never 在服务内短路);outcome 封闭集 `allowed-once|rejected|cancelled|unavailable`,fail-closed;answerer waterfall(`approval/request`)。
- 持久化:审批策略与每次 ask/decide 以 log-only 事件 `approval/policy`、`approval/asked`、`approval/decided` 落 session 日志,replay 即重建;SDK 侧 `InitializeParams.approvalRequests` 允许远端客户端作 answerer。
- Guard:`ctx.tools.guard()` 单调拒绝;`guard/repeat-tool-reminder`(3/5/8 次重复提醒)、`timeout-policy`。
- **评估结论:细粒度 allow/deny/ask 规则引擎不在原生内核**——治理插件是我们基座层的必建件(与 dsh-evaluation.md 判断一致)。

## 8. Provider 系统

- `packages/llm/llm/README.md`:`ctx.llm` 唯一模型入口,适配器 seam + `prepareCall()`(校验/默认值/freeze);`dsh-llm-retry` 负责重试;直连 DeepSeek:`dsh-llm-deepseek`。
- 多 provider(`packages/llm/llm-pi-ai/README.md`):基于 pi-ai catalog 路由 anthropic/openai/openai-responses/openai-completions 协议、任意自定义 baseURL、自托管 vLLM;内置 catalog 含 `moonshotai`(Kimi)、`zai`(GLM)等 id。
- 路由 = 请求里 `provider`+`model`,Session 快照写 `model/selection`/`request/header`。
- PTC(`packages/ptc-runtime/ptc-runtime/README.md`):抽象 seam(`ctx.ptcRuntime`),`ptc-runtime-node` 在托管 Node 子进程按 sandbox policy 跑 TS;`dsh-tool-executor-ptc` 只向模型暴露 `run_code`,**其他工具变成生成 SDK**,子调用记 `tool/ptc-dispatch*` 事件。

## 9. Subagent / Agent Teams

- `packages/subagent/subagent/README.md`:delegation seam `ctx.subagents`;本地 spawn/fork 子代理持久 session、**可续接**(sendMessage/cold-resume,沿用 persona 与工具限制);外部 ACP/DSH-SDK/Codex/Claude Code 单次执行;`maxActiveSubagents` 默认 8、`maxDepth` 默认 1。
- Agent Teams(experimental,`docs/subsystems/agent-team.md`):Team 域,`TeamId`=root SessionId,durable roster、team/task、直发 inbox;`dsh-experimental-tool-agent-team` 9 个工具,dsh-base 默认禁用,经 profile patch 开启。

## 10. 遥测

- `packages/telemetry/otel/README.md`:OTLP 出口服务,两种通道 `createEventReporter`(分析事件)与 `createSessionLogReporter`(完整 session 事件,单记录 ≤4MB);**无默认端点、挂载不发 anything**——完全由消费方配置。→ 可直通 ai-evo 的 OTel ingest API。

## 11. 插件开发面

- Manifest:插件即 TS 模块导出 `name` + `apply(ctx)` + `inject`(`docs/user/develop/basic/index.md`)。
- 分发形态:**bundle** = package.json 的 `dsh.bundle` 指向 `cordis.patch.yml`,`dsh.profile.bundles` 列叠加层(profile = bundle 的组合)。
- 插件可声明:tools、services、events、prompt sections(`ctx.systemPrompt` 架构)、config schema、UI(Chat ConversationNodeDefinition + renderer)、存储(session 事件或 `ctx.spillStore`/`storage`)。
- 分发管理:`packages/boot/plugin-manager`(pnpm 安装进 profile、compatibility.json、build-script 审批)、plugin_market 工具;社区插件 GitHub topic `dsh-plugin`。

## 12. 评测基建

- **未找到模型质量评测 harness**。`benchmarks/` 是 harness 自身性能门(session-open、conversation-fold、terminal-io,vitest bench);`BENCHMARK.md` 是用 Python SDK 跑基准任务的说明;`test-support`(llm-mock-server、llm-replay、session-snapshot)服务于确定性测试。
- **结论:evals 是明确缺口**,正好由 ai-evo(平台侧)+ 本地 eval runner 插件(开发侧)补齐 → 见 [[07-评测体系-ai-evo对接与本地eval插件]]。

## 13. "领域包"在 DSH 上的承载映射

| 领域包资产 | DSH 承载机制 | 成熟度 |
|---|---|---|
| persona | `packages/preset/persona`(prefix/suffix)+ system-prompt section | ✅ 现成 |
| skills | `ctx.skills.register()` 或 skill-filesystem 目录,随 preset 分发 | ✅ 现成 |
| tools | 领域包做成 bundle,patch 注册 `defineTool`;per-agent 隔离用 preset `isolate` realm | ✅ 现成 |
| knowledge | skill 正文 + attachments/session-query;**无 RAG 内建** | ◐ 缺口,自建检索工具插件 |
| policies | permission-presets + sandbox-policy + approval policy + `tools/guard` + fs 事件门(如 read-before-write) | ◐ 基础有,细粒度规则需自建 |
| evals | **缺口**,需外挂(Python SDK 可驱动) | ❌ 自建 |
| hitl | `ctx.approval` + `ask_user_question` + plan mode | ✅ 现成 |

**载体结论:领域包 = 一个 `dsh.bundle`(profile 行 + cordis.patch.yml),persona/skills/tools/policies 全部可声明;evals 与 knowledge 检索需自建插件。**

## 14. 版本与稳定性

- 当前 `0.2.2-alpha.2`;README:"developer preview… THERE WILL BE COMPATIBILITY-BREAKING CHANGES";`AGENTS.md`:"Public APIs are pre-stable; update every consumer"。
- 每个破坏性变更记入 `docs/upgrade-guide/`(v0.1.7-rc.2 … v0.2.2-alpha.2);Session 格式迁移链 v0→v4(已发布代不改名不删除);`ignorable` 事件标记是向前兼容机制。
- **基座策略含义:锁版本 + 订阅 upgrade-guide + fork 自维护;升级走评测门禁后再切。**
