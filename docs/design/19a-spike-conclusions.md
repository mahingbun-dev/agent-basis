# 19a - 记忆系统 Spike 勘察结论(S-1 … S-5)

> 状态:Spike 结论文档(19 号 §8 五项核实,开工首日完成,结论回填)
> 日期:2026-11-13
> 上游:[[19-记忆系统开发文档-M-M1至M-M3]] §8(Spike 清单);关联 [[17-记忆系统调研与优化设计]]、[[18-记忆机制定制设计-两层记忆与RSI上升]]
> 读法:每节三段——**结论**(可直接写代码)/ **证据路径**(本节勘察实际读取与实跑的全部出处)/ **采用的退路**;文末一节给出对 19 号 §8 及正文受影响条目的修订建议。
> 证据基线:dsh 运行时类型与事件词表核对自只读源仓 `/Users/sunny/code/deepseek-harness`(版本 0.2.2-rc.1,与本仓 node_modules 同版本);持久化事件负载另用本机真实会话日志(`~/.dsh/sessions/...`)解码实测确认。本仓 node_modules 只装了 `@deepseek-ai/dsh`(CLI 插件管理 bundle)与 `dsh-sdk-client`,运行时词表不随包安装,故词表以源仓为准。

## 总览

| # | 核实项(对应 19 §8) | resolved | 采用的退路 |
|---|---|---|---|
| S-1 | 会话/turn 结束事件名与负载;session log 中工具调用记录的读取面 | ✅ | 未采用(resolved=true);备而不用:19 §7 惰性检查退路 |
| S-2 | interact ApprovalCardInput 的送达链路(注册面/事件面/UI slot) | ✅ | 19 §4 T9 第 3 点:M-M2 panel 审批列表最小版;官方 user-questions 卡片留 M-M3 |
| S-3 | turnTail slot 数据面:如何拿到本 turn 工具调用记录 | ✅ | 无(主路径已确定);`ToolsService.executable` wrap 降级为「仅计数」退路 |
| S-4 | schedule/jobs seam 与 `ctx.llm` 在 glue 层的取法 | ✅(llm 直调确定;schedule seam 判定**不可用**) | 周期触发半面采「会话尾触发+时间阈值合并」 |
| S-5 | 工具 execute 时可得 session 上下文(exec 参数形状) | ✅ | 无(已 resolved) |

---

## S1 会话/turn 结束事件与 session log 读取面(影响 T6)

### 结论

**A. turn 结束事件——确定**

- 持久化事件名:`turn/end`,负载 `data: { turn: number; reason: TurnEndReason }`(`types.ts:303`)。`TurnEndReason` 为 merge-extensible 判别联合,现有变体 `completed | aborted | blocked | error | max-tokens | interrupted | forked`(`types.ts:206-238`);正常收尾判 `reason.kind === 'completed'`。`interrupted`(crash 后补关)与 `forked`(fork 种子合成)由恢复/fork 路径追加,loop 从不现场发射。
- 实测确认(解码本机真实日志 `~/.dsh/sessions/--private-tmp-basis-ws--/session-2f4edf9c.../session.v4.jsonl.zstd`):
  `{"type":"turn/end","seq":250,"time":1793760609497,"data":{"turn":1,"reason":{"kind":"completed"}}}`。
- 事件信封:`{ type, seq, time, data, ignorable? }`(`types.ts:501-521`);日志首行是头行 `{"type":"session","version":4,"id","createdAt","cwd","isSeeded","delegationDepth"}`,扫描时跳过(实测确认)。

**B. 会话结束事件——无专用持久化事件,活面信号如下**

- `KNOWN_SESSION_EVENT_TYPES`(63 项,`known-event-types.ts:22-86`)中**没有 `session/end`**;`session/end-seed`(该文件 :57)是 fork 边界标记(`fork.ts:24`),不是会话结束。
- 活面(cordis,插件内订阅):
  - `'session/disposed' (session: Session)`——session 离开 live store 时 emit(`session/src/index.ts:65` 声明,:1322 发射点)。语义 = 显式 dispose/teardown/clear,长寿命 profile 下会话通常活到进程收尾,**不等于「会话逻辑结束」**。
  - 另有 `'agent/disposed' {agent}`(runtime-types.ts)与 `'agent/status' {agent, status:'idle'|'running'}`(runtime-types.ts:136、:309;idle = 无 driver 调度/活跃,即 turn 全部落定)。
- **T6 建议**:`trigger:'session-end'` 的主触发用 `session/event` 里的 `turn/end`(reason.kind==='completed')推进会话粒度游标;`session/disposed` 只作 teardown 兜底(fire-and-forget,勿 await)。若需要「落盘后扫全量日志」再启动整固,等 `'session/flush'`(awaited durability checkpoint,`session/src/index.ts:84` 一带)后再读盘。

**C. 插件订阅形态(本仓生产先例)**

```ts
import type {} from '@deepseek-ai/dsh-session'  // 触发 cordis Events 增广,缺它 ctx.on('session/event') 无类型(audit/src/plugin.ts:7-10 同款)
ctx.on('session/event', (session, event) => {
  if (event.type === 'turn/end' && event.data.reason.kind === 'completed') { /* consolidate trigger */ }
  if (event.type === 'tool/call' && event.data.name === 'memory_write') { /* 记 direct-write 防双写 */ }
})
```

生产先例:`packages/audit/src/plugin.ts:62-64`(session/event 投影)、`packages/compaction/src/basic/index.ts:303`(session/event)、:272(agent/status)。均为全局监听(不带 agent scope),同进程所有会话的事件都送达;监听失败被宿主 contain,不阻断 append。

**D. memory_write 工具调用读取面——确定**

- 活面:`event.type === 'tool/call'`,data `{ turn, step, callId: ToolCallId, name: string, arguments: string }`(`types.ts:369`);`name === 'memory_write'`(工具注册名,`packages/memory/src/tools.ts:38`、:127);`arguments` 是模型原样未解析 JSON 字符串,须 `JSON.parse`。与 `tool/result`(data `{ turn, step, message: ToolResultMessage{role:'tool',toolCallId,content,isError}, error?, meta? }`,`types.ts:383-393`)按 `callId` 配对;result 信封带 `sourceEventSeqs:[callSeq]` 与 `surfaceOp:'append'`(实测确认)。
- 盘面(离线/整固扫描):路径 `$DSH_HOME/sessions/<area>/session-<uuid>/session.v4.jsonl.zstd`,root 推导 `process.env.DSH_HOME ?? ~/.dsh` 再拼 `'sessions'`(`panel/src/snapshot.ts:207-210`);解码复用 `packages/panel/src/session-logs.ts` 的 `scanZstdFrames`(:25-67,多帧 zstd 容器字节级走查)+ `decodeZstdLog`(:70-77,每帧独立 `zstdDecompressSync` 后拼接);逐行 `JSON.parse` 后按 `record.type === 'tool/call' && record.data.name === 'memory_write'` 过滤;会话排序/跳过坏文件照抄 `listSessionLogs`(:122-149,mtime 倒序)与容错读(:152-177)。已实测:同算法解码真实日志得 tool/call 样本 `{"type":"tool/call","seq":17,...,"data":{"turn":1,"step":1,"callId":"call_00_...","name":"bash","arguments":"{\"command\"...}"}}`。

