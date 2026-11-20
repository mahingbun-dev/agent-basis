# RC5-CMD-002 · 执行内置命令 `/compact`

**结论：PASS（命令路由、结果文案、会话事件面）** — 真实历史压缩需模型回合，**未覆盖，deferred to W5**。

## 一、命令确实走当前 compact 实现

1. **活体会话内执行**（真 boot eterna-web，`sessionController.create` → `preset=standard`）：
   `ctx.commands.execute(agent, '/compact', …)` 返回
   `{ kind: "success", text: "No compactable history yet." }`，
   会话事件只有 `command/run` + `command/done` 两条，`userMessageCount = 0`
   → 结果正确且不进入普通消息面（`probe.stdout.log`）。
2. **真值来源**：`packages/compaction/src/command-plugin.ts:67` 调 `ctx.compaction.compactNow(invocation.agent, invocation.signal, invocation.commandId)`；
   `null` → `No compactable history yet.`（`:68`），有结果 → `Compacted N history items (~T tokens).` + `sourceEventSeq`（`:70-74`）。
3. **单测**（`packages/compaction/tests/command-plugin.spec.ts`，9/9）钉住同一 agent/signal/commandId 的委托与六类 `ManualCompactionError` 映射。

## 二、浏览器实测（空会话，无模型调用）

- `/compact` → 对话区一行 `> compact · No compactable history yet.`（`compact-result.png`），**不是**用户消息气泡。
- `/压缩`（中文别名）→ 第二次同样结果（`compact-zh-alias.png`，occurrences=2），证明定义身份修复后中文别名可达。

## 三、边界（不标绿）

- **真实压缩**（有历史 + 总结模型调用 + checkpoint 写入）未在 T39 执行：本地无模型凭据/网络，属 51 §0.4 E2/E3 实机范围 → **deferred to W5**。
- 浏览器用例的模型目录由临时 `--patch` 声明两个 keyless mimo 模型（仅测试 DSH_HOME，生产配置未改），只用于 `/model` 回显，不参与 `/compact`。

## 证据

| 文件 | 内容 |
|---|---|
| `probe.stdout.log` | 活体 `T39_COMMAND_PROBE` JSON（命令目录/执行/事件面） |
| `probe.runtime.log` | 探针 boot 全日志（token 已脱敏） |
| `compact-result.png` | `/compact` 结果行 |
| `compact-zh-alias.png` | `/压缩` 第二次结果 |
| `../T39-UNIT/vitest.log` | 9/9 单测 |
| `../T39-BOOT/run-probe.mjs` | 探针 runner（可复跑） |