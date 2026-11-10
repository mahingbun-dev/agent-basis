# T1.7 Spike 报告：system-prompt/assemble waterfall 会话区分

- **任务**：计划书《2026-11-11-提示词工作室全景化改造计划》§3 T1.7 / 测试计划 `docs/dev/ps-v2-test-plan.md` §T1.7
- **日期**：2026-11-11（实验时间 2026-11-10T17:35Z = 北京时间 11-11 01:35）
- **结论**：✅ **能按会话区分并替换段落文本**（严格回放可行，T2.4 可执行）
- **实测版本**：`@deepseek-ai/dsh-system-prompt`/`dsh-agent`/`dsh-agent-loop` **0.2.2-rc.1**（生产 profile 同版本，`profiles/eterna-web/README.md:14`），经 LiteLLM 真模型回合验证，27/27 断言通过

> 报告与实验产物按 spike 纪律落在本目录（`docs/dev/`）；测试计划 §T1.7 提到的
> `scripts/ps-v2-waterfall-spike.mjs` 与 `docs/dev/ps-v2-waterfall-spike.md` 即本目录
> `ps-v2-waterfall-spike.mjs` 与本文件（名称以本报告为准，后续 INDEX 对账用此路径）。

## 一、结论（测试计划要求的二选一）

**「能按会话回放」**，附会话身份证据（scope 身份 = 会话 Agent，`agent.id` 即 sessionId）。
依据两层实测 + 上游源码链条，见下。结论成立的三个前提（当前部署均满足，见 §四风险）：

1. 会话身份来自**运行时字段 `context.agent.id`**（= sessionId），它由 dsh-agent 的
   `assembleContextFor` 注入——**该字段未在上游 `AssembleContext` 类型中声明**；
2. 部署不得注册 `complete: true` 段（否则 waterfall 的段落替换会被恢复的完整段覆盖）；
3. waterfall 只权威于**文本面**（sections/contexts/variables），工具声明归 provider 所有。

## 二、机制链条（类型与源码证据）

### 2.1 声明契约（计划书风险判断的出处，属实）

`agent-basis` 仓库 `packages/memory/node_modules/@deepseek-ai/dsh-system-prompt/lib/types/index.d.ts`（0.2.2-alpha.2，rc.1 同形）：

- `:37-45` — `AssembleContext` **仅声明** `scope?: ScopeKey` 与 `signal?: AbortSignal`，无会话 id 字段；
- `:27` — `system-prompt/assemble` waterfall：「The returned text is authoritative; tool declarations remain provider-owned」（返回文本权威、工具声明不可替换）；
- `:18-22` — scope 过滤分发：scoped 监听器只收该 scope 的组装；signal「must not be retained to control later turns」（仅本回合，不可当会话身份）；
- `:60-69` — 段落文本可为 provider（按次求值）；`complete: true` 段在 waterfall 后被恢复为唯一段。

`ScopeKey` 语义（`@deepseek-ai/dsh-scope`，t7/ps-spike profile 0.2.2-rc.1，`lib/types/index.d.ts`）：
`ScopeKey = object`（**不透明、按对象身份比较**）；`scopeTarget` 分发「admits untagged listeners globally」——**未打标（全局）监听器收到所有会话的组装**，这正是工作室回放插件的注册方式。

### 2.2 运行时真相：会话身份在 `context.agent`（未声明字段）

- `dsh-agent@0.2.2-rc.1` `lib/index.js:407-413` — `assembleContextFor(agent, signal)` 返回
  **`{ agent, scope: agent, …signal }`**：scope 路由键就是会话 Agent 对象本身；
- `dsh-agent@0.2.2-rc.1` `lib/types/types.d.ts:12-15` — `interface Agent { readonly id: SessionId }`，
  注释「Session-backed Agent identity」——**`agent.id` 即 sessionId**；
- `dsh-agent-loop@0.2.2-rc.1` `lib/index.js:679-683` — 每个拟议模型步骤调
  `systemPrompt.assemble({ ...assembleContextFor(this, signal), modelSelection, toolSet })`；