**E. 证据边界(如实)**

- 本仓 node_modules 只装了 `@deepseek-ai/dsh`(CLI 插件管理 bundle)与 `dsh-sdk-client`;dsh 运行时事件词表不在 node_modules 里,grep 其 `lib/plugin-*.js` 无 'turn/end'(那是 plugin-manager CLI,非运行时)。词表与类型取自只读源仓 `/Users/sunny/code/deepseek-harness`(版本 0.2.2-rc.1,与本仓 node_modules 同版本),持久化负载另用真实日志解码实测确认。
- 19 §8 的「隔离 profile 实跑抓事件」未单独执行;活面事件名以源仓类型增广声明 + 本仓两个生产监听插件(audit/compaction)在跑为先例证据,置信度足够;如需百分百现场抓包可在 T6 开发时用隔离 profile 复验。
- 小勘误:04 号笔记 §3 写「66 种」,当前源仓 checkout 实数 63 种(词表演进漂移,不影响本结论所需事件均在列)。

### 证据路径

- 源仓词表与类型:`/Users/sunny/code/deepseek-harness/packages/core/session/src/known-event-types.ts:22-86`(KNOWN_SESSION_EVENT_TYPES 全量 63 项:turn/end :80、turn/start :81、tool/call :76、tool/result :79、session/end-seed :57;无 session/end);`.../session/src/types.ts:303`(`'turn/end': { turn: number; reason: TurnEndReason }`);`types.ts:206-238`(TurnEndReasonMap:completed/aborted/blocked/error/max-tokens/interrupted/forked;interrupted/forked 非 loop 现场发射);`types.ts:369`(tool/call 负载,arguments 为 raw JSON string);`types.ts:383-393`(tool/result 负载);`types.ts:501-521`(SessionEvent 信封)。
- 源仓活面:`.../session/src/index.ts:65`('session/disposed' 声明);:68-78('session/event' post-commit fire-and-forget 声明);:82-88('session/flush' awaited checkpoint);:1322-1325(session/disposed 发射点);`.../session/src/fork.ts:24`(session/end-seed 是 fork 种子边界标记);`.../agent/src/runtime-types.ts:136`(AgentStatus = 'idle'|'running')、:309('agent/status' 事件)、:417('agent/turn-stopping' 串行 waterfall)。
- 本仓生产先例与盘面:`packages/audit/src/plugin.ts:7-10, 62-64`(import type {} 触发类型增广 + ctx.on('session/event') 生产先例);`packages/compaction/src/basic/index.ts:272, 303`(agent/status 与 session/event 生产监听先例);`packages/panel/src/session-logs.ts:25-67, 70-77, 88-113, 122-149, 152-177`(scanZstdFrames / decodeZstdLog / foldSessionEvents / listSessionLogs / 读盘容错——session.v4.jsonl.zstd 盘面读取先例);`packages/panel/src/snapshot.ts:207-210`(DSH_HOME ?? ~/.dsh + 'sessions' root 推导);`packages/memory/src/tools.ts:38, 127`(MEMORY_TOOL_NAMES 含 'memory_write';defineTool name:'memory_write')。
- 实跑:`node /tmp/s1-decode.mjs <真实日志>`——`~/.dsh/sessions/--private-tmp-basis-ws--/session-2f4edf9c-61df-4d00-af28-fa6e9eda3963/session.v4.jsonl.zstd` 解码 252 行,直方图含 turn/end:1、tool/call:41、tool/result:41;样本:turn/end data={turn:1,reason:{kind:'completed'}};tool/call data={turn:1,step:1,callId:'call_00_...',name:'bash',arguments:'{...}'};tool/result data.message.toolCallId 配对 + sourceEventSeqs:[17];首行头 `{"type":"session","version":4,...}`;另核 `~/.dsh/sessions/--private-tmp-basis-ws--/session-3fdcd2c9.../` 日志(10 行,turn/end reason.kind:'error' 变体)。
- 参考:`docs/design/04-DSH源码设计笔记.md` §3(18-24 行:loop 流程终点 turn/end、known-event-types 指路;其「66 种」计数与当前 checkout 63 项有漂移)。
- node_modules 核查:`grep 'turn/end' /Users/sunny/code/agent-basis/node_modules/@deepseek-ai/dsh/lib/plugin-DscIHF4k.js` 计数 0(CLI bundle 非运行时);dsh/package.json 显示 dsh-session 0.2.2-rc.1 仅列 devDependencies 未随包安装——词表须读源仓。

### 采用的退路

未采用(resolved=true)。备而不用:若 T6 实现期放弃事件触发,采用 19 号 §7 退路「下一条用户消息到达时惰性检查上个已结束会话」(纯库内、无 seam 依赖);本结论已给其所需的盘面判定依据——扫 `session.v4.jsonl.zstd` 末尾 `turn/end`(reason.kind)即可判定会话是否已结束。

---

## S2 interact 审批卡片送达链路(影响 T9)

### 结论

**链路核实(注册面/事件面/消费 slot 全部确定)**

1. **interact 卡片面(本仓纯函数,零内核依赖)**:
   - `buildApprovalCard(input: ApprovalCardInput): ApprovalCard`(`packages/interact/src/card.ts:133`,fail-closed 校验)→ `cardToQuestionItems(card, options?): AskUserQuestionItem[]`(card.ts:198),产出官方 user-questions 载荷:1 问 + intent `{kind:'approval', approve, reject, subject:{name}}`(approve/reject 恰覆盖 options,R3 doubleConfirm 追加第二问)。
   - 组合层发送回调形态:`TurnQuestionMergerOptions.onFlush`(ask.ts:129 注释:组合层在此真正发起 ask_user_question / ctx.userQuestions.ask);seam-pin 钉住 flush 产物可零转换作为 `AskUserQuestionRequestEvent.questions`(tests/types.seam-pin.ts:41-43)。

