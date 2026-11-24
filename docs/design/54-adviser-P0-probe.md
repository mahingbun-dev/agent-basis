# 54 - 参谋面板实施记录（P0 探针 → P4 provider 定谳）

> 状态：**P0/P1/P2/P3/P4 调研全部通过（2026-11-24 实测）**。本文是
> [plans/2026-11-24-会话辅助对话-参谋面板.md](../plans/2026-11-24-会话辅助对话-参谋面板.md)
> §6 任务的验收记录。
> 结论：**架构前提全部实证成立；宿主服务面 + access 守卫路由已闭环；参谋会话改用
> spawn + 只读 preset（只读由工具面缺失硬保证）**，可以进入 P5（客户端面板）。
>
> 章节导航：§1–§5 P0 架构前提 · §6 P2 preset 装配 · §7 进度 · §8 真模型双通道对照 ·
> §9 多开恢复免登记表 · §10 access 守卫路由接线（含两个致命缺陷与新增门禁）·
> **§11 P4：fork 与只读 preset 结构互斥 → 改用 spawn（推翻 P0–P3 的 provider 选择）**。
>
> 探针工件为一次性脚本，**不进仓库**（`/tmp/adviser-p0/`，本次会话后不保证留存；复现方法见 §4）。

---

## 1. 探针要回答什么

| # | 前提 | 不成立时的后果 |
|---|---|---|
| ① | 宿主插件（**非**模型工具路径）能程序化创建 subagent child | 整个方案退回「平级 fork + 自己管生命周期」，工作量大增 |
| ② | 该 child 进入父会话的 subagent catalog | 面板无法按父子关系定位/恢复参谋会话 |
| ③ | 该 child `origin === 'subagent'`，因而被客户端硬过滤出普通会话列表 | 「会话列表不可见」不成立，需另做隐藏 |
| ④ | fork 种子是**一次性快照**（父会话后续 turn 不进 child） | 「按需读父」可能非必需（可用实时同步替代），架构可简化 |
| ⑤ | `agent.inject()` 被接受且不新增 `turn/start` | 双按钮里的 `inject` 语义不成立 |

---

## 2. 实测结果（2026-11-24，连跑 3 次一致 8/8 PASS）

实测环境：`/tmp/adviser-p0/runtime` 下 `npm install @deepseek-ai/dsh@0.2.2-rc.1`（654 包，依赖完整），
`bundles = ['@deepseek-ai/dsh-base']`（**不装 web-app**，P0 只验证宿主面），探针以 insert 行注入。

```
PASS  setup/parent-created — parent=adviser-p0-parent-<ts> keys=agent,dispose
PASS  premise-1/startActivation-host-side — childId=adviser-p0-child-<ts> messageId=<uuid>
PASS  premise-2/child-in-parent-catalog — descendants=["adviser-p0-child-<ts>"]
PASS  premise-3/origin-is-subagent — origin=subagent isSeeded=true parentSession=adviser-p0-parent-<ts>
PASS  premise-3/seeded-from-parent — isSeeded=true
PASS  premise-3b/listed-with-origin-subagent — corpus=["adviser-p0-child-<ts>(origin=subagent,live=true)",
                                                    "adviser-p0-parent-<ts>(origin=-,live=true)"]
                                              parentSeen=true childSeen=true child.origin=subagent
PASS  premise-4/fork-seed-is-snapshot — child surface 不含 fork 之后父会话新增内容
PASS  premise-5/inject-accepted-no-new-turn — inject=accepted turn/start 0→0 events 0→0
================ 8 passed, 0 failed ================
```

### 2.1 逐条结论

**① 宿主侧程序化创建 —— 成立（关键）**

调用形态（与计划书假设一致，但注意字段嵌套）：

```js
const activation = await ctx.subagents.startActivation({
  provider: 'fork',
  label: 'adviser-p0-probe',
  childId,                                  // 预留子会话 id
  request: { parent, prompt: [{ type: 'text', text: '…' }] },   // ← parent/prompt 在 request 里
  signal: new AbortController().signal,
  delivery: 'caller',
})
// → { childId, messageId, result, dispose() }
```

**修正一处计划书的表述**：`parent` 与 `prompt` 位于 `request` 子对象内，不是 `startActivation` 顶层字段
（`@deepseek-ai/dsh-subagent/lib/types/types.d.ts` `interface SubagentActivationSpec`）。
`parent` 必须是**活的 Agent 实例**（`agents.create()` / `agents.get()` 取得），`{ id } as Agent` 只在单测假件里成立。

**② 进父 catalog —— 成立**

`ctx.subagents.listDescendants(parentSessionId)` 返回 `[{ id: childId, parentId, depth: 1, mode: 'continuable', … }]`。

**③ origin 标记与「列表不可见」的真实机制 —— 成立，但机制需修正认知**

实测 `ctx.sessionQuery.listSessions()` 的返回里**父与子都在**：

```
corpus = [ child(origin=subagent,live=true), parent(origin=-,live=true) ]
```

即 **宿主不从会话语料里排除 subagent 会话**。「普通会话列表看不到参谋」是**纯客户端过滤**：

```ts
// packages/client/ui-workspace/src/client/tree.ts:235
if (session.origin === 'subagent') return false
```

该过滤与 `archivedFilter` 无关，是硬过滤。

**这带来一个对计划书的精确化**：P9 若要在列表可见性上做任何定制，改的是客户端 `tree.ts` 的判定或数据源，
而不是宿主侧列表接口。也意味着：**任何绕过该客户端的消费面（其他 UI、导出、API 调用方）仍能看到参谋会话**。

**④ fork 种子是一次性快照 —— 成立（架构取舍的关键确认）**

流程：fork 时父会话已有 `ORION-42` 消息 → fork 后父会话再追加 `VEGA-7` → 读 **child** surface，
**不含 `VEGA-7`**。印证 `subagent-fork-in-process/README.md` 的 Seed boundary 语义。

→ **「按需读父」是必需的，不是可选优化**。这是计划书 §7 R2 的实证支撑。

**⑤ inject 语义 —— 当时为弱证明，**已由 §8 补强为强证明**

本条**不足以单独证明** `inject` 的「不唤醒」语义：本探针没有模型凭据，child 回合本就不会真正跑起来，
`turn/start` 恒为 0 是「没跑」而非「不唤醒」。当时只证明了：**`inject()` 调用被接受、未抛错、未新增 `turn/start`**。

→ **已补强**：§8 用真实模型凭据做了 `inject` vs `followup` 对照，9/9 PASS。两向语义均已确证
（`inject` 不启回合**且内容留存**；`followup` 立即启一轮并产出 assistant 消息）。

---

## 3. 对计划书的修正（P0 产出）

| 项 | 原表述 | 修正后 |
|---|---|---|
| `startActivation` 调用形态 | `{provider, childId, delivery, parent, prompt, signal}` | `{provider, label, childId, request:{parent, prompt}, signal, delivery}` —— `parent`/`prompt` 嵌在 `request` |
| `parent` 形态 | 隐含可为 id | 必须是**活 Agent 实例**；`agents.create()` 返回 `{agent, dispose}`（不是 Agent 本体） |
| 「列表不可见」机制 | 归因于内核「原生省略」 | 实为客户端 `tree.ts:235` 硬过滤；**宿主语料仍含**，其他消费面仍可见 |
| `inject` 不唤醒 | 视为已定前提 | **待 P3 用真模型补强**；P0 只证明「被接受」 |

另外两条环境事实（与本方案无关，但影响本地开发）：

- `agent-basis` 本地 `node_modules` 有**悬空 symlink**：`@deepseek-ai/cordis-plugin-group`、`@deepseek-ai/dsh-scope`
  目标目录不存在，从 repo root 装不起来 dsh（`verify-eterna-*.mjs` 在 Docker 内跑不受影响）。
  探针因此在 `/tmp` 用独立 `npm install` 的干净运行时，**未改动仓库任何文件**。
- 仓库工作树当时已有并行会话的未提交改动，故全程未执行 `pnpm install`（避免动 `pnpm-lock.yaml`）。

---

## 4. 复现方法

