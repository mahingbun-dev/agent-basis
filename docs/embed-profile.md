# Eterna 企业嵌入档（eterna-embed profile：headless 一次性任务/宿主嵌入）

状态：已落地并真冒烟通过（`node scripts/smoke-embed.mjs`，exit 0，两次运行可重复）。
日期：2026-11-07。权威依据：`plans/2026-11-06-dsh企业agent路线定案.md` T6 行
（「基于 @deepseek-ai/dsh-headless 官方档（或 sdk-minimal）的组合 + JSON-RPC/
一次性任务冒烟；真实会话 + tool_calls 完整一轮跑通（经 NAS liteLLM）」）+ §11
裁切清单（§11.8 为准）。行 id 权威来源：装品 `@deepseek-ai/dsh-base` 0.2.2-rc.1
与 `@deepseek-ai/dsh-headless` 0.2.2-rc.1 的 cordis.patch.yml（后者与本仓库
deepseek-harness 检出**逐字一致**，diff 实测无漂移；前者行号引用见下表）。

## 组合形态

```
@deepseek-ai/dsh-base        0.2.2-rc.1   bundle 层（基础树：llm/session/agent/agent-loop/
                                          tools/tool-executor-native/fs-sandbox/sandbox 族/
                                          approval/permission/jobs/skill 三件套/web 检索五件套/
                                          goal 四件套/subagent 家族/tool-bash/tool-fs/tool-todo …）
@deepseek-ai/dsh-headless    0.2.2-rc.1   bundle 层（headless-startup/headless-runner、
                                          system-prompt persona、sandbox-policy CLI 授权、
                                          禁 credentials/authorization/deepseek-account/hmr）
profiles/eterna-embed/cordis.patch.yml     profile 用户层（最后写赢：企业裁切 + 网关路由）
```

- bundle 元组 = 官方 headless 模板（`@deepseek-ai/dsh-official-bundles`
  `PROFILE_TEMPLATES.headless` = `["@deepseek-ai/dsh-base", "@deepseek-ai/dsh-headless"]`）。
- 组合定义：`profiles/eterna-embed/cordis.patch.yml` + `profiles/eterna-embed/README.md`。
- 物化与冒烟：`scripts/smoke-embed.mjs` 把组合层拷贝为
  `$EMBED_PROFILE_HOME/profiles/eterna-embed/cordis.patch.yml`（默认 home
  `.eterna-home-embed/`，与 eterna-minimal/eterna-web 的 `.eterna-home` 隔离，t7 纪律），
  并把 `@eterna/llm-openai` 以 **symlink 终态** 放进 profile 根 node_modules
  （Loader 与 client-modules 只按 node_modules 解析，不读 profile 依赖表——
  `scripts/t7-smoke.mjs` 头注实证；bundle 包本体从 dsh 安装锚解析，
  `resolveBundleDir` 安装锚优先，故 profile **无需 pnpm install**）。
- 凭据与网关：模型密钥只存在于启动环境——`LITELLM_API_KEY`（仓库自查源
  `.secrets/litellm-master-key.txt`），由 `eterna-llm` 行 `apiKeyEnv` 指名读取；
  网关地址 `ETERNA_LLM_BASE_URL`（自查源 `.secrets/litellm-base-url.txt`，
  实测 `http://192.168.31.165:4000/v1`）。补丁文本不落地任何地址/密钥。

## 与 Web 档（profiles/eterna-web）的裁切差异

同源异构：两档共享 §11 的企业裁定，但宿主形态不同——Web 档 = `dsh-base` +
`dsh-web-app`（浏览器多轮），嵌入档 = `dsh-base` + `dsh-headless`（一次性任务/
宿主嵌入，无 GUI、无端口、无常驻）。逐条差异：