2. **官方服务面(注册面)**:宿主 dsh-base 0.2.2-rc.1 装品 cordis.patch.yml 已装载行 `user-questions`(@deepseek-ai/dsh-user-questions,装品 :79-80)与 `approval`(dsh-user-approval,:260),eterna-web patch 未裁它们——`ctx.userQuestions` 服务在宿主可 inject;调用形态 `await ctx.userQuestions.ask({ questions })`(官方 tool-ask-user 同款:`lib/index.js:195-197` `ctx.userQuestions.ask({...request, wait:{callId}})`,inject=["tools","userQuestions"])。带 agent 的请求要求 live runtime root;agentless 请求走 unscoped 本地 waterfall 答者,无人接报 NO_PROVIDER(包 README)。

3. **官方事件面**:`Events['user-questions/request']` waterfall(dsh-user-questions/lib/types/types.d.ts:165-176,Scoped<Agent>);插件 ctx.on 结构面 cast 先例 = access plugin.ts:186 的 `on('approval/request')`。工具审批对应 `approval/request` waterfall(dsh-user-approval)。

4. **UI 消费 slot(断点)**:`conversation.approval.card`(dsh-client-ui-approval slots.d.ts SlotFactoryMap,scope:'session',props 为该包自己的 ApprovalCardInput——requestKey/title/canAnswer/onAllow/onReject,与 interact 的同名类型是两套);user-questions 面在 dsh-client-ui-user-questions。这两个 client 包**均未打进 dsh-web-frontend 0.2.2-rc.1 发行包**:dist/assets/index-BgUyXZcc.js 中 'approval' 字符串 0 命中(grep 实测),`__ModuleLoader__` 内嵌 client 包仅 dsh-client-store/ui-dockkit/ui-primitives/ui-slots;access approval-bridge.ts:2-5 头注 + session-7e15e6ab 事故(31+ 分钟假死)实证 pending 卡 web 前端不可见。→ **官方卡片送达需上游发行包改造(宿主级),非本仓最小接入可解**。

5. **本仓 access 两套审批实现(S-2 要求核实的「审批队列分区」)**:
   - 工具审批桥:ApprovalBridge.installAnswerer 注册 approval/request 答者(approval-bridge.ts:92,已知归属会话才接手,未知 next() 透传;plugin.ts:185-187 装配)→ 轮询端点 `GET /access/api/approvals/tool-pending` + `POST tool-decide`(routes.ts:99-100,归属校验在 bridge.decide/listFor)→ body 级横幅卡 approval-card.tsx(4s 轮询,允/拒;installApprovalCard 经 createRoot 挂载,client/index.tsx:346)。超时 'unavailable'、abort 'cancelled',语义对齐内核 ApprovalOutcome。
   - 插件转内置审批队列分区:settings.section slot,id `eterna-access.approval-queue`(admin 专属,order 44,client/index.tsx:380-392);ApprovalQueueSection(my-plugins-section.tsx:156-193)消费 `/api/approvals/pending` + `/api/my-plugins/promote-decide`——数据库队列,与内核 waterfall 无关。

**M-M2 最小接入方式(采 19 号 §4 T9 第 3 点退路)**

1. 卡片对象:pending 产生时组 interact ApprovalCardInput(标题「从本次会话学到…」、Why=出处会话摘要、Action=记住/跳过),`buildApprovalCard()` 校验并渲染 detail——**类型复用,但不投官方通道**。
2. 队列 UI:`packages/panel/src/snapshot.ts` readMemory(sqlite 只读,:108-127)增 `pendingCount` + MemorySnapshot(types.ts:22)扩字段;面板审批列表批/拒(拒两击确认,ArmedDelete 先例 confirm-button.tsx);裁决走 `Memory.review(id, state)`(T2 建)。前置依赖:M-M1 T1 先加 review_state 列(现 packages/memory 源码无此列,grep 实证)。
3. 官方通道一行切换面预留:consolidation 内保留 `cardToQuestionItems(card)` → `ctx.userQuestions.ask({ questions })` 调用点(形态零转换,seam-pin 已钉);上游 web 发行包纳入 client-ui-approval/user-questions 后启用。若 M-M3 需 web 档即时卡片,同构 ApprovalBridge 做 unscoped `'user-questions/request'` 宿主答者 + 轮询端点 + 横幅卡(memory 审批非工具调用、无 callId/wait 键,按 question id 自管),工程量大于 panel 列表,故 M-M2 不取。

### 证据路径

- interact 链路:`packages/interact/src/card.ts:12-15`;`card.ts:133-181`;`card.ts:198-229`;`packages/interact/src/ask.ts:125-130`;`packages/interact/tests/types.seam-pin.ts:41-43`;`types.seam-pin.ts:61-69`。
- 官方包:`packages/interact/node_modules/@deepseek-ai/dsh-user-questions/lib/types/types.d.ts:147-176`;`lib/index.js:270`;`lib/index.js:676`;`README.md:12`;`node_modules/.pnpm/@deepseek-ai+dsh-tool-ask-user@0.2.2-rc.1_*/node_modules/@deepseek-ai/dsh-tool-ask-user/lib/index.js:186-198`、`:216`。
- 宿主装载与断点:`.basis-home-t7/profiles/t7-studio/node_modules/.pnpm/@deepseek-ai+dsh-base@0.2.2-rc.1_*/node_modules/@deepseek-ai/dsh-base/cordis.patch.yml:79-80`、`:260`;`.basis-home-t7/profiles/t7-studio/node_modules/.pnpm/@deepseek-ai+dsh-web-app@0.2.2-rc.1_*/node_modules/@deepseek-ai/dsh-web-app/cordis.patch.yml:325-326`、`:461-462`、`:244-245`;`node_modules/.pnpm/@deepseek-ai+dsh-web-frontend@0.2.2-rc.1_*/node_modules/@deepseek-ai/dsh-web-frontend/dist/assets/index-BgUyXZcc.js`(grep 实测:'approval' 0 命中;dsh-client* 仅 store/ui-dockkit/ui-primitives/ui-slots;__DSH_BOOT__×1 / __ModuleLoader__×2);`node_modules/.pnpm/@deepseek-ai+dsh-client-ui-approval@0.2.2-rc.1_*/node_modules/@deepseek-ai/dsh-client-ui-approval/lib/types/client/contract/slots.d.ts`(conversation.approval.card SlotFactoryMap 与 ApprovalCardInput props)。
- 本仓先例:`packages/access/src/approval-bridge.ts:2-18`;`approval-bridge.ts:92-102`;`approval-bridge.ts:117-131`;`packages/access/src/plugin.ts:161-187`;`packages/access/src/routes.ts:99-100`;`routes.ts:122-141`;`packages/access/src/client/approval-card.tsx:20-37`;`approval-card.tsx:103-121`;`packages/access/src/client/index.tsx:340-346`;`client/index.tsx:377-392`;`packages/access/src/client/my-plugins-section.tsx:156-193`。
- panel 面与挂载:`packages/panel/src/snapshot.ts:6-9`;`snapshot.ts:108-127`;`packages/panel/src/types.ts:22-34`;`packages/glue/src/plugins/memory-plugin.ts:12-25`;`profiles/eterna-web/cordis.patch.yml:255-256`;`:413-414`。
- 19 号文档:`docs/design/19-记忆系统开发文档-M-M1至M-M3.md:174-180`;`:178`;`:259-268`。
- 前置核实:`grep -rn 'review_state' packages/memory/src/*.ts` → 无命中(现库无该列,M-M1 T1 前置)。