```bash
# 1. 独立运行时（不碰仓库）
mkdir -p /tmp/adviser-p0/runtime && cd /tmp/adviser-p0/runtime
# package.json: {"type":"module","dependencies":{"@deepseek-ai/dsh":"0.2.2-rc.1"}}
npm install --registry=https://registry.npmjs.org

# 2. 探针插件必须放在 runtime 目录内（否则 ESM 解析不到 dsh-* 包）
cp probe-plugin.mjs /tmp/adviser-p0/runtime/

# 3. runner 会 materialize 一个最小 profile（bundles=['@deepseek-ai/dsh-base']）
#    + 探针 insert 行，boot 后等探针写 result.json
node run-probe.mjs
```

探针要点（供 P1 复用）：

- 插件声明需 `inject: ['subagents','agents','sessionProjections','sessionQuery']`；
  未声明的服务在 cordis 里取属性直接抛 `cannot get property "…" without inject`。
- `ctx.agents.create({sessionId})` → `AgentHandle = {agent, dispose}`。
- `ctx.sessionQuery.listSessions()` 返回 `SessionRecord[]`，字段是 **`record.header.id` / `record.header.origin`**（不是 `record.id`）。
- 探针应用 `setTimeout(…, 3000)` 延后执行，避免阻塞 Loader 收敛。

---

## 5. 结论与下一步

**P0 通过**。四个前提（①②③④）实证成立，⑤ 降级为「待 P3 补强」。

---

## 6. P2 追加实测（2026-11-24，5/5 PASS，连跑 3 次稳定）

P2 目标是 `eterna-adviser` preset（只读工具面 + 独立压缩组）。实测发现**三个此前未记录的装配前提**，
全部是踩坑后修正的，写在这里以免 P3 重犯。

### 6.1 建会话时 preset 的正确施加方式（三处都要）

```js
await ctx.agents.create({
  sessionId,
  meta: { agentPreset: 'eterna-adviser' },              // ① 记录到 SessionHeader（持久）
  setup: async (agentCtx) => {                          // ② 真正装配
    await ctx.agentPresets.mount(agentCtx, 'eterna-adviser')
  },
})
```

- **`agentPreset` 在 `meta` 里**，不是 `create()` 顶层字段（`CreateAgentOptions.meta.agentPreset`）。
  只写 `meta` 时 header 正确但**工具面为空**——preset 只是被记录，未被装配。
- **真正装配必须调 `ctx.agentPresets.mount(agentCtx, id)`**（`AgentPresetRegistry.mount(ctx, id?)`，
  签名为「Bind an unpublished Agent to the current preset revision」）。这是 53 号 §1.5
  「preset 已声明但装配链未注入」同一类问题的正确解法。
- 子 Agent 继承父 preset 用 `composeFrom(ctx, parent)`；无条件跟随时可省略。

### 6.2 `agent-preset-registry` 不在 base bundle 里

`@deepseek-ai/dsh-base` **不挂** `agent-preset-registry`——只在 `@deepseek-ai/dsh-web-app` 里。
在 base-only profile 上挂 preset 行，会看到：

```
eterna-adviser-preset: pending (waiting for service: agentPresets)
```

→ **任何验 preset 的探针 profile 必须含 `@deepseek-ai/dsh-web-app` bundle**。

### 6.3 `tool-fs-search` 的 `sampleOverCapGlobResults` 是必填

`dsh-tool-fs-search` 的 `Config.sampleOverCapGlobResults` 无 `?`，缺省即 preset 装配失败
（错误以 `agent-preset/invalid: … missing required value` 在**建会话时**抛出，不在 boot 时报）。
取上游 base 同值 `false`。

### 6.4 实测工具面（preset 生效后的真实清单）

```
glob, grep, read, read_image, skill, working_directory,
session_search, session_event_search, session_event_read, session_event_trace, session_trace
```
共 **11 个，零写/执行/委派**。断言口径：出现下列任一即失败——
`write / edit / apply_patch / str_replace_editor / bash / pwsh / shell / subagent / subagent_fork /
send_message / interrupt_agent / jobs / schedule / goal / todo / knowledge_propose`。

### 6.5 knowledge 检索的取舍（P4 待办）

glue 的 knowledge 插件（`packages/glue/src/plugins/knowledge-plugin.ts:191`）**一次性注册全部四工具**
（`knowledge_search/read/status/propose`），**无 per-tool 开关**。`knowledge_propose` 是写操作，
与「参谋只读」冲突，故本 preset **不挂** knowledge 行；知识库检索留给 P4 的独立薄封装
（只挂 search/read/status 三个只读工具）。

### 6.6 门禁状态

`build:client` ✅ / `oxlint` ✅ / `tsc --noEmit` ✅ / `vitest` 6/6 ✅ /
`packctl form-check` 0 ✅ / `tenant-scan`、`prompt-scan` **零条指向 adviser**
（其余 finding 是本仓既有状态，与本包无关）。

---

## 7. 进度与下一步

**已完成**：
- P0（本文 §2）——架构四前提实证成立；
- P1 —— `packages/adviser` 双面包骨架落地，包级 verify + packctl 全绿；
- P2（本文 §6）—— `eterna-adviser` preset 生效，工具面 11 项全只读，5/5 连跑 3 次稳定；
- P3 设计验证（本文 §9）—— 参谋靠父会话 catalog 的 `label: 'adviser'` 完整登记，多开与重启恢复无需登记表；
- P3 真模型投递对照（本文 §8）—— `inject` / `followup` 双通道语义 9/9 实证；
- P3 服务面（`packages/adviser/src/service.ts` + 16 单测）；
- 53 号 §4 交叉引用已加（用户已认可两形态都装，D1 三分叉修订登记在 P8）。

**下一个动作**：access 守卫路由接线（`/api/eternaAdviser/*`），随后 P4（只读工具）。

**本地环境须知**：本仓 `node_modules` 有悬空 symlink（`@deepseek-ai/cordis-plugin-group`、
`@deepseek-ai/dsh-scope` 目标目录缺失），从 repo root 起不了 dsh；P0/P2/P3 探针均在 `/tmp/adviser-p0/runtime`
的独立干净运行时（`npm install @deepseek-ai/dsh@0.2.2-rc.1`）上进行，未改动仓库依赖。
P5 的浏览器真 boot 验证需先修本地 install（在干净树上做，勿与并行会话改动混提）。

---

## 8. P3 真模型投递对照（2026-11-24 实测，9/9 PASS）

**目的**：补强 §2.1-⑤。P0 那次没有模型凭据，`turn/start` 恒 0 是「没跑」而非「不唤醒」，
只证明了「被接受」。本节在**带真实凭据**（`.env` 的 `DEEPSEEK_API_KEY`，实测直连
`api.deepseek.com/anthropic` 返 200）的环境做 `inject` vs `followup` 的正反对照。

**实测环境**：`bundles = ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app']`（web-app 提供
`agent-presets` / `agent-default-model` 等 web 面服务）；profile patch 把 `llm-deepseek` 的
`reasoningEffort` 设 `off`、`maxTokens` 512 以缩短耗时。密钥只经子进程 env 传递，
不进 argv、不进日志。

```
PASS  setup/parent — default={"provider":"deepseek-official","model":"deepseek-flash"}
PASS  premise-0/model-works — parent {"turns":1,"turnErrors":0,"assistant":1,"completed":1,"total":20}
PASS  setup/adviser-created — childId=p3m2-adviser-<ts>
PASS  setup/baseline — child {"turns":2,"turnErrors":0,"assistant":2,"completed":2,"total":35}
PASS  A/inject-no-new-turn — turn/start 2→2
PASS  A/inject-content-retained — 注入内容落在会话日志=true（排除「静默丢弃」）
PASS  B/followup-new-turn — turn/start 2→3
PASS  B/followup-produced-output — assistant 消息 2→3
PASS  summary/delta-table — baseline={turns:2,assistant:2,total:35}
                             afterInject={turns:2,assistant:2,total:36}
                             afterFollowup={turns:3,assistant:3,total:47}
================ 9 passed, 0 failed ================
```

