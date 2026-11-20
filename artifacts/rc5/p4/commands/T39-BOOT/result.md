# T39-BOOT · 活体命令目录探针

**结论：PASS（默认 `standard` 预设的活体命令目录、`/compact` 执行与事件面）**

## 方法（不改产品文件/不碰生产）

1. 复制仓库内 `.eterna-home/profiles/eterna-web`（verify-eterna-web 物化的生产渲染 profile）到 `/tmp` 临时 DSH_HOME；
2. 临时 profile node_modules 挂探针包 `probe/`，`--patch overlay.yml` 追加 `t39-command-probe` 行；
3. `dsh --profile eterna-web --patch … --no-open --port 0` 真 boot；
4. 探针经 `ctx.sessionController.create({cwd})` 建会话（与 Web UI 同路径，预设在此挂载），
   再读 `ctx.commands.list(agent)` / `ctx.commands.execute(agent,'/compact',…)`；
5. 退出后删临时 home；日志 token 脱敏。

## 实测（`probe.stdout.log`）

- 预设：`agentPreset=standard`，`activePreset=standard`；roster = `standard(默认) / minimal / cordis`。
- 命令目录 6 条：`compact, export, feedback, goal, permission, plan`；`duplicateNames: []`。
- `compact.definitionId = @deepseek-ai/dsh-command-compact`（`builtinCompactIdentity=true`）。
- 执行 `/compact`：`{kind:'success', text:'No compactable history yet.'}`；`cmd-…` 与 `command/run`/`command/done` 配对。
- 事件面：`commandEventTypes=['command/run','command/done']`，`userMessageCount=0`，
  `userMessageMentionsCompact=false` → **不污染普通消息**。
- `/model`：`modelInHostCatalog=false`，`execute` unresolved → 客户端贡献（与 T39-MODEL 的浏览器实测互证）。
- 未知命令 `/definitely-not-a-command`：unresolved（预期）。

## 复跑

`node artifacts/rc5/p4/commands/T39-BOOT/run-probe.mjs`（需 `.eterna-home/profiles/eterna-web` 已物化）

## 证据

`probe.stdout.log`、`runtime.log`（boot 全日志，token 脱敏）、`probe/index.js`、`run-probe.mjs`、`overlay.yml`