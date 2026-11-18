# 思考强度自动模式(2026-11-18)

> 目标:每轮用户消息入箱时,按上下文自动为该会话选择思考强度档位(`reasoningEffort`),
> 替代「每轮手动拖滑杆」。归属插件 `@eterna/access`(模型菜单/UI/记账/路由面均在此),
> 零新页面入口(前端铁律 1)。

## 语义(用户拍板 2026-11-18)

- **每轮一决策**:一条真人消息入箱时选一次档,**整轮**(该消息触发的全部 step)沿用;
  轮内不重评(二期方向见文末)。
- **默认开启**:users.db `sessions.thinking_auto` 列默认 1——存量会话迁移后即自动,
  新会话同默认;模型菜单「自动」chip 可按会话关闭/开启。
- **手动即退出**:自动开启时拖动滑杆提交选档 = 显式退出自动(先落开关再 selectModel)。
- **手动会话零侵入**:开关关闭的会话,监听体在第一关就返回,行为与改造前完全一致。

## 链路(为什么是这个挂载点)

```
用户消息入箱(agent/inbox/inserted,dsh-agent-loop lib/index.js:200 同步 emit)
  → access 宿主监听(全同步,早于 wakeDriver → preStep 的 model.current() 捕获):
      store.thinkingAutoOf(sessionId)? → 否:返回(手动零侵入)
      message.source.kind === 'user'? → 否:返回(提问桥/notice 等系统源不评)
      agent.model.current() → provider/model
      档位表内存缓存(TTL 5min)命中? → 否:本轮不动(fail-neutral)+ 后台预热
      scoreMessage(文本块, 附件?) → pickEffort(score, efforts)
      agent.model.select({provider, model, reasoningEffort})   ← 本轮第一步即生效
      审计 access.thinking.auto {sessionId, provider, model, score, effort, efforts}
  → 投影 ModelSelection.pending(durable)
  → 每步请求消费该选择(dsh-llm GenerateOptions.reasoningEffort)
  → pi-ai 折算 wire 字段(cordis.patch.yml.template 档位表 → thinkingLevelMap)
```

排除项(宿主源码实读,dsh-agent 0.2.2-rc.1):

- `agent/request` waterfall 改 reasoningEffort **直接 throw**(runtime-types.d.ts:
  "use agent.model.select() before step preparation"),且整体 @deprecated;
- `agent/pre-step` 时步选择已捕获,只能影响下一步,首轮第一步够不着;
- `installModelSelection` 对**仅 effort 变化**不插 `[model changed]` 提示语,
  `select()` 同档原子 no-op ⇒ 自动模式不产生事件噪音,不发系统消息。

## 存储与 RPC

- 列:`sessions.thinking_auto INTEGER NOT NULL DEFAULT 1`(`migrateSessionsThinkingAuto`
  幂等补列,pragma table_info 判定;fail-loud 同 migrateRoleConstraint 纪律)。
- **行不存在 = false**:subagent/系统任务的会话不在归属账本,天然不启用。
- RPC:`/api/session/thinkingAuto` 专路(tenant.ts,仿 modelCatalog 先例)
  读 `{request:{sessionId}}` → `{enabled}`;写 `{request:{sessionId, enabled}}` → `{enabled}`。
  归属守卫同通用循环(sessionOwner 比对);写路径审计 `access.tenant` action=thinking.auto.set。

## 评分信号表(纯启发式,2026-11-18 拍板)

阈值全部集中在 `packages/access/src/thinking-score.ts` 头部常量;同输入恒同输出,
审计事件带 score 可回放复盘。**不承诺准确率**——下表只写设计意图,实效以审计回放评估。

| 信号 | 方向 | 幅度 |
|---|---|---|
| 基线 | — | 0.2 |
| 显式指令「深入思考/think step by step」等 | 直取 | 0.85(一锤定音) |
| 显式指令「简短回答/be concise」等 | 直取 | 0.1(一锤定音) |
| 整句寒暄(你好/收到/ok…,≤32 字符) | 钳低 | 上限 0.15 |
| 长度 <40 字符 | 降 | −0.1 |
| 长度 >500 / >2000 字符 | 升 | +0.1 / 再 +0.1 |
| 围栏代码块/堆栈痕迹 | 升 | +0.2 |
| 问号 ≥2(半/全角) | 升 | +0.1 |
| 编号/复选列表 | 升 | +0.1 |
| 深度词(排查/架构/根因/为什么…,命中封顶) | 升 | 每个 +0.15,至多 +0.3 |
| 附件/图片块 | 升 | +0.15 |

取档:`pickEffort(score, efforts) = efforts[round(score·(n−1))]`,数组为 adapter 声明的
档位表(**从小到大**,dsh-llm `LlmModelReasoningInfo` 契约)⇒ 只会产出模型声明的档位,
`UNSUPPORTED_REASONING_EFFORT` 结构性不可能;各模型档位集差异(hy4 仅 low/high、
luna 含 xhigh)天然自适应。

## 已知边界(fail-neutral 口径)