### 8.1 结论

| 通道 | turn/start | assistant 消息 | 内容留存 | 语义确认 |
|---|---|---|---|---|
| `inject` | 2 → **2**（不变） | 2 → 2（不变） | **是**（事件总数 35→36） | 不唤醒，下次发言才被模型看见 |
| `followup` | 2 → **3**（+1） | 2 → **3**（+1） | 是 | 自成一轮，立即处理 |

- **`inject` 的「不唤醒」成立**，且**不是静默丢弃**——注入内容确实写进了会话日志
  （事件数 +1，marker 可在 raw 日志中检索到）。这一条是 P0 无法证明的关键补强：
  「不唤醒」与「丢了」在 P0 的观测里长得一样，这里用「内容留存」把它们区分开了。
- **`followup` 的「自成一轮」成立**，且**真的产出了模型输出**（`assistant/message` +1，
  `turn/end reason=completed`），不是仅仅起了一个空回合。

### 8.2 途中撞到的三个事实（对实现有直接约束）

**① 建 Agent 必须显式传 `agentOptions`（provider/model）**

`agents.create()` **不会**自动读 `agentDefaultModel`。web 端的做法是
`session-controller/src/agent.ts:453` 的 `agentOptions()`——传**动态 getter**：

```ts
agentOptions: {
  get provider() { return ctx.agentDefaultModel.currentSelection().provider },
  get model() { return ctx.agentDefaultModel.currentSelection().model },
}
```

不传的后果不是报错，而是回合**正常开始后立刻以错误结束**：

```
turn/start → turn/end { reason: { kind: 'error',
  error: { message: 'agent "<id>" has no provider/model: set AgentOptions.provider
                    and AgentOptions.model or record a model selection' } } }
```

→ **对 P3 实现的约束**：`AdviserService.create()` 走 `subagents.startActivation({ provider: 'fork' })`，
子会话的模型来自 fork 的父会话（§8.3 已实证），故**服务面不需要自己拼 agentOptions**；
但如果将来要支持「参谋用更便宜的模型」，必须在 fork 侧或 preset 侧解决，不能靠 `agents.create()` 的默认值。

**② turn 计数必须读 raw 日志，不能读 `readSurface()`**

`readSurface()` 返回的是**模型面**（`SurfaceEvent[]`：system/user/assistant 消息），
**不含** `turn/start`、`step/start`、`turn/end` 这类记账事件。用 surface 数 turn 会恒得 0。
记账事件走 `sessionQuery.readSession(sessionId)`（→ `SessionLogSnapshot.events: SessionEvent[]`）。

**③ 事件名是 `assistant/message`，不是 `message`**

实测 raw 日志的 `type` 序列（一次完整回合）：

```
turn/start → agent/inbox/spliced → working-directory/change → step/start
→ system/message → user/message ×2 → request/header → request/context
→ session/title → assistant/message → step/end → turn/end(completed)
```

### 8.3 fork 子会话的模型继承（顺带实证）

参谋子会话的 session header 与首个 `request/header`：

```
{"type":"session","version":4,"id":"p3m2-adviser-<ts>","parentSession":"p3m2-parent-<ts>",
 "isSeeded":true,"origin":"subagent","delegationDepth":1}
request/header config={"provider":"deepseek-official","model":"deepseek-flash",...}
```

→ **实际用的真实模型**（非 mock），且 `isSeeded=true`（父会话已有完成回合时种子非空）。
`origin=subagent` / `delegationDepth=1` 与 P0 一致。

### 8.4 探针工程的三个坑（复现时注意）

1. **陈旧结果文件**：runner 若不清 `result-*.json`，轮询会立刻读到上一次的失败结果，
   看起来像「这次也失败了」。本轮的 `cannot get required service "sessionQuery" in inactive context`
   有两次其实是上一次运行的残留。**修法：每次运行前 `rmSync(resultFile)`**。
2. **`inject: [...]` 声明在重载下会炸**：给 `llm-deepseek` 打 config patch 会触发 loader 重载，
   旧插件实例被 dispose 但 `setTimeout` 仍会触发，此时 `ctx.<service>` 抛 inactive 错误。
   **修法：改用 `ctx.get(name)` 运行时取值 + 锁文件保证只有一个存活实例执行**。
3. **`listModels()` 返回 Promise**，直接 `JSON.stringify` 会得到 `{}`（假象「没有模型」）；
   且**没有 `listRoutes()` 这个方法**，正确方法是 `ctx.llm.listProviders()`。

---

## 9. P3 设计验证：多开与恢复不靠登记表（2026-11-24 实测，两阶段 4/4 PASS）

**要回答的问题**：参谋会话需要专门的持久化登记表吗？（会不会被迫新增 `SessionEventMap` 事件类型——
那会撞上 v4 恢复拒载未知非 ignorable 事件的纪律。）

**测法**：同一 `DSH_HOME` 跑两次 boot。第一次建 2 个 `label: 'adviser'` 的参谋 + 1 个
`label: 'other-worker'` 的对照 child；第二次重启后从 parent catalog 重新推导。

```
=========== P3 CREATE ===========
PASS  premise-1/two-advisers-created — created=["adviser-1:adviser","adviser-2:adviser","worker-1:other-worker"]
PASS  premise-1/catalog-labels-visible — adviser=2 other=1
=========== P3 RESTART ===========
PASS  premise-2/catalog-after-restart — after restart adviser=2
PASS  premise-3/header-after-restart — origin=subagent parentSession=adviser-p3-parent isSeeded=false
=========== 4 passed, 0 failed ===========
```

**结论**：**不需要额外登记表，也不需要新增事件类型**。参谋的持久事实已经完整落在既有结构里：

- 父会话的 **subagent catalog**（`subagents.listDescendants(parentId)`）——含 `id` 与 `label`，
  重启后仍可从磁盘推导；
- 参谋自身的 **session header**——`origin: 'subagent'`、`parentSession`、`delegationDepth`。

`label === 'adviser'` 就是「这是参谋」的判据，`name`（`adviser-1` / `adviser-2`）区分同父多开。
→ `AdviserService.list()` 因此只需一次 `listDescendants` + 一次 label 过滤，零额外存储。

> `isSeeded=false` 在 §9 的探针里是**正确行为**：fork 种子 = 父会话**已完成** turn 的前缀，
> 该探针的父会话没有已完成 turn，种子为空（`subagent-fork-in-process/README.md` Seed boundary）。
> §8.3 的父会话先跑过一轮，因此那边 `isSeeded=true`。

---

## 10. P3 access 守卫路由接线（2026-11-24 实测，服务面 9/9 + HTTP 13/13 PASS）

**要回答的问题**：铁律 T2 要求插件不自注册路由，数据面必须经 eterna-access 守卫。
参谋的「列表 / 创建 / 投递」怎么落到这套结构里？

### 10.1 接线结构（两端互不 import）

```
浏览器 ──POST /access/api/adviser/{list,create,deliver}──▶ access 守卫路由
                                                          │ ① 登录（requireUser）
                                                          │ ② 归属（store.sessionOwner）
                                                          │ ③ 结构面现读
                                                          ▼
                                          ctx.reflect.get('eternaAdviser')
                                                          │
                                                          ▼
                              @eterna/adviser  ctx.provide('eternaAdviser', AdviserService)
                                                          │ 端口懒解析
                                                          ▼
                                    agents / subagents / sessionController
```

- **数据面**由 `packages/adviser/src/host.ts` 的 `mountAdviser()` provide 成 `ctx.eternaAdviser`；
- **路由面**由 `packages/access/src/routes.ts` 的 `handleAdviserRequest()` 独占登记；
- 两端靠**结构面**相遇（`AdviserFace` 三键：`list`/`create`/`deliver`），
  **两个包互不 import** —— 与 tasks 的 `settingsFace` 完全同款（Tier1 内部无耦合）。
- 结构校验 fail-closed：三键不齐 → `deps.adviser()` 返回 `undefined` → 端点 **503**。

### 10.2 端点表