| # | 差异点 | Web 档 | 嵌入档（eterna-embed） |
| --- | --- | --- | --- |
| 1 | **web-app 层** | 有：约 120 行 UI/控制器 + 4 个预设 | 无该 bundle。web 层裁切项（product-analytics、desktop-product-telemetry、account-controller、ui-settings-account、ui-workflow-run、office-to-pdf、open-in-app/ui-open-in-app、shortcuts/ui-shortcuts、ui-brand-official、ui-message-feedback）在嵌入档**不存在，无需裁** |
| 2 | **预设层（agent 平面）** | 需重述 preset-standard（偏差 2：shipped 预设在 delegation 组原样启用 workflow-ptc/tool-workflow）+ 禁 ptc/cordis 预设 | **不成立**：预设是 web-app 层产物，headless 组合无预设。基础工具（tool-bash/tool-fs/tool-fs-search/tool-todo/tool-skill/skill-filesystem/tool-goal/tool-web/agent-instructions/tool-jobs…）在 base 树**宿主行原生启用**，裁宿主行即净 |
| 3 | **credentials** | **保留**（偏差 1：connection 是 requiredStartupEntryIds 必需行且硬 inject credentials，实测裁掉即启动失败） | **净裁**：嵌入档无 webserver/connection 行，headless 层官方禁 credentials/authorization/deepseek-account/hmr 四行（装品 dsh-headless cordis.patch.yml:35-46），实测真跑通过 |
| 4 | **DeepSeek 直连路由** | 裁 llm-deepseek/llm-deepseek-account | 同左（本层新增）：嵌入档还多裁 `deepseek-account` 的生效路径（headless 已禁账号行） |
| 5 | **web 检索五件套/goal 四件套/plan-mode/subagent/jobs/schedule/session-title-llm** | 需要显式「回加」（§11.7/§11.8） | **原生在册**：全部是 base 树行（web=base:467、tool-web=base:486、goal=base:327、tool-goal=base:444、subagent=base:363、subagent 工具家族=base:378-391、jobs=base:96、session-title-llm=base:67），无需回加动作；行为与 Web 档裁定一致（tool-web 的 DeepSeek Search 走 `DEEPSEEK_API_KEY` 环境变量，未设则模型请求省略 web_search——headless README「Credentials」节） |
| 6 | **LLM 路由** | 不插 LLM 行（boot 只验装配，不调模型；模型经官方 `llm-pi-ai` 承载行在 Web 设置页配——满血编辑器配方与机制教训见 docs/eterna-web-profile.md「企业挂载集之 LLM 承载行」，2026-11-09 起） | **本层 insert `eterna-llm`**（@eterna/llm-openai → OpenAI 兼容 chat-completions）+ 覆写 `agent-default-model`（provider eterna / model deepseek-flash）——嵌入档的验收即真会话调模型 |
| 7 | **审批/HITL 面** | interact 经 Web 审批卡片落 R3 | headless **无活审批通道**（headless README：「Headless has no live approval-response channel」）；高危动作的嵌入档收口 = `--approval-policy never`（需人审批的调用直接被拒）或收紧 permission preset |
| 8 | **遥测** | 裁 otel/session-telemetry-otel + web 层两处 | 裁 otel（base:202）/session-telemetry-otel（base:218，外联 `dsh-otel-collector.deepseeksvc.com` base:225）——无 web 层，天然只有这两处 |
| 9 | **ptc/workflow 家族** | 裁宿主行 + 重述预设 | 裁宿主行（ptc-runtime base:397、workflow-ptc base:400、tool-workflow base:405）+ 重申本就 disabled 三行（tool-executor-ptc base:504、fs-observation-policy base:292、tool-plugin-manager base:16）即净 |

### 嵌入档 profile 层裁切清单（全部装品 0.2.2-rc.1 实测存在）

| 行 id | 装品行号 | 理由 |
| --- | --- | --- |
| `otel` | base:202 | 遥测红线（§11.2） |
| `session-telemetry-otel` | base:218 | 外联 dsh-otel-collector.deepseeksvc.com（§11.2/§11.8） |
| `llm-deepseek` | base:531 | DeepSeek API-key 路由，密钥走企业网关（§11.2） |
| `llm-deepseek-account` | base:534 | DeepSeek 账号路由（§11.2） |
| `ptc-runtime` | base:397 | 图纸无对应（§11.2/§11.8） |
| `workflow-ptc` | base:400 | 同上 |
| `tool-workflow` | base:405 | 同上 |
| `tool-executor-ptc` | base:504 | 本就 disabled，重申裁切 |
| `fs-observation-policy` | base:292 | 本就 disabled，重申裁切 |
| `tool-plugin-manager` | base:16 | 本就 disabled，重申裁切 |

覆写两行：`agent-default-model`（config 整份替换 → provider eterna /
model deepseek-flash）、insert `eterna-llm`。`hmr`/`credentials`/`authorization`/
`deepseek-account` 由 headless bundle 层裁（不重述，见上表 #3）。

### 组合验证证据