- `dsh-system-prompt@0.2.2-rc.1` `lib/index.js:358-401` — `assemble(context)` 把**调用方 context 原对象原样透传**给
  waterfall：`this.ctx.waterfall(scopeTarget(this, scope), "system-prompt/assemble", assembly, context, …)`；
  alpha.2 实现同形（`packages/memory/node_modules/…/lib/index.js:356` 起，同一 waterfall 调用签名）；
- `dsh-system-prompt@0.2.2-rc.1` `lib/index.js:403-407` — 无 complete 段时返回
  `…transformed`（waterfall 改写后的 sections **原样生效**）；有 complete 段则
  `sections: [completeSection]`（waterfall 的段落替换被丢弃）。

即：**声明类型只认 scope/signal，但运行时 context 携带 `agent`（及 `modelSelection`/`toolSet`），
监听器可读 `context.agent.id` 做会话区分。**

## 三、实验（可重复，两层）

脚本：`docs/dev/ps-v2-waterfall-spike.mjs`（复现：`node docs/dev/ps-v2-waterfall-spike.mjs`）。
自举隔离 scratch 宿主（`agent-basis/.basis-home-ps-spike`，gitignored；端口 3109，占用即失败；
绝不触碰运行中部署），注入 `ps-spike-observer` 插件 = T2.4 回放的最小模拟：
注册全局 `ps-spike:probe` 段（文本 provider 每次组装现读 control 文件）+ 未打标
`system-prompt/assemble` 监听（**首次见到某 `agent.id` 即冻结该会话 probe 文本，此后每次组装把
probe 段替换回冻结值**），观察记录逐次落 `observations.jsonl`。

### 3.1 Tier1 进程内最小 harness（无模型，直测 dsh-system-prompt@0.2.2-rc.1）

以假 agent（`{id:'unit-session-AAAA'}`，同 `assembleContextFor` 形态：`scope` 即该对象）调 `assemble()`：

| 断言 | 结果 | 实测值 |
|---|---|---|
| 监听器收到调用方 context 原对象（含未声明字段 `agent`） | PASS | `keys=["agent","scope"]`，`agentId=unit-session-AAAA` |
| `scope===agent` 时 `scopeIsAgent=true`（身份路由键=会话 Agent） | PASS | — |
| waterfall 按会话替换段落文本**权威** | PASS | A=`FROZEN_FOR_A`、A2（再组装）仍冻结、B/全局=`CURRENT_GLOBAL_TEXT` |
| 未打标监听器收到全部组装（4/4 次显式调用） | PASS | calls=4 |
| 实测包版本=0.2.2-rc.1（生产同版本） | PASS | v=0.2.2-rc.1 |

### 3.2 Tier2 真宿主（dsh-base+dsh-web-app 0.2.2-rc.1，LiteLLM 真模型回合）

时序：会话A（probe=α）→ 不重启改全局 probe α→β → 会话B（首轮）→ 会话A 补第二轮。关键断言（全 PASS，27/27，exit 0）：

| 断言 | 实测值 |
|---|---|
| 真回合 context 含 `agent/scope/modelSelection/signal/toolSet` | `keys=["agent","modelSelection","scope","signal","toolSet"]`（observations seq1-3） |
| `agent.id` 即会话 id（字符串） | `session-d03e6b5c-…`（=session/create 返回 id） |
| `scope === agent`（身份路由键=会话 Agent） | seq1-3 均 `scopeIsAgent:true` |
| 会话A 系统提示含 α、不含 β | session=d03e6b5c |
| 全局改 β 后**新会话B 即用 β**（宿主 pid 未变） | session=0746de1a，pid=74741 全程不变 |
| **核心：旧会话A 补轮后系统提示仍为 α（按会话替换生效）** | 补轮无 β |
| 两会话 agent.id 互不相同（会话可区分） | A→2 次组装、B→1 次，id 不同 |
| 会话A 跨轮 agent.id 稳定 | 2 次组装同一 id |
| β 期组装被替换回 α | observations seq3：`probeTextBefore=β → probeTextAfter=α，replaced=true`（此时全局 control 已是 β，seq2 会话B 未替换用 β） |
| 无 unknown 会话（所有组装都带 agent.id） | total=3 |
| 宿主单次启动、真有 LiteLLM 调用、端口清理 | 日志各 1 次/多条，3109 释放 |