- **档位表缓存未命中**(冷启动首轮/预热未完成):本轮不改选,保持现值(= adapter
  默认行为),同时后台 `resolveModelInfo` 预热;插件 apply 时另有全目录预热
  (listProviders → listModels → resolveModelInfo 尽力而为)。缓存 TTL 5 分钟,
  profile patch 热改档位经此最终生效。
- **无 reasoning 声明的模型**:不选档(无可选档位,保持 adapter 默认)。
- **非真人源**(提问桥答案、model-selection notice 等)不评分;归属账本外会话不启用。
- **select/store 抛错**:吞掉 + 审计 `access.thinking.auto` ok:false,绝不阻断消息入箱/步进。
- composer 按钮的 aria 回显(pages.ts 拦截)只覆盖 RPC 路径;host 自动选档的标签更新
  以投影推流为准——E2E 实测时核对,不达预期另行补(见下「验证口径」)。

## 验证口径

- 单测:`tests/thinking-score.spec.ts`(信号表+取档)、`tests/thinking-auto.spec.ts`
  (路由器同步语义+store 迁移)、`tenant.spec.ts`(thinkingAuto 专路归属守卫);
  包级 `pnpm --filter @eterna/access run verify`。
- E2E(独立容器配方,零接触生产):菜单 chip 默认按下 → 寒暄消息与代码排查消息
  自动选档差异经审计 score/effort 核对、整轮保持 → 手动拖滑杆退出自动 → 恢复手动。
  PR 附深浅双主题截图(frontend-style §5)。

## 二期方向(未排期)

小模型路由(每轮轻量分类,代价=延迟+费用+兜底)、轮内升级信号(工具连续失败/长上下文
升档)、设置弹窗默认值分区(全局默认改手动)。

---

# V2:判档质量迭代(2026-11-18,判档质量优先)

> V1 只看单条消息;V2 把输入扩成「消息 + 会话尾部窗口」,并建立显式纠正闭环。
> 计划:plans/2026-11-18-会话思考强度判档迭代计划.md;开发方案:plans/2026-11-18-会话思考强度判档V2-开发方案与工作流.md

## 语义增补

- **判档输入** = 单条消息(文本/附件) + `ThinkingSessionSignals`(会话上下文八项);
  显式指令(深入思考/简短回答)仍一锤定音,压过上下文信号与偏置。
- **上下文读取**:入箱监听体内同步读 `Session.snapshotEvents(seq-200)` 尾部窗口
  (当前消息尚未入日志,早于 claim/append),`deriveSessionSignals` 纯函数折算;
  任何读取/解析异常=空窗口,退化为 V1 判档(fail-neutral,不阻断入箱)。
- **反馈闭环**:assistant 动作条「想浅点/想深点」→ `/api/session/thinkingFeedback`
  → 会话偏置 ±0.2(同向累计、反向抵消、钳位 ±0.5、24h 半衰、读时衰减)。
  手动拖滑杆仍=退出自动(V1 语义不变),不产生偏置。

## 会话信号表(初始值,回放校准后定稿)

| 信号 | 来源 | 方向/幅度 |
|---|---|---|
| 本轮工具失败 | 最后一条真人消息之后的 `tool/result`(`message.isError`) | 每个 +0.15,封顶 +0.3 |
| 同一工具连续失败 | 尾部连续失败段(遇成功/换工具即止) | ≥2 次 +0.15 |
| 同题追问 | 与上一条真人消息的字符二元组 containment ≥0.6 且间隔 ≤10min | +0.15 |
| 上下文规模 | 窗口事件 ≥200 / 近 3 条文本 ≥20000 字符 | 各 +0.1 |
| 上轮档位弱先验 | `model.current().reasoningEffort` 在档位表内归一 | (rank−0.5)×0.1,即 ±0.05 |
| 反馈偏置 | `sessions.thinking_bias` 经 24h 半衰 | 直接叠加,最终钳 [0,1] |

寒暄钳制的例外:失败/追问信号在场时「继续」不再按闲聊钳到 0.15(工作信号优先)。

## 存储与 RPC

- `sessions.thinking_bias REAL DEFAULT 0` / `thinking_bias_at INTEGER DEFAULT 0`
  (`migrateSessionsThinkingBias`,幂等;未知会话读取=undefined=无偏置,写入返回
  undefined 且不建行)。
- 读时衰减 `decayBias(raw, at, now)`(24h 半衰,|x|<0.01 归零);写入前先把存量
  衰减到 `now` 再叠加 ⇒ 久未操作自然回中。
- `POST /api/session/thinkingFeedback`
  `{request:{sessionId, messageId, direction:'less'|'more'}} → {bias, effectiveBias}`。
  归属守卫同 thinkingAuto(会话必须属于当前用户);`direction` 白名单外拒绝;
  审计 `thinking.feedback {sessionId, messageId, direction, bias, effectiveBias}`。

## 验证口径(V2)

