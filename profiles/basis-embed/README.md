# profiles/basis-embed — Basis 企业嵌入档（headless 一次性任务/嵌入宿主）

`cordis.patch.yml`：叠在 `@deepseek-ai/dsh-base` + `@deepseek-ai/dsh-headless`
两个 bundle 层之上的企业组合层（官方 headless 模板的 bundle 元组 + 企业裁切 +
`@basis/llm-openai` 网关路由 + `agent-default-model` 指向 basis 路由）。

- 组合差异/用法/插件挂载位：见 [`docs/embed-profile.md`](../../docs/embed-profile.md)。
- 权威依据：`plans/2026-11-06-dsh企业agent路线定案.md` T6 行 + §11（§11.8 为准）。
- 冒烟验证：`node scripts/smoke-embed.mjs`（脚本物化本组合到
  `$DSH_HOME/profiles/basis-embed`，默认 home `.basis-home-embed/`，可用
  `EMBED_PROFILE_HOME` 改指；一次性任务经 headless 真会话 + tool_calls 一轮 +
  NAS liteLLM）。

组合栈（从下到上）：

1. `@deepseek-ai/dsh-base`（bundle 层，装品 0.2.2-rc.1）
2. `@deepseek-ai/dsh-headless`（bundle 层：headless-startup/runner、
   禁 credentials/authorization/deepseek-account/hmr、system-prompt persona、
   sandbox-policy CLI 授权）
3. 本 `cordis.patch.yml`（profile 用户层，最后写赢）

与 Web 档（`profiles/basis-web/`）同源异构：Web 档面向人（浏览器），嵌入档面向
宿主进程/脚本（无 GUI、无端口、无常驻、禁凭据库）。裁切差异、一次性任务与
JSON-RPC 用法、企业插件挂载位——全部见 `docs/embed-profile.md`。