| 端点 | 载荷 | 门禁 |
|---|---|---|
| `POST /access/api/adviser/list` | `{parent}` | 登录 + 归属；200 带 `no-store` |
| `POST /access/api/adviser/create` | `{parent, seed}` | 同上 + `seed` 非空（400）+ 审计 |
| `POST /access/api/adviser/deliver` | `{parent, text, delivery}` | 同上 + `delivery∈{inject,followup}`（400）+ 审计 |

三条全用 **POST + JSON body**，理由有二（后者是实机踩到的）：
1. 变更类请求能吃到既有的**同源闸（CSRF）与全局限速**；
2. **`createNodeHandler` 的 `pathname` 已被 `new URL(...).pathname` 剥掉 query**——
   GET 读不到 `parent`。首版曾写成 `GET ...?parent=`，在真实 HTTP 下必然拿空值。

失败码映射（闭集）：`limit`/`invalid`→400、`parent-missing`/`forbidden`→**404**（不泄漏会话存在性）、
`preset-missing`/`unavailable`→503、未知→500。

### 10.3 归属校验为什么天然覆盖参谋会话

`store.sessionOwner()` 已内置**子代理父链回退**（`ownerOfAncestor`，上限 32 跳防环）：
参谋会话从不入 `sessions` 归属账本（设计意图：thinking_auto/usage 不因 subagent 而变），
但其归属经父链判到父会话的 owner。

实测：`store.recordChildSession('alice-adviser-1', aliceSession)` 后，
`sessionOwner('alice-adviser-1') === alice.id` → 参谋会话本身也能被本人访问（`adviser-routes.spec.ts` 覆盖）。

### 10.4 同步/异步分层（一个刻意的取舍）

`handleAccessRequest` 是**纯同步**契约，被既有 20+ 测试当作同步纯函数直接取 `.status`。
参谋服务面是 Promise。首版把签名放宽成 `AccessReply | Promise<AccessReply>`，
**立刻打红 18 处既有测试的类型检查**。

最终分层：
- `handleAccessRequest` 保持同步不变（只多一行兜底 404）；
- 参谋面独立入口 `handleAdviserRequest`（`async`，自带同源闸/限速/方法闸）；
- `createNodeHandler` 用 `ADVISER_ROUTE_PREFIX` 分流：
  ```ts
  const reply = pathname.startsWith(ADVISER_ROUTE_PREFIX)
    ? await handleAdviserRequest(deps, request)
    : handleAccessRequest(deps, request)
  ```

代价是 access 里出现第二个入口；收益是**零既有测试改动**、同步契约不被污染。

### 10.5 实机找到并修掉的两个致命缺陷

> 这两条都是 **vitest 全绿 + 单测 38 个通过** 却让插件在真实 runtime 里根本没装起来/不工作的。
> 沉淀成 §10.6 的门禁。

**① TypeScript 参数属性 → 插件静默装载失败**

```text
eterna-adviser (@eterna/adviser): failed to import: .../service.ts:94
SyntaxError [ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX]: TypeScript parameter property is not supported in strip-only mode
dsh: warning: 1 entry did not activate
```

DSH 用 Node 的 `--experimental-strip-types` **直接加载 `src/*.ts`**（只擦类型、不做降级）。
`constructor(private readonly ports: AdviserPorts)` 属参数属性 → 整个插件装载失败，
**只有一行 warning**，其余功能照常，极难察觉。修法：显式字段 + 构造函数赋值。

**② 端口在 apply 时缓存服务快照 → 永久空引用**

`createHostPorts(ctx)` 首版写成：

```ts
const agents = asAgentRegistry(readService(ctx, 'agents'))     // ← apply 时求值一次
const subagents = asSubagents(readService(ctx, 'subagents'))
```

插件装载顺序由**服务可用性**驱动，adviser 常在 `agents`/`subagents` 注册**之前** apply。
于是这两个常量永久是 `undefined`，表现为：

- `list` 恒返回 `[]`（空表，不报错）
- `create` 恒 `parent-missing`
- 而诊断探针同时显示 `ctx.get('subagents') !== undefined`（**已经就绪**）

修法：**每次调用现读**（`agentsNow()` / `subagentsNow()` / `controllerNow()`），
并以「构造时缺席、之后出现」+「构造时在场、之后卸载」两向单测钉死（`host-ports.test.ts`）。

### 10.6 新增门禁：strip-only 语法扫描

`packages/adviser/tests/strip-only-syntax.test.ts` 扫描本包 `src/**/*.ts(x)`，命中即失败：

| 禁用语法 | 原因 |
|---|---|
| 参数属性 `constructor(private x: T)` | strip-only 不支持 → ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX |
| `enum` | 需运行时对象 |
| `namespace` | 需运行时作用域 |
| 装饰器 `@Foo()` | 需 TS 装饰器糖 |

**反向试探已验**：临时把 `service.ts` 改回参数属性写法，门禁精确报
`service.ts:98 参数属性 — constructor(private readonly ports: AdviserPorts) {}`，
还原后转绿。（首版门禁曾把 `styles.ts` 模板字符串里的 CSS `@media` 误判为装饰器，
已加 CSS at-rule 白名单。）

### 10.7 实机 E2E 记录

**服务面闭环（9/9 PASS）**——`probe-p3-e2e.mjs`，profile 挂 `@eterna/adviser`：

```
PASS  wiring/service-provided — reflect.get('eternaAdviser')=present keys=ports
PASS  setup/parent-live — parent=e2e-parent-<ts>
PASS  face/list-empty-initially — rows=[]
PASS  face/create — sessionId=e2e-parent-<ts>--adviser-1 messageId=<uuid>
PASS  face/list-sees-adviser — rows=[{"sessionId":"…--adviser-1","label":"adviser","activity":"running"}]
PASS  face/deliver-inject — {"ok":true,"delivery":"inject","sessionId":"…"}
PASS  face/deliver-followup — {"ok":true,"delivery":"followup","sessionId":"…"}
PASS  face/limit-at-3 — 2nd=true 3rd=true 4th=limit
PASS  summary/parent — parentId=e2e-parent-<ts>
================ 9 passed, 0 failed ================
```

**HTTP 全链路（13/13 PASS）**——`probe-e2e-http.mjs`，profile 挂 `@eterna/access` + `@eterna/adviser`，
固定端口真打 `fetch`：

```
PASS  setup/access-store — reflect('eternaAccessStore')=present
PASS  setup/admin-user — id=1 account=e2eadmin
PASS  setup/parent-recorded — sessionOwner=1 === 1
PASS  http/login — status=200 cookie=ok
PASS  http/anon-401 — status=401 body={"error":"未登录"}
PASS  http/ghost-parent-404 — status=404 body={"error":"主会话不存在或不属于你"}
PASS  http/create — status=200 sessionId=httpp-<ts>--adviser-1
PASS  http/list — status=200 advisers=[{…,"label":"adviser","activity":"running"}]
PASS  http/deliver-inject — {"ok":true,"delivery":"inject",…}
PASS  http/deliver-followup — {"ok":true,"delivery":"followup",…}
PASS  http/missing-parent-400 — status=400
PASS  http/bad-delivery-400 — status=400
PASS  http/get-405 — status=405
================ 13 passed, 0 failed ================
```

> 探针需手工把父会话写进 access 归属账本（`store.recordSession`），因为探针用
> `agents.create` 直建会话、绕过了真实链路的 `session/create`。这不是缺陷：
> 它正好证明**归属校验独立于「会话是否真的存在」**——没登记的会话对守卫一律 404。

### 10.8 门禁状态（本次收尾）

```
adviser:  lint 0 / tsc OK / 41 tests（5 文件）✅
access:   lint 0 / tsc OK / 411 tests（39 文件）✅
packctl:  form-check 0 finding ✅
          tenant-scan 2 finding（均在 glue/channels-plugin.ts，本仓既有，与 adviser 无关）✅
```

---

## 11. P4 调研：fork 与只读 preset 结构互斥 → 改用 spawn（2026-11-24 实测定谳）

> **这一节推翻了 P0–P3 的 provider 选择。** fork 让参谋继承父对话种子，
> 但它**硬拒独立 preset**——只读纪律无处安放。用户 2026-11-24 拍板改用 spawn。

