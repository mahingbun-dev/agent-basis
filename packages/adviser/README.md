# @eterna/adviser — 参谋面板

会话内辅助对话：在右侧栏贡献「参谋」tab（`sidebar.right.pane.tab`，`multiple: true` 可多开），
参谋会话是 **独立上下文的 subagent child**，只读主会话与工作区内容，结论由用户确认后
以 `inject`（不唤醒）或 `followup`（自成一轮）投递给主会话。

- 设计依据：[docs/design/54-adviser-P0-probe.md](../../docs/design/54-adviser-P0-probe.md)
- 计划书：[plans/2026-11-24-会话辅助对话-参谋面板.md](../../plans/2026-11-24-会话辅助对话-参谋面板.md)

## 当前阶段

**P1–P10 全部落地**（2026-11-24）。Host 半边：服务面（create/list/deliver + 冷恢复）、
主会话 [adviser] 纪律段、super 形态工单概览工具；浏览器半边：右栏 tab 类型、
参谋面板（可多开）、三入口（斜杠命令/快捷键/选中文字）与回写条（inject/followup
双按钮 + 二次确认）。只读工具面由 `eterna-adviser` preset 与 `tool-guard` 全局守门
双重保证——预设挡不住根 ctx 注册的全局工具（54 号 §15 实机定谳）。验收：两形态
真实 profile 各 13/13 PASS（零写工具泄漏）、全仓 `pnpm -w run verify` 绿。

**P11 模型解耦**（2026-11-25）：参谋可独立设置模型，创建时继承主会话**当前**模型。
上游对 subagent 子会话不渲染模型选择器（`ui-model-selection` 的可用性门），通用
`selectModel` 也会以 `session/agent-busy`（owned by subagent routing）拒绝，故参谋
模型走自己的数据面：

- 创建：`AdviserActivationSpec.request.agentOptions` ← 父会话 `agent.model.current()`
  （不是 `parent.options` 的创建时路由——用户切过模型后二者不同）；
- 读：live 走 `agent.model.current()`，冷会话走 `sessionQuery` 的 `modelSelection`
  投影（`next ?? lastUsed`）；
- 写：live 走 `agent.model.select()`（落 `model/selection` 事件）；冷会话直接向
  持久化日志追加同一事件（`sessionPersistence.open(child,'write')` → `append` → `flush`），
  恢复后投影一致。写入前经 `llm.resolveCallConfig` 校验路由/档位可用性；
- HTTP：`POST /access/api/adviser/model/read` 与 `POST /access/api/adviser/model`
  （access 守卫路由；父会话归属 + 服务内子父关系校验，均出审计）；
- UI：参谋 tab 对话区上沿的 chip + 弹层（`AdviserModelBar.tsx`），只影响参谋，
  主会话模型菜单完全不受影响。

## 关键约束

| 约束 | 来源 |
|---|---|
| 不新增 `SessionEventMap` 事件类型（v4 持久化恢复拒载未知非 ignorable 事件） | `git show 2e3fa84`（`/clear` 同一手法） |
| tab 类型用独立 `kind: 'adviser'`，不接管上游 `subagentchat` | 计划书 §7 R7 |
| 只读工具面：不写文件、不跑命令、不委派、不建工单 | 计划书 §3 定位 |
| 面向用户文字一律中文；色值只走 `--et-*` 令牌；图标走 `@eterna/ui/icons` | AGENTS.md 铁律 |
| 参谋会话列表隐藏靠客户端 `ui-workspace` 的 `tree.ts:235` 硬过滤，**宿主语料仍含** | P0 §2.1-③、计划书 §7 R1b |

## 结构

```
src/index.ts              Host 半边入口（服务面 provide + 纪律段注册）
src/service.ts            参谋服务面：创建/列表/投递/冷恢复（纯逻辑，端口注入）
src/host.ts               真实宿主端口装配（服务现读、startActivation 双形态、工单工具注册）
src/section.ts            主会话 [adviser] 纪律段（systemPrompt.section，order 9060）
src/ticket-tools.ts       super 形态工单概览工具 adviser_tickets（宿主半边注册）
src/tool-guard.ts         全局工具守门（动态 deny = 全局工具 − 只读白名单）
src/tool-guard-plugin.ts  preset 内的守门行入口
src/client/index.ts       浏览器半边：tab 类型 + body 注册
src/client/AdviserPanel.tsx  面板正文（conversation.content embedded 完整对话）
src/client/AdviserModelBar.tsx 参谋模型 chip + 弹层（独立于主会话；P11）
src/client/AdviserPicker.tsx 多开选择面板
src/client/AdviserFeedbackBar.tsx  回写条（inject/followup 双按钮）
src/client/client-types.ts   本地结构面（不导入跨包类型，零运行时依赖）
src/client/locales.ts     中英字典（NS = 'eterna-adviser'）
src/client/styles.ts      --et-* 令牌样式
scripts/build-client.mjs  esbuild → window.__ModuleLoader__ 工件
cordis.patch.yml          挂载行 + preset 定义（profile 里另有同源复述）
```
