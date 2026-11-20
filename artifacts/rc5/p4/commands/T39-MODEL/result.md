# T39-MODEL · `/model` 注册与切换回显

**结论：PASS（web 客户端面：命令可开、目录可列、选择后回显）**

## 一、注册与行为

- `/model` 是**客户端 commandUi 贡献**，不在 Host 命令目录：
  `@deepseek-ai/dsh-client-ui-model-selection/src/client/index.ts:124-166`
  注册 `name: 'model'` + `ui.kind: 'popupSelect'`，`onSelect` 走
  `directory.select(selection)` → Host `session.selectModel`。
- 与 composer 的模型席位共用同一 per-session directory（上游 README「Two entries over ONE per-session directory」，
  `src/client/index.ts:168-176` 的 `conversation.input.model` 注册；README:78）。
- 菜单分派优先级：客户端贡献先于 Host 目录（`dsh-client-ui-commands/src/client/service.ts:252-266`），
  所以菜单里的 `模型 model` 打开弹层而不是去 Host 执行。

## 二、实测（本地真 boot eterna-web + Chromium）

| 断言 | 结果 |
|---|---|
| `/` 菜单中 `model` 恰 1 行 | PASS（`模型model选择本会话使用的模型`） |
| `/model` 弹层列出目录模型 | PASS：`MiMo V2.6 Flash`、`MiMo V2.6 Pro`（`02-model-popup.png`） |
| 选中后 composer 回显 | PASS：`选择模型，当前 MiMo V2.6 Pro…` → `选择模型，当前 MiMo V2.6 Flash，推理等级 Default`（`03-model-echo.png`） |

回显观测点：access 的 `pages.ts:330-354` 在 `session/selectModel` 响应成功后改写触发钮
`aria-label` 与文本；截图同时可见触发钮文本 `MiMo V2.6 Flash Default`。

## 三、边界

- 测试用临时 DSH_HOME 无模型路由，overlay 仅在该临时 home 声明两个 **keyless** mimo 模型（不联网、无凭据）；
  生产 profile/配置未改。
- 未发起真实模型请求（本用例只验选择与回显，不需要模型回合）。
- 子代理会话（addressed subagent）按上游设计不暴露 `/model`（`available: session => subagentAddress === undefined`），未在本用例覆盖。

## 证据

`02-model-popup.png`、`03-model-echo.png`、`assertions.json`、`run-ui.mjs`、`boot.log`（token 已脱敏）