### 采用的退路

19 号文档 §4 T9 第 3 点(M-M2 最小版,`docs/design/19-记忆系统开发文档-M-M1至M-M3.md:178`):panel snapshot 增 pendingCount + 面板审批列表(批/拒按钮,两击确认拒绝);interact 卡片经官方 user-questions / conversation.approval.card 的完整体验留 M-M3、待上游 web 发行包纳入 client-ui-approval/user-questions 后启用。

---

## S3 turnTail slot 数据面:本 turn 工具调用记录(影响 T12-4)

### 结论

turnTail 数据面有确定接口,无需退路。**推荐主路径 = 上游官方插件(dsh-client-ui-deliverables / dsh-client-ui-schedule)同款的「ConversationNodeDefinition 累计 + turnTail slot 消费」两步法**,可精确到本 turn 且天然支持历史回放;服务端 `ToolsService.executable` wrap 先例(companion-inject.ts)仅能按会话计数、拿不到 turn 号,降级为计数退路或观测补充。

**主路径:客户端 Conversation 事件累计(先例:dsh-client-ui-deliverables client.js:1151-1254 + 2618 + 2629;dsh-client-ui-schedule client.js:19257 + 19394-19408)**

第 1 步——注册会话事件累计器(在 memory 插件的 dsh.client 半边,inject 清单声明 'uiConversation'):

```ts
ctx.uiConversation.events.register({
  kind: 'memory-sources',            // 与 buildLocationData 的 key 一致
  match(event) {
    if (event.type === 'turn/start') return { id: String(event.data.turn), role: 'start' }
    if (event.type === 'tool/call') return { id: String(event.data.turn), role: 'update' }
    if (event.type === 'tool/result') return { id: String(event.data.turn), role: 'update' }
    return null
  },
  start(_ctx, match) { return { turn: match.event.data.turn, calls: new Map(), reads: [] } },
  update(ctx, match) {
    if (match.event.type === 'tool/call') { /* calls.set(String(event.data.callId), {name: event.data.name, argsRaw: event.data.arguments}) */ }
    if (match.event.type === 'tool/result') { /* 按 message.source.callId 回查 calls;name ∈ {'memory_read','memory_search'} 时累计 */ }
    return nextState
  },
  buildLocationData(ctx, scope, previous) {
    if (scope !== 'turn') return null
    return { kind: 'turn', turn: ctx.state.turn, key: 'memory-sources', value: { reads: [...] } }
  },
})
```

关键事实:session 事件自带 turn 号——`'tool/call'` 负载 = `{ turn, step, callId, name, arguments: string }`(dsh-session types.d.ts:362-368);`'tool/result'` 负载 = `{ turn, step, message: ToolResultMessage(其 .source.callId 配对), error?, meta? }`(types.d.ts:382-399)。引擎的 Conversation Location 索引先于定义运行,记录不会跨 turn 溢出(schedule 注释原话:"The Conversation Location index owns Turn membership before this runs")。工具名常量直接用本仓 `packages/memory/src/tools.ts:38` 的 `MEMORY_TOOL_NAMES`。

条目摘要的两种来源:

- (a) 从 tool/result 的 `message.content` 解析结果 JSON(memory_search 返回 `{count, hits:[{source,kind,title,summary}]}`,memory_read 返回 `{found, record:{key,summary}}`——schedule 包正是这么窄化 schedule_create 结果,注释确认「Session-log replay reproduces the card with no Host change」);
- (b) 更干净:memory 插件自己是工具属主,给 defineTool 的 output 补 `presentationMeta(args, value) => JsonValue`(dsh-tools ToolOutputDefinition,persisted on tool/result 的 meta,「Client renderers to narrow independently」),客户端直接读 `event.data.meta` 零解析。

第 2 步——注册 turnTail 槽位消费(kind:'list',scope:'session',每个注册一个条目):

```ts
ctx.slots.inject('conversation.chat.turnTail', () => ctx.slots.register({
  name: 'conversation.chat.turnTail', id: 'memory-sources', locale: NS, order: 20,
  inject: (sessionId) => ({ /* 打开面板等回调 */ }),
}, MemorySourcesRow))
```

组件 props 为 `TurnTailOwnerProps = { turn: TurnLocation, seq, openFile }`,数据读取一行:`owner.turn.data.get('memory-sources')?.reads`(配 deliverables 的 selectProducedFiles 同款「无数据返回 null 不挂载」闸);类型面用 `declare module '@deepseek-ai/dsh-client-ui-conversation/client' { interface ConversationTurnDataMap { 'memory-sources': MemorySourcesTurnData } }` 声明合并(deliverables turn-deliverables.d.ts:24-29 同款)。该槽只在 completed Turn 渲染("before a completed Turn's action row"),语义与「本回合用到 N 条记忆」吻合;历史会话回放天然复现(两个官方先例均如此)。UI 纪律按 AGENTS.md:设计令牌 `--et-*` 经 `--dsw-alias-*`、图标走 `@eterna/ui/icons`、文案中文。

**服务端 wrap 路径(companion-inject.ts 先例)的定位与硬边界**