### 11.1 互斥关系（上游源码 + 实机双证）

```ts
// subagent/subagent-fork-in-process/src/index.ts:58-68
class ForkInProcessProvider {
  capabilities = { agentOptions: true, agentPreset: false, outputSchema: true, depthLimit: true }
  inheritsParentContext = true          // 子会话继承父对话
}
// 注释原文:The child inherits its parent's preset composition.

// subagent/subagent/src/index.ts:581-586 (assertCapabilities)
if (request.agentPreset !== undefined
    && (!provider.capabilities.agentPreset || provider.inheritsParentContext)) {
  throw new SubagentError('…does not support independent agent preset selection',
    'UNSUPPORTED_CAPABILITY')
}
```

**实机对照（`probe-fork-preset.mjs`，4/4 PASS）**：

```
PASS  fork/agentPreset-rejected — code=UNSUPPORTED_CAPABILITY
      msg=subagent provider "fork" does not support independent agent preset selection
PASS  spawn/agentPreset-accepted — childId=fp-spawn-<ts>
PASS  spawn/preset-recorded — header.agentPreset=eterna-adviser tools=[…11 项…]
PASS  spawn/readonly-tool-surface — tools=["glob","grep","read","read_image",
      "session_event_read","session_event_search","session_event_trace",
      "session_search","session_trace","skill","working_directory"]
```

| provider | `agentPreset` | 继承父对话 | 参谋可用的工具面 |
|---|---|---|---|
| `fork` | **❌ false** | ✅ 是 | 父会话的**完整**面（可写盘/执行/委派） |
| `spawn` | ✅ true | ❌ 否 | 只读 preset（11 项，零写/零执行/零委派） |

→ **「继承父对话」与「只读纪律」在 fork 上不可兼得**。只读若只靠提示词，
对「顾问/参谋」定位不成立。

### 11.2 一个静默失败的坑：`agentPreset` 在 `request` 子对象内

首版把 `agentPreset` 写在 `startActivation` **顶层**，结果**既不报错也不生效**：

```ts
// ✗ 静默忽略(不抛错,preset 不生效,header.agentPreset 为空)
startActivation({ provider: 'fork', …, agentPreset: 'eterna-adviser' })

// ✓ 正确位置(上游 SubagentStartRequest;与 parent/prompt 同级)
startActivation({ provider: 'spawn', …, request: { parent, prompt, agentPreset: 'eterna-adviser' } })
```

注意两者联动：放在顶层时连「fork 不支持 preset」的能力校验都不会触发
（校验读的是 `request.agentPreset`),所以**错了也没有任何反馈**。
P0 已经为 `parent`/`prompt` 记录过同一坑（§3 修正项），这里是它扩大到第三个字段。

### 11.3 spawn 的代价由「按需读父」补偿（实测成立）

spawn **不继承**父对话,参谋开局只有 `seedText`。这原本就是方案的设计前提
（「不做实时全量镜像,按需读父」),补偿机制是 preset 里的 tool-session-query：

**授权规则**（`tool-session-query/src/workspace-access.ts:80-99`）：
跨会话访问要求目标会话与调用者的 **`cwd` 精确相等**;搜索排除调用者自身。

**参谋天然满足**（spawn 子会话继承父会话 cwd）:

```
PASS  premise-1/cwd-inherited — parent.cwd=/private/tmp/adviser-p0/runtime
                               child.cwd=/private/tmp/adviser-p0/runtime
PASS  premise-2/child-can-read-parent — filterSessions 命中=1(1=授权通过)
PASS  premise-2b/parent-content-readable — 父会话内容含标记词=true
PASS  premise-3/cross-cwd-denied — 参谋 cwd 查不同 cwd 会话 命中=0(0=正确拒绝)
```

→ **参谋能读父会话,且读不到别的工作区的会话**。第三条负用例是关键：
证明授权真的在生效,而不是形同虚设。

### 11.4 P4 全套实测（`probe-p4.mjs`，11/11 PASS）

```
PASS  setup/parent — parent=p4-parent-<ts> cwd=/private/tmp/adviser-p0/runtime
PASS  setup/service-face — reflect('eternaAdviser')=present
PASS  setup/adviser-created — {"ok":true,"sessionId":"…--adviser-1","messageId":"…"}
PASS  premise-1/cwd-inherited — parent.cwd === child.cwd
PASS  premise-2/child-can-read-parent — filterSessions 命中=1
PASS  premise-2b/parent-content-readable — 父会话内容含标记词=true
PASS  premise-3/cross-cwd-denied — 命中=0(正确拒绝)
PASS  premise-4/tool-surface — tools=["glob","grep","read","read_image",
      "session_event_read","session_event_search","session_event_trace",
      "session_search","session_trace","skill","working_directory"]
PASS  premise-4d/preset-recorded — header.agentPreset=eterna-adviser
PASS  premise-4b/no-write-exec-delegate — 命中禁用工具=[]
PASS  premise-4c/has-parent-read-tools — 含 session_event_* 读会话工具=true
================ 11 passed, 0 failed ================
```

禁用清单（出现任一即失败，实机确认为空）：
`write / edit / apply_patch / str_replace_editor / bash / pwsh / shell /
subagent / subagent_fork / send_message / interrupt_agent / jobs / schedule /
goal / todo / knowledge_propose`。

### 11.5 对 P4 任务范围的修正

原计划 P4 要写「`adviser_read_parent` / `adviser_search_parent` 独立薄封装」。
**实测表明不需要**:上游 `tool-session-query` 的五个工具已完整覆盖
（`session_search` / `session_event_search` / `session_event_read` /
`session_event_trace` / `session_trace`),且跨会话授权语义正好是参谋需要的。

P4 剩余的真实缺口只有两块,均应作为**独立薄封装**补（不挂 glue 的 knowledge 行,
因为 `knowledge_propose` 是写操作且 glue 无 per-tool 开关）:
- **知识库检索**:只读 search/read/status;
- **工单状态**（super 形态）:只读查询,base 形态优雅缺席。

### 11.6 对 P0/P3 结论的效力说明

- §2 的四个架构前提**仍全部成立**——它们讲的是 subagent child 的通用性质
  （进 catalog、`origin==='subagent'`、宿主侧可程序化创建),与 provider 选择无关;
- **§2 前提④「fork 种子是一次性快照」不再是参谋的约束**——spawn 根本没有种子。
  该结论对 fork 用户仍有意义,但对本方案已降级为背景知识;
- §8 的真模型双通道对照（`inject`/`followup` 语义）**与 provider 无关**,
  仍完全有效;
- §9 的「多开/恢复不靠登记表」**仍成立**——靠的是父会话 catalog 的
  `label: 'adviser'`,与 provider 无关（spawn 子会话同样进 catalog）。
- P3 的 `ADVISER_MAX_PER_PARENT = 3` 上限逻辑不受影响。

---

## 12. P5–P7 实机缺陷定谳（2026-11-24）

本节记录 P5/P6/P7 在**真实 boot**里撞到的四个缺陷。它们的共同点是
**单测全绿、门禁全绿，只有浏览器实证才能暴露**，因此必须写下来供升级复检。

### 12.1 `startActivation` 双形态（推翻 §11.2 的普适性结论）

§11.2 曾记「`agentPreset` 必须放在 `spec.request` 子对象内，否则静默失效」。
**该结论只对 `0.2.2-alpha.2` 成立**。实机（本地 dsh 0.2.2-rc.1、生产镜像 rc.5）
读的是 spec **顶层**：

| 版本 | 形态 | 现场 |
|---|---|---|
| `0.2.2-alpha.2` | `spec.request.{parent,prompt,agentPreset}` | 仓库 catalog 钉版 |
| `0.2.2-rc.1` / `rc.5` | `spec.{parent,prompt,agentPreset}` | 本地 dsh、生产镜像 |

