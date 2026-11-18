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