installCompanionExecutableWrap 同款手法可做观测版:wrap `tools.executable`,对 memory_read/memory_search 返回 shadow def,execute 里只读 `(exec.name, args, result, exec.agent.session.id)` 记账后原样透传 `def.execute(args, exec)`——不改写冻结参数,符合 frozen-args 铁律(dsh-tools pipeline.js createExecution 对 arguments snapshot+deepFreeze,合同明文「Input rewriting is excluded」)。但 ToolRunContext(= ToolExecutionInput + deferContext/concludeTurn)只有 callId/name/arguments/agent/toolSet/parent/signal,**没有任何 turn 字段**——wrap 只能按 (sessionId, callId) 计数,无法归因到 turn 号。另两条已知坑:宿主 ctx 未在 inject 清单声明 'tools' 时 cordis get-trap 直接抛错(readToolsService 必须 try/catch);存在绕过 executable 的自定义 source.get 分发路径时 wrap 不生效(退化为不记录,不炸)。

**服务端会话日志扫描(panel 先例)**

会话日志为 JSONL(`{type,time,data}`),`packages/panel/src/session-logs.ts:88-113` foldSessionEvents 已证明服务端可解码折叠;同一手法可按 `data.name ∈ {memory_read, memory_search}` 且 `data.turn === N` 统计任意会话任意轮次,适合 T13 指标/验收,不适合实时会话 UI(需要读文件+解码 zstd)。

**落地建议**:T12-4 用主路径(definition + turnTail slot + presentationMeta);T13 指标与验收用日志扫描;wrap 路径按 19 号文档原设想的优先项保留为「仅计数」退路(拿不到 turn 号时),不入会话 UI。

### 证据路径

- slot 合同:`node_modules/.pnpm/@deepseek-ai+dsh-client-ui-chat@0.2.2-rc.1_*/node_modules/@deepseek-ai/dsh-client-ui-chat/lib/types/client/contract/slots.d.ts:436-440`('conversation.chat.turnTail':kind 'list',scope 'session',owner TurnTailOwnerProps);`slots.d.ts:41-45`(TurnTailOwnerProps = { turn: TurnLocation; seq: number; openFile })。
- Conversation 合同:`node_modules/.pnpm/@deepseek-ai+dsh-client-ui-conversation@0.2.2-rc.1_*/node_modules/@deepseek-ai/dsh-client-ui-conversation/lib/types/client/contract/conversation.d.ts:87-95`(TurnLocation:turn 号 + steps + data: ConversationLocationDataStore<ConversationTurnDataMap>);`:33-46`(get/source 读取面);`:20-21`(ConversationTurnDataMap 空表待声明合并);`:180-235`(ConversationNodeDefinition:match/start/update/buildLocationData);`lib/types/client/conversation/event-registry.d.ts:19-25`(register(ConversationNodeDefinitionInput) 返回幂等 disposer);`.../conversation/assembly.d.ts:42`(UiConversation.events);`.../client/index.d.ts:55`(ctx.uiConversation)。
- 官方先例实现:`node_modules/.pnpm/@deepseek-ai+dsh-client-ui-deliverables@0.2.2-rc.1_*/node_modules/@deepseek-ai/dsh-client-ui-deliverables/lib/client.js:1151-1254`(deliverablesDefinition:match turn/start + tool/call + tool/result,按 callId 累计,buildLocationData 发布 key 'deliverables');`:2618`(ctx.uiConversation.events.register);`:2629-2643`(slots.inject('conversation.chat.turnTail', ...));`:2583`(owner.turn.data.get('deliverables'));`lib/types/client/turn-deliverables.d.ts:24-29`(declare module 声明合并 ConversationTurnDataMap.deliverables)、`:59`(deliverablesDefinition 导出类型);`node_modules/.pnpm/@deepseek-ai+dsh-client-ui-schedule@0.2.2-rc.1_*/node_modules/@deepseek-ai/dsh-client-ui-schedule/lib/client.js:19257`(ctx.uiConversation.events.register(scheduleTurnDefinition));`:19394-19408`(turnTail 槽注册含 inject(sessionId));scheduleTurnDefinition 段(name === 'schedule_create' 过滤,key 'schedule-created',注释:Location 索引先于定义运行、任务不跨 Turn 溢出;结果 JSON 窄化使 Session-log 回放无 Host 改动复现卡片)。
- 事件负载与 meta:`node_modules/.pnpm/@deepseek-ai+dsh-session@0.2.2-alpha.2_*/node_modules/@deepseek-ai/dsh-session/lib/types/types.d.ts:362-368`('tool/call' 负载);`:382-399`('tool/result' 负载;meta 由产出工具自持形状、JSON 可序列化、durable log 回放同卡);`node_modules/.pnpm/@deepseek-ai+dsh-tools@0.2.2-rc.1_*/node_modules/@deepseek-ai/dsh-tools/lib/types/contracts.d.ts:14-25`(ToolOutputDefinition.presentationMeta(args,value)=>JsonValue);`:143-153`(ToolResult.meta:persisted on tool/result,供 Host presenters 与 Client renderers 独立窄化)。
- 本仓:`packages/memory/src/tools.ts:38`(MEMORY_TOOL_NAMES = ['memory_write','memory_read','memory_search','memory_forget']);`:164-227`(memory_read 返回 {found, record{key,summary}};memory_search 返回 {count, hits:[{source,kind,title,summary}]});`packages/access/src/companion-inject.ts:123-143`(installCompanionExecutableWrap:实例级 wrap tools.executable + WeakMap shadow + disposer);`:105-113`(readToolsService try/catch:cordis 未声明 inject 时 get-trap 抛错);`:61-65`(sessionIdOf:exec.agent.session.id);`:4-24`(头注:arguments 冻结、合同禁 pre-execute 改写、绕过 executable 的 source.get 旁路使 wrap 失效但退化不炸);`node_modules/.pnpm/@deepseek-ai+dsh-tools@0.2.2-rc.1_*/node_modules/@deepseek-ai/dsh-tools/lib/types/contracts.d.ts:152-183`(ToolExecutionInput:callId/name/arguments/agent/toolSet/parent/signal——无 turn 字段)、`:208-215`(ToolExecution)、`:231-249`(ToolRunContext 仅加 deferContext/concludeTurn)——服务端 wrap 拿不到 turn 号的直接证据;`packages/panel/src/session-logs.ts:88-113`(foldSessionEvents:会话日志 JSONL {type,time,data} 折叠先例)。
- 19 号文档:`docs/design/19-记忆系统开发文档-M-M1至M-M3.md:263`(§8 S-3 行)与 `:216`(T12-4 Sources 行:数据=本 turn memory_read/memory_search 工具调用记录)。

### 采用的退路

无(已 resolved,主路径接口确定)。仅内部降级项:服务端 `ToolsService.executable` wrap(19 号 T12-4 原设想的优先路径)因 ToolRunContext 无 turn 字段,降级为「仅按会话计数」的观测退路,不入会话 UI;T13 指标与验收用会话日志扫描。