认错形态的后果不是类型错误，而是 `Cannot read properties of undefined
(reading 'id')` → HTTP 503（`create` 恒失败）。**修法 = 双写**（`host.ts` 的
`activationSpec()` 同时给顶层三字段与 `request` 装箱），两条线都能跑且无副作用。
`tests/activation-shape.test.ts` 把它钉成三层：双写契约、parent 传活 Agent、
以及**逐份扫描已安装上游产物**断言形态仍可识别（识别不出即说明上游又改 API）。

⚠️ 同时证伪一个直觉：**同标 `0.2.2-rc.1` 的两份构建形态可以不同**——npm 发布线
读 `spec.request.parent`，harness 开发构建与生产 rc.5 读 `spec.parent`。所以探针
必须逐份按实际产物判定，不能按版本号分支。

### 12.2 快捷键默认绑定撞车会毁掉整个插件（P7）

初版参谋快捷键取 ⌥⌘K。实机三个入口**全部哑掉**，诊断为：

```
Error: Conflicting shortcut defaults: @eterna/adviser/open and session.search (web:macos)
```

原因链：`session.search` 在 web 上默认占 ⌘K，并把 **⌥⌘K 列为它的 web 回退组合**；
上游 `ShortcutRegistry.register` 对默认绑定重叠**抛错**（不是警告），而该调用在
`apply` 体内 → 插件 fiber 失败 → 连已注册成功的 `/adviser` 命令一起被回收。

两条修法都必要：
1. **换键位**：⌥⌘J。实测本机 30+ 个 `dsh-client-ui-*` 产物用掉的物理键码只有
   A/B/F/G/K/N/O/P/R/T/W，J 空闲。
2. **三入口独立容错**：`entries.ts` 的 `registerShortcut` 自己 catch，`index.ts`
   再用 `guarded()` 包住三段注册。一个**可选入口**不该有「拖垮整个面板」的杀伤力。

### 12.3 客户端命令必须在宿主 catalog 就绪后注册

`ctx.commandUi.register` 本身同步生效，但候选合成是
`await directory.ensureReady(sessionId)` 之后才追加 contributions。
因此**注册时机不影响可见性**，只影响 `apply` 期间服务是否已 provide。
P7 首个失败版本的真实原因不是时机，而是 §12.2 的异常中断。

### 12.4 `dsh.client.inject` 是包名，不是服务名

`inject` 数组决定**装载顺序**（包名 → 依赖包先 arrive），`apply` 里访问的服务名
（`commandUi` / `shortcuts` / `uiConversation`）由 cordis 服务表决定。P7 新增三段
注册时两者都要齐：包名进 `package.json` 的 `dsh.client.inject`，服务名进
`index.ts` 的 `inject` 导出。少前者是竞态（服务可能未 provide），少后者是
「service X is not declared by your plugin」。

### 12.5 P7 验收状态

| 入口 | 状态 | 证据 |
|---|---|---|
| `/adviser` 斜杠命令 | ✅ 实机通过 | 菜单出现「参谋 / adviser / 在右侧栏开一个独立上下文的辅助对话」；执行后 `[data-eterna-adviser="panel"]` 出现、草稿被消费 |
| ⌥⌘J 快捷键 | ✅ 实机通过 | 右栏收起状态按下 → `[role="tab"]` 出现「参谋」 |
| 选中文字入口 | ⏳ 待真实环境 | 临时 profile 无模型 → 会话历史打不开 → ui-chat 的 ChatView 不渲染 → `conversation.chat.text-interaction` 表面宿主不存在。逻辑面由 `client-bundle.test.ts` 的 4 条断言覆盖（交互 id 与槽 key 一致、只认 selection + 有选区、命中才 open、选区一次性消费） |

### 12.6 仍待办

- P8：主会话提示词纪律（声明参谋为私人旁注）+ `VERSIONS` 登记；
- P9：四处 profile 挂载 + `verify-eterna-{web,super}.mjs` 行表 + `TOGGLEABLE_PLUGINS`；
- P4 剩余：知识库只读检索、工单状态（super）；
- P10：§8 全量口径 + 文档定稿。

---

## 13. P8：主会话提示词纪律（2026-11-24）

### 13.1 为什么要这一段

计划书 R1 的表述是「参谋恒进父 catalog，`list_agents` 能列出它、`send_message`
能给它发消息」——这是上游 catalog 的固定行为，本包改不了。因此「参谋是用户自己
的第二视角」这件事只能**从提示词面声明**。三种破坏体验的行为各自对应一句纪律：

| 潜在行为 | 后果 | 纪律句 |
|---|---|---|
| 主会话主动「去问问参谋」 | 用户没让它做的事被它做了 | 「不要主动给参谋发消息，也不要尝试创建、关闭或重命名参谋」 |
| 主会话「等参谋回复再继续」 | 参谋不参与主会话回合 → 永久卡住 | 「不要等待它返回结果——它不会参与你的回合」 |
| 主会话把参谋结论当外部指令 | 权限/纪律被绕过 | 「把它当作**用户的补充说明**照常处理」 |

### 13.2 实现

- `packages/adviser/src/section.ts`：`eterna-adviser:discipline`，order **9060**
  （紧跟 tasks 的 `[active-tickets]` 9050，同属「当前旁路对象」段位）。
  显式 `interpolate: false`（正文含中文标点与方括号，将来出现花括号不该被当变量）。
- `packages/adviser/src/index.ts`：走 `ctx.systemPrompt.section(...)`（本仓装配期
  文本唯一合法入口，memory / tasks 同款 seam）。服务缺席或注册失败**降级**，
  不让参谋面板整体不可用。
- 类型用本地结构面 `AdviserPromptSection`（不 import `dsh-system-prompt`，
  保持 adviser 运行时依赖面最小）。

### 13.3 登记

`PROMPT_REGISTRY_ENTRIES` 新增 `runtime.adviser.discipline`（layer=runtime，
kind=runtime-injection，anchors 指 section.ts 三处常量 + index.ts 的 section 调用）。
prompt-scan 的 P3 面（`systemPrompt.section` 使用未登记即拦）通过。

### 13.4 prompt-scan 的既有欠账（非本次引入，已核实）

`packctl prompt-scan` 当前仍报 4 条 eterna-super 的 `unregistered-prompt-key`：

```
profiles/eterna-super/cordis.patch.yml:167  prefix (row=preset-cordis, path=persona)
profiles/eterna-super/cordis.patch.yml:214  section (row=preset-cordis, path=planning/plan-mode)
profiles/eterna-super/cordis.patch.yml:336  prefix (row=preset-standard, path=persona)
profiles/eterna-super/cordis.patch.yml:388  section (row=preset-standard, path=planning/plan-mode)
```

**核实方法**：把本次 registry.ts 改动 stash 后重跑，4 条依旧存在 → 属本次之前的
欠账（注册表只登记了 eterna-web 侧行号，`WEB_PATCH` 常量单值）。不属 P8 范围，
留作 P9 的挂载行表一并补齐：届时 eterna-super 会新增挂载行，本就要重测全部锚点。

---

## 14. P9：四处挂载 + 门禁（2026-11-24）

### 14.1 挂载清单（四处 + 两处前置）

| 位置 | 改动 | 说明 |
|---|---|---|
| `profiles/eterna-web/cordis.patch.yml` | insert 块末追加 `eterna-adviser` | base 形态生产档 |
| `profiles/eterna-super/cordis.patch.yml` | 同上（排在 Tier2 行**之后**，与模板同序） | super 形态 |
| `docker/profile/cordis.patch.yml.template` | 同上 | 容器 base 模板 |
| `docker/profile/cordis.super.patch.yml.template` | 同上（排在 tasks/channels/interact/toolkit/tasks-access-bridge **之后**） | 容器 super 模板 |
| `docker/entrypoint.sh` | symlink 清单加 `adviser` | 缺链即整行静默 disable |
| `scripts/verify-eterna-{web,super}.mjs` | 行表加 `eterna-adviser`；`BASE_MOUNT_PACKAGES`/`SUPER_FUTURE_PACKAGES` 加 `adviser` | 门禁覆盖 |
| `packages/access/src/routes.ts` | `TOGGLEABLE_PLUGINS` 加 `{ id: 'eterna-adviser', label: '参谋面板' }` | 设置里可停用 |