observations seq1-3 还显示：每次组装 24 个真实部署段（含 `deployment:persona-prefix/-suffix`、
`tool:*` 等）且**无 complete 段**——waterfall 文本权威性前提在真部署成立。

## 四、边界与风险（P2 实现必须吸收）

1. **`agent` 是未声明字段**（§2.1 vs §2.2）：上游类型只承诺 `scope/signal`。回放插件必须
   防御式访问（`context.agent?.id` 缺席时跳过替换+审计记录），并把「dsh 0.2.2-rc.x 升级后
   `context.agent.id` 仍在」列入升级回归清单（当前生产 profile 版本实测通过）。
2. **`complete: true` 段会否决替换**（`index.d.ts:69`、impl `sections:[completeSection]`）：
   eterna-web 部署无 complete 段（实测 24 段无 complete）；若未来引入兼容部署 owning complete
   prompt，严格回放对该部署失效，须在快照视图标注。
3. **只可替换文本面**：sections/contexts/variables 可改，**工具声明 provider-owned**（`:27`）——
   回放语义只覆盖提示词条目文本，不覆盖工具面（本就非提示词工作室范围）。
4. **监听器注册方式**：必须**未打标**（经插件全局 ctx 注册）才能收到所有会话的组装；
   scoped 监听器只收对应 scope（dsh-scope `scopeTarget` 语义）。
5. **`signal` 不可用作会话身份**（`:19-21` 明示不得保留到后续回合）；`scope` 是不透明对象，
   可与 `context.agent` 做同一性比较（实测 `scopeIsAgent:true`），但序列化快照对账应以
   `agent.id`（sessionId 字符串）为准。
6. **KV cache 注意**：冻结回放使旧会话渲染与其历史一致（实测旧会话补轮无新 system 节点），
   这对前缀缓存友好；但「改 persona→旧会话沿用旧文」意味着旧会话**永不吸收新文**，产品文案
   须明示（快照视图 + 会话头提示照 T2.3/T1.5 规划）。

## 五、推荐口径

**严格回放**（T2.4 执行）：`system-prompt/assemble` 未打标监听 + 按 `context.agent.id`
（sessionId）查会话快照，逐段替换 patch 值型条目文本（行锚点只读型/运行时注入型跳过并记
原因——分型语义照测试计划 T2.3/T2.4）。实现守 §四风险 1/2/4：防御式字段访问 + complete 段
在场检测（在场则本会话跳过替换并审计）+ 全局注册。降级方案（快照存证可查 + 会话头提示）
不必启用，但 T2.3 快照端点仍按计划交付（回放依赖其数据）。

## 六、实验产物清单（本目录，随本报告提交）

| 文件 | 内容 |
|---|---|
| `ps-v2-waterfall-spike.mjs` | spike 脚本（两层实测、自举 scratch 宿主、幂等可重复；`--clean` 清 scratch） |
| `ps-v2-spike-observations.jsonl` | 真宿主 3 次组装的 AssembleContext 逐次观测（seq1-3，见 §3.2） |
| `ps-v2-spike-run.json` | 两层全部 27 项断言结果 + 元信息（版本/端口/时间戳） |
| `ps-v2-spike.md` | 本报告 |

scratch 侧（不提交，gitignored）：`agent-basis/.basis-home-ps-spike/`（profile、observer 插件、
宿主日志、原始 observations/control）；宿主日志 `logs/ps-spike-host.log` 含
`[basis-llm-openai] POST …/v1/chat/completions model=deepseek-flash` 真调用证据。

## 七、复现

```bash
cd /Users/sunny/code/agent-basis-prompt-studio-v2
node docs/dev/ps-v2-waterfall-spike.mjs          # 首跑自举 pnpm install（约 1–4 分钟）；exit 0 = 全过
```

前提：agent-basis 仓库可达（默认按相对路径 `../../../agent-basis` 解析，可 `AGENT_BASIS_REPO` 覆盖）、
`.secrets/litellm-base-url.txt`/`litellm-master-key.txt` 在位、端口 3109 空闲。