---

## S4 schedule/jobs seam 与 ctx.llm 在 glue 层的取法(影响 T7/T11)

### 结论

**A. T7 glue 层直调 LLM——确定可用,照抄两处先例**

1. 服务取法:`ctx.llm: LlmRuntime` 是 cordis Context 增强服务(dsh-llm lib/types/index.d.ts:28-31)。glue 插件对象用 inject 对象形态声明(照 `packages/glue/src/plugins/memory-plugin.ts:15` 的 `{ tools: true, ..., governance: false } as never` 写法,新增 `llm: true` 硬依赖——'llm' 行在 eterna-web 生产宿主树恒在场,`scripts/verify-eterna-web.mjs:75` HOST_KEPT_ROWS 实证);库内文件收 `ctx: Context` 参数直调(compaction 先例:`basic/index.ts:117` `static inject = ['llm', 'tokenMeter', 'sessions']`,summarizer.ts:120-126 收 ctx 直调)。`packages/memory` 需在 package.json 增 `"@deepseek-ai/dsh-llm": "catalog:"`(pnpm-workspace.yaml:29 已有 catalog 0.2.2-alpha.2)拿 BlockAssembler/GenerateOptions/LlmError 类型。

2. 调用形态(无 agent 会话的 one-shot,冻结 prompt 版):
   `const call = await ctx.llm.prepareCall({ provider, model, maxTokens }, signal)` → `const assembler = new BlockAssembler()` → `for await (const chunk of call.stream(deepFreeze({ ...call.config, system: FROZEN_EXTRACTION_PROMPT, messages: [{ role: 'user', content: [{ type: 'text', text: 会话快照+现有记忆 manifest }] }], maxTokens, signal }))) assembler.push(chunk)` → 结果取 `assembler.blocks()`(ContentBlock[])、`assembler.finish`(FinishReason,照 summarizer.ts:196-211 finishError 映射)、`assembler.usage`(TokenUsage)。`...call.config` 必须展开进 options(PreparedLlmCall 契约:请求 call-config 字段不匹配报 INVALID_PREPARED_CALL,dsh-llm lib/types/index.d.ts:95-115)。直接 `ctx.llm.stream(options)` 也可(summarizer.ts:163 先例),但 prepareCall 能力校验/适配器默认更稳——上游无 agent 一次性直调先例是 session-title-llm(`node_modules/@deepseek-ai/dsh-session-title-llm/lib/index.js:181-215`,正是 prepareCall→deepFreeze({...call.config, messages, system, purpose, signal})→call.stream 形态)。

3. 类型面铁律:GenerateOptions(dsh-llm lib/types/types.d.ts:530-575)`system?: string`(:547,文档明写「System prompt text for one-shot callers」——就是为 T7 这种冻结 prompt 一次性调用设计);`messages` 可为 identity-free 的 RequestUserInput;`sessionId`(:565)与 `toolHistory` 均可选,整固 job 无会话就都不传;**`purpose?: 'compaction' | 'session-title'`(:571)是封闭联合,T7 不得写 `purpose: 'consolidation'`(TS 编译错;deepseek-harness 源仓只读不可扩)——留空即普通会话分类**。curator 模型路由只从 config 取(19 §6 `consolidation.model`);可选 `ctx.llm.listProviders()` / `listModels(provider)` 兜底校验,compaction 另有 `ctx.llm.resolveModelInfo(provider, model, signal)` 先例(basic/index.ts:423)。缓存复用注意:summarizer.ts:25-31 的 KV-cache 复用是「回放会话前缀」专属技巧,T7 提取是独立调用,不回放会话、不传 tools/toolHistory,直接 system+user 一发。

**B. T11 重量 Dream 周期触发——schedule seam 判定不可用,采退路**