⚠️ **FORM001 教训**：super 侧顺序必须与模板**逐行一致**（比对口径=insert 块内
`@eterna` 挂载行的 id+name 按序）。第一次把 adviser 插在 `eterna-memory-admin`
之后就报了 6 条顺序冲突——super 的专属行块（tasks/channels/interact/toolkit/
tasks-access-bridge）在其后。改成排最后即通过。

### 14.2 实机验证（真实 profile，含 access 门禁）

用 `~/.dsh/profiles/node_modules` 物化完整 profile 后 boot（仓库 `node_modules`
缺 `@deepseek-ai` 传递依赖，是记忆里的已知坑），登录后读 `window.__DSH_BOOT__.entries`：

| profile | 花名册条数 | 含 `@eterna/adviser` | 入口可用 |
|---|---|---|---|
| eterna-web | 78 | ✅ | 右栏导引卡「参谋」出现；`/adviser` 在斜杠菜单（「参谋 / adviser / 在右侧栏开一个独立上下文的辅助对话(只读主会话)。」） |
| eterna-super | 81 | ✅ | 同上（额外含 `@eterna/tasks` / `@eterna/workbench`） |

两种形态都实证到「插件已装载 + 客户端入口可见」，不是只看 boot 退出码。

### 14.3 门禁终态

| 门禁 | 结果 |
|---|---|
| `pnpm -w run verify` | 全仓 25+ 包全绿（adviser 96 / access 411 / prompt-studio 365 / tasks 848 / memory 500 …） |
| `packctl check` | 0 error（2 条 CHK900 为「需 DSH 运行时的装卸冒烟」既有 warning） |
| `packctl form-check` | **0 finding**（修掉了我引入的 6 条顺序冲突） |
| `packctl tenant-scan` | 2 finding — `glue/src/plugins/channels-plugin.ts:71,164`，**既有欠账**（stash 我的改动后仍在，属另一会话的 WIP，与 adviser 无关） |
| `packctl prompt-scan` | 4 finding — `profiles/eterna-super` 的 preset persona/plan-mode 未登记，**既有欠账**（同上，stash 后仍在；注册表只登记 eterna-web 侧行号） |

最后两项按纪律**不擅自改动**（别人的提示词账目/WIP），已在 §13.4 与本节留痕。

---

## 15. P4 收尾：全局工具泄漏——「只读 11/11」在生产形态下不成立（2026-11-24 实机定谳）

### 15.1 缺陷：预设挡不住全局工具

§11 记录的「参谋工具面 11/11 全只读」有**范围漏洞**：那次实测跑在**不含 glue 的最小
探针 profile** 里。真实部署（`eterna-web` / `eterna-super`）的 glue 在**根 ctx** 上
全局注册了写工具：

| 工具 | 注册方 | 性质 |
|---|---|---|
| `knowledge_propose` | `@eterna/glue/knowledge-plugin:191` | **写**（提案落库） |
| `memory_write` / `memory_forget` | `@eterna/glue/memory-plugin` | **写** |
| `install_personal_plugin` | `@eterna/access/plugin.ts:389` | **写**（+ 装载代码） |

而上游 `ToolsService.view(scope)` 的可见集是 **全局层 ∪ 作用域链各层**
（`packages/core/tools/src/index.ts:220-236`）：

```ts
const inherited = new Map(this.layers.global.tools.entries())      // ← 全局层先入
for (const layer of layers) { … inherited.set(name, registration) }  // ← 作用域层只覆盖/追加
```

**预设只往作用域层加工具，挡不住全局层。**

### 15.2 实机实证（`probe-global-leak.mjs`，9/10 → 缺陷确认）

在根 ctx 注册三个写工具后建参谋，读参谋 scope 的实际可见面：

```
FAIL  child/no-global-write-leak — 漏进参谋的写/执行/委派工具=
      ["install_personal_plugin","knowledge_propose","memory_write"]
      child/tool-surface = ["glob","grep","install_personal_plugin","knowledge_propose",
      "memory_write","read","read_image","session_event_read","session_event_search",
      "session_event_trace","session_search","session_trace","skill","working_directory"]
```

→ **参谋的工具面里确实有三个写工具**。§11 的「只读」结论只对空 profile 成立。

### 15.3 修法：预设内挂全局工具守门（`tool-guard.ts`）

| 候选 | 结论 |
|---|---|
| 在 `host.ts` 上 restrict | ✗ 拿的是**父**会话 ctx，限制会作用到主会话 |
| 只在 preset 里「不挂该行」 | ✗ 挡不住全局层（本缺陷） |
| 镜像只读工具进 scope | ✗ 会绕开 glue 的租户分库路由（admin→全局库 / 普通→`workspaces/<账号>`） |
| **预设内守门行 + 动态 deny** | ✅ 采用 |

实现要点（每条都有实机依据）：

1. **挂在 preset 的 plugins 末尾** —— 预设树挂在与所有绑定子会话相连的 scope 上
   （`agent-preset-registry/src/index.ts:282` `bindScopeParent(key, generation.key)`），
   限制沿链交叉，天然只作用于参谋。
2. **动态 deny = 全部全局名 − 只读白名单**（fail-closed）—— 写死清单会漏：access 热挂
   插件、将来的新 glue 工具都可能加进来。`ctx.tools.definitions()` **不带 scope 参数时
   返回全局视图**，正好给出 deny 名单该有的内容。
3. **白名单 `ADVISER_ALLOWED_GLOBAL_TOOLS`** = `working_directory` +
   `knowledge_search` / `knowledge_read` / `knowledge_status`。后三件是
   **P4 剩余缺口「知识库只读检索」的落地形态**：放行即继承 glue 的租户路由，无需另写封装。
   `knowledge_propose` 是写操作、且与只读三件同插件注册 → **必须逐名列举，不能通配**。
4. **订阅 `tools/change` 追捕晚注册** —— 全局工具可能在预设挂载后才注册（access 热挂
   插件是运行期随时）。实测不订阅 → 晚注册的 `late_writer` 会漏进参谋。
5. **订阅回调里必须异步** —— `restrict()` 自身 emit `tools/change`，同步调用会自递归：
   实测 `RangeError: Maximum call stack size exceeded`。改用 `queueMicrotask` + pending 合并。
6. **幂等** —— 只对尚未 deny 过的名字发限制，否则限制随变更次数累积。

### 15.4 修法实证（三份探针，全 PASS）

```
# ① 可行性:在 child scope 上 restrict({deny}) —— 9/9 PASS
PASS  fix/child-after        — 参谋工具(已封)=[…11 项只读…]
PASS  fix/no-write-leak      — 仍漏=[]
PASS  fix/preset-tools-intact — 预设工具保留=["read","grep","glob","session_search","session_event_read"]
PASS  fix/parent-unaffected  — 父会话仍见写工具=true
PASS  fix/restrict-reversible — 撤销后恢复=true

# ② 预设内守门行 —— 10/10 PASS(参谋工具面回到 11 项只读)
PASS  child/no-global-write-leak — 漏进参谋的写/执行/委派工具=[]

# ③ 白名单放行知识库只读三件 —— 7/7 PASS
PASS  child/knowledge-readonly-allowed — ["knowledge_search","knowledge_read","knowledge_status"]
PASS  child/writes-still-denied        — 仍漏的写工具=[]
PASS  parent/unaffected                — 父会话仍见全部工具=true

# ④ 晚注册追捕 —— 7/7 PASS
PASS  child/no-late-leak — 晚注册写工具是否漏进参谋=false
```

### 15.5 工单状态（super 形态）：为什么是自建薄封装，且**必须由宿主半边注册**

`orchestrator_read` 不可用有**两条**独立理由：① 它注册时带主会话白名单谓词
（`when: agent.id === masterId`），参谋看不见；② `@eterna/tasks` 是 **Tier2**，
adviser 属 Tier1，**Tier1 永不 import Tier2**（`packctl TIER001` 强制）。

故 `ticket-tools.ts` 经 `ctx.reflect.get('tasks', false)` 反射消费 `ctx.tasks.snapshot()`
（access 的 `TasksSettingsFace` 同手法），自制只读工具 `adviser_tickets`：