- `--dump-config`（文本层）：上表 10 行全部 `disabled: true`；`credentials`
  disabled（headless 层）；`eterna-llm` 在册（apiKeyEnv=LITELLM_API_KEY）；
  `agent-default-model` = eterna/deepseek-flash；headless-startup/runner 在册。
- 真会话（激活层）：`scripts/smoke-embed.mjs` 两跑 exit 0（见下「冒烟」）——
  web 档文档的教训（dump-config 只证明补丁文本、不证明行激活）在嵌入档由
  真跑兜住：runner 挂载成功 = 无必需行断链；一次轮完整闭合 = LLM/工具/沙箱链路活。

## 一次性任务用法（headless CLI）

```sh
# 最小形态：位置参数 = 任务，回答打在 stdout，进程即退
dsh --profile eterna-embed "用一句话总结 /tmp/notes.md"

# 任务从 stdin（管道原文发送，含末尾换行；位置参数与管道二选一）
{ echo "审查以下 diff："; git diff --stat; } | dsh --profile eterna-embed

# 机器可读输出：NDJSON 事件流（嵌入宿主推荐面）
dsh --profile eterna-embed --json "在当前目录创建 ok.txt，内容一行：hello"

# 续聊同一会话（adoption 校验 cwd/归属/预设，不匹配即拒绝）
dsh --profile eterna-embed --session-id <session-uuid> "继续上一条"
```

| 运行项 | 默认 | 说明 |
| --- | --- | --- |
| `task` | stdin | 位置参数或 `-`（stdin 标记）；空白任务 = 用法错误，什么都不会跑 |
| `--json` | `false` | stdout 换成 NDJSON 事件流；stderr 只留 `dsh:` 诊断 |
| `--session-id <id>` | 每次新 `session-<uuid>` | 采纳已持久化会话；未知 id 在跑任务前失败（不静默开空历史） |
| `--permission-mode <preset>` | `DSH_PERMISSION_MODE` ?? `workspace-write` | 复用 permission 服务的预设（read-only/workspace-write/danger-full-access） |
| `--approval-policy ask\|never` | 会话策略 | `never` 拒绝一切需人审批的调用（嵌入宿主默认建议） |
| `--add-dir <dir>` | 无 | 附加可写根（sandbox-policy；重复覆盖需带 `ctx.headlessStartup.additionalWritableRoots`） |

退出码契约（headless README「Exit mapping」）：**0 = 任务完成**（final turn
`completed`）；1 = 中止/出错/无归属轮。进程只存活一次任务，不开端口、无残留。

`--json` 事件词汇（headless `src/json-stream.ts:259-333`，全部为提交点投影，
带 8KiB/32KiB 有界截断）：

| 事件 | 载荷 | 说明 |
| --- | --- | --- |
| `session` | `{sessionId, cwd}` | 流开头，报本次运行的会话身份 |
| `status` | `{phase: turn_start\|step_start\|step_end\|turn_end, turn, step?, reason?}` | `step_end` 带 `usage`（token 计量）；`turn_end` 带 durable reason |
| `text` / `thinking` | `{text}` | 来自已提交的 assistant/message（重试/被弃尝试不进流） |
| `tool_call` | `{callId, tool, input}` | 工具调用开始 |
| `tool_result` | `{callId, status: completed\|error, result, error?}` | 工具返回（status=completed 只代表工具返回了，内部命令可能非零退出） |
| `error` | `{message}` | runner 在轮外抛的失败（此时无 `final`） |
| `final` | `{sessionId, reason, text}` | 终事件：lossless 全文答案 + durable turn reason（无终轮则为 null） |

会话落盘：`$DSH_HOME/sessions/`（base `session-persistence-jsonl`，headless 对
每个一次性会话 checkpoint——冒烟实测两次运行各落一盘）。

## JSON-RPC / SDK 用法（多轮宿主嵌入）

headless 的 `--json` 是**单向一次性**投影（一问一答即退）；要双向 JSON-RPC
（宿主长驻、多轮、订阅事件、审批应答）走 SDK 面，两种形态：

**形态 A（推荐给嵌入档演进）：在本组合上插 SDK 传输行**。官方 `sdk` 模板 =
`["@deepseek-ai/dsh-base", "@deepseek-ai/dsh-sdk-app"]`，其 JSON-RPC 服务行
即 eterna-minimal 同款（`basis/basis-minimal/cordis.patch.yml:14-19`）：