判定依据:`ctx.schedule: ScheduleService` 服务存在(dsh-schedule lib/types/index.d.ts:24-34,含 `create(request: ScheduleCreateRequest, actorSessionId?, signal?)` :98)且生产档在场(verify-eterna-web.mjs:81 宿主行 'schedule'、:114 预设内 tool-schedule),**但语义是「把指令 prompt 投递进已有/新建会话」**(README.zh.md:2、:12:「投递到已有或新建对话」「投递时宿主必须运行」)——用它驱动 Dream = 每天往一个会话注入用户可见指令、烧主模型整 turn、带全套工具面,与 19 §5 T11 库内 curator 冻结 prompt 直调+审批卡片+窄读设计正面冲突,还会踩 T6 门控(no-prose/单轮跳过)语义;其事件面只有 `schedule/resolve-agent` / `schedule/changed`(index.d.ts:7-22),无「投递时回调库代码」钩子。`dsh-jobs` 亦不可用:任务归属启动它的 agent 会话、进程内注册表随 harness 进程终止而消失、无 cron(README.zh.md:40、:57)。cordis fork 无 ctx.setInterval/timeout 定时器面(lib/types/*.d.ts grep 零命中)。仓内也无周期任务先例(audit「按日」只是文件名按记录 at 轮转,daily-sink.ts:24-29)。

退路写法(会话尾触发+时间阈值合并):T6 的 `consolidateOnSessionEnd` 轻量链完成后,读持久化的 `lastDreamAt`(建议落 memory.sqlite3 内 consolidation 元数据行,与 consolidation_cursor 同库同租户边界),`now - lastDreamAt ≥ dreamInterval`(默认 24h;19 §6 `dream.cron: '0 4 * * *'` 键降级解释为间隔小时数)→ 把重量 Dream 四阶段(Orient/Gather/Consolidate/Prune)并入 T6 同一调度器(单 running + 单 latest-pending 覆盖合并,复用其语义),完成时原子更新 lastDreamAt。宿主不运行不触发(与 schedule「投递时宿主必须运行」同限);重启后首个会话尾由时间阈值自然补跑一次。19 §4 :161「M-M2 不接 schedule」原判维持,M-M3 亦不接。

### 证据路径

- compaction 先例:`packages/compaction/src/basic/summarizer.ts:120-181`;`summarizer.ts:144-179`;`summarizer.ts:152-163`;`summarizer.ts:196-211`;`packages/compaction/src/basic/index.ts:117`;`basic/index.ts:423`;`packages/compaction/node_modules/@deepseek-ai/dsh-llm/lib/types/index.d.ts:28-31`;`index.d.ts:433`;`index.d.ts:95-115`;`packages/compaction/node_modules/@deepseek-ai/dsh-llm/lib/types/types.d.ts:530-575`。
- 上游 one-shot 先例:`node_modules/.pnpm/@deepseek-ai+dsh-session-title-llm@0.2.2-rc.1_*/node_modules/@deepseek-ai/dsh-session-title-llm/lib/index.js:181-215`。
- glue 注入面:`packages/glue/src/plugins/memory-plugin.ts:15`;`packages/glue/cordis.patch.yml:21-32`;`scripts/verify-eterna-web.mjs:75`;`:81`;`:114`。
- schedule/jobs 判定:`node_modules/.pnpm/@deepseek-ai+dsh-schedule@0.2.2-rc.1_*/node_modules/@deepseek-ai/dsh-schedule/lib/types/index.d.ts:24-34`;`index.d.ts:98`;`README.zh.md:2`;`README.zh.md:12`;`node_modules/.pnpm/@deepseek-ai+dsh-jobs@0.2.2-rc.1_*/node_modules/@deepseek-ai/dsh-jobs/README.zh.md:40`;`README.zh.md:57`;`node_modules/.pnpm/@deepseek-ai+cordis@4.0.6-alpha.1_*/node_modules/@deepseek-ai/cordis/lib/types/utils.d.ts:1-52`(grep setInterval/setTimeout 于 lib/types 全目录零命中);`packages/audit/src/daily-sink.ts:24-29`;`pnpm-workspace.yaml:29`。
- 19 号文档:`docs/design/19-记忆系统开发文档-M-M1至M-M3.md:264`(§8 S-4 行);`:161`(M-M2 不接 schedule);`:165`(T7 llm seam);`:201-206`(T11 Dream 四阶段);`:249`(§7 风险行)。

### 采用的退路

周期触发半面采用 19 号文档退路:「会话尾触发+时间阈值合并」(与 19 §7「最坏退路:下一条用户消息到达时惰性检查上个已结束会话」同族、更轻的形态)——lastDreamAt 时间阈值(默认 24h)判定,重量 Dream 并入 T6 调度器;`dream.cron` 键降级解释为间隔小时数。T7 直调半面无需退路,接口已确证。

---

## S5 工具 execute 时可得 session 上下文(exec 参数形状)(影响 T2-provenance)

### 结论

**exec 形状(已核实,memory 实际解析版本 @deepseek-ai/dsh-tools@0.2.2-alpha.2,pnpm-workspace.yaml:41 catalog)**

execute 签名:`execute(args, exec: ToolRunContext)`(contracts.d.ts:36;defineTool 泛型版在 schema.d.ts:208,`InferArgs<S>` 自动收窄 args)。`ToolRunContext extends ToolExecution extends ToolExecutionInput`(contracts.d.ts:231),完整字段:`callId`(必在)、`rootCallId`、`name`、`schema?`、`arguments`、`agent?`、`toolSet?`、`parent?`、`signal`、`token`、`deferContext()`、`concludeTurn()`。工具体收到的就是这个对象(pipeline.js:471 `tool.execute(exec.arguments, exec)`)。`packages/memory/src/tools.ts:140` 现状 `(args, _exec)` 四工具全部忽略 exec——改法是把 `_exec` 用起来。

**sessionId:可直接从 exec 拿,无需闭包注入**

`exec.agent?.session?.id`(运行时增广 Agent,runtime-types.d.ts:168 `readonly session: Session`,Session.id 为 SessionId 品牌 string)或 `exec.agent?.id`(基础接口 types.d.ts:14)。dsh-agent 主入口同时 re-export types.ts 与 runtime-types.ts,声明合并生效(index.d.ts:13-14)。agent loop 派发时 exec 必带 agent(pipeline.js:39);agent-less 派发(嵌套/系统任务)时 undefined——pipeline.js:617-620 有该降级路径的先例文案,provenance 盖章须处理 undefined(盖 null 或拒写)。仓库先例:`packages/access/src/plugin.ts:226`(`exec.agent?.session.id`,上游 `tools/pre-execute` 事件类型)与 `packages/access/src/sandbox.ts:71`(本地结构接口 ToolExecLike)。已实跑 `cd packages/access && pnpm typecheck`(tsc --noEmit)通过,证明该取法对已装上游类型编译通过。

**turnRef:不在 exec 上(确定)**

ToolExecutionInput/ToolExecution/ToolRunContext 无任何 turn/step 字段。turn/step 只在 pipeline 批次输入 `log: { turn, step }` 中,被盖进会话日志事件 tool/call、tool/result(pipeline.js:187-199,连同 callId);Session 同步事件读取已 deprecated(dsh-session index.d.ts:213 起),turn 边界需走 TurnBoundaryProjection(dsh-agent types.d.ts:47+,openTurnStartSeq/lastStepStartSeq)投影面。

**对 19 号文档 §3-T2 provenance(:103)的修订建议**

`MemoryHost.sessionContext(): { sessionId, turnRef? } | undefined` 接口形状保留,但实现路线更新:

1. sessionId 首选直接在 memory_write execute 内读 `exec.agent?.session?.id`(模型传参忽略、工具参数不新增 provenance 字段——均照文档不变),agent 缺席时回落 sessionContext() 或盖 null;
2. turnRef 走两条任选其一路线——(a) 保留文档的 glue 闭包注入(turnRef 本就是可选字段);(b) 更简:provenance 存 `exec.callId`(必在),turn/step 后置从 session log 解析(tool/call 事件按 callId 记录 turn+step,与 T6/S-1 的 session log 读取面同源),可少一条 glue 依赖。

### 证据路径

- exec 类型:`node_modules/.pnpm/@deepseek-ai+dsh-tools@0.2.2-alpha.2_*/node_modules/@deepseek-ai/dsh-tools/lib/types/contracts.d.ts:36`(execute(args, exec: ToolRunContext) 签名);`contracts.d.ts:163`(ToolExecutionInput 字段:callId/rootCallId/name/schema/arguments/agent?/toolSet?/parent?/signal——无 turn);`contracts.d.ts:231`(ToolRunContext extends ToolExecution,+deferContext/concludeTurn);`lib/types/schema.d.ts:208`(defineTool 泛型 execute(args: InferArgs<S>, exec: ToolRunContext))。
- agent/session 面:`node_modules/.pnpm/@deepseek-ai+dsh-agent@0.2.2-alpha.2_*/node_modules/@deepseek-ai/dsh-agent/lib/types/types.d.ts:14`(Agent 基础接口 readonly id: SessionId);`lib/types/runtime-types.d.ts:168`(运行时增广 readonly session: Session);`lib/types/index.d.ts:13`(主入口 export * runtime-types.ts 与 types.ts,声明合并生效)。
- 派发面:`node_modules/.pnpm/@deepseek-ai+dsh-tools@0.2.2-alpha.2_*/node_modules/@deepseek-ai/dsh-tools/lib/pipeline.js:39`(agent loop 派发时 exec 注入 agent 字段);`pipeline.js:471`(tool.execute(exec.arguments, exec) 工具体收到完整 exec);`pipeline.js:187`(turn/step 只存在于批次 log,盖进 session 事件 tool/call,不进 exec);`pipeline.js:617`(agent-less 派发降级路径——exec.agent 可为 undefined)。
- 本仓先例与现状:`packages/access/src/plugin.ts:226`(仓库先例:exec.agent?.session.id,上游 tools/pre-execute 类型);`packages/access/src/sandbox.ts:71`(仓库先例:exec.agent?.session?.id;本地 ToolExecLike 定义在 :30);`packages/memory/src/tools.ts:140`(现有 execute: (args, _exec) 签名,exec 未使用);`pnpm-workspace.yaml:41`(@deepseek-ai/dsh-tools catalog 固定 0.2.2-alpha.2——即本次核实的版本)。
- 19 号文档:`docs/design/19-记忆系统开发文档-M-M1至M-M3.md:103`(T2 provenance:MemoryHost.sessionContext() { sessionId, turnRef? } 文档路线)。
- 实跑命令:`cd /Users/sunny/code/agent-basis/packages/access && pnpm typecheck` → 输出 `$ tsc --noEmit` 无错误退出(exec.agent?.session.id 对上游类型编译通过)。

### 采用的退路

无(已 resolved)。

---

## 对 19 号 §8 的修订建议

以下按 19 号文档(`docs/design/19-记忆系统开发文档-M-M1至M-M3.md`)条目给出修订点,行号为该文档当前 checkout 行号:

1. **§8 表格(259-265 行)——五项全部 resolved=true**,可在表头补注「结论见 [[19a-spike-conclusions]]」;其中 S-1 的「隔离 profile 实跑抓事件」方法项未单独执行,以「源仓类型增广声明 + 本仓 audit/compaction 两个生产监听插件在跑」为先例证据代替,如需百分百现场抓包在 T6 开发时用隔离 profile 复验(见 19a §S1-E)。
2. **§3 T2 第 1 点(103 行,provenance 盖章)**:实现路线按 19a §S5 修订——sessionId 首选在 memory_write execute 内读 `exec.agent?.session?.id`(agent 缺席回落 sessionContext() 或盖 null);turnRef 二选一:(a) 保留 glue 闭包注入,(b) 改存 `exec.callId` 后置从 session log 按 callId 解析 turn/step(tool/call 事件同源)。`MemoryHost.sessionContext()` 接口形状本身保留。
3. **§4 T6 事件触发框图(149 行)**:触发事件定稿——插件内 `import type {} from '@deepseek-ai/dsh-session'` 后 `ctx.on('session/event')`,主推进信号 `turn/end` 且 `reason.kind === 'completed'`;`session/disposed` 仅作 teardown 兜底(fire-and-forget);若整固需扫全量日志,先等 `'session/flush'`(awaited checkpoint)再读盘。门控 1(direct-write 防双写,152 行)读取面确定:活面 `tool/call` 且 `data.name === 'memory_write'`;盘面复用 `panel/src/session-logs.ts` 的 scanZstdFrames/decodeZstdLog/listSessionLogs 算法扫 `session.v4.jsonl.zstd`。
4. **§4 T7(165 行,llm seam)**:确证可用,调用形态照 compaction `summarizer.ts` + session-title-llm 的 prepareCall→deepFreeze({...call.config, system, messages})→call.stream 先例;`packages/memory` 需在 package.json 增 `"@deepseek-ai/dsh-llm": "catalog:"`;注意 `GenerateOptions.purpose` 为封闭联合 `'compaction' | 'session-title'`,**不得写 `purpose: 'consolidation'`**(TS 编译错,源仓只读不可扩),留空即可;KV-cache 复用技巧不适用于 T7 独立调用。
5. **§4 T9 第 2/3 点(177-178 行,审批闭环)**:M-M2 定稿采第 3 点最小版(panel snapshot 增 pendingCount + 面板审批列表,拒两击确认,裁决走 `Memory.review`);第 2 点的 ApprovalCardInput 组卡保留(类型复用)但**不投官方通道**——因 dsh-client-ui-approval/user-questions 未打进 dsh-web-frontend 0.2.2-rc.1 发行包(grep 实测 0 命中),官方即时卡片需上游发行包改造,完整体验留 M-M3;consolidation 内保留 `cardToQuestionItems(card)` → `ctx.userQuestions.ask({ questions })` 一行切换面(seam-pin 已钉形态零转换)。前置确认:现 packages/memory 源码无 review_state 列(grep 实证),M-M1 T1 加列是不可跳过的前置。
6. **§5 T11(201 行,Dream 周期触发)+ §6(233 行,dream.cron 键)**:schedule seam 判定**不可用**——dsh-schedule 语义是「把指令 prompt 投递进已有/新建会话」且无投递回调钩子,dsh-jobs 无 cron 且随进程消亡,cordis fork 无定时器面;重量 Dream 采「会话尾触发+时间阈值合并」(lastDreamAt 落 memory.sqlite3 consolidation 元数据行,与 consolidation_cursor 同库同租户边界;默认间隔 24h,并入 T6 调度器,重启后首个会话尾自然补跑)。§6 的 `dream.cron: '0 4 * * *'` 键**降级解释为间隔小时数**(默认 24),键名保留待上游出现真 cron 面再启用。161 行「M-M2 不接 schedule」维持,M-M3 亦不接。
7. **§5 T12-4(216 行,Sources 行)**:数据面主路径换向——由「优先 `ToolsService.executable` wrap 先例」改为「客户端 ConversationNodeDefinition 累计(match turn/start + tool/call + tool/result,按 callId 配对,发布 key 'memory-sources')+ turnTail slot 消费(deliverables/schedule 官方同款)」;工具 output 补 `presentationMeta` 使客户端零解析读 `tool/result.meta`;executable wrap 因 ToolRunContext 无 turn 字段降级为「仅按会话计数」的观测退路;T13 指标与验收用会话日志扫描(panel foldSessionEvents 同手法)。
8. **关联勘误**:04 号笔记 §3 的「66 种」事件计数与当前源仓 checkout 实数 63 种有漂移,引用该处时以 63 为准(词表演进,不影响 S-1 所需事件均在列)。