- 单测:`tests/thinking-context.spec.ts`(窗口解析/追问/失败段/异形事件)、
  `tests/thinking-score.spec.ts`(逐信号 + 偏置衰减 + V1 兼容)、
  `tests/thinking-auto.spec.ts`(窗口读取/偏置生效/快照抛错/迁移/偏置叠加)、
  `tests/tenant.spec.ts`(thinkingFeedback 守卫)。
- 回放门禁(发布前):
  1. `node scripts/thinking-sample.mjs --src <会话日志目录> --out corpus/thinking.jsonl`
     —— 从生产会话日志抽样(本地脱敏,`corpus/` gitignored);
  2. 人工逐行填 `targetEffort`(≥150 条,分层覆盖寒暄/常规/代码/长材料/追问);
  3. `node scripts/thinking-replay.mjs --corpus corpus/thinking.jsonl --gate`
     —— 单元格:相邻档命中率 ≥90%、与人工一致率 ≥60%、极端误配 0;
     门禁数字必须实测写入 PR,不得估算。
- E2E(独立容器):寒暄落低档、代码排查落高档、点「想少了」后下一轮升档、
  反向点击抵消、重启后偏置仍在;深浅主题截图。

## 已知边界(V2)

- 窗口只读 200 事件(约 3–6 轮):更早的单次失败不再影响判档(会话长期记忆是二期
  的账号级偏好/小模型特征,不是窗口)。
- 偏置只按会话累积,不跨会话;`messageId` 仅审计锚点,不参与语义。
- 语料来自生产日志:分布偏向真实用法,寒暄/超长材料需按配额补抽;`corpus/` 永不入库。
- 客户端反馈按钮对最近消息常驻、对历史消息同样可达;未登录/无当前会话时不渲染。

## V2 收尾(2026-11-18,复核 15 条发现处置)

### RPC 契约(定型)

```
POST /api/session/thinkingFeedback
  {request:{sessionId}}                                 → {bias, effectiveBias}   只读,不审计
  {request:{sessionId, messageId?, direction:'less'|'more'}}
                                                        → {bias, effectiveBias}   ±0.2
  {request:{sessionId, messageId?, direction:'reset'}}  → {bias:0, effectiveBias:0}
拒绝(均记 thinking.feedback.denied {reason}):
  owner      会话不存在/不属于当前用户(守卫在方向分流之前)
  direction  值非法、非字符串、或近似键拼错(directon 等)
  messageId  非字符串或 >128 字符(锚点防伪造/防放大审计)
```

- 分流按**原始键存在性**判定,并识别 `/^dir/i` 近似键:拼错方向不得静默落入读支
  返回 `ok:true`(调用方会误以为写入成功)。
- reset 审计保留三键:`previousBias`(原始落库值)、`previousUpdatedAt`、
  `previousBiasEffective`(衰减后)——只记衰减值会在死区里显示 0,事后无法复盘。
- `thinkingAuto` 同步严格化:`enabled` 键存在但非布尔、或近似键(`enable`)→ 拒绝
  + `thinking.auto.denied`,不再静默当读。

### 菜单偏置行

- 可见阈值 `client/bias-view.BIAS_VISIBLE_MIN = 0.01`,与判档 `BIAS_DEAD_ZONE` 同值
  (两边单测互相钉住);文案两位小数(「已调深 +0.04」),不再四舍五入到 0.1 后整行消失。
- 自动选档关闭时行内给**可见**文案「自动选档已关闭，偏置暂不参与判档」,重置仍可用。
- 「重置」两击确认、`role="menuitem"`、`aria-label="重置本会话思考偏置"`、
  `min-height: 36px`(触控目标)、失败只显示中文固定文案(原始异常进 console)。
- 行异步插入后**双向**纠正主面板上/下定位,并触发子面板定位基准重测。

### 会话 id 来源(矫正 F1)

`localStorage['dsh.sessions.current']` 只是导航快照,多 tab/多会话会错。现按优先级:

1. assistant-actions 组件:slot 标准席位 `props.sessionId`(ui-session 会话绑定下发);
2. 会话桥 `client/session-bridge.ts`:由 `SessionBindingProbe` 注册在
   `conversation.input.overlay`(session 作用域,渲染 null)在渲染时写入;
3. 最后才回退 localStorage(旧壳/探针缺席)。

模型菜单(命令式挂载、拿不到 slot props)走 `activeSessionId() ?? readCurrentSession()`。

### 验证覆盖

- `tests/bias-view.spec.ts`:阈值/文案/桥覆盖语义。
- `tests/tenant.spec.ts`:读支衰减(24h 前 0.4 ⇒ effective≈0.2)、reset 不动
  `thinking_auto`、reset 审计原始值、拒绝审计三 reason、`enabled` 严格化。
- `tests/tenant-guard-matrix.spec.ts`:两专路 × {本人/他人/未登录} 六例。
- `scripts/team-platform-gates/p7-e2e-thinking-feedback.mjs`:新增读支/reset(PRC 与 UI
  两击)判据、偏置行深浅截图(`bias-row-*.png`)、`p7/gate-summary.json` 阶段摘要。