```yaml
# 叠加在 eterna-embed 用户层（或独立 --patch 覆盖层）：
- insert:
    - id: sdk-app-startup
      name: '@deepseek-ai/dsh-sdk-app'
      config:
        profile: eterna-embed
    - id: sdk-jsonrpc-server
      name: '@deepseek-ai/dsh-sdk-jsonrpc-server'
      inject: [sdkAppStartup, loader]
      config:
        maxTokensAsSuccess: false
```

宿主侧用 `@deepseek-ai/dsh-sdk-client` 的 `DeepSeekHarness`（stdio 上的
JSON-RPC 行协议；spawn `dsh --profile <profile>` 并完成握手）：

```js
import { DeepSeekHarness } from '@deepseek-ai/dsh-sdk-client'
const harness = new DeepSeekHarness({ profile: 'eterna-embed', dshHome, cwd, provider: 'eterna', model: 'deepseek-flash' })
const result = await harness.run('任务文本')   // result.finishReason / finalResponse / events
await harness.close()
```

仓库先例：`scripts/smoke.mjs` 就是 eterna-minimal（sdk-minimal 组合 +
eterna-llm）的 JSON-RPC 冒烟，本次实测输出 `finishReason: completed | final: "在线"`。

**形态 B：官方 sdk-minimal 档 + 企业插件挂载位**（T6 计划的备选项）。适合
「宿主要双向 RPC 但不要 headless 的 CLI 语义」的场合：profile bundles 换成
`["@deepseek-ai/dsh-sdk-minimal"]`，其 insert 树即全量手选最小集；企业路由
（eterna-llm insert + agent-default-model 覆写）与本档完全同款可搬。

### finishReason 口径（诚实记录：与 T6 任务书字面「finishReason=stop」的差异）

任务书写的是「finishReason=stop → exit 0」。实测（本次会话，DSH 0.2.2-rc.1）：
**wire 层的 `finish_reason=stop` 在所有官方面都不以字面 `stop` 暴露**——

- LLM seam 内：`@eterna/llm-openai` 把 OpenAI `finish_reason` 映射为
  `FinishReason{kind: stop|tool-calls|max-tokens}`（`packages/llm-openai/src/translate.ts:61-69`）；
- agent-loop 把每步收尾折算成 durable turn reason：`stop`/`tool-calls` →
  `{kind:'completed'}`（装品 dsh-agent-loop `lib/index.js:958,973`），
  `max-tokens` → `{kind:'max-tokens'}`（`lib/index.js:956`）；
- headless `--json` 的 `final.reason` 与 SDK `session.query.completed` 的
  `finishReason` 都是这个 turn reason kind（装品 dsh-sdk-jsonrpc-server
  `lib/index.js:30,61,137-145`；sdk-client `lib/index.js:917`）；
- **实证**：`node scripts/smoke.mjs`（JSON-RPC 面）输出
  `finishReason: completed | final: "在线"`——脚本按字面断言 `!== 'stop'`
  即置 exit 1，说明既有 smoke 的字面断言与 rc.1 协议不符。

因此 `scripts/smoke-embed.mjs` 按协议真值断言**清洁收尾**：
`final.reason.kind ∈ {'completed','stop'}`（兼容未来直接暴露 wire 语义的面），
exit 0 ⇔ 清洁收尾 + tool_calls 一轮闭合 + 落盘证据；输出行显式打印
`finishReason: completed (DSH turn reason kind; wire finish_reason=stop)`，
不做任何伪造。

## 企业插件挂载位（§11.4 对嵌入档的落点）

挂载两个硬规则（Web 档同源教训）：

1. **企业插件一律 `- insert:` 形态**——裸 id 行会被 applyPatches 丢弃
   （`packages/glue/cordis.patch.yml:1-7` 的 2026-11-04 E2E 实测）。
2. **profile 根 node_modules 必须先解析对应 @eterna 包**——file: 链接
   （`scripts/init-profile.mjs` 配方）或 symlink 终态（t7 实证）。bundle 形态
   的包（`dsh.bundle.patch` 声明者）挂载位 = profile package.json 的
   `dsh.profile.bundles` 元组；插件行形态的挂载位 = 本档 cordis.patch.yml 的
   `- insert:` 块。