- **只用 `snapshot()`**，不用 `query(sql)` —— 后者即使有 SELECT 白名单也是「给模型任意
  查询面」，可能扫出别的 realm 的行；`snapshot()` 已按本栈 realm 归账。
- **阶段归纳显式标卡点** —— blocked / failed / 待答 / 投递失败一律前缀「卡点:」，避免
  参谋把卡住的事报告成「一切正常」。
- **不泄露内部字段** —— 只投影 id/title/stage/最新报告开头/问题/更新时间；
  `decisionId` / `mandate` / `channels` / `origin` / `inputs` 全不外传（有单测钉）。
- **优雅缺席** —— base 形态 tasks 行未挂 → `reflect.get` 返 undefined → **不注册**工具。
  「工具不存在」优于「注册了但每次调用必失败」：模型不会反复重试坏工具。

#### ⚠ 注册位置：**不能挂在 preset 里**（2026-11-24 实机二次定谳）

首版把 `adviser_tickets` 做成预设内的插件行（`@eterna/adviser/extras`）。真实
`eterna-super` boot 后参谋看不到该工具，诊断链如下：

```
# 预设内的临时诊断（已删除）
[extras-DIAG] reflect=false get=false hasTools=true      ← 预设内读不到 tasks
# 同一进程的宿主层
root/tasks-direct  — 根 ctx get('tasks')=true
root/tasks-reflect — 根 ctx reflect.get('tasks')=true
root/tasks-shape   — tasks.snapshot 是函数=true
# 预设行本身是激活的（不是 import 失败）
{"entryId":"adviser-extras","moduleName":"@eterna/adviser/extras","enabled":true,"fiberState":2}
```

根因：**预设 scope 是 isolate 的**。上游 `agentPresetRegistry.serviceForMount` 只认
「本 preset 子树自己提供的」服务，`leakService` 审计还专门把「预设内提供到 root realm
的服务」判为失败——宿主根 ctx 的 `tasks` 从预设内不可达。

**修法**：工单工具改由**宿主半边**在 `startActivation` 拿到 `childId` 之后注册到
**参谋 agent 的 ctx**（`registerTicketTool(hostCtx, agentCtx, agent)`），并用
`when: activation.agent.id === targetId` 按会话钉住，同一 preset 的其它会话也看不到。
这也顺带解释了为什么 `tool-guard`（守门）**可以**放在预设里：它只用 `ctx.tools`
（继承服务）与 `ctx.tools.restrict`（scope-local 副作用），不跨 isolate 读别的 realm。

#### 两形态实证（真实 profile，各 13/13 PASS）

| 判定 | eterna-super | eterna-web |
|---|---|---|
| tasks 服务 | ✅ 在场 | ✅ 缺席（符合预期） |
| 参谋工具面 | 15 项（含 `adviser_tickets`） | 14 项（**无** `adviser_tickets`） |
| 全局写工具泄漏 | ✅ 零 | ✅ 零 |
| 知识库只读三件 | ✅ 全在 | ✅ 全在 |
| 预设只读工具 | ✅ 全在 | ✅ 全在 |
| 主会话受影响 | ✅ 否（仍见写工具） | ✅ 否 |

super 侧参谋完整工具面：

```
["adviser_tickets","glob","grep","knowledge_read","knowledge_search","knowledge_status",
 "read","read_image","session_event_read","session_event_search","session_event_trace",
 "session_search","session_trace","skill","working_directory"]
```

### 15.6 门禁

```
adviser:  lint 0 / tsc OK / 137 tests（11 文件）✅
          新增 tests/tool-guard.test.ts(18) + tests/ticket-tools.test.ts(23)
```

`ticket-tools.test.ts` 里额外钉了 **Tier1 import 纪律**的本地快速反馈（源码不得出现
`@eterna/tasks` 的 import），因为 packctl 是 CI 面，本地跑单测时更需要即时失败。

---

## 16. P9 收尾：preset 必须在 **profile** 里定义（2026-11-24 实机定谳）

### 16.1 缺陷：`packages/*/cordis.patch.yml` 里的 preset 不会进 profile

P9 只往两个 profile 加了一行 `@eterna/adviser` 插件。真实 `eterna-super` boot 后
create 参谋直接失败：

```
FAIL  setup/adviser-created — {"ok":false,"code":"preset-missing",
      "message":"参谋组合(agent preset)未装配:Unknown agent preset: eterna-adviser"}
```

根因：profile 的 patch 只 `insert` **插件行**，**不加载包内 bundle 的 patch**。
`packages/adviser/cordis.patch.yml` 里那段 `eterna-adviser-preset` 定义因此从未进入
profile 树。本文件其它 preset（`preset-cordis` / `preset-standard`）同样是**整份
config 重述**在 profile 里——不是因为偷懒，而是机制要求如此。

**修法**：把 `eterna-adviser-preset` 整段定义写进

- `profiles/eterna-web/cordis.patch.yml`
- `profiles/eterna-super/cordis.patch.yml`
- `docker/profile/cordis.patch.yml.template`
- `docker/profile/cordis.super.patch.yml.template`

四处（FORM001 要求模板与清单**按序**一致，少一处即漂移）。包内
`cordis.patch.yml` 保留同一段作为**独立使用时**的自足配方（bundle 加载路径）。

### 16.2 该缺陷为什么 P9 没发现

P9 的验收是「真 boot 后花名册含 `@eterna/adviser`」——那验证的是**插件装载**，
不是**preset 可用**。preset 只在 `create` 时才被解析，所以必须真的跑一次
create 才能暴露。教训：**挂载面验收要覆盖该功能的真实调用路径**，不能只验装载清单。

### 16.3 两形态最终实证

| 形态 | 宿主条目 | presets | 参谋 create | 工具面 |
|---|---|---|---|---|
| eterna-web | 221 | 3 | ✅ | 14 项（无工单） |
| eterna-super | 227 | 3 | ✅ | 15 项（含 `adviser_tickets`） |

`verify-eterna-web.mjs` 15 PASS / `verify-eterna-super.mjs` 19 PASS（均 exit 0）。
探针层各 13/13 PASS（见 §15.5 的表）。

---

## 17. P10 门禁终态（2026-11-24）

| 门禁 | 结果 |
|---|---|
| `pnpm -w run verify` | **exit 0**，全仓 39 包全绿（adviser 141 / access 411 / prompt-studio 365 / tasks 848 / memory 500 / compaction 230 / toolkit 249 / workbench 213 / glue 118 / panel 56 …） |
| `packctl form-check` | **0 finding** |
| `packctl check` | **0 error**（2 条 CHK900 为「需 DSH 运行时的装卸冒烟」既有 warning） |
| `packctl tenant-scan` | 2 finding — `glue/src/plugins/channels-plugin.ts:71,164`，**既有欠账**（他人 WIP，stash 核实过） |
| `packctl prompt-scan` | 4 finding — `profiles/eterna-super` 的 preset persona/plan-mode 未登记，**既有欠账**（同上） |
| `verify-eterna-web.mjs` | **exit 0**（15 PASS，221 条目） |
| `verify-eterna-super.mjs` | **exit 0**（19 PASS，227 条目） |

### 17.1 环境注记（真 boot 的前置）

仓库 `node_modules/@deepseek-ai` 只有 3 个包（`dsh` / `dsh-sdk-client` /
`dsh-session@alpha.2`），缺 `dsh-session-title-llm` / `dsh-jobs` / `dsh-attachment`
等传递依赖，真 boot 在装载期即崩（21 个插件 failed）。这是**环境既有的安装不完整**，
与本次改动无关。

跑真 boot 用的替代路径：`~/.dsh/profiles/node_modules`（250 个包、
`dsh-session@0.2.2-rc.1`）。做法是把 verify 脚本里的 `dshBin` 临时指向该处的
`@deepseek-ai/dsh/lib/bin.js`，并把 `@deepseek-ai` 与各 `@eterna/*` symlink 进
profile 的 `node_modules`。**该替换只在 /tmp 的一次性脚本里做，仓库脚本未改。**