| @eterna 能力 | 挂载物 | 嵌入档挂载位 | 首期裁定（§11.4） |
| --- | --- | --- | --- |
| governance / memory / knowledge | `@eterna/glue`（bundle；自带 insert 三行 eterna-governance/eterna-memory/eterna-knowledge，见其 cordis.patch.yml） | `dsh.profile.bundles` 追加 `'@eterna/glue'`；或等价地把三行 insert 进本档 patch（本档已留注释模板） | **必挂**（图纸②⑧：写权限管控、调用审计）。挂载顺序：先 glue 后依赖它的 extra |
| egress 域名白名单 / reviewer preset | `@eterna/extra`（库包；egress wrapper 在 governance 的 egress-lite 之上包装 ToolDefinition.execute） | 需要宿主半包装器随 glue 类插件落地后 insert（reviewer preset 产物是 agent-preset 行 + persona 行模板，可整体 insert） | **挂**（2026-11-07 二次裁定：web 检索回加后出站面重新存在）；realm 多租户不挂 |
| interact（HITL R0-R3） | `@eterna/interact`（库包；审批卡/提问合并/policy 产物） | 嵌入档**无活审批通道**（headless 限制）；落点改为运行项 `--approval-policy never` + permission preset 收紧；产品化嵌入宿主接 SDK 形态 A 后可经 JSON-RPC `user-question/ask` 应答 | Web 档挂卡片面；嵌入档首期**不挂宿主行**，收口走 approval-policy |
| observe（T5 性能基线） | `@eterna/observe`（库包：session 事件流→指标聚合/信号存储） | 宿主半待 T4/T5 落地为 bundle 后挂；session 事件流两档同源，采集口径可平移 | 首期挂 Web 档；嵌入档待宿主半 |
| cache-guard（KV-cache 守护） | `@eterna/cache-guard`（库包：前缀稳定性检查 + 命中率口径） | 同 observe | 同上 |
| panel（Web 面板）/ prompt-studio（T7） | `@eterna/panel` / `@eterna/prompt-studio`（bundle，eterna-panel 行等） | **不挂**：需要 typert/webserver 宿主层，嵌入档无 HTTP 面 | Web 档专属 |
| channels（IM）/ evolve（自进化）/ approval-cli | 各独立插件 | **不挂**（§11.4：渠道与受控进化不在首期验收口径；Web 审批卡片已覆盖 approval-cli 场景，嵌入档由 approval-policy 收口） | 不挂 |

嵌入档的组合骨架本身（base 树）已含企业所需的基础挂载点：`mcp-resources`
（企业七类 MCP Server 的客户端挂载位，图纸⑤）、`storage` 三件套
（企业插件存储单元，如 prompt-studio 的 `eterna_prompt_studio`）、
`session-projection(+cache)`、`tool-jobs`（图纸⑦报告异步化）。

## 冒烟

```sh
LITELLM_API_KEY=$(cat .secrets/litellm-master-key.txt) node scripts/smoke-embed.mjs
```

- 语法门：`node --check scripts/smoke-embed.mjs`。
- 断言（退出码 0/1，可重复执行——每次重建 profile 与工作区）：
  1. profile 物化（补丁逐字一致 + @eterna/llm-openai symlink 终态）；
  2. `dsh --profile eterna-embed --json "<写文件任务>"` 真会话（NAS liteLLM，
     cwd=临时工作区）；
  3. NDJSON 流：session 开事件；≥1 条 tool_call 且每条 callId 都有
     status=completed 的 tool_result（**tool_calls 完整一轮**）；无 error 事件；
     `final.reason.kind` 清洁收尾（见「finishReason 口径」）；dsh exit 0；
  4. 落盘证据：任务文件存在且内容逐字匹配（工具真执行）+ 会话已持久化。
- 2026-11-07 实测两跑：exit 0；run#1 tool_calls=2（write+bash，2 results
  closed，finishReason=completed，文件逐字命中）；run#2 tool_calls=1（write），
  finishReason=completed，exit 0。
- 网关不可达/凭据缺失时脚本以清晰错误退出（不做任何伪造通过）。

## 上游刷新后的动作

重读装品两份补丁（dsh-base、dsh-headless）diff → 核对上文裁切清单与 headless
层四行 → 重跑 `node scripts/smoke-embed.mjs`。headless 层与仓库检出当前逐字
一致（diff 实测）；base 层行号以装品 0.2.2-rc.1 为准（与 deepseek-harness
检出的差异同 docs/eterna-web-profile.md「版本对齐注意」口径：检出超前，本层
只对装品存在的行写覆写）。
